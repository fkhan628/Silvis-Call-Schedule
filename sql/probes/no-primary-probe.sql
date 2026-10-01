-- ============================================================================
-- Silvis Call Schedule - no-primary days PROBE (2026-10-01, Faraz 10/1 - Prompt 28: surgeons mark their own no-primary days;
-- sql/migrations/2026-10-01-no-primary-days.sql, REPORT-FIRST, NOT APPLIED). Proves save_no_primary() and the extended
-- save_offers(... p_np_add, p_np_clear) on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API
-- runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation
-- in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- A1=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the fixtures, the throwaway auth users and
-- every row a case wrote roll back. After every run verify-rls.sh section 16 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/no-primary-probe.sql
--   (scripts/verify-rls.sh section 16 runs it, grades each case by name and checks nothing persisted)
--
-- BEFORE the migration the first block raises 'PROBE_SETUP: save_no_primary is absent - sql/migrations/2026-10-01-no-primary-days.sql
-- is not applied' (nothing else runs - that is every case's BEFORE result). AFTER it every case below must read as listed.
-- The roster is READ from the live blob (call_schedule_data 'main': s3's name in the NP008 / NP009 texts, the office's roster
-- check), never written.
--
-- Fixtures are FAR-FUTURE days in 2030-11 plus the past day 2020-04-06 (no live day is touched; the setup refuses to run when
-- availability, call_offers, schedule_days, time_off or call_periods already hold anything in 2030-11, or an availability row
-- covers 2020-04-06), written as postgres with no signed-in user (RLS bypassed; the guards let the rows through):
--   call_periods  'probe np open'   2030-11-01..2030-11-15, offers close 2030-09-01, upcoming
--                 'probe np frozen' 2030-11-16..2030-11-30, offers close 2026-09-01 (past), upcoming
--   schedule_days (source 'probe-noprimary') 11/05 primary s3; 11/06 primary s2, backup s3
--   availability  (note 'probe-noprimary', source 'setup') s3 backup_only/any 11/08 (single); 11/10-11/12 (a range);
--                 s3 unavailable/any 11/09; s3 backup_only/any 11/21 (single, inside the frozen period)
--   call_offers   (note 'probe-noprimary', entered_by 'probe', source 'app') s3 primary 11/03, backup 11/04, primary 11/13
--   time_off      (note 'probe-noprimary') s3 11/14
-- The acting users are throwaway auth.users rows (email probe-noprimary-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates: surgeon S linked to s3, an unlinked coordinator C and an admin A linked to s1. Acting
-- as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon: SET LOCAL ROLE anon + claims ''; no signed-in user
-- = postgres with request.jwt.claims '{}'. Errors are recorded as 'ERR <SQLSTATE> <message>' (';' in a message becomes ',').
-- State accumulates from case to case (each case is its own subtransaction: a refused case leaves nothing). sp(...) below =
-- public.save_offers('s3', p_rows, p_clear, p_period, p_mode, p_np_add, p_np_clear) positional; npd(...) =
-- public.save_no_primary(p_person, p_add, p_clear); "state" = 'offer=<role|none> np=<backup_only rows covering the day>';
-- <name> = s3's roster name in the live blob (Acton).
--
-- Cases (BEFORE the migration: every case - PROBE_SETUP, nothing runs; AFTER the migration - the string after '->'):
--   P1  postgres: the functions, their security, search_path, overloads, grants -> np_fn=yes np_definer=yes np_path=yes offers7=yes offers5=no offers_invoker=yes overloads=1 np_anon=no np_auth=yes offers_anon=no offers_auth=yes
--   S1  S marks 11/2, 11/7: sp([], null, null, null, {11/2, 11/7}, null) -> ok np_added=2 np_cleared=0 rows=2 src=app by=s3 role=any note=null
--   S2  S1 again (idempotent) -> ok np_added=0 np_kept=2 rows=2
--   S3  replace a Primary offer: sp([], {11/3}, null, null, {11/3}, null) -> ok deleted=1 np_added=1 offer=none np=1
--   S4  keep a Backup offer: sp([], null, null, null, {11/4}, null) -> ok np_added=1 offer=backup np=1
--   S5  lift: sp([11/7 primary], null, null, null, null, {11/7}) -> ok upserted=1 np_cleared=1 offer=primary np=0
--   S6  lift missing: sp([11/2 either], null) (11/2 still No primary) -> ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/2 and marks it No primary - keep one of the two (nothing was saved)
--   S6s state of 11/2 after S6 (rolled back) -> offer=none np=1
--   S7  mark over a Primary offer: sp([], null, null, null, {11/13}, null) -> ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/13 and marks it No primary - keep one of the two (nothing was saved)
--   S8  clear his own Setup single day 11/8 -> ok np_cleared=1 left=0
--   S9  clear 11/11, a day of the Setup range -> ERR NP007 NO_PRIMARY_RANGE: 11/11 is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements
--   S10 clear 11/9 (only an unavailable row) -> ok np_cleared=0 unavailable=1
--   S11 direct insert into availability, kind unavailable, for s3 -> ERR 42501 new row violates row-level security policy for table "availability"
--   S12 direct insert into availability, kind backup_only, for s3 -> ERR 42501 new row violates row-level security policy for table "availability"
--   S13 offer primary on a range day: sp([11/10 primary], null) -> ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/10 and marks it No primary - keep one of the two (nothing was saved)
--   V1  mark the vacation day 11/14 (no vacation refusal) -> ok np_added=1
--   H1  mark 11/5 (he holds primary) -> ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary
--   H2  mark 11/6 (he holds backup - fine) -> ok np_added=1
--   D1  mark 2020-04-06 -> ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was
--   D2  clear 2020-04-06 -> ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was
--   F1  mark 11/20 (frozen period) -> ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/20)
--   F2  clear 11/21 (frozen period) -> ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/21)
--   B1  one batch: sp([11/1 backup], null, null, null, {11/15, 11/5}, null) -> ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary
--   B1s state after B1 (the whole batch rolled back) -> offer_1101=none np_1115=0
--   B2  mark and clear 11/15 in one call -> ERR NP004 NO_PRIMARY_BAD_DAY: 11/15 is both marked and cleared in one save - nothing was saved
--   B3  '{NULL}' as p_np_add -> ERR NP004 NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved
--   R1  S: save_offers('s2', [], null, null, null, {11/2}, null) -> ERR OS002 OFFERS_NOT_YOURS: only the scheduler or the office can save another surgeon's offers
--   R2  S: npd('s2', {11/2}, null) -> ERR NP002 NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon's no-primary days
--   R3  S: npd('s3', {11/13}, null) (direct, over a Primary offer) -> ERR NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on 11/13 and marks it No primary - keep one of the two (nothing was saved)
--   O1  S: the old three-argument shape save_offers('s3', [11/1 backup], null) -> ok upserted=1 np_added=0
--   C1  C: save_offers('s3', [], null, null, null, {11/15}, null) -> ok np_added=1 src=office-relay by=self
--   C2  C: the same for 'zz' -> ERR OS004 OFFERS_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only
--   C3  C: npd('zz', {11/15}, null) -> ERR NP003 NO_PRIMARY_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only
--   C4  C: marks s3 on 11/22 (frozen) -> ERR NP006 NO_PRIMARY_FROZEN: offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/22)
--   A1  A: marks s3 on 11/23 (frozen - the scheduler is exempt) -> ok np_added=1 src=email-relay by=scheduler
--   A2  A: clears s3's frozen single day 11/21 -> ok np_cleared=1
--   A3  A: marks s3 on 11/5 (s3 holds primary) -> ERR NP008 NO_PRIMARY_ON_CALL: <name> holds primary on 11/5 - trade those days first, then mark them No primary
--   A4  A: marks s3 on 2020-04-06 (past binds the scheduler) -> ERR NP005 NO_PRIMARY_PAST: 4/6 is before today (<today M/D>) in Central time - a past day stays as it was
--   A5  A: clears s3's range day 11/11 (never split) -> ERR NP007 NO_PRIMARY_RANGE: 11/11 is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements
--   A6  A: marks s3 on 11/11 (covered by the range) -> ok np_added=0 np_kept=1
--   N1  anon: npd('s3', {11/15}, null) -> ERR 42501 permission denied for function save_no_primary
--   N2  postgres, no signed-in user: npd('s3', {11/15}, null) -> ERR NP001 NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days
-- 42 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  surgeon  uuid := gen_random_uuid();
  coord    uuid := gen_random_uuid();
  admin_u  uuid := gen_random_uuid();
