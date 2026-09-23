#!/usr/bin/env node
/*
 * Silvis Call Schedule - offer-period timeline: the cron's date maths, mirrored (Prompt 14 part 4, 9/23).
 *
 *   A. helpers.js: offerTimeline / offerCronPlan / offerRollcall / offerPoolIds against test/fixtures/offer-timeline.json
 *      (which days trigger a reminder, the close day, who is reminded, who the close summary names).
 *   B. edge-functions/daily-reminder/index.ts: the plain-JS block between '// @offerTimeline-mirror-start' and
 *      '// @offerTimeline-mirror-end' is extracted, evaluated with new Function (the Prompt 13 technique) and run
 *      against the SAME fixture, plus 400 seeded random (period, rules, today) triples compared with helpers.js.
 *   C. source pins: send-notification categories offers_reminder / offers_closed (schedule_updates_email), the
 *      daily-reminder mode "offers" (gate, dryRun contract, recipients from user_profiles by person_id - never an
 *      anon-readable table, never an address in a response), the README cron statement, the guide paragraph, the
 *      test wiring. No contact data in either function.
 *
 * Run: node test/offers-timeline.test.js   (exit code 1 on any failure)
 */
"use strict";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); }
};
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

const ROOT = path.join(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "offer-timeline.json"), "utf8"));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const per = (ref) => (typeof ref === "string" ? FIX.periods[ref] : ref);
const rulesOf = (c) => (c.rules === undefined ? FIX.rules : c.rules);
const RC = FIX.rollcall;

// ---- Prompt 14 part 4 (9/23) ----
console.log("\n[A] helpers.js: the timeline maths on the fixture");

