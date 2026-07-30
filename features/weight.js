// features/weight.js — 체중, a zoomable/pannable weight-over-time line chart
// (canvas) for each tracked person. Data comes from Supabase
// (weight_people + weight_records). Two chart modes: overlay (each person's
// raw + smoothed line) and diff (paeng - okh gap over time, with a
// regression-based crossover prediction shown as a stat strip). Exports
// renderWeightTracker, cleanupWeightTracker.
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
// Gaussian-kernel bandwidth for the smoothed trend line: span/DIVISOR, floored
// at FLOOR_DAYS days. Smaller values track local wiggles more aggressively
// (more curve); larger values smooth harder.
const TREND_BANDWIDTH_DIVISOR = 26;
const TREND_BANDWIDTH_FLOOR_DAYS = 2;
// Crossover prediction: fit each person's last WINDOW_DAYS of records with a
// line and solve for where the two lines meet. Only surfaced if it lands
// within HORIZON_DAYS of today (further out is too noisy to call a date).
const PREDICTION_WINDOW_DAYS = 45;
const PREDICTION_HORIZON_DAYS = 400;

let canvas = null;
let ctx = null;
let tooltip = null;
let emptyState = null;
let legend = null;
let compareStrip = null;
let statsPanel = null;
let diffToggleBtn = null;
let selectedRange = "7";
let chartMode = "overlay"; // "overlay" | "diff"
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

function withAlpha(hexColor, alpha) {
    const hex = hexColor.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const value = parseInt(full, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

// --- gaussian smoothing (shared by the overlay trend line and diff series) ---

function sampleDates() {
    const span = Math.max(viewEnd - viewStart, dayMs);
    const sampleCount = Math.min(110, Math.max(24, Math.round(span / dayMs)));
    const step = span / (sampleCount - 1);
    return Array.from({ length: sampleCount }, (_, i) => viewStart + step * i);
}

function trendBandwidth() {
    const span = Math.max(viewEnd - viewStart, dayMs);
    return Math.max(span / TREND_BANDWIDTH_DIVISOR, dayMs * TREND_BANDWIDTH_FLOOR_DAYS);
}

function gaussianEstimate(points, dateValue, bandwidth) {
    let weighted = 0;
    let totalWeight = 0;

    for (const point of points) {
        const distance = (dateValue - point.dateValue) / bandwidth;
        const influence = Math.exp(-0.5 * distance * distance);
        weighted += point.weight * influence;
        totalWeight += influence;
    }

    return totalWeight > 0.0001 ? weighted / totalWeight : null;
}

function buildTrend(records) {
    const points = records
        .map((record) => ({ dateValue: record.dateValue, weight: record.weight }))
        .sort((a, b) => a.dateValue - b.dateValue);
    if (points.length <= 2) return points;

    const bandwidth = trendBandwidth();
    const trend = [];
    for (const dateValue of sampleDates()) {
        const estimate = gaussianEstimate(points, dateValue, bandwidth);
        if (estimate !== null) trend.push({ dateValue, weight: estimate });
    }
    return trend;
}

function buildDiffSeries(personA, personB) {
    if (personA.records.length === 0 || personB.records.length === 0) return [];
    const bandwidth = trendBandwidth();
    const diffs = [];
    for (const dateValue of sampleDates()) {
        const a = gaussianEstimate(personA.records, dateValue, bandwidth);
        const b = gaussianEstimate(personB.records, dateValue, bandwidth);
        if (a === null || b === null) continue;
        diffs.push({ dateValue, diff: a - b });
    }
    return diffs;
}

// --- overlay mode drawing ---

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

// --- diff mode drawing ---

function getDiffBounds(diffPoints) {
    const values = diffPoints.map((point) => point.diff);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 0);
    const range = Math.max(maxValue - minValue, 1);
    const yTicks = niceWeightTicks(minValue - range * 0.16, maxValue + range * 0.16);

    return {
        minDate: viewStart,
        maxDate: viewEnd,
        minWeight: yTicks[0],
        maxWeight: yTicks[yTicks.length - 1],
        yTicks
    };
}

function drawDiffGrid(rect, bounds, scales) {
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";

    for (const value of bounds.yTicks) {
        const y = scales.y(value);
        const isZero = Math.abs(value) < 0.05;

        ctx.strokeStyle = isZero ? cssVar("--app-text") : cssVar("--app-line");
        ctx.lineWidth = isZero ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(rect.width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = isZero ? cssVar("--app-text") : cssVar("--app-muted");
        ctx.textAlign = "right";
        ctx.fillText(isZero ? "0kg" : `${value > 0 ? "+" : ""}${value.toFixed(1)}kg`, padding.left - 10, y);
    }

    const xTicks = rect.width > 760 ? 6 : 4;
    ctx.textBaseline = "top";
    for (let i = 0; i <= xTicks; i += 1) {
        const dateValue = bounds.minDate + ((bounds.maxDate - bounds.minDate) / xTicks) * i;
        const x = scales.x(dateValue);

        ctx.strokeStyle = cssVar("--app-line");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, rect.height - padding.bottom);
        ctx.stroke();

        ctx.fillStyle = cssVar("--app-muted");
        ctx.textAlign = i === 0 ? "left" : i === xTicks ? "right" : "center";
        ctx.fillText(formatDate(new Date(dateValue)), x, rect.height - padding.bottom + 15);
    }
}

// Split the diff series into contiguous same-sign runs, inserting an
// interpolated zero point at each sign change so the fill/stroke can switch
// color exactly at the crossing instead of at the nearest sample.
function splitDiffSegments(diffPoints, scales) {
    const segments = [];
    let current = [];
    let currentSign = null;
    const points = diffPoints.map((point) => ({ ...point, x: scales.x(point.dateValue) }));

    for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const sign = point.diff >= 0 ? 1 : -1;

        if (currentSign === null) {
            currentSign = sign;
            current.push(point);
            continue;
        }
        if (sign === currentSign) {
            current.push(point);
            continue;
        }

        const prev = points[i - 1];
        const t = prev.diff / (prev.diff - point.diff);
        const crossing = {
            x: prev.x + (point.x - prev.x) * t,
            diff: 0,
            dateValue: prev.dateValue + (point.dateValue - prev.dateValue) * t
        };
        current.push(crossing);
        segments.push({ sign: currentSign, points: current });
        current = [crossing, point];
        currentSign = sign;
    }
    if (current.length > 0) segments.push({ sign: currentSign, points: current });
    return segments;
}

