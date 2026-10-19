-- ============================================================================
-- Silvis Call Schedule - trade offer PRE-CHECK (2026-10-18, revision y; sql/migrations/2026-10-18-trade-offer.sql, REPORT-FIRST,
-- NOT APPLIED). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right after it
-- (Faraz's apply script, kept outside the repo, does both): rows 1-5 are the gate, rows 6-7 are facts for the record (D5: a backfill
-- of the legs row 6 lists would be its own report-first step - never a stop here). It runs before the migration, so it never names
-- the two new columns outside catalog lookups (pg_attribute).
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/trade-offer-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (catalog facts, roster ids, dates and counts only: no name, no email,
-- no note, no trade detail):
--   1 objects  cols=<none|proposed_by|accepted_by|proposed_by,accepted_by> insert_trg=<yes|no> update_trg=<yes|no> offers_trg=<yes|no>
--              east_vacations=<yes|no> - the apply gate (east_vacations = Part A's silvis_derived_vacations() exists: this file's
--              apply runs after Part A's, D8): before the apply it reads
--              cols=none insert_trg=yes update_trg=yes offers_trg=yes east_vacations=yes,
--              after it cols=proposed_by,accepted_by insert_trg=yes update_trg=yes offers_trg=yes east_vacations=yes
--   2 bodies   apply_trade=<md5> insert_guard=<md5> update_guard=<md5> offers_guard=<md5> (md5 of each body: before the apply
--              revisions m / p / n / j, after it y / y / y / j - the apply script compares both)
--   3 sigs     apply_trade=<definer|invoker> insert_guard=<...> update_guard=<...> offers_guard=<...> (by exact signature;
--              absent reads none)
--   4 grants   anon=<t|f> authenticated=<t|f> public=<t|f> (EXECUTE on apply_trade(uuid); PUBLIC read from the ACL, its default
--              included - expected anon=f authenticated=t public=f before and after)
--   5 rls      offers_force=<t|f> owner_match=<yes|no> (call_offers has no FORCE ROW LEVEL SECURITY and apply_trade's owner is
--              call_offers' owner - the definer's write passes RLS by ownership, as claim_open_slot's does)
--   6 legs     one summary row (role '') legs=<n> in_period=<n> uncovered=<n>, then one row per applied trade leg on a day inside
--              an offer period (the earliest start_day containing it, as rules.js picks) whose receiver has no covering offer that
--              day (role_pref = the leg's role or either), role = <day>:<leg>, detail trade=<first 8 of the id> leg=<1|2> day=<d>
--              role=<r> receiver=<roster id> holds=<yes|no> state=<submitted|rules_only|not_started> period=<start_day>
--   7 modes    one row per period with offer_modes keys that have no offer in the period (exhaustive / preferred chosen, nothing
--              painted), role = <start_day>, detail period=<start_day> status=<status> keys_without_offers=<ids, comma-separated>
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'cols=' || coalesce((select string_agg(a.attname, ',' order by a.attname desc) from pg_attribute a
                               where a.attrelid = 'public.shift_trade_requests'::regclass and a.attname in ('proposed_by', 'accepted_by')
                                 and not a.attisdropped and a.attnum > 0), 'none')
      || ' insert_trg=' || case when exists (select 1 from pg_trigger g where g.tgname = 'trade_insert_guard_trg' and g.tgrelid = 'public.shift_trade_requests'::regclass) then 'yes' else 'no' end
      || ' update_trg=' || case when exists (select 1 from pg_trigger g where g.tgname = 'trade_update_guard_trg' and g.tgrelid = 'public.shift_trade_requests'::regclass) then 'yes' else 'no' end
      || ' offers_trg=' || case when exists (select 1 from pg_trigger g where g.tgname = 'call_offers_guard_trg' and g.tgrelid = 'public.call_offers'::regclass) then 'yes' else 'no' end
      || ' east_vacations=' || case when to_regprocedure('public.silvis_derived_vacations()') is null then 'no' else 'yes' end as detail
),
bodies as (
  select 2 as ord, 'bodies'::text as section, ''::text as role,
         'apply_trade=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)')), 'none')
      || ' insert_guard=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.trade_insert_guard()')), 'none')
      || ' update_guard=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.trade_update_guard()')), 'none')
      || ' offers_guard=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.call_offers_guard()')), 'none') as detail
),
sigs as (
  select 3 as ord, 'sigs'::text as section, ''::text as role,
         'apply_trade=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)')), 'none')
      || ' insert_guard=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.trade_insert_guard()')), 'none')
      || ' update_guard=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.trade_update_guard()')), 'none')
      || ' offers_guard=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.call_offers_guard()')), 'none') as detail
),
grants as (
  select 4 as ord, 'grants'::text as section, ''::text as role,
         case when to_regprocedure('public.apply_trade(uuid)') is null then 'apply_trade=none'
              else 'anon=' || case when has_function_privilege('anon', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
                || ' authenticated=' || case when has_function_privilege('authenticated', 'public.apply_trade(uuid)', 'execute') then 't' else 'f' end
                || ' public=' || case when exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                                    where p.oid = to_regprocedure('public.apply_trade(uuid)') and x.grantee = 0 and x.privilege_type = 'EXECUTE') then 't' else 'f' end
         end as detail
),
rls as (
  select 5 as ord, 'rls'::text as section, ''::text as role,
         'offers_force=' || (select case when c.relforcerowsecurity then 't' else 'f' end from pg_class c where c.oid = 'public.call_offers'::regclass)
      || ' owner_match=' || case when (select p.proowner from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)'))
                                      = (select c.relowner from pg_class c where c.oid = 'public.call_offers'::regclass) then 'yes' else 'no' end as detail
),
legs_all as (
  select t.id, x.n, x.pid, x.dy, x.rl
    from public.shift_trade_requests t
   cross join lateral (values (1, t.to_surgeon_id, t.day, t.role),
                              (2, t.from_surgeon_id, t.return_day, case when t.return_role = 'primary' then 'primary' else 'backup' end)) x(n, pid, dy, rl)
   where t.status = 'applied' and x.dy is not null
),
legs_per as (
  select l.*, pp.start_day as per_start, pp.end_day as per_end, pp.rules_only_ids as per_ro
    from legs_all l
    left join lateral (select p.start_day, p.end_day, p.rules_only_ids from public.call_periods p
                        where l.dy between p.start_day and p.end_day order by p.start_day limit 1) pp on true
),
legs_open as (
  select l.*,
         case when l.per_ro ? l.pid then 'rules_only'
              when exists (select 1 from public.call_offers o where o.person_id = l.pid and o.day between l.per_start and l.per_end) then 'submitted'
              else 'not_started' end as state,
         exists (select 1 from public.schedule_days d where d.day = l.dy
                    and case when l.rl = 'primary' then d.primary_id else d.backup_id end = l.pid) as holds
    from legs_per l
   where l.per_start is not null
     and not exists (select 1 from public.call_offers o where o.person_id = l.pid and o.day = l.dy and o.role_pref in (l.rl, 'either'))
),
legs_sum as (
  select 6 as ord, 'legs'::text as section, ''::text as role,
         'legs=' || (select count(*) from legs_all) || ' in_period=' || (select count(*) from legs_per where per_start is not null)
      || ' uncovered=' || (select count(*) from legs_open) as detail
),
legs_rows as (
  select 6 as ord, 'legs'::text as section, l.dy::text || ':' || l.n::text as role,
         'trade=' || left(l.id::text, 8) || ' leg=' || l.n || ' day=' || l.dy || ' role=' || l.rl || ' receiver=' || l.pid
      || ' holds=' || case when l.holds then 'yes' else 'no' end || ' state=' || l.state || ' period=' || l.per_start as detail
    from legs_open l
),
modes as (
  select 7 as ord, 'modes'::text as section, p.start_day::text as role,
         'period=' || p.start_day || ' status=' || p.status || ' keys_without_offers='
      || string_agg(m.key, ',' order by m.key) as detail
    from public.call_periods p
   cross join lateral jsonb_object_keys(case when jsonb_typeof(p.offer_modes) = 'object' then p.offer_modes else '{}'::jsonb end) m(key)
   where not exists (select 1 from public.call_offers o where o.person_id = m.key and o.day between p.start_day and p.end_day)
   group by p.start_day, p.status
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from bodies
union all select ord, section, role, detail from sigs
union all select ord, section, role, detail from grants
union all select ord, section, role, detail from rls
union all select ord, section, role, detail from legs_sum
union all select ord, section, role, detail from legs_rows
union all select ord, section, role, detail from modes
order by ord, role;
