import {itineraries, members} from "/data.js";
import {current_rendered_page} from "/app.js";

const DAY_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function isDarkMode() {
    if (document.documentElement.getAttribute("data-bs-theme") == "dark") return true;
    return false;
}

function updater() {
    if (current_rendered_page != 0) return;
    for (let user_id = 0; user_id < members.length; user_id++) {
        let progressBarElement = document.getElementById("progressDisplayer" + user_id);
        let preProgressBarElement = document.getElementById("preProgressDisplayer" + user_id);

        let now = new Date().getTime();
        let enlistDateObject = new Date(members[user_id].dates[0] + "T00:00:00");

        // 1. Dischargement Progress
        let dischargeDateObject = new Date(members[user_id].dates[4] + "T00:00:00");
        let dischargeCurrentProgress = 100 * (now - enlistDateObject.getTime()) / (dischargeDateObject.getTime() - enlistDateObject.getTime());
        if (dischargeCurrentProgress > 100) {
            progressBarElement.innerText = "전역을 축하합니다!";
            progressBarElement.setAttribute("style", "width:100%;");
            if (isDarkMode()) progressBarElement.setAttribute("class", "progress-bar bg-success-subtle");
            else progressBarElement.setAttribute("class", "progress-bar bg-success");
        }
        else {
            progressBarElement.innerText = Math.floor(dischargeCurrentProgress * 1000000) / 1000000 + "%";
            progressBarElement.setAttribute("style", "width:"+Math.max(Math.ceil(dischargeCurrentProgress), 0)+"%;");
        }
        
        // 2. PreDischargement Progress
        if (members[user_id].dates[4] == members[user_id].dates[5]) continue;
        let preDateObject = new Date(members[user_id].dates[5] + "T08:00:00");
        let preCurrentProgress = 100 * (now - enlistDateObject.getTime()) / (preDateObject.getTime() - enlistDateObject.getTime());
        if (preCurrentProgress > 100) {
            preProgressBarElement.innerText = "말출을 축하합니다!";
            preProgressBarElement.setAttribute("style", "width:100%;");
            if (isDarkMode()) preProgressBarElement.setAttribute("class", "progress-bar bg-success-subtle");
            else preProgressBarElement.setAttribute("class", "progress-bar bg-success");
        }
        else {
            preProgressBarElement.innerText = Math.floor(preCurrentProgress * 1000000) / 1000000 + "%";
            preProgressBarElement.setAttribute("style", "width:"+Math.max(Math.round(preCurrentProgress), 0)+"%;");
        }       
    }
}


/*
<div class = "container my-3 mt-3" id = "wrapper">
    <div class = "row" id = "row2">
        <div class = "col-sm-6 mt-2"><div class = "card text-white bg-info"></div></div>
        <div class = "col-sm-6 mt-2"><div class = "card text-white bg-dark"></div></div>
    </div>
</div>
*/
function addElements() {
    for (let i = 0; i < parseInt((members.length + 1) / 2); i++) {
        const newDiv = document.createElement("div");
        newDiv.setAttribute("class", "row");
        newDiv.setAttribute("id", "row" + i);
        document.getElementById("wrapper").insertBefore(newDiv, null);
    }
    for (let i = 0; i < members.length; i++) createUser(i, parseInt(i / 2));

    setInterval(updater, 10);
}

