-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-18 (revision y): a trade records the receiver's offer, as a claim does (Faraz 10/18:
-- "build revision y as recommended (D3 consent stamps, D2 submitted receivers only, D1 claim parity, and the rest as recommended)";
-- the decisions D1-D8 are in the private report docs/history/REPORT-APPLY-TRADE-OFFER-2026-10-18.md).
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md: a security-definer function that writes published schedule rows and two trigger functions on
-- a live table are re-created, and the table gains two columns). Nothing in the repo applies it: Faraz runs his apply script (kept
-- outside the repo) AFTER Part A's (revision x) and pastes the log back.
--
-- The problem. A claim writes the claimer's call_offers row ("a claim is an offer made on the spot"); apply_trade wrote none. A
-- receiver already submitted for the day's offer period then held a slot outside his offers: his My schedule tagged it "not
-- offered", the scheduler's day editor showed "not offered" words (a hard code - exhaustive not-offered, or a preferred dated list -
-- as "Not eligible"), and Generate listed it under fixedViolations.
--
-- What changes. One table gains two columns and three functions are re-created; no policy, grant, index, row or anon surface:
--   (1) shift_trade_requests.proposed_by / accepted_by (text, nullable) - the consent stamps (D3), written by the trade triggers only
--       (a client's value is overwritten on every insert and update): a roster id when that surgeon agreed himself, else 'scheduler'
--       (the scheduler, an admin, a server session). Null on every row from before this file: a trade accepted before it writes no offer
--       row, and one proposed before it and accepted after it writes the leg-1 receiver's only (the proposer's agreement was never stamped).
--   (2) trade_insert_guard() - revision p's body plus two lines after the same-surgeon refusal: proposed_by = the caller's own id when
--       he is the from surgeon, else 'scheduler'; accepted_by = the same from the to surgeon for a row inserted already accepted (the
--       scheduler or a server session - a member's row lands pending), else null. Its trigger is re-created as it was.
--   (3) trade_update_guard() - revision n's body plus a block at the top, before the scheduler's return: a move into accepted stamps
--       accepted_by (the to surgeon's own id when he accepts himself, else 'scheduler'); a change of the legs (the scheduler only - a
--       member is refused TRADE_IMMUTABLE as before) re-stamps both as the insert guard does, since an agreement to the old legs is
--       not one to the new; every other update keeps both as they were. Its trigger is re-created as it was.
--   (4) apply_trade(uuid) - revision m's body plus, after the schedule_days writes and before the status flip, one call_offers upsert
--       per leg (in person, day order) when ALL hold: the leg's receiver agreed himself (leg 1: accepted_by = to_surgeon_id; the
--       return leg: also proposed_by = from_surgeon_id); the day is today or later in Central time (OF001 refuses a past day for
--       every caller); it lies in an offer period - the earliest start_day containing it, as rules.js picks - where he already has an
--       offer (D2: submitted); he is not in that period's rules_only_ids and not an outside surgeon (roster type external); a primary
--       leg does not land on his No primary day (availability backup_only - D6). Every leg's reads run under the per-person advisory
--       lock save_offers / save_no_primary take (review 10/18: a save that clears his offers and turns him rules-only is never half seen). The claim's merge (D4): the same role or an existing either is kept as it was; the other role
--       becomes either and the row is handed to him (entered_by / source from the trade, as save_offers does). Source 'app',
--       entered_by the receiver, note null; OFFER_FROZEN bypassed for that write only (silvis.claim_in_progress, as the claim). The
--       trade.apply audit detail gains the booleans offer / return_offer (D7). Every check, refusal, lock and write before the loop is
--       m's, byte for byte; there is no exception handler (fail closed: anything unforeseen rolls the whole apply back, as today).
--
-- What it changes for the receiver (D1, claim parity). Exhaustive: the traded day reads offered; nothing else of his changes. Preferred:
-- the row lifts a dated list on that date and role and counts that calendar month as one he painted (B10's per-month scope), exactly
-- as a claim does ("taking it counts as painting it"). A not-started or rules-only receiver, and every day outside a period, keep
-- today's reading (no row - D2).
--
-- Who it binds. Every caller of apply_trade (a party or the scheduler) and every writer of shift_trade_requests. The test is the
-- receiver's own agreement, recorded on the row, whoever presses apply: a trade on a locked slot (the scheduler applies those) that
-- two surgeons agreed writes their rows; the scheduler accepting for someone, or "Accept anyway as the scheduler", writes none.
--
-- Blast radius. An applied trade may write up to two call_offers rows (authenticated-only, never anon); no status changes in the day's
-- own (earliest) period, where only a submitted receiver gets a row; where two periods overlap, the later one's can change (rules-only
-- or not started -> submitted), as offer_status() and rules.js count every offer day inside a period. The client reads the trade rows
-- with their new columns and ignores them; no client sends them. The other probes' trade fixtures (verify-rls section 5: 2030-03, 2020-02) lie in no call period and write no offer row. Residuals
-- (recorded, claim parity): a revert of the trade leaves the receiver's offer on a day he no longer holds; the giver's own offer on
-- the day he gave stays; a trade accepted before this file writes no row when it is applied after it, and one proposed before it and
-- accepted after it writes the leg-1 receiver's row only.
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-trade-offer.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-18-trade-offer.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction, and a paste into the SQL editor runs as one session too - a failure
-- anywhere changes nothing.
-- Order: after Part A (revision x, sql/migrations/2026-10-14-east-vacations.sql: its apply script pins scripts/verify-rls.sh, which
-- this file's record step edits). 1. the pre-check sql/probes/trade-offer-precheck.sql (read-only: the columns absent, the four
-- bodies' md5 = revisions m / p / n / j, no FORCE RLS on call_offers, apply_trade's owner = call_offers' owner; facts: the applied
-- trade legs inside a period without a covering offer - D5, printed, never a stop); 2. probe BEFORE sql/probes/trade-offer-probe.sql
-- (expects PROBE_SETUP: shift_trade_requests.accepted_by is absent ...); 3. this file; 4. the gate after; 5. probe AFTER (every case as
-- its header lists); 6. the record step in docs/SCHEMA-REVIEW.md "2026-10-18 - apply_trade writes the receiver's offer (revision y)".
-- Re-running: idempotent (add column if not exists; create or replace; the triggers dropped and re-created; the grants re-run); the
-- apply script refuses to re-run it anyway (its gate).
-- Rolling back (in this order; nothing is lost - offer rows already written stay, and the trade.apply rows with offer / return_offer
-- true name the legs that wrote or merged one; the two columns stay, with their stamps - re-applying this file after a rollback is its own
-- report-first step that first nulls the stamps of the rows not yet applied):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-trade-audit-names.sql   (apply_trade m; claim_open_slot m, the live body)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-give-kind.sql   (trade_update_guard n; its DDL is idempotent)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-25-member-trade-return-leg.sql   (trade_insert_guard p - after give-kind)
--   notify pgrst, 'reload schema';
-- ============================================================================

