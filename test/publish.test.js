// Silvis - publish-preview tests (Prompt 12 PUB, 2026-09-23 overnight).
// Drives the PURE plan / preflight / SQL functions of scripts/publish-preview.js
// against SYNTHETIC live rows (test/fixtures/publish-synthetic-2026-10.json)
// and a synthetic rules ctx built from docs/silvis-seed.json. No network, no
// database, no file written outside the scratch of this process.
// Plain Node asserts like the other suites; exits 1 on the first failure and
// prints 'ok <n> assertions' on success. Wired into `npm test` before the
// regression and into .github/workflows/build.yml.
//
// Sections
//   A  buildDesired: both ranges, an overlap that differs aborts, identical is fine
//   B  planPublish on the fixture: locked untouched, open filled, holder changes
//      only for generated / import-unlocked, app-edited (manual/trade/claim)
//      refused and listed, external_cover untouched, unchanged skipped,
//      holder -> OPEN only for a generated holder, no insert for an all-open new day
//   C  aborts: a differing locked holder, primary == backup, a preview primary
//      over an external cover
//   D  row shape: source / lock / note / external_cover semantics mirror the app
//   E  SQL pins: snapshot first + 'generate_publish', CAS WHERE version, the
//      RAISE guard, the audit row, no notifications table, no mail
//   F  preflight on a synthetic ctx: a hard violation is caught; a clean final passes
//   G  idempotence: planning against the post-apply state yields zero rows
//   H  the real preview file: shape, no overlap, preview checks pass
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..");
const t0 = Date.now();
let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }
function eq(a, b, msg) { n++; assert.deepStrictEqual(a, b, msg); }
function step(name) { console.log("- " + name); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const PUB = require(path.join(REPO, "scripts", "publish-preview.js"));
const R = require(path.join(REPO, "rules.js"));
const SA = require(path.join(__dirname, "seed-adapter.js"));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "publish-synthetic-2026-10.json"), "utf8"));
const seed = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "silvis-seed.json"), "utf8"));
const nameOf = (id) => { const r = FX.roster.find(x => x.id === id); return r ? r.name : (id == null ? "OPEN" : id); };
const TAG = PUB.TAG;

/* ------------------------------------------------------------------ A */
step("A: buildDesired - both ranges, overlap rules");
{
  const d = PUB.buildDesired(FX.preview);
  eq(d.days.length, 14, "7 backfill + 7 milestone days");
  eq(d.days[0], "2026-10-05"); eq(d.days[13], "2026-10-18");
  eq(d.conflicts, [], "no overlap in the fixture");
  eq(d.desired["2026-10-05"].range, "backfill"); eq(d.desired["2026-10-12"].range, "milestone");
  eq(d.ranges.map(r => r.name + ":" + r.start + ".." + r.end), ["backfill:2026-10-05..2026-10-11", "milestone:2026-10-12..2026-10-18"]);
  // identical overlap: the milestone row wins silently
  const p2 = clone(FX.preview);
  p2.backfill.schedule["2026-10-12"] = clone(p2.schedule["2026-10-12"]);
  p2.backfill.range.end = "2026-10-12";
  const d2 = PUB.buildDesired(p2);
  eq(d2.conflicts, [], "identical overlap is not a conflict");
  eq(d2.desired["2026-10-12"].range, "milestone", "the milestone row is taken");
  // differing overlap: listed, and planPublish aborts on it
  const p3 = clone(p2);
  p3.backfill.schedule["2026-10-12"].backup = "s5";
  const d3 = PUB.buildDesired(p3);
  eq(d3.conflicts.map(c => c.day), ["2026-10-12"], "a differing overlap day is listed");
  const plan3 = PUB.planPublish(p3, FX.live);
  ok(!plan3.ok && plan3.aborts.some(a => /overlap/.test(a) && /2026-10-12/.test(a)), "planPublish aborts on a differing overlap: " + JSON.stringify(plan3.aborts));
  eq(plan3.rows, [], "an aborted plan carries no rows");
}

