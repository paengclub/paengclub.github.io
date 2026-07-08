import { getCurrentSession, signInWithGoogle } from "/board.js";
import { supabase } from "/supabaseClient.js";

const DEFAULT_CATEGORIES = [
    { name: "국내주식", color: "#315f4d", target_ratio: 0 },
    { name: "미국주식", color: "#2f7dd3", target_ratio: 0 },
    { name: "ETF", color: "#8b5cf6", target_ratio: 0 },
    { name: "현금", color: "#d16a45", target_ratio: 0 }
];
let state = {
    snapshots: [],
    categories: [],
    activeSnapshotId: "",
    draftHoldings: [],
    categoryDrafts: [],
    deletedCategoryIds: [],
    view: "stats",
    shareMode: false,
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

function ratio(value) {
    if (!Number.isFinite(value)) return "-";
    return `${value.toFixed(1)}%`;
}

function holdingValue(holding) {
    const explicit = num(holding.market_value);
    if (explicit > 0 || (num(holding.price) === 0 && num(holding.quantity) === 0)) return explicit;
    return roundMoney(num(holding.price) * num(holding.quantity));
}

function holdingCost(holding) {
    return roundMoney(num(holding.avg_cost) * num(holding.quantity));
}

function isRebalanceIncluded(holding) {
    return holding.include_in_rebalance !== false;
}

function assetTotal(holdings = state.draftHoldings) {
    return holdings.reduce((sum, holding) => sum + holdingValue(holding), 0);
}

function rebalanceTotal(holdings = state.draftHoldings) {
    return holdings
        .filter(isRebalanceIncluded)
        .reduce((sum, holding) => sum + holdingValue(holding), 0);
}

function displayValue(value, total = assetTotal()) {
    if (!state.shareMode || total <= 0) return num(value);
    return roundMoney((num(value) / total) * 10000);
}

function moneyLabel(value, total = assetTotal()) {
    return `${money(displayValue(value, total))}원`;
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
    return state.categoryDrafts.find((category) => category.name === name)?.color
        || state.categories.find((category) => category.name === name)?.color
        || "#72776b";
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
        include_in_rebalance: true,
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
    const [snapshotsResult, categoriesResult] = await Promise.all([
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
                    include_in_rebalance,
                    sort_order
                )
            `)
            .order("as_of_date", { ascending: false })
            .order("created_at", { ascending: false }),
        supabase
            .from("portfolio_categories")
            .select("id, name, color, sort_order, target_ratio")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true })
    ]);

    if (snapshotsResult.error) throw snapshotsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;

    state.snapshots = sortedByDate(snapshotsResult.data || []);
    state.categories = categoriesResult.data || [];

    if (state.categories.length === 0) {
        await ensureDefaultCategories();
        const { data, error } = await supabase
            .from("portfolio_categories")
            .select("id, name, color, sort_order, target_ratio")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });
        if (error) throw error;
        state.categories = data || [];
    }

    const preferred = state.snapshots.find((snapshot) => snapshot.id === preferredSnapshotId);
    state.activeSnapshotId = preferred?.id || state.snapshots[0]?.id || "";
    state.draftHoldings = normalizeDraft(activeSnapshot()?.portfolio_holdings || []);
    state.categoryDrafts = normalizeCategories(state.categories);
    state.deletedCategoryIds = [];
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
            include_in_rebalance: holding.include_in_rebalance !== false,
            sort_order: index
        }));
}

function normalizeCategories(categories) {
    return [...categories]
        .sort((a, b) => num(a.sort_order) - num(b.sort_order))
        .map((category, index) => ({
            id: category.id || crypto.randomUUID(),
            name: category.name || `분류 ${index + 1}`,
            color: category.color || paletteColor(index),
            target_ratio: num(category.target_ratio),
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
            include_in_rebalance: holding.include_in_rebalance !== false,
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
            include_in_rebalance: holding.include_in_rebalance !== false,
            sort_order: index
        }))
        .filter((holding) => holding.name || holding.market_value > 0);

    try {
        ensureDraftCategoriesFromHoldings(rows);
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
    const categoriesSaved = await saveCategories();
    if (!categoriesSaved) return;
    const holdingsSaved = await saveHoldings({ refreshAfter: false });
    if (!holdingsSaved) return;
    await refresh(snapshot.id, "저장했어요.");
}

function ensureDraftCategoriesFromHoldings(rows) {
    const existing = new Set(state.categoryDrafts.map((category) => category.name));
    const missing = [...new Set(rows.map((row) => row.category).filter(Boolean))]
        .filter((name) => !existing.has(name));
    if (missing.length === 0) return;

    state.categoryDrafts.push(...missing.map((name, index) => ({
        id: crypto.randomUUID(),
        name,
        color: paletteColor(state.categoryDrafts.length + index),
        target_ratio: 0,
        sort_order: state.categoryDrafts.length + index
    })));
}

async function saveCategories() {
    const session = getCurrentSession();
    if (!session) return false;

    for (const id of state.deletedCategoryIds) {
        const { error } = await supabase.from("portfolio_categories").delete().eq("id", id);
        if (error) {
            setStatus(error.message, "danger");
            return false;
        }
    }

    const rows = state.categoryDrafts
        .map((category, index) => ({
            user_id: session.user.id,
            id: category.id,
            name: category.name.trim().slice(0, 40),
            color: (category.color || paletteColor(index)).slice(0, 24),
            target_ratio: Math.max(0, Math.min(100, num(category.target_ratio))),
            sort_order: index
        }))
        .filter((category) => category.name);

    for (const row of rows) {
        const payload = {
            user_id: row.user_id,
            name: row.name,
            color: row.color,
            target_ratio: row.target_ratio,
            sort_order: row.sort_order
        };
        const result = isPersistedId(row.id)
            ? await supabase.from("portfolio_categories").update(payload).eq("id", row.id)
            : await supabase.from("portfolio_categories").upsert(payload, { onConflict: "user_id,name" });
        if (result.error) {
            setStatus(result.error.message, "danger");
            return false;
        }
    }
    return true;
}

function isPersistedId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");
}

function paletteColor(index) {
    return ["#315f4d", "#2f7dd3", "#d16a45", "#8b5cf6", "#16a34a", "#be123c", "#0f766e"][index % 7];
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
    const cost = state.draftHoldings.reduce((sum, holding) => sum + holdingCost(holding), 0);
    const total = assetTotal();
    const pnl = total - cost;
    const previous = previousSnapshot(snapshot);
    const previousTotal = previous ? snapshotTotal(previous) : 0;
    const totalChange = previous ? total - previousTotal : 0;

    panel.append(
        renderHeader(),
        state.snapshots.length === 0 ? renderEmptyState() : renderPortfolioView({ total, cost, pnl, totalChange, previous, previousTotal, snapshot }),
        el("div", { class: "portfolio-footnote", text: "그냥 내가 쓰려고 만든 기능" })
    );

    window.requestAnimationFrame(drawPortfolioTrend);
}

function renderPortfolioView(context) {
    if (state.view === "input") {
        return el("div", { class: "portfolio-view" }, [
            renderSnapshotEditor(context.snapshot),
            renderHoldingsEditor(context.total)
        ]);
    }
    if (state.view === "categories") {
        return el("div", { class: "portfolio-view" }, [renderCategoryManager()]);
    }
    return el("div", { class: "portfolio-view stats-view" }, [
        renderKpis(context),
        renderShareControls(),
        el("div", { class: "portfolio-stats-grid" }, [
            renderAllocation(context.total),
            renderRebalance(context.total),
            renderTrend(),
            renderInsights(context),
            renderHoldingBreakdown(context.total),
            renderSnapshotComparison(context)
        ])
    ]);
}

function renderHeader() {
    const actions = state.snapshots.length > 0 ? [
        el("button", { class: "secondary-button compact", type: "button", text: "현재 시점 복사", onclick: () => createSnapshot({ copyActive: true }) }),
        el("button", { class: "primary-button compact", type: "button", text: "저장", onclick: savePortfolio })
    ] : [];

    return el("div", { class: "section-header portfolio-header" }, [
        el("div", {}, [
            el("h1", { class: "section-title", text: "주식 분석" })
        ]),
        el("div", { class: "portfolio-header-actions" }, [
            ...actions,
            el("span", { id: "portfolioStatus", class: "portfolio-status", "aria-live": "polite" })
        ]),
        state.snapshots.length > 0 ? renderViewSwitch() : null
    ]);
}

function renderViewSwitch() {
    const views = [
        ["stats", "통계"],
        ["input", "입력"],
        ["categories", "분류"]
    ];
    return el("div", { class: "portfolio-view-switch", role: "tablist", "aria-label": "주식 분석 화면" }, views.map(([value, label]) => el("button", {
        class: state.view === value ? "active" : "",
        type: "button",
        role: "tab",
        "aria-selected": state.view === value ? "true" : "false",
        text: label,
        onclick: () => {
            state.view = value;
            renderLoaded();
        }
    })));
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
    const includedTotal = rebalanceTotal();
    const excludedTotal = total - includedTotal;
    return el("div", { class: "portfolio-kpis" }, [
        renderKpi("전체 자산", moneyLabel(total), previous ? `${previous.as_of_date} 대비 ${moneyLabel(totalChange, total)} ` : "첫 시점"),
        renderKpi("계산 대상", moneyLabel(includedTotal), excludedTotal > 0 ? `제외 ${moneyLabel(excludedTotal)}` : "전부 포함"),
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

function renderShareControls() {
    return el("section", { class: "portfolio-share-strip" }, [
        el("label", { class: "portfolio-share-toggle" }, [
            el("input", {
                type: "checkbox",
                checked: state.shareMode ? "" : null,
                onchange: (event) => {
                    state.shareMode = event.target.checked;
                    renderLoaded();
                }
            }),
            el("span", { text: "공유 보기" }),
            el("small", { text: "전체 자산을 10,000원으로 환산" })
        ])
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
                el("button", { class: "secondary-button compact", type: "button", text: "종목 추가", onclick: addHoldingRow })
            ])
        ]),
        renderHoldingsTable(total)
    ]);
}

function renderHoldingsTable(total) {
    const rows = state.draftHoldings.length > 0 ? state.draftHoldings : [emptyHolding()];
    if (state.draftHoldings.length === 0) state.draftHoldings = rows;

    return el("div", { class: "portfolio-table-wrap" }, [
        el("table", { class: "portfolio-table" }, [
            el("thead", {}, [
                el("tr", {}, ["종목", "분류", "단가", "수량", "평가금액", "비율", "평단", "손익", "리밸런싱"].map((text) => el("th", { text })))
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
        el("td", {}, [el("select", {
            class: "form-control",
            onchange: (event) => updateHolding(index, "category", event.target.value)
        }, categoryOptions(holding.category))]),
        el("td", {}, [moneyInput(holding.price, (valueInput) => updateCalculatedHolding(index, "price", valueInput), "portfolio-price-input")]),
        el("td", {}, [moneyInput(holding.quantity, (valueInput) => updateCalculatedHolding(index, "quantity", valueInput), "portfolio-quantity-input")]),
        el("td", {}, [moneyInput(value, (valueInput) => updateCalculatedHolding(index, "market_value", valueInput), "portfolio-value-input")]),
        el("td", { class: "portfolio-ratio-cell", text: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "-" }),
        el("td", {}, [moneyInput(holding.avg_cost, (valueInput) => {
            updateHolding(index, "avg_cost", num(valueInput));
            syncDraftMetrics();
        }, "portfolio-cost-input")]),
        el("td", { class: `portfolio-gain portfolio-gain-cell ${gain >= 0 ? "plus" : "minus"}`, text: cost > 0 ? money(gain) : "-" }),
        el("td", { class: "portfolio-row-actions" }, [
            el("label", { class: "mini-check" }, [
                el("input", {
                    type: "checkbox",
                    checked: holding.include_in_rebalance !== false ? "" : null,
                    onchange: (event) => {
                        updateHolding(index, "include_in_rebalance", event.target.checked);
                        syncDraftMetrics();
                    }
                }),
                el("span", { text: "계산" })
            ]),
            el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => removeHoldingRow(index) })
        ])
    ]);
}

function categoryOptions(selected) {
    const names = portfolioCategoryNames();
    return names.map((name) => el("option", {
        value: name,
        text: name,
        selected: name === selected ? "" : null
    }));
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
    syncRebalanceMetrics();
}

function addHoldingRow() {
    state.draftHoldings.push(emptyHolding(state.draftHoldings.length));
    renderLoaded();
}

function removeHoldingRow(index) {
    state.draftHoldings.splice(index, 1);
    renderLoaded();
}

function renderCategoryManager() {
    return el("section", { class: "portfolio-block" }, [
        el("div", { class: "portfolio-block-title" }, [
            el("h2", { text: "분류 관리" }),
            el("button", { class: "secondary-button compact", type: "button", text: "분류 추가", onclick: addCategoryDraft })
        ]),
        el("div", { class: "category-editor-list" }, state.categoryDrafts.map((category, index) => renderCategoryEditorRow(category, index)))
    ]);
}

function renderCategoryEditorRow(category, index) {
    return el("div", { class: "category-editor-row" }, [
        el("input", {
            class: "form-control",
            value: category.name,
            maxlength: "40",
            placeholder: "분류명",
            onchange: (event) => renameCategory(index, event.target.value)
        }),
        el("input", {
            class: "form-control category-color-input",
            type: "color",
            value: category.color || paletteColor(index),
            onchange: (event) => updateCategoryDraft(index, "color", event.target.value)
        }),
        el("div", { class: "target-editor" }, [
            el("span", { text: "목표" }),
            moneyInput(category.target_ratio, (value) => updateCategoryDraft(index, "target_ratio", Math.max(0, Math.min(100, num(value)))), "target-input")
        ]),
        el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => removeCategoryDraft(index) })
    ]);
}

function addCategoryDraft() {
    state.categoryDrafts.push({
        id: crypto.randomUUID(),
        name: `분류 ${state.categoryDrafts.length + 1}`,
        color: paletteColor(state.categoryDrafts.length),
        target_ratio: 0,
        sort_order: state.categoryDrafts.length
    });
    renderLoaded();
}

function updateCategoryDraft(index, key, value) {
    if (!state.categoryDrafts[index]) return;
    state.categoryDrafts[index][key] = value;
}

function renameCategory(index, value) {
    const category = state.categoryDrafts[index];
    if (!category) return;
    const previous = category.name;
    const next = value.trim() || previous;
    category.name = next;
    state.draftHoldings.forEach((holding) => {
        if (holding.category === previous) holding.category = next;
    });
    renderLoaded();
}

function removeCategoryDraft(index) {
    const category = state.categoryDrafts[index];
    if (!category) return;
    if (state.categoryDrafts.length <= 1) {
        setStatus("분류는 하나 이상 필요해요.", "danger");
        return;
    }
    if (!window.confirm(`${category.name} 분류를 삭제할까요?`)) return;
    if (isPersistedId(category.id)) state.deletedCategoryIds.push(category.id);
    state.categoryDrafts.splice(index, 1);
    const fallback = state.categoryDrafts[0]?.name || "미분류";
    state.draftHoldings.forEach((holding) => {
        if (holding.category === category.name) holding.category = fallback;
    });
    renderLoaded();
}

function renderAllocation(total) {
    const allocation = categoryAllocation(state.draftHoldings, { rebalanceOnly: false });
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
                el("small", { text: moneyLabel(item.value, assetTotal()) })
            ]);
        }))
    ]);
}

function renderRebalance(total) {
    const universeTotal = rebalanceTotal();
    const allocation = categoryAllocation(state.draftHoldings, { rebalanceOnly: true });
    const valueByCategory = new Map(allocation.map((item) => [item.category, item.value]));
    const categories = portfolioCategoryNames();
    const targetSum = categories.reduce((sum, category) => sum + categoryTarget(category), 0);

    return el("section", { class: "portfolio-side-block" }, [
        el("div", { class: "portfolio-block-title compact-title" }, [
            el("h2", { class: "side-title", text: "목표 비율" }),
            el("small", { class: targetSum > 100 ? "rebalance-warning" : "muted-text", text: `합계 ${targetSum.toFixed(1)}%` })
        ]),
        categories.length === 0 ? el("div", { class: "empty-line", text: "분류 없음" }) : el("div", { class: "rebalance-list" }, categories.map((category) => {
            const actualValue = valueByCategory.get(category) || 0;
            const actualRatio = universeTotal > 0 ? (actualValue / universeTotal) * 100 : 0;
            const targetRatio = categoryTarget(category);
            const gap = targetRatio - actualRatio;
            const moveAmount = universeTotal * (gap / 100);
            return el("div", { class: "rebalance-row", "data-rebalance-category": category }, [
                el("div", { class: "rebalance-row-head" }, [
                    el("span", { text: category }),
                    el("strong", { class: gap >= 0 ? "plus" : "minus", text: moneyLabel(moveAmount, assetTotal()) })
                ]),
                el("div", { class: "rebalance-controls" }, [
                    el("span", { class: "rebalance-actual", text: `${actualRatio.toFixed(1)}%` }),
                    el("span", { class: "rebalance-target", text: `${targetRatio.toFixed(1)}%` }),
                    el("span", { class: gap >= 0 ? "rebalance-gap plus" : "rebalance-gap minus", text: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%` })
                ])
            ]);
        }))
    ]);
}

