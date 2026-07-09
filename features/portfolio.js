// features/portfolio.js — 자산관리, a login-gated personal asset dashboard.
// Two lenses over per-user, snapshot-based data (portfolio_snapshots/holdings/
// categories): 현황 (whole-asset tracking) and 리밸런싱 (investment-only vs
// target). Charts are inline SVG (donuts / line / stacked bars). Exports
// renderPortfolio, cleanupPortfolio. All state lives in the module-level `state`.
import { getCurrentSession, signInWithGoogle } from "/features/board.js";
import { supabase } from "/supabaseClient.js";
import { el, svg } from "/lib/dom.js";
import { num } from "/lib/format.js";

const DEFAULT_CATEGORIES = [
    { name: "국내주식", color: "#315f4d", target_ratio: 0 },
    { name: "미국주식", color: "#2f7dd3", target_ratio: 0 },
    { name: "ETF", color: "#8b5cf6", target_ratio: 0 },
    { name: "현금", color: "#d16a45", target_ratio: 0 }
];
// Distinct palette for per-holding slices (categories keep their own colors).
const HOLDING_PALETTE = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899",
    "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4", "#eab308",
    "#a855f7", "#0ea5e9", "#f43f5e", "#10b981", "#d946ef", "#fb7185"
];
let state = {
    snapshots: [],
    categories: [],
    activeSnapshotId: "",
    draftHoldings: [],
    categoryDrafts: [],
    deletedCategoryIds: [],
    view: "overview",
    shareMode: false,
    allocMode: "category",
    loading: false,
    error: ""
};

function today() {
    return new Date().toISOString().slice(0, 10);
}

function roundMoney(value) {
    return Math.round(num(value) * 100) / 100;
}

function money(value) {
    return new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: Math.abs(num(value)) >= 1000 ? 0 : 2
    }).format(num(value));
}

// Compact Korean units for hero numbers (억 / 만) so big amounts stay scannable.
function bigMoney(rawValue) {
    if (state.shareMode) return moneyLabel(rawValue);
    const v = num(rawValue);
    const a = Math.abs(v);
    if (a >= 1e8) return `${(v / 1e8).toFixed(a >= 1e9 ? 1 : 2)}억원`;
    if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString("ko-KR")}만원`;
    return `${money(v)}원`;
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

function holdingColor(index) {
    return HOLDING_PALETTE[index % HOLDING_PALETTE.length];
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

/* ---------------------------------------------------------------- data layer */

async function ensureDefaultCategories() {
    if (state.categories.length > 0) return;
    const rows = DEFAULT_CATEGORIES.map((category, index) => ({ ...category, sort_order: index }));
    await supabase.from("portfolio_categories").upsert(rows, { onConflict: "user_id,name" });
}

async function loadPortfolioData(preferredSnapshotId = state.activeSnapshotId) {
    const [snapshotsResult, categoriesResult] = await Promise.all([
        supabase
            .from("portfolio_snapshots")
            .select(`
                id, user_id, label, as_of_date, note, created_at,
                portfolio_holdings(
                    id, symbol, name, category, price, quantity, avg_cost,
                    market_value, memo, include_in_rebalance, sort_order
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

    state.view = "input";
    await refresh(data.id, copyActive ? "이전 시점을 복사했어요. 값을 수정하세요." : "새 시점을 만들었어요.");
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

/* ------------------------------------------------------------- computed data */

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

function previousSnapshot(snapshot) {
    if (!snapshot) return null;
    return [...state.snapshots]
        .filter((item) => new Date(item.as_of_date).getTime() < new Date(snapshot.as_of_date).getTime())
        .sort((a, b) => new Date(b.as_of_date).getTime() - new Date(a.as_of_date).getTime())[0] || null;
}

function firstSnapshot() {
    return [...state.snapshots].sort((a, b) => new Date(a.as_of_date).getTime() - new Date(b.as_of_date).getTime())[0] || null;
}

function meaningfulHoldings() {
    return state.draftHoldings.filter((holding) => holdingValue(holding) > 0);
}

function categorySegments() {
    return categoryAllocation(state.draftHoldings, { rebalanceOnly: false })
        .map((item) => ({ label: item.category, value: item.value, color: categoryColor(item.category) }));
}

function holdingSegments() {
    return [...meaningfulHoldings()]
        .sort((a, b) => holdingValue(b) - holdingValue(a))
        .map((holding, index) => ({
            label: holding.name || "무제",
            value: holdingValue(holding),
            color: holdingColor(index),
            holding
        }));
}

function investmentHoldings() {
    return meaningfulHoldings().filter(isRebalanceIncluded);
}

function investmentTotal() {
    return rebalanceTotal();
}

function investmentCategorySegments() {
    return categoryAllocation(state.draftHoldings, { rebalanceOnly: true })
        .map((item) => ({ label: item.category, value: item.value, color: categoryColor(item.category) }));
}

function targetSegments() {
    return state.categoryDrafts
        .filter((category) => num(category.target_ratio) > 0)
        .sort((a, b) => num(b.target_ratio) - num(a.target_ratio))
        .map((category) => ({ label: category.name, value: num(category.target_ratio), color: category.color }));
}

// Categories present in the current snapshot, ordered by value (for stable
// legend + stacking colors across the trend charts).
function orderedCategories({ investmentOnly = false } = {}) {
    return categoryAllocation(state.draftHoldings, { rebalanceOnly: investmentOnly }).map((item) => item.category);
}

function snapshotsAscending() {
    return [...state.snapshots].sort((a, b) => new Date(a.as_of_date).getTime() - new Date(b.as_of_date).getTime());
}

/* ------------------------------------------------------------------- charts */

function donutChart(segments, { size = 208, thickness = 30, centerLabel = "", centerValue = "", centerSub = "" } = {}) {
    const positive = segments.filter((seg) => seg.value > 0);
    const total = positive.reduce((sum, seg) => sum + seg.value, 0);
    const r = (size - thickness) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    const gap = positive.length > 1 ? 2 : 0;

    const svgEl = svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "pf-donut-svg", role: "img" });
    svgEl.appendChild(svg("circle", { cx, cy, r, fill: "none", stroke: "var(--app-line)", "stroke-width": thickness }));

    if (total > 0) {
        let acc = 0;
        for (const seg of positive) {
            const frac = seg.value / total;
            const len = frac * circumference;
            const dash = Math.max(len - gap, 0.6);
            svgEl.appendChild(svg("circle", {
                cx, cy, r,
                fill: "none",
                stroke: seg.color,
                "stroke-width": thickness,
                "stroke-dasharray": `${dash} ${circumference - dash}`,
                "stroke-dashoffset": `${-acc * circumference}`,
                transform: `rotate(-90 ${cx} ${cy})`
            }));
            acc += frac;
        }
    }

    return el("div", { class: "pf-donut" }, [
        svgEl,
        el("div", { class: "pf-donut-center" }, [
            centerLabel ? el("span", { text: centerLabel }) : null,
            centerValue ? el("strong", { text: centerValue }) : null,
            centerSub ? el("small", { text: centerSub }) : null
        ])
    ]);
}

