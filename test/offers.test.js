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
  // pin moved deliberately 9/27 (Faraz: yes to the six-week e-mail): the seed's reminders are [42, 14, 3], so remind_on gains 8/10
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed's lengthMonths is 6 (a new period's preset) and its
  // reminders are [14, 3] again - 6 months from 11/2 end Fri 4/30/2027 -> Sunday 5/2, and 8/10 (the 42-day e-mail) is gone
  eq(t, { start_day: "2026-11-02", end_day: "2027-05-02", length_months: 6, offers_close_at: "2026-09-21", publish_by: "2026-10-05", remind_on: ["2026-09-07", "2026-09-18"], presets: [3, 6] },
    "6 months from 11/2: 2027-04-30 is a Friday -> Sunday 5/2; close = start - 6 weeks; publish = start - 4 weeks; reminders 14 and 3 days before the close");
});
check("offerTimeline: the 6-month preset, the Fri/Sat extension to Sunday, and per-period overrides win", () => {
  const six = H.offerTimeline({ start_day: "2026-11-02", length_months: 6 }, seed.groupRules.offerPeriods);
  eq([six.end_day, six.length_months], ["2027-05-02", 6], "6 months from 11/2: 2027-04-30 is a Friday -> extended to Sunday 5/2 (like the Generate presets)");
  const over = H.offerTimeline({ start_day: "2026-11-02", end_day: "2027-01-03", offers_close_at: "2026-10-02" }, seed.groupRules.offerPeriods);
  eq([over.end_day, over.offers_close_at, over.publish_by], ["2027-01-03", "2026-10-02", "2026-10-05"], "the first period: end and close set by hand stay, publish_by is filled");
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed's lengthMonths is 6 now, so the three 3-month-preset
  // cases name length_months 3 explicitly (they are about the 3-month preset's Fri/Sat extension), and the seed's own 6-month
  // default gets its cases: the Jan - Jun row's end (a Wednesday), a Saturday and a Friday month end
  eq(H.offerTimeline({ start_day: "2027-02-01", length_months: 3 }, seed.groupRules.offerPeriods).end_day, "2027-05-02", "3 months from 2/1/2027: 4/30 is a Friday -> Sunday 5/2");
  eq(H.offerTimeline({ start_day: "2027-05-03", length_months: 3 }, seed.groupRules.offerPeriods).end_day, "2027-08-01", "3 months from 5/3/2027: 7/31 is a Saturday -> Sunday 8/1");
  eq(H.offerTimeline({ start_day: "2027-08-02", length_months: 3 }, seed.groupRules.offerPeriods).end_day, "2027-10-31", "3 months from 8/2/2027: 10/31 is a Sunday -> stays");
  eq(H.offerTimeline({ start_day: "2027-01-04" }, seed.groupRules.offerPeriods).end_day, "2027-06-30", "the seed's 6 months from 1/4/2027: 6/30 is a Wednesday -> stays (= the seed's Jan 2027 - Jun 2027 end)");
  eq(H.offerTimeline({ start_day: "2027-02-01" }, seed.groupRules.offerPeriods).end_day, "2027-08-01", "the seed's 6 months from 2/1/2027: 7/31 is a Saturday -> Sunday 8/1");
  eq(H.offerTimeline({ start_day: "2027-07-01" }, seed.groupRules.offerPeriods).end_day, "2028-01-02", "the seed's 6 months from 7/1/2027 (the day after Jan - Jun): 12/31/2027 is a Friday -> Sunday 1/2/2028");
  eq(H.offerTimeline({ start_day: "2027-01-04" }, seed.groupRules.offerPeriods).offers_close_at, "2026-11-23", "close date crosses the year boundary");
});
check("offerTimeline: absent rules fall back to the documented defaults (= the seed's values but the period length); a bad start returns null", () => {
  // pin moved deliberately 9/27: the seed's remindDaysBeforeClose is [42, 14, 3] (the six-week e-mail, set live as data)
  // while OP_PERIOD_DEFAULTS keeps [14, 3] - the literal the deployed daily-reminder mirror (OTM_DEFAULTS) carries, and
  // the cron reads the live blob's list anyway. Every other timeline key still equals the seed's.
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed's reminder list is [14, 3] again (= OP_PERIOD_DEFAULTS
  // = the mirror's OTM_DEFAULTS) and its lengthMonths is 6 while the code default stays 3 - so the one timeline difference is
  // now the period length (end_day / length_months); remind_on agrees again
  const byDefault = H.offerTimeline({ start_day: "2026-11-02" }, null), bySeed = H.offerTimeline({ start_day: "2026-11-02" }, seed.groupRules.offerPeriods);
  eq(Object.assign({}, byDefault, { end_day: null, length_months: null }), Object.assign({}, bySeed, { end_day: null, length_months: null }), "defaults == seed on every key but end_day / length_months (the notice keys are not timeline keys: they never reach offerTimeline's output)");
  eq([byDefault.end_day, byDefault.length_months, bySeed.end_day, bySeed.length_months], ["2027-01-31", 3, "2027-05-02", 6], "defaults: 3 months from 11/2 end Sunday 1/31/2027; the seed: 6 months end Sunday 5/2/2027 (Fri 4/30 extended)");
  eq([byDefault.remind_on, bySeed.remind_on], [["2026-09-07", "2026-09-18"], ["2026-09-07", "2026-09-18"]], "both remind 14 and 3 days before the close (the seed's 42 left with 9/30)");
  ["noticeDaysBeforeClose", "noticeUrgentDaysBeforeClose"].forEach((k) => assert.ok(!(k in bySeed) && !(k in H.OP_PERIOD_DEFAULTS), "offerTimeline's output and OP_PERIOD_DEFAULTS stay free of " + k + " (both are pinned against the edge mirror)"));
  eq(H.offerTimeline({ start_day: "11/02/2026" }, seed.groupRules.offerPeriods), null);
  eq(H.offerTimeline(null, seed.groupRules.offerPeriods), null);
  eq(H.offerTimeline({ start_day: "2026-11-02", length_months: 0 }, seed.groupRules.offerPeriods).length_months, 6, "a non-positive length reads as the rules' lengthMonths (the seed's 6 since 9/30)");
  eq(H.offerTimeline({ start_day: "2026-11-02", length_months: 0 }, null).length_months, 3, "...and without rules as OP_PERIOD_DEFAULTS' 3");
});
check("PD (9/23) / 9-24 / 9-30: the seed's offerPeriods[0] is published (read-only for a surgeon); offerNextPeriod lands on offerPeriods[1] = Jan 2027 - Jun 2027 (Faraz created it 9/24 as Jan 2027, 1/4 - 1/31; widened 9/30 to 1/4 - 6/30, freeze 11/23, publish by 12/7 kept = the 6-month preset's arithmetic); Feb 2027 - Apr 2027 is folded into it and gone from the seed", () => {
  const P = seed.offerPeriods;
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): three periods -> two - 'Jan 2027' (end 1/31) widened to
  // 'Jan 2027 - Jun 2027' (end 6/30; close, publish-by, rulesOnly and source kept) and 'Feb 2027 - Apr 2027' removed (folded in);
  // offerNextPeriod has no Feb - Apr to move on to after the 11/23 freeze, and the preset arithmetic is pinned on the Jan - Jun
  // row (the seed's 6-month preset from 1/4) instead of the removed row (the 3-month preset from 2/1)
  eq(P.length, 2, "the milestone period and Jan 2027 - Jun 2027 (Feb - Apr 2027 folded in 9/30)");
  eq([P[0].label, P[0].status, P[0].start, P[0].end, P[0].offersCloseAt], ["Nov 2026 - Jan 2027", "published", "2026-11-02", "2027-01-03", "2026-10-02"]);
  eq([P[1].label, P[1].start, P[1].end, P[1].offersCloseAt, P[1].publishBy, P[1].status, P[1].rulesOnly, P[1].offerModes, P[1].source], ["Jan 2027 - Jun 2027", "2027-01-04", "2027-06-30", "2026-11-23", "2026-12-07", "upcoming", ["s5"], {}, "faraz-2026-09-24-period-jan"], "9-24 / 9-27 / 9-30: the Jan 2027 row (created by Faraz 9/24; rulesOnly ['s5'] = Fierce's 'Go by my rules' choice of 2026-09-26 00:16:35Z, mirrored 9/27) widened to Jan 2027 - Jun 2027 (end 6/30; close / publish-by / rulesOnly / source kept)");
  eq(P.filter((p) => p.label === "Feb 2027 - Apr 2027" || p.start === "2027-02-01" || p.source === "faraz-2026-09-23-period-2").length, 0, "9-30: the seed no longer carries Feb - Apr 2027 (by label, start or source) - a later apply cannot bring it back");
  eq(H.offerPeriodOpen(P[0], "2026-09-23"), false, "published = frozen for a surgeon whatever the close date (the painter greys its days; OF003 in the database still reads offers_close_at only)");
  eq(H.offerPeriodOpen(P[1], "2026-09-24"), true, "the later period is open today");
  eq(H.offerNextPeriod(P, "2026-09-24").label, "Jan 2027 - Jun 2027", "the painter, My schedule and the Periods box speak to the earliest open period - Jan 2027 - Jun 2027");
  eq(H.offerNextPeriod(P, "2026-11-22").label, "Jan 2027 - Jun 2027", "the day before its freeze (11/23) Jan - Jun 2027 is still the one");
  eq(H.offerNextPeriod(P, "2026-11-23").label, "Nov 2026 - Jan 2027", "from the Jan - Jun freeze (11/23) to 1/3 no period is open: the fallback is the earliest period still running - the published first one, read-only (until 9/30 Feb - Apr 2027 was the open one here)");
  eq(H.offerNextPeriod(P, "2026-12-21").label, "Nov 2026 - Jan 2027", "...still on 12/21 (Feb - Apr's old freeze is no date any more)");
  eq(H.offerNextPeriod(P, "2027-01-04").label, "Jan 2027 - Jun 2027", "from 1/4 the frozen Jan - Jun 2027 period is the earliest one running (read-only)");
  eq(H.offerNextPeriod(P, "2027-02-01").label, "Jan 2027 - Jun 2027", "2/1/2027 (Feb - Apr's start until 9/30): Jan - Jun still runs");
  eq(H.offerNextPeriod(P, "2027-06-30").label, "Jan 2027 - Jun 2027", "...through its last day, 6/30/2027");
  eq(H.offerNextPeriod(P, "2027-07-01"), null, "from 7/1/2027 no period on file runs (the next one is not created yet)");
  eq(H.offerNextPeriod([P[0]], "2026-09-23").label, "Nov 2026 - Jan 2027", "with the first period alone (today's live table) the painter falls back to it, read-only");
  const t6 = H.offerTimeline({ start_day: "2027-01-04" }, seed.groupRules.offerPeriods);
  eq([t6.end_day, t6.length_months, t6.offers_close_at, t6.publish_by, t6.remind_on], ["2027-06-30", 6, "2026-11-23", "2026-12-07", ["2026-11-09", "2026-11-20"]], "the seed's 6-month preset from 1/4/2027: end Wed 6/30 (no extension), freeze 11/23, publish by 12/7, reminders 11/9 and 11/20");
  eq([P[1].end, P[1].offersCloseAt, P[1].publishBy], [t6.end_day, t6.offers_close_at, t6.publish_by], "the seed's Jan 2027 - Jun 2027 row matches the preset's arithmetic");
  eq(H.offerTimeline(P[1], seed.groupRules.offerPeriods).remind_on, ["2026-11-09", "2026-11-20"], "Jan 2027 - Jun 2027's reminders fall on 11/9 and 11/20 (close 11/23; the 42-day 10/12 e-mail left with 9/30)");
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
check("groupRules.offerPeriods = { lengthMonths 6, presets [3, 6], closeWeeksBeforeStart 6, publishWeeksBeforeStart 4, remindDaysBeforeClose [14, 3], noticeDaysBeforeClose 14, noticeUrgentDaysBeforeClose 14 }", () => {
  // 9/27 (offer deadline notice): noticeDaysBeforeClose 42 joined the block - the in-app notice starts six weeks before the freeze.
  // 9/27 ship (Faraz: keep 42, yes to the six-week e-mail) - pin moved deliberately: remindDaysBeforeClose [14, 3] -> [42, 14, 3]
  // and noticeUrgentDaysBeforeClose 14 (the notice's urgent window, its own key since the reminder list now starts at 42)
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed mirrors the live values Cowork set in Setup on 10/1 -
  // lengthMonths 3 -> 6, remindDaysBeforeClose [42, 14, 3] -> [14, 3], noticeDaysBeforeClose 42 -> 14 (urgent 14 unchanged).
  // The code defaults are NOT changed (OP_PERIOD_DEFAULTS = the deployed daily-reminder mirror's OTM_DEFAULTS, and
  // OP_NOTICE_DEFAULTS); the keys where the seed and the code now differ are named exactly below
  eq(seed.groupRules.offerPeriods, { lengthMonths: 6, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3], noticeDaysBeforeClose: 14, noticeUrgentDaysBeforeClose: 14 });
  eq(H.OP_PERIOD_DEFAULTS, { lengthMonths: 3, presets: [3, 6], closeWeeksBeforeStart: 6, publishWeeksBeforeStart: 4, remindDaysBeforeClose: [14, 3] }, "the code's timeline defaults are unchanged (= the deployed mirror's OTM_DEFAULTS - edge-functions untouched, no redeploy)");
  eq(H.OP_NOTICE_DEFAULTS, { noticeDaysBeforeClose: 42, noticeUrgentDaysBeforeClose: 14 }, "the code's notice defaults are unchanged");
  const diffKeys = (a, b) => Object.keys(Object.assign({}, a, b)).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
  const { noticeDaysBeforeClose, noticeUrgentDaysBeforeClose, ...cronKeys } = seed.groupRules.offerPeriods;
  eq(diffKeys(cronKeys, H.OP_PERIOD_DEFAULTS), ["lengthMonths"], "seed vs OP_PERIOD_DEFAULTS: only lengthMonths differs (every other timeline key, the reminder list included, is equal)");
  eq([cronKeys.lengthMonths, H.OP_PERIOD_DEFAULTS.lengthMonths], [6, 3], "lengthMonths is data: the seed's 6 (a new period's preset; the live blob's since 10/1), the code's 3");
  eq([cronKeys.remindDaysBeforeClose, H.OP_PERIOD_DEFAULTS.remindDaysBeforeClose], [[14, 3], [14, 3]], "the reminder list: the seed's [14, 3] (the cron reads the live blob's) equals the mirrored default again");
  eq(diffKeys({ noticeDaysBeforeClose, noticeUrgentDaysBeforeClose }, H.OP_NOTICE_DEFAULTS), ["noticeDaysBeforeClose"], "seed vs OP_NOTICE_DEFAULTS: only noticeDaysBeforeClose differs");
  eq([noticeDaysBeforeClose, H.OP_NOTICE_DEFAULTS.noticeDaysBeforeClose, noticeUrgentDaysBeforeClose, H.OP_NOTICE_DEFAULTS.noticeUrgentDaysBeforeClose], [14, 42, 14, 14], "the notice window: the seed's 14 (it starts with the first e-mail), the code's 42; the urgent threshold 14 on both sides");
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
  assert.ok(seed._meta.revisions.some((r) => /Prompt 14 P2/.test(r)), "a revision entry is P2's (B10 9/23 appended later entries; the last one is scanned above)");
  const rawSeed = fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8");
  eq((rawSeed.match(/\\u0027/g) || []).length, 0, "the seed writes apostrophes as a literal ' like its other lines (the \\uXXXX rule is for non-ASCII)");
});

