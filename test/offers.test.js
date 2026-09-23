#!/usr/bin/env node
/*
 * Silvis Call Schedule - offer periods (Prompt 14 P2, 9/23).
 *
 *   A. helpers.js period maths: periodFor(day, periods), offerStatus(period, offers, person) mirroring SQL
 *      offer_status(), offerTimeline(period, groupRules.offerPeriods) - pure, DB-shaped rows in and out.
 *   B. parity: helpers.offerStatus and rules.buildContext derive the same status for the same rows
 *      (test/fixtures/offers-2026-11.json), and rules' mode default is 'preferred'.
 *   C. seed pins: groupRules.offerPeriods, weights.offerBonus / outsideOffers, reason-free notes.
 *   D. sql/migrations/2026-09-23-claim-offer.sql static pins: claim_open_slot() writes the call_offers row
 *      (on conflict -> 'either' when the roles differ), the guard bypass is transaction-local, grants
 *      re-stated, no contact data. Applied by the orchestrator AFTER feat/open-shifts lands - never here.
 *
 * Run: node test/offers.test.js   (exit code 1 on any failure)
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));
const R = require(path.join(ROOT, "rules.js"));
const SA = require("./seed-adapter.js");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "offers-2026-11.json"), "utf8"));

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); }
};
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

const PER = FIX.period; // 2026-11-02 .. 2027-01-03, rules_only s1 + s6, modes s2 exhaustive / s3 preferred
const OFFERS = FIX.offers;

/* ---------------- A. helpers period maths ---------------- */
console.log("\n[A] helpers: periodFor / offerStatus / offerTimeline");
check("periodFor: inside, both boundaries, outside, before, null day", () => {
  eq(H.periodFor("2026-12-15", [PER]).id, "p14-nov26-jan27");
  eq(H.periodFor("2026-11-02", [PER]).id, "p14-nov26-jan27", "start_day inclusive");
  eq(H.periodFor("2027-01-03", [PER]).id, "p14-nov26-jan27", "end_day inclusive (SQL between)");
  eq(H.periodFor("2027-01-04", [PER]), null);
  eq(H.periodFor("2026-11-01", [PER]), null);
  eq(H.periodFor(null, [PER]), null);
  eq(H.periodFor("2026-12-15", []), null);
  eq(H.periodFor("2026-12-15", null), null);
});
check("periodFor: a timestamp-shaped day is read by its date; the earliest period wins an overlap; start/end aliases accepted", () => {
  eq(H.periodFor("2026-12-15T00:00:00", [PER]).id, "p14-nov26-jan27");
  const later = { id: "p2", start_day: "2026-12-15", end_day: "2027-03-31" };
  eq(H.periodFor("2026-12-20", [later, PER]).id, "p14-nov26-jan27", "earliest start wins whatever the list order");
  eq(H.periodFor("2027-02-01", [later, PER]).id, "p2");
  eq(H.periodFor("2026-12-20", [{ id: "alias", start: "2026-12-01", end: "2026-12-31" }]).id, "alias");
  eq(H.periodFor("2026-12-20", [{ id: "bad" }, PER]).id, "p14-nov26-jan27", "a period without dates never matches");
});
check("offerStatus mirrors SQL offer_status(): submitted > rules_only > not_started", () => {
  eq(H.offerStatus(PER, OFFERS, "s2"), "submitted");
  eq(H.offerStatus(PER, OFFERS, "s3"), "submitted");
  eq(H.offerStatus(PER, OFFERS, "s1"), "rules_only", "listed, no offer");
  eq(H.offerStatus(PER, OFFERS, "s6"), "rules_only");
  eq(H.offerStatus(PER, OFFERS, "s4"), "not_started", "not listed, no offer");
  eq(H.offerStatus(PER, OFFERS, "s5"), "not_started");
  eq(H.offerStatus(PER, OFFERS.concat([{ person_id: "s6", day: "2026-11-17", role_pref: "primary" }]), "s6"), "submitted", "an offer inside the period beats the rules_only listing");
  eq(H.offerStatus(PER, OFFERS.concat([{ person_id: "s4", day: "2027-01-04", role_pref: "either" }]), "s4"), "not_started", "an offer outside the period does not count");
  eq(H.offerStatus(PER, OFFERS.concat([{ person_id: "s4", day: "2027-01-03", role_pref: "either" }]), "s4"), "submitted", "end_day inclusive");
  eq(H.offerStatus(PER, OFFERS.concat([{ person_id: "s4", day: "2026-11-02T00:00:00", role_pref: "either" }]), "s4"), "submitted", "start_day inclusive; timestamp-shaped day");
  eq(H.offerStatus(Object.assign({}, PER, { rules_only_ids: "[\"s4\"]" }), OFFERS, "s4"), "rules_only", "rules_only_ids as a JSON string (older callers)");
  eq(H.offerStatus(Object.assign({}, PER, { rules_only_ids: null }), OFFERS, "s1"), "not_started", "no list -> nobody is rules-only by listing");
  eq(H.offerStatus(PER, null, "s2"), "not_started", "no offers at all");
  eq(H.offerStatus(null, OFFERS, "s2"), null, "no period -> null (a day outside every period has no status)");
});
check("offerTimeline: the seed's groupRules.offerPeriods fill a new period from its start day", () => {
  const t = H.offerTimeline({ start_day: "2026-11-02" }, seed.groupRules.offerPeriods);
  eq(t, { start_day: "2026-11-02", end_day: "2027-01-31", length_months: 3, offers_close_at: "2026-09-21", publish_by: "2026-10-05", remind_on: ["2026-09-07", "2026-09-18"], presets: [3, 6] },
    "3 months from 11/2 ends 2027-01-31 (a Sunday); close = start - 6 weeks; publish = start - 4 weeks; reminders 14 and 3 days before the close");
});
check("offerTimeline: the 6-month preset, the Fri/Sat extension to Sunday, and per-period overrides win", () => {
  const six = H.offerTimeline({ start_day: "2026-11-02", length_months: 6 }, seed.groupRules.offerPeriods);
  eq([six.end_day, six.length_months], ["2027-05-02", 6], "6 months from 11/2: 2027-04-30 is a Friday -> extended to Sunday 5/2 (like the Generate presets)");
  const over = H.offerTimeline({ start_day: "2026-11-02", end_day: "2027-01-03", offers_close_at: "2026-10-02" }, seed.groupRules.offerPeriods);
  eq([over.end_day, over.offers_close_at, over.publish_by], ["2027-01-03", "2026-10-02", "2026-10-05"], "the first period: end and close set by hand stay, publish_by is filled");
  eq(H.offerTimeline({ start_day: "2027-02-01" }, seed.groupRules.offerPeriods).end_day, "2027-05-02", "3 months from 2/1/2027: 4/30 is a Friday -> Sunday 5/2");
  eq(H.offerTimeline({ start_day: "2027-05-03" }, seed.groupRules.offerPeriods).end_day, "2027-08-01", "3 months from 5/3/2027: 7/31 is a Saturday -> Sunday 8/1");
  eq(H.offerTimeline({ start_day: "2027-08-02" }, seed.groupRules.offerPeriods).end_day, "2027-10-31", "3 months from 8/2/2027: 10/31 is a Sunday -> stays");
  eq(H.offerTimeline({ start_day: "2027-01-04" }, seed.groupRules.offerPeriods).offers_close_at, "2026-11-23", "close date crosses the year boundary");
});
check("offerTimeline: absent rules fall back to the documented defaults (= the seed's values); a bad start returns null", () => {
  eq(H.offerTimeline({ start_day: "2026-11-02" }, null), H.offerTimeline({ start_day: "2026-11-02" }, seed.groupRules.offerPeriods), "defaults == seed");
  eq(H.offerTimeline({ start_day: "11/02/2026" }, seed.groupRules.offerPeriods), null);
  eq(H.offerTimeline(null, seed.groupRules.offerPeriods), null);
  eq(H.offerTimeline({ start_day: "2026-11-02", length_months: 0 }, seed.groupRules.offerPeriods).length_months, 3, "a non-positive length reads as the default");
});
check("PD (9/23): the seed's offerPeriods[0] is published (read-only for a surgeon) and offerNextPeriod lands on offerPeriods[1] = Feb 2027 - Apr 2027 (Faraz's freeze 12/21 / publish by 1/4 = the 3-month preset's arithmetic; the end 4/30 is his, the preset would say Sunday 5/2)", () => {
  const P = seed.offerPeriods;
  eq(P.length, 2);
  eq([P[0].label, P[0].status, P[0].start, P[0].end, P[0].offersCloseAt], ["Nov 2026 - Jan 2027", "published", "2026-11-02", "2027-01-03", "2026-10-02"]);
  eq([P[1].label, P[1].start, P[1].end, P[1].offersCloseAt, P[1].publishBy, P[1].status, P[1].rulesOnly, P[1].offerModes], ["Feb 2027 - Apr 2027", "2027-02-01", "2027-04-30", "2026-12-21", "2027-01-04", "upcoming", [], {}]);
  eq(H.offerPeriodOpen(P[0], "2026-09-23"), false, "published = frozen for a surgeon whatever the close date (the painter greys its days; OF003 in the database still reads offers_close_at only)");
  eq(H.offerPeriodOpen(P[1], "2026-09-23"), true);
  eq(H.offerNextPeriod(P, "2026-09-23").label, "Feb 2027 - Apr 2027", "the painter, My schedule and the Periods box speak to the second period");
  eq(H.offerNextPeriod(P, "2026-12-20").label, "Feb 2027 - Apr 2027", "the day before the freeze it is still open");
  eq(H.offerNextPeriod(P, "2026-12-21").label, "Nov 2026 - Jan 2027", "from the freeze (12/21) to 1/3 no period is open: the fallback is the earliest period still running - the published first one, read-only - until a third period exists or 1/3 passes (helpers.offerNextPeriod as documented; reported, not changed here)");
  eq(H.offerNextPeriod(P, "2027-01-04").label, "Feb 2027 - Apr 2027", "from 1/4 the frozen second period is the only one running");
  eq(H.offerNextPeriod([P[0]], "2026-09-23").label, "Nov 2026 - Jan 2027", "with the first period alone (today's live table) the painter falls back to it, read-only");
  const t3 = H.offerTimeline({ start_day: "2027-02-01", length_months: 3 }, seed.groupRules.offerPeriods);
  eq([t3.offers_close_at, t3.publish_by, t3.remind_on], ["2026-12-21", "2027-01-04", ["2026-12-07", "2026-12-18"]], "the preset's close / publish-by / reminder days for a 2/1 start");
  eq(t3.end_day, "2027-05-02", "the preset's end would be Sunday 5/2 (4/30 is a Friday) - the seed keeps Faraz's stated 4/30 (seed open question 17)");
  eq(H.offerTimeline(P[1], seed.groupRules.offerPeriods).remind_on, ["2026-12-07", "2026-12-18"], "the 9/29-style reminders now fall on 12/7 and 12/18");
});

