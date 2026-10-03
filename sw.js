// Silvis Call - push worker (Prompt 30). Scope: the app folder. No fetch handler, no caching.
//
// Faraz 10/2: "Davenport's look, Silvis's own push" - Web Push with VAPID, no OneSignal. This worker lives in the Silvis
// folder (registered by config.js pushDevice with scope = the folder, e.g. /Silvis-Call-Schedule/); Davenport's OneSignal
// worker stays at the origin root and the two never meet. It does exactly two things:
//   push              - ALWAYS shows a notification. iOS drops a subscription that receives silent pushes, so a payload that
//                       is missing, unreadable or malformed shows the generic "Silvis Call - Open the app for details."
//                       instead of returning without one.
//   notificationclick - opens the app on a whitelisted view: ./?tab=<view>[&day=YYYY-MM-DD], built HERE from the
//                       notification's own tab / day (re-validated), relative to this worker's scope - never a URL taken
//                       from the payload. An app window that is already open is focused and told by postMessage (no
//                       reload - an unsaved day edit survives); only when none is open does a new window open.
// No fetch handler: the app's version check and cache-busting stay exactly as they are (index-source.html's head script),
// and the update reset keeps this registration (its keep-predicate names this file).
"use strict";
const PUSH_TABS = ["calendar", "openshifts", "myschedule", "timeoff", "settings", "setup"];
const GENERIC = { title: "Silvis Call", body: "Open the app for details." };
const TAG_RE = /^silvis-[a-z0-9-]{1,60}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The notification a payload asks for, or the generic one. Payload contract (edge @pushPlan): { v: 1, title, body, tag, tab,
// params?: { day } } - never a url key; anything else here is ignored.
function pushView(p) {
  const out = { title: GENERIC.title, body: GENERIC.body, tag: "silvis-generic", tab: null, day: null };
  if (!p || typeof p !== "object" || p.v !== 1) return out;
  const titleOk = typeof p.title === "string" && p.title.length >= 1 && p.title.length <= 80;
  const bodyOk = typeof p.body === "string" && p.body.length >= 1 && p.body.length <= 300;
  if (titleOk && bodyOk) { out.title = p.title; out.body = p.body; }
  if (typeof p.tag === "string" && TAG_RE.test(p.tag)) out.tag = p.tag;
  if (typeof p.tab === "string" && PUSH_TABS.indexOf(p.tab) >= 0) out.tab = p.tab;
  const day = p.params && typeof p.params === "object" ? p.params.day : null;
  if (typeof day === "string" && DAY_RE.test(day)) out.day = day;
  return out;
}

function optionsOf(v) {
  return { body: v.body, tag: v.tag, renotify: true, icon: "icon-192.png", data: { tab: v.tab, day: v.day } };
}

async function show(event) {
  let v = pushView(null);
  try {
    const p = event && event.data ? event.data.json() : null;
    v = pushView(p);
  } catch (e) {
    v = pushView(null); // not JSON, or no data at all: the generic notification
  }
  try {
    await self.registration.showNotification(v.title, optionsOf(v));
  } catch (e) {
    // one more try with the generic notification (never return without showing one when the browser lets us)
    const g = pushView(null);
    try { await self.registration.showNotification(g.title, optionsOf(g)); } catch (e2) { /* permission revoked: nothing can be shown */ }
  }
}

async function openApp(data) {
  const d = data && typeof data === "object" ? data : {};
  const tab = typeof d.tab === "string" && PUSH_TABS.indexOf(d.tab) >= 0 ? d.tab : null;
  const day = tab && typeof d.day === "string" && DAY_RE.test(d.day) ? d.day : null;
  const scope = self.registration.scope;
  const url = new URL("./" + (tab ? "?tab=" + tab + (day ? "&day=" + day : "") : ""), scope).href;
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const u = String((c && c.url) || "");
    // an open app window inside this scope - not the read-only ?public=1 page, which has no views to switch to
    if (u.indexOf(scope) !== 0 || /[?&]public=1(&|#|$)/.test(u)) continue;
    try { await c.focus(); } catch (e) { /* focus refused: the message still switches the view */ }
    c.postMessage({ type: "silvis-push-open", tab: tab, day: day });
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(url);
}

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (event) { event.waitUntil(show(event)); });
self.addEventListener("notificationclick", function (event) {
  try { event.notification.close(); } catch (e) { /* already closed */ }
  event.waitUntil(openApp(event.notification ? event.notification.data : null));
});
