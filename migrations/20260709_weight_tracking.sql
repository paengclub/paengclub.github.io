create table if not exists public.weight_people (
  id text primary key,
  name text not null check (char_length(trim(name)) >= 1 and char_length(trim(name)) <= 40),
  goal text not null default 'loss' check (goal in ('loss', 'gain', 'maintain')),
  color text not null default '#2f7dd3' check (char_length(color) <= 24),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.weight_records (
  id uuid primary key default gen_random_uuid(),
  person_id text not null references public.weight_people(id) on delete cascade,
  record_date date not null,
  weight double precision not null check (weight > 0 and weight < 300),
  memo text not null default '' check (char_length(memo) <= 300),
  created_at timestamptz not null default now(),
  unique (person_id, record_date)
);

alter table public.weight_people enable row level security;
alter table public.weight_records enable row level security;

drop policy if exists "weight people are publicly readable" on public.weight_people;
create policy "weight people are publicly readable"
on public.weight_people for select
to anon, authenticated
using (true);

drop policy if exists "weight records are publicly readable" on public.weight_records;
create policy "weight records are publicly readable"
on public.weight_records for select
to anon, authenticated
using (true);

insert into public.weight_people (id, name, goal, color, sort_order) values
  ('paeng', 'paeng', 'loss', '#2f7dd3', 0),
  ('okh', 'okh', 'gain', '#d16a45', 1)
on conflict (id) do update set
  name = excluded.name,
  goal = excluded.goal,
  color = excluded.color,
  sort_order = excluded.sort_order;

insert into public.weight_records (person_id, record_date, weight) values
  ('paeng', '2024-08-07', 67.4),
  ('paeng', '2024-11-15', 68.5),
  ('paeng', '2025-06-13', 65.2),
  ('paeng', '2026-01-12', 73.4),
  ('paeng', '2026-04-26', 70.6),
  ('paeng', '2026-05-12', 70.1),
  ('paeng', '2026-05-16', 70.3),
  ('paeng', '2026-05-28', 69.6),
  ('paeng', '2026-05-29', 69.7),
  ('paeng', '2026-06-01', 70.3),
  ('paeng', '2026-06-05', 69.5),
  ('paeng', '2026-06-10', 70.1),
  ('paeng', '2026-06-11', 70.3),
  ('paeng', '2026-06-14', 70.4),
  ('paeng', '2026-06-22', 70.0),
  ('paeng', '2026-06-27', 70.1),
  ('paeng', '2026-06-30', 69.7),
  ('paeng', '2026-07-01', 69.2),
  ('paeng', '2026-07-04', 70.7),
  ('paeng', '2026-07-05', 69.9),
  ('paeng', '2026-07-06', 69.6),
  ('paeng', '2026-07-08', 69.2),
  ('okh', '2024-08-07', 59.0),
  ('okh', '2024-11-15', 61.0),
  ('okh', '2025-06-13', 61.5),
  ('okh', '2026-01-12', 66.0),
  ('okh', '2026-04-26', 66.5),
  ('okh', '2026-05-12', 67.6),
  ('okh', '2026-05-16', 66.8),
  ('okh', '2026-05-28', 66.2),
  ('okh', '2026-05-29', 67.2),
  ('okh', '2026-06-01', 66.4),
  ('okh', '2026-06-05', 66.7),
  ('okh', '2026-06-10', 66.5),
  ('okh', '2026-06-13', 66.2),
  ('okh', '2026-06-18', 67.3),
  ('okh', '2026-06-25', 66.1),
  ('okh', '2026-06-28', 66.0),
  ('okh', '2026-06-30', 66.6),
  ('okh', '2026-07-04', 65.8),
  ('okh', '2026-07-06', 64.5)
on conflict (person_id, record_date) do update set
  weight = excluded.weight;
