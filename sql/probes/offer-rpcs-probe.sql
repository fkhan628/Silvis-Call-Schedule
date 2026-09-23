-- ============================================================================
-- Silvis Call Schedule - offer RPCs PROBE (Prompt 14 part 3a, U3a): proves set_offer_mode() and save_offers()
-- (sql/migrations/2026-09-23-offer-mode-rpc.sql) on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanics as sql/probes/offers-probe.sql: run the whole file as ONE batch through the linked CLI (one implicit
-- transaction), every case records into a temp table, and the LAST statement raises 'PROBE_RESULTS ...;END' so the
-- fixtures, throwaway users, offers and periods all roll back. Acting as a user = SET LOCAL ROLE authenticated +
-- request.jwt.claims.sub (what PostgREST sets; auth.uid() reads it).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/offer-rpcs-probe.sql
--
-- Fixtures: period 'probe rpc open' (2030-06, close 2030-04-20 - far ahead), period 'probe rpc frozen' (2030-05, close
-- 2026-09-01 - past), a vacation of s3 on 2030-06-11 (note 'probe offers'), one throwaway surgeon user linked to s3
-- and one throwaway scheduler user linked to s1 (auth.users rows probe-offers-<uuid>@example.test).
--
-- Cases and expectations (AFTER the migration; before it, every case reads ERR 42883 function ... does not exist):
--   A  surgeon saves 2 own rows (either 6/3 with note 'seed: probe', primary 6/5 with a blank note)
--                                                                  -> A=ok upserted=2 deleted=0 by=s3 src=app rows=2 role=either note=seed: probe
--   B  surgeon saves a batch with one bad row (role 'both')        -> B=ERR OS003 OFFERS_BAD_ROW: 2030-06-07 both (...) - nothing was saved rows=2 role=either note=seed: probe
--   C  surgeon saves rows for s2                                   -> C=ERR OS002 OFFERS_NOT_YOURS: only the scheduler can save another surgeon's offers
--   D  surgeon saves 2 rows, one inside the vacation (6/11)        -> D=ERR OF002 OFFER_ON_VACATION: 2030-06-11 is inside a vacation of s3 rows=2 role=either note=seed: probe   (the good row rolled back too)
--   E  surgeon updates 6/3 -> backup (no note sent) and clears 6/5 in ONE call
--                                                                  -> E=ok upserted=1 deleted=1 rows=1 role=backup note=seed: probe   (the note survived the repaint)
--   F  surgeon sets exhaustive on the open period                  -> F=ok mode=exhaustive modes={"s3": "exhaustive"} rules_only=[]
--   G  surgeon asks rules_only while 6/3 is still offered          -> G=ERR OM006 MODE_HAS_OFFERS: s3 has 1 offered day(s) inside probe rpc open - clear them first to go by the rules
--   H  surgeon clears 6/3 then asks rules_only                     -> H=ok mode=rules_only rules_only=["s3"] modes={} status=rules_only
--   L  surgeon saves 6/20 either + mode 'x' in ONE call            -> L=ERR OM003 MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got x) rows=0 note=   (the row rolled back with the mode)
--   M  surgeon saves 6/20 either + mode exhaustive in ONE call     -> M=ok upserted=1 mode=exhaustive modes={"s3": "exhaustive"} rules_only=[] status=submitted rows=1 note=
--   I  surgeon sets preferred on the FROZEN period                 -> I=ERR OM005 MODE_FROZEN: offers for probe rpc frozen closed on 2026-09-01 - ask the scheduler
--   J  scheduler sets preferred for s3 on the frozen period, then relays one late offer for s3 inside it
--                                                                  -> J-mode=ok mode=preferred rules_only=[] ; J-save=ok upserted=1 by=scheduler src=email-relay
--   K  surgeon asks mode 'x'; anon calls save_offers               -> K-mode=ERR OM003 MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got x) ;
--                                                                     K-anon=ERR 42501 permission denied for function save_offers  (or OS001 if execute were granted)
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
  insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, created_by)
  values ('probe rpc open',   '2030-06-01', '2030-06-30', '2030-04-20', '2030-05-04', 'upcoming', 'probe'),
         ('probe rpc frozen', '2030-05-01', '2030-05-31', '2026-09-01', '2026-09-15', 'upcoming', 'probe');
  insert into public.time_off (person_id, start_date, end_date, note, created_by)
  values ('s3', '2030-06-11', '2030-06-11', 'probe offers', 'probe');
  insert into probe_ctx values ('open', (select id::text from public.call_periods where label = 'probe rpc open')),
                               ('frozen', (select id::text from public.call_periods where label = 'probe rpc frozen'));
end $$;

-- helper: rows of s3 inside June 2030 (counted as postgres between the acted cases); the 6/3 row's role and note
create or replace function pg_temp.s3_rows() returns text language sql as $$
  select 'rows=' || count(*) || coalesce(' role=' || min(role_pref) filter (where day = '2030-06-03'), '') || ' note=' || coalesce(min(note) filter (where day = '2030-06-03'), '') from public.call_offers where person_id = 's3' and day between '2030-06-01' and '2030-06-30';
