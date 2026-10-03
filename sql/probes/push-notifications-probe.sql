-- ============================================================================
-- Silvis Call Schedule - phone push PROBE (2026-10-03, Faraz 10/2 - Prompt 30: "Davenport's look, Silvis's own push";
-- sql/migrations/2026-10-03-push-notifications.sql, REPORT-FIRST, NOT APPLIED). Proves push_subscriptions, save_push_subscription(),
-- delete_push_subscription(), push_subscription_status() and the two notification_preferences *_push columns on the LIVE database
-- WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API
-- runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation
-- in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- P1=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the throwaway auth users, their profiles and
-- every row and audit row a case wrote roll back. After every run verify-rls.sh section 19 counts leftovers by the probe's
-- identity - its auth users, its audit rows and push_subscriptions rows with its endpoints (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/push-notifications-probe.sql
--   (scripts/verify-rls.sh section 19 runs it, grades each case by name and checks nothing persisted)
--
-- The setup raises, in this order and before any fixture is written: BEFORE the migration 'PROBE_SETUP: push_subscriptions is
-- absent - sql/migrations/2026-10-03-push-notifications.sql is not applied' (nothing else runs - that is every case's BEFORE
-- result); the table without a column 'PROBE_SETUP: notification_preferences.trade_updates_push is absent - ... is partly applied'
-- (schedule_updates_push the same). No collision guard is needed: every endpoint the probe writes carries a random tag
-- (https://fcm.googleapis.com/fcm/send/probe-push-<8 random hex>-<n>, kept in probe_ctx), so no live row can meet it. AFTER the
-- migration every case below must read as listed.
--
-- Fixtures: no push_subscriptions row is written by the setup. Keys: K1 = 'B' + 86 x 'A', A1 = 22 x 'A', K2 = 'B' + 86 x 'C',
-- A2 = 22 x 'C', K3 = 'B' + 86 x 'D' (shape-valid, obviously fake). Endpoints E1, E2, E10 .. E19, E20, E21 (the tag above with the
-- number as the last part). The acting users are three throwaway auth.users rows (email probe-push-<uuid>@example.test) whose
-- user_profiles rows the handle_new_auth_user trigger creates; postgres then sets them: U1 surgeon linked to person s9push (on no
-- roster - his prefs row never meets a live one) 'probe surgeon'; U2 viewer 'probe viewer two'; U3 viewer 'probe viewer three'
-- (its profile row is deleted by postgres for N8). Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon:
-- SET LOCAL ROLE anon + claims ''; no signed-in user = postgres with request.jwt.claims '{}'. Errors are recorded as 'ERR
-- <SQLSTATE> <message>'; every ';' in a recorded value becomes ',' (the case separator). State accumulates from case to case
-- (each case is its own subtransaction: a refused case leaves nothing). sps(...) = public.save_push_subscription(p_endpoint,
-- p_p256dh, p_auth, p_label), dps = public.delete_push_subscription(p_endpoint), pst = public.push_subscription_status(p_endpoint).
-- Readbacks: 'owner=' U1 / U2 / U3 / other / none (the row holding the endpoint, read AS POSTGRES); 'rows=' the push_subscriptions
-- rows the acting role can see; 'still=' the rows holding E1 (as postgres). Audit readbacks are read AS POSTGRES (the role reset
-- inside the case) over the push.% rows whose detail->>'profile_id' is a probe user: 'audit=' / 'audit_rows=' the count; 'actor='
-- self when the actor_id equals the caller's uuid text, else the actor_id; 'name=' the actor_name; 'sum=' the summary; 'keys=' the
-- detail's keys; 'other_ids=' yes when the moved row's audit names the account it moved from (its uuid or roster id).
--
-- Cases (BEFORE the migration: every case - PROBE_SETUP, nothing runs; AFTER the migration - the string after '->'):
--   P1  postgres: the table, its RLS, cascade, unique endpoint, policies, privileges, publication -> table=yes rls=yes fk=cascade unique_endpoint=yes policies=push_subscriptions_own_delete/delete/authenticated,push_subscriptions_own_read/select/authenticated anon_any=no auth_cols=created_at,device_label,fail_count,id,last_error_at,last_ok_at,profile_id auth_insert=no auth_update=no auth_delete=yes published=no
--   P2  postgres: the three functions, security, volatility, search_path, EXECUTE -> save=definer/volatile delete=definer/volatile status=definer/volatile paths=3 public_exec=0 anon_exec=0 auth_exec=3
--   P3  postgres: the table's check constraints -> checks=push_subscriptions_auth_shape,push_subscriptions_endpoint_shape,push_subscriptions_fail_count_check,push_subscriptions_label_shape,push_subscriptions_p256dh_shape
--   P4  postgres: the two prefs columns -> trade_updates_push=boolean/not_null/true schedule_updates_push=boolean/not_null/true
--   S1  U1 sps(E1, K1, A1, 'iPhone') -> ok action=added devices=1 audit=true
--   S2  postgres reads E1 -> owner=U1 label=iPhone fail=0 ok_at=null
--   S3  its audit row -> audit=1 action=push.save actor=s9push name=probe surgeon sum=probe surgeon: phone notifications on (iPhone) keys=action,device_label,profile_id,summary
--   S4  U1 sps(E1, K1, A1, 'iPhone') again -> ok action=kept devices=1 audit=false audit_rows=1
--   S5  U1 sps(E1, K2, A2, null) (new keys, no label) -> ok action=refreshed devices=1 label=iPhone
--   S6  U1 select count(*) -> rows=1
--   S7  U1 select endpoint -> ERR 42501 permission denied for table push_subscriptions
--   S8  U1 direct insert (its own profile) -> ERR 42501 permission denied for table push_subscriptions
--   S9  U1 direct update of fail_count on its own row -> ERR 42501 permission denied for table push_subscriptions
--   S10 U1 pst(E1) -> ok saved=true devices=1
--   B1  U1 sps('https://evil.example/push/x', K1, A1, null) -> ERR PS003 PUSH_BAD_ENDPOINT: this browser's push address is not one the app sends to - nothing was saved
--   B2  U1 sps('http://fcm.googleapis.com/fcm/send/x', K1, A1, null) -> ERR PS003 PUSH_BAD_ENDPOINT: this browser's push address is not one the app sends to - nothing was saved
--   B3  U1 sps(E2, 'abc', A1, null) -> ERR PS004 PUSH_BAD_KEYS: this browser's push keys are malformed - tap Reset subscription, then Enable (nothing was saved)
--   B4  U1 sps(E2, K1, 23 x 'A', null) -> ERR PS004 PUSH_BAD_KEYS: this browser's push keys are malformed - tap Reset subscription, then Enable (nothing was saved)
--   B5  U1 sps(E2, K1, A1, '<b>x</b>') -> ERR PS005 PUSH_BAD_LABEL: a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)
--   B6  U1 sps(E2, K1, A1, 41 x 'x') -> ERR PS005 PUSH_BAD_LABEL: a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)
--   B7  U1 select count(*) after B1-B6 -> rows=1
--   O1  U2 select count(*) -> rows=0
--   O2  U2 direct delete of U1's E1 row by id, then a delete with no WHERE -> deleted=0 still=1
--   O3  U2 dps(E1) -> ok removed=0 devices=0 audit=false still=1
--   O4  U2 pst(E1) -> ok saved=false devices=0
--   O5  U2 sps(E1, K3, A1, 'Chrome on Windows') (not the held keys) -> ERR PS006 PUSH_HELD: this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)
--   O5s owner of E1 after O5 -> owner=U1
--   O6  U2 sps(E1, K2, A2, 'Chrome on Windows') (the held keys) -> ok action=moved devices=1 audit=true
--   O6s postgres reads E1 -> owner=U2 label=Chrome on Windows fail=0
--   O6a its audit row -> actor=self name=probe viewer two sum=probe viewer two: phone notifications on (Chrome on Windows) - moved from another account other_ids=no
--   O7  U1 pst(E1) -> ok saved=false devices=0
--   C1  U1 sps(E10 .. E19, K1, A1, 'Pixel') (ten new endpoints) -> ok devices=10
--   C2  U1 sps(E20, K1, A1, 'Pixel') -> ERR PS007 PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)
--   C3  U1 select count(*) -> rows=10
--   D1  U1 dps(E10) -> ok removed=1 devices=9 audit=true
--   D2  its audit row -> action=push.delete sum=probe surgeon: phone notifications off (Pixel)
--   D3  U1 dps(E10) again -> ok removed=0 devices=9 audit=false
--   D4  U1 direct delete by id of E11's row -> deleted=1 rows=8
--   F1  U1 inserts its own prefs row (person s9push, no push keys) -> trade_updates_push=true schedule_updates_push=true
--   F2  U1 updates its row trade_updates_push = false -> updated=1 trade_updates_push=false
--   F3  U2 inserts its own follower prefs row (profile_id = U2, schedule_updates_push false) -> ok schedule_updates_push=false trade_updates_push=true
--   F4  U2 updates U1's prefs row -> updated=0
--   N1  anon: select count(*) from push_subscriptions -> ERR 42501 permission denied for table push_subscriptions
--   N2  anon: sps(E21, K1, A1, null) -> ERR 42501 permission denied for function save_push_subscription
--   N3  anon: dps(E1) -> ERR 42501 permission denied for function delete_push_subscription
--   N4  anon: pst(E1) -> ERR 42501 permission denied for function push_subscription_status
--   N5  postgres, no signed-in user: sps(E21, K1, A1, null) -> ERR PS001 PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account
--   N6  postgres, no signed-in user: pst(E1) -> ERR PS001 PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account
--   N7  postgres, no signed-in user: dps(E1) -> ERR PS001 PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account
--   N8  U3 after postgres deleted its profile row: sps(E21, K1, A1, null) -> ERR PS002 PUSH_NO_PROFILE: this account has no profile yet - ask the scheduler (nothing was saved)
--   X1  postgres deletes U2's auth user (U2 holds E1) -> before=1 after=0 audit_kept=yes
-- 51 cases.
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
  u3   uuid := gen_random_uuid();
  tag  text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  base text;
