create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day date not null,
  state text not null default 'draft' check (state in ('draft','published','archived')),
  revision integer not null default 1,
  configuration_version integer not null default 1,
  released integer not null default 0,
  updated_at timestamptz not null default now()
);
create table public.tournament_roles (
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role = 'admin'),
  primary key (tournament_id, user_id)
);
create table public.tournament_configurations (
  tournament_id uuid not null references public.tournaments on delete cascade,
  version integer not null,
  configuration jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, version)
);
create table public.teams (
  tournament_id uuid not null references public.tournaments on delete cascade,
  id text not null,
  name text not null,
  primary key (tournament_id, id)
);
create table public.courts (
  tournament_id uuid not null references public.tournaments on delete cascade,
  id text not null,
  name text not null,
  primary key (tournament_id, id)
);
create table public.stages (
  tournament_id uuid not null references public.tournaments on delete cascade,
  id text not null,
  name text not null,
  ordinal integer not null,
  primary key (tournament_id, id),
  unique (tournament_id, ordinal)
);
create table public.groups (
  tournament_id uuid not null references public.tournaments on delete cascade,
  id text not null,
  stage_id text not null,
  name text not null,
  primary key (tournament_id, id),
  unique (tournament_id, id, stage_id),
  foreign key (tournament_id, stage_id) references public.stages on delete cascade
);
create table public.stage_entries (
  tournament_id uuid not null,
  stage_id text not null,
  group_id text not null,
  seed text not null,
  team_id text,
  source_group text,
  source_rank integer,
  primary key (tournament_id, stage_id, seed),
  foreign key (tournament_id, group_id, stage_id) references public.groups (tournament_id,id,stage_id) on delete cascade,
  foreign key (tournament_id, team_id) references public.teams,
  foreign key (tournament_id, source_group) references public.groups,
  check ((team_id is not null and source_group is null and source_rank is null) or
         (team_id is null and source_group is not null and source_rank > 0))
);
create table public.slots (
  tournament_id uuid not null,
  stage_id text not null,
  id integer not null check (id > 0),
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min > start_min and end_min <= 1439),
  primary key (tournament_id, id),
  unique (tournament_id, id, stage_id),
  unique (tournament_id, start_min),
  foreign key (tournament_id, stage_id) references public.stages on delete cascade
);
create table public.matches (
  tournament_id uuid not null,
  id integer not null check (id > 0),
  stage_id text not null,
  group_id text,
  court_id text not null,
  slot_id integer not null,
  round integer not null check (round > 0),
  version integer not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled','running','submitted','confirmed','corrected')),
  started timestamptz,
  paused timestamptz,
  paused_ms bigint not null default 0,
  regular_ended timestamptz,
  ended timestamptz,
  extra boolean not null default false,
  live_a integer check (live_a between 0 and 999),
  live_b integer check (live_b between 0 and 999),
  primary key (tournament_id, id),
  unique (tournament_id, id, slot_id, stage_id),
  unique (tournament_id, slot_id, court_id),
  foreign key (tournament_id, slot_id, stage_id) references public.slots (tournament_id,id,stage_id) on delete cascade,
  foreign key (tournament_id, court_id) references public.courts,
  foreign key (tournament_id, group_id, stage_id) references public.groups (tournament_id,id,stage_id)
);
-- Eine Belegungstabelle erzwingt auch teamübergreifend Spielen/Pfeifen ohne Kollision.
create table public.match_assignments (
  tournament_id uuid not null,
  match_id integer not null,
  slot_id integer not null,
  stage_id text not null,
  seed text not null,
  position text not null check (position in ('a','b','referee')),
  primary key (tournament_id, match_id, position),
  unique (tournament_id, slot_id, seed),
  foreign key (tournament_id, match_id, slot_id, stage_id) references public.matches (tournament_id,id,slot_id,stage_id) on delete cascade,
  foreign key (tournament_id, stage_id, seed) references public.stage_entries
);
create view public.referee_assignments with (security_invoker=true) as
  select * from public.match_assignments where position = 'referee';
create table public.carry_over (
  tournament_id uuid not null,
  group_id text not null,
  source_group text not null,
  a text not null,
  b text not null,
  primary key (tournament_id, group_id, a, b),
  foreign key (tournament_id, group_id) references public.groups on delete cascade,
  foreign key (tournament_id, source_group) references public.groups on delete cascade,
  check (a < b)
);
create table public.results (
  tournament_id uuid not null,
  match_id integer not null,
  score_a integer not null check (score_a between 0 and 999),
  score_b integer not null check (score_b between 0 and 999),
  updated_at timestamptz not null,
  primary key (tournament_id, match_id),
  foreign key (tournament_id, match_id) references public.matches on delete cascade
);
create table public.result_submissions (
  tournament_id uuid not null,
  match_id integer not null,
  version integer not null,
  user_id uuid references auth.users on delete set null,
  score_a integer not null check (score_a between 0 and 999),
  score_b integer not null check (score_b between 0 and 999),
  submitted_at timestamptz not null,
  primary key (tournament_id, match_id, version),
  foreign key (tournament_id, match_id) references public.matches on delete cascade
);
create table public.referee_invites (
  token_hash bytea primary key,
  tournament_id uuid not null,
  match_id integer not null,
  pin_hash text not null,
  expires timestamptz not null,
  failures integer not null default 0,
  foreign key (tournament_id, match_id) references public.matches on delete cascade
);
create table public.referee_access (
  tournament_id uuid not null,
  match_id integer not null,
  user_id uuid not null references auth.users on delete cascade,
  expires timestamptz not null,
  primary key (tournament_id, match_id, user_id),
  foreign key (tournament_id, match_id) references public.matches on delete cascade
);
create table public.audit_logs (
  tournament_id uuid not null references public.tournaments on delete cascade,
  request_id uuid not null default gen_random_uuid(),
  actor uuid references auth.users on delete set null,
  action text not null,
  match_id integer,
  payload jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  primary key (tournament_id, request_id)
);

create function public.cup_is_admin(t uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.tournament_roles where tournament_id=t and user_id=auth.uid() and role='admin') $$;

do $$
declare tab text;
begin
  foreach tab in array array['tournaments','tournament_roles','tournament_configurations','teams','courts','stages','groups','stage_entries','slots','matches','match_assignments','carry_over','results','result_submissions','referee_invites','referee_access','audit_logs'] loop
    execute format('alter table public.%I enable row level security', tab);
    execute format('revoke all on public.%I from public, anon, authenticated', tab);
  end loop;
end $$;
revoke all on public.referee_assignments from public, anon, authenticated;
grant select on public.tournaments to anon, authenticated;
create policy tournament_read on public.tournaments for select using (state in ('published','archived') or public.cup_is_admin(id));
alter publication supabase_realtime add table public.tournaments;
