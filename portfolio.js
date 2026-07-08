import { getCurrentSession, signInWithGoogle } from "/board.js";
import { supabase } from "/supabaseClient.js";

const DEFAULT_CATEGORIES = [
    { name: "국내주식", color: "#315f4d" },
    { name: "미국주식", color: "#2f7dd3" },
    { name: "ETF", color: "#8b5cf6" },
    { name: "현금", color: "#d16a45" }
];
const EVENT_TYPES = {
    buy: "매수",
    sell: "매도",
    dividend: "배당",
    deposit: "입금",
    withdrawal: "출금",
    fee: "수수료",
    note: "메모"
};

let state = {
    snapshots: [],
    categories: [],
    events: [],
    activeSnapshotId: "",
    draftHoldings: [],
    loading: false,
    error: ""
};
let resizeHandler = null;

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
    }
    return node;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function num(value) {
    const parsed = Number(String(value ?? "").replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
    return Math.round(num(value) * 100) / 100;
}

function money(value) {
    return new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: Math.abs(num(value)) >= 1000 ? 0 : 2
    }).format(num(value));
}

function pct(value) {
    if (!Number.isFinite(value)) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function holdingValue(holding) {
    const explicit = num(holding.market_value);
    if (explicit > 0 || (num(holding.price) === 0 && num(holding.quantity) === 0)) return explicit;
    return roundMoney(num(holding.price) * num(holding.quantity));
}

function holdingCost(holding) {
    return roundMoney(num(holding.avg_cost) * num(holding.quantity));
}

function snapshotTotal(snapshot) {
    return (snapshot?.portfolio_holdings || []).reduce((sum, holding) => sum + holdingValue(holding), 0);
}

function snapshotCost(snapshot) {
    return (snapshot?.portfolio_holdings || []).reduce((sum, holding) => sum + holdingCost(holding), 0);
}

function activeSnapshot() {
    return state.snapshots.find((snapshot) => snapshot.id === state.activeSnapshotId) || state.snapshots[0] || null;
}

function sortedSnapshots() {
    return [...state.snapshots].sort((a, b) => {
        const dateDiff = new Date(b.as_of_date).getTime() - new Date(a.as_of_date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

function categoryColor(name) {
    return state.categories.find((category) => category.name === name)?.color || "#72776b";
}

function emptyHolding(sortOrder = 0) {
    return {
        id: crypto.randomUUID(),
        name: "",
        category: state.categories[0]?.name || "미분류",
        price: 0,
        quantity: 0,
        market_value: 0,
        avg_cost: 0,
        memo: "",
        sort_order: sortOrder
    };
}

function setStatus(message, type = "") {
    const status = document.getElementById("portfolioStatus");
    if (!status) return;
    status.className = `portfolio-status ${type}`;
    status.textContent = message;
}

function renderLoginRequired(root) {
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell portfolio-shell" });
    const panel = el("div", { class: "app-panel portfolio-login-panel" }, [
        el("h1", { class: "section-title", text: "주식 분석" }),
        el("p", { class: "muted-text", text: "개인 포트폴리오 데이터는 로그인한 본인에게만 보입니다." }),
        el("button", { class: "primary-button", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
    ]);
    wrapper.appendChild(panel);
    wrapper.appendChild(el("div", { class: "portfolio-footnote", text: "그냥 내가 쓰려고 만든 기능" }));
    root.appendChild(wrapper);
}

async function ensureDefaultCategories() {
    if (state.categories.length > 0) return;
    const rows = DEFAULT_CATEGORIES.map((category, index) => ({
        ...category,
        sort_order: index
    }));
    await supabase.from("portfolio_categories").upsert(rows, { onConflict: "user_id,name" });
}

async function loadPortfolioData(preferredSnapshotId = state.activeSnapshotId) {
    const [snapshotsResult, categoriesResult, eventsResult] = await Promise.all([
        supabase
            .from("portfolio_snapshots")
            .select(`
                id,
                user_id,
                label,
                as_of_date,
                note,
                created_at,
                portfolio_holdings(
                    id,
                    symbol,
                    name,
                    category,
                    price,
                    quantity,
                    avg_cost,
                    market_value,
                    memo,
                    sort_order
                )
            `)
            .order("as_of_date", { ascending: false })
            .order("created_at", { ascending: false }),
        supabase
            .from("portfolio_categories")
            .select("id, name, color, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),
        supabase
            .from("portfolio_events")
            .select("id, event_date, symbol, event_type, quantity, price, amount, memo, created_at")
            .order("event_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(40)
    ]);

    if (snapshotsResult.error) throw snapshotsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;
    if (eventsResult.error) throw eventsResult.error;

    state.snapshots = sortedByDate(snapshotsResult.data || []);
    state.categories = categoriesResult.data || [];
    state.events = eventsResult.data || [];

    if (state.categories.length === 0) {
        await ensureDefaultCategories();
        const { data, error } = await supabase
            .from("portfolio_categories")
            .select("id, name, color, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });
        if (error) throw error;
        state.categories = data || [];
    }

    const preferred = state.snapshots.find((snapshot) => snapshot.id === preferredSnapshotId);
    state.activeSnapshotId = preferred?.id || state.snapshots[0]?.id || "";
    state.draftHoldings = normalizeDraft(activeSnapshot()?.portfolio_holdings || []);
}

function sortedByDate(snapshots) {
    return [...snapshots].sort((a, b) => {
        const dateDiff = new Date(b.as_of_date).getTime() - new Date(a.as_of_date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}

function normalizeDraft(holdings) {
    return [...holdings]
        .sort((a, b) => num(a.sort_order) - num(b.sort_order))
        .map((holding, index) => ({
            id: holding.id || crypto.randomUUID(),
            name: holding.name || "",
            category: holding.category || "미분류",
            price: num(holding.price),
            quantity: num(holding.quantity),
            market_value: holdingValue(holding),
            avg_cost: num(holding.avg_cost),
            memo: holding.memo || "",
            sort_order: index
        }));
}

async function createSnapshot({ copyActive = false } = {}) {
    const session = getCurrentSession();
    if (!session) return;
    const base = activeSnapshot();
    if (copyActive && !base) {
        setStatus("복사할 시점이 없어요. 먼저 첫 시점을 만들어 주세요.", "danger");
        return;
    }
    const label = copyActive && base ? `${base.label || base.as_of_date} 복사본` : "새 시점";

    const { data, error } = await supabase
        .from("portfolio_snapshots")
        .insert({
            user_id: session.user.id,
            label,
            as_of_date: today(),
            note: copyActive && base ? `${base.as_of_date} 기준 복사` : ""
        })
        .select("id")
        .single();
    if (error) {
        setStatus(error.message, "danger");
        return;
    }

    if (copyActive && base) {
        const copied = (base.portfolio_holdings || []).map((holding, index) => ({
            snapshot_id: data.id,
            user_id: session.user.id,
            symbol: "",
            name: holding.name || "",
            category: holding.category || "미분류",
            price: num(holding.price),
            quantity: num(holding.quantity),
            market_value: holdingValue(holding),
            avg_cost: num(holding.avg_cost),
            memo: holding.memo || "",
            sort_order: index
        }));
        if (copied.length > 0) {
            const { error: copyError } = await supabase.from("portfolio_holdings").insert(copied);
            if (copyError) {
                setStatus(copyError.message, "danger");
                return;
            }
        }
    }

    await refresh(data.id, copyActive ? "이전 시점을 복사했어요." : "새 시점을 만들었어요.");
}

function snapshotMetaPayload() {
    return {
        label: document.getElementById("portfolioSnapshotLabel")?.value.trim() || "",
        as_of_date: document.getElementById("portfolioSnapshotDate")?.value || today(),
        note: document.getElementById("portfolioSnapshotNote")?.value.trim() || ""
    };
}

async function saveSnapshotMeta({ refreshAfter = true } = {}) {
    const snapshot = activeSnapshot();
    if (!snapshot) return false;

    const { error } = await supabase
        .from("portfolio_snapshots")
        .update(snapshotMetaPayload())
        .eq("id", snapshot.id);
    if (error) {
        setStatus(error.message, "danger");
        return false;
    }
    if (refreshAfter) await refresh(snapshot.id, "저장했어요.");
    return true;
}

async function deleteSnapshot() {
    const snapshot = activeSnapshot();
    if (!snapshot) return;
    if (!window.confirm("현재 시점과 보유 종목을 삭제할까요?")) return;

    const { error: holdingsError } = await supabase.from("portfolio_holdings").delete().eq("snapshot_id", snapshot.id);
    if (holdingsError) {
        setStatus(holdingsError.message, "danger");
        return;
    }
    const { error } = await supabase.from("portfolio_snapshots").delete().eq("id", snapshot.id);
    if (error) {
        setStatus(error.message, "danger");
        return;
    }
    await refresh("", "시점을 삭제했어요.");
}

async function saveHoldings({ refreshAfter = true } = {}) {
    const session = getCurrentSession();
    const snapshot = activeSnapshot();
    if (!session || !snapshot) return false;

    const rows = state.draftHoldings
        .map((holding, index) => ({
            snapshot_id: snapshot.id,
            user_id: session.user.id,
            symbol: "",
            name: holding.name.trim().slice(0, 60),
            category: (holding.category.trim() || "미분류").slice(0, 40),
            price: roundMoney(holding.price),
            quantity: num(holding.quantity),
            market_value: roundMoney(holdingValue(holding)),
            avg_cost: roundMoney(holding.avg_cost),
            memo: holding.memo.trim().slice(0, 300),
            sort_order: index
        }))
        .filter((holding) => holding.name || holding.market_value > 0);

    try {
        await ensureCategoriesFromHoldings(rows);
    } catch (error) {
        setStatus(error.message, "danger");
        return false;
    }
    const { error: deleteError } = await supabase.from("portfolio_holdings").delete().eq("snapshot_id", snapshot.id);
    if (deleteError) {
        setStatus(deleteError.message, "danger");
        return false;
    }
    if (rows.length > 0) {
        const { error } = await supabase.from("portfolio_holdings").insert(rows);
        if (error) {
            setStatus(error.message, "danger");
            return false;
        }
    }
    if (refreshAfter) await refresh(snapshot.id, "저장했어요.");
    return true;
}

async function savePortfolio() {
    const snapshot = activeSnapshot();
    if (!snapshot) {
        setStatus("먼저 시점을 만들어 주세요.", "danger");
        return;
    }
    const metaSaved = await saveSnapshotMeta({ refreshAfter: false });
    if (!metaSaved) return;
    const holdingsSaved = await saveHoldings({ refreshAfter: false });
    if (!holdingsSaved) return;
    await refresh(snapshot.id, "저장했어요.");
}

async function ensureCategoriesFromHoldings(rows) {
    const session = getCurrentSession();
    if (!session) return;
    const existing = new Set(state.categories.map((category) => category.name));
    const missing = [...new Set(rows.map((row) => row.category).filter(Boolean))]
        .filter((name) => !existing.has(name));
    if (missing.length === 0) return;

    const { error } = await supabase.from("portfolio_categories").upsert(
        missing.map((name, index) => ({
            user_id: session.user.id,
            name,
            color: paletteColor(state.categories.length + index),
            sort_order: state.categories.length + index
        })),
        { onConflict: "user_id,name" }
    );
    if (error) throw error;
}

async function addCategory() {
    const session = getCurrentSession();
    if (!session) return;
    const input = document.getElementById("portfolioNewCategory");
    const name = input?.value.trim().slice(0, 40);
    if (!name) return;
    const { data, error } = await supabase.from("portfolio_categories").upsert({
        user_id: session.user.id,
        name,
        color: paletteColor(state.categories.length),
        sort_order: state.categories.length
    }, { onConflict: "user_id,name" }).select("id, name, color, sort_order").single();
    if (error) {
        setStatus(error.message, "danger");
        return;
    }
    if (!state.categories.some((category) => category.name === name)) {
        state.categories = [...state.categories, data || {
            id: crypto.randomUUID(),
            name,
            color: paletteColor(state.categories.length),
            sort_order: state.categories.length
        }];
    }
    if (input) input.value = "";
    renderLoaded();
    setStatus("분류를 추가했어요.", "success");
}

function paletteColor(index) {
    return ["#315f4d", "#2f7dd3", "#d16a45", "#8b5cf6", "#16a34a", "#be123c", "#0f766e"][index % 7];
}

async function saveEvent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
        event_date: form.event_date.value || today(),
        event_type: form.event_type.value,
        symbol: form.symbol.value.trim().slice(0, 60),
        quantity: num(form.quantity.value),
        price: roundMoney(form.price.value),
        amount: roundMoney(form.amount.value || num(form.quantity.value) * num(form.price.value)),
        memo: form.memo.value.trim().slice(0, 500)
    };
    if (!payload.symbol && payload.event_type !== "deposit" && payload.event_type !== "withdrawal") {
        setStatus("종목 또는 내용을 입력해 주세요.", "danger");
        return;
    }
    if (!payload.symbol) payload.symbol = EVENT_TYPES[payload.event_type];

    const { error } = await supabase.from("portfolio_events").insert(payload);
    if (error) {
        setStatus(error.message, "danger");
        return;
    }
    form.reset();
    form.event_date.value = today();
    await refresh(state.activeSnapshotId, "변동사항을 기록했어요.");
}

async function deleteEvent(id) {
    const { error } = await supabase.from("portfolio_events").delete().eq("id", id);
    if (error) {
        setStatus(error.message, "danger");
        return;
    }
    await refresh(state.activeSnapshotId, "변동사항을 삭제했어요.");
}

async function refresh(snapshotId = state.activeSnapshotId, message = "") {
    try {
        await loadPortfolioData(snapshotId);
        renderLoaded();
        if (message) setStatus(message, "success");
    } catch (error) {
        setStatus(error.message, "danger");
    }
}

function renderShell() {
    const root = document.getElementById("screen");
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell portfolio-shell" });
    const panel = el("div", { class: "app-panel portfolio-panel" });
    wrapper.appendChild(panel);
    root.appendChild(wrapper);
    return panel;
}

function renderLoading() {
    const panel = renderShell();
    panel.append(
        el("div", { class: "section-header" }, [
            el("div", {}, [el("h1", { class: "section-title", text: "주식 분석" })])
        ]),
        el("div", { class: "portfolio-loading", text: "불러오는 중..." })
    );
}

function renderLoaded() {
    const panel = renderShell();
    const snapshot = activeSnapshot();
    const total = state.draftHoldings.reduce((sum, holding) => sum + holdingValue(holding), 0);
    const cost = state.draftHoldings.reduce((sum, holding) => sum + holdingCost(holding), 0);
    const pnl = total - cost;
    const previous = previousSnapshot(snapshot);
    const previousTotal = previous ? snapshotTotal(previous) : 0;
    const totalChange = previous ? total - previousTotal : 0;

    panel.append(
        renderHeader(),
        el("div", { id: "portfolioStatus", class: "portfolio-status" }),
        state.snapshots.length === 0 ? renderEmptyState() : el("div", { class: "portfolio-grid" }, [
            el("section", { class: "portfolio-main" }, [
                renderKpis({ total, cost, pnl, totalChange, previous }),
                renderSnapshotEditor(snapshot),
                renderHoldingsEditor(total),
                renderEvents()
            ]),
            el("aside", { class: "portfolio-side" }, [
                renderAllocation(total),
                renderTrend(),
                renderInsights({ total, cost, pnl, previous, previousTotal })
            ])
        ]),
        el("div", { class: "portfolio-footnote", text: "그냥 내가 쓰려고 만든 기능" })
    );

    window.requestAnimationFrame(drawPortfolioTrend);
}

function renderHeader() {
    const actions = state.snapshots.length > 0 ? [
        el("button", { class: "secondary-button compact", type: "button", text: "현재 시점 복사", onclick: () => createSnapshot({ copyActive: true }) }),
        el("button", { class: "primary-button compact", type: "button", text: "저장", onclick: savePortfolio })
    ] : [];

    return el("div", { class: "section-header portfolio-header" }, [
        el("div", {}, [
            el("h1", { class: "section-title", text: "주식 분석" }),
            el("div", { class: "muted-text", text: "시점별 포트폴리오와 변동사항을 개인 기록으로 관리" })
        ]),
        el("div", { class: "portfolio-header-actions" }, actions)
    ]);
}

function renderEmptyState() {
    return el("div", { class: "portfolio-empty" }, [
        el("strong", { text: "첫 포트폴리오 시점을 만들어 주세요." }),
        el("span", { text: "예: 2026년 7월 말 기준 보유 종목을 입력하고, 다음 달에는 복사해서 달라진 값만 수정하면 됩니다." }),
        el("button", { class: "primary-button", type: "button", text: "첫 시점 만들기", onclick: () => createSnapshot() })
    ]);
}

function renderKpis({ total, cost, pnl, totalChange, previous }) {
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : NaN;
    const changePct = previous && snapshotTotal(previous) > 0 ? (totalChange / snapshotTotal(previous)) * 100 : NaN;
    return el("div", { class: "portfolio-kpis" }, [
        renderKpi("평가금액", `${money(total)}원`, previous ? `${previous.as_of_date} 대비 ${money(totalChange)}원` : "첫 시점"),
        renderKpi("투자원금", `${money(cost)}원`, cost > 0 ? `평가손익 ${money(pnl)}원` : "평단 입력 시 계산"),
        renderKpi("수익률", Number.isFinite(pnlPct) ? pct(pnlPct) : "-", "평단 기준"),
        renderKpi("전 시점 변화", previous ? pct(changePct) : "-", previous ? previous.label || previous.as_of_date : "비교 대상 없음")
    ]);
}

function renderKpi(label, value, helper) {
    return el("div", { class: "portfolio-kpi" }, [
        el("span", { text: label }),
        el("strong", { text: value }),
        el("small", { text: helper })
    ]);
}

function renderSnapshotEditor(snapshot) {
    return el("section", { class: "portfolio-block" }, [
        el("div", { class: "portfolio-block-title" }, [
            el("h2", { text: "시점" }),
            el("select", {
                class: "form-control portfolio-snapshot-select",
                onchange: (event) => {
                    state.activeSnapshotId = event.target.value;
                    state.draftHoldings = normalizeDraft(activeSnapshot()?.portfolio_holdings || []);
                    renderLoaded();
                }
            }, sortedSnapshots().map((item) => el("option", {
                value: item.id,
                text: `${item.as_of_date} · ${item.label || "무제"}`,
                selected: item.id === snapshot.id ? "" : null
            })))
        ]),
        el("div", { class: "portfolio-snapshot-form" }, [
            el("input", { id: "portfolioSnapshotDate", class: "form-control", type: "date", value: snapshot.as_of_date }),
            el("input", { id: "portfolioSnapshotLabel", class: "form-control", maxlength: "60", placeholder: "라벨", value: snapshot.label || "" }),
            el("input", { id: "portfolioSnapshotNote", class: "form-control", maxlength: "500", placeholder: "메모", value: snapshot.note || "" }),
            el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: deleteSnapshot })
        ])
    ]);
}

function renderHoldingsEditor(total) {
    return el("section", { class: "portfolio-block" }, [
        el("div", { class: "portfolio-block-title" }, [
            el("h2", { text: "보유 종목" }),
            el("div", { class: "portfolio-inline-actions" }, [
                el("input", { id: "portfolioNewCategory", class: "form-control", placeholder: "새 분류" }),
                el("button", { class: "secondary-button compact", type: "button", text: "분류 추가", onclick: addCategory }),
                el("button", { class: "secondary-button compact", type: "button", text: "종목 추가", onclick: addHoldingRow })
            ])
        ]),
        el("datalist", { id: "portfolioCategoryOptions" }, state.categories.map((category) => el("option", { value: category.name }))),
        renderHoldingsTable(total)
    ]);
}

function renderHoldingsTable(total) {
    const rows = state.draftHoldings.length > 0 ? state.draftHoldings : [emptyHolding()];
    if (state.draftHoldings.length === 0) state.draftHoldings = rows;

    return el("div", { class: "portfolio-table-wrap" }, [
        el("table", { class: "portfolio-table" }, [
            el("thead", {}, [
                el("tr", {}, ["종목", "분류", "단가", "수량", "평가금액", "비율", "평단", "손익", ""].map((text) => el("th", { text })))
            ]),
            el("tbody", {}, rows.map((holding, index) => renderHoldingRow(holding, index, total)))
        ])
    ]);
}

function renderHoldingRow(holding, index, total) {
    const value = holdingValue(holding);
    const cost = holdingCost(holding);
    const gain = cost > 0 ? value - cost : 0;
    return el("tr", { "data-holding-index": String(index) }, [
        el("td", {}, [
            el("input", { class: "form-control", placeholder: "종목명", value: holding.name, oninput: (event) => updateHolding(index, "name", event.target.value) })
        ]),
        el("td", {}, [el("input", { class: "form-control", list: "portfolioCategoryOptions", value: holding.category, oninput: (event) => updateHolding(index, "category", event.target.value) })]),
        el("td", {}, [moneyInput(holding.price, (valueInput) => updateCalculatedHolding(index, "price", valueInput), "portfolio-price-input")]),
        el("td", {}, [moneyInput(holding.quantity, (valueInput) => updateCalculatedHolding(index, "quantity", valueInput), "portfolio-quantity-input")]),
        el("td", {}, [moneyInput(value, (valueInput) => updateCalculatedHolding(index, "market_value", valueInput), "portfolio-value-input")]),
        el("td", { class: "portfolio-ratio-cell", text: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "-" }),
        el("td", {}, [moneyInput(holding.avg_cost, (valueInput) => {
            updateHolding(index, "avg_cost", num(valueInput));
            syncDraftMetrics();
        }, "portfolio-cost-input")]),
        el("td", { class: `portfolio-gain portfolio-gain-cell ${gain >= 0 ? "plus" : "minus"}`, text: cost > 0 ? money(gain) : "-" }),
        el("td", {}, [el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => removeHoldingRow(index) })])
    ]);
}

function moneyInput(value, oninput, extraClass = "") {
    const apply = (event) => oninput(event.target.value);
    return el("input", {
        class: `form-control numeric-input ${extraClass}`.trim(),
        type: "text",
        inputmode: "decimal",
        value: value || "",
        onchange: apply
    });
}

function updateHolding(index, key, value) {
    state.draftHoldings[index][key] = value;
}

function updateCalculatedHolding(index, key, value) {
    const holding = state.draftHoldings[index];
    holding[key] = num(value);
    if ((key === "price" || key === "quantity") && num(holding.price) >= 0 && num(holding.quantity) >= 0) {
        holding.market_value = roundMoney(num(holding.price) * num(holding.quantity));
    }
    if (key === "market_value" && num(holding.quantity) > 0) {
        holding.price = roundMoney(num(holding.market_value) / num(holding.quantity));
    }
    syncDraftMetrics();
}

function syncDraftMetrics() {
    const total = state.draftHoldings.reduce((sum, holding) => sum + holdingValue(holding), 0);
    const activeElement = document.activeElement;

    document.querySelectorAll("[data-holding-index]").forEach((row) => {
        const index = Number(row.dataset.holdingIndex);
        const holding = state.draftHoldings[index];
        if (!holding) return;

        const value = holdingValue(holding);
        const cost = holdingCost(holding);
        const gain = cost > 0 ? value - cost : 0;
        const updates = [
            [".portfolio-price-input", holding.price],
            [".portfolio-quantity-input", holding.quantity],
            [".portfolio-value-input", value],
            [".portfolio-cost-input", holding.avg_cost]
        ];

        for (const [selector, nextValue] of updates) {
            const input = row.querySelector(selector);
            if (input && input !== activeElement) input.value = nextValue || "";
        }

        const ratioCell = row.querySelector(".portfolio-ratio-cell");
        if (ratioCell) ratioCell.textContent = total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "-";

        const gainCell = row.querySelector(".portfolio-gain-cell");
        if (gainCell) {
            gainCell.textContent = cost > 0 ? money(gain) : "-";
            gainCell.className = `portfolio-gain portfolio-gain-cell ${gain >= 0 ? "plus" : "minus"}`;
        }
    });
}

function addHoldingRow() {
    state.draftHoldings.push(emptyHolding(state.draftHoldings.length));
    renderLoaded();
}

function removeHoldingRow(index) {
    state.draftHoldings.splice(index, 1);
    renderLoaded();
}

function renderAllocation(total) {
    const allocation = categoryAllocation(state.draftHoldings);
    return el("section", { class: "portfolio-side-block" }, [
        el("h2", { class: "side-title", text: "분류 비중" }),
        allocation.length === 0 ? el("div", { class: "empty-line", text: "보유 종목 없음" }) : el("div", { class: "allocation-list" }, allocation.map((item) => {
            const ratio = total > 0 ? (item.value / total) * 100 : 0;
            return el("div", { class: "allocation-row" }, [
                el("div", { class: "allocation-line" }, [
                    el("span", { text: item.category }),
                    el("strong", { text: `${ratio.toFixed(1)}%` })
                ]),
                el("div", { class: "allocation-bar" }, [
                    el("span", { style: `width:${Math.max(ratio, 2)}%;background:${categoryColor(item.category)}` })
                ]),
                el("small", { text: `${money(item.value)}원` })
            ]);
        }))
    ]);
}

function categoryAllocation(holdings) {
    const map = new Map();
    for (const holding of holdings) {
        const key = holding.category || "미분류";
        map.set(key, (map.get(key) || 0) + holdingValue(holding));
    }
    return [...map.entries()]
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => b.value - a.value);
}

function renderTrend() {
    return el("section", { class: "portfolio-side-block" }, [
        el("h2", { class: "side-title", text: "총액 변화" }),
        el("canvas", { id: "portfolioTrendCanvas", class: "portfolio-trend-canvas", "aria-label": "시점별 평가금액 변화 그래프" })
    ]);
}

function drawPortfolioTrend() {
    const canvas = document.getElementById("portfolioTrendCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const points = [...state.snapshots]
        .sort((a, b) => new Date(a.as_of_date).getTime() - new Date(b.as_of_date).getTime())
        .map((snapshot) => ({ label: snapshot.as_of_date, value: snapshotTotal(snapshot) }));
    if (points.length === 0) return;

    const pad = { left: 10, right: 12, top: 16, bottom: 24 };
    const values = points.map((point) => point.value);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const span = Math.max(max - min, 1);
    const x = (index) => pad.left + (points.length === 1 ? 0.5 : index / (points.length - 1)) * (rect.width - pad.left - pad.right);
    const y = (value) => pad.top + (1 - (value - min) / span) * (rect.height - pad.top - pad.bottom);

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--app-line");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, rect.height - pad.bottom);
    ctx.lineTo(rect.width - pad.right, rect.height - pad.bottom);
    ctx.stroke();

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--app-primary").trim();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(x(index), y(point.value));
        else ctx.lineTo(x(index), y(point.value));
    });
    ctx.stroke();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--app-primary").trim();
    points.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(x(index), y(point.value), 3.5, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--app-muted").trim();
    ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(money(max), pad.left, 4);
    ctx.textAlign = "right";
    ctx.fillText(points[points.length - 1]?.label || "", rect.width - pad.right, rect.height - 16);
}

function renderInsights({ total, cost, pnl, previous, previousTotal }) {
    const snapshot = activeSnapshot();
    const biggest = categoryAllocation(state.draftHoldings)[0];
    const largestHolding = [...state.draftHoldings].sort((a, b) => holdingValue(b) - holdingValue(a))[0];
    const sinceFirst = firstSnapshot();
    const firstTotal = sinceFirst ? snapshotTotal(sinceFirst) : 0;
    const sinceFirstReturn = firstTotal > 0 ? ((total - firstTotal) / firstTotal) * 100 : NaN;

    return el("section", { class: "portfolio-side-block" }, [
        el("h2", { class: "side-title", text: "요약" }),
        el("div", { class: "portfolio-insights" }, [
            insight("시점", snapshot ? `${snapshot.as_of_date} · ${snapshot.label || "무제"}` : "-"),
            insight("최대 분류", biggest ? `${biggest.category} · ${money(biggest.value)}원` : "-"),
            insight("최대 종목", largestHolding ? `${largestHolding.name || "무제"} · ${money(holdingValue(largestHolding))}원` : "-"),
            insight("전 시점", previous ? `${money(total - previousTotal)}원` : "-"),
            insight("최초 대비", Number.isFinite(sinceFirstReturn) ? pct(sinceFirstReturn) : "-"),
            insight("평단 손익", cost > 0 ? `${money(pnl)}원` : "-")
        ])
    ]);
}

function insight(label, value) {
    return el("div", { class: "insight-row" }, [
        el("span", { text: label }),
        el("strong", { text: value })
    ]);
}

function previousSnapshot(snapshot) {
    if (!snapshot) return null;
    return [...state.snapshots]
        .filter((item) => new Date(item.as_of_date).getTime() < new Date(snapshot.as_of_date).getTime())
        .sort((a, b) => new Date(b.as_of_date).getTime() - new Date(a.as_of_date).getTime())[0] || null;
}

function firstSnapshot() {
    return [...state.snapshots].sort((a, b) => new Date(a.as_of_date).getTime() - new Date(b.as_of_date).getTime())[0] || null;
}

function renderEvents() {
    const form = el("form", { class: "portfolio-event-form", onsubmit: saveEvent }, [
        el("input", { class: "form-control", type: "date", name: "event_date", value: today() }),
        el("select", { class: "form-control", name: "event_type" }, Object.entries(EVENT_TYPES).map(([value, label]) => el("option", { value, text: label }))),
        el("input", { class: "form-control", name: "symbol", placeholder: "종목/내용" }),
        el("input", { class: "form-control", name: "quantity", type: "number", min: "0", step: "0.0001", placeholder: "수량" }),
        el("input", { class: "form-control", name: "price", type: "number", min: "0", step: "0.01", placeholder: "단가" }),
        el("input", { class: "form-control", name: "amount", type: "number", step: "0.01", placeholder: "금액" }),
        el("input", { class: "form-control", name: "memo", placeholder: "메모" }),
        el("button", { class: "secondary-button", type: "submit", text: "기록" })
    ]);

    return el("section", { class: "portfolio-block" }, [
        el("div", { class: "portfolio-block-title" }, [el("h2", { text: "변동사항" })]),
        form,
        el("div", { class: "portfolio-events" }, state.events.length === 0
            ? [el("div", { class: "empty-line", text: "아직 기록 없음" })]
            : state.events.map(renderEventRow))
    ]);
}

function renderEventRow(event) {
    return el("div", { class: "portfolio-event-row" }, [
        el("div", {}, [
            el("strong", { text: `${event.event_date} · ${EVENT_TYPES[event.event_type] || event.event_type}` }),
            el("span", { text: `${event.symbol} ${num(event.quantity) ? `${event.quantity}주` : ""} ${num(event.amount) ? `${money(event.amount)}원` : ""}` })
        ]),
        el("small", { text: event.memo || "" }),
        el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => deleteEvent(event.id) })
    ]);
}

export function cleanupPortfolio() {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
}

export async function renderPortfolio() {
    cleanupPortfolio();
    const root = document.getElementById("screen");
    if (!root) return;
    if (!getCurrentSession()) {
        renderLoginRequired(root);
        return;
    }

    state.loading = true;
    state.error = "";
    renderLoading();
    try {
        await loadPortfolioData();
        renderLoaded();
        resizeHandler = drawPortfolioTrend;
        window.addEventListener("resize", resizeHandler);
    } catch (error) {
        const panel = renderShell();
        panel.append(renderHeader(), el("div", { class: "portfolio-error", text: error.message }));
    } finally {
        state.loading = false;
    }
}
