// Silvis - importer tests (Prompt 5). Plain Node asserts, no framework.
// Every expected count is derived independently from docs/silvis-seed.json
// here, never copied out of importer.js.
//   node test/importer.test.js

"use strict";

const assert = require("assert");
const path = require("path");
const IMP = require(path.join(__dirname, "..", "importer.js"));
const R = require(path.join(__dirname, "..", "rules.js"));
const SA = require(path.join(__dirname, "seed-adapter.js"));
const seed = require(path.join(__dirname, "..", "docs", "silvis-seed.json"));

let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }
function eq(a, b, msg) { n++; assert.deepStrictEqual(a, b, msg); }
function step(name) { console.log("- " + name); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const NOW = "2026-09-22T03:00:00.000Z";
const plan = IMP.importPlan(seed, { now: NOW });
const byId = {};
seed.roster.forEach((r) => { byId[r.id] = r; });
const KHAN = "s1", BURCHETT = "s2", ACTON = "s3", PHILIP = "s4", FIERCE = "s5";

/* ------------------------------------------------------- schedule_days */
step("schedule_days rows");
const days = plan.scheduleDayRows;
const byDay = {};
days.forEach((d) => { byDay[d.day] = d; });
eq(days.length, seed.existingAssignments.length, "one row per existingAssignment");
eq(days.length, 73, "49 hand-schedule days + 4 Thanksgiving days + 20 November rows (Prompt 12 T)");
eq(days.filter((d) => d.day >= "2026-11-26" && d.day <= "2026-11-29").length, 4, "Thanksgiving unit rows");
const ext = days.filter((d) => d.external_cover != null);
eq(ext.length, 7, "7 externalCover (Atwell) rows");
ok(ext.every((d) => d.primary_id === null && d.primary_locked === true && d.external_cover === "Atwell"), "externalCover rows: primary null but locked");
ok(ext.every((d) => d.backup_id === FIERCE && d.backup_locked === true), "Atwell week: Fierce backup locked");
const openOctBackups = days.filter((d) => d.backup_id == null && d.day >= "2026-10-01" && d.day <= "2026-11-01");
eq(openOctBackups.length, 16, "16 open October backups");
ok(openOctBackups.every((d) => d.backup_locked === false), "open backups are never locked");
ok(days.filter((d) => d.backup_id == null).every((d) => d.backup_locked === false), "null backup -> never locked (all)");
eq(byDay["2026-10-15"].primary_id, null); eq(byDay["2026-10-15"].primary_locked, false, "10/15 primary open and unlocked");
eq(byDay["2026-10-15"].backup_locked, false);
// 9/22 evening (item S): Sarkar at two days per week, October locks included - 10/24 came off her.
// Locked-open like 10/15 (a null slot is never locked); the seed's operational note rides in the row note.
eq(byDay["2026-10-24"].primary_id, null, "10/24 primary open since 9/22 evening (Sarkar at two days per week)");
eq(byDay["2026-10-24"].backup_id, null, "10/24 backup was already open");
eq(byDay["2026-10-24"].primary_locked, false, "10/24 locked-open: a null slot is never locked"); eq(byDay["2026-10-24"].backup_locked, false);
eq(byDay["2026-10-24"].note, "seed: faraz-2026-09-22-sarkar-two-days - open \u2014 Sarkar at two days per week from 9/22", "10/24 note = provenance + the seed's operational note");
eq(days.filter((d) => d.primary_id === "s6").map((d) => d.day), ["2026-10-20", "2026-10-22"], "Sarkar keeps exactly 10/20 and 10/22 in the import");
["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"].forEach((d) => {
  eq(byDay[d].primary_id, KHAN, d + " Khan"); eq(byDay[d].primary_locked, true, d + " locked"); eq(byDay[d].backup_locked, false, d + " backup open");
});
ok(days.every((d) => d.source === "import" && d.version === 1 && d.updated_by === "seed"), "source import, version 1, updated_by seed");
ok(days.every((d) => d.primary_locked === !!(seed.existingAssignments.find((a) => a.date === d.day).locked && (d.primary_id != null || d.external_cover != null))), "primary_locked rule");
// provenance in note
seed.existingAssignments.forEach((a) => {
  const d = byDay[a.date];
  ok(d.note && d.note.indexOf(a.source) >= 0, a.date + " note carries the seed provenance string");
  if (a.note) ok(d.note.indexOf(a.note) >= 0, a.date + " note keeps the seed's operational note");
});
eq(byDay["2026-10-12"].primary_id, FIERCE, "pendingDelta 10/12 already applied (Fierce)");
eq(plan.infoDeltas.length, seed.pendingDeltas.length, "every pendingDelta rendered as info");
ok(plan.infoDeltas.every((l) => /nothing to write/.test(l)), "info deltas say nothing to apply");
ok(plan.infoDeltas.some((l) => /^10\/12 P Philip -> Fierce/.test(l)), "info delta rendering");
ok(plan.infoDeltas.some((l) => /^10\/24 P Sarkar -> open \(applied; faraz-2026-09-22-sarkar-two-days\)/.test(l)), "10/24 delta (surgeon null) renders as 'Sarkar -> open': " + plan.infoDeltas.filter((l) => /^10\/24/.test(l)).join(" | "));

/* ------------------------------ Thanksgiving provenance (Prompt 12 B; confirmed - Prompt 12 Z, 9/22 late) */
// The four 11/26-11/29 rows were recorded by Claude Code on 2026-09-22 as a 9/21 evening decision while the daytime
// record said pending; item B flagged them awaitingConfirmation: true and the importer prefixed their schedule_days
// note with the exact marker the app reads for its "confirm" badge. Faraz confirmed on 9/22 (late evening, Prompt 12 Z):
// the flag is gone from the seed and the marker leaves the notes on the next import. The marker FEATURE (importer.js
// untouched) stays covered below on synthetic flagged rows. Every literal is restated here.
step("B/Z: the Thanksgiving rows carry no awaitingConfirmation flag; the marker feature stays (synthetic rows)");
const AWAIT_MARKER = "awaiting confirmation - ";
const B_ROWS = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
const B_NOTE = "Thanksgiving unit - Khan primary Thu-Sun; recorded by Claude Code on 2026-09-22 as an evening decision; the daytime record said pending; Faraz to re-confirm before publish";   // item B's wording = the live rows after the 9/22 import; used by the Z block to rebuild the pre-Z live state
const Z_NOTE = "Thanksgiving unit - Khan primary Thu-Sun (Faraz 9/21 evening; confirmed 9/22)";   // Prompt 12 Z
eq(IMP.IMP_AWAITING_MARKER, AWAIT_MARKER, "B: the importer exports the marker literal (shared with the app's badge)");
eq(seed.existingAssignments.filter((a) => a.awaitingConfirmation === true).map((a) => a.date), [], "Z FLIP: no existingAssignments row carries awaitingConfirmation: true (B: the four Thanksgiving rows did)");
ok(seed.existingAssignments.filter((a) => B_ROWS.includes(a.date)).every((a) => a.primary === KHAN && a.locked === true && a.source === "faraz-2026-09-21" && a.note === Z_NOTE && !("awaitingConfirmation" in a)), "Z FLIP: the four rows keep Khan primary, locked, source faraz-2026-09-21; the note is the confirmed wording and the flag key is gone");
B_ROWS.forEach((d) => eq(byDay[d].note, "seed: faraz-2026-09-21 - " + Z_NOTE, "Z FLIP: " + d + " schedule_days note = 'seed: <source>' + the row note, no marker (B: marker in front)"));
eq(days.filter((d) => (d.note || "").indexOf(AWAIT_MARKER) === 0).map((d) => d.day), [], "Z FLIP: no row carries the marker (B: the four did; 11/25 never)");
ok(!days.some((d) => /CONFIRMED/.test(d.note || "")), "B: no schedule_days note says CONFIRMED in capitals (Z: 'confirmed 9/22' is the rows' own provenance)");
eq(byDay["2026-11-25"].note, "seed: faraz-2026-09-22-khan-1125 - Khan covers 11/25, 2026 only", "B: 11/25 (Faraz's separate 9/22 decision) is not flagged");
B_ROWS.forEach((d) => ok(IMP.impSeedSchedule(seed)[d].note.indexOf(AWAIT_MARKER) !== 0, "Z FLIP: the in-memory schedule (fixture / context) carries no marker on " + d));
eq(plan.stats.scheduleDays.awaitingConfirmation, 0, "Z FLIP: plan.stats counts no awaiting rows (B: 4)");
eq(plan.noteScrub.inventory.filter((e) => e.action === "awaiting-confirmation"), [], "Z FLIP: the dry-run inventory lists no 'awaiting-confirmation' entry (B: the four rows)");
eq(plan.noteScrub.counts.awaitingConfirmation, 0, "Z FLIP: inventory counts.awaitingConfirmation 0 (B: 4)");
ok(IMP.importSql(plan).indexOf("'seed: faraz-2026-09-21 - " + Z_NOTE + "'") >= 0, "Z FLIP: the SQL writes the plain note literal without the marker");
ok(/^-- seed generatedOn .*; 73 schedule_days, /m.test(IMP.importSql(plan)) && !/awaiting confirmation\)/.test(IMP.importSql(plan)), "Z FLIP: the SQL header carries no '(N awaiting confirmation)' suffix (B: '(4 awaiting confirmation)')");
ok(!/CONFIRMED/.test(JSON.stringify(seed.surgeonRules[KHAN])), "B: Khan's seed rules never say CONFIRMED in capitals (Z: 'confirmed 9/22')");
ok(/confirmed by Faraz 9\/22/.test(seed.surgeonRules[KHAN].holidays2026.thanksgiving.note) && !/pending|re-confirm/i.test(seed.surgeonRules[KHAN].holidays2026.thanksgiving.note), "Z FLIP: s1.holidays2026.thanksgiving.note says confirmed 9/22 - no 'pending', no 're-confirm' (B: the provenance sentence)");
ok(/confirmed by Faraz 9\/22/.test(seed.surgeonRules[KHAN].holidays2026.thanksgiving.source) && !/pending|re-confirm|recorded by Claude Code/i.test(seed.surgeonRules[KHAN].holidays2026.thanksgiving.source), "Z FLIP: s1.holidays2026.thanksgiving.source says confirmed 9/22 - no caveat (B: 'recorded by Claude Code ... re-confirm before publish')");
ok(seed.surgeonRules[KHAN].notes.some((t) => /^Thanksgiving 2026:/.test(t) && /confirmed by Faraz 9\/22/.test(t)) && !seed.surgeonRules[KHAN].notes.some((t) => /re-confirm|daytime record said pending/.test(t)), "Z FLIP: s1.notes Thanksgiving line says confirmed 9/22; the provenance caveat is gone from every s1 note (B: carried it)");
eq(seed.surgeonRules[KHAN].holidays2026.thanksgiving.days, B_ROWS, "B: the s1 holiday block still lists the four days");
eq(plan.blob.surgeonRules[KHAN].holidays2026.thanksgiving.days, B_ROWS, "B: ... and so does the blob (unit unchanged)");
// review B-3 / Z: the holidays.units 2026 Thanksgiving note (seed record only - the importer drops holidays notes) says the
// same as the four rows it sits beside: confirmed 9/22, no caveat.
{
  const tgUnit = (seed.holidays.units["2026"] || seed.holidays.units[2026]).find((u) => u.name === "Thanksgiving");
  eq(tgUnit.days, B_ROWS, "B: holidays.units 2026 Thanksgiving still spans the four days");
  ok(/confirmed by Faraz 9\/22/.test(tgUnit.note) && !/re-confirm|pending|recorded by Claude Code/i.test(tgUnit.note), "Z FLIP: holidays.units 2026 Thanksgiving note says confirmed 9/22 with no provenance caveat (B: carried the caveat)");
  ok(!("holidays" in plan.blob && JSON.stringify(plan.blob.holidays).indexOf(tgUnit.note) >= 0), "B: the unit note stays out of the blob (holidays notes are dropped)");
}
// flag semantics on SYNTHETIC fixtures (Z: the real seed flags nothing; the feature stays available for future
// provenance flags): false / absent -> no marker; true -> marker + provenance + note; true without a note -> marker +
// provenance only; counted, inventoried, in the SQL header; idempotent
{
  const fx = clone(seed);
  const r26 = fx.existingAssignments.find((a) => a.date === "2026-11-26"), r27 = fx.existingAssignments.find((a) => a.date === "2026-11-27"), r28 = fx.existingAssignments.find((a) => a.date === "2026-11-28");
  r26.awaitingConfirmation = false; r27.awaitingConfirmation = true; r28.awaitingConfirmation = true; delete r28.note;   // 11/29 untouched: key absent
  const p2 = IMP.importPlan(fx, { now: NOW }), by2 = {}; p2.scheduleDayRows.forEach((d) => { by2[d.day] = d; });
  eq(by2["2026-11-26"].note, "seed: faraz-2026-09-21 - " + Z_NOTE, "B: awaitingConfirmation: false -> no marker (the note itself is kept)");
  eq(by2["2026-11-27"].note, AWAIT_MARKER + "seed: faraz-2026-09-21 - " + Z_NOTE, "B: a flagged row -> marker + 'seed: <source>' + its note (the feature is intact after Z)");
  eq(by2["2026-11-28"].note, AWAIT_MARKER + "seed: faraz-2026-09-21", "B: flag without a note -> marker + provenance only");
  eq(by2["2026-11-29"].note, "seed: faraz-2026-09-21 - " + Z_NOTE, "B: key absent -> no marker");
  eq(p2.stats.scheduleDays.awaitingConfirmation, 2, "B: fixture count = 11/27 + 11/28");
  eq(p2.noteScrub.inventory.filter((e) => e.action === "awaiting-confirmation").map((e) => [e.path, e.to, "from" in e]), [["existingAssignments[2026-11-27].note", "schedule_days", false], ["existingAssignments[2026-11-28].note", "schedule_days", false]], "B: fixture inventory (path only, never the note text)");
  eq(p2.noteScrub.counts.awaitingConfirmation, 2, "B: fixture counts.awaitingConfirmation");
  ok(IMP.importSql(p2).indexOf("'" + AWAIT_MARKER + "seed: faraz-2026-09-21 - " + Z_NOTE + "'") >= 0, "B: the SQL writes a marked note as a plain literal");
  ok(/^-- seed generatedOn .*; 73 schedule_days \(2 awaiting confirmation\), /m.test(IMP.importSql(p2)), "B: the SQL header counts the flagged fixture rows");
  eq(IMP.importPlan(seed, { now: NOW }).scheduleDayRows, plan.scheduleDayRows, "B: idempotent - a second plan writes the same notes");
}

