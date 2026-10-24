-- Overwatch added an Emerald rank in Season 4, between Platinum and Diamond,
-- with the usual divisions 5..1. Widen the tier CHECK to accept it; nothing
-- else changes (division/progress rules already apply to every non-Top 500
-- tier). Matching entry: GAMES.overwatch.tiers in features/ranks.js.
alter table public.game_rank_records drop constraint game_rank_records_tier_check;

alter table public.game_rank_records add constraint game_rank_records_tier_check check (tier in (
    'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond',
    'master', 'grandmaster', 'champion', 'top500'
));
