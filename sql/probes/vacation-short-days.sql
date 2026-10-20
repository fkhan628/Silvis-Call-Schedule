-- ============================================================================
-- Silvis Call Schedule - the days ALREADY under the vacation minimum, by the guard's reading since revision x (2026-10-14, Prompt 31
-- Part A; sql/migrations/2026-10-14-east-vacations.sql, REPORT-FIRST; APPLIED 2026-10-19 22:53:18Z). READ-ONLY: one SELECT, nothing is written, locked
-- or changed. Run it AFTER the apply (done: 0 days on 2026-10-19, the apply run's step 6, right after probe AFTER) and whenever in doubt: the guard never
-- re-checks or deletes what is already there, an East review turned 'away' or a new or longer Davenport range from a feed refresh is
-- never refused (the known gap), and a non-scheduler's new vacation over such a day is refused - so the scheduler should know these
-- days. BEFORE the apply it fails (function public.silvis_vacation_short_days does not exist): run
-- sql/probes/vacation-guard-overlimit.sql (the 9/30 reading) until then.
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/vacation-short-days.sql
--
-- The reading is public.silvis_vacation_short_days(null, null) - the ONE SQL definition of these days (critic A12), which the daily
-- server refresh's east.refresh audit reads too: the ACTIVE roster surgeons of the blob (call_schedule_data 'main'; active not false,
-- type not 'external'), the minimum groupRules.vacations.minSurgeonsAround (a whole number 0-99, absent / junk -> 2); a surgeon is off
-- on a day one of his time_off rows or one of his silvis_derived_vacations() rows covers (an East vacation range away or unreviewed -
-- the merged range; a 'home' review exempts only its exact range). One row per day on which someone is off and fewer than the
-- minimum stay around: the day, how many are around, the active count, the minimum, who is off (roster names in roster order, each
-- once; tagged ' (East)' when every source of his that day is a derived row) and whether the day is past (Central). No row = no day
-- under the minimum. Past days are listed too (they are history; the guard checks only the days a new or widened vacation takes
-- someone off). Nothing here counts on its own: change the reading in the function, never in this file.
-- ============================================================================

with names as (
  select e.r->>'id' as id, (array_agg(coalesce(e.r->>'name', e.r->>'id') order by e.ord))[1] as name
    from public.call_schedule_data c
    cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data->'roster') = 'array' then c.data->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
   where c.id = 'main' and jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
   group by e.r->>'id'
)
select s.day, s.around, s.active, s.minimum,
       (select string_agg(coalesce(n.name, x.id) || case when x.id = any(s.derived_only_ids) then ' (East)' else '' end, ', ' order by x.o)
          from unnest(s.off_ids) with ordinality as x(id, o)
          left join names n on n.id = x.id) as off,
       s.day < (now() at time zone 'America/Chicago')::date as past
  from public.silvis_vacation_short_days(null, null) s
 order by s.day;