check("helpers.js exports offerCronPlan, offerRollcall and offerPoolIds beside offerTimeline / offerStatus", () => {
  ["offerTimeline", "offerStatus", "offerCronPlan", "offerRollcall", "offerPoolIds"].forEach(k => assert.strictEqual(typeof H[k], "function", "missing helpers.js export " + k));
});
check("offerTimeline == fixture.timeline (" + FIX.timeline.length + " cases: the first period, a computed one, 6 months, timestamp-shaped dates, a 3-step reminder list incl. 0, null rules)", () => {
  FIX.timeline.forEach((c, i) => eq(H.offerTimeline(per(c.period), rulesOf(c)), c.expected, "timeline case " + i + " (" + c.period + ")"));
});
check("offerCronPlan(period, today, rules) == fixture.cron (" + FIX.cron.length + " cases): remind on close - 14 / - 3 only, close from offers_close_at on (close beats a 0-day reminder), nothing for a closed / generated period, absent status reads upcoming", () => {
  FIX.cron.forEach((c, i) => eq(H.offerCronPlan(per(c.period), c.today, rulesOf(c)), c.expected, "cron case " + i + " (" + c.period + " @ " + c.today + ")"));
});
check("offerCronPlan: a non-ISO today, a period without dates or no period -> null (the cron reports the row and moves on)", () => {
  FIX.cronNull.forEach((c, i) => eq(H.offerCronPlan(per(c.period), c.today, FIX.rules), null, "cronNull case " + i));
});
check("offerPoolIds(roster) == fixture: active, non-external entries with an id, in roster order", () => {
  eq(H.offerPoolIds(RC.roster), RC.expectedPoolIds);
  eq(H.offerPoolIds(null), []);
  eq(H.offerPoolIds("junk"), []);
});
check("offerRollcall(period, offers, ids) == fixture: status like offerStatus, offered = distinct days inside [start_day, end_day] (end inclusive, a timestamp-shaped day read by its date, outside days and junk rows ignored), ids order kept", () => {
  const out = H.offerRollcall(per(RC.period), RC.offers, RC.expectedPoolIds);
  eq(out, RC.expected);
  out.forEach(r => assert.strictEqual(r.status, H.offerStatus(per(RC.period), RC.offers, r.id), "rollcall status == offerStatus for " + r.id));
  eq(out.filter(r => r.status === "not_started").map(r => r.id), RC.expectedRemindIds, "the reminder goes to not_started only");
  const by = (s) => out.filter(r => r.status === s).map(r => r.id);
  eq({ submitted: by("submitted"), rules_only: by("rules_only"), not_started: by("not_started") }, RC.expectedSummary);
  eq(H.offerRollcall({ label: "no dates" }, RC.offers, RC.expectedPoolIds), [], "a period without dates rolls nobody");
  eq(H.offerRollcall(per(RC.period), null, ["s2"]), [{ id: "s2", status: "not_started", offered: 0 }], "no offers -> not_started unless rules-only");
});
// PD (9/23): the first period is PUBLISHED in docs/silvis-seed.json (its schedule went out 9/23). The cron must plan
// nothing for it on its reminder day (9/29) and on its close day (10/2): no reminder, no CAS close, no scheduler mail.
// runOffers never even reads it (call_periods?...&status=eq.upcoming, pinned in [C]); this is the maths' own guard.
const SEED_PD = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "silvis-seed.json"), "utf8"));
const seedPeriodRow = (p) => ({ label: p.label, start_day: p.start, end_day: p.end, offers_close_at: p.offersCloseAt, publish_by: p.publishBy, status: p.status, rules_only_ids: p.rulesOnly || [] });
check("PD: the seed's first period (status published) -> offerCronPlan is action none / reason status:published on 9/29 and 10/2; the second period (upcoming, close 12/21) reminds on 12/7 and 12/18 and closes on 12/21", () => {
  const [p0, p1] = SEED_PD.offerPeriods.map(seedPeriodRow);
  eq([p0.status, p0.offers_close_at, p1.status, p1.offers_close_at], ["published", "2026-10-02", "upcoming", "2026-12-21"]);
  const R = SEED_PD.groupRules.offerPeriods;
  ["2026-09-23", "2026-09-29", "2026-10-02", "2026-10-03"].forEach(d => eq([H.offerCronPlan(p0, d, R).action, H.offerCronPlan(p0, d, R).reason], ["none", "status:published"], "first period @ " + d));
  eq([H.offerCronPlan(p1, "2026-12-07", R).action, H.offerCronPlan(p1, "2026-12-07", R).reason], ["remind", "remind:14"]);
  eq([H.offerCronPlan(p1, "2026-12-18", R).action, H.offerCronPlan(p1, "2026-12-18", R).reason], ["remind", "remind:3"]);
  eq([H.offerCronPlan(p1, "2026-12-21", R).action, H.offerCronPlan(p1, "2026-12-21", R).reason], ["close", "close:today"]);
  eq(H.offerCronPlan(p1, "2026-09-29", R).action, "none", "nothing for the second period on the first period's old reminder day");
});

console.log("\n[B] daily-reminder/index.ts: the TypeScript mirror (plain JS between the markers) on the same fixture");

const DR = path.join("edge-functions", "daily-reminder", "index.ts");
const START = "// @offerTimeline-mirror-start", END = "// @offerTimeline-mirror-end";
const mirrorBlock = () => {
  const src = read(DR);
  const i = src.indexOf(START), j = src.indexOf(END);
  assert.ok(i >= 0, DR + " carries the marker " + START);
  assert.ok(j > i, DR + " carries the marker " + END + " after the start marker");
  return src.slice(i + START.length, j);
};
const loadMirror = () => new Function(mirrorBlock() + "\nreturn { timeline: otmTimeline, plan: otmCronPlan, rollcall: otmRollcall, poolIds: otmPoolIds, status: otmStatus };")();
const prng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

