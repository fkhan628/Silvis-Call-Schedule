-- ============================================================================
-- Silvis Call Schedule - phone push follow-ups PRE-CHECK (2026-10-20, revision z; sql/migrations/2026-10-20-push-followups.sql,
-- REPORT-FIRST; APPLIED 2026-10-22 04:33:15Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right
-- after it (Faraz's apply script, kept outside the repo, does both): rows 1-5 are the gate, rows 6-8 are facts for the record. It runs
-- before the migration, so it never names the new function or column outside catalog lookups (to_regprocedure, pg_proc, pg_attribute)
-- and the query_to_xml text of row 6, which runs only when the column exists.
-- As run (2026-10-22): before the apply the gate read replace_fn=no reminder_col=no save_fn=yes sha256=yes and right after it
-- replace_fn=yes reminder_col=yes save_fn=yes sha256=yes; row 2 save=10c2561dbe84d22b116491deb92e95ad replace=none before and
-- save=10c2561dbe84d22b116491deb92e95ad replace=966c4117d3e5a1e1d5224dcade3e63ad after (save's the applied Prompt 30 body both times);
-- row 3 save=definer/volatile replace=none paths=1 before and save=definer/volatile replace=definer/volatile paths=2 after; row 4
-- save=f/t/f replace=none before and save=f/t/f replace=f/t/f after; row 5 subs_force=f audit_force=f owner_match=yes both times; row 6
-- rows=2 person=2 profile=0 reminder_push=absent before and rows=2 person=2 profile=0 reminder_push_on=2 reminder_push_off=0 after (every
-- existing row on); rows 7 devices=3 accounts=1 most_on_one_account=3 failing=0 never_delivered=0 label_pairs_seen_twice=1 and 8
-- push_rows=3 added_30d=3 moved_30d=0 both times - docs/SCHEMA-REVIEW.md "2026-10-20 - phone push follow-ups (revision z)" quotes them.
-- This header was kept byte for byte as reviewed until the apply (the apply script pinned its sha256); the record step turned it APPLIED.
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/push-followups-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (catalog facts and counts only: no name, no email, no id, no endpoint,
-- no device label):
--   1 objects  replace_fn=<yes|no> reminder_col=<yes|no> save_fn=<yes|no> sha256=<yes|no> - the apply gate (the new function by its
--              exact signature, the new column, save_push_subscription(text, text, text, text), pg_catalog.sha256(bytea) - the
--              function's hash): before the apply it reads
--              replace_fn=no reminder_col=no save_fn=yes sha256=yes,
--              after it replace_fn=yes reminder_col=yes save_fn=yes sha256=yes
--   2 bodies   save=<md5> replace=<md5|none> (md5 of each body: save's is the applied Prompt 30 body before AND after - revision z never
--              re-creates it; the apply script compares both with the bodies derived from the files)
--   3 sigs     save=<definer|invoker>/<volatility> replace=<definer|invoker>/<volatility>|none paths=<n> (search_path public, pg_temp)
--   4 grants   save=<anon>/<authenticated>/<public> replace=<...>|none (EXECUTE, t / f; PUBLIC read from the ACL, its default included -
--              expected save=f/t/f before and after, replace=none before and f/t/f after)
--   5 rls      subs_force=<t|f> audit_force=<t|f> owner_match=<yes|no> (no FORCE ROW LEVEL SECURITY on push_subscriptions or audit_log;
--              save's owner, and replace's once it exists, = the owner of both tables - the definers' delete, insert and audit row
--              pass RLS by ownership)
--   6 prefs    rows=<n> person=<n> profile=<n> reminder_push=absent before the apply; after it reminder_push_on=<n> reminder_push_off=<n>
--              (every existing row reads on right after the apply: on = rows, off = 0)
--   7 devices  devices=<n> accounts=<n> most_on_one_account=<n> failing=<n> never_delivered=<n> label_pairs_seen_twice=<n> (the stale-row
--              signature: one account holding the same device label twice; aggregates only)
--   8 audit    push_rows=<n> added_30d=<n> moved_30d=<n> (the push.% audit rows; the push.save added / moved rows of the last 30 days)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'replace_fn=' || case when to_regprocedure('public.replace_push_subscription(text, text, text, text, text)') is null then 'no' else 'yes' end
      || ' reminder_col=' || case when exists (select 1 from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass
                                                  and a.attname = 'shift_reminders_push' and not a.attisdropped and a.attnum > 0) then 'yes' else 'no' end
      || ' save_fn=' || case when to_regprocedure('public.save_push_subscription(text, text, text, text)') is null then 'no' else 'yes' end
      || ' sha256=' || case when to_regprocedure('pg_catalog.sha256(bytea)') is null then 'no' else 'yes' end as detail
),
bodies as (
  select 2 as ord, 'bodies'::text as section, ''::text as role,
         'save=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.save_push_subscription(text, text, text, text)')), 'none')
      || ' replace=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.replace_push_subscription(text, text, text, text, text)')), 'none') as detail
),
sigs as (
  select 3 as ord, 'sigs'::text as section, ''::text as role,
         'save=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end
                                from pg_proc p where p.oid = to_regprocedure('public.save_push_subscription(text, text, text, text)')), 'none')
      || ' replace=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end
                                   from pg_proc p where p.oid = to_regprocedure('public.replace_push_subscription(text, text, text, text, text)')), 'none')
      || ' paths=' || (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.save_push_subscription(text, text, text, text)'),
                                                                     to_regprocedure('public.replace_push_subscription(text, text, text, text, text)'))
                                                        and 'search_path=public, pg_temp' = any(p.proconfig)) as detail
),
grants as (
  select 4 as ord, 'grants'::text as section, ''::text as role,
         'save=' || coalesce((select case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                                  || '/' || case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end
                                  || '/' || case when exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') then 't' else 'f' end
                                from pg_proc p where p.oid = to_regprocedure('public.save_push_subscription(text, text, text, text)')), 'none')
      || ' replace=' || coalesce((select case when has_function_privilege('anon', p.oid, 'execute') then 't' else 'f' end
                                     || '/' || case when has_function_privilege('authenticated', p.oid, 'execute') then 't' else 'f' end
                                     || '/' || case when exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE') then 't' else 'f' end
                                   from pg_proc p where p.oid = to_regprocedure('public.replace_push_subscription(text, text, text, text, text)')), 'none') as detail
),
rls as (
  select 5 as ord, 'rls'::text as section, ''::text as role,
         'subs_force=' || (select case when c.relforcerowsecurity then 't' else 'f' end from pg_class c where c.oid = 'public.push_subscriptions'::regclass)
      || ' audit_force=' || (select case when c.relforcerowsecurity then 't' else 'f' end from pg_class c where c.oid = 'public.audit_log'::regclass)
      || ' owner_match=' || case when (select bool_and(p.proowner = (select c.relowner from pg_class c where c.oid = 'public.push_subscriptions'::regclass)
                                                       and p.proowner = (select c.relowner from pg_class c where c.oid = 'public.audit_log'::regclass))
                                         from pg_proc p where p.oid in (to_regprocedure('public.save_push_subscription(text, text, text, text)'),
                                                                        to_regprocedure('public.replace_push_subscription(text, text, text, text, text)'))) then 'yes' else 'no' end as detail
),
prefs as (
  select 6 as ord, 'prefs'::text as section, ''::text as role,
         'rows=' || count(*)
      || ' person=' || count(*) filter (where n.person_id is not null)
      || ' profile=' || count(*) filter (where n.profile_id is not null)
      || ' ' || case when not exists (select 1 from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass
                                         and a.attname = 'shift_reminders_push' and not a.attisdropped and a.attnum > 0) then 'reminder_push=absent'
                     else (xpath('/row/t/text()', query_to_xml('select ''reminder_push_on='' || count(*) filter (where x.shift_reminders_push) || '' reminder_push_off='' || count(*) filter (where not x.shift_reminders_push) as t from public.notification_preferences x', false, true, '')))[1]::text end as detail
    from public.notification_preferences n
),
devices as (
  select 7 as ord, 'devices'::text as section, ''::text as role,
         'devices=' || (select count(*) from public.push_subscriptions)
      || ' accounts=' || (select count(distinct s.profile_id) from public.push_subscriptions s)
      || ' most_on_one_account=' || coalesce((select max(t.n) from (select count(*) as n from public.push_subscriptions s group by s.profile_id) t), 0)
      || ' failing=' || (select count(*) from public.push_subscriptions s where s.fail_count > 0)
      || ' never_delivered=' || (select count(*) from public.push_subscriptions s where s.last_ok_at is null)
      || ' label_pairs_seen_twice=' || (select count(*) from (select s.profile_id, s.device_label from public.push_subscriptions s group by 1, 2 having count(*) > 1) t) as detail
),
audit as (
  select 8 as ord, 'audit'::text as section, ''::text as role,
         'push_rows=' || count(*) filter (where l.action like 'push.%')
      || ' added_30d=' || count(*) filter (where l.action = 'push.save' and l.detail ->> 'action' = 'added' and l.created_at > now() - interval '30 days')
      || ' moved_30d=' || count(*) filter (where l.action = 'push.save' and l.detail ->> 'action' = 'moved' and l.created_at > now() - interval '30 days') as detail
    from public.audit_log l
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from bodies
union all select ord, section, role, detail from sigs
union all select ord, section, role, detail from grants
union all select ord, section, role, detail from rls
union all select ord, section, role, detail from prefs
union all select ord, section, role, detail from devices
union all select ord, section, role, detail from audit
order by ord, role;
