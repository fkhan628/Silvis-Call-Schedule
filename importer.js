// Silvis - seed importer (Prompt 5). Turns docs/silvis-seed.json into the rows
// the app reads (call_schedule_data blob, availability, time_off, schedule_days)
// and into idempotent SQL for the linked Supabase CLI. PURE: no fetch, no DOM,
// no I/O - the CLI (scripts/import-seed.js) and the Setup UI do the talking.
// Classic browser script + Node guard; every top-level name is prefixed imp*.
//
// The same functions feed test/seed-adapter.js (which now delegates here), so
// the ctx rules.js builds from the imported rows is the ctx the tests build
// from the seed: same kinds, roles, dates, explicitListMonths and lock flags.
//
// Contact-data policy (guide 3.1): the blob, availability, time_off and
// schedule_days are anon-readable. importPlan REFUSES a seed whose roster or
// site block carries an email/phone key at any depth, or an email/phone-looking
// value there (Error message starts with CONTACT_DATA_REFUSED) and never copies
// such keys; the roster is mapped to { id, name, code, fullName, active, roles }
// only and the site block is not written at all. After the plan is built the
// OUTPUT is scanned too: an email- or phone-looking value anywhere in the blob
// (surgeonRules notes...), in any note the tables would receive, or in the
// info lines the CLI prints, refuses the whole plan. Notes written to the
// tables are operational wording.
//
// Rule-note scrub (Prompt 12 F, then AA on 9/22 late; guide 3.1): the seed's
// notes never reach the blob - in any form. impScrubRuleNotes() DROPS every
// note-like key (note, notes[], *Note, *Notes, *Reason, at any depth, arrays
// included) from surgeonRules, groupRules and holidays before the blob is
// assembled. Nothing is classified and no category token is written (Faraz
// 9/22 late: "one standard for the blob: no reasons, only the rule" - reasons
// live in docs/SILVIS-CALL-RULES.md; the seed keeps its wording; the app never
// parses notes). After the scrub a denylist gate over EVERY string in the
// assembled blob (non-note keys included, no exemptions) refuses any personal
// word (NOTE_DENYLIST: <path> ("<word>")). The order matters and is pinned:
// a note-like key can never trip the gate because it is gone before the gate
// runs; a reason written under a NON-note key is caught only when it uses a
// listed word (the denylist is a word list, not a classifier). The plan carries
// the inventory (plan.noteScrub: one 'drop' entry per note-like key, sorted by
// path) for the CLI's dry run; messages name paths, never the note text.
//
// Public time_off notes (Prompt 12 S, 9/22 evening): a time_off row's note is
// 'vacation (seed)' by default - the seed's vacation wording is private and never
// written. A seed entry may opt a note in with public: true (boolean); it is then
// written as is ONLY when it passes the item-F denylist AND names no roster last
// name. A public note that trips the denylist REFUSES the import
// (NOTE_DENYLIST: surgeonRules.<id>.timeOff[i].note ("<word>")), never silently
// defaulted, because the author asked for it to be public; a public note that
// names a roster surgeon (last names read from seed.roster, never a list in
// code) falls back to the private default and the dry run lists the path as
// '<path> -> private-name'. public: true without a note, public: false or a
// non-boolean public read as private. created_by stays 'seed'; the entry's
// source (provenance) stays in the seed; the blob's copy of timeOff stays
// { start, end }. Kept public notes appear in the dry-run inventory as
// '<path> -> public' and in plan.noteScrub.counts.timeOffPublic.
//
// Ownership + stale rows: the seed OWNS availability rows with source 'seed',
// time_off rows with created_by 'seed' and schedule_days rows still
// source 'import' / updated_by 'seed'. A live row of those kinds that is no
// longer in the plan (statement removed, range edited, vacation moved) is
// deleted by the generated SQL and reported by planDiff as 'delete', so a
// re-run of an edited seed converges instead of leaving the old row governing
// eligibility. Rows the app owns (any other source / created_by / updated_by)
// are never touched. Safety valve: when the plan has NO rows for a table the
// deletes for that table are not emitted (an empty seed can not wipe it).
//
// Mapping (seed key -> table / kind / role):
//   roster[]                              -> blob.roster (pool rows: 6 keys only; a type "external" row
//                                            (Prompt 12 M) also carries type + its operational note, gated
//                                            by the denylist / contact gates). The seed owns the POOL rows
//                                            only: live type "external" rows the seed lacks (added in Setup,
//                                            ids x1, x2, ...) are carried over by planDiff, the app's apply
//                                            and the SQL (impMergeRoster), never dropped by a re-import.
//   surgeonRules                          -> blob.surgeonRules (+ explicitListMonths derived; notes scrubbed;
//                                            timeOff as { start, end } only)
//   groupRules, holidays                  -> blob.groupRules, blob.holidays (note-like keys dropped from both)
//   _meta.generatedOn / _meta.revisions   -> blob.settings.seedGeneratedOn / seedRevisions
//   surgeonRules[id].explicitAvailable    -> availability available/any (plain list)
//                                            or available/primary + available/backup (role-scoped)
//   surgeonRules[id].explicitBackupOnly   -> availability backup_only/any
//   surgeonRules[id].explicitUnavailable  -> availability unavailable/any
//   surgeonRules[id].explicitBackupUnavailable -> availability no_backup/backup
//   surgeonRules[id].availableWeeks / availableWindows -> NO rows (rules.js reads them
//                                            from the blob; a dated available row lifts weekday
//                                            patterns and would open Sarkar's hard-never Friday)
//   surgeonRules[id].timeOff              -> time_off (note 'vacation (seed)'; the seed wording only with
//                                            public: true and past the denylist / roster-name gate; source
//                                            stays in the seed)
//   existingAssignments[]                 -> schedule_days (source 'import', provenance in note,
//                                            null slot never locked)
//   pendingDeltas[]                       -> informational only (already applied in existingAssignments)
//   site, _meta.sources/assumptions, answeredQuestions, openQuestions, a pool row's roster[].note -> not imported

var IMP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var IMP_DAY_MS = 86400000;
var IMP_CONTACT_KEY = /e-?_?mail|phone|mobile|cell/i;   // key names refused under roster[] / site
var IMP_BLOB_KEY = /e-?_?mail|phone|contact/i;          // key names that must never appear in the blob
var IMP_EMAIL_VALUE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// North-American phone shapes: 555-555-0100, 555.555.0100, (555) 555-0100, 555 555 0100, +1 555 555 0100, 5555550100
var IMP_PHONE_VALUE = /(?:\+?1[-. ]?)?\(?\b\d{3}\)?[-. ]\s?\d{3}[-. ]\d{4}\b|\b\d{10}\b/;
var IMP_KIND_ORDER = ["available", "backup_only", "unavailable", "no_backup", "avoid", "prefer"];

/* ------------------------------------------------------------------ dates */

function impPad2(n) { return n < 10 ? "0" + n : "" + n; }

function impDayNum(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("importer: bad date string " + JSON.stringify(s));
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / IMP_DAY_MS);
}

function impFromDayNum(n) {
  var dt = new Date(n * IMP_DAY_MS);
  return dt.getUTCFullYear() + "-" + impPad2(dt.getUTCMonth() + 1) + "-" + impPad2(dt.getUTCDate());
}

function impAddDays(s, k) { return impFromDayNum(impDayNum(s) + k); }

function impMonthLabel(month) {
  var m = +String(month).slice(5, 7);
  return IMP_MONTHS[m - 1] || String(month);
}

