#!/usr/bin/env node
// scripts/ci-watched-paths.js - does any of the given repo paths match the
// `paths:` filter of .github/workflows/build.yml? Used by that workflow's
// commit-back step (audit T3, 9/23): when main moved while the run was queued
// or running, a move that touched a WATCHED path has its own queued run (the
// concurrency group serialises them) and owns the deploy; a move outside the
// filter (docs / sql / scripts only) queued nothing, so the running job rebuilds
// on top of it. The filter itself stays the single source of truth - nothing is
// duplicated here.
//
//   node scripts/ci-watched-paths.js <path> [<path> ...]
//   exit 0 = none watched (prints nothing), exit 1 = at least one watched (prints
//   them, one per line), exit 2 = usage error. -h / --help prints this usage.
//   Pure file I/O: reads the workflow file only.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const USAGE = "usage: node scripts/ci-watched-paths.js <repo path> [<repo path> ...]   (exit 0 none watched / 1 some watched / 2 usage)";

// The `- "..."` entries under `paths:` - the same walk test/ci.test.js pins.
function watchedGlobs(yml) {
  const L = String(yml).replace(/\r\n/g, "\n").split("\n");
  const i = L.findIndex(l => /^\s*paths:\s*$/.test(l));
  if (i < 0) return [];
  const ind = L[i].match(/^\s*/)[0].length;
  const out = [];
  for (let k = i + 1; k < L.length; k++) {
    const l = L[k];
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= ind) break;
    const m = l.match(/^\s*-\s*"([^"]+)"\s*(#.*)?$/);
    if (m) out.push(m[1]);
  }
  return out;
}

// GitHub's filter globs: `*` never crosses a `/`, `**` does; everything else is literal.
function globToRegExp(glob) {
  const src = String(glob).split("**").map(part => part.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp("^" + src + "$");
}

function watchedOf(paths, globs) {
  const res = globs.map(globToRegExp);
  return paths.map(p => String(p).replace(/\\/g, "/")).filter(p => res.some(r => r.test(p)));
}

function main(argv) {
  const paths = [];
  for (const t of argv) {
    if (t === "-h" || t === "--help") { console.log(USAGE); return 0; }
    if (/^--/.test(t)) { console.error("unknown argument: " + t + "\n" + USAGE); return 2; }
    if (t.trim()) paths.push(t.trim());
  }
  if (!paths.length) { console.error(USAGE); return 2; }
  const globs = watchedGlobs(fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8"));
  if (!globs.length) { console.error("ci-watched-paths: no `paths:` filter found in .github/workflows/build.yml"); return 2; }
  const hit = watchedOf(paths, globs);
  hit.forEach(p => console.log(p));
  return hit.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { watchedGlobs, globToRegExp, watchedOf, main };