function donutLegend(segments, total) {
    return el("ul", { class: "pf-legend" }, segments.filter((seg) => seg.value > 0).map((seg) => {
        const share = total > 0 ? (seg.value / total) * 100 : 0;
        return el("li", { class: "pf-legend-row" }, [
            el("span", { class: "pf-legend-dot", style: `background:${seg.color}` }),
            el("span", { class: "pf-legend-name", text: seg.label }),
            el("span", { class: "pf-legend-pct", text: `${share.toFixed(1)}%` }),
            el("span", { class: "pf-legend-val", text: moneyLabel(seg.value) })
        ]);
    }));
}

function lineChart(points) {
    const width = 560;
    const height = 214;
    const pad = { l: 56, r: 18, t: 24, b: 30 };
    const svgEl = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "pf-line-svg", role: "img" });
    if (points.length === 0) return svgEl;

    const values = points.map((point) => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const range = Math.max(rawMax - rawMin, rawMax * 0.05, 1);
    const lo = Math.max(0, rawMin - range * 0.28);
    const hi = rawMax + range * 0.22;
    const span = Math.max(hi - lo, 1);
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const x = (index) => pad.l + (points.length === 1 ? 0.5 : index / (points.length - 1)) * plotW;
    const y = (value) => pad.t + (1 - (value - lo) / span) * plotH;

    const ticks = 4;
    for (let t = 0; t <= ticks; t += 1) {
        const value = lo + span * (t / ticks);
        const gy = y(value);
        svgEl.appendChild(svg("line", { x1: pad.l, y1: gy, x2: width - pad.r, y2: gy, stroke: "var(--app-line)", "stroke-width": 1, opacity: t === 0 ? "1" : "0.5" }));
        svgEl.appendChild(svg("text", { x: pad.l - 8, y: gy + 3, "text-anchor": "end", class: "pf-chart-axis", text: bigMoney(value) }));
    }

    if (points.length >= 2) {
        const areaPoints = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
        svgEl.appendChild(svg("polygon", { points: `${pad.l},${y(lo)} ${areaPoints} ${width - pad.r},${y(lo)}`, fill: "var(--app-primary)", opacity: "0.1" }));
    }

    svgEl.appendChild(svg("polyline", {
        points: points.map((point, index) => `${x(index)},${y(point.value)}`).join(" "),
        fill: "none", stroke: "var(--app-primary)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round"
    }));

    points.forEach((point, index) => {
        const anchor = index === 0 ? "start" : (index === points.length - 1 ? "end" : "middle");
        svgEl.appendChild(svg("circle", { cx: x(index), cy: y(point.value), r: 3.5, fill: "var(--app-surface-strong)", stroke: "var(--app-primary)", "stroke-width": 2 }));
        svgEl.appendChild(svg("text", { x: x(index), y: y(point.value) - 9, "text-anchor": anchor, class: "pf-chart-value", text: bigMoney(point.value) }));
        svgEl.appendChild(svg("text", { x: x(index), y: height - 10, "text-anchor": anchor, class: "pf-chart-label", text: point.label }));
    });
    return svgEl;
}

