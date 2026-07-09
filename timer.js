import { members } from "/data.js";

const dayMs = 24 * 60 * 60 * 1000;

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

function parseLocalDate(date) {
    return new Date(`${date}T00:00:00`);
}

function todayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysSince(date) {
    return Math.max(0, Math.floor((todayStart().getTime() - parseLocalDate(date).getTime()) / dayMs));
}

function formatDate(date) {
    return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(parseLocalDate(date));
}

function veteranRows() {
    return members
        .map((member) => ({
            ...member,
            enlistDate: member.dates[0],
            dischargeDate: member.dates[4],
            daysAfter: daysSince(member.dates[4])
        }))
        .filter((member) => member.daysAfter >= 0)
        .sort((a, b) => a.daysAfter - b.daysAfter);
}

function averageDays(rows) {
    if (rows.length === 0) return 0;
    return Math.round(rows.reduce((sum, row) => sum + row.daysAfter, 0) / rows.length);
}

function renderSummary(rows) {
    const newest = rows[0];
    const oldest = [...rows].sort((a, b) => b.daysAfter - a.daysAfter)[0];
    return el("section", { class: "dday-summary" }, [
        summaryCard("최근 전역", newest ? newest.name : "-", newest ? `전역 ${newest.daysAfter}일 차` : "-"),
        summaryCard("평균", `${averageDays(rows)}일 차`, `${rows.length}명 기준`),
        summaryCard("최장", oldest ? oldest.name : "-", oldest ? `전역 ${oldest.daysAfter}일 차` : "-")
    ]);
}

function summaryCard(label, value, helper) {
    return el("div", { class: "dday-summary-card" }, [
        el("span", { text: label }),
        el("strong", { text: value }),
        el("small", { text: helper })
    ]);
}

function renderVeteranCard(member, maxDays) {
    const ratio = maxDays > 0 ? (member.daysAfter / maxDays) * 100 : 0;
    const serviceDays = Math.max(1, Math.round((parseLocalDate(member.dischargeDate).getTime() - parseLocalDate(member.enlistDate).getTime()) / dayMs));
    return el("article", { class: "dday-card" }, [
        el("div", { class: "dday-card-main" }, [
            el("div", {}, [
                el("strong", { text: member.name }),
                el("span", { text: `${member.ANF} · 복무 ${serviceDays}일` })
            ]),
            el("div", { class: "dday-days" }, [
                el("span", { text: "전역 후" }),
                el("strong", { text: `${member.daysAfter}일` })
            ])
        ]),
        el("div", { class: "dday-bar", "aria-hidden": "true" }, [
            el("span", { style: `width:${Math.max(4, Math.min(100, ratio))}%` })
        ]),
        el("div", { class: "dday-meta" }, [
            el("span", { text: `입대 ${formatDate(member.enlistDate)}` }),
            el("span", { text: `전역 ${formatDate(member.dischargeDate)}` })
        ])
    ]);
}

function renderTimer() {
    const root = document.getElementById("screen");
    const rows = veteranRows();
    const maxDays = Math.max(...rows.map((row) => row.daysAfter), 1);
    const wrapper = el("section", { class: "page-shell dday-shell" });
    const panel = el("div", { class: "app-panel dday-panel" }, [
        el("div", { class: "section-header dday-header" }, [
            el("div", {}, [
                el("h1", { class: "section-title", text: "디데이" })
            ])
        ]),
        renderSummary(rows),
        el("section", { class: "dday-list" }, rows.map((member) => renderVeteranCard(member, maxDays)))
    ]);

    root.appendChild(wrapper);
    wrapper.appendChild(panel);
}

export { renderTimer };
