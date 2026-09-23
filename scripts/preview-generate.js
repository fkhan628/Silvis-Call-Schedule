#!/usr/bin/env node
/*
 * Silvis Call Schedule - Prompt 8 preview runner (Node, read-only).
 *
 * Builds the SAME rules context the app builds (live anon-readable rows: blob,
 * schedule_days, time_off, availability, east_feed, east_forecast, east_overrides),
 * runs generator.generate() for a range and writes a Markdown report + a JSON
 * dump of the candidate schedule. It never writes to the database - publishing
 * happens in the app (Setup -> Generate -> Accept & Publish) after Faraz's review.
 *
 * Usage:
 *   node scripts/preview-generate.js [--start 2026-11-02] [--end 2027-01-03]
 *        [--bestOf 200] [--seed 7] [--out docs/PREVIEW-<start>-to-<end>.md]
 *        [--backfill 2026-10-15..2026-11-01]
 *
 * --backfill A..B (Prompt 12 T, 9/22): after the milestone generate, run a
 * SECOND generate over A..B with { fillOpenOnly: true } on the same live rows
 * (independent of the milestone result) and append the section
 * "## October backfill (fill-open-only, A..B)" - per open slot of the input:
 * day, weekday, role, the placed candidate (or "open" + per-surgeon reasons)
 * and the alternatives (every active surgeon eligible for that slot on the
 * input schedule), plus the backfill's own tally delta. The JSON gains
 * backfill: { range, schedule, diagnostics, openSlots, talliesDelta }. The
 * milestone sections are unchanged (the preview-diff tool reads .schedule).
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const H = require(path.join(REPO, "helpers.js"));
const R = require(path.join(REPO, "rules.js"));
const EF = require(path.join(REPO, "east-feed.js"));
const G = require(path.join(REPO, "generator.js"));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; };
const START = opt("start", "2026-11-02");
const END = opt("end", "2027-01-03");
const BEST_OF = Number(opt("bestOf", "200"));
const SEED = Number(opt("seed", "7"));
const OUT = opt("out", path.join(REPO, "docs", `PREVIEW-${START}-to-${END}.md`));
const BACKFILL = opt("backfill", null); // "YYYY-MM-DD..YYYY-MM-DD" (Prompt 12 T)
const BACKFILL_RANGE = (() => {
  if (!BACKFILL) return null;
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(BACKFILL);
  if (!m || m[1] > m[2]) { console.error("FAIL: --backfill wants YYYY-MM-DD..YYYY-MM-DD (got " + BACKFILL + ")"); process.exit(1); }
  return { start: m[1], end: m[2] };
})();

const cfg = fs.readFileSync(path.join(REPO, "config.js"), "utf8");
const URL = (cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const ANON = (cfg.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!URL || !ANON) { console.error("FAIL: SUPABASE_URL / anon key not found in config.js"); process.exit(1); }

async function rest(pathAndQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!res.ok) throw new Error(`GET ${pathAndQuery} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`GET ${pathAndQuery} -> non-array body`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function md(s) { return String(s == null ? "" : s).replace(/\|/g, "\\|"); }

(async () => {
  const t0 = Date.now();
  const [blobRows, dayRows, timeOffRows, availabilityRows, feedRows, forecastRows, overrideRows] = await Promise.all([
    rest("call_schedule_data?id=eq.main&select=data,updated_at"),
    rest("schedule_days?select=*&order=day.asc"),
    rest("time_off?select=*&order=start_date.asc"),
    rest("availability?select=*&order=start_date.asc"),
    rest("east_feed?select=week_monday,data,fetched_at&order=week_monday.asc"),
    rest("east_forecast?select=week_monday,data,generated_at&order=week_monday.asc"),
    rest("east_overrides?select=*"),
  ]);
  const blob = (blobRows[0] && blobRows[0].data) || {};
  const roster = blob.roster || [];
  const surgeonRules = blob.surgeonRules || {};
  const groupRules = blob.groupRules || {};
  const holidays = blob.holidays || { units: {} };
  if (!roster.length || !Object.keys(surgeonRules).length) throw new Error("blob has no roster/surgeonRules - run the seed import first");
  const byCode = Object.fromEntries(roster.map(r => [r.code, r.id]));
  const nameOf = id => (roster.find(r => r.id === id) || {}).name || (id == null ? "OPEN" : id);

  // schedule map from rows (helpers.dayRowToAssignment if present, else a direct map)
  const schedule = {};
  for (const row of dayRows) {
    schedule[row.day] = typeof H.dayRowToAssignment === "function" ? H.dayRowToAssignment(row) : {
      primary: row.primary_id, backup: row.backup_id, primaryLocked: !!row.primary_locked, backupLocked: !!row.backup_locked,
      source: row.source, externalCover: row.external_cover, note: row.note,
    };
  }

  // East: derive per surgeon from rules (no name branches)
  const weeks = feedRows.map(r => ({ weekMonday: r.week_monday, data: r.data }));
  // Prompt 12 C (9/22): published > override > forecast. The forecast is pruned to
  // the weeks Davenport has NOT published (rules.js ignores it inside the coverage
  // anyway), and the east_overrides rows go to buildContext as their own input
  // (input.eastOverrides) so a busy:false override clears a forecast-busy day too.
  const eastFeedCoverage = EF.coverageOf ? EF.coverageOf(weeks) : null;
  const forecastAll = typeof EF.forecastFromFeedRows === "function" ? EF.forecastFromFeedRows(forecastRows.map(r => ({ weekMonday: r.week_monday, data: r.data }))) : {};
  const forecast = typeof EF.forecastOutsideCoverage === "function" ? EF.forecastOutsideCoverage(forecastAll, eastFeedCoverage) : forecastAll;
  const eastOverrides = typeof EF.overridesByPerson === "function" ? EF.overridesByPerson(overrideRows) : {};
  const fakIdEast = (forecastRows[0] && forecastRows[0].data && forecastRows[0].data.fakId) || null;
  const eastBusyDays = {}, eastForecast = {}, eastDerived = [];
  for (const s of roster) {
    const ef = (surgeonRules[s.id] || {}).eastFeed || {};
    if (!ef.enabled) continue;
    if (ef.eastBlocksPrimary || ef.eastBlocksBackup) {
      let eastId = s.code === "FAK" ? fakIdEast : null;
      if (!eastId) { // resolve by code from the Davenport roster (read-only)
        try { const feed = await EF.fetchEastWeeks("2026-09-28", "2026-09-28"); eastId = EF.eastResolveFakId ? EF.eastResolveFakId(feed.roster, s.code) : (feed.roster.find(r => r.name === s.code) || {}).id; } catch (e) { console.warn("East roster resolve failed:", e.message); }
      }
      if (eastId) {
        const d = EF.deriveKhanBusyDays(weeks, eastId, { eastBackupCountsAsBusy: ef.eastBackupCountsAsBusy !== false });
        eastBusyDays[s.id] = EF.applyOverrides ? EF.applyOverrides(d.busy, overrideRows, s.id) : d.busy;
      }
      if (ef.forecast) eastForecast[s.id] = forecast;
    }
    if (ef.deriveFrom || ef.statedWeeks) {
      for (const w of EF.deriveFierceWeeks(weeks, { deriveFrom: ef.deriveFrom, statedWeeks: ef.statedWeeks })) eastDerived.push({ weekMonday: w.weekMonday, surgeonId: s.id, silvisRole: w.silvisRole, source: w.source });
    }
  }
  const input = { roster, surgeonRules, groupRules, holidays, timeOffRows, availabilityRows, schedule, eastBusyDays, eastForecast, eastOverrides, eastFeedCoverage, eastDerived, rangeStart: START, rangeEnd: END };
  const ctx = R.buildContext(input);
  const t1 = Date.now();
  const result = G.generate(ctx, START, END, { seed: SEED, bestOf: BEST_OF, respectLocks: true });
  const t2 = Date.now();
  const sched = result.schedule || {};
  const dg = result.diagnostics || {};

  // ---- report
  const L = [];
  L.push(`# Generate preview ${START} -> ${END}`);
  L.push("");
  L.push(`*Generated ${new Date().toISOString()} by scripts/preview-generate.js from the LIVE rows (read-only; nothing published). seed ${SEED}, bestOf ${BEST_OF}, candidates tried ${dg.candidatesTried != null ? dg.candidatesTried : "?"}, generate() ${t2 - t1} ms, data fetch ${t1 - t0} ms. East feed coverage ${eastFeedCoverage ? eastFeedCoverage.from + ".." + eastFeedCoverage.to : "none"}; forecast rows ${forecastRows.length}; derived weeks ${eastDerived.map(d => d.weekMonday + ":" + d.silvisRole).join(", ") || "none"}.*`);
  L.push("");
  if (dg.score) { L.push("## Score"); L.push(""); L.push("```"); L.push(JSON.stringify(dg.score, null, 2)); L.push("```"); L.push(""); }

  // calendar as week rows over the merged schedule (locks + generated)
  const merged = Object.assign({}, schedule, sched);
  L.push("## Calendar (week rows, the ER-panel author's layout)"); L.push("");
  if (typeof H.buildWeekRows === "function") {
    const rows = H.buildWeekRows(merged, roster, START, END, {});
    L.push("| MON/SUN DATES | TRAUMA | TRAUMA BACKUP |"); L.push("|---|---|---|");
    for (const r of rows) {
      const cell = k => (r[k] || r[k === "primary" ? "primaryEntries" : "backupEntries"] || []).map(e => (typeof e === "string" ? e : (e.text || e.label || JSON.stringify(e)))).join("<br>");
      L.push(`| ${md(r.label || r.dates || (r.monday + " - " + r.sunday))} | ${md(cell("primary"))} | ${md(cell("backup"))} |`);
    }
  } else {
    L.push("| Day | P | B | source |"); L.push("|---|---|---|---|");
    for (const d of Object.keys(merged).filter(d => d >= START && d <= END).sort()) { const a = merged[d]; L.push(`| ${d} | ${a.externalCover ? a.externalCover : nameOf(a.primary)} | ${nameOf(a.backup)} | ${a.source || ""} |`); }
  }
  L.push("");

  // tallies
  L.push("## Per-surgeon tallies vs cap / target"); L.push("");
  if (dg.tallies && Object.values(dg.tallies).every(v => v && v.months)) {
    // Max consec. P = consecutive PRIMARY days (the hard limit's measure); Max consec. any = either role (the soft limit's
    // measure). Real days; a holiday unit is one day only for a surgeon who opted in (Prompt 12 A, 9/22). Both are the
    // longest runs TOUCHING the month / range, followed across its edges (12/30 -> 1/1 reads 3 in Dec and in Jan).
    // Target P / Target B (Prompt 12 J, 9/22): the per-role targets of diagnostics.tallies[id].months[m].target
    // = { primary, backup } - the water-filled share per role for a pool member (WF 9/23), the window target for Sarkar (no backup target), '-'
    // where none. A legacy numeric target (a pre-J preview) reads as the primary target.
    const tgt = (x, role) => { const t = x && x.target; if (t && typeof t === "object") return typeof t[role] === "number" ? Math.round(t[role] * 10) / 10 : "-"; return role === "primary" && typeof t === "number" ? Math.round(t * 10) / 10 : "-"; };
    L.push("| Surgeon | Month | Primary | Backup | Total | Weekend days | Major | Minor | Max consec. P | Max consec. any | Cap (P) | Target P | Target B |"); L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const s of roster) { const tl = dg.tallies[s.id]; if (!tl) continue; const months = Object.keys(tl.months).sort(); for (const m of months) { const x = tl.months[m]; L.push(`| ${s.name} | ${m} | ${x.primary} | ${x.backup} | ${x.total} | ${x.weekendDays} | ${x.majorHolidays} | ${x.minorHolidays} | ${x.maxConsecutive} | ${x.maxConsecutiveAnyRole} | ${x.cap == null ? "-" : x.cap} | ${tgt(x, "primary")} | ${tgt(x, "backup")} |`); } if (tl.range) { const x = tl.range; L.push(`| **${s.name}** | **range** | **${x.primary}** | **${x.backup}** | **${x.total}** | **${x.weekendDays}** | **${x.majorHolidays}** | **${x.minorHolidays}** | **${x.maxConsecutive}** | **${x.maxConsecutiveAnyRole}** | | **${tgt(x, "primary")}** | **${tgt(x, "backup")}** |`); } }
    // Implied shares (J, water-filled WF 9/23): per month the pool slots (open + held), the pool and the two levels, then per member the target
    // against what the rules ALLOW on the lock-only schedule - a target above the allowed count is an
    // availability shortfall the generator cannot close, not a defect.
    const IT = dg.impliedTargets;
    if (IT && IT.months && Object.values(IT.months).some(I => I && I.members)) {
      L.push(""); L.push("## Implied shares (water-filled share per role; target vs what the rules allow)"); L.push("");
      L.push(`*Pool: ${(IT.pool || []).map(nameOf).join(", ")}. ${md(IT.rule || "")}*`); L.push("");
      for (const m of Object.keys(IT.months).sort()) {
        const I = IT.months[m]; if (!I || !I.members) continue;
        // placeable at target (J fix stage, WF): the open slots the targets ask for; below the open count where a cap
        // clips a member or he already holds more than the level - those days are placed by the soft terms alone
        const pl = I.placeableAtTarget ? ` | placeable at target ${I.placeableAtTarget.primary} P / ${I.placeableAtTarget.backup} B of ${I.primaryOpen} / ${I.backupOpen} open` : "";
        const partial = typeof I.rangeDays === "number" && I.rangeDays < new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate() ? ` | partial month: ${I.rangeDays} day(s) in range, whole-month targets` : "";
        const lvl = (x) => (x == null ? "at caps" : x);
        L.push(I.poolSlots
          ? `### ${m}: primary ${I.poolSlots.primary} pool slots (${I.primaryOpen} open - ${I.reservedForWindows} reserved for windows + ${I.heldByPool ? I.heldByPool.primary : "-"} held) = level ${lvl(I.primaryShare)} each of ${I.poolSize}; backup ${I.poolSlots.backup} pool slots (${I.backupOpen} open + ${I.heldByPool ? I.heldByPool.backup : "-"} held) = level ${lvl(I.backupShare)}${pl}${partial}`
          : `### ${m}: pre-9/23 preview (flat share): primary ${I.primaryOpen} open - ${I.reservedForWindows} reserved for windows, share ${I.primaryShare} each of ${I.poolSize}; backup ${I.backupOpen} open, share ${I.backupShare}${pl}${partial}`); L.push("");
        L.push("| Surgeon | Target P | Allowed P | Locked P | Clip P | Target B | Allowed B | Locked B |"); L.push("|---|---|---|---|---|---|---|---|");
        for (const s of roster) { const M = I.members[s.id]; if (!M) continue; const v = (x) => (x == null ? "-" : x); const flagP = typeof M.primaryTarget === "number" && M.allowedPrimary + M.lockedHeld.primary < M.primaryTarget ? " (short)" : ""; const flagB = typeof M.backupTarget === "number" && M.allowedBackup + M.lockedHeld.backup < M.backupTarget ? " (short)" : ""; L.push(`| ${s.name} | ${v(M.primaryTarget)} | ${M.allowedPrimary}${flagP} | ${M.lockedHeld.primary} | ${v(M.clipPrimary)} | ${v(M.backupTarget)} | ${M.allowedBackup}${flagB} | ${M.lockedHeld.backup} |`); }
        L.push("");
      }
    }
  } else if (dg.tallies) {
    L.push("```"); L.push(JSON.stringify(dg.tallies, null, 1).slice(0, 20000)); L.push("```");
  } else {
    const months = {}; for (const d of Object.keys(merged).filter(d => d >= START && d <= END)) { const m = d.slice(0, 7); months[m] = months[m] || {}; const a = merged[d]; if (a.primary) { months[m][a.primary] = months[m][a.primary] || { primary: 0, backup: 0 }; months[m][a.primary].primary++; } if (a.backup) { months[m][a.backup] = months[m][a.backup] || { primary: 0, backup: 0 }; months[m][a.backup].backup++; } }
    L.push("| Month | Surgeon | Primary | Backup | Total |"); L.push("|---|---|---|---|---|");
    for (const m of Object.keys(months).sort()) for (const id of roster.map(r => r.id)) { const t = months[m][id] || { primary: 0, backup: 0 }; L.push(`| ${m} | ${nameOf(id)} | ${t.primary} | ${t.backup} | ${t.primary + t.backup} |`); }
  }
  L.push("");

  // window weeks (Prompt 12 N): one row per window week overlapping the range; the count is a SOFT target
  if (Array.isArray(dg.windowWeeks) && dg.windowWeeks.length) {
    L.push("## Window weeks (soft target; a week off target is a warning, not a violation)"); L.push("");
    L.push("| Surgeon | Week of | Window days | In range | Primary | Backup | Target | Status |"); L.push("|---|---|---|---|---|---|---|---|");
    for (const w of dg.windowWeeks) L.push(`| ${nameOf(w.surgeonId)} | ${w.monday} | ${w.windowDays.join(", ")} | ${w.inRangeWindowDays.length}/${w.windowDays.length} | ${w.primaries} | ${w.backups} | ${w.target == null ? "-" : w.target} | ${w.status} |`);
    L.push("");
  }
  if (Array.isArray(dg.handoffGaps) && dg.handoffGaps.length) {
    L.push(`## Handoff gaps (${dg.handoffGaps.length})`); L.push("");
    L.push("| Day | Surgeon | Next day | Problem |"); L.push("|---|---|---|---|");
    for (const g of dg.handoffGaps) L.push(`| ${g.day} | ${nameOf(g.surgeonId)} | ${g.next} | ${g.problem} |`);
    L.push("");
  }

  // uncovered
  const unc = dg.uncovered || [];
  L.push(`## Open slots (${unc.length})`); L.push("");
  if (!unc.length) L.push("None."); else {
    L.push("| Day | Role | Why nobody is eligible |"); L.push("|---|---|---|");
    for (const u of unc) { const reasons = u.reasons || {}; const txt = Object.keys(reasons).map(id => `${nameOf(id)}: ${(Array.isArray(reasons[id]) ? reasons[id] : [reasons[id]]).join(", ")}`).join("; "); L.push(`| ${u.day} | ${u.role} | ${md(txt)} |`); }
  }
  L.push("");

  // soft penalties grouped by surgeon
  const soft = dg.softPenalties || [];
  L.push(`## Soft penalties incurred (${soft.length}), grouped by surgeon`); L.push("");
  const bySurgeon = {}; for (const p of soft) { (bySurgeon[p.id] = bySurgeon[p.id] || []).push(p); }
  for (const id of Object.keys(bySurgeon).sort()) {
    const list = bySurgeon[id]; const sum = list.reduce((n, p) => n + (Number(p.weight) || 0), 0);
    L.push(`### ${nameOf(id)} - ${list.length} entries, weight ${sum}`); L.push("");
    const byReason = {}; for (const p of list) { const k = p.reason; byReason[k] = byReason[k] || { n: 0, w: 0, days: [] }; byReason[k].n++; byReason[k].w += Number(p.weight) || 0; if (byReason[k].days.length < 8) byReason[k].days.push(`${p.day} ${p.role ? p.role[0].toUpperCase() : ""}`); }
    L.push("| Reason | Count | Weight | Days (first 8) |"); L.push("|---|---|---|---|");
    for (const k of Object.keys(byReason).sort((a, b) => byReason[b].w - byReason[a].w)) L.push(`| ${md(k)} | ${byReason[k].n} | ${byReason[k].w} | ${byReason[k].days.join(", ")} |`);
    L.push("");
  }

  for (const key of ["holidayUnits", "weekendUnits", "lockViolations", "eastConflicts", "eastForecast", "eastUnknownDays", "impliedTargets", "warnings"]) {
    if (dg[key] == null) continue;
    L.push(`## diagnostics.${key}`); L.push(""); L.push("```"); L.push(JSON.stringify(dg[key], null, 1).slice(0, 12000)); L.push("```"); L.push("");
  }

  // ---- October backfill (Prompt 12 T, 9/22): a SECOND generate over --backfill A..B with fillOpenOnly on the same
  // live rows. generate() restores ctx.schedule after every run, so this is independent of the milestone result
  // above. Every held slot of the input (locked or not, externalCover included) is fixed; only the open slots are
  // filled. Per open slot: the placed candidate (or "open" + the generator's per-surgeon reasons) and the
  // alternatives = every active surgeon eligible for that slot on the INPUT schedule (the lock-only base, before any
  // backfill placement), with the sum of the soft weights eligibility reports. Then the backfill's own tally delta.
  let backfill;
  if (BACKFILL_RANGE) {
    const bStart = BACKFILL_RANGE.start, bEnd = BACKFILL_RANGE.end;
    const tb0 = Date.now();
    const bres = G.generate(ctx, bStart, bEnd, { seed: SEED, bestOf: BEST_OF, respectLocks: true, fillOpenOnly: true });
    const tb1 = Date.now();
    const bs = bres.schedule || {}, bd = bres.diagnostics || {};
    const WDN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekdayOf = d => WDN[new Date(d + "T00:00:00Z").getUTCDay()];
    const nextDay = d => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
    const bDays = []; for (let d = bStart; d <= bEnd; d = nextDay(d)) bDays.push(d);
    const heldIn = (d, role) => { const e = schedule[d]; return !!(e && (e[role] || (role === "primary" && e.externalCover))); };
    const bUnc = bd.uncovered || [];
    const openRows = [];
    bDays.forEach(d => ["primary", "backup"].forEach(role => {
      if (heldIn(d, role)) return;
      const placed = (bs[d] && bs[d][role]) || null;
      // Alternatives = standalone eligibility on the INPUT schedule (no asBlockMember: a block-only surgeon may still
      // be eligible as part of a whole weekend). The surgeon the backfill itself placed in the OTHER role of the same
      // day is skipped - he cannot hold both roles (review 9/22).
      const otherRoleHolder = bs[d] && bs[d][role === "primary" ? "backup" : "primary"];
      const alternatives = (ctx.activeIds || roster.map(r => r.id)).map(id => { if (id === otherRoleHolder) return null; const r = R.eligibility(ctx, d, role, id); return r.ok ? { id, name: nameOf(id), soft: (r.soft || []).reduce((n, x) => n + (Number(x.weight) || 0), 0) } : null; }).filter(Boolean);
      const u = bUnc.find(x => x.day === d && x.role === role);
      const reasons = u ? Object.keys(u.reasons || {}).map(id => nameOf(id) + ": " + [].concat(u.reasons[id]).join(", ")).join("; ") : "";
      openRows.push({ day: d, weekday: weekdayOf(d), role, placed, placedName: placed ? nameOf(placed) : "open", alternatives, reasons });
    }));
    const talliesDelta = {};
    roster.forEach(r => { talliesDelta[r.id] = { primary: 0, backup: 0, days: [] }; });
    bDays.forEach(d => ["primary", "backup"].forEach(role => { const id = bs[d] && bs[d][role]; if (id && !heldIn(d, role) && talliesDelta[id]) { talliesDelta[id][role]++; talliesDelta[id].days.push(d + " " + role[0].toUpperCase()); } }));
    backfill = { range: { start: bStart, end: bEnd }, schedule: bs, diagnostics: bd, openSlots: openRows, talliesDelta, generateMs: tb1 - tb0 };
    const nFilled = openRows.filter(r => r.placed).length;
    L.push(`## October backfill (fill-open-only, ${bStart}..${bEnd})`); L.push("");
    L.push(`*A second generate() over the same LIVE rows with fillOpenOnly (independent of the milestone result above): every held slot - locked or not - is fixed and never rewritten; only the open slots are filled. Alternatives are standalone eligibility on the lock-only input (a block-only surgeon may still be eligible as part of a whole weekend; the backfill's own same-day other-role placement is excluded). seed ${SEED}, bestOf ${BEST_OF}, candidates tried ${bd.candidatesTried != null ? bd.candidatesTried : "?"}, generate() ${tb1 - tb0} ms; diagnostics.mode ${bd.mode}; fixed slots ${bd.fixedSlots}; open slots of the input ${openRows.length}: ${nFilled} filled, ${openRows.length - nFilled} still open. Nothing is published by this script.*`); L.push("");
    L.push("| Day | Weekday | Role | Placed | Alternatives (standalone eligibility on the input schedule; soft weight) | Why open (per surgeon) |"); L.push("|---|---|---|---|---|---|");
    openRows.forEach(r => L.push(`| ${r.day} | ${r.weekday} | ${r.role} | ${r.placed ? "**" + r.placedName + "**" : "open"} | ${md(r.alternatives.map(a => a.name + (a.soft ? " (" + a.soft + ")" : "")).join(", ") || "-")} | ${md(r.reasons)} |`));
    L.push("");
    L.push("### Backfill tally delta (days added by the backfill only)"); L.push("");
    L.push("| Surgeon | +Primary | +Backup | Days |"); L.push("|---|---|---|---|");
    roster.forEach(r => { const t = talliesDelta[r.id]; if (!t || (!t.primary && !t.backup)) return; L.push(`| ${r.name} | ${t.primary} | ${t.backup} | ${t.days.join(", ")} |`); });
    L.push("");
    for (const key of ["fixedViolations", "lockViolations", "eastConflicts", "derivedYields", "warnings"]) {
      if (bd[key] == null || (Array.isArray(bd[key]) && !bd[key].length)) continue;
      L.push(`### backfill diagnostics.${key}`); L.push(""); L.push("```"); L.push(JSON.stringify(bd[key], null, 1).slice(0, 8000)); L.push("```"); L.push("");
    }
  }

  fs.writeFileSync(OUT, L.join("\n"), "utf8");
  const jsonOut = OUT.replace(/\.md$/, ".json");
  fs.writeFileSync(jsonOut, JSON.stringify({ start: START, end: END, seed: SEED, bestOf: BEST_OF, generatedAt: new Date().toISOString(), schedule: sched, diagnostics: dg, backfill }, null, 1), "utf8");
  console.log(`report: ${OUT}\njson:   ${jsonOut}\nopen slots: ${unc.length} | soft penalties: ${soft.length} | generate ${t2 - t1} ms` + (backfill ? `\nbackfill ${backfill.range.start}..${backfill.range.end}: ${backfill.openSlots.length} open input slots, ${backfill.openSlots.filter(r => r.placed).length} filled, ${backfill.openSlots.filter(r => !r.placed).length} still open | generate ${backfill.generateMs} ms` : ""));
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
