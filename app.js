const ITINERARY = [
    {name:'예지민', type:'외박', date:'2023-06-09'},
    {name:'예지민', type:'복귀', date:'2023-06-11'},
    {name:'예지민', type:'외박', date:'2023-06-16'},
    {name:'팽지원', type:'외박', date:'2023-06-17'},
    {name:'예지민', type:'복귀', date:'2023-06-18'},
    {name:'팽지원', type:'복귀', date:'2023-06-18'},
    {name:'예지민', type:'외박', date:'2023-06-23'},
    {name:'예지민', type:'복귀', date:'2023-06-25'},
    {name:'예지민', type:'출국', date:'2023-07-26'},
    {name:'심우재', type:'유격', date:'2023-07-31'}
];

const DATA = [
    {name:'허채민', enlisted:'2022-10-03', discharged:'2024-04-02'},
    {name:'예지민', enlisted:'2023-01-30', discharged:'2024-07-29'},
    {name:'팽지원', enlisted:'2023-03-20', discharged:'2024-09-19'},
    {name:'심우재', enlisted:'2023-04-03', discharged:'2024-10-02'},
    {name:'이승우', enlisted:'2023-04-10', discharged:'2025-01-23'},
    {name:'이성민', enlisted:'2023-07-10', discharged:'2025-04-09'}
];

document.body.onload = renderTimer;
/*
function getRandomInt() {
    return Math.floor(Math.random() * 8) + 1;
}

function processFOOLSEVENT(number) {
    // id = foolsevent#인 div를 찾아서 class를 랜덤하게 바꿈
    let event_color = getRandomInt();

    let classContent = '';

    if (event_color == 1) classContent = 'card text-white bg-primary';
    else if (event_color == 2) classContent = 'card text-white bg-secondary';
    else if (event_color == 3) classContent = 'card text-white bg-success';
    else if (event_color == 4) classContent = 'card text-white bg-danger';
    else if (event_color == 5) classContent = 'card text-white bg-warning';
    else if (event_color == 6) classContent = 'card text-white bg-info';
    else if (event_color == 7) classContent = 'card bg-light';
    else if (event_color == 8) classContent = 'card text-white bg-dark';
    else classContent = 'card';

    document.getElementById('foolsevent' + number).setAttribute('class', classContent);
}
*/

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

function my_format_converter(number) {
    return DATA[number].discharged + "T08:00:00";
    let time = '';
    if (DATA[number].type == '외박' && DATA[number].name == '예지민') time = 'T17:00:00';
    else if (DATA[number].type == '외출') time = 'T08:00:00';
    else if (DATA[number].type == '외박') time = 'T08:00:00';
    else if (DATA[number].type == '휴가') time = 'T08:00:00';
    else if (DATA[number].type == '복귀') time = 'T21:00:00';
    else if (DATA[number].type == '입대') time = 'T14:00:00';
    else if (DATA[number].type == '전역') time = 'T08:00:00';
    else time = 'T00:00:00';

    return DATA[number].date + time;
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
    for (let i = 0; i < DATA.length; i++) {
        addElement(i, parseInt(i / 2));
    }
}


