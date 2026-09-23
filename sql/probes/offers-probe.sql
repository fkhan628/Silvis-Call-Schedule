-- ============================================================================
-- Silvis Call Schedule - offers + periods PROBE (Prompt 14 part 1). Proves call_offers / call_periods,
-- offer_status(), the three guards and the RLS on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the file as one
-- multi-statement request through the Management API, which runs it in a single implicit transaction
-- (observed 2026-09-22 on this project: a batch ending in RAISE persists nothing); there is no BEGIN/COMMIT
-- here on purpose. Every case records its observation in a temp table (granted to authenticated AND anon,
-- because cases C-I run as those roles), and the LAST statement raises an exception whose message carries the
-- collected results ('PROBE_RESULTS A=...;B=...;END' - the ';END' sentinel marks where the message stops and the
-- CLI's own suffix begins), so the transaction - fixtures, throwaway auth users, offers, periods - rolls back.
-- After every run, scripts/verify-rls.sh section 8 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/offers-probe.sql
--   (scripts/verify-rls.sh section 8 runs it, grades each case and checks nothing persisted)
--
-- Fixtures: a period 'probe frozen' covering 2030-05 whose offers_close_at (2026-09-01) is already past; a period
-- 'probe modes' covering 2030-06 (case K only; its close date is far ahead); a fixture vacation of s3 on
-- 2030-06-11 (note 'probe offers'; inserted as postgres - s3 has no 2030 shifts, so the time_off trigger accepts
-- it); one throwaway surgeon user linked to s3 (Acton) and one throwaway scheduler user linked to s1, both
-- auth.users rows named probe-offers-<uuid>@example.test whose user_profiles rows handle_new_auth_user creates.
-- Acting as a user = SET LOCAL ROLE authenticated + request.jwt.claims.sub (what PostgREST sets; auth.uid()
-- reads it). The 9/22 scratch version of this probe used Acton's LIVE vacation (2026-11-19..22) for case B; the
-- repo version brings its own so it never depends on live time_off rows.
--
-- Cases and expectations (AFTER sql/migrations/2026-09-23-offer-modes.sql; before it, every K case is
-- ERR 42703 column "offer_modes" does not exist and A-J are unchanged)
--   A  postgres inserts a past day                       -> A=ERR OF001 OFFER_PAST: 2020-01-01 is before today (<today>) in Central time
--   B  postgres inserts a day inside s3's vacation        -> B=ERR OF002 OFFER_ON_VACATION: 2030-06-11 is inside a vacation of s3
--   C  the surgeon (s3) inserts an own future offer       -> C=ok rows=1
--   D  the same user inserts an offer for s2              -> D=ERR 42501 new row violates row-level security policy for table "call_offers"
--   E  the surgeon updates their own row                  -> E=ok updated=1
--   F  the surgeon inserts inside the frozen period       -> F=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler
--   G  the scheduler enters the same late offer (relay)   -> G=ok rows=1 status=submitted
--   H  the surgeon deletes inside the frozen period       -> H=ERR OF003 OFFER_FROZEN: offers for probe frozen closed on 2026-09-01 - ask the scheduler
--   I  anon reads 0 rows and cannot insert                -> I-insert=ERR 42501 new row violates row-level security policy for table "call_offers";I-read=rows=0
--   J  derived statuses                                   -> J=s2=not_started s6=rules_only s3=submitted
--   K  offer_modes: set + read back / non-object refused / absent = {}
--                                                         -> K-default=modes={};K-set=ok modes={"s2": "exhaustive"} s2=exhaustive s3=absent;
--                                                            K-type=ERR 23514 new row for relation "call_periods" violates check constraint "call_periods_offer_modes_object"
-- (values keep their double quotes; only ';' inside error text is replaced by ',' so the message splits on ';')
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed)
do $$
declare
  surgeon uuid := gen_random_uuid();
  sched   uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', surgeon, 'authenticated', 'authenticated', 'probe-offers-' || surgeon || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', sched, 'authenticated', 'authenticated', 'probe-offers-' || sched || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false);
  update public.user_profiles set person_id = 's3', role = 'surgeon'   where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'scheduler' where id = sched;
  if (select count(*) from public.user_profiles where id in (surgeon, sched)) <> 2 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('sched', sched::text);
  -- a period whose offers already froze (close date in the past) covering 2030-05
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by)
  values ('probe frozen', '2030-05-01', '2030-05-31', '2026-09-01', '2026-09-15', 'upcoming', 'probe');
  -- s3's fixture vacation for case B (no s3 shifts in 2030, so time_off_no_call_conflict accepts it)
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s3', '2030-06-11', '2030-06-11', 'probe offers', 'probe');
end $$;

