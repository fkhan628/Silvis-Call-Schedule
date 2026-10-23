-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-21 (revision aa): east_vacation_reset_stale keeps a person's reviews when the cache holds
-- no range of his (Faraz 10/20, "finish the backlog": every recommended decision D1-D10 of the private report
-- docs/history/REPORT-RESET-BACKSTOP-2026-10-20.md, which drafted this change as revision z; the letter z went to the push follow-ups,
-- prepared in parallel, so this is revision aa and its records follow z's).
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md: the security-definer function that deletes review rows - the ONE review reset the daily
-- unattended server refresh calls - is re-created). Nothing in the repo applies it: Faraz runs his apply script (kept outside the
-- repo) and pastes the log back.
--
-- The problem. east_vacation_reset_stale(p_from) (revision x, applied 2026-10-19 22:53:18Z) deletes every review of an East person
-- ending on or after p_from whose exact range is no longer a merged cached range, and trusts the cache completely: when the cache
-- holds none of his ranges, every review of his in scope goes as 'removed'. The callers' silent-empty guard (critic A7,
-- eastVacationReadGuard) uses the cache as its witness, so it cannot see a cache that already lost his ranges - a write to east_feed
-- outside the two guarded refreshes (the Table / SQL editor, a scheduler REST session), a future regression of the write plan, or a
-- hand call of the reset. After that, a blocked or empty Davenport read passes the guard and the reset deletes every review of his,
-- silently, at 05:30 CDT in a run that reads ok true; the ranges come back 'unreviewed' (away to everyone), so a range reviewed 'home'
-- blocks him until it is re-reviewed. The reviews are a second, independent witness: one exists only because a range of his was once
-- cached.
--
-- What changes. ONE function re-created (create or replace); no table, column, policy, trigger, grant, row or anon surface:
--   east_vacation_reset_stale(p_from date) - revision x's body byte for byte plus three insertions: (1) the declarations v_held text[]
--   and k record; (2) after the advisory lock, ONE reading of the East people the cache holds a merged range of ending on or after
--   p_from (silvis_east_ranges(), so forecast rows and malformed entries never count), then the kept loop: a person with reviews
--   ending on or after p_from but no such range keeps every one of them (none deleted, none returned) and gets ONE
--   eastvac.reset.kept audit row {summary, person_id, from, kept, reviews [{start, end, decision}]} - dates and decisions only (D3,
--   D5); (3) one predicate in x's delete loop, w.person_id = any (v_held), so a person is either kept or reset, never both. Unchanged:
--   the signature; returns table (person_id, start_date, end_date, decision, reason) - only deleted rows are returned, so neither
--   caller changes; security definer, volatile, search_path public, pg_temp; the grants (re-run, idempotent); EV001 / EV002, raised
--   before the cache or the reviews are read (a refused caller writes no kept row); the advisory lock east_vacation_reviews:reset. The
--   comment is replaced; the file ends with the schema-cache reload. No raise notice (D4): PostgREST and pg_net drop notices.
--
-- Behaviour change (D2: per East person, reviews ending on or after p_from and no merged cached range of his ending on or after
-- p_from, no upper bound). A range of his ending on or after p_from is cached (the normal case - the 2026-10-20 10:30 UTC run left that
-- state): the same deletes, returns, order and audit rows as revision x. None cached and reviews in scope: nothing deleted or
-- returned, one eastvac.reset.kept row per call while the state lasts (at most one a day from the cron, one per in-app press); when
-- his ranges come back with the same dates, the decisions are back. None cached and no review in scope: nothing, no audit row. The
-- cost: when Davenport truly holds none of his ranges, his reviews stay until any range of his ending on or after p_from is cached
-- again (then the normal reset clears every review whose dates differ); a review with no range derives nothing, so that alone is
-- harmless, but a range re-added with exactly the same dates gets its old decision back ('home' included) - the guard already keeps
-- the cached ranges on the same terms. A last range shortened to end before p_from keeps the old review instead of resetting it as
-- 'changed'. A kept review the scheduler knows is gone is deleted by hand in the SQL editor, by person_id, start and end (D8) -
-- nothing automatic.
--
-- Who it binds. The two callers, both unchanged: the in-app Refresh from Davenport (the scheduler's token; his kept row carries his
-- roster id, else his auth uid, and his display name, like logAudit) and the daily server refresh east-feed-refresh (the service role;
-- actor 'cron', name 'east-feed-refresh (cron)'); a hand call from the SQL editor / linked CLI (no signed-in user: actor 'cron', name
-- 'no signed-in user (SQL)'). anon is refused 42501 (no EXECUTE); a surgeon (Khan too), the coordinator and a viewer / follower / APP
-- are refused EV001 before any read. The kept row is read by the scheduler (audit_read) and shown in the Activity log by its summary
-- (D5); neither caller names it (D6, not now - it needs an east-feed-refresh redeploy and a client ship). The 9/23 client loop is out
-- of its reach (D7, unchanged): the current client runs it only while the function is missing (after a rollback of revision x), and
-- an installed build older than 2026.10.18b runs it on every refresh with no guard and never calls this function.
--
-- Blast radius. One function body replaced; PostgREST reloaded (a no-op for the callers). While every East person with reviews in
-- scope holds a cached range ending on or after p_from (the pre-check's row 5 prints it), it deletes, returns and audits exactly what
-- revision x does; otherwise that person's reviews stay, with one audit row. No client, edge function, cron job, policy, table or anon
-- surface changes; the A7 guard, silvis_east_ranges, silvis_derived_vacations, the vacation guard and the short days stay as they
-- are. verify-rls section 20 (the revision x probe) is unchanged: its fixtures hold a range of E ending after every p_from it passes.
-- Residuals (recorded, not fixed): a partial loss (some of his ranges gone, one ending on or after p_from still cached) is not
-- covered; the held reading and the delete loop's own reading of the cache are two statements, so an unguarded east_feed write
-- committing between them can still reset a held person's reviews as 'removed' (the advisory lock serializes resets, not cache
-- writes); an early p_from on a hand call weakens the test (the cache keeps past ranges - pass the main window's Monday, which the
-- pre-check prints); two East people are proven offline only (the live roster has one, and the probes never write the blob).
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-east-reset-backstop.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-21-east-reset-backstop.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction, and a paste into the SQL editor runs as one session too - a failure
-- anywhere changes nothing.
-- Order (D9): after Faraz's pending plain `bash scripts/verify-rls.sh` run (its sections 20 and 21 the baseline), outside 10:25-10:40
-- UTC (the cron job) and not while Refresh is pressed; on the database independent of revision z (the push follow-ups), whose records
-- come first. 1. the pre-check sql/probes/east-reset-backstop-precheck.sql (read-only; rows 1-4 the gate - reset_fn=yes ranges_fn=yes
-- people_fn=yes backstop=no and revision x's body md5 - rows 5-6 facts, never a stop); 2. the regression probe
-- sql/probes/east-vacations-probe.sql BEFORE (its 56 case=value pairs kept); 3. probe BEFORE sql/probes/east-reset-backstop-probe.sql
-- (expects PROBE_SETUP: east_vacation_reset_stale has no backstop ...); 4. this file; 5. the gate after (backstop=yes and this file's
-- body md5); 6. probe AFTER (15 cases, each as its header lists) and its leftover count 0; 7. the regression probe AFTER (the same 56
-- pairs); 8. the record step in docs/SCHEMA-REVIEW.md "2026-10-21 - east_vacation_reset_stale keeps a person's reviews when the cache
-- holds no range of his (revision aa)", which adds verify-rls section 23 (22 goes to revision z's record step, which comes first).
-- Re-running: idempotent (create or replace; the grants re-run); the apply script refuses to re-run it anyway (its gate).
-- Rolling back (nothing is lost: this file writes no review row; eastvac.reset.kept rows written meanwhile stay as history):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-14-east-vacations.sql   (revision x, idempotent: its reset body; the rest as live)
-- ============================================================================

create or replace function public.east_vacation_reset_stale(p_from date) returns table (person_id text, start_date date, end_date date, decision text, reason text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me       uuid := auth.uid();
  v_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_actor  text;
  v_name   text;
  v_held   text[];
  k        record;
  x        record;
  n        int;
begin
  if me is null then
    if v_role in ('anon', 'authenticated') then
      raise exception 'EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)' using errcode = 'EV001';
    end if;
    v_actor := 'cron';
    v_name := case when v_role = 'service_role' then 'east-feed-refresh (cron)' else 'no signed-in user (SQL)' end;
  elsif not public.silvis_is_sched() then
    raise exception 'EAST_RESET_NOT_ALLOWED: only the scheduler or the server refresh resets East vacation reviews (nothing was deleted)' using errcode = 'EV001';
  else
    v_actor := coalesce(public.silvis_person_id(), me::text);
    v_name := coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                       (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                         where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                       'Unknown');
  end if;
  if p_from is null then
    raise exception 'EAST_RESET_BAD_FROM: give the first day whose reviews may be reset (nothing was deleted)' using errcode = 'EV002';
  end if;
  -- one reset at a time (the in-app refresh and the server refresh may meet)
  perform pg_advisory_xact_lock(hashtext('east_vacation_reviews:reset'));
  -- revision aa (the backstop behind the callers' silent-empty guard, critic A7): the East people the cache holds a merged range of
  -- ending on or after p_from, read ONCE - both loops below decide by it, so a person is either kept or reset, never both
  select coalesce(array_agg(distinct r.person_id), '{}'::text[]) into v_held
    from public.silvis_east_ranges() r
   where r.end_date >= p_from;
  -- a person with reviews ending on or after p_from but NO such range keeps every one of them: a blocked or emptied read looks
  -- exactly like "every range removed" - nothing of his is deleted or returned, and ONE eastvac.reset.kept audit row says so
  for k in
    select q.pid, q.pname, count(*)::int as kept,
           jsonb_agg(jsonb_build_object('start', w."start", 'end', w."end", 'decision', w.decision) order by w."start", w."end") as reviews
      from public.east_vacation_reviews w
      join (select p.person_id as pid, p.name as pname, p.ord from public.silvis_east_people() p) q on q.pid = w.person_id
     where w."end" >= p_from
       and w.person_id <> all (v_held)
     group by q.pid, q.pname, q.ord
     order by q.ord
  loop
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (v_actor, v_name, 'eastvac.reset.kept',
            jsonb_build_object('summary', 'East vacation reviews of ' || k.pname || ' kept: the cache holds no East vacation of his ending on or after ' || to_char(p_from, 'YYYY-MM-DD') || ', so his ' || k.kept || ' review(s) ending then were not reset (a blocked or emptied Davenport read looks the same)',
                               'person_id', k.pid, 'from', p_from, 'kept', k.kept, 'reviews', k.reviews));
  end loop;
  for x in
    with cur as materialized (
      select r.person_id as pid, r.start_date as s, r.end_date as e from public.silvis_east_ranges() r
    ),
    ppl as materialized (
      select p.person_id as pid, p.name as pname, p.ord from public.silvis_east_people() p
    )
    select w.id as rid, w.person_id as pid, w."start" as s, w."end" as e, w.decision as dec, q.pname,
           case when exists (select 1 from cur c where c.pid = w.person_id and c.s <= w."end" and c.e >= w."start")
                then 'changed' else 'removed' end as why
      from public.east_vacation_reviews w
      join ppl q on q.pid = w.person_id
     where w."end" >= p_from
       and w.person_id = any (v_held)
       and not exists (select 1 from cur c where c.pid = w.person_id and c.s = w."start" and c.e = w."end")
     order by q.ord, w."start", w."end"
  loop
    delete from public.east_vacation_reviews d where d.id = x.rid;
    get diagnostics n = row_count;
    continue when n = 0;
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (v_actor, v_name, 'eastvac.review',
            jsonb_build_object('summary', 'East vacation ' || to_char(x.s, 'YYYY-MM-DD') || '..' || to_char(x.e, 'YYYY-MM-DD') || ' ' || x.pname || ': reset (' || x.why || ')',
                               'person_id', x.pid, 'start', x.s, 'end', x.e, 'decision', 'reset', 'reason', x.why, 'removed', 1, 'was', x.dec));
    person_id := x.pid;
    start_date := x.s;
    end_date := x.e;
    decision := x.dec;
    reason := x.why;
    return next;
  end loop;
end $$;
revoke all on function public.east_vacation_reset_stale(date) from public;
revoke all on function public.east_vacation_reset_stale(date) from anon;
grant execute on function public.east_vacation_reset_stale(date) to authenticated;
grant execute on function public.east_vacation_reset_stale(date) to service_role;
comment on function public.east_vacation_reset_stale(date) is 'Prompt 31 Part A (revision x) with revision aa''s backstop: the ONE review reset both feed refreshes run - deletes every review row of an East person ending on or after p_from whose exact range is no longer a merged cached range (changed / removed), one eastvac.review audit row each, and returns them; but an East person the cache holds NO merged range of ending on or after p_from keeps every review (none deleted or returned) and gets ONE eastvac.reset.kept audit row - a blocked or emptied read looks the same (defence in depth behind the callers'' silent-empty guard, critic A7). The scheduler or a no-user session (the service role) only: EV001; EV002 without p_from. Volatile (POST only); never anon.';

notify pgrst, 'reload schema';
-- applied 2026-10-22 04:50:53Z by Faraz (apply-east-reset-backstop.sh, its CLI in agent mode - AI_AGENT=1; repo HEAD cc4cecc on main, its pins from a0a322c - all five matched; the UTC clock 0447 at step 0 and 0450 at the APPLY step, outside 10:25-10:40; the regression probe sql/probes/east-vacations-probe.sql read the same 56 cases before and after; one earlier run applied nothing: a --dry-run at 20261022T044140Z (main cc4cecc) passed steps 0-3 and stopped after the probe BEFORE); the body above this line is the applied file, sha256 3e2d83e6f306a443eb71b8d66f41f1961e2e1803b705cd1acbc148d519401608 - its header is the text as it ran (its "REPORT-FIRST, NOT APPLIED" and its Order note - the record step adds verify-rls section 23 - predate the record step, which added section 23 to run and grade sql/probes/east-reset-backstop-probe.sql on every run); test/schema.test.js pins it; the revision aa section of docs/SCHEMA-REVIEW.md (2026-10-21) quotes the probe observed right after)
