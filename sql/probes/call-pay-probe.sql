-- ============================================================================
-- Silvis Call Schedule - call pay PROBE (2026-09-27, Faraz: primary call pay; sql/migrations/2026-09-27-call-pay.sql,
-- REPORT-FIRST; APPLIED 2026-09-28 01:15:26Z). Proves the two new tables' grants, RLS, guards and constraints on the LIVE database
-- WITHOUT PERSISTING ANYTHING, and never reads or prints a rate.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API
-- runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation
-- in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- A1=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the fixtures, the throwaway auth users and
-- every row a case wrote roll back. After every run verify-rls.sh section 14 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/call-pay-probe.sql
--   (scripts/verify-rls.sh section 14d runs it, grades each case and checks nothing persisted)
--
-- BEFORE the migration the first block raises 'PROBE_SETUP: call_pay_logs is absent ...' (nothing else runs). AFTER it every
-- case below must read as listed.
-- As run: the migration was applied 2026-09-28 01:15:26Z (schema.sql revision r); the probe read PROBE_SETUP before it and all 52
-- cases below as listed after it. Until the record step verify-rls read PROBE_SETUP as the not-applied picture (unless
-- SILVIS_CALL_PAY_APPLIED=1); since the record step, which dropped that variable, section 14d FAILs a PROBE_SETUP - the
-- not-applied grading is history.
--
-- Fixtures are PAST days in 2020-03 (PY001 refuses a future day), schedule_days rows with source 'probe-pay' and the live
-- roster ids (the setup first takes s2 and s3 OFF call_pay_settings.stipend_off_ids - they are paid by the stipend for every
-- case until the O block switches s3 off; both changes roll back with the rest): 03-02 primary s3 / backup s2, 03-03 primary s2 / backup s3, 03-04 and 03-05 primary s3; one call_pay_logs
-- row of s2 on 03-03. Every call_pay_logs row the probe writes carries a note starting 'probe-pay' (the leftover count keys
-- on it). The acting users are throwaway auth.users rows (email probe-pay-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates; they are linked as surgeon s3, surgeon s2, coordinator (unlinked), viewer
-- (unlinked) and admin s1. Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon = SET LOCAL ROLE
-- anon with no sub. Errors are recorded as 'ERR <SQLSTATE> <message>' (';' in a message becomes ',').
--
-- Cases (AFTER the migration):
--   P1  postgres: the policies on both tables  policies=call_pay_logs_delete,call_pay_logs_insert,call_pay_logs_read,call_pay_logs_update,call_pay_settings_read,call_pay_settings_write
--   P2  postgres: anon's table privileges, and authenticated's TRUNCATE / REFERENCES / TRIGGER (revoked)
--                                              anon_logs=f anon_settings=f auth_truncate=f
--   P3  postgres: the settings rows            rows=1
--   P4  postgres: the switch helper's grants   anon_exec=f auth_exec=t definer=t
--   N1  anon reads call_pay_logs               ERR 42501 permission denied for table call_pay_logs
--   N2  anon reads call_pay_settings           ERR 42501 permission denied for table call_pay_settings
--   N3  anon inserts a call-in                 ERR 42501 permission denied for table call_pay_logs
--   S1  surgeon s3 logs 1.5 h on his primary day 03-02, RETURNING (what the client's insert reads back)
--                                              ok created_by=s3 hours=1.50
--   S2  s3 logs his BACKUP day 03-03           ERR PY002 PAY_NOT_PRIMARY: ...
--   S3  s3 logs a row for s2 on s2's day       ERR 42501 new row violates row-level security policy for table "call_pay_logs"
--   S4  s3 logs a day 30 days ahead            ERR PY001 PAY_FUTURE: ...
--   S5  s3 logs 0.3 h (not a quarter hour)     ERR 23514 ... "call_pay_logs_hours_check"
--   S6  s3 logs 23 h on 03-05                  ok
--   S7  s3 logs 1.5 h more on 03-05            ERR PY003 PAY_HOURS_OVER: ...
--   S8  s3 logs a note with '@'                ERR 23514 ... "call_pay_logs_note_check"
--   S9  s3 logs 24.25 h on 03-04               ERR PY003 PAY_HOURS_OVER: ...   (the guard runs before the check constraint)
--   S10 s3 reads the probe rows                own=2 others=0
--   S11 s3 edits his S1 row to 2.25 h          updated=1 hours=2.25 created_by=s3
--   S12 s3 edits s2's row                      updated=0
--   S13 s3 deletes s2's row                    deleted=0
--   S14 s3 reads the settings                  rows=1
--   S15 s3 updates the settings                updated=0
--   S16 s3 inserts a settings row              ERR 42501 new row violates row-level security policy for table "call_pay_settings"
--   S17 s3 rewrites created_by on his row      updated=1 created_by=s3
--   X1  03-02's primary moves to s2 (postgres); s3 edits his now-orphan row
--                                              ERR PY002 PAY_NOT_PRIMARY: ...
--   X2  s3 deletes his orphan row              deleted=1
--   T1  surgeon s2 reads the probe rows        own=1 s3=0
--   C1  coordinator reads every probe row (read-only, for preparing the stipends)
--                                              sees_all=t
--   C2  coordinator reads the settings         rows=1
--   C3  coordinator logs a call-in for s3      ERR PY004 PAY_READ_ONLY: ...   (the guard refuses the office before RLS)
--   C4  coordinator edits a probe row          updated=0
--   C5  coordinator deletes a probe row        deleted=0
--   C6  coordinator updates the settings       updated=0   (the office never changes a rate or a switch)
--   C7  coordinator inserts a settings row     ERR 42501 new row violates row-level security policy for table "call_pay_settings"
--   V1  viewer reads the probe rows            visible=0
--   V2  viewer reads the settings              rows=0
--   A1  admin s1 reads every probe row         sees_all=t
--   A2  admin touches the settings row (no value changes)
--                                              updated=1 updated_by=s1
--   A3  admin logs 0.25 h for s3 on 03-05      ok created_by=s1
--   A4  admin logs s3's backup day 03-03       ERR PY002 PAY_NOT_PRIMARY: ...   (the guard applies to every caller)
--   O   s3 SWITCHED OFF (postgres adds 's3' to call_pay_settings.stipend_off_ids; rolled back like everything else):
--   O1  s3 reads the settings                  rows=0
--   O2  s3 reads his own probe rows            own=0
--   O3  s3 logs a call-in on his primary 03-04 ERR PY005 PAY_STIPEND_OFF: ...
--   O4  s3 edits his own probe rows            updated=0
--   O5  s3 deletes his own probe rows          deleted=0
--   O6  surgeon s2 (still switched on) reads the settings and his own row
--                                              settings=1 own=1
--   O7  the admin still reads s3's rows        sees_s3=t
--   O8  the admin logs a call-in for s3 on 03-04
--                                              ERR PY005 PAY_STIPEND_OFF: ...   (for everyone)
--   O9  the admin edits s3's existing rows     ERR PY005 PAY_STIPEND_OFF: ...
--   O10 the coordinator still reads s3's rows  sees_s3=t
--   O11 silvis_pay_enabled('s3') asked over RPC by the viewer (a follower) and by surgeon s2 (a colleague) - callers not
--       entitled to know who is switched off get an uninformative true
--                                              viewer=t colleague=t
--   O12 the same call by the admin, the coordinator, s3 himself and a session with no signed-in user (postgres / service_role)
--       - the real answer                      admin=f coord=f self=f nojwt=f
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- setup (as postgres: RLS bypassed)
do $$
declare
  surgeon  uuid := gen_random_uuid();
  surgeon2 uuid := gen_random_uuid();
  coord    uuid := gen_random_uuid();
  viewer   uuid := gen_random_uuid();
  admin_u  uuid := gen_random_uuid();
begin
  if to_regclass('public.call_pay_logs') is null or to_regclass('public.call_pay_settings') is null then
    raise exception 'PROBE_SETUP: call_pay_logs is absent - sql/migrations/2026-09-27-call-pay.sql is not applied';
  end if;
  if exists (select 1 from public.schedule_days where day between '2020-03-01' and '2020-03-31') then
    raise exception 'PROBE_SETUP: schedule_days already has rows in 2020-03 - the probe fixtures would collide';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-pay-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[surgeon, surgeon2, coord, viewer, admin_u]) as u;
  if (select count(*) from public.user_profiles where id in (surgeon, surgeon2, coord, viewer, admin_u)) <> 5 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = 's2', role = 'surgeon' where id = surgeon2;
  update public.user_profiles set role = 'coordinator' where id = coord;
  update public.user_profiles set person_id = 's1', role = 'admin' where id = admin_u;
  if not exists (select 1 from public.user_profiles where id = viewer and role = 'viewer' and person_id is null) then
    raise exception 'PROBE_SETUP: the viewer is not an unlinked viewer';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('surgeon2', surgeon2::text), ('coord', coord::text), ('viewer', viewer::text), ('admin', admin_u::text);
  -- s2 and s3 are paid by the stipend for the cases below, whatever the live switches read (the O block switches s3 off)
  update public.call_pay_settings set stipend_off_ids = stipend_off_ids - 's2' - 's3' where id = 'main';
  insert into public.schedule_days (day, primary_id, backup_id, source)
  values ('2020-03-02', 's3', 's2', 'probe-pay'), ('2020-03-03', 's2', 's3', 'probe-pay'),
         ('2020-03-04', 's3', null, 'probe-pay'), ('2020-03-05', 's3', null, 'probe-pay');
  insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-03', 's2', 2, 'probe-pay fixture');
end $$;

-- P1-P4: as postgres - the apply's fingerprint (policy names, anon's privileges, the settings row count, the switch helper's
-- grants; never a rate)
do $$ declare v text; a boolean; b boolean; c boolean; n int; begin
  begin
    select string_agg(policyname::text, ',' order by policyname) into v from pg_policies where schemaname = 'public' and tablename in ('call_pay_logs', 'call_pay_settings');
    insert into probe_results values ('P1', 'policies=' || coalesce(v, '(none)'));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select has_table_privilege('anon', 'public.call_pay_logs', 'SELECT,INSERT,UPDATE,DELETE'), has_table_privilege('anon', 'public.call_pay_settings', 'SELECT,INSERT,UPDATE,DELETE'),
           has_table_privilege('authenticated', 'public.call_pay_logs', 'TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('authenticated', 'public.call_pay_settings', 'TRUNCATE,REFERENCES,TRIGGER') into a, b, c;
    insert into probe_results values ('P2', 'anon_logs=' || case when a then 't' else 'f' end || ' anon_settings=' || case when b then 't' else 'f' end || ' auth_truncate=' || case when c then 't' else 'f' end);
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.call_pay_settings;
    insert into probe_results values ('P3', 'rows=' || n);
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select has_function_privilege('anon', 'public.silvis_pay_enabled(text)', 'EXECUTE'), has_function_privilege('authenticated', 'public.silvis_pay_enabled(text)', 'EXECUTE'),
           (select p.prosecdef from pg_proc p where p.oid = 'public.silvis_pay_enabled(text)'::regprocedure) into a, b, c;
    insert into probe_results values ('P4', 'anon_exec=' || case when a then 't' else 'f' end || ' auth_exec=' || case when b then 't' else 'f' end || ' definer=' || case when c then 't' else 'f' end);
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- N1-N3: as ANON (no sub) - anon's privileges are revoked, so every request is refused outright. The role is reset inside
-- each block before the result is recorded (probe_results is granted to authenticated only); on an error the subtransaction
-- rollback restores the postgres role by itself.
do $$ declare n int; v text; begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select count(*) into n from public.call_pay_logs;
    execute 'reset role';
    v := 'rows=' || n;
  exception when others then v := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','); end;
  insert into probe_results values ('N1', v);
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select count(*) into n from public.call_pay_settings;
    execute 'reset role';
    v := 'rows=' || n;
  exception when others then v := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','); end;
  insert into probe_results values ('N2', v);
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-02', 's3', 1, 'probe-pay N3');
    execute 'reset role';
    v := 'inserted (NO refusal)';
  exception when others then v := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','); end;
  insert into probe_results values ('N3', v);
  perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