begin
  if to_regprocedure('public.save_no_primary(text, date[], date[])') is null then
    raise exception 'PROBE_SETUP: save_no_primary is absent - sql/migrations/2026-10-01-no-primary-days.sql is not applied';
  end if;
  if exists (select 1 from public.availability where start_date <= '2030-11-30' and end_date >= '2030-11-01')
     or exists (select 1 from public.availability where '2020-04-06' between start_date and end_date)
     or exists (select 1 from public.call_offers where day between '2030-11-01' and '2030-11-30')
     or exists (select 1 from public.schedule_days where day between '2030-11-01' and '2030-11-30')
     or exists (select 1 from public.time_off where start_date <= '2030-11-30' and end_date >= '2030-11-01')
     or exists (select 1 from public.call_periods where start_day <= '2030-11-30' and end_day >= '2030-11-01') then
    raise exception 'PROBE_SETUP: live rows already sit in 2030-11 (availability / call_offers / schedule_days / time_off / call_periods) or an availability row covers 2020-04-06 - the probe fixtures would collide';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-noprimary-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[surgeon, coord, admin_u]) as u;
  if (select count(*) from public.user_profiles where id in (surgeon, coord, admin_u)) <> 3 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set role = 'coordinator' where id = coord;
  update public.user_profiles set person_id = 's1', role = 'admin' where id = admin_u;
  insert into probe_ctx values ('surgeon', surgeon::text), ('coord', coord::text), ('admin', admin_u::text);
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by)
  values ('probe np open', '2030-11-01', '2030-11-15', '2030-09-01', '2030-10-01', 'upcoming', 'probe'),
         ('probe np frozen', '2030-11-16', '2030-11-30', '2026-09-01', '2026-09-15', 'upcoming', 'probe');
  insert into public.schedule_days (day, primary_id, backup_id, source)
  values ('2030-11-05', 's3', null, 'probe-noprimary'), ('2030-11-06', 's2', 's3', 'probe-noprimary');
  insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by)
  values ('s3', 'backup_only', 'any', '2030-11-08', '2030-11-08', 'probe-noprimary', 'setup', 'probe'),
         ('s3', 'backup_only', 'any', '2030-11-10', '2030-11-12', 'probe-noprimary', 'setup', 'probe'),
         ('s3', 'unavailable', 'any', '2030-11-09', '2030-11-09', 'probe-noprimary', 'setup', 'probe'),
         ('s3', 'backup_only', 'any', '2030-11-21', '2030-11-21', 'probe-noprimary', 'setup', 'probe');
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  values ('s3', '2030-11-03', 'primary', 'probe-noprimary', 'probe', 'app'),
         ('s3', '2030-11-04', 'backup', 'probe-noprimary', 'probe', 'app'),
         ('s3', '2030-11-13', 'primary', 'probe-noprimary', 'probe', 'app');
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s3', '2030-11-14', '2030-11-14', 'probe-noprimary', 'probe');
end $$;

