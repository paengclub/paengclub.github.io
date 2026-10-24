-- 게임 티어: let logged-in members rename, re-image and delete games.
--
-- Guests keep exactly what they had — add a game, drag it between tiers —
-- but editing and deleting need an account: a delete can't be undone, and an
-- open delete would let anyone empty the shared board.

create policy "members can delete games"
    on public.tier_games for delete
    to authenticated
    using (true);

-- The existing "anyone can move a game" UPDATE policy lets anon update any
-- column, including name and image_url. RLS can't restrict columns, so narrow
-- anon with column privileges to what a move writes. Members keep full UPDATE.
revoke update on public.tier_games from anon;
grant update (tier, position) on public.tier_games to anon;

-- Members can remove an image when its game is deleted or its image replaced,
-- so storage doesn't fill with orphans.
create policy "members can delete tier game images"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'tier-games');