-- 2026-10-18 (revision y, sql/migrations/2026-10-18-trade-offer.sql): the consent stamps - who agreed, recorded on the row, so apply_trade
-- writes a receiver's offer only for a receiver who agreed himself, whoever applies the trade (a locked slot moves only when the scheduler
-- applies). Written ONLY by the triggers (trade_insert_guard / trade_update_guard overwrite whatever a client sends); null on every row
-- from before revision y: such a trade accepted before it writes no offer, and one proposed before it and accepted after it writes the
-- leg-1 receiver's only (his acceptance is stamped; the proposer's agreement never was). Values: a roster id, or 'scheduler' (the
-- scheduler, an admin or a server session). Re-applying revision y after a rollback is its own report-first step: null the stamps of
-- the rows not yet applied first (no trigger overwrote a client's value in between).
alter table public.shift_trade_requests add column if not exists proposed_by text;
alter table public.shift_trade_requests add column if not exists accepted_by text;
comment on column public.shift_trade_requests.proposed_by is 'revision y: the from surgeon''s own roster id when he inserted the row himself, else ''scheduler'' (trade_insert_guard; never from the client)';
comment on column public.shift_trade_requests.accepted_by is 'revision y: the to surgeon''s own roster id when he accepted himself, else ''scheduler''; null until the row is first accepted (trade_update_guard / trade_insert_guard; never from the client)';

create or replace function public.trade_insert_guard() returns trigger
language plpgsql as $$
declare
  me     text    := public.silvis_person_id();
  server boolean := auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role');
  roster jsonb;
begin
  if not (public.silvis_is_sched() or server) then
    if me is null then
      raise exception 'TRADE_FORBIDDEN: your account is not linked to a roster entry' using errcode = 'P0001';
    end if;
    new.from_surgeon_id := me;
    new.status          := 'pending';
    new.submitted_at    := now();
    new.decided_at      := null;
    -- (2026-09-24, Prompt 19) a member's 'trade' carries its return shift (return_day AND return_role); a one-way row from a
    -- member is a 'give'. kind null reads as a trade here (the not-null constraint refuses it after the trigger anyway).
    if new.kind is distinct from 'give' and (new.return_day is null or new.return_role is null) then
      raise exception 'TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead' using errcode = 'P0001';
    end if;
  end if;
  -- (2026-09-24, Prompt 19) a give is one-way for EVERY caller, the scheduler and the server-side roles included
  if new.kind = 'give' and (new.return_day is not null or new.return_role is not null) then
    raise exception 'TRADE_INELIGIBLE: a give is one-way - it carries no return shift' using errcode = 'P0001';
  end if;
  if new.from_surgeon_id = new.to_surgeon_id then
    raise exception 'TRADE_INELIGIBLE: a trade needs two different surgeons' using errcode = 'P0001';
  end if;
  -- (2026-10-18, revision y) the consent stamps, for EVERY caller (a client's value is overwritten), once from_surgeon_id is
  -- final: proposed_by is the from surgeon's own id when he inserts the row himself, else 'scheduler'; a row inserted already
  -- accepted (the scheduler or a server session - a member's lands pending) is stamped accepted_by the same way from the to
  -- surgeon; any other row starts with accepted_by null. apply_trade reads them to decide whose offer row a trade writes.
  new.proposed_by := case when me is not null and me = new.from_surgeon_id then me else 'scheduler' end;
  new.accepted_by := case when new.status = 'accepted' then (case when me is not null and me = new.to_surgeon_id then me else 'scheduler' end) end;
  -- (2026-09-24, Prompt 16 B6) the display names come from the roster, never from the client: call_schedule_data 'main'
  -- -> roster[] -> name (last name) by id, looked up AFTER from_surgeon_id is final. An id the roster does not know, or a
  -- missing / malformed roster, reads as the id itself - a name is display data, never a reason to refuse the insert.
  select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';
  if roster is null or jsonb_typeof(roster) <> 'array' then roster := '[]'::jsonb; end if;
  new.from_surgeon_name := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.from_surgeon_id limit 1), ''), new.from_surgeon_id);
  new.to_surgeon_name   := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.to_surgeon_id limit 1), ''), new.to_surgeon_id);
  return new;
