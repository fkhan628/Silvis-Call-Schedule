# Prompt 13 — Open shifts: board, self-claim, notifications

*Paste into Claude Code inside `<your clone>` after Prompt 12 is merged. Faraz's ask
(9/22): "after we have as many shifts filled in as possible there may still be some shifts that are still open — there
should be a way/notification in the app to mark down which shifts are open." Decisions taken with him the same day: any
surgeon may claim an open shift from the list (eligibility-checked), and the group is told on publish plus a Monday
reminder while any open shift remains in the next 30 days, with an "Email the group now" button for the scheduler.
Same ground rules as every prompt: report-first for the schema change, show every edit, verify by observing, one push at
the end, nothing here publishes a schedule.*

```
Read docs/SILVIS-BUILD-GUIDE.md §15, edge-functions/README.md and the coverage strip / "only OPEN" code in
index-source.html (SlotLine, glance.openPrimary/openBackup) before starting. Build this on branch feat/open-shifts, one
commit per numbered part, a test that FAILS before and passes after for every part, and stop for my review before
pushing. Report the schema part first (function text + grants + blast radius) and wait for my go-ahead before applying
it to the live project.

1. ONE DEFINITION OF "OPEN" (helpers.js, pure)
   openSlots(schedule, from, to, today) -> [{ day, role, unit, reason }] for every day in [from, to] that is >= today
   where the role is unassigned: primary = no primary_id AND no external_cover; backup = no backup_id. A day with NO row
   inside the range counts as open for both roles. `unit` names the weekend unit (block/split/daily, Fri–Sun) or the
   holiday unit the day belongs to, else null. `reason` comes from the last generate's diagnostics when the app has them
   (see part 4), else null. The coverage strip, the "only OPEN" filter, the new board, the publish hook and the weekly
   reminder ALL use this function (the edge function mirrors it in TypeScript against the same fixture, part 5) — after
   this prompt there is no second place that decides what "open" means. The Prompt 12 rule that days before today are
   never open is the `today` argument here.

2. CLAIMING — sql/schema.sql, report-first
   create or replace function public.claim_open_slot(p_day date, p_role text) returns jsonb, security definer, modelled
   on apply_trade(): the caller must be authenticated with a linked person_id (silvis_person_id() not null; a scheduler
   assigns from the day editor instead and does not use this). Lock the row (insert one with source 'claim' if the day
   has none but lies inside the published range = between min(day) and max(day) of schedule_days; refuse a day outside
   it). Refuse, each with its own errcode/message: p_day < current_date in America/Chicago; role not in
   ('primary','backup'); slot already held; slot locked; primary requested while external_cover is set; the caller
   already holds the other role that day (the distinct-roles constraint would fail anyway — fail with a clear message
   first); any time_off row of the caller overlapping p_day, or p_day + 1 when p_role = 'primary' (the same rule the
   vacation trigger enforces in the other direction). On success: set the slot, version = version + 1, source = 'claim',
   updated_by = caller, updated_at = now(); insert audit_log ('schedule.claim', {day, role, person}); insert a
   notifications row (type 'shift_claimed', title "<Name> took <M/D> <role>") so every open client's feed updates;
   return {ok, day, role, person_id, version}. revoke from public/anon, grant execute to authenticated. Add cases to
   scripts/verify-rls.sh: anon refused; a linked surgeon claims an open unlocked slot; refused when held, locked,
   past, external-covered, vacation-conflicting, other-role-same-day, outside the published range; a scheduler's day
   editor path is untouched. State plainly in the report that the JS eligibility rules (OR days, Clinton days, caps,
   patterns) are enforced in the client before the button is offered, not in SQL — the function guards data integrity
   and logs everything; for six surgeons that is the accepted boundary (write this into the guide too).

3. THE BOARD — index-source.html
   A new "Open shifts" entry in the nav with a count badge = openSlots(schedule, today, lastPublishedDay, today).length
   (0 hides the badge). The view: a table of open slots from today to the end of the published range — date, weekday,
   role, unit, "why" (part 4), eligible now (the active surgeons for whom eligibility(ctx, day, role, id) passes the
   hard rules, as name chips — computed client-side; show "nobody under the current rules" when empty), last announced
   (from the most recent notifications row of type 'open_shifts' whose data.slots contains this day+role, part 5), and
   an action column: for a surgeon who is eligible, "Take this shift" → confirm sheet showing the day, role, unit, any
   SOFT-rule warnings (cap, pattern, consecutive-day penalty — allowed, but shown) → rpc claim_open_slot → toast the
   result, refresh the day, audit; for an ineligible surgeon, the button is disabled with the hard-rule reason as
   tooltip; for the scheduler, "Assign…" opens the day editor on that day, and "Write in outside cover" sets
   external_cover through the existing editor path. Filters: next 30 days / 60 / all, role, weekend-only. "Copy list"
   (plain text, one line per slot "Fri 11/06 — primary (weekend block) — open", ready for an email or Word) and
   "Email the group now" (scheduler only, part 5). Phone layout like the rest (390 px, no sideways scroll). The
   coverage strip's open counts must equal the board's for the next 60 days — pin that in the smoke harness.

4. WHY IS IT OPEN — persist the reasons
   Accept & Publish already has generator diagnostics in memory. Persist the open-slot reasons into
   call_schedule_data.data.lastGenerate = { at, range, openSlots: [{day, role, reason}] } so the board can show them
   after a reload. That blob is anon-readable: reasons must be the generator's OPERATIONAL wording only ("no eligible
   surgeon — vacations and weekday patterns", "cap reached for all eligible", "East feed busy") — never a personal
   reason, never a name-plus-reason pair that reads as "X is on vacation because…". Add a test that every reason string
   the generator can emit passes the same scrub used by the importer (Prompt 12 item F).

5. NOTIFICATIONS
   a. On Accept & Publish, after the office publish diff: if openSlots over the published range is non-empty, insert a
      notifications row (type 'open_shifts', title "N open shifts through <M/D>", data.slots = [{day, role}]) and call
      send-notification with a new category `open_shifts` (broadcast; honours schedule_updates_email; client composes
      the message: the list grouped by week, "Take this shift" link to the app's Open shifts view). The function only
      needs the new category name added to its allow-list and a frame title; it never invents facts.
   b. "Email the group now" on the board (scheduler only) does the same on demand, and records it (audit
      'openshifts.notify' + the notifications row, which is what "last announced" reads).
   c. Weekly reminder without a session: give daily-reminder a `mode: "open-shifts"` (default mode unchanged) behind the
      same x-cron-secret gate and dryRun contract: compute open slots from schedule_days for [today, today+30] in
      Central time with the mirrored TypeScript openSlots (same fixture as helpers.js, checked in test/exports or a new
      test/open-shifts.test.js run by npm test); if none, 200 {sent:0, open:0}; else email every linked surgeon with
      schedule_updates_email true (addresses from user_profiles via service role, statuses keyed by person_id as today)
      and insert the notifications row. Schedule it with a third pg_cron job, pasted in the SQL editor by me (write it
      into edge-functions/README.md §4 next to the other two, reading the secret from Vault exactly like them):
        select cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $$
          select net.http_post(
            url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
            headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
              coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
            body := '{"mode":"open-shifts"}'::jsonb);
        $$);
      (12:00 UTC = Monday 07:00 CDT / 06:00 CST.) Deploy with --no-verify-jwt as before; prove it with a dryRun post
      through pg_net and quote the 200 body.
   d. On a claim: the client sends `shift_claimed` to the scheduler (targetIds ['s1']) and the claimer; the in-app
      feed row comes from the SQL function (part 2). The office learns of it through the existing weekly digest diff.

6. DOCS + TESTS
   docs/SILVIS-BUILD-GUIDE.md: a §16 "Open shifts" (the single definition, the claim boundary, the three notification
   paths, the cron job); docs/ONBOARDING.md: one paragraph telling surgeons where the list is and that taking a shift
   is immediate and logged; edge-functions/README.md: the new mode, the dryRun example, the cron SQL; the audit-action
   list gains schedule.claim and openshifts.notify. npm test, npm run smoke (both themes, 390 px), scripts/verify-rls.sh
   all green; attach screenshots of the board with at least one open slot, the confirm sheet, and the email preview.
   Stop before pushing.
```
