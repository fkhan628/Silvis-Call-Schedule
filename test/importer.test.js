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
eq(openOctBackups.length, 14, "14 open October backups (16 before BK 9/23: 10/9 and 10/15 backups are Burchett's locked manual edits now)");
ok(openOctBackups.every((d) => d.backup_locked === false), "open backups are never locked");
ok(days.filter((d) => d.backup_id == null).every((d) => d.backup_locked === false), "null backup -> never locked (all)");
eq(byDay["2026-10-15"].primary_id, null); eq(byDay["2026-10-15"].primary_locked, false, "10/15 primary open and unlocked");
eq(byDay["2026-10-15"].backup_id, BURCHETT, "BK 9/23: 10/15 backup is Burchett (his 9/23 email; a locked manual edit, mirrored in the seed)"); eq(byDay["2026-10-15"].backup_locked, true, "BK 9/23: ...and locked");
// 9/22 evening (item S): Sarkar at two days per week, October locks included - 10/24 came off her.
// Locked-open like 10/15 (a null slot is never locked); the seed's operational note rides in the row note.
eq(byDay["2026-10-24"].primary_id, null, "10/24 primary open since 9/22 evening (Sarkar at two days per week)");
eq(byDay["2026-10-24"].backup_id, null, "10/24 backup was already open");
eq(byDay["2026-10-24"].primary_locked, false, "10/24 locked-open: a null slot is never locked"); eq(byDay["2026-10-24"].backup_locked, false);
eq(byDay["2026-10-24"].note, "seed: faraz-2026-09-22-sarkar-two-days - open (9/22)", "10/24 note = provenance + the seed's operational note ('open (9/22)' since 9/23 - Faraz: no person in an anon-readable note; the live row is reworded to 'open (9/22)' by the day-edit tool)");
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
  ok(pd("2026-11-25", "primary").note.indexOf("The ER-panel author's document listed Burchett; Faraz 9/22: Khan covers 11/25, 2026 only - a one-off, not a rule") === 0, "T: 11/25 delta note opens with Faraz's wording: " + pd("2026-11-25", "primary").note);
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
eq(count(BURCHETT, "backup_only", "any"), 5, "BK 9/23: Burchett backup-only 10/12 (9/17) + 10/9, 10/15, 10/20, 10/22 (burchett-email-2026-09-23)");
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
eq(plan.stats.schedule_days, 73); eq(plan.stats.time_off, 8, "stats.time_off: 3 + Burchett's four 2027 weekends (9/22 evening) + his 2027-07-22..08-02 vacation (9/23)");
eq(plan.stats.scheduleDays.externalCover, 7); eq(plan.stats.scheduleDays.openBackup, 24, "open backups: 14 October (16 before BK 9/23: 10/9 and 10/15 are Burchett's) + 11/5 (Y) + 11/7, 11/8, 11/20, 11/23, 11/25 + 4 Thanksgiving days"); eq(plan.stats.scheduleDays.openPrimary, 7, "open primaries in the import: 10/15, 10/24 (9/22 evening) and, since T, 11/9, 11/10, 11/12, 11/13, 11/17 (Y FLIP: 11/5 is Acton's now)");

