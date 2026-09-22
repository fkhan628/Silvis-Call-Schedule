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
  const forecast = typeof EF.forecastFromFeedRows === "function" ? EF.forecastFromFeedRows(forecastRows.map(r => ({ weekMonday: r.week_monday, data: r.data }))) : {};
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
  const eastFeedCoverage = EF.coverageOf ? EF.coverageOf(weeks) : null;

  const input = { roster, surgeonRules, groupRules, holidays, timeOffRows, availabilityRows, schedule, eastBusyDays, eastForecast, eastFeedCoverage, eastDerived, rangeStart: START, rangeEnd: END };
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
    L.push("| MON/SUN DATES | PRIMARY | BACKUP |"); L.push("|---|---|---|");
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
    L.push("| Surgeon | Month | Primary | Backup | Total | Weekend days | Major | Minor | Max consec. P | Max consec. any | Cap | Target |"); L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const s of roster) { const tl = dg.tallies[s.id]; if (!tl) continue; const months = Object.keys(tl.months).sort(); for (const m of months) { const x = tl.months[m]; L.push(`| ${s.name} | ${m} | ${x.primary} | ${x.backup} | ${x.total} | ${x.weekendDays} | ${x.majorHolidays} | ${x.minorHolidays} | ${x.maxConsecutive} | ${x.maxConsecutiveAnyRole} | ${x.cap == null ? "-" : x.cap} | ${x.target == null ? "-" : (Math.round(x.target * 10) / 10)} |`); } if (tl.range) { const x = tl.range; L.push(`| **${s.name}** | **range** | **${x.primary}** | **${x.backup}** | **${x.total}** | **${x.weekendDays}** | **${x.majorHolidays}** | **${x.minorHolidays}** | **${x.maxConsecutive}** | **${x.maxConsecutiveAnyRole}** | | |`); } }
  } else if (dg.tallies) {
    L.push("```"); L.push(JSON.stringify(dg.tallies, null, 1).slice(0, 20000)); L.push("```");
  } else {
    const months = {}; for (const d of Object.keys(merged).filter(d => d >= START && d <= END)) { const m = d.slice(0, 7); months[m] = months[m] || {}; const a = merged[d]; if (a.primary) { months[m][a.primary] = months[m][a.primary] || { primary: 0, backup: 0 }; months[m][a.primary].primary++; } if (a.backup) { months[m][a.backup] = months[m][a.backup] || { primary: 0, backup: 0 }; months[m][a.backup].backup++; } }
    L.push("| Month | Surgeon | Primary | Backup | Total |"); L.push("|---|---|---|---|---|");
    for (const m of Object.keys(months).sort()) for (const id of roster.map(r => r.id)) { const t = months[m][id] || { primary: 0, backup: 0 }; L.push(`| ${m} | ${nameOf(id)} | ${t.primary} | ${t.backup} | ${t.primary + t.backup} |`); }
  }
  L.push("");

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

  for (const key of ["holidayUnits", "weekendUnits", "lockViolations", "eastForecast", "eastUnknownDays", "impliedTargets", "warnings"]) {
    if (dg[key] == null) continue;
    L.push(`## diagnostics.${key}`); L.push(""); L.push("```"); L.push(JSON.stringify(dg[key], null, 1).slice(0, 12000)); L.push("```"); L.push("");
  }

  fs.writeFileSync(OUT, L.join("\n"), "utf8");
  const jsonOut = OUT.replace(/\.md$/, ".json");
  fs.writeFileSync(jsonOut, JSON.stringify({ start: START, end: END, seed: SEED, bestOf: BEST_OF, generatedAt: new Date().toISOString(), schedule: sched, diagnostics: dg }, null, 1), "utf8");
  console.log(`report: ${OUT}\njson:   ${jsonOut}\nopen slots: ${unc.length} | soft penalties: ${soft.length} | generate ${t2 - t1} ms`);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