function categoryAllocation(holdings, { rebalanceOnly = false } = {}) {
    const map = new Map();
    for (const holding of holdings) {
        if (rebalanceOnly && !isRebalanceIncluded(holding)) continue;
        const key = holding.category || "미분류";
        map.set(key, (map.get(key) || 0) + holdingValue(holding));
    }
    return [...map.entries()]
        .map(([category, value]) => ({ category, value }))
        .sort((a, b) => b.value - a.value);
}

function portfolioCategoryNames() {
    const names = new Set(state.categoryDrafts.map((category) => category.name));
    for (const holding of state.draftHoldings) {
        const category = holding.category?.trim();
        if (category) names.add(category);
    }
    return [...names].filter(Boolean);
}

function categoryTarget(name) {
    return num(state.categoryDrafts.find((category) => category.name === name)?.target_ratio);
}

function updateCategoryTarget(name, value) {
    const targetRatio = Math.max(0, Math.min(100, num(value)));
    const existing = state.categoryDrafts.find((category) => category.name === name);
    if (existing) {
        existing.target_ratio = targetRatio;
        return;
    }
    state.categoryDrafts.push({
        id: crypto.randomUUID(),
        name,
        color: paletteColor(state.categoryDrafts.length),
        target_ratio: targetRatio,
        sort_order: state.categoryDrafts.length
    });
}

