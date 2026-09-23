#!/usr/bin/env node
/*
 * DSG Call Schedule — build step (committed; run by CI and reproducible locally).
 *
 * Transpiles the single <script type="text/babel"> block in index-source.html
 * into plain React.createElement JS and writes index.html. Everything else in
 * the HTML is copied byte-for-byte.
 *
 * Hard rules (these are the ones that have broken the app before):
 *   - Classic JSX runtime (global React UMD). NOT automatic react/jsx-runtime.
 *   - development:false (no __self/__source debug props).
 *   - preset-env targeting Safari 11.
 *   - The transpiled body must contain ZERO injected `import` statements.
 *   - No automatic-runtime artifacts (jsx-runtime / _jsx).
 * If any gate fails, the build exits non-zero and writes nothing — so a bad
 * build can never be deployed.
 *
 * Usage: node build.js [sourceFile] [outFile]
 *        defaults: index-source.html -> index.html
 */
const fs = require("fs");
const babel = require("@babel/core");

const SRC = process.argv[2] || "index-source.html";
const OUT = process.argv[3] || "index.html";

// ── Mojibake gate ───────────────────────────────────────────────────────
// Twice now a PowerShell 5.1 text round-trip has double-encoded a source
// file's UTF-8 (em-dashes/checkmarks corrupted). A blanket non-ASCII check
// can't work — this source legitimately carries thousands of non-ASCII
// characters (em-dashes, box-drawing rules, arrows, emoji) — but the three
// corruption signatures below never occur here legitimately. The needles
// are built from code points so this file never contains them literally
// and can be scanned like everything else.
const seq = (...cps) => String.fromCharCode(...cps);
const MOJIBAKE = [
  ["a-circumflex + euro (U+00E2 U+20AC)", seq(0xE2, 0x20AC)],   // UTF-8 punctuation read as cp1252
  ["replacement-char triplet (U+00EF U+00BF U+00BD)", seq(0xEF, 0xBF, 0xBD)],
  ["A-circumflex + space (U+00C2 U+0020)", seq(0xC2, 0x20)],    // NBSP second-byte artifact
];
// Sweep EVERY tracked text file (git ls-files minus binary extensions), not
// an allowlist: with a list, a newly tracked file isn't covered until someone
// remembers to add its name; with the sweep it's covered the moment it's
// committed. Fail-closed — if enumeration fails, an empty scan must not pass
// silently as "no mojibake".
const SCAN = (() => {
  try {
    const out = require("child_process").execSync("git ls-files", { encoding: "utf8" });
    const BINARY = /\.(png|jpg|jpeg|gif|ico|webp|svg|woff2?|ttf|eot|otf|pdf|zip|mp3|mp4)$/i;
    const files = out.split("\n").map(s => s.trim()).filter(Boolean).filter(f => !BINARY.test(f));
    if (files.length === 0) throw new Error("git ls-files returned no files");
    return files;
  } catch (e) {
    console.error("FAIL: mojibake sweep could not enumerate tracked files: " + (e && e.message ? e.message : e));
    process.exit(1);
  }
})();
{
  const hits = [];
  for (const f of SCAN) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const [label, needle] of MOJIBAKE) {
      let idx = text.indexOf(needle);
      while (idx !== -1) {
        const line = text.slice(0, idx).split("\n").length;
        hits.push(`${f}:${line} — ${label}`);
        idx = text.indexOf(needle, idx + 1);
      }
    }
  }
  if (hits.length) {
    console.error("FAIL: mojibake byte sequences in tracked source (a text round-trip corrupted UTF-8):");
    hits.forEach(h => console.error("  " + h));
    console.error("Restore the affected file(s) from git and redo the edit with a UTF-8-safe tool.");
    process.exit(1);
  }
}

const html = fs.readFileSync(SRC, "utf8");

