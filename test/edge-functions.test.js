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
const RESEND_403 = '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address (quill.marlow@example.org). To send emails to other recipients, verify a domain."}';
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
  assert.ok(out.indexOf("quill.marlow") < 0 && out.indexOf("example.org") < 0, "neither half of the address survives: " + out);
  assert.strictEqual(redact("HTTP 429 rate limited"), "HTTP 429 rate limited", "no address -> unchanged");
  assert.strictEqual(redact("to a@b.c and d@e.f"), "to <redacted> and <redacted>", "every address, not only the first (the g flag)");
  assert.strictEqual(redact(null), ""); assert.strictEqual(redact(undefined), "");
  // why this test exists: the literal 'S+@S+' (a run of capital S) matched nothing in that body
  assert.strictEqual(RESEND_403.replace(/S+@S+/g, "<redacted>"), RESEND_403, "the old regex left the body untouched");
});
// Review 2026-09-23 (B5 finding): the provider-error line truncates the body to 160 chars. Redaction must run on the
// WHOLE body first - a cut that lands inside an address (before or right after the '@') leaves a bare local part that
// /\S+@\S+/ cannot match. Fixture: the address starts at index 147, so the 160-char cut falls inside its local part.
const STRADDLE_403 = '{"statusCode":403,"name":"validation_error","message":"You can only send testing emails to the address you verified with the provider, which is (quill.marlow.long.local.part@example.org). Verify a domain to send further."}';
check("B5 (2): redaction survives the 160-char log truncation - redact(body).slice(0, 160) keeps no local-part fragment, no '@' and no domain when the address straddles the cut; a cut at every length never leaks; the old slice-then-redact order provably leaked the local part", () => {
  if (!redact) throw new Error("redaction block did not load");
  const local = "quill.marlow.long.local.part@";
  const at = STRADDLE_403.indexOf(local);
  assert.ok(at > 120 && at < 160 && at + local.length > 160, "the fixture's address straddles index 160 (starts at " + at + ")");
  const logged = redact(STRADDLE_403).slice(0, 160);
  assert.ok(logged.indexOf("quill") < 0 && logged.indexOf("marlow") < 0 && logged.indexOf("local.part") < 0, "no local-part fragment survives: " + logged);
  assert.ok(logged.indexOf("@") < 0 && logged.indexOf("example.org") < 0, "no '@' / domain survives: " + logged);
  for (let n = 1; n <= STRADDLE_403.length; n++) {
    const l = redact(STRADDLE_403).slice(0, n);
    assert.ok(l.indexOf("quill") < 0 && l.indexOf("@") < 0 && l.indexOf("example.org") < 0, "a cut at " + n + " leaks: " + l);
  }
  // why this test exists: slicing FIRST left the local part in the log line
  const leaked = redact(STRADDLE_403.slice(0, 160));
  assert.ok(leaked.indexOf("quill.marlow") >= 0 && leaked.indexOf("<redacted>") < 0, "the old slice-then-redact order leaked the local part: " + leaked);
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
const UUID = "00000000-0000-4000-8000-0000000000b5"; // a fixture id (the privacy scan reads any other uuid as a session id)
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
/* ---- Prompt 19 S3 (Faraz 9/24): an accepted give's trade_applied mail also goes to the scheduler(s) ----
   The client sends the give's trade_applied to [from, to, ...schedulerIds]. The gate keeps every B5 refusal and widens
   exactly one: on trade_applied (only) scheduler-linked ids may ride BESIDE the two parties - the parties stay required,
   nobody else is allowed; the other trade_* categories stay "exactly the two parties". Prepared as v7, NOT deployed. */
let tradeExtraIds = null;
check("Prompt 19 S3: the sendGate block defines tradeExtraIds(type, schedulerIds) - trade_applied -> the scheduler-linked ids (as strings); every other type, the other trade_* included, -> [] (a missing list -> [])", () => {
  const api = new Function(gateBlock() + "\nreturn { tradeExtraIds: typeof tradeExtraIds === 'function' ? tradeExtraIds : null };")();
  assert.strictEqual(typeof api.tradeExtraIds, "function", "tradeExtraIds is a function in the @sendGate block");
  tradeExtraIds = api.tradeExtraIds;
  assert.deepStrictEqual(tradeExtraIds("trade_applied", ["s1", 6]), ["s1", "6"]);
  assert.deepStrictEqual(tradeExtraIds("trade_applied", null), []);
  ["trade_proposed", "trade_accepted", "trade_declined", "shift_claimed", "vacation_logged", "test", ""].forEach((t) => assert.deepStrictEqual(tradeExtraIds(t, ["s1"]), [], t));
});
check("Prompt 19 S3: tradePartyCheck(trade, targetIds, extraIds) - with extraIds (trade_applied's scheduler ids) the two parties are REQUIRED and the extra ids ALLOWED, nobody else; without extraIds the check is exactly B5's (a scheduler id beside the parties is refused)", () => {
  if (!tradePartyCheck) throw new Error("gate block did not load");
  const row = { from_surgeon_id: "s3", to_surgeon_id: "s2" };
  const refused = (trade, ids, extra, why) => { const r = tradePartyCheck(trade, ids, extra); assert.strictEqual(typeof r, "string", why + " must be refused"); assert.ok(r.length > 0, why + " is a sentence"); return r; };
  assert.strictEqual(tradePartyCheck(row, ["s3", "s2", "s1"], ["s1"]), null, "the parties + the scheduler");
  assert.strictEqual(tradePartyCheck(row, ["s1", "s2", "s3"], ["s1"]), null, "order");
  assert.strictEqual(tradePartyCheck(row, ["s3", "s2", "s1", "s6"], ["s1", "s6"]), null, "two scheduler-linked ids");
  assert.strictEqual(tradePartyCheck(row, ["s3", "s2"], ["s1"]), null, "the scheduler is allowed, not required (a failed lookup mails the parties)");
  assert.strictEqual(tradePartyCheck({ from_surgeon_id: "s1", to_surgeon_id: "s2" }, ["s1", "s2"], ["s1"]), null, "a scheduler who is a party counts once");
  assert.ok(/both of the trade's parties|two parties/.test(refused(row, ["s2", "s1"], ["s1"], "a party missing (the giver)")));
  refused(row, ["s3", "s1"], ["s1"], "a party missing (the receiver)");
  refused(row, ["s3", "s2", "s4"], ["s1"], "a non-scheduler third id");
  refused(row, ["s3", "s2", "s1", "s4"], ["s1"], "a non-scheduler fourth id");
  refused(row, ["s3", "s2", "s1"], [], "a scheduler id with no extra list (every other trade_* category)");
  refused(row, ["s3", "s2", "s1"], undefined, "a scheduler id without the third argument (B5's call shape)");
  refused(row, null, ["s1"], "a broadcast");
  refused(row, [], ["s1"], "an empty list");
  refused(null, ["s3", "s2", "s1"], ["s1"], "no row (unknown trade_id)");
  refused({ from_surgeon_id: "s3", to_surgeon_id: null }, ["s3", "s1"], ["s1"], "a row without both parties");
});
check("Prompt 19 S3 review: tradePartyCheck's fourth argument senderId - a surgeon sender (non-null senderId) must be one of the row's two parties even when scheduler ids may ride along (a surgeon-role account linked to a scheduler id cannot mail about someone else's trade); null (admin / scheduler caller) skips it; tradeNamesOthers(trade, targetIds) - true only when targetIds names an id outside the row's two parties", () => {
  const api = new Function(gateBlock() + "\nreturn { tradeNamesOthers: typeof tradeNamesOthers === 'function' ? tradeNamesOthers : null };")();
  if (!tradePartyCheck) throw new Error("gate block did not load");
  const row = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  const r1 = tradePartyCheck(row, ["s1", "s2", "s3"], ["s1"], "s1");
  assert.strictEqual(typeof r1, "string", "a surgeon sender who is not a party is refused (s1 linked to a scheduler account, trade s2 -> s3)");
  assert.ok(/sender must be a party/.test(r1), r1);
  assert.strictEqual(typeof tradePartyCheck(row, ["s2", "s3"], [], "s4"), "string", "a non-party sender, v6 shape");
  assert.strictEqual(tradePartyCheck(row, ["s1", "s2", "s3"], ["s1"], "s2"), null, "the giver");
  assert.strictEqual(tradePartyCheck(row, ["s1", "s2", "s3"], ["s1"], "s3"), null, "the receiver");
  assert.strictEqual(tradePartyCheck(row, ["s1", "s2", "s3"], ["s1"], null), null, "an admin / scheduler caller (no sender check)");
  assert.strictEqual(tradePartyCheck(row, ["s2", "s3"]), null, "B5's two-argument call shape is unchanged");
  assert.strictEqual(typeof api.tradeNamesOthers, "function", "tradeNamesOthers is a function in the @sendGate block");
  assert.strictEqual(api.tradeNamesOthers(row, ["s3", "s2"]), false, "exactly the parties");
  assert.strictEqual(api.tradeNamesOthers(row, ["s3", "s3"]), false, "a subset of the parties");
  assert.strictEqual(api.tradeNamesOthers(row, ["s3", "s2", "s1"]), true, "a third id");
  assert.strictEqual(api.tradeNamesOthers(row, null), false, "a broadcast (refused elsewhere)");
  assert.strictEqual(api.tradeNamesOthers(null, ["s1"]), false, "no row (refused elsewhere)");
});
check("Prompt 19 S3: sendGate - a surgeon's trade_applied may ALSO carry scheduler-linked ids (himself required, at most the two parties besides the schedulers; an empty scheduler list fails closed); trade_proposed / trade_accepted / trade_declined keep 'the two parties only'", () => {
  if (!sendGate) throw new Error("gate block did not load");
  allow(surgeon, "trade_applied", ["s3", "s2", "s1"]);
  allow(surgeon, "trade_applied", ["s1", "s2", "s3"]);
  allow(surgeon, "trade_applied", ["s2", "s3"]);
  assert.strictEqual(sendGate(surgeon, "trade_applied", ["s3", "s2", "s1", "s6"], ["s1", "s6"]), null, "two scheduler-linked ids beside the parties");
  deny(surgeon, "trade_applied", ["s3", "s2", "s4"], "a non-scheduler third id");
  deny(surgeon, "trade_applied", ["s2", "s1"], "the caller is not among the targets");
  deny(surgeon, "trade_applied", ["s3", "s2", "s1", "s4"], "a non-scheduler beside the scheduler");
  assert.strictEqual(typeof sendGate(surgeon, "trade_applied", ["s3", "s2", "s1"], []), "string", "an empty scheduler list refuses the third id (fail closed)");
  ["trade_proposed", "trade_accepted", "trade_declined"].forEach((t) => deny(surgeon, t, ["s3", "s2", "s1"], t + " to a scheduler beside the parties"));
});
check("Prompt 19 S3 source pins - send-notification: after the trade row is read, extraIds = tradeExtraIds(type, ...) ONLY when trade_applied names an id beyond the two parties (a v6-shaped send never depends on the extra lookup); a privileged caller reads the scheduler ids there; tradePartyCheck(trade, targetIds, extraIds, senderId) with the surgeon sender's person id (null when privileged); the surgeon path keeps the list read before sendGate; the header documents v7", () => {
  const h = snSrc.slice(snSrc.indexOf("serve(async (req) =>"));
  const party = h.indexOf("tradePartyCheck(");
  assert.ok(party > 0, "tradePartyCheck is called in the handler");
  const ex = h.indexOf('const extraIds = type === "trade_applied" && tradeNamesOthers(trade, targetIds) ? tradeExtraIds(type, privileged ? await loadSchedulerIds() : schedulerIds) : [];');
  assert.ok(ex > 0, "the extra ids are read only for a trade_applied that names someone beyond the parties (a scheduler / admin caller reads them there; a surgeon's list was read before sendGate)");
  assert.ok(ex > h.indexOf("shift_trade_requests?select=from_surgeon_id,to_surgeon_id") && ex < party, "after the trade row is read, before the party check");
  assert.ok(h.includes("const partyDenied = tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId);"), "tradePartyCheck gets the extra ids and the surgeon sender");
  assert.ok(!h.includes('type === "trade_applied" && privileged ? await loadSchedulerIds()'), "no unconditional privileged lookup");
  assert.ok(/const schedulerIds = privileged \? \[\] : await loadSchedulerIds\(\);/.test(h), "the surgeon path is unchanged");
  assert.ok(/Prompt 19 S3/.test(snSrc) && /\bv7\b/.test(snSrc), "the file header names the Prompt 19 S3 change (v7)");
  assert.ok(/trade_applied[^\n]*scheduler/.test(snSrc.slice(0, snSrc.indexOf("import "))), "the payload contract names trade_applied's scheduler ids");
});
check("Prompt 19 S3: edge-functions/README.md - section 3 carries the DEPLOYED send-notification v6 -> v7 row (deploy BEFORE the Prompt 19 client push) with the proofs to observe; section 5 lists the trade_applied + scheduler check; the gate row names it", () => {
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  assert.ok(/Prompt 19/.test(s3), "section 3 names Prompt 19");
  assert.ok(/send-notification[^\n]*v6 -> v7 \(deployed 2026-09-25 05:36/.test(s3), "section 3: send-notification v6 -> v7 (deployed 2026-09-25 05:36 UTC)");
  assert.ok(/BEFORE the Prompt 19 client push/.test(s3), "section 3 states the order (v7 first - under v6 the give's applied mail is refused whole)");
  const row = s3.split("\n").find((l) => /v6 -> v7 \(deployed/.test(l)) || "";
  assert.ok(/403/.test(row) && /scheduler/.test(row) && /trade_applied/.test(row), "the pending row names the proofs (a scheduler beside the parties passes; a third surgeon still 403): " + row.slice(0, 160));
  const s5 = readme.slice(readme.indexOf("### send-notification"), readme.indexOf("### daily-reminder"));
  assert.ok(/Prompt 19/.test(s5) && /trade_applied/.test(s5) && /scheduler/.test(s5), "section 5 lists the trade_applied + scheduler case");
  const gateRow = readme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
  assert.ok(/trade_applied[^|]*scheduler/.test(gateRow), "the gate row names trade_applied's scheduler ids: " + gateRow.slice(0, 120));
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
/* ---- Prompt 19 S4 (Faraz 9/24): a give's e-mail is headed as a give - through the existing trade_* categories ----
   The client marks a give's mail with data.kind 'give' (proposed, declined, applied); send-notification's frame heading
   (and the default subject) then reads "Day Offered" / "Give Accepted" / "Give Declined" / "Give Applied". No new
   category, no gate change: the plain-JS block between '// @giveFrame-start' and '// @giveFrame-end' is extracted and run. */
check("Prompt 19 S4: send-notification's '@giveFrame' block defines frameTitle(type, baseTitle, data) - data.kind 'give' on trade_proposed / accepted / declined / applied -> 'Day Offered' / 'Give Accepted' / 'Give Declined' / 'Give Applied'; a trade (no kind, kind 'trade'), another category with kind give, or no data -> the category's own title", () => {
  const i = snSrc.search(/^\/\/ @giveFrame-start[ \t]*$/m), j = snSrc.search(/^\/\/ @giveFrame-end[ \t]*$/m);
  assert.ok(i >= 0 && j > i, "send-notification/index.ts carries '// @giveFrame-start' / '// @giveFrame-end' on lines of their own");
  const block = snSrc.slice(i + "// @giveFrame-start".length, j);
  plainJs(block, "send-notification @giveFrame");
  const frameTitle = new Function(block + "\nreturn frameTitle;")();
  assert.strictEqual(typeof frameTitle, "function", "frameTitle is a function");
  assert.strictEqual(frameTitle("trade_proposed", "Shift Trade Proposed", { kind: "give" }), "Day Offered");
  assert.strictEqual(frameTitle("trade_accepted", "Shift Trade Accepted", { kind: "give" }), "Give Accepted");
  assert.strictEqual(frameTitle("trade_declined", "Shift Trade Declined", { kind: "give" }), "Give Declined");
  assert.strictEqual(frameTitle("trade_applied", "Shift Trade Applied", { kind: "give" }), "Give Applied");
  assert.strictEqual(frameTitle("trade_applied", "Shift Trade Applied", {}), "Shift Trade Applied", "a trade (no kind)");
  assert.strictEqual(frameTitle("trade_applied", "Shift Trade Applied", { kind: "trade" }), "Shift Trade Applied", "kind trade");
  assert.strictEqual(frameTitle("trade_applied", "Shift Trade Applied", { kind: "GIVE" }), "Shift Trade Applied", "only the exact value");
  assert.strictEqual(frameTitle("shift_claimed", "Shift Taken", { kind: "give" }), "Shift Taken", "another category keeps its title");
  assert.strictEqual(frameTitle("trade_applied", "Shift Trade Applied", null), "Shift Trade Applied", "no data");
  assert.strictEqual(frameTitle("constructor", "X", { kind: "give" }), "X", "no prototype key is a give category");
});
check("Prompt 19 S4 source pins - send-notification: buildEmail heads the frame with frameTitle(type, cat.title, data) (the h2 and the default subject); the gate never reads data.kind; the header names the S4 change (still v7, pending); README section 3's pending v7 row names the give headings", () => {
  const b = snSrc.slice(snSrc.indexOf("function buildEmail("), snSrc.indexOf("return { subject, html };", snSrc.indexOf("function buildEmail(")));
  assert.ok(b.includes("const title = frameTitle(type, cat.title, data);"), "the heading comes from frameTitle");
  assert.ok(b.includes(": `${title} - ${APP_NAME}`;"), "the default subject uses it");
  assert.ok(b.includes('<h2 style="margin:0;font-size:18px;">${escHtml(title)}</h2>'), "the frame's h2 uses it");
  assert.ok(!b.includes("escHtml(cat.title)"), "no heading from cat.title left");
  const gate = snSrc.slice(snSrc.search(/^\/\/ @sendGate-start[ \t]*$/m), snSrc.search(/^\/\/ @sendGate-end[ \t]*$/m));
  assert.ok(!/kind/.test(gate), "the gate never reads kind (the heading is cosmetic)");
  const head = snSrc.slice(0, snSrc.indexOf("import "));
  assert.ok(/Prompt 19 S4/.test(head) && /data\.kind/.test(head) && /Give Applied/.test(head), "the header documents the give headings");
  const pc = (head.split("\n").find((l) => l.includes("POST { type: string, data: {")) || "");
  assert.ok(pc.includes("kind?: 'give'"), "the Payload contract line names the optional data.kind: " + pc.trim());
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  const row = s3.split("\n").find((l) => /v6 -> v7 \(deployed/.test(l)) || "";
  assert.ok(/data\.kind/.test(row) && /Give Applied/.test(row) && /Day Offered/.test(row), "the pending v7 row names the S4 give headings: " + row.slice(0, 160));
});
check("B5 (3): index-source.html - every trade_* sendEmailNotif call passes data.trade_id (the shift_trade_requests row id) so the v6 function accepts it; there is no trade_accepted mail call", () => {
  const calls = appSrc.split("\n").filter((l) => /sendEmailNotif\("trade_/.test(l));
  // Prompt 19 S3: a fifth call - the applied give's mail (notifyGiveApplied: the parties + the scheduler ids, v7)
  assert.strictEqual(calls.length, 5, "five trade_* mail calls (proposed, applied, applied-as-a-unit, the applied give, declined); found " + calls.length);
  calls.forEach((l) => assert.ok(/trade_id:\s*(first|t)\.id\b/.test(l), "the call carries trade_id: <row>.id -> " + l.trim().slice(0, 140)));
  assert.strictEqual(calls.filter((l) => /"trade_proposed"/.test(l)).length, 1);
  assert.strictEqual(calls.filter((l) => /"trade_applied"/.test(l)).length, 3);
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
  assert.ok(/send-notification[^\n]*v6 \(deployed 2026-09-24 03:21/.test(s3), "section 3: send-notification v6 deployed 2026-09-24 03:21 UTC");
  assert.ok(/daily-reminder[^\n]*v5 \(deployed 2026-09-24 03:20/.test(s3), "section 3: daily-reminder v5 deployed 2026-09-24 03:20 UTC");
  assert.ok(/office-notifications[^\n]*v3 \(deployed 2026-09-24 03:20/.test(s3), "section 3: office-notifications v3 deployed 2026-09-24 03:20 UTC");
  assert.ok(/Prompt 16/.test(s3) && /constant-time|timing-safe/.test(s3), "section 3 names the B5 change");
  const dr = readme.slice(readme.indexOf("### daily-reminder"), readme.indexOf("## 6."));
  assert.ok(/wrong secret|wrong x-cron-secret|wrong value/i.test(dr) && /401/.test(dr), "section 5 daily-reminder: a wrong secret -> 401 (the same 401 as no secret)");
});

/* =====================================================================
   Item D (2026-09-24) - Khan's combined calendar (calendar-sync ?surgeon=<CODE>&east=1) and the office
   digest's "<Name> at Davenport this week" section. Two plain-JS mirror blocks, extracted and evaluated
   like the B5 ones: '@eastCalendar' (identical in calendar-sync AND office-notifications; its
   eastBusyDays is pinned against east-feed.js deriveKhanBusyDays - the app's own derivation) and
   '@icsCore' (calendar-sync only: the whole event / .ics shaping, so a real feed is built here from
   fixture rows - two Silvis days + two east_feed days - with no network and no Deno).
   ===================================================================== */
const csSrc = read("edge-functions/calendar-sync/index.ts");
const ef = require("../east-feed.js");
const EAST_FNS = { "calendar-sync": csSrc, "office-notifications": onSrc };
const DAV_FAK = "s6"; // the DAVENPORT id in these fixtures (FAK is s6 there; the functions resolve it by code)
let eastApi = null;
check("Item D: calendar-sync and office-notifications carry an identical plain-JS '@eastCalendar' mirror block defining eastBusyDays, eastEntries, eastDigestLines, eastFeedPerson, eastVacationRanges, eastAwayRanges and the reason labels", () => {
  const blocks = Object.entries(EAST_FNS).map(([n, s]) => [n, blockOf(s, n, "eastCalendar")]);
  blocks.forEach(([n, b]) => plainJs(b, n));
  identical(blocks, "eastCalendar");
  const api = new Function(blocks[0][1] + "\nreturn { eastBusyDays, eastEntries, eastDigestLines, eastFeedPerson, eastVacationRanges, eastAwayRanges, eastMergeRanges, EAST_REASON_LABEL, EAST_REASON_ORDER };")();
  ["eastBusyDays", "eastEntries", "eastDigestLines", "eastFeedPerson", "eastVacationRanges", "eastAwayRanges", "eastMergeRanges"].forEach((k) => assert.strictEqual(typeof api[k], "function", k + " is a function"));
  assert.deepStrictEqual(api.EAST_REASON_LABEL, { "holiday": "Davenport holiday", "override": "Davenport day call", "service-week": "Davenport service week", "night": "Davenport night", "weekend": "Davenport weekend" }, "the five reason labels (override -> 'Davenport day call': the day-call slot a dayCallOverrides entry hands him for one day)");
  assert.deepStrictEqual(api.EAST_REASON_ORDER, ["holiday", "override", "service-week", "night", "weekend"], "title / UID precedence");
  eastApi = api;
});
// The east-feed.test.js fixture family: an old row with an override TO FAK, a FAK service week with a Wednesday
// override to someone else, Thu night + weekend (Fri + Sun), a Thanksgiving holiday unit, an isBackup week with a
// FAK night, an isFierceBackup week, holiday-24h-held-by-others weeks (override and night on the held days), Labor
// Day inside a FAK service week, a forecast row and a malformed row.
const EAST_WEEKS = [
  { weekMonday: "2026-10-26", data: { dayCall: "s2", nights: { mon: "s1", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", dayCallOverrides: { "2026-10-28": "s6" } } },
  { weekMonday: "2026-11-02", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" }, off: "s7", isBackup: false, isFierceBackup: false, holidayCoverage: null, dayCallOverrides: { "2026-11-04": "s2" } } },
  { weekMonday: "2026-11-09", data: { dayCall: "s2", nights: { mon: "s1", tue: "s3", wed: "s4", thu: "s6", wknd: "s6" }, off: "s7", isBackup: false, isFierceBackup: false, holidayCoverage: null } },
  { weekMonday: "2026-11-23", data: { dayCall: "s1", nights: { mon: "s2", tue: "s3", wed: "s4", thu: "s5", wknd: "s7" }, off: "s6", holidayCoverage: { "2026-11-26": { surgeonId: "s6", role: "holiday_24h", name: "Thanksgiving", type: "major" }, "2026-11-27": { surgeonId: "s1", role: "holiday_24h" } } } },
  { weekMonday: "2026-12-14", data: { dayCall: "s3", nights: { mon: "s6", tue: "s1", wed: "s2", thu: "s4", wknd: "s5" }, off: "s7", isBackup: true, isFierceBackup: false, holidayCoverage: null } },
  { weekMonday: "2026-12-21", data: { dayCall: "s3", nights: { mon: "s1", tue: "s6", wed: "s2", thu: "s4", wknd: "s5" }, off: "s7", isBackup: false, isFierceBackup: true, holidayCoverage: null } },
  { weekMonday: "2026-12-28", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s6", wknd: "s6" }, off: "s7", holidayCoverage: { "2026-12-31": { surgeonId: "s5", role: "holiday_24h" }, "2027-01-01": { surgeonId: "s6", role: "holiday_24h" }, "2027-01-02": { surgeonId: "s5", role: "holiday_24h" } }, dayCallOverrides: { "2026-12-31": "s6" } } },
  { weekMonday: "2026-09-07", data: { dayCall: "s6", nights: { mon: "s3", tue: "s5", wed: "s7", thu: "s1", wknd: "s4" }, holidayCoverage: { "2026-09-07": { surgeonId: "s3", role: "holiday_24h" } } } },
  { weekMonday: "2026-12-07", data: { isForecast: true, runs: 100, fakBusyProbabilityByDay: { "2026-12-08": 0.9 } } },
  { weekMonday: "bad", data: { dayCall: "s6" } },
  null,
];
check("Item D mirror identity: eastBusyDays(weeks, id) returns the SAME busy set and the SAME per-day reasons as east-feed.js deriveKhanBusyDays over the fixture family (override / service-week / night / weekend / holiday / backup-week, holiday-24h precedence, forecast and malformed rows skipped); east_feed-shaped rows (week_monday) derive the same", () => {
  if (!eastApi) throw new Error("east block did not load");
  const mine = eastApi.eastBusyDays(EAST_WEEKS, DAV_FAK);
  const theirs = ef.deriveKhanBusyDays(EAST_WEEKS, DAV_FAK);
  assert.deepStrictEqual([...mine.busy].sort(), [...theirs.busy].sort(), "busy dates");
  assert.deepStrictEqual(mine.reasons, theirs.reasons, "reasons per date");
  assert.ok(mine.busy.size >= 12, "the fixture exercises a real spread (" + mine.busy.size + " busy days)");
  assert.deepStrictEqual(mine.reasons["2026-12-14"], ["night", "backup-week"], "an East backup week's shift is derived (and flagged) like the app does");
  assert.deepStrictEqual(mine.reasons["2026-12-31"], undefined, "an override to FAK on a day another surgeon holds as a 24h holiday derives nothing (holiday precedence)");
  const feedShaped = EAST_WEEKS.filter(Boolean).map((w) => ({ week_monday: w.weekMonday, data: w.data }));
  assert.deepStrictEqual(eastApi.eastBusyDays(feedShaped, DAV_FAK).reasons, theirs.reasons, "east_feed rows ({ week_monday, data }) derive the same");
  assert.strictEqual(eastApi.eastBusyDays(EAST_WEEKS, null).busy.size, 0, "no id -> nothing (the caller treats it as unresolved, never as free)");
});
check("Item D: eastFeedPerson is the app's eastVacationPerson predicate - enabled + a busy-day role + a code + not external; Fierce's derived-weeks feature and an outside surgeon are outside it", () => {
  if (!eastApi) throw new Error("east block did not load");
  const p = eastApi.eastFeedPerson;
  assert.strictEqual(p({ id: "s1", code: "FAK" }, { enabled: true, eastBlocksPrimary: true, eastBlocksBackup: false }), true, "Khan");
  assert.strictEqual(p({ id: "s5", code: "NF" }, { enabled: true }), false, "Fierce (derived weeks, no busy-day role)");
  assert.strictEqual(p({ id: "s2", code: "MAB" }, undefined), false, "no East feature");
  assert.strictEqual(p({ id: "x1", code: "LOC", type: "external" }, { enabled: true, eastBlocksPrimary: true }), false, "an outside surgeon");
  assert.strictEqual(p({ id: "s1", code: "" }, { enabled: true, eastBlocksPrimary: true }), false, "no code");
  assert.ok(/function eastVacationPerson\(s, ef\) \{\s*return !!\(s && ef && ef\.enabled && \(ef\.eastBlocksPrimary \|\| ef\.eastBlocksBackup\) && s\.code && s\.type !== "external"\);/.test(appSrc), "index-source.html's eastVacationPerson still reads the same way (the two predicates must not drift)");
});
// ICS fixture: two Silvis days for s1 (primary 10/5, backup 10/6 - CDT, 07:00 Central = 12:00Z) and one cached
// Davenport week with two FAK days (Tue 10/13 night, Thu 10/15 a day-call override TO him). Synthetic 2030 ranges for the
// away case (the same convention as the east_vacation_reviews probe).
const SILVIS_ROWS = [
  { day: "2026-10-05", primary_id: "s1", backup_id: "s2", external_cover: null, note: null },
  { day: "2026-10-06", primary_id: "s3", backup_id: "s1", external_cover: null, note: null },
];
const ICS_ROSTER = { byId: { s1: { id: "s1", name: "Khan", code: "FAK" }, s2: { id: "s2", name: "Burchett", code: "MAB" }, s3: { id: "s3", name: "Acton", code: "BDA" } } };
const ICS_WEEK = [{ weekMonday: "2026-10-12", data: { dayCall: "s2", nights: { mon: "s1", tue: "s6", wed: "s3", thu: "s4", wknd: "s5" }, off: "s7", dayCallOverrides: { "2026-10-15": "s6" } } }];
let icsApi = null;
check("Item D: calendar-sync carries a plain-JS '@icsCore' mirror block defining buildEvents, eastIcsEvents, generateICS, icsDate, esc and fold (the whole event / .ics shaping)", () => {
  const b = blockOf(csSrc, "calendar-sync", "icsCore");
  plainJs(b, "calendar-sync icsCore");
  const api = new Function(b + "\nreturn { buildEvents, eastIcsEvents, generateICS, icsDate, esc, fold, addDays, UID_DOMAIN };")();
  ["buildEvents", "eastIcsEvents", "generateICS", "icsDate", "esc", "fold", "addDays"].forEach((k) => assert.strictEqual(typeof api[k], "function", k + " is a function"));
  assert.strictEqual(api.UID_DOMAIN, "silvis-call");
  assert.strictEqual(api.icsDate(2026, 10, 5, 7, 0), "20261005T120000Z", "07:00 CDT -> 12:00Z (the DST-aware conversion is intact)");
  assert.strictEqual(api.icsDate(2026, 12, 5, 7, 0), "20261205T130000Z", "07:00 CST -> 13:00Z");
  icsApi = api;
});
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "");
check("Item D ics: two Silvis days + two east_feed days -> four VEVENTs: the Silvis pair timed 07:00 Central with UIDs silvis-<day>-<role>@silvis-call, the Davenport pair ALL-DAY (DTSTART;VALUE=DATE the day, DTEND;VALUE=DATE the next day) titled 'Khan <en dash> Davenport night' / 'Khan <en dash> Davenport day call' with UIDs east-FAK-<day>-<reason>@silvis-call; a second build yields the same UIDs; a LOWER-precedence reason added later keeps the UID, a higher one (a holiday assigned onto the day) renames it", () => {
  if (!icsApi || !eastApi) throw new Error("blocks did not load");
  const build = (weeks) => {
    const silvis = icsApi.buildEvents(SILVIS_ROWS, ICS_ROSTER, "s1");
    const entries = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews: [], from: "2026-10-01", to: "2026-12-31" });
    const east = icsApi.eastIcsEvents(entries, "FAK");
    return { silvis, east, ics: icsApi.generateICS(silvis.concat(east), "Silvis + Davenport - Khan") };
  };
  const one = build(ICS_WEEK);
  assert.strictEqual(one.silvis.length, 2, "two Silvis events for s1 (his primary day and his backup day)");
  assert.strictEqual(one.east.length, 2, "two Davenport events");
  const ics = unfold(one.ics);
  assert.ok(/^BEGIN:VCALENDAR\r\n/.test(one.ics), "starts with BEGIN:VCALENDAR");
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 4, "four VEVENTs");
  assert.ok(ics.indexOf("UID:silvis-2026-10-05-primary@silvis-call\r\nDTSTAMP:") >= 0 && ics.indexOf("\r\nDTSTART:20261005T120000Z\r\nDTEND:20261006T120000Z\r\nSUMMARY:Silvis Primary Call\r\n") >= 0, "the Silvis primary day is a timed event, 07:00 to 07:00 Central");
  assert.ok(ics.indexOf("UID:silvis-2026-10-06-backup@silvis-call") >= 0 && ics.indexOf("SUMMARY:Silvis Backup Call\r\n") >= 0, "the Silvis backup day");
  assert.ok(ics.indexOf("UID:east-FAK-2026-10-13-night@silvis-call") >= 0, "the night's UID");
  assert.ok(ics.indexOf("\r\nDTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:Khan \u2013 Davenport night\r\n") >= 0, "the night is an all-day event ending the next day, titled with an en dash");
  assert.ok(ics.indexOf("UID:east-FAK-2026-10-15-override@silvis-call") >= 0 && ics.indexOf("\r\nDTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261016\r\nSUMMARY:Khan \u2013 Davenport day call\r\n") >= 0, "the override is 'Davenport day call'");
  assert.ok(/DESCRIPTION:Davenport \(East\) call: Davenport night\\nSource: /.test(ics), "the description names the reason (newline escaped per RFC 5545)");
  assert.ok(ics.indexOf("X-WR-CALNAME:Silvis + Davenport - Khan") >= 0, "the calendar name");
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(ics.replace(/@silvis-call/g, "")), "no e-mail address anywhere in the feed (UIDs are not addresses)");
  const two = build(ICS_WEEK);
  assert.deepStrictEqual(two.east.map((e) => e.uid), one.east.map((e) => e.uid), "stable East UIDs across builds");
  assert.deepStrictEqual(two.silvis.map((e) => e.uid), one.silvis.map((e) => e.uid), "stable Silvis UIDs across builds");
  const later = build([{ weekMonday: "2026-10-12", data: { ...ICS_WEEK[0].data, nights: { ...ICS_WEEK[0].data.nights, thu: "s6" } } }]);
  assert.deepStrictEqual(later.east.map((e) => e.uid), one.east.map((e) => e.uid), "a Thursday night added later on the override day keeps the UID (override precedes night) - the event updates in place");
  assert.ok(/Davenport day call, Davenport night/.test(later.east[1].desc), "the second reason lands in the description");
  const higher = build([{ weekMonday: "2026-10-12", data: { ...ICS_WEEK[0].data, holidayCoverage: { "2026-10-15": { surgeonId: "s6" } } } }]);
  assert.deepStrictEqual(higher.east.map((e) => e.uid), ["east-FAK-2026-10-13-night@silvis-call", "east-FAK-2026-10-15-holiday@silvis-call"], "a HIGHER-precedence reason added later (a holiday onto the override day) renames the UID - a subscription handles that as delete + add (documented in the block header)");
  assert.strictEqual(higher.east[1].summary, "Khan " + String.fromCharCode(0x2013) + " Davenport holiday", "and the title follows the precedence");
  const windowed = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks: ICS_WEEK, reviews: [], from: "2026-10-14", to: "2026-10-31" });
  assert.deepStrictEqual(windowed.busy.map((e) => e.day), ["2026-10-15"], "the feed window clips the East days");
  assert.strictEqual(eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: null, weeks: ICS_WEEK, reviews: [] }).busy.length, 0, "an unresolved id derives nothing (the handler answers 502 instead of a feed)");
});
check("Item D ics: an East vacation range reviewed as away -> one all-day event 'Khan <en dash> away (Davenport vacation)' over the whole range (DTEND the day after), UID east-FAK-away-<start>-<end>@silvis-call; a 'home' review, an unreviewed range, another person's review or a review whose range is no longer in the feed -> no event", () => {
  if (!icsApi || !eastApi) throw new Error("blocks did not load");
  const weeks = [{ weekMonday: "2030-05-06", data: { dayCall: "s2", nights: {}, vacations: [{ code: "FAK", start: "2030-05-13", end: "2030-05-15" }, { code: "FAK", start: "2030-05-20", end: "2030-05-22" }, { code: "FAK", start: "2030-06-03", end: "2030-06-04" }, { code: "MAB", start: "2030-05-13", end: "2030-05-15" }] } }];
  const reviews = [
    { person_id: "s1", start: "2030-05-13", end: "2030-05-15", decision: "away" },
    { person_id: "s1", start: "2030-05-20", end: "2030-05-22", decision: "home" },
    { person_id: "s2", start: "2030-05-13", end: "2030-05-15", decision: "away" },
    { person_id: "s1", start: "2030-07-01", end: "2030-07-03", decision: "away" },   // no longer in the feed
  ];
  const entries = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews, from: "2030-05-01", to: "2030-12-31" });
  assert.deepStrictEqual(entries.away.map((a) => [a.start, a.end, a.endExclusive, a.title]), [["2030-05-13", "2030-05-15", "2030-05-16", "Khan \u2013 away (Davenport vacation)"]], "exactly the away range");
  const ev = icsApi.eastIcsEvents(entries, "FAK");
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].uid, "east-FAK-away-2030-05-13-2030-05-15@silvis-call");
  const ics = unfold(icsApi.generateICS(ev, "t"));
  assert.ok(ics.indexOf("\r\nDTSTART;VALUE=DATE:20300513\r\nDTEND;VALUE=DATE:20300516\r\nSUMMARY:Khan \u2013 away (Davenport vacation)\r\n") >= 0, "all-day over the whole range");
  assert.deepStrictEqual(eastApi.eastVacationRanges(weeks, "fak"), [{ start: "2030-05-13", end: "2030-05-15" }, { start: "2030-05-20", end: "2030-05-22" }, { start: "2030-06-03", end: "2030-06-04" }], "the code is matched case-insensitively and the ranges merged like east-feed.js eastVacations");
  assert.deepStrictEqual(eastApi.eastVacationRanges(weeks, "FAK"), ef.eastVacations(weeks.map((w) => ({ week_monday: w.weekMonday, data: w.data })), "FAK"), "mirror identity with east-feed.js eastVacations");
  const outside = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews, from: "2030-05-16", to: "2030-12-31" });
  assert.strictEqual(outside.away.length, 0, "a range that ends before the window is left out");
});
check("Item D digest: eastDigestLines collapses consecutive same-reason days into one line and speaks the events' words - 'Mon Oct 12 <en dash> Sat Oct 17: Davenport service week', 'Tue Oct 13: Davenport night', 'Wed Nov 25 <en dash> Sun Nov 29: away (Davenport vacation)'; nothing when there is nothing", () => {
  if (!eastApi) throw new Error("east block did not load");
  const weeks = [
    { weekMonday: "2026-10-12", data: { dayCall: "s6", nights: { mon: "s1", tue: "s2", wed: "s3", thu: "s4", wknd: "s5" } } },
    { weekMonday: "2026-10-19", data: { dayCall: "s2", nights: { mon: "s1", tue: "s6", wed: "s3", thu: "s4", wknd: "s6" } } },
    { weekMonday: "2026-11-23", data: { dayCall: "s2", nights: {}, vacations: [{ code: "FAK", start: "2026-11-25", end: "2026-11-29" }] } },
  ];
  const reviews = [{ person_id: "s1", start: "2026-11-25", end: "2026-11-29", decision: "away" }];
  const e = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews, from: "2026-10-12", to: "2026-11-30" });
  assert.deepStrictEqual(eastApi.eastDigestLines(e), [
    "Mon Oct 12 \u2013 Sat Oct 17: Davenport service week",
    "Tue Oct 20: Davenport night",
    "Fri Oct 23: Davenport weekend",
    "Sun Oct 25: Davenport weekend",
    "Wed Nov 25 \u2013 Sun Nov 29: away (Davenport vacation)",
  ]);
  const quiet = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews, from: "2026-12-01", to: "2026-12-14" });
  assert.deepStrictEqual(eastApi.eastDigestLines(quiet), [], "a fortnight with nothing -> no lines (the digest renders no section)");
  assert.deepStrictEqual(eastApi.eastDigestLines({ busy: [], away: [] }), []);
});
check("Item D source pins - calendar-sync: east=1 is read beside surgeon; the East branch runs only for ONE resolved surgeon that passes eastFeedPerson(<entry>, surgeonRules[id].eastFeed) (else the feed is exactly today's); it reads east_feed + east_vacation_reviews (decision away, by the ROSTER id, service role required) + resolveEastId (east_forecast data->>code first, then the Davenport roster by code, never a literal id); an unresolved id is a thrown 502, not a feed; the unauthenticated 200 + BEGIN:VCALENDAR contract and the 404 / 405 stay", () => {
  const h = csSrc.slice(csSrc.indexOf("Deno.serve(async (req) =>"));
  assert.ok(/url\.searchParams\.get\("east"\)/.test(h), "the east param is read");
  assert.ok(/eastWanted && who && onlyId && eastFeedPerson\(who, \(roster\.surgeonRules\[onlyId\] \|\| \{\}\)\.eastFeed\)/.test(h), "the branch is gated on one resolved surgeon + the predicate over surgeonRules[id].eastFeed");
  assert.ok(/SUPABASE_SERVICE_ROLE_KEY/.test(h.slice(h.indexOf("eastWanted && who"))), "the service role is required for the reviews read");
  assert.ok(/if [(]!Deno[.]env[.]get[(]"SUPABASE_SERVICE_ROLE_KEY"[)][)] [{][^}]*return json[(]500, [{] error: "east=1 needs the service role/.test(h), "a missing service role is a direct 500 (a misconfiguration, like the top-of-handler check), not a 502 through the catch");
  const csResolve = csSrc.slice(csSrc.indexOf("async function resolveEastId("), csSrc.indexOf("// @icsCore-mirror-start"));
  assert.ok(/fetch[(]`[$][{]EAST_PROJECT_URL[}][/]rest[/]v1[/]call_schedule_data[?]id=eq[.]main&select=data`, [{][^]*?signal: AbortSignal[.]timeout[(]8000[)]/.test(csResolve), "the cross-project Davenport roster GET carries an 8 s timeout (a hung Davenport is a 502, never a stalled feed)");
  assert.ok(/east_feed\?select=week_monday,data&order=week_monday\.asc/.test(h), "east_feed read");
  assert.ok(/east_vacation_reviews\?select=person_id,start,end,decision&person_id=eq\.\$\{encodeURIComponent\(onlyId\)\}&decision=eq\.away/.test(h), "reviews read by the roster id, away only");
  assert.ok(/if \(!eastId\) throw new HttpError\(502,/.test(h), "an unresolved East id throws 502 (the catch answers JSON, never a feed)");
  assert.ok(/events = events\.concat\(eastEvents\)/.test(h) && /title = `Silvis \+ Davenport - \$\{who\.name\}`/.test(h), "the East events are appended and the calendar renamed");
  const r = csSrc.slice(csSrc.indexOf("async function resolveEastId("), csSrc.indexOf("// @icsCore-mirror-start"));
  assert.ok(/east_forecast\?select=data&data->>code=eq\./.test(r), "resolveEastId reads the east_forecast row by data.code first");
  assert.ok(/EAST_PROJECT_URL\}\/rest\/v1\/call_schedule_data\?id=eq\.main&select=data/.test(r) && /s\.name\.toUpperCase\(\) === want/.test(r), "then the Davenport roster blob by code");
  assert.ok(!/["']s6["']/.test(csSrc.replace(/\/\/[^\n]*/g, "")), "no literal Davenport id in the function");
  assert.ok(/return json\(404, \{ error: `surgeon "\$\{surgeonParam\}" not found/.test(h), "404 kept");
  assert.ok(/json\(405, \{ error: "method not allowed - this feed is GET only" \}/.test(csSrc), "405 kept");
  assert.ok(/"Content-Type": "text\/calendar; charset=utf-8"/.test(h) && /status: 200/.test(h), "200 text/calendar kept");
  assert.ok(/answer EXACTLY like today's feed/.test(csSrc) && /502 JSON and NOT a feed/.test(csSrc), "the header documents the two choices (east=1 without a single East surgeon is ignored; an unresolvable id is a 502, not a feed)");
  assert.ok(!/\bmethod: "(POST|PATCH|PUT|DELETE)"/.test(csSrc), "calendar-sync still performs no write");
});
check("Item D source pins - office-notifications: the digest composes buildEastSection(roster, today) on every digest path (dryRun included) and answers `east` { people, lines, html, errors }; the dryRun sample and the live mail carry the section + the combined-feed footer (calendar-sync?surgeon=<CODE>&east=1); the send trigger is still the diff; a failed East read is one 'could not be read' line, never a thrown digest; the East branch performs no write", () => {
  const h = onSrc.slice(onSrc.indexOf("serve(async (req) =>"));
  const dg = h.slice(h.indexOf('if (mode === "digest") {'), h.indexOf('if (mode === "publish") {'));
  assert.ok(/const east = await buildEastSection\(roster, today\);/.test(dg), "composed once at the top of the digest branch");
  assert.ok((dg.match(/east: eastOut/g) || []).length >= 5, "every digest response carries east (found " + (dg.match(/east: eastOut/g) || []).length + ")");
  assert.ok(/renderDigestEmail\("\(contact name\)", changesHtml, east\.html, east\.footerHtml\)/.test(dg), "the dryRun sample renders the section + footer");
  assert.ok(/sample_east_section: renderDigestEmail\("\(contact name\)", "", east\.html, east\.footerHtml\)\.html/.test(dg), "a quiet-week dryRun still returns the rendered section");
  assert.ok(/renderDigestEmail\(c\.name, changesHtml, east\.html, east\.footerHtml\)/.test(dg), "the live mail carries the section + footer");
  assert.ok(/if \(!diff\.anyChange\) \{/.test(dg) && dg.indexOf("if (!diff.anyChange) {") < dg.indexOf("const contacts = await loadContacts()"), "the send trigger is still the diff (no mail on a quiet week)");
  const b = onSrc.slice(onSrc.indexOf("async function buildEastSection("), onSrc.indexOf("// Mail client"));
  assert.ok(/at Davenport this week<\/p>/.test(b), "the section heading '<Name> at Davenport this week'");
  assert.ok(/eastDigestLines\(eastEntries\(\{ lastName: p\.name, code, rosterId: String\(p\.id\), eastId, weeks, reviews/.test(b), "lines from the shared block (the events' words)");
  assert.ok(/could not be read this week/.test(b) && /out\.errors\.push/.test(b), "a failed read renders one line and is listed in errors");
  assert.ok(/if \(!lines\.length && !failed\) continue;/.test(b) && /if \(blocks\.length\) out\.html = /.test(b), "nothing when there is nothing");
  assert.ok(/calendar-sync\?surgeon=\$\{encodeURIComponent\(String\(code\)\.toUpperCase\(\)\)\}&east=1/.test(onSrc), "the combined-feed URL");
  assert.ok(/paste it into Outlook as an internet calendar; it updates itself/.test(b), "the footer wording");
  assert.ok(/east_vacation_reviews\?select=person_id,start,end,decision&person_id=eq\.\$\{encodeURIComponent\(String\(p\.id\)\)\}&decision=eq\.away/.test(b), "reviews by the roster id, away only, service role");
  // the resolver, start to its closing brace (the earlier end marker "// Item D: the" precedes the function, which made the slice empty)
  const onResolveStart = onSrc.indexOf("async function resolveEastId(");
  const onResolve = onSrc.slice(onResolveStart, onSrc.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), onResolveStart) + 3);
  assert.ok(/AbortSignal/.test(onResolve) && /return hit && hit[.]id/.test(onResolve), "the resolver slice is the whole function, not empty");
  assert.ok(!/\bmethod: "(POST|PATCH|PUT|DELETE)"/.test(b + onResolve), "the East branch performs no write");
  assert.ok(/const EAST_DIGEST_DAYS = 14;/.test(onSrc), "a 14-day window");
  assert.ok(/fetch[(]`[$][{]EAST_PROJECT_URL[}][/]rest[/]v1[/]call_schedule_data[?]id=eq[.]main&select=data`, [{][^]*?signal: AbortSignal[.]timeout[(]8000[)]/.test(onResolve), "the cron digest's Davenport roster GET carries an 8 s timeout (a hung Davenport degrades to the 'could not be read' line, never a stalled digest)");
  assert.ok(/footerHtml: string = ""\): string \{/.test(onSrc) && /\$\{footerHtml\}/.test(onSrc), "shell() takes the footer");
  assert.ok(!/["']s6["']/.test(onSrc.replace(/\/\/[^\n]*/g, "")), "no literal Davenport id in the function");
});
check("Item D: index-source.html Settings (scheduler) shows the combined link for every eastVacationPerson with a Copy button and the office note (en dash / em dash as JS escapes, ASCII source); edge-functions/README.md section 5 lists the east=1 checks and section 3 carries the pending Item D deploy rows (calendar-sync v2 -> v3, office-notifications v3 -> v4); docs/SILVIS-BUILD-GUIDE.md names the combined feed", () => {
  const settings = appSrc.slice(appSrc.indexOf("Live calendar sync"), appSrc.indexOf("Requires the calendar-sync edge function"));
  assert.ok(/surgeons\.filter\(s => eastVacationPerson\(s, surgeonRules && surgeonRules\[s\.id\] && surgeonRules\[s\.id\]\.eastFeed\)\)\.map\(/.test(settings), "one combined row per East person, by the app's own predicate");
  assert.ok(/calendar-sync\?surgeon=\$\{s\.code\}&east=1/.test(settings), "the combined URL");
  assert.ok(/data-testid="combined-sync-url"/.test(settings) && /data-testid="copy-combined-sync-url"/.test(settings) && /data-testid="combined-sync-note"/.test(settings), "the box, the Copy button and the note carry test ids");
  assert.ok(settings.indexOf('{"for office staff at either site \\u2014 paste it into Outlook as an internet calendar; it updates itself"}') >= 0, "the note, with the em dash as a JS escape");
  assert.ok(/\{"\\u2013"\}/.test(settings), "the en dash as a JS escape");
  assert.ok(/minHeight:36/.test(settings), "the Copy button is a phone tap target");
  assert.ok(!/[^\x00-\x7F]/.test(appSrc), "index-source.html stays ASCII");
  assert.ok(settings.indexOf("{isScheduler && <>") >= 0 && settings.indexOf("{isScheduler && <>") < settings.indexOf("combined-sync-url"), "scheduler only");
  const s5 = readme.slice(readme.indexOf("### calendar-sync"), readme.indexOf("### office-notifications"));
  assert.ok(/surgeon=FAK&east=1/.test(s5) && /VALUE=DATE/.test(s5) && /Davenport/.test(s5), "section 5: the east=1 check (all-day Davenport events)");
  assert.ok(/surgeon=NF&east=1|east=1"[^\n]*same as|exactly like/.test(s5), "section 5: east=1 outside the predicate answers like today");
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  assert.ok(/Item D/.test(s3) && /calendar-sync[^\n]*v2 -> v3/.test(s3) && /office-notifications[^\n]*v3 -> v4/.test(s3) && /calendar-sync[^\n]*v3 \(deployed 2026-09-24 07:52/.test(s3) && /office-notifications[^\n]*v4 \(deployed 2026-09-24 07:52/.test(s3) && !/v3 \(pending\)|v4 \(pending\)/.test(s3), "section 3: the Item D rows record the deploys (v3 / v4, 2026-09-24 07:52 UTC)");
  const s5on = readme.slice(readme.indexOf("### office-notifications"), readme.indexOf("### send-notification"));
  assert.ok(/"east"/.test(s5on) || /east:/.test(s5on), "section 5: the digest dryRun answers `east`");
  const guide = read("docs/SILVIS-BUILD-GUIDE.md");
  assert.ok(/east=1/.test(guide) && /combined/.test(guide), "the build guide names the combined feed");
});

(async () => {
  for (const [name, fn] of ASYNC) {
    try { await fn(); passed++; console.log("ok   " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
  }
  console.log("edge-functions.test.js: " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