check("the mirror block is plain JavaScript (no type annotations, no 'as' casts), evaluates, defines otmTimeline / otmCronPlan / otmRollcall / otmPoolIds / otmStatus and names its source of truth", () => {
  const block = mirrorBlock();
  const stripped = block.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  assert.ok(!/:\s*(string|number|boolean|any|unknown|void|Record<|Array<|\{\s*\w+:\s*\w+)\b/.test(stripped), "no TypeScript type annotations inside the mirror block");
  assert.ok(!/\bas\s+(any|string|number|const)\b/.test(block), "no 'as' casts inside the mirror block");
  const m = loadMirror();
  ["timeline", "plan", "rollcall", "poolIds", "status"].forEach(k => assert.strictEqual(typeof m[k], "function", "mirror defines " + k));
  assert.ok(block.indexOf("helpers.js") > 0 && block.indexOf("offer-timeline.json") > 0, "the block names helpers.js and the fixture");
});
check("mirror otmTimeline == fixture.timeline == helpers.offerTimeline on every case", () => {
  const m = loadMirror();
  FIX.timeline.forEach((c, i) => {
    eq(m.timeline(per(c.period), rulesOf(c)), c.expected, "mirror timeline case " + i);
    eq(m.timeline(per(c.period), rulesOf(c)), H.offerTimeline(per(c.period), rulesOf(c)), "mirror == helpers, timeline case " + i);
  });
  eq(m.timeline({ start_day: "11/02/2026" }, FIX.rules), null);
  eq(m.timeline(null, FIX.rules), null);
});
check("mirror otmCronPlan == fixture.cron == helpers.offerCronPlan on every case (+ the null cases)", () => {
  const m = loadMirror();
  FIX.cron.forEach((c, i) => {
    eq(m.plan(per(c.period), c.today, rulesOf(c)), c.expected, "mirror cron case " + i);
    eq(m.plan(per(c.period), c.today, rulesOf(c)), H.offerCronPlan(per(c.period), c.today, rulesOf(c)), "mirror == helpers, cron case " + i);
  });
  FIX.cronNull.forEach((c, i) => eq(m.plan(per(c.period), c.today, FIX.rules), null, "mirror cronNull case " + i));
});
check("mirror otmPoolIds / otmRollcall / otmStatus == fixture == helpers", () => {
  const m = loadMirror();
  eq(m.poolIds(RC.roster), RC.expectedPoolIds);
  eq(m.poolIds(null), []);
  eq(m.rollcall(per(RC.period), RC.offers, RC.expectedPoolIds), RC.expected);
  eq(m.rollcall(per(RC.period), RC.offers, RC.expectedPoolIds), H.offerRollcall(per(RC.period), RC.offers, RC.expectedPoolIds));
  RC.expectedPoolIds.forEach(id => assert.strictEqual(m.status(per(RC.period), RC.offers, id), H.offerStatus(per(RC.period), RC.offers, id), "status parity " + id));
  eq(m.rollcall({ label: "no dates" }, RC.offers, RC.expectedPoolIds), []);
});
check("PD: the mirror agrees on the seed's two periods - published -> none (status:published) on 9/29 and 10/2; Feb - Apr 2027 -> remind 12/7 + 12/18, close 12/21", () => {
  const m = loadMirror();
  const [p0, p1] = SEED_PD.offerPeriods.map(seedPeriodRow);
  const R = SEED_PD.groupRules.offerPeriods;
  ["2026-09-29", "2026-10-02", "2026-12-07", "2026-12-18", "2026-12-21"].forEach(d => { eq(m.plan(p0, d, R), H.offerCronPlan(p0, d, R), "mirror == helpers, first period @ " + d); eq(m.plan(p1, d, R), H.offerCronPlan(p1, d, R), "mirror == helpers, second period @ " + d); });
  eq(m.plan(p0, "2026-09-29", R).reason, "status:published");
  eq(m.plan(p0, "2026-10-02", R).action, "none");
  eq([m.plan(p1, "2026-12-07", R).action, m.plan(p1, "2026-12-18", R).action, m.plan(p1, "2026-12-21", R).action], ["remind", "remind", "close"]);
});
check("mirror == helpers on 400 seeded random (period start 2026-10 .. 2028-12, length 1-12, close override or computed, reminder lists incl. 0 / duplicates / junk, status, today around the close): timeline and plan identical", () => {
  const m = loadMirror();
  const rnd = prng(140923);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const pad = (n) => String(n).padStart(2, "0");
  for (let k = 0; k < 400; k++) {
    const y = 2026 + Math.floor(rnd() * 3), mo = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 28);
    const start = y + "-" + pad(mo) + "-" + pad(d);
    const period = { label: "r" + k, start_day: start };
    if (rnd() < 0.5) period.length_months = 1 + Math.floor(rnd() * 12);
    if (rnd() < 0.5) period.offers_close_at = H.suAddDays(start, -Math.floor(rnd() * 70));
    if (rnd() < 0.3) period.end_day = H.suAddDays(start, 20 + Math.floor(rnd() * 120));
    if (rnd() < 0.3) period.publish_by = H.suAddDays(start, -Math.floor(rnd() * 40));
    if (rnd() < 0.7) period.status = pick(["upcoming", "upcoming", "closed", "generated", "published"]);
    const rules = { closeWeeksBeforeStart: 1 + Math.floor(rnd() * 8), publishWeeksBeforeStart: 1 + Math.floor(rnd() * 6), remindDaysBeforeClose: [] };
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) rules.remindDaysBeforeClose.push(pick([0, 1, 3, 7, 14, 14, 21, -2, "x", null]));
    if (rnd() < 0.2) rules.lengthMonths = 1 + Math.floor(rnd() * 6);
    const t = H.offerTimeline(period, rules);
    eq(m.timeline(period, rules), t, "random timeline " + k + " " + JSON.stringify(period) + " " + JSON.stringify(rules));
    const today = H.suAddDays(t.offers_close_at, Math.floor(rnd() * 40) - 30);
    eq(m.plan(period, today, rules), H.offerCronPlan(period, today, rules), "random plan " + k + " today " + today + " " + JSON.stringify(period) + " " + JSON.stringify(rules));
  }
});

