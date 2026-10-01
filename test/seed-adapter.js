// Silvis - seed adapter: turns docs/silvis-seed.json into the inputs rules.js
// expects, the same way the importer writes rows. Since Prompt 5 the logic
// lives in ../importer.js (impSeed* helpers); this file is a thin delegate that
// keeps the function names test/rules.test.js and the regression test use.
// Pure, no I/O. Never emits contact data (the importer refuses a seed that
// carries any and copies only ids, dates, kinds, roles).

var IMP = require("../importer.js");

// One availability row per listed date (the importer collapses consecutive
// dates into ranges for the table; buildContext expands both to the same days).
function seedToAvailabilityRows(seed) { return IMP.impSeedAvailabilityRows(seed, { collapse: false }); }

// surgeonRules with explicitListMonths derived from the explicitAvailable keys.
function seedToSurgeonRules(seed) { return IMP.impSeedSurgeonRules(seed); }

// surgeonRules[].timeOff -> time_off rows (vacations only, scrubbed notes).
function seedToTimeOffRows(seed) { return IMP.impSeedTimeOffRows(seed); }

// existingAssignments -> in-memory schedule with lock flags (null slot never locked).
function seedToSchedule(seed) { return IMP.impSeedSchedule(seed); }

// Full buildContext() input from the seed plus caller extras (East feed, etc.).
// Prompt 23 B4 (9/30): the rules' today (ctx.today - the hardNeverWeekdays notice is measured from it) is FIXED for
// every test that builds from the seed, never the clock - a test must not change its answer with the date:
// SEED_TEST_TODAY = 2026-11-23, the day the Jan - Jun 2027 period freezes and is generated. The published Nov - Dec
// then reads Khan's Tue/Thu inside the notice (hard, as published) and the notice edge (56 days -> 2027-01-18) falls
// inside the regression's Jan - Mar range. A caller's own extras.today wins.
var SEED_TEST_TODAY = "2026-11-23";
function seedToContextInput(seed, extras) {
  var out = IMP.impSeedContextInput(seed, extras);
  out.today = extras && typeof extras.today === "string" ? extras.today : SEED_TEST_TODAY;
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { seedToAvailabilityRows, seedToTimeOffRows, seedToSchedule, seedToSurgeonRules, seedToContextInput, SEED_TEST_TODAY };
}
