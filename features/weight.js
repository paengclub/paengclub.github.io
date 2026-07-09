// features/weight.js — 체중, a zoomable/pannable weight-over-time line chart
// (canvas) for each tracked person. Data comes from Supabase
// (weight_people + weight_records). Exports renderWeightTracker,
// cleanupWeightTracker.
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

let canvas = null;
let ctx = null;
let tooltip = null;
let emptyState = null;
let legend = null;
let selectedRange = "all";
let fullDateBounds = null;
let viewStart = 0;
let viewEnd = 0;
let plottedPoints = [];
let weightData = [];
let isDragging = false;
let lastDragX = 0;
let resizeHandler = null;

function parseDate(date) {
    return new Date(`${date}T00:00:00`);
}

function formatDate(date) {
    if (viewEnd - viewStart > 180 * dayMs) {
        return new Intl.DateTimeFormat("ko-KR", {
            year: "2-digit",
            month: "short"
        }).format(date);
    }

    return new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric"
    }).format(date);
}

function formatFullDate(date) {
    return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(date);
}

function allRecords() {
    return weightData.flatMap((person) => {
        return person.records.map((record) => ({
            ...record,
            personId: person.id,
            personName: person.name,
            color: person.color,
            dateValue: parseDate(record.date).getTime()
        }));
    });
}

function getFullDateBounds(records) {
    if (records.length === 0) {
        const today = new Date();
        const todayValue = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        return {
            minDate: todayValue - 30 * dayMs,
            maxDate: todayValue
        };
    }

    const minDate = Math.min(...records.map((record) => record.dateValue));
    const maxDate = Math.max(...records.map((record) => record.dateValue));
    if (minDate === maxDate) {
        return {
            minDate: minDate - dayMs,
            maxDate: maxDate + dayMs
        };
    }
    return { minDate, maxDate };
}

function recordsForViewport(records) {
    const sorted = records
        .map((record) => ({
            ...record,
            dateValue: parseDate(record.date).getTime()
        }))
        .sort((a, b) => a.dateValue - b.dateValue);
    const inside = sorted.filter((record) => {
        return record.dateValue >= viewStart && record.dateValue <= viewEnd;
    });
    const before = [...sorted].reverse().find((record) => record.dateValue < viewStart);
    const after = sorted.find((record) => record.dateValue > viewEnd);
    return [before, ...inside, after].filter(Boolean);
}

function viewportSeries() {
    return weightData
        .map((person) => ({
            ...person,
            records: recordsForViewport(person.records)
        }))
        .filter((person) => person.records.length > 0);
}

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
    const records = series.flatMap((person) => person.records);
    const minWeight = Math.min(...records.map((record) => record.weight));
    const maxWeight = Math.max(...records.map((record) => record.weight));
    const weightRange = Math.max(maxWeight - minWeight, 1);
    const yTicks = niceWeightTicks(minWeight - weightRange * 0.16, maxWeight + weightRange * 0.16);

    return {
        minDate: viewStart,
        maxDate: viewEnd,
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

function drawGrid(rect, bounds, scales) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 1;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";

    const yTicks = bounds.yTicks?.length ? bounds.yTicks : niceWeightTicks(bounds.minWeight, bounds.maxWeight);
    for (const weight of yTicks) {
        const y = scales.y(weight);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(rect.width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.textAlign = "right";
        ctx.fillText(`${weight.toFixed(1)}kg`, padding.left - 10, y);
    }

    const xTicks = rect.width > 760 ? 6 : 4;
    ctx.textBaseline = "top";
    for (let i = 0; i <= xTicks; i += 1) {
        const dateValue = bounds.minDate + ((bounds.maxDate - bounds.minDate) / xTicks) * i;
        const x = scales.x(dateValue);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, rect.height - padding.bottom);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.textAlign = i === 0 ? "left" : i === xTicks ? "right" : "center";
        ctx.fillText(formatDate(new Date(dateValue)), x, rect.height - padding.bottom + 15);
    }
}