/* ---------------- E. offer deadline notices (9/27) ---------------- */
// Faraz 9/27: "add a 6 week warning for choosing shifts so that the new schedule can be produced at least 4-6 weeks
// before". Choices freeze 6 weeks before a period starts, the schedule is due 4 weeks before; the in-app notice starts
// noticeDaysBeforeClose (42) days before the freeze. helpers.offerDeadlineNotices (the surgeon's notice) and
// helpers.offerPeriodLeadWarnings (the scheduler's lines in Setup -> Periods) over the seed's periods.
// pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed now carries TWO periods (the published first one and
// Jan 2027 - Jun 2027, freeze 11/23) with noticeDaysBeforeClose 14 and remindDaysBeforeClose [14, 3]. The checks that read
// the seed say so; the behaviour the seed no longer exercises (several open periods at once, a 42-day window that is not
// urgent) runs on explicit inputs: GR927 = the seed's groupRules with the 9/27 values (noticeDaysBeforeClose 42,
// remindDaysBeforeClose [42, 14, 3]) and PRE_FOLD = the periods as the seed carried them until 9/30 (Jan 2027 1/4 - 1/31,
// rulesOnly s5; Feb 2027 - Apr 2027 2/1 - 5/2, freeze 12/21, publish by 1/4).
// Prompt 26 (Faraz 9/30, "vacations in, painting optional"): the notice is a heads-up for EVERY pool surgeon whatever his
// status (E1 / E3 / E3b / E4 moved deliberately); the freeze roll call and the heads-up e-mail words are E8 - E10.
console.log("\n[E] offer deadline notices: offerDeadlineNotices / offerPeriodLeadWarnings / offerFreezeRollcall / offerHeadsUpWords");
const SP = seed.offerPeriods.map((p, i) => ({ id: "p" + i, label: p.label, start_day: p.start, end_day: p.end, offers_close_at: p.offersCloseAt, publish_by: p.publishBy, status: p.status, rules_only_ids: (p.rulesOnly || []).slice() }));
const GR = seed.groupRules;
const GR927 = Object.assign({}, GR, { offerPeriods: Object.assign({}, GR.offerPeriods, { noticeDaysBeforeClose: 42, remindDaysBeforeClose: [42, 14, 3] }) });
const PRE_FOLD = [SP[0], Object.assign({}, SP[1], { label: "Jan 2027", end_day: "2027-01-31" }), { id: "p2", label: "Feb 2027 - Apr 2027", start_day: "2027-02-01", end_day: "2027-05-02", offers_close_at: "2026-12-21", publish_by: "2027-01-04", status: "upcoming", rules_only_ids: [] }];
const notices = (today, person, extra) => H.offerDeadlineNotices(Object.assign({ periods: SP, offers: [], personId: person, today, groupRules: GR }, extra || {}));
check("E1: nothing before the window opens; Jan 2027 - Jun 2027 (freeze 11/23) enters it exactly 14 days out (11/9), not 15 (11/8) - the seed's window since 9/30; with the 9/27 window 42 days out (10/12), not 43", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed's noticeDaysBeforeClose is 14 (was 42), so the window
  // opens 11/9 (was 10/12) - the same morning as the first e-mail; Jan 2027 is now Jan 2027 - Jun 2027. The 42-day boundary
  // stays pinned on GR927.
  eq(notices("2026-09-27", "s2"), [], "9/27: Jan - Jun 2027 is 57 days from its freeze - no notice yet");
  eq(notices("2026-10-12", "s2"), [], "10/12 (42 days out, the 9/27 window's first day): no notice since 9/30");
  eq(notices("2026-11-08", "s2"), [], "15 days out: outside");
  // pin moved deliberately 9/30 (Prompt 26): each notice row carries the person's offer status (the heads-up goes to every
  // status now) - s2 has nothing on file here, so status not_started; every other field is unchanged
  eq(notices("2026-11-09", "s2"), [{ periodId: "p1", label: "Jan 2027 - Jun 2027", closeAt: "2026-11-23", daysToClose: 14, startDay: "2027-01-04", publishBy: "2026-12-07", urgent: true, status: "not_started" }], "14 days out: inside (<=) - and already urgent (noticeUrgentDaysBeforeClose 14 = the window: the notice joins the Calendar on its first day)");
  eq(notices("2026-10-12", "s2", { groupRules: GR927 }), [{ periodId: "p1", label: "Jan 2027 - Jun 2027", closeAt: "2026-11-23", daysToClose: 42, startDay: "2027-01-04", publishBy: "2026-12-07", urgent: false, status: "not_started" }], "with the 9/27 window (42) the period enters it 42 days out (10/12), not urgent");
  eq(notices("2026-10-11", "s2", { groupRules: GR927 }), [], "...and not 43 days out (10/11)");
});
check("E2: several open periods at once - one notice each, earliest freeze first; the published first period never", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed has ONE upcoming period now, so the several-at-once
  // behaviour runs on PRE_FOLD (Jan 2027 + Feb - Apr 2027, as the seed carried them until 9/30) with the 9/27 window (42);
  // the seed itself gives one notice on 11/9
  const n = notices("2026-11-09", "s2", { periods: PRE_FOLD, groupRules: GR927 });
  eq(n.map(x => [x.periodId, x.daysToClose, x.urgent]), [["p1", 14, true], ["p2", 42, false]], "pre-fold, 11/9: Jan 2027 (14 days, urgent) and Feb - Apr 2027 (42 days)");
  eq(notices("2026-11-09", "s2", { periods: PRE_FOLD.slice().reverse(), groupRules: GR927 }).map(x => x.periodId), ["p1", "p2"], "sorted by freeze whatever the input order");
  eq(n.some(x => x.periodId === "p0"), false, "the published Nov - Jan period is not upcoming");
  eq(notices("2026-11-09", "s2").map(x => [x.periodId, x.label, x.daysToClose, x.urgent]), [["p1", "Jan 2027 - Jun 2027", 14, true]], "the seed since 9/30, 11/9: one notice - Jan 2027 - Jun 2027 (14 days, urgent); no Feb - Apr");
  eq(notices("2026-10-12", "s2", { groupRules: GR927 }).some(x => x.periodId === "p0"), false, "the seed's published first period never, whatever the window");
});
check("E3 (Prompt 26): rules_only and submitted people get the notice too - the row carries their status; an offer outside the period does not count", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): with Feb - Apr folded into Jan - Jun no second period is left
  // over for s5 or a submitter; Fierce's 'go by my rules' (rulesOnly s5) now covers January - June, and an offer in May 2027
  // (Feb - Apr's range until 9/30) counts for Jan - Jun. The pre-fold reading stays pinned on PRE_FOLD.
  // pin moved deliberately 9/30 (Prompt 26): Faraz 9/30 "requested vacation dates and painted dates in" - the heads-up goes to
  // EVERY pool surgeon whatever his status (vacations matter for everyone, painting is optional), so a rules_only or a
  // submitted surgeon now gets the same notice (was []); the status rides on the row. What counts as submitted is
  // offer_status()'s reading, unchanged.
  const st = (today, person, extra) => notices(today, person, extra).map(x => [x.periodId, x.status, x.daysToClose, x.urgent]);
  eq(st("2026-11-09", "s5"), [["p1", "rules_only", 14, true]], "s5 chose 'go by my rules' for Jan - Jun 2027 (rulesOnly) - he gets the heads-up, status rules_only");
  const sub = [{ person_id: "s2", day: "2027-01-10", role_pref: "either" }];
  eq(st("2026-11-09", "s2", { offers: sub }), [["p1", "submitted", 14, true]], "one offer inside Jan - Jun 2027 = submitted - and the heads-up still shows");
  eq(st("2026-11-09", "s2", { offers: [{ person_id: "s2", day: "2027-05-15", role_pref: "backup" }] }), [["p1", "submitted", 14, true]], "an offer on 5/15/2027 (inside Feb - Apr's old range) lies inside the widened period = submitted");
  eq(st("2026-11-09", "s2", { offers: [{ person_id: "s2", day: "2026-12-01", role_pref: "primary" }] }), [["p1", "not_started", 14, true]], "an offer outside the period (12/1, inside the published first one) changes nothing - not_started");
  eq(st("2026-11-09", "s2", { offers: [{ person_id: "s2", day: "2027-07-01", role_pref: "primary" }] }), [["p1", "not_started", 14, true]], "...nor one the day after it ends (7/1/2027)");
  eq(st("2026-11-09", "s3", { offers: sub }), [["p1", "not_started", 14, true]], "another person's offer changes nothing");
  eq(st("2026-11-09", "s5", { periods: PRE_FOLD, groupRules: GR927 }), [["p1", "rules_only", 14, true], ["p2", "not_started", 42, false]], "pre-fold (until 9/30) s5's rules-only choice covered Jan 2027 only - both periods notify, each with its own status");
  // the window and the urgency do not depend on the status: the three statuses side by side on the same day
  eq(["s2", "s5"].map(id => notices("2026-11-22", id, { offers: [{ person_id: "s2", day: "2027-02-01", role_pref: "primary" }] })[0]).map(x => [x.status, x.daysToClose, x.urgent]), [["submitted", 1, true], ["rules_only", 1, true]], "1 day out: submitted and rules_only both shown, urgent");
  eq(["s2", "s5", "s3"].map(id => notices("2026-11-08", id, { offers: sub })), [[], [], []], "15 days out: nobody, whatever the status (outside the seed's 14-day window)");
  eq(["s2", "s5", "s3"].map(id => notices("2026-11-23", id, { offers: sub })), [[], [], []], "the freeze day: nobody, whatever the status");
});
check("E3b (Prompt 26): the pool - poolIds (offerPoolIds of the roster) gates the person: a pool surgeon of any status is told, an outside surgeon / an inactive one / no person never; absent poolIds = the caller's check", () => {
  const roster = [{ id: "s1", active: true }, { id: "s2", active: true }, { id: "s5", active: true }, { id: "s6", active: false }, { id: "x1", active: true, type: "external" }];
  const pool = H.offerPoolIds(roster);
  eq(pool, ["s1", "s2", "s5"], "offerPoolIds: active, non-external");
  const withPool = (id, extra) => notices("2026-11-09", id, Object.assign({ poolIds: pool }, extra || {})).map(x => [x.periodId, x.status]);
  eq(withPool("s2"), [["p1", "not_started"]], "pool, not_started");
  eq(withPool("s5"), [["p1", "rules_only"]], "pool, rules_only");
  eq(withPool("s2", { offers: [{ person_id: "s2", day: "2027-03-01", role_pref: "backup" }] }), [["p1", "submitted"]], "pool, submitted");
  eq(withPool("x1"), [], "an outside surgeon (type external) is never told");
  eq(withPool("s6"), [], "an inactive roster entry is never told");
  eq(withPool(""), [], "no person (a viewer / the office / a follower has no roster link) - nothing");
  eq(notices("2026-11-09", "s2", { poolIds: [] }), [], "an empty pool tells nobody");
  eq(notices("2026-11-09", "x1").map(x => x.periodId), ["p1"], "absent poolIds: the helper does not judge the pool (the app always passes it - data-layer pin)");
});
check("E4: boundaries - the freeze day itself and after: no notice (frozen); the day before: 1 day, urgent; urgent = <= noticeUrgentDaysBeforeClose (14)", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): no Feb - Apr period remains after the Jan - Jun freeze, and the
  // seed's window is 14 = the urgent threshold, so 15 days out has no notice at all - the 'not urgent at 15 days' line and the
  // 'urgent threshold is data' line run on GR927 (window 42)
  eq(notices("2026-11-23", "s2"), [], "11/23 = Jan - Jun 2027's freeze: closed to surgeons, no notice (and no later period on file)");
  // pin moved deliberately 9/30 (Prompt 26): the row carries the status (not_started here) - the boundary itself is unchanged
  eq(notices("2026-11-22", "s2")[0], { periodId: "p1", label: "Jan 2027 - Jun 2027", closeAt: "2026-11-23", daysToClose: 1, startDay: "2027-01-04", publishBy: "2026-12-07", urgent: true, status: "not_started" });
  eq(notices("2026-11-08", "s2"), [], "15 days out: no notice (outside the seed's 14-day window)");
  eq(notices("2026-11-08", "s2", { groupRules: GR927 })[0].urgent, false, "15 days out with the 9/27 window: shown, not urgent (noticeUrgentDaysBeforeClose 14)");
  eq(notices("2026-11-09", "s2")[0].urgent, true, "14 days out: urgent");
  const g = Object.assign({}, GR927, { offerPeriods: Object.assign({}, GR927.offerPeriods, { noticeUrgentDaysBeforeClose: 21 }) });
  eq(notices("2026-11-02", "s2", { groupRules: g })[0].urgent, true, "the urgent threshold follows the data (21 days)");
  eq(notices("2026-11-01", "s2", { groupRules: g })[0].urgent, false, "...22 days out: not urgent");
  eq(notices("2026-11-09", "s2", { periods: SP.map(p => p.id === "p1" ? Object.assign({}, p, { status: "closed" }) : p) }), [], "a period closed early (Close now) is out");
});
check("E5: noticeDaysBeforeClose is data - a missing key reads 42, another value moves the window, 0 turns the notice off; junk inputs answer []", () => {
  const without = (v) => { const op = Object.assign({}, GR.offerPeriods); if (v === undefined) delete op.noticeDaysBeforeClose; else op.noticeDaysBeforeClose = v; return Object.assign({}, GR, { offerPeriods: op }); };
  eq(notices("2026-10-12", "s2", { groupRules: without(undefined) }).map(x => x.daysToClose), [42], "missing key -> 42");
  eq(notices("2026-10-12", "s2", { groupRules: {} }).map(x => x.daysToClose), [42], "no offerPeriods block -> 42");
  eq(notices("2026-10-12", "s2", { groupRules: null }).map(x => x.daysToClose), [42], "no groupRules -> 42");
  eq(notices("2026-10-12", "s2", { groupRules: without(28) }), [], "28: 42 days out is outside");
  eq(notices("2026-10-26", "s2", { groupRules: without(28) }).map(x => x.daysToClose), [28], "28: 28 days out is inside");
  eq(notices("2026-11-22", "s2", { groupRules: without(0) }), [], "0: never");
  eq(notices("2026-10-12", "s2", { groupRules: without("6 weeks") }).map(x => x.daysToClose), [42], "a non-number reads the default");
  eq([H.offerDeadlineNotices(null), H.offerDeadlineNotices({ periods: SP, today: "2026-11-09", groupRules: GR }), notices("11/09/2026", "s2"), H.offerDeadlineNotices({ periods: null, personId: "s2", today: "2026-11-09" })], [[], [], [], []]);
  eq(H.offerDeadlineNotices({ periods: [{ id: "x", label: "No close", start_day: "2027-01-04", end_day: "2027-01-31" }], offers: [], personId: "s2", today: "2026-11-09", groupRules: GR }).map(x => [x.closeAt, x.daysToClose]), [["2026-11-23", 14]], "an absent close is start - closeWeeksBeforeStart (offerTimeline)");
});
check("E6: offerPeriodLeadWarnings - short lead on the first period's 31-day lead (upcoming only), publish-by due / passed with open slots, the next period missing from (lastEnd + 1) - 6 weeks - noticeDaysBeforeClose (the seed's 14 since 9/30)", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the last period on file ends 6/30/2027 (was Feb - Apr's 5/2),
  // so the next period starts 7/1/2027 (freeze 5/20) and - with the seed's noticeDaysBeforeClose 14 - its window opens
  // 5/6/2027 (was 2/8, 42 days; the 42-day window stays pinned on GR927: 4/8); 'over' is from 7/1/2027; with only the first
  // period on file the window opens 11/9 (was 10/12)
  const up = SP.map(p => Object.assign({}, p, { status: "upcoming" }));
  const w = H.offerPeriodLeadWarnings({ periods: up, today: "2026-09-27", groupRules: GR, openCounts: { p0: 3, p1: 56 } });
  eq(w.periods, { p0: [{ kind: "short-lead", closeAt: "2026-10-02", daysBeforeStart: 31, weeksBeforeStart: 4, defaultWeeks: 6 }] }, "served upcoming (the smoke's harness), Nov - Jan's close 10/2 is 31 days before 11/2 - later than start - 42; Jan - Jun sits exactly on start - 42 (strict >)");
  eq(w.next, null, "the next period (from 7/1/2027) needs no warning before 5/6/2027");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2026-09-27", groupRules: GR }).periods, {}, "as the seed reads (published), the first period's short lead is history - no line");
  const cl = SP.map(p => p.id === "p0" ? Object.assign({}, p, { status: "closed" }) : p);
  const due = H.offerPeriodLeadWarnings({ periods: cl, today: "2026-09-28", groupRules: GR, openCounts: { p0: 2 } }).periods.p0;
  eq(due, [{ kind: "publish-due", publishBy: "2026-10-05", daysToPublish: 7, open: 2 }], "closed (choices in, not yet published): publish-by 10/5 is 7 days out and two slots are still open");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2026-09-28", groupRules: GR, openCounts: { p0: 2 } }).periods, {}, "as the seed reads (published) the publish-by line is history too - the open-shifts board reports the holes");
  eq(H.offerPeriodLeadWarnings({ periods: SP.map(p => p.id === "p0" ? Object.assign({}, p, { status: "generated" }) : p), today: "2026-10-06", groupRules: GR, openCounts: { p0: 2 } }).periods.p0, [{ kind: "publish-passed", publishBy: "2026-10-05", daysToPublish: -1, open: 2 }], "generated but not published: the passed line still shows");
  eq(H.offerPeriodLeadWarnings({ periods: cl, today: "2026-09-27", groupRules: GR, openCounts: { p0: 2 } }).periods, {}, "8 days out: quiet");
  eq(H.offerPeriodLeadWarnings({ periods: cl, today: "2026-09-28", groupRules: GR, openCounts: { p0: 0 } }).periods, {}, "no open slot: nothing to publish");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2026-12-08", groupRules: GR, openCounts: { p1: 5 } }).periods.p1, [{ kind: "publish-passed", publishBy: "2026-12-07", daysToPublish: -1, open: 5 }], "Jan - Jun 2027's publish-by passed with slots open");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2027-02-01", groupRules: GR, openCounts: { p1: 5 } }).periods.p1, [{ kind: "publish-passed", publishBy: "2026-12-07", daysToPublish: -56, open: 5 }], "2/1/2027 (after the old Jan 2027's end 1/31): Jan - Jun still runs, so the passed line still shows");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2027-07-01", groupRules: GR, openCounts: { p1: 5 } }).periods, {}, "a period that is over (from 7/1/2027) warns no more");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2027-05-05", groupRules: GR }).next, null, "5/5/2027: one day before the window");
  eq(H.offerPeriodLeadWarnings({ periods: SP, today: "2027-05-06", groupRules: GR }).next, { from: "2027-07-01", closeBy: "2027-05-20", daysToClose: 14 }, "5/6/2027 = 5/20 - 14: create the period starting 7/1, choices close 5/20");
  eq([H.offerPeriodLeadWarnings({ periods: SP, today: "2027-04-07", groupRules: GR927 }).next, H.offerPeriodLeadWarnings({ periods: SP, today: "2027-04-08", groupRules: GR927 }).next], [null, { from: "2027-07-01", closeBy: "2027-05-20", daysToClose: 42 }], "the window is noticeDaysBeforeClose: with the 9/27 value (42) it opens 4/8/2027 = 5/20 - 42");
  eq(H.offerPeriodLeadWarnings({ periods: [SP[0]], today: "2026-11-08", groupRules: GR }).next, null, "with only the first period on file (the smoke's harness): quiet on 11/8");
  eq(H.offerPeriodLeadWarnings({ periods: [SP[0]], today: "2026-11-09", groupRules: GR }).next, { from: "2027-01-04", closeBy: "2026-11-23", daysToClose: 14 }, "...the window opens 11/9 (14 days) since 9/30");
  eq(H.offerPeriodLeadWarnings({ periods: [SP[0]], today: "2026-10-12", groupRules: GR927 }).next, { from: "2027-01-04", closeBy: "2026-11-23", daysToClose: 42 }, "...with the 9/27 window it opened 10/12");
  eq([H.offerPeriodLeadWarnings(null), H.offerPeriodLeadWarnings({ periods: [], today: "2026-09-27" })], [{ periods: {}, next: null }, { periods: {}, next: null }], "junk / no periods -> quiet");
});

