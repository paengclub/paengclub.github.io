// features/tier.js — 게임 티어, a shared S/A/B/C/D/F tier list. Anyone (even
// logged out) can add a game (image upload to the tier-games bucket) and
// drag/drop it between tiers; positions sync via Supabase realtime + a poll.
// Logged-in members can also rename, re-image or delete a game: 편집 switches
// the board from dragging to picking a game to edit (so a drag can never turn
// into a delete). The database enforces the same split — see
// migrations/20261024_tier_games_edit_delete.sql.
// Exports renderGameTier, cleanupGameTier.
import { supabase } from "/supabaseClient.js";
import { getCurrentSession } from "/features/auth.js";
import { el } from "/lib/dom.js";

const TIERS = [
    { key: "S", label: "S", color: "#ef4444" },
    { key: "A", label: "A", color: "#f97316" },
    { key: "B", label: "B", color: "#eab308" },
    { key: "C", label: "C", color: "#22c55e" },
    { key: "D", label: "D", color: "#3b82f6" },
    { key: "F", label: "F", color: "#8b5cf6" }
];
const POOL_TIER = "unranked";
const MAX_NAME_LENGTH = 40;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const games = new Map();
let gameChannel = null;
let refreshTimer = null;
let addFormOpen = false;
let dragState = null;
let editMode = false;
let editingId = null;

function setStatus(message, type = "") {
    const status = document.getElementById("tierStatus");
    if (!status) return;
    status.className = `tier-status ${type}`;
    status.textContent = message;
}

function sortedGamesForTier(tier) {
    return Array.from(games.values())
        .filter((game) => game.tier === tier)
        .sort((a, b) => a.position - b.position);
}

function imageExtension(file) {
    const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (fromName) return fromName;
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    return "jpg";
}

async function loadGames(showErrors = true) {
    const { data, error } = await supabase.from("tier_games").select("id, name, image_url, tier, position");
    if (error) {
        if (showErrors) setStatus(error.message, "danger");
        return;
    }

    games.clear();
    for (const game of data || []) games.set(game.id, game);
    renderBoard();
    syncEditor();
}

function subscribeGames() {
    if (gameChannel) return;

    gameChannel = supabase
        .channel("shared-tier-list")
        .on("postgres_changes", { event: "*", schema: "public", table: "tier_games" }, (payload) => {
            if (dragState) return;
            if (payload.eventType === "DELETE") games.delete(payload.old.id);
            else games.set(payload.new.id, payload.new);
            renderBoard();
            syncEditor();
        })
        .subscribe();
}

function startPolling() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
        if (document.hidden || dragState) return;
        loadGames(false);
    }, 1500);
}

function nextPoolPosition() {
    const poolGames = sortedGamesForTier(POOL_TIER);
    if (poolGames.length === 0) return 0;
    return poolGames[poolGames.length - 1].position + 1;
}

async function addGame(name, file) {
    const cleanName = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) {
        setStatus("게임 이름을 입력해 주세요.", "danger");
        return false;
    }
    if (!file) {
        setStatus("이미지를 선택해 주세요.", "danger");
        return false;
    }
    if (!file.type.startsWith("image/")) {
        setStatus("이미지 파일만 올릴 수 있어요.", "danger");
        return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
        setStatus("2MB 이하 이미지로 올려 주세요.", "danger");
        return false;
    }

    setStatus("업로드 중...");
    const path = `games/${crypto.randomUUID()}.${imageExtension(file)}`;
    const { error: uploadError } = await supabase.storage
        .from("tier-games")
        .upload(path, file, { cacheControl: "3600" });

    if (uploadError) {
        setStatus(uploadError.message, "danger");
        return false;
    }

    const { data: urlData } = supabase.storage.from("tier-games").getPublicUrl(path);
    const { error: insertError } = await supabase.from("tier_games").insert({
        name: cleanName,
        image_url: urlData.publicUrl,
        tier: POOL_TIER,
        position: nextPoolPosition()
    });

    if (insertError) {
        setStatus(insertError.message, "danger");
        return false;
    }

    setStatus(`"${cleanName}" 추가 완료`, "success");
    await loadGames(false);
    return true;
}

