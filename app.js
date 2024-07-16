import {itineraries, members} from "/data.js";
import {renderTimer} from "/timer.js";
import {renderList} from "/itinlist.js";
import {renderCalendar} from "/calendar.js";

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

const darkModeSwitcherClassContent = "btn position-absolute bottom-0 end-0 btn-sm p-3 m-2 border-white rounded-5 ";
function switchDarkMode() {
    let current_status = document.documentElement.getAttribute("data-bs-theme");
    if (current_status == 'light') {
        document.documentElement.setAttribute("data-bs-theme", "dark");
        document.getElementById("colorSwitcher").setAttribute("class", darkModeSwitcherClassContent + "btn-light");
    }
    else {
        document.documentElement.setAttribute("data-bs-theme", "light");
        document.getElementById("colorSwitcher").setAttribute("class", darkModeSwitcherClassContent + "btn-dark");
    }
    myRenderFunction();
}

function onButtonClick(buttonContent) {
    current_rendered_page = Number(buttonContent);
    myRenderFunction();
}

function init() {
    // initializes the page
    const buttonList = document.querySelectorAll('.nav-buttons');
    for (let i = 0; i < buttonList.length; i++) {
        buttonList[i].addEventListener("click", function(event) {
            onButtonClick(event.target.id);
        });
    }

    document.getElementById('colorSwitcher').setAttribute("class", darkModeSwitcherClassContent + "btn-light");
    document.getElementById('colorSwitcher').addEventListener("click", function() {
        switchDarkMode();
    });

    preprocessed();
    myRenderFunction();
}

function myRenderFunction() {
    // what to do in this function
    // 1. delete all rendered elements
    // 2. add all new elements according to PAGE_YOURE_LOOKING_AT
    document.getElementById("screen").replaceChildren();

    if (current_rendered_page == 0) renderTimer();
    if (current_rendered_page == 1) renderCalendar();
    if (current_rendered_page == 2) renderList(false);
    if (current_rendered_page == 3) renderList(true);
}

export {current_rendered_page, rankImageSet};