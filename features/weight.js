// features/weight.js — 체중, a weight-over-time line chart (canvas) for each
// tracked person. Data comes from Supabase (weight_people + weight_records).
//
// Three fixed granularities (연/주/일), no zoom and no pan: each view buckets
// the same full history by year / week / day and plots one dot per bucket.
// A bucket's value is the plain mean of the records inside it, and its x
// position is the mean of those records' actual dates — so every plotted
// coordinate is measured data. Nothing is smoothed, interpolated or
// projected. Exports renderWeightTracker, cleanupWeightTracker.
import { supabase } from "/supabaseClient.js";
import { el } from "/lib/dom.js";
import { cssVar, num } from "/lib/format.js";

const dayMs = 24 * 60 * 60 * 1000;
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

let canvas = null;
let ctx = null;
let tooltip = null;
let emptyState = null;
let legend = null;
let activeView = DEFAULT_VIEW;
let plottedPoints = [];
let weightData = [];
let resizeHandler = null;

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

// A stable per-view key, plus the label shown on the axis and in the tooltip.
function bucketOf(date, view) {
    if (view === "year") {
        const year = date.getFullYear();
        return {
            key: `${year}`,
            axisLabel: `${year}년`,
            fullLabel: `${year}년`
        };
    }
    if (view === "week") {
        const monday = startOfWeek(date);
        const month = monday.getMonth() + 1;
        const day = monday.getDate();
        return {
            key: `w${monday.getFullYear()}-${month}-${day}`,
            axisLabel: `${month}/${day}`,
            fullLabel: `${monday.getFullYear()}년 ${month}월 ${day}일 주간`
        };
    }
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return {
        key: `d${date.getFullYear()}-${month}-${day}`,
        axisLabel: `${month}/${day}`,
        fullLabel: `${date.getFullYear()}년 ${month}월 ${day}일`
    };
}

// Collapse a person's records into one point per bucket. The point's weight is
// the mean of the bucket's records and its date is the mean of their dates, so
// a bucket sits where its data actually is rather than at an invented centre.
function bucketRecords(records, view) {
    const buckets = new Map();

    for (const record of records) {
        const date = parseDate(record.date);
        const { key, axisLabel, fullLabel } = bucketOf(date, view);
        if (!buckets.has(key)) {
            buckets.set(key, { axisLabel, fullLabel, weights: [], dates: [] });
        }
        const bucket = buckets.get(key);
        bucket.weights.push(record.weight);
        bucket.dates.push(date.getTime());
    }

    return [...buckets.values()]
        .map((bucket) => {
            const total = bucket.weights.reduce((sum, weight) => sum + weight, 0);
            const dateTotal = bucket.dates.reduce((sum, value) => sum + value, 0);
            return {
                axisLabel: bucket.axisLabel,
                fullLabel: bucket.fullLabel,
                count: bucket.weights.length,
                weight: total / bucket.weights.length,
                dateValue: dateTotal / bucket.dates.length
            };
        })
        .sort((a, b) => a.dateValue - b.dateValue);
}

function bucketedSeries() {
    return weightData
        .map((person) => ({
            ...person,
            points: bucketRecords(person.records, activeView)
        }))
        .filter((person) => person.points.length > 0);
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

function getBounds(series) {
    const points = series.flatMap((person) => person.points);
    const weights = points.map((point) => point.weight);
    const dates = points.map((point) => point.dateValue);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const weightRange = Math.max(maxWeight - minWeight, 1);
    const yTicks = niceWeightTicks(minWeight - weightRange * 0.16, maxWeight + weightRange * 0.16);

    let minDate = Math.min(...dates);
    let maxDate = Math.max(...dates);
    if (minDate === maxDate) {
        // A single bucket would collapse the x scale; pad so the dot centres.
        minDate -= dayMs;
        maxDate += dayMs;
    }

    return {
        minDate,
        maxDate,
        minWeight: yTicks[0],
        maxWeight: yTicks[yTicks.length - 1],
        yTicks
    };
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return rect;
}

function createScales(rect, bounds) {
    const width = rect.width - padding.left - padding.right;
    const height = rect.height - padding.top - padding.bottom;
    return {
        x(dateValue) {
            const ratio = (dateValue - bounds.minDate) / (bounds.maxDate - bounds.minDate);
            return padding.left + ratio * width;
        },
        y(weight) {
            const ratio = (weight - bounds.minWeight) / (bounds.maxWeight - bounds.minWeight);
            return padding.top + height - ratio * height;
        }
    };
}

// --- drawing ---------------------------------------------------------------

// X labels come from the buckets themselves (never invented dates), thinned to
// whatever fits the current width.
function axisTicks(series, maxTicks) {
    const seen = new Map();
    for (const person of series) {
        for (const point of person.points) {
            if (!seen.has(point.axisLabel)) seen.set(point.axisLabel, point.dateValue);
        }
    }

    const ticks = [...seen.entries()]
        .map(([label, dateValue]) => ({ label, dateValue }))
        .sort((a, b) => a.dateValue - b.dateValue);
    if (ticks.length <= maxTicks) return ticks;

    const stride = Math.ceil(ticks.length / maxTicks);
    return ticks.filter((_, index) => index % stride === 0);
}

function drawGrid(rect, bounds, scales, series) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 1;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";

    for (const weight of bounds.yTicks) {
        const y = scales.y(weight);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(rect.width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.textAlign = "right";
        ctx.fillText(kg(weight), padding.left - 10, y);
    }

    ctx.textBaseline = "top";
    const ticks = axisTicks(series, rect.width > 760 ? 7 : 4);
    ticks.forEach((tick, index) => {
        const x = scales.x(tick.dateValue);

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
            x: scales.x(point.dateValue),
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

function renderChart() {
    if (!canvas || !ctx) return;
    const rect = resizeCanvas();
    const series = bucketedSeries();
    const hasData = series.length > 0;

    emptyState.hidden = hasData;
    tooltip.hidden = true;
    syncControls();

    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        plottedPoints = [];
        return;
    }

    const bounds = getBounds(series);
    const scales = createScales(rect, bounds);
    drawGrid(rect, bounds, scales, series);
    drawSeries(series, scales, rect);
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
                el("canvas", { id: "weightChart", "aria-label": "시간별 체중 변화 선 그래프" }),
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

    canvas.addEventListener("mousemove", (event) => showTooltip(nearestPoint(event)));
    canvas.addEventListener("mouseleave", () => {
        tooltip.hidden = true;
    });
    // click/tap so touch devices (no hover) can still read a point's exact value
    canvas.addEventListener("click", (event) => showTooltip(nearestPoint(event)));

    resizeHandler = renderChart;
    window.addEventListener("resize", resizeHandler);
}

export function cleanupWeightTracker() {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
    canvas = null;
    ctx = null;
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
