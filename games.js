import { supabase } from "/supabaseClient.js";
import { getCurrentPlayerName, getCurrentSession } from "/board.js";

const GAMES = {
    reaction: {
        title: "반응속도",
        unit: "ms",
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
    },
    tetris: {
        title: "테트리스",
        unit: "점",
        description: "블록을 쌓기 전에 줄을 지우세요"
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

// --- tetris ---
const TETRIS_COLS = 10;
const TETRIS_ROWS = 20;
const TETRIS_CELL = 22;
const TETRIS_SHAPES = {
    I: ["....", "XXXX", "....", "...."],
    O: [".XX.", ".XX.", "....", "...."],
    T: [".X..", "XXX.", "....", "...."],
    S: [".XX.", "XX..", "....", "...."],
    Z: ["XX..", ".XX.", "....", "...."],
    J: ["X...", "XXX.", "....", "...."],
    L: ["..X.", "XXX.", "....", "...."]
};
const TETRIS_COLORS = {
    I: "#22d3ee", O: "#eab308", T: "#a855f7", S: "#22c55e", Z: "#ef4444", J: "#3b82f6", L: "#f97316"
};
// DAS = delay before a held key starts auto-repeating, ARR = interval between repeats
// once it does. Driven by our own rAF loop instead of the browser's native key-repeat,
// so simultaneous keys (e.g. holding a direction while tapping rotate) never get dropped
// and the repeat speed doesn't depend on the OS keyboard-repeat setting.
const TETRIS_DAS_MS = 120;
const TETRIS_ARR_MS = 28;
const TETRIS_SOFT_DROP_DAS_MS = 0;
const TETRIS_SOFT_DROP_ARR_MS = 40;

let tetrisBoard = [];
let tetrisPiece = null;
let tetrisNextType = null;
let tetrisScore = 0;
let tetrisLines = 0;
let tetrisLevel = 1;
let tetrisTimer = null;
let tetrisRunning = false;
let tetrisOver = false;
let tetrisKeyDownHandler = null;
let tetrisKeyUpHandler = null;
let tetrisCanvas = null;
let tetrisCtx = null;
let tetrisNextCanvas = null;
let tetrisNextCtx = null;
let tetrisHoldCanvas = null;
let tetrisHoldCtx = null;
let tetrisBoardWrap = null;
let tetrisOverlayBtn = null;
let tetrisHoldType = null;
let tetrisHoldUsed = false;

// Held-key state for the custom DAS/ARR loop.
let tetrisLeftHeldAt = 0;
let tetrisRightHeldAt = 0;
let tetrisDownHeldAt = 0;
let tetrisLastDirection = null;
let tetrisRepeatNext = { left: 0, right: 0, down: 0 };
let tetrisInputLoopId = null;

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

function css(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
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

    const label = activeGame === "reaction" && metadata.ms ? `${metadata.ms}ms` : `${score}${gameInfo().unit}`;
    setStatus(`${label} 기록 완료`, "success");
    await refreshGameData();
}

async function loadLeaderboard() {
    const { data, error } = await supabase
        .from("game_scores")
        .select("player_name, score, metadata, created_at")
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
            el("span", { class: "leader-score", text: scoreLabel(row) })
        ]));
    });
}

