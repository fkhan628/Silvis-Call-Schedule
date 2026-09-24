-- ============================================================================
-- Silvis Surgical Care Call Schedule — Supabase schema + RLS
-- Project: https://bzhsroegtagqhutbnsrp.supabase.co
-- Paste into the SQL editor once. Re-runnable (IF NOT EXISTS / OR REPLACE) - but re-runnable only when every applied
-- migration has been mirrored below (test/schema.test.js fails closed when a landed body is not); see the Revision lines.
-- Design notes: mirrors the Davenport app's data layer but keyed by DAY.
-- The anon key is public; every table below is either anon-READABLE by design
-- (schedule, roster/config, time off, availability, east feed, versions) or
-- locked to authenticated users with role checks. The service-role key is
-- server-side only and never appears in client code.
-- CONTACT DATA: never in anon-readable tables and never in this file. Emails live
-- only in user_profiles (via Auth signup) and office_contacts (entered in Setup).
-- Revision 2026-09-22 (Prompt 2 review, docs/SCHEMA-REVIEW.md): user_profiles auto-created
-- from auth.users; person_id pinned against self-service; day-before check in the
-- time_off trigger (primary only); trade status transitions guarded; distinct-roles
-- check; snapshot source_updated_at; availability idempotency index; client heartbeat.
-- Revision 2026-09-22 b (Prompt 12 D, sql/migrations/2026-09-22-trade-guards.sql): BEFORE INSERT guard
-- on shift_trade_requests; apply_trade() checks roster / vacation / lock / other-role eligibility.
-- Revision 2026-09-22 c (Prompt 13 part 2, sql/migrations/2026-09-22-claim-open-slot.sql): claim_open_slot()
-- lets a linked surgeon take an OPEN slot (security definer; nine CL0xx refusals; audit + feed rows).
-- Revision 2026-09-23 d (Prompt 15 part 2, sql/migrations/2026-09-23-east-vacation-reviews.sql): east_vacation_reviews -
-- the away/home decision per mirrored Davenport vacation range (authenticated-read; own rows or scheduler write).
-- Revision 2026-09-23 e (audit RLS-6, sql/migrations/2026-09-23-trade-past-guard.sql): TRADE_PAST - a non-scheduler may
-- not apply, or accept, a trade whose day or return day is before today in America/Chicago (strict <, like CL003).
-- Revision 2026-09-23 f (Prompt 14 part 1, sql/migrations/2026-09-22-offers-periods.sql, applied by hand 9/22 15:15):
-- call_offers + call_periods, offer_status(), guards OF001/OF002/OF003, authenticated-only RLS (never anon).
-- Revision 2026-09-23 g (sql/migrations/2026-09-23-offer-modes.sql): call_periods.offer_modes jsonb
-- {person_id: 'exhaustive' | 'preferred'}; absent = 'preferred' (Faraz 9/22 evening).
-- Revision 2026-09-23 h (Prompt 14 part 2c, sql/migrations/2026-09-23-claim-offer.sql, applied live 9/23 07:05Z): a claim is
-- an offer made on the spot - claim_open_slot() upserts the claimer's call_offers row (none for a rules_only claimer; the
-- audit detail carries offer true/false) and call_offers_guard() skips OFFER_FROZEN while silvis.claim_in_progress is on.
-- The 2026-09-22 claim-open-slot migration stays frozen as applied; test/schema.test.js mirrors both bodies from this file.
-- Revision 2026-09-23 i (Prompt 14 part 3a, sql/migrations/2026-09-23-offer-mode-rpc.sql, applied 2026-09-23 ~12:45 Central): set_offer_mode()
-- (security definer; one person's key on one period) + save_offers() (security invoker; the painter's one-transaction Save -
-- rows and, when given, the period mode through set_offer_mode, one commit or nothing; a note-less repaint keeps the note).
-- Revision 2026-09-24 j (Prompt 16 A1, sql/migrations/2026-09-24-prelaunch-rls.sql, applied 2026-09-23 ~18:35 Central after the probe): pre-launch RLS -
-- user_profiles_read = own row + scheduler/admin rows (or a scheduler/admin caller); contacts_read scheduler/admin only;
-- notif_insert + audit_insert = scheduler/admin or a linked person (the audit row's actor_id = the caller's roster id);
-- notif_delete_sched; user_profiles_self_update pins email; OF004 OFFER_IMMUTABLE (a non-scheduler UPDATE may not move an
-- offer's day / person); both call_offers guards freeze by status as well as by date; offer_status() revoked from anon.
-- Revision 2026-09-24 k (Prompt 16 A7, sql/migrations/2026-09-24-coordinator-role.sql, applied 2026-09-23 ~19:42 Central after the probe): the COORDINATOR
-- role (office users, never linked to a roster id): silvis_is_coord(); time_off writes + a new availability policy for any person;
-- call_offers policies admit a coordinator only under the transaction-local silvis.office_relay flag that save_offers sets;
-- save_offers / set_offer_mode relay for another person (entered_by = the coordinator's profile id, source 'office-relay';
-- a roster id only: OS004 / OM007); notif_insert / audit_insert gain the coordinator clause (actor_id = auth.uid()::text); audit_read_coord = own family rows.
-- Revision 2026-09-24 l (Prompt 16 B6, sql/migrations/2026-09-24-definer-locks.sql, applied 2026-09-23 ~19:27 Central after the probes): apply_trade() and
-- claim_open_slot() take `lock table public.time_off in share mode` before the day-row locks and the vacation checks (every
-- time_off writer holds ROW EXCLUSIVE, so a vacation inserted or edited concurrently waits for the swap and its trigger then
-- sees it, or the function waits and its check sees the new row; no cycle - a time_off writer never waits on a day row);
-- trade_insert_guard() writes the from/to display names from the roster. Residual (outside B6's three functions):
-- trade_update_guard does not pin from_surgeon_name / to_surgeon_name, so a party's status PATCH may still rewrite the
-- stored strings - the client renders roster names by id (tradeNamed); the one-liner is queued in docs/SCHEMA-REVIEW.md.
-- Revision 2026-09-24 m (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql, applied 2026-09-24 ~17:21 Central after the probes): apply_trade()'s
-- audit row carries actor_name (the caller's user_profiles.display_name, else the roster name, else the id) and detail.summary in the client's
-- trade.accept wording (roster names by id); claim_open_slot()'s audit detail gains the same summary key (its feed title). Nothing else in either body changes.
-- Revision 2026-09-24 n (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql, report-first, NOT yet applied): shift_trade_requests.kind
-- 'trade' | 'give' (default 'trade'; a give carries no return leg - shift_trade_requests_give_one_way); trade_insert_guard() lets a member
-- insert a 'give' with no return shift and refuses a member 'trade' without one (TRADE_INELIGIBLE, both); trade_update_guard() adds kind
-- to the TRADE_IMMUTABLE leg list. apply_trade() is unchanged (the receiver already applies a one-way row as a party).
-- Two same-day migrations redefining one function are ordered by a `-- supersedes:` header line in the one applied
-- later that names the earlier file (never by file name, never by renaming an applied file); the suite fails without it.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- helper: role of the calling user (security definer, no RLS recursion)
create table if not exists public.user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  person_id     text,                      -- roster id (s1..s6) or null for viewers
  role          text not null default 'viewer' check (role in ('admin','scheduler','surgeon','viewer','coordinator')),   -- coordinator: Prompt 16 A7 (office users)
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Prompt 16 A7: the role list on an EXISTING table (the inline check above applies to a from-scratch schema only), and
-- a coordinator is never a roster entry (the audit / notification clauses identify it by auth.uid(), never by a roster id).
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('admin','scheduler','surgeon','viewer','coordinator'));
alter table public.user_profiles drop constraint if exists user_profiles_coordinator_unlinked;
alter table public.user_profiles add constraint user_profiles_coordinator_unlinked
  check (role <> 'coordinator' or person_id is null);   -- an office account is never a roster entry

-- Profile rows are created by the database when an auth user is created/invited (and the
-- email is kept in sync), so Setup -> Users can link a person who has never opened the app.
-- The client never writes an email. Signup lands as viewer with NO person_id; the admin
-- assigns person_id + role in Setup -> Users.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.silvis_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_profiles where id = auth.uid()), 'anon');
$$;

create or replace function public.silvis_person_id() returns text
language sql stable security definer set search_path = public as $$
  select (select person_id from public.user_profiles where id = auth.uid());
$$;

create or replace function public.silvis_is_sched() returns boolean
language sql stable security definer set search_path = public as $$
  select public.silvis_role() in ('admin','scheduler');
$$;

-- Prompt 16 A7: the office role (vacations / availability / offer relay for any surgeon; no scheduler power). Every guard
-- that asks silvis_is_sched() treats a coordinator as a non-scheduler. Grants as for the sibling (the default EXECUTE).
create or replace function public.silvis_is_coord() returns boolean
language sql stable security definer set search_path = public as $$
  select public.silvis_role() = 'coordinator';
$$;

