// Silvis Call Schedule - standalone export documents opened from file:// (Prompt 9 review).
//
// Opens the saved export documents in Chromium straight from disk - the way a
// recipient double-clicks an attachment - and asserts each one renders with NO
// console error / pageerror / failed request, then checks the visible facts:
//   test/ui/out/er-panel-2026-09-14-to-12-13.html  the ER-panel author's ER Call Panels (13 rows,
//        header text exact, OPEN red + bold, Atwell week, entry per line)
//   test/ui/out/share-2026-09-to-12.html           read-only share page (4 month grids,
//        OPEN red, Atwell week row, no horizontal scroll at 1180 and 390 px)
//   test/ui/out/printable-2026-09-to-12.html       printable month pages (4 pages,
//        OPEN red, external cover, toolbar)
//   plus the two documents the smoke harness downloaded from the running app when
//   they exist (share page Oct-Nov, ER panel 11/2-12/13).
// Screenshots go to test/ui/out/standalone-*.png. Exit 1 on any failure.
// Inputs are produced by node test/exports.test.js (and the smoke harness).
// Run: node test/ui/exports-standalone.mjs
// Env: PLAYWRIGHT_DIR (see smoke.mjs), STANDALONE_ONLINE_FONTS=1 to let the
//      Google Fonts <link> hit the network (default: stubbed with empty CSS so a
//      missing network never reads as a document fault; the stub is reported).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const PW_CANDIDATES = [
  process.env.PLAYWRIGHT_DIR,
  path.join(ROOT, "node_modules"),
  "<playwright-dir>",
  "<your home folder>/AppData/Local/Temp/claude/<session-folder>/<session-id>/scratchpad/tooling/node_modules",
].filter(Boolean);
const PW_DIR = PW_CANDIDATES.find(d => fs.existsSync(path.join(d, "playwright", "package.json")));
if (!PW_DIR) { console.error("FAIL: playwright not found. Looked in:\n  " + PW_CANDIDATES.join("\n  ")); process.exit(1); }
const require = createRequire(pathToFileURL(path.join(PW_DIR, "x.js")).href);
const { chromium } = require("playwright");
console.log(`playwright from ${PW_DIR}`);

const failures = [];
const fail = (m) => { failures.push(m); console.log("FAIL " + m); };
const ok = (m) => console.log("ok   " + m);
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RX = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const fontsStubbed = process.env.STANDALONE_ONLINE_FONTS !== "1";
if (fontsStubbed) await context.route((u) => /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname), (route) => route.fulfill({ status: 200, contentType: "text/css", body: "/* fonts stubbed by exports-standalone.mjs */" }));

async function openDoc(file, label, checks) {
  if (!fs.existsSync(file)) { console.log(`skip ${label}: ${path.relative(ROOT, file)} not present`); return; }
  const raw = fs.readFileSync(file, "utf8");
  if (EMAIL_RX.test(raw)) fail(`${label}: an email address is in the document`);
  if (PHONE_RX.test(raw)) fail(`${label}: a phone number is in the document`);
  const page = await context.newPage();
  const errors = [], pageErrors = [], failed = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e)));
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} -> ${(r.failure() || {}).errorText || "failed"}`));
  const url = pathToFileURL(file).href;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(300);
    await checks(page);
  } catch (e) { fail(`${label}: ${String(e && e.message || e).split("\n")[0]}`); }
  if (pageErrors.length) fail(`${label}: pageerror ${pageErrors.join(" | ")}`);
  if (errors.length) fail(`${label}: console errors ${[...new Set(errors)].join(" | ")}`);
  if (failed.length) fail(`${label}: failed requests ${failed.join(" | ")}`);
  if (!pageErrors.length && !errors.length && !failed.length) ok(`${label}: opened from file:// with no console error, pageerror or failed request${fontsStubbed ? " (Google Fonts stubbed)" : ""}`);
  await page.close();
}

const rgb = async (page, sel, prop) => page.$eval(sel, (el, p) => getComputedStyle(el)[p], prop);

