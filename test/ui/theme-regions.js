// Silvis Call Schedule - the six index-source.html regions whose text colours must be theme tokens
// (Prompt 16 B2, review 2026-09-23 section 3: dark mode read 1.6:1 on the notification-settings
// labels, the publish diff, the snapshot list and every Setup checkbox label; the open-shifts board
// and the claim sheet used light-only greys).
//
// Plain CommonJS so BOTH gates share one definition: test/ui/contrast.mjs (through createRequire)
// measures every literal text colour the regions still carry against the region's surface in each
// theme, and test/data-layer.test.js pins that the regions carry no literal text colour at all (the
// tokens THEME.light / THEME.dark in app-styles.js, read as T.* in the JSX, are the only source).
//
// A region is a slice of index-source.html between two unique anchors (start inclusive, end
// exclusive). `surface` is the colour the region's text sits on in each theme: the card / dialog
// white in light mode, the dark card #13294B (the dark <style> sheet repaints rgb(255,255,255)
// backgrounds), the claim sheet's own dialog navy #16213E, the notification card's inner box.
"use strict";

const REGIONS = [
  { key: "notif-settings", label: "Settings > Notification settings", start: "<span>Notification settings</span>", end: "<div style={css.cardT}>Account</div>", surface: { light: "#F8F9FB", dark: "#1A2A3E" } },
  { key: "publish-diff", label: "Publish dialog (diff lines + notice)", start: 'data-testid="publish-dialog"', end: 'data-testid="publish-send"', surface: { light: "#FFFFFF", dark: "#13294B" } },
  { key: "snapshot-list", label: "Settings > Restore from snapshot", start: "<span>Restore from snapshot</span>", end: "Refresh list</button>", surface: { light: "#FFFFFF", dark: "#13294B" } },
  { key: "sucheck", label: "SuCheck (every Setup checkbox label)", start: "function SuCheck(", end: "\n}\n", surface: { light: "#FFFFFF", dark: "#13294B" } },
  { key: "openshifts-board", label: "Open shifts board", start: 'data-testid="openshifts-card"', end: "{claimSheet && (", surface: { light: "#FFFFFF", dark: "#13294B" } },
  { key: "claim-sheet", label: "Claim sheet + open-shifts e-mail dialog", start: "{claimSheet && (", end: 'data-testid="ob-email-send"', surface: { light: "#FFFFFF", dark: "#16213E" } },
];

// The literal greys / red the six regions carried before B2 (the "old set"); the data-layer pin names each.
const OLD_LITERALS = ["#3a4a58", "#7a8a98", "#c04040", "#5a6a78", "#8a94a0", "#1a8040", "#f0f2f4"];

// What the dark <style> sheet in index-source.html does to a LIGHT literal (React serialises inline
// colours as rgb(); the sheet matches that form per element name and repaints). Kept in step with the
// sheet by hand; the smoke measures computed colours as the check of record.
const DARK_SHEET = [
  { hex: "#1f2a3a", to: "#E6ECF5", tags: ["div", "span", "p", "h2", "h3", "label"] },
  { hex: "#5b6b82", to: "#9FB0C8", tags: ["div", "span", "p", "label"] },
  { hex: "#13294b", to: "#C9D6E8", tags: ["div", "span", "strong", "h3"] },
  { hex: "#c2410c", to: "#FF8A4C", tags: ["span", "button", "div"] },
  { hex: "#b91c1c", to: "#F06060", tags: ["span", "div"] },
  { hex: "#1a8040", to: "#40C060", tags: ["span"] },
  { hex: "#c04040", to: "#F06060", tags: ["span"] },
];
// Element-wide dark rules (`td { color: ... !important }` beats an inline colour).
const DARK_TAG_COLOR = { td: "#C9D6E8", table: "#C9D6E8", th: "#9FB0C8", button: "#C9D6E8" };

const norm6 = (hex) => {
  const h = String(hex || "").replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) return ("#" + h.split("").map(c => c + c).join("")).toLowerCase();
  return ("#" + h).toLowerCase();
};

function extractRegion(src, region) {
  const text = String(src).replace(/\r\n/g, "\n");
  const a = text.indexOf(region.start);
  if (a < 0) throw new Error("region " + region.key + ": start anchor not found: " + region.start);
  if (text.indexOf(region.start, a + 1) >= 0) throw new Error("region " + region.key + ": start anchor is not unique: " + region.start);
  const b = text.indexOf(region.end, a + region.start.length);
  if (b < 0) throw new Error("region " + region.key + ": end anchor not found after the start: " + region.end);
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  return { text: text.slice(a, b), firstLine: lineOf(a) };
}

// Every inline `color:` in the region whose value is a hex literal (plain `"#hex"` or the
// theme-conditional `dk ? "#dark" : "#light"`). Returns one entry per hit with the element name, the
// light / dark colour, the style object's own background literal (if any) and its font size / weight.
function scanRegion(regionText, firstLine) {
  const out = [];
  const re = /(?<![A-Za-z-])color:\s*(?:"(#[0-9a-fA-F]{3,6})"|dk\s*\?\s*"(#[0-9a-fA-F]{3,6})"\s*:\s*"(#[0-9a-fA-F]{3,6})")/g;
  let m;
  while ((m = re.exec(regionText))) {
    const idx = m.index;
    const before = regionText.slice(0, idx);
    const tagM = before.match(/<([a-zA-Z][\w]*)\b[^<]*$/);
    const tag = tagM ? tagM[1].toLowerCase() : "?";
    const styleStart = Math.max(before.lastIndexOf("style={{"), before.lastIndexOf("style={"));
    const styleEnd = regionText.indexOf("}}", idx);
    const style = regionText.slice(styleStart < 0 ? idx : styleStart, styleEnd < 0 ? idx + m[0].length : styleEnd);
    const bgM = style.match(/(?<![A-Za-z-])background:\s*(?:"(#[0-9a-fA-F]{3,6})"|dk\s*\?\s*"(#[0-9a-fA-F]{3,6})"\s*:\s*"(#[0-9a-fA-F]{3,6})")/);
    const fs = style.match(/fontSize:\s*([\d.]+)/), fw = style.match(/fontWeight:\s*(\d+)/);
    out.push({
      line: firstLine + before.split("\n").length - 1,
      tag,
      light: norm6(m[1] || m[3]),
      dark: norm6(m[1] || m[2]),
      conditional: !m[1],
      ownBg: bgM ? { light: norm6(bgM[1] || bgM[3]), dark: norm6(bgM[1] || bgM[2]) } : null,
      fontSize: fs ? Number(fs[1]) : null,
      fontWeight: fw ? Number(fw[1]) : 400,
      snippet: m[0],
    });
  }
  return out;
}

// The colour the browser paints in dark mode for a light literal on an element.
function darkPaintOf(hit) {
  if (hit.conditional) return hit.dark;
  if (DARK_TAG_COLOR[hit.tag]) return DARK_TAG_COLOR[hit.tag];
  const rule = DARK_SHEET.find(r => r.hex === hit.light && r.tags.indexOf(hit.tag) >= 0);
  return rule ? rule.to : hit.light;
}

// WCAG large text: >= 24 px, or >= 18.66 px (14 pt) at 700+.
const isLarge = (hit) => hit.fontSize !== null && (hit.fontSize >= 24 || (hit.fontSize >= 18.66 && hit.fontWeight >= 700));

module.exports = { REGIONS, OLD_LITERALS, DARK_SHEET, DARK_TAG_COLOR, extractRegion, scanRegion, darkPaintOf, isLarge, norm6 };
