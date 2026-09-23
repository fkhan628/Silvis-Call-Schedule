// Silvis Call Schedule - mobile layout audit (Prompt 11 hardening, 390x844).
//
// Same mocking as test/ui/smoke.mjs (static server over the built index.html,
// the Silvis Supabase host intercepted: fake admin session for s1, every write
// answered 2xx + RECORDED and never sent, anon reads passed through with the
// public key, Realtime socket silenced, Davenport host canned), but the page
// runs at a 390x844 phone viewport (deviceScaleFactor 2 so the screenshots
// are legible) and every view is screenshotted to test/ui/out/mobile-*.png:
//   tabs (setup, calendar, myschedule, timeoff, totals, settings), the Alerts
//   panel, the day editor, every Setup card, the Generate preview (card +
//   calendar), Totals (table + fairness), Time off + a proposed trade, the
//   publish dialog, the month painter, Settings with its cards expanded.
// For every screenshot it also measures: page scrollWidth vs viewport,
// elements whose box crosses the right edge (split into "inside an overflow-x
// wrapper" = intended horizontal scroll, and "page overflow"), buttons /
// inputs off-screen, and text nodes at 9px or smaller. Findings print as a
// JSON block at the end (MOBILE_AUDIT_JSON) for the report.
//
// Audit only: nothing here asserts; exit code 0 unless the harness itself
// crashes. Run:  node build.js && node test/ui/mobile-audit.mjs
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
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_DIR,
  path.join(ROOT, "node_modules"),
  "<playwright-dir>",
  "<your home folder>/AppData/Local/Temp/claude/<session-folder>/<session-id>/scratchpad/tooling/node_modules",
].filter(Boolean);
const PW_DIR = PW_CANDIDATES.find(d => fs.existsSync(path.join(d, "playwright", "package.json")));
if (!PW_DIR) { console.error("FAIL: playwright not found"); process.exit(1); }
const require = createRequire(pathToFileURL(path.join(PW_DIR, "x.js")).href);
const { chromium } = require("playwright");