end $$;

-- S1-S17: as the LINKED SURGEON (s3)
do $$ declare u text; n int; a int; b int; cb text; h numeric; s1_id uuid; begin
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-02', 's3', 1.5, 'probe-pay S1') returning id, created_by, hours into s1_id, cb, h;
    insert into probe_results values ('S1', 'ok created_by=' || coalesce(cb, 'null') || ' hours=' || h);
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-03', 's3', 1, 'probe-pay S2');
    insert into probe_results values ('S2', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-03', 's2', 1, 'probe-pay S3');
    insert into probe_results values ('S3', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ((now() at time zone 'America/Chicago')::date + 30, 's3', 1, 'probe-pay S4');
    insert into probe_results values ('S4', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 0.3, 'probe-pay S5');
    insert into probe_results values ('S5', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-05', 's3', 23, 'probe-pay S6');
    insert into probe_results values ('S6', 'ok');
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-05', 's3', 1.5, 'probe-pay S7');
    insert into probe_results values ('S7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 1, 'probe-pay S8 a@b');
    insert into probe_results values ('S8', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 24.25, 'probe-pay S9');
    insert into probe_results values ('S9', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where person_id = 's3'), count(*) filter (where person_id <> 's3') into a, b from public.call_pay_logs where note like 'probe-pay%';
    insert into probe_results values ('S10', 'own=' || a || ' others=' || b);
  exception when others then insert into probe_results values ('S10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set hours = 2.25 where id = s1_id;
    get diagnostics n = row_count;
    select hours, created_by into h, cb from public.call_pay_logs where id = s1_id;
    insert into probe_results values ('S11', 'updated=' || n || ' hours=' || coalesce(h::text, 'null') || ' created_by=' || coalesce(cb, 'null'));
  exception when others then insert into probe_results values ('S11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set hours = 3 where note like 'probe-pay%' and person_id = 's2';
    get diagnostics n = row_count;
    insert into probe_results values ('S12', 'updated=' || n);
  exception when others then insert into probe_results values ('S12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_pay_logs where note like 'probe-pay%' and person_id = 's2';
    get diagnostics n = row_count;
    insert into probe_results values ('S13', 'deleted=' || n);
  exception when others then insert into probe_results values ('S13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.call_pay_settings;
    insert into probe_results values ('S14', 'rows=' || n);
  exception when others then insert into probe_results values ('S14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_settings set activation_unit = activation_unit where id = 'main';
    get diagnostics n = row_count;
    insert into probe_results values ('S15', 'updated=' || n);
  exception when others then insert into probe_results values ('S15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_settings (id) values ('main');
    insert into probe_results values ('S16', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S16', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set created_by = 's2' where id = s1_id;
    get diagnostics n = row_count;
    select created_by into cb from public.call_pay_logs where id = s1_id;
    insert into probe_results values ('S17', 'updated=' || n || ' created_by=' || coalesce(cb, 'null'));
  exception when others then insert into probe_results values ('S17', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  insert into probe_ctx values ('s1_row', coalesce(s1_id::text, ''));   -- as postgres: probe_ctx is not granted to authenticated
end $$;

-- X1-X2: the day's primary changes (a trade / restore, as postgres); s3's row on it is now an orphan
do $$ declare u text; n int; rid uuid; begin
  update public.schedule_days set primary_id = 's2', backup_id = null where day = '2020-03-02' and source = 'probe-pay';
  select nullif(v, '')::uuid into rid from probe_ctx where k = 's1_row';
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    update public.call_pay_logs set hours = 1 where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('X1', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('X1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_pay_logs where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('X2', 'deleted=' || n);
  exception when others then insert into probe_results values ('X2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- T1: as the SECOND SURGEON (s2) - his own row only, none of s3's
do $$ declare u text; a int; b int; begin
  select v into u from probe_ctx where k = 'surgeon2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where person_id = 's2'), count(*) filter (where person_id = 's3') into a, b from public.call_pay_logs where note like 'probe-pay%';
    insert into probe_results values ('T1', 'own=' || a || ' s3=' || b);
  exception when others then insert into probe_results values ('T1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C5: as the COORDINATOR (never linked) - reads every call-in and the settings (read-only: the office prepares the
-- stipends), writes nothing (the guard refuses its insert with PY004 before RLS; update / delete match no row)
do $$ declare u text; a int; b int; n int; begin
  select v into u from probe_ctx where k = 'coord';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into a from public.call_pay_logs where note like 'probe-pay%';
    execute 'reset role';
    select count(*) into b from public.call_pay_logs where note like 'probe-pay%';
    execute 'set local role authenticated';
    insert into probe_results values ('C1', 'sees_all=' || case when a = b and a > 0 then 't' else 'f coord=' || a || ' postgres=' || b end);
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.call_pay_settings;
    insert into probe_results values ('C2', 'rows=' || n);
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 1, 'probe-pay C3');
    insert into probe_results values ('C3', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set hours = hours where note like 'probe-pay%';
    get diagnostics n = row_count;
    insert into probe_results values ('C4', 'updated=' || n);
  exception when others then insert into probe_results values ('C4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_pay_logs where note like 'probe-pay%';
    get diagnostics n = row_count;
    insert into probe_results values ('C5', 'deleted=' || n);
  exception when others then insert into probe_results values ('C5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_settings set activation_unit = activation_unit where id = 'main';
    get diagnostics n = row_count;
    insert into probe_results values ('C6', 'updated=' || n);
  exception when others then insert into probe_results values ('C6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_settings (id) values ('main');
    insert into probe_results values ('C7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- V1-V2: as the unlinked VIEWER (what a follower is)
do $$ declare u text; n int; begin
  select v into u from probe_ctx where k = 'viewer';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.call_pay_logs where note like 'probe-pay%';
    insert into probe_results values ('V1', 'visible=' || n);
  exception when others then insert into probe_results values ('V1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.call_pay_settings;
    insert into probe_results values ('V2', 'rows=' || n);
  exception when others then insert into probe_results values ('V2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A4: as the ADMIN (s1) - every row, the settings write, and the guard still applies to him
do $$ declare u text; a int; b int; n int; cb text; begin
  select v into u from probe_ctx where k = 'admin';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into a from public.call_pay_logs where note like 'probe-pay%';
    execute 'reset role';
    select count(*) into b from public.call_pay_logs where note like 'probe-pay%';
    execute 'set local role authenticated';
    insert into probe_results values ('A1', 'sees_all=' || case when a = b and a > 0 then 't' else 'f admin=' || a || ' postgres=' || b end);
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_settings set activation_unit = activation_unit where id = 'main';
    get diagnostics n = row_count;
    select updated_by into cb from public.call_pay_settings where id = 'main';
    insert into probe_results values ('A2', 'updated=' || n || ' updated_by=' || coalesce(cb, 'null'));
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-05', 's3', 0.25, 'probe-pay A3') returning created_by into cb;
    insert into probe_results values ('A3', 'ok created_by=' || coalesce(cb, 'null'));
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-03', 's3', 1, 'probe-pay A4');
    insert into probe_results values ('A4', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- O1-O10: s3 is SWITCHED OFF (item 5b). As postgres the probe adds 's3' to stipend_off_ids (the final raise rolls it back with
-- everything else), then acts as s3, as s2 (still switched on), as the admin and as the coordinator.
do $$ declare us text; us2 text; ua text; uc text; n int; a int; b int; st int; begin
  select v into us from probe_ctx where k = 'surgeon';
  select v into us2 from probe_ctx where k = 'surgeon2';
  select v into ua from probe_ctx where k = 'admin';
  select v into uc from probe_ctx where k = 'coord';
  update public.call_pay_settings set stipend_off_ids = (stipend_off_ids - 's3') || '["s3"]'::jsonb where id = 'main';
  select count(*) into b from public.call_pay_logs where note like 'probe-pay%' and person_id = 's3';   -- as postgres
  execute 'set local role authenticated';
  -- as s3 (switched off)
  perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.call_pay_settings;
    insert into probe_results values ('O1', 'rows=' || n);
  exception when others then insert into probe_results values ('O1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.call_pay_logs where note like 'probe-pay%' and person_id = 's3';
    insert into probe_results values ('O2', 'own=' || n);
  exception when others then insert into probe_results values ('O2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 1, 'probe-pay O3');
    insert into probe_results values ('O3', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('O3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set hours = hours where note like 'probe-pay%' and person_id = 's3';
    get diagnostics n = row_count;
    insert into probe_results values ('O4', 'updated=' || n);
  exception when others then insert into probe_results values ('O4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_pay_logs where note like 'probe-pay%' and person_id = 's3';
    get diagnostics n = row_count;
    insert into probe_results values ('O5', 'deleted=' || n);
  exception when others then insert into probe_results values ('O5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  -- as s2 (still switched on): unchanged
  perform set_config('request.jwt.claims', json_build_object('sub', us2, 'role', 'authenticated')::text, true);
  begin
    select count(*) into st from public.call_pay_settings;
    select count(*) into n from public.call_pay_logs where note like 'probe-pay%' and person_id = 's2';
    insert into probe_results values ('O6', 'settings=' || st || ' own=' || n);
  exception when others then insert into probe_results values ('O6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  -- as the admin: still reads s3's rows; the guard refuses a new or edited call-in of a switched-off person for him too
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  begin
    select count(*) into a from public.call_pay_logs where note like 'probe-pay%' and person_id = 's3';
    insert into probe_results values ('O7', 'sees_s3=' || case when a = b and a > 0 then 't' else 'f admin=' || a || ' postgres=' || b end);
  exception when others then insert into probe_results values ('O7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-04', 's3', 1, 'probe-pay O8');
    insert into probe_results values ('O8', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('O8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_pay_logs set hours = hours where note like 'probe-pay%' and person_id = 's3';
    get diagnostics n = row_count;
    insert into probe_results values ('O9', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('O9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  -- as the coordinator: still reads s3's rows
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  begin
    select count(*) into a from public.call_pay_logs where note like 'probe-pay%' and person_id = 's3';
    insert into probe_results values ('O10', 'sees_s3=' || case when a = b and a > 0 then 't' else 'f coord=' || a || ' postgres=' || b end);
  exception when others then insert into probe_results values ('O10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- O11-O12: s3 is still switched off (same transaction). silvis_pay_enabled is callable as /rest/v1/rpc/silvis_pay_enabled by
-- every signed-in account; only a caller entitled to know (the scheduler / admin, the coordinator, the person himself, a
-- session with no signed-in user) gets the real answer - a viewer / follower or a colleague gets true, whoever is switched off.
do $$ declare uv text; us2 text; ua text; uc text; us text; a boolean; b boolean; c boolean; d boolean; e boolean; f boolean; begin
  select v into uv from probe_ctx where k = 'viewer';
  select v into us2 from probe_ctx where k = 'surgeon2';
  select v into ua from probe_ctx where k = 'admin';
  select v into uc from probe_ctx where k = 'coord';
  select v into us from probe_ctx where k = 'surgeon';
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', uv, 'role', 'authenticated')::text, true);
    a := public.silvis_pay_enabled('s3');
    perform set_config('request.jwt.claims', json_build_object('sub', us2, 'role', 'authenticated')::text, true);
    b := public.silvis_pay_enabled('s3');
    execute 'reset role';
    insert into probe_results values ('O11', 'viewer=' || coalesce(case when a then 't' else 'f' end, 'null') || ' colleague=' || coalesce(case when b then 't' else 'f' end, 'null'));
  exception when others then insert into probe_results values ('O11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
    c := public.silvis_pay_enabled('s3');
    perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
    d := public.silvis_pay_enabled('s3');
    perform set_config('request.jwt.claims', json_build_object('sub', us, 'role', 'authenticated')::text, true);
    e := public.silvis_pay_enabled('s3');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null (postgres, service_role)
    f := public.silvis_pay_enabled('s3');
    insert into probe_results values ('O12', 'admin=' || coalesce(case when c then 't' else 'f' end, 'null') || ' coord=' || coalesce(case when d then 't' else 'f' end, 'null')
      || ' self=' || coalesce(case when e then 't' else 'f' end, 'null') || ' nojwt=' || coalesce(case when f then 't' else 'f' end, 'null'));
  exception when others then insert into probe_results values ('O12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
