-- ============================================================================
-- Silvis Call Schedule - claim_open_slot PROBE (Prompt 13 part 2). Proves the self-claim
-- function on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as sql/probes/trade-guards-probe.sql: run the whole file as ONE batch. With
-- --linked the Supabase CLI submits it as one multi-statement request through the Management
-- API, which runs it in a single implicit transaction (observed 2026-09-22: a batch ending in
-- RAISE persists nothing); there is no BEGIN/COMMIT here on purpose. Every case records its
-- observation in a temp table, and the LAST statement raises an exception whose message
-- carries the collected results ('PROBE_RESULTS A=...;B=...;END' - the ';END' sentinel marks
-- where the message stops and the CLI's own suffix begins), so the transaction - fixtures,
-- throwaway auth users, schedule rows, time_off rows, the audit and feed rows the function
-- writes - rolls back. After every run, verify-rls.sh section 7 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/claim-open-slot-probe.sql
--   (scripts/verify-rls.sh section 7 runs it, grades each case and checks nothing persisted)
--
-- Fixtures live in 2030-04 (no real schedule there; the trade probe uses 2030-03) plus ONE row
-- on 2020-01-01 that becomes the lower bound of the "published range" (min(day)..max(day) of
-- schedule_days) so case E can show that CLAIM_PAST fires before the range check. Live roster
-- ids used: s2 (holds a fixture slot), s3 (the claimer - its roster name is what the feed title
-- shows), s4 (the scheduler's direct edit). The acting users are throwaway auth.users rows
-- created here (email probe-claim-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates; they are then linked to person_id s3 (surgeon) and
-- s1 (scheduler). Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub =
-- that uuid (auth.uid() reads request.jwt.claims -> sub, exactly what PostgREST sets); case A
-- acts as role anon with no sub. Errors are recorded as 'ERR <SQLSTATE> <message>'.
--
-- Fixture days (all source 'probe-claim', version 1 unless stated)
--   2020-01-01  open / open                 lower bound of the range (E)
--   2030-04-03  open / backup = s2          C (held)          L (scheduler edits primary directly)
--   2030-04-05  open / open, backup LOCKED  D (locked)
--   2030-04-07  open / open                 A (anon), B (the clean claim)
--   2030-04-09  NO ROW                      K (inside the range, row created with source 'claim')
--   2030-04-11  external_cover set / open   F (external-covered primary)
--   2030-04-13  primary = s3 / open         G (other role same day)
--   2030-04-15  open / open                 H (s3 vacation 4/15)
--   2030-04-17  open / open                 I (s3 vacation starts 4/18: primary refused), I2 (backup allowed)
--   time_off: s3 2030-04-15..15 and 2030-04-18..18, note 'probe-claim'
--
-- Cases and expectations AFTER the migration (BEFORE it, the function does not exist, so every
-- case but L reads 'ERR 42883 function public.claim_open_slot(date, unknown) does not exist')
--   A  anon (role anon, no jwt sub) claims 4/7 backup   -> A=ERR 42501 permission denied for function claim_open_slot
--   B  linked surgeon (s3) claims 4/7 backup (open, unlocked, inside the range)
--                                                        -> B=ok version=2 backup=s3 source=claim audit=1 notif=Acton took 4/7 backup
--   C  4/3 backup already held by s2                     -> C=ERR CL005 CLAIM_HELD: 2030-04-03 backup is already held by s2
--   D  4/5 backup locked                                 -> D=ERR CL007 CLAIM_LOCKED: 2030-04-05 backup is locked  ask the scheduler to assign it
--   E  2020-01-01 (a row exists, so it is inside the range) -> E=ERR CL003 CLAIM_PAST: 2020-01-01 is before today (...) in Central time  past days are not open
--   F  4/11 primary while external_cover is set          -> F=ERR CL006 CLAIM_EXTERNAL: 2030-04-11 primary is covered by probe-locum (outside the roster)
--   G  4/13 backup while s3 already holds primary        -> G=ERR CL008 CLAIM_OTHER_ROLE: you already hold primary on 2030-04-13
--   H  4/15 backup over s3's vacation                    -> H=ERR CL009 CLAIM_VACATION: your vacation 4/15-4/15 conflicts with 2030-04-15 backup (...)
--   I  4/17 PRIMARY the day before s3's vacation         -> I=ERR CL009 CLAIM_VACATION: your vacation 4/18-4/18 conflicts with 2030-04-17 primary (...)
--   I2 4/17 BACKUP the day before s3's vacation          -> I2=ok version=2 backup=s3
--   J  4/25 (after max(day) = 4/17) backup               -> J=ERR CL004 CLAIM_OUTSIDE_RANGE: 2030-04-25 is outside the published schedule (2020-01-01 to 2030-04-17)
--   K  4/9 (inside the range, NO row) backup             -> K=ok version=2 backup=s3 source=claim
--   L  the scheduler updates 4/3 primary directly (day-editor path, RLS write policy) -> L=ok rows=1 primary=s4
--   B2 observation right after B (2026-09-24, Prompt 16 B6, sql/migrations/2026-09-24-definer-locks.sql): does this
--      backend hold a granted ShareLock on public.time_off in pg_locks? claim_open_slot takes `lock table ... in share
--      mode` before the day row and CL009; B's inner block committed, so the relation lock stays until the batch's
--      transaction ends (first-class in pg_locks, unlike a row lock). A single batch cannot show a second session
--      waiting; the wait itself is PostgreSQL's lock-conflict rule (a time_off writer's ROW EXCLUSIVE vs SHARE).
--        BEFORE that migration: B2=share_locks=0        AFTER: B2=share_locks=1
-- (';' and quotes are flattened out of the values before the raise, hence the two spaces in D and E.)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed; schedule_days has no triggers, time_off's trigger passes)
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
            'probe-claim-' || u::text || '@example.test', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', false);
  end loop;
  update public.user_profiles set person_id = 's3', role = 'surgeon'   where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'scheduler' where id = sched;
  if (select count(*) from public.user_profiles where id in (surgeon, sched)) <> 2 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('sched', sched::text);

  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, external_cover, source, version)
  values ('2020-01-01', null, null, false, false, null,          'probe-claim', 1),   -- E: lower bound of the range, in the past
         ('2030-04-03', null, 's2',  false, false, null,          'probe-claim', 1),   -- C: backup held; L: scheduler edits primary
         ('2030-04-05', null, null,  false, true,  null,          'probe-claim', 1),   -- D: backup locked
         ('2030-04-07', null, null,  false, false, null,          'probe-claim', 1),   -- A (anon) / B (clean claim)
         ('2030-04-11', null, null,  false, false, 'probe-locum', 'probe-claim', 1),   -- F: primary externally covered
         ('2030-04-13', 's3', null,  false, false, null,          'probe-claim', 1),   -- G: s3 already primary
         ('2030-04-15', null, null,  false, false, null,          'probe-claim', 1),   -- H: s3 on vacation
         ('2030-04-17', null, null,  false, false, null,          'probe-claim', 1)    -- I / I2: s3 vacation starts the next day; max(day)
  on conflict (day) do update set primary_id = excluded.primary_id, backup_id = excluded.backup_id,
    primary_locked = excluded.primary_locked, backup_locked = excluded.backup_locked,
    external_cover = excluded.external_cover, source = excluded.source, version = excluded.version;
  -- 2030-04-09 deliberately has NO row (K).
  delete from public.schedule_days where day = '2030-04-09';
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s3', '2030-04-15', '2030-04-15', 'probe-claim', 'probe-claim'),
         ('s3', '2030-04-18', '2030-04-18', 'probe-claim', 'probe-claim');
  if (select max(day) from public.schedule_days) <> '2030-04-17' then
    raise exception 'PROBE_SETUP: max(day) is not 2030-04-17 (a real row lies beyond the fixtures; case J would not test the range)';
  end if;
end $$;

-- ---------- A: anon (no jwt sub, role anon) - execute is revoked from anon
do $$
declare v text;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform public.claim_open_slot('2030-04-07'::date, 'backup');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    v := 'ok (anon was allowed to call the function)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;   -- the subtransaction rollback already restored the postgres role
  end;
  insert into probe_results values ('A', v);
end $$;

-- ---------- B: linked surgeon claims an open, unlocked backup inside the range
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; b text; src text; na int; title text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-07'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select backup_id, source into b, src from public.schedule_days where day = '2030-04-07';
    select count(*) into na from public.audit_log where action = 'schedule.claim' and detail ->> 'day' = '2030-04-07';
    select n.title into title from public.notifications n where n.type = 'shift_claimed' and n.data ->> 'day' = '2030-04-07' order by n.created_at desc limit 1;
    v := 'ok version=' || coalesce(res ->> 'version', 'null') || ' backup=' || coalesce(b, 'null')
         || ' source=' || coalesce(src, 'null') || ' audit=' || na::text || ' notif=' || coalesce(title, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('B', v);
end $$;

-- ---------- B2: the lock B took and still holds - a granted ShareLock on public.time_off in pg_locks for this backend
-- (B's inner block committed, so the relation lock stays until the batch's transaction ends)
do $$
declare n int; v text;
begin
  begin
    select count(*) into n
      from pg_locks
     where locktype = 'relation' and relation = 'public.time_off'::regclass
       and pid = pg_backend_pid() and mode = 'ShareLock' and granted;
    v := 'share_locks=' || n::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('B2', v);
end $$;

-- ---------- C: slot already held
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-03'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('C', v);
end $$;

-- ---------- D: slot locked
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-05'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('D', v);
end $$;

-- ---------- E: a past day (inside the range - the 2020-01-01 row is the lower bound); PAST is checked before RANGE
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2020-01-01'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('E', v);
end $$;

-- ---------- F: primary requested while external_cover is set
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-11'::date, 'primary') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('F', v);
end $$;

-- ---------- G: the caller already holds the other role that day
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-13'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('G', v);
end $$;

-- ---------- H: vacation on the day
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-15'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('H', v);
end $$;

-- ---------- I: vacation starts the NEXT day - a PRIMARY claim is refused (trailing edge) ...
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-17'::date, 'primary') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('I', v);
end $$;

-- ---------- I2: ... while the same BACKUP claim succeeds
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; b text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-17'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select backup_id into b from public.schedule_days where day = '2030-04-17';
    v := 'ok version=' || coalesce(res ->> 'version', 'null') || ' backup=' || coalesce(b, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('I2', v);
end $$;

-- ---------- J: outside the published range (after max(day))
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-25'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok version=' || coalesce(res ->> 'version', 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('J', v);
end $$;

-- ---------- K: a day inside the range with NO row gets one (source 'claim') and the claim succeeds
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; b text; src text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_slot('2030-04-09'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select backup_id, source into b, src from public.schedule_days where day = '2030-04-09';
    v := 'ok version=' || coalesce(res ->> 'version', 'null') || ' backup=' || coalesce(b, 'null') || ' source=' || coalesce(src, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('K', v);
end $$;

-- ---------- L: the scheduler's day-editor path is untouched (direct UPDATE under the RLS write policy)
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  n int; p text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.schedule_days set primary_id = 's4', source = 'manual', version = version + 1, updated_by = 's1', updated_at = now()
     where day = '2030-04-03';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select primary_id into p from public.schedule_days where day = '2030-04-03';
    v := 'ok rows=' || n::text || ' primary=' || coalesce(p, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('L', v);
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