function validImage(file) {
    if (!file.type.startsWith("image/")) {
        setStatus("이미지 파일만 올릴 수 있어요.", "danger");
        return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
        setStatus("2MB 이하 이미지로 올려 주세요.", "danger");
        return false;
    }
    return true;
}

// "…/storage/v1/object/public/tier-games/games/x.png" -> "games/x.png"
function storagePathOf(url) {
    const marker = "/tier-games/";
    const index = (url || "").indexOf(marker);
    return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

// Best effort: a leftover image costs storage, not correctness.
async function removeImage(url) {
    const storagePath = storagePathOf(url);
    if (storagePath) await supabase.storage.from("tier-games").remove([storagePath]);
}

async function saveGame(game, name, file) {
    const cleanName = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) {
        setStatus("게임 이름을 입력해 주세요.", "danger");
        return false;
    }
    if (file && !validImage(file)) return false;

    const changes = { name: cleanName };
    let uploadedPath = null;
    if (file) {
        setStatus("업로드 중...");
        uploadedPath = `games/${crypto.randomUUID()}.${imageExtension(file)}`;
        const { error: uploadError } = await supabase.storage
            .from("tier-games")
            .upload(uploadedPath, file, { cacheControl: "3600" });
        if (uploadError) {
            setStatus(uploadError.message, "danger");
            return false;
        }
        changes.image_url = supabase.storage.from("tier-games").getPublicUrl(uploadedPath).data.publicUrl;
    }

    // .select() so a write RLS silently skipped (0 rows, no error) is caught
    const { data, error } = await supabase.from("tier_games").update(changes).eq("id", game.id).select("id");
    if (error || !data?.length) {
        if (uploadedPath) await supabase.storage.from("tier-games").remove([uploadedPath]);
        // 42501: the database refused the columns (signed out mid-edit)
        const denied = !error || error.code === "42501";
        setStatus(denied ? "수정 권한이 없어요. 다시 로그인해 주세요." : error.message, "danger");
        return false;
    }
    if (changes.image_url) await removeImage(game.image_url);

    setStatus(`"${cleanName}" 수정 완료`, "success");
    editingId = null;
    await loadGames(false);
    return true;
}

