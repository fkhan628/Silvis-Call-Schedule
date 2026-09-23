// Silvis - edge-function source pins + the send-notification gate table (audit 2026-09-23, RLS-1).
// Plain Node asserts, no framework, no network, no Deno: reads edge-functions/ and README.md.
//
// Why: send-notification is the app's per-user mail path. Before this fix ANY verified
// session (a viewer, any surgeon) could POST any category with arbitrary text and no
// targetIds and the function broadcast it to every linked surgeon from the group sender;
// office-notifications has a role gate, send-notification had none. The fix is a pure
// policy block in send-notification/index.ts between the markers
// '// @sendGate-start' / '// @sendGate-end' (plain JavaScript, no type annotations) that
// this file extracts, evaluates with new Function and runs against a table of callers:
//   - admin / scheduler: every category, targeted or broadcast;
//   - surgeon: only the categories the app sends on his own behalf, always targeted
//     (index-source.html sendEmailNotif call sites, 2026-09-23):
//       trade_proposed / accepted / declined / applied -> the two parties, caller among them
//       shift_claimed  -> the claimer (caller) + scheduler-linked ids only
//       vacation_logged-> scheduler-linked ids only (the client filters the vacationer out,
//                         so the caller is NOT required to be in the list)
//       test           -> exactly [caller]
//       anything else, or targetIds absent (a broadcast) -> refused
//   - viewer, no user_profiles row, unknown role, or an unlinked surgeon -> refused.
// Source pins keep the gate where it must sit (after the GoTrue check, the role read before
// the body, the party gate after targetIds is normalised and before recipients resolve),
// answered as 403 with the role only in the log, and keep the README's verification steps.
//   node test/edge-functions.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const snSrc = read("edge-functions/send-notification/index.ts");
const readme = read("edge-functions/README.md");

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
};

/* ---- the gate block: extracted, evaluated, run ---- */
const START = "// @sendGate-start", END = "// @sendGate-end";
function gateBlock() {
  // the markers are matched at the start of a line: the file header may quote them in prose
  const i = snSrc.search(/^\/\/ @sendGate-start[ \t]*$/m), j = snSrc.search(/^\/\/ @sendGate-end[ \t]*$/m);
  assert.ok(i >= 0, "send-notification/index.ts carries the marker " + START + " on a line of its own");
  assert.ok(j > i, "send-notification/index.ts carries the marker " + END + " on a line of its own, after the start marker");
  return snSrc.slice(i + START.length, j);
}
let senderRole = null, sendGate = null;
check("send-notification/index.ts: the block between '// @sendGate-start' and '// @sendGate-end' is plain JavaScript and defines senderRole(caller) + sendGate(caller, type, targetIds, schedulerIds)", () => {
  const block = gateBlock();
  assert.ok(!/:\s*(string|number|boolean|unknown|any|null)\b[^=]*[,)=]/.test(block.replace(/\/\/[^\n]*/g, "")), "no TypeScript type annotations inside the block (it must evaluate as JavaScript)");
  const api = new Function(block + "\nreturn { senderRole, sendGate };")();
  assert.strictEqual(typeof api.senderRole, "function", "senderRole is a function");
  assert.strictEqual(typeof api.sendGate, "function", "sendGate is a function");
  senderRole = api.senderRole; sendGate = api.sendGate;
});

const SCHED = ["s1"];                       // person ids linked to an admin/scheduler account
const admin = { role: "admin", personId: "s1" };
const sched = { role: "scheduler", personId: "s1" };
const surgeon = { role: "surgeon", personId: "s3" };
const unlinked = { role: "surgeon", personId: null };
const viewer = { role: "viewer", personId: null };
const norow = { role: null, personId: null };
const allow = (who, type, ids) => assert.strictEqual(sendGate(who, type, ids, SCHED), null, JSON.stringify({ who, type, ids }) + " must be allowed");
const deny = (who, type, ids, why) => {
  const r = sendGate(who, type, ids, SCHED);
  assert.strictEqual(typeof r, "string", JSON.stringify({ who, type, ids }) + " must be refused (" + why + ")");
  assert.ok(r.length > 0, "refusal is a sentence");
  return r;
};
const CATS = ["schedule_published", "manual_edit", "trade_proposed", "trade_accepted", "trade_declined", "trade_applied", "vacation_logged", "shift_reminder", "open_shifts", "shift_claimed", "test"];

