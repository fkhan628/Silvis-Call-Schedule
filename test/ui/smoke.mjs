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
//   - fix round 2 (Slice E findings): the Generate presets start after the LAST
//     PUBLISHED day (end of the contiguous block, 2026-11-01 -> 'Through end of
//     year' = 2026-11-02 to 2027-01-03, wire-1); Accept with 'respect locks'
//     OFF confirms BEFORE any write and a dismissed confirm writes nothing
//     (safe-2); the publish dialog closes with 'Skip the notice' and says the
//     changes are already saved (safe-2); an east_feed upsert aborted at the
//     network level warns + toasts with the status unchanged, then a real
//     Refresh's upsert payload is asserted against a mocked Davenport host
//     (safe-1 / wire-2; switch abortEastFeedPost, EAST_HOST route); the import
//     dry run warns when the live blob was app-saved and Apply refuses with
//     zero writes when updated_at moved since the dry run (safe-4; switch
//     blobReadOverride)
//   - screenshots each tab to test/ui/out/<tab>.png
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
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const CDN_CACHE = path.join(OUT, "cdn-cache");

// Playwright lives outside the repo (it is not a devDependency: CI's npm
// install must stay small and the deploy job never runs a browser). Search
// order: explicit env, the repo's own node_modules (npm i -D --no-save
// playwright), the documented tooling dir, then the session scratchpad.
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_DIR,
  path.join(ROOT, "node_modules"),
  "<playwright-dir>",
  "<your home folder>/AppData/Local/Temp/claude/<session-folder>/<session-id>/scratchpad/tooling/node_modules",
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
let abortEastFeedPost = false;  // fix round 2 (safe-1 / wire-2): the east_feed upsert POST is aborted at the network level
let blobReadOverride = null;    // fix round 2 (safe-4): { updated_at, updated_by } stamped onto every call_schedule_data GET row
// Davenport (East) project mock - fetchEastWeeks reads schedule_weeks + the
// roster blob from this host with its public key; the harness answers both so
// a Refresh never leaves the machine and the upsert payload is deterministic.
const EAST_HOST = "xqongyahdnkozqunpwmu.supabase.co";
const EAST_WEEK = { week_monday: "2026-10-05", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" }, off: [], isBackup: false, dayCallOverrides: {} } };
const EAST_BLOB = { surgeons: [{ id: "s6", name: "FAK" }, { id: "s1", name: "AAA" }] };
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const FAKE_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FAKE_UID, role: "authenticated", email: FAKE_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;

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
// The SDK joins "realtime:silvis-schedule-sync" with 7 postgres_changes
// bindings (order = the .on() order in index-source.html). The join reply
// must echo them back with ids; a later postgres_changes frame carrying one
// of those ids reaches the app's handler (onDayChange for schedule_days).
const RT_TABLES = ["call_schedule_data", "schedule_days", "time_off", "availability", "shift_trade_requests", "notifications", "client_versions"];
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
const rtSendDayRow = (record, type) => {
  if (!rt.joined) return false;
  const id = RT_TABLES.indexOf("schedule_days") + 1;
  rtSend({
    topic: rt.topic, event: "postgres_changes", ref: null, join_ref: rt.joinRef,
    payload: { ids: [id], data: { type: type || "UPDATE", schema: "public", table: "schedule_days", commit_timestamp: new Date().toISOString(), columns: [], record, old_record: {}, errors: null } },
  });
  return true;
};
const dayRow = (day, over) => ({ day, primary_id: null, backup_id: null, primary_locked: false, backup_locked: false, source: "manual", external_cover: null, note: null, version: 1, updated_by: "s4", updated_at: new Date().toISOString(), ...over });

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
  const IMP = require(path.join(ROOT, "importer.js"));
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
  const ts = "2026-09-22T00:00:00.000Z";
  const plan = IMP.importPlan(seed, { now: ts });
  return {
    schedule_days: plan.scheduleDayRows.map(r => ({ ...r, version: 1, updated_at: ts })),
    call_schedule_data: [{ id: "main", data: plan.blob, updated_by: "seed", updated_at: ts }],
    time_off: plan.timeOffRows.map((r, i) => ({ id: "fixture-timeoff-" + (i + 1), ...r, created_at: ts })),
    availability: plan.availabilityRows.map((r, i) => ({ id: "fixture-avail-" + (i + 1), ...r, created_at: ts })),
  };
})();
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
    localStorage.setItem("silvis_app_version", version); // no version-mismatch reload loop
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
  return json([]);
});
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const consoleWarns = [];
const writes = [];
const forcedConsoleErrors = []; // the browser's own "500" line for the snapshot insert the harness forced to fail
const watchPage = (pg, tag) => {
  pg.on("pageerror", (e) => pageErrors.push(`${tag}: ` + String(e && e.message || e)));
  pg.on("console", (msg) => {
    if (msg.type() === "error") {
      if (failSnapshotInsert && /status of 500/.test(msg.text())) forcedConsoleErrors.push(msg.text());
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
  const echoes = url.pathname.startsWith("/rest/v1/schedule_days") || (method === "PATCH" && url.pathname.startsWith("/rest/v1/call_schedule_data"));
  if (!echoes) return [];
  try {
    const b = JSON.parse(body || "{}");
    return Array.isArray(b) ? b : [b];
  } catch (e) { return []; }
};
await page.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
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
    writes.push({ method, path: url.pathname + url.search, body: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? "(snapshot body omitted)" : body, prefer: req.headers()["prefer"] || "", snapshotReason: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? (() => { try { return JSON.parse(body).reason; } catch (e) { return null; } })() : undefined });
    return json(method === "POST" ? 201 : 200, representation(method, url, body));
  }
  // Harness switch (fix round 2, safe-4): stamp a foreign updated_at / updated_by
  // onto the blob row so the import's dry run and its pre-apply re-read see a
  // setup that "changed since the dry run".
  if (blobReadOverride && method === "GET" && url.pathname.startsWith("/rest/v1/call_schedule_data")) {
    let rows = fixtureAnswer(url);
    if (!rows) {
      const res = await route.fetch({ headers: { ...req.headers(), authorization: "Bearer " + ANON_KEY } });
      rows = await res.json().catch(() => []);
    }
    return json(200, (Array.isArray(rows) ? rows : []).map(r => ({ ...r, ...blobReadOverride })));
  }
  const fx = fixtureAnswer(url);
  if (fx) return json(200, fx);
  // Anon READ passthrough: the fake JWT would be rejected by the real project,
  // so swap it for the anon key (what dbReadHeaders does for an expired token).
  const headers = { ...req.headers() };
  headers["authorization"] = "Bearer " + ANON_KEY;
  return route.continue({ headers });
});

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

  // Every nav tab, screenshot each.
  const tabs = await page.$$eval("button[data-tab]", els => els.map(e => e.getAttribute("data-tab")));
  const expectedTabs = ["setup", "calendar", "myschedule", "timeoff", "totals", "settings"];
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
    await page.selectOption(`[data-testid=editor-${role}]`, id);
    const ov = await page.$("[data-testid=override-confirm]");
    if (ov) { console.log(`     (${d} ${role} -> ${id} needed an override: ${(await ov.innerText()).split("\n").slice(0, 2).join(" / ")})`); await page.click("[data-testid=override-accept]"); }
    await page.click("[data-testid=editor-save]");
    await page.waitForSelector("[data-testid=day-editor]", { state: "detached", timeout: 3000 });
  };

  // ---- Slice B: October 2026 grid on the imported data ----
  await showMonth(2026, 9);
  const octCells = await readCells();
  const octInMonth = octCells.filter(c => c.day.startsWith("2026-10"));
  const pCells = octInMonth.filter(c => c.p);
  const openCells = octInMonth.filter(c => /OPEN/.test(c.text));
  if (octCells.length !== 35 || octCells[0].day !== "2026-09-28" || octCells[34].day !== "2026-11-01") fail(`October 2026 grid is not 5 Mon-Sun rows 9/28..11/1: ${octCells.length} cells, ${octCells[0] && octCells[0].day}..${octCells[34] && octCells[34].day}`);
  else ok("October 2026 grid: 35 Mon..Sun cells from 9/28 to 11/1 (weekend unit Fri-Sun in one row)");
  if (!pCells.length) fail("October 2026: no cell carries a primary assignment"); else ok(`October 2026: ${pCells.length} day(s) with 'P <name>', e.g. ${pCells[0].day} P ${pCells[0].p}`);
  if (!openCells.length) fail("October 2026: no cell shows OPEN"); else ok(`October 2026: ${openCells.length} cell(s) show OPEN (e.g. ${openCells[0].day} open=${openCells[0].open})`);
  const oct15 = octCells.find(c => c.day === "2026-10-15");
  if (!oct15 || oct15.p || !/OPEN/.test(oct15.text)) fail("2026-10-15 should render P OPEN (the one open primary of the import): " + JSON.stringify(oct15)); else ok("2026-10-15 renders P OPEN");
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
  if (!/MON\/SUN DATES.*TRAUMA & CARDIOTHORACIC SURGERY TRAUMA.*TRAUMA BACKUP/.test(hdr)) fail("week rows header is not the ER-panel author's: " + hdr); else ok("week rows header: MON/SUN DATES | TRAUMA & CARDIOTHORACIC SURGERY TRAUMA | TRAUMA BACKUP");
  const row928 = await page.$eval('[data-testid=week-rows] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
  if (!/9\/28-10\/4 Atwell/.test(row928) || !/9\/28-10\/4 Fierce/.test(row928)) fail("week row 9/28 lacks '9/28-10/4 Atwell' / '9/28-10/4 Fierce': " + row928); else ok("week row 9/28: '9/28-10/4 Atwell' (primary) and '9/28-10/4 Fierce' (backup) collapsed");
  const row1005 = await page.$eval('[data-testid=week-rows] tr[data-week="2026-10-05"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
  if (!/10\/9-10\/11 Acton/.test(row1005) || !/10\/7 OPEN/.test(row1005)) fail("week row 10/5 lacks '10/9-10/11 Acton' or '10/7 OPEN': " + row1005); else ok("week row 10/5: same-surgeon run collapsed to '10/9-10/11 Acton', open backup shown as '10/7 OPEN'");
  const openRed = await page.$eval('[data-testid=week-rows] [data-kind="open"]', el => getComputedStyle(el).color).catch(() => "");
  if (!/rgb\(192, 64, 64\)/.test(openRed)) fail("week rows: OPEN entry is not red (#c04040): " + openRed); else ok("week rows: OPEN entries are red");
  await page.locator("[data-testid=week-rows]").screenshot({ path: path.join(OUT, "week-rows-oct-2026.png") });
  ok("screenshot test/ui/out/week-rows-oct-2026.png");

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
    const shareOpen = await sharePage.$eval('.cd[data-day="2026-10-15"] .open', el => getComputedStyle(el).color).catch(() => "");
    if (!/rgb\(192, 64, 64\)/.test(shareOpen)) fail("share page: 10/15 P OPEN is not red: " + shareOpen); else ok("share page renders: 10/15 P OPEN in red");
    const shareAtwell = await sharePage.$eval('table.wr[data-month="2026-10"] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/\n/g, " | ")).catch(() => "");
    if (!/9\/28-10\/4 Atwell/.test(shareAtwell)) fail("share page week rows lack '9/28-10/4 Atwell': " + shareAtwell); else ok("share page week rows: '9/28-10/4 Atwell' under the October grid");
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
    const printOpen = await pop.$eval('.cell[data-day="2026-10-15"] .shift .open', el => getComputedStyle(el).color).catch(() => "");
    if (!/rgb\(192, 0, 0\)/.test(printOpen)) fail("printable: 10/15 OPEN not red: " + printOpen); else ok("printable view: 10/15 P OPEN in red");
    const printAtwell = await pop.$eval('.cell[data-day="2026-10-01"] .shift .ext', el => el.textContent).catch(() => "");
    if (!/Atwell/.test(printAtwell)) fail("printable: 10/1 external cover missing: " + printAtwell); else ok("printable view: 10/1 shows '" + printAtwell + "'");
    await pop.screenshot({ path: path.join(OUT, "printable-page.png"), fullPage: true });
    ok("screenshot test/ui/out/printable-page.png");
    await pop.close();
  } catch (e) { fail("printable view: " + errLine(e)); }
  // (e) ER Call Panels: default = visible month; preset 11/2-12/13; copy; download
  try {
    const defHdr = await page.$eval("[data-testid=er-panel-preview] thead", el => el.innerText.replace(/\s+/g, " ").trim());
    if (defHdr !== "MON/SUN DATES TRAUMA & CARDIOTHORACIC SURGERY TRAUMA TRAUMA BACKUP") fail("ER panel header: " + defHdr); else ok("ER panel header: " + defHdr);
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
    const erOpenRed = await page.$eval('[data-testid=er-panel-preview] [data-kind="open"]', el => getComputedStyle(el).color);
    if (!/rgb\(255, 0, 0\)/.test(erOpenRed)) fail("ER panel OPEN not red: " + erOpenRed); else ok("ER panel: OPEN entries red (#ff0000)");
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
    if (!item) fail(`Copy for Word: expected exactly one navigator.clipboard.write call with one ClipboardItem, saw ${JSON.stringify(clipWrites.map(w => w.map(i => Object.keys(i))))}; toast "${toastText}"`);
    else if (!clipHtml.startsWith('<table data-export="er-call-panels"') || (clipHtml.match(/<tr data-week=/g) || []).length !== 6 || !/MON\/SUN DATES<\/th><th [^>]*>TRAUMA &amp; CARDIOTHORACIC SURGERY TRAUMA<\/th><th [^>]*>TRAUMA BACKUP<\/th>/.test(clipHtml) || !/<span data-kind="open" style="color:#ff0000;font-weight:bold">/.test(clipHtml)) fail("Copy for Word: text/html flavour is not the 6-row ER table: " + clipHtml.slice(0, 200));
    else if (!/^MON\/SUN DATES\tTRAUMA & CARDIOTHORACIC SURGERY TRAUMA\tTRAUMA BACKUP\n11\/2 - 11\/8\t/.test(clipText) || clipText.split("\n").length !== 7) fail("Copy for Word: text/plain flavour wrong: " + clipText.slice(0, 120));
    else if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(clipHtml + clipText)) fail("Copy for Word: an email address is on the clipboard");
    else if (!/^Copied - paste into the Word document/.test(toastText)) fail(`Copy for Word: flavours written but the toast reads "${toastText}"`);
    else ok(`Copy for Word: one clipboard write with ${Object.keys(item).join(" + ")} - 6-row ER table (inline styles, red OPEN spans) + tab-separated text; toast "${toastText}"`);
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
  if (!openPills.length) fail("mobile 390px: no OPEN pill found in October 2026 (10/15 is open)"); else if (!openPills.every(p => p.text === "OPEN" && p.fits && p.line)) fail("mobile 390px: OPEN pill truncated: " + JSON.stringify(openPills.filter(p => !(p.fits && p.line)).slice(0, 3))); else ok(`mobile 390px: ${openPills.length} OPEN pill(s) render the full word`);
  const lineOverflow = await page.$$eval("[data-testid=cal-grid] .cal-line", els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => { const cell = e.closest("[data-day]"); return (cell ? cell.getAttribute("data-day") : "?") + ":" + e.textContent + (e.querySelector("svg") ? "+lock" : "") + " " + e.scrollWidth + ">" + e.clientWidth; }));
  if (lineOverflow.length) fail(`mobile 390px: ${lineOverflow.length} P/B line(s) overflow their cell, e.g. ${lineOverflow.slice(0, 5).join(", ")}`); else ok("mobile 390px: no P/B line overflows its cell (padlock included)");
  await page.screenshot({ path: path.join(OUT, "calendar-mobile.png"), fullPage: true });
  ok("screenshot test/ui/out/calendar-mobile.png");
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
  if (!/rgb\(26, 26, 46\)/.test(darkProbe.bodyBg)) fail("dark mode did not switch the body background: " + darkProbe.bodyBg); else ok("dark mode: body background " + darkProbe.bodyBg);
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
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`; // first of the current month (no imported row there)
  {
    const beforeWrites = writes.length;
    await editDay(day, "primary", "s2");
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
    const adopted = await waitFor(async () => (await cellAttr(other, "data-primary")) === "s4", 4000);
    if (adopted) ok(`realtime: foreign row for ${other} (primary s4 v5) adopted into the calendar`);
    else fail(`realtime: foreign row for ${other} was not adopted (cell data-primary = ${await cellAttr(other, "data-primary")})`);
    // (b) THE RACE: set backup on `day` (local {s2,s3}, last persisted {s2}),
    //     then deliver the echo of the earlier primary write ({s2}, v1) inside
    //     the 800ms debounce. Before the fix the echo blanked the backup and
    //     no PATCH followed; now the local edit stays and PATCHes against v1.
    const beforeRace = writes.length;
    await editDay(day, "backup", "s3");
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
    await page.click("[data-testid=publish-skip]");
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
  const openCard = async (ck) => {
    const card = page.locator(`[data-testid=card-${ck}]`);
    if ((await card.count()) === 0) return null;
    if ((await card.getAttribute("data-open")) !== "1") { await page.click(`[data-testid=card-toggle-${ck}]`); await page.waitForTimeout(200); }
    return card;
  };
  const bodyText = () => page.evaluate(() => document.body.innerText || "");
  const writesSince = (n, pathPrefix) => writes.slice(n).filter(w => !pathPrefix || w.path.startsWith(pathPrefix));
  const auditSince = (n, action) => writes.slice(n).map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.action === action);
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
      const before = writes.length;
      const maxInput = page.locator("[data-testid=rules-editor] input[type=number][max='14']").first();
      await maxInput.fill("4");
      await page.click("[data-testid=rules-save]");
      await page.waitForTimeout(1500);
      const ruleAudit = auditSince(before, "rules.edit");
      const blobW = writesSince(before, "/rest/v1/call_schedule_data").map(w => { try { return JSON.parse(w.body); } catch (e) { return null; } }).find(b => b && b.data && b.data.surgeonRules && b.data.surgeonRules.s3);
      if (!ruleAudit) fail("Rules: no audit_log 'rules.edit' after Save");
      else if (!blobW || blobW.data.surgeonRules.s3.maxConsecutiveDays !== 4) fail("Rules: the blob autosave after Save does not carry surgeonRules.s3.maxConsecutiveDays = 4: " + JSON.stringify(blobW && blobW.data.surgeonRules && blobW.data.surgeonRules.s3 && blobW.data.surgeonRules.s3.maxConsecutiveDays));
      else if ("schedule" in blobW.data || "vacations" in blobW.data) fail("Rules: the blob write carries operational keys");
      else ok("Rules: Save -> audit rules.edit + blob autosave with surgeonRules.s3.maxConsecutiveDays 4 (config keys only)");
      await maxInput.fill("3");
      await page.click("[data-testid=rules-save]");
      await page.waitForTimeout(1200);
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
      }
    }

    // ---- Generate: presets start after the LAST PUBLISHED day (end of the contiguous block, 2026-11-01),
    //      not after the pre-assigned Thanksgiving unit (finding wire-1) ----
    await openCard("setup_generate");
    {
      const teoy = await page.getAttribute("[data-testid=gen-preset-through-end-of-year]", "title");
      const three = await page.getAttribute("[data-testid=gen-preset-3-months]", "title");
      const startDefault = await page.$eval("[data-testid=gen-start]", el => el.value);
      const endDefault = await page.$eval("[data-testid=gen-end]", el => el.value);
      const lp = await page.$eval("[data-testid=gen-last-published]", el => el.textContent);
      if (teoy !== "2026-11-02 to 2027-01-03" || three !== "2026-11-02 to 2027-01-31" || startDefault !== "2026-11-02" || endDefault !== "2027-01-03") fail(`Generate presets: expected 'Through end of year' = 2026-11-02 to 2027-01-03 (default range) and '3 months' = ..2027-01-31, got teoy=${teoy} 3m=${three} start=${startDefault} end=${endDefault}`);
      else if (!/Last published day on file: 2026-11-01/.test(lp) || !/Later locked days on file: 11\/26-11\/29 \(Thanksgiving\)/.test(lp)) fail("Generate panel text: expected 'Last published day on file: 2026-11-01' and 'Later locked days on file: 11/26-11/29 (Thanksgiving)': " + lp);
      else ok("Generate presets: 'Through end of year' = 2026-11-02 to 2027-01-03 is the default range (milestone), 3 months ..2027-01-31; panel names the last published day 2026-11-01 and the later locked 11/26-11/29 (Thanksgiving)");
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

    // ---- Generate: preview 2026-11-02 .. 2026-11-30, N=10, seed 7 -> diagnostics, no writes ----
    await page.fill("[data-testid=gen-start]", "2026-11-02");
    await page.fill("[data-testid=gen-end]", "2026-11-30");
    await page.fill("[data-testid=gen-n]", "10");
    await page.fill("[data-testid=gen-seed]", "7");
    const beforeGen = writes.length;
    await page.click("[data-testid=gen-run]");
    await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 90000 });
    await page.waitForTimeout(1200);
    const genForbidden = writesSince(beforeGen).filter(w => /\/rest\/v1\/(schedule_days|call_schedule_snapshots|availability|time_off)/.test(w.path) || (w.method === "PATCH" && w.path.startsWith("/rest/v1/call_schedule_data")));
    if (genForbidden.length) fail("Generate preview wrote something: " + JSON.stringify(genForbidden.map(w => w.method + " " + w.path))); else ok("Generate preview: no schedule_days / snapshot / availability / time_off write (preview is read-only)");
    const meta = await page.$eval("[data-testid=gen-preview-meta]", el => el.textContent);
    if (!/11\/2 - 11\/30 \(29 days\), seed 7, best of 10/.test(meta)) fail("Generate preview meta wrong: " + meta); else ok("Generate preview: " + meta.slice(0, 120));
    const tallyRange = await page.$$eval("[data-testid=gen-tallies] tr[data-tally-range]", els => els.length);
    const tallyRows = await page.$$eval("[data-testid=gen-tallies] tr[data-tally]", els => els.map(e => e.innerText.replace(/\t/g, " | ")));
    if (tallyRange !== 6 || tallyRows.length !== 6) fail(`Generate tallies: expected 6 month rows + 6 range rows, got ${tallyRows.length} + ${tallyRange}`); else ok("Generate tallies: 6 surgeons x (2026-11 + range) rows vs cap/target");
    tallyRows.forEach(r => console.log("     " + r));
    const unc = Number(await page.$eval("[data-testid=gen-diagnostics]", el => el.getAttribute("data-uncovered-count")));
    const uncRows = await page.$$eval("[data-testid=gen-uncovered] tr[data-uncovered]", els => els.map(e => e.getAttribute("data-uncovered"))).catch(() => []);
    if (unc > 0 && uncRows.length !== unc) fail(`Generate uncovered: ${unc} open slot(s) but ${uncRows.length} row(s) rendered`); else ok(`Generate uncovered: ${unc} open slot(s)${unc ? " rendered with per-surgeon reasons: " + uncRows.join(", ") : ""}`);
    const scoreText = await page.$eval("[data-testid=gen-score]", el => el.innerText.replace(/\s+/g, " "));
    if (!/total/.test(scoreText)) fail("Generate score breakdown missing: " + scoreText); else ok("Generate score: " + scoreText.slice(0, 120));
    await page.locator("[data-testid=card-setup_generate]").screenshot({ path: path.join(OUT, "generate-diagnostics.png") });
    ok("screenshot test/ui/out/generate-diagnostics.png");
    // the calendar shows the preview days with the distinct style
    await page.click('button[data-tab="calendar"]');
    await page.waitForSelector("[data-testid=preview-banner]", { timeout: 5000 });
    const monthLabel = await page.$eval("[data-testid=cal-month]", el => el.textContent.trim());
    const previewCells = await page.$$eval('[data-testid=cal-grid] .cal-cell[data-preview="1"]', els => els.map(e => e.getAttribute("data-day")));
    const previewStyled = await page.$eval('[data-testid=cal-grid] .cal-cell[data-preview="1"]', el => getComputedStyle(el).outlineStyle).catch(() => "");
    if (monthLabel !== "November 2026" || previewCells.length !== 29 || previewCells[0] !== "2026-11-02" || previewStyled !== "dashed") fail(`Calendar preview: month ${monthLabel}, ${previewCells.length} preview cells (${previewCells[0]}..), outline ${previewStyled}`); else ok("Calendar preview: November 2026, 29 cells 11/2..11/30 drawn with the dashed preview outline + banner");
    await page.screenshot({ path: path.join(OUT, "generate-preview.png"), fullPage: true });
    ok("screenshot test/ui/out/generate-preview.png");
    await page.click('button[data-tab="setup"]');
    await page.waitForSelector("[data-testid=gen-accept]", { timeout: 5000 });

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
    const seq = writesSince(beforeOk);
    const snapIdx = seq.findIndex(w => w.method === "POST" && w.path.startsWith("/rest/v1/call_schedule_snapshots"));
    const dayIdx = seq.findIndex(w => w.path.startsWith("/rest/v1/schedule_days"));
    const dayWrites = seq.filter(w => w.path.startsWith("/rest/v1/schedule_days"));
    const casShaped = dayWrites.every(w => (w.method === "POST" && /"version":1/.test(w.body) && /return=representation/.test(w.prefer || "")) || (w.method === "PATCH" && /schedule_days\?day=eq\.\d{4}-\d{2}-\d{2}&version=eq\.\d+/.test(w.path)));
    const genAudit = auditSince(beforeOk, "schedule.generate_publish");
    if (snapIdx < 0) fail("Accept & Publish: no snapshot insert recorded");
    else if (seq[snapIdx].snapshotReason !== "generate_publish") fail("Accept & Publish: snapshot reason is " + seq[snapIdx].snapshotReason + ", expected generate_publish");
    else if (dayIdx < 0) fail("Accept & Publish: no schedule_days write recorded");
    else if (dayIdx < snapIdx) fail(`Accept & Publish: a schedule_days write (#${dayIdx}) happened BEFORE the snapshot insert (#${snapIdx})`);
    else if (dayWrites.length < 20 || !casShaped) fail(`Accept & Publish: ${dayWrites.length} schedule_days write(s), CAS-shaped=${casShaped}: ` + JSON.stringify(dayWrites.slice(0, 3).map(w => w.method + " " + w.path)));
    else if (!genAudit) fail("Accept & Publish: no audit_log 'schedule.generate_publish'");
    else ok(`Accept & Publish: snapshot 'generate_publish' (#${snapIdx}) precedes the first schedule_days write (#${dayIdx}); ${dayWrites.length} CAS writes (${dayWrites.filter(w => w.method === "POST").length} POST v1, ${dayWrites.filter(w => w.method === "PATCH").length} PATCH ?day&version); audit schedule.generate_publish; publish dialog opened`);
    const dlgText = await page.$eval("[data-testid=publish-dialog]", el => el.innerText);
    if (!/Publish schedule changes/.test(dlgText) || !/→/.test(dlgText)) fail("publish dialog after Accept lacks the diff lines: " + dlgText.slice(0, 200)); else ok("publish dialog after Accept: diff since last publish with arrow lines (" + (dlgText.match(/→/g) || []).length + ")");
    await page.screenshot({ path: path.join(OUT, "generate-publish-dialog.png"), fullPage: false });
    await page.click("[data-testid=publish-dialog] [data-testid=publish-skip]");
    await page.waitForSelector("[data-testid=publish-dialog]", { state: "detached", timeout: 3000 });
    if (await page.$("[data-testid=gen-preview]")) fail("Accept & Publish: the preview is still shown after acceptance"); else ok("Accept & Publish: preview cleared");
    await page.click('button[data-tab="calendar"]');
    await page.waitForTimeout(400);
    const nov3 = await cellAttr("2026-11-03", "data-primary");
    const nov3prev = await cellAttr("2026-11-03", "data-preview");
    if (!nov3 || nov3prev === "1") fail(`Accept & Publish: 2026-11-03 should now be a saved assignment (primary '${nov3}', preview '${nov3prev}')`); else ok(`Accept & Publish: 2026-11-03 is a saved assignment (P ${nov3}), no longer a preview`);
    await page.waitForTimeout(1500); // let the autosave pass settle (no diff -> no extra day writes)
    await page.click('button[data-tab="setup"]');
    await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 5000 });

    // ---- Import seed: dry run shows zero changes against the live rows and writes nothing ----
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
      if (!/Total changes: 0/.test(total) || !/No changes - the live tables already match the plan\./.test(diffText)) fail("Import dry run: expected zero changes against the live rows: " + total + " | " + diffText.split("\n").slice(-1)[0]);
      else if (!applyDisabled) fail("Import dry run: Apply must be disabled when there is nothing to apply");
      else if (impWrites.length) fail("Import dry run wrote something: " + JSON.stringify(impWrites.map(w => w.method + " " + w.path)));
      else ok("Import seed dry run (docs/silvis-seed.json): 0 changes against the live rows, Apply disabled, no writes");
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
        if (!/Total changes: 2/.test(total3) || !new RegExp("insert s2 available/any " + extra).test(diff3) || !/surgeonRules=update/.test(diff3)) fail(`Import apply dry run (extra ${extra}): expected 2 changes (blob surgeonRules + 1 availability insert): ${total3} | ${diff3.split("\n").filter(l => /insert|surgeonRules/.test(l)).join(" | ")}`);
        else ok(`Import apply dry run: extra Burchett date ${extra} -> 2 changes (surgeonRules=update, insert s2 available/any ${extra})`);
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
        const aBad = aseq.filter(w => w.path.startsWith("/rest/v1/schedule_days") || w.path.startsWith("/rest/v1/time_off"));
        const avBody = aAv >= 0 ? JSON.parse(aseq[aAv].body || "[]") : [];
        const blobBody = aBlob >= 0 ? JSON.parse(aseq[aBlob].body || "{}") : {};
        const resText = await page.$eval("[data-testid=seed-result]", el => el.innerText.replace(/\s+/g, " "));
        const impAudit = auditSince(beforeApply, "seed.import");
        if (aSnap < 0 || aseq[aSnap].snapshotReason !== "seed_import") fail("Import apply: no snapshot 'seed_import' recorded: " + JSON.stringify(aseq.map(w => w.method + " " + w.path)));
        else if (aBlob < 0 || aBlob < aSnap) fail(`Import apply: blob PATCH missing or before the snapshot (snap #${aSnap}, blob #${aBlob})`);
        else if (!(blobBody.data && blobBody.data.surgeonRules && blobBody.data.surgeonRules.s2 && blobBody.data.surgeonRules.s2.explicitAvailable["2026-12"].includes(extra)) || !blobBody.data.roster || "schedule" in blobBody.data) fail("Import apply: the merged blob is wrong: keys " + Object.keys(blobBody.data || {}).join(","));
        else if (aAv < 0 || aAv < aSnap || avBody.length !== 1 || avBody[0].start_date !== extra || avBody[0].person_id !== "s2" || avBody[0].source !== "seed") fail(`Import apply: availability insert wrong (index ${aAv}, snap ${aSnap}): ` + JSON.stringify(avBody));
        else if (aBad.length) fail("Import apply: schedule_days / time_off were written although nothing changed there: " + JSON.stringify(aBad.map(w => w.method + " " + w.path)));
        else if (!/Import applied/.test(resText) || !/blob merged/.test(resText) || !/availability inserted 1, skipped 36/.test(resText) || !/schedule_days inserted 0, updated 0, kept \(app-edited\) 4\b/.test(resText)) fail("Import apply: result panel wrong (expected 1 availability insert of 37 plan rows, no schedule_days change, the 4 Thanksgiving days kept because their generated backups differ from the seed-owned live rows): " + resText);
        else if (!impAudit) fail("Import apply: no audit_log 'seed.import'");
        else ok(`Import apply: snapshot 'seed_import' (#${aSnap}) -> blob PATCH ?id=eq.main (#${aBlob}, merged over the live blob) -> availability POST (#${aAv}) with exactly the 1 missing row (${extra}); no schedule_days / time_off write; audit seed.import; result: "${resText.slice(0, 120)}"`);
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
} catch (e) {
  fail("harness exception: " + (e && e.stack || e));
  try { await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }); } catch (e2) {}
}

// Console / page error triage.
if (pageErrors.length) fail("pageerrors: " + pageErrors.join(" | ")); else ok("no pageerror during the run");
const unexpected = consoleErrors.filter(t => !EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
const expected = consoleErrors.filter(t => EXPECTED_CONSOLE_ERRORS.some(x => x.rx.test(t)));
if (expected.length) console.log(`     (${expected.length} expected console error(s) ignored: ${[...new Set(expected)].slice(0, 3).join(" | ")})`);
if (forcedConsoleErrors.length) console.log(`     (${forcedConsoleErrors.length} console error(s) came from the snapshot insert the harness forced to 500 - expected)`);
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