// Locate the babel block (tolerant of attribute spacing).
const OPEN = /<script\s+type=["']text\/babel["']\s*>/i;
const openMatch = html.match(OPEN);
if (!openMatch) {
  console.error('FAIL: no <script type="text/babel"> block found in ' + SRC);
  process.exit(1);
}
const openTag = openMatch[0];
const openIdx = openMatch.index;
const bodyStart = openIdx + openTag.length;
const closeIdx = html.indexOf("</script>", bodyStart);
if (closeIdx === -1) {
  console.error("FAIL: babel block has no closing </script>");
  process.exit(1);
}

const before = html.slice(0, openIdx);
const jsx = html.slice(bodyStart, closeIdx);
const after = html.slice(closeIdx + "</script>".length);

if (OPEN.test(after)) {
  console.error("FAIL: more than one text/babel block — build assumes exactly one.");
  process.exit(1);
}

let result;
try {
  result = babel.transformSync(jsx, {
    babelrc: false,
    configFile: false,
    compact: false,
    comments: false,
    presets: [
      ["@babel/preset-env", { targets: { safari: "11" }, modules: false }],
      ["@babel/preset-react", { runtime: "classic", development: false }],
    ],
  });
} catch (e) {
  console.error("FAIL: Babel transform threw:\n" + (e && e.message ? e.message : e));
  process.exit(1);
}

const code = result.code;
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

// Gate 1: no injected imports in the transpiled body.
const importLines = code.split("\n").filter((l) => /^\s*import[\s{]/.test(l));
if (importLines.length) fail("transpiled body contains import statements:\n" + importLines.join("\n"));

// Gate 2: classic runtime actually used; no automatic-runtime artifacts.
if (!code.includes("React.createElement")) fail("no React.createElement in output — JSX did not transpile.");
if (code.includes("react/jsx-runtime") || code.includes("_jsxRuntime") || /\b_jsx\b/.test(code)) {
  fail("automatic runtime artifacts present (jsx-runtime/_jsx).");
}

let out = before + '<script type="text/javascript">\n' + code + "\n  </script>" + after;

// Gate 3 (Prompt 16 B8): the Content-Security-Policy meta. script-src is a hash
// list - the sha256 of every inline <script> this page carries (the APP_VERSION
// script, the module loader, the transpiled app) replaces the
// __CSP_SCRIPT_HASHES__ token in the source's meta, so no 'unsafe-inline' is
// needed and an injected inline script is refused by the browser. A hash is
// taken over the exact text between the tags (what the browser hashes), so it
// is computed on the OUTPUT, after the transpile. The count is pinned: a new
// inline script is a deliberate change (add it here and in test/ci.test.js).
// No remote script may remain: the three libraries are vendored (vendor/README.md).
const CSP_TOKEN = "__CSP_SCRIPT_HASHES__";
const INLINE_SCRIPTS_EXPECTED = 3;
const cspMetaRe = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/;
if (!cspMetaRe.test(out)) fail("no <meta http-equiv=\"Content-Security-Policy\"> in " + SRC);
if (out.split(CSP_TOKEN).length !== 2) fail("the CSP meta must carry the " + CSP_TOKEN + " token exactly once (found " + (out.split(CSP_TOKEN).length - 1) + ")");
const scriptTags = Array.from(out.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g));
const remote = scriptTags.filter((m) => /\bsrc\s*=\s*["']https?:\/\//i.test(m[1]));
if (remote.length) fail("remote <script src> in the page (libraries are vendored under vendor/):\n" + remote.map((m) => m[0].slice(0, 120)).join("\n"));
const inlineBodies = scriptTags.filter((m) => !/\bsrc\s*=/.test(m[1])).map((m) => m[2]);
if (inlineBodies.length !== INLINE_SCRIPTS_EXPECTED) fail("expected exactly " + INLINE_SCRIPTS_EXPECTED + " inline <script> blocks (APP_VERSION, loader, app), found " + inlineBodies.length);
const hashes = inlineBodies.map((s) => "'sha256-" + require("crypto").createHash("sha256").update(s, "utf8").digest("base64") + "'");
out = out.replace(CSP_TOKEN, hashes.join(" "));
if (out.includes(CSP_TOKEN)) fail("the CSP token survived the replacement");
const emittedCsp = (out.match(cspMetaRe) || [])[1] || "";
if (!/(^|;)\s*script-src 'self' 'sha256-/.test(emittedCsp)) fail("the emitted script-src does not read `'self' 'sha256-...'`: " + emittedCsp.slice(0, 200));
if (/'unsafe-inline'[^;]*$/.test(emittedCsp.split(";").find((d) => /^\s*script-src/.test(d)) || "")) fail("script-src must not carry 'unsafe-inline'");

fs.writeFileSync(OUT, out, "utf8");

const ver = (html.match(/var APP_VERSION = "([^"]+)"/) || [])[1] || "unknown";
const ceCount = (code.match(/React\.createElement/g) || []).length;
console.log("OK  build complete");
console.log("    APP_VERSION         : " + ver);
console.log("    createElement calls : " + ceCount);
console.log("    injected imports    : 0");
console.log("    inline script hashes: " + hashes.length + " (" + hashes.map((h) => h.slice(8, 20) + "...").join(", ") + ")");
console.log("    " + SRC + " -> " + OUT + "  (" + out.length.toLocaleString() + " bytes)");
