import {members} from '../data.js';
import Usercardbody from './Usercardbody.js';

function Usercard(props) {
    const name = props.username;
    let user_id;
    for (let i = 0; i < members.length; i++) {
        if (name != members[i].name) continue;
        user_id = i;
        break;
    }

    let preDisbutton;
    if (members[user_id].dates[4] != members[user_id].dates[5]) {

        let preDisDDay = '';
        let dayLeftTillPreDis = Math.floor((new Date(members[user_id].dates[5] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
        
        if (dayLeftTillPreDis > 0) preDisDDay = "D-" + dayLeftTillPreDis;
        else if (dayLeftTillPreDis == 0) preDisDDay = "D-DAY";
        else preDisDDay = "말출 " + (-dayLeftTillPreDis) + "일 차";

        preDisbutton = <button className="btn btn-sm btn-dark fw-bold float-end px-1 py-0 me-2" type="button">{preDisDDay}</button>
    }

    let DisDDay;
    let dayLeftTillDischarge = Math.floor((new Date(members[user_id].dates[4] + "T00:00:00").getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24) + 1;
    if (dayLeftTillDischarge > 0) DisDDay = "D-" + dayLeftTillDischarge;
    else if (dayLeftTillDischarge == 0) DisDDay = "D-DAY";
    else DisDDay = "전역 " + (-dayLeftTillDischarge) + "일 차";

    return (
        <div className="card shadow">
            <div className="card-header px-2">
                {/* <img src = {Img_SGT} className="img-thumbnail me-1 p-0 float-start" style={{height:"21px"}}></img> */}
                <span className="fw-bold float-start">{name}</span>
                <button className="btn fw-bold float-end p-0" type="button">{DisDDay}</button>
                {preDisbutton}
            </div>
            <Usercardbody username={name}></Usercardbody>
        </div>
    );
}

export default Usercard;