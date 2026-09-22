# Edge functions review - Davenport sources vs Silvis retarget (Prompt 10, report-first)

*Written 2026-09-22 from the byte-verified DEPLOYED Davenport sources gathered into
`../silvis-edge-src/` (provenance in `../silvis-edge-src/PROVENANCE.md`: calendar-sync v14,
daily-reminder v19, office-notifications v10, send-notification v18). The retargeted Silvis
sources are in `edge-functions/<slug>/index.ts`; the deploy / cron / verification runbook is
`edge-functions/README.md`. Nothing has been deployed, invoked or written to either Supabase
project. This document names secrets by NAME only and contains no addresses.*

## 0. Headline findings

1. **Every schedule read in all four functions is week+slot shaped and had to be rewritten.**
   Davenport assembles a `{ monday: { dayCall, nights: {mon..thu, wknd}, isBackup,
   isFierceBackup, holidayCoverage, dayCallOverrides } }` map from `schedule_weeks` (blob
   fallback). Silvis has one row per day in `schedule_days` (`day, primary_id, backup_id,
   external_cover, note`) and two roles. The retarget keys everything by `day + role`.
2. **Three Davenport functions hardcode project-specific literals that must never be copied:**
   the Davenport project URL (daily-reminder, office-notifications), a Davenport anon JWT
   fallback (both), a fallback / fixed sender address (all three mailers), the Davenport Pages
   URL and the `SURGEON_DEPTS` code map. The Silvis versions read `SUPABASE_URL` from the
   injected env, have **no** anon-key fallback and **no** fallback sender (`NOTIFICATION_FROM_EMAIL`
   missing = HTTP 500, never a send from a stray address).
3. **Schema gaps the functions depend on:** `office_notification_state` (digest baseline) is
   **missing from `sql/schema.sql`** - SQL is in the README section 2 and must be applied before
   the first digest. `office_contacts` has no `departments` column (broadcast to all active
   contacts). `notification_preferences` has no `email` column (addresses are joined from
   `user_profiles.email` on `person_id`). No push tables / functions exist.
4. **Auth posture is tighter than Davenport's.** office-notifications had NO gate in Davenport
   (any holder of the public anon key could trigger a publish broadcast); Silvis requires either
   the `x-cron-secret` (digest / rebaseline only) or a GoTrue-verified session whose
   `user_profiles.role` is admin/scheduler. send-notification keeps the GoTrue check;
   daily-reminder keeps the fail-closed cron gate; calendar-sync stays public (read-only feed of
   anon-readable data). All four keep gateway `verify_jwt` OFF (`--no-verify-jwt`).
5. **Address hygiene fixed.** Davenport's office-notifications echoes contact addresses in
   `results[].email`, dry-run `to` / `would_send`, and in `console.log` lines; its daily-reminder
   logs the recipient address on every send. The Silvis versions log and return counts,
   person ids and contact ids only.
6. **Silent-success bug removed.** Davenport writes the baseline with `PATCH ...?id=eq.digest_snapshot`,
   which returns 2xx with zero rows when the row does not exist. Silvis uses an UPSERT
   (`POST` with `Prefer: resolution=merge-duplicates`) and reports `snapshot_updated` honestly.
7. **Identifiers:** Silvis roster ids are `s1..s6` with codes `FAK MAB BDA AFP NF SRK`; the schedule
   and every table store **ids**; `?surgeon=<CODE>` matches `code` (then last name, then id).
   Davenport's ids ARE its codes (`FAK` is an id there) - none of its `s.id === query` logic
   survives.

## 1. Per-function review

### 1.1 calendar-sync (Davenport v14 -> Silvis)

**What it does.** Unauthenticated GET returns a live `.ics`: full group, or one surgeon via
`?surgeon=`. Read-only; sends no mail; writes nothing.

**Retargeted reads.**