function createCollapse(upperElement, user_id) {
    //<div class="collapse multi-collapse mt-1" id="collapsedData0"><ul class="list-group list-flush"><li class="list-group-item">2024년 09월 19일(목) : 전역 ( D-100 )</li></ul></div>

    // collapse div 추가
    const collapseDivElement = document.createElement("div");
    collapseDivElement.setAttribute("class", "collapse multi-collapse mt-1");
    collapseDivElement.setAttribute("id", "collapsedData" + user_id);
    upperElement.insertBefore(collapseDivElement, null);

    // second card body element 추가
    const secCardBodyElement = document.createElement("ul");
    secCardBodyElement.setAttribute("class", "list-group list-group-flush");
    collapseDivElement.insertBefore(secCardBodyElement, null);

    // <li class="list-group-item">2024년 09월 19일(목) 08시: 전역(480일 22시간 46분 10초)</li>
    for (let itin_id = 0; itin_id < itineraries.length; itin_id++) {
        if (itineraries[itin_id].name != members[user_id].name) continue;
        const tempString = itineraries[itin_id].type[3] + itineraries[itin_id].type[4];
        if (tempString != '입대' && tempString != '진급' && tempString != '전역' && itineraries[itin_id].type[0] != '보' && itineraries[itin_id].type[4] != '입') {
            if (new Date(itineraries[itin_id].date).getTime() < new Date().getTime()) continue;
        }
        const scheduleElement = document.createElement("li");
        let scheduleElementClass = "list-group-item";
        if (members[user_id].ANF == '해병') scheduleElementClass += " bg-danger border-warning text-warning";
        if (members[user_id].ANF == '공익') scheduleElementClass += " bg-dark border-white";
        scheduleElement.setAttribute("class", scheduleElementClass);
        

        let target = new Date(itineraries[itin_id].date + 'T00:00:00');
        let distance = target.getTime() - new Date().getTime();
        
        let innerTextString = target.getFullYear().toString() + "년 "
        + ((target.getMonth() + 1 < 10) ? "0" : "") + (target.getMonth() + 1).toString() + "월 "
        + ((target.getDate() < 10) ? "0" : "") + target.getDate().toString() + "일"
        + "(" + DAY_OF_WEEK[target.getDay()] +") : "
        + itineraries[itin_id].type;
        if (distance > 0) {
            distance += 1000 * 60 * 60 * 24;
            innerTextString += " ( D-"
            + Math.floor(distance / (1000 * 60 * 60 * 24))
            + " )";
        }
        scheduleElement.innerText = innerTextString;
        secCardBodyElement.insertBefore(scheduleElement, null);
    }
}

