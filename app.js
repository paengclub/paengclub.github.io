import {itineraries, members} from "/data.js";
import {renderTimer} from "/timer.js";
import {renderList} from "/itinlist.js";

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

function createAlarm(upperElement, alarmContent) {
    // alarmDiv 추가
    const alarmDivElement = document.createElement("div");
    alarmDivElement.setAttribute("class", "alert alert-warning alert-dismissable fade show m-0 p-3");
    alarmDivElement.appendChild(document.createTextNode(alarmContent));
    upperElement.insertBefore(alarmDivElement, null);
    
    // button 추가
    const buttonElement = document.createElement("button");
    buttonElement.setAttribute("type", "button");
    buttonElement.setAttribute("class", "close");
    buttonElement.setAttribute("data-dismiss", "alert");
    alarmDivElement.insertBefore(buttonElement, null);
    
    // span 추가
    const spanElement = document.createElement("span");
    spanElement.innerHTML = "&times;";
    buttonElement.insertBefore(spanElement, null);
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
    preprocessed();
    myRenderFunction();
}

function myRenderFunction() {
    // what to do in this function
    // 1. delete all rendered elements
    // 2. add all new elements according to PAGE_YOURE_LOOKING_AT
    document.getElementById("screen").replaceChildren();

    if (current_rendered_page == 0) renderTimer();
    if (current_rendered_page == 1) renderList(false);
    if (current_rendered_page == 2) renderList(true);
}

export {current_rendered_page, rankImageSet};