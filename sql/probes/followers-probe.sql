-- ============================================================================
-- Silvis Call Schedule - FOLLOWERS PROBE (Prompt 20 F1). Proves sql/migrations/2026-09-24-followers.sql on the LIVE database
-- WITHOUT PERSISTING ANYTHING - and, run BEFORE the migration, reports the notification_preferences row count it must keep.
--
-- How it works: run the whole file as ONE batch. With --linked the Supabase CLI submits the file as one multi-statement
-- request through the Management API, which runs it in a single implicit transaction (observed 2026-09-22 on this
-- project: a batch ending in RAISE persists nothing); there is no BEGIN/COMMIT here on purpose. Every case records its
-- observation in a temp table (granted to authenticated, because the cases run as that role), and the LAST statement
-- raises an exception whose message carries the collected results ('PROBE_RESULTS F1=...;END' - the ';END' sentinel marks
-- where the message stops and the CLI's own suffix begins), so the transaction - throwaway auth users, their profile rows,
-- the prefs rows - rolls back. scripts/verify-rls.sh section 12 runs it, grades every case and counts leftovers (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/followers-probe.sql
--
-- BEFORE the migration the first block raises
--   PROBE_SETUP: user_profiles.follows / notification_preferences.profile_id are absent - ... (this is the BEFORE picture) - notification_preferences rows=N
-- (N = the rows the migration must keep; verify-rls.sh prints it). Right AFTER it, R1 reports rows=N person=N profile=0 ids=N with
-- the same N: every existing row survived the key move, kept its person_id and got an id of its own. R1 counts every live row, so
-- once a follower saves prefs it reads e.g. rows=N+1 person=N profile=1 ids=N+1: verify-rls.sh (grade_r1_12) grades the lasting
-- invariants ids = rows and person + profile = rows on every run, and the strict picture only on the apply-time run
-- (SILVIS_PREFS_ROWS_BEFORE=N set: profile=0 and person=N).
--
-- Fixtures (as postgres: RLS bypassed): four throwaway auth.users probe-follow-<uuid>@example.test whose user_profiles rows
-- handle_new_auth_user creates - a FOLLOWER (viewer, unlinked), a SECOND FOLLOWER (viewer, unlinked), a SURGEON linked to the
-- NON-roster id 'probe-follow' (so no live prefs row is touched, even inside this rolled-back batch) and an ADMIN (unlinked;
-- silvis_role() = 'admin', the Setup > Users write path); two prefs rows - the surgeon's (person_id 'probe-follow') and the
-- second follower's (profile_id). Acting as a user = SET LOCAL ROLE authenticated + request.jwt.claims.sub (what PostgREST
-- sets; auth.uid() reads it).
--
-- Cases - the string each one reads AFTER the migration:
--   R1  (postgres, before any fixture) the table's rows     rows=N person=N profile=0 ids=N   (the apply-time run; later: ids = rows, person + profile = rows)
--   K1  (postgres) the key and the unique constraints       pk=id unique=person_id,profile_id
--   F1  follower sets his own follows to ["s2"]             ERR 42501 new row violates row-level security policy for table "user_profiles"
--   F2  follower changes his own display_name              updated=1
--   P1  follower upserts his own prefs row on profile_id   ok rows=1 schedule=false
--   P2  follower updates it                                 updated=1
--   P3  follower reads the table                            own=1 others=0
--   P4  follower updates the surgeon's and the other's rows updated=0
--   P5  follower deletes them                               deleted=0
--   P6  follower inserts a row for person_id s2             ERR 42501 new row violates row-level security policy for table "notification_preferences"
--   P7  follower inserts a row for the other's profile_id  ERR 42501 new row violates row-level security policy for table "notification_preferences"
--   P8  follower re-points his row to person_id s2         ERR 42501 new row violates row-level security policy for table "notification_preferences"
--   P9  follower inserts a row with BOTH keys               ERR 23514 new row for relation "notification_preferences" violates check constraint "notification_preferences_one_owner"
--   A1  admin sets the follower's follows to ["s2"]        updated=1 follows=["s2"]
--   A2  admin sets follows to [1]                           ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_follows_shape"
--   A3  admin sets follows to {"s2": true}                  ERR 23514 ... "user_profiles_follows_shape"
--   A4  admin sets follows to [["s2"]]                      ERR 23514 ... "user_profiles_follows_shape"   (strict jsonpath: a nested array is not unwrapped)
--   A5  admin reads the three probe prefs rows              probe_rows=3
--   A6  admin inserts a prefs row with NEITHER key          ERR 23514 ... "notification_preferences_one_owner"
--   F3  follower reads his own follows                      follows=["s2"]
--   F4  follower clears his own follows                     ERR 42501 new row violates row-level security policy for table "user_profiles"
--   S1  surgeon upserts his row on person_id (what the client sends: ?on_conflict=person_id)
--                                                           ok rows=1 schedule=false
--   S2  surgeon upserts on the primary key (what PostgREST does WITHOUT on_conflict - the client before this branch)
--                                                           ERR 23505 duplicate key value violates unique constraint "notification_preferences_person_id_key"
--   S3  surgeon reads the table                             own=1 others=0
--   S4  surgeon sets his own follows                        ERR 42501 new row violates row-level security policy for table "user_profiles"
--   I1  (the second follower's profile row deleted as postgres) he self-inserts it with follows ["s2"]
--                                                           ERR 42501 new row violates row-level security policy for table "user_profiles"
--   I2  he self-inserts it following nobody                 ok follows=[]
--   X1  (postgres) the follower's auth user deleted: his profile row and his prefs row cascade
--                                                           before=1 after=0
-- (only ';' inside error text is replaced by ',' so the message splits on ';'; verify-rls.sh grades every key)
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);

-- ---------- BEFORE / AFTER: the migration's columns, the row count (R1) and the keys (K1) - before any fixture exists
do $$ declare n int; np int; npr int; nid int; pk text; uq text; begin
  select count(*) into n from public.notification_preferences;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'follows')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notification_preferences' and column_name = 'profile_id') then
    raise exception 'PROBE_SETUP: user_profiles.follows / notification_preferences.profile_id are absent - sql/migrations/2026-09-24-followers.sql is not applied (this is the BEFORE picture) - notification_preferences rows=%', n;
  end if;
  select count(person_id), count(profile_id), count(distinct id) into np, npr, nid from public.notification_preferences;
  insert into probe_results values ('R1', 'rows=' || n || ' person=' || np || ' profile=' || npr || ' ids=' || nid);
  select string_agg(a.attname, ',' order by a.attname) into pk
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.notification_preferences'::regclass and c.contype = 'p';
  select string_agg(a.attname, ',' order by a.attname) into uq
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.notification_preferences'::regclass and c.contype = 'u';
  insert into probe_results values ('K1', 'pk=' || coalesce(pk, 'none') || ' unique=' || coalesce(uq, 'none'));