/*
<div class="card">
    <div class="card-header">
        <span>팽지원</span>
        <button type="button" data-toggle="collapse" data-target=".prediselement">말출</button>
        <button class="float-right">D-480</button>
    </div>
    <div class="card-body">
        <div class="progress mb-3">
            <div class="progress-bar" style="width: 25%;">25%</div>
        </div>
        <div class="progress mb-3">
            <div class="progress-bar" style="width: 25%;">25%</div>
        </div>
    </div>
</div>
*/
function createUser(user_id, rowNumber) {
    // col div 추가
    const colElement = document.createElement("div");
    colElement.setAttribute("class", "col-sm-6 mt-3");
    document.getElementById("row" + rowNumber).insertBefore(colElement, null);

    // card div 추가
    const cardElement = document.createElement("div");
    let cardElementAttributeContent = 'card shadow';
    if (members[user_id].ANF == '해병') cardElementAttributeContent += ' text-white bg-danger';
    if (members[user_id].ANF == '공익') cardElementAttributeContent += ' text-white bg-dark';
    cardElement.setAttribute("class", cardElementAttributeContent);
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header px-2");
    cardElement.insertBefore(cardHeaderElement, null);

    // img div 추가
    const imageElement = document.createElement("img");
    if (members[user_id].isDischarged == 'true') imageElement.setAttribute("src", 'images/reserved.jpg');
    else if (members[user_id].ANF == '공익' && members[user_id].rank != 'PV2.jpg' && members[user_id].rank != 'GEN.svg') imageElement.setAttribute("src", 'images/social.svg');
    else imageElement.setAttribute("src", 'images/' + members[user_id].rank);
    if (members[user_id].rank != 'LTG.svg' && members[user_id].rank != 'GEN.svg' && members[user_id].rank != 'AF_GEN.svg') imageElement.setAttribute("class", "img-thumbnail me-1 p-0");
    else imageElement.setAttribute("class", "img-thumbnail me-1");
    imageElement.setAttribute("style", "height:21px;");
    cardHeaderElement.insertBefore(imageElement, null);
    
    // left span 추가
    const leftSpanElement = document.createElement("span");
    leftSpanElement.innerHTML = members[user_id].name;
    let leftSpanElementContent = 'fw-bold';
    if (members[user_id].ANF == '해병') leftSpanElementContent += " text-warning bg-danger rounded border border-warning";
    if (members[user_id].ANF == '공군') leftSpanElementContent += " text-primary";
    leftSpanElement.setAttribute("class", leftSpanElementContent);
    cardHeaderElement.insertBefore(leftSpanElement, null);

    // right button 추가
    const rightSpanElement = document.createElement("button");
    let contentcontent = "btn fw-bold float-end p-0";
    if (members[user_id].ANF == '공익') contentcontent += ' text-white';
    if (members[user_id].ANF == '해병') contentcontent += ' text-warning';
    rightSpanElement.setAttribute("class", contentcontent);
    rightSpanElement.setAttribute('type', 'button');
    rightSpanElement.setAttribute('data-bs-toggle', 'collapse');
    rightSpanElement.setAttribute('data-bs-target', '#collapsedData' + user_id);
    let dayLeftTillDischarge = Math.floor((new Date(members[user_id].dates[4] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
    if (dayLeftTillDischarge > 0) rightSpanElement.innerHTML = "D-" + dayLeftTillDischarge;
    else if (dayLeftTillDischarge == 0) rightSpanElement.innerHTML = "D-DAY";
    else rightSpanElement.innerHTML = "전역 " + (-dayLeftTillDischarge) + "일 차";
    cardHeaderElement.insertBefore(rightSpanElement, null);
    
    // 말출 button 추가
    if (members[user_id].dates[4] != members[user_id].dates[5]) {
        let preDisDDay = '';
        let dayLeftTillPreDis = Math.floor((new Date(members[user_id].dates[5] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
        if (dayLeftTillPreDis > 0) preDisDDay = "D-" + dayLeftTillPreDis;
        else if (dayLeftTillPreDis == 0) preDisDDay = "D-DAY";
        else preDisDDay = "말출 " + (-dayLeftTillPreDis) + "일 차";

        const predisButton = document.createElement("button");
        predisButton.innerHTML = preDisDDay;
        predisButton.setAttribute("class", "btn btn-sm btn-dark fw-bold float-end px-1 py-0 me-2");
        predisButton.setAttribute("type", "button");
        predisButton.setAttribute("data-bs-toggle", "collapse");
        predisButton.setAttribute("data-bs-target", ".prediselement");
        cardHeaderElement.insertBefore(predisButton, null);
    }

    // card body div 추가
    const cardBodyElement = document.createElement("div");
    cardBodyElement.setAttribute("class", "card-body");
    cardElement.insertBefore(cardBodyElement, null);

    // progress div 추가
    const progressElement = document.createElement("div");
    if (members[user_id].dates[4] == members[user_id].dates[5]) progressElement.setAttribute("class", "progress");
    else progressElement.setAttribute("class", "progress prediselement collapse show");
    progressElement.setAttribute("style", "height:25px");
    cardBodyElement.insertBefore(progressElement, null);

    // progress bar div 추가
    const progressBarElement = document.createElement("div");
    if (isDarkMode()) progressBarElement.setAttribute("class", "progress-bar bg-primary-subtle");
    else progressBarElement.setAttribute("class", "progress-bar bg-primary");
    progressBarElement.setAttribute("style", "width: 0%;");
    progressBarElement.setAttribute("id", "progressDisplayer" + user_id);
    progressBarElement.innerHTML = "50%";
    progressElement.insertBefore(progressBarElement, null);
    
    if (members[user_id].dates[4] != members[user_id].dates[5]) {
        // progress div 추가
        const preProgressElement = document.createElement("div");
        preProgressElement.setAttribute("class", "progress collapse prediselement");
        preProgressElement.setAttribute("style", "height:25px");
        cardBodyElement.insertBefore(preProgressElement, null);
        
        // progress bar div 추가
        const preProgressBarElement = document.createElement("div");
        if (isDarkMode()) preProgressBarElement.setAttribute("class", "progress-bar bg-info-subtle");
        else preProgressBarElement.setAttribute("class", "progress-bar bg-info");
        preProgressBarElement.setAttribute("style", "width: 0%;");
        preProgressBarElement.setAttribute("id", "preProgressDisplayer" + user_id);
        preProgressBarElement.innerHTML = "50%";
        preProgressElement.insertBefore(preProgressBarElement, null);

    }
    
    createCollapse(cardBodyElement, user_id);
}

function createOpenAll(upperElement) {
    const buttonWrapper = document.createElement("div");
    buttonWrapper.setAttribute("class", "d-grid gap-2");
    upperElement.insertBefore(buttonWrapper, null);

    const collapseButtonElement = document.createElement("button");
    collapseButtonElement.setAttribute("class", "btn btn-primary mt-3");
    collapseButtonElement.setAttribute("type", "button");
    collapseButtonElement.setAttribute("data-bs-toggle", "collapse");
    collapseButtonElement.setAttribute("data-bs-target", ".multi-collapse");
    collapseButtonElement.innerText = "모두 펼쳐보기";
    buttonWrapper.insertBefore(collapseButtonElement, null);
}

function renderTimer() {
    // wrapper 추가
    const wrapperElement = document.createElement("div");
    wrapperElement.setAttribute("class", "container");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    
    addElements();

    createOpenAll(wrapperElement);
}

export {renderTimer};