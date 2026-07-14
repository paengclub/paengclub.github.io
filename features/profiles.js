// features/profiles.js — 프로필, a card directory of everyone who has ever
// signed in (every row in `profiles`, auto-created by features/board.js on
// first login). Each card shows avatar/name/MBTI/bio plus a tiny preview of
// that person's weekly schedule (from timetable_courses) linking into the
// 시간표 tab. Editing your own details happens on board.js's existing
// renderProfile() screen (reached via the avatar button or the "내 프로필
// 수정" action on your own card here). Exports renderProfilesDirectory,
// cleanupProfilesDirectory.
import { supabase } from "/supabaseClient.js";
import { getCurrentSession, renderProfile, signInWithGoogle } from "/features/board.js";
import { setInitialViewer } from "/features/timetable.js";
import { el } from "/lib/dom.js";

// A generous "typical school day" window for the mini schedule preview, so
// every card's preview uses the same scale regardless of that person's
// actual earliest/latest class.
const MINI_START_MINUTE = 8 * 60;
const MINI_END_MINUTE = 22 * 60;
const MINI_RANGE = MINI_END_MINUTE - MINI_START_MINUTE;
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

function initials(name) {
    return (name || "?").trim().slice(0, 1).toUpperCase();
}

async function loadDirectory() {
    const [profilesResult, coursesResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("id, display_name, nickname, avatar_url, bio, mbti, created_at")
            .order("created_at", { ascending: true }),
        supabase
            .from("timetable_courses")
            .select("user_id, day_of_week, start_minute, end_minute, color")
    ]);

    if (profilesResult.error) throw profilesResult.error;
    if (coursesResult.error) throw coursesResult.error;

    const coursesByUser = new Map();
    for (const course of coursesResult.data || []) {
        if (!coursesByUser.has(course.user_id)) coursesByUser.set(course.user_id, []);
        coursesByUser.get(course.user_id).push(course);
    }

    return (profilesResult.data || []).map((profile) => ({
        ...profile,
        courses: coursesByUser.get(profile.id) || []
    }));
}

function renderMiniTimetable(courses) {
    if (courses.length === 0) {
        return el("div", { class: "pdir-mini-empty", text: "시간표 없음" });
    }

    const grid = el("div", { class: "pdir-mini-grid" });
    for (const course of courses) {
        const start = Math.max(course.start_minute, MINI_START_MINUTE);
        const end = Math.min(course.end_minute, MINI_END_MINUTE);
        if (end <= start) continue;
        const top = ((start - MINI_START_MINUTE) / MINI_RANGE) * 100;
        const height = ((end - start) / MINI_RANGE) * 100;
        const dayCount = 7;
        const left = (course.day_of_week / dayCount) * 100;
        const width = (1 / dayCount) * 100;

        grid.appendChild(el("span", {
            class: "pdir-mini-block",
            style: `top:${top}%;height:${Math.max(height, 3)}%;left:${left}%;width:${width}%;background:${course.color}`
        }));
    }
    return grid;
}

function renderCard(profile, isSelf) {
    const name = profile.nickname || profile.display_name || "Paengclub member";
    const card = el("article", { class: `pdir-card${isSelf ? " is-self" : ""}` });

    const header = el("div", { class: "pdir-card-head" }, [
        profile.avatar_url
            ? el("img", { class: "pdir-avatar", src: profile.avatar_url, alt: "" })
            : el("div", { class: "pdir-avatar pdir-avatar-fallback", text: initials(name) }),
        el("div", { class: "pdir-identity" }, [
            el("div", { class: "pdir-name-row" }, [
                el("strong", { class: "pdir-name", text: name }),
                profile.mbti ? el("span", { class: "pdir-mbti", text: profile.mbti }) : null
            ]),
            profile.nickname && profile.display_name !== profile.nickname
                ? el("span", { class: "pdir-realname muted-text", text: profile.display_name })
                : null
        ])
    ]);

    const bio = el("p", { class: "pdir-bio", text: profile.bio || "아직 소개가 없어요." });

    const footer = el("div", { class: "pdir-card-foot" }, [
        renderMiniTimetable(profile.courses),
        el("div", { class: "pdir-card-actions" }, [
            el("button", {
                class: "text-action",
                type: "button",
                text: "시간표 보기",
                onclick: () => {
                    setInitialViewer(profile.id);
                    document.getElementById("8")?.click();
                }
            }),
            isSelf ? el("button", {
                class: "text-action",
                type: "button",
                text: "내 프로필 수정",
                onclick: renderProfile
            }) : null
        ])
    ]);

    card.append(header, bio, footer);
    return card;
}

function renderShell() {
    const root = document.getElementById("screen");
    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell pdir-shell" });
    const panel = el("div", { class: "app-panel pdir-panel" });
    panel.append(
        el("div", { class: "section-header" }, [
            el("div", {}, [el("h1", { class: "section-title", text: "프로필" })])
        ]),
        el("div", { id: "pdirBody", class: "pdir-body" }, [
            el("div", { class: "empty-line", text: "불러오는 중..." })
        ])
    );
    wrapper.appendChild(panel);
    root.appendChild(wrapper);
}

export function cleanupProfilesDirectory() {
    // No timers/listeners/channels to release — every listener here is
    // attached to elements torn down with #screen on tab switch.
}

export async function renderProfilesDirectory() {
    renderShell();
    const body = document.getElementById("pdirBody");
    const session = getCurrentSession();

    try {
        const people = await loadDirectory();
        body.replaceChildren();

        if (people.length === 0) {
            body.appendChild(el("div", { class: "board-empty", text: "아직 가입한 사람이 없어요." }));
            return;
        }

        const grid = el("div", { class: "pdir-grid" });
        for (const profile of people) grid.appendChild(renderCard(profile, profile.id === session?.user?.id));
        body.appendChild(grid);

        if (!session) {
            body.appendChild(el("div", { class: "pdir-login-hint" }, [
                el("span", { text: "로그인하면 내 프로필과 시간표를 등록할 수 있어요." }),
                el("button", { class: "secondary-button compact", type: "button", text: "Google 로그인", onclick: signInWithGoogle })
            ]));
        }
    } catch (error) {
        body.replaceChildren(el("div", { class: "portfolio-error", text: error.message }));
    }
}
