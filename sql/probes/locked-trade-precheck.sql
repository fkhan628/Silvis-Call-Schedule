-- ============================================================================
-- Silvis Call Schedule - locked trade PRE-CHECK (2026-10-25, revision ab; sql/migrations/2026-10-25-locked-trade.sql, REPORT-FIRST;
-- APPLIED 2026-10-26 03:50:31Z). READ-ONLY: one SELECT, nothing is written, locked or changed. Run it BEFORE the apply and again right after it (Faraz's
-- apply script, kept outside the repo, does both): rows 1-4 are the gate, row 5 is facts for the record (never a stop).
-- As run (2026-10-26): before the apply the gate read apply_trade=yes lock_check=yes null_safe=no offer_loop=yes and right after it
-- apply_trade=yes lock_check=no null_safe=yes offer_loop=yes; row 2 apply_trade=b5cca6f0f35b07923e6facb940d1f180 before (revision y) and
-- apply_trade=4d4bd67a722ff3e29b52b99a9a1cf1ef after (revision ab), insert_guard=303f173367b9c386dc0786bc4892657a
-- update_guard=304e0fddfcbda63c48340314003d441b claim=a38a708a166c28c7f3840387a366cb12 both times; rows 3-4 the same both times; row 5
-- locked_from_today=55 accepted=0 accepted_locked=0 pending=0 pending_locked=0 both times (no accepted trade on a locked leg - no REVIEW
-- line) - docs/SCHEMA-REVIEW.md "2026-10-25 - apply_trade moves a locked slot once the trade is accepted (revision ab)" quotes them. This
-- header was kept byte for byte as reviewed until the apply (the apply script pinned its sha256); the record step turned it APPLIED.
--
--   supabase db query --linked --workdir <dir> -o json -f <abs>/sql/probes/locked-trade-precheck.sql
--
-- Columns: ord, section, role, detail - ordered by ord, role (catalog facts, roster ids, dates and counts only: no name, no email,
-- no note, no trade detail):
--   1 objects  apply_trade=<yes|no> lock_check=<yes|no> null_safe=<yes|no> offer_loop=<yes|no> - the apply gate: lock_check =
--              apply_trade's body still carries check (c), the lock refusal ('is locked; ask the scheduler'); null_safe = its party test
--              refuses a signed-in caller with no roster link (revision ab); offer_loop = revision y's offer loop. Before the apply it
--              reads apply_trade=yes lock_check=yes null_safe=no offer_loop=yes, after it apply_trade=yes lock_check=no null_safe=yes offer_loop=yes
--   2 bodies   apply_trade=<md5> insert_guard=<md5> update_guard=<md5> claim=<md5> (md5 of each body: before the apply revision y's
--              apply_trade, after it revision ab's; the two trade guards (revision y) and claim_open_slot (the live body) the same both
--              times - the apply script compares all four)
--   3 sigs     apply_trade=<definer|invoker> claim=<definer|invoker> (by exact signature; absent reads none)
--   4 grants   anon=<t|f> authenticated=<t|f> public=<t|f> (EXECUTE on apply_trade(uuid); PUBLIC read from the ACL, its default
--              included - expected anon=f authenticated=t public=f before and after)
--   5 facts    one summary row (role '') locked_from_today=<n> (schedule_days slots locked, today and later in Central time)
--              accepted=<n> accepted_locked=<n> (trades left 'accepted' - not applied - and those with a leg on a slot locked now: the
--              ones the old refusal stopped; after the apply a party's Retry apply moves those whose days are today or later and whose
--              giver still holds the slot - review them in the dry run, since nobody can withdraw an accepted trade in the app)
--              pending=<n> pending_locked=<n>, then one row per accepted trade with a locked leg, role = <day>:<leg>, detail
--              trade=<first 8 of the id> leg=<1|2> day=<d> role=<r> from=<roster id> to=<roster id> holder=<the slot's holder now>
--              kind=<trade|give> past=<yes|no> (a day before today in Central time - the apply never makes those applicable by a party)
-- ============================================================================
with objects as (
  select 1 as ord, 'objects'::text as section, ''::text as role,
         'apply_trade=' || case when to_regprocedure('public.apply_trade(uuid)') is null then 'no' else 'yes' end
      || ' lock_check=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%is locked; ask the scheduler%') then 'yes' else 'no' end
      || ' null_safe=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%if not sched and auth.uid() is not null and (me is null or me not in (t.from_surgeon_id, t.to_surgeon_id)) then%') then 'yes' else 'no' end
      || ' offer_loop=' || case when exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)') and p.prosrc like '%for leg_n, leg_pid, leg_day, leg_role in%') then 'yes' else 'no' end as detail
),
bodies as (
  select 2 as ord, 'bodies'::text as section, ''::text as role,
         'apply_trade=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)')), 'none')
      || ' insert_guard=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.trade_insert_guard()')), 'none')
      || ' update_guard=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.trade_update_guard()')), 'none')
      || ' claim=' || coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.claim_open_slot(date, text)')), 'none') as detail
),
sigs as (
  select 3 as ord, 'sigs'::text as section, ''::text as role,
         'apply_trade=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.apply_trade(uuid)')), 'none')
      || ' claim=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end from pg_proc p where p.oid = to_regprocedure('public.claim_open_slot(date, text)')), 'none') as detail
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
legs as (
  select t.id, t.status, t.kind, t.from_surgeon_id, t.to_surgeon_id, x.n, x.dy, x.rl,
         case when x.rl = 'primary' then d.primary_locked else d.backup_locked end as locked,
         case when x.rl = 'primary' then d.primary_id else d.backup_id end as holder
    from public.shift_trade_requests t
   cross join lateral (values (1, t.day, t.role),
                              (2, t.return_day, case when t.return_role = 'primary' then 'primary' else 'backup' end)) x(n, dy, rl)
    left join public.schedule_days d on d.day = x.dy
   where t.status in ('accepted', 'pending') and x.dy is not null
),
facts_sum as (
  select 5 as ord, 'facts'::text as section, ''::text as role,
         'locked_from_today=' || (select count(*) from public.schedule_days d, lateral (values (d.primary_locked), (d.backup_locked)) v(lk)
                                   where v.lk and d.day >= (now() at time zone 'America/Chicago')::date)
      || ' accepted=' || (select count(*) from public.shift_trade_requests t where t.status = 'accepted')
      || ' accepted_locked=' || (select count(distinct l.id) from legs l where l.status = 'accepted' and l.locked)
      || ' pending=' || (select count(*) from public.shift_trade_requests t where t.status = 'pending')
      || ' pending_locked=' || (select count(distinct l.id) from legs l where l.status = 'pending' and l.locked) as detail
),
facts_rows as (
  select 5 as ord, 'facts'::text as section, l.dy::text || ':' || l.n::text as role,
         'trade=' || left(l.id::text, 8) || ' leg=' || l.n || ' day=' || l.dy || ' role=' || l.rl || ' from=' || l.from_surgeon_id
      || ' to=' || l.to_surgeon_id || ' holder=' || coalesce(l.holder, 'open') || ' kind=' || coalesce(l.kind, 'trade')
      || ' past=' || case when l.dy < (now() at time zone 'America/Chicago')::date then 'yes' else 'no' end as detail
    from legs l
   where l.status = 'accepted' and l.locked
)
select ord, section, role, detail from objects
union all select ord, section, role, detail from bodies
union all select ord, section, role, detail from sigs
union all select ord, section, role, detail from grants
union all select ord, section, role, detail from facts_sum
union all select ord, section, role, detail from facts_rows
order by ord, role;
