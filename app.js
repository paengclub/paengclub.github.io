const IMAGE = [
    "https://i.namu.wiki/i/lySgaeuzlAoq0Df9Zo6gjL9JliKIZmzjTdRQ82lEJ3YNvxYRQ3JxonOBU9bFX7WN94c6CD6XGIZz5JmMV6Hxruis_cczpeA1vus6epiNK5-LIAxWVod9aua9pjMMzbPnMpzF4m-DO3KrL1n5UvpCOg.svg",
    "https://i.namu.wiki/i/TLjmInHfMThH-C-4PrJsPP3ZMDwY2ctGI_kckmIYyG0k_s3_MObyUDOuH0eRQPXqmmr6F1tnenU0Lv_hPpzSSG_t7KRch5mS8Jht7YkUx_SD6WxZCC7F9OV1p2xx_-1QrYBSxVsGYjvtfGpVa9cgTQ.svg",
    "https://i.namu.wiki/i/sF9N1YBOcOwuvhvTSck01-uimkjxXqjCt_gjzGvwnAhsxuGR4Wtb6mmaUjXDJ2gKGCKnbFTnxUrmLpgaJPZGUAE3w-FOh6uj8LoEaWksyIIh7gZm1WSaO405GHJnDHlx_0B9WpZkA5Z-nx9KlVQyfg.svg",
    "https://i.namu.wiki/i/W7KQ-tGP257Wxw0nE1UP6RfsHiHh771fNM17fMRxNjz-PWaYyOHVUFOGV0WGyrgC7TKf6RF0mWAgqSX0qEnNsTvl4QTvlsHWXZGWDpZCN4c_SO-9Qy13tjOKQSpOZYvnEL710qvnw3eVcPhoYn1sLg.svg",
    "https://i.namu.wiki/i/ArqAQ8H05H-6V7Ln34sDS8SOTOl4fGR92P7ZRFklCGw07lI8xZotS7GsfYXgLXXvJRqA-UJnD_j3no8hz_7hl_lFyQHXZINVHRcYT_BCr_Ykcw9heGlXNLJop1BHAaiajaEjf4z6Qrkjv3MnAY2_gQ.svg",
    "https://i.namu.wiki/i/EdAs8JB4iNa664ldlqbgNewdC9jPCfRvqa3qbukCc-TnX-bVLec2ORIM2Ut2MXemnI23Sx6zeYyUHX-t4LWDYNZWRFWuWKTAieVn6i_yJ6jt7FDuwI8w9cJjikO6nRkDXIxrPyPSzXKykV4QDlclSg.svg"
];

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
    {name:'허채민', rank:3, enlisted:'2022-10-03', discharged:'2024-04-02'},
    {name:'예지민', rank:3, enlisted:'2023-01-30', discharged:'2024-07-29'},
    {name:'팽지원', rank:3, enlisted:'2023-03-20', discharged:'2024-09-19'},
    {name:'심우재', rank:2, enlisted:'2023-04-03', discharged:'2024-10-02'},
    {name:'이승우', rank:2, enlisted:'2023-04-10', discharged:'2025-01-23'},
    {name:'이성민', rank:1, enlisted:'2023-07-10', discharged:'2025-04-09'}
];

function preprocessed() {
    for (let i = 0; i < DATA.length; i++) {
        if (new Date(DATA[i].enlisted).getTime() > new Date().getTime())
            ITINERARY.push({name:DATA[i].name, type:'입대', date:DATA[i].enlisted});
    }
    for (let i = 0; i < DATA.length; i++) {
        ITINERARY.push({name:DATA[i].name, type:'전역', date:DATA[i].discharged});
    }
}

document.body.onload = renderTimer;

function timeFormatter(number) {
    eventType = ITINERARY[number].type;

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
    cardElement.setAttribute("class", "card");
    colElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header px-2");
    cardElement.insertBefore(cardHeaderElement, null);

    // img div 추가
    const imageElement = document.createElement("img");
    imageElement.setAttribute("src", IMAGE[DATA[number].rank]);
    imageElement.setAttribute("class", "img-thumbnail mr-1");
    imageElement.setAttribute("style", "height:21px;");
    cardHeaderElement.insertBefore(imageElement, null);
    
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
        const scheduleElement = document.createElement("li");
        if (ITINERARY[i].type == '출국') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
        else if (ITINERARY[i].type == '유격') scheduleElement.setAttribute("class", "list-group-item font-weight-bold");
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
            if (distance < 0) clearInterval(x);
        }, 10);

        secCardBodyElement.insertBefore(scheduleElement, null);
    }

    // button 추가 <button class="btn btn-sm btn-primary btn-block mt-2" type="button" data-toggle="collapse" data-target="#collapsedData0">펼쳐보기</button>
    const buttonElement = document.createElement("button");
    buttonElement.setAttribute("class", "btn btn-sm btn-primary btn-block mt-2");
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
        if (currentProgress > 12) progressBarElement.innerText = Math.floor(currentProgress * 1000000) / 1000000 + "%";
        else progressBarElement.innerText = "";
        progressBarElement.setAttribute("style", "width:"+Math.max(Math.floor(currentProgress), 0)+"%;");

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
