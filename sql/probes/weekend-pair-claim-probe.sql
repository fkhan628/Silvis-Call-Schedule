-- ============================================================================
-- Silvis Call Schedule - weekend pair claim PROBE (2026-10-01, the 10/1 follow-up 3; sql/migrations/2026-10-01-weekend-pair-claim.sql,
-- REPORT-FIRST, NOT APPLIED). Proves claim_open_weekend_pair (a linked surgeon takes an open Saturday AND the Sunday after it in
-- one transaction) on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as sql/probes/claim-open-slot-probe.sql: run the whole file as ONE batch through the linked Supabase CLI (the
-- Management API runs it in a single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its
-- observation in a temp table and the LAST statement raises an exception whose message carries the results ('PROBE_RESULTS
-- A=...;END' - the ';END' sentinel marks where the CLI's own suffix begins), so the fixtures, the throwaway auth users, the
-- schedule rows, the time_off row, the call_periods row and every audit / feed / offer row the function writes roll back.
-- After every run verify-rls.sh section 17 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/weekend-pair-claim-probe.sql
--   (scripts/verify-rls.sh section 17 runs it, grades each case and checks nothing persisted)
--
-- BEFORE the migration the first block raises 'PROBE_SETUP: claim_open_weekend_pair is absent ...' (nothing else runs). AFTER
-- it every case below must read as listed.
--
-- Fixtures are FAR-FUTURE weekends in 2030-11 / 2030-12 (no other probe uses them; the setup refuses to run when schedule_days,
-- time_off, call_offers or call_periods already hold anything there) plus ONE row on 2020-01-04 (a Saturday in the past, inside
-- the range it opens - case I). Every schedule_days fixture carries source 'probe-pair', the time_off row the note 'probe-pair',
-- the call_periods row the label 'probe-pair' (the leftover count keys on them). Live roster ids used: s3 (the claimer - its
-- roster name, Acton, is what the audit summary and the feed title show) and s2 (holds two fixture slots). The acting users
-- are throwaway auth.users rows (email probe-pair-<uuid>@example.test) whose user_profiles rows the handle_new_auth_user
-- trigger creates: one linked to s3 as a surgeon, one left unlinked (a viewer - case O). Acting as a user: SET LOCAL ROLE
-- authenticated + request.jwt.claims.sub; case A acts as role anon with no sub. Errors are recorded as 'ERR <SQLSTATE>
-- <message>' (';' and quotes are flattened out of the values before the final raise).
--
-- Fixture weekends (Sat / Sun; primary / backup per day; version 1 unless stated)
--   2020-01-04 Sat   open / open                                  I (a past Saturday inside the range: CLAIM_PAST)
--   W1 11/02-11/03   open / open both days                        A (anon), B (the clean primary pair), B2, P
--   11/08 (Fri)      no row                                        C (a Friday given: CLAIM_NOT_SATURDAY)
--   W2 11/09-11/10   Sat open; Sun primary = s2                    D (Sunday held: CLAIM_HELD names Sunday, Saturday untouched)
--   W3 11/16-11/17   Sat primary LOCKED (empty); Sun open          E (CLAIM_LOCKED), M (the backup pair - a primary lock does not block it)
--   W4 11/23-11/24   Sat open; Sun external_cover 'probe-locum'    F (CLAIM_EXTERNAL names Sunday), L (backup pair; period 11/18-11/23 rules_only s3)
--   W5 11/30-12/01   Sat open; Sun backup = s3                     G (a primary pair: CLAIM_OTHER_ROLE names Sunday)
--   W6 12/07-12/08   open / open; s3 vacation 12/09 (Monday)       H (primary: CLAIM_VACATION - the Monday edge), H2 (backup: ok)
--   W7 12/14-12/15   Sat NO ROW; Sun open                          K (ok - the Saturday row is created with source 'claim')
--   W8 12/21-12/22   Sat NO ROW; Sun primary = s2                  K2 (CLAIM_HELD names Sunday; the Saturday row is NOT left behind)
--   W9 12/28         Sat open, the LAST row (max(day)); no Sunday   J (CLAIM_OUTSIDE_RANGE names Sunday 12/29)
--   call_periods 'probe-pair' 2030-11-18..2030-11-23 (ends on W4's Saturday), rules_only_ids ["s3"] - L's split weekend
--
-- Cases and expectations AFTER the migration
--   A   anon (role anon, no jwt sub) claims W1 primary        A=ERR 42501 permission denied for function claim_open_weekend_pair
--   B   s3 claims W1 primary (both open)                      B=ok versions=2,2 primary=s3,s3 source=claim,claim audit=2 notif=2 offers=2
--   B2  the two audit rows B wrote (read as postgres)          B2=Acton took 11/2 primary (pair 2030-11-03, offer true) | Acton took 11/3 primary (pair 2030-11-02, offer true)
--   C   a Friday (11/08) given                                C=ERR CL010 CLAIM_NOT_SATURDAY: 2030-11-08 is not a Saturday - the two-day claim takes a Saturday and the Sunday after it
--   D   W2 primary (Sunday held by s2)                        D=ERR CL005 CLAIM_HELD: 2030-11-10 primary is already held by s2 after: sat_primary=null sat_version=1 audit=0 offers=0
--   E   W3 primary (Saturday locked)                          E=ERR CL007 CLAIM_LOCKED: 2030-11-16 primary is locked  ask the scheduler to assign it
--   F   W4 primary (Sunday external cover)                    F=ERR CL006 CLAIM_EXTERNAL: 2030-11-24 primary is covered by probe-locum (outside the roster)
--   G   W5 primary (s3 already backup on Sunday)              G=ERR CL008 CLAIM_OTHER_ROLE: you already hold backup on 2030-12-01
--   H   W6 primary (s3 vacation starts Monday 12/09)          H=ERR CL009 CLAIM_VACATION: your vacation 12/9-12/9 conflicts with 2030-12-07 and 2030-12-08 primary (...)
--   H2  W6 backup (the Monday is no edge for a backup pair)   H2=ok versions=2,2 backup=s3,s3
--   I   2020-01-04 (a past Saturday, inside the range)        I=ERR CL003 CLAIM_PAST: 2020-01-04 is before today (...) in Central time  past days are not open
--   J   W9 12/28 (Sunday 12/29 after max(day) = 12/28)        J=ERR CL004 CLAIM_OUTSIDE_RANGE: 2030-12-29 is outside the published schedule (2020-01-04 to 2030-12-28)
--   K   W7 primary (no Saturday row)                          K=ok versions=2,2 primary=s3,s3 sat_source=claim
--   K2  W8 primary (no Saturday row, Sunday held by s2)       K2=ERR CL005 CLAIM_HELD: 2030-12-22 primary is already held by s2 after: sat_row=absent
--   L   W4 backup (period ends Sat 11/23, rules_only s3)      L=ok versions=2,2 offer_sat=false offer_sun=true offers=1
--   M   W3 backup (the Saturday's PRIMARY is locked)          M=ok versions=2,2 backup=s3,s3
--   N   W1 role 'observer'                                    N=ERR CL002 CLAIM_BAD_ROLE: role must be primary or backup (got observer)
--   O   an unlinked signed-in user claims W7 backup            O=ERR CL001 CLAIM_NOT_LINKED: sign in with an account that is linked to a roster entry to take a shift
--   P   after B: this backend holds a granted ShareLock on public.time_off (B's inner block committed; the relation lock stays
--       until the batch's transaction ends)                    P=share_locks=1
--   Q   EXECUTE privilege                                     Q=anon=false authenticated=true
-- (20 cases: A, B, B2, C, D, E, F, G, H, H2, I, J, K, K2, L, M, N, O, P, Q.)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  surgeon uuid := gen_random_uuid();
  viewer  uuid := gen_random_uuid();
  u       uuid;
begin
  if to_regprocedure('public.claim_open_weekend_pair(date,text)') is null then
    raise exception 'PROBE_SETUP: claim_open_weekend_pair is absent - sql/migrations/2026-10-01-weekend-pair-claim.sql is not applied';
  end if;
  if exists (select 1 from public.schedule_days where day between '2030-11-01' and '2030-12-31' or day = '2020-01-04')
     or exists (select 1 from public.time_off where start_date <= '2030-12-31' and end_date >= '2030-11-01')
     or exists (select 1 from public.call_offers where day between '2030-11-01' and '2030-12-31')
     or exists (select 1 from public.call_periods where start_day <= '2030-12-31' and end_day >= '2030-11-01') then
    raise exception 'PROBE_SETUP: live rows already sit in 2030-11 / 2030-12 or on 2020-01-04 (schedule_days / time_off / call_offers / call_periods) - the probe fixtures would collide';
  end if;
  foreach u in array array[surgeon, viewer] loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
            'probe-pair-' || u::text || '@example.test', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', false);
  end loop;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = null, role = 'viewer'  where id = viewer;
  if (select count(*) from public.user_profiles where id in (surgeon, viewer)) <> 2 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('viewer', viewer::text);

  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, external_cover, source, version)
  values ('2020-01-04', null, null, false, false, null,          'probe-pair', 1),   -- I: a past Saturday, the range's lower bound
         ('2030-11-02', null, null, false, false, null,          'probe-pair', 1),   -- W1 Sat: A / B / N
         ('2030-11-03', null, null, false, false, null,          'probe-pair', 1),   -- W1 Sun
         ('2030-11-09', null, null, false, false, null,          'probe-pair', 1),   -- W2 Sat: D
         ('2030-11-10', 's2', null, false, false, null,          'probe-pair', 1),   -- W2 Sun: primary held by s2
         ('2030-11-16', null, null, true,  false, null,          'probe-pair', 1),   -- W3 Sat: primary LOCKED, empty (E); M takes the backups
         ('2030-11-17', null, null, false, false, null,          'probe-pair', 1),   -- W3 Sun
         ('2030-11-23', null, null, false, false, null,          'probe-pair', 1),   -- W4 Sat: F / L
         ('2030-11-24', null, null, false, false, 'probe-locum', 'probe-pair', 1),   -- W4 Sun: external cover (primary)
         ('2030-11-30', null, null, false, false, null,          'probe-pair', 1),   -- W5 Sat: G
         ('2030-12-01', null, 's3', false, false, null,          'probe-pair', 1),   -- W5 Sun: s3 holds the backup
         ('2030-12-07', null, null, false, false, null,          'probe-pair', 1),   -- W6 Sat: H / H2
         ('2030-12-08', null, null, false, false, null,          'probe-pair', 1),   -- W6 Sun
         ('2030-12-15', null, null, false, false, null,          'probe-pair', 1),   -- W7 Sun: K / O (the Saturday has NO row)
         ('2030-12-22', 's2', null, false, false, null,          'probe-pair', 1),   -- W8 Sun: primary held by s2 (K2; the Saturday has NO row)
         ('2030-12-28', null, null, false, false, null,          'probe-pair', 1);   -- W9 Sat: the last row, max(day) (J)
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s3', '2030-12-09', '2030-12-09', 'probe-pair', 'probe-pair');            -- H: the Monday after W6
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, rules_only_ids, created_by)
  values ('probe-pair', '2030-11-18', '2030-11-23', '2030-11-04', '2030-11-11', 'upcoming', '["s3"]'::jsonb, 'probe-pair');   -- L
  if (select max(day) from public.schedule_days) <> '2030-12-28' then
    raise exception 'PROBE_SETUP: max(day) is not 2030-12-28 (a real row lies beyond the fixtures; case J would not test the range)';
  end if;
  if exists (select 1 from public.schedule_days where day in ('2030-11-08', '2030-12-14', '2030-12-21', '2030-12-29')) then
    raise exception 'PROBE_SETUP: a row exists on a day the probe needs without one (11/08, 12/14, 12/21, 12/29)';
  end if;
end $$;

-- ---------- A: anon (no jwt sub, role anon) - EXECUTE is revoked from anon
do $$
declare v text;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform public.claim_open_weekend_pair('2030-11-02'::date, 'primary');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok (anon was allowed to call the function)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;   -- the subtransaction rollback already restored the postgres role
  end;
  insert into probe_results values ('A', v);
end $$;

-- ---------- B: the clean primary pair (both days open, unlocked, inside the range)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; p1 text; p2 text; s1 text; s2 text; na int; nn int; no int; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_weekend_pair('2030-11-02'::date, 'primary') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select primary_id, source into p1, s1 from public.schedule_days where day = '2030-11-02';
    select primary_id, source into p2, s2 from public.schedule_days where day = '2030-11-03';
    select count(*) into na from public.audit_log where action = 'schedule.claim' and detail ->> 'day' in ('2030-11-02', '2030-11-03');
    select count(*) into nn from public.notifications where type = 'shift_claimed' and data ->> 'day' in ('2030-11-02', '2030-11-03');
    select count(*) into no from public.call_offers where person_id = 's3' and day in ('2030-11-02', '2030-11-03');
    v := 'ok versions=' || coalesce(res -> 'versions' ->> 0, 'null') || ',' || coalesce(res -> 'versions' ->> 1, 'null')
         || ' primary=' || coalesce(p1, 'null') || ',' || coalesce(p2, 'null')
         || ' source=' || coalesce(s1, 'null') || ',' || coalesce(s2, 'null')
         || ' audit=' || na::text || ' notif=' || nn::text || ' offers=' || no::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('B', v);
end $$;

-- ---------- B2: the two audit rows B wrote - summary, pair, offer (in day order)
do $$
declare v text;
begin
  begin
    select string_agg(a.detail ->> 'summary' || ' (pair ' || coalesce(a.detail ->> 'pair', 'null') || ', offer ' || coalesce(a.detail ->> 'offer', 'null') || ')', ' | ' order by a.detail ->> 'day')
      into v
      from public.audit_log a
     where a.action = 'schedule.claim' and a.detail ->> 'day' in ('2030-11-02', '2030-11-03');
    v := coalesce(v, 'no audit rows');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('B2', v);
end $$;

-- ---------- P: the lock B took and still holds - a granted ShareLock on public.time_off in pg_locks for this backend
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
  insert into probe_results values ('P', v);
end $$;

-- ---------- C .. K2, M, N: one claim each as the linked surgeon s3; refusals record the error, successes the rows
-- (a helper keeps every case's shape the same: role set, claim, role reset, the observation)
create function pg_temp.probe_pair_claim(p_sat date, p_role text) returns text
language plpgsql as $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_weekend_pair(p_sat, p_role) into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok versions=' || coalesce(res -> 'versions' ->> 0, 'null') || ',' || coalesce(res -> 'versions' ->> 1, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  return v;
end $$;

-- C: a Friday given
do $$ begin insert into probe_results values ('C', pg_temp.probe_pair_claim('2030-11-08'::date, 'primary')); end $$;

-- D: the Sunday is held - refused naming the Sunday; the Saturday stays as it was (no write, no audit, no offer)
do $$
declare v text; p text; ver int; na int; no int;
begin
  v := pg_temp.probe_pair_claim('2030-11-09'::date, 'primary');
  select primary_id, version into p, ver from public.schedule_days where day = '2030-11-09';
  select count(*) into na from public.audit_log where action = 'schedule.claim' and detail ->> 'day' in ('2030-11-09', '2030-11-10');
  select count(*) into no from public.call_offers where person_id = 's3' and day in ('2030-11-09', '2030-11-10');
  insert into probe_results values ('D', v || ' after: sat_primary=' || coalesce(p, 'null') || ' sat_version=' || coalesce(ver::text, 'null') || ' audit=' || na::text || ' offers=' || no::text);
end $$;

-- E: the Saturday's primary is locked
do $$ begin insert into probe_results values ('E', pg_temp.probe_pair_claim('2030-11-16'::date, 'primary')); end $$;

-- F: the Sunday's primary is covered from outside the roster
do $$ begin insert into probe_results values ('F', pg_temp.probe_pair_claim('2030-11-23'::date, 'primary')); end $$;

-- G: the caller already holds the Sunday's backup
do $$ begin insert into probe_results values ('G', pg_temp.probe_pair_claim('2030-11-30'::date, 'primary')); end $$;

-- H: a primary pair the day before the caller's vacation (the Monday edge) ...
do $$ begin insert into probe_results values ('H', pg_temp.probe_pair_claim('2030-12-07'::date, 'primary')); end $$;

-- H2: ... while the backup pair of the same weekend is allowed
do $$
declare v text; b1 text; b2 text;
begin
  v := pg_temp.probe_pair_claim('2030-12-07'::date, 'backup');
  select backup_id into b1 from public.schedule_days where day = '2030-12-07';
  select backup_id into b2 from public.schedule_days where day = '2030-12-08';
  insert into probe_results values ('H2', v || case when v like 'ok%' then ' backup=' || coalesce(b1, 'null') || ',' || coalesce(b2, 'null') else '' end);
end $$;

-- I: a past Saturday inside the range (2020-01-04 is the lower bound) - PAST is checked before RANGE
do $$ begin insert into probe_results values ('I', pg_temp.probe_pair_claim('2020-01-04'::date, 'primary')); end $$;

-- J: the Sunday after max(day)
do $$ begin insert into probe_results values ('J', pg_temp.probe_pair_claim('2030-12-28'::date, 'primary')); end $$;

-- K: the Saturday has no row - one is created with source 'claim' and the pair is taken
do $$
declare v text; p1 text; p2 text; src text;
begin
  v := pg_temp.probe_pair_claim('2030-12-14'::date, 'primary');
  select primary_id, source into p1, src from public.schedule_days where day = '2030-12-14';
  select primary_id into p2 from public.schedule_days where day = '2030-12-15';
  insert into probe_results values ('K', v || case when v like 'ok%' then ' primary=' || coalesce(p1, 'null') || ',' || coalesce(p2, 'null') || ' sat_source=' || coalesce(src, 'null') else '' end);
end $$;

-- K2: the Saturday has no row and the Sunday is held - refused naming the Sunday, and the Saturday row created on the way
-- is rolled back with the refusal (never left behind)
do $$
declare v text; n int;
begin
  v := pg_temp.probe_pair_claim('2030-12-21'::date, 'primary');
  select count(*) into n from public.schedule_days where day = '2030-12-21';
  insert into probe_results values ('K2', v || ' after: sat_row=' || case when n = 0 then 'absent' else 'PRESENT' end);
end $$;

-- L: a backup pair over a period boundary - the period 11/18-11/23 lists s3 in rules_only_ids, so the Saturday gets NO offer
-- row and the Sunday (outside every period) gets one
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  res jsonb; v text; no int;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_weekend_pair('2030-11-23'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select count(*) into no from public.call_offers where person_id = 's3' and day in ('2030-11-23', '2030-11-24');
    v := 'ok versions=' || coalesce(res -> 'versions' ->> 0, 'null') || ',' || coalesce(res -> 'versions' ->> 1, 'null')
         || ' offer_sat=' || coalesce(res -> 'offers' ->> 0, 'null') || ' offer_sun=' || coalesce(res -> 'offers' ->> 1, 'null')
         || ' offers=' || no::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('L', v);
end $$;

-- M: the backup pair of W3 - the Saturday's PRIMARY lock does not block the backup
do $$
declare v text; b1 text; b2 text;
begin
  v := pg_temp.probe_pair_claim('2030-11-16'::date, 'backup');
  select backup_id into b1 from public.schedule_days where day = '2030-11-16';
  select backup_id into b2 from public.schedule_days where day = '2030-11-17';
  insert into probe_results values ('M', v || case when v like 'ok%' then ' backup=' || coalesce(b1, 'null') || ',' || coalesce(b2, 'null') else '' end);
end $$;

-- N: an unknown role
do $$ begin insert into probe_results values ('N', pg_temp.probe_pair_claim('2030-11-02'::date, 'observer')); end $$;

-- ---------- O: a signed-in user with no roster link
do $$
declare
  uid text := (select v from probe_ctx where k = 'viewer');
  res jsonb; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    select public.claim_open_weekend_pair('2030-12-14'::date, 'backup') into res;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok (an unlinked user was allowed to claim)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('O', v);
end $$;

-- ---------- Q: EXECUTE - revoked from anon, granted to authenticated
do $$
declare v text;
begin
  begin
    v := 'anon=' || has_function_privilege('anon', 'public.claim_open_weekend_pair(date,text)', 'execute')::text
         || ' authenticated=' || has_function_privilege('authenticated', 'public.claim_open_weekend_pair(date,text)', 'execute')::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('Q', v);
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