| Davenport read | slot logic | Silvis |
|---|---|---|
| `call_schedule_data` id=main -> `data.surgeons`, `data.apps`, `data.schedule` (blob fallback) | roster by `id === code` | `data.roster` (`id, name, code`); no apps, no blob schedule fallback |
| `schedule_weeks` all rows -> `dayCall` (Mon-Fri 07-17 + Sat 07 -> Sun 07), `nights.mon..thu` (17 -> 07), `nights.wknd` (Fri 17 -> Sat 07, Sun 07 -> Mon 07), `holidayCoverage[date]` (07 -> 07) | week + slot, 5 event shapes | `schedule_days` rows in a rolling window (today-60 .. today+400, Central): one event per filled role per day, 07:00 -> 07:00 next day; `SUMMARY` `Silvis Primary Call` / `Silvis Backup Call` (group feed appends ` - <Name>` so the events are tellable apart); `DESCRIPTION` = both roles + shift line + `note`; `UID silvis-<day>-<role>@silvis-call` |
| fixed `FEED_FLOOR_MONDAY = 2026-05-04` | - | rolling `PAST_DAYS = 60` (see decision D2) |
| `isBackup`, `isFierceBackup`, `dayCallOverrides` | never read by this function | n/a |

**Kept verbatim:** `centralOffsetHours` / `icsDate` DST logic (per-endpoint offset), DTSTAMP
formatted directly in UTC, CORS, `text/calendar; charset=utf-8`, 5-minute cache, valid empty
calendar. **Added:** 405 on non-GET, RFC 5545 line folding, `external_cover` shown in the
backup event's description (an external-cover day has no primary event: null slots are skipped).

**Secrets (by name):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injected; falls back to the
injected `SUPABASE_ANON_KEY` - the tables are anon-readable). No custom secrets.

**verify_jwt:** OFF - must stay OFF (calendar clients send no auth header). Davenport README:
a dashboard deploy re-enables it; verify with an unauthenticated GET -> 200 + `BEGIN:VCALENDAR`.

