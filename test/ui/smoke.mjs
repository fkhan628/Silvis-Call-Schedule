// Silvis Call Schedule - Playwright smoke harness (Prompt 6 Slices A-E + fix round 1 + Prompt 9).
//
// Serves the built index.html from a tiny static server, intercepts the Silvis
// Supabase host (fake signed-in scheduler; writes answered 2xx + recorded with a
// PostgREST-shaped representation; anon READS pass through to the real project
// with the anon key), mocks the Realtime websocket (so a postgres_changes row
// can be injected on demand), then:
//   - asserts the app reaches the calendar with the header "Silvis Call Schedule"
//   - clicks every nav tab, asserting no pageerror / unexpected console error
//   - Slice B/C/D on the imported data: October 2026 shows 'P <name>' cells and
//     OPEN cells where the served rows leave a slot open (10/15 was P OPEN until
//     the scheduler filled it 9/25 15:24 CDT: Burchett primary, locked, Khan
//     backup), the week of 9/28 shows the Atwell external
//     cover in the grid and as '9/28-10/4 Atwell' in the ER-panel author's week row, the day
//     editor for 2026-10-15 lists greyed (ineligible) options with their first
//     hard reason (read off its served row since 9/25: a primary locked to H
//     greys every other option 'slot-locked:H' and the 'Not eligible' line reads
//     '<Name> - slot locked to <H>'), eligible options come first, Esc closes
//     it; the window reason (Sarkar - outside-window, 'outside the availability
//     window') is read on a day DERIVED from the served rows + the blob (the
//     first weekday on/after today outside every window whose primary is neither
//     locked nor covered, held by her in neither role, off the holiday units,
//     where the rules' own first reason for her is outside-window; the rules
//     must list outside-window on every such candidate - the first 40 in date
//     order;
//     day-editor-window-reason.png); November 2026's grid shows NO E (East-derived) / F (forecast)
//     badge, East legend line or 'East-derived:' hover to anyone, the scheduler
//     included (Item E2, Faraz 9/25), while the scheduler's day editor still
//     shows the East status on exactly the rules' derived / forecast days (the
//     first month from November 2026 with each);
//     a 390px viewport keeps the grid readable (codes instead of names, no
//     horizontal scroll, NO clipped pill / truncated OPEN / overflowing P-B
//     line - vis-001); the year field accepts typed input key by key
//     (vis-002); dark mode keeps week-row names, vacation dots and the title
//     at 3:1+ contrast measured on computed colours (vis-003). Screenshots:
//     calendar-oct-2026.png, calendar-nov-2026.png, week-rows-oct-2026.png,
//     day-editor-2026-10-15.png, day-editor-window-reason.png (when a derived
//     day exists), calendar-mobile.png, calendar-oct-dark.png
//   - Prompt 9 exports, from the Calendar tools card: the group and per-surgeon
//     .ics downloads (all-day runs since 9/25: VALUE=DATE lines, stable run UIDs, summary naming), the
//     shareable read-only page (downloaded, re-opened through the static
//     server, 10/15 OPEN red while the served rows leave it open, week rows
//     present, screenshot share-page.png),
//     the printable popup (P/B strings, OPEN red, external cover, screenshot
//     printable-page.png), the ER-panel author's ER Call Panels (header text, visible-month
//     default, the 11/2-12/13 preset with its rows printed and screenshotted
//     to er-panel-2026-11-02-to-12-13.png, typed range, Copy for Word writing
//     text/html + text/plain, the .html download) and My schedule's
//     "Download my calendar" (silvis-call-khan.ics)
//   - makes one schedule edit THROUGH THE DAY EDITOR and asserts a schedule_days
//     POST (version 1) was sent
//   - injects a foreign realtime row and asserts it is adopted
//   - RACES the echo of a write against a pending local edit and asserts the
//     local edit survives and re-syncs as a CAS PATCH (finding datalayer-001)
//   - hides the tab inside the debounce after a foreign v3 row + local edit
//     and asserts the keepalive flush sends PATCH ?day&version=eq.3 (v4) and
//     never an on_conflict upsert (finding wire-1)
//   - public mode: waits for the load to FINISH and for real assignments in
//     the grid before passing, so an RLS-blocked anon read (200 + []) fails
//     instead of passing on the all-OPEN pre-load picture (finding vis-008)
//   - opens the publish dialog and asserts the diff line carries a real arrow
//     character, not the text "\u2192" (finding removal-02)
//   - Slice E (Setup): every card expanded + screenshot (setup-<card>.png), Users
//     last-admin refusal + PATCH ?id=eq.<uuid>, Rules pattern preview + save,
//     Availability paste box, vacation conflict panel, Holidays coverage, East
//     status, Generate preview (no writes; generate-preview.png), Accept & Publish
//     with a FAILING snapshot (no writes) then for real (snapshot before the
//     first schedule_days write, publish dialog), Import seed dry run (0 changes,
//     no writes; import-dryrun.png) and a seed with an injected contact key
//     (refused). Switch: failSnapshotInsert makes the snapshot POST answer 500.
//   - Prompt 12 item SM2 (the schedule is published through 2027-01-03 since the
//     9/23 overnight publish): no pin names a day the schedule can fill. The
//     week-row OPEN entries, the ER copy's red OPEN span, the fail-closed /
//     block-member / trade-block days (first row-less weekday and Fri-Sun
//     triples on/after today), the Generate preview range (the app's derived
//     start through the end of that month), the re-checked post-publish cell
//     and the Import dry-run / apply counts (blocked days, availability /
//     time_off inserted vs skipped, 'kept (app-edited)') are derived from the
//     live rows, the importer's own plan for the seed (PLAN, computed once at
//     the top) and this run's edits, with an observed premise (every plan-day
//     cell equals its live row, and a schedule_days poll after this run's last
//     write) before the apply. Left as dated pins: the 10/15 'P OPEN' family
//     (each also guarded by liveOpenEarly - since the scheduler filled 10/15 on
//     9/25 they print 'held live' and the cell pin checks the holder) and the
//     'respect locks OFF over 10/5-10/11' preview. 9/25 (10/15 filled): the
//     today-forward half of item Q (the first open slot on/after today), the
//     Slice D reasons (10/15's lock, the window day) and the Open shifts
//     'Email the group now' step (run while a slot is still on the board)
//     read the served rows as well. SM2 review: the row-less day
//     scans run to 400 days past the LAST live row and skip Fri-Sun triples that
//     overlap a holiday unit of the blob; the outside surgeon's day is the first
//     row-less weekday after this run's last edit and the whole outside-surgeon
//     block (roster save, editor, Totals) runs at the top of a fresh poll
//     interval (freshPollWindow - the poll re-adopts the live blob and drops
//     the mocked row); the post-publish probe prefers a cell the accept changed
//     and checks both holders.
//   - fix round 2 (Slice E findings): the Generate presets start after the LAST
//     PUBLISHED day (end of the longest contiguous block of rows, wire-1; since
//     Prompt 12 item SM the start and both preset ends are DERIVED each run from
//     the live rows by a restatement of the app's rule, after settleMapToLive
//     has OBSERVED in the grid that the app's map equals the live rows on every
//     day this run edited - waiting for the app's 60-s poll when it does not
//     yet; likewise the time-off refusal's preselected trade day (its two
//     deciding cells observed) and the Accept & Publish write set, where a
//     holders-unchanged write must name a lock / source / note change against
//     the live row - no pin encodes today's table); Accept with 'respect locks'
//     OFF confirms BEFORE any write and a dismissed confirm writes nothing
//     (safe-2); the publish dialog closes with 'Skip the notice' and says the
//     changes are already saved (safe-2); an east_feed upsert aborted at the
//     network level warns + toasts with the status unchanged, then a real
//     Refresh's upsert payload is asserted against a mocked Davenport host
//     (safe-1 / wire-2; switch abortEastFeedPost, EAST_HOST route); the import
//     dry run warns when the live blob was app-saved and Apply refuses with
//     zero writes when updated_at moved since the dry run (safe-4; switch
//     blobReadOverride)
//   - Slices F + G: Totals for October 2026 renders all six surgeons with
//     primary / backup / total / weekend-day / max-consecutive numbers equal to
//     an INDEPENDENT recount of the live schedule_days rows done in this file
//     (anon fetch), no '$' anywhere, CSV export downloads with one row per
//     surgeon, the fairness view renders (totals-oct-2026.png, fairness.png);
//     My schedule shows s1's next call = the first live day on/after today
//     with s1 in either role, the upcoming list and the sync-URL button
//     (mine.png); Time off: a range over 2026-11-26 (Khan primary,
//     Thanksgiving) is refused CLIENT-SIDE with the date listed, a 'propose a
//     trade' shortcut and NO write, then a clean range records exactly one
//     time_off POST + one audit 'timeoff.add' + one notification
//     'vacation_logged' with the composed message (timeoff.png); Trades:
//     proposing to an ineligible counter-party is blocked with the reason and
//     no write, a valid proposal POSTs shift_trade_requests + notification
//     trade_proposed + send-notification with data.message, Accept records
//     PATCH status=accepted THEN POST rpc/apply_trade in that order and the
//     row reads applied (trades.png)
//   - fix round 3 (Slices F + G findings): the Totals recount compares the
//     VISIBLE cells too and applies this run's own edits (harnessDays) so it is
//     never skipped (vis-001 / vis-002); Acton gets a monthlyTarget through the
//     Rules card so the signed deviation, the green target mark and the CSV
//     Target / Deviation columns are exercised (vis-003); flagged Totals cells
//     keep their warning colour in dark mode, measured on computed colours
//     (vis-004; totals-oct-dark.png, fairness-dark.png); trades: a unit day
//     (Khan's Thanksgiving 11/26-11/29) trades as the WHOLE unit - a single
//     day needs the scheduler's confirm (dismissed -> no write), the unit
//     proposal POSTs one row per day with a unit stamp and one notification,
//     Accept moves all rows (fg-1); with the session token expired a realtime
//     change on shift_trade_requests is skipped, never read as anon, and the
//     pending rows survive (datalayer-001); the single-day flow now runs from
//     Burchett (Khan's only upcoming days are the unit)
//   - screenshots each tab to test/ui/out/<tab>.png
//   - Prompt 11 (hardening): the 'coverage at a glance' strip equals an
//     independent 60-day recount of the live rows (open primary / backup,
//     forecast-busy primary = 0, East coverage end, last published, snapshot
//     age) and its counts open the first such day; mobile 390px checks (tap
//     targets >= 36px, in-card table scroll with a swipe hint, sticky day
//     editor footer, PREVIEW tag fits, trade selects fit, no '[object
//     Object]' in the Generate score); a second page with version.json newer
//     than APP_VERSION + client_versions.main.min_version above it asserts
//     both refresh banners and that their buttons call __silvisHardReset; a
//     third page runs data management end to end with recorded writes: JSON
//     export shape/counts = live anon data, malformed imports refused with no
//     write, factory reset needs the typed RESET, records the snapshot BEFORE
//     the delete and aborts when the snapshot insert fails, restore from that
//     very snapshot replays config upsert + CAS day POSTs + time_off /
//     availability upserts with a byte-compare of restored map vs snapshot vs
//     export, then a valid import of the export (snapshot first, nothing to
//     rewrite). The snapshot table is served from an in-harness store.
//   - Prompt 13 part 3 (the Open shifts board, run BEFORE this run's first
//     edit): the nav tab 'openshifts' + badge; the board's rows equal an
//     independent recount of the live rows from today to the app's last
//     published day; the coverage strip's 60-day open counts = the board's
//     rows inside the window + the unpublished tail (recounted from the live
//     rows; empty once the schedule runs 60+ days ahead - Faraz's pin);
//     Eligible now chips agree with s1's Take button; filters 30 / 60 / all,
//     role, weekend-only (the badge keeps counting the whole range); Copy
//     list = one 'Ddd MM/DD - role (unit) - open' line per row; Take this
//     shift as the mocked s1 -> claim-sheet (Escape closes it, no write) ->
//     Confirm -> POST rpc/claim_open_slot { p_day, p_role } only (no client
//     audit / feed / schedule_days write; send-notification shift_claimed to
//     scheduler + claimer) -> the row leaves the board, the badge drops, the
//     calendar cell shows s1 (the harness overlays the claimer on the mocked
//     row); Email the group now (confirm) -> feed open_shifts with data.slots,
//     broadcast send-notification, audit openshifts.notify, 'last announced'
//     fills - run BEFORE the claim when the claim takes the board's only open
//     slot (LIVE mode since 10/15 was filled 9/25: the harness-opened slot is
//     the only one) because the button is disabled on an empty board; an
//     empty board asserts it disabled and says the send path did not run;
//     390 px in BOTH themes with the same probe (no page scroll, table
//     scrolls in its wrapper with the swipe hint, buttons >= 36 px; dark adds
//     the navy body and table text >= 3:1). Screenshots openshifts.png,
//     openshifts-sheet.png, openshifts-email-preview.png, openshifts-390.png,
//     openshifts-dark.png, openshifts-390-dark.png (kept in test/ui/out/, gitignored -
//     B10 9/23: no docs/screenshots copy, the e-mail preview shows the harness URL). Fix round:
//     the review shots are taken with the toast dismissed (openshifts.png
//     BEFORE Copy list, the sheet as a viewport shot), the dark 390 probe
//     fails on a white swipe-hint cover, and the 'ok screenshots' line is
//     earned - every file must exist, be from this run and stay under 300 KB.
//   - Prompt 14 part 3a (the offer painter, U3a): call_offers / call_periods
//     are authenticated-only, so the harness serves them (the seed's first
//     period with a fake uuid, s1 on its rulesOnly list; an offer store with one
//     s2 row) and answers rpc/save_offers + rpc/set_offer_mode like the SQL
//     functions (tokens included; failSaveOffers forces one OF002 refusal). At
//     390 px light: My schedule -> Paint my offers opens on the current month,
//     past rows greyed 'past' + disabled, every row >= 52 px, no horizontal
//     scroll; the first month ahead with six paintable rows: Primary armed =
//     gradient + white text, tap / tap again (clears) / tap, a second Primary,
//     Backup, Range + Either over two endpoints (hint names the start with 'x
//     cancel start'; every free row between is painted), the Tue/Thu primary
//     confirmation counted once per batch, '1 other offered' on the s2 day,
//     header counts = the draft, period box = seed picture (rules_only,
//     preferred) folded to ONE line so the day list keeps >= 45 % of 844 px,
//     Change -> toggle 'Only these days'; a FORCED failure records one
//     save_offers attempt and nothing else, names every entry verbatim, keeps
//     the draft; the real Save = exactly ONE save_offers (rows in day order, no
//     clears, p_period + p_mode exhaustive in the SAME call - no set_offer_mode)
//     + ONE audit offers.save and nothing else; rows read back saved, note
//     clears after 3 s, tap-again on a
//     saved day = 'will clear', Close confirms (dismissed = stays), Discard
//     restores; then as the scheduler for Fierce: 'Paint offers for Fierce' /
//     'as the scheduler (relayed)', 'Go by my rules' = ONE set_offer_mode
//     rules_only + ONE audit with his rules in the confirm text; then the nav
//     action at 1180 (light) and dark at 1180 + 390 (sheet navy, armed brush
//     still a gradient). Screenshots offers-greyed-390.png, offers-armed-390.png,
//     offers-range-390.png, offers-saved-390.png, offers-desktop.png,
//     offers-desktop-dark.png, offers-390-dark.png.
//   - Prompt 14 part 3c (U3c): offers / periods are in ctxInputs. The harness
//     store carries s3's offer (his held role) and s4's 'either' on one day
//     inside the seed period (U3C, above the store): the day editor on that
//     day lists "Offers (<label>): <name> - offered <role> | not offered - ...
//     | rules (...)" per pool surgeon (restated from the store at run time),
//     eligible dropdown options carry the tag; on the day after s4
//     (exhaustive) is greyed 'not-offered' with the glossed reason and s3
//     (preferred) reads the soft penalty; My schedule as s3 shows the pill
//     "(placed)" and the upcoming row's offered / not offered chip; 390 px
//     and dark for both. Screenshots day-editor-offers.png,
//     day-editor-not-offered.png, day-editor-offers-390.png,
//     myschedule-offers.png, myschedule-offers-390.png,
//     day-editor-offers-dark.png, myschedule-offers-390-dark.png.
//   - Prompt 12 item TH (theme, items O + R): the sign-in screen is opened
//     WITHOUT a session on a second page (the auth token removed by an init
//     script) and screenshotted in both themes (signin-light.png,
//     signin-dark.png; the theme is forced through the app's own
//     silvis-dark-mode flag - the app has no prefers-color-scheme hook), the
//     SSC tile / Sign in button / links are measured orange on computed
//     colours; a signed-in month view per theme (theme-month-light.png,
//     theme-month-dark.png) is measured: navy header, orange today ring,
//     Khan pill #1F3A6B, dark page #0B1A33; every token pair of the theme is
//     printed as a contrast table (test/ui/contrast.mjs: 4.5:1 text, 3:1
//     bold labels / glyphs) and any failing row fails the run; the source
//     grep for #1a6fa8 / #2488c8 / 1f7a5c / DSG outside comments must be
//     empty in index-source.html, app-styles.js, manifest.json, config.js
//     and helpers.js (the share page / printable CSS); the .ics pill buttons,
//     the active-tab label and the dark Fairness bar fill are measured too
//   - Prompt 15 part 3 (East vacations, 9/23): the harness overlays THREE FAK
//     ranges (2027-04/05, Tue-Fri each) on the newest cached east_feed row
//     (every live data.vacations list stripped first, so the picture does not
//     depend on what Faraz has refreshed), serves east_vacation_reviews from an
//     in-harness store seeded with one 'away' and one 'home' row (the third
//     range = unreviewed) and answers the mocked Davenport time_off with the
//     same three rows (the Refresh above resets nothing - asserted: no
//     east_vacation_reviews DELETE). Then: the Setup ->
//     East feed panel lists the three ranges with the unreviewed / away / home
//     control (pressed = state, >= 32px); unreviewed -> away is ONE POST
//     ...east_vacation_reviews?on_conflict=person_id,start,end (merge-duplicates
//     + representation, decided_by s1) + audit eastvac.review and NO time_off
//     write; back to unreviewed is ONE DELETE by the exact triple (representation
//     counted) + audit reset; away -> home saves the review only (no call_offers
//     write: the Prompt 14 hook is a no-op tonight); the conflicts list renders;
//     the panel is screenshotted with one range in each state in both themes at
//     desktop and 390 px (eastvac-panel*.png; dark: navy body, active segment
//     white on its tone); the calendar shows a dashed / hollow / filled diamond
//     on the three days and NO Silvis dot; the day editor's East line carries the
//     state and Khan's primary reason reads 'on vacation (East vacation,
//     unreviewed ...)', while on the home Tuesday he is eligible (Tue lifted); the
//     coverage strip reads 'unreviewed East vacations: 1 (Khan)' and opens Setup
//     -> East feed (the card's collapse flag set to '0' first, so the click is
//     what opens it); My schedule and the Time off view list the same three
//     decisions (mine-eastvac.png). Fix round: a Refresh whose mocked Davenport
//     answer moved one range and dropped another DELETEs the two old review rows
//     by their exact triples (+ audit eastvac.review reset, reason changed /
//     removed), names both in the refresh toast and keeps the unchanged range's
//     row; the panel then lists the moved range unreviewed.
// Exit code 1 on any failure.
//
// Determinism (finding removal-03): React / ReactDOM / the Supabase SDK are
// served from an on-disk cache under test/ui/out/cdn-cache (filled by the
// browser's own first fetch of each CDN URL, then reused byte-for-byte), Google
// Fonts are stubbed with empty CSS, and every failed network request is printed
// when the run fails. The only live traffic after the first run is the anon
// Supabase REST read passthrough. The initial page load and the public page
// get one retry each.
//
// Data source: the live Silvis project (anon reads). When the live
// schedule_days table is EMPTY (import not run yet, or wiped) the harness
// serves the same imported rows from docs/silvis-seed.json via
// importer.importPlan for schedule_days / call_schedule_data / time_off /
// availability (east_feed / east_forecast / east_overrides stay live) and
// says so in its output. The assertions are identical either way.
//
// Run:  node build.js && node test/ui/smoke.mjs      (or: npm run smoke)
// Env:  PLAYWRIGHT_DIR  node_modules dir that contains playwright (optional;
//                       see PW_CANDIDATES for the default search order)
//       HEADFUL=1       watch the browser
//       SMOKE_NO_CACHE=1 bypass the CDN cache for this run
//       SMOKE_FIXTURE=1 force the seed fixtures even when live data exists
//       SMOKE_LIVE=1    forbid the fixture fallback (an empty live table then fails)
// LIVE mode (P13R-2, 9/23): every OPEN expectation derives from an up-front anon read of the live rows (never a
// dated constant), and when the live board has no open slot s1 may take, the harness OPENS ONE backup slot in what
// it serves (a Mon/Wed 'generated' row after the seed's range, chosen by asking the app's own board) so the claim
// scenario runs - see harnessOpen. Nothing is ever written to the project.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { contrastTable, formatTable, regionTable, formatRegionTable, loadTheme, hexToRgb, contrastRatio } from "./contrast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const CDN_CACHE = path.join(OUT, "cdn-cache");

// Playwright lives outside the repo (it is not a devDependency: CI's npm
// install must stay small and the deploy job never runs a browser). Search
// order: explicit env (PLAYWRIGHT_DIR), then the repo's own node_modules (npm i -D --no-save
// playwright).
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_DIR,
  path.join(ROOT, "node_modules"),
].filter(Boolean);
const PW_DIR = PW_CANDIDATES.find(d => fs.existsSync(path.join(d, "playwright", "package.json")));
if (!PW_DIR) {
  console.error("FAIL: playwright not found. Looked in:\n  " + PW_CANDIDATES.join("\n  ") + "\nInstall it with `npm i -D --no-save playwright && npx playwright install chromium` or set PLAYWRIGHT_DIR.");
  process.exit(1);
}
const require = createRequire(pathToFileURL(path.join(PW_DIR, "x.js")).href);
const { chromium } = require("playwright");
console.log(`playwright from ${PW_DIR}`);

const SUPABASE_HOST = "bzhsroegtagqhutbnsrp.supabase.co";
const CDN_HOSTS = ["unpkg.com", "cdn.jsdelivr.net"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const configSrc = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const ANON_KEY = (configSrc.match(/const SUPABASE_ANON_KEY = "([^"]+)"/) || [])[1];
if (!ANON_KEY) { console.error("FAIL: could not read SUPABASE_ANON_KEY from config.js"); process.exit(1); }
const APP_VERSION = (fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").match(/var APP_VERSION = "([^"]+)"/) || [])[1];
if (!fs.existsSync(path.join(ROOT, "index.html"))) { console.error("FAIL: index.html missing - run node build.js first"); process.exit(1); }

// Console errors we accept (each documented). Anything else fails the run.
const EXPECTED_CONSOLE_ERRORS = [
  { rx: /realtime\/v1\/websocket|WebSocket connection/i, why: "Realtime is mocked; a stray socket error is not an app fault" },
  { rx: /favicon\.ico/i, why: "no favicon.ico; the page declares PNG icons" },
];

const FAKE_UID = "00000000-0000-4000-8000-000000000001";
const FAKE_EMAIL = "scheduler@example.com";
// The one mocked profile row (admin, linked to s1). Its email column stays
// null on purpose: the Users card displays user_profiles.email and this run
// must never put an address on screen or in a screenshot.
const FAKE_PROFILE = { id: FAKE_UID, person_id: "s1", role: "admin", display_name: "Khan", email: null, created_at: "2026-09-22T00:00:00Z" };
// Prompt 16 A7: a second mocked session - the COORDINATOR (office account: role coordinator, NO person_id). Its page
// routes through routeSupabaseAs(COORD_PROFILE) below (own profile + own auth user, everything else the shared route),
// and the rpc/save_offers mock reads the caller's JWT sub to stamp entered_by / source like the SQL function does.
const COORD_UID = "00000000-0000-4000-8000-00000000c0c0";
const COORD_PROFILE = { id: COORD_UID, person_id: null, role: "coordinator", display_name: "Office (harness)", email: null, created_at: "2026-09-24T00:00:00Z" };
let failSnapshotInsert = false; // Slice E harness switch (see the Supabase route)
let forcedOffer400 = false;     // Prompt 14 part 3a: the browser's own "400" line for the save_offers refusal the harness forced (OF002) - consumed once
let abortEastFeedPost = false;  // fix round 2 (safe-1 / wire-2): the east_feed upsert POST is aborted at the network level
let delayScheduleWriteMs = 0;   // RF2 b: hold every schedule_days POST / PATCH open for N ms so a CAS sync run is provably in flight
let blobReadOverride = null;    // fix round 2 (safe-4): { updated_at, updated_by } stamped onto every call_schedule_data GET row
let expiredWrites401 = false;   // Prompt 16 A3: every non-GET under /rest/v1 or /functions/v1 whose bearer JWT is past its exp answers 401 PGRST301 (the real PostgREST answer); the browser's own 401 / 400 console lines are expected while armed
let authRefreshGrant = null;    // Prompt 16 A3: an access token the token endpoint hands out for grant_type=refresh_token; null = the refresh is rejected (400 invalid_grant)
let b7DeadLinkStatusLines = 0;  // Prompt 16 B7 (review): the browser's own 401 / 400 lines for the dead link's probe and its refresh - armed per answer by the B7 route, consumed one line each, reset per theme
let blobWriteTs = null;         // rebase follow-up 9/23 (review, major): updated_at of the app's LAST call_schedule_data write, served on every later blob GET (what the real column reads) so the 60 s poll's refreshBlobRow short-circuits instead of re-adopting the harness-untouched blob over a Setup edit
let sessBlobWriteTs = null;     // Prompt 16 A3: the same stamp for the session scenario's OWN BrowserContext (routeSupabase scope "session") - the main page's poll autosave must not move the row under the session page's re-run (its Setup-edit sub-step reads updated_at equality)
// Davenport (East) project mock - fetchEastWeeks reads schedule_weeks + the
// roster blob from this host with its public key; the harness answers both so
// a Refresh never leaves the machine and the upsert payload is deterministic.
const EAST_HOST = "xqongyahdnkozqunpwmu.supabase.co";
const EAST_WEEK = { week_monday: "2026-10-05", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" }, off: [], isBackup: false, dayCallOverrides: {} } };
const EAST_BLOB = { surgeons: [{ id: "s6", name: "FAK" }, { id: "s1", name: "AAA" }] };
// Prompt 15 part 3: three FAK vacation ranges (Tue-Fri, far from every other pin: the clean time-off range is
// 2027-03-02..03, the Generate presets end in 2026) - unreviewed / away / home in that order - overlaid on the
// newest cached east_feed row, answered by the mocked Davenport time_off (person s6 = FAK), and reviewed through
// the in-harness east_vacation_reviews store below (seeded: away for [1], home for [2]; [0] has no row).
const EASTVAC_RANGES = [{ start: "2027-04-06", end: "2027-04-09" }, { start: "2027-04-20", end: "2027-04-23" }, { start: "2027-05-04", end: "2027-05-07" }];
const eastVacReviewStore = [
  { id: "fixture-eastvac-1", person_id: "s1", start: EASTVAC_RANGES[1].start, end: EASTVAC_RANGES[1].end, decision: "away", decided_at: "2026-09-23T04:00:00Z", decided_by: "s1" },
  { id: "fixture-eastvac-2", person_id: "s1", start: EASTVAC_RANGES[2].start, end: EASTVAC_RANGES[2].end, decision: "home", decided_at: "2026-09-23T04:00:00Z", decided_by: "s1" },
];
// What Davenport currently says (the mocked time_off AND the east_feed overlay the reload reads): the fix round's
// refresh-reset step swaps this list for one with a moved and a missing range, then restores it.
let eastVacFeed = EASTVAC_RANGES;
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const FAKE_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FAKE_UID, role: "authenticated", email: FAKE_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
// The same session, expired an hour ago (datalayer-001: an authenticated-only read must be SKIPPED, not degraded to anon).
const EXPIRED_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FAKE_UID, role: "authenticated", email: FAKE_EMAIL, exp: Math.floor(Date.now() / 1000) - 3600 })}.c2ln`;
// Prompt 16 A3 (session scenario): the pair a password sign-in hands out, and the one a GRANTED refresh hands out
// (distinct jti so the bearer of each write says which path produced it). The token endpoint mock records every
// call in authCalls (grant type only - never a password) and rejects a refresh unless authRefreshGrant is armed.
const mkJwt = (expOffsetSec, tag) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FAKE_UID, role: "authenticated", email: FAKE_EMAIL, exp: Math.floor(Date.now() / 1000) + expOffsetSec, jti: tag })}.c2ln`;
const NEW_JWT = mkJwt(3600, "a3-signin");
const NEW2_JWT = mkJwt(3600, "a3-refresh");
const bearerExpired = (h) => { try { const t = String(h || "").replace(/^Bearer /, ""); const p = JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); return typeof p.exp === "number" && p.exp * 1000 < Date.now(); } catch (e) { return false; } };
const authCalls = [];
const COORD_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: COORD_UID, role: "authenticated", email: "office@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
// Prompt 16 B3: a third mocked session - the VIEWER (read-only account: role viewer, NO person_id, no display name, so
// the Account line falls back to "a read-only account"). Its page routes through routeSupabaseAs(VIEWER_PROFILE, extra)
// where `extra` answers the notifications GET with a four-type feed (newest first, as PostgREST orders it), so the
// role filter is provable: the viewer must see the open_shifts and schedule_published rows and neither of the others.
const VIEWER_UID = "00000000-0000-4000-8000-0000000000e1";
const VIEWER_PROFILE = { id: VIEWER_UID, person_id: null, role: "viewer", display_name: null, email: null, created_at: "2026-09-24T00:00:00Z", authEmail: "viewer@example.com" };
const VIEWER_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: VIEWER_UID, role: "authenticated", email: "viewer@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
const VIEWER_FEED = [
  { id: "vf-4", type: "vacation_logged", title: "Vacation logged (harness)", message: "a vacation was logged", data: { surgeon_id: "s3" }, created_at: "2026-09-23T12:00:00Z" },
  { id: "vf-3", type: "trade_proposed", title: "Trade proposed (harness)", message: "a trade was proposed", data: { from_surgeon_id: "s2", to_surgeon_id: "s3" }, created_at: "2026-09-23T11:00:00Z" },
  { id: "vf-2", type: "open_shifts", title: "Open shifts (harness)", message: "open slots in the next 30 days", data: {}, created_at: "2026-09-23T10:00:00Z" },
  { id: "vf-1", type: "schedule_published", title: "Schedule published (harness)", message: "the schedule was published", data: {}, created_at: "2026-09-23T09:00:00Z" },
];
// Prompt 20 F3: a fourth mocked session - a FOLLOWER (role viewer, no roster link, follows s2 and s5 - the shape of the
// first two real followers; the harness never names them). Its notifications GET answers FOLLOW_FEED: seven rows, five of
// which name a followed surgeon or are group-wide (so the follower must see them), two that name only s3 / s4 / s6 (so
// he must not). P20 R1 (review, after the rebase onto Prompt 19): ff-7 is a pending GIVE (data.kind 'give', a trade_id)
// from s3 addressed TO s2, a surgeon he follows, backed by FOLLOW_GIVE_ROW on his shift_trade_requests GET - the case
// where a follower reads a followed surgeon's give alert. Only the give's receiver answers it (notifGiveTrade needs
// to_surgeon_id === the account's own person_id), so the follower's panel must show the stored text and no Accept /
// Decline.
const FOLLOW_GIVE_ID = "00000000-0000-4000-8000-0000000000f7";
const FOLLOW_GIVE_ROW = { id: FOLLOW_GIVE_ID, submitted_at: "2026-09-23T15:00:00Z", day: "2026-12-02", role: "primary", from_surgeon_id: "s3", to_surgeon_id: "s2", return_day: null, return_role: null, status: "pending", kind: "give" };
const FOLLOW_UID = "00000000-0000-4000-8000-0000000000f3";
const FOLLOW_PROFILE = { id: FOLLOW_UID, person_id: null, role: "viewer", display_name: "Follower (harness)", email: null, follows: ["s2", "s5"], created_at: "2026-09-24T00:00:00Z", authEmail: "follower@example.com" };
const FOLLOW_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FOLLOW_UID, role: "authenticated", email: "follower@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
// Prompt 20 R2: the follower's OWN notification_preferences row (keyed by profile_id). followPrefsColumn "present" serves
// it on GET ?profile_id=eq.<his id> (the row below, or [] once cleared) and keeps what a POST ?on_conflict=profile_id sends;
// "absent" answers every GET naming profile_id like PostgREST before revision o (HTTP 400 42703 - the live answer seen
// 9/25) - the browser's own "status of 400" line for it is expected (followerPrefs400Lines, consumed one line each).
let followPrefsColumn = "present";
let followPrefRow = { id: "00000000-0000-4000-8000-0000000000e1", person_id: null, profile_id: FOLLOW_UID, schedule_updates_email: true, trade_updates_email: true, shift_reminders_email: false, reminder_hour_central: 20 };
let followerPrefs400Lines = 0;
const FOLLOW_FEED = [
  { id: "ff-7", type: "trade_proposed", title: "Day offered (harness)", message: "s3 offers s2 a day - nothing in return", data: { kind: "give", trade_id: FOLLOW_GIVE_ID, from_surgeon_id: "s3", to_surgeon_id: "s2" }, created_at: "2026-09-23T15:00:00Z" },
  { id: "ff-6", type: "vacation_logged", title: "Vacation logged (harness)", message: "s3 logged a vacation", data: { surgeon_id: "s3" }, created_at: "2026-09-23T14:00:00Z" },
  { id: "ff-5", type: "shift_claimed", title: "Shift taken (harness)", message: "s5 took an open shift", data: { surgeon_id: "s5" }, created_at: "2026-09-23T13:00:00Z" },
  { id: "ff-4", type: "trade_applied", title: "Trade applied (harness)", message: "s4 and s6 traded", data: { from_surgeon_id: "s4", to_surgeon_id: "s6" }, created_at: "2026-09-23T12:00:00Z" },
  { id: "ff-3", type: "shift_reminder", title: "Reminder (harness)", message: "s2 is on call tomorrow", data: { surgeon_id: "s2" }, created_at: "2026-09-23T11:00:00Z" },
  { id: "ff-2", type: "open_shifts", title: "Open shifts (harness)", message: "open slots in the next 30 days", data: {}, created_at: "2026-09-23T10:00:00Z" },
  { id: "ff-1", type: "schedule_published", title: "Schedule published (harness)", message: "the schedule was published", data: {}, created_at: "2026-09-23T09:00:00Z" },
];
// The caller's JWT sub (what auth.uid() reads server-side) - the rpc mocks decide entered_by / source from it.
const jwtSub = (req) => { try { const t = (req.headers()["authorization"] || "").replace(/^Bearer /i, ""); return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).sub || null; } catch (e) { return null; } };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".css": "text/css" };
// Every served file is read from disk ONCE per run and kept in memory: the per-protocol `git checkout -- index.html`
// after a build (or a second smoke in the same tree) must not swap the page this server is serving mid-run (B9
// review 9/24 - it did, and produced phantom pre-A3 failures). servedHits counts requests per path: the Generate
// worker's importScripts fetch rules.js a second time, which the B9a step reads as proof the worker ran.
const servedCache = new Map();
const servedHits = new Map();
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!servedCache.has(file)) {
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    servedCache.set(file, fs.readFileSync(file));
  }
  servedHits.set(rel, (servedHits.get(rel) || 0) + 1);
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(servedCache.get(file));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/`;
console.log(`static server on ${BASE} (APP_VERSION ${APP_VERSION})`);

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CDN_CACHE, { recursive: true });
const failures = [];
const fail = (m) => { failures.push(m); console.log("FAIL " + m); };
const ok = (m) => console.log("ok   " + m);
const failedRequests = [];
// ONE notion of today for the whole run: the Central date, the same expression
// the app uses (helpers.js todayCentral). Item Q (Faraz 9/22): an unassigned
// slot is OPEN only from today forward, so every pin on a specific OPEN day is
// dated - dated(until, what) runs the pin while today <= until and otherwise
// prints a note and skips it (the harness is run by hand for years).
const todayCentral = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const dated = (until, what) => { if (todayCentral <= until) return true; console.log(`     (today ${todayCentral} is after ${until} - ${what} skipped)`); return false; };

// ---- CDN cache + font stub (shared by every page in the run) ----
// Prompt 16 B8: React, ReactDOM and supabase-js are vendored (vendor/), so NO request may leave for a CDN host
// any more - every one is recorded in cdnRequests and fails the run at the end (the cache below still answers
// it, so the rest of the run stays informative). vendorRequests records what the page fetched from vendor/.
let cdnHits = 0, cdnMisses = 0;
const cdnRequests = [];
const vendorRequests = [];
const cacheKey = (url) => path.join(CDN_CACHE, crypto.createHash("sha1").update(url).digest("hex"));
const routeCdn = async (route) => {
  const req = route.request();
  const url = req.url();
  const host = new URL(url).hostname;
  if (FONT_HOSTS.includes(host)) return route.fulfill({ status: 200, contentType: "text/css", body: "/* fonts stubbed by test/ui/smoke.mjs */" });
  if (CDN_HOSTS.includes(host)) cdnRequests.push(`${req.method()} ${url}`);
  if (!CDN_HOSTS.includes(host) || req.method() !== "GET") return route.continue();
  const key = cacheKey(url);
  if (!process.env.SMOKE_NO_CACHE && fs.existsSync(key + ".body") && fs.existsSync(key + ".json")) {
    const meta = JSON.parse(fs.readFileSync(key + ".json", "utf8"));
    cdnHits++;
    return route.fulfill({ status: 200, headers: { "content-type": meta.contentType, "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fs.readFileSync(key + ".body") });
  }
  try {
    const res = await route.fetch();
    const body = await res.body();
    const contentType = res.headers()["content-type"] || "text/javascript";
    if (res.status() === 200 && body.length > 0) {
      fs.writeFileSync(key + ".body", body);
      fs.writeFileSync(key + ".json", JSON.stringify({ url, contentType, bytes: body.length, fetchedAt: new Date().toISOString() }));
      cdnMisses++;
    }
    return route.fulfill({ status: res.status(), headers: { "content-type": contentType, "access-control-allow-origin": "*" }, body });
  } catch (e) {
    failedRequests.push(`GET ${url} -> ${e && e.message || e} (CDN fetch failed and no cache entry)`);
    return route.abort();
  }
};
const cdnMatcher = (url) => CDN_HOSTS.includes(url.hostname) || FONT_HOSTS.includes(url.hostname);

// ---- Realtime websocket mock ----
// The SDK joins "realtime:silvis-schedule-sync" with 9 postgres_changes
// bindings (order = the .on() order in index-source.html; call_offers /
// call_periods joined the list in Prompt 14 part 3a, BEFORE shift_trade_requests -
// a list out of step delivers a frame to the wrong handler and datalayer-001 goes dark). The join reply
// must echo them back with ids; a later postgres_changes frame carrying one
// of those ids reaches the app's handler (onDayChange for schedule_days).
const RT_TABLES = ["call_schedule_data", "schedule_days", "time_off", "availability", "call_offers", "call_periods", "shift_trade_requests", "notifications", "client_versions"];
// Self-check: the list must equal the app's .on() order, or every injected frame lands on the wrong handler.
{
  const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
  const marker = '.on("postgres_changes", { event: "*", schema: "public", table: "';
  const appOrder = src.split(marker).slice(1).map(part => part.slice(0, part.indexOf('"')));
  if (appOrder.join(",") !== RT_TABLES.join(",")) { console.error("FAIL: RT_TABLES is out of step with index-source.html's postgres_changes order - app: " + appOrder.join(",") + " | harness: " + RT_TABLES.join(",")); process.exit(1); }
}
const rt = { ws: null, topic: null, joined: false, frames: [], arrayFormat: false, joinRef: null };
const rtDecode = (raw) => {
  const m = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  if (Array.isArray(m)) { rt.arrayFormat = true; return { join_ref: m[0], ref: m[1], topic: m[2], event: m[3], payload: m[4] }; }
  return m;
};
const rtEncode = (m) => JSON.stringify(rt.arrayFormat ? [m.join_ref ?? null, m.ref ?? null, m.topic, m.event, m.payload] : m);
const rtSend = (m) => { if (rt.ws) rt.ws.send(rtEncode(m)); };
const installRealtimeMock = async (pg) => {
  await pg.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), (ws) => {
    rt.ws = ws;
    ws.onMessage((raw) => {
      let m; try { m = rtDecode(raw); } catch (e) { return; }
      rt.frames.push(m.event);
      if (m.event === "heartbeat") return rtSend({ topic: "phoenix", event: "phx_reply", payload: { status: "ok", response: {} }, ref: m.ref });
      if (m.event === "phx_join") {
        rt.topic = m.topic; rt.joined = true; rt.joinRef = m.ref;
        const wanted = (m.payload && m.payload.config && m.payload.config.postgres_changes) || [];
        const postgres_changes = wanted.map((b, i) => ({ id: i + 1, event: b.event, schema: b.schema, table: b.table }));
        return rtSend({ topic: m.topic, event: "phx_reply", payload: { status: "ok", response: { postgres_changes } }, ref: m.ref, join_ref: m.ref });
      }
      if (m.event === "access_token" || m.event === "phx_leave") {
        return rtSend({ topic: m.topic, event: "phx_reply", payload: { status: "ok", response: {} }, ref: m.ref });
      }
    });
  });
};
// Inject one postgres_changes frame for `table` (the binding id is the table's
// position in the app's subscription list, echoed back at join).
const rtSendRow = (table, record, type) => {
  if (!rt.joined) return false;
  const id = RT_TABLES.indexOf(table) + 1;
  rtSend({
    topic: rt.topic, event: "postgres_changes", ref: null, join_ref: rt.joinRef,
    payload: { ids: [id], data: { type: type || "UPDATE", schema: "public", table, commit_timestamp: new Date().toISOString(), columns: [], record, old_record: {}, errors: null } },
  });
  return true;
};
const rtSendDayRow = (record, type) => rtSendRow("schedule_days", record, type);
const dayRow = (day, over) => ({ day, primary_id: null, backup_id: null, primary_locked: false, backup_locked: false, source: "manual", external_cover: null, note: null, version: 1, updated_by: "s4", updated_at: new Date().toISOString(), ...over });

// The importer's plan for docs/silvis-seed.json, computed once (Prompt 12 SM2): it
// serves the seed fixtures below and, in every mode, the Import dry-run / apply
// restatements - the harness's OWN reading of what the seed asks for, never the
// app's summary. The plan's rows do not depend on `now` (only the blob's
// settings.importedAt does), so one plan serves both.
const IMP = require(path.join(ROOT, "importer.js"));
const SEED_PATH = path.join(ROOT, "docs", "silvis-seed.json");
const PLAN_TS = "2026-09-22T00:00:00.000Z";
const PLAN = IMP.importPlan(JSON.parse(fs.readFileSync(SEED_PATH, "utf8")), { now: PLAN_TS });
// Prompt 14 IP (9/23): the app's Setup import plans PERIOD-AWARE like scripts/import-seed.js (offerPeriods: true, today =
// the Central date of the real now - offers are planned for days on/after today only), so the Import pins restate the
// period / offer legs from this plan; PLAN above (the legacy plan) still serves the fixtures and the schedule days.
const PLAN_P = IMP.importPlan(JSON.parse(fs.readFileSync(SEED_PATH, "utf8")), { now: new Date().toISOString(), offerPeriods: true });

// ---- Seed fixture fallback (see the header) ----
const fixture = await (async () => {
  let liveCount = null;
  try {
    const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/schedule_days?select=day&limit=1`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY, prefer: "count=exact" } });
    const cr = res.headers.get("content-range") || "";
    liveCount = res.ok ? Number(cr.split("/")[1] || "0") : null;
    if (!res.ok) console.log(`     (live schedule_days pre-check: HTTP ${res.status})`);
  } catch (e) { console.log("     (live schedule_days pre-check failed: " + (e && e.message || e) + ")"); }
  const forced = process.env.SMOKE_FIXTURE === "1";
  const want = forced || (liveCount === 0 && process.env.SMOKE_LIVE !== "1");
  if (!want) { console.log(`data source: LIVE Silvis project (schedule_days rows: ${liveCount === null ? "unknown" : liveCount})`); return null; }
  console.log(forced ? "data source: SEED FIXTURES (SMOKE_FIXTURE=1)" : "data source: SEED FIXTURES - the live schedule_days table is EMPTY; serving docs/silvis-seed.json via importer.importPlan for schedule_days / call_schedule_data / time_off / availability (east tables stay live)");
  const ts = PLAN_TS, plan = PLAN;
  return {
    // RF2 review fix: one HELD but UNLOCKED November day (an app-generated backup, the shape the published rows have)
    // inside the Generate range 11/2-11/30, so the Accept confirm's POSITIVE branch runs under the fixture: the default
    // run (fill-open-only OFF) regenerates that backup and Accept must name it. The importer ignores an app-generated
    // row the seed lacks (planDiff: source != import and not in the plan), so the Import pins are unaffected.
    schedule_days: plan.scheduleDayRows.map(r => ({ ...r, version: 1, updated_at: ts })).concat([{ day: "2026-11-19", primary_id: null, backup_id: "s2", primary_locked: false, backup_locked: false, source: "generated", external_cover: null, note: null, version: 1, updated_by: "fixture", updated_at: ts }]),
    call_schedule_data: [{ id: "main", data: plan.blob, updated_by: "seed", updated_at: ts }],
    time_off: plan.timeOffRows.map((r, i) => ({ id: "fixture-timeoff-" + (i + 1), ...r, created_at: ts })),
    availability: plan.availabilityRows.map((r, i) => ({ id: "fixture-avail-" + (i + 1), ...r, created_at: ts })),
  };
})();
// ---- The live rows, read once up front (anon) ----
// Every OPEN expectation below (the 10/15 cell, the week rows, the ER panel, Copy for Word, the mobile pill) derives
// from these rows, never from a dated constant that encodes one day's table (the 9/23 overnight publish filled the
// October backups and all of 11/2-1/3). In fixture mode they ARE the fixture rows. updated_by rides along for the
// importer's seed-ownership rule (Import dry run / apply pins).
const IMPORTER = require(path.join(ROOT, "importer.js"));
const liveRowsEarly = await (async () => {
  if (fixture) return fixture.schedule_days.map(r => ({ ...r }));
  try {
    const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/schedule_days?select=day,primary_id,backup_id,primary_locked,backup_locked,source,external_cover,note,updated_by&order=day.asc`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("body is not an array");
    return rows;
  } catch (e) { console.log("     (live schedule_days read up front failed: " + (e && e.message || e) + " - the OPEN expectations treat every day as open)"); return []; }
})();
const liveEarlyByDay = {}; liveRowsEarly.forEach(r => { liveEarlyByDay[r.day] = r; });
// the app's holder rule: an external cover stands in for a primary; a day with no row is open in both roles
const liveOpenEarly = (d, role) => { const r = liveEarlyByDay[d]; return role === "primary" ? !(r && (r.primary_id || r.external_cover)) : !(r && r.backup_id); };
const isoPlus = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);
// the first open slot (today or later - the app's OPEN rule) between two ISO days inclusive, else null
const liveOpenBetween = (from, to) => { for (let d = from < todayCentral ? todayCentral : from; d <= to; d = isoPlus(d, 1)) if (liveOpenEarly(d, "primary") || liveOpenEarly(d, "backup")) return d; return null; };
// LIVE mode only: the slot the harness opens for the claim scenario (the search after the first load). The GET
// overlay blanks it in every schedule_days answer and liveRowsEarly (hence liveRows / liveByDay) carries the blank
// too, so every pin derived from the live rows sees the same table the app does. Empty in fixture mode and when no
// candidate is claimable.
const harnessOpen = { day: null, role: null };
const fixtureHasDay = (d) => !!(fixture && fixture.schedule_days.some(r => r.day === d));
// PostgREST-shaped answer for a fixture table GET (honours eq. filters); null = not a fixture table.
const fixtureAnswer = (url) => {
  if (!fixture) return null;
  const t = url.pathname.replace(/^\/rest\/v1\//, "");
  if (!Object.prototype.hasOwnProperty.call(fixture, t)) return null;
  let rows = fixture[t];
  for (const [k, v] of url.searchParams) {
    const m = /^eq\.(.*)$/.exec(v);
    if (!m || k === "select" || k === "order" || k === "limit" || k === "offset") continue;
    rows = rows.filter(r => String(r[k]) === m[1]);
  }
  return rows;
};

const browser = await chromium.launch({ headless: !process.env.HEADFUL });
const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
await context.addInitScript(({ token, version }) => {
  try {
    localStorage.setItem("silvis-auth-token", token);
    localStorage.setItem("silvis-auth-refresh", "fake-refresh");
    localStorage.setItem("silvis-app-version", version); // no version-mismatch reload loop
  } catch (e) {}
}, { token: FAKE_JWT, version: APP_VERSION });
// Prompt 16 B8: every document in the run (the app, the share page, the printable popup - which inherits the
// opener's policy) records its CSP violations; a violation is also a console error, which fails the run.
await context.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    const line = `${e.violatedDirective} blocked ${e.blockedURI || "inline"} at ${e.sourceFile || location.href}:${e.lineNumber || 0}`;
    window.__cspViolations.push(line);
    console.error("CSP violation: " + line);
  });
});
await context.route(cdnMatcher, routeCdn);
// Davenport (East) project: answered from the canned week + roster blob above (GET only, like the app). A named
// handler: the A3 session scenario runs in a second BrowserContext that needs the same answers.
const routeEast = async (route) => {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  if (route.request().method() !== "GET") return route.fulfill({ status: 405, contentType: "application/json", body: "[]" });
  if (url.pathname.startsWith("/rest/v1/schedule_weeks")) return json([EAST_WEEK]);
  if (url.pathname.startsWith("/rest/v1/call_schedule_data")) return json([{ id: "main", data: EAST_BLOB }]);
  // Prompt 15: the Davenport time_off read (kind vacation, FAK = s6 there) answers the same three ranges the
  // harness overlays on the cache, so a Refresh keeps every review (nothing changed, nothing removed).
  if (url.pathname.startsWith("/rest/v1/time_off")) return json(eastVacFeed.map((r, i) => ({ id: "dav-timeoff-" + (i + 1), person_id: "s6", kind: "vacation", start_date: r.start, end_date: r.end })));
  return json([]);
};
await context.route((url) => url.hostname === EAST_HOST, routeEast);
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const consoleWarns = [];
const writes = [];
const tradeStore = []; // Slice G: shift_trade_requests rows the app wrote this run (see the Supabase route)
const tradeGets = [];  // datalayer-001: every GET on shift_trade_requests with the Authorization it carried
const offerGets = [];  // U3c review: every GET on call_offers / call_periods ({ table, auth, at }) - the stale-offers step watches the re-read
const forcedConsoleErrors = []; // the browser's own "500" line for the snapshot insert the harness forced to fail
const watchPage = (pg, tag) => {
  pg.on("pageerror", (e) => pageErrors.push(`${tag}: ` + String(e && e.message || e)));
  pg.on("console", (msg) => {
    if (msg.type() === "error") {
      if (failSnapshotInsert && /status of 500/.test(msg.text())) forcedConsoleErrors.push(msg.text());
      else if (forcedOffer400 && /status of 400/.test(msg.text())) { forcedConsoleErrors.push(msg.text()); forcedOffer400 = false; } // the forced OF002 answer of rpc/save_offers (offer painter)
      else if (abortEastFeedPost && /ERR_FAILED|Failed to fetch|Failed to load resource/.test(msg.text())) forcedConsoleErrors.push(msg.text()); // the east_feed POST the harness aborted
      else if (expiredWrites401 && /status of (401|400)|Save failed: Error: blob save failed: .*JWT expired/.test(msg.text())) forcedConsoleErrors.push(msg.text()); // Prompt 16 A3: the 401s of the expired-bearer writes, the 400 of the rejected refresh and the blob leg's own console.error for that 401 - all forced by the harness
      else if (b7DeadLinkStatusLines > 0 && /status of (401|400)/.test(msg.text())) { forcedConsoleErrors.push(msg.text()); b7DeadLinkStatusLines--; } // Prompt 16 B7: the dead link's probe (401) and its refresh (400), answered by the B7 route
      else if (followerPrefs400Lines > 0 && /status of 400/.test(msg.text())) { forcedConsoleErrors.push(msg.text()); followerPrefs400Lines--; } // Prompt 20 R2: the follower's prefs read before revision o (42703), answered by the follower route
      else consoleErrors.push(msg.text());
    }
    if (msg.type() === "warning") consoleWarns.push(msg.text());
  });
  pg.on("requestfailed", (r) => { if (abortEastFeedPost && /\/rest\/v1\/east_feed/.test(r.url())) return; failedRequests.push(`${tag}: ${r.method()} ${r.url()} -> ${(r.failure() || {}).errorText || "failed"}`); });
  pg.on("request", (r) => { if (/\/vendor\//.test(r.url())) vendorRequests.push(`${tag}: ${r.url()}`); });
};
watchPage(page, "main");
await installRealtimeMock(page);

// PostgREST-shaped answers for the writes we record: a schedule_days POST /
// PATCH with Prefer: return=representation gets its own body back (so the
// CAS path sees a version, exactly like the real table), everything else [].
const representation = (method, url, body) => {
  // The seed import's blob merge PATCHes call_schedule_data?id=eq.main and
  // treats zero returned rows as "no row updated" - echo the body like PostgREST.
  // Slice G: time_off / notifications / audit_log inserts are adopted from the
  // returned representation (db.insert returns data:null on an empty body and
  // the app treats that as a failed write, exactly as it should), so those
  // POSTs echo the row with a generated id. shift_trade_requests and
  // rpc/apply_trade are served by the tradeStore branch of the route above.
  const rowTables = ["/rest/v1/time_off", "/rest/v1/notifications", "/rest/v1/audit_log"];
  if (method === "POST" && rowTables.some(t => url.pathname.startsWith(t))) {
    try {
      const b = JSON.parse(body || "{}");
      const stamp = (r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r });
      return Array.isArray(b) ? b.map(stamp) : [stamp(b)];
    } catch (e) { return []; }
  }
  // Prompt 12 C.2 (fix round 9/22, finding 4): the east_forecast prune DELETE answers
  // ONE fake row, so the East refresh assertion proves the app COUNTS the returned
  // representation (a hard-coded 0 would fail).
  if (method === "DELETE" && url.pathname.startsWith("/rest/v1/east_forecast")) return [{ week_monday: "2026-10-05" }];
  const echoes = url.pathname.startsWith("/rest/v1/schedule_days") || (method === "PATCH" && url.pathname.startsWith("/rest/v1/call_schedule_data"));
  if (!echoes) return [];
  try {
    const b = JSON.parse(body || "{}");
    return Array.isArray(b) ? b : [b];
  } catch (e) { return []; }
};
// Prompt 11: the snapshot table is served from THIS store (RLS hides it from
// the anon passthrough). Every snapshot the app POSTs is kept WITH its data, so
// the restore scenario replays exactly what the app captured before the reset.
const snapStore = [];
let minVersionOverride = null; // Prompt 11: { min_version, message } served for client_versions row 'main'
let cvExtrasFixture = false;   // Item 5a (9/24): the Client versions listing carries a heartbeat row for the office + viewer accounts and user_profiles carries all three mocked profiles
// Prompt 20 F2: Setup > Users' Follows. null = off; "present" = user_profiles serves the admin, the office account, a
// follower (viewer) and a linked surgeon, each with a follows column (the follower's kept in followsStore, which the
// PATCH updates); "absent" = the same rows without the column (before revision o). A GET with ?id=eq. answers that row.
let followsFixture = null;
const followsStore = {};
const FOLLOWER_UID = "00000000-0000-4000-8000-0000000000f1", F2_SURGEON_UID = "00000000-0000-4000-8000-0000000000f2";
const followsFixtureRows = () => {
  const rows = [FAKE_PROFILE, COORD_PROFILE,
    { id: FOLLOWER_UID, person_id: null, role: "viewer", display_name: "Follower (harness)", email: null, created_at: "2026-09-24T00:00:00Z" },
    { id: F2_SURGEON_UID, person_id: "s3", role: "surgeon", display_name: "Surgeon (harness)", email: null, created_at: "2026-09-24T00:00:00Z" }];
  return followsFixture === "present" ? rows.map(r => ({ ...r, follows: followsStore[r.id] || [] })) : rows;
};
let emptyDaysFor = null, emptyDaysServed = 0; // Prompt 16 B9 (h): the page whose NEXT schedule_days GET answers 200 + [] (an RLS-filtered / dead-token read)
// Prompt 11 (factory reset): once the app's DELETE of every schedule_days row is
// recorded, the table reads as EMPTY from then on and later CAS POSTs / PATCHes
// land in this store - what the real table would do - so the restore that
// follows writes every day back and the 60 s poll cannot resurrect live rows.
let daysWiped = false;
const dayStore = {};
// Prompt 13 part 3 (the Open shifts board): rpc/claim_open_slot is answered
// like the SQL function would - the write is recorded, the mocked day row takes
// the claimer (s1) so the app's refetch shows it, and the function's success
// JSON comes back. A second claim of the same slot is refused with the
// function's own CLAIM_HELD token so the verbatim-message path can be seen.
const claimedDays = {}; // day -> { primary_id? , backup_id?, source, updated_by, updated_at } overlaid on every schedule_days GET
// The schedule_days rows a GET is answered with while an overlay is active: the fixture or the live rows, a claimed day
// read back with the claimer (version + 1, what the function's UPDATE leaves) and the harness-opened slot blank. Shared
// by the route below and (Prompt 19 S5) the give receiver's session, which lays the applied give on top.
const scheduleDayRows = async (route, req, url) => {
  let rows = fixtureAnswer(url);
  if (!rows) {
    const res = await route.fetch({ headers: { ...req.headers(), authorization: "Bearer " + ANON_KEY } });
    rows = await res.json().catch(() => []);
  }
  const overlay = (r) => {
    let o = r;
    if (harnessOpen.day && r.day === harnessOpen.day) o = { ...o, [harnessOpen.role === "primary" ? "primary_id" : "backup_id"]: null };
    if (claimedDays[r.day]) o = { ...o, ...claimedDays[r.day], version: (Number(r.version) || 0) + 1 };
    return o;
  };
  return (Array.isArray(rows) ? rows : []).map(overlay);
};
let schedFeed = null; // Prompt 19 S5: { page, rows } - the notifications feed served to the scheduler's page during the give check
// Prompt 14 part 3a (the offer painter): call_offers / call_periods are authenticated-only tables, so the anon
// passthrough would answer [] - the harness serves them: ONE period (the seed's first offerPeriods entry with a
// fake uuid; s1 is on its rulesOnly list, exactly as the seed says) served OPEN - status 'upcoming' whatever the
// seed's lifecycle status reads (PD 9/23: the seed marks it published after the 9/23 publish; the painter, mode and
// Periods steps below exercise the open-period UI, the lifecycle belongs to the live row) - and an offer store seeded with one OTHER
// surgeon's row (so "1 other offered" can be seen). rpc/save_offers and rpc/set_offer_mode are answered like the
// SQL functions would (validation tokens included); every call is recorded in writes. failSaveOffers makes the
// next save_offers answer a 400 with the OF002 vacation token (the "nothing was saved" path).
const offerPeriod = (() => {
  const p = (JSON.parse(fs.readFileSync(SEED_PATH, "utf8")).offerPeriods || [])[0];
  return p ? { id: "00000000-0000-4000-8000-00000000a0f1", label: p.label, start_day: p.start, end_day: p.end, offers_close_at: p.offersCloseAt, publish_by: p.publishBy, status: "upcoming", rules_only_ids: (p.rulesOnly || []).slice(), offer_modes: { ...(p.offerModes || {}) }, created_by: "harness", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" } : null;
})();
const periodStore = offerPeriod ? [offerPeriod] : []; // Prompt 14 part 3b (U3b): GET call_periods serves this list; the Periods section's POST / PATCH move it (route below)
const OTHER_OFFER_DAY = "2026-10-14";
// Prompt 14 part 3c (U3c): two offers INSIDE the seed period so the day editor has labels to read - s3 (Acton,
// 'preferred' per the seed's offerModes) on the first in-period day on/after today that he HOLDS in the live rows
// (in his role there, so the My-offers pill reads "(placed)" and the upcoming row carries the "offered" chip; the
// fallback when he holds none - fixture mode, a wiped table - is start + 8 as primary), and s4 (Philip,
// 'exhaustive') 'either' on the SAME day. On the day after, s3 reads "not offered - preferred days: penalty" and s4
// "not offered - only these days: ineligible" (the editor greys him with the hard not-offered). s4 is thereby
// submitted / exhaustive for the whole period in the harness: no later step needs him eligible inside it (the
// Periods "Generate this period" step asserts the range and the absence of writes, never coverage).
const U3C = (() => {
  if (!offerPeriod) return null;
  const from = offerPeriod.start_day > todayCentral ? offerPeriod.start_day : todayCentral;
  let day = null, role = "primary";
  for (let d = from; d <= offerPeriod.end_day && !day; d = isoPlus(d, 1)) { const r = liveEarlyByDay[d]; if (r && r.primary_id === "s3") { day = d; role = "primary"; } else if (r && r.backup_id === "s3") { day = d; role = "backup"; } }
  const heldEarly = !!day;
  if (!day) day = isoPlus(offerPeriod.start_day, 8) <= offerPeriod.end_day ? isoPlus(offerPeriod.start_day, 8) : offerPeriod.start_day;
  // the "day after": the first later in-period day with a slot that is NOT locked in the live rows (a locked slot
  // puts 'slot-locked:<id>' first for everyone and the option text shows hard[0] only) - primary preferred
  let next = null, nextRole = "primary";
  for (let d = isoPlus(day, 1); d <= offerPeriod.end_day && !next; d = isoPlus(d, 1)) {
    const r = liveEarlyByDay[d];
    if (!r || !r.primary_locked) { next = d; nextRole = "primary"; } else if (!r.backup_locked) { next = d; nextRole = "backup"; }
  }
  // U3c review fix (minor 4): a THIRD offer of s3's on a later in-period day he holds, in the OTHER role than the one
  // he holds there - My schedule's row must read "offered P only" / "offered B only" (kind other-role), never
  // "not offered". null when he holds no second in-period day in the live rows (the step logs a skip).
  let other = null;
  for (let d = isoPlus(day, 1); d <= offerPeriod.end_day && !other; d = isoPlus(d, 1)) {
    const r = liveEarlyByDay[d];
    if (r && r.primary_id === "s3") other = { day: d, heldRole: "primary", offeredRole: "backup" };
    else if (r && r.backup_id === "s3") other = { day: d, heldRole: "backup", offeredRole: "primary" };
  }
  return { day, role, heldEarly, next, nextRole, other };
})();
const offerStore = [{ id: crypto.randomUUID(), person_id: "s2", day: OTHER_OFFER_DAY, role_pref: "either", note: null, entered_by: "s2", source: "app", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" }]
  .concat(U3C ? [
    { id: crypto.randomUUID(), person_id: "s3", day: U3C.day, role_pref: U3C.role, note: null, entered_by: "s3", source: "app", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" },
    { id: crypto.randomUUID(), person_id: "s4", day: U3C.day, role_pref: "either", note: null, entered_by: "scheduler", source: "email-relay", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" },
  ] : [])
  .concat(U3C && U3C.other ? [
    { id: crypto.randomUUID(), person_id: "s3", day: U3C.other.day, role_pref: U3C.other.offeredRole, note: null, entered_by: "s3", source: "app", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" },
  ] : []);
let failSaveOffers = false;
// applyOfferMode(who, periodId, mode) mirrors set_offer_mode: { code, message } on a refusal, { ok } after the write.
// save_offers calls it for p_mode inside its "transaction" (the store is mutated only after every check passed, so a
// refused mode leaves the rows untouched - the SQL's rollback, in miniature).
const applyOfferMode = (who, periodId, mode) => {
  if (!["exhaustive", "preferred", "rules_only"].includes(mode)) return { code: "OM003", message: `MODE_BAD_MODE: mode must be exhaustive, preferred or rules_only (got ${mode || "null"})` };
  if (!offerPeriod || periodId !== offerPeriod.id) return { code: "OM004", message: `MODE_NO_PERIOD: no period ${periodId || "null"} on file` };
  if (mode === "rules_only") {
    const n = offerStore.filter(o => o.person_id === who && o.day >= offerPeriod.start_day && o.day <= offerPeriod.end_day).length;
    if (n) return { code: "OM006", message: `MODE_HAS_OFFERS: ${who} has ${n} offered day(s) inside ${offerPeriod.label} - clear them first to go by the rules` };
    if (!offerPeriod.rules_only_ids.includes(who)) offerPeriod.rules_only_ids.push(who);
    delete offerPeriod.offer_modes[who];
  } else {
    offerPeriod.rules_only_ids = offerPeriod.rules_only_ids.filter(x => x !== who);
    offerPeriod.offer_modes[who] = mode;
  }
  offerPeriod.updated_at = new Date().toISOString();
  return { ok: true };
};
const offerRpc = (b, json, sub) => {
  const err = (code, message) => json(400, { message, code, details: null, hint: null });
  const who = String(b.p_person || "s1");
  const asOffice = sub === COORD_UID; // Prompt 16 A7: a coordinator relaying -> entered_by = its profile id, source office-relay
  if (failSaveOffers) { failSaveOffers = false; forcedOffer400 = true; return err("OF002", `OFFER_ON_VACATION: ${((b.p_rows || [])[0] || {}).day || "?"} is inside a vacation of ${who}`); }
  const rows = Array.isArray(b.p_rows) ? b.p_rows : [];
  const bad = rows.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(String(r && r.day)) || !["primary", "backup", "either"].includes(r && r.role_pref));
  if (bad.length) return err("OS003", `OFFERS_BAD_ROW: ${bad.map(r => (r.day || "null") + " " + (r.role_pref || "null")).join(", ")} (day must be YYYY-MM-DD, role_pref primary / backup / either) - nothing was saved`);
  // the mode's checks run before the store moves (a refused mode = nothing written, like the SQL rollback)
  const modeCheck = b.p_mode !== null && b.p_mode !== undefined ? applyOfferMode(who, b.p_period, b.p_mode) : { ok: true };
  if (modeCheck.code) return err(modeCheck.code, modeCheck.message);
  const clear = new Set(Array.isArray(b.p_clear) ? b.p_clear : []);
  let deleted = 0;
  for (let i = offerStore.length - 1; i >= 0; i--) if (offerStore[i].person_id === who && clear.has(offerStore[i].day)) { offerStore.splice(i, 1); deleted++; }
  const by = asOffice ? COORD_UID : who === "s1" ? "s1" : "scheduler", src = asOffice ? "office-relay" : who === "s1" ? "app" : "email-relay";
  rows.forEach(r => {
    const cur = offerStore.find(o => o.person_id === who && o.day === r.day);
    if (cur) Object.assign(cur, { role_pref: r.role_pref, note: r.note || cur.note || null, entered_by: by, source: src, updated_at: new Date().toISOString() }); // coalesce(excluded.note, call_offers.note)
    else offerStore.push({ id: crypto.randomUUID(), person_id: who, day: r.day, role_pref: r.role_pref, note: r.note || null, entered_by: by, source: src, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  });
  return json(200, { ok: true, person_id: who, upserted: rows.length, deleted, entered_by: by, source: src, mode: b.p_mode === undefined ? null : b.p_mode });
};
const offerModeRpc = (b, json) => {
  const who = String(b.p_person || "s1");
  const r = applyOfferMode(who, b.p_period, b.p_mode);
  if (r.code) return json(400, { message: r.message, code: r.code, details: null, hint: null });
  return json(200, { ok: true, period_id: offerPeriod.id, label: offerPeriod.label, person_id: who, mode: b.p_mode, rules_only_ids: offerPeriod.rules_only_ids, offer_modes: offerPeriod.offer_modes, by: "s1" });
};
// Prompt 16 A7: the same route for ANOTHER session - the auth user and the own profile row come from `profile`, every
// other request goes through routeSupabase unchanged (the shared stores, the recorded writes).
// B3: an optional `extra({ route, req, url, json })` runs before the shared route and answers `true` when it fulfilled
// the request (the viewer session serves its own notifications feed that way); `profile.authEmail` is the auth user's
// address for that session (never part of the profile row the app reads).
// Prompt 19 S3: the scheduler lookup (schedulerIdsLoud: user_profiles?select=person_id,role&role=in.(scheduler,admin)...)
// answers the scheduler-linked rows like the real table does (the harness's admin, s1) - not the session's own row.
const routeSupabaseAs = (profile, extra) => async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  const { authEmail, ...row } = profile;
  if (url.pathname.startsWith("/auth/v1/user") && req.method() === "GET") return json(200, { id: profile.id, email: authEmail || "office@example.com", aud: "authenticated", role: "authenticated" });
  if (url.pathname.startsWith("/rest/v1/user_profiles") && req.method() === "GET") return json(200, /role=in\./.test(url.search) ? [{ person_id: FAKE_PROFILE.person_id, role: FAKE_PROFILE.role }] : [row]);
  if (extra && await extra({ route, req, url, json })) return;
  return routeSupabase(route);
};
const routeSupabase = async (route, scope) => {
  // scope: "session" when installed by the A3 session scenario's context (its blob stamp is kept apart); Playwright
  // passes the Request as the second argument when the handler is registered bare, which reads as the main scope.
  const sessionScope = scope === "session";
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  if (url.pathname.startsWith("/auth/v1/user") && method === "GET") {
    return json(200, { id: FAKE_UID, email: FAKE_EMAIL, aud: "authenticated", role: "authenticated" });
  }
  // Prompt 16 A3: the GoTrue token endpoint. grant_type=password answers the sign-in pair (NEW_JWT); grant_type=
  // refresh_token answers the granted pair (authRefreshGrant) or the real rejection shape (400 invalid_grant). Only
  // the grant type and the refresh token are recorded - never a password.
  if (url.pathname.startsWith("/auth/v1/token") && method === "POST") {
    const grant = url.searchParams.get("grant_type") || "";
    let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch (e) { b = {}; }
    authCalls.push({ grant, refresh: grant === "refresh_token" ? (b.refresh_token || null) : undefined, at: Date.now() });
    const user = { id: FAKE_UID, email: FAKE_EMAIL, aud: "authenticated", role: "authenticated" };
    if (grant === "password") return json(200, { access_token: NEW_JWT, refresh_token: "fake-refresh-2", token_type: "bearer", expires_in: 3600, user });
    if (grant === "refresh_token") {
      if (authRefreshGrant) return json(200, { access_token: authRefreshGrant, refresh_token: "fake-refresh-3", token_type: "bearer", expires_in: 3600, user });
      return json(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" });
    }
    return json(400, { error: "unsupported_grant_type" });
  }
  // Prompt 16 A3: while armed, a write carrying an expired bearer is answered like PostgREST answers it (401 PGRST301) -
  // recorded with forced401 so the scenario can count the writes that were refused.
  if (expiredWrites401 && method !== "GET" && method !== "OPTIONS" && (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/functions/v1/")) && bearerExpired(req.headers()["authorization"])) {
    writes.push({ method, path: url.pathname + url.search, body: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? "(snapshot body omitted)" : (req.postData() || ""), prefer: req.headers()["prefer"] || "", auth: req.headers()["authorization"] || "", at: Date.now(), forced401: true });
    return json(401, { code: "PGRST301", message: "JWT expired", details: null, hint: null });
  }
  if (url.pathname.startsWith("/rest/v1/user_profiles")) {
    const idEq = (url.searchParams.get("id") || "").replace(/^eq\./, "");
    if (method === "GET" && followsFixture) { const rows = followsFixtureRows(); return json(200, idEq ? rows.filter(r => r.id === idEq) : rows); }
    if (method === "GET") { const { authEmail, ...viewerRow } = VIEWER_PROFILE; return json(200, cvExtrasFixture ? [FAKE_PROFILE, COORD_PROFILE, viewerRow] : [FAKE_PROFILE]); }
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    // A PATCH with Prefer: return=representation answers the merged row, like
    // PostgREST does for a row the caller may update (Slice E Users card).
    // Prompt 20 F2: while followsFixture is armed the PATCH answers the row it names (?id=eq.<uuid>) and keeps a follows
    // list; with the column "absent" a PATCH naming follows gets PostgREST's missing-column answer (400 PGRST204).
    if (method === "PATCH" && followsFixture) {
      let patch = {}; try { patch = JSON.parse(body); } catch (e) {}
      const base = followsFixtureRows().find(r => r.id === idEq);
      if (!base) return json(200, []);
      if (followsFixture === "absent" && "follows" in patch) return json(400, { code: "PGRST204", message: "Could not find the 'follows' column of 'user_profiles' in the schema cache", details: null, hint: null });
      if (Array.isArray(patch.follows)) followsStore[idEq] = patch.follows;
      return json(200, [{ ...base, ...patch }]);
    }
    if (method === "PATCH") { let patch = {}; try { patch = JSON.parse(body); } catch (e) {} return json(200, [{ ...FAKE_PROFILE, ...patch }]); }
    return json(method === "POST" ? 201 : 200, []);
  }
  // Slice G: shift_trade_requests is readable by AUTHENTICATED users only, so the
  // anon passthrough would answer 200 + [] and wipe the list on every refresh.
  // The harness keeps the rows the app writes (POST -> row with id, PATCH ->
  // merged row, rpc/apply_trade -> status applied, exactly what the function
  // does) and serves them on GET - the authenticated picture, recorded.
  if (url.pathname.startsWith("/rest/v1/shift_trade_requests") || url.pathname === "/rest/v1/rpc/apply_trade") {
    if (method === "GET") { tradeGets.push({ auth: req.headers()["authorization"] || "", at: Date.now() }); return json(200, tradeStore.slice().sort((a, b) => a.submitted_at < b.submitted_at ? 1 : -1)); }
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    if (url.pathname === "/rest/v1/rpc/apply_trade") {
      const row = tradeStore.find(r => r.id === b.p_trade_id);
      if (!row) return json(400, { message: "TRADE_NOT_FOUND", code: "P0001" });
      if (row.status !== "accepted") return json(400, { message: "TRADE_NOT_ACCEPTED: status is " + row.status, code: "P0001" });
      row.status = "applied"; row.decided_at = row.decided_at || new Date().toISOString();
      return json(200, { ok: true, trade_id: row.id, day: row.day, role: row.role, return_day: row.return_day, return_role: row.return_role });
    }
    if (method === "POST") { const row = { id: crypto.randomUUID(), submitted_at: new Date().toISOString(), ...b }; tradeStore.push(row); return json(201, [row]); }
    if (method === "PATCH") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const row = tradeStore.find(r => r.id === id);
      if (!row) return json(200, []);
      Object.assign(row, b);
      return json(200, [row]);
    }
    return json(200, []);
  }
  if (url.pathname === "/rest/v1/rpc/claim_open_slot") {
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    if (b.p_role !== "primary" && b.p_role !== "backup") return json(400, { message: "CLAIM_BAD_ROLE: role must be primary or backup (got " + (b.p_role || "null") + ")", code: "CL002", details: null, hint: null });
    const col = b.p_role === "primary" ? "primary_id" : "backup_id";
    const cur = claimedDays[b.p_day] || {};
    if (cur[col]) return json(400, { message: `CLAIM_HELD: ${b.p_day} ${b.p_role} is already held by ${cur[col]}`, code: "CL005", details: null, hint: null });
    claimedDays[b.p_day] = { ...cur, [col]: "s1", source: "claim", updated_by: "s1", updated_at: new Date().toISOString() };
    return json(200, { ok: true, day: b.p_day, role: b.p_role, person_id: "s1", version: 2 });
  }
  // Prompt 15 part 3: east_vacation_reviews is authenticated-read only (an anon passthrough would answer
  // 200 + [] and every range would read as unreviewed), so the harness serves the store: GET = the rows,
  // POST ?on_conflict=person_id,start,end = upsert (the representation is the merged row, like PostgREST),
  // DELETE ?person_id=eq.&start=eq.&end=eq. = the removed rows as the representation. Writes are recorded.
  if (url.pathname.startsWith("/rest/v1/east_vacation_reviews")) {
    if (method === "GET") return json(200, eastVacReviewStore.slice().sort((a, b) => a.start < b.start ? -1 : 1));
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    const q = (k) => (url.searchParams.get(k) || "").replace(/^eq\./, "");
    if (method === "POST") {
      let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
      const rows = (Array.isArray(b) ? b : [b]).map(r => {
        const i = eastVacReviewStore.findIndex(x => x.person_id === r.person_id && x.start === r.start && x.end === r.end);
        if (i >= 0 && /merge-duplicates/.test(req.headers()["prefer"] || "")) { Object.assign(eastVacReviewStore[i], r); return eastVacReviewStore[i]; }
        if (i >= 0) return null; // a duplicate without merge-duplicates would be a 409 in PostgREST
        const row = { id: crypto.randomUUID(), decided_at: new Date().toISOString(), ...r }; eastVacReviewStore.push(row); return row;
      });
      if (rows.some(r => r === null)) return json(409, { code: "23505", message: "duplicate key value violates unique constraint east_vacation_reviews_person_id_start_end_key" });
      return json(201, rows);
    }
    if (method === "DELETE") {
      const gone = eastVacReviewStore.filter(x => (!q("person_id") || x.person_id === q("person_id")) && (!q("start") || x.start === q("start")) && (!q("end") || x.end === q("end")));
      gone.forEach(g => eastVacReviewStore.splice(eastVacReviewStore.indexOf(g), 1));
      return json(200, gone);
    }
    return json(200, []);
  }
  // Prompt 14 part 3a: offers + periods (authenticated-only; served from the harness store) and the two RPCs.
  // Part 3b (U3b): call_periods is a store the Periods section moves - POST answers the new row (201 + [row] under
  // Prefer: return=representation, the unique start_day and the two checks refused like PostgREST), PATCH
  // ?id=eq.<id>&status=eq.upcoming merges only when the row still matches (the compare-and-swap: [] otherwise).
  if (url.pathname.startsWith("/rest/v1/call_periods")) {
    if (method === "GET") { offerGets.push({ table: "call_periods", auth: req.headers()["authorization"] || "", at: Date.now() }); return json(200, periodStore.slice().sort((a, b) => a.start_day < b.start_day ? -1 : 1)); }
    const body = req.postData() || "";
    const prefer = req.headers()["prefer"] || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer });
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    if (method === "POST") {
      if (periodStore.some(p => p.start_day === b.start_day)) return json(409, { message: "duplicate key value violates unique constraint \"call_periods_start_idx\"", code: "23505", details: null, hint: null });
      if (!(typeof b.end_day === "string" && b.end_day >= b.start_day) || !(typeof b.offers_close_at === "string" && b.offers_close_at <= b.start_day)) return json(400, { message: "new row for relation \"call_periods\" violates check constraint", code: "23514", details: null, hint: null });
      const row = { id: crypto.randomUUID(), status: "upcoming", rules_only_ids: [], offer_modes: {}, created_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...b };
      periodStore.push(row);
      return json(201, /return=representation/.test(prefer) ? [row] : []);
    }
    if (method === "PATCH") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      const st = (url.searchParams.get("status") || "").replace(/^eq\./, "");
      const row = periodStore.find(p => p.id === id && (!st || p.status === st));
      if (!row) return json(200, []);
      Object.assign(row, b);
      return json(200, /return=representation/.test(prefer) ? [row] : []);
    }
    return json(200, []);
  }
  if (method === "GET" && url.pathname.startsWith("/rest/v1/call_offers")) { offerGets.push({ table: "call_offers", auth: req.headers()["authorization"] || "", at: Date.now() }); return json(200, offerStore.slice().sort((a, b) => a.day < b.day ? -1 : 1)); }
  // Part 3b: the Periods "Remind" e-mail is answered like the deployed function would (sent = the targets), so the
  // happy path ("reminded <time>") is what the section shows; every other category keeps the generic 201 + [] below.
  if (method === "POST" && url.pathname === "/functions/v1/send-notification") {
    const body = req.postData() || "";
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    if (b && b.type === "offers_reminder") {
      writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
      const ids = Array.isArray(b.targetIds) ? b.targetIds.map(String) : [];
      return json(200, { sent: ids.length, failed: 0, skipped_no_email: 0, skipped_pref_off: 0, results: ids.map(id => ({ person_id: id, status: "sent" })) });
    }
  }
  if (url.pathname === "/rest/v1/rpc/save_offers" || url.pathname === "/rest/v1/rpc/set_offer_mode") {
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    return url.pathname.endsWith("save_offers") ? offerRpc(b, json, jwtSub(req)) : offerModeRpc(b, json);
  }
  if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
    const body = req.postData() || "";
    // Harness switch (Slice E): make the snapshot insert FAIL so the
    // snapshot-before-destructive contract can be asserted (nothing may be
    // written when the capture fails). The attempt is still recorded.
    if (failSnapshotInsert && method === "POST" && url.pathname.startsWith("/rest/v1/call_schedule_snapshots")) {
      writes.push({ method, path: url.pathname + url.search, body: "(snapshot body omitted)", prefer: req.headers()["prefer"] || "", forcedFail: true });
      return json(500, { message: "harness: snapshot insert forced to fail" });
    }
    // Harness switch (fix round 2, safe-1 / wire-2): the east_feed upsert dies at
    // the network level (a rejected fetch, not an HTTP error) - the app must
    // warn + toast and leave the cache alone. The attempt is still recorded.
    if (abortEastFeedPost && method === "POST" && url.pathname.startsWith("/rest/v1/east_feed")) {
      writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "", aborted: true });
      return route.abort("failed");
    }
    // RF2 b harness switch: the write is recorded when it ARRIVES (so the step can see the sync start) and answered
    // only after the delay - the app's CAS loop stays unresolved that long, which is what the keepalive flush must see.
    if (delayScheduleWriteMs > 0 && url.pathname.startsWith("/rest/v1/schedule_days") && (method === "POST" || method === "PATCH")) {
      writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "", delayedMs: delayScheduleWriteMs });
      await new Promise(r => setTimeout(r, delayScheduleWriteMs));
      return json(method === "POST" ? 201 : 200, representation(method, url, body));
    }
    if (method === "DELETE" && url.pathname + url.search === "/rest/v1/schedule_days?day=not.is.null") { daysWiped = true; Object.keys(dayStore).forEach(k => delete dayStore[k]); }
    if (daysWiped && url.pathname === "/rest/v1/schedule_days" && method === "POST") { try { const b = JSON.parse(body); if (b && b.day) dayStore[b.day] = { ...b }; } catch (e) {} }
    if (daysWiped && url.pathname === "/rest/v1/schedule_days" && method === "PATCH") { try { const b = JSON.parse(body); const d = (url.searchParams.get("day") || "").replace(/^eq\./, ""); if (dayStore[d]) Object.assign(dayStore[d], b); } catch (e) {} }
    if (method === "POST" && url.pathname.startsWith("/rest/v1/call_schedule_snapshots")) {
      try { const b = JSON.parse(body); snapStore.push({ id: crypto.randomUUID(), reason: b.reason || null, source_updated_at: b.source_updated_at || null, created_at: new Date().toISOString(), data: b.data }); }
      catch (e) { failedRequests.push("snapshot POST body did not parse: " + (e && e.message || e)); }
    }
    // rebase follow-up 9/23 (review, major): the app stamps its own updated_at into every blob upsert / merge and
    // remembers it (blobTsRef); the real column then reads that stamp, so refreshBlobRow's equality check
    // short-circuits on the next 60 s poll. Keep the stamp so the mocked row does too - without it the first tick
    // after a Setup edit (Acton's harness target, the Primary contribution) re-adopted the fixture / live blob and
    // the Totals / Fairness reads that followed were a coin toss (1 run in 3). The DATA column stays the fixture's
    // / the live one's on purpose: the Import pins and the seed-ownership rule read that picture.
    if ((method === "POST" || method === "PATCH") && url.pathname.startsWith("/rest/v1/call_schedule_data")) {
      try { const b = JSON.parse(body || "{}"); const r = Array.isArray(b) ? b[0] : b; if (r && typeof r.updated_at === "string") { if (sessionScope) sessBlobWriteTs = r.updated_at; else blobWriteTs = r.updated_at; } } catch (e) {}
    }
    writes.push({ method, path: url.pathname + url.search, body: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? "(snapshot body omitted)" : body, prefer: req.headers()["prefer"] || "", auth: req.headers()["authorization"] || "", at: Date.now(), snapshotReason: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? (() => { try { return JSON.parse(body).reason; } catch (e) { return null; } })() : undefined });
    return json(method === "POST" ? 201 : 200, representation(method, url, body));
  }
  // Snapshot list / read from the store (authenticated-only table: anon would answer []).
  if (method === "GET" && url.pathname.startsWith("/rest/v1/call_schedule_snapshots")) {
    const sel = url.searchParams.get("select") || "";
    const idQ = (url.searchParams.get("id") || "").replace(/^eq\./, "");
    const meta = (r) => ({ id: r.id, reason: r.reason, source_updated_at: r.source_updated_at, created_at: r.created_at });
    const rows = snapStore.slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1);
    if (idQ) return json(200, rows.filter(r => r.id === idQ).map(r => /\bdata\b/.test(sel) ? r : meta(r)));
    return json(200, rows.slice(0, Number(url.searchParams.get("limit") || 25)).map(meta));
  }
  // Prompt 16 B9 (h): one schedule_days GET from the named page answers 200 + [] - exactly what an RLS-filtered or
  // dead-token read looks like - so the app's tripwire can be seen keeping the map. Other pages' polls are untouched.
  if (emptyDaysFor && method === "GET" && url.pathname === "/rest/v1/schedule_days" && req.frame().page() === emptyDaysFor) { emptyDaysFor = null; emptyDaysServed++; return json(200, []); }
  if (daysWiped && method === "GET" && url.pathname === "/rest/v1/schedule_days") {
    let rows = Object.values(dayStore).sort((a, b) => a.day < b.day ? -1 : 1);
    const dayQ = (url.searchParams.get("day") || "").replace(/^eq\./, "");
    if (dayQ) rows = rows.filter(r => r.day === dayQ);
    const off = Number(url.searchParams.get("offset") || 0), lim = Number(url.searchParams.get("limit") || rows.length);
    return json(200, rows.slice(off, off + lim));
  }
  // Forced minimum version (refresh-banner scenario): row 'main' of client_versions.
  if (minVersionOverride && method === "GET" && url.pathname.startsWith("/rest/v1/client_versions") && /id=eq\.main/.test(url.search)) return json(200, [{ id: "main", ...minVersionOverride }]);
  // Item 5a: the scheduler's full listing (never the 'main' row read) carries two heartbeat rows without a person_id.
  if (cvExtrasFixture && method === "GET" && url.pathname === "/rest/v1/client_versions" && !/id=eq\.main/.test(url.search)) return json(200, [{ id: COORD_UID, person_id: null, app_version: APP_VERSION, user_agent: "harness", seen_at: "2026-09-24T12:00:00Z" }, { id: VIEWER_UID, person_id: null, app_version: APP_VERSION, user_agent: "harness", seen_at: "2026-09-24T11:00:00Z" }]);
  // Harness switch (fix round 2, safe-4): stamp a foreign updated_at / updated_by
  // onto the blob row so the import's dry run and its pre-apply re-read see a
  // setup that "changed since the dry run".
  // ... and (rebase follow-up 9/23) the app's own last write stamp rides on every blob GET after a write; the
  // deliberate foreign stamp above still wins when it is armed.
  const scopedBlobTs = sessionScope ? sessBlobWriteTs : blobWriteTs;
  if ((blobReadOverride || scopedBlobTs) && method === "GET" && url.pathname.startsWith("/rest/v1/call_schedule_data")) {
    let rows = fixtureAnswer(url);
    if (!rows) {
      const res = await route.fetch({ headers: { ...req.headers(), authorization: "Bearer " + ANON_KEY } });
      rows = await res.json().catch(() => []);
    }
    const stampRow = (r) => (r && typeof r === "object") ? { ...r, ...(scopedBlobTs ? { updated_at: scopedBlobTs } : {}), ...(blobReadOverride || {}) } : r;
    return json(200, Array.isArray(rows) ? rows.map(stampRow) : stampRow(rows));
  }
  // Prompt 13 part 3: a claimed day reads back with the claimer, version + 1 (what the function's UPDATE leaves).
  // ... and the harness-opened slot (LIVE mode, P13R-2) reads back blank with its live source and version.
  if ((Object.keys(claimedDays).length || harnessOpen.day) && method === "GET" && url.pathname === "/rest/v1/schedule_days") {
    return json(200, await scheduleDayRows(route, req, url));
  }
  // Prompt 19 S5: the scheduler's page (schedFeed.page) reads schedFeed.rows as its Alerts feed while a check needs it
  // (the anon passthrough answers [] for the authenticated-only notifications table).
  if (schedFeed && method === "GET" && url.pathname === "/rest/v1/notifications" && req.frame().page() === schedFeed.page) {
    return json(200, url.searchParams.get("type") ? [] : schedFeed.rows);
  }
  const fx = fixtureAnswer(url);
  if (fx) return json(200, fx);
  // Prompt 15 part 3: the East feed cache stays live, but its vacation lists are the harness's: every row's
  // data.vacations is stripped and the newest cached week hosts the three FAK fixture ranges (the ride-on host
  // rule of east-feed.js planVacationCache puts a range beyond the published weeks on the latest cached week).
  if (method === "GET" && url.pathname === "/rest/v1/east_feed") {
    const res = await route.fetch({ headers: { ...req.headers(), authorization: "Bearer " + ANON_KEY } });
    let rows = await res.json().catch(() => []);
    if (!Array.isArray(rows)) rows = [];
    const published = rows.filter(r => r && r.data && r.data.isForecast !== true).map(r => r.week_monday).sort();
    const host = published[published.length - 1] || null;
    return json(200, rows.map(r => {
      if (!r || !r.data || typeof r.data !== "object") return r;
      const data = { ...r.data }; delete data.vacations;
      if (r.week_monday === host) data.vacations = eastVacFeed.map(x => ({ code: "FAK", start: x.start, end: x.end }));
      return { ...r, data };
    }));
  }
  // Anon READ passthrough: the fake JWT would be rejected by the real project,
  // so swap it for the anon key (what dbReadHeaders does for an expired token).
  const headers = { ...req.headers() };
  headers["authorization"] = "Bearer " + ANON_KEY;
  return route.continue({ headers });
};
await page.route((url) => url.hostname === SUPABASE_HOST, routeSupabase);

// Load a page and wait for a selector, with ONE retry (a slow CDN/Supabase
// round trip must not read as a Slice regression; a real failure fails twice).
const loadWithRetry = async (pg, url, selector, timeout, label) => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await pg.goto(url, { waitUntil: "domcontentloaded" });
      await pg.waitForSelector(selector, { timeout });
      return attempt;
    } catch (e) {
      console.log(`     (${label}: attempt ${attempt} failed - ${String(e && e.message || e).split("\n")[0]})`);
      if (attempt === 2) throw e;
    }
  }
};
const waitFor = async (predicate, timeoutMs, stepMs) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await predicate()) return true; await new Promise(r => setTimeout(r, stepMs || 100)); }
  return false;
};

try {
  const attempts = await loadWithRetry(page, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "main page");
  ok(`header 'Silvis Call Schedule' rendered (auth gate passed with the mocked session${attempts > 1 ? ", on retry" : ""})`);
  await page.waitForSelector("[data-testid=cal-month]", { timeout: 15000 });
  ok("calendar view is the landing view");
  // Wait for the data load to settle (header shows Synced once loaded).
  await page.waitForSelector("text=Synced", { timeout: 30000 }).catch(() => fail("header never reached 'Synced' (initial load did not complete)"));
  const unlinked = await page.$("[data-testid=unlinked-banner]");
  if (unlinked) fail("unlinked-account banner shown for a profile that HAS person_id s1"); else ok("no unlinked banner for the linked scheduler profile");

  // Realtime mock joined?
  if (await waitFor(() => rt.joined, 15000)) ok(`realtime mock joined ${rt.topic} (frames: ${[...new Set(rt.frames)].join(", ")})`);
  else fail("the app never joined the mocked realtime channel (SDK handshake changed? frames seen: " + rt.frames.join(",") + ")");

  // ---- LIVE mode: the claim scenario needs one open slot s1 may take (P13R-2, 9/23) ----
  // Since the 9/23 publish the live table has next to no open slot: 10/15 primary (a Thursday, never Khan's) until the
  // scheduler filled it 9/25, none since. The harness then OPENS one backup slot in what it serves: a Mon/Wed 'generated' row after the
  // seed's range (the seed import sees no diff), outside the holiday units, unlocked, held by neither s1 nor an
  // outside cover - tried in date order, each candidate judged by the app's OWN board (Take enabled for s1 =
  // eligibility() said yes), at most six reloads. The chosen blank goes into liveRowsEarly too, so every pin derived
  // from the live rows (strip, board, premise, Accept & Publish write set, Import pins) sees what the app sees.
  if (!fixture) {
    const boardTake = async (slot) => {
      await page.click('button[data-tab="openshifts"]');
      await page.waitForSelector("[data-testid=openshifts-table]", { timeout: 8000 });
      await page.click("[data-testid=ob-horizon-all]"); await page.waitForTimeout(250);
      return page.$$eval("[data-testid=openshifts-table] tbody tr[data-slot]", (trs, s) => trs.map(tr => { const b = tr.querySelector("[data-testid=ob-take]"); return { slot: tr.getAttribute("data-slot"), on: !!b && !b.disabled }; }).filter(r => r.on && (!s || r.slot === s)).map(r => r.slot), slot);
    };
    const already = await boardTake(null);
    if (already.length) console.log(`     (live board: s1 may take ${already.length} open slot(s) as the table stands, e.g. ${already[0]} - no harness-opened slot needed)`);
    else {
      const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
      const inUnit = (d) => (d >= "2026-11-23" && d <= "2026-11-29") || d >= "2026-12-21";
      const cands = liveRowsEarly.filter(r => r.day > "2026-11-01" && r.day >= isoPlus(todayCentral, 3) && (wd(r.day) === 1 || wd(r.day) === 3) && !inUnit(r.day) && r.source === "generated" && r.backup_id && !r.backup_locked && r.primary_id && r.primary_id !== "s1" && r.backup_id !== "s1" && !r.external_cover).map(r => r.day).slice(0, 6);
      const reload = async () => { await loadWithRetry(page, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "reload (harness-opened slot)"); await page.waitForSelector("text=Synced", { timeout: 30000 }).catch(() => {}); };
      let chosen = null;
      for (const d of cands) {
        harnessOpen.day = d; harnessOpen.role = "backup";
        await reload();
        if ((await boardTake(d + "|backup")).length) { chosen = d; break; }
        console.log(`     (harness-opened slot: ${d} backup - s1 is not eligible there, next candidate)`);
      }
      if (chosen) { liveEarlyByDay[chosen].backup_id = null; ok(`LIVE mode: the harness opens ${chosen} backup in what it serves (live holder blanked in the answers, never in the table; s1 may take it per the app's own board) so the claim scenario runs against the live table`); }
      else { harnessOpen.day = null; harnessOpen.role = null; if (cands.length) await reload(); console.log(`     (LIVE mode: none of ${cands.length} candidate day(s) is claimable by s1 - the claim flow is not exercised this run)`); }
    }
    await page.click('button[data-tab="calendar"]');
    await page.waitForSelector("[data-testid=cal-month]", { timeout: 15000 });
  }

  // Every nav tab, screenshot each.
  const tabs = await page.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
  const expectedTabs = ["setup", "calendar", "openshifts", "myschedule", "timeoff", "totals", "settings"];
  if (JSON.stringify(tabs) !== JSON.stringify(expectedTabs)) fail(`nav tabs are ${JSON.stringify(tabs)}, expected ${JSON.stringify(expectedTabs)}`); else ok("nav tabs: " + tabs.join(", "));
  for (const t of tabs) {
    const before = pageErrors.length;
    await page.click(`button[data-tab="${t}"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${t}.png`), fullPage: true });
    if (pageErrors.length > before) fail(`tab ${t}: pageerror ${pageErrors.slice(before).join(" | ")}`); else ok(`tab ${t}: rendered, screenshot ${path.relative(ROOT, path.join(OUT, t + ".png"))}`);
  }
  // Settings: open the collapsible cards so their render paths run too.
  await page.click('button[data-tab="settings"]');
  for (const title of ["Activity log", "Client versions", "Office notifications", "Notification settings", "Restore from snapshot"]) {
    const el = await page.$(`text=${title}`);
    if (el) { await el.click(); await page.waitForTimeout(200); }
  }
  await page.screenshot({ path: path.join(OUT, "settings-open.png"), fullPage: true });
  ok("settings cards expanded without error");

  // Item 5a (Faraz 9/24): in the Client versions card an account with no person_id shows its user_profiles
  // display_name and role ("Office (harness) - coordinator") with an EMPTY id column; a profile without a display_name
  // keeps "(unlinked account)" + the id8; a linked roster row is untouched. While cvExtrasFixture is armed the route
  // serves a heartbeat row for the office and the viewer accounts and all three profiles; the card's Refresh reloads
  // both, then the switch is dropped and a second Refresh restores the run's one-profile picture (loadClientVersions
  // also feeds allProfiles).
  {
    cvExtrasFixture = true;
    try {
      if ((await page.$("[data-testid=card-settings_client_versions][data-open='0']"))) { await page.click("[data-testid=card-toggle-settings_client_versions]"); await page.waitForTimeout(200); }
      await page.click("[data-testid=card-settings_client_versions] button:has-text(\"Refresh\")");
      await page.waitForSelector(`[data-cv-row="${COORD_UID}"]`, { timeout: 8000 });
      const rowOf = (id) => page.$eval(`[data-cv-row="${id}"]`, el => ({ name: el.querySelector("[data-cv-name]").textContent, id: el.querySelector("[data-cv-id]").textContent, idShown: getComputedStyle(el.querySelector("[data-cv-id]")).display !== "none", text: el.textContent.replace(/\s+/g, " ").trim() }));
      const co = await rowOf(COORD_UID), vi = await rowOf(VIEWER_UID), s1 = await rowOf("s1");
      if (co.name !== "Office (harness) \u2014 coordinator" || co.id !== "" || co.idShown || co.text.includes(COORD_UID.slice(0, 8))) fail("Item 5a: the named unlinked account must read '<display_name> \u2014 <role>' with no id8 and a hidden id column: " + JSON.stringify(co));
      else ok(`Item 5a: Client versions names the unlinked office account '${co.name}' (no id8, id column hidden; status '${co.text.slice(co.name.length).trim().slice(0, 40)}')`);
      if (vi.name !== "(unlinked account)" || vi.id !== VIEWER_UID.slice(0, 8) || !vi.idShown) fail("Item 5a: a profile with no display_name must keep '(unlinked account)' + the visible id8: " + JSON.stringify(vi));
      else ok(`Item 5a: a no-name account keeps '(unlinked account)' + id8 ${vi.id}`);
      if (s1.name !== "Khan" || s1.id !== "s1") fail("Item 5a: the linked roster row changed: " + JSON.stringify(s1));
      else ok("Item 5a: the linked roster row still reads 'Khan s1'");
      await page.screenshot({ path: path.join(OUT, "client-versions-5a.png"), fullPage: true });
    } catch (e) { fail("Item 5a: " + String(e && e.message || e).split("\n")[0]); }
    cvExtrasFixture = false;
    await page.click("[data-testid=card-settings_client_versions] button:has-text(\"Refresh\")");
    await page.waitForSelector(`[data-cv-row="${COORD_UID}"]`, { state: "detached", timeout: 8000 }).then(() => ok("Item 5a: the fixture rows cleared after the switch was dropped (one-profile picture restored)"), () => fail("Item 5a: the fixture rows did not clear after the switch was dropped"));
  }

  // Heartbeat write happened (client_versions upsert keyed by the auth uid).
  const beat = writes.find(w => w.path.startsWith("/rest/v1/client_versions"));
  if (!beat) fail("no client_versions heartbeat write recorded");
  else {
    const b = JSON.parse(beat.body || "{}");
    if (b.id !== FAKE_UID || b.app_version !== APP_VERSION || b.person_id !== "s1" || !b.seen_at) fail("heartbeat body wrong: " + beat.body);
    else ok("client_versions heartbeat: { id: auth uid, app_version, user_agent, person_id, seen_at }");
  }

  // ---- Calendar helpers (Slice B/C/D) ----
  const showMonth = async (y, m0) => {
    await page.click('button[data-tab="calendar"]');
    await page.selectOption("[data-testid=cal-month-select]", String(m0));
    if ((await page.$eval("[data-testid=cal-year-input]", el => el.value)) !== String(y)) await page.fill("[data-testid=cal-year-input]", String(y));
    await page.waitForFunction(([y2, m2]) => { const el = document.querySelector("[data-testid=cal-month]"); return !!el && el.textContent.trim() === m2 + " " + y2; }, [String(y), ["January","February","March","April","May","June","July","August","September","October","November","December"][m0]], { timeout: 5000 });
    await page.waitForTimeout(300);
  };
  const readCells = () => page.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary"), b: e.getAttribute("data-backup"), ext: e.getAttribute("data-ext"), open: e.getAttribute("data-open"), text: e.textContent, badges: Array.from(e.querySelectorAll("[data-badge]")).map(x => x.getAttribute("data-badge")) })));
  const cellAttr = (d, attr) => page.$eval(`[data-day="${d}"]`, (el, a) => el.getAttribute(a), attr);
  // ---- Prompt 16 B9 (b): a dirty day-editor draft is never dropped without asking; Tab stays inside the dialog ----
  // Opens 10/15 (the page is at 390 px when this runs), checks focus landed inside the dialog and that Tab / Shift+Tab
  // wrap over its focusables, makes the draft dirty (an eligible primary other than the current one), taps the backdrop
  // and presses Escape with the confirm DISMISSED (the editor must stay), then Escape with it ACCEPTED (the editor
  // closes); the cell is unchanged - nothing is written.
  const B9_FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const b9EditorGuard = async (theme) => {
    const dialogs = []; let answer = false;
    const onDlg = (d) => { dialogs.push(d.message()); (answer ? d.accept() : d.dismiss()).catch(() => {}); };
    page.on("dialog", onDlg);
    try {
      await showMonth(2026, 9);
      const before = await cellAttr("2026-10-15", "data-primary");
      await page.click('[data-day="2026-10-15"]');
      await page.waitForSelector("[data-testid=editor-footer]", { timeout: 5000 });
      await page.waitForTimeout(250);
      const focusIn = await page.evaluate(() => { const d = document.querySelector("[data-testid=day-editor] [role=dialog]"); return !!d && d.contains(document.activeElement); });
      const n = await page.evaluate((sel) => { const d = document.querySelector("[data-testid=day-editor] [role=dialog]"); const f = Array.from(d.querySelectorAll(sel)); f[f.length - 1].focus(); return f.length; }, B9_FOCUSABLE);
      await page.keyboard.press("Tab");
      const afterTab = await page.evaluate((sel) => { const d = document.querySelector("[data-testid=day-editor] [role=dialog]"); const f = Array.from(d.querySelectorAll(sel)); return { inside: d.contains(document.activeElement), first: document.activeElement === f[0], label: document.activeElement.getAttribute("aria-label") || document.activeElement.textContent.trim() }; }, B9_FOCUSABLE);
      await page.keyboard.press("Shift+Tab");
      const afterShift = await page.evaluate((sel) => { const d = document.querySelector("[data-testid=day-editor] [role=dialog]"); const f = Array.from(d.querySelectorAll(sel)); return { inside: d.contains(document.activeElement), last: document.activeElement === f[f.length - 1] }; }, B9_FOCUSABLE);
      if (!focusIn) fail(`B9b (${theme}): focus did not land inside the day editor when it opened`);
      else if (!afterTab.inside || !afterTab.first || !afterShift.inside || !afterShift.last) fail(`B9b (${theme}): Tab from the last of ${n} focusables should wrap to the first and Shift+Tab back to the last: ${JSON.stringify({ afterTab, afterShift })}`);
      else ok(`B9b (${theme}): focus lands in the dialog; Tab wraps over its ${n} focusables (last -> '${afterTab.label}' -> last)`);
      // a dirty draft: an eligible primary other than the current one, else an eligible backup, else a typed note (10/15's
      // primary is locked since the scheduler filled it 9/25 - and its backup may be locked - so it is usually the note)
      const daysWritesBefore = writes.filter(w => w.path.startsWith("/rest/v1/schedule_days")).length;
      const pickIn = (role) => page.$$eval(`[data-testid=editor-${role}] option`, els => { if (!els.length || els[0].closest("select").disabled) return null; const cur = els.find(o => o.selected); const o = els.find(x => x.getAttribute("data-eligible") === "true" && x.value && (!cur || x.value !== cur.value)); return o ? o.value : null; });
      let how = null;
      const pP = await pickIn("primary");
      if (pP) { await page.selectOption("[data-testid=editor-primary]", pP); how = "primary -> " + pP; }
      else { const pB = await pickIn("backup"); if (pB) { await page.selectOption("[data-testid=editor-backup]", pB); how = "backup -> " + pB; } else { await page.fill("[data-testid=editor-note]", "b9 draft"); how = "a typed note"; } }
      await page.waitForTimeout(200);
      if (await page.$("[data-testid=override-confirm]")) { fail(`B9b (${theme}): dirtying the draft (${how}) opened the override confirm`); return; }
      answer = false;
      await page.mouse.click(4, 420); // the backdrop: at 390 px the dialog leaves the 14 px padding on each side
      await page.waitForTimeout(300);
      const openAfterTap = !!(await page.$("[data-testid=day-editor]"));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const openAfterEsc = !!(await page.$("[data-testid=day-editor]"));
      answer = true;
      await page.keyboard.press("Escape");
      const closed = await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).then(() => true).catch(() => false);
      const after = await cellAttr("2026-10-15", "data-primary");
      await page.waitForTimeout(1200); // past the days leg's 800 ms debounce - a discarded draft must not reach it
      const daysWrites = writes.filter(w => w.path.startsWith("/rest/v1/schedule_days")).length - daysWritesBefore;
      const asked = dialogs.filter(m => /Discard your unsaved changes to this day\?/.test(m)).length;
      if (!openAfterTap || !openAfterEsc) fail(`B9b (${theme}): a dirty draft (${how}) was dropped without a confirm (open after the backdrop tap: ${openAfterTap}, after Escape: ${openAfterEsc}; dialogs: ${JSON.stringify(dialogs)})`);
      else if (asked !== 3 || dialogs.length !== 3) fail(`B9b (${theme}): expected exactly three 'Discard your unsaved changes to this day?' confirms (tap, Escape, Escape), saw ${JSON.stringify(dialogs)}`);
      else if (!closed) fail(`B9b (${theme}): the editor did not close once the discard was confirmed`);
      else if (after !== before || daysWrites !== 0) fail(`B9b (${theme}): a discarded draft must write nothing - 10/15 primary ${before} -> ${after}, ${daysWrites} schedule_days write(s)`);
      else ok(`B9b (${theme}): the backdrop tap and Escape ask before dropping a dirty draft (${how}; declined twice, the editor stayed; accepted, it closed); 10/15 unchanged (${after || "open"}), no schedule_days write`);
    } catch (e) { fail(`B9b (${theme}): ` + errLine(e)); }
    finally {
      page.off("dialog", onDlg);
      if (await page.$("[data-testid=day-editor]")) { const acc = (d) => d.accept().catch(() => {}); page.on("dialog", acc); await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); page.off("dialog", acc); }
    }
  };
  // Closes the day editor, accepting the discard confirm a dirty draft now raises (Prompt 16 B9 (b)).
  const discardEditor = async () => {
    const acc = (d) => d.accept().catch(() => {});
    page.on("dialog", acc);
    try { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }); }
    finally { page.off("dialog", acc); }
  };
  // Edit one role of one day through the day editor (override panel accepted
  // when the rules refuse the pick - the harness reports that it happened).
  const editDay = async (d, role, id) => {
    const [y, m] = d.split("-");
    await showMonth(Number(y), Number(m) - 1);
    await page.click(`[data-day="${d}"]`);
    await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
    // P13R-2: the live table may already hold the intended holder (the 9/23 publish put Khan on 12/18-12/20) - then
    // there is nothing to save (Save stays disabled) and the editor must be closed, never left over the nav.
    if ((await page.$eval(`[data-testid=editor-${role}]`, el => el.value)) === id) {
      console.log(`     (${d} ${role} already ${id} in the app's map - no edit needed)`);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
      return;
    }
    await page.selectOption(`[data-testid=editor-${role}]`, id);
    const ov = await page.$("[data-testid=override-confirm]");
    if (ov) { console.log(`     (${d} ${role} -> ${id} needed an override: ${(await ov.innerText()).split("\n").slice(0, 2).join(" / ")})`); await page.click("[data-testid=override-accept]"); }
    await page.click("[data-testid=editor-save]");
    await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
  };

  // ---- The published rows (Prompt 12 SM2: read here, before the first pin that depends on them) ----
  // Live anon read of EVERY row - no day floor, because the app's loadScheduleDays
  // has none and the item-SM restatements must see the same rows as the app's
  // suLastContiguousDay; the fixture rows when the live table is empty. They
  // drive (1) the OPEN pins of the week rows and the ER copy (an open slot is
  // OPEN only on/after today), (2) the choice of every row-less day this run
  // edits (the editor edit day, the fail-closed / block-member / trade-block
  // days), (3) the independent Totals recount, (4) the item-SM live-state pins
  // and (5) the Import dry-run / apply restatements. The lock flags, the source,
  // the note and updated_by ride along: a holders-unchanged Accept & Publish
  // write is checked field by field and the importer's seed-owned rule
  // (source 'import' + updated_by 'seed') is restated from them. Every day this
  // run edits or injects is recorded in harnessDays so the recount applies the
  // same edits: the comparison never depends on which calendar month the run
  // happens in and is never skipped (vis-002).
  const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
  const todayIso = todayCentral; // the Central date, like the app's todayStr (helpers.js todayCentral) - the strip and the recount agree from any time zone
  const isoAddDays = (d, n) => utcDay(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000);
  const mdOf = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`; // the app's fmtMD: M/D without zero padding
  const daysBetween = (a, b) => { const out = []; for (let d = a; d <= b; d = isoAddDays(d, 1)) out.push(d); return out; };
  let liveRows = [];
  try {
    if (fixture) liveRows = fixture.schedule_days.slice();
    else {
      const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/schedule_days?select=day,primary_id,backup_id,primary_locked,backup_locked,source,external_cover,note,updated_by&order=day.asc`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } });
      if (!res.ok) throw new Error("live schedule_days read failed: HTTP " + res.status);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error("live schedule_days read: body is not an array");
      liveRows = rows;
      // P13R + SM2 merge: the harness-opened slot (blanked in liveEarlyByDay by the board scenario, never in the table) must show as OPEN here too, or every derived pin disagrees with what the app serves.
      liveRows.forEach(r => { const e = liveEarlyByDay[r.day]; if (e && e.backup_id == null && r.backup_id != null) r.backup_id = null; if (e && e.primary_id == null && r.primary_id != null) r.primary_id = null; });
    }
    if (!liveRows.some(r => r.day >= "2026-10-01" && r.day <= "2026-10-31" && (r.primary_id || r.backup_id))) throw new Error("no October 2026 assignments in the live rows - the recount has nothing to compare");
  } catch (e) { fail("live schedule_days rows: could not read them for the pins and the recount: " + String(e && e.message || e).split("\n")[0]); }
  const liveByDay = {}; liveRows.forEach(r => { liveByDay[r.day] = r; });
  const lastLiveDay = liveRows.length ? liveRows[liveRows.length - 1].day : todayIso; // the row-less day scans below are bounded from here, not from today (SM2 review)
  // The live blob (call_schedule_data.data), one anon read like the app's, or the fixture's: the coverage
  // strip's lastPublished and - SM2 review - the holiday-unit days (data in the blob, editable in Setup)
  // that the row-less Fri-Sun triples below must not overlap (a Sat inside a unit is 'holiday-unit',
  // not 'weekend-block-only', so the block-member override would not be offered).
  let liveBlobData = null;
  try {
    if (fixture) liveBlobData = fixture.call_schedule_data[0].data;
    else {
      const br = await fetch(`https://${SUPABASE_HOST}/rest/v1/call_schedule_data?id=eq.main&select=data`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } });
      if (!br.ok) throw new Error("HTTP " + br.status);
      const brows = await br.json();
      let d = brows[0] && brows[0].data; if (typeof d === "string") d = JSON.parse(d);
      if (!d || typeof d !== "object") throw new Error("no data on the main row");
      liveBlobData = d;
    }
  } catch (e) { fail("live blob: could not read call_schedule_data for lastPublished / the holiday units: " + String(e && e.message || e).split("\n")[0]); }
  const holidayUnitDays = new Set(Object.values((liveBlobData && liveBlobData.holidays && liveBlobData.holidays.units) || {}).flat().flatMap(u => (u && Array.isArray(u.days)) ? u.days : []));
  // An open slot per the live rows (the app's rule): primary is open with no holder and no external
  // cover (a cover stands in for the primary), backup with no holder; a row-less day is open in both.
  const liveOpen = (d, role) => { const r = liveByDay[d]; return role === "primary" ? !(r && (r.primary_id || r.external_cover)) : !(r && r.backup_id); };
  console.log(`     (${liveRows.length} ${fixture ? "fixture" : "live"} schedule_days rows ${liveRows[0] ? liveRows[0].day + ".." + liveRows[liveRows.length - 1].day : "(none)"}; open slots on/after today ${todayIso}: ${liveRows.filter(r => r.day >= todayIso && (liveOpen(r.day, "primary") || liveOpen(r.day, "backup"))).map(r => r.day).join(", ") || "none inside the rows"})`);

  // ---- Slice B: October 2026 grid on the imported data ----
  await showMonth(2026, 9);
  const octCells = await readCells();
  const octInMonth = octCells.filter(c => c.day.startsWith("2026-10"));
  const pCells = octInMonth.filter(c => c.p);
  const openCells = octInMonth.filter(c => /OPEN/.test(c.text));
  // Item A (Faraz 9/23): the grid is Sunday-first by default, like the Davenport app - Sun 9/27 .. Sat 10/31.
  if (octCells.length !== 35 || octCells[0].day !== "2026-09-27" || octCells[34].day !== "2026-10-31") fail(`October 2026 grid is not 5 Sun-Sat rows 9/27..10/31: ${octCells.length} cells, ${octCells[0] && octCells[0].day}..${octCells[34] && octCells[34].day}`);
  else ok("October 2026 grid: 35 Sun..Sat cells from 9/27 to 10/31 (Sunday-first by default)");
  // ---- Item A: the calendar header reads Sun..Sat by default, Mon..Sun after Settings > Week starts on: Monday, and back ----
  {
    const readHdr = () => page.$$eval("[data-testid=cal-grid] .cal-hdr", els => els.map(e => ({ dow: e.getAttribute("data-dow"), wk: e.getAttribute("data-weekend"), label: !!e.querySelector(".cal-wk-label"), tinted: !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(getComputedStyle(e).backgroundColor) })));
    const modeOf = () => page.$eval("[data-testid=cal-grid]", el => el.getAttribute("data-week-start"));
    const storedMode = () => page.evaluate(() => { try { return localStorage.getItem("silvis-week-start"); } catch (e) { return "ERR " + e; } });
    const pressed = () => page.$$eval("[data-testid^=week-start-]", els => els.map(e => e.getAttribute("data-testid").slice(11) + ":" + e.getAttribute("aria-pressed")).join(","));
    const expectHdr = async (mode, where) => {
      const hdr = await readHdr();
      const want = mode === "mon" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const got = hdr.map(h => h.dow);
      const wkCols = hdr.map((h, i) => h.wk === "1" && h.tinted ? i : -1).filter(i => i >= 0);
      const wantWk = mode === "mon" ? [4, 5, 6] : [0, 5, 6];
      const labelOn = hdr.filter(h => h.label).map(h => h.dow);
      const cells = await readCells();
      const firstDow = new Date(cells[0].day + "T12:00:00").getDay();
      const problems = [];
      if (got.join() !== want.join()) problems.push(`header ${got.join(" ")}`);
      if (wkCols.join() !== wantWk.join()) problems.push(`weekend tint on columns ${wkCols.join(",") || "none"} (want ${wantWk.join(",")})`);
      if (labelOn.join() !== "Fri") problems.push(`'weekend unit' label on ${labelOn.join(",") || "no header"} (want Fri)`);
      if (cells.length % 7 !== 0 || firstDow !== (mode === "mon" ? 1 : 0)) problems.push(`${cells.length} cells from ${cells[0].day} (getDay ${firstDow})`);
      if ((await modeOf()) !== mode) problems.push(`data-week-start ${await modeOf()}`);
      if ((await storedMode()) !== mode) problems.push(`localStorage silvis-week-start ${await storedMode()}`);
      if (problems.length) fail(`Item A week start ${where}: ${problems.join("; ")}`);
      else ok(`Item A week start ${where}: header ${got.join(" ")}, weekend tint on columns ${wkCols.join(",")}, 'weekend unit' label on Fri, ${cells.length} cells from ${cells[0].day}, data-week-start + localStorage '${mode}'`);
    };
    await expectHdr("sun", "default (October 2026, nothing stored yet but the effect wrote 'sun')");
    const setWeekStart = async (mode) => { await page.click('button[data-tab="settings"]'); await page.click(`[data-testid=week-start-${mode}]`); await page.waitForTimeout(150); const p = await pressed(); if (p !== (mode === "mon" ? "sun:false,mon:true" : "sun:true,mon:false")) fail(`Item A Settings control after ${mode}: aria-pressed reads ${p}`); await showMonth(2026, 9); };
    await setWeekStart("mon");
    await expectHdr("mon", "after Settings > Week starts on: Monday");
    const octMon = await readCells();
    if (octMon.length !== 35 || octMon[0].day !== "2026-09-28" || octMon[34].day !== "2026-11-01") fail(`Item A Monday mode: October 2026 is not 9/28..11/1: ${octMon.length} cells ${octMon[0] && octMon[0].day}..${octMon[34] && octMon[34].day}`); else ok("Item A Monday mode: October 2026 = 35 Mon..Sun cells 9/28..11/1 (the pre-Item-A grid)");
    await page.locator("[data-testid=cal-grid]").screenshot({ path: path.join(OUT, "calendar-oct-2026-monday-first.png") });
    await setWeekStart("sun");
    await expectHdr("sun", "after Settings > Week starts on: Sunday again");
    // the same day cells in both modes - only the padding moved
    const octSun = await readCells();
    const byDay = (arr) => Object.fromEntries(arr.filter(c => c.day.startsWith("2026-10")).map(c => [c.day, [c.p, c.b, c.ext, c.open, c.text].join("|")]));
    const a = byDay(octMon), b = byDay(octSun), diff = Object.keys(a).filter(d => a[d] !== b[d]);
    if (Object.keys(a).length !== 31 || diff.length) fail(`Item A: the October cells differ between the two modes (${diff.join(", ") || Object.keys(a).length + " days"})`); else ok("Item A: all 31 October cells identical in both modes (only the padding cells move)");
    await page.locator("[data-testid=cal-grid]").screenshot({ path: path.join(OUT, "calendar-oct-2026-sunday-first.png") });
  }
  if (!pCells.length) fail("October 2026: no cell carries a primary assignment"); else ok(`October 2026: ${pCells.length} day(s) with 'P <name>', e.g. ${pCells[0].day} P ${pCells[0].p}`);
  { const octOpen = liveOpenBetween("2026-10-01", "2026-10-31");
    if (!openCells.length) { if (octOpen) fail("October 2026: no cell shows OPEN although the live rows have an open slot on " + octOpen); else console.log("     (October 2026: no open slot in the live rows from today on - no OPEN cell expected)"); }
    else if (!octOpen) fail(`October 2026: ${openCells.length} cell(s) show OPEN but the live rows have no open slot from today on (e.g. ${openCells[0].day})`);
    else ok(`October 2026: ${openCells.length} cell(s) show OPEN (e.g. ${openCells[0].day} open=${openCells[0].open}; live: first open ${octOpen})`); }
  const oct15 = octCells.find(c => c.day === "2026-10-15");
  if (dated("2026-10-15", "the '2026-10-15 renders P OPEN' pin")) {
    if (liveOpenEarly("2026-10-15", "primary")) { if (!oct15 || oct15.p || !/OPEN/.test(oct15.text)) fail("2026-10-15 should render P OPEN (open primary in the live rows): " + JSON.stringify(oct15)); else ok("2026-10-15 renders P OPEN (open in the live rows)"); }
    else if (!oct15 || !oct15.p || oct15.p !== ((liveEarlyByDay["2026-10-15"] || {}).primary_id || null)) fail("2026-10-15 primary is held in the live rows but the cell shows " + JSON.stringify(oct15)); else ok(`2026-10-15 primary held live by ${oct15.p} - the cell shows the holder, not OPEN`);
  }
  const atwellCells = octCells.filter(c => c.day >= "2026-09-28" && c.day <= "2026-10-04");
  if (atwellCells.length !== 7 || !atwellCells.every(c => c.ext === "Atwell" && /Atwell/.test(c.text) && !/OPEN[^]*OPEN/.test(c.text))) fail("week of 9/28: the Atwell external cover is not shown on every cell: " + JSON.stringify(atwellCells.map(c => [c.day, c.ext, c.text.slice(0, 30)])));
  else ok("week of 9/28: all 7 cells show the external cover label 'Atwell' in the primary line (muted, not OPEN)");
  const filterChips = await page.$$eval("[data-filter]", els => els.map(e => e.getAttribute("data-filter")));
  if (filterChips.length < 6 || !filterChips.includes("SRK")) fail("surgeon filter chips missing: " + filterChips.join(",")); else ok("surgeon filter chips by code: " + filterChips.join(" "));
  await page.screenshot({ path: path.join(OUT, "calendar-oct-2026.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-oct-2026.png");

  // ---- Slice C: the ER-panel author's week rows under the grid ----
  const weekRowsVisible = await page.$("[data-testid=week-rows]");
  if (!weekRowsVisible) { await page.click("text=Week rows (ER Call Panels layout)"); await page.waitForSelector("[data-testid=week-rows]", { timeout: 3000 }); }
  const hdr = await page.$eval("[data-testid=week-rows] thead", el => el.innerText.replace(/\s+/g, " ").trim());
  if (hdr !== "MON/SUN DATES TRAUMA TRAUMA BACKUP") fail("week rows header is not the ER-panel author's: " + hdr); else ok("week rows header: " + hdr);
  const row928 = await page.$eval('[data-testid=week-rows] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
  if (!/9\/28-10\/4 Atwell/.test(row928) || !/9\/28-10\/4 Fierce/.test(row928)) fail("week row 9/28 lacks '9/28-10/4 Atwell' / '9/28-10/4 Fierce': " + row928); else ok("week row 9/28: '9/28-10/4 Atwell' (primary) and '9/28-10/4 Fierce' (backup) collapsed");
  const row1005 = await page.$eval('[data-testid=week-rows] tr[data-week="2026-10-05"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
  // Live-drift fix (9/24): the week-row entries are DERIVED from the live rows, never pinned to who held a day on
  // the import (the 10/10 trade broke '10/9-10/11 Acton'). expectWeekCols restates buildWeekRows' collapse rule
  // (helpers.js): per role column, walk Mon..Sun; primary = roster id, else the external cover, else OPEN; backup =
  // roster id or OPEN; an OPEN day before today has no entry; consecutive days with the SAME holder (same kind, id
  // and name; never OPEN) collapse into one 'M/D-M/D Name' entry. The rendered columns must equal it entry for entry.
  const rosterNameOf = (id) => ((((liveBlobData && liveBlobData.roster) || []).find(r => r && r.id === id)) || {}).name || id;
  const expectWeekCols = (monday) => {
    const days = daysBetween(monday, isoAddDays(monday, 6));
    const col = (role) => {
      const out = [];
      days.forEach(d => {
        const r = liveByDay[d];
        const h = role === "primary"
          ? (r && r.primary_id ? { kind: "surgeon", id: r.primary_id, name: rosterNameOf(r.primary_id) } : r && r.external_cover ? { kind: "external", id: null, name: String(r.external_cover) } : { kind: "open", id: null, name: "OPEN" })
          : (r && r.backup_id ? { kind: "surgeon", id: r.backup_id, name: rosterNameOf(r.backup_id) } : { kind: "open", id: null, name: "OPEN" });
        if (h.kind === "open" && d < todayIso) return;
        const last = out[out.length - 1];
        if (last && isoAddDays(last.end, 1) === d && last.kind !== "open" && last.kind === h.kind && last.id === h.id && last.name === h.name) { last.end = d; return; }
        out.push({ ...h, start: d, end: d });
      });
      return out.map(e => ({ text: (e.start === e.end ? mdOf(e.start) : mdOf(e.start) + "-" + mdOf(e.end)) + " " + e.name, multi: e.start !== e.end }));
    };
    return { primary: col("primary"), backup: col("backup") };
  };
  const readWeekCols = (monday) => page.$eval(`[data-testid=week-rows] tr[data-week="${monday}"]`, tr => { const tds = tr.querySelectorAll("td"); const col = (td) => td ? Array.from(td.querySelectorAll("[data-kind]")).map(e => e.textContent.trim()) : null; return { primary: col(tds[1]), backup: col(tds[2]) }; }).catch(() => null);
  const checkWeekRow = async (monday) => {
    const exp = expectWeekCols(monday), got = await readWeekCols(monday);
    const expP = exp.primary.map(e => e.text), expB = exp.backup.map(e => e.text);
    const runs = exp.primary.concat(exp.backup).filter(e => e.multi).map(e => e.text);
    if (!got || !got.primary || !got.backup) { fail(`week row ${mdOf(monday)}: no rendered row tr[data-week="${monday}"]`); return runs; }
    if (got.primary.join(" / ") !== expP.join(" / ") || got.backup.join(" / ") !== expB.join(" / ")) fail(`week row ${mdOf(monday)}: rendered TRAUMA [${got.primary.join(" / ")}] / BACKUP [${got.backup.join(" / ")}] differ from the live rows' collapsed runs [${expP.join(" / ")}] / [${expB.join(" / ")}]`);
    else ok(`week row ${mdOf(monday)}: TRAUMA [${expP.join(" / ")}], BACKUP [${expB.join(" / ")}] - equal the live rows collapsed by the same-surgeon rule${runs.length ? " (multi-day run(s): " + runs.join(", ") + ")" : " (no multi-day run this week)"}`);
    return runs;
  };
  {
    const runs1005 = await checkWeekRow("2026-10-05");
    // The collapse must still be exercised: when the week of 10/5 has no multi-day run, the first other week the
    // week-rows table renders (its tr[data-week] Mondays, read from the page) whose live rows hold one is checked the
    // same way; none anywhere = FAIL.
    if (!runs1005.length) {
      const mondays = (await page.$$eval("[data-testid=week-rows] tr[data-week]", trs => trs.map(tr => tr.getAttribute("data-week")))).filter(m => m !== "2026-10-05");
      const alt = mondays.find(m => { const e = expectWeekCols(m); return e.primary.concat(e.backup).some(x => x.multi); });
      if (!alt) fail(`week rows: no rendered week (${mondays.map(mdOf).join(", ") || "none"}) has a multi-day same-surgeon run in the live rows - the collapse is not exercised`);
      else { const altRuns = await checkWeekRow(alt); if (altRuns.length) ok(`week rows: same-surgeon collapse exercised on the week of ${mdOf(alt)} (${altRuns.join(", ")}) - the week of 10/5 has none in the live rows`); }
    }
  }
  // Prompt 12 SM2: the week row's OPEN entries are derived from the live rows, never pinned to a date -
  // an unassigned slot on/after today (Central) is one 'M/D OPEN' entry per open role (buildWeekRows
  // never collapses OPEN days), a past open slot produces no entry (item Q). On the 9/22 import this
  // read '10/7 OPEN' (the first open October backup); since the 9/23 overnight publish the week is full.
  const expOpen1005 = daysBetween("2026-10-05", "2026-10-11").filter(d => d >= todayIso).flatMap(d => ["primary", "backup"].filter(role => liveOpen(d, role)).map(() => `${mdOf(d)} OPEN`)).sort();
  const gotOpen1005 = (row1005.match(/\d{1,2}\/\d{1,2} OPEN/g) || []).sort();
  if (gotOpen1005.join(", ") !== expOpen1005.join(", ")) fail(`week row 10/5: OPEN entries [${gotOpen1005.join(", ")}] differ from the live rows' open slots on/after today ${todayIso} [${expOpen1005.join(", ")}]: ` + row1005);
  else ok(`week row 10/5: OPEN entries equal the live rows' open slots on/after today (${expOpen1005.length ? expOpen1005.join(", ") : "none - the week is fully assigned or past"})`);
  const openRed = await page.$eval('[data-testid=week-rows] [data-kind="open"]', el => getComputedStyle(el).color).catch(() => "");
  const octOpenExpected = daysBetween("2026-09-28", "2026-11-01").some(d => d >= todayIso && (liveOpen(d, "primary") || liveOpen(d, "backup")));
  // TH: OPEN is the theme's red token #B91C1C (light) - item O.1 keeps OPEN red so it never competes with the orange accent.
  if (openRed) { if (!/rgb\(185, 28, 28\)/.test(openRed)) fail("week rows: OPEN entry is not the OPEN red #B91C1C: " + openRed); else ok("week rows: OPEN entries are red #B91C1C"); }
  else if (octOpenExpected) fail("week rows: no OPEN entry found in the October 2026 week rows although the live rows leave a slot open on/after today " + todayIso);
  else console.log(`     (no open slot on/after today ${todayIso} in the October 2026 week rows - the 'OPEN entries are red' pin is not exercised here; the today-forward check below reads the colour on the first open slot's week row)`);
  await page.locator("[data-testid=week-rows]").screenshot({ path: path.join(OUT, "week-rows-oct-2026.png") });
  ok("screenshot test/ui/out/week-rows-oct-2026.png");

  // ---- Item Q (Faraz 9/22): an unassigned slot is OPEN only from today (Central) forward ----
  // September 2026 (9/1-9/13 have no rows; the import has open backups before
  // 9/22): no week-row entry dated before today may read "M/D OPEN" and no grid
  // cell before today may carry the red OPEN pill or a data-open flag. The other
  // half - an open slot today or later still reads OPEN in both places - was
  // pinned to 10/15 until the scheduler filled it (9/25 15:24 CDT, Burchett P
  // locked, Khan B); since then it runs on the FIRST open slot on/after today in
  // the served rows (liveOpen, through the last live row - the harness-opened
  // slot counts, the app is served the same blank): its 'M/D OPEN' entry once
  // per open role in its week row, in the OPEN red, and data-open = those roles'
  // letters with the red pill in the grid. No open slot = a console line. A past
  // cell's hover title must not say OPEN either (fix round: the tooltip).
  await showMonth(2026, 8);
  const sepEntries = await page.$$eval("[data-testid=week-rows] tr[data-week]", trs => trs.flatMap(tr => Array.from(tr.querySelectorAll('[data-kind="open"]')).map(el => ({ week: tr.getAttribute("data-week"), text: el.textContent.trim() }))));
  // "M/D OPEN" -> ISO, the year taken from the row's Monday (a December row can list January days).
  const entryIso = (e) => { const m = /^(\d{1,2})\/(\d{1,2}) OPEN$/.exec(e.text); if (!m) return null; const wy = Number(e.week.slice(0, 4)), wm = Number(e.week.slice(5, 7)), mo = Number(m[1]); return `${mo < wm ? wy + 1 : wy}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; };
  const sepDated = sepEntries.map(e => ({ ...e, iso: entryIso(e) }));
  const sepPast = sepDated.filter(e => !e.iso || e.iso < todayCentral), sepFuture = sepDated.filter(e => e.iso && e.iso >= todayCentral);
  if (sepPast.length) fail(`September 2026 week rows: ${sepPast.length} OPEN entry(ies) dated before today ${todayCentral} (Central): ${sepPast.slice(0, 6).map(e => e.text).join(", ")}${sepPast.length > 6 ? ", ..." : ""}`);
  else ok(`September 2026 week rows: no OPEN entry dated before today ${todayCentral} (Central); ${sepFuture.length} OPEN entry(ies) today or later`);
  const sepGrid = await page.$$eval("[data-testid=cal-grid] .cal-cell", (els, t) => els.filter(e => e.getAttribute("data-day") < t).map(e => ({ day: e.getAttribute("data-day"), pill: !!e.querySelector(".cal-pill.cal-open"), open: e.getAttribute("data-open") || "", text: e.textContent, title: e.getAttribute("title") || "" })), todayCentral);
  const sepBad = sepGrid.filter(c => c.pill || c.open || /OPEN/.test(c.text) || /OPEN/.test(c.title));
  if (!sepGrid.length) fail(`September 2026 grid: no cell before today ${todayCentral} to check`);
  else if (sepBad.length) fail(`September 2026 grid: ${sepBad.length} cell(s) before today ${todayCentral} still show OPEN (pill / data-open / text / title): ${sepBad.slice(0, 5).map(c => `${c.day} open=${c.open} title='${c.title}'`).join(", ")}`);
  else ok(`September 2026 grid: none of the ${sepGrid.length} cell(s) before today ${todayCentral} shows an OPEN pill, data-open, OPEN text or an OPEN tooltip (e.g. ${sepGrid[0].day} title='${sepGrid[0].title}')`);
  await page.screenshot({ path: path.join(OUT, "calendar-sep-2026.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-sep-2026.png");
  {
    const fwdDay = daysBetween(todayIso, lastLiveDay).find(d => liveOpen(d, "primary") || liveOpen(d, "backup")) || null;
    if (!fwdDay) console.log(`     (today-forward: no open slot on/after today ${todayCentral} in the served rows through ${lastLiveDay} - the 'still OPEN' half of the check is not exercised this run)`);
    else {
      const fwdRoles = ["primary", "backup"].filter(r => liveOpen(fwdDay, r));
      const fwdLetters = fwdRoles.map(r => r === "primary" ? "P" : "B").join("");
      const fwdMonday = isoAddDays(fwdDay, -((new Date(fwdDay + "T12:00:00Z").getUTCDay() + 6) % 7)); // the week rows are Mon-Sun
      const fwdWhy = harnessOpen.day === fwdDay ? " (the harness-opened slot, blanked in what the app is served)" : "";
      const want = `${mdOf(fwdDay)} OPEN`;
      await showMonth(Number(fwdDay.slice(0, 4)), Number(fwdDay.slice(5, 7)) - 1);
      const fwdEntries = await page.$$eval(`[data-testid=week-rows] tr[data-week="${fwdMonday}"] [data-kind="open"]`, els => els.map(e => ({ text: e.textContent.trim(), color: getComputedStyle(e).color })));
      const fwdCell = await page.$eval(`[data-testid=cal-grid] [data-day="${fwdDay}"]`, el => ({ open: el.getAttribute("data-open"), pill: !!el.querySelector(".cal-pill.cal-open"), text: el.textContent })).catch(() => null);
      const mine = fwdEntries.filter(e => e.text === want);
      if (mine.length !== fwdRoles.length) fail(`today-forward: the week row of ${mdOf(fwdMonday)} should list '${want}' once per open role (${fwdRoles.join(" + ")}) for ${fwdDay}${fwdWhy}, got ${JSON.stringify(fwdEntries.map(e => e.text))}`);
      else if (!mine.every(e => /rgb\(185, 28, 28\)/.test(e.color))) fail(`today-forward: '${want}' in the week row of ${mdOf(fwdMonday)} is not the OPEN red #B91C1C: ${mine.map(e => e.color).join(", ")}`);
      else if (!fwdCell || fwdCell.open !== fwdLetters || !fwdCell.pill || !/OPEN/.test(fwdCell.text)) fail(`today-forward: the grid cell ${fwdDay} should read ${fwdLetters} OPEN (data-open=${fwdLetters}, red pill)${fwdWhy}: ${JSON.stringify(fwdCell)}`);
      else ok(`today-forward: the first open slot on/after today ${todayCentral} in the served rows, ${fwdDay} ${fwdRoles.join(" + ")}${fwdWhy}, reads '${want}' (red #B91C1C) in the week row of ${mdOf(fwdMonday)} and ${fwdLetters} OPEN (data-open=${fwdCell.open}, red pill) in the grid`);
    }
    await showMonth(2026, 9); // the exports below start from October 2026
  }

  // ---- Prompt 9: exports (Calendar tools card + My schedule .ics) ----
  // Real downloads are captured and read back; the share page is re-opened
  // through the static server (test/ui/out is under ROOT) and the printable
  // view is the popup window.open produced. October 2026 is still showing.
  const errLine = (e) => String(e && e.message || e).split("\n")[0];
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const saveDownload = async (trigger) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), trigger()]);
    const name = dl.suggestedFilename();
    const target = path.join(OUT, name);
    await dl.saveAs(target);
    return { name, target, text: fs.readFileSync(target, "utf8") };
  };
  if (!(await page.$("[data-testid=calendar-tools]"))) { await page.click("text=Calendar tools (exports)"); await page.waitForSelector("[data-testid=calendar-tools]", { timeout: 3000 }); }
  ok("calendar tools card opened");
  // (a) group .ics
  try {
    const g = await saveDownload(() => page.click("[data-testid=ics-all]"));
    const n = (g.text.match(/BEGIN:VEVENT/g) || []).length;
    if (g.name !== "silvis-call-all.ics") fail("group ics filename: " + g.name);
    // all-day runs since 9/25: DTSTART;VALUE=DATE / DTEND;VALUE=DATE, 'P <Name> \u00b7 B <Name>', UID silvis-<start>-group, no timed stamp
    else if (!g.text.startsWith("BEGIN:VCALENDAR\r\n") || !/DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}\r\n/.test(g.text) || /TZID=|T070000/.test(g.text) || !/SUMMARY:P [\w() ]+ \u00b7 B [\w() ]+\r\n/.test(g.text) || !/UID:silvis-\d{4}-\d{2}-\d{2}-group@silvis-call/.test(g.text)) fail("group ics content wrong: " + g.text.slice(0, 400).replace(/\r\n/g, " | "));
    else ok(`group ics: ${g.name} (${n} all-day run events, 'P <Name> \u00b7 B <Name>', UIDs silvis-<start>-group)`);
  } catch (e) { fail("group ics download: " + errLine(e)); }
  // (b) per-surgeon .ics from the tools card (Khan)
  try {
    const k = await saveDownload(() => page.click("[data-testid=ics-FAK]"));
    const n = (k.text.match(/BEGIN:VEVENT/g) || []).length;
    if (k.name !== "silvis-call-khan.ics") fail("per-surgeon ics filename: " + k.name);
    else if (/SUMMARY:Silvis (Primary|Backup) Call/.test(k.text) || (n > 0 && (!/SUMMARY:Silvis (Primary|Backup)\r\n/.test(k.text) || !/DTSTART;VALUE=DATE:\d{8}\r\n/.test(k.text)))) fail("per-surgeon ics summaries wrong: " + (k.text.match(/SUMMARY:[^\r]*/g) || []).slice(0, 3).join(" | "));
    else ok(`per-surgeon ics: ${k.name} (${n} all-day run events, 'Silvis Primary' / 'Silvis Backup')`);
  } catch (e) { fail("per-surgeon ics download: " + errLine(e)); }
  // (c) share page: download 2 months, re-open through the static server, screenshot
  try {
    await page.selectOption("[data-testid=tool-months]", "2");
    const s = await saveDownload(() => page.click("[data-testid=share-download]"));
    const grids = (s.text.match(/<section class="mo" data-month="/g) || []).length, tables = (s.text.match(/<table class="wr" data-month="/g) || []).length;
    if (s.name !== "silvis-call-2026-10-01-2026-11-30.html") fail("share page filename: " + s.name);
    else if (grids !== 2 || tables !== 2 || /<script/i.test(s.text)) fail(`share page: ${grids} grid(s), ${tables} week-row table(s), script=${/<script/i.test(s.text)}`);
    else ok(`share page: ${s.name} - 2 month grids + 2 week-row tables, no scripts, ${s.text.length} bytes`);
    const sharePage = await context.newPage();
    watchPage(sharePage, "share");
    await sharePage.goto(BASE + "test/ui/out/" + s.name, { waitUntil: "load" });
    await sharePage.waitForSelector(".mo .cg .cd", { timeout: 5000 });
    if (dated("2026-10-15", "the 'share page 10/15 P OPEN red' pin") && (liveOpenEarly("2026-10-15", "primary") || (console.log("     (share page: 10/15 primary is held live - the OPEN-red pin has nothing to check)"), false))) {
      const shareOpen = await sharePage.$eval('.cd[data-day="2026-10-15"] .open', el => getComputedStyle(el).color).catch(() => "");
      if (!/rgb\(192, 64, 64\)/.test(shareOpen)) fail("share page: 10/15 P OPEN is not red: " + shareOpen); else ok("share page renders: 10/15 P OPEN in red");
    }
    const shareAtwell = await sharePage.$eval('table.wr[data-month="2026-10"] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
    if (!/9\/28-10\/4 Atwell/.test(shareAtwell)) fail("share page week rows lack '9/28-10/4 Atwell': " + shareAtwell); else ok("share page week rows: '9/28-10/4 Atwell' under the October grid");
    // TH (O.3): the share page's pills carry the id-keyed surgeon colours the grid uses (Khan navy #1F3A6B).
    const shareKhan = await sharePage.$$eval(".bdg", els => { const e = els.find(x => /Khan/.test(x.textContent)); return e ? getComputedStyle(e).color : ""; }).catch(() => "");
    if (shareKhan !== "rgb(31, 58, 107)") fail("share page: Khan's pill is not the theme navy #1F3A6B: " + JSON.stringify(shareKhan)); else ok("share page: Khan's pill carries the theme navy #1F3A6B (id-keyed table reaches the exports)");
    const shareScroll = await sharePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    if (!shareScroll) fail("share page scrolls horizontally at 1180px"); else ok("share page: no horizontal scroll");
    await sharePage.screenshot({ path: path.join(OUT, "share-page.png"), fullPage: true });
    ok("screenshot test/ui/out/share-page.png");
    await sharePage.close();
    await page.selectOption("[data-testid=tool-months]", "1");
  } catch (e) { fail("share page: " + errLine(e)); }
  // (d) printable view: the popup, P/B strings, OPEN red, screenshot
  try {
    const [pop] = await Promise.all([context.waitForEvent("page", { timeout: 8000 }), page.click("[data-testid=print-open]")]);
    watchPage(pop, "print");
    await pop.waitForSelector(".page .cell .shift", { timeout: 8000 });
    const printTitle = await pop.title();
    const printCell = await pop.$eval('.cell[data-day="2026-10-05"]', el => el.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
    if (!/P (Khan|Burchett|Acton|Philip|Fierce|Sarkar|OPEN)/.test(printCell) || !/B (Khan|Burchett|Acton|Philip|Fierce|Sarkar|OPEN)/.test(printCell)) fail("printable 10/5 cell lacks 'P <Name>' / 'B <Name>': " + printCell); else ok(`printable view '${printTitle}': 10/5 cell reads "${printCell}"`);
    if (dated("2026-10-15", "the 'printable 10/15 P OPEN red' pin") && (liveOpenEarly("2026-10-15", "primary") || (console.log("     (printable: 10/15 primary is held live - the OPEN-red pin has nothing to check)"), false))) {
      const printOpen = await pop.$eval('.cell[data-day="2026-10-15"] .shift .open', el => getComputedStyle(el).color).catch(() => "");
      if (!/rgb\(192, 0, 0\)/.test(printOpen)) fail("printable: 10/15 OPEN not red: " + printOpen); else ok("printable view: 10/15 P OPEN in red");
    }
    const printAtwell = await pop.$eval('.cell[data-day="2026-10-01"] .shift .ext', el => el.textContent).catch(() => "");
    if (!/Atwell/.test(printAtwell)) fail("printable: 10/1 external cover missing: " + printAtwell); else ok("printable view: 10/1 shows '" + printAtwell + "'");
    // Prompt 16 B8: the popup (window.open("") + document.write) inherits the app's CSP; its toolbar script is the
    // one static hash in script-src. Proof it RAN under that policy: the flag it sets, no violation recorded.
    const tb = await pop.evaluate(() => ({ ready: window.__silvisPrintToolbar === true, viol: Array.isArray(window.__cspViolations) ? window.__cspViolations.slice() : null, buttons: Array.from(document.querySelectorAll(".toolbar button")).map(b => b.id) }));
    if (!tb.ready) fail("printable: the toolbar script did not run under the inherited CSP (window.__silvisPrintToolbar unset; violations: " + JSON.stringify(tb.viol) + ")");
    else if (tb.viol && tb.viol.length) fail("printable: CSP violations in the popup: " + tb.viol.join(" | "));
    else ok(`printable view: toolbar script ran under the inherited CSP (buttons ${tb.buttons.join(", ")}; violations recorded: ${tb.viol ? tb.viol.length : "n/a (init script not run in the popup)"})`);
    await pop.screenshot({ path: path.join(OUT, "printable-page.png"), fullPage: true });
    ok("screenshot test/ui/out/printable-page.png");
    await pop.close();
  } catch (e) { fail("printable view: " + errLine(e)); }
  // (e) ER Call Panels: default = visible month; preset 11/2-12/13; copy; download
  try {
    const defHdr = await page.$eval("[data-testid=er-panel-preview] thead", el => el.innerText.replace(/\s+/g, " ").trim());
    if (defHdr !== "MON/SUN DATES TRAUMA TRAUMA BACKUP") fail("ER panel header: " + defHdr); else ok("ER panel header: " + defHdr);
    const defWeeks = await page.$$eval("[data-testid=er-panel-preview] tr[data-week]", els => els.map(e => e.getAttribute("data-week")));
    if (defWeeks[0] !== "2026-09-28" || defWeeks[defWeeks.length - 1] !== "2026-10-26") fail("ER panel default range is not the visible month (Oct 2026): " + defWeeks.join(",")); else ok(`ER panel default range = visible month: ${defWeeks.length} week rows ${defWeeks[0]}..${defWeeks[defWeeks.length - 1]}`);
    // exp-001: rows are whole Mon-Sun weeks - the 9/28 row lists 9/28-10/4
    // under its "9/28 - 10/4" label (never a clipped "10/1-10/4" under a
    // full-week label), the 10/26 row keeps Sunday 11/1, and the note says
    // the visible-month range was widened to whole weeks.
    const erRow928 = await page.$eval('[data-testid=er-panel-preview] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/[\t\n]+/g, " | "));
    if (!/^9\/28 - 10\/4 \| 9\/28-10\/4 Atwell/.test(erRow928) || /10\/1-10\/4/.test(erRow928)) fail("ER panel: the 9/28 row must list the whole week ('9/28-10/4 Atwell' under '9/28 - 10/4'): " + erRow928); else ok("ER panel: first row is the whole week - '9/28 - 10/4 | 9/28-10/4 Atwell'");
    const erRow1026 = await page.$eval('[data-testid=er-panel-preview] tr[data-week="2026-10-26"]', tr => tr.innerText.replace(/[\t\n]+/g, " | "));
    if (!/^10\/26 - 11\/1 \| /.test(erRow1026) || !/11\/1/.test(erRow1026.split(" | ").slice(1).join(" | "))) fail("ER panel: the 10/26 row must keep Sunday 11/1: " + erRow1026); else ok("ER panel: last October row keeps Sunday 11/1 - '" + erRow1026.slice(0, 60) + "...'");
    const erSpanNote = await page.$eval("[data-testid=er-span-note]", el => el.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
    if (!/^Whole weeks: the table runs 9\/28 - 11\/1 \(the Mon-Sun weeks around 10\/1 - 10\/31\)/.test(erSpanNote)) fail("ER panel: widened-range note missing or wrong: '" + erSpanNote + "'"); else ok("ER panel: note says the month was widened to whole weeks 9/28 - 11/1");
    const erOpenRed = await page.$eval('[data-testid=er-panel-preview] [data-kind="open"]', el => getComputedStyle(el).color).catch(() => "");
    if (erOpenRed) { if (!/rgb\(255, 0, 0\)/.test(erOpenRed)) fail("ER panel OPEN not red: " + erOpenRed); else ok("ER panel: OPEN entries red (#ff0000)"); }
    else if (liveOpenBetween("2026-09-28", "2026-11-01")) fail("ER panel: no OPEN entry in the visible-month (Oct 2026) preview although the live rows have an open slot on " + liveOpenBetween("2026-09-28", "2026-11-01"));
    else console.log("     (ER panel: no open slot in the live rows for 9/28-11/1 - the 'OPEN red' pin has nothing to check)");
    await page.click("[data-testid=er-preset-1213]");
    await page.waitForFunction(() => { const r = document.querySelectorAll("[data-testid=er-panel-preview] tr[data-week]"); return r.length === 6 && r[0].getAttribute("data-week") === "2026-11-02"; }, null, { timeout: 3000 });
    const erFromV = await page.$eval("[data-testid=er-from]", el => el.value), erToV = await page.$eval("[data-testid=er-to]", el => el.value);
    if (erFromV !== "2026-11-02" || erToV !== "2026-12-13") fail(`ER preset set ${erFromV}..${erToV}`); else ok("ER panel preset: 2026-11-02 .. 2026-12-13, 6 week rows");
    const erNoteOnAligned = await page.$("[data-testid=er-span-note]");
    if (erNoteOnAligned) fail("ER panel: the widened-range note must not show for a Mon..Sun range (11/2..12/13)"); else ok("ER panel: no widened-range note for the Mon..Sun preset");
    const erRowsText = await page.$$eval("[data-testid=er-panel-preview] tbody tr", trs => trs.map(tr => Array.from(tr.children).map(td => td.innerText.replace(/\n/g, "; ")).join(" | ")));
    erRowsText.forEach(r => console.log("     " + r));
    await page.locator("[data-testid=er-panel-preview]").screenshot({ path: path.join(OUT, "er-panel-2026-11-02-to-12-13.png") });
    ok("screenshot test/ui/out/er-panel-2026-11-02-to-12-13.png");
    await page.fill("[data-testid=er-from]", "2026-11-16"); await page.fill("[data-testid=er-to]", "2026-11-22");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=er-panel-preview] tr[data-week]").length === 1, null, { timeout: 3000 }).then(() => ok("ER panel: typed range 11/16..11/22 -> one week row")).catch(() => fail("ER panel: typed range did not narrow to one row"));
    await page.click("[data-testid=er-preset-1213]");
    await page.waitForTimeout(200);
    // Copy for Word is asserted on a MOCK of navigator.clipboard.write: it
    // records every ClipboardItem flavour the app hands over (the real system
    // clipboard is not readable on every runner), then delegates to the real
    // write so the production path still runs end to end.
    await page.evaluate(() => {
      window.__clipWrites = [];
      const real = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = async (items) => {
        const rec = [];
        for (const it of items) { const flavours = {}; for (const t of it.types) flavours[t] = await (await it.getType(t)).text(); rec.push(flavours); }
        window.__clipWrites.push(rec);
        return real(items);
      };
    });
    await page.click("[data-testid=er-copy]");
    await page.waitForTimeout(500);
    const clipWrites = await page.evaluate(() => window.__clipWrites || []);
    const toastText = (((await page.evaluate(() => document.body.innerText)) || "").match(/(Copied - paste into the Word document[^\n]*|Clipboard blocked[^\n]*)/) || [])[1] || "";
    const item = clipWrites.length === 1 && clipWrites[0].length === 1 ? clipWrites[0][0] : null;
    const clipHtml = item ? item["text/html"] || "" : "", clipText = item ? item["text/plain"] || "" : "";
    const erOpenDays = daysBetween("2026-11-02", "2026-12-13").filter(d => d >= todayIso && (liveOpen(d, "primary") || liveOpen(d, "backup")));
    const erHasOpenSpan = /<span data-kind="open" style="color:#ff0000;font-weight:bold">/.test(clipHtml);
    if (!item) fail(`Copy for Word: expected exactly one navigator.clipboard.write call with one ClipboardItem, saw ${JSON.stringify(clipWrites.map(w => w.map(i => Object.keys(i))))}; toast "${toastText}"`);
    else if (!clipHtml.startsWith('<table data-export="er-call-panels"') || (clipHtml.match(/<tr data-week=/g) || []).length !== 6 || !/MON\/SUN DATES<\/th><th [^>]*>TRAUMA<\/th><th [^>]*>TRAUMA BACKUP<\/th>/.test(clipHtml)) fail("Copy for Word: text/html flavour is not the 6-row ER table: " + clipHtml.slice(0, 200));
    // Prompt 12 SM2: a red OPEN span is expected exactly while the panel's range 11/2-12/13 still has an
    // open slot on/after today in the live rows (none since the 9/23 overnight publish) - derived, not pinned.
    else if (erHasOpenSpan !== (erOpenDays.length > 0)) fail(`Copy for Word: red OPEN span ${erHasOpenSpan ? "present" : "missing"} in text/html while the live rows leave ${erOpenDays.length} day(s) with an open slot on/after today in 11/2-12/13${erOpenDays.length ? " (" + erOpenDays.slice(0, 4).join(", ") + ")" : ""}`);
    else if (!/^MON\/SUN DATES\tTRAUMA\tTRAUMA BACKUP\n11\/2 - 11\/8\t/.test(clipText) || clipText.split("\n").length !== 7) fail("Copy for Word: text/plain flavour wrong: " + clipText.slice(0, 120));
    else if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(clipHtml + clipText)) fail("Copy for Word: an email address is on the clipboard");
    else if (!/^Copied - paste into the Word document/.test(toastText)) fail(`Copy for Word: flavours written but the toast reads "${toastText}"`);
    else ok(`Copy for Word: one clipboard write with ${Object.keys(item).join(" + ")} - 6-row ER table (inline styles${erOpenDays.length ? ", red OPEN spans" : ", no OPEN span - the range is fully assigned in the live rows"}) + tab-separated text; toast "${toastText}"`);
    const clip = await page.evaluate(async () => {
      try { const items = await navigator.clipboard.read(); const out = {}; for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return { ok: true, types: Object.keys(out), rows: ((out["text/html"] || "").match(/<tr data-week=/g) || []).length }; }
      catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    });
    console.log(`     (system clipboard read-back: ${clip.ok ? clip.types.join(" + ") + ", " + clip.rows + " rows in text/html" : "unavailable - " + clip.error})`);
    const erDl = await saveDownload(() => page.click("[data-testid=er-download]"));
    if (erDl.name !== "silvis-er-call-panels-2026-11-02-2026-12-13.html" || !erDl.text.includes('data-export="er-call-panels"') || (erDl.text.match(/<tr data-week=/g) || []).length !== 6) fail("ER panel download wrong: " + erDl.name); else ok("ER panel download: " + erDl.name + " (6 week rows)");
    await page.click("[data-testid=er-reset]");
  } catch (e) { fail("ER panel: " + errLine(e)); }
  // (f) My schedule: Download my calendar -> silvis-call-khan.ics
  try {
    await page.click('button[data-tab="myschedule"]');
    await page.waitForSelector("[data-testid=download-my-calendar]", { timeout: 5000 });
    const mine = await saveDownload(() => page.click("[data-testid=download-my-calendar]"));
    const n = (mine.text.match(/BEGIN:VEVENT/g) || []).length;
    if (mine.name !== "silvis-call-khan.ics" || !mine.text.startsWith("BEGIN:VCALENDAR\r\n") || /TZID=|T070000/.test(mine.text) || (n > 0 && (!/UID:silvis-\d{4}-\d{2}-\d{2}-(primary|backup)@silvis-call/.test(mine.text) || !/DTSTART;VALUE=DATE:\d{8}\r\n/.test(mine.text)))) fail("My schedule ics wrong: " + mine.name + " " + mine.text.slice(0, 200).replace(/\r\n/g, " | ")); else ok(`My schedule: ${mine.name} (${n} all-day run events, stable UIDs silvis-<start>-<role>)`);
    await page.screenshot({ path: path.join(OUT, "myschedule-export.png"), fullPage: false });
  } catch (e) { fail("My schedule ics: " + errLine(e)); }
  await showMonth(2026, 9);

  // ---- Slice D: the day editor for 2026-10-15 ----
  // The expected reasons come from 10/15's SERVED row, never a pin. Until 9/25 the day was open and the pin read
  // 'Sarkar - outside-window'; the scheduler then filled it (9/25 15:24 CDT: Burchett primary, locked, Khan backup).
  // A primary locked to H: every other option is greyed with 'slot-locked:H' as its FIRST hard reason (the slot facts
  // lead eligibility()'s list), H's own option stays eligible, and the 'Not eligible' line reads '<Name> - slot locked
  // to <H's name>' for each greyed option. A primary that is not locked: the lock half says so and is not exercised.
  // The window reason (the pre-9/25 pin) runs on its own derived day right after this editor closes.
  await page.click('[data-day="2026-10-15"]');
  await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
  const edTitle = await page.$eval("[data-testid=editor-title]", el => el.textContent);
  if (!/Thu October 15, 2026/.test(edTitle)) fail("day editor title wrong: " + edTitle); else ok("day editor opened: " + edTitle);
  const readEditorOpts = () => page.$$eval("[data-testid=editor-primary] option", els => els.map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
  const pOpts = await readEditorOpts();
  const greyed = pOpts.filter(o => o.eligible === "false");
  if (!greyed.length || !greyed.every(o => / - [a-z-]+/.test(o.text))) fail("day editor 10/15: no greyed primary option with a reason: " + JSON.stringify(pOpts)); else ok(`day editor 10/15: ${greyed.length} greyed primary option(s) with a reason, e.g. "${greyed[0].text}"`);
  const lastEligible = pOpts.map(o => o.eligible).lastIndexOf("true"), firstIneligible = pOpts.map(o => o.eligible).indexOf("false");
  if (firstIneligible >= 0 && lastEligible > firstIneligible) fail("day editor: options are not eligible-first: " + pOpts.map(o => o.eligible[0] + ":" + o.text).join(" | ")); else ok("day editor: eligible options listed first");
  const reasonsText = await page.$eval("[data-testid=editor-primary-reasons]", el => el.textContent).catch(() => "");
  {
    const r1015 = liveByDay["2026-10-15"] || null;
    const lockH = r1015 && r1015.primary_locked && r1015.primary_id ? r1015.primary_id : null;
    if (!lockH) console.log(`     (day editor 10/15: the served row's primary is not locked (${JSON.stringify(r1015 && { primary_id: r1015.primary_id, primary_locked: r1015.primary_locked, external_cover: r1015.external_cover })}) - the lock-reason half is not exercised; the window reason runs on its derived day below)`);
    else {
      const hName = rosterNameOf(lockH);
      const holderOpt = pOpts.find(o => o.value === lockH);
      const others = pOpts.filter(o => o.value && o.value !== lockH);
      const badOpt = others.filter(o => o.eligible !== "false" || o.text !== `${rosterNameOf(o.value)} - slot-locked:${lockH}`);
      const missingWords = others.filter(o => !reasonsText.includes(`${rosterNameOf(o.value)} - slot locked to ${hName}`));
      if (!holderOpt || holderOpt.eligible !== "true") fail(`day editor 10/15: the lock holder ${hName} (${lockH}, primary locked in the served row) should be an eligible option: ${JSON.stringify(holderOpt)}`);
      else if (!others.length || badOpt.length) fail(`day editor 10/15: every option but the lock holder ${hName} must be greyed with its first hard reason 'slot-locked:${lockH}' (the served row locks the primary): ${JSON.stringify((badOpt.length ? badOpt : pOpts).slice(0, 6))}`);
      else ok(`day editor 10/15: the served row locks the primary to ${hName} - ${others.length} other option(s) greyed 'slot-locked:${lockH}' (e.g. "${others[0].text}"), "${holderOpt.text}" eligible`);
      if (!others.length || missingWords.length) fail(`day editor 10/15: the 'Not eligible' line should read '<Name> - slot locked to ${hName}' for ${missingWords.map(o => rosterNameOf(o.value)).join(", ") || "every greyed option"}: ${reasonsText}`);
      else ok(`day editor 10/15: the reason line maps the code to words for all ${others.length} ("${rosterNameOf(others[0].value)} - slot locked to ${hName}")`);
    }
  }
  const eastLines = await page.$$eval("[data-testid=east-status]", els => els.map(e => e.textContent));
  if (eastLines.length < 2) fail("day editor: East status lines missing (expected Khan + Fierce): " + JSON.stringify(eastLines)); else ok("day editor East status: " + eastLines.join(" || "));
  await page.screenshot({ path: path.join(OUT, "day-editor-2026-10-15.png"), fullPage: false });
  ok("screenshot test/ui/out/day-editor-2026-10-15.png");
  // arrow key moves a day (clean draft), Esc closes
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const navTitle = await page.$eval("[data-testid=editor-title]", el => el.textContent).catch(() => "");
  if (!/Fri October 16, 2026/.test(navTitle)) fail("ArrowRight did not move the editor to 10/16: " + navTitle); else ok("ArrowRight moves the editor to Fri October 16, 2026");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).then(() => ok("Esc closes the day editor")).catch(() => fail("Esc did not close the day editor"));

  // ---- Slice D (window reason, derived since 9/25): the windows surgeon greyed 'outside-window' where it applies ----
  // Was pinned to 10/15 (open until 9/25). The surgeon is the one whose surgeonRules in the live blob carry
  // availableWindows (Sarkar); the candidate days are the served rows on/after today, Mon-Fri, outside every window,
  // whose primary is neither locked nor externally covered (a slot fact would lead the list), that she holds in neither
  // role and that sit off every holiday unit of the blob. Premise from the rules' own picture (the App's rulesCtxState
  // memo, the same walk as the Item E2 block below, with the editor closed): outside-window must be among her hard
  // reasons on EVERY candidate - the first 40 in date order (FAIL otherwise - that rule is what is under test; rdStatic
  // has no early return before it, so it is always collected); the day used is the first where it is
  // her FIRST hard reason (the editor shows hard[0]; a vacation or a dated row may come first on some days). The editor
  // must then grey her option '<Name> - outside-window' and its 'Not eligible' line must read '<Name> - outside the
  // availability window'. No candidate, or none where the window reason comes first = a console line, never a silent pass.
  try {
    const sRules = (liveBlobData && liveBlobData.surgeonRules) || {};
    const winId = Object.keys(sRules).find(id => sRules[id] && Array.isArray(sRules[id].availableWindows) && sRules[id].availableWindows.length) || null;
    if (!winId) console.log("     (day editor window reason: no surgeon in the live blob has availableWindows - not exercised)");
    else {
      const wins = sRules[winId].availableWindows.filter(w => w && w.start && w.end);
      const winName = rosterNameOf(winId);
      const wdOf = (d) => new Date(d + "T12:00:00Z").getUTCDay();
      const cands = liveRows.filter(r => r.day >= todayIso && wdOf(r.day) >= 1 && wdOf(r.day) <= 5 && !wins.some(w => r.day >= w.start && r.day <= w.end) && !r.primary_locked && !r.external_cover && r.primary_id !== winId && r.backup_id !== winId && !holidayUnitDays.has(r.day)).map(r => r.day).slice(0, 40);
      if (!cands.length) console.log(`     (day editor window reason: no weekday on/after today ${todayIso} in the served rows lies outside ${winName}'s windows with an unlocked, uncovered primary she holds in neither role - not exercised)`);
      else {
        const rh = await page.evaluate(([days, id]) => {
          const rootEl = document.getElementById("root");
          const ck = rootEl && Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
          if (!ck) return { error: "no React container key on #root" };
          const hostRoot = rootEl[ck], current = (hostRoot && hostRoot.stateNode && hostRoot.stateNode.current) || hostRoot;
          let ctx = null, n = 0; const stack = [current];
          while (stack.length && !ctx && n++ < 500000) {
            const f = stack.pop(); if (!f) continue;
            if (f.tag === 0 || f.tag === 11 || f.tag === 15) for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) { const v = h.memoizedState; if (Array.isArray(v) && v[0] && typeof v[0] === "object" && "error" in v[0] && v[0].ctx && v[0].ctx.per && v[0].ctx.holidayByDay && v[0].ctx.schedule) { ctx = v[0].ctx; break; } }
            if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
          }
          if (!ctx) return { error: "the App's rulesCtxState memo was not found on the committed React tree" };
          if (typeof eligibility !== "function") return { error: "eligibility() is not a page global" };
          const out = {};
          days.forEach(d => { try { out[d] = (eligibility(ctx, d, "primary", id) || {}).hard || []; } catch (e) { out[d] = ["threw: " + String(e && e.message || e)]; } });
          return { out };
        }, [cands, winId]);
        if (rh.error) fail("day editor window reason: " + rh.error);
        else {
          const noWin = cands.filter(d => !rh.out[d].includes("outside-window"));
          const winDay = cands.find(d => rh.out[d][0] === "outside-window") || null;
          if (noWin.length) fail(`day editor window reason: the rules do not report outside-window for ${winName} on ${noWin.length} of ${cands.length} served day(s) outside every window: ${noWin.slice(0, 4).map(d => d + " [" + rh.out[d].join(", ") + "]").join("; ")}`);
          else if (!winDay) console.log(`     (day editor window reason: on all ${cands.length} candidate day(s) an earlier hard reason leads ${winName}'s list (e.g. ${cands[0]}: ${rh.out[cands[0]][0]}) - the editor's window wording is not exercised this run)`);
          else {
            await showMonth(Number(winDay.slice(0, 4)), Number(winDay.slice(5, 7)) - 1);
            await page.click(`[data-day="${winDay}"]`);
            await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
            const wOpts = await readEditorOpts();
            const wOpt = wOpts.find(o => o.value === winId);
            const wReasons = await page.$eval("[data-testid=editor-primary-reasons]", el => el.textContent).catch(() => "");
            const r = liveByDay[winDay];
            if (!wOpt || wOpt.eligible !== "false" || wOpt.text !== `${winName} - outside-window`) fail(`day editor ${winDay}: ${winName} should be greyed '${winName} - outside-window' (outside every window, primary ${r.primary_id ? rosterNameOf(r.primary_id) : "OPEN"} unlocked): ${JSON.stringify(wOpt || wOpts)}`);
            else ok(`day editor ${winDay} (derived: the first weekday on/after today outside ${winName}'s windows with an unlocked primary, ${r.primary_id ? rosterNameOf(r.primary_id) : "OPEN"}): "${wOpt.text}" (window/hard reason)`);
            if (!wReasons.includes(`${winName} - outside the availability window`)) fail(`day editor ${winDay}: plain-English reason line missing for ${winName}: ${wReasons}`);
            else ok(`day editor ${winDay}: reason line maps the code to words (${winName} - outside the availability window)`);
            await page.screenshot({ path: path.join(OUT, "day-editor-window-reason.png"), fullPage: false });
            ok("screenshot test/ui/out/day-editor-window-reason.png");
          }
        }
      }
    }
  } catch (e) { fail("day editor window reason: " + errLine(e)); }
  finally {
    if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => fail("day editor window reason: Esc did not close the editor")); }
  }

  // ---- November 2026 (Item E2, Faraz 9/25): a CLEAN month grid for the scheduler too ----
  // Item E (9/24) had kept the E (East-derived week) and F / f (East forecast) badges for the scheduler; Item E2 took
  // them off the grid for everyone ("it makes it busy ... just want to improve readability"): no [data-badge="E"] / "F"
  // / "f" in any cell, no "East-derived:" in any cell title, no "East-derived week" / "East forecast" legend line -
  // proven on a grid that actually LOADED (cells and filled cells > 0), so a clean grid is never an empty one. The
  // confirm badge and the East-vacation diamonds are not part of it and keep their own checks. The East information
  // must still reach the scheduler through the day editor - the block after the screenshot proves that.
  await showMonth(2026, 10);
  const novCells = await readCells();
  {
    const novTitles = await page.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), title: e.getAttribute("title") || "" })));
    const novLegend = await page.$eval(".cal-legend", el => el.innerText.replace(/\s+/g, " "));
    const novFilled = novCells.filter(c => c.p || c.ext).length;
    const novEastBadges = novCells.filter(c => c.badges.some(b => b === "E" || b === "F" || b === "f"));
    const novEastHover = novTitles.filter(c => /East-derived:/.test(c.title));
    if (!novCells.length || !novFilled) fail(`Item E2 (scheduler, 1180): November 2026 never loaded (${novCells.length} cells, ${novFilled} filled) - a clean grid must not be an empty one`);
    else if (novEastBadges.length || novEastHover.length) fail(`Item E2 (scheduler, 1180): November 2026 still shows East markings to the scheduler - badges on ${novEastBadges.map(c => c.day + ":" + c.badges.join("")).slice(0, 6).join(", ") || "none"}; 'East-derived:' hover on ${novEastHover.length} day(s)${novEastHover.length ? " (" + novEastHover.slice(0, 3).map(c => c.day).join(", ") + ")" : ""}`);
    else if (/East-derived/.test(novLegend) || /East forecast/.test(novLegend)) fail("Item E2 (scheduler, 1180): the legend still carries an East line: " + novLegend.slice(0, 220));
    else ok(`Item E2 (scheduler, 1180): November 2026 grid has no E / F / f badge and no 'East-derived:' hover bit (${novCells.length} cells, ${novFilled} filled) and the legend has no 'East-derived week' / 'East forecast' line`);
  }
  await page.screenshot({ path: path.join(OUT, "calendar-nov-2026.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-nov-2026.png");

  // ---- Item E2 (scheduler): the day editor still carries the East status the grid dropped ----
  // The rules' own picture first - the App's rulesCtxState memo on the committed React tree (the same walk as the Item C
  // restatement further down; the editor is closed here, so the App's memo is the only rules context on the tree). Then
  // the days of a month are opened one by one in the day editor (the 1st by a click on its cell, then ArrowRight - the
  // editor's own day navigation, the grid follows it) and its [data-testid=east-status] lines are read. Two halves, each
  // on the FIRST month from November 2026 on (12 months scanned) where the rules hold something East:
  //  (a) derived weeks - ctx.derivedByDay (Fierce's derived week, 11/9-11/15 today): the editor's "East week -> Silvis
  //      <role> (derived)" lines fall on EXACTLY the rules' derived days of that month, with the rules' role(s);
  //  (b) the forecast - the first month with a forecast day of 20% or more (the retired f badge's floor) that the editor
  //      words as a forecast: the editor's "East forecast NN% (treated as busy | below the NN% threshold)" lines are
  //      EXACTLY the rules' - same days, same percentages, same busy wording (at / above ctx.forecastThreshold). The
  //      rules' list mirrors eastStatusLines' order of precedence: a numeric ctx.per[id].eastForecast[d] outside
  //      ctx.eastCoverage, on a day that is not a standing East day, not published / override busy (P.eastBusy) and not
  //      an override busy:false day (the editor words all of those differently).
  // Fix round (review 9/25): the months come from the rules, not a fixed November - once Davenport publishes November,
  // forecastOutsideCoverage prunes every November forecast day and a fixed month would fail on good data - and the
  // forecast half demands every line, not just one. Nothing East in all 12 months fails loudly: the check must never
  // pass on an empty picture. The grid goes back to November 2026 afterwards (the confirm-badge checks below click 11/26
  // and 11/25). novEastSummary feeds the surgeon message below and says "shows" only when both halves passed.
  let novEastSummary = "the day-editor East check did not run";
  try {
    const MONTHS_E2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const rulesEast = await page.evaluate(() => {
      const rootEl = document.getElementById("root");
      const ck = rootEl && Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
      if (!ck) return { error: "no React container key on #root" };
      const hostRoot = rootEl[ck], current = (hostRoot && hostRoot.stateNode && hostRoot.stateNode.current) || hostRoot;
      let ctx = null, n = 0; const stack = [current];
      while (stack.length && !ctx && n++ < 500000) {
        const f = stack.pop(); if (!f) continue;
        if (f.tag === 0 || f.tag === 11 || f.tag === 15) for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) { const v = h.memoizedState; if (Array.isArray(v) && v[0] && typeof v[0] === "object" && "error" in v[0] && v[0].ctx && v[0].ctx.per && v[0].ctx.holidayByDay && v[0].ctx.schedule) { ctx = v[0].ctx; break; } }
        if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
      }
      if (!ctx) return { error: "the App's rulesCtxState memo was not found on the committed React tree" };
      const cov = ctx.eastCoverage || null;
      const months = [];
      for (let i = 0; i < 12; i++) {
        const y = 2026 + Math.floor((10 + i) / 12), m0 = (10 + i) % 12, last = new Date(y, m0 + 1, 0).getDate();
        const days = []; for (let d = 1; d <= last; d++) days.push(y + "-" + String(m0 + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0"));
        const derived = days.filter(d => ctx.derivedByDay && ctx.derivedByDay[d] && Object.keys(ctx.derivedByDay[d]).length > 0).map(d => ({ day: d, roles: Object.keys(ctx.derivedByDay[d]).sort().join("+") }));
        const forecast = [];
        Object.keys(ctx.per || {}).forEach(id => {
          const P = ctx.per[id], fc = P && P.eastForecast;
          if (!fc) return;
          days.forEach(d => {
            const p = fc[d];
            if (typeof p !== "number") return;
            const standing = P.eastStanding && P.eastStanding.size ? P.eastStanding.get(d.slice(5)) : null;
            const busy = !!(P.eastBusy && P.eastBusy.has(d)), ovFree = !!(P.eastOverrides && P.eastOverrides[d] === false), covered = !!(cov && d >= cov.from && d <= cov.to);
            if (standing || busy || ovFree || covered) return;
            forecast.push({ day: d, id, pct: Math.round(p * 100), busy: p >= ctx.forecastThreshold, p20: p >= 0.2 });
          });
        });
        months.push({ y, m0, last, derived, forecast });
      }
      return { months, threshold: ctx.forecastThreshold };
    });
    if (rulesEast.error) throw new Error("could not read the rules context: " + rulesEast.error);
    const monthLabel = (mo) => MONTHS_E2[mo.m0] + " " + mo.y;
    const scanWindow = monthLabel(rulesEast.months[0]) + " - " + monthLabel(rulesEast.months[rulesEast.months.length - 1]);
    const dMonth = rulesEast.months.find(mo => mo.derived.length > 0) || null;
    const fMonth = rulesEast.months.find(mo => mo.forecast.some(f => f.p20)) || null;
    // the editor pass over one month (cached - both halves may land on the same month): the 1st by a click on its cell,
    // then ArrowRight day by day, waiting for each day's title before reading its East lines
    const scans = new Map();
    const scanMonth = async (mo) => {
      const k = mo.y + "-" + mo.m0;
      if (scans.has(k)) return scans.get(k);
      await showMonth(mo.y, mo.m0);
      const pre = mo.y + "-" + String(mo.m0 + 1).padStart(2, "0") + "-";
      const out = {};
      await page.click(`[data-day="${pre}01"]`);
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      for (let n = 1; n <= mo.last; n++) {
        if (n > 1) await page.keyboard.press("ArrowRight");
        await page.waitForFunction((t) => { const el = document.querySelector("[data-testid=editor-title]"); return !!el && el.textContent.trim().endsWith(t); }, " " + MONTHS_E2[mo.m0] + " " + n + ", " + mo.y, { timeout: 5000 });
        out[pre + String(n).padStart(2, "0")] = await page.$$eval("[data-testid=day-editor] [data-testid=east-status]", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
      }
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
      scans.set(k, out);
      return out;
    };
    const DERIVED_RE = /: East week -> Silvis (primary|backup) \(derived\)/;
    const FC_RE = /: East forecast (\d+)% \((treated as busy|below the \d+% threshold)\)/;
    let derivedPass = "", forecastPass = "";
    // (a) derived weeks: the editor names exactly the rules' derived days, with the rules' role(s)
    if (!dMonth) fail(`Item E2 (scheduler, day editor): the rules context derives no Silvis role on any day ${scanWindow} (Fierce's East-derived weeks from the east_feed cache / the seed's statedWeeks expected - 11/9-11/15 today) - the derived-week half would prove nothing`);
    else {
      const scan = await scanMonth(dMonth);
      const want = dMonth.derived.map(x => x.day + " " + x.roles);
      const got = Object.keys(scan).map(d => { const roles = scan[d].map(t => DERIVED_RE.exec(t)).filter(Boolean).map(m => m[1]).sort(); return roles.length ? d + " " + roles.join("+") : null; }).filter(Boolean);
      if (want.join("|") !== got.join("|")) fail(`Item E2 (scheduler, day editor): ${monthLabel(dMonth)} - the editor's 'East week -> Silvis <role> (derived)' days (${got.length}: ${got.join(", ") || "none"}) differ from the rules' derived days (${want.length}: ${want.join(", ")})`);
      else {
        derivedPass = `${want.length} derived day(s) of ${monthLabel(dMonth)}`;
        ok(`Item E2 (scheduler, day editor): ${monthLabel(dMonth)} (the first month from November 2026 with a derived week) - 'East week -> Silvis <role> (derived)' on exactly the ${want.length} day(s) the rules derive, same role(s) (${want[0]} .. ${want[want.length - 1]}), e.g. "${(scan[dMonth.derived[0].day].find(t => DERIVED_RE.test(t)) || "").slice(0, 90)}"`);
      }
    }
    // (b) the forecast: every rules forecast day of the month reads 'East forecast NN% (...)' with the rules' own
    // percentage and busy wording, and the editor shows no forecast line the rules do not hold
    if (!fMonth) fail(`Item E2 (scheduler, day editor): the rules context has no East forecast day of 20% or more that the day editor would word as a forecast (outside the published coverage; not standing, busy or override-cleared) on any day ${scanWindow} (east_forecast rows from 11/16 expected while Davenport is unpublished) - the forecast half would prove nothing`);
    else {
      const scan = await scanMonth(fMonth);
      const fkey = (f) => f.day + " " + f.pct + "% " + (f.busy ? "busy" : "below");
      const want = fMonth.forecast.map(fkey).sort();
      const got = []; Object.keys(scan).forEach(d => scan[d].forEach(t => { const m = FC_RE.exec(t); if (m) got.push(fkey({ day: d, pct: Number(m[1]), busy: m[2] === "treated as busy" })); })); got.sort();
      const busyN = fMonth.forecast.filter(f => f.busy).length, p20N = fMonth.forecast.filter(f => f.p20).length;
      if (want.join("|") !== got.join("|")) {
        const missing = want.filter(x => !got.includes(x)), extra = got.filter(x => !want.includes(x));
        const probe = (missing[0] || extra[0] || "").slice(0, 10);
        fail(`Item E2 (scheduler, day editor): ${monthLabel(fMonth)} - the editor's 'East forecast NN%' lines differ from the rules' (${want.length} expected, ${got.length} read): missing ${missing.slice(0, 6).join(", ") || "none"}; not in the rules ${extra.slice(0, 6).join(", ") || "none"}${probe ? "; the editor's East lines on " + probe + ": " + JSON.stringify(scan[probe] || []) : ""}`);
      } else {
        const eg = fMonth.forecast.find(f => f.busy) || fMonth.forecast.find(f => f.p20);
        forecastPass = `${want.length} forecast day(s) of ${monthLabel(fMonth)}`;
        ok(`Item E2 (scheduler, day editor): ${monthLabel(fMonth)} (the first month from November 2026 with a forecast day of 20%+ outside the published coverage) - all ${want.length} rules forecast day(s) read 'East forecast NN%' with the rules' percentage and wording, none extra (${p20N} at 20%+; ${busyN ? busyN + " 'treated as busy' at or above " + Math.round(rulesEast.threshold * 100) + "%" : "none at or above the " + Math.round(rulesEast.threshold * 100) + "% threshold this month"}; e.g. ${eg.day} ${eg.pct}%)`);
      }
    }
    novEastSummary = derivedPass && forecastPass ? `the scheduler's day editor shows the rules' ${derivedPass} and ${forecastPass}` : "the scheduler's day-editor East check FAILED above";
    await showMonth(2026, 10);
  } catch (e) {
    novEastSummary = "the scheduler's day-editor East check threw above";
    fail("Item E2 (scheduler, day editor): the East-status pass threw: " + errLine(e));
    if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); }
    await showMonth(2026, 10).catch(() => {});
  }

  // ---- Item E (Faraz 9/24; Item E2 9/25): surgeons get the clean grid too ----
  // Since Item E2 the scheduler's own grid is clean as well (asserted above); this pass keeps the surgeon side: a surgeon
  // (a second page routed as role surgeon, roster s2) gets a clean grid on the same month - no [data-badge="E"] / "F" /
  // "f" in the grid, no "East-derived:" hover bit, no "East-derived" / "East forecast" legend line - at 390 px in both
  // themes. Dark runs first so the shared localStorage ends light again. The confirm badge and the vacation dots are not
  // East information and stay for everyone; the day editor and Setup > East feed are untouched (display only).
  {
    const SURG_UID = "00000000-0000-4000-8000-00000000e0e0";
    const SURG_PROFILE = { id: SURG_UID, person_id: "s2", role: "surgeon", display_name: "Burchett", email: null, created_at: "2026-09-24T00:00:00Z" };
    const SURG_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: SURG_UID, role: "authenticated", email: "surgeon@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
    const sp = await context.newPage();
    watchPage(sp, "surgeon");
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, SURG_JWT);
    await sp.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    await sp.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(SURG_PROFILE));
    sp.on("dialog", (d) => d.accept());
    try {
      await loadWithRetry(sp, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "surgeon page (item E)");
      await sp.waitForSelector("text=Synced", { timeout: 30000 });
      await sp.waitForTimeout(800);
      const tabsS = await sp.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
      if (tabsS.includes("setup")) fail("Item E (surgeon): the mocked surgeon page shows a Setup tab - it is being treated as the scheduler, so the clean-grid checks below prove nothing: " + tabsS.join(","));
      for (const theme of ["dark", "light"]) {
        await sp.click('button[data-tab="settings"]');
        await sp.click(`button:has-text('${theme === "dark" ? "Dark" : "Light"}')`);
        await sp.click('button[data-tab="calendar"]');
        await sp.waitForSelector("[data-testid=cal-grid]", { timeout: 10000 });
        await sp.selectOption("[data-testid=cal-month-select]", "10");
        if ((await sp.$eval("[data-testid=cal-year-input]", el => el.value)) !== "2026") await sp.fill("[data-testid=cal-year-input]", "2026");
        await sp.waitForFunction(() => { const el = document.querySelector("[data-testid=cal-month]"); return !!el && el.textContent.trim() === "November 2026"; }, null, { timeout: 10000 });
        await sp.waitForTimeout(300);
        const themeOn = await sp.evaluate(() => { try { return localStorage.getItem("silvis-dark-mode") === "true" ? "dark" : "light"; } catch (e) { return "?"; } });
        const cellsS = await sp.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary"), ext: e.getAttribute("data-ext"), title: e.getAttribute("title") || "", badges: Array.from(e.querySelectorAll("[data-badge]")).map(x => x.getAttribute("data-badge")) })));
        const eastCells = cellsS.filter(c => c.badges.some(b => b === "E" || b === "F" || b === "f"));
        const hoverCells = cellsS.filter(c => /East-derived:/.test(c.title));
        const legendS = await sp.$eval(".cal-legend", el => el.innerText.replace(/\s+/g, " "));
        const filledS = cellsS.filter(c => c.p || c.ext).length;
        if (themeOn !== theme) fail(`Item E (surgeon, 390 ${theme}): the theme toggle did not take (silvis-dark-mode reads ${themeOn})`);
        else if (!cellsS.length || !filledS) fail(`Item E (surgeon, 390 ${theme}): November 2026 never loaded for the surgeon page (${cellsS.length} cells, ${filledS} filled) - a clean grid must not be an empty one`);
        else if (eastCells.length || hoverCells.length) fail(`Item E (surgeon, 390 ${theme}): November 2026 still shows East information to a surgeon - badges on ${eastCells.map(c => c.day + ":" + c.badges.join("")).slice(0, 6).join(", ")}; 'East-derived:' hover on ${hoverCells.length} day(s)`);
        else if (/East-derived/.test(legendS) || /East forecast/.test(legendS)) fail(`Item E (surgeon, 390 ${theme}): the legend still carries the East lines: ${legendS.slice(0, 220)}`);
        else ok(`Item E (surgeon, 390 ${theme}): November 2026 grid has no E / F / f badge and no 'East-derived:' hover bit (${cellsS.length} cells, ${filledS} filled; ${novEastSummary}) and the legend has no 'East-derived' / 'East forecast' line`);
        await sp.screenshot({ path: path.join(OUT, `calendar-nov-2026-surgeon-390-${theme}.png`), fullPage: true });
      }
      ok("screenshots test/ui/out/calendar-nov-2026-surgeon-390-dark.png / -light.png");
    } catch (e) { fail("Item E (surgeon): the surgeon page check threw: " + String(e && e.message || e).split("\n")[0]); }
    await sp.close();
  }

  // ---- Prompt 12 B / Z: the "confirm" badge follows the schedule_days note; Thanksgiving is confirmed -> no badge ----
  // The importer writes 'awaiting confirmation - seed: ...' on a row flagged awaitingConfirmation in the seed, and a
  // LOCKED day whose note starts with that marker shows the badge in the grid cell and beside the padlock in the day
  // editor. Item B flagged the four Thanksgiving rows 11/26-29; Faraz confirmed them on 9/22 (late evening, Prompt 12 Z),
  // so the seed flags nothing and NO day shows the badge - 11/26 (the unit) and 11/25 (Khan's separate 9/22 one-off)
  // alike; the marker feature itself stays in the app (test/data-layer.test.js) for future provenance flags.
  // Against the LIVE project the two 11/26 checks FAIL as expected drift until the item-Z seed import is applied (the
  // live notes still carry the marker from the item-B import - same as the Import dry run checks); SMOKE_FIXTURE=1
  // serves the seed through the importer and must pass.
  const tg26 = novCells.find(c => c.day === "2026-11-26"), tg25 = novCells.find(c => c.day === "2026-11-25");
  // review Z-1: the "expected drift" caveat is derived from the row the app rendered (fixture row, or one read-only anon
  // read of the live 2026-11-26 row), never asserted blindly - once the item-Z seed is applied live the note carries no
  // marker, and a badge on 11/26 is then a REGRESSION of the badge predicate, not drift.
  const tg26Note = await (async () => {
    try {
      if (fixture) { const r = fixture.schedule_days.find(x => x.day === "2026-11-26"); return r ? (r.note || "") : null; }
      const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/schedule_days?day=eq.2026-11-26&select=note`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } });
      if (!res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) && rows.length ? (rows[0].note || "") : null;
    } catch (e) { return null; }
  })();
  const tg26Caveat = tg26Note === null ? " - the 2026-11-26 row note could not be read, so drift vs regression is undetermined"
    : /^awaiting confirmation - /.test(tg26Note) ? " - expected drift until the item-Z seed import is applied live (the row note still starts with the 'awaiting confirmation - ' marker)"
    : " - REGRESSION: the row note carries no marker (" + JSON.stringify(tg26Note.slice(0, 80)) + "), so the badge predicate is wrong";
  // Prompt 12 Z FLIP (was: the badge expected on 11/26 with its 13px-gutter geometry check, item B / review B-2)
  if (!tg26) fail("2026-11-26 grid cell not found in the November grid");
  else if (tg26.badges.includes("confirm")) fail("2026-11-26 grid cell still shows the 'confirm' badge (badges " + JSON.stringify(tg26.badges) + ")" + tg26Caveat);
  else ok("2026-11-26 grid cell shows no 'confirm' badge (Thanksgiving confirmed by Faraz 9/22, Prompt 12 Z)");
  if (tg25 && tg25.badges.includes("confirm")) fail("2026-11-25 (Khan's one-off, not flagged) must not show a 'confirm' badge"); else ok("2026-11-25 grid cell shows no 'confirm' badge");
  await page.click('[data-day="2026-11-26"]');
  await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
  const edBadge26Count = await page.locator("[data-testid=day-editor] [data-testid=confirm-badge]").count();
  // Prompt 12 Z FLIP (was: badge visible beside the padlock with title "awaiting the scheduler's confirmation", item B)
  if (edBadge26Count) fail("day editor 2026-11-26: 'confirm' badge still shown (" + edBadge26Count + ")" + tg26Caveat);
  else ok("day editor 2026-11-26: no 'confirm' badge (Thanksgiving confirmed by Faraz 9/22, Prompt 12 Z)");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
  await page.click('[data-day="2026-11-25"]');
  await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
  const edBadge25Count = await page.locator("[data-testid=day-editor] [data-testid=confirm-badge]").count();
  if (edBadge25Count) fail("day editor 2026-11-25: unexpected 'confirm' badge (" + edBadge25Count + ") - 11/25 is Khan's separate 9/22 decision, not flagged"); else ok("day editor 2026-11-25: no 'confirm' badge");
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });

  // ---- Mobile: 390px wide keeps the grid readable ----
  await page.setViewportSize({ width: 390, height: 844 });
  await showMonth(2026, 9);
  await page.waitForTimeout(300);
  const mobile = await page.evaluate(() => {
    const name = document.querySelector("[data-testid=cal-grid] .cal-name"), code = document.querySelector("[data-testid=cal-grid] .cal-code");
    return { scrollWidth: document.documentElement.scrollWidth, nameDisplay: name ? getComputedStyle(name).display : "none", codeDisplay: code ? getComputedStyle(code).display : "none", codeText: code ? code.textContent : "" };
  });
  if (mobile.scrollWidth > 392) fail(`mobile 390px: page scrolls horizontally (scrollWidth ${mobile.scrollWidth})`); else ok(`mobile 390px: no horizontal scroll (scrollWidth ${mobile.scrollWidth})`);
  if (mobile.nameDisplay !== "none" || mobile.codeDisplay === "none") fail(`mobile 390px: names should give way to codes (name ${mobile.nameDisplay}, code ${mobile.codeDisplay})`); else ok(`mobile 390px: cells show codes (e.g. ${mobile.codeText}) instead of names`);
  // vis-001: a pill that is clipped (scrollWidth > clientWidth) reads as a
  // single letter or "O..."; the display check above cannot see that.
  const clipped = await page.$$eval("[data-testid=cal-grid] .cal-pill", els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => { const cell = e.closest("[data-day]"); return (cell ? cell.getAttribute("data-day") + ":" : "") + e.textContent + " " + e.scrollWidth + ">" + e.clientWidth; }));
  if (clipped.length) fail(`mobile 390px: ${clipped.length} pill(s) clipped, e.g. ${clipped.slice(0, 4).join(", ")}`); else ok("mobile 390px: no pill is clipped (every .cal-pill scrollWidth <= clientWidth)");
  const openPills = await page.$$eval("[data-testid=cal-grid] .cal-pill.cal-open", els => els.map(e => ({ text: e.textContent, fits: e.scrollWidth <= e.clientWidth + 0.5, line: e.parentElement.scrollWidth <= e.parentElement.clientWidth + 0.5 })));
  if (!openPills.length) { const o = liveOpenBetween("2026-10-01", "2026-10-31"); if (o) fail("mobile 390px: no OPEN pill found in October 2026 although the live rows have an open slot on " + o); else console.log("     (mobile 390px: no open slot in October 2026 live - the OPEN pill pin has nothing to check)"); } else if (!openPills.every(p => p.text === "OPEN" && p.fits && p.line)) fail("mobile 390px: OPEN pill truncated: " + JSON.stringify(openPills.filter(p => !(p.fits && p.line)).slice(0, 3))); else ok(`mobile 390px: ${openPills.length} OPEN pill(s) render the full word`);
  const lineOverflow = await page.$$eval("[data-testid=cal-grid] .cal-line", els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => { const cell = e.closest("[data-day]"); return (cell ? cell.getAttribute("data-day") : "?") + ":" + e.textContent + (e.querySelector("svg") ? "+lock" : "") + " " + e.scrollWidth + ">" + e.clientWidth; }));
  if (lineOverflow.length) fail(`mobile 390px: ${lineOverflow.length} P/B line(s) overflow their cell, e.g. ${lineOverflow.slice(0, 5).join(", ")}`); else ok("mobile 390px: no P/B line overflows its cell (padlock included)");
  await page.screenshot({ path: path.join(OUT, "calendar-mobile.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-mobile.png");
  // ---- Prompt 11 mobile pass ----
  // (a) tap targets: every visible button in the calendar view is >= 36px tall
  const shortButtons = await page.$$eval("button", els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }).map(e => ({ h: Math.round(e.getBoundingClientRect().height), t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24) })).filter(x => x.h < 36));
  if (shortButtons.length) fail(`mobile 390px: ${shortButtons.length} button(s) under 36px tall: ` + JSON.stringify(shortButtons.slice(0, 6))); else ok("mobile 390px: every visible button is at least 36px tall (tap targets)");
  // (b) the week-rows table scrolls INSIDE its wrapper and the wrapper shows the swipe hint
  const wrapHint = await page.evaluate(() => {
    const wrap = document.querySelector("[data-testid=week-rows]") ? document.querySelector("[data-testid=week-rows]").parentElement : null;
    if (!wrap) return null;
    return { cls: wrap.className, hint: getComputedStyle(wrap, "::after").content, pageW: document.documentElement.scrollWidth, wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth };
  });
  if (!wrapHint) fail("mobile 390px: week-rows wrapper not found");
  else if (!/table-wrap/.test(wrapHint.cls) || !/swipe sideways/.test(wrapHint.hint) || wrapHint.pageW > 392) fail("mobile 390px: the week-rows wrapper lacks the table-wrap swipe hint or the page scrolls: " + JSON.stringify(wrapHint));
  else ok(`mobile 390px: week rows scroll inside their wrapper (${wrapHint.wrapScroll} vs ${wrapHint.wrapClient}) with the '${wrapHint.hint.replace(/"/g, "")}' hint; page ${wrapHint.pageW}px`);
  // (c) the day editor's Cancel / Save row is on screen without scrolling (sticky footer)
  await page.click('[data-day="2026-10-15"]');
  await page.waitForSelector("[data-testid=editor-footer]", { timeout: 5000 });
  await page.waitForTimeout(200);
  const foot = await page.$eval("[data-testid=editor-save]", el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight }; });
  if (foot.bottom > foot.vh || foot.top < 0 || foot.h < 36) fail(`mobile 390px: the day editor's Save button is off screen or too small (${JSON.stringify(foot)})`); else ok(`mobile 390px: the day editor's Save button is on screen at open (bottom ${foot.bottom} of ${foot.vh}px, ${foot.h}px tall)`);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
  await b9EditorGuard("light"); // Prompt 16 B9 (b) at 390 px, light theme (the dark pass runs after the dark-mode switch below)
  // (c2) Prompt 16 A5 - iOS safe area. Chromium's Emulation.setSafeAreaInsetsOverride stands in for an iPhone in
  // standalone mode (47 px notch above, 34 px home-indicator band below - env(safe-area-inset-*) then reads them the
  // way iOS does; the harness cannot emulate display-mode). The header must grow by the top inset, the day editor's
  // sticky Cancel / Save row must pad by the bottom inset. calendar-390-standalone.png / day-editor-390-standalone.png
  // are the review pair copied to docs/screenshots/ios-safe-area/.
  {
    const saCdp = await context.newCDPSession(page);
    const saInsets = (t, b) => saCdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: t, topMax: t, bottom: b, bottomMax: b, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
    try {
      await saInsets(47, 34);
      await page.evaluate(() => window.scrollTo(0, 0)); // the earlier mobile steps leave the page scrolled; the header is measured from the top of the page
      await page.waitForTimeout(250);
      const saMeta = await page.evaluate(() => ({ viewport: (document.querySelector('meta[name="viewport"]') || {}).content || "", theme: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(m => m.content) }));
      const saHdr = await page.$eval("[data-testid=app-header]", el => { const cs = getComputedStyle(el); return { padTop: cs.paddingTop, padBottom: cs.paddingBottom, top: Math.round(el.getBoundingClientRect().top) }; });
      if (!/(^|,\s*)viewport-fit=cover(,|$)/.test(saMeta.viewport)) fail("safe area: the viewport meta lacks viewport-fit=cover: " + saMeta.viewport);
      else if (saMeta.theme.join() !== "#FF5F05") fail("safe area: the theme-color meta moved: " + JSON.stringify(saMeta.theme));
      else if (saHdr.padTop !== "61px" || saHdr.padBottom !== "14px" || saHdr.top !== 0) fail(`safe area: under a 47px top inset the header should pad 47 + 14 = 61px at the top and 14px below, from the very top (computed ${JSON.stringify(saHdr)})`);
      else ok(`safe area (390 x 844, insets 47 / 34): viewport-fit=cover, theme-color kept, header padding-top ${saHdr.padTop} / bottom ${saHdr.padBottom}`);
      await page.evaluate(() => { const t = document.querySelector("[data-testid=toast]"); if (t) t.click(); });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, "calendar-390-standalone.png"), fullPage: false });
      await page.click('[data-day="2026-10-15"]');
      await page.waitForSelector("[data-testid=editor-footer]", { timeout: 5000 });
      await page.waitForTimeout(200);
      const saFoot = await page.evaluate(() => { const f = document.querySelector("[data-testid=editor-footer]"), s = document.querySelector("[data-testid=editor-save]"); const r = s.getBoundingClientRect(); return { padBottom: getComputedStyle(f).paddingBottom, saveBottom: Math.round(r.bottom), vh: window.innerHeight }; });
      if (saFoot.padBottom !== "46px") fail(`safe area: the day editor's sticky row should pad 34 + 12 = 46px at the bottom under a 34px inset (computed ${saFoot.padBottom})`);
      else if (saFoot.saveBottom > saFoot.vh - 34) fail(`safe area: the day editor's Save button ends inside the 34px home-indicator band (bottom ${saFoot.saveBottom} of ${saFoot.vh})`);
      else ok(`safe area: the day editor's Cancel / Save row pads ${saFoot.padBottom}; Save ends at ${saFoot.saveBottom} of ${saFoot.vh}px, above the 34px band`);
      await page.screenshot({ path: path.join(OUT, "day-editor-390-standalone.png"), fullPage: false });
      ok("screenshots test/ui/out/calendar-390-standalone.png, test/ui/out/day-editor-390-standalone.png");
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
    } catch (e) { fail("safe area: " + errLine(e)); try { await page.keyboard.press("Escape"); } catch (e2) {} }
    finally { try { await saInsets(0, 0); } catch (e) {} await saCdp.detach().catch(() => {}); }
  }
  // (d) the trade form's selects fit the phone width
  await page.click('button[data-tab="timeoff"]');
  await page.waitForSelector("[data-testid=trade-card]", { timeout: 8000 });
  const picks = await page.$$eval("[data-testid=trade-mine-pick], [data-testid=trade-to], [data-testid=trade-theirs-pick]", els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-testid"), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; }));
  const pickBad = picks.filter(p => p.right > 390 || p.left < 0 || p.w < 200);
  if (picks.length !== 3 || pickBad.length) fail("mobile 390px: trade selects off screen or narrower than 200px: " + JSON.stringify(picks)); else ok("mobile 390px: the three trade selects span the row and stay on screen (" + picks.map(p => p.w + "px").join(", ") + ")");
  // (e) Item C (Faraz 9/23 evening): the Suggested row at 390 px - picking one of Khan's upcoming days shows up to three
  //     ranked "Name - reason" chips INSIDE the trade card (no page scroll), and one tap fills Trade with (the harness
  //     user is the scheduler, so the ranking is one-way: the chips equal helpers.suggestTradePartners' answer over the
  //     app's own ctx, each reads "Name - [lowest ]<role> total[,] N", and no return day is filled). The card is left clean (From back to Khan, Trade with empty) for the desktop Trades scenario.
  let itemCPick = null; // "<day>|<role>" of Khan's that produced chips - the desktop editor-link step below reuses it
  try {
    const mineVals = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => o.value).filter(Boolean));
    let sugPick = null;
    // Live-drift fix (9/24): a unit day (holiday / weekend block - the card ranks the whole unit through
    // tradeEligibilityOver) is skipped, so the expectation below restates only the single-day call.
    for (const v of mineVals.slice(0, 10)) {
      await page.selectOption("[data-testid=trade-mine-pick]", v);
      await page.waitForTimeout(150);
      if (await page.$("[data-testid=trade-suggest-chip]") && !(await page.$("[data-testid=trade-unit]"))) { sugPick = v; break; }
    }
    itemCPick = sugPick;
    if (!sugPick) fail("Item C 390px: no Suggested chip on a non-unit day among Khan's first upcoming days (" + mineVals.slice(0, 10).join(", ") + ")");
    else {
      const geo = await page.$eval("[data-testid=trade-card]", card => {
        const c = card.getBoundingClientRect(), row = card.querySelector("[data-testid=trade-suggested]").getBoundingClientRect();
        const chips = Array.from(card.querySelectorAll("[data-testid=trade-suggest-chip]")).map(b => { const r = b.getBoundingClientRect(); return { id: b.getAttribute("data-id"), ret: b.getAttribute("data-return-day") || "", text: b.textContent.replace(/\s+/g, " ").trim(), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), fits: b.scrollWidth <= b.clientWidth + 1 }; });
        return { cardLeft: Math.round(c.left), cardRight: Math.round(c.right), rowRight: Math.round(row.right), chips, pageW: document.documentElement.scrollWidth };
      });
      const outside = geo.chips.filter(ch => ch.left < geo.cardLeft || ch.right > geo.cardRight || ch.right > 390 || !ch.fits || ch.h < 36);
      const [sugDay, role] = sugPick.split("|");
      // Live-drift fix (9/24): the expected chips are helpers.suggestTradePartners' own answer for the SAME inputs the
      // card uses (index-source.html tradeSuggestionsFor, the scheduler's one-way call on a non-unit day): the app's
      // current rules context (read from the App component's rulesCtxState memo on the committed React tree - the ctx
      // the harness-served rows built), its schedule map (ctx.schedule is that object), today (todayCentral), the pool
      // (roster minus external / inactive, roster order), nameOf, TOTALS_YTD_FLOORS and the card's tradeEligibility
      // (the rules.js chokepoint with ignoreLocks + claim). The wording is the helper's - a chip reads 'lowest <role>
      // total, N' when its total is the lowest among the eligible, else '<role> total N'; fewer soft flags rank first,
      // so the top chip need not be the lowest.
      const expSug = await page.evaluate(({ day, role }) => {
        const rootEl = document.getElementById("root");
        const ck = rootEl && Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
        if (!ck) return { error: "no React container key on #root" };
        const hostRoot = rootEl[ck], current = (hostRoot && hostRoot.stateNode && hostRoot.stateNode.current) || hostRoot;
        let ctx = null, n = 0; const stack = [current];
        while (stack.length && !ctx && n++ < 500000) {
          const f = stack.pop(); if (!f) continue;
          if (f.tag === 0 || f.tag === 11 || f.tag === 15) for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) { const v = h.memoizedState; if (Array.isArray(v) && v[0] && typeof v[0] === "object" && "error" in v[0] && v[0].ctx && v[0].ctx.per && v[0].ctx.holidayByDay && v[0].ctx.schedule) { ctx = v[0].ctx; break; } }
          if (f.sibling) stack.push(f.sibling); if (f.child) stack.push(f.child);
        }
        if (!ctx) return { error: "the App's rulesCtxState memo was not found on the committed React tree" };
        if (typeof suggestTradePartners !== "function" || typeof eligibility !== "function" || typeof todayCentral !== "function") return { error: "helpers.suggestTradePartners / rules.eligibility / todayCentral are not page globals" };
        const floors = typeof TOTALS_YTD_FLOORS !== "undefined" ? TOTALS_YTD_FLOORS : undefined;
        if (!floors) return { error: "TOTALS_YTD_FLOORS is not reachable from the page scope" };
        const fromEl = document.querySelector("[data-testid=trade-from]"), fromId = fromEl ? fromEl.value : "s1";
        const roster = ctx.roster || [];
        const nameOf = (id) => ((roster.find(s => s.id === id) || {}).name) || id || "?";
        const res = suggestTradePartners(ctx, ctx.schedule, day, role, fromId, {
          today: todayCentral(), pool: roster.filter(s => s && s.type !== "external" && s.active !== false).map(s => s.id), nameOf, offerDays: [day], twoWay: false, floors,
          eligibility: (days, r, cand) => { try { return eligibility(ctx, days[0], r, cand, { ignoreLocks: true, claim: true }); } catch (e) { return { ok: false, hard: ["rules-unavailable"], soft: [], unknown: true }; } },
        });
        return { fromId, chips: res.map(x => ({ id: x.id, text: x.name + " - " + x.reason, ret: x.returnDay || "", lowest: !!x.lowestTotal, total: x.total })) };
      }, { day: sugDay, role });
      const chipFmt = new RegExp("^\\S+ - (lowest " + role + " total, \\d+|" + role + " total \\d+)$");
      const gotSig = geo.chips.map(ch => ch.id + "|" + ch.text + "|" + ch.ret).join(" ; ");
      const expSig = expSug.chips ? expSug.chips.map(ch => ch.id + "|" + ch.text + "|" + ch.ret).join(" ; ") : "";
      if (!geo.chips.length || geo.chips.length > 3) fail(`Item C 390px: expected 1-3 Suggested chips, got ${geo.chips.length}`);
      else if (outside.length || geo.rowRight > geo.cardRight || geo.pageW > 392) fail("Item C 390px: a Suggested chip leaves the card, is clipped, or is under 36px tall (card " + geo.cardLeft + "-" + geo.cardRight + ", page " + geo.pageW + "): " + JSON.stringify(outside.length ? outside : geo));
      else if (expSug.error) fail(`Item C 390px: could not restate helpers.suggestTradePartners for ${sugPick}: ${expSug.error}`);
      else if (expSug.fromId !== "s1") fail(`Item C 390px: the card's From is '${expSug.fromId}', expected Khan (s1)`);
      else if (gotSig !== expSig) fail(`Item C 390px: the Suggested chips for Khan's ${sugPick} differ from helpers.suggestTradePartners over the app's ctx: rendered [${gotSig}], helper [${expSig}]`);
      else if (!geo.chips.every(ch => chipFmt.test(ch.text) && !ch.ret)) fail(`Item C 390px: a chip is not in the one-way 'Name - reason' form ('Name - lowest ${role} total, N' / 'Name - ${role} total N', no return day): ${JSON.stringify(geo.chips.map(ch => ch.text + (ch.ret ? " ret " + ch.ret : "")))}`);
      else {
        ok(`Item C 390px: the ${geo.chips.length} Suggested chip(s) for Khan's ${sugPick} equal helpers.suggestTradePartners' ranking over the app's own ctx (${geo.chips.map(ch => "'" + ch.text + "'").join(", ")}; top pick ${expSug.chips[0].lowest ? "has" : "does not have"} the lowest ${role} total), one-way 'Name - reason' form, no return day`);
        await page.click("[data-testid=trade-suggest-chip]");
        await page.waitForTimeout(150);
        const toV = await page.$eval("[data-testid=trade-to]", el => el.value), retV = await page.$eval("[data-testid=trade-return-day]", el => el.value);
        if (toV !== geo.chips[0].id) fail(`Item C 390px: tapping the top chip (${geo.chips[0].id}) did not fill Trade with (value '${toV}')`);
        else if (retV !== geo.chips[0].ret) fail(`Item C 390px: the return day after the tap is '${retV}', the chip carried '${geo.chips[0].ret}'`);
        else ok(`Item C 390px: ${geo.chips.length} Suggested chip(s) for Khan's ${sugPick} render inside the trade card (${geo.chips.map(ch => "'" + ch.text + "' " + ch.left + "-" + ch.right + "px").join("; ")}) and a tap on the first fills Trade with = ${toV}${retV ? " and the return day " + retV : " (no return day - one-way)"}`);
      }
      await page.selectOption("[data-testid=trade-to]", "");
      await page.fill("[data-testid=trade-return-day]", "");
    }
  } catch (e) { fail("Item C 390px: " + String(e && e.message || e).split("\n")[0]); }
  await page.click('button[data-tab="calendar"]');
  // ---- Item E2 (scheduler, 390 dark): the clean grid holds at phone width in the dark theme too ----
  // Since Item E2 (Faraz 9/25) the scheduler's grid carries no E / F / f badge, no "East-derived:" hover bit and no
  // East legend line at any width or theme (nothing is gated any more - the markup is gone); this pins it where the
  // surgeon side is checked, on a grid that actually loaded (cells and filled cells > 0). Light is restored before the
  // viewport goes back to 1180 so the theme flow below is unchanged.
  {
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Dark')");
    await showMonth(2026, 10);
    const themeSched = await page.evaluate(() => { try { return localStorage.getItem("silvis-dark-mode") === "true" ? "dark" : "light"; } catch (e) { return "?"; } });
    const nov390 = await readCells();
    const filled390 = nov390.filter(c => c.p || c.ext).length;
    const east390 = nov390.filter(c => c.badges.some(b => b === "E" || b === "F" || b === "f"));
    const hover390 = await page.$$eval("[data-testid=cal-grid] .cal-cell", els => els.filter(e => /East-derived:/.test(e.getAttribute("title") || "")).length);
    const legend390 = await page.$eval(".cal-legend", el => el.innerText.replace(/\s+/g, " "));
    if (themeSched !== "dark") fail(`Item E2 (scheduler, 390 dark): the Dark toggle did not take (silvis-dark-mode reads ${themeSched})`);
    else if (!nov390.length || !filled390) fail(`Item E2 (scheduler, 390 dark): November 2026 never loaded (${nov390.length} cells, ${filled390} filled) - a clean grid must not be an empty one`);
    else if (east390.length || hover390) fail(`Item E2 (scheduler, 390 dark): November 2026 still shows East markings at 390 px - badges on ${east390.map(c => c.day + ":" + c.badges.join("")).slice(0, 6).join(", ") || "none"}; 'East-derived:' hover on ${hover390} day(s)`);
    else if (/East-derived/.test(legend390) || /East forecast/.test(legend390)) fail("Item E2 (scheduler, 390 dark): the legend still carries an East line: " + legend390.slice(0, 220));
    else ok(`Item E2 (scheduler, 390 dark): November 2026 grid has no E / F / f badge and no 'East-derived:' hover bit (${nov390.length} cells, ${filled390} filled) and the legend has no 'East-derived week' / 'East forecast' line`);
    await page.screenshot({ path: path.join(OUT, "calendar-nov-2026-390-dark.png"), fullPage: true });
    ok("screenshot test/ui/out/calendar-nov-2026-390-dark.png");
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Light')");
    await page.click('button[data-tab="calendar"]');
  }
  await page.setViewportSize({ width: 1180, height: 900 });

  // (f) Item C (review 9/24), desktop: the day editor's "Propose a trade for this day" link on the day Khan holds names the
  //     top suggested counter-party (data-suggested) and its click lands on the card with From Khan, that day + role,
  //     Trade with = the top chip and no return day (one-way), the editor closed. Card left clean afterwards.
  if (itemCPick) {
    try {
      const [cDay, cRole] = itemCPick.split("|");
      await showMonth(+cDay.slice(0, 4), +cDay.slice(5, 7) - 1);
      await page.click(`[data-day="${cDay}"]`);
      await page.waitForSelector("[data-testid=editor-footer]", { timeout: 5000 });
      await page.waitForTimeout(200);
      const link = await page.$eval("[data-testid=editor-trade]", el => ({ text: el.textContent.replace(/\s+/g, " ").trim(), suggested: el.getAttribute("data-suggested") || "" }));
      await page.click("[data-testid=editor-trade]");
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => { const v = (t) => { const e = document.querySelector(`[data-testid=${t}]`); return e ? e.value : null; }; const chip = document.querySelector("[data-testid=trade-suggest-chip]"); return { to: v("trade-to"), day: v("trade-day"), role: v("trade-role"), from: v("trade-from"), ret: v("trade-return-day"), editorOpen: !!document.querySelector("[data-testid=day-editor]"), topChip: chip ? chip.getAttribute("data-id") : null }; });
      if (!link.suggested) fail(`Item C editor link: no data-suggested on ${cDay} although the card suggested someone for the same slot at 390 px ('${link.text}')`);
      else if (!/ - suggested: \S+$/.test(link.text)) fail(`Item C editor link: text '${link.text}' lacks ' - suggested: <Name>'`);
      else if (st.to !== link.suggested || st.day !== cDay || st.role !== cRole || st.from !== "s1" || st.editorOpen || st.topChip !== link.suggested || st.ret) fail("Item C editor link: the click did not pre-fill the card as expected: " + JSON.stringify({ link, st, cDay, cRole }));
      else ok(`Item C editor link on ${cDay}: '${link.text}' -> the card shows From ${st.from}, day ${st.day}, role ${st.role}, Trade with ${st.to} (= the top chip ${st.topChip}), return day '' (one-way), editor closed`);
      await page.selectOption("[data-testid=trade-to]", "").catch(() => {});
      await page.fill("[data-testid=trade-return-day]", "").catch(() => {});
      if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); }
      await page.click('button[data-tab="calendar"]');
    } catch (e) { fail("Item C editor link: " + errLine(e)); }
  } else console.log("     (Item C editor link: skipped - the 390 px step found no suggested day of Khan's)");

  // ---- vis-002: the year field accepts typed input ----
  await showMonth(2026, 9);
  await page.click("[data-testid=cal-year-input]");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("2027", { delay: 40 });
  const typedYear = await page.$eval("[data-testid=cal-year-input]", el => el.value);
  const typedLabel = await page.$eval("[data-testid=cal-month]", el => el.textContent.trim());
  if (typedYear !== "2027" || typedLabel !== "October 2027") fail(`typing 2027 into the year field: value '${typedYear}', header '${typedLabel}' (expected 2027 / October 2027)`); else ok("year field: typing 2027 key by key moves the calendar to October 2027");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("20", { delay: 40 });
  await page.keyboard.press("Tab");
  const snapped = await page.$eval("[data-testid=cal-year-input]", el => el.value);
  if (snapped !== "2027") fail(`year field: a partial '20' should snap back to 2027 on blur, got '${snapped}'`); else ok("year field: a partial value snaps back to the shown year on blur");

  // ---- vis-003: dark mode keeps week-row names and the title readable ----
  // Contrast is measured on rendered computed colours (WCAG relative
  // luminance) against the element's effective background: 3:1 minimum.
  const contrastProbe = async () => page.evaluate(() => {
    const parseRgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(x => parseFloat(x)); return p.length >= 4 && p[3] === 0 ? null : p.slice(0, 3); };
    const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parseRgb(getComputedStyle(e).backgroundColor); if (c) return c; const bi = getComputedStyle(e).backgroundImage; const g = /rgb\([^)]+\)/.exec(bi || ""); if (g && parseRgb(g[0])) return parseRgb(g[0]); } return parseRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255]; };
    const probe = (el) => { if (!el) return null; const fg = parseRgb(getComputedStyle(el).color); const bg = bgOf(el); return { text: el.textContent.trim().slice(0, 30), color: getComputedStyle(el).color, ratio: fg ? Math.round(ratio(fg, bg) * 100) / 100 : null }; };
    const entries = Array.from(document.querySelectorAll("[data-testid=week-rows] [data-kind=surgeon]"));
    const byName = {};
    for (const e of entries) { const nm = (e.textContent.trim().split(" ").pop() || ""); if (!byName[nm]) byName[nm] = probe(e); }
    const dots = Array.from(document.querySelectorAll("[data-testid=cal-grid] [data-vac]")).map(d => { const bg = parseRgb(getComputedStyle(d).backgroundColor); const cell = bgOf(d.parentElement); return { who: d.getAttribute("data-vac"), ratio: bg ? Math.round(ratio(bg, cell) * 100) / 100 : null }; });
    return { h1: probe(document.querySelector("h1")), rows: byName, bodyBg: getComputedStyle(document.body).backgroundColor, dots };
  });
  await page.click('button[data-tab="settings"]');
  await page.click("button:has-text('Dark')");
  await showMonth(2026, 9);
  await page.waitForTimeout(300);
  const darkProbe = await contrastProbe();
  const darkRows = Object.entries(darkProbe.rows);
  const dimRows = darkRows.filter(([, p]) => !p || p.ratio === null || p.ratio < 3);
  if (!/rgb\(11, 26, 51\)/.test(darkProbe.bodyBg)) fail("dark mode did not switch the body background to #0B1A33: " + darkProbe.bodyBg); else ok("dark mode: body background " + darkProbe.bodyBg);
  if (!darkRows.length) fail("dark mode: no [data-kind=surgeon] week-row entries to measure");
  else if (dimRows.length) fail("dark mode: week-row names below 3:1 contrast: " + dimRows.map(([n, p]) => `${n} ${p && p.color} ${p && p.ratio}:1`).join(", "));
  else ok("dark mode: week-row names readable - " + darkRows.map(([n, p]) => `${n} ${p.ratio}:1`).join(", "));
  if (!darkProbe.rows.Fierce) fail("dark mode: no Fierce week-row entry in October 2026 (expected 9/28-10/4 Fierce)");
  if (!darkProbe.h1 || darkProbe.h1.ratio === null || darkProbe.h1.ratio < 3) fail("dark mode: header title low contrast: " + JSON.stringify(darkProbe.h1)); else ok(`dark mode: h1 '${darkProbe.h1.text}' ${darkProbe.h1.ratio}:1 on the header`);
  const dimDots = darkProbe.dots.filter(d => d.ratio === null || d.ratio < 2);
  if (dimDots.length) fail("dark mode: vacation dots invisible on their cell: " + JSON.stringify(dimDots.slice(0, 4))); else ok(`dark mode: ${darkProbe.dots.length} vacation dot(s) visible on their cells`);
  await page.screenshot({ path: path.join(OUT, "calendar-oct-dark.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-oct-dark.png");
  // Prompt 16 B9 (b) at 390 px in the dark theme
  await page.setViewportSize({ width: 390, height: 844 });
  await b9EditorGuard("dark");
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.click('button[data-tab="settings"]');
  await page.click("button:has-text('Light')");
  await showMonth(2026, 9);
  const lightProbe = await contrastProbe();
  const dimLight = Object.entries(lightProbe.rows).filter(([, p]) => !p || p.ratio === null || p.ratio < 3);
  if (dimLight.length) fail("light mode: week-row names below 3:1: " + dimLight.map(([n, p]) => `${n} ${p && p.ratio}`).join(", ")); else ok("light mode restored: week-row names readable - " + Object.entries(lightProbe.rows).map(([n, p]) => `${n} ${p.ratio}:1`).join(", "));

  // One schedule edit through the DAY EDITOR -> schedule_days POST v1 with CAS headers.
  await page.click('button[data-tab="calendar"]');
  await page.waitForTimeout(3300); // past the 3s post-load hydration window of the autosave
  // liveRows / liveByDay / liveOpen and the date helpers (utcDay, todayIso, isoAddDays, mdOf,
  // daysBetween) are read and defined before Slice B (Prompt 12 SM2) - the week-row and ER
  // pins need them first; the recount below and the item-SM pins use the same rows.

  // ---- Prompt 11: coverage at a glance = an independent 60-day recount of the live rows ----
  // Runs BEFORE this run's first edit, so the app's map still equals the live
  // rows. A day without a row is open in both roles (the app's rule too).
  try {
    await page.click('button[data-tab="calendar"]');
    await page.waitForSelector("[data-testid=coverage-strip]", { timeout: 5000 });
    await page.waitForFunction(() => { const el = document.querySelector("[data-testid=cov-open-primary]"); return !!el && el.getAttribute("data-count") !== ""; }, null, { timeout: 10000 });
    const strip = await page.$eval("[data-testid=coverage-strip]", el => {
      const g = (t, a) => { const x = el.querySelector(`[data-testid=${t}]`); return x ? x.getAttribute(a) : null; };
      return { text: el.innerText.replace(/\s+/g, " "), scrollW: el.scrollWidth, clientW: el.clientWidth,
        openP: Number(g("cov-open-primary", "data-count")), firstP: g("cov-open-primary", "data-first"),
        openB: Number(g("cov-open-backup", "data-count")), firstB: g("cov-open-backup", "data-first"),
        fc: Number(g("cov-forecast-primary", "data-count")), eastEnd: g("cov-east-end", "data-value"), lastPub: g("cov-last-published", "data-value"), snap: g("cov-last-snapshot", "data-value") };
    });
    const expP = [], expB = [];
    for (let k = 0; k < 60; k++) { const d = utcDay(Date.parse(todayIso + "T12:00:00Z") + k * 86400000); const r = liveByDay[d]; if (!(r && (r.primary_id || r.external_cover))) expP.push(d); if (!(r && r.backup_id)) expB.push(d); }
    // East coverage end: the newest cached Davenport week's Sunday (anon read of east_feed).
    let expEastEnd = "";
    try {
      const er = await fetch(`https://${SUPABASE_HOST}/rest/v1/east_feed?select=week_monday&order=week_monday.desc&limit=1`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } });
      if (!er.ok) throw new Error("HTTP " + er.status);
      const erows = await er.json();
      if (Array.isArray(erows) && erows[0] && erows[0].week_monday) expEastEnd = utcDay(Date.parse(String(erows[0].week_monday).slice(0, 10) + "T12:00:00Z") + 6 * 86400000);
    } catch (e) { fail("coverage strip: could not read east_feed for the expected coverage end: " + errLine(e)); }
    // Last published: the blob's lastPublished.at (the one anon read of the blob above; the fixture blob has none).
    const expLastPub = (liveBlobData && liveBlobData.lastPublished && liveBlobData.lastPublished.at) || "";
    if (!liveBlobData) fail("coverage strip: the blob was not readable, so lastPublished cannot be restated");
    if (strip.openP !== expP.length || strip.firstP !== (expP[0] || "")) fail(`coverage strip: open primary reads ${strip.openP} (first ${strip.firstP}), the live rows say ${expP.length} (first ${expP[0] || "-"}) for ${todayIso} + 60 days`);
    else if (strip.openB !== expB.length || strip.firstB !== (expB[0] || "")) fail(`coverage strip: open backup reads ${strip.openB} (first ${strip.firstB}), the live rows say ${expB.length} (first ${expB[0] || "-"})`);
    else if (strip.fc !== 0) fail(`coverage strip: ${strip.fc} forecast-busy day(s) hold that surgeon as primary (should be 0): ` + strip.text);
    else if (strip.eastEnd !== expEastEnd) fail(`coverage strip: East feed coverage end reads '${strip.eastEnd}', east_feed says '${expEastEnd}'`);
    else if ((strip.lastPub || "") !== (expLastPub || "")) fail(`coverage strip: last published reads '${strip.lastPub}', the blob says '${expLastPub}'`);
    else if (strip.snap === null) fail("coverage strip: the scheduler's 'last snapshot' item is missing");
    else if (strip.scrollW > strip.clientW + 1) fail("coverage strip overflows its card");
    else ok(`coverage strip (${todayIso} + 60 d): open primary ${strip.openP} (first ${strip.firstP || "-"}), open backup ${strip.openB} (first ${strip.firstB || "-"}), forecast-busy as primary 0, East feed through ${strip.eastEnd || "unknown"}, last published ${strip.lastPub ? strip.lastPub.slice(0, 10) : "never"}, last snapshot ${strip.snap ? strip.snap.slice(0, 16) : "none"} - all equal the live rows`);
    if (strip.openP > 0) {
      await page.click("[data-testid=cov-open-primary]");
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      const t = await page.$eval("[data-testid=editor-title]", el => el.textContent);
      const want = new Date(strip.firstP + "T12:00:00Z");
      const wantText = `${["January","February","March","April","May","June","July","August","September","October","November","December"][want.getUTCMonth()]} ${want.getUTCDate()}, ${want.getUTCFullYear()}`;
      if (!t.includes(wantText)) fail(`coverage strip: the open-primary count opened '${t}', expected the first open day ${strip.firstP}`); else ok(`coverage strip: tapping the open-primary count opens the day editor on ${strip.firstP} ('${t}')`);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
    } else console.log("     (no open primary in the next 60 days - the strip link is not exercised)");
  } catch (e) { fail("coverage strip: " + errLine(e)); }
  const harnessDays = {}; // day -> { primary_id, backup_id } as this run leaves them in the app
  const noteEdit = (d, patch) => { harnessDays[d] = { ...(harnessDays[d] || {}), ...patch }; };
  // Item SM (Prompt 12): the harness's OWN picture of the app's map = the live
  // rows it fetched, overlaid - for the days this run edited or injected
  // (harnessDays) - with what the GRID shows for them at pin time, observed
  // through the DOM by observeHarnessDays below, never through an app function.
  // The three live-state pins (Generate presets, time-off refusal preselect,
  // Accept & Publish write set) derive their expectations from that picture
  // with an independent restatement of each rule - never by calling the app's
  // helper for the same computation and never by a constant that encodes
  // today's table. Why the overlay: every write is intercepted, so no edited
  // day ever reaches the table, and the app's 60-second background poll
  // (refreshAll -> refreshDays) drops a persisted day the live read no longer
  // holds - but WHEN that poll fires relative to the pins is a timer race
  // (review finding on item SM: a ~5 s window today, and from October the edit
  // day sits right next to the published block). So settleMapToLive() first
  // observes the edited cells, waits for the poll (the app's own GET
  // /rest/v1/schedule_days) while any of them still shows an edit, and only
  // then lets the pins derive: the picture is whatever the app shows, and a
  // cell still differing from the live rows after two polls is a FAIL, not a
  // guess. curHolder follows the app's holder convention: an external cover
  // stands in for an OPEN primary as "ext:<name>". A day is IN the map when it
  // has a live row or the grid shows a holder on it (this run never blanks a
  // held day, and refreshDays deletes a dropped day outright).
  const observed = {}; // day -> { primary, backup, ext } as the grid showed it at settle time (harnessDays days only)
  // P13R: the board scenario's claim (claimedDays) is overlaid on every schedule_days GET the app makes, so for
  // that day the harness's "live" is the overlaid row - the app's map keeps the claimer there across every poll.
  const liveHolders = (d) => { const l = { ...(liveByDay[d] || {}), ...(claimedDays[d] || {}) }; return { primary: l.primary_id || null, backup: l.backup_id || null, ext: l.external_cover || null }; };
  const sameHolders = (a, b) => a.primary === b.primary && a.backup === b.backup && a.ext === b.ext;
  const curDay = (d) => observed[d] || liveHolders(d);
  const curHolder = (d, role) => { const c = curDay(d); return role === "primary" ? (c.primary || (c.ext ? "ext:" + c.ext : null)) : (c.backup || null); };
  const inMap = (d) => !!liveByDay[d] || (!!observed[d] && !!(observed[d].primary || observed[d].backup || observed[d].ext));
  const curDays = () => [...new Set([...Object.keys(liveByDay), ...Object.keys(observed)])].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && inMap(d)).sort();
  // (isoAddDays and mdOf are defined with the live rows before Slice B - SM2.)
  // Read the grid cell of every harnessDays day (one showMonth per month touched) - the app's map as it shows it.
  const observeHarnessDays = async () => {
    const days = Object.keys(harnessDays).sort();
    const out = {};
    for (const ym of [...new Set(days.map(d => d.slice(0, 7)))]) {
      await showMonth(+ym.slice(0, 4), +ym.slice(5, 7) - 1);
      const cells = await page.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary") || "", b: e.getAttribute("data-backup") || "", ext: e.getAttribute("data-ext") || "" })));
      days.filter(d => d.slice(0, 7) === ym).forEach(d => { const c = cells.find(x => x.day === d); if (c) out[d] = { primary: c.p || null, backup: c.b || null, ext: c.ext || null }; });
    }
    return out;
  };
  // Settle the picture: observe, and while an edited cell still differs from the live rows wait for the app's
  // background schedule_days poll (at most twice - an edit still inside its 800 ms debounce at the first poll is
  // kept as a local change by refreshDays and dropped by the next one), then freeze what the grid shows into
  // `observed`. Returns the days still differing; empty = the app's map equals the live rows on every edited day.
  const isDaysGet = (r) => r.request().method() === "GET" && new URL(r.url()).pathname === "/rest/v1/schedule_days";
  // Prompt 12 SM2: writes.length at the moment of the latest schedule_days GET response - answers "has the
  // app read the rows since its last schedule_days write?" for the Import apply premise. refreshDays
  // re-adopts the live row WHOLESALE (lock flags, source and note included) for every persisted day the
  // table does not hold that way; the grid shows holders only, so a holders-unchanged write (source /
  // note) still sitting in the map cannot be observed - this counter says whether a poll has cleared it.
  let writesAtLastDaysGet = -1, lastDaysGetAt = 0;
  page.on("response", (r) => { try { if (isDaysGet(r)) { writesAtLastDaysGet = writes.length; lastDaysGetAt = Date.now(); } } catch (e) {} });
  // SM2 review: the mirror image of settleMapToLive - a check that must see this run's edit BEFORE the
  // poll drops it (every write is intercepted, so the next refreshDays deletes a persisted row-less day
  // outright) waits for the app's next GET /rest/v1/schedule_days first, so the edit and its reads start
  // at the top of a fresh 60-s poll interval instead of racing the timer (finding on the Locum cell /
  // Totals read: a poll landing inside the ~5 s between the save and the read failed both).
  const freshPollWindow = async (what) => {
    const age = lastDaysGetAt ? Math.round((Date.now() - lastDaysGetAt) / 1000) : null;
    console.log(`     (${what}: the app's last schedule_days poll answered ${age === null ? "at no observed time" : age + " s ago"} - waiting for its next GET /rest/v1/schedule_days so the edit and its reads fit inside one poll interval)`);
    const got = await page.waitForResponse(isDaysGet, { timeout: 75000 }).then(() => true).catch(() => false);
    if (!got) console.log(`     (${what}: no GET /rest/v1/schedule_days seen within 75 s - proceeding; a poll may still race the reads)`);
    await page.waitForTimeout(1500); // the merge + render
  };
  const settleMapToLive = async (what) => {
    let obs = await observeHarnessDays();
    let stale = Object.keys(obs).filter(d => !sameHolders(obs[d], liveHolders(d)));
    for (let round = 1; round <= 2 && stale.length; round++) {
      console.log(`     (${what}: the grid still shows this run's edits on ${stale.join(", ")} - waiting for the app's background schedule_days poll, round ${round}/2)`);
      const got = await page.waitForResponse(isDaysGet, { timeout: 75000 }).then(() => true).catch(() => false);
      if (!got) console.log(`     (${what}: no GET /rest/v1/schedule_days seen within 75 s)`);
      await page.waitForTimeout(1500); // the merge + render
      obs = await observeHarnessDays();
      stale = Object.keys(obs).filter(d => !sameHolders(obs[d], liveHolders(d)));
    }
    Object.keys(observed).forEach(k => delete observed[k]);
    Object.assign(observed, obs);
    const unread = Object.keys(harnessDays).filter(d => !obs[d]);
    const show = (h) => `${h.primary || "-"}/${h.backup || "-"}${h.ext ? " ext " + h.ext : ""}`;
    if (stale.length) fail(`${what}: the app's map still differs from the live rows on ${stale.map(d => `${d} (grid ${show(obs[d])}, live ${show(liveHolders(d))})`).join(", ")} after two background polls - the live-state pins derive from the grid as observed, but a later poll may still move the map under them`);
    else ok(`${what}: the app's map equals the live rows on this run's ${Object.keys(obs).length} edited day(s) (${Object.keys(obs).join(", ")}) - observed in the grid${unread.length ? "; not readable: " + unread.join(", ") : ""}; the live-state pins derive from the live rows`);
    return stale;
  };

  // ---- Prompt 13 part 3: the Open shifts board ----
  // Runs BEFORE this run's first edit, so the board's rows equal the live rows
  // (today .. the app's last published day, the same openSlots() list the
  // coverage strip reads). Faraz's pin: the strip's 60-day open counts equal
  // the board's - the strip = the board's rows inside the next 60 days + the
  // unpublished tail (days after the published range, recounted here from the
  // live rows with the strip's own rule; empty once the schedule runs 60+ days
  // ahead, then the pin is pure equality). Then: badge = row count, the
  // filters, Copy list, Take this shift as the mocked s1 (the admin is a
  // surgeon too) -> claim-sheet -> Confirm -> POST rpc/claim_open_slot
  // { p_day, p_role } -> the row leaves the board after the refetch (no client
  // audit / feed duplicate; send-notification shift_claimed to the scheduler +
  // claimer), Email the group now (feed row open_shifts with data.slots, a
  // broadcast send-notification, audit openshifts.notify, 'last announced'
  // filled - on a board that still lists a slot: BEFORE the claim when the
  // claim takes the only one, else after it; see emailGroupNow), 390 px in
  // light and dark (no page scroll, table scrolls in its wrapper with the
  // swipe hint), screenshots openshifts*.png.
  try {
    const parseBody = (w) => { try { return JSON.parse(w.body); } catch (e) { return null; } };
    const noAddr = (s) => !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(String(s || ""));
    // Review screenshots carry no harness artefacts: dismiss the app toast (click closes it) before each shot.
    const shotStart = Date.now();
    const clearToast = async () => { await page.evaluate(() => { const t = document.querySelector("[data-testid=toast]"); if (t) t.click(); }); await page.waitForTimeout(150); };
    const plusDays = (d, k) => utcDay(Date.parse(d + "T12:00:00Z") + k * 86400000);
    const openIn = (d) => { const r = liveByDay[d]; return { p: !(r && (r.primary_id || r.external_cover)), b: !(r && r.backup_id) }; };
    const isWknd = (d) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w === 5 || w === 6 || w === 0; };
    await page.click('button[data-tab="calendar"]');
    await page.waitForFunction(() => { const el = document.querySelector("[data-testid=cov-open-primary]"); return !!el && el.getAttribute("data-count") !== ""; }, null, { timeout: 10000 });
    const stripP = await page.$eval("[data-testid=cov-open-primary]", el => Number(el.getAttribute("data-count")));
    const stripB = await page.$eval("[data-testid=cov-open-backup]", el => Number(el.getAttribute("data-count")));
    const badgeOf = () => page.$eval('button[data-tab="openshifts"]', el => { const b = el.querySelector("[data-testid=openshifts-badge]"); return b ? Number(b.textContent) : 0; });
    const badge = await badgeOf();
    const openBoard = async () => { await page.click('button[data-tab="openshifts"]'); await page.waitForSelector("[data-testid=openshifts-table]", { timeout: 8000 }); };
    await openBoard();
    const readBoard = () => page.$eval("[data-testid=openshifts-table]", el => ({
      from: el.getAttribute("data-from"), to: el.getAttribute("data-to"), total: Number(el.getAttribute("data-total")),
      rows: Array.from(el.querySelectorAll("tbody tr[data-slot]")).map(r => { const b = r.querySelector("[data-testid=ob-take]"); return { slot: r.getAttribute("data-slot"), day: r.getAttribute("data-day"), role: r.getAttribute("data-role"), take: b ? (b.disabled ? "disabled" : "enabled") : "none", title: b ? (b.getAttribute("title") || "") : "", eligible: Array.from(r.querySelectorAll("[data-eligible-id]")).map(x => x.getAttribute("data-eligible-id")), announced: (r.querySelector("[data-testid=ob-announced]") || { textContent: "" }).textContent.trim(), assign: !!r.querySelector("[data-testid=ob-assign]"), external: !!r.querySelector("[data-testid=ob-external]"), text: r.innerText.replace(/\s+/g, " ") }; }),
    }));
    const tailOf = () => page.$eval("[data-testid=openshifts-tail]", el => ({ p: Number(el.getAttribute("data-primary")), b: Number(el.getAttribute("data-backup")), through: el.getAttribute("data-through") })).catch(() => null);
    await page.click("[data-testid=ob-horizon-all]");
    await page.waitForTimeout(250);
    const all = await readBoard();
    // Expected rows, recounted from the live rows with the board's rule: today
    // .. the last published day (data-to), THEN every ASSIGNED day after it
    // (a pre-assigned unit weeks beyond the block - Thanksgiving 11/26-11/29
    // today - is claimable and must be listed); gap days with no row stay out.
    const expRows = [];
    if (all.to && all.to >= todayIso) for (let d = todayIso; d <= all.to; d = plusDays(d, 1)) { const o = openIn(d); if (o.p) expRows.push(d + "|primary"); if (o.b) expRows.push(d + "|backup"); }
    const laterAssigned = Object.keys(liveByDay).filter(d => d >= todayIso && (!all.to || d > all.to) && (liveByDay[d].primary_id || liveByDay[d].backup_id || liveByDay[d].external_cover)).sort();
    laterAssigned.forEach(d => { const o = openIn(d); if (o.p) expRows.push(d + "|primary"); if (o.b) expRows.push(d + "|backup"); });
    if (all.from !== todayIso) fail(`Open shifts: the board starts at ${all.from}, expected today ${todayIso}`);
    else if (JSON.stringify(all.rows.map(r => r.slot)) !== JSON.stringify(expRows)) fail(`Open shifts: the board lists ${all.rows.length} slot(s) for ${all.from}..${all.to} (+ ${laterAssigned.length} later assigned day(s)), the live rows say ${expRows.length}: board ${JSON.stringify(all.rows.map(r => r.slot).slice(-5))} vs live ${JSON.stringify(expRows.slice(-5))}`);
    else if (!all.rows.length) console.log("     (Open shifts: the board is empty - and so is the open-slot list recounted from the live rows; the equality above is the pin)");
    else ok(`Open shifts: ${all.rows.length} open slot(s) ${all.from}..${all.to}${laterAssigned.length ? " + " + laterAssigned.length + " later assigned day(s) " + laterAssigned[0] + ".." + laterAssigned[laterAssigned.length - 1] : ""} equal the live rows (${all.rows.filter(r => r.role === "primary").length} primary, ${all.rows.filter(r => r.role === "backup").length} backup), first ${all.rows[0].slot}, last ${all.rows[all.rows.length - 1].slot}`);
    if (badge !== all.rows.length || all.total !== all.rows.length) fail(`Open shifts: the nav badge reads ${badge} (data-total ${all.total}), the 'all' board has ${all.rows.length} row(s)`); else ok(`Open shifts: nav badge ${badge} = the board's row count for the whole published range${badge ? "" : " (hidden at 0)"}`);
    // Faraz's pin: the coverage strip's open counts equal the board's for the
    // next 60 days. strip = board rows inside the window + the tail (open slots
    // in the window the board cannot list: days with no row after the block),
    // both sides recounted here from the live rows.
    const h60 = plusDays(todayIso, 59);
    const inWin = all.rows.filter(r => r.day <= h60);
    const boardKeys = new Set(all.rows.map(r => r.slot));
    const boardP = inWin.filter(r => r.role === "primary").length, boardB = inWin.filter(r => r.role === "backup").length;
    let tailP = 0, tailB = 0;
    const tailFrom = all.to && all.to >= todayIso ? plusDays(all.to, 1) : todayIso;
    for (let d = tailFrom; d <= h60; d = plusDays(d, 1)) { const o = openIn(d); if (o.p && !boardKeys.has(d + "|primary")) tailP++; if (o.b && !boardKeys.has(d + "|backup")) tailB++; }
    const tail = await tailOf();
    if (!tail) fail("Open shifts: the 'beyond the published range' footer (openshifts-tail) is missing");
    else if (tail.p !== tailP || tail.b !== tailB) fail(`Open shifts: the footer says ${tail.p} P / ${tail.b} B unpublished day(s) through ${tail.through}, the live rows say ${tailP} / ${tailB} for the no-row days after ${all.to} up to ${h60}`);
    else if (stripP !== boardP + tail.p || stripB !== boardB + tail.b) fail(`Open shifts: the coverage strip says ${stripP} open primary / ${stripB} open backup for the next 60 days, the board says ${boardP} / ${boardB} inside the window + ${tail.p} / ${tail.b} unpublished day(s) beyond ${all.to}`);
    else ok(`Open shifts: coverage strip ${stripP} P / ${stripB} B (next 60 days) = board ${boardP} / ${boardB} (rows through ${h60}) + ${tail.p} / ${tail.b} unpublished no-row day(s) through ${h60}${tail.p + tail.b === 0 ? " (none: pure equality)" : ""}`);
    // Every row: s1's Take button (enabled, or disabled with the first hard reason as tooltip) exactly where the Eligible now chips include s1; the scheduler's Assign... and Outside cover.
    const badRows = all.rows.filter(r => !(r.take === "enabled" || (r.take === "disabled" && r.title)) || !r.assign || (r.role === "primary" ? !r.external : r.external));
    if (badRows.length) fail(`Open shifts: ${badRows.length} row(s) lack the s1 Take button (enabled, or disabled with a reason tooltip), the scheduler's Assign..., or Outside cover on primary rows only, e.g. ${JSON.stringify(badRows[0])}`);
    else if (all.rows.length) ok(`Open shifts: every row has Take this shift (${all.rows.filter(r => r.take === "enabled").length} enabled for s1, ${all.rows.filter(r => r.take === "disabled").length} disabled with a hard reason${all.rows.some(r => r.take === "disabled") ? ", e.g. \"" + all.rows.find(r => r.take === "disabled").title + "\"" : ""}) and Assign...; Outside cover on the primary rows only`);
    // (a locked-but-empty slot is the one exception: s1 may be eligible by the rules, yet Take is disabled with 'slot locked' because the function refuses CLAIM_LOCKED)
    const eligMismatch = all.rows.filter(r => !/slot locked/.test(r.title) && (r.take === "enabled") !== r.eligible.includes("s1"));
    const lockedRows = all.rows.filter(r => /slot locked/.test(r.title));
    if (eligMismatch.length) fail(`Open shifts: ${eligMismatch.length} row(s) where the Take button disagrees with the Eligible now chips for s1, e.g. ${eligMismatch[0].slot}`); else if (all.rows.length) ok(`Open shifts: the Take button is enabled exactly on the rows whose Eligible now chips include Khan (s1)${lockedRows.length ? ` (${lockedRows.length} locked-but-empty slot(s) disabled with 'slot locked')` : ""}`);
    const nobody = all.rows.filter(r => !r.eligible.length);
    if (nobody.some(r => !/nobody under the current rules/.test(r.text))) fail("Open shifts: a row with no eligible surgeon does not say 'nobody under the current rules': " + nobody.find(r => !/nobody under the current rules/.test(r.text)).text.slice(0, 120));
    else console.log(`     (${nobody.length} row(s) with nobody eligible under the current rules${nobody.length ? ", e.g. " + nobody[0].slot : ""})`);
    if (all.rows.some(r => r.announced !== "never")) fail("Open shifts: 'last announced' should read 'never' before any open_shifts notice this run: " + all.rows.find(r => r.announced !== "never").announced);
    // Filters: 30 / 60 / all, role, weekend-only.
    const h30 = plusDays(todayIso, 29);
    await page.click("[data-testid=ob-horizon-30]"); await page.waitForTimeout(150);
    const b30 = await readBoard();
    const exp30 = all.rows.filter(r => r.day <= h30).length;
    if (b30.rows.length !== exp30 || b30.rows.some(r => r.day > h30)) fail(`Open shifts: 'next 30 days' shows ${b30.rows.length} row(s), expected ${exp30} (through ${h30})`); else ok(`Open shifts: filter next 30 days -> ${b30.rows.length} row(s) through ${h30}`);
    await page.click("[data-testid=ob-horizon-60]"); await page.waitForTimeout(150);
    const b60 = await readBoard();
    if (b60.rows.length !== inWin.length || b60.rows.some(r => r.day > h60)) fail(`Open shifts: 'next 60 days' shows ${b60.rows.length} row(s), expected ${inWin.length} (through ${h60})`); else ok(`Open shifts: filter next 60 days -> ${b60.rows.length} row(s) through ${h60}`);
    await page.selectOption("[data-testid=ob-role]", "primary"); await page.waitForTimeout(150);
    const bP = await readBoard();
    if (bP.rows.length !== inWin.filter(r => r.role === "primary").length || bP.rows.some(r => r.role !== "primary")) fail(`Open shifts: role filter 'primary' shows ${bP.rows.length} row(s) (${bP.rows.filter(r => r.role !== "primary").length} not primary), expected ${inWin.filter(r => r.role === "primary").length}`); else ok(`Open shifts: role filter primary -> ${bP.rows.length} row(s)`);
    await page.selectOption("[data-testid=ob-role]", "all");
    await page.click("[data-testid=ob-weekend]"); await page.waitForTimeout(150);
    const bW = await readBoard();
    if (bW.rows.length !== inWin.filter(r => isWknd(r.day)).length || bW.rows.some(r => !isWknd(r.day))) fail(`Open shifts: weekend-only shows ${bW.rows.length} row(s) (${bW.rows.filter(r => !isWknd(r.day)).length} on a weekday), expected ${inWin.filter(r => isWknd(r.day)).length}`); else ok(`Open shifts: weekend-only -> ${bW.rows.length} Fri/Sat/Sun row(s)`);
    await page.click("[data-testid=ob-weekend]");
    await page.click("[data-testid=ob-horizon-all]"); await page.waitForTimeout(150);
    const badgeStill = await badgeOf();
    if (badgeStill !== all.rows.length) fail(`Open shifts: the badge followed the filters (${badgeStill}); it must always count the whole range (${all.rows.length})`); else ok("Open shifts: the badge kept counting the whole range while the filters changed");
    // The review shot of the board: whole range, no toast, taken BEFORE Copy list so no 'Copied' toast covers the rows.
    await clearToast();
    await page.screenshot({ path: path.join(OUT, "openshifts.png"), fullPage: true });
    // Copy list: one openSlotsLine per visible row, written with navigator.clipboard.writeText (mocked to record; delegated to the real clipboard).
    await page.evaluate(() => { window.__obClip = []; const real = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async (t) => { window.__obClip.push(t); try { await real(t); } catch (e) {} }; });
    await page.click("[data-testid=ob-copy]");
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => window.__obClip);
    const lines = (clip[0] || "").split("\n").filter(Boolean);
    if (clip.length !== 1 || lines.length !== all.rows.length) fail(`Open shifts: Copy list wrote ${clip.length} time(s), ${lines.length} line(s) for ${all.rows.length} row(s)`);
    else if (!lines.every(l => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\/\d{2} - (primary|backup)( \([^)]*\))? - open/.test(l))) fail("Open shifts: a Copy list line is not 'Ddd MM/DD - role (unit) - open': " + lines.find(l => !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\/\d{2} - (primary|backup)( \([^)]*\))? - open/.test(l)));
    else if (!noAddr(clip[0])) fail("Open shifts: the Copy list carries an email address");
    else ok(`Open shifts: Copy list -> ${lines.length} line(s), e.g. "${lines[0]}"${lines.length > 1 ? ` ... "${lines[lines.length - 1]}"` : ""}`);
    // Email the group now (scheduler): a confirm dialog PREVIEWS the composed e-mail (Prompt 13 part 5b: subject 'N open shifts through M/D',
    // the slots grouped by Monday week, the #openshifts deep link) and writes NOTHING until Send -> feed row open_shifts (data.slots = the
    // whole range, title = the subject) + broadcast send-notification { subject, message, detail } + audit openshifts.notify; 'last announced' fills.
    // 9/25 (10/15 filled): the button is disabled={!boardSlots.length} in index-source.html, and page.click on a disabled
    // button waits out Playwright's 30 s actionability timeout - the 9/25 17:00 run's "Open shifts board: page.click:
    // Timeout 30000ms exceeded" was exactly that: the claim took the harness-opened slot, the only open slot once 10/15 was
    // filled, and the step then clicked Email on the emptied board (its "nothing to announce" branch came after the click).
    // So the step runs on a board that still lists a slot: BEFORE the claim when the claim takes the only one
    // (emailBeforeClaim), else after it as before; a board with no slot at all asserts the button disabled and says so.
    let emailExercised = false;
    const emailGroupNow = async (when) => {
      const cur0 = await readBoard();
      if (!cur0.rows.length) {
        const dis = await page.$eval("[data-testid=ob-email]", b => b.disabled).catch(() => null);
        if (dis !== true) fail(`Open shifts: with no open slot on the board (${when}) Email the group now must be disabled - nothing to announce - but disabled=${dis}`);
        else console.log(`     (Open shifts: no open slot on the board ${when} - Email the group now is disabled, as it must be; its preview / send path is not exercised this run)`);
        return;
      }
      emailExercised = true;
      const beforeMail = writes.length;
      await clearToast();
      await page.click("[data-testid=ob-email]");
      await page.waitForSelector("[data-testid=ob-email-dialog]", { timeout: 5000 });
      await page.waitForTimeout(200);
      const pv = await page.$eval("[data-testid=ob-email-preview]", el => ({
        subject: (el.querySelector("[data-testid=ob-email-subject]") || { textContent: "" }).textContent.replace(/^Subject:\s*/, "").trim(),
        message: (el.querySelector("[data-testid=ob-email-message]") || { textContent: "" }).textContent,
        detail: (el.querySelector("[data-testid=ob-email-detail]") || { textContent: "" }).textContent.trim(),
        label: el.innerText.split("\n")[0].trim(),
      }));
      await page.screenshot({ path: path.join(OUT, "openshifts-email-preview.png"), fullPage: false });
      const previewWrites = writes.slice(beforeMail).filter(w => /send-notification|\/rest\/v1\/(notifications|audit_log)/.test(w.path));
      const weekHeads = (pv.message.match(/^Week of Mon \d{1,2}\/\d{1,2}:$/gm) || []).length;
      const previewLines = pv.message.split("\n").filter(l => /^  \w{3} \d{2}\/\d{2} - (primary|backup)( \([^)]*\))? - open/.test(l)).length;
      if (previewWrites.length) fail("Open shifts: the Email-the-group preview dialog already wrote something before Send: " + previewWrites.map(w => w.method + " " + w.path).join(", "));
      else if (!/^Preview$/i.test(pv.label)) fail("Open shifts: the confirm dialog has no 'Preview' section heading, got: " + pv.label);
      else if (!/^\d+ open shifts? through \d{1,2}\/\d{1,2}$/.test(pv.subject)) fail("Open shifts: preview subject is not 'N open shifts through M/D': " + pv.subject);
      else if (!pv.subject.startsWith(cur0.rows.length + " open shift")) fail(`Open shifts: preview subject counts ${pv.subject} but the board lists ${cur0.rows.length}`);
      else if (weekHeads < 1 || previewLines !== cur0.rows.length) fail(`Open shifts: preview message should group ${cur0.rows.length} indented slot lines under 'Week of Mon M/D:' headings (got ${weekHeads} heading(s), ${previewLines} line(s)): ` + pv.message.slice(0, 240).replace(/\n/g, " | "));
      else if (!/^Take this shift: http:\/\/[^\s]+#openshifts$/.test(pv.detail)) fail("Open shifts: preview detail is not the 'Take this shift: <app>#openshifts' deep link: " + pv.detail);
      else ok(`Open shifts: Email the group now (${when}) previews the e-mail before sending - subject "${pv.subject}", ${weekHeads} week group(s), ${previewLines} slot line(s), detail "${pv.detail}" - and writes nothing until Send`);
      // Escape closes it without a write; open again and send
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=ob-email-dialog]", { state: "detached", timeout: 3000 });
      const escWrites = writes.slice(beforeMail).filter(w => /send-notification|\/rest\/v1\/(notifications|audit_log)/.test(w.path));
      if (escWrites.length) fail("Open shifts: closing the preview with Escape wrote a notice: " + escWrites.map(w => w.method + " " + w.path).join(", "));
      else if (writes.length !== beforeMail) console.log("     (unrelated background write(s) while the preview was open: " + writes.slice(beforeMail).map(w => w.method + " " + w.path).join(", ") + ")");
      await page.click("[data-testid=ob-email]");
      await page.waitForSelector("[data-testid=ob-email-send]", { timeout: 5000 });
      await page.click("[data-testid=ob-email-send]");
      await page.waitForSelector("[data-testid=ob-email-dialog]", { state: "detached", timeout: 8000 });
      await waitFor(() => writes.slice(beforeMail).some(w => /send-notification/.test(w.path)), 8000);
      // the audit row is written after the e-mail outcome is known (the toast states it) - wait for it rather than for time
      await waitFor(() => writes.slice(beforeMail).some(w => w.path.startsWith("/rest/v1/audit_log") && /openshifts\.notify/.test(w.body || "")), 8000);
      await page.waitForTimeout(400);
      const feed = writes.slice(beforeMail).filter(w => w.path.startsWith("/rest/v1/notifications")).map(parseBody).find(n => n && n.type === "open_shifts");
      const mail2 = writes.slice(beforeMail).filter(w => /send-notification/.test(w.path)).map(parseBody).find(b => b && b.type === "open_shifts");
      const audit2 = writes.slice(beforeMail).filter(w => w.path.startsWith("/rest/v1/audit_log")).map(parseBody).find(b => b && b.action === "openshifts.notify");
      const cur = await readBoard();
      if (!feed || !feed.data || !Array.isArray(feed.data.slots) || feed.data.slots.length !== cur0.rows.length || !feed.data.slots.every(s => s && s.day && (s.role === "primary" || s.role === "backup"))) fail("Open shifts: Email the group now wrote no open_shifts feed row with data.slots for every open slot: " + JSON.stringify(feed && feed.data));
      else if (String(feed.message).split("\n").filter(l => / - open/.test(l)).length !== cur0.rows.length) fail("Open shifts: the open_shifts feed message does not list one openSlotsLine per slot: " + String(feed.message).slice(0, 200));
      else if (!mail2 || mail2.targetIds !== undefined || !mail2.data || !/ - open/.test(String(mail2.data.message))) fail("Open shifts: Email the group now must POST send-notification type open_shifts as a broadcast (no targetIds; the server gates per category) with the list in data.message: " + JSON.stringify(mail2));
      else if (!/^\d+ open shifts? through \d{1,2}\/\d{1,2}$/.test(String(mail2.data.subject)) || feed.title !== mail2.data.subject || !/#openshifts$/.test(String(mail2.data.detail)) || !/Week of Mon/.test(String(mail2.data.message)) || mail2.data.message !== feed.message) fail("Open shifts: the e-mail must carry subject 'N open shifts through M/D' (= the feed row's title), the week-grouped message (= the feed message) and the #openshifts detail: " + JSON.stringify(mail2.data).slice(0, 300));
      else if (!audit2 || audit2.detail.count !== cur0.rows.length) fail("Open shifts: no audit 'openshifts.notify' with the count: " + JSON.stringify(audit2));
      else if (cur.rows.some(r => r.announced === "never")) fail(`Open shifts: 'last announced' still reads 'never' on ${cur.rows.filter(r => r.announced === "never").length} row(s) after the notice`);
      else ok(`Open shifts: Email the group now (${when}) -> feed open_shifts (${feed.data.slots.length} slots) + send-notification open_shifts (broadcast) + audit openshifts.notify; 'last announced' now "${cur.rows[0].announced}"`);
      if (!writes.slice(beforeMail).every(w => noAddr(w.body))) fail("Open shifts: a notice write body carries an email address");
    };
    // Take this shift as s1 on the first row where s1 is eligible.
    const target = all.rows.find(r => r.take === "enabled");
    // the claim would take the board's only open slot (LIVE mode since 10/15 was filled 9/25): announce while it is listed
    const emailBeforeClaim = !!target && all.rows.length === 1;
    if (emailBeforeClaim) await emailGroupNow("before the claim, which takes the board's only open slot");
    let claimExercised = false;
    if (!target) console.log("     (no row where s1 is eligible under the current rules - the claim flow is not exercised)");
    else {
      claimExercised = true;
      const [cDay, cRole] = target.slot.split("|");
      const beforeClaim = writes.length;
      await clearToast();
      await page.click(`tr[data-slot="${target.slot}"] [data-testid=ob-take]`);
      await page.waitForSelector("[data-testid=claim-sheet]", { timeout: 5000 });
      const sheet = await page.$eval("[data-testid=claim-sheet]", el => el.innerText.replace(/\s+/g, " "));
      // a viewport shot: the sheet is a fixed overlay, a full-page stitch paints a band under it
      await page.screenshot({ path: path.join(OUT, "openshifts-sheet.png"), fullPage: false });
      const md = `${Number(cDay.slice(5, 7))}/${Number(cDay.slice(8, 10))}`;
      if (!sheet.includes(md) || !new RegExp("\\b" + cRole + "\\b", "i").test(sheet) || !/07:00/.test(sheet)) fail(`Open shifts: the confirm sheet does not name ${md} ${cRole} and the 07:00 shift: ` + sheet.slice(0, 200));
      else ok(`Open shifts: Take this shift on ${target.slot} opens the confirm sheet: "${sheet.slice(0, 150)}"`);
      // Escape closes it without a write; open it again and confirm.
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=claim-sheet]", { state: "detached", timeout: 3000 });
      if (writes.length !== beforeClaim) fail("Open shifts: closing the sheet with Escape produced a write");
      await page.click(`tr[data-slot="${target.slot}"] [data-testid=ob-take]`);
      await page.waitForSelector("[data-testid=claim-sheet]", { timeout: 5000 });
      await page.click("[data-testid=claim-confirm]");
      await waitFor(() => writes.slice(beforeClaim).some(w => w.path === "/rest/v1/rpc/claim_open_slot"), 8000);
      const claimWrite = writes.slice(beforeClaim).find(w => w.path === "/rest/v1/rpc/claim_open_slot");
      const cb = claimWrite ? parseBody(claimWrite) || {} : {};
      if (!claimWrite || claimWrite.method !== "POST" || cb.p_day !== cDay || cb.p_role !== cRole || Object.keys(cb).length !== 2) fail(`Open shifts: expected POST /rest/v1/rpc/claim_open_slot { p_day: ${cDay}, p_role: ${cRole} }, saw ${JSON.stringify(claimWrite)}`);
      else ok(`Open shifts: Confirm -> POST /rest/v1/rpc/claim_open_slot ${claimWrite.body}`);
      const toast = await page.waitForSelector("text=/You took/", { timeout: 5000 }).then(el => el.innerText()).catch(() => "");
      if (!/You took/.test(toast)) fail("Open shifts: no 'You took ...' toast after the claim"); else ok(`Open shifts: toast "${toast.trim()}"`);
      noteEdit(cDay, { [cRole === "primary" ? "primary_id" : "backup_id"]: "s1" });
      const gone = await waitFor(async () => !(await page.$(`tr[data-slot="${target.slot}"]`)), 10000);
      if (!gone) fail(`Open shifts: the row ${target.slot} is still on the board after the claim + refetch`); else ok(`Open shifts: the row ${target.slot} left the board after the refetch (the mocked row now holds s1)`);
      if (await page.$("[data-testid=claim-sheet]")) fail("Open shifts: the confirm sheet stayed open after a successful claim");
      const after = writes.slice(beforeClaim);
      const dupAudit = after.filter(w => w.path.startsWith("/rest/v1/audit_log")).map(parseBody).find(b => b && b.action === "schedule.claim");
      const dupFeed = after.filter(w => w.path.startsWith("/rest/v1/notifications")).length;
      const dayWrites = after.filter(w => w.path.startsWith("/rest/v1/schedule_days")).length;
      const mail = after.filter(w => /send-notification/.test(w.path)).map(parseBody).find(b => b && b.type === "shift_claimed");
      if (dupAudit) fail("Open shifts: the client wrote an audit 'schedule.claim' row on SUCCESS (the SQL function writes it)");
      else if (dupFeed) fail("Open shifts: the client wrote a notifications row for the claim (the SQL function writes the feed row)");
      else if (dayWrites) fail(`Open shifts: the client wrote schedule_days directly (${dayWrites}) - the claim must go through the RPC only`);
      else if (!mail || !Array.isArray(mail.targetIds) || !mail.targetIds.includes("s1") || !mail.data || !/took/.test(String(mail.data.message))) fail("Open shifts: no send-notification shift_claimed targeted at the scheduler + claimer with a message: " + JSON.stringify(mail));
      else ok(`Open shifts: no client audit / feed / schedule_days write for the claim; send-notification shift_claimed -> targetIds ${JSON.stringify(mail.targetIds)}, "${String(mail.data.message).slice(0, 80)}"`);
      if (!after.every(w => noAddr(w.body))) fail("Open shifts: a claim write body carries an email address");
      const badgeAfter = await badgeOf();
      if (badgeAfter !== all.rows.length - 1) fail(`Open shifts: the badge reads ${badgeAfter} after the claim, expected ${all.rows.length - 1}`); else ok(`Open shifts: badge ${all.rows.length} -> ${badgeAfter} after the claim`);
      const [cy, cm] = cDay.split("-");
      await showMonth(Number(cy), Number(cm) - 1);
      const cellNow = await cellAttr(cDay, cRole === "primary" ? "data-primary" : "data-backup");
      if (cellNow !== "s1") fail(`Open shifts: the calendar cell ${cDay} ${cRole} reads '${cellNow}' after the claim, expected s1`); else ok(`Open shifts: the calendar cell ${cDay} ${cRole} now shows s1`);
      // A second claim of a slot the mocked table already holds is refused with the function's token, shown verbatim.
      await openBoard();
      await page.click("[data-testid=ob-horizon-all]"); await page.waitForTimeout(150);
      const held = await page.evaluate((slot) => { const b = document.querySelector(`tr[data-slot="${slot}"] [data-testid=ob-take]`); return !!b; }, target.slot);
      if (held) fail(`Open shifts: ${target.slot} is still offered after the claim`);
    }
    if (!emailBeforeClaim) await emailGroupNow(target ? "after the claim" : "(no claim this run)");
    // 9/25 (10/15 filled): in LIVE mode the claim takes the board's only open slot, so the 390 px / dark probes below
    // may run on the empty-state board (one 'No open shifts' cell) - say so, so their ok lines never stand in silently
    // for a populated table.
    const probeRows = (await readBoard()).rows.length;
    if (!probeRows) console.log("     (Open shifts 390 px / dark: the board is empty here (no open slot left" + (claimExercised ? " after the claim" : "") + ") - the probes below measure the empty-state row only; populated-row contrast and the table's in-wrapper scroll are not exercised this run)");
    // 390 px, light: no page scroll, the table scrolls inside its wrapper with the swipe hint, buttons >= 36 px.
    const mobileProbe = () => page.evaluate(() => {
      const wrap = document.querySelector("[data-testid=openshifts-wrap]");
      const btns = Array.from(document.querySelectorAll("[data-testid=openshifts-card] button")).filter(b => b.offsetParent !== null);
      return { pageW: document.documentElement.scrollWidth, cls: wrap ? wrap.className : "", hint: wrap ? getComputedStyle(wrap, "::after").content : "", wrapScroll: wrap ? wrap.scrollWidth : 0, wrapClient: wrap ? wrap.clientWidth : 0, minBtn: btns.length ? Math.min(...btns.map(b => b.getBoundingClientRect().height)) : 0, bodyBg: getComputedStyle(document.body).backgroundColor, wrapBg: wrap ? getComputedStyle(wrap).backgroundImage : "" };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const m1 = await mobileProbe();
    if (m1.pageW > 392) fail(`Open shifts 390px: the page scrolls horizontally (scrollWidth ${m1.pageW})`);
    else if (!/table-wrap/.test(m1.cls) || !/swipe sideways/.test(m1.hint)) fail("Open shifts 390px: the table wrapper lacks the table-wrap swipe hint: " + JSON.stringify(m1));
    else if (m1.minBtn && m1.minBtn < 36) fail(`Open shifts 390px: a button is shorter than 36px (${m1.minBtn})`);
    else ok(`Open shifts 390px (light): no horizontal page scroll (${m1.pageW}), the table ${m1.wrapScroll > m1.wrapClient ? "scrolls inside" : "fits"} its wrapper (${m1.wrapScroll} in ${m1.wrapClient}) with the swipe hint, buttons >= 36px`);
    await clearToast();
    await page.screenshot({ path: path.join(OUT, "openshifts-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Dark')");
    await openBoard();
    await page.waitForTimeout(300);
    await clearToast();
    // a viewport shot (1180 x 900): the full-page dark board weighs over the 300 KB review rule; the 390 px dark shot below stays full-page
    await page.screenshot({ path: path.join(OUT, "openshifts-dark.png"), fullPage: false });
    const darkText = await page.evaluate(() => {
      const parseRgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(x => parseFloat(x)); return p.length >= 4 && p[3] === 0 ? null : p.slice(0, 3); };
      const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
      const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parseRgb(getComputedStyle(e).backgroundColor); if (c) return c; } return [26, 26, 46]; };
      const cells = Array.from(document.querySelectorAll("[data-testid=openshifts-table] tbody td")).slice(0, 40);
      const worst = cells.map(td => { const fg = parseRgb(getComputedStyle(td).color); return fg ? Math.round(ratio(fg, bgOf(td)) * 100) / 100 : 21; }).reduce((a, b) => Math.min(a, b), 21);
      return { worst, cells: cells.length };
    });
    if (darkText.cells && darkText.worst < 3) fail(`Open shifts dark: a table cell's text is below 3:1 contrast (${darkText.worst})`); else ok(`Open shifts dark: table text contrast >= 3:1 (worst ${darkText.worst} over ${darkText.cells} cells${probeRows ? "" : " - the empty-state row only"})`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    // Part 6: the dark 390 px pass runs the SAME probe as the light one (wrapper hint, button height) plus the dark body, and keeps its own screenshot.
    // Fix round: the swipe-hint covers must be repainted in the dark card colour - a white (#ffffff) cover paints a pale band over the date column.
    const m2 = await mobileProbe();
    if (m2.pageW > 392) fail(`Open shifts 390px (dark): the page scrolls horizontally (scrollWidth ${m2.pageW})`);
    else if (!/rgb\(11, 26, 51\)/.test(m2.bodyBg)) fail("Open shifts 390px (dark): the body background is not the dark navy (#0B1A33, theme O.2): " + m2.bodyBg);
    else if (!/table-wrap/.test(m2.cls) || !/swipe sideways/.test(m2.hint)) fail("Open shifts 390px (dark): the table wrapper lacks the table-wrap swipe hint: " + JSON.stringify(m2));
    else if (m2.minBtn && m2.minBtn < 36) fail(`Open shifts 390px (dark): a button is shorter than 36px (${m2.minBtn})`);
    else if (/rgb\(255, 255, 255\)/.test(m2.wrapBg) || !/rgb\(22, 33, 62\)/.test(m2.wrapBg)) fail("Open shifts 390px (dark): the table-wrap swipe-hint cover is still white under dark mode (computed background-image): " + m2.wrapBg.slice(0, 200));
    else ok(`Open shifts 390px (dark): no horizontal page scroll (${m2.pageW}), body ${m2.bodyBg}, the table ${m2.wrapScroll > m2.wrapClient ? "scrolls inside" : "fits"} its wrapper (${m2.wrapScroll} in ${m2.wrapClient}) with the swipe hint painted in the dark card colour, buttons >= 36px`);
    await clearToast();
    await page.screenshot({ path: path.join(OUT, "openshifts-390-dark.png"), fullPage: true });
    // The 'ok screenshots' line is earned: the sheet and preview shots sit inside conditionals, so check that every one of the six exists, is from THIS run and is under 300 KB (review shots stay in test/ui/out/ - B10 9/23).
    // (the sheet shot exists only when the claim flow ran - LIVE mode without a claimable slot skips it and says so; the
    // preview shot only when emailGroupNow found a slot to announce - it says so otherwise)
    const SIX = ["openshifts.png", "openshifts-sheet.png", "openshifts-email-preview.png", "openshifts-390.png", "openshifts-dark.png", "openshifts-390-dark.png"].filter(f => (f !== "openshifts-sheet.png" || claimExercised) && (f !== "openshifts-email-preview.png" || emailExercised));
    if (!claimExercised) console.log("     (openshifts-sheet.png not required: the claim flow did not run)");
    if (!emailExercised) console.log("     (openshifts-email-preview.png not required: the board had no open slot to announce)");
    const shotState = SIX.map(f => { const p = path.join(OUT, f); if (!fs.existsSync(p)) return { f, why: "missing" }; const st = fs.statSync(p); if (st.mtimeMs < shotStart - 2000) return { f, why: "stale (" + new Date(st.mtimeMs).toISOString() + ")" }; if (st.size > 300 * 1024) return { f, why: "too big (" + st.size + " bytes)" }; return { f, size: st.size }; });
    const badShots = shotState.filter(s => s.why);
    if (badShots.length) fail("screenshots missing or stale: " + badShots.map(s => `${s.f} ${s.why}`).join(", "));
    else ok("screenshots test/ui/out/" + shotState.map(s => `${s.f} (${Math.round(s.size / 1024)} KB)`).join(", ") + " - all from this run, all under 300 KB");
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Light')");
    await page.click('button[data-tab="calendar"]');
    await page.waitForTimeout(200);
  } catch (e) { fail("Open shifts board: " + errLine(e)); try { await page.screenshot({ path: path.join(OUT, "failure-openshifts.png"), fullPage: true }); } catch (e2) {} }
  await page.setViewportSize({ width: 1180, height: 900 });

  const now = new Date();
  // The edit day: the first row-less day from the start of the current month
  // (so the editor save is a POST v1 and the publish diff reads 'OPEN -> Burchett'),
  // scanning forward up to a year once the current month is fully published.
  const day = (() => { const start = Date.UTC(now.getFullYear(), now.getMonth(), 1); for (let i = 0; i < 366; i++) { const d = utcDay(start + i * 86400000); if (!fixtureHasDay(d) && !liveByDay[d]) return d; } return null; })();
  if (!day) fail("no row-less day within a year of the current month for the day-editor edit");
  else if (day.slice(0, 7) !== `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`) console.log(`     (edit day ${day}: the current month is fully published)`);
  if (day) {
    // Prompt 16 B1 review: the edit below, the B1 undo step and the realtime race that follows all read `day` as
    // this run left it (P Burchett) - about 20 s of steps that every write-intercepting run races against the
    // app's 60-s poll (a poll inside that stretch drops the row-less day and the race's editor then opens on
    // OPEN, saving { primary null, backup s3 }; seen once on the fixture source). Start them at the top of a
    // fresh poll interval, exactly as the outside-surgeon step does.
    await freshPollWindow("day editor edit");
    const beforeWrites = writes.length;
    await editDay(day, "primary", "s2");
    noteEdit(day, { primary_id: "s2" });
    await page.waitForTimeout(1800); // 800ms debounce + request
    if ((await cellAttr(day, "data-primary")) !== "s2") fail(`day editor save did not update the ${day} cell (data-primary = ${await cellAttr(day, "data-primary")})`); else ok(`day editor: ${day} P -> Burchett saved into the cell`);
    const dayWrite = writes.slice(beforeWrites).find(w => w.path.startsWith("/rest/v1/schedule_days"));
    if (!dayWrite) fail("schedule edit produced no schedule_days write; writes: " + JSON.stringify(writes.slice(beforeWrites)));
    else {
      const body = JSON.parse(dayWrite.body || "{}");
      const good = dayWrite.method === "POST" && body.day === day && body.primary_id === "s2" && body.version === 1 && /return=representation/.test(dayWrite.prefer) && body.updated_by === "s1";
      if (!good) fail("schedule_days write shape wrong: " + JSON.stringify(dayWrite));
      else ok(`schedule edit -> POST /rest/v1/schedule_days { day: ${day}, primary_id: s2, version: 1, updated_by: s1 } with Prefer return=representation`);
    }
    const auditWrite = writes.slice(beforeWrites).map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.action === "schedule.day_edit");
    if (!auditWrite) fail("no audit_log 'schedule.day_edit' row after the editor save");
    else if (!auditWrite.detail || !auditWrite.detail.before || !auditWrite.detail.after || auditWrite.detail.after.primary_id !== "s2") fail("audit schedule.day_edit lacks before/after rows: " + JSON.stringify(auditWrite.detail));
    else ok("audit_log schedule.day_edit carries before/after rows (after.primary_id s2)");
    // Prompt 16 A4: the blob leg is keyed on the setup state alone - a day edit writes schedule_days and NOTHING to
    // call_schedule_data (the blob used to be upserted on every autosave run). The Rules / Roster steps below prove
    // the setup write (a CAS PATCH) and its config-keys-only shape.
    const dayEditBlobWrites = writes.slice(beforeWrites).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path));
    if (dayEditBlobWrites.length) fail("A4: a day edit wrote call_schedule_data (the blob leg fired on operational state): " + JSON.stringify(dayEditBlobWrites.map(w => w.method + " " + w.path)));
    else ok("A4: the day edit wrote schedule_days only - no call_schedule_data write (the blob leg is keyed on the setup state, not the schedule)");
  }
  await page.screenshot({ path: path.join(OUT, "calendar-after-edit.png"), fullPage: true });

  // ---- Prompt 16 B1: Undo is per edit and per day ----
  // Two day-editor saves (the edit above on `day`, a second on `u2`), then Undo: exactly the second one comes back
  // (u2 -> OPEN, re-synced as a CAS PATCH against the version its POST returned - the session's own write is not a
  // foreign change) and `day` keeps Burchett. Then a third save on `u3` followed by a foreign realtime row for it
  // (a claim landing, v9): Undo skips that day, says so in the toast, and the cell keeps the foreign row. Until B1 the
  // button put back a whole-map snapshot, which reverted the foreign row silently.
  if (day) {
    const md = (d) => Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10));
    const monthDays = await page.$$eval("[data-day]", els => els.map(e => e.getAttribute("data-day")));
    const spare = monthDays.filter(d => d !== day && d.slice(0, 7) === day.slice(0, 7) && !fixtureHasDay(d) && !liveByDay[d]).reverse();
    const u2 = spare[0], u3 = spare[1];
    if (!u2 || !u3) fail("B1: no two spare row-less days in " + day.slice(0, 7) + " for the undo step");
    else {
      const undoBtn = "[data-testid=undo-btn]";
      const toastText = () => page.$eval("[data-testid=toast]", el => el.textContent.trim()).catch(() => "");
      const b1 = writes.length;
      await editDay(u2, "primary", "s3");
      await page.waitForTimeout(1800); // 800ms debounce + the POST
      const postU2 = writes.slice(b1).find(w => w.method === "POST" && w.path.startsWith("/rest/v1/schedule_days") && /"day":"/.test(w.body) && JSON.parse(w.body).day === u2);
      if (!postU2) fail("B1: the second save (" + u2 + " P -> Acton) produced no schedule_days POST; writes: " + JSON.stringify(writes.slice(b1).map(w => w.method + " " + w.path)));
      const b2 = writes.length;
      if (!(await page.$(undoBtn))) fail("B1: no Undo button after two saves");
      else {
        await page.click(undoBtn);
        const sawToast = await waitFor(async () => /^Undo:/.test(await toastText()), 3000);
        const t1 = await toastText();
        if (!sawToast || t1 !== "Undo: 1 day restored (" + md(u2) + ").") fail("B1: Undo toast wrong: '" + t1 + "' (expected 'Undo: 1 day restored (" + md(u2) + ").')");
        else ok("B1: Undo toast: '" + t1 + "'");
        await page.waitForTimeout(1800);
        const pU2 = await cellAttr(u2, "data-primary"), pDay = await cellAttr(day, "data-primary");
        if (pU2) fail("B1: Undo did not put " + u2 + " back to OPEN (data-primary " + pU2 + ")");
        else if (pDay !== "s2") fail("B1: Undo touched the earlier save on " + day + " (data-primary " + pDay + ")");
        else ok("B1: Undo restored exactly the later save (" + u2 + " -> OPEN; " + day + " still Burchett)");
        const patchU2 = writes.slice(b2).find(w => w.method === "PATCH" && w.path.startsWith("/rest/v1/schedule_days?day=eq." + u2 + "&version=eq.1"));
        const pb = patchU2 ? JSON.parse(patchU2.body || "{}") : null;
        if (!patchU2) fail("B1: the undo did not re-sync as PATCH ?day=eq." + u2 + "&version=eq.1; writes: " + JSON.stringify(writes.slice(b2).map(w => w.method + " " + w.path)));
        else if (pb.primary_id !== null || pb.version !== 2) fail("B1: the undo PATCH body is wrong: " + JSON.stringify(pb));
        else ok("B1: the undo re-synced as PATCH ?day=eq." + u2 + "&version=eq.1 with primary_id null, version 2 (the version the POST returned - the session's own write is not a foreign change)");
      }
      // The foreign-change half: a save on u3, then a claim lands on it (realtime v9) -> Undo leaves it alone.
      const b3 = writes.length;
      await editDay(u3, "backup", "s5");
      await page.waitForTimeout(1800);
      if (!writes.slice(b3).some(w => w.method === "POST" && w.path.startsWith("/rest/v1/schedule_days"))) fail("B1: the third save (" + u3 + " B -> Fierce) produced no schedule_days POST");
      if (!rt.joined) { noteEdit(u3, { backup_id: "s5" }); console.log("     (realtime not joined - the foreign-change half of B1 skipped)"); }
      else {
        rtSendDayRow(dayRow(u3, { primary_id: "s4", backup_id: "s5", version: 9 }));
        const adopted3 = await waitFor(async () => (await cellAttr(u3, "data-primary")) === "s4", 4000);
        if (!adopted3) fail("B1: the foreign v9 row for " + u3 + " was not adopted (data-primary " + (await cellAttr(u3, "data-primary")) + ") - the skip case cannot be checked");
        else if (!(await page.$(undoBtn))) fail("B1: no Undo button before the skip case"); // a missing button is one FAIL, not a 30 s click timeout that aborts the harness
        else {
          const b4 = writes.length;
          await page.click(undoBtn);
          const saw2 = await waitFor(async () => /^Undo:/.test(await toastText()), 3000);
          const t2 = await toastText();
          if (!saw2 || t2 !== "Undo: 0 of 1 day restored; 1 changed since (" + md(u3) + ").") fail("B1: the skip toast is wrong: '" + t2 + "' (expected 'Undo: 0 of 1 day restored; 1 changed since (" + md(u3) + ").')");
          else ok("B1: a day changed since the edit is skipped and named: '" + t2 + "'");
          await page.waitForTimeout(1800);
          const p3 = await cellAttr(u3, "data-primary"), k3 = await cellAttr(u3, "data-backup");
          const wrote = writes.slice(b4).filter(w => w.path.startsWith("/rest/v1/schedule_days"));
          if (p3 !== "s4" || k3 !== "s5") fail("B1: Undo reverted the foreign row on " + u3 + " (P " + p3 + " / B " + k3 + ", expected s4 / s5)");
          else if (wrote.length) fail("B1: the skipped undo still wrote schedule_days: " + JSON.stringify(wrote.map(w => w.method + " " + w.path)));
          else ok("B1: " + u3 + " keeps the foreign row (P Philip / B Fierce, v9) and nothing was written");
        }
        noteEdit(u3, { primary_id: "s4", backup_id: "s5" });
      }
    }
  }

  // ---- Realtime: a foreign row is adopted; a pending local edit survives the echo ----
  if (day && rt.joined) {
    const days = await page.$$eval("[data-day]", els => els.map(e => e.getAttribute("data-day")));
    const other = days.find(d => d !== day && d.slice(0, 7) === day.slice(0, 7) && !fixtureHasDay(d));
    // (a) foreign UPDATE on a day with no local edit -> adopted into the UI
    rtSendDayRow(dayRow(other, { primary_id: "s4", backup_id: "s5", version: 5 }));
    noteEdit(other, { primary_id: "s4", backup_id: "s5" });
    const adopted = await waitFor(async () => (await cellAttr(other, "data-primary")) === "s4", 4000);
    if (adopted) ok(`realtime: foreign row for ${other} (primary s4 v5) adopted into the calendar`);
    else fail(`realtime: foreign row for ${other} was not adopted (cell data-primary = ${await cellAttr(other, "data-primary")})`);
    // (b) THE RACE: set backup on `day` (local {s2,s3}, last persisted {s2}),
    //     then deliver the echo of the earlier primary write ({s2}, v1) inside
    //     the 800ms debounce. Before the fix the echo blanked the backup and
    //     no PATCH followed; now the local edit stays and PATCHes against v1.
    const beforeRace = writes.length;
    await editDay(day, "backup", "s3");
    noteEdit(day, { backup_id: "s3" });
    rtSendDayRow(dayRow(day, { primary_id: "s2", backup_id: null, version: 1, updated_by: "s1" }));
    await page.waitForTimeout(250);
    const midBackup = await cellAttr(day, "data-backup");
    await page.waitForTimeout(1800);
    const endBackup = await cellAttr(day, "data-backup");
    const patch = writes.slice(beforeRace).find(w => w.method === "PATCH" && w.path.startsWith(`/rest/v1/schedule_days?day=eq.${day}&version=eq.1`));
    const patchBody = patch ? JSON.parse(patch.body || "{}") : null;
    if (midBackup !== "s3" || endBackup !== "s3") fail(`realtime race: the pending backup edit was clobbered by the echo (backup after echo = '${midBackup}', after sync = '${endBackup}')`);
    else if (!patch) fail("realtime race: local edit kept but no CAS PATCH ?day&version=eq.1 followed; writes: " + JSON.stringify(writes.slice(beforeRace).map(w => w.method + " " + w.path)));
    else if (patchBody.backup_id !== "s3" || patchBody.primary_id !== "s2" || patchBody.version !== 2) fail("realtime race: PATCH body wrong: " + patch.body);
    else ok(`realtime race: echo of {P} during a pending {B} edit -> local kept, PATCH ?day=eq.${day}&version=eq.1 { primary_id: s2, backup_id: s3, version: 2 }`);
    const raceWarn = consoleWarns.find(t => /changed in the table \(v1\) while a local edit is unsaved/.test(t));
    if (raceWarn) ok("realtime race: console.warn names the kept local edit (not silent)"); else fail("realtime race: no console.warn about the kept local edit");
    // (c) the echo of THAT patch (v2, {s2,s3}) with nothing pending -> adopted,
    //     no schedule_days write (the days leg finds no diff) and - Prompt 16 A4 -
    //     no call_schedule_data write either: the blob leg is keyed on the setup
    //     state, so an adopted schedule row never re-writes the shared setup.
    const beforeEcho = writes.length;
    rtSendDayRow(dayRow(day, { primary_id: "s2", backup_id: "s3", version: 2, updated_by: "s1" }));
    await page.waitForTimeout(1500);
    const echoDayWrites = writes.slice(beforeEcho).filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    if (echoDayWrites.length) fail("realtime: a clean echo triggered a schedule_days write: " + JSON.stringify(echoDayWrites.map(w => w.method + " " + w.path)));
    else ok("realtime: the clean echo (v2) produced no schedule_days write");
    const echoBlobWrites = writes.slice(beforeEcho).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path));
    if (echoBlobWrites.length) fail("A4: a realtime schedule_days echo triggered a call_schedule_data write: " + JSON.stringify(echoBlobWrites.map(w => w.method + " " + w.path)));
    else ok("A4: the clean echo produced no call_schedule_data write either (the blob leg is not keyed on the schedule)");

    // (d) wire-1: the keepalive flush on background must keep the CAS
    //     contract. A foreign row at v3 arrives for `third`; a local edit on
    //     it goes pending; the tab hides inside the 800ms debounce. Expected:
    //     PATCH ?day=eq.third&version=eq.3 with version 4, and NO
    //     POST ...?on_conflict=day (the old blind upsert that could regress a
    //     newer device's row).
    const third = days.find(d => d !== day && d !== other && d.slice(0, 7) === day.slice(0, 7) && !fixtureHasDay(d));
    rtSendDayRow(dayRow(third, { primary_id: "s4", backup_id: "s6", version: 3 }));
    const adopted3 = await waitFor(async () => (await cellAttr(third, "data-primary")) === "s4", 4000);
    if (!adopted3) fail(`keepalive: foreign v3 row for ${third} was not adopted`);
    const beforeFlush = writes.length;
    await editDay(third, "backup", "s2");
    noteEdit(third, { primary_id: "s4", backup_id: "s2" });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
    });
    await page.waitForTimeout(400);
    const flushWrites = writes.slice(beforeFlush).filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    const upsert = flushWrites.find(w => /on_conflict=day/.test(w.path) || /merge-duplicates/.test(w.prefer || ""));
    const casPatch = flushWrites.find(w => w.method === "PATCH" && w.path === `/rest/v1/schedule_days?day=eq.${third}&version=eq.3`);
    const casBody = casPatch ? JSON.parse(casPatch.body || "{}") : null;
    if (upsert) fail("keepalive flush sent a blind upsert to schedule_days (CAS bypassed): " + upsert.method + " " + upsert.path + " prefer=" + upsert.prefer);
    else if (!casPatch) fail(`keepalive flush: no CAS PATCH ?day=eq.${third}&version=eq.3; schedule_days writes after the flush: ` + JSON.stringify(flushWrites.map(w => w.method + " " + w.path)));
    else if (casBody.version !== 4 || casBody.primary_id !== "s4" || casBody.backup_id !== "s2") fail("keepalive flush PATCH body wrong: " + casPatch.body);
    else ok(`keepalive flush (visibilitychange inside the debounce): PATCH ?day=eq.${third}&version=eq.3 { primary_id: s4, backup_id: s2, version: 4 } - no on_conflict upsert`);
    const lowVersion = flushWrites.map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).filter(b => b && b.day === third && typeof b.version === "number" && b.version <= 3);
    if (lowVersion.length) fail("keepalive flush wrote a version at or below the last seen v3: " + JSON.stringify(lowVersion.map(b => b.version))); else ok("keepalive flush never writes a version at or below the one last seen");
    await page.waitForTimeout(1500); // let the debounced sync settle before the next step

    // (e) RF2 b: while a CAS sync run is unresolved (a long Accept & Publish, the phone locked mid-way), the
    //     keepalive flush must NOT send parallel schedule_days writes - the same days at the same versions would go
    //     out twice. It skips the days leg, says so, keeps the blob leg, and the pending edit lands through the
    //     serialized sync afterwards (never lost). The harness holds the first edit's write open for 5 s.
    const fourth = days.find(d => ![day, other, third].includes(d) && d.slice(0, 7) === day.slice(0, 7) && !fixtureHasDay(d));
    const fifth = days.find(d => ![day, other, third, fourth].includes(d) && d.slice(0, 7) === day.slice(0, 7) && !fixtureHasDay(d));
    if (!fourth || !fifth) fail("RF2 keepalive-busy: no two free days left in the month for the step");
    else {
      delayScheduleWriteMs = 5000;
      const sinceBusy = (n, prefix) => writes.slice(n).filter(w => !prefix || w.path.startsWith(prefix)); // writesSince is declared further down the harness
      try {
        const beforeBusy = writes.length;
        await editDay(fourth, "backup", "s6"); noteEdit(fourth, { backup_id: "s6" });
        const started = await waitFor(() => sinceBusy(beforeBusy, "/rest/v1/schedule_days").length > 0, 4000); // the debounced sync is now in flight (held by the harness)
        const heldWrites = sinceBusy(beforeBusy, "/rest/v1/schedule_days");
        await editDay(fifth, "backup", "s3"); noteEdit(fifth, { backup_id: "s3" });
        const beforeFlush2 = writes.length;
        const warnsBefore = consoleWarns.length;
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
          delete document.hidden;
        });
        await page.waitForTimeout(400);
        const flushDays = sinceBusy(beforeFlush2, "/rest/v1/schedule_days");
        const flushBlob = sinceBusy(beforeFlush2).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path)); // A4: the flush's blob leg is a CAS PATCH sent only when the setup changed - nothing changed it here (the Rules step proves the sent case)
        const skipWarn = consoleWarns.slice(warnsBefore).find(t => /schedule_days leg skipped/.test(t));
        if (!started) fail(`RF2 keepalive-busy: the ${fourth} edit produced no schedule_days write within 4 s`);
        else if (!heldWrites.every(w => w.delayedMs)) fail("RF2 keepalive-busy: the harness did not hold the first write open: " + JSON.stringify(heldWrites.map(w => w.method + " " + w.path)));
        else if (flushDays.length) fail(`RF2 keepalive-busy: the flush sent ${flushDays.length} schedule_days write(s) while a sync run was in flight: ` + JSON.stringify(flushDays.map(w => w.method + " " + w.path)));
        else if (!skipWarn) fail("RF2 keepalive-busy: no console.warn saying the schedule_days leg was skipped (warns since: " + JSON.stringify(consoleWarns.slice(warnsBefore).slice(0, 4)) + ")");
        else if (flushBlob.length) fail("RF2 keepalive-busy / A4: the flush wrote call_schedule_data although the setup is unchanged (the blob leg's content gate): " + JSON.stringify(flushBlob.map(w => w.method + " " + w.path)));
        else ok(`RF2 keepalive-busy: flush while the ${fourth} CAS write is held open -> zero schedule_days writes, no call_schedule_data write (A4: unchanged setup is not re-sent; the days skip never returns before the blob leg - pinned in data-layer), warn "${skipWarn.slice(0, 100)}"`);
        // the skipped edit lands afterwards through the serialized sync (the debounced autosave queued behind the held run)
        const landedFifth = () => sinceBusy(beforeFlush2, "/rest/v1/schedule_days").some(w => { try { const b = JSON.parse(w.body || "{}"); return (b.day === fifth || new RegExp("day=eq\\." + fifth).test(w.path)) && b.backup_id === "s3"; } catch (e) { return false; } });
        const landed = await waitFor(landedFifth, 12000);
        if (!landed) fail(`RF2 keepalive-busy: the ${fifth} edit never reached schedule_days after the flush skipped it (writes since: ` + JSON.stringify(sinceBusy(beforeFlush2, "/rest/v1/schedule_days").map(w => w.method + " " + w.path)) + ")");
        else ok(`RF2 keepalive-busy: the skipped ${fifth} edit landed through the serialized sync afterwards (never lost)`);
      } finally { delayScheduleWriteMs = 0; }
      await page.waitForTimeout(6000); // let the held write answer and the chain drain before the next step
    }
  }

  // ---- Publish dialog: the diff line shows a real arrow, not the text "\u2192" ----
  if (day) {
    await page.click('button[data-tab="settings"]');
    const btn = page.locator("button:has-text('Publish and notify office')");
    if (!(await btn.isVisible().catch(() => false))) { await page.click("text=Office notifications"); }
    await btn.click();
    await page.waitForSelector("h3:has-text('Publish schedule changes')", { timeout: 5000 });
    const dlg = page.locator("div:has(> h3:has-text('Publish schedule changes'))");
    const text = await dlg.innerText();
    await page.screenshot({ path: path.join(OUT, "publish-dialog.png"), fullPage: true });
    const arrowLines = text.split("\n").filter(l => /\u2192/.test(l));
    if (/\\u2192/.test(text)) fail("publish dialog renders the literal text \\u2192 instead of an arrow: " + text.split("\n").find(l => /u2192/.test(l)));
    else if (arrowLines.length === 0) fail("publish dialog has no line with the arrow character; dialog text: " + text.slice(0, 300).replace(/\n/g, " | "));
    else if (!arrowLines.some(l => /P OPEN \u2192 Burchett$/.test(l.trim()))) fail("publish dialog arrow lines do not include the edit '<m/d> P OPEN -> Burchett': " + arrowLines.join(" | "));
    else ok(`publish dialog: ${arrowLines.length} change line(s) with a real arrow, e.g. "${arrowLines[0].trim()}"`);
    // finding safe-2: the close button must not read as undo - the changes are already saved
    if (!/already saved for every viewer/.test(text) || !(await page.$("[data-testid=publish-skip]:has-text('Skip the notice')"))) fail("publish dialog: expected the 'already saved' note and a 'Skip the notice' close button (not 'Cancel'): " + text.slice(0, 200).replace(/\n/g, " | "));
    else ok("publish dialog: says the changes are already saved and closes with 'Skip the notice' (no 'Cancel' that could read as undo)");
    // Prompt 13 part 5a (fix round): the open-shifts note is armed by Accept & Publish only - a dialog opened from the
    // header to LOOK at the diff and skipped writes nothing to the group (no open_shifts feed row, no send-notification).
    const beforeSkip = writes.length;
    await page.click("[data-testid=publish-skip]");
    await page.waitForSelector("[data-testid=publish-dialog]", { state: "detached", timeout: 5000 });
    await page.waitForTimeout(700);
    const skipWrites = writes.slice(beforeSkip).filter(w => /send-notification/.test(w.path) || (w.path.startsWith("/rest/v1/notifications") && /"open_shifts"/.test(w.body || "")));
    if (skipWrites.length) fail("publish dialog (header, Skip): a look at the diff must not announce open shifts, but wrote: " + skipWrites.map(w => w.method + " " + w.path).join(", "));
    else ok("publish dialog (header, Skip): no open_shifts note - only Accept & Publish arms the group notice");
  }

  // ====================== Prompt 6 Slices F + G: Totals, My schedule, Time off, Trades ======================
  // The recount below is INDEPENDENT of helpers.js: the published schedule_days
  // rows read above (anon fetch; the fixture rows when the live table is empty)
  // WITH this run's own edits applied (harnessDays) are tallied here with plain
  // loops and compared with the Totals table for October 2026 - visible cells
  // and data-* attributes both. There is no calendar-dependent skip (vis-002).
  const bodyText = () => page.evaluate(() => document.body.innerText || "");
  const writesSince = (n, pathPrefix) => writes.slice(n).filter(w => !pathPrefix || w.path.startsWith(pathPrefix));
  const auditSince = (n, action) => writes.slice(n).map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.action === action);
  const noAddress = (s) => !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(String(s || ""));
  const bodyOf = (w) => { try { return JSON.parse(w.body || "null"); } catch (e) { return null; } };
  const recountByDay = {}; Object.keys(liveByDay).forEach(d => { recountByDay[d] = { ...liveByDay[d] }; });
  Object.keys(harnessDays).forEach(d => { recountByDay[d] = { day: d, primary_id: null, backup_id: null, ...(recountByDay[d] || {}), ...harnessDays[d] }; });
  const recountRows = Object.values(recountByDay).sort((a, b) => a.day < b.day ? -1 : 1);
  const editedInOct = Object.keys(harnessDays).filter(d => d.slice(0, 7) === "2026-10");
  console.log(`     (recount source: ${fixture ? "seed fixtures" : "live rows"} + this run's ${Object.keys(harnessDays).length} edited day(s) ${Object.keys(harnessDays).sort().join(", ")}${editedInOct.length ? " - " + editedInOct.length + " of them in October 2026, applied to the recount" : ""})`);
  const IDS = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const recount = {};
  IDS.forEach(id => {
    let p = 0, b = 0, w = 0, best = 0, run = 0, runStart = null;
    for (let t = Date.UTC(2026, 8, 1); t <= Date.UTC(2026, 10, 30); t += 86400000) {
      const d = utcDay(t), r = recountByDay[d];
      const isP = !!(r && r.primary_id === id), isB = !!(r && r.backup_id === id);
      if (d >= "2026-10-01" && d <= "2026-10-31") {
        if (isP) p++;
        if (isB) b++;
        if ((isP || isB) && [0, 5, 6].includes(new Date(t).getUTCDay())) w++;
      }
      // longest run of consecutive PRIMARY days that touches October, followed across the month edges
      if (isP) { if (!run) runStart = d; run++; if (d >= "2026-10-01" && runStart <= "2026-10-31") best = Math.max(best, run); }
      else run = 0;
    }
    recount[id] = { primary: p, backup: b, total: p + b, weekend: w, maxconsec: best };
  });
  const octExternal = recountRows.filter(r => r.day >= "2026-10-01" && r.day <= "2026-10-31" && r.external_cover && !r.primary_id).length;
  const octHoliday = recountRows.some(r => r.day >= "2026-10-01" && r.day <= "2026-10-31" && /holiday/i.test(String(r.note || "")));
  // openCard is shared by the Totals target setup below and the Setup section.
  const openCard = async (ck) => {
    const card = page.locator(`[data-testid=card-${ck}]`);
    if ((await card.count()) === 0) return null;
    if ((await card.getAttribute("data-open")) !== "1") { await page.click(`[data-testid=card-toggle-${ck}]`); await page.waitForTimeout(200); }
    return card;
  };
  // vis-003: give Acton a monthly target through the Rules card (the save path
  // Setup drives) so the target mark, the signed deviation and the Target /
  // Deviation columns are exercised; cleared again in the finally below.
  const ACTON_TARGET = 10;
  const setActonTarget = async (value) => {
    await page.click('button[data-tab="setup"]');
    await openCard("setup_rules");
    await page.click("[data-testid=rules-pick-s3]");
    await page.waitForSelector("[data-testid=rules-monthly-target]", { timeout: 5000 });
    await page.fill("[data-testid=rules-monthly-target]", value === null ? "" : String(value));
    // Save is disabled when the draft already equals the saved rules - then there is nothing to write.
    if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) { await page.click("[data-testid=rules-save]"); await page.waitForTimeout(1200); }
  };
  const gotoTotalsOct = async () => {
    await page.click('button[data-tab="totals"]');
    await page.waitForSelector("[data-testid=totals-card]", { timeout: 8000 });
    if (!(await page.$("[data-testid=totals-table]"))) await page.click("[data-testid=totals-mode-month]");
    await page.selectOption("[data-testid=totals-year]", "2026");
    await page.selectOption("[data-testid=totals-month]", "9");
    await page.waitForFunction(() => /Oct 2026/.test((document.querySelector("[data-testid=totals-period]") || {}).textContent || ""), null, { timeout: 5000 });
    await page.waitForTimeout(300);
  };
  // Every row: the data-* attributes AND the text the surgeon sees (vis-001).
  const readTotRows = () => page.$$eval("[data-testid^=totals-row-]", els => els.map(e => {
    const tds = Array.from(e.children).map(td => td.textContent.trim());
    const col = (c) => { const td = e.querySelector(`td[data-col="${c}"]`); return td ? td.textContent.trim() : null; };
    const flag = (c) => { const td = e.querySelector(`td[data-col="${c}"]`); return td ? td.getAttribute("data-flag") : null; };
    return {
      id: e.getAttribute("data-testid").replace("totals-row-", ""), source: e.getAttribute("data-source"),
      primary: Number(e.getAttribute("data-primary")), backup: Number(e.getAttribute("data-backup")), total: Number(e.getAttribute("data-total")), weekend: Number(e.getAttribute("data-weekend")), maxconsec: Number(e.getAttribute("data-maxconsec")), major: Number(e.getAttribute("data-major")), minor: Number(e.getAttribute("data-minor")),
      visible: { primary: tds[1], backup: tds[2], total: tds[3], weekend: tds[4], maxconsec: col("maxconsec"), cap: col("cap"), target: col("target"), deviation: col("deviation") },
      flags: { cap: flag("cap"), maxconsec: flag("maxconsec"), deviation: flag("deviation") },
      text: e.innerText.replace(/\s+/g, " "),
    };
  }));
  const colourProbe = () => page.evaluate(() => {
    const c = (el) => el ? getComputedStyle(el).color : null;
    const plain = document.querySelector("[data-testid=totals-table] tbody td[data-col=target]:not([data-flag])");
    const over = Array.from(document.querySelectorAll("[data-testid=totals-table] tbody td[data-flag=over]")).map(td => ({ row: td.parentElement.getAttribute("data-testid").replace("totals-row-", ""), col: td.getAttribute("data-col"), color: c(td) }));
    return { plain: c(plain), over };
  });
  // Item J (9/22): a numeric monthlyTarget is a PRIMARY target, so the Totals deviation is primary minus target.
  const expDev = (() => { const d = recount.s3 ? recount.s3.primary - ACTON_TARGET : 0; return d > 0 ? "+" + d : String(d); })();
  let targetSet = false;
  try {
    // ---- Totals: October 2026 ----
    await setActonTarget(ACTON_TARGET);
    targetSet = true;
    await gotoTotalsOct();
    const totRows = await readTotRows();
    const published = totRows.filter(r => r.source === "published");
    if (published.length !== 6 || IDS.some(id => !published.find(r => r.id === id))) fail("Totals Oct 2026: expected one published row per surgeon s1..s6, got " + JSON.stringify(published.map(r => r.id)));
    else {
      const mismatches = [];
      published.forEach(r => {
        const x = recount[r.id];
        ["primary", "backup", "total", "weekend", "maxconsec"].forEach(k => { if (r[k] !== x[k]) mismatches.push(`${r.id}.${k}: data-* ${r[k]} vs recount ${x[k]}`); });
        ["primary", "backup", "total", "weekend"].forEach(k => { if (r.visible[k] !== String(x[k])) mismatches.push(`${r.id}.${k}: visible '${r.visible[k]}' vs recount ${x[k]}`); });
        if (!/^\d+/.test(r.visible.maxconsec || "") || Number((r.visible.maxconsec.match(/^\d+/) || [])[0]) !== x.maxconsec) mismatches.push(`${r.id}.maxconsec: visible '${r.visible.maxconsec}' vs recount ${x.maxconsec}`);
      });
      if (mismatches.length) fail("Totals Oct 2026 disagrees with the independent recount (visible cells and/or data-* attributes): " + mismatches.join("; "));
      else ok("Totals Oct 2026: 6 rows; the VISIBLE primary / backup / total / weekend-day / max-consecutive cells and the data-* attributes all equal the independent recount (" + published.map(r => `${r.id} ${r.visible.primary}+${r.visible.backup}=${r.visible.total} w${r.visible.weekend} c${r.visible.maxconsec}`).join(", ") + ")");
      const octTotal = published.reduce((s, r) => s + r.total, 0);
      console.log(`     (October: ${octTotal} tallied shifts across the six; ${octExternal} externally covered primary day(s) excluded; holiday units in October: ${octHoliday ? "yes" : "none"})`);
      const acton = published.find(r => r.id === "s3");
      if (!acton || acton.visible.target !== String(ACTON_TARGET) || acton.visible.deviation !== expDev || acton.flags.deviation !== (expDev.startsWith("+") ? "over" : expDev === "0" ? "ok" : "under")) fail(`Totals target: Acton should show Target ${ACTON_TARGET} / Deviation ${expDev} (flag ${expDev.startsWith("+") ? "over" : "under/ok"}), got target '${acton && acton.visible.target}' deviation '${acton && acton.visible.deviation}' flag ${acton && acton.flags.deviation}`);
      else ok(`Totals target: Acton (monthlyTarget ${ACTON_TARGET} saved through the Rules card) shows Target ${ACTON_TARGET} and Deviation ${expDev} = ${recount.s3.primary} (primary) - ${ACTON_TARGET}`);
      const others = published.filter(r => r.id !== "s3");
      if (others.some(r => r.visible.target !== "-" || r.visible.deviation !== "-")) fail("Totals target: a surgeon without a target shows a target/deviation: " + JSON.stringify(others.map(r => [r.id, r.visible.target, r.visible.deviation])));
    }
    const totalsText = await page.$eval("[data-testid=totals-card]", el => el.innerText);
    if (/\$/.test(totalsText)) fail("Totals: a '$' appears in the card text (no compensation figures anywhere)"); else ok("Totals: no '$' anywhere in the card");
    const capCells = published.map(r => r.visible.cap);
    if (!capCells.some(c => c && c !== "-")) fail("Totals: no surgeon shows a cap (rules context missing?): " + capCells.join(",")); else ok("Totals: cap column filled from the rules (" + capCells.join(", ") + "; '-' = no cap)");
    const eastHdr = await page.$$eval("[data-testid=totals-table] thead th", ths => ths.map(t => t.textContent.trim()));
    if (!eastHdr.includes("East days")) fail("Totals: the East days column is missing (Fierce's 14-day cap counts East days): " + eastHdr.join(" | ")); else ok("Totals columns: " + eastHdr.join(" | "));
    await page.screenshot({ path: path.join(OUT, "totals-oct-2026.png"), fullPage: true });
    ok("screenshot test/ui/out/totals-oct-2026.png");
    // ---- vis-004: the warning colours survive dark mode (computed colours) ----
    const light = await colourProbe();
    if (!light.over.length) fail("Totals: no cell is flagged over (expected at least the over-cap caps and Acton's deviation in October 2026)");
    else if (!light.over.every(o => o.color === "rgb(192, 64, 64)")) fail("Totals light: flagged cells are not red #c04040: " + JSON.stringify(light.over));
    else ok(`Totals light: ${light.over.length} flagged cell(s) red - ` + light.over.map(o => `${o.row} ${o.col}`).join(", "));
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Dark')");
    await gotoTotalsOct();
    const dark = await colourProbe();
    if (!dark.over.length || !dark.over.every(o => o.color === "rgb(240, 96, 96)") || dark.over.some(o => o.color === dark.plain)) fail(`Totals dark: flagged cells lost their warning colour (plain td ${dark.plain}): ` + JSON.stringify(dark.over));
    else ok(`Totals dark: flagged cells keep a warning red ${dark.over[0].color} against the plain cell ${dark.plain} - ` + dark.over.map(o => `${o.row} ${o.col}`).join(", "));
    await page.screenshot({ path: path.join(OUT, "totals-oct-dark.png"), fullPage: true });
    ok("screenshot test/ui/out/totals-oct-dark.png");
    await page.click("[data-testid=totals-mode-fairness]");
    await page.waitForSelector("[data-testid=fairness-view]", { timeout: 4000 });
    const fairDarkDev = await page.$eval("[data-testid=fairness-row-s3] span[data-flag]", el => getComputedStyle(el).color).catch(() => null);
    if (fairDarkDev !== "rgb(240, 96, 96)" && fairDarkDev !== "rgb(90, 175, 232)" && fairDarkDev !== "rgb(64, 192, 96)") fail("Fairness dark: Acton's deviation text has no warning colour: " + fairDarkDev); else ok("Fairness dark: Acton's deviation text keeps its colour (" + fairDarkDev + ")");
    {
      // TH review: the bar fill (gradient start and end) must clear 3:1 against its track in dark mode.
      const bar = await page.$eval("[data-testid=fairness-view] [data-testid=fairness-track]", (track) => { const fill = track.querySelector("[data-testid=fairness-fill]"); const cs = (el, p) => el ? getComputedStyle(el)[p] : ""; return { track: cs(track, "backgroundColor"), fill: cs(fill, "backgroundImage"), fillBg: cs(fill, "backgroundColor") }; }).catch((e) => ({ error: String(e && e.message || e).split("\n")[0] }));
      const hexOf = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || ""); return m ? "#" + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("") : null; };
      if (bar.error) fail("Fairness dark: bar fill / track not measurable: " + bar.error);
      else {
        const stops = (bar.fill.match(/rgb\(\d+, \d+, \d+\)/g) || (bar.fillBg ? [bar.fillBg] : [])).map(hexOf).filter(Boolean);
        const tr = hexOf(bar.track);
        const ratios = stops.map(s => contrastRatio(s, tr));
        if (!stops.length || !tr) fail("Fairness dark: bar fill / track colours unreadable: " + JSON.stringify(bar));
        else if (ratios.some(r => r < 3)) fail(`Fairness dark: the bar fill does not clear 3:1 on its track ${bar.track}: ` + stops.map((s, i) => `${s} ${ratios[i]}:1`).join(", "));
        else ok(`Fairness dark: bar fill ${stops.join(" -> ")} on track ${tr} = ${ratios.map(r => r + ":1").join(" / ")}`);
      }
    }
    await page.screenshot({ path: path.join(OUT, "fairness-dark.png"), fullPage: true });
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Light')");
    await gotoTotalsOct();
    // Phone width: the page must not scroll sideways; the table scrolls inside its wrapper.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const totMobile = await page.evaluate(() => {
      const wrap = document.querySelector("[data-testid=totals-table]").parentElement;
      return { pageScroll: document.documentElement.scrollWidth, wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth, overflowX: getComputedStyle(wrap).overflowX };
    });
    if (totMobile.pageScroll > 392) fail(`Totals mobile 390px: the page scrolls horizontally (scrollWidth ${totMobile.pageScroll})`);
    else if (!(totMobile.wrapScroll > totMobile.wrapClient + 1) || !/auto|scroll/.test(totMobile.overflowX)) fail(`Totals mobile 390px: the table does not scroll inside its card wrapper (${JSON.stringify(totMobile)})`);
    else ok(`Totals mobile 390px: no page scroll (${totMobile.pageScroll}px); the table scrolls inside the card (${totMobile.wrapScroll} > ${totMobile.wrapClient}, overflow-x ${totMobile.overflowX})`);
    await page.screenshot({ path: path.join(OUT, "totals-mobile.png"), fullPage: false });
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.waitForTimeout(200);
    // CSV export: a real download, one row per surgeon, no $
    if (!(await page.$("[data-testid=totals-csv]"))) fail("Totals: CSV export button missing");
    else {
      try {
        const csv = await saveDownload(() => page.click("[data-testid=totals-csv]"));
        const lines = csv.text.split("\r\n").filter(Boolean);
        if (csv.name !== "silvis-totals-month-2026-10-01-2026-10-31.csv") fail("Totals CSV filename: " + csv.name);
        else if (!/^Period,From,To,Source,Surgeon,Code,Primary,Backup,Total,Weekend days/.test(lines[0]) || lines.length !== 7) fail(`Totals CSV shape wrong: ${lines.length} line(s), header "${lines[0]}"`);
        else if (/\$/.test(csv.text)) fail("Totals CSV contains a '$'");
        else {
          const khan = lines.find(l => /,Khan,FAK,/.test(l)) || "";
          const cols = khan.split(",");
          const actonCsv = (lines.find(l => /,Acton,BDA,/.test(l)) || "").split(",");
          if (Number(cols[6]) !== recount.s1.primary || Number(cols[7]) !== recount.s1.backup) fail("Totals CSV: Khan's primary/backup differ from the recount: " + khan);
          else if (actonCsv[15] !== String(ACTON_TARGET) || actonCsv[16] !== expDev) fail(`Totals CSV: Acton's Target / Deviation columns should read ${ACTON_TARGET} / ${expDev}, got '${actonCsv[15]}' / '${actonCsv[16]}'`);
          else ok(`Totals CSV: ${csv.name} - header + 6 rows, Khan ${cols[6]} P / ${cols[7]} B matches the recount, Acton Target ${actonCsv[15]} / Deviation ${actonCsv[16]}, no '$'`);
        }
      } catch (e) { fail("Totals CSV download: " + errLine(e)); }
    }
    // Year to date + rolling 12 render and keep the six rows; fairness view
    await page.click("[data-testid=totals-mode-ytd]");
    await page.waitForFunction(() => /Year to date 2026 \(9\/14 - 10\/31\)/.test((document.querySelector("[data-testid=totals-period]") || {}).textContent || ""), null, { timeout: 4000 }).then(() => ok("Totals: year to date 2026 runs from 9/14 (the first published day) to the end of the picked month")).catch(async () => fail("Totals YTD label wrong: " + (await page.$eval("[data-testid=totals-period]", el => el.textContent)).slice(0, 120)));
    await page.click("[data-testid=totals-mode-rolling]");
    await page.waitForFunction(() => /Rolling 12 months \(Nov 2025 - Oct 2026\)/.test((document.querySelector("[data-testid=totals-period]") || {}).textContent || ""), null, { timeout: 4000 }).then(() => ok("Totals: rolling 12 months ending Oct 2026 = Nov 2025 - Oct 2026")).catch(async () => fail("Totals rolling label wrong: " + (await page.$eval("[data-testid=totals-period]", el => el.textContent)).slice(0, 120)));
    const rollingRows = await page.$$eval("[data-testid^=totals-row-]", els => els.length);
    if (rollingRows !== 6) fail("Totals rolling: expected 6 rows, got " + rollingRows);
    await page.click("[data-testid=totals-mode-fairness]");
    await page.waitForSelector("[data-testid=fairness-view]", { timeout: 4000 });
    const fairRows = await page.$$eval("[data-testid^=fairness-row-]", els => els.map(e => ({ id: e.getAttribute("data-testid").replace("fairness-row-", ""), total: Number(e.getAttribute("data-total")), deviation: e.getAttribute("data-deviation"), mark: !!e.querySelector("[data-testid=fairness-target-mark]"), markColor: e.querySelector("[data-testid=fairness-target-mark]") ? getComputedStyle(e.querySelector("[data-testid=fairness-target-mark]")).backgroundColor : null, text: e.innerText.replace(/\s+/g, " ") })));
    // vis-001: the visible text of every bar starts with the recounted numbers; vis-003: Acton's row
    // carries the signed deviation, the green target mark and a matching data-deviation, the other
    // five read 'no target' with no mark.
    // the bar text is "<Name> <total> total (<P> P + <B> B) - target ... - cap ... - deviation/no target"
    const fairBad = fairRows.filter(r => { const x = recount[r.id]; return !x || r.total !== x.total || !new RegExp(`^\\S+ ${x.total} total \\(${x.primary} P \\+ ${x.backup} B\\)`).test(r.text); });
    const actonFair = fairRows.find(r => r.id === "s3");
    const noTargetRows = fairRows.filter(r => r.id !== "s3");
    if (fairRows.length !== 6 || fairBad.length) fail("Fairness view: bars whose visible text or total disagree with the recount: " + JSON.stringify(fairBad.map(r => [r.id, r.total, r.text.slice(0, 60)])));
    else if (!actonFair || actonFair.deviation !== expDev || !actonFair.text.includes("deviation " + expDev) || !actonFair.mark || actonFair.markColor !== "rgb(26, 128, 64)" || !actonFair.text.includes(" - target " + ACTON_TARGET + " ")) fail(`Fairness view: Acton's row should read 'target ${ACTON_TARGET}', 'deviation ${expDev}', data-deviation ${expDev} and carry a green target mark; got ${JSON.stringify(actonFair)}`);
    else if (!noTargetRows.every(r => r.deviation === "-" && /no target/.test(r.text) && !r.mark)) fail("Fairness view: a surgeon without a target shows a deviation or a target mark: " + JSON.stringify(noTargetRows.map(r => [r.id, r.deviation, r.mark])));
    else ok(`Fairness view: 6 bars whose visible text reads '<Name> <total> total (<P> P + <B> B)' per the recount; Acton (target ${ACTON_TARGET}) shows 'deviation ${expDev}' with the green target mark, the other five read 'no target' with no mark - ` + fairRows.map(r => `${r.id} ${r.total} ${r.deviation}`).join(", "));
    if (/\$/.test(await page.$eval("[data-testid=totals-card]", el => el.innerText))) fail("Fairness view: a '$' appears");
    const fierceFair = fairRows.find(r => r.id === "s5");
    if (fierceFair && /East/.test(fierceFair.text)) ok("Fairness view: Fierce's row shows his East days beside the Silvis total (" + fierceFair.text.slice(0, 90) + ")");
    else console.log("     (Fierce's fairness row shows no East days in October 2026: " + (fierceFair ? fierceFair.text.slice(0, 90) : "row missing") + ")");
    await page.screenshot({ path: path.join(OUT, "fairness.png"), fullPage: true });
    ok("screenshot test/ui/out/fairness.png");
    await page.click("[data-testid=totals-mode-month]");
  } catch (e) { fail("Totals harness exception: " + errLine(e)); }
  finally {
    if (targetSet) {
      try {
        await setActonTarget(null);
        await page.click('button[data-tab="totals"]');
        await page.waitForSelector("[data-testid=totals-card]", { timeout: 8000 });
        const stillTarget = await page.$eval("[data-testid=totals-row-s3] td[data-col=target]", el => el.textContent.trim()).catch(() => null);
        if (stillTarget !== "-") fail("Totals: clearing Acton's harness target did not take (Target cell reads '" + stillTarget + "')"); else ok("Totals: Acton's harness target cleared again through the Rules card (Target '-')");
      } catch (e) { fail("Totals: could not clear Acton's harness target: " + errLine(e)); }
    }
  }

  // ---- My schedule: s1's next call ----
  try {
    await page.click('button[data-tab="myschedule"]');
    await page.waitForSelector("[data-testid=next-call]", { timeout: 8000 });
    await page.waitForFunction(() => { const el = document.querySelector("[data-testid=next-call]"); return el && !/Loading schedule/.test(el.textContent); }, null, { timeout: 8000 });
    const expectedNext = recountRows.filter(r => r.day >= todayIso && (r.primary_id === "s1" || r.backup_id === "s1")).sort((a, b) => a.day < b.day ? -1 : 1)[0] || null;
    const nextDay = await page.$eval("[data-testid=next-call]", el => el.getAttribute("data-next-day"));
    const nextRole = await page.$eval("[data-testid=next-call]", el => el.getAttribute("data-next-role"));
    const nextText = await page.$eval("[data-testid=next-call]", el => el.innerText.replace(/\s+/g, " "));
    // vis-001: the rendered date, not only the data-next-day attribute ("Primary - Thu November 26, 2026")
    const longDate = (d) => { const t = new Date(d + "T12:00:00Z"); return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][t.getUTCDay()]} ${["January","February","March","April","May","June","July","August","September","October","November","December"][t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
    const expRole = expectedNext ? (expectedNext.primary_id === "s1" ? "primary" : "backup") : null;
    if (!expectedNext) console.log("     (no published s1 day on/after today - next-call comparison skipped; card reads: " + nextText.slice(0, 100) + ")");
    else if (nextDay !== expectedNext.day || nextRole !== expRole) fail(`My schedule: next call is ${nextDay} ${nextRole}, the published rows say ${expectedNext.day} ${expRole}`);
    else if (!nextText.includes(`${expRole === "primary" ? "Primary" : "Backup"} - ${longDate(expectedNext.day)}`)) fail(`My schedule: the card does not render '${expRole === "primary" ? "Primary" : "Backup"} - ${longDate(expectedNext.day)}': ` + nextText.slice(0, 140));
    else if (!/Next call - (today|tomorrow|in \d+ days)/i.test(nextText) || !/07:00 to 07:00/.test(nextText)) fail("My schedule: next-call card text wrong: " + nextText); // the label is CSS-uppercased in innerText
    else ok(`My schedule: next call ${nextDay} (${nextRole}) matches the first published s1 day on/after ${todayIso}, rendered as '${longDate(expectedNext.day)}'; card "${nextText.slice(0, 110)}"`);
    const mineDays = await page.$$eval("[data-testid=mine-day]", els => els.map(e => e.getAttribute("data-day")));
    const horizon = utcDay(Date.parse(todayIso + "T12:00:00Z") + 90 * 86400000);
    const expectedCount = recountRows.filter(r => r.day >= todayIso && r.day <= horizon && (r.primary_id === "s1" || r.backup_id === "s1")).length;
    if (mineDays.length !== expectedCount) fail(`My schedule: upcoming list has ${mineDays.length} day(s), the live rows have ${expectedCount} for s1 in the next 90 days (${todayIso}..${horizon})`);
    else ok(`My schedule: upcoming list = ${mineDays.length} day(s) in the next 90 days${mineDays.length ? ", first " + mineDays[0] : ""}`);
    if (mineDays.length && !(await page.$("[data-testid=mine-trade]"))) fail("My schedule: no 'Propose a trade' shortcut on the upcoming rows");
    if (!(await page.$("[data-testid=copy-sync-url]")) || !(await page.$("[data-testid=download-my-calendar]"))) fail("My schedule: the calendar buttons (download / copy sync URL) are missing"); else ok("My schedule: Download my calendar + Copy my calendar-sync URL buttons present");
    if (!(await page.$("[data-testid=mine-person]"))) fail("My schedule: the scheduler's person picker is missing");
    const mineText = await page.$eval("[data-testid=mine-card]", el => el.innerText);
    if (!noAddress(mineText)) fail("My schedule: an email address is rendered");
    await page.screenshot({ path: path.join(OUT, "mine.png"), fullPage: true });
    ok("screenshot test/ui/out/mine.png");
  } catch (e) { fail("My schedule harness exception: " + errLine(e)); }

  // ---- Item D (2026-09-24): Settings (scheduler) shows Khan's combined Silvis + Davenport feed link with Copy at 390 px, light + dark ----
  // The link is calendar-sync?surgeon=FAK&east=1 (the same public feed URL with one flag), in a read-only box beside a
  // Copy button that is a phone tap target (>= 36 px) and reads 'Copied' after writing the URL to the clipboard
  // (navigator.clipboard.writeText mocked to record, delegated to the real one); the office note names Outlook.
  try {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('button[data-tab="settings"]');
    await page.waitForSelector("[data-testid=combined-sync-url]", { timeout: 8000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const probeCombined = () => page.evaluate(() => {
      const inp = document.querySelector("[data-testid=combined-sync-url]");
      const btn = document.querySelector("[data-testid=copy-combined-sync-url]");
      const note = document.querySelector("[data-testid=combined-sync-note]");
      const rb = btn ? btn.getBoundingClientRect() : null, ri = inp ? inp.getBoundingClientRect() : null;
      return { url: inp ? inp.value : null, visible: !!(inp && inp.offsetParent && btn && btn.offsetParent && note && note.offsetParent), btnText: btn ? btn.textContent.trim() : null,
        btnH: rb ? Math.round(rb.height) : 0, btnRight: rb ? Math.round(rb.right) : 0, inpRight: ri ? Math.round(ri.right) : 0, note: note ? note.textContent : "",
        pageW: document.documentElement.scrollWidth, bodyBg: getComputedStyle(document.body).backgroundColor };
    });
    const EXPECT_COMBINED = /^https:\/\/bzhsroegtagqhutbnsrp\.supabase\.co\/functions\/v1\/calendar-sync\?surgeon=FAK&east=1$/;
    const NOTE_TEXT = "for office staff at either site \u2014 paste it into Outlook as an internet calendar; it updates itself";
    const c1 = await probeCombined();
    if (!c1.visible) fail("Settings 390px: the combined feed box / Copy / note is not rendered for the scheduler: " + JSON.stringify(c1));
    else if (!EXPECT_COMBINED.test(c1.url || "")) fail("Settings 390px: the combined feed URL is not calendar-sync?surgeon=FAK&east=1: " + c1.url);
    else if (c1.pageW > 392 || c1.btnRight > 390 || c1.inpRight > 390) fail(`Settings 390px: the combined feed row overflows the phone (page ${c1.pageW}, box right ${c1.inpRight}, button right ${c1.btnRight})`);
    else if (c1.btnH < 36) fail(`Settings 390px: the combined feed Copy button is shorter than 36 px (${c1.btnH})`);
    else if (c1.note.indexOf(NOTE_TEXT) < 0) fail("Settings 390px: the office note is missing or reworded: " + c1.note.slice(0, 160));
    else if (!noAddress(c1.note + c1.url)) fail("Settings 390px: the combined feed card carries an email address");
    else {
      await page.evaluate(() => { window.__cmbClip = []; const real = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async (t) => { window.__cmbClip.push(t); try { await real(t); } catch (e) {} }; });
      await page.click("[data-testid=copy-combined-sync-url]");
      await page.waitForTimeout(250);
      const c2 = await probeCombined();
      const clip = await page.evaluate(() => window.__cmbClip || []);
      if (c2.btnText !== "Copied" || clip.length !== 1 || clip[0] !== c1.url) fail(`Settings 390px: Copy did not write the combined URL (button '${c2.btnText}', clipboard ${JSON.stringify(clip)})`);
      else ok(`Settings 390px (scheduler, light): Khan's combined Silvis + Davenport feed link ${c1.url.replace(/^https:\/\/[^/]+/, "")} in a read-only box, Copy ${c1.btnH}px -> 'Copied' with the URL on the clipboard, the office note present, no overflow (page ${c1.pageW})`);
      // (no toast to clear: copyText toasts only when the clipboard is blocked)
      await page.screenshot({ path: path.join(OUT, "settings-combined-390.png"), fullPage: false });
      // dark: the same card stays rendered and the URL unchanged on the dark body
      await page.setViewportSize({ width: 1180, height: 900 });
      await page.click("button:has-text('Dark')");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const c3 = await probeCombined();
      if (!c3.visible || c3.url !== c1.url || !/rgb\(11, 26, 51\)/.test(c3.bodyBg) || c3.pageW > 392) fail("Settings 390px (dark): the combined feed card is not rendered as in light mode / the body is not dark navy: " + JSON.stringify({ visible: c3.visible, url: c3.url, bodyBg: c3.bodyBg, pageW: c3.pageW }));
      else ok(`Settings 390px (scheduler, dark): the combined feed link + Copy render on the dark body ${c3.bodyBg}, no overflow (page ${c3.pageW})`);
      await page.screenshot({ path: path.join(OUT, "settings-combined-390-dark.png"), fullPage: false });
      await page.setViewportSize({ width: 1180, height: 900 });
      await page.click("button:has-text('Light')");
    }
  } catch (e) { fail("Settings combined feed link (Item D): " + errLine(e)); }
  await page.setViewportSize({ width: 1180, height: 900 });

  // ---- Prompt 14 part 3a: the offer painter (My schedule -> Paint my offers; nav action; both themes) ----
  // 390 px, light: the current month greys every past row ('past', disabled, >= 52 px; screenshot with a reason);
  // the first month ahead with six paintable rows: arm Primary (gradient, white text; screenshot), tap a day, tap
  // again (clears), tap again; a second Primary day; Backup on a third; Range with Either over two more (the hint
  // names the start and offers 'x cancel start'; screenshot) - every free row between the endpoints is painted,
  // blocked / one-role rows are skipped; the Tue/Thu PRIMARY confirmation ("normally not one of your ... call
  // days") is asked once per batch and counted; "1 other offered" on the harness's s2 row; the header counts equal
  // the draft; the period box reads the seed's picture for s1 (rules_only, preferred); flip the toggle to "Only
  // these days"; a FORCED save failure (OF002 from the harness) writes nothing else, names every pending entry
  // verbatim and keeps the draft + the unsaved count; Save for real = exactly ONE rpc/save_offers (the diff's rows,
  // no clears, p_period + p_mode exhaustive in the SAME call - never a second set_offer_mode request) + ONE audit
  // offers.save (count, mode) and nothing else; the rows read back as saved, the period box flips to submitted /
  // exhaustive and folds back to one line (the day list keeps >= 45 % of 844 px), the note clears after 3 s; tap-again
  // on a saved day drafts 'will clear'; Close on a dirty draft confirms (dismissed = stays), Discard restores.
  // Then the scheduler's relay: My schedule -> Fierce -> "Paint offers for Fierce" (header says so) -> "Go by my
  // rules" = ONE mode call (rules_only, p_person s5) + ONE audit, no save_offers, the confirm text carries his rules
  // in words. Dark: the sheet at 1180 and 390 (background navy, armed brush still a gradient with white text).
  try {
    let ofpDismissNext = false;
    const dialogs = [];
    const onOfpDialog = (d) => { dialogs.push(d.message()); if (ofpDismissNext) { ofpDismissNext = false; d.dismiss(); } else d.accept(); };
    page.on("dialog", onOfpDialog);
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const dowOf = (d) => new Date(d + "T12:00:00Z").getUTCDay();
    const mdOfDay = (d) => Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10));
    const tap = async (day) => { await page.click(`[data-testid=ofp-day][data-day="${day}"]`); await page.waitForTimeout(120); };
    const stateOf = async (day) => page.$eval(`[data-testid=ofp-day][data-day="${day}"]`, el => ({ state: el.getAttribute("data-state"), offer: el.getAttribute("data-offer") }));
    const readRows = () => page.$$eval("[data-testid=ofp-day]", els => els.map(e => ({ day: e.getAttribute("data-day"), state: e.getAttribute("data-state"), why: e.getAttribute("data-why"), disabled: e.disabled, h: e.getBoundingClientRect().height })));
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click('button[data-tab="myschedule"]');
      await page.waitForSelector("[data-testid=paint-offers]", { timeout: 8000 });
      if (await page.$("[data-testid=mine-person]")) await page.selectOption("[data-testid=mine-person]", "s1");
      await page.waitForTimeout(200);
      const offersCard = await page.$eval("[data-testid=mine-offers]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
      if (!/My offers \(0 upcoming days\)/i.test(offersCard) || !offersCard.includes(offerPeriod.label) || !/going by my rules/.test(offersCard)) fail("Offer painter: the My offers card does not read '0 upcoming days' + the seed period + 'going by my rules' for s1: " + offersCard.slice(0, 200));
      else ok("Offer painter: My schedule shows 'My offers (0 upcoming days)' and '" + offerPeriod.label + ": going by my rules' for s1 (the seed's rulesOnly)");
      await page.click("[data-testid=paint-offers]");
      await page.waitForSelector("[data-testid=ofp-sheet]", { timeout: 5000 });
      await page.waitForTimeout(300);
      { const tst = await page.$("[data-testid=toast]"); if (tst) await tst.click().catch(() => {}); } // an earlier step's toast sits over the sheet header (the review shots)
      const t = new Date(todayIso + "T12:00:00Z");
      const month0 = await page.$eval("[data-testid=ofp-month]", el => el.textContent.trim());
      if (month0 !== MONTH_NAMES[t.getUTCMonth()] + " " + t.getUTCFullYear()) fail(`Offer painter: opens on '${month0}', expected the current Central month '${MONTH_NAMES[t.getUTCMonth()]} ${t.getUTCFullYear()}'`); else ok(`Offer painter: opens on the current month (${month0})`);
      const prevDisabled = await page.$eval("[data-testid=ofp-prev]", el => el.disabled);
      if (!prevDisabled) fail("Offer painter: < must be disabled on the current month (navigation is from the current month forward)"); else ok("Offer painter: < is disabled on the current month (forward-only navigation)");
      const rows0 = await readRows();
      const pastRows = rows0.filter(r => r.day < todayIso);
      const wrongPast = pastRows.filter(r => r.state !== "blocked" || r.why !== "past" || !r.disabled);
      if (!pastRows.length) console.log("     (offer painter: today is the 1st - no past row to grey this month)");
      else if (wrongPast.length) fail("Offer painter: past rows not greyed as 'past' + disabled: " + JSON.stringify(wrongPast.slice(0, 3)));
      else ok(`Offer painter: all ${pastRows.length} past row(s) of ${month0} are greyed 'past' and disabled`);
      const shortRows = rows0.filter(r => r.h < 52);
      if (shortRows.length) fail(`Offer painter: ${shortRows.length} row(s) under 52 px, e.g. ${JSON.stringify(shortRows[0])}`); else ok(`Offer painter: every day row is >= 52 px tall (${rows0.length} rows)`);
      // the painting surface owns the phone: with the period box collapsed to one line the day list keeps >= 45 % of 844 px
      const listGeom = await page.evaluate(() => { const l = document.querySelector("[data-testid=ofp-list]"); const f = document.querySelector("[data-testid=ofp-footer]"); const p = document.querySelector("[data-testid=ofp-period]"); return { list: l ? l.clientHeight : 0, footer: f ? f.getBoundingClientRect().height : 0, vh: window.innerHeight, expanded: p ? p.getAttribute("data-expanded") : null, line: (document.querySelector("[data-testid=ofp-period-line]") || {}).innerText || "" }; });
      if (listGeom.list < 0.45 * listGeom.vh || listGeom.expanded !== "0") fail(`Offer painter 390x844: the day list is only ${listGeom.list}px of ${listGeom.vh} (footer ${Math.round(listGeom.footer)}px, period box expanded=${listGeom.expanded}) - it must keep >= 45% with the period box collapsed`);
      else ok(`Offer painter 390x844: the day list keeps ${listGeom.list}px of ${listGeom.vh} (${Math.round(100 * listGeom.list / listGeom.vh)}%; footer ${Math.round(listGeom.footer)}px, period box one line: '${listGeom.line.replace(/\s+/g, " ").slice(0, 70)}')`);
      const sheetW = await page.evaluate(() => { const s = document.querySelector("[data-testid=ofp-sheet]"); return { sw: s.scrollWidth, cw: s.clientWidth, bg: getComputedStyle(s).backgroundColor }; });
      if (sheetW.sw > sheetW.cw + 1) fail(`Offer painter 390px: the sheet scrolls horizontally (${sheetW.sw} > ${sheetW.cw})`); else ok(`Offer painter 390px: no horizontal scroll (${sheetW.sw} in ${sheetW.cw}), background ${sheetW.bg}`);
      const greyRow = rows0.find(r => r.state === "blocked" && r.why !== "past") || pastRows[0] || null;
      if (greyRow) await page.locator(`[data-testid=ofp-day][data-day="${greyRow.day}"]`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, "offers-greyed-390.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-greyed-390.png" + (greyRow ? ` (greyed row ${greyRow.day}: '${greyRow.why}')` : ""));
      // the first month ahead with six paintable rows
      let freeDays = [], allRows = [], monthLabel = month0;
      for (let k = 0; k < 4; k++) {
        await page.click("[data-testid=ofp-next]"); await page.waitForTimeout(200);
        monthLabel = await page.$eval("[data-testid=ofp-month]", el => el.textContent.trim());
        allRows = await readRows();
        freeDays = allRows.filter(r => r.state === "free" && !r.why);
        if (freeDays.length >= 6) break;
      }
      if (freeDays.length < 6) throw new Error(`no month within four ahead has six paintable rows for s1 (last ${monthLabel}: ${freeDays.length})`);
      ok(`Offer painter: ${monthLabel} has ${freeDays.length} paintable rows for s1 (${allRows.filter(r => r.state === "blocked").length} greyed, ${allRows.filter(r => r.state === "free" && r.why).length} one-role)`);
      const oneRole = allRows.find(r => r.state === "free" && r.why);
      if (oneRole) ok(`Offer painter: a one-role row says why (${oneRole.day}: '${oneRole.why}')`);
      if (allRows.some(r => r.day === OTHER_OFFER_DAY)) {
        const others = await page.$eval(`[data-testid=ofp-day][data-day="${OTHER_OFFER_DAY}"] [data-testid=ofp-others]`, el => el.textContent.trim()).catch(() => null);
        if (others !== "1 other offered") fail(`Offer painter: ${OTHER_OFFER_DAY} should read '1 other offered' (the harness's s2 row), got ${JSON.stringify(others)}`); else ok(`Offer painter: ${OTHER_OFFER_DAY} reads '1 other offered' (s2's row)`);
      }
      // arm Primary: gradient + white text (the dark sheet exempts gradient buttons)
      await page.click("[data-testid=ofp-brush-primary]");
      const armedProbe = await page.$eval("[data-testid=ofp-brush-primary]", el => ({ armed: el.getAttribute("data-armed"), bg: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).color, h: el.getBoundingClientRect().height }));
      const idleProbe = await page.$eval("[data-testid=ofp-brush-either]", el => ({ armed: el.getAttribute("data-armed"), bg: getComputedStyle(el).backgroundImage }));
      if (armedProbe.armed !== "1" || !/linear-gradient/.test(armedProbe.bg) || armedProbe.color !== "rgb(255, 255, 255)" || armedProbe.h < 44 || idleProbe.armed !== "0" || /linear-gradient/.test(idleProbe.bg)) fail("Offer painter: armed brush is not the gradient with white text (>= 44 px) while the idle one stays flat: " + JSON.stringify({ armedProbe, idleProbe }));
      else ok(`Offer painter: Primary armed = gradient, white text, ${armedProbe.h}px; Either idle = flat`);
      await page.screenshot({ path: path.join(OUT, "offers-armed-390.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-armed-390.png");
      const [d1, d2, d3, d4, d5] = freeDays.map(r => r.day);
      // tap, tap again (clears), tap again (paints)
      await tap(d1); const s1a = await stateOf(d1); await tap(d1); const s1b = await stateOf(d1); await tap(d1); const s1c = await stateOf(d1);
      if (!(s1a.state === "draft" && s1a.offer === "primary" && s1b.state === "free" && s1b.offer === "" && s1c.state === "draft" && s1c.offer === "primary")) fail(`Offer painter: tap / tap again / tap on ${d1} read ${JSON.stringify([s1a, s1b, s1c])}, expected draft primary -> free -> draft primary`);
      else ok(`Offer painter: ${d1} tap = draft primary, tap again with the same brush = cleared, tap = draft again`);
      await tap(d2);
      await page.click("[data-testid=ofp-brush-backup]"); await tap(d3);
      // range with Either over d4..d5
      await page.click("[data-testid=ofp-brush-either]"); await page.click("[data-testid=ofp-range]");
      if ((await page.$eval("[data-testid=ofp-range]", el => el.getAttribute("data-on"))) !== "1") fail("Offer painter: the Range toggle did not arm");
      await tap(d4);
      const hintMid = await page.$eval("[data-testid=ofp-hint]", el => el.innerText.replace(/\s+/g, " "));
      if (!new RegExp("Start .*" + mdOfDay(d4).replace("/", "\\/") + " - tap the end day").test(hintMid) || !(await page.$("[data-testid=ofp-cancel-start]"))) fail("Offer painter: the range hint does not name the start and offer 'x cancel start': " + hintMid);
      else ok(`Offer painter: range hint '${hintMid.slice(0, 70)}' with 'x cancel start'`);
      await tap(d5);
      const expectRange = allRows.filter(r => r.day >= d4 && r.day <= d5 && r.state === "free" && !r.why).map(r => r.day);
      const expected = { [d1]: "primary", [d2]: "primary", [d3]: "backup" }; expectRange.forEach(d => { expected[d] = "either"; });
      const drafts = await page.$$eval("[data-testid=ofp-day][data-state=draft]", els => els.map(e => [e.getAttribute("data-day"), e.getAttribute("data-offer")]));
      const draftMap = Object.fromEntries(drafts);
      if (JSON.stringify(draftMap) !== JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))) fail("Offer painter: the draft after two singles, one backup and the Either range is " + JSON.stringify(draftMap) + ", expected " + JSON.stringify(expected));
      else ok(`Offer painter: draft = ${d1} P, ${d2} P, ${d3} B, range ${d4}..${d5} = ${expectRange.length} Either day(s) (${Object.keys(expected).length} days, 3 brushes)`);
      await page.click("[data-testid=ofp-range]");
      // the weekday-pattern confirmation (s1: never PRIMARY on Tue/Thu; backup is open) - once per batch
      const isTuThu = (d) => dowOf(d) === 2 || dowOf(d) === 4;
      const expectedAsks = (isTuThu(d1) ? 2 : 0) + (isTuThu(d2) ? 1 : 0) + (expectRange.some(isTuThu) ? 1 : 0);
      const asks = dialogs.filter(m => /normally not one of your (primary|primary or backup) call days/.test(m));
      if (asks.length !== expectedAsks) fail(`Offer painter: ${asks.length} weekday-pattern confirmation(s) asked, expected ${expectedAsks} (Tue/Thu among ${d1} x2, ${d2}, range ${expectRange.join(",")}): ` + JSON.stringify(asks.slice(0, 3)));
      else ok(`Offer painter: the Tue/Thu primary confirmation was asked ${asks.length} time(s) (once per batch), e.g. ${asks[0] ? JSON.stringify(asks[0].split("\n")[0]) : "none needed"}`);
      if (asks.length && !/never a call day by your rules/.test(asks[0])) fail("Offer painter: the confirmation does not name the reason ('never a call day by your rules'): " + asks[0]);
      await page.screenshot({ path: path.join(OUT, "offers-range-390.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-range-390.png");
      const nDays = Object.keys(expected).length;
      const counts = await page.$eval("[data-testid=ofp-counts]", el => ({ p: +el.getAttribute("data-month-primary"), b: +el.getAttribute("data-month-backup"), e: +el.getAttribute("data-month-either"), per: +el.getAttribute("data-period-count") }));
      const inPer = Object.keys(expected).filter(d => d >= offerPeriod.start_day && d <= offerPeriod.end_day).length;
      if (counts.p !== 2 || counts.b !== 1 || counts.e !== expectRange.length || counts.per !== inPer) fail("Offer painter: header counts " + JSON.stringify(counts) + ` differ from the draft (2 P, 1 B, ${expectRange.length} either; ${inPer} in the period)`);
      else ok(`Offer painter: header counts 2 primary / 1 backup / ${counts.e} either for ${monthLabel}, ${counts.per} in ${offerPeriod.label}`);
      // the period box: the seed's picture for s1 (open period, collapsed to one line), "Change" expands it, then the toggle
      const per0 = await page.$eval("[data-testid=ofp-period]", el => ({ id: el.getAttribute("data-period-id"), status: el.getAttribute("data-status"), mode: el.getAttribute("data-mode"), open: el.getAttribute("data-open"), expanded: el.getAttribute("data-expanded") }));
      const modeBtnBefore = await page.$("[data-testid=ofp-mode-exhaustive]");
      if (per0.id !== offerPeriod.id || per0.status !== "rules_only" || per0.mode !== "preferred" || per0.open !== "1" || per0.expanded !== "0" || modeBtnBefore) fail("Offer painter: the period box should read the seed's picture for s1 (rules_only, preferred), open, collapsed with no mode buttons rendered: " + JSON.stringify({ ...per0, modeButtons: !!modeBtnBefore })); else ok(`Offer painter: period box = ${offerPeriod.label}, s1 rules_only, mode preferred (default), open, one line (mode buttons hidden until Change)`);
      await page.click("[data-testid=ofp-period-toggle]");
      await page.waitForSelector("[data-testid=ofp-mode-exhaustive]", { timeout: 3000 });
      await page.click("[data-testid=ofp-mode-exhaustive]");
      await page.waitForTimeout(100);
      const modeOn = await page.$eval("[data-testid=ofp-mode-exhaustive]", el => el.getAttribute("data-on"));
      const statusText = await page.$eval("[data-testid=ofp-status]", el => el.innerText.trim());
      if (modeOn !== "1" || statusText !== `${nDays + 1} unsaved`) fail(`Offer painter: after the toggle the status reads '${statusText}' (mode on=${modeOn}), expected '${nDays + 1} unsaved'`); else ok(`Offer painter: Change -> toggle 'Only these days' armed -> '${statusText}' (${nDays} days + the mode)`);
      // forced failure: the batch is refused, nothing else is written, every pending entry is named, the draft stays
      failSaveOffers = true;
      const beforeFail = writes.length;
      await page.click("[data-testid=ofp-save]");
      await page.waitForSelector("[data-testid=ofp-error]", { timeout: 5000 });
      await page.waitForTimeout(500);
      // The app's 800 ms blob autosave (an unchanged re-save of call_schedule_data) may land inside this window and the
      // real-save window below - the same unrelated background write the East-vacations home step tolerates and logs
      // (its deps carry no offerRows / periodRows, so no offers state can trigger it); seen in 1 of 3 runs on 9/23-24.
      const failBlobWrites = writesSince(beforeFail).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path));
      if (failBlobWrites.length) console.log("     (unrelated background write(s) during the forced-failure step: " + failBlobWrites.map(w => w.method + " " + w.path).join(", ") + ")");
      const failWrites = writesSince(beforeFail).filter(w => !/\/rest\/v1\/call_schedule_data\b/.test(w.path));
      const errText = await page.$eval("[data-testid=ofp-error]", el => el.innerText.replace(/\s+/g, " "));
      const draftsAfterFail = await page.$$eval("[data-testid=ofp-day][data-state=draft]", els => els.length);
      const statusAfterFail = await page.$eval("[data-testid=ofp-status]", el => el.innerText.trim());
      const missingNames = Object.keys(expected).filter(d => !errText.includes(mdOfDay(d)));
      if (failWrites.length !== 1 || !/rpc\/save_offers$/.test(failWrites[0].path)) fail("Offer painter: the forced failure should record exactly one save_offers attempt and nothing else: " + JSON.stringify(failWrites.map(w => w.method + " " + w.path)));
      else if (!/Nothing was saved - \d+ entries are still unsaved/.test(errText) || missingNames.length || !/OFFER_ON_VACATION/.test(errText)) fail("Offer painter: the error box must say nothing was saved, name every pending entry and quote the token: " + errText.slice(0, 300) + (missingNames.length ? " (missing " + missingNames.join(", ") + ")" : ""));
      else if (draftsAfterFail !== nDays || statusAfterFail !== `${nDays + 1} unsaved`) fail(`Offer painter: the draft did not survive the failed save (${draftsAfterFail} drafts, '${statusAfterFail}')`);
      else ok(`Offer painter: forced OF002 failure -> one save_offers attempt, NO mode call, NO audit, 'Nothing was saved' names all ${nDays} days + the mode verbatim, draft kept ('${statusAfterFail}')`);
      // the real save: ONE request (rows + period + mode in the same save_offers call) + ONE audit row - no set_offer_mode
      const before = writes.length;
      await page.click("[data-testid=ofp-save]");
      await waitFor(() => writesSince(before, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "offers.save"), 8000);
      await page.waitForTimeout(600);
      const saves = writesSince(before, "/rest/v1/rpc/save_offers");
      const modes = writesSince(before, "/rest/v1/rpc/set_offer_mode");
      const audits = writesSince(before, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "offers.save");
      const saveBlobWrites = writesSince(before).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path));
      if (saveBlobWrites.length) console.log("     (unrelated background write(s) during the Save step: " + saveBlobWrites.map(w => w.method + " " + w.path).join(", ") + ")");
      const otherWrites = writesSince(before).filter(w => !/rpc\/(save_offers|set_offer_mode)$|\/rest\/v1\/(audit_log|call_schedule_data)\b/.test(w.path));
      const saveBody = saves[0] ? bodyOf(saves[0]) : null;
      const wantRows = Object.keys(expected).sort().map(d => ({ day: d, role_pref: expected[d] }));
      if (saves.length !== 1 || !saveBody || saveBody.p_person !== "s1" || JSON.stringify(saveBody.p_rows) !== JSON.stringify(wantRows) || JSON.stringify(saveBody.p_clear) !== "[]" || saveBody.p_period !== offerPeriod.id || saveBody.p_mode !== "exhaustive") fail("Offer painter: expected exactly ONE rpc/save_offers { p_person s1, p_rows = the draft in day order, p_clear [], p_period, p_mode exhaustive }: " + JSON.stringify(saves.map(w => w.body)).slice(0, 600));
      else if (modes.length !== 0) fail("Offer painter: a Save that changes days AND the mode must be ONE request - no separate rpc/set_offer_mode (the 9/23 review's finding 3): " + JSON.stringify(modes.map(w => w.body)));
      else if (audits.length !== 1 || audits[0].detail.count !== nDays || audits[0].detail.mode !== "exhaustive" || audits[0].detail.inserted !== nDays || audits[0].detail.period_id !== offerPeriod.id) fail("Offer painter: expected exactly ONE audit offers.save with count / mode / period: " + JSON.stringify(audits));
      else if (otherWrites.length) fail("Offer painter: unexpected writes beside the batch and the audit: " + JSON.stringify(otherWrites.map(w => w.method + " " + w.path)));
      else ok(`Offer painter: Save = ONE POST rpc/save_offers (${nDays} rows, no clears, p_mode exhaustive on ${offerPeriod.label}) + ONE audit offers.save ("${audits[0].detail.summary}") - no set_offer_mode, nothing else`);
      if (!writesSince(before).every(w => noAddress(w.body))) fail("Offer painter: a write body carries an email address");
      await page.waitForFunction((n) => document.querySelectorAll("[data-testid=ofp-day][data-state=saved]").length === n, nDays, { timeout: 5000 }).catch(() => {});
      const savedRows = await page.$$eval("[data-testid=ofp-day][data-state=saved]", els => els.map(e => [e.getAttribute("data-day"), e.getAttribute("data-offer")]));
      const savedNote = await page.$eval("[data-testid=ofp-saved]", el => el.textContent.trim()).catch(() => null);
      const per1 = await page.$eval("[data-testid=ofp-period]", el => ({ status: el.getAttribute("data-status"), mode: el.getAttribute("data-mode"), expanded: el.getAttribute("data-expanded") }));
      if (JSON.stringify(Object.fromEntries(savedRows)) !== JSON.stringify(Object.fromEntries(Object.entries(expected).sort()))) fail("Offer painter: after the save the rows should read back as saved from the store: " + JSON.stringify(savedRows));
      else if (!savedNote || !new RegExp(`^Saved ${nDays} changes - mode: only these days$`).test(savedNote)) fail(`Offer painter: saved note reads ${JSON.stringify(savedNote)}, expected 'Saved ${nDays} changes - mode: only these days'`);
      // the mode took s1 off the rules-only list; he is 'submitted' only when a painted day lies inside the period; the box folds back to one line
      else if (per1.status !== (inPer ? "submitted" : "not_started") || per1.mode !== "exhaustive" || per1.expanded !== "0") fail(`Offer painter: after the save the period box should read ${inPer ? "submitted" : "not_started"} (${inPer} painted day(s) inside the period) / exhaustive and fold back to one line: ` + JSON.stringify(per1));
      else ok(`Offer painter: ${savedRows.length} rows read back as saved, note '${savedNote}', period box ${per1.status} (off the rules-only list) / exhaustive, folded back to one line`);
      await page.screenshot({ path: path.join(OUT, "offers-saved-390.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-saved-390.png");
      await page.waitForTimeout(3300);
      if (await page.$("[data-testid=ofp-saved]")) fail("Offer painter: the saved note did not clear after 3 s"); else ok("Offer painter: the saved note cleared after 3 s");
      // tap-again on a saved day drafts a clear; Close on a dirty draft confirms (dismissed = the sheet stays); Discard restores
      await page.click("[data-testid=ofp-brush-primary]"); await tap(d1);
      const clearState = await stateOf(d1);
      ofpDismissNext = true; const dlgN = dialogs.length;
      await page.click("[data-testid=ofp-close]"); await page.waitForTimeout(200);
      const stillOpen = !!(await page.$("[data-testid=ofp-sheet]"));
      const closeAsk = dialogs[dlgN] || "";
      await page.click("[data-testid=ofp-discard]"); await page.waitForTimeout(200);
      const afterDiscard = await stateOf(d1);
      if (clearState.state !== "draft" || clearState.offer !== "") fail(`Offer painter: tapping the saved ${d1} with Primary should draft a clear, got ${JSON.stringify(clearState)}`);
      else if (!stillOpen || !/Discard 1 unsaved change and close\?/.test(closeAsk)) fail(`Offer painter: Close on a dirty draft must confirm and stay when dismissed (open=${stillOpen}, dialog '${closeAsk}')`);
      else if (afterDiscard.state !== "saved" || afterDiscard.offer !== "primary") fail("Offer painter: Discard did not restore the saved row: " + JSON.stringify(afterDiscard));
      else ok(`Offer painter: tap-again on saved ${d1} = 'will clear' draft; Close asked '${closeAsk}' and stayed when dismissed; Discard (confirmed) restored the saved row`);
      await page.click("[data-testid=ofp-close]");
      await page.waitForSelector("[data-testid=ofp-sheet]", { state: "detached", timeout: 3000 });
      // the scheduler relays for Fierce: "Go by my rules" = one mode call + one audit
      await page.selectOption("[data-testid=mine-person]", "s5");
      await page.waitForTimeout(200);
      const btnLabel = await page.$eval("[data-testid=paint-offers]", el => el.textContent.trim());
      await page.click("[data-testid=paint-offers]");
      await page.waitForSelector("[data-testid=ofp-sheet][data-person=s5]", { timeout: 5000 });
      const hdr = await page.$eval("[data-testid=ofp-sheet]", el => el.innerText.replace(/\s+/g, " ").slice(0, 160));
      const perF = await page.$eval("[data-testid=ofp-period]", el => el.getAttribute("data-status"));
      if (btnLabel !== "Paint offers for Fierce" || !/Paint offers for Fierce\s*as the scheduler \(relayed\)/.test(hdr) || perF !== "not_started") fail(`Offer painter (scheduler for s5): button '${btnLabel}', header '${hdr.slice(0, 80)}', status ${perF} - expected 'Paint offers for Fierce' / 'as the scheduler (relayed)' / not_started`);
      else ok(`Offer painter (scheduler for s5): '${btnLabel}' opens the sheet 'as the scheduler (relayed)', Fierce not_started`);
      const b2 = writes.length;
      await page.click("[data-testid=ofp-period-toggle]"); // Change expands the box; "Go by my rules" lives inside it
      await page.waitForSelector("[data-testid=ofp-rules-only]", { timeout: 3000 });
      await page.click("[data-testid=ofp-rules-only]");
      await waitFor(() => writesSince(b2, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "offers.save"), 8000);
      await page.waitForTimeout(500);
      const modes2 = writesSince(b2, "/rest/v1/rpc/set_offer_mode").map(bodyOf);
      const saves2 = writesSince(b2, "/rest/v1/rpc/save_offers");
      const audits2 = writesSince(b2, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "offers.save");
      const rulesAsk = dialogs.find(m => /^Go by your rules for /.test(m)) || "";
      const perF2 = await page.$eval("[data-testid=ofp-period]", el => el.getAttribute("data-status"));
      const noteF = await page.$eval("[data-testid=ofp-saved]", el => el.textContent.trim()).catch(() => null);
      if (modes2.length !== 1 || modes2[0].p_mode !== "rules_only" || modes2[0].p_person !== "s5" || modes2[0].p_period !== offerPeriod.id || saves2.length) fail("Offer painter (scheduler for s5): 'Go by my rules' should be exactly ONE set_offer_mode { rules_only, s5 } and no save_offers: " + JSON.stringify({ modes2, saves: saves2.length }));
      else if (audits2.length !== 1 || audits2[0].detail.mode !== "rules_only" || audits2[0].detail.count !== 0 || audits2[0].detail.person_id !== "s5") fail("Offer painter (scheduler for s5): expected one audit offers.save { mode rules_only, count 0, s5 }: " + JSON.stringify(audits2));
      else if (!/Outside your East weeks: primary on Wed/.test(rulesAsk) || perF2 !== "rules_only" || !/going by your rules/.test(noteF || "")) fail(`Offer painter (scheduler for s5): the confirm must speak his rules in words, the box must flip to rules_only, the note must say so (status ${perF2}, note ${JSON.stringify(noteF)}, dialog ${JSON.stringify(rulesAsk.slice(0, 160))})`);
      else ok(`Offer painter (scheduler for s5): 'Go by my rules' = ONE set_offer_mode rules_only + ONE audit; the confirm carried his rules in words; box now rules_only, note '${noteF}'`);
      await page.click("[data-testid=ofp-close]");
      await page.waitForSelector("[data-testid=ofp-sheet]", { state: "detached", timeout: 3000 });
      await page.selectOption("[data-testid=mine-person]", "s1");
      // desktop light (nav action), then dark at 1180 and 390
      await page.setViewportSize({ width: 1180, height: 900 });
      await page.click("[data-testid=nav-paint-offers]");
      await page.waitForSelector("[data-testid=ofp-sheet][data-person=s1]", { timeout: 5000 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "offers-desktop.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-desktop.png (opened from the nav action)");
      await page.click("[data-testid=ofp-close]");
      await page.waitForSelector("[data-testid=ofp-sheet]", { state: "detached", timeout: 3000 });
      await page.click('button[data-tab="settings"]');
      await page.click("button:has-text('Dark')");
      await page.click('button[data-tab="myschedule"]');
      await page.waitForSelector("[data-testid=paint-offers]", { timeout: 5000 });
      await page.click("[data-testid=paint-offers]");
      await page.waitForSelector("[data-testid=ofp-sheet][data-person=s1]", { timeout: 5000 });
      await page.click("[data-testid=ofp-brush-primary]");
      await page.waitForTimeout(200);
      const darkProbe = await page.evaluate(() => { const s = document.querySelector("[data-testid=ofp-sheet]"); const b = document.querySelector("[data-testid=ofp-brush-primary]"); const row = document.querySelector("[data-testid=ofp-day][data-state=saved]") || document.querySelector("[data-testid=ofp-day]"); return { bg: getComputedStyle(s).backgroundColor, brushBg: getComputedStyle(b).backgroundImage, brushColor: getComputedStyle(b).color, rowBg: row ? getComputedStyle(row).backgroundColor : null }; });
      if (darkProbe.bg !== "rgb(11, 26, 51)" || !/linear-gradient/.test(darkProbe.brushBg) || darkProbe.brushColor !== "rgb(255, 255, 255)" || darkProbe.rowBg === "rgb(255, 255, 255)") fail("Offer painter (dark): sheet background / armed brush / row colours off: " + JSON.stringify(darkProbe));
      else ok(`Offer painter (dark): sheet ${darkProbe.bg}, armed brush gradient with white text, row ${darkProbe.rowBg}`);
      await page.screenshot({ path: path.join(OUT, "offers-desktop-dark.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-desktop-dark.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const dark390 = await page.evaluate(() => { const s = document.querySelector("[data-testid=ofp-sheet]"); return { sw: s.scrollWidth, cw: s.clientWidth }; });
      if (dark390.sw > dark390.cw + 1) fail(`Offer painter (dark 390px): horizontal scroll (${dark390.sw} > ${dark390.cw})`); else ok(`Offer painter (dark 390px): no horizontal scroll (${dark390.sw} in ${dark390.cw})`);
      await page.screenshot({ path: path.join(OUT, "offers-390-dark.png"), fullPage: false });
      ok("screenshot test/ui/out/offers-390-dark.png");
      await page.click("[data-testid=ofp-close]");
      await page.waitForSelector("[data-testid=ofp-sheet]", { state: "detached", timeout: 3000 });
      await page.setViewportSize({ width: 1180, height: 900 });
      await page.click('button[data-tab="settings"]');
      await page.click("button:has-text('Light')");
    } finally {
      page.off("dialog", onOfpDialog);
      failSaveOffers = false;
      await page.setViewportSize({ width: 1180, height: 900 });
    }
  } catch (e) { fail("Offer painter: " + errLine(e)); try { await page.screenshot({ path: path.join(OUT, "failure-offers.png"), fullPage: false }); } catch (e2) {} }

  // ---- Prompt 14 part 3c (U3c): the day editor's offer labels + My schedule's offer pills ----
  // Fixture: U3C.day carries s3's offer (his held role) and s4's 'either' inside the seed period (the store above).
  // Every expectation is restated from the harness store AT RUN TIME (s1's standing moved with the painter save
  // above - his painted days may lie inside the period, and s5 chose "go by my rules" - so no line is pinned).
  // Desktop light: the editor on U3C.day lists "Offers (<label>):" with one span per pool surgeon (s3 offered <role>,
  // s4 offered either, the rest rules (chose go by my rules / nothing entered) or not offered + the mode's
  // consequence); an eligible dropdown option carries the tag; on U3C.next s4 is GREYED 'not-offered' (hard) with
  // the glossed reason line and s3 reads not offered - preferred days: penalty (soft). My schedule as s3: the
  // My-offers pill for U3C.day with the role ("(placed)" when he holds it) and the upcoming rows' offered / not
  // offered chips. 390 px: the offers line and the pills fit. Dark: both, at 1180 and 390.
  if (U3C) try {
    const per = offerPeriod;
    const inPer = (o) => o.day >= per.start_day && o.day <= per.end_day;
    const IDS6 = ["s1", "s2", "s3", "s4", "s5", "s6"];
    const NAMES = { s1: "Khan", s2: "Burchett", s3: "Acton", s4: "Philip", s5: "Fierce", s6: "Sarkar" };
    // the app's words, restated: status per offer_status() from the store, mode from the period, roles from the day's rows
    const wordsFor = (id, day, role) => {
      const rows = offerStore.filter(o => o.person_id === id && inPer(o));
      const status = rows.length ? "submitted" : (per.rules_only_ids || []).includes(id) ? "rules_only" : "not_started";
      if (status === "rules_only") return { kind: "rules", words: "rules (chose go by my rules)", tag: "rules" };
      if (status === "not_started") return { kind: "rules", words: "rules (nothing entered)", tag: "rules" };
      const mode = per.offer_modes[id] || "preferred";
      const cons = mode === "exhaustive" ? "only these days: ineligible" : "preferred days: penalty";
      const roles = new Set(); rows.filter(o => o.day === day).forEach(o => { if (o.role_pref === "either") { roles.add("primary"); roles.add("backup"); } else roles.add(o.role_pref); });
      if (!roles.size) return { kind: "not-offered", words: "not offered - " + cons, tag: "not offered" };
      const w = roles.size === 2 ? "either" : [...roles][0];
      if (roles.size === 2 || roles.has(role)) return { kind: "offered", words: "offered " + w, tag: "offered " + w };
      return { kind: "offered-other", words: `offered ${w} only, not ${role} - ${cons}`, tag: `offered ${w} only` };
    };
    const readOffersLine = (role) => page.$eval(`[data-testid=editor-${role}-offers]`, el => ({ text: el.innerText.replace(/\s+/g, " ").trim(), cands: Array.from(el.querySelectorAll("[data-testid=editor-offer-cand]")).map(s => ({ id: s.getAttribute("data-id"), kind: s.getAttribute("data-kind"), text: s.textContent.trim(), color: getComputedStyle(s).color })) })).catch(() => null);
    const readOpts = (role) => page.$$eval(`[data-testid=editor-${role}] option`, els => els.filter(o => o.value).map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
    const openEditor = async (d) => { await showMonth(+d.slice(0, 4), +d.slice(5, 7) - 1); await page.click(`[data-day="${d}"]`); await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 }); await page.waitForTimeout(250); };
    const closeEditor = async () => { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }); };
    const checkLine = async (d, role, label) => {
      const line = await readOffersLine(role);
      if (!line) { fail(`U3c ${label}: no editor-${role}-offers line on ${d} (the day lies inside ${per.label} - offers / periods must be in ctxInputs)`); return null; }
      const exp = IDS6.map(id => ({ id, ...wordsFor(id, d, role) }));
      const bad = exp.filter(e => { const c = line.cands.find(x => x.id === e.id); return !c || c.kind !== e.kind || c.text !== `${NAMES[e.id]} - ${e.words}`; });
      if (!line.text.startsWith(`Offers (${per.label}):`) || line.cands.length !== 6 || bad.length) fail(`U3c ${label}: the ${role} offers line on ${d} must name the period and read, per surgeon, "${exp.map(e => `${NAMES[e.id]} - ${e.words}`).join("; ")}"; got "${line.text}"`);
      else ok(`U3c ${label}: ${role} offers line on ${d} = "${line.text.slice(0, 170)}${line.text.length > 170 ? "..." : ""}"`);
      return line;
    };
    await page.setViewportSize({ width: 1180, height: 900 });
    await openEditor(U3C.day);
    await checkLine(U3C.day, "primary", "offered day");
    await checkLine(U3C.day, "backup", "offered day");
    // the dropdown: every ELIGIBLE pool option carries its tag ("(offered either", "(rules", "(not offered")
    const pOpts = await readOpts("primary");
    const tagged = pOpts.filter(o => o.eligible === "true").map(o => ({ o, tag: wordsFor(o.value, U3C.day, "primary").tag }));
    const untagged = tagged.filter(x => !x.o.text.includes("(" + x.tag));
    if (!tagged.length) console.log(`     (U3c: no eligible primary option on ${U3C.day} - the dropdown tag has nothing to check)`);
    else if (untagged.length) fail(`U3c: eligible primary options must carry their offer tag: ${JSON.stringify(untagged.map(x => x.o.text + " - expected (" + x.tag))}`);
    else ok(`U3c: ${tagged.length} eligible primary option(s) carry the tag, e.g. "${tagged[0].o.text}"`);
    await page.screenshot({ path: path.join(OUT, "day-editor-offers.png"), fullPage: false });
    ok("screenshot test/ui/out/day-editor-offers.png");
    await closeEditor();
    // the day after (the first later in-period day with an unlocked slot): s4 (exhaustive) is greyed with the hard
    // not-offered + the glossed reason - 'not-offered' is the first reason after the slot facts, and the slot is not
    // locked, so it heads his list unless he holds the OTHER role that day; s3 (preferred) = the soft penalty
    if (!U3C.next) console.log(`     (U3c day after: every later day of ${per.label} has both slots locked in the live rows - the greyed not-offered step has no day)`);
    else {
      const nr = U3C.nextRole;
      await openEditor(U3C.next);
      await checkLine(U3C.next, nr, "day after");
      const nOpts = await readOpts(nr);
      const s4o = nOpts.find(o => o.value === "s4"), s3o = nOpts.find(o => o.value === "s3");
      const nReasons = await page.$eval(`[data-testid=editor-${nr}-reasons]`, el => el.textContent).catch(() => "");
      // rules.js pushes not-offered BEFORE the slot facts and returns at the first hard reason, so the option reads
      // 'Philip - not-offered' whether or not he holds the other role that day (review fix: no holds-other-role fork)
      if (!s4o || s4o.eligible !== "false" || !/^Philip - not-offered$/.test(s4o.text)) fail(`U3c day after (${U3C.next} ${nr}): Philip (exhaustive, nothing offered that day) must be greyed 'Philip - not-offered' (not-offered is pushed before the slot facts in rules.js), got ${JSON.stringify(s4o)}`);
      else if (!nReasons.includes("Philip - not among the days offered (only these days)")) fail(`U3c day after: the reason line must gloss not-offered for Philip: ${nReasons}`);
      else ok(`U3c day after (${U3C.next} ${nr}): "${s4o.text}" greyed (hard), reason line 'Philip - not among the days offered (only these days)'`);
      if (s3o && s3o.eligible === "true" && !s3o.text.includes("(not offered")) fail(`U3c day after: Acton (preferred) is eligible and must carry "(not offered", got ${s3o.text}`);
      else if (s3o && s3o.eligible === "true") ok(`U3c day after: "${s3o.text}" - eligible under his rules with the soft penalty`);
      else console.log(`     (U3c day after: Acton reads ${JSON.stringify(s3o)} - a hard rule of his own on ${U3C.next}; the offers line carries his standing)`);
      await page.screenshot({ path: path.join(OUT, "day-editor-not-offered.png"), fullPage: false });
      ok("screenshot test/ui/out/day-editor-not-offered.png");
      await closeEditor();
    }
    // 390 px: the offers line stays inside the dialog
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(U3C.day);
    const g390 = await page.evaluate(() => { const dlg = document.querySelector("[data-testid=day-editor] [role=dialog]"); const l = document.querySelector("[data-testid=editor-primary-offers]"); return { sw: dlg.scrollWidth, cw: dlg.clientWidth, line: !!l, lw: l ? l.scrollWidth : 0, lc: l ? l.clientWidth : 0 }; });
    if (!g390.line || g390.sw > g390.cw + 1 || g390.lw > g390.lc + 1) fail(`U3c 390px: the offers line overflows the day editor (${JSON.stringify(g390)})`); else ok(`U3c 390px: the offers line fits the day editor (${g390.lw} in ${g390.lc}px; dialog ${g390.sw} in ${g390.cw})`);
    await page.locator("[data-testid=editor-primary-offers]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, "day-editor-offers-390.png"), fullPage: false });
    ok("screenshot test/ui/out/day-editor-offers-390.png");
    await closeEditor();
    // My schedule as s3 (the scheduler's picker): the pill for U3C.day with the role, "(placed)" when he holds it; the chips
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('button[data-tab="myschedule"]');
    await page.waitForSelector("[data-testid=mine-person]", { timeout: 5000 });
    await page.selectOption("[data-testid=mine-person]", "s3");
    await page.waitForTimeout(300);
    const rowRole = await page.$eval(`[data-testid=mine-day][data-day="${U3C.day}"]`, el => el.getAttribute("data-role")).catch(() => null);
    const horizon90 = isoAddDays(todayIso, 90);
    const liveHeld = liveByDay[U3C.day] ? (liveByDay[U3C.day].primary_id === "s3" ? "primary" : liveByDay[U3C.day].backup_id === "s3" ? "backup" : null) : null;
    const heldRole = rowRole || (U3C.day > horizon90 ? liveHeld : null); // inside the 90-day list the row is the truth; beyond it the served rows
    const pill = await page.$eval(`[data-testid=mine-offer][data-day="${U3C.day}"]`, el => ({ text: el.textContent.trim(), placed: el.getAttribute("data-placed") })).catch(() => null);
    const roleWordOf = (r) => r === "either" ? "P or B" : r === "primary" ? "P" : "B";
    const expPill = `${mdOf(U3C.day)} ${roleWordOf(U3C.role)}` + (heldRole ? (heldRole === U3C.role ? " (placed)" : ` (placed ${heldRole === "primary" ? "P" : "B"})`) : "");
    if (!pill || pill.text !== expPill || pill.placed !== (heldRole || "")) fail(`U3c My schedule (Acton): the My-offers pill for ${U3C.day} must read "${expPill}" with data-placed "${heldRole || ""}", got ${JSON.stringify(pill)}`);
    else ok(`U3c My schedule (Acton): pill "${pill.text}"${heldRole ? " - he holds " + heldRole + " that day" : " - not placed" + (U3C.heldEarly ? " (the row moved during this run)" : "")}`);
    if (rowRole) {
      const chip = await page.$eval(`[data-testid=mine-day][data-day="${U3C.day}"] [data-testid=mine-offer-tag]`, el => ({ kind: el.getAttribute("data-offer"), text: el.textContent.trim() })).catch(() => null);
      const expKind = rowRole === U3C.role ? "offered" : "outside";
      if (!chip || chip.kind !== expKind || chip.text !== (expKind === "offered" ? "offered" : "not offered")) fail(`U3c My schedule (Acton): the upcoming row ${U3C.day} (${rowRole}) must carry the "${expKind}" chip, got ${JSON.stringify(chip)}`);
      else ok(`U3c My schedule (Acton): upcoming row ${U3C.day} ${rowRole} carries the "${chip.text}" chip`);
    } else console.log(`     (U3c My schedule: ${U3C.day} is not in Acton's 90-day list - the row chip has nothing to check)`);
    // review fix (minor 4): the day he offered in the OTHER role only reads "offered P only" / "offered B only" (kind
    // other-role, amber), never "not offered" - he did offer that day
    const otherDay = U3C.other ? U3C.other.day : null;
    const otherRowRole = otherDay ? await page.$eval(`[data-testid=mine-day][data-day="${otherDay}"]`, el => el.getAttribute("data-role")).catch(() => null) : null;
    if (otherDay && otherRowRole) {
      const oChip = await page.$eval(`[data-testid=mine-day][data-day="${otherDay}"] [data-testid=mine-offer-tag]`, el => ({ kind: el.getAttribute("data-offer"), text: el.textContent.trim(), bg: getComputedStyle(el).backgroundColor })).catch(() => null);
      const offered = U3C.other.offeredRole;
      const expOther = otherRowRole === offered ? { kind: "offered", text: "offered" } : { kind: "other-role", text: `offered ${offered === "primary" ? "P" : "B"} only` }; // the row moved to the offered role during this run -> plain offered
      if (!oChip || oChip.kind !== expOther.kind || oChip.text !== expOther.text) fail(`U3c My schedule (Acton): the upcoming row ${otherDay} (${otherRowRole}; offered ${offered} only) must carry the "${expOther.text}" chip (kind ${expOther.kind}), got ${JSON.stringify(oChip)}`);
      else ok(`U3c My schedule (Acton): upcoming row ${otherDay} ${otherRowRole} (offered ${offered} only) carries the "${oChip.text}" chip (kind ${oChip.kind}${oChip.kind === "other-role" ? ", amber " + oChip.bg : ""})`);
    } else console.log(`     (U3c My schedule: ${otherDay ? otherDay + " is not in Acton's 90-day list" : "Acton holds no second in-period day in the live rows"} - the other-role chip has nothing to check)`);
    // every OTHER upcoming row of his inside the period is a placement outside his offers
    const others = await page.$$eval("[data-testid=mine-day]", (els, args) => els.filter(e => { const d = e.getAttribute("data-day"); return d !== args.day && d !== args.other && d >= args.s && d <= args.e; }).map(e => { const c = e.querySelector("[data-testid=mine-offer-tag]"); return { day: e.getAttribute("data-day"), chip: c ? c.getAttribute("data-offer") : null }; }), { day: U3C.day, other: otherDay || "", s: per.start_day, e: per.end_day });
    if (!others.length) console.log("     (U3c My schedule: no other Acton day inside the period within 90 days - the 'not offered' chip has nothing to check)");
    else if (others.some(o => o.chip !== "outside")) fail(`U3c My schedule (Acton): every other upcoming day inside ${per.label} must carry the "not offered" chip: ${JSON.stringify(others.filter(o => o.chip !== "outside").slice(0, 4))}`);
    else ok(`U3c My schedule (Acton): ${others.length} other upcoming day(s) inside ${per.label} carry the "not offered" chip (e.g. ${others[0].day})`);
    const outsidePer = await page.$$eval("[data-testid=mine-day]", (els, args) => els.filter(e => { const d = e.getAttribute("data-day"); return d < args.s || d > args.e; }).filter(e => e.querySelector("[data-testid=mine-offer-tag]")).map(e => e.getAttribute("data-day")), { s: per.start_day, e: per.end_day });
    if (outsidePer.length) fail(`U3c My schedule (Acton): a day outside every period carries an offer chip: ${outsidePer.slice(0, 3).join(", ")}`); else ok("U3c My schedule (Acton): no chip on a day outside the period");
    await page.screenshot({ path: path.join(OUT, "myschedule-offers.png"), fullPage: false });
    ok("screenshot test/ui/out/myschedule-offers.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const m390 = await page.evaluate(() => { const c = document.querySelector("[data-testid=mine-offers]"); const p = document.querySelector("[data-testid=mine-offer]"); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, csw: c ? c.scrollWidth : 0, ccw: c ? c.clientWidth : 0, pill: p ? p.scrollWidth <= p.clientWidth + 0.5 : null }; });
    if (m390.sw > m390.cw + 1 || m390.csw > m390.ccw + 1 || m390.pill === false) fail(`U3c 390px My schedule: the offers card / a pill overflows (${JSON.stringify(m390)})`); else ok(`U3c 390px My schedule: no horizontal scroll (page ${m390.sw} in ${m390.cw}, card ${m390.csw} in ${m390.ccw}), pills unclipped`);
    await page.locator("[data-testid=mine-offers]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, "myschedule-offers-390.png"), fullPage: false });
    ok("screenshot test/ui/out/myschedule-offers-390.png");
    // dark: My schedule at 390, the editor at 1180 (the offers line takes the dark sub colour, never the light one)
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Dark')");
    await page.click('button[data-tab="myschedule"]');
    await page.waitForSelector("[data-testid=mine-offers]", { timeout: 5000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await page.locator("[data-testid=mine-offers]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, "myschedule-offers-390-dark.png"), fullPage: false });
    ok("screenshot test/ui/out/myschedule-offers-390-dark.png");
    await page.setViewportSize({ width: 1180, height: 900 });
    await openEditor(U3C.day);
    const darkLine = await readOffersLine("primary");
    const rulesCand = darkLine && darkLine.cands.find(c => c.kind === "rules");
    if (!darkLine) fail("U3c dark: no offers line in the day editor");
    else if (rulesCand && rulesCand.color !== "rgb(159, 176, 200)") fail(`U3c dark: a 'rules' span must take the editor's dark sub colour rgb(159, 176, 200), got ${rulesCand.color}`);
    else ok(`U3c dark: the offers line renders in the dark editor${rulesCand ? " (rules span " + rulesCand.color + ")" : ""}`);
    await page.screenshot({ path: path.join(OUT, "day-editor-offers-dark.png"), fullPage: false });
    ok("screenshot test/ui/out/day-editor-offers-dark.png");
    await closeEditor();
    await page.click('button[data-tab="settings"]');
    await page.click("button:has-text('Light')");
    await page.click('button[data-tab="myschedule"]');
    await page.waitForSelector("[data-testid=mine-person]", { timeout: 5000 });
    await page.selectOption("[data-testid=mine-person]", "s1");
  } catch (e) {
    fail("U3c (offer labels): " + errLine(e));
    try { await page.screenshot({ path: path.join(OUT, "failure-u3c.png"), fullPage: false }); } catch (e2) {}
    if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); }
    await page.setViewportSize({ width: 1180, height: 900 });
  } else console.log("     (U3c: the seed carries no offerPeriods[0] - the offer-label steps are skipped)");

  // ---- Time off: refused over a published day (client-side, no write); clean range writes once ----
  try {
    await page.click('button[data-tab="timeoff"]');
    await page.waitForSelector("[data-testid=timeoff-card]", { timeout: 8000 });
    const form = page.locator("[data-testid=timeoff-card]");
    await form.locator("select").first().selectOption("s1");
    const dates = form.locator("input[type=date]");
    // Item SM: the refused range and the expected preselect are DERIVED from the
    // harness's picture of the map (live rows + this run's edits), restating the
    // app's client pre-check (index-source.html vacationConflictItems, which
    // mirrors the DB trigger): the conflict items are the day BEFORE the range
    // when the surgeon is PRIMARY there (his 07:00 handoff falls on the first
    // vacation day), then every day of the range where he holds primary (else
    // backup), in date order; the panel counts them and 'propose a trade'
    // preselects the FIRST item. The range is one day: Khan's Thanksgiving
    // 2026-11-26 while it still collides (his 11/25 one-off lock makes the
    // day-before rule the expected answer), otherwise his first held day on or
    // after today - so the entered range always collides and no day is pinned.
    const s1Holds = (d) => { const c = curDay(d); return c.primary === "s1" || c.backup === "s1"; };
    const vacPreferred = "2026-11-26";
    const vacDay = (vacPreferred >= todayIso && (s1Holds(vacPreferred) || curDay(isoAddDays(vacPreferred, -1)).primary === "s1")) ? vacPreferred : curDays().find(d => d >= todayIso && s1Holds(d));
    // The app's pre-check reads its in-memory map, so the two days that decide the
    // items - the day before the range and the range day - are OBSERVED in the grid
    // now rather than trusted from the live read: this run's own edits may still sit
    // in the map until the app's background poll drops them (review finding on SM).
    const vacObs = {};
    if (vacDay) for (const d of [isoAddDays(vacDay, -1), vacDay]) { const [y, m] = d.split("-"); await showMonth(+y, +m - 1); vacObs[d] = { primary: (await cellAttr(d, "data-primary").catch(() => "")) || null, backup: (await cellAttr(d, "data-backup").catch(() => "")) || null }; }
    const vacItems = [];
    if (vacDay) {
      const dayBefore = isoAddDays(vacDay, -1);
      if (vacObs[dayBefore].primary === "s1") vacItems.push({ day: dayBefore, role: "primary" });
      if (vacObs[vacDay].primary === "s1" || vacObs[vacDay].backup === "s1") vacItems.push({ day: vacDay, role: vacObs[vacDay].primary === "s1" ? "primary" : "backup" });
      const drift = Object.keys(vacObs).filter(d => vacObs[d].primary !== curDay(d).primary || vacObs[d].backup !== curDay(d).backup);
      if (drift.length) console.log(`     (grid differs from the live rows on ${drift.join(", ")} - the expected conflict items follow the grid)`);
      await page.click('button[data-tab="timeoff"]');
      await page.waitForSelector("[data-testid=timeoff-card]", { timeout: 8000 });
      await form.locator("select").first().selectOption("s1");
    }
    const vacFirst = vacItems[0];
    if (!vacDay) fail("Time off refusal: no day on/after today with s1 on call in the live rows - the refusal step is skipped (the clean-range check below still runs)");
    else if (!vacFirst) fail(`Time off refusal: the grid shows no s1 on ${isoAddDays(vacDay, -1)} (primary) nor on ${vacDay} although the live rows do - the range would not collide in the app; the refusal step is skipped`);
    else {
      console.log(`     (refusal range ${vacDay}: s1's conflict items by the restated rule over the grid are ${vacItems.map(i => mdOf(i.day) + " " + i.role).join(", ")} - the first is the expected preselect)`);
      const before = writes.length;
      await dates.nth(0).fill(vacDay);
      await dates.nth(1).fill(vacDay);
      await page.click("[data-testid=vac-add]");
      await page.waitForSelector("[data-testid=vac-conflict]", { timeout: 5000 });
      const conflictText = await page.$eval("[data-testid=vac-conflict]", el => el.innerText.replace(/\s+/g, " "));
      const conflictWrites = writesSince(before).filter(w => /\/rest\/v1\/(time_off|audit_log|notifications)/.test(w.path) || /send-notification/.test(w.path));
      const tradeShortcut = await page.$("[data-testid=vac-conflict-trade]");
      const itemRx = (i) => new RegExp(mdOf(i.day).replace(/\//g, "\\/") + " " + i.role + "\\b");
      const missingItems = vacItems.filter(i => !itemRx(i).test(conflictText));
      if (conflictWrites.length) fail("Time off refusal: a write went out although the client pre-check refused: " + JSON.stringify(conflictWrites.map(w => w.method + " " + w.path)));
      else if (!new RegExp("Khan is published on " + vacItems.length + " day\\(s\\)").test(conflictText) || missingItems.length) fail(`Time off refusal panel wrong: expected 'Khan is published on ${vacItems.length} day(s)' listing ${vacItems.map(i => mdOf(i.day) + " " + i.role).join(", ")}${missingItems.length ? " (missing: " + missingItems.map(i => mdOf(i.day) + " " + i.role).join(", ") + ")" : ""}: ` + conflictText);
      else if (!tradeShortcut) fail("Time off refusal: no 'propose a trade' shortcut beside the conflicting date");
      else ok(`Time off: Khan ${vacDay} refused client-side - panel lists ${vacItems.map(i => "'" + mdOf(i.day) + " " + i.role + "'").join(" + ")} (${vacItems.length} day(s), derived from the grid over the live rows) with a 'propose a trade' shortcut, NO time_off / audit / notification write`);
      // the shortcut lands on the trade form with the FIRST conflict item's day preselected
      // Item C (Faraz 9/23 evening): the shortcut also names the top suggested counter-party and pre-fills Trade with.
      const shortcut = await page.$eval("[data-testid=vac-conflict-trade]", el => ({ text: el.textContent.replace(/\s+/g, " ").trim(), suggested: el.getAttribute("data-suggested") || "" }));
      await page.click("[data-testid=vac-conflict-trade]");
      await page.waitForTimeout(300);
      const preDay = await page.$eval("[data-testid=trade-day]", el => el.value).catch(() => "");
      if (preDay !== vacFirst.day) fail(`Time off refusal: 'propose a trade' did not preselect the first conflict item ${vacFirst.day} (${vacFirst.role}, derived from the grid for the range ${vacDay}) in the trade form (got '${preDay}')`); else ok(`Time off refusal: 'propose a trade' preselects ${vacFirst.day} (${vacFirst.role} - the first conflict item for the range ${vacDay}) in the trade form`);
      const preTo = await page.$eval("[data-testid=trade-to]", el => el.value).catch(() => "");
      if (!shortcut.suggested) console.log(`     (Item C: no suggested counter-party for ${vacFirst.day} ${vacFirst.role} - the shortcut reads '${shortcut.text}'; nobody in the pool is eligible, so nothing to pre-fill)`);
      else if (!/ - suggested: \S+$/.test(shortcut.text) || preTo !== shortcut.suggested) fail(`Item C: the vacation-conflict shortcut '${shortcut.text}' (data-suggested ${shortcut.suggested}) should read 'propose a trade - suggested: <Name>' and pre-fill Trade with (got '${preTo}')`);
      else ok(`Item C: the vacation-conflict shortcut reads '${shortcut.text}' and pre-fills Trade with = ${preTo} for ${vacFirst.day} ${vacFirst.role}`);
      await page.fill("[data-testid=trade-day]", "");
      await page.selectOption("[data-testid=trade-to]", "").catch(() => {});
    }
    // clean range: two days with no schedule rows at all
    const before2 = writes.length;
    await form.locator("select").first().selectOption("s1");
    await dates.nth(0).fill("2027-03-02");
    await dates.nth(1).fill("2027-03-03");
    await page.fill("[data-testid=vac-note]", "harness range");
    await page.click("[data-testid=vac-add]");
    await waitFor(() => writesSince(before2, "/rest/v1/notifications").length > 0, 8000);
    await page.waitForTimeout(700);
    const toPosts = writesSince(before2, "/rest/v1/time_off").filter(w => w.method === "POST");
    const audits = writesSince(before2, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "timeoff.add");
    const notifs = writesSince(before2, "/rest/v1/notifications").map(bodyOf).filter(Boolean);
    const vacNotif = notifs.find(n => n.type === "vacation_logged");
    const toBody = toPosts[0] ? bodyOf(toPosts[0]) : null;
    const stillRefused = await page.$("[data-testid=vac-conflict]");
    if (stillRefused) fail("Time off clean range: the app refused 2027-03-02..03: " + (await page.$eval("[data-testid=vac-conflict]", el => el.innerText.replace(/\s+/g, " "))).slice(0, 160));
    else if (toPosts.length !== 1 || !toBody || toBody.person_id !== "s1" || toBody.start_date !== "2027-03-02" || toBody.end_date !== "2027-03-03" || toBody.note !== "harness range") fail("Time off clean range: expected exactly one time_off POST { s1, 2027-03-02..03, note }: " + JSON.stringify(toPosts.map(w => w.body)));
    else if (audits.length !== 1) fail(`Time off clean range: expected exactly one audit 'timeoff.add', got ${audits.length}`);
    else if (notifs.length !== 1 || !vacNotif) fail(`Time off clean range: expected exactly one notification (vacation_logged), got ${notifs.length}: ` + JSON.stringify(notifs.map(n => n.type)));
    else if (vacNotif.message !== "Khan logged vacation 3/2-3/3 (harness range)") fail("Time off clean range: composed message wrong: " + vacNotif.message);
    else ok("Time off clean range: one POST /rest/v1/time_off { s1, 2027-03-02..03 } + one audit timeoff.add + one notification vacation_logged \"" + vacNotif.message + "\"");
    // ---- Item B (Faraz 9/23 evening): the list is grouped per surgeon in roster order - a vac-group-<id> header
    //      (Badge, full name, N upcoming) with that person's compact "Mon D-D" lines under it; the range just added
    //      reads "Mar 2-3 (2027) harness range" (en dash) with its Edit / Remove controls, under Khan's header. ----
    try {
      await page.waitForSelector("[data-testid=timeoff-card] [data-testid=vac-line-s1-2027-03-02]", { timeout: 15000 });   // 5 s timed out under load (landing run 9/25)
      const readGroups = (sel) => page.$eval(sel, card => {
        const idOf = (el) => el.getAttribute("data-testid").replace(/^vac-group-/, "");
        const groups = Array.from(card.querySelectorAll("[data-testid^=vac-group-]")).map(h => {
          const lines = Array.from(h.parentElement.querySelectorAll("[data-testid^=vac-line-]"));
          return { id: idOf(h), upcoming: +h.getAttribute("data-upcoming"), past: +h.getAttribute("data-past"), text: h.innerText.replace(/\s+/g, " ").trim(), lines: lines.length,
            foreign: lines.filter(l => !l.getAttribute("data-testid").startsWith("vac-line-" + idOf(h) + "-")).length,
            sorted: lines.map(l => l.getAttribute("data-start")).every((d, i, a) => i === 0 || a[i - 1] <= d) };
        });
        const line = card.querySelector("[data-testid=vac-line-s1-2027-03-02]");
        return { groups, orphans: Array.from(card.querySelectorAll("[data-testid^=vac-line-]")).filter(l => !l.parentElement.querySelector("[data-testid^=vac-group-]")).length,
          lineText: line ? line.innerText.replace(/\s+/g, " ").trim() : null, lineInS1: !!(line && line.parentElement.querySelector("[data-testid=vac-group-s1]")),
          lineButtons: line ? Array.from(line.querySelectorAll("button")).map(b => b.textContent.trim()) : [] };
      });
      const g = await readGroups("[data-testid=timeoff-card]");
      const ids = g.groups.map(x => x.id), rosterOrder = ids.slice().sort((a, b) => +a.slice(1) - +b.slice(1));
      const s1 = g.groups.find(x => x.id === "s1");
      const problems = [];
      if (!s1) problems.push("no vac-group-s1 header");
      else { if (!/^Khan \d+ upcoming$/.test(s1.text)) problems.push(`Khan's header reads '${s1.text}'`); if (s1.lines !== s1.upcoming) problems.push(`Khan's header says ${s1.upcoming} upcoming but ${s1.lines} line(s) are listed`); if (/past/.test(s1.text)) problems.push("a past count with Show past off"); }
      if (ids.join() !== rosterOrder.join()) problems.push("groups out of roster order: " + ids.join(","));
      if (g.groups.some(x => x.lines === 0)) problems.push("a header with no lines: " + g.groups.filter(x => x.lines === 0).map(x => x.id).join(","));
      if (g.groups.some(x => x.foreign)) problems.push("a line under another surgeon's header");
      if (g.groups.some(x => !x.sorted)) problems.push("lines not in date order under " + g.groups.filter(x => !x.sorted).map(x => x.id).join(","));
      if (g.orphans) problems.push(g.orphans + " line(s) outside any group");
      if (!g.lineInS1) problems.push("the 2027-03-02 line is not under vac-group-s1");
      if (g.lineText !== "Mar 2\u20133 (2027) harness range Edit Remove") problems.push(`the new line reads '${g.lineText}'`);
      if (g.lineButtons.join() !== "Edit,Remove") problems.push("the new line's controls: " + JSON.stringify(g.lineButtons));
      if (problems.length) fail("Item B grouped vacations (Time off): " + problems.join("; "));
      else ok(`Item B grouped vacations (Time off): ${g.groups.length} group(s) in roster order (${ids.join(", ")}), Khan's header '${s1.text}', the new line reads 'Mar 2\u20133 (2027) harness range' with Edit / Remove under vac-group-s1, every line under its own header, none orphaned`);
      // Show past: every header gains "+M past" exactly when M > 0 and lists upcoming + past lines; off again afterwards.
      await page.click("[data-testid=timeoff-card] [data-testid=vac-show-past]");
      await page.waitForTimeout(400);   // 150 ms flaked under load (9/24 - 9/25)
      const gp = await readGroups("[data-testid=timeoff-card]");
      const bad = gp.groups.filter(x => x.lines !== x.upcoming + x.past || (x.past > 0) !== new RegExp("\\+" + x.past + " past$").test(x.text));
      await page.click("[data-testid=timeoff-card] [data-testid=vac-show-past]");
      await page.waitForTimeout(400);   // 150 ms flaked under load (9/24 - 9/25)
      const gOff = await readGroups("[data-testid=timeoff-card]");
      if (bad.length) fail("Item B Show past (Time off): headers and lines disagree: " + JSON.stringify(bad.map(x => ({ id: x.id, text: x.text, lines: x.lines }))));
      else if (gOff.groups.map(x => x.id + ":" + x.lines).join() !== g.groups.map(x => x.id + ":" + x.lines).join()) fail("Item B Show past (Time off): the list did not return to the upcoming-only picture: " + gOff.groups.map(x => x.id + ":" + x.lines).join(","));
      else ok(`Item B Show past (Time off): ${gp.groups.length} group(s) with ${gp.groups.reduce((n, x) => n + x.past, 0)} past range(s) in all - '+M past' shown exactly where M > 0, lines = upcoming + past, upcoming-only again after unticking`);
    } catch (e) { fail("Item B grouped vacations (Time off) exception: " + errLine(e)); }
    if (!writesSince(before2).every(w => noAddress(w.body))) fail("Time off: a write body carries an email address");
    await page.screenshot({ path: path.join(OUT, "timeoff.png"), fullPage: true });
    ok("screenshot test/ui/out/timeoff.png");
  } catch (e) { fail("Time off harness exception: " + errLine(e)); }

  // ---- Trades (Slice G + fg-1 / fg-2 / datalayer-001) ----
  // (A) a single NON-unit day, proposed for Burchett (s2): an ineligible
  //     counter-party is blocked with the reason and no write; a valid
  //     proposal POSTs one row; Accept = PATCH accepted THEN rpc/apply_trade.
  // (B) Khan's Thanksgiving unit (11/26-11/29, one primary through the unit -
  //     rules doc s5): the picker names the unit; a single day with 'whole
  //     unit' unticked asks the scheduler to confirm the split (dismissed ->
  //     no write); the whole-unit proposal POSTs one row per unit day carrying
  //     the unit stamp and ONE notification; with the session token expired a
  //     realtime change must NOT wipe the pending rows (datalayer-001); Accept
  //     moves the unit as one: 4 x PATCH accepted, then 4 x rpc/apply_trade,
  //     every row applied, one trade_accepted + one trade_applied notification.
  const readToOpts = () => page.$$eval("[data-testid=trade-to] option", os => os.filter(o => o.value).map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
  // A return leg the rules allow that is NOT a unit day of the counter-party's
  // (a split there would need the scheduler's confirm); null = one-way.
  const pickReturnLeg = async () => {
    const theirOpts = await page.$$eval("[data-testid=trade-theirs-pick] option", os => os.map(o => o.value).filter(Boolean));
    for (const v of theirOpts.slice(0, 15)) {
      await page.selectOption("[data-testid=trade-theirs-pick]", v);
      await page.waitForTimeout(120);
      if (!(await page.$("[data-testid=trade-return-reason]")) && !(await page.$("[data-testid=trade-return-unit]"))) return v;
    }
    await page.selectOption("[data-testid=trade-theirs-pick]", "");
    await page.fill("[data-testid=trade-return-day]", "");
    return null;
  };
  const acceptAll = (d) => d.accept();
  try {
    await page.waitForSelector("[data-testid=trade-card]", { timeout: 5000 });
    if (await page.$("[data-testid=trade-rules-unavailable]")) fail("Trades: the 'rules unavailable' warning shows although the setup loaded");
    else ok("Trades: no 'rules unavailable' warning with the setup loaded (fg-2 box only shows without a rules context)");

    // ----- (A) single non-unit day, from Burchett -----
    await page.selectOption("[data-testid=trade-from]", "s2");
    await page.waitForTimeout(150);
    const mineOpts = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => ({ value: o.value, text: o.textContent })).filter(o => o.value));
    if (!mineOpts.length) throw new Error("the 'my day + role' picker lists no upcoming days for s2");
    let picked = null, toOpts = [], fallback = null;
    for (const o of mineOpts.slice(0, 12)) {
      await page.selectOption("[data-testid=trade-mine-pick]", o.value);
      await page.waitForTimeout(150);
      if (await page.$("[data-testid=trade-unit]")) continue; // unit days are (B)'s business
      const opts = await readToOpts();
      if (opts.some(x => x.eligible === "true") && !fallback) fallback = { v: o.value, opts };
      if (opts.some(x => x.eligible === "true") && opts.some(x => x.eligible === "false")) { picked = o.value; toOpts = opts; break; }
    }
    if (!picked && fallback) { picked = fallback.v; toOpts = fallback.opts; await page.selectOption("[data-testid=trade-mine-pick]", picked); await page.waitForTimeout(150); }
    if (!picked) throw new Error("no non-unit upcoming day of Burchett's with an eligible counter-party (options: " + mineOpts.map(o => o.value).join(", ") + ")");
    const [pDay, pRole] = picked.split("|");
    const tradeDayV = await page.$eval("[data-testid=trade-day]", el => el.value), tradeRoleV = await page.$eval("[data-testid=trade-role]", el => el.value);
    if (tradeDayV !== pDay || tradeRoleV !== pRole) fail(`Trades: picking '${picked}' did not fill the day/role inputs (${tradeDayV} ${tradeRoleV})`); else ok(`Trades: picked Burchett's ${pRole} on ${pDay} (not a unit day); counter-parties: ` + toOpts.map(o => `${o.text} [${o.eligible}]`).join(", "));
    if (toOpts.some(o => o.eligible === "unknown")) fail("Trades: a counter-party option reads data-eligible=unknown although the rules are loaded (the check must not report unknown here)");
    const bad = toOpts.find(o => o.eligible === "false"), good = toOpts.find(o => o.eligible === "true");
    if (!bad) console.log("     (no ineligible counter-party for that day - the block test is skipped)");
    else {
      const before = writes.length;
      await page.selectOption("[data-testid=trade-to]", bad.value);
      await page.waitForTimeout(200);
      const reasonBox = await page.$eval("[data-testid=trade-to-reason]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
      await page.click("[data-testid=trade-submit]");
      await page.waitForTimeout(600);
      const txt = await bodyText();
      const blocked = /Blocked: \S+ can't take (Primary|Backup) - /.test(txt);
      const posts = writesSince(before, "/rest/v1/shift_trade_requests");
      if (posts.length) fail("Trades: an ineligible counter-party was POSTed anyway: " + JSON.stringify(posts.map(w => w.body)));
      else if (!blocked) fail("Trades: proposing to the ineligible " + bad.text + " did not toast 'Blocked: ... can't take ... - <reason>'");
      else if (!/can't take/.test(reasonBox)) fail("Trades: the inline reason box under the counter-party select is missing: " + reasonBox);
      else ok(`Trades: proposing to ${bad.text.split(" - ")[0]} is blocked - option greyed with '${bad.text.split(" - ")[1]}', inline reason "${reasonBox.slice(0, 90)}", toast, no write`);
    }
    if (!good) fail("Trades: no eligible counter-party for Burchett's " + pRole + " on " + pDay + " (options: " + toOpts.map(o => o.text).join(", ") + ")");
    else {
      await page.selectOption("[data-testid=trade-to]", good.value);
      await page.waitForTimeout(200);
      const returnLeg = await pickReturnLeg();
      page.on("dialog", acceptAll);
      const before = writes.length;
      await page.click("[data-testid=trade-submit]");
      await waitFor(() => writesSince(before, "/rest/v1/shift_trade_requests").length > 0, 8000);
      await page.waitForTimeout(800);
      page.off("dialog", acceptAll);
      const post = writesSince(before, "/rest/v1/shift_trade_requests").find(w => w.method === "POST");
      const pb = post ? bodyOf(post) : null;
      const propNotif = writesSince(before, "/rest/v1/notifications").map(bodyOf).find(n => n && n.type === "trade_proposed");
      const propMail = writesSince(before).filter(w => /send-notification/.test(w.path)).map(bodyOf).find(b => b && b.type === "trade_proposed");
      const propAudit = auditSince(before, "trade.propose");
      const expectedLeg = returnLeg ? returnLeg.split("|") : [null, null];
      if (!pb || pb.from_surgeon_id !== "s2" || pb.to_surgeon_id !== good.value || pb.day !== pDay || pb.role !== pRole || pb.status !== "pending" || (pb.return_day || null) !== expectedLeg[0] || (pb.return_role || null) !== expectedLeg[1]) fail("Trades: proposal POST body wrong: " + JSON.stringify(pb));
      else if (!/return=representation/.test(post.prefer || "")) fail("Trades: proposal POST lacks Prefer return=representation");
      else if (/\[unit /.test(pb.detail)) fail("Trades: a non-unit proposal carries a unit stamp: " + pb.detail);
      else if (!propNotif || propNotif.message !== pb.detail || !/proposed a trade: .* would take (Primary|Backup) - /.test(propNotif.message)) fail("Trades: trade_proposed notification missing or its message is not the composed detail: " + JSON.stringify(propNotif));
      else if (!propMail || propMail.data.message !== pb.detail || JSON.stringify(propMail.targetIds) !== JSON.stringify(["s2", good.value])) fail("Trades: send-notification trade_proposed payload wrong (data.message must be the composed text, targetIds both parties): " + JSON.stringify(propMail));
      else if (!propAudit) fail("Trades: no audit 'trade.propose'");
      else ok(`Trades: POST /rest/v1/shift_trade_requests { s2 -> ${good.text}, ${pRole} ${pDay}${returnLeg ? ", return " + expectedLeg[1] + " " + expectedLeg[0] : ", one-way (scheduler)"} } + notification trade_proposed + send-notification data.message "${pb.detail.slice(0, 80)}..." + audit trade.propose`);
      let rowId = pb && pb.id ? pb.id : null;
      if (!rowId) { rowId = await page.$eval("[data-testid=trade-row][data-status=pending]", el => el.getAttribute("data-trade-id")).catch(() => null); }
      const pendingRow = page.locator(`[data-testid=trade-row][data-trade-id="${rowId}"]`);
      if (!rowId || (await pendingRow.count()) !== 1 || (await pendingRow.getAttribute("data-status")) !== "pending" || (await pendingRow.getAttribute("data-group")) !== "1") fail("Trades: the proposed trade is not listed as a single pending row (id " + rowId + ")");
      else {
        ok("Trades: proposal listed under Pending trades (id " + rowId.slice(0, 8) + "..., data-group 1)");
        // Accept -> PATCH status=accepted, THEN POST rpc/apply_trade { p_trade_id }
        page.on("dialog", acceptAll);
        const beforeAcc = writes.length;
        await pendingRow.locator("[data-testid=trade-accept]").click();
        await waitFor(() => writesSince(beforeAcc).some(w => /\/rest\/v1\/rpc\/apply_trade/.test(w.path)), 10000);
        await page.waitForTimeout(1200);
        page.off("dialog", acceptAll);
        const seq = writesSince(beforeAcc);
        const patchIdx = seq.findIndex(w => w.method === "PATCH" && w.path === `/rest/v1/shift_trade_requests?id=eq.${rowId}`);
        const rpcIdx = seq.findIndex(w => w.method === "POST" && w.path === "/rest/v1/rpc/apply_trade");
        const patchBody = patchIdx >= 0 ? bodyOf(seq[patchIdx]) : null;
        const rpcBody = rpcIdx >= 0 ? bodyOf(seq[rpcIdx]) : null;
        const accNotif = seq.filter(w => w.path.startsWith("/rest/v1/notifications")).map(bodyOf).filter(Boolean).map(n => n.type);
        const appliedMail = seq.filter(w => /send-notification/.test(w.path)).map(bodyOf).find(b => b && b.type === "trade_applied");
        const statusNow = await pendingRow.getAttribute("data-status").catch(() => null);
        if (patchIdx < 0 || !patchBody || patchBody.status !== "accepted" || !/return=representation/.test(seq[patchIdx].prefer || "")) fail("Trades accept: no PATCH ?id=eq.<id> { status: accepted } with return=representation; writes: " + JSON.stringify(seq.map(w => w.method + " " + w.path)));
        else if (rpcIdx < 0 || !rpcBody || rpcBody.p_trade_id !== rowId) fail("Trades accept: no POST /rest/v1/rpc/apply_trade { p_trade_id }: " + JSON.stringify(seq.map(w => w.method + " " + w.path)));
        else if (rpcIdx < patchIdx) fail(`Trades accept: rpc/apply_trade (#${rpcIdx}) ran BEFORE the status PATCH (#${patchIdx})`);
        else if (statusNow !== "applied") fail("Trades accept: the row should read applied after a successful apply_trade, got " + statusNow);
        else if (!accNotif.includes("trade_accepted") || !accNotif.includes("trade_applied")) fail("Trades accept: notifications trade_accepted + trade_applied expected, got " + accNotif.join(","));
        else if (!appliedMail || !/^Trade applied to the schedule: /.test(appliedMail.data.message)) fail("Trades accept: send-notification trade_applied with the composed data.message missing: " + JSON.stringify(appliedMail));
        else ok(`Trades accept: PATCH shift_trade_requests?id=eq.<id> { status: accepted } (#${patchIdx}) then POST rpc/apply_trade { p_trade_id } (#${rpcIdx}); row reads applied; notifications trade_accepted + trade_applied; email data.message "${appliedMail.data.message.slice(0, 70)}..."`);
        const acceptAudit = auditSince(beforeAcc, "trade.accept");
        if (!acceptAudit) fail("Trades accept: no audit 'trade.accept' (the function writes trade.apply; the client records the acceptance)"); else ok("Trades accept: audit trade.accept written by the client (trade.apply is the function's)");
        if (!seq.every(w => noAddress(w.body))) fail("Trades: a write body carries an email address");
      }
    }

    // ----- (A2) Prompt 19 S2: Give away - the switch hides every return control, the button names the receiver, the
    //      POST carries kind 'give' and no return leg, and the notification / e-mail / audit read as a give -----
    try {
      const RET_IDS = ["trade-theirs-pick", "trade-return-day", "trade-return-role", "trade-return-unit", "trade-return-reason"];
      const retShown = () => page.evaluate((ids) => ids.filter(t => document.querySelector("[data-testid=" + t + "]")), RET_IDS);
      const pressed = () => page.evaluate(() => ["trade-kind-trade", "trade-kind-give"].map(t => { const e = document.querySelector("[data-testid=" + t + "]"); return e ? e.getAttribute("aria-pressed") : null; }).join(","));
      await page.selectOption("[data-testid=trade-from]", "s2");
      await page.waitForTimeout(150);
      if ((await pressed()) !== "true,false") fail("Give away: the card should open in trade mode (aria-pressed trade,give = true,false), got " + (await pressed()));
      const gMine = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => o.value).filter(Boolean));
      let gPicked = null, gTo = null;
      for (const v of gMine.slice(0, 12)) {
        await page.selectOption("[data-testid=trade-mine-pick]", v);
        await page.waitForTimeout(150);
        if (await page.$("[data-testid=trade-unit]")) continue;
        const opts = await readToOpts();
        const e = opts.find(x => x.eligible === "true");
        if (e) { gPicked = v; gTo = e; break; }
      }
      if (!gPicked) throw new Error("no non-unit upcoming day of Burchett's with an eligible receiver: " + gMine.join(", "));
      await page.selectOption("[data-testid=trade-to]", gTo.value);
      await page.waitForTimeout(150);
      const retBefore = await retShown();
      await page.click("[data-testid=trade-kind-give]");
      await page.waitForTimeout(200);
      const retAfter = await retShown();
      const chipsWithReturn = await page.$$eval("[data-testid=trade-suggest-chip]", els => els.filter(e => e.getAttribute("data-return-day")).length);
      const gLabel = (await page.$eval("[data-testid=trade-submit]", el => el.textContent)).trim();
      const gName = gTo.text.split(" - ")[0];
      if (!retBefore.includes("trade-theirs-pick") || !retBefore.includes("trade-return-day") || !retBefore.includes("trade-return-role")) fail("Give away: trade mode should show the return controls, saw " + JSON.stringify(retBefore));
      else if ((await pressed()) !== "false,true") fail("Give away: after the tap aria-pressed should read trade,give = false,true, got " + (await pressed()));
      else if (retAfter.length) fail("Give away: return controls still rendered in give mode: " + JSON.stringify(retAfter));
      else if (gLabel !== "Offer this day to " + gName) fail(`Give away: the button should read 'Offer this day to ${gName}', got '${gLabel}'`);
      else if (chipsWithReturn) fail("Give away: " + chipsWithReturn + " Suggested chip(s) still carry a return day (the give ranks one-way)");
      else ok(`Give away: the switch (aria-pressed false,true) hides every return control (${retBefore.length} shown in trade mode, 0 now), no chip carries a return day, the button reads '${gLabel}'`);
      const [gDay, gRole] = gPicked.split("|");
      const pendingIds = () => page.$$eval("[data-testid=trade-row][data-status=pending]", els => els.map(e => e.getAttribute("data-trade-id")));
      const idsBeforeG = await pendingIds();
      // S2 review: a give asks nothing - no one-way confirm (that is the scheduler's TRADE path). Every dialog is recorded.
      const gDialogs = [];
      const gDialog = (d) => { gDialogs.push(d.message()); d.accept(); };
      page.on("dialog", gDialog);
      const beforeG = writes.length;
      await page.click("[data-testid=trade-submit]");
      await waitFor(() => writesSince(beforeG, "/rest/v1/shift_trade_requests").length > 0, 8000);
      await page.waitForTimeout(800);
      page.off("dialog", gDialog);
      if (gDialogs.length) fail("Give away: the scheduler's give fired " + gDialogs.length + " dialog(s) - a give has no one-way confirm: " + JSON.stringify(gDialogs));
      else ok("Give away: no dialog on the scheduler's give (the one-way confirm is the trade path's)");
      const gPost = writesSince(beforeG, "/rest/v1/shift_trade_requests").filter(w => w.method === "POST").map(bodyOf);
      const gb = gPost[0] || null;
      const gNotif = writesSince(beforeG, "/rest/v1/notifications").map(bodyOf).find(n => n && n.type === "trade_proposed");
      const gMail = writesSince(beforeG).filter(w => /send-notification/.test(w.path)).map(bodyOf).find(b => b && b.type === "trade_proposed");
      const gAudit = auditSince(beforeG, "trade.propose");
      const giveRx = new RegExp("^Burchett offers you \\w{3} \\d{1,2}/\\d{1,2} " + gRole + " - nothing in return \\(a give to " + gName + "\\)$");
      if (gPost.length !== 1 || !gb || gb.kind !== "give" || gb.from_surgeon_id !== "s2" || gb.to_surgeon_id !== gTo.value || gb.day !== gDay || gb.role !== gRole || gb.return_day !== null || gb.return_role !== null || gb.status !== "pending") fail("Give away: expected ONE POST { kind: give, s2 -> " + gTo.value + ", " + gRole + " " + gDay + ", return null } got " + JSON.stringify(gPost));
      else if (!giveRx.test(gb.detail)) fail("Give away: the row's detail should read 'Burchett offers you <Dy M/D> " + gRole + " - nothing in return (a give to " + gName + ")', got " + gb.detail);
      else if (!gNotif || gNotif.message !== gb.detail || gNotif.title !== "Day offered - nothing in return" || !gNotif.data || gNotif.data.kind !== "give") fail("Give away: the trade_proposed notification should carry the give sentence, the give title and data.kind give: " + JSON.stringify(gNotif));
      else if (!gMail || !new RegExp("^Burchett is offering \\w{3} \\d{1,2}/\\d{1,2} " + gRole + " to " + gName + " - nothing in return\\. " + gName + " can accept or decline in the app; the schedule changes only if " + gName + " accepts\\.$").test(gMail.data.message || "") || !new RegExp("^Day offered: \\w{3} \\d{1,2}/\\d{1,2} " + gRole + " \\(Burchett to " + gName + "\\)$").test(gMail.data.subject || "") || /\byou\b/i.test(gMail.data.subject + " " + gMail.data.message) || JSON.stringify(gMail.targetIds) !== JSON.stringify(["s2", gTo.value])) fail("Give away: send-notification trade_proposed should carry the NEUTRAL give e-mail (both parties get it: 'Day offered: <Dy M/D> " + gRole + " (Burchett to " + gName + ")', no 'you') and both parties: " + JSON.stringify(gMail));
      else if (!gAudit || !gAudit.detail || gAudit.detail.kind !== "give") fail("Give away: the trade.propose audit row should carry kind give: " + JSON.stringify(gAudit));
      else ok(`Give away: POST { kind: give, return null } "${gb.detail}" + notification (title 'Day offered - nothing in return', data.kind give) + neutral e-mail '${gMail.data.subject}' to both parties + audit trade.propose kind give`);
      if (!writesSince(beforeG).every(w => noAddress(w.body))) fail("Give away: a write body carries an email address");
      // Prompt 19 S4: the give's e-mail is marked data.kind give (send-notification v7 heads it "Day Offered")
      if (!gMail || !gMail.data || gMail.data.kind !== "give") fail("Give away (S4): the trade_proposed mail should carry data.kind give, got " + JSON.stringify(gMail && gMail.data));
      else ok("Give away (S4): the trade_proposed mail carries data.kind give (headed 'Day Offered' by send-notification v7)");
      // Leave no pending row behind (the mock's trade store is shared with the later sessions - a viewer counts every pending
      // row in the Time off tab badge): the scheduler withdraws the give - one PATCH status cancelled.
      const gIds = (await pendingIds()).filter(id => !idsBeforeG.includes(id));
      if (gIds.length !== 1) fail("Give away: expected ONE new pending row for the give, got " + JSON.stringify(gIds));
      else {
        // Prompt 19 S4: the Trades list names the give - the pending title counts gives, the row's chip reads "give - pending",
        // its meta line "offered by Burchett"
        const s4 = await page.evaluate((id) => { const row = document.querySelector('[data-testid=trade-row][data-trade-id="' + id + '"]'); const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.trim() : null; }; return { title: t('[data-testid=trades-pending-title]'), status: row ? t('[data-testid=trade-status]', row) : null, meta: row ? t('[data-testid=trade-meta]', row) : null }; }, gIds[0]);
        if (!/^Pending (trades \(\d+\) and )?gives \([1-9]\d*\)$/.test(s4.title || "") || s4.status !== "give - pending" || !/^offered by Burchett /.test(s4.meta || "")) fail("Give away (S4): the Trades list should name the give (title 'Pending [trades (n) and ]gives (n)', chip 'give - pending', 'offered by Burchett'), got " + JSON.stringify(s4));
        else ok(`Give away (S4): Trades reads '${s4.title}', the row's chip '${s4.status}', '${s4.meta.split(" ").slice(0, 3).join(" ")}'`);
        page.on("dialog", acceptAll);
        const beforeC = writes.length;
        await page.locator(`[data-testid=trade-row][data-trade-id="${gIds[0]}"] [data-testid=trade-cancel]`).click();
        await waitFor(() => writesSince(beforeC, "/rest/v1/shift_trade_requests").some(w => w.method === "PATCH"), 8000);
        await page.waitForTimeout(500);
        page.off("dialog", acceptAll);
        const cp = writesSince(beforeC, "/rest/v1/shift_trade_requests").find(w => w.method === "PATCH");
        const cst = await page.locator(`[data-testid=trade-row][data-trade-id="${gIds[0]}"]`).getAttribute("data-status").catch(() => null);
        if (!cp || cp.path !== "/rest/v1/shift_trade_requests?id=eq." + gIds[0] || (bodyOf(cp) || {}).status !== "cancelled" || cst !== "cancelled") fail("Give away: withdrawing the give should PATCH ?id=eq.<id> { status: cancelled } and list it cancelled, got " + JSON.stringify(cp && [cp.path, cp.body]) + " / " + cst);
        else ok("Give away: the pending give is withdrawn (PATCH status cancelled, listed cancelled) - no pending row is left for the later sessions");
      }
      await page.click("[data-testid=trade-kind-trade]");
      await page.waitForTimeout(150);
      const back = await retShown();
      if ((await pressed()) !== "true,false" || !back.includes("trade-theirs-pick")) fail("Give away: switching back to Trade should restore the return controls, saw " + JSON.stringify(back));
      else ok("Give away: back to Trade (day for day) - the return controls are rendered again");
    } catch (e) { fail("Give away (A2) exception: " + errLine(e)); }

    // ----- (A2m) S2 review: the MEMBER give (a second session - Burchett s2, role surgeon, 390 px - the path the group
    //      uses; the scheduler's chips are one-way in either mode, so A2 cannot show the switch changing the ranking):
    //      trade-mode chips rank a return day, give-mode chips carry none; the give POSTs ONE row { kind: give, return
    //      null } with no dialog and no 'A return shift is required' toast; Burchett withdraws it (no pending row left) -----
    {
      const MEM_UID = "00000000-0000-4000-8000-00000000e0e2";
      const MEM_PROFILE = { id: MEM_UID, person_id: "s2", role: "surgeon", display_name: "Burchett", email: null, created_at: "2026-09-24T00:00:00Z" };
      const MEM_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: MEM_UID, role: "authenticated", email: "surgeon@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
      const mp = await context.newPage();
      watchPage(mp, "member-give");
      await mp.setViewportSize({ width: 390, height: 844 });
      await mp.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, MEM_JWT);
      await mp.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
      await mp.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(MEM_PROFILE));
      const mDialogs = [];
      mp.on("dialog", (d) => { mDialogs.push(d.message()); d.accept(); });
      try {
        await loadWithRetry(mp, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "member page (give)");
        await mp.waitForSelector("text=Synced", { timeout: 30000 });
        await mp.click('button[data-tab="timeoff"]');
        await mp.waitForSelector("[data-testid=trade-card]", { timeout: 8000 });
        if (await mp.$("[data-testid=trade-from]")) throw new Error("the member page shows the scheduler's From picker - it is being treated as the scheduler, so nothing below proves the member path");
        const chipsOf = () => mp.$$eval("[data-testid=trade-suggest-chip]", els => els.map(e => ({ id: e.getAttribute("data-id"), ret: e.getAttribute("data-return-day"), text: e.textContent.trim() })));
        const mVals = await mp.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => o.value).filter(Boolean));
        let mPick = null, tradeChips = [];
        for (const v of mVals.slice(0, 12)) {
          await mp.selectOption("[data-testid=trade-mine-pick]", v);
          await mp.waitForTimeout(150);
          if (await mp.$("[data-testid=trade-unit]")) continue;
          const cs = await chipsOf();
          if (cs.some(c => c.ret)) { mPick = v; tradeChips = cs; break; }
        }
        if (!mPick) throw new Error("no non-unit upcoming day of Burchett's whose trade-mode chips rank a return day: " + mVals.slice(0, 12).join(", "));
        await mp.click("[data-testid=trade-kind-give]");
        await mp.waitForTimeout(200);
        const giveChips = await chipsOf();
        if (!giveChips.length) fail("Give away (member): give mode shows no Suggested chip for " + mPick + " (trade mode showed " + tradeChips.length + ")");
        else if (giveChips.some(c => c.ret || /give back|no return day/.test(c.text))) fail("Give away (member): give-mode chips still rank a return day: " + JSON.stringify(giveChips));
        else ok(`Give away (member): ${mPick} - trade-mode chips rank a return day (${tradeChips.filter(c => c.ret).length} of ${tradeChips.length}), give-mode chips carry none (${giveChips.map(c => c.text).join(" | ")})`);
        const top = giveChips[0];
        const topName = top ? top.text.split(" - ")[0] : "";
        if (top) { await mp.click(`[data-testid=trade-suggest-chip][data-id="${top.id}"]`); await mp.waitForTimeout(150); }
        const mLabel = (await mp.$eval("[data-testid=trade-submit]", el => el.textContent)).trim();
        if (!top || mLabel !== "Offer this day to " + topName) throw new Error(`the top give chip should fill Give to - the button reads '${mLabel}'`);
        const [mDay, mRole] = mPick.split("|");
        const mPending = () => mp.$$eval("[data-testid=trade-row][data-status=pending]", els => els.map(e => e.getAttribute("data-trade-id")));
        const mIdsBefore = await mPending();
        const dlgBefore = mDialogs.length;
        const beforeM = writes.length;
        await mp.click("[data-testid=trade-submit]");
        await waitFor(() => writesSince(beforeM, "/rest/v1/shift_trade_requests").some(w => w.method === "POST"), 8000);
        await mp.waitForTimeout(800);
        const mToast = await mp.$eval("[data-testid=toast]", el => el.textContent.trim()).catch(() => "");
        const mPost = writesSince(beforeM, "/rest/v1/shift_trade_requests").filter(w => w.method === "POST").map(bodyOf);
        const mb = mPost[0] || null;
        if (mDialogs.length !== dlgBefore) fail("Give away (member): the give fired a dialog: " + JSON.stringify(mDialogs.slice(dlgBefore)));
        else if (/return shift is required/i.test(mToast)) fail("Give away (member): the give hit the member refusal: " + mToast);
        else if (mPost.length !== 1 || !mb || mb.kind !== "give" || mb.from_surgeon_id !== "s2" || mb.to_surgeon_id !== top.id || mb.day !== mDay || mb.role !== mRole || mb.return_day !== null || mb.return_role !== null || mb.status !== "pending") fail("Give away (member): expected ONE POST { kind: give, s2 -> " + top.id + ", " + mRole + " " + mDay + ", return null } got " + JSON.stringify(mPost));
        else if (mToast !== "Offered to " + topName + " - nothing in return.") fail("Give away (member): the toast should read 'Offered to " + topName + " - nothing in return.', got '" + mToast + "'");
        else ok(`Give away (member): one POST { kind: give, s2 -> ${top.id}, ${mRole} ${mDay}, return null }, no dialog, toast '${mToast}'`);
        if (!writesSince(beforeM).every(w => noAddress(w.body))) fail("Give away (member): a write body carries an email address");
        // Burchett withdraws his own give (canCancel = the proposer): one PATCH status cancelled - no pending row left
        const mNew = (await mPending()).filter(id => !mIdsBefore.includes(id));
        if (mNew.length !== 1) fail("Give away (member): expected ONE new pending row for the give, got " + JSON.stringify(mNew));
        else {
          const beforeMC = writes.length;
          await mp.locator(`[data-testid=trade-row][data-trade-id="${mNew[0]}"] [data-testid=trade-cancel]`).click();
          await waitFor(() => writesSince(beforeMC, "/rest/v1/shift_trade_requests").some(w => w.method === "PATCH"), 8000);
          await mp.waitForTimeout(500);
          const mcp = writesSince(beforeMC, "/rest/v1/shift_trade_requests").find(w => w.method === "PATCH");
          if (!mcp || mcp.path !== "/rest/v1/shift_trade_requests?id=eq." + mNew[0] || (bodyOf(mcp) || {}).status !== "cancelled") fail("Give away (member): withdrawing the give should PATCH ?id=eq.<id> { status: cancelled }, got " + JSON.stringify(mcp && [mcp.path, mcp.body]));
          else ok("Give away (member): Burchett withdraws his give (PATCH status cancelled) - no pending row is left for the later sessions");
        }
        // ----- (A3r) Prompt 19 S3: the RECEIVER answers a give (a third session - the colleague Burchett's give chip
        //      named, role surgeon, 390 px). The harness re-serves Burchett's give as a fresh pending row (his own was
        //      withdrawn above) and his trade_proposed feed row, re-pointed at it. Trades: the row reads the give line
        //      ("Burchett offers you <Dy M/D> <role> - nothing in return", em dash) with Accept / Decline and no Cancel.
        //      Alerts: the same line with Accept / Decline. Accept from Alerts: PATCH accepted THEN rpc/apply_trade
        //      { p_trade_id } only; 'Give accepted' + 'Give applied' feed rows naming both parties; ONE send-notification
        //      trade_applied to [Burchett, receiver, the scheduler (s1)] with trade_id and the 'Give applied: Burchett
        //      <arrow> <Name>, ...' subject; the trade.accept audit row carries kind give; no address in any write; no
        //      horizontal scroll with the Alerts panel open. The row is taken out of the store afterwards. -----
        if (mb && top) {
          const EM = String.fromCharCode(0x2014), ARROW = String.fromCharCode(0x2192);
          const giveId = crypto.randomUUID();
          tradeStore.push({ ...mb, id: giveId, status: "pending", submitted_at: new Date().toISOString(), decided_at: null });
          const propFeed = writesSince(beforeM, "/rest/v1/notifications").map(bodyOf).find(n => n && n.type === "trade_proposed") || null;
          const giveFeed = propFeed ? { ...propFeed, id: crypto.randomUUID(), created_at: new Date().toISOString(), data: { ...(propFeed.data || {}), trade_id: giveId, trade_ids: [giveId] } } : null;
          const RCV_UID = "00000000-0000-4000-8000-00000000e0e3";
          const RCV_PROFILE = { id: RCV_UID, person_id: top.id, role: "surgeon", display_name: topName, email: null, created_at: "2026-09-24T00:00:00Z" };
          const RCV_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: RCV_UID, role: "authenticated", email: "receiver@example.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
          const rp = await context.newPage();
          watchPage(rp, "receiver-give");
          await rp.setViewportSize({ width: 390, height: 844 });
          await rp.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, RCV_JWT);
          await rp.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
          await rp.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(RCV_PROFILE, async ({ route, url, req, json }) => {
            // Prompt 19 S5: once the mocked apply_trade has marked the give applied, this session's schedule_days reads carry
            // what the SQL function writes (the slot -> the receiver, source 'trade', version + 1) - scoped to this page, so
            // the scheduler's page and the later sessions keep the unchanged table.
            if (url.pathname === "/rest/v1/schedule_days" && req.method() === "GET" && !daysWiped) {
              const g = tradeStore.find(r => r.id === giveId);
              if (!g || g.status !== "applied") return false;
              const col = g.role === "primary" ? "primary_id" : "backup_id";
              const rows = await scheduleDayRows(route, req, url);
              await json(200, rows.map(r => r.day === g.day ? { ...r, [col]: g.to_surgeon_id, source: "trade", updated_by: g.to_surgeon_id, version: (Number(r.version) || 0) + 1 } : r));
              return true;
            }
            if (!url.pathname.startsWith("/rest/v1/notifications") || req.method() !== "GET") return false;
            await json(200, giveFeed && !url.searchParams.get("type") ? [giveFeed] : []);
            return true;
          }));
          const rDialogs = [];
          rp.on("dialog", (d) => { rDialogs.push(d.message()); d.accept(); });
          try {
            if (!giveFeed) throw new Error("the member's give wrote no trade_proposed feed row to re-serve");
            const [yy, mm, dd] = mDay.split("-").map(Number);
            const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(yy, mm - 1, dd).getDay()];
            const wantLine = `Burchett offers you ${dow} ${mm}/${dd} ${mRole} ${EM} nothing in return`;
            // Prompt 19 S5: the receiver's calendar is read for the given slot BEFORE the accept (Burchett holds it) and after.
            const cellAttr = mRole === "primary" ? "data-primary" : "data-backup";
            const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const rpShowMonth = async () => {
              await rp.click('button[data-tab="calendar"]');
              await rp.selectOption("[data-testid=cal-month-select]", String(mm - 1));
              if ((await rp.$eval("[data-testid=cal-year-input]", el => el.value)) !== String(yy)) await rp.fill("[data-testid=cal-year-input]", String(yy));
              await rp.waitForFunction((want) => { const el = document.querySelector("[data-testid=cal-month]"); return !!el && el.textContent.trim() === want; }, MONTHS[mm - 1] + " " + yy, { timeout: 5000 });
              await rp.waitForTimeout(300);
            };
            const cellHolder = () => rp.$eval(`[data-testid=cal-grid] .cal-cell[data-day="${mDay}"]`, (el, a) => el.getAttribute(a), cellAttr).catch(() => null);
            await loadWithRetry(rp, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "receiver page (give)");
            await rp.waitForSelector("text=Synced", { timeout: 30000 });
            await rpShowMonth();
            const holderBefore = await cellHolder();
            await rp.click('button[data-tab="timeoff"]');
            const rowSel = `[data-testid=trade-row][data-trade-id="${giveId}"]`;
            await rp.waitForSelector(rowSel, { timeout: 10000 });
            const rowInfo = await rp.$eval(rowSel, el => ({ kind: el.getAttribute("data-kind"), line: (el.querySelector("[data-testid=trade-give-line]") || { textContent: "" }).textContent.trim(), accept: !!el.querySelector("[data-testid=trade-accept]"), decline: !!el.querySelector("[data-testid=trade-decline]"), cancel: !!el.querySelector("[data-testid=trade-cancel]") }));
            if (rowInfo.kind !== "give" || rowInfo.line !== wantLine || !rowInfo.accept || !rowInfo.decline || rowInfo.cancel) fail("Give (receiver): the Trades row should read '" + wantLine + "' with Accept / Decline and no Cancel, got " + JSON.stringify(rowInfo));
            else ok(`Give (receiver, Trades): '${rowInfo.line}' - Accept / Decline, no Cancel (data-kind give)`);
            const r4 = await rp.evaluate((id) => { const row = document.querySelector('[data-testid=trade-row][data-trade-id="' + id + '"]'); const t = (sel, root) => { const e = (root || document).querySelector(sel); return e ? e.textContent.trim() : null; }; return { title: t('[data-testid=trades-pending-title]'), status: row ? t('[data-testid=trade-status]', row) : null, meta: row ? t('[data-testid=trade-meta]', row) : null }; }, giveId);
            if (!/^Pending (trades \(\d+\) and )?gives \([1-9]\d*\)$/.test(r4.title || "") || r4.status !== "give - pending" || !/^offered by Burchett /.test(r4.meta || "")) fail("Give (receiver, S4): the Trades list should name the give (title 'Pending [trades (n) and ]gives (n)', chip 'give - pending', 'offered by Burchett'), got " + JSON.stringify(r4));
            else ok(`Give (receiver, S4): Trades reads '${r4.title}', the row's chip '${r4.status}'`);
            await rp.click('button[aria-label="Notifications"]');
            await rp.waitForSelector("[data-testid=notif-panel]", { timeout: 5000 });
            const nLine = await rp.$eval("[data-testid=notif-give-line]", el => el.textContent.trim()).catch(() => "");
            const nBtns = await rp.$$eval("[data-testid=notif-give-accept], [data-testid=notif-give-decline]", els => els.map(e => e.getAttribute("data-testid")));
            const rScroll = await rp.evaluate(() => document.documentElement.scrollWidth);
            if (nLine !== wantLine || nBtns.join(",") !== "notif-give-accept,notif-give-decline") fail("Give (receiver): the Alerts row should read '" + wantLine + "' with Accept / Decline, got '" + nLine + "' " + JSON.stringify(nBtns));
            else if (rScroll > 392) fail("Give (receiver): the page scrolls horizontally with the Alerts panel open (scrollWidth " + rScroll + ")");
            else ok(`Give (receiver, Alerts): '${nLine}' - Accept / Decline; scrollWidth ${rScroll}`);
            const beforeR = writes.length, dlgR = rDialogs.length;
            await rp.click("[data-testid=notif-give-accept]");
            await waitFor(() => writesSince(beforeR).some(w => /send-notification/.test(w.path) && (bodyOf(w) || {}).type === "trade_applied"), 10000);
            await rp.waitForTimeout(500);
            const seq = writesSince(beforeR);
            const patchI = seq.findIndex(w => w.method === "PATCH" && w.path === "/rest/v1/shift_trade_requests?id=eq." + giveId && (bodyOf(w) || {}).status === "accepted");
            const rpcI = seq.findIndex(w => w.method === "POST" && w.path === "/rest/v1/rpc/apply_trade");
            const rpcB = rpcI >= 0 ? bodyOf(seq[rpcI]) : null;
            const feed = seq.filter(w => w.path.startsWith("/rest/v1/notifications")).map(bodyOf).filter(Boolean);
            const accN = feed.find(n => n.type === "trade_accepted"), appN = feed.find(n => n.type === "trade_applied");
            const mails = seq.filter(w => /send-notification/.test(w.path)).map(bodyOf).filter(b => b && b.type === "trade_applied");
            const wantTargets = ["s2", top.id, "s1"].filter((id, i, a) => a.indexOf(id) === i);
            const audit = auditSince(beforeR, "trade.accept");
            const stored = tradeStore.find(r => r.id === giveId);
            if (rDialogs.length !== dlgR) fail("Give (receiver): accepting fired a dialog: " + JSON.stringify(rDialogs.slice(dlgR)));
            else if (patchI < 0 || rpcI < 0 || rpcI < patchI) fail("Give (receiver): expected PATCH accepted THEN rpc/apply_trade, got " + JSON.stringify(seq.map(w => w.method + " " + w.path)));
            else if (!rpcB || JSON.stringify(Object.keys(rpcB)) !== '["p_trade_id"]' || rpcB.p_trade_id !== giveId) fail("Give (receiver): rpc/apply_trade body should be exactly { p_trade_id }, got " + JSON.stringify(rpcB));
            else if (!accN || accN.title !== "Give accepted" || !appN || appN.title !== "Give applied" || !String(appN.message).startsWith("Give applied: Burchett " + ARROW + " " + topName + ", ") || [accN, appN].some(n => !n.data || n.data.from_surgeon_id !== "s2" || n.data.to_surgeon_id !== top.id || n.data.kind !== "give")) fail("Give (receiver): feed rows wrong: " + JSON.stringify(feed));
            else if (mails.length !== 1 || JSON.stringify(mails[0].targetIds) !== JSON.stringify(wantTargets) || !mails[0].data || mails[0].data.trade_id !== giveId || mails[0].data.subject !== appN.message) fail("Give (receiver): expected ONE trade_applied mail to " + JSON.stringify(wantTargets) + " with trade_id and the applied line as subject, got " + JSON.stringify(mails));
            else if (!audit || !audit.detail || audit.detail.kind !== "give") fail("Give (receiver): the trade.accept audit row should carry kind give, got " + JSON.stringify(audit));
            else if (!stored || stored.status !== "applied") fail("Give (receiver): the row should read applied after apply_trade, got " + JSON.stringify(stored && stored.status));
            else ok(`Give (receiver, accept from Alerts): PATCH accepted -> rpc/apply_trade { p_trade_id }; feed 'Give accepted' + '${appN.message}'; send-notification trade_applied -> ${JSON.stringify(mails[0].targetIds)}; audit trade.accept kind give`);
            if (!seq.every(w => noAddress(w.body))) fail("Give (receiver): a write body carries an email address");
            // Prompt 19 S4: the applied give's mail is marked kind give (send-notification v7 heads it "Give Applied")
            if (mails.length !== 1 || !mails[0].data || mails[0].data.kind !== "give") fail("Give (receiver, S4): the trade_applied mail should carry data.kind give, got " + JSON.stringify(mails.map(m => m.data)));
            else ok("Give (receiver, S4): the trade_applied mail carries data.kind give (headed 'Give Applied' by send-notification v7)");
            // ----- (A3d) Prompt 19 S5: the day MOVES, and the scheduler reads the 'Give applied' row -----
            // (1) the receiver's calendar cell for the slot read Burchett (s2) before the accept and reads the receiver right
            //     after it (runApplyTrade's refetch reads what apply_trade wrote - this session's schedule_days overlay);
            // (2) in BOTH themes at 390 px after a reload: the cell still reads the receiver, his Mine tab lists the day in
            //     that role (when it falls inside Mine's 90-day window), no horizontal page scroll;
            // (3) the scheduler's page (s1, the harness's admin) is served the mocked 'Give applied' insert as its feed and
            //     its Alerts panel lists it - the row the accept wrote for the scheduler (who reads the whole feed).
            await rp.click('button[aria-label="Close notifications"]').catch(() => {});
            await rpShowMonth();
            await rp.waitForFunction(([d, a, want]) => { const el = document.querySelector('[data-testid=cal-grid] .cal-cell[data-day="' + d + '"]'); return !!el && el.getAttribute(a) === want; }, [mDay, cellAttr, top.id], { timeout: 8000 }).catch(() => {});
            const holderAfter = await cellHolder();
            if (holderBefore !== "s2") fail(`Give (receiver, S5): before the accept the ${mDay} ${mRole} cell should read Burchett (s2), got ${holderBefore}`);
            else if (holderAfter !== top.id) fail(`Give (receiver, S5): right after the accept the ${mDay} ${mRole} cell should read ${topName} (${top.id}) - the refetch after apply_trade - got ${holderAfter}`);
            else ok(`Give (receiver, S5): the day moved - the ${mDay} ${mRole} calendar cell read s2 (Burchett) before the accept and reads ${top.id} (${topName}) right after it, no reload`);
            const within90 = (new Date(yy, mm - 1, dd) - new Date(new Date().toDateString())) / 864e5 < 90;
            const themeWas = await rp.evaluate(() => { try { return localStorage.getItem("silvis-dark-mode"); } catch (e) { return null; } });   // the origin's storage is shared with the scheduler's page
            // S5 review: the shared flag is put back in a finally (a throw inside the loop must not leave the scheduler's page
            // in dark mode), and each pass proves its theme took - the stored flag AND the dark body paint (#0B1A33).
            try {
            for (const theme of ["light", "dark"]) {
              await rp.addInitScript((dk) => { try { localStorage.setItem("silvis-dark-mode", dk ? "true" : "false"); } catch (e) {} }, theme === "dark");
              await loadWithRetry(rp, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "receiver page (give, " + theme + ")");
              await rp.waitForSelector("text=Synced", { timeout: 30000 });
              const themeT = await rp.evaluate(() => { let f = "?"; try { f = localStorage.getItem("silvis-dark-mode") === "true" ? "dark" : "light"; } catch (e) {} return { flag: f, bg: getComputedStyle(document.body).backgroundColor }; });
              const paintT = themeT.bg === "rgb(11, 26, 51)" ? "dark" : "light";
              await rpShowMonth();
              const cellT = await cellHolder();
              await rp.click('button[data-tab="myschedule"]');
              const mineSel = `[data-testid=mine-day][data-day="${mDay}"][data-role="${mRole}"]`;
              const mineRow = within90 ? await rp.waitForSelector(mineSel, { timeout: 8000 }).then(() => true, () => false) : null;
              const swT = await rp.evaluate(() => document.documentElement.scrollWidth);
              if (themeT.flag !== theme || paintT !== theme) fail(`Give (receiver, S5, ${theme}): the ${theme} theme did not take (silvis-dark-mode reads ${themeT.flag}, body background ${themeT.bg})`);
              else if (cellT !== top.id) fail(`Give (receiver, S5, ${theme}): after a reload the ${mDay} ${mRole} cell should read ${top.id}, got ${cellT}`);
              else if (mineRow === false) fail(`Give (receiver, S5, ${theme}): ${topName}'s Mine tab does not list ${mDay} ${mRole} (${mineSel})`);
              else if (swT > 392) fail(`Give (receiver, S5, ${theme}): the page scrolls horizontally on Mine (scrollWidth ${swT})`);
              else ok(`Give (receiver, S5, ${theme}, 390 px): after a reload the ${mDay} cell reads ${top.id} and ${mineRow ? "Mine lists " + mDay + " " + mRole : "(" + mDay + " is past Mine's 90-day window - the cell is the proof)"}; body ${themeT.bg}; scrollWidth ${swT}`);
            }
            } finally {
              await rp.evaluate((v) => { try { if (v === null) localStorage.removeItem("silvis-dark-mode"); else localStorage.setItem("silvis-dark-mode", v); } catch (e) {} }, themeWas).catch((e) => fail("Give (receiver, S5): could not put the shared silvis-dark-mode flag back: " + errLine(e)));
            }
            if (appN) {
              const schedRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...appN };
              schedFeed = { page, rows: [schedRow] };
              try {
                if (!rtSendRow("notifications", schedRow, "INSERT")) throw new Error("the scheduler page's realtime channel is not joined - the feed refresh cannot be triggered");
                await page.click('button[aria-label="Notifications"]');
                await page.waitForSelector("[data-testid=notif-panel]", { timeout: 5000 });
                const seen = await page.waitForFunction((msg) => Array.from(document.querySelectorAll("[data-testid=notif-row][data-type=trade_applied]")).some(e => e.textContent.includes(msg) && e.textContent.includes("Give applied")), appN.message, { timeout: 8000 }).then(() => true, () => false);
                await page.click('button[aria-label="Close notifications"]').catch(() => {});
                if (!seen) fail("Give (scheduler, S5): the scheduler's Alerts panel does not list the 'Give applied' row: " + JSON.stringify(appN));
                else ok(`Give (scheduler, S5): the accept's notifications insert { type: trade_applied, title: 'Give applied' } is listed in the scheduler's Alerts ('${appN.message}')`);
              } catch (e) { fail("Give (scheduler, S5) exception: " + errLine(e)); }
              schedFeed = null;
              rtSendRow("notifications", { id: schedRow.id }, "DELETE");   // the scheduler's feed reads the (empty) passthrough again
            } else fail("Give (scheduler, S5): no 'Give applied' notifications insert was recorded");
          } catch (e) { fail("Give (receiver, A3r) exception: " + errLine(e)); }
          const gi = tradeStore.findIndex(r => r.id === giveId);
          if (gi >= 0) tradeStore.splice(gi, 1);
          await rp.close();
        }
      } catch (e) { fail("Give away (member, A2m) exception: " + errLine(e)); }
      await mp.close();
    }

    // ----- (B) Khan's Thanksgiving unit (fg-1) -----
    await page.selectOption("[data-testid=trade-from]", "s1");
    await page.waitForTimeout(150);
    const khanOpts = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => ({ value: o.value, text: o.textContent })).filter(o => o.value));
    const nov26 = khanOpts.find(o => o.value === "2026-11-26|primary");
    if (!nov26) throw new Error("Khan's picker has no 2026-11-26 primary (the Thanksgiving unit): " + khanOpts.map(o => o.value).join(", "));
    if (!/Thanksgiving unit/.test(nov26.text)) fail("Trades unit: the picker option for 11/26 does not name the Thanksgiving unit: " + nov26.text); else ok("Trades unit: the day picker names the unit - '" + nov26.text.trim() + "'");
    await page.selectOption("[data-testid=trade-mine-pick]", nov26.value);
    await page.waitForTimeout(200);
    const unitDays = await page.$eval("[data-testid=trade-unit]", el => el.getAttribute("data-unit-days")).catch(() => null);
    if (unitDays !== "2026-11-26,2026-11-27,2026-11-28,2026-11-29") fail("Trades unit: the unit box should list 11/26..11/29, got " + unitDays); else ok("Trades unit: unit box beside the picker lists the 4 unit days 2026-11-26..29 (Khan primary through the unit)");
    const uOpts = await readToOpts();
    const uGood = uOpts.find(o => o.eligible === "true");
    if (!uGood) throw new Error("no counter-party eligible for all four Thanksgiving days: " + uOpts.map(o => o.text + " [" + o.eligible + "]").join(", "));
    ok("Trades unit: counter-parties checked over the WHOLE unit: " + uOpts.map(o => `${o.text} [${o.eligible}]`).join(", "));
    await page.selectOption("[data-testid=trade-to]", uGood.value);
    await page.waitForTimeout(150);
    // Prompt 19 S2: in give mode the whole unit is offered as one - "Offer the <unit> to <Name>"; back to Trade after
    await page.click("[data-testid=trade-kind-give]");
    await page.waitForTimeout(150);
    const uGiveLabel = (await page.$eval("[data-testid=trade-submit]", el => el.textContent)).trim();
    const uGiveBox = await page.$eval("[data-testid=trade-unit]", el => el.getAttribute("data-unit-days")).catch(() => null);
    await page.click("[data-testid=trade-kind-trade]");
    await page.waitForTimeout(150);
    if (uGiveLabel !== "Offer the Thanksgiving unit 11/26-11/29 (4 days) to " + uGood.text.split(" - ")[0]) fail("Give away unit: the button should read 'Offer the Thanksgiving unit 11/26-11/29 (4 days) to " + uGood.text.split(" - ")[0] + "', got '" + uGiveLabel + "'");
    else if (uGiveBox !== "2026-11-26,2026-11-27,2026-11-28,2026-11-29") fail("Give away unit: the unit box should still list the four days in give mode, got " + uGiveBox);
    else ok("Give away unit: '" + uGiveLabel + "' - the unit box stays (a unit is offered whole unless the scheduler splits it)");
    // (B1) 'whole unit' unticked -> the scheduler must confirm the split; dismissed -> no write
    await page.click("[data-testid=trade-whole-unit]");
    await page.waitForTimeout(150);
    const splitNote = await page.$eval("[data-testid=trade-unit-split]", el => el.textContent).catch(() => "");
    const dialogs = [];
    const dismiss = (d) => { dialogs.push(d.message()); d.dismiss(); };
    page.on("dialog", dismiss);
    const beforeSplit = writes.length;
    await page.click("[data-testid=trade-submit]");
    await page.waitForTimeout(700);
    page.off("dialog", dismiss);
    const splitWrites = writesSince(beforeSplit).filter(w => /shift_trade_requests|notifications|send-notification|audit_log/.test(w.path));
    if (splitWrites.length) fail("Trades unit: a single unit day was written although the split confirm was dismissed: " + JSON.stringify(splitWrites.map(w => w.method + " " + w.path)));
    else if (!dialogs.some(m => /splits it/.test(m) && /Thanksgiving unit 11\/26-11\/29 \(4 days\)/.test(m))) fail("Trades unit: no split confirm naming the unit (dialogs: " + JSON.stringify(dialogs) + ")");
    else if (!/split the unit/i.test(splitNote)) fail("Trades unit: the unticked note does not warn about splitting: " + splitNote);
    else ok(`Trades unit: single day 11/26 with 'whole unit' unticked -> scheduler confirm "${dialogs[0].slice(0, 100)}..." dismissed, NO write (a member is refused outright)`);
    // (B2) whole unit: one row per day with the unit stamp, ONE notification
    await page.click("[data-testid=trade-whole-unit]");
    await page.waitForTimeout(150);
    const uReturn = await pickReturnLeg();
    const uLabel = await page.$eval("[data-testid=trade-submit]", el => el.textContent);
    if (!/Propose unit trade \(4 days\)/.test(uLabel)) fail("Trades unit: the submit button should read 'Propose unit trade (4 days)', got '" + uLabel + "'");
    page.on("dialog", acceptAll);
    const beforeUnit = writes.length;
    await page.click("[data-testid=trade-submit]");
    await waitFor(() => writesSince(beforeUnit, "/rest/v1/shift_trade_requests").filter(w => w.method === "POST").length >= 4, 10000);
    await page.waitForTimeout(900);
    page.off("dialog", acceptAll);
    const uPosts = writesSince(beforeUnit, "/rest/v1/shift_trade_requests").filter(w => w.method === "POST").map(bodyOf);
    const uNotifs = writesSince(beforeUnit, "/rest/v1/notifications").map(bodyOf).filter(n => n && n.type === "trade_proposed");
    const uMails = writesSince(beforeUnit).filter(w => /send-notification/.test(w.path)).map(bodyOf).filter(b => b && b.type === "trade_proposed");
    const uDays = uPosts.map(p => p.day).sort();
    const stampRx = /\[unit holiday 2026-11-26 4: Thanksgiving unit 11\/26-11\/29 \(4 days\), day \d of 4\]$/;
    const firstRow = uPosts.find(p => p.day === "2026-11-26");
    if (uPosts.length !== 4 || uDays.join(",") !== "2026-11-26,2026-11-27,2026-11-28,2026-11-29") fail("Trades unit: expected 4 POSTs for 11/26..29, got " + JSON.stringify(uDays));
    else if (!uPosts.every(p => p.from_surgeon_id === "s1" && p.to_surgeon_id === uGood.value && p.role === "primary" && p.status === "pending")) fail("Trades unit: row bodies wrong: " + JSON.stringify(uPosts));
    else if (!uPosts.every(p => stampRx.test(p.detail))) fail("Trades unit: rows lack the unit stamp in detail: " + uPosts.map(p => p.detail).join(" | "));
    else if (uReturn ? (uPosts.filter(p => p.return_day).length !== 1 || firstRow.return_day !== uReturn.split("|")[0]) : uPosts.some(p => p.return_day)) fail("Trades unit: the single return day should ride on the first row only: " + JSON.stringify(uPosts.map(p => [p.day, p.return_day])));
    else if (uNotifs.length !== 1 || !/moved as one/.test(uNotifs[0].message) || !/Primary 11\/26-11\/29/.test(uNotifs[0].message)) fail("Trades unit: expected ONE trade_proposed notification naming the unit range, got " + JSON.stringify(uNotifs.map(n => n.message)));
    else if (uMails.length !== 1 || uMails[0].data.message !== uNotifs[0].message) fail("Trades unit: expected one send-notification with the same composed message: " + JSON.stringify(uMails));
    else ok(`Trades unit: whole-unit proposal -> 4 POSTs (11/26..29, ${uGood.text}, primary, unit stamp in detail${uReturn ? ", return " + uReturn.replace("|", " ") + " on the first row" : ", one-way (scheduler)"}) + ONE notification "${uNotifs[0].message.slice(0, 100)}..."`);
    const unitRows = page.locator('[data-testid=trade-row][data-unit="holiday:2026-11-26"][data-status=pending]');
    const unitRowCount = await unitRows.count();
    const groupAttr = unitRowCount ? await unitRows.first().getAttribute("data-group") : null;
    const acceptLabel = unitRowCount ? await unitRows.first().locator("[data-testid=trade-accept]").textContent() : "";
    const tagText = unitRowCount ? await unitRows.first().locator("[data-testid=trade-unit-tag]").textContent().catch(() => "") : "";
    if (unitRowCount !== 4 || groupAttr !== "4" || !/Accept \(4 days\)/.test(acceptLabel) || !/Thanksgiving unit .* day \d of 4/.test(tagText)) fail(`Trades unit: expected 4 pending rows tagged holiday:2026-11-26 with data-group=4, a unit tag and 'Accept (4 days)', got ${unitRowCount} rows, group ${groupAttr}, tag '${tagText}', button '${acceptLabel}'`);
    else ok(`Trades unit: 4 pending rows carry the unit tag ('${tagText.trim()}'), data-group=4 and 'Accept (4 days)'`);
    const uIds = (await unitRows.evaluateAll(els => els.map(e => e.getAttribute("data-trade-id")))).sort(); // the ids the mock assigned (the POST bodies carry none)
    await page.screenshot({ path: path.join(OUT, "trades.png"), fullPage: true });
    ok("screenshot test/ui/out/trades.png");
    // (B3) datalayer-001: expired token + realtime change -> the pending rows survive, no anon read
    {
      const getsBefore = tradeGets.length;
      const warnsBefore = consoleWarns.length;
      await page.evaluate((t) => localStorage.setItem("silvis-auth-token", t), EXPIRED_JWT);
      rtSendRow("shift_trade_requests", { id: "harness-foreign-row", status: "pending" }, "INSERT");
      await page.waitForTimeout(1500);
      const still = await unitRows.count();
      const foreignGet = tradeGets.slice(getsBefore).find(g => g.auth !== "Bearer " + FAKE_JWT);
      const skipWarn = consoleWarns.slice(warnsBefore).find(t => /shift_trade_requests: read skipped/.test(t));
      await page.evaluate((t) => localStorage.setItem("silvis-auth-token", t), FAKE_JWT);
      await page.waitForTimeout(200);
      if (still !== 4) fail(`datalayer-001: with the token expired a realtime refresh left ${still} of 4 pending rows listed (the list was wiped by an anon 200 + [])`);
      else if (foreignGet) fail("datalayer-001: shift_trade_requests was read with a non-session Authorization while the token was expired: " + JSON.stringify(foreignGet));
      else if (!skipWarn) fail("datalayer-001: no console.warn that the authenticated-only read was skipped");
      else ok("datalayer-001: expired token + realtime change on shift_trade_requests -> the read is SKIPPED (console.warn, no anon GET) and all 4 pending rows stay listed");
    }
    // (B4) Accept the unit: 4 PATCH accepted, then 4 rpc/apply_trade, every row applied, one notification each
    page.on("dialog", acceptAll);
    const beforeUAcc = writes.length;
    await unitRows.first().locator("[data-testid=trade-accept]").click();
    await waitFor(() => writesSince(beforeUAcc).filter(w => w.path === "/rest/v1/rpc/apply_trade").length >= 4, 15000);
    await page.waitForTimeout(1500);
    page.off("dialog", acceptAll);
    const useq = writesSince(beforeUAcc);
    const uPatches = useq.filter(w => w.method === "PATCH" && w.path.startsWith("/rest/v1/shift_trade_requests?id=eq."));
    const uRpcs = useq.filter(w => w.method === "POST" && w.path === "/rest/v1/rpc/apply_trade");
    const patchedIds = uPatches.map(w => w.path.replace("/rest/v1/shift_trade_requests?id=eq.", "")).sort();
    const rpcIds = uRpcs.map(w => (bodyOf(w) || {}).p_trade_id).sort();
    const lastPatchIdx = uPatches.length ? useq.lastIndexOf(uPatches[uPatches.length - 1]) : -1;
    const firstRpcIdx = uRpcs.length ? useq.indexOf(uRpcs[0]) : -1;
    const appliedCount = await page.locator('[data-testid=trade-row][data-unit="holiday:2026-11-26"][data-status=applied]').count();
    const uAccNotifs = useq.filter(w => w.path.startsWith("/rest/v1/notifications")).map(bodyOf).filter(Boolean).map(n => n.type);
    const uAppliedMail = useq.filter(w => /send-notification/.test(w.path)).map(bodyOf).filter(b => b && b.type === "trade_applied");
    if (uPatches.length !== 4 || JSON.stringify(patchedIds) !== JSON.stringify(uIds) || !uPatches.every(w => (bodyOf(w) || {}).status === "accepted")) fail("Trades unit accept: expected 4 PATCH status=accepted (one per row): " + JSON.stringify(useq.map(w => w.method + " " + w.path)));
    else if (uRpcs.length !== 4 || JSON.stringify(rpcIds) !== JSON.stringify(uIds)) fail("Trades unit accept: expected 4 rpc/apply_trade, one per row: " + JSON.stringify(rpcIds));
    else if (firstRpcIdx < lastPatchIdx) fail("Trades unit accept: an apply_trade ran before the last status PATCH (the unit must be accepted whole before any day moves)");
    else if (appliedCount !== 4) fail("Trades unit accept: expected all 4 rows to read applied, got " + appliedCount);
    else if (uAccNotifs.filter(t => t === "trade_accepted").length !== 1 || uAccNotifs.filter(t => t === "trade_applied").length !== 1) fail("Trades unit accept: expected exactly one trade_accepted and one trade_applied notification for the unit, got " + uAccNotifs.join(","));
    else if (uAppliedMail.length !== 1 || !/^Trade applied to the schedule: .*Primary 11\/26-11\/29/.test(uAppliedMail[0].data.message)) fail("Trades unit accept: one send-notification trade_applied naming the unit range expected: " + JSON.stringify(uAppliedMail.map(m => m.data && m.data.message)));
    else ok(`Trades unit accept: 4 x PATCH accepted, then 4 x rpc/apply_trade (all after the last PATCH); 4 rows applied; one trade_accepted + one trade_applied notification; email "${uAppliedMail[0].data.message.slice(0, 90)}..."`);
    if (!useq.every(w => noAddress(w.body))) fail("Trades unit: a write body carries an email address");
    await page.click('button[data-tab="calendar"]');
  } catch (e) {
    page.off("dialog", acceptAll);
    fail("Trades harness exception: " + errLine(e));
    try { await page.screenshot({ path: path.join(OUT, "failure-trades.png"), fullPage: true }); } catch (e2) {}
  }

  // ====================== Prompt 12 small items (9/22) ======================
  // Legend / empty-note wording (Q follow-up), the day editor failing CLOSED when
  // eligibility throws, asBlockMember through the day editor (Fierce completes a
  // Fri-Sun block by hand) and through the trade path (Fierce receives Khan's
  // Fri-Sun block), and the Setup -> Rules 'Primary contribution' select (L
  // follow-up). Runs on the LIVE rows, before the Setup section generates and
  // publishes December; every write is intercepted like the rest of the run.
  try {
    await page.click('button[data-tab="calendar"]');
    await page.waitForSelector(".cal-legend", { timeout: 5000 });
    const legendText = await page.$eval(".cal-legend", el => el.innerText.replace(/\s+/g, " "));
    if (!legendText.includes("OPEN = nobody assigned (today onward)")) fail("Legend: expected 'OPEN = nobody assigned (today onward)', got: " + legendText);
    else ok("Legend reads 'OPEN = nobody assigned (today onward)'");

    // ---- (1) the day editor fails CLOSED when eligibility throws ----
    // rules.js is a classic script: `eligibility` is a global the JSX resolves at call
    // time, so the harness can make it throw for one editor open and restore it after.
    // Prompt 12 SM2: the days are chosen from the live rows each run (the schedule is published through the
    // milestone since 9/23, so no date can be named): fcDay = the first row-less Mon-Fri day on/after today
    // that this run has not edited; weekendTriples = the first two Fri-Sun triples on/after today with all
    // three days row-less and untouched (block-member check, then the trade-block check) and none of them
    // inside a holiday unit of the blob (SM2 review: a Sat in a unit reads 'holiday-unit', not the
    // 'weekend-block-only' override the check accepts). The scan runs from today to 400 days past the
    // LAST live row, so a 12-month publish cannot exhaust it (SM2 review).
    const rowless = (d) => !fixtureHasDay(d) && !liveByDay[d] && !harnessDays[d];
    const dowUtc = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = Sun
    const scanEnd = isoAddDays(lastLiveDay > todayIso ? lastLiveDay : todayIso, 400);
    const weekendTriples = [];
    for (let d = todayIso; weekendTriples.length < 2 && d <= scanEnd; d = isoAddDays(d, 1)) {
      if (dowUtc(d) !== 5) continue;
      const t = [d, isoAddDays(d, 1), isoAddDays(d, 2)];
      if (t.every(x => rowless(x) && !holidayUnitDays.has(x))) weekendTriples.push(t);
    }
    const tripleDays = new Set(weekendTriples.flat());
    let fcDay = null;
    for (let d = todayIso; !fcDay && d <= scanEnd; d = isoAddDays(d, 1)) { if (dowUtc(d) >= 1 && dowUtc(d) <= 5 && rowless(d) && !tripleDays.has(d)) fcDay = d; }
    if (!fcDay || weekendTriples.length < 2) throw new Error(`no row-less weekday / holiday-free Fri-Sun triples between ${todayIso} and ${scanEnd} (fcDay ${fcDay}, triples ${weekendTriples.length})`);
    console.log(`     (small items: fail-closed day ${fcDay}, block-member triple ${weekendTriples[0].join("/")}, trade-block triple ${weekendTriples[1].join("/")} - the first row-less weekday and holiday-free Fri-Sun triples on/after today ${todayIso} untouched by this run; scan bounded by ${scanEnd} = last live row ${lastLiveDay} + 400 d; ${holidayUnitDays.size} holiday-unit day(s) in the blob)`);
    await page.evaluate(() => { window.__realEligibility = window.eligibility; window.eligibility = () => { throw new Error("harness: synthetic rules failure"); }; });
    try {
      await showMonth(+fcDay.slice(0, 4), +fcDay.slice(5, 7) - 1);
      await page.click(`[data-day="${fcDay}"]`);
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      const fcOpts = await page.$$eval("[data-testid=editor-primary] option", els => els.filter(o => o.value).map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
      const fcErr = await page.$eval("[data-testid=editor-eval-error]", el => el.textContent).catch(() => "");
      const fcDraft0 = await page.$eval("[data-testid=editor-primary]", el => el.value);
      await page.selectOption("[data-testid=editor-primary]", "s3");
      await page.waitForTimeout(250);
      const fcOverride = await page.$("[data-testid=override-confirm]");
      const fcHint = await page.$eval("[data-testid=editor-hint]", el => el.textContent).catch(() => "");
      const fcSaveDisabled = await page.$eval("[data-testid=editor-save]", el => el.disabled);
      const fcDraft = await page.$eval("[data-testid=editor-primary]", el => el.value);
      if (!fcOpts.length || !fcOpts.every(o => o.eligible === "false" && o.text.includes("rules-error:harness: synthetic rules failure"))) fail("Day editor fail-closed: every pool option must be ineligible with the thrown error as its reason: " + JSON.stringify(fcOpts));
      else if (!fcErr.includes("Eligibility check failed for") || !fcErr.includes("harness: synthetic rules failure")) fail("Day editor fail-closed: no editor-eval-error line naming the error: " + JSON.stringify(fcErr));
      else if (fcOverride || fcDraft !== fcDraft0) fail(`Day editor fail-closed: picking a surgeon must not open the override confirm nor set the draft (override=${!!fcOverride}, draft='${fcDraft}', was '${fcDraft0}')`);
      else if (!fcHint.includes("Eligibility check failed for Acton")) fail("Day editor fail-closed: no hint after the refused pick: " + JSON.stringify(fcHint));
      else if (!fcSaveDisabled) fail("Day editor fail-closed: Save must be disabled while a check threw");
      else ok(`Day editor fail-closed (${fcDay}): ${fcOpts.length} pool options ineligible 'rules-error:harness: synthetic rules failure', eval-error line shown, the pick is refused with a hint, Save disabled`);
      await page.screenshot({ path: path.join(OUT, "day-editor-fail-closed.png") });
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
    } finally {
      // a FAIL above must not leave the editor open over the nav (the next slices click Setup)
      if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape"); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); }
      await page.evaluate(() => { if (window.__realEligibility) { window.eligibility = window.__realEligibility; delete window.__realEligibility; } });
    }
    // the restored check works again: the same day opens with eligible options
    await page.click(`[data-day="${fcDay}"]`);
    await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
    const fcAfter = await page.$$eval("[data-testid=editor-primary] option", els => els.filter(o => o.value).map(o => o.getAttribute("data-eligible")));
    const fcErrAfter = await page.$("[data-testid=editor-eval-error]");
    if (!fcAfter.includes("true") || fcErrAfter) fail("Day editor: after restoring eligibility the editor still reads broken: " + JSON.stringify(fcAfter));
    else ok("Day editor: with eligibility restored the same day opens with eligible options and no eval-error line");
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });

    // ---- (2) asBlockMember in the day editor: Fierce completes a Fri-Sun block by hand ----
    // Sat and Sun of the first row-less triple -> Fierce primary (each alone is 'weekend-block-only'
    // -> the harness accepts the override), then its Fri must list Fierce as ELIGIBLE: the other two
    // block days are his in the saved rows, so the editor asks rules.js as a block member.
    {
      const blk = weekendTriples[0];
      const blkHeld = await Promise.all(blk.map(d => cellAttr(d, "data-primary").catch(() => null)));
      if (blkHeld.some(Boolean)) fail(`block-member check: the derived row-less triple ${blk.join("/")} already holds a primary in the grid (${blkHeld.join(", ")}) - the row-less derivation is broken`);
      await editDay(blk[1], "primary", "s5"); noteEdit(blk[1], { primary_id: "s5" });
      await editDay(blk[2], "primary", "s5"); noteEdit(blk[2], { primary_id: "s5" });
      await showMonth(+blk[0].slice(0, 4), +blk[0].slice(5, 7) - 1);
      await page.click(`[data-day="${blk[0]}"]`);
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      const friOpts = await page.$$eval("[data-testid=editor-primary] option", els => els.map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
      const friFierce = friOpts.find(o => o.value === "s5");
      if (!friFierce) fail(`Day editor ${blk[0]}: Fierce is not in the Primary dropdown: ` + JSON.stringify(friOpts));
      else if (friFierce.eligible !== "true") fail(`Day editor ${blk[0]}: Fierce holds Sat+Sun (${blk[1]}, ${blk[2]}) and must be ELIGIBLE for the Friday as a block member, got '${friFierce.text}' [${friFierce.eligible}]`);
      else {
        await page.selectOption("[data-testid=editor-primary]", "s5");
        await page.waitForTimeout(250);
        const friOverride = await page.$("[data-testid=override-confirm]");
        if (friOverride) fail(`Day editor ${blk[0]}: picking Fierce (block member) must not open the override confirm`);
        else ok(`Day editor ${blk[0]}: Fierce reads eligible as the third day of his Fri-Sun block ${blk[0]}-${blk[2]} ('${friFierce.text}'), no override on the pick`);
      }
      await page.screenshot({ path: path.join(OUT, "day-editor-block-member.png") });
      await discardEditor(); // the Fierce pick left a dirty draft - since Prompt 16 B9 (b) Escape asks before dropping it
    }

    // ---- (3) asBlockMember in the trade path: Fierce can receive Khan's Fri-Sun block ----
    // Fri-Sun of the second row-less triple -> Khan primary (block style), then the trade card offers
    // the three days as one weekend-block unit; Fierce must read ELIGIBLE as the counter-party.
    {
      const wk = weekendTriples[1];
      for (const d of wk) { await editDay(d, "primary", "s1"); noteEdit(d, { primary_id: "s1" }); }
      await page.click('button[data-tab="timeoff"]');
      await page.waitForSelector("[data-testid=trade-card]", { timeout: 5000 });
      await page.selectOption("[data-testid=trade-from]", "s1");
      await page.waitForTimeout(150);
      const mineVals = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => o.value).filter(Boolean));
      if (!mineVals.includes(`${wk[0]}|primary`)) fail(`Trades block: Khan's picker does not list ${wk[0]}|primary after the three edits: ` + mineVals.join(", "));
      else {
        await page.selectOption("[data-testid=trade-mine-pick]", `${wk[0]}|primary`);
        await page.waitForTimeout(200);
        const unitText = await page.$eval("[data-testid=trade-unit]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
        const blockOpts = await readToOpts();
        const fierceOpt = blockOpts.find(o => o.value === "s5");
        if (!unitText.includes("weekend block")) fail(`Trades block: ${wk[0]} primary is not offered as a weekend-block unit: ` + JSON.stringify(unitText));
        else if (!fierceOpt) fail("Trades block: Fierce is not a counter-party option: " + JSON.stringify(blockOpts));
        else if (fierceOpt.eligible !== "true") fail(`Trades block: Fierce must be ELIGIBLE to receive the whole Fri-Sun block ${wk[0]}-${wk[2]} (asBlockMember), got '${fierceOpt.text}' [${fierceOpt.eligible}]`);
        else ok(`Trades block: Khan's ${wk[0]}-${wk[2]} primary is one weekend-block unit and Fierce reads eligible to receive it ('${fierceOpt.text}')`);
        await page.screenshot({ path: path.join(OUT, "trade-block-receiver.png") });
        await page.selectOption("[data-testid=trade-mine-pick]", "");
      }
    }

    // ---- (4) Setup -> Rules: the 'Primary contribution' select writes surgeonRules.<id>.primaryContribution ----
    await page.click('button[data-tab="setup"]');
    await openCard("setup_rules");
    await page.click("[data-testid=rules-pick-s1]");
    await page.waitForSelector("[data-testid=rules-primary-contribution]", { timeout: 5000 });
    const pcHint = await page.$eval("[data-testid=rules-monthly-target]", el => el.parentElement.innerText.replace(/\s+/g, " "));
    if (!pcHint.includes("blank = equal share; a number = primary target")) fail("Rules: the Monthly target hint should read 'blank = equal share; a number = primary target', got: " + JSON.stringify(pcHint));
    else ok("Rules: Monthly target hint reads 'blank = equal share; a number = primary target'");
    const pcOpts = await page.$$eval("[data-testid=rules-primary-contribution] option", os => os.map(o => o.value));
    const pcWas = await page.$eval("[data-testid=rules-primary-contribution]", el => el.value);
    const pcNew = pcWas === "weekends" ? "" : "weekends";
    const beforePc = writes.length;
    await page.selectOption("[data-testid=rules-primary-contribution]", pcNew);
    await page.click("[data-testid=rules-save]");
    // The blob autosaves 800 ms after the LAST state change, so the first POST after the click can still be an
    // earlier change's autosave (opening the card, picking the surgeon) carrying the old value - a race this step
    // lost once the East-id resolution went async (audit 9/23). Wait for the write that carries the new value;
    // the failure names the last write seen.
    const pcWant = pcNew || undefined;
    const pcPosts = () => writesSince(beforePc, "/rest/v1/call_schedule_data").filter(w => w.method === "PATCH"); // Prompt 16 A4: the blob write is the CAS PATCH ?id=eq.main&updated_at=eq.<seen> (no upsert)
    const pcOf = (w) => { try { return JSON.parse(w.body).data.surgeonRules.s1.primaryContribution; } catch (e) { return "(unparsed)"; } };
    const pcHit = await waitFor(() => pcPosts().some(w => pcOf(w) === pcWant), 6000, 100);
    const pcBlob = pcPosts().pop() || null;
    const pcSaved = pcBlob ? pcOf(pcBlob) : "(no blob write)";
    if (pcOpts.join(",") !== ",weekends") fail("Rules: Primary contribution options should be (none) / weekends, got: " + pcOpts.join(","));
    else if (!pcBlob) fail("Rules: no call_schedule_data write after saving the Primary contribution change");
    else if (!pcHit) fail(`Rules: no call_schedule_data write carried surgeonRules.s1.primaryContribution ${JSON.stringify(pcWant)} within 6 s of the save (${pcPosts().length} write(s); the last carries ${JSON.stringify(pcSaved)})`);
    else ok(`Rules: Primary contribution select (live value '${pcWas}') -> '${pcNew || "(none)"}' -> blob write carries surgeonRules.s1.primaryContribution ${JSON.stringify(pcWant)} (${pcPosts().length} blob write(s) since the click)`);
    // put it back so the rest of the run sees the live rules
    await page.selectOption("[data-testid=rules-primary-contribution]", pcWas);
    if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) { await page.click("[data-testid=rules-save]"); await page.waitForTimeout(1200); }
    await page.click('button[data-tab="calendar"]');
  } catch (e) {
    fail("small items harness exception: " + errLine(e));
    try { await page.screenshot({ path: path.join(OUT, "failure-small-items.png"), fullPage: true }); } catch (e2) {}
  }

  // ====================== Prompt 6 Slice E: the Setup view ======================
  // Every card expanded + screenshotted, then the write paths: Users (last-admin
  // refusal, one allowed PATCH), Rules (pattern preview, save round trip),
  // Availability paste box, vacation conflict panel, Holidays coverage, East
  // status, Generate preview (no writes) -> Accept & Publish with a FAILING
  // snapshot (no writes) -> Accept & Publish for real (snapshot before the
  // first schedule_days write, publish dialog), Import seed dry run (zero
  // changes, no writes) and a seed with an injected contact KEY (refused).
  const SETUP_CARDS = ["setup_issues", "setup_roster", "setup_users", "setup_rules", "setup_availability", "setup_vacations", "setup_holidays", "setup_east", "setup_generate", "setup_import", "setup_office", "setup_clear"];
  // (openCard is defined above, before the Totals section that also needs it.)
  try {
    await page.click('button[data-tab="setup"]');
    await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 8000 });
    for (const ck of SETUP_CARDS) {
      const before = pageErrors.length;
      const card = await openCard(ck);
      if (!card) { fail(`setup card ${ck} is missing`); continue; }
      await page.waitForTimeout(300);
      const name = ck.replace(/^setup_/, "");
      await card.screenshot({ path: path.join(OUT, `setup-${name}.png`) });
      if (pageErrors.length > before) fail(`setup card ${ck}: pageerror ${pageErrors.slice(before).join(" | ")}`); else ok(`setup card ${ck}: expanded, screenshot test/ui/out/setup-${name}.png`);
    }
    // Setup issues render as a list or "None."
    const issues = await page.$eval("[data-testid=setup-issues]", el => el.innerText.trim()).catch(() => null);
    if (issues === null) fail("setup issues card has no [data-testid=setup-issues] content"); else ok("setup issues: " + (issues === "None." ? "none" : issues.split("\n").length + " warning(s), e.g. \"" + issues.split("\n")[0] + "\""));

    // ---- Users: refuse to demote the last admin; an allowed PATCH goes to ?id=eq.<uuid> ----
    {
      const before = writes.length;
      await page.waitForSelector(`[data-testid=user-role-${FAKE_UID}]`, { timeout: 5000 });
      await page.selectOption(`[data-testid=user-role-${FAKE_UID}]`, "viewer");
      await page.waitForTimeout(500);
      const refused = /last admin/.test(await bodyText());
      const patches = writesSince(before, "/rest/v1/user_profiles");
      const roleNow = await page.$eval(`[data-testid=user-role-${FAKE_UID}]`, el => el.value);
      if (patches.length || !refused || roleNow !== "admin") fail(`Users: demoting the last admin must be refused (toast, no PATCH, select back to admin): patches=${patches.length} refused=${refused} role=${roleNow}`);
      else ok("Users: demoting the last admin is refused client-side (toast names the reason, no user_profiles write, select snaps back to admin)");
      const before2 = writes.length;
      await page.fill(`[data-user="${FAKE_UID}"] input[type=text]`, "Khan (harness)");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      const dn = writesSince(before2).find(w => w.method === "PATCH" && w.path === `/rest/v1/user_profiles?id=eq.${FAKE_UID}`);
      const dnBody = dn ? JSON.parse(dn.body || "{}") : null;
      const dnAudit = auditSince(before2, "users.link");
      if (!dn || dnBody.display_name !== "Khan (harness)" || !/return=representation/.test(dn.prefer || "")) fail("Users: display-name save did not PATCH user_profiles?id=eq.<uuid> with return=representation: " + JSON.stringify(dn));
      else if (!dnAudit) fail("Users: no audit_log 'users.link' after the account PATCH");
      else if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(JSON.stringify(dnAudit))) fail("Users: the audit row carries an email address");
      else ok(`Users: PATCH /rest/v1/user_profiles?id=eq.${FAKE_UID.slice(0, 8)}... { display_name } with return=representation; audit users.link (no address in it)`);
      const usersText = await page.$eval("[data-testid=users-table]", el => el.innerText);
      if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(usersText)) fail("Users: an email address is rendered although the mocked profile has none"); else ok("Users: no address rendered for the mocked profile (email null -> '(none on file)')");
    }

    // ---- Prompt 20 F2: Follows chips on viewer / coordinator rows, at 390 px ----
    // followsFixture serves four accounts (admin, office, follower, linked surgeon). With the column present: the
    // follower and the office rows carry one chip per active roster surgeon in roster order (the follower's s2 pressed),
    // the admin and surgeon rows carry none; s5 / s2 / s5 clicks each send ONE PATCH ?id=eq.<follower> { follows } with
    // return=representation and a users.link audit naming the ids ("follows s2, s5" -> "follows s5" -> "follows none");
    // the page never scrolls sideways. With the column absent (before revision o): the note, disabled chips, no PATCH.
    {
      const F2 = "F2 Users follows";
      const chip = (uid, id) => `[data-testid="user-follow-${uid}-${id}"]`;
      const refreshUsers = async () => { await page.click('[data-testid=card-setup_users] button:has-text("Refresh")'); };
      const rowState = () => page.$$eval("[data-testid=users-table] tr[data-user]", trs => trs.map(tr => ({
        id: tr.getAttribute("data-user"), role: tr.getAttribute("data-role"),
        control: !!tr.querySelector('[data-testid^="user-follows-"]'),
        chips: Array.from(tr.querySelectorAll('[data-testid^="user-follow-"]')).map(b => ({ id: b.getAttribute("data-testid").split("-").pop(), pressed: b.getAttribute("aria-pressed"), disabled: b.disabled })),
        options: Array.from(tr.querySelectorAll('select[data-testid^="user-link-"] option')).map(o => o.value).filter(Boolean),
      })));
      try {
        followsStore[FOLLOWER_UID] = ["s2"];
        followsFixture = "present";
        await page.setViewportSize({ width: 390, height: 844 });
        await openCard("setup_users");
        await refreshUsers();
        await page.waitForSelector(chip(FOLLOWER_UID, "s2"), { timeout: 8000 });
        const rows = await rowState();
        const by = (id) => rows.find(r => r.id === id) || { chips: [], options: [] };
        const fo = by(FOLLOWER_UID), co = by(COORD_UID), ad = by(FAKE_UID), su = by(F2_SURGEON_UID);
        const ids = fo.chips.map(c => c.id), opts = fo.options;
        const inOrder = ids.every((id, i) => opts.indexOf(id) >= 0 && (i === 0 || opts.indexOf(id) > opts.indexOf(ids[i - 1])));
        if (rows.length !== 4) fail(`${F2}: expected the four fixture accounts, got ${rows.length}`);
        else if (!fo.control || !co.control || ad.control || su.control) fail(`${F2}: the Follows control must render on the viewer and coordinator rows only: ` + JSON.stringify(rows.map(r => [r.role, r.control])));
        else if (!ids.includes("s2") || !ids.includes("s5") || !inOrder || ids.some(id => /^x/.test(id)) || co.chips.map(c => c.id).join() !== ids.join()) fail(`${F2}: chips must be the active pool surgeons in roster order (the same on both rows): follower ${ids.join(",")} office ${co.chips.map(c => c.id).join(",")} roster ${opts.join(",")}`);
        else if (fo.chips.filter(c => c.pressed === "true").map(c => c.id).join() !== "s2" || co.chips.some(c => c.pressed === "true") || fo.chips.some(c => c.disabled)) fail(`${F2}: the follower must show s2 pressed (only), the office none, nothing disabled: ` + JSON.stringify([fo.chips, co.chips]));
        else ok(`${F2}: viewer + coordinator rows carry ${ids.length} chips in roster order (${ids.join(" ")}), the follower's s2 pressed; admin and surgeon rows show no control`);
        // review fix: the admin / surgeon placeholder paints the muted token (light #5B6B82, remapped to #9FB0C8 by the dark
        // sheet) - never the old #b0b8c0 (about 2.0:1 on the light card)
        const naColors = [];
        for (const uid of [FAKE_UID, F2_SURGEON_UID]) naColors.push(await page.$eval(`[data-testid="user-nofollow-${uid}"]`, el => getComputedStyle(el).color).catch(() => null));
        if (!naColors.every(c => c === "rgb(91, 107, 130)" || c === "rgb(159, 176, 200)")) fail(`${F2}: the admin / surgeon '-' placeholder must paint the muted token (rgb(91, 107, 130) light / rgb(159, 176, 200) dark): ` + JSON.stringify(naColors));
        else ok(`${F2}: the admin / surgeon placeholder paints the muted token (${naColors.join(", ")})`);
        const steps = [["s5", ["s2", "s5"], "follows s2, s5"], ["s2", ["s5"], "follows s5"], ["s5", [], "follows none"]];
        for (const [id, want, words] of steps) {
          const w0 = writes.length;
          await page.click(chip(FOLLOWER_UID, id));
          await page.waitForSelector(`${chip(FOLLOWER_UID, id)}[aria-pressed="${want.includes(id) ? "true" : "false"}"]:not([disabled])`, { timeout: 5000 });
          const gotAudit = await waitFor(() => !!auditSince(w0, "users.link"), 3000, 100);
          const patches = writesSince(w0, "/rest/v1/user_profiles").filter(w => w.method === "PATCH");
          let body = {}; try { body = JSON.parse(patches.length ? patches[0].body : "{}"); } catch (e) {}
          const audit = auditSince(w0, "users.link");
          const summary = audit && audit.detail ? audit.detail.summary : null;
          if (patches.length !== 1 || patches[0].path !== `/rest/v1/user_profiles?id=eq.${FOLLOWER_UID}` || !/return=representation/.test(patches[0].prefer || "")) fail(`${F2}: ${id} click must send ONE PATCH ?id=eq.<follower> with return=representation: ` + patches.map(w => `${w.method} ${w.path}`).join(", "));
          else if (JSON.stringify(body.follows) !== JSON.stringify(want) || Object.keys(body).sort().join() !== "follows,updated_at") fail(`${F2}: ${id} click: the PATCH body must be { follows: ${JSON.stringify(want)}, updated_at }, got ${patches[0].body}`);
          else if (!gotAudit || summary !== `Account Follower (harness): ${words}`) fail(`${F2}: ${id} click: the users.link audit summary must read 'Account Follower (harness): ${words}', got ${JSON.stringify(summary)}`);
          else ok(`${F2}: ${id} -> PATCH { follows: ${JSON.stringify(want)} }, audit users.link '${summary}'`);
        }
        const wide = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        if (wide.sw > wide.iw) fail(`${F2}: the page scrolls sideways at 390 px (scrollWidth ${wide.sw} > ${wide.iw})`); else ok(`${F2}: no sideways page scroll at 390 px (scrollWidth ${wide.sw})`);
        await page.locator(chip(FOLLOWER_UID, "s2")).scrollIntoViewIfNeeded();
        await page.locator("[data-testid=card-setup_users]").screenshot({ path: path.join(OUT, "setup-users-follows-390.png") });
        ok("screenshot test/ui/out/setup-users-follows-390.png");
        // before revision o: the rows carry no follows key
        followsFixture = "absent";
        await refreshUsers();
        await page.waitForSelector("[data-testid=users-follows-pending]", { timeout: 8000 });
        await page.waitForSelector(`${chip(FOLLOWER_UID, "s2")}[disabled]`, { timeout: 5000 });
        const wA = writes.length;
        await page.$eval(chip(FOLLOWER_UID, "s5"), b => b.click());
        await page.waitForTimeout(400);
        const rowsA = await rowState();
        const allDisabled = rowsA.filter(r => r.control).every(r => r.chips.length && r.chips.every(c => c.disabled && c.pressed === "false"));
        const patchesA = writesSince(wA, "/rest/v1/user_profiles");
        if (!allDisabled || patchesA.length || await page.$("[data-testid=users-error]")) fail(`${F2}: without the column the chips must be disabled and unpressed, a click must write nothing and the card must not error: disabled=${allDisabled} writes=${patchesA.length}`);
        else ok(`${F2}: without the column (before revision o) the card loads, says so (users-follows-pending), the chips are disabled and a click writes nothing`);
      } catch (e) { fail(`${F2}: ` + String(e && e.message || e).split("\n")[0]); try { await page.screenshot({ path: path.join(OUT, "failure-f2-users.png"), fullPage: true }); } catch (e2) {} }
      followsFixture = null;
      try {
        await refreshUsers();
        await page.waitForSelector(`[data-user="${FOLLOWER_UID}"]`, { state: "detached", timeout: 8000 });
        ok(`${F2}: fixture dropped - the one-profile picture is back`);
      } catch (e) { fail(`${F2}: the fixture rows did not clear: ` + String(e && e.message || e).split("\n")[0]); }
      await page.setViewportSize({ width: 1180, height: 900 });
    }

    // ---- Rules editor: pattern preview (next 8 matching dates) + save round trip ----
    {
      await openCard("setup_rules");
      await page.click("[data-testid=rules-pick-s3]");
      await page.waitForSelector("[data-testid=pattern-row]", { timeout: 5000 });
      const previews = await page.$$eval("[data-testid=pattern-preview]", els => els.map(e => e.textContent));
      const first = previews[0] || "";
      const dates = first.match(/\d{4}-\d{2}-\d{2}/g) || [];
      const dow = (s) => new Date(s + "T12:00:00").getUTCDay();
      const nthOk = dates.every(d => dow(d) === 1 && ([2, 4].includes(Math.floor((Number(d.slice(8, 10)) - 1) / 7) + 1)));
      if (dates.length !== 8 || !nthOk) fail("Rules: the first pattern preview should list the next 8 2nd/4th Mondays: " + first.slice(0, 200)); else ok(`Rules (Acton): pattern preview lists 8 dates, all 2nd/4th Mondays: ${dates[0]} .. ${dates[7]}`);
      await page.locator("[data-testid=rules-editor]").screenshot({ path: path.join(OUT, "setup-rules-acton.png") });
      // save round trip: maxConsecutiveDays 3 -> 4 -> audit + blob autosave carries it, then back to 3
      let before = writes.length;
      const maxInput = page.locator("[data-testid=rules-editor] input[type=number][max='14']").first();
      const findBlob4 = () => writesSince(before, "/rest/v1/call_schedule_data").map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.data && b.data.surgeonRules && b.data.surgeonRules.s3 && b.data.surgeonRules.s3.maxConsecutiveDays === 4);
      // The 60 s background poll re-adopts the LIVE blob whenever its updated_at differs
      // from our last (mocked, never persisted) write - a harness artefact that can land
      // inside this save's 800 ms debounce and revert the 4. One retry covers that window;
      // a real regression fails both attempts.
      for (let attempt = 1; attempt <= 2; attempt++) {
        await maxInput.fill("4");
        if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) await page.click("[data-testid=rules-save]");
        if (await waitFor(() => !!findBlob4(), 3000, 100)) break;
        if (attempt === 1) { console.log("     (Rules: the blob write after Save did not carry the 4 - the background blob refresh raced the save; retrying once)"); before = writes.length; }
      }
      await page.waitForTimeout(300);
      const ruleAudit = auditSince(before, "rules.edit");
      const blobW = findBlob4() || writesSince(before, "/rest/v1/call_schedule_data").map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.data && b.data.surgeonRules && b.data.surgeonRules.s3);
      if (!ruleAudit) fail("Rules: no audit_log 'rules.edit' after Save");
      else if (!blobW || blobW.data.surgeonRules.s3.maxConsecutiveDays !== 4) fail("Rules: the blob autosave after Save does not carry surgeonRules.s3.maxConsecutiveDays = 4: " + JSON.stringify(blobW && blobW.data.surgeonRules && blobW.data.surgeonRules.s3 && blobW.data.surgeonRules.s3.maxConsecutiveDays));
      else if ("schedule" in blobW.data || "vacations" in blobW.data) fail("Rules: the blob write carries operational keys");
      else ok("Rules: Save -> audit rules.edit + blob autosave with surgeonRules.s3.maxConsecutiveDays 4 (config keys only)");
      await maxInput.fill("3");
      // Save is disabled when the draft already equals the saved rules (a blob
      // refresh from the 60 s poll can have reset the draft to the live 3 in the
      // meantime) - then there is nothing to restore.
      if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) { await page.click("[data-testid=rules-save]"); await page.waitForTimeout(1200); }
      else console.log("     (Rules: maxConsecutiveDays already back at 3 - the blob refreshed in between; nothing to restore)");
      // Prompt 16 A4: the keepalive flush's blob leg. A Setup edit hidden inside the 800 ms debounce goes out at once
      // as the SAME compare-and-swap PATCH the autosave uses - ?id=eq.main&updated_at=eq.<the stamp of the last blob
      // write this page saw>, Prefer return=representation, keepalive - never the old blind upsert (?on_conflict=id);
      // the stamp in the URL is the one the previous write left (CAS chaining across writes).
      {
        const stampBefore = blobWriteTs;
        const beforeKa = writes.length;
        await maxInput.fill("4");
        if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) await page.click("[data-testid=rules-save]");
        const hideAt = Date.now();
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
          delete document.hidden;
        });
        await page.waitForTimeout(400);
        const kaBlob = writes.slice(beforeKa).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path) && typeof w.at === "number" && w.at >= hideAt && w.at < hideAt + 600);
        const kaCas = kaBlob.find(w => w.method === "PATCH" && /^\/rest\/v1\/call_schedule_data\?id=eq\.main&updated_at=(eq\.[^&]+|is\.null)$/.test(w.path));
        const kaMax = (w) => { try { return JSON.parse(w.body).data.surgeonRules.s3.maxConsecutiveDays; } catch (e) { return undefined; } };
        const kaStamp = kaCas && /updated_at=eq\./.test(kaCas.path) ? decodeURIComponent(kaCas.path.replace(/^.*updated_at=eq\./, "")) : null;
        const kaUpsert = writes.slice(beforeKa).find(w => /call_schedule_data\?on_conflict=id/.test(w.path) || (/call_schedule_data/.test(w.path) && /merge-duplicates/.test(w.prefer || "")));
        if (kaUpsert) fail("A4 keepalive: the flush sent a blind upsert of call_schedule_data: " + kaUpsert.method + " " + kaUpsert.path + " prefer=" + kaUpsert.prefer);
        else if (!kaCas) fail("A4 keepalive: no CAS PATCH ?id=eq.main&updated_at=eq.<stamp> of call_schedule_data within 400 ms of hiding the tab (writes since the edit: " + JSON.stringify(writes.slice(beforeKa).map(w => w.method + " " + w.path)) + ")");
        else if (!/return=representation/.test(kaCas.prefer || "")) fail("A4 keepalive: the CAS PATCH lacks Prefer return=representation (a miss would be invisible): " + kaCas.prefer);
        else if (kaMax(kaCas) !== 4) fail("A4 keepalive: the flushed blob does not carry surgeonRules.s3.maxConsecutiveDays 4: " + JSON.stringify(kaMax(kaCas)));
        else if (stampBefore && kaStamp !== stampBefore) fail(`A4 keepalive: the CAS stamp in the URL (${kaStamp}) is not the stamp the previous blob write left (${stampBefore})`);
        else ok(`A4 keepalive: a Rules edit hidden inside the debounce -> PATCH ?id=eq.main&updated_at=eq.${kaStamp} (Prefer return=representation, keepalive, maxConsecutiveDays 4)${stampBefore ? " - the stamp of the previous blob write" : ""}; no on_conflict upsert`);
        await page.waitForTimeout(1200); // the debounced run finds the signature already written and skips
        await maxInput.fill("3");
        if (await page.$eval("[data-testid=rules-save]", el => !el.disabled)) { await page.click("[data-testid=rules-save]"); await page.waitForTimeout(1200); }
      }
    }

    // ---- Availability: paste a date list -> collapsed ranges -> insert missing rows ----
    {
      await openCard("setup_availability");
      await page.selectOption("[data-testid=paste-person]", "s2");
      await page.selectOption("[data-testid=paste-year]", "2027");
      await page.fill("[data-testid=paste-text]", "1/5, 1/6, 1/7, 1/12, bogus");
      await page.waitForTimeout(200);
      const prev = await page.$eval("[data-testid=paste-preview]", el => el.innerText.replace(/\s+/g, " "));
      if (!/4 date\(s\) in 2 range\(s\): 1\/5-1\/7, 1\/12/.test(prev) || !/Not understood: bogus/.test(prev)) fail("Availability paste preview wrong: " + prev); else ok("Availability paste: '1/5, 1/6, 1/7, 1/12, bogus' -> 4 dates in 2 ranges (1/5-1/7, 1/12), 'bogus' reported");
      const before = writes.length;
      await page.click("[data-testid=paste-insert]");
      await page.waitForTimeout(1200);
      const ins = writesSince(before, "/rest/v1/availability").find(w => w.method === "POST");
      const rows = ins ? JSON.parse(ins.body || "[]") : [];
      const avAudit = auditSince(before, "availability.add");
      if (!ins || rows.length !== 2 || rows[0].start_date !== "2027-01-05" || rows[0].end_date !== "2027-01-07" || rows[1].start_date !== "2027-01-12" || rows[0].source !== "setup" || rows[0].person_id !== "s2") fail("Availability paste: insert body wrong: " + JSON.stringify(rows));
      else if (!avAudit) fail("Availability paste: no audit 'availability.add'");
      else ok("Availability paste: POST /rest/v1/availability with 2 collapsed rows (2027-01-05..07, 2027-01-12; kind available, source setup) + audit availability.add");
    }

    // ---- Vacations: the client pre-check refuses with the conflicting dates and a 'go to day' link ----
    {
      // Live-drift fix (9/24): the surgeon and the day are DERIVED from the harness's picture of the map (live rows +
      // this run's edits), never pinned (the 10/10 trade broke 'Acton 10/10'). The expected items restate the app's
      // pre-check (index-source.html vacationConflictItems, which mirrors the DB trigger): the day BEFORE the range when
      // the surgeon is PRIMARY there (the 07:00 handoff falls on the first vacation day), then every range day he holds
      // (primary, else backup), in date order. The pick is the first day D after today, outside every day this run
      // edited or claimed, where a roster surgeon X holds D AND is primary on D-1 - so the trailing-edge rule is always
      // exercised; none in the published schedule = FAIL. D-1 and D are OBSERVED in the grid before the entry (the
      // pre-check reads the app's map), like Item SM.
      const touchedVac = (d) => !!harnessDays[d] || !!claimedDays[d];
      let vacX = null, vacD = null;
      for (const d of curDays()) {
        if (d <= todayIso || touchedVac(d) || touchedVac(isoAddDays(d, -1))) continue;
        const c = curDay(d), prevP = curDay(isoAddDays(d, -1)).primary;
        const x = [c.primary, c.backup].find(id => id && /^s\d+$/.test(id) && id === prevP);
        if (x) { vacX = x; vacD = d; break; }
      }
      const vacItemsE = [];
      if (!vacD) fail(`Vacation conflict: no day after today ${todayIso} (outside this run's edits) where a surgeon holds the day and is primary the day before - the trailing-edge pre-check cannot be exercised`);
      else {
        const prev = isoAddDays(vacD, -1), obs = {};
        for (const d of [prev, vacD]) { await showMonth(+d.slice(0, 4), +d.slice(5, 7) - 1); obs[d] = { primary: (await cellAttr(d, "data-primary").catch(() => "")) || null, backup: (await cellAttr(d, "data-backup").catch(() => "")) || null }; }
        if (obs[prev].primary === vacX) vacItemsE.push({ day: prev, role: "primary" });
        if (obs[vacD].primary === vacX || obs[vacD].backup === vacX) vacItemsE.push({ day: vacD, role: obs[vacD].primary === vacX ? "primary" : "backup" });
        const drift = [prev, vacD].filter(d => obs[d].primary !== curDay(d).primary || obs[d].backup !== curDay(d).backup);
        if (drift.length) console.log(`     (vacation conflict: the grid differs from the live rows on ${drift.join(", ")} - the expected items follow the grid)`);
        console.log(`     (vacation conflict fixture: ${rosterNameOf(vacX)} (${vacX}) on ${vacD} - primary on ${prev} per the ${drift.length ? "grid" : "live rows"}; expected items ${vacItemsE.map(i => mdOf(i.day) + " " + i.role).join(", ")})`);
        await page.click('button[data-tab="setup"]');
        await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 });
      }
      await openCard("setup_vacations");
      const before = writes.length;
      const form = page.locator("[data-testid=card-setup_vacations]");
      // Item B: the Setup card renders the same grouped list (a header per surgeon with upcoming ranges, in roster order).
      const setupGroups = await form.evaluate(card => Array.from(card.querySelectorAll("[data-testid^=vac-group-]")).map(h => ({ id: h.getAttribute("data-testid").slice(10), lines: h.parentElement.querySelectorAll("[data-testid^=vac-line-]").length })));
      const sgIds = setupGroups.map(x => x.id);
      if (!setupGroups.length || setupGroups.some(x => !x.lines) || sgIds.join() !== sgIds.slice().sort((a, b) => +a.slice(1) - +b.slice(1)).join()) fail("Item B Setup > Vacations: expected per-surgeon groups in roster order, each with lines: " + JSON.stringify(setupGroups));
      else ok(`Item B Setup > Vacations: ${setupGroups.length} per-surgeon group(s) in roster order (${sgIds.join(", ")}), each with its lines`);
      const vacDIdx = vacItemsE.findIndex(i => i.day === vacD);
      if (vacD && (vacItemsE.length !== 2 || vacDIdx !== 1)) fail(`Vacation conflict: the grid no longer shows ${vacX} primary on ${isoAddDays(vacD, -1)} and on ${vacD} (items ${JSON.stringify(vacItemsE)}) - the trailing-edge case is not set up`);
      else if (vacD) {
        const nameX = rosterNameOf(vacX);
        await form.locator("select").first().selectOption(vacX);
        const dateInputs = form.locator("input[type=date]");
        await dateInputs.nth(0).fill(vacD);
        await dateInputs.nth(1).fill(vacD);
        await form.locator("button:has-text('Add vacation')").click();
        await page.waitForSelector("[data-testid=vac-conflict]", { timeout: 5000 });
        const conflictText = await page.$eval("[data-testid=vac-conflict]", el => el.innerText.replace(/\s+/g, " "));
        const toPosts = writesSince(before, "/rest/v1/time_off");
        const expLinks = vacItemsE.map(i => `${mdOf(i.day)} ${i.role} - go to day`);
        const headWant = `${nameX} is published on ${vacItemsE.length} day(s) in ${mdOf(vacD)} - ${mdOf(vacD)}`;
        if (toPosts.length) fail("Vacation conflict: a time_off write was sent although the client pre-check refused: " + JSON.stringify(toPosts.map(w => w.method + " " + w.path)));
        else if (!conflictText.includes(headWant) || !expLinks.every(l => conflictText.includes(l))) fail(`Vacation conflict panel wrong (want '${headWant}' and ${expLinks.map(l => "'" + l + "'").join(", ")}): ` + conflictText);
        else ok(`Vacation pre-check: ${nameX} ${mdOf(vacD)} refused ('${headWant}') with a 'go to day' link per conflict, no time_off write`);
        // The trailing-edge day (X is PRIMARY the day before) and D itself, in date order, exactly.
        const conflictDays = await page.$$eval("[data-testid=vac-conflict-day]", els => els.map(e => e.textContent.trim()));
        const linksOk = conflictDays.join(" | ") === expLinks.join(" | ");
        if (!linksOk) fail(`Vacation conflict: expected exactly the trailing-edge and range links [${expLinks.join(" | ")}], got ${JSON.stringify(conflictDays)}`); else ok(`Vacation conflict: lists the trailing-edge day too (${expLinks.map(l => l.replace(/ - go to day$/, "")).join(", ")})`);
        // The 'go to day' click runs only on the expected link list - a missing link must FAIL above, not hang the
        // click for 30 s and abort the rest of Slice E (the 9/24 cascade).
        if (!linksOk) console.log(`     (skipped the 'go to day' click on ${mdOf(vacD)}: the link list is wrong - FAILed above)`);
        else {
          await page.locator("[data-testid=vac-conflict-day]").nth(vacDIdx).click();
          await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
          const edT = await page.$eval("[data-testid=editor-title]", el => el.textContent);
          const vt = new Date(vacD + "T12:00:00Z");
          const wantT = `${["January","February","March","April","May","June","July","August","September","October","November","December"][vt.getUTCMonth()]} ${vt.getUTCDate()}, ${vt.getUTCFullYear()}`;
          if (!edT.includes(wantT)) fail(`'go to day' did not open the day editor on ${vacD} (want '${wantT}'): ` + edT); else ok(`'go to day' on ${mdOf(vacD)} opens the calendar day editor on ${edT.trim()}`);
          await page.keyboard.press("Escape");
        }
        await page.click('button[data-tab="setup"]');
        await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 });
      }
    }

    // ---- Holidays: 2026 units with live coverage ----
    {
      await openCard("setup_holidays");
      const holText = await page.$eval("[data-testid=hol-year-2026]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
      if (!/Thanksgiving/.test(holText) || !/P Khan/.test(holText)) fail("Holidays 2026: Thanksgiving row with 'P Khan' coverage expected: " + holText.slice(0, 300)); else ok("Holidays 2026: units listed with coverage from schedule_days (Thanksgiving P Khan)");
      const counts = await page.$eval("[data-testid=hol-count-s1]", el => el.textContent);
      if (!/Khan \d+\/\d+/.test(counts)) fail("Holidays: per-surgeon major/minor counts missing: " + counts); else ok("Holidays: per-surgeon counts beside each name (" + counts + ")");
    }

    // ---- East feed: status line + derived weeks ----
    {
      await openCard("setup_east");
      const st = await page.$eval("[data-testid=east-status]", el => el.innerText.replace(/\s+/g, " "));
      if (!/East feed: fetched .+, \d+ week\(s\), coverage \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}, next derived primary week/.test(st)) fail("East status line wrong: " + st); else ok("East status: " + st.slice(0, 140));
      const derived = await page.$eval("[data-testid=east-derived]", el => el.innerText.trim().split("\n").length).catch(() => 0);
      if (!derived) fail("East: no derived weeks listed (feed/stated weeks expected)"); else ok(`East: ${derived} derived week(s) listed with source feed/stated`);
      // fix round 2 (safe-1 / wire-2): the east_feed upsert dying at the network level
      // (route.abort, not an HTTP error) must warn + toast, log no audit row and
      // leave the status line alone - then the same Refresh succeeds and the
      // upsert payload is asserted (Davenport is mocked: one week, FAK = s6).
      {
        const statusBefore = st;
        abortEastFeedPost = true;
        const before = writes.length;
        await page.click("[data-testid=east-refresh]");
        await waitFor(() => writesSince(before, "/rest/v1/east_feed").length > 0, 20000);
        await page.waitForTimeout(900);
        const posts = writesSince(before, "/rest/v1/east_feed");
        const txt = await bodyText();
        const toasted = /East feed refresh FAILED - the cached weeks are unchanged/.test(txt);
        const warned = consoleWarns.some(w => /East feed refresh failed/.test(w));
        const refreshAudit = auditSince(before, "east.refresh");
        const statusAfter = await page.$eval("[data-testid=east-status]", el => el.innerText.replace(/\s+/g, " "));
        const stillBusy = await page.$eval("[data-testid=east-refresh]", el => el.disabled);
        if (posts.length !== 1 || !posts[0].aborted) fail("East refresh (aborted upsert): expected exactly one aborted east_feed POST, saw " + JSON.stringify(posts.map(w => w.method + " " + w.path + (w.aborted ? " [aborted]" : ""))));
        else if (!toasted) fail("East refresh (aborted upsert): no 'East feed refresh FAILED' toast - the failure was silent");
        else if (!warned) fail("East refresh (aborted upsert): no console.warn 'East feed refresh failed'");
        else if (refreshAudit) fail("East refresh (aborted upsert): an audit 'east.refresh' row was logged although the upsert failed");
        else if (statusAfter !== statusBefore) fail("East refresh (aborted upsert): the status line changed although the upsert failed: " + statusAfter.slice(0, 140));
        else if (stillBusy) fail("East refresh (aborted upsert): the Refresh button stayed disabled (finally did not run)");
        else ok("East refresh with the east_feed POST aborted at the network level: console.warn + error toast, no audit row, status line unchanged, button re-enabled (no unhandled rejection)");
        abortEastFeedPost = false;
        const before2 = writes.length;
        await page.click("[data-testid=east-refresh]");
        await waitFor(() => !!auditSince(before2, "east.refresh"), 20000);
        await page.waitForTimeout(400);
        const post2 = writesSince(before2, "/rest/v1/east_feed").find(w => w.method === "POST");
        let rows2 = []; try { rows2 = JSON.parse(post2 ? post2.body : "[]"); } catch (e) {}
        const txt2 = await bodyText();
        if (!post2 || !/resolution=merge-duplicates/.test(post2.prefer || "") || rows2.length !== 1 || rows2[0].week_monday !== "2026-10-05" || !rows2[0].data || rows2[0].data.dayCall !== "s6" || !rows2[0].fetched_at) fail("East refresh: upsert payload wrong: " + JSON.stringify({ prefer: post2 && post2.prefer, rows: rows2 }).slice(0, 300));
        else if (!/East feed refreshed: 1 published week\(s\) cached/.test(txt2)) fail("East refresh: success toast missing after the upsert");
        else ok("East refresh: POST /rest/v1/east_feed (merge-duplicates) with the 1 mocked Davenport week (2026-10-05, dayCall s6, fetched_at) + audit east.refresh + success toast");
        // Prompt 12 C.2 (9/22): after the upsert the refresh DELETEs the east_forecast
        // rows whose week_monday lies inside the new published coverage (the mocked
        // week 2026-10-05 -> 2026-10-05..2026-10-11; the harness answers ONE fake row),
        // counts them with return=representation, and says so in the audit row + toast.
        const fcDel = writesSince(before2, "/rest/v1/east_forecast").find(w => w.method === "DELETE");
        const refreshAudit2 = auditSince(before2, "east.refresh");
        const fcDeleted = refreshAudit2 && refreshAudit2.detail ? refreshAudit2.detail.forecastRowsDeleted : undefined;
        if (!fcDel) fail("East refresh (C.2): no DELETE on /rest/v1/east_forecast after the upsert - stale forecast rows inside the published coverage are never pruned");
        else if (fcDel.path !== "/rest/v1/east_forecast?week_monday=gte.2026-10-05&week_monday=lte.2026-10-11") fail("East refresh (C.2): the forecast DELETE window is not the new published coverage: " + fcDel.path);
        else if (!/return=representation/.test(fcDel.prefer || "")) fail("East refresh (C.2): the forecast DELETE lacks Prefer: return=representation (nothing to count): " + fcDel.prefer);
        else if (fcDel.path.indexOf("east_forecast") < 0 || writesSince(before2).findIndex(w => w === fcDel) < writesSince(before2).findIndex(w => w === post2)) fail("East refresh (C.2): the forecast DELETE ran before the east_feed upsert");
        else if (fcDeleted !== 1) fail("East refresh (C.2): audit east.refresh detail.forecastRowsDeleted should be 1 (the harness answered one row - the app must COUNT the representation), got " + JSON.stringify(fcDeleted) + " in " + JSON.stringify(refreshAudit2 && refreshAudit2.detail));
        else if (!/1 forecast row\(s\) inside the published coverage deleted/.test((refreshAudit2 && refreshAudit2.detail && refreshAudit2.detail.summary) || "")) fail("East refresh (C.2): the audit summary does not name the deleted count: " + JSON.stringify(refreshAudit2 && refreshAudit2.detail && refreshAudit2.detail.summary));
        else if (!/1 forecast row\(s\)/.test(txt2)) fail("East refresh (C.2): the success toast does not say how many forecast rows were deleted: " + txt2.slice(0, 200));
        else ok("East refresh (C.2): DELETE /rest/v1/east_forecast?week_monday=gte.2026-10-05&week_monday=lte.2026-10-11 (return=representation) after the upsert; audit detail forecastRowsDeleted 1 (counted from the representation); audit summary + toast name the count");
        // Prompt 15 (fix round): the mocked Davenport time_off answered the same three ranges the cache overlay carries and
        // both review rows (away / home) match them exactly -> the refresh resets NOTHING: no east_vacation_reviews DELETE,
        // no eastvac.review audit, no 'reset' word in the toast (the moved / removed case is driven further down).
        const evDel = writesSince(before2, "/rest/v1/east_vacation_reviews").filter(w => w.method === "DELETE");
        if (evDel.length || auditSince(before2, "eastvac.review") || /East vacation review\(s\) reset/.test(txt2)) fail("East refresh (P15): an unchanged Davenport range must keep its review - saw " + evDel.length + " east_vacation_reviews DELETE(s), audit " + JSON.stringify(auditSince(before2, "eastvac.review")) + ", toast reset word " + /East vacation review\(s\) reset/.test(txt2));
        else ok("East refresh (P15): both review rows match unchanged ranges - no east_vacation_reviews DELETE, no eastvac.review audit, no reset word in the toast");
        // Prompt 12 C.4: the conflict report over the published schedule lives in the card.
        const conflicts = await page.$eval("[data-testid=east-conflicts]", el => el.innerText.replace(/\s+/g, " ").trim()).catch(() => null);
        if (conflicts === null) fail("East card (C.4): no [data-testid=east-conflicts] conflict report");
        else if (!(conflicts === "none" || /\d{4}-\d{2}-\d{2} (primary|backup) /.test(conflicts))) fail("East card (C.4): the conflict report is neither 'none' nor day/role rows: " + conflicts.slice(0, 160));
        else ok("East card (C.4): conflicts with the published schedule: " + (conflicts === "none" ? "none" : conflicts.slice(0, 120)));
      }
    }

    // ---- Prompt 15 part 3 (9/23): East vacations - the panel, the write path, the markers, the strip, My schedule, Time off ----
    // Fixture: see EASTVAC_RANGES / eastVacReviewStore and the east_feed overlay in routeSupabase. The Refresh above
    // answered the same three ranges from the mocked Davenport time_off, so every review is still in place here.
    try {
      const EV = EASTVAC_RANGES;
      const want = [["unreviewed", EV[0]], ["away", EV[1]], ["home", EV[2]]];
      await page.click('button[data-tab="setup"]');
      await openCard("setup_east");
      await page.waitForSelector("[data-testid=eastvac-list]", { timeout: 8000 });
      const readRanges = (listSel) => page.$$eval(`${listSel} [data-testid^=eastvac-range-]`, els => els.map(e => ({ start: e.getAttribute("data-start"), end: e.getAttribute("data-end"), state: e.getAttribute("data-state"), buttons: Array.from(e.querySelectorAll("[data-testid^=eastvac-set-]")).map(b => ({ st: b.getAttribute("data-testid").slice("eastvac-set-".length), pressed: b.getAttribute("aria-pressed"), h: b.getBoundingClientRect().height })) })));
      const listOk = (rows) => rows.length === 3 && want.every(([st, r]) => (rows.find(x => x.start === r.start && x.end === r.end) || {}).state === st);
      const rs = await readRanges("[data-testid=eastvac-list]");
      const revState = await page.$eval("[data-testid=eastvac-review-state]", el => el.getAttribute("data-state"));
      if (!listOk(rs)) fail("East vacations panel: expected the three fixture ranges as unreviewed / away / home, got " + JSON.stringify(rs.map(x => x.start + ".." + x.end + " " + x.state)));
      else if (revState !== "ok") fail("East vacations panel: review state is '" + revState + "', expected ok (the harness serves the reviews table)");
      else if (rs.some(x => x.buttons.length !== 3 || x.buttons.some(b => b.h < 32))) fail("East vacations panel: every range needs the three-way control (unreviewed / away / home), each >= 32px tall: " + JSON.stringify(rs.map(x => x.buttons)));
      else if (rs.some(x => x.buttons.filter(b => b.pressed === "true").length !== 1 || x.buttons.find(b => b.pressed === "true").st !== x.state)) fail("East vacations panel: the pressed segment must be the range's state: " + JSON.stringify(rs));
      else ok(`East vacations panel: 3 ranges - ${rs.map(x => x.start + ".." + x.end + " " + x.state).join(", ")} - each with the unreviewed / away / home control (pressed = state, >= 32px), reviews loaded`);
      // unreviewed -> away: ONE upsert on the exact triple + audit, no time_off write
      const row0 = `[data-testid=eastvac-list] [data-testid=eastvac-range-s1-${EV[0].start}]`;
      const before = writes.length;
      await page.click(`${row0} [data-testid=eastvac-set-away]`);
      await waitFor(async () => (await page.getAttribute(row0, "data-state")) === "away", 8000);
      await page.waitForTimeout(400);
      const up = writesSince(before, "/rest/v1/east_vacation_reviews").filter(w => w.method === "POST");
      const upBody = up[0] ? bodyOf(up[0]) : null;
      const upAudit = auditSince(before, "eastvac.review");
      const stAfter = await page.getAttribute(row0, "data-state");
      if (up.length !== 1 || up[0].path !== "/rest/v1/east_vacation_reviews?on_conflict=person_id,start,end" || !/resolution=merge-duplicates/.test(up[0].prefer) || !/return=representation/.test(up[0].prefer)) fail("East vacations away: expected one POST /rest/v1/east_vacation_reviews?on_conflict=person_id,start,end (merge-duplicates + representation): " + JSON.stringify(up.map(w => w.method + " " + w.path + " [" + w.prefer + "]")));
      else if (!upBody || upBody.person_id !== "s1" || upBody.start !== EV[0].start || upBody.end !== EV[0].end || upBody.decision !== "away" || !upBody.decided_at || upBody.decided_by !== "s1") fail("East vacations away: upsert body wrong: " + JSON.stringify(upBody));
      else if (!upAudit || !upAudit.detail || upAudit.detail.decision !== "away" || upAudit.detail.start !== EV[0].start || upAudit.detail.end !== EV[0].end || upAudit.detail.person_id !== "s1") fail("East vacations away: audit eastvac.review { person_id s1, start, end, decision away } missing: " + JSON.stringify(upAudit));
      else if (stAfter !== "away") fail("East vacations away: the row did not re-render as away (" + stAfter + ")");
      else if (writesSince(before).some(w => /\/rest\/v1\/time_off/.test(w.path))) fail("East vacations away: a time_off write went out - a derived vacation must never write time_off rows");
      else if (!writesSince(before).every(w => noAddress(w.body))) fail("East vacations away: a write body carries an email address");
      else ok(`East vacations: ${EV[0].start}..${EV[0].end} unreviewed -> away = POST ...east_vacation_reviews?on_conflict=person_id,start,end { s1, decision away, decided_by s1 } (merge-duplicates + representation) + audit eastvac.review; row reads away; no time_off write`);
      // back to unreviewed: ONE delete by the exact triple, representation counted, audit reset
      const before2 = writes.length;
      await page.click(`${row0} [data-testid=eastvac-set-unreviewed]`);
      await waitFor(async () => (await page.getAttribute(row0, "data-state")) === "unreviewed", 8000);
      await page.waitForTimeout(400);
      const del = writesSince(before2, "/rest/v1/east_vacation_reviews").filter(w => w.method === "DELETE");
      const delAudit = auditSince(before2, "eastvac.review");
      if (del.length !== 1 || del[0].path !== `/rest/v1/east_vacation_reviews?person_id=eq.s1&start=eq.${EV[0].start}&end=eq.${EV[0].end}` || !/return=representation/.test(del[0].prefer)) fail("East vacations reset: expected one DELETE by the exact (person_id, start, end) with return=representation: " + JSON.stringify(del.map(w => w.method + " " + w.path + " [" + w.prefer + "]")));
      else if (!delAudit || !delAudit.detail || delAudit.detail.decision !== "reset" || delAudit.detail.removed !== 1) fail("East vacations reset: audit eastvac.review { decision reset, removed 1 } missing: " + JSON.stringify(delAudit));
      else if ((await page.getAttribute(row0, "data-state")) !== "unreviewed") fail("East vacations reset: the row did not return to unreviewed");
      else ok(`East vacations: back to unreviewed = DELETE ...?person_id=eq.s1&start=eq.${EV[0].start}&end=eq.${EV[0].end} (representation counted: removed 1) + audit eastvac.review reset`);
      // away -> home saves the review only: the Prompt 14 'paint as either offers' hook is a no-op (no call_offers write); then back to away
      const row1 = `[data-testid=eastvac-list] [data-testid=eastvac-range-s1-${EV[1].start}]`;
      const before3 = writes.length;
      await page.click(`${row1} [data-testid=eastvac-set-home]`);
      await waitFor(async () => (await page.getAttribute(row1, "data-state")) === "home", 8000);
      await page.waitForTimeout(300);
      // a blob write of call_schedule_data landing inside this window is tolerated (the same "unrelated background
      // write" the preview step tolerates) and says nothing about this hook: since Prompt 16 A4 the blob leg fires on
      // the setup state alone (index-source.html: loaded, surgeons, surgeonRules, groupRules, holidays, settings,
      // lastPublished, lastGenerate, saveTick - no offerRows / periodRows, no schedule / vacations / availabilityRows)
      // and writes only when the content changed, so one here could only be an earlier Setup step's write landing late
      const homeWrites = writesSince(before3).filter(w => !/\/rest\/v1\/(audit_log|call_schedule_data)\b/.test(w.path));
      const homeBlobWrites = writesSince(before3).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path));
      if (homeBlobWrites.length) console.log("     (unrelated background write(s) during the home step: " + homeBlobWrites.map(w => w.method + " " + w.path).join(", ") + ")");
      if (homeWrites.length !== 1 || !/\/rest\/v1\/east_vacation_reviews/.test(homeWrites[0].path) || writesSince(before3).some(w => /call_offers/.test(w.path))) fail("East vacations home: expected exactly one east_vacation_reviews write and NO call_offers write (the Prompt 14 hook is a no-op tonight): " + JSON.stringify(homeWrites.map(w => w.method + " " + w.path)));
      else ok("East vacations: away -> home saves the review only - no call_offers write (Prompt 14's painter hook is a documented no-op)");
      await page.click(`${row1} [data-testid=eastvac-set-away]`);
      await waitFor(async () => (await page.getAttribute(row1, "data-state")) === "away", 8000);
      await page.waitForTimeout(300);
      const evc = await page.$eval("[data-testid=eastvac-conflicts]", el => el.innerText.replace(/\s+/g, " ").trim()).catch(() => null);
      if (evc === null) fail("East vacations panel: no [data-testid=eastvac-conflicts] list (the time_off trigger mirrored for derived ranges)");
      else if (!(evc === "none" || /\d{4}-\d{2}-\d{2} (primary|backup) /.test(evc))) fail("East vacations panel: the conflicts list is neither 'none' nor day/role rows: " + evc.slice(0, 160));
      else ok("East vacations panel: published days inside unreviewed/away ranges: " + (evc === "none" ? "none" : evc.slice(0, 120)));
      // screenshots: the panel with one range in each state - light + dark, desktop + 390 px
      const panel = page.locator("[data-testid=eastvac-card]");
      const shotPanel = async (name) => { await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await panel.screenshot({ path: path.join(OUT, name) }); ok("screenshot test/ui/out/" + name); };
      await shotPanel("eastvac-panel.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const m390 = await page.evaluate(() => { const card = document.querySelector("[data-testid=eastvac-card]"); const btns = Array.from(card.querySelectorAll("[data-testid^=eastvac-set-]")); return { pageW: document.documentElement.scrollWidth, minBtn: Math.min(...btns.map(b => b.getBoundingClientRect().height)), offscreen: btns.filter(b => b.getBoundingClientRect().right > 390 || b.getBoundingClientRect().left < 0).length }; });
      if (m390.pageW > 392 || m390.offscreen || m390.minBtn < 32) fail("East vacations panel 390px: the page scrolls sideways or a control is off screen / short: " + JSON.stringify(m390)); else ok(`East vacations panel 390px: no horizontal page scroll (${m390.pageW}), every control on screen and >= 32px (${m390.minBtn})`);
      await shotPanel("eastvac-panel-390.png");
      await page.setViewportSize({ width: 1180, height: 900 });
      const setTheme = async (dark) => { await page.click('button[data-tab="settings"]'); await page.click(`button:has-text('${dark ? "Dark" : "Light"}')`); await page.click('button[data-tab="setup"]'); await openCard("setup_east"); await page.waitForSelector("[data-testid=eastvac-list]", { timeout: 8000 }); await page.waitForTimeout(300); };
      await setTheme(true);
      const darkSeg = await page.evaluate(() => {
        const on = document.querySelector("[data-testid=eastvac-card] [data-testid^=eastvac-set-][aria-pressed=true]"); const cs = on ? getComputedStyle(on) : null;
        // the three row markers: each outline must be visible on its row (fix round: the 'away' diamond was drawn in the light text colour and vanished on the dark card)
        const lum = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || ""); if (!m) return null; const c = [m[1], m[2], m[3]].map(v => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const marks = Array.from(document.querySelectorAll("[data-testid=eastvac-card] [data-testid=eastvac-row-mark]")).map(m => { const row = m.closest("[data-testid^=eastvac-range-]"); const a = lum(getComputedStyle(m).borderTopColor), b = lum(getComputedStyle(row).backgroundColor); return { state: row.getAttribute("data-state"), ratio: a === null || b === null ? null : Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 }; });
        return { color: cs ? cs.color : null, bg: cs ? (cs.backgroundImage !== "none" ? cs.backgroundImage : cs.backgroundColor) : null, body: getComputedStyle(document.body).backgroundColor, marks };
      });
      const dimMarks = darkSeg.marks.filter(m => m.ratio === null || m.ratio < 3);
      if (!/rgb\(11, 26, 51\)/.test(darkSeg.body) || darkSeg.color !== "rgb(255, 255, 255)" || !darkSeg.bg || /rgba\(0, 0, 0, 0\)/.test(darkSeg.bg)) fail("East vacations panel dark: body " + darkSeg.body + ", active segment text " + darkSeg.color + " on " + darkSeg.bg + " (expected the navy page and white text on the segment's tone)");
      else if (darkSeg.marks.length !== 3 || dimMarks.length) fail("East vacations panel dark: a row marker's outline is below 3:1 on its row: " + JSON.stringify(darkSeg.marks));
      else ok("East vacations panel dark: navy body, active segment white on its tone (" + String(darkSeg.bg).slice(0, 60) + "), row markers " + darkSeg.marks.map(m => m.state + " " + m.ratio + ":1").join(", "));
      await shotPanel("eastvac-panel-dark.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await shotPanel("eastvac-panel-390-dark.png");
      await page.setViewportSize({ width: 1180, height: 900 });
      await setTheme(false);
      // calendar markers on the three first days (one per state): a diamond - dashed / hollow / filled - and no Silvis dot
      const markerOn = async (d) => { const [y, m] = d.split("-"); await showMonth(Number(y), Number(m) - 1); return page.$eval(`[data-day="${d}"]`, el => { const mk = el.querySelector("[data-eastvac]"); const cs = mk ? getComputedStyle(mk) : null; return { state: mk ? mk.getAttribute("data-eastvac-state") : null, who: mk ? mk.getAttribute("data-eastvac") : null, border: cs ? cs.borderTopStyle : null, bg: cs ? cs.backgroundColor : null, transform: cs ? cs.transform : null, dot: !!el.querySelector("[data-vac=s1]") }; }); };
      const mk = {};
      for (const [st, r] of want) mk[st] = await markerOn(r.start);
      if (want.some(([st]) => !mk[st] || mk[st].state !== st || mk[st].who !== "s1")) fail("calendar East-vacation markers: expected unreviewed / away / home on the three fixture days for s1, got " + JSON.stringify(mk));
      else if (mk.unreviewed.border !== "dashed" || mk.away.border !== "solid" || mk.away.bg !== "rgba(0, 0, 0, 0)" || mk.home.bg === "rgba(0, 0, 0, 0)" || !/matrix/.test(mk.home.transform)) fail("calendar East-vacation markers: unreviewed = dashed, away = hollow, home = filled, all rotated diamonds: " + JSON.stringify(mk));
      else if (Object.values(mk).some(x => x.dot)) fail("calendar East-vacation markers: a Silvis vacation dot for s1 sits on a fixture day (a derived vacation must not write time_off)");
      else ok(`calendar: East-vacation markers ${want.map(([st, r]) => r.start + " " + st).join(", ")} - dashed / hollow / filled diamonds, no Silvis dot`);
      await showMonth(2027, 3);
      await page.screenshot({ path: path.join(OUT, "calendar-eastvac-2027-04.png"), fullPage: false });
      ok("screenshot test/ui/out/calendar-eastvac-2027-04.png");
      // the day editor: the East line with the state; Khan's primary reason glossed; on the home Tuesday he is eligible (Tue lifted)
      await page.click(`[data-day="${EV[0].start}"]`);
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      await page.waitForTimeout(300);
      const evLine = await page.$eval("[data-testid=day-editor] [data-testid=east-status][data-eastvac]", el => ({ st: el.getAttribute("data-eastvac"), text: el.textContent.replace(/\s+/g, " ").trim() })).catch(() => null);
      const pReasons = await page.$eval("[data-testid=editor-primary-reasons]", el => el.textContent.replace(/\s+/g, " ")).catch(() => "");
      const khanOpt = await page.$eval('[data-testid=editor-primary] option[value="s1"]', el => ({ eligible: el.getAttribute("data-eligible"), label: el.textContent })).catch(() => null);
      if (!evLine || evLine.st !== "unreviewed" || !/Khan: East \(Davenport\) vacation, unreviewed - treated as a Silvis vacation/.test(evLine.text)) fail("day editor " + EV[0].start + ": no East-vacation line with state unreviewed: " + JSON.stringify(evLine));
      else if (!khanOpt || khanOpt.eligible !== "false" || !/time-off:/.test(khanOpt.label)) fail("day editor " + EV[0].start + ": Khan should be ineligible for primary with a time-off reason: " + JSON.stringify(khanOpt));
      else if (!/Khan - on vacation \(East vacation, unreviewed/.test(pReasons)) fail("day editor " + EV[0].start + ": Khan's primary reason should read 'on vacation (East vacation, unreviewed ...)': " + pReasons.slice(0, 200));
      else ok(`day editor ${EV[0].start}: East line '${evLine.text.slice(0, 96)}'; Khan ineligible (${khanOpt.label.trim()}) with the East-vacation gloss`);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {});
      await showMonth(2027, 4);
      await page.click(`[data-day="${EV[2].start}"]`);
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      await page.waitForTimeout(300);
      const homeLine = await page.$eval("[data-testid=day-editor] [data-testid=east-status][data-eastvac]", el => ({ st: el.getAttribute("data-eastvac"), text: el.textContent.replace(/\s+/g, " ").trim() })).catch(() => null);
      const khanHome = await page.$eval('[data-testid=editor-primary] option[value="s1"]', el => ({ eligible: el.getAttribute("data-eligible"), label: el.textContent })).catch(() => null);
      const dowHome = new Date(EV[2].start + "T12:00:00Z").getUTCDay();
      if (!homeLine || homeLine.st !== "home" || !/Khan: East \(Davenport\) vacation, home - available at Silvis/.test(homeLine.text)) fail("day editor " + EV[2].start + ": no East-vacation line with state home: " + JSON.stringify(homeLine));
      else if (!khanHome || khanHome.eligible !== "true") fail("day editor " + EV[2].start + " (a " + ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dowHome] + "): Khan should be ELIGIBLE for primary on a home day (the Tue/Thu rule lifted): " + JSON.stringify(khanHome));
      else ok(`day editor ${EV[2].start} (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dowHome]}): East line '${homeLine.text.slice(0, 80)}'; Khan eligible for primary (${khanHome.label.trim()})`);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {});
      // the coverage strip: 'unreviewed East vacations: 1 (Khan)' - the one range without a row - opens Setup > East feed
      const stripCount = await page.getAttribute("[data-testid=cov-eastvac-unreviewed]", "data-count").catch(() => null);
      const stripText = await page.$eval("[data-testid=cov-eastvac-unreviewed]", el => el.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
      if (stripCount !== "1" || !/unreviewed East vacations: 1 \(Khan\)/.test(stripText)) fail(`coverage strip: 'unreviewed East vacations' should read 1 (Khan) - the one fixture range without a review row: count '${stripCount}', text '${stripText}'`);
      else {
        // fix round: openCard above left the card open (its flag persisted as '1'), so the click has to be what opens
        // it - collapse the flag first (Collapsible reads it when the Setup view mounts) and assert it flips to '1'.
        await page.evaluate(() => { try { localStorage.setItem("silvis-collapse-setup_east", "0"); } catch (e) {} });
        const flagBefore = await page.evaluate(() => { try { return localStorage.getItem("silvis-collapse-setup_east"); } catch (e) { return null; } });
        await page.click("[data-testid=cov-eastvac-unreviewed]");
        await page.waitForTimeout(500);
        const opened = await page.getAttribute("[data-testid=card-setup_east]", "data-open").catch(() => null);
        const listThere = await page.$("[data-testid=eastvac-list]");
        if (flagBefore !== "0" || opened !== "1" || !listThere) fail("coverage strip: the count did not open Setup > East feed with the panel (collapse flag before the click '" + flagBefore + "', card-setup_east data-open=" + opened + ")"); else ok("coverage strip: 'unreviewed East vacations: 1 (Khan)' opens Setup > East feed with the panel open (the card's collapse flag was '0' before the click)");
      }
      // My schedule and the Time off view list the same three decisions
      await page.click('button[data-tab="myschedule"]');
      await page.waitForSelector("[data-testid=mine-eastvac]", { timeout: 8000 });
      const mineRs = await readRanges("[data-testid=mine-eastvac-list]");
      if (!listOk(mineRs)) fail("My schedule: the East vacation list should show the 3 ranges with their decisions: " + JSON.stringify(mineRs.map(x => x.start + " " + x.state))); else ok("My schedule: own East (Davenport) vacations listed with decisions - " + mineRs.map(x => x.start + " " + x.state).join(", "));
      // Item B: the one-person view (My schedule > My vacations) lists just the compact lines - no per-surgeon header - and
      // the list agrees with the card title "My vacations (N upcoming)". (Not tied to the range added in the Time off step:
      // the harness answers the poll's time_off read with the fixture rows, so that row may already be gone here.) Read from
      // textContent: css.cardT is text-transform uppercase, so innerText hands back MY VACATIONS (N UPCOMING).
      const mineVac = await page.$eval("[data-testid=mine-vacations]", el => ({ headers: el.querySelectorAll("[data-testid^=vac-group-]").length, lines: Array.from(el.querySelectorAll("[data-testid^=vac-line-]")).map(l => l.getAttribute("data-testid")), title: (el.textContent.match(/My vacations \((\d+) upcoming\)/) || [])[1] || null, empty: /No upcoming vacations\./.test(el.textContent) })).catch(() => null);
      if (!mineVac) fail("Item B My schedule: the My vacations card (mine-vacations) is missing");
      else if (mineVac.headers) fail(`Item B My schedule: the one-person view renders ${mineVac.headers} per-surgeon header(s)`);
      else if (mineVac.title === null || +mineVac.title !== mineVac.lines.length || mineVac.empty !== (mineVac.lines.length === 0) || mineVac.lines.some(t => !t.startsWith("vac-line-s1-"))) fail(`Item B My schedule: the title says ${mineVac.title} upcoming but ${mineVac.lines.length} line(s) are listed (${mineVac.lines.join(", ")}); 'No upcoming vacations' shown: ${mineVac.empty}`);
      else if (mineVac.lines.length === 0) ok(`Item B My schedule: My vacations (0 upcoming) shows 'No upcoming vacations.' for Khan - the fixture holds no upcoming s1 range and the Time off step's add is gone on the poll, so the one-person header absence is NOT exercised on a rendered page here (proven by the data-layer pin 'withHeader = personIds.length > 1')`);
      else ok(`Item B My schedule: My vacations (${mineVac.title} upcoming) lists ${mineVac.lines.length} compact line(s) for Khan and no per-surgeon header`);
      await page.screenshot({ path: path.join(OUT, "mine-eastvac.png"), fullPage: true });
      ok("screenshot test/ui/out/mine-eastvac.png");
      await page.click('button[data-tab="timeoff"]');
      await page.waitForSelector("[data-testid=eastvac-timeoff]", { timeout: 8000 });
      const toRs = await readRanges("[data-testid=eastvac-timeoff-list]");
      if (!listOk(toRs)) fail("Time off view: the East vacation list should show the 3 ranges with their decisions: " + JSON.stringify(toRs.map(x => x.start + " " + x.state))); else ok("Time off view: East (Davenport) vacations listed with the same three decisions");
      const toText = await page.$eval("[data-testid=eastvac-timeoff]", el => el.innerText);
      if (!noAddress(toText)) fail("Time off view: the East vacation card renders an email address");
      // ---- Refresh resets (fix round, E3 review finding 1): a Davenport range that MOVED or DISAPPEARED deletes the
      //      person's review row through the same write path (DELETE by the exact old triple, audit eastvac.review reset with
      //      the reason changed / removed) and the ONE refresh toast names both; an unchanged range keeps its row. Fixture:
      //      EV[0] gets an away row first (the row that must survive), then the mocked Davenport time_off and the east_feed
      //      overlay the reload reads answer EV[0] unchanged, EV[1] ending one day later (changed) and EV[2] gone (removed).
      {
        await page.click('button[data-tab="setup"]');
        await openCard("setup_east");
        await page.waitForSelector("[data-testid=eastvac-list]", { timeout: 8000 });
        await page.click(`${row0} [data-testid=eastvac-set-away]`);
        await waitFor(async () => (await page.getAttribute(row0, "data-state")) === "away", 8000);
        await page.waitForTimeout(300);
        const md = (d) => Number(d.slice(5, 7)) + "/" + Number(d.slice(8, 10));
        const moved = { start: EV[1].start, end: "2027-04-24" };
        eastVacFeed = [EV[0], moved];
        const beforeR = writes.length;
        await page.click("[data-testid=east-refresh]");
        await waitFor(() => !!auditSince(beforeR, "east.refresh"), 20000);
        await page.waitForTimeout(600);
        const dels = writesSince(beforeR, "/rest/v1/east_vacation_reviews").filter(w => w.method === "DELETE").map(w => w.path);
        const resetAudits = writesSince(beforeR, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "eastvac.review");
        const refreshAudit = auditSince(beforeR, "east.refresh");
        const toastR = await bodyText();
        const wantDel = [`/rest/v1/east_vacation_reviews?person_id=eq.s1&start=eq.${EV[1].start}&end=eq.${EV[1].end}`, `/rest/v1/east_vacation_reviews?person_id=eq.s1&start=eq.${EV[2].start}&end=eq.${EV[2].end}`];
        const wantToast = `East vacation review(s) reset: ${md(EV[1].start)}-${md(EV[1].end)} (was away; dates changed), ${md(EV[2].start)}-${md(EV[2].end)} (was home; removed from Davenport).`;
        const keptRow = eastVacReviewStore.find(r => r.person_id === "s1" && r.start === EV[0].start && r.end === EV[0].end);
        const afterRs = await readRanges("[data-testid=eastvac-list]");
        const st = (s, e) => (afterRs.find(x => x.start === s && (!e || x.end === e)) || {}).state;
        if (dels.length !== 2 || wantDel.some(p => dels.indexOf(p) < 0)) fail("East refresh reset: expected exactly two east_vacation_reviews DELETEs by the exact old triples (" + wantDel.join(" and ") + "), saw " + JSON.stringify(dels));
        else if (!keptRow || keptRow.decision !== "away") fail("East refresh reset: the UNCHANGED range " + EV[0].start + ".." + EV[0].end + " must keep its away row - store has " + JSON.stringify(keptRow || null));
        else if (resetAudits.length !== 2 || !resetAudits.some(a => a.detail && a.detail.decision === "reset" && a.detail.reason === "changed" && a.detail.start === EV[1].start && a.detail.end === EV[1].end && a.detail.removed === 1) || !resetAudits.some(a => a.detail && a.detail.decision === "reset" && a.detail.reason === "removed" && a.detail.start === EV[2].start && a.detail.end === EV[2].end && a.detail.removed === 1)) fail("East refresh reset: expected two audit eastvac.review rows { decision reset, reason changed / removed, removed 1 }: " + JSON.stringify(resetAudits.map(a => a.detail)));
        else if (toastR.indexOf(wantToast) < 0) fail("East refresh reset: the refresh toast must name both resets - wanted '" + wantToast + "' in: " + (toastR.match(/East feed refreshed[^\n]*/) || [toastR.slice(0, 300)])[0]);
        else if (!refreshAudit || !refreshAudit.detail || !Array.isArray(refreshAudit.detail.reviewResets) || refreshAudit.detail.reviewResets.length !== 2 || (refreshAudit.detail.reviewResetFailures || []).length) fail("East refresh reset: audit east.refresh detail.reviewResets should list the 2 resets (no failures): " + JSON.stringify(refreshAudit && refreshAudit.detail && { reviewResets: refreshAudit.detail.reviewResets, reviewResetFailures: refreshAudit.detail.reviewResetFailures }));
        else if (afterRs.length !== 2 || st(EV[0].start, EV[0].end) !== "away" || st(moved.start, moved.end) !== "unreviewed") fail("East refresh reset: the panel should now list " + EV[0].start + " away and the moved range " + moved.start + ".." + moved.end + " unreviewed: " + JSON.stringify(afterRs.map(x => x.start + ".." + x.end + " " + x.state)));
        else ok(`East refresh reset: ${EV[1].start}..${EV[1].end} moved + ${EV[2].start}..${EV[2].end} removed from Davenport -> 2 DELETEs by the exact old triples + 2 audit eastvac.review resets (changed / removed, removed 1 each); toast '${wantToast}'; the unchanged ${EV[0].start} range kept its away row; panel lists 2 ranges (away, moved unreviewed)`);
        eastVacFeed = EASTVAC_RANGES; // restore for whatever follows (the app's cache picture follows on its next reload)
      }
      await page.click('button[data-tab="setup"]');
      await page.waitForTimeout(300);
    } catch (e) { fail("East vacations (Prompt 15 part 3) harness exception: " + errLine(e)); try { await page.screenshot({ path: path.join(OUT, "failure-eastvac.png"), fullPage: true }); } catch (e2) {} eastVacFeed = EASTVAC_RANGES; await page.setViewportSize({ width: 1180, height: 900 }).catch(() => {}); }

    // ---- Generate: the default range STARTS at the first open slot on or after today (Central) - Faraz 9/22
    //      late, Prompt 12 AB (decided 9/22 late; the wave-7 open question "the default start may change to the
    //      first open slot from today" is closed: "locks are never touched, so starting at the first gap is safe
    //      and catches the October opens and any 11/5-type hole in one run"); before AB it started after the LAST
    //      PUBLISHED day (end of the longest contiguous block of rows, finding wire-1), which is now the fallback,
    //      clamped to today (AB review: a past day is never a start, item Q). Item SM: the
    //      expectation is DERIVED each run from the harness's picture of the map (the live rows + the grid as
    //      observed for this run's own edits by settleMapToLive() just above - poll-independent; see curDay) by
    //      an independent restatement of the app's rules (helpers.js suFirstOpenSlotDay / suLastContiguousDay /
    //      suLaterAssignedRanges, generator.js rangePresets - none of them called here):
    //        firstOpen = the first day d, from max(today, first row day) through the last row day, such that d has
    //                  no row (a missing day inside the saved span) or its row leaves PRIMARY open (no holder and
    //                  no external cover - a cover stands in for the primary only) or BACKUP open; a day before
    //                  today is never a candidate (item Q), nor is a day after the last row
    //        lastPub = the last day of the LONGEST run of consecutive days that have a row (a row with both
    //                  slots open still counts: it is a published row); ties go to the later run
    //        start   = firstOpen, or max(lastPub + 1 day, today) when nothing is open on/after today (the pre-AB
    //                  rule, never a past day)
    //        'Through end of year' ends on the Sunday on/after Dec 31 of start's year
    //        '3 months' ends on the last day of the 3rd calendar month counting start's month as month 1
    //                  ('end of the third month'), pushed to the following Sunday when that day is a Fri or Sat
    //        'Days with a held slot from the start on' = the assigned days (either role or external cover) on or
    //                  after start, collapsed into M/D-M/D ranges in date order (a holiday name may follow in
    //                  parentheses); an open slot beside a held one is in the list (the run fills it), hence not
    //                  "locked days"
    //      On the 73 rows of the 9/22 import, run on 9/22: the first open October backup, 2026-10-07 (10/7, 10/9,
    //      10/10, 10/11, 10/13 backups precede the open 10/15 primary); nothing here encodes that date. ----
    // Premise first (review finding on SM): the app's map must be known, not assumed, before deriving. Nothing
    // between here and the Accept & Publish pin edits the map, and the app's polls only reconcile it toward
    // the live rows, so the picture settled here also serves the write-set derivation below.
    await settleMapToLive("live-state premise");
    await page.click('button[data-tab="setup"]');
    await page.waitForTimeout(300);
    await openCard("setup_generate");
    let genRangeStart = null; // SM2: the derived default start, reused as the preview range's start below
    {
      const rowDays = curDays();
      const rowSet = new Set(rowDays);
      let lastPub = null, bestLen = 0, runStart = 0;
      for (let i = 1; i <= rowDays.length; i++) {
        if (i < rowDays.length && isoAddDays(rowDays[i - 1], 1) === rowDays[i]) continue;
        const len = i - runStart;
        if (len >= bestLen) { bestLen = len; lastPub = rowDays[i - 1]; }
        runStart = i;
      }
      const spanFirst = rowDays[0], spanLast = rowDays[rowDays.length - 1];
      let firstOpen = null;
      for (let d = todayCentral > spanFirst ? todayCentral : spanFirst; d <= spanLast; d = isoAddDays(d, 1)) {
        if (!rowSet.has(d) || !curHolder(d, "primary") || !curHolder(d, "backup")) { firstOpen = d; break; }
      }
      const dowOf = (d) => new Date(d + "T12:00:00Z").getUTCDay(); // 0 = Sun
      const sundayOnOrAfter = (d) => isoAddDays(d, (7 - dowOf(d)) % 7);
      const expFallback = isoAddDays(lastPub, 1) > todayCentral ? isoAddDays(lastPub, 1) : todayCentral; // never a past day (item Q)
      const expStart = firstOpen || expFallback;
      genRangeStart = expStart;
      const expTeoyEnd = sundayOnOrAfter(expStart.slice(0, 4) + "-12-31");
      const sy = +expStart.slice(0, 4), sm = +expStart.slice(5, 7);
      const idx3 = sm + 2, ey = sy + Math.floor((idx3 - 1) / 12), em = ((idx3 - 1) % 12) + 1; // 1-based month of the 3rd calendar month
      let exp3End = utcDay(Date.UTC(ey, em, 0)); // day 0 of the following month = the last day of month em
      if (dowOf(exp3End) === 5 || dowOf(exp3End) === 6) exp3End = sundayOnOrAfter(exp3End);
      const laterDays = rowDays.filter(d => d >= expStart && (curHolder(d, "primary") || curHolder(d, "backup")));
      const laterRanges = [];
      laterDays.forEach(d => { const r = laterRanges[laterRanges.length - 1]; if (r && isoAddDays(r.end, 1) === d) r.end = d; else laterRanges.push({ start: d, end: d }); });
      const laterLabel = (r) => r.start === r.end ? mdOf(r.start) : mdOf(r.start) + "-" + mdOf(r.end);
      const laterRx = laterRanges.length ? new RegExp("Days with a held slot from the start on: " + laterRanges.map(r => laterLabel(r).replace(/\//g, "\\/") + "( \\([^)]*\\))?").join(", ") + " - locked slots stay as they are while 'respect locks' is on; the open slots on those days are filled") : null;
      const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sentenceRx = firstOpen
        ? new RegExp(rxEsc(`Range starts at the first open slot on or after today: ${expStart} (locks are never touched; the run fills every open slot from there and generates the rest). Last saved day (end of the contiguous block): ${lastPub}.`))
        : new RegExp(rxEsc(`No open slot on or after today - the range starts the day after the last saved day (end of the contiguous block: ${lastPub}), or today when that day has passed: ${expStart}.`));
      console.log(`     (derived from the ${rowDays.length} live row days ${spanFirst}..${spanLast}: first open slot on/after today ${todayCentral} = ${firstOpen || "none"}; longest contiguous block of ${bestLen} row(s) ends ${lastPub} -> default start ${expStart}; held-slot ranges from the start on: ${laterRanges.map(laterLabel).join(", ") || "none"})`);
      const teoy = await page.getAttribute("[data-testid=gen-preset-through-end-of-year]", "title");
      const three = await page.getAttribute("[data-testid=gen-preset-3-months]", "title");
      const startDefault = await page.$eval("[data-testid=gen-start]", el => el.value);
      const endDefault = await page.$eval("[data-testid=gen-end]", el => el.value);
      const lp = await page.$eval("[data-testid=gen-last-published]", el => el.textContent);
      const genStartAttr = await page.getAttribute("[data-testid=gen-last-published]", "data-gen-start");
      // sanity on the derivation itself: a first open slot lies on/after today inside the rows' span; the fallback lies
      // inside the span + 1 day, or IS today when the span already lies behind us (the clamp) - never before today
      const sane = firstOpen ? (firstOpen >= todayCentral && firstOpen >= spanFirst && firstOpen <= spanLast) : (!!lastPub && expStart >= todayCentral && expStart > spanFirst && (expStart <= isoAddDays(spanLast, 1) || expStart === todayCentral));
      if (!sane) fail(`Generate presets: the harness's derived start ${expStart} (first open ${firstOpen || "none"}, today ${todayCentral}) is outside the live rows' span ${spanFirst}..${spanLast} or before today - the restatement is broken`);
      else if (teoy !== `${expStart} to ${expTeoyEnd}` || three !== `${expStart} to ${exp3End}` || startDefault !== expStart || endDefault !== expTeoyEnd || genStartAttr !== expStart) fail(`Generate presets: expected the default start ${expStart} (${firstOpen ? "first open slot on/after today " + todayCentral : "no open slot on/after today; the day after the longest contiguous block, which ends " + lastPub + ", clamped to today " + todayCentral}), 'Through end of year' = ${expStart} to ${expTeoyEnd} (default range), '3 months' = ${expStart} to ${exp3End} and data-gen-start=${expStart}, got teoy=${teoy} 3m=${three} start=${startDefault} end=${endDefault} data-gen-start=${genStartAttr}`);
      else if (!sentenceRx.test(lp) || (laterRx ? !laterRx.test(lp) : /Days with a held slot from the start on/.test(lp))) fail(`Generate panel text: expected ${firstOpen ? "'Range starts at the first open slot on or after today: " + expStart + " ... Last saved day (end of the contiguous block): " + lastPub + ".'" : "'No open slot on or after today - the range starts the day after the last saved day (end of the contiguous block: " + lastPub + "), or today when that day has passed: " + expStart + ".'"} and ${laterRanges.length ? "'Days with a held slot from the start on: " + laterRanges.map(laterLabel).join(", ") + " - locked slots stay as they are ...'" : "no 'Days with a held slot' phrase"}: ` + lp);
      else ok(`Generate presets: default start ${expStart} = ${firstOpen ? "the first open slot on/after today " + todayCentral : "the day after the longest contiguous block, clamped to today (nothing open on/after today " + todayCentral + ")"}; 'Through end of year' = ${expStart} to ${expTeoyEnd} is the default range, 3 months = ${expStart} to ${exp3End}, data-gen-start agrees (all derived from the live rows; last contiguous saved day ${lastPub}); panel names the start, the last saved day and the held-slot ranges from the start on ${laterRanges.map(laterLabel).join(", ") || "(none)"}`);
    }

    // ---- Accept with 'respect locks' OFF over the locked import (10/5-10/11): a confirm BEFORE any write;
    //      dismissed -> zero writes (no snapshot, no schedule_days), preview kept (finding safe-2) ----
    {
      await page.fill("[data-testid=gen-start]", "2026-10-05");
      await page.fill("[data-testid=gen-end]", "2026-10-11");
      await page.fill("[data-testid=gen-n]", "3");
      await page.fill("[data-testid=gen-seed]", "7");
      await page.uncheck("[data-testid=gen-respect-locks]");
      await page.click("[data-testid=gen-run]");
      await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 90000 });
      await page.waitForTimeout(500);
      const dialogs = [];
      const onDlg = (d) => { dialogs.push(d.message()); d.dismiss(); };
      page.on("dialog", onDlg);
      const before = writes.length;
      await page.click("[data-testid=gen-accept]");
      await page.waitForTimeout(1500);
      page.off("dialog", onDlg);
      const bad = writesSince(before).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|audit_log)/.test(w.path));
      const kept = await page.$("[data-testid=gen-preview]");
      const txt = await bodyText();
      if (dialogs.length !== 1 || !/This replaces \d+ locked \/ published slot\(s\)/.test(dialogs[0]) || !/'respect locks' OFF/.test(dialogs[0])) fail("Accept (respect locks off): expected one confirm naming the locked / published slots and the OFF checkbox, got " + JSON.stringify(dialogs));
      else if (bad.length) fail("Accept (respect locks off, confirm dismissed): something was written: " + JSON.stringify(bad.map(w => w.method + " " + w.path)));
      else if (!kept || !/Nothing was written - the preview is kept/.test(txt)) fail(`Accept (respect locks off, dismissed): preview kept=${!!kept}, toast=${/Nothing was written/.test(txt)}`);
      else ok(`Accept with 'respect locks' OFF over 10/5-10/11: confirm BEFORE any write ("${dialogs[0].split("\n")[0].slice(0, 110)}"); dismissed -> zero snapshot / schedule_days / audit writes, preview kept`);
      await page.click("[data-testid=gen-discard]");
      await page.waitForSelector("[data-testid=gen-preview]", { state: "detached", timeout: 3000 });
      await page.check("[data-testid=gen-respect-locks]");
    }

    // RF2 c: the 'Fill open slots only' checkbox exists, is OFF by default, and the Seed field says where the seed shows
    {
      const foo = await page.$("[data-testid=gen-fill-open-only]");
      const fooChecked = foo ? await foo.isChecked().catch(() => null) : null;
      const seedPh = await page.getAttribute("[data-testid=gen-seed]", "placeholder");
      if (!foo) fail("RF2 GeneratePanel: no [data-testid=gen-fill-open-only] checkbox");
      else if (fooChecked !== false) fail("RF2 GeneratePanel: 'Fill open slots only' must be OFF by default, isChecked=" + fooChecked);
      else if (seedPh !== "random - the toast shows the seed") fail("RF2 GeneratePanel: Seed placeholder is " + JSON.stringify(seedPh));
      else ok("RF2 GeneratePanel: 'Fill open slots only (keep every held day)' checkbox present and OFF by default; Seed placeholder 'random - the toast shows the seed'");
    }

    // ---- Prompt 14 part 3b (U3b): Periods inside the Generate card ----
    // The status table of the seed period equals an INDEPENDENT restatement of SQL offer_status() over the harness's
    // own stores (call_offers + call_periods as they stand after the painter section: submitted = a row inside the
    // period, else rules_only if listed, else not_started) with Remind on the not_started rows only while the
    // period is still open (close > today, status upcoming); Remind on one of them = exactly ONE POST
    // functions/v1/send-notification { type offers_reminder, targetIds [id], data.subject / message naming the
    // label and the close date } and nothing else; New period -> a start inside the seed period is refused with
    // zero writes; the 3-month preset fills end / close / publish / label = the harness's own date maths (last day
    // of the 3rd calendar month, Fri/Sat -> the following Sunday; start - 42 / - 28 days); Create = ONE POST
    // call_periods (return=representation) + ONE audit period.create and nothing else, the new box renders all six
    // not_started; Close now dismissed = zero writes, confirmed = ONE compare-and-swap PATCH
    // ?id=eq.<id>&status=eq.upcoming { status closed } + ONE audit period.close, the box reads closed with no Remind
    // / Close now; "Enter for <name>" opens the painter as that surgeon, relayed, targeted at THAT period and opened
    // on its first month; "Generate this period" runs the existing flow with the period's range (N=3, no writes,
    // then Discard). Screenshots at 1180 and 390 in both themes: periods-desktop.png, periods-390.png,
    // periods-desktop-dark.png, periods-390-dark.png.
    try {
      let prdDismissNext = false;
      const prdDialogs = [];
      const onPrdDialog = (d) => { prdDialogs.push(d.message()); if (prdDismissNext) { prdDismissNext = false; d.dismiss(); } else d.accept(); };
      page.on("dialog", onPrdDialog);
      try {
        const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const IDS = ["s1", "s2", "s3", "s4", "s5", "s6"];
        const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
        const sundayOnOrAfter = (d) => isoAddDays(d, (7 - dow(d)) % 7);
        // The Remind e-mail spells its dates like the morning run (daily-reminder fmtDay: "Friday, Oct 2") - restated here.
        const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const dayWords = (d) => `${DOW_FULL[dow(d)]}, ${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
        const SELF = FAKE_PROFILE.person_id; // the harness signs in as the scheduler s1: his own row reads "Paint my offers"
        const per = periodStore[0];
        if (!per) throw new Error("the seed carries no offerPeriods[0] - nothing to read the table against");
        const inPer = (o, p) => o.day >= p.start_day && o.day <= p.end_day;
        const expStatus = (id, p) => offerStore.some(o => o.person_id === id && inPer(o, p)) ? "submitted" : (p.rules_only_ids || []).includes(id) ? "rules_only" : "not_started";
        const expOffered = (id, p) => new Set(offerStore.filter(o => o.person_id === id && inPer(o, p)).map(o => o.day)).size;
        const isOpen = (p) => (p.status || "upcoming") === "upcoming" && p.offers_close_at > todayCentral;
        const boxSel = (id) => `[data-testid=prd-period][data-period-id="${id}"]`;
        const readBox = (id) => page.$eval(boxSel(id), el => ({ status: el.getAttribute("data-status"), label: el.querySelector("[data-testid=prd-label-text]").textContent.trim(), pill: el.querySelector("[data-testid=prd-status]").textContent.trim(), closeNow: !!el.querySelector("[data-testid=prd-close-now]"), remind: Array.from(el.querySelectorAll("[data-testid=prd-remind]")).map(b => b.closest("tr").getAttribute("data-person")), rows: Array.from(el.querySelectorAll("[data-testid=prd-row]")).map(r => ({ id: r.getAttribute("data-person"), status: r.getAttribute("data-status"), offered: Number(r.getAttribute("data-offered")), text: r.innerText.replace(/\s+/g, " ").trim(), enter: (r.querySelector("[data-testid=prd-enter-for]") || {}).textContent || "" })) }));
        await page.waitForSelector("[data-testid=periods-section]", { timeout: 5000 });
        await page.waitForSelector(boxSel(per.id), { timeout: 5000 });
        // (a) the seed period's table against the stores
        const box0 = await readBox(per.id);
        const wrong0 = IDS.map(id => { const r = box0.rows.find(x => x.id === id); const es = expStatus(id, per), eo = expOffered(id, per); return !r ? `${id}: missing` : (r.status !== es || r.offered !== eo) ? `${id}: ${r.status}/${r.offered}, expected ${es}/${eo}` : null; }).filter(Boolean);
        const expRemind = isOpen(per) ? IDS.filter(id => expStatus(id, per) === "not_started") : [];
        const wordsOk = box0.rows.every(r => (r.status === "submitted" && new RegExp(`submitted ${r.offered} days?`).test(r.text)) || (r.status === "rules_only" && /rules only/.test(r.text) && / - /.test(r.text)) || (r.status === "not_started" && /not started/.test(r.text)));
        // the scheduler's own row offers "Paint my offers" (his own offers: entered_by him, source app); every other row "Enter for <name>" (relayed)
        const enterOk = box0.rows.every(r => r.id === SELF ? r.enter.trim() === "Paint my offers" : /^Enter for \S+/.test(r.enter.trim()));
        if (box0.rows.length !== 6 || wrong0.length) fail(`Periods: the ${per.label} table differs from the stores: ${wrong0.join("; ") || box0.rows.length + " rows"}`);
        else if (box0.label !== per.label || box0.status !== (per.status || "upcoming") || !wordsOk) fail(`Periods: box header / words off for ${per.label}: ${JSON.stringify({ label: box0.label, status: box0.status, pill: box0.pill, rows: box0.rows.map(r => r.text) })}`);
        else if (!enterOk) fail(`Periods: the scheduler's own row (${SELF}) must read 'Paint my offers' and every other row 'Enter for <name>': ${JSON.stringify(box0.rows.map(r => r.id + ": " + r.enter.trim()))}`);
        else if (JSON.stringify(box0.remind) !== JSON.stringify(expRemind)) fail(`Periods: Remind must appear on the not_started rows only while the period is open (expected ${JSON.stringify(expRemind)}, got ${JSON.stringify(box0.remind)})`);
        else ok(`Periods: ${per.label} (${box0.pill}) = ${IDS.map(id => id + " " + expStatus(id, per) + (expStatus(id, per) === "submitted" ? " " + expOffered(id, per) + "d" : "")).join(", ")}; Remind on ${expRemind.length ? expRemind.join(", ") : "nobody (frozen)"} only; ${SELF}'s row 'Paint my offers', the others 'Enter for <name>'`);
        // (b) Remind on a not_started surgeon = ONE send-notification offers_reminder and nothing else
        if (expRemind.length) {
          const who = expRemind[0];
          const b0 = writes.length;
          await page.click(`${boxSel(per.id)} [data-testid=prd-row][data-person=${who}] [data-testid=prd-remind]`);
          await waitFor(() => writesSince(b0).some(w => /send-notification/.test(w.path)), 8000);
          await page.waitForTimeout(400);
          const mails = writesSince(b0).filter(w => /send-notification/.test(w.path)).map(bodyOf);
          const others = writesSince(b0).filter(w => !/send-notification/.test(w.path));
          const m = mails[0];
          const note = await page.$eval(`${boxSel(per.id)} [data-testid=prd-row][data-person=${who}] [data-testid=prd-remind-note]`, el => el.textContent.trim()).catch(() => null);
          if (mails.length !== 1 || !m || m.type !== "offers_reminder" || JSON.stringify(m.targetIds) !== JSON.stringify([who])) fail(`Periods Remind: expected exactly ONE send-notification { type offers_reminder, targetIds [${who}] }: ${JSON.stringify(mails).slice(0, 400)}`);
          else if (!m.data || String(m.data.subject) !== `Your call dates for ${per.label} freeze on ${dayWords(per.offers_close_at)}` || !String(m.data.message).includes(`(${dayWords(per.start_day)} to ${dayWords(per.end_day)}) freeze on ${dayWords(per.offers_close_at)}`) || !/paint them in the app or choose 'go by my rules'/.test(String(m.data.message)) || !/#offers$/.test(String(m.data.detail))) fail(`Periods Remind: the composed words must be the morning run's - subject 'Your call dates for ${per.label} freeze on ${dayWords(per.offers_close_at)}', message '(<start> to <end>) freeze on <close>' in the same "Friday, Oct 2" spelling + the painter hint, the #offers deep link as detail: ` + JSON.stringify(m.data).slice(0, 400));
          else if (others.length) fail("Periods Remind: nothing but the e-mail call may be written: " + JSON.stringify(others.map(w => w.method + " " + w.path)));
          else if (!noAddress(m)) fail("Periods Remind: the payload carries an e-mail address");
          else if (!note || !/^reminded /.test(note)) fail(`Periods Remind: the row should read 'reminded <time>' after the 200, got ${JSON.stringify(note)}`);
          else ok(`Periods Remind (${who}): ONE send-notification offers_reminder -> targetIds [${who}], subject "${m.data.subject}", nothing else written; row reads '${note}'`);
        } else console.log(`     (today ${todayCentral} is past ${per.label}'s close ${per.offers_close_at} - the Remind call is exercised on the new period below)`);
        // (c) New period: a start inside the seed period is refused with zero writes; the 3-month preset fills the dates
        const expDefaultStart = isoAddDays(per.end_day, 1) > todayCentral ? isoAddDays(periodStore.slice().sort((a, b) => a.start_day < b.start_day ? -1 : 1).pop().end_day, 1) : todayCentral;
        await page.click("[data-testid=prd-new]");
        await page.waitForSelector("[data-testid=prd-form]", { timeout: 3000 });
        const startDefault = await page.$eval("[data-testid=prd-start]", el => el.value);
        const bRef = writes.length;
        await page.fill("[data-testid=prd-start]", per.start_day);
        await page.click("[data-testid=prd-create]");
        await page.waitForTimeout(300);
        const refusal = await page.$eval("[data-testid=prd-form-error]", el => el.textContent.trim()).catch(() => null);
        if (startDefault !== expDefaultStart) fail(`Periods form: the default start should be the day after the last period (${expDefaultStart}), got ${startDefault}`);
        else if (!refusal || !/already starts on|overlaps/.test(refusal) || writesSince(bRef).length) fail(`Periods form: a start inside ${per.label} must be refused client-side with zero writes (error ${JSON.stringify(refusal)}, writes ${writesSince(bRef).length})`);
        else ok(`Periods form: default start ${startDefault}; a start on ${per.start_day} refused ("${refusal.slice(0, 70)}") with zero writes`);
        await page.fill("[data-testid=prd-start]", expDefaultStart);
        await page.click("[data-testid=prd-preset-3]");
        await page.waitForTimeout(150);
        const f = await page.evaluate(() => ({ label: document.querySelector("[data-testid=prd-label]").value, start: document.querySelector("[data-testid=prd-start]").value, end: document.querySelector("[data-testid=prd-end]").value, close: document.querySelector("[data-testid=prd-close]").value, publish: document.querySelector("[data-testid=prd-publish]").value }));
        const sy = +expDefaultStart.slice(0, 4), sm = +expDefaultStart.slice(5, 7);
        const idx3 = sm + 2, ey = sy + Math.floor((idx3 - 1) / 12), em = ((idx3 - 1) % 12) + 1;
        let expEnd = utcDay(Date.UTC(ey, em, 0));
        if (dow(expEnd) === 5 || dow(expEnd) === 6) expEnd = sundayOnOrAfter(expEnd);
        const expClose = isoAddDays(expDefaultStart, -42), expPublish = isoAddDays(expDefaultStart, -28);
        const expLabel = `${MON[sm - 1]} ${sy} - ${MON[+expEnd.slice(5, 7) - 1]} ${expEnd.slice(0, 4)}`;
        if (f.start !== expDefaultStart || f.end !== expEnd || f.close !== expClose || f.publish !== expPublish || f.label !== expLabel) fail(`Periods form (3-month preset from ${expDefaultStart}): expected end ${expEnd}, close ${expClose}, publish ${expPublish}, label '${expLabel}'; got ${JSON.stringify(f)}`);
        else ok(`Periods form: 3-month preset from ${expDefaultStart} -> end ${f.end}, offers close ${f.close} (start - 6 weeks), publish by ${f.publish} (start - 4 weeks), label '${f.label}'`);
        // (c2) a hand-set close date survives a nudged Start (only untouched fields re-derive); the draft survives the
        // card being collapsed and reopened (it is CallSchedule state, not the section's); a preset click resets all
        const readForm = () => page.evaluate(() => ({ label: document.querySelector("[data-testid=prd-label]").value, start: document.querySelector("[data-testid=prd-start]").value, end: document.querySelector("[data-testid=prd-end]").value, close: document.querySelector("[data-testid=prd-close]").value, publish: document.querySelector("[data-testid=prd-publish]").value }));
        const handClose = isoAddDays(expClose, -7), nudged = isoAddDays(expDefaultStart, 1);
        await page.fill("[data-testid=prd-close]", handClose);
        await page.fill("[data-testid=prd-start]", nudged);
        await page.waitForTimeout(150);
        const f2 = await readForm();
        const bCol = writes.length;
        await page.click("[data-testid=card-toggle-setup_generate]");
        await page.waitForTimeout(200);
        const formGone = (await page.$("[data-testid=prd-form]")) === null;
        await page.click("[data-testid=card-toggle-setup_generate]");
        await page.waitForSelector("[data-testid=prd-form]", { timeout: 3000 }).catch(() => null);
        const f3 = await readForm().catch(() => null);
        await page.click("[data-testid=prd-preset-3]");
        await page.waitForTimeout(150);
        const f4 = await readForm();
        if (f2.close !== handClose || f2.start !== nudged || f2.publish !== isoAddDays(nudged, -28) || f2.label !== expLabel) fail(`Periods form: after a hand-set close ${handClose} and Start nudged to ${nudged}, the close must survive and only publish (start - 4 weeks) re-derive; got ${JSON.stringify(f2)}`);
        else if (!formGone || !f3 || f3.close !== handClose || f3.start !== nudged || writesSince(bCol).length) fail(`Periods form: collapsing the Generate card must keep the draft (form hidden while closed, back with close ${handClose} / start ${nudged} when reopened, zero writes); got hidden=${formGone}, ${JSON.stringify(f3)}, writes ${writesSince(bCol).length}`);
        else if (f4.close !== isoAddDays(nudged, -42) || f4.start !== nudged || f4.publish !== isoAddDays(nudged, -28)) fail(`Periods form: a preset click must refill every date from the rules (close ${isoAddDays(nudged, -42)}), got ${JSON.stringify(f4)}`);
        else ok(`Periods form: hand-set close ${handClose} survived Start -> ${nudged} (publish re-derived ${f2.publish}); the draft survived the card collapsing / reopening; the 3-month preset refilled every date`);
        await page.fill("[data-testid=prd-start]", expDefaultStart);
        await page.click("[data-testid=prd-preset-3]");
        await page.waitForTimeout(150);
        const f5 = await readForm();
        if (f5.start !== expDefaultStart || f5.close !== expClose || f5.publish !== expPublish || f5.end !== expEnd || f5.label !== expLabel) fail(`Periods form: could not return the draft to the preset state before Create: ${JSON.stringify(f5)}`);
        // (d) Create = ONE POST call_periods (return=representation) + ONE audit period.create; the new box renders
        const bC = writes.length;
        await page.click("[data-testid=prd-create]");
        await waitFor(() => writesSince(bC, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "period.create"), 8000);
        await page.waitForTimeout(400);
        const posts = writesSince(bC, "/rest/v1/call_periods");
        const cAud = writesSince(bC, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "period.create");
        const cOther = writesSince(bC).filter(w => !/\/rest\/v1\/(call_periods|audit_log)/.test(w.path));
        const created = periodStore.find(p => p.start_day === expDefaultStart);
        const pb = posts[0] ? bodyOf(posts[0]) : null;
        if (posts.length !== 1 || posts[0].method !== "POST" || !/return=representation/.test(posts[0].prefer) || !pb || pb.label !== expLabel || pb.start_day !== expDefaultStart || pb.end_day !== expEnd || pb.offers_close_at !== expClose || pb.publish_by !== expPublish || pb.status !== "upcoming" || JSON.stringify(pb.rules_only_ids) !== "[]" || JSON.stringify(pb.offer_modes) !== "{}") fail("Periods create: expected exactly ONE POST /rest/v1/call_periods (return=representation) with the form's dates, status upcoming, empty rules_only_ids / offer_modes: " + JSON.stringify(posts.map(w => w.method + " " + w.path + " " + w.body)).slice(0, 500));
        else if (!created || cAud.length !== 1 || cAud[0].detail.period_id !== created.id || cAud[0].detail.label !== expLabel || cAud[0].detail.length_months !== 3) fail("Periods create: expected ONE audit period.create carrying the new row's id / label / 3 months: " + JSON.stringify(cAud));
        else if (cOther.length) fail("Periods create: nothing but the POST and the audit may be written: " + JSON.stringify(cOther.map(w => w.method + " " + w.path)));
        else if (!writesSince(bC).every(w => noAddress(w.body))) fail("Periods create: a write body carries an e-mail address");
        else {
          await page.waitForSelector(boxSel(created.id), { timeout: 5000 });
          const box1 = await readBox(created.id);
          const expRemind1 = isOpen(created) ? IDS.slice() : [];
          if (box1.rows.length !== 6 || box1.rows.some(r => r.status !== "not_started" || r.offered !== 0) || box1.label !== expLabel || box1.status !== "upcoming" || JSON.stringify(box1.remind) !== JSON.stringify(expRemind1) || !box1.closeNow || (await page.$("[data-testid=prd-form]"))) fail(`Periods create: the new box should read '${expLabel}' upcoming, six not_started rows, Remind on all six, Close now, form folded: ` + JSON.stringify({ label: box1.label, status: box1.status, remind: box1.remind, closeNow: box1.closeNow, rows: box1.rows.map(r => r.text) }));
          else ok(`Periods create: ONE POST call_periods + ONE audit period.create ("${cAud[0].detail.summary}"); '${expLabel}' renders upcoming with six not_started rows and Remind on each`);
          if (!expRemind.length) { // the seed period was frozen: exercise Remind here instead
            const who = "s3"; const b0 = writes.length;
            await page.click(`${boxSel(created.id)} [data-testid=prd-row][data-person=${who}] [data-testid=prd-remind]`);
            await waitFor(() => writesSince(b0).some(w => /send-notification/.test(w.path)), 8000);
            const mails = writesSince(b0).filter(w => /send-notification/.test(w.path)).map(bodyOf);
            if (mails.length !== 1 || mails[0].type !== "offers_reminder" || JSON.stringify(mails[0].targetIds) !== JSON.stringify([who]) || !String(mails[0].data && mails[0].data.message).includes(`freeze on ${dayWords(expClose)}`)) fail("Periods Remind (new period): expected ONE offers_reminder to " + who + " naming the freeze '" + dayWords(expClose) + "': " + JSON.stringify(mails).slice(0, 300));
            else ok(`Periods Remind (new period, ${who}): ONE send-notification offers_reminder naming the freeze ${dayWords(expClose)}`);
          }
          // (e) Close now: dismissed = zero writes; confirmed = ONE CAS PATCH + ONE audit period.close
          const bD = writes.length;
          prdDismissNext = true;
          await page.click(`${boxSel(created.id)} [data-testid=prd-close-now]`);
          await page.waitForTimeout(400);
          const dismissed = prdDialogs[prdDialogs.length - 1] || "";
          if (writesSince(bD).length || !/^Close offers for /.test(dismissed) || (await page.$eval(boxSel(created.id), el => el.getAttribute("data-status"))) !== "upcoming") fail(`Periods Close now (dismissed): zero writes expected and the status kept (writes ${writesSince(bD).length}, dialog '${dismissed.slice(0, 60)}')`);
          else ok(`Periods Close now: the confirm ("${dismissed.split("\n")[0]}") dismissed -> zero writes, still upcoming`);
          const bE = writes.length;
          await page.click(`${boxSel(created.id)} [data-testid=prd-close-now]`);
          await waitFor(() => writesSince(bE, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "period.close"), 8000);
          await page.waitForTimeout(400);
          const patches = writesSince(bE, "/rest/v1/call_periods");
          const eAud = writesSince(bE, "/rest/v1/audit_log").map(bodyOf).filter(b => b && b.action === "period.close");
          const eOther = writesSince(bE).filter(w => !/\/rest\/v1\/(call_periods|audit_log)/.test(w.path));
          const box2 = await readBox(created.id);
          if (patches.length !== 1 || patches[0].method !== "PATCH" || patches[0].path !== `/rest/v1/call_periods?id=eq.${created.id}&status=eq.upcoming` || (bodyOf(patches[0]) || {}).status !== "closed" || !/return=representation/.test(patches[0].prefer)) fail("Periods Close now: expected exactly ONE PATCH /rest/v1/call_periods?id=eq.<id>&status=eq.upcoming { status closed } (return=representation): " + JSON.stringify(patches.map(w => w.method + " " + w.path + " " + w.body)));
          else if (eAud.length !== 1 || eAud[0].detail.period_id !== created.id || eAud[0].detail.by !== "scheduler" || !Array.isArray(eAud[0].detail.rollcall) || eAud[0].detail.rollcall.length !== 6) fail("Periods Close now: expected ONE audit period.close with period_id, by scheduler and the six-row roll call: " + JSON.stringify(eAud));
          else if (eOther.length) fail("Periods Close now: nothing but the PATCH and the audit may be written: " + JSON.stringify(eOther.map(w => w.method + " " + w.path)));
          else if (box2.status !== "closed" || created.status !== "closed" || box2.closeNow || box2.remind.length) fail(`Periods Close now: the box should read closed with no Close now / Remind (box ${box2.status}, store ${created.status}, closeNow ${box2.closeNow}, remind ${box2.remind.length})`);
          else ok(`Periods Close now: ONE CAS PATCH (status=eq.upcoming -> closed) + ONE audit period.close ("${eAud[0].detail.summary.slice(0, 80)}"); the box reads closed, Remind / Close now gone`);
        }
        // (f) Enter for someone = the painter as that surgeon, relayed, targeted at the seed period
        const whoE = "s3";
        await page.click(`${boxSel(per.id)} [data-testid=prd-row][data-person=${whoE}] [data-testid=prd-enter-for]`);
        await page.waitForSelector(`[data-testid=ofp-sheet][data-person=${whoE}]`, { timeout: 5000 });
        const sheet = await page.$eval("[data-testid=ofp-sheet]", el => ({ month: el.getAttribute("data-month"), text: el.innerText.replace(/\s+/g, " ").slice(0, 200) }));
        const perBox = await page.$eval("[data-testid=ofp-period]", el => ({ id: el.getAttribute("data-id") || el.getAttribute("data-period-id") || el.getAttribute("data-period"), status: el.getAttribute("data-status") })).catch(() => null);
        const expMonth = per.start_day > todayCentral ? per.start_day.slice(0, 7) : todayCentral.slice(0, 7);
        if (!/as the scheduler \(relayed\)/.test(sheet.text) || !perBox || perBox.id !== per.id || sheet.month !== expMonth) fail(`Periods Enter for ${whoE}: expected the painter 'as the scheduler (relayed)', period box = ${per.id}, opened on ${expMonth}: ${JSON.stringify({ sheet, perBox })}`);
        else ok(`Periods Enter for ${whoE}: painter opened as the scheduler (relayed), targeted at ${per.label} (${perBox.status}), month ${sheet.month}`);
        await page.click("[data-testid=ofp-close]");
        await page.waitForSelector("[data-testid=ofp-sheet]", { state: "detached", timeout: 3000 });
        // (g) Generate this period = the existing flow with the period's range (N=3, seed 7; no writes; then Discard)
        await page.fill("[data-testid=gen-n]", "3");
        await page.fill("[data-testid=gen-seed]", "7");
        const bG = writes.length;
        await page.click(`${boxSel(per.id)} [data-testid=prd-generate]`);
        await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 90000 });
        await page.waitForTimeout(500);
        const gs = await page.$eval("[data-testid=gen-start]", el => el.value), ge = await page.$eval("[data-testid=gen-end]", el => el.value);
        const gMeta = await page.$eval("[data-testid=gen-preview-meta]", el => el.textContent);
        const gBad = writesSince(bG).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off|call_periods|audit_log)/.test(w.path));
        if (gs !== per.start_day || ge !== per.end_day || !gMeta.includes(`${mdOf(per.start_day)} - ${mdOf(per.end_day)}`) || !/best of 3/.test(gMeta)) fail(`Periods Generate: expected the range ${per.start_day}..${per.end_day} in the fields and the preview meta: ${JSON.stringify({ gs, ge, gMeta: gMeta.slice(0, 120) })}`);
        else if (gBad.length) fail("Periods Generate wrote something: " + JSON.stringify(gBad.map(w => w.method + " " + w.path)));
        else ok(`Periods Generate: the existing flow ran over ${per.start_day}..${per.end_day} ("${gMeta.slice(0, 70)}"), nothing written`);
        await page.click("[data-testid=gen-discard]");
        await page.waitForSelector("[data-testid=gen-preview]", { state: "detached", timeout: 3000 });
        // (h) screenshots at 1180 and 390 in both themes; no horizontal page scroll at 390
        const secLoc = page.locator("[data-testid=periods-section]");
        await secLoc.screenshot({ path: path.join(OUT, "periods-desktop.png") });
        ok("screenshot test/ui/out/periods-desktop.png");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const geom390 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, wraps: Array.from(document.querySelectorAll("[data-testid=periods-section] .table-wrap")).map(w => ({ sw: w.scrollWidth, cw: w.clientWidth })), btn: Math.min(...Array.from(document.querySelectorAll("[data-testid=periods-section] button")).map(b => b.getBoundingClientRect().height)) }));
        if (geom390.sw > geom390.cw + 1) fail(`Periods 390px: the page scrolls horizontally (${geom390.sw} > ${geom390.cw}) - the table must scroll inside its card`);
        else ok(`Periods 390px: no horizontal page scroll (${geom390.sw} in ${geom390.cw}); ${geom390.wraps.length} table(s) scroll inside their wrap; smallest button ${Math.round(geom390.btn)}px`);
        await secLoc.screenshot({ path: path.join(OUT, "periods-390.png") });
        ok("screenshot test/ui/out/periods-390.png");
        await page.setViewportSize({ width: 1180, height: 900 });
        await page.click('button[data-tab="settings"]');
        await page.click("button:has-text('Dark')");
        await page.click('button[data-tab="setup"]');
        await openCard("setup_generate");
        await page.waitForSelector("[data-testid=periods-section]", { timeout: 5000 });
        await page.waitForTimeout(200);
        await page.locator("[data-testid=periods-section]").screenshot({ path: path.join(OUT, "periods-desktop-dark.png") });
        ok("screenshot test/ui/out/periods-desktop-dark.png");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        const dark390 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        if (dark390.sw > dark390.cw + 1) fail(`Periods (dark 390px): horizontal page scroll (${dark390.sw} > ${dark390.cw})`); else ok(`Periods (dark 390px): no horizontal page scroll (${dark390.sw} in ${dark390.cw})`);
        await page.locator("[data-testid=periods-section]").screenshot({ path: path.join(OUT, "periods-390-dark.png") });
        ok("screenshot test/ui/out/periods-390-dark.png");
        await page.setViewportSize({ width: 1180, height: 900 });
        await page.click('button[data-tab="settings"]');
        await page.click("button:has-text('Light')");
        await page.click('button[data-tab="setup"]');
        await openCard("setup_generate");
        await page.waitForSelector("[data-testid=gen-run]", { timeout: 5000 });
      } finally {
        page.off("dialog", onPrdDialog);
        await page.setViewportSize({ width: 1180, height: 900 });
      }
    } catch (e) { fail("Periods: " + errLine(e)); try { await page.screenshot({ path: path.join(OUT, "failure-periods.png"), fullPage: false }); } catch (e2) {} }

    // ---- Generate: preview from the app's derived default start (item AB: the first open slot on/after
    //      today, else the day after the last saved block, clamped to today) through the END OF THAT MONTH,
    //      N=10, seed 7 -> diagnostics, no writes. Prompt 12 SM2: the range follows the live rows (it was
    //      11/2-11/30 while November was open; 10/15-10/31 on the 9/23 rows); one calendar month keeps the
    //      tallies at one month row per surgeon and the calendar preview inside one grid. ----
    if (!genRangeStart) fail("Generate preview: the presets restatement above yielded no start - the preview range falls back to the app's own default start (input only)");
    const genStart = genRangeStart || await page.$eval("[data-testid=gen-start]", el => el.value);
    // ---- U3c review (major): a run while the offers / periods refresh was SKIPPED (session token expired) is
    // stamped STALE - the preview shows the red warning, the toast says so; with the token back and the tables
    // re-read the next run carries no warning. (The 'refuse' tier - never read this session - is a data-layer test:
    // this page read both tables at load.) N=3 keeps the two runs short; both are discarded.
    if (offerPeriod) try {
      const genEndStale = utcDay(Date.UTC(+genStart.slice(0, 4), +genStart.slice(5, 7), 0));
      const warnsB = consoleWarns.length;
      await page.evaluate((t) => localStorage.setItem("silvis-auth-token", t), EXPIRED_JWT);
      rtSendRow("call_offers", { id: "harness-stale-probe", person_id: "s2", day: OTHER_OFFER_DAY }, "UPDATE");
      rtSendRow("call_periods", { id: offerPeriod.id }, "UPDATE");
      const skipped = await waitFor(() => consoleWarns.slice(warnsB).some(t => /call_offers: read skipped/.test(t)) && consoleWarns.slice(warnsB).some(t => /call_periods: read skipped/.test(t)), 5000);
      await page.fill("[data-testid=gen-start]", genStart);
      await page.fill("[data-testid=gen-end]", genEndStale);
      await page.fill("[data-testid=gen-n]", "3");
      await page.fill("[data-testid=gen-seed]", "7");
      const bStale = writes.length;
      await page.click("[data-testid=gen-run]");
      await page.waitForSelector("[data-testid=gen-preview]", { timeout: 90000 });
      await page.waitForTimeout(400);
      const staleWarn = await page.$eval("[data-testid=gen-preview-offers-warning]", el => el.textContent).catch(() => null);
      const staleToast = await page.$eval("[data-testid=toast]", el => el.textContent).catch(() => "");
      const staleBad = writesSince(bStale).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off)/.test(w.path));
      if (!skipped) fail("U3c stale offers: with the token expired the realtime nudge did not make the app skip BOTH call_offers / call_periods reads (no 'read skipped' warn)");
      else if (!staleWarn || !/WARNING: the offers may be stale - call_offers last read .* the latest refresh was skipped \(session token missing or expired\); call_periods last read/.test(staleWarn)) fail(`U3c stale offers: the preview must carry the red gen-preview-offers-warning naming both tables and the skipped refresh, got ${JSON.stringify(staleWarn)}`);
      else if (!/WARNING: the offers may be stale/.test(staleToast)) fail(`U3c stale offers: the run toast must warn too, got ${JSON.stringify(staleToast.slice(0, 200))}`);
      else if (staleBad.length) fail("U3c stale offers: the run wrote something: " + JSON.stringify(staleBad.map(w => w.method + " " + w.path)));
      else ok(`U3c stale offers: token expired + skipped refresh -> the preview is stamped "${staleWarn.slice(0, 110)}..." and the toast warns; nothing written`);
      await page.locator("[data-testid=card-setup_generate]").screenshot({ path: path.join(OUT, "generate-offers-stale.png") });
      ok("screenshot test/ui/out/generate-offers-stale.png");
      await page.click("[data-testid=gen-discard]");
      await page.waitForSelector("[data-testid=gen-preview]", { state: "detached", timeout: 3000 });
      // token back, tables re-read -> the next run carries no warning
      await page.evaluate((t) => localStorage.setItem("silvis-auth-token", t), FAKE_JWT);
      const offerGetsB = offerGets.length;
      rtSendRow("call_offers", { id: "harness-stale-probe", person_id: "s2", day: OTHER_OFFER_DAY }, "UPDATE");
      rtSendRow("call_periods", { id: offerPeriod.id }, "UPDATE");
      const reread = await waitFor(() => offerGets.slice(offerGetsB).some(g => g.table === "call_offers") && offerGets.slice(offerGetsB).some(g => g.table === "call_periods"), 5000);
      await page.waitForTimeout(300);
      await page.click("[data-testid=gen-run]");
      await page.waitForSelector("[data-testid=gen-preview]", { timeout: 90000 });
      await page.waitForTimeout(300);
      const freshWarn = await page.$("[data-testid=gen-preview-offers-warning]");
      if (!reread) fail("U3c stale offers: with the token back the realtime nudge did not re-read call_offers / call_periods");
      else if (freshWarn) fail("U3c stale offers: after a successful re-read the preview still carries the stale warning");
      else ok("U3c stale offers: token back + both tables re-read -> the next preview carries no warning");
      await page.click("[data-testid=gen-discard]");
      await page.waitForSelector("[data-testid=gen-preview]", { state: "detached", timeout: 3000 });
      { const tst = await page.$("[data-testid=toast]"); if (tst) await tst.click().catch(() => {}); }
    } catch (e) { fail("U3c stale offers: " + errLine(e)); await page.evaluate((t) => localStorage.setItem("silvis-auth-token", t), FAKE_JWT); }
    const genEnd = utcDay(Date.UTC(+genStart.slice(0, 4), +genStart.slice(5, 7), 0)); // day 0 of the next month = the last day of genStart's month
    const genDays = daysBetween(genStart, genEnd).length;
    const genMonthLabel = `${["January","February","March","April","May","June","July","August","September","October","November","December"][+genStart.slice(5, 7) - 1]} ${genStart.slice(0, 4)}`;
    const rxEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    console.log(`     (Generate preview range ${genStart}..${genEnd} = ${genDays} day(s): the derived default start through the end of its month)`);
    await page.fill("[data-testid=gen-start]", genStart);
    await page.fill("[data-testid=gen-end]", genEnd);
    await page.fill("[data-testid=gen-n]", "10");
    await page.fill("[data-testid=gen-seed]", "7");
    const beforeGen = writes.length;
    // Prompt 16 B9 (a) review fix: the ASSEMBLED worker path, not just its parts - Playwright reports the dedicated
    // Worker the run creates (a blob: URL), its importScripts fetch rules.js from this server a second time, the busy
    // line names the worker while it runs, and a "Generate worker failed" warning (the quiet inline fallback) fails
    // the step here and the whole run at the end.
    const genWorkers = [];
    const onWorker = (w) => genWorkers.push(w.url());
    page.on("worker", onWorker);
    const rulesHitsBefore = servedHits.get("rules.js") || 0;
    const warnsBeforeGen = consoleWarns.length;
    await page.evaluate(() => { window.__b9Busy = []; window.__b9BusyTimer = setInterval(() => { const el = document.querySelector("[data-testid=gen-busy]"); if (el) window.__b9Busy.push(el.textContent); }, 20); });
    await page.click("[data-testid=gen-run]");
    await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 90000 });
    await page.waitForTimeout(1200);
    page.off("worker", onWorker);
    const busySeen = await page.evaluate(() => { clearInterval(window.__b9BusyTimer); return [...new Set(window.__b9Busy)]; });
    const rulesHitsByWorker = (servedHits.get("rules.js") || 0) - rulesHitsBefore;
    const workerFailWarns = consoleWarns.slice(warnsBeforeGen).filter(t => /Generate worker failed/.test(t));
    if (workerFailWarns.length) fail("B9a Generate in a worker: the worker path failed and the run fell back inline: " + workerFailWarns[0].slice(0, 200));
    else if (!genWorkers.some(u => /^blob:/.test(u))) fail(`B9a Generate in a worker: no dedicated blob: Worker was created for the run (workers seen: ${JSON.stringify(genWorkers)})`);
    else if (rulesHitsByWorker < 1) fail(`B9a Generate in a worker: the worker's importScripts did not fetch rules.js from the server (hits during the run: ${rulesHitsByWorker})`);
    else if (busySeen.length && !busySeen.some(t => /in a background worker - the page stays usable while it runs/.test(t))) fail(`B9a Generate in a worker: the busy line never read 'in a background worker' (seen: ${JSON.stringify(busySeen)})`);
    else ok(`B9a Generate in a worker: a blob: Worker ran the best-of-10 preview (rules.js fetched ${rulesHitsByWorker}x by its importScripts, no 'Generate worker failed' warning); busy line ${busySeen.length ? JSON.stringify(busySeen.find(t => /background worker/.test(t)).slice(0, 90)) : "not sampled - the run finished inside one 20 ms tick"}`);
    const genForbidden = writesSince(beforeGen).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
    if (genForbidden.length) fail("Generate preview wrote something: " + JSON.stringify(genForbidden.map(w => w.method + " " + w.path))); else ok("Generate preview: no schedule_days / snapshot / availability / time_off write (preview is read-only)");
    const meta = await page.$eval("[data-testid=gen-preview-meta]", el => el.textContent);
    if (!new RegExp(rxEscape(`${mdOf(genStart)} - ${mdOf(genEnd)} (${genDays} days), seed 7, best of 10`)).test(meta)) fail(`Generate preview meta wrong (expected '${mdOf(genStart)} - ${mdOf(genEnd)} (${genDays} days), seed 7, best of 10'): ` + meta); else ok("Generate preview: " + meta.slice(0, 120));
    const tallyRange = await page.$$eval("[data-testid=gen-tallies] tr[data-tally-range]", els => els.length);
    const tallyRows = await page.$$eval("[data-testid=gen-tallies] tr[data-tally]", els => els.map(e => e.innerText.replace(/\t/g, " | ")));
    if (tallyRange !== 6 || tallyRows.length !== 6) fail(`Generate tallies: expected 6 month rows + 6 range rows, got ${tallyRows.length} + ${tallyRange}`); else ok(`Generate tallies: 6 surgeons x (${genStart.slice(0, 7)} + range) rows vs cap/target`);
    tallyRows.forEach(r => console.log("     " + r));
    const unc = Number(await page.$eval("[data-testid=gen-diagnostics]", el => el.getAttribute("data-uncovered-count")));
    const uncRows = await page.$$eval("[data-testid=gen-uncovered] tr[data-uncovered]", els => els.map(e => e.getAttribute("data-uncovered"))).catch(() => []);
    if (unc > 0 && uncRows.length !== unc) fail(`Generate uncovered: ${unc} open slot(s) but ${uncRows.length} row(s) rendered`); else ok(`Generate uncovered: ${unc} open slot(s)${unc ? " rendered with per-surgeon reasons: " + uncRows.join(", ") : ""}`);
    const scoreText = await page.$eval("[data-testid=gen-score]", el => el.innerText.replace(/\s+/g, " "));
    if (!/total/.test(scoreText)) fail("Generate score breakdown missing: " + scoreText);
    else if (/\[object Object\]/.test(scoreText)) fail("Generate score renders '[object Object]' (the weights object is String()-ed): " + scoreText.slice(0, 160));
    else ok("Generate score: " + scoreText.slice(0, 120));
    // RF2 review fix: the diagnostics print the run mode and the fixed-slot count (the default run: mode generate; fixed = the locked slots in the range)
    const modeText = await page.$eval("[data-testid=gen-mode]", el => el.innerText.replace(/\s+/g, " ").trim()).catch(() => null);
    if (!modeText || !/^mode generate, fixed slots \d+$/.test(modeText)) fail("RF2 GenDiagnostics: expected a 'mode generate, fixed slots N' line ([data-testid=gen-mode]), got " + JSON.stringify(modeText));
    else ok("RF2 GenDiagnostics: " + modeText + " (diagnostics.mode / fixedSlots surfaced next to the score)");
    const weightsCell = await page.$eval("[data-testid=gen-score-weights]", el => ({ text: el.textContent, title: el.getAttribute("title") })).catch(() => null);
    if (weightsCell && !/weights \d+ keys?: \w+=/.test(weightsCell.text)) fail("Generate score: the weights summary is not 'weights N keys: k=v, ...': " + weightsCell.text);
    else if (weightsCell) ok("Generate score: weights summarised as '" + weightsCell.text.slice(0, 80) + "' (full JSON in the title)");
    await page.locator("[data-testid=card-setup_generate]").screenshot({ path: path.join(OUT, "generate-diagnostics.png") });
    ok("screenshot test/ui/out/generate-diagnostics.png");
    // the calendar shows the preview days with the distinct style
    await page.click('button[data-tab="calendar"]');
    await page.waitForSelector("[data-testid=preview-banner]", { timeout: 5000 });
    const monthLabel = await page.$eval("[data-testid=cal-month]", el => el.textContent.trim());
    // Item SM: the preview cells' holders (data-primary / data-backup / data-ext) are the harness's copy of
    // the preview it is about to accept; the Accept & Publish write set below is derived from them.
    const previewGrid = await page.$$eval('[data-testid=cal-grid] .cal-cell[data-preview="1"]', els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary") || "", b: e.getAttribute("data-backup") || "", ext: e.getAttribute("data-ext") || "" })));
    const previewCells = previewGrid.map(c => c.day);
    const previewStyled = await page.$eval('[data-testid=cal-grid] .cal-cell[data-preview="1"]', el => getComputedStyle(el).outlineStyle).catch(() => "");
    if (monthLabel !== genMonthLabel || previewCells.length !== genDays || previewCells[0] !== genStart || previewStyled !== "dashed") fail(`Calendar preview: month ${monthLabel}, ${previewCells.length} preview cells (${previewCells[0]}..), outline ${previewStyled} - expected ${genMonthLabel}, ${genDays} cells from ${genStart}, dashed`); else ok(`Calendar preview: ${genMonthLabel}, ${genDays} cells ${mdOf(genStart)}..${mdOf(genEnd)} drawn with the dashed preview outline + banner`);
    await page.screenshot({ path: path.join(OUT, "generate-preview.png"), fullPage: true });
    ok("screenshot test/ui/out/generate-preview.png");
    // Prompt 11 mobile: at 390px the PREVIEW tag fits its cell and clears the B line and the vacation dots
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const tagCheck = await page.evaluate(() => {
      const out = { cells: 0, clipped: 0, overB: 0, overDots: 0, example: null };
      for (const cell of document.querySelectorAll("[data-testid=cal-grid] .cal-cell.cal-preview")) {
        out.cells++;
        const tag = cell.querySelector(".cal-preview-tag"); if (!tag) continue;
        const t = tag.getBoundingClientRect(), c = cell.getBoundingClientRect();
        if (t.right > c.right + 0.5 || t.left < c.left - 0.5 || t.bottom > c.bottom + 0.5 || tag.scrollWidth > tag.clientWidth + 0.5) { out.clipped++; out.example = out.example || { day: cell.getAttribute("data-day"), tag: [Math.round(t.left), Math.round(t.right)], cell: [Math.round(c.left), Math.round(c.right)] }; }
        const lines = cell.querySelectorAll(".cal-line"); const b = lines[lines.length - 1] ? lines[lines.length - 1].getBoundingClientRect() : null;
        const dots = cell.querySelector(".cal-dots"); const d = dots ? dots.getBoundingClientRect() : null;
        const hit = (r) => r && !(t.right <= r.left || t.left >= r.right || t.bottom <= r.top || t.top >= r.bottom);
        if (hit(b)) out.overB++;
        if (hit(d)) out.overDots++;
      }
      return out;
    });
    if (!tagCheck.cells || tagCheck.clipped || tagCheck.overB || tagCheck.overDots) fail("mobile 390px preview: PREVIEW tag clipped / overlapping in the preview cells: " + JSON.stringify(tagCheck));
    else ok(`mobile 390px preview: the PREVIEW tag fits and clears the B line and the vacation dots in all ${tagCheck.cells} preview cells`);
    await page.locator("[data-testid=cal-grid]").screenshot({ path: path.join(OUT, "mobile-calendar-generate-preview-grid.png") });
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.waitForTimeout(200);
    await page.click('button[data-tab="setup"]');
    await page.waitForSelector("[data-testid=gen-accept]", { timeout: 5000 });

    // RF2 a: Accept names every HELD but UNLOCKED slot the merge replaces (a manual / trade / claim / generated /
    // import holder, or an external cover, not locked in that role) in a confirm BEFORE the snapshot - the locked
    // ones keep their own sentence. Derived from the same two pictures as the write set below: the preview holders
    // off the grid vs the harness's picture of the map, with the lock flags of the live row (a harness-edited
    // row-less day is unlocked). Both Accept clicks (failing snapshot, real) get the same confirm; it is accepted.
    const pvHolderOf = (c, role) => role === "primary" ? (c.p || (c.ext ? "ext:" + c.ext : null)) : (c.b || null);
    const lockedIn = (d, role) => { const l = liveByDay[d]; return !!(l && l[role + "_locked"]); };
    const heldUnlocked = [];
    previewGrid.forEach(c => { ["primary", "backup"].forEach(role => { const from = curHolder(c.day, role); if (from && !lockedIn(c.day, role) && pvHolderOf(c, role) !== from) heldUnlocked.push(`${mdOf(c.day)} ${role === "primary" ? "P" : "B"} ${from}`); }); });
    const acceptDialogs = [];
    const onAcceptDlg = (d) => { acceptDialogs.push(d.message()); d.accept(); };
    page.on("dialog", onAcceptDlg);

    // ---- Accept & Publish with a FAILING snapshot: nothing is written, the preview is kept ----
    failSnapshotInsert = true;
    const beforeFail = writes.length;
    await page.click("[data-testid=gen-accept]");
    await waitFor(() => writesSince(beforeFail, "/rest/v1/call_schedule_snapshots").length > 0, 30000);
    await page.waitForTimeout(1500);
    const snapFails = writesSince(beforeFail, "/rest/v1/call_schedule_snapshots");
    const dayAfterFail = writesSince(beforeFail, "/rest/v1/schedule_days");
    const keptPreview = await page.$("[data-testid=gen-preview]");
    const failToast = /Couldn't save a backup snapshot - NOTHING was published/.test(await bodyText());
    if (snapFails.length !== 1 || !snapFails[0].forcedFail) fail("Accept (snapshot failing): expected exactly one failed snapshot insert, saw " + JSON.stringify(snapFails.map(w => w.method + " " + w.path + (w.forcedFail ? " [forced fail]" : ""))));
    else if (dayAfterFail.length) fail("Accept (snapshot failing): schedule_days was written although the snapshot failed: " + JSON.stringify(dayAfterFail.map(w => w.method + " " + w.path)));
    else if (!keptPreview || !failToast) fail(`Accept (snapshot failing): preview kept=${!!keptPreview}, toast=${failToast}`);
    else ok("Accept & Publish with a failing snapshot: one snapshot POST (500), ZERO schedule_days writes, preview kept, toast says nothing was published");
    failSnapshotInsert = false;

    // ---- Accept & Publish for real: snapshot BEFORE the first schedule_days write, then the publish dialog ----
    const beforeOk = writes.length;
    await page.click("[data-testid=gen-accept]");
    await page.waitForSelector("[data-testid=publish-dialog]", { timeout: 60000 });
    await page.waitForTimeout(500);
    page.off("dialog", onAcceptDlg);
    {
      const heldMsgs = acceptDialogs.filter(m => /held but unlocked assignment\(s\) will be replaced: /.test(m));
      const otherMsgs = acceptDialogs.filter(m => !/held but unlocked assignment\(s\) will be replaced: /.test(m));
      if (otherMsgs.length) fail("RF2 Accept confirm: an unexpected dialog on Accept (respect locks ON, no locked change expected): " + JSON.stringify(otherMsgs.map(m => m.slice(0, 160))));
      // RF2 review fix: under the fixture the positive branch is REQUIRED - the injected unlocked generated backup
      // (2026-11-19 B s2, see the fixture) must be regenerated to another holder (or cleared) and named by the app.
      if (fixture && !heldUnlocked.some(s => s.startsWith(mdOf("2026-11-19") + " B "))) fail("RF2 Accept confirm (fixture): the injected held but unlocked 2026-11-19 backup (s2) was not regenerated - the positive branch did not run; grid cell: " + JSON.stringify(previewGrid.find(c => c.day === "2026-11-19")) + ", derived: " + JSON.stringify(heldUnlocked));
      if (heldUnlocked.length === 0) {
        if (heldMsgs.length) fail("RF2 Accept confirm: the harness derived no held but unlocked slot in the preview range, yet the app asked: " + heldMsgs[0].slice(0, 220));
        else ok("RF2 Accept confirm: no held but unlocked slot in the preview range (derived from the grid vs the live rows) - no confirm asked");
      } else if (heldMsgs.length !== 2) fail(`RF2 Accept confirm: expected the confirm on both Accept clicks (failing snapshot + real), got ${heldMsgs.length} of ${acceptDialogs.length} dialog(s): ` + JSON.stringify(acceptDialogs.map(m => m.slice(0, 140))));
      else {
        const m = heldMsgs[1];
        const n = Number((m.match(/(\d+) held but unlocked assignment\(s\) will be replaced: /) || [])[1]);
        const first = heldUnlocked[0].split(" ").slice(0, 2).join(" "); // "M/D P|B" of the first derived slot (the app lists the same order: by day, primary before backup)
        if (n !== heldUnlocked.length) fail(`RF2 Accept confirm: the app counts ${n} held but unlocked assignment(s), the harness derived ${heldUnlocked.length} (${heldUnlocked.slice(0, 8).join(", ")}${heldUnlocked.length > 8 ? ", ..." : ""}): ` + m.slice(0, 300));
        else if (m.indexOf("will be replaced: " + first + " ") < 0) fail(`RF2 Accept confirm: the first listed slot should be ${first}: ` + m.slice(0, 300));
        else if (!/tick 'Fill open slots only' to keep every held day/.test(m)) fail("RF2 Accept confirm: the confirm does not point at the fill-open-only checkbox: " + m.slice(0, 300));
        else ok(`RF2 Accept confirm on both clicks, BEFORE the snapshot: "${m.split("\n")[0].slice(0, 150)}" - ${n} held but unlocked assignment(s) = derived, first ${first}; accepted`);
      }
    }
    const seq = writesSince(beforeOk);
    const snapIdx = seq.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
    const dayIdx = seq.findIndex(w => w.path.startsWith("/rest/v1/schedule_days"));
    const dayWrites = seq.filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    const casShaped = dayWrites.every(w => (w.method === "POST" && /"version":1/.test(w.body) && /return=representation/.test(w.prefer || "")) || (w.method === "PATCH" && /schedule_days\?day=eq\.\d{4}-\d{2}-\d{2}&version=eq\.\d+/.test(w.path)));
    const genAudit = auditSince(beforeOk, "schedule.generate_accept");
    // Item SM: the write SET is derived from the harness's own data - the preview holders it read off the
    // grid (previewGrid) against its picture of the map before the accept (the live rows; see curDay) -
    // restating the sync's rule: one CAS write per day whose persisted row body changes. A day whose
    // primary or backup holder differs in the grid MUST be written, and every write must lie inside the
    // preview range and carry the preview's holders. The count is ">= the grid-visible day changes", not
    // "==": the row body also holds the lock flags, the source and the note, none of them visible in a
    // grid cell (e.g. a day the generator leaves fully open gets source 'generated'), so a write whose
    // holders equal the ones already on file is accepted ONLY when it changes at least one of those
    // persisted fields against the live row (primary_locked / backup_locked / source / note, compared the
    // way assignmentToDayRow normalises them) or is the first row of a row-less day - each such write is
    // listed with the fields it changes; a write that changes nothing the harness can name, changes
    // holders the grid did not predict, or lands outside the range, fails. So the count is exact in
    // substance: every write must change something nameable. The slot-change COUNT is pinned exactly: the
    // app's audit row carries changes = the number of (day, role) holder changes it merged, which the
    // harness recomputes from the same two pictures (the map picture was settled by settleMapToLive()
    // before the presets pin; nothing since has edited the map).
    const pvHolder = (c, role) => role === "primary" ? (c.p || (c.ext ? "ext:" + c.ext : null)) : (c.b || null);
    const pvByDay = {}; previewGrid.forEach(c => { pvByDay[c.day] = c; });
    const expectedDays = new Set(), expectedSlots = [];
    previewGrid.forEach(c => { ["primary", "backup"].forEach(role => { if (pvHolder(c, role) !== curHolder(c.day, role)) { expectedDays.add(c.day); expectedSlots.push(`${mdOf(c.day)} ${role} ${curHolder(c.day, role) || "OPEN"}->${pvHolder(c, role) || "OPEN"}`); } }); });
    const writtenDay = (w) => w.method === "PATCH" ? (/day=eq\.(\d{4}-\d{2}-\d{2})/.exec(w.path) || [])[1] : ((bodyOf(w) || {}).day || null);
    const writtenHolder = (w, role) => { const b = bodyOf(w) || {}; return role === "primary" ? (b.primary_id || (b.external_cover ? "ext:" + b.external_cover : null)) : (b.backup_id || null); };
    const writtenDays = new Set(dayWrites.map(writtenDay).filter(Boolean));
    const missingWrites = [...expectedDays].filter(d => !writtenDays.has(d));
    const outsideRange = [...writtenDays].filter(d => !pvByDay[d]);
    const wrongHolders = dayWrites.filter(w => { const d = writtenDay(w); return pvByDay[d] && ["primary", "backup"].some(role => writtenHolder(w, role) !== pvHolder(pvByDay[d], role)); }).map(w => writtenDay(w) + " " + JSON.stringify(bodyOf(w)));
    const metadataOnly = [...writtenDays].filter(d => pvByDay[d] && !expectedDays.has(d)); // holders unchanged -> must be a lock / source / note change or a new row
    const metaOf = (r) => ({ primary_locked: r.primary_locked === true, backup_locked: r.backup_locked === true, source: r.source || null, note: (r.note === undefined || r.note === null || r.note === "") ? null : String(r.note) });
    const metaDiff = (w) => { const d = writtenDay(w), live = liveByDay[d]; if (!live) return ["new row"]; const a = metaOf(bodyOf(w) || {}), b = metaOf(live); return Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k} ${JSON.stringify(b[k])}->${JSON.stringify(a[k])}`); };
    const metaWrites = dayWrites.filter(w => metadataOnly.includes(writtenDay(w)));
    const idleWrites = metaWrites.filter(w => !metaDiff(w).length).map(w => writtenDay(w) + " " + JSON.stringify(bodyOf(w)));
    const metaNamed = metaWrites.map(w => `${mdOf(writtenDay(w))} (${metaDiff(w).join(", ") || "nothing"})`);
    const auditChanges = genAudit && genAudit.detail ? genAudit.detail.changes : undefined;
    console.log(`     (derived over the ${previewGrid.length}-day preview: ${expectedDays.size} day(s) with a grid-visible holder change, ${expectedSlots.length} slot change(s)${expectedSlots.length ? " - " + expectedSlots.slice(0, 6).join(", ") + (expectedSlots.length > 6 ? ", ..." : "") : ""}; the app wrote ${writtenDays.size} day(s)${metaNamed.length ? ", holders unchanged on " + metaNamed.join(", ") : ""})`);
    if (snapIdx < 0) fail("Accept & Publish: no snapshot insert recorded");
    else if (seq[snapIdx].snapshotReason !== "generate_publish") fail("Accept & Publish: snapshot reason is " + seq[snapIdx].snapshotReason + ", expected generate_publish");
    else if (dayIdx < 0) fail("Accept & Publish: no schedule_days write recorded");
    else if (dayIdx < snapIdx) fail(`Accept & Publish: a schedule_days write (#${dayIdx}) happened BEFORE the snapshot insert (#${snapIdx})`);
    else if (!casShaped) fail(`Accept & Publish: ${dayWrites.length} schedule_days write(s), CAS-shaped=false: ` + JSON.stringify(dayWrites.slice(0, 3).map(w => w.method + " " + w.path)));
    else if (!expectedDays.size) fail(`Accept & Publish: the harness derived NO holder change between the preview and the map on file (${previewGrid.length} preview cells) - either the preview equals the published rows or the derivation is broken; ${dayWrites.length} write(s) went out`);
    else if (missingWrites.length || outsideRange.length || wrongHolders.length || dayWrites.length !== writtenDays.size) fail(`Accept & Publish: write set != derived set - ${dayWrites.length} write(s) over ${writtenDays.size} day(s), expected every one of the ${expectedDays.size} grid-changed day(s) once, inside ${previewCells[0]}..${previewCells[previewCells.length - 1]}, carrying the preview's holders; missing ${JSON.stringify(missingWrites)}, outside the range ${JSON.stringify(outsideRange)}, wrong holders ${JSON.stringify(wrongHolders.slice(0, 3))}`);
    else if (idleWrites.length) fail(`Accept & Publish: ${idleWrites.length} write(s) inside the preview range change nothing the harness can name (holders, lock flags, source and note all equal the live row): ${JSON.stringify(idleWrites.slice(0, 3))}`);
    else if (!genAudit) fail("Accept & Publish: no audit_log 'schedule.generate_accept'");
    else if (auditChanges !== expectedSlots.length) fail(`Accept & Publish: the audit row 'schedule.generate_accept' reports ${auditChanges} slot change(s), the harness derived ${expectedSlots.length} (${expectedSlots.slice(0, 8).join(", ")}${expectedSlots.length > 8 ? ", ..." : ""})`);
    else ok(`Accept & Publish: snapshot 'generate_publish' (#${snapIdx}) precedes the first schedule_days write (#${dayIdx}); ${dayWrites.length} CAS writes (${dayWrites.filter(w => w.method === "POST").length} POST v1, ${dayWrites.filter(w => w.method === "PATCH").length} PATCH ?day&version) = the ${expectedDays.size} grid-changed day(s) derived from the live rows${metaNamed.length ? " + " + metaNamed.length + " holders-unchanged write(s) each naming a lock / source / note change: " + metaNamed.join(", ") : " and no holders-unchanged write"}, all inside the preview range with the preview's holders; audit schedule.generate_accept changes=${auditChanges} = derived ${expectedSlots.length}; publish dialog opened`);
    const dlgText = await page.$eval("[data-testid=publish-dialog]", el => el.innerText);
    if (!/Publish schedule changes/.test(dlgText) || !/→/.test(dlgText)) fail("publish dialog after Accept lacks the diff lines: " + dlgText.slice(0, 200)); else ok("publish dialog after Accept: diff since last publish with arrow lines (" + (dlgText.match(/→/g) || []).length + ")");
    await page.screenshot({ path: path.join(OUT, "generate-publish-dialog.png"), fullPage: false });
    // Send the office notice (Prompt 13 part 5a): the office-notifications publish POST, the schedule_published feed row +
    // broadcast, THEN - when the published range leaves slots open - one open_shifts feed row (title 'N open shifts through
    // M/D', data.slots = every open slot from today to the last published day) and one send-notification open_shifts
    // broadcast (no targetIds, subject / message / detail). Nothing of the kind when the range is fully covered.
    {
      const beforePub = writes.length;
      page.once("dialog", d => d.accept()); // "Send the publish notice ... ?"
      await page.click("[data-testid=publish-dialog] [data-testid=publish-send]");
      await page.waitForSelector("[data-testid=publish-dialog]", { state: "detached", timeout: 20000 });
      // the ONE toast of the Send path (fix round): 'Published. Sent N office email(s).' + the open-shifts outcome, read before it fades
      const pubToast = await page.$eval("[data-testid=toast]", el => el.textContent).catch(() => null);
      await page.waitForTimeout(600);
      const pubSeq = writesSince(beforePub);
      const officeIdx = pubSeq.findIndex(w => /office-notifications/.test(w.path) && /"mode":"publish"/.test(w.body || ""));
      const bodies = pubSeq.map(w => { let b = null; try { b = JSON.parse(w.body || "null"); } catch (e) {} return { w, b }; });
      const pubFeed = bodies.find(x => x.w.path.startsWith("/rest/v1/notifications") && x.b && x.b.type === "schedule_published");
      const openFeedIdx = bodies.findIndex(x => x.w.path.startsWith("/rest/v1/notifications") && x.b && x.b.type === "open_shifts");
      const openMailIdx = bodies.findIndex(x => /send-notification/.test(x.w.path) && x.b && x.b.type === "open_shifts");
      const openFeed = openFeedIdx >= 0 ? bodies[openFeedIdx].b : null, openMail = openMailIdx >= 0 ? bodies[openMailIdx].b : null;
      // the expectation, read from the board the app itself renders: every open slot from today to the last published day (data-to)
      await page.click('button[data-tab="openshifts"]');
      await page.waitForSelector("[data-testid=openshifts-table]", { timeout: 8000 });
      await page.click("[data-testid=ob-horizon-all]"); await page.waitForTimeout(200);
      const bd = await page.$eval("[data-testid=openshifts-table]", el => ({ to: el.getAttribute("data-to"), rows: Array.from(el.querySelectorAll("tbody tr[data-slot]")).map(r => ({ day: r.getAttribute("data-day"), role: r.getAttribute("data-role") })) }));
      const expectSlots = bd.rows.filter(r => bd.to && r.day <= bd.to).map(r => r.day + "|" + r.role);
      const gotSlots = openFeed && openFeed.data && Array.isArray(openFeed.data.slots) ? openFeed.data.slots.map(s => s.day + "|" + s.role) : null;
      if (officeIdx < 0) fail("Publish (Send): no office-notifications POST with mode publish recorded: " + pubSeq.map(w => w.method + " " + w.path).join(", "));
      else if (!pubFeed) fail("Publish (Send): no schedule_published feed row recorded");
      else if (!expectSlots.length) {
        if (openFeed || openMail) fail("Publish (Send): the published range is fully covered yet an open_shifts notice was written: " + JSON.stringify((openFeed || openMail)).slice(0, 200));
        else ok(`Publish (Send): office-notifications publish POST + schedule_published feed row; the published range (through ${bd.to}) is fully covered, so no open_shifts notice went out`);
      }
      else if (!openFeed || !gotSlots) fail(`Publish (Send): the published range leaves ${expectSlots.length} slot(s) open but no open_shifts feed row was written; writes: ` + pubSeq.map(w => w.method + " " + w.path).join(", "));
      else if (openFeedIdx < officeIdx || openMailIdx < officeIdx) fail(`Publish (Send): the open_shifts notice (#${openFeedIdx} / #${openMailIdx}) must follow the office publish POST (#${officeIdx})`);
      else if (JSON.stringify(gotSlots) !== JSON.stringify(expectSlots)) fail(`Publish (Send): open_shifts data.slots (${gotSlots.length}) differ from the board's open slots through ${bd.to} (${expectSlots.length}): got ${gotSlots.slice(0, 6).join(", ")} vs ${expectSlots.slice(0, 6).join(", ")}`);
      else if (openFeed.data.through !== bd.to || !/^\d+ open shifts? through \d{1,2}\/\d{1,2}$/.test(String(openFeed.title))) fail("Publish (Send): open_shifts feed row must carry data.through = the last published day and the title 'N open shifts through M/D': " + JSON.stringify({ title: openFeed.title, through: openFeed.data.through, to: bd.to }));
      else if (!openMail || openMail.targetIds !== undefined || !openMail.data || openMail.data.subject !== openFeed.title || openMail.data.message !== openFeed.message || !/#openshifts$/.test(String(openMail.data.detail))) fail("Publish (Send): send-notification open_shifts must be a broadcast (no targetIds) with subject = the feed title, message = the feed message and the #openshifts detail: " + JSON.stringify(openMail).slice(0, 300));
      else if (String(openFeed.message).split("\n").filter(l => / - open/.test(l)).length !== expectSlots.length || !/Week of Mon/.test(String(openFeed.message))) fail("Publish (Send): the open_shifts message must list one week-grouped line per open slot: " + String(openFeed.message).slice(0, 200));
      else ok(`Publish (Send): office publish POST (#${officeIdx}) -> schedule_published -> open_shifts feed row "${openFeed.title}" (${gotSlots.length} slots, through ${openFeed.data.through}) + send-notification open_shifts broadcast (#${openMailIdx})`);
      if (!pubSeq.every(w => noAddress(w.body))) fail("Publish (Send): a write body carries an email address");
      if (!pubToast || !/^Published\. Sent \d+ office email\(s\)\./.test(pubToast)) fail("Publish (Send): expected the 'Published. Sent N office email(s).' toast, got: " + JSON.stringify(pubToast));
      else if (openFeed && !/In-app note posted about \d+ open shifts?; /.test(pubToast)) fail("Publish (Send): the Published toast must carry the open-shifts outcome (one toast, not two): " + JSON.stringify(pubToast));
      else if (!openFeed && /open shift/.test(pubToast)) fail("Publish (Send): no open_shifts note went out, yet the toast mentions one: " + JSON.stringify(pubToast));
      else ok(`Publish (Send): one toast for both outcomes - "${pubToast}"`);
    }
    if (await page.$("[data-testid=gen-preview]")) fail("Accept & Publish: the preview is still shown after acceptance"); else ok("Accept & Publish: preview cleared");
    await page.click('button[data-tab="calendar"]');
    await page.waitForTimeout(400);
    // SM2: the re-checked day is the first preview cell whose holders the accept CHANGED against the map
    // (a cell already equal to the live row would read saved even if the accept wrote nothing - SM2 review),
    // falling back to the first cell with a primary; after the accept it must show BOTH of the preview's
    // holders and no preview flag. (It was the constant 2026-11-03 while the range was November.)
    const pubProbe = previewGrid.find(c => expectedDays.has(c.day) && (c.p || c.b)) || previewGrid.find(c => c.p) || null;
    const pubChanged = !!(pubProbe && expectedDays.has(pubProbe.day));
    // settle before reading (landing run 2026-09-25: under load the 400 ms wait above once read the pre-accept holders): up to 5 s for
    // the probe cell to show the preview's holders with no preview flag - a real miss still fails the check below after the timeout
    if (pubProbe) await page.waitForFunction(({ d, p, b }) => {
      const el = document.querySelector(`[data-day="${d}"]`);
      return !!el && (el.getAttribute("data-primary") || "") === p && (el.getAttribute("data-backup") || "") === b && el.getAttribute("data-preview") !== "1";
    }, { d: pubProbe.day, p: pubProbe.p || "", b: pubProbe.b || "" }, { timeout: 5000 }).catch(() => {});
    const pubP = pubProbe ? await cellAttr(pubProbe.day, "data-primary").catch(() => null) : null;
    const pubB = pubProbe ? await cellAttr(pubProbe.day, "data-backup").catch(() => null) : null;
    const pubPrev = pubProbe ? await cellAttr(pubProbe.day, "data-preview").catch(() => null) : null;
    if (!pubProbe) fail(`Accept & Publish: none of the ${previewGrid.length} preview cells carried a holder to re-check after the accept`);
    else if ((pubP || "") !== (pubProbe.p || "") || (pubB || "") !== (pubProbe.b || "") || pubPrev === "1") fail(`Accept & Publish: ${pubProbe.day} should now be a saved assignment with the preview's holders P ${pubProbe.p || "-"} / B ${pubProbe.b || "-"} (cell P '${pubP}' B '${pubB}', preview '${pubPrev}'${pubChanged ? "; the accept changed this day against the map" : ""})`);
    else ok(`Accept & Publish: ${pubProbe.day} is a saved assignment (P ${pubP || "-"} / B ${pubB || "-"} = the preview's${pubChanged ? ", a day the accept changed: " + expectedSlots.filter(s => s.startsWith(mdOf(pubProbe.day) + " ")).join(", ") : " - no preview cell differed from the map"}), no longer a preview`);
    await page.waitForTimeout(1500); // let the autosave pass settle (no diff -> no extra day writes)
    // Prompt 13 part 4 (WHY IS IT OPEN): the accept stored lastGenerate in state and the
    // autosave's blob leg wrote it - the record the anon-readable blob will carry, observed
    // in the recorded write body: shape, the preview's range, operational sentences only
    // (no roster name / code), and past the importer's denylist gate (Prompt 12 F).
    {
      const blobWrites = writesSince(beforeOk, "/rest/v1/call_schedule_data").map(w => { try { return JSON.parse(w.body || "{}"); } catch (e) { return null; } });
      const lgBody = blobWrites.find(b => b && b.data && b.data.lastGenerate);
      if (!lgBody) fail(`Accept & Publish: no call_schedule_data write after the accept carries data.lastGenerate (${blobWrites.length} blob write(s), keys: ${blobWrites.map(b => b && b.data ? Object.keys(b.data).join("+") : "?").join(" | ")})`);
      else {
        const lg = lgBody.data.lastGenerate;
        const sentence = /^(no eligible surgeon( - .+)?|generator could not place - report it( \(other surgeons: .+\))?)$/;
        const rosterWord = /\b(Khan|Burchett|Acton|Philip|Fierce|Sarkar|FAK|MAB|BDA|AFP|NF|SRK|s[1-6])\b/;
        const slots = Array.isArray(lg.openSlots) ? lg.openSlots : null;
        const badSlot = slots ? slots.find(s => !s || !/^\d{4}-\d{2}-\d{2}$/.test(s.day) || !/^(primary|backup)$/.test(s.role) || typeof s.reason !== "string" || !sentence.test(s.reason) || rosterWord.test(s.reason)) : null;
        let denied = null; try { require(path.join(ROOT, "importer.js")).impRefuseNoteDenylist({ lastGenerate: lg }); } catch (e) { denied = String(e && e.message || e).split("\n")[0]; }
        // P13R (e): the record also carries the run facts of the Prompt 12 head's diagnostics - mode (item T) and fixedSlots - and carriedFrom when a sub-range run kept earlier reasons
        const extraKeys = Object.keys(lg).filter(k => !["at", "range", "openSlots", "weekendKinds", "mode", "fixedSlots", "carriedFrom"].includes(k));
        const runFactsOk = (lg.mode === "generate" || lg.mode === "fill-open-only") && (lg.fixedSlots === null || (Number.isInteger(lg.fixedSlots) && lg.fixedSlots >= 0)) && (!("carriedFrom" in lg) || typeof lg.carriedFrom === "string" || lg.carriedFrom === null);
        if (!runFactsOk) extraKeys.push("bad run facts mode=" + lg.mode + " fixedSlots=" + lg.fixedSlots);
        if (!slots || !lg.range || typeof lg.weekendKinds !== "object" || !lg.weekendKinds || typeof lg.at !== "string" || extraKeys.length) fail("Accept & Publish: lastGenerate shape wrong (extra keys: " + extraKeys.join(",") + "): " + JSON.stringify(lg).slice(0, 300));
        else if (lg.range.start !== genStart || lg.range.end !== genEnd) fail("Accept & Publish: lastGenerate.range is not the harness preview range " + genStart + ".." + genEnd + ": " + JSON.stringify(lg.range));
        else if (badSlot) fail("Accept & Publish: lastGenerate.openSlots carries a non-operational entry: " + JSON.stringify(badSlot));
        else if (denied) fail("Accept & Publish: lastGenerate fails the importer denylist gate: " + denied);
        else ok(`Accept & Publish: blob autosave carries data.lastGenerate { at, range ${lg.range.start}..${lg.range.end}, ${slots.length} open slot(s), ${Object.keys(lg.weekendKinds).length} weekend kind(s) } - every reason operational (${slots.slice(0, 2).map(s => s.day + " " + s.role + ": " + s.reason).join("; ") || "none open"}), past the importer denylist`);
      }
    }
    await page.click('button[data-tab="setup"]');
    await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 });
    // The seed's schedule_days range (the days the importer compares): the
    // board scenario's claimed day(s) inside it are app-edited (source 'claim')
    // and must read as BLOCKED / kept in the dry run and the apply below.
    const planSdRows = IMPORTER.importPlan(JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8")), { now: new Date().toISOString() }).scheduleDayRows;
    const planDaysAll = new Set(planSdRows.map(r => r.day));
    // The importer's ownership rule restated (importer.js planDiff / helpers.js suSeedDayMerge): the live row as the
    // app is served it (the claim overlay included), seed-owned = source 'import' AND updated_by 'seed', and the
    // field set impDaySame compares. Since the 9/23 publish many seed-range days are publish-filled (source
    // 'generated', updated_by 'publish-preview ...'): BLOCKED in the dry run, kept on apply.
    const liveFor = (d) => ({ ...(liveByDay[d] || {}), ...(claimedDays[d] || {}) });
    const seedOwned = (l) => l.source === "import" && (l.updated_by || "seed") === "seed";
    const rowDiffers = (l, p) => (l.primary_id || null) !== (p.primary_id || null) || (l.backup_id || null) !== (p.backup_id || null) || !!l.primary_locked !== !!p.primary_locked || !!l.backup_locked !== !!p.backup_locked || (l.external_cover || null) !== (p.external_cover || null) || (l.note || null) !== (p.note || null);

    // ---- Prompt 12 M: outside surgeons - Setup adds 'Locum' (LOC), the day editor writes him in
    //      (locked, source manual-external, no override confirm), Totals lists him under its own heading ----
    {
      try {
        // The outside surgeon's day: a row-less weekday AFTER every day this run has edited so far (the
        // SM2 triples included) - derived, never a named date (SM2 review; it was the constant
        // 2027-03-01), so the Totals month below holds exactly this one outside-surgeon day.
        const extDay = (() => {
          const touched = Object.keys(harnessDays).concat([day || todayIso, todayIso]).sort();
          const scanEnd = isoAddDays(lastLiveDay > todayIso ? lastLiveDay : todayIso, 400);
          for (let d = isoAddDays(touched[touched.length - 1], 1); d <= scanEnd; d = isoAddDays(d, 1)) {
            const dow = new Date(d + "T12:00:00Z").getUTCDay();
            if (dow >= 1 && dow <= 5 && !fixtureHasDay(d) && !liveByDay[d] && !harnessDays[d] && d !== day) return d;
          }
          return null;
        })();
        if (!extDay) throw new Error("no row-less weekday after this run's last edited day");
        // Every write is intercepted: the roster save's blob PATCH and the day's POST never reach the
        // tables, and the app's next poll (refreshAll) re-adopts the LIVE blob (Locum leaves the roster)
        // and drops the persisted row-less day. So the WHOLE block - roster save, editor, cell read and
        // Totals (about 20 s) - starts at the top of a fresh poll interval (SM2 review).
        await freshPollWindow(`outside surgeon ${extDay}`);
        const rosterCard = await openCard("setup_roster");
        if (!rosterCard) throw new Error("setup_roster card missing");
        const beforeRoster = writes.length;
        const findRosterBlob = () => writesSince(beforeRoster, "/rest/v1/call_schedule_data").map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.data && Array.isArray(b.data.roster) && b.data.roster.some(r => r.id === "x1"));
        await page.click("[data-testid=roster-add-external]");
        await page.fill("[data-testid=roster-name-x1]", "Locum");
        await page.fill("[data-testid=roster-note-x1]", "covers when asked");
        // a duplicate code is refused before anything is saved
        await page.fill("[data-testid=roster-code-x1]", "FAK");
        await page.click("[data-testid=roster-save]");
        await page.waitForTimeout(500);
        const dupRefused = /code FAK is used twice/i.test(await bodyText());
        if (!dupRefused || findRosterBlob()) fail(`Roster: a duplicate code must be refused with no blob write (refused=${dupRefused}, blobWrite=${!!findRosterBlob()})`);
        else ok("Roster: 'Add outside surgeon' with the duplicate code FAK is refused client-side, nothing written");
        await page.fill("[data-testid=roster-code-x1]", "LOC");
        await page.click("[data-testid=roster-save]");
        if (!(await waitFor(() => !!findRosterBlob(), 4000, 100))) fail("Roster: no blob autosave carrying the outside surgeon x1 after Save roster");
        else {
          const x1 = findRosterBlob().data.roster.find(r => r.id === "x1");
          const pool = findRosterBlob().data.roster.filter(r => r.type !== "external").length;
          if (x1.type !== "external" || x1.code !== "LOC" || x1.name !== "Locum" || x1.note !== "covers when asked" || pool !== 6) fail("Roster: the saved outside surgeon row is wrong: " + JSON.stringify(x1) + " pool=" + pool);
          else ok("Roster: Save -> blob autosave carries { id: x1, type: external, name: Locum, code: LOC, note } beside the six pool rows");
        }
        // the day editor on the derived outside-surgeon day (see the top of this block)
        const [ey, em] = extDay.split("-");
        await showMonth(Number(ey), Number(em) - 1);
        await page.click(`[data-day="${extDay}"]`);
        await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
        const grp = await page.$$eval("[data-testid=editor-primary-externals] option", els => els.map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
        const grpB = await page.$$eval("[data-testid=editor-backup-externals] option", els => els.map(o => o.value));
        if (!grp.some(o => o.value === "x1" && o.eligible === "true" && /Locum/.test(o.text)) || !grpB.includes("x1")) fail("Day editor: the 'Outside surgeons' optgroup must list Locum (eligible) for both roles: " + JSON.stringify({ grp, grpB }));
        else ok(`Day editor ${extDay}: 'Outside surgeons' optgroup lists Locum as eligible for primary and backup`);
        const beforeExt = writes.length;
        await page.selectOption("[data-testid=editor-primary]", "x1");
        await page.waitForTimeout(250);
        const ovConfirm = await page.$("[data-testid=override-confirm]");
        const lockedNow = await page.$eval("[data-testid=editor-lock-primary]", el => el.checked);
        // review 9/22: the note is an INFO line (editor-info, sub colour), never the red error hint
        const hintNow = await page.$eval("[data-testid=editor-info]", el => el.textContent).catch(() => "");
        const redHint = await page.$eval("[data-testid=editor-hint]", el => el.textContent).catch(() => "");
        if (ovConfirm) fail("Day editor: picking an outside surgeon must not open the override confirm");
        else if (!lockedNow) fail("Day editor: picking an outside surgeon must lock the role");
        else if (!/written in by hand/.test(hintNow)) fail("Day editor: no 'written in by hand' info line (editor-info) after picking an outside surgeon: " + JSON.stringify({ info: hintNow, hint: redHint }));
        else if (redHint) fail("Day editor: picking an outside surgeon must not show the red error hint: " + JSON.stringify(redHint));
        else ok("Day editor: picking Locum locks primary, shows the hand-written info line (not the error hint), no override confirm");
        await page.screenshot({ path: path.join(OUT, "day-editor-outside-surgeon.png") });
        await page.click("[data-testid=editor-save]");
        await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
        noteEdit(extDay, { primary_id: "x1" });
        await page.waitForTimeout(1800);
        const extWrite = writesSince(beforeExt, "/rest/v1/schedule_days").find(w => { try { return JSON.parse(w.body).day === extDay; } catch (e) { return false; } });
        const eb = extWrite ? JSON.parse(extWrite.body) : null;
        if (!eb) fail("Day editor: no schedule_days write for the outside surgeon's day " + extDay + "; writes: " + JSON.stringify(writesSince(beforeExt).map(w => w.method + " " + w.path)));
        else if (eb.primary_id !== "x1" || eb.primary_locked !== true || eb.source !== "manual-external") fail("Day editor: the outside surgeon's row must be { primary_id: x1, primary_locked: true, source: manual-external }: " + JSON.stringify(eb));
        else ok(`Day editor: ${extDay} -> ${extWrite.method} schedule_days { primary_id: x1, primary_locked: true, source: manual-external }`);
        if ((await cellAttr(extDay, "data-primary")) !== "x1") fail("Calendar: the cell does not show x1 as primary after the save"); else ok("Calendar: the cell shows Locum as primary");
        // Totals: the 'Outside surgeons' section for that month, and never a pool-table row
        await page.click('button[data-tab="totals"]');
        await page.waitForSelector("[data-testid=totals-card]", { timeout: 5000 });
        await page.selectOption("[data-testid=totals-year]", ey);
        await page.selectOption("[data-testid=totals-month]", String(Number(em) - 1));
        await page.waitForTimeout(400);
        const extRow = await page.$eval("[data-testid=totals-external] [data-testid=totals-ext-row-x1]", el => ({ p: el.getAttribute("data-primary"), b: el.getAttribute("data-backup"), t: el.getAttribute("data-total"), text: el.textContent })).catch(() => null);
        const inMain = await page.$("[data-testid=totals-table] [data-testid=totals-row-x1]");
        if (!extRow || extRow.p !== "1" || extRow.t !== "1" || !/Locum/.test(extRow.text)) fail("Totals: the 'Outside surgeons' section must list Locum with 1 primary for " + ey + "-" + em + ": " + JSON.stringify(extRow));
        else if (inMain) fail("Totals: an outside surgeon must not appear in the pool table");
        else ok(`Totals ${ey}-${em}: 'Outside surgeons' section lists Locum (P 1, total 1) and the pool table does not`);
        await page.locator("[data-testid=totals-external]").screenshot({ path: path.join(OUT, "totals-outside-surgeons.png") }).catch(() => {});
      } catch (e) {
        fail("outside surgeons (M): " + errLine(e));
        // an editor left open intercepts every later click - close it so a failure here stays one FAIL (SM2 review)
        if (await page.$("[data-testid=day-editor]")) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {}); }
      }
      await page.click('button[data-tab="setup"]').catch(() => {});
      await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 }).catch(() => {});
    }

    // ---- Import seed: dry run shows zero changes against the live rows and writes nothing ----
    let rf2Drift = false; // RF2 e: set by the dry run below when the LIVE blob still carries the retired settings.seedRevisions key (one extra settings=update until the re-import)
    {
      await openCard("setup_import");
      const before = writes.length;
      await page.setInputFiles("[data-testid=seed-file]", path.join(ROOT, "docs", "silvis-seed.json"));
      await page.waitForSelector("[data-testid=seed-dryrun]", { timeout: 60000 });
      await page.waitForTimeout(500);
      const total = await page.$eval("[data-testid=seed-total]", el => el.innerText.replace(/\s+/g, " "));
      const diffText = await page.$eval("[data-testid=seed-diff-text]", el => el.textContent);
      const applyDisabled = await page.$eval("[data-testid=seed-apply]", el => el.disabled);
      const impWrites = writesSince(before).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off|call_offers|call_periods)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
      // Prompt 12 SM2: the expectation is the harness's own diff of PLAN (the importer's plan for the seed,
      // computed at the top of this file) against the live rows (the fixture rows in fixture mode),
      // restating the importer's ownership rule: a plan day whose live row differs (holders, lock flags,
      // external cover, note) is an UPDATE while the row is still seed-owned (source 'import', updated_by
      // 'seed') and BLOCKED otherwise - a day the app has edited or published since the import is never
      // overwritten and never counts as a change. The seed applied tonight leaves zero inserts / updates
      // (anything else is the orchestrator's pending apply, reported as such); the 9/23 overnight publish
      // leaves the plan days it rewrote blocked. The app's line reads 'Total changes: 0 (+N blocked ...)'
      // then, and the 'No changes' sentence only when nothing is blocked.
      const sameRow = (l, r) => (l.primary_id || null) === (r.primary_id || null) && (l.backup_id || null) === (r.backup_id || null) && !!l.primary_locked === !!r.primary_locked && !!l.backup_locked === !!r.backup_locked && (l.external_cover || null) === (r.external_cover || null) && (l.note || null) === (r.note || null);
      const seedOwned = (l) => !!l && l.source === "import" && (l.updated_by || "") === "seed";
      const planByDay = {}; PLAN.scheduleDayRows.forEach(r => { planByDay[r.day] = r; });
      const planDays = Object.keys(planByDay).sort();
      // IP fix (9/23): the table the app is served carries the board scenario's claim (claimedDays, overlaid on every
      // schedule_days GET - source 'claim', updated_by 's1'), so the restatement reads the same rows the app does (the
      // Apply restatement below already does, via liveFor). Without it fixture mode read the claimed 10/07 as
      // 'unchanged' while the app read it BLOCKED ('+1 blocked' on every Import pin there since the claim scenario).
      const liveImp = {}; planDays.forEach(d => { if (liveByDay[d]) liveImp[d] = { ...liveByDay[d], ...(claimedDays[d] || {}) }; });
      const planInserts = planDays.filter(d => !liveImp[d]);
      const planUpdates = planDays.filter(d => liveImp[d] && !sameRow(liveImp[d], planByDay[d]) && seedOwned(liveImp[d]));
      const planBlocked = planDays.filter(d => liveImp[d] && !sameRow(liveImp[d], planByDay[d]) && !seedOwned(liveImp[d]));
      const planUnchanged = planDays.filter(d => liveImp[d] && sameRow(liveImp[d], planByDay[d]));
      // The importer lists a blocked day as one line per changed slot ('P a -> b', 'B a -> b'; one 'locks/note
      // change' line when the holders agree), and the panel's '(+N blocked)' counts those LINES; the diff's
      // schedule_days summary line counts the DAYS. Both are restated.
      const blockedLinesOf = (d) => { const l = liveImp[d], r = planByDay[d]; const p = (l.primary_id || null) !== (r.primary_id || null) || (l.external_cover || null) !== (r.external_cover || null); const b = (l.backup_id || null) !== (r.backup_id || null); return Math.max(1, (p ? 1 : 0) + (b ? 1 : 0)); };
      const planBlockedLines = planBlocked.reduce((n, d) => n + blockedLinesOf(d), 0);
      const blockedSuffix = planBlockedLines ? ` (+${planBlockedLines} blocked: app-edited days kept)` : "";
      // Prompt 14 IP (9/23): the app plans PERIOD-AWARE like scripts/import-seed.js and - like the CLI - passes the two
      // authenticated-read tables as unknown, so every planned call_periods / call_offers row counts as an upsert in
      // 'Total changes' (the CLI's dry run against the live project on 9/23 read 'Total changes: 80 (+30 blocked)' =
      // 1 period + 79 offers; the 0 of the pre-IP pin is what the CLI's post-apply VERIFIED line reads, which diffs the
      // rows the SQL returned). Restated from the harness's own period-aware plan (PLAN_P) plus the availability rows
      // the plan lacks / the seed-owned live rows the plan no longer carries (0 / 0 once the period apply retired
      // Burchett's 20 in-period rows; the fixture rows still hold them, so fixture mode reads them as deletes).
      const nm = (id) => ((PLAN_P.blob.roster || []).find(r => r.id === id) || {}).name || id;
      const perLabel = PLAN_P.periodRows[0] ? PLAN_P.periodRows[0].label : "";
      const avKey0 = (r) => [r.person_id, r.kind, r.role || "any", String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10), r.source || ""].join("|");
      const anonRowsOf = async (table, select) => { const r = await fetch(`https://${SUPABASE_HOST}/rest/v1/${table}?select=${select}`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } }); if (!r.ok) throw new Error(`${table} anon read: HTTP ${r.status}`); const rows = await r.json(); if (!Array.isArray(rows)) throw new Error(`${table} anon read: body is not an array`); return rows; };
      const liveAv0 = fixture ? fixture.availability : await anonRowsOf("availability", "person_id,kind,role,start_date,end_date,source");
      const havePlanAv = new Set(PLAN_P.availabilityRows.map(avKey0)), haveLiveAv = new Set(liveAv0.map(avKey0));
      const avIns0 = PLAN_P.availabilityRows.filter(r => !haveLiveAv.has(avKey0(r)));
      const avDel0 = liveAv0.filter(r => r.source === "seed" && !havePlanAv.has(avKey0(r)));
      const offerUpserts = PLAN_P.periodRows.length + PLAN_P.offerRows.length;
      const offersWords = Object.keys(PLAN_P.stats.offersByPerson).map(id => `${nm(id)} ${PLAN_P.stats.offersByPerson[id]}`).join(", ");
      // IP fix (9/23, review): the blob keys the plan would change, restated from the plan's blob against the blob the
      // app reads (liveBlobData: the live 'main' row, or the fixture's) under the importer's own key rules - the seed
      // owns the pool roster only (live outside surgeons ride along), settings are merged so only the seed's keys (and
      // a retired key still live) compare, importedAt never counts; a key the live blob lacks is a change. 0 in live
      // mode once the period apply left the blob = the period-aware plan's; in fixture mode the fixture blob is the
      // LEGACY plan's, so surgeonRules (the retired months) and settings (the seedCoreHash stamp) read as updates there.
      const canonJ = (v) => v === undefined ? "undefined" : (v === null || typeof v !== "object") ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonJ).join(",") + "]" : "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonJ(v[k])).join(",") + "}";
      const blobDeltaOf = (planBlob) => Object.keys(planBlob).filter(k => {
        let mine = planBlob[k], theirs = liveBlobData ? liveBlobData[k] : undefined;
        if (theirs === undefined) return true;
        if (k === "roster" && Array.isArray(theirs)) { const ids = new Set(mine.map(r => r.id)); mine = mine.concat(theirs.filter(r => r && r.type === "external" && !ids.has(r.id))); }
        if (k === "settings") { mine = { ...mine }; delete mine.importedAt; const sub = {}; Object.keys(mine).forEach(kk => { sub[kk] = theirs[kk]; }); if ("seedRevisions" in theirs) sub.seedRevisions = theirs.seedRevisions; theirs = sub; }
        return canonJ(mine) !== canonJ(theirs);
      });
      const blobDelta = blobDeltaOf(PLAN_P.blob);
      const expChanges = blobDelta.length + offerUpserts + avIns0.length + avDel0.length;
      const expDryTotal = `Total changes: ${expChanges}` + blockedSuffix;
      const expDryTail = `Total changes: ${expChanges}` + (avDel0.length ? ` (incl. ${avDel0.length} delete(s) of seed-owned rows)` : "") + (planBlockedLines ? ` (+${planBlockedLines} blocked)` : "");
      const legs0 = await page.$eval("[data-testid=seed-period-legs]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
      const expSdLine = `schedule_days: insert ${planInserts.length}, update ${planUpdates.length}, delete 0, unchanged ${planUnchanged.length}${planBlocked.length ? ", BLOCKED " + planBlocked.length : ""}`;
      const dryLines = diffText.trim().split("\n").map(l => l.trim());
      const dryTail = dryLines.slice(-1)[0];
      const drySdLine = dryLines.find(l => l.startsWith("schedule_days: ")) || "(no schedule_days line)";
      console.log(`     (Import dry run, restated from the plan's ${planDays.length} days vs the ${liveRows.length} ${fixture ? "fixture" : "live"} rows: ${planInserts.length} missing, ${planUpdates.length} seed-owned day(s) differing (would update), ${planUnchanged.length} unchanged, ${planBlocked.length} day(s) differing that the app edited / published since the import = ${planBlockedLines} blocked slot line(s) (never overwritten${planBlocked.length ? ": " + planBlocked.slice(0, 5).join(", ") + (planBlocked.length > 5 ? ", ... " + planBlocked.slice(-1)[0] : "") : ""}))`);
      const expBlobLine = "call_schedule_data 'main': " + Object.keys(PLAN_P.blob).map(k => k + "=" + (blobDelta.includes(k) ? (liveBlobData && Object.keys(liveBlobData).length ? "update" : "insert") : "unchanged")).join(", ");
      const dryBlobLine = dryLines.find(l => l.startsWith("call_schedule_data 'main': ")) || "(no call_schedule_data line)";
      if (planInserts.length || planUpdates.length || avIns0.length || (!fixture && blobDelta.length)) fail(`Import dry run premise: the live rows do not hold the seed - ${planInserts.length} plan day(s) missing, ${planUpdates.length} seed-owned day(s) differing (${[...planInserts, ...planUpdates].slice(0, 6).join(", ")}), ${avIns0.length} availability row(s) of the period-aware plan missing (${avIns0.slice(0, 4).map(r => r.person_id + " " + r.start_date).join(", ")}), blob key(s) differing from the period-aware plan's: ${blobDelta.join(", ") || "none"} - the orchestrator's pending seed apply, not a harness expectation`);
      if (total.trim() !== expDryTotal || dryTail !== expDryTail || drySdLine !== expSdLine || dryBlobLine !== expBlobLine) fail(`Import dry run: expected '${expDryTotal}', the diff text ending '${expDryTail}', its schedule_days line '${expSdLine}' (${planBlocked.length} blocked day(s) = ${planBlockedLines} blocked line(s), restated from the rows the app is served) and its blob line '${expBlobLine}' (${blobDelta.length} key(s) restated against the ${fixture ? "fixture" : "live"} blob), got '${total.trim()}' | '${dryTail}' | '${drySdLine}' | '${dryBlobLine}'`);
      else if (!new RegExp("call_periods: plan " + PLAN_P.periodRows.length + " row\\(s\\)").test(diffText) || !new RegExp("call_offers: plan " + PLAN_P.offerRows.length + " row\\(s\\)").test(diffText) || !diffText.includes(`offers status (${perLabel})`)) fail(`Import dry run: the diff text must carry the CLI's period legs ('call_periods: plan ${PLAN_P.periodRows.length} row(s)', 'call_offers: plan ${PLAN_P.offerRows.length} row(s)', 'offers status (${perLabel})'): ` + diffText.split("\n").filter(l => /^call_(periods|offers)|^offers status/.test(l)).join(" | ").slice(0, 400));
      else if (!legs0.includes(perLabel) || !Object.keys(PLAN_P.stats.offersByPerson).every(id => legs0.includes(`${nm(id)} ${PLAN_P.stats.offersByPerson[id]}`)) || !/applied by the CLI only/.test(legs0)) fail(`Import dry run: the seed-period-legs panel must name the period '${perLabel}', the offers per surgeon (${offersWords}) and say the legs are applied by the CLI only: ` + legs0.slice(0, 300));
      else if (!applyDisabled) fail("Import dry run: Apply must be disabled for a plan that carries offer periods (the legs are the CLI's)");
      else if (impWrites.length) fail("Import dry run wrote something: " + JSON.stringify(impWrites.map(w => w.method + " " + w.path)));
      else ok(`Import seed dry run (docs/silvis-seed.json): period-aware like the CLI - ${expChanges} change(s) = ${PLAN_P.periodRows.length} call_periods + ${PLAN_P.offerRows.length} call_offers upserts (authenticated-read tables, unknown to this dry run as to the CLI's; ${offersWords}) + ${avIns0.length} availability insert(s) + ${avDel0.length} retired-row delete(s) + ${blobDelta.length} blob key(s)${blobDelta.length ? " (" + blobDelta.join(", ") + " - the " + (fixture ? "fixture blob is the legacy plan's" : "live blob differs") + ")" : ""}; time_off / schedule_days 0 change(s)${planBlocked.length ? ` (+${planBlockedLines} blocked slot lines on ${planBlocked.length} plan days the app published since the import, kept as they are; ${planUnchanged.length} unchanged)` : ""}; the legs panel names '${perLabel}' and the offers per surgeon; Apply refused, no writes`);
      diffText.split("\n").filter(l => /^(call_schedule_data|schedule_days|availability|time_off|call_periods|call_offers|offers status|Total changes)/.test(l)).forEach(l => console.log("     " + l));
      await page.locator("[data-testid=card-setup_import]").screenshot({ path: path.join(OUT, "import-dryrun.png") });
      ok("screenshot test/ui/out/import-dryrun.png");
      // a seed with an injected contact KEY (no address anywhere - the key name alone is refused)
      const seedObj = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
      seedObj.roster[0] = { ...seedObj.roster[0], email: "redacted" };
      const before2 = writes.length;
      await page.setInputFiles("[data-testid=seed-file]", { name: "seed-with-contact-key.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seedObj)) });
      await page.waitForSelector("[data-testid=seed-error]", { timeout: 10000 });
      const errText2 = await page.$eval("[data-testid=seed-error]", el => el.innerText);
      const dry = await page.$("[data-testid=seed-dryrun]");
      const refToast = /Seed REFUSED: it carries contact data/.test(await bodyText());
      if (!/CONTACT_DATA_REFUSED/.test(errText2) || !/roster\[0\]\.email/.test(errText2)) fail("Import: the seed with an email key was not refused with CONTACT_DATA_REFUSED at roster[0].email: " + errText2.slice(0, 200));
      else if (dry) fail("Import: a dry-run panel is shown for the refused seed");
      else if (writesSince(before2).length) fail("Import: the refused seed produced writes: " + JSON.stringify(writesSince(before2).map(w => w.method + " " + w.path)));
      else if (!refToast) fail("Import: the refusal did not toast loudly");
      else ok("Import: a seed with an injected email KEY is refused loudly (CONTACT_DATA_REFUSED at roster[0].email; no dry run, no writes, toast)");
      // Apply path: a seed with ONE extra Burchett December date -> dry run shows the blob update
      // + 1 availability insert -> Apply (confirm accepted) -> snapshot 'seed_import' BEFORE the
      // blob PATCH and the availability POST; no schedule_days / time_off write; audit seed.import.
      const seed3 = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
      const decList = seed3.surgeonRules.s2.explicitAvailable["2026-12"];
      const has = (d) => decList.includes(d);
      let extra = null;
      for (let day = 2; day <= 30 && !extra; day++) { const d = "2026-12-" + String(day).padStart(2, "0"), p = "2026-12-" + String(day - 1).padStart(2, "0"), n = "2026-12-" + String(day + 1).padStart(2, "0"); if (!has(d) && !has(p) && !has(n)) extra = d; }
      if (!extra || !Array.isArray(decList)) fail("Import apply: could not pick an isolated extra December date for Burchett");
      else {
        decList.push(extra);
        const before3 = writes.length;
        await page.setInputFiles("[data-testid=seed-file]", { name: "seed-plus-one-date.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed3)) });
        await page.waitForSelector("[data-testid=seed-dryrun]", { timeout: 60000 });
        await page.waitForTimeout(400);
        const total3 = await page.$eval("[data-testid=seed-total]", el => el.innerText.replace(/\s+/g, " "));
        const diff3 = await page.$eval("[data-testid=seed-diff-text]", el => el.textContent);
        // RF2 review fix: a seed change under a core key moves settings too (the seedCoreHash stamp follows the seed-owned content).
        // Prompt 14 IP (9/23): the extra date sits inside the period Burchett submitted for (exhaustive), so the period-aware
        // plan makes it an OFFER row, not an available row (the period retires his in-period available rows): surgeonRules=update
        // + settings=update + the period / offer upserts (+ the retired-row deletes of the first pin, 0 live). The CLI's dry run
        // against the live project on 9/23 read 'Total changes: 83 (+30 blocked)' = 2 + 1 period + 80 offers.
        const plan3P = IMP.importPlan(seed3, { now: new Date().toISOString(), offerPeriods: true });
        // the extra date moves surgeonRules and settings; in fixture mode those two keys already differ (the fixture blob is
        // the legacy plan's), so the blob's share is the union - restated from plan3P's blob, as the first pin restates PLAN_P's
        const blobDelta3 = blobDeltaOf(plan3P.blob);
        if (!blobDelta3.includes("surgeonRules") || !blobDelta3.includes("settings")) fail(`Import apply dry run (extra ${extra}) premise: the extra date must move surgeonRules and settings in the restatement (blob keys differing: ${blobDelta3.join(", ") || "none"})`);
        const expTotal3 = blobDelta3.length + plan3P.periodRows.length + plan3P.offerRows.length + avDel0.length;
        const legs3 = await page.$eval("[data-testid=seed-period-legs]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
        if (plan3P.offerRows.length !== PLAN_P.offerRows.length + 1 || plan3P.availabilityRows.length !== PLAN_P.availabilityRows.length) fail(`Import apply dry run (extra ${extra}) premise: the period-aware plan of the seed plus one Burchett December date must carry one more offer row and the same availability rows (offers ${PLAN_P.offerRows.length} -> ${plan3P.offerRows.length}, availability ${PLAN_P.availabilityRows.length} -> ${plan3P.availabilityRows.length})`);
        else if (total3.trim() !== `Total changes: ${expTotal3}` + blockedSuffix || !/settings=update/.test(diff3) || !/surgeonRules=update/.test(diff3) || new RegExp("insert s2 available/any " + extra).test(diff3) || !new RegExp("call_offers: plan " + plan3P.offerRows.length + " row\\(s\\)").test(diff3) || !legs3.includes(`${nm("s2")} ${plan3P.stats.offersByPerson.s2}`)) fail(`Import apply dry run (extra ${extra}): expected 'Total changes: ${expTotal3}${blockedSuffix}' (surgeonRules + settings + ${plan3P.periodRows.length} period + ${plan3P.offerRows.length} offer upserts${avDel0.length ? " + " + avDel0.length + " retired-row delete(s)" : ""}, NO 'insert s2 available/any ${extra}' - the date is an offer - and the legs naming ${nm("s2")} ${plan3P.stats.offersByPerson.s2}${planBlocked.length ? ", the same " + planBlockedLines + " blocked lines" : ""}): ${total3.trim()} | ${diff3.split("\n").filter(l => /insert|surgeonRules|call_offers: plan/.test(l)).join(" | ")} | legs: ${legs3.slice(0, 200)}`);
        else ok(`Import apply dry run: extra Burchett date ${extra} -> ${expTotal3} changes as the CLI counts them (surgeonRules=update, settings=update - the seedCoreHash stamp, ${plan3P.periodRows.length} period + ${plan3P.offerRows.length} offer upserts - the date is one more offer of ${nm("s2")}'s, not an available row)${planBlocked.length ? ", " + planBlockedLines + " blocked" : ""}`);
        // Prompt 14 IP (9/23): the in-app plan is period-aware, but the app has no writer for call_periods / call_offers and
        // never deletes the rows a period retires, so a seed that carries periods is dry-run only in the app - the block note
        // and the legs panel show, Apply is disabled although the diff has changes, the importer's period-aware status table
        // is in the diff text, nothing is written. The Apply mechanics below then run on the same seed WITHOUT offerPeriods
        // (the legacy plan: no legs, and Burchett's retired in-period available rows are back in it - see the restatement).
        {
          const seedPeriodCount = Array.isArray(seed3.offerPeriods) ? seed3.offerPeriods.length : 0;
          const blockNote = await page.$("[data-testid=seed-period-block]");
          const blockText = blockNote ? await blockNote.innerText() : "";
          const applyDisabled3 = await page.$eval("[data-testid=seed-apply]", el => el.disabled);
          const periodWrites = writesSince(before3).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off|call_offers|call_periods)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
          if (!seedPeriodCount) fail("Import period refusal premise: docs/silvis-seed.json carries no offerPeriods[] - the refusal cannot be exercised");
          else if (!blockNote || !new RegExp("carries " + seedPeriodCount + " offer period\\(s\\)").test(blockText) || !/scripts\/import-seed\.js --apply/.test(blockText)) fail("Import period refusal: the seed-period-block note is missing or does not name the period count and the CLI command: " + blockText.slice(0, 240));
          else if (!applyDisabled3) fail(`Import period refusal: Apply must be disabled for a plan that carries offer periods (${expTotal3} changes in the diff, still refused - the legs are the CLI's)`);
          else if (!/offers status \(/.test(diff3) || /did NOT convert/.test(diff3)) fail("Import period refusal: the diff text must carry the importer's period-aware status table ('offers status (<label>): ...') and no 'did NOT convert' line");
          else if (!legs3 || !legs3.includes(seed3.offerPeriods[0].label) || !/applied by the CLI only/.test(legs3)) fail("Import period refusal: the seed-period-legs panel must name the period and say the legs are applied by the CLI only: " + legs3.slice(0, 240));
          else if (periodWrites.length) fail("Import period refusal wrote something: " + JSON.stringify(periodWrites.map(w => w.method + " " + w.path)));
          else ok(`Import: a seed carrying ${seedPeriodCount} offer period(s) is dry-run only in the app - seed-period-block note (period count + the CLI command), the legs panel (period '${seed3.offerPeriods[0].label}', offers per surgeon, 'applied by the CLI only'), Apply disabled at ${expTotal3} changes, the period-aware status table in the diff, no writes`);
          await page.locator("[data-testid=card-setup_import]").screenshot({ path: path.join(OUT, "import-period-refusal.png") });
          ok("screenshot test/ui/out/import-period-refusal.png");
          delete seed3.offerPeriods;
          const dryResp = page.waitForResponse(r => r.url().includes("/rest/v1/availability?select=*"), { timeout: 60000 }).catch(() => null);
          await page.setInputFiles("[data-testid=seed-file]", { name: "seed-plus-one-date-no-periods.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed3)) });
          await dryResp;
          await page.waitForSelector("[data-testid=seed-dryrun]", { timeout: 60000 });
          await page.waitForTimeout(600);
          const total3b = await page.$eval("[data-testid=seed-total]", el => el.innerText.replace(/\s+/g, " "));
          const diff3b = await page.$eval("[data-testid=seed-diff-text]", el => el.textContent);
          // IP: without offerPeriods the plan equals the legacy one (the app still passes offerPeriods: true, as the CLI
          // does, so the diff text carries the CLI's two 'plan 0 row(s)' lines and no status table; no legs panel, no
          // block note) and the available rows the period retired (Burchett's in-period lists) are back in it, so the dry
          // run reads surgeonRules + settings + every availability row the live table lacks (the retired rows + the extra
          // date; just the extra before the period apply).
          const plan3L = IMP.importPlan(seed3, { now: PLAN_TS });
          const plan3LKeys = new Set(plan3L.availabilityRows.map(avKey0));
          const avIns3L = plan3L.availabilityRows.filter(r => !haveLiveAv.has(avKey0(r)));
          const avDel3L = liveAv0.filter(r => r.source === "seed" && !plan3LKeys.has(avKey0(r)));
          const blobDelta3L = blobDeltaOf(plan3L.blob); // surgeonRules + settings (the extra date) - the legacy plan's blob, restated like the pins above
          const expTotal3b = blobDelta3L.length + avIns3L.length + avDel3L.length;
          if (total3b.trim() !== `Total changes: ${expTotal3b}` + blockedSuffix || !new RegExp("insert s2 available/any " + extra).test(diff3b) || !/call_periods: plan 0 row\(s\)/.test(diff3b) || !/call_offers: plan 0 row\(s\)/.test(diff3b) || /offers status \(/.test(diff3b)) fail(`Import apply dry run (no periods): the plan of the same seed without offerPeriods must read 'Total changes: ${expTotal3b}${blockedSuffix}' (surgeonRules + settings + ${avIns3L.length} availability insert(s) incl. 'insert s2 available/any ${extra}'${avDel3L.length ? " + " + avDel3L.length + " delete(s)" : ""}; the CLI's 'call_periods: plan 0 row(s)' / 'call_offers: plan 0 row(s)' lines, no status table) - got '${total3b.trim()}' | ${diff3b.split("\n").filter(l => /^availability|insert s2 available\/any 2026-12|^call_(periods|offers)|^offers status/.test(l)).slice(0, 6).join(" | ")}`);
          else if (await page.$("[data-testid=seed-period-block]") || await page.$("[data-testid=seed-period-legs]")) fail("Import apply dry run (no periods): neither the period block note nor the legs panel may show for a period-free seed");
          else if (await page.$eval("[data-testid=seed-apply]", el => el.disabled)) fail(`Import apply dry run (no periods): Apply must be enabled (${expTotal3b} changes, no periods)`);
          else ok(`Import apply dry run (no periods): the same seed without offerPeriods -> ${total3b.trim()} (= the legacy plan: ${avIns3L.length} availability insert(s) = the extra date${avIns3L.length > 1 ? " + the " + (avIns3L.length - 1) + " rows the period retired, which a period-free seed would re-add - the reason a period-carrying seed is refused" : ""}; the CLI's 'plan 0 row(s)' lines for the two offer tables), no block note, no legs, Apply enabled`);

        }
        // Prompt 12 SM2: the result panel's counts are restated from the harness's own data, never from
        // the app's summary (the pre-SM2 pin hard-coded Prompt 6's 37-row plan and four Thanksgiving days):
        //   availability / time_off - the plan for seed3 (the seed + the extra date), keyed the way the app
        //     keys them (person|kind|role|start|end|source, person|start|end), against the live tables (one
        //     anon read each; the fixture rows in fixture mode): inserted = the plan rows the table lacks
        //     (exactly the extra date once the seed is applied), skipped = the rest;
        //   schedule_days - the app writes a plan day only when its LIVE row is still seed-owned (source
        //     'import', updated_by 'seed') AND the in-memory day still equals that live row; every other
        //     plan day is 'kept (app-edited)': the days the app published since the import (not seed-owned)
        //     plus any seed-owned day whose in-session edit / publish the app still holds. The mocked writes
        //     never reach the table, so the app's background poll (refreshDays) re-adopts the live row -
        //     wholesale, source and note included - for every persisted day; WHICH of this run's edits are
        //     still in the map at Apply time is therefore a timer fact, and the premise is OBSERVED the way
        //     settleMapToLive does it: the grid cell of every plan day is read, and while a cell still
        //     differs from the live rows, or no schedule_days GET has answered since this run's last
        //     schedule_days write (a holders-unchanged write changes source / note only, which no cell
        //     shows), the harness waits for the app's poll (at most twice). Then
        //       kept     = plan days whose live row is not seed-owned + seed-owned (or row-less) plan days
        //                  whose cell still differs from the live rows,
        //       updated  = seed-owned, clean, differing from the plan (0 once the seed is applied),
        //       inserted = row-less plan days with an empty cell (0 once the seed is applied).
        const avKey = (r) => [r.person_id, r.kind, r.role || "any", String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10), r.source || ""].join("|");
        const toKey = (r) => [r.person_id, String(r.start_date).slice(0, 10), String(r.end_date).slice(0, 10)].join("|");
        const anonRows = async (table, select) => { const r = await fetch(`https://${SUPABASE_HOST}/rest/v1/${table}?select=${select}`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY } }); if (!r.ok) throw new Error(`${table} anon read: HTTP ${r.status}`); const rows = await r.json(); if (!Array.isArray(rows)) throw new Error(`${table} anon read: body is not an array`); return rows; };
        const liveAv = fixture ? fixture.availability : await anonRows("availability", "person_id,kind,role,start_date,end_date,source");
        const liveTo = fixture ? fixture.time_off : await anonRows("time_off", "person_id,start_date,end_date");
        const plan3 = IMP.importPlan(seed3, { now: PLAN_TS });
        const haveAv = new Set(liveAv.map(avKey)), haveTo = new Set(liveTo.map(toKey));
        const expAvIns = plan3.availabilityRows.filter(r => !haveAv.has(avKey(r))), expToIns = plan3.timeOffRows.filter(r => !haveTo.has(toKey(r)));
        const expAvSkip = plan3.availabilityRows.length - expAvIns.length, expToSkip = plan3.timeOffRows.length - expToIns.length;
        // IP (9/23): a period-free seed's legacy plan carries the available rows the period retired for the submitted surgeons
        // (exactly plan3 minus the period-aware plan3P - Burchett's in-period rows); the app re-adds them, which is why a seed
        // WITH periods is refused. The premise allows exactly those rows plus the extra date to be missing live, nothing else.
        const planPKeys = new Set(plan3P.availabilityRows.map(avKey));
        const retiredKeys = new Set(plan3.availabilityRows.map(avKey).filter(k => !planPKeys.has(k)));
        const unexpectedMissing = expAvIns.filter(r => !retiredKeys.has(avKey(r)));
        if (unexpectedMissing.length || !expAvIns.some(r => r.start_date === extra && r.person_id === "s2") || expToIns.length) fail(`Import apply premise: the live availability / time_off tables do not hold the seed - ${expAvIns.length} availability row(s) missing (${expAvIns.map(r => r.person_id + " " + r.start_date).join(", ")}; expected the extra ${extra} plus at most the ${Math.max(0, retiredKeys.size - 1)} row(s) the period retires; unexpected: ${unexpectedMissing.map(r => r.person_id + " " + r.start_date).join(", ") || "none"}), ${expToIns.length} time_off row(s) missing - the orchestrator's pending seed apply`);
        const planMonths = [...new Set(planDays.map(d => d.slice(0, 7)))];
        const readPlanCells = async () => { const out = {}; for (const ym of planMonths) { await showMonth(+ym.slice(0, 4), +ym.slice(5, 7) - 1); const cells = await page.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary") || null, b: e.getAttribute("data-backup") || null, ext: e.getAttribute("data-ext") || null }))); cells.forEach(c => { if (planByDay[c.day]) out[c.day] = c; }); } return out; };
        const cellDiffers = (c, d) => { const l = liveByDay[d] || {}; return !c || c.p !== (l.primary_id || null) || c.b !== (l.backup_id || null) || c.ext !== (l.external_cover || null); };
        const lastDaysWrite = writes.map((w, i) => w.path.startsWith("/rest/v1/schedule_days") ? i : -1).filter(i => i >= 0).pop();
        await page.click('button[data-tab="calendar"]');
        let planCells = await readPlanCells();
        let dirty = planDays.filter(d => cellDiffers(planCells[d], d));
        let polled = lastDaysWrite === undefined || writesAtLastDaysGet > lastDaysWrite;
        for (let round = 1; round <= 2 && (dirty.length || !polled); round++) {
          console.log(`     (Import apply premise: ${dirty.length} plan-day cell(s) still differ from the live rows${dirty.length ? " (" + dirty.slice(0, 5).join(", ") + (dirty.length > 5 ? ", ..." : "") + ")" : ""}${polled ? "" : "; no schedule_days GET since this run's last schedule_days write (#" + lastDaysWrite + ")"} - waiting for the app's background poll, round ${round}/2)`);
          const got = await page.waitForResponse(isDaysGet, { timeout: 75000 }).then(() => true).catch(() => false);
          if (got) polled = true; else console.log("     (Import apply premise: no GET /rest/v1/schedule_days within 75 s)");
          await page.waitForTimeout(1500); // the merge + render
          planCells = await readPlanCells();
          dirty = planDays.filter(d => cellDiffers(planCells[d], d));
        }
        const unreadable = planDays.filter(d => !planCells[d]);
        const keptNotOwned = planDays.filter(d => liveByDay[d] && !seedOwned(liveByDay[d]));
        const keptDirty = planDays.filter(d => !keptNotOwned.includes(d) && dirty.includes(d));
        const expKept = keptNotOwned.length + keptDirty.length;
        const expUpdated = planDays.filter(d => liveByDay[d] && seedOwned(liveByDay[d]) && !dirty.includes(d) && !sameRow(liveByDay[d], planByDay[d])).length;
        const expInserted = planDays.filter(d => !liveByDay[d] && !dirty.includes(d)).length;
        const expResult = `availability inserted ${expAvIns.length}, skipped ${expAvSkip}; time_off inserted ${expToIns.length}, skipped ${expToSkip}; schedule_days inserted ${expInserted}, updated ${expUpdated}, kept (app-edited) ${expKept}.`;
        if (unreadable.length) fail(`Import apply premise: ${unreadable.length} plan day(s) not readable in the grid: ${unreadable.slice(0, 5).join(", ")}`);
        if (!polled) fail(`Import apply premise: no schedule_days GET answered after this run's last schedule_days write within two waits - the kept count ${expKept} is derived from the cells as observed, but a holders-unchanged in-session write may still sit in the map`);
        console.log(`     (Import apply, restated over the plan's ${planDays.length} days: ${keptNotOwned.length} not seed-owned live (published / edited in the app since the import), ${keptDirty.length} still carrying this run's edits${keptDirty.length ? " (" + keptDirty.join(", ") + ")" : ""} -> kept ${expKept}, updated ${expUpdated}, inserted ${expInserted}; availability: plan ${plan3.availabilityRows.length} rows, ${expAvIns.length} missing live -> inserted ${expAvIns.length}, skipped ${expAvSkip}; time_off: plan ${plan3.timeOffRows.length} rows -> inserted ${expToIns.length}, skipped ${expToSkip})`);
        await page.click('button[data-tab="setup"]');
        await openCard("setup_import");
        await page.waitForSelector("[data-testid=seed-apply]", { timeout: 5000 });
        const onDialog = (d) => d.accept();
        page.on("dialog", onDialog);
        const beforeApply = writes.length;
        await page.click("[data-testid=seed-apply]");
        await page.waitForSelector("[data-testid=seed-result]", { timeout: 60000 });
        page.off("dialog", onDialog);
        await page.waitForTimeout(800);
        const aseq = writesSince(beforeApply);
        const aSnap = aseq.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
        // fix round 2 (safe-4): the PATCH is a compare-and-swap on the stamp seen at dry-run time (?id=eq.main&updated_at=eq.<seen>)
        const aBlob = aseq.findIndex(w => w.method === "PATCH" && /^\/rest\/v1\/call_schedule_data\?id=eq\.main&updated_at=eq\.\d{4}-\d{2}-\d{2}T/.test(w.path));
        const aAv = aseq.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/availability"));
        const aBad = aseq.filter(w => ((expInserted + expUpdated) === 0 && w.path.startsWith("/rest/v1/schedule_days")) || (expToIns.length === 0 && w.path.startsWith("/rest/v1/time_off")));
        const avBody = aAv >= 0 ? JSON.parse(aseq[aAv].body || "[]") : [];
        const blobBody = aBlob >= 0 ? JSON.parse(aseq[aBlob].body || "{}") : {};
        const resText = await page.$eval("[data-testid=seed-result]", el => el.innerText.replace(/\s+/g, " "));
        const impAudit = auditSince(beforeApply, "seed.import");
        if (aSnap < 0 || aseq[aSnap].snapshotReason !== "seed_import") fail("Import apply: no snapshot 'seed_import' recorded: " + JSON.stringify(aseq.map(w => w.method + " " + w.path)));
        else if (aBlob < 0 || aBlob < aSnap) fail(`Import apply: blob PATCH missing or before the snapshot (snap #${aSnap}, blob #${aBlob})`);
        else if (!(blobBody.data && blobBody.data.surgeonRules && blobBody.data.surgeonRules.s2 && blobBody.data.surgeonRules.s2.explicitAvailable["2026-12"].includes(extra)) || !blobBody.data.roster || "schedule" in blobBody.data) fail("Import apply: the merged blob is wrong: keys " + Object.keys(blobBody.data || {}).join(","));
        else if (aAv < 0 || aAv < aSnap || avBody.length !== expAvIns.length || !avBody.some(r => r.start_date === extra && r.person_id === "s2" && r.source === "seed") || avBody.some(r => !expAvIns.some(e => avKey(e) === avKey(r)))) fail(`Import apply: availability insert wrong (index ${aAv}, snap ${aSnap}; expected exactly the ${expAvIns.length} missing row(s) incl. ${extra}): ` + JSON.stringify(avBody).slice(0, 600));
        else if (aBad.length) fail("Import apply: schedule_days / time_off were written although the restatement expects no change there: " + JSON.stringify(aBad.map(w => w.method + " " + w.path)));
        else if (!/Import applied/.test(resText) || !/blob merged/.test(resText) || !resText.includes(expResult)) fail(`Import apply: result panel wrong (expected 'Import applied - blob merged; ${expResult}' - ${expAvIns.length} availability insert of ${plan3.availabilityRows.length} plan rows, ${expToIns.length} time_off insert of ${plan3.timeOffRows.length}, ${expKept} plan day(s) kept = ${keptNotOwned.length} not seed-owned live + ${keptDirty.length} still carrying this run's edits): ` + resText);
        else if (!impAudit) fail("Import apply: no audit_log 'seed.import'");
        else ok(`Import apply: snapshot 'seed_import' (#${aSnap}) -> blob PATCH ?id=eq.main (#${aBlob}, merged over the live blob) -> availability POST (#${aAv}) with exactly the ${expAvIns.length} missing row(s) (${extra}${expAvIns.length > 1 ? " + the " + (expAvIns.length - 1) + " rows the period retired - what a period-free seed re-adds" : ""}); ${(expInserted + expUpdated) ? "" : "no schedule_days write, "}${expToIns.length ? "" : "no time_off write; "}audit seed.import; result equals the restatement: "${resText.slice(resText.indexOf("availability inserted"), resText.indexOf("availability inserted") + expResult.length)}"`);

        // Prompt 16 A4: after adoptBlob(merged) the autosave that fires on the adopted state must write NOTHING - the
        // adoption recorded the merged blob's signature (the no-write-after-adoption rule), so the import's own merge
        // PATCH (#aBlob) is the only call_schedule_data write in the window. Should one appear anyway it must at least
        // carry the merged keys (the pre-A4 pin filtered POSTs the autosave no longer sends and passed vacuously).
        await page.waitForTimeout(1200);
        const laterBlobWrites = writesSince(beforeApply, "/rest/v1/call_schedule_data").filter(w => (w.method === "PATCH" || w.method === "POST") && !(aBlob >= 0 && w === aseq[aBlob]));
        const hasExtra = (b) => !!(b && b.data && b.data.surgeonRules && b.data.surgeonRules.s2 && b.data.surgeonRules.s2.explicitAvailable && Array.isArray(b.data.surgeonRules.s2.explicitAvailable["2026-12"]) && b.data.surgeonRules.s2.explicitAvailable["2026-12"].includes(extra));
        const laterBad = laterBlobWrites.map(bodyOf).find(b => !hasExtra(b));
        if (laterBad) fail("Import apply: a call_schedule_data write after the merge dropped the merged blob keys (adoptBlob did not take): keys " + Object.keys((laterBad && laterBad.data) || {}).join(","));
        else if (laterBlobWrites.length) fail(`Import apply (A4): ${laterBlobWrites.length} call_schedule_data write(s) followed the merge PATCH within 1200 ms although adoptBlob(merged) recorded its signature - the autosave re-wrote an adopted blob: ` + JSON.stringify(laterBlobWrites.map(w => w.method + " " + w.path)));
        else ok("Import apply (A4): no call_schedule_data write follows the merge PATCH within 1200 ms - adoptBlob(merged) recorded the signature and the autosave that fires on the adopted state skips (the no-write-after-adoption rule)");
        // fix round 2 (safe-4): (1) the dry run warns when the live blob was last saved in the
        // app (updated_by not 'seed') and names the keys Apply would replace; (2) Apply re-reads
        // the stamp first and refuses - zero writes, no snapshot - when it moved since the dry run.
        blobReadOverride = { updated_at: "2026-09-22T10:00:00.000000+00:00", updated_by: "s1" };
        await page.setInputFiles("[data-testid=seed-file]", { name: "seed-plus-one-date-2.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed3)) });
        await page.waitForSelector("[data-testid=seed-dryrun]", { timeout: 60000 });
        await page.waitForTimeout(400);
        const blobWarn = await page.$eval("[data-testid=seed-blob-warning]", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
        if (!/last saved in the app by Khan/.test(blobWarn) || !/surgeonRules/.test(blobWarn) || !/replaces these top-level keys wholesale/.test(blobWarn)) fail("Import dry run (app-saved blob): expected the warning naming Khan and the replaced key surgeonRules: " + blobWarn.slice(0, 240));
        else ok("Import dry run (blob updated_by s1): warns that the setup was last saved in the app by Khan and that Apply replaces surgeonRules wholesale");
        blobReadOverride = { updated_at: "2026-09-22T10:05:00.000000+00:00", updated_by: "s1" };
        const onDialog2 = (d) => d.accept();
        page.on("dialog", onDialog2);
        const beforeStale = writes.length;
        await page.click("[data-testid=seed-apply]");
        const staleToast = await waitFor(async () => /changed since the dry run/.test(await bodyText()), 20000);
        page.off("dialog", onDialog2);
        await page.waitForTimeout(700);
        blobReadOverride = null;
        const staleWrites = writesSince(beforeStale).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off|audit_log)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
        const staleErr = await page.$eval("[data-testid=seed-error]", el => el.innerText).catch(() => "");
        if (!staleToast) fail("Import apply (setup changed since the dry run): no 'changed since the dry run' toast");
        else if (staleWrites.length) fail("Import apply (setup changed since the dry run): something was written: " + JSON.stringify(staleWrites.map(w => w.method + " " + w.path)));
        else if (!/Setup changed since the dry run/.test(staleErr)) fail("Import apply (setup changed): the card does not say the dry run is stale: " + staleErr.slice(0, 200));
        else ok("Import apply with call_schedule_data.updated_at moved since the dry run: refused before the snapshot (toast + card), zero snapshot / blob / availability / time_off / schedule_days / audit writes");
      }
    }
  } catch (e) {
    fail("Slice E harness exception: " + (e && e.stack || e));
    try { await page.screenshot({ path: path.join(OUT, "failure-setup.png"), fullPage: true }); } catch (e2) {}
  }

  // ---- Prompt 12 item TH: theme (O.1-O.3 + R) ----
  // (a) contrast table over every token pair the theme defines (contrast.mjs).
  try {
    const rows = contrastTable();
    console.log("     theme contrast table (text 4.5:1, label 3:1):\n" + formatTable(rows).split("\n").map(l => "       " + l).join("\n"));
    const bad = rows.filter(r => !r.ok);
    if (bad.length) fail("theme contrast: " + bad.length + " pair(s) below their minimum: " + bad.map(r => `${r.theme} ${r.pair} ${r.fg} on ${r.bg} ${r.ratio}:1 (min ${r.min})`).join("; "));
    else ok(`theme contrast: all ${rows.length} token pairs meet their minimum (${rows.filter(r => r.klass === "text").length} text pairs at 4.5:1, ${rows.filter(r => r.klass === "label").length} label / glyph pairs at 3:1)`);
  } catch (e) { fail("theme contrast table: " + errLine(e)); }
  // (b) source grep: the Davenport blues, the old theme green and "DSG" outside comments.
  {
    const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/<!--[\s\S]*?-->/g, "");
    const needles = ["#1a6fa8", "#2488c8", "1f7a5c", "DSG"];
    const countIn = (f) => { const code = stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")); return needles.map(n => [n, (code.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length]); };
    const hits = [];
    for (const f of ["index-source.html", "app-styles.js", "manifest.json", "config.js", "helpers.js"]) for (const [n, c] of countIn(f)) if (c) hits.push(`${f}: ${n} x${c}`);
    if (hits.length) fail("theme grep: Davenport blue / old green / DSG still live in the source: " + hits.join(", "));
    else ok("theme grep: #1a6fa8 / #2488c8 / 1f7a5c / DSG absent outside comments in index-source.html, app-styles.js, manifest.json, config.js, helpers.js");
  }
  // (b2) Prompt 16 B2: the six regions (test/ui/theme-regions.js) are written in theme tokens. Source side: the
  // region table of contrast.mjs (every literal text colour still in a region, both themes) must be empty or all ok.
  // Runtime side, on COMPUTED colours in both themes at 390 px: Settings > Notification settings (the pref labels,
  // the reminder-hour label) and Restore from snapshot (its rows, or the empty / loading line), the Setup > Generate
  // SuCheck labels (module scope: the light token repainted by the dark sheet), the Open shifts board (every text
  // element in the card except the roster chips, which are label-class pills on their own tint, and disabled buttons)
  // - each text element >= 4.5:1 against the first painted background above it (a gradient's first stop counts; a
  // large label, 24 px or 18.66 px at 700+, needs 3:1). The claim sheet is covered by the region table and the
  // Prompt 13 claim step above, the publish diff by the region table and the publish-dialog steps. Screenshots
  // b2-settings-<theme>-390.png, b2-openshifts-<theme>-390.png - full-page, so the PNG shows the cards the probe
  // measured (at 390 px the notification and snapshot cards sit below the fold of one 844 px viewport).
  try {
    const reg = regionTable();
    if (reg.length) console.log("     six-region literal table:\n" + formatRegionTable(reg).split("\n").map(l => "       " + l).join("\n"));
    const regBad = reg.filter(r => !r.ok);
    if (regBad.length) fail("B2 region table: " + regBad.length + " literal text colour(s) below their minimum: " + regBad.map(r => `${r.region} ${r.theme} line ${r.line} <${r.tag}> ${r.literal} paints ${r.fg} on ${r.bg} ${r.ratio}:1`).join("; "));
    else ok(`B2 region table: ${reg.length} literal text colour(s) left in the six regions${reg.length ? ", all at their minimum" : " - every text colour is a theme token"}`);
  } catch (e) { fail("B2 region table: " + errLine(e)); }
  {
    const measure = (rootSel, skipSel) => page.evaluate(([rootSel, skipSel]) => {
      const parseRgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(",").map(x => parseFloat(x)); return p.length >= 4 && p[3] === 0 ? null : p.slice(0, 3); };
      const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
      const ratio = (a, b) => { const la = lum(a), lb = lum(b); return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100; };
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          const c = parseRgb(cs.backgroundColor); if (c) return c;
          if (/gradient/.test(cs.backgroundImage)) { const g = parseRgb(cs.backgroundImage); if (g) return g; }
        }
        return parseRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
      };
      const roots = Array.from(document.querySelectorAll(rootSel));
      const els = roots.flatMap(r => [r].concat(Array.from(r.querySelectorAll("*"))));
      const rows = [];
      for (const el of els) {
        if (/^(OPTION|SELECT|INPUT|SCRIPT|STYLE|PRE)$/.test(el.tagName)) continue;
        if (skipSel && (el.matches(skipSel) || el.closest(skipSel))) continue;
        const own = Array.from(el.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
        if (!own) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || !el.getClientRects().length) continue;
        const fg = parseRgb(cs.color); if (!fg) continue;
        const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
        const bg = bgOf(el);
        rows.push({ text: own.slice(0, 40), tag: el.tagName.toLowerCase(), color: cs.color, bg: "rgb(" + bg.join(", ") + ")", ratio: ratio(fg, bg), min: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5 });
      }
      return rows;
    }, [rootSel, skipSel || null]);
    const judge = (label, rows) => {
      const bad = rows.filter(r => r.ratio < r.min);
      if (!rows.length) fail(`B2 ${label}: nothing measured (the region did not render)`);
      else if (bad.length) fail(`B2 ${label}: ${bad.length} of ${rows.length} text element(s) below their minimum: ` + bad.slice(0, 6).map(r => `<${r.tag}> '${r.text}' ${r.color} on ${r.bg} ${r.ratio}:1 (min ${r.min})`).join("; "));
      else ok(`B2 ${label}: ${rows.length} text element(s) at their minimum or better (worst ${Math.min(...rows.map(r => r.ratio))}:1)`);
    };
    const expandSettings = async (title, marker) => { if (!(await page.$(marker))) { const t = await page.$(`text=${title}`); if (t) { await t.click(); await page.waitForTimeout(250); } } };
    try {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width: 1180, height: 900 });
        await page.click('button[data-tab="settings"]');
        await page.click(`button:has-text('${theme === "dark" ? "Dark" : "Light"}')`);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        await expandSettings("Notification settings", "[data-testid=notif-pref], [data-testid=notif-prefs-load-failed]");
        await expandSettings("Restore from snapshot", "[data-testid=snapshot-row], [data-testid=snapshot-empty]");
        await page.waitForTimeout(300);
        judge(`${theme} 390 notification settings`, await measure("[data-testid=notif-pref], [data-testid=notif-hour-label]"));
        if (theme === "light") {
          // Prompt 20 F1 (review 9/24): the prefs save must name on_conflict=person_id - revision o moves the table's primary key
          // to id, and an upsert without it would merge on id and 409 every existing surgeon's save. Two flips inside the 500 ms
          // debounce: exactly one mocked POST, and the switch ends where it started.
          try {
            const box = page.locator("[data-testid=notif-pref] input[type=checkbox]").first();
            if (!(await box.count())) fail("F1 prefs upsert: no notification switch rendered (the harness account is not linked?)");
            else {
              const was = await box.isChecked();
              const w0 = writes.length;
              await box.click();
              await box.click();
              await page.waitForTimeout(1000);
              const posts = writes.slice(w0).filter((w) => w.path.startsWith("/rest/v1/notification_preferences"));
              let row = null; try { const b = JSON.parse(posts.length ? posts[0].body : "null"); row = Array.isArray(b) ? b[0] : b; } catch (e) {}
              if (posts.length !== 1) fail(`F1 prefs upsert: expected exactly one write to notification_preferences, got ${posts.length}: ` + posts.map((w) => `${w.method} ${w.path}`).join(", "));
              else if (posts[0].method !== "POST" || posts[0].path !== "/rest/v1/notification_preferences?on_conflict=person_id") fail(`F1 prefs upsert: expected POST /rest/v1/notification_preferences?on_conflict=person_id, got ${posts[0].method} ${posts[0].path}`);
              else if (!/resolution=merge-duplicates/.test(posts[0].prefer)) fail(`F1 prefs upsert: Prefer must carry resolution=merge-duplicates, got '${posts[0].prefer}'`);
              else if (!row || typeof row.person_id !== "string" || !row.person_id || "id" in row || "profile_id" in row) fail("F1 prefs upsert: the body must carry the linked person_id and neither id nor profile_id: " + String(posts[0].body).slice(0, 200));
              else if ((await box.isChecked()) !== was) fail("F1 prefs upsert: the switch did not return to its starting state after two flips");
              else ok(`F1 prefs upsert: one POST ${posts[0].path} (Prefer ${posts[0].prefer}) for ${row.person_id}; the switch is back where it started`);
            }
          } catch (e) { fail("F1 prefs upsert: " + errLine(e)); }
        }
        judge(`${theme} 390 snapshot list`, await measure("[data-testid=snapshot-row], [data-testid=snapshot-empty]"));
        await page.locator("[data-testid=notif-pref], [data-testid=notif-prefs-load-failed]").first().scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, `b2-settings-${theme}-390.png`), fullPage: true });
        await page.click('button[data-tab="setup"]');
        const genCard = page.locator("[data-testid=card-setup_generate]");
        if ((await genCard.count()) && (await genCard.getAttribute("data-open")) !== "1") { await page.click("[data-testid=card-toggle-setup_generate]"); await page.waitForTimeout(250); }
        judge(`${theme} 390 SuCheck labels (Setup > Generate)`, await measure("label[data-sucheck]"));
        await page.click('button[data-tab="openshifts"]');
        await page.waitForSelector("[data-testid=openshifts-table]", { timeout: 10000 });
        await page.waitForTimeout(300);
        judge(`${theme} 390 open-shifts board`, await measure("[data-testid=openshifts-card]", "[data-eligible-id], button[disabled]"));
        await page.screenshot({ path: path.join(OUT, `b2-openshifts-${theme}-390.png`), fullPage: true });
      }
      ok("screenshots test/ui/out/b2-settings-{light,dark}-390.png, b2-openshifts-{light,dark}-390.png");
    } catch (e) { fail("B2 computed-colour probe: " + errLine(e)); try { await page.screenshot({ path: path.join(OUT, "failure-b2.png"), fullPage: true }); } catch (e2) {} }
    await page.setViewportSize({ width: 1180, height: 900 });
    try { await page.click('button[data-tab="settings"]'); await page.click("button:has-text('Light')"); await page.click('button[data-tab="calendar"]'); await page.waitForTimeout(300); } catch (e) { fail("B2 probe: could not restore light / calendar: " + errLine(e)); }
  }
  // (c) the sign-in screen in both themes: a second page with the session token removed before the app boots.
  const signin = await context.newPage();
  watchPage(signin, "signin");
  await signin.addInitScript(() => { try { localStorage.removeItem("silvis-auth-token"); localStorage.removeItem("silvis-auth-refresh"); } catch (e) {} });
  await signin.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
    const req = route.request();
    if (req.method() !== "GET") { writes.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postData() || "", public: true }); return route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }
    const fx = fixtureAnswer(new URL(req.url()));
    if (fx) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(fx) });
    const headers = { ...req.headers() }; headers["authorization"] = "Bearer " + ANON_KEY;
    return route.continue({ headers });
  });
  await signin.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
  const themeProbe = (pg) => pg.evaluate(() => {
    const tile = Array.from(document.querySelectorAll("span")).find(s => s.textContent.trim() === "SSC");
    const btn = Array.from(document.querySelectorAll("button")).find(b => /^Sign in$/.test(b.textContent.trim()));
    const link = Array.from(document.querySelectorAll("button")).find(b => /^Forgot your password\?$/.test(b.textContent.trim()));
    const cs = (el, p) => el ? getComputedStyle(el)[p] : "";
    return { tileBg: cs(tile && tile.parentElement, "backgroundImage"), tileColor: cs(tile, "color"), btnBg: cs(btn, "backgroundImage"), btnColor: cs(btn, "color"), linkColor: cs(link, "color"), bodyBg: getComputedStyle(document.body).backgroundColor, title: (document.querySelector("h2") || {}).textContent || "" };
  });
  for (const theme of ["light", "dark"]) {
    try {
      await signin.addInitScript((dk) => { try { localStorage.setItem("silvis-dark-mode", dk ? "true" : "false"); } catch (e) {} }, theme === "dark");
      await signin.goto(BASE, { waitUntil: "domcontentloaded" });
      await signin.waitForSelector("text=Sign in to your account", { timeout: 20000 });
      await signin.waitForTimeout(300);
      const p = await themeProbe(signin);
      const orange = /rgb\(255, 95, 5\)/;
      if (!orange.test(p.tileBg) || !/rgb\(232, 82, 10\)/.test(p.tileBg)) fail(`sign-in ${theme}: the SSC tile is not the orange gradient #FF5F05 -> #E8520A: ${p.tileBg}`);
      else if (p.tileColor !== "rgb(255, 255, 255)") fail(`sign-in ${theme}: SSC on the tile is not white: ${p.tileColor}`);
      else ok(`sign-in ${theme}: SSC tile = orange gradient, white text`);
      if (!orange.test(p.btnBg) || p.btnColor !== "rgb(255, 255, 255)") fail(`sign-in ${theme}: the Sign in button is not orange with white text: ${p.btnBg} / ${p.btnColor}`); else ok(`sign-in ${theme}: 'Sign in' button = orange gradient, white text`);
      const wantLink = theme === "dark" ? "rgb(255, 138, 76)" : "rgb(194, 65, 12)";
      if (p.linkColor !== wantLink) fail(`sign-in ${theme}: the 'Forgot your password?' link is not the orange text token (${wantLink}): ${p.linkColor}`); else ok(`sign-in ${theme}: 'Forgot your password?' link = orange text ${p.linkColor}`);
      const wantBody = theme === "dark" ? "rgb(11, 26, 51)" : "rgb(246, 248, 251)";
      if (p.bodyBg !== wantBody) fail(`sign-in ${theme}: page background is ${p.bodyBg}, expected ${wantBody}`); else ok(`sign-in ${theme}: page background ${p.bodyBg}`);
      if (p.title.trim() !== "Silvis Call Schedule") fail(`sign-in ${theme}: card title is '${p.title}'`);
      await signin.screenshot({ path: path.join(OUT, `signin-${theme}.png`), fullPage: true });
      ok(`screenshot test/ui/out/signin-${theme}.png`);
    } catch (e) { fail(`sign-in ${theme}: ` + errLine(e)); try { await signin.screenshot({ path: path.join(OUT, `failure-signin-${theme}.png`), fullPage: true }); } catch (e2) {} }
  }
  // (e) Prompt 16 A2: an expired / already-used invite or reset link. GoTrue redirects back with
  // #error=access_denied&error_code=otp_expired&error_description=... (or the ?error= query form): the sign-in card
  // shows ONE message, the URL is cleaned so a reload does not repeat it, and the card offers no sign-up path.
  {
    const A2_MSG = "This invite or reset link has expired or was already used - ask the scheduler for a new invite, or use Forgot your password.";
    const A2_HASH = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    const cardState = () => signin.evaluate(() => {
      const err = document.querySelector("[data-testid=auth-error]");
      return { msg: err ? err.textContent.trim() : "", hash: location.hash, search: location.search, text: document.body.innerText };
    });
    try {
      // a real navigation each time: a hash-only change of the current URL is same-document and would never remount the app
      await signin.goto("about:blank");
      await signin.goto(BASE + A2_HASH, { waitUntil: "domcontentloaded" });
      await signin.waitForSelector("text=Sign in to your account", { timeout: 20000 });
      await signin.waitForSelector("[data-testid=auth-error]", { timeout: 10000 });
      const a = await cardState();
      if (a.msg !== A2_MSG) fail("A2 expired link (hash): the card message is '" + a.msg + "'"); else ok("A2 expired link (hash): the sign-in card shows the one message - '" + a.msg + "'");
      if (a.hash !== "" || a.search !== "") fail("A2 expired link (hash): the URL still carries the error after mount: " + a.hash + a.search); else ok("A2 expired link (hash): the hash is clean after the message (history.replaceState)");
      if (/Sign up|Create account|Don't have an account/.test(a.text)) fail("A2: the sign-in card still offers a sign-up path"); else ok("A2: no 'Sign up' / 'Create account' on the sign-in card (invite-only)");
      if (!/Forgot your password[?]/.test(a.text)) fail("A2: 'Forgot your password?' is missing from the sign-in card"); else ok("A2: 'Forgot your password?' stays on the card");
      await signin.screenshot({ path: path.join(OUT, "signin-expired-link.png"), fullPage: true });
      ok("screenshot test/ui/out/signin-expired-link.png");
      // a reload of the cleaned URL shows no message
      await signin.reload({ waitUntil: "domcontentloaded" });
      await signin.waitForSelector("text=Sign in to your account", { timeout: 20000 });
      await signin.waitForTimeout(600);
      const b = await cardState();
      if (b.msg) fail("A2 expired link: the message repeats after a reload of the cleaned URL: " + b.msg); else ok("A2 expired link: a reload of the cleaned URL shows no message");
      // the query form, beside another query key that must survive the clean-up
      await signin.goto("about:blank");
      await signin.goto(BASE + "?keep=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", { waitUntil: "domcontentloaded" });
      await signin.waitForSelector("[data-testid=auth-error]", { timeout: 20000 });
      const c = await cardState();
      if (c.msg !== A2_MSG) fail("A2 expired link (query): the card message is '" + c.msg + "'"); else ok("A2 expired link (query): ?error=... shows the same message");
      if (c.search !== "?keep=1" || c.hash !== "") fail("A2 expired link (query): the URL after mount is '" + c.search + c.hash + "', expected '?keep=1'"); else ok("A2 expired link (query): the error keys left the query, ?keep=1 stayed");
    } catch (e) { fail("A2 expired link: " + errLine(e)); try { await signin.screenshot({ path: path.join(OUT, "failure-signin-expired-link.png"), fullPage: true }); } catch (e2) {} }
  }
  await signin.close();
  // (e2) Prompt 16 B7: a recovery / invite hash opened on a device where a session already exists. Own
  // BrowserContext per theme at 390 x 844 with the fixture session (FAKE_JWT) stored: first the SAME account's link
  // (sub = FAKE_UID) opens the set-password card at once, naming the account, and its pair replaces the stored one;
  // then the same account's link whose token is DEAD (B7_DEAD: /auth/v1/user 401, its refresh 400) is probed first
  // and leaves the live session alone - the app comes up signed in with the expired-link toast (the review of B7);
  // then ANOTHER account's link (sub = B7_LINK_UID) is refused - the card names the signed-in account and the link's,
  // the stored pair is untouched and no logout goes out - until "Sign out and continue", which POSTs /auth/v1/logout
  // with the OLD bearer (answered here, never live) and only then stores the link pair and names the link's account.
  // Light also takes "Keep me signed in": the page reloads without the hash and comes up signed in as before.
  // /auth/v1/user answers by bearer; everything else goes through routeSupabase in the "session" scope.
  {
    const B7_LINK_UID = "00000000-0000-4000-8000-0000000000b7";
    const B7_LINK_EMAIL = "invitee@example.com";
    const b7jwt = (sub, email, tag) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", email, exp: Math.floor(Date.now() / 1000) + 3600, jti: tag })}.c2ln`;
    const B7_SAME = b7jwt(FAKE_UID, FAKE_EMAIL, "b7-same"), B7_OTHER = b7jwt(B7_LINK_UID, B7_LINK_EMAIL, "b7-other"), B7_DEAD = b7jwt(FAKE_UID, FAKE_EMAIL, "b7-dead");
    const linkHash = (t, r) => `#access_token=${t}&refresh_token=${r}&type=recovery`;
    const tokName = (t) => t === B7_SAME ? "same-link" : t === B7_OTHER ? "OTHER-link" : t === B7_DEAD ? "DEAD-link" : t === FAKE_JWT ? "fixture" : t == null ? "none" : "?";
    for (const theme of ["light", "dark"]) {
      const b7Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      // the pair is seeded ONCE per context (an init script runs on every navigation - re-seeding would hide whether the
      // stored pair really persisted or changed across the steps); the version and theme keys are set every time
      await b7Ctx.addInitScript(({ token, version, dk }) => { try { if (!localStorage.getItem("silvis-b7-seeded")) { localStorage.setItem("silvis-auth-token", token); localStorage.setItem("silvis-auth-refresh", "fake-refresh"); localStorage.setItem("silvis-b7-seeded", "1"); } localStorage.setItem("silvis-app-version", version); localStorage.setItem("silvis-dark-mode", dk ? "true" : "false"); } catch (e) {} }, { token: FAKE_JWT, version: APP_VERSION, dk: theme === "dark" });
      await b7Ctx.route(cdnMatcher, routeCdn);
      await b7Ctx.route((url) => url.hostname === EAST_HOST, routeEast);
      const b7 = await b7Ctx.newPage();
      watchPage(b7, "b7-" + theme);
      const logouts = [];
      await b7.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
        try {
          const req = route.request(); const url = new URL(req.url());
          const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
          const bearer = String(req.headers()["authorization"] || "").replace(/^Bearer /, "");
          if (url.pathname.startsWith("/auth/v1/user") && req.method() === "GET") {
            if (bearer === B7_DEAD) { b7DeadLinkStatusLines++; return await json(401, { message: "invalid JWT: token is expired" }); } // the dead link's probe
            return await json(200, bearer === B7_OTHER ? { id: B7_LINK_UID, email: B7_LINK_EMAIL, aud: "authenticated", role: "authenticated" } : { id: FAKE_UID, email: FAKE_EMAIL, aud: "authenticated", role: "authenticated" });
          }
          if (url.pathname.startsWith("/auth/v1/token") && req.method() === "POST" && /b7-dead-refresh/.test(req.postData() || "")) { b7DeadLinkStatusLines++; return await json(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }); } // the dead link's refresh token
          // GoTrue answers a logout 204 with no body; the app checks res.ok only. Answered as 200 + "{}" here because Chromium
          // reports a routed request fulfilled with an EMPTY body as requestfailed net::ERR_ABORTED (fetch still resolves ok) -
          // measured with a standalone probe (Playwright 1.63) - and that would land in the failed-requests trailer as noise.
          if (url.pathname.startsWith("/auth/v1/logout")) { logouts.push(bearer); return await json(200, {}); }
          return await routeSupabase(route, "session");
        } catch (e) {
          // a route still in flight when the page navigated away (the "keep" reload's data load) or the context closed has
          // nothing left to answer (run 1 died on that as an unhandled rejection); anything else is a harness defect and is named
          const m = String((e && e.message) || e);
          if (!/closed|disposed|navigat|already handled|aborted|net::ERR/i.test(m)) fail(`B7 ${theme} route (${route.request().method()} ${new URL(route.request().url()).pathname}): ` + errLine(e));
        }
      });
      await b7.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
      const state = () => b7.evaluate(() => {
        let token = null, refresh = null; try { token = localStorage.getItem("silvis-auth-token"); refresh = localStorage.getItem("silvis-auth-refresh"); } catch (e) {}
        const acct = document.querySelector("[data-testid=link-account]"), conf = document.querySelector("[data-testid=link-conflict]");
        return { token, refresh, hash: location.hash, account: acct ? acct.textContent.trim() : "", conflict: conf ? conf.textContent.replace(/\s+/g, " ").trim() : "", body: getComputedStyle(document.body).backgroundColor, scrollW: document.documentElement.scrollWidth };
      });
      try {
        // the same account's link
        await b7.goto(BASE + linkHash(B7_SAME, "b7-same-refresh"), { waitUntil: "domcontentloaded" });
        await b7.waitForSelector("[data-testid=link-account]", { timeout: 20000 });
        const s = await state();
        if (!s.account.includes("Setting a password for " + FAKE_EMAIL)) fail(`B7 ${theme} same account: the card does not name the account: '${s.account}'`); else ok(`B7 ${theme} same account: the set-password card opens at once - '${s.account.slice(0, 48)}'`);
        if (s.token !== B7_SAME || s.refresh !== "b7-same-refresh") fail(`B7 ${theme} same account: the link pair was not stored (token ${tokName(s.token)}, refresh ${s.refresh})`); else ok(`B7 ${theme} same account: the link pair replaced the same account's stored pair`);
        if (s.hash !== "") fail(`B7 ${theme}: the hash is still in the URL: ${s.hash.slice(0, 40)}`); else ok(`B7 ${theme}: the hash left the URL before the pair was adopted`);
        // the same account's link whose token is dead (expired / already used): probed BEFORE anything is stored, so the
        // live session stays - the ordinary mount follows and the expired-link message is a toast over the signed-in app
        await b7.goto("about:blank");
        await b7.goto(BASE + linkHash(B7_DEAD, "b7-dead-refresh"), { waitUntil: "domcontentloaded" });
        await b7.waitForFunction(() => { const t = document.querySelector("[data-testid=toast]"); return !!(t && /expired or was already used/.test(t.textContent || "")); }, undefined, { timeout: 20000 });
        await b7.waitForSelector("[data-testid=app-header]", { timeout: 30000 });
        await b7.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        const z = await state();
        if (z.token !== B7_SAME || z.refresh !== "b7-same-refresh") fail(`B7 ${theme} dead same-account link: the live pair changed (token ${tokName(z.token)}, refresh ${z.refresh})`); else ok(`B7 ${theme} dead same-account link: probed first - the live pair stays, the app comes up signed in with the expired-link toast`);
        if (z.account || z.conflict) fail(`B7 ${theme} dead same-account link: a card opened instead: '${(z.account || z.conflict).slice(0, 60)}'`);
        if (z.hash !== "") fail(`B7 ${theme} dead same-account link: the hash is still in the URL: ${z.hash.slice(0, 40)}`);
        if (logouts.length) fail(`B7 ${theme} dead same-account link: a logout went out (${logouts.length})`);
        // another account's link, while that session is stored
        await b7.goto("about:blank");
        await b7.goto(BASE + linkHash(B7_OTHER, "b7-other-refresh"), { waitUntil: "domcontentloaded" });
        await b7.waitForSelector("[data-testid=link-conflict]", { timeout: 20000 });
        const c = await state();
        if (!c.conflict.includes(FAKE_EMAIL) || !c.conflict.includes(B7_LINK_EMAIL)) fail(`B7 ${theme} other account: the conflict card must name both accounts: '${c.conflict}'`); else ok(`B7 ${theme} other account: the card names the signed-in account (${FAKE_EMAIL}) and the link's (${B7_LINK_EMAIL})`);
        if (c.token !== B7_SAME || c.refresh !== "b7-same-refresh") fail(`B7 ${theme} other account: the stored pair changed before the sign-out (token ${tokName(c.token)}, refresh ${c.refresh})`); else ok(`B7 ${theme} other account: the stored pair is untouched (nothing stored until the sign-out)`);
        if (logouts.length) fail(`B7 ${theme} other account: a logout went out before the button was pressed`);
        const wantBody = theme === "dark" ? "rgb(11, 26, 51)" : "rgb(246, 248, 251)";
        if (c.body !== wantBody) fail(`B7 ${theme}: page background is ${c.body}, expected ${wantBody}`);
        if (c.scrollW > 392) fail(`B7 ${theme} 390px: the page scrolls horizontally (scrollWidth ${c.scrollW})`);
        const btn = await b7.$("[data-testid=link-signout]");
        if (!btn) fail(`B7 ${theme} other account: no Sign out button on the conflict card`);
        else {
          const bb = await btn.boundingBox();
          if (!bb || bb.height < 36 || bb.x + bb.width > 390) fail(`B7 ${theme}: the Sign out button is off screen or under 36px: ${JSON.stringify(bb)}`);
          await b7.screenshot({ path: path.join(OUT, `recovery-conflict-390-${theme}.png`), fullPage: false });
          ok(`screenshot test/ui/out/recovery-conflict-390-${theme}.png`);
          if (theme === "light") {
            await b7.click("text=Keep me signed in");
            await b7.waitForSelector("[data-testid=app-header]", { timeout: 30000 });
            await b7.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); // let the mount's data load finish before the next navigation
            const k = await state();
            if (k.token !== B7_SAME || logouts.length) fail(`B7 light 'Keep me signed in': the stored pair changed (${tokName(k.token)}) or a logout went out (${logouts.length})`); else ok("B7 light 'Keep me signed in': the app comes back signed in as before (no hash, the pair untouched, no logout)");
            await b7.goto("about:blank");
            await b7.goto(BASE + linkHash(B7_OTHER, "b7-other-refresh"), { waitUntil: "domcontentloaded" });
            await b7.waitForSelector("[data-testid=link-conflict]", { timeout: 20000 });
          }
          await b7.click("[data-testid=link-signout]");
          await b7.waitForSelector("[data-testid=link-account]", { timeout: 20000 });
          const d = await state();
          if (logouts.length !== 1 || logouts[0] !== B7_SAME) fail(`B7 ${theme} sign out: expected one POST /auth/v1/logout with the OLD bearer, got ${logouts.length} (${logouts.map(tokName).join(",")})`); else ok(`B7 ${theme} sign out: one POST /auth/v1/logout with the old session's bearer`);
          if (!d.account.includes("Setting a password for " + B7_LINK_EMAIL)) fail(`B7 ${theme} sign out: the card does not name the link's account: '${d.account}'`); else ok(`B7 ${theme} sign out: then the set-password card - '${d.account.slice(0, 46)}'`);
          if (d.token !== B7_OTHER || d.refresh !== "b7-other-refresh") fail(`B7 ${theme} sign out: the stored pair is not the link's (token ${tokName(d.token)}, refresh ${d.refresh})`); else ok(`B7 ${theme} sign out: the link pair is stored only now`);
          await b7.screenshot({ path: path.join(OUT, `recovery-setpassword-390-${theme}.png`), fullPage: false });
          ok(`screenshot test/ui/out/recovery-setpassword-390-${theme}.png`);
        }
      } catch (e) { fail(`B7 ${theme}: ` + errLine(e)); try { await b7.screenshot({ path: path.join(OUT, `failure-b7-${theme}.png`), fullPage: true }); } catch (e2) {} }
      b7DeadLinkStatusLines = 0;
      await b7.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
      await b7Ctx.close();
    }
  }

  // (f) Prompt 16 A3: session lifecycle. A page whose stored token expired an hour ago (the tab-left-open picture;
  // /auth/v1/user still answers 200, like a session the server has not re-checked) with the refresh REJECTED (400)
  // and every write carrying an expired bearer answered 401: the first write path (the client_versions heartbeat)
  // tries ONE refresh and raises the banner; a day-editor save then fails 401 with NO 5-second retry loop and NO
  // toast beside the banner (toasts counted through a MutationObserver); the banner's button opens the sign-in
  // card in place, the dead pair still stored; a password sign-in (the harness hands out NEW_JWT) re-syncs the
  // pending edit as the same POST v1 with the new bearer. Then the proactive path: the token is expired again but
  // the refresh is GRANTED - the next save refreshes first and goes out with the refreshed bearer, no 401, no banner.
  // Its OWN BrowserContext (the 9/23 review, major): the main page keeps running its 60-second poll, and with a
  // shared origin storage it would read the expired pair too and add refresh attempts the counters below would
  // attribute to this page. Own localStorage, own routes (Supabase with scope "session" so the blob stamp is
  // kept apart from the main page's autosave), the CDN cache and the East mock shared by handler.
  if (day) {
    const sessCtx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
    await sessCtx.addInitScript(({ token, version }) => { try { localStorage.setItem("silvis-auth-token", token); localStorage.setItem("silvis-auth-refresh", "fake-refresh"); localStorage.setItem("silvis-app-version", version); } catch (e) {} }, { token: EXPIRED_JWT, version: APP_VERSION });
    await sessCtx.route(cdnMatcher, routeCdn);
    await sessCtx.route((url) => url.hostname === EAST_HOST, routeEast);
    const sess = await sessCtx.newPage();
    watchPage(sess, "session");
    await sess.route((url) => url.hostname === SUPABASE_HOST, (route) => routeSupabase(route, "session"));
    await sess.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    const sCell = (attr) => sess.$eval(`[data-day="${day}"]`, (el, a) => el.getAttribute(a), attr);
    const sEdit = async (role, id) => {
      const [y, m] = day.split("-");
      await sess.selectOption("[data-testid=cal-month-select]", String(Number(m) - 1));
      if ((await sess.$eval("[data-testid=cal-year-input]", el => el.value)) !== y) await sess.fill("[data-testid=cal-year-input]", y);
      await sess.waitForSelector(`[data-day="${day}"]`, { timeout: 5000 });
      await sess.click(`[data-day="${day}"]`);
      await sess.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      await sess.selectOption(`[data-testid=editor-${role}]`, id);
      const ov = await sess.$("[data-testid=override-confirm]");
      if (ov) await sess.click("[data-testid=override-accept]");
      await sess.click("[data-testid=editor-save]");
      await sess.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
    };
    const sDays = (from) => writes.slice(from).filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    const sRefreshes = (from) => authCalls.slice(from).filter(a => a.grant === "refresh_token");
    const sToasts = () => sess.evaluate(() => (window.__toastLog || []).slice());
    const banners = () => sess.locator("[data-testid=session-expired]").count();
    const isSaveToast = (t) => /session expired|Couldn't save|aren't saving/i.test(t);
    expiredWrites401 = true; authRefreshGrant = null;
    const a0 = authCalls.length;
    try {
      await sess.goto(BASE, { waitUntil: "domcontentloaded" });
      await sess.waitForSelector("h1:has-text('Silvis Call Schedule')", { timeout: 30000 });
      await sess.waitForSelector("text=Synced", { timeout: 30000 });
      await sess.evaluate(() => { window.__toastLog = []; let last = ""; const rec = () => { const t = document.querySelector("[data-testid=toast]"); const txt = t ? t.textContent.trim() : ""; if (txt && txt !== last) window.__toastLog.push(txt); last = txt; }; new MutationObserver(rec).observe(document.body, { childList: true, subtree: true, characterData: true }); });
      await sess.waitForTimeout(3500); // past the autosave hydration window; the heartbeat's refresh attempt has happened
      // (1) the first write path already found the session dead: one refresh attempt, the banner once
      const bannerAtLoad = await banners();
      const r0 = sRefreshes(a0);
      if (bannerAtLoad !== 1) fail(`A3 session: expected the ONE session-expired banner once the first write path (the heartbeat) found the session dead, got ${bannerAtLoad}`);
      else if (r0.length !== 1 || r0[0].refresh !== "fake-refresh") fail(`A3 session: expected exactly one refresh attempt (grant_type=refresh_token with the stored refresh token) at load, got ${JSON.stringify(r0)}`);
      else ok("A3 session: stored token expired + refresh rejected (400) -> the first write path tries ONE refresh and the banner 'Your session expired - sign in again' shows once");
      // (2) a day-editor save while expired: 401, no retry, no toast beside the banner, the edit stays in the cell
      const w1 = writes.length, a1 = authCalls.length, tEdit = (await sToasts()).length;
      await sEdit("primary", "s2");
      await sess.waitForTimeout(2500);
      const d1 = sDays(w1);
      const bodyText1 = await sess.evaluate(() => document.body.innerText);
      if (d1.length !== 1 || !d1[0].forced401 || d1[0].method !== "POST") fail("A3 session (expired save): expected exactly one schedule_days POST answered 401, got " + JSON.stringify(d1.map(w => `${w.method} ${w.path} 401=${!!w.forced401}`)));
      else if ((await sCell("data-primary")) !== "s2") fail("A3 session (expired save): the cell lost the edit (data-primary = " + (await sCell("data-primary")) + ")");
      else if (!/Save failed - sign in again/i.test(bodyText1)) fail("A3 session (expired save): the header status does not say 'Save failed - sign in again'"); // innerText carries the header's CSS uppercase
      else ok(`A3 session (expired save): ${day} P -> Burchett -> ONE schedule_days POST answered 401; the cell keeps the edit; status 'Save failed - sign in again'`);
      const tAfter = await sToasts();
      await sess.waitForTimeout(12000); // more than two retry periods
      const d2 = sDays(w1), r2 = sRefreshes(a1), tLater = await sToasts(), b2 = await banners();
      const saveToasts = tLater.slice(tEdit).filter(isSaveToast);
      if (d2.length !== 1) fail(`A3 session (no loop): ${d2.length} schedule_days writes 12 s after the 401 - the 5-second retry re-armed: ` + JSON.stringify(d2.map(w => w.method + " " + w.path)));
      else if (r2.length !== 0) fail(`A3 session (no loop): ${r2.length} further refresh attempt(s) for the same dead pair`);
      else if (saveToasts.length) fail("A3 session (no loop): a save-error toast showed beside the banner: " + JSON.stringify(saveToasts));
      else if (tLater.length !== tAfter.length) fail("A3 session (no loop): toasts kept coming after the save settled: " + JSON.stringify(tLater.slice(tAfter.length)));
      else if (b2 !== 1) fail(`A3 session (no loop): ${b2} banner(s) after 12 s (never stacked, never dropped)`);
      else ok("A3 session (no loop): 12 s later still ONE write, no further refresh, no save-error toast (toasts counted), ONE banner");
      await sess.screenshot({ path: path.join(OUT, "session-expired.png"), fullPage: true });
      ok("screenshot test/ui/out/session-expired.png");
      // Prompt 16 A5: the lowest fixed banner pads by the home-indicator inset (the same CDP override as the
      // calendar's safe-area step); with no other banner showing, session-expired IS the lowest one.
      {
        const bCdp = await sessCtx.newCDPSession(sess);
        try {
          await bCdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
          await sess.waitForTimeout(200);
          const bb = await sess.$eval("[data-testid=session-expired]", el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { padBottom: cs.paddingBottom, bottom: cs.bottom, gap: Math.round(window.innerHeight - r.bottom) }; });
          if (bb.padBottom !== "43px" || bb.bottom !== "0px" || bb.gap !== 0) fail("A5 safe area: the session-expired banner (the lowest one) should sit at bottom 0 and pad 34 + 9 = 43px under a 34px inset: " + JSON.stringify(bb));
          else ok(`A5 safe area: the session-expired banner sits at the bottom edge and pads ${bb.padBottom} (34px inset + 9px)`);
        } catch (e) { fail("A5 safe area (banner): " + errLine(e)); }
        finally { try { await bCdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, topMax: 0, bottom: 0, bottomMax: 0, left: 0, leftMax: 0, right: 0, rightMax: 0 } }); } catch (e) {} await bCdp.detach().catch(() => {}); }
      }
      // (2b) a Setup edit while expired (the 9/23 review, major - the blob leg): Rules -> Acton -> max consecutive
      // days -> Save. The audit insert and the blob upsert both 401 (forced); the value must stay in the editor and
      // land after the sign-in instead of being replaced by the server's blob (the re-run's leg A used to adoptBlob
      // wholesale, then the autosave wrote the server's values back).
      const wSetup = writes.length;
      const blobWrites = (from) => writes.slice(from).filter(w => /\/rest\/v1\/call_schedule_data\b/.test(w.path) && w.method !== "GET");
      const blobMax = (w) => { try { return JSON.parse(w.body).data.surgeonRules.s3.maxConsecutiveDays; } catch (e) { return undefined; } };
      await sess.click('button[data-tab="setup"]');
      await sess.waitForSelector("[data-testid=card-setup_rules]", { timeout: 5000 });
      if ((await sess.getAttribute("[data-testid=card-setup_rules]", "data-open")) !== "1") { await sess.click("[data-testid=card-toggle-setup_rules]"); await sess.waitForTimeout(200); }
      await sess.click("[data-testid=rules-pick-s3]");
      const sMaxInput = sess.locator("[data-testid=rules-editor] input[type=number][max='14']").first();
      const maxBefore = await sMaxInput.inputValue();
      const maxNew = maxBefore === "4" ? "5" : "4";
      await sMaxInput.fill(maxNew);
      await sess.click("[data-testid=rules-save]");
      await waitFor(() => blobWrites(wSetup).length > 0, 5000);
      await sess.waitForTimeout(500);
      const bExp = blobWrites(wSetup);
      if (!bExp.length || bExp.some(w => !w.forced401) || String(blobMax(bExp[bExp.length - 1])) !== maxNew) fail("A3 session (setup edit while expired): expected the blob upsert(s) after Save to be answered 401 and to carry surgeonRules.s3.maxConsecutiveDays " + maxNew + ", got " + JSON.stringify(bExp.map(w => `${w.method} 401=${!!w.forced401} max=${blobMax(w)}`)));
      else if ((await sMaxInput.inputValue()) !== maxNew) fail("A3 session (setup edit while expired): the editor lost the value (" + (await sMaxInput.inputValue()) + ")");
      else if ((await banners()) !== 1) fail("A3 session (setup edit while expired): banner count " + (await banners()));
      else ok(`A3 session (setup edit while expired): Rules Acton max consecutive ${maxBefore || "(blank)"} -> ${maxNew} -> Save: ${bExp.length} blob upsert(s) answered 401, the value stays in the editor, ONE banner`);
      // back to the calendar before the sign-in (the view state survives the card; step 3 reads the day cell there)
      await sess.click('button[data-tab="calendar"]');
      await sess.waitForSelector(`[data-day="${day}"]`, { timeout: 5000 });
      // (3) the banner's button -> the sign-in card in place -> password sign-in -> the pending edit lands
      await sess.click("[data-testid=session-expired-signin]");
      await sess.waitForSelector("text=Sign in to your account", { timeout: 10000 });
      const cardMsg = await sess.$eval("[data-testid=auth-error]", el => el.textContent.trim()).catch(() => "");
      const storedTok = await sess.evaluate(() => localStorage.getItem("silvis-auth-token"));
      if (!/session expired/i.test(cardMsg)) fail("A3 session (card): the sign-in card does not say why: '" + cardMsg + "'"); else ok("A3 session (card): the banner's button opens the sign-in card in place - '" + cardMsg + "'");
      if (storedTok !== EXPIRED_JWT) fail("A3 session (card): the stored session was cleared or replaced before the sign-in (the dead pair must stay so a write fails loudly, never as anon)"); else ok("A3 session (card): the stored (dead) pair stays until the sign-in - no signOut, no unenroll, no reload");
      await sess.fill('input[type="email"]', FAKE_EMAIL);
      await sess.fill('input[type="password"]', "harness-only-password");
      const w3 = writes.length, a3 = authCalls.length, t3Base = (await sToasts()).length;
      await sess.click("button:has-text('Sign in')");
      await sess.waitForSelector("h1:has-text('Silvis Call Schedule')", { timeout: 20000 });
      await waitFor(() => sDays(w3).length > 0, 15000);
      await sess.waitForTimeout(1500);
      const d3 = sDays(w3), pw = authCalls.slice(a3).filter(a => a.grant === "password");
      const b3 = (() => { try { return JSON.parse((d3[0] || {}).body || "{}"); } catch (e) { return {}; } })();
      const banner3 = await banners();
      const t3 = (await sToasts()).slice(t3Base).filter(isSaveToast);
      if (pw.length !== 1) fail(`A3 session (re-auth): expected one grant_type=password sign-in, got ${pw.length}`);
      else if (d3.length !== 1 || d3[0].forced401 || d3[0].method !== "POST" || b3.day !== day || b3.primary_id !== "s2" || b3.version !== 1) fail("A3 session (re-auth): the pending edit did not land as ONE POST v1 after the sign-in: " + JSON.stringify(d3.map(w => `${w.method} ${w.path} 401=${!!w.forced401} body=${String(w.body).slice(0, 120)}`)));
      else if (d3[0].auth !== "Bearer " + NEW_JWT) fail("A3 session (re-auth): the landed write did not carry the NEW bearer from the sign-in");
      else if ((await sCell("data-primary")) !== "s2") fail("A3 session (re-auth): the cell lost the edit across the sign-in");
      else if (banner3 !== 0) fail(`A3 session (re-auth): the banner is still up after the sign-in (${banner3})`);
      else if (t3.length) fail("A3 session (re-auth): a session toast after the sign-in: " + JSON.stringify(t3));
      else ok(`A3 session (re-auth): password sign-in -> the edit made while expired lands as POST v1 ${day} P Burchett with the new bearer (the re-run of the load merged, then re-synced); banner gone; no toast`);
      // (3b) ... and the Setup edit made while expired lands too: the re-run's blob read finds the row unchanged
      // (updated_at equality, the session scope's own stamp), keeps the local state and re-fires the autosave; every
      // blob write after the sign-in carries the new value (the count is the autosave's, not pinned) and the editor
      // (remounted after the card) still shows it.
      await waitFor(() => blobWrites(w3).some(w => !w.forced401), 15000);
      await sess.waitForTimeout(1200);
      const b3b = blobWrites(w3);
      await sess.click('button[data-tab="setup"]');
      await sess.waitForSelector("[data-testid=card-setup_rules]", { timeout: 5000 });
      if ((await sess.getAttribute("[data-testid=card-setup_rules]", "data-open")) !== "1") { await sess.click("[data-testid=card-toggle-setup_rules]"); await sess.waitForTimeout(200); }
      await sess.click("[data-testid=rules-pick-s3]");
      const maxAfter = await sMaxInput.inputValue().catch(() => null);
      if (!b3b.length || b3b.some(w => w.forced401) || b3b.some(w => String(blobMax(w)) !== maxNew)) fail("A3 session (re-auth, setup): expected every call_schedule_data write after the sign-in to succeed and to carry surgeonRules.s3.maxConsecutiveDays " + maxNew + ", got " + JSON.stringify(b3b.map(w => `${w.method} 401=${!!w.forced401} max=${blobMax(w)} bearer=${w.auth === "Bearer " + NEW_JWT ? "new" : "other"}`)));
      else if (b3b.some(w => w.auth !== "Bearer " + NEW_JWT)) fail("A3 session (re-auth, setup): a blob write did not carry the NEW bearer");
      else if (maxAfter !== maxNew) fail(`A3 session (re-auth, setup): the editor shows ${maxAfter} after the sign-in, not the ${maxNew} saved while expired (the re-run adopted the server's blob over the local edit)`);
      else ok(`A3 session (re-auth, setup): the Setup edit made while expired lands - ${b3b.length} call_schedule_data write(s) after the sign-in, every one with maxConsecutiveDays ${maxNew} and the new bearer; the editor still shows ${maxNew}`);
      // restore the harness value in the editor (the live blob is never written - the mock answers the upserts) and
      // let that autosave land before the next step re-expires the token
      const wRestore = writes.length;
      await sMaxInput.fill(maxBefore);
      if (await sess.$eval("[data-testid=rules-save]", el => !el.disabled)) { await sess.click("[data-testid=rules-save]"); await waitFor(() => blobWrites(wRestore).some(w => !w.forced401), 8000); }
      await sess.click('button[data-tab="calendar"]');
      // (4) the proactive refresh: expired again, the refresh GRANTED -> the next save refreshes first, no 401.
      // Wait for a marker, not a duration (the 9/23 review): the header back at Synced / Saved with no failure
      // (the re-run's sync and the restore above have settled). The re-run no longer re-opens the autosave's
      // 3-second hydration window (loadedAtRef is set on the first load only), so the edit that follows syncs
      // like any other.
      const settled = await waitFor(async () => { const t = await sess.evaluate(() => document.body.innerText); return /\b(Synced|Saved)\b/i.test(t) && !/Save failed|Syncing|Saving|Loading/i.test(t); }, 20000, 250);
      if (!settled) fail("A3 session (re-auth): the header never settled to Synced / Saved after the sign-in");
      authRefreshGrant = NEW2_JWT;
      await sess.evaluate((t) => localStorage.setItem("silvis-auth-token", t), EXPIRED_JWT);
      const w4 = writes.length, a4 = authCalls.length;
      await sEdit("backup", "s3");
      await waitFor(() => sDays(w4).length > 0, 10000);
      await sess.waitForTimeout(1500);
      const d4 = sDays(w4), r4 = sRefreshes(a4);
      const b4 = (() => { try { return JSON.parse((d4[0] || {}).body || "{}"); } catch (e) { return {}; } })();
      const storedAfter = await sess.evaluate(() => localStorage.getItem("silvis-auth-token"));
      if (r4.length !== 1 || r4[0].refresh !== "fake-refresh-2") fail(`A3 session (refresh before write): expected ONE granted refresh with the sign-in's refresh token before the save, got ${JSON.stringify(r4)}`);
      else if (d4.length !== 1 || d4[0].forced401 || d4[0].method !== "PATCH" || b4.backup_id !== "s3" || b4.version !== 2) fail("A3 session (refresh before write): expected ONE CAS PATCH (version 2) carrying backup s3 with no 401: " + JSON.stringify(d4.map(w => `${w.method} ${w.path} 401=${!!w.forced401} body=${String(w.body).slice(0, 120)}`)));
      else if (d4[0].auth !== "Bearer " + NEW2_JWT) fail("A3 session (refresh before write): the write did not carry the refreshed bearer");
      else if (d4[0].at < r4[0].at) fail("A3 session (refresh before write): the write went out BEFORE the refresh");
      else if ((await banners()) !== 0) fail("A3 session (refresh before write): the banner showed although the refresh was granted");
      else if (storedAfter !== NEW2_JWT) fail("A3 session (refresh before write): the refreshed token was not stored");
      else ok(`A3 session (refresh before write): token expired again + refresh granted -> refresh first, then PATCH ?day=eq.${day}&version=eq.1 (B -> Acton, v2) with the refreshed bearer; no 401, no banner`);
    } catch (e) { fail("A3 session: " + errLine(e)); try { await sess.screenshot({ path: path.join(OUT, "failure-session.png"), fullPage: true }); } catch (e2) {} }
    expiredWrites401 = false; authRefreshGrant = null;
    await sess.close();
    await sessCtx.close();
  } else console.log("     (A3 session scenario skipped: no row-less edit day)");
  // (d) a signed-in month view per theme on the main page: navy header, orange today ring, id-keyed pill colours, dark page.
  const monthProbe = () => page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const hdr = h1 && h1.closest("[data-testid=app-header]");
    const cs = (el, p) => el ? getComputedStyle(el)[p] : "";
    const d = new Date(); const todayLocal = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const today = document.querySelector("[data-testid=cal-grid] .cal-cell[data-day='" + todayLocal + "']");
    // Every visible P pill, keyed by the holder id the cell carries (the first pill of a cell is the P line).
    const pills = {};
    for (const cell of document.querySelectorAll("[data-testid=cal-grid] .cal-cell[data-primary]")) {
      const id = cell.getAttribute("data-primary"); const pill = cell.querySelector(".cal-line .cal-pill");
      if (id && !id.startsWith("ext:") && pill && !pills[id]) pills[id] = { color: cs(pill, "color"), bg: cs(pill, "backgroundColor"), border: cs(pill, "borderTopStyle") };
    }
    const open = document.querySelector("[data-testid=cal-grid] .cal-pill.cal-open");
    const active = document.querySelector('button[data-tab="calendar"]');
    const inactive = document.querySelector('button[data-tab="settings"]');
    // The per-surgeon .ics download buttons (Calendar tools card): roster pills rendered as buttons.
    const ics = Array.from(document.querySelectorAll("[data-testid^=ics-]:not([data-testid=ics-all])")).map(b => ({ code: b.getAttribute("data-testid").slice(4), color: cs(b, "color"), bg: cs(b, "backgroundColor"), border: cs(b, "borderTopStyle") }));
    return { hdrBg: cs(hdr, "backgroundColor"), h1: cs(h1, "color"), todayBorder: today ? cs(today, "borderTopColor") : null, pills, open: open ? cs(open, "color") : null, tabUnderline: cs(active, "borderBottomColor"), tabColor: cs(active, "color"), inactiveTabColor: cs(inactive, "color"), ics, bodyBg: getComputedStyle(document.body).backgroundColor };
  });
  const themeMod = loadTheme();
  const rgbOf = (hex) => "rgb(" + hexToRgb(hex).join(", ") + ")";
  const hexOfRgb = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb || ""); return m ? "#" + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("") : null; };
  const seedRoster = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8")).roster || [];
  for (const theme of ["light", "dark"]) {
    try {
      // Isolation from upstream drift: an open Day editor / publish dialog would block the Settings tab click.
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 }).catch(() => {});
      const skipBtn = page.locator("[data-testid=publish-skip]"); if (await skipBtn.count()) await skipBtn.first().click().catch(() => {});
      await page.click('button[data-tab="settings"]');
      await page.click(`button:has-text('${theme === "dark" ? "Dark" : "Light"}')`);
      await page.click('button[data-tab="calendar"]');
      await page.waitForSelector("[data-testid=cal-grid]", { timeout: 10000 });
      const t = new Date(); await showMonth(t.getFullYear(), t.getMonth());
      await openCard("cal_tools");
      await page.waitForSelector("[data-testid^=ics-]", { timeout: 5000 });
      await page.waitForTimeout(300);
      const m = await monthProbe();
      if (m.hdrBg !== "rgb(19, 41, 75)") fail(`month ${theme}: header bar is ${m.hdrBg}, expected navy #13294B`); else ok(`month ${theme}: header bar navy ${m.hdrBg}, title ${m.h1}`);
      if (m.tabUnderline !== (theme === "dark" ? "rgb(255, 138, 76)" : "rgb(255, 95, 5)")) fail(`month ${theme}: the active tab underline is ${m.tabUnderline}, not the orange accent`); else ok(`month ${theme}: active tab underline ${m.tabUnderline}`);
      // the active tab's label stays white on the navy bar in both themes and differs from the inactive tabs
      if (m.tabColor !== "rgb(255, 255, 255)" || m.tabColor === m.inactiveTabColor) fail(`month ${theme}: the active tab label is ${m.tabColor} (inactive ${m.inactiveTabColor}) - expected white, distinct from the inactive tabs`); else ok(`month ${theme}: active tab label white, inactive ${m.inactiveTabColor}`);
      // the .ics download buttons carry the id-keyed pill colours (text on its own tint, >= 3:1) in both themes
      const icsBad = [];
      for (const b of m.ics) {
        const entry = seedRoster.find(r => r.code === b.code); const c = entry ? themeMod.rosterColors(entry, 0) : null;
        const ratio = hexOfRgb(b.color) && hexOfRgb(b.bg) ? contrastRatio(hexOfRgb(b.color), hexOfRgb(b.bg)) : 0;
        if (!c || b.color !== rgbOf(c.tx) || b.bg !== rgbOf(c.tg) || b.border !== (c.dashed ? "dashed" : "solid") || ratio < 3) icsBad.push(`${b.code} ${b.color} on ${b.bg} ${b.border} ${ratio}:1${c ? " (want " + rgbOf(c.tx) + " on " + rgbOf(c.tg) + ")" : " (no roster entry)"}`);
      }
      if (!m.ics.length) fail(`month ${theme}: no .ics download buttons found`);
      else if (icsBad.length) fail(`month ${theme}: .ics pill buttons off the id-keyed table / under 3:1: ` + icsBad.join("; "));
      else ok(`month ${theme}: ${m.ics.length} .ics pill buttons match the id-keyed table, all >= 3:1 - ` + m.ics.map(b => `${b.code} ${b.color}`).join(", "));
      if (m.todayBorder === null) console.log(`     (month ${theme}: today's cell is not in the shown month - today ring not measured)`);
      else if (m.todayBorder !== (theme === "dark" ? "rgb(255, 138, 76)" : "rgb(255, 95, 5)")) fail(`month ${theme}: today ring is ${m.todayBorder}, not the orange accent`); else ok(`month ${theme}: today ring ${m.todayBorder}`);
      // every visible pill = the id-keyed table (tx on tg, both themes; an outside surgeon's border dashed)
      const pillIds = Object.keys(m.pills);
      const wrongPills = pillIds.filter(id => { const c = themeMod.rosterColors({ id, type: /^s\d+$/.test(id) ? undefined : "external" }, 0); const p = m.pills[id]; return p.color !== rgbOf(c.tx) || p.bg !== rgbOf(c.tg) || p.border !== (c.dashed ? "dashed" : "solid"); });
      if (!pillIds.length) fail(`month ${theme}: no P pill with a roster holder in the shown month`);
      else if (wrongPills.length) fail(`month ${theme}: pills off the id-keyed table: ` + wrongPills.map(id => `${id} ${JSON.stringify(m.pills[id])}`).join("; "));
      else ok(`month ${theme}: ${pillIds.length} pill colour(s) match the id-keyed table - ` + pillIds.map(id => `${id} ${m.pills[id].color}`).join(", "));
      if (m.open && m.open !== (theme === "dark" ? "rgb(240, 96, 96)" : "rgb(185, 28, 28)")) fail(`month ${theme}: OPEN pill is ${m.open}, expected ${theme === "dark" ? "#F06060" : "#B91C1C"}`); else if (m.open) ok(`month ${theme}: OPEN pill ${m.open}`);
      const wantBody = theme === "dark" ? "rgb(11, 26, 51)" : "rgb(246, 248, 251)";
      if (m.bodyBg !== wantBody) fail(`month ${theme}: page background ${m.bodyBg}, expected ${wantBody}`); else ok(`month ${theme}: page background ${m.bodyBg}`);
      await page.screenshot({ path: path.join(OUT, `theme-month-${theme}.png`), fullPage: true });
      ok(`screenshot test/ui/out/theme-month-${theme}.png`);
    } catch (e) { fail(`month ${theme}: ` + errLine(e)); }
  }
  try { await page.click('button[data-tab="settings"]'); await page.click("button:has-text('Light')"); } catch (e) { /* leave the theme as it is */ }

  // Public read-only mode renders without auth.
  const pub = await context.newPage();
  const pubErrors = [];
  pub.on("pageerror", (e) => pubErrors.push(String(e && e.message || e)));
  pub.on("requestfailed", (r) => failedRequests.push(`public: ${r.method()} ${r.url()} -> ${(r.failure() || {}).errorText || "failed"}`));
  await pub.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
    const req = route.request();
    if (req.method() !== "GET") { writes.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postData() || "", public: true }); return route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }
    const fx = fixtureAnswer(new URL(req.url()));
    if (fx) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(fx) });
    const headers = { ...req.headers() }; headers["authorization"] = "Bearer " + ANON_KEY;
    return route.continue({ headers });
  });
  await pub.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {}); // mocked, silent
  try {
    const a = await loadWithRetry(pub, BASE + "?public=1", "[data-testid=cal-month]", 20000, "public page");
    ok(`?public=1 renders the read-only calendar without auth${a > 1 ? " (on retry)" : ""}`);
    // vis-008: the pre-load calendar looks exactly like an RLS-blocked anon
    // read (HTTP 200 + []). Wait for the load to finish AND for real data:
    // no "Loading schedule" text, no loading placeholders, and at least one
    // visible cell with a primary or external cover.
    const loadedPublic = await pub.waitForFunction(() => {
      const txt = document.body.innerText || "";
      if (/Loading schedule/i.test(txt)) return false;
      if (document.querySelector("[data-testid=loading-slot], [data-testid=loading-holder]")) return false;
      return !!document.querySelector("[data-testid=cal-grid] .cal-cell:not([data-primary='']), [data-testid=cal-grid] .cal-cell:not([data-ext=''])");
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const pubCells = await pub.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary"), ext: e.getAttribute("data-ext"), text: e.textContent })));
    const filled = pubCells.filter(c => c.p || c.ext);
    if (!loadedPublic || !filled.length) fail(`?public=1: the schedule never loaded (every cell empty/OPEN - the same picture an RLS-blocked anon read gives): ${pubCells.length} cells, filled ${filled.length}, banner: ${(await pub.$eval("[data-testid=today-banner]", el => el.textContent).catch(() => "?")).slice(0, 80)}`);
    else ok(`?public=1: schedule loaded - ${filled.length} of ${pubCells.length} visible cells carry an assignment (e.g. ${filled[0].day} P ${filled[0].p || filled[0].ext})`);
    const pubBanner = await pub.$eval("[data-testid=today-banner]", el => el.textContent).catch(() => "");
    if (/loading/i.test(pubBanner)) fail("?public=1: today banner still shows the loading placeholder: " + pubBanner); else ok("?public=1: today banner shows real holders: " + pubBanner.replace(/\s+/g, " ").slice(0, 90));
    // Item E (Faraz 9/24; Item E2 9/25): the public link gets the clean grid too - November 2026 (the month whose
    // derived / forecast days the scheduler's day editor was checked on above) carries no E / F / f badge, no
    // "East-derived:" hover bit and no East legend line.
    await pub.selectOption("[data-testid=cal-month-select]", "10");
    if ((await pub.$eval("[data-testid=cal-year-input]", el => el.value)) !== "2026") await pub.fill("[data-testid=cal-year-input]", "2026");
    await pub.waitForFunction(() => { const el = document.querySelector("[data-testid=cal-month]"); return !!el && el.textContent.trim() === "November 2026"; }, null, { timeout: 10000 });
    await pub.waitForTimeout(300);
    const pubNov = await pub.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => ({ day: e.getAttribute("data-day"), title: e.getAttribute("title") || "", badges: Array.from(e.querySelectorAll("[data-badge]")).map(x => x.getAttribute("data-badge")) })));
    const pubEast = pubNov.filter(c => c.badges.some(b => b === "E" || b === "F" || b === "f") || /East-derived:/.test(c.title));
    const pubLegend = await pub.$eval(".cal-legend", el => el.innerText.replace(/\s+/g, " ")).catch(() => "");
    if (!pubNov.length) fail("Item E (?public=1): November 2026 did not render on the public page");
    else if (pubEast.length) fail(`Item E (?public=1): November 2026 still shows East information on the public link: ${pubEast.map(c => c.day + ":" + c.badges.join("") + (/East-derived:/.test(c.title) ? "+hover" : "")).slice(0, 6).join(", ")}`);
    else if (/East-derived/.test(pubLegend) || /East forecast/.test(pubLegend)) fail("Item E (?public=1): the legend still carries the East lines: " + pubLegend.slice(0, 220));
    else ok(`Item E (?public=1): November 2026 grid has no E / F / f badge or 'East-derived:' hover bit (${pubNov.length} cells) and the legend has no East line`);
  } catch (e) { fail("?public=1 did not render the calendar: " + String(e && e.message || e).split("\n")[0]); }
  await pub.screenshot({ path: path.join(OUT, "public.png"), fullPage: true });
  if (pubErrors.length) fail("public page errors: " + pubErrors.join(" | "));
  if (writes.some(w => w.public)) fail("public mode attempted a write: " + JSON.stringify(writes.filter(w => w.public)));
  else ok("public mode issued no writes");
  await pub.close();

  // ====================== Prompt 11: refresh banners (version.json + client_versions.main.min_version) ======================
  {
    const NEWER = "2099.01.01";
    const p2 = await context.newPage();
    watchPage(p2, "refresh");
    const p2Warns = []; p2.on("console", (m) => { if (m.type() === "warning") p2Warns.push(m.text()); }); // Prompt 16 B9 (h): the tripwire's console line
    await p2.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {}); // silenced: poll only
    await p2.route((url) => url.hostname === SUPABASE_HOST, routeSupabase);
    await p2.route((url) => /\/version\.json$/.test(url.pathname), (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify({ version: NEWER }) }));
    minVersionOverride = { min_version: NEWER, message: "Harness minimum - reload." };
    try {
      await loadWithRetry(p2, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "refresh page");
      const minBanner = p2.locator("div[role=alert]:has-text('below the required minimum')");
      await minBanner.waitFor({ timeout: 30000 });
      const minText = (await minBanner.innerText()).replace(/\s+/g, " ");
      if (!minText.includes(`(${APP_VERSION}) is below the required minimum (${NEWER})`) || !minText.includes("Harness minimum - reload.")) fail("forced-refresh banner text wrong: " + minText);
      else ok(`forced-refresh banner (client_versions.main.min_version ${NEWER} > APP_VERSION ${APP_VERSION}): "${minText.slice(0, 120)}"`);
      const updBanner = p2.locator("div[role=status]:has-text('New version available')");
      await updBanner.waitFor({ timeout: 20000 }); // the version.json check runs 5 s after mount
      const updText = (await updBanner.innerText()).replace(/\s+/g, " ");
      if (!updText.includes(`New version available (${NEWER})`)) fail("update banner text wrong: " + updText); else ok(`update banner (version.json ${NEWER} > APP_VERSION): "${updText.slice(0, 80)}"`);
      await p2.evaluate(() => { window.__hardResets = 0; window.__silvisHardReset = () => { window.__hardResets++; }; });
      await updBanner.locator("button:has-text('Tap to reload')").click();
      await p2.waitForTimeout(150);
      await minBanner.locator("button:has-text('Reload now')").click();
      await p2.waitForTimeout(150);
      const resets = await p2.evaluate(() => window.__hardResets);
      if (resets !== 2) fail(`refresh banners: the two reload buttons called __silvisHardReset ${resets} time(s), expected 2`); else ok("refresh banners: 'Tap to reload' and 'Reload now' each call window.__silvisHardReset (cache + service-worker clear, then reload)");
      await updBanner.locator("button[aria-label=Dismiss]").click();
      await p2.waitForTimeout(200);
      if (await p2.locator("div[role=status]:has-text('New version available')").count()) fail("update banner: Dismiss did not hide it"); else ok("update banner: Dismiss hides it for this version (the forced-minimum banner has no dismiss)");
      if (!(await minBanner.count())) fail("forced-refresh banner disappeared on its own - it must persist until the reload");
      // ---- Prompt 16 B9 (c): at 390 px the fixed banner paints UNDER the day editor - its Save row stays tappable ----
      await p2.setViewportSize({ width: 390, height: 844 });
      await p2.click('button[data-tab="calendar"]');
      await p2.selectOption("[data-testid=cal-month-select]", "9");
      if ((await p2.$eval("[data-testid=cal-year-input]", el => el.value)) !== "2026") await p2.fill("[data-testid=cal-year-input]", "2026");
      await p2.waitForSelector('[data-day="2026-10-15"]', { timeout: 5000 });
      await p2.waitForTimeout(300);
      await p2.click('[data-day="2026-10-15"]');
      await p2.waitForSelector("[data-testid=editor-footer]", { timeout: 5000 });
      await p2.waitForTimeout(250);
      const zc = await p2.evaluate(() => {
        const save = document.querySelector("[data-testid=editor-save]"), editor = document.querySelector("[data-testid=day-editor]");
        const banner = Array.from(document.querySelectorAll("div[role=alert]")).find(d => /below the required minimum/.test(d.textContent));
        if (!save || !editor || !banner) return { missing: { save: !save, editor: !editor, banner: !banner } };
        const r = save.getBoundingClientRect(), b = banner.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { hitIsSave: hit === save || save.contains(hit), hitTag: hit ? (hit.getAttribute("data-testid") || hit.tagName + (hit.getAttribute("role") ? "[" + hit.getAttribute("role") + "]" : "")) : "nothing", overlap: r.bottom > b.top && r.top < b.bottom, bannerZ: getComputedStyle(banner).zIndex, editorZ: getComputedStyle(editor).zIndex, save: { top: Math.round(r.top), bottom: Math.round(r.bottom) }, banner: { top: Math.round(b.top), bottom: Math.round(b.bottom) } };
      });
      if (zc.missing) fail("B9c: " + JSON.stringify(zc.missing));
      else if (!zc.hitIsSave || !(Number(zc.bannerZ) < Number(zc.editorZ))) fail(`B9c: at 390 px the minimum-version banner (z ${zc.bannerZ}, ${zc.banner.top}-${zc.banner.bottom}px) must sit under the day editor (z ${zc.editorZ}); the point at the centre of Save (${zc.save.top}-${zc.save.bottom}px) hit '${zc.hitTag}'`);
      else ok(`B9c: the day editor (z ${zc.editorZ}) paints over the banner (z ${zc.bannerZ}); Save's centre hits Save` + (zc.overlap ? ` although the banner's band (${zc.banner.top}-${zc.banner.bottom}px) crosses it (${zc.save.top}-${zc.save.bottom}px)` : ` (the banner band ${zc.banner.top}-${zc.banner.bottom}px does not cross Save ${zc.save.top}-${zc.save.bottom}px at this height)`));
      await p2.keyboard.press("Escape");
      await p2.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
      // ---- Prompt 16 B9 (h): a 200 + [] schedule_days answer on the poll keeps the map and warns once ----
      const readCellsP2 = () => p2.$$eval("[data-testid=cal-grid] .cal-cell", els => els.map(e => [e.getAttribute("data-day"), e.getAttribute("data-primary"), e.getAttribute("data-backup")]).filter(c => c[1] || c[2]));
      const cellsBefore = await readCellsP2();
      const warnsBefore = p2Warns.length;
      emptyDaysFor = p2;
      console.log("     (B9h: the refresh page's next schedule_days poll will answer 200 + [] - waiting for it, up to 75 s)");
      const emptyGot = await p2.waitForResponse(async (r) => { try { return r.request().method() === "GET" && new URL(r.url()).pathname === "/rest/v1/schedule_days" && (await r.text()) === "[]"; } catch (e) { return false; } }, { timeout: 75000 }).then(() => true).catch(() => false);
      emptyDaysFor = null;
      await p2.waitForTimeout(1500);
      const cellsAfter = await readCellsP2();
      const toastH = await p2.$eval("[data-testid=toast]", el => el.textContent).catch(() => "");
      const tripWarns = p2Warns.slice(warnsBefore).filter(t => /treated as a failed read/.test(t));
      if (!emptyGot) fail(`B9h: no schedule_days poll answered [] within 75 s (served ${emptyDaysServed})`);
      else if (!cellsBefore.length) fail("B9h: no assigned cells on the refresh page's October to keep");
      else if (JSON.stringify(cellsAfter) !== JSON.stringify(cellsBefore)) fail(`B9h: the empty poll answer blanked the calendar: ${cellsBefore.length} assigned cell(s) before, ${cellsAfter.length} after`);
      else if (!/came back empty/.test(toastH) || tripWarns.length !== 1) fail(`B9h: expected one 'came back empty' toast and one console warning (toast: "${toastH.slice(0, 120)}", warnings: ${tripWarns.length})`);
      else ok(`B9h: a 200 + [] schedule_days poll answer kept all ${cellsBefore.length} assigned October cells; toast "${toastH.slice(0, 110)}"; one console warning`);
      await p2.setViewportSize({ width: 1180, height: 900 });
    } catch (e) { fail("refresh banners: " + errLine(e)); try { await p2.screenshot({ path: path.join(OUT, "failure-refresh.png"), fullPage: true }); } catch (e2) {} }
    minVersionOverride = null;
    await p2.close();
  }

  // ====================== Prompt 11: data management end to end (recorded writes) ======================
  {
    const p3 = await context.newPage();
    watchPage(p3, "data");
    await p3.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    await p3.route((url) => url.hostname === SUPABASE_HOST, routeSupabase);
    const dialogs3 = [];
    let promptAnswer = null; // null = dismiss the RESET prompt
    p3.on("dialog", (d) => { dialogs3.push({ type: d.type(), message: d.message() }); if (d.type() === "prompt") { if (promptAnswer === null) d.dismiss(); else d.accept(promptAnswer); } else d.accept(); });
    const bodyText3 = () => p3.evaluate(() => document.body.innerText || "");
    const covCount = async () => { await p3.click('button[data-tab="calendar"]'); await p3.waitForSelector("[data-testid=cov-open-primary]", { timeout: 5000 }); await p3.waitForTimeout(300); return p3.$eval("[data-testid=cov-open-primary]", el => Number(el.getAttribute("data-count"))); };
    const toSettings = async () => { await p3.click('button[data-tab="settings"]'); await p3.waitForSelector("[data-testid=export-backup]", { timeout: 8000 }); };
    const normRow = (r) => ({ day: r.day, primary_id: r.primary_id || null, backup_id: r.backup_id || null, primary_locked: r.primary_locked === true, backup_locked: r.backup_locked === true, source: r.source || null, external_cover: r.external_cover || null, note: (r.note === undefined || r.note === null || r.note === "") ? null : String(r.note) });
    const mapText = (rows) => JSON.stringify(rows.map(normRow).sort((a, b) => a.day < b.day ? -1 : 1));
    try {
      await loadWithRetry(p3, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "data page");
      await p3.waitForSelector("text=Synced", { timeout: 30000 });
      const openBefore = await covCount();
      await p3.waitForTimeout(3300); // past the autosave hydration window
      // Live counts (anon) for the export comparison - the fixture lengths when the live table is empty.
      const liveCount = async (t) => {
        if (fixture && fixture[t]) return fixture[t].length;
        const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/${t}?select=${t === "schedule_days" ? "day" : "id"}&limit=1`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY, prefer: "count=exact" } });
        if (!res.ok) throw new Error(`${t} count read failed: HTTP ${res.status}`);
        return Number((res.headers.get("content-range") || "").split("/")[1] || "0");
      };
      const liveCounts = { schedule_days: await liveCount("schedule_days"), time_off: await liveCount("time_off"), availability: await liveCount("availability") };
      // (1) Export
      await toSettings();
      const [dl] = await Promise.all([p3.waitForEvent("download", { timeout: 8000 }), p3.click("[data-testid=export-backup]")]);
      const expName = dl.suggestedFilename(); const expPath = path.join(OUT, expName); await dl.saveAs(expPath);
      const expText = fs.readFileSync(expPath, "utf8");
      const backup = JSON.parse(expText);
      const shapeOk = ["config", "schedule_days", "time_off", "availability"].every(k => k in backup) && backup.config && typeof backup.config === "object" && !Array.isArray(backup.config) && [backup.schedule_days, backup.time_off, backup.availability].every(Array.isArray);
      if (!shapeOk) fail("Export backup: shape is not { config, schedule_days, time_off, availability }: keys " + Object.keys(backup).join(","));
      else if (backup.schedule_days.length !== liveCounts.schedule_days || backup.time_off.length !== liveCounts.time_off || backup.availability.length !== liveCounts.availability) fail(`Export backup: counts ${backup.schedule_days.length}/${backup.time_off.length}/${backup.availability.length} differ from the live anon data ${liveCounts.schedule_days}/${liveCounts.time_off}/${liveCounts.availability} (schedule_days/time_off/availability)`);
      else if ("schedule" in backup.config || "vacations" in backup.config || "availability" in backup.config) fail("Export backup: config carries operational keys: " + Object.keys(backup.config).join(","));
      else if (!/^silvis-call-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(expName)) fail("Export backup: filename " + expName);
      else if (!noAddress(expText)) fail("Export backup: the file carries an email address");
      else ok(`Export backup: ${expName} = { config (${Object.keys(backup.config).join(", ")}), schedule_days ${backup.schedule_days.length}, time_off ${backup.time_off.length}, availability ${backup.availability.length} } - counts equal the live anon data`);
      // (2) Malformed imports are refused before any write
      const beforeBad = writes.length;
      await p3.setInputFiles("[data-testid=import-file]", { name: "bad-shape.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ config: [], schedule_days: [] })) });
      const badToast = await waitFor(async () => /backup shape invalid: config must be an object/i.test(await bodyText3()), 5000);
      await p3.setInputFiles("[data-testid=import-file]", { name: "bad-day.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ config: {}, schedule_days: [{ day: "nope" }] })) });
      const badDayToast = await waitFor(async () => /schedule_days\[0\] has no valid day/.test(await bodyText3()), 5000);
      await p3.setInputFiles("[data-testid=import-file]", { name: "not-json.json", mimeType: "application/json", buffer: Buffer.from("{ not json") });
      const notJsonToast = await waitFor(async () => /not valid JSON/.test(await bodyText3()), 5000);
      const badWrites = writesSince(beforeBad).filter(w => /\/rest\/v1\/(call_schedule_snapshots|schedule_days|call_schedule_data|time_off|availability)/.test(w.path));
      const badConfirm = dialogs3.some(d => d.type === "confirm" && /Import this backup/.test(d.message));
      if (!badToast || !badDayToast || !notJsonToast) fail(`Import backup (malformed): toasts missing - shape ${badToast}, bad day ${badDayToast}, not-JSON ${notJsonToast}`);
      else if (badWrites.length || badConfirm) fail("Import backup (malformed): a write or the confirm happened: " + JSON.stringify(badWrites.map(w => w.method + " " + w.path)) + " confirm=" + badConfirm);
      else ok("Import backup: { config: [] }, a row without a valid day and non-JSON are each refused with a toast before the confirm - zero writes");
      // (3) Factory reset: the typed word must be RESET
      promptAnswer = "reset";
      const beforeWrong = writes.length;
      await p3.click("[data-testid=reset-all-data]");
      // The header status shows for 2 s and an earlier save's own 2 s clear can cut it short - poll from the click.
      const wrongStatus = await waitFor(async () => /Reset cancelled/i.test(await bodyText3()), 2500, 50); // the header sub-line is CSS-uppercased in innerText
      await p3.waitForTimeout(500);
      const wrongWrites = writesSince(beforeWrong).filter(w => /\/rest\/v1\/(call_schedule_snapshots|schedule_days|call_schedule_data)/.test(w.path));
      const wrongPrompt = dialogs3.filter(d => d.type === "prompt").pop();
      if (!wrongPrompt || !/Type  RESET  \(all caps\) to confirm/.test(wrongPrompt.message)) fail("Factory reset: no RESET prompt: " + JSON.stringify(wrongPrompt));
      else if (wrongWrites.length || !wrongStatus) fail(`Factory reset: typing 'reset' (lower case) must cancel with no write - writes ${wrongWrites.length}, status 'Reset cancelled' ${wrongStatus}`);
      else ok("Factory reset: the prompt demands RESET in caps; 'reset' cancels with no snapshot / delete / blob write");
      // (4) Factory reset with the snapshot insert failing: nothing deleted
      failSnapshotInsert = true; promptAnswer = "RESET";
      const beforeSnapFail = writes.length;
      await p3.click("[data-testid=reset-all-data]");
      await waitFor(() => writesSince(beforeSnapFail, "/rest/v1/call_schedule_snapshots").length > 0, 30000);
      await p3.waitForTimeout(900);
      const sf = writesSince(beforeSnapFail);
      const sfSnap = sf.find(w => w.path.startsWith("/rest/v1/call_schedule_snapshots"));
      const sfDel = sf.filter(w => w.method === "DELETE");
      const sfBlob = sf.filter(w => w.path.startsWith("/rest/v1/call_schedule_data"));
      const sfAudit = auditSince(beforeSnapFail, "data.reset");
      const sfToast = /reset cancelled\. Nothing was deleted/.test(await bodyText3());
      failSnapshotInsert = false;
      if (!sfSnap || !sfSnap.forcedFail) fail("Factory reset (snapshot failing): the snapshot insert was not attempted / not the forced failure");
      else if (sfDel.length || sfBlob.length) fail("Factory reset (snapshot failing): something was deleted or written: " + JSON.stringify(sf.map(w => w.method + " " + w.path)));
      else if (sfAudit) fail("Factory reset (snapshot failing): an audit 'data.reset' row was written although nothing happened: " + JSON.stringify(sfAudit.detail));
      else if (!sfToast) fail("Factory reset (snapshot failing): no 'reset cancelled. Nothing was deleted' toast");
      else ok("Factory reset with the snapshot insert answering 500: the attempt is recorded, NO schedule_days DELETE, NO blob write, no audit row, toast says nothing was deleted");
      // (5) Factory reset for real: snapshot BEFORE the delete, then the blob reset, then the audit row
      const beforeReset = writes.length;
      await p3.click("[data-testid=reset-all-data]");
      await waitFor(() => writesSince(beforeReset).some(w => w.method === "DELETE" && w.path === "/rest/v1/schedule_days?day=not.is.null"), 30000);
      await waitFor(() => !!auditSince(beforeReset, "data.reset"), 10000);
      await p3.waitForTimeout(1200);
      const rs = writesSince(beforeReset);
      const iSnap = rs.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
      const iDel = rs.findIndex(w => w.method === "DELETE" && w.path === "/rest/v1/schedule_days?day=not.is.null");
      const iBlob = rs.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_data") && /_intentionalClear/.test(w.body));
      const iAudit = rs.findIndex(w => w.path.startsWith("/rest/v1/audit_log") && /"data\.reset"/.test(w.body));
      const resetAudit = auditSince(beforeReset, "data.reset");
      const snapRow = snapStore.slice().reverse().find(r => r.reason === "reset_all_data");
      const openAfterReset = await covCount();
      const resetStatus = /No schedule days in the database yet/.test(await bodyText3());
      if (iSnap < 0 || rs[iSnap].snapshotReason !== "reset_all_data") fail("Factory reset: no 'reset_all_data' snapshot insert: " + JSON.stringify(rs.map(w => w.method + " " + w.path)));
      else if (iDel < 0 || iDel < iSnap) fail(`Factory reset: the schedule_days DELETE (#${iDel}) did not follow the snapshot (#${iSnap})`);
      else if (iBlob < 0 || iBlob < iDel) fail(`Factory reset: the blob reset (#${iBlob}) did not follow the DELETE (#${iDel})`);
      else if (!resetAudit || resetAudit.detail.outcome !== "ok" || iAudit < iDel) fail("Factory reset: audit 'data.reset' missing, not outcome ok, or logged before the delete: " + JSON.stringify(resetAudit && resetAudit.detail));
      else if (!snapRow || !snapRow.data || snapRow.data.schedule_days.length !== backup.schedule_days.length) fail(`Factory reset: the captured snapshot does not hold the ${backup.schedule_days.length} live day rows: ` + (snapRow ? snapRow.data.schedule_days.length : "no row"));
      else if (openAfterReset !== 60 || !resetStatus) fail(`Factory reset: the calendar should read empty afterwards (open primary 60, 'No schedule days' note) - got ${openAfterReset}, note ${resetStatus}`);
      else ok(`Factory reset (RESET typed): snapshot 'reset_all_data' (#${iSnap}, ${snapRow.data.schedule_days.length} days / ${snapRow.data.time_off.length} time_off / ${snapRow.data.availability.length} availability) -> DELETE schedule_days?day=not.is.null (#${iDel}) -> blob reset (#${iBlob}) -> audit data.reset outcome ok (#${iAudit}); calendar now empty (open primary 60 of 60)`);
      // (6) Restore from that snapshot: config upsert, CAS day POSTs, table upserts; byte-compare
      await toSettings();
      const restoreCard = p3.locator("text=Restore from snapshot");
      if (!(await p3.$("[data-testid=snapshot-row]"))) await restoreCard.click();
      await p3.waitForSelector("[data-testid=snapshot-row]", { timeout: 10000 });
      const row = p3.locator(`[data-testid=snapshot-row][data-snapshot-id="${snapRow ? snapRow.id : "none"}"]`);
      if (!(await row.count())) throw new Error("the 'Before factory reset' snapshot is not listed in Settings (rows: " + (await p3.$$eval("[data-testid=snapshot-row]", els => els.map(e => e.getAttribute("data-reason")))).join(",") + ")");
      const rowLabel = (await row.innerText()).replace(/\s+/g, " ");
      const beforeRestore = writes.length;
      await row.locator("[data-testid=snapshot-restore]").click();
      await waitFor(() => !!auditSince(beforeRestore, "snapshot.restore"), 60000);
      await p3.waitForTimeout(1500);
      const rr = writesSince(beforeRestore);
      const jSnap = rr.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
      const jCfg = rr.findIndex((w, i) => i > jSnap && w.method === "POST" && w.path === "/rest/v1/call_schedule_data");
      const dayW = rr.filter(w => w.path.startsWith("/rest/v1/schedule_days"));
      const jDay = dayW.length ? rr.indexOf(dayW[0]) : -1;
      const jTo = rr.findIndex(w => w.method === "POST" && w.path === "/rest/v1/time_off?on_conflict=id");
      const jAv = rr.findIndex(w => w.method === "POST" && w.path === "/rest/v1/availability?on_conflict=id");
      const cfgBody = jCfg >= 0 ? bodyOf(rr[jCfg]) : null;
      const casOk = dayW.every(w => w.method === "POST" && /return=representation/.test(w.prefer || "") && (bodyOf(w) || {}).version === 1 && (bodyOf(w) || {}).updated_by === "s1");
      const restoredMap = mapText(dayW.map(bodyOf).filter(Boolean));
      const snapMap = mapText(snapRow.data.schedule_days);
      const exportMap = mapText(backup.schedule_days);
      const restoreAudit = auditSince(beforeRestore, "snapshot.restore");
      const restoreAlert = dialogs3.find(d => d.type === "alert" && /Restore complete/.test(d.message));
      const openAfterRestore = await covCount();
      if (!/Before factory reset/.test(rowLabel)) fail("Restore: the snapshot row is not labelled 'Before factory reset': " + rowLabel);
      else if (jSnap < 0 || rr[jSnap].snapshotReason !== "before_restore") fail("Restore: no 'before_restore' snapshot first: " + JSON.stringify(rr.slice(0, 4).map(w => w.method + " " + w.path)));
      else if (jCfg < 0 || !cfgBody || JSON.stringify(cfgBody.data) !== JSON.stringify(snapRow.data.config) || !/merge-duplicates/.test(rr[jCfg].prefer || "")) fail("Restore: the config upsert is missing, not after the snapshot, or its data differs from the snapshot's config");
      else if (jDay < 0 || jDay < jCfg) fail(`Restore: the schedule_days writes (#${jDay}) did not follow the config upsert (#${jCfg})`);
      else if (dayW.length !== snapRow.data.schedule_days.length || !casOk) fail(`Restore: expected ${snapRow.data.schedule_days.length} CAS POSTs (version 1, return=representation, updated_by s1), got ${dayW.length}, CAS-shaped ${casOk}`);
      else if (restoredMap !== snapMap) fail("Restore: BYTE-COMPARE FAILED - the restored day rows differ from the snapshot's rows");
      else if (snapMap !== exportMap) fail("Restore: BYTE-COMPARE FAILED - the snapshot's day rows differ from the JSON export taken before the reset");
      else if ((snapRow.data.time_off.length > 0 && (jTo < jDay || (bodyOf(rr[jTo]) || []).length !== snapRow.data.time_off.length)) || (snapRow.data.availability.length > 0 && (jAv < jDay || (bodyOf(rr[jAv]) || []).length !== snapRow.data.availability.length))) fail(`Restore: time_off / availability upserts wrong (time_off #${jTo}, availability #${jAv})`);
      else if (!restoreAudit || restoreAudit.detail.snapshot_id !== snapRow.id) fail("Restore: audit 'snapshot.restore' missing or not for this snapshot: " + JSON.stringify(restoreAudit && restoreAudit.detail));
      else if (!restoreAlert) fail("Restore: no 'Restore complete' summary");
      else if (openAfterRestore !== openBefore) fail(`Restore: the coverage strip reads ${openAfterRestore} open primary, ${openBefore} before the reset`);
      else ok(`Restore from 'Before factory reset': snapshot before_restore (#${jSnap}) -> config upsert (#${jCfg}, data == snapshot config) -> ${dayW.length} CAS POSTs v1 (#${jDay}..) -> time_off upsert (#${jTo}, ${snapRow.data.time_off.length}) + availability upsert (#${jAv}, ${snapRow.data.availability.length}); restored map == snapshot map == export map (byte compare, ${restoredMap.length} bytes); audit snapshot.restore; coverage strip back to ${openAfterRestore} open primary`);
      if (!rr.every(w => noAddress(w.body))) fail("Restore: a write body carries an email address");
      // (7) A valid import of the export taken before the reset: snapshot first; the state already matches, so no day is rewritten
      await toSettings();
      const beforeImp = writes.length;
      await p3.setInputFiles("[data-testid=import-file]", { name: expName, mimeType: "application/json", buffer: Buffer.from(expText) });
      await waitFor(() => !!auditSince(beforeImp, "data.import"), 60000);
      await p3.waitForTimeout(1200);
      const ir = writesSince(beforeImp);
      const kSnap = ir.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
      const kCfg = ir.findIndex((w, i) => i > kSnap && w.method === "POST" && w.path === "/rest/v1/call_schedule_data");
      const kDays = ir.filter(w => w.path.startsWith("/rest/v1/schedule_days"));
      const kTo = ir.findIndex(w => w.method === "POST" && w.path === "/rest/v1/time_off?on_conflict=id");
      const impConfirm = dialogs3.find(d => d.type === "confirm" && /Import this backup/.test(d.message));
      const impAudit = auditSince(beforeImp, "data.import");
      if (kSnap < 0 || ir[kSnap].snapshotReason !== "before_import") fail("Import backup (valid): no 'before_import' snapshot first: " + JSON.stringify(ir.slice(0, 4).map(w => w.method + " " + w.path)));
      else if (kCfg < 0) fail("Import backup (valid): no config upsert after the snapshot");
      else if (kDays.length) fail(`Import backup (valid): ${kDays.length} schedule_days write(s) although the map already equals the backup`);
      else if (!impConfirm || !impConfirm.message.includes(`${backup.schedule_days.length} schedule day(s), ${backup.time_off.length} vacation row(s), ${backup.availability.length} availability row(s)`)) fail("Import backup (valid): the confirm does not state the counts: " + (impConfirm && impConfirm.message.slice(0, 160)));
      else if (!impAudit) fail("Import backup (valid): no audit 'data.import'");
      else ok(`Import backup (the export, valid): confirm states ${backup.schedule_days.length} / ${backup.time_off.length} / ${backup.availability.length}; snapshot before_import (#${kSnap}) -> config upsert (#${kCfg}) -> 0 day writes (map unchanged) -> time_off upsert (#${kTo}); audit data.import`);
      await p3.screenshot({ path: path.join(OUT, "data-management.png"), fullPage: true });
    } catch (e) { fail("data management: " + errLine(e)); try { await p3.screenshot({ path: path.join(OUT, "failure-data.png"), fullPage: true }); } catch (e2) {} }
    failSnapshotInsert = false;
    await p3.close();
  }

  // ====================== Prompt 16 A7: the COORDINATOR (office) session ======================
  // A second page signed in as COORD_PROFILE (role coordinator, no roster link). The picture: the viewer's views plus
  // Time off with a person picker (add for anyone, created_by = the profile id, the note denylist, Remove), the
  // "Offers - enter for a surgeon" card (the painter as the office; save_offers with p_person; the mock stamps
  // entered_by = the profile id / source office-relay from the JWT sub), the Activity log in Settings; no Setup, no
  // Generate, no Mine, no Paint offers, no trade card; the day tap opens the read-only detail (no Save button).
  {
    const pc = await context.newPage();
    watchPage(pc, "coordinator");
    await pc.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, COORD_JWT);
    await pc.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    await pc.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(COORD_PROFILE));
    pc.on("dialog", (d) => d.accept());
    const auditGets = [];
    pc.on("request", (r) => { if (r.method() === "GET" && /\/rest\/v1\/audit_log\?/.test(r.url())) auditGets.push(r.url()); });
    const bodyTextC = () => pc.evaluate(() => document.body.innerText || "");
    try {
      await loadWithRetry(pc, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "coordinator page");
      await pc.waitForSelector("text=Synced", { timeout: 30000 });
      await pc.waitForTimeout(1200);
      // (a) the shell: no unlinked banner, no Setup / Mine / Paint offers, Time off present, no Generate panel anywhere
      const tabs = await pc.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
      const banner = await pc.$("[data-testid=unlinked-banner]");
      const paintNav = await pc.$("[data-testid=nav-paint-offers]");
      if (banner) fail("coordinator: the unlinked-account banner is shown to the office account (it has no roster link by design)");
      else if (tabs.includes("setup") || tabs.includes("myschedule") || !tabs.includes("timeoff") || !tabs.includes("calendar") || paintNav) fail("coordinator: nav wrong - expected no Setup / Mine / Paint offers and a Time off tab, got " + tabs.join(",") + (paintNav ? " + Paint offers" : ""));
      else ok("coordinator: no unlinked banner; nav = " + tabs.join(", ") + " (no Setup, no Mine, no Paint offers)");
      if (await pc.$("[data-testid=gen-start]")) fail("coordinator: a Generate panel rendered"); else ok("coordinator: no Generate panel");
      // (b) the day tap opens the read-only detail: no Save, a Close button
      await pc.click(".cal-cell[data-day]");
      await pc.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      const saveBtn = await pc.$("[data-testid=editor-save]");
      const closeBtn = await pc.$("[data-testid=editor-footer] button:has-text('Close')");
      const externalInput = await pc.$("[data-testid=editor-external]");
      if (saveBtn || externalInput || !closeBtn) fail(`coordinator: the day tap must open the read-only detail (no Save, no outside-cover input, a Close button): save=${!!saveBtn} external=${!!externalInput} close=${!!closeBtn}`);
      else ok("coordinator: day tap = read-only detail (no editor-save, no editor-external, Close)");
      await closeBtn.click();
      await pc.waitForTimeout(200);
      // (c) Time off: the person picker offers every surgeon; no trade card; the note denylist; the clean add for s3
      await pc.click('button[data-tab="timeoff"]');
      await pc.waitForSelector("[data-testid=timeoff-card]", { timeout: 8000 });
      const card = pc.locator("[data-testid=timeoff-card]");
      const sel = card.locator("select").first();
      const picker = await sel.evaluate(el => ({ disabled: el.disabled, options: Array.from(el.options).map(o => o.value).filter(Boolean) }));
      const title = await card.locator("div").first().innerText();
      // (innerText is upper-cased by the card title's text-transform: the two title reads below are case-insensitive)
      if (picker.disabled || picker.options.length !== 6 || !/^Vacations/i.test(title)) fail("coordinator: the Time off person picker should be enabled with the six surgeons under the title 'Vacations': " + JSON.stringify({ ...picker, title }));
      else ok("coordinator: Time off = 'Vacations' with an enabled person picker (" + picker.options.join(",") + ")");
      // review: the copy speaks to the office (not "your own vacations")
      const vacNote = await card.locator("p").first().innerText();
      if (!/^Enter a surgeon's vacation/.test(vacNote) || /your own vacations|if you are already published/.test(vacNote)) fail("coordinator: the Time off note must speak to the office ('Enter a surgeon's vacation ...'), got: " + vacNote.slice(0, 140));
      else ok("coordinator: the Time off note reads 'Enter a surgeon's vacation ...' (no 'your own')");
      if (await pc.$("[data-testid=trade-card]")) fail("coordinator: the trade card rendered (the office proposes no trades)"); else ok("coordinator: no trade card");
      if (!(await pc.$("[data-testid=coord-offers-card]"))) fail("coordinator: the 'Offers - enter for a surgeon' card is missing"); else ok("coordinator: the 'Offers - enter for a surgeon' card renders");
      const dates = card.locator("input[type=date]");
      await sel.selectOption("s3");
      await dates.nth(0).fill("2027-03-16");
      await dates.nth(1).fill("2027-03-17");
      const b0 = writes.length;
      await pc.fill("[data-testid=vac-note]", "family trip");
      await pc.click("[data-testid=vac-add]");
      await pc.waitForTimeout(700);
      const deniedWrites = writesSince(b0).filter(w => /\/rest\/v1\/(time_off|audit_log|notifications)/.test(w.path));
      const deniedToast = await bodyTextC();
      if (deniedWrites.length || !/operational only/.test(deniedToast)) fail("coordinator: a note on the denylist ('family trip') must be refused with the operational-only toast and no write: writes=" + deniedWrites.length + " toast=" + /operational only/.test(deniedToast));
      else ok("coordinator: the note denylist refuses 'family trip' (toast, no time_off / audit / notification write)");
      const b1 = writes.length;
      await pc.fill("[data-testid=vac-note]", "office entry");
      await pc.click("[data-testid=vac-add]");
      await waitFor(() => writesSince(b1, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "timeoff.add"), 8000);
      await pc.waitForTimeout(800);
      const toPost = writesSince(b1, "/rest/v1/time_off").filter(w => w.method === "POST");
      const toBody = toPost[0] ? bodyOf(toPost[0]) : null;
      const toAudit = auditSince(b1, "timeoff.add");
      const toNotif = writesSince(b1, "/rest/v1/notifications").map(bodyOf).find(n => n && n.type === "vacation_logged");
      const mails = writesSince(b1).filter(w => /send-notification/.test(w.path));
      if (toPost.length !== 1 || !toBody || toBody.person_id !== "s3" || toBody.start_date !== "2027-03-16" || toBody.end_date !== "2027-03-17" || toBody.note !== "office entry" || toBody.created_by !== COORD_UID) fail("coordinator: expected ONE POST /rest/v1/time_off { s3, 2027-03-16..17, note, created_by = the coordinator's profile id }: " + JSON.stringify(toPost.map(w => w.body)));
      else if (!toAudit || toAudit.actor_id !== COORD_UID || toAudit.actor_name !== COORD_PROFILE.display_name || !toAudit.detail || toAudit.detail.person_id !== "s3") fail("coordinator: the audit timeoff.add must carry actor_id = the profile id and actor_name = the display name: " + JSON.stringify(toAudit));
      else if (!toNotif || !/Acton logged vacation 3\/16-3\/17 \(office entry\) - entered by Office \(harness\)/.test(toNotif.message) || !toNotif.data || toNotif.data.entered_by !== COORD_UID || toNotif.data.surgeon_id !== "s3") fail("coordinator: the vacation_logged feed row must name the office and carry entered_by = the profile id: " + JSON.stringify(toNotif));
      else if (mails.length) fail("coordinator: a send-notification call went out (the function answers 403 for the role; nothing should be attempted): " + JSON.stringify(mails.map(w => w.path)));
      else ok(`coordinator: vacation for s3 = POST time_off { created_by ${COORD_UID.slice(-4)} } + audit timeoff.add { actor_id = profile id, actor_name '${toAudit.actor_name}' } + feed "${toNotif.message}"; no e-mail attempted`);
      if (!writesSince(b1).every(w => noAddress(w.body))) fail("coordinator: a write body carries an email address");
      // Remove the row just added: Edit / Remove render for the office; the DELETE goes by id and is audited as the office
      const b2 = writes.length;
      // Item B: the row is the compact line under Acton's group header (vac-line-<id>-<start>), reading "Mar 16-17 (2027) office entry".
      const newLine = card.locator("[data-testid=vac-line-s3-2027-03-16]");
      const newLineText = (await newLine.count()) ? (await newLine.innerText()).replace(/\s+/g, " ").trim() : "";
      const newLineUnderS3 = (await newLine.count()) ? await newLine.evaluate(el => !!el.parentElement.querySelector("[data-testid=vac-group-s3]")) : false;
      if (!/^Mar 16\u201317 \(2027\) office entry/.test(newLineText) || !newLineUnderS3) fail("coordinator (Item B): the new row should read 'Mar 16-17 (2027) office entry' under Acton's group header: '" + newLineText + "' (under vac-group-s3: " + newLineUnderS3 + ")");
      else ok("coordinator (Item B): the new row reads 'Mar 16\u201317 (2027) office entry' under Acton's group header");
      let removeBtn = null;
      for (const h of await newLine.locator("button:has-text('Remove')").elementHandles()) { removeBtn = h; break; }
      if (!removeBtn) fail("coordinator: the new row (2027-03-16 to 2027-03-17) shows no Remove button for the office");
      else {
        await removeBtn.click();
        await waitFor(() => writesSince(b2, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "timeoff.remove"), 8000);
        await pc.waitForTimeout(400);
        const del = writesSince(b2, "/rest/v1/time_off").find(w => w.method === "DELETE");
        const rmAudit = auditSince(b2, "timeoff.remove");
        if (!del || !/^\/rest\/v1\/time_off\?id=eq\./.test(del.path)) fail("coordinator: Remove must DELETE /rest/v1/time_off?id=eq.<id>: " + JSON.stringify(writesSince(b2).map(w => w.method + " " + w.path)));
        else if (!rmAudit || rmAudit.actor_id !== COORD_UID || rmAudit.detail.person_id !== "s3") fail("coordinator: the audit timeoff.remove must carry actor_id = the profile id: " + JSON.stringify(rmAudit));
        else ok("coordinator: Remove = DELETE time_off?id=eq.<id> + audit timeoff.remove as the office");
      }
      // (d) the offers relay: pick s3, the painter opens as the office, one free day painted, Save -> save_offers p_person s3
      await pc.selectOption("[data-testid=coord-offers-person]", "s3");
      await pc.click("[data-testid=coord-offers-open]");
      await pc.waitForSelector("[data-testid=ofp-sheet][data-person=s3]", { timeout: 8000 });
      const head = await pc.$eval("[data-testid=ofp-sheet]", el => el.innerText.slice(0, 300).replace(/\s+/g, " "));
      if (!/Paint offers for Acton/.test(head) || !/as the office \(relayed\)/.test(head)) fail("coordinator: the painter header should read 'Paint offers for Acton ... as the office (relayed)': " + head.slice(0, 120));
      else ok("coordinator: the painter opens for Acton 'as the office (relayed)'");
      // review: the tap hint names the relayed surgeon, never "yourself"
      const relayHint = await pc.$eval("[data-testid=ofp-hint]", el => el.innerText.replace(/\s+/g, " "));
      if (!/Tap a day to offer Acton as /.test(relayHint) || /yourself/.test(relayHint)) fail("coordinator: the painter's tap hint must name Acton (not 'yourself') while relaying: " + relayHint.slice(0, 120));
      else ok("coordinator: the tap hint reads 'Tap a day to offer Acton as ...'");
      let freeDay = null;
      for (let k = 0; k < 6 && !freeDay; k++) {
        freeDay = await pc.$$eval("[data-testid=ofp-day][data-state=free]", els => { const e = els.find(x => !x.getAttribute("data-why")); return e ? e.getAttribute("data-day") : null; });
        if (!freeDay) { await pc.click("[data-testid=ofp-next]"); await pc.waitForTimeout(200); }
      }
      if (!freeDay) fail("coordinator: no paintable day for s3 within six months");
      else {
        const b3 = writes.length;
        await pc.click(`[data-testid=ofp-day][data-day="${freeDay}"]`);
        await pc.waitForTimeout(150);
        await pc.click("[data-testid=ofp-save]");
        await waitFor(() => writesSince(b3, "/rest/v1/audit_log").some(w => (bodyOf(w) || {}).action === "offers.save"), 8000);
        await pc.waitForTimeout(500);
        const saves = writesSince(b3, "/rest/v1/rpc/save_offers");
        const sb = saves[0] ? bodyOf(saves[0]) : null;
        const oAudit = auditSince(b3, "offers.save");
        const stored = offerStore.find(o => o.person_id === "s3" && o.day === freeDay);
        const direct = writesSince(b3).filter(w => /\/rest\/v1\/call_offers/.test(w.path));
        if (saves.length !== 1 || !sb || sb.p_person !== "s3" || !Array.isArray(sb.p_rows) || sb.p_rows.length !== 1 || sb.p_rows[0].day !== freeDay || sb.p_rows[0].role_pref !== "either") fail("coordinator: expected ONE rpc/save_offers { p_person s3, one row " + freeDay + " either }: " + JSON.stringify(saves.map(w => w.body)));
        else if (direct.length) fail("coordinator: a direct call_offers write went out (the office writes only through save_offers): " + JSON.stringify(direct.map(w => w.method + " " + w.path)));
        else if (!stored || stored.source !== "office-relay" || stored.entered_by !== COORD_UID) fail("coordinator: the stored offer should read source office-relay / entered_by = the profile id (what save_offers stamps for a coordinator): " + JSON.stringify(stored));
        else if (!oAudit || oAudit.actor_id !== COORD_UID || oAudit.actor_name !== COORD_PROFILE.display_name || oAudit.detail.person_id !== "s3") fail("coordinator: the audit offers.save must carry actor_id = the profile id: " + JSON.stringify(oAudit));
        else ok(`coordinator: offers relay for s3 = ONE rpc/save_offers { p_person s3, ${freeDay} either } -> row source office-relay / entered_by = profile id; audit offers.save as the office; no direct call_offers write`);
      }
      await pc.click("[data-testid=ofp-close]");
      await pc.waitForTimeout(300);
      // (e) Settings: the Activity log card (own entries) + its audit_log read; no export / snapshots / client versions
      await pc.click('button[data-tab="settings"]');
      await pc.waitForTimeout(1000);
      const auditCard = await pc.$("[data-testid=card-settings_audit]");
      const exportBtn = await pc.$("[data-testid=export-backup]");
      const cvCard = await pc.$("[data-testid=card-settings_client_versions]");
      const logTitle = auditCard ? (await auditCard.innerText()).replace(/\s+/g, " ").slice(0, 80) : "";
      if (!auditCard || exportBtn || cvCard || !auditGets.length || !/your entries/i.test(logTitle)) fail(`coordinator: Settings should show the Activity log ('your entries') with one audit_log read and nothing of the scheduler's (export / client versions): card=${!!auditCard} export=${!!exportBtn} cv=${!!cvCard} reads=${auditGets.length} title='${logTitle}'`);
      else ok(`coordinator: Settings = Activity log '${logTitle.slice(0, 50)}' (audit_log read ${auditGets.length}x); no export, no client versions`);
      await pc.screenshot({ path: path.join(OUT, "coordinator.png"), fullPage: true });
      ok("screenshot test/ui/out/coordinator.png");
    } catch (e) { fail("coordinator session: " + errLine(e)); try { await pc.screenshot({ path: path.join(OUT, "failure-coordinator.png"), fullPage: true }); } catch (e2) {} }
    await pc.close();
  }

  // ====================== Prompt 16 B3: the VIEWER (read-only) session ======================
  // A third page signed in as VIEWER_PROFILE (role viewer, no roster link - the office viewer, and every invited account
  // until the admin links and promotes it). Its notifications GET answers VIEWER_FEED (four types). 390 px in BOTH themes
  // (the theme flag is stored before the app boots, then the page is reloaded): no unlinked banner and no Setup / Mine /
  // Paint offers; Time off & Trades = one 'Vacations' card with the viewer's own sentence, no vacation form, no trade
  // card, the 'not linked' sentence nowhere on the page; Settings -> Live calendar sync = the public full-schedule URL
  // with no 'My calendar' and no per-surgeon block, the Account line reads 'a read-only account'; the Alerts badge
  // reads 2 and the panel lists exactly the open_shifts and schedule_published rows; no horizontal page scroll.
  // Screenshots viewer-390-light.png / viewer-390-dark.png.
  {
    const pv = await context.newPage();
    watchPage(pv, "viewer");
    await pv.setViewportSize({ width: 390, height: 844 });
    await pv.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, VIEWER_JWT);
    await pv.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    await pv.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(VIEWER_PROFILE, async ({ url, req, json }) => {
      if (!url.pathname.startsWith("/rest/v1/notifications") || req.method() !== "GET") return false;
      const typeEq = url.searchParams.get("type"); // the board's last-announced read asks ?type=eq.open_shifts
      const rows = typeEq && typeEq.startsWith("eq.") ? VIEWER_FEED.filter(n => n.type === typeEq.slice(3)) : VIEWER_FEED;
      await json(200, rows);
      return true;
    }));
    pv.on("dialog", (d) => d.accept());
    const NOT_LINKED = "not linked to a roster entry";
    const expectedFull = `https://${SUPABASE_HOST}/functions/v1/calendar-sync`;
    const bodyTextV = () => pv.evaluate(() => document.body.innerText || "");
    try {
      for (const theme of ["light", "dark"]) {
        // The theme flag, and a fresh Alerts state: the per-device seen / cleared markers live in the origin's storage
        // (shared by every page of this context), and the light pass's Alerts tap marks the feed seen - without this
        // reset the dark pass would read no badge.
        await pv.addInitScript((dk) => { try { localStorage.setItem("silvis-dark-mode", dk ? "true" : "false"); localStorage.removeItem("silvis-notif-seen"); localStorage.removeItem("silvis-notif-cleared"); } catch (e) {} }, theme === "dark");
        await loadWithRetry(pv, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "viewer page (" + theme + ")");
        await pv.waitForSelector("text=Synced", { timeout: 30000 });
        await pv.waitForTimeout(1200);
        // (a) the shell: no unlinked banner, no Setup / Mine / Paint offers, Time off and Settings present
        const tabs = await pv.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
        const banner = await pv.$("[data-testid=unlinked-banner]");
        const paintNav = await pv.$("[data-testid=nav-paint-offers]");
        if (banner) fail(`viewer (${theme}): the unlinked-account banner is shown to the viewer (no roster link is expected for the role)`);
        else if (tabs.includes("setup") || tabs.includes("myschedule") || paintNav || !tabs.includes("timeoff") || !tabs.includes("settings")) fail(`viewer (${theme}): nav wrong - expected no Setup / Mine / Paint offers and the Time off + Settings tabs, got ${tabs.join(",")}${paintNav ? " + Paint offers" : ""}`);
        else ok(`viewer (${theme}): no unlinked banner; nav = ${tabs.join(", ")} (no Setup, no Mine, no Paint offers)`);
        // The tab reads "Time off" (no "& Trades") - the trades section returns null for the role, so the label must not promise it.
        const timeoffLabel = await pv.$eval("button[data-tab=timeoff]", el => (el.textContent || "").trim());
        if (!/^Time off$/.test(timeoffLabel)) fail(`viewer (${theme}): the Time off tab should read 'Time off' (no trade card behind it), got '${timeoffLabel}'`);
        else ok(`viewer (${theme}): the tab reads 'Time off' (no '& Trades')`);
        // (b) Time off & Trades: one 'Vacations' card with the viewer's sentence, no form, no trade card, no 'not linked' anywhere
        await pv.click('button[data-tab="timeoff"]');
        await pv.waitForSelector("[data-testid=timeoff-card]", { timeout: 8000 });
        const card = pv.locator("[data-testid=timeoff-card]");
        const title = await card.locator("div").first().innerText();
        const note = await pv.$("[data-testid=viewer-timeoff-note]");
        const formInputs = await card.locator("input[type=date]").count();
        const tradeCard = await pv.$("[data-testid=trade-card]");
        const toBody = await bodyTextV();
        const notLinkedHits = toBody.split(NOT_LINKED).length - 1;
        if (!/^Vacations/i.test(title) || !note || formInputs !== 0) fail(`viewer (${theme}): Time off should be one 'Vacations' card with the viewer's sentence and no vacation form: title='${title}' note=${!!note} dateInputs=${formInputs}`);
        else if (tradeCard) fail(`viewer (${theme}): the trade card rendered for a viewer`);
        else if (notLinkedHits) fail(`viewer (${theme}): the 'not linked' sentence appears ${notLinkedHits}x on Time off & Trades`);
        else ok(`viewer (${theme}): Time off = 'Vacations' with the viewer's one sentence, no vacation form, no trade card, the 'not linked' sentence nowhere on the page`);
        // (c) Settings -> Live calendar sync: the public full-schedule feed, no personal / per-surgeon block; the Account line
        await pv.click('button[data-tab="settings"]');
        await pv.waitForSelector("[data-testid=calsync-full]", { timeout: 8000 });
        const full = await pv.$eval("[data-testid=calsync-full]", el => el.value);
        const sBody = await bodyTextV();
        const myCal = /My calendar:/.test(sBody), perSurgeon = /Per surgeon \(matched on code\)/.test(sBody);
        if (full !== expectedFull) fail(`viewer (${theme}): the full-schedule feed input should hold ${expectedFull}, got ${full}`);
        else if (myCal || perSurgeon) fail(`viewer (${theme}): the calendar-sync card shows the personal (${myCal}) / per-surgeon (${perSurgeon}) block to a viewer`);
        else if (!/Subscribe to the full-schedule feed/.test(sBody)) fail(`viewer (${theme}): the calendar-sync sentence does not name the full-schedule feed`);
        else if (/unlinked account/.test(sBody) || !/Signed in as a read-only account/.test(sBody)) fail(`viewer (${theme}): the Account line should read 'Signed in as a read-only account', not 'unlinked account'`);
        else if (sBody.split(NOT_LINKED).length - 1) fail(`viewer (${theme}): the 'not linked' sentence appears on Settings`);
        else ok(`viewer (${theme}): Live calendar sync = the public full-schedule URL only (${full.replace("https://" + SUPABASE_HOST, "<project>")}); Account line 'a read-only account'`);
        // (d) Alerts: the badge counts the two visible rows; the panel lists exactly open_shifts + schedule_published (newest first)
        const badge = await pv.$eval('button[aria-label="Notifications"]', el => (el.querySelector("span") || { textContent: "" }).textContent.trim());
        await pv.click('button[aria-label="Notifications"]');
        await pv.waitForSelector("[data-testid=notif-panel]", { timeout: 5000 });
        const rows = await pv.$$eval("[data-testid=notif-row]", els => els.map(e => e.getAttribute("data-type")));
        const panelText = await pv.$eval("[data-testid=notif-panel]", el => el.innerText || "");
        if (badge !== "2") fail(`viewer (${theme}): the Alerts badge should read 2 (the two visible rows of the four served), got '${badge}'`);
        else if (rows.join(",") !== "open_shifts,schedule_published") fail(`viewer (${theme}): the Alerts panel should list exactly open_shifts, schedule_published (feed order), got [${rows.join(",")}]`);
        else if (/Trade proposed|Vacation logged/.test(panelText)) fail(`viewer (${theme}): the Alerts panel shows a trade / vacation row to a viewer`);
        else ok(`viewer (${theme}): Alerts badge 2; panel = open_shifts + schedule_published only (trade_proposed and vacation_logged filtered out)`);
        await pv.click('button[aria-label="Close notifications"]');
        await pv.waitForTimeout(200);
        // (e) 390 px hygiene + the review shot
        const scrollW = await pv.evaluate(() => document.documentElement.scrollWidth);
        if (scrollW > 390) fail(`viewer (${theme}): horizontal page scroll at 390 px (scrollWidth ${scrollW})`); else ok(`viewer (${theme}): no horizontal page scroll at 390 px`);
        await pv.screenshot({ path: path.join(OUT, `viewer-390-${theme}.png`), fullPage: true });
        ok(`screenshot test/ui/out/viewer-390-${theme}.png`);
      }
    } catch (e) { fail("viewer session: " + errLine(e)); try { await pv.screenshot({ path: path.join(OUT, "failure-viewer.png"), fullPage: true }); } catch (e2) {} }
    await pv.close();
  }

  // ====================== Prompt 20 F3: the FOLLOWER session (what a follower gets in the app) ======================
  // A fourth page signed in as FOLLOW_PROFILE (role viewer, no roster link, follows s2 + s5). 390 px in BOTH themes:
  // (a) the nav shows the Mine tab labelled "Following" (no Setup, no Paint offers, no unlinked banner);
  // (b) Following = one following-card per followed surgeon in the stored order, each with the same hero + 90-day list
  //     Mine renders, and each list equals the days the page's OWN schedule_days answer gives that surgeon (derived from
  //     the served rows, never pinned); no trade button, no offer tag, no painter, no offers / vacations card, no download;
  // (c) Settings -> Live calendar sync: one follow-sync row per followed surgeon holding calendar-sync?surgeon=<CODE>,
  //     above the full feed, Copy answers "Copied";
  // (d) Alerts: the badge counts the five rows a followed surgeon reads and the panel lists exactly them (feed order);
  // (e) nothing but the version heartbeat is written; no horizontal page scroll. Screenshots follower-390-<theme>.png.
  {
    const pf = await context.newPage();
    watchPage(pf, "follower");
    await pf.setViewportSize({ width: 390, height: 844 });
    await pf.addInitScript((t) => { try { localStorage.setItem("silvis-auth-token", t); } catch (e) {} }, FOLLOW_JWT);
    await pf.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {});
    let followTradeGets = 0;
    await pf.route((url) => url.hostname === SUPABASE_HOST, routeSupabaseAs(FOLLOW_PROFILE, async ({ url, req, json }) => {
      // P20 R1: his (authenticated) trade read holds the pending give ff-7 names; any trade write falls through to the
      // shared route, which records it - and step (e) then fails on it
      if (url.pathname.startsWith("/rest/v1/shift_trade_requests") && req.method() === "GET") { followTradeGets++; await json(200, [FOLLOW_GIVE_ROW]); return true; }
      // P20 R2: his own prefs row (see followPrefsColumn). A GET without profile_id (the roster prefs load) reads what
      // prefs_own would give him - his own row, person_id null - which the app must not take for a roster row.
      if (url.pathname.startsWith("/rest/v1/notification_preferences")) {
        const byProfile = url.searchParams.has("profile_id");
        if (req.method() === "GET") {
          if (followPrefsColumn === "absent" && byProfile) { followerPrefs400Lines++; await json(400, { code: "42703", details: null, hint: null, message: "column notification_preferences.profile_id does not exist" }); return true; }
          await json(200, followPrefsColumn === "present" && followPrefRow && (!byProfile || url.searchParams.get("profile_id") === "eq." + FOLLOW_UID) ? [followPrefRow] : []);
          return true;
        }
        const body = req.postData() || "";
        writes.push({ method: req.method(), path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
        if (followPrefsColumn === "absent") { followerPrefs400Lines++; await json(400, { code: "PGRST204", message: "Could not find the 'profile_id' column of 'notification_preferences' in the schema cache", details: null, hint: null }); return true; }
        let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
        if (req.method() === "POST" && url.searchParams.get("on_conflict") === "profile_id" && b.profile_id === FOLLOW_UID) followPrefRow = { ...(followPrefRow || { id: "00000000-0000-4000-8000-0000000000e1", person_id: null }), ...b };
        await json(201, []);
        return true;
      }
      if (!url.pathname.startsWith("/rest/v1/notifications") || req.method() !== "GET") return false;
      const typeEq = url.searchParams.get("type");
      const rows = typeEq && typeEq.startsWith("eq.") ? FOLLOW_FEED.filter(n => n.type === typeEq.slice(3)) : FOLLOW_FEED;
      await json(200, rows);
      return true;
    }));
    pf.on("dialog", (d) => d.accept());
    // the page's own schedule_days answers (paged reads, limit / offset - merged by day; a later read of a day wins)
    const servedByDay = new Map();
    let servedDays = null;
    pf.on("response", async (res) => {
      try {
        const u = new URL(res.url());
        if (u.hostname !== SUPABASE_HOST || !u.pathname.startsWith("/rest/v1/schedule_days") || res.request().method() !== "GET" || u.searchParams.get("day")) return;
        const body = await res.json();
        if (Array.isArray(body) && body.length) { body.forEach(r => { if (r && r.day) servedByDay.set(r.day, r); }); servedDays = Array.from(servedByDay.values()); }
      } catch (e) {}
    });
    const CODES = { s2: "MAB", s5: "NF" };
    const NAMES_F3 = { s2: "Burchett", s5: "Fierce" };
    const addDaysIso = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
    const writesBefore = writes.length;
    let followerPrefToggles = 0; // P20 R2: toggles (c2) made that passed its checks - (e2) expects one prefs POST each
    try {
      for (const theme of ["light", "dark"]) {
        await pf.addInitScript((dk) => { try { localStorage.setItem("silvis-dark-mode", dk ? "true" : "false"); localStorage.removeItem("silvis-notif-seen"); localStorage.removeItem("silvis-notif-cleared"); } catch (e) {} }, theme === "dark");
        await loadWithRetry(pf, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "follower page (" + theme + ")");
        await pf.waitForSelector("text=Synced", { timeout: 30000 });
        await pf.waitForTimeout(1200);
        // (a) the nav
        const tabs = await pf.$$eval("button[data-tab]", els => els.map(e => [e.getAttribute("data-tab"), (e.textContent || "").trim()]));
        const mineTab = tabs.find(([k]) => k === "myschedule");
        const banner = await pf.$("[data-testid=unlinked-banner]");
        const paintNav = await pf.$("[data-testid=nav-paint-offers]");
        if (!mineTab || !/^Following/.test(mineTab[1])) fail(`F3 follower (${theme}): the Mine tab should show and read 'Following', got ${JSON.stringify(tabs)}`);
        else if (tabs.some(([k]) => k === "setup") || paintNav || banner) fail(`F3 follower (${theme}): Setup (${tabs.some(([k]) => k === "setup")}) / Paint offers (${!!paintNav}) / the unlinked banner (${!!banner}) shown to a follower`);
        else ok(`F3 follower (${theme}): nav = ${tabs.map(([, l]) => l.replace(/\d+$/, "")).join(", ")} - the Mine tab reads 'Following'; no Setup, no Paint offers, no unlinked banner`);
        // (b) Following
        await pf.click('button[data-tab="myschedule"]');
        await pf.waitForSelector("[data-testid=following-card]", { timeout: 8000 });
        const cards = await pf.$$eval("[data-testid=following-card]", els => els.map(c => ({
          id: c.getAttribute("data-surgeon"),
          days: Array.from(c.querySelectorAll("[data-testid=mine-day]")).map(r => r.getAttribute("data-day") + "|" + r.getAttribute("data-role")),
          next: (c.querySelector("[data-testid=next-call]") || { getAttribute: () => null }).getAttribute("data-next-day") || "",
          text: c.innerText || "",
        })));
        const forbidden = await pf.evaluate(() => ["mine-trade", "mine-offer-tag", "paint-offers", "mine-offers", "mine-vacations", "download-my-calendar", "copy-sync-url", "mine-card", "mine-person"].filter(t => document.querySelector("[data-testid=" + t + "]")));
        const today = await pf.evaluate(() => (typeof todayCentral === "function" ? todayCentral() : null));
        if (cards.map(c => c.id).join(",") !== "s2,s5") fail(`F3 follower (${theme}): expected two following-cards s2, s5 (the stored order), got [${cards.map(c => c.id).join(",")}]`);
        else if (forbidden.length) fail(`F3 follower (${theme}): the Following view renders surgeon-only controls: ${forbidden.join(", ")}`);
        else if (!today || !servedDays) fail(`F3 follower (${theme}): cannot derive the expected days (today=${today}, served schedule_days rows=${servedDays ? servedDays.length : "none captured"})`);
        else {
          const limit = addDaysIso(today, 90);
          const bad = [];
          const counts = [];
          for (const c of cards) {
            const mine = servedDays.filter(r => r && r.day >= today && (r.primary_id === c.id || r.backup_id === c.id)).sort((a, b) => a.day < b.day ? -1 : 1);
            const want = mine.filter(r => r.day <= limit).map(r => r.day + "|" + (r.primary_id === c.id ? "primary" : "backup"));
            const wantNext = mine.length ? mine[0].day : "";
            if (want.join(",") !== c.days.join(",")) bad.push(`${c.id}: list [${c.days.slice(0, 6).join(",")}...] (${c.days.length}) != served [${want.slice(0, 6).join(",")}...] (${want.length})`);
            if (wantNext !== c.next) bad.push(`${c.id}: next call ${c.next || "(none)"} != served ${wantNext || "(none)"}`);
            if (!c.text.includes("read-only")) bad.push(`${c.id}: the card does not say read-only`);
            counts.push(`${c.id} ${c.days.length} day(s), next ${c.next || "none"}`);
          }
          if (bad.length) fail(`F3 follower (${theme}): Following does not match the served rows - ${bad.join(" | ")}`);
          else ok(`F3 follower (${theme}): Following = two cards (${counts.join("; ")}), each list equal to the page's own schedule_days rows for that surgeon from ${today} to ${limit}; no trade / offer / painter / vacation / download control`);
        }
        // (c) Settings -> Live calendar sync
        await pf.click('button[data-tab="settings"]');
        await pf.waitForSelector("[data-testid=follow-sync]", { timeout: 8000 });
        const rows = await pf.$$eval("[data-testid=follow-sync]", els => els.map(e => ({ id: e.getAttribute("data-surgeon"), url: (e.querySelector("[data-testid=follow-sync-url]") || {}).value || "" })));
        const above = await pf.evaluate(() => { const f = document.querySelectorAll("[data-testid=follow-sync]"); const full = document.querySelector("[data-testid=calsync-full]"); return !!(f.length && full && Array.from(f).every(x => x.compareDocumentPosition(full) & Node.DOCUMENT_POSITION_FOLLOWING)); });
        const wantRows = ["s2", "s5"].map(id => ({ id, url: `https://${SUPABASE_HOST}/functions/v1/calendar-sync?surgeon=${CODES[id]}` }));
        const sBody = await pf.evaluate(() => document.body.innerText || "");
        if (JSON.stringify(rows) !== JSON.stringify(wantRows)) fail(`F3 follower (${theme}): follow-sync rows should be ${JSON.stringify(wantRows)}, got ${JSON.stringify(rows)}`);
        else if (!above) fail(`F3 follower (${theme}): the followed surgeons' feeds must sit above the full-schedule feed`);
        else if (!/Subscribe to the feed of each surgeon you follow, or the full-schedule feed/.test(sBody)) fail(`F3 follower (${theme}): the calendar-sync sentence does not name the followed feeds`);
        else {
          await pf.click("[data-testid=follow-sync] >> nth=0 >> [data-testid=follow-sync-copy]");
          await pf.waitForTimeout(250);
          const label = await pf.$eval("[data-testid=follow-sync] >> nth=0 >> [data-testid=follow-sync-copy]", el => (el.textContent || "").trim()).catch(() => "");
          if (label !== "Copied") fail(`F3 follower (${theme}): Copy on the first follow-sync row should read 'Copied', got '${label}'`);
          else ok(`F3 follower (${theme}): Live calendar sync = ${rows.map(r => r.id + " " + r.url.replace("https://" + SUPABASE_HOST, "<project>")).join(", ")} above the full feed; Copy -> 'Copied'`);
        }
        // (c2) P20 R2 (Faraz 9/25; replaces F3's 'ask the scheduler' note): Settings > Notification settings gives the
        //      follower his OWN three switches + the reminder hour, read from his row by profile_id (the served row has
        //      shift reminders off and 20:00 - the light run; the dark run reads what the light toggle saved), and ONE
        //      toggle sends ONE POST ?on_conflict=profile_id whose body names his profile_id and no person_id
        {
          const R2 = `R2 follower prefs (${theme})`;
          if (!(await pf.$("[data-testid=notif-follower-prefs]"))) { const t = await pf.$("text=Notification settings"); if (t) { await t.click(); await pf.waitForTimeout(250); } }
          try {
            await pf.waitForSelector("[data-testid=notif-follower-prefs][data-state=ok]", { timeout: 8000 });
            const want = followPrefRow ? { ...followPrefRow } : {};
            const st = await pf.$eval("[data-testid=notif-follower-prefs]", (el) => ({
              intro: ((el.querySelector("p") || {}).textContent || "").trim(),
              sw: Array.from(el.querySelectorAll("[data-testid=notif-pref]")).map(l => { const i = l.querySelector("input[type=checkbox]"); return { key: l.getAttribute("data-key"), checked: !!(i && i.checked), disabled: !i || i.disabled }; }),
              hour: (el.querySelector("[data-testid=notif-follower-hour]") || {}).value,
              hourDisabled: !!(el.querySelector("[data-testid=notif-follower-hour]") || {}).disabled,
              banners: ["notif-follower-unavailable", "notif-follower-load-failed"].filter(t => el.querySelector("[data-testid=" + t + "]")),
            }));
            const nBody = await pf.evaluate(() => document.body.innerText || "");
            const wantIntro = `You follow Dr. ${NAMES_F3.s2} and Dr. ${NAMES_F3.s5}.`;
            const keys = ["schedule_updates_email", "trade_updates_email", "shift_reminders_email"];
            const wantChecked = keys.map(k => want[k] !== false);
            if (!st.intro.startsWith(wantIntro)) fail(`${R2}: the editor should start '${wantIntro}', got '${st.intro.slice(0, 120)}'`);
            else if (st.sw.map(x => x.key).join() !== keys.join() || st.sw.some(x => x.disabled) || st.hourDisabled) fail(`${R2}: expected three enabled switches ${keys.join(", ")} and an enabled hour, got ${JSON.stringify(st.sw)} hourDisabled=${st.hourDisabled}`);
            else if (JSON.stringify(st.sw.map(x => x.checked)) !== JSON.stringify(wantChecked) || st.hour !== (typeof want.reminder_hour_central === "number" ? String(want.reminder_hour_central) : "")) fail(`${R2}: the switches must show his served row ${JSON.stringify(wantChecked)} hour ${want.reminder_hour_central}, got ${JSON.stringify(st.sw.map(x => x.checked))} hour '${st.hour}'`);
            else if (st.banners.length || /Available once your account is linked/.test(nBody) || /ask the scheduler/.test(nBody) || (await pf.$("[data-testid=notif-follower-note]"))) fail(`${R2}: banners ${st.banners.join(",") || "none"}; the unlinked sentence / F3's 'ask the scheduler' note must be gone`);
            else ok(`${R2}: three switches (${st.sw.map(x => x.key.replace("_email", "") + "=" + (x.checked ? "on" : "off")).join(", ")}) + hour ${st.hour || "default"}, read from his row by profile_id; no unlinked sentence, no 'ask the scheduler'`);
            // one toggle -> one POST ?on_conflict=profile_id
            const box = pf.locator("[data-testid=notif-follower-prefs] [data-testid=notif-pref][data-key=trade_updates_email] input[type=checkbox]");
            const was = await box.isChecked();
            const w0 = writes.length;
            await box.click();
            await pf.waitForTimeout(1100);
            const posts = writes.slice(w0).filter((w) => w.path.startsWith("/rest/v1/notification_preferences"));
            let row = null; try { const b = JSON.parse(posts.length ? posts[0].body : "null"); row = Array.isArray(b) ? b[0] : b; } catch (e) {}
            if (posts.length !== 1) fail(`${R2} toggle: expected exactly one write to notification_preferences, got ${posts.length}: ` + posts.map((w) => `${w.method} ${w.path}`).join(", "));
            else if (posts[0].method !== "POST" || posts[0].path !== "/rest/v1/notification_preferences?on_conflict=profile_id") fail(`${R2} toggle: expected POST /rest/v1/notification_preferences?on_conflict=profile_id, got ${posts[0].method} ${posts[0].path}`);
            else if (!/resolution=merge-duplicates/.test(posts[0].prefer)) fail(`${R2} toggle: Prefer must carry resolution=merge-duplicates, got '${posts[0].prefer}'`);
            else if (!row || row.profile_id !== FOLLOW_UID || "person_id" in row || "id" in row || row.trade_updates_email !== !was) fail(`${R2} toggle: the body must name his profile_id, no person_id / id, trade_updates_email ${!was}: ` + String(posts[0].body).slice(0, 220));
            else if ((await box.isChecked()) === was) fail(`${R2} toggle: the switch did not move`);
            else { followerPrefToggles++; ok(`${R2} toggle: one POST ${posts[0].path} (Prefer ${posts[0].prefer}) with profile_id = the follower's own id, no person_id; trade_updates_email -> ${!was}`); }
            await pf.locator("[data-testid=notif-follower-prefs]").scrollIntoViewIfNeeded().catch(() => {});
            await pf.screenshot({ path: path.join(OUT, `follower-prefs-390-${theme}.png`), fullPage: true });
            ok(`screenshot test/ui/out/follower-prefs-390-${theme}.png`);
          } catch (e) { fail(`${R2}: ` + errLine(e)); }
        }
        // (d) Alerts
        const badge = await pf.$eval('button[aria-label="Notifications"]', el => (el.querySelector("span") || { textContent: "" }).textContent.trim());
        await pf.click('button[aria-label="Notifications"]');
        await pf.waitForSelector("[data-testid=notif-panel]", { timeout: 5000 });
        const nRows = await pf.$$eval("[data-testid=notif-row]", els => els.map(e => e.getAttribute("data-type")));
        const wantTypes = "trade_proposed,shift_claimed,shift_reminder,open_shifts,schedule_published";
        if (badge !== "5") fail(`F3 follower (${theme}): the Alerts badge should read 5 (the rows s2 / s5 read), got '${badge}'`);
        else if (nRows.join(",") !== wantTypes) fail(`F3 follower (${theme}): the Alerts panel should list ${wantTypes}, got [${nRows.join(",")}]`);
        else ok(`F3 follower (${theme}): Alerts badge 5; panel = ${wantTypes} (s3's vacation and the s4 / s6 trade filtered out)`);
        // (d2) P20 R1 (review): ff-7 is a pending give from s3 TO s2 (followed), backed by the served trade row - the
        //      follower reads it as its stored text, with no Accept / Decline (only the give's receiver answers it)
        {
          const giveCtl = await pf.$$eval("[data-testid=notif-panel] [data-testid=notif-give-accept], [data-testid=notif-panel] [data-testid=notif-give-decline], [data-testid=notif-panel] [data-testid=notif-give-line]", els => els.map(e => e.getAttribute("data-testid")));
          const ff7 = await pf.$$eval("[data-testid=notif-row][data-type=trade_proposed]", els => els.map(e => (e.innerText || "").trim()));
          if (!followTradeGets) fail(`F3 follower give alert (${theme}): the page never read shift_trade_requests - the give row behind ff-7 was not loaded, so this check proves nothing`);
          else if (giveCtl.length) fail(`F3 follower give alert (${theme}): a follower is offered the give's receiver controls for a surgeon he follows - ${giveCtl.join(", ")}`);
          else if (ff7.length !== 1 || !ff7[0].includes("s3 offers s2 a day - nothing in return")) fail(`F3 follower give alert (${theme}): the give alert should read its stored text, got ${JSON.stringify(ff7).slice(0, 200)}`);
          else ok(`F3 follower give alert (${theme}): the pending give s3 -> s2 (followed; its trade row served on ${followTradeGets} GET(s)) reads its stored text - no notif-give-accept / notif-give-decline / notif-give-line`);
        }
        await pf.click('button[aria-label="Close notifications"]');
        await pf.waitForTimeout(200);
        // (f) Prompt 20 F4: NO edit control anywhere. Every tab the follower's nav offers is visited and swept for the
        //     surgeon / scheduler controls (trade card and its buttons, the vacation form, the offer painter, Take this
        //     shift, the scheduler's board / Generate / Setup / data tools, Undo); Time off has no date input; the
        //     calendar's day editor opened on a day s2 holds (derived from the served rows' cells) reads Close - no
        //     Save, no 'Propose a trade', no enabled select / input / textarea. Following lists s2's upcoming days.
        {
          const F4 = `F4 follower no-edit (${theme})`;
          const EDIT_IDS = ["trade-card", "trade-submit", "trade-accept", "trade-decline", "trade-cancel", "mine-trade", "vac-add", "vac-note",
            "paint-offers", "nav-paint-offers", "ofp-sheet", "ofp-save", "ob-take", "ob-assign", "ob-external", "ob-email", "claim-sheet", "claim-confirm",
            "editor-save", "editor-trade", "undo-btn", "generate-panel", "gen-run", "gen-accept", "roster-save", "rules-save", "group-save", "holidays-save",
            "users-card", "seed-card", "import-file", "reset-all-data", "export-backup", "snapshot-restore", "avail-add", "east-override-save", "east-refresh",
            "prd-new", "notif-give-accept", "notif-give-decline", "trade-kind-give", "trade-kind-trade"];
          // P20 R2: "notif-pref" left this list - a follower's OWN prefs switches (Settings > Notification settings, his row
          // by profile_id) are his; (c2) checks them and (e) counts their writes. Everything above stays forbidden, and so does
          // any notif-pref OUTSIDE [data-testid=notif-follower-prefs] (a surgeon's switches rendered for him - R2 review 9/25).
          const navTabs = await pf.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
          const hitsByTab = [];
          let timeoffDates = -1;
          for (const k of navTabs) {
            await pf.click(`button[data-tab="${k}"]`);
            await pf.waitForTimeout(350);
            const hits = await pf.evaluate((ids) => {
              const h = ids.filter(t => document.querySelector("[data-testid=" + t + "]"));
              const foreign = Array.from(document.querySelectorAll("[data-testid=notif-pref]")).filter(el => !el.closest("[data-testid=notif-follower-prefs]")).length;
              if (foreign) h.push("notif-pref x" + foreign + " outside notif-follower-prefs");
              return h;
            }, EDIT_IDS);
            if (hits.length) hitsByTab.push(`${k}: ${hits.join(", ")}`);
            if (k === "timeoff") timeoffDates = await pf.locator("[data-testid=timeoff-card] input[type=date]").count();
          }
          if (!navTabs.includes("calendar") || !navTabs.includes("timeoff") || !navTabs.includes("myschedule")) fail(`${F4}: expected the Calendar, Time off and Following tabs in the nav, got ${navTabs.join(",")}`);
          else if (hitsByTab.length) fail(`${F4}: edit controls rendered for a follower - ${hitsByTab.join(" | ")}`);
          else if (timeoffDates !== 0) fail(`${F4}: Time off shows ${timeoffDates} date input(s) - a vacation form for a follower`);
          else ok(`${F4}: tabs ${navTabs.join(", ")} swept - no trade card, no vacation form, no painter, no Take / Assign / board e-mail, no Generate / Setup / data tools, no Undo, no notif-pref outside his own notif-follower-prefs`);
          // the day editor on a day s2 holds (the visible month's cells carry data-primary / data-backup from the rows)
          await pf.click('button[data-tab="calendar"]');
          await pf.waitForSelector("[data-testid=cal-grid] .cal-cell[data-day]", { timeout: 8000 });
          const cellDays = await pf.$$eval("[data-testid=cal-grid] .cal-cell[data-day]", els => els.map(e => ({ day: e.getAttribute("data-day"), p: e.getAttribute("data-primary"), b: e.getAttribute("data-backup") })));
          const todayCal = await pf.evaluate(() => (typeof todayCentral === "function" ? todayCentral() : ""));
          const s2Cells = cellDays.filter(c => c.p === "s2" || c.b === "s2");
          const s2Cell = s2Cells.find(c => todayCal && c.day >= todayCal) || s2Cells[0] || null;   // an upcoming s2 day when the month has one
          const pick = s2Cell || cellDays[Math.floor(cellDays.length / 2)];
          await pf.click(`[data-testid=cal-grid] .cal-cell[data-day="${pick.day}"]`);
          await pf.waitForSelector("[data-testid=day-editor] [role=dialog]", { timeout: 5000 });
          const ed = await pf.$eval("[data-testid=day-editor] [role=dialog]", (d) => ({
            save: !!d.querySelector("[data-testid=editor-save]"),
            trade: !!d.querySelector("[data-testid=editor-trade]"),
            enabled: Array.from(d.querySelectorAll("select, textarea, input:not([type=hidden])")).filter(x => !x.disabled && !x.readOnly).length,
            buttons: Array.from(d.querySelectorAll("button")).map(b => (b.textContent || "").trim()).filter(Boolean),
          }));
          if (ed.save || ed.trade || ed.enabled) fail(`${F4}: the day editor on ${pick.day} offers an edit - save=${ed.save} trade=${ed.trade} enabled fields=${ed.enabled} (buttons ${JSON.stringify(ed.buttons)})`);
          else if (!ed.buttons.includes("Close") || ed.buttons.includes("Cancel") || ed.buttons.includes("Save")) fail(`${F4}: the day editor footer should read Close only (no Cancel / Save), got ${JSON.stringify(ed.buttons)}`);
          else ok(`${F4}: the day editor on ${pick.day}${s2Cell ? " (s2 " + (s2Cell.p === "s2" ? "primary" : "backup") + ")" : " (no s2 day in the visible month - a mid-month day)"} is read-only - buttons ${ed.buttons.join(" / ")}; no Save, no 'Propose a trade', no enabled field`);
          await pf.click("[data-testid=day-editor] [role=dialog] button[aria-label=Close]");
          await pf.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 5000 });
          // Following lists s2's upcoming days (the list itself is checked against the served rows in (b))
          await pf.click('button[data-tab="myschedule"]');
          await pf.waitForSelector("[data-testid=following-card][data-surgeon=s2]", { timeout: 8000 });
          const s2Days = await pf.$$eval("[data-testid=following-card][data-surgeon=s2] [data-testid=mine-day]", els => els.map(r => r.getAttribute("data-day")));
          const today2 = await pf.evaluate(() => (typeof todayCentral === "function" ? todayCentral() : null));
          const servedS2 = (servedDays || []).filter(r => r && today2 && r.day >= today2 && r.day <= addDaysIso(today2, 90) && (r.primary_id === "s2" || r.backup_id === "s2")).length;
          if (servedS2 > 0 && !s2Days.length) fail(`${F4}: the served rows give s2 ${servedS2} upcoming day(s) but the Following card lists none`);
          else if (s2Days.some(d => !today2 || d < today2)) fail(`${F4}: the s2 card lists a past day: ${s2Days.filter(d => d < today2).join(",")}`);
          else ok(`${F4}: Following lists s2's ${s2Days.length} upcoming day(s) (${s2Days.slice(0, 3).join(", ")}${s2Days.length > 3 ? ", ..." : ""}), none before ${today2}`);
        }
        // (e) 390 px hygiene + the review shot (on Following)
        await pf.click('button[data-tab="myschedule"]');
        await pf.waitForSelector("[data-testid=following-card]", { timeout: 8000 });
        const scrollW = await pf.evaluate(() => document.documentElement.scrollWidth);
        if (scrollW > 390) fail(`F3 follower (${theme}): horizontal page scroll at 390 px (scrollWidth ${scrollW})`); else ok(`F3 follower (${theme}): no horizontal page scroll at 390 px`);
        await pf.screenshot({ path: path.join(OUT, `follower-390-${theme}.png`), fullPage: true });
        ok(`screenshot test/ui/out/follower-390-${theme}.png`);
        // (g) P20 R2: BEFORE revision o (notification_preferences has no profile_id column - the read answers 400 42703):
        //     the card says "Follower settings are available after the next update", the three switches and the hour are
        //     disabled, a click on a switch writes nothing, no horizontal scroll. Then the column is served again.
        {
          const R2P = `R2 follower prefs before revision o (${theme})`;
          followPrefsColumn = "absent";
          try {
            const w0 = writes.length;
            await loadWithRetry(pf, BASE, "h1:has-text('Silvis Call Schedule')", 30000, "follower page, prefs column absent (" + theme + ")");
            await pf.waitForSelector("text=Synced", { timeout: 30000 });
            await pf.click('button[data-tab="settings"]');
            if (!(await pf.$("[data-testid=notif-follower-prefs]"))) { const t = await pf.$("text=Notification settings"); if (t) { await t.click(); await pf.waitForTimeout(250); } }
            await pf.waitForSelector("[data-testid=notif-follower-prefs][data-state=unavailable]", { timeout: 8000 });
            const st = await pf.$eval("[data-testid=notif-follower-prefs]", (el) => ({
              msg: ((el.querySelector("[data-testid=notif-follower-unavailable]") || {}).textContent || "").trim(),
              failed: !!el.querySelector("[data-testid=notif-follower-load-failed]"),
              sw: Array.from(el.querySelectorAll("[data-testid=notif-pref] input[type=checkbox]")).map(i => i.disabled),
              hourDisabled: !!(el.querySelector("[data-testid=notif-follower-hour]") || {}).disabled,
            }));
            await pf.$$eval("[data-testid=notif-follower-prefs] [data-testid=notif-pref] input[type=checkbox]", els => els.forEach(i => i.click()));
            await pf.waitForTimeout(900);
            const pw = writes.slice(w0).filter(w => w.path.startsWith("/rest/v1/notification_preferences"));
            const scrollW = await pf.evaluate(() => document.documentElement.scrollWidth);
            if (st.msg !== "Follower settings are available after the next update.") fail(`${R2P}: expected 'Follower settings are available after the next update.', got '${st.msg}'`);
            else if (st.failed) fail(`${R2P}: the missing column is not a failed read - it must say 'after the next update', not 'couldn't load'`);
            else if (st.sw.length !== 3 || st.sw.some(d => !d) || !st.hourDisabled) fail(`${R2P}: the three switches and the hour must render disabled, got ${JSON.stringify(st.sw)} hourDisabled=${st.hourDisabled}`);
            else if (pw.length) fail(`${R2P}: wrote ${pw.map(w => w.method + " " + w.path).join(", ")}`);
            else if (scrollW > 390) fail(`${R2P}: horizontal page scroll at 390 px (scrollWidth ${scrollW})`);
            else ok(`${R2P}: '${st.msg}' with the three switches and the hour disabled; clicks on them wrote nothing; no horizontal scroll`);
            await pf.locator("[data-testid=notif-follower-prefs]").scrollIntoViewIfNeeded().catch(() => {});
            await pf.screenshot({ path: path.join(OUT, `follower-prefs-premigration-390-${theme}.png`), fullPage: true });
            ok(`screenshot test/ui/out/follower-prefs-premigration-390-${theme}.png`);
          } catch (e) { fail(`${R2P}: ` + errLine(e)); }
          followPrefsColumn = "present";
        }
      }
      // (e2) P20 R2: the follower's only writes are the heartbeat and his OWN prefs row - one POST ?on_conflict=profile_id
      //      per toggle (c2) made, nothing else
      const prefPosts = writes.slice(writesBefore).filter(w => w.method === "POST" && w.path === "/rest/v1/notification_preferences?on_conflict=profile_id");
      if (prefPosts.length !== followerPrefToggles || followerPrefToggles !== 2) fail(`F3 follower: expected one prefs POST per toggle (2 toggles, one per theme), got ${prefPosts.length} POST(s) for ${followerPrefToggles} toggle(s)`);
      else ok(`F3 follower: ${prefPosts.length} prefs POST(s) ?on_conflict=profile_id, one per toggle`);
      const fw = writes.slice(writesBefore).filter(w => !/^\/rest\/v1\/client_versions/.test(w.path) && !prefPosts.includes(w));
      if (fw.length) fail(`F3 follower: the follower session wrote ${fw.length} time(s) besides the version heartbeat and his own prefs row: ${fw.map(w => w.method + " " + w.path).join(", ")}`);
      else ok("F3 follower: no write besides the client_versions heartbeat and his own prefs row (the schedule stays read-only)");
    } catch (e) { fail("follower session: " + errLine(e)); try { await pf.screenshot({ path: path.join(OUT, "failure-follower.png"), fullPage: true }); } catch (e2) {} }
    await pf.close();
  }
} catch (e) {
  fail("harness exception: " + (e && e.stack || e));
  try { await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }); } catch (e2) {}
}

// Console / page error triage.
if (pageErrors.length) fail("pageerrors: " + pageErrors.join(" | ")); else ok("no pageerror during the run");
const unexpected = consoleErrors.filter(t => !EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
const expected = consoleErrors.filter(t => EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
if (expected.length) console.log(`     (${expected.length} expected console error(s) ignored: ${[...new Set(expected)].slice(0, 3).join(" | ")})`);
if (forcedConsoleErrors.length) console.log(`     (${forcedConsoleErrors.length} console error(s) came from responses the harness forced - the snapshot insert 500, the aborted east_feed POST, the offer painter's OF002 400, the session scenario's 401s / rejected refresh - expected)`);
if (unexpected.length) fail("unexpected console errors:\n     " + [...new Set(unexpected)].join("\n     ")); else ok("no unexpected console errors");
// Prompt 16 B9 (a): the worker fallback is quiet by design (console.warn + genWorkerBroken) - the whole-run sweep is
// where a device that silently dropped to the inline run would show.
const genWorkerWarns = consoleWarns.filter(t => /Generate worker failed/.test(t));
if (genWorkerWarns.length) fail("'Generate worker failed' during the run (every later Generate on that page ran inline): " + [...new Set(genWorkerWarns)].map(t => t.slice(0, 200)).join(" | ")); else ok("no 'Generate worker failed' warning during the run (the worker path held on every Generate)");

// Prompt 16 B8 - supply chain + CSP: no request left for a CDN host; React, ReactDOM and supabase-js were fetched
// from vendor/ with ?v=APP_VERSION; the served page carries the CSP meta with the three inline-script hashes and
// no 'unsafe-inline' in script-src; the app document recorded no CSP violation.
if (cdnRequests.length) fail(`${cdnRequests.length} request(s) went to a CDN host (the libraries are vendored):\n     ` + [...new Set(cdnRequests)].join("\n     ")); else ok("no request to unpkg / jsdelivr during the run");
{
  const want = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "vendor/supabase.js"].map(f => `${BASE}${f}?v=${APP_VERSION}`);
  const seen = new Set(vendorRequests.map(s => s.replace(/^[^:]+: /, "")));
  const missing = want.filter(u => !seen.has(u));
  if (missing.length) fail("vendored libraries not fetched with ?v=APP_VERSION: " + missing.join(", ") + " (seen: " + [...seen].join(", ") + ")");
  else ok(`vendored libraries fetched from vendor/ with ?v=${APP_VERSION} (React, ReactDOM, supabase-js)`);
  const csp = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return { content: m ? m.getAttribute("content") : null, violations: Array.isArray(window.__cspViolations) ? window.__cspViolations.slice() : null, react: typeof React !== "undefined" ? React.version : null, sdk: !!(window._supabaseSDK && typeof window._supabaseSDK.createClient === "function"), wrapperIsRest: typeof window.supabase === "object" && typeof window.supabase.from === "function" && typeof window.supabase.createClient !== "function" };
  }).catch(e => ({ error: String(e && e.message || e) }));
  if (csp.error) fail("CSP meta check could not run on the app page: " + csp.error);
  else {
    const scriptSrc = ((csp.content || "").split(";").map(s => s.trim()).find(s => /^script-src\s/.test(s)) || "").split(/\s+/).slice(1);
    const hashes = scriptSrc.filter(s => /^'sha256-/.test(s));
    if (!csp.content) fail("the served page has no Content-Security-Policy meta");
    else if (scriptSrc.includes("'unsafe-inline'") || scriptSrc.includes("'unsafe-eval'") || /__CSP_SCRIPT_HASHES__/.test(csp.content)) fail("served script-src is not a pure hash list: " + scriptSrc.join(" "));
    else if (hashes.length !== 4) fail("served script-src should carry 4 hashes (3 inline scripts + the printable toolbar), found " + hashes.length);
    else ok(`served CSP: script-src 'self' + ${hashes.length} sha256 hashes, no 'unsafe-inline'`);
    if (csp.violations === null) fail("the app page has no window.__cspViolations (init script did not run)");
    else if (csp.violations.length) fail("CSP violations recorded on the app page:\n     " + [...new Set(csp.violations)].join("\n     "));
    else ok("no CSP violation recorded on the app page (securitypolicyviolation listener)");
    if (csp.react !== "18.3.1") fail("React.version on the page is " + csp.react + ", expected the vendored 18.3.1"); else ok("React 18.3.1 on the page (vendored build)");
    if (!csp.sdk || !csp.wrapperIsRest) fail(`supabase-js capture: _supabaseSDK.createClient=${csp.sdk}, window.supabase is the REST wrapper=${csp.wrapperIsRest}`); else ok("supabase-js UMD captured into window._supabaseSDK; window.supabase is config.js's REST wrapper");
  }
}

console.log(`\ncdn cache: ${cdnHits} hit(s), ${cdnMisses} miss(es) (${path.relative(ROOT, CDN_CACHE)})`);
console.log(`writes intercepted (${writes.length}):`);
writes.forEach(w => console.log(`  ${w.method} ${w.path}${w.public ? " [public]" : ""}`));
if (failures.length || failedRequests.length) {
  console.log(`\nfailed network requests (${failedRequests.length}):`);
  failedRequests.forEach(r => console.log("  " + r));
}
await browser.close();
server.close();
console.log(failures.length ? `\nSMOKE FAILED: ${failures.length} problem(s)` : "\nSMOKE OK");
process.exit(failures.length ? 1 : 0);
