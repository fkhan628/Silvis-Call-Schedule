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
//   _meta.generatedOn / _meta.revisions   -> blob.settings.seedGeneratedOn / seedRevisionCount + seedLastRevision
//                                            (RF2 9/23: the count and the LAST entry's date prefix only - the
//                                            paragraphs stay in the seed; the blob is anon-readable. The old key
//                                            seedRevisions is retired: the SQL and the app's Apply remove it.)
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
//
// Offer periods (Prompt 14 P5, 9/23 - one mechanism; docs/PROMPT-14-OFFER-PERIODS.md part 5). OPT-IN:
// importPlan(seed, { offerPeriods: true }) - the CLI's setting. Without it the plan is the pre-period plan
// above (the in-app Setup import applies availability / time_off / schedule_days only and cannot write offers
// until part 3, so a period-aware default there would retire a whitelist without writing the offers).
//   offerPeriods[]                        -> call_periods rows (upsert by start_day; the seed owns label, dates,
//                                            rules_only_ids and its offer_modes keys; status is written on insert only)
//   surgeonRules[id].offerSources         -> tags { source, tag[, rolePref] } on the lists that ARE the offers:
//     .explicitAvailable[month]              a plain list -> 'either', a role-keyed list -> that role
//     .offeredDays[month]                    same shapes; a list the legacy derivation never reads (Acton's November)
//     .availableWeeks                        every day Mon-Sun of a listed week -> 'either'
//                                         -> call_offers rows for a surgeon WITH a mode in offerPeriods[].offerModes:
//                                            one row per listed day inside the period and on/after today (America/
//                                            Chicago; the DB refuses a past day, OF001); a day inside the person's
//                                            seed vacation is skipped and listed (OF002 would refuse it); a day that
//                                            is already locked stays an offer (the record stays honest); a day listed
//                                            in both roles reads 'either'. Rows: entered_by 'scheduler', source from
//                                            the tag ('email-relay' default), note 'seed: <tag>' - the seed OWNS rows
//                                            with source email-relay / import + entered_by scheduler + that note
//                                            shape; offers entered or relayed in the app are never updated or deleted.
//   for such a 'submitted' surgeon        -> NO 'available' availability row for a day inside the period and NO
//                                            explicitListMonths entry (seed or derived) for a month that overlaps it
//                                            (unavailable / no_backup / backup_only rows still go); outside the
//                                            period (October lists, weeks in 2027...) the old behaviour stands.
//   status per surgeon per period (dry-run table) is derived like SQL offer_status(): submitted (>= 1 listed day in
//   the period, whatever today is), else rules_only (listed in rulesOnly), else not_started; a submitted surgeon
//   with 0 rows planned (listed days all past / on a vacation) is named in offerWarnings.
//   Consistency (refused whether or not the option is on - a bad seed is a bad seed): a surgeon WITH a mode in a
//   period may not keep an UNTAGGED explicitAvailable / offeredDays / availableWeeks list that reaches into it
//   (OFFER_SOURCE_INVALID - his status would retire the rows and the month while no offer carries the days);
//   periods never overlap and a period label is gated against the note denylist (it reaches call_periods).
//   Stale seed-owned offers are deleted set-based for days on/after today only (past rows are the record). The
//   call_offers insert selects from a VALUES list and proposes only rows that would change (a new key, or a
//   seed-owned row that differs): a row-level BEFORE INSERT trigger runs for every proposed row before the conflict
//   check, so a re-run of identical data fires no trigger while a changed / new seed-owned offer after
//   offers_close_at fails loudly (OF003 - the CLI is not the scheduler) and rolls the import back.
//   call_offers / call_periods are authenticated-read (never anon): planDiff reads live.call_offers === null as
//   'unknown' (every planned row an upsert, counted) and the CLI verifies from the SQL's returning rows.

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
  (plan.offerRows || []).forEach(function (r, i) { impFindContactValues(r.note, "call_offers[" + i + "].note", hits); });
  (plan.periodRows || []).forEach(function (r, i) { impFindContactValues(r.label, "call_periods[" + i + "].label", hits); });
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

/* ------------------------------------------ offer periods (Prompt 14 P5) */

var IMP_OFFER_MODES = { exhaustive: true, preferred: true };
var IMP_OFFER_ROLES = { primary: true, backup: true, either: true };
var IMP_OFFER_SOURCES = { "email-relay": true, "import": true };
var IMP_OFFER_LIST_KEYS = ["explicitAvailable", "offeredDays", "availableWeeks"];
var IMP_PERIOD_STATUS = { upcoming: true, closed: true, generated: true, published: true };
var IMP_OFFER_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Today in America/Chicago for an ISO instant: the DB trigger OF001 judges
// 'past' in Central time, so the plan does the same. Intl when present (Node,
// every browser the app supports); a fixed CST offset as the last resort.
function impCentralToday(nowIso) {
  var d = nowIso ? new Date(nowIso) : new Date();
  if (isNaN(d.getTime())) throw new Error("importer: bad now " + JSON.stringify(nowIso));
  try {
    var s = d.toLocaleDateString("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  } catch (e) { /* no time-zone data: fall through */ }
  return new Date(d.getTime() - 6 * 3600000).toISOString().slice(0, 10);
}

function impPeriodRefuse(path, msg) { throw new Error("OFFER_PERIOD_INVALID: " + path + " - " + msg); }
function impPeriodDay(v, path) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) impPeriodRefuse(path, "needs a 'YYYY-MM-DD' date (got " + JSON.stringify(v === undefined ? null : v) + ")");
  impDayNum(v);
  return v;
}

