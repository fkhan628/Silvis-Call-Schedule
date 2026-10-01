-- ============================================================================
-- Silvis Call Schedule - vacation guard PROBE (2026-09-30, Faraz 9/30 - Prompt 27: "need at least 2 surgeons around";
-- sql/migrations/2026-09-30-vacation-guard.sql, REPORT-FIRST, NOT APPLIED). Proves the time_off trigger time_off_vacation_guard
-- on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API
-- runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation
-- in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- C1=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the fixtures, the throwaway auth users and
-- every row a case wrote roll back. After every run verify-rls.sh section 15 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/vacation-guard-probe.sql
--   (scripts/verify-rls.sh section 15 runs it, grades each case and checks nothing persisted)
--
-- BEFORE the migration the first block raises 'PROBE_SETUP: time_off_vacation_guard is absent ...' (nothing else runs). AFTER
-- it every case below must read as listed.
--
-- The roster is READ from the live blob (call_schedule_data 'main'), never written - the probe does not modify the blob, even
-- inside its transaction: the active surgeons (active not false, not type 'external') in roster order, the minimum
-- (groupRules.vacations.minSurgeonsAround, absent / junk -> 2), the East person E (the first active surgeon whose East feature
-- reads busy days - eastFeed.enabled and a blocked role, a roster code; Khan today) and n1..n5 (the first five other active
-- surgeons, roster order). The expected strings below assume the live picture P1 'active=6 min=2' (six active surgeons, the
-- default minimum) and P2 'east=yes'; verify-rls grades P1 / P2 first, so a changed roster or minimum fails there by name. The
-- inactive case uses the first inactive / outside roster entry when the roster has one (P4 'inactive=roster'), else an id
-- that is on no roster (P4 'inactive=non-roster') - either way the row is not an active surgeon's.
--
-- Fixtures are FAR-FUTURE days in 2030-10 (no live day is touched; the setup refuses to run when time_off, schedule_days,
-- east_feed or east_vacation_reviews already hold anything there), written as postgres with no signed-in user (the guard lets
-- them through): every time_off row carries a note starting 'probe-vacguard', the schedule_days rows source 'probe-vacguard',
-- the east_feed row (week 2030-09-30) data.probe 'vacguard', the east_vacation_reviews rows decided_by 'probe-vacguard' (the
-- leftover count keys on them):
--   10/01-10/08  n3, n4, n5 off; E's East ranges 10/1-10/2 (reviewed away), 10/4-10/5 (reviewed home), 10/7-10/8 (unreviewed)
--   10/09-10/13  n2, n3, n4, n5 off; schedule_days 10/13 primary n1
--   10/14-10/20  n3, n4, n5 off; n2 off 10/19-10/20
--   10/21-10/27  n3, n4, n5 off and the inactive / outside id
--   10/29        schedule_days backup n1
-- The acting users are throwaway auth.users rows (email probe-vacguard-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates: surgeon n1, surgeon n2, an unlinked coordinator and an unlinked admin. Acting as a
-- user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; no signed-in user = postgres with request.jwt.claims '{}'.
-- Errors are recorded as 'ERR <SQLSTATE> <message>' (';' in a message becomes ',').
-- VG(days) below = 'ERR VG001 VACATION_TOO_FEW_AROUND: on <days> only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler'.
--
-- Cases (AFTER the migration):
--   P1  postgres: the live roster's active count and minimum   active=6 min=2
--   P2  postgres: an East person on the roster                  east=yes
--   P3  postgres: time_off's triggers in firing (name) order and the guard's security
--                                              triggers=time_off_no_call_conflict_trg,time_off_vacation_guard_trg definer=t
--   P4  postgres: which inactive id the I case uses             inactive=roster | inactive=non-roster
--   S1  surgeon n1 enters 10/15-10/17 - the 4th off              ok
--   S2  surgeon n2 enters 10/16-10/18 - the 5th on 10/16, 10/17 (10/18 is only the 4th)
--                                              VG(10/16, 10/17)   (a range only partly over the limit names only those days)
--   S3  n1 widens his S1 row to 10/15-10/19 (10/18 the 4th, 10/19 the 5th)
--                                              VG(10/19)          (an update is checked on its NEW days only)
--   S4  n1 narrows his S1 row to 10/15-10/16  updated=1          (a narrowing is never checked)
--   E1  n1 enters 10/1 (E's East range reviewed away - counted)  VG(10/1)
--   E2  n1 enters 10/4 (E's East range reviewed home - not counted)
--                                              ok
--   E3  n1 enters 10/7 (E's East range unreviewed - counted, like away)
--                                              VG(10/7)
--   I1  n1 enters 10/22-10/23 (the inactive / outside id's row is not counted - the 4th active off)
--                                              ok
--   K1  n1 enters 10/13 - he is primary that day AND he would be the 5th off
--                                              ERR P0001 ON_CALL_CONFLICT: <n1> is on call 10/13 (primary), trade those shifts before entering this vacation
--                                              (the on-call trigger fires first)
--   K2  n1 enters 10/28-10/30 - backup on 10/29, nobody else off
--                                              ERR P0001 ON_CALL_CONFLICT: <n1> is on call 10/29 (backup), trade those shifts before entering this vacation
--                                              (the on-call rule still fires on its own)
--   C1  the coordinator enters n1 10/9-10/10 - the 5th          VG(10/9, 10/10)    (the office path is refused the same)
--   M1  the coordinator enters n1 AND n2 on 10/25 in ONE insert (the painter's bulk shape) - the second row is the 5th
--                                              VG(10/25)          (earlier rows of the statement are counted)
--   A1  the admin (the scheduler) enters n1 10/9-10/10 - the 5th
--                                              ok                 (the scheduler may; the client asks him first)
--   N1  postgres with no signed-in user enters n1 10/11 - the 5th
--                                              ok                 (the SQL editor / linked CLI / service_role pass)
--   E1-E3 read 'SKIP no East person on the roster' when the roster has none (P2 east=none - verify-rls fails P2 by name).
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  surgeon     uuid := gen_random_uuid();
  surgeon2    uuid := gen_random_uuid();
  coord       uuid := gen_random_uuid();
  admin_u     uuid := gen_random_uuid();
  blob        jsonb;
  m           numeric;
  min_around  int := 2;
  act         text[];
  east_ids    text[];
  east_codes  text[];
  e_id        text;
  e_code      text;
  n           text[];
  inact       text;
  inact_kind  text;
begin
  if to_regprocedure('public.time_off_vacation_guard()') is null
     or not exists (select 1 from pg_trigger where tgname = 'time_off_vacation_guard_trg' and tgrelid = 'public.time_off'::regclass) then
    raise exception 'PROBE_SETUP: time_off_vacation_guard is absent - sql/migrations/2026-09-30-vacation-guard.sql is not applied';
  end if;
  if exists (select 1 from public.time_off where start_date <= '2030-10-31' and end_date >= '2030-10-01')
     or exists (select 1 from public.schedule_days where day between '2030-10-01' and '2030-10-31')
     or exists (select 1 from public.east_vacation_reviews where "start" <= '2030-10-31' and "end" >= '2030-10-01')
     or exists (select 1 from public.east_feed where week_monday between '2030-09-30' and '2030-10-31') then
    raise exception 'PROBE_SETUP: live rows already sit in 2030-10 (time_off / schedule_days / east_vacation_reviews / east_feed) - the probe fixtures would collide';
  end if;
  if exists (select 1 from public.east_feed f
               cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
              where jsonb_typeof(v.r) = 'object' and coalesce(v.r->>'start', '') <= '2030-10-31' and coalesce(v.r->>'end', '') >= '2030-10-01') then
    raise exception 'PROBE_SETUP: a cached East vacation range already touches 2030-10 - the probe fixtures would collide';
  end if;
  -- the live roster and minimum, read exactly as the trigger reads them (never written)
  select c.data into blob from public.call_schedule_data c where c.id = 'main';
  if jsonb_typeof(blob #> '{groupRules,vacations,minSurgeonsAround}') = 'number' then
    m := (blob #>> '{groupRules,vacations,minSurgeonsAround}')::numeric;
    if m = trunc(m) and m >= 0 and m <= 99 then
      min_around := m::int;
    end if;
  end if;
  select coalesce(array_agg(x.id order by x.ord), '{}'),
         coalesce(array_agg(x.id order by x.ord) filter (where x.east), '{}'),
         coalesce(array_agg(x.code order by x.ord) filter (where x.east), '{}')
    into act, east_ids, east_codes
    from (select e.r->>'id' as id, upper(coalesce(e.r->>'code', '')) as code, e.ord,
                 coalesce(e.r->>'code', '') <> ''
                   and (blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'enabled']) = 'true'::jsonb
                   and ((blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb
                     or (blob #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb) as east
            from jsonb_array_elements(case when jsonb_typeof(blob->'roster') = 'array' then blob->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
           where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
             and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external') x;
  e_id := east_ids[1];
  e_code := east_codes[1];
  select coalesce(array_agg(u.x order by u.o), '{}') into n from unnest(act) with ordinality as u(x, o) where u.x is distinct from e_id;
  if cardinality(n) < 5 then
    raise exception 'PROBE_SETUP: the probe needs five active surgeons besides the East one (found %)', cardinality(n);
  end if;
  select e.r->>'id' into inact
    from jsonb_array_elements(case when jsonb_typeof(blob->'roster') = 'array' then blob->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
   where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
     and (e.r->'active' = 'false'::jsonb or e.r->>'type' = 'external')
   order by e.ord limit 1;
  inact_kind := case when inact is null then 'non-roster' else 'roster' end;
  inact := coalesce(inact, 'probe-inactive');
  -- the throwaway users
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-vacguard-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[surgeon, surgeon2, coord, admin_u]) as u;
  if (select count(*) from public.user_profiles where id in (surgeon, surgeon2, coord, admin_u)) <> 4 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = n[1], role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = n[2], role = 'surgeon' where id = surgeon2;
  update public.user_profiles set role = 'coordinator' where id = coord;
  update public.user_profiles set role = 'admin' where id = admin_u;
  insert into probe_ctx values ('surgeon', surgeon::text), ('surgeon2', surgeon2::text), ('coord', coord::text), ('admin', admin_u::text),
    ('n1', n[1]), ('n2', n[2]), ('east', coalesce(e_id, '')), ('inact_kind', inact_kind),
    ('active', cardinality(act)::text), ('min', min_around::text);
  -- the fixtures (no signed-in user: the guard lets postgres through)
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.time_off (person_id, start_date, end_date, note) values
    (n[3], '2030-10-01', '2030-10-08', 'probe-vacguard fixture'), (n[4], '2030-10-01', '2030-10-08', 'probe-vacguard fixture'), (n[5], '2030-10-01', '2030-10-08', 'probe-vacguard fixture'),
    (n[2], '2030-10-09', '2030-10-13', 'probe-vacguard fixture'), (n[3], '2030-10-09', '2030-10-13', 'probe-vacguard fixture'),
    (n[4], '2030-10-09', '2030-10-13', 'probe-vacguard fixture'), (n[5], '2030-10-09', '2030-10-13', 'probe-vacguard fixture'),
    (n[3], '2030-10-14', '2030-10-20', 'probe-vacguard fixture'), (n[4], '2030-10-14', '2030-10-20', 'probe-vacguard fixture'), (n[5], '2030-10-14', '2030-10-20', 'probe-vacguard fixture'),
    (n[2], '2030-10-19', '2030-10-20', 'probe-vacguard fixture'),
    (n[3], '2030-10-21', '2030-10-27', 'probe-vacguard fixture'), (n[4], '2030-10-21', '2030-10-27', 'probe-vacguard fixture'), (n[5], '2030-10-21', '2030-10-27', 'probe-vacguard fixture'),
    (inact, '2030-10-21', '2030-10-27', 'probe-vacguard fixture');
  insert into public.schedule_days (day, primary_id, backup_id, source)
  values ('2030-10-13', n[1], null, 'probe-vacguard'), ('2030-10-29', null, n[1], 'probe-vacguard');
  if e_id is not null then
    insert into public.east_feed (week_monday, data) values ('2030-09-30', jsonb_build_object('probe', 'vacguard', 'vacations', jsonb_build_array(
      jsonb_build_object('code', e_code, 'start', '2030-10-01', 'end', '2030-10-02'),
      jsonb_build_object('code', e_code, 'start', '2030-10-04', 'end', '2030-10-05'),
      jsonb_build_object('code', e_code, 'start', '2030-10-07', 'end', '2030-10-08'))));
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values (e_id, '2030-10-01', '2030-10-02', 'away', 'probe-vacguard'), (e_id, '2030-10-04', '2030-10-05', 'home', 'probe-vacguard');
  end if;
end $$;

-- P1-P4: as postgres - the live picture the expected strings rest on, and the apply's fingerprint
do $$ declare tv text; d boolean; begin   -- (no variable named v or k: probe_ctx's columns would be ambiguous)
  begin
    insert into probe_results values ('P1', 'active=' || (select c.v from probe_ctx c where c.k = 'active') || ' min=' || (select c.v from probe_ctx c where c.k = 'min'));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P2', 'east=' || case when (select c.v from probe_ctx c where c.k = 'east') <> '' then 'yes' else 'none' end);
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select string_agg(t.tgname::text, ',' order by t.tgname) into tv from pg_trigger t where t.tgrelid = 'public.time_off'::regclass and not t.tgisinternal;
    select p.prosecdef into d from pg_proc p where p.oid = 'public.time_off_vacation_guard()'::regprocedure;
    insert into probe_results values ('P3', 'triggers=' || coalesce(tv, '(none)') || ' definer=' || case when d then 't' else 'f' end);
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P4', 'inactive=' || (select c.v from probe_ctx c where c.k = 'inact_kind'));
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- S1-S4, E1-E3, I1, K1-K2: as the LINKED SURGEON n1 (S2 as the second surgeon n2)
do $$ declare u text; u2 text; n1 text; n2 text; ex text; rid uuid; n int; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v into u2 from probe_ctx where k = 'surgeon2';
  select v into n1 from probe_ctx where k = 'n1';
  select v into n2 from probe_ctx where k = 'n2';
  select v into ex from probe_ctx where k = 'east';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-15', '2030-10-17', 'probe-vacguard S1') returning id into rid;
    insert into probe_results values ('S1', 'ok');
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n2, '2030-10-16', '2030-10-18', 'probe-vacguard S2');
    insert into probe_results values ('S2', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    update public.time_off set end_date = '2030-10-19' where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('S3', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.time_off set end_date = '2030-10-16' where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('S4', 'updated=' || n);
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  if ex = '' then
    insert into probe_results values ('E1', 'SKIP no East person on the roster'), ('E2', 'SKIP no East person on the roster'), ('E3', 'SKIP no East person on the roster');
  else
    begin
      insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-01', '2030-10-01', 'probe-vacguard E1');
      insert into probe_results values ('E1', 'inserted (NO refusal)');
    exception when others then insert into probe_results values ('E1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
    begin
      insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-04', '2030-10-04', 'probe-vacguard E2');
      insert into probe_results values ('E2', 'ok');
    exception when others then insert into probe_results values ('E2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
    begin
      insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-07', '2030-10-07', 'probe-vacguard E3');
      insert into probe_results values ('E3', 'inserted (NO refusal)');
    exception when others then insert into probe_results values ('E3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  end if;
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-22', '2030-10-23', 'probe-vacguard I1');
    insert into probe_results values ('I1', 'ok');
  exception when others then insert into probe_results values ('I1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-13', '2030-10-13', 'probe-vacguard K1');
    insert into probe_results values ('K1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('K1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-28', '2030-10-30', 'probe-vacguard K2');
    insert into probe_results values ('K2', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('K2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1, M1: as the COORDINATOR (never linked) - the office enters a surgeon's vacation and is refused like the surgeon
do $$ declare u text; n1 text; n2 text; begin
  select v into u from probe_ctx where k = 'coord';
  select v into n1 from probe_ctx where k = 'n1';
  select v into n2 from probe_ctx where k = 'n2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-09', '2030-10-10', 'probe-vacguard C1');
    insert into probe_results values ('C1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-25', '2030-10-25', 'probe-vacguard M1'), (n2, '2030-10-25', '2030-10-25', 'probe-vacguard M1');
    insert into probe_results values ('M1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('M1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1: as the ADMIN (the scheduler) - the trigger lets silvis_is_sched() through (the client confirms first)
do $$ declare u text; n1 text; begin
  select v into u from probe_ctx where k = 'admin';
  select v into n1 from probe_ctx where k = 'n1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-09', '2030-10-10', 'probe-vacguard A1');
    insert into probe_results values ('A1', 'ok');
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1: as postgres with NO signed-in user (the SQL editor / the linked CLI / service_role)
do $$ declare n1 text; begin
  select v into n1 from probe_ctx where k = 'n1';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note) values (n1, '2030-10-11', '2030-10-11', 'probe-vacguard N1');
    insert into probe_results values ('N1', 'ok');
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