/* ------------------------------------------------------------------ B */
step("B: planPublish on the fixture");
const plan = PUB.planPublish(FX.preview, FX.live);
{
  ok(plan.ok, "the fixture plan is not aborted: " + JSON.stringify(plan.aborts));
  eq(plan.aborts, []);
  const byDay = {}; plan.rows.forEach(r => { byDay[r.day] = r; });
  // locked roles untouched
  ok(!byDay["2026-10-06"], "10/6 (both locked, identical) is not written");
  ok(plan.skipped.includes("2026-10-06"), "10/6 is listed as unchanged");
  // open filled on a locked-primary import day -> update with CAS on the seen version
  ok(byDay["2026-10-05"] && byDay["2026-10-05"].action === "update", "10/5: update");
  eq(byDay["2026-10-05"].seenVersion, 1);
  eq(byDay["2026-10-05"].changes, [{ day: "2026-10-05", role: "backup", from: null, to: "s5" }], "10/5 B OPEN -> Fierce");
  eq(byDay["2026-10-05"].row.primary_id, "s3", "the locked primary holder is kept");
  eq(byDay["2026-10-05"].row.primary_locked, true, "the lock is kept");
  eq(byDay["2026-10-05"].row.backup_locked, false, "the generated backup is unlocked");
  // holder -> holder on an import-unlocked slot is a change
  eq(byDay["2026-10-07"].changes, [{ day: "2026-10-07", role: "backup", from: "s1", to: "s2" }], "10/7 B Khan -> Burchett (import, unlocked)");
  eq(byDay["2026-10-07"].row.primary_id, "s4");
  // app-edited (manual) slot: refused, the day skipped, the run continues
  ok(!byDay["2026-10-08"], "10/8 (manual primary would change) is not written");
  const r8 = plan.refused.filter(x => x.day === "2026-10-08");
  eq(r8.map(x => x.role + ":" + x.from + "->" + x.to + ":" + x.liveSource), ["primary:s2->s3:manual"], "10/8 refusal lists the manual slot");
  // trade
  ok(!byDay["2026-10-17"], "10/17 (trade primary would change) is not written");
  eq(plan.refused.filter(x => x.day === "2026-10-17").map(x => x.liveSource), ["trade"]);
  // claim holder unchanged, open backup filled: allowed, source preserved
  ok(byDay["2026-10-18"] && byDay["2026-10-18"].action === "update", "10/18: the claim holder stays, the open backup is filled");
  eq(byDay["2026-10-18"].changes, [{ day: "2026-10-18", role: "backup", from: null, to: "s3" }]);
  eq(byDay["2026-10-18"].row.source, "claim", "an app source is preserved when its held slot is untouched");
  eq(byDay["2026-10-18"].row.primary_id, "s6");
  // external cover untouched
  ok(!byDay["2026-10-09"], "10/9 (external cover, locked backup, identical) is not written");
  ok(plan.skipped.includes("2026-10-09"));
  // holder -> OPEN allowed for a generated holder when the preview left it open
  eq(byDay["2026-10-10"].changes, [{ day: "2026-10-10", role: "primary", from: "s2", to: null }], "10/10 P Burchett -> OPEN (generated, preview open)");
  eq(byDay["2026-10-10"].row.primary_id, null); eq(byDay["2026-10-10"].row.backup_id, "s1");
  eq(byDay["2026-10-10"].seenVersion, 4);
  // holder -> OPEN refused for an import holder (never cleared), the whole day skipped
  ok(!byDay["2026-10-11"], "10/11 (import primary -> OPEN) is not written");
  const r11 = plan.refused.filter(x => x.day === "2026-10-11");
  eq(r11.map(x => x.role + ":" + x.from + "->" + x.to), ["primary:s2->null"], "10/11 refusal names the cleared import holder");
  ok(/never cleared|import/.test(r11[0].reason), "reason wording: " + r11[0].reason);
  // new day with holders -> insert v1
  eq(byDay["2026-10-12"].action, "insert"); eq(byDay["2026-10-12"].seenVersion, null);
  eq(byDay["2026-10-12"].changes.map(c => c.role + ":" + c.to), ["primary:s1", "backup:s4"]);
  // new day with both open -> no insert, listed open
  ok(!byDay["2026-10-13"], "10/13 (both open, no live row) is not inserted");
  eq(plan.noInsert, ["2026-10-13"]);
  ok(plan.openSlots.some(o => o.day === "2026-10-13" && o.role === "primary") && plan.openSlots.some(o => o.day === "2026-10-13" && o.role === "backup"), "10/13 both roles listed open");
  // milestone locked-primary import day, open backup filled
  eq(byDay["2026-10-14"].changes, [{ day: "2026-10-14", role: "backup", from: null, to: "s6" }]);
  // plain inserts
  eq(byDay["2026-10-15"].action, "insert"); eq(byDay["2026-10-16"].action, "insert");
  // totals
  eq(plan.rows.map(r => r.day), ["2026-10-05", "2026-10-07", "2026-10-10", "2026-10-12", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-18"], "the written days");
  eq(plan.rows.filter(r => r.action === "insert").length, 3);
  eq(plan.rows.filter(r => r.action === "update").length, 5);
  eq(plan.refused.length, 3, "three refused slots (10/8 manual, 10/11 import->OPEN, 10/17 trade)");
  eq(plan.skipped.sort(), ["2026-10-06", "2026-10-09"], "unchanged days");
  // open slots of the FINAL state: 10/10 P (cleared), 10/11 B (the day was skipped, its P keeps Burchett), 10/13 both, 10/8 B (skipped day)
  const open = plan.openSlots.map(o => o.day + " " + o.role).sort();
  eq(open, ["2026-10-08 backup", "2026-10-10 primary", "2026-10-11 backup", "2026-10-13 backup", "2026-10-13 primary"], "final open slots");
  // per-month counts
  eq(plan.byMonth["2026-10"], { insert: 3, update: 5, skip: 2, refused: 3, noInsert: 1, changes: plan.changes.length }, "October counts");
  eq(plan.changes.length, 11, "11 slot changes written (10/5 B, 10/7 B, 10/10 P, 10/12 P+B, 10/14 B, 10/15 P+B, 10/16 P+B, 10/18 B)");
  // final map = live overlaid with the plan
  eq(plan.final["2026-10-08"].primary, "s2", "a refused day keeps its live row in the final map");
  eq(plan.final["2026-10-12"].backup, "s4");
  ok(!plan.final["2026-10-13"], "no row for the all-open new day");
  // --force-app-edited (not used tonight): the refused slots become changes
  const forced = PUB.planPublish(FX.preview, FX.live, { forceAppEdited: true });
  ok(forced.ok && forced.rows.some(r => r.day === "2026-10-08") && forced.rows.some(r => r.day === "2026-10-17"), "forceAppEdited writes the app-edited days");
  eq(forced.refused.map(r => r.day), ["2026-10-11"], "under force only the import-holder clear stays refused");
  ok(!forced.rows.some(r => r.day === "2026-10-11"), "forceAppEdited still never clears an import holder");
}

/* ------------------------------------------------------------------ C */
step("C: aborts");
{
  const live = clone(FX.live);
  live.find(r => r.day === "2026-10-06").backup_id = "s4";   // locked backup differs from the preview's s2
  const p = PUB.planPublish(FX.preview, live);
  ok(!p.ok && p.aborts.some(a => /locked role differs/.test(a) && /2026-10-06/.test(a) && /backup/.test(a)), "a differing locked holder aborts: " + JSON.stringify(p.aborts));
  eq(p.rows, []);
  const pv = clone(FX.preview);
  pv.schedule["2026-10-15"].backup = "s2";                    // primary == backup
  const p2 = PUB.planPublish(pv, FX.live);
  ok(!p2.ok && p2.aborts.some(a => /distinct/.test(a) && /2026-10-15/.test(a)), "primary == backup aborts: " + JSON.stringify(p2.aborts));
  const pv3 = clone(FX.preview);
  pv3.backfill.schedule["2026-10-09"].primary = "s2";          // a primary over an external cover
  const p3 = PUB.planPublish(pv3, FX.live);
  ok(!p3.ok && p3.aborts.some(a => /external/.test(a) && /2026-10-09/.test(a)), "a preview primary over an external cover aborts: " + JSON.stringify(p3.aborts));
  // a live day the preview does not carry inside a range is a warning, never a write
  const live2 = clone(FX.live);
  live2.push({ day: "2026-10-13", primary_id: "s2", backup_id: null, primary_locked: false, backup_locked: false, source: "manual", external_cover: null, note: null, version: 1, updated_by: "s1" });
  const pv4 = clone(FX.preview); delete pv4.schedule["2026-10-13"];
  const p4 = PUB.planPublish(pv4, live2);
  ok(p4.ok && !p4.rows.some(r => r.day === "2026-10-13") && p4.warnings.some(w => /2026-10-13/.test(w)), "a range day missing from the preview is warned about and left alone");
  // wipe guard (helpers.scheduleWipeCheck, the app's accidental-wipe safeguard): a preview that empties
  // more than half of the populated primaries aborts even though every single clear is allowed (generated holders)
  const wipeLive = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map((d, i) =>
    ({ day: d, primary_id: "s" + (1 + (i % 6)), backup_id: "s" + (1 + ((i + 1) % 6)), primary_locked: false, backup_locked: false, source: "generated", external_cover: null, note: null, version: 1, updated_by: "s1" }));
  const wipePreview = { start: "2026-10-12", end: "2026-10-18", seed: 1, bestOf: 1, generatedAt: "x", schedule: {}, diagnostics: { hardViolations: [], uncovered: [], lockViolations: [] } };
  wipeLive.forEach(r => { wipePreview.schedule[r.day] = { primary: null, backup: null, primaryLocked: false, backupLocked: false, source: "generated", externalCover: null, note: null }; });
  const pw = PUB.planPublish(wipePreview, wipeLive);
  ok(!pw.ok && pw.aborts.some(a => /wipe guard/.test(a) && /7 of 7/.test(a)), "emptying every generated primary trips the wipe guard: " + JSON.stringify(pw.aborts));
  eq(pw.rows, [], "the wipe abort carries no rows");
  // clearing a minority is still allowed (one day of seven)
  const pw2 = clone(wipePreview);
  wipeLive.slice(1).forEach(r => { pw2.schedule[r.day] = { primary: r.primary_id, backup: r.backup_id, primaryLocked: false, backupLocked: false, source: "generated", externalCover: null, note: null }; });
  const pw2plan = PUB.planPublish(pw2, wipeLive);
  ok(pw2plan.ok && pw2plan.rows.length === 1 && pw2plan.changes.length === 2, "clearing one generated day of seven is a plain change: " + JSON.stringify(pw2plan.aborts));
}

/* ------------------------------------------------------------------ D */
step("D: row shape mirrors the app's Accept & Publish");
{
  const byDay = {}; plan.rows.forEach(r => { byDay[r.day] = r; });
  const keys = Object.keys(byDay["2026-10-05"].row);
  eq(keys, ["day", "primary_id", "backup_id", "primary_locked", "backup_locked", "source", "external_cover", "note"], "helpers.assignmentToDayRow key order (version / updated_by are write-time facts)");
  // source: the preview entry's source (generator.js genSeedLocks: a day with a fixed slot keeps the row's source, else 'generated')
  eq(byDay["2026-10-05"].row.source, "import", "mixed day (locked import P + generated B) keeps 'import'");
  eq(byDay["2026-10-12"].row.source, "generated", "a new fully generated day is 'generated'");
  eq(byDay["2026-10-10"].row.source, "generated");
  // note: the live note is never overwritten; a new generated day gets null
  eq(byDay["2026-10-05"].row.note, "seed: synthetic-panel");
  eq(byDay["2026-10-12"].row.note, null);
  const pvN = clone(FX.preview); pvN.backfill.schedule["2026-10-05"].note = "something else";
  const pN = PUB.planPublish(pvN, FX.live);
  eq(pN.rows.find(r => r.day === "2026-10-05").row.note, "seed: synthetic-panel", "a differing preview note never replaces the live note");
  ok(pN.warnings.some(w => /note/.test(w) && /2026-10-05/.test(w)), "...and is warned about");
  // external_cover: live value kept, never set on a new day
  eq(byDay["2026-10-12"].row.external_cover, null);
  const liveX = clone(FX.live); liveX.find(r => r.day === "2026-10-05").external_cover = null;
  // locks: live lock kept; a derived-week lock from the preview comes out locked (as suMergePreview + genSnapshot write it)
  const pvL = clone(FX.preview); pvL.schedule["2026-10-15"].backupLocked = true; pvL.schedule["2026-10-15"].source = "east-derived";
  const pL = PUB.planPublish(pvL, FX.live);
  const r15 = pL.rows.find(r => r.day === "2026-10-15").row;
  eq([r15.primary_locked, r15.backup_locked, r15.source], [false, true, "east-derived"], "a derived lock is written locked, source east-derived");
  // a live lock can never come out unlocked even if the preview flag is false
  eq(byDay["2026-10-14"].row.primary_locked, true);
  eq(byDay["2026-10-14"].row.primary_id, "s5");
}

/* ------------------------------------------------------------------ E */
step("E: SQL pins");
const sql = PUB.publishSql(plan, FX.preview, { previewFile: "test/fixtures/publish-synthetic-2026-10.json" });
{
  ok(typeof sql === "string" && sql.length > 500, "SQL generated");
  const iSnap = sql.indexOf("insert into public.call_schedule_snapshots");
  const iDays = sql.indexOf("public.schedule_days");
  const iAudit = sql.indexOf("insert into public.audit_log");
  ok(iSnap > 0 && iDays > 0 && iSnap < sql.indexOf("update public.schedule_days") && iSnap < sql.indexOf("insert into public.schedule_days"), "the snapshot is inserted before any schedule_days write");
  ok(/'generate_publish'/.test(sql), "snapshot reason is the app's 'generate_publish'");
  ok(sql.indexOf("'" + TAG + "'") > 0, "the tool tag is a literal");
  ok(/created_by\)[\s\S]*'generate_publish'/.test(sql), "created_by column present in the snapshot insert");
  // the snapshot data shape is the importer's (same six keys since Prompt 14 P5 - config, schedule_days, time_off,
  // availability, call_offers, call_periods - same aggregation)
  const IMP = require(path.join(REPO, "importer.js"));
  const impSql = IMP.importSql(IMP.importPlan(seed, { now: "2026-09-23T06:00:00.000Z" }));
  const shapeLines = (s) => s.split("\n").map(l => l.trim()).filter(l => /^'(config|schedule_days|time_off|availability|call_offers|call_periods)',\s+\(select /.test(l));
  eq(shapeLines(sql), shapeLines(impSql), "snapshot data = the importer's jsonb_build_object shape");
  // CAS per update: WHERE day = X AND version = seen; each guarded by GET DIAGNOSTICS + RAISE
  plan.rows.filter(r => r.action === "update").forEach(r => {
    const re = new RegExp("update public\\.schedule_days[\\s\\S]*?where day = '" + r.day + "' and version = " + r.seenVersion + ";");
    ok(re.test(sql), "CAS update for " + r.day + " on version " + r.seenVersion);
    ok(new RegExp("version\\s*=\\s*version \\+ 1[\\s\\S]*?where day = '" + r.day + "'").test(sql), "version = version + 1 for " + r.day);
  });
  plan.rows.filter(r => r.action === "insert").forEach(r => {
    ok(new RegExp("insert into public\\.schedule_days[^;]*values \\('" + r.day + "'[^;]*, 1, '" + TAG.replace(/[()]/g, "\\$&") + "'\\)\\s*on conflict \\(day\\) do nothing;").test(sql), "insert v1 + on conflict do nothing for " + r.day);
  });
  const guards = (sql.match(/get diagnostics v_n = row_count;/g) || []).length;
  eq(guards, plan.rows.length, "one row_count guard per written day");
  ok((sql.match(/raise exception 'PUBLISH_CAS_MISMATCH/g) || []).length === plan.rows.filter(r => r.action === "update").length, "one CAS raise per update");
  ok((sql.match(/raise exception 'PUBLISH_INSERT_CONFLICT/g) || []).length === plan.rows.filter(r => r.action === "insert").length, "one insert raise per insert");
  ok(/raise exception 'PUBLISH_ABORT: snapshot/.test(sql), "a snapshot failure raises (aborting the whole block)");
  ok(/raise exception 'PUBLISH_ABORT: expected % row/.test(sql) || /PUBLISH_ABORT: schedule_days/.test(sql), "a final row-count mismatch raises");
  ok(/^do \$pub\$/m.test(sql) && /^end \$pub\$;/m.test(sql), "one DO block with a tagged quote: every write and guard is atomic");
  eq((sql.match(/\$pub\$/g) || []).length, 2, "exactly one opening and one closing body tag");
  ok(!/\$\$/.test(sql), "no bare $$ anywhere (a note containing $$ could not end the body early)");
  // a note carrying '$$' (seed / app text) stays inside the body
  {
    const liveD = clone(FX.live); liveD.find(r => r.day === "2026-10-05").note = "cost $$ note";
    const planD = PUB.planPublish(FX.preview, liveD);
    const sqlD = PUB.publishSql(planD, FX.preview, {});
    eq((sqlD.match(/\$pub\$/g) || []).length, 2, "a $$ in a note leaves exactly two body tags");
    ok(/note = 'cost \$\$ note'/.test(sqlD), "the $$ note is written as a plain literal inside the body");
    const iOpen = sqlD.indexOf("do $pub$"), iClose = sqlD.indexOf("end $pub$;"), iNote = sqlD.indexOf("cost $$ note");
    ok(iOpen < iNote && iNote < iClose, "the note sits between the body tags");
  }
  ok(/^begin;/m.test(sql) && /^commit;/m.test(sql), "explicit begin/commit like importer.js");
  // the final select's days_by_tool is scoped to THIS run's stamp (the tag is a constant; a later run must not accumulate)
  ok(/as stamped_at/.test(sql) && /days_by_tool/.test(sql), "final select exposes stamped_at");
  ok(/updated_at = \(select max\(updated_at\) from public\.schedule_days where updated_by = '[^']+'\)\) as days_by_tool/.test(sql), "days_by_tool counts only rows stamped at the latest run's timestamp");
  // the audit row: the app's action + detail keys
  ok(iAudit > iSnap && iAudit < sql.indexOf("commit;"), "the audit insert is inside the transaction after the snapshot");
  ok(/'schedule\.generate_accept'/.test(sql), "action schedule.generate_accept");
  const auditJson = /insert into public\.audit_log \(actor_id, actor_name, action, detail\)[\s\S]*?values \(null, '[^']+', 'schedule\.generate_accept', ('[\s\S]*?'::jsonb)/.exec(sql);
  ok(auditJson, "audit insert shape (actor_id null, actor_name tag, detail jsonb)");
  const detail = JSON.parse(auditJson[1].slice(1, -8).replace(/''/g, "'"));
  ok(/^Accepted a generated schedule 10\/12 - 10\/18 \(seed 7, best of 200\): \d+ slot change\(s\), \d+ open slot\(s\)/.test(detail.summary), "summary mirrors the app's: " + detail.summary);
  eq([detail.start, detail.end, detail.seed, detail.bestOf, detail.respectLocks, detail.outcome], ["2026-10-12", "2026-10-18", "7", 200, true, "ok"], "detail keys as the app writes them");
  eq(detail.changes, plan.changes.length); eq(detail.uncovered, 2);
  eq(detail.mode, "command-line");
  ok(/published from the command line on Faraz's authorisation of 2026-09-22 evening/.test(detail.note), "the authorisation note");
  eq(detail.backfill && detail.backfill.start, "2026-10-05");
  eq(detail.refused, 3);
  // never any mail: no notifications table, no edge function, no email
  ok(!/notification/i.test(sql), "the SQL never names a notifications table");
  ok(!/send-notification|office-notifications|functions\/v1|@/.test(sql), "no edge function call, no address");
  // updated_by tag on every schedule_days write
  const ubs = (sql.match(/updated_by\s*=\s*'[^']*'/g) || []);   // SET clauses of the updates + the stamp guard + the final select's WHERE
  ok(ubs.length >= plan.rows.filter(r => r.action === "update").length && ubs.every(u => u.indexOf(TAG) > 0), "every updated_by literal is the tag");
  eq((sql.match(/version = version \+ 1, updated_by = '/g) || []).length, plan.rows.filter(r => r.action === "update").length, "updated_by = tag in every update's SET");
  // 7-bit clean
  ok(!/[^\x00-\x7f]/.test(sql), "SQL is 7-bit clean");
  // the final select reports what --apply verifies
  ok(/snapshots_after/.test(sql) && /snapshot_id/.test(sql) && /audit_id/.test(sql) && /days_by_tool/.test(sql), "final select exposes snapshot_id / audit_id / counts");
  // an empty plan makes no SQL
  const empty = PUB.planPublish(FX.preview, PUB.applyToLive(FX.live, plan));
  eq(PUB.publishSql(empty, FX.preview, {}), null, "no rows -> no SQL");
}

/* ------------------------------------------------------------------ F */
step("F: preflight on a synthetic ctx (seed rules, no network)");
{
  const EAST_COVER = { from: "2026-09-28", to: "2026-11-01" };
  const mk = (schedule) => R.buildContext(SA.seedToContextInput(seed, { eastDerived: [], eastFeedCoverage: EAST_COVER, eastBusyDays: {}, schedule }));
  // preview checks: the real gate on diagnostics
  const pc = PUB.previewChecks(FX.preview);
  ok(!pc.ok && pc.problems.length === 1 && /milestone leaves 2 slot\(s\) open: 2026-10-13 primary, 2026-10-13 backup/.test(pc.problems[0]), "gate (a): the fixture's open milestone day FAILS (the real preview leaves none): " + JSON.stringify(pc.problems));
  eq(pc.milestoneOpen.length, 2, "milestone open slots listed");
  const covered = clone(FX.preview); covered.diagnostics.uncovered = [];
  ok(PUB.previewChecks(covered).ok, "with the milestone covered the diagnostics pass (backfill opens are allowed)");
  eq(PUB.previewChecks(covered).backfillOpen.map(o => o.day + " " + o.role), ["2026-10-10 primary", "2026-10-11 primary"], "backfill opens are listed, not fatal");
  const bad = clone(covered); bad.diagnostics.hardViolations = [{ day: "2026-10-12", role: "primary", id: "s1", reasons: ["x"] }];
  ok(!PUB.previewChecks(bad).ok, "a hard violation in the diagnostics fails the check");
  const badB = clone(covered); badB.backfill.diagnostics.hardViolations = [{ day: "2026-10-08", role: "primary", id: "s3", reasons: ["x"] }];
  ok(!PUB.previewChecks(badB).ok, "a backfill hard violation fails the check too");
  // eligibility over the final schedule: a clean seed schedule over an October week passes (locked facts are allowed)
  const base = SA.seedToSchedule(seed);
  const ctxClean = mk(base);
  const openOf = (F, days) => { const o = []; days.forEach(d => { const e = F[d]; if (!e || (!e.primary && !e.externalCover)) o.push({ day: d, role: "primary" }); if (!e || !e.backup) o.push({ day: d, role: "backup" }); }); return o; };
  const week = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  // (c) with the opens NOT listed the seed week fails on coverage alone (the October backups are open on the seed)
  const pfUnlisted = PUB.preflight(ctxClean, { ok: true, days: week, final: base, openSlots: [], aborts: [] });
  ok(!pfUnlisted.ok && pfUnlisted.hardRemaining.length === 0 && pfUnlisted.missingDays.length > 0, "seed week with opens unlisted fails (c) only: missing " + JSON.stringify(pfUnlisted.missingDays));
  const fakePlan = { ok: true, days: week, final: base, openSlots: openOf(base, week), aborts: [] };
  const pfClean = PUB.preflight(ctxClean, fakePlan);
  ok(pfClean.ok, "seed week passes with its opens listed: hard remaining " + JSON.stringify(pfClean.hardRemaining) + " missing " + JSON.stringify(pfClean.missingDays));
  ok(Array.isArray(pfClean.lockedFacts), "locked facts are listed, not fatal");
  // a hard violation planted in the FINAL schedule is caught: Khan primary on a Tuesday (hard-never-weekday), unlocked
  const planted = clone(base);
  planted["2026-10-06"] = { primary: "s1", backup: base["2026-10-06"] ? (base["2026-10-06"].backup === "s1" ? "s2" : base["2026-10-06"].backup) : "s2", primaryLocked: false, backupLocked: false, source: "generated", externalCover: null, note: null };
  const ctxBad = mk(planted);
  const pfBad = PUB.preflight(ctxBad, { ok: true, days: ["2026-10-06"], final: planted, openSlots: [], aborts: [] });
  ok(!pfBad.ok, "the planted violation fails the preflight");
  ok(pfBad.hardRemaining.some(h => h.day === "2026-10-06" && h.role === "primary" && h.id === "s1" && h.reasons.some(r => /hard-never-weekday/.test(r))), "...naming Khan / Tuesday: " + JSON.stringify(pfBad.hardRemaining));
  // the same holder LOCKED is a locked fact (the app's import-holder reading), not a failure
  const lockedP = clone(planted); lockedP["2026-10-06"].primaryLocked = true; lockedP["2026-10-06"].source = "import";
  const pfLocked = PUB.preflight(mk(lockedP), { ok: true, days: ["2026-10-06"], final: lockedP, openSlots: [], aborts: [] });
  ok(pfLocked.ok && pfLocked.lockedFacts.some(f => f.day === "2026-10-06" && f.id === "s1"), "a locked holder's conflicts are reported as locked facts: " + JSON.stringify(pfLocked.lockedFacts));
  // coverage check: a range day with no row and not listed open fails
  const pfMissing = PUB.preflight(ctxClean, { ok: true, days: ["2026-10-06", "2030-01-01"], final: base, openSlots: [], aborts: [] });
  ok(!pfMissing.ok && pfMissing.missingDays.includes("2030-01-01"), "an unlisted uncovered day fails the preflight");
  const pfListed = PUB.preflight(ctxClean, { ok: true, days: ["2026-10-06", "2030-01-01"], final: base, openSlots: [{ day: "2030-01-01", role: "primary" }, { day: "2030-01-01", role: "backup" }], aborts: [] });
  ok(pfListed.ok, "...and passes once both roles are listed open");
  // a ctx note (an eastBlocks surgeon whose East busy days could not be resolved) is FATAL, never a silent PASS
  const pfNoted = PUB.preflight(ctxClean, fakePlan, ["no East id for FAK - his East busy days are NOT in the ctx"]);
  ok(!pfNoted.ok && pfNoted.ctxNotes.length === 1 && pfNoted.hardRemaining.length === 0, "a ctx note fails the preflight on its own: " + JSON.stringify(pfNoted.ctxNotes));
  ok(/ctx note|FAIL/.test(PUB.renderPreflight(pfNoted, PUB.previewChecks(covered))) && /preflight result: FAIL/.test(PUB.renderPreflight(pfNoted, PUB.previewChecks(covered))), "the note is printed and the result reads FAIL");
  ok(PUB.preflight(ctxClean, fakePlan, []).ok, "an empty note list changes nothing");
}

/* ------------------------------------------------------------------ G */
step("G: idempotence - planning against the post-apply state yields zero rows");
{
  const after = PUB.applyToLive(FX.live, plan);
  eq(after.length, FX.live.length + 3, "three inserted rows");
  const a05 = after.find(r => r.day === "2026-10-05");
  eq([a05.version, a05.updated_by, a05.backup_id], [2, TAG, "s5"], "version incremented, tag, holder");
  const a12 = after.find(r => r.day === "2026-10-12");
  eq([a12.version, a12.updated_by], [1, TAG]);
  const again = PUB.planPublish(FX.preview, after);
  ok(again.ok, "re-plan ok");
  eq(again.rows, [], "zero rows on re-plan");
  eq(again.changes, [], "zero changes on re-plan");
  eq(again.refused.length, 3, "the refused slots are still refused (nothing was written for them)");
  // verifyApplied: the tool's post-apply check against re-read rows
  const v = PUB.verifyApplied(plan, after);
  ok(v.ok && v.problems.length === 0, "verifyApplied passes on the simulated state: " + JSON.stringify(v.problems));
  const tampered = clone(after); tampered.find(r => r.day === "2026-10-12").backup_id = "s2";
  const v2 = PUB.verifyApplied(plan, tampered);
  ok(!v2.ok && v2.problems.some(p => /2026-10-12/.test(p)), "a holder that differs from the plan is a verification problem");
  const stale = clone(after); stale.find(r => r.day === "2026-10-05").version = 1;
  ok(!PUB.verifyApplied(plan, stale).ok, "a version that did not move is a verification problem");
  // verifyUntouched: the rows OUTSIDE the plan read byte-identical and the total moved by exactly the inserts
  const u = PUB.verifyUntouched(FX.live, after, plan);
  ok(u.ok && u.problems.length === 0, "the simulated apply touches nothing outside the plan: " + JSON.stringify(u.problems));
  const foreign = clone(after); foreign.find(r => r.day === "2026-10-08").backup_id = "s4";   // a refused (skipped) day edited by someone else
  const u2 = PUB.verifyUntouched(FX.live, foreign, plan);
  ok(!u2.ok && u2.problems.some(p => /2026-10-08/.test(p) && /outside the plan/.test(p)), "a foreign edit to a non-planned day is reported: " + JSON.stringify(u2.problems));
  const extra = clone(after); extra.push({ day: "2026-12-25", primary_id: "s1", backup_id: "s2", primary_locked: false, backup_locked: false, source: "manual", external_cover: null, note: null, version: 1, updated_by: "s1" });
  const u3 = PUB.verifyUntouched(FX.live, extra, plan);
  ok(!u3.ok && u3.problems.some(p => /total/.test(p) && /expected 13/.test(p)), "a row that appeared outside the plan shows in the total: " + JSON.stringify(u3.problems));
  const gone = clone(after).filter(r => r.day !== "2026-10-06");
  ok(!PUB.verifyUntouched(FX.live, gone, plan).ok, "a vanished non-planned row is a problem");
  // parseCliRows: the final select's row is found from the END of the CLI output, whatever chatter precedes it
  eq(PUB.parseCliRows('[{"a":1}]'), [{ a: 1 }], "a bare array");
  eq(PUB.parseCliRows('noise\n{"rows":[{"snapshot_id":"x"}]}\n'), [{ snapshot_id: "x" }], "{rows}");
  eq(PUB.parseCliRows('[INFO] linked project\nWARN [x] something\n[{"snapshot_id":"y","audit_id":"z"}]'), [{ snapshot_id: "y", audit_id: "z" }], "brackets in earlier chatter do not break the parse");
  eq(PUB.parseCliRows('{"level":"info"} preamble\n{"snapshot_id":"q"}'), [{ snapshot_id: "q" }], "a bare object after an earlier object");
  eq(PUB.parseCliRows("no json here"), null, "no JSON -> null");
  eq(PUB.parseCliRows(""), null, "empty -> null");
  // tallies of the final rows per surgeon per month
  const tl = PUB.tallies(again.final, FX.roster, plan.ranges);
  eq(tl["2026-10"].s3, { primary: 2, backup: 4 }, "Acton in the final rows: P 10/5 10/6 (10/8 refused stays Burchett); B 10/15 10/16 10/18 + 10/17 (refused day keeps its live Acton backup)");
  eq(tl["2026-10"].s1, { primary: 1, backup: 1 }, "Khan: P 10/12; B 10/10");
}

/* ------------------------------------------------------------------ H */
step("H: the real preview file - shape, no overlap, preview checks");
{
  // B10 (9/23): the 9/23 preview left docs/ with the other history files (private folder, docs/HISTORY.md); the copy
  // under test/fixtures/ (the ER-panel source slug renamed to office-er-call-panels-<date>, otherwise identical) is this
  // step's input - a regression fixture, not a publish record (docs/PUBLISH-2026-09-23.md is).
  const real = JSON.parse(fs.readFileSync(path.join(REPO, "test", "fixtures", "publish-preview-2026-09-23.json"), "utf8"));
  const d = PUB.buildDesired(real);
  eq(d.conflicts, [], "no milestone/backfill overlap");
  ok(d.ranges.length >= 1 && d.days.length > 0 && d.ranges.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.start)), "ranges and days parse");
  const pc = PUB.previewChecks(real);
  ok(Array.isArray(pc.problems) && Array.isArray(pc.lockViolations), "previewChecks runs on the real file");
  // the numeric facts belong to ONE generation of the file (the 9/23 milestone preview); a regenerated preview
  // (the 3 / 6 / 9 / 12-month presets after the milestone) must not turn this suite red
  if (real.generatedAt === "2026-09-23T05:28:27.631Z") {
    eq(d.ranges.map(r => r.start + ".." + r.end), ["2026-10-07..2026-11-01", "2026-11-02..2027-01-03"]);
    eq(d.days.length, 26 + 63);
    ok(pc.ok, "real preview diagnostics pass: " + JSON.stringify(pc.problems));
    eq(pc.milestoneOpen, [], "milestone leaves nothing open");
    eq(pc.backfillOpen.map(o => o.day + " " + o.role), ["2026-10-15 primary"], "the backfill leaves 10/15 primary open");
    eq(pc.lockViolations.length, 1 + 8, "known locked facts: Acton 11/18 + the October import locks the preview already reported");
  } else console.log("  (real preview generatedAt " + real.generatedAt + " - the 9/23 data pins are skipped)");
  // the render helpers do not throw on a real plan against an EMPTY live set (every day an insert)
  const p = PUB.planPublish(real, []);
  ok(p.ok, "plan over an empty live set: " + JSON.stringify(p.aborts));
  ok(/inserts? /.test(PUB.renderPlan(p, nameOf)) || /insert/.test(PUB.renderPlan(p, nameOf)), "renderPlan text");
  ok(/# Publish/.test(PUB.renderReport({ plan: p, preview: real, roster: FX.roster, mode: "dry-run", previewFile: "x.json", preflight: null, previewChecks: pc })), "renderReport markdown");
}

/* ------------------------------------------------------------------ T4 */
step("T4 (audit 9/23): the report never lands on a tracked publish record by default");
{
  const rel = (p) => path.relative(REPO, p).replace(/\\/g, "/");
  const record = path.join(REPO, "docs", "PUBLISH-2026-09-23.md");
  ok(fs.existsSync(record), "the 9/23 publish record is tracked (the file a refused --apply used to overwrite)");
  const dry = PUB.parseArgs([]);
  ok(!rel(dry.report).startsWith("docs/") && dry.reportExplicit === false, "dry-run: the report defaults outside docs/: " + dry.report);
  const ap = PUB.parseArgs(["--apply", "--workdir", "C:/x/supabase"]);
  ok(/^docs\/PUBLISH-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.md$/.test(rel(ap.report)), "apply: the report defaults to a dated docs/PUBLISH-<date>-<hhmm>.md: " + rel(ap.report));
  ok(rel(ap.report) !== "docs/PUBLISH-2026-09-23.md" && !fs.existsSync(ap.report), "...a NEW file, never the 9/23 record");
  eq(ap.reportExplicit, false); ok(!rel(ap.scratchReport).startsWith("docs/"), "...and its scratch destination is outside docs/");
  eq(rel(PUB.defaultApplyReport(new Date("2026-09-23T14:32:05Z"))), "docs/PUBLISH-2026-09-23-1432.md", "the default name is UTC date + hhmm");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "silvis-t4-"));
  fs.writeFileSync(path.join(tmp, "PUBLISH-2026-09-23-1432.md"), "taken", "utf8");
  eq(path.basename(PUB.defaultApplyReport(new Date("2026-09-23T14:32:05Z"), tmp)), "PUBLISH-2026-09-23-1432-2.md", "an existing file of that name is never reused");
  // where each outcome writes: only a SENT batch reaches docs/ by default; an explicit --report always wins
  const argsDefault = { report: ap.report, scratchReport: ap.scratchReport, reportExplicit: false };
  eq(PUB.reportDestination(argsDefault, "sent"), ap.report, "sent -> the dated docs/ report");
  ["dry-run", "refused", "nothing"].forEach((o) => eq(PUB.reportDestination(argsDefault, o), ap.scratchReport, o + " -> the scratch path, docs/ untouched"));
  const argsExplicit = { report: "C:/mine/r.md", scratchReport: ap.scratchReport, reportExplicit: true };
  ["sent", "dry-run", "refused", "nothing"].forEach((o) => eq(PUB.reportDestination(argsExplicit, o), "C:/mine/r.md", o + " with --report -> the named file"));
  // the source: every writeReport call names its outcome, the refused/nothing paths never say "sent", and the
  // --workdir check now precedes the gates check
  const src = fs.readFileSync(path.join(REPO, "scripts", "publish-preview.js"), "utf8");
  const calls = src.match(/writeReport\((null|apply), "(dry-run|refused|nothing|sent)"\)/g) || [];
  eq(calls.length, (src.match(/writeReport\(/g) || []).length, "every writeReport call passes an outcome: " + JSON.stringify(calls));
  ok(calls.length >= 5, "the five call sites (dry-run, refused, nothing, re-read failure, verified) are all present");
  ok(/REFUSING TO APPLY[^\n]*writeReport\(null, "refused"\)/.test(src) && /nothing to apply[^\n]*writeReport\(null, "nothing"\)/.test(src), "the refused and nothing-to-apply paths carry their outcome");
  ok(src.indexOf("--apply needs --workdir") < src.indexOf("REFUSING TO APPLY"), "the --workdir check precedes the gates check");
  ok(!/DEFAULT_REPORT/.test(src), "no DEFAULT_REPORT constant pointing at a historical record remains");
}

console.log("ok " + n + " assertions (" + (Date.now() - t0) + " ms)");
