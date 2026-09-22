# Schema review (Prompt 2) — `sql/schema.sql`, 2026-09-22

*Reviewed before the schema was applied to the empty Silvis project (`bzhsroegtagqhutbnsrp`, zero public tables at the
time). Findings marked **applied** were written into `sql/schema.sql` in the same commit and applied through the
Supabase CLI's linked Management-API path (`supabase db query --linked -f sql/schema.sql`), so no live data was at risk.
Verification: `scripts/verify-rls.sh`.*

## (a) Tables, one line each

| Table | Purpose |
|---|---|
| `user_profiles` | Auth user → roster id + role (`admin`/`scheduler`/`surgeon`/`viewer`); the only place a surgeon's email exists besides `office_contacts`. Authenticated-read. |
| `call_schedule_data` | One row `main`: roster (names/codes), `surgeonRules`, `groupRules`, holiday units, settings blob. Anon-read. |
| `schedule_days` | The schedule, one row per day: `primary_id`, `backup_id`, per-role locks, `source`, `external_cover`, `note`, `version` (compare-and-swap on publish). Anon-read. |
| `time_off` | Vacations only, self-entered, no approval; a trigger refuses a range over a day the surgeon is published (and the day before, for primary). Anon-read. |
| `availability` | Dated availability statements by kind/role (windows, whitelists, backup-only, no-backup…). Anon-read. |
| `east_feed` | Cached Davenport `schedule_weeks` rows by week Monday. Anon-read. |
| `east_overrides` | Manual per-day corrections to the East feed (`busy` true/false). Anon-read. |
| `east_forecast` | East forecast rows (`scripts/east-forecast.js --sql`), one per week Monday, kept out of `east_feed` so a forecast can never read as a published Davenport row. Anon-read. Added to `schema.sql` 2026-09-22; **not yet applied to the live DB** (additive; apply by hand). |
| `shift_trade_requests` | Trades by day + role with an optional return leg and a status lifecycle. Authenticated. |
| `notifications` | In-app notification feed (recipients ride in `data`). Authenticated. |
| `notification_preferences` | Per-person email toggles and reminder hour. Own row + scheduler. |
| `audit_log` | Who did what; insert by any authenticated user, read by scheduler/admin. |
| `call_schedule_snapshots` | Restore points captured before destructive actions and once per session. Scheduler/admin. |
| `client_versions` | Row `main` = minimum version + banner message for the refresh check; other rows = per-client heartbeats. |
| `office_contacts` | Office recipients of publish/change digests (the ER-panel author). Authenticated-read, scheduler-write. |

Helper functions: `silvis_role()`, `silvis_person_id()`, `silvis_is_sched()` — `security definer`, `stable`, `search_path = public`.

## (b) RLS policies — who can read / write

| Table | Read | Write |
|---|---|---|
| `call_schedule_data`, `schedule_days`, `availability`, `east_feed`, `east_forecast` | anyone (anon) | scheduler/admin (all verbs) |
| `client_versions` | anon: row `main` only; authenticated: all rows | scheduler/admin all rows; each authenticated user may insert/update **their own** heartbeat row (`id = auth.uid()`) |
| `time_off` | anyone (anon) | insert/update/delete: the surgeon named in the row (`person_id = silvis_person_id()`) or scheduler/admin |
| `east_overrides` | anyone (anon) | scheduler/admin |
| `user_profiles` | authenticated | self-insert as `viewer` with **no `person_id`**; self-update may not change `role` or `person_id`; admin: everything |
| `shift_trade_requests` | authenticated | insert: proposer or scheduler; update: parties + scheduler, and a trigger restricts non-schedulers to status moves on a pending trade (counter-party → accepted/declined, proposer → cancelled) |
| `notifications` | authenticated | insert: any authenticated user |
| `notification_preferences` | own row or scheduler | own row or scheduler |
| `audit_log` | scheduler/admin | insert: any authenticated user |
| `call_schedule_snapshots` | scheduler/admin | scheduler/admin |
| `office_contacts` | authenticated | scheduler/admin |

## (c) Findings

**Recursion in `silvis_role()` — none.** The function is `security definer` owned by `postgres`, so its `select … from
user_profiles` bypasses RLS; policies that call it never re-enter policy evaluation. The one subselect on
`user_profiles` inside `user_profiles_self_update` is evaluated under the `user_profiles_read` policy (`authenticated`,
`using (true)`), so it terminates too.