check("E7 (9/27 ship): urgent reads noticeUrgentDaysBeforeClose (default 14), never the reminder list - with the 9/27 values ([42, 14, 3], window 42) a notice is not urgent for all 42 days", () => {
  // pin moved deliberately 9/30 (TASK 2, Jan - Jun 2027 fold): the seed's list is [14, 3] and its window 14, so its largest
  // reminder offset equals the urgent threshold and the seed alone no longer tells the two readings apart - the check runs on
  // GR927 (the 9/27 values: window 42, reminders [42, 14, 3]) over the seed's periods; Feb - Apr 2027 (p2) is gone, so the
  // lines that carried two notices carry Jan - Jun only, and its 'at 42 days not urgent' half moves to its own 10/12 line
  const op = (patch, drop) => { const o = Object.assign({}, GR927.offerPeriods, patch || {}); (drop || []).forEach((k) => delete o[k]); return Object.assign({}, GR927, { offerPeriods: o }); };
  eq([GR.offerPeriods.remindDaysBeforeClose, GR.offerPeriods.noticeDaysBeforeClose, GR.offerPeriods.noticeUrgentDaysBeforeClose], [[14, 3], 14, 14], "the seed since 9/30: reminders [14, 3], window 14, urgent 14 - max(reminders) = urgent, so the seed cannot tell the readings apart");
  eq(GR927.offerPeriods.remindDaysBeforeClose, [42, 14, 3], "GR927 carries the six-week e-mail (the 9/27 values)");
  eq(notices("2026-10-12", "s2", { groupRules: GR927 }).map((x) => [x.daysToClose, x.urgent]), [[42, false]], "42 days out (the first e-mail's day, the notice's first day): shown, not urgent - the old max(remindDaysBeforeClose) reading would say urgent");
  eq(notices("2026-11-08", "s2", { groupRules: GR927 }).map((x) => [x.periodId, x.daysToClose, x.urgent]), [["p1", 15, false]], "15 days out: not urgent");
  eq(notices("2026-11-08", "s2", { groupRules: op(null, ["noticeUrgentDaysBeforeClose"]) }).map((x) => x.urgent), [false], "key absent -> the default 14 (15 days out: not urgent)");
  eq(notices("2026-11-09", "s2", { groupRules: op(null, ["noticeUrgentDaysBeforeClose"]) }).map((x) => [x.periodId, x.urgent]), [["p1", true]], "key absent -> 14: Jan - Jun 2027 at 14 days is urgent");
  eq(notices("2026-10-12", "s2", { groupRules: op(null, ["noticeUrgentDaysBeforeClose"]) }).map((x) => [x.periodId, x.urgent]), [["p1", false]], "key absent -> 14: at 42 days it is not");
  eq(notices("2026-11-09", "s2", { groupRules: op({ remindDaysBeforeClose: [21, 3] }, ["noticeUrgentDaysBeforeClose"]) }).map((x) => x.urgent), [true], "the reminder list does not move urgent (21 in the list, still 14)");
  eq(notices("2026-11-05", "s2", { groupRules: op({ remindDaysBeforeClose: [21, 3] }, ["noticeUrgentDaysBeforeClose"]) }).map((x) => [x.periodId, x.daysToClose, x.urgent]), [["p1", 18, false]], "18 days out with 21 in the reminder list: NOT urgent (the old max(remindDaysBeforeClose) reading said urgent - this line tells the two rules apart)");
  eq(notices("2026-11-09", "s2", { groupRules: op({ remindDaysBeforeClose: [] }) }).map((x) => x.urgent), [true], "an empty reminder list (no e-mails) leaves urgent on at 14 days (the old reading turned it off)");
  eq(notices("2026-11-22", "s2", { groupRules: op({ noticeUrgentDaysBeforeClose: 0 }) })[0].urgent, false, "0: urgent never (1 day out)");
  eq(notices("2026-11-09", "s2", { groupRules: op({ noticeUrgentDaysBeforeClose: "two weeks" }) })[0].urgent, true, "a non-number reads the default 14");
  eq(notices("2026-11-09", "s2", { groupRules: op({ noticeUrgentDaysBeforeClose: -1 }) })[0].urgent, true, "a negative number reads the default 14");
  eq(notices("2026-11-08", "s2", { groupRules: null })[0].urgent, false, "no groupRules at all -> 14");
  eq(notices("2026-11-09", "s2", { groupRules: null })[0].urgent, true, "no groupRules at all -> 14 (14 days out)");
});

