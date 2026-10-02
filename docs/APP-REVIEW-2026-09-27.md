# App review: efficiency and everyday use (2026-09-27)

*Whole-app review run 2026-09-27 in a cloud session. Seven read-only reviewers, one lens each: runtime
performance, network and data, code health, everyday use per role, reliability and silent failures, mobile and
accessibility, developer workflow. Every high or medium finding then went to a separate skeptic told to refute it
against the code; 53 findings held, several with a corrected severity or corrected detail. Section 5 lists what was
checked and should not be raised again. The scheduler asked for this file to live in the repo (not the private
`docs/history/` folder) because the sessions that fix these items need it; it is indexed in `docs/HISTORY.md`.*

*How to read it:*
- *Line numbers refer to `1560f6a` (main `2f424f2` plus the dark-mode Backup-word fix) and drift after the 9/27 ship
  (`ui/integration-2026-09-27`). Find the code by the function, testid or string quoted next to each number.*
- *"Scheduler-only" marks work the scheduler applies by hand (schema and RLS migrations, edge-function deploys, cron,
  Vault, Auth, SMTP); everything else is repo code a session can change on a branch.*
- *Status (10/1): Do first 1-3 are on main and Do first 4 and 5 are on `perf/startup-and-poll` - each item's own Status line says what was done; no other item is fixed yet. Overlaps with the 9/27 ship: the Settings "(Prompt 10)" footer text is gone
  (settings declutter), the coordinator's empty calendar-sync card is now hidden rather than given the full feed, and
  My schedule rows now also carry a "Give away" button (day-click summary) - re-measure "Mine rows" (Do first 9) at
  390 px on the shipped layout. The overlap column in section 6 names requests that shipped on 9/27.*

## 1. Summary

- **Overall state.** The app does what the group needs, and the data-loss safeguards (CAS, the wipe guard, snapshots, RLS, the empty-save guard) hold up. The weak spot is honest display: several failure paths still end in a green "Synced" header or an all-OPEN calendar.
- **Biggest user-facing gains:**
  - an honest "schedule didn't load" state;
  - day writes that show when they failed and retry on their own;
  - "on call now" that follows the 07:00 handoff.
- **Efficiency:**
  - Startup makes about 11 reads one after another, and a signed-in open does it twice.
  - Every open tab pulls 14 full tables a minute, even when hidden.
  - Loading in parallel and pausing hidden tabs fixes most of this cheaply. The other performance findings are real but small (milliseconds, kilobytes).
- **Coupling to know before touching the poll.** The poll replaces every array each minute. That is today's accidental retry for failed writes, and it is also the only thing that rolls the date over at midnight. The write-retry fix has to land before any poll de-duplication.
- **Dev loop:**
  - About 30% of recent deploys only bumped the version, and each one force-reloaded all 7 clients.
  - PRs and SQL/docs pushes run no tests.
  - The 12-minute single-run smoke dominates every UI change.

## 2. Do first (ranked by value for effort)

### 1. A failed first schedule read shows every slot OPEN under "Synced" (high)
- **Status:** Done - on main since 12943e5 (branch fix/days-load-failed-display) - `daysReadOk` (only ever true: adoptLoadedDays, the re-run merge, refreshDays) drives the placeholders (grid `unread-slot`, today banner `unread-holder` + Share disabled, coverage counts, week rows, the board, Mine / Following, the Totals line, both headers "Schedule not loaded"); `daysLoadFailed` raises the role=alert banner with Retry (a full refreshAll); the notifications panel reads three states; no day opens while unread by any route (the cell tap, `goToDay`, `saveDayEdit`, the DayEditor mount); the exports, the Open shifts tail, Setup > Periods / Holidays and the Totals CSV are gated too; a days read that lands clears a stale "Not saving - data failed to load" (review of the branch, 9/28). `loadFailedRef` and every `loaded` gate untouched; the pins named below kept; smoke "days-fail" added (build guide §8). Same branch: the coverage strip says "published through M/D" (lastPublishedDay) and "last published <time>" only when `lastPublished.at` exists.
- **Why:**
  - When the schedule_days read fails at open, `setLoaded(true)` still runs with an empty `schedule` (index-source.html:1774-1783, 267).
  - The header then reads "Synced" (5535). The grid, the today banner and Share today all show OPEN (4582-4585, 5737-5740, 5819-5822, 4523-4529).
  - Line 5835 claims "No schedule days in the database yet", and Mine says there is no upcoming call (6180).
  - The one error toast is replaced within milliseconds by the vacations and availability toasts (1139-1143, 1163, 1176).
  - No data is lost, because autosave is gated. But the app gives a wrong answer to "who is on tonight", and Share today can send it to other people.
