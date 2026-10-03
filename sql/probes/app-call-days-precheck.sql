-- ============================================================================
-- Silvis Call Schedule - APP call days PRE-CHECK (2026-10-02, Prompt 29; sql/migrations/2026-10-02-app-call-days.sql,
-- REPORT-FIRST; APPLIED 2026-10-02 19:19:27Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again
-- right after it (Faraz's apply script, kept outside the repo, does both); its rows are facts for the record, only the first one is a gate.
-- As run (2026-10-02): before the apply the gate read table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0 and right
-- after it table=yes is_app=yes is_app_fn=yes save_fn=yes names_fn=yes pins=2, rows 2-4 the same both times (counts only) -
-- docs/SCHEMA-REVIEW.md "2026-10-02 - APP call days" quotes them. This header was kept byte for byte as reviewed until the apply
-- (the apply script pinned its sha256); the record step turned it APPLIED.
-- It runs before the migration, so it never names the new column or table outside catalog lookups (pg_attribute, pg_policies,
-- to_regclass, to_regprocedure).
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/app-call-days-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (counts only: no name, no email, no id):
--   1 objects   table=<yes|no> is_app=<yes|no> is_app_fn=<yes|no> save_fn=<yes|no> names_fn=<yes|no> pins=<n> - the apply gate
--               (pins = how many of user_profiles_self_insert / _self_update carry is_app in their with check):
--               before the apply it reads table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0,
--               after it table=yes is_app=yes is_app_fn=yes save_fn=yes names_fn=yes pins=2
--   2 profiles  per role: n=<n> linked=<n> following=<n> named=<n> (named = a non-empty display_name - an APP is shown by its
--               display name, so the scheduler gives each APP account one before switching it to Role = app)
--   3 audit     appdays_rows=<n> (0 before the apply: the appdays.save rows are written by save_app_days only)
--   4 realtime  publication=<yes|no> all_tables=<yes|no> app_call_days_published=<yes|no> - the supabase_realtime publication
--               facts (a fact, never a stop: the client does not subscribe to app_call_days, and Realtime applies RLS - anon holds
--               no SELECT on the table)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'table=' || case when to_regclass('public.app_call_days') is null then 'no' else 'yes' end
      || ' is_app=' || case when exists (select 1 from pg_attribute a where a.attrelid = 'public.user_profiles'::regclass and a.attname = 'is_app' and not a.attisdropped) then 'yes' else 'no' end
      || ' is_app_fn=' || case when to_regprocedure('public.silvis_is_app()') is null then 'no' else 'yes' end
      || ' save_fn=' || case when to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)') is null then 'no' else 'yes' end
      || ' names_fn=' || case when to_regprocedure('public.app_call_names()') is null then 'no' else 'yes' end
      || ' pins=' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'user_profiles'
                       and p.policyname in ('user_profiles_self_insert', 'user_profiles_self_update') and coalesce(p.with_check, '') like '%is_app%') as detail
),
profiles as (
  select 2 as ord, 'profiles'::text as section, u.role,
         'n=' || count(*)
      || ' linked=' || count(*) filter (where u.person_id is not null)
      || ' following=' || count(*) filter (where jsonb_typeof(u.follows) = 'array' and jsonb_array_length(u.follows) > 0)
      || ' named=' || count(*) filter (where nullif(btrim(coalesce(u.display_name, '')), '') is not null) as detail
    from public.user_profiles u
   group by u.role
),
audit as (
  select 3 as ord, 'audit'::text as section, ''::text as role,
         'appdays_rows=' || (select count(*) from public.audit_log l where l.action = 'appdays.save') as detail
),
realtime as (
  select 4 as ord, 'realtime'::text as section, ''::text as role,
         'publication=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime') then 'yes' else 'no' end
      || ' all_tables=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime' and b.puballtables) then 'yes' else 'no' end
      || ' app_call_days_published=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'app_call_days') then 'yes' else 'no' end as detail
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from profiles
union all select ord, section, role, detail from audit
union all select ord, section, role, detail from realtime
order by ord, role;
