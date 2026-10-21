-- ============================================================================
-- Silvis Call Schedule - phone push follow-ups PROBE (2026-10-20, revision z; sql/migrations/2026-10-20-push-followups.sql, REPORT-FIRST, NOT APPLIED).
-- Proves replace_push_subscription() (the re-arm save) and notification_preferences.shift_reminders_push on the LIVE database
-- WITHOUT PERSISTING ANYTHING. Same mechanism as the other probes: ONE batch through the linked CLI (one implicit transaction, no
-- BEGIN/COMMIT); every case records into probe_results; the LAST statement raises 'PROBE_RESULTS K=...;END', so everything - users,
-- profiles, devices, prefs rows, audit rows - rolls back. A batch ending in RAISE persists nothing.
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/push-followups-probe.sql
--   (graded by the private apply-push-followups.sh, value for value against the header lines below)
-- Run nothing else that saves a phone subscription at the same time: the probe holds the push_subscriptions:save advisory lock (the
-- one save_push_subscription takes) for the length of the batch - well under a second.
-- Identity: users probe-pushz-<uuid>@example.test whose user_profiles rows handle_new_auth_user creates; postgres then sets them: U1 a
-- surgeon linked to person s9pushz (on no roster - his prefs row never meets a live one) 'probe pushz surgeon', U2 a viewer 'probe pushz
-- viewer two' (another account, and a follower's own prefs row keyed by profile_id), U3 a viewer 'probe pushz viewer three' (the cap,
-- on a clean slate). Endpoints https://fcm.googleapis.com/fcm/send/probe-pushz-<8 random hex>-<n> (E1 .. E21, the number last, kept in
-- probe_ctx) and ONE fixed endpoint, EV = https://fcm.googleapis.com/fcm/send/probe-pushz-vector, whose hash the file states as a
-- constant (H1: the function reads the client's _hash - first 16 hex of SHA-256 of the UTF-8 endpoint - test/schema.test.js recomputes
-- it). The collision guard first proves no live row carries the identity (a probe-pushz user or endpoint, person s9pushz, a prefs row
-- of s9pushz). Keys: K1 = 'B' + 86 x 'A', A1 = 22 x 'A', K3 = 'B' + 86 x 'D' (shape-valid, obviously fake).
-- Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon: SET LOCAL ROLE anon + claims ''; no signed-in user =
-- postgres with request.jwt.claims '{}'. Errors are recorded as 'ERR <SQLSTATE> <message>'. State accumulates from case to case (each
-- case is its own subtransaction: a refused case leaves nothing). rpl(e, k, a, label, hash) = public.replace_push_subscription(p_endpoint,
-- p_p256dh, p_auth, p_label, p_replaces); sps(e, k, a, label) = public.save_push_subscription; h(E) = left(encode(sha256(convert_to(E,
-- 'UTF8')), 'hex'), 16), the probe's own helper (H1 ties the function to the client's reading with the constant).
-- Reading: 'ok action=<a> devices=<n> audit=<t|f>' an answer (' replaced=<n>' when it carries the key); readbacks AS POSTGRES (the role
-- reset inside the case): 'e<n>=U1|U2|U3|none' who holds an endpoint, 'u<n>=<n>' how many rows an account holds; audit readbacks over
-- the push.% rows whose detail->>'profile_id' is a probe user, and R1a's 'batch_rows=<n>' over EVERY audit_log row the batch has
-- written so far, whatever its action or detail (created_at = now(), the batch's one transaction time - another session's rows carry
-- their own transaction's; the setup and P1-P3 write none, so it counts H1's and R1's rows alone).
-- Cases (BEFORE the migration the setup raises PROBE_SETUP: replace_push_subscription is absent; AFTER - the string after '->'):
--   P1  postgres: replace_push_subscription - security, volatility, search_path, arguments, result, EXECUTE -> replace=definer/volatile path=yes args=p_endpoint text, p_p256dh text, p_auth text, p_label text, p_replaces text result=jsonb public_exec=f anon_exec=f auth_exec=t
--   P2  postgres: save_push_subscription as Prompt 30 left it -> save=definer/volatile args=p_endpoint text, p_p256dh text, p_auth text, p_label text DEFAULT NULL::text anon_exec=f auth_exec=t
--   P3  postgres: the new column -> shift_reminders_push=boolean/not_null/true comment=yes
--   H1  U1 sps(EV, K1, A1, 'iPhone'), then rpl(E1, K1, A1, 'iPhone', '30f005d396c75892') (EV's hash, the client's reading) -> ok action=added devices=1 audit=true replaced=1 ev=none e1=U1
--   R1  U1 rpl(E2, K1, A1, 'iPhone', h(E1)) (a re-arm: a new endpoint replaces his own old row) -> ok action=added devices=1 audit=true replaced=1
--   R1s readback -> e1=none e2=U1 u1=1
--   R1a U1's audit rows, then every audit row the batch wrote (D3: no row of any kind for the two replaced rows - H1's EV, R1's E1) -> save=3 delete=0 sums=probe pushz surgeon: phone notifications on (iPhone) batch_rows=3
--   K1  U1 rpl(E2, K1, A1, 'iPhone', h(E1)) again (E1 is gone: a well-formed hash that names no row) - the answer's keys -> keys=action,audit,devices,ok,replaced action=kept replaced=0
--   R2  U1 rpl(E2, K1, A1, 'iPhone', h(E2)) (the hash of the endpoint being saved) -> ok action=kept devices=1 audit=false replaced=0 e2=U1
--   R3  U1 sps(E3, K1, A1, 'Pixel') (a second device) -> ok action=added devices=2 audit=true
--   R4  U1 rpl(E2, K1, A1, 'iPhone', h(E3) || 'a') (17 characters) -> ok action=kept devices=2 audit=false replaced=0 e3=U1
--   R5  U1 rpl(E2, K1, A1, 'iPhone', left(h(E3), 15)) (15 characters) -> ok action=kept devices=2 audit=false replaced=0 e3=U1
--   R6  U1 rpl(E2, K1, A1, 'iPhone', null) -> ok action=kept devices=2 audit=false replaced=0 e3=U1
--   R7  U1 rpl(E2, K1, A1, 'iPhone', '') -> ok action=kept devices=2 audit=false replaced=0 e3=U1
--   O1  U2 sps(E5, K1, A1, 'Chrome') -> ok action=added devices=1 audit=true
--   O2  U1 rpl(E6, K1, A1, 'iPad', h(E5)) (another account's row's hash) -> ok action=added devices=3 audit=true replaced=0 e5=U2
--   M1  U2 rpl(E6, K3, A1, 'Chrome', h(E5)) (U1 holds E6; not the held keys) -> ERR PS006 PUSH_HELD: this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)
--   M1s readback (U2's own E5 delete rolled back with the refusal) -> e5=U2 e6=U1 u2=1
--   M2  U2 rpl(E6, K1, A1, 'Chrome', h(E5)) (the held keys: the move, as save makes it) -> ok action=moved devices=1 audit=true replaced=1
--   M2s readback -> e5=none e6=U2 u1=2 u2=1
--   M2a U2's audit rows -> sum=probe pushz viewer two: phone notifications on (Chrome) - moved from another account delete=0
--   B1  U1 rpl('https://evil.example/push/x', K1, A1, null, h(E3)) -> ERR PS003 PUSH_BAD_ENDPOINT: this browser's push address is not one the app sends to - nothing was saved
--   B2  U1 rpl(E7, 'abc', A1, null, h(E3)) -> ERR PS004 PUSH_BAD_KEYS: this browser's push keys are malformed - tap Reset subscription, then Enable (nothing was saved)
--   B3  U1 rpl(E7, K1, A1, '<b>x</b>', h(E3)) -> ERR PS005 PUSH_BAD_LABEL: a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)
--   B4  readback (each refusal rolled its delete of E3 back) -> e3=U1 e7=none u1=2
--   C1  U3 sps(E10 .. E19, K1, A1, 'Pixel') (ten devices) -> ok devices=10
--   C2  U3 rpl(E20, K1, A1, 'Pixel', h(E10)) (10 rows, the replaced one among them) -> ok action=added devices=10 audit=true replaced=1
--   C2s readback -> e10=none e20=U3 u3=10
--   C3  U3 rpl(E21, K1, A1, 'Pixel', h(E2)) (10 rows; the hash names U1's row, not his) -> ERR PS007 PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)
--   C3s readback -> e2=U1 e21=none u3=10
--   C4  U3 rpl(E2, K1, A1, 'Pixel', h(E11)) (a move onto a full account, his own E11 replaced first) -> ok action=moved devices=10 audit=true replaced=1
--   C4s readback -> e2=U3 e11=none u1=1 u3=10
--   C5  U3 rpl(E3, K1, A1, null, h(E1)) (a move onto a full account, no row of his replaced) -> ERR PS007 PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)
--   C5s readback -> e3=U1 u3=10
--   C6  U3 rpl(E3, K3, A1, null, h(E12)) (his E12 deleted, then the held endpoint with other keys) -> ERR PS006 PUSH_HELD: this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)
--   C6s readback (the delete rolled back) -> e3=U1 e12=U3 u3=10
--   N1  anon: rpl(E21, K1, A1, null, h(E3)) -> ERR 42501 permission denied for function replace_push_subscription
--   N2  postgres, no signed-in user: rpl(E21, K1, A1, null, h(E3)) -> ERR PS001 PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account
--   N3  readback -> e3=U1 e21=none
--   F1  U1 inserts his own prefs row (person s9pushz, naming no push key) -> shift_reminders_push=true shift_reminders_email=true trade_updates_push=true schedule_updates_push=true
--   F2  U1 updates it shift_reminders_push = false -> updated=1 shift_reminders_push=false shift_reminders_email=true
--   F3  U1 upserts it naming shift_reminders_email only (false - today's client's save) -> shift_reminders_push=false shift_reminders_email=false
--   F4  U2 inserts her own follower prefs row (profile_id = U2, naming no push key) -> ok shift_reminders_push=true
--   F5  U2 updates it shift_reminders_push = false -> updated=1 shift_reminders_push=false
--   F6  U2 updates U1's row shift_reminders_push = true -> updated=0
--   F7  anon: counts the rows with the column read -> rows=0
-- 46 cases.
-- Every existing row reading on after the apply is the pre-check's fact (its prefs row after the apply: reminder_push_on = rows) and
-- the offline proof's (rows written before the migration); a probe run later than the apply would see the stored choices.
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
  u1   uuid := gen_random_uuid();
  u2   uuid := gen_random_uuid();
  u3   uuid := gen_random_uuid();
  tag  text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  base text;
