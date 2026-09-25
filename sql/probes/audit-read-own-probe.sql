-- ============================================================================
-- Silvis Call Schedule - AUDIT READ-BACK PROBE (Prompt 21 step 1, Faraz 9/25). Proves sql/migrations/2026-09-25-audit-read-own.sql
-- on the LIVE database WITHOUT PERSISTING ANYTHING - and, run BEFORE the migration, shows the gap it closes: a surgeon's audit
-- row inserted the way the client sends it (db.insert: Prefer: return=representation = INSERT ... RETURNING) is refused with
-- 42501, while the same insert without RETURNING (the prelaunch probe's L4) passes - which is why verify-rls stayed green.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the file as one multi-statement
-- request through the Management API, which runs it in a single implicit transaction (observed 2026-09-22 on this
-- project: a batch ending in RAISE persists nothing); there is no BEGIN/COMMIT here on purpose. Every case records its
-- observation in a temp table (granted to authenticated, because the cases run as that role), and the LAST statement raises
-- an exception whose message carries the collected results ('PROBE_RESULTS A1=...;END' - the ';END' sentinel marks where the
-- message stops and the CLI's own suffix begins), so the transaction - the throwaway auth users, their profile rows and every
-- audit row below - rolls back. scripts/verify-rls.sh section 13 runs it, grades every case and counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/audit-read-own-probe.sql
--
-- Fixtures (as postgres: RLS bypassed): six throwaway auth.users probe-auditown-<uuid>@example.test whose user_profiles rows
-- handle_new_auth_user creates - a LINKED SURGEON (s3 Acton, role surgeon), a SECOND SURGEON (s2 Burchett, role surgeon), a
-- COORDINATOR and a SECOND COORDINATOR (role coordinator, no roster link: logAudit writes actor_id = the profile id for them),
-- an unlinked VIEWER (left as created - what a follower is) and an ADMIN (s1, role admin); eight audit rows, one per author and
-- family: s3 'timeoff.add', s2 'timeoff.add', s1 'timeoff.add', the coordinator 'prefs.save' (outside audit_read_coord's
-- timeoff. / offers. / availability. families), the second coordinator 'timeoff.add' and 'prefs.save', a CLI row (actor_id
-- null, as scripts/day-edit.js and scripts/publish-preview.js write it) and a daily-reminder row (actor_id 'cron',
-- 'period.close') - those two stay scheduler / admin only (S6 / C6 / V3 read 0 of them, A2 sees them). EVERY probe audit row -
-- fixture or case - carries detail.probe = 'probe-auditown' (the leftover count keys on it), and every count below is taken over
-- those rows only, so the live table's own rows never enter a result. Acting as a user = SET LOCAL ROLE authenticated +
-- request.jwt.claims.sub (what PostgREST sets; auth.uid() reads it).
--
-- "RETURNING *" is what PostgREST's INSERT reads back for Prefer: return=representation (the client's db.insert). S2 / C4 go one
-- step further and use PostgREST's return=representation shape: the insert inside a CTE named pgrst_source, "returning
-- public.audit_log.*", the row built from the JSON body with json_to_record, the result aggregated with json_agg. That is
-- RLS-equivalent (a column-reading RETURNING inside the pgrst_source CTE), not byte-identical: PostgREST 12's own statement
-- builds the body through json_to_recordset(CASE json_typeof ...) and selects more columns - no REST call is made here.
-- RETURNING 1 reads no column and needs no SELECT policy (S3, a control), nor does a plain insert (S4 / C3).
--
-- Cases - the string each one reads BEFORE the migration (the live picture on 9/25) and AFTER it:
--   P1  postgres: the policies on public.audit_log, by name
--         BEFORE policies=audit_insert,audit_read,audit_read_coord
--         AFTER  policies=audit_insert,audit_read,audit_read_coord,audit_read_own
--   S1  surgeon s3 inserts his own timeoff.add row, RETURNING *        (THE case - what the client sends; it would have caught the bug)
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"
--         AFTER  ok
--   S2  surgeon s3, PostgREST's return=representation shape (with pgrst_source as (insert ... returning public.audit_log.*) ...)
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"
--         AFTER  ok rows=1
--   S3  surgeon s3, RETURNING 1 (control)                  BEFORE ok   AFTER ok
--   S4  surgeon s3, no RETURNING (control; the prelaunch probe's L4)
--                                                          BEFORE ok   AFTER ok
--   S5  surgeon s3 reads his own probe rows (actor_id = s3: the fixture, S3, S4 - and S1, S2 once they land)
--         BEFORE own=0      AFTER own=5
--   S6  surgeon s3 reads the other authors' probe rows (s2's and s1's fixtures, the two coordinators' rows, the CLI row -
--       actor_id null - and the daily-reminder's 'cron' row)
--         BEFORE s2=0 s1=0 coord=0 cli=0 cron=0      AFTER s2=0 s1=0 coord=0 cli=0 cron=0
--   S7  surgeon s3 inserts a row as s2, RETURNING * (unchanged refusal: audit_insert's WITH CHECK)
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"      AFTER the same
--   T1  surgeon s2 reads the probe rows: his own (the fixture) and s3's (the fixture + S1..S4)
--         BEFORE own=0 s3=0      AFTER own=1 s3=0
--   C1  coordinator timeoff.add as itself (actor_id = its profile id), RETURNING * (audit_read_coord already covers the family)
--                                                          BEFORE ok   AFTER ok
--   C2  coordinator prefs.save as itself, RETURNING *
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"
--         AFTER  ok
--   C3  coordinator prefs.save as itself, no RETURNING     BEFORE ok   AFTER ok
--   C4  coordinator prefs.save, PostgREST's return=representation shape
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"
--         AFTER  ok rows=1
--   C5  coordinator reads its own probe rows - in the three families (C1) and outside them (the fixture, C3 - and C2, C4 once
--       they land)
--         BEFORE own_family=1 own_other=0      AFTER own_family=1 own_other=4
--   C6  coordinator reads the second coordinator's rows, the surgeons' rows (s1 / s2 / s3), the CLI row and the 'cron' row
--         BEFORE coord2=0 surgeons=0 cli=0 cron=0      AFTER coord2=0 surgeons=0 cli=0 cron=0
--   C7  coordinator inserts a row as s3, RETURNING * (unchanged refusal: audit_insert's WITH CHECK)
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"      AFTER the same
--   D1  second coordinator reads: its own family row (timeoff.add), its own prefs.save row, the first coordinator's rows
--         BEFORE own_family=1 own_other=0 coord=0      AFTER own_family=1 own_other=1 coord=0
--   V1  viewer prefs.save as itself, no RETURNING  (decision 1c: an unlinked viewer - a follower - writes no audit row)
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"      AFTER the same
--   V2  viewer prefs.save as itself, RETURNING *
--         BEFORE ERR 42501 new row violates row-level security policy for table "audit_log"      AFTER the same
--   V3  viewer reads the probe rows                         BEFORE visible=0   AFTER visible=0
--   A1  admin s1 inserts as s1, RETURNING * (control: audit_read)
--                                                          BEFORE ok   AFTER ok
--   A2  admin reads every probe row (his count = the count as postgres)
--                                                          BEFORE sees_all=t   AFTER sees_all=t
-- (only ';' inside error text is replaced by ',' so the message splits on ';'; verify-rls.sh grades every key)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed)
do $$
declare
  surgeon  uuid := gen_random_uuid();
  surgeon2 uuid := gen_random_uuid();
  coord    uuid := gen_random_uuid();
  coord2   uuid := gen_random_uuid();
  viewer   uuid := gen_random_uuid();
  admin_u  uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-auditown-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[surgeon, surgeon2, coord, coord2, viewer, admin_u]) as u;
  if (select count(*) from public.user_profiles where id in (surgeon, surgeon2, coord, coord2, viewer, admin_u)) <> 6 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = 's2', role = 'surgeon' where id = surgeon2;
  update public.user_profiles set role = 'coordinator' where id = coord;
  update public.user_profiles set role = 'coordinator' where id = coord2;
  update public.user_profiles set person_id = 's1', role = 'admin' where id = admin_u;
  if not exists (select 1 from public.user_profiles where id = viewer and role = 'viewer' and person_id is null) then
    raise exception 'PROBE_SETUP: the viewer is not an unlinked viewer';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('surgeon2', surgeon2::text), ('coord', coord::text), ('coord2', coord2::text),
                               ('viewer', viewer::text), ('admin', admin_u::text);
  insert into public.audit_log (actor_id, actor_name, action, detail)
  values ('s3', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown"}'::jsonb),
         ('s2', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown"}'::jsonb),
         ('s1', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown"}'::jsonb),
         (coord::text, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown"}'::jsonb),
         (coord2::text, 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown"}'::jsonb),
         (coord2::text, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown"}'::jsonb),
         (null, 'probe auditown', 'schedule.day_edit', '{"probe":"probe-auditown"}'::jsonb),
         ('cron', 'probe auditown', 'period.close', '{"probe":"probe-auditown"}'::jsonb);
end $$;

-- P1: as postgres - the policies on audit_log (the fingerprint of the apply)
do $$ declare v text; begin
  begin
    select string_agg(policyname::text, ',' order by policyname) into v from pg_policies where schemaname = 'public' and tablename = 'audit_log';
    insert into probe_results values ('P1', 'policies=' || coalesce(v, '(none)'));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- S1-S7: as the LINKED SURGEON (s3)
do $$ declare u text; c1 text; c2 text; n int; a int; b int; c int; n_cli int; n_cron int; r record; body text; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v into c1 from probe_ctx where k = 'coord';
  select v into c2 from probe_ctx where k = 'coord2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"S1"}'::jsonb) returning * into r;
    insert into probe_results values ('S1', 'ok');
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    with pgrst_source as (
      insert into public.audit_log (actor_id, actor_name, action, detail)
      select pgrst_body.actor_id, pgrst_body.actor_name, pgrst_body.action, pgrst_body.detail
        from (select '{"actor_id":"s3","actor_name":"probe auditown","action":"timeoff.add","detail":{"probe":"probe-auditown","case":"S2"}}'::json as json_data) pgrst_payload,
             lateral (select * from json_to_record(pgrst_payload.json_data) as _(actor_id text, actor_name text, action text, detail jsonb)) pgrst_body
      returning public.audit_log.*)
    select pg_catalog.count(_postgrest_t), coalesce(json_agg(_postgrest_t), '[]')::text into n, body from (select * from pgrst_source) _postgrest_t;
    insert into probe_results values ('S2', 'ok rows=' || n);
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"S3"}'::jsonb) returning 1 into n;
    insert into probe_results values ('S3', 'ok');
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"S4"}'::jsonb);
    insert into probe_results values ('S4', 'ok');
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.audit_log where detail ->> 'probe' = 'probe-auditown' and actor_id = 's3';
    insert into probe_results values ('S5', 'own=' || n);
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where actor_id = 's2'), count(*) filter (where actor_id = 's1'), count(*) filter (where actor_id in (c1, c2)),
           count(*) filter (where actor_id is null), count(*) filter (where actor_id = 'cron')
      into a, b, c, n_cli, n_cron from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('S6', 's2=' || a || ' s1=' || b || ' coord=' || c || ' cli=' || n_cli || ' cron=' || n_cron);
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s2', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"S7"}'::jsonb) returning * into r;
    insert into probe_results values ('S7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- T1: as the SECOND SURGEON (s2) - a surgeon's own rows only, never another surgeon's
do $$ declare u text; a int; b int; begin
  select v into u from probe_ctx where k = 'surgeon2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where actor_id = 's2'), count(*) filter (where actor_id = 's3')
      into a, b from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('T1', 'own=' || a || ' s3=' || b);
  exception when others then insert into probe_results values ('T1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C7: as the COORDINATOR (no roster link; actor_id = its profile id, as logAudit writes it)
do $$ declare u text; c2 text; n int; a int; b int; n_cli int; n_cron int; r record; body text; begin
  select v into u from probe_ctx where k = 'coord';
  select v into c2 from probe_ctx where k = 'coord2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"C1"}'::jsonb) returning * into r;
    insert into probe_results values ('C1', 'ok');
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown","case":"C2"}'::jsonb) returning * into r;
    insert into probe_results values ('C2', 'ok');
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown","case":"C3"}'::jsonb);
    insert into probe_results values ('C3', 'ok');
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    with pgrst_source as (
      insert into public.audit_log (actor_id, actor_name, action, detail)
      select pgrst_body.actor_id, pgrst_body.actor_name, pgrst_body.action, pgrst_body.detail
        from (select json_build_object('actor_id', u, 'actor_name', 'probe auditown', 'action', 'prefs.save', 'detail', json_build_object('probe', 'probe-auditown', 'case', 'C4')) as json_data) pgrst_payload,
             lateral (select * from json_to_record(pgrst_payload.json_data) as _(actor_id text, actor_name text, action text, detail jsonb)) pgrst_body
      returning public.audit_log.*)
    select pg_catalog.count(_postgrest_t), coalesce(json_agg(_postgrest_t), '[]')::text into n, body from (select * from pgrst_source) _postgrest_t;
    insert into probe_results values ('C4', 'ok rows=' || n);
  exception when others then insert into probe_results values ('C4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where action like 'timeoff.%' or action like 'offers.%' or action like 'availability.%'),
           count(*) filter (where not (action like 'timeoff.%' or action like 'offers.%' or action like 'availability.%'))
      into a, b from public.audit_log where detail ->> 'probe' = 'probe-auditown' and actor_id = u;
    insert into probe_results values ('C5', 'own_family=' || a || ' own_other=' || b);
  exception when others then insert into probe_results values ('C5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where actor_id = c2), count(*) filter (where actor_id in ('s1', 's2', 's3')),
           count(*) filter (where actor_id is null), count(*) filter (where actor_id = 'cron')
      into a, b, n_cli, n_cron from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('C6', 'coord2=' || a || ' surgeons=' || b || ' cli=' || n_cli || ' cron=' || n_cron);
  exception when others then insert into probe_results values ('C6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"C7"}'::jsonb) returning * into r;
    insert into probe_results values ('C7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- D1: as the SECOND COORDINATOR - its own rows only, never the first coordinator's
do $$ declare u text; c1 text; a int; b int; c int; begin
  select v into u from probe_ctx where k = 'coord2';
  select v into c1 from probe_ctx where k = 'coord';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where actor_id = u and action = 'timeoff.add'), count(*) filter (where actor_id = u and action = 'prefs.save'), count(*) filter (where actor_id = c1)
      into a, b, c from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('D1', 'own_family=' || a || ' own_other=' || b || ' coord=' || c);
  exception when others then insert into probe_results values ('D1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- V1-V3: as the unlinked VIEWER (what a follower is) - decision 1c: unchanged, it writes and reads no audit row
do $$ declare u text; n int; r record; begin
  select v into u from probe_ctx where k = 'viewer';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown","case":"V1"}'::jsonb);
    insert into probe_results values ('V1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('V1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe auditown', 'prefs.save', '{"probe":"probe-auditown","case":"V2"}'::jsonb) returning * into r;
    insert into probe_results values ('V2', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('V2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('V3', 'visible=' || n);
  exception when others then insert into probe_results values ('V3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A2: as the ADMIN (s1) - controls: audit_read (every row) is unchanged
do $$ declare u text; a int; b int; r record; begin
  select v into u from probe_ctx where k = 'admin';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s1', 'probe auditown', 'timeoff.add', '{"probe":"probe-auditown","case":"A1"}'::jsonb) returning * into r;
    insert into probe_results values ('A1', 'ok');
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into a from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    execute 'reset role';
    select count(*) into b from public.audit_log where detail ->> 'probe' = 'probe-auditown';
    insert into probe_results values ('A2', 'sees_all=' || case when a = b and a > 0 then 't' else 'f admin=' || a || ' postgres=' || b end);
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
