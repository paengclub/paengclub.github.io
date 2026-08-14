// features/timetable.js — 시간표, an Everytime-style weekly class grid.
// Anyone can view anyone's schedule (public read); only the signed-in owner
// can add/edit/delete their own courses. Switch whose schedule you're looking
// at with the person chips above the grid.
// Exports renderTimetable, cleanupTimetable.
import { supabase } from "/supabaseClient.js";
import { getCurrentSession, signInWithGoogle } from "/features/auth.js";
import { el } from "/lib/dom.js";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const HOUR_ROW_PX = 52;
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 18;
const TIME_STEP_MINUTES = 5;
const COLOR_PALETTE = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
    "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"
];

let people = [];
let courses = [];
let viewerId = null;
let panelMode = null; // null | "view" | "edit" | "add"
let selectedCourse = null;
let chosenColor = COLOR_PALETTE[0];
let selectedDays = new Set();

function roundToStep(minute) {
    return Math.round(minute / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
}

function minutesFromTimeInput(value) {
    const [h, m] = value.split(":").map(Number);
    return roundToStep(h * 60 + m);
}

function dayLabelsFor(days) {
    return [...days].sort((a, b) => a - b).map((day) => DAY_LABELS[day]).join("·");
}

function formatMinutes(minute) {
    const h = String(Math.floor(minute / 60)).padStart(2, "0");
    const m = String(minute % 60).padStart(2, "0");
    return `${h}:${m}`;
}

function displayName(person) {
    return person.nickname || person.display_name || "Paengclub member";
}

function initials(name) {
    return (name || "?").trim().slice(0, 1).toUpperCase();
}

async function loadAll() {
    const [peopleResult, coursesResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("id, display_name, nickname, avatar_url")
            .order("created_at", { ascending: true }),
        supabase
            .from("timetable_courses")
            .select("id, user_id, name, professor, location, days, start_minute, end_minute, color, memo")
            .order("start_minute", { ascending: true })
    ]);

    if (peopleResult.error) throw peopleResult.error;
    if (coursesResult.error) throw coursesResult.error;
    people = peopleResult.data || [];
    courses = coursesResult.data || [];
}

function coursesFor(userId) {
    return courses.filter((course) => course.user_id === userId);
}

function activeDays(viewerCourses) {
    const days = new Set([0, 1, 2, 3, 4]);
    for (const course of viewerCourses) {
        for (const day of course.days) {
            if (day === 5 || day === 6) days.add(day);
        }
    }
    return [...days].sort((a, b) => a - b);
}

function hourRange(viewerCourses) {
    let startMinute = DEFAULT_START_HOUR * 60;
    let endMinute = DEFAULT_END_HOUR * 60;
    for (const course of viewerCourses) {
        startMinute = Math.min(startMinute, course.start_minute);
        endMinute = Math.max(endMinute, course.end_minute);
    }
    const startHour = Math.max(0, Math.floor(startMinute / 60));
    const endHour = Math.min(24, Math.ceil(endMinute / 60));
    return { startHour, endHour: Math.max(endHour, startHour + 1) };
}

// --- panel (add / edit / read-only detail) ---

function closePanel() {
    panelMode = null;
    selectedCourse = null;
    renderPanel();
}

function openAddForm() {
    panelMode = "add";
    selectedCourse = null;
    chosenColor = COLOR_PALETTE[coursesFor(viewerId).length % COLOR_PALETTE.length];
    selectedDays = new Set([0]);
    renderPanel();
}

function openDetail(course) {
    selectedCourse = course;
    panelMode = "view";
    renderPanel();
}

function switchToEdit() {
    chosenColor = selectedCourse.color;
    selectedDays = new Set(selectedCourse.days);
    panelMode = "edit";
    renderPanel();
}

async function submitCourse(values, existingId) {
    const session = getCurrentSession();
    if (!session) return;

    const name = values.name.trim();
    if (!name) {
        setPanelStatus("과목명을 입력해 주세요.", "danger");
        return;
    }
    if (selectedDays.size === 0) {
        setPanelStatus("요일을 하나 이상 선택해 주세요.", "danger");
        return;
    }
    const startMinute = minutesFromTimeInput(values.start);
    const endMinute = minutesFromTimeInput(values.end);
    if (!(endMinute > startMinute)) {
        setPanelStatus("종료 시간이 시작 시간보다 늦어야 해요.", "danger");
        return;
    }

    const payload = {
        user_id: session.user.id,
        name: name.slice(0, 60),
        professor: values.professor.trim().slice(0, 40),
        location: values.location.trim().slice(0, 40),
        days: [...selectedDays].sort((a, b) => a - b),
        start_minute: startMinute,
        end_minute: endMinute,
        color: chosenColor,
        memo: values.memo.trim().slice(0, 100)
    };

    const result = existingId
        ? await supabase.from("timetable_courses").update(payload).eq("id", existingId)
        : await supabase.from("timetable_courses").insert(payload);

    if (result.error) {
        setPanelStatus(result.error.message, "danger");
        return;
    }

    await loadAll();
    closePanel();
    renderBody();
}