function buildTrend(records) {
    const points = records
        .map((record) => ({
            dateValue: record.dateValue,
            weight: record.weight
        }))
        .sort((a, b) => a.dateValue - b.dateValue);
    if (points.length <= 2) return points;

    const span = Math.max(viewEnd - viewStart, dayMs);
    const sampleCount = Math.min(110, Math.max(24, Math.round(span / dayMs)));
    const step = span / (sampleCount - 1);
    const bandwidth = Math.max(span / 22, dayMs * 3);
    const trend = [];

    for (let i = 0; i < sampleCount; i += 1) {
        const dateValue = viewStart + step * i;
        let weighted = 0;
        let totalWeight = 0;

        for (const point of points) {
            const distance = (dateValue - point.dateValue) / bandwidth;
            const influence = Math.exp(-0.5 * distance * distance);
            weighted += point.weight * influence;
            totalWeight += influence;
        }

        if (totalWeight > 0.0001) {
            trend.push({
                dateValue,
                weight: weighted / totalWeight
            });
        }
    }

    return trend;
}

function drawLine(points, scales) {
    if (points.length === 0) return;
    ctx.beginPath();
    points.forEach((point, index) => {
        const x = scales.x(point.dateValue);
        const y = scales.y(point.weight);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
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
        const rawPoints = person.records.map((record) => ({
            x: scales.x(record.dateValue),
            y: scales.y(record.weight),
            date: parseDate(record.date),
            dateValue: record.dateValue,
            weight: record.weight,
            personName: person.name,
            color: person.color,
            isInsideViewport: record.dateValue >= viewStart && record.dateValue <= viewEnd
        }));

        ctx.strokeStyle = person.color;
        ctx.globalAlpha = 0.26;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        drawLine(rawPoints, scales);

        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        drawLine(buildTrend(person.records), scales);

        rawPoints.filter((point) => point.isInsideViewport).forEach((point) => {
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

function renderChart() {
    if (!canvas || !ctx) return;
    const rect = resizeCanvas();
    const series = viewportSeries();
    const hasData = series.some((person) => person.records.length > 0);

    emptyState.hidden = hasData;
    tooltip.hidden = true;

    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        plottedPoints = [];
        syncRangeButtons();
        return;
    }

    const bounds = getBounds(series);
    const scales = createScales(rect, bounds);
    drawGrid(rect, bounds, scales);
    drawSeries(series, scales, rect);
    syncRangeButtons();
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
    if (!point || isDragging) {
        tooltip.hidden = true;
        return;
    }

    tooltip.replaceChildren(
        el("strong", { text: point.personName }),
        document.createTextNode(`${formatFullDate(point.date)} · ${point.weight.toFixed(1)}kg`)
    );
    tooltip.style.left = `${point.x}px`;
    tooltip.style.top = `${point.y}px`;
    tooltip.hidden = false;
}

function setViewport(start, end) {
    const fullStart = fullDateBounds.minDate;
    const fullEnd = fullDateBounds.maxDate;
    const fullSpan = fullEnd - fullStart;
    const minSpan = Math.max(dayMs, fullSpan / 240);
    let nextStart = start;
    let nextEnd = end;

    if (nextEnd - nextStart < minSpan) {
        const center = (nextStart + nextEnd) / 2;
        nextStart = center - minSpan / 2;
        nextEnd = center + minSpan / 2;
    }

    if (nextEnd - nextStart > fullSpan) {
        nextStart = fullStart;
        nextEnd = fullEnd;
    }

    if (nextStart < fullStart) {
        nextEnd += fullStart - nextStart;
        nextStart = fullStart;
    }
    if (nextEnd > fullEnd) {
        nextStart -= nextEnd - fullEnd;
        nextEnd = fullEnd;
    }

    viewStart = Math.max(nextStart, fullStart);
    viewEnd = Math.min(nextEnd, fullEnd);
    renderChart();
}

function selectRange(range) {
    selectedRange = range;
    if (range === "all") {
        setViewport(fullDateBounds.minDate, fullDateBounds.maxDate);
        return;
    }

    const days = Number(range);
    setViewport(fullDateBounds.maxDate - (days - 1) * dayMs, fullDateBounds.maxDate);
}

function syncRangeButtons() {
    document.querySelectorAll("[data-range]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.range === selectedRange));
    });
}

function panViewport(direction) {
    selectedRange = "custom";
    const span = viewEnd - viewStart;
    setViewport(viewStart + span * 0.28 * direction, viewEnd + span * 0.28 * direction);
}

function zoomViewport(factor, anchorRatio = 0.5) {
    selectedRange = "custom";
    const span = viewEnd - viewStart;
    const anchorDate = viewStart + span * anchorRatio;
    const nextSpan = span * factor;
    const nextStart = anchorDate - nextSpan * anchorRatio;
    setViewport(nextStart, nextStart + nextSpan);
}

function chartRect() {
    const rect = canvas.getBoundingClientRect();
    return {
        left: padding.left,
        right: rect.width - padding.right,
        width: rect.width - padding.left - padding.right
    };
}

function anchorRatio(clientX) {
    const rect = canvas.getBoundingClientRect();
    const chart = chartRect();
    const x = clientX - rect.left;
    return Math.min(Math.max((x - chart.left) / chart.width, 0), 1);
}

function initializeViewport() {
    fullDateBounds = getFullDateBounds(allRecords());
    selectedRange = "30";
    viewStart = Math.max(fullDateBounds.minDate, fullDateBounds.maxDate - 29 * dayMs);
    viewEnd = fullDateBounds.maxDate;
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

function renderShell() {
    const root = document.getElementById("screen");
    const wrapper = el("section", { class: "page-shell weight-shell" });
    const panel = el("div", { class: "app-panel weight-panel" });
    const controls = el("nav", { class: "weight-controls", "aria-label": "그래프 탐색" }, [
        el("button", { class: "icon-button", type: "button", "data-action": "pan-left", "aria-label": "왼쪽으로 이동", text: "<" }),
        el("button", { class: "icon-button", type: "button", "data-action": "zoom-out", "aria-label": "축소", text: "-" }),
        el("button", { class: "icon-button", type: "button", "data-action": "zoom-in", "aria-label": "확대", text: "+" }),
        el("button", { class: "icon-button", type: "button", "data-action": "pan-right", "aria-label": "오른쪽으로 이동", text: ">" }),
        el("button", { type: "button", "data-range": "30", text: "최근 30일" }),
        el("button", { type: "button", "data-range": "all", text: "전체" })
    ]);

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
    document.querySelectorAll("[data-range]").forEach((button) => {
        button.addEventListener("click", () => selectRange(button.dataset.range));
    });
    document.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;
            if (action === "pan-left") panViewport(-1);
            if (action === "pan-right") panViewport(1);
            if (action === "zoom-in") zoomViewport(0.62);
            if (action === "zoom-out") zoomViewport(1.55);
        });
    });

    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomViewport(event.deltaY < 0 ? 0.78 : 1.28, anchorRatio(event.clientX));
    });
    canvas.addEventListener("pointerdown", (event) => {
        isDragging = true;
        lastDragX = event.clientX;
        canvas.classList.add("is-dragging");
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!isDragging) return;
        selectedRange = "custom";
        const chart = chartRect();
        const span = viewEnd - viewStart;
        const pixelDelta = event.clientX - lastDragX;
        const dateDelta = (pixelDelta / chart.width) * span;
        lastDragX = event.clientX;
        setViewport(viewStart - dateDelta, viewEnd - dateDelta);
    });
    canvas.addEventListener("pointerup", (event) => {
        isDragging = false;
        canvas.classList.remove("is-dragging");
        canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointercancel", () => {
        isDragging = false;
        canvas.classList.remove("is-dragging");
    });
    canvas.addEventListener("mousemove", (event) => showTooltip(nearestPoint(event)));
    canvas.addEventListener("mouseleave", () => {
        tooltip.hidden = true;
    });

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
    selectedRange = "30";
    plottedPoints = [];
    isDragging = false;

    try {
        emptyState.hidden = false;
        emptyState.textContent = "불러오는 중...";
        await loadWeightData();
        initializeViewport();
        bindControls();
        renderLegend();
        renderChart();
    } catch (error) {
        console.warn(error);
        emptyState.hidden = false;
        emptyState.textContent = "체중 데이터를 불러오지 못했습니다.";
    }
}
