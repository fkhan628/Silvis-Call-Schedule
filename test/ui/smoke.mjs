// Silvis Call Schedule - Playwright smoke harness (Prompt 6 Slice A + fix round 1).
//
// Serves the built index.html from a tiny static server, intercepts the Silvis
// Supabase host (fake signed-in scheduler; writes answered 2xx + recorded with a
// PostgREST-shaped representation; anon READS pass through to the real project
// with the anon key), mocks the Realtime websocket (so a postgres_changes row
// can be injected on demand), then:
//   - asserts the app reaches the calendar with the header "Silvis Call Schedule"
//   - clicks every nav tab, asserting no pageerror / unexpected console error
//   - makes one schedule edit and asserts a schedule_days POST (version 1) was sent
//   - injects a foreign realtime row and asserts it is adopted
//   - RACES the echo of a write against a pending local edit and asserts the
//     local edit survives and re-syncs as a CAS PATCH (finding datalayer-001)
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
// Run:  node build.js && node test/ui/smoke.mjs      (or: npm run smoke)
// Env:  PLAYWRIGHT_DIR  node_modules dir that contains playwright (optional;
//                       see PW_CANDIDATES for the default search order)
//       HEADFUL=1       watch the browser
//       SMOKE_NO_CACHE=1 bypass the CDN cache for this run
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

  // One schedule edit through the stub editor -> schedule_days POST v1 with CAS headers.
  await page.click('button[data-tab="calendar"]');
  await page.waitForTimeout(3300); // past the 3s post-load hydration window of the autosave
  const firstRow = await page.$("[data-day] select");
  let day = null;
  if (!firstRow) fail("no editable day row found in the calendar (scheduler select)");
  else {
    day = await page.$eval("[data-day]", el => el.getAttribute("data-day"));
    const beforeWrites = writes.length;
    await page.selectOption(`[data-day="${day}"] select >> nth=0`, "s2");
    await page.waitForTimeout(1800); // 800ms debounce + request
    const dayWrite = writes.slice(beforeWrites).find(w => w.path.startsWith("/rest/v1/schedule_days"));
    if (!dayWrite) fail("schedule edit produced no schedule_days write; writes: " + JSON.stringify(writes.slice(beforeWrites)));
    else {
      const body = JSON.parse(dayWrite.body || "{}");
      const good = dayWrite.method === "POST" && body.day === day && body.primary_id === "s2" && body.version === 1 && /return=representation/.test(dayWrite.prefer) && body.updated_by === "s1";
      if (!good) fail("schedule_days write shape wrong: " + JSON.stringify(dayWrite));
      else ok(`schedule edit -> POST /rest/v1/schedule_days { day: ${day}, primary_id: s2, version: 1, updated_by: s1 } with Prefer return=representation`);
    }
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
    const other = days.find(d => d !== day);
    // (a) foreign UPDATE on a day with no local edit -> adopted into the UI
    rtSendDayRow(dayRow(other, { primary_id: "s4", backup_id: "s5", version: 5 }));
    const adopted = await waitFor(async () => (await page.$eval(`[data-day="${other}"] select >> nth=0`, el => el.value)) === "s4", 4000);
    if (adopted) ok(`realtime: foreign row for ${other} (primary s4 v5) adopted into the calendar`);
    else fail(`realtime: foreign row for ${other} was not adopted (primary select = ${await page.$eval(`[data-day="${other}"] select >> nth=0`, el => el.value)})`);
    // (b) THE RACE: set backup on `day` (local {s2,s3}, last persisted {s2}),
    //     then deliver the echo of the earlier primary write ({s2}, v1) inside
    //     the 800ms debounce. Before the fix the echo blanked the backup and
    //     no PATCH followed; now the local edit stays and PATCHes against v1.
    const beforeRace = writes.length;
    await page.selectOption(`[data-day="${day}"] select >> nth=1`, "s3");
    rtSendDayRow(dayRow(day, { primary_id: "s2", backup_id: null, version: 1, updated_by: "s1" }));
    await page.waitForTimeout(250);
    const midBackup = await page.$eval(`[data-day="${day}"] select >> nth=1`, el => el.value);
    await page.waitForTimeout(1800);
    const endBackup = await page.$eval(`[data-day="${day}"] select >> nth=1`, el => el.value);
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
    const headers = { ...req.headers() }; headers["authorization"] = "Bearer " + ANON_KEY;
    return route.continue({ headers });
  });
  await pub.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {}); // mocked, silent
  try {
    const a = await loadWithRetry(pub, BASE + "?public=1", "[data-testid=cal-month]", 20000, "public page");
    ok(`?public=1 renders the read-only calendar without auth${a > 1 ? " (on retry)" : ""}`);
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