function scoreLabel(row) {
    if (row.game_id === "reaction" || activeGame === "reaction") {
        const ms = row.metadata?.ms;
        return ms ? `${ms}ms` : `${Math.max(0, 1200 - row.score)}ms`;
    }
    return `${row.score}${GAMES[row.game_id || activeGame]?.unit || ""}`;
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
        const bestLabel = gameId === "reaction" ? `${Math.max(0, 1200 - best)}ms` : `${best}${info.unit}`;
        stats.appendChild(el("div", { class: "stat-row" }, [
            el("span", { text: info.title }),
            el("strong", { text: scores.length ? `${bestLabel} · ${scores.length}회` : "-" })
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
    if (tetrisTimer) window.clearTimeout(tetrisTimer);
    tetrisTimer = null;
    if (tetrisKeyDownHandler) {
        window.removeEventListener("keydown", tetrisKeyDownHandler);
        tetrisKeyDownHandler = null;
    }
    if (tetrisKeyUpHandler) {
        window.removeEventListener("keyup", tetrisKeyUpHandler);
        tetrisKeyUpHandler = null;
    }
    tetrisStopInputLoop();
    tetrisLeftHeldAt = 0;
    tetrisRightHeldAt = 0;
    tetrisDownHeldAt = 0;
    tetrisLastDirection = null;
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

function shapeToGrid(shape) {
    return shape.map((row) => row.split("").map((ch) => ch === "X"));
}

function rotateGrid(grid) {
    const n = grid.length;
    const result = Array.from({ length: n }, () => Array(n).fill(false));
    for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) result[x][n - 1 - y] = grid[y][x];
    }
    return result;
}

function spawnRowOffset(grid) {
    for (let r = 0; r < grid.length; r += 1) {
        if (grid[r].some(Boolean)) return -r;
    }
    return 0;
}

function randomTetrominoType() {
    const types = Object.keys(TETRIS_SHAPES);
    return types[Math.floor(Math.random() * types.length)];
}

function tetrisCollision(grid, px, py) {
    for (let r = 0; r < grid.length; r += 1) {
        for (let c = 0; c < grid.length; c += 1) {
            if (!grid[r][c]) continue;
            const bx = px + c;
            const by = py + r;
            if (bx < 0 || bx >= TETRIS_COLS || by >= TETRIS_ROWS) return true;
            if (by >= 0 && tetrisBoard[by][bx]) return true;
        }
    }
    return false;
}

function tetrisDropInterval() {
    return Math.max(100, 800 - (tetrisLevel - 1) * 60);
}

function scheduleTetrisTick() {
    if (tetrisTimer) window.clearTimeout(tetrisTimer);
    tetrisTimer = window.setTimeout(tetrisTick, tetrisDropInterval());
}

function tetrisTick() {
    if (!tetrisRunning || tetrisOver) return;
    if (!moveTetrisPiece(0, 1)) {
        lockTetrisPiece();
        if (tetrisOver) return;
    }
    drawTetris();
    scheduleTetrisTick();
}

function moveTetrisPiece(dx, dy) {
    if (!tetrisPiece) return false;
    const nx = tetrisPiece.x + dx;
    const ny = tetrisPiece.y + dy;
    if (tetrisCollision(tetrisPiece.grid, nx, ny)) return false;
    tetrisPiece.x = nx;
    tetrisPiece.y = ny;
    return true;
}

function rotateTetrisPiece() {
    if (!tetrisPiece || !tetrisRunning || tetrisOver) return;
    const rotated = rotateGrid(tetrisPiece.grid);
    for (const dx of [0, -1, 1, -2, 2]) {
        if (!tetrisCollision(rotated, tetrisPiece.x + dx, tetrisPiece.y)) {
            tetrisPiece.grid = rotated;
            tetrisPiece.x += dx;
            drawTetris();
            return;
        }
    }
}

function moveTetrisLeft() {
    if (!tetrisRunning || tetrisOver) return;
    if (moveTetrisPiece(-1, 0)) drawTetris();
}

function moveTetrisRight() {
    if (!tetrisRunning || tetrisOver) return;
    if (moveTetrisPiece(1, 0)) drawTetris();
}

function tetrisSoftDrop() {
    if (!tetrisRunning || tetrisOver) return;
    if (moveTetrisPiece(0, 1)) {
        tetrisScore += 1;
        updateTetrisHud();
        drawTetris();
        scheduleTetrisTick();
        return;
    }
    lockTetrisPiece();
    if (!tetrisOver) {
        drawTetris();
        scheduleTetrisTick();
    }
}

function tetrisHardDrop() {
    if (!tetrisRunning || tetrisOver) return;
    let distance = 0;
    while (moveTetrisPiece(0, 1)) distance += 1;
    tetrisScore += distance * 2;
    lockTetrisPiece();
    drawTetris();
    if (!tetrisOver) scheduleTetrisTick();
}

function clearTetrisLines() {
    let cleared = 0;
    for (let r = TETRIS_ROWS - 1; r >= 0; r -= 1) {
        if (tetrisBoard[r].every(Boolean)) {
            tetrisBoard.splice(r, 1);
            tetrisBoard.unshift(Array(TETRIS_COLS).fill(null));
            cleared += 1;
            r += 1;
        }
    }
    return cleared;
}

function applyTetrisLineScore(cleared) {
    if (cleared <= 0) return;
    const table = [0, 100, 300, 500, 800];
    tetrisScore += (table[cleared] || 800) * tetrisLevel;
    tetrisLines += cleared;
    const nextLevel = Math.floor(tetrisLines / 10) + 1;
    if (nextLevel !== tetrisLevel) tetrisLevel = nextLevel;
    updateTetrisHud();
}

function spawnTetrisPiece() {
    const type = tetrisNextType || randomTetrominoType();
    tetrisNextType = randomTetrominoType();
    const grid = shapeToGrid(TETRIS_SHAPES[type]);
    const piece = { type, grid, x: 3, y: spawnRowOffset(grid), color: TETRIS_COLORS[type] };
    if (tetrisCollision(piece.grid, piece.x, piece.y)) {
        tetrisPiece = piece;
        endTetrisGame();
        return;
    }
    tetrisPiece = piece;
    updateTetrisHud();
}

function lockTetrisPiece() {
    if (!tetrisPiece) return;
    const { grid, x, y, color } = tetrisPiece;
    for (let r = 0; r < grid.length; r += 1) {
        for (let c = 0; c < grid.length; c += 1) {
            if (!grid[r][c]) continue;
            const bx = x + c;
            const by = y + r;
            if (by >= 0 && by < TETRIS_ROWS && bx >= 0 && bx < TETRIS_COLS) tetrisBoard[by][bx] = color;
        }
    }
    applyTetrisLineScore(clearTetrisLines());
    // A fresh piece is now in play, so hold becomes available again.
    tetrisHoldUsed = false;
    spawnTetrisPiece();
}

function holdTetrisPiece() {
    if (!tetrisRunning || tetrisOver || !tetrisPiece || tetrisHoldUsed) return;
    tetrisHoldUsed = true;
    const currentType = tetrisPiece.type;

    if (tetrisHoldType === null) {
        tetrisHoldType = currentType;
        spawnTetrisPiece();
    } else {
        const swapType = tetrisHoldType;
        tetrisHoldType = currentType;
        const grid = shapeToGrid(TETRIS_SHAPES[swapType]);
        const piece = { type: swapType, grid, x: 3, y: spawnRowOffset(grid), color: TETRIS_COLORS[swapType] };
        if (tetrisCollision(piece.grid, piece.x, piece.y)) {
            tetrisPiece = piece;
            endTetrisGame();
            return;
        }
        tetrisPiece = piece;
    }
    updateTetrisHud();
    drawTetris();
}

function endTetrisGame() {
    tetrisOver = true;
    tetrisRunning = false;
    if (tetrisTimer) window.clearTimeout(tetrisTimer);
    tetrisTimer = null;
    drawTetris();
    setStatus(`게임 종료 · ${tetrisScore}점`, "danger");
    showTetrisOverlay("다시 시작");
    submitScore(tetrisScore, { lines: tetrisLines, level: tetrisLevel });
}

function startTetrisGame() {
    tetrisBoard = Array.from({ length: TETRIS_ROWS }, () => Array(TETRIS_COLS).fill(null));
    tetrisScore = 0;
    tetrisLines = 0;
    tetrisLevel = 1;
    tetrisOver = false;
    tetrisRunning = true;
    tetrisHoldType = null;
    tetrisHoldUsed = false;
    tetrisLeftHeldAt = 0;
    tetrisRightHeldAt = 0;
    tetrisDownHeldAt = 0;
    tetrisLastDirection = null;
    tetrisNextType = randomTetrominoType();
    spawnTetrisPiece();
    updateTetrisHud();
    drawTetris();
    scheduleTetrisTick();
    setStatus("");
}

function tetrisStepRepeat(now, key, heldAt, das, arr, action) {
    if (!heldAt) return false;
    if (now - heldAt < das) return false;
    if (tetrisRepeatNext[key] === 0 || now >= tetrisRepeatNext[key]) {
        action();
        tetrisRepeatNext[key] = now + arr;
        return true;
    }
    return false;
}

function processTetrisHeldInput(now) {
    if (!tetrisRunning || tetrisOver) return;
    let moved = false;

    const activeDir = tetrisLeftHeldAt && tetrisRightHeldAt
        ? tetrisLastDirection
        : (tetrisLeftHeldAt ? "left" : (tetrisRightHeldAt ? "right" : null));

    if (activeDir === "left") {
        if (tetrisStepRepeat(now, "left", tetrisLeftHeldAt, TETRIS_DAS_MS, TETRIS_ARR_MS, () => moveTetrisPiece(-1, 0))) moved = true;
    } else if (activeDir === "right") {
        if (tetrisStepRepeat(now, "right", tetrisRightHeldAt, TETRIS_DAS_MS, TETRIS_ARR_MS, () => moveTetrisPiece(1, 0))) moved = true;
    }

    if (tetrisDownHeldAt) {
        const fired = tetrisStepRepeat(now, "down", tetrisDownHeldAt, TETRIS_SOFT_DROP_DAS_MS, TETRIS_SOFT_DROP_ARR_MS, () => {
            if (moveTetrisPiece(0, 1)) {
                tetrisScore += 1;
                updateTetrisHud();
            } else {
                lockTetrisPiece();
            }
        });
        if (fired) moved = true;
    }

    if (moved) drawTetris();
}

function tetrisInputLoopTick(now) {
    processTetrisHeldInput(now);
    tetrisInputLoopId = window.requestAnimationFrame(tetrisInputLoopTick);
}

function tetrisStartInputLoop() {
    if (tetrisInputLoopId) return;
    tetrisInputLoopId = window.requestAnimationFrame(tetrisInputLoopTick);
}

function tetrisStopInputLoop() {
    if (tetrisInputLoopId) window.cancelAnimationFrame(tetrisInputLoopId);
    tetrisInputLoopId = null;
}

function handleTetrisKeyDown(event) {
    if (activeGame !== "tetris" || !tetrisRunning || tetrisOver) return;
    const key = event.key;

    if (key === "ArrowLeft") {
        event.preventDefault();
        if (!tetrisLeftHeldAt) {
            tetrisLeftHeldAt = performance.now();
            tetrisRepeatNext.left = 0;
            tetrisLastDirection = "left";
            if (moveTetrisPiece(-1, 0)) drawTetris();
        }
    } else if (key === "ArrowRight") {
        event.preventDefault();
        if (!tetrisRightHeldAt) {
            tetrisRightHeldAt = performance.now();
            tetrisRepeatNext.right = 0;
            tetrisLastDirection = "right";
            if (moveTetrisPiece(1, 0)) drawTetris();
        }
    } else if (key === "ArrowDown") {
        event.preventDefault();
        if (!tetrisDownHeldAt) {
            tetrisDownHeldAt = performance.now();
            tetrisRepeatNext.down = 0;
            if (moveTetrisPiece(0, 1)) {
                tetrisScore += 1;
                updateTetrisHud();
                drawTetris();
            }
        }
    } else if (key === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) rotateTetrisPiece();
    } else if (key === " ") {
        event.preventDefault();
        if (!event.repeat) tetrisHardDrop();
    } else if (key === "c" || key === "C") {
        if (!event.repeat) holdTetrisPiece();
    }
}

function handleTetrisKeyUp(event) {
    if (event.key === "ArrowLeft") {
        tetrisLeftHeldAt = 0;
        if (tetrisLastDirection === "left") tetrisLastDirection = tetrisRightHeldAt ? "right" : null;
    } else if (event.key === "ArrowRight") {
        tetrisRightHeldAt = 0;
        if (tetrisLastDirection === "right") tetrisLastDirection = tetrisLeftHeldAt ? "left" : null;
    } else if (event.key === "ArrowDown") {
        tetrisDownHeldAt = 0;
    }
}

function tetrisGhostY() {
    let y = tetrisPiece.y;
    while (!tetrisCollision(tetrisPiece.grid, tetrisPiece.x, y + 1)) y += 1;
    return y;
}

function drawTetrisCell(ctx, col, row, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(col * TETRIS_CELL + 1, row * TETRIS_CELL + 1, TETRIS_CELL - 2, TETRIS_CELL - 2);
    ctx.globalAlpha = 1;
}

function drawTetrisShape(ctx, grid, px, py, color, alpha) {
    for (let r = 0; r < grid.length; r += 1) {
        for (let c = 0; c < grid.length; c += 1) {
            if (!grid[r][c]) continue;
            const by = py + r;
            if (by >= 0) drawTetrisCell(ctx, px + c, by, color, alpha);
        }
    }
}

function drawTetris() {
    if (!tetrisCtx) return;
    const width = TETRIS_COLS * TETRIS_CELL;
    const height = TETRIS_ROWS * TETRIS_CELL;
    tetrisCtx.clearRect(0, 0, width, height);
    tetrisCtx.fillStyle = css("--app-bg") || "#161814";
    tetrisCtx.fillRect(0, 0, width, height);

    tetrisCtx.strokeStyle = css("--app-line") || "rgba(128,128,128,0.2)";
    tetrisCtx.lineWidth = 1;
    for (let c = 0; c <= TETRIS_COLS; c += 1) {
        tetrisCtx.beginPath();
        tetrisCtx.moveTo(c * TETRIS_CELL + 0.5, 0);
        tetrisCtx.lineTo(c * TETRIS_CELL + 0.5, height);
        tetrisCtx.stroke();
    }
    for (let r = 0; r <= TETRIS_ROWS; r += 1) {
        tetrisCtx.beginPath();
        tetrisCtx.moveTo(0, r * TETRIS_CELL + 0.5);
        tetrisCtx.lineTo(width, r * TETRIS_CELL + 0.5);
        tetrisCtx.stroke();
    }

    for (let r = 0; r < TETRIS_ROWS; r += 1) {
        for (let c = 0; c < TETRIS_COLS; c += 1) {
            if (tetrisBoard[r]?.[c]) drawTetrisCell(tetrisCtx, c, r, tetrisBoard[r][c]);
        }
    }

    if (tetrisPiece && !tetrisOver) {
        const ghostY = tetrisGhostY();
        drawTetrisShape(tetrisCtx, tetrisPiece.grid, tetrisPiece.x, ghostY, tetrisPiece.color, 0.22);
        drawTetrisShape(tetrisCtx, tetrisPiece.grid, tetrisPiece.x, tetrisPiece.y, tetrisPiece.color, 1);
    }

    if (tetrisOver) {
        tetrisCtx.fillStyle = "rgba(0,0,0,0.55)";
        tetrisCtx.fillRect(0, 0, width, height);
        tetrisCtx.fillStyle = "#ffffff";
        tetrisCtx.font = "bold 16px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
        tetrisCtx.textAlign = "center";
        tetrisCtx.fillText("게임 종료", width / 2, height / 2);
    }
}

function drawTetrisNext() {
    if (!tetrisNextCtx || !tetrisNextType) return;
    const cell = 16;
    tetrisNextCtx.clearRect(0, 0, cell * 4, cell * 4);
    const grid = shapeToGrid(TETRIS_SHAPES[tetrisNextType]);
    const color = TETRIS_COLORS[tetrisNextType];
    for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
            if (grid[r][c]) {
                tetrisNextCtx.fillStyle = color;
                tetrisNextCtx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
            }
        }
    }
}