function syncRebalanceMetrics() {
    const total = rebalanceTotal();
    const allocation = categoryAllocation(state.draftHoldings, { rebalanceOnly: true });
    const valueByCategory = new Map(allocation.map((item) => [item.category, item.value]));
    const targetSum = portfolioCategoryNames().reduce((sum, category) => sum + categoryTarget(category), 0);
    const summary = document.querySelector(".compact-title small");
    if (summary) {
        summary.textContent = `합계 ${targetSum.toFixed(1)}%`;
        summary.className = targetSum > 100 ? "rebalance-warning" : "muted-text";
    }

    document.querySelectorAll("[data-rebalance-category]").forEach((row) => {
        const category = row.dataset.rebalanceCategory;
        const actualValue = valueByCategory.get(category) || 0;
        const actualRatio = total > 0 ? (actualValue / total) * 100 : 0;
        const gap = categoryTarget(category) - actualRatio;
        const moveAmount = total * (gap / 100);
        const amount = row.querySelector(".rebalance-row-head strong");
        const actual = row.querySelector(".rebalance-actual");
        const gapNode = row.querySelector(".rebalance-gap");
        if (amount) {
            amount.textContent = moneyLabel(moveAmount, assetTotal());
            amount.className = gap >= 0 ? "plus" : "minus";
        }
        if (actual) actual.textContent = `${actualRatio.toFixed(1)}%`;
        const target = row.querySelector(".rebalance-target");
        if (target) target.textContent = `${categoryTarget(category).toFixed(1)}%`;
        if (gapNode) {
            gapNode.textContent = `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`;
            gapNode.className = gap >= 0 ? "rebalance-gap plus" : "rebalance-gap minus";
        }
    });
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

    const baseTotal = assetTotal();
    const points = [...state.snapshots]
        .sort((a, b) => new Date(a.as_of_date).getTime() - new Date(b.as_of_date).getTime())
        .map((snapshot) => ({ label: snapshot.as_of_date, value: displayValue(snapshotTotal(snapshot), baseTotal) }));
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
    const allocation = categoryAllocation(state.draftHoldings, { rebalanceOnly: true });
    const biggest = allocation[0];
    const meaningfulHoldings = state.draftHoldings.filter((holding) => holdingValue(holding) > 0);
    const largestHolding = [...meaningfulHoldings].sort((a, b) => holdingValue(b) - holdingValue(a))[0];
    const sinceFirst = firstSnapshot();
    const firstTotal = sinceFirst ? snapshotTotal(sinceFirst) : 0;
    const sinceFirstReturn = firstTotal > 0 ? ((total - firstTotal) / firstTotal) * 100 : NaN;
    const top3Value = [...meaningfulHoldings]
        .sort((a, b) => holdingValue(b) - holdingValue(a))
        .slice(0, 3)
        .reduce((sum, holding) => sum + holdingValue(holding), 0);
    const targetGapAmount = portfolioCategoryNames().reduce((sum, category) => {
        const actual = allocation.find((item) => item.category === category)?.value || 0;
        const target = rebalanceTotal() * (categoryTarget(category) / 100);
        return sum + Math.abs(target - actual);
    }, 0) / 2;
    const targetSum = portfolioCategoryNames().reduce((sum, category) => sum + categoryTarget(category), 0);
    const cashValue = allocation
        .filter((item) => item.category.includes("현금") || item.category.toLowerCase().includes("cash"))
        .reduce((sum, item) => sum + item.value, 0);

    return el("section", { class: "portfolio-side-block" }, [
        el("h2", { class: "side-title", text: "통계" }),
        el("div", { class: "portfolio-insights" }, [
            insight("시점", snapshot ? `${snapshot.as_of_date} · ${snapshot.label || "무제"}` : "-"),
            insight("종목 수", `${meaningfulHoldings.length}개`),
            insight("최대 분류", biggest ? `${biggest.category} · ${ratio((biggest.value / Math.max(total, 1)) * 100)}` : "-"),
            insight("최대 종목", largestHolding ? `${largestHolding.name || "무제"} · ${ratio((holdingValue(largestHolding) / Math.max(total, 1)) * 100)}` : "-"),
            insight("상위 3종목", total > 0 ? ratio((top3Value / total) * 100) : "-"),
            insight("현금 비중", total > 0 ? ratio((cashValue / total) * 100) : "-"),
            insight("목표 합계", `${targetSum.toFixed(1)}%`),
            insight("조정 필요", targetGapAmount > 0 ? moneyLabel(targetGapAmount, total) : "-"),
            insight("전 시점", previous ? moneyLabel(total - previousTotal, total) : "-"),
            insight("최초 대비", Number.isFinite(sinceFirstReturn) ? pct(sinceFirstReturn) : "-"),
            insight("평단 손익", cost > 0 ? moneyLabel(pnl, total) : "-")
        ])
    ]);
}