end $$;

-- ---------- fixtures (as postgres: RLS bypassed)
do $$
declare
  fol     uuid := gen_random_uuid();
  other_f uuid := gen_random_uuid();
  surgeon uuid := gen_random_uuid();
  admin_u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', fol, 'authenticated', 'authenticated', 'probe-follow-' || fol || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', other_f, 'authenticated', 'authenticated', 'probe-follow-' || other_f || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', surgeon, 'authenticated', 'authenticated', 'probe-follow-' || surgeon || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false),
         ('00000000-0000-0000-0000-000000000000', admin_u, 'authenticated', 'authenticated', 'probe-follow-' || admin_u || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false);
  if (select count(*) from public.user_profiles where id in (fol, other_f, surgeon, admin_u)) <> 4 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  if (select count(*) from public.user_profiles where id in (fol, other_f) and role = 'viewer' and person_id is null and follows = '[]'::jsonb) <> 2 then
    raise exception 'PROBE_SETUP: a new profile row is not an unlinked viewer following nobody';
  end if;
  update public.user_profiles set display_name = 'probe follower' where id = fol;
  update public.user_profiles set display_name = 'probe follower two' where id = other_f;
  update public.user_profiles set person_id = 'probe-follow', role = 'surgeon', display_name = 'probe follow surgeon' where id = surgeon;
  update public.user_profiles set role = 'admin', display_name = 'probe follow admin' where id = admin_u;
  insert into public.notification_preferences (person_id, schedule_updates_email) values ('probe-follow', true);
  insert into public.notification_preferences (profile_id, trade_updates_email) values (other_f, true);
  insert into probe_ctx values ('fol', fol::text), ('other', other_f::text), ('surgeon', surgeon::text), ('admin', admin_u::text);
end $$;

