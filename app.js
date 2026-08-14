// app.js — the app shell / router. Wires the nav, theme toggle and auth, then
// switches tabs: each numeric page id maps to one /features module's
// render*/cleanup* pair (see myRenderFunction + ARCHITECTURE.md).
import {itineraries, members} from "/data.js";
import {cleanupTimer, renderTimer} from "/features/timer.js";
import {initAuth} from "/features/auth.js";
import {cleanupWeightTracker, renderWeightTracker} from "/features/weight.js";
import {cleanupGameTier, renderGameTier} from "/features/tier.js";
import {cleanupTimetable, renderTimetable as renderTimetableGrid} from "/features/timetable.js";

document.body.onload = init;
// 3 (디데이) is the landing page. Ids 0/1/2/5/7 are retired (홈/미니게임/
// 그림판/자산관리/프로필) — left unused rather than renumbering the rest.
let current_rendered_page = 3;

const rankNameSet = ['일병 진급', '상병 진급', '병장 진급', '만기 전역'];
const rankImageSet = ['PV2.jpg', 'PFC.jpg', 'CPL.jpg', 'SGT.jpg', 'GEN.svg', 'SSG.svg'];

function preprocessed() {
    for (let i = 0; i < members.length; i++) {
        itineraries.push({name:members[i].name, type:members[i].ANF + ' 입대', date:members[i].dates[0]});
        for (let j = 0; j < 4; j++) itineraries.push({name:members[i].name, type:rankNameSet[j], date:members[i].dates[j + 1]});

        const curTime = new Date().getTime();
        
        for (let j = 0; j < 5; j++) if (curTime > new Date(members[i].dates[j]).getTime()) members[i].rank = rankImageSet[j];
        if (members[i].ANF == '공군') members[i].rank = 'AF_' + members[i].rank;
    }

    for (let i = 0; i < itineraries.length; i++) { // Sort Itineraries
        for (let j = 0; j < itineraries.length - i - 1; j++) {
            if (new Date(itineraries[j].date).getTime() < new Date(itineraries[j + 1].date).getTime()) continue;
            const temp = itineraries[j];
            itineraries[j] = itineraries[j + 1];
            itineraries[j + 1] = temp;
        }
    }
}

function onButtonClick(buttonContent) {
    current_rendered_page = Number(buttonContent);
    myRenderFunction();
}

function setActiveNavButton() {
    const buttonList = document.querySelectorAll('.nav-buttons');
    for (let i = 0; i < buttonList.length; i++) {
        if (Number(buttonList[i].id) == current_rendered_page) buttonList[i].classList.add("active");
        else buttonList[i].classList.remove("active");
    }
}

async function init() {
    // initializes the page
    const buttonList = document.querySelectorAll('.nav-buttons');
    for (let i = 0; i < buttonList.length; i++) {
        buttonList[i].addEventListener("click", function(event) {
            onButtonClick(event.target.id);
        });
    }

    preprocessed();

    // Resolve the auth session before the first render so a tab paints once
    // (owner controls vs. login known up front) instead of rendering as a
    // guest and then re-rendering the whole page once the session resolves.
    await initAuth(function() {
        if (current_rendered_page == 8) myRenderFunction();
    });

    myRenderFunction();
}

function myRenderFunction() {
    // what to do in this function
    // 1. delete all rendered elements
    // 2. add all new elements according to PAGE_YOURE_LOOKING_AT
    if (current_rendered_page != 3) cleanupTimer();
    if (current_rendered_page != 4) cleanupWeightTracker();
    if (current_rendered_page != 6) cleanupGameTier();
    if (current_rendered_page != 8) cleanupTimetable();
    document.getElementById("screen").replaceChildren();
    setActiveNavButton();

    if (current_rendered_page == 3) renderTimer();
    if (current_rendered_page == 4) renderWeightTracker();
    if (current_rendered_page == 6) renderGameTier();
    if (current_rendered_page == 8) renderTimetableGrid();
}

export {current_rendered_page, rankImageSet};
