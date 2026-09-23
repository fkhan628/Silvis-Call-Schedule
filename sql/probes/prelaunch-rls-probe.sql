-- ============================================================================
-- Silvis Call Schedule - pre-launch RLS PROBE (Prompt 16 A1). Proves sql/migrations/2026-09-24-prelaunch-rls.sql on the
-- LIVE database WITHOUT PERSISTING ANYTHING - and, run BEFORE the migration, shows every hole it closes.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the file as one multi-statement
-- request through the Management API, which runs it in a single implicit transaction (observed 2026-09-22 on this
-- project: a batch ending in RAISE persists nothing); there is no BEGIN/COMMIT here on purpose. Every case records its
-- observation in a temp table (granted to authenticated AND anon, because the cases run as those roles), and the LAST
-- statement raises an exception whose message carries the collected results ('PROBE_RESULTS A1=...;END' - the ';END'
-- sentinel marks where the message stops and the CLI's own suffix begins), so the transaction - fixtures, throwaway auth
-- users, offers, periods, the contact row, the feed and audit rows - rolls back. scripts/verify-rls.sh section 10 runs
-- it, grades every case and counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/prelaunch-rls-probe.sql
--
-- Fixtures (as postgres: RLS bypassed): three throwaway auth.users probe-prelaunch-<uuid>@example.test whose
-- user_profiles rows handle_new_auth_user creates - a STRANGER (left as created: role viewer, no person_id - what a
-- self-made account is), a LINKED SURGEON (s3 Acton, role surgeon) and an ADMIN (s1, role admin - the correction path is
-- user_profiles_admin, which is admin-only; a scheduler-role account corrects nothing in Setup -> Users); one
-- office_contacts row 'probe-prelaunch' (an @example.test address, active = false: never mailed even if left behind);
-- one notifications row titled 'probe-prelaunch'; two periods in 2030-07 - 'probe prelaunch open' (7/1-7/15, offers close
-- 2030-05-20, upcoming) and 'probe prelaunch published' (7/16-7/31, offers close 2030-06-20 - in the FUTURE - flipped to
-- status published AFTER its fixture offer is in); s3's offers 7/5, 7/6 (open) and 7/20 (published), all note
-- 'probe-prelaunch'. 2030-07-21 is left alone (verify-rls.sh 8c's own-row day). Acting as a user = SET LOCAL ROLE
-- authenticated + request.jwt.claims.sub (what PostgREST sets; auth.uid() reads it); anon = SET LOCAL ROLE anon.
--
-- Cases - the string each one reads AFTER the migration, and BEFORE it (the hole the migration closes):
--   S1  stranger reads user_profiles         AFTER  own=1 leak=0 sched_ok=t
--                                            BEFORE own=1 leak=N sched_ok=t  (N >= 1: the surgeon's row at least)
--         own = own row visible; leak = other rows whose role is not admin / scheduler; sched_ok = at least one
--         admin / scheduler row visible (the rows schedulerIdsLoud needs)
--   S2  stranger reads office_contacts       AFTER  contacts=0                BEFORE contacts=1
--   S3  stranger inserts a notification      AFTER  ERR 42501 new row violates row-level security policy for table "notifications"
--                                            BEFORE inserted (NO refusal)
--   S4  stranger inserts an audit row        AFTER  ERR 42501 new row violates row-level security policy for table "audit_log"
--                                            BEFORE inserted (NO refusal)
--   L1  surgeon reads user_profiles          AFTER  own=1 leak=0 sched_ok=t  BEFORE own=1 leak=N sched_ok=t (the stranger's row at least)
--   L2  surgeon reads office_contacts        AFTER  contacts=0                BEFORE contacts=1
--   L3  surgeon inserts a notification       AFTER  ok                        BEFORE ok
--   L4  surgeon audit row, actor_id = s3     AFTER  ok                        BEFORE ok
--   L5  surgeon audit row, actor_id = s2     AFTER  ERR 42501 new row violates row-level security policy for table "audit_log"
--                                            BEFORE inserted (NO refusal)
--   L6  surgeon changes his own email        AFTER  ERR 42501 new row violates row-level security policy for table "user_profiles"
--                                            BEFORE updated=1
--   L7  surgeon changes his own display_name AFTER  updated=1                 BEFORE updated=1
--   L8  surgeon deletes the fixture notification
--                                            AFTER  deleted=0 (no delete policy for him: RLS is silent)   BEFORE deleted=0
--   L9  surgeon moves his 7/5 offer to 7/7   AFTER  ERR OF004 OFFER_IMMUTABLE: an offer keeps its day and person (s3 2030-07-05) - clear it and offer the other day instead
--                                            BEFORE updated=1
--   L10 surgeon re-points his 7/6 offer to s2
--                                            AFTER  ERR OF004 OFFER_IMMUTABLE: an offer keeps its day and person (s3 2030-07-06) - clear it and offer the other day instead
--                                            BEFORE ERR 42501 new row violates row-level security policy for table "call_offers" (the with-check already refused it; the trigger now fires first)
--   L11 surgeon sets role_pref only on 7/6   AFTER  updated=1                 BEFORE updated=1
--   L12 surgeon inserts 7/25 (published period, close date still ahead)
--                                            AFTER  ERR OF003 OFFER_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler
--                                            BEFORE ok rows=1
--   L13 surgeon deletes his 7/20 offer (published period)
--                                            AFTER  ERR OF003 OFFER_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler
--                                            BEFORE deleted=1
--   L14 surgeon inserts 7/10 (open period)   AFTER  ok rows=1                 BEFORE ok rows=1
--   L15 surgeon set_offer_mode on the published period (control: OM005 was already status-aware)
--                                            AFTER  ERR OM005 MODE_FROZEN: offers for probe prelaunch published closed on 2030-06-20 - ask the scheduler
--                                            BEFORE the same
--   A1  admin reads user_profiles            AFTER  own=1 sees_surgeon=1 sees_stranger=1   BEFORE the same
--   A2  admin reads office_contacts          AFTER  contacts=1                BEFORE contacts=1
--   A3  admin inserts a notification, then deletes every 'probe-prelaunch' one
--                                            AFTER  ok deleted=3 (the fixture, L3's and his own)   BEFORE ok deleted=0 (nobody could delete)
--   A4  admin audit row, actor_id = s2       AFTER  ok                        BEFORE ok
--   A5  admin corrects the surgeon's email   AFTER  updated=1                 BEFORE updated=1
--   A6  admin moves the surgeon's 7/6 offer to 7/8
--                                            AFTER  updated=1                 BEFORE updated=1
--   A7  admin inserts 7/27 for s3 (published period)
--                                            AFTER  ok rows=1                 BEFORE ok rows=1
--   N1  anon calls offer_status(open period, s3)
--                                            AFTER  ERR 42501 permission denied for function offer_status
--                                            BEFORE status=not_started
-- (only ';' inside error text is replaced by ',' so the message splits on ';'; verify-rls.sh grades every key)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed)
do $$
declare
  stranger uuid := gen_random_uuid();
  surgeon  uuid := gen_random_uuid();
  admin_u  uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', stranger, 'authenticated', 'authenticated', 'probe-prelaunch-' || stranger || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', surgeon, 'authenticated', 'authenticated', 'probe-prelaunch-' || surgeon || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', admin_u, 'authenticated', 'authenticated', 'probe-prelaunch-' || admin_u || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false);
  update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'admin'   where id = admin_u;
  if (select count(*) from public.user_profiles where id in (stranger, surgeon, admin_u)) <> 3 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  if not exists (select 1 from public.user_profiles where id = stranger and role = 'viewer' and person_id is null) then
    raise exception 'PROBE_SETUP: the stranger is not an unlinked viewer';
  end if;
  insert into probe_ctx values ('stranger', stranger::text), ('surgeon', surgeon::text), ('admin', admin_u::text);
  insert into public.office_contacts (name, email, role, active) values ('probe-prelaunch', 'probe-prelaunch@example.test', 'probe', false);
  insert into public.notifications (type, title, message, data) values ('probe_prelaunch', 'probe-prelaunch', 'fixture', '{}'::jsonb);
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by)
  values ('probe prelaunch open', '2030-07-01', '2030-07-15', '2030-05-20', '2030-06-03', 'upcoming', 'probe'),
         ('probe prelaunch published', '2030-07-16', '2030-07-31', '2030-06-20', '2030-07-04', 'upcoming', 'probe');
  -- s3's fixture offers go in while both periods are still upcoming (as postgres the guards run as a non-scheduler)
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  values ('s3', '2030-07-05', 'either', 'probe-prelaunch', 's3', 'app'),
         ('s3', '2030-07-06', 'either', 'probe-prelaunch', 's3', 'app'),
         ('s3', '2030-07-20', 'either', 'probe-prelaunch', 's3', 'app');
  update public.call_periods set status = 'published' where label = 'probe prelaunch published';
  insert into probe_ctx values ('open', (select id::text from public.call_periods where label = 'probe prelaunch open')),
                               ('pub',  (select id::text from public.call_periods where label = 'probe prelaunch published'));
end $$;

-- S1-S4: as the STRANGER (viewer, no roster link)
do $$ declare u text; own int; leak int; sched int; c int; begin
  select v into u from probe_ctx where k = 'stranger';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where id = auth.uid()), count(*) filter (where id <> auth.uid() and role not in ('admin','scheduler')), count(*) filter (where role in ('admin','scheduler'))
      into own, leak, sched from public.user_profiles;
    insert into probe_results values ('S1', 'own=' || own || ' leak=' || leak || ' sched_ok=' || case when sched >= 1 then 't' else 'f' end);
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into c from public.office_contacts where name = 'probe-prelaunch';
    insert into probe_results values ('S2', 'contacts=' || c);
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notifications (type, title, message, data) values ('probe_prelaunch', 'probe-prelaunch', 'stranger', '{}'::jsonb);
    insert into probe_results values ('S3', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values (u, 'probe stranger', 'probe.prelaunch', '{}'::jsonb);
    insert into probe_results values ('S4', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- L1-L15: as the LINKED SURGEON (s3)
do $$ declare u text; pub text; own int; leak int; sched int; c int; n int; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v into pub from probe_ctx where k = 'pub';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where id = auth.uid()), count(*) filter (where id <> auth.uid() and role not in ('admin','scheduler')), count(*) filter (where role in ('admin','scheduler'))
      into own, leak, sched from public.user_profiles;
    insert into probe_results values ('L1', 'own=' || own || ' leak=' || leak || ' sched_ok=' || case when sched >= 1 then 't' else 'f' end);
  exception when others then insert into probe_results values ('L1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into c from public.office_contacts where name = 'probe-prelaunch';
    insert into probe_results values ('L2', 'contacts=' || c);
  exception when others then insert into probe_results values ('L2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notifications (type, title, message, data) values ('probe_prelaunch', 'probe-prelaunch', 'surgeon', '{}'::jsonb);
    insert into probe_results values ('L3', 'ok');
  exception when others then insert into probe_results values ('L3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s3', 'probe surgeon', 'probe.prelaunch', '{}'::jsonb);
    insert into probe_results values ('L4', 'ok');
  exception when others then insert into probe_results values ('L4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s2', 'probe surgeon', 'probe.prelaunch', '{}'::jsonb);
    insert into probe_results values ('L5', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('L5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set email = 'probe-prelaunch-changed@example.test' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('L6', 'updated=' || n);
  exception when others then insert into probe_results values ('L6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe prelaunch' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('L7', 'updated=' || n);
  exception when others then insert into probe_results values ('L7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.notifications where title = 'probe-prelaunch' and message = 'fixture';
    get diagnostics n = row_count;
    insert into probe_results values ('L8', 'deleted=' || n);
  exception when others then insert into probe_results values ('L8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set day = '2030-07-07' where person_id = 's3' and day = '2030-07-05';
    get diagnostics n = row_count;
    insert into probe_results values ('L9', 'updated=' || n);
  exception when others then insert into probe_results values ('L9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set person_id = 's2' where person_id = 's3' and day = '2030-07-06';
    get diagnostics n = row_count;
    insert into probe_results values ('L10', 'updated=' || n);
  exception when others then insert into probe_results values ('L10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set role_pref = 'backup' where person_id = 's3' and day = '2030-07-06';
    get diagnostics n = row_count;
    insert into probe_results values ('L11', 'updated=' || n);
  exception when others then insert into probe_results values ('L11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source) values ('s3', '2030-07-25', 'either', 'probe-prelaunch', 's3', 'app');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-07-25';
    insert into probe_results values ('L12', 'ok rows=' || n);
  exception when others then insert into probe_results values ('L12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.call_offers where person_id = 's3' and day = '2030-07-20';
    get diagnostics n = row_count;
    insert into probe_results values ('L13', 'deleted=' || n);
  exception when others then insert into probe_results values ('L13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source) values ('s3', '2030-07-10', 'either', 'probe-prelaunch', 's3', 'app');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-07-10';
    insert into probe_results values ('L14', 'ok rows=' || n);
  exception when others then insert into probe_results values ('L14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.set_offer_mode(pub::uuid, 'preferred');
    insert into probe_results values ('L15', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('L15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A7: as the ADMIN (s1)
do $$ declare a text; u text; s text; own int; ss int; st int; c int; n int; begin
  select v into a from probe_ctx where k = 'admin';
  select v into u from probe_ctx where k = 'surgeon';
  select v into s from probe_ctx where k = 'stranger';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    select count(*) filter (where id = auth.uid()), count(*) filter (where id = u::uuid), count(*) filter (where id = s::uuid)
      into own, ss, st from public.user_profiles;
    insert into probe_results values ('A1', 'own=' || own || ' sees_surgeon=' || ss || ' sees_stranger=' || st);
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into c from public.office_contacts where name = 'probe-prelaunch';
    insert into probe_results values ('A2', 'contacts=' || c);
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notifications (type, title, message, data) values ('probe_prelaunch', 'probe-prelaunch', 'admin', '{}'::jsonb);
    delete from public.notifications where title = 'probe-prelaunch';
    get diagnostics n = row_count;
    insert into probe_results values ('A3', 'ok deleted=' || n);
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.audit_log (actor_id, actor_name, action, detail) values ('s2', 'probe admin', 'probe.prelaunch', '{}'::jsonb);
    insert into probe_results values ('A4', 'ok');
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set email = 'probe-prelaunch-fixed@example.test' where id = u::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('A5', 'updated=' || n);
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set day = '2030-07-08' where person_id = 's3' and day = '2030-07-06';
    get diagnostics n = row_count;
    insert into probe_results values ('A6', 'updated=' || n);
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source) values ('s3', '2030-07-27', 'either', 'probe-prelaunch', 'scheduler', 'email-relay');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-07-27';
    insert into probe_results values ('A7', 'ok rows=' || n);
  exception when others then insert into probe_results values ('A7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1: as anon, offer_status() must not be callable at all (before the migration it runs under anon's RLS and reads not_started)
do $$ declare o text; st text; begin
  select v into o from probe_ctx where k = 'open';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select public.offer_status(o::uuid, 's3') into st;
    insert into probe_results values ('N1', 'status=' || st);
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
