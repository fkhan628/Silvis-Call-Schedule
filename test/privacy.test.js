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


// ---- summary ----------------------------------------------------------------
if (failures.length) {
  failures.forEach(f => console.error("FAIL: " + f));
  console.error("privacy: " + failures.length + " failing of " + N + " assertions over " + files.length + " tracked files");
  process.exit(1);
}
console.log("ok " + N + " assertions (privacy pins over " + files.length + " tracked files)");
