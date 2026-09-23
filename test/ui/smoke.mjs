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
//     OPEN cells (10/15 is P OPEN), the week of 9/28 shows the Atwell external
//     cover in the grid and as '9/28-10/4 Atwell' in the ER-panel author's week row, the day
//     editor for 2026-10-15 lists greyed (ineligible) options with their first
//     hard reason (Sarkar - outside-window), eligible options come first, Esc
//     closes it; November 2026 shows E (East-derived) and F (forecast) badges;
//     a 390px viewport keeps the grid readable (codes instead of names, no
//     horizontal scroll, NO clipped pill / truncated OPEN / overflowing P-B
//     line - vis-001); the year field accepts typed input key by key
//     (vis-002); dark mode keeps week-row names, vacation dots and the title
//     at 3:1+ contrast measured on computed colours (vis-003). Screenshots:
//     calendar-oct-2026.png, calendar-nov-2026.png, week-rows-oct-2026.png,
//     day-editor-2026-10-15.png, calendar-mobile.png, calendar-oct-dark.png
//   - Prompt 9 exports, from the Calendar tools card: the group and per-surgeon
//     .ics downloads (VTIMEZONE, TZID lines, stable UIDs, summary naming), the
//     shareable read-only page (downloaded, re-opened through the static
//     server, 10/15 OPEN red, week rows present, screenshot share-page.png),
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
//     (the one open primary, pending the group's 10/15 decision) and the
//     'respect locks OFF over 10/5-10/11' preview. SM2 review: the row-less day
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
//     fills; 390 px in BOTH themes with the same probe (no page scroll, table
//     scrolls in its wrapper with the swipe hint, buttons >= 36 px; dark adds
//     the navy body and table text >= 3:1). Screenshots openshifts.png,
//     openshifts-sheet.png, openshifts-email-preview.png, openshifts-390.png,
//     openshifts-dark.png, openshifts-390-dark.png (part 6 copies the set to
//     docs/screenshots/open-shifts/ for review without Playwright). Fix round:
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
import { contrastTable, formatTable, loadTheme, hexToRgb, contrastRatio } from "./contrast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const CDN_CACHE = path.join(OUT, "cdn-cache");