- **Change:**
  - Add a `daysReadOk` state that only ever turns true: in adoptLoadedDays, in the re-run merge (~1750), and on refreshDays success (~1811). Use it for placeholders at about 10 render sites:
    - the cells and the today banner;
    - Share (disabled until the schedule loads);
    - the board (6018, 6037), week rows (5931) and the Totals line (8378);
    - the public header (5525-5530).
  - Add a separate `daysLoadFailed` for a persistent role=alert banner with a Retry button that runs a full refreshAll.
  - Header text should be "Schedule not loaded", not "Not synced": the smoke waits on the substring `text=Synced` (smoke.mjs:1274, 8035).
  - Use a new testid for the placeholder, not `loading-slot` (smoke.mjs:8152).
  - Give the notifications read three states (not read / failed / ok) so the panel can't say "No notifications yet" after a failed read (5593-5594).
  - Leave `loadFailedRef` and every `loaded` gate untouched.
  - Keep the pins at data-layer.test.js:5461 and :2344.
  - Add a smoke case where schedule_days answers 500 on the first request.
- **Effort** S-M · **Risk** low (display only) · **Scheduler-only** no

### 2. A day write that fails with a network error leaves "Synced", and nothing retries (high)
- **Status:** Done - on main since c25a0ff + de9db89 (branch fix/day-write-network-failure, 9/30) - in `syncScheduleDaysNow` each day's post / fetchDayRow / patch runs in a try that maps a rejection to status 0 (the existing failed branch: red status + retry; the 401/403 branch first, the single `scheduleDaySyncRetry();` site and the wipe gate before the first write kept); the retry backs off 5 -> 15 -> 60 s (`helpers.js syncRetryDelay`) and only the first failure of a streak toasts (the A3 harness's first toast kept); a window `online` listener calls `resyncPendingRef.current("online")` (cleaned up); `blobDirtyRef` keeps a failed Setup write owed until a blob write lands, re-fired by its own backoff timer, `online`, the poll and the sign-in re-run, and the keepalive flush builds the current state when a leg still owes a write; day and blob failures are separate React state (`daySyncFail` / `blobSyncFail`, shown by `helpers.js syncFailLine`), so a later day "Saved" cannot clear a failing blob's red line and "Synced" waits for both; nothing reads `daySyncBusyRef` for display. Same branch (Faraz 9/29): while the schedule is unread the header keeps "Schedule not loaded" (no switch to "Not saving - data failed to load" after 3 s; autosave refused as before). Build guide §4.7; data-layer section DF2; smoke "Do first 2 (network failure)" (route.abort on a day PATCH) and the stricter days-fail header check. Review fixes (9/30): an account switch drops the write-retry state (no failed change of the previous account is re-sent under the new JWT; the shared setup counts as unread until re-read), sign-out stops the timers; a streak is per failure kind; a 403 Setup write is not re-sent by the poll; a blocked wipe ends the streak; the blob guard exits and a "Schedule: " label on the day leg's line; the smoke's days-fail check forces the post-window autosave pass it judges. The poll de-dup (section 3) is not part of it.
- **Why:**
  - When syncScheduleDays throws (offline, DNS, timeout), its `.catch` only shows a toast (1547-1551). It sets no status, schedules no retry, and skips the `lastSyncRef` update (1618). The header then says "Synced".
  - On a 5xx, a fixed 5 s timer retries and toasts every 5 s for as long as the outage lasts (1630-1634, 1675-1682).
  - The blob leg says "Save failed - retrying" (2128), but nothing re-fires it: setSaveTick is only called at 1731 and 2149. Leg 1 then overwrites or clears `pendingSaveRef` (2035, 2055), which silently drops the failed Setup change.
  - Days only recover by accident, because the poll's new arrays re-fire leg 1 (deps at 2058). If the tab is closed while still offline, the edit is lost after the app said "Synced".
- **Change:**
  - In syncScheduleDaysNow, wrap each day's post, patch and fetchDayRow in try/catch and map a rejection to status 0, so the existing failed branch sets the red status and retries.
    - Keep the 401/403 branch first.
    - Keep the single `scheduleDaySyncRetry();` call site (data-layer.test.js:3991).
    - Keep the wipe gate before the first write (:603-617).
  - Back off 5 → 15 → 60 s, and toast only on the first failure of a streak. The A3 harness still expects that first toast (:3905-3939).
  - Add a window `online` listener that calls `resyncPendingRef.current("online")` (2146-2150).
  - Add a `blobDirtyRef` so a failed Setup payload survives until a blob write succeeds.
  - Keep day and blob status separate, so a later day "Saved" can't clear a failing blob's red status (1636-1638).
  - Drive any "unsynced" indicator from React state, not from `daySyncBusyRef`, which can stay above 0 by design.
- **Effort** M · **Risk** medium (sync path: branch, PR and smoke) · **Scheduler-only** no · must ship before the poll de-dup item in section 3.

### 3. "On call today" ignores the 07:00 handoff (medium)
- **Status:** Done - on main since a9210c3 (branch feat/on-call-now) - `helpers.shiftDayCentral` / `onCallNow`; the banner, Share today and `?public=1` name the pair on call now (build guide §9). The optional "You: next call" line is not in it (a separate item).
- **Why:**
  - `todayStr = todayCentral()` (4521; helpers.js:108-115) drives the banner and the share text (4523-4529, 5816-5822).
  - Shifts run 07:00 to 07:00 (CLAUDE.md:34; calendar-sync/index.ts:219). So from 00:00 to 06:59 the banner and Share name the next pair, and ?public=1 shows the same.
  - That is exactly the window when someone asks "who is on right now".
