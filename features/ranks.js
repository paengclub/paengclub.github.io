// features/ranks.js — 랭크, a personal competitive-rank tracker.
//
// Each user tracks one or more game accounts (main + alts), each public or
// private, and logs a rank per role over time. Data: game_accounts +
// game_rank_records (see migrations/20261013_game_ranks.sql); RLS hides
// private accounts and their records from everyone but the owner.
//
// Everything game-specific — roles, tiers, divisions, colours — lives in GAMES
// below. Overwatch is the only entry today; adding a game is a GAMES entry plus
// widening the CHECK constraints in a migration.
//
// Recording is built to be cheap, since a rank changes often:
//   - the record form opens pre-filled with that role's latest rank,
//   - progress % is optional (most updates are just "moved a division"),
//   - each role card has ▲/▼ to log a one-division change in one tap, with an
//     undo in the status line.
// With two or more accounts, a 전체 dashboard opens by default: per role the
// best current and all-time rank, a rank-over-time chart comparing accounts,
// the current account x role grid, and a feed of recent changes. An account
// page charts its own roles the same way.
// Exports renderRanks, cleanupRanks.
import { supabase } from "/supabaseClient.js";
import { getCurrentSession, signInWithGoogle } from "/features/auth.js";
import { el, svg } from "/lib/dom.js";

// Tier colours are approximations chosen to be distinct, not official values.
const GAMES = {
    overwatch: {
        label: "오버워치",
        roles: [
            { key: "tank", label: "탱커" },
            { key: "damage", label: "딜러" },
            { key: "support", label: "힐러" },
            // Open Queue is played far less, so its card only appears once it
            // has a record (it is always offered in the form).
            { key: "open", label: "자유 경쟁", optional: true }
        ],
        tiers: [
            { key: "bronze", label: "브론즈", short: "브론즈", color: "#a8703f" },
            { key: "silver", label: "실버", short: "실버", color: "#8e9aa8" },
            { key: "gold", label: "골드", short: "골드", color: "#d9a21b" },
            { key: "platinum", label: "플래티넘", short: "플래", color: "#57b5c9" },
            // added in Season 4, between Platinum and Diamond
            { key: "emerald", label: "에메랄드", short: "에메", color: "#12b76a" },
            { key: "diamond", label: "다이아몬드", short: "다이아", color: "#4f6ef7" },
            { key: "master", label: "마스터", short: "마스터", color: "#e0702c" },
            { key: "grandmaster", label: "그랜드마스터", short: "그마", color: "#7c4dff" },
            { key: "champion", label: "챔피언", short: "챔피언", color: "#c2368f" },
            // a leaderboard placement, not a tier: no divisions, no progress
            { key: "top500", label: "Top 500", short: "Top500", color: "#1f2937", noDivision: true }
        ],
        // listed low to high, the way the game counts them
        divisions: [5, 4, 3, 2, 1]
    }
};
const GAME = "overwatch";
const HISTORY_PREVIEW = 12;

let people = [];
let accounts = [];
let records = [];
let viewerId = null;
const accountByViewer = new Map();

// transient UI state, cleared when leaving the tab
let form = null; // { role, tier, division, progress, date } while the record form is open
let accountEditor = null; // null | { mode: "add" } | { mode: "rename", id }
let showFullHistory = false;
let undoRecordId = null;
let busy = false;

// --- small helpers ---------------------------------------------------------

function game() {
    return GAMES[GAME];
}

function tierOf(key) {
    return game().tiers.find((tier) => tier.key === key);
}

function tierIndex(key) {
    return game().tiers.findIndex((tier) => tier.key === key);
}

function roleOf(key) {
    return game().roles.find((role) => role.key === key);
}

// Ranks as one ladder: every division is one step (Bronze 5 = 0 … Champion 1
// = 44, Top 500 = 45). Steps are derived from GAMES on every render, never
// stored, so inserting a tier (as Emerald was) re-ranks old records correctly. Progress is kept apart so a missing % never counts as
// a value it wasn't.
function stepOf(record) {
    const index = tierIndex(record.tier);
    if (tierOf(record.tier).noDivision) return index * 5;
    return index * 5 + (5 - record.division);
}

function scoreOf(record) {
    return stepOf(record) + (record.progress ?? 0) / 100;
}

const MAX_DIVISION_STEP = (game().tiers.filter((tier) => !tier.noDivision).length * 5) - 1;

// The rank one division up (dir = 1) or down (dir = -1), or null at either end
// of the ladder. Top 500 isn't reached by promotion, so it has no neighbours.
function stepRank(record, dir) {
    if (tierOf(record.tier).noDivision) return null;
    const next = stepOf(record) + dir;
    if (next < 0 || next > MAX_DIVISION_STEP) return null;
    return { tier: game().tiers[Math.floor(next / 5)].key, division: 5 - (next % 5) };
}

function rankLabel(record) {
    const tier = tierOf(record.tier);
    return tier.noDivision ? tier.label : `${tier.label} ${record.division}`;
}

