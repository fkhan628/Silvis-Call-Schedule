-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: trade / claim audit rows carry actor_name + summary (Prompt 16 follow-up 5b,
-- Faraz 9/24). Two functions, create or replace, idempotent; the two RPC revoke / grant pairs are re-run. No table, policy,
-- trigger or row is touched.
-- supersedes: sql/migrations/2026-09-24-definer-locks.sql
--   (same-day file order: B6's apply_trade() and claim_open_slot() bodies are re-created below with the audit change; B6 is
--    applied live already - this file runs AFTER it and builds on its final texts; test/schema.test.js freezes B6's two bodies)
--
-- REPORT-FIRST (CLAUDE.md, guide section 4.3): both functions are SECURITY DEFINER. Prepared here with the probe cases
-- (sql/probes/trade-guards-probe.sql E3 / F2, sql/probes/claim-open-slot-probe.sql B3 - both files roll themselves back) and
-- scripts/verify-rls.sh sections 5 and 7; the orchestrator applies it after Faraz's go. Nothing in the repo applies it.
--
-- What it fixes: apply_trade() wrote its audit_log row as (actor_id, action, detail) - actor_name null and no detail.summary -
-- so Settings > Activity log showed "?" for the actor and the raw action 'trade.apply' for the line (the client renders
-- (en.detail && en.detail.summary) || en.action, and the actor chip from actor_name). claim_open_slot() already wrote
-- actor_name (my_name, the roster name) but no summary either.
--
-- (1) apply_trade(): actor_name = the CALLER's user_profiles.display_name (own row, read as the table owner), else the roster
--     name for the caller's roster id (call_schedule_data 'main' -> roster[] -> name by id), else the id (me). detail.summary
--     in the client's trade.accept wording family, with the ROSTER names already resolved by id for the checks (to_name /
--     fr_name - never the stored from_surgeon_name / to_surgeon_name, which a status PATCH may rewrite), role words
--     Primary / Backup and dates like "Sat Oct 10" (to_char(day, 'Dy Mon FMDD') - English names regardless of lc_time):
--       one-way:  Trade applied: <to name> takes <Role> <Dy Mon D> (from <from name>, one-way)
--       two-way:  Trade applied: <to name> takes <Role> <Dy Mon D> (from <from name>; <from name> takes <Role> <Dy Mon D> in return)
--     Every other key of the detail object (trade_id, day, role, return_day, return_role, from, to) is kept; the day-row
--     writes, the locks (B6 lock order), the checks, the grants and the trigger are byte-for-byte as they were - only the
--     audit insert and the two helper lookups it needs are new.
-- (2) claim_open_slot(): detail.summary = the feed row's title it already composes, "<Name> took <M/D> <role>" (e.g. "Acton
--     took 4/7 backup"). The short form, not the notification sentence: the Activity log is a one-line list, the same words
--     as the in-app feed row read alike in both places, and the sentence's "(07:00 to 07:00)" is shift boilerplate the log
--     does not need. actor_name stays my_name.
--
-- Apply live with the Supabase CLI (absolute path), after 2026-09-24-definer-locks.sql (applied 2026-09-23 ~19:27 Central):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-trade-audit-names.sql
-- Observe it with sql/probes/trade-guards-probe.sql (cases E3 and F2 are the new ones) and
-- sql/probes/claim-open-slot-probe.sql (case B3) before and after - both roll themselves back; scripts/verify-rls.sh
-- sections 5 and 7 grade them. Expected (';' is flattened to a space in the PROBE_RESULTS message, hence the two spaces):
--   trade E3  actor=null summary=null  ->  actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)
--   trade F2  actor=null summary=null  ->  actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)
--   claim B3  actor=Acton summary=null ->  actor=Acton summary=Acton took 4/7 backup
--   every other case unchanged. E3 shows the roster fallback (the probe's surgeon has no display_name), F2 the display_name
--   branch (the probe sets 'Probe Scheduler' on its scheduler) and the one-way wording.
-- The definitions below are byte-identical to sql/schema.sql (test/schema.test.js pins that, and freezes the superseded
-- 9/24 definer-locks apply_trade and claim_open_slot bodies by sha256).
-- Report-first (guide section 4.3): replaces two live functions; no row changes. Blast radius: from the apply on, every
-- trade.apply audit row carries actor_name and detail.summary and every schedule.claim row carries detail.summary - the
-- Activity log shows "Burchett" and "Trade applied: ..." instead of "?" and "trade.apply"; existing rows keep their nulls
-- (no backfill). Nothing reads detail.summary or actor_name server-side (no policy, trigger, view or edge function - the
-- edge functions only INSERT audit rows); the client reads both for display only. Pre-check (nothing to migrate):
--   select count(*) from public.audit_log where action = 'trade.apply' and actor_name is null;
-- ============================================================================

-- Apply an ACCEPTED trade atomically. Members cannot write schedule_days (scheduler-only RLS), so the
-- swap runs here as security definer with explicit checks: caller must be a party or the scheduler;
-- the trade must be 'accepted'; each leg must still be held by the expected surgeon (stale -> error);
-- both days get version+1 and source 'trade'; the trade becomes 'applied'; an audit row is written.
-- The distinct-roles check constraint still applies (a swap that would double-book a day fails loudly).
-- 2026-09-22 (Prompt 12 D.2): before ANY write, each leg's RECEIVER (leg 1 = to_surgeon_id, return
-- leg = from_surgeon_id) is checked, in this order, and TRADE_INELIGIBLE is raised with a plain reason:
--   (a) the roster in call_schedule_data 'main' is present (fail closed) and the receiver is an
--       ACTIVE roster entry (pool or external - any active entry counts; like the client, an entry
--       with no `active` key is active: coalesce(active, 'true') <> 'false');
--   (b) the leg's day is not inside a time_off range of the receiver (and, for a PRIMARY leg, is not
--       the day before one: the 07:00 shift end falls on the vacation day, the same rule the
--       time_off trigger enforces from the other side). Like that trigger, the SQL side hardcodes
--       PRIMARY here; the client reads groupRules.dayBeforeRules.trailingEdgeRoles (default primary);
--   (c) the leg's role is not locked on that day unless the caller is the scheduler; the transfer
--       clears the transferred role's lock flag (a traded slot is no longer the locked import);
--   (d) the receiver does not already hold the OTHER role that day. Evaluated per leg against the
--       pre-swap row, so a same-day role SWAP (A's primary for B's backup on one day) is refused as
--       'already holds' - before this change the same case tripped schedule_days_distinct_roles and
--       the client refuses it too; it is not a supported trade shape.
-- The app shows these messages verbatim, so they read as sentences.
-- 2026-09-23 (audit RLS-6): right after the 'accepted' check and before the first row lock, a caller
-- who is not the scheduler is refused with TRADE_PAST when the day or the return day is before today
-- in America/Chicago (strict <, like claim_open_slot's CL003) - past days are the scheduler's to change.
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): right after the TRADE_PAST refusal and BEFORE the day rows are
-- locked, the function takes `lock table public.time_off in share mode`. The race it closes: a vacation of a receiver
-- inserted or edited onto the day while the trade is applied - the time_off BEFORE trigger reads schedule_days without
-- locking, so under read committed both checks could pass (write skew). Every time_off writer holds ROW EXCLUSIVE on
-- the relation from statement start (before its trigger runs), and ROW EXCLUSIVE conflicts with SHARE: the vacation
-- write waits for this transaction and its trigger then sees the swap (ON_CALL_CONFLICT); in the other order this
-- function waits for the vacation and check (b), a fresh snapshot per statement, sees the new or moved range. A
-- row-level FOR SHARE would miss a row inserted concurrently (no predicate locks under read committed); the table lock
-- covers both sides. No cycle: a time_off writer never waits on a trade row or a day row (its trigger only READS
-- schedule_days; no function in this schema writes time_off), this function takes the time_off lock before any day
-- row, SHARE is not self-conflicting (concurrent applies do not serialise) and every reader holds ACCESS SHARE. The
-- lock runs as the table owner (security definer) and is held for the rest of the RPC's transaction - milliseconds.
-- Lock order: trade row (update) -> time_off table (share) -> day rows (update).
-- 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit row names its actor and carries a
-- one-line summary. actor_name = the caller's user_profiles.display_name, else the roster name for the caller's roster id, else the
-- id (the Activity log showed "?"); detail.summary = "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>, one-way)" for a
-- one-way trade, "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>; <from> takes <Role> <Dy Mon D> in return)" for a
-- two-way one - the client's trade.accept wording family, rendered where the log showed the raw action. Both surgeon names are
-- the roster's by id (to_name / fr_name), never the stored from_surgeon_name / to_surgeon_name (a status PATCH may rewrite
-- those). Every other key of the detail object, the writes, the checks and the locks are as before.
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
  to_name  text;
  fr_name  text;
  my_name  text;
  summary  text;
