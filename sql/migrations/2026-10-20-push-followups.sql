-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-20 (revision z): phone push follow-ups - a re-armed device replaces its own stale row, and
-- the day-before shift reminder gains its own phone switch (Faraz 10/20: "finish the backlog" with every recommended decision of the
-- private report docs/history/REPORT-PUSH-FOLLOWUPS-2026-10-20.md - B: D2 the wrapper, D3 silent, D4-D7; C: D8 (a) the day-before
-- shift reminder only, D10 default on, D11 one hour, D12 independent, D13 followers yes; D17 ONE migration, each part with its own
-- rollback lines).
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a security definer function every phone's re-arm goes through that
-- deletes push_subscriptions rows, and a new column on notification_preferences). Nothing in the repo applies it: Faraz runs his
-- apply script (kept outside the repo) and pastes the log back.
--
-- The problems. (B) Every silent re-arm - a new endpoint, or a registration Davenport's update reset wiped - saves a NEW row through
-- save_push_subscription and leaves the old one: it goes only on the account's next push (404 / 410) or a Send test, so Diagnose
-- overstates the devices and the dead rows count against the 10-device cap (PS007) - for an account that never receives a push, for
-- good. The device keeps only the first 16 hex of SHA-256(endpoint) (its flag; never the endpoint - guide 22.4), so only the server
-- can find the old row, by that hash. (C) The day-before shift reminder (daily-reminder) is e-mail only: notification_preferences has
-- no phone switch for it.
--
-- What changes. ONE new function and ONE new column; no table, policy, trigger, index, row, table grant or anon surface changes:
--   (B) replace_push_subscription(p_endpoint, p_p256dh, p_auth, p_label, p_replaces) - security definer, volatile (POST only),
--       search_path public, pg_temp; EXECUTE for authenticated, never anon (revoked from PUBLIC and anon). It deletes the caller's OWN
--       earlier row for THIS device - the row whose endpoint hashes to p_replaces: left(encode(sha256(convert_to(endpoint, 'UTF8')),
--       'hex'), 16), the client's _hash (TextEncoder UTF-8, SHA-256, the first 8 bytes as lower-case hex) - then runs
--       save_push_subscription (unchanged: its body, signature, grants and pins) in the same transaction and answers its answer with
--       'replaced' (0 or 1) added. A malformed or null hash, or the hash of the endpoint being saved, deletes nothing (the plain save);
--       another account's row is never touched; a refusal of the save (PS002-PS007) rolls the delete back with it; the delete runs
--       before the cap is counted, so a re-arm on an account with 10 rows, one of them the replaced one, is no longer PS007. It takes
--       save's advisory lock (push_subscriptions:save, re-entrant) before the delete. Silent (D3): no audit row for the replaced row
--       (like the edge function's 404 / 410 delete); the save's push.save row is as today. No new refusal code (PS001 in save's words).
--   (C) notification_preferences.shift_reminders_push boolean not null default true - the day-before shift reminder's phone switch
--       (D10 on: only an explicit false opts out, like every other switch; D11 the hour is reminder_hour_central, the e-mail's; D12
--       independent of shift_reminders_email and of an address; D13 a follower's own row, keyed by profile_id, carries it too). A
--       constant default: no table rewrite, every existing row reads on. prefs_own covers it unchanged; today's client never names
--       it, so its upserts keep the stored value.
-- Return shape (binding, the client reads it): replace {ok, action: added|kept|refreshed|moved, devices, audit, replaced} - save's,
-- plus replaced; devices is counted after the delete and the save. Never the endpoint or the keys.
--
-- Who it binds. (B) Every signed-in account with a profile row, for its OWN rows only (auth.uid()): nobody deletes another account's
-- row, not even the scheduler; a session with no signed-in user is refused (PS001); anon has no EXECUTE. Its only caller is the
-- client's config.js pushDevice (rearm and Enable, with the device's own flag hash - D4 / D5); a client before it, or after a
-- rollback, saves through save_push_subscription as today (a missing function reads as unavailable). (C) Every notification_preferences
-- row - a surgeon's (person_id) and a follower's (profile_id); the daily-reminder edge function reads it with the service role once
-- its push fan-out is deployed (D9 (a), after the client - D16).
--
-- Blast radius. (B) One new function that deletes only the caller's own rows, and only with a well-formed hash that is not the
-- endpoint being saved; a 64-bit prefix collision inside one account's rows is negligible and could only ever hit the caller's own
-- row, which he may already delete (push_subscriptions_own_delete, delete_push_subscription) - no new power. No table, policy,
-- trigger or existing function changes; not in realtime; the edge functions untouched. (C) One NOT NULL DEFAULT true column on an
-- authenticated-only table (no anon row: anon reads 200 []); no function, policy or trigger change. Nothing reads it until the
-- client's third switch ships and daily-reminder is redeployed; from that deploy on, every on-call person (and follower) with push
-- on gets the day-before reminder on his phone at his hour (tell the group - D10). Residuals (recorded): the no-flag cases (site
-- data cleared, a Home Screen app re-added, A's row after an in-place switch, a sign-out the 4 s cap cut short) still wait for the
-- next 404 / 410 or a Send test; a dead endpoint that answers anything but 404 / 410 is still never deleted (the 10/3 rule - no
-- prune, D6); the PS007 words still do not mention Send test (pinned byte for byte on both sides).
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-push-followups.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-20-push-followups.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction, and a paste into the SQL editor runs as one session too - a failure
-- anywhere changes nothing.
-- Order (D16): this apply first, then the client (the third switch; rearm and Enable through the wrapper), then the daily-reminder
-- deploy LAST (the hourly job sends the first reminder push within the hour), then its dryRun with the cron secret. This file's
-- own steps: 1. the pre-check sql/probes/push-followups-precheck.sql (read-only; the gate reads replace_fn=no reminder_col=no
-- save_fn=yes sha256=yes, save's body md5 = the applied Prompt 30 body, its grants, no FORCE RLS, the owners; facts: counts only);
-- 2. probe BEFORE sql/probes/push-followups-probe.sql (expects PROBE_SETUP: replace_push_subscription is absent ...); 3. the Prompt 30
-- probe sql/probes/push-notifications-probe.sql (its 51 cases, before); 4. this file; 5. the gate after (replace_fn=yes
-- reminder_col=yes save_fn=yes sha256=yes, save's body md5 unchanged); 6. probe AFTER (every case as its header lists); 7. the
-- Prompt 30 probe again (the same 51 cases); 8. the record step in docs/SCHEMA-REVIEW.md "2026-10-20 - phone push follow-ups
-- (revision z)".
-- Re-running: idempotent (create or replace; add column if not exists; the grants and the comments re-run); the apply script refuses
-- to re-run it anyway (its gate).
-- Rolling back - each part on its own, part C only AFTER the backed-up daily-reminder is redeployed (D16: with the column dropped
-- and the new function still live, a missing key reads as on and it keeps pushing with no switch):
--   part B (the client falls back to save_push_subscription by itself; rows already replaced stay replaced - they were dead):
--   drop function if exists public.replace_push_subscription(text, text, text, text, text);
--   part C (every stored off is lost - after a re-apply every row reads on again):
--   alter table public.notification_preferences drop column if exists shift_reminders_push;
--   then:
--   notify pgrst, 'reload schema';
-- ============================================================================

-- 2026-10-20 (revision z, part B - D2 the wrapper, D3 silent): the re-arm save. save_push_subscription stays the only path that
-- inserts, updates or moves a row; this wrapper only removes the caller's own earlier row for the device first, in one transaction.
create or replace function public.replace_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text, p_replaces text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me     uuid := auth.uid();
  v_gone integer := 0;
begin
  if me is null then
    raise exception 'PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account' using errcode = 'PS001';
  end if;
  -- the lock save_push_subscription takes (re-entrant in this transaction): the delete, the cap and a move read the same rows
  perform pg_advisory_xact_lock(hashtext('push_subscriptions:save'));
  -- THIS account's earlier row for THIS device: its endpoint hashes (first 16 hex of SHA-256 - the device's flag) to p_replaces.
  -- Never another account's row, never the endpoint being saved; a malformed or null hash replaces nothing.
  if p_replaces ~ '^[0-9a-f]{16}$' and p_endpoint is not null
     and left(encode(sha256(convert_to(p_endpoint, 'UTF8')), 'hex'), 16) <> p_replaces then
    delete from public.push_subscriptions s
     where s.profile_id = me and left(encode(sha256(convert_to(s.endpoint, 'UTF8')), 'hex'), 16) = p_replaces;
    get diagnostics v_gone = row_count;
  end if;
  -- every check, refusal (PS001-PS007), the cap and the push.save audit row stay save_push_subscription's; a refusal there
  -- rolls the delete back with it (one transaction)
  return public.save_push_subscription(p_endpoint, p_p256dh, p_auth, p_label) || jsonb_build_object('replaced', v_gone);
end $$;
revoke all on function public.replace_push_subscription(text, text, text, text, text) from public;
revoke all on function public.replace_push_subscription(text, text, text, text, text) from anon;
grant execute on function public.replace_push_subscription(text, text, text, text, text) to authenticated;
comment on function public.replace_push_subscription(text, text, text, text, text) is 'Revision z: the re-arm save - deletes the caller''s own earlier row for this device (its endpoint''s first 16 hex of SHA-256 = p_replaces, the device''s flag; never another account''s row, never the endpoint being saved; a malformed or null hash deletes nothing), then runs save_push_subscription in the same transaction (every refusal PS001-PS007, the cap and the push.save audit row are its; a refusal rolls the delete back). Answers save''s {ok, action, devices, audit} plus replaced (0 or 1). No audit row for the replaced row (D3). POST only (volatile). Never returns the endpoint or the keys.';

-- 2026-10-20 (revision z, part C - D8 (a), D10-D13): the day-before shift reminder's phone switch on an EXISTING table (a constant
-- default: no rewrite; every existing row - a surgeon's or a follower's - reads on). prefs_own covers it.
alter table public.notification_preferences add column if not exists shift_reminders_push boolean not null default true;
comment on column public.notification_preferences.shift_reminders_push is 'Revision z: phone notifications for the day-before shift reminder (daily-reminder, at reminder_hour_central). Default on; only an explicit false opts out. Independent of shift_reminders_email.';

notify pgrst, 'reload schema';
-- applied 2026-10-22 04:33:15Z by Faraz (apply-push-followups.sh, its CLI in agent mode - AI_AGENT=1; repo HEAD cc4cecc on main, its pins from 25ad475 - all five matched; the Prompt 30 probe read the same 51 cases before and after; one earlier run applied nothing: a --dry-run at 20261022T042712Z (main cc4cecc) passed steps 0-3 and stopped after the Prompt 30 probe BEFORE); the body above this line is the applied file, sha256 4e5185d7061f6729a214decca0a3442b7e494ed5c7429259bd297fa22a4f0146 - its header is the text as it ran (its "REPORT-FIRST, NOT APPLIED" and its Order note - this apply first, then the client - predate the record step: the client had shipped first, 2026.10.20b, and fell back until this apply; the record step added verify-rls section 22 to run and grade sql/probes/push-followups-probe.sql on every run; the daily-reminder v10 deploy comes later, LAST); test/schema.test.js pins it; the revision z section of docs/SCHEMA-REVIEW.md (2026-10-20) quotes the probe observed right after)
