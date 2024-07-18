import React from 'react';
import {Link, Routes, Route} from 'react-router-dom';
import './App.css';
import Userview from './components/Userview.js';
import Itineraries from './components/Itineraries.js';
import Pastitineraries from './components/Pastitineraries.js';
import Calendar from './components/Calendar.js';
import {members} from './data.js';

function updater() {
    for (let i = 0; i < members.length; i++) {
        let enlistDateObject = new Date(members[i].dates[0] + "T00:00:00");
        let dischargeDateObject = new Date(members[i].dates[4] + "T00:00:00");
        let dischargeProgress = 100 * (new Date().getTime() - enlistDateObject.getTime()) / (dischargeDateObject.getTime() - enlistDateObject.getTime());
        dischargeProgress = (Math.round(dischargeProgress * 1000000)) / 1000000;
        dischargeProgress = Math.max(Math.min(dischargeProgress, 100), 0);
        document.getElementById("disProDisplayer"+i).innerText = dischargeProgress + "%";
    }

}

function App() {
    setInterval(updater, 10);

    return (
        <div className="App">
            <nav className="navbar navbar-expand-lg bg-body-tertiary">
                <div className="container-fluid">
                    <Link className="navbar-brand" to="/">𝓟𝓪𝓮𝓷𝓰𝓒𝓵𝓾𝓫</Link>
                    <button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarSupportedContent">
                        <span className="navbar-toggler-icon"></span>
                    </button>
                    
                    <div className="collapse navbar-collapse" id="navbarSupportedContent">
                        <ul className="navbar-nav me-auto mb-2 mb-lg-0">
                            <li className="nav-item disabled">
                                <Link className="nav-link" to="/users">사람별로 모아보기</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link disabled" to="/calendar">달력 보기</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link disabled" to="/itineraries">일정 모아보기</Link>
                            </li>
                            <li className="nav-item">
                                <Link className="nav-link disabled" to="/past-itineraries">지난 일정 모아보기</Link>
                            </li>
                        </ul>
                    </div>
                </div>
            </nav>

            <Routes>
                <Route exact path="/" element={<Userview />}></Route>
                <Route path="/users" element={<Userview />}></Route>
                <Route path="/calendar" element={<Calendar />}></Route>
                <Route path="/itineraries" element={<Itineraries />}></Route>
                <Route path="/past-itineraries" element={<Pastitineraries />}></Route>
            </Routes>
        </div>
    );
}

export default App;
