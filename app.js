const NUMBER_OF_MEMBERS = 8;

const ARRAY_PREFIX = ["입대까지", "입대까지", "입대까지", "전역까지", "전역까지", "전역까지", "전역까지", "전역까지"]
const ARRAY_NAMES = ["팽지원", "심우재", "이승우", "허채민", "예지민", "팽지원", "심우재", "이승우"];
const ARRAY_DATES = ["Mar 20, 2023 14:00:00", "Apr 3, 2023 14:00:00", "Apr 24, 2023 14:00:00", "Apr 3, 2024 00:00:00", "Jul 30, 2024 00:00:00", "Sep 20, 2024 00:00:00", "Oct 3, 2024 00:00:00", "Jan 24, 2025 00:00:00"];

document.body.onload = renderTimer;

/* <div class = "container" id = "wrapper">
    <div class = "row" id = "row2">
        <div class = "col-sm-6 mt-2"><div class = "card"></div></div>
        <div class = "col-sm-6 mt-2"><div class = "card"></div></div>
    </div>
</div> */
function addElements() {
    for (let i = 0; i < parseInt((NUMBER_OF_MEMBERS + 1) / 2); i++) {
        const newDiv = document.createElement("div");
        newDiv.setAttribute("class", "row");
        newDiv.setAttribute("id", "row" + i);
        document.getElementById("wrapper").insertBefore(newDiv, null);
    }
    for (let i = 0; i < NUMBER_OF_MEMBERS; i++) {
        addElement(i, parseInt(i / 2));
    }
}

/* <div class="card">
    <div class="card-header">팽지원</div>
    <div class="card-body">
        <h5 class="card-title">입대까지 1일 ~~~</h5>
        <p class="card-text">2023년 3월 20일 14:00:00</p>
    </div>
</div> */
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
    cardHeaderElement.innerHTML = ARRAY_NAMES[number];
    cardElement.insertBefore(cardHeaderElement, null);
    
    // card body div 추가
    const cardBodyElement = document.createElement("div");
    cardBodyElement.setAttribute("class", "card-body");
    cardElement.insertBefore(cardBodyElement, null);

    const dateObject = new Date(ARRAY_DATES[number]);

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
    dateElement.innerHTML = dateObject.getFullYear().toString() + "년 " + (dateObject.getMonth() + 1).toString() + "월 " + dateObject.getDate().toString() + "일";
    cardBodyElement.insertBefore(dateElement, null);

    const x = setInterval(function() {
        
        let now = new Date().getTime();
        
        let distance = dateObject.getTime() - now;
        
        let days = Math.floor(distance / (1000 * 60 * 60 * 24));
        let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        let seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        let timerContent = days + "일 " + hours + "시간 " + minutes + "분 " + seconds + "초";
        timerContent = ARRAY_PREFIX[number] + " " + timerContent;
        document.getElementById("timeDisplayer" + number).innerHTML = timerContent;
        
        if (distance < 0)
        {
            clearInterval(x);
            document.getElementById("timeDisplayer" + number).innerHTML = ARRAY_NAMES[number] + " : Rest In Peace.. ㅠㅠ (" + ARRAY_PREFIX[number][0] + ARRAY_PREFIX[number][1] + ")";
        }
    }, 10);
}

/* <div class = "wrapper" id="wrapper">
    <h3>나도 추가됐으면 좋겠다 -> 연락주세요~</h3>
    <div id="bottomdiv"></div>
</div> */
function renderTimer() {

    // wrapper 추가
    const wrapperElement = document.createElement("div");
    wrapperElement.setAttribute("class", "container my-3 mt-3");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    
    // botdiv 추가
    const botDivElement = document.createElement("div");
    botDivElement.setAttribute("id", "bottomdiv");
    document.getElementById("wrapper").insertBefore(botDivElement, null);

    addElements();
}