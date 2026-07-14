-- Adds directory fields to profiles for the new 프로필 tab (features/profiles.js).
-- Existing "users can update their own profile" policy is not column-restricted,
-- so no RLS changes are needed for these.
alter table public.profiles
    add column if not exists nickname text,
    add column if not exists bio text,
    add column if not exists mbti text;

alter table public.profiles
    add constraint profiles_nickname_len check (nickname is null or char_length(nickname) <= 24);
alter table public.profiles
    add constraint profiles_bio_len check (bio is null or char_length(bio) <= 140);
alter table public.profiles
    add constraint profiles_mbti_format check (mbti is null or mbti ~ '^[EIei][NSns][TFtf][JPjp]$');