end $$;
drop trigger if exists trade_insert_guard_trg on public.shift_trade_requests;
create trigger trade_insert_guard_trg
  before insert on public.shift_trade_requests
  for each row execute function public.trade_insert_guard();

create or replace function public.trade_update_guard() returns trigger
language plpgsql as $$
declare
  me      text := public.silvis_person_id();
  today_c date := (now() at time zone 'America/Chicago')::date;
begin
  -- (2026-10-18, revision y) the consent stamps are this trigger's alone, for EVERY caller (a client's value is overwritten), and
  -- run before the scheduler's return: moving into accepted stamps accepted_by - the to surgeon's own id when he accepts himself,
  -- else 'scheduler'; a change of the legs (the scheduler only - a member is refused below) re-stamps both, as the insert guard
  -- does, since an agreement to the old legs is not one to the new; every other update keeps both as they were.
  if new.from_surgeon_id is distinct from old.from_surgeon_id or new.to_surgeon_id is distinct from old.to_surgeon_id
     or new.day is distinct from old.day or new.role is distinct from old.role
     or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role then
    new.proposed_by := case when me is not null and me = new.from_surgeon_id then me else 'scheduler' end;
    new.accepted_by := case when new.status = 'accepted' then (case when me is not null and me = new.to_surgeon_id then me else 'scheduler' end) end;
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    new.proposed_by := old.proposed_by;
    new.accepted_by := case when me is not null and me = new.to_surgeon_id then me else 'scheduler' end;
  else
    new.proposed_by := old.proposed_by;
    new.accepted_by := old.accepted_by;
  end if;
  if public.silvis_is_sched() then return new; end if;
  if new.from_surgeon_id <> old.from_surgeon_id or new.to_surgeon_id <> old.to_surgeon_id
     or new.day <> old.day or new.role <> old.role
     or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role
     or new.kind is distinct from old.kind then
    raise exception 'TRADE_IMMUTABLE: only the scheduler may change the legs of a trade' using errcode = 'P0001';
  end if;
  if current_setting('silvis.apply_trade', true) = '1' and old.status = 'accepted' and new.status = 'applied' then
    return new;   -- set only inside public.apply_trade()
  end if;
  if old.status <> 'pending' then
    raise exception 'TRADE_NOT_PENDING: this trade is already %', old.status using errcode = 'P0001';
  end if;
  if me = old.to_surgeon_id and new.status in ('accepted', 'declined') then
    if new.status = 'accepted' and (old.day < today_c or (old.return_day is not null and old.return_day < today_c)) then
      raise exception 'TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only',
        case when old.day < today_c then old.day else old.return_day end, today_c using errcode = 'P0001';
    end if;
    return new;
  end if;
  if me = old.from_surgeon_id and new.status = 'cancelled' then return new; end if;
  raise exception 'TRADE_FORBIDDEN: % may not set status % on this trade', coalesce(me, 'anon'), new.status using errcode = 'P0001';
end $$;
drop trigger if exists trade_update_guard_trg on public.shift_trade_requests;
create trigger trade_update_guard_trg
  before update on public.shift_trade_requests
  for each row execute function public.trade_update_guard();

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
