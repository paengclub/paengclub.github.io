import { supabase } from "/supabaseClient.js";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 48;
const CANVAS_SCALE = 10;
const FILL_COLOR = "#111111";
const EMPTY_COLOR = "#ffffff";
const FLUSH_DELAY = 120;
const RECONCILE_INTERVAL = 10000;
const PAGE_SIZE = 1000;

// Local render state: a key "x,y" is present iff that cell is filled.
const pixels = new Set();
// Writes queued for the next flush, and writes currently committing.
const pendingDraws = new Map();
const pendingErases = new Map();
const inflightKeys = new Set();
// Bumped on every local edit so an in-flight full read that raced a stroke
// can be discarded instead of clobbering the optimistic state.
let writeEpoch = 0;

let canvasElement = null;
let context = null;
let currentTool = "pen";
let isDrawing = false;
let lastCell = null;
let flushTimer = null;
let reconcileTimer = null;
let pixelChannel = null;

function keyOf(x, y) {
    return `${x},${y}`;
}

function parseKey(key) {
    return key.split(",").map(Number);
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
    }
    return node;
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll("[data-canvas-tool]").forEach((button) => {
        button.classList.toggle("active", button.dataset.canvasTool === tool);
    });
}

// --- rendering (incremental) ---

function paintCell(x, y, filled) {
    if (!context) return;
    context.fillStyle = filled ? FILL_COLOR : EMPTY_COLOR;
    context.fillRect(x * CANVAS_SCALE, y * CANVAS_SCALE, CANVAS_SCALE, CANVAS_SCALE);
}

function redrawAll() {
    if (!context) return;
    context.fillStyle = EMPTY_COLOR;
    context.fillRect(0, 0, canvasElement.width, canvasElement.height);
    context.fillStyle = FILL_COLOR;
    for (const key of pixels) {
        const [x, y] = parseKey(key);
        context.fillRect(x * CANVAS_SCALE, y * CANVAS_SCALE, CANVAS_SCALE, CANVAS_SCALE);
    }
}

// --- local (optimistic) edits ---

// Returns true if the cell state actually changed.
function applyLocal(x, y, filled) {
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
    const key = keyOf(x, y);
    if (filled) {
        if (pixels.has(key)) return false;
        pixels.add(key);
        pendingErases.delete(key);
        pendingDraws.set(key, { x, y });
    } else {
        if (!pixels.has(key)) return false;
        pixels.delete(key);
        pendingDraws.delete(key);
        pendingErases.set(key, { x, y });
    }
    writeEpoch++;
    paintCell(x, y, filled);
    return true;
}

// Fill every cell along the line so fast drags leave no gaps (Bresenham).
function strokeLine(x0, y0, x1, y1, filled) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let changed = false;
    while (true) {
        if (applyLocal(x0, y0, filled)) changed = true;
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    if (changed) scheduleFlush();
}

function cellFromEvent(event) {
    const rect = canvasElement.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * GRID_WIDTH);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID_HEIGHT);
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return null;
    return { x, y };
}

// --- persistence (batched) ---

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = window.setTimeout(flushChanges, FLUSH_DELAY);
}

async function flushChanges() {
    flushTimer = null;
    const draws = Array.from(pendingDraws.values());
    const erases = Array.from(pendingErases.values());
    pendingDraws.clear();
    pendingErases.clear();
    if (draws.length === 0 && erases.length === 0) return;

    // Mark in-flight so a reconcile can't reload state that predates these
    // writes and undo them before they commit.
    for (const pixel of draws) inflightKeys.add(keyOf(pixel.x, pixel.y));
    for (const pixel of erases) inflightKeys.add(keyOf(pixel.x, pixel.y));

    try {
        if (draws.length > 0) {
            const { error } = await supabase.from("canvas_pixels").upsert(draws, { onConflict: "x,y" });
            if (error) showCanvasStatus(error.message, "danger");
        }
        if (erases.length > 0) {
            const filter = erases.map((pixel) => `and(x.eq.${pixel.x},y.eq.${pixel.y})`).join(",");
            const { error } = await supabase.from("canvas_pixels").delete().or(filter);
            if (error) showCanvasStatus(error.message, "danger");
        }
    } finally {
        for (const pixel of draws) inflightKeys.delete(keyOf(pixel.x, pixel.y));
        for (const pixel of erases) inflightKeys.delete(keyOf(pixel.x, pixel.y));
    }
}

// --- live sync ---

function subscribePixels() {
    if (pixelChannel) return;
    pixelChannel = supabase
        .channel("shared-pixel-board")
        .on("postgres_changes", { event: "*", schema: "public", table: "canvas_pixels" }, (payload) => {
            const filled = payload.eventType !== "DELETE";
            const row = filled ? payload.new : payload.old;
            if (!row) return;
            const key = keyOf(row.x, row.y);
            // Our own edits are already reflected optimistically; skip echoes.
            if (inflightKeys.has(key) || pendingDraws.has(key) || pendingErases.has(key)) return;
            if (filled === pixels.has(key)) return;
            if (filled) pixels.add(key);
            else pixels.delete(key);
            paintCell(row.x, row.y, filled);
        })
        .subscribe();
}

