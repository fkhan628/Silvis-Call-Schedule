-- ============================================================================
-- Silvis Call Schedule - APP shifts PRE-CHECK (2026-11-17, revision ac - Prompt 35; sql/migrations/2026-11-17-app-shifts.sql,
-- REPORT-FIRST, NOT APPLIED). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right
-- after it (Faraz's apply script, kept outside the repo, does both); its rows are facts for the record - row 1 is the gate, row 2's
-- appdays_rows must read 0 before the apply (the migration refuses to type Prompt 29 call days), row 5 is graded after the apply.
-- It runs before the migration, so it never names the new column, table or functions outside catalog lookups (pg_attribute,
-- pg_constraint, to_regclass, to_regprocedure, pg_proc) and query_to_xml counts guarded by to_regclass.
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/app-shifts-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (counts only: no name, no email, no id):
--   1 objects   shift_type=<yes|no> pk=<columns> vac_table=<yes|no> types_fn=<yes|no> save_sig=<old|new|both|none> vac_fn=<yes|no>
--               names_vac=<yes|no> - the apply gate (names_vac = app_call_names() names the APP vacation holders):
--               before the apply it reads shift_type=no pk=day vac_table=no types_fn=no save_sig=old vac_fn=no names_vac=no,
--               after it shift_type=yes pk=day,shift_type,profile_id vac_table=yes types_fn=yes save_sig=new vac_fn=yes names_vac=yes
--   2 rows      appdays_rows=<n> appvac_rows=<n|absent> appdays_audit=<n> appvac_audit=<n> (appdays_rows must be 0 before the apply)
--   3 accounts  apps=<n> named_apps=<n> coordinators=<n> (the APP accounts: an unlinked viewer row with is_app; named = a
--               non-empty display_name - the calendar shows an APP by its display name)
--   4 setup     blob_types=<absent|n> holiday_years=<years with stored units, comma separated> (the blob's groupRules.appShiftTypes:
--               absent = the one decided Inbox type is the default; holiday_years = the years the inbox shift knows holidays for)
--   5 grants    save=<auth>/<anon> vac=<auth>/<anon> types=<auth>/<anon>/<service> names=<auth>/<anon> (t / f, '-' = no such function):
--               after the apply save=t/f vac=t/f types=f/f/t names=t/f
--   6 realtime  publication=<yes|no> all_tables=<yes|no> app_call_days_published=<yes|no> app_time_off_published=<yes|no> (facts, never
--               a stop: the client polls the APP tables, it subscribes to neither)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'shift_type=' || case when exists (select 1 from pg_attribute a where a.attrelid = 'public.app_call_days'::regclass and a.attname = 'shift_type' and not a.attisdropped) then 'yes' else 'no' end
      || ' pk=' || coalesce((select string_agg(a.attname, ',' order by array_position(k.conkey, a.attnum)) from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                             where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'p'), 'none')
      || ' vac_table=' || case when to_regclass('public.app_time_off') is null then 'no' else 'yes' end
      || ' types_fn=' || case when to_regprocedure('public.silvis_app_shift_types(jsonb)') is null then 'no' else 'yes' end
      || ' save_sig=' || case when to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)') is not null and to_regprocedure('public.save_app_days(uuid, jsonb, jsonb, uuid)') is not null then 'both'
                              when to_regprocedure('public.save_app_days(uuid, jsonb, jsonb, uuid)') is not null then 'new'
                              when to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)') is not null then 'old' else 'none' end
      || ' vac_fn=' || case when to_regprocedure('public.save_app_vacations(uuid, jsonb, uuid[])') is null then 'no' else 'yes' end
      || ' names_vac=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.app_call_names()') and p.prosrc like '%app_time_off%') then 'yes' else 'no' end as detail
),
rowcounts as (
  select 2 as ord, 'rows'::text as section, ''::text as role,
         'appdays_rows=' || (select count(*) from public.app_call_days)
      || ' appvac_rows=' || case when to_regclass('public.app_time_off') is null then 'absent'
                                 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.app_time_off', false, true, '')))[1]::text end
      || ' appdays_audit=' || (select count(*) from public.audit_log l where l.action = 'appdays.save')
      || ' appvac_audit=' || (select count(*) from public.audit_log l where l.action = 'appvac.save') as detail
),
accounts as (
  select 3 as ord, 'accounts'::text as section, ''::text as role,
         'apps=' || count(*) filter (where u.is_app and u.role = 'viewer' and u.person_id is null)
      || ' named_apps=' || count(*) filter (where u.is_app and u.role = 'viewer' and u.person_id is null and nullif(btrim(coalesce(u.display_name, '')), '') is not null)
      || ' coordinators=' || count(*) filter (where u.role = 'coordinator') as detail
    from public.user_profiles u
),
setup as (
  select 4 as ord, 'setup'::text as section, ''::text as role,
         'blob_types=' || coalesce((select case when jsonb_typeof(c.data #> '{groupRules,appShiftTypes}') = 'array' then jsonb_array_length(c.data #> '{groupRules,appShiftTypes}')::text else 'absent' end
                                      from public.call_schedule_data c where c.id = 'main'), 'no-blob')
      || ' holiday_years=' || coalesce((select string_agg(y.k, ',' order by y.k)
                                          from public.call_schedule_data c,
                                               jsonb_each(case when jsonb_typeof(c.data #> '{holidays,units}') = 'object' then c.data #> '{holidays,units}' else '{}'::jsonb end) y(k, v)
                                         where c.id = 'main' and jsonb_typeof(y.v) = 'array' and jsonb_array_length(y.v) > 0), 'none') as detail
),
grants as (
  select 5 as ord, 'grants'::text as section, ''::text as role,
         'save=' || coalesce((select case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end || '/' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                                from pg_proc p where p.oid = to_regprocedure('public.save_app_days(uuid, jsonb, jsonb, uuid)')), '-')
      || ' vac=' || coalesce((select case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end || '/' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                               from pg_proc p where p.oid = to_regprocedure('public.save_app_vacations(uuid, jsonb, uuid[])')), '-')
      || ' types=' || coalesce((select case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end || '/' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                                       || '/' || case when has_function_privilege('service_role', p.oid, 'execute') then 't' else 'f' end
                                 from pg_proc p where p.oid = to_regprocedure('public.silvis_app_shift_types(jsonb)')), '-')
      || ' names=' || coalesce((select case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end || '/' || case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                                 from pg_proc p where p.oid = to_regprocedure('public.app_call_names()')), '-') as detail
),
realtime as (
  select 6 as ord, 'realtime'::text as section, ''::text as role,
         'publication=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime') then 'yes' else 'no' end
      || ' all_tables=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime' and b.puballtables) then 'yes' else 'no' end
      || ' app_call_days_published=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'app_call_days') then 'yes' else 'no' end
      || ' app_time_off_published=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'app_time_off') then 'yes' else 'no' end as detail
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from rowcounts
union all select ord, section, role, detail from accounts
union all select ord, section, role, detail from setup
union all select ord, section, role, detail from grants
union all select ord, section, role, detail from realtime
order by ord, role;
