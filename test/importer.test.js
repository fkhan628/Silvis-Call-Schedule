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
eq(days.length, 53, "49 hand-schedule days + 4 Thanksgiving days");
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
eq(count(ACTON, "available", "primary"), 10); eq(count(ACTON, "available", "backup"), 3);
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
eq(plan.stats.schedule_days, 53); eq(plan.stats.time_off, 7, "stats.time_off: 3 + Burchett's four 2027 weekends (9/22 evening)");
eq(plan.stats.scheduleDays.externalCover, 7); eq(plan.stats.scheduleDays.openBackup, 20); eq(plan.stats.scheduleDays.openPrimary, 2, "open primaries in the import: 10/15 and, since 9/22 evening, 10/24");

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
eq(plan.blob.settings, { importedAt: NOW, seedGeneratedOn: seed._meta.generatedOn, seedRevisions: seed._meta.revisions });
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
eq(plan.blob.surgeonRules[BURCHETT].explicitListMonths, ["2026-10", "2026-12"]);
eq(plan.blob.surgeonRules[ACTON].explicitListMonths, ["2026-10"]);
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
eq(Object.keys(SA.seedToSchedule(seed)).length, 53);
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
ok(/coalesce\(call_schedule_data\.data, '\{\}'::jsonb\) \|\| /.test(sql), "blob merges into the existing data");
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
eq(applyToModel(model, plan), { sd: 53, av: plan.availabilityRows.length, to: 7 }, "first apply writes everything");
eq(applyToModel(model, plan), { sd: 0, av: 0, to: 0 }, "second apply writes nothing");
ok(model.schedule_days.every((d) => d.version === 1), "versions untouched by the no-op re-run");

/* ------------------------------------------------------------ planDiff */
step("planDiff");
const d0 = IMP.planDiff(plan, { blob: {}, availability: [], time_off: [], schedule_days: [] });
eq(d0.tables.schedule_days.insert, 53); eq(d0.tables.availability.insert, plan.availabilityRows.length); eq(d0.tables.time_off.insert, 7);
eq(d0.tables.call_schedule_data.insert, 5); eq(d0.blocked, []); eq(d0.changes, []);
eq(d0.totalChanges, 5 + 53 + plan.availabilityRows.length + 7);
const liveEq = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
liveEq.blob.settings.importedAt = "2020-01-01T00:00:00Z"; // a different import time is not a change
liveEq.blob.settings.appAdded = true;                        // keys the app added are ignored
liveEq.blob.extraTopLevel = { keep: 1 };
const d1 = IMP.planDiff(plan, liveEq);
eq(d1.totalChanges, 0, "live == plan -> nothing"); eq(d1.changes, []); eq(d1.blocked, []);
ok(/No changes/.test(d1.text));
eq(d1.tables.schedule_days.unchanged, 53); eq(d1.tables.availability.unchanged, plan.availabilityRows.length); eq(d1.tables.time_off.unchanged, 7);
// the expected live diff for the orchestrator (item S): live = tonight's rows before S -> 1 schedule_days update (10/24), 4 time_off inserts, blob update, availability unchanged
const livePreS = clone(liveEq);
Object.assign(livePreS.schedule_days.find((d) => d.day === "2026-10-24"), { primary_id: "s6", primary_locked: true, note: "seed: burchett-email-2026-09-17" });
livePreS.time_off = livePreS.time_off.filter((t) => t.person_id !== BURCHETT);
livePreS.blob.surgeonRules = clone(plan.blob.surgeonRules); livePreS.blob.surgeonRules.s6.availableWindows[0].end = "2026-10-24";
const dS = IMP.planDiff(plan, livePreS);
eq([dS.tables.schedule_days.update, dS.tables.time_off.insert, dS.tables.availability.insert + dS.tables.availability.update + dS.tables.availability.delete, dS.tables.call_schedule_data.update, dS.tables.time_off.delete], [1, 4, 0, 1, 0], "expected live diff: 1 day update, 4 vacation inserts, blob update, availability untouched, no deletes");
eq(dS.changes, ["10/24 P Sarkar -> OPEN"], "the one day change is 10/24 primary Sarkar -> OPEN");
eq(dS.tables.time_off.rows, ["insert Burchett 2027-01-09..2027-01-10", "insert Burchett 2027-01-16..2027-01-17", "insert Burchett 2027-02-12..2027-02-14", "insert Burchett 2027-04-09..2027-04-11"]);
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
eq(dC.tables.call_schedule_data.update, 1, "surgeonRules blob updates too");
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
eq(dG.totalChanges, 1, "only the blob update counts");
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

