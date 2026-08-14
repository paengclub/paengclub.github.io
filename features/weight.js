// features/weight.js — 체중, a weight-over-time line chart (canvas) for each
// tracked person. Data comes from Supabase (weight_people + weight_records).
//
// Three fixed granularities (연/주/일), no zoom and no pan: each view buckets
// the same full history by year / week / day and plots one dot per bucket,
// whose value is the plain mean of the records inside it. Nothing is smoothed,
// interpolated or projected — every plotted value is measured data.
//
// The x axis is categorical: one equal slot per bucket, shared by both people.
// It is deliberately not time-proportional — this data is a handful of records
// spread over months followed by near-daily ones, which on a time axis collapses
// every recent bucket into a few pixels.
//
// Slots keep a minimum width, so when they don't all fit the plot grows wider
// than its container and scrolls horizontally (opening at the most recent
// bucket). The y axis is a separate pinned canvas so it stays readable while
// the plot scrolls under it.
// Exports renderWeightTracker, cleanupWeightTracker.
import { supabase } from "/supabaseClient.js";
import { el } from "/lib/dom.js";
import { cssVar, num } from "/lib/format.js";

const padding = {
    top: 22,
    right: 22,
    bottom: 44,
    left: 56
};

const VIEWS = [
    { key: "year", label: "연" },
    { key: "week", label: "주" },
    { key: "day", label: "일" }
];
const DEFAULT_VIEW = "week";
// Narrowest a bucket slot may get before the plot starts scrolling instead of
// squeezing. Roughly a comfortable tap target.
const MIN_SLOT_PX = 46;

let canvas = null;
let ctx = null;
let axisCanvas = null;
let axisCtx = null;
let scroller = null;
let tooltip = null;
let emptyState = null;
let legend = null;
let activeView = DEFAULT_VIEW;
let plottedPoints = [];
let weightData = [];
let resizeHandler = null;
let drag = null;
let dragMoved = false;

function parseDate(date) {
    return new Date(`${date}T00:00:00`);
}

function kg(weight) {
    return `${weight.toFixed(1)}kg`;
}

// --- bucketing -------------------------------------------------------------

function startOfWeek(date) {
    const start = new Date(date);
    // Monday-based: getDay() is 0=Sun, so shift Sunday to the end of the week.
    start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return start;
}

// A stable per-view key, the labels shown on the axis and in the tooltip, and
// the period's start — used to order buckets on the axis.
function bucketOf(date, view) {
    if (view === "year") {
        const year = date.getFullYear();
        return {
            key: `${year}`,
            axisLabel: `${year}`,
            fullLabel: `${year}년`,
            periodStart: new Date(year, 0, 1).getTime()
        };
    }
    if (view === "week") {
        const monday = startOfWeek(date);
        const month = monday.getMonth() + 1;
        const day = monday.getDate();
        return {
            key: `w${monday.getFullYear()}-${month}-${day}`,
            axisLabel: `${month}/${day}`,
            fullLabel: `${monday.getFullYear()}년 ${month}월 ${day}일 주간`,
            periodStart: monday.getTime()
        };
    }
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return {
        key: `d${date.getFullYear()}-${month}-${day}`,
        axisLabel: `${month}/${day}`,
        fullLabel: `${date.getFullYear()}년 ${month}월 ${day}일`,
        periodStart: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    };
}

// Collapse a person's records into one entry per bucket, keyed by bucket. The
// entry's weight is the plain mean of the records inside it.
function bucketRecords(records, view) {
    const buckets = new Map();

    for (const record of records) {
        const date = parseDate(record.date);
        const meta = bucketOf(date, view);
        if (!buckets.has(meta.key)) buckets.set(meta.key, { ...meta, weights: [] });
        buckets.get(meta.key).weights.push(record.weight);
    }

    for (const bucket of buckets.values()) {
        bucket.count = bucket.weights.length;
        bucket.weight = bucket.weights.reduce((sum, weight) => sum + weight, 0) / bucket.count;
    }

    return buckets;
}

