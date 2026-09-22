-- ============================================================================
-- Silvis Surgical Care Call Schedule — Supabase schema + RLS
-- Project: https://bzhsroegtagqhutbnsrp.supabase.co
-- Paste into the SQL editor once. Re-runnable (IF NOT EXISTS / OR REPLACE).
-- Design notes: mirrors the Davenport app's data layer but keyed by DAY.
-- The anon key is public; every table below is either anon-READABLE by design
-- (schedule, roster/config, time off, availability, east feed, versions) or
-- locked to authenticated users with role checks. The service-role key is
-- server-side only and never appears in client code.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- helper: role of the calling user (security definer, no RLS recursion)
create table if not exists public.user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  person_id     text,                      -- roster id (s1..s6) or null for viewers
  role          text not null default 'viewer' check (role in ('admin','scheduler','surgeon','viewer')),
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

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
  source          text,                    -- import | generated | manual | east-derived | trade
  external_cover  text,                    -- e.g. 'Atwell' — covered outside the roster; renders as covered, not tallied
  note            text,
  version         integer not null default 1,   -- compare-and-swap on publish
  updated_by      text,
  updated_at      timestamptz not null default now()
);
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
  select string_agg(to_char(day, 'MM/DD') || ' (' || case when primary_id = new.person_id then 'primary' else 'backup' end || ')', ', ' order by day)
    into conflicts
    from public.schedule_days
   where day between new.start_date and new.end_date
     and (primary_id = new.person_id or backup_id = new.person_id);
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

-- ---------- notifications, prefs, audit, snapshots, versions, contacts
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  title       text not null,
  message     text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

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

create table if not exists public.call_schedule_snapshots (
  id          uuid primary key default gen_random_uuid(),
  reason      text,
  data        jsonb not null,              -- { config, schedule_days[], time_off[], availability[] }
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.client_versions (
  id           text primary key,           -- 'main'
  min_version  text,
  message      text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.office_contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  role        text,                        -- e.g. 'Trauma coordinator'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
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
alter table public.shift_trade_requests    enable row level security;
alter table public.notifications           enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_log               enable row level security;
alter table public.call_schedule_snapshots enable row level security;
alter table public.client_versions         enable row level security;
alter table public.office_contacts         enable row level security;

-- Anon-readable tables (shareable page + calendar-sync need these without a JWT)
do $$ declare t text; begin
  foreach t in array array['call_schedule_data','schedule_days','availability','east_feed','client_versions'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read_all', t);
    execute format('create policy %I on public.%I for select using (true)', t||'_read_all', t);
    execute format('drop policy if exists %I on public.%I', t||'_write_sched', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.silvis_is_sched()) with check (public.silvis_is_sched())', t||'_write_sched', t);
  end loop;
end $$;

-- time_off: anon-readable (generator + shareable page), self-service writes for the surgeon's OWN rows, scheduler for all
drop policy if exists time_off_read_all on public.time_off;
create policy time_off_read_all on public.time_off for select using (true);
drop policy if exists time_off_self_insert on public.time_off;
create policy time_off_self_insert on public.time_off for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists time_off_self_update on public.time_off;
create policy time_off_self_update on public.time_off for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists time_off_self_delete on public.time_off;
create policy time_off_self_delete on public.time_off for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched());

-- east_overrides: read all, write scheduler
drop policy if exists east_overrides_read on public.east_overrides;
create policy east_overrides_read on public.east_overrides for select using (true);
drop policy if exists east_overrides_write on public.east_overrides;
create policy east_overrides_write on public.east_overrides for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- user_profiles: authenticated read; self-update of display fields; role/person changes admin-only
drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles for select to authenticated using (true);
drop policy if exists user_profiles_self_insert on public.user_profiles;
create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'viewer');           -- signup lands as viewer; admin promotes
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.user_profiles p where p.id = auth.uid()));
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

-- notifications: authenticated read + insert
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (true);
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated with check (true);

-- notification_preferences: own row
drop policy if exists prefs_own on public.notification_preferences;
create policy prefs_own on public.notification_preferences for all to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());

-- audit_log: insert by authenticated, read by scheduler/admin
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated with check (true);
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.silvis_is_sched());

-- snapshots: scheduler/admin only
drop policy if exists snap_sched on public.call_schedule_snapshots;
create policy snap_sched on public.call_schedule_snapshots for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- office_contacts: authenticated read, scheduler write
drop policy if exists contacts_read on public.office_contacts;
create policy contacts_read on public.office_contacts for select to authenticated using (true);
drop policy if exists contacts_write on public.office_contacts;
create policy contacts_write on public.office_contacts for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- ============================================================================
-- Seed rows
-- ============================================================================
insert into public.call_schedule_data (id, data) values ('main', '{}'::jsonb) on conflict (id) do nothing;
insert into public.client_versions (id, min_version, message) values ('main', null, null) on conflict (id) do nothing;
-- Office-contact seed: contact data is kept out of the public repo (Faraz 9/21). After applying the schema, add
-- the ER-panel author either in Settings → Office contacts or with this template, filling in her MercyOne address:
-- insert into public.office_contacts (name, email, role) values
--   ('the ER-panel author, RN, TNS', '<mercyone address>', 'Trauma & Pediatric Quality Coordinator — maintains the ER Call Panels Word document')
-- on conflict do nothing;

-- ============================================================================
-- Verification (run after applying; expectations in comments)
-- ============================================================================
-- curl -s "$URL/rest/v1/schedule_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"      → 200 + [] or rows (anon read OK)
-- curl -s -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{"day":"2030-01-01"}' → 401/403 (anon write blocked)
-- same POST with a scheduler user's JWT                                                                                  → 201
-- After Faraz signs up: update public.user_profiles set role='admin', person_id='s1' where email='<the address you signed up with>';
-- Trigger check: insert a time_off row for a surgeon over a day they are published on → expect an ON_CALL_CONFLICT error;
--   the same range for a surgeon with no shifts in it → 201.