begin
  -- the collision guard first (a dry run must see it), on what the fixtures can meet only
  if exists (select 1 from auth.users where email like 'probe-pushz-%')
     or exists (select 1 from public.push_subscriptions where endpoint like 'https://fcm.googleapis.com/fcm/send/probe-pushz-%')
     or exists (select 1 from public.user_profiles where person_id = 's9pushz')
     or exists (select 1 from public.notification_preferences where person_id = 's9pushz') then
    raise exception 'PROBE_SETUP: live rows already carry the probe identity (a probe-pushz user or endpoint, or person s9pushz) - the probe fixtures would collide';
  end if;
  if to_regprocedure('public.replace_push_subscription(text, text, text, text, text)') is null then
    raise exception 'PROBE_SETUP: replace_push_subscription is absent - sql/migrations/2026-10-20-push-followups.sql is not applied';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'shift_reminders_push' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: notification_preferences.shift_reminders_push is absent - sql/migrations/2026-10-20-push-followups.sql is partly applied';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-pushz-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, u3]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, u3)) <> 3 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's9pushz', role = 'surgeon', display_name = 'probe pushz surgeon' where id = u1;
  update public.user_profiles set display_name = 'probe pushz viewer two' where id = u2;
  update public.user_profiles set display_name = 'probe pushz viewer three' where id = u3;
  base := 'https://fcm.googleapis.com/fcm/send/probe-pushz-' || tag || '-';
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('u3', u3::text), ('ev', 'https://fcm.googleapis.com/fcm/send/probe-pushz-vector'),
    ('k1', 'B' || repeat('A', 86)), ('a1', repeat('A', 22)), ('k3', 'B' || repeat('D', 86));
  insert into probe_ctx select 'e' || g, base || g from generate_series(1, 21) g;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ---------- helpers (pg_temp; act() switches the acting role inside a case - its SET LOCAL is undone by the case's rollback on error)
create or replace function pg_temp.act(p_key text) returns void language plpgsql as $$
declare uid text;
begin
  if p_key = 'postgres' then
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    return;
  end if;
  if p_key = 'anon' then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
    return;
  end if;
  select c.v into uid from probe_ctx c where c.k = p_key;
  if uid is null then raise exception 'PROBE_SETUP: no probe user %', p_key; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.v(p_key text) returns text language sql as $$
  select c.v from probe_ctx c where c.k = p_key;
$$;
create or replace function pg_temp.h(p_key text) returns text language sql as $$
  select left(encode(sha256(convert_to((select c.v from probe_ctx c where c.k = p_key), 'UTF8')), 'hex'), 16);
$$;
create or replace function pg_temp.ans(r jsonb) returns text language sql as $$
  select case when r ->> 'ok' = 'true' then 'ok action=' || coalesce(r ->> 'action', 'null') || ' devices=' || coalesce(r ->> 'devices', 'null')
                                            || ' audit=' || coalesce(r ->> 'audit', 'null') || coalesce(' replaced=' || (r ->> 'replaced'), '')
              else 'NOT OK ' || coalesce(r::text, 'null') end;
$$;
-- readbacks, called AS POSTGRES: who holds each endpoint ('e1,e2' -> 'e1=U1 e2=none') and how many rows each account holds ('u1,u3')
create or replace function pg_temp.who(p_id uuid) returns text language sql as $$
  select case p_id::text when (select c.v from probe_ctx c where c.k = 'u1') then 'U1' when (select c.v from probe_ctx c where c.k = 'u2') then 'U2'
                         when (select c.v from probe_ctx c where c.k = 'u3') then 'U3' else 'other' end;
$$;
create or replace function pg_temp.held(p_keys text) returns text language sql as $$
  select string_agg(x.k || '=' || coalesce((select pg_temp.who(s.profile_id) from public.push_subscriptions s where s.endpoint = pg_temp.v(x.k)), 'none'), ' ' order by x.n)
    from unnest(string_to_array(p_keys, ',')) with ordinality as x(k, n);
$$;
create or replace function pg_temp.nrows(p_keys text) returns text language sql as $$
  select string_agg(x.k || '=' || (select count(*) from public.push_subscriptions s where s.profile_id = pg_temp.v(x.k)::uuid), ' ' order by x.n)
    from unnest(string_to_array(p_keys, ',')) with ordinality as x(k, n);
$$;

-- ---------- P1-P3: as postgres - the objects as the migration leaves them
do $$ declare res text; f regprocedure := to_regprocedure('public.replace_push_subscription(text, text, text, text, text)'); begin
  begin
    select 'replace=' || case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end
        || ' path=' || case when 'search_path=public, pg_temp' = any(p.proconfig) then 'yes' else 'no' end
        || ' args=' || pg_get_function_arguments(p.oid) || ' result=' || pg_get_function_result(p.oid)
        || ' public_exec=' || case when has_function_privilege('public', p.oid, 'execute') then 't' else 'f' end
        || ' anon_exec=' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
        || ' auth_exec=' || case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end
      into res from pg_proc p where p.oid = f;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('P1', res);
end $$;
do $$ declare res text; f regprocedure := to_regprocedure('public.save_push_subscription(text, text, text, text)'); begin
  begin
    select 'save=' || case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end
        || ' args=' || pg_get_function_arguments(p.oid)
        || ' anon_exec=' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
        || ' auth_exec=' || case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end
      into res from pg_proc p where p.oid = f;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('P2', res);
end $$;
do $$ declare res text; begin
  begin
    select 'shift_reminders_push=' || coalesce((select format_type(a.atttypid, a.atttypmod) || '/' || case when a.attnotnull then 'not_null' else 'nullable' end || '/'
                                                       || coalesce((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum), 'none')
                                                  from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'shift_reminders_push' and not a.attisdropped), 'none')
        || ' comment=' || case when col_description('public.notification_preferences'::regclass,
                                                     (select a.attnum from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass and a.attname = 'shift_reminders_push' and not a.attisdropped)::int) like 'Revision z: %' then 'yes' else 'no' end
      into res;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('P3', res);
end $$;

-- ---------- H1, R1-R7: as the SURGEON U1 (linked s9pushz) - his own devices
do $$ declare r jsonb; res text; begin
  begin
    perform pg_temp.act('u1');
    r := public.save_push_subscription(pg_temp.v('ev'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone');
    r := public.replace_push_subscription(pg_temp.v('e1'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone', '30f005d396c75892');
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r) || ' ' || pg_temp.held('ev,e1');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('H1', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e1'); begin
  begin
    perform pg_temp.act('u1');
    r := public.replace_push_subscription(pg_temp.v('e2'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R1', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e1,e2') || ' ' || pg_temp.nrows('u1');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R1s', res);
end $$;
do $$ declare res text; u text := pg_temp.v('u1'); begin
  begin
    select 'save=' || count(*) filter (where l.action = 'push.save') || ' delete=' || count(*) filter (where l.action = 'push.delete')
        || ' sums=' || coalesce(string_agg(distinct l.detail ->> 'summary', ' | '), 'none')
        || ' batch_rows=' || (select count(*) from public.audit_log b where b.created_at = now())
      into res from public.audit_log l where l.action like 'push.%' and l.detail ->> 'profile_id' = u;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R1a', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e1'); begin
  begin
    perform pg_temp.act('u1');
    r := public.replace_push_subscription(pg_temp.v('e2'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone', hx);
    perform pg_temp.act('postgres');
    res := 'keys=' || (select string_agg(j, ',' order by j collate "C") from jsonb_object_keys(r) j) || ' action=' || coalesce(r ->> 'action', 'null') || ' replaced=' || coalesce(r ->> 'replaced', 'null');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('K1', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e2'); begin
  begin
    perform pg_temp.act('u1');
    r := public.replace_push_subscription(pg_temp.v('e2'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r) || ' ' || pg_temp.held('e2');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R2', res);
end $$;
do $$ declare r jsonb; res text; begin
  begin
    perform pg_temp.act('u1');
    r := public.save_push_subscription(pg_temp.v('e3'), pg_temp.v('k1'), pg_temp.v('a1'), 'Pixel');
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R3', res);
end $$;
-- R4-R7: malformed / null hashes - a 17- and a 15-character hash of U1's E3, null, the empty string
do $$ declare r jsonb; res text; k text; hx text; begin
  foreach k in array array['R4', 'R5', 'R6', 'R7'] loop
    hx := case k when 'R4' then pg_temp.h('e3') || 'a' when 'R5' then left(pg_temp.h('e3'), 15) when 'R6' then null else '' end;
    begin
      perform pg_temp.act('u1');
      r := public.replace_push_subscription(pg_temp.v('e2'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPhone', hx);
      perform pg_temp.act('postgres');
      res := pg_temp.ans(r) || ' ' || pg_temp.held('e3');
    exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
    end;
    insert into probe_results values (k, res);
  end loop;
end $$;

-- ---------- O1-O2: another account's row (U2); M1-M2a: the move between accounts, as save makes it
do $$ declare r jsonb; res text; begin
  begin
    perform pg_temp.act('u2');
    r := public.save_push_subscription(pg_temp.v('e5'), pg_temp.v('k1'), pg_temp.v('a1'), 'Chrome');
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('O1', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e5'); begin
  begin
    perform pg_temp.act('u1');
    r := public.replace_push_subscription(pg_temp.v('e6'), pg_temp.v('k1'), pg_temp.v('a1'), 'iPad', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r) || ' ' || pg_temp.held('e5');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('O2', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e5'); begin
  begin
    perform pg_temp.act('u2');
    r := public.replace_push_subscription(pg_temp.v('e6'), pg_temp.v('k3'), pg_temp.v('a1'), 'Chrome', hx);
    perform pg_temp.act('postgres');
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M1', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e5,e6') || ' ' || pg_temp.nrows('u2');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M1s', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e5'); begin
  begin
    perform pg_temp.act('u2');
    r := public.replace_push_subscription(pg_temp.v('e6'), pg_temp.v('k1'), pg_temp.v('a1'), 'Chrome', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M2', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e5,e6') || ' ' || pg_temp.nrows('u1,u2');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M2s', res);
end $$;
do $$ declare res text; u text := pg_temp.v('u2'); begin
  begin
    select 'sum=' || coalesce((select l.detail ->> 'summary' from public.audit_log l where l.action = 'push.save' and l.detail ->> 'profile_id' = u and l.detail ->> 'action' = 'moved' limit 1), 'none')
        || ' delete=' || (select count(*) from public.audit_log l where l.action = 'push.delete' and l.detail ->> 'profile_id' = u)
      into res;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M2a', res);
end $$;

-- ---------- B1-B4: a refusal of the save after the delete rolls the delete back (U1's E3, by its hash)
do $$ declare r jsonb; res text; k text; hx text := pg_temp.h('e3'); begin
  foreach k in array array['B1', 'B2', 'B3'] loop
    begin
      perform pg_temp.act('u1');
      if k = 'B1' then
        r := public.replace_push_subscription('https://evil.example/push/x', pg_temp.v('k1'), pg_temp.v('a1'), null, hx);
      elsif k = 'B2' then
        r := public.replace_push_subscription(pg_temp.v('e7'), 'abc', pg_temp.v('a1'), null, hx);
      else
        r := public.replace_push_subscription(pg_temp.v('e7'), pg_temp.v('k1'), pg_temp.v('a1'), '<b>x</b>', hx);
      end if;
      perform pg_temp.act('postgres');
      res := 'replaced (NO refusal) ' || pg_temp.ans(r);
    exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
    end;
    insert into probe_results values (k, res);
  end loop;
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e3,e7') || ' ' || pg_temp.nrows('u1');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('B4', res);
end $$;

-- ---------- C1-C6s: the 10-device cap (U3, a clean slate) - counted after the delete
do $$ declare r jsonb; res text; i int; begin
  begin
    perform pg_temp.act('u3');
    for i in 10..19 loop
      r := public.save_push_subscription(pg_temp.v('e' || i), pg_temp.v('k1'), pg_temp.v('a1'), 'Pixel');
    end loop;
    perform pg_temp.act('postgres');
    res := 'ok devices=' || coalesce(r ->> 'devices', 'null');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C1', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e10'); begin
  begin
    perform pg_temp.act('u3');
    r := public.replace_push_subscription(pg_temp.v('e20'), pg_temp.v('k1'), pg_temp.v('a1'), 'Pixel', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C2', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e10,e20') || ' ' || pg_temp.nrows('u3');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C2s', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e2'); begin
  begin
    perform pg_temp.act('u3');
    r := public.replace_push_subscription(pg_temp.v('e21'), pg_temp.v('k1'), pg_temp.v('a1'), 'Pixel', hx);
    perform pg_temp.act('postgres');
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C3', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e2,e21') || ' ' || pg_temp.nrows('u3');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C3s', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e11'); begin
  begin
    perform pg_temp.act('u3');
    r := public.replace_push_subscription(pg_temp.v('e2'), pg_temp.v('k1'), pg_temp.v('a1'), 'Pixel', hx);
    perform pg_temp.act('postgres');
    res := pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C4', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e2,e11') || ' ' || pg_temp.nrows('u1,u3');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C4s', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e1'); begin
  begin
    perform pg_temp.act('u3');
    r := public.replace_push_subscription(pg_temp.v('e3'), pg_temp.v('k1'), pg_temp.v('a1'), null, hx);
    perform pg_temp.act('postgres');
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C5', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e3') || ' ' || pg_temp.nrows('u3');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C5s', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e12'); begin
  begin
    perform pg_temp.act('u3');
    r := public.replace_push_subscription(pg_temp.v('e3'), pg_temp.v('k3'), pg_temp.v('a1'), null, hx);
    perform pg_temp.act('postgres');
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C6', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e3,e12') || ' ' || pg_temp.nrows('u3');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C6s', res);
end $$;

-- ---------- N1: as ANON (no EXECUTE); N2: as postgres with NO signed-in user; N3 the readback
do $$ declare r jsonb; res text; hx text := pg_temp.h('e3'); begin
  begin
    perform pg_temp.act('anon');
    r := public.replace_push_subscription(pg_temp.v('e21'), pg_temp.v('k1'), pg_temp.v('a1'), null, hx);
    perform pg_temp.act('postgres');
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N1', res);
end $$;
do $$ declare r jsonb; res text; hx text := pg_temp.h('e3'); begin
  begin
    perform pg_temp.act('postgres');
    r := public.replace_push_subscription(pg_temp.v('e21'), pg_temp.v('k1'), pg_temp.v('a1'), null, hx);
    res := 'replaced (NO refusal) ' || pg_temp.ans(r);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N2', res);
end $$;
do $$ declare res text; begin
  begin
    res := pg_temp.held('e3,e21');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N3', res);
end $$;

-- ---------- F1-F7: the new column through prefs_own (U1 his roster row, U2 her follower row), and anon
do $$ declare res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.notification_preferences (person_id) values ('s9pushz');
    select 'shift_reminders_push=' || p.shift_reminders_push || ' shift_reminders_email=' || p.shift_reminders_email
        || ' trade_updates_push=' || p.trade_updates_push || ' schedule_updates_push=' || p.schedule_updates_push
      into res from public.notification_preferences p where p.person_id = 's9pushz';
    perform pg_temp.act('postgres');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F1', coalesce(res, 'row=none'));
end $$;
do $$ declare res text; n int; begin
  begin
    perform pg_temp.act('u1');
    update public.notification_preferences set shift_reminders_push = false where person_id = 's9pushz';
    get diagnostics n = row_count;
    perform pg_temp.act('postgres');
    select 'updated=' || n || ' shift_reminders_push=' || p.shift_reminders_push || ' shift_reminders_email=' || p.shift_reminders_email
      into res from public.notification_preferences p where p.person_id = 's9pushz';
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F2', coalesce(res, 'row=none'));
end $$;
do $$ declare res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.notification_preferences (person_id, shift_reminders_email) values ('s9pushz', false)
      on conflict (person_id) do update set shift_reminders_email = excluded.shift_reminders_email;
    perform pg_temp.act('postgres');
    select 'shift_reminders_push=' || p.shift_reminders_push || ' shift_reminders_email=' || p.shift_reminders_email
      into res from public.notification_preferences p where p.person_id = 's9pushz';
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F3', coalesce(res, 'row=none'));
end $$;
do $$ declare res text; u text := pg_temp.v('u2'); begin
  begin
    perform pg_temp.act('u2');
    insert into public.notification_preferences (profile_id) values (u::uuid);
    perform pg_temp.act('postgres');
    select 'ok shift_reminders_push=' || p.shift_reminders_push into res from public.notification_preferences p where p.profile_id = u::uuid;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F4', coalesce(res, 'row=none'));
end $$;
do $$ declare res text; n int; u text := pg_temp.v('u2'); begin
  begin
    perform pg_temp.act('u2');
    update public.notification_preferences set shift_reminders_push = false where profile_id = u::uuid;
    get diagnostics n = row_count;
    perform pg_temp.act('postgres');
    select 'updated=' || n || ' shift_reminders_push=' || p.shift_reminders_push into res from public.notification_preferences p where p.profile_id = u::uuid;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F5', coalesce(res, 'row=none'));
end $$;
do $$ declare res text; n int; begin
  begin
    perform pg_temp.act('u2');
    update public.notification_preferences set shift_reminders_push = true where person_id = 's9pushz';
    get diagnostics n = row_count;
    perform pg_temp.act('postgres');
    res := 'updated=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F6', res);
end $$;
do $$ declare res text; n bigint; begin
  begin
    perform pg_temp.act('anon');
    select count(*) into n from public.notification_preferences p where p.shift_reminders_push or not p.shift_reminders_push;
    perform pg_temp.act('postgres');
    res := 'rows=' || n;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('F7', res);
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$
declare msg text;
begin
  -- values are flattened so the message survives the CLI's JSON/error wrapping: no quotes, semicolons, backslashes or newlines;
  -- ';END' terminates the message so a reader can cut off whatever the CLI appends after it
  select string_agg(r.k || '=' || translate(r.v, '";\' || chr(13) || chr(10), '     '), ';' order by r.k) into msg from probe_results r;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
