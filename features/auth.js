// features/auth.js — the app's auth/session module + the profile-edit screen
// (avatar upload, nickname, mbti, bio). Owns Google sign-in and the current
// session; other tabs import getCurrentSession / getCurrentPlayerName /
// signInWithGoogle from here.
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

export async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }
    });
    if (error) console.error(error.message);
}

async function signOut() {
    await supabase.auth.signOut();
}

async function ensureProfile() {
    const user = currentSession?.user;
    if (!user) return;

    const { data: profile } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, nickname, bio, mbti")
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
        .select("id, display_name, avatar_url, nickname, bio, mbti")
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

export async function initAuth(onAuthChange) {
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

function normalizeMbti(value) {
    const trimmed = value.trim().toUpperCase();
    return /^[EI][NS][TF][JP]$/.test(trimmed) ? trimmed : "";
}

async function saveProfileDetails(fields) {
    const user = currentSession?.user;
    if (!user) return;

    const mbti = normalizeMbti(fields.mbti);
    if (fields.mbti.trim() && !mbti) {
        profileStatus("MBTI는 ENFP처럼 4글자로 입력해 주세요.", "danger");
        return;
    }

    const payload = {
        nickname: fields.nickname.trim().slice(0, 24) || null,
        bio: fields.bio.trim().slice(0, 140) || null,
        mbti: mbti || null,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
    if (error) {
        profileStatus(error.message, "danger");
        return;
    }

    currentProfile = { ...(currentProfile || { id: user.id, display_name: userName(user) }), ...payload };
    profileStatus("프로필을 저장했어요.", "success");
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

    const nicknameInput = el("input", {
        class: "form-control",
        maxlength: "24",
        placeholder: userName(user),
        value: currentProfile?.nickname || ""
    });
    const mbtiInput = el("input", {
        class: "form-control profile-mbti-input",
        maxlength: "4",
        placeholder: "ENFP",
        value: currentProfile?.mbti || ""
    });
    const bioInput = el("textarea", {
        class: "form-control",
        rows: "2",
        maxlength: "140",
        placeholder: "짧은 소개를 남겨보세요.",
        text: currentProfile?.bio || ""
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
                onclick: () => rerenderApp && rerenderApp()
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
                el("div", { class: "profile-detail-fields" }, [
                    el("label", { class: "pf-field" }, [el("span", { text: "별명" }), nicknameInput]),
                    el("label", { class: "pf-field" }, [el("span", { text: "MBTI" }), mbtiInput]),
                    el("label", { class: "pf-field" }, [el("span", { text: "소개" }), bioInput]),
                    el("button", {
                        class: "secondary-button",
                        type: "button",
                        text: "프로필 정보 저장",
                        onclick: () => saveProfileDetails({
                            nickname: nicknameInput.value,
                            mbti: mbtiInput.value,
                            bio: bioInput.value
                        })
                    })
                ]),
                el("div", { id: "profileStatus", class: "profile-status" })
            ])
        ])
    );

    wrapper.appendChild(panel);
    root.appendChild(wrapper);
}