begin
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'PROBE_SETUP: push_subscriptions is absent - sql/migrations/2026-10-03-push-notifications.sql is not applied';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'trade_updates_push' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: notification_preferences.trade_updates_push is absent - sql/migrations/2026-10-03-push-notifications.sql is partly applied';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'schedule_updates_push' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: notification_preferences.schedule_updates_push is absent - sql/migrations/2026-10-03-push-notifications.sql is partly applied';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-push-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, u3]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, u3)) <> 3 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's9push', role = 'surgeon', display_name = 'probe surgeon' where id = u1;
  update public.user_profiles set display_name = 'probe viewer two' where id = u2;
  update public.user_profiles set display_name = 'probe viewer three' where id = u3;
  base := 'https://fcm.googleapis.com/fcm/send/probe-push-' || tag || '-';
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('u3', u3::text),
    ('e1', base || '1'), ('e2', base || '2'), ('e20', base || '20'), ('e21', base || '21'),
    ('k1', 'B' || repeat('A', 86)), ('a1', repeat('A', 22)), ('k2', 'B' || repeat('C', 86)), ('a2', repeat('C', 22)), ('k3', 'B' || repeat('D', 86));
  insert into probe_ctx select 'e' || g, base || g from generate_series(10, 19) g;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- readbacks (plain SQL in pg_temp; the cases call them AS POSTGRES - the role reset inside the case)
