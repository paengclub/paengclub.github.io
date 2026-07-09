// lib/format.js — small pure helpers for numbers and theme values.
// No DOM building here (see lib/dom.js) and no feature logic.

// Coerce a user/DB value to a finite number, tolerating comma grouping
// ("1,234" -> 1234). Returns 0 for anything non-numeric.
export function num(value) {
    const parsed = Number(String(value ?? "").replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

// Read a CSS custom property off :root (e.g. cssVar("--app-primary")).
// Used by the canvas charts so they follow the light/dark theme tokens.
export function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
