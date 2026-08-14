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
// Sanity bound on the timeline's width, so an absurd span can't produce a plot
// that takes hundreds of drags to cross.
const MAX_PLOT_PX = 16000;

let canvas = null;
let ctx = null;
let axisCanvas = null;
let axisCtx = null;
let scroller = null;
let track = null;
let scrollHandler = null;
let scrollFrame = null;
let lastFrame = null;
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

// A stable per-view key, the label shown in the tooltip, and the period's
// start, which is what places the bucket on the time axis.
function bucketOf(date, view) {
    if (view === "week") {
        const monday = startOfWeek(date);
        const month = monday.getMonth() + 1;
        const day = monday.getDate();
        return {
            key: `w${monday.getFullYear()}-${month}-${day}`,
            fullLabel: `${monday.getFullYear()}년 ${month}월 ${day}일 주간`,
            periodStart: monday.getTime()
        };
    }
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return {
        key: `d${date.getFullYear()}-${month}-${day}`,
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

function sizeToDpr(target, context, width, height) {
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(width * dpr);
    target.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return dpr;
}

// The track carries the full timeline width — that overflow is what pans. The
// canvas itself stays viewport-sized and pinned, and redraws at an offset as
// the track scrolls under it. Drawing a plot-wide canvas instead would force
// the backing store down to a fraction of the device pixel ratio to stay inside
// the browser's canvas limits, which is what made the 일 line look stepped.
function resizeCanvas(spanMs) {
    const viewWidth = scroller.clientWidth;
    const height = scroller.clientHeight;
    const needed = padding.left + padding.right + (spanMs / dayMs) * PX_PER_DAY[activeView];
    const plotWidth = Math.min(Math.max(viewWidth, Math.round(needed)), MAX_PLOT_PX);

    track.style.width = `${plotWidth}px`;
    canvas.style.width = `${viewWidth}px`;
    sizeToDpr(canvas, ctx, viewWidth, height);
    sizeToDpr(axisCanvas, axisCtx, padding.left, height);

    return { width: plotWidth, viewWidth, height };
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

// Whole numbers of weeks, so 주 ticks always land on the same weekday.
const TICK_STEPS_DAYS = [1, 2, 3, 7, 14, 21, 28, 56, 91, 182, 364];

// Gridlines are drawn on a fixed calendar interval, not at the buckets. Deriving
// them from the data put the lines at whatever irregular dates happened to have
// records, which gives an axis with no consistent scale to read against.
function axisTicks(bounds, minGapPx) {
    const perDay = PX_PER_DAY[activeView];
    const stepDays = TICK_STEPS_DAYS.find((days) => days * perDay >= minGapPx)
        || TICK_STEPS_DAYS[TICK_STEPS_DAYS.length - 1];
    const step = stepDays * dayMs;

    // Anchor on the most recent bucket and walk back, so the newest data — the
    // part actually being read — always sits on a labelled line.
    const ticks = [];
    for (let t = bounds.maxTime; t >= bounds.minTime; t -= step) {
        const date = new Date(t);
        ticks.push({ time: t, label: `${date.getMonth() + 1}/${date.getDate()}` });
    }
    return ticks.reverse();
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

function drawGrid(rect, bounds, scales) {
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
    ctx.textAlign = "center";
    for (const tick of axisTicks(bounds, 84)) {
        const x = scales.x(tick.time);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, rect.height - padding.bottom);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.fillText(tick.label, x, rect.height - padding.bottom + 15);
    }
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
        ctx.clearRect(0, 0, rect.viewWidth, rect.height);
        axisCtx.clearRect(0, 0, padding.left, rect.height);
        plottedPoints = [];
        lastFrame = null;
        return;
    }

    // Open on the most recent bucket, the one you actually came to look at.
    if (!keepScroll) scroller.scrollLeft = scroller.scrollWidth;
    canvas.classList.toggle("is-pannable", scroller.scrollWidth > scroller.clientWidth);

    lastFrame = { series, rect, bounds: getBounds(series, slots) };
    paintFrame();
}

// Everything is drawn in timeline coordinates; the canvas is just a moving
// window onto them, so panning only re-runs this.
function paintFrame() {
    if (!lastFrame || !canvas || !ctx) return;
    const { series, rect, bounds } = lastFrame;
    const offset = scroller.scrollLeft;
    const scales = createScales(rect, bounds);

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.viewWidth, rect.height);
    ctx.translate(-offset, 0);

    drawAxis(rect, bounds, scales);
    drawGrid(rect, bounds, scales);
    drawSeries(series, scales, rect);
}

function nearestPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const pointer = {
        // the canvas is pinned to the scrollport, so add the scroll offset to
        // get back into timeline coordinates
        x: event.clientX - rect.left + scroller.scrollLeft,
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

    // The tooltip lives outside the scroller, so convert the point back from
    // timeline coordinates to a position within the chart frame.
    tooltip.hidden = false;
    const frame = tooltip.parentElement.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const viewX = point.x - scroller.scrollLeft;
    const half = width / 2;

    // Keep it inside the frame rather than letting it hang off the panel.
    tooltip.style.left = `${Math.min(Math.max(viewX, half), Math.max(frame.width - half, half))}px`;

    // Flip below the dot when there is no room above.
    const flip = point.y - tooltip.offsetHeight - 12 < 0;
    tooltip.classList.toggle("is-below", flip);
    tooltip.style.top = `${point.y}px`;
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
                    el("div", { class: "chart-track", id: "weightTrack" }, [
                        el("canvas", { id: "weightChart", "aria-label": "시간별 체중 변화 선 그래프" })
                    ])
                ]),
                // outside the scroller: inside it, a tooltip near either edge
                // gets clipped by the overflow
                el("div", { class: "tooltip", id: "weightTooltip", hidden: "" }),
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
        // Repaint straight from the drag rather than waiting on the scroll
        // event, so the plot tracks the pointer with no lag.
        paintFrame();
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

    // Panning moves the window, so repaint with the new offset — coalesced to
    // one repaint per frame.
    scrollHandler = () => {
        // its position was resolved against the old offset
        tooltip.hidden = true;
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(() => {
            scrollFrame = null;
            paintFrame();
        });
    };
    scroller.addEventListener("scroll", scrollHandler, { passive: true });
}

export function cleanupWeightTracker() {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    if (scrollHandler && scroller) scroller.removeEventListener("scroll", scrollHandler);
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    resizeHandler = null;
    scrollHandler = null;
    scrollFrame = null;
    lastFrame = null;
    drag = null;
    dragMoved = false;
    canvas = null;
    ctx = null;
    axisCanvas = null;
    axisCtx = null;
    scroller = null;
    track = null;
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
    track = document.getElementById("weightTrack");
    tooltip = document.getElementById("weightTooltip");
    emptyState = document.getElementById("weightEmptyState");
    legend = document.getElementById("weightLegend");
    plottedPoints = [];
    bindControls();

    // Coming back to the tab: paint the records we already have straight away
    // and refresh underneath, rather than showing a spinner for data that has
    // almost certainly not changed.
    const hadData = weightData.length > 0;
    if (hadData) {
        renderLegend();
        renderChart();
    } else {
        emptyState.hidden = false;
        emptyState.textContent = "불러오는 중...";
    }

    try {
        await loadWeightData();
        if (!canvas) return; // left the tab while loading
        renderLegend();
        renderChart({ keepScroll: hadData });
    } catch (error) {
        console.warn(error);
        if (!canvas || hadData) return; // keep showing what we had
        emptyState.hidden = false;
        emptyState.textContent = "체중 데이터를 불러오지 못했습니다.";
    }
}
