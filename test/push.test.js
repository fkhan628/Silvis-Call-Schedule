#!/usr/bin/env node
/*
 * Silvis Call Schedule - phone push (Prompt 30, Faraz 10/2: "Davenport's look, Silvis's own push") - the client lane.
 *
 *   [P]  helpers.js push pieces: PUSH_TABS (one literal in helpers.js, sw.js, the contract - and the edge function's
 *        @pushPlan block once it is present), the deep link, the sw message, the card's states and words (the per-origin
 *        Blocked line), the device label, the endpoint whitelist, base64url, the RPC / test / Diagnose words,
 *        notifPrefSaveRequest with and without opts.push
 *   [SW] sw.js in a vm sandbox with a fake `self`: every push shows a notification (good / bad / empty / non-JSON data,
 *        a rejected showNotification), notificationclick focuses an open app window + postMessage or opens a scope-relative
 *        ./?tab= URL - never a URL from the payload; no fetch handler, no cache
 *   [C]  config.js + helpers.js in a sandbox against fake service workers (a root OneSignal registration present, a `ready`
 *        that resolves to it), PushManager, Notification, localStorage and fetch: pushDb's answers, registration(),
 *        enable (permission FIRST; the save body's four keys; the flag; a refused save unsubscribes, no flag), rearm (never
 *        a prompt; the three-condition path; same hash -> no network; other hash -> save; a foreign subscription), disable,
 *        reset (only the Silvis worker), teardown (the delete before the unsubscribe, capped), dropForeign, state, diagnose
 *   [I]  index-source.html: the head script's keep rule (lifted and run), handleSignOut / signOutForLink /
 *        signOutAfterPasswordUpdate lifted and run (teardown before auth.signOut), Periods Remind by channel (remindOffers and
 *        the row's disabled expression run - review 10/3), the tap-over-a-dirty-day-draft guard (onMsg + pushTapKeepsDraft
 *        run), source pins on the effects, the card and the manual_edit day
 *   [M]  mutants (contract section 5): each applies one text change to a copy of the source and the named check must FAIL
 *
 * Fakes only: the VAPID-style keys are generated here (P-256), endpoints are short fake tokens. No network.
 * Run: node test/push.test.js   (exit code 1 on any failure)
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const SRC = { sw: read("sw.js"), config: read("config.js"), helpers: read("helpers.js"), index: read("index-source.html") };
const EDGE_PATH = "edge-functions/send-notification/index.ts";
const EDGE = fs.existsSync(path.join(ROOT, EDGE_PATH)) ? read(EDGE_PATH) : "";
// The contract's whitelist (push-design.md 2.4 / 3.1 / 3.2) - restated here on purpose
const CONTRACT_TABS = ["calendar", "openshifts", "myschedule", "timeoff", "settings", "setup"];

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(SRC); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     -> " + (e && e.message ? e.message : e)); }
}
// mutant(name, file, from, to, fn): `from` must be in the file; with it replaced by `to`, fn(mutatedSources) must THROW
async function mutant(name, file, from, to, fn) {
  await check("MUTANT " + name + " - caught", async () => {
    const orig = SRC[file];
    assert.ok(orig.includes(from), "the mutant's anchor is no longer in " + file + ": " + from.slice(0, 90));
    const mutated = Object.assign({}, SRC, { [file]: orig.split(from).join(to) });
    let threw = null;
    try { await fn(mutated); } catch (e) { threw = e; }
    assert.ok(threw, "the check still passes with the mutant applied - it does not bind");
    if (process.env.PUSH_TEST_VERBOSE) console.log("     (the mutant made it fail with: " + String(threw && threw.message || threw).split("\n")[0].slice(0, 160) + ")");
  });
}
const quiet = { log() {}, warn() {}, error() {}, info() {} };
const plain = (x) => JSON.parse(JSON.stringify(x));

// helpers.js from a source text (so a mutant of helpers.js is what runs)
function loadHelpers(src) {
  const sb = { module: { exports: {} }, console: quiet, URL, URLSearchParams };
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: "helpers.js" });
  // answers come back as plain main-realm values (deepStrictEqual compares prototypes across vm realms)
  const out = {};
  Object.entries(sb.module.exports).forEach(([k, v]) => {
    if (typeof v === "function") out[k] = k === "pushB64uDecode" ? v : (...a) => { const r = v(...a); return r && typeof r === "object" ? plain(r) : r; };
    else out[k] = v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object RegExp]" ? plain(v) : v;
  });
  return out;
}

/* ================================ fixtures ================================ */
const LIVE = "https://fkhan628.github.io/";
const SIL = LIVE + "Silvis-Call-Schedule/";
const EP1 = "https://fcm.googleapis.com/fcm/send/test-device-1";
const EP2 = "https://fcm.googleapis.com/fcm/send/test-device-2";
const UID = "00000000-0000-4000-8000-0000000000a1", UID2 = "00000000-0000-4000-8000-0000000000a2";
const P256DH = new Uint8Array(65); P256DH[0] = 4; for (let i = 1; i < 65; i++) P256DH[i] = (i * 7) & 255;
const AUTHB = new Uint8Array(16); for (let i = 0; i < 16; i++) AUTHB[i] = (i * 13 + 5) & 255;
const b64u = (u8) => Buffer.from(u8).toString("base64url");
let KEY = "", KEY2 = "";
const UA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const fakeJwt = (sub) => [{ alg: "HS256", typ: "JWT" }, { sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }].map(o => Buffer.from(JSON.stringify(o)).toString("base64url")).join(".") + ".c2ln";
const sha16 = async (s) => Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex").slice(0, 16);

function mkStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    _m: m,
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] === undefined ? null : Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

