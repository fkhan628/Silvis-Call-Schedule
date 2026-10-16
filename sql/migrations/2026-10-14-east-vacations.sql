-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-14: East vacations for everyone signed in (Faraz 10/9, Prompt 31 Part A: "Every East
-- range reviewed 'away', and every range still 'unreviewed', shows to every signed-in role exactly like a Silvis vacation"; Faraz
-- 10/14 chose (a), "one SQL view or definer function ... that both the client and the guard trigger read"). The database half:
-- ONE SQL reading of the cached East vacation ranges, shared by the vacation guard, the signed-in display and both feed refreshes, and
-- ONE SQL definition of the days under the vacation minimum by that reading.
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a trigger function on a live, anon-readable table is re-created and five
-- functions are added). Nothing in the repo applies it: Faraz runs his apply script (kept outside the repo) and pastes the log back.
--
-- What changes. Five NEW functions and ONE re-created trigger function; no table, column, policy, trigger, row or anon surface:
--   (1) silvis_east_people() - internal: the East people of the blob (call_schedule_data 'main'), the app's eastVacationPerson read
--       the way the 9/30 guard reads it - an ACTIVE roster surgeon (active not false, type not 'external') with a roster code whose
--       surgeonRules.<id>.eastFeed has enabled true and eastBlocksPrimary or eastBlocksBackup true (JSON true; Khan today) - as
--       (person_id, code upper-cased, name, ord = roster order). Security invoker, stable; EXECUTE for the service role only.
--   (2) silvis_east_ranges() - internal: the ONE SQL port of east-feed.js eastVacations + eastMergeRanges and helpers.js
--       reviewStateFor. Per East person: every vacation entry the cache holds for his code (east_feed data.vacations, every cached
--       week; the code compared upper-cased; forecast rows skipped; an entry that is not an object, or whose start or end is not a
--       real YYYY-MM-DD date, or whose end is before its start, dropped), merged when two ranges overlap OR touch (end + 1 day >=
--       the next start), each merged range with its review state - 'away' / 'home' when an east_vacation_reviews row of the same
--       person has EXACTLY its start and end, else 'unreviewed' - as (person_id, code, start_date, end_date, state), in roster order
--       and start order. Security invoker, stable; EXECUTE for the service role only (the state never leaves the database except
--       through the scheduler's own reads of the review table).
--   (3) silvis_derived_vacations() - the away / unreviewed rows of (2) as (person_id, start_date, end_date): no state, no code, no
--       East column. Security definer (it reads east_feed and the reviews past RLS - an RLS-filtered read answers no rows, silently),
--       stable (PostgREST answers GET and POST), search_path public, pg_temp. EXECUTE for authenticated and the service role, never
--       anon. The Part A client reads it for the signed-in display (the calendar dots and the "Off:" line, the Time off list, Mine,
--       the painter's shading) and the vacation guard below reads it for its East leg.
--   (4) east_vacation_reset_stale(p_from date) - the ONE review reset both feed refreshes run (the in-app Refresh from Davenport with
--       the scheduler's token, the daily server refresh with the service role), over the current cache (2): every east_vacation_reviews
--       row of an East person whose "end" is on or after p_from and whose exact range is no longer a merged range is deleted - reason
--       'changed' when it still overlaps a merged range of his, 'removed' when it overlaps none - with one eastvac.review audit row each
--       (the client's shape: {summary, person_id, start, end, decision 'reset', reason, removed 1} plus was = the deleted decision),
--       and returned as (person_id, start_date, end_date, decision, reason) in roster order and start order. Rows of a person who is
--       not an East person are never touched; rows ending before p_from are kept (the cache keeps the ranges the time_off read
--       could not see). Security definer, volatile (POST only), search_path public, pg_temp; the transaction advisory lock
--       east_vacation_reviews:reset (one reset at a time). EXECUTE for authenticated (the body refuses everyone but the scheduler)
--       and the service role, never anon.
--   (5) silvis_vacation_short_days(p_from date, p_to date) - the ONE SQL definition of the days under the vacation minimum
--       (critic A12), by the guard's reading: the ACTIVE roster of the blob, the minimum groupRules.vacations.minSurgeonsAround (a
--       whole number 0-99, absent / junk -> 2), a surgeon off on a day one of his time_off rows or one of his derived rows (3) covers.
--       One row per day in [p_from, p_to] (a null bound is open) on which someone is off and fewer than the minimum stay around, as
--       (day, around, active, minimum, off_ids in roster order, derived_only_ids - those off that day through a derived row only), in
--       day order. On a day a non-scheduler's vacation newly takes an active surgeon off, the guard (6) refuses it exactly when this
--       lists that day once the vacation is entered (the two read the same rows; an inactive surgeon's vacation changes no day). The
--       daily server refresh writes these days (dates only) into its east.refresh audit detail when a new or changed East range puts a
--       day under the minimum (report section 3, item 2): it calls this function - never a third copy of the guard's counting - and
--       sql/probes/vacation-short-days.sql lists them for the scheduler after the apply. Security invoker, stable; EXECUTE for the
--       service role only (its ids say who is off through an East range: the server refresh and the scheduler's SQL editor / linked
--       CLI read it, a signed-in user never).
--   (6) time_off_vacation_guard() - re-created (create or replace; its trigger time_off_vacation_guard_trg is kept as it is): its East
--       leg reads (3) - an East person is off on a day one of his derived rows covers. Everything else is the 9/30 body: the
--       UPDATE exit, the advisory lock, the scheduler / no-user exit, the minimum, the active roster, the time_off leg (inline and
--       unchanged - earlier rows of a multi-row insert stay visible), the counting and the VG001 text.
--
-- Refusals (custom SQLSTATEs, HTTP 400 through PostgREST like VG / AP / NP / PS), both before any review is read or any row written:
--   EV001 EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)
--   EV002 EAST_RESET_BAD_FROM: give the first day whose reviews may be reset (nothing was deleted)
--
-- Who it binds. The derived rows: every signed-in account (surgeon, scheduler, coordinator, viewer / follower, APP) and the service
-- role; never anon (EXECUTE revoked - Supabase grants it to anon by default on every new function). The reset: the scheduler
-- (silvis_is_sched()) or a session with no signed-in user whose JWT role is not anon or authenticated (the service role, the SQL
-- editor, the linked CLI); a surgeon (Khan too), the coordinator and a viewer are refused EV001. Its audit rows: the scheduler's carry
-- his roster id (else his auth uid) and his display name (else his roster name, else Unknown), like logAudit; a no-user session's carry
-- actor_id 'cron' and actor_name 'east-feed-refresh (cron)' when the JWT role is service_role, else 'no signed-in user (SQL)' - the
-- scheduler alone reads them (audit_read). The silent-empty guard (review 10/13, critic A7) is the CALLER's: a refresh whose Davenport
-- time_off read failed, left a code unresolved, or answered no range for a code while the cache holds ranges of it in the window,
-- keeps the cache and must not call the reset (an RLS-blocked read answers 200 + [] - one such run would reset every review as
-- 'removed'). The guard binds as on 9/30: the scheduler and a no-user session pass, a surgeon and the coordinator are refused VG001.
-- The short days (5): the service role and the SQL editor / linked CLI only; every signed-in account (the scheduler's REST session too)
-- and anon are refused 42501.
--
-- Behaviour change (the guard only; Faraz 10/14, decision 3 - "one truth"). (a) The East ranges are the MERGED ones: copies of a range
-- in several cached weeks, and ranges that overlap or touch, count as one range (the same days are off either way). (b) A 'home'
-- review exempts its range only when it is exactly the merged range, as the app reads it (helpers.derivedEastVacations): a 'home' row
-- that merely covers a day - a stale review of a range Davenport changed, until the next refresh resets it - no longer exempts the
-- day, which now counts as off. Stricter in that one case only, never more lenient. (c) An entry with an impossible date (a 30
-- February) is dropped instead of compared as text; the cache's ranges come from a date column, so none can carry one. The 9/30
-- known gap stays: a review turned 'away' or a new or longer range from a feed refresh is never refused (the Part A client warns the
-- scheduler instead, and the server refresh's audit names the days - (5)). After the apply the scheduler lists such days with
-- sql/probes/vacation-short-days.sql (the guard's own reading, (5)); sql/probes/vacation-guard-overlimit.sql keeps the 9/30 reading -
-- a covering, non-exact 'home' row still exempts a day there - and is the BEFORE picture only.
--
-- Blast radius. Every time_off INSERT / UPDATE by a non-scheduler from the apply on runs the derived rows once (a materialized CTE;
-- the cache holds about ten ranges a year). The five new functions are called by no client and no edge function until the Part A
-- client ships and the server refresh is deployed. No anon surface changes: ?public=1, the share page, print, the calendar feeds, the
-- office digest, the daily reminder, the ER export, e-mails and pay keep reading time_off (and never call the new functions). The
-- other probes' fixtures are unchanged: the vacation guard probe's East ranges (2030-10) are exact, separated ranges, so verify-rls
-- section 15 reads its 20 cases as before. No PostgREST change beyond the reload at the end (the new RPCs).
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-east-vacations.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-14-east-vacations.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction, and a paste into the SQL editor runs as one session too - a failure
-- anywhere changes nothing.
-- Order: 1. pre-check sql/probes/east-vacations-precheck.sql (read-only; the objects row must read people_fn=no ranges_fn=no
-- derived_fn=no reset_fn=no short_fn=no guard=yes guard_derived=no) and sql/probes/vacation-guard-overlimit.sql (the days already
-- under the minimum by the 9/30 reading - read, never changed); 2. the function-absent check; 3. probe BEFORE
-- sql/probes/east-vacations-probe.sql (expects PROBE_SETUP: silvis_derived_vacations is absent ...); 4. this file; 5. the gate after
-- (people_fn=yes ranges_fn=yes derived_fn=yes reset_fn=yes short_fn=yes guard=yes guard_derived=yes); 6. probe AFTER (56 cases, each
-- as its header lists) and sql/probes/vacation-short-days.sql (the days under the minimum by the new reading - read, never changed);
-- 7. SILVIS_EAST_VACATIONS_APPLIED=1 bash scripts/verify-rls.sh (every section green - section 15's 20 cases unchanged, section 20
-- strict); 8. the record step in docs/SCHEMA-REVIEW.md "2026-10-14 - East vacations"; 9. the client and the server refresh on
-- Faraz's go.
-- Re-running: idempotent (create or replace; the grants re-run); the apply script refuses to re-run it anyway (its gate).
-- Rolling back (in this order - the guard first, it calls the derived rows; nothing is lost: this file writes no row):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-30-vacation-guard.sql   (the 9/30 guard body; idempotent)
--   drop function if exists public.silvis_vacation_short_days(date, date);
--   drop function if exists public.east_vacation_reset_stale(date);
--   drop function if exists public.silvis_derived_vacations();
--   drop function if exists public.silvis_east_ranges();
--   drop function if exists public.silvis_east_people();
--   notify pgrst, 'reload schema';
-- ============================================================================

create or replace function public.silvis_east_people() returns table (person_id text, code text, name text, ord bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.r ->> 'id', upper(e.r ->> 'code'), coalesce(nullif(btrim(e.r ->> 'name'), ''), e.r ->> 'id'), e.ord
    from public.call_schedule_data c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
   where c.id = 'main'
     and jsonb_typeof(e.r) = 'object' and coalesce(e.r ->> 'id', '') <> ''
     and coalesce(e.r -> 'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r ->> 'type', '') <> 'external'
     and coalesce(e.r ->> 'code', '') <> ''
     and (c.data #> array['surgeonRules', e.r ->> 'id', 'eastFeed', 'enabled']) = 'true'::jsonb
     and ((c.data #> array['surgeonRules', e.r ->> 'id', 'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb
       or (c.data #> array['surgeonRules', e.r ->> 'id', 'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb)
   order by e.ord;
$$;
revoke all on function public.silvis_east_people() from public;
revoke all on function public.silvis_east_people() from anon;
revoke all on function public.silvis_east_people() from authenticated;
grant execute on function public.silvis_east_people() to service_role;
comment on function public.silvis_east_people() is 'Prompt 31 Part A (revision x): the East people of the blob - an active roster surgeon with a code whose eastFeed is enabled and blocks a role (the app''s eastVacationPerson, strict JSON true). Internal: EXECUTE for the service role only; the definer functions call it.';

create or replace function public.silvis_east_ranges() returns table (person_id text, code text, start_date date, end_date date, state text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with entries as (
    select p.person_id, p.code, p.ord, v.r ->> 'start' as s, v.r ->> 'end' as e
      from public.silvis_east_people() p
      cross join public.east_feed f
      cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data -> 'vacations') = 'array' then f.data -> 'vacations' else '[]'::jsonb end) as v(r)
     where (f.data -> 'isForecast') is distinct from 'true'::jsonb
       and jsonb_typeof(v.r) = 'object'
       and upper(coalesce(v.r ->> 'code', '')) = p.code
  ),
  dated as (
    select x.person_id, x.code, x.ord,
           case when coalesce(x.s, '') ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and substr(x.s, 1, 4) <> '0000'
                then case when substr(x.s, 9, 2)::int <= extract(day from (substr(x.s, 1, 7) || '-01')::date + interval '1 month - 1 day')::int
                          then x.s::date end end as sd,
           case when coalesce(x.e, '') ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and substr(x.e, 1, 4) <> '0000'
                then case when substr(x.e, 9, 2)::int <= extract(day from (substr(x.e, 1, 7) || '-01')::date + interval '1 month - 1 day')::int
                          then x.e::date end end as ed
      from entries x
  ),
  valid as (
    select d.person_id, d.code, d.ord, d.sd, d.ed from dated d where d.sd is not null and d.ed is not null and d.sd <= d.ed
  ),
  marked as (
    select g.person_id, g.code, g.ord, g.sd, g.ed,
           case when max(g.ed) over (partition by g.person_id order by g.sd, g.ed rows between unbounded preceding and 1 preceding) >= g.sd - 1
                then 0 else 1 end as brk
      from valid g
  ),
  islands as (
    select k.person_id, k.code, k.ord, k.sd, k.ed,
           sum(k.brk) over (partition by k.person_id order by k.sd, k.ed rows between unbounded preceding and current row) as isl
      from marked k
  ),
  merged as (
    select i.person_id, min(i.code) as code, min(i.ord) as ord, min(i.sd) as start_date, max(i.ed) as end_date
      from islands i
     group by i.person_id, i.isl
  )
  select m.person_id, m.code, m.start_date, m.end_date,
         case w.decision when 'away' then 'away' when 'home' then 'home' else 'unreviewed' end
    from merged m
    left join public.east_vacation_reviews w on w.person_id = m.person_id and w."start" = m.start_date and w."end" = m.end_date
   order by m.ord, m.start_date;
$$;
revoke all on function public.silvis_east_ranges() from public;
revoke all on function public.silvis_east_ranges() from anon;
revoke all on function public.silvis_east_ranges() from authenticated;
grant execute on function public.silvis_east_ranges() to service_role;
comment on function public.silvis_east_ranges() is 'Prompt 31 Part A (revision x): the ONE SQL port of east-feed.js eastVacations + eastMergeRanges and helpers.js reviewStateFor - per East person the cached vacation ranges merged (overlapping or touching), each with its exact-match review state (away / home / unreviewed). Internal: EXECUTE for the service role only; read through silvis_derived_vacations and east_vacation_reset_stale.';

create or replace function public.silvis_derived_vacations() returns table (person_id text, start_date date, end_date date)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.person_id, r.start_date, r.end_date
    from public.silvis_east_ranges() r
   where r.state <> 'home'
   order by r.person_id, r.start_date;
$$;
revoke all on function public.silvis_derived_vacations() from public;
revoke all on function public.silvis_derived_vacations() from anon;
grant execute on function public.silvis_derived_vacations() to authenticated;
grant execute on function public.silvis_derived_vacations() to service_role;
comment on function public.silvis_derived_vacations() is 'Prompt 31 Part A (revision x): the derived vacation rows every signed-in role sees beside time_off - (person_id, start_date, end_date), dates only, no state and no source column. Security definer, stable (GET or POST); EXECUTE for authenticated / service_role, never anon. The vacation guard reads the same rows.';

create or replace function public.east_vacation_reset_stale(p_from date) returns table (person_id text, start_date date, end_date date, decision text, reason text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  v_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_actor  text;
  v_name   text;
  x        record;
  n        int;
begin
  if me is null then
    if v_role in ('anon', 'authenticated') then
      raise exception 'EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)' using errcode = 'EV001';
    end if;
    v_actor := 'cron';
    v_name := case when v_role = 'service_role' then 'east-feed-refresh (cron)' else 'no signed-in user (SQL)' end;
  elsif not public.silvis_is_sched() then
    raise exception 'EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)' using errcode = 'EV001';
  else
    v_actor := coalesce(public.silvis_person_id(), me::text);
    v_name := coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                       (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                         where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                       'Unknown');
  end if;
  if p_from is null then
    raise exception 'EAST_RESET_BAD_FROM: give the first day whose reviews may be reset (nothing was deleted)' using errcode = 'EV002';
  end if;
  -- one reset at a time (the in-app refresh and the server refresh may meet)
  perform pg_advisory_xact_lock(hashtext('east_vacation_reviews:reset'));
  for x in
    with cur as materialized (
      select r.person_id as pid, r.start_date as s, r.end_date as e from public.silvis_east_ranges() r
    ),
    ppl as materialized (
      select p.person_id as pid, p.name as pname, p.ord from public.silvis_east_people() p
    )
    select w.id as rid, w.person_id as pid, w."start" as s, w."end" as e, w.decision as dec, q.pname,
           case when exists (select 1 from cur c where c.pid = w.person_id and c.s <= w."end" and c.e >= w."start")
                then 'changed' else 'removed' end as why
      from public.east_vacation_reviews w
      join ppl q on q.pid = w.person_id
     where w."end" >= p_from
       and not exists (select 1 from cur c where c.pid = w.person_id and c.s = w."start" and c.e = w."end")
     order by q.ord, w."start", w."end"
  loop
    delete from public.east_vacation_reviews d where d.id = x.rid;
    get diagnostics n = row_count;
    continue when n = 0;
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (v_actor, v_name, 'eastvac.review',
            jsonb_build_object('summary', 'East vacation ' || to_char(x.s, 'YYYY-MM-DD') || '..' || to_char(x.e, 'YYYY-MM-DD') || ' ' || x.pname || ': reset (' || x.why || ')',
                               'person_id', x.pid, 'start', x.s, 'end', x.e, 'decision', 'reset', 'reason', x.why, 'removed', 1, 'was', x.dec));
    person_id := x.pid;
    start_date := x.s;
    end_date := x.e;
    decision := x.dec;
    reason := x.why;
    return next;
  end loop;
end $$;
revoke all on function public.east_vacation_reset_stale(date) from public;
revoke all on function public.east_vacation_reset_stale(date) from anon;
grant execute on function public.east_vacation_reset_stale(date) to authenticated;
grant execute on function public.east_vacation_reset_stale(date) to service_role;
comment on function public.east_vacation_reset_stale(date) is 'Prompt 31 Part A (revision x): the ONE review reset both feed refreshes run - deletes every review row of an East person ending on or after p_from whose exact range is no longer a merged cached range (changed / removed), one eastvac.review audit row each, and returns them. The scheduler or a no-user session (the service role) only: EV001; EV002 without p_from. Volatile (POST only); never anon. The caller skips it when its Davenport read failed or came back empty while the cache holds ranges.';

create or replace function public.silvis_vacation_short_days(p_from date, p_to date) returns table (day date, around int, active int, minimum int, off_ids text[], derived_only_ids text[])
language sql stable security invoker set search_path = public, pg_temp as $$
  with blob as (
    select c.data from public.call_schedule_data c where c.id = 'main'
  ),
  min_n as (
    select coalesce((select case when jsonb_typeof(b.data #> '{groupRules,vacations,minSurgeonsAround}') = 'number'
                                 then case when (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric between 0 and 99
                                            and (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric = trunc((b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric)
                                           then (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric::int end end
                       from blob b), 2) as n
  ),
  roster as (
    select e.r ->> 'id' as id, e.ord
      from blob b
      cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data -> 'roster') = 'array' then b.data -> 'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
     where jsonb_typeof(e.r) = 'object' and coalesce(e.r ->> 'id', '') <> ''
       and coalesce(e.r -> 'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r ->> 'type', '') <> 'external'
  ),
  active_n as (
    select count(*)::int as n from roster
  ),
  sources as (
    select t.person_id as id, t.start_date as s, t.end_date as e, false as derived from public.time_off t
    union all
    select dv.person_id, dv.start_date, dv.end_date, true from public.silvis_derived_vacations() dv
  ),
  off_days as (
    select g::date as d, x.id, x.derived
      from sources x
      cross join lateral generate_series(greatest(x.s, coalesce(p_from, '-infinity'::date))::timestamp,
                                         least(x.e, coalesce(p_to, 'infinity'::date))::timestamp, interval '1 day') as g
     where x.id in (select a.id from roster a)
  ),
  off_people as (
    select o.d, o.id, bool_and(o.derived) as derived_only, (select min(a.ord) from roster a where a.id = o.id) as ord
      from off_days o
     group by o.d, o.id
  )
  select p.d, (select n from active_n) - count(*)::int, (select n from active_n), (select n from min_n),
         array_agg(p.id order by p.ord, p.id),
         coalesce(array_agg(p.id order by p.ord, p.id) filter (where p.derived_only), '{}'::text[])
    from off_people p
   group by p.d
  having (select n from active_n) - count(*)::int < (select n from min_n)
   order by p.d;
$$;
revoke all on function public.silvis_vacation_short_days(date, date) from public;
revoke all on function public.silvis_vacation_short_days(date, date) from anon;
revoke all on function public.silvis_vacation_short_days(date, date) from authenticated;
grant execute on function public.silvis_vacation_short_days(date, date) to service_role;
comment on function public.silvis_vacation_short_days(date, date) is 'Prompt 31 Part A (revision x): the ONE SQL definition of the days under the vacation minimum (critic A12) - by the guard''s reading (the active roster, groupRules.vacations.minSurgeonsAround, off = a time_off row or a silvis_derived_vacations row), one row per day in [p_from, p_to] (a null bound is open) with someone off and fewer than the minimum around. The server refresh''s east.refresh audit and sql/probes/vacation-short-days.sql read it. EXECUTE for the service role only.';

create or replace function public.time_off_vacation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  blob        jsonb;
  min_around  int := 2;
  m           numeric;
  active      text[];
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
  -- the ACTIVE roster (active is not false, not an outside surgeon) in roster order; the East people and their ranges are
  -- silvis_derived_vacations()'s (Prompt 31 Part A, revision x)
  select coalesce(array_agg(x.id order by x.ord), '{}')
    into active
    from (select e.r->>'id' as id, e.ord
            from jsonb_array_elements(case when jsonb_typeof(blob->'roster') = 'array' then blob->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
           where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
             and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external') x;
  -- a person who is not an active roster surgeon changes nobody's count
  if not (new.person_id = any(active)) then
    return new;
  end if;
  -- per checked day: who else is off WITHOUT this row, then the days this row takes the person off and how many stay around;
  -- off = a time_off row (inline: earlier rows of a multi-row insert count) or a derived East vacation row (away / unreviewed,
  -- the merged range, a 'home' review only when it is exactly that range)
  with days as (
    select g::date as day
      from generate_series(new.start_date::timestamp, new.end_date::timestamp, interval '1 day') as g
     where o_start is null or g::date not between o_start and o_end
  ),
  east_off as materialized (
    select dv.person_id, dv.start_date, dv.end_date from public.silvis_derived_vacations() dv
  ),
  off_before as (
    select d.day, a.id
      from days d cross join unnest(active) as a(id)
     where exists (select 1 from public.time_off t
                    where t.person_id = a.id and t.id <> new.id and t.id is distinct from ex_old
                      and d.day between t.start_date and t.end_date)
        or exists (select 1 from east_off eo
                    where eo.person_id = a.id and d.day between eo.start_date and eo.end_date)
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

notify pgrst, 'reload schema';
