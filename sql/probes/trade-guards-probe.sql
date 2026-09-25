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
-- 2026-09-23 (audit RLS-6, sql/migrations/2026-09-23-trade-past-guard.sql) - past days, fixtures in 2020-02
-- (the claim probe owns 2020-01-01). "today" is America/Chicago at run time, so the graders match the
-- TRADE_PAST token + the day rather than the whole sentence.
--   I  accepted trade on 2020-02-03 (past); s2 (not a scheduler) applies
--        BEFORE: applies, history rewritten          -> I=status=applied
--        AFTER : refused                            -> I=ERR TRADE_PAST: 2020-02-03 is before today (<today>) in Central time  past days are changed by the scheduler only
--   J  accepted trade on 2020-02-05 (past); the SCHEDULER applies
--        BEFORE and AFTER: applies (past days are the scheduler's to change) -> J=status=applied 02-05p=s2
--   K  PENDING trade on 2020-02-03 (past); s2, the counter-party, sets status 'accepted'
--        BEFORE: accepted                           -> K=status=accepted
--        AFTER : refused by trade_update_guard      -> K=ERR TRADE_PAST: 2020-02-03 is before today (<today>) ...
--   L  the same pending trade; the SCHEDULER sets status 'accepted'
--        BEFORE and AFTER: accepted                 -> L=status=accepted
--   M  PENDING trade on 2020-02-05 (past); s2 declines it
--        BEFORE and AFTER: declined (only ACCEPT is gated) -> M=status=declined
-- 2026-09-24 (Prompt 16 B6, sql/migrations/2026-09-24-definer-locks.sql) - the time_off table lock and the roster names.
--   E2 observation right after E (the first case whose inner block COMMITS - a refused case like B rolls its
--      subtransaction back, and a relation lock taken inside it is released with it): does this backend hold a granted
--      ShareLock on public.time_off in pg_locks? `lock table ... in share mode` is a relation lock, first-class in
--      pg_locks, held until the batch's transaction ends. A single batch cannot show a second session waiting; the
--      wait itself is PostgreSQL's lock-conflict rule (a time_off writer's ROW EXCLUSIVE vs SHARE), and the statement's
--      position (before the day-row locks and the vacation check) is pinned by test/schema.test.js.
--        BEFORE: no table lock                          -> E2=share_locks=0
--        AFTER : SHARE held since E                     -> E2=share_locks=1
--   N  surgeon (s2) inserts a trade naming s3, with from_surgeon_name 'Mallory' and to_surgeon_name 'Eve'
--        BEFORE: the client's strings are stored        -> N=from_name=Mallory to_name=Eve
--        AFTER : the roster's names by id               -> N=from_name=Burchett to_name=Acton
-- 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql) - the audit row apply_trade writes.
--   E3 observation right after E2: the trade.apply audit row E produced (read as postgres by detail ->> 'trade_id'), its
--      actor_name and detail ->> 'summary'. E is a TWO-WAY trade applied by the surgeon (s2, Burchett - the probe gives him no
--      display_name, so the roster fallback is what shows). The report flattens ';' to a space, hence the two spaces below.
--        BEFORE: no actor, no summary                    -> E3=actor=null summary=null
--        AFTER : roster name + the two-way sentence     -> E3=actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)
--   F2 observation right after F: the audit row F produced. F is a ONE-WAY trade applied by the SCHEDULER, whose profile row the
--      fixture gives display_name 'Probe Scheduler' - the display_name branch of the actor lookup.
--        BEFORE: no actor, no summary                    -> F2=actor=null summary=null
--        AFTER : display_name + the one-way sentence    -> F2=actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)
-- 2026-09-24 (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql) - shift_trade_requests.kind 'trade' | 'give'.
-- A member 'trade' will need a return leg once the prepared follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql is
-- applied, so the member inserts of A, G, H and N already send one (return 2030-03-04 backup) and keep testing what they tested
-- before and after both files (their expectations are unchanged). Split 2026-09-24: the member return-leg refusal is NOT in the
-- give-kind file (old installed builds send unit-tail rows without a return leg), so Q / Q3 read the SAME before and after the
-- give-kind apply (stored) and verify-rls.sh grades them so; their refused value is the follow-up's acceptance case, listed
-- below as "AFTER the follow-up" and graded only from that file's record step on. The give fixtures (days 2030-03-25 / 03-27, trade ids
-- ...030-...034) sit in their own block: before the migration it fails on the missing column and says so (GIVE_SETUP), the
-- other cases still run. A missing column reads 'ERR column  kind  ... does not exist' (the report flattens the quotes).
--   GIVE_SETUP the give fixtures (as postgres)
--        BEFORE: ERR column  kind  of relation  shift_trade_requests  does not exist   AFTER: GIVE_SETUP=ok
--   O  surgeon (s2) gives his own day (2030-03-27 primary) to s3 - kind 'give', NO return day / role
--        BEFORE: ERR ... kind ... does not exist        AFTER: O=status=pending from=s2 kind=give return=null
--   P  surgeon (s2) gives a day he does NOT hold (2030-03-03 primary, held by s3), naming s3 as from_surgeon_id, to s4:
--      the guard does not refuse it at insert - it forces from to the caller, as for every member row (case H) - so it lands
--      as HIS give of a day he does not hold, and apply_trade refuses that (P2)
--        BEFORE: ERR ... kind ... does not exist        AFTER: P=status=pending from=s2 kind=give
--   P2 surgeon (s2) applies an ACCEPTED give from s2 (fixture ...030) of 2030-03-03 primary, which s3 holds
--        BEFORE: TRADE_NOT_FOUND (no fixture)           AFTER: P2=ERR TRADE_STALE: 2030-03-03 primary is no longer held by s2
--   Q  surgeon (s2) inserts a 'trade' (kind omitted = the default) with NO return leg
--        BEFORE and AFTER the give-kind apply: stored   -> Q=status=pending return=null   (only the client refuses it)
--        AFTER the follow-up (2026-09-25-member-trade-return-leg.sql): refused -> Q=ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead
--   Q2 surgeon (s2) inserts a 'give' WITH a return leg
--        BEFORE: ERR ... kind ... does not exist        AFTER: Q2=ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift
--   Q3 surgeon (s2) inserts a 'trade' with a HALF return leg (return day 2030-03-04, no return role) - both are required
--        BEFORE and AFTER the give-kind apply: stored   -> Q3=status=pending return=2030-03-04 return_role=null
--        AFTER the follow-up (2026-09-25-member-trade-return-leg.sql): refused -> Q3=ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead
--   Q4 surgeon (s2) inserts a 'give' carrying only a return ROLE (no return day)
--        BEFORE: ERR ... kind ... does not exist        AFTER: Q4=ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift
--   R  surgeon (s2) sets kind 'trade' on his OWN pending give (fixture ...031)
--        BEFORE: ERR ... kind ... does not exist        AFTER: R=ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade
--   S  surgeon (s2) sets kind 'give' on a pending trade between s3 and s4 (fixture ...032) - he is no party: policy
--      trade_update filters the row out, nothing changes
--        BEFORE: ERR ... kind ... does not exist        AFTER: S=rows=0 kind=trade
--   S2 surgeon (s2) sets kind 'trade' on a pending give from s3 TO HIM (fixture ...033) - a party, but not the scheduler
--        BEFORE: ERR ... kind ... does not exist        AFTER: S2=ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade
--   S3 the RECEIVER (s2) accepts the pending give from s3 (fixture ...033; S2 left it pending) - the accept transition through
--      the changed trade_update_guard (T's fixture is inserted already accepted, so T alone does not prove it)
--        BEFORE: rows=0 status=null (no fixture)        AFTER: S3=rows=1 status=accepted
--   T  the RECEIVER (s2) applies an ACCEPTED give from s3 (fixture ...034) of 2030-03-25 primary - apply_trade is unchanged
--        BEFORE: TRADE_NOT_FOUND (no fixture)           AFTER: T=status=applied 03-25p=s2
--   T2 observation right after T: the trade.apply audit row T wrote (the 5b one-way form; s2 has no display_name)
--        BEFORE: actor=null summary=null                AFTER: T2=actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 25 (from Acton, one-way)
--   U  the SCHEDULER inserts a one-way 'trade' (kind omitted) - unchanged: allowed
--        BEFORE and AFTER                               -> U=status=pending from=s3 return=null
--   U2 the SCHEDULER inserts a 'give' WITH a return leg - the one-way rule holds for every caller
--        BEFORE: ERR ... kind ... does not exist        AFTER: U2=ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift
--   U3 the SCHEDULER inserts a 'give' with no return - allowed, the same one-way move labelled as a give
--        BEFORE: ERR ... kind ... does not exist        AFTER: U3=status=pending from=s3 kind=give
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
  -- (5b) the scheduler gets a display_name so F2 exercises the display_name branch of apply_trade's actor lookup; the surgeon
  -- keeps none (handle_new_auth_user sets no display_name), so E3 shows the roster fallback
  update public.user_profiles set display_name = 'Probe Scheduler' where id = sched;
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
         ('2030-03-15', 's3', null, true,  false, 'probe', 1),   -- F: locked, scheduler applies
         ('2020-02-03', 's3', null, false, false, 'probe', 1),   -- I / K: past day, surgeon applies / accepts
         ('2020-02-05', 's3', null, false, false, 'probe', 1)    -- J / M: past day, scheduler applies / surgeon declines
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
         ('00000000-0000-4000-8000-00000000000f', 's3', 's2', '2030-03-15', 'primary', null, null, 'accepted', 'probe F'),
         ('00000000-0000-4000-8000-000000000019', 's3', 's2', '2020-02-03', 'primary', null, null, 'accepted', 'probe I'),
         ('00000000-0000-4000-8000-00000000001a', 's3', 's2', '2020-02-05', 'primary', null, null, 'accepted', 'probe J'),
         ('00000000-0000-4000-8000-00000000001b', 's3', 's2', '2020-02-03', 'primary', null, null, 'pending',  'probe K'),
         ('00000000-0000-4000-8000-00000000001d', 's3', 's2', '2020-02-05', 'primary', null, null, 'pending',  'probe M');
  if (select count(*) from public.shift_trade_requests where detail like 'probe %' and status = 'accepted') <> 7 then
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
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, decided_at, detail)
    values ('s2', 's3', '2030-03-03', 'primary', '2030-03-04', 'backup', 'accepted', now(), 'probe A') returning id into tid;
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

