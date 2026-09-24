-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: give a day (Prompt 19, Faraz 2026-09-24). One column + two checks on
-- shift_trade_requests, two trigger functions (create or replace, idempotent) with their triggers re-created. No policy,
-- no RPC grant and no row is touched; apply_trade() is NOT redefined.
-- supersedes: sql/migrations/2026-09-24-definer-locks.sql
--   (same-day file order: B6's trade_insert_guard() - applied live 2026-09-23 ~19:27 Central - is re-created below with the
--    Prompt 19 lines added; this file runs AFTER it and builds on its final text; test/schema.test.js freezes B6's body)
--
-- REPORT-FIRST (CLAUDE.md, guide section 4.3): prepared here with the probe cases (sql/probes/trade-guards-probe.sql
-- GIVE_SETUP and O..U - the file rolls itself back) and scripts/verify-rls.sh section 5; the orchestrator applies it after
-- Faraz's go. Nothing in the repo applies it, and the client must not send `kind` until this is live (a PostgREST insert
-- naming an unknown column fails).
--
-- What it adds: today a surgeon proposes a day-for-day trade and only the scheduler records a one-way trade. A member may now
-- GIVE one of his days (or a whole weekend / holiday unit, one row per day) to a named colleague - nothing comes back; the
-- colleague accepts or declines; on accept it is applied exactly like a trade (apply_trade, return_day null = the one-way path).
-- (1) shift_trade_requests.kind text not null default 'trade', check kind in ('trade','give') (named
--     shift_trade_requests_kind_check); existing rows read 'trade' (a constant default: no table rewrite on PG 11+). A second
--     named check, shift_trade_requests_give_one_way, makes "a give carries no return leg" true for every writer (the scheduler
--     bypasses both triggers' member rules, so the table carries the invariant); every existing row is kind 'trade' and passes.
-- (2) trade_insert_guard(): inside the member branch (neither scheduler nor server), AFTER the unchanged normalisation, a
--     'trade' without return_day AND return_role is refused - TRADE_INELIGIBLE: a trade needs a return shift - pick the day and
--     role you take in return, or give the day instead. Today's guard did NOT refuse it (a member one-way trade was refused only
--     by the client), so this is an ADDED refusal (Faraz: a 'trade' from a member still needs one). Outside the branch, for every
--     caller: a 'give' that carries return_day or return_role is refused - TRADE_INELIGIBLE: a give is one-way - it carries no
--     return shift (the existing code, no new one: the client shows TRADE_INELIGIBLE sentences verbatim). The scheduler's rows
--     are unchanged: he may still insert a one-way 'trade'; a scheduler-inserted 'give' is allowed and means the same one-way
--     move, labelled as a give. from := me, the same-surgeon refusal and the roster names are byte-for-byte B6's - so a member's
--     give naming a day he does not hold lands FROM HIM (never refused at insert; the guard never checked holders) and
--     apply_trade refuses it (TRADE_STALE: <day> <role> is no longer held by <him>).
-- (3) trade_update_guard(): `or new.kind is distinct from old.kind` joins the TRADE_IMMUTABLE leg list - a non-scheduler may
--     not change kind on his own row after insert, nor on a row he is a party to; on a row he is no party to, policy
--     trade_update filters the UPDATE out (0 rows, as for any other column). Status transitions (accept / decline / cancel,
--     TRADE_PAST on accept, the apply_trade hand-off) are unchanged.
-- (4) apply_trade() is left untouched (checked): its caller check is `sched or me = t.from_surgeon_id or me = t.to_surgeon_id`,
--     so the RECEIVER of an accepted one-way row may apply it; every one-way branch (`t.return_day is not null` guards the
--     return leg, the from-surgeon activity check and the return-leg vacation / lock / other-role checks) already exists; the
--     5b audit summary reads "Trade applied: <to> takes <Role> <Dy Mon D> (from <from>, one-way)".
--
-- Apply live with the Supabase CLI (absolute path), after 2026-09-24-trade-audit-names.sql (applied 2026-09-24 22:21 UTC):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-give-kind.sql
-- Observe it with sql/probes/trade-guards-probe.sql (cases GIVE_SETUP and O..U are the new ones; A / G / H / N now insert
-- WITH a return leg so they keep testing what they tested) before and after - it rolls itself back; scripts/verify-rls.sh
-- section 5 grades it (and 6a now posts a return leg). The statements below are byte-identical to sql/schema.sql
-- (test/schema.test.js pins that, and freezes the superseded 9/24 definer-locks trade_insert_guard and 9/23 trade-past
-- trade_update_guard bodies by sha256).
-- Report-first (guide section 4.3): one additive column, two checks, two live trigger functions replaced; no row changes.
-- Blast radius: every new shift_trade_requests insert by a member must carry a return leg unless it is a 'give' - the live
-- client (the build before Prompt 19's client step) inserts the TAIL rows of a whole-unit trade with a single return day
-- (rows 2..n) with no return leg, so those rows are refused from the apply on until EVERY client runs the Prompt 19 build
-- (not merely until the push: CI builds, Pages redeploys, and an installed PWA keeps the old build until its user reloads -
-- the min-version banner does not force it). In that window a stale client's whole-unit proposal with one return day stops
-- after row 1, yet it still announces the WHOLE unit (trade.propose audit row, trade_proposed notification, e-mail to both
-- parties), and the lone head row can be accepted and applied on its own - apply_trade has no unit check - which SPLITS the
-- unit (day 1 + the return day move, the rest stays with the giver); the toast shows the new sentence, whose "give the day
-- instead" that build does not offer. Every other client path already sends a return leg for a member, and existing rows,
-- accept / decline / cancel and apply_trade behave as before. Open for Faraz before the apply (SCHEMA-REVIEW, Prompt 19
-- section): accept this window with the mitigations below, or split the member return-leg refusal into a follow-up file
-- applied once old clients have drained, or exempt unit-tail rows server-side. Pre-check (the one-way rows that stay as they
-- are - the guard is INSERT-only):
--   select count(*) from public.shift_trade_requests where return_day is null and status in ('pending', 'accepted');
-- Order: probe BEFORE -> this file -> probe AFTER -> scripts/verify-rls.sh section 5c (anon GET shift_trade_requests?select=kind
-- must read HTTP 200: PostgREST sees the column - the gate for the client) -> the Prompt 19 client push AT ONCE -> the rest of
-- verify-rls.sh -> client_versions row 'main' min_version = the Prompt 19 build (with a reload message) -> the orphaned-head
-- check in SCHEMA-REVIEW once the heartbeats show no older build (the scheduler cancels what it finds).
-- ============================================================================

alter table public.shift_trade_requests add column if not exists kind text not null default 'trade';
alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_kind_check;
alter table public.shift_trade_requests add constraint shift_trade_requests_kind_check check (kind in ('trade','give'));
alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_give_one_way;
alter table public.shift_trade_requests add constraint shift_trade_requests_give_one_way check (kind = 'trade' or (return_day is null and return_role is null));
comment on column public.shift_trade_requests.kind is '''trade'' (day for day; the default) | ''give'' (one-way, no return leg - Prompt 19, Faraz 2026-09-24)';

-- ---------- trade UPDATE guard (2026-09-23 RLS-6; 2026-09-24 Prompt 19: kind joins the legs)
create or replace function public.trade_update_guard() returns trigger
language plpgsql as $$
declare
  me      text := public.silvis_person_id();
  today_c date := (now() at time zone 'America/Chicago')::date;
begin
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

-- PostgREST picks the new column up through Supabase's DDL event trigger; the explicit reload makes it immediate.
notify pgrst, 'reload schema';