- **Change:**
  - Add a pure `shiftDayCentral(now)` to helpers.js, using Intl with `hourCycle:'h23'`. Unit-test 00:30, 06:59, 07:00 and both DST days.
  - Banner: "On call now (until 07:00 Mon): P... B...", then "From 07:00: ...". The share text should say "now".
  - Keep `todayStr` for the OPEN logic and the today ring.
  - Show an unassigned slot of the previous shift as OPEN through HolderTag, not through slotIsOpen (which returns false for past dates).
  - Keep the loading guard and the testid (smoke.mjs:8159-8160).
  - Optional, same branch: a "You: next Primary Tue 10/6" line for linked surgeons. Hoist `countdown` and `roleWord` from 6153-6154 first, and hide the line in public mode.
- **Effort** S · **Risk** low · **Scheduler-only** no

### 4. Startup: 11 reads one after another before `loaded` (medium)
- **Status:** Done on perf/startup-and-poll (10/1), not merged - Leg A, Leg B and the secondary reads run in ONE `Promise.allSettled`; `setLoaded` / `loadedAtRef` / `switchedUserRef` after everything settles; only the schedule_days catch arms `loadFailedRef`; the failed reads in ONE toast (`helpers.js combinedLoadToast`; the four loud loaders take `quiet` as the collector during the load); `runGenerate` refuses an unread schedule (`GEN_DAYS_UNREAD_MSG`). Build guide §4.8; data-layer section DF4; smoke "Do first 4" + Item E4 needs its two East sentences in one toast. Review fixes (10/1, same branch): leg 1 of the autosave is shut while `switchedUserRef` is up and its timer re-checks `loadFailedRef` / `switchedUserRef` (the parallel reads could re-fire it with the previous account's map), the switched branch resets the map to `lastSyncRef`; two or more failed reads are one compact sentence (Setup clause for the scheduler only, "Retry" only with the banner); the empty-read tripwire joins the toast; the "changed elsewhere" notice reads what was owed at the run's start. Review fixes 2 (10/1): the Setup clause and the "changed elsewhere" notice read the role through `isSchedulerRef` (set with the state by the profile effect - the load's closure held a stale role, so the scheduler never saw the clause); a day write of the previous account in flight at a switch is followed into the map once its queue drains; the end of a switched run calls the re-sync bridge so a `setSchedule`-only change made under the flag is sent.
- **Why:**
  - The mount effect awaits these reads in turn before `setLoaded(true)` (1709-1783): blob, schedule_days, trades, notifications, offers, periods, client_versions, time_off, availability, East, reviews.
  - OPEN cells, coverage counts, week rows, Mine and the board all wait on `loaded` (5737, 5759-5762, 5931, 6180).
  - A signed-in open runs the whole chain twice (828).
  - refreshAll already runs the same readers in parallel (1835-1845), which shows they are independent. The chain costs about 1.5-3 s on cellular.
- **Change:**
  - Turn Leg A and Leg B into inner async functions, and run them plus all the secondary reads in one `Promise.allSettled`.
  - Keep `setLoaded`, `loadedAtRef` and `switchedUserRef` after everything settles. Only the schedule_days catch should arm `loadFailedRef`.
  - Collect the failures into one combined toast, with days and blob first and the East parts shown to the scheduler only. Otherwise parallel toasts replace each other, and the E4 smoke that needs both East toasts gets flaky (smoke.mjs:~2991-3003).
  - Add an explicit "schedule not read" refusal to runGenerate (2952-2964). Today Generate is blocked after a failed days read only because offers and periods sit inside Leg B's try.
  - Pins to keep or update: data-layer.test.js:849-856, 2703, 3960-3964, 3979-3980.
- **Effort** S-M · **Risk** low-medium (the sign-in re-run will now usually take the merge path, so run the smoke) · **Scheduler-only** no

### 5. Pause the 60 s poll in hidden tabs (medium)
- **Status:** Done on perf/startup-and-poll (10/1), not merged - the interval runs `pollTick` (`helpers.js pollTickMode`): nothing at the sign-in card or in a hidden ?public=1 tab; in a hidden signed-in tab the ensureFresh / re-send head + refreshNotifs (+ the owed Setup write's re-send, Do first 2); refreshAll otherwise; a `visibilitychange` listener in the load effect (removed with `pollInterval`) runs refreshAll when the tab is shown and the last full refresh is over 60 s old; east_feed / east_forecast every 10 min (`refreshEastTables`, `loadEastTables(true, overridesOnly)`), east_overrides and the reviews every run. The A3 visibility handler, the refreshAll head and the B4 order are kept (the B4 interval pin moved deliberately). Build guide §4.8; data-layer section DF5; smoke "Do first 5". Review fixes (10/1, same branch): the interval's full tick skips within 30 s of a full refresh (`pollFullRecent`, the iOS resume double run); a clock set backwards counts as due; the poll's quiet East read is pinned and run. Decision recorded: the hidden tick keeps the owed-Setup-write re-send (same gates as refreshAll's line; the Do-first-2 backoff timer fires in hidden tabs anyway).
- **Why:**
  - `setInterval(refreshAll, 60000)` (1913) runs whether or not the tab is visible and whether or not anyone is signed in. None of the visibility handlers (670, 1012, 2264) gates it.
  - Each run is 14 GETs, including all of schedule_days and the East jsonb (1835-1847, 1226-1230). That is about 840 requests an hour per desktop tab (the office and scheduler desks).
  - It also runs at the sign-in card, logging 5 "read skipped" warnings a minute (7569-7578).
- **Change:**
  - Add a separate visibilitychange listener inside the load effect, cleaned up together with `pollInterval`.
  - While hidden, run only the pinned ensureFresh/resync head (data-layer.test.js:3955) plus refreshNotifs. Background browser pop-ups depend on it: sendBrowserNotif only fires when the page lacks focus (3863-3868).
  - On becoming visible, run refreshAll if the last run was more than 60 s ago.
  - Skip the poll entirely when there is no signed-in user and the page is not in public mode.
  - Read east_feed and east_forecast every 10 min and right after refreshEastFeed. Keep east_overrides and the reviews at 60 s.
  - Keep the pinned line at data-layer.test.js:5160.
- **Effort** S · **Risk** low-medium · **Scheduler-only** no

### 6. Browser pop-ups stop for good at 50 rows, and until then reach the wrong people (medium)
- **Why:**
  - New alerts are detected by count (3981-3990). The list is capped at 50 (1762, 1823, 3333) and nothing prunes it, so once there are 50 rows the check never fires again.
  - No error is shown, and the Test button uses forceShow, so it still looks fine.
  - The effect reads the raw `notifications`, not `myNotifications` (755; helpers.js:2967-2985). The office viewer therefore gets trade and vacation pop-ups that its feed hides.
- **Change:**
  - Keep a Set of seen ids, seeded on the first authenticated read (not the anonymous null pass).
  - Pop only unseen ids from `myNotifications`, and add it to the effect's deps.
  - Don't use a created_at watermark: created_at is stamped by the device (3331).
  - Keep the pinned line at test/open-shifts.test.js:686.
- **Effort** S · **Risk** low · **Scheduler-only** no

### 7. A brief Supabase Auth error at open signs people out, and the reset form can hang (medium)
- **Why:**
  - `_refresh` treats any non-2xx, including 5xx and 429, as a rejection (config.js:907-911).
  - getUser then clears the stored session (866-887).
  - ensureFresh sets `_deadRefresh` and shows the "session expired" banner (822-827).
  - `_probeLinkPair` marks good invite links as dead (1068-1073).
  - The mount path ignores `error:'network'` (index-source.html:881-885), so the user gets a bare sign-in card with no message and no retry.
  - resetPassword and signIn have no try/catch (config.js:846-852, 954-970), and submitReset has no `.catch` (5264-5268). The shared `authBusy` stays true, which also leaves the Sign in button stuck (5494, 5500).
  - Accounts are invite-only and Face ID users rarely type a password, so this turns into reset emails to the scheduler.
- **Change:**
  - Treat only 400/401/403 as a rejection. Treat 5xx, 429 and 408 as network errors: keep the stored pair, no `_deadRefresh`, no banner. Apply the same rule in `_probeLinkPair`.
  - At mount, show the biometric path's "Couldn't reach the server" message with a Retry button (902-906).
  - Add try/catch and `res.json().catch` to resetPassword and signIn, as in updatePassword (977-993). Call `setAuthBusy(false)` on "Back to sign in".
  - Add 503, 429 and HTML-502 test cases, and keep the 400 pins (data-layer.test.js:3660, 3882-3900).
- **Effort** S · **Risk** low · **Scheduler-only** no (client code only, no Auth settings)

### 8. Error toasts vanish in 4.5 s and replace each other (medium)
- **Why:**
  - The toast has one slot and a fixed 4.5 s timeout for every tone (1139-1143). Some messages run to about 370 characters (1470, 3140, 2988).
  - The override-reasons toast is documented as the only record when both audit rows fail (2472-2482), and the sync-failure toast overwrites it about 1 s later (1633).
- **Change:**
  - S part:
    - Error toasts stay until tapped (they are already tap-to-dismiss, 5303-5305) or for max(8 s, 60 ms per character).
    - The newest toast always shows immediately, and repeats are deduped.
    - The last ~10 errors stay reachable from the header status.
    - The smoke reads the current toast (smoke.mjs:3850, 6778, 7021, 8247), so older errors must go into a stack, not a first-in-first-out queue.
    - On the paint sheets the toast sits at the top (5304), so it needs a close control.
  - M part: route the both-rows-failed override case to a persistent dialog with a Copy button.
- **Effort** S (M with the history and dialog) · **Risk** low · **Scheduler-only** no

### 9. Mine rows waste a line per locked day on phones (medium)
- **Why:**
  - At 390 px the row's spans (92 + 58 + min 120 px, plus gaps and the 9 px padlock) need about 309 px out of about 308 (6193-6203).
  - So the padlock wraps onto its own line on every locked row, and on a surgeon's own view each row takes three lines.
  - The list is also a nested 420 px scroller (6193). test/ui/out/myschedule-offers-390-dark.png shows 6 of 37 rows. This is the surgeons' main phone view.
- **Change:**
  - Put the padlock inside the date span.
  - Give the holder span `flex:'1 1 0'`, `minWidth:0` and an ellipsis.
  - On a surgeon's own view, shorten the trade button to "Trade" (still at least 36 px tall).
  - At 600 px or less, drop `maxHeight` and `overflowY`. Don't cap the list at 15 rows: that breaks smoke.mjs:8765-8782 and 5422-5423.
  - Keep the pins at data-layer.test.js:4967 and 5734 byte-identical.
- **Effort** S · **Risk** low · **Scheduler-only** no · overlaps the shift-adjust request (the `mine-trade` button).

### 10. CI runs its tests on the wrong pushes (medium)
- **Why:**
  - Test files sit in build.yml's deploy paths filter (15-80, required by ci.test.js:84-85). So a push that changes only tests bumps APP_VERSION (250) and pushes every client through the update banner and nukeAndReload (index-source.html:646-667, 119-145).
  - 3 of the last 10 Build commits (6886edc, fc3cfeb, 2f424f2) changed nothing at runtime.
  - Meanwhile pushes that change only sql, docs or scripts, and all PRs, run no tests (build.yml:63-68; ci-owned-files-gate.yml:6-8). A broken schema pin then shows up on the next unrelated UI push.
- **Change:**
  - Add test.yml:
    - triggers on push and pull_request, with no paths filter;
    - `contents: read` and SHA-pinned actions;
    - runs `npm test` with EXPORTS_OFFLINE=1.
  - Narrow build.yml's filter to runtime inputs:
    - index-source.html;
    - the ?v= loader modules, including importer.js;
    - vendor/** and the manifest and icons;
    - build.js, bump-version.js and package*.json.
  - Drop docs/silvis-seed.json and the two edge-function files from that filter.
  - Pin "the loader list is a subset of the build.yml filter".
  - Update the pins at ci.test.js §1b/§2, data-layer.test.js:4980, offers-timeline.test.js:258 and open-shifts.test.js:336-337.
- **Effort** M · **Risk** low-medium (a runtime file missed from the filter wouldn't deploy; the subset pin covers that) · **Scheduler-only** no (it changes the deploy gate, so use a PR)

## 3. Worth doing (next tier)

**Reliability and sync**
- **Generate/Accept on unloaded inputs (medium, S-M, report first per CLAUDE.md):**
  - Stamp previewGen with the load state of days, time_off and availability, and refuse a preview built on a table that was never read.
  - Put the check in acceptPreview/acceptMerged, not in syncScheduleDaysNow, so restore and import keep working (2952-2964, 3007-3051).
  - Keep the pin at data-layer.test.js:3466.
- **Tell an RLS refusal from a conflict (medium, M):**
  - If `fresh.vers[day] === sentAgainst`, take the auth-fail branch, with no `setSchedule(merged)` re-arm (1514-1522, 1640-1666). Today a signed-out tab loops about once a second with a "someone else changed it" toast.
  - Add a `storage` listener for the auth token, including a check that the account (`sub`) is unchanged.
- **Report conflict outcomes honestly (medium, M):**
  - Show "Saved" only when nothing conflicted, and name the lost days.
  - Give acceptMerged a conflict branch that still opens the publish dialog, and do not tell the scheduler to re-run Generate (1619-1639, 3043-3075). Keep the pin at data-layer.test.js:730.
  - Have the keepalive days write join daySyncChainRef so locking the phone mid-edit can't raise a false conflict (2206-2222).
- **Vacation DELETE zero-row check (low, S):** use return=representation in deleteTimeOffRow and deleteEastOverride (1375-1399, 2839-2848). The smoke mock must echo a row (smoke.mjs:762-790).
- **Roster and per-surgeon rule saves (low, S):** use `awaitBlobWrite`, as group rules and holidays already do (2569-2581). Extend the B9e pin at data-layer.test.js:5332.
- **Bare-fetch writes (low, S-M):** move about 20 of them to authFetch (1377, 1410, 2636, 2666, 2681, 2732, 2748, 2832, 2843, 2878, 3199, 3213, 3223, 3275, 4041, 4181, 4253, 4277, 4388; snapshots in config.js:399-542). Add a negative pin, and keep the keepalive flush on bare fetch.
- **Manual-edit notifications (low, M):** send the alert and email after the day's write lands, not at edit time (2465-2497).
- **Realtime status (low, S):** log non-SUBSCRIBED statuses and `.on("system")` errors (1901-1903). This client part is not scheduler-only.
- **Blob-read state, app-wide (low, M; added 9/29 with Prompt 22, Faraz):** mirror a successful call_schedule_data read into state (today only `blobLoadedRef`, which gates writes), so the blob-based displays - the holiday markers, the offer-notice thresholds, the group call line and the share / printable rule sentence - say "not loaded" instead of falling back to the code defaults while the blob read has failed. Accepted as is for now: the next 60 s poll (refreshAll -> refreshBlobRow -> adoptBlob) replaces the defaults once a read lands.

**Phone and everyday use**
- **Phone header (medium, M):**
  - Put the nav on one horizontally scrolling row with badges unclipped and Undo/Alerts kept visible.
  - Drop the month label's minWidth 150 and shorten the coverage strip and banner (app-styles.js:113; index-source.html:5546-5823).
  - Keep the `cal-month` and `cal-year-input` testids and the "Time off & Trades" label (pinned by smoke and B3).
- **Calendar subscribe links (medium, S):**
  - Add a webcal:// link labelled for iPhone/Mac, a Google cid link (desktop only; Google refreshes slowly), make subscribing the primary button on Mine, and relabel the .ics download as a one-time copy (6235-6236, 6726-6794).
  - Keep the testids `download-my-calendar` and `copy-sync-url`.
- **Contrast checks (medium, S first step):**
  - Extend the contrast.mjs literal scan to DayEditor, MonthPainterSheet and Generate.
  - That scan would flag #a83232 on the dark panel (2.19:1) in the DayEditor error alert (8047, 8119, 8147, 8148), which becomes T.open, and the Padlock SVG fill (7748-7749).
  - Moving to T tokens throughout is M-L. css.* is light-only on purpose (data-layer.test.js:4956-4960, 2560).
- **Coordinator's calendar sync card (low, S):** show the full feed to the coordinator via one `seesFullFeed` flag (6725-6794). Update the pins at data-layer.test.js:4890/4892/4898/5749, and keep the footer anchor text.
- **Tapping an alert (low, S):** goToDay(n.data.day) for calendar rows, and show the time (5596-5605). Keep the tabMap line (open-shifts.test.js:386-387).
- **Vacation form (low, S):** End follows Start and gets `min={start}` (361-362, 5190-5191, 5225).
- **Pinch-zoom (low, S):**
  - Re-enable it: drop maximum-scale and user-scalable (13).
  - Force 16px inputs under `(hover:none) and (pointer:coarse)` so landscape doesn't zoom on focus (42).
  - Update the pin at data-layer.test.js:4492. Check the client-versions list for Android first.
- **Backup "Next call" card contrast (low, S):** use the #6F5018 → #8A6A20 gradient and drop the opacity (6179-6184). Add the tokens to both themes (data-layer.test.js:2483).
- **Phone grid notes and holidays (low, S):** add a phone-only note dot and use T.warnText for holiday names (86, 5884, 8103). The holiday tint itself is already visible.
- **Accessibility (low, S each):**
  - day-cell aria-label from titleBits (5878);
  - labels on the vacation-form fields (5218-5226);
  - 44px close buttons (5242, 5365, 5590);
  - Alerts button name, aria-expanded and Escape to close (5563-5568; pin 2556 and 6 smoke selectors);
  - keyboard access for Collapsible headers (7484);
  - focus handling for the Publish and Paint-vacations dialogs (5310, 6942).
- **Printing (low, S):** add a Print button beside Today, fix the dead print CSS (33-36), and replace the fixed 11/2-12/13 ER preset (5972; smoke er-preset-1213).
- **Totals (low, S):** hide the always-empty target columns and use plain wording for non-schedulers (8265-8453). Remove "(Prompt 10)" from user-facing text (3372, 6794).
- **Public view (low, S):** link the live read-only view from the share page and show "Schedule last changed" (5085, 5528). Whether to advertise the link is the scheduler's call.
- **Unlinked viewer (low, S):** show a hint line with its own testid (5627).

**Performance (all low)**
- **Stop the poll replacing unchanged data (S+, after Do-first #2):**
  - Use functional setters that keep the old value when rows are equal (1149-1250).
  - Keep the `everHadRealDataRef` arming.
  - Add a day-rollover tick, because todayStr (4521) currently only rolls over through poll re-renders.
  - Bump saveTick when refreshDays flips loadFailedRef back to false (1811).
  - Only compute eastConflictRows and eastVacConflictRows on the scheduler's Setup view (2414, 4708).
- **Realtime reloads (S):** coalesce them per table within 500 ms or less, inside the effect cleanup (1894-1899).
- **Duplicate cold-open load (S):** add a `cancelled` flag to the load IIFE. Change when the reload is triggered later, and keep the E4 second pass (828, 1709-1918).
- **Deploy reload (S):**
  - Reload only when the stored version is newer than APP_VERSION, using an inline comparator that mirrors versionCmp (1111-1117).
  - Write to localStorage before reloading.
  - Cache-bust vendor files by sha. Pins: data-layer.test.js:915-917, ci.test.js:318, smoke.mjs:9025-9033.
- **SlotLine and badges (S):** call SlotLine as a plain function (5734). Keep Badge/HolderTag stable with useCallback so the pins at 1015 and 2028 hold.
- **Accept & Publish writes (S):**
  - Mirror only the undo count into state (480, 1613-1614).
  - Warn about an echo only when it differs from the local day (1875).
  - Bounded concurrency is M.
- **Blob poll (S):** read `updated_at` first and fetch the data only when it moved (1791-1801). Keep the meaning of blobLoadedRef.
- **Other load-time items:**
  - lazy-load importer.js for the scheduler (161, 3102/3142/3191);
  - put fonts, a placeholder and a dark background in `<head>` (5272);
  - strip module comments into dist/ copies (M; re-run the verify-rls probe; compact:true alone saves ~16 KB gzip and loosens Gate 1 at build.js:124).
- **Settings reads (S):** load them when their card first opens (1126-1128).
- **schedule_days (M):** version-probe polling (1434-1449).
- **DayEditor note field (S):** stop typing in the note from triggering the rules rebuild (8135, 7877-7930).

**Code health (all low)**
- **Dead code:** suNumOrNull, isWeekendDay, suLastAssignedDay, IMP_KIND_ORDER, getMondays, forecastToBusy, and the unused `nameOf` props.
- **Old palettes:** the Davenport palettes (config.js:631-660; helpers.js:1518-1538).
- **Month-grid leftovers:** 5876-5887, 5912.
- **Duplicated JSX:** banners and auth buttons (5344-5509).
- **Component split:** extract CalendarGrid (5812-5873) after the identity fix. Skip React.memo until the callbacks are stable.

**Dev loop (all low unless marked)**
- **Smoke (medium):**
  - Re-print all failures at exit (smoke.mjs:9054-9063): S.
  - Add a per-section wrapper with SMOKE_ONLY, only for the self-contained sessions.
  - Fast-forward the clock for the poll waits, but only in separate browser contexts: L overall.
- **build.js output (S-M):** default to a gitignored `.build/` path, with CI passing `index.html` explicitly (build.js:25). Add a preview script.
- **Source-pin regions:** hoist `B9slice` (data-layer.test.js:5170) into a general `region()` for the 57 two-marker slices.
- **Timing budgets:** use `process.threadCpuUsage()` (not cpuUsage).
- **Test runner:** one that keeps going after a failure and prints a table. It lives in test/, not scripts/, because of ci.test.js §6's --help contract. Drop `test:ui` and fix the stale list at CLAUDE.md:67-70.
- **Source pins:** loosen them rather than delete them. The smoke is not in CI (build.yml:132-138).
- **Other test fixes:**
  - pin Playwright in test/ui/package.json;
  - make the exports test offline by default (exports.test.js:745-790);
  - move the status notes at CLAUDE.md:114-126 out of CLAUDE.md.

## 4. Scheduler-only proposals

1. **Realtime publication.**
   - Run `select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1;` and record the result in docs/SCHEMA-REVIEW.md.
   - Codify the membership in schema.sql plus a migration, using a re-runnable DO block.
   - Optionally add east_overrides and east_vacation_reviews. Update smoke RT_TABLES (smoke.mjs:564-571) to match.
   - Fix the claim at docs/SILVIS-BUILD-GUIDE.md:308.
   - This is a prerequisite for ever lengthening the poll.
2. **One-request publish.** An `apply_day_rows(p_rows jsonb)` RPC, security invoker, with version-checked writes per row and an outcome per day. scripts/publish-preview.js:517-531 is the model.
3. **Server-side vacation check.** A schedule_days trigger that refuses a holder inside their own time_off range. It must still allow the existing locked and imported rows.
4. **Notifications retention (cron).** Optional. The pop-up fix doesn't need it.
5. **verify-rls probe.** Re-run it after any change to the bundle or dist/ paths (check 12a' greps the served files).

## 5. Checked and not a problem

No finding was refuted outright. These parts of findings, and these proposals, were checked and should not be raised again:

- office_contacts loads once at sign-in, not twice: React 18 batches the updates (822-828). notification_preferences usually loads once too.
- A post-deploy reload does not re-download the scripts, which come from the HTTP cache. The real cost is about 171 KB gzip of index.html plus about 103 KB of vendor files per deploy, not 1.8 MB.
- The duplicate cold-open load doesn't compete with script downloads: the scripts finish before React mounts (158-163).
- The service-worker/cache wipe harming the Davenport app is unverified. This repo registers no service worker and uses no Cache API.
- The config blob is about 25 KB, not 52 KB, and it is not the biggest poll payload (schedule_days is).
- The 9/23 publish was 70 rows written by scripts/publish-preview.js in one SQL block, not an in-app Accept & Publish.
- The Mine nested scroller doesn't trap scrolling (default scroll chaining). It is friction only.
- A rules-context rebuild costs about 1-3 ms. "Battery drain" and "scroll jank" from the rebuilds and remounts are not supported: there is no scroll listener.
- Realtime echoes during a publish already skip setSchedule mid-loop (lastSyncRef is only set at 1618).
- Days written before a mid-loop throw are not re-PATCHed while Realtime is up.
- An anonymous vacation DELETE writes no false audit row (audit_insert is `to authenticated`). The factory-reset DELETE needs no zero-row check, because the snapshot capture blocks first (3259).
- iOS Safari ignores `user-scalable=no`, so the pinch-zoom issue is mainly Android.
- Being fully offline at open shows the sign-in card, not an all-OPEN calendar.
- The midnight rollover works today through the poll. A separate timer is only needed once the poll de-dup ships.

Proposals that were checked and should not be done:

- Returning early when `reloadTrigger === 0` with a stored session. It delays the load behind Face ID and breaks smoke.mjs:2993-2996.
- Skipping the SUBSCRIBED → refreshAll for 10-15 s after a load. It opens a gap for missed changes, and the B4 pin is at data-layer.test.js:5152.
- Stretching the poll to 5 min while Realtime is SUBSCRIBED, or slowing east_overrides and the reviews:
  - A3 token upkeep needs the 60 s cadence (config.js:106);
  - the profile and East tables are not on the Realtime channel;
  - the client-side East claim gate relies on fresh overrides.
- The header wording "Not synced": it matches the smoke's `text=Synced`.
- Capping the Mine list, hiding the year input, or shortening "Time off & Trades": each breaks smoke checks or B3 pins.
- A created_at watermark for pop-ups, because created_at is stamped by the device.
- Gating syncScheduleDaysNow itself on loadFailedRef: it would block snapshot restore and import.
- Budgets based on `process.cpuUsage()`: GC threads inflate it about 1.7x.
- A KNOWN_FAILS allow-list in the smoke.
- Deleting source pins because the smoke covers the same behaviour: the smoke doesn't run in CI.
- Renaming the Badge prop to renderBadge: it breaks the pins at data-layer.test.js:1015 and 2028.
- Offering webcal as a universal link: it only works on Apple devices.
- De-duplicating captureIfStale's list(1): it saves one tiny GET.

## 6. Branch sequence (one task per branch)

| # | Branch | Item | Overlaps a pending UI request |
|---|---|---|---|
| 1 | `fix/days-load-failed-display` | Do-first 1 | Shift-adjust: the open-shifts board empty states (6018, 6037) |
| 2 | `fix/day-write-network-failure` | Do-first 2 | none |
| 3 | `fix/auth-transient-errors` | Do-first 7 | none |
| 4 | `feat/on-call-now` | Do-first 3 (+ "You: next call") | none |
| 5 | `fix/notif-popups-seen-ids` | Do-first 6 | none |
| 6 | `fix/error-toasts-stay` | Do-first 8 | 6-week offer warning, if it is a toast or confirm |
| 7 | `perf/parallel-startup-load` | Do-first 4 (+ explicit days refusal in runGenerate) | none |
| 8 | `fix/generate-input-guard` (report first) | Worth doing | **6-week offer warning**: both gate runGenerate/acceptPreview (2952-3015, pin 3466), so combine or sequence them |
| 9 | `perf/poll-pause-hidden` | Do-first 5 | none |
| 10 | `ci/test-every-push` | Do-first 10 | none |
| 11 | `ui/mine-rows-phone` | Do-first 9 | **Shift-adjust**: the `mine-trade` button (6202, pin 5734) |
| 12 | `fix/sync-refusal-vs-conflict` | Worth doing (refusal, conflict reporting, storage listener, keepalive chain) | 6-week offer warning, if it hooks acceptMerged's publish step |
| 13 | `perf/poll-stable-rows` (after 2 and 9, with a day-rollover tick) | Worth doing | Shift-adjust: offer and period reloads after a painter save |
| 14 | `perf/realtime-coalesce` | Worth doing | Shift-adjust: call_offers reloads (4213-4230) |
| 15 | `ui/phone-header-compact` | Worth doing | none |
| 16 | `feat/calendar-subscribe` + coordinator feed + lazy Settings reads | Worth doing | **Settings declutter** (6725-6794, 1126-1128), so combine |
| 17 | `ui/contrast-scan-wider` + DayEditor #a83232 + note-typing memo + dialog focus hook | Worth doing | **Day-click simplification** (8004-8148, 7857-7930), so combine |
| 18 | `fix/deploy-reload-once` | Worth doing | none |
| 19 | `perf/slotline-helper` | Worth doing | none |
| 20 | `ui/small-fixes`: split into one branch each (vacation End, alert→day, Totals, print, pinch-zoom, backup-card contrast, a11y) | Worth doing | Alert→day opens DayEditor: day-click simplification. Pinch-zoom enlarges Setup inputs: Settings declutter |
| 21 | `test/*` one branch each: smoke failure re-print, `region()` helper, threadCpuUsage, runner subset, Playwright pin, offline exports, `.build/` output | Worth doing | none |

Branches 1-7 are independent of each other. Branch 2 must merge before branch 13, and branch 7 should carry the runGenerate days refusal. Branches 2, 7, 8, 12 and 13 touch the sync or state path, so each needs a PR and `npm test` plus `npm run smoke`, per CLAUDE.md.