$$;

-- A..E: as the surgeon (s3)
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-03","role_pref":"either","note":"seed: probe"},{"day":"2030-06-05","role_pref":"primary","note":" "}]'::jsonb, '{}'::date[]);
    insert into probe_results values ('A', 'ok upserted=' || (r->>'upserted') || ' deleted=' || (r->>'deleted') || ' by=' || (r->>'entered_by') || ' src=' || (r->>'source') || ' ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('A', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-06","role_pref":"backup"},{"day":"2030-06-07","role_pref":"both"}]'::jsonb, null);
    insert into probe_results values ('B', 'saved (NO refusal) ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('B', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',') || ' ' || pg_temp.s3_rows()); end;
  begin
    r := public.save_offers('s2', '[{"day":"2030-06-06","role_pref":"backup"}]'::jsonb, null);
    insert into probe_results values ('C', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('C', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-10","role_pref":"backup"},{"day":"2030-06-11","role_pref":"primary"}]'::jsonb, null);
    insert into probe_results values ('D', 'saved (NO refusal) ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('D', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',') || ' ' || pg_temp.s3_rows()); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-03","role_pref":"backup"}]'::jsonb, '{2030-06-05}'::date[]);
    insert into probe_results values ('E', 'ok upserted=' || (r->>'upserted') || ' deleted=' || (r->>'deleted') || ' ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('E', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- F..I: modes as the surgeon
do $$ declare u text; o uuid; f uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v::uuid into o from probe_ctx where k = 'open';
  select v::uuid into f from probe_ctx where k = 'frozen';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.set_offer_mode(o, 'exhaustive');
    insert into probe_results values ('F', 'ok mode=' || (r->>'mode') || ' modes=' || (r->'offer_modes')::text || ' rules_only=' || (r->'rules_only_ids')::text);
  exception when others then insert into probe_results values ('F', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.set_offer_mode(o, 'rules_only');
    insert into probe_results values ('G', 'set (NO refusal) ' || r::text);
  exception when others then insert into probe_results values ('G', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    perform public.save_offers('s3', '[]'::jsonb, '{2030-06-03}'::date[]);
    r := public.set_offer_mode(o, 'rules_only');
    insert into probe_results values ('H', 'ok mode=' || (r->>'mode') || ' rules_only=' || (r->'rules_only_ids')::text || ' modes=' || (r->'offer_modes')::text || ' status=' || public.offer_status(o, 's3'));
  exception when others then insert into probe_results values ('H', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  -- L / M: days + mode in ONE call (the painter's combined Save) - a refused mode rolls the rows back too
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-20","role_pref":"either"}]'::jsonb, null, o, 'x');
    insert into probe_results values ('L', 'saved (NO refusal) ' || r::text || ' ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('L', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',') || ' ' || pg_temp.s3_rows()); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-20","role_pref":"either"}]'::jsonb, null, o, 'exhaustive');
    insert into probe_results values ('M', 'ok upserted=' || (r->>'upserted') || ' mode=' || (r->>'mode') || ' modes=' || (select offer_modes::text from public.call_periods where id = o) || ' rules_only=' || (select rules_only_ids::text from public.call_periods where id = o) || ' status=' || public.offer_status(o, 's3') || ' ' || pg_temp.s3_rows());
  exception when others then insert into probe_results values ('M', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',') || ' ' || pg_temp.s3_rows()); end;
  begin
    r := public.set_offer_mode(f, 'preferred');
    insert into probe_results values ('I', 'set (NO refusal) ' || r::text);
  exception when others then insert into probe_results values ('I', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- J: the scheduler on the frozen period, for s3
do $$ declare s text; f uuid; r jsonb; begin
  select v into s from probe_ctx where k = 'sched';
  select v::uuid into f from probe_ctx where k = 'frozen';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    r := public.set_offer_mode(f, 'preferred', 's3');
    insert into probe_results values ('J-mode', 'ok mode=' || (r->>'mode') || ' rules_only=' || (r->'rules_only_ids')::text);
  exception when others then insert into probe_results values ('J-mode', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_offers('s3', '[{"day":"2030-05-10","role_pref":"either"}]'::jsonb, null);
    insert into probe_results values ('J-save', 'ok upserted=' || (r->>'upserted') || ' by=' || (r->>'entered_by') || ' src=' || (r->>'source'));
  exception when others then insert into probe_results values ('J-save', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- K: a bad mode word (surgeon); anon cannot call save_offers at all
do $$ declare u text; o uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'surgeon';
  select v::uuid into o from probe_ctx where k = 'open';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.set_offer_mode(o, 'x');
    insert into probe_results values ('K-mode', 'set (NO refusal) ' || r::text);
  exception when others then insert into probe_results values ('K-mode', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    r := public.save_offers('s3', '[{"day":"2030-06-20","role_pref":"either"}]'::jsonb, null);
    insert into probe_results values ('K-anon', 'saved (NO refusal) ' || r::text);
  exception when others then insert into probe_results values ('K-anon', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
