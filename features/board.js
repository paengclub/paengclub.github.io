// features/board.js — 게시판 (posts + comments) AND the app's auth/session
// module. Owns Google sign-in and the current session; other tabs import
// getCurrentSession / getCurrentPlayerName / signInWithGoogle from here.
import { supabase } from "/supabaseClient.js";
import { el } from "/lib/dom.js";

let currentSession = null;
let rerenderApp = null;
let currentProfile = null;

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

function googleAvatar(user) {
    return user?.user_metadata?.avatar_url || "";
}

function userAvatar(user) {
    return currentProfile?.avatar_url || googleAvatar(user);
}

function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value));
}

export async function signInWithGoogle() {
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

    const { data: profile } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

    if (profile) {
        const nextProfile = {
            ...profile,
            display_name: userName(user),
            avatar_url: profile.avatar_url || googleAvatar(user)
        };
        await supabase
            .from("profiles")
            .update({
                display_name: nextProfile.display_name,
                avatar_url: nextProfile.avatar_url,
                updated_at: new Date().toISOString()
            })
            .eq("id", user.id);
        currentProfile = nextProfile;
        return;
    }

    const { data: inserted } = await supabase
        .from("profiles")
        .insert({
            id: user.id,
            display_name: userName(user),
            avatar_url: googleAvatar(user)
        })
        .select("id, display_name, avatar_url")
        .single();

    currentProfile = inserted || {
        id: user.id,
        display_name: userName(user),
        avatar_url: googleAvatar(user)
    };
}

function renderAuthArea() {
    const area = authArea();
    if (!area) return;
    area.replaceChildren();

    if (!currentSession) {
        area.appendChild(el("button", {
            class: "auth-button",
            type: "button",
            text: "로그인",
            onclick: signInWithGoogle
        }));
        return;
    }

    const user = currentSession.user;
    const avatar = userAvatar(user);
    const avatarButton = el("button", {
        class: "avatar-button",
        type: "button",
        "aria-label": "프로필",
        title: "프로필",
        onclick: renderProfile
    }, avatar ? [
        el("img", {
            class: "avatar",
            src: avatar,
            alt: ""
        })
    ] : [
        el("span", { class: "avatar avatar-fallback", text: userName(user).slice(0, 1).toUpperCase() })
    ]);
    area.appendChild(avatarButton);

    area.appendChild(el("button", {
        class: "auth-button secondary",
        type: "button",
        text: "로그아웃",
        onclick: signOut
    }));
}

export async function initBoardAuth(onAuthChange) {
    rerenderApp = onAuthChange;
    const { data } = await supabase.auth.getSession();
    currentSession = data.session;
    renderAuthArea();
    // Enrich the profile (avatar / display name) in the background so it never
    // delays the first paint; only the auth-area avatar refreshes when it lands.
    if (currentSession) ensureProfile().then(renderAuthArea);

    let lastUserId = currentSession?.user?.id || null;
    supabase.auth.onAuthStateChange(async (_event, session) => {
        const nextUserId = session?.user?.id || null;
        currentSession = session;
        // Ignore the initial-session replay and periodic token refreshes; only
        // re-render when the signed-in user actually changes (sign in / out).
        if (nextUserId === lastUserId) return;
        lastUserId = nextUserId;
        currentProfile = null;
        if (currentSession) await ensureProfile();
        renderAuthArea();
        if (rerenderApp) rerenderApp();
    });
}

export function getCurrentSession() {
    return currentSession;
}

export function getCurrentPlayerName() {
    return currentSession ? userName(currentSession.user) : "";
}

function profileStatus(message, type = "") {
    const status = document.getElementById("profileStatus");
    if (!status) return;
    status.className = `profile-status ${type}`;
    status.textContent = message;
}

function avatarExtension(file) {
    const fallback = file.type === "image/png" ? "png" : "jpg";
    return file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
}

async function updateProfileAvatar(avatarUrl) {
    const user = currentSession?.user;
    if (!user) return;

    const { error } = await supabase
        .from("profiles")
        .update({
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString()
        })
        .eq("id", user.id);

    if (error) throw error;
    currentProfile = {
        ...(currentProfile || { id: user.id, display_name: userName(user) }),
        avatar_url: avatarUrl
    };
    renderAuthArea();
}

