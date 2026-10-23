-- ============================================================================
-- Silvis Call Schedule - East reset backstop PROBE (2026-10-21, revision aa; sql/migrations/2026-10-21-east-reset-backstop.sql,
-- REPORT-FIRST; APPLIED 2026-10-22 04:50:53Z). Proves east_vacation_reset_stale()'s backstop - an East person the cache holds no merged range of
-- ending on or after p_from keeps every review, with ONE eastvac.reset.kept audit row - and that everyone else is reset as before,
-- on the LIVE database WITHOUT PERSISTING ANYTHING. Same mechanism as the other probes: ONE batch through the linked CLI (one
-- implicit transaction, no BEGIN/COMMIT); every case records into probe_results; the LAST statement raises
-- 'PROBE_RESULTS K=...;END', so everything - the user, the reviews, the cached weeks, the audit rows - rolls back. A batch ending in
-- RAISE persists nothing.
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/east-reset-backstop-probe.sql
--   (graded by Faraz's apply script apply-east-reset-backstop.sh, kept outside the repo, and, since the record step, by scripts/verify-rls.sh
--   section 23 on every run, value for value against the header lines below)
-- As run: the migration was applied 2026-10-22 04:50:53Z (schema.sql revision aa); the probe read PROBE_SETUP (east_vacation_reset_stale
-- has no backstop) before it and all 15 cases below as listed after it, leftover count 0 (apply-east-reset-backstop.sh steps 3 and 6). Since
-- the record step verify-rls section 23 runs it on every run, grades each case against its line below and counts the leftovers it could
-- leave; it FAILs a PROBE_SETUP (no backstop, revision x absent, a collision, the roster or the profile row) or a missing sentinel - there
-- was never a not-applied grading.
-- Run no Refresh from Davenport at the same time and not at 10:25-10:40 UTC (the daily server refresh): the probe takes the reset's
-- advisory lock east_vacation_reviews:reset for the length of the batch - well under a second.
-- The setup raises, in this order and before any fixture is written: the collision guard 'PROBE_SETUP: live rows already sit in
-- 2031-12-29 .. 2032-06-30 ...' (an east_feed week in the window, a review ending in 2032 or later, a cached East vacation entry
-- ending on or after 2031-12-29, or an eastvac.review / eastvac.reset.kept audit row of the window - a dry run sees it first);
-- 'PROBE_SETUP: east_vacation_reset_stale is absent - revision x (sql/migrations/2026-10-14-east-vacations.sql) is not applied';
-- BEFORE the migration 'PROBE_SETUP: east_vacation_reset_stale has no backstop - sql/migrations/2026-10-21-east-reset-backstop.sql
-- is not applied' (the body holds no eastvac.reset.kept - nothing else runs: that is every case's BEFORE result); the roster check
-- 'PROBE_SETUP: the probe needs an East person ...'. AFTER the migration every case below must read as listed.
-- Identity: one throwaway admin probe-eastreset32-<uuid>@example.test (display name 'probe admin', no roster link); reviews
-- decided_by 'probe-eastreset32'; east_feed rows data.probe 'eastreset32'; audit rows whose start / from lie in 2032-01 .. 2032-06.
-- The leftover count after every run keys on them (must be 0).
-- The roster is READ from the live blob (call_schedule_data 'main'), never written: E = the first East person (an active surgeon
-- whose eastFeed is enabled and blocks a role, with a roster code - Khan today), EC his code. Two East people are proven offline only.
-- Fixtures (written as postgres, no signed-in user): E's reviews away 2032-01-12..01-13 (ends before p_from - never in scope), away
-- 02-02..02-03, home 02-09..02-10, away 03-01..03-02; no cached range of E ending on or after 2031-12-29 at the start (the collision
-- guard refuses otherwise). p_from = 2032-01-19, a Monday. B8-B10 and B15 each insert one cached week, read the result and are UNDONE
-- (the block raises PROBE_UNDO; its variables survive the rollback); B11 inserts one cached week for good (EC 02-02..02-03, until the
-- batch rolls back).
-- reset(d) = public.east_vacation_reset_stale(d), written 'n=<count> MM-DD..MM-DD/<decision>/<reason>,...'; kept_rows / review_rows =
-- the new eastvac.reset.kept / eastvac.review rows of the window; E in a summary is the live name replaced by the letter E, and B4's
-- pid is E when the kept row's person_id is E's roster id ('other' otherwise - the live id is never printed).
-- Cases (BEFORE: PROBE_SETUP east_vacation_reset_stale has no backstop; AFTER - the string after '->'):
--   B1  postgres: the function's security, volatility, search_path, result, EXECUTE and the backstop in its body -> reset=definer/volatile path=yes result=TABLE(person_id text, start_date date, end_date date, decision text, reason text) exec=authenticated,service_role public=no backstop=yes
--   B2  postgres: reset('2032-01-19') with an anon role claim and no user, then reset(null) with no user - each refused call raises EV001 / EV002 and leaves no kept row (the order is pinned in test/schema.test.js) -> anon=EV001 null=EV002 kept_rows=0
--   B3  postgres with the service_role claim: reset('2032-01-19') - the cache holds no range of E ending on or after 01-19 -> n=0 reviews=E 01-12..01-13 away,E 02-02..02-03 away,E 02-09..02-10 home,E 03-01..03-02 away
--   B4  its audit rows -> kept_rows=1 review_rows=0 actor=cron name=east-feed-refresh (cron) kept=3 from=2032-01-19 reviews=02-02..02-03/away,02-09..02-10/home,03-01..03-02/away keys=from,kept,person_id,reviews,summary pid=E sum=East vacation reviews of E kept: the cache holds no East vacation of his ending on or after 2032-01-19, so his 3 review(s) ending then were not reset (a blocked or emptied Davenport read looks the same)
--   B5  U (admin = the scheduler): reset('2032-01-19') -> n=0 kept_rows=1 actor=self name=probe admin
--   B6  postgres, no signed-in user: reset('2032-01-19') -> n=0 kept_rows=1 actor=cron name=no signed-in user (SQL)
--   B7  postgres, no signed-in user: reset('2032-03-03') - no review of his ends on or after 03-03 -> n=0 kept_rows=0
--   B8  (undone) a cached range of E ending ON p_from (01-15..01-19) - the normal reset -> n=3 02-02..02-03/away/removed,02-09..02-10/home/removed,03-01..03-02/away/removed kept_rows=0 review_rows=3
--   B9  (undone) a cached range of E ending the day before p_from (01-14..01-18) - kept -> n=0 kept_rows=1
--   B10 (undone) only a forecast row carries a range of E (02-02..02-03) - kept -> n=0 kept_rows=1
--   B11 service_role: a range of E shows again with exactly 02-02..02-03 - the normal reset; the re-added range has its kept decision back -> n=2 02-09..02-10/home/removed,03-01..03-02/away/removed kept_rows=0 state=02-02..02-03/away
--   B12 its audit rows (revision x's shape, unchanged) -> review_rows=2 actor=cron name=east-feed-refresh (cron) keys=decision,end,person_id,reason,removed,start,summary,was was=home,away
--   B13 the fixture reviews left -> kept=E 01-12..01-13 away,E 02-02..02-03 away
--   B14 the resets wrote no time_off row, changed no live east_feed row and wrote no other audit row -> time_off=same east_feed=same other_audit=0
--   B15 (undone) a cached range of E ending after p_from whose exact review is home (02-09..02-10) - held, the normal reset -> n=2 02-02..02-03/away/removed,03-01..03-02/away/removed kept_rows=0 review_rows=2
-- 15 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  ua      uuid := gen_random_uuid();
  e_id    text;
  e_code  text;
  e_name  text;
begin
  -- the collision guard first (a dry run sees it before anything else)
  if exists (select 1 from public.east_feed where week_monday between '2031-12-29' and '2032-06-30')
     or exists (select 1 from public.east_vacation_reviews where "end" >= '2032-01-01')
     or exists (select 1 from public.east_feed f
                  cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
                 where jsonb_typeof(v.r) = 'object' and coalesce(v.r->>'end', '') >= '2031-12-29')
     or exists (select 1 from public.audit_log where action in ('eastvac.review', 'eastvac.reset.kept') and coalesce(detail->>'start', detail->>'from', '') between '2032-01-01' and '2032-06-30') then
    raise exception 'PROBE_SETUP: live rows already sit in 2031-12-29 .. 2032-06-30 (an east_feed week, a review ending in 2032 or later, a cached East vacation reaching 2031-12-29, or an eastvac audit row of the window) - the probe fixtures would collide';
  end if;
  if to_regprocedure('public.east_vacation_reset_stale(date)') is null or to_regprocedure('public.silvis_east_ranges()') is null or to_regprocedure('public.silvis_east_people()') is null then
    raise exception 'PROBE_SETUP: east_vacation_reset_stale is absent - revision x (sql/migrations/2026-10-14-east-vacations.sql) is not applied';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.east_vacation_reset_stale(date)') and p.prosrc like '%eastvac.reset.kept%') then
    raise exception 'PROBE_SETUP: east_vacation_reset_stale has no backstop - sql/migrations/2026-10-21-east-reset-backstop.sql is not applied';
  end if;
  select p.person_id, p.code, p.name into e_id, e_code, e_name from public.silvis_east_people() p order by p.ord limit 1;
  if e_id is null then
    raise exception 'PROBE_SETUP: the probe needs an East person on the roster (found none)';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', ua, 'authenticated', 'authenticated', 'probe-eastreset32-' || ua || '@example.test', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false);
  if not exists (select 1 from public.user_profiles where id = ua) then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile row';
  end if;
  update public.user_profiles set role = 'admin', display_name = 'probe admin' where id = ua;
  insert into probe_ctx values ('ua', ua::text), ('east', e_id), ('ecode', e_code), ('ename', e_name);
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.east_vacation_reviews (person_id, "start", "end", decision, decided_by) values
    (e_id, '2032-01-12', '2032-01-13', 'away', 'probe-eastreset32'), (e_id, '2032-02-02', '2032-02-03', 'away', 'probe-eastreset32'),
    (e_id, '2032-02-09', '2032-02-10', 'home', 'probe-eastreset32'), (e_id, '2032-03-01', '2032-03-02', 'away', 'probe-eastreset32');
  insert into probe_ctx values ('time_off_before', (select count(*)::text from public.time_off)),
    ('east_feed_before', coalesce((select md5(string_agg(f.week_monday::text || f.data::text, '|' order by f.week_monday)) from public.east_feed f where (f.data->>'probe') is distinct from 'eastreset32'), 'none'));
end $$;

-- helpers (as postgres; the window's audit rows by action, E's fixture reviews, one reset written as a string)
create or replace function pg_temp.kept_n() returns int language sql as $f$
  select count(*)::int from public.audit_log l where l.action = 'eastvac.reset.kept' and l.detail->>'from' between '2032-01-01' and '2032-06-30'
$f$;
create or replace function pg_temp.rev_n() returns int language sql as $f$
  select count(*)::int from public.audit_log l where l.action = 'eastvac.review' and l.detail->>'start' between '2032-01-01' and '2032-06-30'
$f$;
create or replace function pg_temp.revs() returns text language sql as $f$
  select coalesce(string_agg('E ' || to_char(w."start", 'MM-DD') || '..' || to_char(w."end", 'MM-DD') || ' ' || w.decision, ',' order by w."start"), 'none')
    from public.east_vacation_reviews w where w.decided_by = 'probe-eastreset32'
$f$;
create or replace function pg_temp.rs(p_day date) returns text language plpgsql as $f$
declare c int; t text;
begin
  select count(*), string_agg(to_char(r.start_date, 'MM-DD') || '..' || to_char(r.end_date, 'MM-DD') || '/' || r.decision || '/' || r.reason, ',' order by r.start_date)
    into c, t from public.east_vacation_reset_stale(p_day) r;
  return 'n=' || c || coalesce(' ' || t, '');
end $f$;

-- B1: the function as the catalog holds it
do $$ declare tv text; begin
  select 'reset=' || case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end
      || ' path=' || case when p.proconfig @> array['search_path=public, pg_temp'] then 'yes' else 'no' end
      || ' result=' || pg_get_function_result(p.oid)
      || ' exec=' || coalesce((select string_agg(g.r, ',' order by g.r) from unnest(array['anon', 'authenticated', 'service_role']) as g(r) where has_function_privilege(g.r, p.oid, 'execute')), 'none')
      || ' public=' || case when exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 'yes' else 'no' end
      || ' backstop=' || case when p.prosrc like '%eastvac.reset.kept%' then 'yes' else 'no' end
    into tv
    from pg_proc p where p.oid = 'public.east_vacation_reset_stale(date)'::regprocedure;
  insert into probe_results values ('B1', tv);
exception when others then insert into probe_results values ('B1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','));
end $$;

-- B2: each refused call raises (anon EV001, no p_from EV002) and leaves no kept row - the order (both refusals before the cache or the
-- reviews are read) is pinned in test/schema.test.js, not here
do $$ declare t1 text; t2 text; n0 int; begin
  n0 := pg_temp.kept_n();
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform count(*) from public.east_vacation_reset_stale('2032-01-19'); t1 := 'NO-refusal'; exception when others then t1 := sqlstate; end;
  perform set_config('request.jwt.claims', '{}', true);
  begin perform count(*) from public.east_vacation_reset_stale(null); t2 := 'NO-refusal'; exception when others then t2 := sqlstate; end;
  insert into probe_results values ('B2', 'anon=' || t1 || ' null=' || t2 || ' kept_rows=' || (pg_temp.kept_n() - n0));
exception when others then insert into probe_results values ('B2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','));
end $$;

-- B3 / B4: the service role (the daily server refresh) over a cache that holds no range of E ending on or after p_from
do $$ declare en text; n0 int; r0 int; tv text; begin
  select c.v into en from probe_ctx c where c.k = 'ename';
  n0 := pg_temp.kept_n(); r0 := pg_temp.rev_n();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    insert into probe_results values ('B3', pg_temp.rs('2032-01-19') || ' reviews=' || pg_temp.revs());
  exception when others then insert into probe_results values ('B3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'kept_rows=' || (pg_temp.kept_n() - n0) || ' review_rows=' || (pg_temp.rev_n() - r0)
        || ' actor=' || coalesce(string_agg(distinct l.actor_id, ','), '-') || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
        || ' kept=' || coalesce(string_agg(l.detail->>'kept', ','), '-') || ' from=' || coalesce(string_agg(l.detail->>'from', ','), '-')
        || ' reviews=' || coalesce((select string_agg(to_char((e.r->>'start')::date, 'MM-DD') || '..' || to_char((e.r->>'end')::date, 'MM-DD') || '/' || (e.r->>'decision'), ',' order by e.r->>'start')
                                     from public.audit_log l2 cross join lateral jsonb_array_elements(l2.detail->'reviews') as e(r)
                                    where l2.action = 'eastvac.reset.kept' and l2.detail->>'from' between '2032-01-01' and '2032-06-30'), '-')
        || ' keys=' || coalesce((select string_agg(kk.k2, ',' order by kk.k2) from (select distinct jsonb_object_keys(l3.detail) as k2 from public.audit_log l3
                                    where l3.action = 'eastvac.reset.kept' and l3.detail->>'from' between '2032-01-01' and '2032-06-30') kk), '-')
        || ' pid=' || coalesce(string_agg(case when l.detail->>'person_id' = (select pc.v from probe_ctx pc where pc.k = 'east') then 'E' else 'other' end, ','), '-')
        || ' sum=' || coalesce(string_agg(replace(l.detail->>'summary', 'reviews of ' || en || ' kept', 'reviews of E kept'), ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.reset.kept' and l.detail->>'from' between '2032-01-01' and '2032-06-30';
    insert into probe_results values ('B4', tv);
  exception when others then insert into probe_results values ('B4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- B5: the scheduler (an unlinked admin) - his kept row carries his uuid and display name
do $$ declare u text; n0 int; c int; tv text; begin
  select pc.v into u from probe_ctx pc where pc.k = 'ua';
  n0 := pg_temp.kept_n();
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select count(*) into c from public.east_vacation_reset_stale('2032-01-19');
    tv := 'n=' || c;
  exception when others then tv := 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  if tv like 'ERR%' then
    insert into probe_results values ('B5', tv);
  else
    select tv || ' kept_rows=' || (pg_temp.kept_n() - n0)
        || ' actor=' || coalesce(string_agg(distinct case when l.actor_id = u then 'self' else l.actor_id end, ','), '-')
        || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.reset.kept' and l.detail->>'from' between '2032-01-01' and '2032-06-30' and l.actor_id <> 'cron';
    insert into probe_results values ('B5', tv);
  end if;
exception when others then insert into probe_results values ('B5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ','));
end $$;

-- B6 / B7: a session with no signed-in user (the SQL editor, the linked CLI)
do $$ declare n0 int; tv text; begin
  perform set_config('request.jwt.claims', '{}', true);
  begin
    n0 := pg_temp.kept_n();
    tv := pg_temp.rs('2032-01-19') || ' kept_rows=' || (pg_temp.kept_n() - n0);
    select tv || ' actor=' || coalesce(string_agg(distinct l.actor_id, ','), '-') || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.reset.kept' and l.detail->>'from' between '2032-01-01' and '2032-06-30' and l.actor_name = 'no signed-in user (SQL)';
    insert into probe_results values ('B6', tv);
  exception when others then insert into probe_results values ('B6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    n0 := pg_temp.kept_n();
    insert into probe_results values ('B7', pg_temp.rs('2032-03-03') || ' kept_rows=' || (pg_temp.kept_n() - n0));
  exception when others then insert into probe_results values ('B7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- B8 - B10 and B15: one cached week each, UNDONE after the reading (the block raises PROBE_UNDO; its variables survive the rollback)
do $$ declare ec text; ck text; wk date; s1 text; e1 text; fc boolean; tv text; n0 int; r0 int; begin
  select pc.v into ec from probe_ctx pc where pc.k = 'ecode';
  perform set_config('request.jwt.claims', '{}', true);
  for ck, wk, s1, e1, fc in values ('B8', '2032-01-12'::date, '2032-01-15', '2032-01-19', false), ('B9', '2032-01-12'::date, '2032-01-14', '2032-01-18', false),
                                   ('B10', '2032-02-02'::date, '2032-02-02', '2032-02-03', true), ('B15', '2032-02-09'::date, '2032-02-09', '2032-02-10', false) loop
    tv := null;
    begin
      n0 := pg_temp.kept_n(); r0 := pg_temp.rev_n();
      insert into public.east_feed (week_monday, data) values (wk, jsonb_build_object('probe', 'eastreset32', 'isForecast', fc,
        'vacations', jsonb_build_array(jsonb_build_object('code', ec, 'start', s1, 'end', e1))));
      tv := pg_temp.rs('2032-01-19') || ' kept_rows=' || (pg_temp.kept_n() - n0) || case when ck in ('B8', 'B15') then ' review_rows=' || (pg_temp.rev_n() - r0) else '' end;
      raise exception 'PROBE_UNDO';
    exception when others then
      if sqlerrm = 'PROBE_UNDO' then insert into probe_results values (ck, tv);
      else insert into probe_results values (ck, 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end if;
    end;
  end loop;
end $$;

-- B11 / B12: a range of E shows again with exactly the dates of a kept review - the normal reset runs (kept for good)
do $$ declare ec text; ex text; n0 int; r0 int; tv text; begin
  select pc.v into ec from probe_ctx pc where pc.k = 'ecode';
  select pc.v into ex from probe_ctx pc where pc.k = 'east';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    insert into public.east_feed (week_monday, data) values ('2032-02-02', jsonb_build_object('probe', 'eastreset32',
      'vacations', jsonb_build_array(jsonb_build_object('code', ec, 'start', '2032-02-02', 'end', '2032-02-03'))));
    n0 := pg_temp.kept_n(); r0 := pg_temp.rev_n();
    tv := pg_temp.rs('2032-01-19') || ' kept_rows=' || (pg_temp.kept_n() - n0)
       || ' state=' || coalesce((select string_agg(to_char(r.start_date, 'MM-DD') || '..' || to_char(r.end_date, 'MM-DD') || '/' || r.state, ',' order by r.start_date)
                                   from public.silvis_east_ranges() r where r.person_id = ex and r.end_date >= '2032-01-01'), 'none');
    insert into probe_results values ('B11', tv);
  exception when others then insert into probe_results values ('B11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'review_rows=' || count(*) || ' actor=' || coalesce(string_agg(distinct l.actor_id, ','), '-') || ' name=' || coalesce(string_agg(distinct l.actor_name, ','), '-')
        || ' keys=' || coalesce((select string_agg(kk.k2, ',' order by kk.k2) from (select distinct jsonb_object_keys(l3.detail) as k2 from public.audit_log l3
                                    where l3.action = 'eastvac.review' and l3.detail->>'start' between '2032-01-01' and '2032-06-30') kk), '-')
        || ' was=' || coalesce(string_agg(l.detail->>'was', ',' order by l.detail->>'start'), '-')
      into tv
      from public.audit_log l where l.action = 'eastvac.review' and l.detail->>'start' between '2032-01-01' and '2032-06-30';
    insert into probe_results values ('B12', tv);
  exception when others then insert into probe_results values ('B12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- B13 / B14: what is left, and that nothing else was written
do $$ declare tv text; begin
  begin
    insert into probe_results values ('B13', 'kept=' || pg_temp.revs());
  exception when others then insert into probe_results values ('B13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select 'time_off=' || case when (select count(*)::text from public.time_off) = (select pc.v from probe_ctx pc where pc.k = 'time_off_before') then 'same' else 'changed' end
        || ' east_feed=' || case when coalesce((select md5(string_agg(f.week_monday::text || f.data::text, '|' order by f.week_monday)) from public.east_feed f where (f.data->>'probe') is distinct from 'eastreset32'), 'none')
                                      = (select pc.v from probe_ctx pc where pc.k = 'east_feed_before') then 'same' else 'changed' end
        || ' other_audit=' || (select count(*) from public.audit_log l where l.created_at = now() and l.action not in ('eastvac.review', 'eastvac.reset.kept'))
      into tv;
    insert into probe_results values ('B14', tv);
  exception when others then insert into probe_results values ('B14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
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
