-- Per-game plausibility caps for game_scores, so obviously-impossible scores
-- (console tampering, keyboard auto-repeat on taprush, direct REST inserts)
-- can't reach the leaderboard. Cheated rows were deleted before this ran.
--
-- reaction: score = 1200 - ms, so ms >= 100 (human reaction floor) => score <= 1100.
-- taprush:  taps in 10s; >20/s is autoclicker / key auto-repeat => <= 200.
-- memory:   sequence length; <= 100 is far beyond human recall.
-- tetris:   generous marathon ceiling that still blocks the INT32-max exploit.
alter table public.game_scores
  add constraint game_scores_score_bounds check (
    (game_id = 'reaction' and score <= 1100) or
    (game_id = 'taprush'  and score <= 200)  or
    (game_id = 'memory'   and score <= 100)  or
    (game_id = 'tetris'   and score <= 2000000)
  );