/* ---------------- B. parity with rules.buildContext ---------------- */
console.log("\n[B] parity: helpers.offerStatus == rules' derived status");
const DERIVED = [{ weekMonday: "2026-11-09", surgeonId: "s5", silvisRole: "backup" }, { weekMonday: "2026-12-07", surgeonId: "s5", silvisRole: "primary" }];
const mk = (offers) => R.buildContext(SA.seedToContextInput(seed, { schedule: {}, eastDerived: DERIVED, eastFeedCoverage: { from: "2026-11-01", to: "2027-01-31" }, periods: [PER], offers: offers }));
check("every surgeon's status agrees on the fixture, with and without Philip's extra offer", () => {
  [OFFERS, OFFERS.concat([FIX.philipOpenSlotOffer])].forEach((offers) => {
    const ctx = mk(offers);
    eq(ctx.warnings, []);
    ["s1", "s2", "s3", "s4", "s5", "s6"].forEach((id) => eq(R.offerState(ctx, "2026-12-01", id).status, H.offerStatus(PER, offers, id), id));
  });
});
check("mode: offer_modes[id] or 'preferred'; the period row is echoed by offerState", () => {
  const ctx = mk(OFFERS);
  eq(["s1", "s2", "s3", "s4"].map((id) => R.offerState(ctx, "2026-12-01", id).mode), ["preferred", "exhaustive", "preferred", "preferred"]);
  const p = R.offerState(ctx, "2026-12-01", "s2").period;
  eq([p.key, p.label, p.start, p.end, p.status, p.closeAt, p.publishBy], ["p14-nov26-jan27", "Nov 2026 - Jan 2027", "2026-11-02", "2027-01-03", "closed", "2026-10-02", "2026-10-05"]);
  eq(H.periodFor("2026-12-01", [PER]).id, p.key, "helpers.periodFor and rules agree on the period");
});