/*
<div class="card text-white bg-dark">
    <div class="card-header">팽지원</div>
    <div class="card-body">
        <h5 class="card-title" id="timeDisplayer0">전역까지 490일 15시간 15분 15초</h5>
        <p class="card-text">2024년 9월 19일</p>
    </div>
</div>
*/

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
            <div class="card card-body">
                <div class="card-text">2023년 06월 17일: 외박(480일 22시간 46분 10초)</div>
                <div class="card-text">2023년 06월 18일: 복귀(480일 22시간 46분 10초)</div>
                <div class="card-text">2024년 09월 19일: 전역(480일 22시간 46분 10초)</div>
            </div>
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
    cardElement.setAttribute("class", "card");
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header");
    cardElement.insertBefore(cardHeaderElement, null);
    
    // left span 추가
    const leftSpanElement = document.createElement("span");
    leftSpanElement.innerHTML = DATA[number].name;
    cardHeaderElement.insertBefore(leftSpanElement, null);

    // right span 추가
    const rightSpanElement = document.createElement("span");
    rightSpanElement.setAttribute("class", "float-right");
    rightSpanElement.innerHTML = "D-" + (Math.floor((new Date(DATA[number].discharged + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1);
    cardHeaderElement.insertBefore(rightSpanElement, null);

    {/*
    <div class="card-body">
        <div class="progress mb-3">
            <div class="progress-bar" style="width: 25%;" id="progressDisplayer0">25%</div>
        </div>
        <div class="collapse multi-collapse" id="collapsedData0">
            <div class="card card-body">
                <div class="card-text">2023년 06월 17일: 외박(480일 22시간 46분 10초)</div>
                <div class="card-text">2023년 06월 18일: 복귀(480일 22시간 46분 10초)</div>
                <div class="card-text">2024년 09월 19일: 전역(480일 22시간 46분 10초)</div>
            </div>
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

    /*<div class="collapse multi-collapse" id="collapsedData0">
            <div class="card card-body">
                <div class="card-text">2023년 06월 17일: 외박(480일 22시간 46분 10초)</div>
                <div class="card-text">2023년 06월 18일: 복귀(480일 22시간 46분 10초)</div>
                <div class="card-text">2024년 09월 19일: 전역(480일 22시간 46분 10초)</div>
            </div>
        </div>
    */

    // collapse div 추가
    const collapseDivElement = document.createElement("div");
    collapseDivElement.setAttribute("class", "collapse multi-collapse");
    collapseDivElement.setAttribute("id", "collapsedData" + number);
    cardBodyElement.insertBefore(collapseDivElement, null);

    // second card body element 추가
    const secCardBodyElement = document.createElement("div");
    secCardBodyElement.setAttribute("class", "card card-body");
    collapseDivElement.insertBefore(secCardBodyElement, null);

    // <div class="card-text">2024년 09월 19일: 전역(480일 22시간 46분 10초)</div>
    for (let i = 0; i < ITINERARY.length; i++) {
        if (ITINERARY[i].name != DATA[number].name) continue;
        const scheduleElement = document.createElement("div");
        if (ITINERARY[i].type == '출국') scheduleElement.setAttribute("class", "card-text font-weight-bold");
        else if (ITINERARY[i].type == '유격') scheduleElement.setAttribute("class", "card-text font-weight-bold");
        else scheduleElement.setAttribute("class", "card-text");
        
        const x = setInterval(function() {
            let target = new Date(ITINERARY[i].date + "T00:00:00");
            let distance = target.getTime() - new Date().getTime();
            
            scheduleElement.innerText = target.getFullYear().toString() + "년 " + (target.getMonth() + 1).toString() + "월 " + target.getDate().toString() + "일: "
                + ITINERARY[i].type + "("
                + Math.floor(distance / (1000 * 60 * 60 * 24)) + "일 "
                + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "시간 "
                + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) + "분 "
                + Math.floor((distance % (1000 * 60)) / 1000) + "초)";
            if (distance < 0) clearInterval(x);
        }, 10);

        secCardBodyElement.insertBefore(scheduleElement, null);
    }



    const dischargedScheduleElement = document.createElement("div");
    dischargedScheduleElement.setAttribute("class", "card-text");
    
    const y = setInterval(function() {
        let target = new Date(DATA[number].discharged + "T00:00:00");
        let distance = target.getTime() - new Date().getTime();
        
        dischargedScheduleElement.innerText = target.getFullYear().toString() + "년 " + (target.getMonth() + 1).toString() + "월 " + target.getDate().toString() + "일: "
            + "전역("
            + Math.floor(distance / (1000 * 60 * 60 * 24)) + "일 "
            + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "시간 "
            + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) + "분 "
            + Math.floor((distance % (1000 * 60)) / 1000) + "초)";
        if (distance < 0) clearInterval(x);
    }, 10);

    secCardBodyElement.insertBefore(dischargedScheduleElement, null);


    
    // button 추가 <button class="btn btn-sm btn-primary btn-block mt-2" type="button" data-toggle="collapse" data-target="#collapsedData0">펼쳐보기</button>
    const buttonElement = document.createElement("button");
    buttonElement.setAttribute("class", "btn btn-sm btn-primary btn-block mt-2");
    buttonElement.setAttribute("type", "button");
    buttonElement.setAttribute("data-toggle", "collapse");
    buttonElement.setAttribute("data-target", "#collapsedData" + number);
    buttonElement.innerText = "펼쳐보기";
    cardBodyElement.insertBefore(buttonElement, null);

    // h5 카운터 div 추가
    // const counterElement = document.createElement("h5");
    // const newContent = document.createTextNode("test text");
    // counterElement.appendChild(newContent);
    // counterElement.setAttribute("class", "card-title");
    // counterElement.setAttribute("id", "timeDisplayer" + number);
    // cardBodyElement.insertBefore(counterElement, null);

    const dateObject = new Date(DATA[number].discharged + "T08:00:00");
    // p 내용 div 추가
    // const dateElement = document.createElement("p");
    // dateElement.setAttribute("class", "card-text");
    // dateElement.innerHTML = dateObject.getFullYear().toString() + "년 " + (dateObject.getMonth() + 1).toString() + "월 " + dateObject.getDate().toString() + "일 (" + int_to_date(dateObject.getDay()) + ") " + dateObject.getHours().toString() + "시";
    // cardBodyElement.insertBefore(dateElement, null);

    const x = setInterval(function() {
        
        let now = new Date().getTime();        
        let distance = dateObject.getTime() - now;
        
        // document.getElementById("timeDisplayer" + number).innerHTML = "전역까지"
        //     + Math.floor(distance / (1000 * 60 * 60 * 24)) + "일 "
        //     + Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "시간 "
        //     + Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)) + "분 "
        //     + Math.floor((distance % (1000 * 60)) / 1000) + "초";

        let currentProgress = 100 * (now - new Date(DATA[number].enlisted + "T00:00:00").getTime()) / (new Date(DATA[number].discharged + "T00:00:00").getTime() - new Date(DATA[number].enlisted + "T00:00:00").getTime());
        if (currentProgress > 12) progressBarElement.innerText = Math.floor(currentProgress * 1000000) / 1000000 + "%";
        else progressBarElement.innerText = "";
        progressBarElement.setAttribute("style", "width:"+Math.max(Math.floor(currentProgress), 0)+"%;");

        if (distance < 0)
        {
            clearInterval(x);
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
    
    addElements();
}
