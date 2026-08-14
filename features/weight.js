// features/weight.js — 체중, a weight-over-time line chart (canvas) for each
// tracked person. Data comes from Supabase (weight_people + weight_records).
//
// Two fixed granularities (주/일), no zoom: each view buckets the same full
// history by week or day and plots one dot per bucket,
// whose value is the plain mean of the records inside it. Nothing is smoothed,
// interpolated or projected — every plotted value is measured data.
//
// The x axis is real time: a bucket sits at its period's start, so the gap
// between two dots is proportional to the time between them. The plot is sized
// from the span at a per-view pixels-per-day scale rather than squeezed into the
// viewport — it grows as wide as the history needs and pans by dragging,
// opening on the most recent bucket. The y axis is a separate pinned canvas so
// it stays readable while the plot moves under it.
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
    { key: "week", label: "주" },
    { key: "day", label: "일" }
];
const DEFAULT_VIEW = "week";
const dayMs = 24 * 60 * 60 * 1000;
// How much horizontal room one day of elapsed time gets, per view. Sets the
// plot's total width: coarser views compress time harder so their whole
// history stays reachable in a few drags.
const PX_PER_DAY = {
    week: 5,
    day: 14
};
const MAX_PLOT_PX = 16000;

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

// Buckets are keyed per person but share one timeline, so the same period lands
// at the same x for everyone.
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

    const series = perPerson
        .map(({ person, buckets }) => ({
            ...person,
            points: [...buckets.values()].sort((a, b) => a.periodStart - b.periodStart)
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

function getBounds(series, slots) {
    const weights = series.flatMap((person) => person.points).map((point) => point.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const weightRange = Math.max(maxWeight - minWeight, 1);
    const yTicks = niceWeightTicks(minWeight - weightRange * 0.16, maxWeight + weightRange * 0.16);

    return {
        minTime: slots[0].periodStart,
        maxTime: slots[slots.length - 1].periodStart,
        minWeight: yTicks[0],
        maxWeight: yTicks[yTicks.length - 1],
        yTicks
    };
}

// iOS caps a canvas's total backing area (~16.7M px) and renders nothing past
// it. A long history at full device pixel ratio blows through that, so trade
// crispness for a chart that actually draws.
const MAX_CANVAS_AREA = 8000000;

function sizeToDpr(target, context, width, height) {
    const wanted = window.devicePixelRatio || 1;
    const area = width * height;
    const dpr = area > 0 ? Math.min(wanted, Math.sqrt(MAX_CANVAS_AREA / area)) : wanted;

    target.width = Math.round(width * dpr);
    target.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Width comes from the elapsed time on show, so equal time is equal distance
// everywhere on the axis. Anything past the container is what pans.
function resizeCanvas(spanMs) {
    const available = scroller.clientWidth;
    const needed = padding.left + padding.right + (spanMs / dayMs) * PX_PER_DAY[activeView];
    // Browsers refuse to allocate a canvas past ~32k px on a side; clamp well
    // short of it. Only a history far longer than this site's would hit it, and
    // a compressed axis beats a blank one.
    const width = Math.min(Math.max(available, Math.round(needed)), MAX_PLOT_PX);
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
        x(periodStart) {
            const span = bounds.maxTime - bounds.minTime;
            // A single bucket has no span to spread across, so centre it.
            const ratio = span <= 0 ? 0.5 : (periodStart - bounds.minTime) / span;
            return padding.left + ratio * width;
        },
        y(weight) {
            const ratio = (weight - bounds.minWeight) / (bounds.maxWeight - bounds.minWeight);
            return padding.top + height - ratio * height;
        }
    };
}

// --- drawing ---------------------------------------------------------------

// X labels are the bucket slots themselves. Buckets are no longer evenly
// spaced, so thin by actual pixel distance rather than by count: keep a slot
// only once it clears the last kept label. The most recent bucket always keeps
// its label, and yields to nothing.
function axisTicks(slots, scales, minGapPx) {
    const kept = [];
    for (const bucket of slots) {
        const x = scales.x(bucket.periodStart);
        if (kept.length === 0 || x - kept[kept.length - 1].x >= minGapPx) {
            kept.push({ label: bucket.axisLabel, periodStart: bucket.periodStart, x });
        }
    }

    const last = slots[slots.length - 1];
    if (kept[kept.length - 1].periodStart !== last.periodStart) {
        const x = scales.x(last.periodStart);
        if (x - kept[kept.length - 1].x < minGapPx) kept.pop();
        kept.push({ label: last.axisLabel, periodStart: last.periodStart, x });
    }
    return kept;
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
    const ticks = axisTicks(slots, scales, 84);
    ticks.forEach((tick, index) => {
        const x = tick.x;

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
            x: scales.x(point.periodStart),
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
    const span = hasData ? slots[slots.length - 1].periodStart - slots[0].periodStart : 0;
    const rect = resizeCanvas(span);

    emptyState.hidden = hasData;
    tooltip.hidden = true;
    syncControls();

    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        axisCtx.clearRect(0, 0, padding.left, rect.height);
        plottedPoints = [];
        return;
    }

    const bounds = getBounds(series, slots);
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
