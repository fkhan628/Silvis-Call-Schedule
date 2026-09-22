// Silvis Call Schedule - East (Davenport) feed, read-only.
// PLACEHOLDER until Prompt 7. Reads the Davenport project's schedule_weeks with
// its public anon key, never writes to it. Fetch failure must keep the cache
// and warn - never be treated as "no East call".
async function fetchEastWeeks(fromMonday, toMonday) {
  throw new Error("east-feed.js not implemented yet (Prompt 7)");
}
function deriveKhanBusyDays(weeks, fakId, opts) { return new Set(); }
function deriveFierceWeeks(weeks) { return []; }
if (typeof module !== "undefined") {
  module.exports = { fetchEastWeeks, deriveKhanBusyDays, deriveFierceWeeks };
}