function drawTetrisHold() {
    if (!tetrisHoldCtx) return;
    const cell = 16;
    tetrisHoldCtx.clearRect(0, 0, cell * 4, cell * 4);
    if (!tetrisHoldType) return;
    const grid = shapeToGrid(TETRIS_SHAPES[tetrisHoldType]);
    tetrisHoldCtx.fillStyle = TETRIS_COLORS[tetrisHoldType];
    tetrisHoldCtx.globalAlpha = tetrisHoldUsed ? 0.35 : 1;
    for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
            if (grid[r][c]) tetrisHoldCtx.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
        }
    }
    tetrisHoldCtx.globalAlpha = 1;
}

function updateTetrisHud() {
    const scoreEl = document.getElementById("tetrisScore");
    const linesEl = document.getElementById("tetrisLines");
    const levelEl = document.getElementById("tetrisLevel");
    if (scoreEl) scoreEl.textContent = String(tetrisScore);
    if (linesEl) linesEl.textContent = String(tetrisLines);
    if (levelEl) levelEl.textContent = String(tetrisLevel);
    drawTetrisNext();
    drawTetrisHold();
}

function hideTetrisOverlay() {
    if (tetrisOverlayBtn) {
        tetrisOverlayBtn.remove();
        tetrisOverlayBtn = null;
    }
}