await openDoc(path.join(OUT, "er-panel-2026-09-14-to-12-13.html"), "ER panel 9/14-12/13", async (page) => {
  const title = await page.title();
  if (title !== "ER Call Panels - Silvis Surgical Care - 9/14 to 12/13") fail("ER panel title: " + title); else ok("ER panel title: " + title);
  const ths = await page.$$eval("table[data-export=er-call-panels] th", els => els.map(e => e.innerText.trim()));
  if (ths.join(" | ") !== "MON/SUN DATES | TRAUMA & CARDIOTHORACIC SURGERY TRAUMA | TRAUMA BACKUP") fail("ER panel header cells: " + ths.join(" | ")); else ok("ER panel header cells exact: " + ths.join(" | "));
  const rows = await page.$$eval("table[data-export=er-call-panels] tbody tr", trs => trs.map(tr => Array.from(tr.children).map(td => td.innerText.trim().replace(/\n/g, "; "))));
  if (rows.length !== 13) fail("ER panel rows: " + rows.length); else ok("ER panel: 13 week rows rendered");
  rows.forEach(r => console.log("     " + r.join("  |  ")));
  const atwell = rows.find(r => r[0] === "9/28 - 10/4");
  if (!atwell || atwell[1] !== "9/28-10/4 Atwell" || atwell[2] !== "9/28-10/4 Fierce") fail("Atwell week row: " + JSON.stringify(atwell)); else ok("ER panel Atwell week: '9/28-10/4 Atwell' | '9/28-10/4 Fierce'");
  const open = await page.$$eval("table[data-export=er-call-panels] [data-kind=open]", els => els.map(e => ({ t: e.innerText, c: getComputedStyle(e).color, w: getComputedStyle(e).fontWeight })));
  const notRed = open.filter(o => o.c !== "rgb(255, 0, 0)" || !(o.w === "700" || o.w === "bold"));
  if (!open.length || notRed.length) fail(`ER panel OPEN styling: ${open.length} open entries, ${notRed.length} not red+bold ${JSON.stringify(notRed.slice(0, 3))}`); else ok(`ER panel: all ${open.length} OPEN entries computed rgb(255, 0, 0) bold`);
  const nonOpenRed = await page.$$eval("table[data-export=er-call-panels] [data-kind]:not([data-kind=open])", els => els.filter(e => getComputedStyle(e).color === "rgb(255, 0, 0)").map(e => e.innerText));
  if (nonOpenRed.length) fail("ER panel: non-open entries in red: " + nonOpenRed.join(", ")); else ok("ER panel: no surgeon/external entry is red");
  // each entry on its own line: the cell's line count equals its entry count
  const lines = await page.$$eval("table[data-export=er-call-panels] tbody td:nth-child(2)", tds => tds.map(td => ({ n: td.querySelectorAll("span[data-kind]").length, h: td.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(td).lineHeight) || 0 })));
  const multi = lines.find(l => l.n >= 6);
  if (multi && multi.h < multi.n * 12) fail("ER panel entries do not stack one per line: " + JSON.stringify(multi)); else ok("ER panel: entries stack one per line (7-entry cell is " + Math.round(multi ? multi.h : 0) + "px tall)");
  await page.screenshot({ path: path.join(OUT, "standalone-er-panel-2026-09-14-to-12-13.png"), fullPage: true });
  ok("screenshot test/ui/out/standalone-er-panel-2026-09-14-to-12-13.png");
});

