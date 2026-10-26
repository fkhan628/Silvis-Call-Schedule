-- ============================================================================
-- Silvis Call Schedule - locked trade PROBE (2026-10-25, revision ab; sql/migrations/2026-10-25-locked-trade.sql, REPORT-FIRST; APPLIED 2026-10-26 03:50:31Z).
-- Proves that apply_trade moves a LOCKED slot once the trade is accepted - whichever party applies it - that a signed-in account with
-- no roster link can apply no trade, and that every other refusal still holds on a locked slot, on the LIVE database WITHOUT
-- PERSISTING ANYTHING. Same mechanism as the other probes: ONE batch through the linked CLI (one implicit transaction, no
-- BEGIN/COMMIT); every case records into probe_results; the LAST statement raises 'PROBE_RESULTS K=...;END', so everything - users,
-- days, vacations, trades, audit rows - rolls back. A batch ending in RAISE persists nothing.
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/locked-trade-probe.sql
--   (graded by Faraz's apply-locked-trade.sh, kept in the private apply-scripts folder, and, since the record step, by scripts/verify-rls.sh
--   section 24, value for value against the header lines below)
-- As run: the migration was applied 2026-10-26 03:50:31Z (schema.sql revision ab); the probe read PROBE_SETUP (apply_trade still refuses a
-- member on a locked slot) before it and all 18 cases below as listed after it, leftover count 0 (apply-locked-trade.sh steps 3 and 6). Since
-- the record step verify-rls section 24 runs it on every run, grades each case against its line below and counts the leftovers it could
-- leave; it FAILs a PROBE_SETUP (the lock refusal still there, revision y absent, a collision or the profile rows) or a missing sentinel.
-- Run nothing else that writes trades or vacations at the same time: the probe takes the time_off SHARE lock (apply_trade) for the
-- length of the batch - well under a second.
-- Identity: users probe-lockedtrade-<uuid>@example.test; trades detail 'probe-lockedtrade <K>'; time_off note 'probe-lockedtrade';
-- schedule_days source 'probe-lockedtrade' in the windows 2032-03-01..2032-03-31 and 2020-08-01..2020-08-31, which the collision guard
-- proves empty first (no schedule day, vacation, offer, availability row, offer period or trade.apply audit row there).
-- No offer period covers either window, so revision y's offer loop writes no call_offers row for any case.
-- Users: u1 = s1 as scheduler, u2..u4 = surgeons s2..s4 (no display name: the audit row's actor falls back to the roster name), u5 = a
-- viewer and u6 = the office coordinator, both with no roster link (person_id null - the coordinator's role allows no other).
-- Fixture trades: L1-L6 and N4 go through the app's own path (the member inserts a pending row, the receiver accepts it through
-- trade_update_guard); L7, N1-N3 and N5-N8 are inserted already accepted as postgres (the step under test comes after the status).
-- Reading: st=<status> then the slot(s) moved: <role holder>/<lock flag>, src = the day's source.
-- Cases (BEFORE the migration the setup raises PROBE_SETUP: apply_trade still refuses ...; AFTER - the string after '->'):
--   P1  postgres: apply_trade definer, no lock refusal, the NULL-safe party test, y's offer loop kept, the EXECUTE grants -> definer=t lock_check=f null_safe=t loop=t anon=f auth=t
--   L1  give of a LOCKED primary s2 to s3: u3 accepts, u3 applies -> st=applied p=s3 pl=f src=trade
--   L2  trade, BOTH legs locked (s2's primary 03-02, s3's backup 03-04 in return): u3 accepts, u2 (the proposer) applies -> st=applied 1=s3/f 2=s2/f
--   L3  give of a LOCKED backup s2 to s3: u3 accepts and applies -> st=applied b=s3 bl=f src=trade
--   L4  the day's OTHER role stays locked: primary s2 and backup s4 both locked, the primary given to s3, u3 applies -> st=applied p=s3/f b=s4/t
--   L5  only the RETURN leg is locked (s3's backup 03-11): u3 accepts and applies -> st=applied 1=s3/f 2=s2/f
--   L6  the scheduler applies a locked slot (unchanged): u3 accepts, u1 applies -> st=applied p=s3 pl=f src=trade
--   L7  a server session (postgres, no signed-in user) applies an accepted locked give (it passes the party test as before, check (c) is gone) -> st=applied p=s3/f src=trade
--   N1  locked slot, the receiver is on vacation that day -> ERR TRADE_INELIGIBLE: Acton is on vacation on 2032-03-15
--   N2  locked slot, the receiver already holds the other role -> ERR TRADE_INELIGIBLE: Acton already holds backup on 2032-03-16
--   N3  locked slot on a past day, the receiver applies -> TRADE_PAST 2020-08-11
--   N4  locked slot, the trade is still pending, the receiver applies -> ERR TRADE_NOT_ACCEPTED: status is pending
--   N5  locked slot, a surgeon who is no party applies -> ERR TRADE_FORBIDDEN: only a party or the scheduler may apply this trade
--   N6  locked slot no longer held by the giver -> ERR TRADE_STALE: 2032-03-19 primary is no longer held by s2
--   N7  a viewer with no roster link applies an accepted locked give -> ERR TRADE_FORBIDDEN: only a party or the scheduler may apply this trade
--   N8  the office coordinator (no roster link) applies an accepted locked give -> ERR TRADE_FORBIDDEN: only a party or the scheduler may apply this trade
--   C1  a locked OPEN slot stays the scheduler's to assign: u3 claims it -> ERR CL007 CLAIM_LOCKED: 2032-03-22 primary is locked, ask the scheduler to assign it
--   A1  L1's trade.apply audit row -> actor=s3/Acton summary=Trade applied: Acton takes Primary Mon Mar 1 (from Burchett, one-way)
-- 18 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid(); u4 uuid := gen_random_uuid();
  u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid();
begin
  -- the collision guard first (a dry run must see it), on what the fixtures can meet only
  if exists (select 1 from public.schedule_days where day between '2032-03-01' and '2032-03-31' or day between '2020-08-01' and '2020-08-31')
     or exists (select 1 from public.time_off where (start_date <= '2032-03-31' and end_date >= '2032-03-01')
                                                  or (start_date <= '2020-08-31' and end_date >= '2020-08-01'))
     or exists (select 1 from public.call_offers where day between '2032-03-01' and '2032-03-31' or day between '2020-08-01' and '2020-08-31')
     or exists (select 1 from public.availability where (start_date <= '2032-03-31' and end_date >= '2032-03-01')
                                                      or (start_date <= '2020-08-31' and end_date >= '2020-08-01'))
     or exists (select 1 from public.call_periods where (start_day <= '2032-03-31' and end_day >= '2032-03-01')
                                                      or (start_day <= '2020-08-31' and end_day >= '2020-08-01'))
     or exists (select 1 from public.audit_log where action = 'trade.apply'
                   and ((detail ->> 'day') between '2032-03-01' and '2032-03-31' or (detail ->> 'day') between '2020-08-01' and '2020-08-31'))
     or exists (select 1 from public.shift_trade_requests where detail like 'probe-lockedtrade%') then
    raise exception 'PROBE_SETUP: live rows already sit in the probe window (schedule_days / time_off / call_offers / availability / call_periods / trade.apply audit rows in 2032-03 or 2020-08, or a probe-lockedtrade trade) - the probe fixtures would collide';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%for leg_n, leg_pid, leg_day, leg_role in%') then
    raise exception 'PROBE_SETUP: apply_trade is not revision y''s body (its offer loop is missing) - this probe grades sql/migrations/2026-10-25-locked-trade.sql on top of revision y';
  end if;
  if exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%is locked; ask the scheduler%') then
    raise exception 'PROBE_SETUP: apply_trade still refuses a member on a locked slot - sql/migrations/2026-10-25-locked-trade.sql is not applied';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-lockedtrade-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, u3, u4, u5, u6]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, u3, u4, u5, u6)) <> 6 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's1', role = 'scheduler', display_name = null where id = u1;
  update public.user_profiles set person_id = 's2', role = 'surgeon', display_name = null where id = u2;
  update public.user_profiles set person_id = 's3', role = 'surgeon', display_name = null where id = u3;
  update public.user_profiles set person_id = 's4', role = 'surgeon', display_name = null where id = u4;
  update public.user_profiles set person_id = null, role = 'viewer', display_name = null where id = u5;
  update public.user_profiles set person_id = null, role = 'coordinator', display_name = null where id = u6;
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('u3', u3::text), ('u4', u4::text), ('u5', u5::text), ('u6', u6::text);
  perform set_config('request.jwt.claims', '{}', true);
  -- the days (who holds what, and what is locked, before the trades)
  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source)
  values ('2032-03-01', 's2', null,  true,  false, 'probe-lockedtrade'),   -- L1
         ('2032-03-02', 's2', null,  true,  false, 'probe-lockedtrade'),   -- L2 leg 1
         ('2032-03-04', null, 's3',  false, true,  'probe-lockedtrade'),   -- L2 return leg
         ('2032-03-05', null, 's2',  false, true,  'probe-lockedtrade'),   -- L3
         ('2032-03-08', 's2', 's4',  true,  true,  'probe-lockedtrade'),   -- L4
         ('2032-03-09', 's2', null,  false, false, 'probe-lockedtrade'),   -- L5 leg 1 (unlocked)
         ('2032-03-11', null, 's3',  false, true,  'probe-lockedtrade'),   -- L5 return leg
         ('2032-03-12', 's2', null,  true,  false, 'probe-lockedtrade'),   -- L6
         ('2032-03-15', 's2', null,  true,  false, 'probe-lockedtrade'),   -- N1
         ('2032-03-16', 's2', 's3',  true,  false, 'probe-lockedtrade'),   -- N2
         ('2032-03-17', 's2', null,  true,  false, 'probe-lockedtrade'),   -- N4
         ('2032-03-18', 's2', null,  true,  false, 'probe-lockedtrade'),   -- N5
         ('2032-03-19', 's5', null,  true,  false, 'probe-lockedtrade'),   -- N6 (not the giver's)
         ('2032-03-22', null, 's4',  true,  false, 'probe-lockedtrade'),   -- C1 (a locked OPEN primary)
         ('2032-03-23', 's2', null,  true,  false, 'probe-lockedtrade'),   -- N7
         ('2032-03-24', 's2', null,  true,  false, 'probe-lockedtrade'),   -- N8
         ('2032-03-25', 's2', null,  true,  false, 'probe-lockedtrade'),   -- L7
         ('2020-08-11', 's2', null,  true,  false, 'probe-lockedtrade');   -- N3 (a past day)
  -- N1's vacation (03-15: s3 holds no slot that day and no primary on 03-14, which is what the time_off trigger reads)
  insert into public.time_off (person_id, start_date, end_date, note, created_by) values ('s3', '2032-03-15', '2032-03-15', 'probe-lockedtrade', 'probe');
end $$;

-- ---------- helpers (pg_temp; act() switches the acting user inside a case - its SET LOCAL is undone by the case's rollback on error)
create or replace function pg_temp.act(p_key text) returns void language plpgsql as $$
declare uid text;
begin
  if p_key = 'postgres' then
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    return;
  end if;
  select c.v into uid from probe_ctx c where c.k = p_key;
  if uid is null then raise exception 'PROBE_SETUP: no probe user %', p_key; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
-- a member's give (kind give, one-way), inserted pending by the giver himself
create or replace function pg_temp.give(p_by text, p_from text, p_to text, p_day date, p_role text, p_key text) returns uuid language plpgsql as $$
declare tid uuid;
begin
  perform pg_temp.act(p_by);
  insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
  values ('give', p_from, p_to, p_day, p_role, 'pending', 'probe-lockedtrade ' || p_key) returning id into tid;
  perform pg_temp.act('postgres');
  return tid;
end $$;
-- a member's two-way trade, inserted pending by the proposer himself
create or replace function pg_temp.trade(p_by text, p_from text, p_to text, p_day date, p_role text, p_rday date, p_rrole text, p_key text) returns uuid language plpgsql as $$
declare tid uuid;
begin
  perform pg_temp.act(p_by);
  insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
  values ('trade', p_from, p_to, p_day, p_role, p_rday, p_rrole, 'pending', 'probe-lockedtrade ' || p_key) returning id into tid;
  perform pg_temp.act('postgres');
  return tid;
end $$;
-- a give inserted already accepted (postgres, no signed-in user - a server session: the insert guard keeps the status)
create or replace function pg_temp.accepted_give(p_from text, p_to text, p_day date, p_role text, p_key text) returns uuid language plpgsql as $$
declare tid uuid;
begin
  perform pg_temp.act('postgres');
  insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
  values ('give', p_from, p_to, p_day, p_role, 'accepted', 'probe-lockedtrade ' || p_key) returning id into tid;
  return tid;
end $$;
create or replace function pg_temp.accept(p_by text, p_tid uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act(p_by);
  update public.shift_trade_requests set status = 'accepted', decided_at = now() where id = p_tid;
  perform pg_temp.act('postgres');
end $$;
create or replace function pg_temp.apply(p_by text, p_tid uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act(p_by);
  perform public.apply_trade(p_tid);
  perform pg_temp.act('postgres');
end $$;
create or replace function pg_temp.st(p_tid uuid) returns text language sql as $$
  select 'st=' || coalesce((select t.status from public.shift_trade_requests t where t.id = p_tid), 'none');
$$;
-- a slot as <holder>/<lock flag> (t / f)
create or replace function pg_temp.slot(p_day date, p_role text) returns text language sql as $$
  select coalesce((select case when p_role = 'primary' then coalesce(d.primary_id, 'open') || '/' || case when d.primary_locked then 't' else 'f' end
                               else coalesce(d.backup_id, 'open') || '/' || case when d.backup_locked then 't' else 'f' end end
                     from public.schedule_days d where d.day = p_day), 'none');
$$;
create or replace function pg_temp.src(p_day date) returns text language sql as $$
  select coalesce((select d.source from public.schedule_days d where d.day = p_day), 'none');
$$;

-- ---------- P1: as postgres - the function as the migration leaves it
do $$ declare res text; begin
  begin
    select 'definer=' || (select case when p.prosecdef then 't' else 'f' end from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' lock_check=' || (select case when p.prosrc like '%is locked%' or p.prosrc like '%d1.primary_locked%' or p.prosrc like '%d2.backup_locked%' then 't' else 'f' end
                                from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' null_safe=' || (select case when p.prosrc like '%if not sched and auth.uid() is not null and (me is null or me not in (t.from_surgeon_id, t.to_surgeon_id)) then%' then 't' else 'f' end
                               from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' loop=' || (select case when p.prosrc like '%for leg_n, leg_pid, leg_day, leg_role in%' and p.prosrc like '%''return_offer'', wrote2%' then 't' else 'f' end
                          from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' anon=' || case when has_function_privilege('anon', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
        || ' auth=' || case when has_function_privilege('authenticated', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
      into res;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('P1', res);
end $$;

-- ---------- L1-L7: a locked slot moves once the trade is accepted, whichever party applies (and A1, L1's audit row)
do $$ declare tid uuid; res text; a1 text := 'none - L1 failed'; actor text; summary text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2032-03-01', 'primary', 'L1');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.st(tid) || ' p=' || replace(pg_temp.slot('2032-03-01', 'primary'), '/', ' pl=') || ' src=' || pg_temp.src('2032-03-01');
    select coalesce(a.actor_id, 'null') || '/' || coalesce(a.actor_name, 'null'), coalesce(a.detail ->> 'summary', 'null') into actor, summary
      from public.audit_log a where a.action = 'trade.apply' and a.detail ->> 'trade_id' = tid::text order by a.created_at desc limit 1;
    a1 := 'actor=' || coalesce(actor, 'none') || ' summary=' || coalesce(summary, 'none');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L1', res);
  insert into probe_results values ('A1', a1);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.trade('u2', 's2', 's3', '2032-03-02', 'primary', '2032-03-04', 'backup', 'L2');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u2', tid);
    res := pg_temp.st(tid) || ' 1=' || pg_temp.slot('2032-03-02', 'primary') || ' 2=' || pg_temp.slot('2032-03-04', 'backup');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2032-03-05', 'backup', 'L3');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.st(tid) || ' b=' || replace(pg_temp.slot('2032-03-05', 'backup'), '/', ' bl=') || ' src=' || pg_temp.src('2032-03-05');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L3', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2032-03-08', 'primary', 'L4');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.st(tid) || ' p=' || pg_temp.slot('2032-03-08', 'primary') || ' b=' || pg_temp.slot('2032-03-08', 'backup');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L4', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.trade('u2', 's2', 's3', '2032-03-09', 'primary', '2032-03-11', 'backup', 'L5');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.st(tid) || ' 1=' || pg_temp.slot('2032-03-09', 'primary') || ' 2=' || pg_temp.slot('2032-03-11', 'backup');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L5', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2032-03-12', 'primary', 'L6');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u1', tid);
    res := pg_temp.st(tid) || ' p=' || replace(pg_temp.slot('2032-03-12', 'primary'), '/', ' pl=') || ' src=' || pg_temp.src('2032-03-12');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L6', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-25', 'primary', 'L7');
    perform pg_temp.act('postgres');
    perform public.apply_trade(tid);
    res := pg_temp.st(tid) || ' p=' || pg_temp.slot('2032-03-25', 'primary') || ' src=' || pg_temp.src('2032-03-25');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('L7', res);
end $$;

-- ---------- N1-N8: every other refusal still holds on a locked slot; an account with no roster link applies nothing
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-15', 'primary', 'N1');
    perform pg_temp.apply('u3', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N1', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-16', 'primary', 'N2');
    perform pg_temp.apply('u3', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2020-08-11', 'primary', 'N3');
    perform pg_temp.apply('u3', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then
    -- "today" is Central at run time: the token and the day are graded, not the whole sentence
    res := case when sqlerrm like 'TRADE_PAST: 2020-08-11 is before today (%) in Central time; past days are changed by the scheduler only'
                then 'TRADE_PAST 2020-08-11' else 'ERR ' || replace(sqlerrm, ';', ',') end;
  end;
  insert into probe_results values ('N3', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2032-03-17', 'primary', 'N4');
    perform pg_temp.apply('u3', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N4', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-18', 'primary', 'N5');
    perform pg_temp.apply('u4', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N5', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-19', 'primary', 'N6');
    perform pg_temp.apply('u3', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N6', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-23', 'primary', 'N7');
    perform pg_temp.apply('u5', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N7', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.accepted_give('s2', 's3', '2032-03-24', 'primary', 'N8');
    perform pg_temp.apply('u6', tid);
    res := 'applied ' || pg_temp.st(tid);
  exception when others then res := 'ERR ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('N8', res);
end $$;

-- ---------- C1: a locked OPEN slot is still the scheduler's to assign (claim_open_slot, unchanged)
do $$ declare res text; begin
  begin
    perform pg_temp.act('u3');
    perform public.claim_open_slot('2032-03-22', 'primary');
    perform pg_temp.act('postgres');
    res := 'claimed ' || pg_temp.slot('2032-03-22', 'primary');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('C1', res);
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
