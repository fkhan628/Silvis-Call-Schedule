-- ============================================================================
-- Silvis Call Schedule - trade offer PROBE (2026-10-18, revision y; sql/migrations/2026-10-18-trade-offer.sql, REPORT-FIRST, NOT APPLIED).
-- Proves the consent stamps (shift_trade_requests.proposed_by / accepted_by) and apply_trade's receiver offer rows on the LIVE
-- database WITHOUT PERSISTING ANYTHING. Same mechanism as the other probes: ONE batch through the linked CLI (one implicit
-- transaction, no BEGIN/COMMIT); every case records into probe_results; the LAST statement raises 'PROBE_RESULTS K=...;END', so
-- everything - users, periods, offers, days, trades, audit rows - rolls back. A batch ending in RAISE persists nothing.
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/trade-offer-probe.sql
--   (graded by the private apply-scripts/apply-trade-offer.sh, value for value against the header lines below)
-- Run nothing else that writes trades, offers or vacations at the same time: the probe takes the time_off SHARE lock (apply_trade)
-- and the per-person offers advisory lock (a primary leg) for the length of the batch - well under a second.
-- Identity: users probe-tradeoffer-<uuid>@example.test; trades detail 'probe-tradeoffer <K>'; periods label 'probe-tradeoffer P?';
-- schedule_days / call_offers / availability rows in the windows 2031-05-01..2031-09-30, 2020-06-01..2020-06-30 and 2029-12-31,
-- which the collision guard proves empty first (a probe period PP spans 2020-06-01..2029-12-31; its only case day is 2020-06-10).
-- The outside-surgeon branch (roster type external) is proven offline only: the probe never writes call_schedule_data.
-- Periods: PA 2031-05-01..2031-06-30 PUBLISHED (frozen - every member apply below goes through the OFFER_FROZEN bypass),
-- rules_only s5; PB 2031-06-15..2031-07-31 upcoming, rules_only s6 (overlaps PA - the earliest start wins); PC 2031-08-01..
-- 2031-08-31 upcoming (s6 has no offer there - not started); PP 2020-06-01..2029-12-31 (closed by date; s1 submitted).
-- Submitted in PA through fixture offers: s1 (05-05 either), s2 (05-06 backup), s3 (05-02 backup), s4 (05-03 primary, plus the
-- merge fixtures 05-22 backup / 05-23 primary / 05-24 either, each email-relay by the scheduler with a seed note), s6 (05-04 backup);
-- s5 has an offer in PB only (07-20). s4 has a No primary day (availability backup_only) 2031-05-26..05-27.
-- Users: u1 = s1 as scheduler, ua = admin with no roster link, u2..u6 = surgeons s2..s6.
-- Reading: st=<status> by=<proposed_by>/<accepted_by> o1=<leg 1 receiver's offer> o2=<return receiver's offer> a=<offer>/<return_offer>
-- (an offer reads role_pref/entered_by/source, or none; a = the trade.apply audit detail, or none before an apply).
-- Cases (BEFORE the migration the setup raises PROBE_SETUP: shift_trade_requests.accepted_by is absent; AFTER - the string after '->'):
--   P1  postgres: the columns, apply_trade definer + its offer loop, the EXECUTE grants -> cols=proposed_by,accepted_by definer=t loop=t stamps=t anon=f auth=t
--   S1  u2 inserts a give to s3 sending status accepted and both stamps s9 -> st=pending by=s2/null
--   S2  u1 (scheduler) patches both stamps to s9 on that pending row -> st=pending by=s2/null
--   S3  u3 accepts it, sending both stamps s9 -> st=accepted by=s2/s3
--   S4  u1 patches both stamps to s9 on the accepted row -> st=accepted by=s2/s3
--   S5  u1 inserts an already accepted give s2 to s3 -> st=accepted by=scheduler/scheduler
--   S6  u1 inserts an already accepted give from s1 (himself) to s3 -> st=accepted by=s1/scheduler
--   S7  u3 declines a give, then u1 moves it to accepted -> st=accepted by=s2/scheduler
--   S8  postgres with no user inserts an already accepted give -> st=accepted by=scheduler/scheduler
--   S9  u1 inserts an already accepted give s2 to s1 (himself) -> st=accepted by=scheduler/s1
--   A1  give, u3 accepts and applies in the published PA -> st=applied by=s2/s3 o1=primary/s3/app a=true/false flag=off
--   A2  two-way trade, u3 accepts, u2 applies -> st=applied by=s2/s3 o1=primary/s3/app o2=backup/s2/app a=true/true
--   A3  u1 inserts a one-way trade, u3 accepts, u1 applies -> st=applied by=scheduler/s3 o1=primary/s3/app a=true/false
--   A4  locked slot: u3 accepts, u3's apply is refused, u1 applies -> m=locked st=applied by=s2/s3 o1=primary/s3/app a=true/false
--   A5  u1 accepts for s3, u3 applies (Retry apply) -> st=applied by=s2/scheduler o1=none a=false/false
--   A6  ua (admin, unlinked) accepts for s3 and applies -> st=applied by=s2/scheduler o1=none a=false/false
--   A7  u3 accepts, ua applies -> st=applied by=s2/s3 o1=primary/s3/app a=true/false upd=scheduler
--   A8  give s2 to s1, u1 accepts as the receiver and applies -> st=applied by=s2/s1 o1=primary/s1/app a=true/false
--   A9  u3 accepts, u1 moves the receiver to s4, u1 applies -> st=applied by=scheduler/scheduler o1=none a=false/false held=s4
--   A10 u1 inserts a trade from s1 with a return day and NO return role, u3 accepts and applies -> st=applied by=s1/s3 o1=primary/s3/app o2=backup/s1/app a=true/true
--   A11 u1 inserts a two-way trade s2 to s3, u3 accepts and applies -> st=applied by=scheduler/s3 o1=primary/s3/app o2=none a=true/false
--   M1  s4 takes primary over his backup offer (seed-owned) -> st=applied by=s2/s4 o1=either/s4/app a=true/false
--   M2  s4 takes primary over his primary offer (seed-owned) -> st=applied by=s2/s4 o1=primary/scheduler/email-relay a=true/false
--   M3  s4 takes backup over his either offer (seed-owned) -> st=applied by=s2/s4 o1=either/scheduler/email-relay a=true/false
--   R1  s5 is rules-only in PA -> st=applied by=s2/s5 o1=none a=false/false
--   R2  s6 has no offer in PC (not started) -> st=applied by=s2/s6 o1=none a=false/false
--   R3  a day outside every period -> st=applied by=s2/s3 o1=none a=false/false
--   R4  PA and PB both hold the day: s5 rules-only in PA (earliest), submitted in PB -> st=applied by=s2/s5 o1=none a=false/false
--   R5  PA and PB both hold the day: s6 submitted in PA (earliest), rules-only in PB -> st=applied by=s2/s6 o1=primary/s6/app a=true/false
--   R6  a past day in PP: u1 accepts as the receiver and applies -> st=applied by=s2/s1 o1=none a=false/false
--   R7  primary onto s4's No primary day -> lock=f/t st=applied by=s2/s4 o1=none a=false/false
--   R8  backup onto s4's No primary day -> st=applied by=s2/s4 o1=backup/s4/app a=true/false
-- 32 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  u1 uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); u5 uuid := gen_random_uuid(); u6 uuid := gen_random_uuid();
begin
  -- the collision guard first (a dry run must see it), on what the fixtures can meet only
  if exists (select 1 from public.schedule_days where day between '2031-05-01' and '2031-09-30' or day between '2020-06-01' and '2020-06-30')
     or exists (select 1 from public.call_offers where day between '2031-05-01' and '2031-09-30' or day = '2029-12-31')
     or exists (select 1 from public.call_periods where (start_day <= '2031-09-30' and end_day >= '2031-05-01')
                                                      or (start_day <= '2020-06-30' and end_day >= '2020-06-01')
                                                      or '2029-12-31' between start_day and end_day)
     or exists (select 1 from public.availability where start_date <= '2031-09-30' and end_date >= '2031-05-01')
     or exists (select 1 from public.time_off where (start_date <= '2031-09-30' and end_date >= '2031-05-01')
                                                  or (start_date <= '2020-06-30' and end_date >= '2020-06-01'))
     or exists (select 1 from public.shift_trade_requests where detail like 'probe-tradeoffer%') then
    raise exception 'PROBE_SETUP: live rows already sit in the probe window (schedule_days / call_offers / call_periods / availability / time_off in 2031-05..2031-09, 2020-06 or on 2029-12-31, or a probe-tradeoffer trade) - the probe fixtures would collide';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.shift_trade_requests'::regclass and a.attname = 'accepted_by' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: shift_trade_requests.accepted_by is absent - sql/migrations/2026-10-18-trade-offer.sql is not applied';
  end if;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.shift_trade_requests'::regclass and a.attname = 'proposed_by' and not a.attisdropped)
     or not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%insert into public.call_offers%')
     or not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.trade_update_guard()') and p.prosrc like '%new.accepted_by :=%')
     or not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.trade_insert_guard()') and p.prosrc like '%new.proposed_by :=%') then
    raise exception 'PROBE_SETUP: apply_trade / trade_update_guard / trade_insert_guard is not revision y - sql/migrations/2026-10-18-trade-offer.sql is partly applied';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-tradeoffer-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, ua, u2, u3, u4, u5, u6]) as u;
  if (select count(*) from public.user_profiles where id in (u1, ua, u2, u3, u4, u5, u6)) <> 7 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set person_id = 's1', role = 'scheduler', display_name = 'probe-tradeoffer sched' where id = u1;
  update public.user_profiles set person_id = null, role = 'admin' where id = ua;
  update public.user_profiles set person_id = 's2', role = 'surgeon' where id = u2;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = u3;
  update public.user_profiles set person_id = 's4', role = 'surgeon' where id = u4;
  update public.user_profiles set person_id = 's5', role = 'surgeon' where id = u5;
  update public.user_profiles set person_id = 's6', role = 'surgeon' where id = u6;
  insert into probe_ctx values ('u1', u1::text), ('ua', ua::text), ('u2', u2::text), ('u3', u3::text), ('u4', u4::text), ('u5', u5::text), ('u6', u6::text);
  perform set_config('request.jwt.claims', '{}', true);
  -- the days (who holds what before the trades)
  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source)
  values ('2031-05-07', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-08', null, 's3', false, false, 'probe-tradeoffer'),
         ('2031-05-09', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-11', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-12', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-13', null, 's3', false, false, 'probe-tradeoffer'),
         ('2031-05-14', 's2', null, true,  false, 'probe-tradeoffer'), ('2031-05-15', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-16', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-17', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-18', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-19', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-20', 's1', null, false, false, 'probe-tradeoffer'), ('2031-05-21', null, 's3', false, false, 'probe-tradeoffer'),
         ('2031-05-22', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-23', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-24', null, 's2', false, false, 'probe-tradeoffer'), ('2031-05-25', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-05-26', 's2', null, false, false, 'probe-tradeoffer'), ('2031-05-27', null, 's2', false, false, 'probe-tradeoffer'),
         ('2031-06-20', 's2', null, false, false, 'probe-tradeoffer'), ('2031-06-21', 's2', null, false, false, 'probe-tradeoffer'),
         ('2031-08-05', 's2', null, false, false, 'probe-tradeoffer'), ('2031-09-10', 's2', null, false, false, 'probe-tradeoffer'),
         ('2020-06-10', 's2', null, false, false, 'probe-tradeoffer');
  -- the offers BEFORE the periods (OFFER_FROZEN would refuse them inside the published PA and the closed PP)
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  values ('s1', '2031-05-05', 'either',  null, 's1', 'app'), ('s2', '2031-05-06', 'backup', null, 's2', 'app'),
         ('s3', '2031-05-02', 'backup',  null, 's3', 'app'), ('s4', '2031-05-03', 'primary', null, 's4', 'app'),
         ('s6', '2031-05-04', 'backup',  null, 's6', 'app'), ('s5', '2031-07-20', 'primary', null, 's5', 'app'),
         ('s1', '2029-12-31', 'primary', null, 's1', 'app'),
         ('s4', '2031-05-22', 'backup',  'seed: probe-tradeoffer', 'scheduler', 'email-relay'),
         ('s4', '2031-05-23', 'primary', 'seed: probe-tradeoffer', 'scheduler', 'email-relay'),
         ('s4', '2031-05-24', 'either',  'seed: probe-tradeoffer', 'scheduler', 'email-relay');
  insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by)
  values ('s4', 'backup_only', 'any', '2031-05-26', '2031-05-27', 'probe-tradeoffer', 'setup', 'probe');
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by, rules_only_ids, offer_modes)
  values ('probe-tradeoffer PA', '2031-05-01', '2031-06-30', '2031-03-01', '2031-04-01', 'published', 'probe', '["s5"]', '{"s3":"exhaustive"}'),
         ('probe-tradeoffer PB', '2031-06-15', '2031-07-31', '2031-05-01', '2031-05-15', 'upcoming',  'probe', '["s6"]', '{}'),
         ('probe-tradeoffer PC', '2031-08-01', '2031-08-31', '2031-06-01', '2031-07-01', 'upcoming',  'probe', '[]', '{}'),
         ('probe-tradeoffer PP', '2020-06-01', '2029-12-31', '2020-05-01', '2020-05-15', 'upcoming',  'probe', '[]', '{}');
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
create or replace function pg_temp.off(p_person text, p_day date) returns text language sql as $$
  select coalesce((select o.role_pref || '/' || o.entered_by || '/' || o.source from public.call_offers o where o.person_id = p_person and o.day = p_day), 'none');
$$;
create or replace function pg_temp.rd(p_tid uuid, p1 text, d1 date, p2 text, d2 date) returns text language sql as $$
  select 'st=' || t.status || ' by=' || coalesce(t.proposed_by, 'null') || '/' || coalesce(t.accepted_by, 'null')
      || case when p1 is null then '' else ' o1=' || pg_temp.off(p1, d1) end
      || case when p2 is null then '' else ' o2=' || pg_temp.off(p2, d2) end
      || case when t.status = 'applied' then ' a=' || coalesce((select coalesce(a.detail ->> 'offer', 'null') || '/' || coalesce(a.detail ->> 'return_offer', 'null')
                                                                  from public.audit_log a where a.action = 'trade.apply' and a.detail ->> 'trade_id' = p_tid::text
                                                                 order by a.created_at desc limit 1), 'none') else '' end
    from public.shift_trade_requests t where t.id = p_tid;
$$;
-- a member's give (kind give, one-way): from p_from to p_to on p_day / p_role, inserted by p_by
create or replace function pg_temp.give(p_by text, p_from text, p_to text, p_day date, p_role text, p_key text) returns uuid language plpgsql as $$
declare tid uuid;
begin
  perform pg_temp.act(p_by);
  insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
  values ('give', p_from, p_to, p_day, p_role, 'pending', 'probe-tradeoffer ' || p_key) returning id into tid;
  return tid;
end $$;
create or replace function pg_temp.accept(p_by text, p_tid uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act(p_by);
  update public.shift_trade_requests set status = 'accepted', decided_at = now() where id = p_tid;
end $$;
create or replace function pg_temp.apply(p_by text, p_tid uuid) returns void language plpgsql as $$
begin
  perform pg_temp.act(p_by);
  perform public.apply_trade(p_tid);
  perform pg_temp.act('postgres');
end $$;

-- ---------- P1: as postgres - the objects as the migration leaves them
do $$ declare res text; begin
  begin
    select 'cols=' || coalesce((select string_agg(a.attname, ',' order by a.attname desc) from pg_attribute a
                                 where a.attrelid = 'public.shift_trade_requests'::regclass and a.attname in ('proposed_by', 'accepted_by') and not a.attisdropped), 'none')
        || ' definer=' || (select case when p.prosecdef then 't' else 'f' end from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' loop=' || (select case when p.prosrc like '%for leg_n, leg_pid, leg_day, leg_role in%' and p.prosrc like '%''return_offer'', wrote2%' then 't' else 'f' end
                          from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
        || ' stamps=' || case when (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.trade_insert_guard()')) like '%new.accepted_by :=%'
                               and (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.trade_update_guard()')) like '%new.proposed_by := old.proposed_by%'
                              then 't' else 'f' end
        || ' anon=' || case when has_function_privilege('anon', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
        || ' auth=' || case when has_function_privilege('authenticated', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
      into res;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('P1', res);
end $$;

-- ---------- S1-S4: the stamps are never taken from the client (one give, s2 to s3 on 2031-05-10, never applied)
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u2');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, proposed_by, accepted_by, detail)
    values ('give', 's2', 's3', '2031-05-10', 'primary', 'accepted', 's9', 's9', 'probe-tradeoffer S1') returning id into tid;
    perform pg_temp.act('postgres');
    insert into probe_ctx values ('tS', tid::text);
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S1', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    select c.v::uuid into tid from probe_ctx c where c.k = 'tS';
    perform pg_temp.act('u1');
    update public.shift_trade_requests set proposed_by = 's9', accepted_by = 's9' where id = tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    select c.v::uuid into tid from probe_ctx c where c.k = 'tS';
    perform pg_temp.act('u3');
    update public.shift_trade_requests set status = 'accepted', decided_at = now(), proposed_by = 's9', accepted_by = 's9' where id = tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S3', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    select c.v::uuid into tid from probe_ctx c where c.k = 'tS';
    perform pg_temp.act('u1');
    update public.shift_trade_requests set proposed_by = 's9', accepted_by = 's9' where id = tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S4', res);
end $$;

-- ---------- S5-S9: rows inserted already accepted, and a declined row the scheduler moves to accepted
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's2', 's3', '2031-05-28', 'primary', 'accepted', 'probe-tradeoffer S5') returning id into tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S5', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's1', 's3', '2031-05-29', 'primary', 'accepted', 'probe-tradeoffer S6') returning id into tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S6', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-30', 'primary', 'S7');
    perform pg_temp.act('u3');
    update public.shift_trade_requests set status = 'declined', decided_at = now() where id = tid;
    perform pg_temp.act('u1');
    update public.shift_trade_requests set status = 'accepted' where id = tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S7', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('postgres');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's2', 's3', '2031-06-01', 'primary', 'accepted', 'probe-tradeoffer S8') returning id into tid;
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S8', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('give', 's2', 's1', '2031-06-02', 'primary', 'accepted', 'probe-tradeoffer S9') returning id into tid;
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, null, null, null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('S9', res);
end $$;

-- ---------- A1-A11: who agreed decides, whoever applies
do $$ declare tid uuid; res text; flag text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-11', 'primary', 'A1');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.act('u3');
    perform public.apply_trade(tid);
    flag := coalesce(nullif(current_setting('silvis.claim_in_progress', true), ''), 'off');
    perform pg_temp.act('postgres');
    res := pg_temp.rd(tid, 's3', '2031-05-11', null, null) || ' flag=' || flag;
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A1', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u2');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('trade', 's2', 's3', '2031-05-12', 'primary', '2031-05-13', 'backup', 'pending', 'probe-tradeoffer A2') returning id into tid;
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u2', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-12', 's2', '2031-05-13');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)
    values ('trade', 's2', 's3', '2031-05-09', 'primary', 'pending', 'probe-tradeoffer A3') returning id into tid;
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u1', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-09', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A3', res);
end $$;
do $$ declare tid uuid; res text; m text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-14', 'primary', 'A4');
    perform pg_temp.accept('u3', tid);
    begin
      perform pg_temp.apply('u3', tid);
      m := 'applied';
    exception when others then m := case when sqlerrm like '%is locked%' then 'locked' else 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',') end;
    end;
    perform pg_temp.apply('u1', tid);
    res := 'm=' || m || ' ' || pg_temp.rd(tid, 's3', '2031-05-14', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A4', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-15', 'primary', 'A5');
    perform pg_temp.accept('u1', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-15', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A5', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-16', 'primary', 'A6');
    perform pg_temp.accept('ua', tid);
    perform pg_temp.apply('ua', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-16', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A6', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-17', 'primary', 'A7');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('ua', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-17', null, null)
        || ' upd=' || coalesce((select d.updated_by from public.schedule_days d where d.day = '2031-05-17'), 'none');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A7', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's1', '2031-05-18', 'primary', 'A8');
    perform pg_temp.accept('u1', tid);
    perform pg_temp.apply('u1', tid);
    res := pg_temp.rd(tid, 's1', '2031-05-18', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A8', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-05-19', 'primary', 'A9');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.act('u1');
    update public.shift_trade_requests set to_surgeon_id = 's4' where id = tid;
    perform pg_temp.apply('u1', tid);
    res := pg_temp.rd(tid, 's4', '2031-05-19', null, null)
        || ' held=' || coalesce((select d.primary_id from public.schedule_days d where d.day = '2031-05-19'), 'none');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A9', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('trade', 's1', 's3', '2031-05-20', 'primary', '2031-05-21', null, 'pending', 'probe-tradeoffer A10') returning id into tid;
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-20', 's1', '2031-05-21');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A10', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    perform pg_temp.act('u1');
    insert into public.shift_trade_requests (kind, from_surgeon_id, to_surgeon_id, day, role, return_day, return_role, status, detail)
    values ('trade', 's2', 's3', '2031-05-07', 'primary', '2031-05-08', 'backup', 'pending', 'probe-tradeoffer A11') returning id into tid;
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.rd(tid, 's3', '2031-05-07', 's2', '2031-05-08');
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('A11', res);
end $$;

-- ---------- R7 before the merges (the merges take s4's advisory lock too): primary onto his No primary day writes no row
do $$ declare tid uuid; res text; lk bigint := hashtext('availability:no_primary:s4')::bigint; l0 boolean; l1 boolean; begin
  begin
    l0 := exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                     and l.classid::bigint = ((lk >> 32) & 4294967295) and l.objid::bigint = (lk & 4294967295));
    tid := pg_temp.give('u2', 's2', 's4', '2031-05-26', 'primary', 'R7');
    perform pg_temp.accept('u4', tid);
    perform pg_temp.apply('u4', tid);
    l1 := exists (select 1 from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
                     and l.classid::bigint = ((lk >> 32) & 4294967295) and l.objid::bigint = (lk & 4294967295));
    res := 'lock=' || case when l0 then 't' else 'f' end || '/' || case when l1 then 't' else 'f' end || ' ' || pg_temp.rd(tid, 's4', '2031-05-26', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R7', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's4', '2031-05-27', 'backup', 'R8');
    perform pg_temp.accept('u4', tid);
    perform pg_temp.apply('u4', tid);
    res := pg_temp.rd(tid, 's4', '2031-05-27', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R8', res);
end $$;

-- ---------- M1-M3: the merge into an existing (seed-owned) offer
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's4', '2031-05-22', 'primary', 'M1');
    perform pg_temp.accept('u4', tid);
    perform pg_temp.apply('u4', tid);
    res := pg_temp.rd(tid, 's4', '2031-05-22', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M1', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's4', '2031-05-23', 'primary', 'M2');
    perform pg_temp.accept('u4', tid);
    perform pg_temp.apply('u4', tid);
    res := pg_temp.rd(tid, 's4', '2031-05-23', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's4', '2031-05-24', 'backup', 'M3');
    perform pg_temp.accept('u4', tid);
    perform pg_temp.apply('u4', tid);
    res := pg_temp.rd(tid, 's4', '2031-05-24', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('M3', res);
end $$;

-- ---------- R1-R6: receivers and days that get no row (R5: the one that does)
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's5', '2031-05-25', 'primary', 'R1');
    perform pg_temp.accept('u5', tid);
    perform pg_temp.apply('u5', tid);
    res := pg_temp.rd(tid, 's5', '2031-05-25', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R1', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's6', '2031-08-05', 'primary', 'R2');
    perform pg_temp.accept('u6', tid);
    perform pg_temp.apply('u6', tid);
    res := pg_temp.rd(tid, 's6', '2031-08-05', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R2', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's3', '2031-09-10', 'primary', 'R3');
    perform pg_temp.accept('u3', tid);
    perform pg_temp.apply('u3', tid);
    res := pg_temp.rd(tid, 's3', '2031-09-10', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R3', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's5', '2031-06-20', 'primary', 'R4');
    perform pg_temp.accept('u5', tid);
    perform pg_temp.apply('u5', tid);
    res := pg_temp.rd(tid, 's5', '2031-06-20', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R4', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's6', '2031-06-21', 'primary', 'R5');
    perform pg_temp.accept('u6', tid);
    perform pg_temp.apply('u6', tid);
    res := pg_temp.rd(tid, 's6', '2031-06-21', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R5', res);
end $$;
do $$ declare tid uuid; res text; begin
  begin
    tid := pg_temp.give('u2', 's2', 's1', '2020-06-10', 'primary', 'R6');
    perform pg_temp.accept('u1', tid);
    perform pg_temp.apply('u1', tid);
    res := pg_temp.rd(tid, 's1', '2020-06-10', null, null);
  exception when others then res := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',');
  end;
  insert into probe_results values ('R6', res);
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