async function deleteCourse(id) {
    if (!window.confirm("이 과목을 삭제할까요?")) return;
    const { error } = await supabase.from("timetable_courses").delete().eq("id", id);
    if (error) {
        setPanelStatus(error.message, "danger");
        return;
    }
    await loadAll();
    closePanel();
    renderBody();
}

function setPanelStatus(message, type = "") {
    const status = document.getElementById("ttPanelStatus");
    if (!status) return;
    status.className = `weight-compare-item tt-panel-status ${type}`.trim();
    status.textContent = message;
}

function dayToggleRow() {
    const row = el("div", { class: "tt-day-toggle-row" });
    DAY_LABELS.forEach((label, index) => {
        const btn = el("button", {
            type: "button",
            class: `tt-day-toggle${selectedDays.has(index) ? " active" : ""}`,
            text: label,
            onclick: () => {
                if (selectedDays.has(index)) selectedDays.delete(index);
                else selectedDays.add(index);
                btn.classList.toggle("active");
            }
        });
        row.appendChild(btn);
    });
    return row;
}

function colorSwatchRow(container) {
    const row = el("div", { class: "tt-swatch-row" });
    COLOR_PALETTE.forEach((color) => {
        const swatch = el("button", {
            type: "button",
            class: `tt-swatch${color === chosenColor ? " active" : ""}`,
            style: `background:${color}`,
            "aria-label": color,
            onclick: () => {
                chosenColor = color;
                row.querySelectorAll(".tt-swatch").forEach((node) => node.classList.remove("active"));
                swatch.classList.add("active");
            }
        });
        row.appendChild(swatch);
    });
    container.appendChild(row);
    return row;
}

function renderCourseForm(existing) {
    const nameInput = el("input", { class: "form-control", maxlength: "60", placeholder: "과목명", value: existing?.name || "" });
    const professorInput = el("input", { class: "form-control", maxlength: "40", placeholder: "교수님 (선택)", value: existing?.professor || "" });
    const locationInput = el("input", { class: "form-control", maxlength: "40", placeholder: "강의실 (선택)", value: existing?.location || "" });
    const startInput = el("input", { class: "form-control", type: "time", step: String(TIME_STEP_MINUTES * 60), value: existing ? formatMinutes(existing.start_minute) : "09:00" });
    const endInput = el("input", { class: "form-control", type: "time", step: String(TIME_STEP_MINUTES * 60), value: existing ? formatMinutes(existing.end_minute) : "10:15" });
    const memoInput = el("input", { class: "form-control", maxlength: "100", placeholder: "메모 (선택)", value: existing?.memo || "" });

    const form = el("div", { class: "tt-form" }, [
        el("label", { class: "pf-field" }, [el("span", { text: "과목명" }), nameInput]),
        el("label", { class: "pf-field" }, [el("span", { text: "요일 (복수 선택 가능)" }), dayToggleRow()]),
        el("div", { class: "tt-form-row" }, [
            el("label", { class: "pf-field" }, [el("span", { text: "시작" }), startInput]),
            el("label", { class: "pf-field" }, [el("span", { text: "종료" }), endInput])
        ]),
        el("div", { class: "tt-form-row" }, [
            el("label", { class: "pf-field" }, [el("span", { text: "강의실" }), locationInput]),
            el("label", { class: "pf-field" }, [el("span", { text: "교수님" }), professorInput])
        ]),
        el("label", { class: "pf-field" }, [el("span", { text: "메모" }), memoInput]),
        el("label", { class: "pf-field" }, [el("span", { text: "색상" })])
    ]);
    colorSwatchRow(form);

    const actions = el("div", { class: "profile-actions" }, [
        el("button", {
            class: "primary-button",
            type: "button",
            text: existing ? "수정 저장" : "추가",
            onclick: () => submitCourse({
                name: nameInput.value,
                professor: professorInput.value,
                location: locationInput.value,
                start: startInput.value,
                end: endInput.value,
                memo: memoInput.value
            }, existing?.id || null)
        }),
        existing ? el("button", {
            class: "text-action danger",
            type: "button",
            text: "삭제",
            onclick: () => deleteCourse(existing.id)
        }) : null,
        el("button", { class: "secondary-button", type: "button", text: "취소", onclick: closePanel })
    ]);

    form.appendChild(actions);
    return form;
}

