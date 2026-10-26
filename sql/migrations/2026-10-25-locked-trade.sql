-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-25 (revision ab): apply_trade moves a locked slot once the trade is accepted (Faraz 10/25:
-- a partner found trading too hard "with the locks and the multiple verifications"; "build the locked-trade fix (all locks, holidays
-- included) on a branch with the usual review and gate, and prepare the apply script for me to run once").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md: the security-definer function that writes published schedule rows is re-created). Nothing in
-- the repo applies it: Faraz runs his apply script (kept outside the repo) and pastes the log back.
--
-- The problem. apply_trade's check (c) refused every caller but the scheduler when a leg's role was locked that day ("TRADE_INELIGIBLE:
-- <day> <role> is locked; ask the scheduler"). The client never stops a trade on a locked slot (its trade checks read the rules with
-- the locks ignored), so two surgeons proposed and accepted it, the receiver's Accept called apply_trade, and the trade stayed
-- 'accepted' - not applied - until the scheduler pressed Retry apply. Nothing said it had not applied: his Alerts read "Shift trade
-- accepted", and his Waiting on you lists pending proposals only. On 2026-10-25 an anon read of the live schedule_days held 55 locked
-- slots from that day on (42 of them the import locks of 10/25-11/29, 6 manual, 6 east-derived, 1 left on a traded day), 48 of them
-- held by surgeons other than the scheduler.
-- The review of this file found a second, older gap in the same function: its party test `if not (sched or me = t.from_surgeon_id or
-- me = t.to_surgeon_id)` is NULL - and so passes - for a signed-in account with no roster link (the office, a viewer, a follower, an
-- APP), which could therefore apply any accepted trade; check (c) kept it off locked slots. Dropping (c) alone would have opened them.
--
-- What changes. ONE function re-created (create or replace); no table, column, policy, trigger, index, grant, row or anon surface:
--   apply_trade(uuid) - revision y's body byte for byte but two places: (1) check (c) - the two lock refusals inside `if not sched
--   then` - replaced by a three-line comment; (2) the party test made NULL-safe: a signed-in caller who is not the scheduler must be a
--   party BY HIS ROSTER LINK (no link = TRADE_FORBIDDEN, the same message); a server session (no signed-in user: the SQL editor, the
--   service role) passes as before. Every other check, refusal, lock and write is y's: TRADE_NOT_FOUND / TRADE_NOT_ACCEPTED /
--   TRADE_PAST (any non-scheduler, a day before today in Central time) / the time_off SHARE lock / TRADE_STALE / (a) the roster and
--   active receivers / (b) the receivers' vacations and the day before one / (d) the other role held; the writes (each moved role's
--   lock flag set false, source 'trade', version + 1); y's consent-stamp offer loop; the status flip; the trade.apply audit row. The
--   grants are re-run as they are (EXECUTE for authenticated; never PUBLIC or anon); the file ends with the reload.
--
-- Behaviour change. An accepted trade or give whose leg (or return leg) is locked now applies when a PARTY applies it - the receiver's
-- Accept in the app, or Retry apply by either party - exactly as it did when the scheduler applied it: the moved role's lock clears,
-- the day's source becomes 'trade' (Generate keeps a 'trade' row fixed in both modes - generator.js GEN_PERSON_FIXED_SOURCES), and
-- the other role's lock on that day stays as it was. Every lock the database holds counts, holidays included (Faraz 10/25); the
-- client's rules still refuse a member's trade of an East-derived locked day (rules.js derived-lock-held), so those 6 stay the
-- scheduler's in the app. A trade already left 'accepted' by the old refusal stays accepted until a party (or the scheduler) presses
-- Retry apply; the pre-check prints them (a day before today, or a slot the giver no longer holds, still refuses). A signed-in account
-- with no roster link can no longer apply any trade.
--
-- Who it binds. Every caller of apply_trade. A party (the receiver, or the proposer) once the trade is accepted - by the receiver
-- himself, or by the scheduler for him (trade_update_guard, unchanged); the scheduler, unchanged; a server session, unchanged; a
-- signed-in account with no roster link (the coordinator, a viewer, a follower, an APP): refused TRADE_FORBIDDEN. What still guards a
-- locked slot: Generate never moves it; claim_open_slot keeps CL007 (a locked OPEN slot is the scheduler's to assign - nobody takes it
-- from the Open shifts board); the scheduler's day editor asks for the unlock first; the client's rules check on both legs at propose
-- and accept.
--
-- Blast radius. One function body replaced; PostgREST reloaded (a no-op for the client, which already calls apply_trade this way and
-- shows Retry apply to parties and the scheduler only). No client, edge function, cron job, policy, table or anon surface changes;
-- claim_open_slot, the trade triggers and the generator stay as they are. Two existing probes graded the old refusal and read
-- differently after this file: sql/probes/trade-guards-probe.sql case D (a member applies a locked slot: refused before, applied with
-- the lock cleared after) - verify-rls section 5 - and sql/probes/trade-offer-probe.sql case A4 (the member's own apply of a locked slot
-- now succeeds, so the scheduler's apply after it finds the trade applied) - verify-rls section 21. No existing probe applies as an
-- unlinked account (trade-offer's admin with no link is the scheduler's role). The apply script expects exactly those two cases to
-- change and every other case of both, and of sql/probes/claim-open-slot-probe.sql, to read the same; the record step moves both
-- gradings and adds verify-rls section 24 for this file's probe. Residuals (recorded, not fixed): a unit is kept whole when it is
-- PROPOSED (the client's tradeUnitOf), but the Accept applies its rows one by one and stops at the first refusal, and a single day of a
-- unit inserted over REST is accepted like any trade - now on a locked unit too, as on an unlocked one; a lock set after a trade was
-- proposed no longer stops it; an accepted trade cannot be withdrawn in the app (cancel and decline are for pending ones - the
-- scheduler cancels by hand); a traded day leaves the holiday plan's Re-check (its source is no longer the plan's) and Clear schedule
-- clears it (it keeps locked slots only); a revert of a member's trade on a once-locked day leaves the slot unlocked; the scheduler is
-- told of a member-applied trade in Alerts and the audit log, not by e-mail.
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-locked-trade.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-25-locked-trade.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction, and a paste into the SQL editor runs as one session too - a failure
-- anywhere changes nothing.
-- Order: on the database after revision y (applied 2026-10-20 00:41:25Z - this body is y's but for the two places above); any time
-- of day (no cron job calls apply_trade), not while a trade is being accepted. 1. the pre-check sql/probes/locked-trade-precheck.sql
-- (read-only; rows 1-4 the gate - lock_check=yes null_safe=no offer_loop=yes, the four live bodies' md5, definer, the grants - row 5
-- facts, never a stop: the accepted trades on a locked leg are the ones the apply makes applicable - review them in the dry run);
-- 2. the regression probes BEFORE (sql/probes/trade-guards-probe.sql, sql/probes/claim-open-slot-probe.sql,
-- sql/probes/trade-offer-probe.sql - their case=value lists kept); 3. probe BEFORE sql/probes/locked-trade-probe.sql (expects
-- PROBE_SETUP: apply_trade still refuses ...); 4. this file; 5. the gate after (lock_check=no null_safe=yes and this file's body md5);
-- 6. probe AFTER (18 cases, each as its header lists) and its leftover count 0; 7. the regression probes AFTER (the same lists but
-- trade-guards D and trade-offer A4, each as above); 8. the record step in docs/SCHEMA-REVIEW.md "2026-10-25 - apply_trade moves a
-- locked slot once the trade is accepted (revision ab)".
-- Re-running: idempotent (create or replace; the grants re-run); the apply script refuses to re-run it anyway (its gate).
-- Rolling back (nothing is lost: trades applied meanwhile stay applied; their slots stay as they were moved). Valid while the two trade
-- guards are still revision y's (the pre-check's bodies row shows it), since the file re-creates them too:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-18-trade-offer.sql   (revision y, idempotent: apply_trade with check (c); its two guards are the live bodies)
-- ============================================================================

create or replace function public.apply_trade(p_trade_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t        public.shift_trade_requests%rowtype;
  d1       public.schedule_days%rowtype;
  d2       public.schedule_days%rowtype;
  me       text    := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  today_c  date    := (now() at time zone 'America/Chicago')::date;
  holder   text;
  roster   jsonb;
  leg_n    integer;
  leg_pid  text;
  leg_day  date;
  leg_role text;
  per_from date;
  per_to   date;
  per_ro   jsonb;
  wrote1   boolean := false;
  wrote2   boolean := false;
  to_name  text;
  fr_name  text;
  my_name  text;
  summary  text;
begin
  select * into t from public.shift_trade_requests where id = p_trade_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND' using errcode = 'P0001'; end if;
  -- (2026-10-25, revision ab) a party by his roster link: a signed-in caller with none (the office, a viewer, a follower, an APP) is
  -- refused too - `me = ...` is NULL for him, which the old test let through; a server session (no signed-in user) is unchanged
  if not sched and auth.uid() is not null and (me is null or me not in (t.from_surgeon_id, t.to_surgeon_id)) then
    raise exception 'TRADE_FORBIDDEN: only a party or the scheduler may apply this trade' using errcode = 'P0001';
  end if;
  if t.status <> 'accepted' then
    raise exception 'TRADE_NOT_ACCEPTED: status is %', t.status using errcode = 'P0001';
  end if;
  -- (2026-09-23, audit RLS-6) a past day is the scheduler's to change: a member may not rewrite history
  if not sched and (t.day < today_c or (t.return_day is not null and t.return_day < today_c)) then
    raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
      case when t.day < today_c then t.day else t.return_day end, today_c using errcode = 'P0001';
  end if;
  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day rows are locked and before the vacation check (b): a
  -- vacation of either receiver inserted or edited concurrently waits for this transaction (its trigger then sees the
  -- swap), or this function waits and (b) sees it - see the header. Lock order: trade row (update) -> time_off table
  -- (share) -> day rows (update).
  lock table public.time_off in share mode;
  select * into d1 from public.schedule_days where day = t.day for update;
  holder := case when t.role = 'primary' then d1.primary_id else d1.backup_id end;
  if not found or holder is distinct from t.from_surgeon_id then
    raise exception 'TRADE_STALE: % % is no longer held by %', t.day, t.role, t.from_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    select * into d2 from public.schedule_days where day = t.return_day for update;
    holder := case when t.return_role = 'primary' then d2.primary_id else d2.backup_id end;
    if not found or holder is distinct from t.to_surgeon_id then
      raise exception 'TRADE_STALE: % % is no longer held by %', t.return_day, t.return_role, t.to_surgeon_id using errcode = 'P0001';
    end if;
  end if;
  -- (a) roster present (fail closed) + each receiver is an ACTIVE roster entry
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' or jsonb_array_length(roster) = 0 then
    raise exception 'TRADE_INELIGIBLE: roster unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.to_surgeon_id using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and not exists (select 1 from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id and coalesce(r ->> 'active', 'true') <> 'false') then
    raise exception 'TRADE_INELIGIBLE: % is not an active roster surgeon', t.from_surgeon_id using errcode = 'P0001';
  end if;
  to_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.to_surgeon_id limit 1), t.to_surgeon_id);
  fr_name := coalesce((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = t.from_surgeon_id limit 1), t.from_surgeon_id);
  -- (b) neither receiver has a vacation over the day they would take (primary: nor the day before one)
  if exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and t.day between v.start_date and v.end_date) then
    raise exception 'TRADE_INELIGIBLE: % is on vacation on %', to_name, t.day using errcode = 'P0001';
  end if;
  if t.role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.to_surgeon_id and v.start_date = t.day + 1) then
    raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', to_name, t.day + 1 using errcode = 'P0001';
  end if;
  if t.return_day is not null then
    if exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and t.return_day between v.start_date and v.end_date) then
      raise exception 'TRADE_INELIGIBLE: % is on vacation on %', fr_name, t.return_day using errcode = 'P0001';
    end if;
    if t.return_role = 'primary' and exists (select 1 from public.time_off v where v.person_id = t.from_surgeon_id and v.start_date = t.return_day + 1) then
      raise exception 'TRADE_INELIGIBLE: % starts a vacation on % (primary the day before is blocked)', fr_name, t.return_day + 1 using errcode = 'P0001';
    end if;
  end if;
  -- (c) (2026-10-25, revision ab - Faraz: all locks, holidays included) a locked slot moves like any other once the trade is
  -- accepted, whichever party applies: no lock refusal for any caller. The transfer below clears the moved role's lock flag (the
  -- day's source becomes 'trade', which Generate keeps fixed); the other role's lock on that day stays as it was.
  -- (d) the receiver must not already hold the other role that day
  if (t.role = 'primary' and d1.backup_id = t.to_surgeon_id) or (t.role = 'backup' and d1.primary_id = t.to_surgeon_id) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', to_name, case when t.role = 'primary' then 'backup' else 'primary' end, t.day using errcode = 'P0001';
  end if;
  if t.return_day is not null
     and ((t.return_role = 'primary' and d2.backup_id = t.from_surgeon_id) or (t.return_role = 'backup' and d2.primary_id = t.from_surgeon_id)) then
    raise exception 'TRADE_INELIGIBLE: % already holds % on %', fr_name, case when t.return_role = 'primary' then 'backup' else 'primary' end, t.return_day using errcode = 'P0001';
  end if;
  -- writes
  if t.role = 'primary' then
    update public.schedule_days set primary_id = t.to_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  else
    update public.schedule_days set backup_id = t.to_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.day;
  end if;
  if t.return_day is not null then
    if t.return_role = 'primary' then
      update public.schedule_days set primary_id = t.from_surgeon_id, primary_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    else
      update public.schedule_days set backup_id = t.from_surgeon_id, backup_locked = false, version = version + 1, source = 'trade', updated_by = coalesce(me, 'scheduler'), updated_at = now() where day = t.return_day;
    end if;
  end if;
  -- (2026-10-18, revision y) a trade is an offer made on the spot, as a claim is: each leg's receiver gets a call_offers row
  -- for the day he takes when ALL hold - he agreed himself (the consent stamps: leg 1 when accepted_by is its receiver; the
  -- return leg when, besides, proposed_by is its receiver - a trade the scheduler accepted for someone writes none); the day
  -- is today or later in Central time (OF001 refuses a past day for every caller); it lies in an offer period - the earliest
  -- start_day containing it, as rules.js picks - where he already has an offer (submitted); he is not in its rules_only_ids
  -- and not an outside surgeon (roster type external); and a primary leg does not land on his No primary day (availability
  -- backup_only). Those reads run under the per-person advisory lock save_offers / save_no_primary take, for every leg (review
  -- 10/18: a save that clears his offers and turns him rules-only waits, or is waited for - never half seen). The claim's merge:
  -- the same role or an existing either is kept as it was; the other role becomes either and the trade hands the row to him
  -- (entered_by / source, as save_offers does). OFFER_FROZEN is bypassed for this write only (silvis.claim_in_progress). No
  -- exception handler: anything else rolls the whole apply back. Legs run in (person, day) order.
  for leg_n, leg_pid, leg_day, leg_role in
    select lg.n, lg.pid, lg.dy, lg.rl
      from (values (1, t.to_surgeon_id, t.day, t.role),
                   (2, t.from_surgeon_id, t.return_day, case when t.return_role = 'primary' then 'primary' else 'backup' end)) lg(n, pid, dy, rl)
     where lg.dy is not null
     order by lg.pid, lg.dy
  loop
    if leg_day < today_c then continue; end if;
    if t.accepted_by is distinct from t.to_surgeon_id then continue; end if;
    if leg_n = 2 and t.proposed_by is distinct from t.from_surgeon_id then continue; end if;
    if exists (select 1 from jsonb_array_elements(roster) e where e ->> 'id' = leg_pid and e ->> 'type' = 'external') then continue; end if;
    perform pg_advisory_xact_lock(hashtext('availability:no_primary:' || leg_pid));
    select p.start_day, p.end_day, p.rules_only_ids into per_from, per_to, per_ro
      from public.call_periods p where leg_day between p.start_day and p.end_day order by p.start_day limit 1;
    if not found then continue; end if;
    if per_ro ? leg_pid then continue; end if;
    if not exists (select 1 from public.call_offers o where o.person_id = leg_pid and o.day between per_from and per_to) then continue; end if;
    if leg_role = 'primary'
       and exists (select 1 from public.availability a where a.person_id = leg_pid and a.kind = 'backup_only' and leg_day between a.start_date and a.end_date) then
      continue;
    end if;
    perform set_config('silvis.claim_in_progress', 'on', true);
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
    values (leg_pid, leg_day, leg_role, null, leg_pid, 'app')
    on conflict (person_id, day) do update
       set role_pref  = case when public.call_offers.role_pref = excluded.role_pref then public.call_offers.role_pref else 'either' end,
           entered_by = case when public.call_offers.role_pref in (excluded.role_pref, 'either') then public.call_offers.entered_by else excluded.entered_by end,
           source     = case when public.call_offers.role_pref in (excluded.role_pref, 'either') then public.call_offers.source else excluded.source end,
           updated_at = now();
    perform set_config('silvis.claim_in_progress', '', true);
    if leg_n = 1 then wrote1 := true; else wrote2 := true; end if;
  end loop;
  perform set_config('silvis.apply_trade', '1', true);
  update public.shift_trade_requests set status = 'applied', decided_at = coalesce(decided_at, now()) where id = p_trade_id;
  perform set_config('silvis.apply_trade', '0', true);
  -- (2026-09-24, follow-up 5b) actor_name: display_name from the caller's own profile row, else the roster name for the caller's
  -- roster id, else the id; summary: the client's trade.accept wording family with the ROSTER names (to_name / fr_name), role
  -- words Primary / Backup and dates like "Sat Oct 10" (to_char 'Dy Mon FMDD' - English names regardless of lc_time).
  select nullif(p.display_name, '') into my_name from public.user_profiles p where p.id = auth.uid();
  my_name := coalesce(my_name, nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = me limit 1), ''), me);
  summary := 'Trade applied: ' || to_name || ' takes ' || case when t.role = 'primary' then 'Primary' else 'Backup' end
             || ' ' || to_char(t.day, 'Dy Mon FMDD') || ' (from ' || fr_name
             || case when t.return_day is null then ', one-way)'
                     else '; ' || fr_name || ' takes ' || case when t.return_role = 'primary' then 'Primary' else 'Backup' end
                          || ' ' || to_char(t.return_day, 'Dy Mon FMDD') || ' in return)' end;
  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'trade.apply', jsonb_build_object('summary', summary, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id, 'offer', wrote1, 'return_offer', wrote2));
  return jsonb_build_object('ok', true, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role);
end $$;
revoke all on function public.apply_trade(uuid) from public, anon;
grant execute on function public.apply_trade(uuid) to authenticated;

notify pgrst, 'reload schema';
