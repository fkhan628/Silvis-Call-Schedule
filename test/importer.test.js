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
eq(plan.stats.schedule_days, 53); eq(plan.stats.time_off, 3);
eq(plan.stats.scheduleDays.externalCover, 7); eq(plan.stats.scheduleDays.openBackup, 20); eq(plan.stats.scheduleDays.openPrimary, 1);

/* ------------------------------------------------------------ time_off */
step("time_off rows");
const to = plan.timeOffRows;
eq(to.length, 3, "2 Acton + 1 Philip");
eq(to.filter((t) => t.person_id === ACTON).map((t) => t.start_date + ".." + t.end_date), ["2026-11-19..2026-11-22", "2026-11-25..2026-11-29"]);
eq(to.filter((t) => t.person_id === PHILIP).map((t) => t.start_date + ".." + t.end_date), ["2026-10-15..2026-10-15"]);
ok(to.every((t) => t.note === "vacation (seed)" && t.created_by === "seed"), "notes scrubbed to 'vacation (seed)'");
const seedVacNotes = [].concat(...Object.values(seed.surgeonRules).map((r) => (r.timeOff || []).map((t) => t.note))).filter(Boolean);
ok(seedVacNotes.length === 3, "seed carries 3 personal vacation notes to scrub");
const sql = IMP.importSql(plan);
seedVacNotes.forEach((note) => ok(sql.indexOf(note) < 0 && JSON.stringify(to).indexOf(note) < 0, "seed wording never written: " + note));

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
eq(plan.blob.groupRules, seed.groupRules); eq(plan.blob.holidays, seed.holidays);
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
// the seed's own explicitListMonths were left as written in the blob too
eq(plan.blob.surgeonRules[BURCHETT].explicitAvailableNote, seed.surgeonRules[BURCHETT].explicitAvailableNote);

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
      weeksFromN: P.weeksFromN, windowDays: setArr(P.windowDays), maxConsec: P.maxConsec, capTotal: P.capTotal, capPreferred: P.capPreferred, hardNever: setArr(P.hardNever),
      holidaysOff: setArr(P.holidaysOff), maxMajor: P.maxMajor, mode: P.mode, active: P.active };
  });
  const sched = {};
  Object.keys(ctx.schedule).sort().forEach((d) => { const s = ctx.schedule[d]; sched[d] = { p: s.primary, b: s.backup, pl: s.primaryLocked, bl: s.backupLocked, x: s.externalCover }; });
  return { per, sched, units: ctx.holidayUnitsAll, active: ctx.activeIds, weights: ctx.weights, defaultCap: ctx.defaultCap };
}
const appCtx = R.buildContext({ roster: plan.blob.roster, surgeonRules: plan.blob.surgeonRules, groupRules: plan.blob.groupRules, holidays: plan.blob.holidays,
  timeOffRows: plan.timeOffRows, availabilityRows: plan.availabilityRows, schedule: rowsToSchedule(plan.scheduleDayRows) });
const testCtx = R.buildContext(SA.seedToContextInput(seed));
eq(IMP.impCanon(project(appCtx)), IMP.impCanon(project(testCtx)), "same per-surgeon precompute, schedule and holiday units");
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
eq(SA.seedToTimeOffRows(seed).length, 3);
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
ok(/^[\x00-\x7f]*$/.test(sql), "SQL is 7-bit ASCII (non-ASCII escaped inside jsonb)");
ok(/^begin;/m.test(sql) && /^commit;/m.test(sql), "one transaction");
const stmts = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
const inserts = stmts.filter((s) => /^insert\s+into/i.test(s));
ok(inserts.length >= 1 + 1 + 1 + 1 + 3, "snapshot + blob + schedule_days + availability + 3 time_off inserts (" + inserts.length + ")");
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
eq((sql.match(/insert into public\.time_off/g) || []).length, 3);
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
eq(applyToModel(model, plan), { sd: 53, av: plan.availabilityRows.length, to: 3 }, "first apply writes everything");
eq(applyToModel(model, plan), { sd: 0, av: 0, to: 0 }, "second apply writes nothing");
ok(model.schedule_days.every((d) => d.version === 1), "versions untouched by the no-op re-run");

/* ------------------------------------------------------------ planDiff */
step("planDiff");
const d0 = IMP.planDiff(plan, { blob: {}, availability: [], time_off: [], schedule_days: [] });
eq(d0.tables.schedule_days.insert, 53); eq(d0.tables.availability.insert, plan.availabilityRows.length); eq(d0.tables.time_off.insert, 3);
eq(d0.tables.call_schedule_data.insert, 5); eq(d0.blocked, []); eq(d0.changes, []);
eq(d0.totalChanges, 5 + 53 + plan.availabilityRows.length + 3);
const liveEq = { blob: clone(plan.blob), availability: clone(plan.availabilityRows), time_off: clone(plan.timeOffRows), schedule_days: clone(plan.scheduleDayRows) };
liveEq.blob.settings.importedAt = "2020-01-01T00:00:00Z"; // a different import time is not a change
liveEq.blob.settings.appAdded = true;                        // keys the app added are ignored
liveEq.blob.extraTopLevel = { keep: 1 };
const d1 = IMP.planDiff(plan, liveEq);
eq(d1.totalChanges, 0, "live == plan -> nothing"); eq(d1.changes, []); eq(d1.blocked, []);
ok(/No changes/.test(d1.text));
eq(d1.tables.schedule_days.unchanged, 53); eq(d1.tables.availability.unchanged, plan.availabilityRows.length); eq(d1.tables.time_off.unchanged, 3);
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
ok(/^11/26 B Burchett -> OPEN [BLOCKED: live source 'import' updated_by 's1'/.test(d2b.blocked[0] || ""), "blocked line names the app owner: " + d2b.blocked[0]);
eq(d2b.totalChanges, 0, "and it is not a change");
ok(/where schedule_days.source = 'import'
  and coalesce(schedule_days.updated_by, 'seed') = 'seed'/.test(IMP.importSql(plan)), "SQL upsert guard requires seed ownership (updated_by)");
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
ok(IMP.impFindEmailValues({ x: "a@b.co" }).length === 1 && IMP.impFindPhoneValues({ x: ["", { y: "555-555-0100" }] }).join() === "x[1].y", "value finders report paths, never values");
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
ok(/delete from public\.time_off\n where created_by = 'seed'\n   and \(person_id, start_date, end_date\) not in \(\('s3', '2026-11-19'::date, '2026-11-22'::date\)/.test(IMP.importSql(eB.plan)), "guarded set-based delete on time_off");
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
eq(dG.tables.time_off.delete, 0); eq(dG.tables.time_off.kept, 3); eq(dG.kept.length, 3, "3 seed vacations listed as kept");
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

console.log("ok " + n + " assertions");
