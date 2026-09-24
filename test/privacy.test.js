// Silvis - repo privacy pins (Prompt 16 A6). Plain Node asserts, no framework.
//   node test/privacy.test.js
//
// The repo is public. This suite scans EVERY tracked text file (index.html and
// this file included) and pins that none carries a developer machine path, a
// session id or a developer user name (A6b), nor a hospital staff name, a roster
// middle initial, an email-thread subject line, a statement about another
// project's vacation-table readability or a personal vacation range (A6c).
//
// Nothing here names what was removed: the pins are either SHAPES (a drive
// path, a uuid, "First M. Last", a quoted subject in _meta.sources, a sentence
// that pairs the other project with its vacation table and a readability word)
// or SALTED SHA-256 DIGESTS of single tokens (the user name, the staff names),
// compared token by token. Fail-closed: any hit exits 1 and prints file:line
// and the label of the pin that matched.

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"]);

let N = 0;
const failures = [];
function ok(cond, msg) { N++; if (!cond) failures.push(msg); }

// ---- tracked files: git ls-files, else a directory walk (same exclusions) ----
function trackedFiles() {
  try {
    const out = cp.execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
    const list = out.split("\0").filter(Boolean);
    if (list.length) return list;
  } catch (e) { /* no git on this machine - walk */ }
  const acc = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "out") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else acc.push(path.relative(ROOT, p).replace(/\\/g, "/"));
    }
  })(ROOT);
  return acc;
}
const files = trackedFiles().filter(f => !SKIP_EXT.has(path.extname(f).toLowerCase()) && fs.existsSync(path.join(ROOT, f)));
ok(files.length > 50, "expected the tracked file list, got " + files.length + " files");
ok(["index-source.html", "index.html", "docs/silvis-seed.json", "CLAUDE.md", "config.js", "test/privacy.test.js"].every(f => files.includes(f)),
  "the scan must cover the JSX source, the compiled index.html, the seed, CLAUDE.md, config.js and this suite");

const texts = {};
files.forEach(f => { texts[f] = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"); });

// scan(patterns, opts) -> ["file:line  <label>"] for every line matching a pattern
// (and, when given, p.also on the same line, and not p.unless)
function scan(patterns, opts) {
  const hits = [];
  const only = opts && opts.files;
  for (const f of files) {
    if (only && !only(f)) continue;
    const lines = texts[f].split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        if (p.re.test(lines[i]) && (!p.also || p.also.test(lines[i])) && !(p.unless && p.unless.test(lines[i]))) { hits.push(f + ":" + (i + 1) + "  <" + p.label + ">"); break; }
      }
    }
  }
  return hits;
}
function report(section, hits) {
  ok(hits.length === 0, section + ": " + hits.length + " hit(s)\n    " + hits.slice(0, 25).join("\n    ") + (hits.length > 25 ? "\n    ... " + (hits.length - 25) + " more" : ""));
}

// ---- salted token digests: a token is refused when sha256(SALT + token) is
// listed. Tokens are runs of letters; the comparison is exact-case unless the
// caller normalises.
const SALT = "silvis-privacy:";
const digest = t => crypto.createHash("sha256").update(SALT + t).digest("hex");
function tokenHits(digests, label, normalise) {
  const want = new Set(digests);
  const seen = new Map();          // token -> refused?
  const hits = [];
  for (const f of files) {
    const lines = texts[f].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const toks = lines[i].match(/[A-Za-z]+/g);
      if (!toks) continue;
      for (const raw of toks) {
        const t = normalise ? normalise(raw) : raw;
        let bad = seen.get(t);
        if (bad === undefined) { bad = want.has(digest(t)); seen.set(t, bad); }
        if (bad) { hits.push(f + ":" + (i + 1) + "  <" + label + ">"); break; }
      }
    }
  }
  return hits;
}

// ---- A6b: no machine path, session id or developer user name --------------
const A6B = [
  { label: "absolute drive path under a user profile", re: /\b[A-Za-z]:[\\/]+Users[\\/]/ },
  { label: "user-profile path segment", re: /(^|[^A-Za-z0-9])Users[\\/]+[A-Za-z0-9._-]+[\\/]/ },
  { label: "OneDrive documents path", re: new RegExp("OneDrive[\\\\/]+Documents", "i") },
  { label: "tool session folder", re: new RegExp("\\bC--" + "Users-") },
  // a uuid is a session id unless the line says what it is (a snapshot / audit / probe id in a report)
  { label: "uuid (session id)", re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, unless: /snapshot|audit|00000000-0000|TID\d=|probe/i },
];
report("A6b machine paths / session id", scan(A6B));
// the developer's Windows user name, case-insensitively, as a whole token
report("A6b developer user name", tokenHits(["53ada671a653da48d791f65003e83c8f10326bbca9c7f6058640ae549aecfa0a"], "developer user name", t => t.toLowerCase()));