function drawDiffSeries(diffPoints, scales, personA, personB) {
    plottedPoints = [];
    if (diffPoints.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(
        padding.left,
        padding.top,
        canvas.getBoundingClientRect().width - padding.left - padding.right,
        canvas.getBoundingClientRect().height - padding.top - padding.bottom
    );
    ctx.clip();

    const zeroY = scales.y(0);
    const segments = splitDiffSegments(diffPoints, scales);

    for (const segment of segments) {
        const color = segment.sign > 0 ? personA.color : personB.color;

        ctx.beginPath();
        ctx.moveTo(segment.points[0].x, zeroY);
        segment.points.forEach((point) => ctx.lineTo(point.x, scales.y(point.diff)));
        ctx.lineTo(segment.points[segment.points.length - 1].x, zeroY);
        ctx.closePath();
        ctx.fillStyle = withAlpha(color, 0.16);
        ctx.fill();

        ctx.beginPath();
        segment.points.forEach((point, index) => {
            const y = scales.y(point.diff);
            if (index === 0) ctx.moveTo(point.x, y);
            else ctx.lineTo(point.x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
    }

    // Mark the actual (historical) crossing points inside the current view.
    for (let i = 1; i < segments.length; i += 1) {
        const crossing = segments[i].points[0];
        ctx.beginPath();
        ctx.arc(crossing.x, zeroY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = cssVar("--app-surface-strong");
        ctx.strokeStyle = cssVar("--app-text");
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
}

// --- crossover prediction (independent of the current zoom/viewport) ---

function linearRegressionDays(records) {
    if (records.length < 2) return null;
    const points = records.map((record) => ({ x: record.dateValue / dayMs, y: record.weight }));
    const n = points.length;
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (const point of points) {
        numerator += (point.x - meanX) * (point.y - meanY);
        denominator += (point.x - meanX) ** 2;
    }
    if (denominator === 0) return null;

    const slope = numerator / denominator; // kg per day
    const intercept = meanY - slope * meanX;
    return { slope, intercept };
}

function recentRecordsFor(records) {
    if (records.length === 0) return [];
    const latest = Math.max(...records.map((record) => record.dateValue));
    const recent = records.filter((record) => record.dateValue >= latest - PREDICTION_WINDOW_DAYS * dayMs);
    return recent.length >= 2 ? recent : records;
}

function sortedDatedRecords(records) {
    return records
        .map((record) => ({ ...record, dateValue: parseDate(record.date).getTime() }))
        .sort((a, b) => a.dateValue - b.dateValue);
}

// Compares the two tracked people: current gap + (if the trend supports it) a
// predicted date the gap closes to zero, based on a linear fit of each
// person's last ~45 days. Only meaningful for exactly two people, which is
// this site's real data; returns null otherwise so the UI can hide cleanly.
function computeComparison() {
    if (weightData.length !== 2) return null;
    const [personA, personB] = weightData;
    const recordsA = sortedDatedRecords(personA.records);
    const recordsB = sortedDatedRecords(personB.records);
    if (recordsA.length === 0 || recordsB.length === 0) return null;

    const lastA = recordsA[recordsA.length - 1];
    const lastB = recordsB[recordsB.length - 1];
    const heavier = lastA.weight >= lastB.weight ? personA : personB;
    const lighter = heavier === personA ? personB : personA;
    const heavierRecords = heavier === personA ? recordsA : recordsB;
    const lighterRecords = heavier === personA ? recordsB : recordsA;
    const diff = heavierRecords[heavierRecords.length - 1].weight - lighterRecords[lighterRecords.length - 1].weight;

    const regHeavy = linearRegressionDays(recentRecordsFor(heavierRecords));
    const regLight = linearRegressionDays(recentRecordsFor(lighterRecords));

    let prediction = { state: "flat" };
    if (regHeavy && regLight) {
        const slopeDiffPerDay = regHeavy.slope - regLight.slope;
        if (slopeDiffPerDay < -0.001) {
            const crossDay = (regLight.intercept - regHeavy.intercept) / slopeDiffPerDay;
            const daysFromNow = crossDay - Date.now() / dayMs;
            if (daysFromNow > 0 && daysFromNow <= PREDICTION_HORIZON_DAYS) {
                prediction = { state: "dated", dateValue: crossDay * dayMs, daysFromNow: Math.round(daysFromNow) };
            } else if (daysFromNow > PREDICTION_HORIZON_DAYS) {
                prediction = { state: "far" };
            } else {
                prediction = { state: "converging" };
            }
        } else if (slopeDiffPerDay > 0.001) {
            prediction = { state: "diverging" };
        }
    }

    return { heavier, lighter, diff, prediction };
}

function renderComparison() {
    if (!compareStrip) return;
    const comparison = computeComparison();
    if (!comparison) {
        compareStrip.hidden = true;
        compareStrip.replaceChildren();
        return;
    }

    const items = [
        el("div", { class: "weight-compare-item" }, [
            el("span", { text: "현재 차이" }),
            el("strong", {}, [
                `${comparison.diff.toFixed(1)}kg `,
                el("span", { class: "weight-compare-who", style: `color:${comparison.heavier.color}` }, [`${comparison.heavier.name} 우세`])
            ])
        ])
    ];

    const { prediction } = comparison;
    if (prediction.state === "dated") {
        items.push(el("div", { class: "weight-compare-item" }, [
            el("span", { text: "예상 역전 시점" }),
            el("strong", { text: `${formatFullDate(new Date(prediction.dateValue))} · ${prediction.daysFromNow}일 후` })
        ]));
    } else if (prediction.state === "far" || prediction.state === "converging") {
        items.push(el("div", { class: "weight-compare-item" }, [
            el("span", { text: "추세" }),
            el("strong", { text: "차이가 좁혀지는 중 (1년 이상 소요 예상)" })
        ]));
    } else if (prediction.state === "diverging") {
        items.push(el("div", { class: "weight-compare-item" }, [
            el("span", { text: "추세" }),
            el("strong", { text: "차이가 벌어지는 중" })
        ]));
    } else {
        items.push(el("div", { class: "weight-compare-item" }, [
            el("span", { text: "추세" }),
            el("strong", { text: "안정적" })
        ]));
    }

    compareStrip.hidden = false;
    compareStrip.replaceChildren(...items);
}

// --- quantitative stats panel (exact numbers, independent of chart zoom) ---

function changeSince(records, days) {
    if (records.length < 2) return null;
    const latest = records[records.length - 1];
    const cutoff = latest.dateValue - days * dayMs;
    const candidates = records.filter((record) => record.dateValue <= cutoff);
    const base = candidates.length > 0 ? candidates[candidates.length - 1] : records[0];
    if (base.dateValue === latest.dateValue) return null;
    return {
        delta: latest.weight - base.weight,
        actualDays: Math.max(1, Math.round((latest.dateValue - base.dateValue) / dayMs))
    };
}

function computeStats(person) {
    const records = sortedDatedRecords(person.records);
    if (records.length === 0) return null;

    const latest = records[records.length - 1];
    const first = records[0];
    const weights = records.map((record) => record.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const avg = weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
    const totalChange = records.length >= 2 ? latest.weight - first.weight : null;
    const totalDays = Math.max(1, Math.round((latest.dateValue - first.dateValue) / dayMs));

    return {
        latestWeight: latest.weight,
        latestDate: latest.date,
        change7: changeSince(records, 7),
        change30: changeSince(records, 30),
        totalChange,
        totalDays,
        recordCount: records.length,
        min,
        max,
        avg
    };
}

function statTile(label, value, tone = "") {
    return el("div", { class: `weight-stat ${tone}` }, [
        el("span", { class: "weight-stat-label", text: label }),
        el("strong", { class: "weight-stat-value", text: value })
    ]);
}

function changeLabel(change) {
    if (!change) return "- (데이터 부족)";
    const sign = change.delta > 0 ? "+" : "";
    return `${sign}${change.delta.toFixed(1)}kg (${change.actualDays}일 전 대비)`;
}

function changeTone(change) {
    if (!change || Math.abs(change.delta) < 0.05) return "";
    return change.delta > 0 ? "plus" : "minus";
}

function renderStatsCard(person) {
    const stats = computeStats(person);
    if (!stats) {
        return el("div", { class: "weight-stats-card" }, [
            el("div", { class: "weight-stats-head" }, [
                el("span", { class: "swatch", style: `background:${person.color}` }),
                el("strong", { text: person.name })
            ]),
            el("div", { class: "empty-line", text: "기록이 없어요." })
        ]);
    }

    return el("div", { class: "weight-stats-card" }, [
        el("div", { class: "weight-stats-head" }, [
            el("span", { class: "swatch", style: `background:${person.color}` }),
            el("strong", { text: person.name }),
            el("span", { class: "muted-text", text: `최근 기록 ${formatFullDate(parseDate(stats.latestDate))}` })
        ]),
        el("div", { class: "weight-stat-grid" }, [
            statTile("현재 체중", `${stats.latestWeight.toFixed(1)}kg`),
            statTile("최근 7일", changeLabel(stats.change7), changeTone(stats.change7)),
            statTile("최근 30일", changeLabel(stats.change30), changeTone(stats.change30)),
            statTile("전체 변화", stats.totalChange !== null ? `${stats.totalChange > 0 ? "+" : ""}${stats.totalChange.toFixed(1)}kg (${stats.totalDays}일간)` : "-", changeTone(stats.totalChange !== null ? { delta: stats.totalChange } : null)),
            statTile("최고 / 최저", `${stats.max.toFixed(1)}kg / ${stats.min.toFixed(1)}kg`),
            statTile("평균", `${stats.avg.toFixed(1)}kg`),
            statTile("기록 수", `${stats.recordCount}회`)
        ])
    ]);
}

function renderStatsPanel() {
    if (!statsPanel) return;
    if (weightData.length === 0) {
        statsPanel.replaceChildren();
        return;
    }
    statsPanel.replaceChildren(...weightData.map(renderStatsCard));
}

// --- render orchestration ---

function renderChart() {
    if (!canvas || !ctx) return;
    const rect = resizeCanvas();

    if (chartMode === "diff" && weightData.length === 2) {
        renderDiffChart(rect);
        syncControls();
        return;
    }

    const series = viewportSeries();
    const hasData = series.some((person) => person.records.length > 0);

    emptyState.hidden = hasData;
    tooltip.hidden = true;

    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        plottedPoints = [];
        syncControls();
        return;
    }

    const bounds = getBounds(series);
    const scales = createScales(rect, bounds);
    drawGrid(rect, bounds, scales);
    drawSeries(series, scales, rect);
    syncControls();
}

function renderDiffChart(rect) {
    tooltip.hidden = true;
    const [personRawA, personRawB] = weightData;
    const personA = { ...personRawA, records: recordsForViewport(personRawA.records) };
    const personB = { ...personRawB, records: recordsForViewport(personRawB.records) };
    const hasData = personA.records.length > 0 && personB.records.length > 0;

    emptyState.hidden = hasData;
    if (!hasData) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        plottedPoints = [];
        return;
    }

    const diffPoints = buildDiffSeries(personA, personB);
    const bounds = getDiffBounds(diffPoints);
    const scales = createScales(rect, bounds);
    drawDiffGrid(rect, bounds, scales);
    drawDiffSeries(diffPoints, scales, personA, personB);
}

function nearestPoint(event) {
    if (chartMode !== "overlay") return null;
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

function toggleDiffMode() {
    chartMode = chartMode === "diff" ? "overlay" : "diff";
    renderChart();
}

function syncControls() {
    document.querySelectorAll("[data-range]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.range === selectedRange));
    });
    if (diffToggleBtn) {
        diffToggleBtn.setAttribute("aria-pressed", String(chartMode === "diff"));
        diffToggleBtn.textContent = chartMode === "diff" ? "겹쳐 보기" : "차이 보기";
    }
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
    selectedRange = "7";
    viewStart = Math.max(fullDateBounds.minDate, fullDateBounds.maxDate - 6 * dayMs);
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
    const controls = el("nav", { class: "weight-controls", "aria-label": "그래프 탐색" }, [
        el("button", { class: "icon-button", type: "button", "data-action": "pan-left", "aria-label": "왼쪽으로 이동", text: "<" }),
        el("button", { class: "icon-button", type: "button", "data-action": "zoom-out", "aria-label": "축소", text: "-" }),
        el("button", { class: "icon-button", type: "button", "data-action": "zoom-in", "aria-label": "확대", text: "+" }),
        el("button", { class: "icon-button", type: "button", "data-action": "pan-right", "aria-label": "오른쪽으로 이동", text: ">" }),
        el("button", { type: "button", "data-range": "7", text: "1주" }),
        el("button", { type: "button", "data-range": "30", text: "1개월" }),
        el("button", { type: "button", "data-range": "all", text: "전체" }),
        el("button", { id: "weightDiffToggle", type: "button", text: "차이 보기" })
    ]);

    panel.append(
        el("div", { class: "section-header weight-header" }, [
            el("div", {}, [el("h1", { class: "section-title", text: "체중" })]),
            controls
        ]),
        el("section", { class: "weight-chart-shell", "aria-label": "체중 추이 그래프" }, [
            el("div", { class: "legend", id: "weightLegend" }),
            el("div", { class: "weight-compare", id: "weightCompare", hidden: "" }),
            el("div", { class: "chart-wrap" }, [
                el("canvas", { id: "weightChart", "aria-label": "시간별 체중 변화 선 그래프" }),
                el("div", { class: "tooltip", id: "weightTooltip", hidden: "" }),
                el("div", { class: "empty", id: "weightEmptyState", hidden: "", text: "표시할 데이터가 없습니다." })
            ])
        ]),
        el("div", { class: "weight-stats", id: "weightStats" })
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

    diffToggleBtn = document.getElementById("weightDiffToggle");
    diffToggleBtn.hidden = weightData.length !== 2;
    diffToggleBtn.addEventListener("click", toggleDiffMode);

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
    compareStrip = null;
    statsPanel = null;
    diffToggleBtn = null;
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
    compareStrip = document.getElementById("weightCompare");
    statsPanel = document.getElementById("weightStats");
    selectedRange = "7";
    chartMode = "overlay";
    plottedPoints = [];
    isDragging = false;

    try {
        emptyState.hidden = false;
        emptyState.textContent = "불러오는 중...";
        await loadWeightData();
        initializeViewport();
        bindControls();
        renderLegend();
        renderComparison();
        renderStatsPanel();
        renderChart();
    } catch (error) {
        console.warn(error);
        emptyState.hidden = false;
        emptyState.textContent = "체중 데이터를 불러오지 못했습니다.";
    }
}