async function deleteGame(game) {
    if (!window.confirm(`"${game.name}"을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;
    const { data, error } = await supabase.from("tier_games").delete().eq("id", game.id).select("id");
    if (error || !data?.length) {
        setStatus(error?.message || "삭제 권한이 없어요. 다시 로그인해 주세요.", "danger");
        return;
    }
    await removeImage(game.image_url);
    games.delete(game.id);
    editingId = null;
    setStatus(`"${game.name}" 삭제 완료`, "success");
    renderBoard();
    syncEditor();
    await loadGames(false);
}

function computeDropIndex(dropzone, x, y, excludeId) {
    const items = Array.from(dropzone.querySelectorAll(".tier-item")).filter((node) => node.dataset.gameId !== excludeId);
    for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (y < rect.top) return i;
        if (y <= rect.bottom && x < rect.left + rect.width / 2) return i;
    }
    return items.length;
}

function computePosition(tier, index, excludeId) {
    const siblings = sortedGamesForTier(tier).filter((game) => game.id !== excludeId);
    const before = siblings[index - 1];
    const after = siblings[index];
    if (!before && !after) return 0;
    if (!before) return after.position - 1;
    if (!after) return before.position + 1;
    return (before.position + after.position) / 2;
}

async function persistMove(gameId, tier, position) {
    const { error } = await supabase.from("tier_games").update({ tier, position }).eq("id", gameId);
    if (error) setStatus(error.message, "danger");
}

function clearDragVisuals() {
    document.querySelectorAll(".tier-dropzone.drag-over").forEach((node) => node.classList.remove("drag-over"));
}

function endDrag() {
    if (!dragState) return;
    dragState.ghost?.remove();
    dragState.itemEl?.classList.remove("dragging");
    clearDragVisuals();
    dragState = null;
}

function onPointerMove(event) {
    if (!dragState) return;
    event.preventDefault();

    dragState.ghost.style.left = `${event.clientX - dragState.offsetX}px`;
    dragState.ghost.style.top = `${event.clientY - dragState.offsetY}px`;

    clearDragVisuals();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const dropzone = target?.closest(".tier-dropzone");
    if (dropzone) dropzone.classList.add("drag-over");
}

async function onPointerUp(event) {
    if (!dragState) return;
    const { gameId } = dragState;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const dropzone = target?.closest(".tier-dropzone");
    endDrag();

    if (!dropzone) return;
    const tier = dropzone.dataset.tier;
    const index = computeDropIndex(dropzone, event.clientX, event.clientY, gameId);
    const position = computePosition(tier, index, gameId);

    const game = games.get(gameId);
    if (!game) return;
    if (game.tier === tier && Math.abs(game.position - position) < 1e-9) return;

    games.set(gameId, { ...game, tier, position });
    renderBoard();
    await persistMove(gameId, tier, position);
}

function startDrag(event, gameId, itemEl) {
    event.preventDefault();
    const rect = itemEl.getBoundingClientRect();

    const ghost = itemEl.cloneNode(true);
    ghost.classList.add("tier-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);

    dragState = {
        gameId,
        itemEl,
        ghost,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
    };

    itemEl.classList.add("dragging");
}

function renderTierItem(game) {
    const item = el("div", {
        class: `tier-item${editMode && game.id === editingId ? " is-selected" : ""}`,
        "data-game-id": game.id,
        title: editMode ? `${game.name} 수정` : game.name
    }, [
        el("img", { src: game.image_url, alt: game.name, draggable: "false" }),
        el("span", { class: "tier-item-label", text: game.name }),
        editMode ? el("span", { class: "tier-item-edit", "aria-hidden": "true", text: "✎" }) : null
    ]);

    item.addEventListener("pointerdown", (event) => {
        if (editMode) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        startDrag(event, game.id, item);
    });
    item.addEventListener("click", () => {
        if (!editMode) return;
        editingId = game.id;
        renderBoard();
        syncEditor(true);
    });

    return item;
}

function renderTierRow(tierDef) {
    const rowGames = sortedGamesForTier(tierDef.key);
    const dropzone = el("div", {
        class: "tier-dropzone",
        "data-tier": tierDef.key
    }, rowGames.map(renderTierItem));

    return el("div", { class: "tier-row" }, [
        el("div", { class: "tier-label", style: `background:${tierDef.color}`, text: tierDef.label }),
        dropzone
    ]);
}

function renderPoolRow() {
    const poolGames = sortedGamesForTier(POOL_TIER);
    const dropzone = el("div", {
        class: "tier-dropzone tier-pool-zone",
        "data-tier": POOL_TIER
    }, poolGames.length ? poolGames.map(renderTierItem) : [el("span", { class: "empty-line", text: "미분류 게임 없음" })]);

    return el("div", { class: "tier-row tier-pool" }, [
        el("div", { class: "tier-label tier-label-pool", text: "미분류" }),
        dropzone
    ]);
}

function renderBoard() {
    const board = document.getElementById("tierBoard");
    if (!board) return;
    board.classList.toggle("is-editing", editMode);
    board.replaceChildren(...TIERS.map(renderTierRow), renderPoolRow());
}

function setEditMode(on) {
    if (on && !getCurrentSession()) {
        setStatus("게임 수정·삭제는 로그인 후 할 수 있어요.", "danger");
        return;
    }
    editMode = on;
    editingId = null;
    const toggle = document.getElementById("tierEditToggle");
    if (toggle) {
        toggle.textContent = editMode ? "완료" : "편집";
        toggle.classList.toggle("active", editMode);
    }
    if (editMode) toggleAddForm(false);
    setStatus("");
    renderBoard();
    syncEditor();
}

// The edit panel: a hint until a game is picked, then that game's form. Only
// rebuilt when the picked game changes (or vanishes), so a poll refresh never
// wipes what you're typing.
let editorFor = undefined;

function syncEditor(force = false) {
    const target = document.getElementById("tierEditPanel");
    if (!target) return;
    if (editingId && !games.has(editingId)) editingId = null;
    target.hidden = !editMode;
    const key = editMode ? editingId : undefined;
    if (!force && key === editorFor) return;
    editorFor = key;

    if (!editMode) {
        target.replaceChildren();
        return;
    }
    const game = editingId && games.get(editingId);
    if (!game) {
        target.replaceChildren(el("div", { class: "tier-edit-hint", text: "수정하거나 삭제할 게임을 눌러 주세요." }));
        return;
    }

    const preview = el("img", { class: "tier-edit-preview", src: game.image_url, alt: "" });
    const nameInput = el("input", { type: "text", class: "form-control", maxlength: String(MAX_NAME_LENGTH), value: game.name });
    const fileInput = el("input", { type: "file", class: "form-control", accept: "image/*" });
    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) preview.src = URL.createObjectURL(file);
    });
    const save = el("button", {
        class: "primary-button",
        type: "button",
        text: "저장",
        onclick: async () => {
            save.disabled = true;
            await saveGame(game, nameInput.value, fileInput.files?.[0]);
            save.disabled = false;
        }
    });

    target.replaceChildren(el("div", { class: "tier-edit-body" }, [
        preview,
        el("div", { class: "tier-edit-fields" }, [
            el("label", { class: "tier-edit-field" }, [el("span", { text: "이름" }), nameInput]),
            el("label", { class: "tier-edit-field" }, [el("span", { text: "이미지 교체 (선택)" }), fileInput]),
            el("div", { class: "tier-edit-actions" }, [
                save,
                el("button", {
                    class: "secondary-button",
                    type: "button",
                    text: "취소",
                    onclick: () => {
                        editingId = null;
                        renderBoard();
                        syncEditor();
                    }
                }),
                el("button", { class: "secondary-button danger", type: "button", text: "삭제", onclick: () => deleteGame(game) })
            ])
        ])
    ]));
}

function toggleAddForm(open) {
    addFormOpen = open;
    const form = document.getElementById("tierAddForm");
    if (form) form.classList.toggle("open", addFormOpen);
}

function renderAddForm() {
    const nameInput = el("input", {
        type: "text",
        class: "form-control",
        placeholder: "게임 이름",
        maxlength: String(MAX_NAME_LENGTH)
    });
    const fileInput = el("input", {
        type: "file",
        class: "form-control",
        accept: "image/*"
    });
    const submit = el("button", {
        class: "primary-button",
        type: "button",
        text: "추가",
        onclick: async () => {
            submit.disabled = true;
            const ok = await addGame(nameInput.value, fileInput.files?.[0]);
            submit.disabled = false;
            if (ok) {
                nameInput.value = "";
                fileInput.value = "";
                toggleAddForm(false);
            }
        }
    });
    const cancel = el("button", {
        class: "secondary-button",
        type: "button",
        text: "취소",
        onclick: () => toggleAddForm(false)
    });

    return el("div", { id: "tierAddForm", class: "tier-add-form" }, [
        el("div", { class: "tier-add-row" }, [nameInput, fileInput]),
        el("div", { class: "tier-add-actions" }, [submit, cancel])
    ]);
}

function teardown() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
    if (gameChannel) {
        supabase.removeChannel(gameChannel);
        gameChannel = null;
    }
    endDrag();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    // transient UI: every visit starts out of edit mode with forms closed
    editMode = false;
    editingId = null;
    editorFor = undefined;
    addFormOpen = false;
}

export function cleanupGameTier() {
    teardown();
}

export async function renderGameTier() {
    teardown();
    const root = document.getElementById("screen");
    if (!root) return;

    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell tier-shell" });
    const panel = el("div", { class: "app-panel tier-panel" });

    panel.append(
        el("div", { class: "section-header" }, [
            el("h1", { class: "section-title", text: "게임 티어" }),
            el("div", { class: "tier-header-actions" }, [
                el("button", {
                    id: "tierEditToggle",
                    class: "secondary-button",
                    type: "button",
                    text: "편집",
                    onclick: () => setEditMode(!editMode)
                }),
                el("button", {
                    class: "secondary-button",
                    type: "button",
                    text: "+ 게임 추가",
                    onclick: () => {
                        if (editMode) setEditMode(false);
                        toggleAddForm(!addFormOpen);
                    }
                })
            ])
        ]),
        renderAddForm(),
        el("div", { id: "tierEditPanel", class: "tier-edit-panel", hidden: "" }),
        el("div", { id: "tierStatus", class: "tier-status", text: "" }),
        el("div", { id: "tierBoard", class: "tier-board" })
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    renderBoard();
    subscribeGames();
    startPolling();
    await loadGames();
}
