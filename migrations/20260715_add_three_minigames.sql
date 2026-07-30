-- New minigames: schulte (숫자 찾기, time-based like reaction), stroop (색깔 일치,
-- streak), rps (가위바위보, win-streak). Widen the game_id whitelist and the
-- per-game plausibility caps to match (see 20260712_game_score_bounds.sql).
alter table public.game_scores drop constraint game_scores_game_id_check;
alter table public.game_scores add constraint game_scores_game_id_check
    check (game_id = any (array['reaction','taprush','memory','tetris','schulte','stroop','rps']));

alter table public.game_scores drop constraint game_scores_score_bounds;
alter table public.game_scores add constraint game_scores_score_bounds check (
    (game_id = 'reaction' and score <= 1100) or
    (game_id = 'taprush'  and score <= 200)  or
    (game_id = 'memory'   and score <= 100)  or
    (game_id = 'tetris'   and score <= 2000000) or
    (game_id = 'schulte'  and score <= 60000) or
    (game_id = 'stroop'   and score <= 500) or
    (game_id = 'rps'      and score <= 200)
);

drop policy "anyone can submit valid game scores" on public.game_scores;
create policy "anyone can submit valid game scores"
    on public.game_scores for insert
    to anon, authenticated
    with check (
        game_id = any (array['reaction','taprush','memory','tetris','schulte','stroop','rps'])
        and score >= 0
        and char_length(trim(player_name)) >= 1
        and char_length(trim(player_name)) <= 24
        and (user_id is null or (select auth.uid()) = user_id)
    );