function impShortDay(s) { return (+s.slice(5, 7)) + "/" + (+s.slice(8, 10)); }

/* ---------------------------------------------------------- deep helpers */

function impClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// Canonical JSON (sorted keys) so two shapes compare byte-for-byte.
function impCanon(v) {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(impCanon).join(",") + "]";
  return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + impCanon(v[k]); }).join(",") + "}";
}

function impSame(a, b) { return impCanon(a) === impCanon(b); }

// Every key path under `obj` whose key name matches `re` (any depth).
function impFindKeys(obj, re, path, out) {
  out = out || [];
  path = path || "";
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach(function (v, i) { impFindKeys(v, re, path + "[" + i + "]", out); });
    return out;
  }
  Object.keys(obj).forEach(function (k) {
    var p = path ? path + "." + k : k;
    if (re.test(k)) out.push(p);
    impFindKeys(obj[k], re, p, out);
  });
  return out;
}

// Every string value under `obj` (any depth) matching `re`; paths only, never the value.
function impFindValues(obj, re, path, out) {
  out = out || [];
  path = path || "";
  if (obj == null) return out;
  if (typeof obj === "string") { if (re.test(obj)) out.push(path); return out; }
  if (typeof obj !== "object") return out;
  if (Array.isArray(obj)) { obj.forEach(function (v, i) { impFindValues(v, re, path + "[" + i + "]", out); }); return out; }
  Object.keys(obj).forEach(function (k) { impFindValues(obj[k], re, path ? path + "." + k : k, out); });
  return out;
}

// Every string value under `obj` that looks like an email address / a phone number.
function impFindEmailValues(obj, path, out) { return impFindValues(obj, IMP_EMAIL_VALUE, path, out); }
function impFindPhoneValues(obj, path, out) { return impFindValues(obj, IMP_PHONE_VALUE, path, out); }
function impFindContactValues(obj, path, out) {
  out = out || [];
  impFindEmailValues(obj, path, out);
  impFindPhoneValues(obj, path, out);
  return out;
}

// Throws CONTACT_DATA_REFUSED when roster[] or site carries contact data
// (a key named like contact data at any depth, or an email/phone-looking value),
// or when an email/phone-looking value sits anywhere in surgeonRules, groupRules
// or holidays. The rule blocks are scanned INPUT-side because the note scrub
// (12 F) runs before the output guard and would otherwise drop such a note
// silently - a contact value in the public seed must always refuse loudly.
function impRefuseContactData(seed) {
  var hits = [];
  impFindKeys((seed && seed.roster) || [], IMP_CONTACT_KEY, "roster", hits);
  impFindKeys((seed && seed.site) || {}, IMP_CONTACT_KEY, "site", hits);
  impFindContactValues((seed && seed.roster) || [], "roster", hits);
  impFindContactValues((seed && seed.site) || {}, "site", hits);
  impFindContactValues((seed && seed.surgeonRules) || {}, "surgeonRules", hits);
  impFindContactValues((seed && seed.groupRules) || {}, "groupRules", hits);
  impFindContactValues((seed && seed.holidays) || {}, "holidays", hits);
  if (hits.length) {
    throw new Error("CONTACT_DATA_REFUSED: the seed carries contact data at " + hits.join(", ") +
      " - contact data never enters the repo or an anon-readable table (guide 3.1); remove it and re-run");
  }
}

// Output-side guard: nothing the plan would write (blob, table notes) or print
// (info lines) may carry an email- or phone-looking value. Reports paths only.
function impRefuseContactOutput(plan) {
  var hits = [];
  impFindContactValues(plan.blob, "blob", hits);
  plan.scheduleDayRows.forEach(function (r) { impFindContactValues(r.note, "schedule_days[" + r.day + "].note", hits); });
  plan.availabilityRows.forEach(function (r, i) { impFindContactValues(r.note, "availability[" + i + "].note", hits); });
  plan.timeOffRows.forEach(function (r, i) { impFindContactValues(r.note, "time_off[" + i + "].note", hits); });
  impFindContactValues(plan.infoDeltas, "pendingDeltas", hits);
  if (hits.length) {
    throw new Error("CONTACT_DATA_REFUSED: the import would write or print contact-looking values at " + hits.join(", ") +
      " - notes and rule text in anon-readable tables are public (guide 3.1); reword them and re-run");
  }
}

/* ---------------------------------------- rule-note scrub (12 F, 12 AA) */

// Note-like keys: exactly note / notes, or any key ending in Note / Notes /
// Reason (case-sensitive suffix), at any depth, inside arrays too. Every one
// of them is DROPPED from the blob (12 AA: no category tokens, no
// classification - a reason belongs in docs/SILVIS-CALL-RULES.md, never in
// an anon-readable row). There is deliberately no token list and no keyword
// table here any more: dead tables invite reuse.
var IMP_NOTE_KEY = /^(note|notes)$|Note$|Notes$|Reason$/;
// Words that may never appear in any blob string after the scrub (word-boundary,
// case-insensitive; "familiar" does not match, "Family" does). The Prompt 12 F
// list plus plurals / relatives / hosting (review F hardening). A word list,
// not a classifier: it is the only check a non-note prose key gets. Also the
// gate for a public: true time_off note (impTimeOffNote) and, in the app, for
// a Setup roster note (SU_NOTE_DENYLIST mirrors it).
var IMP_NOTE_DENYLIST = /\b(family|families|wife|husband|kid|kids|child|children|daughter|son|parents|in-laws|school|medical|maternity|hosts|hosting|illness|funeral)\b/i;

// One note-like key: dropped whatever its value (string, notes[] array, object,
// number). The inventory gets ONE entry per key; `from` carries a string value
// so an in-process caller can audit a dry run (the CLI prints paths only).
function impScrubNoteDrop(val, path, inv) {
  inv.push({ path: path, action: "drop", from: typeof val === "string" ? val : null, to: null });
}

// Rebuilds `v` without any note-like key; never mutates its input.
function impScrubWalk(v, path, inv) {
  if (Array.isArray(v)) return v.map(function (x, i) { return impScrubWalk(x, path + "[" + i + "]", inv); });
  if (!v || typeof v !== "object") return v;
  var out = {};
  Object.keys(v).forEach(function (k) {
    var p = path ? path + "." + k : k;
    if (IMP_NOTE_KEY.test(k)) { impScrubNoteDrop(v[k], p, inv); return; }
    out[k] = impScrubWalk(v[k], p, inv);
  });
  return out;
}

// impScrubRuleNotes(surgeonRules, groupRules[, holidays]) -> { surgeonRules, groupRules, holidays, inventory }
// inventory: [{ path, action: 'drop', from, to: null }], one per note-like key,
// sorted by path. The same rule for all three blocks (12 AA; before it
// surgeonRules notes were classified into category tokens). Never throws:
// there is nothing to classify, so nothing to refuse here - the denylist gate
// over the assembled blob (impRefuseNoteDenylist) is the refusal.
function impScrubRuleNotes(surgeonRules, groupRules, holidays) {
  var inv = [];
  var sr = impScrubWalk(impClone(surgeonRules || {}), "surgeonRules", inv);
  var gr = impScrubWalk(impClone(groupRules || {}), "groupRules", inv);
  var hol = impScrubWalk(impClone(holidays || {}), "holidays", inv);
  inv.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
  return { surgeonRules: sr, groupRules: gr, holidays: hol, inventory: inv };
}