-- F1, F2, P1-P9: as the FOLLOWER (a viewer with no roster link)
do $$ declare u text; o text; n int; own int; oth int; b boolean; begin
  select probe_ctx.v into u from probe_ctx where probe_ctx.k = 'fol';
  select probe_ctx.v into o from probe_ctx where probe_ctx.k = 'other';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    update public.user_profiles set follows = '["s2"]'::jsonb where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('F1', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('F1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe follower renamed' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('F2', 'updated=' || n);
  exception when others then insert into probe_results values ('F2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (profile_id, schedule_updates_email) values (auth.uid(), false)
      on conflict (profile_id) do update set schedule_updates_email = excluded.schedule_updates_email, updated_at = now();
    select count(*), bool_and(schedule_updates_email) into n, b from public.notification_preferences where profile_id = auth.uid();
    insert into probe_results values ('P1', 'ok rows=' || n || ' schedule=' || coalesce(b::text, 'null'));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.notification_preferences set trade_updates_email = false where profile_id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('P2', 'updated=' || n);
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where profile_id = auth.uid()), count(*) filter (where profile_id is distinct from auth.uid())
      into own, oth from public.notification_preferences;
    insert into probe_results values ('P3', 'own=' || own || ' others=' || oth);
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.notification_preferences set shift_reminders_email = false where person_id = 'probe-follow' or profile_id = o::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('P4', 'updated=' || n);
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    delete from public.notification_preferences where person_id = 'probe-follow' or profile_id = o::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('P5', 'deleted=' || n);
  exception when others then insert into probe_results values ('P5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (person_id) values ('s2');
    insert into probe_results values ('P6', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('P6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (profile_id) values (o::uuid);
    insert into probe_results values ('P7', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('P7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.notification_preferences set person_id = 's2', profile_id = null where profile_id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('P8', 'updated=' || n || ' (NO refusal)');
  exception when others then insert into probe_results values ('P8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (person_id, profile_id) values ('probe-follow', auth.uid());
    insert into probe_results values ('P9', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('P9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- A1-A6: as the ADMIN (user_profiles_admin: the Setup > Users write path)
do $$ declare a text; f text; o text; n int; v text; begin
  select probe_ctx.v into a from probe_ctx where probe_ctx.k = 'admin';
  select probe_ctx.v into f from probe_ctx where probe_ctx.k = 'fol';
  select probe_ctx.v into o from probe_ctx where probe_ctx.k = 'other';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    update public.user_profiles set follows = '["s2"]'::jsonb where id = f::uuid;
    get diagnostics n = row_count;
    select follows::text into v from public.user_profiles where id = f::uuid;
    insert into probe_results values ('A1', 'updated=' || n || ' follows=' || coalesce(v, 'null'));
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set follows = '[1]'::jsonb where id = f::uuid;
    insert into probe_results values ('A2', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set follows = '{"s2": true}'::jsonb where id = f::uuid;
    insert into probe_results values ('A3', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set follows = '[["s2"]]'::jsonb where id = f::uuid;
    insert into probe_results values ('A4', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.notification_preferences where person_id = 'probe-follow' or profile_id in (f::uuid, o::uuid);
    insert into probe_results values ('A5', 'probe_rows=' || n);
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (schedule_updates_email) values (true);
    insert into probe_results values ('A6', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- F3, F4: as the FOLLOWER again - he reads whom he follows, and cannot change it
do $$ declare u text; v text; begin
  select probe_ctx.v into u from probe_ctx where probe_ctx.k = 'fol';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select follows::text into v from public.user_profiles where id = auth.uid();
    insert into probe_results values ('F3', 'follows=' || coalesce(v, 'null'));
  exception when others then insert into probe_results values ('F3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set follows = '[]'::jsonb where id = auth.uid();
    insert into probe_results values ('F4', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('F4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- S1-S4: as the SURGEON (linked to 'probe-follow') - his upsert still resolves on person_id
do $$ declare u text; n int; own int; oth int; b boolean; begin
  select probe_ctx.v into u from probe_ctx where probe_ctx.k = 'surgeon';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.notification_preferences (person_id, schedule_updates_email) values ('probe-follow', false)
      on conflict (person_id) do update set schedule_updates_email = excluded.schedule_updates_email, updated_at = now();
    select count(*), bool_and(schedule_updates_email) into n, b from public.notification_preferences where person_id = 'probe-follow';
    insert into probe_results values ('S1', 'ok rows=' || n || ' schedule=' || coalesce(b::text, 'null'));
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.notification_preferences (person_id, schedule_updates_email) values ('probe-follow', true)
      on conflict (id) do update set schedule_updates_email = excluded.schedule_updates_email, updated_at = now();
    insert into probe_results values ('S2', 'ok (NO refusal)');
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) filter (where person_id = 'probe-follow'), count(*) filter (where person_id is distinct from 'probe-follow')
      into own, oth from public.notification_preferences;
    insert into probe_results values ('S3', 'own=' || own || ' others=' || oth);
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set follows = '["s2"]'::jsonb where id = auth.uid();
    insert into probe_results values ('S4', 'updated (NO refusal)');
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- I1, I2: the self-insert door - the second follower's profile row deleted as postgres (his prefs row cascades), then he inserts it
do $$ declare o text; v text; begin
  select probe_ctx.v into o from probe_ctx where probe_ctx.k = 'other';
  delete from public.user_profiles where id = o::uuid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin
    insert into public.user_profiles (id, role, follows) values (auth.uid(), 'viewer', '["s2"]'::jsonb);
    insert into probe_results values ('I1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('I1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.user_profiles (id, role) values (auth.uid(), 'viewer');
    select follows::text into v from public.user_profiles where id = auth.uid();
    insert into probe_results values ('I2', 'ok follows=' || coalesce(v, 'null'));
  exception when others then insert into probe_results values ('I2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- X1: as postgres - the follower's auth user deleted: user_profiles cascades, and his prefs row with it (profile_id on delete cascade)
do $$ declare f text; nb int; na int; begin
  select probe_ctx.v into f from probe_ctx where probe_ctx.k = 'fol';
  begin
    select count(*) into nb from public.notification_preferences where profile_id = f::uuid;
    delete from auth.users where id = f::uuid;
    select count(*) into na from public.notification_preferences where profile_id = f::uuid;
    insert into probe_results values ('X1', 'before=' || nb || ' after=' || na);
  exception when others then insert into probe_results values ('X1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
