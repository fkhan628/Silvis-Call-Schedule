-- ============================================================================
-- Silvis Call Schedule - east_vacation_reviews PROBE (Prompt 15 part 2). Proves the table's
-- RLS and constraints on the LIVE database WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the trade and claim probes: run the whole file as ONE batch through the
-- linked Supabase CLI (the Management API runs it in a single implicit transaction; there is
-- no BEGIN/COMMIT here on purpose). Every case records its observation in a temp table and
-- the LAST statement raises an exception whose message carries the results
-- ('PROBE_RESULTS A1=...;A2=...;END' - the ';END' sentinel marks where the CLI's own suffix
-- begins), so the fixtures, the throwaway auth users and every row a case wrote roll back.
-- After every run verify-rls.sh section 9 counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-vacation-reviews-probe.sql
--   (scripts/verify-rls.sh section 9 runs it, grades each case and checks nothing persisted)
--
-- Fixtures live in 2030-05 and use the live roster ids s2 (Burchett) and s3 (Acton); the
-- acting users are throwaway auth.users rows created here (email
-- probe-eastvac-<uuid>@example.test) whose user_profiles rows the handle_new_auth_user
-- trigger creates; they are then linked to person_id s3 (surgeon) / s1 (scheduler). Acting
-- as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub = that uuid (auth.uid()
-- reads request.jwt.claims -> sub, exactly what PostgREST sets); anon = SET LOCAL ROLE anon
-- with no sub. Every fixture row carries decided_by 'probe-eastvac' (the leftover count keys
-- on it). Errors are recorded as 'ERR <SQLSTATE> <message>'.
--
-- Cases and expectations (AFTER the migration; BEFORE it every case reads
-- 'ERR 42P01 relation "public.east_vacation_reviews" does not exist' and the setup raises PROBE_SETUP)
--   A1 anon reads the table while two fixture rows exist      -> A1=rows=0          (RLS: silent, not an error)
--   A2 anon inserts a row                                      -> A2=ERR 42501 new row violates row-level security policy ...
--   B  surgeon (s3) inserts a row for HIMSELF, then reads all  -> B=ok visible=3     (read-all for authenticated: s2's row too)
--   C  surgeon (s3) inserts a row for s2                       -> C=ERR 42501 ...
--   D  surgeon (s3) updates s2's row (decision home -> away)   -> D=updated=0 decision=home   (USING filters it out silently)
--   E  surgeon (s3) deletes s2's row                           -> E=deleted=0
--   F  surgeon (s3) updates his OWN fixture row (away -> home) -> F=updated=1 decision=home
--   G  scheduler updates s2's row and deletes s3's B row       -> G=updated=1 decision=away deleted=1
--   H  check constraint: decision 'maybe' (as postgres)        -> H=ERR 23514 ...
--   I  unique (person_id, start, end): a duplicate (postgres)  -> I=ERR 23505 ...
--   J  end before start (as postgres)                          -> J=ERR 23514 ...
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- fixtures (as postgres: RLS bypassed)
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
            'probe-eastvac-' || u::text || '@example.test', '', now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
            '', '', '', '', false);
  end loop;
  update public.user_profiles set person_id = 's3', role = 'surgeon'   where id = surgeon;
  update public.user_profiles set person_id = 's1', role = 'scheduler' where id = sched;
  if (select count(*) from public.user_profiles where id in (surgeon, sched)) <> 2 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  insert into probe_ctx values ('surgeon', surgeon::text), ('sched', sched::text);

  insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
  values ('s3', '2030-05-06', '2030-05-08', 'away', 'probe-eastvac'),
         ('s2', '2030-05-13', '2030-05-15', 'home', 'probe-eastvac');
  if (select count(*) from public.east_vacation_reviews where decided_by = 'probe-eastvac') <> 2 then
    raise exception 'PROBE_SETUP: fixture rows were not stored (was the probe run as postgres?)';
  end if;
end $$;