console.log("\n[C] source pins: send-notification categories, daily-reminder mode offers, README cron, guide, wiring");

const snSrc = read("edge-functions", "send-notification", "index.ts");
const drSrc = read(DR);
const readme = read("edge-functions", "README.md");
const guide = read("docs", "SILVIS-BUILD-GUIDE.md");
const offersRunner = () => {
  const i = drSrc.indexOf("async function runOffers(");
  assert.ok(i > 0, "daily-reminder defines runOffers(");
  const j = drSrc.indexOf("\n// ------", i);
  return drSrc.slice(i, j > i ? j : undefined);
};

check("send-notification: categories offers_reminder and offers_closed exist, both on schedule_updates_email, in the ONE CATEGORIES table; the header names them", () => {
  assert.ok(/offers_reminder:\s*\{\s*pref:\s*"schedule_updates_email",\s*title:\s*"Offers Reminder"/.test(snSrc), "offers_reminder category");
  assert.ok(/offers_closed:\s*\{\s*pref:\s*"schedule_updates_email",\s*title:\s*"Offers Closed"/.test(snSrc), "offers_closed category");
  assert.strictEqual((snSrc.match(/^const CATEGORIES/gm) || []).length, 1);
  assert.ok(/\/\/.*offers_reminder.*offers_closed|\/\/.*offers_closed.*offers_reminder/.test(snSrc.split("\n").slice(0, 60).join(" ")), "the header comment lists the two categories");
  assert.ok(snSrc.indexOf('rest("user_profiles?select=person_id,email&person_id=not.is.null")') > 0, "recipients still come from user_profiles by person_id");
});
check("daily-reminder: mode \"offers\" is dispatched behind the x-cron-secret gate with the shared dryRun flag; an unknown mode is still a 400", () => {
  assert.ok(/mode === "offers"\)\s*return await runOffers\(centralNow\(\), dryRun\)/.test(drSrc), "dispatch: mode offers -> runOffers(centralNow(), dryRun)");
  const gate = drSrc.indexOf('await cronSecretMatches(req.headers.get("x-cron-secret"), CRON_SECRET)'), dispatch = drSrc.indexOf('mode === "offers"');   // constant-time compare since Prompt 16 B5
  assert.ok(gate > 0 && dispatch > gate, "the gate is evaluated before the dispatch");
  assert.ok(/mode must be/.test(drSrc), "an unknown mode is a 400 with the accepted values named");
  assert.ok(drSrc.indexOf('typeof body.dryRun !== "boolean"') > 0 && drSrc.indexOf('typeof body.dryRun !== "boolean"') < dispatch, "dryRun is validated before the dispatch");
});
check("daily-reminder runOffers: reads call_periods (status upcoming) + call_offers + the blob + user_profiles / notification_preferences ONLY - never schedule_days, availability, time_off, east_feed; never generates or publishes", () => {
  const r = offersRunner();
  assert.ok(r.indexOf("call_periods?select=") > 0 && r.indexOf("status=eq.upcoming") > 0, "reads the upcoming periods");
  assert.ok(r.indexOf("call_offers?select=") > 0, "reads the offers inside each period");
  assert.ok(r.indexOf("user_profiles?select=person_id,email") > 0, "addresses from user_profiles by person_id (service role)");
  assert.ok(r.indexOf("notification_preferences?select=person_id,schedule_updates_email") > 0, "the schedule_updates_email flag");
  ["schedule_days", "availability?", "time_off", "east_feed", "shift_trade_requests"].forEach(t => assert.ok(r.indexOf(t) < 0, "runOffers never touches " + t));
  assert.ok(!/call_schedule_data[^\n]*method:/.test(r) && !/schedule_days/.test(r), "the blob is read, never written; schedule_days is never touched (nothing generates or publishes)");
  const writes = r.match(/rest\(\s*[`"]([a-z_]+)[^\n]*\n?[^\n]*method:\s*"(POST|PATCH|DELETE)"/g) || [];
  writes.forEach(w => assert.ok(/^rest\(\s*[`"](call_periods|audit_log)/.test(w), "the only writes are the call_periods CAS and the audit row: " + w));
  assert.ok(r.indexOf("call_offers", r.indexOf("call_offers?select=") + 1) < 0 || !/call_offers[^\n]*method:\s*"(POST|PATCH|DELETE)"/.test(r), "offers are never written by the cron");
});
check("daily-reminder runOffers: the close is a compare-and-swap PATCH (id + status=eq.upcoming -> closed) that a dry run never issues; mail is never sent in a dry run; the audit row names the cron", () => {
  const r = offersRunner();
  assert.ok(/call_periods\?id=eq\.\$\{[^}]+\}&status=eq\.upcoming/.test(r), "CAS filter on the PATCH");
  assert.ok(/method:\s*"PATCH"[\s\S]{0,200}status:\s*"closed"/.test(r), "sets status closed only");
  const patchAt = r.indexOf('method: "PATCH"'), guardAt = r.lastIndexOf("if (!dryRun)", patchAt);
  assert.ok(guardAt > 0 && patchAt - guardAt < 400, "the PATCH sits inside if (!dryRun)");
  assert.ok(/if \(dryRun\) \{[^}]*dry_run_composed/.test(r), "a dry run records dry_run_composed instead of sending");
  assert.ok(/audit_log[\s\S]{0,300}action:\s*"period\.close"/.test(r), "audit_log row period.close");
  assert.ok(/actor_id:\s*"cron"/.test(r), "actor_id cron (no person impersonated)");
});
check("daily-reminder runOffers: the response carries mode / dry_run / today / periods / sent / results; per-recipient rows are keyed by person_id and never carry an address; reminder recipients = not_started pool members, close summary = scheduler/admin profiles", () => {
  const r = offersRunner();
  assert.ok(/mode:\s*"offers",\s*dry_run:\s*dryRun,\s*today\b/.test(r), "response shape starts mode / dry_run / today");
  assert.ok(/periods:\s*\w+\.length|periods:\s*periods\.length/.test(r) && r.indexOf("results") > 0 && /\bsent\b/.test(r), "periods count, sent, results");
  // The rows that reach the response are pushed onto `results` / `recipients`; the function's private address book
  // (emailById / schedulers, like the other modes') never is. An address key in a response row is the defect.
  const pushes = r.match(/\b(results|recipients)\.push\(\{[^}]*\}\)/g) || [];
  assert.ok(pushes.length >= 6, "result / recipient rows are pushed (got " + pushes.length + ")");
  pushes.forEach(p => assert.ok(!/\bemail\b/.test(p) && /person_id|period/.test(p), "response rows are keyed by person_id / period and never carry an address: " + p));
  // \bemail\b = an address key or variable; the status value skipped_no_email and the counter noEmail are not one.
  assert.ok(!/\b(results|recipients)\.push\([^)]*\bemail\b/.test(r), "no address variable reaches a response row");
  assert.ok(/json\(200,\s*\{[^}]*results\s*\}\)/.test(r) && !/json\(200,\s*\{[^}]*\bemail\b/.test(r), "the 200 body carries results, never an address field");
  assert.ok(/status === "not_started"/.test(r), "reminder targets = not_started");
  assert.ok(/role=in\.\(scheduler,admin\)/.test(r) || /role=in\.\(admin,scheduler\)/.test(r), "close summary -> user_profiles with role scheduler / admin");
  assert.ok(r.indexOf("otmPoolIds(") > 0 && r.indexOf("otmRollcall(") > 0 && r.indexOf("otmCronPlan(") > 0, "the runner uses the mirrored maths, not a second copy");
  assert.ok(drSrc.indexOf("go by my rules") > 0 && drSrc.indexOf("freeze on") > 0, "the reminder wording from the prompt (the composers sit beside the runner)");
});
check("no contact data in either function: no e-mail address literal, no phone-shaped literal", () => {
  [snSrc, drSrc].forEach((s, i) => {
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s.replace(/deno\.land\/std@[\d.]+/g, "")), "no address literal in function " + i);
    assert.ok(!/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(s), "no phone literal in function " + i);
  });
});
check("edge-functions/README.md: the silvis-offers-daily cron statement from the prompt (13:00 UTC, Vault secret, body mode offers), the dryRun example, the deploy record placeholder", () => {
  assert.ok(readme.indexOf("cron.schedule('silvis-offers-daily', '0 13 * * *', $$") > 0, "the job name + schedule line");
  assert.ok(readme.indexOf("where name = 'silvis_cron_secret'") > 0, "the Vault lookup");
  assert.ok(readme.indexOf(`body := '{"mode":"offers"}'::jsonb`) > 0, "the body");
  assert.ok(readme.indexOf(`'{"mode":"offers","dryRun":true}'`) > 0, "the dryRun example");
  assert.ok(/Deploy record[^\n]*offers/i.test(readme) || /offers[^\n]*deploy record/i.test(readme), "a deploy-record placeholder for the offers mode");
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(readme.replace(/<[^>]*@[^>]*>/g, "")), "no address in the README (placeholders in angle brackets only)");
});
check("docs/SILVIS-BUILD-GUIDE.md section 17 names the two categories, the cron mode, the helpers and the fixture", () => {
  ["offers_reminder", "offers_closed", "silvis-offers-daily", "offerCronPlan", "offerRollcall", "offer-timeline.json", "offers-timeline.test.js"].forEach(k => assert.ok(guide.indexOf(k) > 0, "guide names " + k));
});
check("wiring: package.json npm test and .github/workflows/build.yml run test/offers-timeline.test.js", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts.test.indexOf("node test/offers-timeline.test.js") > 0, "package.json test chain");
  const wf = read(".github", "workflows", "build.yml");
  assert.ok(wf.indexOf("run: node test/offers-timeline.test.js") > 0, "build.yml step");
  assert.ok(wf.indexOf('"test/offers-timeline.test.js"') > 0 && wf.indexOf('"test/fixtures/offer-timeline.json"') > 0, "build.yml path filters");
});

