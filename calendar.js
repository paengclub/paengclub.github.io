
let leave_data = [
    {
        name:'이성민',
        list: [
            {start:[0, 1], end:[0, 5]}
        ]
    },
    {
        name:'심우재',
        list: [
            {start:[0, 1], end:[1, 5]}
        ]
    },
    {
        name:'팽지원',
        list: [
            {start:[0, 6], end:[1, 2]},
            {start:[3, 1], end:[3, 5]},
            {start:[5, 0], end:[6, 5]},
        ]
    },
    {
        name:'이승우',
        list: [
            {start:[1, 6], end:[2, 3]}
        ]
    },
    {
        name:'예지민',
        list: [
            {start:[1, 6], end:[2, 5]},
            {start:[3, 1], end:[3, 5]},
            {start:[4, 1], end:[4, 5]}
        ]
    }
];

function get_date(n) {
    const days_in_month = [30, 31, 31];
    let month = 6, day = 23;
    day += n;
    for (let i = 0; i < 3; i++) {
        if (day - days_in_month[i] <= 0) continue;
        day -= days_in_month[i];
        month += 1;
    }
    return month + "/" + day;
}

function create_week(upperElement, x) {
    // 날짜 표시 칸 생성
    const dateRow = document.createElement("div");
    dateRow.setAttribute("class", "row mt-3");
    upperElement.insertBefore(dateRow, null);
    for (let i = 0; i < 7; i++) {
        const dateCol = document.createElement("div");
        if (i == 0 || i == 6) dateCol.setAttribute('class', 'm-0 p-0 border col-1');
        else dateCol.setAttribute('class', 'm-0 p-0 border col-2');
        dateCol.innerText = get_date(7*x+i);
        dateRow.insertBefore(dateCol, null);
    }
    // count leavers for the week
    let leavers = [];
    for (let i = 0; i < leave_data.length; i++) {
        for (let j = 0; j < leave_data[i].list.length; j++) {
            // 7x ~ 7x+6
            let st = leave_data[i].list[j].start[0] * 7 + leave_data[i].list[j].start[1];
            let en = leave_data[i].list[j].end[0] * 7 + leave_data[i].list[j].end[1];

            if (7*x+6 < st || en < 7*x) continue;
            leavers.push([i, j]); // [누군지, 몇번째 일정인지]
        }
    }

    // 그 수만큼의 행을 생성
    for (let i = 0; i < leavers.length; i++) {
        const new_row = document.createElement("div");
        new_row.setAttribute("class", "row");
        upperElement.insertBefore(new_row, null);
        // (출발이전) (본일정) (도착이후)
        let before = (leave_data[leavers[i][0]].list[leavers[i][1]].start[0]*7 + leave_data[leavers[i][0]].list[leavers[i][1]].start[1]) - (7*x);
        let after = (7*x + 6) - (leave_data[leavers[i][0]].list[leavers[i][1]].end[0]*7 + leave_data[leavers[i][0]].list[leavers[i][1]].end[1]);

        before = Math.max(0, Math.min(6, before));
        after = Math.max(0, Math.min(6, after));
        let mainp = 7 - before - after;

        if (before > 0 && after > 0) {
            // before has SUN, after has SAT
            before = 2 * (before - 1) + 1;
            after = 2 * (after - 1) + 1;
            mainp = 2 * mainp;
        }
        else if (before > 0) {
            // before has SUN, mainp has SAT
            before = 2 * (before - 1) + 1;
            after = 2 * after;
            mainp = 2 * (mainp - 1) + 1;
        } 
        else if (after > 0) {
            // mainp has SUN, after has SAT
            before = 2 * before;
            after = 2 * (after - 1) + 1;
            mainp = 2 * (mainp - 1) + 1;
        }
        else {
            // mainp has both SUN and SAT
            before = 2 * before;
            after = 2 * after;
            mainp = 2 * (mainp - 2) + 2;
        }

        const before_col = document.createElement("div");
        before_col.setAttribute("class", "m-0 p-0 col-" + before);
        new_row.insertBefore(before_col, null);

        let color_type = "primary";
        if (leavers[i][0] % 3 == 1) color_type = "success";

        let leftAngular = false, rightAngular = false;
        if (before == 0 && 7*leave_data[leavers[i][0]].list[leavers[i][1]].start[0] + leave_data[leavers[i][0]].list[leavers[i][1]].start[1] != 7 * x) leftAngular = true;
        if (after == 0 && 7*leave_data[leavers[i][0]].list[leavers[i][1]].end[0] + leave_data[leavers[i][0]].list[leavers[i][1]].end[1] != 7 * x) rightAngular = true;

        let roundedSetting = "rounded-pill";
        if (leftAngular && rightAngular) roundedSetting = "";
        else if (leftAngular) roundedSetting = "rounded-end-pill";
        else if (rightAngular) roundedSetting = "rounded-start-pill";

        const main_col = document.createElement("div");
        main_col.setAttribute("class", "bg-" + color_type + " " + roundedSetting + " m-0 p-0 border col-" + mainp);
        main_col.innerText = (mainp > 1) ? (leave_data[leavers[i][0]].name) : ("⠀");
        new_row.insertBefore(main_col, null);

        const after_col = document.createElement("div");
        after_col.setAttribute("class", "m-0 p-0 col-" + after);
        new_row.insertBefore(after_col, null);
    }
}

/*
<div class="container" id="wrapper">

</div>
*/
function renderCalendar() {
    // wrapper 추가
    const wrapperElement = document.createElement("div");
    wrapperElement.setAttribute("class", "container text-center");
    wrapperElement.setAttribute("id", "wrapper");
    document.getElementById("screen").insertBefore(wrapperElement, null);
    
    for (let week = 0; week < 7; week++) create_week(wrapperElement, week);
}

export {renderCalendar};