check("senderRole: viewer, a missing profile row, an unknown role and an unlinked surgeon are refused; admin, scheduler and a linked surgeon pass", () => {
  if (!senderRole) throw new Error("gate block did not load");
  assert.strictEqual(typeof senderRole(viewer), "string", "viewer refused");
  assert.strictEqual(typeof senderRole(norow), "string", "no profile row refused");
  assert.strictEqual(typeof senderRole(null), "string", "null caller refused");
  assert.strictEqual(typeof senderRole({ role: "owner", personId: "s1" }), "string", "unknown role refused");
  assert.strictEqual(typeof senderRole(unlinked), "string", "unlinked surgeon refused (nothing to send on his own behalf)");
  assert.strictEqual(senderRole(admin), null, "admin passes");
  assert.strictEqual(senderRole(sched), null, "scheduler passes");
  assert.strictEqual(senderRole({ role: "scheduler", personId: null }), null, "an unlinked scheduler account still passes on role alone (office-notifications' posture)");
  assert.strictEqual(senderRole(surgeon), null, "linked surgeon passes the role check (the category gate decides the rest)");
});

check("sendGate: admin and scheduler may send every category, targeted or broadcast", () => {
  if (!sendGate) throw new Error("gate block did not load");
  CATS.forEach((t) => { allow(admin, t, null); allow(sched, t, null); allow(sched, t, ["s2", "s3", "s4"]); allow(admin, t, ["s5"]); });
});

check("sendGate: a viewer / no row / unlinked surgeon is refused for every category even with targetIds", () => {
  if (!sendGate) throw new Error("gate block did not load");
  CATS.forEach((t) => { deny(viewer, t, ["s1"], "viewer"); deny(norow, t, ["s1"], "no row"); deny(unlinked, t, ["s1"], "unlinked"); deny(viewer, t, null, "viewer broadcast"); });
});

check("sendGate: a surgeon never broadcasts - targetIds absent is refused for every category", () => {
  if (!sendGate) throw new Error("gate block did not load");
  CATS.forEach((t) => deny(surgeon, t, null, "surgeon broadcast"));
});

check("sendGate: a surgeon may not send the scheduler's categories (schedule_published, manual_edit, open_shifts, shift_reminder) or an unknown one, even targeted at himself", () => {
  if (!sendGate) throw new Error("gate block did not load");
  ["schedule_published", "manual_edit", "open_shifts", "shift_reminder", "made_up"].forEach((t) => { deny(surgeon, t, ["s3"], t); deny(surgeon, t, ["s1"], t); });
});

check("sendGate: trade_* from a surgeon -> at most two ids and the caller among them (the app sends [from, to])", () => {
  if (!sendGate) throw new Error("gate block did not load");
  ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied"].forEach((t) => {
    allow(surgeon, t, ["s3", "s2"]);
    allow(surgeon, t, ["s2", "s3"]);
    allow(surgeon, t, ["s3"]);
    deny(surgeon, t, ["s2", "s4"], "caller not a party");
    deny(surgeon, t, ["s3", "s2", "s4"], "three ids");
    deny(surgeon, t, ["s3", "s3", "s2", "s4"], "four ids");
  });
});