create or replace function pg_temp.ps_who(p_id uuid) returns text language sql as $$
  select case p_id::text when (select c.v from probe_ctx c where c.k = 'u1') then 'U1' when (select c.v from probe_ctx c where c.k = 'u2') then 'U2'
                         when (select c.v from probe_ctx c where c.k = 'u3') then 'U3' else 'other' end;
$$;
create or replace function pg_temp.ps_owner(p_ep text) returns text language sql as $$
  select 'owner=' || coalesce((select pg_temp.ps_who(s.profile_id) from public.push_subscriptions s where s.endpoint = p_ep), 'none');
$$;
create or replace function pg_temp.ps_row(p_ep text) returns text language sql as $$
  select coalesce((select 'owner=' || pg_temp.ps_who(s.profile_id) || ' label=' || coalesce(s.device_label, 'null') || ' fail=' || s.fail_count
                     from public.push_subscriptions s where s.endpoint = p_ep), 'owner=none');
$$;
create or replace function pg_temp.ps_still(p_ep text) returns text language sql as $$
  select 'still=' || count(*) from public.push_subscriptions s where s.endpoint = p_ep;
$$;
create or replace function pg_temp.ps_audit_n() returns bigint language sql as $$
  select count(*) from public.audit_log l where l.action like 'push.%' and l.detail ->> 'profile_id' in (select c.v from probe_ctx c where c.k in ('u1', 'u2', 'u3'));
$$;