-- ---------- roster + rules + settings blob (single row id='main')
create table if not exists public.call_schedule_data (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ---------- the schedule: one row per day
create table if not exists public.schedule_days (
  day             date primary key,
  primary_id      text,                    -- roster id or null (OPEN)
  backup_id       text,
  primary_locked  boolean not null default false,
  backup_locked   boolean not null default false,
  source          text,                    -- import | generated | manual | east-derived | trade | claim
  external_cover  text,                    -- e.g. 'Atwell' — covered outside the roster; renders as covered, not tallied
  note            text,
  version         integer not null default 1,   -- compare-and-swap on publish
  updated_by      text,
  updated_at      timestamptz not null default now()
);
alter table public.schedule_days drop constraint if exists schedule_days_distinct_roles;
alter table public.schedule_days add constraint schedule_days_distinct_roles
  check (primary_id is null or backup_id is null or primary_id <> backup_id);   -- groupRules.backupDistinctFromPrimary
create index if not exists schedule_days_primary_idx on public.schedule_days(primary_id, day);
create index if not exists schedule_days_backup_idx  on public.schedule_days(backup_id, day);

-- ---------- time off = VACATIONS ONLY (there are no "no-call days" at Silvis — Faraz 9/21)
-- Self-service: surgeons enter their own vacations, nothing is approved; the app logs them and the
-- generator blocks those days (and the day before — the 07:00 shift end falls on the vacation day).
create table if not exists public.time_off (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists time_off_person_idx on public.time_off(person_id, start_date);

-- Rule (Faraz 9/21): a vacation cannot be taken over a day you are already published as primary or backup —
-- find a switch (trade) first. Enforced HERE, not only in the client, so no code path can bypass it.
-- The scheduler's override is to edit the schedule first (which is the honest fix), not to skip the check.
create or replace function public.time_off_no_call_conflict() returns trigger
language plpgsql as $$
declare conflicts text;
begin
  -- The range itself blocks both roles. The day BEFORE the range blocks PRIMARY only: that
  -- shift ends 07:00 on the first vacation day (trailing edge, groupRules.dayBeforeRules).
  select string_agg(to_char(day, 'MM/DD') || ' (' || case when primary_id = new.person_id then 'primary' else 'backup' end || ')', ', ' order by day)
    into conflicts
    from public.schedule_days
   where (day between new.start_date and new.end_date
          and (primary_id = new.person_id or backup_id = new.person_id))
      or (day = new.start_date - 1 and primary_id = new.person_id);
  if conflicts is not null then
    raise exception 'ON_CALL_CONFLICT: % is on call %; trade those shifts before entering this vacation', new.person_id, conflicts
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists time_off_no_call_conflict_trg on public.time_off;
create trigger time_off_no_call_conflict_trg
  before insert or update on public.time_off
  for each row execute function public.time_off_no_call_conflict();

-- ---------- dated availability statements (Sarkar windows, Burchett lists, Philip weeks, Khan opt-ins…)
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,
  kind        text not null check (kind in ('available','unavailable','avoid','prefer','backup_only','no_backup')),
  role        text not null default 'any' check (role in ('any','primary','backup')),
  start_date  date not null,
  end_date    date not null,
  note        text,
  source      text,                        -- e.g. 'email 2026-09-17', 'setup', 'seed'
  created_by  text,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists availability_person_idx on public.availability(person_id, start_date);
-- Idempotent imports key rows on person+kind+role+start+end+source (Prompt 5).
create unique index if not exists availability_stmt_uniq
  on public.availability(person_id, kind, role, start_date, end_date, coalesce(source, ''));

-- ---------- East (Davenport) feed cache + manual overrides
create table if not exists public.east_feed (
  week_monday  date primary key,
  data         jsonb not null,             -- raw Davenport schedule_weeks.data for that week
  fetched_at   timestamptz not null default now()
);
create table if not exists public.east_overrides (
  day         date not null,
  person_id   text not null,
  busy        boolean not null,            -- true = treat as on East call; false = force free
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (day, person_id)
);
-- East FORECAST (scripts/east-forecast.js --sql), kept OUT of east_feed on purpose:
-- east_feed = published Davenport rows only. A forecast row is
--   { isForecast:true, runs, generatedAt, fakBusyProbabilityByDay:{date:p}, fierceWeekProbability }
-- and is read only through east-feed.js forecastFromFeedRows -> forecastToBusy;
-- every published-row deriver ignores data.isForecast rows as a second guard.
create table if not exists public.east_forecast (
  week_monday  date primary key,
  data         jsonb not null,
  generated_at timestamptz not null default now()
);

-- ---------- East vacation reviews (Prompt 15 part 2, 2026-09-23; sql/migrations/2026-09-23-east-vacation-reviews.sql)
-- One row per REVIEWED Davenport vacation range of a surgeon with an East code (the ranges
-- themselves live in the east_feed payload, data.vacations, and are never copied here): the
-- person's decision for that exact range - 'away' (also off at Silvis) or 'home' (available
-- at Silvis; no East call, no OR block). No row = unreviewed = treated like away by rules.js
-- (a derived vacation; never a time_off row). A range Davenport changes or removes no longer
-- matches its row (exact start/end), so the review resets and the app deletes the stale row.
-- "end" is a reserved word: quoted here, plain start/end over PostgREST ({ "start", "end" }
-- in JSON, ?start=eq.&end=eq. in the query string), the same shape as the feed payload.
-- Authenticated-read only (no anon policy): a decision says where a surgeon is on a given
-- day, so it stays off the anon-readable list like user_profiles. Writes: own rows or the
-- scheduler/admin. Dates only - never a note or a reason.
create table if not exists public.east_vacation_reviews (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,
  "start"     date not null,
  "end"       date not null,
  decision    text not null check (decision in ('away', 'home')),
  decided_at  timestamptz not null default now(),
  decided_by  text,
  check ("end" >= "start"),
  unique (person_id, "start", "end")
);
create index if not exists east_vacation_reviews_person_idx on public.east_vacation_reviews(person_id, "start");

-- ---------- trades (there is NO vacation_requests table — vacations need no approval)
create table if not exists public.shift_trade_requests (
  id                uuid primary key default gen_random_uuid(),
  from_surgeon_id   text not null,
  from_surgeon_name text,
  to_surgeon_id     text not null,
  to_surgeon_name   text,
  day               date not null,
  role              text not null check (role in ('primary','backup')),
  return_day        date,
  return_role       text check (return_role in ('primary','backup')),
  status            text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','applied')),
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  detail            text
);
create index if not exists trade_status_idx on public.shift_trade_requests(status, submitted_at desc);
create index if not exists trade_day_idx    on public.shift_trade_requests(day);
-- 2026-09-24 (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql): what the row is. 'trade' = day for day (a member's
-- trade carries its return shift - trade_insert_guard; the scheduler may still record a one-way 'trade', as before); 'give' = a
-- member offers one of his days (or each day of a unit, one row per day) to a named colleague and nothing comes back - never a
-- return leg, for any caller (the check below; trade_insert_guard raises the readable sentence first). Existing rows read 'trade'.
-- A give is accepted / declined / cancelled / applied exactly like a trade (apply_trade: a party or the scheduler; return_day null
-- is its one-way path). kind is a leg: immutable for a non-scheduler after insert (trade_update_guard, TRADE_IMMUTABLE).
alter table public.shift_trade_requests add column if not exists kind text not null default 'trade';
alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_kind_check;
alter table public.shift_trade_requests add constraint shift_trade_requests_kind_check check (kind in ('trade','give'));
alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_give_one_way;
alter table public.shift_trade_requests add constraint shift_trade_requests_give_one_way check (kind = 'trade' or (return_day is null and return_role is null));
comment on column public.shift_trade_requests.kind is '''trade'' (day for day; the default) | ''give'' (one-way, no return leg - Prompt 19, Faraz 2026-09-24)';

-- Non-schedulers may only move a PENDING trade's status: the counter-party to accepted/declined,
-- the proposer to cancelled. Legs (who/day/role/return) are immutable except for the scheduler.
-- 2026-09-23 (audit RLS-6): the counter-party may not ACCEPT a trade whose day or return day is
-- already past in Central time (strict <: today's 07:00 shift stays tradeable) - TRADE_PAST, the
-- same sentence apply_trade() raises; declining or cancelling a stale trade stays open to them.
-- 2026-09-24 (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql): kind ('trade' | 'give') joins the legs - a
-- non-scheduler may not change it on any row, his own included (TRADE_IMMUTABLE); on a row he is no party to, policy
-- trade_update filters the UPDATE out first (0 rows). The status transitions below are unchanged.
create or replace function public.trade_update_guard() returns trigger
language plpgsql as $$
declare
  me      text := public.silvis_person_id();
  today_c date := (now() at time zone 'America/Chicago')::date;
begin
  if public.silvis_is_sched() then return new; end if;
  if new.from_surgeon_id <> old.from_surgeon_id or new.to_surgeon_id <> old.to_surgeon_id
     or new.day <> old.day or new.role <> old.role
     or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role
     or new.kind is distinct from old.kind then
    raise exception 'TRADE_IMMUTABLE: only the scheduler may change the legs of a trade' using errcode = 'P0001';
  end if;
  if current_setting('silvis.apply_trade', true) = '1' and old.status = 'accepted' and new.status = 'applied' then
    return new;   -- set only inside public.apply_trade()
  end if;
  if old.status <> 'pending' then
    raise exception 'TRADE_NOT_PENDING: this trade is already %', old.status using errcode = 'P0001';
  end if;
  if me = old.to_surgeon_id and new.status in ('accepted', 'declined') then
    if new.status = 'accepted' and (old.day < today_c or (old.return_day is not null and old.return_day < today_c)) then
      raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
        case when old.day < today_c then old.day else old.return_day end, today_c using errcode = 'P0001';
    end if;
    return new;
  end if;
  if me = old.from_surgeon_id and new.status = 'cancelled' then return new; end if;
  raise exception 'TRADE_FORBIDDEN: % may not set status % on this trade', coalesce(me, 'anon'), new.status using errcode = 'P0001';
end $$;
drop trigger if exists trade_update_guard_trg on public.shift_trade_requests;
create trigger trade_update_guard_trg
  before update on public.shift_trade_requests
  for each row execute function public.trade_update_guard();

-- ---------- trade INSERT guard (2026-09-22, Prompt 12 D.1)
-- Runs BEFORE INSERT for every caller. Non-schedulers cannot choose the lifecycle fields:
-- the row lands as 'pending', from the caller's own roster id, stamped now, undecided. A
-- scheduler (or a server-side role: the CLI's postgres, service_role) may record a trade
-- as given, e.g. an already-accepted trade agreed by phone. A trade always needs two
-- different surgeons. The trigger fires before RLS's WITH CHECK, so the normalised row is
-- what trade_insert (from_surgeon_id = silvis_person_id() or scheduler) evaluates.
-- The server-side bypass (auth.uid() is null AND current_user in postgres / supabase_admin /
-- service_role) is a standing exception: PostgREST always runs as anon/authenticated, so no client
-- path reaches it, but any future SECURITY DEFINER function owned by postgres that inserts a trade
-- row would inherit it silently. Keep trade inserts out of security-definer code (or re-check
-- silvis_is_sched() there). test/schema.test.js pins the exact role list.
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): from_surgeon_name / to_surgeon_name are written from the roster
-- (call_schedule_data 'main' -> roster[] -> name by id) for EVERY insert, after the id normalisation, instead of storing
-- the client's strings; an unknown id or a missing roster reads as the id (display data, never a refusal).
-- 2026-09-24 (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql): a member (neither scheduler nor server) may insert
-- a 'give' - one of his days to a named colleague, NO return day and NO return role - and a member 'trade' must carry both
-- (TRADE_INELIGIBLE: a trade needs a return shift ...); a 'give' with a return leg is refused for every caller (TRADE_INELIGIBLE:
-- a give is one-way ...). The scheduler / server may still insert a one-way 'trade' (unchanged) and may insert a 'give' - it
-- means the same one-way move, labelled as a give. from := me, the same-surgeon refusal and the roster names are unchanged: a
-- member's give on a day he does not hold lands from HIM and apply_trade refuses it later (TRADE_STALE).
create or replace function public.trade_insert_guard() returns trigger
language plpgsql as $$
declare
  me     text    := public.silvis_person_id();
  server boolean := auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role');
  roster jsonb;
begin
  if not (public.silvis_is_sched() or server) then
    if me is null then
      raise exception 'TRADE_FORBIDDEN: your account is not linked to a roster entry' using errcode = 'P0001';
    end if;
    new.from_surgeon_id := me;
    new.status          := 'pending';
    new.submitted_at    := now();
    new.decided_at      := null;
    -- (2026-09-24, Prompt 19) a member's 'trade' carries its return shift (return_day AND return_role); a one-way row from a
    -- member is a 'give'. kind null reads as a trade here (the not-null constraint refuses it after the trigger anyway).
    if new.kind is distinct from 'give' and (new.return_day is null or new.return_role is null) then
      raise exception 'TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead' using errcode = 'P0001';
    end if;
  end if;
  -- (2026-09-24, Prompt 19) a give is one-way for EVERY caller, the scheduler and the server-side roles included
  if new.kind = 'give' and (new.return_day is not null or new.return_role is not null) then
    raise exception 'TRADE_INELIGIBLE: a give is one-way - it carries no return shift' using errcode = 'P0001';
  end if;
  if new.from_surgeon_id = new.to_surgeon_id then
    raise exception 'TRADE_INELIGIBLE: a trade needs two different surgeons' using errcode = 'P0001';
  end if;
  -- (2026-09-24, Prompt 16 B6) the display names come from the roster, never from the client: call_schedule_data 'main'
  -- -> roster[] -> name (last name) by id, looked up AFTER from_surgeon_id is final. An id the roster does not know, or a
  -- missing / malformed roster, reads as the id itself - a name is display data, never a reason to refuse the insert.
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' then roster := '[]'::jsonb; end if;
  new.from_surgeon_name := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.from_surgeon_id limit 1), ''), new.from_surgeon_id);
  new.to_surgeon_name   := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.to_surgeon_id limit 1), ''), new.to_surgeon_id);
  return new;
end $$;
drop trigger if exists trade_insert_guard_trg on public.shift_trade_requests;
create trigger trade_insert_guard_trg
  before insert on public.shift_trade_requests
  for each row execute function public.trade_insert_guard();

-- Apply an ACCEPTED trade atomically. Members cannot write schedule_days (scheduler-only RLS), so the
-- swap runs here as security definer with explicit checks: caller must be a party or the scheduler;
-- the trade must be 'accepted'; each leg must still be held by the expected surgeon (stale -> error);
-- both days get version+1 and source 'trade'; the trade becomes 'applied'; an audit row is written.
-- The distinct-roles check constraint still applies (a swap that would double-book a day fails loudly).
-- 2026-09-22 (Prompt 12 D.2): before ANY write, each leg's RECEIVER (leg 1 = to_surgeon_id, return
-- leg = from_surgeon_id) is checked, in this order, and TRADE_INELIGIBLE is raised with a plain reason:
--   (a) the roster in call_schedule_data 'main' is present (fail closed) and the receiver is an
--       ACTIVE roster entry (pool or external - any active entry counts; like the client, an entry
--       with no `active` key is active: coalesce(active, 'true') <> 'false');
--   (b) the leg's day is not inside a time_off range of the receiver (and, for a PRIMARY leg, is not
--       the day before one: the 07:00 shift end falls on the vacation day, the same rule the
--       time_off trigger enforces from the other side). Like that trigger, the SQL side hardcodes
--       PRIMARY here; the client reads groupRules.dayBeforeRules.trailingEdgeRoles (default primary);
--   (c) the leg's role is not locked on that day unless the caller is the scheduler; the transfer
--       clears the transferred role's lock flag (a traded slot is no longer the locked import);
--   (d) the receiver does not already hold the OTHER role that day. Evaluated per leg against the
--       pre-swap row, so a same-day role SWAP (A's primary for B's backup on one day) is refused as
--       'already holds' - before this change the same case tripped schedule_days_distinct_roles and
--       the client refuses it too; it is not a supported trade shape.
-- The app shows these messages verbatim, so they read as sentences.
-- 2026-09-23 (audit RLS-6): right after the 'accepted' check and before the first row lock, a caller
-- who is not the scheduler is refused with TRADE_PAST when the day or the return day is before today
-- in America/Chicago (strict <, like claim_open_slot's CL003) - past days are the scheduler's to change.
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): right after the TRADE_PAST refusal and BEFORE the day rows are
-- locked, the function takes `lock table public.time_off in share mode`. The race it closes: a vacation of a receiver
-- inserted or edited onto the day while the trade is applied - the time_off BEFORE trigger reads schedule_days without
-- locking, so under read committed both checks could pass (write skew). Every time_off writer holds ROW EXCLUSIVE on
-- the relation from statement start (before its trigger runs), and ROW EXCLUSIVE conflicts with SHARE: the vacation
-- write waits for this transaction and its trigger then sees the swap (ON_CALL_CONFLICT); in the other order this
-- function waits for the vacation and check (b), a fresh snapshot per statement, sees the new or moved range. A
-- row-level FOR SHARE would miss a row inserted concurrently (no predicate locks under read committed); the table lock
-- covers both sides. No cycle: a time_off writer never waits on a trade row or a day row (its trigger only READS
-- schedule_days; no function in this schema writes time_off), this function takes the time_off lock before any day
-- row, SHARE is not self-conflicting (concurrent applies do not serialise) and every reader holds ACCESS SHARE. The
-- lock runs as the table owner (security definer) and is held for the rest of the RPC's transaction - milliseconds.
-- Lock order: trade row (update) -> time_off table (share) -> day rows (update).
-- 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit row names its actor and carries a
-- one-line summary. actor_name = the caller's user_profiles.display_name, else the roster name for the caller's roster id, else the
-- id (the Activity log showed "?"); detail.summary = "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>, one-way)" for a
-- one-way trade, "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>; <from> takes <Role> <Dy Mon D> in return)" for a
-- two-way one - the client's trade.accept wording family, rendered where the log showed the raw action. Both surgeon names are
-- the roster's by id (to_name / fr_name), never the stored from_surgeon_name / to_surgeon_name (a status PATCH may rewrite
-- those). Every other key of the detail object, the writes, the checks and the locks are as before.
create or replace function public.apply_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t        public.shift_trade_requests%rowtype;
  d1       public.schedule_days%rowtype;
  d2       public.schedule_days%rowtype;
  me       text    := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  today_c  date    := (now() at time zone 'America/Chicago')::date;
  holder   text;
  roster   jsonb;
  to_name  text;
  fr_name  text;
  my_name  text;
  summary  text;
begin
  select * into t from public.shift_trade_requests where id = p_trade_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (sched or me = t.from_surgeon_id or me = t.to_surgeon_id) then
    raise exception 'TRADE_FORBIDDEN: only a party or the scheduler may apply this trade' using errcode = 'P0001';
  end if;
  if t.status <> 'accepted' then
    raise exception 'TRADE_NOT_ACCEPTED: status is %', t.status using errcode = 'P0001';
  end if;
  -- (2026-09-23, audit RLS-6) a past day is the scheduler's to change: a member may not rewrite history
  if not sched and (t.day < today_c or (t.return_day is not null and t.return_day < today_c)) then
    raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
      case when t.day < today_c then t.day else t.return_day end, today_c using errcode = 'P0001';
  end if;
  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day rows are locked and before the vacation check (b): a
  -- vacation of either receiver inserted or edited concurrently waits for this transaction (its trigger then sees the
  -- swap), or this function waits and (b) sees it - see the header. Lock order: trade row (update) -> time_off table
  -- (share) -> day rows (update).
  lock table public.time_off in share mode;
  select * into d1 from public.schedule_days where day = t.day for update;
  holder := case when t.role = 'primary' then d1.primary_id else d1.backup_id end;
  if not found or holder is distinct from t.from_surgeon_id then
    raise exception 'TRADE_STALE: % % is no longer held by %', t.day, t.role, t.from_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    select * into d2 from public.schedule_days where day = t.return_day for update;
    holder := case when t.return_role = 'primary' then d2.primary_id else d2.backup_id end;
    if not found or holder is distinct from t.to_surgeon_id then
      raise exception 'TRADE_STALE: % % is no longer held by %', t.return_day, t.return_role, t.to_surgeon_id using errcode = 'P0001';
    end if;
  end if;
  -- (a) roster present (fail closed) + each receiver is an ACTIVE roster entry
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' or jsonb_array_length(roster) = 0 then
    raise exception 'TRADE_INELIGIBLE: roster unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.to_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.from_surgeon_id using errcode = 'P0001';
  end if;
  to_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id limit 1), t.to_surgeon_id);
  fr_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id limit 1), t.from_surgeon_id);
  -- (b) neither receiver has a vacation over the day they would take (primary: nor the day before one)
  if exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and t.day between v.start_date and v.end_date) then
    raise exception 'TRADE_INELIGIBLE: % is on vacation on %', to_name, t.day using errcode = 'P0001';
  end if;
  if t.role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and v.start_date = t.day + 1) then
    raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', to_name, t.day + 1 using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    if exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and t.return_day between v.start_date and v.end_date) then
      raise exception 'TRADE_INELIGIBLE: % is on vacation on %', fr_name, t.return_day using errcode = 'P0001';
    end if;
    if t.return_role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and v.start_date = t.return_day + 1) then
      raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', fr_name, t.return_day + 1 using errcode = 'P0001';
    end if;
  end if;
  -- (c) locked slots move only when the scheduler applies (the transfer below clears the lock)
  if not sched then
    if (t.role = 'primary' and d1.primary_locked) or (t.role = 'backup' and d1.backup_locked) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.day, t.role using errcode = 'P0001';
    end if;
    if t.return_day is not null and ((t.return_role = 'primary' and d2.primary_locked) or (t.return_role = 'backup' and d2.backup_locked)) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.return_day, t.return_role using errcode = 'P0001';
    end if;
  end if;
  -- (d) the receiver must not already hold the other role that day
  if (t.role = 'primary' and d1.backup_id = t.to_surgeon_id) or (t.role = 'backup' and d1.primary_id = t.to_surgeon_id) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', to_name, case when t.role = 'primary' then 'backup' else 'primary' end, t.day using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and ((t.return_role = 'primary' and d2.backup_id = t.from_surgeon_id) or (t.return_role = 'backup' and d2.primary_id = t.from_surgeon_id)) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', fr_name, case when t.return_role = 'primary' then 'backup' else 'primary' end, t.return_day using errcode = 'P0001';
  end if;
  -- writes
  if t.role = 'primary' then
    update public.schedule_days set primary_id = t.to_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  else
    update public.schedule_days set backup_id = t.to_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  end if;
  if t.return_day is not null then
    if t.return_role = 'primary' then
      update public.schedule_days set primary_id = t.from_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    else
      update public.schedule_days set backup_id = t.from_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    end if;
  end if;
  perform set_config('silvis.apply_trade', '1', true);
  update public.shift_trade_requests set status = 'applied', decided_at = coalesce(decided_at, now()) where id = p_trade_id;
  perform set_config('silvis.apply_trade', '0', true);
  -- (2026-09-24, follow-up 5b) actor_name: display_name from the caller's own profile row, else the roster name for the caller's
  -- roster id, else the id; summary: the client's trade.accept wording family with the ROSTER names (to_name / fr_name), role
  -- words Primary / Backup and dates like "Sat Oct 10" (to_char 'Dy Mon FMDD' - English names regardless of lc_time).
  select nullif(p.display_name, '') into my_name from public.user_profiles p where p.id = auth.uid();
  my_name := coalesce(my_name, nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = me limit 1), ''), me);
  summary := 'Trade applied: ' || to_name || ' takes ' || case when t.role = 'primary' then 'Primary' else 'Backup' end
             || ' ' || to_char(t.day, 'Dy Mon FMDD') || ' (from ' || fr_name
             || case when t.return_day is null then ', one-way)'
                     else '; ' || fr_name || ' takes ' || case when t.return_role = 'primary' then 'Primary' else 'Backup' end
                          || ' ' || to_char(t.return_day, 'Dy Mon FMDD') || ' in return)' end;
  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'trade.apply', jsonb_build_object('summary', summary, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));
  return jsonb_build_object('ok', true, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role);
end $$;
revoke all on function public.apply_trade(uuid) from public, anon;
grant execute on function public.apply_trade(uuid) to authenticated;

-- ============================================================================
-- claim_open_slot(p_day, p_role) - a linked surgeon takes an OPEN slot (2026-09-22, Prompt 13
-- part 2; applied live through sql/migrations/2026-09-22-claim-open-slot.sql, never by a git push)
--
-- A linked surgeon takes an OPEN slot from the Open shifts board. Modelled on
-- apply_trade(): security definer (members cannot write schedule_days under
-- RLS), explicit checks before the first write, version + 1 so every other
-- client's compare-and-swap sees the change, an audit row and an in-app feed
-- row in the SAME transaction (an error rolls all of it back).
--
-- What it guards: data integrity only - open, unlocked, not past (Central),
-- not external-covered, inside the published range, distinct roles, no
-- vacation conflict (incl. the day before a PRIMARY shift, mirroring the
-- time_off trigger). The JS eligibility rules (OR days, Clinton days, caps,
-- weekday patterns, consecutive runs) are enforced in the client before the
-- "Take this shift" button is offered, not here - the accepted boundary for a
-- six-surgeon group; everything the function does is logged.
--
-- Errors: each refusal has its own SQLSTATE (class CL, custom) and a plain
-- message prefixed with a stable token; PostgREST returns both and the app
-- shows the message verbatim.
--   CL001 CLAIM_NOT_LINKED      caller has no roster link (or is anon)
--   CL002 CLAIM_BAD_ROLE        role not in (primary, backup)
--   CL003 CLAIM_PAST            day is before today in America/Chicago
--   CL004 CLAIM_OUTSIDE_RANGE   day outside [min(day), max(day)] of schedule_days
--   CL005 CLAIM_HELD            slot already held
--   CL006 CLAIM_EXTERNAL        primary requested while external_cover is set
--   CL007 CLAIM_LOCKED          slot is locked (scheduler assigns from the editor)
--   CL008 CLAIM_OTHER_ROLE      caller already holds the other role that day
--   CL009 CLAIM_VACATION        a time_off row of the caller overlaps the day
--                               (or the next day when p_role = 'primary')
--
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): after the four row-less refusals (CL001-CL004) and BEFORE the
-- day row is locked, the function takes `lock table public.time_off in share mode`, so a vacation of the caller
-- inserted or edited onto the day while the claim runs waits for this transaction (its trigger then sees the claim),
-- or the claim waits and CL009 sees the new row - the same write skew apply_trade() closes, same reasoning (every
-- time_off writer holds ROW EXCLUSIVE, which conflicts with SHARE), same deadlock argument (see apply_trade's header).
-- Lock order: time_off table (share) -> the day row (update).
-- 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit detail gains a summary key -
-- the feed row's title, "<Name> took <M/D> <role>" - so the Activity log renders a sentence instead of the raw action;
-- actor_name (the roster name, my_name) is unchanged. Nothing else in the body changes.
-- ============================================================================
create or replace function public.claim_open_slot(p_day date, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  today_c   date := (now() at time zone 'America/Chicago')::date;
  d         public.schedule_days%rowtype;
  lo        date;
  hi        date;
  other     text;
  held      text;
  is_locked boolean;
  my_name   text;
  vac       text;
  new_ver   integer;
  wrote_offer boolean := false;   -- P2 review: false for a rules_only claimer (no call_offers row)
  summary   text;
begin
  if auth.uid() is null or me is null then
    raise exception 'CLAIM_NOT_LINKED: sign in with an account that is linked to a roster entry to take a shift' using errcode = 'CL001';
  end if;
  if p_role is null or p_role not in ('primary', 'backup') then
    raise exception 'CLAIM_BAD_ROLE: role must be primary or backup (got %)', coalesce(p_role, 'null') using errcode = 'CL002';
  end if;
  if p_day is null or p_day < today_c then
    raise exception 'CLAIM_PAST: % is before today (%) in Central time; past days are not open', p_day, today_c using errcode = 'CL003';
  end if;

  -- The published range = every day between the first and the last schedule_days row.
  select min(day), max(day) into lo, hi from public.schedule_days;
  if lo is null or p_day < lo or p_day > hi then
    raise exception 'CLAIM_OUTSIDE_RANGE: % is outside the published schedule (% to %)', p_day, coalesce(lo::text, '-'), coalesce(hi::text, '-') using errcode = 'CL004';
  end if;

  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day row is locked and before the vacation check (CL009): a
  -- vacation of the caller inserted or edited concurrently waits for this transaction, or this function waits and CL009
  -- sees it - see the header. Lock order: time_off table (share) -> the day row (update).
  lock table public.time_off in share mode;

  -- Lock the day's row; a day inside the range with no row gets one (source 'claim').
  select * into d from public.schedule_days where day = p_day for update;
  if not found then
    insert into public.schedule_days (day, source, version, updated_by, updated_at)
      values (p_day, 'claim', 1, me, now())
      on conflict (day) do nothing;
    select * into d from public.schedule_days where day = p_day for update;
  end if;

  other     := case when p_role = 'primary' then 'backup' else 'primary' end;
  held      := case when p_role = 'primary' then d.primary_id else d.backup_id end;
  is_locked := case when p_role = 'primary' then d.primary_locked else d.backup_locked end;

  if held is not null then
    raise exception 'CLAIM_HELD: % % is already held by %', p_day, p_role, held using errcode = 'CL005';
  end if;
  if p_role = 'primary' and coalesce(d.external_cover, '') <> '' then
    raise exception 'CLAIM_EXTERNAL: % primary is covered by % (outside the roster)', p_day, d.external_cover using errcode = 'CL006';
  end if;
  if is_locked then
    raise exception 'CLAIM_LOCKED: % % is locked; ask the scheduler to assign it', p_day, p_role using errcode = 'CL007';
  end if;
  if (case when p_role = 'primary' then d.backup_id else d.primary_id end) = me then
    raise exception 'CLAIM_OTHER_ROLE: you already hold % on %', other, p_day using errcode = 'CL008';
  end if;

  -- Vacation conflict: the day itself, plus the next day for a PRIMARY shift
  -- (the 07:00 shift end falls on the vacation day - same rule the time_off
  -- trigger enforces in the other direction).
  select string_agg(to_char(start_date, 'FMMM/FMDD') || '-' || to_char(end_date, 'FMMM/FMDD'), ', ' order by start_date)
    into vac
    from public.time_off
   where person_id = me
     and start_date <= (case when p_role = 'primary' then p_day + 1 else p_day end)
     and end_date   >= p_day;
  if vac is not null then
    raise exception 'CLAIM_VACATION: your vacation % conflicts with % % (a primary shift also blocks the day before a vacation)', vac, p_day, p_role using errcode = 'CL009';
  end if;

  -- The write. version + 1 makes every other client's compare-and-swap on this day fail loudly and reload.
  if p_role = 'primary' then
    update public.schedule_days
       set primary_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  else
    update public.schedule_days
       set backup_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  end if;

  -- Prompt 14 P2 (9/23): a claim is an offer made on the spot - the record stays honest. One row per person and
  -- day: the claimed role, entered by the claimer, source 'app', no note. An existing offer in the same role is
  -- left as it was; one in the other role becomes 'either'. The freeze guard (OFFER_FROZEN) is bypassed for this
  -- transaction-local write only - the period closed before the schedule was published; CLAIM_PAST and
  -- CLAIM_VACATION above already enforce what OF001 / OF002 would.
  -- Review 9/23: NOT for a claimer listed in rules_only_ids of the period containing the day - one offer row
  -- would make offer_status() read 'submitted' for his whole period (see the header). Outside every period the
  -- row is written like any other offer (it is then a plain dated availability row for the engine).
  if not exists (select 1 from public.call_periods p where p_day between p.start_day and p.end_day and p.rules_only_ids ? me) then
    perform set_config('silvis.claim_in_progress', 'on', true);
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
    values (me, p_day, p_role, null, me, 'app')
    on conflict (person_id, day) do update
       set role_pref  = case when public.call_offers.role_pref = excluded.role_pref then public.call_offers.role_pref else 'either' end,
           updated_at = now();
    perform set_config('silvis.claim_in_progress', '', true);
    wrote_offer := true;
  end if;

  -- Display name from the roster blob (last name); falls back to the id.
  select r->>'name' into my_name
    from public.call_schedule_data c, jsonb_array_elements(coalesce(c.data->'roster', '[]'::jsonb)) r
   where c.id = 'main' and r->>'id' = me
   limit 1;
  my_name := coalesce(nullif(my_name, ''), me);

  -- (2026-09-24, follow-up 5b) detail.summary = the feed title below, so the Activity log shows "<Name> took <M/D> <role>".
  summary := my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role;
  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'schedule.claim', jsonb_build_object('summary', summary, 'day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));

  -- In-app feed row: the claimer sees it through data.surgeon_id, the scheduler sees everything.
  insert into public.notifications (type, title, message, data)
  values ('shift_claimed',
          my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role,
          my_name || ' took the open ' || p_role || ' shift on ' || to_char(p_day, 'Dy FMMM/FMDD') || ' (07:00 to 07:00).',
          jsonb_build_object('day', p_day, 'role', p_role, 'surgeon_id', me, 'person_id', me));

  return jsonb_build_object('ok', true, 'day', p_day, 'role', p_role, 'person_id', me, 'version', new_ver);
end $$;

revoke all on function public.claim_open_slot(date, text) from public, anon;
grant execute on function public.claim_open_slot(date, text) to authenticated;

-- ---------- offers + periods (2026-09-22, Prompt 14 part 1; sql/migrations/2026-09-22-offers-periods.sql, applied 15:15)
-- Silvis is an offers problem: surgeons paint the dates they will cover for any time ahead; a period is the
-- generation window (default 3 months) whose offers freeze six weeks before it starts; the rules engine reads both
-- (docs/SILVIS-BUILD-GUIDE.md section 17). Same conventions as the rest of this file: idempotent DDL, RLS on,
-- silvis_person_id() / silvis_is_sched(), triggers that fail closed with a stable message token + errcode.
-- NOT anon-readable on purpose: offers carry person ids and free-text notes; anon reads stay limited to the
-- published schedule. Snapshot / wipe-guard decision (part 1): call_schedule_snapshots.data gains call_offers[] +
-- call_periods[] when the client capture is extended (a later wave) so a restore brings the offers back;
-- payloadLooksWiped and the table-side wipe guards do not consider them.

-- call_periods: the generation windows (a period = 3 months by default)
create table if not exists public.call_periods (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,                              -- "Nov 2026 - Jan 2027"
  start_day        date not null,
  end_day          date not null,
  offers_close_at  date not null,                              -- default start_day - 6 weeks (set by the app from groupRules.offerPeriods)
  publish_by       date not null,                              -- default start_day - 4 weeks
  status           text not null default 'upcoming' check (status in ('upcoming','closed','generated','published')),
  rules_only_ids   jsonb not null default '[]'::jsonb,         -- ["s1","s6"]: surgeons who chose "go by my rules" for this period
  offer_modes      jsonb not null default '{}'::jsonb,         -- {person_id: 'exhaustive' | 'preferred'}; absent = 'preferred' (2026-09-23, below)
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_day >= start_day),
  check (offers_close_at <= start_day),
  check (jsonb_typeof(rules_only_ids) = 'array')
);
create unique index if not exists call_periods_start_idx on public.call_periods(start_day);
-- 2026-09-23 (sql/migrations/2026-09-23-offer-modes.sql; Faraz 9/22 evening): the hardness each surgeon chose for the
-- period - 'exhaustive' = eligible only on the offered days in the offered role; 'preferred' = offered days first, own
-- rules fill the gaps (the default; an absent key means 'preferred'). Values are the two words above; the SQL side checks
-- the shape only (an object), the client and rules.js read the value. Derived status (offer_status) ignores the mode.
alter table public.call_periods add column if not exists offer_modes jsonb not null default '{}'::jsonb;
alter table public.call_periods drop constraint if exists call_periods_offer_modes_object;
alter table public.call_periods add constraint call_periods_offer_modes_object check (jsonb_typeof(offer_modes) = 'object');
comment on column public.call_periods.offer_modes is '{person_id: ''exhaustive'' | ''preferred''}; absent = ''preferred'' (the default, Faraz 9/22 evening); offer_status() is unchanged';

-- call_offers: one row per person and day ("I will cover this day")
create table if not exists public.call_offers (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,                                    -- roster id (s1..s6)
  day         date not null,
  role_pref   text not null check (role_pref in ('primary','backup','either')),
  note        text,                                             -- operational only (scrubbed on import; checked at entry)
  entered_by  text not null,                                    -- the roster id, 'scheduler' when relaying an email, or a coordinator's profile id (office-relay)
  source      text not null default 'app' check (source in ('app','email-relay','import','office-relay')),   -- office-relay: Prompt 16 A7 (a coordinator through save_offers)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (person_id, day)
);
-- Prompt 16 A7: the source list on an EXISTING table (the inline check above applies to a from-scratch schema only).
alter table public.call_offers drop constraint if exists call_offers_source_check;
alter table public.call_offers add constraint call_offers_source_check
  check (source in ('app','email-relay','import','office-relay'));
create index if not exists call_offers_day_idx on public.call_offers(day);
create index if not exists call_offers_person_idx on public.call_offers(person_id, day);

-- Per-period, per-surgeon status is DERIVED (never stored twice):
--   'submitted'   if the person has >= 1 call_offers row with day between start_day and end_day
--   'rules_only'  else if the person is listed in call_periods.rules_only_ids
--   'not_started' otherwise
create or replace function public.offer_status(p_period uuid, p_person text) returns text
language sql stable security invoker as $$
  select case
    when exists (select 1 from public.call_offers o, public.call_periods p
                  where p.id = p_period and o.person_id = p_person and o.day between p.start_day and p.end_day) then 'submitted'
    when exists (select 1 from public.call_periods p, jsonb_array_elements_text(p.rules_only_ids) r
                  where p.id = p_period and r = p_person) then 'rules_only'
    else 'not_started' end;
$$;
-- Prompt 16 A1: not callable by anon (nothing anon needs it: the client derives the status in helpers.offerRollcall, the
-- share page and the ICS feed read schedule_days). Authenticated + service_role keep execute.
revoke execute on function public.offer_status(uuid, text) from public;
revoke execute on function public.offer_status(uuid, text) from anon;
grant execute on function public.offer_status(uuid, text) to authenticated;
grant execute on function public.offer_status(uuid, text) to service_role;

-- ---------- triggers on call_offers (fail closed; the app checks the same things before the button)
--   OFFER_PAST        the day is before today in America/Chicago
--   OFFER_ON_VACATION the day lies inside one of the person's time_off ranges (mirror of time_off_no_call_conflict)
--   OFFER_IMMUTABLE   a non-scheduler UPDATE moves the offer's day or person (Prompt 16 A1: an offer is cleared and
--                     re-offered, never moved; save_offers' upsert and claim_open_slot's upsert touch neither column)
--   OFFER_FROZEN      a non-scheduler writes a day inside a period whose offers_close_at has passed OR whose status is
--                     no longer 'upcoming' (Prompt 16 A1: freeze by status too - a published period is frozen whatever
--                     its close date; the scheduler may still enter a late offer; every row carries entered_by/source,
--                     and the app writes an audit row 'offers.save' with the count)
create or replace function public.call_offers_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if new.day < today_c then
    raise exception 'OFFER_PAST: % is before today (%) in Central time', new.day, today_c using errcode = 'OF001';
  end if;
  if exists (select 1 from public.time_off t where t.person_id = new.person_id and new.day between t.start_date and t.end_date) then
    raise exception 'OFFER_ON_VACATION: % is inside a vacation of %', new.day, new.person_id using errcode = 'OF002';
  end if;
  if tg_op = 'UPDATE' and not public.silvis_is_sched() and (new.day <> old.day or new.person_id <> old.person_id) then
    raise exception 'OFFER_IMMUTABLE: an offer keeps its day and person (% %) - clear it and offer the other day instead', old.person_id, old.day using errcode = 'OF004';
  end if;
  if not public.silvis_is_sched() and coalesce(current_setting('silvis.claim_in_progress', true), '') <> 'on' then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where new.day between p.start_day and p.end_day and (p.offers_close_at <= today_c or p.status <> 'upcoming')
     limit 1;
    if found then
      raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen.label, frozen.offers_close_at using errcode = 'OF003';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists call_offers_guard_trg on public.call_offers;
create trigger call_offers_guard_trg
  before insert or update on public.call_offers
  for each row execute function public.call_offers_guard();

-- Deleting an offer inside a frozen period (by close date or by status) is refused for non-schedulers the same way.
create or replace function public.call_offers_delete_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if not public.silvis_is_sched() then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where old.day between p.start_day and p.end_day and (p.offers_close_at <= today_c or p.status <> 'upcoming')
     limit 1;
    if found then
      raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen.label, frozen.offers_close_at using errcode = 'OF003';
    end if;
  end if;
  return old;
end $$;
drop trigger if exists call_offers_delete_guard_trg on public.call_offers;
create trigger call_offers_delete_guard_trg
  before delete on public.call_offers
  for each row execute function public.call_offers_delete_guard();

-- ============================================================================
-- set_offer_mode(p_period, p_mode, p_person) + save_offers(p_person, p_rows, p_clear, p_period, p_mode) - the offer painter
-- (2026-09-23, Prompt 14 part 3a; sql/migrations/2026-09-23-offer-mode-rpc.sql - applied live 2026-09-23 ~12:45 Central,
-- the orchestrator runs it; probe sql/probes/offer-rpcs-probe.sql rolls itself back)
--
-- set_offer_mode: SECURITY DEFINER because a surgeon cannot write call_periods (RLS: scheduler / admin only), yet the
--   painter lets them choose exhaustive / preferred / rules_only for the next period. It writes THAT ONE PERSON'S key
--   and nothing else; a non-scheduler may only speak for silvis_person_id() and only before offers_close_at (OM005,
--   like OF003); rules_only is refused while the person has offers inside the period (OM006).
-- save_offers: SECURITY INVOKER - the painter's one Save as ONE transaction (upserts + deletes and, when p_mode is
--   given, the period mode through set_offer_mode - together or nothing; a row sent without a note keeps its note),
--   as the caller: the call_offers RLS policies and OF001 / OF002 / OF003 apply per row, nothing is bypassed;
--   entered_by / source come from who is calling (own id / 'app', or 'scheduler' / 'email-relay' when the
--   scheduler paints for someone). The client writes the audit row offers.save after ok. Both texts are the
--   migration's, byte for byte (test/schema.test.js pins the identity).
-- Tokens: OM001 MODE_NOT_LINKED, OM002 MODE_NOT_YOURS, OM003 MODE_BAD_MODE, OM004 MODE_NO_PERIOD, OM005 MODE_FROZEN,
--   OM006 MODE_HAS_OFFERS; OS001 OFFERS_NOT_LINKED, OS002 OFFERS_NOT_YOURS, OS003 OFFERS_BAD_ROW.
-- Prompt 16 A7 (sql/migrations/2026-09-24-coordinator-role.sql - the newest migration touching both): a coordinator (office
--   account, no roster link) may relay for another person in both functions - OS001 / OM001 and OS002 / OM002 admit it;
--   save_offers stamps entered_by = its profile id, source 'office-relay', and turns the transaction-local flag
--   silvis.office_relay on around its delete / upsert so the call_offers policies admit the rows (security invoker kept);
--   the freeze (OF003 / OM005) applies to it as to a surgeon.
-- ============================================================================
create or replace function public.set_offer_mode(p_period uuid, p_mode text, p_person text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me       text := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  coord    boolean := public.silvis_is_coord();
  who      text;
  today_c  date := (now() at time zone 'America/Chicago')::date;
  p        public.call_periods%rowtype;
  n_offers integer;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'MODE_NOT_LINKED: sign in with an account that is linked to a roster entry' using errcode = 'OM001';
  end if;
  who := coalesce(nullif(btrim(p_person), ''), me);
  if who is null then
    raise exception 'MODE_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OM001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'MODE_NOT_YOURS: only the scheduler or the office can set another surgeon''s mode' using errcode = 'OM002';
  end if;
  -- The office relays for a roster id only (review of Prompt 16 A7): call_offers.person_id has no foreign key, so a
  -- hand-made call could otherwise leave offer_modes keys for nobody. The scheduler's relay is unchanged.
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'MODE_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OM007';
  end if;
  if p_mode is null or p_mode not in ('exhaustive', 'preferred', 'rules_only') then
    raise exception 'MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got %)', coalesce(p_mode, 'null') using errcode = 'OM003';
  end if;

  select * into p from public.call_periods where id = p_period for update;
  if not found then
    raise exception 'MODE_NO_PERIOD: no period % on file', coalesce(p_period::text, 'null') using errcode = 'OM004';
  end if;
  if not sched and (p.status <> 'upcoming' or p.offers_close_at <= today_c) then
    raise exception 'MODE_FROZEN: offers for % closed on % - ask the scheduler', p.label, p.offers_close_at using errcode = 'OM005';
  end if;

  if p_mode = 'rules_only' then
    select count(*) into n_offers from public.call_offers o where o.person_id = who and o.day between p.start_day and p.end_day;
    if n_offers > 0 then
      raise exception 'MODE_HAS_OFFERS: % has % offered day(s) inside % - clear them first to go by the rules', who, n_offers, p.label using errcode = 'OM006';
    end if;
    update public.call_periods
       set rules_only_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                               from (select jsonb_array_elements_text(rules_only_ids) as x union all select who) s),
           offer_modes    = offer_modes - who,
           updated_at     = now()
     where id = p_period;
  else
    update public.call_periods
       set rules_only_ids = (select coalesce(jsonb_agg(x), '[]'::jsonb)
                               from jsonb_array_elements_text(rules_only_ids) as x where x <> who),
           offer_modes    = offer_modes || jsonb_build_object(who, p_mode),
           updated_at     = now()
     where id = p_period;
  end if;

  select * into p from public.call_periods where id = p_period;
  return jsonb_build_object('ok', true, 'period_id', p.id, 'label', p.label, 'person_id', who, 'mode', p_mode,
                            'rules_only_ids', p.rules_only_ids, 'offer_modes', p.offer_modes, 'by', coalesce(me, case when sched then 'scheduler' else auth.uid()::text end));
end $$;
revoke all on function public.set_offer_mode(uuid, text, text) from public;
revoke all on function public.set_offer_mode(uuid, text, text) from anon;
grant execute on function public.set_offer_mode(uuid, text, text) to authenticated;
comment on function public.set_offer_mode(uuid, text, text) is 'Prompt 14 part 3a (+ Prompt 16 A7): one person''s offer mode on one period (exhaustive / preferred -> offer_modes[person], off rules_only_ids; rules_only -> on rules_only_ids, key dropped; refused with offers inside the period). Security definer because surgeons cannot write call_periods; a non-scheduler may only set their own - or, as a coordinator, another ROSTER person''s (OM007 otherwise) - and only before the freeze.';

create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  sched     boolean := public.silvis_is_sched();
  coord     boolean := public.silvis_is_coord();
  who       text := nullif(btrim(p_person), '');
  v_by      text;
  v_src     text;
  n_up      integer := 0;
  n_del     integer := 0;
  bad       text;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'OFFERS_NOT_LINKED: sign in with an account that is linked to a roster entry to save offers' using errcode = 'OS001';
  end if;
  who := coalesce(who, me);
  if who is null then
    raise exception 'OFFERS_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OS001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'OFFERS_NOT_YOURS: only the scheduler or the office can save another surgeon''s offers' using errcode = 'OS002';
  end if;
  -- The office relays for a roster id only (review of Prompt 16 A7): call_offers.person_id has no foreign key, so a
  -- hand-made call could otherwise leave orphan offer rows. The scheduler's relay is unchanged. Checked before any write.
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'OFFERS_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OS004';
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OFFERS_BAD_ROW: rows must be a JSON array' using errcode = 'OS003';
  end if;
  -- Fail closed BEFORE any write: one malformed row means the whole batch is refused.
  select string_agg(coalesce(r->>'day', 'null') || ' ' || coalesce(r->>'role_pref', 'null'), ', ') into bad
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where r->>'day' !~ '^\d{4}-\d{2}-\d{2}$' or r->>'role_pref' is null or r->>'role_pref' not in ('primary', 'backup', 'either');
  if bad is not null then
    raise exception 'OFFERS_BAD_ROW: % (day must be YYYY-MM-DD, role_pref primary / backup / either) - nothing was saved', bad using errcode = 'OS003';
  end if;

  -- Who entered it is a fact of the call, never a client field.
  if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth.uid()::text; v_src := 'office-relay'; end if;

  -- A coordinator's rows pass the call_offers policies only inside this call (Prompt 16 A7): the transaction-local
  -- flag is what the policies' coordinator clause reads; it never exists outside save_offers.
  if coord then perform set_config('silvis.office_relay', 'on', true); end if;

  -- The deletes first, then the upserts (order is immaterial inside one transaction; the delete guard OF003 and the
  -- RLS delete policy apply per row). A day in both lists ends up upserted.
  if p_clear is not null and array_length(p_clear, 1) > 0 then
    delete from public.call_offers where person_id = who and day = any(p_clear);
    get diagnostics n_del = row_count;
  end if;
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  select who, (r->>'day')::date, r->>'role_pref', nullif(btrim(r->>'note'), ''), v_by, v_src
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (person_id, day) do update
    set role_pref = excluded.role_pref, note = coalesce(excluded.note, call_offers.note), entered_by = excluded.entered_by, source = excluded.source, updated_at = now();
  get diagnostics n_up = row_count;
  if coord then perform set_config('silvis.office_relay', '', true); end if;

  -- The mode, when the same Save changed it: inside this transaction, so a refused mode (OM001-OM006, checked by
  -- set_offer_mode itself) rolls the rows above back too - days + mode are one commit or nothing.
  if p_mode is not null then
    perform public.set_offer_mode(p_period, p_mode, who);
  end if;

  return jsonb_build_object('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by, 'source', v_src, 'mode', p_mode);
end $$;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text) from public;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text) from anon;
grant execute on function public.save_offers(text, jsonb, date[], uuid, text) to authenticated;
comment on function public.save_offers(text, jsonb, date[], uuid, text) is 'Prompt 14 part 3a (+ Prompt 16 A7): the offer painter''s one Save - upserts + deletes (+ the period mode through set_offer_mode when p_mode is given) in ONE transaction as the caller (security invoker: RLS + OF001/OF002/OF003 apply per row; nothing bypassed - a coordinator''s rows pass the policies through the transaction-local silvis.office_relay flag this function sets). entered_by / source come from the caller identity (own id / app; scheduler / email-relay; the coordinator''s profile id / office-relay - for a roster id only, OS004 otherwise); a row sent without a note keeps its note. The client writes the audit row offers.save after ok.';

-- ---------- notifications, prefs, audit, snapshots, versions, contacts
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  title       text not null,
  message     text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

create table if not exists public.notification_preferences (
  person_id                 text primary key,
  schedule_updates_email    boolean not null default true,
  trade_updates_email       boolean not null default true,
  shift_reminders_email     boolean not null default true,
  reminder_hour_central     integer check (reminder_hour_central between 0 and 23),
  updated_at                timestamptz not null default now()
);

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    text,
  actor_name  text,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log(created_at desc);

create table if not exists public.call_schedule_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  reason             text,
  data               jsonb not null,       -- { config, schedule_days[], time_off[], availability[] }
  source_updated_at  timestamptz,          -- call_schedule_data.updated_at at capture time (Davenport contract)
  created_by         text,
  created_at         timestamptz not null default now()
);
alter table public.call_schedule_snapshots add column if not exists source_updated_at timestamptz;
create index if not exists snapshots_created_idx on public.call_schedule_snapshots(created_at desc);

-- Row 'main' carries min_version/message (the refresh banner). Every other row is a per-client
-- heartbeat keyed by the auth user id (app_version, user agent, person) so the scheduler can see
-- who is on which build. Anon may read only 'main'.
create table if not exists public.client_versions (
  id           text primary key,           -- 'main' or auth.uid()::text
  min_version  text,
  message      text,
  app_version  text,
  user_agent   text,
  person_id    text,
  seen_at      timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.client_versions add column if not exists app_version text;
alter table public.client_versions add column if not exists user_agent text;
alter table public.client_versions add column if not exists person_id text;
alter table public.client_versions add column if not exists seen_at timestamptz;

create table if not exists public.office_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  role        text,                        -- e.g. 'Trauma coordinator'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Office digest baseline (edge function office-notifications; service role only, no policies on purpose:
-- RLS enabled with no policy = nothing readable/writable with anon or user JWTs).
create table if not exists public.office_notification_state (
  id               text primary key,          -- 'digest_snapshot'
  snapshot         jsonb,                     -- { v, days: { day: { p, b, x } }, vacations, vacSource, window, captured_at }
  last_digest_at   timestamptz,
  last_publish_at  timestamptz,
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.user_profiles           enable row level security;
alter table public.call_schedule_data      enable row level security;
alter table public.schedule_days           enable row level security;
alter table public.time_off                enable row level security;
alter table public.availability            enable row level security;
alter table public.east_feed               enable row level security;
alter table public.east_overrides          enable row level security;
alter table public.east_forecast           enable row level security;
alter table public.east_vacation_reviews   enable row level security;
alter table public.shift_trade_requests    enable row level security;
alter table public.notifications           enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_log               enable row level security;
alter table public.call_schedule_snapshots enable row level security;
alter table public.client_versions         enable row level security;
alter table public.office_contacts         enable row level security;
alter table public.office_notification_state enable row level security;
alter table public.call_offers             enable row level security;
alter table public.call_periods            enable row level security;

-- Anon-readable tables (shareable page + calendar-sync need these without a JWT)
do $$ declare t text; begin
  foreach t in array array['call_schedule_data','schedule_days','availability','east_feed','east_forecast','client_versions'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read_all', t);
    execute format('create policy %I on public.%I for select using (true)', t||'_read_all', t);
    execute format('drop policy if exists %I on public.%I', t||'_write_sched', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.silvis_is_sched()) with check (public.silvis_is_sched())', t||'_write_sched', t);
  end loop;
end $$;

-- client_versions: anon reads ONLY the 'main' row; authenticated users read all and upsert their own heartbeat row
drop policy if exists client_versions_read_all on public.client_versions;
create policy client_versions_read_all on public.client_versions for select
  using (id = 'main' or auth.uid() is not null);
drop policy if exists client_versions_heartbeat_insert on public.client_versions;
create policy client_versions_heartbeat_insert on public.client_versions for insert to authenticated
  with check (id = auth.uid()::text);
drop policy if exists client_versions_heartbeat_update on public.client_versions;
create policy client_versions_heartbeat_update on public.client_versions for update to authenticated
  using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- time_off: anon-readable (generator + shareable page), self-service writes for the surgeon's OWN rows, scheduler for all,
-- and (Prompt 16 A7) a coordinator for any row - the on-call trigger above refuses a coordinator's range like anyone's
drop policy if exists time_off_read_all on public.time_off;
create policy time_off_read_all on public.time_off for select using (true);
drop policy if exists time_off_self_insert on public.time_off;
create policy time_off_self_insert on public.time_off for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
drop policy if exists time_off_self_update on public.time_off;
create policy time_off_self_update on public.time_off for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
drop policy if exists time_off_self_delete on public.time_off;
create policy time_off_self_delete on public.time_off for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());
-- availability (Prompt 16 A7): beside the generated availability_write_sched, a coordinator may insert / update / delete any
-- row (dated statements the office relays for a surgeon; no client UI writes them outside Setup yet - the door is probed).
drop policy if exists availability_write_coord on public.availability;
create policy availability_write_coord on public.availability for all to authenticated
  using (public.silvis_is_coord()) with check (public.silvis_is_coord());

-- east_overrides: read all, write scheduler
drop policy if exists east_overrides_read on public.east_overrides;
create policy east_overrides_read on public.east_overrides for select using (true);
drop policy if exists east_overrides_write on public.east_overrides;
create policy east_overrides_write on public.east_overrides for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- east_vacation_reviews: authenticated read (NO anon policy - an anon read is a silent 200 + [],
-- which verify-rls.sh section 9 checks against the probe's fixture rows), writes own rows or scheduler
drop policy if exists east_vacation_reviews_read on public.east_vacation_reviews;
create policy east_vacation_reviews_read on public.east_vacation_reviews for select to authenticated using (true);
drop policy if exists east_vacation_reviews_self_insert on public.east_vacation_reviews;
create policy east_vacation_reviews_self_insert on public.east_vacation_reviews for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists east_vacation_reviews_self_update on public.east_vacation_reviews;
create policy east_vacation_reviews_self_update on public.east_vacation_reviews for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists east_vacation_reviews_self_delete on public.east_vacation_reviews;
create policy east_vacation_reviews_self_delete on public.east_vacation_reviews for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched());

-- user_profiles (Prompt 16 A1): a signed-in user reads their OWN row plus the scheduler / admin rows (the rows a surgeon's
-- session addresses notifications to - schedulerIdsLoud); a scheduler / admin reads every row. Self-update of display_name
-- only: role, person_id AND email are pinned against self-service (the Resend sender must never be re-pointed by its
-- owner); corrections are the admin's (user_profiles_admin; Setup -> Users is isAdmin-gated in the client).
drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or public.silvis_is_sched() or role in ('admin','scheduler'));
drop policy if exists user_profiles_self_insert on public.user_profiles;
create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'viewer' and person_id is null);   -- signup lands as viewer, unlinked; admin links + promotes
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
    and role = (select role from public.user_profiles p where p.id = auth.uid())
    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid()));   -- self-service may not re-point person_id or email
drop policy if exists user_profiles_admin on public.user_profiles;
create policy user_profiles_admin on public.user_profiles for all to authenticated
  using (public.silvis_role() = 'admin') with check (public.silvis_role() = 'admin');

-- shift_trade_requests: parties + scheduler
drop policy if exists trade_insert on public.shift_trade_requests;
create policy trade_insert on public.shift_trade_requests for insert to authenticated
  with check (from_surgeon_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists trade_read on public.shift_trade_requests;
create policy trade_read on public.shift_trade_requests for select to authenticated using (true);
drop policy if exists trade_update on public.shift_trade_requests;
create policy trade_update on public.shift_trade_requests for update to authenticated
  using (public.silvis_is_sched() or from_surgeon_id = public.silvis_person_id() or to_surgeon_id = public.silvis_person_id());

-- call_offers (2026-09-22, Prompt 14 part 1): every signed-in user reads (the group has always seen each other's offers
-- on the email chain; it is also how a surgeon sees who else offered a day); a surgeon writes only rows whose person_id
-- is their own roster id; scheduler/admin any row (relaying an email: entered_by 'scheduler', source 'email-relay');
-- (Prompt 16 A7) a coordinator ONLY while the transaction-local silvis.office_relay flag is on, which save_offers alone
-- sets - a direct REST write by a coordinator never sees it (insert 42501, update / delete 0 rows).
-- Never anon: not in the read_all loop above.
drop policy if exists call_offers_read on public.call_offers;
create policy call_offers_read on public.call_offers for select to authenticated using (true);
drop policy if exists call_offers_insert on public.call_offers;
create policy call_offers_insert on public.call_offers for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));
drop policy if exists call_offers_update on public.call_offers;
create policy call_offers_update on public.call_offers for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'))
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));
drop policy if exists call_offers_delete on public.call_offers;
create policy call_offers_delete on public.call_offers for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or (public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on'));

-- call_periods: every signed-in user reads; scheduler/admin write.
drop policy if exists call_periods_read on public.call_periods;
create policy call_periods_read on public.call_periods for select to authenticated using (true);
drop policy if exists call_periods_write on public.call_periods;
create policy call_periods_write on public.call_periods for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- notifications: authenticated read; insert by a scheduler / admin, a caller linked to a roster entry (Prompt 16 A1:
-- an unlinked account writes nothing into the group's feed) or a coordinator (Prompt 16 A7: the vacation-logged feed row);
-- delete by scheduler / admin only (spam removal; no UI yet).
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (true);
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check (public.silvis_is_sched() or public.silvis_person_id() is not null or public.silvis_is_coord());
drop policy if exists notif_delete_sched on public.notifications;
create policy notif_delete_sched on public.notifications for delete to authenticated using (public.silvis_is_sched());

-- notification_preferences: own row
drop policy if exists prefs_own on public.notification_preferences;
create policy prefs_own on public.notification_preferences for all to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());

-- audit_log: insert by a scheduler / admin, by a linked person writing as themself (actor_id = their roster id - what
-- the client's logAudit sends; Prompt 16 A1) or by a coordinator writing as itself (actor_id = auth.uid()::text - logAudit's
-- fallback for an account without a roster link; Prompt 16 A7); read by scheduler/admin (every row) and by a coordinator
-- (audit_read_coord: its own rows in the timeoff. / offers. / availability. families - the Settings Activity log for the office)
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()) or (public.silvis_is_coord() and actor_id = auth.uid()::text));
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.silvis_is_sched());
drop policy if exists audit_read_coord on public.audit_log;
create policy audit_read_coord on public.audit_log for select to authenticated
  using (public.silvis_is_coord() and actor_id = auth.uid()::text and (action like 'timeoff.%' or action like 'offers.%' or action like 'availability.%'));

-- snapshots: scheduler/admin only
drop policy if exists snap_sched on public.call_schedule_snapshots;
create policy snap_sched on public.call_schedule_snapshots for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- office_contacts: scheduler / admin read AND write (Prompt 16 A1: the client loads the table only for isScheduler; the
-- office digest reads it with the service role)
drop policy if exists contacts_read on public.office_contacts;
create policy contacts_read on public.office_contacts for select to authenticated using (public.silvis_is_sched());
drop policy if exists contacts_write on public.office_contacts;
create policy contacts_write on public.office_contacts for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- ============================================================================
-- Seed rows
-- ============================================================================
insert into public.call_schedule_data (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into public.client_versions (id, min_version, message) values ('main', null, null) on conflict (id) do nothing;
-- Office contacts are entered by hand in Setup (authenticated-read table). Template, kept commented so no
-- contact data is ever committed:
-- insert into public.office_contacts (name, email, role) values
--   ('<name>', '<email>', 'Trauma & Pediatric Quality Coordinator — maintains the ER Call Panels Word document');

-- ============================================================================
-- Verification (run after applying; expectations in comments)
-- ============================================================================
-- curl -s "$URL/rest/v1/schedule_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"      → 200 + [] or rows (anon read OK)
-- curl -s -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{"day":"2030-01-01"}' → 401/403 (anon write blocked)
-- same POST with a scheduler user's JWT                                                                                  → 201
-- After Faraz signs up: update public.user_profiles set role='admin', person_id='s1' where email='<the address you signed up with>';
-- Trigger check: insert a time_off row for a surgeon over a day they are published on → expect an ON_CALL_CONFLICT error;
--   a range starting the day AFTER a day they are published PRIMARY → ON_CALL_CONFLICT too (trailing edge);
--   the same range for a surgeon with no shifts in it → 201.
-- scripts/verify-rls.sh runs all of these (curl for the anon checks; the CLI's linked SQL for the trigger checks).
