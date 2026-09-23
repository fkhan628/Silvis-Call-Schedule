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
const coordinator = { role: "coordinator", personId: null };   // Prompt 16 A7: the office account - treated like a viewer here
const norow = { role: null, personId: null };
const allow = (who, type, ids) => assert.strictEqual(sendGate(who, type, ids, SCHED), null, JSON.stringify({ who, type, ids }) + " must be allowed");
const deny = (who, type, ids, why) => {
  const r = sendGate(who, type, ids, SCHED);
  assert.strictEqual(typeof r, "string", JSON.stringify({ who, type, ids }) + " must be refused (" + why + ")");
  assert.ok(r.length > 0, "refusal is a sentence");
  return r;
};
const CATS = ["schedule_published", "manual_edit", "trade_proposed", "trade_accepted", "trade_declined", "trade_applied", "vacation_logged", "shift_reminder", "open_shifts", "shift_claimed", "offers_reminder", "offers_closed", "test"];

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

check("P16 A7: a coordinator is refused like a viewer - senderRole names the role, sendGate 403 on every category (targeted, broadcast, vacation_logged to the scheduler included); the source and the README say so", () => {
  if (!sendGate || !senderRole) throw new Error("gate block did not load");
  const r = senderRole(coordinator);
  assert.strictEqual(typeof r, "string", "coordinator refused by the role check");
  assert.ok(/role coordinator may not send notifications/.test(r), "the refusal names the role: " + r);
  CATS.forEach((t) => { deny(coordinator, t, ["s1"], "coordinator targeted"); deny(coordinator, t, null, "coordinator broadcast"); });
  deny(coordinator, "vacation_logged", SCHED, "coordinator vacation_logged to the scheduler");
  assert.ok(/coordinator \(Prompt 16 A7/.test(snSrc), "send-notification/index.ts names the coordinator role beside viewer in the senderRole comment");
  const gateRow = readme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
  assert.ok(/coordinator/.test(gateRow), "README gate row names the coordinator refusal: " + gateRow.slice(0, 120));
});

check("sendGate: a surgeon never broadcasts - targetIds absent is refused for every category", () => {
  if (!sendGate) throw new Error("gate block did not load");
  CATS.forEach((t) => deny(surgeon, t, null, "surgeon broadcast"));
});

check("sendGate: a surgeon may not send the scheduler's categories (schedule_published, manual_edit, open_shifts, shift_reminder, offers_reminder, offers_closed) or an unknown one, even targeted at himself", () => {
  if (!sendGate) throw new Error("gate block did not load");
  ["schedule_published", "manual_edit", "open_shifts", "shift_reminder", "offers_reminder", "offers_closed", "made_up"].forEach((t) => { deny(surgeon, t, ["s3"], t); deny(surgeon, t, ["s1"], t); });
  // Prompt 14 part 4 x the gate: the offers categories name their senders (the Periods Remind button under a
  // scheduler session; the daily offers cron never passes through this gate) - the refusal says so
  ["offers_reminder", "offers_closed"].forEach((t) => assert.ok(/scheduler \(Periods -> Remind\) or the daily offers cron only/.test(deny(surgeon, t, ["s3"], t)), t + " refusal names the two senders"));
  [admin, sched].forEach((who) => ["offers_reminder", "offers_closed"].forEach((t) => { allow(who, t, ["s5"]); allow(who, t, null); }));
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
  const resolve = h.indexOf("resolveRecipients(cat, targetIds, roster.names)");   // three arguments since Prompt 16 B5 (the roster is read once, before the cap)
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

/* =====================================================================
   Prompt 16 B5 (review 2026-09-23 section 3, security minors) - three fixes, each
   with a TypeScript-mirror unit test (the plain-JS block between '// @<tag>-mirror-start'
   and '// @<tag>-mirror-end', extracted and evaluated with new Function like
   test/offers-timeline.test.js does for the offer timeline) plus source pins:
     1. the x-cron-secret compare in daily-reminder / office-notifications is constant time
        (SHA-256 both sides, XOR-fold the bytes) and fails closed on a missing secret;
     2. the log-redaction regex in all three mail functions was the literal 'S+@S+' (no
        backslash) so a Resend error body naming the address logged it - now /\S+@\S+/g;
     3. send-notification: the mail-config 500s sit BELOW the auth / role gate, targetIds is
        capped at roster size + 1, and a trade_* send needs data.trade_id whose
        shift_trade_requests row names exactly the targetIds as its two parties.
   ===================================================================== */
const drSrc = read("edge-functions/daily-reminder/index.ts");
const onSrc = read("edge-functions/office-notifications/index.ts");
const appSrc = read("index-source.html");
const MAIL_FNS = { "send-notification": snSrc, "daily-reminder": drSrc, "office-notifications": onSrc };
const CRON_FNS = { "daily-reminder": drSrc, "office-notifications": onSrc };
const ASYNC = [];
const acheck = (name, fn) => ASYNC.push([name, fn]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockOf = (src, name, tag) => {
  const start = "// @" + tag + "-mirror-start", end = "// @" + tag + "-mirror-end";
  const i = src.search(new RegExp("^" + esc(start) + "[ \\t]*$", "m")), j = src.search(new RegExp("^" + esc(end) + "[ \\t]*$", "m"));
  assert.ok(i >= 0, name + " carries the marker " + start + " on a line of its own");
  assert.ok(j > i, name + " carries the marker " + end + " on a line of its own, after the start marker");
  return src.slice(i + start.length, j);
};
const plainJs = (block, what) => {
  const stripped = block.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  assert.ok(!/:\s*(string|number|boolean|any|unknown|void|Record<|Array<|Uint8Array|Promise<)\b/.test(stripped), what + ": no TypeScript type annotations inside the mirror block");
  assert.ok(!/\bas\s+(any|string|number|const|Error)\b/.test(block), what + ": no 'as' casts inside the mirror block");
};
const identical = (blocks, tag) => blocks.slice(1).forEach(([n, b]) => assert.strictEqual(b, blocks[0][1], n + " @" + tag + " block is byte-identical to " + blocks[0][0] + " (one copy per function, no drift)"));

/* ---- (2) log redaction ---- */
// A provider error body of the shape Resend answers with (the address is made up; this file never leaves the repo).
const RESEND_403 = '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address (holly.powell@example.org). To send emails to other recipients, verify a domain."}';
let redact = null;
check("B5 (2): all three mail functions carry an identical plain-JS '@logRedact' mirror block defining redactAddresses(text)", () => {
  const blocks = Object.entries(MAIL_FNS).map(([n, s]) => [n, blockOf(s, n, "logRedact")]);
  blocks.forEach(([n, b]) => plainJs(b, n));
  identical(blocks, "logRedact");
  const api = new Function(blocks[0][1] + "\nreturn { redactAddresses };")();
  assert.strictEqual(typeof api.redactAddresses, "function", "redactAddresses is a function");
  redact = api.redactAddresses;
});
check("B5 (2): redactAddresses - a Resend error body naming the address logs '<redacted>' (no '@', no local part, no domain survive); text without an address passes through; two addresses -> two tokens; null / undefined -> ''", () => {
  if (!redact) throw new Error("redaction block did not load");
  const out = redact(RESEND_403);
  assert.ok(out.indexOf("<redacted>") >= 0, "the token is present: " + out);
  assert.ok(out.indexOf("@") < 0, "no '@' survives: " + out);
  assert.ok(out.indexOf("holly.powell") < 0 && out.indexOf("example.org") < 0, "neither half of the address survives: " + out);
  assert.strictEqual(redact("HTTP 429 rate limited"), "HTTP 429 rate limited", "no address -> unchanged");
  assert.strictEqual(redact("to a@b.c and d@e.f"), "to <redacted> and <redacted>", "every address, not only the first (the g flag)");
  assert.strictEqual(redact(null), ""); assert.strictEqual(redact(undefined), "");
  // why this test exists: the literal 'S+@S+' (a run of capital S) matched nothing in that body
  assert.strictEqual(RESEND_403.replace(/S+@S+/g, "<redacted>"), RESEND_403, "the old regex left the body untouched");
});
// Review 2026-09-23 (B5 finding): the provider-error line truncates the body to 160 chars. Redaction must run on the
// WHOLE body first - a cut that lands inside an address (before or right after the '@') leaves a bare local part that
// /\S+@\S+/ cannot match. Fixture: the address starts at index 147, so the 160-char cut falls inside its local part.
const STRADDLE_403 = '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to the address you verified with the provider, which is (holly.powell.long.local.part@example.org). Verify a domain to send further."}';
check("B5 (2): redaction survives the 160-char log truncation - redact(body).slice(0, 160) keeps no local-part fragment, no '@' and no domain when the address straddles the cut; a cut at every length never leaks; the old slice-then-redact order provably leaked the local part", () => {
  if (!redact) throw new Error("redaction block did not load");
  const local = "holly.powell.long.local.part@";
  const at = STRADDLE_403.indexOf(local);
  assert.ok(at > 120 && at < 160 && at + local.length > 160, "the fixture's address straddles index 160 (starts at " + at + ")");
  const logged = redact(STRADDLE_403).slice(0, 160);
  assert.ok(logged.indexOf("holly") < 0 && logged.indexOf("powell") < 0 && logged.indexOf("local.part") < 0, "no local-part fragment survives: " + logged);
  assert.ok(logged.indexOf("@") < 0 && logged.indexOf("example.org") < 0, "no '@' / domain survives: " + logged);
  for (let n = 1; n <= STRADDLE_403.length; n++) {
    const l = redact(STRADDLE_403).slice(0, n);
    assert.ok(l.indexOf("holly") < 0 && l.indexOf("@") < 0 && l.indexOf("example.org") < 0, "a cut at " + n + " leaks: " + l);
  }
  // why this test exists: slicing FIRST left the local part in the log line
  const leaked = redact(STRADDLE_403.slice(0, 160));
  assert.ok(leaked.indexOf("holly.powell") >= 0 && leaked.indexOf("<redacted>") < 0, "the old slice-then-redact order leaked the local part: " + leaked);
});
check("B5 (2) source pins: no mail function keeps the backslash-less literal 'S+@S+'; sendEmail's provider-error line is redactAddresses(body).slice(0, 160) (redact the whole body, THEN truncate; no slice-then-redact call remains) and its catch line goes through redactAddresses(", () => {
  Object.entries(MAIL_FNS).forEach(([n, s]) => {
    assert.ok(!/[^\\]S\+@S\+/.test(s), n + ": the literal S+@S+ is gone");
    const se = s.slice(s.indexOf("async function sendEmail("));
    assert.ok(se.length > 100, n + ": sendEmail found");
    const fn = se.slice(0, se.indexOf("\n}\n") + 3);
    assert.ok(/provider HTTP \$\{res\.status\} \$\{redactAddresses\(body\)\.slice\(0, 160\)\}/.test(fn), n + ": the provider-error log line redacts the whole body and truncates afterwards");
    assert.ok(!/redactAddresses\(body\.slice\(/.test(fn), n + ": no slice-then-redact call remains");
    assert.ok(/console\.error\(`\[email\] \$\{logKey\}: \$\{redactAddresses\(/.test(fn), n + ": the catch log line is redacted");
  });
});

/* ---- (1) constant-time cron-secret compare ---- */
let cronMatch = null, ctEq = null, sha = null;
check("B5 (1): both cron functions carry an identical plain-JS '@cronSecret' mirror block: sha256Bytes over crypto.subtle.digest('SHA-256'), bytesEqualConstantTime (an |= XOR fold, no return / break inside the loop) and cronSecretMatches(given, expected)", () => {
  const blocks = Object.entries(CRON_FNS).map(([n, s]) => [n, blockOf(s, n, "cronSecret")]);
  blocks.forEach(([n, b]) => plainJs(b, n));
  identical(blocks, "cronSecret");
  const b = blocks[0][1];
  assert.ok(/crypto\.subtle\.digest\("SHA-256"/.test(b), "SHA-256 through crypto.subtle.digest");
  const cmp = b.slice(b.indexOf("function bytesEqualConstantTime("));
  assert.ok(cmp.length > 50, "bytesEqualConstantTime defined");
  const body = cmp.slice(0, cmp.indexOf("\n}"));
  const loop = body.slice(body.indexOf("for ("));
  assert.ok(loop.length > 10, "the compare has a loop");
  assert.ok(/\|=/.test(loop), "the loop XOR-folds with |=");
  assert.ok(!/\b(return|break)\b/.test(loop.slice(0, loop.lastIndexOf("return"))), "no return / break inside the loop (no early exit)");
  const api = new Function(b + "\nreturn { cronSecretMatches, bytesEqualConstantTime, sha256Bytes };")();
  ["cronSecretMatches", "bytesEqualConstantTime", "sha256Bytes"].forEach((k) => assert.strictEqual(typeof api[k], "function", k + " is a function"));
  cronMatch = api.cronSecretMatches; ctEq = api.bytesEqualConstantTime; sha = api.sha256Bytes;
});
const SECRET = "a-32-character-secret-for-tests!";
acheck("B5 (1): cronSecretMatches - the configured value -> true; a wrong value, a prefix, a superset, a one-character header, an empty header, a missing header (null / undefined) -> false", async () => {
  if (!cronMatch) throw new Error("cron-secret block did not load");
  assert.strictEqual(await cronMatch(SECRET, SECRET), true, "equal");
  assert.strictEqual(await cronMatch("b-32-character-secret-for-tests!", SECRET), false, "one character off");
  assert.strictEqual(await cronMatch(SECRET.slice(0, 31), SECRET), false, "a prefix");
  assert.strictEqual(await cronMatch(SECRET + "x", SECRET), false, "a superset");
  assert.strictEqual(await cronMatch("a", SECRET), false, "a short header");
  assert.strictEqual(await cronMatch("", SECRET), false, "an empty header");
  assert.strictEqual(await cronMatch(null, SECRET), false, "no header (req.headers.get -> null)");
  assert.strictEqual(await cronMatch(undefined, SECRET), false, "undefined header");
  assert.strictEqual(await cronMatch(123, SECRET), false, "a non-string header");
});
acheck("B5 (1): cronSecretMatches fails closed - an empty / missing configured secret refuses everything, even an empty or identical header", async () => {
  if (!cronMatch) throw new Error("cron-secret block did not load");
  assert.strictEqual(await cronMatch("", ""), false, "both empty");
  assert.strictEqual(await cronMatch("x", ""), false, "secret unset");
  assert.strictEqual(await cronMatch(null, null), false, "both null");
  assert.strictEqual(await cronMatch(undefined, undefined), false, "both undefined");
  assert.strictEqual(await cronMatch(SECRET, 42), false, "a non-string secret");
});
acheck("B5 (1): sha256Bytes yields 32 deterministic bytes (the known digest of 'abc'); bytesEqualConstantTime is true only for equal bytes of equal length", async () => {
  if (!sha || !ctEq) throw new Error("cron-secret block did not load");
  const d = await sha("abc");
  assert.ok(d instanceof Uint8Array && d.length === 32, "32 bytes");
  assert.strictEqual(Array.from(d).map((x) => x.toString(16).padStart(2, "0")).join(""), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256('abc')");
  assert.deepStrictEqual(Array.from(await sha("abc")), Array.from(d), "deterministic");
  assert.strictEqual(ctEq(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.strictEqual(ctEq(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.strictEqual(ctEq(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false, "a shorter array is not a prefix match");
  assert.strictEqual(ctEq(new Uint8Array([]), new Uint8Array([])), true, "two empty arrays are equal (cronSecretMatches never gets here: it refuses empties first)");
});
check("B5 (1) source pins: daily-reminder gate is await cronSecretMatches(req.headers.get(\"x-cron-secret\"), CRON_SECRET) ahead of the try (config checks, body); office-notifications authorize() judges the header with await cronSecretMatches(hdr, CRON_SECRET); no === / !== against CRON_SECRET remains in either", () => {
  const h = drSrc.slice(drSrc.indexOf("serve(async (req) =>"));
  const gate = h.indexOf('await cronSecretMatches(req.headers.get("x-cron-secret"), CRON_SECRET)');
  assert.ok(gate > 0, "daily-reminder uses the constant-time compare in its handler");
  assert.ok(gate < h.indexOf("try {"), "the gate sits before the try block (before the config checks and the body)");
  assert.ok(/json\(401, \{ error: "unauthorized" \}\)/.test(h.slice(gate, gate + 300)), "a refusal is still 401 unauthorized");
  const a = onSrc.slice(onSrc.indexOf("async function authorize("));
  assert.ok(/await cronSecretMatches\(hdr, CRON_SECRET\)/.test(a.slice(0, 700)), "office-notifications authorize uses the compare on the presented header");
  Object.entries(CRON_FNS).forEach(([n, s]) => assert.ok(!/[!=]==\s*CRON_SECRET\b|\bCRON_SECRET\s*[!=]==/.test(s), n + ": no string equality on CRON_SECRET"));
});

/* ---- (3) send-notification: trade_id + party check, the cap, config checks below the gate ---- */
let isTradeType = null, tradeIdOf = null, targetCap = null, tradePartyCheck = null;
check("B5 (3): the sendGate block also defines isTradeType(type), tradeIdOf(data), targetCap(rosterCount) and tradePartyCheck(trade, targetIds)", () => {
  const api = new Function(gateBlock() + "\nreturn { isTradeType, tradeIdOf, targetCap, tradePartyCheck };")();
  ["isTradeType", "tradeIdOf", "targetCap", "tradePartyCheck"].forEach((k) => assert.strictEqual(typeof api[k], "function", k + " is a function"));
  isTradeType = api.isTradeType; tradeIdOf = api.tradeIdOf; targetCap = api.targetCap; tradePartyCheck = api.tradePartyCheck;
});
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
check("B5 (3): isTradeType - the four trade_* categories only", () => {
  if (!isTradeType) throw new Error("gate block did not load");
  ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied"].forEach((t) => assert.strictEqual(isTradeType(t), true, t));
  ["shift_claimed", "vacation_logged", "test", "schedule_published", "trade", "", null, undefined].forEach((t) => assert.strictEqual(isTradeType(t), false, String(t)));
});
check("B5 (3): tradeIdOf - a uuid string (trimmed, either case) -> the id; missing / empty / non-uuid / non-string / no data -> null", () => {
  if (!tradeIdOf) throw new Error("gate block did not load");
  assert.strictEqual(tradeIdOf({ trade_id: UUID }), UUID);
  assert.strictEqual(tradeIdOf({ trade_id: "  " + UUID.toUpperCase() + " " }), UUID.toUpperCase());
  [{}, { trade_id: "" }, { trade_id: "abc" }, { trade_id: 12 }, { trade_id: null }, { trade_id: UUID + "'" }, { trade_ids: [UUID] }, null, undefined, "x"].forEach((d) => assert.strictEqual(tradeIdOf(d), null, JSON.stringify(d)));
});
check("B5 (3): targetCap - roster size + 1 (6 -> 7, 8 -> 9, 1 -> 2); an unknown roster (0 / null / NaN / negative) falls back to the group's six + 1 = 7", () => {
  if (!targetCap) throw new Error("gate block did not load");
  assert.strictEqual(targetCap(6), 7); assert.strictEqual(targetCap(8), 9); assert.strictEqual(targetCap(1), 2); assert.strictEqual(targetCap("6"), 7);
  [0, null, undefined, NaN, -3, "junk"].forEach((n) => assert.strictEqual(targetCap(n), 7, String(n)));
});
check("B5 (3): tradePartyCheck - the row's two parties == targetIds as a set (order / duplicates / number-vs-string ignored) passes; a third id, one party only, a different party, a broadcast (null), an empty list, a missing row or a row without both parties -> a refusal sentence", () => {
  if (!tradePartyCheck) throw new Error("gate block did not load");
  const row = { from_surgeon_id: "s3", to_surgeon_id: "s2" };
  assert.strictEqual(tradePartyCheck(row, ["s3", "s2"]), null);
  assert.strictEqual(tradePartyCheck(row, ["s2", "s3"]), null, "order");
  assert.strictEqual(tradePartyCheck(row, ["s2", "s3", "s2"]), null, "a duplicate of a party");
  assert.strictEqual(tradePartyCheck({ from_surgeon_id: 3, to_surgeon_id: 2 }, ["3", "2"]), null, "numbers compare as strings");
  const refused = (trade, ids, why) => { const r = tradePartyCheck(trade, ids); assert.strictEqual(typeof r, "string", why); assert.ok(r.length > 0, why + " is a sentence"); };
  refused(row, ["s3", "s2", "s4"], "a third id");
  refused(row, ["s3"], "one party only");
  refused(row, ["s3", "s4"], "a different party");
  refused(row, ["s1", "s4"], "neither party");
  refused(row, null, "a broadcast");
  refused(row, [], "an empty list");
  refused(null, ["s3", "s2"], "no row (unknown trade_id)");
  refused({ from_surgeon_id: "s3" }, ["s3", "s2"], "a row without a to party");
  refused({ from_surgeon_id: "s3", to_surgeon_id: null }, ["s3"], "a null party");
});
check("B5 (3) handler order: SUPABASE_URL / service-key check -> GoTrue -> role read -> senderRole 403 -> ONLY THEN the RESEND_API_KEY / NOTIFICATION_FROM_EMAIL 500s (an unauthenticated caller learns nothing about configuration) -> body -> targetIds normalised -> roster read -> cap 400 -> sendGate 403 -> trade_*: tradeIdOf 400 -> shift_trade_requests read by encoded id (service role, the two party columns) -> tradePartyCheck 403 -> resolveRecipients(cat, targetIds, roster.names)", () => {
  const h = snSrc.slice(snSrc.indexOf("serve(async (req) =>"));
  const sb = h.indexOf("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const gotrue = h.indexOf("/auth/v1/user");
  const early = h.indexOf("senderRole(");
  const resend = h.indexOf('"RESEND_API_KEY not configured"');
  const from = h.indexOf('"NOTIFICATION_FROM_EMAIL not configured"');
  const body = h.indexOf("req.json()");
  const norm = h.indexOf("targetIds = body.targetIds.map(");
  const roster = h.indexOf("await loadRoster()");
  const cap = h.indexOf("targetCap(");
  const gate = h.indexOf("sendGate(");
  const tid = h.indexOf("tradeIdOf(data)");
  const tread = h.indexOf("shift_trade_requests?select=from_surgeon_id,to_surgeon_id&id=eq.${encodeURIComponent(tradeId)}");
  const party = h.indexOf("tradePartyCheck(");
  const resolve = h.indexOf("resolveRecipients(cat, targetIds, roster.names)");
  assert.ok(sb > 0 && sb < gotrue, "the injected-key check stays first (the GoTrue call needs it)");
  assert.ok(early > gotrue, "senderRole after GoTrue");
  assert.ok(resend > early && from > resend && resend < body, "the two mail-config 500s sit after the role gate and before the body is read");
  assert.strictEqual((h.match(/not configured"/g) || []).length, 2, "exactly two mail-config checks in the handler");
  assert.ok(norm > body && roster > norm && cap > roster && cap < gate, "roster read, then the cap, after normalisation and before the party gate");
  assert.ok(/json\(400, \{ error: /.test(h.slice(cap, cap + 400)), "over the cap answers 400");
  assert.ok(gate > cap && tid > gate && tread > tid && party > tread && resolve > party, "sendGate -> tradeIdOf -> row read -> tradePartyCheck -> resolveRecipients");
  assert.ok(/isTradeType\(type\)/.test(h.slice(gate, tid)), "the trade checks are gated on isTradeType(type)");
  assert.ok(/json\(400, \{ error: /.test(h.slice(tid, tid + 400)), "a missing / malformed trade_id answers 400");
  assert.ok(/json\(403, \{ error: `not allowed: /.test(h.slice(party, party + 400)), "a party mismatch answers 403 like the other gate refusals");
  assert.ok(/async function loadRoster\(\)[\s\S]{0,400}call_schedule_data\?select=data&id=eq\.main/.test(snSrc), "loadRoster reads the blob once (names + count)");
  assert.ok(!/resolveRecipients\(cat, targetIds\)/.test(h), "the old two-argument resolveRecipients call is gone (the roster is read once, before the cap)");
  assert.ok(!/loadRosterNames\(/.test(snSrc), "loadRosterNames is replaced by loadRoster");
});
check("B5 (3): the new refusal log lines carry the role, the type and counts only - no person id, no user id, no trade id, no address", () => {
  const lines = snSrc.split("\n").filter((l) => /rejected \((400|403)\)/.test(l));
  assert.ok(lines.length >= 5, "five refusal log lines (role, cap, gate, trade_id, party); found " + lines.length);
  lines.forEach((l) => {
    assert.ok(/role=\$\{/.test(l), "the log line names the role: " + l.trim());
    assert.ok(!/personId|person_id|uid|user\.id|email|tradeId|trade_id\}/.test(l), "the log line carries no person id / user id / trade id / address: " + l.trim());
  });
});
check("B5 (3): index-source.html - every trade_* sendEmailNotif call passes data.trade_id (the shift_trade_requests row id) so the v6 function accepts it; there is no trade_accepted mail call", () => {
  const calls = appSrc.split("\n").filter((l) => /sendEmailNotif\("trade_/.test(l));
  assert.strictEqual(calls.length, 4, "four trade_* mail calls (proposed, applied, applied-as-a-unit, declined); found " + calls.length);
  calls.forEach((l) => assert.ok(/trade_id:\s*(first|t)\.id\b/.test(l), "the call carries trade_id: <row>.id -> " + l.trim().slice(0, 140)));
  assert.strictEqual(calls.filter((l) => /"trade_proposed"/.test(l)).length, 1);
  assert.strictEqual(calls.filter((l) => /"trade_applied"/.test(l)).length, 2);
  assert.strictEqual(calls.filter((l) => /"trade_declined"/.test(l)).length, 1);
  assert.ok(!/sendEmailNotif\("trade_accepted"/.test(appSrc), "no trade_accepted mail call (the app posts the in-app note only)");
});
check("B5: edge-functions/README.md - section 5 lists the new refusals with their codes (trade_* without data.trade_id -> 400, a trade_id whose parties are not the targetIds -> 403, targetIds over the cap -> 400, a wrong / missing x-cron-secret -> 401 unchanged) and section 3 carries the pending deploy-record line (send-notification v6 pending, daily-reminder v5 pending, office-notifications pending)", () => {
  const s5 = readme.slice(readme.indexOf("### send-notification"), readme.indexOf("### daily-reminder"));
  assert.ok(/trade_id/.test(s5) && /400/.test(s5), "section 5: trade_* without data.trade_id -> 400");
  assert.ok(/parties/.test(s5) && /403/.test(s5), "section 5: a party mismatch -> 403");
  assert.ok(/cap/.test(s5) && /roster size \+ 1/.test(s5), "section 5: the cap (roster size + 1) -> 400");
  assert.ok(/configuration/.test(s5), "section 5 says an unauthenticated caller sees 401 before any configuration check");
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  assert.ok(/v6 pending/.test(s3), "section 3: 'v6 pending' for send-notification");
  assert.ok(/daily-reminder[^\n]*v5 pending|v5 pending[^\n]*daily-reminder/.test(s3), "section 3: daily-reminder v5 pending");
  assert.ok(/office-notifications[^\n]*pending/.test(s3), "section 3: office-notifications pending");
  assert.ok(/Prompt 16/.test(s3) && /constant-time|timing-safe/.test(s3), "section 3 names the B5 change");
  const dr = readme.slice(readme.indexOf("### daily-reminder"), readme.indexOf("## 6."));
  assert.ok(/wrong secret|wrong x-cron-secret|wrong value/i.test(dr) && /401/.test(dr), "section 5 daily-reminder: a wrong secret -> 401 (the same 401 as no secret)");
});

(async () => {
  for (const [name, fn] of ASYNC) {
    try { await fn(); passed++; console.log("ok   " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
  }
  console.log("edge-functions.test.js: " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
