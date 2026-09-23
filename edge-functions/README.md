# Silvis edge functions - deploy and verification runbook

Four Deno edge functions for the Silvis Supabase project `bzhsroegtagqhutbnsrp`,
retargeted from the Davenport (DSG) functions on 2026-09-22
(see `docs/EDGE-FUNCTIONS-REVIEW.md` for the review and what changed).

| slug | source | caller | can it send mail? |
|---|---|---|---|
| `calendar-sync` | `edge-functions/calendar-sync/index.ts` | calendar apps + the Settings "subscribe" URLs (unauthenticated GET) | never |
| `office-notifications` | `edge-functions/office-notifications/index.ts` | app (publish / digest buttons, scheduler JWT) + weekly pg_cron (`x-cron-secret`) | yes - `publish`, live `digest`, `test` |
| `send-notification` | `edge-functions/send-notification/index.ts` | app `sendEmailNotif` (verified user JWT) | yes - any non-empty send |
| `daily-reminder` | `edge-functions/daily-reminder/index.ts` | hourly pg_cron (`x-cron-secret`, default mode) + Monday pg_cron with body `{"mode":"open-shifts"}` (same gate) | yes - at a matching reminder hour; mode `open-shifts`: every linked surgeon with `schedule_updates_email` on, while any published slot in the next 30 days is open |

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
`skipped_wrong_hour`). The Monday cron job (section 4) is not created yet.

function.

**Deploy record.** All four functions were deployed 2026-09-22 from the CLI with
`--no-verify-jwt` (verify_jwt OFF on each: `calendar-sync` answered a live
unauthenticated GET, the other three answered 401 without their gate - see
`docs/STATUS-2026-09-22.md`). The function-side secrets `CRON_SECRET`,
`RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` were set in the dashboard the
same day (2026-09-22 12:56 UTC, by Faraz; names only are recorded anywhere).
The two pg_cron jobs in section 4 exist and read the secret from Supabase
Vault (`silvis_cron_secret`) at run time; both functions answered pg_net
`dryRun` posts with 200 (`docs/REVIEW-2026-09-22.md` section 6). Deployed
version numbers are not recorded in this repo: read them from
`supabase functions list` before any redeploy, and keep the download-and-
byte-compare convention in section 3 so the repo stays the source of truth.

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
| office-notifications | OFF | `x-cron-secret` == `CRON_SECRET` (digest / rebaseline) OR a GoTrue-verified session whose `user_profiles.role` is admin/scheduler |
| send-notification | OFF | GoTrue-verified user session (`/auth/v1/user`) |
| daily-reminder | OFF | `x-cron-secret` == `CRON_SECRET`, fail closed |

Gotcha carried over from Davenport: a DASHBOARD deploy re-enables "Verify JWT"
for that function. Always deploy from the CLI, and after any deploy re-run the
calendar-sync check in section 5.

After deploying, follow the Davenport convention: `supabase functions download
<slug> --workdir $wd --project-ref bzhsroegtagqhutbnsrp` and byte-compare with
the repo copy (`fc.exe` / `cmp`) so the repo stays the source of truth.

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
-- the other two live jobs also read the secret from Vault the same way since 9/22 - the '<CRON_SECRET>'
-- placeholders above show the original shape only. The function answers 200 { open: 0, sent: 0 } when
-- nothing in [today, today+30] is open, so the job is safe to leave running.
select cron.schedule('silvis-open-shifts-weekly', '0 12 * * 1', $$
  select net.http_post(
    url := 'https://bzhsroegtagqhutbnsrp.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'silvis_cron_secret' limit 1), 'unset')),
    body := '{"mode":"open-shifts"}'::jsonb);
$$);

