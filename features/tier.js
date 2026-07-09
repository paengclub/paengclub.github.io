// features/tier.js — 게임 티어, a shared S/A/B/C/D/F tier list. Anyone (even
// logged out) can add a game (image upload to the tier-games bucket) and
// drag/drop it between tiers; positions sync via Supabase realtime + a poll.
// Exports renderGameTier, cleanupGameTier.
import { supabase } from "/supabaseClient.js";
import { el } from "/lib/dom.js";

const TIERS = [
    { key: "S", label: "S", color: "#ef4444" },
    { key: "A", label: "A", color: "#f97316" },
    { key: "B", label: "B", color: "#eab308" },
    { key: "C", label: "C", color: "#22c55e" },
    { key: "D", label: "D", color: "#3b82f6" },
    { key: "F", label: "F", color: "#8b5cf6" }
];
const POOL_TIER = "unranked";
const MAX_NAME_LENGTH = 40;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const games = new Map();
let gameChannel = null;
let refreshTimer = null;
let addFormOpen = false;
let dragState = null;

function setStatus(message, type = "") {
    const status = document.getElementById("tierStatus");
    if (!status) return;
    status.className = `tier-status ${type}`;
    status.textContent = message;
}

function sortedGamesForTier(tier) {
    return Array.from(games.values())
        .filter((game) => game.tier === tier)
        .sort((a, b) => a.position - b.position);
}

function imageExtension(file) {
    const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (fromName) return fromName;
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    return "jpg";
}

async function loadGames(showErrors = true) {
    const { data, error } = await supabase.from("tier_games").select("id, name, image_url, tier, position");
    if (error) {
        if (showErrors) setStatus(error.message, "danger");
        return;
    }

    games.clear();
    for (const game of data || []) games.set(game.id, game);
    renderBoard();
}

function subscribeGames() {
    if (gameChannel) return;

    gameChannel = supabase
        .channel("shared-tier-list")
        .on("postgres_changes", { event: "*", schema: "public", table: "tier_games" }, (payload) => {
            if (dragState) return;
            if (payload.eventType === "DELETE") games.delete(payload.old.id);
            else games.set(payload.new.id, payload.new);
            renderBoard();
        })
        .subscribe();
}

function startPolling() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
        if (document.hidden || dragState) return;
        loadGames(false);
    }, 1500);
}

function nextPoolPosition() {
    const poolGames = sortedGamesForTier(POOL_TIER);
    if (poolGames.length === 0) return 0;
    return poolGames[poolGames.length - 1].position + 1;
}

async function addGame(name, file) {
    const cleanName = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!cleanName) {
        setStatus("게임 이름을 입력해 주세요.", "danger");
        return false;
    }
    if (!file) {
        setStatus("이미지를 선택해 주세요.", "danger");
        return false;
    }
    if (!file.type.startsWith("image/")) {
        setStatus("이미지 파일만 올릴 수 있어요.", "danger");
        return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
        setStatus("2MB 이하 이미지로 올려 주세요.", "danger");
        return false;
    }

    setStatus("업로드 중...");
    const path = `games/${crypto.randomUUID()}.${imageExtension(file)}`;
    const { error: uploadError } = await supabase.storage
        .from("tier-games")
        .upload(path, file, { cacheControl: "3600" });

    if (uploadError) {
        setStatus(uploadError.message, "danger");
        return false;
    }

    const { data: urlData } = supabase.storage.from("tier-games").getPublicUrl(path);
    const { error: insertError } = await supabase.from("tier_games").insert({
        name: cleanName,
        image_url: urlData.publicUrl,
        tier: POOL_TIER,
        position: nextPoolPosition()
    });

    if (insertError) {
        setStatus(insertError.message, "danger");
        return false;
    }

    setStatus(`"${cleanName}" 추가 완료`, "success");
    await loadGames(false);
    return true;
}

function computeDropIndex(dropzone, x, y, excludeId) {
    const items = Array.from(dropzone.querySelectorAll(".tier-item")).filter((node) => node.dataset.gameId !== excludeId);
    for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (y < rect.top) return i;
        if (y <= rect.bottom && x < rect.left + rect.width / 2) return i;
    }
    return items.length;
}

function computePosition(tier, index, excludeId) {
    const siblings = sortedGamesForTier(tier).filter((game) => game.id !== excludeId);
    const before = siblings[index - 1];
    const after = siblings[index];
    if (!before && !after) return 0;
    if (!before) return after.position - 1;
    if (!after) return before.position + 1;
    return (before.position + after.position) / 2;
}

async function persistMove(gameId, tier, position) {
    const { error } = await supabase.from("tier_games").update({ tier, position }).eq("id", gameId);
    if (error) setStatus(error.message, "danger");
}

function clearDragVisuals() {
    document.querySelectorAll(".tier-dropzone.drag-over").forEach((node) => node.classList.remove("drag-over"));
}

function endDrag() {
    if (!dragState) return;
    dragState.ghost?.remove();
    dragState.itemEl?.classList.remove("dragging");
    clearDragVisuals();
    dragState = null;
}