// ---- Prompt 14 part 4 review fixes (9/23) ----
console.log("\n[D] review fixes: scheduler dedupe, the 400 text, data-driven footer, no dead column, unconditional close summary");

check("review fix 1: scheduler/admin dedupe upgrades an existing no-email key in place (find + upgrade) - never a second recipient row for one key", () => {
  const r = offersRunner();
  assert.ok(!/schedulers\.some\(/.test(r), "no some()-guard dedupe (it pushed a duplicate key when the first account had no email)");
  assert.ok(/schedulers\.find\(\(s\) => s\.key === key\)/.test(r), "find the existing entry by key");
  assert.ok(/if \(!cur\.email && email\) cur\.email = email;/.test(r), "upgrade the address in place, then continue");
});
check("review fix 2: the 400 text names the whole accepted set (\"reminder\" or omitted, \"offers\")", () => {
  assert.ok(/mode must be "reminder" \(or omitted\)[^`]*"offers"/.test(drSrc), "the message names reminder (or omitted) and offers");
  assert.ok(!/mode must be "offers" or omitted/.test(drSrc), "the old text that left out reminder is gone");
});
check("review fix 3: the reminder footer renders the effective offsets (groupRules.offerPeriods.remindDaysBeforeClose) - no hard-coded '14 and 3'", () => {
  const i = drSrc.indexOf("function buildOffersReminder("), j = drSrc.indexOf("function buildOffersClosed(");
  assert.ok(i > 0 && j > i, "both composers exist");
  const fn = drSrc.slice(i, j);
  assert.ok(!/14 and 3 days before/.test(fn), "no literal '14 and 3 days before' in the reminder composer");
  // (pin corrected 9/23: the footer reads `day${...} before`, so the literal "days before" is split by the template)
  assert.ok(/p\.remind_days\.join\(/.test(fn) && /before a period's freeze/.test(fn), "the footer is built from p.remind_days");
  const r = offersRunner();
  assert.ok(/remind_days:\s*\w+/.test(r) && /otmDaysBetween\(/.test(r), "the runner passes the offsets derived from the timeline (remind_on -> days before the close)");
});
check("review fix 4: runOffers no longer selects call_periods.offer_modes (unused by the cron)", () => {
  const r = offersRunner();
  assert.ok(!/offer_modes/.test(r), "offer_modes is not selected");
  assert.ok(/call_periods\?select=id,label,start_day,end_day,offers_close_at,publish_by,status,rules_only_ids&status=eq\.upcoming/.test(r), "the select carries exactly the columns the maths reads");
});
check("review fix 5: the close roll call to scheduler/admin accounts is unconditional (operational notice) - only the reminder path consults schedule_updates_email", () => {
  const r = offersRunner();
  // (pin corrected 9/23: the definition is `const optedOut = (pid` and does not match optedOut\( - so calls only)
  assert.ok(/const optedOut = \(/.test(r), "optedOut is defined once");
  const uses = (r.match(/optedOut\(/g) || []).length;
  assert.strictEqual(uses, 1, "optedOut is consulted exactly once (the reminder loop): got " + uses + " call(s)");
  const at = r.indexOf("for (const s of schedulers)");
  assert.ok(at > 0 && !/optedOut\(/.test(r.slice(at)), "the scheduler loop has no opt-out check");
  assert.ok(/unconditional/.test(r.slice(0, at)), "the decision is stated in a comment beside the loop");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
