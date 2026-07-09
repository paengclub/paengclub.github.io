// lib/dom.js — shared DOM builders (no dependencies, no side effects).
//
// Every feature module builds its UI imperatively with these helpers instead
// of innerHTML strings, so this is the one place the element-creation
// convention lives. Import what you need: `import { el } from "/lib/dom.js"`.

// Build an HTML element.
//   attrs: "class"/"text"/"html" are special; onX (onclick, oninput, …)
//   attach listeners; anything else becomes an attribute. null/undefined
//   attribute values are skipped so `checked: cond ? "" : null` works.
//   children: strings become text nodes; falsy children are ignored so you
//   can inline `cond ? el(...) : null`.
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
    }
    return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Build an SVG element (namespaced). Same attr/children rules as el() but
// every attribute is set via setAttributeNS-less setAttribute, which is what
// SVG presentation attributes need.
export function svg(tag, attrs = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
}