/* ------------------------------------------------------------ time_off */
step("time_off rows");
const to = plan.timeOffRows;
eq(to.length, 8, "2 Acton + 1 Philip + 5 Burchett (four 9/22 weekends + the 9/23 July - August vacation)");
eq(to.filter((t) => t.person_id === ACTON).map((t) => t.start_date + ".." + t.end_date), ["2026-11-19..2026-11-22", "2026-11-25..2026-11-29"]);
eq(to.filter((t) => t.person_id === PHILIP).map((t) => t.start_date + ".." + t.end_date), ["2026-10-15..2026-10-15"]);
eq(to.filter((t) => t.person_id === BURCHETT).map((t) => t.start_date + ".." + t.end_date), ["2027-01-09..2027-01-10", "2027-01-16..2027-01-17", "2027-02-12..2027-02-14", "2027-04-09..2027-04-11", "2027-07-22..2027-08-02"], "Burchett's four 2027 weekends exactly as stated (Sat+Sun in January, Fri-Sun in February and April) + Thu 7/22 - Mon 8/2 (stated 9/23)");
ok(to.every((t) => t.created_by === "seed"), "created_by 'seed' on every row, public note or not");
ok(to.filter((t) => t.person_id !== BURCHETT).every((t) => t.note === "vacation (seed)"), "private seed notes (Acton, Philip) still scrubbed to 'vacation (seed)'");
eq(to.filter((t) => t.person_id === BURCHETT).map((t) => t.note), ["unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "off (stated 9/23)"], "public seed notes (public: true) reach time_off as written - dates and a stated-on stamp, never a reason");
// which seed notes are public is read from the seed here, never from importer.js
const seedVac = [].concat(...Object.keys(seed.surgeonRules).map((id) => (seed.surgeonRules[id].timeOff || []).map((t) => Object.assign({ id: id }, t))));
const privateVacNotes = seedVac.filter((t) => t.note && t.public !== true).map((t) => t.note);
const publicVacNotes = seedVac.filter((t) => t.note && t.public === true).map((t) => t.note);
eq([privateVacNotes.length, publicVacNotes.length], [3, 5], "seed carries 3 private vacation notes (scrubbed) and 5 public ones (written)");
ok(seedVac.filter((t) => t.public === true).every((t) => t.id === BURCHETT && ["burchett-email-2026-09-22", "burchett-via-faraz-2026-09-23"].indexOf(t.source) >= 0), "the public entries are Burchett's, provenance in the seed only");
const sql = IMP.importSql(plan);
privateVacNotes.forEach((note) => ok(sql.indexOf(note) < 0 && JSON.stringify(to).indexOf(note) < 0, "private seed wording never written: " + note));
publicVacNotes.forEach((note) => ok(sql.indexOf(note) >= 0 && JSON.stringify(to).indexOf(note) >= 0, "public seed wording written: " + note));
ok(sql.indexOf("burchett-email-2026-09-22") < 0 && JSON.stringify(to).indexOf("burchett-email-2026-09-22") < 0 && JSON.stringify(plan.blob).indexOf("burchett-email-2026-09-22") < 0, "time_off provenance (source) stays in the seed - not in the rows, the SQL or the blob");
ok(sql.indexOf("burchett-via-faraz-2026-09-23") < 0 && JSON.stringify(to).indexOf("burchett-via-faraz-2026-09-23") < 0 && JSON.stringify(plan.blob).indexOf("burchett-via-faraz-2026-09-23") < 0, "PD: the July vacation's source stays in the seed too");
eq(plan.blob.surgeonRules[BURCHETT].timeOff, [{ start: "2027-01-09", end: "2027-01-10" }, { start: "2027-01-16", end: "2027-01-17" }, { start: "2027-02-12", end: "2027-02-14" }, { start: "2027-04-09", end: "2027-04-11" }, { start: "2027-07-22", end: "2027-08-02" }], "blob timeOff: dates only - no note, no public flag, no source");
// the dry-run inventory shows the public notes (path -> public), counted separately from the rule-note scrub
eq(plan.noteScrub.counts.timeOffPublic, 5, "noteScrub.counts.timeOffPublic = the public notes kept");
eq(plan.noteScrub.inventory.filter((e) => e.action === "public").map((e) => e.path), ["surgeonRules.s2.timeOff[0].note", "surgeonRules.s2.timeOff[1].note", "surgeonRules.s2.timeOff[2].note", "surgeonRules.s2.timeOff[3].note", "surgeonRules.s2.timeOff[4].note"], "inventory: one 'public' entry per public time_off note");
ok(plan.noteScrub.inventory.filter((e) => e.action === "public").every((e) => e.to === "time_off" && e.from === seed.surgeonRules.s2.timeOff[+e.path.match(/\[(\d+)\]/)[1]].note), "public entries: from = the seed's note at that path, to = 'time_off'");
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
eq(plan.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, { month: "2026-12", roles: ["primary", "backup"] }], "T: the explicit object entries for November and (9/23) December survive the import as written");
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
eq(SA.seedToTimeOffRows(seed).length, 8, "adapter: 8 vacation rows (Acton 2, Philip 1, Burchett 5 - four 9/22 weekends + the 9/23 July - August vacation)");
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
ok(sql.indexOf("'seed: faraz-2026-09-22-sarkar-two-days - open (9/22)'") >= 0, "10/24 note -> a plain '' literal (ASCII since 9/23; found: " + JSON.stringify((sql.match(/E?'seed: faraz-2026-09-22-sarkar[^']*'/) || [])[0]) + ")");
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
ok(inserts.length >= 1 + 1 + 1 + 1 + 8, "snapshot + blob + schedule_days + availability + 8 time_off inserts (" + inserts.length + ")");
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
eq((sql.match(/insert into public\.time_off/g) || []).length, 8, "one guarded insert per time_off row (8)");
// the stale-row delete guard lists all 7 (person, start, end) tuples - Burchett's four included
const toGuard = sql.slice(sql.indexOf("delete from public.time_off"), sql.indexOf("insert into public.time_off"));
const toTuples = to.map((r) => "('" + r.person_id + "', '" + r.start_date + "'::date, '" + r.end_date + "'::date)");
eq(toTuples.filter((t) => toGuard.indexOf(t) >= 0).length, 8, "time_off delete guard lists the 8 tuples");
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
eq(applyToModel(model, plan), { sd: 73, av: plan.availabilityRows.length, to: 8 }, "first apply writes everything");
eq(applyToModel(model, plan), { sd: 0, av: 0, to: 0 }, "second apply writes nothing");
ok(model.schedule_days.every((d) => d.version === 1), "versions untouched by the no-op re-run");

/* ------------------------------------------------------------ planDiff */
step("planDiff");
const d0 = IMP.planDiff(plan, { blob: {}, availability: [], time_off: [], schedule_days: [] });
eq(d0.tables.schedule_days.insert, 73); eq(d0.tables.availability.insert, plan.availabilityRows.length); eq(d0.tables.time_off.insert, 8);
eq(d0.tables.call_schedule_data.insert, 5); eq(d0.blocked, []); eq(d0.changes, []);
eq(d0.totalChanges, 5 + 73 + plan.availabilityRows.length + 8);
const liveEq = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
liveEq.blob.settings.importedAt = "2020-01-01T00:00:00Z"; // a different import time is not a change
liveEq.blob.settings.appAdded = true;                        // keys the app added are ignored
liveEq.blob.extraTopLevel = { keep: 1 };
const d1 = IMP.planDiff(plan, liveEq);
eq(d1.totalChanges, 0, "live == plan -> nothing"); eq(d1.changes, []); eq(d1.blocked, []);
ok(/No changes/.test(d1.text));
eq(d1.tables.schedule_days.unchanged, 73); eq(d1.tables.availability.unchanged, plan.availabilityRows.length); eq(d1.tables.time_off.unchanged, 8);
// the expected live diff for the orchestrator (item S): live = tonight's rows before S -> 1 schedule_days update (10/24), 4 time_off inserts, blob update, availability unchanged
const livePreS = clone(liveEq);
Object.assign(livePreS.schedule_days.find((d) => d.day === "2026-10-24"), { primary_id: "s6", primary_locked: true, note: "seed: burchett-email-2026-09-17" });
livePreS.time_off = livePreS.time_off.filter((t) => t.person_id !== BURCHETT);
livePreS.blob.surgeonRules = clone(plan.blob.surgeonRules); livePreS.blob.surgeonRules.s6.availableWindows[0].end = "2026-10-24";
const dS = IMP.planDiff(plan, livePreS);
eq([dS.tables.schedule_days.update, dS.tables.time_off.insert, dS.tables.availability.insert + dS.tables.availability.update + dS.tables.availability.delete, dS.tables.call_schedule_data.update, dS.tables.time_off.delete], [1, 5, 0, 1, 0], "expected live diff: 1 day update, 5 vacation inserts (four 9/22 weekends + the 9/23 July - August vacation), blob update, availability untouched, no deletes");
eq(dS.changes, ["10/24 P Sarkar -> OPEN"], "the one day change is 10/24 primary Sarkar -> OPEN");
eq(dS.tables.time_off.rows, ["insert Burchett 2027-01-09..2027-01-10", "insert Burchett 2027-01-16..2027-01-17", "insert Burchett 2027-02-12..2027-02-14", "insert Burchett 2027-04-09..2027-04-11", "insert Burchett 2027-07-22..2027-08-02"]);
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
eq(dG.tables.time_off.delete, 0); eq(dG.tables.time_off.kept, 8); eq(dG.kept.length, 8, "8 seed vacations listed as kept");
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
eq(seed.surgeonRules[ACTON].holidayRules.neverThanksgivingNote, "off (stated 9/17)", "seed note is the bare form since 9/23 (rules doc section 8 item 16: TRIM - no reason in the seed either; the importer does not rewrite the seed)");
// Prompt 12 X FLIP (9/22 evening): the second offender - Acton's Tuesday avoid with its note - left the seed
// entirely (his Tuesday is now the hard primary rule s3.hardNeverWeekdays, with no reason key); the pins below read its absence.
ok(!seed.surgeonRules[ACTON].recurringAvoid.some((r) => r.weekday === "Tue") && !("hardNeverWeekdaysReason" in seed.surgeonRules[ACTON]), "X: no Tuesday avoid entry and no hardNeverWeekdaysReason key in the seed (the rule carries no reason)");
ok(!("neverThanksgivingNote" in plan.blob.surgeonRules[ACTON].holidayRules), "AA FLIP: neverThanksgivingNote is dropped from the blob (F)");
eq(plan.blob.surgeonRules[ACTON].recurringAvoid.map((r) => "note" in r), [false], "AA FLIP: only the Sunday avoid remains in the blob (X) and it carries no note (F: the token 'outreach')");
ok(!/\b(hosts|family)\b/i.test(JSON.stringify(plan.blob)), "neither denylist token (hosts, family) anywhere in the blob");
ok(!/\b(hosts|family)\b/i.test(sql), "neither denylist token (hosts, family) in the generated SQL");
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
ok(rawSr[ACTON].holidayRules.neverThanksgivingNote === "off (stated 9/17)", "impScrubRuleNotes does not mutate its input");
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
eq(planName.timeOffRows.filter((t) => t.person_id === BURCHETT).map((t) => t.note), ["unavailable (stated 9/22)", "vacation (seed)", "vacation (seed)", "unavailable (stated 9/22)", "off (stated 9/23)"], "a public note naming a roster last name (any case) falls back to 'vacation (seed)'");
eq(planName.noteScrub.counts.timeOffPublic, 3, "a surname fallback is not counted as public");
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
eq(planPriv.timeOffRows.filter((t) => t.person_id === BURCHETT).map((t) => t.note), ["vacation (seed)", "vacation (seed)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "off (stated 9/23)"], "public: false and a non-boolean public read as private; only boolean true passes the note through");
eq(planPriv.noteScrub.counts.timeOffPublic, 3, "the public count follows the flags");
// public: true without a note -> the default wording; public: true with an operational note that passes -> written
const fxNoNote = clone(seed); delete fxNoNote.surgeonRules.s2.timeOff[0].note; fxNoNote.surgeonRules.s2.timeOff[1].note = "out of town (stated 9/22)";
const planNoNote = IMP.importPlan(fxNoNote, { now: NOW });
eq(planNoNote.timeOffRows.filter((t) => t.person_id === BURCHETT).slice(0, 2).map((t) => t.note), ["vacation (seed)", "out of town (stated 9/22)"], "public without a note -> 'vacation (seed)'; a passing operational note is written as is");
ok(planNoNote.timeOffRows.every((t) => t.created_by === "seed"), "created_by stays 'seed' whatever the note");
// the blob copy never sees the flag, the note or the source, whichever way the seed is flagged
eq(planPriv.blob.surgeonRules[BURCHETT].timeOff.map((t) => Object.keys(t).sort().join(",")), ["end,start", "end,start", "end,start", "end,start", "end,start"], "blob timeOff keys are start/end only");
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
eq(plan.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, { month: "2026-12", roles: ["primary", "backup"] }], "Y: Burchett's November whitelist stays (both roles); 9/23: December is the object form too");
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
  ok(!DENY.test(pd("backup").note + " " + pd("primary").note + " " + byDay["2026-11-05"].note) && !/reason|Burchett/i.test(pd("backup").note + " " + pd("primary").note + " " + byDay["2026-11-05"].note), "Y: no denylist word, no personal reason and no other surgeon's name in the 11/5 wording that reaches a row");
}
// the expected live diff for the orchestrator (REPORT-FIRST): live = the rows as they stand after T (11/5 = B Acton, the s3
// November availability rows, the blob with his November list). Rebuilt here from the seed itself by putting T's state back,
// so the count of rows the importer will DELETE is derived, never copied.
{
  const seedPreY = clone(seed);
  delete seedPreY.offerPeriods; // Prompt 14 P5 fix b (9/23): the pre-Y world has no offer periods - with them, an untagged November list of a surgeon who has a mode is refused (OFFER_SOURCE_INVALID)
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
eq(aaPublic, ["unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "unavailable (stated 9/22)", "off (stated 9/23)"], "AA: the public time_off notes as stated by the surgeon (dates and a stated-on stamp, never a reason)");
ok(aaPublic.every((x) => !DENY.test(x) && !AA_WORDS.test(x) && !/\b(clinic|Aledo|Clinton|DeWitt|Jackson County|birthday|wife|husband)\b/i.test(x)), "AA: no public time_off note carries a denylist word, a former token or a reason word");
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
  ok(/REFUSING TO APPLY: the shared setup \(call_schedule_data\) was last saved in the app/.test(cli) && /code: 4, proceed: false/.test(cli), "RF2: --apply refuses (exit 4) over an app-written blob without --overwrite-blob (IB restated the pin: the decision moved into decideApply, which returns { code: 4 } instead of 'return 4;')");
  ok(/rows are unaffected by this guard/.test(cli), "RF2: the refusal says the rows are unaffected by the guard");
}

/* ------------------------------------ IB: --apply keeps app-edited days, as the app's Apply does (9/23 overnight) */
// Observed 9/23 after the server-side publish (scripts/publish-preview.js): 31 plan days are app-owned (updated_by the
// publish tag; 10/24 also source 'generated'), the dry run listed them as BLOCKED (correct) and --apply REFUSED with
// exit 3 - so the three pending blob-only changes (settings seedRevisions retired + seedCoreHash stamp, roster s6
// fullName '', groupRules.timeOff.conflictRule) could not land, and no re-import could while a schedule is published.
// The app's Setup -> Import -> Apply keeps such days ('kept (app-edited)', helpers.suSeedDayMerge) and applies the
// rest; the CLI now does the same. Contract restated here: planDiff reports the blocked DAYS (blockedDays, ISO,
// sorted, deduped - the line list stays per slot); importSql(plan, { excludeDays }) writes NO statement for them (not
// the insert/update VALUES, not the stale delete's key list) and says so in its header; decideApply proceeds with
// everything else (exit 3 only under --strict-blocked, today's fail-closed refusal); the post-apply verify accepts a
// fresh plan reading 'Total changes: 0 (+N blocked)'. availability / time_off and the RF2 blob guard are untouched.
step("IB: --apply proceeds past app-edited days (kept, not written); --strict-blocked restores the exit-3 refusal");
{
  const cliPath = path.join(__dirname, "..", "scripts", "import-seed.js");
  const cliSrc = require("fs").readFileSync(cliPath, "utf8");
  // pinned BEFORE the require: a fail-before run must never run main() (a live fetch) from a test
  ok(/if \(require\.main === module\)/.test(cliSrc), "IB: scripts/import-seed.js runs main() only as the entry point (require.main === module) - fail-before: main() ran on require");
  const CLI = require(cliPath);
  ok(typeof CLI.decideApply === "function" && typeof CLI.verifyOutcome === "function" && typeof CLI.keptSummary === "function" && typeof CLI.parseArgs === "function", "IB: the CLI exports parseArgs / decideApply / verifyOutcome / keptSummary");
  eq([CLI.parseArgs(["--apply", "--strict-blocked"]).strictBlocked, CLI.parseArgs(["--apply"]).strictBlocked, CLI.parseArgs(["--dry-run"]).mode], [true, false, "dry-run"], "IB: --strict-blocked is parsed and off by default");
  ok(/3 refused to apply over app-edited days - --strict-blocked only/.test(cliSrc) && /0 ok \(app-edited days, if any, kept/.test(cliSrc), "IB: the header's exit-code table documents both behaviours (0 keeps, 3 only under --strict-blocked)");
  ok(cliSrc.indexOf("REFUSING TO APPLY: \" + diff.blocked.length") < 0, "IB: the unconditional exit-3 refusal is gone from main()");
  ok(/IMP\.importSql\(plan, \{ excludeDays: keptDays \}\)/.test(cliSrc) && /const keptDays = diff\.blockedDays/.test(cliSrc), "IB: the CLI builds the SQL with the blocked days excluded (dry run and apply alike)");
  ok(/verifyOutcome\(verify, keptDays, args\.strictBlocked\)/.test(cliSrc), "IB: the post-apply proof goes through verifyOutcome with the kept days");

  // synthetic live set = the plan's own rows, plus: D1 app-owned by SOURCE ('generated', the 10/24 shape), D2 app-owned
  // by updated_by alone (source still 'import', the shape of the 30 other published rows), both differing from the seed
  // -> blocked; DU seed-owned and differing -> a real update; DS a seed-owned day the seed no longer lists -> delete.
  const TAG = "publish-preview (Faraz, 2026-09-23 overnight)";
  const D1 = "2026-10-07", D2 = "2026-11-29", DU = "2026-10-13", DS = "2026-12-31";
  const other = (r) => (r.primary_id === "s1" ? "s2" : "s1");
  const mkLive = () => {
    const rows = clone(plan.scheduleDayRows).map((r) => {
      if (r.day === D1) return Object.assign(r, { backup_id: other(r), source: "generated", updated_by: TAG, version: 3 });
      if (r.day === D2) return Object.assign(r, { backup_id: other(r), source: "import", updated_by: TAG, version: 4 });
      if (r.day === DU) return Object.assign(r, { backup_id: other(r), source: "import", updated_by: "seed", version: 1 });
      return r;
    });
    rows.push({ day: DS, primary_id: "s2", backup_id: null, primary_locked: true, backup_locked: false, source: "import", external_cover: null, note: "seed: x", version: 1, updated_by: "seed" });
    return { blob: clone(plan.blob), blobUpdatedAt: "2026-09-23T05:27:45+00:00", blobUpdatedBy: "seed", availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: rows };
  };
  ok(plan.scheduleDayRows.some((r) => r.day === D1) && plan.scheduleDayRows.some((r) => r.day === D2) && plan.scheduleDayRows.some((r) => r.day === DU) && !plan.scheduleDayRows.some((r) => r.day === DS), "IB fixture: D1/D2/DU are plan days, DS is not");
  const live = mkLive();
  const d = IMP.planDiff(plan, live);
  // (1) planDiff: the blocked DAYS, and the applied counts exclude them
  eq(d.blockedDays, [D1, D2], "IB: planDiff.blockedDays = the app-owned differing days, ISO, sorted (fail-before: undefined)");
  eq(d.blocked.length, 2, "IB: the per-slot blocked line list is unchanged (one B change each)");
  eq([d.tables.schedule_days.blocked, d.tables.schedule_days.update, d.tables.schedule_days.delete, d.tables.schedule_days.insert], [2, 1, 1, 0], "IB: schedule_days counts - blocked 2, update 1 (DU), delete 1 (DS), insert 0");
  eq(d.totalChanges, 2, "IB: the applied count (update DU + delete DS) excludes the blocked days");
  eq(d.lines[d.lines.length - 1], "Total changes: 2 (incl. 1 delete(s) of seed-owned rows) (+2 blocked)", "IB: the diff's last line");
  ok(d.changes.some((t) => /^12\/31 .* -> deleted \(seed-owned day no longer in the seed\)$/.test(t)), "IB: DS is in the stale-delete list: " + d.changes.filter((t) => /deleted/.test(t)).join(" | "));
  ok(!d.changes.some((t) => /deleted/.test(t) && (/^10\/7 /.test(t) || /^11\/29 /.test(t))), "IB: the stale-delete list never includes a blocked day");
  ok(d.blocked.every((t) => /\[BLOCKED: live source '(generated|import)' updated_by 'publish-preview \(Faraz, 2026-09-23 overnight\)' v[34] - edited in the app, not overwritten\]$/.test(t)), "IB: the blocked lines read exactly as the dry run prints them: " + d.blocked.join(" | "));
  // (2) importSql with the blocked days excluded: no statement for them anywhere in the schedule_days section
  const sqlK = IMP.importSql(plan, { excludeDays: d.blockedDays });
  const sdSection = (s) => s.slice(s.indexOf("-- 3a. schedule_days"), s.indexOf("-- 4a. availability"));
  ok(sdSection(sqlK).length > 100 && sdSection(sql).length > 100, "IB: both SQLs carry a schedule_days section");
  [D1, D2].forEach((day) => {
    ok(sdSection(sqlK).indexOf("'" + day + "'") < 0, "IB: the schedule_days section of the SQL carries no statement for kept day " + day + " (fail-before: in the stale NOT IN list and in the insert VALUES)");
    ok(sqlK.indexOf("('" + day + "', ") < 0, "IB: no schedule_days VALUES row for " + day + " anywhere in the SQL (a '<day>'::date key may still appear in the availability / time_off sections - other tables, checked above by section)");
    ok(sdSection(sql).indexOf("'" + day + "'") >= 0, "IB fail-before shape: without excludeDays the day IS written (" + day + ")");
  });
  ok(sdSection(sqlK).indexOf("('" + DU + "', ") >= 0 && sdSection(sqlK).indexOf("'" + DU + "'::date") >= 0, "IB: the seed-owned differing day DU is still written and still in the stale key list");
  eq((sdSection(sqlK).match(/::date/g) || []).length, plan.scheduleDayRows.length - 2, "IB: the stale delete's key list = every plan day minus the 2 kept (they are app-owned: the delete's ownership clause never matches them)");
  ok(new RegExp("^-- seed generatedOn .*; " + (plan.scheduleDayRows.length - 2) + " schedule_days \\(2 app-edited day\\(s\\) kept, not written\\), " + plan.availabilityRows.length + " availability, " + plan.timeOffRows.length + " time_off rows$", "m").test(sqlK), "IB: the SQL header counts the written days and says how many were kept: " + (sqlK.match(/^-- seed generatedOn .*$/m) || [""])[0]);
  ok(/-- 3a\. schedule_days: drop seed-owned days .*\n--     days the app has touched since .* are never deleted\n--     \(2 app-edited day\(s\) kept out of this key list: they are app-owned, so the ownership clause above never matches them\)/.test(sdSection(sqlK)), "IB: the stale-delete comment names the kept count, never the days");
  // the rest of the SQL is byte-identical: blob merge, availability, time_off are unaffected
  eq(sqlK.slice(sqlK.indexOf("-- 1. snapshot"), sqlK.indexOf("-- 3a.")), sql.slice(sql.indexOf("-- 1. snapshot"), sql.indexOf("-- 3a.")), "IB: snapshot + blob merge identical with and without excludeDays");
  eq(sqlK.slice(sqlK.indexOf("-- 4a.")), sql.slice(sql.indexOf("-- 4a.")), "IB: availability + time_off sections identical with and without excludeDays (their app-edited protection is unchanged)");
  eq(IMP.importSql(plan, {}), sql, "IB: importSql(plan, {}) is byte-identical to importSql(plan)");
  eq(IMP.importSql(plan, { excludeDays: [] }), sql, "IB: an empty excludeDays changes nothing");
  eq(IMP.importSql(plan, { excludeDays: ["2027-01-01", "2026-13-99"] }), sql, "IB: excluding days the plan does not carry changes nothing");
  {
    // IB review (findings 1/4): EVERY plan day app-owned -> planDiff and importSql must agree. An empty NOT IN list is
    // not valid SQL and an unlisted delete would be wipe-shaped, so the SQL emits no stale delete; planDiff therefore
    // reports the stale seed-owned days as KEPT (never promises a delete the SQL cannot carry) and the 3a comment states
    // the real reason (the plan HAS rows - they are all kept). Unreachable with today's live data (42 of 73 seed-owned).
    const liveAll = mkLive();
    liveAll.schedule_days = liveAll.schedule_days.map((r) => r.day === DS ? r : Object.assign(r, { note: "app-edited", source: "import", updated_by: TAG, version: 5 }));
    const dAll = IMP.planDiff(plan, liveAll);
    eq(dAll.blockedDays, plan.scheduleDayRows.map((r) => r.day).slice().sort(), "IB corner fixture: every plan day is blocked");
    eq([dAll.tables.schedule_days.delete, dAll.tables.schedule_days.kept, dAll.totalChanges, dAll.totalDeletes], [0, 1, 0, 0], "IB corner: with every plan day app-owned the stale seed-owned day DS is KEPT, not promised as a delete (fail-before: delete 1, totalChanges 1)");
    ok(dAll.kept.length === 1 && /^schedule_days 12\/31 .* \[KEPT: every plan day is app-owned \(kept\), so the SQL writes no schedule_days statement - seed-owned day not deleted\]$/.test(dAll.kept[0]), "IB corner: the kept line says why: " + dAll.kept[0]);
    ok(!dAll.changes.some((t) => /deleted/.test(t)), "IB corner: no delete line in the change list");
    eq(dAll.lines[dAll.lines.length - 1], "Total changes: 0 (+" + dAll.blocked.length + " blocked)", "IB corner: the diff's last line promises nothing the SQL cannot carry");
    const all = IMP.importSql(plan, { excludeDays: dAll.blockedDays });
    ok(all.indexOf("-- 3a. schedule_days: every plan day is app-owned (" + plan.scheduleDayRows.length + " kept) - no stale delete emitted: the SQL writes no schedule_days statement, seed-owned live days left alone (no wipe)") >= 0, "IB corner: the 3a comment states the real reason (fail-before: 'plan has no rows' - untrue, the plan has " + plan.scheduleDayRows.length + " rows)");
    ok(all.indexOf("delete from public.schedule_days") < 0 && all.indexOf("-- 3. schedule_days: nothing to import") >= 0, "IB corner: no schedule_days statement at all - no delete, no insert");
    ok(all.indexOf("plan has no rows - seed-owned live days left alone") < 0, "IB corner: the 'plan has no rows' wording is reserved for a plan that truly has none");
    ok(IMP.importSql(Object.assign({}, plan, { scheduleDayRows: [] })).indexOf("-- 3a. schedule_days: plan has no rows - seed-owned live days left alone (no wipe)") >= 0, "IB corner: ...and a plan with no schedule_days rows still says so, byte for byte");
    eq(CLI.verifyOutcome(dAll, dAll.blockedDays, false).ok, true, "IB corner: a fresh plan after such an apply (all kept, 0 changes) VERIFIES - plan and SQL agree (fail-before: NOT FULLY APPLIED over a delete the SQL never issued)");
  }
  // (3) the exit-code decision (pure): 0 and proceed without the flag; 3 with it; the RF2 exit 4 and the workdir check keep their order
  const owner = IMP.impBlobEditState(live);
  eq([owner.hasRow, owner.appEdited], [true, false], "IB fixture: the live blob equals the plan (stamp matches) - the RF2 guard is quiet");
  const args0 = { strictBlocked: false, overwriteBlob: false, workdir: "C:/linked" };
  const dec = CLI.decideApply(d, owner, false, args0);
  eq([dec.code, dec.proceed], [0, true], "IB: with blocked days and no flag the decision is exit-code path 0, proceed (fail-before: 3)");
  ok(dec.lines[0] === "KEPT (app-edited, not written - as the app's Apply keeps them): 2 schedule_days row(s); the SQL carries no statement for them:", "IB: the apply report opens the kept block: " + dec.lines[0]);
  eq(dec.lines.slice(1, 3), d.blocked.map((l) => "  " + l), "IB: ...and prints the blocked list exactly as the dry run does");
  eq(CLI.keptSummary(d), "kept 2 app-edited day(s): 2026-10-07, 2026-11-29 (2 blocked slot change(s))", "IB: the summary line names the kept days");
  eq(CLI.keptSummary(IMP.planDiff(plan, { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) })), "", "IB: no kept days -> empty summary (the old wording stays)");
  const decS = CLI.decideApply(d, owner, false, Object.assign({}, args0, { strictBlocked: true }));
  eq([decS.code, decS.proceed], [3, false], "IB: --strict-blocked restores the refusal (exit 3)");
  ok(decS.lines[0] === "REFUSING TO APPLY (--strict-blocked): 2 schedule_days change(s) on app-edited day(s) (source != 'import' or updated_by != 'seed') differ from the seed:" && decS.lines[decS.lines.length - 1].indexOf("Resolve them in the app (or update the seed) and re-run") === 0, "IB: the strict refusal wording: " + decS.lines[0] + " ... " + decS.lines[decS.lines.length - 1]);
  eq(decS.lines.slice(1, 3), d.blocked.map((l) => "  " + l), "IB: the strict refusal lists the blocked lines");
  {
    const liveU = mkLive(); liveU.schedule_days = liveU.schedule_days.map((r) => (r.day === D1 || r.day === D2) ? Object.assign(r, { backup_id: null, source: "import", updated_by: "seed", version: 1 }) : r);
    const dU = IMP.planDiff(plan, liveU);
    eq([dU.blockedDays, dU.totalChanges], [[], 2], "IB fixture: nothing blocked, DU + DS still pending");
    eq([CLI.decideApply(dU, owner, false, Object.assign({}, args0, { strictBlocked: true })).code, CLI.decideApply(dU, owner, false, Object.assign({}, args0, { strictBlocked: true })).proceed], [0, true], "IB: --strict-blocked with nothing blocked proceeds");
    eq(CLI.decideApply(dU, owner, false, args0).lines, [], "IB: nothing kept -> no KEPT block");
  }
  {
    const edited = Object.assign({}, owner, { appEdited: true, basis: "seedCoreHash", by: "s1", at: "2026-09-24T14:00:00+00:00" });
    const dec4 = CLI.decideApply(d, edited, true, args0);
    eq([dec4.code, dec4.proceed], [4, false], "IB: the RF2 blob guard (exit 4) is untouched - it fires with blocked days kept");
    ok(/^REFUSING TO APPLY: the shared setup \(call_schedule_data\) was last saved in the app at 2026-09-24T14:00:00\+00:00 by s1/.test(dec4.lines[0]), "IB: exit-4 wording unchanged: " + dec4.lines[0]);
    eq(CLI.decideApply(d, edited, true, Object.assign({}, args0, { strictBlocked: true })).code, 3, "IB: under --strict-blocked the blocked refusal (3) still comes before the blob guard (4), as today");
    eq(CLI.decideApply(d, edited, true, Object.assign({}, args0, { overwriteBlob: true })).code, 0, "IB: --overwrite-blob lifts 4 and the run proceeds with the days kept");
    eq(CLI.decideApply(d, owner, false, Object.assign({}, args0, { workdir: null })).code, 1, "IB: no --workdir -> 1 (after the refusals, before the SQL)");
  }
  // (4) verify after the apply: the applied part matches, the kept days still differ -> 'Total changes: 0 (+N blocked)' is VERIFIED
  const after = mkLive();
  after.schedule_days = after.schedule_days.filter((r) => r.day !== DS).map((r) => r.day === DU ? Object.assign(r, { backup_id: null, version: 2 }) : r);
  const v = IMP.planDiff(plan, after);
  eq(v.lines[v.lines.length - 1], "Total changes: 0 (+2 blocked)", "IB: a fresh plan after the apply reads 'Total changes: 0 (+2 blocked)' (pinned: that is what the live re-run must print)");
  eq([v.totalChanges, v.blockedDays], [0, [D1, D2]], "IB: ...zero applied changes, the same two days still blocked");
  const vo = CLI.verifyOutcome(v, d.blockedDays, false);
  eq(vo.ok, true, "IB: verifyOutcome accepts '(+N blocked)' (fail-before: NOT FULLY APPLIED because verify.blocked was non-empty)");
  eq(vo.lines, ["VERIFIED: the applied part is fully applied - a fresh plan reads 'Total changes: 0 (+2 blocked)'; kept 2 app-edited day(s): 2026-10-07, 2026-11-29 (2 blocked slot change(s))."], "IB: the VERIFIED line names the kept days");
  eq(CLI.verifyOutcome(v, d.blockedDays, true).ok, false, "IB: under --strict-blocked a blocked day after the apply is still a failure (nothing may be kept)");
  {
    // IB review (finding 6): under --strict-blocked the SQL only ever runs with nothing blocked, so a blocked day at
    // verify time APPEARED during the run (a concurrent app edit). Every applied change landed - say so instead of
    // blaming the apply; still exit 1 (nothing may be kept under the flag).
    const vS = CLI.verifyOutcome(v, [], true);
    eq([vS.ok, vS.lines[0], vS.lines[1], vS.lines.length], [false, "APPLIED, but app-edited day(s) appeared during the run (--strict-blocked): 2026-10-07, 2026-11-29 - they were not written and nothing may be kept under the flag; remaining diff:", v.text, 2], "IB: strict + 0 applied changes + blocked days -> a distinct line naming the days (fail-before: 'NOT FULLY APPLIED - remaining diff:')");
    const vS2 = CLI.verifyOutcome(d, [], true);
    eq(vS2.lines[0], "NOT FULLY APPLIED - remaining diff:", "IB: strict with an applied change still pending keeps the NOT FULLY APPLIED wording");
  }
  eq(CLI.verifyOutcome(d, d.blockedDays, false).ok, false, "IB: a remaining applied change (DU / DS still pending) is NOT verified");
  ok(CLI.verifyOutcome(d, d.blockedDays, false).lines[0] === "NOT FULLY APPLIED - remaining diff:" && CLI.verifyOutcome(d, d.blockedDays, false).lines[1] === d.text, "IB: the failure prints the remaining diff");
  {
    const vDrift = CLI.verifyOutcome(v, [D1], false);
    eq(vDrift.ok, true, "IB: a blocked set that grew while the run ran (a concurrent app edit) is still VERIFIED - the applied part is what is compared");
    ok(vDrift.lines.length === 2 && /^NOTE: the app-edited set changed while this ran/.test(vDrift.lines[1]) && vDrift.lines[1].indexOf("newly blocked 2026-11-29") >= 0 && vDrift.lines[1].indexOf("2026-10-07") < 0, "IB: ...with a NOTE naming the newly blocked day only: " + vDrift.lines[1]);
    const vClean = IMP.planDiff(plan, { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) });
    eq(CLI.verifyOutcome(vClean, [], false).lines, ["VERIFIED: plan fully applied - a re-run would change nothing."], "IB: nothing kept -> the old VERIFIED wording, byte for byte");
  }
}

// ---- Prompt 14 P5 (9/23) ----
// The first offer period through the importer - one mechanism (docs/PROMPT-14-OFFER-PERIODS.md part 5, part 2a's last
// sentence). The seed carries offerPeriods[] (the period definition, Faraz's offersCloseAt, rulesOnly, offerModes) and,
// per surgeon, offerSources tags on the dated lists that ARE the offers (s2 explicitAvailable Nov/Dec, s3 offeredDays Nov,
// s4 availableWeeks). importPlan(seed, { now, offerPeriods: true }) plans call_periods + call_offers rows (one per listed
// day inside the period and on/after today in Central time; role_pref from the list's role; entered_by 'scheduler',
// source 'email-relay', note 'seed: <tag>'), skips a day inside the person's vacation (the DB trigger OF002 would refuse
// it), keeps a day that is already locked (the record stays honest), writes NO 'available' row for a submitted surgeon's
// period days and NO explicitListMonths entry for his period months; October and every other list stay as before.
// Without the option (the in-app Setup import until part 3) the plan is the pre-period plan above. Every expected value
// is derived from the seed here, never copied out of importer.js.
step("Prompt 14 P5: the first period + offers planned from the seed's tagged lists; legacy callers unchanged");
const P5_NOW = NOW; // 2026-09-22T03:00Z = 2026-09-21 in America/Chicago: every period day lies ahead
const p5 = IMP.importPlan(seed, { now: P5_NOW, offerPeriods: true });
const PER = seed.offerPeriods[0];
const inPer = (d) => d >= PER.start && d <= PER.end;
eq(seed.offerPeriods.length, 2, "P5 / PD: the seed carries two periods - the milestone period (published 9/23) and Feb - Apr 2027");
eq([PER.label, PER.start, PER.end, PER.offersCloseAt, PER.publishBy, PER.status, PER.rulesOnly, PER.offerModes, PER.source],
  ["Nov 2026 - Jan 2027", "2026-11-02", "2027-01-03", "2026-10-02", "2026-10-05", "published", ["s1", "s6"], { s2: "exhaustive", s4: "exhaustive", s3: "preferred", s5: "preferred" }, "faraz-2026-09-22-prompt-14"],
  "P5: the period as Faraz set it (offersCloseAt 10/2 by hand, Khan + Sarkar rules-only, Burchett + Philip exhaustive, Acton + Fierce preferred); status published since 9/23 (PD)");
// (1) the call_periods rows
eq(p5.periodRows, [
  { label: "Nov 2026 - Jan 2027", start_day: "2026-11-02", end_day: "2027-01-03", offers_close_at: "2026-10-02", publish_by: "2026-10-05", status: "published", rules_only_ids: ["s1", "s6"], offer_modes: { s2: "exhaustive", s4: "exhaustive", s3: "preferred", s5: "preferred" }, created_by: "seed" },
  { label: "Feb 2027 - Apr 2027", start_day: "2027-02-01", end_day: "2027-04-30", offers_close_at: "2026-12-21", publish_by: "2027-01-04", status: "upcoming", rules_only_ids: [], offer_modes: {}, created_by: "seed" }
], "P5 / PD: two call_periods rows, upsert key start_day, created_by seed; the second = the UI's 3-month preset from 2027-02-01 with Faraz's end 4/30 (label prdLabelFor, rules_only_ids [] and offer_modes {} exactly as createPeriod writes them)");
// (2) the offers, derived from the seed's lists: Burchett Nov 7 P + 8 B (role-keyed) + Dec 19 plain -> 'either' (incl. 1/1-1/3, inside
//     the period); Acton's relayed Nov list 7 P + 3 B (s3.offeredDays); Philip's weeks inside the period x 7 days -> 'either'
const s2Nov = seed.surgeonRules[BURCHETT].explicitAvailable["2026-11"], s2Dec = seed.surgeonRules[BURCHETT].explicitAvailable["2026-12"];
const s3Nov = seed.surgeonRules[ACTON].offeredDays["2026-11"];
const s4Weeks = seed.surgeonRules[PHILIP].availableWeeks.filter(inPer);
const s4Days = [].concat(...s4Weeks.map((m) => [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(m, k)))).filter(inPer);
const expOffers = []
  .concat(s2Nov.primary.map((d) => [BURCHETT, d, "primary", "seed: burchett-email-2026-09-17"]))
  .concat(s2Nov.backup.map((d) => [BURCHETT, d, "backup", "seed: burchett-email-2026-09-17"]))
  .concat(s2Dec.map((d) => [BURCHETT, d, "either", "seed: burchett-email-2026-09-17"]))
  .concat(s3Nov.primary.map((d) => [ACTON, d, "primary", "seed: acton-via-burchett-relay-2026-09-17"]))
  .concat(s3Nov.backup.map((d) => [ACTON, d, "backup", "seed: acton-via-burchett-relay-2026-09-17"]))
  .concat(s4Days.map((d) => [PHILIP, d, "either", "seed: philip-email-2026-09-20"]))
  .map((x) => ({ person_id: x[0], day: x[1], role_pref: x[2], note: x[3], entered_by: "scheduler", source: "email-relay" }))
  .sort((a, b) => a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
eq([s2Nov.primary.length, s2Nov.backup.length, s2Dec.length, s3Nov.primary.length, s3Nov.backup.length, s4Weeks.length, s4Days.length], [7, 8, 19, 7, 3, 5, 35], "P5: the seed's list sizes (Burchett 7 + 8 + 19, Acton 7 + 3, Philip 5 weeks = 35 days)");
eq(p5.offerRows, expOffers, "P5: call_offers rows == every listed day of a surgeon with a mode, inside the period, sorted by person then day");
eq(p5.offerRows.length, 79, "P5: 79 offers (Burchett 34, Acton 10, Philip 35)");
eq(p5.offerRows.filter((o) => o.person_id === BURCHETT).length, 34); eq(p5.offerRows.filter((o) => o.person_id === ACTON).length, 10); eq(p5.offerRows.filter((o) => o.person_id === PHILIP).length, 35);
eq(p5.offerRows.filter((o) => [KHAN, FIERCE, "s6"].indexOf(o.person_id) >= 0), [], "P5: no offer for Khan / Sarkar (rules-only) or Fierce (no dated single day inside the period in the seed)");
const offerAt = (id, d) => p5.offerRows.find((o) => o.person_id === id && o.day === d);
eq(offerAt(BURCHETT, "2026-11-03").role_pref, "primary", "P5: Burchett 11/3 primary (the ER-panel author's lock stays a lock; the offer is the honest record)");
eq(offerAt(BURCHETT, "2026-11-02").role_pref, "backup"); eq(offerAt(BURCHETT, "2026-11-09").role_pref, "backup", "P5: the four backups Fierce's week took are still his offers (unplaced with slot-locked, never vanished)");
eq(offerAt(BURCHETT, "2026-11-25").role_pref, "primary", "P5: 11/25 is still his offer (Khan's locked one-off keeps the slot)");
eq(offerAt(BURCHETT, "2026-12-25").role_pref, "either"); eq(offerAt(BURCHETT, "2027-01-03").role_pref, "either", "P5: the December list spills to 1/3 = the period's last day");
eq(offerAt(ACTON, "2026-11-05").role_pref, "backup", "P5: Acton's relayed 11/5 backup is an offer (he holds the primary: unplaced, holds-other-role)");
eq(offerAt(ACTON, "2026-11-02").role_pref, "primary"); eq(offerAt(ACTON, "2026-11-17").role_pref, "backup");
eq(offerAt(PHILIP, "2026-11-09").role_pref, "either"); eq(offerAt(PHILIP, "2027-01-03").role_pref, "either", "P5: Philip's 12/28 week ends on the period's last day");
ok(!p5.offerRows.some((o) => !inPer(o.day)), "P5: no offer outside the period (October lists, Philip's 2027-01-11+ weeks)");
ok(!p5.offerRows.some((o) => o.day <= "2026-11-01"), "P5: nothing from October / 11/1");
ok(p5.offerRows.every((o) => /^seed: [a-z0-9-]+$/.test(o.note)), "P5: every note is 'seed: <tag>' - operational provenance, no reason, no contact data");
eq(p5.offerSkips, [], "P5: the real seed skips nothing (no listed day falls on a vacation)");
// (3) the status table the dry run prints (surgeon | status | mode | offered days), derived like SQL offer_status()
eq(p5.offerStatus.length, 2);
eq(p5.offerStatus[0].label, "Nov 2026 - Jan 2027");
eq(p5.offerStatus[1].label, "Feb 2027 - Apr 2027");
eq(p5.offerStatus[0].byPerson, {
  s1: { status: "rules_only", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 },
  s2: { status: "submitted", mode: "exhaustive", offered: 34, primary: 7, backup: 8, either: 19 },
  s3: { status: "submitted", mode: "preferred", offered: 10, primary: 7, backup: 3, either: 0 },
  s4: { status: "submitted", mode: "exhaustive", offered: 35, primary: 0, backup: 0, either: 35 },
  s5: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 },
  s6: { status: "rules_only", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }
}, "P5: status table - Burchett / Acton / Philip submitted, Khan / Sarkar rules-only, Fierce not started");
// (4) today filter (Central): a now inside the period keeps only the days on/after today; the retirement of rows / months does not
//     depend on today
{
  const later = IMP.importPlan(seed, { now: "2026-11-10T12:00:00Z", offerPeriods: true }); // 06:00 CST 11/10 -> today 2026-11-10
  eq(later.offerPeriods.today, "2026-11-10", "P5: today is the Central date of now");
  eq(later.offerRows, expOffers.filter((o) => o.day >= "2026-11-10"), "P5: offers before today are not planned (the DB refuses a past day, OF001)");
  eq(later.offerRows.filter((o) => o.person_id === BURCHETT).length, 27, "P5: Burchett keeps 4 P + 4 B of November + 19 of December");
  const edge = IMP.importPlan(seed, { now: "2026-11-10T04:30:00Z", offerPeriods: true }); // 22:30 CST on 11/9 -> today 2026-11-09
  eq(edge.offerPeriods.today, "2026-11-09", "P5: 04:30Z is still 11/9 in Chicago (CST)");
  ok(!!edge.offerRows.find((o) => o.person_id === BURCHETT && o.day === "2026-11-09"), "P5: 11/9 is still offered at 22:30 Central the evening before");
  eq(later.offerStatus[0].byPerson.s2.status, "submitted", "P5: status reads the whole list, not the future part (the DB counts past rows too)");
  eq(later.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10"], "P5: the retired months stay retired whatever today is");
  eq(later.availabilityRows, p5.availabilityRows, "P5: the availability plan does not move with today");
}
// (5) vacation skip: a listed day inside the person's vacation is skipped and listed (OF002 would refuse the row)
{
  const fx = clone(seed); fx.surgeonRules[BURCHETT].timeOff.push({ start: "2026-12-05", end: "2026-12-06", note: "private" });
  const pv = IMP.importPlan(fx, { now: P5_NOW, offerPeriods: true });
  eq(pv.offerRows.filter((o) => o.person_id === BURCHETT).length, 32, "P5: 12/5 and 12/6 are not offers");
  eq(pv.offerSkips, [{ person_id: BURCHETT, day: "2026-12-05", role_pref: "either", reason: "vacation" }, { person_id: BURCHETT, day: "2026-12-06", role_pref: "either", reason: "vacation" }], "P5: the skipped days are listed with the reason 'vacation' (path-free, reason-free wording)");
  eq(pv.timeOffRows.filter((t) => t.person_id === BURCHETT).length, 6, "P5: the vacation itself is still planned");
  ok(IMP.importSql(pv).indexOf("'2026-12-05'") < 0 || !/call_offers[\s\S]*'s2', '2026-12-05'/.test(IMP.importSql(pv).slice(IMP.importSql(pv).indexOf("insert into public.call_offers"))), "P5: the skipped day is not in the call_offers insert");
}
// (6) a submitted surgeon: no 'available' row for the period days, no governed month for the period months; everything else identical
const s2PeriodAvail = plan.availabilityRows.filter((r) => r.person_id === BURCHETT && r.kind === "available" && inPer(r.start_date));
ok(s2PeriodAvail.length >= 4 && s2PeriodAvail.every((r) => inPer(r.end_date)), "P5: the legacy plan carries Burchett's November / December available rows (" + s2PeriodAvail.length + ")");
eq(p5.availabilityRows, plan.availabilityRows.filter((r) => !(r.person_id === BURCHETT && r.kind === "available" && inPer(r.start_date))), "P5: the period-aware availability plan == the legacy plan minus Burchett's November / December available rows (October, unavailable / backup_only / no_backup rows, Philip's 10/29..11/1 range untouched)");
ok(!p5.availabilityRows.some((r) => r.kind === "available" && r.person_id === BURCHETT && inPer(r.start_date)), "P5: no s2 available row inside the period");
ok(p5.availabilityRows.some((r) => r.person_id === BURCHETT && r.kind === "unavailable" && r.end_date === "2026-11-01"), "P5: Burchett's October unavailable range (ends 11/1) stays");
ok(p5.availabilityRows.some((r) => r.person_id === PHILIP && r.kind === "available" && r.role === "primary" && r.start_date === "2026-10-29" && r.end_date === "2026-11-01"), "P5: Philip's October primary range stays (it ends before the period)");
eq(p5.availabilityRows.filter((r) => r.start_date < "2026-11-02"), plan.availabilityRows.filter((r) => r.start_date < "2026-11-02"), "P5: October untouched, row for row");
eq(p5.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10"], "P5: Burchett's explicitListMonths = October only (the November object entry and December are retired: his offers govern)");
eq(p5.blob.surgeonRules[ACTON].explicitListMonths, ["2026-10"], "P5: Acton unchanged (Y already left November ungoverned)");
eq(p5.blob.surgeonRules[PHILIP].explicitListMonths, [{ month: "2026-10", roles: ["primary"] }], "P5: Philip's October entry stays");
ok(!("explicitListMonths" in p5.blob.surgeonRules[KHAN]), "P5: Khan still has none");
eq(p5.blob.surgeonRules[BURCHETT].explicitAvailable, stripNoteKeys(seed.surgeonRules[BURCHETT].explicitAvailable), "P5: the statement lists themselves stay in the blob as written (data; rules.js governs by explicitListMonths and, inside the period, by the offers)");
{
  const noLists = (sr) => { const c = clone(sr); Object.keys(c).forEach((id) => { delete c[id].explicitListMonths; }); return c; };
  eq(noLists(p5.blob.surgeonRules), noLists(plan.blob.surgeonRules), "P5: apart from explicitListMonths the two blobs' surgeonRules are identical");
  // rebase 9/23 onto RF2: settings.seedCoreHash hashes the seed-owned keys as written, and the retired explicitListMonths
  // ARE a surgeonRules difference - so the stamps must differ while every other settings key is identical.
  const noHash = (st) => { const c = clone(st); delete c.seedCoreHash; return c; };
  eq([p5.blob.roster, p5.blob.groupRules, p5.blob.holidays, noHash(p5.blob.settings)], [plan.blob.roster, plan.blob.groupRules, plan.blob.holidays, noHash(plan.blob.settings)], "P5: roster, groupRules, holidays, settings (apart from the seedCoreHash stamp) identical");
  ok(typeof p5.blob.settings.seedCoreHash === "string" && p5.blob.settings.seedCoreHash !== plan.blob.settings.seedCoreHash && p5.blob.settings.seedCoreHash === IMP.impCoreHash(p5.blob), "P5 x RF2: the offers plan carries its own seedCoreHash (the retired explicitListMonths change the seed-owned surgeonRules), computed over the plan's blob");
}
eq([p5.timeOffRows, p5.scheduleDayRows], [plan.timeOffRows, plan.scheduleDayRows], "P5: time_off and schedule_days plans are byte-identical to the legacy plan (the locks stay locks)");
eq(p5.stats.call_offers, 79); eq(p5.stats.call_periods, 2);
// (7) the offers-aware ctx from the plan: statuses / modes as the DB would derive them; Burchett's November whitelist is now 'not-offered';
//     rules-only and not-started surgeons are byte-identical to the legacy ctx on every period day and role
{
  const ctxP5 = R.buildContext({ roster: p5.blob.roster, surgeonRules: p5.blob.surgeonRules, groupRules: p5.blob.groupRules, holidays: p5.blob.holidays,
    timeOffRows: p5.timeOffRows, availabilityRows: p5.availabilityRows, schedule: rowsToSchedule(p5.scheduleDayRows), periods: p5.periodRows, offers: p5.offerRows });
  eq(ctxP5.warnings, [], "P5: the planned rows build a warning-free ctx");
  eq(["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => { const st = R.offerState(ctxP5, "2026-12-01", id); return st.status + "/" + st.mode; }),
    ["rules_only/preferred", "submitted/exhaustive", "submitted/preferred", "submitted/exhaustive", "not_started/preferred", "rules_only/preferred"], "P5: rules.js derives the same statuses and modes as the dry-run table");
  ok(R.eligibility(ctxP5, "2026-11-10", "primary", BURCHETT).hard.indexOf("not-offered") >= 0 && R.eligibility(ctxP5, "2026-11-10", "primary", BURCHETT).hard.indexOf("whitelist-month") < 0, "P5: Burchett 11/10 primary = not-offered (exhaustive), no whitelist-month any more");
  ok(R.eligibility(ctxP5, "2026-11-10", "backup", BURCHETT).hard.indexOf("not-offered") >= 0, "P5: ...and backup too (his November list named both roles; T's object entry said the same)");
  ok(R.eligibility(testCtx, "2026-12-11", "backup", BURCHETT).ok === false && R.eligibility(testCtx, "2026-12-11", "backup", BURCHETT).hard.indexOf("whitelist-month") >= 0 && R.eligibility(ctxP5, "2026-12-11", "backup", BURCHETT).hard.indexOf("not-offered") >= 0, "P5: Burchett's December list -> 'either' offers under exhaustive: an unlisted December BACKUP day is not-offered inside the period, the same reading the legacy plan already gives it (9/23: his December object entry governs BOTH roles - hard whitelist-month; the open question 15 remains for Philip's weeks only)");
  ok(R.eligibility(ctxP5, "2026-12-01", "primary", BURCHETT).soft.some((s) => s.reason === "offered"), "P5: an offered day carries the offered bonus");
  ok(R.eligibility(ctxP5, "2026-11-30", "primary", ACTON).ok === true && R.eligibility(ctxP5, "2026-11-30", "primary", ACTON).soft.some((s) => s.reason === "outside-offers"), "P5: Acton (preferred) stays eligible off his list with the outside-offers term");
  ok(R.eligibility(testCtx, "2026-12-16", "backup", PHILIP).ok === true && R.eligibility(ctxP5, "2026-12-16", "backup", PHILIP).hard.indexOf("not-offered") >= 0, "P5 CONSEQUENCE (open question): Philip's weeks -> 'either' offers under exhaustive: a backup day outside his weeks is not-offered now (legacy: the weeks whitelist restricted primary only)");
  let same = 0;
  for (let d = PER.start; d <= PER.end; d = addDays(d, 1)) ["primary", "backup"].forEach((role) => [KHAN, FIERCE, "s6"].forEach((id) => {
    const a = R.eligibility(ctxP5, d, role, id), b = R.eligibility(testCtx, d, role, id);
    same++;
    if (IMP.impCanon(a) !== IMP.impCanon(b)) throw new Error("P5: rules-only / not-started eligibility differs " + d + " " + role + " " + id + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b));
  }));
  ok(same > 300, "P5: Khan, Fierce and Sarkar are byte-identical to the legacy ctx on every period day and role (" + same + " triples)");
  // the seed adapter's opt-in path builds the same ctx (tests / scripts can ask for the offers-aware world)
  const viaAdapter = R.buildContext(IMP.impSeedContextInput(seed, { offerPeriods: true, now: P5_NOW }));
  eq(IMP.impCanon(project(viaAdapter)), IMP.impCanon(project(ctxP5)), "P5: impSeedContextInput(seed, { offerPeriods: true }) == the ctx from the planned rows");
  eq(["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => R.offerState(viaAdapter, "2026-12-01", id).status), ["rules_only", "submitted", "submitted", "submitted", "not_started", "rules_only"]);
  eq(R.buildContext(SA.seedToContextInput(seed)).periods, [], "P5: the legacy adapter still builds a period-free ctx (rules.test.js / the regression are unchanged)");
}
// (8) legacy callers: no option -> no offers, the pre-period plan; the plan says the seed carries a period it did not plan
ok(!("offerRows" in plan) && !("periodRows" in plan) && plan.offerPeriods && plan.offerPeriods.enabled === false && plan.offerPeriods.seedPeriods === 2, "P5: importPlan(seed, { now }) plans no offers and says the seed carries 2 periods it did not plan (the in-app import's legacy plan - the app refuses Apply for such a seed)");
eq(SA.seedToSurgeonRules(seed)[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, { month: "2026-12", roles: ["primary", "backup"] }], "P5: the legacy adapter still derives Burchett's three months, December in the object form since 9/23 (rules.test.js pins them)");
// (9) SQL: snapshot scope, the period upsert, the guarded offers insert, the ownership-guarded delete (future days only), the order
const sql5 = IMP.importSql(p5);
ok(/^[\x00-\x7f]*$/.test(sql5), "P5: SQL 7-bit");
ok(/'call_offers',\s+\(select coalesce\(jsonb_agg\(to_jsonb\(o\)/.test(sql5) && /'call_periods',\s+\(select coalesce\(jsonb_agg\(to_jsonb\(p\)/.test(sql5), "P5: the pre-import snapshot carries call_offers and call_periods (Faraz 9/22)");
ok(/or exists \(select 1 from public\.call_offers\)/.test(sql) && /'call_offers',/.test(sql), "P5: ...in the legacy SQL too (the snapshot scope is universal)");
ok(/insert into public\.call_periods \(label, start_day, end_day, offers_close_at, publish_by, status, rules_only_ids, offer_modes, created_by\)/.test(sql5), "P5: call_periods insert column list");
ok(/on conflict \(start_day\) do update set/.test(sql5) && /offer_modes\s*=\s*coalesce\(call_periods\.offer_modes, '\{\}'::jsonb\) \|\| excluded\.offer_modes/.test(sql5), "P5: period upsert by start_day; offer_modes merged (the seed's keys win, app-set keys for others stay)");
ok(!/set[\s\S]*?\bstatus\s*=\s*excluded\.status/.test(sql5.slice(sql5.indexOf("insert into public.call_periods"), sql5.indexOf("insert into public.call_offers"))), "P5: a re-import never rewrites the period's status (the app owns the lifecycle)");
ok(/insert into public\.call_offers \(person_id, day, role_pref, note, entered_by, source\)/.test(sql5), "P5: call_offers insert column list");
ok(/on conflict \(person_id, day\) do update set[\s\S]*?where call_offers\.source in \('email-relay', 'import'\) and call_offers\.entered_by = 'scheduler' and call_offers\.note like 'seed: %'/.test(sql5), "P5: the upsert touches seed-owned rows only (an app-entered offer for the same day is left as the surgeon wrote it)");
ok(/delete from public\.call_offers\n where source in \('email-relay', 'import'\) and entered_by = 'scheduler' and note like 'seed: %'\n   and day >= '2026-09-21'::date\n   and \(person_id, day\) not in \(/.test(sql5), "P5: stale seed-owned offers are deleted set-based, future days only (past rows are the record)");
ok(sql5.indexOf("insert into public.time_off") < sql5.indexOf("insert into public.call_periods") && sql5.indexOf("insert into public.call_periods") < sql5.indexOf("delete from public.call_offers") && sql5.indexOf("delete from public.call_offers") < sql5.indexOf("insert into public.call_offers"), "P5: periods after time_off (OF002 reads time_off), delete before insert");
eq((sql5.match(/\('s2', '2026-11-03'::date, 'primary', 'seed: burchett-email-2026-09-17', 'scheduler', 'email-relay'\)/g) || []).length, 1, "P5: a row literal as written");
ok(/\(select count\(\*\) from public\.call_offers\)\s+as call_offers/.test(sql5) && /as call_offers_rows/.test(sql5) && /as call_periods_rows/.test(sql5), "P5: the returning select carries the offers / periods rows (the CLI verifies from them: the tables are not anon-readable)");
ok(!/call_offers_rows/.test(sql), "P5: the legacy SQL's returning select is unchanged apart from the snapshot");
ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(sql5) && IMP.impFindContactValues(sql5).length === 0, "P5: no contact-looking value");
eq(IMP.importSql(IMP.importPlan(seed, { now: P5_NOW, offerPeriods: true })), sql5, "P5: deterministic");
// (10) planDiff: live unknown (anon cannot read the two tables) -> every row an 'upsert', counted; live known -> exact; app rows never deleted
{
  const base = { blob: clone(p5.blob), availability: clone(p5.availabilityRows), time_off: clone(p5.timeOffRows), schedule_days: clone(p5.scheduleDayRows) };
  const dU = IMP.planDiff(p5, base);
  eq([dU.tables.call_offers.upsert, dU.tables.call_offers.unknown, dU.tables.call_periods.upsert, dU.tables.call_periods.unknown], [79, true, 2, true], "P5: without live rows the two tables read as unknown and every planned row counts as an upsert");
  eq(dU.totalChanges, 81, "P5: 79 + 2 counted (the apply must not be skipped as 'nothing to do')");
  ok(/call_offers: plan 79 row\(s\) - live rows not readable with the anon key/.test(dU.text), "P5: the dry run says why it cannot diff: " + dU.lines.filter((l) => /^call_offers/.test(l)).join(" | "));
  ok(dU.lines.some((l) => /^offers status \(Nov 2026 - Jan 2027\):/.test(l)) && dU.lines.some((l) => /Burchett \| submitted \| exhaustive \| 34 \(7 P, 8 B, 19 either\)/.test(l)) && dU.lines.some((l) => /Khan \| rules_only \| - \| 0/.test(l)) && dU.lines.some((l) => /Fierce \| not_started \| - \| 0/.test(l)), "P5: the status table is in the dry-run text: " + dU.lines.filter((l) => /\|/.test(l)).join(" | "));
  const appRow = { person_id: ACTON, day: "2026-11-30", role_pref: "either", note: null, entered_by: ACTON, source: "app" };
  const relayInApp = { person_id: PHILIP, day: "2026-11-05", role_pref: "backup", note: "relayed in the app", entered_by: "scheduler", source: "email-relay" };
  const staleSeed = { person_id: BURCHETT, day: "2026-12-29", role_pref: "either", note: "seed: burchett-email-2026-09-17", entered_by: "scheduler", source: "email-relay" };
  const pastSeed = { person_id: BURCHETT, day: "2026-09-15", role_pref: "primary", note: "seed: burchett-email-2026-09-17", entered_by: "scheduler", source: "email-relay" };
  const liveK = Object.assign({}, base, { call_offers: clone(p5.offerRows).concat([appRow, relayInApp, staleSeed, pastSeed]), call_periods: p5.periodRows.map((r, i) => Object.assign({ id: "11111111-1111-1111-1111-11111111111" + (i + 1), created_at: "x" }, clone(r))) });
  const dK = IMP.planDiff(p5, liveK);
  eq([dK.tables.call_offers.insert, dK.tables.call_offers.update, dK.tables.call_offers.unchanged, dK.tables.call_offers.delete, dK.tables.call_offers.kept, dK.tables.call_offers.blocked], [0, 0, 79, 1, 3, 0], "P5: exact diff - 79 unchanged, the stale seed-owned 12/29 deleted, the app row / the in-app relay / the past seed row kept");
  eq([dK.tables.call_periods.insert, dK.tables.call_periods.update, dK.tables.call_periods.unchanged], [0, 0, 2], "P5: the two period rows are unchanged (id / created_at ignored)");
  eq(dK.totalChanges, 1); eq(dK.totalDeletes, 1);
  ok(dK.tables.call_offers.rows.some((l) => /^delete Burchett 2026-12-29 either \(seed-owned, no longer in the seed\)/.test(l)), "P5: the delete line: " + dK.tables.call_offers.rows.join(" | "));
  ok(dK.kept.some((l) => /^call_offers Acton 2026-11-30 either \[KEPT: entered in the app\]/.test(l)) && dK.kept.some((l) => /^call_offers Philip 2026-11-05 backup \[KEPT: entered in the app\]/.test(l)) && dK.kept.some((l) => /^call_offers Burchett 2026-09-15 primary \[KEPT: before today\]/.test(l)), "P5: kept rows named with why: " + dK.kept.join(" | "));
  // an app-owned row on a planned day (the surgeon painted 11/3 as backup himself): the plan's row is BLOCKED, never an update
  const liveOwn = Object.assign({}, liveK, { call_offers: liveK.call_offers.filter((o) => !(o.person_id === BURCHETT && o.day === "2026-11-03")).concat([{ person_id: BURCHETT, day: "2026-11-03", role_pref: "backup", note: null, entered_by: BURCHETT, source: "app" }]) });
  const dO = IMP.planDiff(p5, liveOwn);
  eq([dO.tables.call_offers.blocked, dO.tables.call_offers.update, dO.tables.call_offers.unchanged], [1, 0, 78], "P5: the surgeon's own entry wins");
  ok(dO.blocked.some((l) => /^Burchett 2026-11-03 primary \[BLOCKED: the surgeon's own offer \(backup, source 'app'\) stays\]/.test(l)), "P5: blocked line: " + dO.blocked.join(" | "));
  // a seed-owned row whose role changed in the seed -> update
  const liveRole = Object.assign({}, liveK, { call_offers: liveK.call_offers.map((o) => o.person_id === BURCHETT && o.day === "2026-11-03" ? Object.assign({}, o, { role_pref: "either" }) : o) });
  eq(IMP.planDiff(p5, liveRole).tables.call_offers.update, 1, "P5: role change on a seed-owned row -> update");
  ok(IMP.planDiff(p5, liveRole).tables.call_offers.rows.some((l) => /^update Burchett 2026-11-03 either -> primary/.test(l)));
  // a period whose dates / modes changed in the seed -> update; a different start_day -> insert (a second period)
  const livePer = Object.assign({}, liveK, { call_periods: [Object.assign({}, liveK.call_periods[0], { offer_modes: { s2: "preferred" } })] });
  eq(IMP.planDiff(p5, livePer).tables.call_periods.update, 1, "P5: a mode change -> period update");
  eq(IMP.planDiff(p5, Object.assign({}, liveK, { call_periods: [] })).tables.call_periods.insert, 2, "P5: no live period -> insert (both)");
  // live vacations (anon-readable) that would make OF002 refuse a planned offer are reported and block the apply
  const liveVac = Object.assign({}, liveK, { time_off: liveK.time_off.concat([{ person_id: ACTON, start_date: "2026-11-16", end_date: "2026-11-17", note: "vacation", created_by: ACTON }]) });
  const dV = IMP.planDiff(p5, liveVac);
  eq(dV.blockedOffers, ["Acton 2026-11-16 primary [BLOCKED: inside a live vacation 2026-11-16..2026-11-17 - the DB would refuse the row (OF002); drop the day from the list or the vacation]", "Acton 2026-11-17 backup [BLOCKED: inside a live vacation 2026-11-16..2026-11-17 - the DB would refuse the row (OF002); drop the day from the list or the vacation]"], "P5: offers inside a live vacation are named");
  ok(dV.blocked.length >= 2 && dV.tables.call_offers.blocked === 2, "P5: ...and counted as blocked");
  // the legacy plan against a live that carries offers: no offers table, one line saying the seed's period was not planned
  const dL = IMP.planDiff(plan, liveK);
  ok(!("call_offers" in dL.tables) && dL.lines.some((l) => /^offer periods: the seed carries 2 period\(s\) that this plan did NOT convert/.test(l)), "P5: legacy plan -> no offers diff, one warning line: " + dL.lines.filter((l) => /^offer periods/.test(l)).join(" | "));
}
// (11) the offers input for a generate run (scripts / the orchestrator's preview) is the plan's own rows
eq(IMP.impOffersInput(p5), { periods: p5.periodRows, offers: p5.offerRows }, "P5: impOffersInput(plan) = { periods, offers }");
// (12) shape guards: a tagged list of a surgeon without a mode is not converted (warned); a bad mode word, a period without dates,
//      an unknown rules-only id refuse; a seed without offerPeriods plans nothing even with the option
{
  const fxNoMode = clone(seed); delete fxNoMode.offerPeriods[0].offerModes.s4;
  const pNM = IMP.importPlan(fxNoMode, { now: P5_NOW, offerPeriods: true });
  eq(pNM.offerRows.filter((o) => o.person_id === PHILIP), [], "P5: Philip's tagged weeks are not offers without a mode for him");
  eq(pNM.offerStatus[0].byPerson.s4.status, "not_started");
  ok(pNM.offerWarnings.some((w) => /surgeonRules\.s4\.offerSources\.availableWeeks: tagged but s4 has no offerModes entry/.test(w)), "P5: ...and the dry run says so: " + pNM.offerWarnings.join(" | "));
  ok(pNM.availabilityRows.some((r) => r.person_id === PHILIP && r.start_date === "2026-10-29"), "P5: his rows are the legacy rows");
  refusesWith("OFFER_PERIOD_INVALID: offerPeriods[0].offerModes.s2", (fx) => { fx.offerPeriods[0].offerModes.s2 = "strict"; }, "P5: a mode word outside exhaustive / preferred");
  refusesWith("OFFER_PERIOD_INVALID: offerPeriods[0].rulesOnly", (fx) => { fx.offerPeriods[0].rulesOnly.push("s9"); }, "P5: a rules-only id outside the roster");
  refusesWith("OFFER_PERIOD_INVALID: offerPeriods[0].end", (fx) => { fx.offerPeriods[0].end = "2026-10-31"; }, "P5: end before start");
  refusesWith("OFFER_PERIOD_INVALID: offerPeriods[0].offersCloseAt", (fx) => { fx.offerPeriods[0].offersCloseAt = "2026-11-03"; }, "P5: a close date after the start (the table's check)");
  refusesWith("OFFER_PERIOD_INVALID: offerPeriods[0]", (fx) => { fx.offerPeriods[0].rulesOnly = ["s1", "s2"]; }, "P5: a surgeon both rules-only and with a mode");
  const fxNone = clone(seed); delete fxNone.offerPeriods;
  const pNone = IMP.importPlan(fxNone, { now: P5_NOW, offerPeriods: true });
  eq([pNone.periodRows, pNone.offerRows, pNone.offerPeriods.enabled, pNone.availabilityRows], [[], [], true, plan.availabilityRows], "P5: no offerPeriods in the seed -> nothing planned, the legacy rows");
  refuses((fx) => { fx.surgeonRules.s2.offerSources.explicitAvailable["2026-11"].tag = "x@example.test"; }, "P5: contact data in a tag");
  refusesWith("NOTE_DENYLIST: surgeonRules.s2.offerSources.explicitAvailable.2026-11.tag (\"family\")", (fx) => { fx.surgeonRules.s2.offerSources.explicitAvailable["2026-11"].tag = "family-email"; }, "P5: a denylist word in a tag (it would be written to call_offers.note)");
}
// (13) the seed record: revision, open questions, reason-free wording
ok(seed._meta.revisions.some((t) => /Prompt 14 P5/.test(t)), "P5: _meta.revisions records the item");
ok(seed.openQuestions.some((t) => /^15\./.test(t) && /Burchett/.test(t) && /December/.test(t)) && seed.openQuestions.some((t) => /^16\./.test(t) && /Fierce/.test(t)), "P5: open questions 15 (Burchett's December list under exhaustive) and 16 (Fierce's single days) recorded");
ok(!DENY.test(JSON.stringify(seed.offerPeriods)) && !/@/.test(JSON.stringify(seed.offerPeriods)), "P5: the period block carries no reason word and no contact data");
ok(/Prompt 14 P5/.test(seed.groupRules.whitelistMonths.rule), "P5: groupRules.whitelistMonths.rule says how a period-covered month is governed now");
// (14) review fixes (9/23 review of P5)
//   a) the call_offers insert proposes only rows that would change (a VALUES-derived select with NOT EXISTS): a row-level
//      BEFORE INSERT trigger runs for every proposed row BEFORE the conflict check, so a plain 'insert ... values ... on
//      conflict do update where ...' would put every planned row through OF001/OF002/OF003 on every run and, after
//      offers_close_at, roll the WHOLE import back although nothing changed (the CLI is not the scheduler)
//   b) an untagged dated list of a surgeon with a mode that reaches into the period refuses (before: silently retired
//      from both mechanisms - no available row, no governed month, no offer)
//   c) overlapping periods refuse; a period label is gated against the note denylist like an offer note
//   d) a submitted surgeon with 0 planned rows (listed days all past / on a vacation) is named in the warnings
{
  const refusesP5 = (prefix, mutate, label) => {
    const fx = clone(seed); mutate(fx);
    let msg = null;
    try { IMP.importPlan(fx, { now: P5_NOW, offerPeriods: true }); } catch (e) { msg = e.message; }
    ok(msg && msg.indexOf(prefix) === 0, label + " -> " + prefix + " (" + (msg || "no error").slice(0, 120) + ")");
    let legacy = null;
    try { IMP.importPlan(fx, { now: P5_NOW }); } catch (e) { legacy = e.message; }
    ok(legacy && legacy.indexOf(prefix) === 0, label + " -> refused by the legacy plan too (a bad seed is a bad seed)");
    return msg;
  };
  // a) SQL shape
  const offersSql = sql5.slice(sql5.indexOf("insert into public.call_offers"), sql5.indexOf("commit;"));
  ok(/^insert into public\.call_offers \(person_id, day, role_pref, note, entered_by, source\)\nselect v\.person_id, v\.day, v\.role_pref, v\.note, v\.entered_by, v\.source\nfrom \(values\n/.test(offersSql), "P5 fix a: the call_offers insert selects from a VALUES list (never 'insert ... values' straight into the table)");
  ok(/\n\) as v\(person_id, day, role_pref, note, entered_by, source\)\nwhere not exists \(\n  select 1 from public\.call_offers o\n   where o\.person_id = v\.person_id and o\.day = v\.day\n     and \(not \(o\.source in \('email-relay', 'import'\) and o\.entered_by = 'scheduler' and o\.note like 'seed: %'\)\n          or \(o\.role_pref, o\.note, o\.source\) is not distinct from \(v\.role_pref, v\.note, v\.source\)\)\)\non conflict \(person_id, day\) do update set/.test(offersSql), "P5 fix a: only a new (person_id, day) or a seed-owned row that differs is proposed - an identical row and an app-owned row are never proposed, so no trigger fires for them: " + offersSql.slice(offersSql.indexOf(") as v("), offersSql.indexOf(") as v(") + 420).replace(/\n/g, "\\n"));
  ok(/where call_offers\.source in \('email-relay', 'import'\) and call_offers\.entered_by = 'scheduler' and call_offers\.note like 'seed: %'\n  and \(call_offers\.role_pref, call_offers\.note, call_offers\.source\) is distinct from \(excluded\.role_pref, excluded\.note, excluded\.source\);/.test(offersSql), "P5 fix a: the DO UPDATE guard stays (seed ownership + distinct)");
  ok(/-- 7\. call_offers:[^\n]*proposes only rows that would change/.test(sql5) && !/changes nothing fires no trigger/.test(sql5), "P5 fix a: the SQL comment says what the statement does (no 'a re-run that changes nothing fires no trigger' claim about the old shape)");
  ok(!/changes nothing fires no trigger/.test(require("fs").readFileSync(path.join(__dirname, "..", "scripts", "import-seed.js"), "utf8")) && !/changes nothing fires no trigger/.test(require("fs").readFileSync(path.join(__dirname, "..", "docs", "SILVIS-BUILD-GUIDE.md"), "utf8")), "P5 fix a: the CLI header and the guide carry the corrected claim");
  eq((sql5.match(/\('s2', '2026-11-03'::date, 'primary', 'seed: burchett-email-2026-09-17', 'scheduler', 'email-relay'\)/g) || []).length, 1, "P5 fix a: the row literals are unchanged");
  eq(IMP.importSql(IMP.importPlan(seed, { now: P5_NOW, offerPeriods: true })), sql5, "P5 fix a: still deterministic");
  // b) an untagged list inside the period of a surgeon with a mode
  refusesP5("OFFER_SOURCE_INVALID: surgeonRules.s2.explicitAvailable.2026-12 - lies inside Nov 2026 - Jan 2027", (fx) => { delete fx.surgeonRules.s2.offerSources.explicitAvailable["2026-12"]; }, "P5 fix b: Burchett's December list without its tag (before: December retired from both mechanisms, silently)");
  refusesP5("OFFER_SOURCE_INVALID: surgeonRules.s4.availableWeeks - lies inside Nov 2026 - Jan 2027", (fx) => { delete fx.surgeonRules.s4.offerSources; }, "P5 fix b: Philip's weeks without the tag");
  refusesP5("OFFER_SOURCE_INVALID: surgeonRules.s3.explicitAvailable.2026-12 - lies inside Nov 2026 - Jan 2027", (fx) => { fx.surgeonRules.s3.explicitAvailable["2026-12"] = ["2026-12-03"]; }, "P5 fix b: a new December list for Acton (a mode there) without a tag");
  {
    // a surgeon WITHOUT a mode keeps the legacy reading (his untagged list is a rule / a dated row there - not silently dropped)
    const fx = clone(seed); delete fx.offerPeriods[0].offerModes.s2; fx.surgeonRules.s2.offerSources = {};
    const p = IMP.importPlan(fx, { now: P5_NOW, offerPeriods: true });
    eq(p.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", { month: "2026-11", roles: ["primary", "backup"] }, { month: "2026-12", roles: ["primary", "backup"] }], "P5 fix b: no mode -> no refusal, the legacy months stay governed (December in the object form since 9/23)");
    ok(p.availabilityRows.some((r) => r.person_id === BURCHETT && r.kind === "available" && inPer(r.start_date)), "P5 fix b: ...and his available rows stay");
    // an untagged list entirely outside the period is fine (October lists)
    eq(p5.offerWarnings, ["surgeonRules.s4.offerSources.availableWeeks: tagged but s4 has no offerModes entry for Feb 2027 - Apr 2027 - not converted (the list stays a dated availability list / a rule there)"], "P5 fix b / PD: the real seed - every list inside the FIRST period is tagged and converted; the one warning is Philip's weeks reaching into Feb - Apr 2027, where he has no mode (they stay rules there - seed open question 17)");
  }
  // c) overlapping periods; label denylist
  refusesP5("OFFER_PERIOD_INVALID: offerPeriods[2] - Dec 2026 - Feb 2027 2026-12-07..2027-02-28 overlaps offerPeriods[0] Nov 2026 - Jan 2027 2026-11-02..2027-01-03", (fx) => { fx.offerPeriods.push(Object.assign({}, clone(fx.offerPeriods[0]), { label: "Dec 2026 - Feb 2027", start: "2026-12-07", end: "2027-02-28", offersCloseAt: "2026-10-26", publishBy: "2026-11-09" })); }, "P5 fix c: a third period overlapping the first");
  refusesP5("OFFER_PERIOD_INVALID: offerPeriods[2] - Apr - Jun 2027 2027-04-30..2027-06-30 overlaps offerPeriods[1] Feb 2027 - Apr 2027 2027-02-01..2027-04-30", (fx) => { fx.offerPeriods.push(Object.assign({}, clone(fx.offerPeriods[1]), { label: "Apr - Jun 2027", start: "2027-04-30", end: "2027-06-30", offersCloseAt: "2027-03-19", publishBy: "2027-04-02" })); }, "PD: a third period overlapping the second by one day (the seed's Feb - Apr ends 4/30)");
  {
    const fx = clone(seed); fx.offerPeriods.push(Object.assign({}, clone(fx.offerPeriods[1]), { label: "May - Jul 2027", start: "2027-05-01", end: "2027-07-31", offersCloseAt: "2027-03-20", publishBy: "2027-04-03" }));
    eq(IMP.impSeedPeriods(fx).length, 3, "P5 fix c: a period that starts the day after the last one ends is accepted");
  }
  refusesP5("NOTE_DENYLIST: offerPeriods[0].label (\"school\")", (fx) => { fx.offerPeriods[0].label = "Nov 2026 - Jan 2027 school term"; }, "P5 fix c: a denylist word in a period label (it reaches the authenticated-read call_periods table)");
  // d) submitted with 0 planned rows
  {
    const dec = IMP.importPlan(seed, { now: "2026-12-01T12:00:00Z", offerPeriods: true }); // Acton's listed days (11/2..11/18) are all past
    eq([dec.offerStatus[0].byPerson.s3.status, dec.offerStatus[0].byPerson.s3.offered], ["submitted", 0], "P5 fix d: Acton reads submitted (the rule: the whole list, like offer_status() on the live rows) with 0 rows planned");
    ok(dec.offerWarnings.some((w) => /^s3: submitted for Nov 2026 - Jan 2027 from listed days that are all past or inside a vacation - 0 rows planned; on a fresh database offer_status\(\) reads not_started until a row exists/.test(w)), "P5 fix d: ...and the dry run names it: " + dec.offerWarnings.join(" | "));
    ok(!p5.offerWarnings.some((w) => /0 rows planned/.test(w)), "P5 fix d: not raised for the real seed today");
  }
}

// ---- Prompt 14 PD (9/23 afternoon) ----
// The schedule for the first period went out 9/23, so docs/silvis-seed.json offerPeriods[0].status is 'published' and
// the second period (Feb 2027 - Apr 2027; Faraz: freeze 12/21, publish by 1/4, from the 3-month preset) follows it;
// Burchett's 2027-07-22..08-02 vacation joins s2.timeOff. The call_periods upsert must carry the seed's status
// FORWARD: before this fix the SQL wrote status on insert only, so a re-import of the published seed would have left
// the live row 'upcoming' and daily-reminder (mode offers) would have reminded on 9/29 and closed + mailed the
// scheduler on 10/2 for a period whose schedule is already out. The advance is one-way (upcoming < closed <
// generated < published): a seed 'upcoming' never reopens a period the cron or the app closed.
step("Prompt 14 PD: the period status rides the upsert (advance only), the second period plans no offer, Burchett's July vacation is one row");
{
  const basePD = { blob: clone(p5.blob), availability: clone(p5.availabilityRows), time_off: clone(p5.timeOffRows), schedule_days: clone(p5.scheduleDayRows) };
  const sqlPD = IMP.importSql(p5);
  const perSql = sqlPD.slice(sqlPD.indexOf("-- 6. call_periods"), sqlPD.indexOf("-- 7. call_offers"));
  ok(perSql.indexOf("('Nov 2026 - Jan 2027', '2026-11-02'::date, '2027-01-03'::date, '2026-10-02'::date, '2026-10-05'::date, 'published', '[\"s1\",\"s6\"]'::jsonb, '{\"s2\":\"exhaustive\",\"s4\":\"exhaustive\",\"s3\":\"preferred\",\"s5\":\"preferred\"}'::jsonb, 'seed'),") >= 0, "PD: the first period's VALUES row carries status 'published': " + perSql.split("\n").filter((l) => /^  \('/.test(l)).join(" | "));
  ok(perSql.indexOf("('Feb 2027 - Apr 2027', '2027-02-01'::date, '2027-04-30'::date, '2026-12-21'::date, '2027-01-04'::date, 'upcoming', '[]'::jsonb, '{}'::jsonb, 'seed')") >= 0, "PD: the second period's VALUES row (rules_only_ids [], offer_modes {})");
  const rank = "array_position(array['upcoming','closed','generated','published'], ";
  ok(perSql.indexOf("  status          = case when " + rank + "excluded.status) > " + rank + "call_periods.status) then excluded.status else call_periods.status end,") >= 0, "PD: ON CONFLICT advances status (upcoming < closed < generated < published) and never moves it back: " + perSql.split("\n").filter((l) => /status/.test(l)).join(" | "));
  ok(perSql.indexOf("status is written on insert only") < 0 && /the seed's status advances the live one/.test(perSql), "PD: the SQL comment says what the statement does");
  ok(/where \(call_periods\.label, call_periods\.end_day, call_periods\.offers_close_at, call_periods\.publish_by, call_periods\.status, call_periods\.rules_only_ids, /.test(perSql) && /\(excluded\.label, excluded\.end_day, excluded\.offers_close_at, excluded\.publish_by, case when /.test(perSql), "PD: the WHERE compares the advanced status with the live one (a status-only advance still updates; a seed status behind the live one does not)");
  eq(IMP.importSql(IMP.importPlan(seed, { now: P5_NOW, offerPeriods: true })), sqlPD, "PD: still deterministic");
  // planDiff with live rows: 'upcoming' live + 'published' seed -> ONE update naming the advance; 'closed' live + 'upcoming' seed -> unchanged
  const livePer = (over) => p5.periodRows.map((r, i) => Object.assign({ id: "22222222-2222-2222-2222-22222222222" + (i + 1), created_at: "x" }, clone(r), over[i] || {}));
  const dAdv = IMP.planDiff(p5, Object.assign({}, basePD, { call_offers: clone(p5.offerRows), call_periods: livePer([{ status: "upcoming" }]) }));
  eq([dAdv.tables.call_periods.insert, dAdv.tables.call_periods.update, dAdv.tables.call_periods.unchanged, dAdv.totalChanges], [0, 1, 1, 1], "PD: the live first period still 'upcoming' (the 9/23 apply) reads as ONE update - the status advance - and nothing else");
  eq(dAdv.tables.call_periods.rows, ["update Nov 2026 - Jan 2027 2026-11-02..2027-01-03 (close 2026-10-02, publish by 2026-10-05, status upcoming -> published)"], "PD: the update line names the status change");
  const dBack = IMP.planDiff(p5, Object.assign({}, basePD, { call_offers: clone(p5.offerRows), call_periods: livePer([{}, { status: "closed" }]) }));
  eq([dBack.tables.call_periods.update, dBack.tables.call_periods.unchanged, dBack.totalChanges], [0, 2, 0], "PD: a live second period the cron already closed is NOT moved back to the seed's 'upcoming' (unchanged; the SQL's case expression agrees)");
  const dMiss = IMP.planDiff(p5, Object.assign({}, basePD, { call_offers: clone(p5.offerRows), call_periods: livePer([{ status: "upcoming" }]).slice(0, 1) }));
  eq([dMiss.tables.call_periods.insert, dMiss.tables.call_periods.update, dMiss.tables.call_periods.unchanged], [1, 1, 0], "PD: against today's live table (one row, upcoming): update the first, insert the second");
  ok(dMiss.tables.call_periods.rows.indexOf("insert Feb 2027 - Apr 2027 2027-02-01..2027-04-30 (close 2026-12-21, publish by 2027-01-04, status upcoming)") >= 0, "PD: the insert line names the status: " + dMiss.tables.call_periods.rows.join(" | "));
  // the anon dry run (live rows unknown): every planned period is listed with its status
  const dUn = IMP.planDiff(p5, basePD);
  eq(dUn.lines.filter((l) => /^  upsert /.test(l)), ["  upsert Nov 2026 - Jan 2027 2026-11-02..2027-01-03 (close 2026-10-02, publish by 2026-10-05, status published)", "  upsert Feb 2027 - Apr 2027 2027-02-01..2027-04-30 (close 2026-12-21, publish by 2027-01-04, status upcoming)"], "PD: the anon dry run names each planned period with its status under the 'call_periods: plan 2 row(s)' line");
  ok(dUn.lines.some((l) => /^call_periods: plan 2 row\(s\) - live rows not readable with the anon key/.test(l)), "PD: the plan line is unchanged in shape");
  // the second period: nobody has a mode there -> no offer, no retired row, no governed-month change; everyone not_started
  eq(p5.offerRows.filter((o) => o.day >= "2027-01-04").length, 0, "PD: no call_offers row after the first period (Philip's 2027 weeks stay rules - no offerModes in Feb - Apr)");
  eq(p5.blob.surgeonRules[PHILIP].availableWeeks.filter((w) => w >= "2027-02-01" && w <= "2027-04-30"), ["2027-02-08", "2027-02-22", "2027-03-08", "2027-03-22", "2027-03-29", "2027-04-12", "2027-04-26"], "PD: Philip's Feb - Apr weeks stay in the blob's availableWeeks (rules.js reads them as his weeks whitelist outside a submitted status; they were never availability rows - the period-aware and legacy plans both carry 0 s4 rows after 1/3)");
  eq(p5.availabilityRows.filter((r) => r.person_id === PHILIP && r.start_date >= "2027-01-04"), plan.availabilityRows.filter((r) => r.person_id === PHILIP && r.start_date >= "2027-01-04"), "PD: ...and his 2027 availability rows are identical in both plans (none)");
  eq(p5.offerStatus[1].byPerson, { s1: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }, s2: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }, s3: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }, s4: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }, s5: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 }, s6: { status: "not_started", mode: "preferred", offered: 0, primary: 0, backup: 0, either: 0 } }, "PD: everyone not_started for Feb - Apr 2027 (the preset writes rules_only_ids [] - Khan / Sarkar rules-only was a first-period decision; they are reminded 12/7 and 12/18 unless they paint or choose their rules)");
  eq(p5.offerWarnings.length, 1, "PD: the second period raises exactly the Philip-weeks warning pinned above (his 2027 weeks stay rules until he has a mode there)");
  // Burchett's vacation
  eq(p5.timeOffRows.filter((t) => t.person_id === BURCHETT && t.start_date === "2027-07-22"), [{ person_id: BURCHETT, start_date: "2027-07-22", end_date: "2027-08-02", note: "off (stated 9/23)", created_by: "seed" }], "PD: Burchett 2027-07-22..08-02 -> one time_off row with the public note (both roles blocked; 7/21 blocks primary per dayBeforeRules)");
  ok(!p5.scheduleDayRows.some((d) => d.day >= "2027-07-21" && d.day <= "2027-08-02"), "PD: no schedule_days row in the range - the time_off trigger has nothing to refuse");
}

console.log("ok " + n + " assertions");