function stackedBars(snapshotsAsc, categories, { investmentOnly = false } = {}) {
    const width = 560;
    const height = 200;
    const pad = { l: 34, r: 12, t: 12, b: 28 };
    const svgEl = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "pf-stack-svg", role: "img" });
    if (snapshotsAsc.length === 0) return svgEl;

    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const slot = plotW / snapshotsAsc.length;
    const barW = Math.min(slot * 0.56, 44);

    for (const p of [0, 50, 100]) {
        const gy = pad.t + (1 - p / 100) * plotH;
        svgEl.appendChild(svg("line", { x1: pad.l, y1: gy, x2: width - pad.r, y2: gy, stroke: "var(--app-line)", "stroke-width": 1, opacity: p === 0 ? "1" : "0.45" }));
        svgEl.appendChild(svg("text", { x: pad.l - 6, y: gy + 3, "text-anchor": "end", class: "pf-chart-axis", text: `${p}%` }));
    }

    snapshotsAsc.forEach((snapshot, index) => {
        let holdings = normalizeDraft(snapshot.portfolio_holdings || []);
        if (investmentOnly) holdings = holdings.filter(isRebalanceIncluded);
        const total = holdings.reduce((sum, holding) => sum + holdingValue(holding), 0);
        const cx = pad.l + slot * index + slot / 2;
        let acc = 0;
        if (total > 0) {
            for (const category of categories) {
                const value = holdings
                    .filter((holding) => (holding.category || "미분류") === category)
                    .reduce((sum, holding) => sum + holdingValue(holding), 0);
                if (value <= 0) continue;
                const frac = value / total;
                const yTop = pad.t + (1 - acc - frac) * plotH;
                svgEl.appendChild(svg("rect", {
                    x: cx - barW / 2, y: yTop, width: barW, height: Math.max(frac * plotH - 1, 0.6),
                    fill: categoryColor(category), rx: 1
                }));
                acc += frac;
            }
        } else {
            svgEl.appendChild(svg("rect", { x: cx - barW / 2, y: pad.t, width: barW, height: plotH, fill: "var(--app-line)", rx: 1 }));
        }
        svgEl.appendChild(svg("text", { x: cx, y: height - 9, "text-anchor": "middle", class: "pf-chart-label", text: (snapshot.as_of_date || "").slice(2) }));
    });

    return svgEl;
}

function categoryChartLegend(categories) {
    return el("div", { class: "pf-chart-legend" }, categories.map((category) => el("span", { class: "pf-chart-legend-item" }, [
        el("span", { class: "pf-legend-dot", style: `background:${categoryColor(category)}` }),
        el("span", { text: category })
    ])));
}

/* -------------------------------------------------------------- render: shell */

function renderShell() {
    const root = document.getElementById("screen");
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell portfolio-shell" });
    const panel = el("div", { class: "app-panel portfolio-panel" });
    wrapper.appendChild(panel);
    root.appendChild(wrapper);
    return panel;
}