function renderDetailView(course) {
    const owner = people.find((person) => person.id === course.user_id);
    const isOwn = getCurrentSession()?.user?.id === course.user_id;
    const lines = el("div", { class: "tt-detail" }, [
        el("h3", { class: "tt-detail-title" }, [
            el("span", { class: "tt-swatch tt-swatch-static", style: `background:${course.color}` }),
            course.name
        ]),
        el("div", { class: "muted-text", text: `${dayLabelsFor(course.days)}요일 · ${formatMinutes(course.start_minute)}–${formatMinutes(course.end_minute)}` }),
        course.location ? el("div", { class: "muted-text", text: `📍 ${course.location}` }) : null,
        course.professor ? el("div", { class: "muted-text", text: `👤 ${course.professor}` }) : null,
        course.memo ? el("div", { class: "muted-text", text: course.memo }) : null,
        owner ? el("div", { class: "muted-text", text: `${displayName(owner)}의 과목` }) : null
    ]);

    const actions = el("div", { class: "profile-actions" }, [
        isOwn ? el("button", { class: "secondary-button compact", type: "button", text: "수정", onclick: switchToEdit }) : null,
        el("button", { class: "text-action", type: "button", text: "닫기", onclick: closePanel })
    ]);

    return el("div", {}, [lines, actions]);
}

function renderPanel() {
    const target = document.getElementById("ttPanel");
    if (!target) return;
    target.hidden = panelMode === null;
    if (panelMode === null) {
        target.replaceChildren();
        return;
    }

    const body = panelMode === "view" ? renderDetailView(selectedCourse) : renderCourseForm(panelMode === "edit" ? selectedCourse : null);
    target.replaceChildren(
        el("div", { class: "tt-panel-inner" }, [
            body,
            el("div", { id: "ttPanelStatus", class: "tt-panel-status" })
        ])
    );
}

// --- grid ---

function renderGrid(viewerCourses) {
    const days = activeDays(viewerCourses);
    const { startHour, endHour } = hourRange(viewerCourses);
    const hourCount = endHour - startHour;
    const gridStyle = `grid-template-columns: 44px repeat(${days.length}, minmax(0, 1fr)); grid-template-rows: 30px repeat(${hourCount}, ${HOUR_ROW_PX}px);`;

    const grid = el("div", { class: "tt-grid", style: gridStyle });
    grid.appendChild(el("div", { class: "tt-corner", style: "grid-column:1;grid-row:1" }));

    days.forEach((day, index) => {
        grid.appendChild(el("div", {
            class: "tt-day-head",
            style: `grid-column:${index + 2};grid-row:1`,
            text: DAY_LABELS[day]
        }));
    });

    const timeCol = el("div", {
        class: "tt-time-col",
        style: `grid-column:1;grid-row:2 / span ${hourCount}`
    });
    for (let hour = startHour; hour < endHour; hour += 1) {
        timeCol.appendChild(el("div", { class: "tt-time-label", style: `height:${HOUR_ROW_PX}px`, text: `${String(hour).padStart(2, "0")}:00` }));
    }
    grid.appendChild(timeCol);

    const rangeStart = startHour * 60;
    const rangeMinutes = hourCount * 60;

    days.forEach((day, index) => {
        const dayCol = el("div", {
            class: "tt-day-col",
            style: `grid-column:${index + 2};grid-row:2 / span ${hourCount};background-size:100% ${HOUR_ROW_PX}px`
        });

        coursesFor(viewerId)
            .filter((course) => course.days.includes(day))
            .forEach((course) => {
                const top = ((course.start_minute - rangeStart) / rangeMinutes) * 100;
                const height = ((course.end_minute - course.start_minute) / rangeMinutes) * 100;
                dayCol.appendChild(el("button", {
                    type: "button",
                    class: "tt-block",
                    style: `top:${top}%;height:${Math.max(height, 4)}%;background:${course.color}`,
                    onclick: () => openDetail(course)
                }, [
                    el("strong", { text: course.name }),
                    course.location ? el("span", { text: course.location }) : null
                ]));
            });

        grid.appendChild(dayCol);
    });

    return grid;
}