function insight(label, value) {
    return el("div", { class: "insight-row" }, [
        el("span", { text: label }),
        el("strong", { text: value })
    ]);
}

function renderHoldingBreakdown(total) {
    const rows = [...state.draftHoldings]
        .filter((holding) => holdingValue(holding) > 0)
        .sort((a, b) => holdingValue(b) - holdingValue(a));
    return el("section", { class: "portfolio-side-block wide-stat" }, [
        el("h2", { class: "side-title", text: "종목 비중" }),
        rows.length === 0 ? el("div", { class: "empty-line", text: "보유 종목 없음" }) : el("div", { class: "holding-breakdown-list" }, rows.map((holding) => {
            const value = holdingValue(holding);
            const ratio = total > 0 ? (value / total) * 100 : 0;
            return el("div", { class: holding.include_in_rebalance === false ? "holding-breakdown-row excluded" : "holding-breakdown-row" }, [
                el("div", { class: "holding-breakdown-head" }, [
                    el("span", { text: holding.name || "무제" }),
                    el("strong", { text: `${ratio.toFixed(1)}%` })
                ]),
                el("div", { class: "allocation-bar" }, [
                    el("span", { style: `width:${Math.max(ratio, 1.5)}%;background:${categoryColor(holding.category)}` })
                ]),
                el("small", { text: `${holding.category} · ${moneyLabel(value, total)}${holding.include_in_rebalance === false ? " · 계산 제외" : ""}` })
            ]);
        }))
    ]);
}

function renderSnapshotComparison({ total, previous, previousTotal }) {
    const first = firstSnapshot();
    const firstTotal = first ? snapshotTotal(first) : 0;
    const excluded = assetTotal() - rebalanceTotal();
    return el("section", { class: "portfolio-side-block" }, [
        el("h2", { class: "side-title", text: "시점 비교" }),
        el("div", { class: "portfolio-insights" }, [
            insight("전체 자산", moneyLabel(total, total)),
            insight("계산 대상", moneyLabel(rebalanceTotal(), total)),
            insight("계산 제외", excluded > 0 ? moneyLabel(excluded, total) : "-"),
            insight("전 시점 금액", previous ? moneyLabel(previousTotal, total) : "-"),
            insight("전 시점 차이", previous ? moneyLabel(total - previousTotal, total) : "-"),
            insight("최초 시점", first ? first.as_of_date : "-"),
            insight("최초 대비 금액", first ? moneyLabel(total - firstTotal, total) : "-"),
            insight("최초 대비 비율", firstTotal > 0 ? pct(((total - firstTotal) / firstTotal) * 100) : "-")
        ])
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
