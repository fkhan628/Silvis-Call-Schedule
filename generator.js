// Silvis Call Schedule - daily primary/backup generator.
// PLACEHOLDER until Prompt 4. generate() never silently leaves a slot empty:
// until the real pipeline exists it returns an empty schedule and an explicit
// diagnostics object so callers can show "nothing generated" honestly.
function generate(ctx, startDate, endDate, opts) {
  return { schedule: {}, diagnostics: { uncovered: [], notImplemented: "generator.js placeholder (Prompt 4)" } };
}
function rangePresets(lastPublishedDay) { return []; }
if (typeof module !== "undefined") {
  module.exports = { generate, rangePresets };
}
