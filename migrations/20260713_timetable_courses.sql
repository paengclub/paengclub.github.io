-- Weekly class schedule for the new 시간표 tab (features/timetable.js).
-- Public read (schedules are meant to be shared, like the pixel board/tier
-- list); writes restricted to the owning user (like portfolio_*).
create table public.timetable_courses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name text not null check (char_length(trim(name)) between 1 and 60),
    professor text not null default '' check (char_length(professor) <= 40),
    location text not null default '' check (char_length(location) <= 40),
    day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Mon .. 6=Sun
    start_minute integer not null check (start_minute >= 0 and start_minute < 1440),
    end_minute integer not null check (end_minute > start_minute and end_minute <= 1440),
    color text not null default '#3b82f6' check (char_length(color) <= 24),
    memo text not null default '' check (char_length(memo) <= 100),
    created_at timestamptz not null default now()
);

create index timetable_courses_user_idx on public.timetable_courses (user_id);

alter table public.timetable_courses enable row level security;

create policy "timetable courses are visible to everyone"
    on public.timetable_courses for select
    to public
    using (true);

create policy "users can add their own courses"
    on public.timetable_courses for insert
    to authenticated
    with check (user_id = (select auth.uid()));

create policy "users can update their own courses"
    on public.timetable_courses for update
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "users can delete their own courses"
    on public.timetable_courses for delete
    to authenticated
    using (user_id = (select auth.uid()));