-- readbacks (plain SQL in pg_temp; every acting role reads availability and call_offers through its select policy)
create or replace function pg_temp.np_state(p_day date) returns text language sql as $$
  select 'offer=' || coalesce((select o.role_pref from public.call_offers o where o.person_id = 's3' and o.day = p_day), 'none')
      || ' np=' || (select count(*) from public.availability a where a.person_id = 's3' and a.kind = 'backup_only' and p_day between a.start_date and a.end_date);
$$;
create or replace function pg_temp.np_rows(p_days date[]) returns text language sql as $$
  select 'rows=' || count(*) || ' src=' || coalesce(string_agg(distinct a.source, ','), 'none') || ' by=' || coalesce(string_agg(distinct a.created_by, ','), 'none')
      || ' role=' || coalesce(string_agg(distinct a.role, ','), 'none') || ' note=' || case when count(*) = 0 then 'none' when bool_and(a.note is null) then 'null' else 'set' end
    from public.availability a where a.person_id = 's3' and a.kind = 'backup_only' and a.start_date = a.end_date and a.start_date = any(p_days);
$$;
create or replace function pg_temp.np_count(p_day date, p_kind text) returns bigint language sql as $$
  select count(*) from public.availability a where a.person_id = 's3' and a.kind = p_kind and p_day between a.start_date and a.end_date;
