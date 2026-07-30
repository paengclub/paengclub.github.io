// features/art.js — 홈, the site's landing screen. A mouse-reactive flow-field
// particle animation (embers drifting + swirling around the cursor, sparks on
// click) meant to be stared at rather than used — no data, no Supabase.
// Exports renderArt, cleanupArt.
import { el } from "/lib/dom.js";

const AMBIENT_DENSITY = 1 / 4200; // particles per px^2 of canvas area
const AMBIENT_MAX = 420;
const AMBIENT_MIN = 120;
const MOUSE_RADIUS = 170;
const SPARK_COUNT = 22;
const TRAIL_FADE = "rgba(12, 9, 7, 0.14)";
const BG_FILL = "#0c0907";

let canvas = null;
let ctx = null;
let rafId = null;
let resizeHandler = null;
let hintEl = null;
let ambient = [];
let sparks = [];
let mouse = { x: -9999, y: -9999, active: false };
let clockT = 0;
let hintDismissed = false;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function flowAngle(x, y, t) {
    const s = 0.0026;
    return (
        Math.sin(x * s + t * 0.35) +
        Math.cos(y * s - t * 0.28) +
        Math.sin((x + y) * s * 0.55 + t * 0.5)
    ) * Math.PI;
}

function spawnAmbient(width, height, count) {
    const list = [];
    for (let i = 0; i < count; i += 1) {
        list.push({
            x: rand(0, width),
            y: rand(0, height),
            vx: 0,
            vy: 0,
            heat: rand(0, 1)
        });
    }
    return list;
}

function spawnSparks(x, y) {
    for (let i = 0; i < SPARK_COUNT; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(1.2, 4.2);
        sparks.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: rand(0.012, 0.026),
            heat: rand(0.55, 1)
        });
    }
}

function emberColor(heat, alpha) {
    const hue = 16 + heat * 30; // deep red -> gold
    const light = 42 + heat * 30;
    return `hsla(${hue}, 92%, ${light}%, ${alpha})`;
}

function dismissHint() {
    if (hintDismissed || !hintEl) return;
    hintDismissed = true;
    hintEl.classList.add("art-hint-hidden");
}

function stepAmbient(width, height) {
    for (const p of ambient) {
        let angle = flowAngle(p.x, p.y, clockT);

        if (mouse.active) {
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const dist = Math.hypot(dx, dy);
            if (dist < MOUSE_RADIUS && dist > 0.01) {
                const swirl = Math.atan2(dy, dx) + Math.PI / 2;
                const weight = 1 - dist / MOUSE_RADIUS;
                angle = angle * (1 - weight) + swirl * weight;
            }
        }

        p.vx += Math.cos(angle) * 0.05;
        p.vy += Math.sin(angle) * 0.05;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;
    }
}

function stepSparks() {
    sparks = sparks.filter((s) => s.life > 0);
    for (const s of sparks) {
        s.x += s.vx;
        s.y += s.vy;
        s.vx *= 0.96;
        s.vy *= 0.96;
        s.life -= s.decay;
    }
}

function draw(width, height) {
    ctx.fillStyle = TRAIL_FADE;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";

    for (const p of ambient) {
        const speed = Math.hypot(p.vx, p.vy);
        const alpha = Math.min(0.85, 0.28 + speed * 0.6);
        ctx.fillStyle = emberColor(p.heat, alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const s of sparks) {
        ctx.fillStyle = emberColor(s.heat, Math.max(s.life, 0));
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";
}

function frame() {
    if (!canvas || !ctx) return;
    clockT += 0.016;
    const rect = { width: canvas.width, height: canvas.height };
    stepAmbient(rect.width, rect.height);
    stepSparks();
    draw(rect.width, rect.height);
    rafId = requestAnimationFrame(frame);
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = BG_FILL;
    ctx.fillRect(0, 0, width, height);

    const target = Math.max(AMBIENT_MIN, Math.min(AMBIENT_MAX, Math.floor(width * height * AMBIENT_DENSITY)));
    ambient = spawnAmbient(width, height, target);
}

function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
        x: (event.clientX - rect.left) * dpr,
        y: (event.clientY - rect.top) * dpr
    };
}

function bindEvents() {
    canvas.addEventListener("pointermove", (event) => {
        const point = toCanvasPoint(event);
        mouse.x = point.x;
        mouse.y = point.y;
        mouse.active = true;
        dismissHint();
    });
    canvas.addEventListener("pointerleave", () => {
        mouse.active = false;
    });
    canvas.addEventListener("pointerdown", (event) => {
        const point = toCanvasPoint(event);
        spawnSparks(point.x, point.y);
        dismissHint();
    });

    resizeHandler = resizeCanvas;
    window.addEventListener("resize", resizeHandler);
}

export function cleanupArt() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
    canvas = null;
    ctx = null;
    hintEl = null;
    ambient = [];
    sparks = [];
    mouse = { x: -9999, y: -9999, active: false };
    hintDismissed = false;
}

export function renderArt() {
    cleanupArt();
    const root = document.getElementById("screen");
    if (!root) return;
    root.replaceChildren();

    const wrapper = el("section", { class: "page-shell art-shell" });
    const panel = el("div", { class: "app-panel art-panel" });

    canvas = el("canvas", { class: "art-canvas", "aria-label": "인터랙티브 아트 (마우스로 움직여 보세요)" });
    hintEl = el("span", { class: "art-hint", text: "마우스를 움직여 보세요" });

    panel.append(el("div", { class: "art-frame" }, [canvas, hintEl]));
    wrapper.appendChild(panel);
    root.appendChild(wrapper);

    ctx = canvas.getContext("2d");
    resizeCanvas();
    bindEvents();
    rafId = requestAnimationFrame(frame);
}
