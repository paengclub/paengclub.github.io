import {itineraries, members} from "/data.js";

document.body.onload = renderTimer;

const agentSet = ['훈련소 입소', '보수등급 2', '보수등급 3', '보수등급 4', '소집 해제'];
const activeSet = ['일병 진급', '상병 진급', '병장 진급', '만기 전역'];
const rankSet = ['PV2.jpg', 'PFC.jpg', 'CPL.jpg', 'SGT.jpg', 'GEN.svg'];

function preprocessed() {
    for (let i = 0; i < members.length; i++) {
        if (members[i].ANF == '공익') {
            for (let j = 0; j < 5; j++)
                itineraries.push({name:members[i].name, type:agentSet[j], date:members[i].dates[j]});
        }
        else {
            itineraries.push({name:members[i].name, type:members[i].ANF + ' 입대', date:members[i].dates[0]});
            for (let j = 0; j < 4; j++)
                itineraries.push({name:members[i].name, type:activeSet[j], date:members[i].dates[j + 1]});
        }

        const curTime = new Date().getTime();
        
        for (let j = 0; j < 5; j++) {
            if (curTime > new Date(members[i].dates[j]).getTime()) members[i].rank = rankSet[j];
        }
        if (members[i].ANF == '공군') members[i].rank = 'AF_' + members[i].rank;
    }

    // sort itineraries
    for (let i = 0; i < itineraries.length; i++) {
        for (let j = 0; j < itineraries.length - i - 1; j++) {
            if (new Date(itineraries[j].date).getTime() < new Date(itineraries[j + 1].date).getTime()) continue;
            const temp = itineraries[j];
            itineraries[j] = itineraries[j + 1];
            itineraries[j + 1] = temp;
        }
    }
}

function timeFormatter(number) {
    const eventType = itineraries[number].type;

    if (eventType == '외박') return itineraries[number].date + "T08:00:00";
    else if (eventType == '외출') return itineraries[number].date + "T08:00:00";
    else if (eventType == '휴가') return itineraries[number].date + "T08:00:00";
    else if (eventType == '전역') return itineraries[number].date + "T08:00:00";
    else if (eventType == '복귀') return itineraries[number].date + "T21:00:00";
    else if (eventType == '입대') return itineraries[number].date + "T14:00:00";
    return itineraries[number].date + "T00:00:00";
}

