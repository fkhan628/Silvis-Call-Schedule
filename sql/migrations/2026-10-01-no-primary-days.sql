-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-01: no-primary days (Faraz 10/1, Prompt 28: surgeons mark their own no-primary
-- days - "I do want them to be able to do that"; Burchett's e-mail of 10/1: "These are days I am at Jackson County - I need
-- to be blocked out as unavailable for primary call. I can cover backup call these days").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a write path into a live, anon-readable table and a re-created RPC
-- every Save goes through). Nothing in the repo applies it: Faraz runs the one command below and pastes the log back.
--
-- What changes. One NEW function, public.save_no_primary(p_person, p_add, p_clear) (security definer, search_path public,
-- pg_temp), and public.save_offers re-created with two optional parameters p_np_add date[] / p_np_clear date[] (the
-- five-argument signature is dropped right before the create; still security invoker). No table, column, policy, trigger,
-- grant on a table or row changes; public.availability has no trigger and its policies stay as they are (a surgeon still
-- cannot write it directly - the new function is the only door, and it opens on single-day backup_only rows only).
-- sql/schema.sql mirrors every function text below byte for byte (header revision t, "report-first, NOT yet applied" until
-- the record step); test/schema.test.js pins the identity.
--
-- The decision. The painter's Save stays ONE request (Prompt 28): save_offers stays the entry point and stays security
-- invoker (the call_offers policies, OF001-OF004 per row and the office-relay flag depend on it), and it calls the definer
-- sibling save_no_primary inside its own transaction - a surgeon cannot write availability under RLS and no RLS change is
-- allowed, so the availability write needs its own caller checks. A refusal in the sibling (or after it) rolls the offer rows
-- back too. Rejected: save_offers as definer (bypasses the call_offers policies), a fake role_pref in p_rows (overloads the
-- row validation), a new table (forbidden). The sibling carries every check itself, so a direct REST call is as safe as the
-- nested one (EXECUTE for authenticated, as an invoker's nested call needs it; never anon).
--
-- A no-primary day = one availability row per day, kind 'backup_only', role 'any', start_date = end_date = the day, note
-- NULL (an anon-readable table: no reasons in notes - CLAUDE.md), source 'app' (the surgeon himself) / 'office-relay' (a
-- coordinator) / 'email-relay' (the scheduler's relay), created_by own roster id / the coordinator's profile id /
-- 'scheduler' - save_offers' rule. rules.js already reads the kind: primary blocked, backup available that day.
-- Clearing deletes the person's SINGLE-day backup_only rows on the named days whatever their source ('setup', 'seed', the
-- app's); a multi-day range (the scheduler's, from Setup > Availability statements) is never split. A day already covered by
-- any backup_only row of the person (single or range) is not duplicated ("kept").
--
-- Refusals (custom SQLSTATEs, HTTP 400 through PostgREST like OS / OM / VG; days as M/D in day order), all BEFORE any write:
--   NP001 NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days
--   NP001 NO_PRIMARY_NOT_LINKED: name the person (your account is not linked to a roster entry)
--   NP002 NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon's no-primary days
--   NP003 NO_PRIMARY_UNKNOWN_PERSON: <id> is not a roster id - the office relays for a roster surgeon only
--   NP004 NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved
--   NP004 NO_PRIMARY_BAD_DAY: <days> is both marked and cleared in one save - nothing was saved
--   NP005 NO_PRIMARY_PAST: <days> is before today (<M/D>) in Central time - a past day stays as it was
--   NP006 NO_PRIMARY_FROZEN: offers for <label> closed on <date> - ask the scheduler (<days>)
--   NP007 NO_PRIMARY_RANGE: <days> is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements
--   NP008 NO_PRIMARY_ON_CALL: <name> holds primary on <days> - trade those days first, then mark them No primary
--   NP009 NO_PRIMARY_OFFER_CONFLICT: <name> offers primary on <days> and marks it No primary - keep one of the two (nothing was saved)
-- NP009 is enforced in both directions by the two RPCs: save_no_primary refuses a day it MARKS that carries a primary /
-- either offer of the person (it sees the offers this Save wrote earlier in the transaction), and save_offers refuses a day it
-- OFFERS as primary / either that carries a backup_only row of the person after the Save (a range from Setup, or a single day
-- the Save did not lift). Only days touched by THIS Save are checked; pre-existing inconsistent rows never fail an unrelated
-- Save (the pre-check lists them). Not covered (review 10/1, SCHEMA-REVIEW residual 6): a direct call_offers REST write (the
-- call_offers policies are unchanged) and claim_open_slot's offer upsert skip NP009 - harmless for the schedule (rules.js
-- blocks primary on a backup_only day) and the pre-check's offer-conflict section lists such a day.
--
-- Who it binds. A linked surgeon for himself; the office coordinator for a roster id (NP003 - the OS004 expression word for
-- word); the scheduler (admin / scheduler) for anyone. Decisions: past days bind the scheduler too (like OF001 - a past row is
-- his to fix in Setup > Availability statements); the freeze (a period whose offers closed or whose status is no longer
-- 'upcoming', the OF003 reading) spares the scheduler only - the coordinator is frozen like a surgeon; a range is never split,
-- not by the scheduler either (he edits it in Setup); a held PRIMARY on schedule_days refuses the mark for everyone (the
-- vacation rule's "edit the schedule first"), a held backup does not ("backup is fine"); a vacation day is NOT refused (a
-- no-primary row only restricts, rules.js never lifts the vacation for a dated row; the painter never offers it). Two Saves of
-- one person serialise on a transaction advisory lock taken before every availability read - save_no_primary takes it, and
-- save_offers takes the same lock before its first write (review 10/1), so an offer Save's NP009 read and a concurrent mark of
-- the same person run one after the other (the lock is re-entrant: the nested call takes it again). The function writes no
-- audit or notification row (the client's offers.save is the one audit row) and nothing but public.availability.
--
-- Blast radius. Every Save from the apply on resolves to the new save_offers: an older build's five-key call resolves to the
-- seven-argument function (the two new parameters default to null) and behaves as before, except that the offers-side NP009
-- also binds it - the old painter already skips primary / either on a backup-only day and shows the NP009 text verbatim
-- (describeDbError's OFFERS?_[A-Z_]+ matches the token's tail), so a stale painter gets "nothing was saved" with the message,
-- never a half-write. The migration ends with a PostgREST schema-cache reload (a seven-key call needs the cache to know
-- p_np_add / p_np_clear - verify-rls 16b is the gate before the client push). The other probes' save_offers calls are
-- positional (3 or 5 arguments) and read the return by key: unaffected. The availability read of the client is unpaged
-- (PostgREST max-rows): each marked day adds a row - the pre-check prints the total.
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-no-primary-days.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-01-no-primary-days.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction (observed: every probe's final raise rolls its whole batch back), and
-- a paste into the SQL editor runs as one session too - a failure anywhere changes nothing, and no caller ever sees a moment
-- without save_offers (the drop and the create commit together).
-- Order: 1. pre-check sql/probes/no-primary-precheck.sql (read-only; the functions row must read np_fn=no offers5=yes
-- offers7=no overloads=1); 2. probe BEFORE sql/probes/no-primary-probe.sql (expects PROBE_SETUP: save_no_primary is absent
-- ...); 3. this file; 4. probe AFTER (43 cases, each as its header lists); 5. SILVIS_NO_PRIMARY_APPLIED=1 bash
-- scripts/verify-rls.sh (sections 1-16 green); 6. the record step in docs/SCHEMA-REVIEW.md "2026-10-01 - no-primary days".
-- The client that sends p_np_add / p_np_clear ships AFTER the apply (the pre-apply function would refuse a seven-key call:
-- PGRST202, nothing saved); it sends the two keys only when non-empty, so its offer Saves work before the apply and after a
-- rollback.
-- Re-running: idempotent (drop function if exists + create or replace); the apply script refuses to re-run it anyway (its gate).
-- Rolling back:
--   drop function if exists public.save_offers(text, jsonb, date[], uuid, text, date[], date[]);
--   -- re-create the five-argument save_offers from sql/migrations/2026-09-24-coordinator-role.sql (its create, grants, comment)
--   drop function if exists public.save_no_primary(text, date[], date[]);
--   notify pgrst, 'reload schema';
-- A rollback after the client push breaks only no-primary Saves (the client omits the np keys when empty).
-- ============================================================================

create or replace function public.save_no_primary(p_person text, p_add date[], p_clear date[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me       text := public.silvis_person_id();
  sched    boolean := public.silvis_is_sched();
  coord    boolean := public.silvis_is_coord();
  who      text := nullif(btrim(p_person), '');
  today_c  date := (now() at time zone 'America/Chicago')::date;
  adds     date[];
  clears   date[];
  v_by     text;
  v_src    text;
  v_name   text;
  frozen   record;
  bad      text;
  n_add    integer := 0;
  n_clear  integer := 0;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days' using errcode = 'NP001';
  end if;
  who := coalesce(who, me);
  if who is null then
    raise exception 'NO_PRIMARY_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'NP001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon''s no-primary days' using errcode = 'NP002';
  end if;
  -- The office relays for a roster id only (availability.person_id has no foreign key); the scheduler's relay is not checked (as OS004).
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'NO_PRIMARY_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'NP003';
  end if;
  -- One no-primary write per person at a time: two Saves from two devices serialise, and every read below sees the other's commit.
  perform pg_advisory_xact_lock(hashtext('availability:no_primary:' || who));
  if array_position(p_add, null) is not null or array_position(p_clear, null) is not null then
    raise exception 'NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved' using errcode = 'NP004';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into adds from unnest(coalesce(p_add, '{}'::date[])) d;
  select coalesce(array_agg(distinct d order by d), '{}') into clears from unnest(coalesce(p_clear, '{}'::date[])) d;
  select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) into bad from unnest(adds) d where d = any(clears);
  if bad is not null then
    raise exception 'NO_PRIMARY_BAD_DAY: % is both marked and cleared in one save - nothing was saved', bad using errcode = 'NP004';
  end if;
  -- Past days stay as they were for every caller, the scheduler included (like OF001).
  select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) into bad from unnest(adds || clears) d where d < today_c;
  if bad is not null then
    raise exception 'NO_PRIMARY_PAST: % is before today (%) in Central time - a past day stays as it was', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'NP005';
  end if;
  -- The offers freeze (the OF003 reading: closed by date or no longer upcoming); the scheduler is exempt, the office is not.
  if not sched then
    select p.label, p.offers_close_at,
           (select string_agg(to_char(x, 'FMMM/FMDD'), ', ' order by x) from unnest(adds || clears) x where x between p.start_day and p.end_day) as days
      into frozen
      from public.call_periods p
     where exists (select 1 from unnest(adds || clears) x where x between p.start_day and p.end_day)
       and (p.offers_close_at <= today_c or p.status <> 'upcoming')
     order by p.start_day
     limit 1;
    if found then
      raise exception 'NO_PRIMARY_FROZEN: offers for % closed on % - ask the scheduler (%)', frozen.label, frozen.offers_close_at, frozen.days using errcode = 'NP006';
    end if;
  end if;
  -- A longer range is never split, not by the scheduler either: he edits it in Setup > Availability statements.
  select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) into bad from unnest(clears) d
   where exists (select 1 from public.availability a where a.person_id = who and a.kind = 'backup_only' and a.start_date < a.end_date and d between a.start_date and a.end_date);
  if bad is not null then
    raise exception 'NO_PRIMARY_RANGE: % is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements', bad using errcode = 'NP007';
  end if;
  v_name := coalesce((select r ->> 'name' from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who limit 1), who);
  -- A day he holds as PRIMARY on the saved schedule is traded first, for every caller (holding backup is fine).
  select string_agg(to_char(s.day, 'FMMM/FMDD'), ', ' order by s.day) into bad from public.schedule_days s where s.day = any(adds) and s.primary_id = who;
  if bad is not null then
    raise exception 'NO_PRIMARY_ON_CALL: % holds primary on % - trade those days first, then mark them No primary', v_name, bad using errcode = 'NP008';
  end if;
  -- A primary / either offer on a day he marks (it sees the offers this Save wrote earlier in the transaction).
  select string_agg(to_char(o.day, 'FMMM/FMDD'), ', ' order by o.day) into bad from public.call_offers o
   where o.person_id = who and o.day = any(adds) and o.role_pref in ('primary', 'either');
  if bad is not null then
    raise exception 'NO_PRIMARY_OFFER_CONFLICT: % offers primary on % and marks it No primary - keep one of the two (nothing was saved)', v_name, bad using errcode = 'NP009';
  end if;

  -- Who entered it is a fact of the call, never a client field (save_offers' rule).
  if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth.uid()::text; v_src := 'office-relay'; end if;

  -- Clear: every SINGLE-day backup_only row of the person on those days, any role, any source ('setup', 'seed', the app's).
  delete from public.availability a
   where a.person_id = who and a.kind = 'backup_only' and a.start_date = a.end_date and a.start_date = any(clears);
  get diagnostics n_clear = row_count;
  -- Add: one row per day not already covered by ANY backup_only row of the person (single or range, any source); note
  -- always null (an anon-readable table carries no reasons); role 'any'.
  insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by)
  select who, 'backup_only', 'any', d, d, null, v_src, v_by
    from unnest(adds) d
   where not exists (select 1 from public.availability a
                      where a.person_id = who and a.kind = 'backup_only' and d between a.start_date and a.end_date)
  on conflict do nothing;
  get diagnostics n_add = row_count;

  return jsonb_build_object('ok', true, 'person_id', who, 'added', n_add, 'cleared', n_clear, 'kept', cardinality(adds) - n_add, 'source', v_src, 'created_by', v_by);
end $$;
revoke all on function public.save_no_primary(text, date[], date[]) from public;
revoke all on function public.save_no_primary(text, date[], date[]) from anon;
grant execute on function public.save_no_primary(text, date[], date[]) to authenticated;
comment on function public.save_no_primary(text, date[], date[]) is 'Prompt 28 (2026-10-01): a person''s no-primary days - one availability row per day, kind backup_only, role any, note null (p_add), and the deletion of his SINGLE-day backup_only rows of any source (p_clear). Security definer because surgeons cannot write availability under RLS; called by save_offers inside its transaction (the painter''s one Save) and callable directly with the same checks: a linked surgeon for himself, the office coordinator for a roster id (NP003), the scheduler for anyone. Refusals before any write: NP001 NO_PRIMARY_NOT_LINKED, NP002 NO_PRIMARY_NOT_YOURS, NP003 NO_PRIMARY_UNKNOWN_PERSON, NP004 NO_PRIMARY_BAD_DAY, NP005 NO_PRIMARY_PAST (everyone), NP006 NO_PRIMARY_FROZEN (not the scheduler), NP007 NO_PRIMARY_RANGE (a longer range is never split), NP008 NO_PRIMARY_ON_CALL (a held primary), NP009 NO_PRIMARY_OFFER_CONFLICT (a primary / either offer that day). source app / office-relay / email-relay, created_by as save_offers. Writes no audit row: the client writes the audit row offers.save after ok.';

drop function if exists public.save_offers(text, jsonb, date[], uuid, text);
create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null, p_np_add date[] default null, p_np_clear date[] default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  me        text := public.silvis_person_id();
  sched     boolean := public.silvis_is_sched();
  coord     boolean := public.silvis_is_coord();
  who       text := nullif(btrim(p_person), '');
  v_by      text;
  v_src     text;
  n_up      integer := 0;
  n_del     integer := 0;
  bad       text;
  np        jsonb;
  v_name    text;
begin
  if auth.uid() is null or (me is null and not sched and not coord) then
    raise exception 'OFFERS_NOT_LINKED: sign in with an account that is linked to a roster entry to save offers' using errcode = 'OS001';
  end if;
  who := coalesce(who, me);
  if who is null then
    raise exception 'OFFERS_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'OS001';
  end if;
  if who <> coalesce(me, '') and not sched and not coord then
    raise exception 'OFFERS_NOT_YOURS: only the scheduler or the office can save another surgeon''s offers' using errcode = 'OS002';
  end if;
  -- The office relays for a roster id only (review of Prompt 16 A7): call_offers.person_id has no foreign key, so a
  -- hand-made call could otherwise leave orphan offer rows. The scheduler's relay is unchanged. Checked before any write.
  if coord and not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who) then
    raise exception 'OFFERS_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OS004';
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OFFERS_BAD_ROW: rows must be a JSON array' using errcode = 'OS003';
  end if;
  -- Fail closed BEFORE any write: one malformed row means the whole batch is refused.
  select string_agg(coalesce(r->>'day', 'null') || ' ' || coalesce(r->>'role_pref', 'null'), ', ') into bad
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where r->>'day' !~ '^\d{4}-\d{2}-\d{2}$' or r->>'role_pref' is null or r->>'role_pref' not in ('primary', 'backup', 'either');
  if bad is not null then
    raise exception 'OFFERS_BAD_ROW: % (day must be YYYY-MM-DD, role_pref primary / backup / either) - nothing was saved', bad using errcode = 'OS003';
  end if;
  -- Prompt 28 (review 10/1): save_no_primary's per-person lock, before the first write - this Save's NP009 read below and a
  -- concurrent no-primary mark of the same person run one after the other (re-entrant: the nested call takes it again).
  perform pg_advisory_xact_lock(hashtext('availability:no_primary:' || who));

  -- Who entered it is a fact of the call, never a client field.
  if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth.uid()::text; v_src := 'office-relay'; end if;

  -- A coordinator's rows pass the call_offers policies only inside this call (Prompt 16 A7): the transaction-local
  -- flag is what the policies' coordinator clause reads; it never exists outside save_offers.
  if coord then perform set_config('silvis.office_relay', 'on', true); end if;

  -- The deletes first, then the upserts (order is immaterial inside one transaction; the delete guard OF003 and the
  -- RLS delete policy apply per row). A day in both lists ends up upserted.
  if p_clear is not null and array_length(p_clear, 1) > 0 then
    delete from public.call_offers where person_id = who and day = any(p_clear);
    get diagnostics n_del = row_count;
  end if;
  insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)
  select who, (r->>'day')::date, r->>'role_pref', nullif(btrim(r->>'note'), ''), v_by, v_src
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (person_id, day) do update
    set role_pref = excluded.role_pref, note = coalesce(excluded.note, call_offers.note), entered_by = excluded.entered_by, source = excluded.source, updated_at = now();
  get diagnostics n_up = row_count;
  if coord then perform set_config('silvis.office_relay', '', true); end if;

  -- Prompt 28: the no-primary days, in this same transaction, through the definer sibling (surgeons cannot write
  -- availability under RLS); a refusal there rolls the offer rows above back too.
  if coalesce(cardinality(p_np_add), 0) + coalesce(cardinality(p_np_clear), 0) > 0 then
    np := public.save_no_primary(who, p_np_add, p_np_clear);
  end if;

  -- Prompt 28 invariant: a day this Save offers as primary / either carries no no-primary row afterwards (a range from
  -- Setup, or a single day the Save did not lift).
  select string_agg(to_char(o.day, 'FMMM/FMDD'), ', ' order by o.day) into bad
    from public.call_offers o
   where o.person_id = who and o.role_pref in ('primary', 'either')
     and o.day in (select (r->>'day')::date from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r)
     and exists (select 1 from public.availability a
                  where a.person_id = who and a.kind = 'backup_only' and o.day between a.start_date and a.end_date);
  if bad is not null then
    v_name := coalesce((select r ->> 'name' from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who limit 1), who);
    raise exception 'NO_PRIMARY_OFFER_CONFLICT: % offers primary on % and marks it No primary - keep one of the two (nothing was saved)', v_name, bad using errcode = 'NP009';
  end if;

  -- The mode, when the same Save changed it: inside this transaction, so a refused mode (OM001-OM006, checked by
  -- set_offer_mode itself) rolls the rows above back too - days + mode are one commit or nothing.
  if p_mode is not null then
    perform public.set_offer_mode(p_period, p_mode, who);
  end if;

  return jsonb_build_object('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by,
                            'source', v_src, 'mode', p_mode, 'np_added', coalesce((np->>'added')::int, 0),
                            'np_cleared', coalesce((np->>'cleared')::int, 0), 'np_kept', coalesce((np->>'kept')::int, 0));
end $$;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) from public;
revoke all on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) from anon;
grant execute on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) to authenticated;
comment on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) is 'Prompt 14 part 3a (+ Prompt 16 A7, + Prompt 28): the offer painter''s one Save - upserts + deletes (+ the no-primary days through save_no_primary when p_np_add / p_np_clear carry days, + the period mode through set_offer_mode when p_mode is given) in ONE transaction as the caller (security invoker: RLS + OF001/OF002/OF003 apply per row; nothing bypassed - a coordinator''s rows pass the policies through the transaction-local silvis.office_relay flag this function sets). entered_by / source come from the caller identity (own id / app; scheduler / email-relay; the coordinator''s profile id / office-relay - for a roster id only, OS004 otherwise); a row sent without a note keeps its note. NP009 NO_PRIMARY_OFFER_CONFLICT when a day it offers as primary / either carries a backup_only row afterwards. The client writes the audit row offers.save after ok.';

notify pgrst, 'reload schema';