function renderCourseList(viewerCourses) {
    if (viewerCourses.length === 0) {
        return el("div", { class: "empty-line", text: "등록된 과목이 없어요." });
    }
    const sorted = [...viewerCourses].sort((a, b) => Math.min(...a.days) - Math.min(...b.days) || a.start_minute - b.start_minute);
    return el("div", { class: "tt-course-list" }, sorted.map((course) => el("div", { class: "tt-course-item" }, [
        el("span", { class: "tt-swatch tt-swatch-static", style: `background:${course.color}` }),
        el("span", { class: "tt-course-item-name", text: course.name }),
        el("span", { class: "muted-text", text: `${dayLabelsFor(course.days)} ${formatMinutes(course.start_minute)}–${formatMinutes(course.end_minute)}${course.location ? " · " + course.location : ""}` })
    ])));
}

function renderPeopleRow() {
    const row = el("div", { class: "tt-people" });
    for (const person of people) {
        row.appendChild(el("button", {
            type: "button",
            class: `tt-person-chip${person.id === viewerId ? " active" : ""}`,
            onclick: () => {
                viewerId = person.id;
                closePanel();
                renderBody();
            }
        }, [
            person.avatar_url
                ? el("img", { class: "avatar small", src: person.avatar_url, alt: "" })
                : el("span", { class: "avatar small avatar-fallback", text: initials(displayName(person)) }),
            el("span", { text: displayName(person) })
        ]));
    }
    return row;
}

function renderBody() {
    const peopleWrap = document.getElementById("ttPeopleWrap");
    const gridWrap = document.getElementById("ttGridWrap");
    const listWrap = document.getElementById("ttListWrap");
    const toolbar = document.getElementById("ttToolbar");
    if (!peopleWrap || !gridWrap) return;

    peopleWrap.replaceChildren(renderPeopleRow());

    const viewer = people.find((person) => person.id === viewerId);
    const viewerCourses = viewerId ? coursesFor(viewerId) : [];
    const isOwnViewer = viewerId && getCurrentSession()?.user?.id === viewerId;

    toolbar.replaceChildren(
        ...[
            el("div", { class: "muted-text", text: viewer ? `${displayName(viewer)}의 시간표` : "사람을 선택하세요" }),
            isOwnViewer ? el("button", { class: "secondary-button compact", type: "button", text: "+ 과목 추가", onclick: openAddForm }) : null
        ].filter(Boolean)
    );

    if (!viewer) {
        gridWrap.replaceChildren(el("div", { class: "empty-line", text: "표시할 사람이 없어요." }));
        listWrap.replaceChildren();
        return;
    }

    gridWrap.replaceChildren(renderGrid(viewerCourses));
    listWrap.replaceChildren(renderCourseList(viewerCourses));
}

function renderShell() {
    const root = document.getElementById("screen");
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell tt-shell" });
    const panel = el("div", { class: "app-panel tt-page-panel" });

    panel.append(
        el("div", { class: "section-header" }, [el("div", {}, [el("h1", { class: "section-title", text: "시간표" })])]),
        el("div", { id: "ttPeopleWrap" }),
        el("div", { id: "ttToolbar", class: "tt-toolbar" }),
        el("div", { id: "ttGridWrap", class: "tt-grid-wrap" }),
        el("div", { id: "ttPanel", class: "tt-panel", hidden: "" }),
        el("div", { id: "ttListWrap" })
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);
}

export function cleanupTimetable() {
    panelMode = null;
    selectedCourse = null;
}

function resolveViewer() {
    const session = getCurrentSession();
    // keep whoever was being viewed if they are still around
    if (viewerId && people.some((person) => person.id === viewerId)) return;
    if (session && people.some((person) => person.id === session.user.id)) viewerId = session.user.id;
    else viewerId = people[0]?.id || null;
}

export async function renderTimetable() {
    cleanupTimetable();
    renderShell();
    const body = document.getElementById("ttGridWrap");

    // Revisiting the tab: draw the schedule we already loaded, then refresh
    // underneath instead of blanking the grid.
    if (people.length > 0) {
        resolveViewer();
        renderBody();
    }

    try {
        await loadAll();
        const session = getCurrentSession();
        resolveViewer();
        renderBody();

        if (!session) {
            document.getElementById("ttListWrap")?.appendChild(el("div", { class: "pdir-login-hint" }, [
                el("span", { text: "로그인하면 내 시간표를 만들 수 있어요." }),
                el("button", { class: "secondary-button compact", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
            ]));
        }
    } catch (error) {
        // if a cached schedule is already on screen, leave it rather than
        // replacing it with an error
        if (people.length > 0) return;
        body.replaceChildren(el("div", { class: "portfolio-error", text: error.message }));
    }
}
