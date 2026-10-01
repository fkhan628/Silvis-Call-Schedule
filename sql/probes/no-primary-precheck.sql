-- ============================================================================
-- Silvis Call Schedule - no-primary days PRE-CHECK (2026-10-01, Prompt 28; sql/migrations/2026-10-01-no-primary-days.sql,
-- REPORT-FIRST, NOT APPLIED). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again
-- right after it (Faraz's apply script, kept outside the repo, does both); its rows are facts for the record, only the first one is a gate.
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/no-primary-precheck.sql
--
-- Columns: ord, section, person_id, detail - ordered by ord, person_id ("today" = the Central date):
--   1 functions                         np_fn=<yes|no> offers5=<yes|no> offers7=<yes|no> overloads=<n> - the apply gate:
--                                       before the apply it reads np_fn=no offers5=yes offers7=no overloads=1,
--                                       after it np_fn=yes offers5=no offers7=yes overloads=1
--                                       (offers5 / offers7 = the five- / seven-argument save_offers)
--   2 availability total                rows=<n> - the client reads availability unpaged (PostgREST max-rows, Supabase default
--                                       1000); each no-primary day adds a row
--   3 backup_only rows                  per person: single=<n> ranges=<n> with_note=<n> sources=<list> - with_note is a COUNT of
--                                       rows whose note is not empty (never the text: notes in an anon-readable table carry no reasons)
--   4 offer conflict                    per person: the days (today or later) with a primary / either offer on a day a backup_only
--                                       row of his covers (the painter would show both; a Save touching such a day is refused NP009)
--   5 primary held on a no-primary day  per person: the days (today or later) he holds primary on schedule_days while a backup_only
--                                       row of his covers the day (expected: Burchett's 10/15 - the seed's October backup-only list
--                                       versus the primary he took on 9/25; nothing here changes either)
-- ============================================================================
with today as (
  select (now() at time zone 'America/Chicago')::date as d
),
fns as (
  select 1 as ord, 'functions'::text as section, ''::text as person_id,
         'np_fn=' || case when to_regprocedure('public.save_no_primary(text, date[], date[])') is null then 'no' else 'yes' end
      || ' offers5=' || case when to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text)') is null then 'no' else 'yes' end
      || ' offers7=' || case when to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text, date[], date[])') is null then 'no' else 'yes' end
      || ' overloads=' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_offers') as detail
),
total as (
  select 2 as ord, 'availability total'::text as section, ''::text as person_id, 'rows=' || (select count(*) from public.availability) as detail
),
bo as (
  select 3 as ord, 'backup_only rows'::text as section, a.person_id,
         'single=' || count(*) filter (where a.start_date = a.end_date)
      || ' ranges=' || count(*) filter (where a.start_date < a.end_date)
      || ' with_note=' || count(*) filter (where nullif(btrim(coalesce(a.note, '')), '') is not null)
      || ' sources=' || string_agg(distinct coalesce(a.source, '(none)'), ',' order by coalesce(a.source, '(none)')) as detail
    from public.availability a
   where a.kind = 'backup_only'
   group by a.person_id
),
conflict as (
  select 4 as ord, 'offer conflict'::text as section, o.person_id, 'days=' || string_agg(to_char(o.day, 'YYYY-MM-DD'), ',' order by o.day) as detail
    from public.call_offers o
    cross join today t
   where o.day >= t.d and o.role_pref in ('primary', 'either')
     and exists (select 1 from public.availability a where a.person_id = o.person_id and a.kind = 'backup_only' and o.day between a.start_date and a.end_date)
   group by o.person_id
),
held as (
  select 5 as ord, 'primary held on a no-primary day'::text as section, s.primary_id as person_id, 'days=' || string_agg(to_char(s.day, 'YYYY-MM-DD'), ',' order by s.day) as detail
    from public.schedule_days s
    cross join today t
   where s.day >= t.d and s.primary_id is not null
     and exists (select 1 from public.availability a where a.person_id = s.primary_id and a.kind = 'backup_only' and s.day between a.start_date and a.end_date)
   group by s.primary_id
)
select ord, section, person_id, detail from fns
union all select ord, section, person_id, detail from total
union all select ord, section, person_id, detail from bo
union all select ord, section, person_id, detail from conflict
union all select ord, section, person_id, detail from held
order by ord, person_id;