**Callers:** Google / Apple / Outlook subscriptions; the Settings panel's copy-URL buttons
(the current client still builds `?surgeon=<last name>` - the function accepts name too, but
the guide's contract is `?surgeon=<CODE>`; the UI agent should switch to `s.code`).

**Dropped:** APP feed (`?app=`), the retired blob schedule fallback, supabase-js import
(plain `fetch` + `res.ok` like the other three), PRODID `DSG`.

### 1.2 office-notifications (Davenport v10 -> Silvis)

**What it does.** Emails the office distribution list (`office_contacts`, active rows):
`publish` (manual, after a publish), `digest` (weekly cron: diff vs stored baseline),
`rebaseline` (write the baseline, no mail), `test` (one email to the calling scheduler's own
account address, never to contacts), `digest` + `dryRun:true` (compose only).

**Retargeted reads / writes.**

| Davenport | Silvis |
|---|---|
| `call_schedule_data` -> `surgeons`, `apps`, blob `schedule`, blob `vacations` mirror | `data.roster` names only (positive roster filter kept) |
| `schedule_weeks` -> `current.schedule[week]`; diff on `dayCall` + `nights.mon/tue/wed/thu/wknd` per week | `schedule_days` today .. today+400 -> `days[day] = { p, b, x }`; diff per day on primary (id or external_cover) and backup |
| `time_off` (`person_id, kind, start_date, end_date`, skips `kind=nocall`) | `time_off` (`person_id, start_date, end_date`, no `kind`) ranges ending on/after today; APP exclusion gone |
| `office_notification_state` GET + PATCH (`snapshot`, `last_digest_at`, `last_publish_at`) | same row, day-keyed snapshot v2 with `vacSource: "time_off"` stamp, written by UPSERT; **table must be created** (README section 2) |
| `office_contacts` (`email, name, departments[]`) + `SURGEON_DEPTS` + `DEPT_LABELS` routing | `office_contacts` (`id, name, email, active`) - broadcast; departments dropped |
| `baselineOverride` (dry run only) | dropped (no need without department replay) |

**Self-healing kept:** no usable baseline -> first run writes it silently; baseline without the
time_off stamp -> vacation diff suppressed for one run and healed; quiet week still writes the
current snapshot (rolls the window forward); `dryRun` boolean-only and digest-only (400
otherwise, never a silent live run); ids outside the roster are excluded and `console.error`ed,
never rendered; unresolvable ids in the renderer become a placeholder.

**publish change list:** the client sends `changes: [{ day, role, from, to }]` (ids resolved
to names, `null`/`OPEN` rendered OPEN, id-shaped strings that do not resolve are never
rendered, other strings such as an external cover name rendered escaped). The function never
computes or invents what changed in a publish - it renders the client's list and then
rebaselines so the next digest only reports later edits.

**Secrets:** `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (required), `CRON_SECRET`;
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` injected.

**verify_jwt:** OFF (as found). In-function gate: `x-cron-secret` (digest / rebaseline) or a
verified scheduler/admin session (all modes); publish/test refused on the cron path (403).

**Callers:** the app's publish button (`{mode:"publish", period_label}` with `dbAuthHeaders()`),
the app's "run digest now" button, weekly pg_cron (`{mode:"digest"}` + header).

**Dropped:** week/slot labels (`Service Week`, `Mon night`, `Weekend`), department filtering,
APP roster / APP time-off logging, `kind=nocall` skip, `baselineOverride`, hardcoded project URL /
anon fallback / sender / Pages URL, address echo.

### 1.3 send-notification (Davenport v17 code / v18 deploy -> Silvis)

**What it does.** The app's per-user email path. Verifies the caller's session against GoTrue,
resolves recipients server-side, applies per-category opt-outs, sends through the mail
provider, reports honest counts.

**Retargeted reads.**

| Davenport | Silvis |
|---|---|
| `notification_preferences` (`surgeon_id, email, schedule_changes_email, vacation_updates_email, shift_reminders_email`) - the prefs row IS the address book | `notification_preferences` (`person_id, schedule_updates_email, trade_updates_email, shift_reminders_email`) for opt-outs + `user_profiles` (`person_id, email`) for addresses, both service-role; a person with no linked account is `skipped_no_email`; a missing prefs row = defaults ON |
| `call_schedule_data` -> `surgeons` + `apps` for greeting names | `data.roster` |
| `auth/v1/user` with the service key as apikey | kept as-is |
| Templates that render `data.shift`, `data.week` (week-Monday), `old_surgeon`/`new_surgeon`, `request_type: "nocall"`, vacation approved/denied | one frame per category rendering **`data.message`** (required, HTML-escaped, newlines -> `<br>`) plus optional `data.detail`; the client composes every schedule fact |

**Categories / flags:** `schedule_published`, `manual_edit`, `vacation_logged` ->
`schedule_updates_email`; `trade_proposed`, `trade_accepted`, `trade_declined`, `trade_applied`
-> `trade_updates_email`; `shift_reminder` -> `shift_reminders_email`; `test` ungated.
Davenport names `schedule_changed` -> `manual_edit` and `trade_submitted` -> `trade_proposed`
are accepted as logged aliases so deploy order vs the client build does not matter.

**Response:** `{ sent, failed, skipped_no_email, skipped_pref_off, results: [{ person_id, status }] }`
- no addresses. `targetIds` absent = broadcast to every linked person; `[]` = send to nobody
(200, sent 0); legacy `{ recipients }` = 400.

**Secrets:** `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (required); `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` injected.

**verify_jwt:** OFF (as found); the GoTrue check is the boundary.

**Callers:** the client's `sendEmailNotif(type, data, targetIds)` with `dbAuthHeaders()` only
(verified in Davenport: no function or cron calls it). **Client contract change for the UI
agent:** `data.message` is now required for every type except `test`.

**Dropped:** vacation_submitted / approved / denied templates (no approvals at Silvis), no-call
wording (`request_type`), APP greeting names, the `shift`/`week` fallback bodies, the fallback
sender.

### 1.4 daily-reminder (Davenport v19 -> Silvis)

**What it does.** Hourly cron. Fail-closed `x-cron-secret` gate first. Computes the Central
hour and TOMORROW's date; reads that one `schedule_days` row; for each filled role whose person's
`reminder_hour_central` (null -> 17) equals the current hour and `shift_reminders_email` is not
false, emails "Tomorrow you are on Silvis PRIMARY/BACKUP call (07:00 -> 07:00); the other role is
<name>". Optional `{ dryRun: true }` composes without sending.

**Retargeted reads.**

| Davenport | Silvis |
|---|---|
| `call_schedule_data` -> `surgeons`, `apps`, blob fallback | `data.roster` |
| `schedule_weeks` -> this week's row -> `DAY_SHIFT_MAP[dow]` decodes `dayCall` (Service Week 7a-5p / Sat 7a-7a), `nights[mon..thu]` (5p-7a), `nights.wknd` (Fri 5p-7a / Sun 7a-Mon 7a) for TODAY | `schedule_days?day=eq.<tomorrow>` -> `primary_id`, `backup_id`, `external_cover`, `note` |
| `notification_preferences` (`surgeon_id, email, daily_reminder_hour, shift_reminders_email, shift_reminders_push`) | `notification_preferences` (`person_id, reminder_hour_central, shift_reminders_email`) + `user_profiles.email` by `person_id` |
| `app_shifts_data` (`{ date: appId }`) -> "APP on call with you tonight" / paired surgeon / "No APP tonight - you're all alone" | dropped (no APPs) |
| `functions/v1/send-push` with the anon key | dropped (no send-push / OneSignal in the Silvis project) |

**Secrets:** `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` (required);
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` injected. Davenport's hardcoded project URL, anon-JWT
fallback, sender fallback and Pages URL are gone.

**verify_jwt:** OFF (as found); the header gate is the boundary.

**Callers:** hourly pg_cron only (README section 4). Never the client.

**Dropped:** push, APP email + APP lines, same-day semantics (`Service Week`, `Weekend` labels),
weekday decoding, the `results[].email` status word collisions (statuses are now explicit
`skipped_wrong_hour | skipped_off | skipped_no_email | dry_run_composed | sent | failed_<status>`).

## 2. Shared helper set (inline in each file, no shared module)

`HttpError` + `json()` response helper; `rest(path, init)` (service-role PostgREST, throws on
non-2xx - an RLS-blocked `200 + []` can never be mistaken for success because the service role
bypasses RLS and any real failure throws); `centralYmd()` / `centralNow()` (Intl, DST-aware);
`addDays`, `parseYmd`, `fmtDay`; `loadRoster()` from `call_schedule_data.data.roster`;
`escHtml()`; `sendEmail(to, subject, html, logKey)` (Resend; logs the key and provider status,
never the address). Every handler returns a JSON error with an upstream status on failure
(502 for a failed database/auth call, 500 otherwise).

## 3. Davenport verify_jwt table (as found, README + Deploy path 2)

| function | gateway verify_jwt | Silvis |
|---|---|---|
| calendar-sync | OFF | OFF (must stay) |
| daily-reminder | OFF (CRON_SECRET header is the gate) | OFF, same gate |
| office-notifications | OFF (no in-function gate at all) | OFF, NEW dual gate |
| send-notification | OFF (GoTrue check inside) | OFF, same |
| send-push | ON | not ported |
| vacation-deadline-reminder | OFF | not ported |

## 4. Dropped Davenport behaviour (summary)

- OneSignal push / `send-push` (not requested; no Silvis function or table).
- `vacation-deadline-reminder` (vacations need no approval and have no deadline at Silvis).
- APP shifts, APP feeds, APP reminders, "No APP tonight" line, APP time-off exclusion.
- Vacation approve / deny / submitted emails; no-call (`kind=nocall`) wording and skip.
- Week+slot everything: `dayCall`, `nights`, `wknd`, `isBackup`, `isFierceBackup`,
  `holidayCoverage`, `dayCallOverrides`, Service-Week / night / weekend labels, week-Monday dates.
- Department routing (`SURGEON_DEPTS`, `DEPT_LABELS`, `office_contacts.departments`), `baselineOverride`.
- Weighted / $ logic: none of the four Davenport functions contained any; nothing to drop.
- Hardcoded Davenport literals: project URL (2 files), anon JWT fallback (2), sender address
  (3), Pages URL (2), deploy-comment project ref (1).

## 5. Risks

**Invocations that send real mail (must wait for Faraz):** office `publish`; office `digest`
without `dryRun` when the diff is non-empty and there is at least one active contact; office
`test` (one mail, to the caller); `send-notification` with non-empty or omitted `targetIds`;
`daily-reminder` live at a matching hour (default 17 Central for anyone without a stored hour);
creating either pg_cron job. Everything in README section 5 is side-effect-free
(`rebaseline` writes the baseline row but sends nothing).

**Address exposure:** no Silvis response or log line contains an address. The only address
that ever leaves the database is the `to:` field of the provider call. The `test` mode uses the
GoTrue `user.email` of the verified caller in memory only. Contact data stays out of
anon-readable tables, out of `call_schedule_data`, and out of this repo.

**Identifiers:** schedule columns hold roster ids (`s1..s6`); `notification_preferences.person_id`,
`user_profiles.person_id`, `time_off.person_id` hold the same ids; the roster maps id -> `name`
(last name) and `code`. `?surgeon=` is matched on `code` first (`FAK`), then `name` (`Khan`), then
`id`. The client's publish change list may carry ids or display strings; ids are resolved,
id-shaped strings that do not resolve are never rendered.

**Deploy-order / coupling:** send-notification now requires `data.message`; the current client
(still Davenport-shaped in `index-source.html`) sends `detail` / `shift` / `week` fields and
Davenport type names - aliases cover the names, but a send with no `message` gets a 400 (the
client's toast surfaces it). The UI agent should compose `message` for every call.
office-notifications' publish button should add `changes` (optional; without it the publish
email has no change list but still goes out).

**Schema:** `office_notification_state` must exist before the first digest (the function returns
a 502 with an explicit hint otherwise, never a silent no-op). Adding it to `sql/schema.sql` is a
schema-owner change (report-first, service-role only, no client access).

**Cron:** the secret lives in `cron.job.command` (postgres-role readable) - same as Davenport;
Vault is the upgrade path. Schedules are UTC; the Monday digest drifts one hour between CDT and
CST (documented; harmless).

**Rolling calendar window:** `PAST_DAYS = 60` means a subscribed calendar loses events older
than ~2 months on refresh (Davenport moved to a fixed floor for exactly this reason). See D2.

## 6. Decisions for Faraz (defaults chosen, easy to change)

- **D1 Default reminder hour = 17 Central** when `reminder_hour_central` is null (5 pm the
  evening before a 07:00 shift). Davenport's 8 was a same-day reminder. Change
  `DEFAULT_REMINDER_HOUR` if you prefer e.g. 20.
- **D2 Calendar window rolling 60 back / 400 ahead** vs Davenport's fixed floor. If partners
  want history to stay in their calendars, set `PAST_DAYS` to e.g. 400 or introduce a fixed
  floor (`2026-09-14`, the first imported day).
- **D3 Group feed summaries carry the name** (`Silvis Primary Call - Khan`); per-surgeon feeds
  are the plain `Silvis Primary Call`.
- **D4 office `test` mode mails only the calling scheduler** (never contacts); publish/digest
  are the only paths to the ER-panel author's inbox.
- **D5 Broadcast recipients for send-notification = every `user_profiles` row with a
  `person_id`** (surgeons); viewers with no `person_id` never receive surgeon notifications.
- **D6 `vacation_logged` is gated by `schedule_updates_email`** (there is no vacation flag in
  the Silvis prefs table).

## 7. What could not be verified here

- No Deno on this machine: the four sources were checked for ASCII, for the absence of
  address / JWT / Davenport literals, and for syntax (TypeScript 5.9 `transpileModule`, all
  four clean) - not type-checked against Deno's lib or executed. The first
  `supabase functions deploy` bundles with Deno and will surface any type error before
  anything goes live.
- No invocation against either project (by instruction); the README's verification section
  is the acceptance plan.