const SUPABASE_HOST = "bzhsroegtagqhutbnsrp.supabase.co";
const EAST_HOST = "xqongyahdnkozqunpwmu.supabase.co";
const CDN_HOSTS = ["unpkg.com", "cdn.jsdelivr.net"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const configSrc = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const ANON_KEY = (configSrc.match(/const SUPABASE_ANON_KEY = "([^"]+)"/) || [])[1];
const APP_VERSION = (fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8").match(/var APP_VERSION = "([^"]+)"/) || [])[1];
if (!ANON_KEY || !fs.existsSync(path.join(ROOT, "index.html"))) { console.error("FAIL: anon key or index.html missing - run node build.js first"); process.exit(1); }

const FAKE_UID = "00000000-0000-4000-8000-000000000001";
// No address anywhere: the mocked auth user and profile carry email null so no
// screenshot can show one (Settings > Account renders authUser.email).
const FAKE_PROFILE = { id: FAKE_UID, person_id: "s1", role: "admin", display_name: "Khan", email: null, created_at: "2026-09-22T00:00:00Z" };
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const FAKE_JWT = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: FAKE_UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`;
const EAST_WEEK = { week_monday: "2026-10-05", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" }, off: [], isBackup: false, dayCallOverrides: {} } };
const EAST_BLOB = { surgeons: [{ id: "s6", name: "FAK" }, { id: "s1", name: "AAA" }] };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CDN_CACHE, { recursive: true });

// ---- fixture fallback (empty live table) - identical to smoke.mjs ----
const fixture = await (async () => {
  let liveCount = null;
  try {
    const res = await fetch(`https://${SUPABASE_HOST}/rest/v1/schedule_days?select=day&limit=1`, { headers: { apikey: ANON_KEY, authorization: "Bearer " + ANON_KEY, prefer: "count=exact" } });
    const cr = res.headers.get("content-range") || "";
    liveCount = res.ok ? Number(cr.split("/")[1] || "0") : null;
  } catch (e) { /* fall through to fixtures */ }
  const want = process.env.SMOKE_FIXTURE === "1" || (liveCount === 0 && process.env.SMOKE_LIVE !== "1");
  if (!want) { console.log(`data source: LIVE Silvis project (schedule_days rows: ${liveCount === null ? "unknown" : liveCount})`); return null; }
  console.log("data source: SEED FIXTURES");
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(({ token, version }) => {
  try {
    localStorage.setItem("silvis-auth-token", token);
    localStorage.setItem("silvis-auth-refresh", "fake-refresh");
    localStorage.setItem("silvis-app-version", version);
  } catch (e) {}
}, { token: FAKE_JWT, version: APP_VERSION });
const cacheKey = (url) => path.join(CDN_CACHE, crypto.createHash("sha1").update(url).digest("hex"));
await context.route((url) => CDN_HOSTS.includes(url.hostname) || FONT_HOSTS.includes(url.hostname), async (route) => {
  const req = route.request(); const url = req.url(); const host = new URL(url).hostname;
  if (FONT_HOSTS.includes(host)) return route.fulfill({ status: 200, contentType: "text/css", body: "/* fonts stubbed */" });
  if (req.method() !== "GET") return route.continue();
  const key = cacheKey(url);
  if (fs.existsSync(key + ".body") && fs.existsSync(key + ".json")) {
    const meta = JSON.parse(fs.readFileSync(key + ".json", "utf8"));
    return route.fulfill({ status: 200, headers: { "content-type": meta.contentType, "access-control-allow-origin": "*", "cache-control": "no-store" }, body: fs.readFileSync(key + ".body") });
  }
  const res = await route.fetch(); const body = await res.body(); const contentType = res.headers()["content-type"] || "text/javascript";
  if (res.status() === 200 && body.length > 0) { fs.writeFileSync(key + ".body", body); fs.writeFileSync(key + ".json", JSON.stringify({ url, contentType, bytes: body.length })); }
  return route.fulfill({ status: res.status(), headers: { "content-type": contentType, "access-control-allow-origin": "*" }, body });
});
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
page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e)));
await page.routeWebSocket((url) => String(url).includes("/realtime/v1/websocket"), () => {}); // silenced: poll only
const writes = [];
const tradeStore = [];
const representation = (method, url, body) => {
  const rowTables = ["/rest/v1/time_off", "/rest/v1/notifications", "/rest/v1/audit_log"];
  if (method === "POST" && rowTables.some(t => url.pathname.startsWith(t))) {
    try { const b = JSON.parse(body || "{}"); const stamp = (r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }); return Array.isArray(b) ? b.map(stamp) : [stamp(b)]; } catch (e) { return []; }
  }
  const echoes = url.pathname.startsWith("/rest/v1/schedule_days") || (method === "PATCH" && url.pathname.startsWith("/rest/v1/call_schedule_data"));
  if (!echoes) return [];
  try { const b = JSON.parse(body || "{}"); return Array.isArray(b) ? b : [b]; } catch (e) { return []; }
};
await page.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
  const req = route.request(); const url = new URL(req.url()); const method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  if (url.pathname.startsWith("/auth/v1/user") && method === "GET") return json(200, { id: FAKE_UID, email: null, aud: "authenticated", role: "authenticated" });
  if (url.pathname.startsWith("/rest/v1/user_profiles")) {
    if (method === "GET") return json(200, [FAKE_PROFILE]);
    const body = req.postData() || ""; writes.push({ method, path: url.pathname + url.search, body });
    if (method === "PATCH") { let patch = {}; try { patch = JSON.parse(body); } catch (e) {} return json(200, [{ ...FAKE_PROFILE, ...patch }]); }
    return json(method === "POST" ? 201 : 200, []);
  }
  if (url.pathname.startsWith("/rest/v1/shift_trade_requests") || url.pathname === "/rest/v1/rpc/apply_trade") {
    if (method === "GET") return json(200, tradeStore.slice().sort((a, b) => a.submitted_at < b.submitted_at ? 1 : -1));
    const body = req.postData() || ""; writes.push({ method, path: url.pathname + url.search, body });
    let b = {}; try { b = JSON.parse(body || "{}"); } catch (e) { b = {}; }
    if (url.pathname === "/rest/v1/rpc/apply_trade") {
      const row = tradeStore.find(r => r.id === b.p_trade_id);
      if (!row) return json(400, { message: "TRADE_NOT_FOUND", code: "P0001" });
      row.status = "applied"; row.decided_at = row.decided_at || new Date().toISOString();
      return json(200, { ok: true });
    }
    if (method === "POST") { const row = { id: crypto.randomUUID(), submitted_at: new Date().toISOString(), ...b }; tradeStore.push(row); return json(201, [row]); }
    if (method === "PATCH") { const id = (url.searchParams.get("id") || "").replace(/^eq\./, ""); const row = tradeStore.find(r => r.id === id); if (!row) return json(200, []); Object.assign(row, b); return json(200, [row]); }
    return json(200, []);
  }
  if (method === "POST" || method === "PATCH" || method === "DELETE" || method === "PUT") {
    const body = req.postData() || "";
    writes.push({ method, path: url.pathname + url.search, body: url.pathname.startsWith("/rest/v1/call_schedule_snapshots") ? "(snapshot body omitted)" : body });
    return json(method === "POST" ? 201 : 200, representation(method, url, body));
  }
  const fx = fixtureAnswer(url);
  if (fx) return json(200, fx);
  const headers = { ...req.headers() }; headers["authorization"] = "Bearer " + ANON_KEY;
  return route.continue({ headers });
});

