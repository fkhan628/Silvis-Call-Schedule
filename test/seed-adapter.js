// Silvis - seed adapter: turns docs/silvis-seed.json into the inputs rules.js
// expects, the same way the importer (Prompt 5) will write rows. Pure, no I/O.
// Reused by test/rules.test.js and later by the importer. Never emits contact
// data (the seed has none; the adapter copies only ids, dates, kinds, roles).

function saRow(personId, kind, role, start, end, note) {
  return { person_id: personId, kind: kind, role: role, start_date: start, end_date: end || start, source: "seed", note: note || null };
}

// Dated statements -> availability rows.
//   explicitAvailable        { month: [dates] } -> available/any; { month: {primary:[],backup:[]} } -> role-scoped
//   explicitBackupOnly       -> backup_only/any
//   explicitUnavailable      -> unavailable/any
//   explicitBackupUnavailable-> no_backup/backup
// availableWeeks (Philip) and availableWindows (Sarkar) are NOT turned into rows:
// rules.js reads them straight from surgeonRules, and an 'available' row is an
// explicit dated exception that lifts weekday patterns - emitting one per window
// day would have opened Sarkar's hard-never Friday inside every window.
function seedToAvailabilityRows(seed) {
  var rows = [];
  var sr = (seed && seed.surgeonRules) || {};
  Object.keys(sr).forEach(function (id) {
    var r = sr[id] || {};
    var eachMonthList = function (obj, fn) {
      if (!obj) return;
      Object.keys(obj).forEach(function (month) { fn(month, obj[month]); });
    };
    eachMonthList(r.explicitAvailable, function (month, v) {
      if (Array.isArray(v)) v.forEach(function (d) { rows.push(saRow(id, "available", "any", d, d, "explicit list " + month)); });
      else if (v && typeof v === "object") {
        ["primary", "backup"].forEach(function (role) {
          (v[role] || []).forEach(function (d) { rows.push(saRow(id, "available", role, d, d, "explicit list " + month)); });
        });
      }
    });
    eachMonthList(r.explicitBackupOnly, function (month, v) {
      (v || []).forEach(function (d) { rows.push(saRow(id, "backup_only", "any", d, d, "explicit list " + month)); });
    });
    eachMonthList(r.explicitUnavailable, function (month, v) {
      (v || []).forEach(function (d) { rows.push(saRow(id, "unavailable", "any", d, d, "explicit list " + month)); });
    });
    eachMonthList(r.explicitBackupUnavailable, function (month, v) {
      (v || []).forEach(function (d) { rows.push(saRow(id, "no_backup", "backup", d, d, "explicit list " + month)); });
    });
  });
  return rows;
}

// surgeonRules with explicitListMonths completed from the explicitAvailable keys
// (groupRules.whitelistMonths.rule: a month is governed only when listed there,
// and the importer writes the list from those keys). A plain date list governs
// both roles ('YYYY-MM'); a role-scoped list { primary:[...] } governs only the
// roles it names ({ month, roles }). Months the seed already lists are kept as
// written. Returns shallow copies - the seed object is never mutated.
function seedToSurgeonRules(seed) {
  var sr = (seed && seed.surgeonRules) || {};
  var out = {};
  Object.keys(sr).forEach(function (id) {
    var r = sr[id] || {};
    var list = (r.explicitListMonths || []).slice();
    var have = {};
    list.forEach(function (e) { var m = typeof e === "string" ? e : (e && e.month); if (m) have[m] = true; });
    Object.keys(r.explicitAvailable || {}).forEach(function (month) {
      if (have[month]) return;
      var v = r.explicitAvailable[month];
      if (Array.isArray(v)) list.push(month);
      else if (v && typeof v === "object") {
        var roles = ["primary", "backup"].filter(function (role) { return Array.isArray(v[role]) && v[role].length > 0; });
        if (roles.length === 2) list.push(month);
        else if (roles.length === 1) list.push({ month: month, roles: roles });
      }
    });
    out[id] = list.length ? Object.assign({}, r, { explicitListMonths: list }) : r;
  });
  return out;
}

// surgeonRules[].timeOff -> time_off rows (vacations only).
function seedToTimeOffRows(seed) {
  var rows = [];
  var sr = (seed && seed.surgeonRules) || {};
  Object.keys(sr).forEach(function (id) {
    ((sr[id] && sr[id].timeOff) || []).forEach(function (t) {
      rows.push({ person_id: id, start_date: t.start, end_date: t.end || t.start, note: "vacation (seed)" });
    });
  });
  return rows;
}

// existingAssignments -> in-memory schedule with lock flags per groupRules.locks
// (a null slot is never locked).
function seedToSchedule(seed) {
  var out = {};
  ((seed && seed.existingAssignments) || []).forEach(function (a) {
    var locked = !!a.locked;
    out[a.date] = {
      primary: a.primary || null,
      backup: a.backup || null,
      primaryLocked: locked && (a.primary != null || !!a.externalCover),
      backupLocked: locked && a.backup != null,
      source: "import",
      externalCover: a.externalCover || null,
      note: a.source || null
    };
  });
  return out;
}

// Full buildContext() input from the seed plus caller extras (East feed, etc.).
function seedToContextInput(seed, extras) {
  var base = {
    roster: seed.roster,
    surgeonRules: seedToSurgeonRules(seed),
    groupRules: seed.groupRules,
    holidays: seed.holidays,
    timeOffRows: seedToTimeOffRows(seed),
    availabilityRows: seedToAvailabilityRows(seed),
    schedule: seedToSchedule(seed)
  };
  return Object.assign(base, extras || {});
}

if (typeof module !== "undefined") {
  module.exports = { seedToAvailabilityRows, seedToTimeOffRows, seedToSchedule, seedToSurgeonRules, seedToContextInput };
}
