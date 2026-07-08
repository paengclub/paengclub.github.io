import {itineraries, members} from "/data.js";
import {renderTimer} from "/timer.js";
import {initBoardAuth, renderBoard} from "/board.js";
import {renderPixelBoard} from "/canvas.js";
import {cleanupGames, renderGames} from "/games.js";
import {cleanupWeightTracker, renderWeightTracker} from "/weight.js";

document.body.onload = init;
let current_rendered_page = 0;

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

let manualTheme = null;

function setTheme(theme) {
    document.documentElement.setAttribute("data-bs-theme", theme);
    document.getElementById("colorSwitcher").classList.toggle("is-dark", theme == "dark");
}

function initTheme() {
    localStorage.removeItem("paengclub-theme");
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = function(event) {
        if (manualTheme) return;
        setTheme(event.matches ? "dark" : "light");
    };
    setTheme(mediaQuery.matches ? "dark" : "light");
    if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", syncTheme);
    else if (mediaQuery.addListener) mediaQuery.addListener(syncTheme);
}

function switchDarkMode() {
    const currentTheme = document.documentElement.getAttribute("data-bs-theme");
    const nextTheme = currentTheme == "light" ? "dark" : "light";
    manualTheme = nextTheme;
    setTheme(nextTheme);
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

function init() {
    // initializes the page
    const buttonList = document.querySelectorAll('.nav-buttons');
    for (let i = 0; i < buttonList.length; i++) {
        buttonList[i].addEventListener("click", function(event) {
            onButtonClick(event.target.id);
        });
    }

    initTheme();
    document.getElementById('colorSwitcher').addEventListener("click", function() {
        switchDarkMode();
    });

    initBoardAuth(function() {
        if (current_rendered_page == 0 || current_rendered_page == 1) myRenderFunction();
    });
    preprocessed();
    myRenderFunction();
}

function myRenderFunction() {
    // what to do in this function
    // 1. delete all rendered elements
    // 2. add all new elements according to PAGE_YOURE_LOOKING_AT
    if (current_rendered_page != 1) cleanupGames();
    if (current_rendered_page != 4) cleanupWeightTracker();
    document.getElementById("screen").replaceChildren();
    setActiveNavButton();

    if (current_rendered_page == 0) renderBoard();
    if (current_rendered_page == 1) renderGames();
    if (current_rendered_page == 2) renderPixelBoard();
    if (current_rendered_page == 3) renderTimer();
    if (current_rendered_page == 4) renderWeightTracker();
}

export {current_rendered_page, rankImageSet};