await openDoc(path.join(OUT, "share-2026-09-to-12.html"), "share page Sep-Dec 2026", async (page) => {
  const months = await page.$$eval("section.mo", els => els.map(e => e.getAttribute("data-month")));
  if (months.join(",") !== "2026-09,2026-10,2026-11,2026-12") fail("share months: " + months.join(",")); else ok("share page: 4 month sections " + months.join(","));
  const openColor = await rgb(page, '.cd[data-day="2026-10-15"] .open', "color");
  if (openColor !== "rgb(192, 64, 64)") fail("share 10/15 OPEN color " + openColor); else ok("share page: 10/15 P OPEN is red (" + openColor + ")");
  const wr = await page.$eval('table.wr[data-month="2026-09"] tr[data-week="2026-09-28"]', tr => tr.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
  if (!/9\/28-10\/4 Atwell/.test(wr) || !/9\/28-10\/4 Fierce/.test(wr)) fail("share week row 9/28: " + wr); else ok("share page week row: " + wr);
  const font = await page.$eval("body", el => getComputedStyle(el).fontFamily);
  if (!/Outfit/.test(font)) fail("share page font stack: " + font); else ok("share page font stack starts with Outfit: " + font.slice(0, 60));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (!wide) fail("share page scrolls horizontally at 1180px"); else ok("share page: no horizontal scroll at 1180px");
  await page.screenshot({ path: path.join(OUT, "standalone-share-2026-09-to-12.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const mobileOk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (!mobileOk) fail("share page scrolls horizontally at 390px (" + await page.evaluate(() => document.documentElement.scrollWidth) + "px wide)"); else ok("share page: no horizontal page scroll at 390px");
  await page.screenshot({ path: path.join(OUT, "standalone-share-mobile.png"), fullPage: false });
  ok("screenshots test/ui/out/standalone-share-2026-09-to-12.png, standalone-share-mobile.png");
});

await openDoc(path.join(OUT, "printable-2026-09-to-12.html"), "printable Sep-Dec 2026", async (page) => {
  const pages = await page.$$eval(".page", els => els.map(e => e.getAttribute("data-month")));
  if (pages.join(",") !== "2026-09,2026-10,2026-11,2026-12") fail("printable pages: " + pages.join(",")); else ok("printable: 4 pages " + pages.join(","));
  const openColor = await rgb(page, '.cell[data-day="2026-10-15"] .shift .open', "color");
  if (openColor !== "rgb(192, 0, 0)") fail("printable 10/15 OPEN color " + openColor); else ok("printable: 10/15 P OPEN is red (" + openColor + ")");
  const ext = await page.$eval('.cell[data-day="2026-10-01"] .shift .ext', el => el.textContent).catch(() => "");
  if (!/Atwell/.test(ext)) fail("printable 10/1 ext: " + ext); else ok("printable: 10/1 shows '" + ext + "'");
  const cell = await page.$eval('.cell[data-day="2026-09-14"]', el => el.innerText.replace(/\s+/g, " ").trim());
  if (!/P Burchett/.test(cell) || !/B Philip/.test(cell)) fail("printable 9/14 cell: " + cell); else ok("printable 9/14 cell: " + cell);
  const tb = await page.$eval(".toolbar button", el => el.textContent);
  if (tb !== "Print") fail("printable toolbar: " + tb); else ok("printable toolbar Print button present");
  await page.screenshot({ path: path.join(OUT, "standalone-printable-2026-09-to-12.png"), fullPage: true });
  ok("screenshot test/ui/out/standalone-printable-2026-09-to-12.png");
});

// Documents the smoke harness downloaded from the running app (when present).
await openDoc(path.join(OUT, "silvis-call-2026-10-01-2026-11-30.html"), "app-downloaded share page Oct-Nov", async (page) => {
  const months = await page.$$eval("section.mo", els => els.map(e => e.getAttribute("data-month")));
  if (months.join(",") !== "2026-10,2026-11") fail("downloaded share months: " + months.join(",")); else ok("downloaded share page: months " + months.join(","));
  const link = await page.$eval(".hd a", el => el.getAttribute("href")).catch(() => null);
  ok("downloaded share page live-app link: " + link);
});
await openDoc(path.join(OUT, "silvis-er-call-panels-2026-11-02-2026-12-13.html"), "app-downloaded ER panel 11/2-12/13", async (page) => {
  const n = await page.$$eval("table[data-export=er-call-panels] tbody tr", trs => trs.length);
  if (n !== 6) fail("downloaded ER panel rows: " + n); else ok("downloaded ER panel: 6 rows");
});

await browser.close();
console.log(failures.length ? `\nSTANDALONE FAILED: ${failures.length} problem(s)` : "\nSTANDALONE OK");
process.exit(failures.length ? 1 : 0);