/* ---------------- C. seed pins ---------------- */
console.log("\n[C] seed");
check("groupRules.offerPeriods = { lengthMonths 3, presets [3, 6], closeWeeksBeforeStart 6, publishWeeksBeforeStart 4, remindDaysBeforeClose [14, 3] }", () => {
  eq(seed.groupRules.offerPeriods, { lengthMonths: 3, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] });
  assert.ok(typeof seed.groupRules.offerPeriodsNote === "string" && seed.groupRules.offerPeriodsNote.length > 40, "offerPeriodsNote");
});
check("weights.offerBonus = 6, weights.outsideOffers = 6 (strong), offerBonusOverShare = 0, the engine defaults agree, the weights note names them", () => {
  eq([seed.groupRules.weights.offerBonus, seed.groupRules.weights.outsideOffers, seed.groupRules.weights.offerBonusOverShare], [6, 6, 0]);
  eq([R.defaultWeights().offerBonus, R.defaultWeights().outsideOffers, R.defaultWeights().offerBonusOverShare], [6, 6, 0]);
  assert.ok(/offerBonus \/ outsideOffers/.test(seed.groupRules.weights.note), "weights.note");
  assert.ok(/offerBonusOverShare/.test(seed.groupRules.weights.note), "weights.note names offerBonusOverShare (review 9/23: the bonus stops at the share)");
  assert.ok(/claim/.test(seed.groupRules.weights.note), "weights.note says outside-offers also rides on an exhaustive surgeon's claim result");
});
check("the new notes carry rules, no reasons (the importer's own denylist) and no contact data; the seed writes apostrophes literally", () => {
  // The real gate is importer.js: impScrubRuleNotes drops every note key before the blob is assembled and
  // impRefuseNoteDenylist walks every remaining string with IMP_NOTE_DENYLIST. That regex is not exported, so it is
  // read from the source here (a moved or renamed literal fails loudly instead of drifting to a private copy).
  const impSrc = fs.readFileSync(path.join(ROOT, "importer.js"), "utf8");
  const lit = impSrc.match(/^var IMP_NOTE_DENYLIST = \/(.*)\/([a-z]*);/m);
  assert.ok(lit, "importer.js no longer defines `var IMP_NOTE_DENYLIST = /.../i;` - re-point this check at the importer's gate");
  const DENY = new RegExp(lit[1], lit[2]);
  assert.ok(DENY.test("hosting the family"), "the denylist read from importer.js matches its own words");
  [seed.groupRules.offerPeriodsNote, seed.groupRules.weights.note, seed._meta.revisions[seed._meta.revisions.length - 1]].forEach((n) => {
    assert.ok(!DENY.test(n), "denylist word in: " + n.slice(0, 80));
    assert.ok(!/@|\d{3}[-.]\d{3}[-.]\d{4}/.test(n), "contact-like value");
  });
  assert.ok(/Prompt 14 P2/.test(seed._meta.revisions[seed._meta.revisions.length - 1]), "the last revision entry is P2's");
  const rawSeed = fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8");
  eq((rawSeed.match(/\\u0027/g) || []).length, 0, "the seed writes apostrophes as a literal ' like its other lines (the \\uXXXX rule is for non-ASCII)");
});

