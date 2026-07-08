import { supabase } from "/supabaseClient.js";
import { getCurrentPlayerName, getCurrentSession } from "/board.js";

const GAMES = {
    reaction: {
        title: "반응속도",
        unit: "점",
        description: "초록색이 되면 바로 누르기"
    },
    taprush: {
        title: "10초 탭",
        unit: "회",
        description: "10초 동안 최대한 많이 누르기"
    },
    memory: {
        title: "기억 순서",
        unit: "단계",
        description: "불이 들어온 순서를 따라 누르기"
    }
};

let activeGame = "reaction";
let reactionTimer = null;
let reactionStart = 0;
let tapTimer = null;
let tapDeadline = 0;
let tapCount = 0;
let memorySequence = [];
let memoryInput = [];
let memoryLocked = false;

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
    }
    return node;
}

function gameInfo() {
    return GAMES[activeGame];
}

function setStatus(message, type = "") {
    const status = document.getElementById("gameStatus");
    if (!status) return;
    status.className = `game-status ${type}`;
    status.textContent = message;
}

function playerNameForScore() {
    const session = getCurrentSession();
    if (session) return getCurrentPlayerName();
    const stored = localStorage.getItem("paengclub-player-name") || "";
    const nickname = window.prompt("리더보드에 올릴 닉네임", stored || "guest");
    if (!nickname) return "";
    const clean = nickname.trim().slice(0, 24);
    if (clean) localStorage.setItem("paengclub-player-name", clean);
    return clean;
}

async function submitScore(score, metadata = {}) {
    const playerName = playerNameForScore();
    if (!playerName) {
        setStatus("닉네임이 필요합니다.", "danger");
        return;
    }

    const session = getCurrentSession();
    const { error } = await supabase.from("game_scores").insert({
        game_id: activeGame,
        score,
        player_name: playerName,
        user_id: session?.user?.id || null,
        metadata
    });

    if (error) {
        setStatus(error.message, "danger");
        return;
    }

    setStatus(`${score}${gameInfo().unit} 기록 완료`, "success");
    await refreshGameData();
}

async function loadLeaderboard() {
    const { data, error } = await supabase
        .from("game_scores")
        .select("player_name, score, created_at")
        .eq("game_id", activeGame)
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(3);

    if (error) throw error;
    return data || [];
}

async function loadStats() {
    const session = getCurrentSession();
    if (!session) return null;

    const { data, error } = await supabase
        .from("game_scores")
        .select("game_id, score")
        .eq("user_id", session.user.id);

    if (error) throw error;
    return data || [];
}

function renderLeaderboard(rows) {
    const list = document.getElementById("leaderboardList");
    if (!list) return;
    list.replaceChildren();

    if (rows.length === 0) {
        list.appendChild(el("div", { class: "empty-line", text: "아직 기록 없음" }));
        return;
    }

    rows.forEach((row, index) => {
        list.appendChild(el("div", { class: "leader-row" }, [
            el("span", { class: "leader-rank", text: String(index + 1) }),
            el("span", { class: "leader-name", text: row.player_name }),
            el("span", { class: "leader-score", text: `${row.score}${gameInfo().unit}` })
        ]));
    });
}

function renderStats(rows) {
    const stats = document.getElementById("myStats");
    if (!stats) return;
    stats.replaceChildren();

    if (!getCurrentSession()) {
        stats.appendChild(el("div", { class: "empty-line", text: "로그인하면 내 통계가 저장됩니다." }));
        return;
    }

    if (!rows || rows.length === 0) {
        stats.appendChild(el("div", { class: "empty-line", text: "아직 내 기록 없음" }));
        return;
    }

    for (const [gameId, info] of Object.entries(GAMES)) {
        const scores = rows.filter((row) => row.game_id === gameId).map((row) => row.score);
        const best = scores.length ? Math.max(...scores) : 0;
        stats.appendChild(el("div", { class: "stat-row" }, [
            el("span", { text: info.title }),
            el("strong", { text: scores.length ? `${best}${info.unit} · ${scores.length}회` : "-" })
        ]));
    }
}

async function refreshGameData() {
    try {
        const [leaders, stats] = await Promise.all([loadLeaderboard(), loadStats()]);
        renderLeaderboard(leaders);
        renderStats(stats);
    } catch (error) {
        setStatus(error.message, "danger");
    }
}

function chooseGame(gameId) {
    activeGame = gameId;
    cleanupTimers();
    renderGames();
}

function cleanupTimers() {
    if (reactionTimer) window.clearTimeout(reactionTimer);
    if (tapTimer) window.clearInterval(tapTimer);
    reactionTimer = null;
    tapTimer = null;
}

export function cleanupGames() {
    cleanupTimers();
}

function renderGameTabs() {
    return el("div", { class: "game-tabs" }, Object.entries(GAMES).map(([gameId, info]) => {
        return el("button", {
            class: `game-tab ${gameId === activeGame ? "active" : ""}`,
            type: "button",
            text: info.title,
            onclick: () => chooseGame(gameId)
        });
    }));
}

