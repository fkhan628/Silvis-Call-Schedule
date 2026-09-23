#!/usr/bin/env node
// Silvis - publish a generated preview from the command line (Prompt 12 PUB,
// 2026-09-23 overnight; Faraz 9/22 evening: "You can go ahead and deploy,
// publish and move forward without my go - just ensure it is accurate").
//
//   node scripts/publish-preview.js [--preview docs/PREVIEW-2026-11-02-to-2027-01-03.json]
//                                   [--dry-run | --apply --workdir <linked supabase dir>]
//                                   [--out <sql path>] [--report <md path>] [--force-app-edited]
//
// Mirrors the app's Setup -> Generate -> Accept & Publish path (index-source.html
// acceptPreview -> snapshots.capture("generate_publish") -> suMergePreview ->
// syncScheduleDays CAS writes -> logAudit("schedule.generate_accept")) SERVER
// SIDE, from the preview JSON scripts/preview-generate.js wrote, and proves what
// it did. It never sends or enqueues a notice of any kind: the app's publish
// dialog (office notice, in-app notice, mail) is a separate step Faraz takes
// later.
//
// --dry-run (default): reads the live rows with the PUBLIC anon key (as
//   scripts/preview-generate.js does), builds the plan, runs the preflight,
//   prints the plan (per-month insert / update / skip / refused counts, every
//   change as 'M/D P/B before -> after', the refused list, the preflight
//   result), writes the SQL next to the linked workdir (or the OS temp dir)
//   and a Markdown report beside it. Nothing is written to the database.
// --apply: same, then runs the SQL through
//   supabase db query --linked --workdir <dir> -f <abs sql path>
//   (service role, server side), re-reads schedule_days and VERIFIES: every
//   planned change present, versions incremented, the snapshot and the audit
//   row present (from the batch's own final select), a fresh plan reads zero
//   rows; prints per-surgeon per-month tallies of the final rows and writes
//   docs/PUBLISH-2026-09-23.md. Exit non-zero on any mismatch.
//
// PLAN (pure; test/publish.test.js drives it with synthetic live rows)
//   desired end state per day = the preview's assignment (backfill days from
//   .backfill.schedule, milestone days from .schedule; a day in both takes the
//   milestone's row only when identical, else ABORT).
//   per day and role:
//     locked live role (primary_locked / backup_locked with a holder) -> never
//       changed; the preview must hold the same holder, else ABORT.
//     live holder present, not locked, live source NOT import / generated /
//       east-derived (manual, trade, claim, ...) -> an app-edited slot: the
//       change is REFUSED and listed, the day skipped, the run continues
//       (--force-app-edited lifts this; not used tonight).
//     external_cover -> kept as is, never cleared or set (a preview primary over
//       a cover ABORTS).
//     otherwise a differing preview holder is a change: OPEN -> holder,
//       holder -> holder; holder -> OPEN only when the preview left the slot
//       open AND the live holder was generated (an import holder is never
//       cleared - refused and listed).
//   unchanged days are skipped (holders equal: a lock / source / note-only
//   difference is never written - a documented, conservative deviation from
//   the app's whole-body compare); a day with no live row and both roles open
//   in the preview is not inserted (listed open). The app's accidental-wipe
//   guard (helpers.scheduleWipeCheck) runs over live -> final: emptying more
//   than half of the populated primaries ABORTS.
// ROW SHAPE (mirrors helpers.assignmentToDayRow and the app's Accept & Publish)
//   source: the preview entry's source - generator.js genSeedLocks writes
//     `source: (fixedP || fixedB) ? (e.source || "import") : "generated"`, so a
//     day with a locked import slot keeps 'import' when its other role is
//     generated, a fully generated day is 'generated', a derived week with no
//     import lock is 'east-derived'; suMergePreview then copies the preview
//     entry wholesale (`Object.assign(emptyDayAssignment(), p)`). A live row
//     whose source is an app source (manual / trade / claim) and whose held
//     slots are all untouched keeps its own source (never downgraded).
//   primary_locked / backup_locked: a live lock with a holder stays (the app:
//     `if (respectLocks && cur.primaryLocked && (cur.primary || cur.externalCover)) ... a.primaryLocked = true`),
//     otherwise the preview's flag (generated slots unlocked; a derived-week
//     lock comes out locked, as genSnapshot writes it).
//   note: an existing live note is never overwritten (a differing preview note
//     is warned about); a new generated day gets the preview's note = null (the
//     generator carries only the input's note).
//   updated_by: the tool tag; version: compare-and-swap on the version the dry
//     run saw (UPDATE ... SET version = version + 1 WHERE day = X AND version = V,
//     one row or the whole DO block raises); INSERT with version 1 and
//     ON CONFLICT DO NOTHING + a row_count check.
// SQL: one transaction, one DO block: snapshot FIRST (reason 'generate_publish',
//   the app's string; created_by the tag; the same data shape as the app's
//   snapshots.capture and importer.js), then the CAS writes, a final written-rows
//   count guard, then one audit_log row shaped like the app's
//   'schedule.generate_accept' (actor_name the tag, note: published from the
//   command line on Faraz's authorisation). Any RAISE rolls everything back.
// PREFLIGHT (before any SQL): (a) preview.diagnostics.hardViolations empty and
//   the milestone's uncovered list empty (the backfill may leave slots open -
//   listed); (b) the rules ctx rebuilt as scripts/preview-generate.js builds it
//   (its ctx build is DUPLICATED here, line for line where it matters, because
//   that script is a top-level async runner with no exports) with the FINAL
//   schedule (live rows overlaid with the planned rows) and rules.eligibility
//   run for every placed slot of both ranges: a lock holder's conflicts are the
//   known locked facts (the preview's lockViolations), any other hard reason
//   ABORTS; a ctx the builder could not complete (no East id for an eastBlocks
//   surgeon) FAILS the preflight outright - never a silent PASS;
//   (c) every day of both ranges has a covered slot or is listed open;
//   (d) primary <> backup on every written row.
// --apply VERIFY: the batch's final SELECT (snapshot id, snapshots +1, audit id,
//   rows stamped at THIS run's timestamp), an anon re-read proving every planned
//   row (body, version, tag) AND every row outside the plan unchanged with the
//   total moved by exactly the inserts, then a fresh plan reading zero rows. A
//   re-read that throws after the batch was sent still writes the report and
//   exits 1 saying the batch may have committed.
//
// Exit codes: 0 ok / 1 error or not verified / 2 plan or preflight abort
// (no SQL is run). process.exitCode, not process.exit(): let the event loop
// drain after fetch() (see scripts/import-seed.js header).
// No email address or phone number is ever read, printed or written here.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));
const R = require(path.join(ROOT, "rules.js"));
const EF = require(path.join(ROOT, "east-feed.js"));
const IMP = require(path.join(ROOT, "importer.js"));

const TAG = "publish-preview (Faraz, 2026-09-23 overnight)";
const STANDARD_SOURCES = ["import", "generated", "east-derived"];
const SNAPSHOT_REASON = "generate_publish";          // index-source.html: snapshots.capture("generate_publish")
const AUDIT_ACTION = "schedule.generate_accept";     // index-source.html: logAudit("schedule.generate_accept", ...)
const AUTH_NOTE = "published from the command line on Faraz's authorisation of 2026-09-22 evening";
const ROLES = ["primary", "backup"];
const DEFAULT_PREVIEW = path.join(ROOT, "docs", "PREVIEW-2026-11-02-to-2027-01-03.json");
const DEFAULT_REPORT = path.join(ROOT, "docs", "PUBLISH-2026-09-23.md");

/* ------------------------------------------------------------- dates */

