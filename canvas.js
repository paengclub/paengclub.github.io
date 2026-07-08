import { supabase } from "/supabaseClient.js";

const GRID_WIDTH = 64;
const GRID_HEIGHT = 48;
const CANVAS_SCALE = 10;
const pixels = new Set();

let canvasElement = null;
let context = null;
let currentTool = "pen";
let isDrawing = false;
let flushTimer = null;
let pixelChannel = null;
let refreshTimer = null;
const pendingDraws = new Map();
const pendingErases = new Map();
const inflightKeys = new Set();
let writeEpoch = 0;

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

function drawCanvas() {
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasElement.width, canvasElement.height);
    context.fillStyle = "#111111";

    for (const key of pixels) {
        const [x, y] = parseKey(key);
        context.fillRect(x * CANVAS_SCALE, y * CANVAS_SCALE, CANVAS_SCALE, CANVAS_SCALE);
    }
}

function getPixelFromEvent(event) {
    const rect = canvasElement.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * GRID_WIDTH);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID_HEIGHT);

    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return null;
    return { x, y };
}

function queuePixel(x, y) {
    const key = keyOf(x, y);
    if (currentTool === "pen") {
        pixels.add(key);
        pendingErases.delete(key);
        pendingDraws.set(key, { x, y });
    } else {
        pixels.delete(key);
        pendingDraws.delete(key);
        pendingErases.set(key, { x, y });
    }

    writeEpoch++;
    drawCanvas();
    scheduleFlush();
}

function drawFromEvent(event) {
    const pixel = getPixelFromEvent(event);
    if (!pixel) return;
    queuePixel(pixel.x, pixel.y);
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = window.setTimeout(flushChanges, 150);
}

async function flushChanges() {
    flushTimer = null;
    const draws = Array.from(pendingDraws.values());
    const erases = Array.from(pendingErases.values());
    pendingDraws.clear();
    pendingErases.clear();

    // Keep these writes marked in-flight so a poll can't reload stale DB
    // state and wipe them before the upsert/delete has committed.
    for (const pixel of draws) inflightKeys.add(keyOf(pixel.x, pixel.y));
    for (const pixel of erases) inflightKeys.add(keyOf(pixel.x, pixel.y));

    try {
        if (draws.length > 0) {
            const { error } = await supabase.from("canvas_pixels").upsert(draws, { onConflict: "x,y" });
            if (error) showCanvasStatus(error.message, "danger");
        }

        for (const pixel of erases) {
            const { error } = await supabase.from("canvas_pixels").delete().eq("x", pixel.x).eq("y", pixel.y);
            if (error) showCanvasStatus(error.message, "danger");
        }
    } finally {
        for (const pixel of draws) inflightKeys.delete(keyOf(pixel.x, pixel.y));
        for (const pixel of erases) inflightKeys.delete(keyOf(pixel.x, pixel.y));
    }
}

function showCanvasStatus(message, type = "secondary") {
    const target = document.getElementById("canvasStatus");
    if (!target) return;
    target.className = `canvas-status canvas-status-${type}`;
    target.textContent = message;
}

async function loadPixels(showErrors = true) {
    if (pendingDraws.size > 0 || pendingErases.size > 0 || inflightKeys.size > 0) return;
    const epochAtRequest = writeEpoch;

    // The board holds up to 64*48 = 3072 pixels, but a Supabase select returns
    // at most 1000 rows (the API "max rows" cap). Fetch every row in ordered
    // pages so the snapshot is complete — otherwise each poll rebuilds from a
    // different 1000-row subset and existing pixels flicker away.
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from("canvas_pixels")
            .select("x,y")
            .order("x", { ascending: true })
            .order("y", { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) {
            if (showErrors) showCanvasStatus(error.message, "danger");
            return;
        }
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }

    // If any local drawing happened while this snapshot was in flight, the
    // snapshot may predate those strokes — discard it instead of wiping them.
    if (writeEpoch !== epochAtRequest || pendingDraws.size > 0 || pendingErases.size > 0 || inflightKeys.size > 0) return;

    pixels.clear();
    for (const pixel of rows) pixels.add(keyOf(pixel.x, pixel.y));
    drawCanvas();
}

function subscribePixels() {
    if (pixelChannel) return;

    pixelChannel = supabase
        .channel("shared-pixel-board")
        .on("postgres_changes", { event: "*", schema: "public", table: "canvas_pixels" }, (payload) => {
            const row = payload.eventType === "DELETE" ? payload.old : payload.new;
            if (!row) return;
            const key = keyOf(row.x, row.y);
            if (payload.eventType === "DELETE") pixels.delete(key);
            else pixels.add(key);
            drawCanvas();
        })
        .subscribe();
}

function startPolling() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
        if (document.hidden) return;
        loadPixels(false);
    }, 1200);
}

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
        isDrawing = true;
        canvasElement.setPointerCapture(event.pointerId);
        drawFromEvent(event);
    });

    canvasElement.addEventListener("pointermove", (event) => {
        if (!isDrawing) return;
        drawFromEvent(event);
    });

    canvasElement.addEventListener("pointerup", async () => {
        isDrawing = false;
        if (flushTimer) {
            window.clearTimeout(flushTimer);
            await flushChanges();
        }
    });

    canvasElement.addEventListener("pointercancel", () => {
        isDrawing = false;
    });
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

    bindCanvasEvents();
    setTool(currentTool);
    drawCanvas();
    subscribePixels();
    startPolling();
    await loadPixels();
}