const DAY_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'];

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
    for (let i = 0; i < members.length; i++) addElement(i, parseInt(i / 2));
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
function addElement(number, rowNumber) {
    // col div 추가
    const colElement = document.createElement("div");
    colElement.setAttribute("class", "col-sm-6 mt-2");
    document.getElementById("row" + rowNumber).insertBefore(colElement, null);
    // card div 추가
    const cardElement = document.createElement("div");
    let cardElementAttributeContent = 'card';
    if (members[number].ANF == '해병') cardElementAttributeContent += ' text-white bg-danger';
    if (members[number].ANF == '공익') cardElementAttributeContent += ' text-white bg-dark';
    cardElement.setAttribute("class", cardElementAttributeContent);
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header p-1");
    cardElement.insertBefore(cardHeaderElement, null);

    // img div 추가
    const imageElement = document.createElement("img");
    if (members[number].isDischarged == 'true') imageElement.setAttribute("src", 'images/reserved.jpg');
    else if (members[number].ANF == '공익' && members[number].rank != 'PV2.jpg' && members[number].rank != 'GEN.svg') imageElement.setAttribute("src", 'images/social.svg');
    else imageElement.setAttribute("src", 'images/' + members[number].rank);
    if (members[number].rank != 'LTG.svg' && members[number].rank != 'GEN.svg' && members[number].rank != 'AF_GEN.svg') imageElement.setAttribute("class", "img-thumbnail mr-1 p-0");
    else imageElement.setAttribute("class", "img-thumbnail mr-1");
    imageElement.setAttribute("style", "height:21px;");
    cardHeaderElement.insertBefore(imageElement, null);
    
    // left span 추가
    const leftSpanElement = document.createElement("span");
    leftSpanElement.innerHTML = members[number].name;
    let leftSpanElementContent = 'font-weight-bold';
    if (members[number].ANF == '해병') leftSpanElementContent += " text-warning bg-danger rounded border border-warning";
    if (members[number].ANF == '공익') leftSpanElementContent += " text-white bg-dark";
    if (members[number].ANF == '공군') leftSpanElementContent += " text-primary";
    leftSpanElement.setAttribute("class", leftSpanElementContent);
    cardHeaderElement.insertBefore(leftSpanElement, null);

    // right button 추가
    const rightSpanElement = document.createElement("button");
    let contentcontent = "btn font-weight-bold float-right btn-no-outline p-0";
    if (members[number].ANF == '공익') contentcontent += ' text-white';
    if (members[number].ANF == '해병') contentcontent += ' text-warning';
    rightSpanElement.setAttribute("class", contentcontent);
    rightSpanElement.setAttribute('type', 'button');
    rightSpanElement.setAttribute('data-toggle', 'collapse');
    rightSpanElement.setAttribute('data-target', '#collapsedData' + number);
    let dayLeftTillDischarge = Math.floor((new Date(members[number].dates[4] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
    if (dayLeftTillDischarge > 0) rightSpanElement.innerHTML = "D-" + dayLeftTillDischarge;
    else if (dayLeftTillDischarge == 0) rightSpanElement.innerHTML = "D-DAY";
    else rightSpanElement.innerHTML = "전역 " + (-dayLeftTillDischarge) + "일 차";
    cardHeaderElement.insertBefore(rightSpanElement, null);
    
    // 말출 button 추가
    if (members[number].dates[4] != members[number].dates[5]) {
        let preDisDDay = '';
        let dayLeftTillPreDis = Math.floor((new Date(members[number].dates[5] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
        if (dayLeftTillPreDis > 0) preDisDDay = "D-" + dayLeftTillPreDis;
        else if (dayLeftTillPreDis == 0) preDisDDay = "D-DAY";
        else preDisDDay = "말출 " + (-dayLeftTillPreDis) + "일 차";

        const predisButton = document.createElement("button");
        predisButton.innerHTML = preDisDDay;
        predisButton.setAttribute("class", "btn btn-sm btn-dark text-weight-bold float-right px-1 py-0 mr-2");
        predisButton.setAttribute("type", "button");
        predisButton.setAttribute("data-toggle", "collapse");
        predisButton.setAttribute("data-target", ".prediselement");
        cardHeaderElement.insertBefore(predisButton, null);
    }

    {/*
    <div class="card-body">
        <div class="progress">
            <div class="progress-bar" style="width: 25%;" id="progressDisplayer0">25%</div>
        </div>
        <div class="collapse multi-collapse" id="collapsedData0">
            <ul class="list-group list-flush">
                <li class="list-group-item">2023년 06월 17일(토) 08시: 외박(480일 22시간 46분 10초)</li>
                <li class="list-group-item">2023년 06월 18일(일) 21시: 복귀(480일 22시간 46분 10초)</li>
                <li class="list-group-item">2024년 09월 19일(목) 08시: 전역(480일 22시간 46분 10초)</li>
            </ul>
        </div>
        <button class="btn btn-sm btn-primary btn-block mt-2" type="button" data-toggle="collapse" data-target="#collapsedData0">펼쳐보기</button>
    </div>
    */}

    // card body div 추가
    const cardBodyElement = document.createElement("div");
    cardBodyElement.setAttribute("class", "card-body p-1");
    cardElement.insertBefore(cardBodyElement, null);

    // progress div 추가
    const progressElement = document.createElement("div");
    if (members[number].dates[4] == members[number].dates[5]) progressElement.setAttribute("class", "progress");
    else progressElement.setAttribute("class", "progress prediselement collapse show");
    cardBodyElement.insertBefore(progressElement, null);

    // progress bar div 추가
    const progressBarElement = document.createElement("div");
    progressBarElement.setAttribute("class", "progress-bar"); // font-weight-bold
    progressBarElement.setAttribute("style", "width: 0%;");
    progressBarElement.setAttribute("id", "progressDisplayer" + number);
    progressBarElement.innerHTML = "50%";
    progressElement.insertBefore(progressBarElement, null);
    
    const preProgressElement = document.createElement("div");
    const preProgressBarElement = document.createElement("div");
    if (members[number].dates[4] != members[number].dates[5]) {
        // progress div 추가
        // const preProgressElement = document.createElement("div");
        preProgressElement.setAttribute("class", "progress collapse prediselement");
        cardBodyElement.insertBefore(preProgressElement, null);
        
        // progress bar div 추가
        // const preProgressBarElement = document.createElement("div");
        preProgressBarElement.setAttribute("class", "progress-bar bg-info"); // font-weight-bold
        preProgressBarElement.setAttribute("style", "width: 0%;");
        preProgressBarElement.setAttribute("id", "preProgressDisplayer" + number);
        preProgressBarElement.innerHTML = "50%";
        preProgressElement.insertBefore(preProgressBarElement, null);

    }
    
    /*
    <div class="collapse multi-collapse" id="collapsedData0">
            <ul class="list-group list-flush">
                <li class="list-group-item">2023년 06월 17일(토) 08시: 외박(480일 22시간 46분 10초)</li>
                <li class="list-group-item">2023년 06월 18일(일) 21시: 복귀(480일 22시간 46분 10초)</li>
                <li class="list-group-item">2024년 09월 19일(목) 08시: 전역(480일 22시간 46분 10초)</li>
            </ul>
        </div>
    */

    // collapse div 추가
    const collapseDivElement = document.createElement("div");
    collapseDivElement.setAttribute("class", "collapse multi-collapse mt-1");
    collapseDivElement.setAttribute("id", "collapsedData" + number);
    cardBodyElement.insertBefore(collapseDivElement, null);

    // second card body element 추가
    const secCardBodyElement = document.createElement("ul");
    secCardBodyElement.setAttribute("class", "list-group list-flush");
    collapseDivElement.insertBefore(secCardBodyElement, null);

    // <li class="list-group-item">2024년 09월 19일(목) 08시: 전역(480일 22시간 46분 10초)</li>
    for (let i = 0; i < itineraries.length; i++) {
        if (itineraries[i].name != members[number].name) continue;
        const tempString = itineraries[i].type[3] + itineraries[i].type[4];
        if (tempString != '입대' && tempString != '진급' && tempString != '전역' && itineraries[i].type[0] != '보' && itineraries[i].type[4] != '입') {
            if (new Date(itineraries[i].date).getTime() < new Date().getTime()) continue;
        }
        const scheduleElement = document.createElement("li");
        if (itineraries[i].type == '한국 귀국') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
        else if (itineraries[i].type == '유격 훈련') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
        else if (members[number].ANF == '해병') scheduleElement.setAttribute("class", "bg-danger border-warning list-group-item text-warning");
        else if (members[number].ANF == '공익') scheduleElement.setAttribute("class", "bg-dark border-white list-group-item");
        else scheduleElement.setAttribute("class", "list-group-item");
        
        const x = setInterval(function() {
            let target = new Date(timeFormatter(i));
            let distance = target.getTime() - new Date().getTime();
            
            scheduleElement.innerText = target.getFullYear().toString() + "년 "
                + ((target.getMonth() + 1 < 10) ? "0" : "") + (target.getMonth() + 1).toString() + "월 "
                + ((target.getDate() < 10) ? "0" : "") + target.getDate().toString() + "일"
                + "(" + DAY_OF_WEEK[target.getDay()] +") : "
                + itineraries[i].type + "\n("
                + ((Math.floor(distance / (1000 * 60 * 60 * 24)) < 100) ? "0" : "") + ((Math.floor(distance / (1000 * 60 * 60 * 24)) < 10) ? "0" : "" ) + Math.floor(distance / (1000 * 60 * 60 * 24)) + "일 "
                + ((Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "시간 "
                + ((Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) + "분 "
                + ((Math.floor((distance % (1000 * 60)) / 1000) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60)) / 1000) + "초)";
            if (distance < 0) {
                scheduleElement.innerText = target.getFullYear().toString() + "년 "
                + ((target.getMonth() + 1 < 10) ? "0" : "") + (target.getMonth() + 1).toString() + "월 "
                + ((target.getDate() < 10) ? "0" : "") + target.getDate().toString() + "일"
                + "(" + DAY_OF_WEEK[target.getDay()] +") : "
                + itineraries[i].type;
                clearInterval(x);
            }
        }, 10);

        secCardBodyElement.insertBefore(scheduleElement, null);
    }

    const dateObject = new Date(members[number].dates[4] + "T08:00:00");

    const progressIntervalNumber = setInterval(function() {
        
        let now = new Date().getTime();        
        let distance = dateObject.getTime() - now;

        let currentProgress = 100 * (now - new Date(members[number].dates[0] + "T00:00:00").getTime()) / (new Date(members[number].dates[4] + "T00:00:00").getTime() - new Date(members[number].dates[0] + "T00:00:00").getTime());
        
        if (currentProgress > 100) {
            progressBarElement.innerText = "전역을 축하합니다!";
            progressBarElement.setAttribute("style", "width:100%;");
            progressBarElement.setAttribute("class", "progress-bar bg-success");
        }
        else {
            progressBarElement.innerText = Math.floor(currentProgress * 1000000) / 1000000 + "%";
            progressBarElement.setAttribute("style", "width:"+Math.max(Math.round(currentProgress), 0)+"%;");
        }

        if (distance < 0)
        {
            clearInterval(progressIntervalNumber);
            document.getElementById("timeDisplayer" + number).innerHTML = members[number].type + "까지 0일 0시간 0분 0초";
        }
    }, 10);
    
    const preDateObject = new Date(members[number].dates[5] + "T08:00:00");

    const preProgressIntervalNumber = setInterval(function() {
        
        let now = new Date().getTime();        
        let distance = preDateObject.getTime() - now;

        let currentProgress = 100 * (now - new Date(members[number].dates[0] + "T00:00:00").getTime()) / (new Date(members[number].dates[5] + "T00:00:00").getTime() - new Date(members[number].dates[0] + "T00:00:00").getTime());
        
        if (currentProgress > 100) {
            preProgressBarElement.innerText = "말출을 축하합니다!";
            preProgressBarElement.setAttribute("style", "width:100%;");
            preProgressBarElement.setAttribute("class", "progress-bar bg-success");
        }
        else {
            preProgressBarElement.innerText = Math.floor(currentProgress * 1000000) / 1000000 + "%";
            preProgressBarElement.setAttribute("style", "width:"+Math.max(Math.round(currentProgress), 0)+"%;");
        }

        if (distance < 0)
        {
            clearInterval(preProgressIntervalNumber);
            document.getElementById("timeDisplayer" + number).innerHTML = members[number].type + "까지 0일 0시간 0분 0초";
        }
    }, 10);
}


/*
<div class = "container my-3 mt-3" id="wrapper">
    <div class="alert alert-warning alert-dismissable fade show">
        내용
        <button type="button" class="close" data-dismiss="alert">
            <span aria-hidden="true">&times;</span>
        </button>
    </div>
</div>
*/
function renderTimer() {

    // 데이터 전처리 과정
    preprocessed();

    // wrapper 추가
    const wrapperElement = document.createElement("div");
    wrapperElement.setAttribute("class", "container");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    
    // alarmDiv 추가
    const alarmDivElement = document.createElement("div");
    alarmDivElement.setAttribute("class", "alert alert-warning alert-dismissable fade show m-0 p-3");
    const alertContent = document.createTextNode("남은 디데이를 클릭해 보세요!");
    alarmDivElement.appendChild(alertContent);
    wrapperElement.insertBefore(alarmDivElement, null);
    
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

    // <button class="btn btn-primary" type="btn" data-toggle="collapse" data-target=".multi-collapse">모두 펼쳐보기</button>

    addElements();

    const collapseButtonElement = document.createElement("button");
    collapseButtonElement.setAttribute("class", "btn btn-primary btn-block mt-3");
    collapseButtonElement.setAttribute("type", "button");
    collapseButtonElement.setAttribute("data-toggle", "collapse");
    collapseButtonElement.setAttribute("data-target", ".multi-collapse");
    collapseButtonElement.innerText = "모두 펼쳐보기";
    wrapperElement.insertBefore(collapseButtonElement, null);

}
