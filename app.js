import {ITINERARY, DATA} from "/data.js";

document.body.onload = renderTimer;

function preprocessed() {
    for (let i = 0; i < DATA.length; i++) {
        ITINERARY.push({name:DATA[i].name, type:DATA[i].ANF + ' 입대', date:DATA[i].enlisted});
        ITINERARY.push({name:DATA[i].name, type:'만기 전역', date:DATA[i].discharged});
        ITINERARY.push({name:DATA[i].name, type:'일병 진급', date:DATA[i].PFC});
        ITINERARY.push({name:DATA[i].name, type:'상병 진급', date:DATA[i].CPL});
        ITINERARY.push({name:DATA[i].name, type:'병장 진급', date:DATA[i].SGT});

        const curTime = new Date().getTime();
        
        if (curTime > new Date(DATA[i].enlisted).getTime()) DATA[i].rank = 'PV2.jpg';
        if (curTime > new Date(DATA[i].PFC).getTime()) DATA[i].rank = 'PFC.jpg';
        if (curTime > new Date(DATA[i].CPL).getTime()) DATA[i].rank = 'CPL.jpg';
        if (curTime > new Date(DATA[i].SGT).getTime()) DATA[i].rank = 'SGT.jpg';
        if (curTime > new Date(DATA[i].discharged).getTime()) DATA[i].rank = 'GEN.svg';
        if (DATA[i].ANF == '공군') DATA[i].rank = 'AF_' + DATA[i].rank;
    }

    // sort ITINERARY
    for (let i = 0; i < ITINERARY.length; i++) {
        for (let j = 0; j < ITINERARY.length - i - 1; j++) {
            if (new Date(ITINERARY[j].date).getTime() < new Date(ITINERARY[j + 1].date).getTime()) continue;
            const temp = ITINERARY[j];
            ITINERARY[j] = ITINERARY[j + 1];
            ITINERARY[j + 1] = temp;
        }
    }
}

function timeFormatter(number) {
    const eventType = ITINERARY[number].type;

    if (eventType == '외박') return ITINERARY[number].date + "T08:00:00";
    else if (eventType == '외출') return ITINERARY[number].date + "T08:00:00";
    else if (eventType == '휴가') return ITINERARY[number].date + "T08:00:00";
    else if (eventType == '전역') return ITINERARY[number].date + "T08:00:00";
    else if (eventType == '복귀') return ITINERARY[number].date + "T21:00:00";
    else if (eventType == '입대') return ITINERARY[number].date + "T14:00:00";
    return ITINERARY[number].date + "T00:00:00";
}

function int_to_date(number) {
    if (number == 0) return '일';
    else if (number == 1) return '월';
    else if (number == 2) return '화';
    else if (number == 3) return '수';
    else if (number == 4) return '목';
    else if (number == 5) return '금';
    else if (number == 6) return '토';
    return 'error';
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
    for (let i = 0; i < parseInt((DATA.length + 1) / 2); i++) {
        const newDiv = document.createElement("div");
        newDiv.setAttribute("class", "row");
        newDiv.setAttribute("id", "row" + i);
        document.getElementById("wrapper").insertBefore(newDiv, null);
    }
    for (let i = 0; i < DATA.length; i++) addElement(i, parseInt(i / 2));
}

