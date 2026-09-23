#!/usr/bin/env node
// scripts/preview-diff.js - compare two preview JSON files written by
// scripts/preview-generate.js and print a Markdown report (Prompt 12):
//   every day whose primary or backup changed, per-surgeon tallies before/after
//   (primary, backup, weekend days, REAL run lengths computed here from the
//   schedule - primary-only and any-role, no holiday-unit collapse), open slots
//   before/after, and the after-run's share-vs-allowed table when the
//   diagnostics carry it (diagnostics.impliedTargets, item J).
//
//   node scripts/preview-diff.js <before.json> <after.json> [--out docs/PREVIEW-DIFF-<date>.md] [--roster docs/silvis-seed.json]
//
// Pure file I/O: nothing here touches the network or the database.
"use strict";
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
function opt(name, dflt) { const i = argv.indexOf("--" + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; }
const files = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (files.length < 2) { console.error("usage: node scripts/preview-diff.js <before.json> <after.json> [--out file.md] [--roster docs/silvis-seed.json]"); process.exit(2); }
const REPO = path.join(__dirname, "..");
const before = JSON.parse(fs.readFileSync(files[0], "utf8"));
const after = JSON.parse(fs.readFileSync(files[1], "utf8"));
const rosterFile = opt("roster", path.join(REPO, "docs", "silvis-seed.json"));
const OUT = opt("out", null);

const roster = (JSON.parse(fs.readFileSync(rosterFile, "utf8")).roster || []).map(r => ({ id: r.id, name: r.name, code: r.code, type: r.type || "pool" }));
const nameOf = (id) => { if (!id) return "OPEN"; const r = roster.find(x => x.id === id); return r ? r.name : id; };

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const weekday = (s) => WD[((dayNum(s) + 3) % 7 + 7) % 7];
const isWeekend = (s) => ["Fri", "Sat", "Sun"].includes(weekday(s));
const md = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|");
const short = (s) => (+s.slice(5, 7)) + "/" + (+s.slice(8, 10));

const daysB = Object.keys(before.schedule || {}).sort();
const daysA = Object.keys(after.schedule || {}).sort();
const allDays = Array.from(new Set(daysB.concat(daysA))).sort();

// ---- per-day changes
const changes = [];
allDays.forEach(d => {
  const b = (before.schedule || {})[d] || {}, a = (after.schedule || {})[d] || {};
  ["primary", "backup"].forEach(role => {
    const bv = b[role] || (role === "primary" && b.externalCover ? "ext:" + b.externalCover : null);
    const av = a[role] || (role === "primary" && a.externalCover ? "ext:" + a.externalCover : null);
    if (bv !== av) changes.push({ day: d, role, from: bv, to: av, lockedAfter: !!a[role + "Locked"] });
  });
});

// ---- tallies computed here (independent of diagnostics)
function tallies(schedule, days) {
  const out = {};
  roster.forEach(r => { out[r.id] = { primary: 0, backup: 0, weekendDays: 0, maxRunPrimary: 0, maxRunAny: 0, runPrimaryFrom: null, runAnyFrom: null }; });
  const ids = roster.map(r => r.id);
  ids.forEach(id => {
    let runP = 0, runA = 0, startP = null, startA = null;
    days.forEach(d => {
      const e = schedule[d] || {};
      const isP = e.primary === id, isB = e.backup === id;
      const t = out[id];
      if (isP) t.primary++;
      if (isB) t.backup++;
      if ((isP || isB) && isWeekend(d)) t.weekendDays++;
      if (isP) { runP++; if (runP === 1) startP = d; if (runP > t.maxRunPrimary) { t.maxRunPrimary = runP; t.runPrimaryFrom = startP; } } else runP = 0;
      if (isP || isB) { runA++; if (runA === 1) startA = d; if (runA > t.maxRunAny) { t.maxRunAny = runA; t.runAnyFrom = startA; } } else runA = 0;
    });
  });
  return out;
}
const tB = tallies(before.schedule || {}, daysB), tA = tallies(after.schedule || {}, daysA);

// ---- open slots
function openSlots(p) {
  const out = [];
  Object.keys(p.schedule || {}).sort().forEach(d => {
    const e = p.schedule[d] || {};
    if (!e.primary && !e.externalCover) out.push({ day: d, role: "primary" });
    if (!e.backup) out.push({ day: d, role: "backup" });
  });
  return out;
}
const openB = openSlots(before), openA = openSlots(after);

// ---- report
const L = [];
L.push(`# Preview diff - ${path.basename(files[0])} -> ${path.basename(files[1])}`);
L.push("");
L.push(`*Written by scripts/preview-diff.js. Before: seed ${before.seed}, bestOf ${before.bestOf}, generated ${before.generatedAt}. After: seed ${after.seed}, bestOf ${after.bestOf}, generated ${after.generatedAt}. Range ${after.start} -> ${after.end}. Run lengths below are REAL consecutive calendar days computed from the schedule (no holiday-unit collapse).*`);
L.push("");
L.push("## Summary");
L.push("");
L.push(`| Metric | Before | After |`);
L.push(`|---|---|---|`);
L.push(`| Open primary days | ${openB.filter(o => o.role === "primary").length} | ${openA.filter(o => o.role === "primary").length} |`);
L.push(`| Open backup days | ${openB.filter(o => o.role === "backup").length} | ${openA.filter(o => o.role === "backup").length} |`);
const sb = (before.diagnostics && before.diagnostics.score) || {}, sa = (after.diagnostics && after.diagnostics.score) || {};
L.push(`| Hard violations (diagnostics) | ${sb.hardViolations == null ? "?" : sb.hardViolations} | ${sa.hardViolations == null ? "?" : sa.hardViolations} |`);
L.push(`| Soft penalty sum (diagnostics) | ${sb.softSum == null ? "?" : sb.softSum} | ${sa.softSum == null ? "?" : sa.softSum} |`);
L.push(`| Days whose primary changed | | ${changes.filter(c => c.role === "primary").length} |`);
L.push(`| Days whose backup changed | | ${changes.filter(c => c.role === "backup").length} |`);
L.push("");
L.push("## Per-surgeon tallies (whole range)");
L.push("");
L.push("| Surgeon | Primary before -> after | Backup before -> after | Weekend days | Longest primary run (from) | Longest any-role run (from) |");
L.push("|---|---|---|---|---|---|");
roster.forEach(r => {
  const b = tB[r.id], a = tA[r.id];
  L.push(`| ${md(r.name)}${r.type === "external" ? " (outside)" : ""} | ${b.primary} -> **${a.primary}** | ${b.backup} -> **${a.backup}** | ${b.weekendDays} -> ${a.weekendDays} | ${b.maxRunPrimary} -> **${a.maxRunPrimary}**${a.runPrimaryFrom ? " (" + short(a.runPrimaryFrom) + ")" : ""} | ${b.maxRunAny} -> **${a.maxRunAny}**${a.runAnyFrom ? " (" + short(a.runAnyFrom) + ")" : ""} |`);
});
L.push("");
// share vs allowed (item J diagnostics), when present
const it = after.diagnostics && after.diagnostics.impliedTargets;
if (it && it.months) {
  L.push("## Share vs allowed (after)");
  L.push("");
  L.push(`*${md(it.rule || "")}*`);
  L.push("");
  Object.keys(it.months).sort().forEach(m => {
    const I = it.months[m];
    L.push(`### ${m}`);
    L.push("");
    L.push("```");
    L.push(JSON.stringify(I, null, 1));
    L.push("```");
    L.push("");
  });
}
L.push("## Every day whose primary or backup changed");
L.push("");
if (!changes.length) L.push("_No day changed._");
else {
  L.push("| Day | Role | Before | After | Locked after |");
  L.push("|---|---|---|---|---|");
  changes.forEach(c => L.push(`| ${c.day} ${weekday(c.day)} | ${c.role} | ${md(nameOf(c.from))} | **${md(nameOf(c.to))}** | ${c.lockedAfter ? "yes" : ""} |`));
}
L.push("");
L.push("## Open slots after");
L.push("");
if (!openA.length) L.push("_None._");
else {
  openA.forEach(o => {
    const u = after.diagnostics && Array.isArray(after.diagnostics.uncovered) ? after.diagnostics.uncovered.find(x => x.day === o.day && x.role === o.role) : null;
    L.push(`- ${o.day} ${weekday(o.day)} ${o.role}` + (u ? ": " + Object.keys(u.reasons || {}).map(id => nameOf(id) + " " + (u.reasons[id] || []).join("+")).join("; ") : ""));
  });
}
L.push("");
L.push("## Open slots before");
L.push("");
if (!openB.length) L.push("_None._"); else openB.forEach(o => L.push(`- ${o.day} ${weekday(o.day)} ${o.role}`));
L.push("");
if (after.diagnostics && Array.isArray(after.diagnostics.warnings) && after.diagnostics.warnings.length) {
  L.push("## Generator warnings (after)");
  L.push("");
  after.diagnostics.warnings.forEach(w => L.push("- " + md(w)));
  L.push("");
}
const text = L.join("\n");
if (OUT) { fs.writeFileSync(OUT, text, "utf8"); console.log("wrote " + OUT + " (" + changes.length + " changed slots, " + openA.length + " open after)"); }
else process.stdout.write(text + "\n");
