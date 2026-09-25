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
check("Prompt 19 S4 source pins - send-notification: buildEmail heads the frame with frameTitle(type, cat.title, data) (the h2 and the default subject); the gate never reads data.kind; the header names the S4 change (v7, deployed 2026-09-25 05:36 UTC - P20 R1: the header says so and names the Followers change as the pending v8); README section 3's v7 row names the give headings", () => {
  const b = snSrc.slice(snSrc.indexOf("function buildEmail("), snSrc.indexOf("return { subject, html };", snSrc.indexOf("function buildEmail(")));
  assert.ok(b.includes("const title = frameTitle(type, cat.title, data);"), "the heading comes from frameTitle");
  assert.ok(b.includes(": `${title} - ${APP_NAME}`;"), "the default subject uses it");
  assert.ok(b.includes('<h2 style="margin:0;font-size:18px;">${escHtml(title)}</h2>'), "the frame's h2 uses it");
  assert.ok(!b.includes("escHtml(cat.title)"), "no heading from cat.title left");
  const gate = snSrc.slice(snSrc.search(/^\/\/ @sendGate-start[ \t]*$/m), snSrc.search(/^\/\/ @sendGate-end[ \t]*$/m));
  assert.ok(!/kind/.test(gate), "the gate never reads kind (the heading is cosmetic)");
  const head = snSrc.slice(0, snSrc.indexOf("import "));
  assert.ok(/Prompt 19 S4/.test(head) && /data\.kind/.test(head) && /Give Applied/.test(head), "the header documents the give headings");
  // P20 R1 (review): v7 is live (README section 3's record), so the header no longer calls it pending; this source is the pending v8
  assert.ok(!/NOT deployed yet/.test(head) && !/pending v7/.test(head), "the header must not call Prompt 19's v7 pending (deployed 2026-09-25 05:36 UTC)");
  assert.ok(/GIVE A DAY \(Prompt 19 S3, 2026-09-24; v7, deployed 2026-09-25 05:36 UTC;/.test(head), "the GIVE A DAY paragraph records v7 as deployed 2026-09-25 05:36 UTC");
  assert.ok(/FOLLOWERS \(Prompt 20 F3, Faraz 9\/24; revision o; v8 on base v7 - prepared, NOT deployed; README section 3\)/.test(head), "the FOLLOWERS paragraph names itself the pending v8 on base v7");
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
check("Item D: calendar-sync carries a plain-JS '@icsCore' mirror block defining buildEvents (all-day runs, the default since 9/25), buildTimedEvents (?timed=1, the old per-day format), eastIcsEvents (merged Davenport runs), eastIcsDayEvents (?timed=1), generateICS, icsDate, esc and fold (the whole event / .ics shaping)", () => {
  const b = blockOf(csSrc, "calendar-sync", "icsCore");
  plainJs(b, "calendar-sync icsCore");
  const api = new Function(b + "\nreturn { buildEvents, buildTimedEvents, eastIcsEvents, eastIcsDayEvents, generateICS, icsDate, esc, fold, addDays, UID_DOMAIN };")();
  ["buildEvents", "buildTimedEvents", "eastIcsEvents", "eastIcsDayEvents", "generateICS", "icsDate", "esc", "fold", "addDays"].forEach((k) => assert.strictEqual(typeof api[k], "function", k + " is a function"));
  assert.strictEqual(api.UID_DOMAIN, "silvis-call");
  assert.strictEqual(api.icsDate(2026, 10, 5, 7, 0), "20261005T120000Z", "07:00 CDT -> 12:00Z (the DST-aware conversion is intact)");
  assert.strictEqual(api.icsDate(2026, 12, 5, 7, 0), "20261205T130000Z", "07:00 CST -> 13:00Z");
  icsApi = api;
});
const unfold = (ics) => ics.replace(/\r\n[ \t]/g, "");
// Faraz 9/25: the day's internal note (e.g. "seed: office-er-call-panels-..." or "open (9/22)") never reaches a subscriber's
// calendar - the event description is exactly the time line + Primary / Backup lines (all-day, the default) or the
// Primary / Backup / Shift lines (?timed=1), whatever the row's note says.
check("calendar-sync: an event description carries the times + Primary / Backup only (all-day default) or Primary / Backup / Shift (?timed=1) - never the day's internal note", () => {
  if (!icsApi) throw new Error("icsCore did not load");
  const rows = [{ day: "2026-10-05", primary_id: "s1", backup_id: "s2", external_cover: null, note: "seed: office-er-call-panels-2026-09-16" },
                { day: "2026-10-24", primary_id: null, backup_id: "s1", external_cover: null, note: "open (9/22)" }];
  const evs = icsApi.buildEvents(rows, ICS_ROSTER, "s1");
  assert.strictEqual(evs.length, 2, "two events for s1");
  evs.forEach((ev) => {
    assert.ok(!/Note:|seed:|office-er|open \(9\/22\)/.test(ev.desc), "no note in the description: " + JSON.stringify(ev.desc));
    assert.ok(/^07:00 \w{3} \u2192 07:00 \w{3} \(Central\)\nPrimary: [^\n]+\nBackup: [^\n]+$/.test(ev.desc), "exactly the time line + Primary + Backup: " + JSON.stringify(ev.desc));
  });
  const timed = icsApi.buildTimedEvents(rows, ICS_ROSTER, "s1");
  timed.forEach((ev) => {
    assert.ok(!/Note:|seed:|office-er|open \(9\/22\)/.test(ev.desc), "no note in the timed description: " + JSON.stringify(ev.desc));
    assert.deepStrictEqual(ev.desc.split("\n").map((l) => l.split(":")[0]), ["Primary", "Backup", "Shift"], "exactly the three lines: " + JSON.stringify(ev.desc));
  });
  const ics = unfold(icsApi.generateICS(evs.concat(timed), "Silvis - Khan"));
  assert.ok(!/office-er|open \(9\/22\)|Note\\:|Note:/.test(ics), "the feed carries no note text");
  assert.ok(!/external_cover,note|,note&/.test(csSrc), "calendar-sync no longer reads schedule_days.note");
});
check("Item D ics: two Silvis days + two east_feed days -> four VEVENTs: the Silvis pair ALL-DAY by default (a role change splits: 'Silvis Primary' 10/5, 'Silvis Backup' 10/6) and timed 07:00 Central under ?timed=1, UIDs silvis-<day>-<role>@silvis-call either way, the Davenport pair ALL-DAY (DTSTART;VALUE=DATE the day, DTEND;VALUE=DATE the next day) titled 'Khan <en dash> Davenport night' / 'Khan <en dash> Davenport day call' with UIDs east-FAK-<day>-<reason>@silvis-call; a second build yields the same UIDs; a LOWER-precedence reason added later keeps the UID, a higher one (a holiday assigned onto the day) renames it", () => {
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
  assert.ok(ics.indexOf("UID:silvis-2026-10-05-primary@silvis-call\r\nDTSTAMP:") >= 0 && ics.indexOf("\r\nDTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006\r\nSUMMARY:Silvis Primary\r\n") >= 0, "the Silvis primary day is an all-day event on its start date");
  assert.ok(ics.indexOf("UID:silvis-2026-10-06-backup@silvis-call") >= 0 && ics.indexOf("\r\nDTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261007\r\nSUMMARY:Silvis Backup\r\n") >= 0, "the Silvis backup day (the role change splits the run)");
  const timedIcs = unfold(icsApi.generateICS(icsApi.buildTimedEvents(SILVIS_ROWS, ICS_ROSTER, "s1"), "Silvis - Khan"));
  assert.ok(timedIcs.indexOf("UID:silvis-2026-10-05-primary@silvis-call\r\nDTSTAMP:") >= 0 && timedIcs.indexOf("\r\nDTSTART:20261005T120000Z\r\nDTEND:20261006T120000Z\r\nSUMMARY:Silvis Primary Call\r\n") >= 0, "?timed=1: the Silvis primary day is a timed event, 07:00 to 07:00 Central");
  assert.ok(timedIcs.indexOf("UID:silvis-2026-10-06-backup@silvis-call") >= 0 && timedIcs.indexOf("SUMMARY:Silvis Backup Call\r\n") >= 0, "?timed=1: the Silvis backup day");
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
/* ---- All-day runs (Faraz 2026-09-25: "the calendar looks busy, and 07:00 -> 07:00 shifts draw across two days") ----
   The default feed: one ALL-DAY event per run of consecutive days (DTSTART;VALUE=DATE the first day, DTEND;VALUE=DATE the
   day after the last - RFC 5545 exclusive end), the exact 07:00 -> 07:00 times in the description. ?timed=1 keeps the old
   per-day timed format byte-for-byte. */
const RUN_ROSTER = { byId: { s1: { id: "s1", name: "Khan", code: "FAK" }, s2: { id: "s2", name: "Burchett", code: "MAB" }, s3: { id: "s3", name: "Acton", code: "BDA" }, s4: { id: "s4", name: "Philip", code: "AFP" } } };
const row = (day, p, b, ext) => ({ day, primary_id: p || null, backup_id: b || null, external_cover: ext || null });
const BLOCK_ROWS = [row("2026-10-09", "s2", "s3"), row("2026-10-10", "s2", "s3"), row("2026-10-11", "s2", "s4")]; // Fri-Sun, Burchett's weekend block
check("all-day: a Fri-Sun block -> ONE 3-day event (DTSTART;VALUE=DATE Fri, DTEND;VALUE=DATE Mon), 'Silvis Primary', UID silvis-<start>-primary@silvis-call, the times '07:00 Fri \u2192 07:00 Mon (Central)' and the other role's holders per day in the description; a run that grows or shrinks at its END keeps its UID, a new START day is a new UID", () => {
  if (!icsApi) throw new Error("icsCore did not load");
  const evs = icsApi.buildEvents(BLOCK_ROWS, RUN_ROSTER, "s2");
  assert.deepStrictEqual(evs, [{ uid: "silvis-2026-10-09-primary@silvis-call", allDay: true, start: "20261009", end: "20261012", summary: "Silvis Primary", desc: "07:00 Fri \u2192 07:00 Mon (Central)\nPrimary: Burchett\nBackup: 10/9-10/10 Acton, 10/11 Philip" }]);
  const ics = unfold(icsApi.generateICS(evs, "Silvis Call - Burchett"));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1, "one VEVENT for the whole weekend");
  assert.ok(ics.indexOf("UID:silvis-2026-10-09-primary@silvis-call\r\nDTSTAMP:") >= 0 && ics.indexOf("\r\nDTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261012\r\nSUMMARY:Silvis Primary\r\nDESCRIPTION:07:00 Fri \u2192 07:00 Mon (Central)\\nPrimary: Burchett\\nBackup: 10/9-10/10 Acton\\, 10/11 Philip\r\n") >= 0, "the all-day lines, the arrow as UTF-8 and the comma escaped: " + ics);
  assert.deepStrictEqual(icsApi.buildEvents(BLOCK_ROWS, RUN_ROSTER, "s3").map((e) => [e.uid, e.start, e.end, e.summary, e.desc]), [["silvis-2026-10-09-backup@silvis-call", "20261009", "20261011", "Silvis Backup", "07:00 Fri \u2192 07:00 Sun (Central)\nPrimary: Burchett\nBackup: Acton"]], "Acton's two backup days are one 2-day bar");
  assert.deepStrictEqual(icsApi.buildEvents(BLOCK_ROWS, RUN_ROSTER, "s4").map((e) => [e.uid, e.start, e.end, e.desc]), [["silvis-2026-10-11-backup@silvis-call", "20261011", "20261012", "07:00 Sun \u2192 07:00 Mon (Central)\nPrimary: Burchett\nBackup: Philip"]], "a single day is a one-day bar with both holders");
  const grown = icsApi.buildEvents(BLOCK_ROWS.concat([row("2026-10-12", "s2", "s4")]), RUN_ROSTER, "s2");
  assert.deepStrictEqual(grown.map((e) => [e.uid, e.start, e.end, e.desc]), [["silvis-2026-10-09-primary@silvis-call", "20261009", "20261013", "07:00 Fri \u2192 07:00 Tue (Central)\nPrimary: Burchett\nBackup: 10/9-10/10 Acton, 10/11-10/12 Philip"]], "grows at its end: same UID, the event updates in place");
  const shrunk = icsApi.buildEvents(BLOCK_ROWS.slice(0, 2), RUN_ROSTER, "s2");
  assert.deepStrictEqual(shrunk.map((e) => [e.uid, e.end]), [["silvis-2026-10-09-primary@silvis-call", "20261011"]], "shrinks at its end: same UID");
  const earlier = icsApi.buildEvents([row("2026-10-08", "s2", "s3")].concat(BLOCK_ROWS), RUN_ROSTER, "s2");
  assert.deepStrictEqual(earlier.map((e) => [e.uid, e.start, e.end]), [["silvis-2026-10-08-primary@silvis-call", "20261008", "20261012"]], "a new start day is a new UID (the old one disappears from the feed - a subscription deletes it and adds the new one)");
});
check("all-day: a role change mid-run splits (primary 10/5-10/6, backup 10/7, primary 10/8), and so does a day off (10/9 someone else) - four bars for Khan, primary before backup on a shared start day", () => {
  if (!icsApi) throw new Error("icsCore did not load");
  const rows = [row("2026-10-05", "s1", "s2"), row("2026-10-06", "s1", "s3"), row("2026-10-07", "s2", "s1"), row("2026-10-08", "s1", "s2"), row("2026-10-09", "s2", "s3"), row("2026-10-10", "s1", "s2")];
  const evs = icsApi.buildEvents(rows, RUN_ROSTER, "s1");
  assert.deepStrictEqual(evs.map((e) => [e.uid, e.start, e.end, e.summary]), [
    ["silvis-2026-10-05-primary@silvis-call", "20261005", "20261007", "Silvis Primary"],
    ["silvis-2026-10-07-backup@silvis-call", "20261007", "20261008", "Silvis Backup"],
    ["silvis-2026-10-08-primary@silvis-call", "20261008", "20261009", "Silvis Primary"],
    ["silvis-2026-10-10-primary@silvis-call", "20261010", "20261011", "Silvis Primary"],
  ]);
  assert.strictEqual(evs[0].desc, "07:00 Mon \u2192 07:00 Wed (Central)\nPrimary: Khan\nBackup: 10/5 Burchett, 10/6 Acton", "the other role's holder is listed per day when it changes");
  assert.strictEqual(evs[1].desc, "07:00 Wed \u2192 07:00 Thu (Central)\nPrimary: Burchett\nBackup: Khan");
  const gap = icsApi.buildEvents([row("2026-10-05", "s1", "s2"), row("2026-10-07", "s1", "s2")], RUN_ROSTER, "s1");
  assert.deepStrictEqual(gap.map((e) => e.uid), ["silvis-2026-10-05-primary@silvis-call", "silvis-2026-10-07-primary@silvis-call"], "a missing day (no row) splits too");
});
check("all-day group feed: ONE event per run of consecutive days with the SAME primary AND the SAME backup, titled 'P <name> \u00b7 B <name>' (OPEN / '<name> (external cover)'), UID silvis-<start>-group@silvis-call; a day with neither assignment produces no event and breaks the run", () => {
  if (!icsApi) throw new Error("icsCore did not load");
  const rows = [row("2026-10-09", "s2", "s3"), row("2026-10-10", "s2", "s3"), row("2026-10-11", "s2", "s4"), row("2026-10-12", "s2", "s4"),
    row("2026-10-13", null, null), row("2026-10-14", null, "s1", "Lee"), row("2026-10-15", null, "s1", "Lee"), row("2026-10-16", "s1", null),
    row("2026-10-17", "s1", null), row("2026-10-18", "s3", "s1"), row("2026-10-19", null, null, "Lee"), row("2026-10-20", "s3", "s1")];
  const evs = icsApi.buildEvents(rows, RUN_ROSTER, null);
  assert.deepStrictEqual(evs.map((e) => [e.uid, e.start, e.end, e.summary]), [
    ["silvis-2026-10-09-group@silvis-call", "20261009", "20261011", "P Burchett \u00b7 B Acton"],
    ["silvis-2026-10-11-group@silvis-call", "20261011", "20261013", "P Burchett \u00b7 B Philip"],
    ["silvis-2026-10-14-group@silvis-call", "20261014", "20261016", "P Lee (external cover) \u00b7 B Khan"],
    ["silvis-2026-10-16-group@silvis-call", "20261016", "20261018", "P Khan \u00b7 B OPEN"],
    ["silvis-2026-10-18-group@silvis-call", "20261018", "20261019", "P Acton \u00b7 B Khan"],
    ["silvis-2026-10-20-group@silvis-call", "20261020", "20261021", "P Acton \u00b7 B Khan"],
  ], "same primary with a different backup splits (10/11); the empty 10/13 and the cover-only 10/19 make no event and split identical pairs (10/18 | 10/20)");
  assert.strictEqual(evs[0].desc, "07:00 Fri \u2192 07:00 Sun (Central)\nPrimary: Burchett\nBackup: Acton");
  const ics = unfold(icsApi.generateICS(evs, "Silvis Call - All"));
  assert.ok(ics.indexOf("\r\nDTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261011\r\nSUMMARY:P Burchett \u00b7 B Acton\r\n") >= 0, "the group bar, the middle dot as UTF-8");
  assert.strictEqual(new Set(evs.map((e) => e.uid)).size, evs.length, "unique UIDs (runs partition the days)");
});
check("all-day Davenport: consecutive busy days with the SAME reason merge into one bar - a service week Mon-Sat is ONE event 'Khan \u2013 Davenport service week' (UID east-FAK-<first day>-service-week@silvis-call, DTEND the Sunday), the extra reasons listed per day in the description; the Sunday weekend is its own bar; away ranges stay one event per range", () => {
  if (!icsApi || !eastApi) throw new Error("blocks did not load");
  const weeks = [{ weekMonday: "2026-10-12", data: { dayCall: "s6", nights: { mon: "s1", tue: "s6", wed: "s3", thu: "s4", wknd: "s6" }, off: "s7", vacations: [{ code: "FAK", start: "2026-10-26", end: "2026-10-28" }] } }];
  const entries = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks, reviews: [{ person_id: "s1", start: "2026-10-26", end: "2026-10-28", decision: "away" }], from: "2026-10-01", to: "2026-12-31" });
  assert.strictEqual(entries.busy.length, 7, "seven busy days in the fixture (Mon-Sat service week + the Sunday weekend)");
  const ev = icsApi.eastIcsEvents(entries, "FAK");
  assert.deepStrictEqual(ev.map((e) => [e.uid, e.start, e.end, e.summary]), [
    ["east-FAK-2026-10-12-service-week@silvis-call", "20261012", "20261018", "Khan \u2013 Davenport service week"],
    ["east-FAK-2026-10-18-weekend@silvis-call", "20261018", "20261019", "Khan \u2013 Davenport weekend"],
    ["east-FAK-away-2026-10-26-2026-10-28@silvis-call", "20261026", "20261029", "Khan \u2013 away (Davenport vacation)"],
  ]);
  assert.ok(ev.every((e) => e.allDay === true));
  assert.strictEqual(ev[0].desc, "Davenport (East) call:\n10/12 Davenport service week\n10/13 Davenport service week, Davenport night\n10/14-10/15 Davenport service week\n10/16 Davenport service week, Davenport weekend\n10/17 Davenport service week\nSource: the Davenport schedule as cached in the Silvis East feed");
  assert.strictEqual(ev[1].desc, "Davenport (East) call: Davenport weekend\nSource: the Davenport schedule as cached in the Silvis East feed", "a run whose days share one detail keeps today's one-line description");
  assert.deepStrictEqual(icsApi.eastIcsDayEvents(entries, "FAK").filter((e) => /service-week|weekend/.test(e.uid)).map((e) => e.uid.slice(9, 19)), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"], "?timed=1 keeps one all-day event per busy day (today's format)");
  const ics = unfold(icsApi.generateICS(ev, "Silvis + Davenport - Khan"));
  assert.ok(ics.indexOf("\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261018\r\nSUMMARY:Khan \u2013 Davenport service week\r\n") >= 0, "one bar Mon-Sat");
});
// Captured from calendar-sync v4 (a1aee16, BEFORE the all-day change) with DTSTAMP normalised to "X": buildEvents +
// eastIcsEvents + generateICS on TIMED_ROWS (both clock changes, an escaped external cover, an OPEN backup, a note)
// and ICS_WEEK. ?timed=1 must reproduce it byte-for-byte.
const TIMED_ROWS = [
  { day: "2026-10-30", primary_id: "s2", backup_id: "s3", external_cover: null },
  { day: "2026-10-31", primary_id: "s1", backup_id: "s2", external_cover: null },
  { day: "2026-11-01", primary_id: "s1", backup_id: "s2", external_cover: null, note: "Bring, the; pager" },
  { day: "2026-11-03", primary_id: null, backup_id: "s1", external_cover: "Lee, locum; a" + String.fromCharCode(92) + "b" },
  { day: "2026-11-04", primary_id: "s1", backup_id: null, external_cover: null },
  { day: "2027-03-13", primary_id: "s1", backup_id: "s3", external_cover: null },
];
const TIMED_V4_KHAN_EAST = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Silvis Call Schedule//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Silvis + Davenport - Khan",
  "X-WR-TIMEZONE:America/Chicago",
  "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  "X-PUBLISHED-TTL:PT1H",
  "BEGIN:VEVENT",
  "UID:silvis-2026-10-31-primary@silvis-call",
  "DTSTAMP:X",
  "DTSTART:20261031T120000Z",
  "DTEND:20261101T130000Z",
  "SUMMARY:Silvis Primary Call",
  "DESCRIPTION:Primary: Khan\\nBackup: Burchett\\nShift: 07:00 to 07:00 next day",
  "  (Central)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:silvis-2026-11-01-primary@silvis-call",
  "DTSTAMP:X",
  "DTSTART:20261101T130000Z",
  "DTEND:20261102T130000Z",
  "SUMMARY:Silvis Primary Call",
  "DESCRIPTION:Primary: Khan\\nBackup: Burchett\\nShift: 07:00 to 07:00 next day",
  "  (Central)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:silvis-2026-11-03-backup@silvis-call",
  "DTSTAMP:X",
  "DTSTART:20261103T130000Z",
  "DTEND:20261104T130000Z",
  "SUMMARY:Silvis Backup Call",
  "DESCRIPTION:Primary: Lee\\, locum\\; a\\\\b (external cover)\\nBackup: Khan\\nShi",
  " ft: 07:00 to 07:00 next day (Central)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:silvis-2026-11-04-primary@silvis-call",
  "DTSTAMP:X",
  "DTSTART:20261104T130000Z",
  "DTEND:20261105T130000Z",
  "SUMMARY:Silvis Primary Call",
  "DESCRIPTION:Primary: Khan\\nBackup: OPEN\\nShift: 07:00 to 07:00 next day (Ce",
  " ntral)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:silvis-2027-03-13-primary@silvis-call",
  "DTSTAMP:X",
  "DTSTART:20270313T130000Z",
  "DTEND:20270314T120000Z",
  "SUMMARY:Silvis Primary Call",
  "DESCRIPTION:Primary: Khan\\nBackup: Acton\\nShift: 07:00 to 07:00 next day (C",
  " entral)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:east-FAK-2026-10-13-night@silvis-call",
  "DTSTAMP:X",
  "DTSTART;VALUE=DATE:20261013",
  "DTEND;VALUE=DATE:20261014",
  "SUMMARY:Khan \u2013 Davenport night",
  "DESCRIPTION:Davenport (East) call: Davenport night\\nSource: the Davenport s",
  " chedule as cached in the Silvis East feed",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:east-FAK-2026-10-15-override@silvis-call",
  "DTSTAMP:X",
  "DTSTART;VALUE=DATE:20261015",
  "DTEND;VALUE=DATE:20261016",
  "SUMMARY:Khan \u2013 Davenport day call",
  "DESCRIPTION:Davenport (East) call: Davenport day call\\nSource: the Davenpor",
  " t schedule as cached in the Silvis East feed",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");
// The v4 group feed on TIMED_ROWS (101 lines, 2823 bytes) - pinned by its SHA-256.
const TIMED_V4_GROUP_SHA256 = "b3713dfd0a2832c0360fef53791b0543547f3f9f9fc2bed0c952466e08e65179";
check("?timed=1 reproduces the pre-9/25 (v4) output byte-for-byte: buildTimedEvents + eastIcsDayEvents + generateICS on a fixture across both clock changes equal the captured v4 text (DTSTAMP normalised) - the per-surgeon + Davenport feed line for line, the group feed by SHA-256", () => {
  if (!icsApi || !eastApi) throw new Error("blocks did not load");
  const norm = (t) => t.replace(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:X");
  const entries = eastApi.eastEntries({ lastName: "Khan", code: "FAK", rosterId: "s1", eastId: DAV_FAK, weeks: ICS_WEEK, reviews: [], from: "2026-10-01", to: "2027-12-31" });
  const khan = norm(icsApi.generateICS(icsApi.buildTimedEvents(TIMED_ROWS, ICS_ROSTER, "s1").concat(icsApi.eastIcsDayEvents(entries, "FAK")), "Silvis + Davenport - Khan"));
  const a = khan.split("\r\n"), b = TIMED_V4_KHAN_EAST.split("\r\n");
  const i = a.findIndex((l, k) => l !== b[k]);
  assert.strictEqual(khan, TIMED_V4_KHAN_EAST, "first difference at line " + i + ": " + JSON.stringify(a[i]) + " vs v4 " + JSON.stringify(b[i]));
  const group = norm(icsApi.generateICS(icsApi.buildTimedEvents(TIMED_ROWS, ICS_ROSTER, null), "Silvis Call - All"));
  assert.strictEqual(Buffer.byteLength(group, "utf8"), 2823, "the v4 group text is 2823 bytes");
  assert.strictEqual(require("crypto").createHash("sha256").update(group, "utf8").digest("hex"), TIMED_V4_GROUP_SHA256, "the group feed differs from v4");
});
check("calendar-sync handler: ?timed=1 (1 / true / yes) picks buildTimedEvents + eastIcsDayEvents over EXACTLY the old window; the default builds all-day runs from rows read RUN_LOOKBACK_DAYS earlier and drops the runs that end before the window (a run straddling today-60 keeps its start day, so its UID does not move daily); X-WR-CALNAME, 200 / 404 / 405 unchanged", () => {
  const h = csSrc.slice(csSrc.indexOf("Deno.serve(async (req) =>"));
  assert.ok(/const timedParam = \(url\.searchParams\.get\("timed"\) \|\| ""\)\.trim\(\)\.toLowerCase\(\);/.test(h) && /const timed = timedParam === "1" \|\| timedParam === "true" \|\| timedParam === "yes";/.test(h), "the timed param is read like east");
  assert.ok(/const RUN_LOOKBACK_DAYS = 14;/.test(csSrc) && /const readFrom = addDays\(from, -RUN_LOOKBACK_DAYS\);/.test(h) && /day=gte\.\$\{readFrom\}&day=lte\.\$\{to\}/.test(h), "rows are read from the lookback");
  assert.ok(/timed\s*\? buildTimedEvents\(rows\.filter\(\(r\) => String\(r\.day\)\.slice\(0, 10\) >= from\), roster, onlyId\)\s*: endsOnOrAfter\(buildEvents\(rows, roster, onlyId\), from\)/.test(h), "the Silvis events by mode");
  assert.ok(/timed\s*\? eastIcsDayEvents\(eastEntries\(\{[^}]*from, to \}\), code\)\s*: endsOnOrAfter\(eastIcsEvents\(eastEntries\(\{[^}]*from: readFrom, to \}\), code\), from\)/.test(h), "the Davenport events by mode");
  assert.ok(/let title = "Silvis Call - All";/.test(h) && /title = `Silvis Call - \$\{who\.name\}`;/.test(h), "X-WR-CALNAME unchanged");
  if (!icsApi) throw new Error("icsCore did not load");
  const b = blockOf(csSrc, "calendar-sync", "icsCore");
  const endsOnOrAfter = new Function(b + "\nreturn endsOnOrAfter;")();
  const evs = icsApi.buildEvents([row("2026-10-09", "s2", "s3"), row("2026-10-10", "s2", "s3"), row("2026-10-13", "s1", "s3")], RUN_ROSTER, null);
  assert.deepStrictEqual(endsOnOrAfter(evs, "2026-10-10").map((e) => e.uid), ["silvis-2026-10-09-group@silvis-call", "silvis-2026-10-13-group@silvis-call"], "a run that reaches the window's first day is kept whole (its start and UID unchanged)");
  assert.deepStrictEqual(endsOnOrAfter(evs, "2026-10-11").map((e) => e.uid), ["silvis-2026-10-13-group@silvis-call"], "a run that ended before the window is dropped");
});
check("all-day docs: the calendar-sync header documents the all-day default, the run UIDs (silvis-<start>-<role> / silvis-<start>-group, a new start day = a new UID) and ?timed=1; edge-functions/README.md section 3 carries the deployed calendar-sync v4 -> v5 row and section 5 the all-day + ?timed=1 checks; docs/SILVIS-BUILD-GUIDE.md says the feed is all-day by default, ?timed=1 keeps the old format and the app's download is all-day only", () => {
  const head = csSrc.slice(0, csSrc.indexOf("const SUPABASE_URL"));
  assert.ok(/VALUE=DATE/.test(head) && /silvis-<start>-<role>@silvis-call/.test(head) && /silvis-<start>-group@silvis-call/.test(head) && /timed=1/.test(head), "the header names the format, the UIDs and ?timed=1");
  assert.ok(/new UID/.test(head) && /updates? (it )?in place/.test(head), "the header says what a start-day change does (a new UID) and that an end change updates in place");
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  assert.ok(/\| 2026-09-25 13:20:14 \| `calendar-sync` \| v4 -> \*\*v5 \(deployed 2026-09-25 13:20:14 UTC\)\*\*/.test(s3) && !/\| PENDING \| `calendar-sync`/.test(s3), "section 3: the calendar-sync v4 -> v5 row carries its deploy (2026-09-25 13:20:14 UTC), no PENDING row left");
  const s5 = readme.slice(readme.indexOf("### calendar-sync"), readme.indexOf("### office-notifications"));
  assert.ok(/timed=1/.test(s5) && /DTSTART;VALUE=DATE/.test(s5) && /P <name> \. B <name>|P Burchett/.test(s5), "section 5: the all-day default and the ?timed=1 check");
  const guide = read("docs/SILVIS-BUILD-GUIDE.md");
  assert.ok(/timed=1/.test(guide) && /all-day/i.test(guide) && /download[^\n]*all-day only|all-day only[^\n]*download/i.test(guide), "the build guide: all-day default, ?timed=1, the download all-day only");
  const tools = read("index-source.html").split("Calendar files (.ics)")[1] || "";
  assert.ok(/earlier file[^<]*delete those events first/i.test(tools.slice(0, tools.indexOf("</p>"))), "the Calendar files note tells someone who imported an earlier per-day file to delete those events first (an import never removes events; review 9/25)");
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

/* =====================================================================
   Prompt 20 F3 (Faraz 9/24) - FOLLOWERS in the two per-user mail functions. A viewer / coordinator account
   (user_profiles.follows, revision o) receives what each followed surgeon receives, read-only, driven by its OWN
   notification_preferences row (keyed by profile_id). One plain-JS '@followers' mirror block, byte-identical in
   send-notification and daily-reminder, extracted and run here:
     followerFollows(p)            - the follows list (== helpers.js followsOf)
     followerIndex(profiles, prefs) - the follower accounts with their own prefs row
     followerUniverse(...)         - send-notification: whose followers a send reaches - the trade row's two parties, the
                                     claimer, the targetIds, or null (a broadcast: every follower); never a scheduler copy
     followerRecipients(...)       - send-notification: followers of that universe, for trade_* / shift_claimed /
                                     open_shifts / schedule_published only, on the follower's own flag; added AFTER every gate
     followerReminderPlan(...)     - daily-reminder: one entry per follower x followed surgeon on call tomorrow, at the
                                     follower's own hour, on his own shift_reminders_email
     followerReminderLine(...)     - "Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Khan"
   ===================================================================== */
let FOL = null;
check("P20 F3: send-notification and daily-reminder carry an identical plain-JS '@followers' mirror block defining followerFollows, followerTag, followerIndex, followerUniverse, followerRecipients, followerReminderPlan, followerReminderLine and FOLLOWER_SEND_TYPES", () => {
  const blocks = [["send-notification", blockOf(snSrc, "send-notification", "followers")], ["daily-reminder", blockOf(drSrc, "daily-reminder", "followers")]];
  blocks.forEach(([n, b]) => plainJs(b, n));
  identical(blocks, "followers");
  const api = new Function(blocks[0][1] + "\nreturn { followerFollows, followerTag, followerIndex, followerUniverse, followerRecipients, followerReminderPlan, followerReminderLine, FOLLOWER_SEND_TYPES };")();
  for (const k of Object.keys(api)) assert.ok(api[k], "the block defines " + k);
  FOL = api;
});
const H20 = require(path.join(ROOT, "helpers.js"));
const FPROFILES = [
  { id: "f1aaaaaa-np", role: "viewer", person_id: null, email: "np@example.org", display_name: "Follower (harness)", follows: ["s2"] },
  { id: "f2bbbbbb-app", role: "coordinator", person_id: null, email: "app@example.org", display_name: null, follows: ["s5", "s2"] },
  { id: "f3cccccc-plain", role: "viewer", person_id: null, email: "plain@example.org", display_name: null, follows: [] },
  { id: "f4dddddd-surgeon", role: "surgeon", person_id: "s3", email: "s3@example.org", display_name: null, follows: ["s2"] },
  { id: "f5eeeeee-noaddr", role: "viewer", person_id: null, email: "  ", display_name: null, follows: ["s2"] },
  { id: "f6ffffff-nocol", role: "viewer", person_id: null, email: "old@example.org", display_name: null },
  // review F3: a viewer / coordinator LINKED to a roster entry is never a follower, whatever follows says (Setup's
  // followsPatch checks the role only, and linking an account keeps its follows)
  { id: "f7a1b2c3-linkedv", role: "viewer", person_id: "s3", email: "lv@example.org", display_name: null, follows: ["s2"] },
  { id: "f8d4e5f6-linkedc", role: "coordinator", person_id: "s4", email: "lc@example.org", display_name: null, follows: ["s2", "s5"] },
];
const FPREFS = [
  { person_id: "s2", profile_id: null, trade_updates_email: false, schedule_updates_email: false, shift_reminders_email: false, reminder_hour_central: 6 },
  { person_id: null, profile_id: "f2bbbbbb-app", trade_updates_email: false, schedule_updates_email: true, shift_reminders_email: true, reminder_hour_central: 20 },
];
check("P20 F3: followerFollows is helpers.js followsOf (same answers over the fixture family); followerIndex keeps a viewer / coordinator with no roster link and a non-empty follows list, with its OWN prefs row by profile_id (a surgeon's person_id row never stands in); a row without the column (before revision o) is nobody; followerTag is the id's first 8 characters", () => {
  if (!FOL) throw new Error("followers block did not load");
  const family = [{ follows: ["s2", "s5"] }, { follows: ["s2", "s2", "", 7, null, "s5"] }, { follows: "s2" }, { follows: null }, {}, null, undefined, { follows: [] }];
  family.forEach((p) => assert.deepStrictEqual(FOL.followerFollows(p), H20.followsOf(p), "mirror identity for " + JSON.stringify(p)));
  const idx = FOL.followerIndex(FPROFILES, FPREFS);
  assert.deepStrictEqual(idx.map((f) => f.tag), ["f1aaaaaa", "f2bbbbbb", "f5eeeeee"], "the viewer, the coordinator and the viewer without an address - not the plain viewer, the surgeon or the row without the column");
  assert.deepStrictEqual(idx[1].follows, ["s5", "s2"]);
  assert.strictEqual(idx[0].prefs, null, "no prefs row of his own -> null (every flag on, the default hour)");
  assert.strictEqual(idx[1].prefs.reminder_hour_central, 20, "the coordinator's own row, by profile_id");
  assert.strictEqual(idx[2].email, null, "a blank address is none");
  assert.strictEqual(idx[0].name, "Follower (harness)");
  assert.deepStrictEqual(FOL.followerIndex(null, null), [], "no rows -> nobody (never throws)");
  assert.strictEqual(FOL.followerTag("f1aaaaaa-np"), "f1aaaaaa");
  const linked = ["f7a1b2c3", "f8d4e5f6"];
  assert.ok(!idx.some((f) => linked.indexOf(f.tag) >= 0), "a viewer / coordinator linked to a roster entry is never a follower");
  const tr = FOL.followerRecipients(idx, "trade_applied", ["s2", "s5"], "trade_updates_email");
  assert.ok(![...tr.list, ...tr.skipped].some((f) => linked.indexOf(f.tag || f.follower) >= 0), "... so no send lists him");
  const pl = FOL.followerReminderPlan(idx, [{ person_id: "s2", role: "primary", otherLabel: "Khan" }, { person_id: "s5", role: "backup", otherLabel: "Burchett" }], 17, 17);
  assert.ok(!pl.some((e) => linked.indexOf(e.follower) >= 0), "... and no reminder names him");
});
check("P20 F3: followerRecipients - trade_* (a give rides trade_* with data.kind 'give'), shift_claimed, open_shifts and schedule_published add each follower of an id in the universe ONCE (via = the followed ids in it), on the follower's OWN flag; a null universe (a broadcast) is every follower with all his follows; manual_edit, vacation_logged, test and the offers types add nobody; an empty universe adds nobody", () => {
  if (!FOL) throw new Error("followers block did not load");
  const idx = FOL.followerIndex(FPROFILES, FPREFS);
  assert.deepStrictEqual(FOL.FOLLOWER_SEND_TYPES, ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied", "shift_claimed", "open_shifts", "schedule_published"]);
  // review F3: the publish mail is a broadcast over LINKED persons, so a follower (person_id null) was never in it - he
  // gets it now, as every follower does, whether or not the followed surgeon's account is linked
  const pub = FOL.followerRecipients(idx, "schedule_published", null, "schedule_updates_email");
  assert.deepStrictEqual(pub.list.map((f) => [f.tag, f.via]), [["f1aaaaaa", ["s2"]], ["f2bbbbbb", ["s5", "s2"]], ["f5eeeeee", ["s2"]]], "a broadcast (null universe): every follower once, via all his follows");
  const ob = FOL.followerRecipients(idx, "open_shifts", null, "schedule_updates_email");
  assert.deepStrictEqual(ob.list.map((f) => f.tag), ["f1aaaaaa", "f2bbbbbb", "f5eeeeee"], "the open-shifts broadcast likewise (the in-app feed shows it to every follower)");
  const pubOff = FOL.followerRecipients(FOL.followerIndex(FPROFILES, [{ person_id: null, profile_id: "f1aaaaaa-np", schedule_updates_email: false }]), "schedule_published", null, "schedule_updates_email");
  assert.deepStrictEqual(pubOff.skipped, [{ follower: "f1aaaaaa", via: ["s2"], status: "skipped_pref_off" }], "his own schedule flag off -> no publish mail");
  const t = FOL.followerRecipients(idx, "trade_proposed", ["s2", "s3"], "trade_updates_email");
  assert.deepStrictEqual(t.list.map((f) => [f.tag, f.via]), [["f1aaaaaa", ["s2"]], ["f5eeeeee", ["s2"]]], "the s2 followers; the coordinator's own trade flag is off");
  assert.deepStrictEqual(t.skipped, [{ follower: "f2bbbbbb", via: ["s2"], status: "skipped_pref_off" }], "the opted-out follower is reported, never mailed");
  const c = FOL.followerRecipients(idx, "shift_claimed", ["s5", "s1"], "schedule_updates_email");
  assert.deepStrictEqual(c.list.map((f) => [f.tag, f.via]), [["f2bbbbbb", ["s5"]]], "a claim by s5 reaches his follower on her schedule flag");
  const o = FOL.followerRecipients(idx, "open_shifts", ["s1", "s2", "s3", "s4", "s5", "s6"], "schedule_updates_email");
  assert.deepStrictEqual(o.list.map((f) => [f.tag, f.via]), [["f1aaaaaa", ["s2"]], ["f2bbbbbb", ["s5", "s2"]], ["f5eeeeee", ["s2"]]], "a broadcast universe: every follower once, even one following two surgeons in it");
  ["manual_edit", "vacation_logged", "test", "offers_reminder", "offers_closed", "shift_reminder"].forEach((ty) => {
    assert.deepStrictEqual(FOL.followerRecipients(idx, ty, ["s2", "s5"], "schedule_updates_email"), { list: [], skipped: [] }, ty + " adds no follower");
    assert.deepStrictEqual(FOL.followerRecipients(idx, ty, null, "schedule_updates_email"), { list: [], skipped: [] }, ty + " adds no follower, even as a broadcast");
  });
  assert.deepStrictEqual(FOL.followerRecipients(idx, "trade_applied", [], "trade_updates_email"), { list: [], skipped: [] }, "empty universe");
  assert.deepStrictEqual(FOL.followerRecipients(idx, "trade_applied", ["s4"], "trade_updates_email"), { list: [], skipped: [] }, "nobody follows s4");
});
check("P20 F3 (review): followerUniverse - whose followers a send reaches: a trade_* reaches the trade row's two parties (never a scheduler-linked copy in targetIds, e.g. Prompt 19's trade_applied), shift_claimed the claimer only (the caller; a scheduler caller may name data.surgeon_id), open_shifts / schedule_published the targetIds or, as a broadcast, null (every follower); any other type, a trade without its row, a targeted list without the party -> []", () => {
  if (!FOL) throw new Error("followers block did not load");
  const U = FOL.followerUniverse;
  const surgeon = (pid) => ({ role: "surgeon", personId: pid }), sched = { role: "admin", personId: "s1" };
  const trade = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  assert.deepStrictEqual(U("trade_applied", ["s2", "s3", "s1"], sched, {}, trade), ["s2", "s3"], "the scheduler copy (s1) is not a party - his followers are not mailed about another surgeon's trade");
  assert.deepStrictEqual(U("trade_proposed", ["s2", "s3"], surgeon("s2"), { kind: "give" }, trade), ["s2", "s3"], "a give rides trade_*: the two parties");
  assert.deepStrictEqual(U("trade_declined", ["s2", "s3"], surgeon("s2"), {}, null), [], "no trade row -> nobody (the gate refuses it before this anyway)");
  assert.deepStrictEqual(U("trade_declined", null, sched, {}, trade), [], "a trade is never a broadcast");
  assert.deepStrictEqual(U("shift_claimed", ["s3", "s1"], surgeon("s3"), { surgeon_id: "s3" }, null), ["s3"], "the claimer - not the scheduler-linked copy");
  assert.deepStrictEqual(U("shift_claimed", ["s3", "s1"], surgeon("s3"), { surgeon_id: "s1" }, null), ["s3"], "a surgeon caller cannot point the claim at someone else");
  assert.deepStrictEqual(U("shift_claimed", ["s4", "s1"], sched, { surgeon_id: "s4" }, null), ["s4"], "a scheduler caller: data.surgeon_id when it is in targetIds");
  assert.deepStrictEqual(U("shift_claimed", ["s1"], sched, { surgeon_id: "s4" }, null), [], "... and nobody when it is not");
  assert.deepStrictEqual(U("open_shifts", ["s2", "s5"], sched, {}, null), ["s2", "s5"], "targeted open shifts: the targetIds");
  assert.strictEqual(U("open_shifts", null, sched, {}, null), null, "the open-shifts broadcast: every follower");
  assert.strictEqual(U("schedule_published", null, sched, {}, null), null, "the publish broadcast: every follower");
  ["manual_edit", "vacation_logged", "test", "offers_reminder"].forEach((ty) => assert.deepStrictEqual(U(ty, null, sched, {}, null), [], ty + " -> nobody"));
});
check("P20 F3: followerReminderPlan + followerReminderLine - one entry per follower x followed surgeon on call tomorrow, at the follower's OWN hour (else the function default), on his OWN shift_reminders_email; nothing when the followed surgeon is off; the line reads 'Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Khan' / '... is on backup call ..., primary <Name>'", () => {
  if (!FOL) throw new Error("followers block did not load");
  const idx = FOL.followerIndex(FPROFILES, FPREFS);
  const onCall = [{ person_id: "s2", role: "primary", otherLabel: "Khan" }, { person_id: "s5", role: "backup", otherLabel: "Burchett" }];
  const at17 = FOL.followerReminderPlan(idx, onCall, 17, 17);
  assert.deepStrictEqual(at17.map((e) => [e.follower, e.surgeon, e.role, e.status, e.user_hour]), [
    ["f1aaaaaa", "s2", "primary", "due", 17],
    ["f2bbbbbb", "s5", "backup", "skipped_wrong_hour", 20],
    ["f2bbbbbb", "s2", "primary", "skipped_wrong_hour", 20],
    ["f5eeeeee", "s2", "primary", "skipped_no_email", 17],
  ], "17:00: the default-hour follower is due; the coordinator waits for her own 20:00; the address-less follower is reported");
  const at20 = FOL.followerReminderPlan(idx, onCall, 20, 17);
  assert.deepStrictEqual(at20.filter((e) => e.status === "due").map((e) => [e.follower, e.surgeon]), [["f2bbbbbb", "s5"], ["f2bbbbbb", "s2"]], "20:00: one e-mail per followed surgeon on call");
  assert.ok(at17.every((e) => e.otherLabel === (e.surgeon === "s2" ? "Khan" : "Burchett")), "the other role's holder rides along");
  const off = FOL.followerIndex(FPROFILES, [{ person_id: null, profile_id: "f1aaaaaa-np", shift_reminders_email: false }]);
  assert.strictEqual(FOL.followerReminderPlan(off, onCall, 17, 17)[0].status, "skipped_off", "his own switch off -> nothing");
  assert.deepStrictEqual(FOL.followerReminderPlan(idx, [{ person_id: "s4", role: "primary", otherLabel: "Khan" }], 17, 17), [], "the followed surgeons are off tomorrow -> nothing");
  assert.deepStrictEqual(FOL.followerReminderPlan(idx, [], 17, 17), [], "nobody on call -> nothing");
  assert.strictEqual(FOL.followerReminderLine("Burchett", "primary", "2026-10-09", "Khan"), "Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Khan");
  assert.strictEqual(FOL.followerReminderLine("Fierce", "backup", "2026-10-10", "Burchett"), "Reminder: Dr. Fierce is on backup call at Silvis tomorrow (Sat 10/10), primary Burchett");
  assert.strictEqual(FOL.followerReminderLine("Fierce", "backup", "2026-12-31", "OPEN"), "Reminder: Dr. Fierce is on backup call at Silvis tomorrow (Thu 12/31), primary OPEN");
});
check("P20 F3 source pins - send-notification: followers are added AFTER the gates and the surgeons' loop (targetIds, the cap, sendGate and tradePartyCheck never see them); the follower read is user_profiles?select=*&role=in.(viewer,coordinator) (select=* - naming follows would 400 before revision o) beside the prefs rows resolveRecipients already read; a failed follower read is logged and answered as followers_error, never a 502 after the surgeons were mailed; the response lists followers_sent / followers_failed / followers_skipped_pref_off (tags, never addresses) and followers_added only to an admin / scheduler caller; the follower read runs only for the FOLLOWER_SEND_TYPES; the follower universe is followerUniverse (the trade row's parties / the claimer, never a scheduler copy)", () => {
  const h = snSrc.slice(snSrc.indexOf("serve(async (req) =>"));
  const iLoop = h.indexOf("for (const r of list) {"), iFol = h.indexOf("followerRecipients(");
  assert.ok(iLoop > 0 && iFol > iLoop, "followers come after the surgeons' loop");
  for (const w of ["sendGate(caller, type, targetIds, schedulerIds)", "tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId)", "targetIds.length > cap", "resolveRecipients(cat, targetIds, roster.names)"]) assert.ok(h.indexOf(w) > 0 && h.indexOf(w) < iFol, w + " runs before any follower is added");
  assert.ok(/const fUniverse = followerUniverse\(type, targetIds, caller, data, tradeRow\);/.test(h), "review F3: the follower universe is the notice's own parties");
  assert.ok(/tradeRow = trade;/.test(h) && h.indexOf("tradeRow = trade;") > h.indexOf("tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId)"), "the trade row is kept only after the party check passed");
  assert.ok(/followerRecipients\(followers, type, fUniverse, cat\.pref\)/.test(h), "the follower's own flag for the category (trade_updates_email / schedule_updates_email)");
  const iGuard = h.indexOf("if (FOLLOWER_SEND_TYPES.indexOf(type) >= 0) {"), iRead = h.indexOf('rest("user_profiles?select=*&role=in.(viewer,coordinator)")');
  assert.ok(iGuard > iLoop && iRead > iGuard && iFol > iRead, "review F3: the follower read runs inside the FOLLOWER_SEND_TYPES guard (no read, no followers_error on other sends)");
  assert.ok(iRead > 0, "the follower accounts, select=*");
  assert.ok(!/rest[(]["`][^"`]*follows/.test(snSrc), "no read names the follows column");
  assert.ok(/const \{ list, skippedPrefOff, prefRows \} = await resolveRecipients\(/.test(h), "resolveRecipients hands back the prefs rows it read");
  const fb = h.slice(iFol - 1200, h.indexOf("return json(200, {", iFol));
  assert.ok(/try \{[^]*followerIndex\(fProfiles, prefRows\)[^]*\} catch \(e\) \{[^]*followersError = /.test(fb), "the follower part is isolated in its own try / catch");
  assert.ok(/console\.error\(`\[send-notification\] followers: /.test(fb), "a follower failure is logged");
  assert.ok(/buildEmail\(type, cat, data, f\.name \|\| "", f\.via\.map\(\(id\) => roster\.names\[id\] \|\| id\)\)/.test(fb), "the follower frame names the followed surgeon(s)");
  assert.ok(/sendEmail\(f\.email, subject, html, `type=\$\{type\} follower=\$\{f\.tag\}`\)/.test(fb), "the log key is the follower tag, never the address");
  const ret = h.slice(h.indexOf("return json(200, {", iFol));
  assert.ok(/followers_sent: followersSent, followers_failed: followersFailed, followers_skipped_pref_off: followersPrefOff/.test(ret) && /followers_error: followersError/.test(ret), "the response lists the follower counts");
  assert.ok(/\.\.\.\(privileged \? \{ followers_added: followersAdded \} : \{\}\)/.test(ret), "review F3: the per-follower list (id8 + followed ids) goes to an admin / scheduler caller only - a surgeon gets the counts");
  assert.ok(!/followers_added: followersAdded, followers_sent/.test(ret), "... never unconditionally");
  assert.ok(/sent, failed, skipped_no_email: skippedNoEmail, skipped_pref_off: skippedPrefOff, results/.test(ret), "the surgeons' accounting is unchanged (the client's toast reads sent / failed)");
  assert.ok(/function buildEmail\(type: string, cat: Category, data: any, recipientName: string, followed: string\[\] = \[\]\)/.test(snSrc), "buildEmail takes the followed names");
  assert.ok(snSrc.includes('${recipientName ? `Hi ${escHtml(recipientName)},` : "Hi,"}'), "review F3: a follower without a display name reads 'Hi,'");
  // review F3: the follower frame is worded truthfully - the notice was SENT to the surgeon (he may have opted out), and a
  // follower has no switches in the app, so he asks the scheduler
  assert.ok(/this is the notice sent to \$\{escHtml\(followed\.map\(\(n\) => "Dr\. " \+ n\)\.join\(" and "\)\)\}/.test(snSrc), "'the notice sent to Dr. X'");
  assert.ok(!/notice \$\{escHtml\(followed\.join\(" and "\)\)\} received/.test(snSrc), "never 'the notice X received'");
  assert.ok(/followed\.length\s*\?\s*`You receive this because you follow [^`]*ask the scheduler[^`]*`\s*:\s*`[^`]*under Settings in the app/.test(snSrc), "the follower's footer says to ask the scheduler; the surgeons' footer keeps 'Settings in the app'");
  assert.ok(!/never reaches a third person/.test(snSrc) && !/can never be addressed to a third person or broadcast\./.test(snSrc), "review F3: no comment still says trade mail never reaches a third person");
});
check("P20 F3 source pins - daily-reminder (reminder mode): after the surgeons' loop it reads the follower accounts (select=*) + every prefs row, plans followerReminderPlan(followers, onCall, now.hour, DEFAULT_REMINDER_HOUR), composes buildFollowerReminder with followerReminderLine, sends only when not dryRun, and answers `followers` { accounts, planned, sent, failed, skipped_wrong_hour, skipped_off, skipped_no_email, results, sample } - counts, tags and a sample line, never an address; a failed follower read is `followers.error`, the surgeons' reminders stand", () => {
  const h = drSrc.slice(drSrc.indexOf("serve(async (req) =>"));
  const iLoop = h.indexOf("for (const o of onCall) {"), iPlan = h.indexOf("followerReminderPlan(");
  assert.ok(iLoop > 0 && iPlan > iLoop, "followers after the surgeons' loop");
  assert.ok(h.includes("followerReminderPlan(followers, onCall, now.hour, DEFAULT_REMINDER_HOUR)"), "the follower's own hour, else the function default");
  assert.ok(h.includes('rest("user_profiles?select=*&role=in.(viewer,coordinator)")') && h.includes('rest("notification_preferences?select=*")'), "the follower accounts + every prefs row (a follower's row is keyed by profile_id)");
  assert.ok(!/rest[(]["`][^"`]*(follows|profile_id)/.test(drSrc), "no read names a revision-o column (a 400 before the apply)");
  const fb = h.slice(iPlan - 1200, h.indexOf("return json(200, {", iPlan));
  assert.ok(/followerReminderLine\(nameOf\(e\.surgeon\), e\.role, tomorrow, e\.otherLabel\)/.test(fb), "the third-party line");
  assert.ok(/if \(dryRun\) \{[^]*dry_run_composed/.test(fb), "dryRun composes and sends nothing");
  assert.ok(/sendEmail\(e\.email, subject, html, `follower=\$\{e\.follower\} surgeon=\$\{e\.surgeon\} role=\$\{e\.role\}`\)/.test(fb), "the log key is the tag + the followed id");
  assert.ok(/\} catch \(e\) \{[^]*console\.error\(`\[daily-reminder\] followers: /.test(fb), "a follower failure is logged, not thrown");
  const ret = h.slice(h.indexOf("return json(200, {", iPlan));
  assert.ok(/followers: followersOut/.test(ret.slice(0, 600)), "the reminder response carries followers");
  assert.ok(/accounts: followers\.length, planned: plan\.length/.test(fb) && /sample: /.test(fb), "counts + a sample");
  assert.ok(/function buildFollowerReminder\(/.test(drSrc), "the follower's frame");
  const fr = drSrc.slice(drSrc.indexOf("function buildFollowerReminder("), drSrc.indexOf("return { subject, html };", drSrc.indexOf("function buildFollowerReminder(")));
  assert.ok(fr.includes("const subject = `Call reminder - tomorrow (${opts.dayLabel}) Dr. ${opts.surgeonName} is Silvis ${opts.role.toUpperCase()}`;"), "review F3: the follower subject");
  assert.ok(fr.includes('${opts.name ? `Hi <strong>${escHtml(opts.name)}</strong>,` : "Hi,"}'), "review F3: the greeting falls back to 'Hi,'");
  assert.ok(/you receive this because you follow Dr\. \$\{escHtml\(opts\.surgeonName\)\}; to change the reminder hour or stop these reminders, ask the scheduler\./.test(fr), "review F3: the follower footer says to ask the scheduler");
  assert.ok(!/under Settings in the app/.test(fr), "review F3: a follower has no reminder switches in the app - the frame never points him there");
});
check("P20 F3: edge-functions/README.md - section 3 carries the pending Prompt 20 F3 deploy rows (send-notification and daily-reminder, next version, pending) with the proofs to observe; section 5 shows the daily-reminder dryRun `followers` object and the send-notification followers_* keys; the gate table says a follower never sends", () => {
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  const i = s3.indexOf("### Deploy record - Prompt 20 F3");
  assert.ok(i > 0, "the Prompt 20 F3 deploy record");
  const rec = s3.slice(i, s3.indexOf("\n### ", i + 10) > 0 ? s3.indexOf("\n### ", i + 10) : undefined);
  assert.ok(/\| `send-notification` \|[^\n]*-> next \(pending\)/.test(rec) && /\| `daily-reminder` \|[^\n]*-> next \(pending\)/.test(rec), "one pending row per function");
  assert.ok(/revision o/.test(rec) && /followers_added/.test(rec) && /"followers"/.test(rec), "the proofs: revision o first, followers_added, the dryRun followers object");
  const dr = readme.slice(readme.indexOf("### daily-reminder"), readme.indexOf("## 6."));
  assert.ok(/"followers":\{"accounts":/.test(dr), "section 5: the dryRun followers object");
  const sn = readme.slice(readme.indexOf("### send-notification"), readme.indexOf("### daily-reminder"));
  assert.ok(/followers_added/.test(sn), "section 5: send-notification's followers_* keys");
  const gateRow = readme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
  assert.ok(/follower/.test(gateRow), "the gate row: a follower (viewer / coordinator) only receives");
  // review F3
  assert.ok(/PRECONDITION[^\n]*follower[^\n]*(switch|prefs)/i.test(rec), "section 3: the deploy precondition - a follower can change or stop his mail (switches, or the scheduler's path to his profile_id row) before these go live");
  assert.ok(/schedule_published/.test(rec) && /schedule_published/.test(sn), "section 3 + 5: the publish mail reaches followers");
  assert.ok(/scheduler copy|scheduler-linked cop/.test(rec), "section 3: a follower of a scheduler-linked surgeon is not mailed the scheduler copies");
  const s6 = readme.slice(readme.indexOf("## 6."));
  assert.ok(/schedule_published/.test(s6.slice(0, s6.indexOf("\n## ", 5) > 0 ? s6.indexOf("\n## ", 5) : undefined)) || /Prompt 20 F3[^\n]*schedule_published/.test(readme), "section 6: the live note names the publish mail");
});

/* =====================================================================
   Prompt 20 F4 - the two end-to-end proofs through the '@followers' mirror block (with the '@sendGate' block for the
   send side). ONE follower account (a viewer, no roster link, follows s2 and s5 - the harness never names the real
   ones) and nobody else:
     daily-reminder dryRun  - the reminder-mode follower branch replayed over a week of schedule_days rows: tomorrow's
                              onCall is built the way the handler builds it (pinned below), then followerReminderPlan +
                              followerReminderLine; dryRun composes and sends nothing -> one reminder per followed surgeon
                              on call tomorrow, none on a day neither is on call, never an address in the answer
     send-notification      - sendGate -> tradePartyCheck -> followerUniverse -> followerRecipients for a trade: the
                              follower of s2 is added for a trade s2 is a party to (a give too), never for one he is not
   ===================================================================== */
const F4_FOLLOWER = { id: "f4a0b1c2-follower", role: "viewer", person_id: null, email: "follower@example.org", display_name: "Follower (harness)", follows: ["s2", "s5"] };
const F4_NAMES = { s1: "Khan", s2: "Burchett", s3: "Acton", s4: "Philip", s5: "Fierce", s6: "Sarkar" };
// the handler's own reminder-mode lines (daily-reminder/index.ts, serve -> reminder mode), replayed; the source pins in
// the check below keep the replay honest
function f4DryRunFollowers(day, profiles, prefRows, hour, tomorrow) {
  const DEFAULT_REMINDER_HOUR = 17;
  const nameOf = (id) => (id ? (F4_NAMES[id] || id) : "OPEN");
  const primaryLabel = day.primary_id ? nameOf(day.primary_id) : (day.external_cover ? `${day.external_cover} (external cover)` : "OPEN");
  const backupLabel = nameOf(day.backup_id);
  const onCall = [];
  if (day.primary_id) onCall.push({ person_id: String(day.primary_id), role: "primary", otherLabel: backupLabel });
  if (day.backup_id) onCall.push({ person_id: String(day.backup_id), role: "backup", otherLabel: primaryLabel });
  if (onCall.length === 0) return { on_call: 0, followers: undefined };   // the handler answers before the follower branch
  const followers = FOL.followerIndex(profiles, prefRows);
  const plan = FOL.followerReminderPlan(followers, onCall, hour, DEFAULT_REMINDER_HOUR);
  const results = [], lines = [];
  let wrongHour = 0, off = 0, noEmail = 0;
  let sample = null;
  const dayLabel = tomorrow;   // the handler's fmtDay(tomorrow); only the shape of the sample matters here
  for (const e of plan) {
    const line = FOL.followerReminderLine(nameOf(e.surgeon), e.role, tomorrow, e.otherLabel);
    const subject = `Call reminder - tomorrow (${dayLabel}) Dr. ${nameOf(e.surgeon)} is Silvis ${e.role.toUpperCase()}`;   // buildFollowerReminder's subject (pinned in the F3 check)
    if (!sample) sample = { subject, line };
    if (e.status === "skipped_wrong_hour") { wrongHour++; results.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status, user_hour: e.user_hour }); continue; }
    if (e.status === "skipped_off") { off++; results.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }
    if (e.status === "skipped_no_email") { noEmail++; results.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }
    lines.push(line);
    results.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: "dry_run_composed" });   // dryRun: composed, never sent
  }
  return { on_call: onCall.length, followers: { accounts: followers.length, planned: plan.length, sent: 0, failed: 0, skipped_wrong_hour: wrongHour, skipped_off: off, skipped_no_email: noEmail, results, sample }, lines };
}
check("P20 F4: daily-reminder dryRun fixture - ONE follower (viewer, follows s2 + s5) over a week of schedule_days rows: one reminder per followed surgeon on call tomorrow (both on the same day -> two, each worded for its surgeon), exactly one when only one is on, NONE on a day neither is on call (and none when nobody is), none at another hour or with his own switch off; dryRun sends nothing and the answer carries tags and counts, never an address", () => {
  if (!FOL) throw new Error("followers block did not load");
  const h = drSrc.slice(drSrc.indexOf("serve(async (req) =>"));
  // the replay's onCall / labels / early return / dryRun branch are the handler's own lines
  [
    'if (day.primary_id) onCall.push({ person_id: String(day.primary_id), role: "primary", otherLabel: backupLabel });',
    'if (day.backup_id) onCall.push({ person_id: String(day.backup_id), role: "backup", otherLabel: primaryLabel });',
    ': (day.external_cover ? `${day.external_cover} (external cover)` : "OPEN");',
    "const backupLabel = nameOf(day.backup_id);",
    "if (onCall.length === 0) {",
    'const nameOf = (id: string | null): string => (id ? (names[id] || id) : "OPEN");',
    "const line = followerReminderLine(nameOf(e.surgeon), e.role, tomorrow, e.otherLabel);",
    'if (dryRun) { fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: "dry_run_composed" }); continue; }',
  ].forEach((l) => assert.ok(h.includes(l), "the handler still reads: " + l));
  // review F4: the follower's own hour / switch / address gates are the handler's lines too, each ahead of dryRun and
  // of the real send - so a handler that mails an opted-out follower (or mails him every hour) fails here
  assert.ok(drSrc.includes("const DEFAULT_REMINDER_HOUR = 17;"), "the handler's default reminder hour is still 17 (the replay's)");
  const fLoop = h.slice(h.indexOf("const plan = followerReminderPlan("), h.indexOf("followersOut = {"));
  assert.ok(fLoop.length > 0 && fLoop.indexOf("for (const e of plan) {") > 0, "the follower loop is found");
  const iDry = fLoop.indexOf("if (dryRun) { fResults.push(");
  const iSend = fLoop.indexOf("await sendEmail(e.email, ");
  assert.ok(iDry > 0 && iSend > iDry, "the follower loop: dryRun answers before the real send");
  [
    "if (!sample) sample = { subject, line };",
    'if (e.status === "skipped_wrong_hour") { fWrongHour++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status, user_hour: e.user_hour }); continue; }',
    'if (e.status === "skipped_off") { fOff++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }',
    'if (e.status === "skipped_no_email") { fNoEmail++; fResults.push({ follower: e.follower, surgeon: e.surgeon, role: e.role, status: e.status }); continue; }',
  ].forEach((l) => {
    const i = fLoop.indexOf(l);
    assert.ok(i > 0, "the follower loop still reads: " + l);
    assert.ok(i < iDry && i < iSend, "before the dryRun branch and the real send: " + l);
  });
  assert.ok(h.indexOf("if (onCall.length === 0) {") < h.indexOf("followerReminderPlan("), "an empty day answers before the follower branch (no follower reminder)");
  const profiles = [F4_FOLLOWER];
  const WEEK = [
    { day: "2026-10-08", primary_id: "s2", backup_id: "s5", external_cover: null },   // both followed surgeons
    { day: "2026-10-09", primary_id: "s2", backup_id: "s3", external_cover: null },   // s2 only
    { day: "2026-10-10", primary_id: "s3", backup_id: "s4", external_cover: null },   // neither - an off day for him
    { day: "2026-10-11", primary_id: null, backup_id: "s5", external_cover: "Dr. Outside" },   // s5 behind an outside primary
    { day: "2026-10-12", primary_id: null, backup_id: null, external_cover: null },   // nobody
  ];
  const got = {};
  WEEK.forEach((row) => { got[row.day] = f4DryRunFollowers(row, profiles, [], 17, row.day); });
  const composed = (d) => (got[d].followers ? got[d].followers.results.filter((r) => r.status === "dry_run_composed").map((r) => r.surgeon + " " + r.role) : []);
  assert.deepStrictEqual(composed("2026-10-08"), ["s2 primary", "s5 backup"], "both followed surgeons on -> one reminder each");
  assert.deepStrictEqual(got["2026-10-08"].lines, [
    "Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Thu 10/8), backup Fierce",
    "Reminder: Dr. Fierce is on backup call at Silvis tomorrow (Thu 10/8), primary Burchett",
  ]);
  assert.deepStrictEqual(composed("2026-10-09"), ["s2 primary"], "only s2 on -> one reminder (the s3 backup is nobody he follows)");
  assert.deepStrictEqual(got["2026-10-09"].lines, ["Reminder: Dr. Burchett is on primary call at Silvis tomorrow (Fri 10/9), backup Acton"]);
  assert.deepStrictEqual(got["2026-10-10"].followers, { accounts: 1, planned: 0, sent: 0, failed: 0, skipped_wrong_hour: 0, skipped_off: 0, skipped_no_email: 0, results: [], sample: null }, "an off day for both followed surgeons -> no reminder (the account is counted, nothing planned)");
  assert.deepStrictEqual(got["2026-10-10"].lines, []);
  assert.deepStrictEqual(got["2026-10-11"].lines, ["Reminder: Dr. Fierce is on backup call at Silvis tomorrow (Sun 10/11), primary Dr. Outside (external cover)"], "s5 behind an outside primary -> one reminder, the outside cover named");
  assert.deepStrictEqual(got["2026-10-12"], { on_call: 0, followers: undefined }, "nobody on call -> the handler answers before any follower is read");
  const total = WEEK.reduce((n, row) => n + composed(row.day).length, 0);
  assert.strictEqual(total, 4, "the week: 2 + 1 + 0 + 1 + 0 reminders - one per followed surgeon-day, never one per day or per account");
  assert.ok(Object.values(got).every((g) => !g.followers || g.followers.sent === 0), "dryRun sends nothing");
  assert.deepStrictEqual(got["2026-10-08"].followers.sample, { subject: "Call reminder - tomorrow (2026-10-08) Dr. Burchett is Silvis PRIMARY", line: got["2026-10-08"].lines[0] }, "the answer's sample = the first planned reminder's subject + line (the handler's shape)");
  const wire = JSON.stringify(Object.values(got).map((g) => g.followers || null));
  assert.ok(!/@/.test(wire) && wire.indexOf(F4_FOLLOWER.id) < 0 && /"f4a0b1c2"/.test(wire), "the answer names the follower by his id8 tag only - no address, no full id: " + wire.slice(0, 160));
  // his own hour / his own switch (his prefs row is keyed by profile_id); the followed surgeon's prefs never decide
  const at18 = f4DryRunFollowers(WEEK[0], profiles, [], 18, WEEK[0].day);
  assert.deepStrictEqual(at18.followers.results.map((r) => r.status), ["skipped_wrong_hour", "skipped_wrong_hour"], "18:00 is not his hour (the default 17) -> nothing composed");
  const own20 = [{ person_id: null, profile_id: F4_FOLLOWER.id, shift_reminders_email: true, reminder_hour_central: 20 }];
  assert.strictEqual(f4DryRunFollowers(WEEK[1], profiles, own20, 20, WEEK[1].day).lines.length, 1, "his own 20:00 -> the s2 reminder at 20:00");
  const offRow = [{ person_id: null, profile_id: F4_FOLLOWER.id, shift_reminders_email: false }];
  assert.deepStrictEqual(f4DryRunFollowers(WEEK[0], profiles, offRow, 17, WEEK[0].day).followers.results.map((r) => r.status), ["skipped_off", "skipped_off"], "his own switch off -> no reminder");
  const s2Row = [{ person_id: "s2", profile_id: null, shift_reminders_email: false, reminder_hour_central: 6 }];
  assert.strictEqual(f4DryRunFollowers(WEEK[1], profiles, s2Row, 17, WEEK[1].day).lines.length, 1, "the followed surgeon's own prefs (off, 06:00) never decide the follower's reminder");
});
check("P20 F4: send-notification - ONE follower of s2 (and s5) is added for a trade s2 is a party to (proposed by s2, accepted by s3, applied by the scheduler, a Prompt 19 give riding trade_* with data.kind 'give') and NOT for a trade between s3 and s4; every send first passes the real sendGate + tradePartyCheck (targetIds never carry him); the follower himself never sends", () => {
  if (!FOL) throw new Error("followers block did not load");
  if (!sendGate || !tradePartyCheck) throw new Error("gate block did not load");
  const followers = FOL.followerIndex([F4_FOLLOWER], []);
  assert.strictEqual(followers.length, 1, "the one follower account");
  const send = (caller, type, targetIds, data, trade) => {
    const gate = sendGate(caller, type, targetIds, SCHED);
    assert.strictEqual(gate, null, type + " by " + JSON.stringify(caller) + " passes the gate: " + gate);
    assert.strictEqual(tradePartyCheck(trade, targetIds), null, type + ": targetIds are the row's two parties");
    const universe = FOL.followerUniverse(type, targetIds, caller, data, trade);
    return FOL.followerRecipients(followers, type, universe, "trade_updates_email");
  };
  const s2s3 = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  const s3s4 = { from_surgeon_id: "s3", to_surgeon_id: "s4" };
  const s2 = { role: "surgeon", personId: "s2" }, s3 = { role: "surgeon", personId: "s3" };
  const added = (r) => r.list.map((f) => f.tag + " via " + f.via.join("+"));
  assert.deepStrictEqual(added(send(s2, "trade_proposed", ["s2", "s3"], { trade_id: UUID }, s2s3)), ["f4a0b1c2 via s2"], "s2 proposes to s3 -> the follower of s2 is added, via s2 only");
  assert.deepStrictEqual(added(send(s3, "trade_accepted", ["s3", "s2"], { trade_id: UUID }, s2s3)), ["f4a0b1c2 via s2"], "s3 accepts s2's trade -> still added (s2 is a party)");
  assert.deepStrictEqual(added(send(sched, "trade_applied", ["s2", "s3"], { trade_id: UUID }, s2s3)), ["f4a0b1c2 via s2"], "the scheduler applies it -> added");
  assert.deepStrictEqual(added(send(s2, "trade_proposed", ["s2", "s3"], { trade_id: UUID, kind: "give" }, s2s3)), ["f4a0b1c2 via s2"], "a give (data.kind 'give' on trade_*) -> added the same way");
  assert.deepStrictEqual(send(s3, "trade_proposed", ["s3", "s4"], { trade_id: UUID }, s3s4), { list: [], skipped: [] }, "s3 <-> s4 -> the follower of s2 / s5 is not added (not even as a skipped entry)");
  assert.deepStrictEqual(send(sched, "trade_applied", ["s3", "s4"], { trade_id: UUID }, s3s4), { list: [], skipped: [] }, "... nor when the scheduler applies it");
  const optedOut = FOL.followerIndex([F4_FOLLOWER], [{ person_id: null, profile_id: F4_FOLLOWER.id, trade_updates_email: false }]);
  const r1 = FOL.followerRecipients(optedOut, "trade_proposed", FOL.followerUniverse("trade_proposed", ["s2", "s3"], s2, {}, s2s3), "trade_updates_email");
  assert.deepStrictEqual(r1, { list: [], skipped: [{ follower: "f4a0b1c2", via: ["s2"], status: "skipped_pref_off" }] }, "his own trade flag off -> reported, never mailed");
  assert.ok(/role viewer may not send notifications/.test(sendGate({ role: "viewer", personId: null }, "trade_proposed", ["s2", "s3"], SCHED) || ""), "and the follower himself never sends (viewer -> refused)");
});

/* =====================================================================
   Prompt 20 R1 (rebase onto Prompt 19, 9/25) - send-notification's merged trade path: Prompt 19's v7 party gate
   (trade_applied may carry scheduler-linked ids: tradeNamesOthers -> tradeExtraIds -> tradePartyCheck's third and fourth
   arguments) AND Followers F3 (followers of the row's two parties added after every gate) in ONE handler. r1TradeSend
   replays the handler's lines in the handler's order through the real '@sendGate' and '@followers' blocks; the source
   pins below keep the replay honest (a merge that kept only one side's lines fails here).
   ===================================================================== */
const R1_SCHED_FOLLOWER = { id: "f5b0c1d2-follower", role: "coordinator", person_id: null, email: "follower2@example.org", display_name: null, follows: ["s1"] };
function r1Gate() {
  return new Function(gateBlock() + "\nreturn { sendGate, tradePartyCheck, tradeExtraIds: typeof tradeExtraIds === 'function' ? tradeExtraIds : null, tradeNamesOthers: typeof tradeNamesOthers === 'function' ? tradeNamesOthers : null };")();
}
// status 403 = the handler answers before any mail; 200 = the follower list the handler would mail
function r1TradeSend(G, caller, type, targetIds, data, trade, schedulerIdsLive, followers) {
  const privileged = caller.role === "admin" || caller.role === "scheduler";
  const schedulerIds = privileged ? [] : schedulerIdsLive;
  const gateDenied = G.sendGate(caller, type, targetIds, schedulerIds);
  if (gateDenied) return { status: 403, error: gateDenied };
  let tradeRow = null;
  if (type.indexOf("trade_") === 0) {
    const extraIds = type === "trade_applied" && G.tradeNamesOthers(trade, targetIds) ? G.tradeExtraIds(type, privileged ? schedulerIdsLive : schedulerIds) : [];
    const partyDenied = G.tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId);
    if (partyDenied) return { status: 403, error: partyDenied };
    tradeRow = trade;
  }
  const fUniverse = FOL.followerUniverse(type, targetIds, caller, data, tradeRow);
  const r = FOL.followerRecipients(followers, type, fUniverse, "trade_updates_email");
  return { status: 200, followers: r.list.map((f) => f.tag + " via " + f.via.join("+")), skipped: r.skipped };
}
check("P20 R1: send-notification's merged trade path - the handler still runs Prompt 19's party gate (sendGate -> tradeNamesOthers / tradeExtraIds -> tradePartyCheck(trade, targetIds, extraIds, sender)) and only THEN keeps the trade row for followerUniverse; the follower step reads that row, after the surgeons' loop", () => {
  const h = snSrc.slice(snSrc.indexOf("serve(async (req) =>"));
  const order = [
    "const schedulerIds = privileged ? [] : await loadSchedulerIds();",
    "const gateDenied = sendGate(caller, type, targetIds, schedulerIds);",
    "let tradeRow: any = null;",
    'const extraIds = type === "trade_applied" && tradeNamesOthers(trade, targetIds) ? tradeExtraIds(type, privileged ? await loadSchedulerIds() : schedulerIds) : [];',
    "const partyDenied = tradePartyCheck(trade, targetIds, extraIds, privileged ? null : caller.personId);",
    "tradeRow = trade;",
    "for (const r of list) {",
    "const fUniverse = followerUniverse(type, targetIds, caller, data, tradeRow);",
    "followerRecipients(followers, type, fUniverse, cat.pref)",
  ];
  let at = -1;
  order.forEach((l) => { const i = h.indexOf(l); assert.ok(i > 0, "the handler reads: " + l); assert.ok(i > at, "in order: " + l); at = i; });
  assert.strictEqual(h.split("tradePartyCheck(").length - 1, 1, "one party check in the handler (no second, narrower copy)");
  assert.ok(!/targetIds\s*=\s*[^;]*follower/i.test(h) && !/targetIds\.push\(/.test(h), "no follower is ever written into targetIds");
});
check("P20 R1 (a): a give's trade_applied to [from, to, scheduler] from a party (or the scheduler) passes the v7 gate AND adds the follower of from / to - via the party only - while the follower of the scheduler's roster id is not added (the scheduler copy is never a party)", () => {
  if (!FOL) throw new Error("followers block did not load");
  const G = r1Gate();
  assert.strictEqual(typeof G.tradeExtraIds, "function", "the merged gate block keeps tradeExtraIds (Prompt 19 S3)");
  assert.strictEqual(typeof G.tradeNamesOthers, "function", "the merged gate block keeps tradeNamesOthers (Prompt 19 S3)");
  const followers = FOL.followerIndex([F4_FOLLOWER, R1_SCHED_FOLLOWER], []);
  assert.strictEqual(followers.length, 2, "two follower accounts (one of s2 / s5, one of s1)");
  const give = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  const data = { trade_id: UUID, kind: "give", message: "probe" };
  const s2 = { role: "surgeon", personId: "s2" }, s3 = { role: "surgeon", personId: "s3" };
  [[s3, "the receiver (accepts and applies)"], [s2, "the giver"], [sched, "the scheduler"], [admin, "an admin"]].forEach(([who, label]) => {
    const r = r1TradeSend(G, who, "trade_applied", ["s2", "s3", "s1"], data, give, SCHED, followers);
    assert.strictEqual(r.status, 200, label + ": [from, to, scheduler] passes - " + r.error);
    assert.deepStrictEqual(r.followers, ["f4a0b1c2 via s2"], label + ": the follower of the giver is added via s2 only; the follower of s1 (the scheduler copy) is not");
  });
  const toS5 = r1TradeSend(G, s2, "trade_applied", ["s2", "s5", "s1"], data, { from_surgeon_id: "s2", to_surgeon_id: "s5" }, SCHED, followers);
  assert.deepStrictEqual(toS5.followers, ["f4a0b1c2 via s2+s5"], "a give between two surgeons he follows -> ONE e-mail, via both");
  const toS4 = r1TradeSend(G, s3, "trade_applied", ["s3", "s4", "s1"], data, { from_surgeon_id: "s3", to_surgeon_id: "s4" }, SCHED, followers);
  assert.strictEqual(toS4.status, 200, "a give between s3 and s4 still mails [from, to, scheduler]");
  assert.deepStrictEqual(toS4.followers, [], "... and adds no follower (neither party is followed; s1's follower is not reached through the copy)");
  const third = r1TradeSend(G, { role: "surgeon", personId: "s4" }, "trade_applied", ["s2", "s3", "s1"], data, give, SCHED, followers);
  assert.strictEqual(third.status, 403, "a third surgeon sending the give's trade_applied is still refused");
  const thirdAsTarget = r1TradeSend(G, sched, "trade_applied", ["s2", "s3", "s4"], data, give, SCHED, followers);
  assert.strictEqual(thirdAsTarget.status, 403, "a non-scheduler third id beside the parties is still refused (even from the scheduler)");
});
check("P20 R1 (b): a follower id placed in targetIds never satisfies the party check - not in place of a party, not beside the two parties (trade_applied's extra slot takes scheduler-linked ids only), not from the scheduler; and a follower caller is refused before any trade row is read", () => {
  if (!FOL) throw new Error("followers block did not load");
  const G = r1Gate();
  const followers = FOL.followerIndex([F4_FOLLOWER], []);
  const row = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  const fid = F4_FOLLOWER.id;
  assert.strictEqual(typeof G.tradeExtraIds, "function", "the merged gate block keeps tradeExtraIds (Prompt 19 S3)");
  const s2 = { role: "surgeon", personId: "s2" };
  ["trade_proposed", "trade_accepted", "trade_declined", "trade_applied"].forEach((t) => {
    [[s2, "the giver"], [sched, "the scheduler"]].forEach(([who, label]) => {
      [["s2", fid], [fid, "s3"], ["s2", "s3", fid], ["s2", "s3", "s1", fid]].forEach((ids) => {
        const r = r1TradeSend(G, who, t, ids, { trade_id: UUID }, row, SCHED, followers);
        assert.strictEqual(r.status, 403, t + " by " + label + " to " + JSON.stringify(ids) + " must be refused (the follower is not a party)");
      });
    });
    assert.strictEqual(typeof G.tradePartyCheck(row, ["s2", fid], G.tradeExtraIds(t, SCHED), null), "string", t + ": the follower in the receiver's place is not a party");
    assert.strictEqual(typeof G.tradePartyCheck(row, ["s2", "s3", fid], G.tradeExtraIds(t, SCHED), null), "string", t + ": beside the parties he is not an extra id");
    const asCaller = r1TradeSend(G, { role: "viewer", personId: null }, t, ["s2", "s3"], { trade_id: UUID }, row, SCHED, followers);
    assert.strictEqual(asCaller.status, 403, t + ": a follower (viewer) caller is refused by sendGate");
    const asCoord = r1TradeSend(G, { role: "coordinator", personId: null }, t, ["s2", "s3"], { trade_id: UUID }, row, SCHED, followers);
    assert.strictEqual(asCoord.status, 403, t + ": a follower (coordinator) caller is refused by sendGate");
  });
  // with the follower outside targetIds the same send passes and he is ADDED - as a recipient, not a party
  const ok2 = r1TradeSend(G, s2, "trade_proposed", ["s2", "s3"], { trade_id: UUID }, row, SCHED, followers);
  assert.strictEqual(ok2.status, 200);
  assert.deepStrictEqual(ok2.followers, ["f4a0b1c2 via s2"]);
});
check("P20 R1 (c): the scheduler extra ids ride ONLY on trade_applied - tradeExtraIds is [] for every other category, and trade_proposed / trade_accepted / trade_declined to [from, to, scheduler] stay refused for a party and for the scheduler (no follower added: the send is refused before the follower step)", () => {
  if (!FOL) throw new Error("followers block did not load");
  const G = r1Gate();
  assert.strictEqual(typeof G.tradeExtraIds, "function", "the merged gate block keeps tradeExtraIds (Prompt 19 S3)");
  const followers = FOL.followerIndex([F4_FOLLOWER, R1_SCHED_FOLLOWER], []);
  const row = { from_surgeon_id: "s2", to_surgeon_id: "s3" };
  const types = Array.from(new Set((snSrc.match(/^\s{2}([a-z_]+):\s+\{ pref:/gm) || []).map((l) => l.trim().split(":")[0])));
  assert.ok(types.length >= 12 && types.includes("trade_applied") && types.includes("schedule_published"), "the CATEGORIES keys are read from the source: " + types.join(","));
  types.forEach((t) => { if (t !== "trade_applied") assert.deepStrictEqual(G.tradeExtraIds(t, SCHED), [], t + ": no extra ids"); });
  assert.deepStrictEqual(G.tradeExtraIds("trade_applied", SCHED), ["s1"], "trade_applied: the scheduler-linked ids");
  const s2 = { role: "surgeon", personId: "s2" }, s3 = { role: "surgeon", personId: "s3" };
  ["trade_proposed", "trade_accepted", "trade_declined"].forEach((t) => {
    [[s2, "the giver"], [s3, "the receiver"], [sched, "the scheduler"], [admin, "an admin"]].forEach(([who, label]) => {
      const r = r1TradeSend(G, who, t, ["s2", "s3", "s1"], { trade_id: UUID, kind: "give" }, row, SCHED, followers);
      assert.strictEqual(r.status, 403, t + " by " + label + " to [from, to, scheduler] must be refused");
      assert.strictEqual(r.followers, undefined, t + " by " + label + ": refused before any follower is added");
      const plain = r1TradeSend(G, who, t, ["s2", "s3"], { trade_id: UUID, kind: "give" }, row, SCHED, followers);
      assert.strictEqual(plain.status, 200, t + " by " + label + " to exactly the two parties passes - " + plain.error);
      assert.deepStrictEqual(plain.followers, ["f4a0b1c2 via s2"], t + " by " + label + ": the follower of s2 is added, s1's is not");
    });
  });
});

check("P20 R1: edge-functions/README.md section 3 - the Prompt 19 v7 record stays as deployed (2026-09-25 05:36:23 UTC, v6 -> v7) and the Followers record is a PENDING v8 on base v7 (daily-reminder v5 -> v6), with Faraz's 9/25 decisions (publish mail yes, the self-insert pin kept, follows cleared on a role change) and the one rollout", () => {
  const s3 = readme.slice(readme.indexOf("## 3."), readme.indexOf("## 4."));
  const i19 = s3.indexOf("### Deploy record - Prompt 19 S3"), i20 = s3.indexOf("### Deploy record - Prompt 20 F3");
  assert.ok(i19 > 0 && i20 > i19, "both records, Prompt 19 first");
  const rec19 = s3.slice(i19, i20), rec20 = s3.slice(i20, s3.indexOf("\n### ", i20 + 10));
  assert.ok(/\| 2026-09-25 05:36:23 \| `send-notification` \| v6 -> v7 \(deployed 2026-09-25 05:36:23 UTC/.test(rec19), "the v7 deploy row, as recorded");
  assert.ok(/\| \(pending\) \| `send-notification` \| v7 \(Prompt 19, live\) -> next \(pending\): v8 \|/.test(rec20), "send-notification: base v7, next v8");
  assert.ok(!/current \(v6/.test(rec20), "no v6 base left");
  assert.ok(/\| \(pending\) \| `daily-reminder` \| v5 -> next \(pending\): v6 \|/.test(rec20), "daily-reminder v5 -> v6");
  assert.ok(/followers_added` names only followers of `<from>` \/ `<to>`/.test(rec20), "the v8 proof keeps the give's trade_applied path");
  const dec = rec20.slice(rec20.indexOf("Decisions (Faraz 9/25)"));
  assert.ok(rec20.indexOf("Decisions (Faraz 9/25)") > 0, "the decisions paragraph");
  assert.ok(/publish e-mail/.test(dec) && /`user_profiles_self_insert` `follows = '\[\]'`/.test(dec) && /keeps clearing `follows`/.test(dec) && /ONE rollout/.test(dec), "publish mail, the pin, the role-change clear, one rollout");
  const gateRow = readme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
  assert.ok(/Prompt 19 S3 \(v7, deployed 2026-09-25 05:36 UTC\)/.test(gateRow) && /A follower \(Prompt 20 F3, v8 PENDING/.test(gateRow), "the gate row carries both, v7 deployed and the follower sentence pending");
  assert.ok(!/decision needed/i.test(readme), "no 'decision needed' left");
});

(async () => {
  for (const [name, fn] of ASYNC) {
    try { await fn(); passed++; console.log("ok   " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n     " + (e && e.message || e)); }
  }
  console.log("edge-functions.test.js: " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();