/* ---------------- D. claim-as-offer migration ---------------- */
console.log("\n[D] sql/migrations/2026-09-23-claim-offer.sql");
const MIG = path.join(ROOT, "sql", "migrations", "2026-09-23-claim-offer.sql");
check("the migration exists, is LF, and re-creates claim_open_slot() with the offer write", () => {
  assert.ok(fs.existsSync(MIG), "missing " + MIG);
  const s = fs.readFileSync(MIG, "utf8");
  assert.ok(!/\r/.test(s), "CRLF");
  assert.ok(/create or replace function public\.claim_open_slot\(p_day date, p_role text\) returns jsonb/.test(s), "claim_open_slot signature");
  assert.ok(/insert into public\.call_offers \(person_id, day, role_pref, note, entered_by, source\)/.test(s), "call_offers insert column list");
  assert.ok(/values \(me, p_day, p_role, null, me, 'app'\)/.test(s), "the claimer's own row: role_pref = the claimed role, entered_by = the person, source app, note null");
  assert.ok(/on conflict \(person_id, day\) do update/.test(s), "on conflict (person_id, day) do update");
  assert.ok(/case when public\.call_offers\.role_pref = excluded\.role_pref then public\.call_offers\.role_pref else 'either' end/.test(s), "an existing offer in the other role becomes 'either'; the same role stays");
  assert.ok(/set_config\('silvis\.claim_in_progress', 'on', true\)/.test(s), "transaction-local bypass flag for the freeze guard");
  assert.ok(/current_setting\('silvis\.claim_in_progress', true\), ''\) <> 'on'/.test(s), "call_offers_guard skips the freeze only while a claim is in progress");
  assert.ok(/CLAIM_VACATION/.test(s) && /CLAIM_PAST/.test(s) && /CLAIM_LOCKED/.test(s), "the base function's checks are carried over verbatim");
  assert.ok(/revoke all on function public\.claim_open_slot\(date, text\) from public, anon;/.test(s) && /grant execute on function public\.claim_open_slot\(date, text\) to authenticated;/.test(s), "grants re-stated");
  assert.ok(s.indexOf("insert into public.call_offers") > s.indexOf("update public.schedule_days") && s.indexOf("insert into public.call_offers") < s.indexOf("insert into public.audit_log"), "the offer row is written after the schedule write and before the audit row (same transaction)");
  const emails = (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter((e) => !/@example\.test$/.test(e));
  eq(emails, [], "email-like value in the migration");
});
check("review 9/23: a rules_only claimer keeps his status (no call_offers row), the audit row says whether an offer was written", () => {
  const s = fs.readFileSync(MIG, "utf8");
  assert.ok(/wrote_offer\s+boolean\s*:=\s*false;/.test(s), "declare wrote_offer boolean := false");
  assert.ok(/if not exists \(select 1 from public\.call_periods p where p_day between p\.start_day and p\.end_day and p\.rules_only_ids \? me\) then/.test(s), "the upsert is skipped when the claimer is listed in rules_only_ids of the period containing p_day");
  assert.ok(/wrote_offer := true;/.test(s), "wrote_offer := true inside the branch");
  assert.ok(/'offer', wrote_offer\)/.test(s), "the schedule.claim audit detail carries offer = wrote_offer (true / false), never a constant");
  const guardIdx = s.indexOf("if not exists (select 1 from public.call_periods p where p_day between"), insIdx = s.indexOf("insert into public.call_offers");
  assert.ok(guardIdx > 0 && guardIdx < insIdx, "the rules_only check wraps the insert");
  assert.ok(s.indexOf("perform set_config('silvis.claim_in_progress', 'on', true);") > guardIdx, "the bypass flag is set inside the branch only");
});
check("review 9/23: the header records the base (feat/open-shifts commit + sha256 of the base function text), the applied-proof pointer and the pin re-pointing rule", () => {
  const s = fs.readFileSync(MIG, "utf8");
  const head = s.slice(0, s.search(/^create or replace function public\.claim_open_slot/m)); // the header itself quotes that line
  assert.ok(/feat\/open-shifts[^\n]*336210b/.test(head), "base commit 336210b named in the header");
  assert.ok(/d86735999738fabe93da4990e4e3bff72e646d66521525a9db73fd179c1cb453/.test(head), "sha256 of the base claim_open_slot text (create or replace ... end $$;, LF) recorded");
  assert.ok(/docs\/SCHEMA-REVIEW\.md/.test(head) && /2026-09-22 - claim_open_slot/.test(head), "the applied-proof pointer is docs/SCHEMA-REVIEW.md '2026-09-22 - claim_open_slot' (not the edge-functions README)");
  assert.ok(!/per that branch's README/.test(head), "the wrong README pointer is gone");
  assert.ok(/re-point/.test(head) && /test\/schema\.test\.js/.test(head), "the header says the schema.test.js pins must be re-pointed at this file in the same commit that mirrors the bodies");
  assert.ok(/refuse/i.test(head) && /differs/.test(head), "the header tells the orchestrator to refuse the apply when the landed claim_open_slot differs from the recorded base");
});

console.log("\noffers.test.js: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