**Wrong or risky, and what was done:**

1. **Self-service impersonation via `person_id`** — `user_profiles_self_insert` pinned `role` but not `person_id`, and
   `user_profiles_self_update` pinned `role` only. Any authenticated user could set `person_id = 's1'` and then pass every
   `person_id = silvis_person_id()` check (enter vacations for another surgeon, propose trades as them). **Applied:**
   self-insert requires `person_id is null`; self-update requires `person_id` unchanged. The admin policy (Setup → Users)
   assigns links and roles. Consequence for the client (Prompt 6): signup must stop sending `person_id`.
2. **Nobody populates `user_profiles.email`.** The guide says "populated by Supabase Auth at signup", but there was no
   trigger, and the Davenport client upserts `{ id, person_id, display_name }` without an email. Invited users who never
   open the app would have no row to link. **Applied:** `handle_new_auth_user()` trigger on `auth.users`
   (insert + update of email) creates/refreshes the viewer row with the email. The client never handles an email.
3. **`time_off` trigger ignored the trailing edge.** It checked `start_date..end_date` only, while every doc (and the
   generator) treats the day before a vacation as blocked because that shift ends at 07:00 on the vacation day.
   **Applied:** the day before the range is checked for **primary** only (both roles inside the range). Primary-only
   matches the group's own hand schedule (Philip was backup 10/14 with 10/15 off, and backup 10/22 before an Aledo Friday)
   and keeps the seed import conflict-free; `groupRules.dayBeforeRules` mirrors it in the rules engine.
4. **Trade update policy had no `with check`.** The proposer could set `status = 'accepted'` on their own trade or rewrite
   its legs. **Applied:** `trade_update_guard()` trigger: non-schedulers may only move a pending trade's status
   (counter-party → accepted/declined; proposer → cancelled); legs are immutable for them.
5. **No `primary ≠ backup` constraint** although `groupRules.backupDistinctFromPrimary` is true. **Applied:** check
   constraint `schedule_days_distinct_roles`.
6. **Snapshot contract mismatch.** Davenport's `snapshots.capture` writes `source_updated_at`, which the table lacked;
   every capture would have failed and, because capture failure blocks destructive actions, every reset/regenerate/restore
   would have been blocked. **Applied:** column added; the `data` shape stays `{ config, schedule_days[], time_off[],
   availability[] }` and Prompt 6 Slice A retargets capture/restore to it.
7. **No idempotency key on `availability`** although the importer keys rows on person+kind+role+start+end+source.
   **Applied:** unique index on that tuple (`coalesce(source,'')`).
8. **Missing indexes** for the hot reads: trades by status/day, notifications, audit and snapshots by `created_at desc`.
   **Applied.**
9. **`client_versions` only knew about `main`.** The carried-over refresh mechanism also has a per-client heartbeat
   (Davenport's Settings → Client Versions card). **Applied:** heartbeat columns and self-upsert policies; anon can read
   only the `main` row, so user agents and person ids are not anon-visible.
10. **Anon exposure, reviewed and accepted:** `call_schedule_data` (rules and operational notes — no contact data by
    policy), `schedule_days`, `time_off`, `availability`, `east_feed`, `east_overrides` (documented now; it was missing
    from the anon list in the guide and `CLAUDE.md`), and `client_versions.main`. None carries contact data; notes are
    kept operational by the importer (personal wording is replaced).
11. **Not changed, noted:** `schedule_days.source` is free text (documented values `import | generated | manual |
    east-derived | trade`); `notifications` insert is open to any authenticated user (same as Davenport); the trigger
    fires on `update` of `time_off` too, so editing a note re-validates the range (harmless); PostgREST default grants
    for `anon`/`authenticated` on new tables are the Supabase defaults.

## (d) Verification

`scripts/verify-rls.sh` prints PASS/FAIL per check with the raw HTTP status lines:

1. anon `GET schedule_days` → 200;
2. anon `POST schedule_days` → 401/403;
3. scheduler-JWT `POST schedule_days` → 201 (runs only when `SILVIS_JWT` is set in the environment — never in a file);
4. trigger: over a published day → `ON_CALL_CONFLICT`; the day after a published **primary** day → `ON_CALL_CONFLICT`;
   the day after a published **backup** day → accepted; a clean range → accepted (run through the CLI's linked SQL
   path with a throw-away `s9test` id, cleaned up afterwards).

Result at the time of writing is recorded in the Prompt 2 update.