$$;

-- P1: as postgres - the functions as the migration leaves them
do $$ declare np regprocedure; o7 regprocedure; begin
  begin
    np := to_regprocedure('public.save_no_primary(text, date[], date[])');
    o7 := to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text, date[], date[])');
    insert into probe_results values ('P1',
      'np_fn=' || case when np is not null then 'yes' else 'no' end
      || ' np_definer=' || case when (select p.prosecdef from pg_proc p where p.oid = np) then 'yes' else 'no' end
      || ' np_path=' || case when (select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p where p.oid = np) then 'yes' else 'no' end
      || ' offers7=' || case when o7 is not null then 'yes' else 'no' end
      || ' offers5=' || case when to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text)') is not null then 'yes' else 'no' end
      || ' offers_invoker=' || case when (select not p.prosecdef from pg_proc p where p.oid = o7) then 'yes' else 'no' end
      || ' overloads=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_offers')
      || ' np_anon=' || case when has_function_privilege('anon', np, 'execute') then 'yes' else 'no' end
      || ' np_auth=' || case when has_function_privilege('authenticated', np, 'execute') then 'yes' else 'no' end
      || ' offers_anon=' || case when has_function_privilege('anon', o7, 'execute') then 'yes' else 'no' end
      || ' offers_auth=' || case when has_function_privilege('authenticated', o7, 'execute') then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- S1-S13, V1, H1-H2, D1-D2, F1-F2, B1-B3, R1-R3, O1: as the LINKED SURGEON S (s3)
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-02,2030-11-07}', null);
    insert into probe_results values ('S1', 'ok np_added=' || (r->>'np_added') || ' np_cleared=' || (r->>'np_cleared') || ' ' || pg_temp.np_rows('{2030-11-02,2030-11-07}'));
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-02,2030-11-07}', null);
    insert into probe_results values ('S2', 'ok np_added=' || (r->>'np_added') || ' np_kept=' || (r->>'np_kept') || ' ' || split_part(pg_temp.np_rows('{2030-11-02,2030-11-07}'), ' ', 1));
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, '{2030-11-03}', null, null, '{2030-11-03}', null);
    insert into probe_results values ('S3', 'ok deleted=' || (r->>'deleted') || ' np_added=' || (r->>'np_added') || ' ' || pg_temp.np_state('2030-11-03'));
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-04}', null);
    insert into probe_results values ('S4', 'ok np_added=' || (r->>'np_added') || ' ' || pg_temp.np_state('2030-11-04'));
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-11-07","role_pref":"primary"}]'::jsonb, null, null, null, null, '{2030-11-07}');
    insert into probe_results values ('S5', 'ok upserted=' || (r->>'upserted') || ' np_cleared=' || (r->>'np_cleared') || ' ' || pg_temp.np_state('2030-11-07'));
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-11-02","role_pref":"either"}]'::jsonb, null);
    insert into probe_results values ('S6', 'saved (NO refusal) ' || pg_temp.np_state('2030-11-02'));
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S6s', pg_temp.np_state('2030-11-02'));
  exception when others then insert into probe_results values ('S6s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-13}', null);
    insert into probe_results values ('S7', 'saved (NO refusal) ' || pg_temp.np_state('2030-11-13'));
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-08}');
    insert into probe_results values ('S8', 'ok np_cleared=' || (r->>'np_cleared') || ' left=' || pg_temp.np_count('2030-11-08', 'backup_only'));
  exception when others then insert into probe_results values ('S8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-11}');
    insert into probe_results values ('S9', 'cleared (NO refusal) np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('S9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-09}');
    insert into probe_results values ('S10', 'ok np_cleared=' || (r->>'np_cleared') || ' unavailable=' || pg_temp.np_count('2030-11-09', 'unavailable'));
  exception when others then insert into probe_results values ('S10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.availability (person_id, kind, role, start_date, end_date, source) values ('s3', 'unavailable', 'any', '2030-11-16', '2030-11-16', 'probe-noprimary');
    insert into probe_results values ('S11', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.availability (person_id, kind, role, start_date, end_date, source) values ('s3', 'backup_only', 'any', '2030-11-17', '2030-11-17', 'probe-noprimary');
    insert into probe_results values ('S12', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-11-10","role_pref":"primary"}]'::jsonb, null);
    insert into probe_results values ('S13', 'saved (NO refusal) ' || pg_temp.np_state('2030-11-10'));
  exception when others then insert into probe_results values ('S13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-14}', null);
    insert into probe_results values ('V1', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('V1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-05}', null);
    insert into probe_results values ('H1', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('H1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-06}', null);
    insert into probe_results values ('H2', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('H2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2020-04-06}', null);
    insert into probe_results values ('D1', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('D1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2020-04-06}');
    insert into probe_results values ('D2', 'ok np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('D2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-20}', null);
    insert into probe_results values ('F1', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('F1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-21}');
    insert into probe_results values ('F2', 'ok np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('F2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-11-01","role_pref":"backup"}]'::jsonb, null, null, null, '{2030-11-15,2030-11-05}', null);
    insert into probe_results values ('B1', 'ok upserted=' || (r->>'upserted') || ' np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('B1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B1s', 'offer_1101=' || coalesce((select o.role_pref from public.call_offers o where o.person_id = 's3' and o.day = '2030-11-01'), 'none')
                                       || ' np_1115=' || pg_temp.np_count('2030-11-15', 'backup_only'));
  exception when others then insert into probe_results values ('B1s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-15}', '{2030-11-15}');
    insert into probe_results values ('B2', 'ok np_added=' || (r->>'np_added') || ' np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('B2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{NULL}'::date[], null);
    insert into probe_results values ('B3', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('B3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s2', '[]'::jsonb, null, null, null, '{2030-11-02}', null);
    insert into probe_results values ('R1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('R1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_no_primary('s2', '{2030-11-02}', null);
    insert into probe_results values ('R2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('R2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_no_primary('s3', '{2030-11-13}', null);
    insert into probe_results values ('R3', 'saved (NO refusal) ' || pg_temp.np_state('2030-11-13'));
  exception when others then insert into probe_results values ('R3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-11-01","role_pref":"backup"}]'::jsonb, null);
    insert into probe_results values ('O1', 'ok upserted=' || (r->>'upserted') || ' np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('O1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C4: as the COORDINATOR C (never linked) - the office relays for a roster surgeon and is frozen like him
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'coord';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-15}', null);
    insert into probe_results values ('C1', 'ok np_added=' || (r->>'np_added') || coalesce((select ' src=' || a.source || ' by=' || case when a.created_by = auth.uid()::text then 'self' else coalesce(a.created_by, 'null') end
                                                                                          from public.availability a where a.person_id = 's3' and a.kind = 'backup_only' and a.start_date = '2030-11-15' and a.end_date = '2030-11-15' limit 1), ' (no row)'));
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('zz', '[]'::jsonb, null, null, null, '{2030-11-15}', null);
    insert into probe_results values ('C2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_no_primary('zz', '{2030-11-15}', null);
    insert into probe_results values ('C3', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-22}', null);
    insert into probe_results values ('C4', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('C4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A6: as the ADMIN A (the scheduler, linked s1) relaying for s3
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'admin';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-23}', null);
    insert into probe_results values ('A1', 'ok np_added=' || (r->>'np_added') || coalesce((select ' src=' || a.source || ' by=' || coalesce(a.created_by, 'null')
                                                                                          from public.availability a where a.person_id = 's3' and a.kind = 'backup_only' and a.start_date = '2030-11-23' and a.end_date = '2030-11-23' limit 1), ' (no row)'));
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-21}');
    insert into probe_results values ('A2', 'ok np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-05}', null);
    insert into probe_results values ('A3', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2020-04-06}', null);
    insert into probe_results values ('A4', 'ok np_added=' || (r->>'np_added'));
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, null, '{2030-11-11}');
    insert into probe_results values ('A5', 'ok np_cleared=' || (r->>'np_cleared'));
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[]'::jsonb, null, null, null, '{2030-11-11}', null);
    insert into probe_results values ('A6', 'ok np_added=' || (r->>'np_added') || ' np_kept=' || (r->>'np_kept'));
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1: as ANON (no EXECUTE); N2: as postgres with NO signed-in user (the SQL editor / the linked CLI / service_role)
do $$ declare r jsonb; begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    r := public.save_no_primary('s3', '{2030-11-15}', null);
    insert into probe_results values ('N1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    r := public.save_no_primary('s3', '{2030-11-15}', null);
    insert into probe_results values ('N2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
