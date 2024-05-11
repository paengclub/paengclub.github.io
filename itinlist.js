import {members, itineraries} from "/data.js";

const rankImageSet = ['PV2.jpg', 'PFC.jpg', 'CPL.jpg', 'SGT.jpg', 'SSG.svg'];

function imageFormatter(itin_id) {
    let next_rank = itineraries[itin_id].type.slice(0, 2);
    if (next_rank == '일병') return 1;
    if (next_rank == '상병') return 2;
    if (next_rank == '병장') return 3;
    if (next_rank == '하사') return 4;
}

function createCardBodyContent(upperElement, itin_id, user_id) {
    const eventDateObject = new Date(itineraries[itin_id].date + "T00:00:00");
    if (itineraries[itin_id].type.slice(3, 5) != '진급') {
        upperElement.innerText = eventDateObject.getFullYear().toString() + "년 "
        + ((eventDateObject.getMonth() + 1 < 10) ? "0" : "") + (eventDateObject.getMonth() + 1).toString() + "월 "
        + ((eventDateObject.getDate() < 10) ? "0" : "") + eventDateObject.getDate().toString() + "일"
        + " : " + itineraries[itin_id].type;
        return;
    }

    upperElement.innerHTML = eventDateObject.getFullYear().toString() + "년 "
    + ((eventDateObject.getMonth() + 1 < 10) ? "0" : "") + (eventDateObject.getMonth() + 1).toString() + "월 "
    + ((eventDateObject.getDate() < 10) ? "0" : "") + eventDateObject.getDate().toString() + "일"
    + " : ";

    // image 1
    const image_1 = document.createElement("img");
    image_1.setAttribute("src", "images/" + ((members[user_id].ANF == '공군')?("AF_"):("")) + rankImageSet[imageFormatter(itin_id) - 1]);
    image_1.setAttribute("style", "height:21px;");
    image_1.setAttribute("class", "rounded");
    upperElement.insertBefore(image_1, null);
    // image 2
    const image_2 = document.createElement("img");
    image_2.setAttribute("src", "images/right_arrow.png");
    image_2.setAttribute("style", "height:21px;");
    upperElement.insertBefore(image_2, null);
    // image 3
    const image_3 = document.createElement("img");
    image_3.setAttribute("src", "images/" + ((members[user_id].ANF == '공군')?("AF_"):("")) + rankImageSet[imageFormatter(itin_id)]);
    image_3.setAttribute("style", "height:21px;");
    image_3.setAttribute("class", "rounded");
    upperElement.insertBefore(image_3, null);
}

function createItem(upperElement, itin_id) {
    let user_id;
    for (let i = 0; i < members.length; i++) {
        if (members[i].name != itineraries[itin_id].name) continue;
        user_id = i;
        break;
    }
    // card div 추가
    const cardElement = document.createElement("div");
    let cardElementAttributeContent = 'card m-1';
    if (members[user_id].ANF == '해병') cardElementAttributeContent += ' text-white bg-danger';
    if (members[user_id].ANF == '공익') cardElementAttributeContent += ' text-white bg-dark';
    cardElement.setAttribute("class", cardElementAttributeContent);
    upperElement.insertBefore(cardElement, null);

    // card header div 추가
    const cardHeaderElement = document.createElement("div");
    cardHeaderElement.setAttribute("class", "card-header p-1");
    cardElement.insertBefore(cardHeaderElement, null);
    
    // left span 추가
    const leftSpanElement = document.createElement("span");
    leftSpanElement.innerHTML = members[user_id].name;
    let leftSpanElementContent = 'font-weight-bold';
    if (members[user_id].ANF == '해병') leftSpanElementContent += " text-warning bg-danger rounded border border-warning";
    if (members[user_id].ANF == '공군') leftSpanElementContent += " text-primary";
    leftSpanElement.setAttribute("class", leftSpanElementContent);
    cardHeaderElement.insertBefore(leftSpanElement, null);

    // right span 추가
    const rightSpanElement = document.createElement("span");
    let contentcontent = "font-weight-bold float-right";
    if (members[user_id].ANF == '공익') contentcontent += ' text-white';
    if (members[user_id].ANF == '해병') contentcontent += ' text-warning';
    rightSpanElement.setAttribute("class", contentcontent);
    rightSpanElement.setAttribute('type', 'button');
    rightSpanElement.setAttribute('data-toggle', 'collapse');
    rightSpanElement.setAttribute('data-target', '#collapsedData' + user_id);
    let dayLeftTillEvent = Math.floor((new Date(itineraries[itin_id].date + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
    if (dayLeftTillEvent > 0) rightSpanElement.innerHTML = "D-" + dayLeftTillEvent;
    else if (dayLeftTillEvent == 0) rightSpanElement.innerHTML = "D-DAY";
    else rightSpanElement.innerHTML =  rightSpanElement.innerHTML = "D+" + (-dayLeftTillEvent);
    cardHeaderElement.insertBefore(rightSpanElement, null);

    // card body div 추가
    const cardBodyElement = document.createElement("div");
    cardBodyElement.setAttribute("class", "card-body p-1");
    cardElement.insertBefore(cardBodyElement, null);

    createCardBodyContent(cardBodyElement, itin_id, user_id);
}

function renderList(render_past) {
    // wrapper 추가
    const wrapperElement = document.createElement("div");
    wrapperElement.setAttribute("class", "container");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    // create list-group
    const listGroupElement = document.createElement('ul');
    listGroupElement.setAttribute('class', 'list-group px-2');
    wrapperElement.insertBefore(listGroupElement, null);

    for (let itin_id = 0; itin_id < itineraries.length; itin_id++) {
        if (!render_past && new Date().getTime() > new Date(itineraries[itin_id].date).getTime()) continue;
        if (render_past && new Date().getTime() < new Date(itineraries[itin_id].date).getTime()) continue;
        createItem(listGroupElement, itin_id);
    }
}

export {renderList};