// Every bucket gets an equal slot on the axis, so one week reads as one step
// regardless of how much clock time separates it from the next. A
// time-proportional axis is unusable here: the early records are months apart
// and would squeeze every recent bucket into a few pixels. Slots are shared
// across people, so both series line up on the same bucket.
function buildChartModel() {
    const perPerson = weightData.map((person) => ({
        person,
        buckets: bucketRecords(person.records, activeView)
    }));

    const axis = new Map();
    for (const { buckets } of perPerson) {
        for (const bucket of buckets.values()) {
            if (!axis.has(bucket.key)) axis.set(bucket.key, bucket);
        }
    }

    const slots = [...axis.values()].sort((a, b) => a.periodStart - b.periodStart);
    const indexOf = new Map(slots.map((bucket, index) => [bucket.key, index]));

    const series = perPerson
        .map(({ person, buckets }) => ({
            ...person,
            points: [...buckets.values()]
                .map((bucket) => ({ ...bucket, index: indexOf.get(bucket.key) }))
                .sort((a, b) => a.index - b.index)
        }))
        .filter((person) => person.points.length > 0);

    return { series, slots };
}

// --- scales ----------------------------------------------------------------

function niceStep(rawStep) {
    if (!Number.isFinite(rawStep) || rawStep <= 0) {
        return 1;
    }

    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;

    if (normalized <= 1) {
        return magnitude;
    }
    if (normalized <= 2) {
        return 2 * magnitude;
    }
    if (normalized <= 2.5) {
        return 2.5 * magnitude;
    }
    if (normalized <= 5) {
        return 5 * magnitude;
    }
    return 10 * magnitude;
}

function niceWeightTicks(minWeight, maxWeight, targetCount = 5) {
    const span = Math.max(maxWeight - minWeight, 0.5);
    const step = Math.max(0.1, niceStep(span / targetCount));
    const start = Math.floor(minWeight / step) * step;
    const end = Math.ceil(maxWeight / step) * step;
    const ticks = [];

    for (let value = start; value <= end + step / 2; value += step) {
        ticks.push(Math.round(value * 10) / 10);
    }

    return ticks;
}

function getBounds(series, slotCount) {
    const weights = series.flatMap((person) => person.points).map((point) => point.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const weightRange = Math.max(maxWeight - minWeight, 1);
    const yTicks = niceWeightTicks(minWeight - weightRange * 0.16, maxWeight + weightRange * 0.16);

    return {
        slotCount,
        minWeight: yTicks[0],
        maxWeight: yTicks[yTicks.length - 1],
        yTicks
    };
}

function sizeToDpr(target, context, width, height) {
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(width * dpr);
    target.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Widen the plot past its container when the slots need more room than fits —
// that overflow is what the scroller scrolls.
function resizeCanvas(slotCount) {
    const available = scroller.clientWidth;
    const needed = padding.left + padding.right + Math.max(slotCount - 1, 1) * MIN_SLOT_PX;
    const width = Math.max(available, needed);
    const height = scroller.clientHeight;

    canvas.style.width = `${width}px`;
    sizeToDpr(canvas, ctx, width, height);
    sizeToDpr(axisCanvas, axisCtx, padding.left, height);

    return { width, height };
}

function createScales(rect, bounds) {
    const width = rect.width - padding.left - padding.right;
    const height = rect.height - padding.top - padding.bottom;
    return {
        x(index) {
            // A lone bucket has no span to spread across, so centre it.
            const ratio = bounds.slotCount <= 1 ? 0.5 : index / (bounds.slotCount - 1);
            return padding.left + ratio * width;
        },
        y(weight) {
            const ratio = (weight - bounds.minWeight) / (bounds.maxWeight - bounds.minWeight);
            return padding.top + height - ratio * height;
        }
    };
}

// --- drawing ---------------------------------------------------------------

// X labels are the bucket slots themselves, thinned to whatever fits. The last
// slot always gets a label so the axis ends on the most recent bucket.
function axisTicks(slots, maxTicks) {
    const ticks = slots.map((bucket, index) => ({ label: bucket.axisLabel, index }));
    if (ticks.length <= maxTicks) return ticks;

    const stride = Math.ceil(ticks.length / maxTicks);
    const thinned = ticks.filter((tick) => tick.index % stride === 0);
    const last = ticks[ticks.length - 1];
    if (thinned[thinned.length - 1].index !== last.index) {
        // Drop a label rather than let the final two collide.
        if (last.index - thinned[thinned.length - 1].index < stride / 2) thinned.pop();
        thinned.push(last);
    }
    return thinned;
}

// The y labels live on their own canvas pinned over the left edge, so they stay
// put while the plot scrolls beneath them.
function drawAxis(rect, bounds, scales) {
    axisCtx.clearRect(0, 0, padding.left, rect.height);
    axisCtx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    axisCtx.textBaseline = "middle";
    axisCtx.textAlign = "right";
    axisCtx.fillStyle = cssVar("--app-muted");

    for (const weight of bounds.yTicks) {
        axisCtx.fillText(kg(weight), padding.left - 10, scales.y(weight));
    }
}

function drawGrid(rect, bounds, scales, slots) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 1;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

    for (const weight of bounds.yTicks) {
        const y = scales.y(weight);
        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(rect.width - padding.right, y);
        ctx.stroke();
    }

    ctx.textBaseline = "top";
    // A wider plot has room for more labels; keep roughly one per 110px.
    const ticks = axisTicks(slots, Math.max(3, Math.floor(rect.width / 110)));
    ticks.forEach((tick, index) => {
        const x = scales.x(tick.index);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, rect.height - padding.bottom);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.textAlign = index === 0 ? "left" : index === ticks.length - 1 ? "right" : "center";
        ctx.fillText(tick.label, x, rect.height - padding.bottom + 15);
    });
}

