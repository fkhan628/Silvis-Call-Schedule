# Silvis edge functions - deploy and verification runbook

Four Deno edge functions for the Silvis Supabase project `bzhsroegtagqhutbnsrp`,
retargeted from the Davenport (DSG) functions on 2026-09-22
(the 9/22 review of what changed in each is history, `docs/HISTORY.md`).

| slug | source | caller | can it send mail? |
|---|---|---|---|
| `calendar-sync` | `edge-functions/calendar-sync/index.ts` | calendar apps + the Settings "subscribe" URLs (unauthenticated GET); since Item D (2026-09-24) also `?surgeon=<CODE>&east=1`, the combined Silvis + Davenport feed for office staff (all-day Davenport events from `east_feed` + `east_vacation_reviews`, read with the service role) | never |
| `office-notifications` | `edge-functions/office-notifications/index.ts` | app (publish / digest buttons, scheduler JWT) + weekly pg_cron (`x-cron-secret`) | yes - `publish`, live `digest`, `test` |
| `send-notification` | `edge-functions/send-notification/index.ts` | app `sendEmailNotif` (verified user JWT whose `user_profiles.role` is admin / scheduler, or a linked surgeon for his own targeted categories - audit RLS-1, 2026-09-23) | yes - any non-empty send the gate lets through |
| `daily-reminder` | `edge-functions/daily-reminder/index.ts` | hourly pg_cron (`x-cron-secret`, default mode) + Monday pg_cron (planned, section 4 - not created yet) with body `{"mode":"open-shifts"}` (same gate) | yes - at a matching reminder hour; mode `open-shifts`: every linked surgeon with `schedule_updates_email` on, while any published slot in the next 30 days is open |

These are deployed BY HAND with the Supabase CLI. A `git push` never deploys a
function. All four functions were first deployed on 9/22 (verify_jwt off). The
Prompt 13 versions of `send-notification` and `daily-reminder` were deployed on
2026-09-22 18:31 UTC (both now version 3, downloaded back and byte-identical to
this folder; the previous versions were backed up first). Proof through pg_net
with the Vault secret the same day: `{"mode":"open-shifts","dryRun":true}` ->
200 `{"mode":"open-shifts","dry_run":true,"open":9,"through":"2026-10-22",
"published_through":"2026-10-22","window_end":"2026-10-22","sent":0,"failed":0,
"skipped_pref_off":0,"skipped_no_email":0,"feed_row":"skipped_dry_run","results":
[{"person_id":"s1","status":"dry_run_composed"}]}`; `{"mode":"nope"}` -> 400; the
default-mode dryRun still answers as before (200, tomorrow's two on-call people
`skipped_wrong_hour`). The third (Monday open-shifts) cron job in section 4 is not created yet.

**Audit RLS-1 (2026-09-23): `send-notification` deployed as version 4** (2026-09-23 ~15:55 UTC, from the linked CLI
with `--no-verify-jwt`; the workdir copy is byte-identical to `edge-functions/send-notification/index.ts`, sha256
`be215d8b856081c4...`; `supabase functions list` reads version 4, previous 3 of 2026-09-22). The role / party gate is
live: an anon POST answers `HTTP 401 {"error":"authentication required ..."}`. The section 5 JWT checks (viewer 403,
surgeon broadcast 403, surgeon own-party 200 sent 0) still need real sessions - Faraz runs them; no JWT was handled
by the deploy.

**Prompt 14 (2026-09-23 ~18:50 UTC): `send-notification` version 5 and `daily-reminder` version 4 deployed** from main
`cd8996d` with `--no-verify-jwt` (send-notification: the `offers_reminder` / `offers_closed` categories over the version-4
role / party gate; daily-reminder: mode `offers` beside `open-shifts`; the workdir copies are byte-identical to the repo files).
Anon POSTs answer 401 on both. The cron job `silvis-offers-daily` was created the same minute (jobid 3, `0 13 * * *`, the
Vault secret; `cron.job` now lists three jobs - `silvis-open-shifts-weekly` is still the one not created).

**Prompt 16 A7 (coordinator role, 2026-09-24): `send-notification` redeploy is a comment-only change.** The new
`user_profiles.role` value `coordinator` (office users who enter the surgeons' vacations and relay offered dates; see
`sql/migrations/2026-09-24-coordinator-role.sql`) is refused by `senderRole()` exactly like `viewer` - the function
admits admin / scheduler / a linked surgeon only, so no logic changed; the source gained a comment naming the role and
`test/edge-functions.test.js` pins the 403 on every category. The orchestrator redeploys with `--no-verify-jwt` so the
workdir copy stays byte-identical to the repo file (record the version number here). The client does not call
`send-notification` for a coordinator's vacation entry (the `vacation_logged` e-mail to the scheduler is skipped; the
in-app feed row and the audit row are still written) - a coordinator's session would only collect 403s.

**Prompt 16 B5 (security minors, 2026-09-23): all three deployed 2026-09-24 03:20-03:21 UTC (send-notification v6, daily-reminder v5, office-notifications v3; record in section 3).** Three functions changed in the
repo (constant-time `x-cron-secret` compare in `daily-reminder` and `office-notifications`, the
`/\S+@\S+/g` log redaction in all three mail functions (applied to the WHOLE provider body before the
160-character log truncation, so a cut inside an address cannot leave a local part behind), and in
`send-notification` the mail-config checks below the role gate, the `targetIds` cap and the `trade_id`
party check). The pending deploy record with the commands and the proofs is in section 3; the new
refusals are in section 5. Deploy the client build that sends `trade_id` (a push to `main`) BEFORE
`send-notification` v6, or trade mail from an older client answers 400 until the users reload.
Open decision (review 2026-09-23, not in this deploy): a minimum length for the CONFIGURED `CRON_SECRET`
(`cronSecretMatches` refuses an unset / empty configured value and any short, prefix or missing header,
but accepts a one-character configured value). Adding a floor blind could lock the three pg_cron jobs
out on redeploy; Faraz confirms the live secret's length (never its value) first, then the floor lands
in both `@cronSecret` blocks with a test, or the secret is rotated per section 4 before it does.

**Prompt 15 (East vacations, 2026-09-23): nothing deployed.** No function
changed for this prompt and none was redeployed. The feature is the client
(the East feed refresh reads Davenport's `time_off`, the review controls, the
markers) plus one new table, `east_vacation_reviews`, applied by hand as
`sql/migrations/2026-09-23-east-vacation-reviews.sql` through the linked CLI's
SQL path - a table migration, not a function deploy, and no cron change. The
office digest, the daily reminder (both modes) and `calendar-sync` are unchanged
on purpose: they show assignments, not availability, and a derived East
vacation is never an assignment.