begin
  select * into t from public.shift_trade_requests where id = p_trade_id for update;
  if not found then raise exception 'TRADE_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (sched or me = t.from_surgeon_id or me = t.to_surgeon_id) then
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
  -- (c) locked slots move only when the scheduler applies (the transfer below clears the lock)
  if not sched then
    if (t.role = 'primary' and d1.primary_locked) or (t.role = 'backup' and d1.backup_locked) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.day, t.role using errcode = 'P0001';
    end if;
    if t.return_day is not null and ((t.return_role = 'primary' and d2.primary_locked) or (t.return_role = 'backup' and d2.backup_locked)) then
      raise exception 'TRADE_INELIGIBLE: % % is locked; ask the scheduler', t.return_day, t.return_role using errcode = 'P0001';
    end if;
  end if;
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
  values (me, my_name, 'trade.apply', jsonb_build_object('summary', summary, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));
  return jsonb_build_object('ok', true, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role);
end $$;
revoke all on function public.apply_trade(uuid) from public, anon;
grant execute on function public.apply_trade(uuid) to authenticated;

-- ============================================================================
-- claim_open_slot(p_day, p_role) - a linked surgeon takes an OPEN slot (2026-09-22, Prompt 13
-- part 2; applied live through sql/migrations/2026-09-22-claim-open-slot.sql, never by a git push)
--
-- A linked surgeon takes an OPEN slot from the Open shifts board. Modelled on
-- apply_trade(): security definer (members cannot write schedule_days under
-- RLS), explicit checks before the first write, version + 1 so every other
-- client's compare-and-swap sees the change, an audit row and an in-app feed
-- row in the SAME transaction (an error rolls all of it back).
--
-- What it guards: data integrity only - open, unlocked, not past (Central),
-- not external-covered, inside the published range, distinct roles, no
-- vacation conflict (incl. the day before a PRIMARY shift, mirroring the
-- time_off trigger). The JS eligibility rules (OR days, Clinton days, caps,
-- weekday patterns, consecutive runs) are enforced in the client before the
-- "Take this shift" button is offered, not here - the accepted boundary for a
-- six-surgeon group; everything the function does is logged.
--
-- Errors: each refusal has its own SQLSTATE (class CL, custom) and a plain
-- message prefixed with a stable token; PostgREST returns both and the app
-- shows the message verbatim.
--   CL001 CLAIM_NOT_LINKED      caller has no roster link (or is anon)
--   CL002 CLAIM_BAD_ROLE        role not in (primary, backup)
--   CL003 CLAIM_PAST            day is before today in America/Chicago
--   CL004 CLAIM_OUTSIDE_RANGE   day outside [min(day), max(day)] of schedule_days
--   CL005 CLAIM_HELD            slot already held
--   CL006 CLAIM_EXTERNAL        primary requested while external_cover is set
--   CL007 CLAIM_LOCKED          slot is locked (scheduler assigns from the editor)
--   CL008 CLAIM_OTHER_ROLE      caller already holds the other role that day
--   CL009 CLAIM_VACATION        a time_off row of the caller overlaps the day
--                               (or the next day when p_role = 'primary')
--
-- 2026-09-24 (Prompt 16 B6, review 9/23 section 3): after the four row-less refusals (CL001-CL004) and BEFORE the
-- day row is locked, the function takes `lock table public.time_off in share mode`, so a vacation of the caller
-- inserted or edited onto the day while the claim runs waits for this transaction (its trigger then sees the claim),
-- or the claim waits and CL009 sees the new row - the same write skew apply_trade() closes, same reasoning (every
-- time_off writer holds ROW EXCLUSIVE, which conflicts with SHARE), same deadlock argument (see apply_trade's header).
-- Lock order: time_off table (share) -> the day row (update).
-- 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit detail gains a summary key -
-- the feed row's title, "<Name> took <M/D> <role>" - so the Activity log renders a sentence instead of the raw action;
-- actor_name (the roster name, my_name) is unchanged. Nothing else in the body changes.
-- ============================================================================
create or replace function public.claim_open_slot(p_day date, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  today_c   date := (now() at time zone 'America/Chicago')::date;
  d         public.schedule_days%rowtype;
  lo        date;
  hi        date;
  other     text;
  held      text;
  is_locked boolean;
  my_name   text;
  vac       text;
  new_ver   integer;
  wrote_offer boolean := false;   -- P2 review: false for a rules_only claimer (no call_offers row)
  summary   text;
begin
  if auth.uid() is null or me is null then
    raise exception 'CLAIM_NOT_LINKED: sign in with an account that is linked to a roster entry to take a shift' using errcode = 'CL001';
  end if;
  if p_role is null or p_role not in ('primary', 'backup') then
    raise exception 'CLAIM_BAD_ROLE: role must be primary or backup (got %)', coalesce(p_role, 'null') using errcode = 'CL002';
  end if;
  if p_day is null or p_day < today_c then
    raise exception 'CLAIM_PAST: % is before today (%) in Central time; past days are not open', p_day, today_c using errcode = 'CL003';
  end if;

  -- The published range = every day between the first and the last schedule_days row.
  select min(day), max(day) into lo, hi from public.schedule_days;
  if lo is null or p_day < lo or p_day > hi then
    raise exception 'CLAIM_OUTSIDE_RANGE: % is outside the published schedule (% to %)', p_day, coalesce(lo::text, '-'), coalesce(hi::text, '-') using errcode = 'CL004';
  end if;

  -- (2026-09-24, Prompt 16 B6) SHARE on time_off before the day row is locked and before the vacation check (CL009): a
  -- vacation of the caller inserted or edited concurrently waits for this transaction, or this function waits and CL009
  -- sees it - see the header. Lock order: time_off table (share) -> the day row (update).
  lock table public.time_off in share mode;

  -- Lock the day's row; a day inside the range with no row gets one (source 'claim').
  select * into d from public.schedule_days where day = p_day for update;
  if not found then
    insert into public.schedule_days (day, source, version, updated_by, updated_at)
      values (p_day, 'claim', 1, me, now())
      on conflict (day) do nothing;
    select * into d from public.schedule_days where day = p_day for update;
  end if;

  other     := case when p_role = 'primary' then 'backup' else 'primary' end;
  held      := case when p_role = 'primary' then d.primary_id else d.backup_id end;
  is_locked := case when p_role = 'primary' then d.primary_locked else d.backup_locked end;

  if held is not null then
    raise exception 'CLAIM_HELD: % % is already held by %', p_day, p_role, held using errcode = 'CL005';
  end if;
  if p_role = 'primary' and coalesce(d.external_cover, '') <> '' then
    raise exception 'CLAIM_EXTERNAL: % primary is covered by % (outside the roster)', p_day, d.external_cover using errcode = 'CL006';
  end if;
  if is_locked then
    raise exception 'CLAIM_LOCKED: % % is locked; ask the scheduler to assign it', p_day, p_role using errcode = 'CL007';
  end if;
  if (case when p_role = 'primary' then d.backup_id else d.primary_id end) = me then
    raise exception 'CLAIM_OTHER_ROLE: you already hold % on %', other, p_day using errcode = 'CL008';
  end if;

  -- Vacation conflict: the day itself, plus the next day for a PRIMARY shift
  -- (the 07:00 shift end falls on the vacation day - same rule the time_off
  -- trigger enforces in the other direction).
  select string_agg(to_char(start_date, 'FMMM/FMDD') || '-' || to_char(end_date, 'FMMM/FMDD'), ', ' order by start_date)
    into vac
    from public.time_off
   where person_id = me
     and start_date <= (case when p_role = 'primary' then p_day + 1 else p_day end)
     and end_date   >= p_day;
  if vac is not null then
    raise exception 'CLAIM_VACATION: your vacation % conflicts with % % (a primary shift also blocks the day before a vacation)', vac, p_day, p_role using errcode = 'CL009';
  end if;

  -- The write. version + 1 makes every other client's compare-and-swap on this day fail loudly and reload.
  if p_role = 'primary' then
    update public.schedule_days
       set primary_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  else
    update public.schedule_days
       set backup_id = me, version = version + 1, source = 'claim', updated_by = me, updated_at = now()
     where day = p_day
     returning version into new_ver;
  end if;

  -- Prompt 14 P2 (9/23): a claim is an offer made on the spot - the record stays honest. One row per person and
  -- day: the claimed role, entered by the claimer, source 'app', no note. An existing offer in the same role is
  -- left as it was; one in the other role becomes 'either'. The freeze guard (OFFER_FROZEN) is bypassed for this
  -- transaction-local write only - the period closed before the schedule was published; CLAIM_PAST and
  -- CLAIM_VACATION above already enforce what OF001 / OF002 would.
  -- Review 9/23: NOT for a claimer listed in rules_only_ids of the period containing the day - one offer row
  -- would make offer_status() read 'submitted' for his whole period (see the header). Outside every period the
  -- row is written like any other offer (it is then a plain dated availability row for the engine).
  if not exists (select 1 from public.call_periods p where p_day between p.start_day and p.end_day and p.rules_only_ids ? me) then
    perform set_config('silvis.claim_in_progress', 'on', true);
    insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
    values (me, p_day, p_role, null, me, 'app')
    on conflict (person_id, day) do update
       set role_pref  = case when public.call_offers.role_pref = excluded.role_pref then public.call_offers.role_pref else 'either' end,
           updated_at = now();
    perform set_config('silvis.claim_in_progress', '', true);
    wrote_offer := true;
  end if;

  -- Display name from the roster blob (last name); falls back to the id.
  select r->>'name' into my_name
    from public.call_schedule_data c, jsonb_array_elements(coalesce(c.data->'roster', '[]'::jsonb)) r
   where c.id = 'main' and r->>'id' = me
   limit 1;
  my_name := coalesce(nullif(my_name, ''), me);

  -- (2026-09-24, follow-up 5b) detail.summary = the feed title below, so the Activity log shows "<Name> took <M/D> <role>".
  summary := my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role;
  insert into public.audit_log (actor_id, actor_name, action, detail)
  values (me, my_name, 'schedule.claim', jsonb_build_object('summary', summary, 'day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));

  -- In-app feed row: the claimer sees it through data.surgeon_id, the scheduler sees everything.
  insert into public.notifications (type, title, message, data)
  values ('shift_claimed',
          my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role,
          my_name || ' took the open ' || p_role || ' shift on ' || to_char(p_day, 'Dy FMMM/FMDD') || ' (07:00 to 07:00).',
          jsonb_build_object('day', p_day, 'role', p_role, 'surgeon_id', me, 'person_id', me));

  return jsonb_build_object('ok', true, 'day', p_day, 'role', p_role, 'person_id', me, 'version', new_ver);
end $$;

revoke all on function public.claim_open_slot(date, text) from public, anon;
grant execute on function public.claim_open_slot(date, text) to authenticated;
