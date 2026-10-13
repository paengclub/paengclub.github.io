-- Personal competitive-rank tracker for the 랭크 tab (features/ranks.js).
--
-- A user tracks one or more accounts per game (main + alts). Visibility is per
-- account, so an alt can stay private while the main is shared. Records hang
-- off an account; a record's rank is role + tier + division + optional
-- progress %, because that is how Overwatch reports rank (one rank per role,
-- e.g. "Diamond 2, 45%").
--
-- The tables are game-agnostic in shape. The CHECK constraints below encode
-- Overwatch's values, since it is the only supported game: adding a game means
-- widening these checks in a new migration, alongside its entry in GAMES in
-- features/ranks.js.

create table public.game_accounts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    game text not null check (game in ('overwatch')),
    name text not null check (char_length(trim(name)) between 1 and 40),
    is_public boolean not null default true,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create index game_accounts_user_idx on public.game_accounts (user_id, game, sort_order);

create table public.game_rank_records (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references public.game_accounts(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    role text not null check (role in ('tank', 'damage', 'support', 'open')),
    tier text not null check (tier in (
        'bronze', 'silver', 'gold', 'platinum', 'diamond',
        'master', 'grandmaster', 'champion', 'top500'
    )),
    division smallint check (division between 1 and 5),
    -- progress toward the next division, as shown in game; optional because
    -- most updates are just "moved a division"
    progress smallint check (progress between 0 and 100),
    recorded_on date not null default current_date,
    created_at timestamptz not null default now(),
    -- Top 500 is a leaderboard placement, not a tier with divisions or progress
    check ((tier = 'top500') = (division is null)),
    check (tier <> 'top500' or progress is null)
);

create index game_rank_records_account_idx
    on public.game_rank_records (account_id, role, recorded_on, created_at);

alter table public.game_accounts enable row level security;
alter table public.game_rank_records enable row level security;

-- accounts: public ones are visible to everyone, private ones only to owner
create policy "public accounts and your own are visible"
    on public.game_accounts for select
    to public
    using (is_public or user_id = (select auth.uid()));

create policy "users can add their own accounts"
    on public.game_accounts for insert
    to authenticated
    with check (user_id = (select auth.uid()));

create policy "users can update their own accounts"
    on public.game_accounts for update
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "users can delete their own accounts"
    on public.game_accounts for delete
    to authenticated
    using (user_id = (select auth.uid()));

-- records inherit their account's visibility, so making an account private
-- hides its whole history too
create policy "records of visible accounts are visible"
    on public.game_rank_records for select
    to public
    using (exists (
        select 1 from public.game_accounts a
        where a.id = account_id
          and (a.is_public or a.user_id = (select auth.uid()))
    ));

-- a record may only be filed under an account you own
create policy "users can add records to their own accounts"
    on public.game_rank_records for insert
    to authenticated
    with check (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.game_accounts a
            where a.id = account_id and a.user_id = (select auth.uid())
        )
    );

create policy "users can update their own records"
    on public.game_rank_records for update
    to authenticated
    using (user_id = (select auth.uid()))
    with check (
        user_id = (select auth.uid())
        and exists (
            select 1 from public.game_accounts a
            where a.id = account_id and a.user_id = (select auth.uid())
        )
    );

create policy "users can delete their own records"
    on public.game_rank_records for delete
    to authenticated
    using (user_id = (select auth.uid()));
