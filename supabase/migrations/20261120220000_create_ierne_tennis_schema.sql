-- Ierne Tennis: baseline schema.
-- Everything lives in schema ierne_tennis on the shared Apps project.
-- The schema is not exposed to PostgREST; the ierne-tennis-api Edge Function
-- connects directly with SUPABASE_DB_URL.
--
-- People are `players`. What plays a match is an `entrant`: one player
-- (singles) or a fixed pair (doubles). Bracket placeholders (wo:/lo:) and the
-- bye are also entrants so fixtures can reference them with a foreign key.

begin;

create schema if not exists ierne_tennis;

-- People -------------------------------------------------------------------

create table ierne_tennis.players (
  player_id text primary key,
  player_name text not null,
  gender text null check (gender in ('M', 'F')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_name_unique unique (player_name)
);

-- Entrants -----------------------------------------------------------------

create table ierne_tennis.entrants (
  entrant_id text primary key,
  kind text not null check (kind in ('single', 'pair', 'placeholder', 'bye')),
  player1_id text null references ierne_tennis.players (player_id) on update cascade on delete restrict,
  player2_id text null references ierne_tennis.players (player_id) on update cascade on delete restrict,
  label text null,
  created_at timestamptz not null default now(),
  constraint entrants_shape check (
    (kind = 'single' and player1_id is not null and player2_id is null)
    or (kind = 'pair' and player1_id is not null and player2_id is not null and player1_id < player2_id)
    or (kind in ('placeholder', 'bye') and player1_id is null and player2_id is null and label is not null)
  )
);

create unique index entrants_single_unique
  on ierne_tennis.entrants (player1_id) where kind = 'single';
create unique index entrants_pair_unique
  on ierne_tennis.entrants (player1_id, player2_id) where kind = 'pair';
create index idx_entrants_player2 on ierne_tennis.entrants (player2_id);

-- Display names are computed so renaming a player never leaves a stale name.
create view ierne_tennis.entrants_v as
  select e.entrant_id,
         e.kind,
         e.player1_id,
         e.player2_id,
         case
           when e.kind = 'single' then p1.player_name
           when e.kind = 'pair' then p1.player_name || ' / ' || p2.player_name
           else e.label
         end as entrant_name,
         case
           when e.kind = 'single' then p1.active
           when e.kind = 'pair' then (p1.active and p2.active)
           else false
         end as active
    from ierne_tennis.entrants e
    left join ierne_tennis.players p1 on p1.player_id = e.player1_id
    left join ierne_tennis.players p2 on p2.player_id = e.player2_id;

-- Competitions -------------------------------------------------------------

create table ierne_tennis.competitions (
  competition_id text primary key,
  name text not null,
  starts_on date null,
  ends_on date null,
  is_current boolean not null default false,
  competition_type text not null default 'league'
    check (competition_type in ('league', 'knockout', 'double-eliminator', 'ladder')),
  format text not null default 'singles'
    check (format in ('singles', 'doubles', 'mixed')),
  parent_competition_id text null
    references ierne_tennis.competitions (competition_id) on delete set null,
  -- Match format defaults, copied onto each fixture when it is created.
  sets_to_win smallint not null default 2 check (sets_to_win between 1 and 3),
  games_per_set smallint not null default 6 check (games_per_set in (4, 6, 8)),
  final_set text not null default 'match_tiebreak'
    check (final_set in ('full', 'match_tiebreak')),
  -- League points scheme.
  win_points smallint not null default 2 check (win_points between 0 and 10),
  loss_points smallint not null default 0 check (loss_points between 0 and 10),
  set_points smallint not null default 0 check (set_points between 0 and 10),
  loss_with_set_bonus smallint not null default 0 check (loss_with_set_bonus between 0 and 10),
  -- Ladder settings.
  ladder_challenge_range smallint not null default 3 check (ladder_challenge_range between 1 and 20),
  ladder_challenge_days smallint not null default 14 check (ladder_challenge_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ierne_tennis.competition_groups (
  competition_id text not null
    references ierne_tennis.competitions (competition_id) on delete cascade,
  group_id text not null,
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (competition_id, group_id)
);

create table ierne_tennis.competition_entrants (
  competition_id text not null
    references ierne_tennis.competitions (competition_id) on delete cascade,
  entrant_id text not null
    references ierne_tennis.entrants (entrant_id) on update cascade on delete restrict,
  group_id text not null,
  seed integer null,
  ladder_start_position integer null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (competition_id, entrant_id),
  constraint competition_entrants_group_fk foreign key (competition_id, group_id)
    references ierne_tennis.competition_groups (competition_id, group_id) on update cascade
);

create index idx_competition_entrants_group
  on ierne_tennis.competition_entrants (competition_id, group_id);

-- Fixtures -----------------------------------------------------------------
-- score_a / score_b hold SETS won, so "has a result" and "who won" work the
-- same way as the snooker app. set_scores holds the detail:
--   [{ "a": 6, "b": 4 }, { "a": 6, "b": 7, "tbA": 5, "tbB": 7 },
--    { "a": 1, "b": 0, "tbA": 10, "tbB": 8, "mtb": true }]

create table ierne_tennis.fixtures (
  fixture_id uuid primary key default gen_random_uuid(),
  competition_id text not null
    references ierne_tennis.competitions (competition_id) on update cascade,
  group_id text null,
  stage text not null default 'group' check (stage in ('group', 'knockout', 'ladder')),
  round_label text not null,
  round_name text null,
  side_a_id text not null
    references ierne_tennis.entrants (entrant_id) on update cascade,
  side_b_id text not null
    references ierne_tennis.entrants (entrant_id) on update cascade,
  match_date date null,
  sort_order integer not null default 0,
  sets_to_win smallint not null default 2 check (sets_to_win between 1 and 3),
  games_per_set smallint not null default 6 check (games_per_set in (4, 6, 8)),
  final_set text not null default 'match_tiebreak'
    check (final_set in ('full', 'match_tiebreak')),
  score_a smallint null,
  score_b smallint null,
  games_a smallint null,
  games_b smallint null,
  set_scores jsonb null,
  result_type text not null default 'normal'
    check (result_type in ('normal', 'retired', 'walkover', 'double_walkover')),
  result_entered_by text null,
  result_posted_at timestamptz null,
  result_approved boolean not null default true,
  result_approved_by text null,
  result_approved_at timestamptz null,
  result_slip_path text null,
  result_slip_mime text null,
  challenged_at timestamptz null,
  play_by date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixtures_group_required_when_group_stage
    check (stage <> 'group' or group_id is not null),
  constraint fixtures_sides_differ check (side_a_id <> side_b_id),
  constraint fixtures_unique_pairing
    unique (competition_id, stage, round_label, side_a_id, side_b_id)
);

create index idx_fixtures_comp on ierne_tennis.fixtures (competition_id);
create index idx_fixtures_comp_group on ierne_tennis.fixtures (competition_id, group_id);
create index idx_fixtures_side_a on ierne_tennis.fixtures (side_a_id);
create index idx_fixtures_side_b on ierne_tennis.fixtures (side_b_id);

comment on column ierne_tennis.fixtures.score_a is 'Sets won by side A.';
comment on column ierne_tennis.fixtures.games_a is 'Games won by side A; a match tiebreak counts as one game.';
comment on column ierne_tennis.fixtures.result_type is 'Reserved for retired / walkover results (later phase).';
comment on column ierne_tennis.fixtures.result_slip_path is
  'Storage object path in bucket ierne-tennis-result-slips (committed slip only).';

-- Accounts -----------------------------------------------------------------

create table ierne_tennis.accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  password_hash text not null,
  player_id text not null,
  invite_id uuid null,
  is_admin boolean not null default false,
  is_approver boolean not null default false,
  disabled_at timestamptz null,
  last_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_handle_unique unique (handle),
  constraint accounts_player_unique unique (player_id),
  constraint accounts_handle_format check (handle ~ '^[a-z0-9]{3,20}$'),
  constraint accounts_player_fk foreign key (player_id)
    references ierne_tennis.players (player_id) on update cascade on delete cascade
);

create table ierne_tennis.invites (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('register', 'reset')),
  code_hash text not null unique,
  label text null,
  account_id uuid null references ierne_tennis.accounts (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table ierne_tennis.accounts
  add constraint accounts_invite_fk
  foreign key (invite_id) references ierne_tennis.invites (id) on delete set null;

create table ierne_tennis.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references ierne_tennis.accounts (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index idx_invites_pending on ierne_tennis.invites (expires_at) where used_at is null;
create index idx_sessions_account on ierne_tennis.sessions (account_id);

-- Standings views ----------------------------------------------------------

create view ierne_tennis.fixture_results_v as
  select f.competition_id, f.group_id, f.fixture_id,
         f.side_a_id as entrant_id, f.side_b_id as opponent_id,
         f.score_a as sets_for, f.score_b as sets_against,
         coalesce(f.games_a, 0) as games_for, coalesce(f.games_b, 0) as games_against
    from ierne_tennis.fixtures f
   where f.stage = 'group' and f.score_a is not null and f.score_b is not null
  union all
  select f.competition_id, f.group_id, f.fixture_id,
         f.side_b_id, f.side_a_id,
         f.score_b, f.score_a,
         coalesce(f.games_b, 0), coalesce(f.games_a, 0)
    from ierne_tennis.fixtures f
   where f.stage = 'group' and f.score_a is not null and f.score_b is not null;

create view ierne_tennis.league_standings_v as
  select r.competition_id, r.group_id, r.entrant_id,
         count(*) as played,
         count(*) filter (where r.sets_for > r.sets_against) as won,
         count(*) filter (where r.sets_for < r.sets_against) as lost,
         sum(r.sets_for) - sum(r.sets_against) as set_diff,
         sum(r.games_for) - sum(r.games_against) as game_diff,
         sum(
           case when r.sets_for > r.sets_against then c.win_points
                else c.loss_points + case when r.sets_for > 0 then c.loss_with_set_bonus else 0 end
           end
           + r.sets_for * c.set_points
         ) as points
    from ierne_tennis.fixture_results_v r
    join ierne_tennis.competitions c on c.competition_id = r.competition_id
   group by r.competition_id, r.group_id, r.entrant_id;

create view ierne_tennis.head_to_head_v as
  select r.competition_id, r.group_id, r.entrant_id, r.opponent_id,
         count(*) as played,
         sum(r.sets_for) - sum(r.sets_against) as h2h_set_diff,
         sum(r.games_for) - sum(r.games_against) as h2h_game_diff,
         sum(
           case when r.sets_for > r.sets_against then c.win_points
                else c.loss_points + case when r.sets_for > 0 then c.loss_with_set_bonus else 0 end
           end
           + r.sets_for * c.set_points
         ) as h2h_points
    from ierne_tennis.fixture_results_v r
    join ierne_tennis.competitions c on c.competition_id = r.competition_id
   group by r.competition_id, r.group_id, r.entrant_id, r.opponent_id;

-- Lock down: RLS on, no policies; the Edge Function uses a direct connection.

alter table ierne_tennis.players enable row level security;
alter table ierne_tennis.entrants enable row level security;
alter table ierne_tennis.competitions enable row level security;
alter table ierne_tennis.competition_groups enable row level security;
alter table ierne_tennis.competition_entrants enable row level security;
alter table ierne_tennis.fixtures enable row level security;
alter table ierne_tennis.accounts enable row level security;
alter table ierne_tennis.invites enable row level security;
alter table ierne_tennis.sessions enable row level security;

revoke all on schema ierne_tennis from anon, authenticated;

-- Private bucket for result-slip photos (signed URLs only).
insert into storage.buckets (id, name, public)
values ('ierne-tennis-result-slips', 'ierne-tennis-result-slips', false)
on conflict (id) do update set public = excluded.public;

commit;