// Prompt 26 (Faraz 9/30): the scheduler's roll call at the freeze names who PAINTED DAYS (offers inside the period) and who
// ADDED VACATIONS (a time_off row overlapping the period's days); everyone else is "following their rules" - never "missing",
// "not started" or "never answered". helpers.offerFreezeRollcall = offerRollcall's rows (status unchanged) + vacations + kind;
// offerFreezeWords = the words; offerHeadsUpWords = the first reminder's subject / body (the Periods Remind button sends it).
check("E8 (Prompt 26): offerFreezeRollcall - offerRollcall's rows plus the vacations overlapping the period (clipped to it and merged where they overlap or touch - the cron's reading, review 9/30; start_date / end_date or start / end) and kind painted / vacations / rules", () => {
  const P1 = SP[1]; // Jan 2027 - Jun 2027 (2027-01-04 .. 2027-06-30)
  const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const offers = [{ person_id: "s2", day: "2027-01-10", role_pref: "either" }, { person_id: "s2", day: "2027-01-10", role_pref: "primary" }, { person_id: "s2", day: "2027-02-03", role_pref: "backup" }, { person_id: "s3", day: "2026-12-30", role_pref: "primary" }];
  const timeOff = [
    { person_id: "s3", start_date: "2026-12-28", end_date: "2027-01-05" },   // overlaps the start
    { person_id: "s3", start_date: "2027-03-01", end_date: "2027-03-01" },   // a one-day vacation inside
    { person_id: "s3", start_date: "2027-03-01", end_date: "2027-03-01" },   // its duplicate
    { person_id: "s2", start: "2027-06-28", end: "2027-07-04" },             // the seed's alias shape, overlapping the end
    { person_id: "s4", start_date: "2027-07-01", end_date: "2027-07-10" },   // the day after the end: outside
    { person_id: "s4", start_date: "2026-12-20", end_date: "2027-01-03" },   // ends the day before the start: outside
    { person_id: "s6", start_date: "2027-05-10", end_date: "2027-05-01" },   // ends before it starts: skipped
    { person_id: "s6", start_date: "05/10/2027", end_date: "2027-05-12" },   // not ISO: skipped
    { start_date: "2027-02-01", end_date: "2027-02-02" },                    // no person: skipped
    { person_id: "s3", start_date: "2027-03-02", end_date: "2027-03-04" },   // touches 3/1: merged into one range (review 9/30)
  ];
  const roll = H.offerFreezeRollcall(P1, offers, timeOff, ids);
  eq(roll.map(r => ({ id: r.id, status: r.status, offered: r.offered })), H.offerRollcall(P1, offers, ids), "id / status / offered are offerRollcall's, unchanged");
  eq(roll.map(r => [r.id, r.kind, r.vacations]), [
    ["s1", "rules", []],
    // pin moved deliberately 9/30 (review of Prompt 26): clipped to 1/4 - 6/30 and merged (3/1 + 3/2-3/4 touch), as the cron renders it
    ["s2", "painted", [{ start: "2027-06-28", end: "2027-06-30" }]],
    ["s3", "vacations", [{ start: "2027-01-04", end: "2027-01-05" }, { start: "2027-03-01", end: "2027-03-04" }]],
    ["s4", "rules", []],
    ["s5", "rules", []],
    ["s6", "rules", []],
  ], "kind and vacations per person");
  eq(roll.find(r => r.id === "s5").status, "rules_only", "s5's chosen 'go by my rules' is still offer_status()'s rules_only (the words, not the status, change)");
  eq(roll.find(r => r.id === "s2").offered, 2, "s2 painted two distinct days (a role_pref never counts twice)");
  eq([H.offerFreezeRollcall({ id: "x" }, offers, timeOff, ids), H.offerFreezeRollcall(P1, offers, timeOff, null), H.offerFreezeRollcall(P1, null, null, ["s1"])], [[], [], [{ id: "s1", status: "not_started", offered: 0, vacations: [], kind: "rules" }]], "junk: a period without dates or no id list -> []; no offers / time off -> following their rules");
});
check("E9 (Prompt 26): offerFreezeWords - 'painted N day(s)', 'added vacations M/D-M/D, M/D', both joined by ' and ', else 'following their rules' ('following your rules' to the person); never 'missing' / 'not started' / 'never answered'", () => {
  const W = H.offerFreezeWords;
  eq(W({ offered: 1, vacations: [] }), "painted 1 day");
  eq(W({ offered: 12, vacations: [] }), "painted 12 days");
  eq(W({ offered: 0, vacations: [{ start: "2027-01-10", end: "2027-01-14" }, { start: "2027-03-01", end: "2027-03-01" }] }), "added vacations 1/10-1/14, 3/1");
  eq(W({ offered: 3, vacations: [{ start: "2026-12-28", end: "2027-01-05" }] }), "painted 3 days and added vacations 12/28-1/5");
  eq(W({ offered: 0, vacations: [], status: "not_started" }), "following their rules", "to the scheduler");
  eq(W({ offered: 0, vacations: [], status: "rules_only" }), "following their rules", "a chosen 'go by my rules' reads the same");
  eq(W({ offered: 0, vacations: [] }, "you"), "following your rules", "to the person");
  eq([W(null), W("junk")], ["", ""]);
  const P1 = SP[1];
  const all = H.offerFreezeRollcall(P1, [{ person_id: "s2", day: "2027-04-01", role_pref: "primary" }], [{ person_id: "s3", start_date: "2027-04-05", end_date: "2027-04-09" }], ["s1", "s2", "s3", "s4", "s5", "s6"]).map(r => W(r)).join("; ");
  eq(all, "following their rules; painted 1 day; added vacations 4/5-4/9; following their rules; following their rules; following their rules", "a whole roll call in words");
  assert.ok(!/missing|not started|never answered|nothing/i.test(all), "never 'missing' / 'not started' / 'never answered' / 'nothing'");
});
check("E10 (Prompt 26): offerHeadsUpWords = the first reminder's subject and body (Faraz 9/30 wording, the freeze as 'Mon 11/23'); offerFreezeDay spells the freeze", () => {
  eq(H.offerFreezeDay("2026-11-23"), "Mon 11/23");
  eq(H.offerFreezeDay("2027-01-04"), "Mon 1/4");
  eq(H.offerFreezeDay("2026-10-02T00:00:00Z"), "Fri 10/2", "a timestamp is read by its date");
  eq(H.offerFreezeDay("11/23/2026"), "11/23/2026", "a non-ISO input comes back as given");
  const w = H.offerHeadsUpWords({ label: SP[1].label, closeAt: SP[1].offers_close_at });
  eq(w.subject, "Silvis call - the Jan 2027 - Jun 2027 schedule is built from your rules on Mon 11/23");
  eq(w.body, "Before Mon 11/23, enter your vacations for Jan 2027 - Jun 2027 in the app. If there are days you'd like to work, or can't, paint them too. Otherwise there is nothing to do - the schedule follows your rules.");
  assert.ok(!/choose your shifts|go by my rules|not started|never answered|missing/i.test(w.subject + " " + w.body), "the old 'choose your shifts' wording is gone");
  assert.ok(!/@|\$\d/.test(w.subject + w.body), "no address, no amount");
  eq(H.offerHeadsUpWords({ label: "  ", closeAt: "2027-05-20" }).subject, "Silvis call - the next period schedule is built from your rules on Thu 5/20", "a blank label falls back to words (never an empty name)");
});
check("E11 (Prompt 26): the app's notice per role - a linked pool surgeon (mySurgeon, in offerPoolIds of the roster, any status) on his own My schedule, never the public page / a viewer / the office / a follower (no roster link); no count badge on the nav", () => {
  const src = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
  assert.ok(src.includes("const offerPool = useMemo(() => offerPoolIds(surgeons), [surgeons]);"), "the pool is offerPoolIds of the roster");
  assert.ok(src.includes("return mySurgeon && !isPublicMode ? offerDeadlineNotices({ periods: periodRows, offers: offerRows, personId: mySurgeon, poolIds: offerPool, today: todayStr, groupRules }) : [];"), "a linked account (mySurgeon) outside ?public=1, gated on the pool inside the helper - viewers / the office / followers have no mySurgeon");
  const hs = fs.readFileSync(path.join(ROOT, "helpers.js"), "utf8");
  const fnBody = hs.slice(hs.indexOf("function offerDeadlineNotices("), hs.indexOf("function offerPeriodLeadWarnings("));
  assert.ok(fnBody.length > 200 && !/!== "not_started"|=== "not_started"/.test(fnBody), "offerDeadlineNotices filters on no status any more");
  assert.strictEqual(src.includes("offer-deadline-badge"), false, "the nav's count badge is removed (not hidden)");
  assert.ok(src.includes('{pid === mySurgeon && offerNoticeBox(offerNotices, "mine")}'), "My schedule shows it on his own page only");
});

