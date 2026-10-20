-- ============================================================================
-- Silvis Call Schedule - East vacations PRE-CHECK (2026-10-14, Prompt 31 Part A; sql/migrations/2026-10-14-east-vacations.sql,
-- REPORT-FIRST; APPLIED 2026-10-19 22:53:18Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right
-- after it (Faraz's apply script, kept outside the repo, does both); its rows are facts for the record, only the first one is a gate.
-- As run (2026-10-19): before the apply the gate read people_fn=no ranges_fn=no derived_fn=no reset_fn=no short_fn=no guard=yes guard_derived=no and right
-- after it people_fn=yes ranges_fn=yes derived_fn=yes reset_fn=yes short_fn=yes guard=yes guard_derived=yes; row 2 body_md5=c69066960303545b0028e0a820f6e1ab
-- before (the 9/30 body) and 2c81df20b98b3eb78a1d5b94fe8c30cf after; row 5 functions=absent before and merged=11 away=8 home=1 unreviewed=2 derived=10
-- after; rows 3, 4 and 6-8 the same both times (counts only) - docs/SCHEMA-REVIEW.md "2026-10-14 - East vacations" quotes them. This header was
-- kept byte for byte as reviewed until the apply (the apply script pinned its sha256); the record step turned it APPLIED.
-- It runs before the migration, so it never names the new functions outside catalog lookups (to_regprocedure, pg_proc) and the
-- query_to_xml text of row 5, which runs only when the functions exist. The days already under the minimum are, before the apply,
-- sql/probes/vacation-guard-overlimit.sql's (the 9/30 reading - the apply script runs it beside this file) and after it, by the new
-- reading, sql/probes/vacation-short-days.sql's (public.silvis_vacation_short_days - the apply script runs it after probe AFTER).
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/east-vacations-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (counts, dates and catalog facts only: no name, no email, no reason):
--   1 objects   people_fn=<yes|no> ranges_fn=<yes|no> derived_fn=<yes|no> reset_fn=<yes|no> short_fn=<yes|no> guard=<yes|no>
--               guard_derived=<yes|no> - the apply gate (the five functions by their exact signatures; guard_derived = the vacation
--               guard's body reads public.silvis_derived_vacations()): before the apply it reads
--               people_fn=no ranges_fn=no derived_fn=no reset_fn=no short_fn=no guard=yes guard_derived=no,
--               after it people_fn=yes ranges_fn=yes derived_fn=yes reset_fn=yes short_fn=yes guard=yes guard_derived=yes
--   2 guard     trigger=<yes|no> definer=<t|f> body_md5=<md5 of the guard's body> (the apply script compares the md5 with the
--               9/30 body's before the apply)
--   3 feed      rows=<n> forecast=<n> first=<week> last=<week> fetched_max=<UTC time> vacation_entries=<n> (the east_feed cache)
--   4 reviews   away=<n> home=<n> home_inexact=<n> (home_inexact = home rows whose dates are no cached entry's exact dates - the
--               guard stops exempting their days after the apply unless the merge makes them a whole range)
--   5 ranges    functions=absent before the apply; after it merged=<n> away=<n> home=<n> unreviewed=<n> derived=<n> (the new reading)
--   6 cron      jobs=<n> active=<n> east_job=<yes|no> (pg_cron's jobs; the daily server refresh adds silvis-east-feed-daily later)
--   7 pg_net    version=<extversion|absent>
--   8 realtime  publication=<yes|no> all_tables=<yes|no> time_off=<yes|no> east_feed=<yes|no> east_vacation_reviews=<yes|no>
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'people_fn=' || case when to_regprocedure('public.silvis_east_people()') is null then 'no' else 'yes' end
      || ' ranges_fn=' || case when to_regprocedure('public.silvis_east_ranges()') is null then 'no' else 'yes' end
      || ' derived_fn=' || case when to_regprocedure('public.silvis_derived_vacations()') is null then 'no' else 'yes' end
      || ' reset_fn=' || case when to_regprocedure('public.east_vacation_reset_stale(date)') is null then 'no' else 'yes' end
      || ' short_fn=' || case when to_regprocedure('public.silvis_vacation_short_days(date, date)') is null then 'no' else 'yes' end
      || ' guard=' || case when to_regprocedure('public.time_off_vacation_guard()') is null then 'no' else 'yes' end
      || ' guard_derived=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.time_off_vacation_guard()')
                                                   and p.prosrc like '%public.silvis_derived_vacations()%') then 'yes' else 'no' end as detail
),
guard as (
  select 2 as ord, 'guard'::text as section, ''::text as role,
         'trigger=' || case when exists (select 1 from pg_trigger t where t.tgname = 'time_off_vacation_guard_trg' and t.tgrelid = 'public.time_off'::regclass) then 'yes' else 'no' end
      || ' definer=' || coalesce((select case when p.prosecdef then 't' else 'f' end from pg_proc p where p.oid = to_regprocedure('public.time_off_vacation_guard()')), '-')
      || ' body_md5=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.time_off_vacation_guard()')), 'none') as detail
),
feed as (
  select 3 as ord, 'feed'::text as section, ''::text as role,
         'rows=' || count(*)
      || ' forecast=' || count(*) filter (where (f.data -> 'isForecast') = 'true'::jsonb)
      || ' first=' || coalesce(min(f.week_monday)::text, 'none')
      || ' last=' || coalesce(max(f.week_monday)::text, 'none')
      || ' fetched_max=' || coalesce(to_char(max(f.fetched_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'none')
      || ' vacation_entries=' || coalesce(sum(case when jsonb_typeof(f.data -> 'vacations') = 'array' then jsonb_array_length(f.data -> 'vacations') else 0 end), 0) as detail
    from public.east_feed f
),
reviews as (
  select 4 as ord, 'reviews'::text as section, ''::text as role,
         'away=' || count(*) filter (where w.decision = 'away')
      || ' home=' || count(*) filter (where w.decision = 'home')
      || ' home_inexact=' || count(*) filter (where w.decision = 'home' and not exists (
           select 1 from public.east_feed f
            cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data -> 'vacations') = 'array' then f.data -> 'vacations' else '[]'::jsonb end) as v(r)
            where (f.data -> 'isForecast') is distinct from 'true'::jsonb and jsonb_typeof(v.r) = 'object'
              and v.r ->> 'start' = to_char(w."start", 'YYYY-MM-DD') and v.r ->> 'end' = to_char(w."end", 'YYYY-MM-DD'))) as detail
    from public.east_vacation_reviews w
),
ranges as (
  select 5 as ord, 'ranges'::text as section, ''::text as role,
         case when to_regprocedure('public.silvis_east_ranges()') is null or to_regprocedure('public.silvis_derived_vacations()') is null then 'functions=absent'
              else (xpath('/row/t/text()', query_to_xml('select ''merged='' || count(*) || '' away='' || count(*) filter (where r.state = ''away'') || '' home='' || count(*) filter (where r.state = ''home'') || '' unreviewed='' || count(*) filter (where r.state = ''unreviewed'') || '' derived='' || (select count(*) from public.silvis_derived_vacations()) as t from public.silvis_east_ranges() r', false, true, '')))[1]::text end as detail
),
cron_jobs as (
  select 6 as ord, 'cron'::text as section, ''::text as role,
         'jobs=' || count(*) || ' active=' || count(*) filter (where j.active)
      || ' east_job=' || case when bool_or(j.jobname = 'silvis-east-feed-daily') then 'yes' else 'no' end as detail
    from cron.job j
),
pgnet as (
  select 7 as ord, 'pg_net'::text as section, ''::text as role,
         'version=' || coalesce((select e.extversion from pg_extension e where e.extname = 'pg_net'), 'absent') as detail
),
realtime as (
  select 8 as ord, 'realtime'::text as section, ''::text as role,
         'publication=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime') then 'yes' else 'no' end
      || ' all_tables=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime' and b.puballtables) then 'yes' else 'no' end
      || ' time_off=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'time_off') then 'yes' else 'no' end
      || ' east_feed=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'east_feed') then 'yes' else 'no' end
      || ' east_vacation_reviews=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'east_vacation_reviews') then 'yes' else 'no' end as detail
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from guard
union all select ord, section, role, detail from feed
union all select ord, section, role, detail from reviews
union all select ord, section, role, detail from ranges
union all select ord, section, role, detail from cron_jobs
union all select ord, section, role, detail from pgnet
union all select ord, section, role, detail from realtime
order by ord, role;
