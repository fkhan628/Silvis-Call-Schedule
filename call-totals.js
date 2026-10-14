// call-totals.js - "My call - Silvis + Davenport" (Prompt 31 Part B, Faraz 10/9): the counter behind the call-totals
// card of the signed-in East-code surgeon (Khan today), in Mine. Classic browser script, loaded LAST in
// index-source.html's ?v= loader list - after helpers.js, which provides fmt / parse / addD (byte-identical to the
// Davenport app's), and after east-feed.js. It declares none of them: a second declaration in the page's one global
// scope is a SyntaxError and this module would never load (test/call-totals.test.js T1 and data-layer P31B pin it).
// Node: load it in ONE vm context after helpers.js, as test/call-totals.test.js does; require() alone returns the
// functions, but their fmt / parse / addD are then undefined.
//
// PORTED VERBATIM from the Davenport app (github.com/fkhan628/Call-Schedule-App) at commit eff3b81
// (2026-10-11 02:05 -0500, "Totals card review fixes: labels in days, ... parity contract, stronger guards"), read
// with `git show eff3b81:<path>` in the davenport-ref clone at HEAD bb07a0b (no ported line changed after eff3b81):
//   helpers.js:66-81 weekBillingCredits, helpers.js:107-122 callTotalPeriods, helpers.js:141-191 callTotalsFor,
//   config.js:380 NIGHT_KEYS.
// The Davenport PARITY CONTRACT (its helpers.js:83-99) asks for exactly this module. The NIGHT_KEYS line and the three
// bodies between the verbatim markers are byte-identical to the eff3b81 blobs: test/call-totals.test.js pins their
// sha256 (T2), runs the Davenport session's own fixture (test/fixtures/call-totals-card-synthetic-2026-10-14.json,
// copied byte for byte - T3) and, beside a davenport-ref clone, runs the Davenport app's own counter at eff3b81 on the
// same inputs (T9). NEVER edit them here: a change is made in the Davenport app first and re-ported, with this header's
// commit and the test's digests updated together - one counting definition for both cards (Prompt 31 item 11).
// Units are the Davenport app's Stats > Billing days (weekBillingCredits: each day of a service week, each weeknight,
// Fri + Sat + Sun for a weekend, 2 days for a covered holiday); a backup week counts through the same function, as
// backup roles. Silvis: one 07:00-07:00 day = 1. The weighted total's 0.5 for every backup role is the counter's own
// (Faraz 10/9), never Setup's shift weights - the two cards must agree. `today` is passed in: the card hands it the
// DEVICE date (the parity contract's decision of 2026-10-11), never the Central date.
// The Davenport doc comments above each function are not copied (they are not ASCII); the bodies are.

// ---- verbatim (eff3b81) ----
const NIGHT_KEYS = ["mon","tue","wed","thu"];

function weekBillingCredits(mondayStr, wk) {
  if (!wk || wk.isBackup) return [];
  const mon = parse(mondayStr);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => fmt(addD(mon, i)));
  const covered = {};
  Object.entries(wk.holidayCoverage || {}).forEach(([ds, cov]) => {
    if (cov && cov.surgeonId && cov.type !== "swap" && days.includes(ds)) covered[ds] = cov.surgeonId;
  });
  const credits = [];
  const add = (ds, sid, kind) => { if (sid && !covered[ds]) credits.push({ ds, sid, kind, n: 1 }); };
  if (wk.dayCall) days.forEach(ds => add(ds, (wk.dayCallOverrides && wk.dayCallOverrides[ds]) || wk.dayCall, "dc"));
  NIGHT_KEYS.forEach((sk, i) => add(days[i], wk.nights?.[sk], "nights"));
  if (wk.nights?.wknd) [4, 5, 6].forEach(i => add(days[i], wk.nights.wknd, "wknd"));
  Object.entries(covered).forEach(([ds, sid]) => credits.push({ ds, sid, kind: "hol", n: 2 }));
  return credits;
}