-- P1-P4: as postgres - the objects as the migration leaves them
do $$ declare s regprocedure; d regprocedure; t regprocedure; begin
  begin
    insert into probe_results values ('P1',
      'table=' || case when to_regclass('public.push_subscriptions') is not null then 'yes' else 'no' end
      || ' rls=' || case when (select c.relrowsecurity from pg_class c where c.oid = 'public.push_subscriptions'::regclass) then 'yes' else 'no' end
      || ' fk=' || coalesce((select case k.confdeltype when 'c' then 'cascade' else k.confdeltype::text end from pg_constraint k
                             where k.conrelid = 'public.push_subscriptions'::regclass and k.contype = 'f' and k.confrelid = 'public.user_profiles'::regclass limit 1), 'none')
      || ' unique_endpoint=' || case when exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                                                  where k.conrelid = 'public.push_subscriptions'::regclass and k.contype = 'u' and cardinality(k.conkey) = 1 and a.attname = 'endpoint') then 'yes' else 'no' end
      || ' policies=' || coalesce((select string_agg(p.policyname || '/' || lower(p.cmd) || '/' || array_to_string(p.roles, ','), ',' order by p.policyname collate "C")
                                   from pg_policies p where p.schemaname = 'public' and p.tablename = 'push_subscriptions'), 'none')
      || ' anon_any=' || case when has_any_column_privilege('anon', 'public.push_subscriptions', 'select') or has_any_column_privilege('anon', 'public.push_subscriptions', 'insert')
                                  or has_any_column_privilege('anon', 'public.push_subscriptions', 'update') or has_any_column_privilege('anon', 'public.push_subscriptions', 'references')
                                  or has_table_privilege('anon', 'public.push_subscriptions', 'delete') or has_table_privilege('anon', 'public.push_subscriptions', 'truncate')
                                  or has_table_privilege('anon', 'public.push_subscriptions', 'trigger') then 'yes' else 'no' end
      || ' auth_cols=' || coalesce((select string_agg(a.attname::text, ',' order by a.attname::text collate "C") from pg_attribute a
                                    where a.attrelid = 'public.push_subscriptions'::regclass and a.attnum > 0 and not a.attisdropped
                                      and has_column_privilege('authenticated', 'public.push_subscriptions', a.attname::text, 'select')), 'none')
      || ' auth_insert=' || case when has_any_column_privilege('authenticated', 'public.push_subscriptions', 'insert') then 'yes' else 'no' end
      || ' auth_update=' || case when has_any_column_privilege('authenticated', 'public.push_subscriptions', 'update') then 'yes' else 'no' end
      || ' auth_delete=' || case when has_table_privilege('authenticated', 'public.push_subscriptions', 'delete') then 'yes' else 'no' end
      || ' published=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'push_subscriptions') then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    s := to_regprocedure('public.save_push_subscription(text, text, text, text)');
    d := to_regprocedure('public.delete_push_subscription(text)');
    t := to_regprocedure('public.push_subscription_status(text)');
    insert into probe_results values ('P2',
      'save=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = s), 'none')
      || ' delete=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = d), 'none')
      || ' status=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = t), 'none')
      || ' paths=' || (select count(*) from pg_proc p where p.oid in (s, d, t) and 'search_path=public, pg_temp' = any(p.proconfig))
      || ' public_exec=' || (select count(*) from unnest(array[s, d, t]) f where f is not null and has_function_privilege('public', f, 'execute'))
      || ' anon_exec=' || (select count(*) from unnest(array[s, d, t]) f where f is not null and has_function_privilege('anon', f, 'execute'))
      || ' auth_exec=' || (select count(*) from unnest(array[s, d, t]) f where f is not null and has_function_privilege('authenticated', f, 'execute')));
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P3',
      'checks=' || coalesce((select string_agg(k.conname::text, ',' order by k.conname::text collate "C") from pg_constraint k
                             where k.conrelid = 'public.push_subscriptions'::regclass and k.contype = 'c'), 'none'));
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P4',
      'trade_updates_push=' || coalesce((select format_type(a.atttypid, a.atttypmod) || '/' || case when a.attnotnull then 'not_null' else 'nullable' end || '/'
                                                || coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum), 'none')
                                           from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'trade_updates_push' and not a.attisdropped), 'none')
      || ' schedule_updates_push=' || coalesce((select format_type(a.atttypid, a.atttypmod) || '/' || case when a.attnotnull then 'not_null' else 'nullable' end || '/'
                                                || coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum), 'none')
                                           from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'schedule_updates_push' and not a.attisdropped), 'none'));
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- S1-S10, B1-B7: as the SURGEON U1 (linked s9push) - his own device
do $$ declare u text; e1 text; e2 text; k1 text; a1 text; k2 text; a2 text; r jsonb; n int; x text; rid uuid; begin
  select v into u from probe_ctx where k = 'u1';
  select v into e1 from probe_ctx where k = 'e1';
  select v into e2 from probe_ctx where k = 'e2';
  select v into k1 from probe_ctx where k = 'k1';
  select v into a1 from probe_ctx where k = 'a1';
  select v into k2 from probe_ctx where k = 'k2';
  select v into a2 from probe_ctx where k = 'a2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_push_subscription(e1, k1, a1, 'iPhone');
    insert into probe_results values ('S1', 'ok action=' || (r ->> 'action') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit'));
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('S2', pg_temp.ps_row(e1) || ' ok_at=' || coalesce((select case when s.last_ok_at is null then 'null' else 'set' end from public.push_subscriptions s where s.endpoint = e1), 'none'));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('S3', replace(coalesce((
      select 'audit=' || pg_temp.ps_audit_n() || ' action=' || l.action || ' actor=' || case when l.actor_id = u then 'self' else coalesce(l.actor_id, 'null') end
          || ' name=' || coalesce(l.actor_name, 'null') || ' sum=' || coalesce(l.detail ->> 'summary', 'null')
          || ' keys=' || coalesce((select string_agg(j, ',' order by j collate "C") from jsonb_object_keys(l.detail) j), 'none')
        from public.audit_log l where l.action like 'push.%' and l.detail ->> 'profile_id' = u limit 1), 'audit=0'), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e1, k1, a1, 'iPhone');
    execute 'reset role';
    insert into probe_results values ('S4', 'ok action=' || (r ->> 'action') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit') || ' audit_rows=' || pg_temp.ps_audit_n());
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e1, k2, a2, null);
    execute 'reset role';
    insert into probe_results values ('S5', 'ok action=' || (r ->> 'action') || ' devices=' || (r ->> 'devices')
      || ' label=' || coalesce((select coalesce(s.device_label, 'null') from public.push_subscriptions s where s.endpoint = e1), 'none'));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.push_subscriptions;
    insert into probe_results values ('S6', 'rows=' || n);
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select s.endpoint into x from public.push_subscriptions s limit 1;
    insert into probe_results values ('S7', 'read (NO refusal)');
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth) values (u::uuid, e2, k1, a1);
    insert into probe_results values ('S8', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select s.id into rid from public.push_subscriptions s limit 1;
    update public.push_subscriptions set fail_count = 1 where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('S9', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('S9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.push_subscription_status(e1);
    insert into probe_results values ('S10', 'ok saved=' || (r ->> 'saved') || ' devices=' || (r ->> 'devices'));
  exception when others then insert into probe_results values ('S10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription('https://evil.example/push/x', k1, a1, null);
    insert into probe_results values ('B1', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription('http://fcm.googleapis.com/fcm/send/x', k1, a1, null);
    insert into probe_results values ('B2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e2, 'abc', a1, null);
    insert into probe_results values ('B3', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e2, k1, repeat('A', 23), null);
    insert into probe_results values ('B4', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e2, k1, a1, '<b>x</b>');
    insert into probe_results values ('B5', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e2, k1, a1, repeat('x', 41));
    insert into probe_results values ('B6', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('B6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.push_subscriptions;
    insert into probe_results values ('B7', 'rows=' || n);
  exception when others then insert into probe_results values ('B7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- O1-O6a: as the VIEWER U2 - another account's device (O7 as U1 again)
do $$ declare u text; u1 text; e1 text; k1 text; a1 text; k2 text; a2 text; k3 text; r jsonb; n int; m int; rid uuid; begin
  select v into u from probe_ctx where k = 'u2';
  select v into u1 from probe_ctx where k = 'u1';
  select v into e1 from probe_ctx where k = 'e1';
  select v into k1 from probe_ctx where k = 'k1';
  select v into a1 from probe_ctx where k = 'a1';
  select v into k2 from probe_ctx where k = 'k2';
  select v into a2 from probe_ctx where k = 'a2';
  select v into k3 from probe_ctx where k = 'k3';
  select s.id into rid from public.push_subscriptions s where s.endpoint = e1;   -- as postgres, before the role switch
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into n from public.push_subscriptions;
    insert into probe_results values ('O1', 'rows=' || n);
  exception when others then insert into probe_results values ('O1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    -- by id, then with no WHERE at all: PostgreSQL applies the SELECT policy to a DELETE only when the statement reads a column, so
    -- the filter-less form is the one a permissive delete policy would let through (U2 holds no row here - both must delete nothing)
    delete from public.push_subscriptions where id = rid;
    get diagnostics n = row_count;
    delete from public.push_subscriptions;
    get diagnostics m = row_count;
    n := n + m;
    execute 'reset role';
    insert into probe_results values ('O2', 'deleted=' || n || ' ' || pg_temp.ps_still(e1));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('O2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.delete_push_subscription(e1);
    execute 'reset role';
    insert into probe_results values ('O3', 'ok removed=' || (r ->> 'removed') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit') || ' ' || pg_temp.ps_still(e1));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('O3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.push_subscription_status(e1);
    insert into probe_results values ('O4', 'ok saved=' || (r ->> 'saved') || ' devices=' || (r ->> 'devices'));
  exception when others then insert into probe_results values ('O4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e1, k3, a1, 'Chrome on Windows');
    insert into probe_results values ('O5', 'saved (NO refusal) action=' || (r ->> 'action'));
  exception when others then insert into probe_results values ('O5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('O5s', pg_temp.ps_owner(e1));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('O5s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e1, k2, a2, 'Chrome on Windows');
    insert into probe_results values ('O6', 'ok action=' || (r ->> 'action') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit'));
  exception when others then insert into probe_results values ('O6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('O6s', pg_temp.ps_row(e1));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('O6s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('O6a', replace(coalesce((
      select 'actor=' || case when l.actor_id = u then 'self' else coalesce(l.actor_id, 'null') end || ' name=' || coalesce(l.actor_name, 'null')
          || ' sum=' || coalesce(l.detail ->> 'summary', 'null')
          || ' other_ids=' || case when position(u1 in l.detail::text || ' ' || coalesce(l.actor_id, '') || ' ' || coalesce(l.actor_name, '')) > 0
                                     or position('s9push' in l.detail::text || ' ' || coalesce(l.actor_id, '') || ' ' || coalesce(l.actor_name, '')) > 0 then 'yes' else 'no' end
        from public.audit_log l where l.action = 'push.save' and l.detail ->> 'profile_id' = u and l.detail ->> 'action' = 'moved' limit 1), 'audit=none'), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('O6a', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    r := public.push_subscription_status(e1);
    insert into probe_results values ('O7', 'ok saved=' || (r ->> 'saved') || ' devices=' || (r ->> 'devices'));
  exception when others then insert into probe_results values ('O7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C3: as U1 - the 10-device cap
do $$ declare u text; k1 text; a1 text; e text; e20 text; r jsonb; n int; i int; begin
  select v into u from probe_ctx where k = 'u1';
  select v into k1 from probe_ctx where k = 'k1';
  select v into a1 from probe_ctx where k = 'a1';
  select v into e20 from probe_ctx where k = 'e20';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    for i in 10..19 loop
      select v into e from probe_ctx where k = 'e' || i;
      r := public.save_push_subscription(e, k1, a1, 'Pixel');
    end loop;
    insert into probe_results values ('C1', 'ok devices=' || (r ->> 'devices'));
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e20, k1, a1, 'Pixel');
    insert into probe_results values ('C2', 'saved (NO refusal) devices=' || (r ->> 'devices'));
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.push_subscriptions;
    insert into probe_results values ('C3', 'rows=' || n);
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- D1-D4: as U1 - turning a device off (the definer and the direct delete)
do $$ declare u text; e10 text; e11 text; r jsonb; n int; m int; rid uuid; begin
  select v into u from probe_ctx where k = 'u1';
  select v into e10 from probe_ctx where k = 'e10';
  select v into e11 from probe_ctx where k = 'e11';
  select s.id into rid from public.push_subscriptions s where s.endpoint = e11;   -- as postgres, before the role switch
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.delete_push_subscription(e10);
    insert into probe_results values ('D1', 'ok removed=' || (r ->> 'removed') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit'));
  exception when others then insert into probe_results values ('D1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('D2', replace(coalesce((
      select string_agg('action=' || l.action || ' sum=' || coalesce(l.detail ->> 'summary', 'null'), ' | ' order by l.detail ->> 'summary' collate "C")
        from public.audit_log l where l.action = 'push.delete' and l.detail ->> 'profile_id' = u), 'audit=none'), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('D2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.delete_push_subscription(e10);
    insert into probe_results values ('D3', 'ok removed=' || (r ->> 'removed') || ' devices=' || (r ->> 'devices') || ' audit=' || (r ->> 'audit'));
  exception when others then insert into probe_results values ('D3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.push_subscriptions where id = rid;
    get diagnostics n = row_count;
    select count(*) into m from public.push_subscriptions;
    insert into probe_results values ('D4', 'deleted=' || n || ' rows=' || m);
  exception when others then insert into probe_results values ('D4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- F1-F4: the two prefs columns through prefs_own (U1 his roster row, U2 her follower row)
do $$ declare u1 text; u2 text; n int; begin
  select v into u1 from probe_ctx where k = 'u1';
  select v into u2 from probe_ctx where k = 'u2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    insert into public.notification_preferences (person_id) values ('s9push');
    insert into probe_results values ('F1', coalesce((select 'trade_updates_push=' || p.trade_updates_push || ' schedule_updates_push=' || p.schedule_updates_push
                                                        from public.notification_preferences p where p.person_id = 's9push'), 'row=none'));
  exception when others then insert into probe_results values ('F1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.notification_preferences set trade_updates_push = false where person_id = 's9push';
    get diagnostics n = row_count;
    insert into probe_results values ('F2', 'updated=' || n || ' trade_updates_push=' || coalesce((select p.trade_updates_push::text from public.notification_preferences p where p.person_id = 's9push'), 'none'));
  exception when others then insert into probe_results values ('F2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin
    insert into public.notification_preferences (profile_id, schedule_updates_push) values (u2::uuid, false);
    insert into probe_results values ('F3', coalesce((select 'ok schedule_updates_push=' || p.schedule_updates_push || ' trade_updates_push=' || p.trade_updates_push
                                                        from public.notification_preferences p where p.profile_id = u2::uuid), 'row=none'));
  exception when others then insert into probe_results values ('F3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.notification_preferences set trade_updates_push = true where person_id = 's9push';
    get diagnostics n = row_count;
    insert into probe_results values ('F4', 'updated=' || n);
  exception when others then insert into probe_results values ('F4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1-N4: as ANON (no privilege on the table, no EXECUTE); N5-N7: as postgres with NO signed-in user; N8: an account without a profile row
do $$ declare e1 text; e21 text; k1 text; a1 text; u3 text; r jsonb; n bigint; begin
  select v into e1 from probe_ctx where k = 'e1';
  select v into e21 from probe_ctx where k = 'e21';
  select v into k1 from probe_ctx where k = 'k1';
  select v into a1 from probe_ctx where k = 'a1';
  select v into u3 from probe_ctx where k = 'u3';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.push_subscriptions;
    insert into probe_results values ('N1', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_push_subscription(e21, k1, a1, null);
    insert into probe_results values ('N2', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.delete_push_subscription(e1);
    insert into probe_results values ('N3', 'ran (NO refusal)');
  exception when others then insert into probe_results values ('N3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.push_subscription_status(e1);
    insert into probe_results values ('N4', 'ran (NO refusal)');
  exception when others then insert into probe_results values ('N4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    r := public.save_push_subscription(e21, k1, a1, null);
    insert into probe_results values ('N5', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.push_subscription_status(e1);
    insert into probe_results values ('N6', 'ran (NO refusal)');
  exception when others then insert into probe_results values ('N6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.delete_push_subscription(e1);
    insert into probe_results values ('N7', 'ran (NO refusal)');
  exception when others then insert into probe_results values ('N7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  delete from public.user_profiles where id = u3::uuid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  begin
    r := public.save_push_subscription(e21, k1, a1, null);
    insert into probe_results values ('N8', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- X1: as postgres - deleting the account removes its devices (auth.users -> user_profiles -> push_subscriptions); the audit rows stay
do $$ declare u2 text; b bigint; a bigint; begin
  select v into u2 from probe_ctx where k = 'u2';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into b from public.push_subscriptions where profile_id = u2::uuid;
    delete from auth.users where id = u2::uuid;
    select count(*) into a from public.push_subscriptions where profile_id = u2::uuid;
    insert into probe_results values ('X1', 'before=' || b || ' after=' || a || ' audit_kept='
      || case when exists (select 1 from public.audit_log l where l.action like 'push.%' and l.detail ->> 'profile_id' = u2) then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('X1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