// >>> A6c
// ---- A6c: no staff name, roster middle initial, email subject, other-project
// vacation-table disclosure or personal vacation range ------------------------
// Staff names: exact-case tokens (Capitalised and UPPER forms). A lower-case
// token is not scanned: the seed's source keys are importer-pinned slugs that
// live in published rows too (renaming one is a live-row change, Faraz's call).
report("A6c hospital staff names (roles only in a public repo)", tokenHits([
  "7bb046abb261ff52b4b87ba1f3ceb6c3a081f7b437f91d014cd9f2f209e6fc1f", "e5b2c8579c2537d753272ac52e08e2f894d7a0439e7254e2fc5c005134c65244",
  "ea6688791b5f619bb7381f57698173f20d50eb5b7df822d3c3415518db498310", "ed2a5e35556edb9d4694aa3080888ba901c96cc1795180b0226172f1a477e452",
  "c56f22c62e3a708d3f32cb2b958ec7571828378e37134471bb6beee5bf808af9", "ee51b60bfb90830271253d8fae0c6f3cd9d5e2489859bf09bbed9ed391b9c774",
  "907e45b5d832fcd8ca18c056b91079a9c3a95eb2f7bd3e5bc1bdd438f9380802", "4623b559615faa4fa44a6412f0184a84f3c2aaf3c89cbae196b1f959b6793b68",
  "cf1e4b613986781992ff99a7c1b120e412a007cf5a0b1f64b677b510c4c44d47", "5b7e5cc8c743e78355d8f20081fce3f2b1d6e6b6d5935b40536a58a95c694989",
  "3392364c4b70a24cf7037515b1d6589a34bc21331e2874a74306cf7edfb835cc", "0467fa7edd5a90263f16dd4dd1e4f4ab42eae98971d502ab2f8715aaa405f8e8",
], "staff name"));
// B10 (9/23): the lower-case form is scanned too since the ER-panel source slug became a role slug
// (office-er-call-panels-<date>; the live notes are updated by hand with the same replace). Two lower-case
// digests are on file (the slug's former tokens); every token of every file is compared lower-cased against them.
report("A6c hospital staff names, lower case (slugs, notes, ids)", tokenHits([
  "276b38da40a0f91d22d21753df65b89c4418aad3fc7f08f4249eef84148b7643", "300c38dc2890012c22f94f23796b5f36e915644b75346725debfcc0f08b203a4",
], "staff name (lower case)", t => t.toLowerCase()));
// and a shape pin on the seed's source slugs: a role or a roster last name, never a person outside the roster
{
  const seedForSlugs = JSON.parse(texts["docs/silvis-seed.json"]);
  const SLUG_OK = /^(office-er-call-panels-\d{4}-\d{2}-\d{2}|burchett-(email|via-faraz)-\d{4}-\d{2}-\d{2}|faraz-\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?|fierce-\d{4}-\d{2}-\d{2}-[a-z-]+|email-relay|Faraz \d+\/\d+.*|Fierce via Faraz \d+\/\d+)$/;
  const badSlugs = (seedForSlugs.existingAssignments || []).map(a => a.source).filter((s, i, a) => a.indexOf(s) === i).filter(s => !SLUG_OK.test(String(s)));
  ok(badSlugs.length === 0, "seed existingAssignments[].source must be a role slug or a roster-name slug; unexpected: " + JSON.stringify(badSlugs));
  ok((seedForSlugs.existingAssignments || []).some(a => /^office-er-call-panels-2026-09-(16|22)$/.test(a.source)), "the ER-panel rows carry the role slug office-er-call-panels-<date>");
}