// Denylist gate over EVERY string value in the blob (not only note keys), after
// the scrub. No string is exempt (12 AA: the former category-token exemption is
// gone with the tokens). Reports paths and the matched word, never the string.
function impRefuseNoteDenylist(blob) {
  var hits = [];
  (function walk(o, p) {
    if (typeof o === "string") {
      var m = o.match(IMP_NOTE_DENYLIST);
      if (m) hits.push(p + " (\"" + m[1] + "\")");
      return;
    }
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(function (v, i) { walk(v, p + "[" + i + "]"); }); return; }
    Object.keys(o).forEach(function (k) { walk(o[k], p ? p + "." + k : k); });
  })(blob, "");
  if (hits.length) {
    throw new Error("NOTE_DENYLIST: " + hits.join(", ") + " - a personal word would reach the anon-readable blob (guide 3.1); reword the seed and re-run");
  }
}

/* --------------------------------------------------------- seed -> shapes */

function impRosterName(seed, id) {
  var r = ((seed && seed.roster) || []).filter(function (x) { return x && x.id === id; })[0];
  return (r && (r.name || r.code)) || id;
}

// Roster for the blob: names and codes only (no email, no note, nothing else).
// Prompt 12 M (9/22): a roster entry of type "external" (an outside surgeon /
// internal locum, ids x1, x2, ...) keeps its type and its operational note - the
// note is the one roster string that reaches the anon-readable blob, so the
// blob-wide denylist gate (impRefuseNoteDenylist) and the contact-data gates
// judge it like every other string. A pool row's note is seed documentation and
// stays out, as before; any other type value is dropped (absent = pool surgeon).
// The real seed adds no outside surgeon (they are added in Setup); this path
// keeps them when a saved blob is exported and imported again.
function impSeedRoster(seed) {
  return ((seed && seed.roster) || []).map(function (r) {
    var out = {
      id: r.id,
      name: r.name,
      code: r.code,
      fullName: r.fullName,
      active: r.active !== false,
      roles: Array.isArray(r.roles) ? r.roles.slice() : ["surgeon"]
    };
    if (r.type === "external") {
      out.type = "external";
      var note = typeof r.note === "string" ? r.note.trim() : "";
      if (note) out.note = note;
    }
    return out;
  });
}

// Collapse consecutive dates of the same person/kind/role into ranges.
function impCollapseRanges(rows) {
  var groups = Object.create(null), order = [];
  rows.forEach(function (r) {
    var key = [r.person_id, r.kind, r.role, r.source || "", r.note || ""].join("|");
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  });
  var out = [];
  order.forEach(function (key) {
    var list = groups[key].slice().sort(function (a, b) { return a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0; });
    var cur = null;
    list.forEach(function (r) {
      if (cur && impDayNum(r.start_date) === impDayNum(cur.end_date) + 1) { cur.end_date = r.end_date; return; }
      if (cur && impDayNum(r.start_date) <= impDayNum(cur.end_date)) { if (r.end_date > cur.end_date) cur.end_date = r.end_date; return; }
      cur = Object.assign({}, r);
      out.push(cur);
    });
  });
  return out;
}

function impAvailRow(personId, kind, role, start, end, note) {
  return { person_id: personId, kind: kind, role: role, start_date: start, end_date: end || start, note: note || null, source: "seed" };
}

// Dated statements -> availability rows. opts.collapse (default true) merges
// consecutive dates into ranges; the seed adapter asks for one row per date.
//   explicitAvailable         { month: [dates] } -> available/any; { month: {primary:[],backup:[]} } -> role-scoped
//   explicitBackupOnly        -> backup_only/any
//   explicitUnavailable       -> unavailable/any
//   explicitBackupUnavailable -> no_backup/backup
// availableWeeks (Philip) and availableWindows (Sarkar) are NOT rows (see header).
function impSeedAvailabilityRows(seed, opts) {
  opts = opts || {};
  var rows = [];
  var sr = (seed && seed.surgeonRules) || {};
  Object.keys(sr).forEach(function (id) {
    var r = sr[id] || {};
    var who = impRosterName(seed, id);
    var noteFor = function (month) { return "seed: " + who + " " + impMonthLabel(month) + " list"; };
    var eachMonthList = function (obj, fn) {
      if (!obj || typeof obj !== "object") return;
      Object.keys(obj).sort().forEach(function (month) { fn(month, obj[month]); });
    };
    eachMonthList(r.explicitAvailable, function (month, v) {
      if (Array.isArray(v)) v.forEach(function (d) { rows.push(impAvailRow(id, "available", "any", d, d, noteFor(month))); });
      else if (v && typeof v === "object") {
        ["primary", "backup"].forEach(function (role) {
          (v[role] || []).forEach(function (d) { rows.push(impAvailRow(id, "available", role, d, d, noteFor(month))); });
        });
      }
    });
    eachMonthList(r.explicitBackupOnly, function (month, v) {
      (v || []).forEach(function (d) { rows.push(impAvailRow(id, "backup_only", "any", d, d, noteFor(month))); });
    });
    eachMonthList(r.explicitUnavailable, function (month, v) {
      (v || []).forEach(function (d) { rows.push(impAvailRow(id, "unavailable", "any", d, d, noteFor(month))); });
    });
    eachMonthList(r.explicitBackupUnavailable, function (month, v) {
      (v || []).forEach(function (d) { rows.push(impAvailRow(id, "no_backup", "backup", d, d, noteFor(month))); });
    });
  });
  rows.forEach(function (r) { impDayNum(r.start_date); impDayNum(r.end_date); }); // validate every date
  return opts.collapse === false ? rows : impCollapseRanges(rows);
}

