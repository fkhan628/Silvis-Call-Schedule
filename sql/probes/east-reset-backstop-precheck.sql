-- ============================================================================
-- Silvis Call Schedule - East reset backstop PRE-CHECK (2026-10-21, revision aa; sql/migrations/2026-10-21-east-reset-backstop.sql,
-- REPORT-FIRST; APPLIED 2026-10-22 04:50:53Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right
-- after it (Faraz's apply script, kept outside the repo, does both): rows 1-4 are the gate, rows 5-6 are facts for the record (they
-- never stop the run - but would_keep above 0 means revision x would delete those reviews at the next reset unless that run's read
-- brings his ranges back: report it at once).
-- Row 5 runs the revision x functions only through query_to_xml, after to_regprocedure finds them.
-- As run (2026-10-22): before the apply rows 1-2 read reset_fn=yes ranges_fn=yes people_fn=yes backstop=no and definer=t volatile=v
-- path=yes body_md5=ecd1e0de45cc01e127617fb943e7d99e (revision x's body), right after it reset_fn=yes ranges_fn=yes people_fn=yes
-- backstop=yes and definer=t volatile=v path=yes body_md5=cf8a2882f00f3d81f6c3ca111a1ca1ae (this revision's); rows 3 (public=f anon=f
-- authenticated=t service_role=t, the result as below) and 4 (owner_match=yes reviews_force=f audit_force=f) the same both times; row 5
-- p_from=2026-09-21 east_people=1 held=1 would_keep=0/0 would_reset=0 and row 6 resets_since_x=0 by_cron=0 kept_rows=0 refreshes_since_x=2
-- both times - docs/SCHEMA-REVIEW.md "2026-10-21 - east_vacation_reset_stale keeps a person's reviews when the cache holds no range of
-- his (revision aa)" quotes them. This header was kept byte for byte as reviewed until the apply (the apply script pinned its sha256);
-- the record step turned it APPLIED.
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/east-reset-backstop-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (catalog facts, roster-free counts and dates only: no name, no email,
-- no note, no audit detail beyond its action, decision and actor):
--   1 objects   reset_fn=<yes|no> ranges_fn=<yes|no> people_fn=<yes|no> backstop=<yes|no> - the apply gate (backstop = the reset's
--               body holds eastvac.reset.kept): before the apply it reads reset_fn=yes ranges_fn=yes people_fn=yes backstop=no,
--               after it reset_fn=yes ranges_fn=yes people_fn=yes backstop=yes
--   2 body      definer=<t|f> volatile=<v|s|i> path=<yes|no> body_md5=<md5 of the reset's prosrc> - before the apply
--               definer=t volatile=v path=yes body_md5=ecd1e0de45cc01e127617fb943e7d99e (revision x's body), after it
--               definer=t volatile=v path=yes body_md5=cf8a2882f00f3d81f6c3ca111a1ca1ae (this revision's) - any other md5 is a STOP
--   3 grants    before and after: public=f anon=f authenticated=t service_role=t result=TABLE(person_id text, start_date date, end_date date, decision text, reason text)
--               (EXECUTE on east_vacation_reset_stale(date); PUBLIC read from the ACL, its default included)
--   4 owner     owner_match=yes reviews_force=f audit_force=f before and after (the reset's owner owns east_vacation_reviews and
--               audit_log, neither has FORCE ROW LEVEL SECURITY - the definer's delete and audit insert pass RLS by ownership)
--   5 backstop  p_from=<the Monday of Central today - 28, the callers' p_from> east_people=<n> held=<n - with a merged cached range
--               ending on or after p_from> would_keep=<people>/<reviews> (East people with reviews ending on or after p_from and no
--               such range - the backstop keeps them, revision x deletes them) would_reset=<reviews> (the reviews of held people the
--               next reset deletes). Expected live: east_people=1 held=1 would_keep=0/0 (the 2026-10-20 10:30 UTC run left the cache
--               holding ranges of Khan ending on or after its p_from) - an expectation, never a stop
--   6 audit     resets_since_x=<n> by_cron=<n> kept_rows=<n> refreshes_since_x=<n> (eastvac.review rows with decision reset since
--               revision x's apply, 2026-10-19 22:53:18Z, those by cron, every eastvac.reset.kept row - 0 before the apply - and the
--               east.refresh rows since the same instant)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'reset_fn=' || case when to_regprocedure('public.east_vacation_reset_stale(date)') is null then 'no' else 'yes' end
      || ' ranges_fn=' || case when to_regprocedure('public.silvis_east_ranges()') is null then 'no' else 'yes' end
      || ' people_fn=' || case when to_regprocedure('public.silvis_east_people()') is null then 'no' else 'yes' end
      || ' backstop=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.east_vacation_reset_stale(date)')
                                                and p.prosrc like '%eastvac.reset.kept%') then 'yes' else 'no' end as detail
),
body as (
  select 2 as ord, 'body'::text as section, ''::text as role,
         coalesce((select 'definer=' || case when p.prosecdef then 't' else 'f' end || ' volatile=' || p.provolatile::text
                       || ' path=' || case when p.proconfig @> array['search_path=public, pg_temp'] then 'yes' else 'no' end
                       || ' body_md5=' || md5(p.prosrc)
                     from pg_proc p where p.oid = to_regprocedure('public.east_vacation_reset_stale(date)')), 'absent') as detail
),
grants as (
  select 3 as ord, 'grants'::text as section, ''::text as role,
         coalesce((select 'public=' || case when exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 't' else 'f' end
                       || ' anon=' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                       || ' authenticated=' || case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end
                       || ' service_role=' || case when has_function_privilege('service_role', p.oid, 'execute') then 't' else 'f' end
                       || ' result=' || pg_get_function_result(p.oid)
                     from pg_proc p where p.oid = to_regprocedure('public.east_vacation_reset_stale(date)')), 'absent') as detail
),
owner as (
  select 4 as ord, 'owner'::text as section, ''::text as role,
         'owner_match=' || case when (select p.proowner from pg_proc p where p.oid = to_regprocedure('public.east_vacation_reset_stale(date)'))
                                     = all (select c.relowner from pg_class c where c.oid in ('public.east_vacation_reviews'::regclass, 'public.audit_log'::regclass)) then 'yes' else 'no' end
      || ' reviews_force=' || (select case when c.relforcerowsecurity then 't' else 'f' end from pg_class c where c.oid = 'public.east_vacation_reviews'::regclass)
      || ' audit_force=' || (select case when c.relforcerowsecurity then 't' else 'f' end from pg_class c where c.oid = 'public.audit_log'::regclass) as detail
),
backstop as (
  select 5 as ord, 'backstop'::text as section, ''::text as role,
         case when to_regprocedure('public.silvis_east_ranges()') is null or to_regprocedure('public.silvis_east_people()') is null then 'functions=absent'
              else (xpath('/row/t/text()', query_to_xml($q$
                with f as (select (date_trunc('week', ((now() at time zone 'America/Chicago')::date - 28)::timestamp))::date as d),
                ppl as (select p.person_id as pid from public.silvis_east_people() p),
                held as (select distinct r.person_id as pid from public.silvis_east_ranges() r, f where r.end_date >= f.d),
                inscope as (select w.person_id as pid, w."start" as s, w."end" as e from public.east_vacation_reviews w join ppl on ppl.pid = w.person_id, f where w."end" >= f.d)
                select 'p_from=' || (select f.d from f) || ' east_people=' || (select count(*) from ppl) || ' held=' || (select count(*) from held)
                    || ' would_keep=' || (select count(distinct i.pid) from inscope i where i.pid not in (select h.pid from held h))
                    || '/' || (select count(*) from inscope i where i.pid not in (select h.pid from held h))
                    || ' would_reset=' || (select count(*) from inscope i where i.pid in (select h.pid from held h)
                                             and not exists (select 1 from public.silvis_east_ranges() r where r.person_id = i.pid and r.start_date = i.s and r.end_date = i.e)) as t
              $q$, false, true, '')))[1]::text end as detail
),
audit as (
  select 6 as ord, 'audit'::text as section, ''::text as role,
         'resets_since_x=' || count(*) filter (where l.action = 'eastvac.review' and l.detail->>'decision' = 'reset' and l.created_at >= '2026-10-19 22:53:18+00')
      || ' by_cron=' || count(*) filter (where l.action = 'eastvac.review' and l.detail->>'decision' = 'reset' and l.created_at >= '2026-10-19 22:53:18+00' and l.actor_id = 'cron')
      || ' kept_rows=' || count(*) filter (where l.action = 'eastvac.reset.kept')
      || ' refreshes_since_x=' || count(*) filter (where l.action = 'east.refresh' and l.created_at >= '2026-10-19 22:53:18+00') as detail
    from public.audit_log l
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from body
union all select ord, section, role, detail from grants
union all select ord, section, role, detail from owner
union all select ord, section, role, detail from backstop
union all select ord, section, role, detail from audit
order by ord, role;