function renderLoginRequired(root) {
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell portfolio-shell" });
    const panel = el("div", { class: "app-panel portfolio-login-panel" }, [
        el("h1", { class: "section-title", text: "자산관리" }),
        el("p", { class: "muted-text", text: "개인 포트폴리오 데이터는 로그인한 본인에게만 보입니다." }),
        el("button", { class: "primary-button", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
    ]);
    wrapper.appendChild(panel);
    wrapper.appendChild(el("div", { class: "portfolio-footnote", text: "그냥 내가 쓰려고 만든 기능" }));
    root.appendChild(wrapper);
}

function renderLoading() {
    const panel = renderShell();
    panel.append(
        el("div", { class: "section-header" }, [el("div", {}, [el("h1", { class: "section-title", text: "자산관리" })])]),
        el("div", { class: "portfolio-loading", text: "불러오는 중..." })
    );
}

function renderLoaded() {
    const panel = renderShell();
    const snapshot = activeSnapshot();
    const total = assetTotal();
    const cost = state.draftHoldings.reduce((sum, holding) => sum + holdingCost(holding), 0);
    const pnl = total - cost;
    const previous = previousSnapshot(snapshot);
    const previousTotal = previous ? snapshotTotal(previous) : 0;
    const context = { total, cost, pnl, previous, previousTotal, snapshot };

    panel.append(
        renderHeader(),
        state.snapshots.length === 0 ? renderEmptyState() : renderView(context),
        el("div", { class: "portfolio-footnote", text: "그냥 내가 쓰려고 만든 기능" })
    );
}

function renderHeader() {
    const actions = state.snapshots.length > 0 ? [
        el("button", { class: "secondary-button compact", type: "button", text: "현재 시점 복사", onclick: () => createSnapshot({ copyActive: true }) }),
        el("button", { class: "primary-button compact", type: "button", text: "저장", onclick: savePortfolio })
    ] : [];

    return el("div", { class: "section-header portfolio-header" }, [
        el("div", { class: "portfolio-title-wrap" }, [
            el("h1", { class: "section-title", text: "자산관리" }),
            state.snapshots.length > 0 ? renderViewSwitch() : null
        ]),
        el("div", { class: "portfolio-header-actions" }, [
            ...actions,
            el("span", { id: "portfolioStatus", class: "portfolio-status", "aria-live": "polite" })
        ])
    ]);
}

function renderViewSwitch() {
    const views = [["overview", "현황"], ["rebalance", "리밸런싱"], ["input", "입력"], ["categories", "분류·목표"]];
    return el("div", { class: "portfolio-view-switch", role: "tablist" }, views.map(([value, label]) => el("button", {
        class: state.view === value ? "active" : "",
        type: "button",
        role: "tab",
        "aria-selected": state.view === value ? "true" : "false",
        text: label,
        onclick: () => { state.view = value; renderLoaded(); }
    })));
}

function renderView(context) {
    if (state.view === "input") {
        return el("div", { class: "portfolio-view" }, [renderSnapshotEditor(context.snapshot), renderHoldingsEditor(context.total)]);
    }
    if (state.view === "categories") {
        return el("div", { class: "portfolio-view" }, [renderCategoryManager()]);
    }
    if (state.view === "rebalance") {
        return renderRebalanceView(context);
    }
    return renderOverview(context);
}

function renderEmptyState() {
    return el("div", { class: "portfolio-empty" }, [
        el("strong", { text: "첫 포트폴리오 시점을 만들어 주세요." }),
        el("span", { text: "예: 2026년 7월 말 기준 보유 종목을 입력하고, 다음 달에는 복사해서 달라진 값만 수정하면 됩니다." }),
        el("button", { class: "primary-button", type: "button", text: "첫 시점 만들기", onclick: () => createSnapshot() })
    ]);
}

/* --------------------------------------------------------- render: dashboard */

function renderEmptyDashboard() {
    return el("div", { class: "portfolio-view" }, [
        renderSnapshotBar(),
        el("div", { class: "portfolio-empty" }, [
            el("strong", { text: "이 시점에 보유 종목이 없어요." }),
            el("span", { text: "‘입력’ 탭에서 종목을 추가하면 현황이 채워집니다." }),
            el("button", { class: "primary-button", type: "button", text: "종목 입력하러 가기", onclick: () => { state.view = "input"; renderLoaded(); } })
        ])
    ]);
}

// 관점 ①: 흩어진 전 자산을 통합해 총액·손익·증감을 추적 (계산 제외 자산 포함).
function renderOverview(context) {
    if (meaningfulHoldings().length === 0) return renderEmptyDashboard();
    return el("div", { class: "portfolio-view pf-dash" }, [
        renderSnapshotBar(),
        renderOverviewHero(context),
        renderHoldingsPanel(context),
        renderOverviewTrend(context),
        renderOverviewStats(context)
    ]);
}

// 관점 ②: 투자자산만(계산 제외 자산 빼고) 목표 비중 리밸런싱.
function renderRebalanceView(context) {
    if (investmentHoldings().length === 0) {
        return el("div", { class: "portfolio-view" }, [
            renderSnapshotBar(),
            el("div", { class: "pf-hint" }, [
                el("span", { text: "리밸런싱은 ‘투자자산’으로 표시된 종목만 대상으로 합니다. ‘입력’ 탭에서 각 종목의 ‘계산’ 체크를 켜 주세요." }),
                el("button", { class: "secondary-button compact", type: "button", text: "입력으로 가기", onclick: () => { state.view = "input"; renderLoaded(); } })
            ])
        ]);
    }
    return el("div", { class: "portfolio-view pf-dash" }, [
        renderSnapshotBar(),
        renderRebalanceHero(context),
        renderRebalancePanel(context),
        renderRebalanceTrend(context)
    ]);
}

function renderSnapshotBar() {
    const snapshots = sortedSnapshots();
    const active = activeSnapshot();
    return el("div", { class: "pf-snapbar pf-area-snapbar" }, [
        el("div", { class: "pf-snapbar-scroll" }, snapshots.map((snapshot) => el("button", {
            class: `pf-snap-pill ${snapshot.id === active?.id ? "active" : ""}`,
            type: "button",
            title: snapshot.label || snapshot.as_of_date,
            onclick: () => {
                state.activeSnapshotId = snapshot.id;
                state.draftHoldings = normalizeDraft(activeSnapshot()?.portfolio_holdings || []);
                renderLoaded();
            }
        }, [
            el("strong", { text: snapshot.as_of_date }),
            el("span", { text: snapshot.label || "무제" })
        ]))),
        el("label", { class: "pf-share-toggle", title: "전체 자산을 10,000원 기준으로 환산해 비율만 보여줍니다." }, [
            el("input", {
                type: "checkbox",
                checked: state.shareMode ? "" : null,
                onchange: (event) => { state.shareMode = event.target.checked; renderLoaded(); }
            }),
            el("span", { text: "비율 보기" })
        ])
    ]);
}

function renderOverviewHero(context) {
    const { total, cost, pnl, previous, previousTotal, snapshot } = context;
    const segs = state.allocMode === "holding" ? holdingSegments() : categorySegments();
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : NaN;
    const changeAmount = previous ? total - previousTotal : NaN;
    const changePct = previous && previousTotal > 0 ? (changeAmount / previousTotal) * 100 : NaN;
    const invTotal = investmentTotal();
    const invPct = total > 0 ? (invTotal / total) * 100 : 0;

    return el("div", { class: "pf-card pf-overview-hero pf-area-hero" }, [
        el("div", { class: "pf-hero-left" }, [
            el("div", { class: "pf-alloc-toggle" }, [toggleButton("category", "분류별"), toggleButton("holding", "종목별")]),
            el("div", { class: "pf-hero-donut" }, [
                donutChart(segs, { centerLabel: snapshot?.as_of_date || "", centerValue: bigMoney(total), centerSub: "전체 자산" }),
                donutLegend(segs, total)
            ])
        ]),
        el("div", { class: "pf-kpis pf-hero-kpis" }, [
            kpiTile("총 자산", bigMoney(total), previous ? `이전 ${bigMoney(previousTotal)}` : "첫 시점", ""),
            kpiTile("평가손익", cost > 0 ? bigMoney(pnl) : "-", cost > 0 ? `수익률 ${pct(pnlPct)}` : "평단 미입력", cost > 0 ? (pnl >= 0 ? "plus" : "minus") : ""),
            kpiTile("전 시점 대비", previous ? pct(changePct) : "-", previous ? bigMoney(changeAmount) : "비교 대상 없음", previous ? (changeAmount >= 0 ? "plus" : "minus") : ""),
            kpiTile("투자 비중", ratio(invPct), `현금·제외 ${bigMoney(total - invTotal)}`, "")
        ])
    ]);
}

function renderRebalanceHero() {
    const invTotal = investmentTotal();
    const currentSegs = investmentCategorySegments();
    const targets = targetSegments();
    const adj = rebalanceAdjustment();
    const maxGap = [...adj.rows].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
    const targetSumOk = Math.abs(adj.targetSum - 100) <= 0.5;
    const drift = adj.rows.reduce((sum, row) => sum + Math.abs(row.gap), 0) / 2;
    const fit = Math.max(0, 100 - drift);

    return el("div", { class: "pf-card pf-overview-hero pf-area-hero" }, [
        el("div", { class: "pf-hero-left" }, [
            el("div", { class: "pf-donut-pair" }, [
                el("div", { class: "pf-donut-cell" }, [
                    el("h3", { text: "현재 배분" }),
                    donutChart(currentSegs, { size: 152, thickness: 22, centerValue: bigMoney(invTotal), centerSub: "투자자산" })
                ]),
                adj.hasTargets ? el("div", { class: "pf-donut-cell" }, [
                    el("h3", { text: "목표 배분" }),
                    donutChart(targets, { size: 152, thickness: 22, centerValue: `${adj.targetSum.toFixed(0)}%`, centerSub: "목표 합계" })
                ]) : null
            ]),
            donutLegend(currentSegs, invTotal)
        ]),
        el("div", { class: "pf-kpis pf-hero-kpis" }, [
            kpiTile("투자자산", bigMoney(invTotal), "리밸런싱 대상", ""),
            kpiTile("리밸런싱 필요", adj.hasTargets ? (adj.total > 0 ? bigMoney(adj.total) : "균형") : "-", adj.hasTargets ? "매수·매도 이동액" : "목표 미설정", adj.total > 0 ? "warn" : (adj.hasTargets ? "plus" : "")),
            kpiTile("최대 이탈", adj.hasTargets && maxGap ? maxGap.category : "-", adj.hasTargets && maxGap ? `${maxGap.gap >= 0 ? "+" : ""}${maxGap.gap.toFixed(1)}%p` : "", ""),
            kpiTile("목표 도달도", adj.hasTargets ? ratio(fit) : "-", targetSumOk ? "목표 합계 100%" : `목표 합계 ${adj.targetSum.toFixed(0)}%`, adj.hasTargets ? (fit >= 90 ? "plus" : (fit >= 70 ? "warn" : "minus")) : "")
        ])
    ]);
}

function toggleButton(mode, label) {
    return el("button", {
        class: `pf-toggle-btn ${state.allocMode === mode ? "active" : ""}`,
        type: "button",
        text: label,
        onclick: () => { state.allocMode = mode; renderLoaded(); }
    });
}

function kpiTile(label, value, helper, tone) {
    return el("div", { class: `pf-kpi ${tone}` }, [
        el("span", { class: "pf-kpi-label", text: label }),
        el("strong", { class: "pf-kpi-value", text: value }),
        el("small", { class: "pf-kpi-helper", text: helper })
    ]);
}

function rebalanceAdjustment() {
    const universeTotal = rebalanceTotal();
    const allocation = categoryAllocation(state.draftHoldings, { rebalanceOnly: true });
    const valueByCategory = new Map(allocation.map((item) => [item.category, item.value]));
    const categories = portfolioCategoryNames();
    const targetSum = categories.reduce((sum, category) => sum + categoryTarget(category), 0);
    const rows = categories.map((category) => {
        const actualValue = valueByCategory.get(category) || 0;
        const actualRatio = universeTotal > 0 ? (actualValue / universeTotal) * 100 : 0;
        const targetRatio = categoryTarget(category);
        const gap = targetRatio - actualRatio;
        const moveAmount = universeTotal * (gap / 100);
        return { category, actualRatio, targetRatio, gap, moveAmount, actualValue };
    });
    const total = rows.reduce((sum, row) => sum + Math.max(row.moveAmount, 0), 0);
    return { rows, total, targetSum, universeTotal, hasTargets: targetSum > 0 };
}

function renderRebalancePanel() {
    const data = rebalanceAdjustment();
    const body = data.hasTargets
        ? el("div", { class: "pf-rebal-list" }, data.rows
            .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
            .map((row) => renderRebalanceRow(row)))
        : el("div", { class: "pf-hint" }, [
            el("span", { text: "‘분류·목표’ 탭에서 각 분류의 목표 비중(%)을 설정하면, 목표까지 얼마를 사고 팔아야 하는지 계산해 드립니다." }),
            el("button", { class: "secondary-button compact", type: "button", text: "목표 설정하러 가기", onclick: () => { state.view = "categories"; renderLoaded(); } })
        ]);

    return el("section", { class: "pf-card pf-area-rebal" }, [
        el("div", { class: "pf-card-head" }, [
            el("h2", { text: "리밸런싱" }),
            data.hasTargets ? el("small", { class: Math.abs(data.targetSum - 100) > 0.5 ? "pf-warn-text" : "muted-text", text: `목표 합계 ${data.targetSum.toFixed(1)}%` }) : null
        ]),
        body
    ]);
}

function renderRebalanceRow(row) {
    const actualClamped = Math.max(0, Math.min(100, row.actualRatio));
    const targetClamped = Math.max(0, Math.min(100, row.targetRatio));
    const buy = row.moveAmount >= 0;
    return el("div", { class: "pf-rebal-row" }, [
        el("div", { class: "pf-rebal-head" }, [
            el("span", { class: "pf-rebal-name" }, [
                el("span", { class: "pf-legend-dot", style: `background:${categoryColor(row.category)}` }),
                el("span", { text: row.category })
            ]),
            Math.abs(row.moveAmount) >= 1
                ? el("strong", { class: buy ? "plus" : "minus", text: `${buy ? "매수 " : "매도 "}${moneyLabel(Math.abs(row.moveAmount))}` })
                : el("strong", { class: "muted-text", text: "유지" })
        ]),
        el("div", { class: "pf-rebal-track" }, [
            el("span", { class: "pf-rebal-fill", style: `width:${actualClamped}%;background:${categoryColor(row.category)}` }),
            el("span", { class: "pf-rebal-target", style: `left:${targetClamped}%`, title: `목표 ${row.targetRatio.toFixed(1)}%` })
        ]),
        el("div", { class: "pf-rebal-meta" }, [
            el("span", { text: `현재 ${row.actualRatio.toFixed(1)}%` }),
            el("span", { text: `목표 ${row.targetRatio.toFixed(1)}%` }),
            el("span", { class: row.gap >= 0 ? "plus" : "minus", text: `격차 ${row.gap >= 0 ? "+" : ""}${row.gap.toFixed(1)}%` })
        ])
    ]);
}

function renderHoldingsPanel(context) {
    const segs = holdingSegments();
    const total = context.total;
    const list = el("ol", { class: "pf-rank-list" }, segs.map((seg, index) => {
        const share = total > 0 ? (seg.value / total) * 100 : 0;
        const cost = holdingCost(seg.holding);
        const gainPct = cost > 0 ? ((holdingValue(seg.holding) - cost) / cost) * 100 : NaN;
        return el("li", { class: "pf-rank-row" }, [
            el("span", { class: "pf-rank-num", text: String(index + 1) }),
            el("span", { class: "pf-legend-dot", style: `background:${seg.color}` }),
            el("span", { class: "pf-rank-name" }, [
                el("strong", { text: seg.label }),
                el("small", { text: seg.holding.category || "미분류" })
            ]),
            el("span", { class: "pf-rank-share", text: `${share.toFixed(1)}%` }),
            el("span", { class: "pf-rank-value" }, [
                el("strong", { text: moneyLabel(seg.value) }),
                Number.isFinite(gainPct) ? el("small", { class: gainPct >= 0 ? "plus" : "minus", text: pct(gainPct) }) : null
            ])
        ]);
    }));

    return el("section", { class: "pf-card pf-area-holdings" }, [
        el("div", { class: "pf-card-head" }, [
            el("h2", { text: "종목 비중" }),
            el("small", { class: "muted-text", text: `${segs.length}종목` })
        ]),
        el("div", { class: "pf-holdings-grid" }, [
            el("div", { class: "pf-holdings-donut" }, [donutChart(segs, { size: 176, thickness: 26, centerValue: `${segs.length}`, centerSub: "종목" })]),
            list
        ])
    ]);
}

function renderOverviewTrend(context) {
    const ascending = snapshotsAscending();
    const single = ascending.length < 2;
    const linePoints = ascending.map((snapshot) => ({
        label: (snapshot.as_of_date || "").slice(2),
        value: displayValue(snapshotTotal(snapshot), context.total)
    }));
    const categories = orderedCategories({ investmentOnly: false });

    return el("section", { class: "pf-card pf-area-trend" }, [
        el("div", { class: "pf-card-head" }, [el("h2", { text: "자산 추이" })]),
        single
            ? el("div", { class: "pf-hint", text: "시점이 2개 이상이면 자산 추이와 배분 변화가 표시됩니다. 상단 ‘현재 시점 복사’로 다음 달 시점을 만들어 보세요." })
            : el("div", { class: "pf-trend-grid" }, [
                el("div", { class: "pf-trend-item" }, [el("h3", { text: "전체 자산 변화" }), lineChart(linePoints)]),
                el("div", { class: "pf-trend-item" }, [el("h3", { text: "분류 배분 변화 (전체 자산)" }), stackedBars(ascending, categories), categoryChartLegend(categories)])
            ])
    ]);
}

function renderRebalanceTrend() {
    const ascending = snapshotsAscending();
    const single = ascending.length < 2;
    const categories = orderedCategories({ investmentOnly: true });

    return el("section", { class: "pf-card pf-area-rebaltrend" }, [
        el("div", { class: "pf-card-head" }, [el("h2", { text: "투자 배분 추이" })]),
        single
            ? el("div", { class: "pf-hint", text: "시점이 2개 이상이면 투자자산 배분이 시점별로 어떻게 바뀌었는지 표시됩니다." })
            : el("div", { class: "pf-trend-item" }, [
                el("h3", { text: "분류 배분 변화 (투자자산만)" }),
                stackedBars(ascending, categories, { investmentOnly: true }),
                categoryChartLegend(categories)
            ])
    ]);
}

function renderOverviewStats(context) {
    const { total, cost, pnl } = context;
    const holdings = meaningfulHoldings();
    const alloc = categoryAllocation(state.draftHoldings, { rebalanceOnly: false });
    const sorted = [...holdings].sort((a, b) => holdingValue(b) - holdingValue(a));
    const largest = sorted[0];
    const top3 = sorted.slice(0, 3).reduce((sum, holding) => sum + holdingValue(holding), 0);
    const first = firstSnapshot();
    const firstTotal = first ? snapshotTotal(first) : 0;
    const sinceFirst = firstTotal > 0 ? ((total - firstTotal) / firstTotal) * 100 : NaN;
    const invTotal = investmentTotal();
    const excluded = total - invTotal;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : NaN;

    const tiles = [
        statTile("투자자산", bigMoney(invTotal), total > 0 ? `전체의 ${ratio((invTotal / total) * 100)}` : "", ""),
        statTile("현금·제외", bigMoney(excluded), total > 0 ? `전체의 ${ratio((excluded / total) * 100)}` : "", ""),
        statTile("평가손익", cost > 0 ? bigMoney(pnl) : "-", cost > 0 ? `수익률 ${pct(pnlPct)}` : "평단 미입력", cost > 0 ? (pnl >= 0 ? "plus" : "minus") : ""),
        statTile("최초 대비", Number.isFinite(sinceFirst) ? pct(sinceFirst) : "-", first ? `${first.as_of_date} 기준` : "기준 없음", Number.isFinite(sinceFirst) ? (sinceFirst >= 0 ? "plus" : "minus") : ""),
        statTile("최대 종목", largest ? (largest.name || "무제") : "-", largest ? ratio((holdingValue(largest) / Math.max(total, 1)) * 100) : "", ""),
        statTile("최대 분류", alloc[0] ? alloc[0].category : "-", alloc[0] ? ratio((alloc[0].value / Math.max(total, 1)) * 100) : "", ""),
        statTile("상위 3종목", total > 0 ? ratio((top3 / total) * 100) : "-", "집중도", top3 / Math.max(total, 1) > 0.6 ? "warn" : ""),
        statTile("종목 수", `${holdings.length}개`, `분류 ${alloc.length}개`, "")
    ];

    return el("section", { class: "pf-card pf-area-stats" }, [
        el("div", { class: "pf-card-head" }, [el("h2", { text: "요약 통계 (전체 자산)" })]),
        el("div", { class: "pf-stat-grid" }, tiles)
    ]);
}

function statTile(label, value, helper, tone) {
    return el("div", { class: `pf-stat ${tone}` }, [
        el("span", { class: "pf-stat-label", text: label }),
        el("strong", { class: "pf-stat-value", text: value }),
        helper ? el("small", { class: "pf-stat-helper", text: helper }) : null
    ]);
}

/* ------------------------------------------------------------- render: input */

function renderSnapshotEditor(snapshot) {
    return el("section", { class: "pf-card" }, [
        el("div", { class: "pf-card-head" }, [
            el("h2", { text: "시점 선택 · 정보" }),
            el("button", { class: "text-action danger", type: "button", text: "이 시점 삭제", onclick: deleteSnapshot })
        ]),
        el("div", { class: "portfolio-snapshot-form" }, [
            labeledField("불러올 시점", el("select", {
                class: "form-control",
                onchange: (event) => {
                    state.activeSnapshotId = event.target.value;
                    state.draftHoldings = normalizeDraft(activeSnapshot()?.portfolio_holdings || []);
                    renderLoaded();
                }
            }, sortedSnapshots().map((item) => el("option", {
                value: item.id,
                text: `${item.as_of_date} · ${item.label || "무제"}`,
                selected: item.id === snapshot.id ? "" : null
            })))),
            labeledField("날짜", el("input", { id: "portfolioSnapshotDate", class: "form-control", type: "date", value: snapshot.as_of_date })),
            labeledField("라벨", el("input", { id: "portfolioSnapshotLabel", class: "form-control", maxlength: "60", placeholder: "예: 7월 말", value: snapshot.label || "" })),
            labeledField("메모", el("input", { id: "portfolioSnapshotNote", class: "form-control", maxlength: "500", placeholder: "선택", value: snapshot.note || "" }))
        ])
    ]);
}

function labeledField(label, field) {
    return el("label", { class: "pf-field" }, [el("span", { text: label }), field]);
}

function renderHoldingsEditor(total) {
    return el("section", { class: "pf-card" }, [
        el("div", { class: "pf-card-head" }, [
            el("h2", { text: "보유 종목" }),
            el("button", { class: "secondary-button compact", type: "button", text: "+ 종목 추가", onclick: addHoldingRow })
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
                el("tr", {}, ["종목", "분류", "단가", "수량", "평가금액", "비중", "평단", "손익", ""].map((text) => el("th", { text })))
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
        el("td", {}, [el("input", { class: "form-control", placeholder: "종목명", value: holding.name, oninput: (event) => updateHolding(index, "name", event.target.value) })]),
        el("td", {}, [el("select", { class: "form-control", onchange: (event) => updateHolding(index, "category", event.target.value) }, categoryOptions(holding.category))]),
        el("td", {}, [moneyInput(holding.price, (v) => updateCalculatedHolding(index, "price", v), "portfolio-price-input")]),
        el("td", {}, [moneyInput(holding.quantity, (v) => updateCalculatedHolding(index, "quantity", v), "portfolio-quantity-input")]),
        el("td", {}, [moneyInput(value, (v) => updateCalculatedHolding(index, "market_value", v), "portfolio-value-input")]),
        el("td", { class: "portfolio-ratio-cell", text: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "-" }),
        el("td", {}, [moneyInput(holding.avg_cost, (v) => { updateHolding(index, "avg_cost", num(v)); syncDraftMetrics(); }, "portfolio-cost-input")]),
        el("td", { class: `portfolio-gain portfolio-gain-cell ${gain >= 0 ? "plus" : "minus"}`, text: cost > 0 ? money(gain) : "-" }),
        el("td", { class: "portfolio-row-actions" }, [
            el("label", { class: "mini-check", title: "리밸런싱 계산에 포함" }, [
                el("input", {
                    type: "checkbox",
                    checked: holding.include_in_rebalance !== false ? "" : null,
                    onchange: (event) => { updateHolding(index, "include_in_rebalance", event.target.checked); syncDraftMetrics(); }
                }),
                el("span", { text: "계산" })
            ]),
            el("button", { class: "text-action danger", type: "button", text: "삭제", onclick: () => removeHoldingRow(index) })
        ])
    ]);
}

function categoryOptions(selected) {
    const names = portfolioCategoryNames();
    if (selected && !names.includes(selected)) names.push(selected);
    return names.map((name) => el("option", { value: name, text: name, selected: name === selected ? "" : null }));
}

function moneyInput(value, oninput, extraClass = "") {
    return el("input", {
        class: `form-control numeric-input ${extraClass}`.trim(),
        type: "text",
        inputmode: "decimal",
        value: value || "",
        onchange: (event) => oninput(event.target.value)
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

/* -------------------------------------------------------- render: categories */

function renderCategoryManager() {
    const targetSum = state.categoryDrafts.reduce((sum, category) => sum + num(category.target_ratio), 0);
    return el("section", { class: "pf-card" }, [
        el("div", { class: "pf-card-head" }, [
            el("h2", { text: "분류 · 목표 비중" }),
            el("div", { class: "portfolio-inline-actions" }, [
                el("small", { class: Math.abs(targetSum - 100) > 0.5 && targetSum > 0 ? "pf-warn-text" : "muted-text", text: `목표 합계 ${targetSum.toFixed(1)}%` }),
                el("button", { class: "secondary-button compact", type: "button", text: "+ 분류 추가", onclick: addCategoryDraft })
            ])
        ]),
        el("p", { class: "pf-hint-text", text: "각 분류의 색상과 목표 비중(%)을 정하세요. 목표 비중 합계를 100%로 맞추면 리밸런싱이 정확해집니다." }),
        el("div", { class: "category-editor-list" }, state.categoryDrafts.map((category, index) => renderCategoryEditorRow(category, index)))
    ]);
}

function renderCategoryEditorRow(category, index) {
    return el("div", { class: "category-editor-row" }, [
        el("input", { class: "form-control category-color-input", type: "color", value: category.color || paletteColor(index), onchange: (event) => updateCategoryDraft(index, "color", event.target.value) }),
        el("input", { class: "form-control", value: category.name, maxlength: "40", placeholder: "분류명", onchange: (event) => renameCategory(index, event.target.value) }),
        el("div", { class: "target-editor" }, [
            el("span", { text: "목표" }),
            moneyInput(category.target_ratio, (value) => updateCategoryDraft(index, "target_ratio", Math.max(0, Math.min(100, num(value)))), "target-input"),
            el("span", { text: "%" })
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
    if (key === "target_ratio" || key === "color") syncCategoryTargetSum();
}

function syncCategoryTargetSum() {
    const targetSum = state.categoryDrafts.reduce((sum, category) => sum + num(category.target_ratio), 0);
    const label = document.querySelector(".portfolio-inline-actions small");
    if (label) {
        label.textContent = `목표 합계 ${targetSum.toFixed(1)}%`;
        label.className = Math.abs(targetSum - 100) > 0.5 && targetSum > 0 ? "pf-warn-text" : "muted-text";
    }
}

function renameCategory(index, value) {
    const category = state.categoryDrafts[index];
    if (!category) return;
    const previous = category.name;
    const next = value.trim() || previous;
    category.name = next;
    state.draftHoldings.forEach((holding) => { if (holding.category === previous) holding.category = next; });
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
    state.draftHoldings.forEach((holding) => { if (holding.category === category.name) holding.category = fallback; });
    renderLoaded();
}

/* --------------------------------------------------------------- entrypoints */

export function cleanupPortfolio() {
    // No global listeners/timers to release in the SVG-based version.
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
    } catch (error) {
        const panel = renderShell();
        panel.append(renderHeader(), el("div", { class: "portfolio-error", text: error.message }));
    } finally {
        state.loading = false;
    }
}
