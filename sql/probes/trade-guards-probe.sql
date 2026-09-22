-- ============================================================================
-- Silvis Call Schedule - trade-guards PROBE (Prompt 12 D). Proves the server-side trade
-- guards on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the
-- file as one multi-statement request through the Management API, which runs it in a single
-- implicit transaction (observed 2026-09-22: a batch ending in RAISE persists nothing); there
-- is no BEGIN/COMMIT here on purpose. Every case records its observation in a temp table, and
-- the LAST statement raises an exception whose message carries the collected results
-- ('PROBE_RESULTS A=...;B=...;END' - the ';END' sentinel marks where the message stops and
-- the CLI's own suffix, e.g. ' (SQLSTATE P0001)', begins), so the transaction - fixtures,
-- throwaway auth users, trades, schedule rows - rolls back. The result is read from the
-- ERROR text. After every run, verify-rls.sh section 5 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/trade-guards-probe.sql
--   (scripts/verify-rls.sh section 5 runs it, grades each case and checks nothing persisted)
--
-- Fixtures live in 2030-03 (no real schedule there) and use the live roster ids s2
-- (Burchett) and s3 (Acton); the acting users are throwaway auth.users rows created here
-- (email probe-<uuid>@example.test) whose user_profiles rows the handle_new_auth_user
-- trigger creates; they are then linked to person_id s2 (surgeon) / s1 (scheduler).
-- Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub = that uuid
-- (auth.uid() reads request.jwt.claims -> sub, exactly what PostgREST sets).
--
-- Cases and expectations
--   A  surgeon (s2) inserts a trade from their own id with status 'accepted' + decided_at = now()
--        BEFORE the fix: stored as given            -> A=status=accepted from=s2 decided=<timestamp>
--        AFTER  the fix: forced pending, undecided  -> A=status=pending from=s2 decided=null
--   B  accepted trade whose receiver (s2) has a time_off row on the day; s2 applies
--        BEFORE: applies (puts s2 on call on vacation) -> B=status=applied
--        AFTER : refused                            -> B=ERR TRADE_INELIGIBLE: Burchett is on vacation on 2030-03-05
--   C  receiver (s2) already holds backup on the day; s2 applies the primary leg
--        BEFORE: fails, but only through the distinct-roles CHECK constraint
--                                                   -> C=ERR ... schedule_days_distinct_roles ...
--        AFTER : refused with a readable reason     -> C=ERR TRADE_INELIGIBLE: Burchett already holds backup on 2030-03-07
--   D  the leg is LOCKED; s2 (not a scheduler) applies
--        BEFORE: applies, lock flag left true       -> D=status=applied locked=true
--        AFTER : refused                            -> D=ERR TRADE_INELIGIBLE: 2030-03-09 primary is locked; ask the scheduler
--   E  control: clean accepted trade with a return leg; s2 applies
--        BEFORE and AFTER: applies                  -> E=status=applied 03-11p=s2 03-13b=s3
--   F  the leg is LOCKED; the SCHEDULER applies
--        BEFORE: applies, lock flag left true       -> F=status=applied locked=true
--        AFTER : applies and clears the lock        -> F=status=applied locked=false
--   G  surgeon inserts a trade from = to
--        BEFORE: stored (pending)                   -> G=status=pending
--        AFTER : refused                            -> G=ERR TRADE_INELIGIBLE: a trade needs two different surgeons
--   H  surgeon (s2) inserts a trade naming s3 as from_surgeon_id
--        BEFORE: RLS refuses it (from <> caller)    -> H=ERR new row violates row-level security policy ...
--        AFTER : from_surgeon_id forced to s2       -> H=status=pending from=s2
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed, no schedule_days triggers)
do $$
declare
  surgeon uuid := gen_random_uuid();
  sched   uuid := gen_random_uuid();
  u       uuid;