/* ------------------------------ November locks (Prompt 12 T, 9/22) */
// the ER-panel author's 9/22 document entered Burchett's and Acton's November days (rules doc section 7); Faraz's two
// amendments fold in: 11/25 primary stays Khan (Burchett's entry superseded) and Fierce takes BACKUP 11/9-11/16
// (Burchett's backup entries on 11/9, 11/14, 11/15, 11/16 superseded). One row per day merging the roles; a null
// slot stays open for the generator (nullSlotIsNeverLocked). Every expected list is restated here, not read from the seed.
step("November locks: the ER-panel author's 9/22 entries + Faraz's two amendments");
const NOV_SRC = "office-er-call-panels-2026-09-22", FIERCE_SRC = "fierce-2026-09-22-backup-week", KHAN_SRC = "faraz-2026-09-22-khan-1125";
const ACTON_1105_SRC = "faraz-2026-09-22-acton-1105"; // Prompt 12 Y (9/22 evening): 11/5 = Acton primary per his recurring rules
const S2 = BURCHETT, S3 = ACTON, S5 = FIERCE;
const nov = (d) => d.day >= "2026-11-02" && d.day <= "2026-11-25"; // 11/1 is the last day of the September-October import
const novDays = days.filter(nov).map((d) => d.day);
eq(novDays, ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-20", "2026-11-23", "2026-11-25"], "T: 20 November rows - 11/2-11/18 daily, 11/20, 11/23, 11/25");
eq(days.length, 73, "T: 53 + 20 November rows");
eq(days.filter((d) => nov(d) && d.primary_id === S2).map((d) => d.day), ["2026-11-03", "2026-11-07", "2026-11-08", "2026-11-11", "2026-11-20", "2026-11-23"], "T: Burchett primary 11/3, 11/7, 11/8, 11/11, 11/20, 11/23 (11/25 superseded by Khan)");
eq(days.filter((d) => nov(d) && d.backup_id === S2).map((d) => d.day), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-18"], "T: Burchett backup 11/2, 11/4, 11/6, 11/18 (11/9, 11/14, 11/15, 11/16 superseded by Fierce)");
// Prompt 12 Y FLIP (9/22 evening): before Y Acton's primaries were the 7 relayed dates and his backups 11/3, 11/5, 11/17;
// Faraz made 11/5 his PRIMARY (his recurring rules; 11/4-11/6 = 3 = his max) and its backup open.
eq(days.filter((d) => nov(d) && d.primary_id === S3).map((d) => d.day), ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-18"], "T+Y: Acton primary 11/2, 11/4, 11/5 (Y), 11/6, 11/14, 11/15, 11/16, 11/18");
eq(days.filter((d) => nov(d) && d.backup_id === S3).map((d) => d.day), ["2026-11-03", "2026-11-17"], "T+Y: Acton backup 11/3, 11/17 (11/5 backup superseded by Y)");
eq(days.filter((d) => nov(d) && d.backup_id === S5).map((d) => d.day), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"], "T: Fierce backup 11/9-11/16 (amendment B)");
ok(days.filter((d) => nov(d) && d.backup_id === S5).every((d) => d.backup_locked === true), "T: Fierce's eight backup rows are locked");
eq([byDay["2026-11-09"].primary_id, byDay["2026-11-09"].primary_locked, byDay["2026-11-09"].backup_id, byDay["2026-11-09"].backup_locked], [null, false, S5, true], "T: 11/9 = Fierce backup locked, primary open (null slot never locked)");
ok(byDay["2026-11-09"].note.indexOf("seed: " + FIERCE_SRC) === 0, "T: 11/9 provenance is Fierce's 9/22 word: " + byDay["2026-11-09"].note);
eq([byDay["2026-11-14"].primary_id, byDay["2026-11-14"].backup_id, byDay["2026-11-14"].primary_locked, byDay["2026-11-14"].backup_locked], [S3, S5, true, true], "T: 11/14 = Acton P + Fierce B, both locked");
eq([byDay["2026-11-02"].primary_id, byDay["2026-11-02"].backup_id, byDay["2026-11-02"].primary_locked, byDay["2026-11-02"].backup_locked], [S3, S2, true, true], "T: 11/2 = Acton P + Burchett B, both locked");
eq([byDay["2026-11-25"].primary_id, byDay["2026-11-25"].primary_locked, byDay["2026-11-25"].backup_id, byDay["2026-11-25"].backup_locked], [KHAN, true, null, false], "T: 11/25 = Khan primary locked (amendment A; not Burchett), backup open");
eq(byDay["2026-11-25"].note, "seed: faraz-2026-09-22-khan-1125 - Khan covers 11/25, 2026 only", "T: 11/25 provenance is Faraz's 9/22 decision, a one-off (source + the exact row note)");
ok(days.filter(nov).every((d) => [NOV_SRC, FIERCE_SRC, KHAN_SRC, ACTON_1105_SRC].some((src) => d.note.indexOf("seed: " + src) === 0)), "T+Y: every November row carries one of the four 9/22 sources (Y FLIP: 11/5 now carries faraz-2026-09-22-acton-1105)");
["2026-11-17"].forEach((d) => eq([byDay[d].primary_id, byDay[d].primary_locked, byDay[d].backup_id], [null, false, S3], "T: " + d + " Acton backup only, primary open")); // Y FLIP: 11/5 left this list (Acton primary locked, backup open - pinned in the Y block)
["2026-11-07", "2026-11-08", "2026-11-20", "2026-11-23"].forEach((d) => eq([byDay[d].primary_id, byDay[d].backup_id, byDay[d].backup_locked], [S2, null, false], "T: " + d + " Burchett primary only, backup open"));
ok(!days.some((d) => d.day === "2026-11-19" || d.day === "2026-11-21" || d.day === "2026-11-22" || d.day === "2026-11-24"), "T: no row for 11/19, 11/21, 11/22, 11/24 (nobody published)");
eq(plan.infoDeltas.filter((l) => /^11\/25 P Burchett -> Khan \(applied; faraz-2026-09-22-khan-1125\)/.test(l)).length, 1, "T: pendingDeltas records 11/25 Burchett -> Khan: " + plan.infoDeltas.filter((l) => /^11\/25/.test(l)).join(" | "));
["11/9", "11/14", "11/15", "11/16"].forEach((md) => eq(plan.infoDeltas.filter((l) => l.indexOf(md + " B Burchett -> Fierce (applied; fierce-2026-09-22-backup-week)") === 0).length, 1, "T: pendingDeltas records " + md + " backup Burchett -> Fierce"));
{
  // the seed's pendingDeltas rows themselves (source, status and the wording Faraz asked for; the importer renders only the heads)
  const pd = (d, role) => seed.pendingDeltas.find((x) => x.date === d && x.role === role);
  eq([pd("2026-11-25", "primary").surgeon, pd("2026-11-25", "primary").replaces, pd("2026-11-25", "primary").source, pd("2026-11-25", "primary").status], [KHAN, BURCHETT, KHAN_SRC, "applied"], "T: 11/25 delta = Khan replaces Burchett, applied, Faraz's 9/22 source");
  ok(pd("2026-11-25", "primary").note.indexOf("the ER-panel author's document listed Burchett; Faraz 9/22: Khan covers 11/25, 2026 only - a one-off, not a rule") === 0, "T: 11/25 delta note opens with Faraz's wording: " + pd("2026-11-25", "primary").note);
  ["2026-11-09", "2026-11-14", "2026-11-15", "2026-11-16"].forEach((d) => { const x = pd(d, "backup"); eq([x.surgeon, x.replaces, x.source, x.status], [FIERCE, BURCHETT, FIERCE_SRC, "applied"], "T: " + d + " backup delta = Fierce replaces Burchett"); ok(x.note.indexOf("Fierce's derived-week rule is authoritative (Faraz 9/22)") === 0, "T: " + d + " delta note names the rule: " + x.note); });
  eq(seed.existingAssignments.find((a) => a.date === "2026-11-25").note, "Khan covers 11/25, 2026 only", "T: the 11/25 row note is exactly Faraz's wording");
  ok(!JSON.stringify(seed.surgeonRules[KHAN]).match(/11-25|"2026-11"/), "T: no Khan RULE was added for 11/25 (a one-off lives only in existingAssignments)");
}
// The Thanksgiving 2026 unit is exactly Thu 11/26 - Sun 11/29: 11/25 is Khan's one-off and belongs to NO unit;
// Christmas and New Year's keep their eves. Pinned on the seed, on the blob the app reads and on the rules context.
step("holiday units: Thanksgiving 2026 = 11/26..11/29 exactly, 11/25 in no unit (T)");
const TG_DAYS = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
const unit2026 = (name, src) => (src.units["2026"] || []).find((u) => u.name === name);
eq(unit2026("Thanksgiving", seed.holidays).days, TG_DAYS, "seed: Thanksgiving 2026 unit days");
eq(unit2026("Christmas", seed.holidays).days, ["2026-12-24", "2026-12-25"], "seed: Christmas keeps its eve");
eq(unit2026("New Year's", seed.holidays).days, ["2026-12-31", "2027-01-01"], "seed: New Year's keeps its eve");
ok(!Object.keys(seed.holidays.units).some((y) => seed.holidays.units[y].some((u) => u.days.includes("2026-11-25"))), "seed: 11/25 is in no holiday unit of any year");
eq(unit2026("Thanksgiving", plan.blob.holidays).days, TG_DAYS, "blob: Thanksgiving 2026 unit days");
{
  const hctx = R.buildContext({ roster: plan.blob.roster, surgeonRules: plan.blob.surgeonRules, groupRules: plan.blob.groupRules, holidays: plan.blob.holidays, timeOffRows: plan.timeOffRows, availabilityRows: plan.availabilityRows, schedule: {} });
  eq(hctx.holidayByDay["2026-11-26"].days, TG_DAYS, "ctx: the unit 11/26 belongs to is exactly 11/26..11/29");
  eq(hctx.holidayByDay["2026-11-25"], undefined, "ctx: 11/25 belongs to no unit");
  eq(hctx.holidayUnitsAll.filter((u) => u.days.some((d) => d >= "2026-11-01" && d <= "2026-11-30")).map((u) => u.name + ":" + u.days.join(",")), ["Thanksgiving:" + TG_DAYS.join(",")], "ctx: Thanksgiving is the only November unit");
}

/* -------------------------------------------------------- availability */
step("availability rows vs seed statements (counted independently)");
// Expand plan rows back to per-day statements and compare with the seed.
function addDays(s, k) { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
function expand(rows) {
  const set = new Set();
  rows.forEach((r) => {
    for (let d = r.start_date; d <= r.end_date; d = addDays(d, 1)) set.add([r.person_id, r.kind, r.role, d].join("|"));
  });
  return set;
}
const expected = new Set();
Object.keys(seed.surgeonRules).forEach((id) => {
  const r = seed.surgeonRules[id];
  Object.keys(r.explicitAvailable || {}).forEach((m) => {
    const v = r.explicitAvailable[m];
    if (Array.isArray(v)) v.forEach((d) => expected.add([id, "available", "any", d].join("|")));
    else ["primary", "backup"].forEach((role) => (v[role] || []).forEach((d) => expected.add([id, "available", role, d].join("|"))));
  });
  Object.keys(r.explicitBackupOnly || {}).forEach((m) => r.explicitBackupOnly[m].forEach((d) => expected.add([id, "backup_only", "any", d].join("|"))));
  Object.keys(r.explicitUnavailable || {}).forEach((m) => r.explicitUnavailable[m].forEach((d) => expected.add([id, "unavailable", "any", d].join("|"))));
  Object.keys(r.explicitBackupUnavailable || {}).forEach((m) => r.explicitBackupUnavailable[m].forEach((d) => expected.add([id, "no_backup", "backup", d].join("|"))));
});
const got = expand(plan.availabilityRows);
eq([...got].sort(), [...expected].sort(), "expanded plan rows == every dated statement in the seed");
// independent per-person counts from the seed
function count(id, kind, role) { return [...expected].filter((k) => k.startsWith([id, kind, role].join("|") + "|")).length; }
eq(count(BURCHETT, "available", "any"), 7 + 19, "Burchett Oct 7 + Dec 19 dates");
eq(count(BURCHETT, "backup_only", "any"), 1);
eq(count(BURCHETT, "unavailable", "any"), 9);
eq(count(ACTON, "available", "primary"), 10, "Acton Oct 10 primary dates (Y FLIP: T's 7 November dates left - his list is preferences, the days live on as locks)"); eq(count(ACTON, "available", "backup"), 3, "Acton Oct 3 backup dates (Y FLIP: T's 3 November dates left)");
eq(count(BURCHETT, "available", "primary"), 7, "T: Burchett November primary list is role-scoped (7 dates)"); eq(count(BURCHETT, "available", "backup"), 8, "T: Burchett November backup list is role-scoped (8 dates)");
eq(count(PHILIP, "available", "primary"), 8); eq(count(PHILIP, "no_backup", "backup"), 4);
eq(count(KHAN, "available", "any"), 0, "Khan has no dated statements");
ok(!plan.availabilityRows.some((r) => r.person_id === "s6"), "Sarkar windows are NOT rows");
ok(!plan.availabilityRows.some((r) => r.person_id === PHILIP && r.kind === "available" && r.start_date >= "2026-11-01"), "Philip availableWeeks are NOT rows");
ok(plan.availabilityRows.every((r) => r.source === "seed"), "source seed");
ok(plan.availabilityRows.every((r) => /^seed: (Khan|Burchett|Acton|Philip|Fierce|Sarkar) [A-Z][a-z]+ list$/.test(r.note)), "notes are operational provenance only");
// ranges collapsed
ok(plan.availabilityRows.some((r) => r.person_id === BURCHETT && r.kind === "available" && r.start_date === "2026-12-30" && r.end_date === "2027-01-03"), "12/30..1/3 collapsed into one range");
ok(plan.availabilityRows.some((r) => r.person_id === PHILIP && r.kind === "available" && r.role === "primary" && r.start_date === "2026-10-29" && r.end_date === "2026-11-01"), "Philip 10/29..11/1 collapsed");
ok(plan.availabilityRows.length < expected.size, "collapsing reduced the row count (" + plan.availabilityRows.length + " < " + expected.size + ")");
// no overlapping/duplicate keys (the unique index would reject them)
const keys = plan.availabilityRows.map((r) => [r.person_id, r.kind, r.role, r.start_date, r.end_date, r.source].join("|"));
eq(new Set(keys).size, keys.length, "availability keys unique");
// stats agree
eq(plan.stats.availability, plan.availabilityRows.length);
eq(plan.stats.schedule_days, 73); eq(plan.stats.time_off, 7, "stats.time_off: 3 + Burchett's four 2027 weekends (9/22 evening)");
eq(plan.stats.scheduleDays.externalCover, 7); eq(plan.stats.scheduleDays.openBackup, 26, "open backups: 16 October + 11/5 (Y) + 11/7, 11/8, 11/20, 11/23, 11/25 + 4 Thanksgiving days"); eq(plan.stats.scheduleDays.openPrimary, 7, "open primaries in the import: 10/15, 10/24 (9/22 evening) and, since T, 11/9, 11/10, 11/12, 11/13, 11/17 (Y FLIP: 11/5 is Acton's now)");

/* ------------------------------------------------------------ time_off */
step("time_off rows");
const to = plan.timeOffRows;
eq(to.length, 7, "2 Acton + 1 Philip + 4 Burchett (9/22 evening)");
eq(to.filter((t) => t.person_id === ACTON).map((t) => t.start_date + ".." + t.end_date), ["2026-11-19..2026-11-22", "2026-11-25..2026-11-29"]);
eq(to.filter((t) => t.person_id === PHILIP).map((t) => t.start_date + ".." + t.end_date), ["2026-10-15..2026-10-15"]);
eq(to.filter((t) => t.person_id === BURCHETT).map((t) => t.start_date + ".." + t.end_date), ["2027-01-09..2027-01-10", "2027-01-16..2027-01-17", "2027-02-12..2027-02-14", "2027-04-09..2027-04-11"], "Burchett's four 2027 weekends exactly as stated (Sat+Sun in January, Fri-Sun in February and April)");
ok(to.every((t) => t.created_by === "seed"), "created_by 'seed' on every row, public note or not");
ok(to.filter((t) => t.person_id !== BURCHETT).every((t) => t.note === "vacation (seed)"), "private seed notes (Acton, Philip) still scrubbed to 'vacation (seed)'");
ok(to.filter((t) => t.person_id === BURCHETT).every((t) => t.note === "unavailable (stated 9/22)"), "public seed notes (public: true) reach time_off as written: " + JSON.stringify(to.filter((t) => t.person_id === BURCHETT).map((t) => t.note)));
// which seed notes are public is read from the seed here, never from importer.js
const seedVac = [].concat(...Object.keys(seed.surgeonRules).map((id) => (seed.surgeonRules[id].timeOff || []).map((t) => Object.assign({ id: id }, t))));
const privateVacNotes = seedVac.filter((t) => t.note && t.public !== true).map((t) => t.note);
const publicVacNotes = seedVac.filter((t) => t.note && t.public === true).map((t) => t.note);
eq([privateVacNotes.length, publicVacNotes.length], [3, 4], "seed carries 3 private vacation notes (scrubbed) and 4 public ones (written)");
ok(seedVac.filter((t) => t.public === true).every((t) => t.id === BURCHETT && t.source === "burchett-email-2026-09-22"), "the public entries are Burchett's, provenance in the seed only");
const sql = IMP.importSql(plan);
privateVacNotes.forEach((note) => ok(sql.indexOf(note) < 0 && JSON.stringify(to).indexOf(note) < 0, "private seed wording never written: " + note));
publicVacNotes.forEach((note) => ok(sql.indexOf(note) >= 0 && JSON.stringify(to).indexOf(note) >= 0, "public seed wording written: " + note));
ok(sql.indexOf("burchett-email-2026-09-22") < 0 && JSON.stringify(to).indexOf("burchett-email-2026-09-22") < 0 && JSON.stringify(plan.blob).indexOf("burchett-email-2026-09-22") < 0, "time_off provenance (source) stays in the seed - not in the rows, the SQL or the blob");
eq(plan.blob.surgeonRules[BURCHETT].timeOff, [{ start: "2027-01-09", end: "2027-01-10" }, { start: "2027-01-16", end: "2027-01-17" }, { start: "2027-02-12", end: "2027-02-14" }, { start: "2027-04-09", end: "2027-04-11" }], "blob timeOff: dates only - no note, no public flag, no source");
// the dry-run inventory shows the public notes (path -> public), counted separately from the rule-note scrub
eq(plan.noteScrub.counts.timeOffPublic, 4, "noteScrub.counts.timeOffPublic = the public notes kept");
eq(plan.noteScrub.inventory.filter((e) => e.action === "public").map((e) => e.path), ["surgeonRules.s2.timeOff[0].note", "surgeonRules.s2.timeOff[1].note", "surgeonRules.s2.timeOff[2].note", "surgeonRules.s2.timeOff[3].note"], "inventory: one 'public' entry per public time_off note");
ok(plan.noteScrub.inventory.filter((e) => e.action === "public").every((e) => e.to === "time_off" && e.from === "unavailable (stated 9/22)"), "public entries: from = the note, to = 'time_off'");
ok(!plan.noteScrub.inventory.some((e) => /timeOff/.test(e.path) && e.action !== "public"), "private time_off notes are replaced, not inventoried (they never enter the scrub)");

/* ---------------------------------------------------------------- blob */
step("blob");
eq(Object.keys(plan.blob), ["roster", "surgeonRules", "groupRules", "holidays", "settings"]);
eq(plan.blob.roster.length, 6);
plan.blob.roster.forEach((r) => eq(Object.keys(r).sort(), ["active", "code", "fullName", "id", "name", "roles"], r.id + " roster keys"));
ok(!("note" in plan.blob.roster[5]), "roster note dropped");
eq(plan.blob.roster.map((r) => r.code), ["FAK", "MAB", "BDA", "AFP", "NF", "SRK"]);
eq(IMP.impFindKeys(plan.blob, /email|phone|contact/i), [], "no key named email/phone/contact at any depth");
ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(JSON.stringify(plan.blob)), "no email-looking value in the blob");
ok(!("site" in plan.blob) && JSON.stringify(plan.blob).indexOf("traumaCoordinator") < 0 && JSON.stringify(plan.blob).indexOf("adminContact") < 0, "site block stripped");
// RF2 (9/23): the revision paragraphs stay in the seed; the blob carries their count and the last entry's date only
eq(plan.blob.settings, { importedAt: NOW, seedGeneratedOn: seed._meta.generatedOn, seedRevisionCount: seed._meta.revisions.length, seedLastRevision: (String(seed._meta.revisions[seed._meta.revisions.length - 1]).match(/^\d{4}-\d{2}-\d{2}/) || [])[0], seedCoreHash: IMP.impCoreHash(plan.blob) }, "RF2: settings = importedAt, seedGeneratedOn, seedRevisionCount, seedLastRevision, seedCoreHash (fail-before: seedRevisions carried every paragraph; RF2 review fix: no seedCoreHash stamp)");
// groupRules reach the blob minus every note-like key (Prompt 12 F: all of them are engine documentation);
// stripped independently here, never through importer.js
const NOTE_KEY = /^(note|notes)$|Note$|Notes$|Reason$/;
function stripNoteKeys(v) {
  if (Array.isArray(v)) return v.map(stripNoteKeys);
  if (!v || typeof v !== "object") return v;
  const out = {};
  Object.keys(v).forEach((k) => { if (!NOTE_KEY.test(k)) out[k] = stripNoteKeys(v[k]); });
  return out;
}
ok(IMP.impFindKeys(seed.groupRules, NOTE_KEY).length >= 10, "the seed's groupRules carry note-like keys (" + IMP.impFindKeys(seed.groupRules, NOTE_KEY).length + ")");
eq(plan.blob.groupRules, stripNoteKeys(seed.groupRules), "blob groupRules == seed groupRules minus note-like keys");
ok(IMP.impFindKeys(seed.holidays, NOTE_KEY).length >= 1, "the seed's holidays carry note-like keys (" + IMP.impFindKeys(seed.holidays, NOTE_KEY).length + ")");
eq(plan.blob.holidays, stripNoteKeys(seed.holidays), "blob holidays == seed holidays minus note-like keys (unit notes are engine documentation; nothing reads them)");
// explicitListMonths derived
eq(plan.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, "2026-12"], "T: the explicit object entry for November survives the import as written");
eq(plan.blob.surgeonRules[ACTON].explicitListMonths, ["2026-10"], "Y FLIP: Acton's November object entry is gone - his list is preferences (before Y: T's { month: '2026-11', roles: [primary, backup] })");
eq(plan.blob.surgeonRules[PHILIP].explicitListMonths, [{ month: "2026-10", roles: ["primary"] }]);
ok(!("explicitListMonths" in plan.blob.surgeonRules[KHAN]), "no list -> no key");
const derived = IMP.impSeedSurgeonRules({ surgeonRules: {
  a: { explicitAvailable: { "2027-02": { primary: ["2027-02-01"], backup: ["2027-02-02"] } } },
  b: { explicitAvailable: { "2027-02": { backup: ["2027-02-02"] } } },
  c: { explicitAvailable: { "2027-03": ["2027-03-01"], "2027-02": ["2027-02-01"] }, explicitListMonths: [{ month: "2027-02", roles: ["primary"] }] }
} });
eq(derived.a.explicitListMonths, ["2027-02"], "both roles -> plain month");
eq(derived.b.explicitListMonths, [{ month: "2027-02", roles: ["backup"] }], "one role -> scoped");
eq(derived.c.explicitListMonths, [{ month: "2027-02", roles: ["primary"] }, "2027-03"], "seed entry kept as written, missing month appended");
// the seed object is never mutated
const before = JSON.stringify(seed);
IMP.importPlan(seed, { now: NOW });
eq(JSON.stringify(seed), before, "importPlan does not mutate the seed");
// the seed's own explicitAvailableNote is engine documentation ("added 2026-...", "locked primary"): dropped from the blob (Prompt 12 F)
ok(/added 2026-/.test(seed.surgeonRules[BURCHETT].explicitAvailableNote), "seed keeps its documentation note");
ok(!("explicitAvailableNote" in plan.blob.surgeonRules[BURCHETT]), "documentation note dropped from the blob");

/* ---------------------------------------------------- ctx equivalence */
step("ctx from imported rows == ctx from the seed adapter");
function rowsToSchedule(rows) {
  const out = {};
  rows.forEach((r) => { out[r.day] = { primary: r.primary_id, backup: r.backup_id, primaryLocked: r.primary_locked, backupLocked: r.backup_locked, source: r.source, externalCover: r.external_cover, note: r.note }; });
  return out;
}
function project(ctx) {
  const setArr = (s) => [...s].sort();
  const per = {};
  Object.keys(ctx.per).forEach((id) => {
    const P = ctx.per[id];
    per[id] = { vacation: setArr(P.vacation), dayBefore: setArr(P.dayBeforeVacation), avail: P.avail, governed: P.governedMonths, weekDays: setArr(P.weekDays),
      weeksFromN: P.weeksFromN, windowDays: setArr(P.windowDays), maxConsec: P.maxConsec,
      // 9/22 (Prompt 12 K): the cap fields are capPrimary / capPreferred / countsEastDays / eastPrimaryDays (capTotal no longer exists)
      capPrimary: P.capPrimary, capPreferred: P.capPreferred, countsEastDays: P.countsEastDays, eastPrimaryDays: P.eastPrimaryDays.size, hardNever: setArr(P.hardNever),
      holidaysOff: setArr(P.holidaysOff), maxMajor: P.maxMajor, mode: P.mode, active: P.active };
  });
  const sched = {};
  Object.keys(ctx.schedule).sort().forEach((d) => { const s = ctx.schedule[d]; sched[d] = { p: s.primary, b: s.backup, pl: s.primaryLocked, bl: s.backupLocked, x: s.externalCover }; });
  // ctx.weights is groupRules.weights copied wholesale (rules.js buildContext); the seed's copy carries a documentation
  // `note` string the importer drops from the blob and rules.js never reads - compared minus note-like keys.
  return { per, sched, units: ctx.holidayUnitsAll, active: ctx.activeIds, weights: stripNoteKeys(ctx.weights), defaultCap: ctx.defaultCap };
}
const appCtx = R.buildContext({ roster: plan.blob.roster, surgeonRules: plan.blob.surgeonRules, groupRules: plan.blob.groupRules, holidays: plan.blob.holidays,
  timeOffRows: plan.timeOffRows, availabilityRows: plan.availabilityRows, schedule: rowsToSchedule(plan.scheduleDayRows) });
const testCtx = R.buildContext(SA.seedToContextInput(seed));
eq(IMP.impCanon(project(appCtx)), IMP.impCanon(project(testCtx)), "same per-surgeon precompute, schedule and holiday units");
// the cap pin is not vacuous: the projected fields carry the seed's real values (never undefined on both sides)
// and a perturbed copy of one side no longer compares equal
eq([project(appCtx).per[FIERCE].capPrimary, project(appCtx).per[FIERCE].countsEastDays, project(appCtx).per[BURCHETT].capPrimary, project(appCtx).per[BURCHETT].capPreferred, project(appCtx).per[KHAN].capPrimary],
  [14, true, 8, 7, null], "projection carries capPrimary / capPreferred / countsEastDays from the imported rules (K)");
ok(Object.keys(project(appCtx).per).every((id) => typeof project(appCtx).per[id].eastPrimaryDays === "number"), "projection carries eastPrimaryDays.size");
const perturbedProj = project(appCtx); perturbedProj.per[FIERCE].capPrimary = 13;
ok(IMP.impCanon(perturbedProj) !== IMP.impCanon(project(testCtx)), "a perturbed capPrimary on one side breaks the round-trip pin (non-vacuous)");
eq(appCtx.warnings, [], "no buildContext warnings from imported rows");
// and eligibility agrees on a spread of days/roles
let checked = 0;
for (let d = "2026-10-01"; d <= "2027-01-03"; d = addDays(d, 1)) {
  ["primary", "backup"].forEach((role) => appCtx.allIds.forEach((id) => {
    const a = R.eligibility(appCtx, d, role, id), b = R.eligibility(testCtx, d, role, id);
    checked++;
    if (IMP.impCanon(a) !== IMP.impCanon(b)) throw new Error("eligibility differs " + d + " " + role + " " + id + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b));
  }));
}
ok(checked > 1000, "eligibility identical on " + checked + " (day, role, surgeon) triples");

/* ------------------------------------------------------- seed adapter */
step("seed adapter delegate keeps its contract");
eq(SA.seedToAvailabilityRows(seed).length, expected.size, "adapter: one row per dated statement");
eq(SA.seedToTimeOffRows(seed).length, 7, "adapter: 7 vacation rows (Acton 2, Philip 1, Burchett 4)");
eq(Object.keys(SA.seedToSchedule(seed)).length, 73);
eq(SA.seedToSurgeonRules(seed)[PHILIP].explicitListMonths, [{ month: "2026-10", roles: ["primary"] }]);

/* ------------------------------------------------------------ refusal */
step("contact-data refusal");
function refuses(mutate, label) {
  const fx = clone(seed);
  mutate(fx);
  let msg = null;
  try { IMP.importPlan(fx, { now: NOW }); } catch (e) { msg = e.message; }
  ok(msg && /^CONTACT_DATA_REFUSED/.test(msg), label + " -> refused (" + (msg || "no error").slice(0, 60) + ")");
}
refuses((fx) => { fx.roster[1].email = "x"; }, "roster email key");
refuses((fx) => { fx.roster[3].Phone = "x"; }, "roster Phone key (case-insensitive)");
refuses((fx) => { fx.roster[0].extra = { deep: { homeEmail: "x" } }; }, "roster nested key");
refuses((fx) => { fx.site.traumaCoordinator.email = "x"; }, "site nested email key");
refuses((fx) => { fx.site.adminContact.phone = "x"; }, "site phone key");
refuses((fx) => { fx.roster[5].note = "reach at someone@example.com"; }, "email-looking value under roster");
refuses((fx) => { fx.groupRules.email = "x"; }, "blob leak: groupRules key named email");
ok(plan.refusals.length === 0, "clean seed: no refusals");
// a seed with a different id mix still works (no surgeon-specific code)
const tiny = { _meta: { generatedOn: "2026-01-01", revisions: [] }, roster: [{ id: "z9", name: "Zed", code: "ZZZ", fullName: "Z", active: true, roles: ["surgeon"] }],
  surgeonRules: { z9: { explicitAvailable: { "2027-05": ["2027-05-03", "2027-05-04", "2027-05-06"] }, timeOff: [{ start: "2027-05-10", end: "2027-05-12", note: "secret" }] } },
  groupRules: {}, holidays: {}, existingAssignments: [{ date: "2027-05-03", primary: "z9", backup: null, locked: true, source: "test" }], pendingDeltas: [] };
const tp = IMP.importPlan(tiny, { now: NOW });
eq(tp.availabilityRows.map((r) => r.start_date + ".." + r.end_date), ["2027-05-03..2027-05-04", "2027-05-06..2027-05-06"]);
eq(tp.blob.surgeonRules.z9.explicitListMonths, ["2027-05"]);
eq(tp.timeOffRows[0].note, "vacation (seed)");
eq(tp.scheduleDayRows[0].backup_locked, false);

/* ---------------------------------------------------------------- SQL */
step("SQL idempotency shape");
ok(/^[\x00-\x7f]*$/.test(sql), "SQL is 7-bit ASCII (non-ASCII escaped inside jsonb AND in text columns)");
// a text column carrying non-ASCII (the 10/24 note's em dash) is emitted as an E'' literal with \uXXXX; ASCII strings stay plain '...'
ok(sql.indexOf("E'seed: faraz-2026-09-22-sarkar-two-days - open \\u2014 Sarkar at two days per week from 9/22'") >= 0, "10/24 note -> E'' literal with \\u2014 (found: " + JSON.stringify((sql.match(/E'seed: faraz[^']*'/) || [])[0]) + ")");
ok(sql.indexOf("'seed: office-er-call-panels-2026-09-16'") >= 0 && !/E'seed: holly/.test(sql), "ASCII notes keep the plain '...' literal");
// the non-ASCII test is stateless: consecutive non-ASCII notes, an ASCII one between them and a repeat all classify the same way
const fxNA = clone(seed);
fxNA.existingAssignments.filter((a) => ["2026-10-19", "2026-10-20", "2026-10-21"].indexOf(a.date) >= 0).forEach((a, i) => { a.note = i === 1 ? "plain" : "caf" + String.fromCharCode(233) + " " + i; });
const sqlNA = IMP.importSql(IMP.importPlan(fxNA, { now: NOW }));
eq((sqlNA.match(/E'seed: [^']*caf\\u00e9 [02]'/g) || []).length, 2, "both non-ASCII notes become E'' literals whatever came before them");
ok(/'seed: [a-z0-9-]+ - plain'/.test(sqlNA) && !/E'seed: [a-z0-9-]+ - plain'/.test(sqlNA), "the ASCII note between them stays a plain literal");
ok(/^[\x00-\x7f]*$/.test(sqlNA), "still 7-bit");
ok(/^begin;/m.test(sql) && /^commit;/m.test(sql), "one transaction");
const stmts = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
const inserts = stmts.filter((s) => /^insert\s+into/i.test(s));
ok(inserts.length >= 1 + 1 + 1 + 1 + 7, "snapshot + blob + schedule_days + availability + 7 time_off inserts (" + inserts.length + ")");
inserts.forEach((s) => {
  const table = (s.match(/^insert\s+into\s+(\S+)/i) || [])[1];
  if (/call_schedule_snapshots/.test(table)) ok(/\bwhere\s+exists/i.test(s), "snapshot insert is conditional");
  else ok(/on conflict/i.test(s) || /where not exists/i.test(s), table + " insert is guarded (" + (/on conflict/i.test(s) ? "ON CONFLICT" : "WHERE NOT EXISTS") + ")");
});
ok(/on conflict \(person_id, kind, role, start_date, end_date, coalesce\(source, ''\)\)/.test(sql), "availability conflict target matches availability_stmt_uniq");
ok(/on conflict \(day\) do update set[\s\S]*where schedule_days\.source = 'import'/.test(sql), "schedule_days update guarded by source = 'import'");
ok(/version\s*=\s*schedule_days\.version \+ 1/.test(sql), "schedule_days update bumps version");
ok(/is distinct from/.test(sql.slice(sql.indexOf("schedule_days (day"))), "schedule_days update only when something differs");
ok(/\(coalesce\(call_schedule_data\.data, '\{\}'::jsonb\) - 'settings'\) \|\| /.test(sql), "blob merges into the existing data (M review 9/22: settings set apart, the roster re-set with the live outside surgeons kept)");
ok(/'\{settings\}'/.test(sql), "settings merged one level deeper");
ok(/before_seed_import/.test(sql) && sql.indexOf("call_schedule_snapshots") < sql.indexOf("call_schedule_data (id"), "snapshot comes first");
ok(sql.indexOf("into public.schedule_days") < sql.indexOf("into public.time_off"), "schedule_days before time_off so the ON_CALL_CONFLICT trigger sees the schedule");
eq((sql.match(/insert into public\.time_off/g) || []).length, 7, "one guarded insert per time_off row (7)");
// the stale-row delete guard lists all 7 (person, start, end) tuples - Burchett's four included
const toGuard = sql.slice(sql.indexOf("delete from public.time_off"), sql.indexOf("insert into public.time_off"));
const toTuples = to.map((r) => "('" + r.person_id + "', '" + r.start_date + "'::date, '" + r.end_date + "'::date)");
eq(toTuples.filter((t) => toGuard.indexOf(t) >= 0).length, 7, "time_off delete guard lists the 7 tuples");
ok(toGuard.indexOf("('s2', '2027-01-09'::date, '2027-01-10'::date)") >= 0 && toGuard.indexOf("('s2', '2027-04-09'::date, '2027-04-11'::date)") >= 0, "Burchett's first and last 2027 ranges are in the guard");
// simulate applying twice in an in-memory model keyed the way the SQL is: second pass changes nothing
function applyToModel(model, p) {
  const changed = { sd: 0, av: 0, to: 0 };
  p.scheduleDayRows.forEach((r) => { const l = model.schedule_days.find((x) => x.day === r.day); if (!l) { model.schedule_days.push(clone(r)); changed.sd++; } else if (l.source === "import" && IMP.impCanon(l) !== IMP.impCanon(Object.assign({}, r, { version: l.version }))) { Object.assign(l, r, { version: l.version + 1 }); changed.sd++; } });
  p.availabilityRows.forEach((r) => { const k = (x) => [x.person_id, x.kind, x.role, x.start_date, x.end_date, x.source].join("|"); const l = model.availability.find((x) => k(x) === k(r)); if (!l) { model.availability.push(clone(r)); changed.av++; } else if (l.note !== r.note) { l.note = r.note; changed.av++; } });
  p.timeOffRows.forEach((r) => { const l = model.time_off.find((x) => x.person_id === r.person_id && x.start_date === r.start_date && x.end_date === r.end_date); if (!l) { model.time_off.push(clone(r)); changed.to++; } });
  model.blob = Object.assign({}, model.blob, p.blob);
  return changed;
}
const model = { blob: {}, schedule_days: [], availability: [], time_off: [] };
eq(applyToModel(model, plan), { sd: 73, av: plan.availabilityRows.length, to: 7 }, "first apply writes everything");
eq(applyToModel(model, plan), { sd: 0, av: 0, to: 0 }, "second apply writes nothing");
ok(model.schedule_days.every((d) => d.version === 1), "versions untouched by the no-op re-run");

/* ------------------------------------------------------------ planDiff */
step("planDiff");
const d0 = IMP.planDiff(plan, { blob: {}, availability: [], time_off: [], schedule_days: [] });
eq(d0.tables.schedule_days.insert, 73); eq(d0.tables.availability.insert, plan.availabilityRows.length); eq(d0.tables.time_off.insert, 7);
eq(d0.tables.call_schedule_data.insert, 5); eq(d0.blocked, []); eq(d0.changes, []);
eq(d0.totalChanges, 5 + 73 + plan.availabilityRows.length + 7);
const liveEq = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
liveEq.blob.settings.importedAt = "2020-01-01T00:00:00Z"; // a different import time is not a change
liveEq.blob.settings.appAdded = true;                        // keys the app added are ignored
liveEq.blob.extraTopLevel = { keep: 1 };
const d1 = IMP.planDiff(plan, liveEq);
eq(d1.totalChanges, 0, "live == plan -> nothing"); eq(d1.changes, []); eq(d1.blocked, []);
ok(/No changes/.test(d1.text));
eq(d1.tables.schedule_days.unchanged, 73); eq(d1.tables.availability.unchanged, plan.availabilityRows.length); eq(d1.tables.time_off.unchanged, 7);
// the expected live diff for the orchestrator (item S): live = tonight's rows before S -> 1 schedule_days update (10/24), 4 time_off inserts, blob update, availability unchanged
const livePreS = clone(liveEq);
Object.assign(livePreS.schedule_days.find((d) => d.day === "2026-10-24"), { primary_id: "s6", primary_locked: true, note: "seed: burchett-email-2026-09-17" });
livePreS.time_off = livePreS.time_off.filter((t) => t.person_id !== BURCHETT);
livePreS.blob.surgeonRules = clone(plan.blob.surgeonRules); livePreS.blob.surgeonRules.s6.availableWindows[0].end = "2026-10-24";
const dS = IMP.planDiff(plan, livePreS);
eq([dS.tables.schedule_days.update, dS.tables.time_off.insert, dS.tables.availability.insert + dS.tables.availability.update + dS.tables.availability.delete, dS.tables.call_schedule_data.update, dS.tables.time_off.delete], [1, 4, 0, 1, 0], "expected live diff: 1 day update, 4 vacation inserts, blob update, availability untouched, no deletes");
eq(dS.changes, ["10/24 P Sarkar -> OPEN"], "the one day change is 10/24 primary Sarkar -> OPEN");
eq(dS.tables.time_off.rows, ["insert Burchett 2027-01-09..2027-01-10", "insert Burchett 2027-01-16..2027-01-17", "insert Burchett 2027-02-12..2027-02-14", "insert Burchett 2027-04-09..2027-04-11"]);
// the expected live diff for the orchestrator (item T): live = the rows as they stand before T (no November rows before
// 11/26, no November availability for Burchett / Acton, the blob without their November lists) -> 20 schedule_days
// inserts, the November availability inserts (collapsed ranges of the two role-scoped lists), one blob update, nothing
// deleted, nothing blocked, no time_off change.
const livePreT = clone(liveEq);
livePreT.schedule_days = livePreT.schedule_days.filter((d) => !(d.day >= "2026-11-02" && d.day <= "2026-11-25"));
livePreT.availability = livePreT.availability.filter((r) => !((r.person_id === BURCHETT || r.person_id === ACTON) && r.start_date >= "2026-11-01" && r.start_date <= "2026-11-30"));
livePreT.blob.surgeonRules = clone(plan.blob.surgeonRules);
[BURCHETT, ACTON].forEach((id) => { delete livePreT.blob.surgeonRules[id].explicitAvailable["2026-11"]; livePreT.blob.surgeonRules[id].explicitListMonths = livePreT.blob.surgeonRules[id].explicitListMonths.filter((e) => typeof e === "string"); });
const novAvail = plan.availabilityRows.filter((r) => (r.person_id === BURCHETT || r.person_id === ACTON) && r.start_date >= "2026-11-01" && r.start_date <= "2026-11-30");
ok(novAvail.length >= 4 && novAvail.every((r) => r.kind === "available" && (r.role === "primary" || r.role === "backup")), "T: the November availability rows are role-scoped available rows (" + novAvail.length + ")");
const dT = IMP.planDiff(plan, livePreT);
eq([dT.tables.schedule_days.insert, dT.tables.schedule_days.update, dT.tables.schedule_days.delete, dT.tables.schedule_days.blocked, dT.tables.availability.insert, dT.tables.availability.update, dT.tables.availability.delete, dT.tables.call_schedule_data.update, dT.tables.time_off.insert, dT.tables.time_off.delete], [20, 0, 0, 0, novAvail.length, 0, 0, 1, 0, 0], "T: expected live diff = 20 day inserts, " + novAvail.length + " availability inserts, 1 blob update, no deletes, no time_off change (got " + JSON.stringify(dT.tables) + ")");
eq(dT.tables.schedule_days.byMonth["2026-11"], { insert: 20, update: 0, unchanged: 5, blocked: 0, delete: 0 }, "T: November = 20 inserts + the unchanged 11/1 and the 4 Thanksgiving rows");
eq(dT.changes, [], "T: pure inserts - no update line (an insert is counted, not listed as a change)");
eq(dT.blocked, [], "T: nothing blocked");
ok(new RegExp("schedule_days: insert 20, update 0, delete 0, unchanged 53").test(dT.text), "T: the dry-run text reads 'schedule_days: insert 20, update 0, delete 0, unchanged 53': " + dT.text.split("\n").filter((l) => /^schedule_days:/.test(l)).join(" | "));
// a changed import day -> update line; an app-edited day -> blocked, never counted as a change
const liveMod = clone(liveEq);
liveMod.schedule_days.find((d) => d.day === "2026-10-12").primary_id = PHILIP;
liveMod.schedule_days.find((d) => d.day === "2026-10-13").backup_id = BURCHETT;
liveMod.schedule_days.find((d) => d.day === "2026-10-13").source = "manual";
const d2 = IMP.planDiff(plan, liveMod);
eq(d2.changes, ["10/12 P Philip -> Fierce"], "update rendered as 'M/D P Name -> Name'");
eq(d2.tables.schedule_days.update, 1); eq(d2.tables.schedule_days.blocked, 1);
ok(d2.blocked.length === 1 && /^10\/13 B Burchett -> OPEN \[BLOCKED: live source 'manual'/.test(d2.blocked[0]), "app-edited day reported as blocked");
eq(d2.totalChanges, 1, "blocked rows do not count as changes");
// an app-FILLED slot on an import-locked day (source still 'import', updated_by = a person) is app-owned: blocked, never overwritten
const liveFilled = clone(liveEq);
Object.assign(liveFilled.schedule_days.find((d) => d.day === "2026-11-26"), { backup_id: BURCHETT, updated_by: "s1", version: 2 });
const d2b = IMP.planDiff(plan, liveFilled);
eq(d2b.tables.schedule_days.blocked, 1, "app-filled Thanksgiving backup is blocked");
ok(String(d2b.blocked[0] || "").startsWith("11/26 B Burchett -> OPEN [BLOCKED: live source 'import' updated_by 's1'"), "blocked line names the app owner: " + d2b.blocked[0]);
eq(d2b.totalChanges, 0, "and it is not a change");
ok(IMP.importSql(plan).includes("where schedule_days.source = 'import'\n  and coalesce(schedule_days.updated_by, 'seed') = 'seed'"), "SQL upsert guard requires seed ownership (updated_by)");
const d3 = IMP.planDiff(plan, Object.assign({}, liveEq, { availability: liveEq.availability.slice(1).concat([Object.assign({}, liveEq.availability[0], { note: "old" })]) }));
eq(d3.tables.availability.update, 1, "note change -> update");

/* --------------------------------- contact-looking VALUES in the output (imp-3) */
step("contact-looking values in rule notes / day notes / provenance are refused (output-side guard)");
refuses((fx) => { fx.surgeonRules.s2.notes.push("per injected@example.test"); }, "email in surgeonRules.s2.notes");
refuses((fx) => { fx.surgeonRules.s5.notes.push("reach someone@example.test"); }, "email in surgeonRules.s5.notes");
refuses((fx) => { fx.surgeonRules.s6.notes.push("admin 555-555-0100"); }, "phone in surgeonRules.s6.notes");
refuses((fx) => { fx.surgeonRules.s1.notes.push("call (555) 555-0100 first"); }, "phone with parens in notes");
refuses((fx) => { fx.surgeonRules.s3.explicitAvailableNote = "text 555.555.0100"; }, "dotted phone in a rule note");
refuses((fx) => { fx.surgeonRules.s4.notes.push("desk +1 555 555 0100"); }, "+1 spaced phone in notes");
refuses((fx) => { fx.existingAssignments[0].note = "confirmed by injected@example.test"; }, "email in existingAssignments note");
refuses((fx) => { fx.existingAssignments[1].note = "text 5555550100"; }, "10-digit phone in existingAssignments note");
refuses((fx) => { fx.existingAssignments[2].source = "someone@example.test"; }, "email in the provenance source string");
refuses((fx) => { fx.roster[2].note = "cell 555-555-0100"; }, "phone VALUE under roster (was accepted before)");
refuses((fx) => { fx.site.adminContact.desk = "5555550100"; }, "10-digit value under site");
refuses((fx) => { fx.groupRules.locks.note += " ask 555-555-0100"; }, "phone in groupRules");
refuses((fx) => { fx.holidays.note = "someone@example.test"; }, "email in holidays");
refuses((fx) => { fx.pendingDeltas[0].source = "x@example.test"; }, "email in a pendingDelta source (would be printed)");
// no false positives on the shapes the seed really carries (the whole real seed passed above)
eq(IMP.impFindContactValues({ a: "2026-09-16 07:00 to 2026-10-04", b: "s1 s2 s3", c: "10/15 and 11/26-11/29", d: "version 1.2.3", e: "Total 8 / preferred 7", f: NOW, g: "2026-12-30..2027-01-03" }), [], "dates, ranges, ids, times are not contact data");
ok(IMP.impFindEmailValues({ x: "a@example.test" }).length === 1 && IMP.impFindPhoneValues({ x: ["", { y: "555-555-0100" }] }).join() === "x[1].y", "value finders report paths, never values");
ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(sql), "generated SQL carries no email-looking value");
eq(IMP.impFindContactValues(sql), [], "generated SQL carries no phone-looking value");

/* ------------------------------------------ stale seed-owned rows (imp-4) */
step("stale seed-owned rows: removed / moved statements are deleted; app-owned rows are never touched");
const kAv = (x) => [x.person_id, x.kind, x.role, x.start_date, x.end_date].join("|");
const kTo = (x) => [x.person_id, x.start_date, x.end_date].join("|");
function edited(mutate) { const fx = clone(seed); mutate(fx); return { fx, plan: IMP.importPlan(fx, { now: NOW }) }; }
// the SQL's deletes, applied to the in-memory model the same way Postgres would
function applyWithDeletes(model, p) {
  const c = applyToModel(model, p);
  const before = model.schedule_days.length + model.availability.length + model.time_off.length;
  const keepSd = new Set(p.scheduleDayRows.map((r) => r.day)), keepAv = new Set(p.availabilityRows.map(kAv)), keepTo = new Set(p.timeOffRows.map(kTo));
  if (p.scheduleDayRows.length) model.schedule_days = model.schedule_days.filter((r) => !(r.source === "import" && r.updated_by === "seed" && !keepSd.has(r.day)));
  if (p.availabilityRows.length) model.availability = model.availability.filter((r) => !(r.source === "seed" && !keepAv.has(kAv(r))));
  if (p.timeOffRows.length) model.time_off = model.time_off.filter((r) => !(r.created_by === "seed" && !keepTo.has(kTo(r))));
  c.del = before - (model.schedule_days.length + model.availability.length + model.time_off.length);
  return c;
}
function asLive(model) { return { blob: model.blob, availability: model.availability, time_off: model.time_off, schedule_days: model.schedule_days }; }
function ctxOf(model) { return R.buildContext({ roster: model.blob.roster, surgeonRules: model.blob.surgeonRules, groupRules: model.blob.groupRules, holidays: model.blob.holidays, timeOffRows: model.time_off, availabilityRows: model.availability, schedule: rowsToSchedule(model.schedule_days) }); }
function converges(label, e) {
  const m = { blob: {}, schedule_days: [], availability: [], time_off: [] };
  applyWithDeletes(m, plan);                       // first import = tonight's live state
  const c = applyWithDeletes(m, e.plan);           // re-import of the edited seed
  eq(IMP.planDiff(e.plan, asLive(m)).totalChanges, 0, label + ": live == edited plan after the re-import");
  eq(applyWithDeletes(m, e.plan), { sd: 0, av: 0, to: 0, del: 0 }, label + ": a third pass is a no-op");
  eq([...expand(m.availability)].sort(), [...expand(e.plan.availabilityRows)].sort(), label + ": live statements == edited seed's statements");
  eq(m.time_off.map(kTo).sort(), e.plan.timeOffRows.map(kTo).sort(), label + ": live vacations == edited seed's vacations");
  eq(m.schedule_days.map((r) => r.day).sort(), e.plan.scheduleDayRows.map((r) => r.day).sort(), label + ": live days == edited seed's days");
  // and the ctx the app would build from the re-imported rows == the ctx the tests build from the edited seed
  const a = ctxOf(m), b = R.buildContext(SA.seedToContextInput(e.fx));
  eq(IMP.impCanon(project(a)), IMP.impCanon(project(b)), label + ": ctx from re-imported rows == ctx from edited seed");
  return { model: m, changed: c, ctx: a };
}
// (a) 11/29 removed from existingAssignments -> that day is deleted (it used to be 'No changes')
const eA = edited((fx) => { fx.existingAssignments = fx.existingAssignments.filter((a) => a.date !== "2026-11-29"); });
const dA = IMP.planDiff(eA.plan, liveEq);
eq(dA.tables.schedule_days.delete, 1, "11/29 reported as delete"); eq(dA.totalDeletes, 1); eq(dA.totalChanges, 1, "counted as a change");
ok(dA.changes.some((l) => /^11\/29 P Khan \/ B OPEN -> deleted/.test(l)), "delete rendered: " + dA.changes.join(" | "));
ok(/Total changes: 1 \(incl\. 1 delete/.test(dA.text));
const sqlA = IMP.importSql(eA.plan);
ok(/delete from public\.schedule_days\n where source = 'import' and updated_by = 'seed'\n   and day not in \('2026-09-14'::date/.test(sqlA), "guarded set-based delete on schedule_days");
const sdDeleteA = sqlA.slice(sqlA.indexOf("delete from public.schedule_days"), sqlA.indexOf("insert into public.schedule_days"));
ok(sdDeleteA.indexOf("'2026-11-29'::date") < 0 && sdDeleteA.indexOf("'2026-11-28'::date") > 0, "keep-list = the edited seed's days");
converges("11/29 removed", eA);
// an app-touched 11/29 is never deleted, whichever way the app marked it
[["source", "manual"], ["source", "generated"], ["updated_by", "s1"]].forEach(([k, v]) => {
  const lv = clone(liveEq); lv.schedule_days.find((d) => d.day === "2026-11-29")[k] = v;
  const d = IMP.planDiff(eA.plan, lv);
  eq(d.tables.schedule_days.delete, 0, "app-owned day (" + k + "=" + v + ") is not stale"); eq(d.totalChanges, 0);
});
// (b) Philip's vacation moved 10/15 -> 10/16: old row deleted, new inserted (both days used to block him)
const eB = edited((fx) => { fx.surgeonRules.s4.timeOff[0].start = "2026-10-16"; fx.surgeonRules.s4.timeOff[0].end = "2026-10-16"; });
const dB = IMP.planDiff(eB.plan, liveEq);
eq(dB.tables.time_off.insert, 1); eq(dB.tables.time_off.delete, 1);
ok(dB.tables.time_off.rows.some((l) => /^delete Philip 2026-10-15\.\.2026-10-15 \(seed-owned/.test(l)), "vacation delete rendered");
ok(/delete from public\.time_off\n where created_by = 'seed'\n   and \(person_id, start_date, end_date\) not in \(\('s2', '2027-01-09'::date, '2027-01-10'::date\), .*\('s3', '2026-11-19'::date, '2026-11-22'::date\)/.test(IMP.importSql(eB.plan)), "guarded set-based delete on time_off (Burchett's rows lead the tuple list)");
const rB = converges("vacation moved", eB);
ok(!rB.ctx.per.s4.vacation.has("2026-10-15") && rB.ctx.per.s4.vacation.has("2026-10-16"), "10/15 no longer a vacation day for Philip, 10/16 is");
// a self-entered vacation (created_by = the surgeon) is never deleted
const liveSelf = clone(liveEq); liveSelf.time_off.push({ person_id: "s2", start_date: "2026-12-01", end_date: "2026-12-02", note: "vacation", created_by: "s2" });
eq(IMP.planDiff(plan, liveSelf).tables.time_off.delete, 0, "self-entered vacation not stale"); eq(IMP.planDiff(eB.plan, liveSelf).tables.time_off.delete, 1);
// (c) Burchett 12/23 removed from the December list: the old collapsed range goes, its replacement comes, 12/23 closes
const eC = edited((fx) => { fx.surgeonRules.s2.explicitAvailable["2026-12"] = fx.surgeonRules.s2.explicitAvailable["2026-12"].filter((d) => d !== "2026-12-23"); });
const dC = IMP.planDiff(eC.plan, liveEq);
ok(dC.tables.availability.delete >= 1, "row(s) carrying 12/23 deleted (" + dC.tables.availability.delete + " delete, " + dC.tables.availability.insert + " insert; 12/23 is its own single-day row in the seed)");
ok(dC.tables.availability.rows.some((l) => /^delete s2 available\/any 2026-12-23/.test(l)), "the 12/23 row is the one deleted: " + dC.tables.availability.rows.join(" | "));
eq(dC.tables.call_schedule_data.keys.surgeonRules, "update", "surgeonRules blob updates too");
eq(dC.tables.call_schedule_data.update, 2, "RF2 review fix: ...and settings with it - the seedCoreHash stamp follows the seed-owned content (surgeonRules + settings = 2 blob updates; fail-before: 1)");
ok(/delete from public\.availability\n where source = 'seed'\n   and \(person_id, kind, role, start_date, end_date\) not in \(/.test(IMP.importSql(eC.plan)), "guarded set-based delete on availability");
const rC = converges("12/23 removed", eC);
ok(!expand(rC.model.availability).has("s2|available|any|2026-12-23"), "12/23 statement gone from the live rows");
ok(R.eligibility(rC.ctx, "2026-12-23", "primary", BURCHETT).ok === false, "eligibility(s2, 12/23) is no longer ok from the re-imported rows");
ok(R.eligibility(rC.ctx, "2026-12-22", "primary", BURCHETT).ok === R.eligibility(appCtx, "2026-12-22", "primary", BURCHETT).ok, "neighbouring day unaffected");
// (d) Acton's 11/19-22 vacation removed -> the time_off row is deleted, not left behind
const eD = edited((fx) => { fx.surgeonRules.s3.timeOff = fx.surgeonRules.s3.timeOff.filter((t) => t.start !== "2026-11-19"); });
eq(IMP.planDiff(eD.plan, liveEq).tables.time_off.delete, 1); converges("Acton vacation removed", eD);
// (e) Burchett 12/29 added: the two old ranges around it are replaced by one superset row
const eE = edited((fx) => { fx.surgeonRules.s2.explicitAvailable["2026-12"].push("2026-12-29"); });
const dE = IMP.planDiff(eE.plan, liveEq);
eq(dE.tables.availability.insert, 1); eq(dE.tables.availability.delete, 2, "12/25..12/28 and 12/30..01/03 deleted, 12/25..01/03 inserted");
converges("12/29 added", eE);
// (f) rows from setup / email keep their own source and are never stale
const liveSetup = clone(liveEq); liveSetup.availability.push({ person_id: "s1", kind: "available", role: "any", start_date: "2026-12-05", end_date: "2026-12-05", note: "setup", source: "setup" });
eq(IMP.planDiff(plan, liveSetup).tables.availability.delete, 0, "source 'setup' row not stale");
// (g) safety valve: a plan with NO rows for a table never deletes that table's seed-owned rows
const eG = edited((fx) => { Object.values(fx.surgeonRules).forEach((r) => { delete r.timeOff; }); });
const dG = IMP.planDiff(eG.plan, liveEq);
eq(dG.tables.time_off.delete, 0); eq(dG.tables.time_off.kept, 7); eq(dG.kept.length, 7, "7 seed vacations listed as kept");
ok(dG.kept.every((l) => /^time_off .* \[KEPT: plan has no time_off rows/.test(l)), dG.kept.join(" | "));
eq(dG.tables.time_off.insert + dG.tables.time_off.update + dG.tables.availability.insert + dG.tables.availability.update + dG.tables.schedule_days.insert + dG.tables.schedule_days.update, 0, "only the blob update counts (no row change)");
eq(dG.totalChanges, 2, "RF2 review fix: the blob update = surgeonRules + settings (the seedCoreHash stamp follows the seed-owned content; fail-before: 1)");
ok(/-- 5a\. time_off: plan has no rows - seed-owned live rows left alone/.test(IMP.importSql(eG.plan)) && !/delete from public\.time_off/.test(IMP.importSql(eG.plan)), "no time_off delete emitted");
// (h) SQL shape: every delete is ownership-guarded and runs after the snapshot and before its table's insert
const sqlStmts = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
const deletes = sqlStmts.filter((s) => /^delete\s+from/i.test(s));
eq(deletes.length, 3, "one delete per table");
deletes.forEach((s) => ok(/^delete from public\.(schedule_days\s+where source = 'import' and updated_by = 'seed'|availability\s+where source = 'seed'|time_off\s+where created_by = 'seed')\s+and /.test(s), "delete is ownership-guarded: " + s.slice(0, 80)));
ok(sql.indexOf("before_seed_import") < sql.indexOf("delete from public.schedule_days"), "deletes after the snapshot");
ok(sql.indexOf("delete from public.schedule_days") < sql.indexOf("insert into public.schedule_days"), "schedule_days delete before insert");
ok(sql.indexOf("delete from public.availability") < sql.indexOf("insert into public.availability"), "availability delete before insert");
ok(sql.indexOf("insert into public.schedule_days") < sql.indexOf("delete from public.time_off") && sql.indexOf("delete from public.time_off") < sql.indexOf("insert into public.time_off"), "time_off delete after schedule_days, before time_off insert");
// (i) unchanged live == plan still reports zero deletes
eq(IMP.planDiff(plan, liveEq).totalDeletes, 0);

/* ------------------------------------------ rule-note scrub (Prompt 12 F; flipped in place by Prompt 12 AA, 9/22 late) */
// AA FLIP: F classified a surgeonRules note into one of five category tokens; since AA every note-like key is dropped
// (no tokens, no classification, no NOTE_UNCLASSIFIED). Each flipped assertion says "AA FLIP" and what F expected.
step("rule notes scrubbed before the blob (Prompt 12 F / AA): every note-like key dropped, denylist, refusals, idempotency");
const DENY = /\b(family|families|wife|husband|kid|kids|child|children|daughter|son|parents|in-laws|school|medical|maternity|hosts|hosting|illness|funeral)\b/i;
function walkStrings(o, p, out) {
  if (typeof o === "string") { out.push({ path: p, value: o }); return out; }
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)) { o.forEach((v, i) => walkStrings(v, p + "[" + i + "]", out)); return out; }
  Object.keys(o).forEach((k) => walkStrings(o[k], p ? p + "." + k : k, out));
  return out;
}
// note-like string values (note / notes[] / *Note / *Notes / *Reason) at any depth
function noteValues(o, p, out) {
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)) { o.forEach((v, i) => noteValues(v, p + "[" + i + "]", out)); return out; }
  Object.keys(o).forEach((k) => {
    const q = p ? p + "." + k : k;
    if (NOTE_KEY.test(k)) walkStrings(o[k], q, out);
    else noteValues(o[k], q, out);
  });
  return out;
}
// (1) the two live offenders (review finding F): the seed keeps its wording, the blob gets the category
eq(seed.surgeonRules[ACTON].holidayRules.neverThanksgivingNote, "[removed]", "seed still says '[removed]' (the seed is not rewritten)");
// Prompt 12 X FLIP (9/22 evening): the second offender - Acton's Tuesday avoid with its '[removed]' note - left the seed
// entirely (his Tuesday is now the hard primary rule s3.hardNeverWeekdays, with no reason key); the pins below read its absence.
ok(!seed.surgeonRules[ACTON].recurringAvoid.some((r) => r.weekday === "Tue") && !("hardNeverWeekdaysReason" in seed.surgeonRules[ACTON]), "X: no Tuesday avoid entry and no hardNeverWeekdaysReason key in the seed (the rule carries no reason)");
ok(!("neverThanksgivingNote" in plan.blob.surgeonRules[ACTON].holidayRules), "AA FLIP: neverThanksgivingNote is dropped from the blob (F: '[removed]' -> the token 'family')");
eq(plan.blob.surgeonRules[ACTON].recurringAvoid.map((r) => "note" in r), [false], "AA FLIP: only the Sunday avoid remains in the blob (X) and it carries no note (F: the token 'outreach')");
ok(JSON.stringify(plan.blob).indexOf("[removed]") < 0 && JSON.stringify(plan.blob).indexOf("[removed]") < 0, "neither phrase anywhere in the blob");
ok(sql.indexOf("[removed]") < 0 && sql.indexOf("[removed]") < 0, "neither phrase in the generated SQL");
// (2) AA FLIP: no note-like string is left in the blob's surgeonRules at all (F: >= 8 survived as category tokens)
const blobNotes = noteValues(plan.blob.surgeonRules, "surgeonRules", []);
eq(blobNotes, [], "AA FLIP: no note-like string survives under surgeonRules (F: some person-situation notes survived as categories)");
// spot checks against the real seed: the keys F classified are gone (AA FLIP)
ok(!("hardNeverWeekdaysReason" in plan.blob.surgeonRules[KHAN]) && !("hardNeverWeekdaysReason" in seed.surgeonRules[KHAN]), "AA FLIP: no hardNeverWeekdaysReason in the blob - the key left the seed too (F: 'Tue/Thu are his OR days' -> 'OR day')");
ok(!("note" in plan.blob.surgeonRules[BURCHETT].recurringAvailable[0]), "AA FLIP: Burchett's recurringAvailable[0] carries no note (F: 'unless in Jackson County' -> 'outreach')");
// a seed note located by its wording (proves the seed keeps it) -> the inventory entry of its notes[] key
// (AA FLIP: notes[] is dropped as ONE key, so the entry is surgeonRules.<id>.notes; F listed notes[i] per element)
function invForNote(id, re) {
  const notes = seed.surgeonRules[id].notes || [];
  const i = notes.findIndex((t) => re.test(t));
  ok(i >= 0, "seed " + id + " has a note matching " + re);
  const e = plan.noteScrub.inventory.find((x) => x.path === "surgeonRules." + id + ".notes");
  ok(e, "inventory has an entry for surgeonRules." + id + ".notes");
  return e || {};
}
eq([invForNote(BURCHETT, /Jackson County/).action, invForNote(BURCHETT, /Jackson County/).to], ["drop", null], "AA FLIP: Burchett 'DeWitt/Jackson County' -> drop (F: category outreach)");
eq(invForNote(BURCHETT, /per month/).action, "drop", "Burchett cap restatement (primary+backup per month) dropped (F: as documentation; AA: like every note)");
ok(!("notes" in plan.blob.surgeonRules[BURCHETT]), "AA FLIP: Burchett has no notes[] in the blob (F: tokens incl. outreach)");
eq(plan.blob.surgeonRules[ACTON].recurringUnavailable.map((r) => "note" in r), [false, false], "AA FLIP: the 'outreach (Maquoketa)' entries carry no note (F: 'outreach')");
ok(!("note" in plan.blob.surgeonRules[ACTON].recurringAvoid[0]), "AA FLIP: the Maquoketa carryover avoid carries no note (F: 'outreach')");
ok(!("note" in plan.blob.surgeonRules[PHILIP].aledo), "AA FLIP: the Aledo day-before rule carries no note (F: 'outreach')");
eq([invForNote(PHILIP, /Aledo/).action, invForNote(PHILIP, /no more full weeks/).action], ["drop", "drop"], "AA FLIP: Philip's notes[] -> drop (F: outreach / preference)");
ok(!("note" in plan.blob.surgeonRules[FIERCE].outsideDerivedWeeks.weekdayPattern.Wed), "AA FLIP: Fierce's Wednesday pattern carries no note (F: 'preference')");
// (3) engine / seed documentation is dropped (the seed keeps it; the app never parses notes)
ok(!("notes" in plan.blob.surgeonRules[FIERCE]), "Fierce notes (all derivation documentation) dropped as a key");
ok(!("hardNeverWeekdaysNote" in plan.blob.surgeonRules[KHAN]) && !("forecastNote" in plan.blob.surgeonRules[KHAN].eastFeed), "Khan documentation notes dropped");
ok(!("seedNote" in plan.blob.surgeonRules[FIERCE].eastFeed) && !("monthlyCapNote" in plan.blob.surgeonRules[PHILIP]), "Fierce/Philip documentation notes dropped");
ok(!("holidaysOffNote" in plan.blob.surgeonRules[ACTON].holidayRules), "Acton holidaysOffNote (documentation) dropped");
eq(IMP.impFindKeys(plan.blob.groupRules, NOTE_KEY), [], "blob has no groupRules note-like keys");
eq(IMP.impFindKeys(plan.blob.holidays, NOTE_KEY), [], "blob has no holidays note-like keys (unit notes are documentation, dropped)");
ok(JSON.stringify(seed.holidays).indexOf("dayMembershipNote") >= 0, "the seed keeps its holidays notes");
eq(plan.blob.surgeonRules[ACTON].timeOff, [{ start: "2026-11-19", end: "2026-11-22" }, { start: "2026-11-25", end: "2026-11-29" }], "blob timeOff carries dates only (no note)");
// non-note structure untouched
eq(plan.blob.surgeonRules[ACTON].recurringAvoid[0].weekday, seed.surgeonRules[ACTON].recurringAvoid[0].weekday, "the rule beside the note is unchanged"); // X: [1] (the Tuesday avoid) left the seed
eq(stripNoteKeys(Object.assign({}, plan.blob.surgeonRules[KHAN], { timeOff: null })), stripNoteKeys(Object.assign({}, seed.surgeonRules[KHAN], { timeOff: null })), "Khan rules minus notes == seed minus notes");
// (4) denylist never fires on the real seed after scrubbing (the plan at the top was built) and nothing personal remains
const blobStrings = walkStrings(plan.blob, "blob", []);
eq(blobStrings.filter((x) => DENY.test(x.value)).map((x) => x.path), [], "no denylist word in any blob string (AA FLIP: no token exemption any more)");
// (5) inventory lists every note-like key as 'drop' (AA FLIP: F listed the two live offenders as 'category'), sorted by path
const inv = plan.noteScrub.inventory;
ok(Array.isArray(inv) && inv.length > 20, "inventory present (" + (inv && inv.length) + " entries)");
ok(inv.some((e) => e.path === "surgeonRules.s3.holidayRules.neverThanksgivingNote" && e.action === "drop" && e.to === null), "AA FLIP: inventory: neverThanksgivingNote -> drop (F: category family)");
ok(!inv.some((e) => e.path === "surgeonRules.s3.recurringAvoid[1].note") && inv.some((e) => e.path === "surgeonRules.s3.hardNeverWeekdaysNote" && e.action === "drop"), "X: inventory has no recurringAvoid[1] entry any more and drops s3.hardNeverWeekdaysNote (no reason reaches the blob)"); // Prompt 12 X FLIP: was 'recurringAvoid[1].note -> category family'
ok(inv.filter((e) => e.path.indexOf("groupRules.") === 0).every((e) => e.action === "drop"), "every groupRules entry is a drop");
ok(inv.filter((e) => e.path.indexOf("holidays.") === 0).every((e) => e.action === "drop"), "every holidays entry is a drop");
eq(inv.filter((e) => e.path.indexOf("holidays.") === 0).length, IMP.impFindKeys(seed.holidays, NOTE_KEY).length, "one drop per holidays note-like key");
eq(inv.filter((e) => e.path.indexOf("groupRules.") === 0).length, IMP.impFindKeys(seed.groupRules, NOTE_KEY).length, "one drop per groupRules note-like key");
ok(inv.every((e) => (e.action === "drop" && e.to === null) || (e.action === "public" && e.to === "time_off") || (e.action === "private-name" && e.to === null) || (e.action === "awaiting-confirmation" && e.to === "schedule_days")), "inventory actions are drop (AA FLIP: never 'category'), plus 'public' / 'private-name' for time_off notes (item S) and 'awaiting-confirmation' for flagged existingAssignments (item B)");
ok(!inv.some((e) => e.action === "awaiting-confirmation"), "Z FLIP: the real seed's inventory lists no awaiting row (B: the four Thanksgiving rows, until Faraz confirmed on 9/22)");
ok(!inv.some((e) => e.action === "private-name"), "the real seed has no public note naming a surgeon");
eq(inv.map((e) => e.path), inv.map((e) => e.path).slice().sort(), "inventory sorted by path");
eq(plan.noteScrub.counts, { drop: inv.filter((e) => e.action === "drop").length, timeOffPublic: inv.filter((e) => e.action === "public").length, awaitingConfirmation: inv.filter((e) => e.action === "awaiting-confirmation").length }, "counts agree with the inventory (AA FLIP: no 'category' count)");
// (6) refusals: AA FLIP - there is no NOTE_UNCLASSIFIED any more (nothing classifies): an unclassifiable surgeon note is
// dropped like every other; a denylist word in a NON-note string -> NOTE_DENYLIST (unchanged)
function refusesWith(prefix, mutate, label) {
  const fx = clone(seed);
  mutate(fx);
  let msg = null;
  try { IMP.importPlan(fx, { now: NOW }); } catch (e) { msg = e.message; }
  ok(msg && msg.indexOf(prefix) === 0, label + " -> " + prefix + " (" + (msg || "no error").slice(0, 90) + ")");
  return msg;
}
{
  const fxU = clone(seed); fxU.surgeonRules.s3.notes.push("dinner reservation downtown"); fxU.surgeonRules.s1.weekdays.whyNote = "meets the accountant";
  const pU = IMP.importPlan(fxU, { now: NOW });
  ok(!("notes" in pU.blob.surgeonRules[ACTON]) && !("whyNote" in pU.blob.surgeonRules[KHAN].weekdays) && JSON.stringify(pU.blob).indexOf("dinner reservation") < 0 && JSON.stringify(pU.blob).indexOf("accountant") < 0, "AA FLIP: an unclassifiable note / *Note key is dropped, never refused, never written (F: NOTE_UNCLASSIFIED)");
}
// 'wife's birthday dinner' / relatives / hosting under a notes[] key: dropped with the key, never written, never refused
// (AA FLIP: F mapped each to the token 'family')
const fxW = clone(seed); fxW.surgeonRules.s4.notes.push("wife's birthday dinner", "daughter's recital", "hosting Thanksgiving with parents", "in-laws visiting");
const pW = IMP.importPlan(fxW, { now: NOW });
ok(!("notes" in pW.blob.surgeonRules[PHILIP]) && !/birthday|recital|hosting|in-laws/.test(JSON.stringify(pW.blob)), "AA FLIP: relatives / hosting in notes[] never reach the blob in any form (F: 'family' tokens appended)");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"Family\")", (fx) => { fx.surgeonRules.s2.label = "Family reunion"; }, "non-note string 'Family reunion'");
refusesWith("NOTE_DENYLIST: groupRules.dailyHandoff (\"school\")", (fx) => { fx.groupRules.dailyHandoff = "before the school run"; }, "groupRules non-note string");
refusesWith("NOTE_DENYLIST: surgeonRules.s6.availableWindows[0].label (\"kids\")", (fx) => { fx.surgeonRules.s6.availableWindows[0].label = "kids off"; }, "denylist inside an array element");
// hardening beyond the binding list (review F): plural / relatives / hosting in a NON-note key refuse too
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"Families\")", (fx) => { fx.surgeonRules.s2.label = "Families first"; }, "'Families' (plural)");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"hosting\")", (fx) => { fx.surgeonRules.s2.label = "hosting a dinner"; }, "'hosting'");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"daughter\")", (fx) => { fx.surgeonRules.s2.label = "daughter's recital"; }, "'daughter'");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"in-laws\")", (fx) => { fx.surgeonRules.s2.label = "in-laws visiting"; }, "'in-laws'");
refusesWith("NOTE_DENYLIST: holidays.rules.extra (\"family\")", (fx) => { fx.holidays.rules.dayMembershipNote = "family day"; fx.holidays.rules.extra = "family day"; }, "denylist covers holidays too (the note key is dropped first; the non-note key trips)");
// 'familiar' is not 'family'; AA FLIP: an exact former token no longer passes anywhere (F exempted it from the gate)
const fxF = clone(seed); fxF.surgeonRules.s2.label = "familiar territory";
eq(IMP.importPlan(fxF, { now: NOW }).blob.surgeonRules[BURCHETT].label, "familiar territory", "'familiar' passes the denylist");
const mD = refusesWith("NOTE_DENYLIST: surgeonRules.s5.label (\"family\")", (fx) => { fx.surgeonRules.s5.label = "family"; }, "AA FLIP: the exact word 'family' in a non-note key refuses (F: exempt as a category token)");
// the CLI classifies the refusal as a refusal (exit 2), not a crash
ok(/^NOTE_DENYLIST:/.test(mD), "refusal prefix shape");
// (7) idempotency: scrubbing the scrubbed blob changes nothing; importSql is deterministic
const twice = IMP.impScrubRuleNotes(clone(plan.blob.surgeonRules), clone(plan.blob.groupRules), clone(plan.blob.holidays));
eq(twice.surgeonRules, plan.blob.surgeonRules, "scrub applied twice == once (surgeonRules)");
eq(twice.groupRules, plan.blob.groupRules, "scrub applied twice == once (groupRules)");
eq(twice.holidays, plan.blob.holidays, "scrub applied twice == once (holidays)");
eq(twice.inventory, [], "second pass has nothing to do");
eq(IMP.importSql(IMP.importPlan(seed, { now: NOW })), sql, "importSql(plan) deterministic for the scrubbed plan");
// direct call on raw seed rules (vacation notes removed: those are replaced before the scrub in importPlan)
const rawSr = clone(seed.surgeonRules); Object.values(rawSr).forEach((r) => { (r.timeOff || []).forEach((t) => { delete t.note; }); });
const direct = IMP.impScrubRuleNotes(rawSr, clone(seed.groupRules));
ok(!("neverThanksgivingNote" in direct.surgeonRules[ACTON].holidayRules), "AA FLIP: the direct call drops neverThanksgivingNote (F: 'family')");
eq(IMP.impFindKeys(direct.groupRules, NOTE_KEY), []);
eq(IMP.impFindKeys(direct.surgeonRules, NOTE_KEY), [], "AA FLIP: the direct call leaves no note-like key (F: only category tokens)");
ok(rawSr[ACTON].holidayRules.neverThanksgivingNote === "[removed]", "impScrubRuleNotes does not mutate its input");
// empty / absent inputs
eq(IMP.impScrubRuleNotes({}, {}), { surgeonRules: {}, groupRules: {}, holidays: {}, inventory: [] });
eq(IMP.impScrubRuleNotes({}, {}, { units: { 2026: [{ name: "x", days: ["2026-12-25"], note: "doc" }] } }).holidays, { units: { 2026: [{ name: "x", days: ["2026-12-25"] }] } }, "holidays: every note-like key dropped");
eq(IMP.impScrubRuleNotes(undefined, undefined).inventory, []);

/* ------------------------------------ public time_off notes (item S, 9/22 evening) */
step("public time_off notes: written only with public: true AND past the denylist / roster-name gate; privacy default unchanged");
// a public note that trips the item-F denylist REFUSES the import (path + word, never the text)
const mTo = refusesWith("NOTE_DENYLIST: surgeonRules.s2.timeOff[0].note (\"family\")", (fx) => { fx.surgeonRules.s2.timeOff[0].note = "family weekend"; }, "public note with a denylist word");
ok(mTo.indexOf("weekend") < 0, "the refusal names the path and the word, never the note text");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.timeOff[3].note (\"Hosting\")", (fx) => { fx.surgeonRules.s2.timeOff[3].note = "Hosting visitors"; }, "public note, denylist is case-insensitive");
// a public note naming a roster last name is neither written nor refused: it falls back to the private default
// (design decision d: the denylist gate refuses, a surname falls back) and the dry run lists the path as 'private-name', never the text
const fxName = clone(seed); fxName.surgeonRules.s2.timeOff[1].note = "Burchett away"; fxName.surgeonRules.s2.timeOff[2].note = "covering for sarkar";
const planName = IMP.importPlan(fxName, { now: NOW });
eq(planName.timeOffRows.filter((t) => t.person_id === BURCHETT).map((t) => t.note), ["unavailable (stated 9/22)", "vacation (seed)", "vacation (seed)", "unavailable (stated 9/22)"], "a public note naming a roster last name (any case) falls back to 'vacation (seed)'");
eq(planName.noteScrub.counts.timeOffPublic, 2, "a surname fallback is not counted as public");
eq(planName.noteScrub.inventory.filter((e) => e.action === "private-name").map((e) => [e.path, e.to, "from" in e]), [["surgeonRules.s2.timeOff[1].note", null, false], ["surgeonRules.s2.timeOff[2].note", null, false]], "inventory: 'private-name' entries carry the path only, never the note");
ok(JSON.stringify(planName).indexOf("Burchett away") < 0 && JSON.stringify(planName).indexOf("covering for") < 0 && IMP.importSql(planName).indexOf("covering for") < 0, "the surname note reaches neither the plan nor the SQL");
// a denylist word wins over the surname fallback: the import is refused, not defaulted
refusesWith("NOTE_DENYLIST: surgeonRules.s2.timeOff[0].note (\"family\")", (fx) => { fx.surgeonRules.s2.timeOff[0].note = "family time with Acton"; }, "denylist word beside a surname still refuses");
// a public note with an email / phone is caught by the existing contact guard (input side)
refuses((fx) => { fx.surgeonRules.s2.timeOff[0].note = "reach me at someone@example.test"; }, "email in a public time_off note");
refuses((fx) => { fx.surgeonRules.s2.timeOff[0].note = "cell 555-555-0100"; }, "phone in a public time_off note");
// privacy default: without public: true the note is replaced, denylist word or not (never refused, never written)
const fxPriv = clone(seed); fxPriv.surgeonRules.s3.timeOff[0].note = "family weekend"; fxPriv.surgeonRules.s2.timeOff[0].public = false; fxPriv.surgeonRules.s2.timeOff[1].public = "yes";
const planPriv = IMP.importPlan(fxPriv, { now: NOW });
eq(planPriv.timeOffRows.filter((t) => t.person_id === ACTON)[0].note, "vacation (seed)", "a private note with a denylist word is replaced, not refused");
eq(planPriv.timeOffRows.filter((t) => t.person_id === BURCHETT).map((t) => t.note), ["vacation (seed)", "vacation (seed)", "unavailable (stated 9/22)", "unavailable (stated 9/22)"], "public: false and a non-boolean public read as private; only boolean true passes the note through");
eq(planPriv.noteScrub.counts.timeOffPublic, 2, "the public count follows the flags");
// public: true without a note -> the default wording; public: true with an operational note that passes -> written
const fxNoNote = clone(seed); delete fxNoNote.surgeonRules.s2.timeOff[0].note; fxNoNote.surgeonRules.s2.timeOff[1].note = "out of town (stated 9/22)";
const planNoNote = IMP.importPlan(fxNoNote, { now: NOW });
eq(planNoNote.timeOffRows.filter((t) => t.person_id === BURCHETT).slice(0, 2).map((t) => t.note), ["vacation (seed)", "out of town (stated 9/22)"], "public without a note -> 'vacation (seed)'; a passing operational note is written as is");
ok(planNoNote.timeOffRows.every((t) => t.created_by === "seed"), "created_by stays 'seed' whatever the note");
// the blob copy never sees the flag, the note or the source, whichever way the seed is flagged
eq(planPriv.blob.surgeonRules[BURCHETT].timeOff.map((t) => Object.keys(t).sort().join(",")), ["end,start", "end,start", "end,start", "end,start"], "blob timeOff keys are start/end only");
// the seed adapter (tests' ctx) sees the same rows, so a bad public note fails the tests' ctx too
let adapterMsg = null;
try { SA.seedToTimeOffRows(clone(fxPriv) && Object.assign(clone(seed), { surgeonRules: Object.assign(clone(seed.surgeonRules), { s2: Object.assign(clone(seed.surgeonRules.s2), { timeOff: [{ start: "2027-01-09", end: "2027-01-10", note: "family", public: true }] }) }) })); } catch (e) { adapterMsg = e.message; }
ok(adapterMsg && adapterMsg.indexOf("NOTE_DENYLIST: surgeonRules.s2.timeOff[0].note (\"family\")") === 0, "seed adapter path refuses the same way: " + (adapterMsg || "no error").slice(0, 80));
// the tiny seed's private note still scrubs (regression of the earlier pin)
eq(tp.timeOffRows[0].note, "vacation (seed)");

// ---- Prompt 12 Y (9/22 evening) ----
// Faraz: "Acton's November list is preferences, not a limit (his 9/17 message gave rules, never dates; the dates came via
// Burchett's relay): remove the November governed-month whitelist for s3. His listed days stay locked; his recurring rules
// govern the rest of November - which makes Thu 11/5 his (primary 11/4-11/6, within his max of 3) with backup from anyone
// eligible. Burchett's November whitelist stays." Data only: s3.explicitListMonths loses the November object, the
// s3.explicitAvailable["2026-11"] block is removed (the importer would otherwise complete November back into the governed
// list from the key - impSeedSurgeonRules), 2026-11-05 becomes Acton primary locked / backup open (source
// faraz-2026-09-22-acton-1105), pendingDeltas logs both 11/5 moves. Every expected value is restated here, not read back.
step("Prompt 12 Y: Acton's November whitelist is off; 11/5 = Acton primary locked, backup open; Burchett's November unchanged");
const Y_SRC = "faraz-2026-09-22-acton-1105";
eq(plan.blob.surgeonRules[ACTON].explicitListMonths, ["2026-10"], "Y: s3 explicitListMonths after import = October only (before Y: the { month: '2026-11', roles: [primary, backup] } object)");
eq(SA.seedToSurgeonRules(seed)[ACTON].explicitListMonths, ["2026-10"], "Y: the tests' seed adapter sees the same list (no November completion from an explicitAvailable key)");
ok(!("2026-11" in (seed.surgeonRules[ACTON].explicitAvailable || {})), "Y: no s3.explicitAvailable['2026-11'] block left (its key alone would re-govern November through impSeedSurgeonRules)");
ok(!("2026-11" in (plan.blob.surgeonRules[ACTON].explicitAvailable || {})), "Y: ...and none in the blob");
eq(seed.surgeonRules[ACTON].explicitAvailable["2026-10"].primary.length + seed.surgeonRules[ACTON].explicitAvailable["2026-10"].backup.length, 13, "Y: his October list is untouched (10 primary + 3 backup dates)");
eq(plan.availabilityRows.filter((r) => r.person_id === ACTON && r.start_date >= "2026-11-01" && r.start_date <= "2026-11-30").length, 0, "Y: no s3 November availability row in the plan (his listed days live on as locks, not as rows)");
eq(plan.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, "2026-12"], "Y: Burchett's November whitelist stays (both roles)");
eq([seed.surgeonRules[BURCHETT].explicitAvailable["2026-11"].primary.length, seed.surgeonRules[BURCHETT].explicitAvailable["2026-11"].backup.length], [7, 8], "Y: Burchett's November statement unchanged (7 primary + 8 backup dates)");
eq([byDay["2026-11-05"].primary_id, byDay["2026-11-05"].primary_locked, byDay["2026-11-05"].backup_id, byDay["2026-11-05"].backup_locked], [ACTON, true, null, false], "Y: 2026-11-05 = Acton primary locked, backup open (before Y: primary open, Acton backup locked)");
eq(byDay["2026-11-05"].note, "seed: " + Y_SRC + " - Acton primary per his recurring rules (Faraz 9/22 evening); his relayed 11/5 backup entry superseded", "Y: the 11/5 row note = Faraz's source + the operational wording only");
eq(days.length, 73, "Y: schedule_days total still 73 (a role change on an existing row, no new row)");
eq(plan.stats.schedule_days, 73);
eq(days.filter((d) => d.day >= "2026-11-02" && d.day <= "2026-11-25" && d.primary_id === ACTON).map((d) => d.day), ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-18"], "Y: Acton's locked November primaries now include 11/5 (a run 11/4-11/6 of 3 = his max)");
eq(days.filter((d) => d.day >= "2026-11-02" && d.day <= "2026-11-25" && d.backup_id === ACTON).map((d) => d.day), ["2026-11-03", "2026-11-17"], "Y: Acton's locked November backups are 11/3 and 11/17 only");
{
  const pd = (role) => seed.pendingDeltas.find((x) => x.date === "2026-11-05" && x.role === role);
  ok(pd("backup") && pd("primary"), "Y: pendingDeltas carries both 11/5 moves");
  eq([pd("backup").surgeon, pd("backup").replaces, pd("backup").source, pd("backup").status], [null, ACTON, Y_SRC, "applied"], "Y: 11/5 B Acton -> open (applied)");
  eq([pd("primary").surgeon, pd("primary").replaces, pd("primary").source, pd("primary").status], [ACTON, null, Y_SRC, "applied"], "Y: 11/5 P open -> Acton (applied)");
  eq(plan.infoDeltas.filter((l) => l.indexOf("11/5 B Acton -> open (applied; " + Y_SRC + ")") === 0).length, 1, "Y: the importer renders the backup delta: " + plan.infoDeltas.filter((l) => /^11\/5 /.test(l)).join(" | "));
  eq(plan.infoDeltas.filter((l) => l.indexOf("11/5 P open -> Acton (applied; " + Y_SRC + ")") === 0).length, 1, "Y: ...and the primary delta");
  ok(!/family|hunt|reason|Burchett/i.test(pd("backup").note + " " + pd("primary").note + " " + byDay["2026-11-05"].note), "Y: no personal reason and no other surgeon's name in the 11/5 wording that reaches a row");
}
// the expected live diff for the orchestrator (REPORT-FIRST): live = the rows as they stand after T (11/5 = B Acton, the s3
// November availability rows, the blob with his November list). Rebuilt here from the seed itself by putting T's state back,
// so the count of rows the importer will DELETE is derived, never copied.
{
  const seedPreY = clone(seed);
  seedPreY.surgeonRules[ACTON].explicitAvailable["2026-11"] = { primary: ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-18"], backup: ["2026-11-03", "2026-11-05", "2026-11-17"] };
  seedPreY.surgeonRules[ACTON].explicitListMonths = ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }];
  const a5 = seedPreY.existingAssignments.find((a) => a.date === "2026-11-05");
  a5.primary = null; a5.backup = ACTON; a5.source = NOV_SRC; a5.note = "primary open - nobody's rules allow it with Acton as its backup (open question 13)";
  seedPreY.pendingDeltas = seedPreY.pendingDeltas.filter((x) => x.date !== "2026-11-05");
  const planPreY = IMP.importPlan(seedPreY, { now: NOW });
  const livePreY = { blob: clone(planPreY.blob), availability: clone(planPreY.availabilityRows), time_off: clone(planPreY.timeOffRows), schedule_days: clone(planPreY.scheduleDayRows) };
  const s3Nov = planPreY.availabilityRows.filter((r) => r.person_id === ACTON && r.start_date >= "2026-11-01" && r.start_date <= "2026-11-30");
  eq(s3Nov.length, 8, "Y: T's s3 November availability rows collapse to 8 (5 primary ranges: 11/2, 11/4, 11/6, 11/14-16, 11/18; 3 backup rows: 11/3, 11/5, 11/17)");
  const dY = IMP.planDiff(plan, livePreY);
  eq([dY.tables.schedule_days.insert, dY.tables.schedule_days.update, dY.tables.schedule_days.delete, dY.tables.schedule_days.blocked, dY.tables.availability.insert, dY.tables.availability.update, dY.tables.availability.delete, dY.tables.call_schedule_data.update, dY.tables.time_off.insert, dY.tables.time_off.delete], [0, 1, 0, 0, 0, 0, s3Nov.length, 2, 0, 0], "Y: expected live diff = 1 day update (11/5), " + s3Nov.length + " availability deletes (s3 November), 2 blob updates (surgeonRules + settings: the seedCoreHash stamp follows - RF2 review fix), no time_off change (got " + JSON.stringify(dY.tables) + ")");
  eq(dY.changes, ["11/5 P OPEN -> Acton", "11/5 B Acton -> OPEN"], "Y: the one day change reads both roles of 11/5");
  eq(dY.blocked, [], "Y: nothing blocked (the live 11/5 row is the import's own: source import, updated_by seed)");
  eq(dY.tables.schedule_days.byMonth["2026-11"], { insert: 0, update: 1, unchanged: 24, blocked: 0, delete: 0 }, "Y: November = the 11/5 update + 24 unchanged rows");
  eq(dY.tables.availability.rows.filter((l) => /^delete /.test(l)).length, s3Nov.length, "Y: the diff lists one delete line per row");
  ok(dY.tables.availability.rows.filter((l) => /^delete /.test(l)).every((l) => /^delete s3 available\/(primary|backup) 2026-11-/.test(l)), "Y: every availability delete is an s3 (Acton) November available row: " + dY.tables.availability.rows.filter((l) => /^delete /.test(l)).join(", "));
  // an app-edited live 11/5 (someone claimed the backup in the app) is BLOCKED, never overwritten
  const liveEdited = clone(livePreY); const e5 = liveEdited.schedule_days.find((d) => d.day === "2026-11-05"); e5.source = "manual"; e5.version = 2;
  const dE = IMP.planDiff(plan, liveEdited);
  eq([dE.tables.schedule_days.update, dE.tables.schedule_days.blocked], [0, 1], "Y: an app-edited live 11/5 row is blocked, not updated");
}

/* ------------------------------------------------- Prompt 12 M: outside surgeons in the roster */
step("M: roster type 'external' and its note pass through impSeedRoster; a personal word in the note is refused");
const LOCUM_ROW = { id: "x1", name: "Locum", code: "LOC", fullName: "Locum Tenens", active: true, roles: ["surgeon"], type: "external", note: "covers when asked" };
const fxExt = clone(seed); fxExt.roster.push(clone(LOCUM_ROW));
const planExt = IMP.importPlan(fxExt, { now: NOW });
eq(planExt.blob.roster.length, 7, "seven roster rows");
eq(Object.keys(planExt.blob.roster[6]).sort(), ["active", "code", "fullName", "id", "name", "note", "roles", "type"], "external row keys: the pool keys plus type and note");
eq(planExt.blob.roster[6].type, "external", "type passes through");
eq(planExt.blob.roster[6].note, "covers when asked", "an operational external note passes through");
eq(planExt.blob.roster[6].code, "LOC");
planExt.blob.roster.slice(0, 6).forEach((r) => eq(Object.keys(r).sort(), ["active", "code", "fullName", "id", "name", "roles"], r.id + ": a pool row carries neither type nor note (Sarkar's seed note stays dropped)"));
eq(Object.prototype.hasOwnProperty.call(IMP.impSeedRoster({ roster: [Object.assign(clone(LOCUM_ROW), { note: "   " })] })[0], "note"), false, "a blank external note is omitted");
eq(Object.prototype.hasOwnProperty.call(IMP.impSeedRoster({ roster: [{ id: "s9", name: "Pool", code: "PL", note: "documentation" }] })[0], "note"), false, "a pool row's note never reaches the blob");
eq(Object.prototype.hasOwnProperty.call(IMP.impSeedRoster({ roster: [{ id: "s9", name: "Pool", code: "PL", type: "pool" }] })[0], "type"), false, "only type 'external' is a roster type (anything else is dropped: absent = pool surgeon)");
refusesWith("NOTE_DENYLIST: roster[6].note (\"family\")", (fx) => { fx.roster.push(Object.assign(clone(LOCUM_ROW), { note: "family friend of the group" })); }, "external note with a denylist word");
refuses((fx) => { fx.roster.push(Object.assign(clone(LOCUM_ROW), { note: "page 555-555-0100" })); }, "external note with a phone number");
const ctxExt = R.buildContext({ roster: planExt.blob.roster, surgeonRules: planExt.blob.surgeonRules, groupRules: planExt.blob.groupRules, holidays: planExt.blob.holidays, schedule: {} });
eq(ctxExt.activeIds.indexOf("x1"), -1, "blob roster -> the external is not in activeIds");
eq(ctxExt.externalIds, ["x1"], "blob roster -> externalIds");
eq(plan.blob.roster.some((r) => r.type === "external"), false, "the real seed adds no outside surgeon (they are added in Setup)");
ok(typeof seed.groupRules.outsideSurgeonsNote === "string" && /Setup/.test(seed.groupRules.outsideSurgeonsNote), "the seed documents that outside surgeons are added in Setup (groupRules.outsideSurgeonsNote)");
ok(!("outsideSurgeonsNote" in plan.blob.groupRules), "...and that note is seed documentation: dropped from the blob like every groupRules note");

// review 9/22 (M, findings 1 + 5): a Setup-added outside surgeon lives only in the live blob - a seed import
// must carry him over (planDiff, the app's merge and the SQL path), never replace the roster wholesale.
step("M: a Setup-added outside surgeon survives a seed import (impMergeRoster: planDiff, SQL)");
eq(typeof IMP.impMergeRoster, "function", "impMergeRoster is exported (the app's apply path calls it)");
const liveRosterExt = plan.blob.roster.concat([clone(LOCUM_ROW)]);
eq(IMP.impMergeRoster(plan.blob.roster, liveRosterExt).map((r) => r.id), ["s1", "s2", "s3", "s4", "s5", "s6", "x1"], "seed rows first, then the live externals the seed lacks");
eq(IMP.impMergeRoster(plan.blob.roster, liveRosterExt)[6], LOCUM_ROW, "the live external row is carried over as it is (type, note included)");
eq(IMP.impMergeRoster(planExt.blob.roster, liveRosterExt).map((r) => r.id), ["s1", "s2", "s3", "s4", "s5", "s6", "x1"], "an external the seed names itself is not duplicated (the seed's row wins)");
eq(IMP.impMergeRoster(plan.blob.roster, plan.blob.roster.concat([{ id: "s9", name: "Gone", code: "GN", active: true, roles: ["surgeon"] }])).length, 6, "a live POOL row the seed lacks is not kept (the seed owns the pool rows, as before)");
eq(IMP.impMergeRoster(plan.blob.roster, null).length, 6, "no live roster -> the seed roster");
eq(IMP.impMergeRoster(plan.blob.roster, liveRosterExt.concat([{ id: "x2", type: "external", name: "Off", code: "OFF", active: false }])).map((r) => r.id).slice(6), ["x1", "x2"], "an inactive live external is kept too (his old days still name him)");
const liveBlobExt = Object.assign(clone(plan.blob), { roster: liveRosterExt });
const dExt = IMP.planDiff(plan, { blob: liveBlobExt, availability: [], time_off: [], schedule_days: [] });
eq(dExt.tables.call_schedule_data.keys.roster, "unchanged", "planDiff: a live roster = seed + a Setup-added external reads roster=unchanged");
eq(dExt.tables.call_schedule_data.keptExternals, ["x1"], "planDiff reports the carried-over externals");
ok(dExt.text.indexOf("outside surgeon(s) kept from the live roster: x1") >= 0, "...and says so in the text: " + dExt.lines[0]);
const dExtGone = IMP.planDiff(plan, { blob: Object.assign(clone(plan.blob), { roster: plan.blob.roster.concat([{ id: "s9", name: "Gone", code: "GN", active: true, roles: ["surgeon"] }]) }), availability: [], time_off: [], schedule_days: [] });
eq(dExtGone.tables.call_schedule_data.keys.roster, "update", "planDiff: a stray live POOL row still reads roster=update (the seed replaces it)");
const sqlExt = IMP.importSql(plan);
const sqlKeep = "jsonb_array_elements(coalesce(call_schedule_data.data -> 'roster', '[]'::jsonb)) as r where r ->> 'type' = 'external' and not (r ->> 'id' = any (array['s1', 's2', 's3', 's4', 's5', 's6']::text[]))";
eq((sqlExt.match(/r ->> 'type' = 'external'/g) || []).length, 2, "the SQL keeps the live externals in the SET and in the idempotency WHERE");
ok(sqlExt.indexOf(sqlKeep) >= 0, "the SQL appends the live externals the seed lacks to the seed roster: " + sqlExt.split("\n").filter((l) => /'\{roster\}'/.test(l)).join(" | ").slice(0, 400));
ok(/'\{roster\}', '\[\{"id":"s1"/.test(sqlExt), "...after the seed's roster JSON");

// ---- Prompt 12 Z (9/22 late) ----
// Faraz, 9/22 late evening: "Thanksgiving 11/26-29 is confirmed - clear the flag." Data only (importer.js untouched):
// the four existingAssignments rows 2026-11-26..29 lose the awaitingConfirmation key and their note reads
// "Thanksgiving unit - Khan primary Thu-Sun (Faraz 9/21 evening; confirmed 9/22)"; s1.notes, s1.holidays2026.thanksgiving
// (source / note), holidays.units 2026 and answeredQuestions say confirmed 9/22; open question 8 is struck; a
// _meta.revisions entry. Assignments, locks, sources (faraz-2026-09-21) and the unit's days are unchanged. Every expected
// value is restated here, never read back from the importer.
step("Prompt 12 Z: Thanksgiving confirmed - flag gone, notes plain, holders / locks / unit unchanged; expected live diff");
const Z_SRC = "faraz-2026-09-21";
const zRows = seed.existingAssignments.filter((a) => a.date >= "2026-11-26" && a.date <= "2026-11-29");
eq(zRows.map((a) => a.date), B_ROWS, "Z: the four unit rows are still in the seed");
zRows.forEach((a) => {
  eq(Object.prototype.hasOwnProperty.call(a, "awaitingConfirmation"), false, "Z: " + a.date + " has no awaitingConfirmation key at all (gone, not false)");
  eq([a.primary, a.backup, a.locked, a.source, a.note], [KHAN, null, true, Z_SRC, Z_NOTE], "Z: " + a.date + " = Khan primary, backup open, locked, source faraz-2026-09-21, the confirmed note");
  eq(Object.keys(a), ["date", "primary", "backup", "source", "locked", "note"], "Z: " + a.date + " key order intact (the flag key simply left)");
  eq([byDay[a.date].primary_id, byDay[a.date].primary_locked, byDay[a.date].backup_id, byDay[a.date].backup_locked, byDay[a.date].external_cover], [KHAN, true, null, false, null], "Z: " + a.date + " planned row = Khan primary locked, backup open");
});
ok(!/pending|re-?confirm|recorded by Claude Code|awaiting/i.test(Z_NOTE), "Z: the row note carries no provenance caveat (one standard: the rule, not the history)");
// what reaches the anon-readable blob: the s1 holiday source (not a note key) as written, no note, no caveat anywhere
ok(!/pending|re-?confirm|awaiting|recorded by Claude Code/i.test(JSON.stringify(plan.blob.surgeonRules[KHAN])), "Z: the blob's Khan rules carry no 'pending' / 're-confirm' / 'awaiting' / 'recorded by' anywhere");
eq(plan.blob.surgeonRules[KHAN].holidays2026.thanksgiving.source, seed.surgeonRules[KHAN].holidays2026.thanksgiving.source, "Z: holidays2026.thanksgiving.source reaches the blob as written (source is not a note key)");
eq(plan.blob.surgeonRules[KHAN].holidays2026.thanksgiving.source, "Faraz 9/21 (evening); confirmed by Faraz 9/22 (evening)", "Z: ...and it is the plain attribution");
ok(!("note" in plan.blob.surgeonRules[KHAN].holidays2026.thanksgiving), "Z: its note is engine documentation (unit / consecutive wording) and stays out of the blob");
ok(!JSON.stringify(plan.blob.surgeonRules[KHAN].notes || []).includes("Thanksgiving"), "Z: the s1.notes Thanksgiving line is dropped (AA: every notes[] key is dropped; F kept category tokens)");
eq(plan.blob.surgeonRules[KHAN].holidays2026.thanksgiving.role, "primary", "Z: the s1 holiday role is unchanged");
ok(seed.answeredQuestions.some((t) => /^Thanksgiving 2026:/.test(t) && /confirmed by Faraz 9\/22/.test(t)), "Z: answeredQuestions' Thanksgiving line says confirmed by Faraz 9/22");
ok(seed.openQuestions.some((t) => /^8\. ~~Thanksgiving 11\/26-29 for Khan~~/.test(t) && /confirmed/.test(t)), "Z: open question 8 is struck through with the answer");
ok(!seed.openQuestions.concat(seed.answeredQuestions).some((t) => /re-confirm/.test(t)), "Z: no 're-confirm' left in either question list");
ok(seed._meta.revisions.some((t) => /Prompt 12 item Z/.test(t) && /confirmed/.test(t)), "Z: _meta.revisions records the item");
ok(seed._meta.revisions.some((t) => /Prompt 12 item Z/.test(t)) && plan.blob.settings.seedRevisionCount === seed._meta.revisions.length, "Z: ...and it counts in blob.settings.seedRevisionCount (RF2: the paragraph itself stays in the seed)");
eq((plan.blob.holidays.units["2026"] || plan.blob.holidays.units[2026]).find((u) => u.name === "Thanksgiving").days, B_ROWS, "Z: the blob's 2026 Thanksgiving unit still spans the four days");
// the expected live diff for the orchestrator (REPORT-FIRST): live = the rows as they stand after the applied 9/22 import
// of item B's seed (the four notes marked, the B holiday source in the blob, no Z revision). Rebuilt from the seed itself by
// putting B's state back, so every count is derived, never copied from a dry run.
{
  const seedPreZ = clone(seed);
  seedPreZ.existingAssignments.forEach((a) => { if (B_ROWS.includes(a.date)) { a.awaitingConfirmation = true; a.note = B_NOTE; } });
  seedPreZ.surgeonRules[KHAN].holidays2026.thanksgiving.source = "recorded by Claude Code on 2026-09-22 as a 9/21 evening decision; the daytime record said pending; Faraz to re-confirm before publish (Prompt 12 B)";
  seedPreZ._meta.revisions = seedPreZ._meta.revisions.filter((t) => !/Prompt 12 item Z/.test(t));
  const planPreZ = IMP.importPlan(seedPreZ, { now: NOW });
  eq(planPreZ.stats.scheduleDays.awaitingConfirmation, 4, "Z: the rebuilt pre-Z state flags the four rows (item B's live rows)");
  const livePreZ = { blob: clone(planPreZ.blob), availability: clone(planPreZ.availabilityRows), time_off: clone(planPreZ.timeOffRows), schedule_days: clone(planPreZ.scheduleDayRows) };
  const dZ = IMP.planDiff(plan, livePreZ);
  eq(dZ.tables.call_schedule_data.keys, { roster: "unchanged", surgeonRules: "update", groupRules: "unchanged", holidays: "unchanged", settings: "update" }, "Z: blob = surgeonRules (the s1 holiday source) + settings (the revision) update; roster, groupRules, holidays unchanged");
  eq([dZ.tables.schedule_days.insert, dZ.tables.schedule_days.update, dZ.tables.schedule_days.delete, dZ.tables.schedule_days.blocked, dZ.tables.schedule_days.unchanged], [0, 4, 0, 0, 69], "Z: schedule_days update 4 (the unit's notes), 69 unchanged, nothing inserted / deleted / blocked");
  eq(dZ.changes, ["11/26 locks/note change", "11/27 locks/note change", "11/28 locks/note change", "11/29 locks/note change"], "Z: the four day changes are note-only (no holder line: no P / B arrow)");
  eq(dZ.tables.schedule_days.byMonth["2026-11"], { insert: 0, update: 4, unchanged: 21, blocked: 0, delete: 0 }, "Z: November = the four updates + 21 unchanged rows");
  eq([dZ.tables.availability.insert, dZ.tables.availability.update, dZ.tables.availability.delete, dZ.tables.time_off.insert, dZ.tables.time_off.delete], [0, 0, 0, 0, 0], "Z: availability and time_off untouched");
  eq([dZ.totalChanges, dZ.totalDeletes, dZ.blocked], [6, 0, []], "Z: total changes 6 = 4 rows + 2 blob keys, no deletes, nothing blocked");
  B_ROWS.forEach((d) => {
    const l = livePreZ.schedule_days.find((r) => r.day === d), p = byDay[d];
    const strip = (r) => { const c = clone(r); delete c.note; return c; };
    eq(strip(p), strip(l), "Z: " + d + " differs from the live row in the note only (holder, locks, source, version, external_cover equal)");
    eq(l.note, AWAIT_MARKER + "seed: " + Z_SRC + " - " + B_NOTE, "Z: the live " + d + " note = marker + item B's wording");
    eq(p.note, "seed: " + Z_SRC + " - " + Z_NOTE, "Z: the planned " + d + " note = the confirmed wording, no marker");
  });
  // a unit day edited in the app since (say a backup claimed on 11/26) is BLOCKED, never overwritten; the other three update
  const liveEdited = clone(livePreZ); const e26 = liveEdited.schedule_days.find((r) => r.day === "2026-11-26"); e26.source = "manual"; e26.version = 2;
  const dE = IMP.planDiff(plan, liveEdited);
  eq([dE.tables.schedule_days.update, dE.tables.schedule_days.blocked], [3, 1], "Z: an app-edited live 11/26 row is blocked, the other three unit days update");
  ok(dE.blocked.length === 1 && /^11\/26 locks\/note change \[BLOCKED: live source 'manual'/.test(dE.blocked[0]), "Z: the blocked line names 11/26 and the live source: " + dE.blocked[0]);
}

// ---- Prompt 12 AA (9/22 late) ----
// Faraz: "Drop the 'OR day' reason token from Khan's rule; one standard for the blob: no reasons, only the rule. Reasons
// live in docs/SILVIS-CALL-RULES.md." The importer no longer classifies a surgeonRules note into a category token
// ("outreach", "family", "personal", "OR day", "preference"): every note-like key (note, notes[], *Note, *Notes,
// *Reason, any depth) is dropped before the blob is assembled, in surgeonRules exactly as in groupRules and holidays.
// The denylist gate over every string of the assembled blob stays and runs AFTER the scrub (so a dropped key can never
// trip it, and an exact former token is no longer exempt). time_off public notes are not blob keys and stay (item S).
step("Prompt 12 AA: no reasons in the blob - every surgeonRules note-like key is dropped, no category tokens, the denylist gate still refuses");
const AA_WORDS = /\b(OR day|outreach|family|personal|preference|Maquoketa|hosts)\b|Tue\/Thu are his OR days/i;
const AA_FORBIDDEN = ["OR day", "outreach", "family", "personal", "preference", "Tue/Thu are his OR days", "Maquoketa", "hosts"];
// paths of note-like keys, NOT descending into one (mirrors a per-key drop); independent of importer.js
function aaNoteKeys(o, p, out) {
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)) { o.forEach((v, i) => aaNoteKeys(v, p + "[" + i + "]", out)); return out; }
  Object.keys(o).forEach((k) => { const q = p ? p + "." + k : k; if (NOTE_KEY.test(k)) out.push(q); else aaNoteKeys(o[k], q, out); });
  return out;
}
// (1) the blob: no former token, no reason word in ANY string under surgeonRules (values, not key names - 'preferences' is a key)
const aaStrings = walkStrings(plan.blob.surgeonRules, "surgeonRules", []);
eq(aaStrings.filter((x) => AA_WORDS.test(x.value)).map((x) => x.path + " = " + JSON.stringify(x.value)), [], "AA: no former category token or reason word in any surgeonRules string of the planned blob (fail-before: 'OR day', 'outreach', 'family', 'preference')");
AA_FORBIDDEN.forEach((w) => ok(JSON.stringify(plan.blob.surgeonRules).indexOf(JSON.stringify(w)) < 0, "AA: the blob's surgeonRules JSON holds no string value " + JSON.stringify(w)));
ok(aaStrings.length > 20, "AA: the non-note strings of surgeonRules are still there (" + aaStrings.length + ": rule text, sources, labels)");
// (2) no note-like key survives under surgeonRules in the blob (recursive walk, arrays included)
eq(IMP.impFindKeys(plan.blob.surgeonRules, NOTE_KEY), [], "AA: no key named note / notes or ending in Note / Notes / Reason under surgeonRules in the blob");
eq(noteValues(plan.blob.surgeonRules, "surgeonRules", []), [], "AA: no note-like string value under surgeonRules in the blob");
eq(IMP.impFindKeys(plan.blob, /Reason$/), [], "AA: no *Reason key anywhere in the blob");
// (3) the seed: s1.hardNeverWeekdaysReason is gone, its wording folded into s1.hardNeverWeekdaysNote (Note keys never reach the blob)
eq(IMP.impFindKeys(seed, /Reason$/), [], "AA: the seed carries no *Reason key at any depth (s1.hardNeverWeekdaysReason removed)");
ok(!("hardNeverWeekdaysReason" in seed.surgeonRules[KHAN]) && /Tue\/Thu are his OR days/.test(seed.surgeonRules[KHAN].hardNeverWeekdaysNote), "AA: the seed keeps the wording inside s1.hardNeverWeekdaysNote");
eq(seed.surgeonRules[KHAN].hardNeverWeekdays, ["Tue", "Thu"], "AA: the rule itself is unchanged");
eq(seed.surgeonRules[KHAN].hardNeverWeekdaysRoles, ["primary"], "AA: ...and so are its roles");
ok(!("hardNeverWeekdaysNote" in plan.blob.surgeonRules[KHAN]) && !("hardNeverWeekdaysReason" in plan.blob.surgeonRules[KHAN]), "AA: neither key reaches the blob");
eq(plan.blob.surgeonRules[KHAN].hardNeverWeekdays, ["Tue", "Thu"], "AA: the blob carries the rule");
// (4) the dry-run inventory: every surgeonRules note-like key -> drop (one entry per key, sorted by path), zero 'category' entries
const aaInv = plan.noteScrub.inventory;
eq(aaInv.filter((e) => e.action === "category"), [], "AA: no 'category' entry in the inventory");
ok(!aaInv.some((e) => "to" in e && e.to !== null && e.action === "drop"), "AA: a drop carries to: null");
const aaSeedRules = clone(seed.surgeonRules); Object.values(aaSeedRules).forEach((r) => { (r.timeOff || []).forEach((t) => { delete t.note; }); });   // vacation notes never enter the scrub
eq(aaInv.filter((e) => e.path.indexOf("surgeonRules.") === 0 && e.action === "drop").map((e) => e.path).sort(), aaNoteKeys(aaSeedRules, "surgeonRules", []).sort(), "AA: one 'drop' per surgeonRules note-like key of the seed (timeOff notes excluded), paths equal");
ok(aaInv.some((e) => e.path === "surgeonRules.s1.hardNeverWeekdaysNote" && e.action === "drop"), "AA: s1.hardNeverWeekdaysNote -> drop");
ok(!aaInv.some((e) => e.path === "surgeonRules.s1.hardNeverWeekdaysReason"), "AA: no s1.hardNeverWeekdaysReason entry (the key left the seed)");
ok(aaInv.some((e) => e.path === "surgeonRules.s3.holidayRules.neverThanksgivingNote" && e.action === "drop"), "AA: s3.holidayRules.neverThanksgivingNote -> drop (F: category)");
ok(aaInv.some((e) => e.path === "surgeonRules.s2.notes" && e.action === "drop"), "AA: s2.notes -> drop as one key");
ok(aaInv.every((e) => ["drop", "public", "private-name", "awaiting-confirmation"].indexOf(e.action) >= 0), "AA: inventory actions are drop / public / private-name / awaiting-confirmation only");
eq(Object.keys(plan.noteScrub.counts).sort(), ["awaitingConfirmation", "drop", "timeOffPublic"], "AA: counts has no 'category' field any more");
eq(plan.noteScrub.counts.drop, aaInv.filter((e) => e.action === "drop").length, "AA: counts.drop agrees with the inventory");
// (5) order: the scrub runs first, the denylist gate on the assembled blob after it - a *Reason / note key with a denylist
// word is dropped, never refused (it never reaches the blob); the same word in a non-note key still refuses (existing pins)
{
  const fx = clone(seed); fx.surgeonRules[KHAN].hardNeverWeekdaysReason = "family day"; fx.surgeonRules[PHILIP].notes.push("wife's birthday dinner"); fx.surgeonRules[ACTON].weekdays = { whyNote: "school run" };
  let msg = null, p = null;
  try { p = IMP.importPlan(fx, { now: NOW }); } catch (e) { msg = e.message; }
  ok(msg === null && p, "AA: a denylist word under a *Reason / notes[] / *Note key is dropped before the gate, not refused (" + (msg || "no error").slice(0, 70) + ")");
  ok(p && !("hardNeverWeekdaysReason" in p.blob.surgeonRules[KHAN]) && !("notes" in p.blob.surgeonRules[PHILIP]) && !("whyNote" in p.blob.surgeonRules[ACTON].weekdays), "AA: ...and none of the three keys reaches the blob");
  ok(p && JSON.stringify(p.blob).indexOf("family day") < 0 && JSON.stringify(p.blob).indexOf("birthday") < 0 && JSON.stringify(p.blob).indexOf("school") < 0 && IMP.importSql(p).indexOf("birthday") < 0, "AA: ...nor the wording, in the blob or the SQL");
  ok(p && p.noteScrub.inventory.some((e) => e.path === "surgeonRules.s1.hardNeverWeekdaysReason" && e.action === "drop"), "AA: the inventory lists the *Reason key as a drop");
}
refusesWith("NOTE_DENYLIST: surgeonRules.s1.label (\"family\")", (fx) => { fx.surgeonRules[KHAN].label = "family"; }, "AA: an exact former token in a NON-note key is no longer exempt from the gate (F let 'family' through)");
refusesWith("NOTE_DENYLIST: surgeonRules.s1.hardNeverWeekdaysWhy (\"school\")", (fx) => { fx.surgeonRules[KHAN].hardNeverWeekdaysWhy = "school days"; }, "AA: a reason smuggled under a non-note key name still refuses on a denylist word");
// (6) an unclassifiable note is simply dropped (F refused it as NOTE_UNCLASSIFIED); nothing classifies any more
{
  const fx = clone(seed); fx.surgeonRules[ACTON].notes.push("dinner reservation downtown"); fx.surgeonRules[KHAN].weekdays.whyNote = "meets the accountant";
  const p = IMP.importPlan(fx, { now: NOW });
  ok(!("notes" in p.blob.surgeonRules[ACTON]) && !("whyNote" in p.blob.surgeonRules[KHAN].weekdays) && JSON.stringify(p.blob).indexOf("accountant") < 0, "AA: an unclassifiable note is dropped, never refused and never written");
}
ok(IMP.IMP_NOTE_CATEGORIES === undefined && IMP.IMP_NOTE_TOKENS === undefined && IMP.impNoteCategory === undefined && IMP.impNoteIsDocumentation === undefined, "AA: no category / token table or classifier is exported (dead tables invite reuse)");
ok(!/IMP_NOTE_CATEGORIES|IMP_NOTE_TOKENS|impNoteCategory|impNoteIsDocumentation|NOTE_UNCLASSIFIED|IMP_NOTE_DOC\b/.test(require("fs").readFileSync(path.join(__dirname, "..", "importer.js"), "utf8")), "AA: importer.js carries no category table, token list, documentation heuristic or NOTE_UNCLASSIFIED refusal any more");
// (7) idempotency holds trivially: scrubbing the scrubbed blob finds nothing
eq(IMP.impScrubRuleNotes(clone(plan.blob.surgeonRules), clone(plan.blob.groupRules), clone(plan.blob.holidays)).inventory, [], "AA: a second scrub has nothing to drop");
// (8) time_off public notes are not blob keys and stay as stated (item S) - but none carries a denylist word or a former
// token / reason word (the plain status word 'unavailable' / 'vacation' is not a reason)
const aaPublic = plan.timeOffRows.map((t) => t.note).filter((x) => x !== "vacation (seed)");
eq(aaPublic, ["unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)"], "AA: the public time_off notes as stated by the surgeon");
ok(aaPublic.every((x) => !DENY.test(x) && !AA_WORDS.test(x) && !/\b(clinic|Aledo|Clinton|DeWitt|Jackson County|hunting|birthday|wife|husband)\b/i.test(x)), "AA: no public time_off note carries a denylist word, a former token or a reason word");
// (9) the CLI's printed scrub summary names no category; NOTE_UNCLASSIFIED is no longer a refusal it expects
{
  const cli = require("fs").readFileSync(path.join(__dirname, "..", "scripts", "import-seed.js"), "utf8");
  ok(cli.indexOf("mapped to a category") < 0 && cli.indexOf("NOTE_UNCLASSIFIED") < 0 && !/action -> category/.test(cli), "AA: scripts/import-seed.js prints no 'N mapped to a category' and expects no NOTE_UNCLASSIFIED");
  ok(/e\.path \+ " -> " \+ e\.action/.test(cli), "AA: the CLI still prints the inventory (path -> action)");
}
// (10) the revision entry counts in blob.settings.seedRevisionCount (RF2: the paragraph stays in the seed) and itself carries no reason or token
const aaRev = (seed._meta.revisions || []).filter((t) => /Prompt 12 item AA/.test(t));
eq(aaRev.length, 1, "AA: one _meta.revisions entry for the item (counted in blob.settings.seedRevisionCount; the wording never reaches the blob since RF2)");
ok(aaRev.every((t) => !AA_WORDS.test(t) && !DENY.test(t)), "AA: the revision wording carries no former token, reason word or denylist word");
// (11) expected live diff, derived by rebuilding the pre-AA live blob from the plan itself: blob-only (surgeonRules + settings), no row change
{
  const livePreAA = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
  livePreAA.blob.surgeonRules[KHAN].hardNeverWeekdaysReason = "OR day";   // what the live blob holds until the orchestrator applies this item
  livePreAA.blob.surgeonRules[ACTON].holidayRules.neverThanksgivingNote = "family";
  livePreAA.blob.settings = { importedAt: NOW, seedGeneratedOn: seed._meta.generatedOn, seedRevisions: seed._meta.revisions.filter((t) => !/Prompt 12 item AA/.test(t)) };   // the pre-AA (and pre-RF2) live shape
  // AA review (9/22 late): the live blob also still holds the two non-note prose keys the review moved to Note keys
  livePreAA.blob.surgeonRules[FIERCE].statedPreferenceNotARule = seed.surgeonRules[FIERCE].statedPreferenceNotARuleNote;
  livePreAA.blob.groupRules.holidayPolicy = seed.groupRules.holidayPolicy + " " + seed.groupRules.holidayPolicyNote;
  const d = IMP.planDiff(plan, livePreAA);
  eq(d.tables.call_schedule_data.keys, { roster: "unchanged", surgeonRules: "update", groupRules: "update", holidays: "unchanged", settings: "update" }, "AA: expected live diff = blob surgeonRules + groupRules + settings update (review: groupRules.holidayPolicy too)");
  eq([d.tables.schedule_days.update, d.tables.schedule_days.insert, d.tables.schedule_days.delete, d.tables.availability.insert, d.tables.availability.delete, d.tables.time_off.insert, d.tables.time_off.delete, d.totalChanges], [0, 0, 0, 0, 0, 0, 0, 3], "AA: no schedule_days / availability / time_off change; total 3 (the three blob keys)");
}

// ---- Prompt 12 AA review (9/22 late) ----
// Review of AA: two NON-note prose keys still carried a surgeon's stated wish into the anon-readable blob -
// surgeonRules.s5.statedPreferenceNotARule (its own name says it is not a rule; nothing in the app reads it) and the second
// sentence of groupRules.holidayPolicy (a named surgeon's Christmas wish). Both move to Note keys in the seed
// (statedPreferenceNotARuleNote, holidayPolicyNote - dropped by the importer, wording kept), and the standard is pinned
// over EVERY string of the blob, not only under surgeonRules. The weekdayPattern `where` column (s5) is NOT touched here:
// Setup -> Rules has a Where column for it, so whether a location counts as a reason is Faraz's ruling (rules doc section 3).
step("Prompt 12 AA review: no stated preference under a non-note key anywhere in the blob");
const AA_PHRASES = /recorded only in his words|described an ideal|stated preference|Christmas split/i;
// (12) s5.statedPreferenceNotARule -> statedPreferenceNotARuleNote: gone from the blob, kept in the seed, a drop in the inventory
ok(!("statedPreferenceNotARule" in plan.blob.surgeonRules[FIERCE]) && !("statedPreferenceNotARuleNote" in plan.blob.surgeonRules[FIERCE]), "AA review: neither statedPreferenceNotARule nor its Note form under s5 in the blob (fail-before: the key was in the blob)");
ok(!("statedPreferenceNotARule" in seed.surgeonRules[FIERCE]) && /described an ideal/.test(seed.surgeonRules[FIERCE].statedPreferenceNotARuleNote || ""), "AA review: the seed keeps the wording under s5.statedPreferenceNotARuleNote");
ok(aaInv.some((e) => e.path === "surgeonRules.s5.statedPreferenceNotARuleNote" && e.action === "drop"), "AA review: the inventory lists s5.statedPreferenceNotARuleNote as a drop");
eq(IMP.impFindKeys(plan.blob, /statedPreference/), [], "AA review: no statedPreference* key anywhere in the blob");
// (13) groupRules.holidayPolicy carries the unit rule only; the Burchett sentence sits in groupRules.holidayPolicyNote (dropped)
ok(!/\bpreference\b|Burchett/i.test(plan.blob.groupRules.holidayPolicy), "AA review: blob.groupRules.holidayPolicy names no surgeon and no preference (fail-before: 'Burchett's stated preference (Christmas split ...)')");
ok(/see holidays\.rules\.$/.test(plan.blob.groupRules.holidayPolicy), "AA review: holidayPolicy ends with the pointer to holidays.rules (the rule text itself is unchanged)");
ok(!("holidayPolicyNote" in plan.blob.groupRules) && /2 on \/ off/.test(seed.groupRules.holidayPolicyNote || ""), "AA review: the sentence lives in seed.groupRules.holidayPolicyNote, never in the blob");
ok(aaInv.some((e) => e.path === "groupRules.holidayPolicyNote" && e.action === "drop"), "AA review: ...and the inventory lists that key as a drop");
// (14) blob-wide: no former token, reason word or moved phrase in ANY string value of the blob (all five keys) or in the SQL
eq(walkStrings(plan.blob, "blob", []).filter((x) => AA_WORDS.test(x.value) || AA_PHRASES.test(x.value)).map((x) => x.path), [], "AA review: no former token / reason phrase in any string of the whole blob (fail-before: blob.groupRules.holidayPolicy, blob.surgeonRules.s5.statedPreferenceNotARule)");
ok(!AA_PHRASES.test(sql), "AA review: nor in the generated SQL");
// (15) the AA revision entry (now naming the two moved keys) still passes its own gate
ok(aaRev.every((t) => !AA_PHRASES.test(t)), "AA review: the revision wording carries none of the moved phrases either");

// ---- Review fixes 2 (RF2, 9/23 overnight): the blob carries a revision COUNT and the LAST revision date, never the
// paragraphs (finding: 13-15 internal-history paragraphs, ~17 KB, readable with the public key); the CLI refuses to
// re-import over a blob the app has written since (finding: a re-import silently reverts every Setup edit) ----
step("RF2: settings.seedRevisions -> seedRevisionCount + seedLastRevision; the SQL removes the old key; app-edited blob guard");
const RF2_REVS = seed._meta.revisions;
const RF2_LAST = (String(RF2_REVS[RF2_REVS.length - 1]).match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
ok(RF2_REVS.length >= 13 && /^\d{4}-\d{2}-\d{2}$/.test(RF2_LAST || ""), "RF2: the seed still holds the revision paragraphs (" + RF2_REVS.length + ") and the last one starts with a date");
eq(IMP.impRevisionSummary(["2026-09-21 a", "2026-09-22 evening b", "no date here"]), { count: 3, last: null }, "RF2: impRevisionSummary - the LAST entry's date prefix (none here -> null)");
eq(IMP.impRevisionSummary(["2026-09-21 a", "2026-09-22 evening (b)"]), { count: 2, last: "2026-09-22" }, "RF2: impRevisionSummary count + last date");
eq(IMP.impRevisionSummary(undefined), { count: 0, last: null }, "RF2: impRevisionSummary of nothing");
eq(plan.blob.settings.seedRevisionCount, RF2_REVS.length, "RF2: blob.settings.seedRevisionCount = the seed's entry count");
eq(plan.blob.settings.seedLastRevision, RF2_LAST, "RF2: blob.settings.seedLastRevision = the date prefix of the last entry");
ok(!("seedRevisions" in plan.blob.settings), "RF2: blob.settings carries no seedRevisions key (fail-before: every paragraph in the anon-readable blob)");
const rf2Blob = JSON.stringify(plan.blob);
const rf2Sql = IMP.importSql(plan);
ok(RF2_REVS.every((t) => rf2Blob.indexOf(String(t).slice(0, 60)) < 0 && rf2Sql.indexOf(String(t).slice(0, 60)) < 0), "RF2: no revision paragraph (first 60 chars of any entry) reaches the blob or the SQL");
eq(IMP.IMP_RETIRED_SETTINGS_KEYS, ["seedRevisions"], "RF2: the retired settings keys list");
// SQL: the settings merge is one level deep and keeps every live key, so the retired key must be removed explicitly
// (jsonb '-' operator) - in the SET and in the idempotency WHERE, so a live blob still carrying the key IS a change.
const rf2Expr = "(coalesce(call_schedule_data.data -> 'settings', '{}'::jsonb) - 'seedRevisions') || ";
eq(rf2Sql.split(rf2Expr).length - 1, 2, "RF2: the SQL subtracts 'seedRevisions' from the live settings before the merge, in the SET and in the WHERE (string pin)");
ok(!/coalesce\(call_schedule_data\.data -> 'settings', '\{\}'::jsonb\) \|\| /.test(rf2Sql), "RF2: the unsubtracted settings merge is gone from the SQL");
// planDiff: a live blob equal to the plan except a leftover seedRevisions -> settings=update (the next --apply removes it)
{
  const liveSame = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
  eq(IMP.planDiff(plan, liveSame).totalChanges, 0, "RF2: a live blob with the new settings shape = no change");
  const liveOld = clone(liveSame); liveOld.blob.settings.seedRevisions = clone(RF2_REVS);
  const dOld = IMP.planDiff(plan, liveOld);
  eq(dOld.tables.call_schedule_data.keys.settings, "update", "RF2: a live settings still carrying seedRevisions reads as settings=update (fail-before: unchanged - the diff compared the seed's keys only)");
  eq(dOld.totalChanges, 1, "RF2: ...and it is the only change");
  const liveToday = clone(liveSame); liveToday.blob.settings = { importedAt: "2026-09-23T05:27:45.838Z", seedGeneratedOn: seed._meta.generatedOn, seedRevisions: clone(RF2_REVS) };
  eq(IMP.planDiff(plan, liveToday).tables.call_schedule_data.keys.settings, "update", "RF2: the live blob of 9/23 (old shape: importedAt, seedGeneratedOn, seedRevisions) -> settings=update on the next dry run");
}
// impBlobOwner: what the CLI guard reads. The app stamps updated_by with the person_id (autosave: userProfile.person_id;
// in-app seed Apply: person_id or the auth uid; null from a session without a profile); the CLI importer stamps 'seed'.
// Anything but 'seed' on an existing row is app-written.
eq(IMP.impBlobOwner({ blob: { roster: [] }, blobUpdatedAt: "2026-09-23T05:27:45+00:00", blobUpdatedBy: "seed" }), { hasRow: true, importerOwned: true, by: "seed", at: "2026-09-23T05:27:45+00:00" }, "RF2: impBlobOwner - importer-owned row");
eq(IMP.impBlobOwner({ blob: { roster: [] }, blobUpdatedAt: "2026-09-24T14:00:00+00:00", blobUpdatedBy: "s1" }), { hasRow: true, importerOwned: false, by: "s1", at: "2026-09-24T14:00:00+00:00" }, "RF2: impBlobOwner - app-written row (person_id)");
eq(IMP.impBlobOwner({ blob: { roster: [] }, blobUpdatedAt: "2026-09-24T14:00:00+00:00", blobUpdatedBy: null }), { hasRow: true, importerOwned: false, by: "(unknown)", at: "2026-09-24T14:00:00+00:00" }, "RF2: impBlobOwner - a row with no updated_by is NOT importer-owned");
eq(IMP.impBlobOwner({ blob: {}, blobUpdatedAt: null, blobUpdatedBy: null }), { hasRow: false, importerOwned: false, by: null, at: null }, "RF2: impBlobOwner - no row (fresh install): no guard");
eq(IMP.impBlobOwner({ blob: {}, blobUpdatedAt: "2026-09-23T00:00:00+00:00", blobUpdatedBy: null }), { hasRow: false, importerOwned: false, by: null, at: null }, "RF2 review fix: the schema's own seed row ('main', '{}': updated_at default now(), updated_by null) is NO row - the first --apply after sql/schema.sql must not exit 4 (fail-before: hasRow true through updated_at)");
eq(IMP.impBlobOwner(null), { hasRow: false, importerOwned: false, by: null, at: null }, "RF2: impBlobOwner tolerates a missing live object");
// RF2 review fix (9/23): the guard is CONTENT-based. importPlan stamps settings.seedCoreHash = impCoreHash(blob) over the
// seed-owned keys (pool roster rows, surgeonRules, groupRules, holidays; canonical JSON, two FNV-1a lanes); the CLI hashes
// the LIVE blob's same keys and reads 'app-edited' only when a stamp is present and differs. updated_by alone is no
// signal: the autosave re-stamps the person_id on ANY state change (a day edit, a trade, a realtime adopt), so it stays
// information - and the fallback only while the live row carries no stamp yet (before the first RF2 re-import).
{
  const b0 = clone(plan.blob);
  const h0 = IMP.impCoreHash(b0);
  ok(/^[0-9a-f]{16}$/.test(h0), "RF2 review fix: impCoreHash is 16 hex chars (two FNV-1a lanes), got " + JSON.stringify(h0));
  eq(plan.blob.settings.seedCoreHash, h0, "RF2 review fix: importPlan stamps settings.seedCoreHash = impCoreHash(blob)");
  const bReordered = clone(b0); bReordered.groupRules = {}; Object.keys(b0.groupRules).reverse().forEach((k) => { bReordered.groupRules[k] = b0.groupRules[k]; });
  eq(IMP.impCoreHash(bReordered), h0, "RF2 review fix: key order does not change the hash (jsonb re-orders keys)");
  const bSettings = clone(b0); bSettings.settings = { importedAt: "x", anything: 1 }; bSettings.lastPublished = { at: "2026-09-23T06:00:00Z" };
  eq(IMP.impCoreHash(bSettings), h0, "RF2 review fix: settings and lastPublished (app-owned keys) are outside the hash");
  const bExt = clone(b0); bExt.roster = bExt.roster.concat([{ id: "x1", name: "Atwell", code: "ATW", fullName: "Atwell", type: "external", active: true, roles: ["surgeon"] }]);
  eq(IMP.impCoreHash(bExt), h0, "RF2 review fix: a live outside surgeon (roster type external) is outside the hash - the seed owns the pool rows only");
  const bRule = clone(b0); bRule.groupRules = Object.assign({}, b0.groupRules, { maxConsecutivePrimaryDays: 99 });
  ok(IMP.impCoreHash(bRule) !== h0, "RF2 review fix: a changed groupRules key changes the hash");
  const bPool = clone(b0); bPool.roster = bPool.roster.map((r, i) => i === 0 ? Object.assign({}, r, { active: false }) : r);
  ok(IMP.impCoreHash(bPool) !== h0, "RF2 review fix: a changed pool roster row changes the hash");
  const mk = (blob, by, at) => ({ blob, blobUpdatedAt: at || "2026-09-24T14:00:00+00:00", blobUpdatedBy: by });
  const stTouched = IMP.impBlobEditState(mk(clone(b0), "s1"));
  eq([stTouched.hasRow, stTouched.basis, stTouched.appEdited, stTouched.by, stTouched.importerOwned], [true, "seedCoreHash", false, "s1", false], "RF2 review fix: a blob re-stamped by the app (updated_by s1) whose seed-owned keys still equal the stamp is NOT app-edited (fail-before: refused on updated_by alone)");
  const stRule = IMP.impBlobEditState(mk(bRule, "s1"));
  eq([stRule.basis, stRule.appEdited], ["seedCoreHash", true], "RF2 review fix: groupRules changed in Setup (live hash != stamp) -> app-edited");
  const stExt = IMP.impBlobEditState(mk(bExt, "s1"));
  eq([stExt.basis, stExt.appEdited], ["seedCoreHash", false], "RF2 review fix: an outside surgeon added in Setup is not a seed-owned edit");
  const noStamp = clone(b0); delete noStamp.settings.seedCoreHash;
  const stOldApp = IMP.impBlobEditState(mk(noStamp, "s1"));
  eq([stOldApp.basis, stOldApp.appEdited], ["updated_by", true], "RF2 review fix: no stamp on the live row yet + updated_by s1 -> app-edited through the updated_by fallback");
  const stOldSeed = IMP.impBlobEditState(mk(noStamp, "seed", "2026-09-23T05:27:45.838645+00:00"));
  eq([stOldSeed.basis, stOldSeed.appEdited, stOldSeed.importerOwned, stOldSeed.at], ["updated_by", false, true, "2026-09-23T05:27:45.838645+00:00"], "RF2 review fix: no stamp + updated_by seed (the live row of 9/23) -> importer-owned, not app-edited");
  eq(IMP.impBlobEditState(mk({}, null, "2026-09-23T00:00:00+00:00")).hasRow, false, "RF2 review fix: the schema's empty row is no row for the edit state either");
  eq(IMP.impBlobEditState(null).hasRow, false, "RF2 review fix: impBlobEditState tolerates a missing live object");
  ok(rf2Sql.indexOf("seedCoreHash") >= 0, "RF2 review fix: the SQL writes settings.seedCoreHash (the stamp reaches the live row through the merge)");
}
// the CLI (scripts/import-seed.js runs main() on require, so its guard is pinned on the source + the pure helper above)
{
  const cli = require("fs").readFileSync(path.join(__dirname, "..", "scripts", "import-seed.js"), "utf8");
  ok(/"call_schedule_data", "id=eq\.main&select=data,updated_at,updated_by"/.test(cli), "RF2: fetchLive selects updated_by of the blob (fail-before: data,updated_at)");
  ok(/blobUpdatedBy: blobRows\[0\] \? \(blobRows\[0\]\.updated_by \|\| null\) : null/.test(cli), "RF2: fetchLive returns blobUpdatedBy");
  ok(/IMP\.impBlobEditState\(live\)/.test(cli), "RF2 review fix: the CLI reads the edit state through impBlobEditState (content-based; updated_by is the fallback and information)");
  ok(/const coreWouldChange = Object\.keys\(blobKeys\)\.some\(\(k\) => k !== "settings" && blobKeys\[k\] !== "unchanged"\);/.test(cli), "RF2 review fix: coreWouldChange = a non-settings blob key changes in the plan");
  ok(/owner\.hasRow && owner\.appEdited && coreWouldChange && !args\.overwriteBlob/.test(cli), "RF2 review fix: the refusal keys on appEdited AND a CORE key change - a settings-only plan (importedAt / seedRevisionCount drift) never refuses");
  ok(cli.indexOf("settings keys only - nothing under Setup is reverted") >= 0, "RF2 review fix: the settings-only case is worded as such");
  ok(cli.indexOf("blob last written by ") >= 0, "RF2 review fix: 'blob last written by <who> at <ts>' is printed regardless of the verdict");
  ok(cli.indexOf("BLOB WAS EDITED IN THE APP at ") >= 0 && /a re-import would revert Setup edits/.test(cli), "RF2: the plan prints 'BLOB WAS EDITED IN THE APP at <ts> by <who>: a re-import would revert Setup edits'");
  ok(/t === "--overwrite-blob"/.test(cli) && /overwriteBlob/.test(cli), "RF2: --overwrite-blob is parsed");
  ok(/REFUSING TO APPLY: the shared setup \(call_schedule_data\) was last saved in the app/.test(cli) && /return 4;/.test(cli), "RF2: --apply refuses (exit 4) over an app-written blob without --overwrite-blob");
  ok(/rows are unaffected by this guard/.test(cli), "RF2: the refusal says the rows are unaffected by the guard");
}

console.log("ok " + n + " assertions");