**Deploy record.** All four functions were deployed 2026-09-22 from the CLI with
`--no-verify-jwt` (verify_jwt OFF on each: `calendar-sync` answered a live
unauthenticated GET, the other three answered 401 without their gate - see
the 9/22 status report, history, `docs/HISTORY.md`). The function-side secrets `CRON_SECRET`,
`RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` were set in the dashboard the
same day (2026-09-22 12:56 UTC, by Faraz; names only are recorded anywhere).
Three of the four pg_cron jobs in section 4 exist (`silvis-daily-reminder-hourly` and `silvis-office-digest-weekly`
since 9/22, `silvis-offers-daily` since 9/23; `silvis-open-shifts-weekly` is not created yet) and read the secret from Supabase
Vault (`silvis_cron_secret`) at run time; both functions answered pg_net
`dryRun` posts with 200 (the 9/22 review, section 6 - history, `docs/HISTORY.md`). The version
numbers quoted above are as of 2026-09-22 18:31 UTC; a `supabase secrets set`
re-versions all four, so always read `supabase functions list` before a
redeploy, and keep the download-and-byte-compare convention in section 3 so
the repo stays the source of truth.

## 0. Prerequisites

1. Supabase CLI installed and logged in (`supabase --version`, `supabase projects list`).
2. A CLI workdir linked to the SILVIS project. Do NOT reuse `<your home folder>`
   (that is the Davenport-linked staging area). Create a separate one:
   ```powershell
   New-Item -ItemType Directory -Force <cli-workdir>
   supabase init  --workdir <cli-workdir>
   supabase link  --workdir <cli-workdir> --project-ref bzhsroegtagqhutbnsrp
   ```
3. Copy each source into the workdir (the CLI deploys `supabase/functions/<slug>/index.ts`):
   ```powershell
   $repo = "<your clone>\edge-functions"
   $wd   = "<cli-workdir>\supabase\functions"
   foreach ($slug in "calendar-sync","office-notifications","send-notification","daily-reminder") {
     New-Item -ItemType Directory -Force "$wd\$slug" | Out-Null
     Copy-Item "$repo\$slug\index.ts" "$wd\$slug\index.ts" -Force
   }
   ```
4. A Resend account with a VERIFIED sending domain; the sender goes in
   `NOTIFICATION_FROM_EMAIL` (below). There is no hardcoded fallback sender in
   any Silvis function - a missing value is a 500, never a send from a stray address.
5. The office digest's baseline table (section 2) is in `sql/schema.sql`, applied 2026-09-22.

## 1. Secrets (set by NAME; values never go in this repo, in a URL, or in chat)

| secret | needed by | notes |
|---|---|---|
| `RESEND_API_KEY` | office-notifications, send-notification, daily-reminder | Resend API key |
| `NOTIFICATION_FROM_EMAIL` | office-notifications, send-notification, daily-reminder | e.g. `Silvis Call Schedule <schedule@your-verified-domain>` - REQUIRED, no fallback |
| `CRON_SECRET` | daily-reminder (sole gate), office-notifications (cron path) | long random string; generate with `openssl rand -hex 32` or PowerShell `-join ((1..48) | % { '{0:x}' -f (Get-Random -Max 16) })` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | all | injected automatically by Supabase - do not set |

```powershell
supabase secrets set RESEND_API_KEY=<value> "NOTIFICATION_FROM_EMAIL=Silvis Call Schedule <sender@your-verified-domain>" CRON_SECRET=<value> --project-ref bzhsroegtagqhutbnsrp
# (quote the sender value: it contains spaces and angle brackets; in PowerShell keep the double quotes exactly as above, or use --env-file)
supabase secrets list --project-ref bzhsroegtagqhutbnsrp     # names only are printed - fine to paste
```

`supabase secrets set` re-versions EVERY deployed function (Davenport lesson:
the version number jumps without a code change). Set secrets BEFORE the first
deploy so the functions come up configured. (Done 2026-09-22 - see the deploy
record at the top; a rotation re-versions all four again.)

## 2. Database: baseline table for the office digest (one-time SQL)

`office_notification_state` is in `sql/schema.sql` (added 2026-09-22 and applied to the live project). Shown here
for reference; re-running `sql/schema.sql` is safe. No RLS policies on purpose: only the service role (the edge
function) reads or writes it; the client never touches it.

```sql
create table if not exists public.office_notification_state (
  id               text primary key,          -- 'digest_snapshot'
  snapshot         jsonb,                     -- { v, days: { day: { p, b, x } }, vacations, vacSource, window, captured_at }
  last_digest_at   timestamptz,
  last_publish_at  timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.office_notification_state enable row level security;
```

The function writes this row with an UPSERT, so it does not need seeding.

## 3. Deploy commands (all four with --no-verify-jwt)

```powershell
$wd = "<cli-workdir>"
supabase functions deploy calendar-sync        --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy office-notifications --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy send-notification    --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy daily-reminder       --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions list --project-ref bzhsroegtagqhutbnsrp
```

Why `--no-verify-jwt` on all four: the gateway toggle only checks for ANY valid
project JWT (the public anon key qualifies), so it is not a security boundary.
Each function carries its own gate instead:

| slug | gateway verify_jwt | real gate inside the function |
|---|---|---|
| calendar-sync | OFF (must stay OFF - calendar apps send no auth header) | none: public read-only feed of anon-readable data |
| office-notifications | OFF | `x-cron-secret` == `CRON_SECRET` (digest / rebaseline; constant-time compare since Prompt 16 B5 - SHA-256 both sides, XOR the bytes) OR a GoTrue-verified session whose `user_profiles.role` is admin/scheduler |
| send-notification | OFF | GoTrue-verified user session (`/auth/v1/user`) AND a role/party gate on `user_profiles.role` (2026-09-23, audit RLS-1; since Prompt 16 B5 also: the mail-config 500s only after this gate, `targetIds` capped at roster size + 1, and every `trade_*` send names its `shift_trade_requests` row in `data.trade_id` whose two parties must be exactly `targetIds`): admin / scheduler send every category (on role alone - no `person_id` link required, as for office-notifications); a linked surgeon only `trade_*` to the two parties (himself among them), `shift_claimed` to himself + scheduler-linked ids, `vacation_logged` to scheduler-linked ids, `test` to himself - never a broadcast, and never `offers_reminder` / `offers_closed` (Prompt 14 part 4: the scheduler's Periods -> Remind button, or the daily offers cron through `daily-reminder`, which does not pass this gate); a viewer, a coordinator (Prompt 16 A7 - the office account relays vacations / offers in the app but never mails through the group sender), a missing row or an unlinked surgeon gets 403. Prompt 19 S3 (v7, PENDING deploy): `trade_applied` may also carry scheduler-linked ids beside the two parties (an accepted give is reported to the scheduler) - the parties stay required, nobody else is allowed, a surgeon sender must be a party; the other `trade_*` stay exactly the two parties |
| daily-reminder | OFF | `x-cron-secret` == `CRON_SECRET`, fail closed (constant-time compare since Prompt 16 B5) |

Gotcha carried over from Davenport: a DASHBOARD deploy re-enables "Verify JWT"
for that function. Always deploy from the CLI, and after any deploy re-run the
calendar-sync check in section 5.

After deploying, follow the Davenport convention: `supabase functions download
<slug> --workdir $wd --project-ref bzhsroegtagqhutbnsrp` and byte-compare with
the repo copy (`fc.exe` / `cmp`) so the repo stays the source of truth.

### Deploy record - calendar-sync all-day runs (Faraz 2026-09-25: "the calendar looks busy, and 07:00 -> 07:00 shifts draw across two days") - deployed 2026-09-25 13:20:14 UTC by the orchestrator

One function changes; `office-notifications`, `send-notification` and `daily-reminder` are untouched and are NOT
redeployed. No schema, no RLS, no write. The feed becomes ALL-DAY by default: one all-day event per run of consecutive
days (`DTSTART;VALUE=DATE` = the first day, `DTEND;VALUE=DATE` = the day after the last), the exact times in the
description (`07:00 Fri -> 07:00 Mon (Central)`, the arrow is U+2192 in the feed); per surgeon a run is the same role
(`Silvis Primary` / `Silvis Backup`, a Fri-Sun block is one 3-day bar), the group feed a run of the same primary AND
backup (`P Burchett . B Acton`, the dot is a middle dot, U+00B7); `east=1` merges consecutive Davenport days with the
same reason (a service week Mon-Sat is one bar). UIDs `silvis-<start>-<role>@silvis-call` / `silvis-<start>-group@silvis-call`
/ `east-<CODE>-<start>-<reason>@silvis-call`: a run that grows or shrinks at its end updates in place; a new start day
is a new UID (the old event is deleted and the new one added on the subscriber's next refresh). `?timed=1` serves the
v4 format byte-for-byte (one 07:00 -> 07:00 event per day and role, `Silvis Primary Call[ - <Name>]`, UIDs
`silvis-<day>-<role>@silvis-call`, one all-day Davenport event per busy day) - for anyone who prefers it. Subscribers
see their calendar redrawn on the first refresh after the deploy (each run's first-day event updates in place; the
per-day events of its other days drop out; the group feed's per-role UIDs are replaced by the `-group` ones).
Counts computed read-only from the anon-readable rows on 2026-09-25 (window 2026-07-27 .. 2027-10-30) by running the
new `@icsCore` block: group 216 -> 82 events, `?surgeon=FAK` 28 -> 14, `?surgeon=MAB` 43 -> 35, `?surgeon=NF` 45 -> 16,
`?surgeon=FAK&east=1` 55 -> 31 (14 Silvis + 12 Davenport runs from 22 busy days + the 5 away ranges, which are
authenticated-read and inferred as 55 - 28 - 22); `?timed=1` reproduces 216 / 28 / 43 / 45 / 55.

| when (UTC) | slug | version before -> after | what changed | proof (section 5, no mail can result) |
|---|---|---|---|---|
| 2026-09-25 13:20:14 | `calendar-sync` | v4 -> **v5 (deployed 2026-09-25 13:20:14 UTC)** | all-day runs by default (`buildEvents`, `eastIcsEvents` merged runs, `endsOnOrAfter` + a `RUN_LOOKBACK_DAYS = 14` read so a run straddling today-60 that started at most 14 days before it keeps its start day; the description dates a run of 7+ days); the old per-day format behind `?timed=1` (`buildTimedEvents`, `eastIcsDayEvents`, exactly the old window); X-WR-CALNAME, 200 / 404 / 405 unchanged | observed 13:20-13:21 UTC, no auth header, every variant 200 `text/calendar` `BEGIN:VCALENDAR` (tool: before / after bodies kept outside the repo): events before (v4) -> after (v5), all of them all-day after: group 216 -> 82; `?surgeon=FAK` 28 -> 14; `MAB` 43 -> 35; `BDA` 48 -> 35; `AFP` 46 -> 26; `NF` 45 -> 16; `SRK` 6 -> 6; `?surgeon=FAK&east=1` 55 (27 all-day) -> 31 - the lane's predictions exactly. `?timed=1` on all eight equals the v4 body fetched just before the deploy, byte for byte with the per-request DTSTAMP lines ignored (216 / 28 / 43 / 48 / 46 / 45 / 6 / 55). `?surgeon=ZZZ` -> 404; POST -> 405. Live v4 downloaded first (byte-identical to the repo's v4 at a1aee16); after the deploy `functions list` reads v5 (13:20:14) and the downloaded copy is byte-identical to this commit's `index.ts` |

### Deploy record - Prompt 19 S3 (give a day: the applied give is mailed to the scheduler too) - deployed 2026-09-25 05:36:23 UTC by the orchestrator

One function changes; `calendar-sync`, `office-notifications` and `daily-reminder` are untouched and are NOT
redeployed. No schema, no RLS. Order: deploy v7 BEFORE the Prompt 19 client push - v7 accepts everything v6 accepts
(the widening is additive), but under v6 the give's `trade_applied` mail (targetIds [from, to, scheduler]) is refused
403 as a whole, so the two parties would get no mail either (the in-app rows are written regardless). Read
`supabase functions list` first, back the live copy up with `download`, byte-compare after (the same commands as
below, for `send-notification` alone).

| when (UTC) | slug | version before -> after | what changed | proof (section 5, no mail can result) |
|---|---|---|---|---|
| 2026-09-25 05:36:23 | `send-notification` | v6 -> v7 (deployed 2026-09-25 05:36:23 UTC; live v6 backed up first, byte-identical to the repo's v6; observed 05:36 UTC: no session -> 401, an invalid token -> 401) | `trade_applied` only: scheduler-linked ids may ride beside the row's two parties (`tradeExtraIds` -> `tradePartyCheck`'s third argument), consulted only when the targets name an id beyond the two parties (`tradeNamesOthers` - an admin / scheduler caller reads the list there, so a v6-shaped send never depends on that read); a surgeon sender must be one of the row's parties (`tradePartyCheck`'s fourth argument, 403 `the sender must be a party to the trade`) and may name at most the two parties besides the schedulers; every v6 refusal is kept. Prompt 19 S4 (same pending v7): a give's mail carries `data.kind` `give` and its frame heading (and default subject) reads `Day Offered` / `Give Accepted` / `Give Declined` / `Give Applied` instead of `Shift Trade ...` (`frameTitle`, the `@giveFrame` block; cosmetic - the gate never reads kind, v6 ignores the key) | to observe after the deploy (section 5, Prompt 19 lines): `trade_applied` naming a real row's two parties plus a NON-scheduler surgeon -> 403 `targetIds may add only scheduler-linked ids to the trade's two parties`; `trade_applied` naming one party plus the scheduler -> 403 `targetIds must include both of the trade's parties`; `trade_proposed` naming the two parties plus the scheduler -> 403 `targetIds must be exactly the trade's two parties` (unchanged); anon -> 401 as before. The allow path (the two parties + the scheduler) sends real mail - it is observed on the first accepted give: the function log line `type=trade_applied targets=<from>,<to>,<scheduler id>` and `sent` = the opted-in recipients; the S4 heading is seen on that same first give mail (a `Give Applied` frame, not `Shift Trade Applied`) |

### Deploy record - calendar-sync without the day note (Faraz 2026-09-25) - deployed 2026-09-25 11:37:21 UTC by the orchestrator

Event descriptions carry Primary / Backup / Shift only: the day's internal note (e.g. `seed: office-er-call-panels-...`,
`open (9/22)`) is no longer read or written (the app's own .ics download drops it the same way). Live v3 downloaded first
(byte-identical to the repo's v3), then deployed with `--no-verify-jwt`.

| when (UTC) | slug | version before -> after | what changed | proof |
|---|---|---|---|---|
| 2026-09-25 11:37:21 | `calendar-sync` | v3 -> v4 (deployed 2026-09-25 11:37:21 UTC) | `buildEvents` no longer appends `Note: <note>`; the schedule_days read no longer selects `note` | observed 11:38 UTC, unauthenticated GET: group feed 200 / `BEGIN:VCALENDAR` / 216 events, `?surgeon=FAK` 200 / 28 events (as before), `?surgeon=FAK&east=1` 200 / 55 events, `?surgeon=MAB` 200 / 43 events - 0 note lines in all four (12 in the `?surgeon=FAK` feed before the deploy) |

### Deploy record - Item D (Khan's combined calendar + the digest's Davenport line, 2026-09-24) - filled 2026-09-24 07:55 UTC by the orchestrator (deployed after the client build 2026.09.24e was served)

Two functions change; `send-notification` and `daily-reminder` are untouched and are NOT redeployed. No schema, no RLS,
no new table, no write from either function. Read `supabase functions list` first, back each function up with
`download` before overwriting, byte-compare after. Order: the client build (the Settings link) may go first or last -
neither side depends on the other (the link is the public feed URL with one flag; an older function ignores `east=1`).

| when (UTC) | slug | version before -> after | what changed | proof (section 5, no mail can result) |
|---|---|---|---|---|
| 2026-09-24 07:52:13 | `calendar-sync` | v2 -> v3 (deployed 2026-09-24 07:52:13 UTC) | `?surgeon=<CODE>&east=1`: all-day Davenport events (`@eastCalendar` + `@icsCore` plain-JS blocks) for a surgeon whose East feature reads busy days; the Davenport id resolved by code (`east_forecast` row, else the Davenport roster GET, capped at 8 s); an unresolvable id -> 502 JSON, never a feed without the East events; a missing service role -> 500 JSON | unauthenticated GET `?surgeon=FAK&east=1` -> 200, `X-WR-CALNAME:Silvis + Davenport - Khan`, at least one `DTSTART;VALUE=DATE:` + `SUMMARY:Khan - Davenport ...` (the real line has an en dash, U+2013, between the name and the words; this README stays ASCII) beside the `Silvis Primary Call` events; the plain GET and `?surgeon=FAK` byte-shape as before (200, `BEGIN:VCALENDAR`); `?surgeon=NF&east=1` == `?surgeon=NF`; `?east=1` alone == the group feed; `?surgeon=ZZZ&east=1` -> 404. OBSERVED 07:53 UTC: `?surgeon=FAK&east=1` -> 200, 16,614 bytes, `BEGIN:VCALENDAR`, `X-WR-CALNAME:Silvis + Davenport - Khan`, 54 VEVENTs = 28 Silvis + 26 all-day Davenport (4 of them away ranges), first all-day UIDs `east-FAK-2026-08-27-night`, `east-FAK-2026-09-02-night`, `east-FAK-2026-09-08-service-week`, no address in the feed; `?surgeon=FAK` -> 200 with the same 28 timed events and no all-day event; `?surgeon=NF&east=1` and `?surgeon=NF` both 200 and 15,445 bytes; `?surgeon=ZZZ&east=1` -> 404; POST -> 405 |
| 2026-09-24 07:52:16 | `office-notifications` | v3 -> v4 (deployed 2026-09-24 07:52:16 UTC) | the digest's "<Name> at Davenport this week" section (next 14 days, the same words as the events) + the combined-feed link in the footer; `east` in every digest response; the send trigger unchanged | `{"mode":"digest","dryRun":true}` with the secret -> 200 with `"east":{"people":[{"name":"Khan","code":"FAK","lines":[...]}],"lines":N,"html":"...","errors":[]}` and, on a quiet week, `sample_east_section` (or `sample` when there are changes) containing `at Davenport this week` and `calendar-sync?surgeon=FAK&east=1`; no secret -> 401 as before. OBSERVED 07:52:49 UTC (one pg_net dryRun call with the weekly job's own vault-referenced header, request 52): 200, `would_send` 0, `sent` 0, `east.people` = [Khan / FAK] with 4 lines (`Fri Sep 25: Davenport weekend`, `Sun Sep 27: Davenport weekend`, `Wed Sep 30: Davenport night`, `Mon Oct 5 - Wed Oct 7: Davenport service week`), the rendered section headed `Khan at Davenport this week` with the 14-day note |

```powershell
$wd = "<linked dir>"   # the workdir linked with: supabase link --project-ref bzhsroegtagqhutbnsrp
supabase functions list --project-ref bzhsroegtagqhutbnsrp
foreach ($slug in "calendar-sync","office-notifications") {
  supabase functions download $slug --workdir $wd --project-ref bzhsroegtagqhutbnsrp     # backup of the live copy first
}
# copy the two repo files over $wd\supabase\functions\<slug>\index.ts, then:
supabase functions deploy calendar-sync        --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy office-notifications --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions list --project-ref bzhsroegtagqhutbnsrp                                  # versions +1 each, verify_jwt off
```

### Deploy record - Prompt 16 B5 (security minors, review 2026-09-23 section 3) - filled 2026-09-24 03:23 UTC by the orchestrator

Three functions change; `calendar-sync` is untouched and is NOT redeployed. Read `supabase functions list`
first (a `secrets set` re-versions all four), back each function up with `download` before overwriting,
byte-compare after. Order: the client build that sends `data.trade_id` (a push to `main`) must be live
BEFORE `send-notification` v6 - a newer client against the v5 function is fine (the extra field is ignored),
an older client against v6 gets 400 on trade mail until it reloads. The other two functions do not depend on
the client.

| when (UTC) | slug | version before -> after | what changed | proof (section 5, no mail can result) |
|---|---|---|---|---|
| 2026-09-24 03:21:26 | `send-notification` | v5 -> **v6 (deployed 2026-09-24 03:21:26 UTC)** | mail-config 500s below the role gate; `targetIds` capped at roster size + 1 (400); `trade_*` needs `data.trade_id` and the row's two parties must be exactly `targetIds` (400 / 403); `/\S+@\S+/g` log redaction | observed 03:23 UTC: anon POST -> 401. Still to observe from a scheduler session (the harness has none): `trade_proposed` without `trade_id` -> 400; a uuid that names no row -> 403; 9 ids -> 400; the v5 checks unchanged |
| 2026-09-24 03:20:24 | `daily-reminder` | v4 -> **v5 (deployed 2026-09-24 03:20:24 UTC)** | constant-time (timing-safe) `x-cron-secret` compare; log redaction | observed 03:23 UTC: no secret -> 401, a wrong secret -> 401. The with-secret 200 is observed on the next hourly cron run (cron.job_run_details, silvis-daily-reminder-hourly) - the CLI session holds no secret |
| 2026-09-24 03:20:47 | `office-notifications` | v2 -> **v3 (deployed 2026-09-24 03:20:47 UTC)** | the same constant-time compare in `authorize()`; log redaction | observed 03:23 UTC: no secret -> 401. The with-secret 200 is observed on the next weekly digest run (cron.job_run_details, silvis-office-digest-weekly) |

```powershell
$wd = "<linked dir>"   # the workdir linked with: supabase link --project-ref bzhsroegtagqhutbnsrp
supabase functions list --project-ref bzhsroegtagqhutbnsrp
foreach ($slug in "send-notification","daily-reminder","office-notifications") {
  supabase functions download $slug --workdir $wd --project-ref bzhsroegtagqhutbnsrp     # backup of the live copy first
}
# copy the three repo files over $wd\supabase\functions\<slug>\index.ts, then:
supabase functions deploy send-notification    --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy daily-reminder       --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions deploy office-notifications --workdir $wd --project-ref bzhsroegtagqhutbnsrp --no-verify-jwt
supabase functions list --project-ref bzhsroegtagqhutbnsrp                                  # versions +1 each, verify_jwt off
```

### Deploy record - offers mode (Prompt 14 part 4) - filled 2026-09-23 (B10 closes the placeholder)

| when (UTC) | slug | version before -> after | proof |
|---|---|---|---|
| 2026-09-23 ~18:50 | `send-notification` | 4 -> 5 | deployed from main `cd8996d` with `--no-verify-jwt`; categories `offers_reminder` / `offers_closed` in the downloaded copy, byte-identical to the repo; anon POST -> 401 |
| 2026-09-23 ~18:50 | `daily-reminder` | 3 -> 4 | deployed from main `cd8996d` with `--no-verify-jwt`; mode `offers` beside `open-shifts`, byte-identical to the repo; anon POST -> 401. The pg_net dryRun `{"mode":"offers","dryRun":true}` body was not recorded in the repo at deploy time - run it once and paste the 200 body here (`{"mode":"nope"}` -> 400; the default-mode dryRun unchanged) |
| created 2026-09-23 ~18:55 UTC (jobid 3) | cron job `silvis-offers-daily` | - | `select jobname, schedule, active from cron.job` shows the row; first `cron.job_run_details` status |

Order for this deploy: the repo copy of both functions must already carry the Prompt 13 open-shifts mode
(that branch's `send-notification` categories `open_shifts` / `shift_claimed` and `daily-reminder` mode
`open-shifts` are LIVE since 2026-09-22 18:31 UTC, version 3 of each). Deploying a copy without them would
regress the live functions - deploy only from the merged head that has both.

Prerequisite: the CLI workdir `<cli-workdir>` that the commands above assume did NOT exist
on this machine on 2026-09-23 (the 9/22 deploys used a session-scratchpad workdir). Run section 0 step 2
(`New-Item`, `supabase init`, `supabase link`) first - or point every `--workdir` at the directory that is
already linked to `bzhsroegtagqhutbnsrp` - before the download / backup / copy / deploy sequence; `Copy-Item`
into a missing `supabase\functions\<slug>` fails, and `deploy` from an unlinked workdir refuses.

## 4. pg_cron schedules (pg_net; the secret comes from Vault at run time)

Both jobs were created 2026-09-22, AFTER the secret was set and the functions
deployed (order matters: secret -> function -> cron, so nothing ever ran
ungated). Kept here as the record and for re-creation; `cron.schedule` with an
existing job name replaces that job. The secret is NEVER pasted into
`cron.job.command`: each job reads it from Supabase Vault
(`vault.decrypted_secrets`, row `silvis_cron_secret`) when it fires, and a
missing Vault row degrades to the literal `unset`, which the function rejects
with 401 (fail closed). The Vault value was generated inside the database
(`gen_random_bytes(32)`, 64 hex chars) and the same value was then set as the
function-side `CRON_SECRET`; nobody typed it and it appears in no document.
pg_cron on Supabase evaluates schedules in UTC.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Hourly shift reminder (the function itself decides whose reminder hour matches).
select cron.schedule(
  'silvis-daily-reminder-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
                 coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body    := '{}'::jsonb
  );
  $$
);

-- Weekly office digest, Monday 06:00 Central.
-- 06:00 CDT (mid-March to early November) = 11:00 UTC; during CST the same job fires 05:00 Central.
-- That drift is harmless for a digest; if 06:00 sharp matters year-round, re-schedule to '0 12 * * 1'
-- in November and back to '0 11 * * 1' in March (cron.unschedule + cron.schedule).
select cron.schedule(
  'silvis-office-digest-weekly',
  '0 11 * * 1',
  $$
  select net.http_post(
    url     := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/office-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
                 coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body    := '{"mode":"digest"}'::jsonb
  );
  $$
);

-- Weekly open-shifts notice (Prompt 13 part 5c), Monday 12:00 UTC = Monday 07:00 CDT / 06:00 CST.
-- Reads the secret from Vault (vault.create_secret('<value>', 'silvis_cron_secret') once, in the SQL editor);
-- the other two live jobs also read the secret from Vault the same way since 9/22.
-- The function answers 200 { open: 0, sent: 0 } when
-- nothing in [today, today+30] is open, so the job is safe to leave running.
select cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $$
  select net.http_post(
    url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body := '{"mode":"open-shifts"}'::jsonb);
$$);

-- Daily offer-period timeline (Prompt 14 part 4), 13:00 UTC = 08:00 CDT / 07:00 CST, every day.
-- Reads the secret from Vault (vault.create_secret('<value>', 'silvis_cron_secret') once, in the SQL editor).
-- The function answers 200 { periods: N, reminded: 0, closed: 0, sent: 0 } on an ordinary morning (nothing to
-- do for any upcoming period), so the job is safe to leave running; it sends only on a reminder day
-- (offers_close_at - 14 / - 3, groupRules.offerPeriods.remindDaysBeforeClose) and on the close day.
select cron.schedule('silvis-offers-daily', '0 13 * * *', $$
  select net.http_post(
    url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body := '{"mode":"offers"}'::jsonb);
$$);

select jobid, jobname, schedule, active from cron.job;                 -- expect four rows after this whole block; today three exist (the hourly reminder and the weekly digest since 9/22, silvis-offers-daily since 9/23) - silvis-open-shifts-weekly is the one not created yet
select * from cron.job_run_details order by start_time desc limit 10;  -- after the first run
```

Notes
- The offers job is idempotent by the calendar, not by a marker: it acts on a
  reminder day or the close day and does nothing otherwise, so re-running it
  by hand on a reminder day sends the reminder again. The close is a
  compare-and-swap (`status = upcoming` -> `closed`), so a second run on the
  close day finds nothing to close and sends no second summary.
- Opt-out semantics of the offers mode: the reminder honours
  `schedule_updates_email` (a surgeon who turned schedule updates off is
  `skipped_pref_off`); the close roll call to the scheduler / admin accounts
  is unconditional - an operational notice to whoever runs the period, so a
  period never closes with nobody told (only a missing address skips it).
- Nothing secret is stored in `cron.job.command`: the command names the Vault
  row, and `vault.decrypted_secrets` is readable only as the postgres role
  (Faraz in the SQL editor), never through the REST API or the anon key. This
  supersedes the Davenport posture (secret pasted into the command). The two live jobs read the Vault
  row since 9/22, and `silvis-open-shifts-weekly` does too once created.
- Rotate: change the Vault row's value (`vault.update_secret` on the
  `silvis_cron_secret` row) and set the same new value with
  `supabase secrets set CRON_SECRET=<new>`. The jobs read the new value on
  their next tick without an `alter_job`; until both sides agree the cron
  calls get 401 and nothing is sent (fail closed).
- Both jobs run unattended since 2026-09-22. A live send results only from the
  inputs listed in section 6 (a linked account whose reminder hour matches;
  rows in `office_contacts` plus a non-empty digest diff).

## 5. Verification - safe steps (no mail can result)

Placeholders: `$URL = "https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1"`,
`$SECRET` = the CRON_SECRET value (from your password manager, never from a file
in this repo), `$JWT` = a signed-in SCHEDULER session token (in the app,
DevTools -> Application -> Local Storage -> `silvis-auth-token`). Use `curl.exe`
in PowerShell (the `curl` alias is Invoke-WebRequest).

### calendar-sync (unauthenticated GET)
```powershell
curl.exe -s -i "$URL/calendar-sync"              | Select-Object -First 12   # 200, Content-Type text/calendar, BEGIN:VCALENDAR
curl.exe -s   "$URL/calendar-sync?surgeon=FAK"   | Select-Object -First 20   # X-WR-CALNAME:Silvis Call - Khan, DTSTART;VALUE=DATE:..., SUMMARY:Silvis Primary (all-day runs, v5)
curl.exe -s   "$URL/calendar-sync"               | Select-String "SUMMARY:P " | Select-Object -First 3   # SUMMARY:P Burchett . B Acton (a middle dot, U+00B7) - one event per run of the same pair
curl.exe -s   "$URL/calendar-sync?surgeon=FAK&timed=1" | Select-Object -First 20   # the v4 format: DTSTART:...T120000Z / T130000Z, SUMMARY:Silvis Primary Call
curl.exe -s -i "$URL/calendar-sync?surgeon=ZZZ"  | Select-Object -First 3    # 404 JSON error
curl.exe -s -i -X POST "$URL/calendar-sync"      | Select-Object -First 3    # 405
# Item D (2026-09-24): the combined Silvis + Davenport feed - the same feed plus ALL-DAY Davenport events
curl.exe -s "$URL/calendar-sync?surgeon=FAK&east=1" | Select-String "X-WR-CALNAME|VALUE=DATE|SUMMARY:Khan" | Select-Object -First 12
#   -> X-WR-CALNAME:Silvis + Davenport - Khan; DTSTART;VALUE=DATE:YYYYMMDD / DTEND;VALUE=DATE:<next day>;
#      SUMMARY:Khan - Davenport night | service week | weekend | holiday | day call (a one-day day-call override),
#      SUMMARY:Khan - away (Davenport vacation) for an East vacation range reviewed as away; UIDs east-FAK-<date>-<reason>@silvis-call
#      (since v5 one event per run of consecutive days with the same reason - a service week Mon-Sat is one bar, <date> its first day;
#      with &timed=1 one event per busy day as in v3 / v4)
#      (the dash in every SUMMARY line is an en dash, U+2013 - bytes E2 80 93; this README stays ASCII, so do not byte-compare it)
curl.exe -s "$URL/calendar-sync?surgeon=NF&east=1"  | Select-Object -First 8    # exactly like ?surgeon=NF (her East feature derives weeks, no busy-day role: the flag is ignored)
curl.exe -s "$URL/calendar-sync?east=1"             | Select-Object -First 8    # exactly like the group feed (east=1 needs a single surgeon)
curl.exe -s -i "$URL/calendar-sync?surgeon=ZZZ&east=1" | Select-Object -First 3 # 404 as without the flag
```
Since v5 (all-day runs) expect one VEVENT per run of consecutive days inside today-60 .. today+400 (a run that
started up to 14 days before the window is served whole): `DTSTART;VALUE=DATE:<first day>` / `DTEND;VALUE=DATE:<the day
after the last>`, the description starting `07:00 <Wkd> -> 07:00 <Wkd> (Central)` (the arrow is U+2192; a run of 7+ days
adds M/D to each end, `07:00 Mon 1/4 -> 07:00 Mon 1/11`). With `?timed=1`
expect the v4 shape - one VEVENT per filled role per day inside today-60 .. today+400; spot-check a date in CDT:
`DTSTART:...T120000Z` for 07:00 Central; in CST `T130000Z`.
If the first call returns 401 the dashboard toggle re-enabled Verify JWT - turn it off.
`?surgeon=FAK&east=1` answering `502 {"error":"East id for FAK unresolved ..."}` means neither an `east_forecast` row
(`data.code` + `data.fakId`) nor the Davenport roster blob could name the code - the feed is withheld on purpose
(a subscription replaces its event set on refresh, so a 200 without the Davenport events would delete them from
the office calendar); a 502 naming `east_feed` or `east_vacation_reviews` is that read failing; a 502 naming the Davenport
roster read (HTTP status or an 8 s timeout) is the cross-project fallback failing; `500 {"error":"east=1 needs the service
role ..."}` is the injected `SUPABASE_SERVICE_ROLE_KEY` missing (a misconfiguration - the plain feed still answers 200). All
are function-log lines. Note: the combined feed is an unauthenticated URL; it makes the away / not-away decision of each East
vacation range (`east_vacation_reviews`, an authenticated-read table) visible to anyone holding the link - dates and last
name only, no reason, exactly what the office calendar needs; the plain `?surgeon=<CODE>` feed exposes nothing new.

### office-notifications
```powershell
# no gate -> 401 (nothing read, nothing sent)
curl.exe -s -i -X POST "$URL/office-notifications" -H "Content-Type: application/json" -d '{"mode":"rebaseline"}' | Select-Object -First 1
# rebaseline: writes the baseline row, sends NOTHING
curl.exe -s -X POST "$URL/office-notifications" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"rebaseline"}'
#   -> {"mode":"rebaseline","snapshot_updated":true,"days":N,"vacation_person_keys":N,"window":{...},"sent":0}
#   -> snapshot_updated:false with a 5xx if the office_notification_state table is missing (check the function log;
#      the digest path names the missing table explicitly)
# digest dry run: composes, sends nothing, writes nothing
curl.exe -s -X POST "$URL/office-notifications" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"digest","dryRun":true}'
#   -> {"dryRun":true,"would_send":<active contacts>,"sent":0,...} plus a rendered "sample" when there are changes
#   Item D (2026-09-24): every digest answer also carries "east":{"people":[{"name":"Khan","code":"FAK","lines":["Mon Oct 5 - Sat Oct 10: Davenport service week",...]}],"lines":N,"html":"<div ...>","errors":[]}
#   (the "<Name> at Davenport this week" section, next 14 days from east_feed + east_vacation_reviews; "errors" names a failed
#   read - the mail then carries one "could not be read" line); on a quiet week the dryRun adds "sample_east_section" (the
#   rendered mail body with the section + the combined-feed footer link calendar-sync?surgeon=FAK&east=1) so it can be proven
#   without a diff. The send trigger is unchanged: a live digest still goes out only when the schedule / vacation diff is non-empty.
# publish is refused on the cron path (must be a scheduler session)
curl.exe -s -i -X POST "$URL/office-notifications" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"publish"}' | Select-Object -First 1   # 403
# a WRONG secret -> the same 401 as no secret (Prompt 16 B5: constant-time compare - a near miss costs what a miss costs; nothing read, nothing sent)
curl.exe -s -i -X POST "$URL/office-notifications" -H "x-cron-secret: wrong-value" -H "Content-Type: application/json" -d '{"mode":"digest","dryRun":true}' | Select-Object -First 1   # 401
```
Responses carry counts and contact ids only - never an address.

### send-notification
```powershell
# no session -> 401
curl.exe -s -i -X POST "$URL/send-notification" -H "Content-Type: application/json" -d '{"type":"test","targetIds":[]}' | Select-Object -First 1
# scheduler session + EMPTY targetIds -> resolves nobody, sends nothing
curl.exe -s -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"test","targetIds":[]}'
#   -> {"sent":0,"failed":0,"skipped_no_email":0,"skipped_pref_off":0,"results":[]}
# legacy payload -> 400
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"test","recipients":[]}' | Select-Object -First 1
# role/party gate (2026-09-23, audit RLS-1; $VIEWER_JWT = the viewer's session token, $SURGEON_JWT = a surgeon-role session token, e.g. s3's):
# viewer -> 403 before the body is read (nothing resolved, nothing sent)
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $VIEWER_JWT" -H "Content-Type: application/json" -d '{"type":"test","targetIds":[]}' | Select-Object -First 1
# surgeon broadcast (targetIds absent) -> 403; the same for manual_edit / open_shifts
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $SURGEON_JWT" -H "Content-Type: application/json" -d '{"type":"schedule_published","data":{"message":"probe"}}' | Select-Object -First 1
# surgeon test aimed at someone else -> 403 (test goes to the caller only)
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $SURGEON_JWT" -H "Content-Type: application/json" -d '{"type":"test","targetIds":["s1"]}' | Select-Object -First 1
# surgeon trade_proposed without himself among the parties -> 403
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $SURGEON_JWT" -H "Content-Type: application/json" -d '{"type":"trade_proposed","data":{"message":"probe"},"targetIds":["s2","s4"]}' | Select-Object -First 1
# surgeon + EMPTY targetIds -> still 200 sent 0 (the empty-list short circuit sits ahead of the gate for every caller)
curl.exe -s -X POST "$URL/send-notification" -H "Authorization: Bearer $SURGEON_JWT" -H "Content-Type: application/json" -d '{"type":"trade_proposed","data":{"message":"probe"},"targetIds":[]}'
# Prompt 16 B5 (security minors, v6): configuration is checked only AFTER the role gate: with RESEND_API_KEY or
# NOTIFICATION_FROM_EMAIL unset an anon POST still answers 401 and a viewer 403 - never a 500 naming the missing secret.
# trade_* without data.trade_id -> 400 {"error":"trade_proposed needs data.trade_id (the shift_trade_requests row this mail is about) - reload the app to update"}
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"trade_proposed","data":{"message":"probe"},"targetIds":["s1","s2"]}' | Select-Object -First 1
# trade_* with a uuid that names no row -> 403 {"error":"not allowed: data.trade_id names no trade"}; a real row whose two parties
# (from_surgeon_id / to_surgeon_id) are not exactly the targetIds -> 403 {"error":"not allowed: targetIds must be exactly the trade's two parties"};
# a trade_* broadcast (targetIds absent, even from the scheduler) -> 403 {"error":"not allowed: trade mail is never a broadcast - targetIds must name the two parties"}
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"trade_proposed","data":{"message":"probe","trade_id":"00000000-0000-4000-8000-000000000000"},"targetIds":["s1","s2"]}' | Select-Object -First 1
# targetIds over the cap (roster size + 1: with the six-entry roster the cap is 7; count the blob's roster entries, outside surgeons included) -> 400
#   {"error":"targetIds has 9 ids - the cap is 7 (roster size + 1)"} - nothing resolved, nothing sent
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"manual_edit","data":{"message":"probe"},"targetIds":["s1","s2","s3","s4","s5","s6","s7","s8","s9"]}' | Select-Object -First 1
# Prompt 19 S3 (v7): trade_applied may add the scheduler-linked ids to the row's two parties - and nothing else. Take any
# shift_trade_requests row WHOSE PARTIES ARE BOTH NOT SCHEDULER-LINKED (neither is s1 - with the scheduler as a party the
# second and third calls below would be allowed sends) (<trade id> = its id, <from> / <to> = its from_surgeon_id /
# to_surgeon_id, <other> = a surgeon who is neither party nor scheduler-linked) and fill them in by hand. With such a row
# none of these can send mail:
# the two parties + a non-scheduler -> 403 {"error":"not allowed: targetIds may add only scheduler-linked ids to the trade's two parties"}
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"trade_applied","data":{"message":"probe","trade_id":"<trade id>"},"targetIds":["<from>","<to>","<other>"]}' | Select-Object -First 1
# one party + the scheduler -> 403 {"error":"not allowed: targetIds must include both of the trade's parties"}
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"trade_applied","data":{"message":"probe","trade_id":"<trade id>"},"targetIds":["<from>","s1"]}' | Select-Object -First 1
# trade_proposed to the two parties + the scheduler -> 403 {"error":"not allowed: targetIds must be exactly the trade's two parties"} (unchanged: only trade_applied widens)
curl.exe -s -i -X POST "$URL/send-notification" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"type":"trade_proposed","data":{"message":"probe","trade_id":"<trade id>"},"targetIds":["<from>","<to>","s1"]}' | Select-Object -First 1
```
The positive surgeon case cannot be proven without a mail: a surgeon's `{"type":"test","targetIds":["<his own id>"]}`
is one real e-mail to himself - it is listed in section 6 as the live proof of the gate's allow path.

### daily-reminder
```powershell
# no secret -> 401 before any work
curl.exe -s -i -X POST "$URL/daily-reminder" -H "Content-Type: application/json" -d '{}' | Select-Object -First 1
# a WRONG secret -> the same 401 (Prompt 16 B5: constant-time compare, SHA-256 both sides - a near miss costs what a miss costs; nothing read, nothing sent)
curl.exe -s -i -X POST "$URL/daily-reminder" -H "x-cron-secret: wrong-value" -H "Content-Type: application/json" -d '{"dryRun":true}' | Select-Object -First 1
# dry run: reads tomorrow's row, composes, sends NOTHING
curl.exe -s -X POST "$URL/daily-reminder" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"dryRun":true}'
#   -> {"date_tomorrow":"...","current_hour":H,"dry_run":true,"on_call":2,"sent":0,...,"results":[{"person_id":"s?","role":"primary","status":"skipped_wrong_hour"|"dry_run_composed"...}]}
# mode open-shifts dry run (Prompt 13 part 5c): reads schedule_days for today..today+30, composes the Monday notice, sends NOTHING, writes NO feed row
curl.exe -s -X POST "$URL/daily-reminder" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"open-shifts","dryRun":true}'
#   -> {"mode":"open-shifts","dry_run":true,"open":N,"through":"YYYY-MM-DD","published_through":"YYYY-MM-DD"|null,"window_end":"YYYY-MM-DD","sent":0,"failed":0,"skipped_pref_off":0,"skipped_no_email":0,"feed_row":"skipped_dry_run","results":[{"person_id":"s?","status":"dry_run_composed"}...]}
#   -> {"mode":"open-shifts","dry_run":true,"open":0,"through":...,"published_through":...,"window_end":"YYYY-MM-DD","sent":0} when nothing in the window is open
#   open = the board's list over the rows in the window: the block of rows that starts today (published_through = its end; null when
#   today has no row), then the open slots of assigned runs after it (e.g. a holiday unit). A day WITHOUT a schedule_days row is never
#   announced - it is not published and claim_open_slot refuses it. through = the later of published_through and the last listed slot.
# mode offers dry run (Prompt 14 part 4): reads the upcoming call_periods + their call_offers + the blob, runs the
# timeline maths for today (Central), composes, sends NOTHING, writes NOTHING (no status flip, no audit row)
curl.exe -s -X POST "$URL/daily-reminder" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"offers","dryRun":true}'
#   -> {"mode":"offers","dry_run":true,"today":"YYYY-MM-DD","periods":N,"reminded":0|1,"closed":0,"sent":0,"failed":0,"skipped_pref_off":0,"skipped_no_email":0,
#       "results":[{"period":"Nov 2026 - Jan 2027","id":"<uuid>","action":"none"|"remind"|"close","reason":"no-trigger"|"remind:14"|"remind:3"|"close:today"|"close:overdue",
#                   "days_to_close":N,"offers_close_at":"YYYY-MM-DD", ...on a remind/close day also "rollcall":[{"id":"s?","status":"submitted"|"rules_only"|"not_started","offered":N}],
#                   "recipients":[{"person_id":"s?","status":"dry_run_composed"|"skipped_pref_off"|"skipped_no_email"}], and on the close day "period_status":"unchanged_dry_run","audit":"skipped_dry_run"}]}
#   an ordinary morning: every period "action":"none" and "sent":0; "periods":0 when no row is upcoming.
# an unknown mode -> 400, nothing read or sent
curl.exe -s -i -X POST "$URL/daily-reminder" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"nope"}' | Select-Object -First 1
```
A LIVE call (`-d '{}'`) sends nothing only when no on-call person's reminder hour
equals the current Central hour. The default hour is 17 (5 pm the evening
before) for anyone without `reminder_hour_central`, so a live invoke at 17:xx
Central IS a real send. Use `dryRun` for verification. A LIVE
`{"mode":"open-shifts"}` call IS a real send to every opted-in linked surgeon
whenever `open` is non-zero, and it inserts the `notifications` row the board's
"last announced" column reads - the Monday cron in section 4 is the intended caller.
Proof after deploying: one dryRun POST through pg_net from the SQL editor (or the
curl above) and quote the 200 body.
A LIVE
`{"mode":"offers"}` call IS a real send on a reminder day (to every not_started
pool member with `schedule_updates_email` on) and on the close day (it flips the
period to `closed`, writes the `period.close` audit row and mails the scheduler /
admin accounts); on any other day it reads and answers `sent: 0`. Proof after
deploying: one dryRun POST through pg_net from the SQL editor (or the curl above)
and quote the 200 body in the deploy record (section 3).

## 6. Invocations that CAN send real mail - wait for Faraz

- `office-notifications` `{mode:"publish"}` - every active office contact.
- `office-notifications` `{mode:"digest"}` WITHOUT `dryRun` when the diff is
  non-empty - every active office contact.
- `office-notifications` `{mode:"test"}` - one email to the calling scheduler's own account.
- `send-notification` with a non-empty `targetIds` or with `targetIds` omitted
  (broadcast to every linked account that has not opted out) - from an admin / scheduler
  session; since the 2026-09-23 gate a surgeon session sends only his own targeted categories,
  and the live proof of that allow path is the surgeon's own `test` (`targetIds` = his own id:
  one mail, to himself, 200 `sent 1`).
- `daily-reminder` live (`{}`) at an hour matching an on-call person's reminder hour.
- `daily-reminder` live `{"mode":"open-shifts"}` while any published slot in the next 30 days
  is open - every linked surgeon with `schedule_updates_email` on (the Monday cron job).
- `send-notification` type `open_shifts` (Prompt 13 part 5) - a broadcast to every linked,
  opted-in surgeon; the app sends it on Accept & Publish when the published range leaves
  slots open (after the office notice) and on demand from the Open shifts board ("Email the
  group now", after a preview). Type `shift_claimed` - to the scheduler(s) + the claimer
  when someone takes an open shift (targetIds, never a broadcast).
- `daily-reminder` live `{"mode":"offers"}` on a reminder day (offers_close_at - 14 / - 3) or on / after
  the close day of an upcoming period - the not_started pool members, or the scheduler / admin accounts
  (the daily cron job is the intended caller; on every other day it sends nothing).
- `send-notification` types `offers_reminder` / `offers_closed` (Prompt 14 part 4) - targeted sends from
  the Periods section (the "Remind" button with a session); never a broadcast by design.
- Creating the third and fourth pg_cron jobs, `silvis-open-shifts-weekly` and `silvis-offers-daily` (section 4) - from then on the Monday open-shifts notice and the daily offers timeline run unattended.

Planned first live proofs (Prompt 10 acceptance, run by Faraz): one real office
email (`publish` with a real period label while `office_contacts` holds only
Faraz's own test contact, then add the office contact) and one real reminder (set
`reminder_hour_central` for `s1` to the next hour, wait for the cron tick or
invoke live once with the secret).

## 7. Rollback

Redeploying an older `index.ts` from git history with the same commands is the
rollback. Keep the convention: before overwriting a deployed function, download
it to `edge-functions/deployed-backup-<date>/<slug>/index.ts` (untracked or in a
PR), byte-diff after deploying.
