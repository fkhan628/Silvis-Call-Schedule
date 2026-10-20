-- ============================================================================
-- Silvis Call Schedule - East vacations PROBE (2026-10-14, Faraz 10/9 - Prompt 31 Part A: Khan's East vacations seen by everyone
-- signed in; sql/migrations/2026-10-14-east-vacations.sql, REPORT-FIRST; APPLIED 2026-10-19 22:53:18Z). Proves silvis_east_people(),
-- silvis_east_ranges(), silvis_derived_vacations(), east_vacation_reset_stale(), silvis_vacation_short_days() and the re-created
-- time_off_vacation_guard() on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API runs it
-- in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation in a temp table
-- and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS P1=...;END' - the ';END' sentinel
-- marks where the CLI's own suffix begins), so the fixtures, the throwaway auth users and every row and audit row a case wrote roll
-- back. After every run verify-rls.sh section 20 counts leftovers by the probe's identity (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacations-probe.sql
--   (scripts/verify-rls.sh section 20 runs it, grades each case by name and checks nothing persisted)
--
-- The setup raises, in this order and before any fixture is written: BEFORE the migration 'PROBE_SETUP: silvis_derived_vacations is
-- absent - sql/migrations/2026-10-14-east-vacations.sql is not applied' (nothing else runs - that is every case's BEFORE result); one
-- of the other four functions absent, or the vacation guard not reading the derived rows, 'PROBE_SETUP: ... - ... is partly
-- applied'; the collision guard 'PROBE_SETUP: live rows already sit in 2031-01 .. 2031-04 ...' (a time_off, schedule_days, east_feed
-- week or review row in the fixture window, a review row ending on or after 2031-01-01 - the reset cases read every review from
-- 2031-01-01 on - or a cached East vacation entry ending on or after 2030-12-31 - it could merge with a fixture range); the roster
-- check 'PROBE_SETUP: the probe needs ...'. AFTER the migration every case below must read as listed.
-- As run: the migration was applied 2026-10-19 22:53:18Z (schema.sql revision x); the probe read PROBE_SETUP (silvis_derived_vacations
-- is absent) before it and all 56 cases below as listed after it. Until the record step verify-rls read PROBE_SETUP and the anon 404s
-- as the not-applied picture (unless its flag for the run right after the apply was set); since the record step, which dropped that
-- flag, section 20 FAILs a PROBE_SETUP or an anon 404 - the not-applied grading is history (20i still waits for the east-feed-refresh
-- deploy).
--
-- The roster is READ from the live blob (call_schedule_data 'main'), never written - not even inside the transaction: the active
-- surgeons (active not false, not type 'external') in roster order, the minimum (groupRules.vacations.minSurgeonsAround, absent /
-- junk -> 2), the East person E (the first active surgeon whose East feature blocks a role, with a roster code EC - Khan today) and
-- n1..n5 (the first five other active surgeons, roster order; N2C = n2's roster code). The expected strings assume the live picture
-- P1 'active=6 min=2' and P2 'east=yes'; verify-rls grades them first, so a changed roster or minimum fails there by name.
--
-- Fixtures: FAR-FUTURE days in 2031-01 .. 2031-03, written as postgres with no signed-in user (the guard lets them through). Every
-- time_off row carries a note starting 'probe-eastvac31', every east_feed row data.probe 'eastvac31', every east_vacation_reviews
-- row decided_by 'probe-eastvac31' (the leftover count keys on them, and on the probe's users and the eastvac.review audit rows
-- whose start lies in 2031-01 .. 2031-04):
--   time_off      n3, n4, n5 off 2031-02-01 .. 2031-03-23 (so E off makes 4 of 6 off, and n1 the 5th)
--   east_feed     2031-02-03: EC 02-03..02-04, EC 02-06..02-07, N2C 02-05..02-05 (n2 has no East feature), ZZQ 02-05..02-06 (no roster)
--                 2031-02-10: EC 02-10..02-11, EC 02-13..02-14
--                 2031-02-17: EC 02-17..02-19
--                 2031-02-24: EC 02-20..02-21 (touches the 02-17 copy), EC 02-24..02-26, EC 02-25..02-27 (overlaps it)
--                 2031-03-03: EC 02-24..02-26 (a duplicate copy), ec 03-05..03-06 (lower case), and dropped entries: EC 03-08..03-07
--                             (end before start), EC 2031-3-9..03-09 (not YYYY-MM-DD), EC 2031-02-30..03-01 (no such day), EC with a
--                             null start, a non-object entry
--                 2031-03-10: a FORECAST row (data.isForecast true) carrying EC 03-11..03-12
--                 2031-03-17: EC 03-19..03-19
--                 2031-03-24: data.vacations an object, not a list (nothing read)
--   reviews       E away 02-06..02-07, E home 02-10..02-11, E home 02-12..02-15 (covers 02-13..02-14 but is not it), E home
--                 02-17..02-21 (the merged range), E home 02-24..02-26 (one copy of the merged 02-24..02-27), E away 03-25..03-26 (no
--                 range), E away 01-27..01-28 (no range, ends before 02-01), n2 away 02-05..02-05 (not an East person)
-- So E's merged ranges in the window are 02-03..02-04 unreviewed, 02-06..02-07 away, 02-10..02-11 home, 02-13..02-14 unreviewed,
-- 02-17..02-21 home, 02-24..02-27 unreviewed, 03-05..03-06 unreviewed, 03-19..03-19 unreviewed (8; the derived rows are the 6 that
-- are not home). The acting users are four throwaway auth.users rows (email probe-eastvac31-<uuid>@example.test) whose user_profiles
-- rows the handle_new_auth_user trigger creates: U1 surgeon linked to n1, U2 an unlinked coordinator, U3 an unlinked admin
-- display_name 'probe admin', U4 an unlinked viewer. Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon:
-- SET LOCAL ROLE anon + claims ''; no signed-in user = postgres with request.jwt.claims '{}' (or '{"role":"service_role"}' /
-- '{"role":"anon"}' - the role claim PostgREST passes). Errors are recorded as 'ERR <SQLSTATE> <message>'; every ';' in a recorded
-- value becomes ','. State accumulates from case to case (each case is its own subtransaction: a refused case leaves nothing). A day
-- 'MM-DD' is 2031; a range 'MM-DD..MM-DD'. range(day) = E's merged range holding that day (silvis_east_ranges, as postgres) with its
-- state and whether silvis_derived_vacations() has it. VG(days) = 'ERR VG001 VACATION_TOO_FEW_AROUND: on <days> only 1 of 6 surgeons
-- would be around (minimum 2) - pick other dates or ask the scheduler'. reset(d) = public.east_vacation_reset_stale(d); its rows are
-- written 'MM-DD..MM-DD/<decision>/<reason>' in its order. Audit readbacks are read AS POSTGRES over the eastvac.review rows whose
-- detail start lies in 2031; 'sum=' writes E's roster name as <E>; 'actor=self' when the actor_id is the caller's uuid text.
-- short(f, t) = public.silvis_vacation_short_days(f, t) read as postgres; its days are written 'MM-DD/<around>' in day order and the
-- people off as E / n1..n5. The S cases run after the G cases (G3 / G5 / G7 / G9 / G11 entered n1 on 02-10, 02-20, 03-11, 02-05 and
-- 02-03..02-04) and before the R cases; S3 enters n1 on 02-13 and 02-25 (the days G4 / G6 refused him) and an id on no roster on 02-14
-- as postgres with no signed-in user (the guard lets the session through), every row noted 'probe-eastvac31 S3'. So every day the
-- guard refused n1 for is listed once he is off on it anyway, and every day it let him through is not (the guard's reading, one truth).
--
-- Cases (BEFORE the migration: every case - PROBE_SETUP, nothing runs; AFTER the migration - the string after '->'):
--   P1  postgres: the live roster's active count and minimum -> active=6 min=2
--   P2  postgres: an East person on the roster -> east=yes
--   P3  postgres: the five functions' security, volatility and search_path -> people=invoker/stable ranges=invoker/stable derived=definer/stable reset=definer/volatile short=invoker/stable paths=5
--   P4  postgres: who may EXECUTE them -> public=none anon=none authenticated=derived,reset service_role=derived,people,ranges,reset,short
--   P5  postgres: the derived rows' columns -> result=TABLE(person_id text, start_date date, end_date date)
--   P6  postgres: time_off's triggers in firing order, the guard's security and its East leg -> triggers=time_off_no_call_conflict_trg,time_off_vacation_guard_trg definer=t derived=yes
--   D1  range(02-03): an unreviewed range -> range=02-03..02-04 state=unreviewed derived=yes
--   D2  range(02-06): a range reviewed away (exact) -> range=02-06..02-07 state=away derived=yes
--   D3  range(02-10): a range reviewed home (exact) -> range=02-10..02-11 state=home derived=no
--   D4  range(02-13): a home review covers it but is not its exact range -> range=02-13..02-14 state=unreviewed derived=yes
--   D5  range(02-20): copies in two cached weeks that touch merge; home on the merged range -> range=02-17..02-21 state=home derived=no
--   D6  range(02-25): overlapping copies and a duplicate merge; home on one copy only -> range=02-24..02-27 state=unreviewed derived=yes
--   D7  range(03-11): an entry of a forecast row is ignored -> range=none
--   D8  range(02-05) and any other person's range in the window: n2's code (no East feature) and a code on no roster -> range=none others=0
--   D9  range(03-05): a lower-case code still matches -> range=03-05..03-06 state=unreviewed derived=yes
--   D10 E's ranges and derived rows in the window; the malformed entries' days (03-01, 03-07, 03-08, 03-09) -> ranges=8 derived=6 malformed_days=0
--   A1  U1 (surgeon n1): silvis_derived_vacations() rows of E in the window -> rows=6
--   A2  U2 (coordinator): the same -> rows=6
--   A3  U4 (viewer): the same -> rows=6
--   A4  U1: silvis_east_ranges() -> ERR 42501 permission denied for function silvis_east_ranges
--   A5  U1: silvis_east_people() -> ERR 42501 permission denied for function silvis_east_people
--   A6  anon: silvis_derived_vacations() -> ERR 42501 permission denied for function silvis_derived_vacations
--   A7  anon: reset('2099-01-01') -> ERR 42501 permission denied for function east_vacation_reset_stale
--   A8  anon: silvis_east_ranges() -> ERR 42501 permission denied for function silvis_east_ranges
--   G1  U1 enters n1 02-03 (E unreviewed - counted) -> ERR VG001 VACATION_TOO_FEW_AROUND: on 2/3 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G2  U1 enters n1 02-06 (E away - counted) -> ERR VG001 VACATION_TOO_FEW_AROUND: on 2/6 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G3  U1 enters n1 02-10 (E home, exact - not counted) -> ok
--   G4  U1 enters n1 02-13 (a home review that covers the day but is not its range no longer exempts it; the 9/30 guard let it through) -> ERR VG001 VACATION_TOO_FEW_AROUND: on 2/13 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G5  U1 enters n1 02-20 (home on the merged range of two touching copies) -> ok
--   G6  U1 enters n1 02-25 (home on one copy of an overlapping pair is stale and counts; the 9/30 guard let it through) -> ERR VG001 VACATION_TOO_FEW_AROUND: on 2/25 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G7  U1 enters n1 03-11 (only a forecast row's entry - not counted) -> ok
--   G8  U1 enters n1 03-05 (a lower-case code - counted) -> ERR VG001 VACATION_TOO_FEW_AROUND: on 3/5 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G9  U1 enters n1 02-05 (n2's code and a code on no roster - nobody else counted) -> ok
--   G10 U2 (coordinator) enters n1 02-06..02-07 -> ERR VG001 VACATION_TOO_FEW_AROUND: on 2/6, 2/7 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler
--   G11 U3 (admin = the scheduler) enters n1 02-03..02-04 -> ok
--   S1  postgres: short('2031-01-01', '2031-04-30') - G11's n1 inside E's unreviewed 02-03..02-04; 02-05, 02-10, 02-20, 03-11 stay at 2 -> days=02-03/1,02-04/1
--   S2  postgres: its 02-03 row - the counts, who is off (roster order) and who only through a derived row -> active=6 min=2 off=E,n1,n3,n4,n5 derived_only=E roster_order=yes
--   S3  postgres, no signed-in user: n1 entered on 02-13 and 02-25 and an id on no roster on 02-14, then short('2031-02-01', '2031-03-31') - a covering, non-exact or one-copy home exempts nothing (the 9/30 over-limit query would list neither day); a non-roster row counts for nobody -> days=02-03/1,02-04/1,02-13/1,02-25/1
--   S4  postgres: the bounds - (null, 02-28) from 2031-01-01 on, (02-04, null) through 2031-04-30, (02-04, 02-04), (02-05, 02-04) -> lo=02-03,02-04,02-13,02-25 hi=02-04,02-13,02-25 one=02-04 none=0
--   S5  postgres: its columns -> result=TABLE(day date, around integer, active integer, minimum integer, off_ids text[], derived_only_ids text[])
--   S6  U1 (surgeon): short('2031-01-01', '2031-04-30') -> ERR 42501 permission denied for function silvis_vacation_short_days
--   S7  anon: short('2031-01-01', '2031-04-30') -> ERR 42501 permission denied for function silvis_vacation_short_days
--   R1  U1 (surgeon): reset('2031-02-01') -> ERR EV001 EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)
--   R2  U2 (coordinator): reset('2031-02-01') -> ERR EV001 EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)
--   R3  U4 (viewer): reset('2031-02-01') -> ERR EV001 EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)
--   R4  postgres with an anon role claim and no user: reset('2031-02-01') -> ERR EV001 EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)
--   R5  postgres, no signed-in user: reset(null) -> ERR EV002 EAST_RESET_BAD_FROM: give the first day whose reviews may be reset (nothing was deleted)
--   R6  U3 (admin): reset('2031-03-01') - only rows ending on or after 03-01 -> n=1 03-25..03-26/away/removed
--   R7  its audit row -> audit=1 actor=self name=probe admin sum=East vacation 2031-03-25..2031-03-26 <E>: reset (removed) keys=decision,end,person_id,reason,removed,start,summary,was was=away
--   R8  postgres with the service_role claim: reset('2031-02-01') -> n=2 02-12..02-15/home/changed,02-24..02-26/home/changed
--   R9  their audit rows -> audit=2 actor=cron name=east-feed-refresh (cron)
--   R10 postgres, no signed-in user: reset('2031-01-01') - the row ending 01-28 is now in scope -> n=1 01-27..01-28/away/removed
--   R11 its audit row -> audit=1 actor=cron name=no signed-in user (SQL)
--   R12 postgres, no signed-in user: reset('2031-01-01') again -> n=0 audit=0
--   R13 the fixture reviews left (n2's never touched) -> kept=E 02-06..02-07 away,E 02-10..02-11 home,E 02-17..02-21 home,n2 02-05..02-05 away
--   R14 the resets wrote no time_off / east_feed row; the derived rows are unchanged -> time_off=same east_feed=same ranges=8 derived=6
-- 56 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;
grant select on probe_ctx to anon;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  u1          uuid := gen_random_uuid();
  u2          uuid := gen_random_uuid();
  u3          uuid := gen_random_uuid();
  u4          uuid := gen_random_uuid();
  blob        jsonb;
  m           numeric;
  min_around  int := 2;
  act         text[];
  e_id        text;
  e_code      text;
  e_name      text;
  n           text[];
  n2_code     text;
begin
  if to_regprocedure('public.silvis_derived_vacations()') is null then
    raise exception 'PROBE_SETUP: silvis_derived_vacations is absent - sql/migrations/2026-10-14-east-vacations.sql is not applied';
  end if;
  if to_regprocedure('public.silvis_east_people()') is null or to_regprocedure('public.silvis_east_ranges()') is null
     or to_regprocedure('public.east_vacation_reset_stale(date)') is null or to_regprocedure('public.silvis_vacation_short_days(date, date)') is null then
    raise exception 'PROBE_SETUP: silvis_east_people / silvis_east_ranges / east_vacation_reset_stale / silvis_vacation_short_days is absent - sql/migrations/2026-10-14-east-vacations.sql is partly applied';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.time_off_vacation_guard()') and p.prosrc like '%public.silvis_derived_vacations()%') then
    raise exception 'PROBE_SETUP: time_off_vacation_guard does not read silvis_derived_vacations - sql/migrations/2026-10-14-east-vacations.sql is partly applied';
  end if;
  if exists (select 1 from public.time_off where start_date <= '2031-04-30' and end_date >= '2031-01-01')
     or exists (select 1 from public.schedule_days where day between '2031-01-01' and '2031-04-30')
     or exists (select 1 from public.east_feed where week_monday between '2030-12-29' and '2031-04-30')
     or exists (select 1 from public.east_vacation_reviews where "end" >= '2031-01-01')
     or exists (select 1 from public.east_feed f
                  cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
                 where jsonb_typeof(v.r) = 'object' and coalesce(v.r->>'end', '') >= '2030-12-31') then
    raise exception 'PROBE_SETUP: live rows already sit in 2031-01 .. 2031-04 (time_off / schedule_days / east_feed / east_vacation_reviews, or a cached East vacation reaching 2030-12-31) - the probe fixtures would collide';
  end if;
  -- the live roster and minimum, read exactly as the guard reads them (never written)
  select c.data into blob from public.call_schedule_data c where c.id = 'main';
  if jsonb_typeof(blob #> '{groupRules,vacations,minSurgeonsAround}') = 'number' then
    m := (blob #>> '{groupRules,vacations,minSurgeonsAround}')::numeric;
    if m = trunc(m) and m >= 0 and m <= 99 then
      min_around := m::int;
    end if;
  end if;
  select coalesce(array_agg(x.id order by x.ord), '{}') into act
    from (select e.r->>'id' as id, e.ord
            from jsonb_array_elements(case when jsonb_typeof(blob->'roster') = 'array' then blob->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
           where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
             and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external') x;
  select p.person_id, p.code, p.name into e_id, e_code, e_name from public.silvis_east_people() p order by p.ord limit 1;
  select coalesce(array_agg(u.x order by u.o), '{}') into n from unnest(act) with ordinality as u(x, o) where u.x is distinct from e_id;
  if e_id is null or cardinality(n) < 5 then
    raise exception 'PROBE_SETUP: the probe needs an East person and five other active surgeons (found east=%, others=%)', coalesce(e_id, 'none'), cardinality(n);
  end if;
  select upper(e.r->>'code') into n2_code
    from jsonb_array_elements(blob->'roster') as e(r)
   where jsonb_typeof(e.r) = 'object' and e.r->>'id' = n[2] limit 1;
  -- the throwaway users
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-eastvac31-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, u3, u4]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, u3, u4)) <> 4 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = n[1], role = 'surgeon' where id = u1;
  update public.user_profiles set role = 'coordinator' where id = u2;
  update public.user_profiles set role = 'admin', display_name = 'probe admin' where id = u3;
  update public.user_profiles set role = 'viewer' where id = u4;
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('u3', u3::text), ('u4', u4::text),
    ('n1', n[1]), ('n2', n[2]), ('east', e_id), ('ename', e_name),
    ('active', cardinality(act)::text), ('min', min_around::text),
    ('n3', n[3]), ('n4', n[4]), ('n5', n[5]), ('act', array_to_string(act, ','));
  -- the fixtures (no signed-in user: the guard lets postgres through)
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.time_off (person_id, start_date, end_date, note) values
    (n[3], '2031-02-01', '2031-03-23', 'probe-eastvac31 fixture'), (n[4], '2031-02-01', '2031-03-23', 'probe-eastvac31 fixture'),
    (n[5], '2031-02-01', '2031-03-23', 'probe-eastvac31 fixture');
  insert into public.east_feed (week_monday, data) values
    ('2031-02-03', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-02-03', 'end', '2031-02-04'),
      jsonb_build_object('code', e_code, 'start', '2031-02-06', 'end', '2031-02-07'),
      jsonb_build_object('code', n2_code, 'start', '2031-02-05', 'end', '2031-02-05'),
      jsonb_build_object('code', 'ZZQ', 'start', '2031-02-05', 'end', '2031-02-06')))),
    ('2031-02-10', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-02-10', 'end', '2031-02-11'),
      jsonb_build_object('code', e_code, 'start', '2031-02-13', 'end', '2031-02-14')))),
    ('2031-02-17', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-02-17', 'end', '2031-02-19')))),
    ('2031-02-24', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-02-20', 'end', '2031-02-21'),
      jsonb_build_object('code', e_code, 'start', '2031-02-24', 'end', '2031-02-26'),
      jsonb_build_object('code', e_code, 'start', '2031-02-25', 'end', '2031-02-27')))),
    ('2031-03-03', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-02-24', 'end', '2031-02-26'),
      jsonb_build_object('code', lower(e_code), 'start', '2031-03-05', 'end', '2031-03-06'),
      jsonb_build_object('code', e_code, 'start', '2031-03-08', 'end', '2031-03-07'),
      jsonb_build_object('code', e_code, 'start', '2031-3-9', 'end', '2031-03-09'),
      jsonb_build_object('code', e_code, 'start', '2031-02-30', 'end', '2031-03-01'),
      jsonb_build_object('code', e_code, 'start', null, 'end', '2031-03-09'),
      to_jsonb('not an entry'::text)))),
    ('2031-03-10', jsonb_build_object('probe', 'eastvac31', 'isForecast', true, 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-03-11', 'end', '2031-03-12')))),
    ('2031-03-17', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2031-03-19', 'end', '2031-03-19')))),
    ('2031-03-24', jsonb_build_object('probe', 'eastvac31', 'vacations', jsonb_build_object('code', e_code, 'start', '2031-03-24', 'end', '2031-03-25')));
  insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by) values
    (e_id, '2031-02-06', '2031-02-07', 'away', 'probe-eastvac31'), (e_id, '2031-02-10', '2031-02-11', 'home', 'probe-eastvac31'),
    (e_id, '2031-02-12', '2031-02-15', 'home', 'probe-eastvac31'), (e_id, '2031-02-17', '2031-02-21', 'home', 'probe-eastvac31'),
    (e_id, '2031-02-24', '2031-02-26', 'home', 'probe-eastvac31'), (e_id, '2031-03-25', '2031-03-26', 'away', 'probe-eastvac31'),
    (e_id, '2031-01-27', '2031-01-28', 'away', 'probe-eastvac31'), (n[2], '2031-02-05', '2031-02-05', 'away', 'probe-eastvac31');
end $$;

-- P1-P6: as postgres - the live picture the expected strings rest on, and the apply's fingerprint
do $$ declare tv text; d boolean; tv2 text; begin   -- (no variable named v or k: probe_ctx's columns would be ambiguous)
  begin
    insert into probe_results values ('P1', 'active=' || (select c.v from probe_ctx c where c.k = 'active') || ' min=' || (select c.v from probe_ctx c where c.k = 'min'));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P2', 'east=' || case when coalesce((select c.v from probe_ctx c where c.k = 'east'), '') <> '' then 'yes' else 'none' end);
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select string_agg(f.k2 || '=' || case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 's' then 'stable' when 'v' then 'volatile' else 'immutable' end, ' ' order by f.o)
      into tv
      from (values (1, 'people', 'public.silvis_east_people()'), (2, 'ranges', 'public.silvis_east_ranges()'), (3, 'derived', 'public.silvis_derived_vacations()'), (4, 'reset', 'public.east_vacation_reset_stale(date)'),
                   (5, 'short', 'public.silvis_vacation_short_days(date, date)')) as f(o, k2, sig)
      join pg_proc p on p.oid = f.sig::regprocedure;
    select count(*)::text into tv2
      from (values ('public.silvis_east_people()'), ('public.silvis_east_ranges()'), ('public.silvis_derived_vacations()'), ('public.east_vacation_reset_stale(date)'), ('public.silvis_vacation_short_days(date, date)')) as f(sig)
      join pg_proc p on p.oid = f.sig::regprocedure
     where p.proconfig @> array['search_path=public, pg_temp'];
    insert into probe_results values ('P3', tv || ' paths=' || tv2);
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    with f(k2, sig) as (values ('people', 'public.silvis_east_people()'), ('ranges', 'public.silvis_east_ranges()'), ('derived', 'public.silvis_derived_vacations()'), ('reset', 'public.east_vacation_reset_stale(date)'),
                               ('short', 'public.silvis_vacation_short_days(date, date)'))
    select 'public=' || coalesce((select string_agg(f.k2, ',' order by f.k2) from f join pg_proc p on p.oid = f.sig::regprocedure
                                   where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 'none')
        || ' anon=' || coalesce((select string_agg(f.k2, ',' order by f.k2) from f where has_function_privilege('anon', f.sig::regprocedure, 'execute')), 'none')
        || ' authenticated=' || coalesce((select string_agg(f.k2, ',' order by f.k2) from f where has_function_privilege('authenticated', f.sig::regprocedure, 'execute')), 'none')
        || ' service_role=' || coalesce((select string_agg(f.k2, ',' order by f.k2) from f where has_function_privilege('service_role', f.sig::regprocedure, 'execute')), 'none')
      into tv;
    insert into probe_results values ('P4', tv);
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P5', 'result=' || pg_get_function_result('public.silvis_derived_vacations()'::regprocedure));
  exception when others then insert into probe_results values ('P5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select string_agg(t.tgname::text, ',' order by t.tgname) into tv from pg_trigger t where t.tgrelid = 'public.time_off'::regclass and not t.tgisinternal;
    select p.prosecdef, case when p.prosrc like '%public.silvis_derived_vacations()%' then 'yes' else 'no' end into d, tv2 from pg_proc p where p.oid = 'public.time_off_vacation_guard()'::regprocedure;
    insert into probe_results values ('P6', 'triggers=' || coalesce(tv, '(none)') || ' definer=' || case when d then 't' else 'f' end || ' derived=' || tv2);
  exception when others then insert into probe_results values ('P6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- D1-D10: as postgres - E's merged ranges (silvis_east_ranges) and derived rows (silvis_derived_vacations)
do $$ declare ex text; ck text; cday text; rs date; re date; st text; dv text; n1 int; n2 int; n3 int; begin
  select c.v into ex from probe_ctx c where c.k = 'east';
  for ck, cday in values ('D1', '2031-02-03'), ('D2', '2031-02-06'), ('D3', '2031-02-10'), ('D4', '2031-02-13'), ('D5', '2031-02-20'),
                         ('D6', '2031-02-25'), ('D7', '2031-03-11'), ('D9', '2031-03-05') loop
    begin
      rs := null; re := null; st := null;
      select r.start_date, r.end_date, r.state into rs, re, st
        from public.silvis_east_ranges() r where r.person_id = ex and cday::date between r.start_date and r.end_date;
      if rs is null then
        insert into probe_results values (ck, 'range=none');
      else
        dv := case when exists (select 1 from public.silvis_derived_vacations() x where x.person_id = ex and x.start_date = rs and x.end_date = re) then 'yes' else 'no' end;
        insert into probe_results values (ck, 'range=' || to_char(rs, 'MM-DD') || '..' || to_char(re, 'MM-DD') || ' state=' || st || ' derived=' || dv);
      end if;
    exception when others then insert into probe_results values (ck, 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  end loop;
  begin
    select count(*) into n1 from public.silvis_east_ranges() r where r.person_id = ex and '2031-02-05'::date between r.start_date and r.end_date;
    select count(*) into n2 from public.silvis_east_ranges() r where r.person_id <> ex and r.end_date >= '2031-01-01' and r.start_date <= '2031-04-30';
    insert into probe_results values ('D8', case when n1 = 0 then 'range=none' else 'range=' || n1 end || ' others=' || n2);
  exception when others then insert into probe_results values ('D8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n1 from public.silvis_east_ranges() r where r.person_id = ex and r.end_date >= '2031-01-01' and r.start_date <= '2031-04-30';
    select count(*) into n2 from public.silvis_derived_vacations() x where x.person_id = ex and x.end_date >= '2031-01-01' and x.start_date <= '2031-04-30';
    select count(*) into n3 from public.silvis_east_ranges() r, (values ('2031-03-01'::date), ('2031-03-07'::date), ('2031-03-08'::date), ('2031-03-09'::date)) as md(d)
     where r.person_id = ex and md.d between r.start_date and r.end_date;
    insert into probe_results values ('D10', 'ranges=' || n1 || ' derived=' || n2 || ' malformed_days=' || n3);
  exception when others then insert into probe_results values ('D10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- A1-A5: as the surgeon, the coordinator and the viewer (authenticated)
do $$ declare ex text; u text; ck text; n int; begin
  select c.v into ex from probe_ctx c where c.k = 'east';
  execute 'set local role authenticated';
  for ck, u in select x.k2, c.v from (values ('A1', 'u1'), ('A2', 'u2'), ('A3', 'u4')) as x(k2, uk) join probe_ctx c on c.k = x.uk loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    begin
      select count(*) into n from public.silvis_derived_vacations() x where x.person_id = ex and x.end_date >= '2031-01-01' and x.start_date <= '2031-04-30';
      insert into probe_results values (ck, 'rows=' || n);
    exception when others then insert into probe_results values (ck, 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  end loop;
  select c.v into u from probe_ctx c where c.k = 'u1';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.silvis_east_ranges();
    insert into probe_results values ('A4', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.silvis_east_people();
    insert into probe_results values ('A5', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A6-A8: as ANON (no EXECUTE on any of them)
do $$ declare n int; begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.silvis_derived_vacations();
    insert into probe_results values ('A6', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.east_vacation_reset_stale('2099-01-01');
    insert into probe_results values ('A7', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.silvis_east_ranges();
    insert into probe_results values ('A8', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- G1-G9: as the LINKED SURGEON n1 (U1), one day each
do $$ declare u text; n1 text; ck text; cday text; begin
  select c.v into u from probe_ctx c where c.k = 'u1';
  select c.v into n1 from probe_ctx c where c.k = 'n1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  for ck, cday in values ('G1', '2031-02-03'), ('G2', '2031-02-06'), ('G3', '2031-02-10'), ('G4', '2031-02-13'), ('G5', '2031-02-20'),
                         ('G6', '2031-02-25'), ('G7', '2031-03-11'), ('G8', '2031-03-05'), ('G9', '2031-02-05') loop
    begin
      insert into public.time_off (person_id, start_date, end_date, note) values (n1, cday::date, cday::date, 'probe-eastvac31 ' || ck);
      insert into probe_results values (ck, 'ok');
    exception when others then insert into probe_results values (ck, 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  end loop;
  execute 'reset role';
end $$;

-- G10: as the COORDINATOR (U2) - the office enters n1's vacation and is refused like the surgeon; G11: as the ADMIN (U3) - passes
do $$ declare u text; n1 text; begin
  select c.v into n1 from probe_ctx c where c.k = 'n1';
  execute 'set local role authenticated';
  select c.v into u from probe_ctx c where c.k = 'u2';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2031-02-06', '2031-02-07', 'probe-eastvac31 G10');
    insert into probe_results values ('G10', 'ok');
  exception when others then insert into probe_results values ('G10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  select c.v into u from probe_ctx c where c.k = 'u3';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2031-02-03', '2031-02-04', 'probe-eastvac31 G11');
    insert into probe_results values ('G11', 'ok');
  exception when others then insert into probe_results values ('G11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- S1-S7: the days under the minimum (silvis_vacation_short_days) - as postgres (S3 enters n1 on G4 / G6's days with no signed-in
-- user first), then as the surgeon U1 and as anon (no EXECUTE)
do $$ declare n1 text; u text; tv text; tv2 text; tv3 text; tv4 text; n int; begin
  select c.v into n1 from probe_ctx c where c.k = 'n1';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select string_agg(to_char(s.day, 'MM-DD') || '/' || s.around, ',' order by s.day) into tv
      from public.silvis_vacation_short_days('2031-01-01', '2031-04-30') s;
    insert into probe_results values ('S1', 'days=' || coalesce(tv, 'none'));
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'active=' || s.active || ' min=' || s.minimum
        || ' off=' || coalesce((select string_agg(l.lbl, ',' order by l.lbl) from unnest(s.off_ids) as x(id)
                                  cross join lateral (select coalesce((select case c.k when 'east' then 'E' else c.k end from probe_ctx c
                                                                        where c.k in ('east', 'n1', 'n2', 'n3', 'n4', 'n5') and c.v = x.id limit 1), '?') as lbl) l), 'none')
        || ' derived_only=' || coalesce((select string_agg(l.lbl, ',' order by l.lbl) from unnest(s.derived_only_ids) as x(id)
                                  cross join lateral (select coalesce((select case c.k when 'east' then 'E' else c.k end from probe_ctx c
                                                                        where c.k in ('east', 'n1', 'n2', 'n3', 'n4', 'n5') and c.v = x.id limit 1), '?') as lbl) l), 'none')
        || ' roster_order=' || case when s.off_ids = (select array_agg(a.id order by a.o) from unnest(string_to_array((select c.v from probe_ctx c where c.k = 'act'), ',')) with ordinality as a(id, o)
                                                        where a.id = any(s.off_ids)) then 'yes' else 'no' end
      into tv
      from public.silvis_vacation_short_days('2031-02-03', '2031-02-03') s;
    insert into probe_results values ('S2', coalesce(tv, 'no row'));
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values
      (n1, '2031-02-13', '2031-02-13', 'probe-eastvac31 S3'), (n1, '2031-02-25', '2031-02-25', 'probe-eastvac31 S3'),
      ('probe-eastvac31-nobody', '2031-02-14', '2031-02-14', 'probe-eastvac31 S3');
    select string_agg(to_char(s.day, 'MM-DD') || '/' || s.around, ',' order by s.day) into tv
      from public.silvis_vacation_short_days('2031-02-01', '2031-03-31') s;
    insert into probe_results values ('S3', 'days=' || coalesce(tv, 'none'));
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select string_agg(to_char(s.day, 'MM-DD'), ',' order by s.day) into tv from public.silvis_vacation_short_days(null, '2031-02-28') s where s.day >= '2031-01-01';
    select string_agg(to_char(s.day, 'MM-DD'), ',' order by s.day) into tv2 from public.silvis_vacation_short_days('2031-02-04', null) s where s.day <= '2031-04-30';
    select string_agg(to_char(s.day, 'MM-DD'), ',' order by s.day) into tv3 from public.silvis_vacation_short_days('2031-02-04', '2031-02-04') s;
    select count(*)::text into tv4 from public.silvis_vacation_short_days('2031-02-05', '2031-02-04') s;
    insert into probe_results values ('S4', 'lo=' || coalesce(tv, 'none') || ' hi=' || coalesce(tv2, 'none') || ' one=' || coalesce(tv3, 'none') || ' none=' || tv4);
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S5', 'result=' || pg_get_function_result('public.silvis_vacation_short_days(date, date)'::regprocedure));
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  select c.v into u from probe_ctx c where c.k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.silvis_vacation_short_days('2031-01-01', '2031-04-30');
    insert into probe_results values ('S6', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.silvis_vacation_short_days('2031-01-01', '2031-04-30');
    insert into probe_results values ('S7', 'rows=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- R1-R3: the surgeon, the coordinator and the viewer may not reset; R4 / R5: postgres with an anon role claim, and with no p_from
do $$ declare u text; ck text; n int; begin
  insert into probe_ctx values ('time_off_before', (select count(*)::text from public.time_off)), ('east_feed_before', (select md5(string_agg(f.week_monday::text || f.data::text, '|' order by f.week_monday)) from public.east_feed f));
  execute 'set local role authenticated';
  for ck, u in select x.k2, c.v from (values ('R1', 'u1'), ('R2', 'u2'), ('R3', 'u4')) as x(k2, uk) join probe_ctx c on c.k = x.uk loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    begin
      select count(*) into n from public.east_vacation_reset_stale('2031-02-01');
      insert into probe_results values (ck, 'n=' || n || ' (NO refusal)');
    exception when others then insert into probe_results values (ck, 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.east_vacation_reset_stale('2031-02-01');
    insert into probe_results values ('R4', 'n=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('R4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into n from public.east_vacation_reset_stale(null);
    insert into probe_results values ('R5', 'n=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('R5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- R6-R14: the resets that run - the admin (U3), the service role, a no-user session - and their audit rows (read as postgres)
do $$ declare u text; ex text; en text; tv text; n int; begin
  select c.v into u from probe_ctx c where c.k = 'u3';
  select c.v into ex from probe_ctx c where c.k = 'east';
  select c.v into en from probe_ctx c where c.k = 'ename';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*), string_agg(to_char(r.start_date, 'MM-DD') || '..' || to_char(r.end_date, 'MM-DD') || '/' || r.decision || '/' || r.reason, ',' order by r.start_date)
      into n, tv from public.east_vacation_reset_stale('2031-03-01') r;
    insert into probe_results values ('R6', 'n=' || n || coalesce(' ' || tv, ''));
  exception when others then insert into probe_results values ('R6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  begin
    select 'audit=' || count(*) || ' actor=' || coalesce(string_agg(distinct case when l.actor_id = u then 'self' else l.actor_id end, ','), '-')
        || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
        || ' sum=' || coalesce(string_agg(replace(l.detail ->> 'summary', en, '<E>'), ','), '-')
        || ' keys=' || coalesce((select string_agg(k2, ',' order by k2) from (select distinct jsonb_object_keys(l2.detail) as k2 from public.audit_log l2 where l2.action = 'eastvac.review' and l2.detail ->> 'start' between '2031-01-01' and '2031-04-30') kk), '-')
        || ' was=' || coalesce(string_agg(l.detail ->> 'was', ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.review' and l.detail ->> 'start' between '2031-01-01' and '2031-04-30';
    insert into probe_results values ('R7', tv);
  exception when others then insert into probe_results values ('R7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    select count(*), string_agg(to_char(r.start_date, 'MM-DD') || '..' || to_char(r.end_date, 'MM-DD') || '/' || r.decision || '/' || r.reason, ',' order by r.start_date)
      into n, tv from public.east_vacation_reset_stale('2031-02-01') r;
    insert into probe_results values ('R8', 'n=' || n || coalesce(' ' || tv, ''));
  exception when others then insert into probe_results values ('R8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'audit=' || count(*) || ' actor=' || coalesce(string_agg(distinct l.actor_id, ','), '-') || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.review' and l.detail ->> 'start' between '2031-02-01' and '2031-02-28';
    insert into probe_results values ('R9', tv);
  exception when others then insert into probe_results values ('R9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*), string_agg(to_char(r.start_date, 'MM-DD') || '..' || to_char(r.end_date, 'MM-DD') || '/' || r.decision || '/' || r.reason, ',' order by r.start_date)
      into n, tv from public.east_vacation_reset_stale('2031-01-01') r;
    insert into probe_results values ('R10', 'n=' || n || coalesce(' ' || tv, ''));
  exception when others then insert into probe_results values ('R10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'audit=' || count(*) || ' actor=' || coalesce(string_agg(distinct l.actor_id, ','), '-') || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.review' and l.detail ->> 'start' between '2031-01-01' and '2031-01-31';
    insert into probe_results values ('R11', tv);
  exception when others then insert into probe_results values ('R11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.audit_log l where l.action = 'eastvac.review' and l.detail ->> 'start' between '2031-01-01' and '2031-04-30';
    select count(*) into tv from public.east_vacation_reset_stale('2031-01-01');
    insert into probe_results values ('R12', 'n=' || tv || ' audit=' || ((select count(*) from public.audit_log l where l.action = 'eastvac.review' and l.detail ->> 'start' between '2031-01-01' and '2031-04-30') - n));
  exception when others then insert into probe_results values ('R12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select string_agg(case when w.person_id = ex then 'E' else 'n2' end || ' ' || to_char(w."start", 'MM-DD') || '..' || to_char(w."end", 'MM-DD') || ' ' || w.decision, ',' order by w.person_id = ex desc, w."start")
      into tv from public.east_vacation_reviews w where w.decided_by = 'probe-eastvac31';
    insert into probe_results values ('R13', 'kept=' || coalesce(tv, 'none'));
  exception when others then insert into probe_results values ('R13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'time_off=' || case when (select count(*)::text from public.time_off) = (select c.v from probe_ctx c where c.k = 'time_off_before') then 'same' else 'changed' end
        || ' east_feed=' || case when (select md5(string_agg(f.week_monday::text || f.data::text, '|' order by f.week_monday)) from public.east_feed f) = (select c.v from probe_ctx c where c.k = 'east_feed_before') then 'same' else 'changed' end
        || ' ranges=' || (select count(*) from public.silvis_east_ranges() r where r.person_id = ex and r.end_date >= '2031-01-01' and r.start_date <= '2031-04-30')
        || ' derived=' || (select count(*) from public.silvis_derived_vacations() x where x.person_id = ex and x.end_date >= '2031-01-01' and x.start_date <= '2031-04-30')
      into tv;
    insert into probe_results values ('R14', tv);
  exception when others then insert into probe_results values ('R14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