// Playwright lives outside the repo (it is not a devDependency: CI's npm
// install must stay small and the deploy job never runs a browser). Search
// order: explicit env, the repo's own node_modules (npm i -D --no-save
// playwright), then the documented tooling dir.
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_DIR,
  path.join(ROOT, "node_modules"),
  "<playwright-dir>",
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
let failSnapshotInsert = false; // Slice E harness switch (see the Supabase route)
let forcedOffer400 = false;     // Prompt 14 part 3a: the browser's own "400" line for the save_offers refusal the harness forced (OF002) - consumed once
let abortEastFeedPost = false;  // fix round 2 (safe-1 / wire-2): the east_feed upsert POST is aborted at the network level
let delayScheduleWriteMs = 0;   // RF2 b: hold every schedule_days POST / PATCH open for N ms so a CAS sync run is provably in flight
let blobReadOverride = null;    // fix round 2 (safe-4): { updated_at, updated_by } stamped onto every call_schedule_data GET row
let blobWriteTs = null;         // rebase follow-up 9/23 (review, major): updated_at of the app's LAST call_schedule_data write, served on every later blob GET (what the real column reads) so the 60 s poll's refreshBlobRow short-circuits instead of re-adopting the harness-untouched blob over a Setup edit
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

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
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
let cdnHits = 0, cdnMisses = 0;
const cacheKey = (url) => path.join(CDN_CACHE, crypto.createHash("sha1").update(url).digest("hex"));
const routeCdn = async (route) => {
  const req = route.request();
  const url = req.url();
  const host = new URL(url).hostname;
  if (FONT_HOSTS.includes(host)) return route.fulfill({ status: 200, contentType: "text/css", body: "/* fonts stubbed by test/ui/smoke.mjs */" });
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
await context.route(cdnMatcher, routeCdn);
// Davenport (East) project: answered from the canned week + roster blob above (GET only, like the app).
await context.route((url) => url.hostname === EAST_HOST, async (route) => {
  const url = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  if (route.request().method() !== "GET") return route.fulfill({ status: 405, contentType: "application/json", body: "[]" });
  if (url.pathname.startsWith("/rest/v1/schedule_weeks")) return json([EAST_WEEK]);
  if (url.pathname.startsWith("/rest/v1/call_schedule_data")) return json([{ id: "main", data: EAST_BLOB }]);
  // Prompt 15: the Davenport time_off read (kind vacation, FAK = s6 there) answers the same three ranges the
  // harness overlays on the cache, so a Refresh keeps every review (nothing changed, nothing removed).
  if (url.pathname.startsWith("/rest/v1/time_off")) return json(eastVacFeed.map((r, i) => ({ id: "dav-timeoff-" + (i + 1), person_id: "s6", kind: "vacation", start_date: r.start, end_date: r.end })));
  return json([]);
});
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const consoleWarns = [];
const writes = [];
const tradeStore = []; // Slice G: shift_trade_requests rows the app wrote this run (see the Supabase route)
const tradeGets = [];  // datalayer-001: every GET on shift_trade_requests with the Authorization it carried
const forcedConsoleErrors = []; // the browser's own "500" line for the snapshot insert the harness forced to fail
const watchPage = (pg, tag) => {
  pg.on("pageerror", (e) => pageErrors.push(`${tag}: ` + String(e && e.message || e)));
  pg.on("console", (msg) => {
    if (msg.type() === "error") {
      if (failSnapshotInsert && /status of 500/.test(msg.text())) forcedConsoleErrors.push(msg.text());
      else if (forcedOffer400 && /status of 400/.test(msg.text())) { forcedConsoleErrors.push(msg.text()); forcedOffer400 = false; } // the forced OF002 answer of rpc/save_offers (offer painter)
      else if (abortEastFeedPost && /ERR_FAILED|Failed to fetch|Failed to load resource/.test(msg.text())) forcedConsoleErrors.push(msg.text()); // the east_feed POST the harness aborted
      else consoleErrors.push(msg.text());
    }
    if (msg.type() === "warning") consoleWarns.push(msg.text());
  });
  pg.on("requestfailed", (r) => { if (abortEastFeedPost && /\/rest\/v1\/east_feed/.test(r.url())) return; failedRequests.push(`${tag}: ${r.method()} ${r.url()} -> ${(r.failure() || {}).errorText || "failed"}`); });
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
// Prompt 14 part 3a (the offer painter): call_offers / call_periods are authenticated-only tables, so the anon
// passthrough would answer [] - the harness serves them: ONE period (the seed's first offerPeriods entry with a
// fake uuid; s1 is on its rulesOnly list, exactly as the seed says) and an offer store seeded with one OTHER
// surgeon's row (so "1 other offered" can be seen). rpc/save_offers and rpc/set_offer_mode are answered like the
// SQL functions would (validation tokens included); every call is recorded in writes. failSaveOffers makes the
// next save_offers answer a 400 with the OF002 vacation token (the "nothing was saved" path).
const offerPeriod = (() => {
  const p = (JSON.parse(fs.readFileSync(SEED_PATH, "utf8")).offerPeriods || [])[0];
  return p ? { id: "00000000-0000-4000-8000-00000000a0f1", label: p.label, start_day: p.start, end_day: p.end, offers_close_at: p.offersCloseAt, publish_by: p.publishBy, status: p.status || "upcoming", rules_only_ids: (p.rulesOnly || []).slice(), offer_modes: { ...(p.offerModes || {}) }, created_by: "harness", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" } : null;
})();
const periodStore = offerPeriod ? [offerPeriod] : []; // Prompt 14 part 3b (U3b): GET call_periods serves this list; the Periods section's POST / PATCH move it (route below)
const OTHER_OFFER_DAY = "2026-10-14";
const offerStore = [{ id: crypto.randomUUID(), person_id: "s2", day: OTHER_OFFER_DAY, role_pref: "either", note: null, entered_by: "s2", source: "app", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z" }];
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
const offerRpc = (b, json) => {
  const err = (code, message) => json(400, { message, code, details: null, hint: null });
  const who = String(b.p_person || "s1");
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
  const by = who === "s1" ? "s1" : "scheduler", src = who === "s1" ? "app" : "email-relay";
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
const routeSupabase = async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  if (url.pathname.startsWith("/auth/v1/user") && method === "GET") {
    return json(200, { id: FAKE_UID, email: FAKE_EMAIL, aud: "authenticated", role: "authenticated" });
  }
  if (url.pathname.startsWith("/rest/v1/user_profiles")) {
    if (method === "GET") return json(200, [FAKE_PROFILE]);
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    // A PATCH with Prefer: return=representation answers the merged row, like
    // PostgREST does for a row the caller may update (Slice E Users card).
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
    if (method === "GET") return json(200, periodStore.slice().sort((a, b) => a.start_day < b.start_day ? -1 : 1));
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
  if (method === "GET" && url.pathname.startsWith("/rest/v1/call_offers")) return json(200, offerStore.slice().sort((a, b) => a.day < b.day ? -1 : 1));
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
    return url.pathname.endsWith("save_offers") ? offerRpc(b, json) : offerModeRpc(b, json);
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
      try { const b = JSON.parse(body || "{}"); const r = Array.isArray(b) ? b[0] : b; if (r && typeof r.updated_at === "string") blobWriteTs = r.updated_at; } catch (e) {}
    }
    writes.push({ method, path: url.pathname + url.search, body: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? "(snapshot body omitted)" : body, prefer: req.headers()["prefer"] || "", snapshotReason: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? (() => { try { return JSON.parse(body).reason; } catch (e) { return null; } })() : undefined });
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
  if (daysWiped && method === "GET" && url.pathname === "/rest/v1/schedule_days") {
    let rows = Object.values(dayStore).sort((a, b) => a.day < b.day ? -1 : 1);
    const dayQ = (url.searchParams.get("day") || "").replace(/^eq\./, "");
    if (dayQ) rows = rows.filter(r => r.day === dayQ);
    const off = Number(url.searchParams.get("offset") || 0), lim = Number(url.searchParams.get("limit") || rows.length);
    return json(200, rows.slice(off, off + lim));
  }
  // Forced minimum version (refresh-banner scenario): row 'main' of client_versions.
  if (minVersionOverride && method === "GET" && url.pathname.startsWith("/rest/v1/client_versions") && /id=eq\.main/.test(url.search)) return json(200, [{ id: "main", ...minVersionOverride }]);
  // Harness switch (fix round 2, safe-4): stamp a foreign updated_at / updated_by
  // onto the blob row so the import's dry run and its pre-apply re-read see a
  // setup that "changed since the dry run".
  // ... and (rebase follow-up 9/23) the app's own last write stamp rides on every blob GET after a write; the
  // deliberate foreign stamp above still wins when it is armed.
  if ((blobReadOverride || blobWriteTs) && method === "GET" && url.pathname.startsWith("/rest/v1/call_schedule_data")) {
    let rows = fixtureAnswer(url);
    if (!rows) {
      const res = await route.fetch({ headers: { ...req.headers(), authorization: "Bearer " + ANON_KEY } });
      rows = await res.json().catch(() => []);
    }
    const stampRow = (r) => (r && typeof r === "object") ? { ...r, ...(blobWriteTs ? { updated_at: blobWriteTs } : {}), ...(blobReadOverride || {}) } : r;
    return json(200, Array.isArray(rows) ? rows.map(stampRow) : stampRow(rows));
  }
  // Prompt 13 part 3: a claimed day reads back with the claimer, version + 1 (what the function's UPDATE leaves).
  // ... and the harness-opened slot (LIVE mode, P13R-2) reads back blank with its live source and version.
  if ((Object.keys(claimedDays).length || harnessOpen.day) && method === "GET" && url.pathname === "/rest/v1/schedule_days") {
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
    return json(200, (Array.isArray(rows) ? rows : []).map(overlay));
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
  // Since the 9/23 publish the live table has next to no open slot, and what is open (10/15 primary, a Thursday) is
  // never Khan's. The harness then OPENS one backup slot in what it serves: a Mon/Wed 'generated' row after the
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
  if (octCells.length !== 35 || octCells[0].day !== "2026-09-28" || octCells[34].day !== "2026-11-01") fail(`October 2026 grid is not 5 Mon-Sun rows 9/28..11/1: ${octCells.length} cells, ${octCells[0] && octCells[0].day}..${octCells[34] && octCells[34].day}`);
  else ok("October 2026 grid: 35 Mon..Sun cells from 9/28 to 11/1 (weekend unit Fri-Sun in one row)");
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
  if (!/10\/9-10\/11 Acton/.test(row1005)) fail("week row 10/5 lacks '10/9-10/11 Acton': " + row1005); else ok("week row 10/5: same-surgeon run collapsed to '10/9-10/11 Acton'");
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
  else console.log(`     (no open slot on/after today ${todayIso} in the October 2026 week rows - the 'OPEN entries are red' pin is not exercised; the share-page / printable pins cover the colour while 10/15 is open)`);
  await page.locator("[data-testid=week-rows]").screenshot({ path: path.join(OUT, "week-rows-oct-2026.png") });
  ok("screenshot test/ui/out/week-rows-oct-2026.png");

  // ---- Item Q (Faraz 9/22): an unassigned slot is OPEN only from today (Central) forward ----
  // September 2026 (9/1-9/13 have no rows; the import has open backups before
  // 9/22): no week-row entry dated before today may read "M/D OPEN" and no grid
  // cell before today may carry the red OPEN pill or a data-open flag. October
  // 10/15 must still be OPEN in both places while today <= 2026-10-15. A past
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
  await showMonth(2026, 9);
  if (todayCentral <= "2026-10-15") {
    const oct15Rows = await page.$$eval('[data-testid=week-rows] tr[data-week="2026-10-12"] [data-kind="open"]', els => els.map(e => e.textContent.trim()));
    const oct15Cell = await page.$eval('[data-testid=cal-grid] [data-day="2026-10-15"]', el => ({ open: el.getAttribute("data-open"), pill: !!el.querySelector(".cal-pill.cal-open"), text: el.textContent }));
    if (!oct15Rows.includes("10/15 OPEN")) fail("October 2026 week rows: '10/15 OPEN' (today or later) is missing: " + JSON.stringify(oct15Rows));
    else if (!/P/.test(oct15Cell.open || "") || !oct15Cell.pill || !/OPEN/.test(oct15Cell.text)) fail("October 2026 grid: 10/15 should still be P OPEN with the red pill: " + JSON.stringify(oct15Cell));
    else ok(`today-forward: 10/15 still reads '10/15 OPEN' in the week rows and P OPEN (data-open=${oct15Cell.open}, red pill) in the grid (today ${todayCentral})`);
  } else console.log(`     (today ${todayCentral} is after 2026-10-15 - the '10/15 still OPEN' half of the today-forward check is skipped)`);

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
    else if (!g.text.startsWith("BEGIN:VCALENDAR\r\n") || !g.text.includes("BEGIN:VTIMEZONE") || !/DTSTART;TZID=America\/Chicago:\d{8}T070000\r\n/.test(g.text) || !/SUMMARY:Silvis Primary Call - \w+\r\n/.test(g.text) || !/UID:silvis-\d{4}-\d{2}-\d{2}-primary@silvis-call/.test(g.text)) fail("group ics content wrong: " + g.text.slice(0, 400).replace(/\r\n/g, " | "));
    else ok(`group ics: ${g.name} (${n} events, VTIMEZONE + TZID lines, 'Silvis Primary Call - <Name>', stable UIDs)`);
  } catch (e) { fail("group ics download: " + errLine(e)); }
  // (b) per-surgeon .ics from the tools card (Khan)
  try {
    const k = await saveDownload(() => page.click("[data-testid=ics-FAK]"));
    const n = (k.text.match(/BEGIN:VEVENT/g) || []).length;
    if (k.name !== "silvis-call-khan.ics") fail("per-surgeon ics filename: " + k.name);
    else if (/SUMMARY:Silvis (Primary|Backup) Call - /.test(k.text) || (n > 0 && !/SUMMARY:Silvis (Primary|Backup) Call\r\n/.test(k.text))) fail("per-surgeon ics summaries wrong: " + (k.text.match(/SUMMARY:[^\r]*/g) || []).slice(0, 3).join(" | "));
    else ok(`per-surgeon ics: ${k.name} (${n} events, summaries without a name suffix)`);
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
    if (mine.name !== "silvis-call-khan.ics" || !mine.text.includes("BEGIN:VTIMEZONE") || (n > 0 && !/UID:silvis-\d{4}-\d{2}-\d{2}-(primary|backup)@silvis-call/.test(mine.text))) fail("My schedule ics wrong: " + mine.name + " " + mine.text.slice(0, 200).replace(/\r\n/g, " | ")); else ok(`My schedule: ${mine.name} (${n} events, stable UIDs, VTIMEZONE)`);
    await page.screenshot({ path: path.join(OUT, "myschedule-export.png"), fullPage: false });
  } catch (e) { fail("My schedule ics: " + errLine(e)); }
  await showMonth(2026, 9);

  // ---- Slice D: the day editor for 2026-10-15 ----
  await page.click('[data-day="2026-10-15"]');
  await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
  const edTitle = await page.$eval("[data-testid=editor-title]", el => el.textContent);
  if (!/Thu October 15, 2026/.test(edTitle)) fail("day editor title wrong: " + edTitle); else ok("day editor opened: " + edTitle);
  const pOpts = await page.$$eval("[data-testid=editor-primary] option", els => els.map(o => ({ value: o.value, text: o.textContent.trim(), eligible: o.getAttribute("data-eligible") })));
  const greyed = pOpts.filter(o => o.eligible === "false");
  if (!greyed.length || !greyed.every(o => / - [a-z-]+/.test(o.text))) fail("day editor 10/15: no greyed primary option with a reason: " + JSON.stringify(pOpts)); else ok(`day editor 10/15: ${greyed.length} greyed primary option(s) with a reason, e.g. "${greyed[0].text}"`);
  const sarkar = greyed.find(o => /^Sarkar - /.test(o.text));
  if (!sarkar) fail("day editor 10/15: Sarkar is not greyed in the Primary dropdown: " + JSON.stringify(pOpts.filter(o => /Sarkar/.test(o.text))));
  else if (!/window/.test(sarkar.text)) fail("day editor 10/15: Sarkar is greyed but not with her window reason: " + sarkar.text);
  else ok(`day editor 10/15: "${sarkar.text}" (window/hard reason)`);
  const lastEligible = pOpts.map(o => o.eligible).lastIndexOf("true"), firstIneligible = pOpts.map(o => o.eligible).indexOf("false");
  if (firstIneligible >= 0 && lastEligible > firstIneligible) fail("day editor: options are not eligible-first: " + pOpts.map(o => o.eligible[0] + ":" + o.text).join(" | ")); else ok("day editor: eligible options listed first");
  const reasonsText = await page.$eval("[data-testid=editor-primary-reasons]", el => el.textContent).catch(() => "");
  if (!/Sarkar - outside the availability window/.test(reasonsText)) fail("day editor: plain-English reason line missing for Sarkar: " + reasonsText); else ok("day editor: reason line maps the code to words (Sarkar - outside the availability window)");
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

  // ---- November 2026: E (East-derived) and F (forecast) badges ----
  await showMonth(2026, 10);
  const novCells = await readCells();
  const eDays = novCells.filter(c => c.badges.includes("E")).map(c => c.day);
  const fDays = novCells.filter(c => c.badges.some(b => b === "F" || b === "f")).map(c => c.day);
  if (!eDays.length) fail("November 2026: no E badge (Fierce's East-derived week from the east_feed cache expected)"); else ok(`November 2026: E badge on ${eDays.length} day(s): ${eDays[0]}..${eDays[eDays.length - 1]}`);
  if (!fDays.length) fail("November 2026: no F forecast badge (east_forecast rows from 11/16 expected)"); else ok(`November 2026: F badge on ${fDays.length} day(s), first ${fDays[0]}`);
  await page.screenshot({ path: path.join(OUT, "calendar-nov-2026.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-nov-2026.png");

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
  // (d) the trade form's selects fit the phone width
  await page.click('button[data-tab="timeoff"]');
  await page.waitForSelector("[data-testid=trade-card]", { timeout: 8000 });
  const picks = await page.$$eval("[data-testid=trade-mine-pick], [data-testid=trade-to], [data-testid=trade-theirs-pick]", els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.getAttribute("data-testid"), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; }));
  const pickBad = picks.filter(p => p.right > 390 || p.left < 0 || p.w < 200);
  if (picks.length !== 3 || pickBad.length) fail("mobile 390px: trade selects off screen or narrower than 200px: " + JSON.stringify(picks)); else ok("mobile 390px: the three trade selects span the row and stay on screen (" + picks.map(p => p.w + "px").join(", ") + ")");
  await page.click('button[data-tab="calendar"]');
  await page.setViewportSize({ width: 1180, height: 900 });

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
  // filled), 390 px in light and dark (no page scroll, table scrolls in its
  // wrapper with the swipe hint), screenshots openshifts*.png.
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
    // Take this shift as s1 on the first row where s1 is eligible.
    const target = all.rows.find(r => r.take === "enabled");
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
    // Email the group now (scheduler): a confirm dialog PREVIEWS the composed e-mail (Prompt 13 part 5b: subject 'N open shifts through M/D',
    // the slots grouped by Monday week, the #openshifts deep link) and writes NOTHING until Send -> feed row open_shifts (data.slots = the
    // whole range, title = the subject) + broadcast send-notification { subject, message, detail } + audit openshifts.notify; 'last announced' fills.
    const beforeMail = writes.length;
    const cur0 = await readBoard();
    await clearToast();
    await page.click("[data-testid=ob-email]");
    if (cur0.rows.length) {
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
      else ok(`Open shifts: Email the group now previews the e-mail before sending - subject "${pv.subject}", ${weekHeads} week group(s), ${previewLines} slot line(s), detail "${pv.detail}" - and writes nothing until Send`);
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
    }
    await waitFor(() => writes.slice(beforeMail).some(w => /send-notification/.test(w.path)), 8000);
    // the audit row is written after the e-mail outcome is known (the toast states it) - wait for it rather than for time
    await waitFor(() => writes.slice(beforeMail).some(w => w.path.startsWith("/rest/v1/audit_log") && /openshifts\.notify/.test(w.body || "")), 8000);
    await page.waitForTimeout(400);
    const feed = writes.slice(beforeMail).filter(w => w.path.startsWith("/rest/v1/notifications")).map(parseBody).find(n => n && n.type === "open_shifts");
    const mail2 = writes.slice(beforeMail).filter(w => /send-notification/.test(w.path)).map(parseBody).find(b => b && b.type === "open_shifts");
    const audit2 = writes.slice(beforeMail).filter(w => w.path.startsWith("/rest/v1/audit_log")).map(parseBody).find(b => b && b.action === "openshifts.notify");
    const cur = await readBoard();
    if (!cur0.rows.length) console.log("     (no open slot left - Email the group now has nothing to announce)");
    else if (!feed || !feed.data || !Array.isArray(feed.data.slots) || feed.data.slots.length !== cur0.rows.length || !feed.data.slots.every(s => s && s.day && (s.role === "primary" || s.role === "backup"))) fail("Open shifts: Email the group now wrote no open_shifts feed row with data.slots for every open slot: " + JSON.stringify(feed && feed.data));
    else if (String(feed.message).split("\n").filter(l => / - open/.test(l)).length !== cur0.rows.length) fail("Open shifts: the open_shifts feed message does not list one openSlotsLine per slot: " + String(feed.message).slice(0, 200));
    else if (!mail2 || mail2.targetIds !== undefined || !mail2.data || !/ - open/.test(String(mail2.data.message))) fail("Open shifts: Email the group now must POST send-notification type open_shifts as a broadcast (no targetIds; the server gates per category) with the list in data.message: " + JSON.stringify(mail2));
    else if (!/^\d+ open shifts? through \d{1,2}\/\d{1,2}$/.test(String(mail2.data.subject)) || feed.title !== mail2.data.subject || !/#openshifts$/.test(String(mail2.data.detail)) || !/Week of Mon/.test(String(mail2.data.message)) || mail2.data.message !== feed.message) fail("Open shifts: the e-mail must carry subject 'N open shifts through M/D' (= the feed row's title), the week-grouped message (= the feed message) and the #openshifts detail: " + JSON.stringify(mail2.data).slice(0, 300));
    else if (!audit2 || audit2.detail.count !== cur0.rows.length) fail("Open shifts: no audit 'openshifts.notify' with the count: " + JSON.stringify(audit2));
    else if (cur.rows.some(r => r.announced === "never")) fail(`Open shifts: 'last announced' still reads 'never' on ${cur.rows.filter(r => r.announced === "never").length} row(s) after the notice`);
    else ok(`Open shifts: Email the group now -> feed open_shifts (${feed.data.slots.length} slots) + send-notification open_shifts (broadcast) + audit openshifts.notify; 'last announced' now "${cur.rows[0].announced}"`);
    if (!writes.slice(beforeMail).every(w => noAddr(w.body))) fail("Open shifts: a notice write body carries an email address");
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
    else ok(`Open shifts 390px (light): no horizontal page scroll (${m1.pageW}), the table scrolls inside its wrapper (${m1.wrapScroll} in ${m1.wrapClient}) with the swipe hint, buttons >= 36px`);
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
    if (darkText.cells && darkText.worst < 3) fail(`Open shifts dark: a table cell's text is below 3:1 contrast (${darkText.worst})`); else ok(`Open shifts dark: table text contrast >= 3:1 (worst ${darkText.worst} over ${darkText.cells} cells)`);
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
    else ok(`Open shifts 390px (dark): no horizontal page scroll (${m2.pageW}), body ${m2.bodyBg}, the table scrolls inside its wrapper (${m2.wrapScroll} in ${m2.wrapClient}) with the swipe hint painted in the dark card colour, buttons >= 36px`);
    await clearToast();
    await page.screenshot({ path: path.join(OUT, "openshifts-390-dark.png"), fullPage: true });
    // The 'ok screenshots' line is earned: the sheet and preview shots sit inside conditionals, so check that every one of the six exists, is from THIS run and is under 300 KB (docs/screenshots/open-shifts/ is copied from these files).
    // (the sheet shot exists only when the claim flow ran - LIVE mode without a claimable slot skips it and says so)
    const SIX = ["openshifts.png", "openshifts-sheet.png", "openshifts-email-preview.png", "openshifts-390.png", "openshifts-dark.png", "openshifts-390-dark.png"].filter(f => f !== "openshifts-sheet.png" || claimExercised);
    if (!claimExercised) console.log("     (openshifts-sheet.png not required: the claim flow did not run)");
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
    const blobWrite = writes.slice(beforeWrites).find(w => w.path.startsWith("/rest/v1/call_schedule_data"));
    if (!blobWrite) fail("scheduler autosave leg 2 (config blob) did not run"); else {
      const b = JSON.parse(blobWrite.body || "{}");
      const d = b.data || {};
      if ("schedule" in d || "vacations" in d || "availability" in d) fail("blob write carries operational keys: " + Object.keys(d).join(","));
      else ok("blob autosave carries config keys only: " + Object.keys(d).join(", "));
    }
  }
  await page.screenshot({ path: path.join(OUT, "calendar-after-edit.png"), fullPage: true });

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
    //     no schedule_days write (the days leg finds no diff). NOTE: the blob
    //     leg still upserts on ANY state change - that is the autosave contract
    //     (leg 2 writes the whole blob whenever the effect fires), not a
    //     realtime fault, so only schedule_days writes are counted here.
    const beforeEcho = writes.length;
    rtSendDayRow(dayRow(day, { primary_id: "s2", backup_id: "s3", version: 2, updated_by: "s1" }));
    await page.waitForTimeout(1500);
    const echoDayWrites = writes.slice(beforeEcho).filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    if (echoDayWrites.length) fail("realtime: a clean echo triggered a schedule_days write: " + JSON.stringify(echoDayWrites.map(w => w.method + " " + w.path)));
    else ok("realtime: the clean echo (v2) produced no schedule_days write");

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
        const flushBlob = sinceBusy(beforeFlush2).filter(w => w.method === "POST" && /call_schedule_data\?on_conflict=id/.test(w.path));
        const skipWarn = consoleWarns.slice(warnsBefore).find(t => /schedule_days leg skipped/.test(t));
        if (!started) fail(`RF2 keepalive-busy: the ${fourth} edit produced no schedule_days write within 4 s`);
        else if (!heldWrites.every(w => w.delayedMs)) fail("RF2 keepalive-busy: the harness did not hold the first write open: " + JSON.stringify(heldWrites.map(w => w.method + " " + w.path)));
        else if (flushDays.length) fail(`RF2 keepalive-busy: the flush sent ${flushDays.length} schedule_days write(s) while a sync run was in flight: ` + JSON.stringify(flushDays.map(w => w.method + " " + w.path)));
        else if (!skipWarn) fail("RF2 keepalive-busy: no console.warn saying the schedule_days leg was skipped (warns since: " + JSON.stringify(consoleWarns.slice(warnsBefore).slice(0, 4)) + ")");
        else if (!flushBlob.length) fail("RF2 keepalive-busy: the blob leg did not run (no keepalive call_schedule_data POST after the flush)");
        else ok(`RF2 keepalive-busy: flush while the ${fourth} CAS write is held open -> zero schedule_days writes, blob leg sent, warn "${skipWarn.slice(0, 100)}"`);
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
      const failWrites = writesSince(beforeFail);
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
      const otherWrites = writesSince(before).filter(w => !/rpc\/(save_offers|set_offer_mode)$|\/rest\/v1\/audit_log/.test(w.path));
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
      await page.click("[data-testid=vac-conflict-trade]");
      await page.waitForTimeout(300);
      const preDay = await page.$eval("[data-testid=trade-day]", el => el.value).catch(() => "");
      if (preDay !== vacFirst.day) fail(`Time off refusal: 'propose a trade' did not preselect the first conflict item ${vacFirst.day} (${vacFirst.role}, derived from the grid for the range ${vacDay}) in the trade form (got '${preDay}')`); else ok(`Time off refusal: 'propose a trade' preselects ${vacFirst.day} (${vacFirst.role} - the first conflict item for the range ${vacDay}) in the trade form`);
      await page.fill("[data-testid=trade-day]", "");
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
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
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
    const pcPosts = () => writesSince(beforePc, "/rest/v1/call_schedule_data").filter(w => w.method === "POST");
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
      await openCard("setup_vacations");
      const before = writes.length;
      const form = page.locator("[data-testid=card-setup_vacations]");
      await form.locator("select").first().selectOption("s3");
      const dateInputs = form.locator("input[type=date]");
      await dateInputs.nth(0).fill("2026-10-10");
      await dateInputs.nth(1).fill("2026-10-10");
      await form.locator("button:has-text('Add vacation')").click();
      await page.waitForSelector("[data-testid=vac-conflict]", { timeout: 5000 });
      const conflictText = await page.$eval("[data-testid=vac-conflict]", el => el.innerText.replace(/\s+/g, " "));
      const toPosts = writesSince(before, "/rest/v1/time_off");
      if (toPosts.length) fail("Vacation conflict: a time_off write was sent although the client pre-check refused: " + JSON.stringify(toPosts.map(w => w.method + " " + w.path)));
      else if (!/Acton is published on/.test(conflictText) || !/10\/10 primary - go to day/.test(conflictText)) fail("Vacation conflict panel wrong: " + conflictText);
      else ok("Vacation pre-check: Acton 10/10 refused with the conflicting date and a 'go to day' link, no time_off write");
      // Two conflicts are expected: 10/9 (trailing edge - Acton is PRIMARY the day before) and 10/10 itself.
      const conflictDays = await page.$$eval("[data-testid=vac-conflict-day]", els => els.map(e => e.textContent.trim()));
      if (conflictDays.length !== 2 || !conflictDays[0].startsWith("10/9 primary") || !conflictDays[1].startsWith("10/10 primary")) fail("Vacation conflict: expected the trailing-edge 10/9 primary and 10/10 primary links: " + JSON.stringify(conflictDays)); else ok("Vacation conflict: lists the trailing-edge day too (10/9 primary, 10/10 primary)");
      await page.click("[data-testid=vac-conflict-day]:has-text('10/10')");
      await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
      const edT = await page.$eval("[data-testid=editor-title]", el => el.textContent);
      if (!/October 10, 2026/.test(edT)) fail("'go to day' did not open the day editor on 10/10: " + edT); else ok("'go to day' opens the calendar day editor on Sat October 10, 2026");
      await page.keyboard.press("Escape");
      await page.click('button[data-tab="setup"]');
      await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 });
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
      const homeWrites = writesSince(before3).filter(w => !/\/rest\/v1\/audit_log/.test(w.path));
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
    await page.click("[data-testid=gen-run]");
    await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 90000 });
    await page.waitForTimeout(1200);
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
      const impWrites = writesSince(before).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
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
      const planInserts = planDays.filter(d => !liveByDay[d]);
      const planUpdates = planDays.filter(d => liveByDay[d] && !sameRow(liveByDay[d], planByDay[d]) && seedOwned(liveByDay[d]));
      const planBlocked = planDays.filter(d => liveByDay[d] && !sameRow(liveByDay[d], planByDay[d]) && !seedOwned(liveByDay[d]));
      const planUnchanged = planDays.filter(d => liveByDay[d] && sameRow(liveByDay[d], planByDay[d]));
      // The importer lists a blocked day as one line per changed slot ('P a -> b', 'B a -> b'; one 'locks/note
      // change' line when the holders agree), and the panel's '(+N blocked)' counts those LINES; the diff's
      // schedule_days summary line counts the DAYS. Both are restated.
      const blockedLinesOf = (d) => { const l = liveByDay[d], r = planByDay[d]; const p = (l.primary_id || null) !== (r.primary_id || null) || (l.external_cover || null) !== (r.external_cover || null); const b = (l.backup_id || null) !== (r.backup_id || null); return Math.max(1, (p ? 1 : 0) + (b ? 1 : 0)); };
      const planBlockedLines = planBlocked.reduce((n, d) => n + blockedLinesOf(d), 0);
      const blockedSuffix = planBlockedLines ? ` (+${planBlockedLines} blocked: app-edited days kept)` : "";
      const expDryTotal = "Total changes: 0" + blockedSuffix;
      const expDryTail = planBlockedLines ? `Total changes: 0 (+${planBlockedLines} blocked)` : "No changes - the live tables already match the plan.";
      const expSdLine = `schedule_days: insert ${planInserts.length}, update ${planUpdates.length}, delete 0, unchanged ${planUnchanged.length}${planBlocked.length ? ", BLOCKED " + planBlocked.length : ""}`;
      const dryLines = diffText.trim().split("\n").map(l => l.trim());
      const dryTail = dryLines.slice(-1)[0];
      const drySdLine = dryLines.find(l => l.startsWith("schedule_days: ")) || "(no schedule_days line)";
      console.log(`     (Import dry run, restated from the plan's ${planDays.length} days vs the ${liveRows.length} ${fixture ? "fixture" : "live"} rows: ${planInserts.length} missing, ${planUpdates.length} seed-owned day(s) differing (would update), ${planUnchanged.length} unchanged, ${planBlocked.length} day(s) differing that the app edited / published since the import = ${planBlockedLines} blocked slot line(s) (never overwritten${planBlocked.length ? ": " + planBlocked.slice(0, 5).join(", ") + (planBlocked.length > 5 ? ", ... " + planBlocked.slice(-1)[0] : "") : ""}))`);
      if (planInserts.length || planUpdates.length) fail(`Import dry run premise: the live rows do not hold the seed - ${planInserts.length} plan day(s) missing, ${planUpdates.length} seed-owned day(s) differing (${[...planInserts, ...planUpdates].slice(0, 6).join(", ")}) - the orchestrator's pending seed apply, not a harness expectation`);
      if (total.trim() !== expDryTotal || dryTail !== expDryTail || drySdLine !== expSdLine) fail(`Import dry run: expected '${expDryTotal}', the diff text ending '${expDryTail}' and its schedule_days line '${expSdLine}' (${planBlocked.length} blocked day(s) = ${planBlockedLines} blocked line(s), restated from the live rows), got '${total.trim()}' | '${dryTail}' | '${drySdLine}'`);
      else if (!applyDisabled) fail("Import dry run: Apply must be disabled when there is nothing to apply");
      else if (impWrites.length) fail("Import dry run wrote something: " + JSON.stringify(impWrites.map(w => w.method + " " + w.path)));
      else ok(`Import seed dry run (docs/silvis-seed.json): 0 changes against the live rows${planBlocked.length ? ` (+${planBlockedLines} blocked slot lines on ${planBlocked.length} plan days the app published since the import, kept as they are; ${planUnchanged.length} unchanged)` : ""}, Apply disabled, no writes`);
      diffText.split("\n").filter(l => /^(call_schedule_data|schedule_days|availability|time_off)/.test(l)).forEach(l => console.log("     " + l));
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
        // RF2 review fix: a seed change under a core key moves settings too (the seedCoreHash stamp follows the seed-owned content), so the extra date reads surgeonRules=update + settings=update + 1 availability insert = 3 changes
        if (total3.trim() !== "Total changes: 3" + blockedSuffix || !/settings=update/.test(diff3) || !new RegExp("insert s2 available/any " + extra).test(diff3) || !/surgeonRules=update/.test(diff3)) fail(`Import apply dry run (extra ${extra}): expected 'Total changes: 3${blockedSuffix}' (blob surgeonRules + 1 availability insert${planBlocked.length ? ", the same " + planBlockedLines + " blocked lines" : ""}): ${total3.trim()} | ${diff3.split("\n").filter(l => /insert|surgeonRules/.test(l)).join(" | ")}`);
        else ok(`Import apply dry run: extra Burchett date ${extra} -> 3 changes (surgeonRules=update, settings=update - the seedCoreHash stamp, insert s2 available/any ${extra})${planBlocked.length ? ", " + planBlockedLines + " blocked" : ""}`);
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
        if (expAvIns.length !== 1 || expAvIns[0].start_date !== extra || expToIns.length) fail(`Import apply premise: the live availability / time_off tables do not hold the seed - ${expAvIns.length} availability row(s) missing (${expAvIns.map(r => r.person_id + " " + r.start_date).join(", ")}; expected only the extra ${extra}), ${expToIns.length} time_off row(s) missing - the orchestrator's pending seed apply`);
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
        else if (aAv < 0 || aAv < aSnap || avBody.length !== 1 || avBody[0].start_date !== extra || avBody[0].person_id !== "s2" || avBody[0].source !== "seed") fail(`Import apply: availability insert wrong (index ${aAv}, snap ${aSnap}): ` + JSON.stringify(avBody));
        else if (aBad.length) fail("Import apply: schedule_days / time_off were written although the restatement expects no change there: " + JSON.stringify(aBad.map(w => w.method + " " + w.path)));
        else if (!/Import applied/.test(resText) || !/blob merged/.test(resText) || !resText.includes(expResult)) fail(`Import apply: result panel wrong (expected 'Import applied - blob merged; ${expResult}' - ${expAvIns.length} availability insert of ${plan3.availabilityRows.length} plan rows, ${expToIns.length} time_off insert of ${plan3.timeOffRows.length}, ${expKept} plan day(s) kept = ${keptNotOwned.length} not seed-owned live + ${keptDirty.length} still carrying this run's edits): ` + resText);
        else if (!impAudit) fail("Import apply: no audit_log 'seed.import'");
        else ok(`Import apply: snapshot 'seed_import' (#${aSnap}) -> blob PATCH ?id=eq.main (#${aBlob}, merged over the live blob) -> availability POST (#${aAv}) with exactly the 1 missing row (${extra}); ${(expInserted + expUpdated) ? "" : "no schedule_days write, "}${expToIns.length ? "" : "no time_off write; "}audit seed.import; result equals the restatement: "${resText.slice(resText.indexOf("availability inserted"), resText.indexOf("availability inserted") + expResult.length)}"`);
        // Roster autosave after the merge must not regress: the extra date stays in the next blob write.
        await page.waitForTimeout(1200);
        const laterBlob = writesSince(beforeApply, "/rest/v1/call_schedule_data").filter(w => w.method === "POST").map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).filter(Boolean).slice(-1)[0];
        if (laterBlob && !(laterBlob.data && laterBlob.data.surgeonRules && laterBlob.data.surgeonRules.s2.explicitAvailable["2026-12"].includes(extra))) fail("Import apply: the autosave after the merge dropped the merged blob keys (adoptBlob did not take)"); else ok("Import apply: the autosave that follows carries the merged blob (adoptBlob took)");
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
    const btn = Array.from(document.querySelectorAll("button")).find(b => /^(Sign in|Create account)$/.test(b.textContent.trim()));
    const link = Array.from(document.querySelectorAll("button")).find(b => /Don't have an account|Already have an account/.test(b.textContent.trim()));
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
      if (p.linkColor !== wantLink) fail(`sign-in ${theme}: the sign-up link is not the orange text token (${wantLink}): ${p.linkColor}`); else ok(`sign-in ${theme}: sign-up link = orange text ${p.linkColor}`);
      const wantBody = theme === "dark" ? "rgb(11, 26, 51)" : "rgb(246, 248, 251)";
      if (p.bodyBg !== wantBody) fail(`sign-in ${theme}: page background is ${p.bodyBg}, expected ${wantBody}`); else ok(`sign-in ${theme}: page background ${p.bodyBg}`);
      if (p.title.trim() !== "Silvis Call Schedule") fail(`sign-in ${theme}: card title is '${p.title}'`);
      await signin.screenshot({ path: path.join(OUT, `signin-${theme}.png`), fullPage: true });
      ok(`screenshot test/ui/out/signin-${theme}.png`);
    } catch (e) { fail(`sign-in ${theme}: ` + errLine(e)); try { await signin.screenshot({ path: path.join(OUT, `failure-signin-${theme}.png`), fullPage: true }); } catch (e2) {} }
  }
  await signin.close();
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
} catch (e) {
  fail("harness exception: " + (e && e.stack || e));
  try { await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }); } catch (e2) {}
}

// Console / page error triage.
if (pageErrors.length) fail("pageerrors: " + pageErrors.join(" | ")); else ok("no pageerror during the run");
const unexpected = consoleErrors.filter(t => !EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
const expected = consoleErrors.filter(t => EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
if (expected.length) console.log(`     (${expected.length} expected console error(s) ignored: ${[...new Set(expected)].slice(0, 3).join(" | ")})`);
if (forcedConsoleErrors.length) console.log(`     (${forcedConsoleErrors.length} console error(s) came from responses the harness forced - the snapshot insert 500, the aborted east_feed POST, the offer painter's OF002 400 - expected)`);
if (unexpected.length) fail("unexpected console errors:\n     " + [...new Set(unexpected)].join("\n     ")); else ok("no unexpected console errors");

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