/* ------------------------------------------ rule-note scrub (Prompt 12 F) */
step("rule notes scrubbed before the blob (Prompt 12 F): categories, drops, denylist, refusals, idempotency");
const CATS = ["outreach", "family", "personal", "OR day", "preference"];
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
eq(seed.surgeonRules[ACTON].recurringAvoid[1].note, "[removed]", "seed still says '[removed]'");
eq(plan.blob.surgeonRules[ACTON].holidayRules.neverThanksgivingNote, "family", "'[removed]' -> family");
eq(plan.blob.surgeonRules[ACTON].recurringAvoid[1].note, "family", "'[removed]' -> family");
ok(JSON.stringify(plan.blob).indexOf("[removed]") < 0 && JSON.stringify(plan.blob).indexOf("[removed]") < 0, "neither phrase anywhere in the blob");
ok(sql.indexOf("[removed]") < 0 && sql.indexOf("[removed]") < 0, "neither phrase in the generated SQL");
// (2) every note-like string left in the blob's surgeonRules is exactly a category token
const blobNotes = noteValues(plan.blob.surgeonRules, "surgeonRules", []);
ok(blobNotes.length >= 8, "some person-situation notes survive as categories (" + blobNotes.length + ")");
ok(blobNotes.every((x) => CATS.indexOf(x.value) >= 0), "every surviving note is a category token: " + blobNotes.filter((x) => CATS.indexOf(x.value) < 0).map((x) => x.path).join(", "));
// classification spot checks against the real seed
eq(plan.blob.surgeonRules[KHAN].hardNeverWeekdaysReason, "OR day", "'Tue/Thu are his OR days' -> OR day");
eq(plan.blob.surgeonRules[BURCHETT].recurringAvailable[0].note, "outreach", "'unless in Jackson County' -> outreach");
// a seed note located by its wording -> its inventory entry (robust to notes being added/reordered by other seed edits)
function invForNote(id, re) {
  const notes = seed.surgeonRules[id].notes || [];
  const i = notes.findIndex((t) => re.test(t));
  ok(i >= 0, "seed " + id + " has a note matching " + re);
  const e = plan.noteScrub.inventory.find((x) => x.path === "surgeonRules." + id + ".notes[" + i + "]");
  ok(e, "inventory has an entry for surgeonRules." + id + ".notes[" + i + "]");
  return e || {};
}
eq([invForNote(BURCHETT, /Jackson County/).action, invForNote(BURCHETT, /Jackson County/).to], ["category", "outreach"], "Burchett 'DeWitt/Jackson County' -> outreach");
eq(invForNote(BURCHETT, /per month/).action, "drop", "Burchett cap restatement (primary+backup per month) dropped as documentation");
ok(plan.blob.surgeonRules[BURCHETT].notes.indexOf("outreach") >= 0 && plan.blob.surgeonRules[BURCHETT].notes.every((t) => CATS.indexOf(t) >= 0), "Burchett blob notes are tokens incl. outreach");
eq(plan.blob.surgeonRules[ACTON].recurringUnavailable.map((r) => r.note), ["outreach", "outreach"], "'outreach (Maquoketa)' -> outreach");
eq(plan.blob.surgeonRules[ACTON].recurringAvoid[0].note, "outreach", "Maquoketa carryover -> outreach");
eq(plan.blob.surgeonRules[PHILIP].aledo.note, "outreach", "Aledo day-before note -> outreach");
eq([invForNote(PHILIP, /Aledo/).action, invForNote(PHILIP, /Aledo/).to], ["category", "outreach"], "Philip 'Aledo weeks' -> outreach");
eq([invForNote(PHILIP, /no more full weeks/).action, invForNote(PHILIP, /no more full weeks/).to], ["category", "preference"], "Philip 'no more full weeks' -> preference");
eq(plan.blob.surgeonRules[FIERCE].outsideDerivedWeeks.weekdayPattern.Wed.note, "preference", "'good day to be on call' -> preference");
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
eq(plan.blob.surgeonRules[ACTON].recurringAvoid[1].weekday, seed.surgeonRules[ACTON].recurringAvoid[1].weekday, "the rule beside the note is unchanged");
eq(stripNoteKeys(Object.assign({}, plan.blob.surgeonRules[KHAN], { timeOff: null })), stripNoteKeys(Object.assign({}, seed.surgeonRules[KHAN], { timeOff: null })), "Khan rules minus notes == seed minus notes");
// (4) denylist never fires on the real seed after scrubbing (the plan at the top was built) and nothing personal remains
const blobStrings = walkStrings(plan.blob, "blob", []);
eq(blobStrings.filter((x) => DENY.test(x.value) && CATS.indexOf(x.value) < 0).map((x) => x.path), [], "no denylist word in any blob string");
// (5) inventory lists both live offenders with action 'category', every groupRules entry as 'drop', sorted by path
const inv = plan.noteScrub.inventory;
ok(Array.isArray(inv) && inv.length > 20, "inventory present (" + (inv && inv.length) + " entries)");
ok(inv.some((e) => e.path === "surgeonRules.s3.holidayRules.neverThanksgivingNote" && e.action === "category" && e.to === "family"), "inventory: neverThanksgivingNote -> category family");
ok(inv.some((e) => e.path === "surgeonRules.s3.recurringAvoid[1].note" && e.action === "category" && e.to === "family"), "inventory: recurringAvoid[1].note -> category family");
ok(inv.filter((e) => e.path.indexOf("groupRules.") === 0).every((e) => e.action === "drop"), "every groupRules entry is a drop");
ok(inv.filter((e) => e.path.indexOf("holidays.") === 0).every((e) => e.action === "drop"), "every holidays entry is a drop");
eq(inv.filter((e) => e.path.indexOf("holidays.") === 0).length, IMP.impFindKeys(seed.holidays, NOTE_KEY).length, "one drop per holidays note-like key");
eq(inv.filter((e) => e.path.indexOf("groupRules.") === 0).length, IMP.impFindKeys(seed.groupRules, NOTE_KEY).length, "one drop per groupRules note-like key");
ok(inv.every((e) => (e.action === "category" && CATS.indexOf(e.to) >= 0) || (e.action === "drop" && e.to === null) || (e.action === "public" && e.to === "time_off") || (e.action === "private-name" && e.to === null)), "inventory actions are category/drop, plus 'public' / 'private-name' for time_off notes (item S)");
ok(!inv.some((e) => e.action === "private-name"), "the real seed has no public note naming a surgeon");
eq(inv.map((e) => e.path), inv.map((e) => e.path).slice().sort(), "inventory sorted by path");
eq(plan.noteScrub.counts, { category: inv.filter((e) => e.action === "category").length, drop: inv.filter((e) => e.action === "drop").length, timeOffPublic: inv.filter((e) => e.action === "public").length }, "counts agree with the inventory");
// (6) refusals: unclassifiable surgeon note -> NOTE_UNCLASSIFIED; denylist word in a non-note string -> NOTE_DENYLIST
function refusesWith(prefix, mutate, label) {
  const fx = clone(seed);
  mutate(fx);
  let msg = null;
  try { IMP.importPlan(fx, { now: NOW }); } catch (e) { msg = e.message; }
  ok(msg && msg.indexOf(prefix) === 0, label + " -> " + prefix + " (" + (msg || "no error").slice(0, 90) + ")");
  return msg;
}
const s3NoteIdx = seed.surgeonRules[ACTON].notes.length;   // the pushed note's index, whatever the seed holds today
const mU = refusesWith("NOTE_UNCLASSIFIED: surgeonRules.s3.notes[" + s3NoteIdx + "]", (fx) => { fx.surgeonRules.s3.notes.push("dinner reservation downtown"); }, "unclassifiable note");
ok(mU.indexOf("dinner reservation") < 0, "the refusal names the path, never the note text");
refusesWith("NOTE_UNCLASSIFIED: surgeonRules.s1.weekdays.whyNote", (fx) => { fx.surgeonRules.s1.weekdays.whyNote = "meets the accountant"; }, "unclassifiable *Note key");
// 'wife's birthday dinner' classifies under the binding table (wife -> family, before birthday -> personal): mapped, not refused
const fxW = clone(seed); fxW.surgeonRules.s4.notes.push("wife's birthday dinner");
eq(IMP.importPlan(fxW, { now: NOW }).blob.surgeonRules[PHILIP].notes, (plan.blob.surgeonRules[PHILIP].notes || []).concat(["family"]), "'wife's birthday dinner' -> family appended (never written verbatim)");
// relatives / hosting beyond the binding list classify as family on a note key (mapped, not refused)
const fxR = clone(seed); fxR.surgeonRules.s4.notes.push("daughter's recital", "hosting Thanksgiving with parents", "in-laws visiting");
eq(IMP.importPlan(fxR, { now: NOW }).blob.surgeonRules[PHILIP].notes, (plan.blob.surgeonRules[PHILIP].notes || []).concat(["family", "family", "family"]), "daughter / hosting+parents / in-laws -> family");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"Family\")", (fx) => { fx.surgeonRules.s2.label = "Family reunion"; }, "non-note string 'Family reunion'");
refusesWith("NOTE_DENYLIST: groupRules.dailyHandoff (\"school\")", (fx) => { fx.groupRules.dailyHandoff = "before the school run"; }, "groupRules non-note string");
refusesWith("NOTE_DENYLIST: surgeonRules.s6.availableWindows[0].label (\"kids\")", (fx) => { fx.surgeonRules.s6.availableWindows[0].label = "kids off"; }, "denylist inside an array element");
// hardening beyond the binding list (review F): plural / relatives / hosting in a NON-note key refuse too
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"Families\")", (fx) => { fx.surgeonRules.s2.label = "Families first"; }, "'Families' (plural)");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"hosting\")", (fx) => { fx.surgeonRules.s2.label = "hosting a dinner"; }, "'hosting'");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"daughter\")", (fx) => { fx.surgeonRules.s2.label = "daughter's recital"; }, "'daughter'");
refusesWith("NOTE_DENYLIST: surgeonRules.s2.label (\"in-laws\")", (fx) => { fx.surgeonRules.s2.label = "in-laws visiting"; }, "'in-laws'");
refusesWith("NOTE_DENYLIST: holidays.rules.extra (\"family\")", (fx) => { fx.holidays.rules.dayMembershipNote = "family day"; fx.holidays.rules.extra = "family day"; }, "denylist covers holidays too (the note key is dropped first; the non-note key trips)");
// 'familiar' is not 'family'; an exact category token passes even where it is not a note
const fxF = clone(seed); fxF.surgeonRules.s2.label = "familiar territory"; fxF.surgeonRules.s5.label = "family";
eq(IMP.importPlan(fxF, { now: NOW }).blob.surgeonRules[BURCHETT].label, "familiar territory", "'familiar' passes the denylist");
// the CLI classifies both refusals as refusals (exit 2), not crashes
ok(/^NOTE_(UNCLASSIFIED|DENYLIST):/.test(mU), "refusal prefix shape");
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
eq(direct.surgeonRules[ACTON].holidayRules.neverThanksgivingNote, "family");
eq(IMP.impFindKeys(direct.groupRules, NOTE_KEY), []);
eq(noteValues(direct.surgeonRules, "surgeonRules", []).filter((x) => CATS.indexOf(x.value) < 0), [], "direct call leaves only category tokens");
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

console.log("ok " + n + " assertions");