async function fetchAll(showErrors) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("canvas_pixels")
            .select("x,y")
            .order("x", { ascending: true })
            .order("y", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        if (error) {
            if (showErrors) showCanvasStatus(error.message, "danger");
            return null;
        }
        rows.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    return rows;
}

async function loadInitial() {
    const rows = await fetchAll(true);
    if (!rows) return;
    // Union so any strokes drawn during the load survive.
    for (const pixel of rows) pixels.add(keyOf(pixel.x, pixel.y));
    redrawAll();
}

// Periodic self-heal: pull the full board and apply only the genuine
// differences (never a destructive full replace), so missed realtime events
// converge without flicker.
async function reconcile() {
    if (document.hidden) return;
    if (pendingDraws.size > 0 || pendingErases.size > 0 || inflightKeys.size > 0) return;
    const epochAtRequest = writeEpoch;
    const rows = await fetchAll(false);
    if (!rows) return;
    if (writeEpoch !== epochAtRequest || pendingDraws.size > 0 || pendingErases.size > 0 || inflightKeys.size > 0) return;

    const serverSet = new Set(rows.map((pixel) => keyOf(pixel.x, pixel.y)));
    for (const key of serverSet) {
        if (!pixels.has(key)) {
            pixels.add(key);
            const [x, y] = parseKey(key);
            paintCell(x, y, true);
        }
    }
    for (const key of Array.from(pixels)) {
        if (!serverSet.has(key)) {
            pixels.delete(key);
            const [x, y] = parseKey(key);
            paintCell(x, y, false);
        }
    }
}

function startReconcile() {
    if (reconcileTimer) window.clearInterval(reconcileTimer);
    reconcileTimer = window.setInterval(reconcile, RECONCILE_INTERVAL);
}

function showCanvasStatus(message, type = "secondary") {
    const target = document.getElementById("canvasStatus");
    if (!target) return;
    target.className = `canvas-status canvas-status-${type}`;
    target.textContent = message;
}

// --- toolbar / events ---

function createToolbar() {
    const penButton = el("button", {
        class: "tool-button active",
        type: "button",
        "data-canvas-tool": "pen",
        text: "펜",
        onclick: () => setTool("pen")
    });
    const eraserButton = el("button", {
        class: "tool-button",
        type: "button",
        "data-canvas-tool": "eraser",
        text: "지우개",
        onclick: () => setTool("eraser")
    });
    return el("div", { class: "canvas-toolbar" }, [
        el("div", { class: "tool-group", role: "group", "aria-label": "그림판 도구" }, [penButton, eraserButton]),
        el("span", { id: "canvasStatus", class: "canvas-status canvas-status-danger", text: "" })
    ]);
}

function bindCanvasEvents() {
    canvasElement.addEventListener("pointerdown", (event) => {
        const cell = cellFromEvent(event);
        if (!cell) return;
        isDrawing = true;
        try { canvasElement.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        const filled = currentTool === "pen";
        if (applyLocal(cell.x, cell.y, filled)) scheduleFlush();
        lastCell = cell;
    });

    canvasElement.addEventListener("pointermove", (event) => {
        if (!isDrawing) return;
        const cell = cellFromEvent(event);
        if (!cell) return;
        const filled = currentTool === "pen";
        if (lastCell) strokeLine(lastCell.x, lastCell.y, cell.x, cell.y, filled);
        else if (applyLocal(cell.x, cell.y, filled)) scheduleFlush();
        lastCell = cell;
    });

    async function endStroke() {
        isDrawing = false;
        lastCell = null;
        if (flushTimer) {
            window.clearTimeout(flushTimer);
            flushTimer = null;
            await flushChanges();
        }
    }

    canvasElement.addEventListener("pointerup", endStroke);
    canvasElement.addEventListener("pointercancel", endStroke);
}

export function cleanupPixelBoard() {
    if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (reconcileTimer) {
        window.clearInterval(reconcileTimer);
        reconcileTimer = null;
    }
    if (pixelChannel) {
        supabase.removeChannel(pixelChannel);
        pixelChannel = null;
    }
    isDrawing = false;
    lastCell = null;
    context = null;
    canvasElement = null;
}

export async function renderPixelBoard() {
    const root = document.getElementById("screen");
    if (!root) return;

    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell pixel-shell" });
    const panel = el("div", { class: "app-panel pixel-panel" });
    const header = el("div", { class: "section-header" }, [
        el("h1", { class: "section-title", text: "공유 그림판" })
    ]);

    canvasElement = el("canvas", {
        id: "pixelCanvas",
        width: String(GRID_WIDTH * CANVAS_SCALE),
        height: String(GRID_HEIGHT * CANVAS_SCALE),
        "aria-label": "공유 픽셀 그림판"
    });
    context = canvasElement.getContext("2d");
    context.imageSmoothingEnabled = false;

    panel.append(header, createToolbar(), el("div", { class: "pixel-canvas-frame" }, [canvasElement]));
    wrapper.appendChild(panel);
    root.appendChild(wrapper);

    pixels.clear();
    bindCanvasEvents();
    setTool(currentTool);
    redrawAll();
    subscribePixels();
    startReconcile();
    await loadInitial();
}
