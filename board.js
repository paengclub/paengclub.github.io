import { supabase } from "/supabaseClient.js";

let currentSession = null;
let rerenderApp = null;

function screen() {
    return document.getElementById("screen");
}

function authArea() {
    return document.getElementById("authArea");
}

function userName(user) {
    const meta = user?.user_metadata || {};
    return meta.full_name || meta.name || user?.email?.split("@")[0] || "Paengclub member";
}

function userAvatar(user) {
    return user?.user_metadata?.avatar_url || "";
}

function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of children) {
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
    }
    return node;
}

async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }
    });
    if (error) showBoardAlert(error.message, "danger");
}

async function signOut() {
    await supabase.auth.signOut();
}

async function ensureProfile() {
    const user = currentSession?.user;
    if (!user) return;

    await supabase
        .from("profiles")
        .upsert({
            id: user.id,
            display_name: userName(user),
            avatar_url: userAvatar(user)
        }, { onConflict: "id" });
}

function renderAuthArea() {
    const area = authArea();
    if (!area) return;
    area.replaceChildren();

    if (!currentSession) {
        area.appendChild(el("button", {
            class: "btn btn-outline-primary btn-sm",
            type: "button",
            text: "Google 로그인",
            onclick: signInWithGoogle
        }));
        return;
    }

    const user = currentSession.user;
    const avatar = userAvatar(user);
    if (avatar) {
        area.appendChild(el("img", {
            class: "board-avatar",
            src: avatar,
            alt: ""
        }));
    }
    area.appendChild(el("span", {
        class: "auth-name small text-truncate",
        text: userName(user),
        title: userName(user)
    }));
    area.appendChild(el("button", {
        class: "btn btn-outline-secondary btn-sm",
        type: "button",
        text: "로그아웃",
        onclick: signOut
    }));
}

export async function initBoardAuth(onAuthChange) {
    rerenderApp = onAuthChange;
    const { data } = await supabase.auth.getSession();
    currentSession = data.session;
    if (currentSession) await ensureProfile();
    renderAuthArea();

    supabase.auth.onAuthStateChange(async (_event, session) => {
        currentSession = session;
        if (currentSession) await ensureProfile();
        renderAuthArea();
        if (rerenderApp) rerenderApp();
    });
}

function showBoardAlert(message, type = "info") {
    const alertTarget = document.getElementById("boardAlert");
    if (!alertTarget) return;
    alertTarget.replaceChildren(el("div", {
        class: `alert alert-${type} py-2 mb-3`,
        role: "alert",
        text: message
    }));
}

function renderLoginPrompt(parent) {
    const prompt = el("div", { class: "board-empty p-4 text-center mb-3" }, [
        el("div", { class: "fw-semibold mb-2", text: "게시판은 Google 로그인 후 글쓰기와 댓글 작성이 가능합니다." }),
        el("button", {
            class: "btn btn-primary",
            type: "button",
            text: "Google로 계속하기",
            onclick: signInWithGoogle
        })
    ]);
    parent.appendChild(prompt);
}

function renderComposer(parent) {
    const form = el("form", { class: "card shadow-sm mb-3" });
    const body = el("div", { class: "card-body" });
    const titleInput = el("input", {
        class: "form-control mb-2",
        name: "title",
        maxlength: "120",
        required: "",
        placeholder: "제목"
    });
    const bodyInput = el("textarea", {
        class: "form-control mb-2",
        name: "body",
        rows: "4",
        maxlength: "5000",
        required: "",
        placeholder: "무슨 일이 있었나요?"
    });
    const submit = el("button", {
        class: "btn btn-primary",
        type: "submit",
        text: "글 쓰기"
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        const title = titleInput.value.trim();
        const postBody = bodyInput.value.trim();
        if (!title || !postBody) {
            showBoardAlert("제목과 내용을 입력해주세요.", "warning");
            submit.disabled = false;
            return;
        }

        const { error } = await supabase.from("board_posts").insert({
            title,
            body: postBody,
            author_id: currentSession.user.id
        });

        submit.disabled = false;
        if (error) {
            showBoardAlert(error.message, "danger");
            return;
        }
        titleInput.value = "";
        bodyInput.value = "";
        await renderBoard();
    });

    body.append(titleInput, bodyInput, submit);
    form.appendChild(body);
    parent.appendChild(form);
}

async function loadPosts() {
    const { data, error } = await supabase
        .from("board_posts")
        .select(`
            id,
            title,
            body,
            author_id,
            created_at,
            updated_at,
            profiles:author_id(display_name, avatar_url),
            board_comments(
                id,
                post_id,
                author_id,
                body,
                created_at,
                updated_at,
                profiles:author_id(display_name, avatar_url)
            )
        `)
        .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
}

function renderPostActions(post, container) {
    if (currentSession?.user?.id !== post.author_id) return;

    container.appendChild(el("button", {
        class: "btn btn-outline-danger btn-sm",
        type: "button",
        text: "삭제",
        onclick: async () => {
            if (!window.confirm("이 글을 삭제할까요?")) return;
            const { error } = await supabase.from("board_posts").delete().eq("id", post.id);
            if (error) showBoardAlert(error.message, "danger");
            else await renderBoard();
        }
    }));
}

