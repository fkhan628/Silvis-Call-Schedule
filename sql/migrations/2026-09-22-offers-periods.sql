-- ============================================================================
-- Prompt 14 part 1 - offers and periods (DRAFT for Faraz's review; report-first;
-- nothing here is applied until he says go). Same conventions as the rest of
-- sql/schema.sql: idempotent DDL, RLS on, helper functions silvis_person_id() /
-- silvis_is_sched(), triggers that fail closed with a stable message token.
-- ============================================================================

-- ---------- call_periods: the generation windows (a period = 3 months by default)
create table if not exists public.call_periods (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,                              -- "Nov 2026 - Jan 2027"
  start_day        date not null,
  end_day          date not null,
  offers_close_at  date not null,                              -- default start_day - 6 weeks (set by the app from groupRules.offerPeriods)
  publish_by       date not null,                              -- default start_day - 4 weeks
  status           text not null default 'upcoming' check (status in ('upcoming','closed','generated','published')),
  rules_only_ids   jsonb not null default '[]'::jsonb,         -- ["s1","s6"]: surgeons who chose "go by my rules" for this period
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_day >= start_day),
  check (offers_close_at <= start_day),
  check (jsonb_typeof(rules_only_ids) = 'array')
);
create unique index if not exists call_periods_start_idx on public.call_periods(start_day);

-- ---------- call_offers: one row per person and day ("I will cover this day")
create table if not exists public.call_offers (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,                                    -- roster id (s1..s6)
  day         date not null,
  role_pref   text not null check (role_pref in ('primary','backup','either')),
  note        text,                                             -- operational only (scrubbed on import; checked at entry)
  entered_by  text not null,                                    -- the roster id, or 'scheduler' when relaying an email
  source      text not null default 'app' check (source in ('app','email-relay','import')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (person_id, day)
);
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

-- ---------- triggers on call_offers (fail closed; the app checks the same things before the button)
--   OFFER_PAST        the day is before today in America/Chicago
--   OFFER_ON_VACATION the day lies inside one of the person's time_off ranges (mirror of time_off_no_call_conflict)
--   OFFER_FROZEN      a non-scheduler writes a day inside a period whose offers_close_at has passed
--                     (the scheduler may still enter a late offer; every row carries entered_by/source, and the
--                     app writes an audit row 'offers.save' with the count)
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
  if not public.silvis_is_sched() then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where new.day between p.start_day and p.end_day and p.offers_close_at <= today_c
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

-- Deleting an offer inside a frozen period is refused for non-schedulers the same way.
create or replace function public.call_offers_delete_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if not public.silvis_is_sched() then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where old.day between p.start_day and p.end_day and p.offers_close_at <= today_c
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

-- ---------- RLS
alter table public.call_offers  enable row level security;
alter table public.call_periods enable row level security;

-- call_offers: every signed-in user reads (the group has always seen each other's offers on the email chain);
-- a surgeon writes only rows whose person_id is their own roster id; scheduler/admin any row.
drop policy if exists call_offers_read on public.call_offers;
create policy call_offers_read on public.call_offers for select to authenticated using (true);
drop policy if exists call_offers_insert on public.call_offers;
create policy call_offers_insert on public.call_offers for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists call_offers_update on public.call_offers;
create policy call_offers_update on public.call_offers for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists call_offers_delete on public.call_offers;
create policy call_offers_delete on public.call_offers for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched());

-- call_periods: every signed-in user reads; scheduler/admin write.
drop policy if exists call_periods_read on public.call_periods;
create policy call_periods_read on public.call_periods for select to authenticated using (true);
drop policy if exists call_periods_write on public.call_periods;
create policy call_periods_write on public.call_periods for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());

-- Not anon-readable on purpose: offers carry person ids and free-text notes; anon reads stay limited to the
-- published schedule. (Both tables are inside the daily backup/snapshot scope? -> decision for part 1: snapshots
-- gain call_offers + call_periods so a restore brings the offers back; the wipe guards do not consider them.)
-- applied 2026-09-22 15:15 by hand (Claude Code, linked CLI, after Faraz's go in chat); the body above this line is the applied file, sha256 d2deac095ad18e2f245286eb6011ea49b0a3d89964ba5334e682978889c16458 (test/schema.test.js pins it; docs/SCHEMA-REVIEW.md quotes the probe observed right after)
