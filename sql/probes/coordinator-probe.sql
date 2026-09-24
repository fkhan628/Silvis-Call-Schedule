-- ============================================================================
-- Silvis Call Schedule - COORDINATOR ROLE PROBE (Prompt 16 A7). Proves sql/migrations/2026-09-24-coordinator-role.sql on
-- the LIVE database WITHOUT PERSISTING ANYTHING - and, run BEFORE the migration, shows what the office cannot yet do.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the file as one multi-statement
-- request through the Management API, which runs it in a single implicit transaction (observed 2026-09-22 on this
-- project: a batch ending in RAISE persists nothing); there is no BEGIN/COMMIT here on purpose. Every case records its
-- observation in a temp table (granted to authenticated AND anon, because the cases run as those roles), and the LAST
-- statement raises an exception whose message carries the collected results ('PROBE_RESULTS C1=...;END' - the ';END'
-- sentinel marks where the message stops and the CLI's own suffix begins), so the transaction - fixtures, throwaway
-- auth users, the schedule day, offers, periods, vacations, availability, audit and feed rows - rolls back.
-- scripts/verify-rls.sh section 11 runs it, grades every case and counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/coordinator-probe.sql
--
-- Fixtures (as postgres: RLS bypassed): three throwaway auth.users probe-coord-<uuid>@example.test whose user_profiles
-- rows handle_new_auth_user creates - a COORDINATOR (role coordinator, no person_id: BEFORE the migration this update
-- is refused by the role check and the setup raises PROBE_SETUP, which is the BEFORE picture of the whole file), a
-- LINKED SURGEON (s3 Acton, role surgeon) and an ADMIN (s1, role admin - a scheduler to silvis_is_sched(), the
-- correction path for user_profiles); one schedule_days row 2030-08-10 (primary s3, source 'probe-coord'); two periods
-- in 2030-08 - 'probe coord open' (8/1-8/15, offers close 2030-06-20, upcoming) and 'probe coord published' (8/16-8/31,
-- offers close 2030-07-20 - in the FUTURE - flipped to status published AFTER its fixture offer is in); s3's fixture
-- offers 8/7 (open) and 8/22 (published), note 'probe-coord'; one audit row action 'timeoff.add', actor s1, detail
-- {"probe":"probe-coord"} (the row a coordinator must NOT read). Acting as a user = SET LOCAL ROLE authenticated +
-- request.jwt.claims.sub (what PostgREST sets; auth.uid() reads it).
--
-- Cases - the string each one reads AFTER the migration (BEFORE it the setup raises PROBE_SETUP: no coordinator role):
--   C1  coordinator adds s3's vacation 8/3-8/4         ok created_by=self        (created_by = auth.uid()::text)
--   C2  coordinator moves its end to 8/5                updated=1
--   C3  coordinator deletes it                          deleted=1
--   C4  coordinator adds s3's vacation over 8/10 (published primary)
--                                                       ERR P0001 ON_CALL_CONFLICT: s3 is on call 08/10 (primary)
--   C5  coordinator writes an availability row for s3   ok
--   C6  coordinator save_offers('s3', [8/5 either])     ok entered_by=self source=office-relay
--   C7  coordinator inserts s3's 8/6 offer directly     ERR 42501 new row violates row-level security policy for table "call_offers"
--   C8  coordinator set_offer_mode(open, preferred, s3) ok mode=preferred
--   C9  coordinator set_offer_mode(published, ...)      ERR OM005 MODE_FROZEN: offers for probe coord published closed on 2030-07-20 - ask the scheduler
--   C10 coordinator save_offers('s3', [8/20 either]) (published period)
--                                                       ERR OF003 OFFER_FROZEN: offers for probe coord published closed on 2030-07-20 - ask the scheduler
--   C11 coordinator updates schedule_days 8/10          updated=0   (no policy: RLS is silent)
--   C12 coordinator updates call_schedule_data 'main'   updated=0
--   C13 coordinator inserts a call_periods row          ERR 42501 new row violates row-level security policy for table "call_periods"
--   C14 coordinator inserts a trade                     ERR P0001 TRADE_FORBIDDEN: your account is not linked to a roster entry   (the BEFORE INSERT guard fires first; RLS would refuse next)
--   C15 coordinator changes its own display_name        updated=1
--   C16 coordinator changes its own role to scheduler   ERR 42501 new row violates row-level security policy for table "user_profiles"
--   C17 coordinator reads user_profiles                 own=1 leak=0 sched_ok=t  (the surgeon's row stays invisible)
--   C18 coordinator audit row, actor_id = own uid       ok
--   C19 coordinator audit row, actor_id = s3            ERR 42501 new row violates row-level security policy for table "audit_log"
--   C20 coordinator inserts a notification              ok
--   C21 coordinator reads audit_log                     own_family=1 others=0 own_other=0
--         own_family = its own 'timeoff.add' row (C18b) visible; others = the fixture's s1 row (invisible); own_other = its own 'probe.coord' row (outside the families: invisible)
--   C22 coordinator UPDATEs s3's 8/7 offer directly     updated=0
--   C23 coordinator DELETEs s3's 8/7 offer directly     deleted=0
--   C24 coordinator inserts a snapshot                  ERR 42501 new row violates row-level security policy for table "call_schedule_snapshots"
--   C25 coordinator reads office_contacts               contacts=0  (no row is inserted; the count over the whole table must be 0)
--   C26 coordinator save_offers('zz', [8/5 either])     ERR OS004 OFFERS_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only
--   C27 coordinator set_offer_mode(open, preferred, zz) ERR OM007 MODE_UNKNOWN_PERSON: zz is not a roster id - the office relays for a roster surgeon only
--         (C26 / C27: call_offers.person_id has no foreign key - the office may relay for the live roster in call_schedule_data 'main' only; the scheduler's relay is not checked)
--   L1  surgeon adds his own vacation 8/12              ok           (unchanged)
--   L2  surgeon inserts his own 8/8 offer directly      ok rows=1    (RLS unchanged for surgeons)
--   L3  surgeon reads audit_log                         visible=0    (no read policy for him)
--   A1  admin save_offers('s3', [8/9 either])           ok entered_by=scheduler source=email-relay   (the scheduler's relay is unchanged)
--   A2  admin set_offer_mode(published, preferred, s3)  ok           (never frozen)
--   A3  admin links the coordinator to s2               ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_coordinator_unlinked"
-- (only ';' inside error text is replaced by ',' so the message splits on ';'; verify-rls.sh grades every key)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed)
do $$
declare
  coord   uuid := gen_random_uuid();
  surgeon uuid := gen_random_uuid();
  admin_u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', coord, 'authenticated', 'authenticated', 'probe-coord-' || coord || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', surgeon, 'authenticated', 'authenticated', 'probe-coord-' || surgeon || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', admin_u, 'authenticated', 'authenticated', 'probe-coord-' || admin_u || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false);
  if (select count(*) from public.user_profiles where id in (coord, surgeon, admin_u)) <> 3 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  begin
    update public.user_profiles set role = 'coordinator', display_name = 'probe office' where id = coord;
  exception when check_violation then
    raise exception 'PROBE_SETUP: the role check refuses coordinator - sql/migrations/2026-09-24-coordinator-role.sql is not applied (this is the BEFORE picture)';
  end;
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'admin'   where id = admin_u;
  insert into probe_ctx values ('coord', coord::text), ('surgeon', surgeon::text), ('admin', admin_u::text);
  insert into public.schedule_days (day, primary_id, backup_id, source, note) values ('2030-08-10', 's3', null, 'probe-coord', 'probe-coord');
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by)
  values ('probe coord open', '2030-08-01', '2030-08-15', '2030-06-20', '2030-07-04', 'upcoming', 'probe'),
         ('probe coord published', '2030-08-16', '2030-08-31', '2030-07-20', '2030-08-03', 'upcoming', 'probe');
  -- s3's fixture offers go in while both periods are still upcoming (as postgres the guards run as a non-scheduler)
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  values ('s3', '2030-08-07', 'either', 'probe-coord', 's3', 'app'),
         ('s3', '2030-08-22', 'either', 'probe-coord', 's3', 'app');
  update public.call_periods set status = 'published' where label = 'probe coord published';
  insert into public.audit_log (actor_id, actor_name, action, detail) values ('s1', 'probe admin', 'timeoff.add', '{"probe":"probe-coord"}'::jsonb);
  insert into probe_ctx values ('open', (select id::text from public.call_periods where label = 'probe coord open')),
                               ('pub',  (select id::text from public.call_periods where label = 'probe coord published'));
end $$;

-- C1-C25: as the COORDINATOR
do $$ declare u text; o text; pub text; n int; own int; leak int; sched int; c int; v text; rid uuid; begin
  select probe_ctx.v into u from probe_ctx where probe_ctx.k = 'coord';
  select probe_ctx.v into o from probe_ctx where probe_ctx.k = 'open';
  select probe_ctx.v into pub from probe_ctx where probe_ctx.k = 'pub';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note, created_by) values ('s3', '2030-08-03', '2030-08-04', 'probe-coord', u) returning id into rid;
    select case when created_by = auth.uid()::text then 'self' else coalesce(created_by, 'null') end into v from public.time_off where id = rid;
    insert into probe_results values ('C1', 'ok created_by=' || v);
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.time_off set end_date = '2030-08-05' where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('C2', 'updated=' || n);
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.time_off where id = rid;
    get diagnostics n = row_count;
    insert into probe_results values ('C3', 'deleted=' || n);
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.time_off (person_id, start_date, end_date, note, created_by) values ('s3', '2030-08-10', '2030-08-10', 'probe-coord', u);
    insert into probe_results values ('C4', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by) values ('s3', 'prefer', 'any', '2030-08-20', '2030-08-21', 'probe-coord', 'probe-coord', u);
    insert into probe_results values ('C5', 'ok');
  exception when others then insert into probe_results values ('C5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.save_offers('s3', '[{"day":"2030-08-05","role_pref":"either","note":"probe-coord"}]'::jsonb, null);
    select 'entered_by=' || case when entered_by = auth.uid()::text then 'self' else entered_by end || ' source=' || source into v from public.call_offers where person_id = 's3' and day = '2030-08-05';
    insert into probe_results values ('C6', 'ok ' || coalesce(v, 'no row'));
  exception when others then insert into probe_results values ('C6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source) values ('s3', '2030-08-06', 'either', 'probe-coord', u, 'office-relay');
    insert into probe_results values ('C7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select (public.set_offer_mode(o::uuid, 'preferred', 's3')) ->> 'mode' into v;
    insert into probe_results values ('C8', 'ok mode=' || v);
  exception when others then insert into probe_results values ('C8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.set_offer_mode(pub::uuid, 'preferred', 's3');
    insert into probe_results values ('C9', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('C9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.save_offers('s3', '[{"day":"2030-08-20","role_pref":"either","note":"probe-coord"}]'::jsonb, null);
    insert into probe_results values ('C10', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('C10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.schedule_days set note = 'probe-coord touched' where day = '2030-08-10';
    get diagnostics n = row_count;
    insert into probe_results values ('C11', 'updated=' || n);
  exception when others then insert into probe_results values ('C11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_schedule_data set updated_by = 'probe-coord' where id = 'main';
    get diagnostics n = row_count;
    insert into probe_results values ('C12', 'updated=' || n);
  exception when others then insert into probe_results values ('C12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by) values ('probe coord rogue', '2030-08-01', '2030-08-02', '2030-06-01', '2030-06-15', 'upcoming', u);
    insert into probe_results values ('C13', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.shift_trade_requests (from_surgeon_id, to_surgeon_id, day, role, detail) values ('s3', 's2', '2030-08-10', 'primary', 'probe coord');
    insert into probe_results values ('C14', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe office renamed' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('C15', 'updated=' || n);
  exception when others then insert into probe_results values ('C15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set role = 'scheduler' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('C16', 'updated=' || n);
  exception when others then insert into probe_results values ('C16', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where id = auth.uid()), count(*) filter (where id <> auth.uid() and role not in ('admin','scheduler')), count(*) filter (where role in ('admin','scheduler'))
      into own, leak, sched from public.user_profiles;
    insert into probe_results values ('C17', 'own=' || own || ' leak=' || leak || ' sched_ok=' || case when sched >= 1 then 't' else 'f' end);
  exception when others then insert into probe_results values ('C17', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe office', 'probe.coord', '{}'::jsonb);
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe office', 'timeoff.add', '{"probe":"probe-coord"}'::jsonb);
    insert into probe_results values ('C18', 'ok');
  exception when others then insert into probe_results values ('C18', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe office', 'probe.coord', '{}'::jsonb);
    insert into probe_results values ('C19', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C19', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notifications (type, title, message, data) values ('probe_coord', 'probe-coord', 'coordinator', '{}'::jsonb);
    insert into probe_results values ('C20', 'ok');
  exception when others then insert into probe_results values ('C20', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where actor_id = auth.uid()::text and action = 'timeoff.add'), count(*) filter (where actor_id <> auth.uid()::text), count(*) filter (where actor_id = auth.uid()::text and action = 'probe.coord')
      into own, leak, c from public.audit_log where action = 'probe.coord' or detail ->> 'probe' = 'probe-coord';
    insert into probe_results values ('C21', 'own_family=' || own || ' others=' || leak || ' own_other=' || c);
  exception when others then insert into probe_results values ('C21', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set role_pref = 'backup' where person_id = 's3' and day = '2030-08-07';
    get diagnostics n = row_count;
    insert into probe_results values ('C22', 'updated=' || n);
  exception when others then insert into probe_results values ('C22', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_offers where person_id = 's3' and day = '2030-08-07';
    get diagnostics n = row_count;
    insert into probe_results values ('C23', 'deleted=' || n);
  exception when others then insert into probe_results values ('C23', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_schedule_snapshots (reason, data, created_by) values ('probe-coord', '{}'::jsonb, u);
    insert into probe_results values ('C24', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('C24', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into c from public.office_contacts;
    insert into probe_results values ('C25', 'contacts=' || c);
  exception when others then insert into probe_results values ('C25', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.save_offers('zz', '[{"day":"2030-08-05","role_pref":"either","note":"probe-coord"}]'::jsonb, null);
    insert into probe_results values ('C26', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('C26', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.set_offer_mode(o::uuid, 'preferred', 'zz');
    insert into probe_results values ('C27', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('C27', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- L1-L3: as the LINKED SURGEON (s3) - controls: nothing changed for him
do $$ declare u text; n int; begin
  select probe_ctx.v into u from probe_ctx where probe_ctx.k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.time_off (person_id, start_date, end_date, note, created_by) values ('s3', '2030-08-12', '2030-08-12', 'probe-coord', 's3');
    insert into probe_results values ('L1', 'ok');
  exception when others then insert into probe_results values ('L1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source) values ('s3', '2030-08-08', 'either', 'probe-coord', 's3', 'app');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-08-08';
    insert into probe_results values ('L2', 'ok rows=' || n);
  exception when others then insert into probe_results values ('L2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.audit_log where action = 'probe.coord' or detail ->> 'probe' = 'probe-coord';
    insert into probe_results values ('L3', 'visible=' || n);
  exception when others then insert into probe_results values ('L3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A3: as the ADMIN (s1) - the scheduler's relay is unchanged; a coordinator cannot be linked
do $$ declare a text; c text; pub text; v text; begin
  select probe_ctx.v into a from probe_ctx where probe_ctx.k = 'admin';
  select probe_ctx.v into c from probe_ctx where probe_ctx.k = 'coord';
  select probe_ctx.v into pub from probe_ctx where probe_ctx.k = 'pub';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.save_offers('s3', '[{"day":"2030-08-09","role_pref":"either","note":"probe-coord"}]'::jsonb, null);
    select 'entered_by=' || entered_by || ' source=' || source into v from public.call_offers where person_id = 's3' and day = '2030-08-09';
    insert into probe_results values ('A1', 'ok ' || coalesce(v, 'no row'));
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.set_offer_mode(pub::uuid, 'preferred', 's3');
    insert into probe_results values ('A2', 'ok');
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set person_id = 's2' where id = c::uuid;
    insert into probe_results values ('A3', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