// ---- measurement ----
const VW = 390;
const findings = [];
const log = (m) => console.log(m);
const measure = (label) => page.evaluate((label) => {
  const vw = window.innerWidth;
  const docW = document.documentElement.scrollWidth;
  const bodyW = document.body.scrollWidth;
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const scrollWrap = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) return e; } return null; };
  const fixedAncestor = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.position === "fixed") return e; } return null; };
  const desc = (el) => { const t = el.getAttribute("data-testid"); const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40); return el.tagName.toLowerCase() + (t ? "[" + t + "]" : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "") + (txt ? " '" + txt + "'" : ""); };
  const pageOverflow = [], wrapped = [], offscreenControls = [], tiny = [];
  const all = Array.from(document.querySelectorAll("body *"));
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const crosses = r.right > vw + 1 || r.left < -1;
    if (crosses) {
      const w = scrollWrap(el);
      const entry = { el: desc(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      if (w) { if (wrapped.length < 6 && !wrapped.some(x => x.wrap === desc(w))) wrapped.push({ wrap: desc(w), wrapScroll: w.scrollWidth, wrapClient: w.clientWidth, example: entry }); }
      else if (pageOverflow.length < 12) pageOverflow.push(entry);
      if (/^(button|input|select|textarea|a)$/i.test(el.tagName) && !w && offscreenControls.length < 12) offscreenControls.push(entry);
    }
    const tag = el.tagName.toLowerCase();
    if (!/^(script|style|svg|path|rect|title)$/.test(tag)) {
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
      if (own) { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs <= 9 && tiny.length < 15) tiny.push({ el: desc(el), fontSize: fs, text: own.slice(0, 40) }); }
    }
  }
  // Every element crossing the edge that is NOT inside an intended scroll wrapper, counted (not capped).
  const overflowCount = all.filter(el => visible(el) && (el.getBoundingClientRect().right > vw + 1) && !scrollWrap(el)).length;
  const tinyCount = all.filter(el => { if (!visible(el)) return false; const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()); return own && parseFloat(getComputedStyle(el).fontSize) <= 9; }).length;
  return { label, vw, docScrollWidth: docW, bodyScrollWidth: bodyW, pageScrolls: docW > vw + 2, overflowCount, pageOverflow, wrapped, offscreenControls, tinyCount, tiny };
}, label);
const shot = async (name, opts) => {
  const file = path.join(OUT, `mobile-${name}.png`);
  if (opts && opts.locator) await opts.locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: !(opts && opts.viewportOnly) });
  const m = await measure(name);
  m.screenshot = "test/ui/out/" + path.basename(file);
  findings.push(m);
  log(`shot ${m.screenshot}  docScrollWidth=${m.docScrollWidth}${m.pageScrolls ? " PAGE-SCROLLS" : ""} overflow=${m.overflowCount} wrapped=${m.wrapped.length} offscreenControls=${m.offscreenControls.length} tinyText=${m.tinyCount}`);
  return m;
};
const clickTab = async (t) => { await page.click(`button[data-tab="${t}"]`); await page.waitForTimeout(600); };
const openCard = async (ck) => {
  const card = page.locator(`[data-testid=card-${ck}]`);
  if ((await card.count()) === 0) return null;
  if ((await card.getAttribute("data-open")) !== "1") { await page.click(`[data-testid=card-toggle-${ck}]`); await page.waitForTimeout(250); }
  return card;
};
const closeCard = async (ck) => {
  const card = page.locator(`[data-testid=card-${ck}]`);
  if ((await card.count()) && (await card.getAttribute("data-open")) === "1") { await page.click(`[data-testid=card-toggle-${ck}]`); await page.waitForTimeout(150); }
};
const showMonth = async (y, m0) => {
  await page.selectOption("[data-testid=cal-month-select]", String(m0));
  if ((await page.$eval("[data-testid=cal-year-input]", el => el.value)) !== String(y)) await page.fill("[data-testid=cal-year-input]", String(y));
  await page.waitForTimeout(400);
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1:has-text('Silvis Call Schedule')", { timeout: 40000 });
  await page.waitForSelector("text=Synced", { timeout: 40000 }).catch(() => log("(header never reached Synced)"));
  await page.waitForTimeout(800);

  // 1) every tab
  for (const t of ["calendar", "setup", "myschedule", "timeoff", "totals", "settings"]) {
    await clickTab(t);
    await shot(t);
  }
  // Alerts panel
  await clickTab("calendar");
  await page.click("button[aria-label=Notifications]");
  await page.waitForTimeout(300);
  await shot("alerts", { viewportOnly: true });
  await page.click("button[aria-label='Close notifications']").catch(() => {});

  // 2) calendar Oct 2026 + day editor
  await showMonth(2026, 9);
  await shot("calendar-oct-2026");
  await page.click('[data-day="2026-10-15"]');
  await page.waitForSelector("[data-testid=day-editor]", { timeout: 5000 });
  await page.waitForTimeout(300);
  const dlg = page.locator("[data-testid=day-editor] [role=dialog]");
  await shot("day-editor-top", { viewportOnly: true });
  const dlgBox = await dlg.boundingBox();
  const dlgScroll = await dlg.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  log(`day editor dialog box ${JSON.stringify(dlgBox)} scroll ${JSON.stringify(dlgScroll)}`);
  findings.push({ label: "day-editor-metrics", dialogBox: dlgBox, dialogScroll: dlgScroll });
  await dlg.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  await shot("day-editor-bottom", { viewportOnly: true });
  // the override confirm panel: pick an ineligible option
  const inel = await page.$$eval("[data-testid=editor-primary] option[data-eligible=false]", os => os.map(o => o.value));
  if (inel.length) {
    await page.selectOption("[data-testid=editor-primary]", inel[0]);
    await page.waitForTimeout(250);
    await dlg.evaluate(el => { const p = el.querySelector("[data-testid=override-confirm]"); if (p) p.scrollIntoView({ block: "center" }); });
    await shot("day-editor-override", { viewportOnly: true });
    await page.click("[data-testid=override-confirm] button:has-text('Keep as is')").catch(() => {});
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Calendar collapsibles: week rows and calendar tools
  await page.evaluate(() => window.scrollTo(0, 0));
  const wr = await openCard("cal_weekrows");
  if (wr) await shot("calendar-week-rows", { locator: wr });
  const tools = await openCard("cal_tools");
  if (tools) await shot("calendar-tools", { locator: tools });
  await closeCard("cal_tools");

  // 3) Setup cards, one at a time
  await clickTab("setup");
  await page.waitForSelector("[data-testid=card-setup_issues]", { timeout: 8000 });
  const SETUP_CARDS = ["setup_issues", "setup_roster", "setup_users", "setup_rules", "setup_availability", "setup_vacations", "setup_holidays", "setup_east", "setup_generate", "setup_import", "setup_office", "setup_clear"];
  for (const ck of SETUP_CARDS) await closeCard(ck);
  for (const ck of SETUP_CARDS) {
    const card = await openCard(ck);
    if (!card) { log(`(setup card ${ck} missing)`); continue; }
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    if (ck === "setup_rules") { await page.click("[data-testid=rules-pick-s3]").catch(() => {}); await page.waitForTimeout(300); }
    await shot("setup-" + ck.replace(/^setup_/, ""), { locator: card });
    if (ck !== "setup_generate") await closeCard(ck);
  }
  // 4) Generate preview (Nov 2026, N=10, seed 7) -> card + calendar; then discard
  await openCard("setup_generate");
  await page.fill("[data-testid=gen-start]", "2026-11-02");
  await page.fill("[data-testid=gen-end]", "2026-11-30");
  await page.fill("[data-testid=gen-n]", "10");
  await page.fill("[data-testid=gen-seed]", "7");
  await page.click("[data-testid=gen-run]");
  await page.waitForSelector("[data-testid=gen-diagnostics]", { timeout: 120000 });
  await page.waitForTimeout(800);
  await shot("generate-preview-card", { locator: page.locator("[data-testid=card-setup_generate]") });
  await clickTab("calendar");
  await page.waitForSelector("[data-testid=preview-banner]", { timeout: 5000 });
  await shot("calendar-generate-preview");
  // Does the 8px PREVIEW tag (absolute, bottom-left) collide with the B line or the vacation dots in a 66px phone cell?
  const tagOverlap = await page.evaluate(() => {
    const out = { cells: 0, tagOverB: 0, tagOverDots: 0, examples: [] };
    for (const cell of document.querySelectorAll("[data-testid=cal-grid] .cal-cell.cal-preview")) {
      out.cells++;
      const tag = cell.querySelector(".cal-preview-tag"); if (!tag) continue;
      const t = tag.getBoundingClientRect();
      const lines = cell.querySelectorAll(".cal-line"); const b = lines[lines.length - 1] ? lines[lines.length - 1].getBoundingClientRect() : null;
      const dots = cell.querySelector(".cal-dots"); const d = dots ? dots.getBoundingClientRect() : null;
      const hit = (r) => r && !(t.right < r.left || t.left > r.right || t.bottom < r.top || t.top > r.bottom);
      if (hit(b)) { out.tagOverB++; if (out.examples.length < 3) out.examples.push({ day: cell.getAttribute("data-day"), tagTop: Math.round(t.top), bBottom: Math.round(b.bottom), cellH: Math.round(cell.getBoundingClientRect().height) }); }
      if (hit(d)) out.tagOverDots++;
    }
    return out;
  });
  log("preview tag overlap: " + JSON.stringify(tagOverlap));
  findings.push({ label: "preview-tag-overlap", ...tagOverlap });
  await page.locator("[data-testid=cal-grid]").screenshot({ path: path.join(OUT, "mobile-calendar-generate-preview-grid.png") });
  await page.click("[data-testid=preview-discard]");
  await page.waitForTimeout(300);
  await clickTab("setup");
  await closeCard("setup_generate");

  // Month painter (from the Vacations card)
  await openCard("setup_vacations");
  await page.click("[data-testid=card-setup_vacations] button:has-text('Paint month')");
  await page.waitForSelector("text=Paint vacations", { timeout: 5000 });
  await page.waitForTimeout(300);
  await shot("paint-month", { viewportOnly: true });
  await page.click("button[aria-label=Close]");
  await page.waitForTimeout(200);
  await closeCard("setup_vacations");

  // 5) Totals: Oct 2026 table + fairness
  await clickTab("totals");
  await page.waitForSelector("[data-testid=totals-card]", { timeout: 8000 });
  await page.selectOption("[data-testid=totals-year]", "2026");
  await page.selectOption("[data-testid=totals-month]", "9");
  await page.waitForTimeout(400);
  await shot("totals-oct-2026");
  await page.click("[data-testid=totals-mode-fairness]");
  await page.waitForTimeout(400);
  await shot("totals-fairness");
  await page.click("[data-testid=totals-mode-month]");

  // 6) Time off + a proposed trade (writes recorded, never sent)
  await clickTab("timeoff");
  await page.waitForSelector("[data-testid=trade-card]", { timeout: 8000 });
  await shot("timeoff");
  try {
    await page.selectOption("[data-testid=trade-from]", "s2");
    await page.waitForTimeout(200);
    const mineOpts = await page.$$eval("[data-testid=trade-mine-pick] option", os => os.map(o => o.value).filter(Boolean));
    let done = false;
    for (const v of mineOpts.slice(0, 12)) {
      await page.selectOption("[data-testid=trade-mine-pick]", v);
      await page.waitForTimeout(150);
      if (await page.$("[data-testid=trade-unit]")) continue;
      const good = await page.$$eval("[data-testid=trade-to] option[data-eligible=true]", os => os.map(o => o.value));
      if (!good.length) continue;
      await page.selectOption("[data-testid=trade-to]", good[0]);
      await page.waitForTimeout(200);
      const onDlg = (d) => d.accept();
      page.on("dialog", onDlg);
      await page.click("[data-testid=trade-submit]");
      await page.waitForSelector("[data-testid=trade-row][data-status=pending]", { timeout: 10000 });
      page.off("dialog", onDlg);
      done = true; break;
    }
    log(done ? "trade proposed (one-way, scheduler confirm accepted; recorded only)" : "(no non-unit day with an eligible counter-party - no trade proposed)");
  } catch (e) { log("(trade proposal step failed: " + String(e && e.message || e).split("\n")[0] + ")"); }
  await page.waitForTimeout(400);
  await shot("trades");
  const pend = page.locator("[data-testid=trades-pending]");
  if (await pend.count()) await shot("trades-pending-card", { locator: pend });
  const tradeForm = page.locator("[data-testid=trade-card]");
  if (await tradeForm.count()) await shot("trade-form-card", { locator: tradeForm });

  // 7) Settings with cards expanded + publish dialog
  await clickTab("settings");
  for (const title of ["Activity log", "Client versions", "Office notifications", "Notification settings", "Restore from snapshot"]) {
    const el = await page.$(`text=${title}`);
    if (el) { await el.click(); await page.waitForTimeout(200); }
  }
  await page.waitForTimeout(500);
  await shot("settings-open");
  const pubBtn = page.locator("button:has-text('Publish and notify office')");
  if (await pubBtn.isVisible().catch(() => false)) {
    await pubBtn.click();
    await page.waitForSelector("[data-testid=publish-dialog]", { timeout: 5000 });
    await page.waitForTimeout(300);
    await shot("publish-dialog", { viewportOnly: true });
    await page.click("[data-testid=publish-skip]");
  }
  // Dark mode calendar at 390 for completeness
  await page.click("button:has-text('Dark')");
  await clickTab("calendar");
  await showMonth(2026, 9);
  await shot("calendar-dark", { viewportOnly: true });
  await clickTab("settings");
  await page.click("button:has-text('Light')");
} catch (e) {
  log("HARNESS EXCEPTION: " + (e && e.stack || e));
  try { await page.screenshot({ path: path.join(OUT, "mobile-failure.png"), fullPage: true }); } catch (e2) {}
}

log(`\nwrites intercepted (recorded, never sent): ${writes.length}`);
writes.slice(0, 40).forEach(w => log(`  ${w.method} ${w.path}`));
if (pageErrors.length) log("pageerrors: " + pageErrors.join(" | "));
log("\nMOBILE_AUDIT_JSON " + JSON.stringify(findings));
await browser.close();
server.close();
process.exit(0);