-- ---------- E2: the lock E took and still holds - a granted ShareLock on public.time_off in pg_locks for this backend
-- (E's inner block committed, so the relation lock stays until the batch's transaction ends; the one B took was released
-- with B's aborted subtransaction, which is why the observation sits here and not after B)
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
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('E2', v);
end $$;

-- ---------- E3: the audit row E wrote (2026-09-24, follow-up 5b) - actor_name + detail.summary of the two-way trade applied by s2
do $$
declare an text; sm text; v text;
begin
  begin
    select a.actor_name, a.detail ->> 'summary' into an, sm
      from public.audit_log a
     where a.action = 'trade.apply' and a.detail ->> 'trade_id' = '00000000-0000-4000-8000-00000000000e'
     order by a.created_at desc limit 1;
    v := 'actor=' || coalesce(an, 'null') || ' summary=' || coalesce(sm, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('E3', v);
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

-- ---------- F2: the audit row F wrote (2026-09-24, follow-up 5b) - the one-way sentence, actor = the scheduler's display_name
do $$
declare an text; sm text; v text;
begin
  begin
    select a.actor_name, a.detail ->> 'summary' into an, sm
      from public.audit_log a
     where a.action = 'trade.apply' and a.detail ->> 'trade_id' = '00000000-0000-4000-8000-00000000000f'
     order by a.created_at desc limit 1;
    v := 'actor=' || coalesce(an, 'null') || ' summary=' || coalesce(sm, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('F2', v);
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
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('s2', 's2', '2030-03-03', 'primary', '2030-03-04', 'backup', 'pending', 'probe G') returning id into tid;
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
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('s3', 's4', '2030-03-03', 'primary', '2030-03-04', 'backup', 'pending', 'probe H') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, from_surgeon_id into st, fr from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' from=' || fr;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('H', v);
end $$;

-- ---------- I: past day, accepted trade, surgeon applies (TRADE_PAST)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-000000000019');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-000000000019';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('I', v);
end $$;

-- ---------- J: past day, accepted trade, SCHEDULER applies (allowed)
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  st text; p1 text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-00000000001a');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000001a';
    select primary_id into p1 from public.schedule_days where day = '2020-02-05';
    v := 'status=' || st || ' 02-05p=' || coalesce(p1, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('J', v);
end $$;

-- ---------- K: past day, PENDING trade, the counter-party (s2) accepts (TRADE_PAST from trade_update_guard)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.shift_trade_requests set status = 'accepted', decided_at = now() where id = '00000000-0000-4000-8000-00000000001b';
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000001b';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('K', v);
end $$;

-- ---------- L: the same pending past-day trade, the SCHEDULER accepts (allowed)
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.shift_trade_requests set status = 'accepted', decided_at = now() where id = '00000000-0000-4000-8000-00000000001b';
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000001b';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('L', v);
end $$;

-- ---------- M: past day, PENDING trade, the counter-party declines (only ACCEPT is gated)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.shift_trade_requests set status = 'declined', decided_at = now() where id = '00000000-0000-4000-8000-00000000001d';
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-00000000001d';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('M', v);
end $$;

-- ---------- N: surgeon inserts a trade with client-chosen display names (the trigger must write the roster's)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; fr text; tn text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, from_surgeon_name, to_surgeon_id, to_surgeon_name, day, role, return_day, return_role, status, detail)
    values ('s2', 'Mallory', 's3', 'Eve', '2030-03-03', 'primary', '2030-03-04', 'backup', 'pending', 'probe N') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select from_surgeon_name, to_surgeon_name into fr, tn from public.shift_trade_requests where id = tid;
    v := 'from_name=' || coalesce(fr, 'null') || ' to_name=' || coalesce(tn, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('N', v);
end $$;

-- ---------- GIVE_SETUP (2026-09-24, Prompt 19): the give fixtures, as postgres. Their own block: before the migration the kind
-- column is missing, this block rolls back and reports it, and every other case still runs.
do $$
declare v text;
begin
  begin
    insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source, version)
    values ('2030-03-25', 's3', null, false, false, 'probe', 1),   -- S2 / T: s3's primary, given to s2
           ('2030-03-27', 's2', null, false, false, 'probe', 1)    -- O / Q / R / U: s2's own primary
    on conflict (day) do update set primary_id = excluded.primary_id, backup_id = excluded.backup_id,
      primary_locked = excluded.primary_locked, backup_locked = excluded.backup_locked, source = excluded.source;
    insert into public.shift_trade_requests (id, kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('00000000-0000-4000-8000-000000000030', 'give',  's2', 's4', '2030-03-03', 'primary', null, null, 'accepted', 'probe P2'),
           ('00000000-0000-4000-8000-000000000031', 'give',  's2', 's3', '2030-03-27', 'primary', null, null, 'pending',  'probe R'),
           ('00000000-0000-4000-8000-000000000032', 'trade', 's3', 's4', '2030-03-25', 'primary', '2030-03-26', 'backup', 'pending', 'probe S'),
           ('00000000-0000-4000-8000-000000000033', 'give',  's3', 's2', '2030-03-25', 'primary', null, null, 'pending',  'probe S2'),
           ('00000000-0000-4000-8000-000000000034', 'give',  's3', 's2', '2030-03-25', 'primary', null, null, 'accepted', 'probe T');
    v := 'ok';
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('GIVE_SETUP', v);
end $$;

-- ---------- O: surgeon gives his own day - kind 'give', no return day / role
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; fr text; kd text; rd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's2', 's3', '2030-03-27', 'primary', 'pending', 'probe O') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    execute 'select status, from_surgeon_id, kind, return_day::text from public.shift_trade_requests where id = $1' into st, fr, kd, rd using tid;
    v := 'status=' || st || ' from=' || fr || ' kind=' || kd || ' return=' || coalesce(rd, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('O', v);
end $$;

-- ---------- P: surgeon gives a day he does not hold, naming s3 as from - the guard forces from to him (as in H)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; fr text; kd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's3', 's4', '2030-03-03', 'primary', 'pending', 'probe P') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    execute 'select status, from_surgeon_id, kind from public.shift_trade_requests where id = $1' into st, fr, kd using tid;
    v := 'status=' || st || ' from=' || fr || ' kind=' || kd;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('P', v);
end $$;

-- ---------- P2: surgeon applies an accepted give of a day he does not hold - TRADE_STALE
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-000000000030');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-000000000030';
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('P2', v);
end $$;

-- ---------- Q: surgeon inserts a 'trade' (kind omitted) with no return leg
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; rd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('s2', 's3', '2030-03-27', 'primary', 'pending', 'probe Q') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, return_day::text into st, rd from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' return=' || coalesce(rd, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('Q', v);
end $$;

-- ---------- Q2: surgeon inserts a 'give' WITH a return leg
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('give', 's2', 's3', '2030-03-27', 'primary', '2030-03-04', 'backup', 'pending', 'probe Q2') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = tid;
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('Q2', v);
end $$;

-- ---------- Q3: surgeon inserts a 'trade' (kind omitted) with a HALF return leg - a return day but no return role
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; rd text; rr text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, return_day, status, detail)
    values ('s2', 's3', '2030-03-27', 'primary', '2030-03-04', 'pending', 'probe Q3') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, return_day::text, return_role into st, rd, rr from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' return=' || coalesce(rd, 'null') || ' return_role=' || coalesce(rr, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('Q3', v);
end $$;

-- ---------- Q4: surgeon inserts a 'give' carrying only a return ROLE (no return day)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  tid uuid; st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_role, status, detail)
    values ('give', 's2', 's3', '2030-03-27', 'primary', 'backup', 'pending', 'probe Q4') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = tid;
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('Q4', v);
end $$;

-- ---------- R: surgeon changes kind on his OWN pending give
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    execute 'update public.shift_trade_requests set kind = ''trade'' where id = ''00000000-0000-4000-8000-000000000031''';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    v := 'rows=' || n;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('R', v);
end $$;

-- ---------- S: surgeon changes kind on a trade between two other surgeons (no party: RLS filters it out)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; kd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    execute 'update public.shift_trade_requests set kind = ''give'' where id = ''00000000-0000-4000-8000-000000000032''';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    execute 'select kind from public.shift_trade_requests where id = ''00000000-0000-4000-8000-000000000032''' into kd;
    v := 'rows=' || n || ' kind=' || coalesce(kd, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('S', v);
end $$;

-- ---------- S2: surgeon (the RECEIVER - a party) changes kind on another person's pending give
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    execute 'update public.shift_trade_requests set kind = ''trade'' where id = ''00000000-0000-4000-8000-000000000033''';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    v := 'rows=' || n;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('S2', v);
end $$;

-- ---------- S3: the RECEIVER accepts the pending give (...033) - the accept transition through the changed update guard
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    execute 'update public.shift_trade_requests set status = ''accepted'' where id = ''00000000-0000-4000-8000-000000000033''';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    execute 'select status from public.shift_trade_requests where id = ''00000000-0000-4000-8000-000000000033''' into st;
    v := 'rows=' || n || ' status=' || coalesce(st, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('S3', v);
end $$;

-- ---------- T: the RECEIVER applies an accepted give (apply_trade unchanged: a party may apply; return_day null = one-way)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  st text; p1 text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    perform public.apply_trade('00000000-0000-4000-8000-000000000034');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = '00000000-0000-4000-8000-000000000034';
    select primary_id into p1 from public.schedule_days where day = '2030-03-25';
    v := 'status=' || st || ' 03-25p=' || coalesce(p1, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('T', v);
end $$;

-- ---------- T2: the audit row T wrote - the 5b one-way summary, actor = the receiver (roster fallback)
do $$
declare an text; sm text; v text;
begin
  begin
    select a.actor_name, a.detail ->> 'summary' into an, sm
      from public.audit_log a
     where a.action = 'trade.apply' and a.detail ->> 'trade_id' = '00000000-0000-4000-8000-000000000034'
     order by a.created_at desc limit 1;
    v := 'actor=' || coalesce(an, 'null') || ' summary=' || coalesce(sm, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('T2', v);
end $$;

-- ---------- U: the SCHEDULER inserts a one-way 'trade' (kind omitted) - unchanged, allowed
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  tid uuid; st text; fr text; rd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('s3', 's2', '2030-03-27', 'backup', 'pending', 'probe U') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status, from_surgeon_id, return_day::text into st, fr, rd from public.shift_trade_requests where id = tid;
    v := 'status=' || st || ' from=' || fr || ' return=' || coalesce(rd, 'null');
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('U', v);
end $$;

-- ---------- U2: the SCHEDULER inserts a 'give' WITH a return leg - refused for every caller
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  tid uuid; st text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('give', 's3', 's2', '2030-03-27', 'backup', '2030-03-04', 'backup', 'pending', 'probe U2') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    select status into st from public.shift_trade_requests where id = tid;
    v := 'status=' || st;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('U2', v);
end $$;

-- ---------- U3: the SCHEDULER inserts a 'give' with no return - allowed (the same one-way move, labelled as a give)
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  tid uuid; st text; fr text; kd text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's3', 's2', '2030-03-27', 'backup', 'pending', 'probe U3') returning id into tid;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    execute 'select status, from_surgeon_id, kind from public.shift_trade_requests where id = $1' into st, fr, kd using tid;
    v := 'status=' || st || ' from=' || fr || ' kind=' || kd;
  exception when others then
    v := 'ERR ' || sqlerrm;
  end;
  insert into probe_results values ('U3', v);
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