async function uploadAvatar(file) {
    const user = currentSession?.user;
    if (!user) return;
    if (!file) {
        profileStatus("이미지를 선택해 주세요.", "danger");
        return;
    }
    if (!file.type.startsWith("image/")) {
        profileStatus("이미지 파일만 올릴 수 있어요.", "danger");
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        profileStatus("2MB 이하 이미지로 올려 주세요.", "danger");
        return;
    }

    profileStatus("업로드 중...");
    const path = `${user.id}/avatar-${Date.now()}.${avatarExtension(file)}`;
    const { error } = await supabase.storage
        .from("avatars")
        .upload(path, file, {
            cacheControl: "3600",
            upsert: true
        });

    if (error) {
        profileStatus(error.message, "danger");
        return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await updateProfileAvatar(data.publicUrl);
    renderProfile();
    profileStatus("프로필 사진을 바꿨어요.", "success");
}

export function renderProfile() {
    const root = screen();
    const user = currentSession?.user;
    if (!root || !user) return;
    root.replaceChildren();

    const avatar = userAvatar(user);
    const fileInput = el("input", {
        class: "form-control",
        type: "file",
        accept: "image/png,image/jpeg,image/webp,image/gif"
    });

    const preview = avatar ? el("img", {
        class: "profile-avatar-preview",
        src: avatar,
        alt: ""
    }) : el("div", {
        class: "profile-avatar-preview avatar-fallback",
        text: userName(user).slice(0, 1).toUpperCase()
    });

    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        preview.src = URL.createObjectURL(file);
    });

    const wrapper = el("section", { class: "page-shell profile-shell" });
    const panel = el("div", { class: "app-panel profile-panel" });

    panel.append(
        el("div", { class: "section-header" }, [
            el("div", {}, [
                el("h1", { class: "section-title", text: "프로필" }),
                el("div", { class: "muted-text", text: userName(user) })
            ]),
            el("button", {
                class: "secondary-button compact",
                type: "button",
                text: "닫기",
                onclick: () => {
                    if (rerenderApp) rerenderApp();
                    else renderBoard();
                }
            })
        ]),
        el("div", { class: "profile-content" }, [
            el("div", { class: "profile-preview" }, [preview]),
            el("div", { class: "profile-controls" }, [
                fileInput,
                el("div", { class: "profile-actions" }, [
                    el("button", {
                        class: "primary-button",
                        type: "button",
                        text: "업로드",
                        onclick: () => uploadAvatar(fileInput.files?.[0])
                    }),
                    el("button", {
                        class: "secondary-button",
                        type: "button",
                        text: "Google 사진으로 되돌리기",
                        onclick: async () => {
                            try {
                                await updateProfileAvatar(googleAvatar(user));
                                renderProfile();
                                profileStatus("Google 프로필 사진으로 되돌렸어요.", "success");
                            } catch (error) {
                                profileStatus(error.message, "danger");
                            }
                        }
                    })
                ]),
                el("div", { id: "profileStatus", class: "profile-status" })
            ])
        ])
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);
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
    const prompt = el("div", { class: "board-login-bar mb-3" }, [
        el("button", {
            class: "primary-button compact",
            type: "button",
            text: "Google 로그인",
            onclick: signInWithGoogle
        })
    ]);
    parent.appendChild(prompt);
}

function renderComposer(parent) {
    const form = el("form", { class: "composer" });
    const body = el("div", { class: "composer-body" });
    const titleInput = el("input", {
        class: "form-control",
        name: "title",
        maxlength: "120",
        required: "",
        placeholder: "제목"
    });
    const bodyInput = el("textarea", {
        class: "form-control",
        name: "body",
        rows: "4",
        maxlength: "5000",
        required: "",
        placeholder: "내용"
    });
    const submit = el("button", {
        class: "primary-button",
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

    body.append(titleInput, bodyInput, el("div", { class: "composer-actions" }, [submit]));
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
        class: "text-action danger",
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

    const form = el("form", { class: "comment-form" });
    const row = el("div", { class: "comment-input-row" });
    const input = el("input", {
        class: "form-control",
        maxlength: "1000",
        required: "",
        placeholder: "댓글 쓰기"
    });
    const submit = el("button", {
        class: "secondary-button",
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
    const item = el("div", { class: "comment-item" });
    const header = el("div", { class: "comment-meta" });

    if (profile.avatar_url) {
        header.appendChild(el("img", {
            class: "avatar small",
            src: profile.avatar_url,
            alt: ""
        }));
    }
    header.appendChild(el("span", {
        class: "comment-author",
        text: profile.display_name || "Paengclub member"
    }));
    header.appendChild(el("span", {
        class: "muted-text",
        text: formatDate(comment.created_at)
    }));

    if (currentSession?.user?.id === comment.author_id) {
        header.appendChild(el("button", {
            class: "text-action danger ms-auto",
            type: "button",
            text: "삭제",
            onclick: async () => {
                const { error } = await supabase.from("board_comments").delete().eq("id", comment.id);
                if (error) showBoardAlert(error.message, "danger");
                else await renderBoard();
            }
        }));
    }

    item.append(header, el("div", { class: "board-comment-body", text: comment.body }));
    return item;
}

function renderPost(post) {
    const profile = post.profiles || {};
    const card = el("article", { class: "post-card" });
    const body = el("div", { class: "post-body" });
    const header = el("div", { class: "post-header" });
    const titleWrap = el("div", { class: "post-title-wrap" });
    const actions = el("div", { class: "post-actions" });

    if (profile.avatar_url) {
        header.appendChild(el("img", {
            class: "avatar",
            src: profile.avatar_url,
            alt: ""
        }));
    }

    titleWrap.append(
        el("h2", { class: "post-title", text: post.title }),
        el("div", {
            class: "post-meta",
            text: `${profile.display_name || "Paengclub member"} · ${formatDate(post.created_at)}`
        })
    );
    renderPostActions(post, actions);
    header.append(titleWrap, actions);

    body.append(
        header,
        el("div", { class: "board-post-body", text: post.body })
    );

    const comments = [...(post.board_comments || [])].sort((a, b) => {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    const commentBox = el("div", { class: "comment-box" });
    if (comments.length > 0) {
        commentBox.appendChild(el("div", {
            class: "comment-count",
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

    const wrapper = el("section", { class: "page-shell board-shell" });
    const panel = el("div", { class: "app-panel board-panel" });
    wrapper.append(
        panel
    );
    panel.append(
        el("div", { id: "boardAlert" }),
        el("div", { class: "section-header board-toolbar" }, [
            el("div", {}, [
                el("h1", { class: "section-title", text: "게시판" })
            ]),
            el("button", {
                class: "secondary-button compact",
                type: "button",
                text: "새로고침",
                onclick: renderBoard
            })
        ])
    );

    if (currentSession) renderComposer(panel);
    else renderLoginPrompt(panel);

    const list = el("div", { id: "boardFeed" });
    list.appendChild(el("div", { class: "text-body-secondary py-4 text-center", text: "글을 불러오는 중..." }));
    panel.appendChild(list);
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