function drawSeries(series, scales, rect) {
    plottedPoints = [];

    ctx.save();
    ctx.beginPath();
    ctx.rect(
        padding.left,
        padding.top,
        rect.width - padding.left - padding.right,
        rect.height - padding.top - padding.bottom
    );
    ctx.clip();

    series.forEach((person) => {
        const points = person.points.map((point) => ({
            ...point,
            x: scales.x(point.index),
            y: scales.y(point.weight),
            personName: person.name,
            color: person.color
        }));

        ctx.strokeStyle = person.color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();

        points.forEach((point) => {
            plottedPoints.push(point);
            ctx.fillStyle = cssVar("--app-surface-strong");
            ctx.strokeStyle = person.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    });

    ctx.restore();
}

// --- render orchestration --------------------------------------------------

function renderChart({ keepScroll = false } = {}) {
    if (!canvas || !ctx) return;
    const { series, slots } = buildChartModel();
    const hasData = series.length > 0;
    const rect = resizeCanvas(slots.length);

    emptyState.hidden = hasData;
    tooltip.hidden = true;
    syncControls();

    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        axisCtx.clearRect(0, 0, padding.left, rect.height);
        plottedPoints = [];
        return;
    }

    const bounds = getBounds(series, slots.length);
    const scales = createScales(rect, bounds);
    drawAxis(rect, bounds, scales);
    drawGrid(rect, bounds, scales, slots);
    drawSeries(series, scales, rect);

    // Open on the most recent bucket, the one you actually came to look at.
    if (!keepScroll) scroller.scrollLeft = scroller.scrollWidth;
    canvas.classList.toggle("is-pannable", scroller.scrollWidth > scroller.clientWidth);
}

function nearestPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };

    return plottedPoints
        .map((point) => ({
            ...point,
            distance: Math.hypot(point.x - pointer.x, point.y - pointer.y)
        }))
        .filter((point) => point.distance <= 32)
        .sort((a, b) => a.distance - b.distance)[0];
}

function showTooltip(point) {
    if (!point) {
        tooltip.hidden = true;
        return;
    }

    // Say how many records went into the average, so a dot is never mistaken
    // for a single measurement.
    const detail = point.count > 1
        ? `${point.fullLabel} · ${kg(point.weight)} · ${point.count}회 평균`
        : `${point.fullLabel} · ${kg(point.weight)}`;

    tooltip.replaceChildren(
        el("strong", { text: point.personName }),
        document.createTextNode(detail)
    );
    tooltip.style.left = `${point.x}px`;
    tooltip.style.top = `${point.y}px`;
    tooltip.hidden = false;
}

function selectView(view) {
    activeView = view;
    renderChart();
}

function syncControls() {
    document.querySelectorAll("[data-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.view === activeView));
    });
}