// seed.offerPeriods[] -> call_periods rows (validated; refuses with OFFER_PERIOD_INVALID: <path> - <why>).
// Accepts the seed's names (start, end, offersCloseAt, publishBy, rulesOnly, offerModes) and the table's.
function impSeedPeriods(seed) {
  var list = (seed && seed.offerPeriods) || [];
  if (!Array.isArray(list)) impPeriodRefuse("offerPeriods", "must be a list of periods");
  var rosterIds = {};
  ((seed && seed.roster) || []).forEach(function (r) { if (r && r.id) rosterIds[r.id] = true; });
  var seenStart = {};
  return list.map(function (p, i) {
    var path = "offerPeriods[" + i + "]";
    if (!p || typeof p !== "object" || Array.isArray(p)) impPeriodRefuse(path, "must be an object");
    var pick = function (a, b) { return p[a] !== undefined ? p[a] : p[b]; };
    var label = pick("label", "label");
    if (typeof label !== "string" || !label.trim()) impPeriodRefuse(path + ".label", "needs a label like 'Nov 2026 - Jan 2027'");
    var start = impPeriodDay(pick("start", "start_day"), path + ".start");
    var end = impPeriodDay(pick("end", "end_day"), path + ".end");
    if (end < start) impPeriodRefuse(path + ".end", end + " is before start " + start);
    var closeAt = impPeriodDay(pick("offersCloseAt", "offers_close_at"), path + ".offersCloseAt");
    if (closeAt > start) impPeriodRefuse(path + ".offersCloseAt", closeAt + " is after start " + start + " (call_periods checks offers_close_at <= start_day)");
    var publishBy = impPeriodDay(pick("publishBy", "publish_by"), path + ".publishBy");
    var status = pick("status", "status");
    if (status === undefined) status = "upcoming";
    if (!IMP_PERIOD_STATUS[status]) impPeriodRefuse(path + ".status", "must be upcoming / closed / generated / published");
    var rulesOnly = pick("rulesOnly", "rules_only_ids");
    if (rulesOnly === undefined || rulesOnly === null) rulesOnly = [];
    if (!Array.isArray(rulesOnly)) impPeriodRefuse(path + ".rulesOnly", "must be a list of roster ids");
    rulesOnly.forEach(function (id, k) { if (typeof id !== "string" || !rosterIds[id]) impPeriodRefuse(path + ".rulesOnly[" + k + "]", JSON.stringify(id) + " is not a roster id"); });
    var modesIn = pick("offerModes", "offer_modes");
    if (modesIn === undefined || modesIn === null) modesIn = {};
    if (typeof modesIn !== "object" || Array.isArray(modesIn)) impPeriodRefuse(path + ".offerModes", "must be an object { <roster id>: 'exhaustive' | 'preferred' }");
    var modes = {};
    Object.keys(modesIn).forEach(function (id) {
      if (!rosterIds[id]) impPeriodRefuse(path + ".offerModes." + id, "is not a roster id");
      if (!IMP_OFFER_MODES[modesIn[id]]) impPeriodRefuse(path + ".offerModes." + id, JSON.stringify(modesIn[id]) + " is not 'exhaustive' or 'preferred'");
      if (rulesOnly.indexOf(id) >= 0) impPeriodRefuse(path, id + " is listed in rulesOnly and has an offer mode - one or the other");
      modes[id] = modesIn[id];
    });
    if (seenStart[start]) impPeriodRefuse(path + ".start", "a second period starting " + start + " (start_day is the upsert key)");
    seenStart[start] = true;
    // the label reaches the authenticated-read call_periods table: reason-free like an offer note (9/23 review)
    var deny = label.match(IMP_NOTE_DENYLIST);
    if (deny) throw new Error("NOTE_DENYLIST: " + path + ".label (\"" + deny[1] + "\") - a personal word in a period label; reword the seed and re-run");
    var row = { label: label.trim(), start_day: start, end_day: end, offers_close_at: closeAt, publish_by: publishBy, status: status, rules_only_ids: rulesOnly.slice(), offer_modes: modes, created_by: "seed" };
    // periods never overlap: a day inside two would be counted twice and retired by one surgeon's status in either (9/23 review)
    list.slice(0, i).forEach(function (q, k) {
      var qs = q && (q.start !== undefined ? q.start : q.start_day), qe = q && (q.end !== undefined ? q.end : q.end_day);
      if (typeof qs === "string" && typeof qe === "string" && start <= qe && end >= qs) {
        impPeriodRefuse(path, row.label + " " + start + ".." + end + " overlaps offerPeriods[" + k + "] " + String(q.label || "").trim() + " " + qs + ".." + qe + " (periods never overlap)");
      }
    });
    return row;
  });
}

function impSourceRefuse(path, msg) { throw new Error("OFFER_SOURCE_INVALID: " + path + " - " + msg); }

// A dated list -> [{ day, role }]: a plain list is 'either', a role-keyed one its roles.
function impListDays(v) {
  var days = [];
  if (Array.isArray(v)) v.forEach(function (d) { days.push({ day: d, role: "either" }); });
  else if (v && typeof v === "object") {
    ["primary", "backup"].forEach(function (role) { (Array.isArray(v[role]) ? v[role] : []).forEach(function (d) { days.push({ day: d, role: role }); }); });
  }
  days.forEach(function (x) { impDayNum(x.day); });
  return days;
}

// surgeonRules[id].offerSources -> [{ path, listKey, month, source, tag, days: [{ day, role }] }] (validated;
// refuses with OFFER_SOURCE_INVALID). An optional rolePref on a tag overrides the list's reading for every day.
function impOfferSources(seed, id) {
  var r = ((seed && seed.surgeonRules) || {})[id] || {};
  var srcs = r.offerSources;
  if (srcs === undefined || srcs === null) return [];
  var base = "surgeonRules." + id + ".offerSources";
  if (typeof srcs !== "object" || Array.isArray(srcs)) impSourceRefuse(base, "must be an object keyed by list name");
  var out = [];
  var one = function (path, listKey, month, tagObj, days) {
    if (!tagObj || typeof tagObj !== "object" || Array.isArray(tagObj)) impSourceRefuse(path, "expected { source, tag }");
    var source = tagObj.source === undefined ? "email-relay" : tagObj.source;
    if (!IMP_OFFER_SOURCES[source]) impSourceRefuse(path + ".source", JSON.stringify(source) + " is not 'email-relay' or 'import'");
    if (typeof tagObj.tag !== "string" || !IMP_OFFER_TAG.test(tagObj.tag)) impSourceRefuse(path + ".tag", "needs a short operational tag like 'burchett-email-2026-09-17' (letters, digits, . _ -)");
    if (tagObj.rolePref !== undefined && !IMP_OFFER_ROLES[tagObj.rolePref]) impSourceRefuse(path + ".rolePref", JSON.stringify(tagObj.rolePref) + " is not primary / backup / either");
    if (tagObj.rolePref) days = days.map(function (x) { return { day: x.day, role: tagObj.rolePref }; });
    out.push({ path: path, listKey: listKey, month: month, source: source, tag: tagObj.tag, days: days });
  };
  Object.keys(srcs).forEach(function (listKey) {
    var path = base + "." + listKey;
    if (IMP_OFFER_LIST_KEYS.indexOf(listKey) < 0) impSourceRefuse(path, "unknown list - explicitAvailable, offeredDays or availableWeeks");
    if (listKey === "availableWeeks") {
      if (!Array.isArray(r.availableWeeks)) impSourceRefuse(path, "surgeonRules." + id + ".availableWeeks is not a list");
      var days = [];
      r.availableWeeks.forEach(function (m) { impDayNum(m); for (var k = 0; k < 7; k++) days.push({ day: impAddDays(m, k), role: "either" }); });
      one(path, listKey, null, srcs[listKey], days);
      return;
    }
    var byMonth = srcs[listKey];
    if (!byMonth || typeof byMonth !== "object" || Array.isArray(byMonth)) impSourceRefuse(path, "must be an object keyed by month");
    Object.keys(byMonth).sort().forEach(function (month) {
      var lst = r[listKey] && r[listKey][month];
      if (lst === undefined) impSourceRefuse(path + "." + month, "no such list under surgeonRules." + id + "." + listKey);
      one(path + "." + month, listKey, month, byMonth[month], impListDays(lst));
    });
  });
  return out;
}