function renderReactionGame() {
    const pad = el("button", { class: "game-pad reaction-idle", type: "button", text: "시작" });
    let waiting = false;
    let ready = false;

    pad.addEventListener("click", async () => {
        if (!waiting && !ready) {
            waiting = true;
            pad.className = "game-pad reaction-wait";
            pad.textContent = "기다려...";
            reactionTimer = window.setTimeout(() => {
                ready = true;
                waiting = false;
                reactionStart = performance.now();
                pad.className = "game-pad reaction-ready";
                pad.textContent = "지금!";
            }, 900 + Math.random() * 1700);
            return;
        }

        if (waiting) {
            cleanupTimers();
            waiting = false;
            pad.className = "game-pad reaction-idle";
            pad.textContent = "너무 빨랐음";
            setStatus("초록색이 된 뒤 눌러야 합니다.", "danger");
            return;
        }

        if (ready) {
            const ms = Math.round(performance.now() - reactionStart);
            const score = Math.max(0, 1200 - ms);
            ready = false;
            pad.className = "game-pad reaction-idle";
            pad.textContent = `${ms}ms`;
            await submitScore(score, { ms });
        }
    });

    return pad;
}

function renderTapRushGame() {
    const pad = el("button", { class: "game-pad tap-pad", type: "button", text: "10초 탭 시작" });
    let running = false;

    function updateLabel() {
        const left = Math.max(0, Math.ceil((tapDeadline - Date.now()) / 1000));
        pad.textContent = running ? `${tapCount}회 · ${left}s` : "10초 탭 시작";
    }

    pad.addEventListener("click", async () => {
        if (!running) {
            running = true;
            tapCount = 0;
            tapDeadline = Date.now() + 10000;
            pad.classList.add("running");
            tapTimer = window.setInterval(async () => {
                updateLabel();
                if (Date.now() >= tapDeadline) {
                    cleanupTimers();
                    running = false;
                    pad.classList.remove("running");
                    pad.textContent = `${tapCount}회`;
                    await submitScore(tapCount, { seconds: 10 });
                }
            }, 200);
        }

        if (running) {
            tapCount += 1;
            updateLabel();
        }
    });

    return pad;
}

function nextMemoryStep() {
    memoryInput = [];
    memoryLocked = true;
    memorySequence.push(Math.floor(Math.random() * 4));
    const buttons = Array.from(document.querySelectorAll(".memory-cell"));
    let delay = 250;

    memorySequence.forEach((value) => {
        window.setTimeout(() => {
            buttons[value]?.classList.add("flash");
            window.setTimeout(() => buttons[value]?.classList.remove("flash"), 260);
        }, delay);
        delay += 520;
    });

    window.setTimeout(() => {
        memoryLocked = false;
        setStatus("순서대로 누르세요.");
    }, delay);
}

function renderMemoryGame() {
    memorySequence = [];
    memoryInput = [];
    memoryLocked = false;

    const grid = el("div", { class: "memory-grid" }, [0, 1, 2, 3].map((value) => {
        return el("button", {
            class: "memory-cell",
            type: "button",
            text: String(value + 1),
            onclick: async () => {
                if (memoryLocked || memorySequence.length === 0) return;
                memoryInput.push(value);
                const index = memoryInput.length - 1;
                if (memoryInput[index] !== memorySequence[index]) {
                    const score = Math.max(0, memorySequence.length - 1);
                    setStatus(`실패 · ${score}단계`, "danger");
                    await submitScore(score, { length: memorySequence.length });
                    memorySequence = [];
                    memoryInput = [];
                    return;
                }

                if (memoryInput.length === memorySequence.length) {
                    setStatus(`${memorySequence.length}단계 성공`, "success");
                    nextMemoryStep();
                }
            }
        });
    }));

    const start = el("button", {
        class: "primary-button",
        type: "button",
        text: "시작",
        onclick: () => {
            memorySequence = [];
            nextMemoryStep();
        }
    });

    return el("div", { class: "memory-wrap" }, [grid, start]);
}

function renderActiveGame() {
    if (activeGame === "reaction") return renderReactionGame();
    if (activeGame === "taprush") return renderTapRushGame();
    return renderMemoryGame();
}

export async function renderGames() {
    cleanupTimers();
    const root = document.getElementById("screen");
    if (!root) return;

    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell games-shell" });
    const panel = el("div", { class: "app-panel games-panel" });

    panel.append(
        el("div", { class: "section-header games-header" }, [
            el("div", {}, [el("h1", { class: "section-title", text: "미니게임" })]),
            renderGameTabs()
        ]),
        el("div", { class: "game-layout" }, [
            el("div", { class: "game-stage" }, [
                el("div", { class: "game-title-row" }, [
                    el("h2", { class: "game-title", text: gameInfo().title }),
                    el("span", { class: "muted-text", text: gameInfo().description })
                ]),
                renderActiveGame(),
                el("div", { id: "gameStatus", class: "game-status", text: "" })
            ]),
            el("aside", { class: "game-side" }, [
                el("div", { class: "side-block" }, [
                    el("h2", { class: "side-title", text: "TOP 3" }),
                    el("div", { id: "leaderboardList", class: "leader-list" }, [
                        el("div", { class: "empty-line", text: "불러오는 중" })
                    ])
                ]),
                el("div", { class: "side-block" }, [
                    el("h2", { class: "side-title", text: "내 통계" }),
                    el("div", { id: "myStats", class: "stats-list" }, [
                        el("div", { class: "empty-line", text: "불러오는 중" })
                    ])
                ])
            ])
        ])
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);
    await refreshGameData();
}