// One fake browser: service worker container, PushManager per registration, Notification, the network.
// o: { ua, standalone, permission, answer (requestPermission's answer), regs: [[scope, slots]], silvisSub (endpoint or null),
//      lsInit, neverActive, saved (status RPC), answers: (path, method, body) => { status, body } | undefined,
//      endpoint (what subscribe hands out), invalidStateOnce, subscribeThrows, removeHangs }
function mkBrowser(o) {
  o = o || {};
  const log = [];
  const calls = [];
  const ls = mkStorage(Object.assign({ "silvis-auth-token": fakeJwt(UID) }, o.lsInit || {}));
  const sw = { regs: [], readyTouched: 0, getRegistrationTouched: 0 };
  const mkSub = (pm, endpoint, ask) => ({
    endpoint,
    options: { userVisibleOnly: true, applicationServerKey: ask ? ask.buffer.slice(ask.byteOffset, ask.byteOffset + ask.byteLength) : null },
    getKey: (n) => (n === "p256dh" ? P256DH.buffer.slice(0) : n === "auth" ? AUTHB.buffer.slice(0) : null),
    unsubscribe: async () => { log.push("unsubscribe " + endpoint.slice(-8)); if (pm.sub && pm.sub.endpoint === endpoint) pm.sub = null; return true; },
  });
  const mkPM = (scope) => {
    const pm = { sub: null, scope, subscribeCalls: [] };
    pm.subscribe = async (opts) => {
      log.push("subscribe");
      pm.subscribeCalls.push(opts);
      if (o.subscribeThrows) throw Object.assign(new Error("push service not available (fake)"), { name: "AbortError" });
      if (o.invalidStateOnce && pm.sub) { o.invalidStateOnce = false; throw Object.assign(new Error("a subscription with a different key exists (fake)"), { name: "InvalidStateError" }); }
      if (!pm.sub) pm.sub = mkSub(pm, o.endpoint || EP1, opts.applicationServerKey);
      return pm.sub;
    };
    pm.getSubscription = async () => pm.sub;
    return pm;
  };
  const mkReg = (scope, slots) => {
    const r = {
      scope,
      active: slots.active ? { scriptURL: slots.active } : null,
      waiting: slots.waiting ? { scriptURL: slots.waiting } : null,
      installing: slots.installing ? { scriptURL: slots.installing } : null,
      pushManager: mkPM(scope),
      unregister: async () => { log.push("unregister " + scope.replace(LIVE, "/")); sw.regs = sw.regs.filter(x => x !== r); return true; },
    };
    return r;
  };
  const root = mkReg(LIVE, { active: LIVE + "OneSignalSDKWorker.js" });
  root.pushManager.sub = mkSub(root.pushManager, "https://fcm.googleapis.com/fcm/send/davenport-dev", null);
  sw.regs.push(root);
  (o.regs || []).forEach(([scope, slots]) => sw.regs.push(mkReg(scope, slots)));
  if (o.silvisReg !== false && o.silvisSub !== undefined) {
    const r = mkReg(SIL, { active: SIL + "sw.js" });
    if (o.silvisSub) r.pushManager.sub = mkSub(r.pushManager, o.silvisSub, o.silvisSubKey ? Buffer.from(o.silvisSubKey, "base64url") : null);
    sw.regs.push(r);
  }
  sw.getRegistrations = async () => { log.push("getRegistrations"); return sw.regs.slice(); };
  sw.register = async (script, opts) => {
    log.push("register " + script.replace(LIVE, "/") + " " + JSON.stringify(opts));
    let r = sw.regs.find(x => x.scope === opts.scope);
    if (!r) { r = mkReg(opts.scope, o.neverActive ? { installing: script } : { active: script }); sw.regs.push(r); }
    return r;
  };
  Object.defineProperty(sw, "ready", { get() { sw.readyTouched++; return Promise.resolve(root); } });
  sw.getRegistration = async () => { sw.getRegistrationTouched++; return root; };
  const N = {
    permission: o.permission || "default",
    requests: 0,
    requestPermission: async () => { N.requests++; log.push("requestPermission"); if (o.answer) N.permission = o.answer; return N.permission; },
  };
  const nav = { userAgent: o.ua || UA_WIN, maxTouchPoints: o.ua === UA_IPHONE ? 5 : 0, standalone: o.standalone === true ? true : undefined, serviceWorker: o.noSW ? undefined : sw };
  const loc = { href: SIL + (o.search || ""), hostname: "fkhan628.github.io" };
  const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body), text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const net = async (url, init) => {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? init.body : null;
    const hdr = (init && init.headers) || {};
    calls.push({ path: u.pathname + u.search, method, body, auth: hdr.Authorization || hdr.authorization || null, cache: init && init.cache });
    log.push("fetch " + method + " " + u.pathname.replace(/^\/(rest|functions)\/v1\//, "") + u.search);
    const custom = o.answers ? o.answers(u.pathname + u.search, method, body) : undefined;
    if (custom && custom.hang) return new Promise(() => {});
    if (custom) return respond(custom.status, custom.body);
    if (u.pathname.endsWith("/functions/v1/send-notification") && u.search === "?vapid=public") return respond(200, { publicKey: KEY });
    if (u.pathname.endsWith("/functions/v1/send-notification") && u.search === "?push=test") return respond(200, { push: { sent: 1, failed: 0, removed: 0, skipped_no_device: 0, skipped_pref_off: 0, devices: { sent: 1, failed: 0, removed: 0 }, error: null } });
    if (u.pathname.endsWith("/rpc/save_push_subscription")) return respond(200, { ok: true, action: "added", devices: 1, audit: true });
    if (u.pathname.endsWith("/rpc/delete_push_subscription")) { if (o.removeHangs) return new Promise(() => {}); return respond(200, { ok: true, removed: 1, devices: 0, audit: true }); }
    if (u.pathname.endsWith("/rpc/push_subscription_status")) return respond(200, { ok: true, saved: o.saved !== false, devices: 1 });
    if (u.pathname.endsWith("/rest/v1/notification_preferences")) return respond(201, []);
    return respond(404, { message: "not mocked: " + u.pathname });
  };
  return { o, log, calls, ls, sw, root, N, nav, loc, net, PM: function PushManager() {} };
}

// config.js + helpers.js (from source texts) wired to one fake browser
function loadClient(srcs, b) {
  const sb = {
    console: quiet,
    atob: (s) => Buffer.from(s, "base64").toString("binary"), btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    localStorage: b.ls, navigator: b.nav, location: b.loc,
    URL, URLSearchParams, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout,
    fetch: (url, init) => b.net(url, init),
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(srcs.config, sb, { filename: "config.js" });
  vm.runInContext(srcs.helpers, sb, { filename: "helpers.js" });
  const api = vm.runInContext("({ pushDb, pushDevice, notifPrefsDb, jwtClaims, auth })", sb);
  api.pushDevice.env = () => ({ nav: b.nav, N: b.N, PM: b.PM, ls: b.ls, loc: b.loc, mm: (q) => ({ matches: false, media: q }), subtle: webcrypto.subtle, base: SIL, sleep: async () => {}, activeWaitMs: 300 });
  return api;
}
const silvisReg = (b) => b.sw.regs.find(r => r.scope === SIL) || null;
const fetches = (b, re) => b.calls.filter(c => re.test(c.path));

(async () => {
  // fake VAPID-style public keys, generated here (65-byte uncompressed P-256 points)
  const mkKey = async () => { const k = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]); return b64u(new Uint8Array(await webcrypto.subtle.exportKey("raw", k.publicKey))); };
  KEY = await mkKey(); KEY2 = await mkKey();

  /* ================================ [P] helpers ================================ */
  console.log("\n[P] helpers.js - the pure push pieces");
  const tabsOf = (text, label) => { const m = /const PUSH_TABS = (\[[^\]]*\]);/.exec(text); assert.ok(m, "no `const PUSH_TABS = [...]` literal in " + label); return JSON.parse(m[1]); };
  await check("PUSH_TABS: the SAME literal in helpers.js, sw.js and the contract (calendar, openshifts, myschedule, timeoff, settings, setup)" + (EDGE.includes("@pushPlan-start") ? " and the edge @pushPlan block" : " (the edge @pushPlan block is not on this branch yet - compared when present)"), (S) => {
    assert.deepStrictEqual(tabsOf(S.helpers, "helpers.js"), CONTRACT_TABS);
    assert.deepStrictEqual(tabsOf(S.sw, "sw.js"), CONTRACT_TABS);
    assert.deepStrictEqual(loadHelpers(S.helpers).PUSH_TABS, CONTRACT_TABS);
    if (EDGE.includes("@pushPlan-start")) assert.deepStrictEqual(tabsOf(EDGE.slice(EDGE.indexOf("@pushPlan-start")), EDGE_PATH), CONTRACT_TABS);
  });
  const deepLinkCheck = (S) => {
    const H = loadHelpers(S.helpers);
    const T = [
      ["?tab=timeoff&_v=x", { tab: "timeoff", day: null, search: "?_v=x", strip: true }],
      ["?tab=calendar&day=2026-10-15", { tab: "calendar", day: "2026-10-15", search: "", strip: true }],
      ["?_v=2026.10.02c-1&tab=calendar&day=2026-10-15&x=1", { tab: "calendar", day: "2026-10-15", search: "?_v=2026.10.02c-1&x=1", strip: true }],
      ["?tab=timeoff&day=2026-10-15", { tab: "timeoff", day: null, search: "", strip: true }],
      ["?tab=calendar&day=15/10/2026", { tab: "calendar", day: null, search: "", strip: true }],
      ["?tab=evil", { tab: null, day: null, search: "", strip: true }],
      ["?tab=https://evil.example&_v=y", { tab: null, day: null, search: "?_v=y", strip: true }],
      ["?tab=totals", { tab: null, day: null, search: "", strip: true }],
      ["?day=2026-10-15", { tab: null, day: null, search: "", strip: true }],
      ["?_v=x", { tab: null, day: null, search: "?_v=x", strip: false }],
      ["", { tab: null, day: null, search: "", strip: false }],
    ];
    T.forEach(([q, want]) => assert.deepStrictEqual(JSON.parse(JSON.stringify(H.pushDeepLink(q))), want, "pushDeepLink(" + JSON.stringify(q) + ")"));
    CONTRACT_TABS.forEach(t => assert.strictEqual(H.pushDeepLink("?tab=" + t).tab, t));
  };
  await check("pushDeepLink: tab only from the whitelist, day only ISO and only with calendar, the other keys (_v) kept in order, strip whenever tab / day was present", deepLinkCheck);
  await check("pushOpenMessage: only { type: silvis-push-open } with a whitelisted tab; day only ISO with calendar", (S) => {
    const H = loadHelpers(S.helpers);
    assert.deepStrictEqual(H.pushOpenMessage({ type: "silvis-push-open", tab: "openshifts", day: null }), { tab: "openshifts", day: null });
    assert.deepStrictEqual(H.pushOpenMessage({ type: "silvis-push-open", tab: "calendar", day: "2026-10-15" }), { tab: "calendar", day: "2026-10-15" });
    assert.deepStrictEqual(H.pushOpenMessage({ type: "silvis-push-open", tab: "timeoff", day: "2026-10-15" }), { tab: "timeoff", day: null });
    [null, "x", {}, { type: "other", tab: "calendar" }, { type: "silvis-push-open", tab: "evil" }, { type: "silvis-push-open" }, { type: "silvis-push-open", tab: "calendar", url: "https://evil.example" }].forEach((m, i) => {
      const r = H.pushOpenMessage(m);
      if (i === 6) assert.deepStrictEqual(r, { tab: "calendar", day: null }, "a url key is ignored");
      else assert.strictEqual(r, null, JSON.stringify(m));
    });
  });
  // review 10/3: a REAL calendar day only (the edge's pushIsoDay round trip) - an impossible date opens nothing
  const realDayCheck = (S) => {
    const H = loadHelpers(S.helpers);
    ["2026-02-31", "2026-13-45", "2026-00-10", "2026-04-31", "2027-02-29", "0050-01-01"].forEach(d => {
      assert.strictEqual(H.pushDeepLink("?tab=calendar&day=" + d).day, null, "pushDeepLink drops the impossible day " + d);
      assert.strictEqual(H.pushDeepLink("?tab=calendar&day=" + d).strip, true, "... and still strips it from the URL");
      assert.deepStrictEqual(H.pushOpenMessage({ type: "silvis-push-open", tab: "calendar", day: d }), { tab: "calendar", day: null }, "pushOpenMessage drops the impossible day " + d);
    });
    ["2028-02-29", "2026-12-31", "2027-01-01", "2026-10-15"].forEach(d => {
      assert.strictEqual(H.pushDeepLink("?tab=calendar&day=" + d).day, d, "a real day " + d + " opens");
      assert.deepStrictEqual(H.pushOpenMessage({ type: "silvis-push-open", tab: "calendar", day: d }), { tab: "calendar", day: d });
    });
  };
  await check("pushDeepLink / pushOpenMessage: the day must be a REAL calendar day (2026-02-31, 2026-13-45, 2027-02-29 dropped; 2028-02-29 kept) - review 10/3", realDayCheck);
  // review 10/3: a tap on an open window must not silently drop the day editor's unsaved draft
  const tapDraftCheck = (S) => {
    const H = loadHelpers(S.helpers);
    const D = "2026-10-04";
    const T = [
      [D, true, { tab: "timeoff", day: null }, true, "a dirty draft + another view (the editor unmounts)"],
      [D, true, { tab: "setup", day: null }, true, "setup"],
      [D, true, { tab: "settings", day: null }, true, "settings"],
      [D, true, { tab: "myschedule", day: null }, true, "myschedule"],
      [D, true, { tab: "calendar", day: "2026-10-07" }, true, "another day (the editor is keyed by its day - a fresh draft)"],
      [D, true, { tab: "calendar", day: D }, false, "the same day"],
      [D, true, { tab: "calendar", day: null }, false, "calendar, no day (the editor stays)"],
      [D, true, { tab: "openshifts", day: null }, false, "openshifts (the editor renders there too)"],
      [D, false, { tab: "timeoff", day: null }, false, "a clean editor"],
      [null, true, { tab: "timeoff", day: null }, false, "no editor open"],
      [D, true, null, false, "no target"],
    ];
    T.forEach(([day, dirty, target, want, label]) => assert.strictEqual(H.pushTapLeavesDraft(day, dirty, target), want, "pushTapLeavesDraft: " + label));
  };
  await check("pushTapLeavesDraft: true only when the day editor is open with a dirty draft AND the tap leaves calendar / openshifts or opens another day", tapDraftCheck);
  // review 10/3 (addendum item 5): Periods > Remind is blocked only when BOTH channels are off, and worded by channel
  const remindHelpersCheck = (S) => {
    const H = loadHelpers(S.helpers);
    const C = (pref) => H.remindChannels(pref);
    assert.deepStrictEqual(C({ schedule_updates_email: false, schedule_updates_push: true }), { mailOff: true, pushOff: false, blocked: false, channel: "push" }, "e-mail off + push on = phone only, NOT blocked");
    assert.deepStrictEqual(C({ schedule_updates_email: false, schedule_updates_push: false }), { mailOff: true, pushOff: true, blocked: true, channel: "none" }, "both off = blocked");
    assert.deepStrictEqual(C({ schedule_updates_email: false }), { mailOff: true, pushOff: true, blocked: true, channel: "none" }, "a row without the push key (the column not there yet) has no phone channel");
    assert.deepStrictEqual(C({ schedule_updates_email: true, schedule_updates_push: false }), { mailOff: false, pushOff: true, blocked: false, channel: "email" });
    assert.deepStrictEqual(C({ schedule_updates_email: true, schedule_updates_push: true }), { mailOff: false, pushOff: false, blocked: false, channel: "both" });
    assert.deepStrictEqual(C(undefined), { mailOff: false, pushOff: false, blocked: false, channel: "both" }, "no row = every switch on");
    const W = (ch) => H.remindButtonWords(ch, "Burchett", " the heads-up for Q1");
    assert.deepStrictEqual(W("push"), { label: "Remind (phone)", title: "Phone only - Burchett has schedule-update e-mails turned off. Push Burchett the heads-up for Q1" });
    assert.deepStrictEqual(W("none"), { label: "Remind", title: "Burchett has schedule-update e-mails and phone notifications turned off - no reminder can be sent" });
    assert.deepStrictEqual(W("email"), { label: "Remind", title: "E-mail Burchett the heads-up for Q1 (phone notifications are off)" });
    assert.deepStrictEqual(W("both"), { label: "Remind", title: "E-mail and push Burchett the heads-up for Q1" });
    const O = (r) => H.remindOutcome(r, "Burchett", "9:05 AM");
    assert.deepStrictEqual(O({ ok: true, sent: 1, skippedPrefOff: 0, push: { sent: 1 } }), { ok: true, kind: "success", note: "reminded 9:05 AM", toast: "Reminder e-mailed and pushed to Burchett." });
    assert.deepStrictEqual(O({ ok: true, sent: 1, skippedPrefOff: 0, push: null }), { ok: true, kind: "success", note: "reminded 9:05 AM", toast: "Reminder e-mailed to Burchett." });
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 1, push: { sent: 1, failed: 0, skipped_no_device: 0, skipped_pref_off: 0, error: null } }), { ok: true, kind: "success", note: "pushed 9:05 AM (e-mail off)", toast: "Reminder pushed to Burchett's phone (no e-mail: Burchett has schedule-update e-mails turned off)." }, "e-mail off + a push sent = a success, not 'No reminder went out'");
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 0, push: { sent: 1 } }), { ok: true, kind: "success", note: "pushed 9:05 AM (no linked e-mail)", toast: "Reminder pushed to Burchett's phone (no e-mail: Burchett has no linked account e-mail)." });
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 1, push: { sent: 0, failed: 0, skipped_no_device: 1, skipped_pref_off: 0, error: null } }), { ok: false, kind: "info", note: "e-mail off, no phone on - not sent", toast: "No reminder went out: Burchett has schedule-update e-mails turned off and no phone with notifications on." });
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 1, push: { sent: 0, skipped_pref_off: 1 } }).note, "e-mail off, phone off - not sent");
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 1, push: { sent: 0, failed: 1 } }).note, "e-mail off, phone push failed - not sent");
    assert.deepStrictEqual(O({ ok: true, sent: 0, skippedPrefOff: 1, push: { sent: 0, error: "push not configured" } }), { ok: false, kind: "info", note: "e-mail off - not sent", toast: "No reminder went out: Burchett has schedule-update e-mails turned off." }, "push did not run: the e-mail reason alone (the old wording)");
    assert.strictEqual(O({ ok: false, error: "x" }), null, "a failed call is left to the caller");
  };
  await check("remindChannels / remindButtonWords / remindOutcome: Remind blocked only when e-mail AND phone are off; 'Remind (phone)' when e-mail is off; a pushed reminder reads 'pushed <time> (e-mail off)'", remindHelpersCheck);
  await check("pushStateOf: ios-home-screen wins over unsupported; blocked = denied; on needs granted + the worker + a subscription + the flag; else off", (S) => {
    const H = loadHelpers(S.helpers);
    const on = { supported: true, ios: false, standalone: false, permission: "granted", hasReg: true, hasSub: true, flag: true };
    assert.strictEqual(H.pushStateOf(on), "on");
    assert.strictEqual(H.pushStateOf({ ...on, ios: true, standalone: false, supported: false }), "ios-home-screen");
    assert.strictEqual(H.pushStateOf({ ...on, ios: true, standalone: true }), "on");
    assert.strictEqual(H.pushStateOf({ ...on, supported: false }), "unsupported");
    assert.strictEqual(H.pushStateOf({ ...on, permission: "denied" }), "blocked");
    ["hasReg", "hasSub", "flag"].forEach(k => assert.strictEqual(H.pushStateOf({ ...on, [k]: false }), "off", k));
    assert.strictEqual(H.pushStateOf({ ...on, permission: "default" }), "off");
    assert.strictEqual(H.pushStateOf(null), "unsupported");
  });
  const wordsCheck = (S) => {
    const H = loadHelpers(S.helpers);
    assert.deepStrictEqual(H.pushStateWords("on", { label: "Chrome on Windows" }), { badge: "Subscribed on this device", line: "On for this device (Chrome on Windows)." });
    const live = H.pushStateWords("blocked", { hostname: "fkhan628.github.io" });
    assert.strictEqual(live.badge, "Blocked");
    assert.strictEqual(live.line, "Blocked for fkhan628.github.io - this also affects the Davenport app. To allow it, open this site's settings in the browser (the icon left of the address), set Notifications to Allow, then reload and tap Enable.");
    assert.strictEqual(H.pushStateWords("blocked", { hostname: "localhost" }).line, "Blocked for localhost. To allow it, open this site's settings in the browser (the icon left of the address), set Notifications to Allow, then reload and tap Enable.");
    assert.strictEqual(H.pushStateWords("blocked", { ios: true, device: "iPhone" }).line, "Blocked in your iPhone's settings: Settings > Notifications > Silvis Call > Allow Notifications, then reopen the app and tap Enable.");
    assert.strictEqual(H.pushStateWords("blocked", { ios: true, device: "iPad" }).line, "Blocked in your iPad's settings: Settings > Notifications > Silvis Call > Allow Notifications, then reopen the app and tap Enable.");
    assert.deepStrictEqual(H.pushStateWords("ios-home-screen", {}), { badge: null, line: "On iPhone and iPad, phone notifications work only in the Home Screen app: tap Share > Add to Home Screen, open Silvis Call from that icon, sign in there once (it has its own sign-in, separate from Safari - your email and password work), then come back to Settings > Notification settings > Phone notifications and tap Enable." });
    assert.deepStrictEqual(H.pushStateWords("unsupported", {}), { badge: null, line: "Not supported in this browser." });
    assert.deepStrictEqual(H.pushStateWords("off", {}), { badge: null, line: "Off for this device." });
    assert.deepStrictEqual(H.pushStateWords("off", { needsTap: true }), { badge: null, line: "Off for this device - tap Enable to turn it back on." });
  };
  await check("pushStateWords: the contract's badge + line per state - Blocked names the host (+ the Davenport clause on fkhan628.github.io only), the iPhone / iPad Home Screen wording, the iOS line with its own sign-in", wordsCheck);
  await check("pushDeviceLabel / pushIsIOS / pushIsStandalone: iPhone, iPad (incl. iPadOS's Macintosh UA with touch), Android, <browser> on <os>, Browser - every label matches the DB's label check", (S) => {
    const H = loadHelpers(S.helpers);
    const T = [
      [UA_IPHONE, 5, "iPhone"],
      ["Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", 5, "iPad"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 5, "iPad"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 0, "Safari on Mac"],
      ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", 5, "Android"],
      [UA_WIN, 0, "Chrome on Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0", 0, "Edge on Windows"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0", 0, "Firefox on Windows"],
      ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", 0, "Chrome on ChromeOS"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OPR/114.0", 0, "Opera on Linux"],
      ["curl/8", 0, "Browser"],
      ["", 0, "Browser"],
    ];
    T.forEach(([ua, mtp, want]) => {
      const got = H.pushDeviceLabel(ua, mtp);
      assert.strictEqual(got, want, ua);
      assert.ok(/^[A-Za-z0-9 .()/-]{1,40}$/.test(got), "label check: " + got);
    });
    assert.strictEqual(H.pushIsIOS(UA_IPHONE, 5), true);
    assert.strictEqual(H.pushIsIOS(UA_WIN, 0), false);
    assert.strictEqual(H.pushIsStandalone(true, false), true);
    assert.strictEqual(H.pushIsStandalone(undefined, true), true);
    assert.strictEqual(H.pushIsStandalone(undefined, false), false);
  });
  await check("pushEndpointAllowed: https on the five push services only (the DB's shape check), 2048 characters at most", (S) => {
    const H = loadHelpers(S.helpers);
    ["https://fcm.googleapis.com/fcm/send/abc", "https://android.googleapis.com/gcm/send/x", "https://web.push.apple.com/QK_x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"].forEach(e => assert.strictEqual(H.pushEndpointAllowed(e), true, e));
    ["http://fcm.googleapis.com/fcm/send/x", "https://evil.example/push/x", "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com.example/x", "https://fcm.googleapis.com/x y", "https://FCM.googleapis.com/x", "", null, "https://fcm.googleapis.com/" + "a".repeat(2030)].forEach(e => assert.strictEqual(H.pushEndpointAllowed(e), false, String(e).slice(0, 60)));
    // the DB regex, restated from the contract (section 1.1), byte for byte
    assert.strictEqual(H.PUSH_ENDPOINT_RE.source, "^https:\\/\\/([a-z0-9-]+\\.)*(fcm\\.googleapis\\.com|android\\.googleapis\\.com|push\\.apple\\.com|push\\.services\\.mozilla\\.com|notify\\.windows\\.com)\\/[!-~]*$");
  });
  await check("pushB64u / pushB64uDecode: Node's base64url, no padding, round trip; a bad character throws", (S) => {
    const H = loadHelpers(S.helpers);
    for (let n = 0; n < 70; n++) {
      const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 37 + n) & 255;
      const t = H.pushB64u(u);
      assert.strictEqual(t, b64u(u), "length " + n);
      assert.deepStrictEqual(Array.from(H.pushB64uDecode(t)), Array.from(u));
    }
    assert.strictEqual(H.pushB64u(P256DH).length, 87);
    assert.ok(/^B[A-Za-z0-9_-]{86}$/.test(H.pushB64u(P256DH)) && /^[A-Za-z0-9_-]{22}$/.test(H.pushB64u(AUTHB)), "the keys the DB checks");
    assert.deepStrictEqual(Array.from(H.pushB64uDecode(b64u(AUTHB) + "==")), Array.from(AUTHB), "padding is optional");
    assert.throws(() => H.pushB64uDecode("ab$c"));
  });
  await check("pushErrorWords: PS001-PS007 -> the function's own text after the token (byte for byte the contract's table); a missing function -> 'available after the next update'; 401; offline; a generic line without the body", (S) => {
    const H = loadHelpers(S.helpers);
    const TABLE = {
      PS001: ["PUSH_NOT_SIGNED_IN", "sign in first - phone notifications belong to an account"],
      PS002: ["PUSH_NO_PROFILE", "this account has no profile yet - ask the scheduler (nothing was saved)"],
      PS003: ["PUSH_BAD_ENDPOINT", "this browser's push address is not one the app sends to - nothing was saved"],
      PS004: ["PUSH_BAD_KEYS", "this browser's push keys are malformed - tap Reset subscription, then Enable (nothing was saved)"],
      PS005: ["PUSH_BAD_LABEL", "a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)"],
      PS006: ["PUSH_HELD", "this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)"],
      PS007: ["PUSH_TOO_MANY", "this account has phone notifications on 10 devices already - turn one off first (nothing was saved)"],
    };
    Object.entries(TABLE).forEach(([code, [token, text]]) => {
      assert.strictEqual(H.PUSH_CODES[code], token);
      assert.strictEqual(H.pushErrorWords(JSON.stringify({ code, details: null, hint: null, message: token + ": " + text }), 400), text, code);
    });
    assert.strictEqual(H.pushErrorWords(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.save_push_subscription(p_auth, p_endpoint, p_label, p_p256dh) in the schema cache" }), 404), "Phone notifications are available after the next update.");
    assert.strictEqual(H.pushErrorWords(JSON.stringify({ code: "PGRST301", message: "JWT expired" }), 401), "Your session expired - sign in again, then try again.");
    assert.strictEqual(H.pushErrorWords("TypeError: Failed to fetch", 0), "Couldn't reach the server - check your connection.");
    const g = H.pushErrorWords("<html>bad gateway https://x.example</html>", 502);
    assert.strictEqual(g, "Couldn't save phone notifications for this device (HTTP 502) - try again.");
  });
  await check("pushTestWords: each Send test outcome in the contract's words", (S) => {
    const H = loadHelpers(S.helpers);
    const P = (d, extra) => ({ ok: true, status: 200, push: Object.assign({ sent: 0, failed: 0, removed: 0, skipped_no_device: 0, skipped_pref_off: 0, devices: d, error: null }, extra || {}) });
    assert.strictEqual(H.pushTestWords(P({ sent: 2, failed: 0, removed: 0 })), "Test sent to 2 device(s) on your account - it should arrive in a few seconds.");
    assert.strictEqual(H.pushTestWords(P({ sent: 0, failed: 0, removed: 0 }, { skipped_no_device: 1 })), "No device of yours has phone notifications on - tap Enable first.");
    assert.strictEqual(H.pushTestWords(P({ sent: 0, failed: 1, removed: 1 })), "The push service refused the test on 2 device(s) - tap Reset subscription, then Enable.");
    assert.strictEqual(H.pushTestWords({ ok: false, status: 400, notDeployed: true }), "The server does not send phone notifications yet (it needs the next update).");
    assert.strictEqual(H.pushTestWords({ ok: false, status: 503, notConfigured: true }), "Phone notifications are not set up on the server yet.");
    assert.strictEqual(H.pushTestWords({ ok: false, status: 401 }), "Sign in again, then try the test.");
    assert.strictEqual(H.pushTestWords({ ok: false, status: 0 }), "Couldn't reach the server - check your connection.");
  });
  await check("pushDiagLine: Worker / Permission / Subscribed / Saved on the server / Signed in as (+ the key-changed hint) - one line, never a URL", (S) => {
    const H = loadHelpers(S.helpers);
    assert.strictEqual(H.pushDiagLine({ worker: "active", permission: "granted", subscribed: true, saved: true, devices: 2, signedInAs: "Khan" }), "Worker: active - Permission: granted - Subscribed: yes - Saved on the server: yes (2 device(s) on this account) - Signed in as: Khan");
    assert.strictEqual(H.pushDiagLine({ worker: "none", permission: "default", subscribed: false, saved: false, signedInAs: "a read-only account" }), "Worker: none - Permission: not asked - Subscribed: no - Saved on the server: no - Signed in as: a read-only account");
    assert.strictEqual(H.pushDiagLine({ worker: "installing", permission: "unsupported", subscribed: true, saved: null, savedWhy: "couldn't reach the server", signedInAs: "Khan", keyChanged: true }), "Worker: installing - Permission: unsupported - Subscribed: yes - Saved on the server: unknown (couldn't reach the server) - Signed in as: Khan - Server key changed: tap Reset subscription, then Enable");
  });
  await check("notifPrefSaveRequest: opts.push adds trade_updates_push / schedule_updates_push (only an explicit false is off); without it the row is exactly the pre-Prompt-30 one (no *_push key) - for both owners", (S) => {
    const H = loadHelpers(S.helpers);
    const cur = { schedule_updates_email: false, trade_updates_email: true, trade_updates_push: false, reminder_hour_central: 6 };
    const a = H.notifPrefSaveRequest({ personId: "s1" }, cur, "2026-10-02T00:00:00Z");
    assert.deepStrictEqual(a, { onConflict: "person_id", row: { person_id: "s1", schedule_updates_email: false, trade_updates_email: true, shift_reminders_email: true, reminder_hour_central: 6, updated_at: "2026-10-02T00:00:00Z" } });
    assert.ok(!Object.keys(a.row).some(k => /_push$/.test(k)), "no *_push key without opts.push");
    assert.deepStrictEqual(H.notifPrefSaveRequest({ personId: "s1" }, cur, "t", { push: false }).row, H.notifPrefSaveRequest({ personId: "s1" }, cur, "t").row);
    const b = H.notifPrefSaveRequest({ personId: "s1" }, cur, "t", { push: true });
    assert.strictEqual(b.row.trade_updates_push, false);
    assert.strictEqual(b.row.schedule_updates_push, true, "a missing key is on");
    const f = H.notifPrefSaveRequest({ profileId: UID }, { schedule_updates_push: false }, "t", { push: true });
    assert.deepStrictEqual([f.onConflict, f.row.profile_id, "person_id" in f.row, f.row.schedule_updates_push, f.row.trade_updates_push], ["profile_id", UID, false, false, true]);
  });

  /* ================================ [SW] sw.js ================================ */
  console.log("\n[SW] sw.js in a sandbox (a fake `self`)");
  function loadSw(src, o) {
    o = o || {};
    const listeners = {};
    const rec = { shown: [], focused: [], posted: [], opened: [], claimed: 0, skipped: 0, matchAll: null };
    const scope = o.scope || SIL;
    const self = {
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      skipWaiting: () => { rec.skipped++; return Promise.resolve(); },
      registration: { scope, showNotification: (title, opt) => { rec.shown.push({ title, opt }); return o.showRejectsOnce && rec.shown.length === 1 ? Promise.reject(new TypeError("fake: no permission")) : Promise.resolve(); } },
      clients: {
        claim: () => { rec.claimed++; return Promise.resolve(); },
        matchAll: async (q) => { rec.matchAll = q; return (o.clients || []).map(url => ({ url, focus: async () => { rec.focused.push(url); }, postMessage: (m) => { rec.posted.push({ url, m }); } })); },
        openWindow: async (u) => { rec.opened.push(u); return null; },
      },
    };
    const sb = { self, URL, console: quiet };
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: "sw.js" });
    const fire = async (type, ev) => { const waits = []; ev.waitUntil = (p) => { waits.push(Promise.resolve(p)); }; (listeners[type] || []).forEach(fn => fn(ev)); await Promise.all(waits); };
    return { listeners, rec, fire };
  }
  const pushEv = (data) => ({ data: data === undefined ? null : { json: () => { if (data instanceof Error) throw data; return typeof data === "string" ? JSON.parse(data) : data; } } });
  const GOOD = { v: 1, title: "Silvis Call", body: "Fierce proposes a trade - you take Sat 10/10 primary", tag: "silvis-trade-1a2b3c4d", tab: "timeoff" };
  const GEN = { title: "Silvis Call", opt: { body: "Open the app for details.", tag: "silvis-generic", renotify: true, icon: "icon-192.png", data: { tab: null, day: null } } };
  await check("sw.js listens to install / activate / push / notificationclick only - no fetch handler, no cache, no import; plain ASCII; install skips waiting, activate claims", async (S) => {
    const w = loadSw(S.sw);
    assert.deepStrictEqual(Object.keys(w.listeners).sort(), ["activate", "install", "notificationclick", "push"]);
    assert.ok(!/addEventListener\(\s*["']fetch["']/.test(S.sw) && !/\bcaches\b/.test(S.sw.replace(/\/\/.*$/gm, "")) && !/importScripts|\bimport\s/.test(S.sw.replace(/\/\/.*$/gm, "")), "no fetch handler, no cache, no import");
    assert.ok(/^[\x00-\x7F]*$/.test(S.sw), "sw.js is pure ASCII");
    await w.fire("install", {}); await w.fire("activate", {});
    assert.deepStrictEqual([w.rec.skipped, w.rec.claimed], [1, 1]);
  });
  const swShowCheck = async (S) => {
    const shows = async (data, o) => { const w = loadSw(S.sw, o); await w.fire("push", pushEv(data)); return plain(w.rec.shown); };
    let s = await shows(GOOD);
    assert.deepStrictEqual(s, [{ title: "Silvis Call", opt: { body: GOOD.body, tag: GOOD.tag, renotify: true, icon: "icon-192.png", data: { tab: "timeoff", day: null } } }], "a good payload");
    s = await shows({ v: 1, title: "Silvis Call", body: "10/12 P Philip -> Fierce (by Khan)", tag: "silvis-edit-20261012", tab: "calendar", params: { day: "2026-10-12" } });
    assert.deepStrictEqual(s[0].opt.data, { tab: "calendar", day: "2026-10-12" }, "the day rides in data");
    for (const [label, data] of [["non-JSON data", new SyntaxError("Unexpected token")], ["no data at all", undefined], ["v 2", { ...GOOD, v: 2 }], ["an array", [1, 2]], ["a string", "\"hello\""], ["null", "null"]]) {
      s = await shows(data);
      assert.deepStrictEqual(s, [GEN], label + " -> the generic notification, shown (never a silent push)");
    }
    s = await shows({ ...GOOD, title: "x".repeat(81) });
    assert.deepStrictEqual([s[0].title, s[0].opt.body, s[0].opt.tag], ["Silvis Call", "Open the app for details.", GOOD.tag], "a bad title: BOTH title and body generic, the tag kept");
    s = await shows({ ...GOOD, body: "" });
    assert.deepStrictEqual([s[0].title, s[0].opt.body], ["Silvis Call", "Open the app for details."], "an empty body: both generic");
    s = await shows({ ...GOOD, tag: "Silvis-Trade", tab: "evil", params: { day: "2026-13" } });
    assert.deepStrictEqual([s[0].opt.tag, s[0].opt.data], ["silvis-generic", { tab: null, day: null }], "a bad tag / tab / day: dropped");
    s = await shows({ ...GOOD, url: "https://evil.example/x" });
    assert.ok(!JSON.stringify(s).includes("evil.example"), "a url key never reaches the notification");
    s = await shows(GOOD, { showRejectsOnce: true });
    assert.strictEqual(s.length, 2, "a rejected showNotification is tried once more");
    assert.deepStrictEqual(s[1], GEN, "... with the generic notification");
  };
  await check("sw.js push: ALWAYS showNotification - the payload's title / body / tag / data when valid, else the generic 'Silvis Call - Open the app for details.' (bad / empty / non-JSON data, v != 1); bad tag / tab / day dropped; a url key ignored; a rejected show retried generic", swShowCheck);
  const swClickCheck = async (S) => {
    const click = async (data, clients) => { const w = loadSw(S.sw, { clients }); let closed = 0; await w.fire("notificationclick", { notification: { data, close: () => { closed++; } } }); return Object.assign(plain(w.rec), { closed }); };
    let r = await click({ tab: "timeoff", day: null }, [LIVE + "Call-Schedule-App/", SIL + "?tab=calendar"]);
    assert.strictEqual(r.closed, 1, "the notification is closed");
    assert.deepStrictEqual(r.matchAll, { type: "window", includeUncontrolled: true });
    assert.deepStrictEqual(r.focused, [SIL + "?tab=calendar"], "the open app window (inside the scope) is focused - never Davenport's");
    assert.deepStrictEqual(r.posted, [{ url: SIL + "?tab=calendar", m: { type: "silvis-push-open", tab: "timeoff", day: null } }], "and told by postMessage");
    assert.deepStrictEqual(r.opened, [], "no new window when one is open");
    r = await click({ tab: "calendar", day: "2026-10-15" }, [LIVE + "Call-Schedule-App/"]);
    assert.deepStrictEqual(r.opened, [SIL + "?tab=calendar&day=2026-10-15"], "no app window: a new one at ./?tab=&day= relative to the scope");
    r = await click({ tab: "openshifts", url: "https://evil.example/phish" }, []);
    assert.deepStrictEqual(r.opened, [SIL + "?tab=openshifts"], "a url in the data is never opened");
    r = await click({ tab: "evil", day: "2026-10-15" }, []);
    assert.deepStrictEqual(r.opened, [SIL], "a tab off the whitelist: the app's start page");
    r = await click(null, []);
    assert.deepStrictEqual(r.opened, [SIL], "no data: the start page");
    r = await click({ tab: "settings" }, [SIL + "?public=1"]);
    assert.deepStrictEqual([r.posted, r.opened], [[], [SIL + "?tab=settings"]], "the read-only ?public=1 page is not the app window to switch");
  };
  await check("sw.js notificationclick: focus + postMessage({ type: silvis-push-open, tab, day }) to an open window inside the scope, else openWindow(./?tab=<view>[&day=]) built from the scope - never a URL from the payload; a bad tab opens the start page", swClickCheck);

  /* ================================ [C] config.js ================================ */
  console.log("\n[C] config.js pushDb / pushDevice against fake workers / PushManager / Notification / fetch");
  const regCheck = async (S) => {
    const b = mkBrowser({ permission: "granted" });
    const c = loadClient(S, b);
    assert.strictEqual(await c.pushDevice.registration(false), null, "only Davenport's root registration exists: no Silvis worker");
    assert.strictEqual(b.sw.readyTouched + b.sw.getRegistrationTouched, 0, "navigator.serviceWorker.ready / getRegistration() are never read (both answer Davenport's root worker)");
    const b2 = mkBrowser({ regs: [[SIL, { active: SIL + "sw.js?v=3" }], [SIL + "x/", { active: SIL + "x/sw.js" }]] });
    const c2 = loadClient(S, b2);
    const r2 = await c2.pushDevice.registration(false);
    assert.ok(r2 && r2.scope === SIL, "the folder-scoped sw.js registration (query ignored) is the Silvis worker");
    const b3 = mkBrowser({ regs: [[SIL, { active: SIL + "other.js" }]] });
    assert.strictEqual(await loadClient(S, b3).pushDevice.registration(false), null, "another script at the folder scope is not ours");
    const b4 = mkBrowser({});
    const r4 = await loadClient(S, b4).pushDevice.registration(true);
    assert.ok(r4 && r4.scope === SIL && r4.active, "create: registered and active");
    assert.ok(b4.log.includes("register /Silvis-Call-Schedule/sw.js " + JSON.stringify({ scope: SIL, updateViaCache: "none" })), "register(<folder>sw.js, { scope: <folder>, updateViaCache: none }): " + b4.log.join(" | "));
    assert.strictEqual(b4.sw.readyTouched + b4.sw.getRegistrationTouched, 0);
  };
  await check("pushDevice.registration(): only getRegistrations() filtered to scope = the app folder AND script = <folder>sw.js (query stripped) - never `ready` / getRegistration() (Davenport's root worker); create registers <folder>sw.js at the folder scope with updateViaCache none", regCheck);
  await check("pushDb: publicKey ok / unavailable (404 / 405 / 503) / failed (malformed key, 500, a thrown fetch), no auth header and no-store; the RPCs are POSTs with the endpoint in the BODY only; status unavailable on 404 PGRST202; sendTest's notDeployed / notConfigured / 401", async (S) => {
    for (const [ans, want] of [[undefined, "ok"], [{ status: 405, body: { error: "method not allowed" } }, "unavailable"], [{ status: 404, body: "not found" }, "unavailable"], [{ status: 503, body: { error: "phone notifications are not set up on the server yet" } }, "unavailable"], [{ status: 200, body: { publicKey: "Bshort" } }, "failed"], [{ status: 500, body: "x" }, "failed"]]) {
      const b = mkBrowser({ answers: (p) => (/vapid=public/.test(p) ? ans : undefined) });
      const k = await loadClient(S, b).pushDb.publicKey();
      assert.strictEqual(k.state, want, JSON.stringify(ans));
      if (want === "ok") assert.strictEqual(k.key, KEY);
      assert.strictEqual(b.calls[0].auth, null, "the public key GET carries no auth header");
      assert.strictEqual(b.calls[0].cache, "no-store");
    }
    const b = mkBrowser({});
    const c = loadClient(S, b);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await c.pushDb.status(EP1))), { state: "ok", saved: true, devices: 1 });
    await c.pushDb.remove(EP1);
    await c.pushDb.save(EP1, b64u(P256DH), b64u(AUTHB), "Chrome on Windows");
    b.calls.forEach(x => { assert.strictEqual(x.method, "POST"); assert.ok(!x.path.includes("?"), "no query on an RPC: " + x.path); assert.ok(/^Bearer /.test(x.auth || ""), "the user's JWT"); });
    assert.deepStrictEqual(b.calls.map(x => x.path), ["/rest/v1/rpc/push_subscription_status", "/rest/v1/rpc/delete_push_subscription", "/rest/v1/rpc/save_push_subscription"]);
    assert.deepStrictEqual(JSON.parse(b.calls[1].body), { p_endpoint: EP1 });
    const bu = mkBrowser({ answers: (p) => (/push_subscription_status/.test(p) ? { status: 404, body: { code: "PGRST202", message: "Could not find the function public.push_subscription_status(p_endpoint) in the schema cache" } } : undefined) });
    assert.strictEqual((await loadClient(S, bu).pushDb.status(EP1)).state, "unavailable", "a missing function is unavailable - never 'not saved'");
    const test = async (ans) => { const bt = mkBrowser({ answers: (p) => (/push=test/.test(p) ? ans : undefined) }); const r = await loadClient(S, bt).pushDb.sendTest(); assert.deepStrictEqual([bt.calls[0].method, bt.calls[0].path, bt.calls[0].body], ["POST", "/functions/v1/send-notification?push=test", "{}"]); return r; };
    const ok = await test(undefined);
    assert.ok(ok.ok && ok.push && ok.push.devices.sent === 1 && !ok.notDeployed && !ok.notConfigured);
    assert.ok((await test({ status: 400, body: { error: "unknown notification type: undefined" } })).notDeployed, "a pre-Prompt-30 function: 400 unknown type");
    assert.ok((await test({ status: 405, body: { error: "method not allowed" } })).notDeployed);
    assert.ok((await test({ status: 200, body: { sent: 0 } })).notDeployed, "a 200 without the push key");
    assert.ok((await test({ status: 503, body: { error: "phone notifications are not set up on the server yet" } })).notConfigured);
    const u = await test({ status: 401, body: { error: "unauthorized" } });
    assert.ok(!u.ok && u.status === 401 && !u.notDeployed);
  });
  await check("notifPrefsDb.pushColumns: ok (200, even []) / unavailable (400 42703 naming a *_push column) / failed; the probe names exactly the two columns; save(owner, cur, { push: true }) sends them", async (S) => {
    for (const [ans, want] of [[undefined, "ok"], [{ status: 400, body: { code: "42703", details: null, hint: null, message: "column notification_preferences.trade_updates_push does not exist" } }, "unavailable"], [{ status: 500, body: "x" }, "failed"], [{ status: 401, body: { code: "PGRST301" } }, "failed"]]) {
      const b = mkBrowser({ answers: (p, m) => (m === "GET" && /notification_preferences/.test(p) ? (ans || { status: 200, body: [] }) : undefined) });
      assert.strictEqual(await loadClient(S, b).notifPrefsDb.pushColumns(), want, JSON.stringify(ans));
      assert.strictEqual(b.calls[0].path, "/rest/v1/notification_preferences?select=trade_updates_push,schedule_updates_push&limit=1");
    }
    const b = mkBrowser({});
    const c = loadClient(S, b);
    await c.notifPrefsDb.save({ personId: "s1" }, { trade_updates_push: false }, { push: true });
    await c.notifPrefsDb.save({ personId: "s1" }, { trade_updates_push: false });
    const [w1, w2] = b.calls.map(x => JSON.parse(x.body));
    assert.deepStrictEqual([w1.trade_updates_push, w1.schedule_updates_push, "trade_updates_push" in w2], [false, true, false]);
  });
  const enableCheck = async (S) => {
    const b = mkBrowser({ permission: "default", answer: "granted" });
    const c = loadClient(S, b);
    const r = await c.pushDevice.enable(UID, "Chrome on Windows", { name: "Khan", readbackMs: 0 });
    assert.strictEqual(r.message, "Subscribed (as Khan).", JSON.stringify(r));
    assert.strictEqual(b.N.requests, 1, "the permission is asked once");
    assert.strictEqual(b.log[0], "requestPermission", "requestPermission is the FIRST thing the tap does (Safari keeps the user gesture only that long): " + b.log.slice(0, 4).join(" | "));
    const saves = fetches(b, /save_push_subscription/);
    assert.strictEqual(saves.length, 1);
    const body = JSON.parse(saves[0].body);
    assert.deepStrictEqual(Object.keys(body).sort(), ["p_auth", "p_endpoint", "p_label", "p_p256dh"], "the save body: exactly the four keys");
    assert.deepStrictEqual(body, { p_endpoint: EP1, p_p256dh: b64u(P256DH), p_auth: b64u(AUTHB), p_label: "Chrome on Windows" });
    const sr = silvisReg(b);
    assert.ok(sr && sr.pushManager.sub && sr.pushManager.sub.endpoint === EP1, "subscribed on the SILVIS registration");
    assert.deepStrictEqual(Array.from(new Uint8Array(sr.pushManager.subscribeCalls[0].applicationServerKey)), Array.from(Buffer.from(KEY, "base64url")), "applicationServerKey = the server's public key bytes");
    assert.strictEqual(sr.pushManager.subscribeCalls[0].userVisibleOnly, true);
    assert.ok(b.root.pushManager.sub && b.root.pushManager.subscribeCalls.length === 0, "Davenport's root worker and its subscription untouched");
    const flag = JSON.parse(b.ls.getItem("silvis-push-on-" + UID));
    assert.deepStrictEqual([flag.v, flag.ep], [1, await sha16(EP1)], "the flag: { v: 1, ep: the first 16 hex of SHA-256(endpoint) }");
    assert.ok(!Array.from(b.ls._m.values()).some(v => v.includes("fcm.googleapis.com")), "the endpoint itself is never stored");
    assert.ok(fetches(b, /push_subscription_status/).length === 1, "the read-back asks the server");
  };
  await check("enable: requestPermission FIRST (once), the public key, <folder>sw.js active, subscribe (userVisibleOnly, the server key) on the Silvis worker, save with exactly { p_endpoint, p_p256dh, p_auth, p_label }, the flag (a hash, never the endpoint), the read-back -> 'Subscribed (as Khan).'", enableCheck);
  await check("enable refusals: iOS outside the Home Screen (nothing asked, nothing registered); permission not granted (no worker, no request); public key unavailable; the worker never active ('Not ready yet'); a refused save unsubscribes and writes NO flag (PS006's words); a read-back that misses says 'not registered yet'", async (S) => {
    let b = mkBrowser({ ua: UA_IPHONE, answer: "granted" });
    let r = await loadClient(S, b).pushDevice.enable(UID, "iPhone", { readbackMs: 0 });
    assert.strictEqual(r.step, "ios");
    assert.ok(/^On iPhone and iPad, phone notifications work only in the Home Screen app/.test(r.message));
    assert.deepStrictEqual([b.N.requests, b.calls.length, b.log.filter(l => /^register/.test(l)).length], [0, 0, 0], "iOS not standalone: nothing asked, nothing fetched, nothing registered");
    b = mkBrowser({ answer: "denied" });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.deepStrictEqual([r.step, r.permission, r.message], ["permission", "denied", "Permission was not granted. If no question appeared, notifications are blocked for this site - see the line above."]);
    assert.deepStrictEqual([b.calls.length, b.log.filter(l => /^register/.test(l)).length], [0, 0]);
    b = mkBrowser({ answer: "granted", answers: (p) => (/vapid/.test(p) ? { status: 405, body: { error: "method not allowed" } } : undefined) });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.deepStrictEqual([r.step, r.message], ["key", "Phone notifications are available after the next update."]);
    b = mkBrowser({ answer: "granted", neverActive: true });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.deepStrictEqual([r.step, r.message], ["worker", "Not ready yet - wait a few seconds and tap Enable again."]);
    b = mkBrowser({ answer: "granted", answers: (p) => (/save_push/.test(p) ? { status: 400, body: { code: "PS006", details: null, hint: null, message: "PUSH_HELD: this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)" } } : undefined) });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.deepStrictEqual([r.ok, r.message], [false, "this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)"]);
    assert.ok(b.log.some(l => /^unsubscribe/.test(l)) && !silvisReg(b).pushManager.sub, "the refused save's subscription is dropped");
    assert.strictEqual(b.ls.getItem("silvis-push-on-" + UID), null, "no flag after a refused save");
    b = mkBrowser({ answer: "granted", saved: false });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.deepStrictEqual([r.ok, r.message], [false, "Permission granted, but this device is not registered yet - reload the app and check again."]);
    b = mkBrowser({ answer: "granted", endpoint: "https://evil.example/push/x" });
    r = await loadClient(S, b).pushDevice.enable(UID, "x", { readbackMs: 0 });
    assert.ok(!r.ok && fetches(b, /save_push/).length === 0 && !silvisReg(b).pushManager.sub, "an endpoint off the whitelist is never sent - unsubscribed");
  });
  await check("enable over an old server key: the InvalidStateError subscription is dropped and the subscribe runs once more; another account's flag on this device goes (the endpoint is this account's now)", async (S) => {
    const b = mkBrowser({ permission: "granted", answer: "granted", silvisSub: EP2, invalidStateOnce: true, lsInit: { ["silvis-push-on-" + UID2]: JSON.stringify({ v: 1, ep: "0000000000000000", at: "x" }) } });
    const r = await loadClient(S, b).pushDevice.enable(UID, "x", { name: "Khan", readbackMs: 0 });
    assert.strictEqual(r.message, "Subscribed (as Khan).");
    assert.deepStrictEqual(b.log.filter(l => /^(subscribe|unsubscribe)/.test(l)), ["subscribe", "unsubscribe device-2", "subscribe"]);
    assert.strictEqual(b.ls.getItem("silvis-push-on-" + UID2), null);
  });
  const rearmCheck = async (S) => {
    // (a) permission not granted: no call at all
    for (const p of ["default", "denied"]) {
      const b = mkBrowser({ permission: p, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: "x", at: "t" }) } });
      const r = await loadClient(S, b).pushDevice.rearm(UID, "x");
      assert.deepStrictEqual([r.action, b.calls.length, b.N.requests, b.log.filter(l => /^(register|getRegistrations)/.test(l)).length], ["off-permission", 0, 0, 0], p + ": no network, no registration read, no prompt");
      assert.ok(b.ls.getItem("silvis-push-on-" + UID), "the flag stays (a later re-allow re-arms)");
    }
    // (b) the three conditions: flag + granted + the registration wiped (a Davenport update's reset)
    let b = mkBrowser({ permission: "granted", lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP2), at: "t" }) } });
    let r = await loadClient(S, b).pushDevice.rearm(UID, "Chrome on Windows");
    assert.strictEqual(r.action, "resubscribed");
    assert.strictEqual(b.N.requests, 0, "never a prompt");
    assert.ok(silvisReg(b) && silvisReg(b).pushManager.sub, "re-registered and subscribed");
    assert.strictEqual(fetches(b, /save_push/).length, 1, "saved");
    assert.strictEqual(JSON.parse(b.ls.getItem("silvis-push-on-" + UID)).ep, await sha16(EP1), "the flag follows the new endpoint");
    // (c) the same hash: nothing at all goes out
    b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }) } });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, b.calls.length, b.N.requests], ["none", 0, 0]);
    // (d) another hash (the browser changed the endpoint): re-saved silently
    b = mkBrowser({ permission: "granted", silvisSub: EP2, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }) } });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, fetches(b, /save_push/).length, JSON.parse(fetches(b, /save_push/)[0].body).p_endpoint, b.N.requests], ["saved", 1, EP2, 0]);
    assert.strictEqual(JSON.parse(b.ls.getItem("silvis-push-on-" + UID)).ep, await sha16(EP2));
    // (e) a subscription without this account's flag: the server decides
    b = mkBrowser({ permission: "granted", silvisSub: EP1, saved: true });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, !!b.ls.getItem("silvis-push-on-" + UID), b.N.requests], ["flag-restored", true, 0]);
    b = mkBrowser({ permission: "granted", silvisSub: EP1, saved: false });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, silvisReg(b).pushManager.sub, b.ls.getItem("silvis-push-on-" + UID), fetches(b, /save_push|delete_push/).length], ["dropped-foreign", null, null, 0], "not ours: unsubscribed locally, no row touched");
    // (f) no flag, no subscription: nothing to re-arm
    b = mkBrowser({ permission: "granted" });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, b.calls.length, b.log.filter(l => /^register/.test(l)).length], ["none", 0, 0]);
    // (g) the silent subscribe fails: needs-tap, never a prompt, the flag kept
    b = mkBrowser({ permission: "granted", subscribeThrows: true, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: "x", at: "t" }) } });
    r = await loadClient(S, b).pushDevice.rearm(UID, "x");
    assert.deepStrictEqual([r.action, b.N.requests, !!b.ls.getItem("silvis-push-on-" + UID)], ["needs-tap", 0, true]);
  };
  await check("rearm (on start, never a prompt): permission not granted -> no call at all; flag + granted + a wiped registration -> re-registered, subscribed, saved; same hash -> no network; another hash -> re-saved; no flag -> the status RPC decides (ours: flag back / not ours: unsubscribed locally); a failed silent subscribe -> needs-tap", rearmCheck);
  const teardownCheck = async (S) => {
    const b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }) } });
    const c = loadClient(S, b);
    const r = await c.pushDevice.teardown(UID, 4000);
    b.log.push("signOut");
    const seq = b.log.filter(l => /delete_push_subscription|^unsubscribe|^signOut/.test(l));
    assert.deepStrictEqual(seq, ["fetch POST rpc/delete_push_subscription", "unsubscribe device-1", "signOut"], "the row delete (with the still-valid token), THEN the unsubscribe, both before the sign-out: " + b.log.join(" | "));
    assert.deepStrictEqual(JSON.parse(fetches(b, /delete_push/)[0].body), { p_endpoint: EP1 });
    assert.ok(/^Bearer /.test(fetches(b, /delete_push/)[0].auth || ""));
    assert.ok(r.done && b.ls.getItem("silvis-push-on-" + UID) === null, "the flag is cleared");
    assert.ok(b.root.pushManager.sub, "Davenport's subscription is untouched");
  };
  await check("teardown (sign-out): the delete request BEFORE pushManager.unsubscribe(), both before the sign-out; the flag cleared; Davenport's root subscription untouched", teardownCheck);
  await check("teardown is capped: a delete that never answers still lets the sign-out go after the cap (here 250 ms) and clears the flag", async (S) => {
    const b = mkBrowser({ permission: "granted", silvisSub: EP1, removeHangs: true, lsInit: { ["silvis-push-on-" + UID]: "{\"v\":1,\"ep\":\"x\",\"at\":\"t\"}" } });
    const t0 = Date.now();
    const r = await loadClient(S, b).pushDevice.teardown(UID, 250);
    assert.ok(r.timedOut && Date.now() - t0 < 2000, "returned on the cap: " + JSON.stringify(r));
    assert.strictEqual(b.ls.getItem("silvis-push-on-" + UID), null);
    const b2 = mkBrowser({});
    const r2 = await loadClient(S, b2).pushDevice.teardown(UID, 4000);
    assert.ok(r2.done && b2.calls.length === 0, "no Silvis subscription: nothing to delete");
  });
  await check("disable (Turn off): delete { p_endpoint } + unsubscribe + clear the flag - the worker stays; reset: the same plus unregistering ONLY the Silvis push worker (root and sub-scope registrations kept)", async (S) => {
    let b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: "{\"v\":1,\"ep\":\"x\",\"at\":\"t\"}" } });
    let r = await loadClient(S, b).pushDevice.disable(UID);
    assert.strictEqual(r.message, "Phone notifications are off for this device.");
    assert.deepStrictEqual(JSON.parse(fetches(b, /delete_push/)[0].body), { p_endpoint: EP1 });
    assert.ok(!silvisReg(b).pushManager.sub && silvisReg(b), "unsubscribed, the worker stays");
    assert.ok(!b.log.some(l => /^unregister/.test(l)) && b.ls.getItem("silvis-push-on-" + UID) === null);
    b = mkBrowser({ permission: "granted", silvisSub: EP1, regs: [[SIL + "x/", { active: SIL + "x/sw.js" }]], lsInit: { ["silvis-push-on-" + UID]: "{\"v\":1,\"ep\":\"x\",\"at\":\"t\"}" } });
    r = await loadClient(S, b).pushDevice.reset(UID);
    assert.strictEqual(r.message, "Reset done. Reload the app, then tap Enable.");
    assert.deepStrictEqual(b.log.filter(l => /^unregister/.test(l)), ["unregister /Silvis-Call-Schedule/"], "only the Silvis push worker");
    assert.ok(b.sw.regs.some(x => x.scope === LIVE) && b.sw.regs.some(x => x.scope === SIL + "x/"), "the root (Davenport) and the sub-scope registration remain");
    assert.ok(fetches(b, /delete_push/).length === 1 && b.ls.getItem("silvis-push-on-" + UID) === null);
  });
  await check("dropForeign (a different account on the in-place card): other accounts' flags go; a subscription without the new account's flag is unsubscribed locally (no request - the old token is dead); one with it is kept", async (S) => {
    let b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }), "silvis-dark-mode": "true" } });
    let r = await loadClient(S, b).pushDevice.dropForeign(UID2);
    assert.deepStrictEqual([r.action, silvisReg(b).pushManager.sub, b.ls.getItem("silvis-push-on-" + UID), b.ls.getItem("silvis-dark-mode"), b.calls.length], ["unsubscribed", null, null, "true", 0]);
    b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID2]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }), ["silvis-push-on-" + UID]: "{\"v\":1,\"ep\":\"x\",\"at\":\"t\"}" } });
    r = await loadClient(S, b).pushDevice.dropForeign(UID2);
    assert.deepStrictEqual([r.action, !!silvisReg(b).pushManager.sub, b.ls.getItem("silvis-push-on-" + UID), !!b.ls.getItem("silvis-push-on-" + UID2)], ["kept", true, null, true]);
  });
  await check("state(): on / off / blocked / unsupported / ios-home-screen from the fakes, with no network; diagnose: one line with no URL, no endpoint, no key - and 'Server key changed' when the subscription's key is not the server's", async (S) => {
    const flagOf = async (ep) => ({ ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(ep), at: "t" }) });
    const st = async (o) => { const b = mkBrowser(o); const s = await loadClient(S, b).pushDevice.state(UID); assert.strictEqual(b.calls.length, 0, "state() reads no network"); return s; };
    let s = await st({ permission: "granted", silvisSub: EP1, lsInit: await flagOf(EP1) });
    assert.deepStrictEqual([s.state, s.label, s.worker, s.hasSub, s.flag, s.hostname], ["on", "Chrome on Windows", "active", true, true, "fkhan628.github.io"]);
    assert.strictEqual((await st({ permission: "granted", silvisSub: EP1 })).state, "off", "no flag");
    assert.strictEqual((await st({ permission: "denied" })).state, "blocked");
    assert.strictEqual((await st({ noSW: true })).state, "unsupported");
    const ios = await st({ ua: UA_IPHONE });
    assert.deepStrictEqual([ios.state, ios.device], ["ios-home-screen", "iPhone"]);
    assert.strictEqual((await st({ ua: UA_IPHONE, standalone: true, permission: "default" })).state, "off", "iPhone Home Screen app: Enable is offered");
    let b = mkBrowser({ permission: "granted", silvisSub: EP1, silvisSubKey: KEY, lsInit: await flagOf(EP1) });
    let line = await loadClient(S, b).pushDevice.diagnose(UID, "Khan");
    assert.strictEqual(line, "Worker: active - Permission: granted - Subscribed: yes - Saved on the server: yes (1 device(s) on this account) - Signed in as: Khan");
    b = mkBrowser({ permission: "granted", silvisSub: EP1, silvisSubKey: KEY2, lsInit: await flagOf(EP1) });
    line = await loadClient(S, b).pushDevice.diagnose(UID, "Khan");
    assert.ok(/ - Server key changed: tap Reset subscription, then Enable$/.test(line), line);
    assert.ok(!/https?:|fcm|test-device|B[A-Za-z0-9_-]{40}/.test(line), "no URL / endpoint / key in the line");
    b = mkBrowser({ permission: "default" });
    line = await loadClient(S, b).pushDevice.diagnose(UID, "a read-only account");
    assert.strictEqual(line, "Worker: none - Permission: not asked - Subscribed: no - Saved on the server: no - Signed in as: a read-only account");
  });
  await check("config.js names the push RPCs and routes in one place, never `serviceWorker.ready` / getRegistration( in code, and never logs or stores an endpoint", (S) => {
    const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
    [S.config, S.helpers, S.index].forEach((t, i) => {
      assert.ok(!/serviceWorker\.ready|\.getRegistration\(/.test(code(t)), ["config.js", "helpers.js", "index-source.html"][i] + " reads serviceWorker.ready / getRegistration(");
    });
    ["save_push_subscription", "delete_push_subscription", "push_subscription_status", "?vapid=public", "?push=test"].forEach(n => {
      assert.strictEqual(S.index.indexOf(n), -1, "index-source.html names " + n + " - config.js pushDb is the one place");
      assert.ok(S.config.includes(n), "config.js names " + n);
    });
    const push = S.config.slice(S.config.indexOf("const pushDb = {"), S.config.indexOf("// ---- Call pay"));
    assert.ok(push.length > 1000, "the push block");
    assert.ok(!/console\.\w+\([^)]*(endpoint|p256dh|sub\b)/.test(push), "no console line names the endpoint / keys / subscription");
    assert.ok(!/setItem\([^)]*endpoint\)/.test(push), "localStorage never receives the endpoint");
  });

  /* ================================ [I] index-source.html ================================ */
  console.log("\n[I] index-source.html - the head keep rule, the sign-out handlers, the effects, the card");
  const headOf = (S) => { const a = S.index.indexOf('    var APP_VERSION = "'), b = S.index.indexOf("\n  </script>", a); return S.index.slice(a, b); };
  const keepCheck = (S) => {
    const head = headOf(S);
    const kA = head.indexOf("      function keepRegistration("), kB = head.indexOf("      function nukeAndReload()");
    assert.ok(kA > 0 && kB > kA, "keepRegistration / resetUnregisters in the head script");
    const lib = new Function(head.slice(kA, kB) + "\nreturn { keepRegistration, resetUnregisters };")();
    const R = (scope, script) => ({ scope, active: { scriptURL: script }, waiting: null, installing: null });
    assert.strictEqual(lib.resetUnregisters(R(SIL, SIL + "sw.js"), SIL), false, "the Silvis push worker is KEPT by the update reset");
    assert.strictEqual(lib.resetUnregisters(R(SIL, SIL + "sw.js?v=2026.10.03a"), SIL), false, "... also with a query");
    assert.strictEqual(lib.resetUnregisters(R(SIL + "x/", SIL + "x/sw.js"), SIL), true, "a sw.js in a SUBfolder scope still goes");
    assert.strictEqual(lib.resetUnregisters(R(SIL, SIL + "old-sw.js"), SIL), true, "another Silvis-scoped script still goes");
    assert.strictEqual(lib.resetUnregisters(R(LIVE, LIVE + "OneSignalSDKWorker.js"), SIL), false, "Davenport's root worker is outside the folder");
  };
  await check("head script (lifted and run): the update reset keeps <folder>sw.js (with or without a query), still unregisters a sw.js in a subfolder scope and other Silvis-scoped scripts, and never touches the origin root", keepCheck);
  const between = (S, a, b) => { const i = S.index.indexOf(a); const j = S.index.indexOf(b, i + a.length); assert.ok(i > 0 && j > i, "could not lift " + a.trim().slice(0, 60)); return S.index.slice(i, j); };
  const liftHandler = (S, start) => {
    const i = S.index.indexOf(start);
    assert.ok(i > 0, "no " + start.trim());
    const j = S.index.indexOf("\n  };\n", i);
    return S.index.slice(i + start.length - "async () => {".length, j + 4).replace(/;\s*$/, "");
  };
  const runLifted = (src, scope) => {
    const sc = new Proxy(scope, { has: (t, k) => typeof k === "string" && (k in t || /^set[A-Z]/.test(k)), get: (t, k) => (k in t ? t[k] : /^set[A-Z]/.test(String(k)) ? () => {} : undefined) });
    return new Function("__s", "with (__s) { return (" + src + "); }")(sc);
  };
  const signOutCheck = async (S) => {
    const b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }) } });
    const c = loadClient(S, b);
    const authStub = { signOut: async () => { b.log.push("auth.signOut"); }, getSession: () => ({ access_token: fakeJwt(UID) }) };
    const base = { pushDevice: c.pushDevice, auth: authStub, biometric: { unenroll() {} }, clearWriteRetryTimers() {}, dismissToast() {}, pushArmedRef: { current: UID }, console: quiet, jwtClaims: c.jwtClaims };
    const hs = runLifted(liftHandler(S, "  const handleSignOut = async () => {"), Object.assign({ authUser: { id: UID } }, base));
    await hs();
    const seq = b.log.filter(l => /delete_push_subscription|^unsubscribe|auth\.signOut/.test(l));
    assert.deepStrictEqual(seq, ["fetch POST rpc/delete_push_subscription", "unsubscribe device-1", "auth.signOut"], "handleSignOut: the push row, then the unsubscribe, then auth.signOut(): " + b.log.join(" | "));
    // signOutForLink: the account is the stored session's when nobody was adopted yet (authUser null)
    const b2 = mkBrowser({ permission: "granted", silvisSub: EP1 });
    const c2 = loadClient(S, b2);
    const auth2 = { signOut: async () => { b2.log.push("auth.signOut"); }, getSession: () => ({ access_token: fakeJwt(UID) }) };
    const hl = runLifted(liftHandler(S, "  const signOutForLink = async () => {"), Object.assign({}, base, { pushDevice: c2.pushDevice, auth: auth2, jwtClaims: c2.jwtClaims, authUser: null, pendingLinkRef: { current: { access_token: "x" } }, adoptLinkSession: async () => { b2.log.push("adoptLinkSession"); return {}; } }));
    await hl();
    assert.deepStrictEqual(b2.log.filter(l => /delete_push_subscription|^unsubscribe|auth\.signOut|adoptLinkSession/.test(l)), ["fetch POST rpc/delete_push_subscription", "unsubscribe device-1", "auth.signOut", "adoptLinkSession"], "signOutForLink: the stored session's push row and subscription go before its sign-out: " + b2.log.join(" | "));
  };
  await check("handleSignOut and signOutForLink (lifted and run against the real pushDevice): the device's push row is deleted, THEN unsubscribed, BEFORE auth.signOut()", signOutCheck);
  // review 10/3: the third sign-out (after a password update) tears the device's push down too
  const pwSignOutCheck = async (S) => {
    const b = mkBrowser({ permission: "granted", silvisSub: EP1, lsInit: { ["silvis-push-on-" + UID]: JSON.stringify({ v: 1, ep: await sha16(EP1), at: "t" }) } });
    const c = loadClient(S, b);
    const authStub = { signOut: async () => { b.log.push("auth.signOut"); }, getSession: () => ({ access_token: fakeJwt(UID) }) };
    const base = { pushDevice: c.pushDevice, auth: authStub, pushArmedRef: { current: UID }, console: quiet, jwtClaims: c.jwtClaims, authUser: null };
    const fn = runLifted(liftHandler(S, "  const signOutAfterPasswordUpdate = async () => {"), base);
    await fn();
    assert.deepStrictEqual(b.log.filter(l => /delete_push_subscription|^unsubscribe|auth\.signOut/.test(l)), ["fetch POST rpc/delete_push_subscription", "unsubscribe device-1", "auth.signOut"], "the stored session's push row, then the unsubscribe, then auth.signOut(): " + b.log.join(" | "));
    assert.strictEqual(b.ls.getItem("silvis-push-on-" + UID), null, "the on-device flag is cleared");
    const snp = between(S, "  const submitNewPassword = () => {", "\n  };\n");
    assert.ok(snp.includes("signOutAfterPasswordUpdate();") && !/auth\.signOut\(/.test(snp), "submitNewPassword signs out only through signOutAfterPasswordUpdate (no bare auth.signOut())");
    assert.strictEqual(S.index.split("auth.signOut()").length - 1, 3, "three sign-out calls, each behind a push teardown (handleSignOut, signOutForLink, signOutAfterPasswordUpdate)");
  };
  await check("the sign-out after a password update (signOutAfterPasswordUpdate, lifted and run): the device's push row deleted, THEN unsubscribed, BEFORE auth.signOut() - review 10/3", pwSignOutCheck);
  // review 10/3 (addendum item 5): Periods > Remind with e-mail off + push on still sends; the row's button by channel
  const liftConst = (S, decl) => {
    const i = S.index.indexOf(decl);
    assert.ok(i > 0, "no " + decl.trim());
    const j = S.index.indexOf("\n  };\n", i);
    return S.index.slice(i + decl.length, j + 4).replace(/;\s*$/, "");
  };
  const remindRunCheck = async (S) => {
    const H = loadHelpers(S.helpers);
    const run = async (prefs, answer) => {
      const calls = [], toasts = [];
      let notes = {};
      const scope = {
        isScheduler: true, offerPoolIds: () => ["s1", "s2", "s3"], surgeons: [], notifPrefs: prefs, remindChannels: H.remindChannels, remindOutcome: H.remindOutcome,
        showToast: (m, k) => toasts.push([k, m]), setPrdRemind: (f) => { notes = f(notes); }, nameOf: (id) => ({ s1: "Khan", s2: "Burchett" })[id] || id,
        offerHeadsUpWords: () => ({ subject: "Heads-up", body: "Body" }), groupRules: {}, OP_PERIOD_DEFAULTS: { remindDaysBeforeClose: [14, 3] }, mySurgeon: "s1",
        window: { location: { origin: "https://x.test", pathname: "/" } }, console: quiet,
        sendEmailNotif: async (type, data, ids) => { calls.push({ type, ids }); return answer; },
      };
      const fn = runLifted(liftConst(S, "  const remindOffers = "), scope);
      const r = await fn({ id: "per-1", label: "Q1", offers_close_at: "2026-11-23" }, "s2");
      return { r, calls, toasts, note: (notes["per-1:s2"] || {}).note || "" };
    };
    const PUSHED = { ok: true, sent: 0, failed: 0, skippedPrefOff: 1, push: { sent: 1, failed: 0, removed: 0, skipped_no_device: 0, skipped_pref_off: 0, error: null } };
    let x = await run({ s2: { person_id: "s2", schedule_updates_email: false, schedule_updates_push: true } }, PUSHED);
    assert.deepStrictEqual(x.calls, [{ type: "offers_reminder", ids: ["s2"] }], "e-mail off + push on: ONE send-notification offers_reminder to [s2] (the push goes)");
    assert.ok(/^pushed .+ \(e-mail off\)$/.test(x.note) && x.toasts.length === 1 && x.toasts[0][0] === "success", "the row reads 'pushed <time> (e-mail off)', a success toast: " + JSON.stringify(x));
    x = await run({ s2: { person_id: "s2", schedule_updates_email: false, schedule_updates_push: false } }, PUSHED);
    assert.ok(x.calls.length === 0 && x.r && x.r.prefOff === true && x.note === "e-mail and phone off - not sent", "both off: nothing sent: " + JSON.stringify(x));
    x = await run({ s2: { person_id: "s2", schedule_updates_email: false } }, PUSHED);
    assert.strictEqual(x.calls.length, 0, "e-mail off and no push column (the migration not applied): nothing sent");
    x = await run({}, { ok: true, sent: 1, failed: 0, skippedPrefOff: 0, push: null });
    assert.ok(x.calls.length === 1 && /^reminded /.test(x.note), "no prefs row: e-mailed, 'reminded <time>'");
    // the row's button: disabled only when both are off; its label / title by channel (the real expressions, run)
    const at = S.index.indexOf("const ch = remindChannels(notifPrefs && notifPrefs[r.id]);");
    assert.ok(at > 0, "the Periods row computes its channels with remindChannels");
    const bAt = S.index.indexOf('data-testid="prd-remind"', at), btn = S.index.slice(bAt, S.index.indexOf("</button>", bAt));
    const dm = /disabled=\{([^}]*)\}/.exec(btn);
    assert.ok(dm && btn.includes("title={rw.title}") && btn.includes('{rs && rs.note === "sending" ? "Sending" : rw.label}') && btn.includes("opacity: ch.blocked ? 0.5 : 1"), "the button's title / label / dimming read the channel words: " + btn.slice(0, 300));
    const disabled = (prefs) => !!new Function("busy", "ch", "rs", "return " + dm[1])(false, H.remindChannels(prefs.s2), undefined);
    assert.strictEqual(disabled({ s2: { schedule_updates_email: false, schedule_updates_push: true } }), false, "e-mail off + push on: Remind enabled");
    assert.strictEqual(disabled({ s2: { schedule_updates_email: false, schedule_updates_push: false } }), true, "both off: Remind disabled");
    assert.strictEqual(disabled({ s2: {} }), false, "no flags: enabled");
    assert.ok(!/schedule_updates_email === false/.test(liftConst(S, "  const remindOffers = ")), "remindOffers has no e-mail-only gate left");
    const send = between(S, "  const sendEmailNotif = useCallback(", "  }, []);");
    assert.ok(send.includes('push: result && result.push && typeof result.push === "object" ? result.push : null'), "sendEmailNotif hands the push summary back");
  };
  await check("Periods Remind (remindOffers lifted and run; the row's disabled expression run): e-mail off + push on sends ONE offers_reminder and reads 'pushed <time> (e-mail off)'; blocked only when both channels are off - review 10/3", remindRunCheck);
  // review 10/3: a notification tap on an open window asks before it drops the day editor's dirty draft
  const draftGuardCheck = (S) => {
    const H = loadHelpers(S.helpers);
    const keep = liftConst(S, "  const pushTapKeepsDraft = ");
    const drop = liftConst(S, "  const pushTapDropDraft = "); // fix/painter-dark-mode merge (10/3): the drop waits for spec F's setView
    const a = S.index.indexOf("    const onMsg = (e) => {"), b = S.index.indexOf("\n    };\n", a);
    assert.ok(a > 0 && b > a, "the sw message handler onMsg");
    const msgSrc = S.index.slice(a + "    const onMsg = ".length, b + 6);
    const Q = "confirm Discard your unsaved changes to this day?";
    const mk = (editorDay, dirty, answer) => {
      const log = [];
      const scope = {
        editorDayRef: { current: editorDay }, editorDirtyRef: { current: dirty }, pushTapLeavesDraft: H.pushTapLeavesDraft, pushOpenMessage: H.pushOpenMessage, console: quiet,
        confirm: (m) => { log.push("confirm " + m); return answer; }, showToast: (m, k) => log.push("toast " + k),
        setEditorDay: (v) => log.push("setEditorDay " + v), setView: (v) => log.push("setView " + v), setPushDay: (v) => log.push("setPushDay " + (v && v.day)),
      };
      scope.pushTapKeepsDraft = runLifted(keep, scope);
      scope.pushTapDropDraft = runLifted(drop, scope);
      return { onMsg: runLifted(msgSrc, scope), log, scope };
    };
    const ev = (tab, day) => ({ data: { type: "silvis-push-open", tab, day } });
    let m = mk("2026-10-04", true, false); m.onMsg(ev("timeoff", null));
    assert.deepStrictEqual(m.log, [Q, "toast info"], "dirty draft + a tap to Time off + Cancel: the editor's question, nothing switches");
    assert.strictEqual(m.scope.editorDirtyRef.current, true, "Cancel keeps the dirty flag");
    // pin moved deliberately 10/3 (fix/painter-dark-mode merge): on OK the view switches first and the editor closes right after
    // it, in the same handler (one React batch - the same render as before); the drop waits for setView's answer, so spec F's
    // Cancel (an APP's unsaved My APP days) keeps the day draft as well - test/data-layer.test.js [PD] "PD F x P30" runs both
    m = mk("2026-10-04", true, true); m.onMsg(ev("timeoff", null));
    assert.deepStrictEqual(m.log, [Q, "setView timeoff", "setEditorDay null"], "OK: the view switches, then the editor closes");
    assert.strictEqual(m.scope.editorDirtyRef.current, false, "the dirty flag is cleared with the discard");
    m = mk("2026-10-04", true, false); m.onMsg(ev("calendar", "2026-10-07"));
    assert.deepStrictEqual(m.log, [Q, "toast info"], "another day + Cancel: nothing moves");
    m = mk("2026-10-04", true, true); m.onMsg(ev("calendar", "2026-10-07"));
    assert.deepStrictEqual(m.log, [Q, "setView calendar", "setEditorDay null", "setPushDay 2026-10-07"], "another day + OK: switched, closed, then the day is queued");
    [["calendar", "2026-10-04", ["setView calendar", "setPushDay 2026-10-04"]], ["calendar", null, ["setView calendar"]], ["openshifts", null, ["setView openshifts"]]].forEach(([tab, day, want]) => {
      const n = mk("2026-10-04", true, false); n.onMsg(ev(tab, day));
      assert.deepStrictEqual(n.log, want, "no question when the draft stays (" + tab + " " + day + ")");
    });
    m = mk("2026-10-04", false, false); m.onMsg(ev("timeoff", null));
    assert.deepStrictEqual(m.log, ["setView timeoff"], "a clean editor: no question");
    const eff = between(S, "  useEffect(() => {\n    if (!loaded || !pushDay) return;", "  }, [loaded, pushDay]);");
    const iK = eff.indexOf('if (pushTapKeepsDraft({ tab: "calendar", day: d })) return;');
    assert.ok(iK > 0 && iK < eff.indexOf("goToDay(d);"), "the queued day passes the same guard before goToDay");
    const de = S.index.slice(S.index.indexOf("function DayEditor(props) {"), S.index.indexOf("const requestClose = () => {", S.index.indexOf("function DayEditor(props) {")));
    assert.ok(de.includes('React.useEffect(() => { if (typeof onDirtyChange === "function") onDirtyChange(dirty); }, [dirty]);') && de.includes('React.useEffect(() => () => { if (typeof onDirtyChange === "function") onDirtyChange(false); }, []);'), "the DayEditor reports its dirty flag (and false on unmount)");
    assert.ok(S.index.includes("onDirtyChange={(d) => { editorDirtyRef.current = !!d; }}") && S.index.includes("editorDayRef.current = editorDay;"), "the parent keeps the refs the handler reads");
  };
  await check("a tap on an open window (onMsg + pushTapKeepsDraft lifted and run): a dirty day draft is never dropped silently - the editor's own question, Cancel keeps it, OK closes it first - review 10/3", draftGuardCheck);
  await check("source pins: the re-arm effect (once per account, isPublicMode-guarded, never requestPermission), the deep link (pushDeepLink once + history.replaceState, isPublicMode-guarded), the sw message listener, adoptSignedInUser's dropForeign, the card's testids and words, the manual_edit day, the corrected addNotification comment", (S) => {
    const idx = S.index;
    const rearm = between(S, "  // Re-arm on start (Cowork 10/2 7:25 PM)", "  // A different account: its own column probe");
    assert.ok(/if \(isPublicMode \|\| !pushUid/.test(rearm) && rearm.includes("pushDevice.rearm(uid, pushDevice.label())") && rearm.includes("pushArmedRef.current === pushUid"), "the re-arm effect");
    assert.ok(!/requestPermission/.test(rearm), "the re-arm effect never asks for permission");
    const link = between(S, "  // The tap target (helpers.pushDeepLink)", "  // An app window that is already open");
    assert.ok(link.includes("if (isPublicMode || !pushLinkReady || pushLinkDoneRef.current) return;") && link.includes("isScheduler === (userProfile.role === \"scheduler\" || userProfile.role === \"admin\")") && link.includes("pushLinkDoneRef.current = true;") && link.includes("pushDeepLink(window.location.search)") && link.includes("window.history.replaceState(null, \"\", window.location.pathname + r.search + window.location.hash)"), "the deep link is read once, stripped with replaceState, never on ?public=1");
    const msg = between(S, "  // An app window that is already open", "  const pushName = () => {");
    assert.ok(msg.includes("pushOpenMessage(e && e.data)") && msg.includes("sw.addEventListener(\"message\", onMsg)") && msg.includes("sw.removeEventListener(\"message\", onMsg)") && /if \(isPublicMode \|\| !pushUid\) return;/.test(msg), "the sw message listener (whitelisted, removed on cleanup, never on ?public=1)");
    assert.ok(msg.includes("goToDay(d)"), "a day opens through goToDay (its own unread-schedule refusal)");
    const adopt = between(S, "  const adoptSignedInUser = async (user) => {", "  // --- Auth: Check session on mount ---");
    assert.ok(adopt.indexOf("pushDevice.dropForeign(user.id)") > adopt.indexOf("if (lastAuthUidRef.current && user && lastAuthUidRef.current !== user.id) {") && adopt.indexOf("pushDevice.dropForeign(user.id)") < adopt.indexOf("if (user) lastAuthUidRef.current = user.id;"), "dropForeign in the different-account branch");
    ["push-card", "push-badge", "push-line", "push-state", "push-enable", "push-disable", "push-diagnose", "push-reset", "push-test", "push-msg", "push-prefs", "push-pref", "push-prefs-unavailable", "push-prefs-none"].forEach(t => assert.ok(idx.includes('data-testid="' + t + '"') || idx.includes("pbtn(\"" + t + "\""), "testid " + t));
    assert.ok(idx.includes('"Turn this on once on each device you want alerts on. iPhone / iPad: first Share > Add to Home Screen, then open the app from that icon."'), "the card's one line");
    ["Which events reach your phones", "Schedule published, open shifts, changes affecting me", "Schedule published, open shifts, shifts taken", "These cover every device you turned on. Reminders stay e-mail only for now.", "Phone switches are available after the next update."].forEach(w => assert.ok(idx.includes(w), w));
    const at = idx.indexOf('data-testid="push-card"'), before = idx.slice(0, at);
    assert.ok(before.lastIndexOf("{view===") === before.lastIndexOf('{view==="settings" && !isPublicMode && <>') && before.lastIndexOf("openSettingsCards.") === before.lastIndexOf("openSettingsCards.notifSettings && <>"), "the card sits in Settings > Notification settings (never on ?public=1)");
    assert.ok(idx.indexOf('data-testid="push-card"') < idx.indexOf('<div style={{fontSize:12,fontWeight:600,color:dkText,marginBottom:6}}>Email</div>'), "the Phone notifications box is the first box, above Email");
    assert.ok(idx.includes('sendEmailNotif("manual_edit", { message: msg, subject: "Schedule changed - " + fmtMD(day), day }, affected);'), "saveDayEdit's manual_edit mail carries the day");
    assert.ok(!idx.includes("No device push in this app"), "the addNotification comment is corrected");
    assert.ok(/^[\x00-\x7F]*$/.test(idx), "index-source.html stays pure ASCII");
  });

  /* ================================ [M] mutants ================================ */
  console.log("\n[M] mutants (contract section 5) - each must turn its check red");
  await mutant("keepRegistration without the sw.js rule", "index",
    `          if (scriptURLs[i].split("#")[0].split("?")[0] === silvisBase + "sw.js") return true; // Prompt 30: Silvis's own push worker\n`, "", keepCheck);
  await mutant("rearm calling requestPermission", "config",
    "    const flag = pushDevice._readFlag(profileId);\n    try {\n      let reg = await pushDevice.registration(false);",
    "    const flag = pushDevice._readFlag(profileId);\n    try {\n      await e.N.requestPermission();\n      let reg = await pushDevice.registration(false);", rearmCheck);
  await mutant("rearm prompting when permission is not granted", "config",
    `    if (e.N.permission !== "granted") return { action: "off-permission" };`,
    `    if (e.N.permission !== "granted") { await e.N.requestPermission(); return { action: "off-permission" }; }`, rearmCheck);
  await mutant("teardown unsubscribing before the delete", "config",
    `        try { await pushDb.remove(String(sub.endpoint || "")); } catch (x) { /* never blocks the sign-out */ }\n        try { await sub.unsubscribe(); } catch (x) { /* never blocks the sign-out */ }`,
    `        try { await sub.unsubscribe(); } catch (x) { /* never blocks the sign-out */ }\n        try { await pushDb.remove(String(sub.endpoint || "")); } catch (x) { /* never blocks the sign-out */ }`, teardownCheck);
  await mutant("handleSignOut signing out before the push teardown", "index",
    `    if (authUser && authUser.id) { try { await pushDevice.teardown(authUser.id, 4000); } catch (e) { console.warn("push teardown at sign-out failed (signing out anyway):", e); } }\n    setPushInfo(null); setPushMsg(""); setPushNeedsTap(false); pushArmedRef.current = "";\n    await auth.signOut();`,
    `    await auth.signOut();\n    if (authUser && authUser.id) { try { await pushDevice.teardown(authUser.id, 4000); } catch (e) { console.warn("push teardown at sign-out failed (signing out anyway):", e); } }\n    setPushInfo(null); setPushMsg(""); setPushNeedsTap(false); pushArmedRef.current = "";`, signOutCheck);
  await mutant("sw.js returning without showNotification on bad JSON", "sw",
    "    v = pushView(null); // not JSON, or no data at all: the generic notification", "    return;", swShowCheck);
  await mutant("notificationclick opening data.url", "sw",
    `  const url = new URL("./" + (tab ? "?tab=" + tab + (day ? "&day=" + day : "") : ""), scope).href;`,
    `  const url = d.url || new URL("./" + (tab ? "?tab=" + tab + (day ? "&day=" + day : "") : ""), scope).href;`, swClickCheck);
  await mutant("registration() using navigator.serviceWorker.ready", "config",
    "    const regs = await sw.getRegistrations();\n    let reg = Array.from(regs || []).find(ours) || null;",
    "    let reg = await sw.ready;", regCheck);
  await mutant("the deep link not stripped", "helpers",
    `  const strip = p.has("tab") || p.has("day");`, `  const strip = false;`, deepLinkCheck);
  await mutant("the blocked words without the hostname", "helpers",
    `    return { badge: "Blocked", line: "Blocked for " + host + (host === "fkhan628.github.io" ? " - this also affects the Davenport app" : "") + ". To allow`,
    `    return { badge: "Blocked", line: "Blocked" + (host === "fkhan628.github.io" ? " - this also affects the Davenport app" : "") + ". To allow`, wordsCheck);
  await mutant("enable asking the server before the permission prompt", "config",
    "    // (2) the permission FIRST - nothing is awaited before it\n    let perm;",
    "    // (2) the permission FIRST - nothing is awaited before it\n    await pushDb.publicKey();\n    let perm;", enableCheck);
  await mutant("the save body without p_label", "config",
    `{ p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_label: label || null }`, `{ p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }`, enableCheck);
  // review 10/3 fixes - each check must turn red when its fix is undone
  await mutant("Remind refused on e-mail off alone (the pre-fix gate in remindOffers)", "index",
    "    if (ch.blocked) {\n      showToast(`${nameOf(personId)} has schedule-update e-mails and phone notifications turned off",
    "    if (ch.mailOff) {\n      showToast(`${nameOf(personId)} has schedule-update e-mails and phone notifications turned off", remindRunCheck);
  await mutant("the Remind button disabled on e-mail off alone", "index",
    "disabled={busy || ch.blocked || (rs && rs.note === \"sending\")}", "disabled={busy || ch.mailOff || (rs && rs.note === \"sending\")}", remindRunCheck);
  await mutant("remindChannels blocking on e-mail off alone", "helpers",
    "blocked: mailOff && pushOff,", "blocked: mailOff,", remindHelpersCheck);
  await mutant("sendEmailNotif dropping the push summary (a pushed reminder would read 'No reminder went out')", "index",
    ", push: result && result.push && typeof result.push === \"object\" ? result.push : null };", " };", remindRunCheck);
  await mutant("onMsg without the draft guard", "index",
    "      if (pushTapKeepsDraft(r)) return;\n      if (!setView(r.tab)) return;", "      if (!setView(r.tab)) return;", draftGuardCheck);
  // retargeted 10/3 (fix/painter-dark-mode merge): the close moved out of pushTapKeepsDraft into pushTapDropDraft (after setView)
  await mutant("the tap switching without closing the editor (pushTapDropDraft dropping nothing)", "index",
    "    editorDirtyRef.current = false;\n    editorDayRef.current = null;\n    setEditorDay(null);\n  };", "  };", draftGuardCheck);
  await mutant("onMsg without the drop after the switch", "index",
    "      if (!setView(r.tab)) return; // spec F: Cancel on the unsaved-APP-days question - no day queued, the day draft untouched\n      pushTapDropDraft(r);\n",
    "      if (!setView(r.tab)) return; // spec F: Cancel on the unsaved-APP-days question - no day queued, the day draft untouched\n", draftGuardCheck);
  await mutant("pushTapLeavesDraft ignoring another day", "helpers",
    "  return !!target.day && target.day !== editorDay;", "  return false;", tapDraftCheck);
  await mutant("pushIsDay regex-only (an impossible date opens)", "helpers",
    "  return dt.getUTCFullYear() === Number(m[1]) && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);\n};",
    "  return true;\n};", realDayCheck);
  await mutant("the password-update sign-out without the push teardown", "index",
    "    if (uid) { try { await pushDevice.teardown(uid, 4000); } catch (e) { console.warn(\"push teardown after the password update failed (signing out anyway):\", e); } }\n", "", pwSignOutCheck);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("test runner crashed:", e); process.exit(1); });