// impSeedOffers(seed, { now | today }) -> { today, periods, offers, skips, warnings, status, covered }
//   offers   call_offers rows sorted by person then day (see the header)
//   skips    [{ person_id, day, role_pref, reason: 'vacation' }] - listed days inside the person's seed vacation
//   warnings tagged lists of a surgeon without a mode (not converted), one line per tag
//   status   [{ label, start, end, byPerson: { id: { status, mode, offered, primary, backup, either } } }]
//   covered  { id: [{ start, end }] } - the periods in which the surgeon is 'submitted' (drives the retirement of
//            his available rows and governed months there; independent of today, like SQL offer_status())
function impSeedOffers(seed, opts) {
  opts = opts || {};
  var today = opts.today || impCentralToday(opts.now);
  impDayNum(today);
  var periods = impSeedPeriods(seed);
  var roster = ((seed && seed.roster) || []).map(function (r) { return r.id; }).filter(Boolean);
  var sr = (seed && seed.surgeonRules) || {};
  var sources = {};
  roster.forEach(function (id) { sources[id] = impOfferSources(seed, id); });
  var vac = {};
  roster.forEach(function (id) { vac[id] = (((sr[id] || {}).timeOff) || []).map(function (t) { return [t.start, t.end || t.start]; }); });
  var onVacation = function (id, d) { return vac[id].some(function (v) { return d >= v[0] && d <= v[1]; }); };
  var offers = [], skips = [], warnings = [], status = [], covered = {}, seen = {};
  // 9/23 review: a surgeon WITH a mode in a period may not keep an untagged dated list that reaches into it - his
  // status would retire the list's rows and month while no offer carries the days (lost from both mechanisms, silently)
  var refuseUntagged = function (id, per) {
    var r = sr[id] || {};
    var tagged = {};
    sources[id].forEach(function (s) { tagged[s.listKey + "|" + (s.month || "")] = true; });
    var inPer = function (d) { return d >= per.start_day && d <= per.end_day; };
    var why = function (listPath, tagPath) {
      impSourceRefuse(listPath, "lies inside " + per.label + " (" + id + " has offer mode " + per.offer_modes[id] + " there) but carries no offerSources tag - tag it (" + tagPath + ") or move it out of the period");
    };
    ["explicitAvailable", "offeredDays"].forEach(function (listKey) {
      var byMonth = r[listKey];
      if (!byMonth || typeof byMonth !== "object") return;
      Object.keys(byMonth).sort().forEach(function (month) {
        if (tagged[listKey + "|" + month]) return;
        if (impListDays(byMonth[month]).some(function (x) { return inPer(x.day); })) why("surgeonRules." + id + "." + listKey + "." + month, "surgeonRules." + id + ".offerSources." + listKey + "." + month);
      });
    });
    if (Array.isArray(r.availableWeeks) && !tagged["availableWeeks|"]) {
      var reaches = r.availableWeeks.some(function (m) { impDayNum(m); for (var k = 0; k < 7; k++) if (inPer(impAddDays(m, k))) return true; return false; });
      if (reaches) why("surgeonRules." + id + ".availableWeeks", "surgeonRules." + id + ".offerSources.availableWeeks");
    }
  };
  periods.forEach(function (per) {
    var by = {};
    roster.forEach(function (id) {
      var mode = per.offer_modes[id] || null;
      if (mode) refuseUntagged(id, per);
      var listed = [];
      sources[id].forEach(function (src) {
        src.days.forEach(function (x) { if (x.day >= per.start_day && x.day <= per.end_day) listed.push({ day: x.day, role: x.role, src: src }); });
      });
      if (listed.length && !mode) {
        var tagged = {};
        listed.forEach(function (x) { tagged[x.src.path] = true; });
        Object.keys(tagged).forEach(function (p) { warnings.push(p + ": tagged but " + id + " has no offerModes entry for " + per.label + " - not converted (the list stays a dated availability list / a rule there)"); });
      }
      var submitted = !!(mode && listed.length);
      if (submitted) {
        (covered[id] = covered[id] || []).push({ start: per.start_day, end: per.end_day });
        listed.forEach(function (x) {
          if (x.day < today) return;                                        // OF001: never a past day
          if (onVacation(id, x.day)) {                                      // OF002: the trigger would refuse it
            if (!skips.some(function (s) { return s.person_id === id && s.day === x.day; })) skips.push({ person_id: id, day: x.day, role_pref: x.role, reason: "vacation" });
            return;
          }
          var key = id + "|" + x.day, row = seen[key];
          if (!row) { row = seen[key] = { person_id: id, day: x.day, role_pref: x.role, note: "seed: " + x.src.tag, entered_by: "scheduler", source: x.src.source }; offers.push(row); }
          else if (row.role_pref !== x.role) row.role_pref = "either";      // listed in both roles
        });
      }
      var counts = { primary: 0, backup: 0, either: 0 };
      offers.forEach(function (o) { if (o.person_id === id && o.day >= per.start_day && o.day <= per.end_day) counts[o.role_pref]++; });
      // 9/23 review: 'submitted' follows the whole list (the live rows keep counting past days for offer_status()), but a
      // plan with 0 rows for him would leave a fresh database reading not_started - say so in the dry run
      if (submitted && counts.primary + counts.backup + counts.either === 0) {
        warnings.push(id + ": submitted for " + per.label + " from listed days that are all past or inside a vacation - 0 rows planned; on a fresh database offer_status() reads not_started until a row exists (his available rows and governed months inside the period are still retired)");
      }
      by[id] = { status: submitted ? "submitted" : per.rules_only_ids.indexOf(id) >= 0 ? "rules_only" : "not_started", mode: mode || "preferred",
        offered: counts.primary + counts.backup + counts.either, primary: counts.primary, backup: counts.backup, either: counts.either };
    });
    status.push({ label: per.label, start: per.start_day, end: per.end_day, byPerson: by });
  });
  offers.sort(function (a, b) { return a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
  skips.sort(function (a, b) { return a.person_id < b.person_id ? -1 : a.person_id > b.person_id ? 1 : a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
  return { today: today, periods: periods, offers: offers, skips: skips, warnings: warnings, status: status, covered: covered };
}

// The periods in which each surgeon is submitted (no today needed) - the retirement map for rows and months.
function impOfferCoverage(seed, opts) {
  if (!(opts && opts.offerPeriods === true)) return {};
  return impSeedOffers(seed, { today: "2000-01-01" }).covered;
}
function impDayCovered(cov, id, day) { return !!(cov[id] && cov[id].some(function (p) { return day >= p.start && day <= p.end; })); }
function impMonthCovered(cov, id, month) {
  var first = month + "-01", last = impFromDayNum(impDayNum(impAddDays(first, 31).slice(0, 7) + "-01") - 1);
  return !!(cov[id] && cov[id].some(function (p) { return first <= p.end && last >= p.start; }));
}

// The offers-aware generate input a script builds from a plan: rules.buildContext({ ..., periods, offers }).
function impOffersInput(plan) {
  return { periods: (plan && plan.periodRows) || [], offers: (plan && plan.offerRows) || [] };
}

// Dated statements -> availability rows. opts.collapse (default true) merges
// consecutive dates into ranges; the seed adapter asks for one row per date.
//   explicitAvailable         { month: [dates] } -> available/any; { month: {primary:[],backup:[]} } -> role-scoped
//   explicitBackupOnly        -> backup_only/any
//   explicitUnavailable       -> unavailable/any
//   explicitBackupUnavailable -> no_backup/backup
// availableWeeks (Philip) and availableWindows (Sarkar) are NOT rows (see header).
// opts.offerPeriods (P5): no 'available' row for a submitted surgeon's day inside his period.
function impSeedAvailabilityRows(seed, opts) {
  opts = opts || {};
  var rows = [];
  var cov = impOfferCoverage(seed, opts);
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
  rows = rows.filter(function (r) { return !(r.kind === "available" && impDayCovered(cov, r.person_id, r.start_date)); }); // P5: his offers govern there
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
// opts.offerPeriods (P5): a month that overlaps a period in which the surgeon is submitted is not governed - its
// entry (seed or derived) is left out; his offers govern him there.
function impSeedSurgeonRules(seed, opts) {
  var sr = (seed && seed.surgeonRules) || {};
  var cov = impOfferCoverage(seed, opts);
  var out = {};
  Object.keys(sr).forEach(function (id) {
    var r = sr[id] || {};
    var retired = false;
    var list = (r.explicitListMonths || []).filter(function (e) {
      var m = typeof e === "string" ? e : (e && e.month);
      if (m && impMonthCovered(cov, id, m)) { retired = true; return false; }
      return true;
    });
    var have = {};
    list.forEach(function (e) { var m = typeof e === "string" ? e : (e && e.month); if (m) have[m] = true; });
    Object.keys(r.explicitAvailable || {}).sort().forEach(function (month) {
      if (have[month] || impMonthCovered(cov, id, month)) return;
      var v = r.explicitAvailable[month];
      if (Array.isArray(v)) list.push(month);
      else if (v && typeof v === "object") {
        var roles = ["primary", "backup"].filter(function (role) { return Array.isArray(v[role]) && v[role].length > 0; });
        if (roles.length === 2) list.push(month);
        else if (roles.length === 1) list.push({ month: month, roles: roles });
      }
    });
    if (list.length) out[id] = Object.assign({}, r, { explicitListMonths: list });
    else if (retired) { out[id] = Object.assign({}, r); delete out[id].explicitListMonths; }
    else out[id] = r;
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
// extras.offerPeriods === true (P5): the offers-aware world - period-aware rules and rows plus `periods` and
// `offers` from the seed's tagged lists (extras.now sets today; the caller's own periods / offers win). The default
// stays the pre-period ctx (test/rules.test.js and the regression build it).
function impSeedContextInput(seed, extras) {
  extras = Object.assign({}, extras || {});
  var on = extras.offerPeriods === true;
  var base = {
    roster: seed.roster,
    surgeonRules: impSeedSurgeonRules(seed, { offerPeriods: on }),
    groupRules: seed.groupRules,
    holidays: seed.holidays,
    timeOffRows: impSeedTimeOffRows(seed),
    availabilityRows: impSeedAvailabilityRows(seed, { collapse: false, offerPeriods: on }),
    schedule: impSeedSchedule(seed)
  };
  if (on) {
    var off = impSeedOffers(seed, { now: extras.now, today: extras.today });
    base.periods = off.periods;
    base.offers = off.offers;
  }
  delete extras.offerPeriods; delete extras.now; delete extras.today;
  return Object.assign(base, extras);
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
  var offersByPerson = {};
  (plan.offerRows || []).forEach(function (o) { offersByPerson[o.person_id] = (offersByPerson[o.person_id] || 0) + 1; });
  return {
    call_schedule_data: 1,
    availability: plan.availabilityRows.length,
    availabilityByKindRole: byKindRole,
    availabilityByPerson: byPerson,
    time_off: plan.timeOffRows.length,
    call_periods: (plan.periodRows || []).length,      // P5
    call_offers: (plan.offerRows || []).length,        // P5
    offersByPerson: offersByPerson,
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

// RF2 (9/23): settings keys an earlier importer wrote that no importer writes any more. The blob's settings merge
// is one level deep (live keys survive), so these are removed explicitly - the SQL subtracts them ('-' operator) in
// the SET and in the idempotency WHERE, planDiff reads a live blob still carrying one as settings=update, and the
// app's Apply deletes them from the merged settings.
var IMP_RETIRED_SETTINGS_KEYS = ["seedRevisions"];

// impRevisionSummary(_meta.revisions) -> { count, last }: how much of the seed's revision history reaches the
// anon-readable blob - the number of entries and the date prefix (YYYY-MM-DD) of the LAST one, never the wording.
function impRevisionSummary(revisions) {
  var list = Array.isArray(revisions) ? revisions : [];
  var last = list.length ? String(list[list.length - 1]) : "";
  var m = last.match(/^(\d{4}-\d{2}-\d{2})/);
  return { count: list.length, last: m ? m[1] : null };
}

// impBlobOwner(live) -> { hasRow, importerOwned, by, at }: who wrote call_schedule_data 'main' last. The CLI importer
// stamps updated_by 'seed'; the app stamps the person_id (autosave, in-app seed Apply - or null from a session without
// a profile). Anything but 'seed' on an existing row is app-written: a re-import would replace surgeonRules,
// groupRules, holidays and the pool roster rows wholesale and revert every Setup edit under them (RF2 guard).
function impBlobOwner(live) {
  var l = live && typeof live === "object" ? live : {};
  // An EMPTY data object is no row whatever updated_at says: sql/schema.sql seeds ('main', '{}') with updated_at
  // default now() and no updated_by, and the first --apply on a fresh install must not read that as app-written.
  var hasRow = !!(l.blob && typeof l.blob === "object" && Object.keys(l.blob).length);
  if (!hasRow) return { hasRow: false, importerOwned: false, by: null, at: null };
  var by = l.blobUpdatedBy === undefined || l.blobUpdatedBy === null || l.blobUpdatedBy === "" ? "(unknown)" : String(l.blobUpdatedBy);
  return { hasRow: true, importerOwned: by === "seed", by: by, at: l.blobUpdatedAt || null };
}

// RF2 review fix (9/23): the app-edited guard is CONTENT-based. impCoreHash(blob) = a stable hash of the seed-owned
// keys exactly as the importer writes them - the pool roster rows (type != external: outside surgeons live in the
// live roster alone), surgeonRules, groupRules, holidays - over canonical JSON (sorted keys, as jsonb stores them),
// two FNV-1a 32-bit lanes -> 16 hex chars. Pure JS on purpose: importer.js also runs in the browser (in-app Apply).
// importPlan stamps it into settings.seedCoreHash; the CLI hashes the LIVE blob's same keys and compares.
var IMP_CORE_KEYS = ["roster", "surgeonRules", "groupRules", "holidays"];
function impCoreOf(blob) {
  var b = blob && typeof blob === "object" ? blob : {};
  var out = {};
  IMP_CORE_KEYS.forEach(function (k) {
    var v = b[k];
    if (k === "roster") v = (Array.isArray(v) ? v : []).filter(function (r) { return !(r && r.type === "external"); });
    out[k] = v === undefined ? null : v;
  });
  return impClone(out);
}
function impCoreHash(blob) {
  var s = impCanon(impCoreOf(blob));
  var h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 16777619) >>> 0;
  }
  var hex = function (n) { return ("00000000" + n.toString(16)).slice(-8); };
  return hex(h1) + hex(h2);
}
// impBlobEditState(live) -> { hasRow, importerOwned, by, at, stamp, liveHash, basis, appEdited }: has the app changed
// a seed-owned key since the last import? updated_by alone cannot say - the autosave re-stamps the person_id on ANY
// state change (a day edit, a trade, a realtime adopt of a foreign write) - so with a stamp on the live row the
// verdict is liveHash !== stamp (basis 'seedCoreHash'); without one (a row written before this fix) it falls back to
// !importerOwned (basis 'updated_by'). The CLI refuses --apply only when appEdited AND the plan changes a core key.
function impBlobEditState(live) {
  var owner = impBlobOwner(live);
  var l = live && typeof live === "object" ? live : {};
  var st = owner.hasRow && l.blob && l.blob.settings && typeof l.blob.settings.seedCoreHash === "string" ? l.blob.settings.seedCoreHash : null;
  var liveHash = owner.hasRow ? impCoreHash(l.blob) : null;
  var basis = st ? "seedCoreHash" : "updated_by";
  var appEdited = !owner.hasRow ? false : (st ? liveHash !== st : !owner.importerOwned);
  return { hasRow: owner.hasRow, importerOwned: owner.importerOwned, by: owner.by, at: owner.at, stamp: st, liveHash: liveHash, basis: basis, appEdited: appEdited };
}

// importPlan(seed, { now, offerPeriods }) -> { blob, availabilityRows, timeOffRows, scheduleDayRows,
//                                infoDeltas, refusals, stats, offerPeriods: { enabled, today, seedPeriods } and,
//                                with offerPeriods: true, periodRows, offerRows, offerSkips, offerWarnings, offerStatus }
// Throws Error('CONTACT_DATA_REFUSED: ...') when roster[] or site carries contact data,
// 'OFFER_PERIOD_INVALID: ...' / 'OFFER_SOURCE_INVALID: ...' for a bad period / tag (validated whether or not the
// option is on: a bad seed is a bad seed).
function importPlan(seed, options) {
  options = options || {};
  if (!seed || typeof seed !== "object") throw new Error("importer: seed must be an object");
  impRefuseContactData(seed);
  var now = options.now || new Date().toISOString();
  var meta = seed._meta || {};
  var offersOn = options.offerPeriods === true;
  var seedPeriods = impSeedPeriods(seed);
  // 9/23 review: the periods, the tags and their consistency (an untagged in-period list of a surgeon with a mode) are
  // validated whether or not the option is on - a bad seed is a bad seed; the rows are attached only with the option
  var off = impSeedOffers(seed, { now: now });

  // surgeonRules go into the blob with derived explicitListMonths, vacations as
  // dates only (the blob is anon-readable; the seed's vacation wording stays in
  // the seed and the time_off rows say 'vacation (seed)'), and every note-like
  // key dropped - no category tokens (header: rule-note scrub, 12 AA).
  var rawRules = impClone(impSeedSurgeonRules(seed, { offerPeriods: offersOn }));
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
      seedRevisionCount: impRevisionSummary(meta.revisions).count,
      seedLastRevision: impRevisionSummary(meta.revisions).last
    }
  };
  blob.settings.seedCoreHash = impCoreHash(blob);   // RF2 review fix: the content stamp the CLI's app-edited guard compares against
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
    availabilityRows: impSeedAvailabilityRows(seed, { offerPeriods: offersOn }),
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
    },
    offerPeriods: { enabled: offersOn, seedPeriods: seedPeriods.length }
  };
  if (offersOn) {
    // P5: the period rows and the offers from the seed's tagged lists (header: offer periods)
    plan.offerPeriods.today = off.today;
    plan.periodRows = off.periods;
    plan.offerRows = off.offers;
    plan.offerSkips = off.skips;
    plan.offerWarnings = off.warnings;
    plan.offerStatus = off.status;
    plan.offerRows.forEach(function (o) {                              // the note reaches an authenticated-read table: still reason-free
      var m = (o.note || "").match(IMP_NOTE_DENYLIST);
      if (m) throw new Error("NOTE_DENYLIST: call_offers[" + o.person_id + " " + o.day + "].note (\"" + m[1] + "\") - a personal word in an offer tag; reword the seed and re-run");
    });
  }
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
    "         'availability',  (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.availability a),",
    "         'call_offers',   (select coalesce(jsonb_agg(to_jsonb(o) order by o.person_id, o.day), '[]'::jsonb) from public.call_offers o),",
    "         'call_periods',  (select coalesce(jsonb_agg(to_jsonb(p) order by p.start_day), '[]'::jsonb) from public.call_periods p)),",
    "       (select updated_at from public.call_schedule_data where id = 'main'),",
    "       'seed'",
    " where exists (select 1 from public.schedule_days)",
    "    or exists (select 1 from public.time_off)",
    "    or exists (select 1 from public.availability)",
    "    or exists (select 1 from public.call_offers)",
    "    or exists (select 1 from public.call_periods)",
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
  // RF2: the live settings minus the retired keys, then the seed's keys on top - same expression in the SET and in
  // the WHERE, so a live row that still carries a retired key is a change (the '||' merge alone would keep it forever).
  var liveSettings = "(coalesce(call_schedule_data.data -> 'settings', '{}'::jsonb)" +
    IMP_RETIRED_SETTINGS_KEYS.map(function (k) { return " - " + impSqlStr(k); }).join("") + ")";
  return [
    "-- 2. config blob: merge the imported keys into row 'main' (keys the app adds later are kept;",
    "--    outside surgeons added in Setup (roster rows of type \"external\") are kept beside the seed's roster;",
    "--    settings merge one level deeper, minus the retired settings key(s) " + IMP_RETIRED_SETTINGS_KEYS.join(", ") + ";",
    "--    a byte-identical re-run leaves the row untouched)",
    "insert into public.call_schedule_data (id, data, updated_by, updated_at)",
    "values ('main', " + impSqlJson(blob) + ", 'seed', now())",
    "on conflict (id) do update set",
    "  data = jsonb_set(" + coreExpr + ",",
    "                   '{settings}',",
    "                   " + liveSettings + " || " + impSqlJson(settings) + ", true),",
    "  updated_by = 'seed',",
    "  updated_at = now()",
    "where " + coreExpr,
    "        is distinct from (coalesce(call_schedule_data.data, '{}'::jsonb) - 'settings')",
    "   or " + liveSettings + " || " + impSqlJson(settingsStable),
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
// keptN (IB): how many plan days the caller kept out of the key list because the
// app owns them - said as a count, never as days (the SQL carries no statement for
// a kept day); such rows fail the ownership clause, so the delete never reaches them.
function impSqlStaleScheduleDays(rows, keptN) {
  // IB review: an empty key list is not valid SQL and an unlisted delete would be wipe-shaped, so when every plan day
  // is kept no stale delete is emitted at all - planDiff reports the stale seed-owned days as KEPT in that case (agree).
  if (!rows.length) {
    return keptN
      ? "-- 3a. schedule_days: every plan day is app-owned (" + keptN + " kept) - no stale delete emitted: the SQL writes no schedule_days statement, seed-owned live days left alone (no wipe)\n"
      : "-- 3a. schedule_days: plan has no rows - seed-owned live days left alone (no wipe)\n";
  }
  return [
    "-- 3a. schedule_days: drop seed-owned days (source 'import', updated_by 'seed') the seed no longer lists;",
    "--     days the app has touched since (any other source / updated_by) are never deleted" +
      (keptN ? "\n--     (" + keptN + " app-edited day(s) kept out of this key list: they are app-owned, so the ownership clause above never matches them)" : ""),
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

/* ---- offer periods (P5): call_periods upsert, seed-owned call_offers delete + upsert */

// The seed owns label / dates / rules_only_ids and its own offer_modes keys; a re-import never rewrites status (the
// app's lifecycle) and keeps app-set modes for other people (live || seed: the seed's keys win).
function impSqlPeriods(rows) {
  if (!rows || !rows.length) return "-- 6. call_periods: nothing to import\n";
  var values = rows.map(function (r) {
    return "  (" + [impSqlStr(r.label), impSqlStr(r.start_day) + "::date", impSqlStr(r.end_day) + "::date", impSqlStr(r.offers_close_at) + "::date",
      impSqlStr(r.publish_by) + "::date", impSqlStr(r.status || "upcoming"), impSqlJson(r.rules_only_ids || []), impSqlJson(r.offer_modes || {}), impSqlStr(r.created_by || "seed")].join(", ") + ")";
  });
  return [
    "-- 6. call_periods: upsert by start_day (call_periods_start_idx); the seed owns label, dates, rules_only_ids and its",
    "--    offer_modes keys (merged: app-set modes for other people stay); status is written on insert only (the app owns it)",
    "insert into public.call_periods (label, start_day, end_day, offers_close_at, publish_by, status, rules_only_ids, offer_modes, created_by)",
    "values",
    values.join(",\n"),
    "on conflict (start_day) do update set",
    "  label           = excluded.label,",
    "  end_day         = excluded.end_day,",
    "  offers_close_at = excluded.offers_close_at,",
    "  publish_by      = excluded.publish_by,",
    "  rules_only_ids  = excluded.rules_only_ids,",
    "  offer_modes     = coalesce(call_periods.offer_modes, '{}'::jsonb) || excluded.offer_modes,",
    "  updated_at      = now()",
    "where (call_periods.label, call_periods.end_day, call_periods.offers_close_at, call_periods.publish_by, call_periods.rules_only_ids, coalesce(call_periods.offer_modes, '{}'::jsonb) || excluded.offer_modes)",
    "      is distinct from",
    "      (excluded.label, excluded.end_day, excluded.offers_close_at, excluded.publish_by, excluded.rules_only_ids, coalesce(call_periods.offer_modes, '{}'::jsonb));",
    ""
  ].join("\n");
}

// Seed ownership of an offer row = source email-relay / import + entered_by scheduler + note 'seed: ...' (the same
// provenance convention as schedule_days); offers entered or relayed in the app never match. Deletes are set-based
// against the plan's keys and cover days on/after today only (past rows are the record; a past day cannot be
// re-inserted either, OF001). Skipped when the plan has no offers (an empty seed cannot wipe the table).
var IMP_OFFER_OWNED = "source in ('email-relay', 'import') and entered_by = 'scheduler' and note like 'seed: %'";
function impSqlStaleOffers(rows, today) {
  if (!rows || !rows.length) return "-- 7a. call_offers: plan has no rows - seed-owned live rows left alone (no wipe)\n";
  return [
    "-- 7a. call_offers: drop seed-owned offers (" + IMP_OFFER_OWNED + ") for days on/after today that the seed",
    "--     no longer lists; past rows stay (the record); offers entered or relayed in the app keep their own note and stay",
    "delete from public.call_offers",
    " where " + IMP_OFFER_OWNED,
    "   and day >= " + impSqlStr(today) + "::date",
    "   and (person_id, day) not in (",
    "  " + rows.map(function (r) { return "(" + impSqlStr(r.person_id) + ", " + impSqlStr(r.day) + "::date)"; }).join(",\n  "),
    "   );",
    ""
  ].join("\n");
}

function impSqlOffers(rows) {
  if (!rows || !rows.length) return "-- 7. call_offers: nothing to import\n";
  var values = rows.map(function (r) {
    return "  (" + [impSqlStr(r.person_id), impSqlStr(r.day) + "::date", impSqlStr(r.role_pref), impSqlStr(r.note), impSqlStr(r.entered_by || "scheduler"), impSqlStr(r.source || "email-relay")].join(", ") + ")";
  });
  return [
    "-- 7. call_offers: one row per person and day (unique (person_id, day)). The insert proposes only rows that would change -",
    "--    a new (person_id, day), or a seed-owned row whose role / note / source differ - because a row-level BEFORE INSERT",
    "--    trigger runs for EVERY proposed row before the conflict check: a re-run of identical data proposes nothing and fires",
    "--    no trigger, an app-entered offer for the same day is never proposed (the surgeon's row stays; the DO UPDATE guard says",
    "--    the same). Every proposed row is judged by the guard (OF001 past, OF002 vacation, OF003 frozen - this session is not",
    "--    the scheduler: a changed or new seed-owned offer after offers_close_at fails loudly and rolls the import back; the",
    "--    scheduler enters late offers in the app)",
    "insert into public.call_offers (person_id, day, role_pref, note, entered_by, source)",
    "select v.person_id, v.day, v.role_pref, v.note, v.entered_by, v.source",
    "from (values",
    values.join(",\n"),
    ") as v(person_id, day, role_pref, note, entered_by, source)",
    "where not exists (",
    "  select 1 from public.call_offers o",
    "   where o.person_id = v.person_id and o.day = v.day",
    "     and (not (o." + IMP_OFFER_OWNED.replace(/ and /g, " and o.") + ")",
    "          or (o.role_pref, o.note, o.source) is not distinct from (v.role_pref, v.note, v.source)))",
    "on conflict (person_id, day) do update set",
    "  role_pref  = excluded.role_pref,",
    "  note       = excluded.note,",
    "  entered_by = excluded.entered_by,",
    "  source     = excluded.source,",
    "  updated_at = now()",
    "where call_offers.source in ('email-relay', 'import') and call_offers.entered_by = 'scheduler' and call_offers.note like 'seed: %'",
    "  and (call_offers.role_pref, call_offers.note, call_offers.source) is distinct from (excluded.role_pref, excluded.note, excluded.source);",
    ""
  ].join("\n");
}

// importSql(plan, options) -> string. One transaction: snapshot, blob merge, then per
// table: stale seed-owned rows deleted, then insert/update. Idempotent: every
// insert carries ON CONFLICT or WHERE NOT EXISTS, every update is guarded by
// IS DISTINCT FROM, every delete is set-based against the plan's keys.
// P5: with plan.offerPeriods.enabled the call_periods upsert and the call_offers
// delete + upsert follow time_off (OF002 reads it), and the returning select
// carries the two tables' rows (call_offers_rows / call_periods_rows) so the
// CLI can verify them - they are not anon-readable.
// Prompt 12 B: ' (N awaiting confirmation)' after the schedule_days count in the
// SQL header when any planned row carries the marker; empty otherwise so
// unflagged seeds keep their header byte for byte.
// IB (9/23 overnight): options.excludeDays = ISO days kept out of the schedule_days
// statements altogether - the app-edited days planDiff reports as blockedDays, which
// the CLI's --apply keeps exactly as the app's Apply keeps them. A kept day is neither
// inserted/updated nor listed in the stale delete's key set (and it is app-owned, so
// that delete's ownership clause never matches it either); the header says how many
// were kept. No option, an empty list or days the plan lacks -> byte-identical output.
// availability / time_off are untouched by the option.
function impAwaitingHeader(plan) {
  var n = (plan.scheduleDayRows || []).filter(function (d) { return typeof d.note === "string" && d.note.indexOf(IMP_AWAITING_MARKER) === 0; }).length;
  return n ? " (" + n + " awaiting confirmation)" : "";
}

function importSql(plan, options) {
  if (!plan || !plan.blob) throw new Error("importer: importSql needs a plan from importPlan()");
  var offersOn = !!(plan.offerPeriods && plan.offerPeriods.enabled);
  var exclude = {};
  ((options && options.excludeDays) || []).forEach(function (d) { exclude[String(d).slice(0, 10)] = true; });
  var sdRows = plan.scheduleDayRows.filter(function (r) { return !exclude[r.day]; });
  var keptN = plan.scheduleDayRows.length - sdRows.length;
  var head = [
    "-- Silvis seed import - generated " + (plan.generatedAt || new Date().toISOString()) + " by importer.js",
    "-- seed generatedOn " + ((plan.blob.settings && plan.blob.settings.seedGeneratedOn) || "?") +
      "; " + sdRows.length + " schedule_days" + impAwaitingHeader({ scheduleDayRows: sdRows }) + (keptN ? " (" + keptN + " app-edited day(s) kept, not written)" : "") +
      ", " + plan.availabilityRows.length + " availability, " + plan.timeOffRows.length + " time_off rows" +
      (offersOn ? "; " + (plan.periodRows || []).length + " call_periods, " + (plan.offerRows || []).length + " call_offers rows (offer periods; today " + plan.offerPeriods.today + " Central)" : ""),
    "-- Idempotent: safe to run again; a re-run of identical data changes nothing.",
    "begin;",
    ""
  ].join("\n");
  var tailCols = [
    "select (select count(*) from public.schedule_days)  as schedule_days,",
    "       (select count(*) from public.availability)   as availability,",
    "       (select count(*) from public.time_off)       as time_off,"
  ];
  if (offersOn) {
    tailCols.push("       (select count(*) from public.call_offers)    as call_offers,");
    tailCols.push("       (select count(*) from public.call_periods)   as call_periods,");
  }
  tailCols.push("       (select count(*) from public.call_schedule_snapshots) as snapshots,");
  if (offersOn) {
    tailCols.push("       (select data -> 'settings' ->> 'importedAt' from public.call_schedule_data where id = 'main') as imported_at,");
    tailCols.push("       (select coalesce(jsonb_agg(jsonb_build_object('person_id', o.person_id, 'day', o.day, 'role_pref', o.role_pref, 'note', o.note, 'entered_by', o.entered_by, 'source', o.source) order by o.person_id, o.day), '[]'::jsonb) from public.call_offers o) as call_offers_rows,");
    tailCols.push("       (select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'start_day', p.start_day, 'end_day', p.end_day, 'offers_close_at', p.offers_close_at, 'publish_by', p.publish_by, 'status', p.status, 'rules_only_ids', p.rules_only_ids, 'offer_modes', p.offer_modes) order by p.start_day), '[]'::jsonb) from public.call_periods p) as call_periods_rows;");
  } else {
    tailCols.push("       (select data -> 'settings' ->> 'importedAt' from public.call_schedule_data where id = 'main') as imported_at;");
  }
  var tail = ["commit;"].concat(tailCols, [""]).join("\n");
  var offersSql = offersOn ? impSqlPeriods(plan.periodRows) + "\n" + impSqlStaleOffers(plan.offerRows, plan.offerPeriods.today) + "\n" + impSqlOffers(plan.offerRows) + "\n" : "";
  return head + impSqlSnapshot() + "\n" + impSqlBlob(plan.blob) + "\n" +
    impSqlStaleScheduleDays(sdRows, keptN) + "\n" + impSqlScheduleDays(sdRows) + "\n" +
    impSqlStaleAvailability(plan.availabilityRows) + "\n" + impSqlAvailability(plan.availabilityRows) + "\n" +
    impSqlStaleTimeOff(plan.timeOffRows) + "\n" + impSqlTimeOff(plan.timeOffRows) + "\n" + offersSql + tail;
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

// impSdState(live row | undefined, plan row) -> 'insert' | 'unchanged' | 'blocked' | 'update': the one place that decides
// a plan day's state (planDiff's two loops share it). 'blocked' = the app owns the live row - app-edited (source) or
// app-filled (updated_by; a NULL updated_by reads as 'seed' here, matching the SQL guard's coalesce) - never overwritten.
function impSdState(l, r) {
  if (!l) return "insert";
  if (impDaySame(l, r)) return "unchanged";
  if (l.source !== "import" || (l.updated_by || "seed") !== "seed") return "blocked";
  return "update";
}

// planDiff(plan, live) -> { text, lines, tables, changes, blocked, blockedDays, kept, totalChanges, totalDeletes }
// live = { blob, availability[], time_off[], schedule_days[] } as fetched by the caller.
// blocked = one line per differing SLOT of an app-owned plan day (what the dry run prints); blockedDays = those DAYS
// (ISO, sorted, deduped) - IB (9/23 overnight): the CLI hands them to importSql({ excludeDays }) so --apply keeps them
// exactly as the app's Apply does, instead of refusing.
function planDiff(plan, live) {
  live = live || {};
  var names = {};
  (plan.blob.roster || []).forEach(function (r) { names[r.id] = r.name || r.code || r.id; });
  var tables = {};
  var lines = [];
  var changes = [];
  var blocked = [];
  var blockedDaySet = {};

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
      // settings are merged, so compare only the keys the seed sets - plus any RETIRED key the live row still
      // carries (RF2: the SQL removes it, so its presence is a change the dry run must show)
      if (theirs) { var sub = {}; Object.keys(mine).forEach(function (kk) { sub[kk] = theirs[kk]; }); IMP_RETIRED_SETTINGS_KEYS.forEach(function (kk) { if (kk in theirs) sub[kk] = theirs[kk]; }); theirs = sub; }
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
  // IB review: when EVERY plan day is app-owned, importSql (excludeDays = the blocked days) writes no schedule_days
  // statement at all - no stale delete either (an empty NOT IN list is not valid SQL, an unlisted delete would be
  // wipe-shaped) - so the stale seed-owned days are reported KEPT here, never promised as deletes the SQL cannot carry.
  var allPlanBlocked = plan.scheduleDayRows.length > 0 && plan.scheduleDayRows.every(function (r) { return impSdState(liveSd[r.day], r) === "blocked"; });
  (live.schedule_days || []).forEach(function (r) {
    var day = String(r.day).slice(0, 10);
    if (r.source !== "import" || (r.updated_by || "") !== "seed" || planSd[day]) return;
    var label = impShortDay(day) + " P " + impSlotLabel(names, r.primary_id, r.external_cover) + " / B " + impSlotLabel(names, r.backup_id, null);
    if (!plan.scheduleDayRows.length) { sdT.kept++; stale.push("schedule_days " + label + " [KEPT: plan has no schedule_days rows, seed-owned day not deleted]"); return; }
    if (allPlanBlocked) { sdT.kept++; stale.push("schedule_days " + label + " [KEPT: every plan day is app-owned (kept), so the SQL writes no schedule_days statement - seed-owned day not deleted]"); return; }
    sdT.delete++;
    var m = day.slice(0, 7);
    var bm = sdT.byMonth[m] || (sdT.byMonth[m] = { insert: 0, update: 0, unchanged: 0, blocked: 0, delete: 0 });
    bm.delete++;
    changes.push(label + " -> deleted (seed-owned day no longer in the seed)");
  });
  plan.scheduleDayRows.forEach(function (r) {
    var l = liveSd[r.day];
    var state = impSdState(l, r);
    sdT[state]++;
    if (state === "blocked") blockedDaySet[r.day] = true;   // IB: the DAY list the CLI keeps out of the SQL (the line list below stays per slot)
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

  // Offer periods (P5). Both tables are authenticated-read: a caller that could not read them passes null /
  // undefined and every planned row reads as an 'upsert' (counted, so the apply is never skipped as nothing to do);
  // a caller with the rows (the CLI after the apply, from the SQL's returning select) gets the exact diff.
  var offersOn = !!(plan.offerPeriods && plan.offerPeriods.enabled);
  var offerLines = [], blockedOffers = [];
  var perT = null, ofT = null;
  if (offersOn) {
    var today = plan.offerPeriods.today || "";
    var perRows = plan.periodRows || [], ofRows = plan.offerRows || [];
    var dayOf = function (v) { return typeof v === "string" ? v.slice(0, 10) : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || "")); };
    var jsonish = function (v) { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return v; } };
    // call_periods
    perT = { insert: 0, update: 0, unchanged: 0, upsert: 0, unknown: !Array.isArray(live.call_periods), rows: [] };
    if (perT.unknown) {
      perT.upsert = perRows.length;
      offerLines.push("call_periods: plan " + perRows.length + " row(s) - live rows not readable with the anon key (authenticated-read table): upsert by start_day; verified from the SQL's returning rows after the apply");
    } else {
      var livePer = {};
      live.call_periods.forEach(function (r) { livePer[dayOf(r.start_day)] = r; });
      perRows.forEach(function (p) {
        var l = livePer[p.start_day];
        var state;
        if (!l) state = "insert";
        else {
          var mergedModes = Object.assign({}, jsonish(l.offer_modes) || {}, p.offer_modes || {});
          var mine = { label: p.label, end_day: p.end_day, offers_close_at: p.offers_close_at, publish_by: p.publish_by, rules_only_ids: p.rules_only_ids || [], offer_modes: mergedModes };
          var theirs = { label: l.label, end_day: dayOf(l.end_day), offers_close_at: dayOf(l.offers_close_at), publish_by: dayOf(l.publish_by), rules_only_ids: jsonish(l.rules_only_ids) || [], offer_modes: jsonish(l.offer_modes) || {} };
          state = impSame(mine, theirs) ? "unchanged" : "update";
        }
        perT[state]++;
        if (state !== "unchanged") perT.rows.push(state + " " + p.label + " " + p.start_day + ".." + p.end_day + " (close " + p.offers_close_at + ", publish by " + p.publish_by + ")");
      });
      offerLines.push("call_periods: insert " + perT.insert + ", update " + perT.update + ", unchanged " + perT.unchanged + " (a live period the seed lacks is never deleted)");
      perT.rows.forEach(function (t) { offerLines.push("  " + t); });
    }
    // call_offers
    ofT = { insert: 0, update: 0, unchanged: 0, delete: 0, kept: 0, blocked: 0, upsert: 0, unknown: !Array.isArray(live.call_offers), rows: [] };
    var owned = function (r) { return (r.source === "email-relay" || r.source === "import") && r.entered_by === "scheduler" && /^seed: /.test(r.note || ""); };
    var whoDay = function (r) { return (names[r.person_id] || r.person_id) + " " + dayOf(r.day) + " " + r.role_pref; };
    if (ofT.unknown) {
      ofT.upsert = ofRows.length;
      offerLines.push("call_offers: plan " + ofRows.length + " row(s) - live rows not readable with the anon key (authenticated-read table): every row is an upsert by (person_id, day), stale seed-owned rows for days on/after " + today + " are deleted set-based by the SQL; verified from the SQL's returning rows after the apply");
    } else {
      var liveOf = {};
      live.call_offers.forEach(function (r) { liveOf[r.person_id + "|" + dayOf(r.day)] = r; });
      var planOf = {};
      ofRows.forEach(function (r) {
        planOf[r.person_id + "|" + r.day] = true;
        var l = liveOf[r.person_id + "|" + r.day];
        var state;
        if (!l) state = "insert";
        else if (!owned(l)) state = "blocked";                         // the surgeon's own (or an in-app relayed) row wins, whatever it says
        else state = (l.role_pref === r.role_pref && (l.note || null) === (r.note || null) && l.source === r.source) ? "unchanged" : "update";
        ofT[state]++;
        if (state === "insert") ofT.rows.push("insert " + whoDay(r));
        else if (state === "update") ofT.rows.push("update " + (names[r.person_id] || r.person_id) + " " + r.day + " " + l.role_pref + " -> " + r.role_pref + (((l.note || null) !== (r.note || null)) ? " (note)" : ""));
        else if (state === "blocked") blocked.push((names[r.person_id] || r.person_id) + " " + r.day + " " + r.role_pref + " [BLOCKED: the surgeon's own offer (" + l.role_pref + ", source '" + l.source + "') stays]");
      });
      live.call_offers.forEach(function (r) {
        var key = r.person_id + "|" + dayOf(r.day);
        if (planOf[key]) return;
        if (!owned(r)) { ofT.kept++; stale.push("call_offers " + whoDay(r) + " [KEPT: entered in the app]"); return; }
        if (dayOf(r.day) < today) { ofT.kept++; stale.push("call_offers " + whoDay(r) + " [KEPT: before today]"); return; }
        if (!ofRows.length) { ofT.kept++; stale.push("call_offers " + whoDay(r) + " [KEPT: plan has no call_offers rows, seed-owned row not deleted]"); return; }
        ofT.delete++;
        ofT.rows.push("delete " + whoDay(r) + " (seed-owned, no longer in the seed)");
      });
      offerLines.push("call_offers: insert " + ofT.insert + ", update " + ofT.update + ", delete " + ofT.delete + ", unchanged " + ofT.unchanged + (ofT.kept ? ", kept " + ofT.kept : "") + (ofT.blocked ? ", BLOCKED " + ofT.blocked : ""));
      ofT.rows.forEach(function (t) { offerLines.push("  " + t); });
    }
    // live vacations are anon-readable: an offer inside one would be refused by OF002 and roll the whole import back
    (live.time_off || []).forEach(function (t) {
      var s = dayOf(t.start_date), e = dayOf(t.end_date);
      ofRows.forEach(function (r) {
        if (r.person_id !== t.person_id || r.day < s || r.day > e) return;
        var line = (names[r.person_id] || r.person_id) + " " + r.day + " " + r.role_pref + " [BLOCKED: inside a live vacation " + s + ".." + e + " - the DB would refuse the row (OF002); drop the day from the list or the vacation]";
        blockedOffers.push(line); blocked.push(line); ofT.blocked++;
      });
    });
    tables.call_periods = perT;
    tables.call_offers = ofT;
    // the status table (surgeon | status | mode | offered days), one block per period
    (plan.offerStatus || []).forEach(function (st) {
      offerLines.push("offers status (" + st.label + "): surgeon | status | mode | offered days");
      (plan.blob.roster || []).forEach(function (r) {
        var s = st.byPerson[r.id];
        if (!s) return;
        var mode = s.status === "submitted" ? s.mode : "-";
        var detail = s.offered ? " (" + s.primary + " P, " + s.backup + " B, " + s.either + " either)" : "";
        offerLines.push("  " + (r.name || r.id) + " | " + s.status + " | " + mode + " | " + s.offered + detail);
      });
    });
    (plan.offerSkips || []).forEach(function (s) { offerLines.push("  skipped " + (names[s.person_id] || s.person_id) + " " + s.day + " " + s.role_pref + " (" + s.reason + " - the DB would refuse it)"); });
    (plan.offerWarnings || []).forEach(function (w) { offerLines.push("  warning: " + w); });
  } else if (plan.offerPeriods && plan.offerPeriods.seedPeriods > 0) {
    offerLines.push("offer periods: the seed carries " + plan.offerPeriods.seedPeriods + " period(s) that this plan did NOT convert (built without offerPeriods: true - the CLI passes it; the in-app import converts nothing until part 3)");
  }

  var offerChanges = perT ? perT.insert + perT.update + perT.upsert : 0;
  var offerDeletes = ofT ? ofT.delete : 0;
  if (ofT) offerChanges += ofT.insert + ofT.update + ofT.upsert;
  var totalDeletes = avT.delete + toT.delete + sdT.delete + offerDeletes;
  var totalChanges = blobT.insert + blobT.update + avT.insert + avT.update + toT.insert + sdT.insert + sdT.update + totalDeletes + offerChanges;

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
  offerLines.forEach(function (t) { lines.push(t); });
  stale.forEach(function (t) { lines.push("  " + t); });
  lines.push(totalChanges === 0 && !blocked.length ? "No changes - the live tables already match the plan." :
    "Total changes: " + totalChanges + (totalDeletes ? " (incl. " + totalDeletes + " delete(s) of seed-owned rows)" : "") + (blocked.length ? " (+" + blocked.length + " blocked)" : ""));

  return { text: lines.join("\n"), lines: lines, tables: tables, changes: changes, blocked: blocked, blockedDays: Object.keys(blockedDaySet).sort(), blockedOffers: blockedOffers, kept: stale, totalChanges: totalChanges, totalDeletes: totalDeletes };
}

/* ------------------------------------------------------------- exports */

var impExports = {
  importPlan: importPlan,
  importSql: importSql,
  planDiff: planDiff,
  IMP_AWAITING_MARKER: IMP_AWAITING_MARKER,     // Prompt 12 B: the schedule_days note prefix the app's "confirm" badge reads
  IMP_RETIRED_SETTINGS_KEYS: IMP_RETIRED_SETTINGS_KEYS,   // RF2: settings keys the SQL / the app's Apply remove from the live blob
  impRevisionSummary: impRevisionSummary,       // RF2: _meta.revisions -> { count, last }
  impBlobOwner: impBlobOwner,                   // RF2: who wrote the blob last (information; the fallback of the guard below)
  impCoreHash: impCoreHash,                     // RF2 review fix: content stamp of the seed-owned blob keys (settings.seedCoreHash)
  impBlobEditState: impBlobEditState,           // RF2 review fix: has the app changed a seed-owned key since the last import? (the CLI guard)
  // seed -> shape helpers (test/seed-adapter.js delegates here)
  impSeedRoster: impSeedRoster,
  impMergeRoster: impMergeRoster,
  impSeedAvailabilityRows: impSeedAvailabilityRows,
  impSeedSurgeonRules: impSeedSurgeonRules,
  impSeedTimeOffRows: impSeedTimeOffRows,
  impSeedSchedule: impSeedSchedule,
  impSeedScheduleRows: impSeedScheduleRows,
  impSeedContextInput: impSeedContextInput,
  // Prompt 14 P5: offer periods
  impSeedPeriods: impSeedPeriods,
  impOfferSources: impOfferSources,
  impSeedOffers: impSeedOffers,
  impOffersInput: impOffersInput,
  impCentralToday: impCentralToday,
  impCollapseRanges: impCollapseRanges,
  impFindKeys: impFindKeys,
  impFindEmailValues: impFindEmailValues,
  impFindPhoneValues: impFindPhoneValues,
  impFindContactValues: impFindContactValues,
  impScrubRuleNotes: impScrubRuleNotes,
  impRefuseNoteDenylist: impRefuseNoteDenylist,
  impCanon: impCanon,
  // SQL literal helpers (Prompt 12 PUB, 9/23: scripts/publish-preview.js writes
  // its CAS batch with the same 7-bit-clean literals; exports only, no change)
  impSqlStr: impSqlStr,
  impSqlBool: impSqlBool,
  impSqlJson: impSqlJson
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = impExports;
}
if (typeof window !== "undefined") {
  window.SilvisImporter = impExports;
}