/*
<div class="card">
    <div class="card-header">
        <span>팽지원</span>
        <span class="float-right">D-480</span>
    </div>
    <div class="card-body">
        <div class="progress mb-3">
            <div class="progress-bar" style="width: 25%;">25%</div>
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
</div>
*/
function addElement(number, rowNumber) {
    // col div 추가
    const colElement = document.createElement("div");
    colElement.setAttribute("class", "col-sm-6 mt-2");
    document.getElementById("row" + rowNumber).insertBefore(colElement, null);
    // card div 추가
    const cardElement = document.createElement("div");
    if (DATA[number].ANF == '해병') cardElement.setAttribute("class", "card bg-danger text-white");
    else if (DATA[number].ANF == '공익') cardElement.setAttribute("class", "card bg-dark text-white");
    else cardElement.setAttribute("class", "card");
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header px-2");
    cardElement.insertBefore(cardHeaderElement, null);

    // img div 추가
    const imageElement = document.createElement("img");
    imageElement.setAttribute("src", 'images/' + DATA[number].rank);
    if (DATA[number].rank != 'LTG.svg' && DATA[number].rank != 'GEN.svg' && DATA[number].rank != 'AF_GEN.svg') imageElement.setAttribute("class", "img-thumbnail mr-1 p-0");
    else imageElement.setAttribute("class", "img-thumbnail mr-1");
    imageElement.setAttribute("style", "height:21px;");
    cardHeaderElement.insertBefore(imageElement, null);
    
    // left span 추가
    const leftSpanElement = document.createElement("span");
    leftSpanElement.innerHTML = DATA[number].name;
    if (DATA[number].ANF == '해병') leftSpanElement.setAttribute("class", "font-weight-bold text-warning bg-danger rounded border border-warning");
    else if (DATA[number].ANF == '공익') leftSpanElement.setAttribute("class", "font-weight-bold text-white bg-dark rounded border border-white");
    else if (DATA[number].ANF == '공군') leftSpanElement.setAttribute("class", "font-weight-bold text-primary");
    else leftSpanElement.setAttribute("class", "font-weight-bold");
    cardHeaderElement.insertBefore(leftSpanElement, null);

    // right span 추가
    const rightSpanElement = document.createElement("span");
    rightSpanElement.setAttribute("class", "font-weight-bold float-right");
    let dayLeftTillDischarge = Math.floor((new Date(DATA[number].discharged + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
    if (dayLeftTillDischarge > 0) rightSpanElement.innerHTML = "D-" + dayLeftTillDischarge;
    else if (dayLeftTillDischarge == 0) rightSpanElement.innerHTML = "D-DAY";
    else rightSpanElement.innerHTML = "전역 " + (-dayLeftTillDischarge) + "일 차";
    cardHeaderElement.insertBefore(rightSpanElement, null);

    {/*
    <div class="card-body">
        <div class="progress mb-3">
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
    cardBodyElement.setAttribute("class", "card-body");
    cardElement.insertBefore(cardBodyElement, null);

    // progress div 추가
    const progressElement = document.createElement("div");
    progressElement.setAttribute("class", "progress mb-3");
    cardBodyElement.insertBefore(progressElement, null);

    // progress bar div 추가
    const progressBarElement = document.createElement("div");
    progressBarElement.setAttribute("class", "progress-bar"); // font-weight-bold
    progressBarElement.setAttribute("style", "width: 0%;");
    progressBarElement.setAttribute("id", "progressDisplayer" + number);
    progressBarElement.innerHTML = "50%";
    progressElement.insertBefore(progressBarElement, null);

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
    collapseDivElement.setAttribute("class", "collapse multi-collapse");
    collapseDivElement.setAttribute("id", "collapsedData" + number);
    cardBodyElement.insertBefore(collapseDivElement, null);

    // second card body element 추가
    const secCardBodyElement = document.createElement("ul");
    secCardBodyElement.setAttribute("class", "list-group list-flush");
    collapseDivElement.insertBefore(secCardBodyElement, null);

    // <li class="list-group-item">2024년 09월 19일(목) 08시: 전역(480일 22시간 46분 10초)</li>
    for (let i = 0; i < ITINERARY.length; i++) {
        if (ITINERARY[i].name != DATA[number].name) continue;
        const tempString = ITINERARY[i].type[3] + ITINERARY[i].type[4];
        if (tempString != '입대' && tempString != '진급' && tempString != '전역') {
            if (new Date(ITINERARY[i].date).getTime() < new Date().getTime()) continue;
        }
        const scheduleElement = document.createElement("li");
        if (ITINERARY[i].type == '한국 출국') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
        else if (ITINERARY[i].type == '유격 훈련') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
        else if (DATA[number].ANF == '해병') scheduleElement.setAttribute("class", "bg-danger border-white list-group-item");
        else if (DATA[number].ANF == '공익') scheduleElement.setAttribute("class", "bg-dark border-white list-group-item");
        else scheduleElement.setAttribute("class", "list-group-item");
        
        const x = setInterval(function() {
            let target = new Date(timeFormatter(i));
            let distance = target.getTime() - new Date().getTime();
            
            scheduleElement.innerText = target.getFullYear().toString() + "년 "
                + ((target.getMonth() + 1 < 10) ? "0" : "") + (target.getMonth() + 1).toString() + "월 "
                + ((target.getDate() < 10) ? "0" : "") + target.getDate().toString() + "일"
                + "(" + int_to_date(target.getDay()) +") "
                + ((target.getHours() < 10) ? "0" : "") + target.getHours() + "시: "
                + ITINERARY[i].type + "("
                + ((Math.floor(distance / (1000 * 60 * 60 * 24)) < 100) ? "0" : "") + ((Math.floor(distance / (1000 * 60 * 60 * 24)) < 10) ? "0" : "" ) + Math.floor(distance / (1000 * 60 * 60 * 24)) + "일 "
                + ((Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "시간 "
                + ((Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) + "분 "
                + ((Math.floor((distance % (1000 * 60)) / 1000) < 10) ? "0" : "") + Math.floor((distance % (1000 * 60)) / 1000) + "초)";
            if (distance < 0) {
                scheduleElement.innerText = target.getFullYear().toString() + "년 "
                + ((target.getMonth() + 1 < 10) ? "0" : "") + (target.getMonth() + 1).toString() + "월 "
                + ((target.getDate() < 10) ? "0" : "") + target.getDate().toString() + "일"
                + "(" + int_to_date(target.getDay()) +") "
                + ((target.getHours() < 10) ? "0" : "") + target.getHours() + "시: "
                + ITINERARY[i].type;
                clearInterval(x);
            }
        }, 10);

        secCardBodyElement.insertBefore(scheduleElement, null);
    }

    // button 추가 <button class="btn btn-sm btn-primary btn-block mt-2" type="button" data-toggle="collapse" data-target="#collapsedData0">펼쳐보기</button>
    const buttonElement = document.createElement("button");
    if (DATA[number].ANF == '해병') buttonElement.setAttribute("class", "btn btn-sm btn-danger border-white text-white btn-block mt-2");
    else if (DATA[number].ANF == '공익') buttonElement.setAttribute("class", "btn btn-sm btn-dark border-white text-white btn-block mt-2");
    else buttonElement.setAttribute("class", "btn btn-sm btn-primary btn-block mt-2");
    buttonElement.setAttribute("type", "button");
    buttonElement.setAttribute("data-toggle", "collapse");
    buttonElement.setAttribute("data-target", "#collapsedData" + number);
    buttonElement.innerText = "펼쳐보기";
    cardBodyElement.insertBefore(buttonElement, null);

    const dateObject = new Date(DATA[number].discharged + "T08:00:00");

    const progressIntervalNumber = setInterval(function() {
        
        let now = new Date().getTime();        
        let distance = dateObject.getTime() - now;

        let currentProgress = 100 * (now - new Date(DATA[number].enlisted + "T00:00:00").getTime()) / (new Date(DATA[number].discharged + "T00:00:00").getTime() - new Date(DATA[number].enlisted + "T00:00:00").getTime());
        
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
            document.getElementById("timeDisplayer" + number).innerHTML = DATA[number].type + "까지 0일 0시간 0분 0초";
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
    wrapperElement.setAttribute("class", "container my-3 mt-3");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    
    /*
    // alarmDiv 추가
    const alarmDivElement = document.createElement("div");
    alarmDivElement.setAttribute("class", "alert alert-warning alert-dismissable fade show");
    const alertContent = document.createTextNode("외출, 외박, 휴가, 전역 : 08시 | 입대 : 14시 | 복귀 : 21시");
    // const alertContent = document.createTextNode("모바일 경험을 우선하여 업데이트했습니다");
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
    */

    // <button class="btn btn-primary" type="btn" data-toggle="collapse" data-target=".multi-collapse">모두 펼쳐보기</button>

    const collapseButtonElement = document.createElement("button");
    collapseButtonElement.setAttribute("class", "btn btn-primary btn-block");
    collapseButtonElement.setAttribute("type", "button");
    collapseButtonElement.setAttribute("data-toggle", "collapse");
    collapseButtonElement.setAttribute("data-target", ".multi-collapse");
    collapseButtonElement.innerText = "모두 펼쳐보기";
    wrapperElement.insertBefore(collapseButtonElement, null);
    
    
    addElements();
}
