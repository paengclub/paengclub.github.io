import React from 'react';
import Usercard from './Usercard.js';
import { members } from '../data.js';

function Userview() {
    const Users = [];
    for (let i = 0; i < Math.floor((members.length + 1) / 2); i++) {
        Users.push(
            <div className="row">
                <div className="col-sm-6 mt-3">
                    <Usercard key={members[2 * i].name} username={members[2 * i].name}></Usercard>
                </div>
                <div className="col-sm-6 mt-3">
                    <Usercard key={members[2 * i + 1].name} username={members[2 * i + 1].name}></Usercard>
                </div>
            </div>
        );
    }
    return (
        <div className="container">
            {Users}
        </div>
    );
}

export default Userview;