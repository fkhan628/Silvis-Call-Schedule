-- ============================================================================
-- Silvis Call Schedule - APP call days PROBE (2026-10-02, Faraz 10/1 - Prompt 29: the APPs put themselves on call days;
-- sql/migrations/2026-10-02-app-call-days.sql, REPORT-FIRST; APPLIED 2026-10-02 19:19:27Z). Proves app_call_days, save_app_days(),
-- app_call_names(), silvis_is_app() and the user_profiles.is_app pins on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API
-- runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation
-- in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- A1=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the throwaway auth users, their profiles and
-- every row and audit row a case wrote roll back. After every run verify-rls.sh section 18 counts leftovers by the probe's
-- identity - its auth users, its audit rows and app_call_days rows in its window (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/app-call-days-probe.sql
--   (scripts/verify-rls.sh section 18 runs it, grades each case by name and checks nothing persisted)
--
-- The setup raises, in this order and before any fixture is written: BEFORE the migration 'PROBE_SETUP: app_call_days is absent -
-- sql/migrations/2026-10-02-app-call-days.sql is not applied' (nothing else runs - that is every case's BEFORE result); a table
-- without the column 'PROBE_SETUP: user_profiles.is_app is absent - ... is partly applied'; then the collision guard (it reads the
-- table, so it cannot run before it exists): any app_call_days row in 2030-12 or on 2020-05-04 raises 'PROBE_SETUP: live rows
-- already sit in the probe window ...'. AFTER the migration every case below must read as listed.
-- As run: the migration was applied 2026-10-02 19:19:27Z (schema.sql revision v); the probe read PROBE_SETUP (app_call_days is
-- absent) before it and all 69 cases below as listed after it (<today M/D> = 10/2). Until the record step verify-rls read
-- PROBE_SETUP and the anon 404s as the not-applied picture (unless its flag for the run right after the apply was set); since the
-- record step, which dropped that flag, section 18 FAILs a PROBE_SETUP or an anon 404 - the not-applied grading is history.
--
-- Fixtures: no app_call_days row is written by the setup. Every day a case touches is FAR-FUTURE (2030-12, and 2031-01-01 ..
-- 2032-02-05 for the refused 401-day case), the past day 2020-05-04 or infinity / -infinity (A17, refused before any write).
-- The acting users are six throwaway auth.users rows (email probe-appdays-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates; postgres then
-- sets them: U1 viewer + is_app 'probe app one'; U2 viewer + is_app 'probe app two'; US surgeon linked to s3 'probe surgeon';
-- UC coordinator 'probe office'; UV viewer (not an APP) 'probe viewer'; UA admin linked to s1 'probe admin'. Acting as a user:
-- SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon: SET LOCAL ROLE anon + claims ''; no signed-in user = postgres with
-- request.jwt.claims '{}'. Errors are recorded as 'ERR <SQLSTATE> <message>'; every ';' in a recorded value (an error or a readback)
-- becomes ',' (the case separator). State accumulates from case to case (each case is its own subtransaction: a refused case
-- leaves nothing). sad(...) below = public.save_app_days(p_profile, p_add, p_clear[, p_replace]) positional.
-- Readbacks - stable against live data (verify-rls 18 runs this probe on every later run, when real APP accounts and APP days
-- exist): '<M/D>=<tag>/<source>' with tag one (U1) / two (U2) / other, or '<M/D>=none' (no row); 'by=' the writer of the rows
-- (admin = UA, self = the caller, else other); 'rows=' = the app_call_days rows in 2030-12 the acting role can see; 'names=' = the
-- rows of app_call_names() as the acting role whose profile_id is one of the six probe users ('self=yes' when the caller's own id
-- is among them; 'one=' / 'two=' = U1's / U2's display name, or app / former for the scheduler's flag readbacks). Audit readbacks
-- are read AS POSTGRES (the role reset inside the case) over the appdays.save rows whose detail->>'profile_id' is a probe user:
-- 'audit=' / 'audit_rows=' the count; 'actor=' (self = the caller's uuid, else the actor_id), 'name=' the actor_name, 'sums=' that
-- actor's summaries joined by ' | ' in text order (the rows of one transaction share created_at, so time cannot order them);
-- 'last=' the summary of the row whose detail->'replaced' is not empty.
--
-- Cases (BEFORE the migration: every case - PROBE_SETUP, nothing runs; AFTER the migration - the string after '->'):
--   P1  postgres: the table, its RLS, key, cascade, policy and privileges -> table=yes rls=yes pk=day fk=cascade policies=app_call_days_read/select/authenticated anon_sel=no auth_sel=yes auth_write=no
--   P2  postgres: the three functions, security, search_path, volatility, grants -> save_definer=yes names_definer=yes isapp_definer=yes paths=3 names_stable=yes save_volatile=yes save_anon=no save_auth=yes names_anon=no names_auth=yes isapp_anon=no isapp_auth=yes
--   P3  postgres: user_profiles.is_app, its check and the two self pins -> is_app=boolean not_null=yes default=false check=user_profiles_app_viewer self_pins=2
--   A1  U1 sad(null, {12/2, 12/3, 12/11}, null) -> ok added=3 removed=0 kept=0 source=app 12/2=one/app 12/3=one/app 12/11=one/app by=self
--   A2  its audit row -> audit=1 actor=self name=probe app one sums=probe app one: on call 12/2, 12/3, 12/11
--   A3  U1 sad(U1, {12/2, 12/3}, null) (idempotent) -> ok added=0 kept=2 audit=false audit_rows=1
--   A4  U1 sad(U1, null, {12/3}) -> ok removed=1 12/3=none sums=probe app one: on call 12/2, 12/3, 12/11 | probe app one: removed 12/3
--   A5  U1 sad(U1, null, {12/4}) (nobody holds it) -> ok removed=0 absent=1 audit=false
--   A6  U1 adds and removes 12/4 in one call -> ERR AP004 APP_DAY_BAD_DAY: 12/4 is both added and removed in one save - nothing was saved
--   A7  U1 '{NULL}' as p_add -> ERR AP004 APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved
--   A8  U1 adds 401 days (2031-01-01 .. 2032-02-05) -> ERR AP004 APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved
--   A9  U1 adds 2020-05-04 -> ERR AP006 APP_DAY_PAST: 5/4 is before today (<today M/D>) in Central time - a past day stays as it was
--   A10 U1 adds {12/5} and removes 2020-05-04 -> ERR AP006 APP_DAY_PAST: 5/4 is before today (<today M/D>) in Central time - a past day stays as it was
--   A10s state of 12/5 after A10 (all or nothing) -> 12/5=none
--   A11 U1 sad(U2, {12/5}, null) -> ERR AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler
--   A12 U1 sad(U1, {12/5}, null, true) -> ERR AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day
--   A13 U1 direct insert into app_call_days -> ERR 42501 permission denied for table app_call_days
--   A14 U1 direct delete of its own row 12/2 -> ERR 42501 permission denied for table app_call_days
--   A15 U1 reads the window -> rows=2
--   A16 U1 app_call_names() -> names=1 self=yes
--   A17 U1 adds -infinity and removes infinity -> ERR AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved
--   A18 U1 (an APP) renames itself -> ERR 42501 new row violates row-level security policy for table "user_profiles"
--   A19 U1 sets its own display_name to the same value -> updated=1
--   B1  U2 sad(null, {12/2}, null) -> ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved
--   B1s state of 12/2 after B1 -> 12/2=one/app
--   B2  U2 sad(U2, {12/7, 12/8}, null) -> ok added=2 source=app 12/7=two/app 12/8=two/app
--   B3  U2 sad(U2, null, {12/2}) -> ERR AP002 APP_DAY_NOT_YOURS: 12/2 is probe app one's day - only that APP or the scheduler can remove it (nothing was saved)
--   B4  U2 sad(U2, {12/9, 12/2, 12/11}, null) -> ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one, 12/11 already has probe app one - nothing was saved
--   B4s state of 12/9 after B4 -> 12/9=none
--   B5  U2 app_call_names() -> names=2
--   S1  US sad(null, {12/10}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   S2  US sad(U1, {12/10}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   S3  US reads the window -> rows=4
--   S4  US direct insert into app_call_days -> ERR 42501 permission denied for table app_call_days
--   S5  US app_call_names() -> names=2 one=probe app one two=probe app two
--   C1  UC sad(U1, {12/10}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   C2  UC reads the window -> rows=4
--   V1  UV sad(null, {12/10}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   V2  UV reads the window -> rows=4
--   V3  UV sets its own is_app = true -> ERR 42501 new row violates row-level security policy for table "user_profiles"
--   V4  UV sets its own display_name to the same value -> updated=1
--   D1  UA sad(U2, {12/10}, null) -> ok added=1 source=scheduler 12/10=two/scheduler by=admin
--   D2  its audit row -> actor=s1 name=probe admin sums=probe app two: on call 12/10
--   D3  UA sad(U2, null, {12/10}) -> ok removed=1 12/10=none
--   D4  UA sad(U1, {2020-05-04}, null) (past - the scheduler is exempt) -> ok added=1 5/4=one/scheduler
--   D5  UA sad(U1, null, {2020-05-04}) -> ok removed=1 5/4=none
--   D6  UA sad(U2, {12/2}, null) -> ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved
--   D7  UA sad(U2, {12/2}, null, true) -> ok added=1 replaced=1 12/2=two/scheduler last=probe app two: on call 12/2 (was probe app one)
--   D8  UA sad(U1, null, {12/2}) (U2 holds it) -> ERR AP007 APP_DAY_STALE: 12/2 is probe app two's day - reload the calendar (nothing was saved)
--   D9  UA sad(UV, {12/12}, null) -> ERR AP003 APP_DAY_NOT_APP: probe viewer is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   D10 UA sad(<a random uuid>, {12/12}, null) -> ERR AP003 APP_DAY_NOT_APP: that account is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   D11 UA sad(null, {12/12}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)
--   D12 UA app_call_names() -> names=2 one=app two=app
--   D13 UA sets is_app = false on U1 -> updated=1 is_app=false
--   F1  U1 (a former APP) sad(null, {12/12}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   F2  U1 reads 12/11 (the rows stay) -> 12/11=one/app
--   E1  UA app_call_names() -> names=2 one=former two=app
--   E2  UA sad(U1, null, {12/11}) (a former APP's day cleared) -> ok removed=1 12/11=none
--   E3  UA sad(U1, {12/12}, null) -> ERR AP003 APP_DAY_NOT_APP: probe app one is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   E4  UA sets is_app = true on US (a surgeon) -> ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_app_viewer"
--   E5  UA sets is_app = true on UC (the coordinator) -> ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_app_viewer"
--   N1  anon: select count(*) from app_call_days -> ERR 42501 permission denied for table app_call_days
--   N2  anon: app_call_names() -> ERR 42501 permission denied for function app_call_names
--   N3  anon: sad(U2, {12/13}, null) -> ERR 42501 permission denied for function save_app_days
--   N4  postgres, no signed-in user: sad(U2, {12/13}, null) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   N5  postgres, no signed-in user: app_call_names() -> names=0
--   X1  postgres deletes U2's auth user (U2 held 12/2, 12/7, 12/8) -> before=3 after=0 audit_kept=yes
--   I1  postgres deletes UV's profile; UV self-inserts with is_app = true -> ERR 42501 new row violates row-level security policy for table "user_profiles"
--   I2  UV self-inserts (viewer, no is_app key) -> ok is_app=false
-- 69 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  u1   uuid := gen_random_uuid();
  u2   uuid := gen_random_uuid();
  us   uuid := gen_random_uuid();
  uc   uuid := gen_random_uuid();
  uv   uuid := gen_random_uuid();
  ua   uuid := gen_random_uuid();
begin
  if to_regclass('public.app_call_days') is null then
    raise exception 'PROBE_SETUP: app_call_days is absent - sql/migrations/2026-10-02-app-call-days.sql is not applied';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.user_profiles'::regclass and a.attname = 'is_app' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: user_profiles.is_app is absent - sql/migrations/2026-10-02-app-call-days.sql is partly applied';
  end if;
  -- the collision guard (after the absent checks: it reads the table)
  if exists (select 1 from public.app_call_days d where d.day between '2030-12-01' and '2030-12-31' or d.day = '2020-05-04') then
    raise exception 'PROBE_SETUP: live rows already sit in the probe window (app_call_days in 2030-12 or on 2020-05-04) - the probe fixtures would collide';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-appdays-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, us, uc, uv, ua]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, us, uc, uv, ua)) <> 6 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set display_name = 'probe app one', is_app = true where id = u1;
  update public.user_profiles set display_name = 'probe app two', is_app = true where id = u2;
  update public.user_profiles set person_id = 's3', role = 'surgeon', display_name = 'probe surgeon' where id = us;
  update public.user_profiles set role = 'coordinator', display_name = 'probe office' where id = uc;
  update public.user_profiles set display_name = 'probe viewer' where id = uv;
  update public.user_profiles set person_id = 's1', role = 'admin', display_name = 'probe admin' where id = ua;
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('us', us::text), ('uc', uc::text), ('uv', uv::text), ('ua', ua::text);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- readbacks (plain SQL in pg_temp; an acting role reads app_call_days through its select policy)
create or replace function pg_temp.ad_day(p_day date) returns text language sql as $$
  select to_char(p_day, 'FMMM/FMDD') || '=' || coalesce((select case a.profile_id::text when (select c.v from probe_ctx c where c.k = 'u1') then 'one' when (select c.v from probe_ctx c where c.k = 'u2') then 'two' else 'other' end || '/' || a.source
                                                           from public.app_call_days a where a.day = p_day), 'none');
$$;
create or replace function pg_temp.ad_by(p_days date[]) returns text language sql as $$
  select 'by=' || coalesce(string_agg(distinct case when a.created_by::text = (select c.v from probe_ctx c where c.k = 'ua') then 'admin' when a.created_by = auth.uid() then 'self' else 'other' end, ','), 'none')
    from public.app_call_days a where a.day = any(p_days);
$$;
create or replace function pg_temp.ad_rows() returns text language sql as $$
  select 'rows=' || count(*) from public.app_call_days a where a.day between '2030-12-01' and '2030-12-31';
$$;
create or replace function pg_temp.ad_names(p_mode text) returns text language sql as $$
  with n as (
    select x.profile_id, x.display_name, x.is_app from public.app_call_names() x
     where x.profile_id::text in (select c.v from probe_ctx c)
  )
  select 'names=' || (select count(*) from n)
      || case p_mode
           when 'self' then ' self=' || case when exists (select 1 from n where n.profile_id = auth.uid()) then 'yes' else 'no' end
           when 'names' then ' one=' || coalesce((select n.display_name from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u1')), '-')
                          || ' two=' || coalesce((select n.display_name from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u2')), '-')
           when 'flags' then ' one=' || coalesce((select case when n.is_app then 'app' else 'former' end from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u1')), '-')
                          || ' two=' || coalesce((select case when n.is_app then 'app' else 'former' end from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u2')), '-')
           else '' end;
$$;
-- audit readbacks: read as postgres (the cases reset the role first), over the appdays.save rows naming a probe user only
create or replace function pg_temp.ad_audit_n() returns bigint language sql as $$
  select count(*) from public.audit_log l where l.action = 'appdays.save' and l.detail ->> 'profile_id' in (select c.v from probe_ctx c);
$$;
create or replace function pg_temp.ad_sums(p_actor text) returns text language sql as $$
  select 'sums=' || coalesce(string_agg(l.detail ->> 'summary', ' | ' order by l.detail ->> 'summary' collate "C"), 'none')
    from public.audit_log l where l.action = 'appdays.save' and l.detail ->> 'profile_id' in (select c.v from probe_ctx c) and l.actor_id = p_actor;
$$;
create or replace function pg_temp.ad_audit(p_target text, p_source text, p_self text) returns text language sql as $$
  with t as (
    select l.actor_id, l.actor_name from public.audit_log l
     where l.action = 'appdays.save' and l.detail ->> 'profile_id' = p_target and l.detail ->> 'source' = p_source
  )
  select 'actor=' || coalesce((select string_agg(distinct case when t.actor_id = p_self then 'self' else t.actor_id end, ',') from t), 'none')
      || ' name=' || coalesce((select string_agg(distinct t.actor_name, ',') from t), 'none')
      || ' ' || pg_temp.ad_sums((select min(t.actor_id) from t));
$$;
create or replace function pg_temp.ad_last() returns text language sql as $$
  select 'last=' || coalesce(string_agg(l.detail ->> 'summary', ' | ' order by l.detail ->> 'summary' collate "C"), 'none')
    from public.audit_log l where l.action = 'appdays.save' and l.detail ->> 'profile_id' in (select c.v from probe_ctx c)
     and jsonb_typeof(l.detail -> 'replaced') = 'array' and jsonb_array_length(l.detail -> 'replaced') > 0;
$$;

-- P1-P3: as postgres - the objects as the migration leaves them
do $$ declare s regprocedure; n regprocedure; i regprocedure; begin
  begin
    insert into probe_results values ('P1',
      'table=' || case when to_regclass('public.app_call_days') is not null then 'yes' else 'no' end
      || ' rls=' || case when (select c.relrowsecurity from pg_class c where c.oid = 'public.app_call_days'::regclass) then 'yes' else 'no' end
      || ' pk=' || coalesce((select string_agg(a.attname, ',' order by a.attnum) from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                             where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'p'), 'none')
      || ' fk=' || coalesce((select case k.confdeltype when 'c' then 'cascade' else k.confdeltype::text end from pg_constraint k
                             where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'f' and k.confrelid = 'public.user_profiles'::regclass limit 1), 'none')
      || ' policies=' || coalesce((select string_agg(p.policyname || '/' || lower(p.cmd) || '/' || array_to_string(p.roles, ','), ',' order by p.policyname)
                                   from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_call_days'), 'none')
      || ' anon_sel=' || case when has_table_privilege('anon', 'public.app_call_days', 'select') then 'yes' else 'no' end
      || ' auth_sel=' || case when has_table_privilege('authenticated', 'public.app_call_days', 'select') then 'yes' else 'no' end
      || ' auth_write=' || case when has_table_privilege('authenticated', 'public.app_call_days', 'insert') or has_table_privilege('authenticated', 'public.app_call_days', 'update')
                                  or has_table_privilege('authenticated', 'public.app_call_days', 'delete') or has_table_privilege('authenticated', 'public.app_call_days', 'truncate') then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    s := to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)');
    n := to_regprocedure('public.app_call_names()');
    i := to_regprocedure('public.silvis_is_app()');
    insert into probe_results values ('P2',
      'save_definer=' || case when (select p.prosecdef from pg_proc p where p.oid = s) then 'yes' else 'no' end
      || ' names_definer=' || case when (select p.prosecdef from pg_proc p where p.oid = n) then 'yes' else 'no' end
      || ' isapp_definer=' || case when (select p.prosecdef from pg_proc p where p.oid = i) then 'yes' else 'no' end
      || ' paths=' || (select count(*) from pg_proc p where p.oid in (s, n, i) and 'search_path=public, pg_temp' = any(p.proconfig))
      || ' names_stable=' || case when (select p.provolatile from pg_proc p where p.oid = n) = 's' then 'yes' else 'no' end
      || ' save_volatile=' || case when (select p.provolatile from pg_proc p where p.oid = s) = 'v' then 'yes' else 'no' end
      || ' save_anon=' || case when has_function_privilege('anon', s, 'execute') then 'yes' else 'no' end
      || ' save_auth=' || case when has_function_privilege('authenticated', s, 'execute') then 'yes' else 'no' end
      || ' names_anon=' || case when has_function_privilege('anon', n, 'execute') then 'yes' else 'no' end
      || ' names_auth=' || case when has_function_privilege('authenticated', n, 'execute') then 'yes' else 'no' end
      || ' isapp_anon=' || case when has_function_privilege('anon', i, 'execute') then 'yes' else 'no' end
      || ' isapp_auth=' || case when has_function_privilege('authenticated', i, 'execute') then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P3',
      'is_app=' || coalesce((select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.user_profiles'::regclass and a.attname = 'is_app' and not a.attisdropped), 'none')
      || ' not_null=' || case when (select a.attnotnull from pg_attribute a where a.attrelid = 'public.user_profiles'::regclass and a.attname = 'is_app' and not a.attisdropped) then 'yes' else 'no' end
      || ' default=' || coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                                  where d.adrelid = 'public.user_profiles'::regclass and a.attname = 'is_app'), 'none')
      || ' check=' || coalesce((select string_agg(k.conname, ',' order by k.conname) from pg_constraint k
                                where k.conrelid = 'public.user_profiles'::regclass and k.contype = 'c' and k.conname = 'user_profiles_app_viewer'
                                  and pg_get_constraintdef(k.oid) like '%is_app%'), 'none')
      || ' self_pins=' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_profiles'
                            and p.policyname in ('user_profiles_self_insert', 'user_profiles_self_update') and p.with_check like '%is_app%'));
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- A1-A19: as the APP U1
do $$ declare u text; u2 text; r jsonb; n int; begin
  select v into u from probe_ctx where k = 'u1';
  select v into u2 from probe_ctx where k = 'u2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '{2030-12-02,2030-12-03,2030-12-11}', null);
    insert into probe_results values ('A1', 'ok added=' || (r ->> 'added') || ' removed=' || (r ->> 'removed') || ' kept=' || (r ->> 'kept') || ' source=' || (r ->> 'source')
      || ' ' || pg_temp.ad_day('2030-12-02') || ' ' || pg_temp.ad_day('2030-12-03') || ' ' || pg_temp.ad_day('2030-12-11') || ' ' || pg_temp.ad_by('{2030-12-02,2030-12-03,2030-12-11}'));
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('A2', replace('audit=' || pg_temp.ad_audit_n() || ' ' || pg_temp.ad_audit(u, 'app', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-02,2030-12-03}', null);
    execute 'reset role';
    insert into probe_results values ('A3', 'ok added=' || (r ->> 'added') || ' kept=' || (r ->> 'kept') || ' audit=' || (r ->> 'audit') || ' audit_rows=' || pg_temp.ad_audit_n());
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '{2030-12-03}');
    execute 'reset role';
    insert into probe_results values ('A4', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.ad_day('2030-12-03') || ' ' || pg_temp.ad_sums(u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '{2030-12-04}');
    insert into probe_results values ('A5', 'ok removed=' || (r ->> 'removed') || ' absent=' || (r ->> 'absent') || ' audit=' || (r ->> 'audit'));
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-04}', '{2030-12-04}');
    insert into probe_results values ('A6', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{NULL}'::date[], null);
    insert into probe_results values ('A7', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, (select array_agg(g::date order by g) from generate_series('2031-01-01'::date, '2032-02-05'::date, interval '1 day') g), null);
    insert into probe_results values ('A8', 'saved (NO refusal) added=' || (r ->> 'added'));
  exception when others then insert into probe_results values ('A8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2020-05-04}', null);
    insert into probe_results values ('A9', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-05}', '{2020-05-04}');
    insert into probe_results values ('A10', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A10s', pg_temp.ad_day('2030-12-05'));
  exception when others then insert into probe_results values ('A10s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-05}', null);
    insert into probe_results values ('A11', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-05}', null, true);
    insert into probe_results values ('A12', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.app_call_days (day, profile_id, source) values ('2030-12-06', u::uuid, 'app');
    insert into probe_results values ('A13', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('A13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.app_call_days where day = '2030-12-02';
    get diagnostics n = row_count;
    insert into probe_results values ('A14', 'deleted=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A15', pg_temp.ad_rows());
  exception when others then insert into probe_results values ('A15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A16', replace(pg_temp.ad_names('self'), ';', ','));
  exception when others then insert into probe_results values ('A16', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{-infinity}', '{infinity}');
    insert into probe_results values ('A17', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('A17', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe app one renamed' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('A18', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('A18', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe app one' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('A19', 'updated=' || n);
  exception when others then insert into probe_results values ('A19', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- B1-B5: as the second APP U2
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'u2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '{2030-12-02}', null);
    insert into probe_results values ('B1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B1s', pg_temp.ad_day('2030-12-02'));
  exception when others then insert into probe_results values ('B1s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-07,2030-12-08}', null);
    insert into probe_results values ('B2', 'ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.ad_day('2030-12-07') || ' ' || pg_temp.ad_day('2030-12-08'));
  exception when others then insert into probe_results values ('B2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '{2030-12-02}');
    insert into probe_results values ('B3', 'removed (NO refusal) removed=' || (r ->> 'removed'));
  exception when others then insert into probe_results values ('B3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '{2030-12-09,2030-12-02,2030-12-11}', null);
    insert into probe_results values ('B4', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B4s', pg_temp.ad_day('2030-12-09'));
  exception when others then insert into probe_results values ('B4s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B5', replace(pg_temp.ad_names(''), ';', ','));
  exception when others then insert into probe_results values ('B5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- S1-S5: as the SURGEON US (linked s3) - reads, never writes
do $$ declare u text; u1 text; r jsonb; begin
  select v into u from probe_ctx where k = 'us';
  select v into u1 from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '{2030-12-10}', null);
    insert into probe_results values ('S1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, '{2030-12-10}', null);
    insert into probe_results values ('S2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S3', pg_temp.ad_rows());
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.app_call_days (day, profile_id, source) values ('2030-12-10', u1::uuid, 'app');
    insert into probe_results values ('S4', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S5', replace(pg_temp.ad_names('names'), ';', ','));
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C2: as the office COORDINATOR UC
do $$ declare u text; u1 text; r jsonb; begin
  select v into u from probe_ctx where k = 'uc';
  select v into u1 from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(u1::uuid, '{2030-12-10}', null);
    insert into probe_results values ('C1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('C2', pg_temp.ad_rows());
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- V1-V4: as the plain VIEWER UV (not an APP)
do $$ declare u text; r jsonb; n int; begin
  select v into u from probe_ctx where k = 'uv';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '{2030-12-10}', null);
    insert into probe_results values ('V1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('V1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('V2', pg_temp.ad_rows());
  exception when others then insert into probe_results values ('V2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = true where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('V3', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('V3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe viewer' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('V4', 'updated=' || n);
  exception when others then insert into probe_results values ('V4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- D1-D13: as the ADMIN UA (the scheduler, linked s1)
do $$ declare u text; u1 text; u2 text; uv text; r jsonb; n int; begin
  select v into u from probe_ctx where k = 'ua';
  select v into u1 from probe_ctx where k = 'u1';
  select v into u2 from probe_ctx where k = 'u2';
  select v into uv from probe_ctx where k = 'uv';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-10}', null);
    insert into probe_results values ('D1', 'ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.ad_day('2030-12-10') || ' ' || pg_temp.ad_by('{2030-12-10}'));
  exception when others then insert into probe_results values ('D1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('D2', replace(pg_temp.ad_audit(u2, 'scheduler', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('D2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, null, '{2030-12-10}');
    insert into probe_results values ('D3', 'ok removed=' || (r ->> 'removed') || ' ' || pg_temp.ad_day('2030-12-10'));
  exception when others then insert into probe_results values ('D3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, '{2020-05-04}', null);
    insert into probe_results values ('D4', 'ok added=' || (r ->> 'added') || ' ' || pg_temp.ad_day('2020-05-04'));
  exception when others then insert into probe_results values ('D4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, null, '{2020-05-04}');
    insert into probe_results values ('D5', 'ok removed=' || (r ->> 'removed') || ' ' || pg_temp.ad_day('2020-05-04'));
  exception when others then insert into probe_results values ('D5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-02}', null);
    insert into probe_results values ('D6', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('D6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-02}', null, true);
    execute 'reset role';
    insert into probe_results values ('D7', replace('ok added=' || (r ->> 'added') || ' replaced=' || (r ->> 'replaced') || ' ' || pg_temp.ad_day('2030-12-02') || ' ' || pg_temp.ad_last(), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('D7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, null, '{2030-12-02}');
    insert into probe_results values ('D8', 'removed (NO refusal) removed=' || (r ->> 'removed'));
  exception when others then insert into probe_results values ('D8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(uv::uuid, '{2030-12-12}', null);
    insert into probe_results values ('D9', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('D9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(gen_random_uuid(), '{2030-12-12}', null);
    insert into probe_results values ('D10', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('D10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '{2030-12-12}', null);
    insert into probe_results values ('D11', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('D11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('D12', replace(pg_temp.ad_names('flags'), ';', ','));
  exception when others then insert into probe_results values ('D12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = false where id = u1::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('D13', 'updated=' || n || ' is_app=' || coalesce((select p.is_app::text from public.user_profiles p where p.id = u1::uuid), 'none'));
  exception when others then insert into probe_results values ('D13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- F1-F2: as U1 again - a FORMER APP (is_app false since D13)
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '{2030-12-12}', null);
    insert into probe_results values ('F1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('F1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('F2', pg_temp.ad_day('2030-12-11'));
  exception when others then insert into probe_results values ('F2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- E1-E5: as the ADMIN UA again - a former APP's rows, the flag's rule
do $$ declare u text; u1 text; us text; uc text; r jsonb; n int; begin
  select v into u from probe_ctx where k = 'ua';
  select v into u1 from probe_ctx where k = 'u1';
  select v into us from probe_ctx where k = 'us';
  select v into uc from probe_ctx where k = 'uc';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into probe_results values ('E1', replace(pg_temp.ad_names('flags'), ';', ','));
  exception when others then insert into probe_results values ('E1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, null, '{2030-12-11}');
    insert into probe_results values ('E2', 'ok removed=' || (r ->> 'removed') || ' ' || pg_temp.ad_day('2030-12-11'));
  exception when others then insert into probe_results values ('E2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, '{2030-12-12}', null);
    insert into probe_results values ('E3', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('E3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = true where id = us::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('E4', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('E4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = true where id = uc::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('E5', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('E5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1-N3: as ANON (no privilege on the table, no EXECUTE); N4-N5: as postgres with NO signed-in user (the SQL editor / the linked CLI)
do $$ declare u2 text; r jsonb; n bigint; begin
  select v into u2 from probe_ctx where k = 'u2';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.app_call_days;
    insert into probe_results values ('N1', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.app_call_names();
    insert into probe_results values ('N2', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-13}', null);
    insert into probe_results values ('N3', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    r := public.save_app_days(u2::uuid, '{2030-12-13}', null);
    insert into probe_results values ('N4', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('N5', replace(pg_temp.ad_names(''), ';', ','));
  exception when others then insert into probe_results values ('N5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- X1: as postgres - deleting the account removes its days (auth.users -> user_profiles -> app_call_days); the audit rows stay
do $$ declare u2 text; b bigint; a bigint; begin
  select v into u2 from probe_ctx where k = 'u2';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into b from public.app_call_days where profile_id = u2::uuid;
    delete from auth.users where id = u2::uuid;
    select count(*) into a from public.app_call_days where profile_id = u2::uuid;
    insert into probe_results values ('X1', 'before=' || b || ' after=' || a || ' audit_kept='
      || case when exists (select 1 from public.audit_log l where l.action = 'appdays.save' and l.detail ->> 'profile_id' = u2) then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('X1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- I1-I2: the self-insert door - postgres deletes UV's profile row, then UV inserts its own (never an APP)
do $$ declare u text; begin
  select v into u from probe_ctx where k = 'uv';
  perform set_config('request.jwt.claims', '{}', true);
  delete from public.user_profiles where id = u::uuid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.user_profiles (id, role, is_app) values (u::uuid, 'viewer', true);
    insert into probe_results values ('I1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('I1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.user_profiles (id, role) values (u::uuid, 'viewer');
    insert into probe_results values ('I2', 'ok is_app=' || coalesce((select p.is_app::text from public.user_profiles p where p.id = auth.uid()), 'none'));
  exception when others then insert into probe_results values ('I2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