// Local calendar date. toISOString() would give UTC — the previous day for
// anything recorded before 9am in Korea.
function todayString() {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

function parseDay(value) {
    return new Date(`${value}T00:00:00`);
}

function shortDate(value) {
    const date = parseDay(value);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return `${sameYear ? "" : `${date.getFullYear()}년 `}${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function relativeDay(value) {
    const days = Math.round((parseDay(todayString()) - parseDay(value)) / 86400000);
    if (days <= 0) return "오늘";
    if (days === 1) return "어제";
    if (days < 30) return `${days}일 전`;
    return shortDate(value);
}

function displayName(person) {
    return person?.nickname || person?.display_name || "Paengclub member";
}

function sessionUserId() {
    return getCurrentSession()?.user?.id || null;
}

function isOwnViewer() {
    return Boolean(viewerId) && viewerId === sessionUserId();
}

function accountsOf(userId) {
    return accounts.filter((account) => account.user_id === userId);
}

// The 전체 overview is a choice like any account, stored in accountByViewer
// under OVERVIEW. It only exists with two or more accounts, and it is where
// such a viewer lands until they pick an account.
const OVERVIEW = "overview";

function selectionFor(userId) {
    const list = accountsOf(userId);
    const wanted = accountByViewer.get(userId);
    if (wanted === OVERVIEW && list.length >= 2) return OVERVIEW;
    const found = list.find((account) => account.id === wanted);
    if (found) return found;
    return list.length >= 2 ? OVERVIEW : list[0] || null;
}

function isOverview() {
    return selectionFor(viewerId) === OVERVIEW;
}

function selectedAccount() {
    const selection = selectionFor(viewerId);
    return selection === OVERVIEW ? null : selection;
}

function selectAccount(id) {
    accountByViewer.set(viewerId, id);
    setStatus("");
    form = null;
    showFullHistory = false;
    renderBody();
}

// oldest first
function recordsFor(accountId, role) {
    return records.filter((record) => record.account_id === accountId && (!role || record.role === role));
}

function latestFor(accountId, role) {
    const list = recordsFor(accountId, role);
    return list[list.length - 1] || null;
}

function setStatus(message, type = "", action = null) {
    const status = document.getElementById("rkStatus");
    if (!status) return;
    status.className = `rk-status ${type}`;
    // replaceChildren() would print a null child as the text "null"
    status.replaceChildren(...[
        message ? el("span", { text: message }) : null,
        action ? el("button", { class: "text-action", type: "button", text: action.label, onclick: action.run }) : null
    ].filter(Boolean));
}

// --- data ------------------------------------------------------------------

async function loadAll() {
    const [peopleResult, accountsResult, recordsResult] = await Promise.all([
        supabase.from("profiles").select("id, display_name, nickname, avatar_url"),
        supabase
            .from("game_accounts")
            .select("id, user_id, game, name, is_public, sort_order, created_at")
            .eq("game", GAME)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true }),
        // RLS already limits this to records of accounts the viewer may see
        supabase
            .from("game_rank_records")
            .select("id, account_id, user_id, role, tier, division, progress, recorded_on, created_at")
            .order("recorded_on", { ascending: true })
            .order("created_at", { ascending: true })
    ]);

    for (const result of [peopleResult, accountsResult, recordsResult]) {
        if (result.error) throw result.error;
    }

    people = peopleResult.data || [];
    accounts = accountsResult.data || [];
    const visible = new Set(accounts.map((account) => account.id));
    records = (recordsResult.data || []).filter((record) => visible.has(record.account_id));
}

// You first (so you can always add an account), then anyone with an account
// you're allowed to see.
function listedPeople() {
    const me = sessionUserId();
    const owners = new Set(accounts.map((account) => account.user_id));
    if (me) owners.add(me);
    return people
        .filter((person) => owners.has(person.id))
        .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : displayName(a).localeCompare(displayName(b), "ko")));
}

function resolveViewer() {
    const listed = listedPeople();
    if (viewerId && listed.some((person) => person.id === viewerId)) return;
    const me = sessionUserId();
    viewerId = me && listed.some((person) => person.id === me) ? me : listed[0]?.id || null;
}

// Every write reloads everything: the data is small, and it keeps the view
// exactly in line with what RLS returns.
async function refresh() {
    await loadAll();
    resolveViewer();
    renderBody();
}

async function write(run, success) {
    if (busy) return false;
    busy = true;
    try {
        const { error } = await run();
        if (error) {
            setStatus(error.message, "danger");
            return false;
        }
        await refresh();
        if (success) setStatus(success.message, "success", success.action || null);
        return true;
    } catch (error) {
        setStatus(error.message, "danger");
        return false;
    } finally {
        busy = false;
    }
}

// --- writes ------------------------------------------------------------------

function addAccount(name, isPublic) {
    const clean = name.trim().slice(0, 40);
    if (!clean) {
        setStatus("계정 이름을 입력해 주세요.", "danger");
        return;
    }
    const own = accountsOf(sessionUserId());
    const sortOrder = own.length ? Math.max(...own.map((account) => account.sort_order)) + 1 : 0;
    accountEditor = null;
    write(
        async () => {
            const result = await supabase
                .from("game_accounts")
                .insert({ game: GAME, name: clean, is_public: isPublic, sort_order: sortOrder })
                .select("id")
                .single();
            if (!result.error) accountByViewer.set(sessionUserId(), result.data.id);
            return result;
        },
        { message: `'${clean}' 계정을 추가했어요.` }
    );
}

function updateAccount(account, changes, message) {
    write(() => supabase.from("game_accounts").update(changes).eq("id", account.id), { message });
}

function deleteAccount(account) {
    const count = recordsFor(account.id).length;
    const detail = count ? ` 기록 ${count}개도 함께 삭제됩니다.` : "";
    if (!window.confirm(`'${account.name}' 계정을 삭제할까요?${detail}`)) return;
    accountByViewer.delete(viewerId);
    write(() => supabase.from("game_accounts").delete().eq("id", account.id), { message: "계정을 삭제했어요." });
}

function makeMain(account) {
    const own = accountsOf(sessionUserId());
    const lowest = Math.min(...own.map((item) => item.sort_order));
    updateAccount(account, { sort_order: lowest - 1 }, `'${account.name}'을(를) 본계로 설정했어요.`);
}

async function insertRecord(account, fields, message, withUndo = false) {
    let createdId = null;
    const saved = await write(
        async () => {
            const result = await supabase
                .from("game_rank_records")
                .insert({ account_id: account.id, ...fields })
                .select("id")
                .single();
            createdId = result.data?.id || null;
            return result;
        },
        null
    );
    if (!saved) return false;

    undoRecordId = withUndo ? createdId : null;
    setStatus(message, "success", withUndo ? { label: "되돌리기", run: undoLast } : null);
    return true;
}

function undoLast() {
    if (!undoRecordId) return;
    const id = undoRecordId;
    undoRecordId = null;
    write(() => supabase.from("game_rank_records").delete().eq("id", id), { message: "되돌렸어요." });
}

function deleteRecord(record) {
    if (!window.confirm(`${shortDate(record.recorded_on)} ${roleOf(record.role).label} ${rankLabel(record)} 기록을 삭제할까요?`)) return;
    write(() => supabase.from("game_rank_records").delete().eq("id", record.id), { message: "기록을 삭제했어요." });
}

function quickStep(account, role, dir) {
    const latest = latestFor(account.id, role);
    const next = latest && stepRank(latest, dir);
    if (!next) return;
    const label = rankLabel({ tier: next.tier, division: next.division });
    insertRecord(
        account,
        { role, tier: next.tier, division: next.division, progress: null, recorded_on: todayString() },
        `${roleOf(role).label} ${label}(으)로 ${dir > 0 ? "승급" : "강등"} 기록했어요.`,
        true
    );
}

// --- record form -------------------------------------------------------------

// Start from the role's latest rank: a typical update is one division away.
function openForm(role) {
    const account = selectedAccount();
    const latest = account && latestFor(account.id, role);
    form = {
        role,
        tier: latest?.tier || "gold",
        division: latest?.division ?? 5,
        progress: "",
        date: todayString()
    };
    renderForm();
    document.getElementById("rkForm")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function closeForm() {
    form = null;
    renderForm();
}

function submitForm() {
    const account = selectedAccount();
    if (!form || !account) return;
    const tier = tierOf(form.tier);
    const progressText = String(form.progress).trim();
    let progress = null;
    if (!tier.noDivision && progressText !== "") {
        progress = Number(progressText);
        if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
            setStatus("진행도는 0~100 사이 정수로 입력해 주세요.", "danger");
            return;
        }
    }
    if (!form.date || form.date > todayString()) {
        setStatus("기록 날짜를 확인해 주세요.", "danger");
        return;
    }

    const fields = {
        role: form.role,
        tier: form.tier,
        division: tier.noDivision ? null : form.division,
        progress,
        recorded_on: form.date
    };
    const label = rankLabel(fields) + (progress !== null ? ` · ${progress}%` : "");
    const role = roleOf(form.role).label;
    form = null;
    insertRecord(account, fields, `${role} ${label} 기록했어요.`, true);
}

function segmented(options, current, onPick, className = "") {
    return el("div", { class: `rk-segmented ${className}` }, options.map((option) => el("button", {
        type: "button",
        class: option.value === current ? "active" : "",
        text: option.label,
        onclick: () => onPick(option.value)
    })));
}

function renderForm() {
    const target = document.getElementById("rkForm");
    if (!target) return;
    target.hidden = !form;
    if (!form) {
        target.replaceChildren();
        return;
    }

    const tier = tierOf(form.tier);
    const update = (changes) => {
        Object.assign(form, changes);
        renderForm();
    };
    // changing role re-prefills from that role's own latest rank
    const pickRole = (role) => {
        const account = selectedAccount();
        const latest = account && latestFor(account.id, role);
        update({ role, tier: latest?.tier || form.tier, division: latest?.division ?? form.division });
    };

    const progressInput = el("input", {
        class: "form-control rk-progress-input",
        type: "number",
        min: "0",
        max: "100",
        inputmode: "numeric",
        placeholder: "선택",
        value: form.progress
    });
    progressInput.addEventListener("input", () => {
        form.progress = progressInput.value;
    });

    const dateInput = el("input", { class: "form-control rk-date-input", type: "date", max: todayString(), value: form.date });
    dateInput.addEventListener("change", () => {
        form.date = dateInput.value;
    });

    target.replaceChildren(el("div", { class: "rk-form-inner" }, [
        el("div", { class: "rk-form-title", text: "랭크 기록" }),
        el("div", { class: "rk-field" }, [
            el("span", { class: "rk-field-label", text: "역할" }),
            segmented(game().roles.map((role) => ({ value: role.key, label: role.label })), form.role, pickRole)
        ]),
        el("div", { class: "rk-field" }, [
            el("span", { class: "rk-field-label", text: "티어" }),
            el("div", { class: "rk-tier-picker" }, game().tiers.map((option) => el("button", {
                type: "button",
                class: `rk-tier-option${option.key === form.tier ? " active" : ""}`,
                style: `--tier:${option.color}`,
                // division is kept (just not shown or saved) while Top 500 is
                // picked, so stepping back to a tier restores it
                onclick: () => update({ tier: option.key })
            }, [el("span", { class: "rk-tier-dot" }), el("span", { text: option.label })])))
        ]),
        tier.noDivision ? null : el("div", { class: "rk-field-row" }, [
            el("div", { class: "rk-field" }, [
                el("span", { class: "rk-field-label", text: "디비전" }),
                segmented(game().divisions.map((division) => ({ value: division, label: String(division) })), form.division, (division) => update({ division }))
            ]),
            el("label", { class: "rk-field" }, [
                el("span", { class: "rk-field-label", text: "진행도 %" }),
                progressInput
            ])
        ]),
        el("label", { class: "rk-field" }, [el("span", { class: "rk-field-label", text: "날짜" }), dateInput]),
        el("div", { class: "rk-form-actions" }, [
            el("button", { class: "primary-button", type: "button", text: "저장", onclick: submitForm }),
            el("button", { class: "secondary-button", type: "button", text: "취소", onclick: closeForm })
        ])
    ]));
}

// --- view ----------------------------------------------------------------------

function avatarOf(person) {
    return person.avatar_url
        ? el("img", { class: "avatar small", referrerpolicy: "no-referrer", src: person.avatar_url, alt: "" })
        : el("span", { class: "avatar small avatar-fallback", text: displayName(person).slice(0, 1).toUpperCase() });
}

function renderPeople() {
    const me = sessionUserId();
    return el("div", { class: "tt-people" }, listedPeople().map((person) => el("button", {
        type: "button",
        class: `tt-person-chip${person.id === viewerId ? " active" : ""}`,
        onclick: () => {
            viewerId = person.id;
            setStatus("");
            form = null;
            accountEditor = null;
            showFullHistory = false;
            renderBody();
        }
    }, [avatarOf(person), el("span", { text: person.id === me ? `${displayName(person)} (나)` : displayName(person) })])));
}

function renderAccountEditor() {
    const editing = accountEditor?.mode === "rename" ? accounts.find((account) => account.id === accountEditor.id) : null;
    const nameInput = el("input", {
        class: "form-control",
        maxlength: "40",
        placeholder: "배틀태그 또는 별칭 (예: 본계, Paeng#3123)",
        value: editing?.name || ""
    });
    const publicBox = el("input", { type: "checkbox", checked: "" });
    const save = () => {
        if (editing) {
            const clean = nameInput.value.trim().slice(0, 40);
            if (!clean) return setStatus("계정 이름을 입력해 주세요.", "danger");
            accountEditor = null;
            updateAccount(editing, { name: clean }, "이름을 바꿨어요.");
        } else {
            addAccount(nameInput.value, publicBox.checked);
        }
    };
    nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") {
            accountEditor = null;
            renderBody();
        }
    });
    window.setTimeout(() => nameInput.focus(), 0);

    return el("div", { class: "rk-account-editor" }, [
        nameInput,
        editing ? null : el("label", { class: "rk-check" }, [publicBox, el("span", { text: "다른 사람에게 공개" })]),
        el("div", { class: "rk-form-actions" }, [
            el("button", { class: "primary-button compact", type: "button", text: editing ? "변경" : "추가", onclick: save }),
            el("button", {
                class: "secondary-button compact",
                type: "button",
                text: "취소",
                onclick: () => {
                    accountEditor = null;
                    renderBody();
                }
            })
        ])
    ]);
}

function renderAccounts(own) {
    const list = accountsOf(viewerId);
    const current = selectedAccount();

    const tabs = list.length >= 2 ? [el("button", {
        type: "button",
        class: `rk-account-tab${isOverview() ? " active" : ""}`,
        onclick: () => selectAccount(OVERVIEW)
    }, [el("span", { text: "전체" })])] : [];

    tabs.push(...list.map((account, index) => el("button", {
        type: "button",
        class: `rk-account-tab${account.id === current?.id ? " active" : ""}`,
        onclick: () => selectAccount(account.id)
    }, [
        el("span", { text: account.name }),
        list.length > 1 ? el("span", { class: "rk-badge", text: index === 0 ? "본계" : "부계" }) : null,
        own && !account.is_public ? el("span", { class: "rk-badge muted", text: "비공개" }) : null
    ])));

    if (own) {
        tabs.push(el("button", {
            type: "button",
            class: "rk-account-tab add",
            text: "+ 계정",
            onclick: () => {
                accountEditor = { mode: "add" };
                renderBody();
            }
        }));
    }

    return el("div", { class: "rk-accounts" }, tabs);
}

function renderAccountTools(account) {
    const own = accountsOf(sessionUserId());
    return el("div", { class: "rk-account-tools" }, [
        el("button", {
            type: "button",
            class: `rk-visibility${account.is_public ? " is-public" : ""}`,
            title: account.is_public ? "모두가 볼 수 있어요" : "나만 볼 수 있어요",
            onclick: () => updateAccount(
                account,
                { is_public: !account.is_public },
                account.is_public ? "비공개로 바꿨어요. 이제 나만 볼 수 있어요." : "공개로 바꿨어요."
            )
        }, [el("span", { class: "rk-visibility-dot" }), el("span", { text: account.is_public ? "공개" : "비공개" })]),
        own[0]?.id !== account.id
            ? el("button", { class: "text-action", type: "button", text: "본계로 설정", onclick: () => makeMain(account) })
            : null,
        el("button", {
            class: "text-action",
            type: "button",
            text: "이름 변경",
            onclick: () => {
                accountEditor = { mode: "rename", id: account.id };
                renderBody();
            }
        }),
        el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => deleteAccount(account) })
    ]);
}

function trendOf(list) {
    if (list.length < 2) return null;
    const latest = list[list.length - 1];
    const previous = list[list.length - 2];
    const steps = stepOf(latest) - stepOf(previous);
    if (steps > 0) return { text: `▲ ${steps}단계`, kind: "up" };
    if (steps < 0) return { text: `▼ ${-steps}단계`, kind: "down" };
    if (latest.progress !== null && previous.progress !== null && latest.progress !== previous.progress) {
        const diff = latest.progress - previous.progress;
        return { text: `${diff > 0 ? "+" : ""}${diff}%p`, kind: diff > 0 ? "up" : "down" };
    }
    return { text: "변동 없음", kind: "flat" };
}

function renderRoleCard(account, role, own) {
    const list = recordsFor(account.id, role.key);
    const latest = list[list.length - 1];

    if (!latest) {
        return el("article", { class: "rk-card is-empty" }, [
            el("div", { class: "rk-card-head" }, [el("span", { class: "rk-role", text: role.label })]),
            el("div", { class: "rk-empty-text", text: "기록 없음" }),
            own ? el("button", { class: "secondary-button compact", type: "button", text: "첫 기록 남기기", onclick: () => openForm(role.key) }) : null
        ]);
    }

    const tier = tierOf(latest.tier);
    const trend = trendOf(list);
    const peak = list.reduce((best, record) => (scoreOf(record) > scoreOf(best) ? record : best), list[0]);
    const up = stepRank(latest, 1);
    const down = stepRank(latest, -1);

    return el("article", { class: "rk-card", style: `--tier:${tier.color}` }, [
        el("div", { class: "rk-card-head" }, [
            el("span", { class: "rk-role", text: role.label }),
            el("span", { class: "rk-updated", text: relativeDay(latest.recorded_on) })
        ]),
        el("div", { class: "rk-rank" }, [
            el("span", { class: "rk-tier-dot" }),
            el("strong", { text: rankLabel(latest) }),
            latest.progress !== null ? el("span", { class: "rk-percent", text: `${latest.progress}%` }) : null
        ]),
        latest.progress !== null
            ? el("div", { class: "rk-progress" }, [el("div", { class: "rk-progress-fill", style: `width:${latest.progress}%` })])
            : null,
        el("div", { class: "rk-meta" }, [
            trend ? el("span", { class: `rk-trend ${trend.kind}`, text: trend.text }) : null,
            peak !== latest && scoreOf(peak) > scoreOf(latest)
                ? el("span", { class: "rk-peak", text: `최고 ${rankLabel(peak)}` })
                : null
        ]),
        own ? el("div", { class: "rk-card-actions" }, [
            el("button", {
                class: "rk-step",
                type: "button",
                title: down ? `${rankLabel(down)}(으)로 강등 기록` : "",
                "aria-label": "한 단계 강등 기록",
                disabled: down ? null : "",
                text: "▼",
                onclick: () => quickStep(account, role.key, -1)
            }),
            el("button", { class: "rk-record", type: "button", text: "기록", onclick: () => openForm(role.key) }),
            el("button", {
                class: "rk-step",
                type: "button",
                title: up ? `${rankLabel(up)}(으)로 승급 기록` : "",
                "aria-label": "한 단계 승급 기록",
                disabled: up ? null : "",
                text: "▲",
                onclick: () => quickStep(account, role.key, 1)
            })
        ]) : null
    ]);
}

// --- rank history chart ------------------------------------------------------
//
// One chart component, two uses: the 전체 dashboard (one line per account, for
// a chosen role) and an account page (one line per role). Time runs on x, the
// rank ladder on y, over tinted tier bands so a line reads as a rank at a
// glance.
//
// Drawn without inventing anything between records:
//   - lines are steps — a rank holds until the next record changes it,
//   - a record without a % is a hollow dot at the bottom of its division (the
//     one thing such a record tells us),
//   - the stretch from the last record to today is dashed: assumed, not seen.

const DAY_MS = 86400000;
const ACCOUNT_COLORS = ["#3182f6", "#f04452", "#8b5cf6", "#f59e0b", "#0ea5e9", "#ec4899"];
const ROLE_COLORS = { tank: "#3182f6", damage: "#f04452", support: "#f59e0b", open: "#8b5cf6" };
const RANGES = [
    { value: 30, label: "30일" },
    { value: 90, label: "90일" },
    { value: "all", label: "전체" }
];

let chartRange = "all";
let overviewRole = null;
// charts built during a render, drawn once mounted (they need a real width)
let charts = [];
let chartResizeHandler = null;

function dayTime(record) {
    return parseDay(record.recorded_on).getTime();
}

function rankChart(series) {
    const node = el("div", { class: "rk-chart" });
    charts.push({ node, draw: () => drawRankChart(node, series) });
    return node;
}

function drawCharts() {
    for (const chart of charts) if (chart.node.isConnected) chart.draw();
}

function chartLegend(series) {
    return el("div", { class: "rk-legend" }, series.map((item) => el("span", { class: "rk-legend-item" }, [
        el("span", { class: "rk-legend-swatch", style: `background:${item.color}` }),
        el("span", { text: item.label })
    ])));
}

function rangePicker() {
    return segmented(RANGES, chartRange, (value) => {
        chartRange = value;
        renderBody();
    });
}

// Gridlines on a calendar step: weeks for short spans, months beyond that,
// thinned until labels sit at least minGap px apart.
function timeTicks(start, end, scaleX, minGap) {
    const ticks = [];
    if ((end - start) / DAY_MS <= 60) {
        const first = new Date(start);
        first.setDate(first.getDate() + ((8 - first.getDay()) % 7)); // next Monday
        let every = 7;
        while ((every * DAY_MS / (end - start)) * (scaleX(end) - scaleX(start)) < minGap && every < 56) every += 7;
        for (let t = first.getTime(); t <= end; t += every * DAY_MS) {
            const date = new Date(t);
            ticks.push({ time: t, label: `${date.getMonth() + 1}/${date.getDate()}` });
        }
        return ticks;
    }
    const perMonth = (30.44 * DAY_MS / (end - start)) * (scaleX(end) - scaleX(start));
    const every = [1, 2, 3, 6, 12].find((months) => months * perMonth >= minGap) || 12;
    const first = new Date(start);
    let index = first.getFullYear() * 12 + first.getMonth() + (first.getDate() > 1 ? 1 : 0);
    index = Math.ceil(index / every) * every;
    for (; ; index += every) {
        const year = Math.floor(index / 12);
        const month = index % 12;
        const time = new Date(year, month, 1).getTime();
        if (time > end) break;
        ticks.push({ time, label: month === 0 ? `${year}` : `${month + 1}월` });
    }
    return ticks;
}

function drawRankChart(node, series) {
    const width = node.clientWidth;
    if (!width) return;
    const compact = width < 520;
    const height = compact ? 220 : 270;
    const pad = { top: 12, right: 12, bottom: 26, left: compact ? 46 : 58 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const all = series.flatMap((item) => item.records);
    if (!all.length) {
        node.replaceChildren(el("div", { class: "rk-chart-empty", text: "아직 기록이 없어요." }));
        return;
    }

    const end = parseDay(todayString()).getTime();
    let start = chartRange === "all" ? Math.min(...all.map(dayTime)) : end - chartRange * DAY_MS;
    if (end - start < 7 * DAY_MS) start = end - 7 * DAY_MS;

    // each line enters the window at the rank it last held before the window
    const lines = series
        .map((item) => ({
            ...item,
            before: item.records.filter((record) => dayTime(record) < start).pop() || null,
            inside: item.records.filter((record) => dayTime(record) >= start)
        }))
        .filter((line) => line.before || line.inside.length);
    if (!lines.length) {
        node.replaceChildren(el("div", { class: "rk-chart-empty", text: "이 기간에는 기록이 없어요." }));
        return;
    }

    // y spans whole tiers, so every band shown is complete
    const scores = lines.flatMap((line) => [line.before, ...line.inside].filter(Boolean).map(scoreOf));
    const low = Math.floor(Math.min(...scores) / 5) * 5;
    const high = Math.floor(Math.max(...scores) / 5) * 5 + 5;
    const x = (time) => pad.left + ((time - start) / (end - start)) * plotW;
    const y = (score) => pad.top + plotH - ((score - low) / (high - low)) * plotH;

    const layers = [];
    const tiers = game().tiers;
    const stepPx = plotH / (high - low);

    for (let base = low; base < high; base += 5) {
        const tier = tiers[base / 5];
        if (!tier) continue;
        layers.push(svg("rect", {
            x: pad.left, y: y(base + 5), width: plotW, height: y(base) - y(base + 5),
            fill: tier.color, "fill-opacity": "0.09"
        }));
        // division lines, when there is room to tell them apart
        if (!tier.noDivision && stepPx >= 9) {
            for (let step = 1; step < 5; step += 1) {
                layers.push(svg("line", {
                    x1: pad.left, x2: pad.left + plotW, y1: y(base + step), y2: y(base + step),
                    stroke: tier.color, "stroke-opacity": "0.18", "stroke-dasharray": "2 4"
                }));
            }
        }
        layers.push(svg("line", {
            x1: pad.left, x2: pad.left + plotW, y1: y(base), y2: y(base),
            stroke: tier.color, "stroke-opacity": "0.35"
        }));
        const label = svg("text", {
            x: pad.left - 8, y: (y(base) + y(base + 5)) / 2,
            "text-anchor": "end", "dominant-baseline": "middle",
            fill: tier.color, "font-size": "11", "font-weight": "700"
        });
        label.textContent = tier.short;
        layers.push(label);
    }

    for (const tick of timeTicks(start, end, x, compact ? 52 : 64)) {
        layers.push(svg("line", {
            x1: x(tick.time), x2: x(tick.time), y1: pad.top, y2: pad.top + plotH,
            stroke: "#191f28", "stroke-opacity": "0.06"
        }));
        const label = svg("text", {
            x: x(tick.time), y: height - 8, "text-anchor": "middle",
            fill: "#8b95a1", "font-size": "11", "font-weight": "600"
        });
        label.textContent = tick.label;
        layers.push(label);
    }

    const dots = [];
    for (const line of lines) {
        const points = line.inside.map((record) => ({ record, px: x(dayTime(record)), py: y(scoreOf(record)) }));
        const enterY = line.before ? y(scoreOf(line.before)) : points[0].py;
        let d = line.before ? `M${pad.left},${enterY}` : `M${points[0].px},${points[0].py}`;
        for (const point of line.before ? points : points.slice(1)) d += ` H${point.px} V${point.py}`;
        layers.push(svg("path", {
            d, fill: "none", stroke: line.color, "stroke-width": "2.5",
            "stroke-linejoin": "round", "stroke-linecap": "round"
        }));

        // assumed: from the last record to today
        const last = points[points.length - 1];
        const fromX = last ? last.px : pad.left;
        const fromY = last ? last.py : enterY;
        if (x(end) - fromX > 1) {
            layers.push(svg("path", {
                d: `M${fromX},${fromY} H${x(end)}`, fill: "none", stroke: line.color,
                "stroke-width": "2", "stroke-opacity": "0.5", "stroke-dasharray": "4 4"
            }));
        }

        for (const point of points) {
            const measured = point.record.progress !== null;
            layers.push(svg("circle", {
                cx: point.px, cy: point.py, r: "3.5",
                fill: measured ? line.color : "#ffffff", stroke: line.color, "stroke-width": "2"
            }));
            dots.push({ ...point, line });
        }
    }

    const tooltip = el("div", { class: "tooltip", hidden: "" });
    const chart = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "랭크 추이 그래프" }, layers);
    const showNearest = (event) => {
        const box = node.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        let best = null;
        for (const dot of dots) {
            const distance = Math.hypot(dot.px - px, dot.py - py);
            if (distance <= 26 && (!best || distance < best.distance)) best = { ...dot, distance };
        }
        if (!best) {
            tooltip.hidden = true;
            return;
        }
        const { record } = best;
        tooltip.replaceChildren(
            el("strong", { text: best.line.label }),
            document.createTextNode(`${rankLabel(record)}${record.progress !== null ? ` · ${record.progress}%` : ""} · ${shortDate(record.recorded_on)}`)
        );
        tooltip.hidden = false;
        const half = tooltip.offsetWidth / 2;
        tooltip.style.left = `${Math.min(Math.max(best.px, half), width - half)}px`;
        tooltip.style.top = `${best.py}px`;
        tooltip.classList.toggle("is-below", best.py - tooltip.offsetHeight - 12 < 0);
    };
    chart.addEventListener("pointermove", showNearest);
    chart.addEventListener("pointerdown", showNearest);
    chart.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
    });

    node.replaceChildren(chart, tooltip);
}

// Change from one record to the next on the same account and role.
function changeChip(previous, record) {
    if (!previous) return el("span", { class: "rk-chip flat", text: "첫 기록" });
    const trend = trendOf([previous, record]);
    return el("span", { class: `rk-chip ${trend.kind}`, text: trend.kind === "flat" ? "변동 없음" : trend.text });
}

// previous record on the same account + role, for every record
function previousMap(list) {
    const last = new Map();
    const previous = new Map();
    for (const record of list) {
        const key = `${record.account_id}:${record.role}`;
        previous.set(record.id, last.get(key) || null);
        last.set(key, record);
    }
    return previous;
}

function renderRecentChanges(accountList) {
    const ids = new Set(accountList.map((account) => account.id));
    const mine = records.filter((record) => ids.has(record.account_id));
    if (!mine.length) return null;
    const previous = previousMap(mine);
    const nameOf = new Map(accountList.map((account) => [account.id, account.name]));
    const latest = [...mine].reverse().slice(0, 8);

    return el("section", { class: "rk-feed" }, [
        el("h2", { class: "rk-subtitle", text: "최근 변동" }),
        el("ul", {}, latest.map((record) => {
            const before = previous.get(record.id);
            return el("li", { class: "rk-feed-row" }, [
                el("span", { class: "rk-feed-date", text: shortDate(record.recorded_on) }),
                el("span", { class: "rk-feed-who", text: `${nameOf.get(record.account_id)} · ${roleOf(record.role).label}` }),
                el("span", { class: "rk-feed-rank" }, [
                    before ? el("span", { class: "rk-feed-from", text: `${rankLabel(before)} →` }) : null,
                    el("span", { class: "rk-tier-dot", style: `--tier:${tierOf(record.tier).color}` }),
                    el("strong", { text: rankLabel(record) + (record.progress !== null ? ` · ${record.progress}%` : "") })
                ]),
                changeChip(before, record)
            ]);
        }))
    ]);
}

// Compact form of trendOf for a grid cell.
function compactTrend(list) {
    const trend = trendOf(list);
    if (!trend) return null;
    const text = trend.kind === "flat" ? "–" : trend.text.replace(/\s|단계/g, "");
    return { text, kind: trend.kind };
}

// One screen for every account: per role, the best current rank and which
// account holds it; then an account x role grid of each account's latest
// rank, % and change. "Best" is current standing (latest record per
// account), not an all-time peak — that stays on the account's own cards.
function renderOverview(own) {
    const list = accountsOf(viewerId);
    const roles = game().roles.filter((role) => !role.optional || list.some((account) => recordsFor(account.id, role.key).length > 0));

    const bestScore = new Map();
    for (const role of roles) {
        const scores = list.map((account) => latestFor(account.id, role.key)).filter(Boolean).map(scoreOf);
        if (scores.length) bestScore.set(role.key, Math.max(...scores));
    }
    const isBest = (record) => record && bestScore.get(record.role) === scoreOf(record);

    const summary = el("div", { class: "rk-ov-summary" }, roles.map((role) => {
        const holders = list
            .map((account) => ({ account, record: latestFor(account.id, role.key) }))
            .filter(({ record }) => isBest(record));
        if (!holders.length) {
            return el("div", { class: "rk-ov-best is-empty" }, [
                el("span", { class: "rk-role", text: role.label }),
                el("span", { class: "rk-empty-text", text: "기록 없음" })
            ]);
        }
        const { record } = holders[0];
        return el("div", { class: "rk-ov-best", style: `--tier:${tierOf(record.tier).color}` }, [
            el("span", { class: "rk-role", text: `${role.label} 최고` }),
            el("div", { class: "rk-rank" }, [
                el("span", { class: "rk-tier-dot" }),
                el("strong", { text: rankLabel(record) }),
                record.progress !== null ? el("span", { class: "rk-percent", text: `${record.progress}%` }) : null
            ]),
            el("span", { class: "rk-ov-holder", text: holders.map(({ account }) => account.name).join(", ") }),
            peakLine(list, role, record)
        ]);
    }));

    const head = el("div", { class: "rk-ov-row rk-ov-head", style: `--cols:${roles.length}` }, [
        el("span", { text: "계정" }),
        ...roles.map((role) => el("span", { text: role.label }))
    ]);

    const rows = list.map((account, index) => {
        const all = recordsFor(account.id);
        const last = all[all.length - 1];
        const cells = roles.map((role) => {
            const history = recordsFor(account.id, role.key);
            const latest = history[history.length - 1];
            if (!latest) {
                return el("div", { class: "rk-ov-cell is-empty" }, [
                    el("span", { class: "rk-ov-cell-role", text: role.label }),
                    el("span", { text: "—" })
                ]);
            }
            const trend = compactTrend(history);
            return el("button", {
                type: "button",
                class: `rk-ov-cell${isBest(latest) && list.length > 1 ? " is-best" : ""}`,
                style: `--tier:${tierOf(latest.tier).color}`,
                title: `${account.name} · ${role.label} · ${rankLabel(latest)} (${relativeDay(latest.recorded_on)})`,
                onclick: () => selectAccount(account.id)
            }, [
                el("span", { class: "rk-ov-cell-role", text: role.label }),
                el("span", { class: "rk-ov-cell-rank" }, [el("span", { class: "rk-tier-dot" }), el("strong", { text: rankLabel(latest) })]),
                el("span", { class: "rk-ov-cell-meta" }, [
                    latest.progress !== null ? el("span", { text: `${latest.progress}%` }) : null,
                    trend ? el("span", { class: `rk-trend ${trend.kind}`, text: trend.text }) : null,
                    el("span", { class: "rk-ov-cell-date", text: relativeDay(latest.recorded_on) })
                ])
            ]);
        });

        return el("div", { class: "rk-ov-row", style: `--cols:${roles.length}` }, [
            el("button", { type: "button", class: "rk-ov-account", onclick: () => selectAccount(account.id) }, [
                el("span", { class: "rk-ov-account-name" }, [
                    el("strong", { text: account.name }),
                    el("span", { class: "rk-badge", text: index === 0 ? "본계" : "부계" }),
                    own && !account.is_public ? el("span", { class: "rk-badge muted", text: "비공개" }) : null
                ]),
                el("span", { class: "rk-ov-account-meta", text: last ? `최근 기록 ${relativeDay(last.recorded_on)}` : "기록 없음" })
            ]),
            ...cells
        ]);
    });

    // chart: one line per account, for one role at a time
    const charted = roles.filter((role) => list.some((account) => recordsFor(account.id, role.key).length > 0));
    if (!charted.some((role) => role.key === overviewRole)) overviewRole = charted[0]?.key || null;
    const chartSeries = overviewRole
        ? list
            .map((account, index) => ({
                label: account.name,
                color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
                records: recordsFor(account.id, overviewRole)
            }))
            .filter((item) => item.records.length > 0)
        : [];

    const chartCard = charted.length ? el("section", { class: "rk-chart-card" }, [
        el("div", { class: "rk-chart-head" }, [
            el("h2", { class: "rk-subtitle", text: "랭크 추이" }),
            el("div", { class: "rk-chart-controls" }, [
                segmented(charted.map((role) => ({ value: role.key, label: role.label })), overviewRole, (role) => {
                    overviewRole = role;
                    renderBody();
                }),
                rangePicker()
            ])
        ]),
        chartLegend(chartSeries),
        rankChart(chartSeries)
    ]) : null;

    return el("section", { class: "rk-overview" }, [
        summary,
        chartCard,
        el("h2", { class: "rk-subtitle", text: "현재 현황" }),
        el("div", { class: "rk-ov-table" }, [head, ...rows]),
        renderRecentChanges(list)
    ]);
}

// "역대 최고" on a summary card, when some account once stood higher in that
// role than the best anyone holds now.
function peakLine(list, role, current) {
    const history = list.flatMap((account) => recordsFor(account.id, role.key));
    const peak = history.reduce((best, record) => (!best || scoreOf(record) > scoreOf(best) ? record : best), null);
    if (!peak || scoreOf(peak) <= scoreOf(current)) return null;
    const holder = list.find((account) => account.id === peak.account_id);
    return el("span", { class: "rk-ov-peak", text: `역대 최고 ${rankLabel(peak)} · ${holder.name} · ${shortDate(peak.recorded_on)}` });
}

// account page: one line per role
function renderAccountChart(account) {
    const series = game().roles
        .map((role) => ({ label: role.label, color: ROLE_COLORS[role.key], records: recordsFor(account.id, role.key) }))
        .filter((item) => item.records.length > 0);
    if (!series.length) return null;
    return el("section", { class: "rk-chart-card" }, [
        el("div", { class: "rk-chart-head" }, [
            el("h2", { class: "rk-subtitle", text: "랭크 추이" }),
            el("div", { class: "rk-chart-controls" }, [rangePicker()])
        ]),
        chartLegend(series),
        rankChart(series)
    ]);
}

function renderHistory(account, own) {
    const list = [...recordsFor(account.id)].reverse();
    if (list.length === 0) return null;
    const previous = previousMap(recordsFor(account.id));
    const shown = showFullHistory ? list : list.slice(0, HISTORY_PREVIEW);

    return el("section", { class: "rk-history" }, [
        el("div", { class: "rk-history-title", text: "기록" }),
        el("ul", {}, shown.map((record) => el("li", { class: "rk-history-row", style: `--tier:${tierOf(record.tier).color}` }, [
            el("span", { class: "rk-history-date", text: shortDate(record.recorded_on) }),
            el("span", { class: "rk-history-role", text: roleOf(record.role).label }),
            el("span", { class: "rk-history-rank" }, [
                el("span", { class: "rk-tier-dot" }),
                el("span", { text: rankLabel(record) + (record.progress !== null ? ` · ${record.progress}%` : "") })
            ]),
            changeChip(previous.get(record.id), record),
            own ? el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => deleteRecord(record) }) : null
        ]))),
        list.length > HISTORY_PREVIEW
            ? el("button", {
                class: "text-action",
                type: "button",
                text: showFullHistory ? "접기" : `전체 ${list.length}개 보기`,
                onclick: () => {
                    showFullHistory = !showFullHistory;
                    renderBody();
                }
            })
            : null
    ]);
}

function renderBody() {
    const body = document.getElementById("rkBody");
    if (!body) return;
    const me = sessionUserId();
    const own = isOwnViewer();

    if (!viewerId) {
        body.replaceChildren(el("div", { class: "rk-empty-state" }, [
            el("strong", { text: "아직 공개된 랭크가 없어요" }),
            el("span", { text: "로그인하면 내 오버워치 계정을 추가하고 랭크를 기록할 수 있어요." }),
            el("button", { class: "primary-button compact", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
        ]));
        renderForm();
        return;
    }

    const account = selectedAccount();
    const overview = isOverview();
    const children = [renderPeople()];
    charts = [];

    if (own && accountsOf(viewerId).length === 0) {
        // first visit: getting started is adding an account
        children.push(el("div", { class: "rk-empty-state" }, [
            el("strong", { text: "오버워치 계정을 추가해 보세요" }),
            el("span", { text: "본계와 부계를 따로 추가할 수 있고, 계정마다 공개 여부를 정할 수 있어요." })
        ]), renderAccountEditor());
    } else if (overview) {
        children.push(renderAccounts(own));
        if (own && accountEditor) children.push(renderAccountEditor());
        children.push(renderOverview(own));
    } else if (account) {
        children.push(renderAccounts(own));
        if (own && accountEditor) children.push(renderAccountEditor());
        if (own) children.push(renderAccountTools(account));

        children.push(renderAccountChart(account));
        const roles = game().roles.filter((role) => !role.optional || recordsFor(account.id, role.key).length > 0);
        children.push(el("div", { class: "rk-cards" }, roles.map((role) => renderRoleCard(account, role, own))));
        // the form opens right under the card that opened it, above the history
        if (own) children.push(el("div", { id: "rkForm", class: "rk-form", hidden: "" }));
        children.push(renderHistory(account, own));
    } else {
        children.push(el("div", { class: "empty-line", text: "공개된 계정이 없어요." }));
    }

    if (!me) {
        children.push(el("div", { class: "pdir-login-hint" }, [
            el("span", { text: "로그인하면 내 랭크를 기록할 수 있어요." }),
            el("button", { class: "secondary-button compact", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
        ]));
    }

    body.replaceChildren(...children.filter(Boolean));
    drawCharts();
    if (!own) form = null;
    renderForm();
}

function renderShell() {
    const root = document.getElementById("screen");
    root.replaceChildren(el("section", { class: "page-shell rk-shell" }, [
        el("div", { class: "app-panel" }, [
            el("div", { class: "section-header" }, [
                el("h1", { class: "section-title", text: "랭크" }),
                el("span", { class: "rk-game", text: game().label })
            ]),
            el("div", { id: "rkBody" }),
            el("div", { id: "rkStatus", class: "rk-status" })
        ])
    ]));
}

export function cleanupRanks() {
    if (chartResizeHandler) window.removeEventListener("resize", chartResizeHandler);
    chartResizeHandler = null;
    charts = [];
    form = null;
    accountEditor = null;
    undoRecordId = null;
    showFullHistory = false;
}

export async function renderRanks() {
    cleanupRanks();
    renderShell();
    chartResizeHandler = drawCharts;
    window.addEventListener("resize", chartResizeHandler);

    // revisit: paint what we already have, refresh underneath
    if (people.length > 0) {
        resolveViewer();
        renderBody();
    } else {
        document.getElementById("rkBody").replaceChildren(el("div", { class: "empty-line", text: "불러오는 중..." }));
    }

    try {
        await refresh();
    } catch (error) {
        if (people.length > 0) return;
        document.getElementById("rkBody")?.replaceChildren(el("div", { class: "portfolio-error", text: error.message }));
    }
}
