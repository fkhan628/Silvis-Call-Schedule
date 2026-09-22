// Silvis Call Schedule - rules engine (pure functions; no DOM, no fetch).
// PLACEHOLDER until Prompt 3. Loadable by the browser (globals) and by Node.
// eligibility() is the single chokepoint every assignment must pass through;
// until it is implemented it refuses everything LOUDLY rather than allowing
// silently.
function matchesPattern(dateStr, pattern) { return false; }
function buildContext(input) { return Object.assign({ _placeholder: true }, input || {}); }
function eligibility(ctx, dateStr, role, surgeonId) {
  return { ok: false, hard: ["rules.js not implemented yet (Prompt 3)"], soft: [] };
}
function weekendUnitPatterns(ctx, fridayStr) { return []; }
function holidayUnits(ctx, startDate, endDate) { return []; }
function holidayUnitCandidates(ctx, unit, role) { return []; }
if (typeof module !== "undefined") {
  module.exports = { matchesPattern, buildContext, eligibility, weekendUnitPatterns, holidayUnits, holidayUnitCandidates };
}
