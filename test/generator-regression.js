// Silvis generator regression harness.
// PLACEHOLDER until Prompt 4: exits 0 with an explicit "no tests yet" line so
// CI wiring can be proven before the generator exists.
const gen = require("../generator.js");
const out = gen.generate({}, "2026-11-02", "2027-01-03", { seed: 1 });
if (!out || typeof out.schedule !== "object" || !out.diagnostics || !Array.isArray(out.diagnostics.uncovered)) {
  console.error("FAIL: generate() placeholder contract broken"); process.exit(1);
}
console.log("generator-regression.js: no tests yet (Prompt 4) - placeholder contract holds, 0 seeds run");
process.exit(0);
