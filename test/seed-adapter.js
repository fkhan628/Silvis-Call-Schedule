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
function seedToContextInput(seed, extras) { return IMP.impSeedContextInput(seed, extras); }

if (typeof module !== "undefined") {
  module.exports = { seedToAvailabilityRows, seedToTimeOffRows, seedToSchedule, seedToSurgeonRules, seedToContextInput };
}