function showTetrisOverlay(label) {
    hideTetrisOverlay();
    if (!tetrisBoardWrap) return;
    tetrisOverlayBtn = el("button", {
        class: "tetris-start-btn",
        type: "button",
        text: label,
        onclick: () => {
            hideTetrisOverlay();
            startTetrisGame();
        }
    });
    tetrisBoardWrap.appendChild(tetrisOverlayBtn);
}

function renderTetrisGame() {
    tetrisCanvas = el("canvas", {
        id: "tetrisCanvas",
        width: String(TETRIS_COLS * TETRIS_CELL),
        height: String(TETRIS_ROWS * TETRIS_CELL),
        class: "tetris-canvas",
        "aria-label": "테트리스 보드"
    });
    tetrisCtx = tetrisCanvas.getContext("2d");

    tetrisNextCanvas = el("canvas", { id: "tetrisNextCanvas", width: "64", height: "64", class: "tetris-next-canvas", "aria-label": "다음 블록" });
    tetrisNextCtx = tetrisNextCanvas.getContext("2d");

    tetrisHoldCanvas = el("canvas", { id: "tetrisHoldCanvas", width: "64", height: "64", class: "tetris-next-canvas", "aria-label": "홀드한 블록" });
    tetrisHoldCtx = tetrisHoldCanvas.getContext("2d");

    const hud = el("div", { class: "tetris-hud" }, [
        el("div", { class: "tetris-hud-item" }, [el("span", { text: "점수" }), el("strong", { id: "tetrisScore", text: String(tetrisScore) })]),
        el("div", { class: "tetris-hud-item" }, [el("span", { text: "라인" }), el("strong", { id: "tetrisLines", text: String(tetrisLines) })]),
        el("div", { class: "tetris-hud-item" }, [el("span", { text: "레벨" }), el("strong", { id: "tetrisLevel", text: String(tetrisLevel) })]),
        el("div", { class: "tetris-previews" }, [
            el("div", { class: "tetris-next-wrap" }, [el("span", { text: "홀드" }), tetrisHoldCanvas]),
            el("div", { class: "tetris-next-wrap" }, [el("span", { text: "다음" }), tetrisNextCanvas])
        ])
    ]);

    tetrisBoardWrap = el("div", { class: "tetris-board-wrap" }, [tetrisCanvas]);

    const controls = el("div", { class: "tetris-controls" }, [
        el("button", { class: "tetris-btn", type: "button", text: "←", "aria-label": "왼쪽", onclick: moveTetrisLeft }),
        el("button", { class: "tetris-btn", type: "button", text: "↻", "aria-label": "회전", onclick: rotateTetrisPiece }),
        el("button", { class: "tetris-btn", type: "button", text: "→", "aria-label": "오른쪽", onclick: moveTetrisRight }),
        el("button", { class: "tetris-btn", type: "button", text: "소프트", "aria-label": "소프트 드롭", onclick: tetrisSoftDrop }),
        el("button", { class: "tetris-btn", type: "button", text: "하드", "aria-label": "하드 드롭", onclick: tetrisHardDrop }),
        el("button", { class: "tetris-btn", type: "button", text: "홀드", "aria-label": "홀드 (C)", onclick: holdTetrisPiece })
    ]);

    tetrisKeyDownHandler = handleTetrisKeyDown;
    tetrisKeyUpHandler = handleTetrisKeyUp;
    window.addEventListener("keydown", tetrisKeyDownHandler);
    window.addEventListener("keyup", tetrisKeyUpHandler);
    tetrisStartInputLoop();

    drawTetris();
    drawTetrisNext();
    drawTetrisHold();
    if (tetrisRunning && !tetrisOver) scheduleTetrisTick();
    else showTetrisOverlay(tetrisOver ? "다시 시작" : "시작");

    return el("div", { class: "tetris-wrap" }, [hud, tetrisBoardWrap, controls]);
}

function renderActiveGame() {
    if (activeGame === "reaction") return renderReactionGame();
    if (activeGame === "taprush") return renderTapRushGame();
    if (activeGame === "tetris") return renderTetrisGame();
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