// surgeonRules with explicitListMonths completed from the explicitAvailable
// keys (groupRules.whitelistMonths). rules.js reads the role scope literally
// (Prompt 12 T): a plain 'YYYY-MM' entry governs PRIMARY only while
// backupPolicy.openToEveryone is true (both roles under the closed policy); a
// role-scoped entry ({ month, roles }) governs exactly the roles it names, so
// the seed writes { month, roles: ['primary','backup'] } explicitly to govern
// backup (November 2026). Entries the seed already lists are kept as written.
// Returns copies - the seed object is never mutated.
function impSeedSurgeonRules(seed) {
  var sr = (seed && seed.surgeonRules) || {};
  var out = {};
  Object.keys(sr).forEach(function (id) {
    var r = sr[id] || {};
    var list = (r.explicitListMonths || []).slice();
    var have = {};
    list.forEach(function (e) { var m = typeof e === "string" ? e : (e && e.month); if (m) have[m] = true; });
    Object.keys(r.explicitAvailable || {}).sort().forEach(function (month) {
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

var IMP_TIME_OFF_DEFAULT_NOTE = "vacation (seed)";

// Roster last names as a word-boundary, case-insensitive matcher (null when the
// seed has no names). Built from the seed, never from a list in code.
function impRosterNameRegex(seed) {
  var names = ((seed && seed.roster) || []).map(function (r) { return r && r.name; }).filter(function (s) { return typeof s === "string" && s.length; })
    .map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
  return names.length ? new RegExp("\\b(" + names.join("|") + ")\\b", "i") : null;
}

// The note a time_off row gets (header: public time_off notes). Throws
// NOTE_DENYLIST (path + matched word, never the text) when a public note trips
// the denylist; a public note that names a roster surgeon falls back to the
// private default instead. `inv`, when given, receives one
// { path, action: 'public', from, to: 'time_off' } entry per kept public note
// and one { path, action: 'private-name', to: null } entry (path only, never
// the text) per surname fallback.
function impTimeOffNote(t, path, nameRe, inv) {
  if (!(t && t.public === true && typeof t.note === "string" && t.note.length)) return IMP_TIME_OFF_DEFAULT_NOTE;
  var m = t.note.match(IMP_NOTE_DENYLIST);
  if (m) {
    throw new Error("NOTE_DENYLIST: " + path + " (\"" + m[1] + "\") - a public: true vacation note would carry a personal word into the anon-readable time_off table (guide 3.1); reword it or drop public and re-run");
  }
  if (nameRe && nameRe.test(t.note)) {
    if (inv) inv.push({ path: path, action: "private-name", to: null });
    return IMP_TIME_OFF_DEFAULT_NOTE;
  }
  if (inv) inv.push({ path: path, action: "public", from: t.note, to: "time_off" });
  return t.note;
}

// surgeonRules[].timeOff -> time_off rows (vacations only; note 'vacation (seed)'
// unless the entry says public: true and the note passes the gate).
// opts.inventory: array that receives the kept public notes (importPlan).
function impSeedTimeOffRows(seed, opts) {
  opts = opts || {};
  var rows = [];
  var sr = (seed && seed.surgeonRules) || {};
  var nameRe = impRosterNameRegex(seed);
  Object.keys(sr).forEach(function (id) {
    ((sr[id] && sr[id].timeOff) || []).forEach(function (t, i) {
      impDayNum(t.start); if (t.end) impDayNum(t.end);
      var note = impTimeOffNote(t, "surgeonRules." + id + ".timeOff[" + i + "].note", nameRe, opts.inventory || null);
      rows.push({ person_id: id, start_date: t.start, end_date: t.end || t.start, note: note, created_by: "seed" });
    });
  });
  return rows;
}

// Prompt 12 B: an existingAssignments row with awaitingConfirmation: true is a
// lock the scheduler still has to re-confirm (the Thanksgiving rows recorded
// from an evening chat). Its schedule_days note is prefixed with this exact
// marker; the app shows a "confirm" badge on a locked day whose note starts
// with it (index-source.html AWAITING_CONFIRMATION_MARKER is the same literal,
// pinned by test/data-layer.test.js). The rows count in plan.stats and are
// listed in the dry-run inventory as 'awaiting-confirmation' (path only).
var IMP_AWAITING_MARKER = "awaiting confirmation - ";
function impAwaitingConfirmation(a) { return !!a && a.awaitingConfirmation === true; }

// Provenance note for an imported day: the seed's source string plus its
// operational note when present; the awaiting-confirmation marker in front
// when the row is flagged (a flag without source or note still writes the
// marker so the badge shows).
function impDayNote(a) {
  var parts = [];
  if (a.source) parts.push("seed: " + a.source);
  if (a.note) parts.push(String(a.note));
  var body = parts.length ? parts.join(" - ") : null;
  if (!impAwaitingConfirmation(a)) return body;
  return IMP_AWAITING_MARKER + (body || "").replace(/^\s+/, "");
}

// existingAssignments -> in-memory schedule (guide 4.1) with lock flags per
// groupRules.locks: a null slot is never locked.
function impSeedSchedule(seed) {
  var out = {};
  ((seed && seed.existingAssignments) || []).forEach(function (a) {
    impDayNum(a.date);
    var locked = !!a.locked;
    out[a.date] = {
      primary: a.primary || null,
      backup: a.backup || null,
      primaryLocked: locked && (a.primary != null || !!a.externalCover),
      backupLocked: locked && a.backup != null,
      source: "import",
      externalCover: a.externalCover || null,
      note: impDayNote(a)
    };
  });
  return out;
}

// existingAssignments -> schedule_days rows.
function impSeedScheduleRows(seed) {
  var sched = impSeedSchedule(seed);
  return Object.keys(sched).sort().map(function (day) {
    var d = sched[day];
    return {
      day: day,
      primary_id: d.primary,
      backup_id: d.backup,
      primary_locked: d.primaryLocked,
      backup_locked: d.backupLocked,
      source: "import",
      external_cover: d.externalCover,
      note: d.note,
      version: 1,
      updated_by: "seed"
    };
  });
}

// Full buildContext() input from the seed plus caller extras (East feed...).
function impSeedContextInput(seed, extras) {
  var base = {
    roster: seed.roster,
    surgeonRules: impSeedSurgeonRules(seed),
    groupRules: seed.groupRules,
    holidays: seed.holidays,
    timeOffRows: impSeedTimeOffRows(seed),
    availabilityRows: impSeedAvailabilityRows(seed, { collapse: false }),
    schedule: impSeedSchedule(seed)
  };
  return Object.assign(base, extras || {});
}

/* ------------------------------------------------------------ importPlan */

function impStats(plan) {
  var byKindRole = {};
  plan.availabilityRows.forEach(function (r) {
    var k = r.kind + "/" + r.role;
    byKindRole[k] = (byKindRole[k] || 0) + 1;
  });
  var byPerson = {};
  plan.availabilityRows.forEach(function (r) {
    var p = byPerson[r.person_id] || (byPerson[r.person_id] = {});
    var k = r.kind + "/" + r.role;
    p[k] = (p[k] || 0) + 1;
  });
  var days = plan.scheduleDayRows;
  return {
    call_schedule_data: 1,
    availability: plan.availabilityRows.length,
    availabilityByKindRole: byKindRole,
    availabilityByPerson: byPerson,
    time_off: plan.timeOffRows.length,
    schedule_days: days.length,
    scheduleDays: {
      primaryLocked: days.filter(function (d) { return d.primary_locked; }).length,
      backupLocked: days.filter(function (d) { return d.backup_locked; }).length,
      openPrimary: days.filter(function (d) { return d.primary_id == null && d.external_cover == null; }).length,
      openBackup: days.filter(function (d) { return d.backup_id == null; }).length,
      externalCover: days.filter(function (d) { return d.external_cover != null; }).length,
      awaitingConfirmation: days.filter(function (d) { return typeof d.note === "string" && d.note.indexOf(IMP_AWAITING_MARKER) === 0; }).length   // Prompt 12 B
    },
    infoDeltas: plan.infoDeltas.length
  };
}

// importPlan(seed, { now }) -> { blob, availabilityRows, timeOffRows, scheduleDayRows,
//                                infoDeltas, refusals, stats }
// Throws Error('CONTACT_DATA_REFUSED: ...') when roster[] or site carries contact data.
function importPlan(seed, options) {
  options = options || {};
  if (!seed || typeof seed !== "object") throw new Error("importer: seed must be an object");
  impRefuseContactData(seed);
  var now = options.now || new Date().toISOString();
  var meta = seed._meta || {};

  // surgeonRules go into the blob with derived explicitListMonths, vacations as
  // dates only (the blob is anon-readable; the seed's vacation wording stays in
  // the seed and the time_off rows say 'vacation (seed)'), and every note-like
  // key dropped - no category tokens (header: rule-note scrub, 12 AA).
  var rawRules = impClone(impSeedSurgeonRules(seed));
  Object.keys(rawRules).forEach(function (id) {
    var r = rawRules[id];
    if (r && Array.isArray(r.timeOff)) {
      r.timeOff = r.timeOff.map(function (t) { return { start: t.start, end: t.end || t.start }; });
    }
  });
  var scrub = impScrubRuleNotes(rawRules, seed.groupRules || {}, seed.holidays || {});

  var blob = {
    roster: impSeedRoster(seed),
    surgeonRules: scrub.surgeonRules,
    groupRules: scrub.groupRules,
    holidays: scrub.holidays,
    settings: {
      importedAt: now,
      seedGeneratedOn: meta.generatedOn || null,
      seedRevisions: impClone(meta.revisions || [])
    }
  };
  var leaks = impFindKeys(blob, IMP_BLOB_KEY);
  if (leaks.length) throw new Error("CONTACT_DATA_REFUSED: the blob would carry contact-looking keys at " + leaks.join(", "));
  impRefuseNoteDenylist(blob);                                        // throws NOTE_DENYLIST

  var infoDeltas = ((seed.pendingDeltas) || []).map(function (d) {
    var who = d.surgeon ? impRosterName(seed, d.surgeon) : "open";      // surgeon null = the slot was opened (10/24, 9/22 evening)
    var was = d.replaces ? impRosterName(seed, d.replaces) : "open";
    return impShortDay(d.date) + " " + (d.role === "backup" ? "B" : "P") + " " + was + " -> " + who +
      " (" + (d.status || "applied") + "; " + (d.source || "seed") + ") - already applied inside existingAssignments, nothing to write";
  });

  // time_off rows; kept public notes join the scrub inventory as 'public' entries
  // (path -> public in the dry run) and surname fallbacks as 'private-name' - the
  // scrub itself never sees timeOff notes.
  var publicInv = [];
  var timeOffRows = impSeedTimeOffRows(seed, { inventory: publicInv });     // throws NOTE_DENYLIST
  // Prompt 12 B: flagged existingAssignments rows join the dry-run inventory too
  // ('existingAssignments[<date>].note -> awaiting-confirmation'; path only, the
  // CLI prints the inventory as is), counted under counts.awaitingConfirmation.
  var awaitingInv = ((seed.existingAssignments) || []).filter(impAwaitingConfirmation).map(function (a) {
    return { path: "existingAssignments[" + a.date + "].note", action: "awaiting-confirmation", to: "schedule_days" };
  });
  var inventory = scrub.inventory.concat(publicInv, awaitingInv);
  inventory.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });

  var plan = {
    blob: blob,
    availabilityRows: impSeedAvailabilityRows(seed),
    timeOffRows: timeOffRows,
    scheduleDayRows: impSeedScheduleRows(seed),
    infoDeltas: infoDeltas,
    refusals: [],
    generatedAt: now,
    noteScrub: {
      inventory: inventory,
      counts: {                                                       // 12 AA: no 'category' count - nothing is classified any more
        drop: scrub.inventory.filter(function (e) { return e.action === "drop"; }).length,
        timeOffPublic: publicInv.filter(function (e) { return e.action === "public"; }).length,   // surname fallbacks are inventoried, not counted as public
        awaitingConfirmation: awaitingInv.length
      }
    }
  };
  impRefuseContactOutput(plan);
  plan.stats = impStats(plan);
  return plan;
}

/* --------------------------------------------------------------- SQL */

// Text literal. ASCII strings are plain '...'; a string with any non-ASCII
// character (an em dash in a day note) becomes an E'...' literal with \uXXXX
// escapes (backslashes doubled) so the generated file stays 7-bit clean.
function impSqlStr(v) {
  if (v === null || v === undefined) return "null";
  var s = String(v);
  if (!IMP_NON_ASCII_ANY.test(s)) return "'" + s.replace(/'/g, "''") + "'";   // non-global sibling: no lastIndex state
  return "E'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(IMP_NON_ASCII, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  }) + "'";
}

function impSqlBool(v) { return v ? "true" : "false"; }

// JSON -> quoted jsonb literal; non-ASCII escaped so the file stays 7-bit clean.
var IMP_NON_ASCII = new RegExp("[" + String.fromCharCode(128) + "-" + String.fromCharCode(65535) + "]", "g"); // built from codes so this file stays 7-bit
var IMP_NON_ASCII_ANY = new RegExp(IMP_NON_ASCII.source);   // for .test(): a global regex keeps lastIndex between calls

function impSqlJson(v) {
  var s = JSON.stringify(v).replace(IMP_NON_ASCII, function (c) {
    return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
  });
  return impSqlStr(s) + "::jsonb";
}

function impSqlSnapshot() {
  return [
    "-- 1. snapshot of everything the import can touch (skipped on a fresh install)",
    "insert into public.call_schedule_snapshots (reason, data, source_updated_at, created_by)",
    "select 'before_seed_import',",
    "       jsonb_build_object(",
    "         'config',        (select data from public.call_schedule_data where id = 'main'),",
    "         'schedule_days', (select coalesce(jsonb_agg(to_jsonb(s) order by s.day), '[]'::jsonb) from public.schedule_days s),",
    "         'time_off',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.time_off t),",
    "         'availability',  (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.availability a)),",
    "       (select updated_at from public.call_schedule_data where id = 'main'),",
    "       'seed'",
    " where exists (select 1 from public.schedule_days)",
    "    or exists (select 1 from public.time_off)",
    "    or exists (select 1 from public.availability)",
    "    or coalesce((select data from public.call_schedule_data where id = 'main'), '{}'::jsonb) <> '{}'::jsonb;",
    ""
  ].join("\n");
}

// impMergeRoster(seedRoster, liveRoster) -> the roster a seed import writes:
// the seed's rows (the seed owns the pool), then every LIVE row of type
// "external" (an outside surgeon added in Setup, Prompt 12 M - the seed never
// names one) whose id the seed does not carry, in live order and as it is.
// A live pool row the seed lacks is still dropped (as before); no live roster
// -> the seed roster. planDiff compares this merged roster, the app's apply
// writes it, and impSqlBlob does the same merge in SQL.
function impMergeRoster(seedRoster, liveRoster) {
  var seedRows = Array.isArray(seedRoster) ? seedRoster.slice() : [];
  var seen = {};
  seedRows.forEach(function (r) { if (r && r.id) seen[r.id] = true; });
  (Array.isArray(liveRoster) ? liveRoster : []).forEach(function (r) {
    if (r && r.id && r.type === "external" && !seen[r.id]) { seen[r.id] = true; seedRows.push(r); }
  });
  return seedRows;
}

function impSqlBlob(blob) {
  var core = Object.assign({}, blob);
  delete core.settings;
  var settings = Object.assign({}, blob.settings || {});
  var settingsStable = Object.assign({}, settings);
  delete settingsStable.importedAt;
  // The roster the row ends up with = the seed's rows followed by the live outside surgeons the seed
  // lacks (impMergeRoster in SQL): the seed owns the pool rows only. Same expression in the SET and in
  // the idempotency WHERE so a byte-identical re-run still leaves the row untouched.
  var roster = Array.isArray(blob.roster) ? blob.roster : [];
  var seedIds = roster.map(function (r) { return impSqlStr(r && r.id); }).join(", ");
  var liveExternals = "coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(call_schedule_data.data -> 'roster', '[]'::jsonb)) as r" +
    " where r ->> 'type' = 'external' and not (r ->> 'id' = any (array[" + seedIds + "]::text[]))), '[]'::jsonb)";
  var coreExpr = "jsonb_set((coalesce(call_schedule_data.data, '{}'::jsonb) - 'settings') || " + impSqlJson(core) + ",\n" +
    "                   '{roster}', " + impSqlJson(roster) + " || " + liveExternals + ", true)";
  return [
    "-- 2. config blob: merge the imported keys into row 'main' (keys the app adds later are kept;",
    "--    outside surgeons added in Setup (roster rows of type \"external\") are kept beside the seed's roster;",
    "--    settings merge one level deeper; a byte-identical re-run leaves the row untouched)",
    "insert into public.call_schedule_data (id, data, updated_by, updated_at)",
    "values ('main', " + impSqlJson(blob) + ", 'seed', now())",
    "on conflict (id) do update set",
    "  data = jsonb_set(" + coreExpr + ",",
    "                   '{settings}',",
    "                   coalesce(call_schedule_data.data -> 'settings', '{}'::jsonb) || " + impSqlJson(settings) + ", true),",
    "  updated_by = 'seed',",
    "  updated_at = now()",
    "where " + coreExpr,
    "        is distinct from (coalesce(call_schedule_data.data, '{}'::jsonb) - 'settings')",
    "   or coalesce(call_schedule_data.data -> 'settings', '{}'::jsonb) || " + impSqlJson(settingsStable),
    "        is distinct from coalesce(call_schedule_data.data -> 'settings', '{}'::jsonb);",
    ""
  ].join("\n");
}

function impSqlScheduleDays(rows) {
  if (!rows.length) return "-- 3. schedule_days: nothing to import\n";
  var values = rows.map(function (r) {
    return "  (" + [impSqlStr(r.day), impSqlStr(r.primary_id), impSqlStr(r.backup_id), impSqlBool(r.primary_locked),
      impSqlBool(r.backup_locked), impSqlStr(r.source || "import"), impSqlStr(r.external_cover), impSqlStr(r.note),
      String(r.version || 1), impSqlStr(r.updated_by || "seed")].join(", ") + ")";
  });
  return [
    "-- 3. schedule_days: insert new days; update only days the app has not edited since",
    "--    (source still 'import') and only when something differs (version bumps then)",
    "insert into public.schedule_days (day, primary_id, backup_id, primary_locked, backup_locked, source, external_cover, note, version, updated_by)",
    "values",
    values.join(",\n"),
    "on conflict (day) do update set",
    "  primary_id     = excluded.primary_id,",
    "  backup_id      = excluded.backup_id,",
    "  primary_locked = excluded.primary_locked,",
    "  backup_locked  = excluded.backup_locked,",
    "  source         = 'import',",
    "  external_cover = excluded.external_cover,",
    "  note           = excluded.note,",
    "  version        = schedule_days.version + 1,",
    "  updated_by     = 'seed',",
    "  updated_at     = now()",
    "where schedule_days.source = 'import'",
    "  and coalesce(schedule_days.updated_by, 'seed') = 'seed'",   // an app-filled slot on an import day is app-owned: never overwritten by a re-import
    "  and (schedule_days.primary_id, schedule_days.backup_id, schedule_days.primary_locked, schedule_days.backup_locked, schedule_days.external_cover, schedule_days.note)",
    "      is distinct from",
    "      (excluded.primary_id, excluded.backup_id, excluded.primary_locked, excluded.backup_locked, excluded.external_cover, excluded.note);",
    ""
  ].join("\n");
}

function impSqlAvailability(rows) {
  if (!rows.length) return "-- 4. availability: nothing to import\n";
  var values = rows.map(function (r) {
    return "  (" + [impSqlStr(r.person_id), impSqlStr(r.kind), impSqlStr(r.role || "any"), impSqlStr(r.start_date), impSqlStr(r.end_date),
      impSqlStr(r.note), impSqlStr(r.source || "seed"), "'seed'"].join(", ") + ")";
  });
  return [
    "-- 4. availability: keyed on the expression index availability_stmt_uniq",
    "--    (person_id, kind, role, start_date, end_date, coalesce(source, ''))",
    "insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by)",
    "values",
    values.join(",\n"),
    "on conflict (person_id, kind, role, start_date, end_date, coalesce(source, '')) do update set",
    "  note = excluded.note",
    "where availability.note is distinct from excluded.note;",
    ""
  ].join("\n");
}

function impSqlTimeOff(rows) {
  if (!rows.length) return "-- 5. time_off: nothing to import\n";
  var stmts = rows.map(function (r) {
    return [
      "insert into public.time_off (person_id, start_date, end_date, note, created_by)",
      "select " + [impSqlStr(r.person_id), impSqlStr(r.start_date) + "::date", impSqlStr(r.end_date) + "::date", impSqlStr(r.note || "vacation (seed)"), impSqlStr(r.created_by || "seed")].join(", "),
      " where not exists (select 1 from public.time_off t",
      "                    where t.person_id = " + impSqlStr(r.person_id),
      "                      and t.start_date = " + impSqlStr(r.start_date) + "::date",
      "                      and t.end_date = " + impSqlStr(r.end_date) + "::date);"
    ].join("\n");
  });
  return [
    "-- 5. time_off: vacations only, one insert per row guarded by WHERE NOT EXISTS (no unique index there);",
    "--    the ON_CALL_CONFLICT trigger checks each row against the schedule_days written above",
    stmts.join("\n"),
    ""
  ].join("\n");
}

/* ---- stale seed-owned rows (see header: ownership + stale rows) */

// Deletes are set-based against the plan's keys, so they need no live fetch
// and are idempotent. Each is skipped when the plan has no rows for the table.
function impSqlStaleScheduleDays(rows) {
  if (!rows.length) return "-- 3a. schedule_days: plan has no rows - seed-owned live days left alone (no wipe)\n";
  return [
    "-- 3a. schedule_days: drop seed-owned days (source 'import', updated_by 'seed') the seed no longer lists;",
    "--     days the app has touched since (any other source / updated_by) are never deleted",
    "delete from public.schedule_days",
    " where source = 'import' and updated_by = 'seed'",
    "   and day not in (" + rows.map(function (r) { return impSqlStr(r.day) + "::date"; }).join(", ") + ");",
    ""
  ].join("\n");
}

function impSqlStaleAvailability(rows) {
  if (!rows.length) return "-- 4a. availability: plan has no rows - seed-owned live rows left alone (no wipe)\n";
  var tuples = rows.map(function (r) {
    return "(" + [impSqlStr(r.person_id), impSqlStr(r.kind), impSqlStr(r.role || "any"), impSqlStr(r.start_date) + "::date", impSqlStr(r.end_date) + "::date"].join(", ") + ")";
  });
  return [
    "-- 4a. availability: drop seed-owned rows (source 'seed') whose statement key is no longer in the plan",
    "--     (a removed date, an edited range); rows from setup/email/the app keep their own source and stay",
    "delete from public.availability",
    " where source = 'seed'",
    "   and (person_id, kind, role, start_date, end_date) not in (",
    "  " + tuples.join(",\n  "),
    "   );",
    ""
  ].join("\n");
}

function impSqlStaleTimeOff(rows) {
  if (!rows.length) return "-- 5a. time_off: plan has no rows - seed-owned live rows left alone (no wipe)\n";
  var tuples = rows.map(function (r) {
    return "(" + [impSqlStr(r.person_id), impSqlStr(r.start_date) + "::date", impSqlStr(r.end_date) + "::date"].join(", ") + ")";
  });
  return [
    "-- 5a. time_off: drop seed-owned vacations (created_by 'seed') the seed no longer lists (moved/removed);",
    "--     self-entered vacations carry the surgeon's own created_by and stay",
    "delete from public.time_off",
    " where created_by = 'seed'",
    "   and (person_id, start_date, end_date) not in (" + tuples.join(", ") + ");",
    ""
  ].join("\n");
}

// importSql(plan) -> string. One transaction: snapshot, blob merge, then per
// table: stale seed-owned rows deleted, then insert/update. Idempotent: every
// insert carries ON CONFLICT or WHERE NOT EXISTS, every update is guarded by
// IS DISTINCT FROM, every delete is set-based against the plan's keys.
// Prompt 12 B: ' (N awaiting confirmation)' after the schedule_days count in the
// SQL header when any planned row carries the marker; empty otherwise so
// unflagged seeds keep their header byte for byte.
function impAwaitingHeader(plan) {
  var n = (plan.scheduleDayRows || []).filter(function (d) { return typeof d.note === "string" && d.note.indexOf(IMP_AWAITING_MARKER) === 0; }).length;
  return n ? " (" + n + " awaiting confirmation)" : "";
}

function importSql(plan) {
  if (!plan || !plan.blob) throw new Error("importer: importSql needs a plan from importPlan()");
  var head = [
    "-- Silvis seed import - generated " + (plan.generatedAt || new Date().toISOString()) + " by importer.js",
    "-- seed generatedOn " + ((plan.blob.settings && plan.blob.settings.seedGeneratedOn) || "?") +
      "; " + plan.scheduleDayRows.length + " schedule_days" + impAwaitingHeader(plan) + ", " + plan.availabilityRows.length + " availability, " + plan.timeOffRows.length + " time_off rows",
    "-- Idempotent: safe to run again; a re-run of identical data changes nothing.",
    "begin;",
    ""
  ].join("\n");
  var tail = [
    "commit;",
    "select (select count(*) from public.schedule_days)  as schedule_days,",
    "       (select count(*) from public.availability)   as availability,",
    "       (select count(*) from public.time_off)       as time_off,",
    "       (select count(*) from public.call_schedule_snapshots) as snapshots,",
    "       (select data -> 'settings' ->> 'importedAt' from public.call_schedule_data where id = 'main') as imported_at;",
    ""
  ].join("\n");
  return head + impSqlSnapshot() + "\n" + impSqlBlob(plan.blob) + "\n" +
    impSqlStaleScheduleDays(plan.scheduleDayRows) + "\n" + impSqlScheduleDays(plan.scheduleDayRows) + "\n" +
    impSqlStaleAvailability(plan.availabilityRows) + "\n" + impSqlAvailability(plan.availabilityRows) + "\n" +
    impSqlStaleTimeOff(plan.timeOffRows) + "\n" + impSqlTimeOff(plan.timeOffRows) + "\n" + tail;
}

/* ---------------------------------------------------------------- diff */

function impAvailKey(r) { return [r.person_id, r.kind, r.role || "any", r.start_date, r.end_date, r.source || ""].join("|"); }
function impTimeOffKey(r) { return [r.person_id, r.start_date, r.end_date].join("|"); }

function impSlotLabel(names, id, externalCover) {
  if (id) return names[id] || id;
  if (externalCover) return externalCover + " (external)";
  return "OPEN";
}

function impDaySame(a, b) {
  return (a.primary_id || null) === (b.primary_id || null) && (a.backup_id || null) === (b.backup_id || null) &&
    !!a.primary_locked === !!b.primary_locked && !!a.backup_locked === !!b.backup_locked &&
    (a.external_cover || null) === (b.external_cover || null) && (a.note || null) === (b.note || null);
}

// planDiff(plan, live) -> { text, lines, tables, changes, blocked, totalChanges }
// live = { blob, availability[], time_off[], schedule_days[] } as fetched by the caller.
function planDiff(plan, live) {
  live = live || {};
  var names = {};
  (plan.blob.roster || []).forEach(function (r) { names[r.id] = r.name || r.code || r.id; });
  var tables = {};
  var lines = [];
  var changes = [];
  var blocked = [];

  // call_schedule_data
  var liveBlob = live.blob && typeof live.blob === "object" ? live.blob : null;
  var blobKeys = Object.keys(plan.blob);
  var blobT = { insert: 0, update: 0, unchanged: 0, keys: {}, keptExternals: [] };
  var liveEmpty = !liveBlob || Object.keys(liveBlob).length === 0;
  blobKeys.forEach(function (k) {
    var mine = plan.blob[k], theirs = liveBlob ? liveBlob[k] : undefined;
    if (k === "roster" && Array.isArray(theirs)) {
      // the seed owns the pool rows only: live outside surgeons ride along (impMergeRoster, as the SQL / app write them)
      mine = impMergeRoster(mine, theirs);
      blobT.keptExternals = mine.slice((plan.blob.roster || []).length).map(function (r) { return r.id; });
    }
    if (k === "settings") {
      mine = Object.assign({}, mine); delete mine.importedAt;
      theirs = theirs ? Object.assign({}, theirs) : theirs; if (theirs) delete theirs.importedAt;
      // settings are merged, so compare only the keys the seed sets
      if (theirs) { var sub = {}; Object.keys(mine).forEach(function (kk) { sub[kk] = theirs[kk]; }); theirs = sub; }
    }
    var state = theirs === undefined ? (liveEmpty ? "insert" : "update") : (impSame(mine, theirs) ? "unchanged" : "update");
    blobT[state]++;
    blobT.keys[k] = state;
  });
  tables.call_schedule_data = blobT;

  // Stale = a live row the seed owns that the plan no longer contains (the SQL
  // deletes it). Mirrors importSql: no deletes when the plan has no rows for
  // the table - such rows are listed as 'kept' and not counted as changes.
  var stale = [];

  // availability
  var liveAv = {};
  (live.availability || []).forEach(function (r) { liveAv[impAvailKey(r)] = r; });
  var avT = { insert: 0, update: 0, unchanged: 0, delete: 0, kept: 0, rows: [] };
  var planAv = {};
  plan.availabilityRows.forEach(function (r) {
    planAv[impAvailKey(r)] = true;
    var l = liveAv[impAvailKey(r)];
    var state = !l ? "insert" : ((l.note || null) === (r.note || null) ? "unchanged" : "update");
    avT[state]++;
    if (state !== "unchanged") avT.rows.push(state + " " + r.person_id + " " + r.kind + "/" + r.role + " " + r.start_date + (r.end_date !== r.start_date ? ".." + r.end_date : ""));
  });
  (live.availability || []).forEach(function (r) {
    if ((r.source || "") !== "seed" || planAv[impAvailKey(r)]) return;
    var label = r.person_id + " " + r.kind + "/" + (r.role || "any") + " " + String(r.start_date).slice(0, 10) + (r.end_date !== r.start_date ? ".." + String(r.end_date).slice(0, 10) : "");
    if (!plan.availabilityRows.length) { avT.kept++; stale.push("availability " + label + " [KEPT: plan has no availability rows, seed-owned row not deleted]"); return; }
    avT.delete++;
    avT.rows.push("delete " + label + " (seed-owned, no longer in the seed)");
  });
  tables.availability = avT;

  // time_off
  var liveTo = {};
  (live.time_off || []).forEach(function (r) { liveTo[impTimeOffKey(r)] = r; });
  var toT = { insert: 0, update: 0, unchanged: 0, delete: 0, kept: 0, rows: [] };
  var planTo = {};
  plan.timeOffRows.forEach(function (r) {
    planTo[impTimeOffKey(r)] = true;
    var state = liveTo[impTimeOffKey(r)] ? "unchanged" : "insert";
    toT[state]++;
    if (state === "insert") toT.rows.push("insert " + (names[r.person_id] || r.person_id) + " " + r.start_date + ".." + r.end_date);
  });
  (live.time_off || []).forEach(function (r) {
    if ((r.created_by || "") !== "seed" || planTo[impTimeOffKey(r)]) return;
    var label = (names[r.person_id] || r.person_id) + " " + String(r.start_date).slice(0, 10) + ".." + String(r.end_date).slice(0, 10);
    if (!plan.timeOffRows.length) { toT.kept++; stale.push("time_off " + label + " [KEPT: plan has no time_off rows, seed-owned row not deleted]"); return; }
    toT.delete++;
    toT.rows.push("delete " + label + " (seed-owned, no longer in the seed)");
  });
  tables.time_off = toT;

  // schedule_days
  var liveSd = {};
  (live.schedule_days || []).forEach(function (r) { liveSd[String(r.day).slice(0, 10)] = r; });
  var sdT = { insert: 0, update: 0, unchanged: 0, blocked: 0, delete: 0, kept: 0, byMonth: {} };
  var planSd = {};
  plan.scheduleDayRows.forEach(function (r) { planSd[r.day] = true; });
  (live.schedule_days || []).forEach(function (r) {
    var day = String(r.day).slice(0, 10);
    if (r.source !== "import" || (r.updated_by || "") !== "seed" || planSd[day]) return;
    var label = impShortDay(day) + " P " + impSlotLabel(names, r.primary_id, r.external_cover) + " / B " + impSlotLabel(names, r.backup_id, null);
    if (!plan.scheduleDayRows.length) { sdT.kept++; stale.push("schedule_days " + label + " [KEPT: plan has no schedule_days rows, seed-owned day not deleted]"); return; }
    sdT.delete++;
    var m = day.slice(0, 7);
    var bm = sdT.byMonth[m] || (sdT.byMonth[m] = { insert: 0, update: 0, unchanged: 0, blocked: 0, delete: 0 });
    bm.delete++;
    changes.push(label + " -> deleted (seed-owned day no longer in the seed)");
  });
  plan.scheduleDayRows.forEach(function (r) {
    var l = liveSd[r.day];
    var state;
    if (!l) state = "insert";
    else if (impDaySame(l, r)) state = "unchanged";
    else if (l.source !== "import" || (l.updated_by || "seed") !== "seed") state = "blocked";   // app-edited (source) or app-filled (updated_by) days are never overwritten
    else state = "update";
    sdT[state]++;
    var m = r.day.slice(0, 7);
    var bm = sdT.byMonth[m] || (sdT.byMonth[m] = { insert: 0, update: 0, unchanged: 0, blocked: 0, delete: 0 });
    bm[state]++;
    if (state === "update" || state === "blocked") {
      var dayLines = [];
      if ((l.primary_id || null) !== (r.primary_id || null) || (l.external_cover || null) !== (r.external_cover || null)) {
        dayLines.push(impShortDay(r.day) + " P " + impSlotLabel(names, l.primary_id, l.external_cover) + " -> " + impSlotLabel(names, r.primary_id, r.external_cover));
      }
      if ((l.backup_id || null) !== (r.backup_id || null)) {
        dayLines.push(impShortDay(r.day) + " B " + impSlotLabel(names, l.backup_id, null) + " -> " + impSlotLabel(names, r.backup_id, null));
      }
      if (!dayLines.length) dayLines.push(impShortDay(r.day) + " locks/note change");
      dayLines.forEach(function (t) {
        if (state === "blocked") { blocked.push(t + " [BLOCKED: live source '" + (l.source || "") + "' updated_by '" + (l.updated_by || "") + "' v" + l.version + " - edited in the app, not overwritten]"); }
        else changes.push(t);
      });
    }
  });
  tables.schedule_days = sdT;

  var totalDeletes = avT.delete + toT.delete + sdT.delete;
  var totalChanges = blobT.insert + blobT.update + avT.insert + avT.update + toT.insert + sdT.insert + sdT.update + totalDeletes;

  lines.push("call_schedule_data 'main': " + blobKeys.map(function (k) { return k + "=" + blobT.keys[k]; }).join(", "));
  if (blobT.keptExternals.length) lines.push("  outside surgeon(s) kept from the live roster: " + blobT.keptExternals.join(", ") + " (added in Setup; the seed never names them)");
  lines.push("schedule_days: insert " + sdT.insert + ", update " + sdT.update + ", delete " + sdT.delete + ", unchanged " + sdT.unchanged + (sdT.blocked ? ", BLOCKED " + sdT.blocked : "") + (sdT.kept ? ", kept " + sdT.kept : ""));
  Object.keys(sdT.byMonth).sort().forEach(function (m) {
    var b = sdT.byMonth[m];
    lines.push("  " + m + ": insert " + b.insert + ", update " + b.update + ", delete " + b.delete + ", unchanged " + b.unchanged + (b.blocked ? ", blocked " + b.blocked : ""));
  });
  changes.forEach(function (t) { lines.push("  " + t); });
  blocked.forEach(function (t) { lines.push("  " + t); });
  lines.push("availability: insert " + avT.insert + ", update " + avT.update + ", delete " + avT.delete + ", unchanged " + avT.unchanged + (avT.kept ? ", kept " + avT.kept : ""));
  avT.rows.forEach(function (t) { lines.push("  " + t); });
  lines.push("time_off: insert " + toT.insert + ", delete " + toT.delete + ", unchanged " + toT.unchanged + (toT.kept ? ", kept " + toT.kept : ""));
  toT.rows.forEach(function (t) { lines.push("  " + t); });
  stale.forEach(function (t) { lines.push("  " + t); });
  lines.push(totalChanges === 0 && !blocked.length ? "No changes - the live tables already match the plan." :
    "Total changes: " + totalChanges + (totalDeletes ? " (incl. " + totalDeletes + " delete(s) of seed-owned rows)" : "") + (blocked.length ? " (+" + blocked.length + " blocked)" : ""));

  return { text: lines.join("\n"), lines: lines, tables: tables, changes: changes, blocked: blocked, kept: stale, totalChanges: totalChanges, totalDeletes: totalDeletes };
}

/* ------------------------------------------------------------- exports */

var impExports = {
  importPlan: importPlan,
  importSql: importSql,
  planDiff: planDiff,
  IMP_AWAITING_MARKER: IMP_AWAITING_MARKER,     // Prompt 12 B: the schedule_days note prefix the app's "confirm" badge reads
  // seed -> shape helpers (test/seed-adapter.js delegates here)
  impSeedRoster: impSeedRoster,
  impMergeRoster: impMergeRoster,
  impSeedAvailabilityRows: impSeedAvailabilityRows,
  impSeedSurgeonRules: impSeedSurgeonRules,
  impSeedTimeOffRows: impSeedTimeOffRows,
  impSeedSchedule: impSeedSchedule,
  impSeedScheduleRows: impSeedScheduleRows,
  impSeedContextInput: impSeedContextInput,
  impCollapseRanges: impCollapseRanges,
  impFindKeys: impFindKeys,
  impFindEmailValues: impFindEmailValues,
  impFindPhoneValues: impFindPhoneValues,
  impFindContactValues: impFindContactValues,
  impScrubRuleNotes: impScrubRuleNotes,
  impRefuseNoteDenylist: impRefuseNoteDenylist,
  impCanon: impCanon
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = impExports;
}
if (typeof window !== "undefined") {
  window.SilvisImporter = impExports;
}