function callTotalPeriods(today) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || fmt(parse(today)) !== today) return null;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), d = Number(today.slice(8, 10));
  const p2 = (n) => String(n).padStart(2, "0");
  const lastDay = (yy, mm) => new Date(yy, mm, 0).getDate(); // mm is 1-based: day 0 of the next month
  const months = [];
  for (let mm = 1; mm <= 12; mm++) months.push({ month: `${y}-${p2(mm)}`, from: `${y}-${p2(mm)}-01`, to: `${y}-${p2(mm)}-${p2(lastDay(y, mm))}` });
  const back = `${y - 1}-${p2(m)}-${p2(Math.min(d, lastDay(y - 1, m)))}`;
  return {
    month: { from: months[m - 1].from, to: months[m - 1].to },
    ytd: { from: `${y}-01-01`, to: today },
    year: { from: `${y}-01-01`, to: `${y}-12-31` },
    rolling12: { from: fmt(addD(parse(back), 1)), to: today },
    months,
  };
}

function callTotalsFor(input) {
  const inp = input || {};
  const want = String(inp.code || "").trim().toUpperCase();
  if (!want) return { ok: false, error: "no roster code to count" };
  const periods = callTotalPeriods(inp.today);
  if (!periods) return { ok: false, error: `not a date: ${JSON.stringify(inp.today)}` };
  const who = (inp.roster || []).find(s => s && String(s.name || "").toUpperCase() === want);
  if (!who || !who.id) return { ok: false, error: `no roster entry for code ${want}` };
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;
  const items = []; // every dated credit of this person: { ds, kind, n }
  let dsgFrom = null, dsgTo = null, silvisFrom = null, silvisTo = null;
  Object.keys(inp.weeks || {}).sort().forEach(mStr => {
    const wk = inp.weeks[mStr];
    if (!wk || typeof wk !== "object" || !isDay(mStr)) return;
    if (!dsgFrom) dsgFrom = mStr;
    dsgTo = fmt(addD(parse(mStr), 6));
    const backup = !!wk.isBackup;
    weekBillingCredits(mStr, backup ? Object.assign({}, wk, { isBackup: false }) : wk).forEach(c => {
      if (c.sid === who.id) items.push({ ds: c.ds, kind: backup ? c.kind + "B" : c.kind, n: c.n });
    });
  });
  const seenP = {}, seenB = {};
  (inp.silvisRows || []).forEach(r => {
    if (!r || !isDay(r.day)) return;
    if (!silvisFrom || r.day < silvisFrom) silvisFrom = r.day;
    if (!silvisTo || r.day > silvisTo) silvisTo = r.day;
    if (!seenP[r.day] && String(r.primary_code || "").toUpperCase() === want) { seenP[r.day] = true; items.push({ ds: r.day, kind: "silvisP", n: 1 }); }
    if (!seenB[r.day] && String(r.backup_code || "").toUpperCase() === want) { seenB[r.day] = true; items.push({ ds: r.day, kind: "silvisB", n: 1 }); }
  });
  const KINDS = ["dc", "nights", "wknd", "hol", "dcB", "nightsB", "wkndB", "holB", "silvisP", "silvisB"];
  const tally = (from, to) => {
    const zero = () => { const o = {}; KINDS.forEach(k => { o[k] = 0; }); return o; };
    const worked = zero(), scheduled = zero();
    items.forEach(it => { if (it.ds >= from && it.ds <= to) (it.ds <= inp.today ? worked : scheduled)[it.kind] += it.n; });
    const sums = (o) => {
      o.dsg = o.dc + o.nights + o.wknd + o.hol;
      o.dsgB = o.dcB + o.nightsB + o.wkndB + o.holB;
      o.total = o.dsg + o.dsgB + o.silvisP + o.silvisB;
      o.weighted = o.dsg + o.silvisP + (o.dsgB + o.silvisB) / 2;
      return o;
    };
    return { from, to, worked: sums(worked), scheduled: sums(scheduled) };
  };
  const P = periods;
  return {
    ok: true, code: want, sid: who.id, today: inp.today,
    range: { dsgFrom, dsgTo, silvisFrom, silvisTo },
    periods: { month: tally(P.month.from, P.month.to), ytd: tally(P.ytd.from, P.ytd.to), year: tally(P.year.from, P.year.to), rolling12: tally(P.rolling12.from, P.rolling12.to) },
    months: P.months.map(p => Object.assign({ month: p.month }, tally(p.from, p.to))),
  };
}
// ---- end verbatim ----

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NIGHT_KEYS, weekBillingCredits, callTotalPeriods, callTotalsFor };
}