check("sendGate: shift_claimed from a surgeon -> must include the caller (the claimer) and otherwise only scheduler-linked ids (the app sends uniq(schedulerIds + claimer))", () => {
  if (!sendGate) throw new Error("gate block did not load");
  allow(surgeon, "shift_claimed", ["s1", "s3"]);
  allow(surgeon, "shift_claimed", ["s3", "s1"]);
  allow(surgeon, "shift_claimed", ["s3"]);
  deny(surgeon, "shift_claimed", ["s1"], "claimer missing");
  deny(surgeon, "shift_claimed", ["s1", "s3", "s2"], "another surgeon among the targets");
  deny(surgeon, "shift_claimed", ["s3", "s2"], "another surgeon among the targets");
});

check("sendGate: vacation_logged from a surgeon -> every id scheduler-linked; the caller is NOT required (index-source.html filters the vacationer out of the targets)", () => {
  if (!sendGate) throw new Error("gate block did not load");
  allow(surgeon, "vacation_logged", ["s1"]);
  assert.strictEqual(sendGate(surgeon, "vacation_logged", ["s1", "s6"], ["s1", "s6"]), null, "two scheduler-linked ids are fine");
  deny(surgeon, "vacation_logged", ["s1", "s2"], "a non-scheduler among the targets");
  deny(surgeon, "vacation_logged", ["s3"], "the caller alone is not a scheduler");
  deny(surgeon, "vacation_logged", ["s2"], "another surgeon");
});

check("sendGate: test from a surgeon -> exactly [caller]", () => {
  if (!sendGate) throw new Error("gate block did not load");
  allow(surgeon, "test", ["s3"]);
  deny(surgeon, "test", ["s1"], "someone else");
  deny(surgeon, "test", ["s3", "s1"], "two ids");
  deny(surgeon, "test", ["s2"], "another surgeon");
});

check("sendGate: ids are compared as strings and the scheduler list may be empty (fail closed: nobody is scheduler-linked)", () => {
  if (!sendGate) throw new Error("gate block did not load");
  assert.strictEqual(sendGate({ role: "surgeon", personId: 3 }, "test", [3], []), null, "numeric ids compare as strings");
  assert.strictEqual(typeof sendGate(surgeon, "vacation_logged", ["s1"], []), "string", "an empty scheduler list refuses vacation_logged (fail closed)");
  assert.strictEqual(typeof sendGate(surgeon, "shift_claimed", ["s3", "s1"], []), "string", "an empty scheduler list refuses shift_claimed with a second id");
  assert.strictEqual(sendGate(surgeon, "shift_claimed", ["s3"], []), null, "the claimer alone still passes");
});