function onPointerMove(event) {
    if (!dragState) return;
    event.preventDefault();

    dragState.ghost.style.left = `${event.clientX - dragState.offsetX}px`;
    dragState.ghost.style.top = `${event.clientY - dragState.offsetY}px`;

    clearDragVisuals();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const dropzone = target?.closest(".tier-dropzone");
    if (dropzone) dropzone.classList.add("drag-over");
}

async function onPointerUp(event) {
    if (!dragState) return;
    const { gameId } = dragState;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const dropzone = target?.closest(".tier-dropzone");
    endDrag();

    if (!dropzone) return;
    const tier = dropzone.dataset.tier;
    const index = computeDropIndex(dropzone, event.clientX, event.clientY, gameId);
    const position = computePosition(tier, index, gameId);

    const game = games.get(gameId);
    if (!game) return;
    if (game.tier === tier && Math.abs(game.position - position) < 1e-9) return;

    games.set(gameId, { ...game, tier, position });
    renderBoard();
    await persistMove(gameId, tier, position);
}

function startDrag(event, gameId, itemEl) {
    event.preventDefault();
    const rect = itemEl.getBoundingClientRect();

    const ghost = itemEl.cloneNode(true);
    ghost.classList.add("tier-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);

    dragState = {
        gameId,
        itemEl,
        ghost,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
    };

    itemEl.classList.add("dragging");
}

function renderTierItem(game) {
    const item = el("div", {
        class: "tier-item",
        "data-game-id": game.id,
        title: game.name
    }, [
        el("img", { src: game.image_url, alt: game.name, draggable: "false" }),
        el("span", { class: "tier-item-label", text: game.name })
    ]);

    item.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        startDrag(event, game.id, item);
    });

    return item;
}

function renderTierRow(tierDef) {
    const rowGames = sortedGamesForTier(tierDef.key);
    const dropzone = el("div", {
        class: "tier-dropzone",
        "data-tier": tierDef.key
    }, rowGames.map(renderTierItem));

    return el("div", { class: "tier-row" }, [
        el("div", { class: "tier-label", style: `background:${tierDef.color}`, text: tierDef.label }),
        dropzone
    ]);
}

function renderPoolRow() {
    const poolGames = sortedGamesForTier(POOL_TIER);
    const dropzone = el("div", {
        class: "tier-dropzone tier-pool-zone",
        "data-tier": POOL_TIER
    }, poolGames.length ? poolGames.map(renderTierItem) : [el("span", { class: "empty-line", text: "미분류 게임 없음" })]);

    return el("div", { class: "tier-row tier-pool" }, [
        el("div", { class: "tier-label tier-label-pool", text: "미분류" }),
        dropzone
    ]);
}

function renderBoard() {
    const board = document.getElementById("tierBoard");
    if (!board) return;
    board.replaceChildren(...TIERS.map(renderTierRow), renderPoolRow());
}

function toggleAddForm(open) {
    addFormOpen = open;
    const form = document.getElementById("tierAddForm");
    if (form) form.classList.toggle("open", addFormOpen);
}

function renderAddForm() {
    const nameInput = el("input", {
        type: "text",
        class: "form-control",
        placeholder: "게임 이름",
        maxlength: String(MAX_NAME_LENGTH)
    });
    const fileInput = el("input", {
        type: "file",
        class: "form-control",
        accept: "image/*"
    });
    const submit = el("button", {
        class: "primary-button",
        type: "button",
        text: "추가",
        onclick: async () => {
            submit.disabled = true;
            const ok = await addGame(nameInput.value, fileInput.files?.[0]);
            submit.disabled = false;
            if (ok) {
                nameInput.value = "";
                fileInput.value = "";
                toggleAddForm(false);
            }
        }
    });
    const cancel = el("button", {
        class: "secondary-button",
        type: "button",
        text: "취소",
        onclick: () => toggleAddForm(false)
    });

    return el("div", { id: "tierAddForm", class: "tier-add-form" }, [
        el("div", { class: "tier-add-row" }, [nameInput, fileInput]),
        el("div", { class: "tier-add-actions" }, [submit, cancel])
    ]);
}

function teardown() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
    if (gameChannel) {
        supabase.removeChannel(gameChannel);
        gameChannel = null;
    }
    endDrag();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
}

export function cleanupGameTier() {
    teardown();
}

export async function renderGameTier() {
    teardown();
    const root = document.getElementById("screen");
    if (!root) return;

    root.replaceChildren();
    const wrapper = el("section", { class: "page-shell tier-shell" });
    const panel = el("div", { class: "app-panel tier-panel" });

    panel.append(
        el("div", { class: "section-header" }, [
            el("h1", { class: "section-title", text: "게임 티어" }),
            el("button", {
                class: "secondary-button",
                type: "button",
                text: "+ 게임 추가",
                onclick: () => toggleAddForm(!addFormOpen)
            })
        ]),
        renderAddForm(),
        el("div", { id: "tierStatus", class: "tier-status", text: "" }),
        el("div", { id: "tierBoard", class: "tier-board" })
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    renderBoard();
    subscribeGames();
    startPolling();
    await loadGames();
}
