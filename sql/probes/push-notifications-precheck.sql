-- ============================================================================
-- Silvis Call Schedule - phone push PRE-CHECK (2026-10-03, Prompt 30; sql/migrations/2026-10-03-push-notifications.sql,
-- REPORT-FIRST; APPLIED 2026-10-03 16:30:43Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right
-- after it (Faraz's apply script, kept outside the repo, does both); its rows are facts for the record, only the first one is a gate.
-- As run (2026-10-03): before the apply the gate read table=no push_cols=0 save_fn=no delete_fn=no status_fn=no and right
-- after it table=yes push_cols=2 save_fn=yes delete_fn=yes status_fn=yes, rows 2-5 the same both times (counts only) -
-- docs/SCHEMA-REVIEW.md "2026-10-03 - phone push" quotes them. This header was kept byte for byte as reviewed until the apply
-- (the apply script pinned its sha256); the record step turned it APPLIED.
-- It runs before the migration, so it never names the new table or columns outside catalog lookups (pg_attribute, to_regclass,
-- to_regprocedure, pg_publication_tables).
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/push-notifications-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (counts only: no name, no email, no id, no endpoint):
--   1 objects   table=<yes|no> push_cols=<0|1|2> save_fn=<yes|no> delete_fn=<yes|no> status_fn=<yes|no> - the apply gate
--               (push_cols = how many of trade_updates_push / schedule_updates_push notification_preferences carries; the three
--               functions by their exact signatures):
--               before the apply it reads table=no push_cols=0 save_fn=no delete_fn=no status_fn=no,
--               after it table=yes push_cols=2 save_fn=yes delete_fn=yes status_fn=yes
--   2 profiles  per role: n=<n> linked=<n> following=<n> app=<n> (who could turn phone notifications on: every signed-in account
--               with a profile row)
--   3 prefs     rows=<n> person=<n> profile=<n> (the notification_preferences rows - a surgeon's by person_id, a follower's by
--               profile_id - that gain the two default-on columns)
--   4 audit     push_rows=<n> (0 before the apply: the push.save / push.delete rows are written by the new functions only)
--   5 realtime  publication=<yes|no> all_tables=<yes|no> push_subscriptions_published=<yes|no> - the supabase_realtime publication
--               facts (all_tables=yes would publish the new table - the apply script stops on it before anything is applied)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'table=' || case when to_regclass('public.push_subscriptions') is null then 'no' else 'yes' end
      || ' push_cols=' || (select count(*) from pg_attribute a where a.attrelid = 'public.notification_preferences'::regclass
                            and a.attname in ('trade_updates_push', 'schedule_updates_push') and not a.attisdropped)
      || ' save_fn=' || case when to_regprocedure('public.save_push_subscription(text, text, text, text)') is null then 'no' else 'yes' end
      || ' delete_fn=' || case when to_regprocedure('public.delete_push_subscription(text)') is null then 'no' else 'yes' end
      || ' status_fn=' || case when to_regprocedure('public.push_subscription_status(text)') is null then 'no' else 'yes' end as detail
),
profiles as (
  select 2 as ord, 'profiles'::text as section, u.role,
         'n=' || count(*)
      || ' linked=' || count(*) filter (where u.person_id is not null)
      || ' following=' || count(*) filter (where jsonb_typeof(u.follows) = 'array' and jsonb_array_length(u.follows) > 0)
      || ' app=' || count(*) filter (where u.is_app) as detail
    from public.user_profiles u
   group by u.role
),
prefs as (
  select 3 as ord, 'prefs'::text as section, ''::text as role,
         'rows=' || count(*)
      || ' person=' || count(*) filter (where p.person_id is not null)
      || ' profile=' || count(*) filter (where p.profile_id is not null) as detail
    from public.notification_preferences p
),
audit as (
  select 4 as ord, 'audit'::text as section, ''::text as role,
         'push_rows=' || (select count(*) from public.audit_log l where l.action like 'push.%') as detail
),
realtime as (
  select 5 as ord, 'realtime'::text as section, ''::text as role,
         'publication=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime') then 'yes' else 'no' end
      || ' all_tables=' || case when exists (select 1 from pg_publication b where b.pubname = 'supabase_realtime' and b.puballtables) then 'yes' else 'no' end
      || ' push_subscriptions_published=' || case when exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'push_subscriptions') then 'yes' else 'no' end as detail
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from profiles
union all select ord, section, role, detail from prefs
union all select ord, section, role, detail from audit
union all select ord, section, role, detail from realtime
order by ord, role;