/* ---------------- F. Prompt 28 (10/1): No primary days - the painter's pure helpers ---------------- */
// Faraz 10/1: "I do want them to be able to do that"; Burchett's e-mail of 10/1: "I need to be blocked out as unavailable for
// primary call. I can cover backup call these days". The fifth brush stores one availability row per day (kind backup_only,
// role any) through save_offers -> save_no_primary; these are the pure pieces the sheet runs (helpers.js). This section never
// reads the new migration (the DB lane's schema.test.js pins it).
console.log("\n[F] Prompt 28: no-primary days (pure helpers)");
const NPR = (person_id, start_date, end_date, extra) => Object.assign({ id: "a-" + person_id + start_date + (end_date || ""), person_id, kind: "backup_only", role: "any", start_date, end_date: end_date === undefined ? start_date : end_date, note: null, source: "app", created_by: person_id }, extra || {});
check("noPrimaryDays: own single days of ANY source (setup / seed / app) and any role; a multi-day row gives range days, not own; a single day under a range is range only; other kinds, persons and junk are ignored", () => {
  const rows = [
    NPR("s2", "2027-01-06", "2027-01-06", { source: "setup", note: "x" }), NPR("s2", "2026-10-09", "2026-10-09", { source: "seed" }), NPR("s2", "2027-02-03", "2027-02-03", { source: "app", role: "primary" }),
    NPR("s2", "2027-03-01", "2027-03-03", { source: "setup" }), NPR("s2", "2027-03-02", "2027-03-02", { source: "app" }),
    NPR("s3", "2027-01-07", "2027-01-07"), Object.assign(NPR("s2", "2027-01-08"), { kind: "unavailable" }), Object.assign(NPR("s2", "2027-01-09"), { kind: "no_backup" }),
    NPR("s2", "2027-01-10", null), NPR("s2", "bad", "bad"), NPR("s2", "2027-01-12", "2027-01-11"), null, 7, { kind: "backup_only" },
  ];
  const np = H.noPrimaryDays(rows, "s2");
  eq(Object.keys(np.own).sort(), ["2026-10-09", "2027-01-06", "2027-01-10", "2027-02-03"], "own = his single days (a missing end = the start day)");
  eq(Object.keys(np.range).sort(), ["2027-03-01", "2027-03-02", "2027-03-03"], "range = every day of the multi-day row");
  eq(np.own["2027-03-02"], undefined, "a single day under a range is the range's (read-only)");
  eq(H.noPrimaryDays(rows, "s3"), { own: { "2027-01-07": true }, range: {} });
  eq(H.noPrimaryDays(null, "s2"), { own: {}, range: {} }); eq(H.noPrimaryDays(rows, ""), { own: {}, range: {} });
  const far = H.noPrimaryDays([NPR("s2", "2027-01-01", "9999-12-31")], "s2");
  assert.ok(Object.keys(far.range).length <= 3660 && far.range["2027-01-01"], "a junk end date never loops for ever");
  eq(H.NO_PRIMARY_RANGE_WORDS, "No primary (set by the scheduler)"); eq(H.NO_PRIMARY_HELD_WORDS, "you hold primary that day - trade it first");
});
// a free weekday cell: nothing offered, nothing marked, nothing blocked
const CELL = (o) => Object.assign({ offer: null, np: false, savedOffer: false, savedNp: false, range: false, past: false, frozen: null, grey: null, blockPrimary: null, blockBackup: null, holdsPrimary: false }, o || {});
const paint = (o, brush, single) => H.offerPaintCell(CELL(o), brush, { single: single !== false });
const st = (r) => [r.offer, r.np, r.skip, r.lift, r.replaced];
const FROZEN = "frozen - offers for Nov 2026 - Jan 2027 closed 10/2 - ask the scheduler";
check("offerPaintCell No primary: REPLACE - on a Primary or Either offer the offer goes and the day is marked (replaced); on a Backup offer the offer STAYS (backup preferred); on nothing it marks", () => {
  eq(st(paint({ offer: "primary", savedOffer: true }, "noprimary")), [null, true, null, false, true], "primary -> none + N, replaced");
  eq(st(paint({ offer: "either" }, "noprimary", false)), [null, true, null, false, true], "either (a Range batch too) -> none + N, replaced");
  eq(st(paint({ offer: "backup", savedOffer: true }, "noprimary")), ["backup", true, null, false, false], "KEEP Backup: the offer stays beside the mark");
  eq(st(paint({}, "noprimary")), [null, true, null, false, false], "a free day is marked");
  eq(st(paint({ blockPrimary: "East busy" }, "noprimary")), [null, true, null, false, false], "a one-role block of primary still takes the mark");
  eq(st(paint({ blockBackup: "a day you stated as no backup - ask the scheduler to change that row first" }, "noprimary")), [null, true, null, false, false], "a one-role block of backup too");
});
check("offerPaintCell No primary: tap again takes it back (single tap); a Range / Paste batch over a marked day is a silent no-op; a range day is silent; past / frozen are skipped with their words; a greyed day is skipped; a day he HOLDS as primary is skipped (trade first)", () => {
  eq(st(paint({ np: true, savedNp: true }, "noprimary")), [null, false, null, false, false], "tap again on an own N -> lifted");
  eq(st(paint({ np: true, offer: "backup" }, "noprimary")), ["backup", false, null, false, false], "tap again keeps the Backup offer");
  eq(st(paint({ np: true }, "noprimary", false)), [null, true, null, false, false], "Range / Paste over a marked day: unchanged, silent");
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS }, "noprimary")), [null, false, null, false, false], "a range day: silent (already No primary, read-only)");
  eq(st(paint({ past: true, grey: "past" }, "noprimary")), [null, false, "past", false, false]);
  eq(st(paint({ past: true, grey: "past", np: true, savedNp: true }, "noprimary")), [null, true, "past", false, false], "a past mark is never taken back");
  eq(st(paint({ frozen: FROZEN, grey: FROZEN }, "noprimary")), [null, false, FROZEN, false, false]);
  eq(st(paint({ frozen: FROZEN, grey: FROZEN, np: true, savedNp: true }, "noprimary")), [null, true, FROZEN, false, false], "a frozen mark stays");
  eq(st(paint({ grey: "on your vacation", blockPrimary: "on your vacation", blockBackup: "on your vacation" }, "noprimary")), [null, false, "on your vacation", false, false], "greyed (both roles) -> skipped with the grey words");
  eq(st(paint({ grey: "on your vacation", np: true, savedNp: true }, "noprimary")), [null, false, null, false, false], "a greyed day with his saved mark: a tap takes it back");
  eq(st(paint({ holdsPrimary: true }, "noprimary")), [null, false, H.NO_PRIMARY_HELD_WORDS, false, false], "published primary -> 'you hold primary that day - trade it first'");
  eq(st(paint({ holdsPrimary: true, offer: "primary" }, "noprimary")), ["primary", false, H.NO_PRIMARY_HELD_WORDS, false, false], "held primary wins over the replace rule");
});
check("offerPaintCell Primary / Either: LIFT - on a No primary day the offer is painted and the mark lifted (lift: the sheet asks once per batch); a single tap on the same brush clears the offer; a range day is skipped 'primary - No primary (set by the scheduler)'; one-role blocks and greys skipped as before", () => {
  eq(st(paint({ np: true, savedNp: true }, "primary")), ["primary", false, null, true, false], "primary on N -> lift");
  eq(st(paint({ np: true }, "either", false)), ["either", false, null, true, false], "either on N (a Range batch) -> lift");
  eq(st(paint({}, "primary")), ["primary", false, null, false, false]);
  eq(st(paint({ offer: "primary" }, "primary")), [null, false, null, false, false], "tap again with the same brush clears the offer");
  eq(st(paint({ offer: "primary" }, "primary", false)), ["primary", false, null, false, false], "a Range repaint keeps it");
  eq(st(paint({ offer: "backup" }, "either")), ["either", false, null, false, false]);
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS }, "primary")), [null, false, "primary - No primary (set by the scheduler)", false, false], "Setup range: read-only");
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS }, "either")), [null, false, "primary - No primary (set by the scheduler)", false, false]);
  eq(st(paint({ blockBackup: "you opted out of backup" }, "either")), [null, false, "backup - you opted out of backup", false, false], "either needs both roles");
  eq(st(paint({ blockPrimary: "East busy" }, "primary")), [null, false, "primary - East busy", false, false]);
  eq(st(paint({ past: true, grey: "past" }, "primary")), [null, false, "past", false, false]);
  eq(st(paint({ frozen: FROZEN, grey: FROZEN }, "either")), [null, false, FROZEN, false, false]);
  eq(st(paint({ grey: "on your vacation" }, "primary")), [null, false, "on your vacation", false, false]);
  eq(st(paint({ holdsPrimary: true }, "primary")), ["primary", false, null, false, false], "holding primary does not stop a primary offer (the generator's business)");
});
check("offerPaintCell Backup: a Backup offer sits beside a No primary mark (N kept) and on a range day; tap again clears only the offer; backup blocks and greys skipped", () => {
  eq(st(paint({ np: true, savedNp: true }, "backup")), ["backup", true, null, false, false], "Backup on N keeps both");
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS }, "backup")), ["backup", false, null, false, false], "Backup on a range day is fine (backup is fine)");
  eq(st(paint({ np: true, offer: "backup" }, "backup")), [null, true, null, false, false], "tap again: offer cleared, N unchanged");
  eq(st(paint({ blockBackup: "you opted out of backup" }, "backup")), [null, false, "backup - you opted out of backup", false, false]);
  eq(st(paint({ past: true, grey: "past" }, "backup")), [null, false, "past", false, false]);
});
check("offerPaintCell Clear: CLEAR removes both the offer and the mark; nothing to clear is silent BEFORE past / frozen are named; past / frozen are skipped; a greyed day with neither a saved offer nor a saved mark is skipped, with either one it clears; a range day stays (read-only)", () => {
  eq(st(paint({ offer: "backup", np: true, savedOffer: true, savedNp: true }, "clear")), [null, false, null, false, false], "clear takes back both");
  eq(st(paint({ np: true, savedNp: true }, "clear", false)), [null, false, null, false, false], "a Range of Clear lifts the mark too");
  eq(st(paint({}, "clear")), [null, false, null, false, false], "nothing to clear: silent");
  eq(st(paint({ past: true, grey: "past" }, "clear")), [null, false, null, false, false], "nothing to clear on a past day: silent (before 'past')");
  eq(st(paint({ past: true, grey: "past", offer: "primary", savedOffer: true }, "clear")), ["primary", false, "past", false, false]);
  eq(st(paint({ frozen: FROZEN, grey: FROZEN, np: true, savedNp: true }, "clear")), [null, true, FROZEN, false, false]);
  eq(st(paint({ grey: "on your vacation", np: true, savedNp: true }, "clear")), [null, false, null, false, false], "greyed with a saved mark: Clear can take it back");
  eq(st(paint({ grey: "on your vacation", offer: "either", savedOffer: true }, "clear")), [null, false, null, false, false], "greyed with a saved offer: Clear can take it back (as before)");
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS }, "clear")), [null, false, null, false, false], "clear on a range day without an offer: silent");
  eq(st(paint({ range: true, blockPrimary: H.NO_PRIMARY_RANGE_WORDS, offer: "backup", savedOffer: true }, "clear")), [null, false, null, false, false], "clear on a range day takes the offer only - the range stays (np false = not his own)");
  eq(st(H.offerPaintCell(CELL({ np: true, range: true }), "noprimary", { single: true })), [null, false, null, false, false], "np on a range day is never his own");
  eq(st(H.offerPaintCell(null, "bogus", null)), [null, false, null, false, false], "junk in, nothing moves");
});
check("noPrimaryDraftDiff: true on an unsaved day -> add, false on a saved day -> clear, equal to saved -> dropped, a non-ISO day -> bad; day order", () => {
  eq(H.noPrimaryDraftDiff({ "2027-01-06": true, "2027-02-03": true }, { "2027-01-15": true, "2027-01-06": true, "2027-02-03": false, "2027-03-01": false, "bad": true }), { add: ["2027-01-15"], clear: ["2027-02-03"], bad: ["bad"] });
  eq(H.noPrimaryDraftDiff(["2027-01-06"], { "2027-01-06": false, "2027-01-01": true }), { add: ["2027-01-01"], clear: ["2027-01-06"], bad: [] }, "an array of saved days is accepted");
  eq(H.noPrimaryDraftDiff(null, null), { add: [], clear: [], bad: [] });
});
check("offersAuditSummary (the Activity log text of offers.save): the four pinned examples; with no No primary change it is byte-for-byte the pre-Prompt-28 text", () => {
  eq(H.offersAuditSummary("Burchett", 0, { add: ["2027-01-06", "2027-01-15"], clear: [] }, null, null), "Burchett: no primary on 1/6, 1/15");
  eq(H.offersAuditSummary("Burchett", 2, { add: ["2027-01-06"], clear: ["2027-02-03"] }, null, "Jan 2027 - Jun 2027"), "Burchett: 2 offer change(s); no primary on 1/6; no primary lifted on 2/3 (Jan 2027 - Jun 2027)");
  eq(H.offersAuditSummary("Acton", 2, { add: [], clear: [] }, null, null), "Acton: 2 offer change(s)");
  eq(H.offersAuditSummary("Khan", 0, { add: [], clear: [] }, "rules_only", "P"), "Khan: 0 offer change(s), mode rules_only (P)");
  // the old template literal of commitOffersPaint, restated: `${name}: ${count} offer change(s)${mode ? ", mode " + mode : ""}${label ? " (" + label + ")" : ""}`
  const old = (name, count, mode, label) => `${name}: ${count} offer change(s)${mode ? ", mode " + mode : ""}${label ? " (" + label + ")" : ""}`;
  [["Acton", 3, "exhaustive", "Nov 2026 - Jan 2027"], ["Fierce", 0, "rules_only", "Nov 2026 - Jan 2027"], ["Khan", 1, null, null]].forEach(([n, c, m, l]) => eq(H.offersAuditSummary(n, c, null, m, l), old(n, c, m, l)));
  eq(H.offersAuditSummary("Burchett", 0, { add: ["2027-01-15", "2027-01-06"], clear: [] }, null, null), "Burchett: no primary on 1/6, 1/15", "days in day order");
  assert.ok(!/@|\$/.test(H.offersAuditSummary("Burchett", 1, { add: ["2027-01-06"], clear: [] }, "preferred", "Jan 2027 - Jun 2027")), "no contact, no amount");
});
check("noPrimaryErrorWords: a NO_PRIMARY_* message loses its token and gets a capital first letter; anything else is unchanged", () => {
  eq(H.noPrimaryErrorWords("NO_PRIMARY_ON_CALL: Burchett holds primary on 1/6 - trade those days first, then mark them No primary"), "Burchett holds primary on 1/6 - trade those days first, then mark them No primary");
  eq(H.noPrimaryErrorWords("NO_PRIMARY_FROZEN: offers for Jan 2027 - Jun 2027 closed on 2026-11-23 - ask the scheduler (1/6)"), "Offers for Jan 2027 - Jun 2027 closed on 2026-11-23 - ask the scheduler (1/6)");
  eq(H.noPrimaryErrorWords("OFFER_ON_VACATION: 2026-11-03 is inside a vacation of s2"), "OFFER_ON_VACATION: 2026-11-03 is inside a vacation of s2");
  eq(H.noPrimaryErrorWords(null), ""); eq(H.noPrimaryErrorWords("NO_PRIMARY_X:"), "NO_PRIMARY_X:");
});
check("the engine reads a No primary row the way the painter promises: rules.eligibility blocks PRIMARY (backup-only-row) and keeps BACKUP open on that day (Burchett, a Jan 2027 day of the seed period)", () => {
  const per = seed.offerPeriods[1] || seed.offerPeriods[0];
  const base = { roster: seed.roster, surgeonRules: seed.surgeonRules, groupRules: seed.groupRules, holidays: seed.holidays, schedule: {}, periods: [{ id: "p", start_day: per.start, end_day: per.end, status: "upcoming" }], offers: [], today: "2026-10-01" };
  const day = "2027-01-12"; // a Tuesday inside the Jan 2027 - Jun 2027 period
  const ctx = R.buildContext(Object.assign({}, base, { availabilityRows: [NPR("s2", day, day)] }));
  const p = R.eligibility(ctx, day, "primary", "s2", { claim: true }), b = R.eligibility(ctx, day, "backup", "s2", { claim: true });
  assert.ok(p.hard.indexOf("backup-only-row") >= 0, "primary must be hard backup-only-row: " + JSON.stringify(p.hard));
  assert.ok(b.hard.indexOf("backup-only-row") < 0 && b.hard.indexOf("unavailable-row") < 0, "backup must not be blocked by the row: " + JSON.stringify(b.hard));
  // a No primary day is NOT an offer: the period status stays not_started
  eq(H.offerStatus({ id: "p", start_day: per.start, end_day: per.end }, [], "s2"), "not_started");
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