select jobid, jobname, schedule, active from cron.job;                 -- expect three rows
select * from cron.job_run_details order by start_time desc limit 10;  -- after the first run
```

Notes
- With the `<CRON_SECRET>` placeholder form the secret is stored in
  `cron.job.command`, readable by anyone who can run SQL as the postgres role
  (i.e. Faraz in the dashboard) - the original Davenport posture. Since 9/22
  the two live jobs read the secret from Vault instead (`vault.create_secret`
  once, `vault.decrypted_secrets` in the job command, as the open-shifts job
  above shows), and the open-shifts job does too once created;
  `cron.job.command` then holds only the lookup.
- Rotate: `supabase secrets set CRON_SECRET=<new>` then `cron.alter_job(jobid, command => ...)`
  (or unschedule/schedule) with the new header. Until both agree, the cron

- Nothing secret is stored in `cron.job.command`: the command names the Vault
  row, and `vault.decrypted_secrets` is readable only as the postgres role
  (Faraz in the SQL editor), never through the REST API or the anon key. This
  supersedes the Davenport posture (secret pasted into the command).
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
curl.exe -s   "$URL/calendar-sync?surgeon=FAK"   | Select-Object -First 20   # X-WR-CALNAME:Silvis Call - Khan, SUMMARY:Silvis Primary Call
curl.exe -s -i "$URL/calendar-sync?surgeon=ZZZ"  | Select-Object -First 3    # 404 JSON error
curl.exe -s -i -X POST "$URL/calendar-sync"      | Select-Object -First 3    # 405
```
Expect one VEVENT per filled role per day inside today-60 .. today+400. Spot-check
a date in CDT: `DTSTART:...T120000Z` for 07:00 Central; in CST `T130000Z`.
If the first call returns 401 the dashboard toggle re-enabled Verify JWT - turn it off.

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
# publish is refused on the cron path (must be a scheduler session)
curl.exe -s -i -X POST "$URL/office-notifications" -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"mode":"publish"}' | Select-Object -First 1   # 403
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
```

### daily-reminder
```powershell
# no secret -> 401 before any work
curl.exe -s -i -X POST "$URL/daily-reminder" -H "Content-Type: application/json" -d '{}' | Select-Object -First 1
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

## 6. Invocations that CAN send real mail - wait for Faraz

- `office-notifications` `{mode:"publish"}` - every active office contact.
- `office-notifications` `{mode:"digest"}` WITHOUT `dryRun` when the diff is
  non-empty - every active office contact.
- `office-notifications` `{mode:"test"}` - one email to the calling scheduler's own account.
- `send-notification` with a non-empty `targetIds` or with `targetIds` omitted
  (broadcast to every linked account that has not opted out).
- `daily-reminder` live (`{}`) at an hour matching an on-call person's reminder hour.
- `daily-reminder` live `{"mode":"open-shifts"}` while any published slot in the next 30 days
  is open - every linked surgeon with `schedule_updates_email` on (the Monday cron job).
- `send-notification` type `open_shifts` (Prompt 13 part 5) - a broadcast to every linked,
  opted-in surgeon; the app sends it on Accept & Publish when the published range leaves
  slots open (after the office notice) and on demand from the Open shifts board ("Email the
  group now", after a preview). Type `shift_claimed` - to the scheduler(s) + the claimer
  when someone takes an open shift (targetIds, never a broadcast).
- Creating any of the three pg_cron jobs (section 4) - from then on the functions run unattended.

- Both pg_cron jobs (section 4) exist since 2026-09-22 and run unattended; what
  they can send is bounded by the data above (a linked account email with a
  matching reminder hour; `office_contacts` rows with a non-empty digest diff).

Planned first live proofs (Prompt 10 acceptance, run by Faraz): one real office
email (`publish` with a real period label while `office_contacts` holds only
Faraz's own test contact, then add the ER-panel author) and one real reminder (set
`reminder_hour_central` for `s1` to the next hour, wait for the cron tick or
invoke live once with the secret).

## 7. Rollback

Redeploying an older `index.ts` from git history with the same commands is the
rollback. Keep the convention: before overwriting a deployed function, download
it to `edge-functions/deployed-backup-<date>/<slug>/index.ts` (untracked or in a
PR), byte-diff after deploying.