// roster fullName = first + last (or empty), never a middle initial or a title:
// the seed, config.js's INIT roster (six entries) and every fullName literal
const seed = JSON.parse(texts["docs/silvis-seed.json"]);
ok(Array.isArray(seed.roster) && seed.roster.length >= 6, "seed roster present");
const plainName = fn => !/\./.test(fn) && fn.trim().split(/\s+/).filter(Boolean).length <= 2;
seed.roster.forEach(r => ok(plainName(String(r.fullName || "")), "seed roster " + r.id + " fullName must be first + last (or empty), got " + JSON.stringify(r.fullName)));
const cfgNames = (texts["config.js"].match(/fullName:"([^"]*)"/g) || []).map(m => m.slice(10, -1));
ok(cfgNames.length === 6, "config.js INIT roster carries six fullName literals, found " + cfgNames.length);
cfgNames.forEach(fn => ok(plainName(fn), "config.js INIT roster fullName must be first + last (or empty), got " + JSON.stringify(fn)));
report("A6c fullName with a middle initial or title", scan([{ label: "fullName literal with an initial / title", re: /fullName["']?\s*[:=]\s*["'][^"']*\b[A-Z][a-z]?\.\s/ }]));

// _meta.sources: neutral source keys with a role-level description, never an email-thread subject
(seed._meta && seed._meta.sources || []).forEach((s, i) => ok(!/^Email/.test(s) && !/'[^']{3,}'/.test(s), "seed _meta.sources[" + i + "] must be a neutral source key, not an email subject: " + s));

// Another project's vacation table is not this repo's to describe: no sentence
// may pair the Davenport project with its time_off / vacations and a STATEMENT
// about who can read it (the READ words below). A statement about one of
// Silvis's OWN tables (east_feed, ...) in the same sentence is design
// documentation and passes; so does "reads X with the public key" (the East
// feed's documented read path). Sentence-based, so a wrapped passage is caught
// too; a run-on over 600 chars is split by line.
const READ = /anon-?readable|readable (by|with|to)\b|\b(is|are|was|were) readable|anyone (holding|with)|\bexpos(e|es|ed|ure)\b/ig;
const OWN_TABLE = /\b(east_feed|schedule_days|call_schedule_data|availability|client_versions|call_schedule_snapshots|east_forecast|silvis)\b/i;
function readabilityStatement(s) {
  READ.lastIndex = 0;
  let m;
  while ((m = READ.exec(s))) { if (!OWN_TABLE.test(s.slice(Math.max(0, m.index - 40), m.index))) return true; }
  return false;
}
function sentenceHits(test, label) {
  const hits = [];
  const boundary = /\.\s+|\n\s*\n|\|/g;
  for (const f of files) {
    const text = texts[f];
    let start = 0, m;
    const segs = [];
    while ((m = boundary.exec(text))) { segs.push([start, text.slice(start, m.index)]); start = m.index + m[0].length; }
    segs.push([start, text.slice(start)]);
    for (const [at, s] of segs) {
      const parts = s.length > 600 ? s.split("\n").map((l, i, arr) => [at + arr.slice(0, i).join("\n").length + (i ? 1 : 0), l]) : [[at, s]];
      for (const [a, p] of parts) if (test(p)) hits.push(f + ":" + (text.slice(0, a).split("\n").length) + "  <" + label + ">");
    }
  }
  return hits;
}
report("A6c other project's vacation-table disclosure", sentenceHits(s => /\bdavenport\b|\bDSG\b/i.test(s) && /\b(time[ _-]?off|vacations?)\b/i.test(s) && readabilityStatement(s), "davenport vacation table + readability statement"));

// personal vacation ranges from the East mirror: a doc / fixture line that
// names the Davenport / East side, a numeric date range, a vacation word AND a
// personal marker (his / your / FAK / Khan's). Docs say "your Davenport ranges";
// tests and fixtures use synthetic ranges; a UI example without a person passes.
const RANGE = /(\b\d{1,2}\/\d{1,2}\s*(–|-|to)\s*\d{1,2}\/\d{1,2}\b|\b20\d\d-\d\d-\d\d\s*(\.\.|–|-|to)\s*\d)/;
const PERSONAL_EAST = /^(?=[^]*(davenport|east vacation|east mirror|east feed))(?=[^]*\b(vacations?|away|home)\b)(?=[^]*(\b(his|your|FAK('s)?|Khan's)( own)?( Davenport| East)? (vacations?|ranges?)\b|\b(person's|his|your) own East vacation))/i;
report("A6c personal East vacation ranges", scan([{ label: "personal range on the East side", re: RANGE, also: PERSONAL_EAST }], { files: f => /\.(md|json)$/.test(f) }));
// <<< A6c

// ---- summary ----------------------------------------------------------------
if (failures.length) {
  failures.forEach(f => console.error("FAIL: " + f));
  console.error("privacy: " + failures.length + " failing of " + N + " assertions over " + files.length + " tracked files");
  process.exit(1);
}
console.log("ok " + N + " assertions (privacy pins over " + files.length + " tracked files)");