/* ---- source pins: where the gate sits in the handler ---- */
check("send-notification/index.ts handler order: GoTrue check -> user id parsed -> user_profiles role/person_id read (service role) -> senderRole 403 BEFORE the body is parsed; sendGate 403 after targetIds is normalised and BEFORE resolveRecipients", () => {
  const h = snSrc.slice(snSrc.indexOf("serve(async (req) =>"));
  const gotrue = h.indexOf("/auth/v1/user");
  const uid = h.indexOf("user.id") >= 0 ? h.indexOf("user.id") : h.indexOf("user?.id");
  const prof = h.indexOf("user_profiles?select=role,person_id&id=eq.");
  const early = h.indexOf("senderRole(");
  const body = h.indexOf("req.json()");
  const legacy = h.indexOf("body.recipients !== undefined");
  const norm = h.indexOf("targetIds = body.targetIds.map(");
  const gate = h.indexOf("sendGate(");
  const resolve = h.indexOf("resolveRecipients(cat, targetIds)");
  assert.ok(gotrue > 0 && uid > gotrue, "the GoTrue response's id is read after the check");
  assert.ok(prof > uid, "the profile is read by the verified user id");
  assert.ok(/encodeURIComponent\(/.test(h.slice(prof, prof + 120)), "the id is URL-encoded in the PostgREST filter");
  assert.ok(early > prof && early < body, "senderRole runs after the profile read and before req.json()");
  assert.ok(legacy > body, "the legacy-recipients 400 is kept after the body parse");
  assert.ok(norm > legacy && gate > norm && gate < resolve, "sendGate runs after targetIds is normalised and before resolveRecipients");
  const emptyShort = h.indexOf("empty targetIds - nothing sent");
  assert.ok(emptyShort > 0 && emptyShort < gate, "the empty-targetIds short circuit (200, sent 0 - defense in depth) stays ahead of the gate: an empty list mails nobody for every caller");
  assert.ok(/json\(403, \{ error: /.test(h.slice(early, early + 400)), "senderRole refusal answers 403");
  assert.ok(/json\(403, \{ error: /.test(h.slice(gate, gate + 400)), "sendGate refusal answers 403");
  assert.ok(/schedulerIds = [^;]*role=in\.\(admin,scheduler\)&person_id=not\.is\.null/.test(h) || /role=in\.\(admin,scheduler\)&person_id=not\.is\.null/.test(snSrc), "scheduler-linked ids come from user_profiles role in (admin, scheduler) with a person_id, read with the service role");
});

check("send-notification/index.ts: the two 403 log lines carry the role and the reason only - no person id, no user id, no address", () => {
  const lines = snSrc.split("\n").filter((l) => /rejected \(403\)/.test(l));
  assert.ok(lines.length >= 2, "two 'rejected (403)' log lines (role check, category gate); found " + lines.length);
  lines.forEach((l) => {
    assert.ok(/role=\$\{/.test(l), "the log line names the role: " + l.trim());
    assert.ok(!/personId|person_id|uid|user\.id|email/.test(l), "the log line carries no person id / user id / address: " + l.trim());
  });
});

check("send-notification/index.ts: the existing contract is kept - 401 for an unverified session, 400 for the legacy recipients payload, 400 for an unknown type, 400 for a missing data.message, skipped_no_email accounting", () => {
  assert.ok(/json\(401, \{ error: "authentication required" \}\)/.test(snSrc), "401 without a bearer token");
  assert.ok(/REJECTED legacy payload with caller-supplied recipients/.test(snSrc) && /legacy payload no longer accepted/.test(snSrc), "legacy 400");
  assert.ok(/unknown notification type/.test(snSrc), "unknown type 400");
  assert.ok(/data\.message \(the composed text\) is required/.test(snSrc), "missing message 400");
  assert.ok(/status: "skipped_no_email"/.test(snSrc), "no-address accounting");
  assert.ok(!/dryRun/.test(snSrc), "send-notification has no dryRun contract (daily-reminder's is untouched) - a send is a send");
});

check("edge-functions/README.md: the gate table names the role/party gate; section 5 lists the safe 403 checks (viewer JWT, surgeon broadcast, surgeon test at someone else); section 6 names the surgeon's own test as the live proof", () => {
  const gateRow = readme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
  assert.ok(/user_profiles\.role/.test(gateRow) && /viewer/.test(gateRow), "the verify_jwt table row for send-notification names user_profiles.role and the viewer refusal: " + gateRow);
  const s5 = readme.slice(readme.indexOf("### send-notification"), readme.indexOf("### daily-reminder"));
  assert.ok(/\$VIEWER_JWT/.test(s5) && /403/.test(s5), "section 5 has the viewer-JWT -> 403 check");
  assert.ok(/\$SURGEON_JWT/.test(s5), "section 5 has the surgeon-JWT checks");
  assert.ok(/"type":"schedule_published"[^\n]*\$SURGEON_JWT|\$SURGEON_JWT[^\n]*"type":"schedule_published"/.test(s5), "section 5: surgeon JWT broadcast of schedule_published -> 403");
  assert.ok(/"type":"test","targetIds":\["s1"\]/.test(s5) || /"type":"test","targetIds":\["<another id>"\]/.test(s5), "section 5: surgeon JWT test at someone else -> 403");
  const s6 = readme.slice(readme.indexOf("## 6."), readme.indexOf("## 7."));
  assert.ok(/surgeon/.test(s6) && /\btest\b/.test(s6) && /own/.test(s6), "section 6 names the surgeon's own `test` send as the live (one-mail) proof");
});

console.log("edge-functions.test.js: " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