-- ---------- A1: anon reads (RLS: the two fixture rows are invisible, no error)
do $$
declare n int; v text;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    select count(*) into n from public.east_vacation_reviews;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);   -- no sub -> auth.uid() is null again
    v := 'rows=' || n::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;   -- the subtransaction rollback already restored the postgres role
  end;
  insert into probe_results values ('A1', v);
end $$;

-- ---------- A2: anon inserts
do $$
declare v text;
begin
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s3', '2030-05-27', '2030-05-28', 'home', 'probe-eastvac');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok (anon was allowed to insert)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('A2', v);
end $$;

-- ---------- B: surgeon inserts his own row, then reads everything
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s3', '2030-05-20', '2030-05-22', 'home', 'probe-eastvac');
    select count(*) into n from public.east_vacation_reviews where decided_by = 'probe-eastvac';
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok visible=' || n::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('B', v);
end $$;

-- ---------- C: surgeon inserts a row for someone else
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s2', '2030-05-20', '2030-05-22', 'away', 'probe-eastvac');
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'ok (a surgeon was allowed to review someone else''s range)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('C', v);
end $$;

-- ---------- D: surgeon updates someone else's row (silently no-op under RLS)
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; d text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.east_vacation_reviews set decision = 'away' where person_id = 's2' and "start" = '2030-05-13' and "end" = '2030-05-15';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select decision into d from public.east_vacation_reviews where person_id = 's2' and "start" = '2030-05-13' and "end" = '2030-05-15';
    v := 'updated=' || n::text || ' decision=' || coalesce(d, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('D', v);
end $$;

-- ---------- E: surgeon deletes someone else's row
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    delete from public.east_vacation_reviews where person_id = 's2' and "start" = '2030-05-13' and "end" = '2030-05-15';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    v := 'deleted=' || n::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('E', v);
end $$;

-- ---------- F: surgeon updates his OWN fixture row
do $$
declare
  uid text := (select v from probe_ctx where k = 'surgeon');
  n int; d text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.east_vacation_reviews set decision = 'home', decided_at = now() where person_id = 's3' and "start" = '2030-05-06' and "end" = '2030-05-08';
    get diagnostics n = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select decision into d from public.east_vacation_reviews where person_id = 's3' and "start" = '2030-05-06' and "end" = '2030-05-08';
    v := 'updated=' || n::text || ' decision=' || coalesce(d, 'null');
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('F', v);
end $$;

-- ---------- G: scheduler updates s2's row and deletes s3's B row
do $$
declare
  uid text := (select v from probe_ctx where k = 'sched');
  n int; m int; d text; v text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
    update public.east_vacation_reviews set decision = 'away' where person_id = 's2' and "start" = '2030-05-13' and "end" = '2030-05-15';
    get diagnostics n = row_count;
    delete from public.east_vacation_reviews where person_id = 's3' and "start" = '2030-05-20' and "end" = '2030-05-22';
    get diagnostics m = row_count;
    execute 'reset role';
    perform set_config('request.jwt.claims', '{}', true);
    select decision into d from public.east_vacation_reviews where person_id = 's2' and "start" = '2030-05-13' and "end" = '2030-05-15';
    v := 'updated=' || n::text || ' decision=' || coalesce(d, 'null') || ' deleted=' || m::text;
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('G', v);
end $$;

-- ---------- H: the check constraint (as postgres - RLS is not what is tested here)
do $$
declare v text;
begin
  begin
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s3', '2030-05-27', '2030-05-28', 'maybe', 'probe-eastvac');
    v := 'ok (a decision outside away/home was stored)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('H', v);
end $$;

-- ---------- I: the unique constraint (a second review of the same exact range)
do $$
declare v text;
begin
  begin
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s3', '2030-05-06', '2030-05-08', 'home', 'probe-eastvac');
    v := 'ok (a duplicate range review was stored)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('I', v);
end $$;

-- ---------- J: end before start
do $$
declare v text;
begin
  begin
    insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by)
    values ('s3', '2030-05-30', '2030-05-29', 'home', 'probe-eastvac');
    v := 'ok (an inverted range was stored)';
  exception when others then
    v := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  insert into probe_results values ('J', v);
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
