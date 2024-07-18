import {members} from '../data.js';

import Img_SSG from '../images/SSG.svg';
import Img_GEN from '../images/GEN.svg';
import Img_RES from '../images/reserved.jpg';

import Img_PV2 from '../images/PV2.jpg';
import Img_PFC from '../images/PFC.jpg';
import Img_CPL from '../images/CPL.jpg';
import Img_SGT from '../images/SGT.jpg';

import Img_PV2_AF from '../images/AF_PV2.jpg';
import Img_PFC_AF from '../images/AF_PFC.jpg';
import Img_CPL_AF from '../images/AF_CPL.jpg';
import Img_SGT_AF from '../images/AF_SGT.jpg';

let name, rankImage, dates, ANF, isDischarged, isNCO;

function getImage(ANF, rank) {
    if (rank == 1) return (ANF == "공군") ? Img_PV2_AF : Img_PV2;
    if (rank == 2) return (ANF == "공군") ? Img_PFC_AF : Img_PFC;
    if (rank == 3) return (ANF == "공군") ? Img_CPL_AF : Img_CPL;
    if (rank == 4) return (ANF == "공군") ? Img_SGT_AF : Img_SGT;
    if (rank == 5) return Img_SSG;
    if (rank == 9) return Img_GEN;
    return Img_RES;
}

function getStyle(ANF, isNCO, rank) {
    const PROGRESS_AF = ["0%", "9%", "38%", "67%"];
    const PROGRESS_ARMY = ["0%", "12%", "45%", "78%"];
    const PROGRESS_ARMY_NCO = ["0%", "8%", "33%", "58%", "75%"];

    const return_style = {width: "1.5rem", height: "1.5rem"};

    if (rank == 9) {
        return_style.left = "100%";
        return return_style;
    }
    
    if (isNCO == "true") {
        return_style.left = PROGRESS_ARMY_NCO[rank - 1];
        if (rank == 5) {
            return_style.width = "2rem";
            return_style.height = "2rem";
        }
        return return_style;
    }

    if (ANF == "공군" || ANF == "공익") {
        return_style.left = PROGRESS_AF[rank - 1];
        return return_style;
    }

    return_style.left = PROGRESS_ARMY[rank - 1];
    return return_style;
}

function Usercardbody(props) {
    name = props.username;
    let user_id;
    for (let i = 0; i < members.length; i++) {
        if (members[i].name != name) continue;
        rankImage += members[i].rank;
        dates = members[i].dates;
        ANF = members[i].ANF;
        isDischarged = members[i].isDischarged;
        isNCO = members[i].isNCO;
        user_id = i;
        break;
    }

    let rankImages = [];

    rankImages.push(<img src={getImage(ANF, 1)} style={getStyle(ANF, isNCO, 1)} className="position-absolute translate-middle border border-dark rounded top-50"></img>);
    rankImages.push(<img src={getImage(ANF, 2)} style={getStyle(ANF, isNCO, 2)} className="position-absolute translate-middle border border-dark rounded top-50"></img>);
    rankImages.push(<img src={getImage(ANF, 3)} style={getStyle(ANF, isNCO, 3)} className="position-absolute translate-middle border border-dark rounded top-50"></img>);
    rankImages.push(<img src={getImage(ANF, 4)} style={getStyle(ANF, isNCO, 4)} className="position-absolute translate-middle border border-dark rounded top-50"></img>);
    if (isNCO == "true") rankImages.push(<img src={getImage(ANF, 5)} style={getStyle(ANF, isNCO, 5)} className="position-absolute translate-middle border border-dark rounded top-50 p-1 bg-white"></img>);
    rankImages.push(<img src={getImage(ANF, 10)} style={getStyle(ANF, isNCO, 10)} className="position-absolute translate-middle border border-dark rounded top-50 start-100 bg-white p-1"></img>);

    let enlistDateObject = new Date(members[user_id].dates[0] + "T00:00:00");
    let dischargeDateObject = new Date(members[user_id].dates[4] + "T00:00:00");
    let dischargeProgress = 100 * (new Date().getTime() - enlistDateObject.getTime()) / (dischargeDateObject.getTime() - enlistDateObject.getTime());
    dischargeProgress = (Math.round(dischargeProgress * 1000000)) / 1000000;
    dischargeProgress = Math.max(Math.min(dischargeProgress, 100), 0);
    let roundedProgressCutOff = Math.max(10, Math.min(85, Math.round(dischargeProgress))) + "%";
    let roundedProgress = Math.round(dischargeProgress) + "%";

    return (
        <div className="card-body">
            <span className="position-absolute translate-middle bg-body-tertiary rounded border px-1" style={{left: roundedProgressCutOff}} id={"disProDisplayer" + user_id}>{dischargeProgress + "%"}</span>
            <div className="position-relative m-4">
                <div className="progress" role="progressbar" style={{height:"10px"}}>
                    <div className="progress-bar" style={{width: roundedProgress}}></div>
                </div>
                {rankImages}
            </div>
        </div>
    );
}

export default Usercardbody;