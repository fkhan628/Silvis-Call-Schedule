-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-25: a member's trade needs a return leg (Prompt 19 follow-up; split out of
-- sql/migrations/2026-09-24-give-kind.sql on 2026-09-24). One trigger function (create or replace, idempotent) with its
-- trigger re-created. No table, column, check, policy, RPC grant or row is touched; apply_trade() is NOT redefined.
-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED. NOT MIRRORED in sql/schema.sql until its apply is recorded.
--
-- Gate: apply only after a client_versions min_version bump to the Prompt 19 build and a day for old builds to drain
-- (Settings > client heartbeats show no build older than the Prompt 19 one for a full day), and only after
-- sql/migrations/2026-09-24-give-kind.sql is applied (this body reads the kind column that file adds). The orchestrator applies
-- it after that gate and a report (CLAUDE.md report-first, guide section 4.3); nothing in the repo applies it.
--
-- What it adds: trade_insert_guard() exactly as Prompt 19 S1 wrote it (git show f9ad08f:sql/migrations/2026-09-24-give-kind.sql;
-- test/schema.test.js pins the body by sha256) = the give-kind body plus ONE block inside the member branch (neither scheduler
-- nor server), right after the unchanged normalisation: a 'trade' without return_day AND return_role is refused -
-- TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead. B6 and the
-- give-kind guard accept such a row (a member one-way trade is refused only by the client), so this is an ADDED refusal (Faraz:
-- a 'trade' from a member still needs one); a half leg (a return day without a role) is refused too. Scheduler / server rows
-- are unchanged (a one-way 'trade' is still theirs to record); a give with no return leg stays accepted; the give-one-way
-- refusal, from := me, the same-surgeon refusal and the roster names are the give-kind body's, byte for byte.
--
-- Why it waits (S1 review, major - the reason for the split): the build before Prompt 19's client step proposes a whole
-- weekend / holiday unit for a single return day as one row per day, and only row 1 carries the return leg - the TAIL rows
-- (rows 2..n) are one-way 'trade' rows from a member. From this file's apply on they are refused, until EVERY client runs the
-- Prompt 19 build (not merely until the push: an installed PWA keeps its old build until its user reloads - the min-version
-- banner does not force it). A stale client's whole-unit proposal then stops after row 1, yet it still announces the WHOLE unit
-- (trade.propose audit row, trade_proposed notification, e-mail to both parties), and the lone head row can be accepted and
-- applied on its own - apply_trade has no unit check - which SPLITS the unit (day 1 + the return day move, the rest stays with
-- the giver). The Prompt 19 client sends those tails as kind 'give' and never inserts a member 'trade' without a return leg, so
-- once the old builds have drained nothing a client sends is refused by this block.
--
-- Apply live with the Supabase CLI (absolute path), after the gate above:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-25-member-trade-return-leg.sql
-- Acceptance - sql/probes/trade-guards-probe.sql (rolls itself back), every other case unchanged:
--   BEFORE (the give-kind guard live): Q=status=pending return=null   Q3=status=pending return=2030-03-04 return_role=null
--   AFTER (this file):
--     Q=ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead
--     Q3=ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead
-- scripts/verify-rls.sh section 5 grades Q / Q3 as STORED until this file's record step (grading them refused today would fail).
-- Order: probe BEFORE -> this file -> probe AFTER -> the orphaned-head check in docs/SCHEMA-REVIEW.md (a unit head row whose
-- unit has fewer rows than its stamp - a stale client that proposed after the apply; the scheduler cancels a pending / accepted
-- one and repairs an applied one) -> the record step, ONE commit: mirror this body into sql/schema.sql's trade_insert_guard and
-- replace its "PREPARED FOLLOW-UP, NOT MIRRORED" header line with "Revision 2026-09-25 p (Prompt 19 follow-up,
-- sql/migrations/2026-09-25-member-trade-return-leg.sql, applied <timestamp>)"; drop the PREPARED FOLLOW-UP marker line above;
-- in test/schema.test.js empty PREPARED_NOT_MIRRORED (and move the marker-line pin with it), flip GIVE_CASES Q / Q3, flip
-- schema.sql's checkInsertGuard call to needsReturn=true, compare schema.sql's trade_insert_guard with THIS file (not the
-- give-kind file), undo it with undoFollowUp and flip the "schema.sql must NOT carry the member block" pin; grade the
-- guardVerdict CASES' shipped column against the give-kind file's body. The give-kind file stays frozen as applied (one
-- block): its checkInsertGuard call STAYS needsReturn=false and its undo stays undoInsert (optionally freeze its
-- trade_insert_guard by sha256 once it is no longer the newest). Switch verify-rls.sh section 5's Q / Q3 lines to the refused
-- sentence; the SCHEMA-REVIEW status and observed lines and the guide 4.3 row.
-- Rolling back = re-running the give-kind trade_insert_guard (sql/migrations/2026-09-24-give-kind.sql's body and trigger).
-- ============================================================================

-- ---------- trade INSERT guard (2026-09-22 D.1; 2026-09-24 B6 roster names; 2026-09-24 Prompt 19 give / trade return rule)
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