function dayNum(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000); }
function fromDayNum(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function addDays(s, k) { return fromDayNum(dayNum(s) + k); }
function weekdayMon0(s) { return ((dayNum(s) + 3) % 7 + 7) % 7; }   // 1970-01-01 was a Thursday: Mon=0 .. Sun=6
function listDays(start, end) { const out = []; for (let d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; }
function isIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

/* ------------------------------------------------------------ desired */

function normAssignment(a) {
  if (!a || typeof a !== "object") return H.emptyDayAssignment();
  return {
    primary: a.primary || null,
    backup: a.backup || null,
    primaryLocked: a.primaryLocked === true,
    backupLocked: a.backupLocked === true,
    source: a.source || null,
    externalCover: a.externalCover || null,
    note: (a.note === undefined || a.note === null || a.note === "") ? null : String(a.note)
  };
}

function describeAssignment(a) {
  return "P " + (a.primary || (a.externalCover ? a.externalCover + " (external)" : "OPEN")) + (a.primaryLocked ? "*" : "") +
    " / B " + (a.backup || "OPEN") + (a.backupLocked ? "*" : "");
}

// buildDesired(preview) -> { desired: { day: { assignment, range } }, ranges: [{name,start,end}] (by start),
//   days: every calendar day of the union, conflicts: [{ day, backfill, milestone }] }
function buildDesired(preview) {
  if (!preview || !isIso(preview.start) || !isIso(preview.end) || !preview.schedule || typeof preview.schedule !== "object") {
    throw new Error("preview: .start / .end / .schedule missing or malformed");
  }
  const desired = {}, ranges = [], conflicts = [];
  const bf = preview.backfill;
  if (bf) {
    if (!bf.range || !isIso(bf.range.start) || !isIso(bf.range.end) || !bf.schedule) throw new Error("preview.backfill: .range.start / .range.end / .schedule missing");
    ranges.push({ name: "backfill", start: bf.range.start, end: bf.range.end });
    Object.keys(bf.schedule).forEach((d) => {
      if (d < bf.range.start || d > bf.range.end) return;
      desired[d] = { assignment: normAssignment(bf.schedule[d]), range: "backfill" };
    });
  }
  ranges.push({ name: "milestone", start: preview.start, end: preview.end });
  Object.keys(preview.schedule).forEach((d) => {
    if (d < preview.start || d > preview.end) return;
    const a = normAssignment(preview.schedule[d]);
    if (desired[d] && !H.sameDayAssignment(d, desired[d].assignment, a)) conflicts.push({ day: d, backfill: desired[d].assignment, milestone: a });
    desired[d] = { assignment: a, range: "milestone" };
  });
  ranges.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  const daySet = new Set();
  ranges.forEach((r) => listDays(r.start, r.end).forEach((d) => daySet.add(d)));
  return { desired, ranges, days: Array.from(daySet).sort(), conflicts };
}

/* --------------------------------------------------------------- plan */

function liveLockHolds(LA, role) {
  if (role === "primary") return !!(LA.primaryLocked && (LA.primary || LA.externalCover));
  return !!(LA.backupLocked && LA.backup);
}

// planPublish(preview, liveRows, opts?) -> the plan (see header). Never throws
// for an expected abort: ok:false + aborts[] and no rows.
function planPublish(preview, liveRows, opts) {
  opts = opts || {};
  const force = !!opts.forceAppEdited;
  const built = buildDesired(preview);
  const out = {
    ok: true, aborts: [], warnings: [], rows: [], changes: [], refused: [], skipped: [], noInsert: [], openSlots: [],
    final: {}, byMonth: {}, ranges: built.ranges, days: built.days, desired: built.desired
  };
  built.conflicts.forEach((c) => out.aborts.push("overlap differs on " + c.day + ": backfill " + describeAssignment(c.backfill) + " vs milestone " + describeAssignment(c.milestone)));

  const live = {}, liveMap = {};
  (liveRows || []).forEach((r) => { if (r && r.day) live[String(r.day).slice(0, 10)] = r; });
  Object.keys(live).forEach((d) => { liveMap[d] = H.dayRowToAssignment(live[d]); out.final[d] = H.dayRowToAssignment(live[d]); });

  built.days.forEach((d) => {
    const month = d.slice(0, 7);
    const M = out.byMonth[month] = out.byMonth[month] || { insert: 0, update: 0, skip: 0, refused: 0, noInsert: 0, changes: 0 };
    const L = live[d] || null;
    const D = built.desired[d];
    const LA = L ? H.dayRowToAssignment(L) : H.emptyDayAssignment();
    if (!D) {
      out.warnings.push(d + ": in range but not in the preview - " + (L ? "left as it is" : "no live row either; the preflight will flag it unless listed open"));
      return;
    }
    const A = D.assignment;
    if (LA.externalCover && A.primary) { out.aborts.push(d + ": the preview places " + A.primary + " as primary over the external cover " + LA.externalCover + " - the tool never clears a cover"); return; }
    if (!L && A.externalCover) { out.aborts.push(d + ": the preview carries an external cover " + A.externalCover + " for a day with no live row - the tool never sets one"); return; }
    if (L && typeof L.version !== "number") { out.aborts.push(d + ": the live row has no numeric version - cannot compare-and-swap"); return; }

    const dayChanges = [], dayRefused = [];
    const finalHolder = { primary: LA.primary, backup: LA.backup };
    ROLES.forEach((role) => {
      const liveHolder = LA[role], want = A[role];
      if (liveLockHolds(LA, role)) {
        if (liveHolder && want !== liveHolder) out.aborts.push(d + " " + role + ": locked role differs - live " + liveHolder + " (locked), preview " + (want || "OPEN"));
        return;                                                          // a locked role is never changed
      }
      if (want === liveHolder) return;
      if (liveHolder) {
        const src = LA.source || null;
        if (STANDARD_SOURCES.indexOf(src) < 0 && !force) {
          dayRefused.push({ day: d, role, from: liveHolder, to: want, liveSource: src, updatedBy: (L && L.updated_by) || null,
            reason: "app-edited slot (source '" + (src || "") + "', updated_by '" + ((L && L.updated_by) || "") + "') - not overwritten" });
          return;
        }
        if (!want && src !== "generated") {
          dayRefused.push({ day: d, role, from: liveHolder, to: null, liveSource: src, updatedBy: (L && L.updated_by) || null,
            reason: "the preview left the slot open but the live holder is " + (src || "unsourced") + " - an import or manual holder is never cleared by the tool" });
          return;
        }
      }
      dayChanges.push({ day: d, role, from: liveHolder, to: want });
      finalHolder[role] = want;
    });

    if (dayRefused.length) {                                             // the whole day is skipped; the live row stands
      dayRefused.forEach((r) => out.refused.push(r));
      M.refused += dayRefused.length;
      if (!LA.primary && !LA.externalCover) out.openSlots.push({ day: d, role: "primary" });
      if (!LA.backup) out.openSlots.push({ day: d, role: "backup" });
      return;
    }
    if (!dayChanges.length) {
      if (L) { out.skipped.push(d); M.skip++; } else { out.noInsert.push(d); M.noInsert++; }
      if (!finalHolder.primary && !LA.externalCover) out.openSlots.push({ day: d, role: "primary" });
      if (!finalHolder.backup) out.openSlots.push({ day: d, role: "backup" });
      return;
    }
    if (finalHolder.primary && finalHolder.primary === finalHolder.backup) { out.aborts.push(d + ": primary and backup would both be " + finalHolder.primary + " (schedule_days_distinct_roles)"); return; }
    const liveAppSource = !!(L && LA.source && STANDARD_SOURCES.indexOf(LA.source) < 0);
    if (L && LA.note && A.note && A.note !== LA.note) out.warnings.push(d + ": the preview's note differs from the live note - the live note is kept");
    const row = {
      day: d,
      primary_id: finalHolder.primary || null,
      backup_id: finalHolder.backup || null,
      primary_locked: liveLockHolds(LA, "primary") || A.primaryLocked,
      backup_locked: liveLockHolds(LA, "backup") || A.backupLocked,
      source: liveAppSource ? LA.source : (A.source || "generated"),
      external_cover: L ? LA.externalCover : null,
      note: (L && LA.note) ? LA.note : (A.note || null)
    };
    const action = L ? "update" : "insert";
    out.rows.push({ day: d, action, seenVersion: L ? L.version : null, row, changes: dayChanges });
    M[action]++;
    M.changes += dayChanges.length;
    dayChanges.forEach((c) => out.changes.push(c));
    out.final[d] = H.dayRowToAssignment(row);
    if (!row.primary_id && !row.external_cover) out.openSlots.push({ day: d, role: "primary" });
    if (!row.backup_id) out.openSlots.push({ day: d, role: "backup" });
  });

  // the app's accidental-wipe guard (helpers.scheduleWipeCheck, the same predicate the sync path uses): even when
  // every single clear is allowed (generated holders the preview left open), emptying more than half of the
  // populated primaries is a wipe, never a publish
  const wipe = H.scheduleWipeCheck(liveMap, out.final);
  if (wipe.wipe) out.aborts.push("wipe guard: " + wipe.removed + " of " + wipe.baseline + " populated primaries would be emptied - refusing (helpers.scheduleWipeCheck)");
  out.wipeCheck = wipe;

  if (out.aborts.length) { out.ok = false; out.rows = []; out.changes = []; }
  out.rows.sort((x, y) => (x.day < y.day ? -1 : 1));
  return out;
}

// applyToLive(liveRows, plan) -> the rows as they must read after --apply
// (the simulation the test and the post-apply verification share).
function applyToLive(liveRows, plan) {
  const byDay = {};
  (liveRows || []).forEach((r) => { byDay[String(r.day).slice(0, 10)] = Object.assign({}, r); });
  const ts = new Date().toISOString();
  (plan.rows || []).forEach((p) => {
    const prev = byDay[p.day] || {};
    byDay[p.day] = Object.assign({}, prev, p.row, { version: p.action === "update" ? p.seenVersion + 1 : 1, updated_by: TAG, updated_at: ts });
  });
  return Object.keys(byDay).sort().map((d) => byDay[d]);
}

// verifyApplied(plan, afterRows) -> { ok, problems[] }: every planned row is on
// file with the planned body, the expected version and the tag.
function verifyApplied(plan, afterRows) {
  const after = {};
  (afterRows || []).forEach((r) => { after[String(r.day).slice(0, 10)] = r; });
  const problems = [];
  (plan.rows || []).forEach((p) => {
    const a = after[p.day];
    if (!a) { problems.push(p.day + ": no row after apply"); return; }
    const want = p.row, got = H.assignmentToDayRow(p.day, H.dayRowToAssignment(a));
    Object.keys(want).forEach((k) => { if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) problems.push(p.day + ": " + k + " is " + JSON.stringify(got[k]) + ", planned " + JSON.stringify(want[k])); });
    const expVersion = p.action === "update" ? p.seenVersion + 1 : 1;
    if (a.version !== expVersion) problems.push(p.day + ": version is " + a.version + ", expected " + expVersion);
    if (a.updated_by !== TAG) problems.push(p.day + ": updated_by is '" + a.updated_by + "', expected the tool tag");
  });
  return { ok: problems.length === 0, problems };
}

// verifyUntouched(beforeRows, afterRows, plan) -> { ok, problems[] }: every row
// OUTSIDE the plan reads byte-identical (assignment body, version, updated_by)
// to the pre-apply read, and the table total moved by exactly the inserts.
function verifyUntouched(beforeRows, afterRows, plan) {
  const planned = new Set((plan.rows || []).map((r) => r.day));
  const before = {}, after = {};
  (beforeRows || []).forEach((r) => { before[String(r.day).slice(0, 10)] = r; });
  (afterRows || []).forEach((r) => { after[String(r.day).slice(0, 10)] = r; });
  const problems = [];
  const body = (d, r) => JSON.stringify([H.assignmentToDayRow(d, H.dayRowToAssignment(r)), r.version, r.updated_by || null]);
  Object.keys(before).sort().forEach((d) => {
    if (planned.has(d)) return;
    if (!after[d]) { problems.push(d + ": row vanished (outside the plan)"); return; }
    if (body(d, before[d]) !== body(d, after[d])) problems.push(d + ": changed outside the plan (version " + before[d].version + " -> " + after[d].version + ", updated_by '" + (after[d].updated_by || "") + "')");
  });
  Object.keys(after).forEach((d) => { if (!before[d] && !planned.has(d)) problems.push(d + ": a row appeared outside the plan"); });
  const inserts = (plan.rows || []).filter((r) => r.action === "insert").length;
  const expected = Object.keys(before).length + inserts;
  if (Object.keys(after).length !== expected) problems.push("schedule_days total " + Object.keys(after).length + ", expected " + expected + " (" + Object.keys(before).length + " before + " + inserts + " insert(s))");
  return { ok: problems.length === 0, problems };
}

// tallies(final, roster, ranges) -> { "YYYY-MM": { <id>: { primary, backup } } } over the calendar days of the ranges.
function tallies(final, roster, ranges) {
  const out = {};
  const ids = (roster || []).map((r) => r.id);
  const seen = new Set();
  (ranges || []).forEach((r) => listDays(r.start, r.end).forEach((d) => {
    if (seen.has(d)) return; seen.add(d);
    const m = d.slice(0, 7);
    if (!out[m]) { out[m] = {}; ids.forEach((id) => { out[m][id] = { primary: 0, backup: 0 }; }); }
    const e = final[d];
    if (!e) return;
    ROLES.forEach((role) => { const id = e[role]; if (!id) return; if (!out[m][id]) out[m][id] = { primary: 0, backup: 0 }; out[m][id][role]++; });
  }));
  return out;
}

/* ---------------------------------------------------------- preflight */

// previewChecks(preview) -> (a): diagnostics gates. problems[] non-empty = fail.
function previewChecks(preview) {
  const dg = (preview && preview.diagnostics) || {};
  const bd = (preview && preview.backfill && preview.backfill.diagnostics) || {};
  const problems = [];
  const hv = dg.hardViolations || [], bhv = bd.hardViolations || [];
  if (hv.length) problems.push("milestone diagnostics.hardViolations: " + hv.length + " - " + JSON.stringify(hv).slice(0, 400));
  const milestoneOpen = (dg.uncovered || []).map((u) => ({ day: u.day, role: u.role }));
  if (milestoneOpen.length) problems.push("the milestone leaves " + milestoneOpen.length + " slot(s) open: " + milestoneOpen.map((o) => o.day + " " + o.role).join(", "));
  if (bhv.length) problems.push("backfill diagnostics.hardViolations: " + bhv.length + " - " + JSON.stringify(bhv).slice(0, 400));
  const backfillOpen = (bd.uncovered || []).map((u) => ({ day: u.day, role: u.role, reasons: u.reasons || {} }));
  const lockViolations = [].concat(dg.lockViolations || [], bd.lockViolations || []);
  return { ok: problems.length === 0, problems, milestoneOpen, backfillOpen, lockViolations, fixedViolations: [].concat(dg.fixedViolations || [], bd.fixedViolations || []) };
}

// generator.js genHoldsFullBlock, restated: the surgeon holds Fri+Sat+Sun in this role.
function holdsFullBlock(F, day, role, id) {
  const w = weekdayMon0(day);
  if (w < 4) return false;
  const fri = addDays(day, -(w - 4));
  for (let k = 0; k < 3; k++) { const e = F[addDays(fri, k)]; if (!e || e[role] !== id) return false; }
  return true;
}

// preflight(ctx, plan, ctxNotes?) -> (b)(c)(d) over plan.final for plan.days. ctx
// must have been built with schedule = plan.final (the caller does that).
// ctxNotes: what buildLiveContext could NOT put into the ctx (an eastBlocks
// surgeon without an East id, a failed roster resolve). Any note is FATAL: a
// ctx missing Khan's East busy days would evaluate every East day ok:true - a
// silent PASS, this codebase's signature failure class.
function preflight(ctx, plan, ctxNotes) {
  const res = { ok: true, hardRemaining: [], lockedFacts: [], missingDays: [], distinctRoleViolations: [], evaluated: 0, ctxNotes: (ctxNotes || []).slice() };
  const F = plan.final || {};
  const openSet = new Set((plan.openSlots || []).map((o) => o.day + "|" + o.role));
  (plan.days || []).forEach((d) => {
    const e = F[d] || null;
    ROLES.forEach((role) => {
      const holder = e ? e[role] : null;
      const covered = !!holder || (role === "primary" && !!(e && e.externalCover));
      if (!covered) { if (!openSet.has(d + "|" + role) && res.missingDays.indexOf(d) < 0) res.missingDays.push(d); return; }
      if (!holder) return;
      const r = R.eligibility(ctx, d, role, holder, { asBlockMember: holdsFullBlock(F, d, role, holder) });
      res.evaluated++;
      if (r.lockHolder && r.conflicts && r.conflicts.length) res.lockedFacts.push({ day: d, role, id: holder, conflicts: r.conflicts.slice() });
      if (!r.ok) res.hardRemaining.push({ day: d, role, id: holder, reasons: (r.hard || []).slice() });
    });
    if (e && e.primary && e.primary === e.backup) res.distinctRoleViolations.push(d);
  });
  res.ok = !res.hardRemaining.length && !res.missingDays.length && !res.distinctRoleViolations.length && !res.ctxNotes.length;
  return res;
}

/* ---------------------------------------------------------------- SQL */

const S = IMP.impSqlStr, B = IMP.impSqlBool, J = IMP.impSqlJson;

function auditDetail(plan, preview, opts) {
  const bf = preview.backfill && preview.backfill.range;
  const uncovered = ((preview.diagnostics && preview.diagnostics.uncovered) || []).length;
  const bUncovered = ((preview.backfill && preview.backfill.diagnostics && preview.backfill.diagnostics.uncovered) || []).length;
  const summary = "Accepted a generated schedule " + H.fmtMD(preview.start) + " - " + H.fmtMD(preview.end) + " (seed " + preview.seed + ", best of " + preview.bestOf + "): " +
    plan.changes.length + " slot change(s), " + uncovered + " open slot(s) - " + AUTH_NOTE +
    (bf ? "; backfill " + H.fmtMD(bf.start) + " - " + H.fmtMD(bf.end) + " (" + bUncovered + " open slot(s) left)" : "") +
    (plan.refused.length ? "; " + plan.refused.length + " app-edited slot(s) left alone" : "");
  return {
    summary,
    start: preview.start, end: preview.end, seed: String(preview.seed), bestOf: preview.bestOf, respectLocks: true,
    changes: plan.changes.length, uncovered, outcome: "ok", error: null,
    mode: "command-line", note: AUTH_NOTE, tool: "scripts/publish-preview.js", authorisedBy: "s1",
    previewFile: (opts && opts.previewFile) || null, previewGeneratedAt: preview.generatedAt || null,
    inserted: plan.rows.filter((r) => r.action === "insert").length, updated: plan.rows.filter((r) => r.action === "update").length,
    refused: plan.refused.length, refusedSlots: plan.refused.map((r) => r.day + " " + r.role + " " + (r.from || "OPEN") + " -> " + (r.to || "OPEN") + " (" + (r.liveSource || "") + ")"),
    backfill: bf ? { start: bf.start, end: bf.end, changes: plan.changes.filter((c) => c.day >= bf.start && c.day <= bf.end).length, uncovered: bUncovered } : null,
    milestone: { changes: plan.changes.filter((c) => c.day >= preview.start && c.day <= preview.end).length }
  };
}

// publishSql(plan, preview, opts) -> the batch, or null when there is nothing to write.
function publishSql(plan, preview, opts) {
  opts = opts || {};
  if (!plan || !plan.ok || !plan.rows.length) return null;
  const now = opts.now || new Date().toISOString();
  const updates = plan.rows.filter((r) => r.action === "update"), inserts = plan.rows.filter((r) => r.action === "insert");
  const L = [];
  L.push("-- Silvis publish-preview - generated " + now + " by scripts/publish-preview.js");
  L.push("-- preview " + (opts.previewFile || "?") + " (generatedAt " + (preview.generatedAt || "?") + ", seed " + preview.seed + ", bestOf " + preview.bestOf + ")");
  L.push("-- ranges " + plan.ranges.map((r) => r.name + " " + r.start + ".." + r.end).join("; ") + "; " + updates.length + " update(s), " + inserts.length + " insert(s), " + plan.refused.length + " refused slot(s) left alone");
  L.push("-- Mirrors the app's Accept & Publish (snapshot 'generate_publish' -> CAS writes -> audit 'schedule.generate_accept').");
  L.push("-- No office notice and no mail: the app's publish dialog does that later, by Faraz.");
  L.push("-- Atomic: one DO block - a snapshot failure, any CAS mismatch or insert conflict RAISEs and nothing persists.");
  L.push("-- The body uses a tagged dollar quote so a note or audit string containing a bare double-dollar cannot end it early.");
  L.push("begin;");
  L.push("do $pub$");
  L.push("declare");
  L.push("  v_snap uuid;");
  L.push("  v_before bigint;");
  L.push("  v_after bigint;");
  L.push("  v_days bigint;");
  L.push("  v_to bigint;");
  L.push("  v_av bigint;");
  L.push("  v_n integer;");
  L.push("  v_audit uuid;");
  L.push("begin");
  L.push("  -- 1. snapshot FIRST (the app's reason string; the same data shape as snapshots.capture and importer.js)");
  L.push("  select count(*) into v_before from public.call_schedule_snapshots;");
  L.push("  select count(*) into v_days from public.schedule_days;");
  L.push("  select count(*) into v_to from public.time_off;");
  L.push("  select count(*) into v_av from public.availability;");
  L.push("  insert into public.call_schedule_snapshots (reason, data, source_updated_at, created_by)");
  L.push("  select " + S(SNAPSHOT_REASON) + ",");
  L.push("         jsonb_build_object(");
  L.push("           'config',        (select data from public.call_schedule_data where id = 'main'),");
  L.push("           'schedule_days', (select coalesce(jsonb_agg(to_jsonb(s) order by s.day), '[]'::jsonb) from public.schedule_days s),");
  L.push("           'time_off',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.time_off t),");
  L.push("           'availability',  (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.availability a)),");
  L.push("         (select updated_at from public.call_schedule_data where id = 'main'),");
  L.push("         " + S(TAG));
  L.push("  returning id into v_snap;");
  L.push("  select count(*) into v_after from public.call_schedule_snapshots;");
  L.push("  if v_snap is null or v_after <> v_before + 1 then raise exception 'PUBLISH_ABORT: snapshot not captured (before %, after %)', v_before, v_after; end if;");
  L.push("");
  L.push("  -- 2. schedule_days: compare-and-swap on the version the dry run saw; one row per statement or the block raises");
  plan.rows.forEach((p) => {
    const r = p.row;
    L.push("  -- " + p.day + ": " + p.changes.map((c) => c.role + " " + (c.from || "OPEN") + " -> " + (c.to || "OPEN")).join(", "));
    if (p.action === "update") {
      L.push("  update public.schedule_days set");
      L.push("    primary_id = " + S(r.primary_id) + ", backup_id = " + S(r.backup_id) + ",");
      L.push("    primary_locked = " + B(r.primary_locked) + ", backup_locked = " + B(r.backup_locked) + ",");
      L.push("    source = " + S(r.source) + ", external_cover = " + S(r.external_cover) + ", note = " + S(r.note) + ",");
      L.push("    version = version + 1, updated_by = " + S(TAG) + ", updated_at = now()");
      L.push("  where day = " + S(p.day) + " and version = " + p.seenVersion + ";");
      L.push("  get diagnostics v_n = row_count;");
      L.push("  if v_n <> 1 then raise exception 'PUBLISH_CAS_MISMATCH: " + p.day + " expected version " + p.seenVersion + " - % row(s) matched; the row changed since the dry run', v_n; end if;");
    } else {
      L.push("  insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source, external_cover, note, version, updated_by)");
      L.push("  values (" + [S(p.day), S(r.primary_id), S(r.backup_id), B(r.primary_locked), B(r.backup_locked), S(r.source), S(r.external_cover), S(r.note), "1", S(TAG)].join(", ") + ")");
      L.push("  on conflict (day) do nothing;");
      L.push("  get diagnostics v_n = row_count;");
      L.push("  if v_n <> 1 then raise exception 'PUBLISH_INSERT_CONFLICT: " + p.day + " already exists - the table changed since the dry run'; end if;");
    }
  });
  L.push("");
  L.push("  -- 3. every planned row and nothing else carries this run's stamp (now() is the transaction's timestamp)");
  L.push("  select count(*) into v_n from public.schedule_days where updated_by = " + S(TAG) + " and updated_at = now();");
  L.push("  if v_n <> " + plan.rows.length + " then raise exception 'PUBLISH_ABORT: expected % row(s) written by this run, found %', " + plan.rows.length + ", v_n; end if;");
  L.push("");
  L.push("  -- 4. audit: the app's schedule.generate_accept shape (actor_name = the tool tag)");
  L.push("  insert into public.audit_log (actor_id, actor_name, action, detail)");
  L.push("  values (null, " + S(TAG) + ", " + S(AUDIT_ACTION) + ", " + J(auditDetail(plan, preview, opts)) +
    " || jsonb_build_object('snapshotId', v_snap, 'snapshotsBefore', v_before, 'snapshotsAfter', v_after, 'snapshot', jsonb_build_object('schedule_days', v_days, 'time_off', v_to, 'availability', v_av)))");
  L.push("  returning id into v_audit;");
  L.push("  if v_audit is null then raise exception 'PUBLISH_ABORT: audit row not written'; end if;");
  L.push("end $pub$;");
  L.push("commit;");
  L.push("-- what --apply verifies (the tag is a constant: days_by_tool is scoped to the LATEST run's stamp, never all-time)");
  L.push("select");
  L.push("  (select id from public.call_schedule_snapshots where created_by = " + S(TAG) + " and reason = " + S(SNAPSHOT_REASON) + " order by created_at desc limit 1) as snapshot_id,");
  L.push("  (select (detail ->> 'snapshotsBefore')::bigint from public.audit_log where actor_name = " + S(TAG) + " and action = " + S(AUDIT_ACTION) + " order by created_at desc limit 1) as snapshots_before,");
  L.push("  (select count(*) from public.call_schedule_snapshots) as snapshots_after,");
  L.push("  (select id from public.audit_log where actor_name = " + S(TAG) + " and action = " + S(AUDIT_ACTION) + " order by created_at desc limit 1) as audit_id,");
  L.push("  (select max(updated_at) from public.schedule_days where updated_by = " + S(TAG) + ") as stamped_at,");
  L.push("  (select count(*) from public.schedule_days where updated_by = " + S(TAG) + " and updated_at = (select max(updated_at) from public.schedule_days where updated_by = " + S(TAG) + ")) as days_by_tool,");
  L.push("  (select count(*) from public.schedule_days) as schedule_days;");
  L.push("");
  return L.join("\n");
}

/* ------------------------------------------------------------ render */

function renderPlan(plan, nameOf) {
  const L = [];
  L.push("ranges: " + plan.ranges.map((r) => r.name + " " + r.start + ".." + r.end).join("; ") + " (" + plan.days.length + " days)");
  Object.keys(plan.byMonth).sort().forEach((m) => {
    const c = plan.byMonth[m];
    L.push("  " + m + ": insert " + c.insert + ", update " + c.update + ", unchanged " + c.skip + ", no-insert (all open) " + c.noInsert + ", refused slot(s) " + c.refused + ", slot changes " + c.changes);
  });
  L.push("changes (" + plan.changes.length + "):");
  plan.changes.forEach((c) => L.push("  " + H.formatDayChange(c, nameOf)));
  L.push("refused (" + plan.refused.length + "):");
  plan.refused.forEach((r) => L.push("  " + H.fmtMD(r.day) + " " + (r.role === "primary" ? "P" : "B") + " " + H.holderLabel(r.from, nameOf) + " -> " + H.holderLabel(r.to, nameOf) + " [" + r.reason + "]"));
  L.push("open slots in the final state (" + plan.openSlots.length + "): " + (plan.openSlots.map((o) => H.fmtMD(o.day) + " " + (o.role === "primary" ? "P" : "B")).join(", ") || "none"));
  if (plan.noInsert.length) L.push("days with no live row and both roles open (not inserted): " + plan.noInsert.map(H.fmtMD).join(", "));
  if (plan.warnings.length) { L.push("warnings (" + plan.warnings.length + "):"); plan.warnings.forEach((w) => L.push("  " + w)); }
  if (plan.aborts.length) { L.push("ABORT (" + plan.aborts.length + "):"); plan.aborts.forEach((a) => L.push("  " + a)); }
  L.push("rows to write: " + plan.rows.length + " (" + plan.rows.filter((r) => r.action === "insert").length + " insert(s), " + plan.rows.filter((r) => r.action === "update").length + " update(s))");
  return L.join("\n");
}

function renderPreflight(pf, pc) {
  const L = [];
  L.push("preflight (a) preview diagnostics: " + (pc.ok ? "ok" : "FAIL") + (pc.problems.length ? " - " + pc.problems.join(" | ") : "") +
    "; milestone open " + pc.milestoneOpen.length + "; backfill open " + pc.backfillOpen.length + (pc.backfillOpen.length ? " (" + pc.backfillOpen.map((o) => o.day + " " + o.role).join(", ") + ")" : "") +
    "; known locked facts from the preview " + pc.lockViolations.length);
  if (!pf) { L.push("preflight (b)-(d): not run"); return L.join("\n"); }
  if (pf.ctxNotes && pf.ctxNotes.length) { L.push("preflight ctx: FAIL - the rules ctx is incomplete, (b) cannot be trusted:"); pf.ctxNotes.forEach((n) => L.push("  ctx note: " + n)); }
  L.push("preflight (b) eligibility over the final schedule: " + pf.evaluated + " slot(s) evaluated; hard reasons remaining " + pf.hardRemaining.length + "; locked facts " + pf.lockedFacts.length);
  pf.lockedFacts.forEach((f) => L.push("  locked fact: " + f.day + " " + f.role + " " + f.id + " - " + f.conflicts.join(", ")));
  pf.hardRemaining.forEach((h) => L.push("  HARD: " + h.day + " " + h.role + " " + h.id + " - " + h.reasons.join(", ")));
  L.push("preflight (c) coverage: " + (pf.missingDays.length ? "FAIL - uncovered and not listed open: " + pf.missingDays.join(", ") : "ok"));
  L.push("preflight (d) distinct roles: " + (pf.distinctRoleViolations.length ? "FAIL - " + pf.distinctRoleViolations.join(", ") : "ok"));
  L.push("preflight result: " + (pf.ok && pc.ok ? "PASS" : "FAIL"));
  return L.join("\n");
}

function renderTallies(tl, roster) {
  const L = [];
  L.push("| Month | Surgeon | Primary | Backup | Total |");
  L.push("|---|---|---|---|---|");
  Object.keys(tl).sort().forEach((m) => (roster || []).forEach((r) => { const t = tl[m][r.id] || { primary: 0, backup: 0 }; L.push("| " + m + " | " + r.name + " | " + t.primary + " | " + t.backup + " | " + (t.primary + t.backup) + " |"); }));
  return L.join("\n");
}

// renderReport({ plan, preview, roster, mode, previewFile, preflight, previewChecks, apply? }) -> Markdown (operational wording only).
function renderReport(input) {
  const { plan, preview, roster, mode, previewFile, previewChecks: pc, apply } = input;
  const nameOf = (id) => { const r = (roster || []).find((x) => x.id === id); return r ? r.name : (id == null ? "OPEN" : id); };
  const L = [];
  L.push("# Publish " + plan.ranges.map((r) => r.start + " -> " + r.end).join(" and ") + " (" + mode + ")");
  L.push("");
  L.push("*" + (mode === "apply" ? "Published" : "Dry run, nothing written") + " " + new Date().toISOString() + " by scripts/publish-preview.js from " + previewFile + " (generatedAt " + (preview.generatedAt || "?") + ", seed " + preview.seed + ", bestOf " + preview.bestOf + "). " +
    "Mirrors the app's Accept & Publish; no office notice and no mail were sent - the app's publish dialog does that later. " + AUTH_NOTE + ".*");
  L.push("");
  L.push("## Counts per month");
  L.push("");
  L.push("| Month | Insert | Update | Unchanged | No insert (all open) | Refused slots | Slot changes |");
  L.push("|---|---|---|---|---|---|---|");
  Object.keys(plan.byMonth).sort().forEach((m) => { const c = plan.byMonth[m]; L.push("| " + m + " | " + c.insert + " | " + c.update + " | " + c.skip + " | " + c.noInsert + " | " + c.refused + " | " + c.changes + " |"); });
  L.push("");
  L.push("## Changes (" + plan.changes.length + ")");
  L.push("");
  const groups = H.describePublishDiff(plan.changes, nameOf);
  if (!groups.length) L.push("None."); else groups.forEach((g) => { L.push("**" + g.label + "**"); L.push(""); g.lines.forEach((l) => L.push("- " + l)); L.push(""); });
  L.push("## Refused (app-edited slots left alone) (" + plan.refused.length + ")");
  L.push("");
  if (!plan.refused.length) L.push("None."); else plan.refused.forEach((r) => L.push("- " + H.fmtMD(r.day) + " " + r.role + " " + H.holderLabel(r.from, nameOf) + " -> " + H.holderLabel(r.to, nameOf) + " - " + r.reason));
  L.push("");
  L.push("## Open slots remaining (" + plan.openSlots.length + ")");
  L.push("");
  if (!plan.openSlots.length) L.push("None."); else plan.openSlots.forEach((o) => L.push("- " + o.day + " " + o.role));
  L.push("");
  if (plan.warnings.length) { L.push("## Warnings"); L.push(""); plan.warnings.forEach((w) => L.push("- " + w)); L.push(""); }
  if (plan.aborts.length) { L.push("## ABORTED"); L.push(""); plan.aborts.forEach((a) => L.push("- " + a)); L.push(""); }
  L.push("## Preflight");
  L.push("");
  L.push("```");
  L.push(renderPreflight(input.preflight, pc || previewChecks(preview)));
  L.push("```");
  L.push("");
  L.push("## Per-surgeon tallies of the final rows (both ranges)");
  L.push("");
  L.push(renderTallies(tallies(plan.final, roster, plan.ranges), roster));
  L.push("");
  if (apply) {
    L.push("## Apply verification");
    L.push("");
    L.push("- snapshot id: " + (apply.snapshot_id || "?") + " (snapshots " + (apply.snapshots_before == null ? "?" : apply.snapshots_before) + " -> " + (apply.snapshots_after == null ? "?" : apply.snapshots_after) + ")");
    L.push("- audit id: " + (apply.audit_id || "?") + " (" + AUDIT_ACTION + ")");
    L.push("- rows stamped by the tool: " + (apply.days_by_tool == null ? "?" : apply.days_by_tool) + " of " + plan.rows.length + " planned; schedule_days total " + (apply.schedule_days == null ? "?" : apply.schedule_days));
    L.push("- re-read: " + (apply.verify && apply.verify.ok ? "every planned row on file with its version incremented; every row outside the plan unchanged; the total moved by exactly the inserts" : "PROBLEMS - " + ((apply.verify && apply.verify.problems) || []).join("; ")));
    L.push("- fresh plan after apply: " + (apply.replanRows === 0 ? "zero rows" : apply.replanRows + " row(s) still pending"));
    L.push("- result: " + (apply.ok ? "VERIFIED" : "NOT VERIFIED - see above"));
    L.push("");
  }
  return L.join("\n");
}

/* ------------------------------------------------------ live context */

function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const url = (src.match(/const\s+SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
  const key = (src.match(/const\s+SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error("could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js");
  return { url, key };
}

// Every read distinguishes failure from empty: a non-2xx throws. Pages by 1000.
async function fetchAll(cfg, table, query) {
  const page = 1000;
  let out = [];
  for (let offset = 0; ; offset += page) {
    const url = cfg.url + "/rest/v1/" + table + "?" + query + "&limit=" + page + "&offset=" + offset;
    const res = await fetch(url, { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } });
    if (!res.ok) throw new Error("REST " + res.status + " reading " + table + ": " + (await res.text()).slice(0, 300));
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("REST read of " + table + " did not return an array");
    out = out.concat(rows);
    if (rows.length < page) break;
  }
  return out;
}

// The seven anon-readable sources scripts/preview-generate.js reads.
async function fetchLive(cfg) {
  const [blobRows, dayRows, timeOffRows, availabilityRows, feedRows, forecastRows, overrideRows] = await Promise.all([
    fetchAll(cfg, "call_schedule_data", "id=eq.main&select=data,updated_at"),
    fetchAll(cfg, "schedule_days", "select=*&order=day.asc"),
    fetchAll(cfg, "time_off", "select=*&order=start_date.asc"),
    fetchAll(cfg, "availability", "select=*&order=start_date.asc"),
    fetchAll(cfg, "east_feed", "select=week_monday,data,fetched_at&order=week_monday.asc"),
    fetchAll(cfg, "east_forecast", "select=week_monday,data,generated_at&order=week_monday.asc"),
    fetchAll(cfg, "east_overrides", "select=*")
  ]);
  return { blob: (blobRows[0] && blobRows[0].data) || {}, blobUpdatedAt: blobRows[0] ? blobRows[0].updated_at : null, dayRows, timeOffRows, availabilityRows, feedRows, forecastRows, overrideRows };
}

// buildLiveContext(live, schedule, range) -> { ctx, notes[] }: the ctx build of
// scripts/preview-generate.js, duplicated faithfully (that script is a top-level
// runner with no exports), with `schedule` = the FINAL map and the union range.
async function buildLiveContext(live, schedule, range) {
  const notes = [];
  const blob = live.blob || {};
  const roster = blob.roster || [];
  const surgeonRules = blob.surgeonRules || {};
  const groupRules = blob.groupRules || {};
  const holidays = blob.holidays || { units: {} };
  if (!roster.length || !Object.keys(surgeonRules).length) throw new Error("blob has no roster/surgeonRules - run the seed import first");
  const weeks = live.feedRows.map((r) => ({ weekMonday: r.week_monday, data: r.data }));
  const eastFeedCoverage = EF.coverageOf ? EF.coverageOf(weeks) : null;
  const forecastAll = typeof EF.forecastFromFeedRows === "function" ? EF.forecastFromFeedRows(live.forecastRows.map((r) => ({ weekMonday: r.week_monday, data: r.data }))) : {};
  const forecast = typeof EF.forecastOutsideCoverage === "function" ? EF.forecastOutsideCoverage(forecastAll, eastFeedCoverage) : forecastAll;
  const eastOverrides = typeof EF.overridesByPerson === "function" ? EF.overridesByPerson(live.overrideRows) : {};
  const fakIdEast = (live.forecastRows[0] && live.forecastRows[0].data && live.forecastRows[0].data.fakId) || null;
  const eastBusyDays = {}, eastForecast = {}, eastDerived = [];
  for (const s of roster) {
    const ef = (surgeonRules[s.id] || {}).eastFeed || {};
    if (!ef.enabled) continue;
    if (ef.eastBlocksPrimary || ef.eastBlocksBackup) {
      let eastId = s.code === "FAK" ? fakIdEast : null;
      if (!eastId) {   // resolve by code from the Davenport roster (read-only), exactly as preview-generate.js does
        try { const feed = await EF.fetchEastWeeks("2026-09-28", "2026-09-28"); eastId = EF.eastResolveFakId ? EF.eastResolveFakId(feed.roster, s.code) : (feed.roster.find((r) => r.name === s.code) || {}).id; }
        catch (e) { notes.push("East roster resolve failed for " + s.code + ": " + e.message); }
      }
      if (eastId) {
        const d = EF.deriveKhanBusyDays(weeks, eastId, { eastBackupCountsAsBusy: ef.eastBackupCountsAsBusy !== false });
        eastBusyDays[s.id] = EF.applyOverrides ? EF.applyOverrides(d.busy, live.overrideRows, s.id) : d.busy;
      } else notes.push("no East id for " + s.code + " - his East busy days are NOT in the ctx");
      if (ef.forecast) eastForecast[s.id] = forecast;
    }
    if (ef.deriveFrom || ef.statedWeeks) {
      for (const w of EF.deriveFierceWeeks(weeks, { deriveFrom: ef.deriveFrom, statedWeeks: ef.statedWeeks })) eastDerived.push({ weekMonday: w.weekMonday, surgeonId: s.id, silvisRole: w.silvisRole, source: w.source });
    }
  }
  const input = { roster, surgeonRules, groupRules, holidays, timeOffRows: live.timeOffRows, availabilityRows: live.availabilityRows, schedule, eastBusyDays, eastForecast, eastOverrides, eastFeedCoverage, eastDerived, rangeStart: range.start, rangeEnd: range.end };
  const ctx = R.buildContext(input);
  return { ctx, notes, eastFeedCoverage, eastDerived };
}

/* --------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const a = { preview: DEFAULT_PREVIEW, mode: "dry-run", workdir: process.env.SILVIS_SUPABASE_WORKDIR || null, out: null, report: null, forceAppEdited: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.mode = "dry-run";
    else if (t === "--apply") a.mode = "apply";
    else if (t === "--preview") a.preview = path.resolve(argv[++i]);
    else if (t === "--workdir") a.workdir = argv[++i];
    else if (t === "--out") a.out = path.resolve(argv[++i]);
    else if (t === "--report") a.report = path.resolve(argv[++i]);
    else if (t === "--force-app-edited") a.forceAppEdited = true;
    else if (t === "-h" || t === "--help") { usage(); process.exit(0); }
    else { console.error("unknown argument: " + t); usage(); process.exit(1); }
  }
  const scratchDir = a.workdir ? path.dirname(path.resolve(a.workdir)) : os.tmpdir();
  if (!a.out) a.out = path.join(scratchDir, a.workdir ? "publish-preview.sql" : "silvis-publish-preview.sql");
  if (!a.report) a.report = a.mode === "apply" ? DEFAULT_REPORT : path.join(scratchDir, "silvis-publish-preview-report.md");
  return a;
}

function usage() {
  console.log("usage: node scripts/publish-preview.js [--preview docs/PREVIEW-....json] [--dry-run | --apply --workdir <linked dir>] [--out <sql path>] [--report <md path>] [--force-app-edited]");
}

function q(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

// Runs the batch through the linked CLI; returns the parsed rows of the final
// select (an array of objects, an object with .rows, or null when unparseable).
function runSupabase(workdir, sqlPath) {
  const cmd = ["supabase", "db", "query", "--linked", "--workdir", q(workdir), "-o", "json", "-f", q(sqlPath)].join(" ");
  console.log("\n$ " + cmd);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const outText = (r.stdout || "") + (r.stderr || "");
  const cleaned = outText.split(/\r?\n/).filter((l) => !/new version of Supabase CLI|recommend updating regularly/.test(l)).join("\n");
  console.log(cleaned.trim());
  if (r.status !== 0) throw new Error("supabase db query exited with status " + r.status);
  const rows = parseCliRows(r.stdout || "");
  if (!rows) console.error("could not parse the CLI's final select; the trailing stdout was:\n" + (r.stdout || "").slice(-400));
  return rows;
}

// The `-o json` shape of `supabase db query` was never observed here, so the
// parse starts from the END of stdout: the trailing block of lines that parses
// as JSON wins (an array of rows, { rows: [...] } or one bare row object), so
// any bracketed chatter earlier in the output cannot break it. null when no
// trailing block parses - --apply then exits 1 with the snapshot / audit part
// marked unverified (never a false VERIFIED).
function parseCliRows(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines.slice(i).join("\n").trim();
    if (!/^[\[{]/.test(text)) continue;
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) return j;
      if (j && Array.isArray(j.rows)) return j.rows;
      if (j && typeof j === "object") return [j];
    } catch (e) { /* the block starts earlier, or never parses */ }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preview = JSON.parse(fs.readFileSync(args.preview, "utf8"));
  const previewFile = path.relative(ROOT, args.preview).replace(/\\/g, "/");
  const cfg = readConfig();
  console.log("Silvis publish-preview - " + args.mode + " - " + previewFile + " (generatedAt " + preview.generatedAt + ", seed " + preview.seed + ", bestOf " + preview.bestOf + ")");
  console.log("project " + cfg.url + " (anon read)");

  const pc = previewChecks(preview);
  const live = await fetchLive(cfg);
  const roster = live.blob.roster || [];
  const nameOf = (id) => { const r = roster.find((x) => x.id === id); return r ? r.name : (id == null ? "OPEN" : id); };
  console.log("live rows: schedule_days " + live.dayRows.length + ", time_off " + live.timeOffRows.length + ", availability " + live.availabilityRows.length + ", east_feed " + live.feedRows.length + ", east_forecast " + live.forecastRows.length + ", east_overrides " + live.overrideRows.length + "; blob updated " + live.blobUpdatedAt);

  const plan = planPublish(preview, live.dayRows, { forceAppEdited: args.forceAppEdited });
  console.log("\n--- plan ---");
  console.log(renderPlan(plan, nameOf));

  const union = { start: plan.ranges[0].start, end: plan.ranges[plan.ranges.length - 1].end };
  let pf = null, ctxInfo = null;
  if (plan.ok) {
    ctxInfo = await buildLiveContext(live, plan.final, union);
    ctxInfo.notes.forEach((n) => console.log("ctx note: " + n));
    if (ctxInfo.ctx.warnings && ctxInfo.ctx.warnings.length) ctxInfo.ctx.warnings.forEach((w) => console.log("ctx warning: " + w));
    console.log("ctx: East coverage " + (ctxInfo.eastFeedCoverage ? ctxInfo.eastFeedCoverage.from + ".." + ctxInfo.eastFeedCoverage.to : "none") + "; derived weeks " + (ctxInfo.eastDerived.map((d) => d.weekMonday + ":" + d.silvisRole).join(", ") || "none"));
    pf = preflight(ctxInfo.ctx, plan, ctxInfo.notes);           // a ctx note is fatal (an incomplete ctx cannot prove anything)
    if (ctxInfo.notes.length) console.error("PREFLIGHT ABORT: the rules ctx is incomplete - " + ctxInfo.notes.join("; "));
  }
  console.log("\n--- preflight ---");
  console.log(renderPreflight(pf, pc));

  const sql = publishSql(plan, preview, { previewFile });
  if (sql) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, sql, "utf8");
    console.log("\nSQL written: " + args.out + " (" + sql.length + " bytes)");
  } else console.log("\nno SQL: " + (plan.ok ? "nothing to write - the live rows already match the preview" : "the plan aborted"));

  const gatesOk = plan.ok && pc.ok && !!pf && pf.ok;
  const writeReport = (apply) => {
    fs.mkdirSync(path.dirname(args.report), { recursive: true });
    fs.writeFileSync(args.report, renderReport({ plan, preview, roster, mode: args.mode, previewFile, preflight: pf, previewChecks: pc, apply }), "utf8");
    console.log("report written: " + args.report);
  };

  if (args.mode !== "apply") {
    writeReport(null);
    if (!gatesOk) { console.error("\ndry-run: the plan or the preflight FAILED - --apply would refuse (exit 2)."); return 2; }
    console.log("\ndry-run: " + plan.rows.length + " row(s) would be written (" + plan.changes.length + " slot change(s)); " + plan.refused.length + " refused slot(s) left alone; preflight PASS. Nothing was written.");
    return 0;
  }

  if (!gatesOk) { console.error("\nREFUSING TO APPLY: the plan or the preflight failed (see above)."); writeReport(null); return 2; }
  if (!args.workdir) { console.error("--apply needs --workdir <linked supabase dir> (or SILVIS_SUPABASE_WORKDIR)"); return 1; }
  if (!sql) { console.log("nothing to apply - the live rows already match the preview."); writeReport(null); return 0; }

  const rows = runSupabase(path.resolve(args.workdir), args.out);
  const result = (rows && rows[0]) || null;
  const apply = Object.assign({ ok: false, verify: null, replanRows: null }, result || {});
  const problems = [];
  if (!result) problems.push("could not parse the CLI's final select - snapshot / audit ids unverified (run the final SELECT of " + args.out + " by hand)");
  else {
    if (!result.snapshot_id) problems.push("snapshot_id is empty");
    if (!result.audit_id) problems.push("audit_id is empty");
    if (result.snapshots_before != null && result.snapshots_after != null && Number(result.snapshots_after) !== Number(result.snapshots_before) + 1) problems.push("snapshot count did not move by exactly one (" + result.snapshots_before + " -> " + result.snapshots_after + ")");
    if (Number(result.days_by_tool) !== plan.rows.length) problems.push("rows stamped by the tool: " + result.days_by_tool + ", planned " + plan.rows.length);
  }

  // The batch has been SENT. From here every failure must still leave a report and say so: a re-read that throws
  // (a network blip after the commit) is not a failed publish, it is an unverified one.
  let after, verify, untouched, replan;
  try {
    after = await fetchLive(cfg);
    verify = verifyApplied(plan, after.dayRows);
    untouched = verifyUntouched(live.dayRows, after.dayRows, plan);
    replan = planPublish(preview, after.dayRows, { forceAppEdited: args.forceAppEdited });
  } catch (e) {
    problems.push("the batch was SENT and may have committed; the post-apply re-read failed: " + (e && e.message || e) + " - re-run the dry run, it must read zero rows");
    apply.verify = { ok: false, problems: problems.slice() };
    apply.ok = false;
    console.error("\nPOST-APPLY RE-READ FAILED (the batch was sent): " + (e && e.stack || e));
    writeReport(apply);
    console.error("\nNOT VERIFIED:"); problems.forEach((p) => console.error("  " + p));
    return 1;
  }
  apply.verify = { ok: verify.ok && untouched.ok, problems: verify.problems.concat(untouched.problems) };
  verify.problems.forEach((p) => problems.push(p));
  untouched.problems.forEach((p) => problems.push(p));
  apply.replanRows = replan.rows.length;
  if (!replan.ok) problems.push("re-plan aborted: " + replan.aborts.join("; "));
  if (replan.rows.length) problems.push("a fresh plan still wants " + replan.rows.length + " row(s): " + replan.rows.map((r) => r.day).join(", "));
  apply.ok = problems.length === 0;

  console.log("\n--- verification ---");
  console.log("snapshot id " + (apply.snapshot_id || "?") + "; snapshots " + (apply.snapshots_before == null ? "?" : apply.snapshots_before) + " -> " + (apply.snapshots_after == null ? "?" : apply.snapshots_after) + "; audit id " + (apply.audit_id || "?") + "; rows stamped at " + (apply.stamped_at || "?") + ": " + (apply.days_by_tool == null ? "?" : apply.days_by_tool) + "/" + plan.rows.length);
  console.log("re-read: " + (verify.ok ? "every planned row on file, versions incremented" : "PROBLEMS") + "; outside the plan: " + (untouched.ok ? "untouched, total " + after.dayRows.length : "PROBLEMS"));
  console.log("fresh plan: " + replan.rows.length + " row(s)");
  const finalMap = {}; after.dayRows.forEach((r) => { finalMap[String(r.day).slice(0, 10)] = H.dayRowToAssignment(r); });
  console.log("\nper-surgeon per-month tallies of the final rows:");
  console.log(renderTallies(tallies(finalMap, roster, plan.ranges), roster));
  plan.final = finalMap;
  writeReport(apply);
  if (problems.length) { console.error("\nNOT VERIFIED:"); problems.forEach((p) => console.error("  " + p)); return 1; }
  console.log("\nVERIFIED: the preview is published; " + plan.rows.length + " row(s), " + plan.changes.length + " slot change(s); " + plan.refused.length + " refused slot(s) left alone. No notice was sent - open the app's publish dialog for that.");
  return 0;
}

module.exports = {
  TAG, STANDARD_SOURCES, SNAPSHOT_REASON, AUDIT_ACTION, AUTH_NOTE,
  buildDesired, planPublish, applyToLive, verifyApplied, verifyUntouched, tallies,
  previewChecks, preflight, holdsFullBlock,
  publishSql, auditDetail, renderPlan, renderPreflight, renderReport, renderTallies,
  fetchLive, buildLiveContext, parseCliRows
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code || 0; }, (e) => { console.error("ERROR: " + (e && e.stack || e)); process.exitCode = 1; });
}
