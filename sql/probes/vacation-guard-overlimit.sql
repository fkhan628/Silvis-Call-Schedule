-- ============================================================================
-- Silvis Call Schedule - vacation guard: the days ALREADY under the minimum (2026-09-30, Faraz 9/30 - Prompt 27;
-- sql/migrations/2026-09-30-vacation-guard.sql, REPORT-FIRST; APPLIED 2026-10-01 16:53:33Z). READ-ONLY: one SELECT, nothing is written, locked
-- or changed. Run it BEFORE the apply (done: 0 rows on 2026-10-01 at ~05:10 UTC, and again at 16:52 UTC as the apply run's
-- step 1) and whenever in doubt: the trigger never re-checks or deletes what is already there, but a non-scheduler's new
-- vacation over such a day is refused since the apply, so the scheduler should know these days.
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/vacation-guard-overlimit.sql
--
-- The same reading as the trigger: the ACTIVE roster surgeons of the blob (call_schedule_data 'main'; active not false, type
-- not 'external'), the minimum groupRules.vacations.minSurgeonsAround (a whole number 0-99, absent / junk -> 2); a surgeon is
-- off on a day inside one of his time_off rows, or inside one of his East (Davenport) vacation ranges cached in the east_feed
-- payload (an East-feature surgeon: eastFeed.enabled and a blocked role, a roster code; matched by code, forecast rows
-- skipped) on a day no 'home' east_vacation_reviews row covers (unreviewed counts as away). One row per day on which fewer
-- than the minimum stay around: the day, how many are around, the active count, the minimum, who is off (roster names in roster
-- order, each ONCE - his sources are aggregated per day and person first; tagged ' (East)' only when every source of his that
-- day is an East range, review 10/1) and whether the day is past (Central). No row = no day under the minimum. Past days are
-- listed too (they are history; the trigger checks only the days a new or widened vacation takes someone off). Also the check
-- for the trigger's known gap: an East review turned 'away' or a new Davenport range from the feed refresh is never refused, so
-- a day can fall under the minimum without any time_off write - run this after such a change when in doubt.
-- ============================================================================

with blob as (
  select c.data from public.call_schedule_data c where c.id = 'main'
),
minimum as (
  select coalesce((select case when jsonb_typeof(b.data #> '{groupRules,vacations,minSurgeonsAround}') = 'number'
                               then case when (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric between 0 and 99
                                          and (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric = trunc((b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric)
                                         then (b.data #>> '{groupRules,vacations,minSurgeonsAround}')::numeric::int end end
                     from blob b), 2) as n
),
roster as (
  select e.r->>'id' as id, e.ord, coalesce(e.r->>'name', e.r->>'id') as name, upper(coalesce(e.r->>'code', '')) as code,
         coalesce(e.r->>'code', '') <> ''
           and (b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'enabled']) = 'true'::jsonb
           and ((b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb
             or (b.data #> array['surgeonRules', e.r->>'id', 'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb) as east
    from blob b
    cross join lateral jsonb_array_elements(case when jsonb_typeof(b.data->'roster') = 'array' then b.data->'roster' else '[]'::jsonb end) with ordinality as e(r, ord)
   where jsonb_typeof(e.r) = 'object' and coalesce(e.r->>'id', '') <> ''
     and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external'
),
active_n as (
  select count(*)::int as n from roster
),
east_ranges as (
  select a.id, v.r->>'start' as s, v.r->>'end' as e
    from roster a
    join public.east_feed f on a.east
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.data->'vacations') = 'array' then f.data->'vacations' else '[]'::jsonb end) as v(r)
   where (f.data->'isForecast') is distinct from 'true'::jsonb
     and jsonb_typeof(v.r) = 'object'
     and upper(coalesce(v.r->>'code', '')) = a.code
     and coalesce(v.r->>'start', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and coalesce(v.r->>'end', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     and v.r->>'start' <= v.r->>'end'
),
off_days as (
  select g::date as day, t.person_id as id, false as east
    from public.time_off t
    join roster a on a.id = t.person_id
    cross join lateral generate_series(t.start_date::timestamp, t.end_date::timestamp, interval '1 day') as g
  union
  select g::date, er.id, true
    from east_ranges er
    cross join lateral generate_series(er.s::date::timestamp, er.e::date::timestamp, interval '1 day') as g
   where not exists (select 1 from public.east_vacation_reviews w
                      where w.person_id = er.id and w.decision = 'home' and g::date between w."start" and w."end")
),
off_people as (
  select o.day, o.id, bool_and(o.east) as east_only
    from off_days o
   group by o.day, o.id
)
select p.day,
       (select n from active_n) - count(distinct p.id)::int as around,
       (select n from active_n) as active,
       (select n from minimum) as minimum,
       string_agg(a.name || case when p.east_only then ' (East)' else '' end, ', ' order by a.ord) as off,
       p.day < (now() at time zone 'America/Chicago')::date as past
  from off_people p
  join roster a on a.id = p.id
 group by p.day
having (select n from active_n) - count(distinct p.id)::int < (select n from minimum)
 order by p.day;
