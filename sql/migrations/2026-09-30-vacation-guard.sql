-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-30: the vacation guard (Faraz 9/30, Prompt 27: "a warning when people are taking
-- vacations and a warning that stops vacations if more than 4 people are on vacation. Need at least 2 surgeons around").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a trigger on a live, anon-readable table). One NEW trigger function
-- and one NEW trigger on public.time_off; no table, column, policy, grant, row or existing function changes - the on-call
-- trigger time_off_no_call_conflict stays as it is and still fires FIRST (Postgres fires a table's BEFORE ROW triggers in name
-- order: time_off_no_call_conflict_trg < time_off_vacation_guard_trg). sql/schema.sql mirrors every statement below (header
-- revision s, "report-first, NOT yet applied" until the record step); test/schema.test.js pins the identity.
--
-- The rule. groupRules.vacations.minSurgeonsAround in the blob (call_schedule_data 'main'): a whole number 0-99, absent / junk
-- -> 2 (helpers.js VACATION_GUARD_DEFAULTS - the live blob needs no edit; with six active surgeons at most four are off on any
-- day). Counted per calendar day over the ACTIVE roster surgeons (blob roster entries whose active is not false and whose type
-- is not 'external' - the app's poolSurgeons). A surgeon is OFF on a day inside one of his time_off rows, or inside one of his
-- East (Davenport) vacation ranges that is not reviewed 'home' (unreviewed counts as away, as everywhere in the app). A
-- vacation is refused when, on a day it takes the person off (he is active and not off that day already - by another row of
-- his or an East vacation; on an UPDATE, the days of the old row were his already, so only the NEW-minus-OLD days count),
-- fewer than minSurgeonsAround would stay around:
--   VG001 VACATION_TOO_FEW_AROUND: on 3/18, 3/19 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
-- (the days grouped by their count, the groups in the order of their first day, each as runs: "3/18", "3/18, 3/19",
-- "3/18-3/20"; helpers.js vacationGuardMessage builds the same text, so the client's refusal and the database's read the same).
--
-- What the trigger sees. (1) time_off rows - every row (it is security definer: the read does not depend on RLS; earlier rows
-- of the same multi-row INSERT are visible to the later rows' trigger, the function being volatile - the painter's bulk insert
-- is counted cumulatively). (2) East vacations: the ranges the East feed refresh caches in the east_feed payload
-- (data.vacations [{ code, start, end }], every cached week, forecast rows skipped) for an active surgeon whose East feature
-- reads busy days (blob surgeonRules.<id>.eastFeed.enabled and eastBlocksPrimary / eastBlocksBackup true, a roster code - the
-- app's eastVacationPerson; only Khan today), matched by roster CODE, minus the days a 'home' row of east_vacation_reviews
-- covers. Unreviewed and away ranges therefore count, like the app's rules (P.eastVacationDays). The one difference, on the
-- safe side: the app matches a 'home' review to the merged Davenport range exactly (helpers.derivedEastVacations), the
-- trigger reads any 'home' row covering the day - a stale 'home' row of a range Davenport changed (until the next refresh
-- deletes it) can only make the database the more lenient of the two, never refuse what the client allowed.
--
-- Who it binds. Every signed-in caller who is not the scheduler: a surgeon entering his own vacation and the office
-- COORDINATOR entering one for a surgeon (the office path is refused the same way). public.silvis_is_sched() (admin /
-- scheduler) is let through - the client asks him first ("... enter it anyway?"); so is a session with no signed-in user
-- (auth.uid() null: the SQL editor, the linked CLI, service_role - the scheduler's own tools, e.g. the seed import's time_off
-- rows, a restore). A row of a person who is not an active roster surgeon (inactive, outside, unknown) changes nobody's count
-- and passes. An UPDATE that takes the person off no new day (same person, the range kept or narrowed, a note edit) is never
-- checked - a surgeon can always shorten a vacation, also on a day already under the minimum. Deletes are never checked.
-- A missing blob (no 'main' row) reads as no roster: nothing is refused (the app cannot run without the blob anyway).
-- Concurrency: the guard takes a transaction advisory lock (one key for every vacation write) before it counts, so two
-- surgeons entering the same days at the same moment cannot both pass (read-then-write); the lock is taken before the
-- scheduler / no-user exit too, so a scheduler's row in flight is counted by the surgeon who waits for it. No cycle with
-- apply_trade / claim_open_slot (they take `lock table public.time_off in share mode` and never write time_off).
-- security definer, set search_path = public, pg_temp (the read of call_schedule_data / east_vacation_reviews must not depend
-- on the caller's RLS: an RLS-filtered read answers no rows - silently - and would count nobody off). EXECUTE keeps the
-- default grants: a trigger function cannot be called outside a trigger (PostgREST exposes no `returns trigger` function).
--
-- Blast radius: every time_off INSERT / UPDATE by a non-scheduler from the apply on - the Time off form (surgeon, coordinator),
-- its Edit, the month painter. The client that ships with this file checks the same rule BEFORE the write (the form shows who
-- else is off and how many stay around; a surgeon / the coordinator is refused with this text, the scheduler confirms), and
-- shows the database's VACATION_TOO_FEW_AROUND verbatim (describeDbError) when its own check was bypassed (a stale build, a
-- direct REST call). A day ALREADY under the minimum in live data stays as it is (nothing is deleted or re-checked); a new
-- vacation over such a day is refused for a non-scheduler - sql/probes/vacation-guard-overlimit.sql lists such days (read-only;
-- run it before the apply). The other probes' time_off fixtures (2030-03 / 04 / 05 / 08) put at most two surgeons off on a day
-- and their setups run as postgres (no signed-in user): none of them changes. No PostgREST schema-cache reload is needed (no
-- new table, column or RPC).
--
-- Apply live with the Supabase CLI (absolute path; the workdir is a directory linked with `supabase link --project-ref
-- bzhsroegtagqhutbnsrp`), or paste the file into the SQL editor as ONE session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-30-vacation-guard.sql
-- Order: pre-check `select to_regprocedure('public.time_off_vacation_guard()');` -> null, and sql/probes/vacation-guard-overlimit.sql
-- (the days already under the minimum - read, report, never changed); probe BEFORE (sql/probes/vacation-guard-probe.sql raises
-- PROBE_SETUP: time_off_vacation_guard is absent); this file; probe AFTER; `SILVIS_VACATION_GUARD_APPLIED=1 bash scripts/verify-rls.sh`
-- (sections 1-15 green); the record step (docs/SCHEMA-REVIEW.md "2026-09-30 - vacation guard").
-- Re-running: idempotent (create or replace; the trigger is dropped and re-created).
-- Rolling back = `drop trigger if exists time_off_vacation_guard_trg on public.time_off; drop function if exists public.time_off_vacation_guard();`
-- (nothing else refers to either; the client's own check stays and keeps refusing for the surgeons and the office).
-- ============================================================================

create or replace function public.time_off_vacation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  blob        jsonb;
  min_around  int := 2;
  m           numeric;
  active      text[];
  east_ids    text[];
  east_codes  text[];
  o_start     date;
  o_end       date;
  ex_old      uuid;
  over_txt    text;
begin
  -- an edit that takes the person off no new day (same person, the range kept or narrowed, a note) is never checked
  if tg_op = 'UPDATE' then
    if new.person_id = old.person_id then
      if new.start_date >= old.start_date and new.end_date <= old.end_date then
        return new;
      end if;
      o_start := old.start_date;
      o_end := old.end_date;
    end if;
    ex_old := old.id;
  end if;
  -- one vacation write at a time: two concurrent entries cannot both pass the count (read-then-write)
  perform pg_advisory_xact_lock(hashtext('time_off:vacation_guard'));
  -- the scheduler may enter one anyway (the client asks him first); so may a session with no signed-in user (the SQL editor,
  -- the linked CLI, service_role - the scheduler's own tools)
  if auth.uid() is null or public.silvis_is_sched() then
    return new;
  end if;
  select c.data into blob from public.call_schedule_data c where c.id = 'main';
  -- the minimum: groupRules.vacations.minSurgeonsAround, a whole number 0-99; absent / junk -> 2 (helpers.js VACATION_GUARD_DEFAULTS)
  if jsonb_typeof(blob #> '{groupRules,vacations,minSurgeonsAround}') = 'number' then
    m := (blob #>> '{groupRules,vacations,minSurgeonsAround}')::numeric;
    if m = trunc(m) and m >= 0 and m <= 99 then
      min_around := m::int;
    end if;
  end if;
  -- the ACTIVE roster (active is not false, not an outside surgeon) in roster order; among them the people whose East feature
  -- reads busy days (the app's eastVacationPerson: eastFeed.enabled and a blocked role, a roster code) with their codes
  select coalesce(array_agg(x.id order by x.ord), '{}'),
         coalesce(array_agg(x.id order by x.ord) filter (where x.east), '{}'),
         coalesce(array_agg(x.code order by x.ord) filter (where x.east), '{}')
    into active, east_ids, east_codes
    from (select e.r->>'id' as id, upper(coalesce(e.r->>'code', '')) as code, e.ord,
                 coalesce(e.r->>'code', '') <> ''
                   and (blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'enabled']) = 'true'::jsonb
                   and ((blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb
                     or (blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb) as east
            from jsonb_array_elements(case when jsonb_typeof(blob->'roster') = 'array' then blob->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
           where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
             and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external') x;
  -- a person who is not an active roster surgeon changes nobody's count
  if not (new.person_id = any(active)) then
    return new;
  end if;
  -- per checked day: who else is off WITHOUT this row, then the days this row takes the person off and how many stay around
  with days as (
    select g::date as day
      from generate_series(new.start_date::timestamp, new.end_date::timestamp, interval '1 day') as g
     where o_start is null or g::date not between o_start and o_end
  ),
  off_before as (
    select d.day, a.id
      from days d cross join unnest(active) as a(id)
     where exists (select 1 from public.time_off t
                    where t.person_id = a.id and t.id <> new.id and t.id is distinct from ex_old
                      and d.day between t.start_date and t.end_date)
        or (a.id = any(east_ids)
            and exists (select 1
                          from public.east_feed f
                          cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
                         where (f.data->'isForecast') is distinct from 'true'::jsonb
                           and jsonb_typeof(v.r) = 'object'
                           and upper(coalesce(v.r->>'code', '')) = east_codes[array_position(east_ids, a.id)]
                           and coalesce(v.r->>'start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                           and coalesce(v.r->>'end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                           and v.r->>'start' <= v.r->>'end'
                           and to_char(d.day, 'YYYY-MM-DD') between v.r->>'start' and v.r->>'end')
            and not exists (select 1 from public.east_vacation_reviews w
                             where w.person_id = a.id and w.decision = 'home' and d.day between w."start" and w."end"))
  ),
  per_day as (
    select d.day, cardinality(active) - 1 - (select count(*) from off_before o where o.day = d.day)::int as around
      from days d
     where not exists (select 1 from off_before o where o.day = d.day and o.id = new.person_id)
  ),
  short_days as (
    select day, around from per_day where around < min_around
  ),
  runs as (
    select around, min(day) as s, max(day) as e, count(*) as n
      from (select day, around, day - (row_number() over (partition by around order by day))::int as grp from short_days) x
     group by around, grp
  ),
  by_count as (
    select around, min(s) as first_day,
           string_agg(case when n = 1 then to_char(s, 'FMMM/FMDD')
                           when n = 2 then to_char(s, 'FMMM/FMDD') || ', ' || to_char(e, 'FMMM/FMDD')
                           else to_char(s, 'FMMM/FMDD') || '-' || to_char(e, 'FMMM/FMDD') end, ', ' order by s) as txt
      from runs
     group by around
  )
  select string_agg(txt || ' only ' || around, '; on ' order by first_day) into over_txt from by_count;
  if over_txt is not null then
    raise exception 'VACATION_TOO_FEW_AROUND: on % of % surgeons would be around (minimum %) - pick other dates or ask the scheduler',
      over_txt, cardinality(active), min_around using errcode = 'VG001';
  end if;
  return new;
end $$;

drop trigger if exists time_off_vacation_guard_trg on public.time_off;
create trigger time_off_vacation_guard_trg
  before insert or update on public.time_off
  for each row execute function public.time_off_vacation_guard();