-- A: as postgres, a past day -> OF001
do $$ begin
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2020-01-01', 'either', 's3', 'app');
    insert into probe_results values ('A', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('A', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;
-- B: as postgres, a day inside s3's fixture vacation (2030-06-11) -> OF002
do $$ begin
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2030-06-11', 'primary', 's3', 'app');
    insert into probe_results values ('B', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('B', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;
-- C: as the surgeon (s3), own future offer -> ok; D: same user, an offer for s2 -> RLS refusal; E: own update -> ok
do $$ declare u text; n int; begin
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2030-06-03', 'either', 's3', 'app');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-06-03';
    insert into probe_results values ('C', 'ok rows=' || n);
  exception when others then insert into probe_results values ('C', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s2', '2030-06-04', 'backup', 's3', 'app');
    insert into probe_results values ('D', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('D', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_offers set role_pref = 'backup' where person_id = 's3' and day = '2030-06-03';
    get diagnostics n = row_count;
    insert into probe_results values ('E', 'ok updated=' || n);
  exception when others then insert into probe_results values ('E', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;
-- F: as the surgeon, a day inside the frozen period -> OF003; G: the scheduler may still enter it
do $$ declare u text; s text; n int; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v into s from probe_ctx where k = 'sched';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2030-05-10', 'either', 's3', 'app');
    insert into probe_results values ('F', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('F', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2030-05-10', 'either', 'scheduler', 'email-relay');
    select count(*) into n from public.call_offers where person_id = 's3' and day = '2030-05-10';
    insert into probe_results values ('G', 'ok rows=' || n || ' status=' || public.offer_status((select id from public.call_periods where label = 'probe frozen'), 's3'));
  exception when others then insert into probe_results values ('G', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;
-- H: as the surgeon, deleting an offer inside the frozen period -> OF003 (the scheduler's row from G)
do $$ declare u text; begin
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    delete from public.call_offers where person_id = 's3' and day = '2030-05-10';
    insert into probe_results values ('H', 'deleted (NO refusal)');
  exception when others then insert into probe_results values ('H', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;
-- I: as anon, reading offers returns nothing (RLS-silent: 0 rows, no error) and inserting is refused
do $$ declare n int; begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.call_offers;
    insert into probe_results values ('I-read', 'rows=' || n);
  exception when others then insert into probe_results values ('I-read', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.call_offers (person_id, day, role_pref, entered_by, source) values ('s3', '2030-06-09', 'either', 's3', 'app');
    insert into probe_results values ('I-insert', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('I-insert', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;
-- J: derived status for a person with no offers and not rules_only -> not_started; rules_only listing -> rules_only
do $$ declare pid uuid; begin
  select id into pid from public.call_periods where label = 'probe frozen';
  update public.call_periods set rules_only_ids = '["s6"]'::jsonb where id = pid;
  insert into probe_results values ('J', 's2=' || public.offer_status(pid, 's2') || ' s6=' || public.offer_status(pid, 's6') || ' s3=' || public.offer_status(pid, 's3'));
end $$;
-- K (2026-09-23 migration): offer_modes set on insert and read back; a non-object refused by the check constraint;
-- a period inserted without the column reads as {} (absent key = 'preferred' is the CLIENT's reading of {}).
-- Before the migration every K case records ERR 42703 (column does not exist) - the probe still completes.
do $$ declare m jsonb; begin
  begin
    insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by, offer_modes)
    values ('probe modes', '2030-06-01', '2030-06-30', '2030-04-20', '2030-05-04', 'upcoming', 'probe', '{"s2":"exhaustive"}'::jsonb);
    select offer_modes into m from public.call_periods where label = 'probe modes';
    insert into probe_results values ('K-set', 'ok modes=' || m::text || ' s2=' || coalesce(m ->> 's2', 'null') || ' s3=' || coalesce(m ->> 's3', 'absent'));
  exception when others then insert into probe_results values ('K-set', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.call_periods set offer_modes = '["s2"]'::jsonb where label = 'probe modes';   -- an array is not an object -> check violation (jsonb_typeof)
    insert into probe_results values ('K-type', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('K-type', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select offer_modes into m from public.call_periods where label = 'probe frozen';
    insert into probe_results values ('K-default', 'modes=' || coalesce(m::text, 'null'));
  exception when others then insert into probe_results values ('K-default', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