begin
  foreach u in array array[surgeon, sched] loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'probe-' || u::text || '@example.test', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', false);
  end loop;
  update public.user_profiles set person_id = 's2', role = 'surgeon'   where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'scheduler' where id = sched;
  if (select count(*) from public.user_profiles where id in (surgeon, sched)) <> 2 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('sched', sched::text);

  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source, version)
  values ('2030-03-03', 's3', null, false, false, 'probe', 1),   -- A / G (never applied)
         ('2030-03-05', 's3', null, false, false, 'probe', 1),   -- B: s2 on vacation
         ('2030-03-07', 's3', 's2', false, false, 'probe', 1),   -- C: s2 already backup
         ('2030-03-09', 's3', null, true,  false, 'probe', 1),   -- D: locked, surgeon applies
         ('2030-03-11', 's3', null, false, false, 'probe', 1),   -- E: control leg 1
         ('2030-03-13', null, 's2', false, false, 'probe', 1),   -- E: control return leg
         ('2030-03-15', 's3', null, true,  false, 'probe', 1)    -- F: locked, scheduler applies
  on conflict (day) do update set primary_id = excluded.primary_id, backup_id = excluded.backup_id,
    primary_locked = excluded.primary_locked, backup_locked = excluded.backup_locked, source = excluded.source;
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s2', '2030-03-05', '2030-03-05', 'probe', 'probe');
  -- accepted trades, inserted by postgres (the insert guard lets server-side roles record them as given)
  insert into public.shift_trade_requests (id, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
  values ('00000000-0000-4000-8000-00000000000b', 's3', 's2', '2030-03-05', 'primary', null, null, 'accepted', 'probe B'),
         ('00000000-0000-4000-8000-00000000000c', 's3', 's2', '2030-03-07', 'primary', null, null, 'accepted', 'probe C'),
         ('00000000-0000-4000-8000-00000000000d', 's3', 's2', '2030-03-09', 'primary', null, null, 'accepted', 'probe D'),
         ('00000000-0000-4000-8000-00000000000e', 's3', 's2', '2030-03-11', 'primary', '2030-03-13', 'backup', 'accepted', 'probe E'),
         ('00000000-0000-4000-8000-00000000000f', 's3', 's2', '2030-03-15', 'primary', null, null, 'accepted', 'probe F');
  if (select count(*) from public.shift_trade_requests where detail like 'probe %' and status = 'accepted') <> 5 then
    raise exception 'PROBE_SETUP: fixture trades were not stored as accepted (was the probe run as postgres?)';
  end if;
end $$;

-- ---------- A: surgeon inserts status 'accepted' (+ decided_at) from their own id
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; fr text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, status, decided_at, detail)
    values ('s2', 's3', '2030-03-03', 'primary', 'accepted', now(), 'probe A') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, from_surgeon_id, ' decided=' || coalesce(decided_at::text, 'null') into st, fr, v
      from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' from=' || fr || v;
  exception when others then
    v := 'ERR ' || sqlerrm;   -- the subtransaction rollback already restored the postgres role
  end;
  insert into probe_results values ('A', v);
end $$;

-- ---------- B: receiver on vacation
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000000b');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000000b';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('B', v);
end $$;

-- ---------- C: receiver already holds the other role
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000000c');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000000c';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('C', v);
end $$;

-- ---------- D: locked slot, non-scheduler applies
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; lk boolean; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000000d');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000000d';
    select primary_locked into lk from public.schedule_days where day = '2030-03-09';
    v := 'status=' || st || ' locked=' || lk::text;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('D', v);
end $$;

-- ---------- E: control - a clean accepted trade with a return leg applies
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; p1 text; b2 text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000000e');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000000e';
    select primary_id into p1 from public.schedule_days where day = '2030-03-11';
    select backup_id  into b2 from public.schedule_days where day = '2030-03-13';
    v := 'status=' || st || ' 03-11p=' || coalesce(p1, 'null') || ' 03-13b=' || coalesce(b2, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('E', v);
end $$;

-- ---------- F: locked slot, SCHEDULER applies (lock must clear)
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  st text; lk boolean; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000000f');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000000f';
    select primary_locked into lk from public.schedule_days where day = '2030-03-15';
    v := 'status=' || st || ' locked=' || lk::text;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('F', v);
end $$;

-- ---------- G: surgeon inserts from = to
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('s2', 's2', '2030-03-03', 'primary', 'pending', 'probe G') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = tid;
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('G', v);
end $$;

-- ---------- H: surgeon inserts naming someone else as from_surgeon_id
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; fr text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('s3', 's4', '2030-03-03', 'primary', 'pending', 'probe H') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, from_surgeon_id into st, fr from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' from=' || fr;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('H', v);
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$
declare r text;
begin
  -- values are flattened so the message survives the CLI's JSON/error wrapping: no quotes, semicolons, backslashes or newlines;
  -- ';END' terminates the message so a reader can cut off whatever the CLI appends after it
  select string_agg(k || '=' || translate(v, '";\' || chr(13) || chr(10), '     '), ';' order by k) into r from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(r, '(no results)');
end $$;
