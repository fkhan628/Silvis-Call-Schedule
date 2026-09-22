// Silvis Call Schedule - Playwright smoke harness (Prompt 6 Slices A-D + fix round 1).
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
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const consoleWarns = [];
const writes = [];
const watchPage = (pg, tag) => {
  pg.on("pageerror", (e) => pageErrors.push(`${tag}: ` + String(e && e.message || e)));
  pg.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); if (msg.type() === "warning") consoleWarns.push(msg.text()); });
  pg.on("requestfailed", (r) => failedRequests.push(`${tag}: ${r.method()} ${r.url()} -> ${(r.failure() || {}).errorText || "failed"}`));
};
watchPage(page, "main");
await installRealtimeMock(page);

// PostgREST-shaped answers for the writes we record: a schedule_days POST /
// PATCH with Prefer: return=representation gets its own body back (so the
// CAS path sees a version, exactly like the real table), everything else [].
const representation = (method, url, body) => {
  if (!url.pathname.startsWith("/rest/v1/schedule_days")) return [];
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
    if (method === "GET") return json(200, [{ id: FAKE_UID, person_id: "s1", role: "admin", display_name: "Khan", email: null }]);
    writes.push({ method, path: url.pathname + url.search, body: req.postData() || "" });
    return json(method === "POST" ? 201 : 200, []);
  }
  if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body, prefer: req.headers()["prefer"] || "" });
    return json(method === "POST" ? 201 : 200, representation(method, url, body));
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
    await page.click("button:has-text('Cancel')");
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