function renderCommentForm(post, parent) {
    if (!currentSession) return;

    const form = el("form", { class: "mt-3" });
    const row = el("div", { class: "input-group" });
    const input = el("input", {
        class: "form-control",
        maxlength: "1000",
        required: "",
        placeholder: "댓글 쓰기"
    });
    const submit = el("button", {
        class: "btn btn-outline-primary",
        type: "submit",
        text: "댓글"
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        submit.disabled = true;
        const { error } = await supabase.from("board_comments").insert({
            post_id: post.id,
            author_id: currentSession.user.id,
            body
        });
        submit.disabled = false;
        if (error) {
            showBoardAlert(error.message, "danger");
            return;
        }
        await renderBoard();
    });

    row.append(input, submit);
    form.appendChild(row);
    parent.appendChild(form);
}

function renderComment(comment) {
    const profile = comment.profiles || {};
    const item = el("div", { class: "border-top py-2" });
    const header = el("div", { class: "d-flex align-items-center gap-2 mb-1" });

    if (profile.avatar_url) {
        header.appendChild(el("img", {
            class: "board-avatar",
            src: profile.avatar_url,
            alt: ""
        }));
    }
    header.appendChild(el("span", {
        class: "fw-semibold small",
        text: profile.display_name || "Paengclub member"
    }));
    header.appendChild(el("span", {
        class: "text-body-secondary board-muted",
        text: formatDate(comment.created_at)
    }));

    if (currentSession?.user?.id === comment.author_id) {
        header.appendChild(el("button", {
            class: "btn btn-link btn-sm text-danger ms-auto p-0",
            type: "button",
            text: "삭제",
            onclick: async () => {
                const { error } = await supabase.from("board_comments").delete().eq("id", comment.id);
                if (error) showBoardAlert(error.message, "danger");
                else await renderBoard();
            }
        }));
    }

    item.append(header, el("div", { class: "board-comment-body small", text: comment.body }));
    return item;
}

function renderPost(post) {
    const profile = post.profiles || {};
    const card = el("article", { class: "card shadow-sm mb-3" });
    const body = el("div", { class: "card-body" });
    const header = el("div", { class: "d-flex align-items-start gap-2 mb-2" });
    const titleWrap = el("div", { class: "flex-grow-1" });
    const actions = el("div", { class: "d-flex gap-2" });

    if (profile.avatar_url) {
        header.appendChild(el("img", {
            class: "board-avatar",
            src: profile.avatar_url,
            alt: ""
        }));
    }

    titleWrap.append(
        el("h5", { class: "card-title mb-1", text: post.title }),
        el("div", {
            class: "text-body-secondary board-muted",
            text: `${profile.display_name || "Paengclub member"} · ${formatDate(post.created_at)}`
        })
    );
    renderPostActions(post, actions);
    header.append(titleWrap, actions);

    body.append(
        header,
        el("div", { class: "board-post-body mb-3", text: post.body })
    );

    const comments = [...(post.board_comments || [])].sort((a, b) => {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const commentBox = el("div", { class: "mt-2" });
    if (comments.length > 0) {
        commentBox.appendChild(el("div", {
            class: "fw-semibold board-muted mb-1",
            text: `댓글 ${comments.length}`
        }));
        for (const comment of comments) commentBox.appendChild(renderComment(comment));
    }
    renderCommentForm(post, commentBox);
    body.appendChild(commentBox);

    card.appendChild(body);
    return card;
}

export async function renderBoard() {
    const root = screen();
    if (!root) return;
    root.replaceChildren();

    const wrapper = el("div", { class: "container board-shell mt-3" });
    wrapper.append(
        el("div", { id: "boardAlert" }),
        el("div", { class: "d-flex align-items-center justify-content-between board-toolbar mb-3" }, [
            el("div", {}, [
                el("h2", { class: "h4 mb-1", text: "게시판" }),
                el("div", { class: "text-body-secondary board-muted", text: "공지, 근황, 아무 말이나 남기는 Paengclub 피드" })
            ]),
            el("button", {
                class: "btn btn-outline-secondary btn-sm",
                type: "button",
                text: "새로고침",
                onclick: renderBoard
            })
        ])
    );

    if (currentSession) renderComposer(wrapper);
    else renderLoginPrompt(wrapper);

    const list = el("div", { id: "boardFeed" });
    list.appendChild(el("div", { class: "text-body-secondary py-4 text-center", text: "글을 불러오는 중..." }));
    wrapper.appendChild(list);
    root.appendChild(wrapper);

    try {
        const posts = await loadPosts();
        list.replaceChildren();
        if (posts.length === 0) {
            list.appendChild(el("div", {
                class: "board-empty p-4 text-center text-body-secondary",
                text: "아직 글이 없습니다. 첫 글을 남겨보세요."
            }));
            return;
        }
        for (const post of posts) list.appendChild(renderPost(post));
    } catch (error) {
        list.replaceChildren();
        showBoardAlert(error.message, "danger");
    }
}
