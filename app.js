const DATA = [
    {name:'예지민', type:'휴가', date:'2023-05-25'},
    {name:'예지민', type:'복귀', date:'2023-05-27'},
    {name:'예지민', type:'외박', date:'2023-06-09'},
    {name:'예지민', type:'복귀', date:'2023-06-11'},
    {name:'예지민', type:'외박', date:'2023-06-16'},
    {name:'팽지원', type:'외박', date:'2023-06-17'},
    {name:'예지민', type:'복귀', date:'2023-06-18'},
    {name:'팽지원', type:'복귀', date:'2023-06-18'},
    {name:'예지민', type:'외박', date:'2023-06-23'},
    {name:'예지민', type:'복귀', date:'2023-06-25'},
    {name:'이성민', type:'입대', date:'2023-07-10'},
    {name:'허채민', type:'전역', date:'2024-04-02'},
    {name:'예지민', type:'전역', date:'2024-07-29'},
    {name:'팽지원', type:'전역', date:'2024-09-19'},
    {name:'심우재', type:'전역', date:'2024-10-02'},
    {name:'이승우', type:'전역', date:'2025-01-23'},
    {name:'이성민', type:'전역', date:'2025-04-09'}
];

document.body.onload = renderTimer;

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

function addElement(number, rowNumber) {
    // col div 추가
    const colElement = document.createElement("div");
    colElement.setAttribute("class", "col-sm-6 mt-2");
    document.getElementById("row" + rowNumber).insertBefore(colElement, null);
    // card div 추가
    const cardElement = document.createElement("div");
    if (DATA[number].type == '휴가' || DATA[number].type == '외출' || DATA[number].type == '외박') cardElement.setAttribute("class", "card text-white bg-info");
    if (DATA[number].type == '전역') cardElement.setAttribute("class", "card text-white bg-dark");
    if (DATA[number].type == '복귀' || DATA[number].type == '입대') cardElement.setAttribute("class", "card text-white bg-danger");
    cardElement.setAttribute("id", "foolsevent" + number);
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header");
    cardHeaderElement.innerHTML = DATA[number].name;
    cardElement.insertBefore(cardHeaderElement, null);
    
    // card body div 추가
    const cardBodyElement = document.createElement("div");
    cardBodyElement.setAttribute("class", "card-body");
    cardElement.insertBefore(cardBodyElement, null);

    const dateObject = new Date(my_format_converter(number));

    // h5 카운터 div 추가
    const counterElement = document.createElement("h5");
    const newContent = document.createTextNode("test text");
    counterElement.appendChild(newContent);
    counterElement.setAttribute("class", "card-title");
    counterElement.setAttribute("id", "timeDisplayer" + number);
    cardBodyElement.insertBefore(counterElement, null);

    // p 내용 div 추가
    const dateElement = document.createElement("p");
    dateElement.setAttribute("class", "card-text");
    dateElement.innerHTML = dateObject.getFullYear().toString() + "년 " + (dateObject.getMonth() + 1).toString() + "월 " + dateObject.getDate().toString() + "일 (" + int_to_date(dateObject.getDay()) + ") " + dateObject.getHours().toString() + "시";
    cardBodyElement.insertBefore(dateElement, null);

    const x = setInterval(function() {
        
        let now = new Date().getTime();
        
        let distance = dateObject.getTime() - now;
        
        let days = Math.floor(distance / (1000 * 60 * 60 * 24));
        let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        let seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        let timerContent = days + "일 " + hours + "시간 " + minutes + "분 " + seconds + "초";
        timerContent = DATA[number].type + "까지 " + timerContent;
        document.getElementById("timeDisplayer" + number).innerHTML = timerContent;
        if (getRandomInt() == 1) processFOOLSEVENT(number);
        
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
    
    // alarmDiv 추가
    const alarmDivElement = document.createElement("div");
    alarmDivElement.setAttribute("class", "alert alert-warning alert-dismissable fade show");
    const alertContent = document.createTextNode("출타 및 전역 : 08시 | 입대 : 14시 | 복귀 : 21시");
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
    
    addElements();
}
