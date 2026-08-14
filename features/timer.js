// features/timer.js — 디데이, the landing tab: a live progress card per member
// (discharge % + rank/leave schedule) built from the static data in /data.js.
// Imports current_rendered_page from /app.js so its animation loop only redraws
// while this tab is showing (the one intentional feature -> app circular
// import). Exports renderTimer, cleanupTimer.
import {itineraries, members} from "/data.js";
import {current_rendered_page} from "/app.js";
import {el} from "/lib/dom.js";

const DAY_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayMs = 24 * 60 * 60 * 1000;

let frameId = null;

function rankImageFor(member) {
    if (member.isDischarged == 'true') return 'images/reserved.jpg';
    if (member.ANF == '공익' && member.rank != 'PV2.jpg' && member.rank != 'GEN.svg') return 'images/social.svg';
    return 'images/' + member.rank;
}

function formatDDay(targetDate, doneLabel) {
    const days = Math.floor((new Date(targetDate + "T00:00:00").getTime() - Date.now()) / dayMs) + 1;
    if (days > 0) return `D-${days}`;
    if (days === 0) return "D-DAY";
    return `${doneLabel} ${-days}일 차`;
}

function formatScheduleDate(date) {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}년 ${month}월 ${day}일(${DAY_OF_WEEK[date.getDay()]})`;
}

// Percent of the way from enlistment to `targetDate`, uncapped so the caller
// can tell "finished" from "nearly there".
function progressFor(member, targetDate) {
    const enlisted = new Date(member.dates[0] + "T00:00:00").getTime();
    const target = new Date(`${targetDate}T00:00:00`).getTime();
    return (100 * (Date.now() - enlisted)) / (target - enlisted);
}

// --- live update loop ------------------------------------------------------

function paintMeter(meter, progress, doneLabel) {
    const fill = meter.querySelector(".meter-fill");
    const value = meter.querySelector(".meter-value");

    if (progress >= 100) {
        fill.style.width = "100%";
        meter.classList.add("is-done");
        value.textContent = doneLabel;
        return;
    }

    fill.style.width = `${Math.max(progress, 0)}%`;
    meter.classList.remove("is-done");
    // Six decimals, ticking every frame — the original site's party trick.
    value.textContent = `${(Math.floor(progress * 1000000) / 1000000).toFixed(6)}%`;
}

function updater() {
    if (current_rendered_page != 3) {
        frameId = null;
        return;
    }

    for (const meter of document.querySelectorAll(".meter[data-member]")) {
        const member = members[Number(meter.dataset.member)];
        if (!member) continue;
        paintMeter(meter, progressFor(member, member.dates[4]), "전역을 축하합니다!");
    }

    frameId = window.requestAnimationFrame(updater);
}

// --- markup ----------------------------------------------------------------

function createMeter(memberId) {
    return el("div", { class: "meter", "data-member": String(memberId) }, [
        el("div", { class: "meter-head" }, [
            el("span", { class: "meter-label", text: "전역까지" }),
            el("span", { class: "meter-value", text: "0%" })
        ]),
        el("div", { class: "meter-track" }, [el("div", { class: "meter-fill" })])
    ]);
}

function scheduleItems(member) {
    const items = [];

    for (const itinerary of itineraries) {
        if (itinerary.name != member.name) continue;

        // Milestones (입대/진급/전역) always show; one-off events (휴가, 말출 …)
        // only while they are still ahead.
        const kind = itinerary.type[3] + itinerary.type[4];
        const isMilestone = kind == '입대' || kind == '진급' || kind == '전역'
            || itinerary.type[0] == '보' || itinerary.type[4] == '입';
        const target = new Date(itinerary.date + 'T00:00:00');
        const distance = target.getTime() - Date.now();
        if (!isMilestone && distance < 0) continue;

        items.push(el("li", { class: "dday-item" }, [
            el("span", { class: "dday-item-date", text: formatScheduleDate(target) }),
            el("span", { class: "dday-item-type", text: itinerary.type }),
            distance > 0
                ? el("span", { class: "dday-item-badge", text: `D-${Math.floor((distance + dayMs) / dayMs)}` })
                : null
        ]));
    }

    return items;
}

function createCard(memberId) {
    const member = members[memberId];
    const schedule = el("ul", { class: "dday-schedule", hidden: "" }, scheduleItems(member));

    const toggle = el("button", {
        class: "dday-toggle",
        type: "button",
        "aria-expanded": "false",
        text: "일정 보기"
    });
    toggle.addEventListener("click", () => setExpanded(toggle, schedule, schedule.hidden));

    return el("article", { class: "dday-card" }, [
        el("div", { class: "dday-head" }, [
            el("img", { class: "dday-rank", src: rankImageFor(member), alt: "" }),
            el("div", { class: "dday-identity" }, [
                el("span", { class: "dday-name", text: member.name }),
                el("span", { class: "dday-branch", text: member.ANF })
            ]),
            el("span", { class: "dday-status", text: formatDDay(member.dates[4], "전역") })
        ]),
        createMeter(memberId),
        toggle,
        schedule
    ]);
}

function setExpanded(toggle, schedule, expand) {
    schedule.hidden = !expand;
    toggle.setAttribute("aria-expanded", String(expand));
    toggle.textContent = expand ? "일정 접기" : "일정 보기";
}

function createExpandAll(cards) {
    const button = el("button", { class: "secondary-button dday-expand-all", type: "button", text: "모두 펼쳐보기" });
    let expanded = false;

    button.addEventListener("click", () => {
        expanded = !expanded;
        for (const card of cards) {
            setExpanded(card.querySelector(".dday-toggle"), card.querySelector(".dday-schedule"), expanded);
        }
        button.textContent = expanded ? "모두 접기" : "모두 펼쳐보기";
    });

    return button;
}

export function cleanupTimer() {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
}

export function renderTimer() {
    cleanupTimer();
    const root = document.getElementById("screen");
    if (!root) return;

    const cards = members.map((_, memberId) => createCard(memberId));
    const wrapper = el("section", { class: "page-shell dday-shell" }, [
        el("div", { class: "dday-grid" }, cards),
        createExpandAll(cards)
    ]);

    root.appendChild(wrapper);
    updater();
}