async function loadWeightData() {
    const [peopleResult, recordsResult] = await Promise.all([
        supabase
            .from("weight_people")
            .select("id, name, goal, color, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true }),
        supabase
            .from("weight_records")
            .select("person_id, record_date, weight, memo")
            .order("record_date", { ascending: true })
    ]);

    if (peopleResult.error) throw peopleResult.error;
    if (recordsResult.error) throw recordsResult.error;

    const recordsByPerson = new Map();
    for (const record of recordsResult.data || []) {
        if (!recordsByPerson.has(record.person_id)) recordsByPerson.set(record.person_id, []);
        recordsByPerson.get(record.person_id).push({
            date: record.record_date,
            weight: num(record.weight),
            memo: record.memo || ""
        });
    }

    weightData = (peopleResult.data || []).map((person) => ({
        id: person.id,
        name: person.name,
        goal: person.goal,
        color: person.color,
        records: recordsByPerson.get(person.id) || []
    }));
}

function renderLegend() {
    legend.replaceChildren(
        ...weightData.map((person) => {
            return el("span", { class: "legend-item" }, [
                el("span", { class: "swatch" }),
                el("span", { text: `${person.name} (${person.goal === "loss" ? "감량" : "증량"})` })
            ]);
        })
    );

    [...legend.querySelectorAll(".swatch")].forEach((swatch, index) => {
        swatch.style.background = weightData[index].color;
    });
}

function renderShell() {
    const root = document.getElementById("screen");
    const wrapper = el("section", { class: "page-shell weight-shell" });
    const panel = el("div", { class: "app-panel weight-panel" });
    const controls = el("nav", { class: "weight-controls", "aria-label": "그래프 단위" },
        VIEWS.map((view) => el("button", {
            type: "button",
            "data-view": view.key,
            text: view.label
        }))
    );

    panel.append(
        el("div", { class: "section-header weight-header" }, [
            el("div", {}, [el("h1", { class: "section-title", text: "체중" })]),
            controls
        ]),
        el("section", { class: "weight-chart-shell", "aria-label": "체중 추이 그래프" }, [
            el("div", { class: "legend", id: "weightLegend" }),
            el("div", { class: "chart-wrap" }, [
                el("canvas", { id: "weightAxis", class: "chart-axis", "aria-hidden": "true" }),
                el("div", { class: "chart-scroll", id: "weightScroll" }, [
                    el("canvas", { id: "weightChart", "aria-label": "시간별 체중 변화 선 그래프" }),
                    el("div", { class: "tooltip", id: "weightTooltip", hidden: "" })
                ]),
                el("div", { class: "empty", id: "weightEmptyState", hidden: "", text: "표시할 데이터가 없습니다." })
            ])
        ])
    );
    wrapper.appendChild(panel);
    root.appendChild(wrapper);
}

function bindControls() {
    document.querySelectorAll("[data-view]").forEach((button) => {
        button.addEventListener("click", () => selectView(button.dataset.view));
    });

    canvas.addEventListener("mousemove", (event) => {
        if (drag) return;
        showTooltip(nearestPoint(event));
    });
    canvas.addEventListener("mouseleave", () => {
        tooltip.hidden = true;
    });
    // click/tap so touch devices (no hover) can still read a point's exact value
    canvas.addEventListener("click", (event) => {
        // ignore the click that ends a pan
        if (dragMoved) return;
        showTooltip(nearestPoint(event));
    });

    // Grab-and-drag panning, in place of a scrollbar.
    canvas.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (scroller.scrollWidth <= scroller.clientWidth) return;
        drag = { x: event.clientX, from: scroller.scrollLeft };
        dragMoved = false;
        tooltip.hidden = true;
        // capture keeps the pan alive if the pointer leaves the canvas; not
        // being able to capture is not a reason to abandon the drag
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (error) {
            /* no active pointer to capture */
        }
        canvas.classList.add("is-grabbing");
    });

    canvas.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const delta = event.clientX - drag.x;
        if (Math.abs(delta) > 3) dragMoved = true;
        scroller.scrollLeft = drag.from - delta;
    });

    const endDrag = (event) => {
        if (!drag) return;
        drag = null;
        canvas.classList.remove("is-grabbing");
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    resizeHandler = () => renderChart({ keepScroll: true });
    window.addEventListener("resize", resizeHandler);
}

export function cleanupWeightTracker() {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
    drag = null;
    dragMoved = false;
    canvas = null;
    ctx = null;
    axisCanvas = null;
    axisCtx = null;
    scroller = null;
    tooltip = null;
    emptyState = null;
    legend = null;
}

export async function renderWeightTracker() {
    cleanupWeightTracker();
    const root = document.getElementById("screen");
    if (!root) return;
    root.replaceChildren();
    renderShell();

    canvas = document.getElementById("weightChart");
    ctx = canvas.getContext("2d");
    axisCanvas = document.getElementById("weightAxis");
    axisCtx = axisCanvas.getContext("2d");
    scroller = document.getElementById("weightScroll");
    tooltip = document.getElementById("weightTooltip");
    emptyState = document.getElementById("weightEmptyState");
    legend = document.getElementById("weightLegend");
    activeView = DEFAULT_VIEW;
    plottedPoints = [];

    try {
        emptyState.hidden = false;
        emptyState.textContent = "불러오는 중...";
        await loadWeightData();
        bindControls();
        renderLegend();
        renderChart();
    } catch (error) {
        console.warn(error);
        emptyState.hidden = false;
        emptyState.textContent = "체중 데이터를 불러오지 못했습니다.";
    }
}
