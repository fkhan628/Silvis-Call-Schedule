// Silvis Call Schedule - theme contrast check (Prompt 12 item O.4's automated
// check, kept when item R superseded the rest of O.4).
//
// Loads the theme tokens from app-styles.js (THEME.light / THEME.dark, the
// per-surgeon table keyed by roster id, the outside-surgeon grey and the
// opening gradient) and measures every text / background pair the theme
// defines with the WCAG 2.x relative-luminance ratio. Two classes:
//   text   - body / running text, small labels and links: minimum 4.5:1
//   label  - bold UI labels and glyphs (pill names at 600+, button labels at
//            700 on 14px+, the 9px 800-weight E badge, the today ring, the
//            active-tab underline, the white "SSC" on the orange tiles):
//            minimum 3:1
// Every row says which class it is in. The smoke prints the table and fails
// on any row below its minimum; `node test/ui/contrast.mjs` prints it alone
// (exit 1 on a failing row).
//
// Second table (Prompt 16 B2, 9/24): the SIX REGIONS of index-source.html that
// test/ui/theme-regions.js names (notification settings, publish diff, snapshot
// list, SuCheck, open-shifts board, claim sheet). Every literal hex text colour
// still written in one of them is measured against the region's surface in
// BOTH themes - in dark mode as the dark <style> sheet would repaint it (or not:
// an unmapped grey such as #3a4a58 stays and reads ~1.6:1 on the dark card).
// Body text needs 4.5:1; a literal at 24 px, or 18.66 px at 700+, counts as
// large text at 3:1. A region written entirely in T.* tokens contributes no
// rows - the token table above is its proof. This file is in package.json's
// test chain and a build.yml step, so both tables gate every deploy.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const require = createRequire(import.meta.url);
const REG = require(path.join(__dirname, "theme-regions.js"));
export const REGIONS = REG.REGIONS;

export const hexToRgb = (hex) => {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error("not a 6-digit hex colour: " + hex);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
export const contrastRatio = (fgHex, bgHex) => {
  const la = lum(hexToRgb(fgHex)), lb = lum(hexToRgb(bgHex));
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
};

export const loadTheme = () => {
  const mod = require(path.join(ROOT, "app-styles.js"));
  if (!mod || !mod.THEME || !mod.THEME.light || !mod.THEME.dark) throw new Error("app-styles.js does not export THEME.light / THEME.dark");
  return mod;
};

// The pairs. `klass` text = 4.5:1, label = 3:1 (see the head comment).
export const contrastTable = (mod) => {
  const m = mod || loadTheme();
  const { THEME, SURGEON_COLOR_BY_ID, OUTSIDE_SURGEON_COLOR, OPENING } = m;
  const rows = [];
  const add = (theme, pair, fg, bg, klass) => rows.push({ theme, pair, fg, bg, klass, min: klass === "text" ? 4.5 : 3, ratio: contrastRatio(fg, bg) });
  for (const theme of ["light", "dark"]) {
    const T = THEME[theme];
    // running text
    add(theme, "body text on page", T.text, T.bg, "text");
    add(theme, "body text on card", T.text, T.surface, "text");
    add(theme, "muted text on page", T.muted, T.bg, "text");
    add(theme, "muted text on card", T.muted, T.surface, "text");
    add(theme, "body text in an input", T.text, T.inputBg, "text");
    add(theme, "orange text (links, today's date) on card", T.accentText, T.surface, "text");
    add(theme, "orange text on page", T.accentText, T.bg, "text");
    // The tint sits only under the bold (700) "newer" version chip - a label, never running text.
    add(theme, "orange text on its tint (bold chip)", T.accentText, T.accentTint, "label");
    add(theme, "OPEN red on card", T.open, T.surface, "text");
    add(theme, "OPEN red on page", T.open, T.bg, "text");
    // Prompt 16 B2: the success green (Saving / "No open shifts" / a sent test notification) is a token too.
    if (T.success) { add(theme, "success green on card", T.success, T.surface, "text"); add(theme, "success green on page", T.success, T.bg, "text"); }
    add(theme, "header title on the navy bar", T.onNavy, T.navy, "text");
    add(theme, "header subline on the navy bar", T.navyMuted, T.navy, "text");
    add(theme, "nav tab label (inactive) on the navy bar", T.navTab, T.navy, "text");
    add(theme, "card title (navy) on card", T.title, T.surface, "text");
    // bold labels + glyphs
    add(theme, "primary button label", T.onPrimary, T.primaryEnd, "label");
    add(theme, "primary button label (gradient start)", T.onPrimary, T.primaryStart, "label");
    add(theme, "mini / tab active label on navy", T.onNavy, T.navy, "label");
    add(theme, "today ring (orange glyph) on card", T.accent, T.surface, "label");
    add(theme, "active-tab underline (orange) on the navy bar", T.accent, T.navy, "label");
    add(theme, "E badge (white on navy glyph)", "#FFFFFF", T.badge, "label");
    // 9px 700 digits are read as text (review of TH): light uses navy digits on the orange, dark the page navy.
    add(theme, "count badge digits on the accent", T.onAccent, T.accent, "text");
    // Fairness bars: the gradient fill (start and end) against its track.
    add(theme, "fairness bar fill (start) on its track", T.barStart, T.barTrack, "label");
    add(theme, "fairness bar fill (end) on its track", T.barEnd, T.barTrack, "label");
    for (const id of Object.keys(SURGEON_COLOR_BY_ID)) {
      const c = SURGEON_COLOR_BY_ID[id];
      add(theme, `pill ${id} name on its tint`, c.tx, c.tg, "label");
      add(theme, `name ${id} on page`, theme === "dark" ? c.dk : c.tx, T.bg, "label");
      add(theme, `name ${id} on card`, theme === "dark" ? c.dk : c.tx, T.surface, "label");
    }
    add(theme, "outside surgeon pill on its tint", OUTSIDE_SURGEON_COLOR.tx, OUTSIDE_SURGEON_COLOR.tg, "label");
    (m.FALLBACK_SURGEON_COLORS || []).forEach((c, i) => add(theme, `fallback pill ${i} name on its tint`, c.tx, c.tg, "label"));
    add(theme, "outside surgeon name on page", theme === "dark" ? OUTSIDE_SURGEON_COLOR.dk : OUTSIDE_SURGEON_COLOR.tx, T.bg, "label");
  }
  // opening screens (theme-independent orange gradient, white text)
  add("opening", "white SSC / button label on the orange gradient start", OPENING.text, OPENING.start, "label");
  add("opening", "white SSC / button label on the orange gradient end", OPENING.text, OPENING.end, "label");
  for (const r of rows) r.ok = r.ratio >= r.min;
  return rows;
};

export const formatTable = (rows) => {
  const w = (s, n) => String(s).padEnd(n);
  const lines = [w("theme", 8) + w("pair", 50) + w("fg", 9) + w("bg", 9) + w("ratio", 8) + w("min", 5) + w("class", 7) + "ok"];
  for (const r of rows) lines.push(w(r.theme, 8) + w(r.pair, 50) + w(r.fg, 9) + w(r.bg, 9) + w(r.ratio.toFixed(2), 8) + w(r.min, 5) + w(r.klass, 7) + (r.ok ? "ok" : "FAIL"));
  return lines.join("\n");
};

// Prompt 16 B2 - the six regions: one row per literal text colour per theme. `src` defaults to the
// working tree's index-source.html (a caller may pass another revision's text).
export const regionTable = (src) => {
  const text = src !== undefined ? String(src) : fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
  const rows = [];
  for (const region of REG.REGIONS) {
    const { text: slice, firstLine } = REG.extractRegion(text, region);
    for (const hit of REG.scanRegion(slice, firstLine)) {
      const klass = REG.isLarge(hit) ? "large" : "text";
      for (const theme of ["light", "dark"]) {
        const fg = theme === "dark" ? REG.darkPaintOf(hit) : hit.light;
        const bg = hit.ownBg ? hit.ownBg[theme] : region.surface[theme];
        const ratio = contrastRatio(fg, bg);
        const min = klass === "text" ? 4.5 : 3;
        rows.push({ region: region.key, theme, line: hit.line, tag: hit.tag, literal: hit.light, fg, bg, ratio, min, klass, ok: ratio >= min });
      }
    }
  }
  return rows;
};

export const formatRegionTable = (rows) => {
  const w = (s, n) => String(s).padEnd(n);
  const lines = [w("region", 18) + w("theme", 7) + w("line", 6) + w("tag", 7) + w("literal", 9) + w("paints", 9) + w("bg", 9) + w("ratio", 7) + w("min", 5) + w("class", 7) + "ok"];
  for (const r of rows) lines.push(w(r.region, 18) + w(r.theme, 7) + w(r.line, 6) + w(r.tag, 7) + w(r.literal, 9) + w(r.fg, 9) + w(r.bg, 9) + w(r.ratio.toFixed(2), 7) + w(r.min, 5) + w(r.klass, 7) + (r.ok ? "ok" : "FAIL"));
  return lines.join("\n");
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = contrastTable();
  console.log(formatTable(rows));
  const bad = rows.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} pair(s) below their minimum` : `\nall ${rows.length} pairs meet their minimum`);
  const reg = regionTable();
  console.log("\nsix regions (Prompt 16 B2) - literal text colours still written in index-source.html:");
  console.log(reg.length ? formatRegionTable(reg) : "  none - every text colour in the six regions is a theme token");
  const regBad = reg.filter(r => !r.ok);
  if (regBad.length) {
    const worst = regBad.slice().sort((a, b) => a.ratio - b.ratio)[0];
    console.log(`\n${regBad.length} region row(s) below their minimum; worst: ${worst.region} ${worst.theme} line ${worst.line} <${worst.tag}> ${worst.literal} paints ${worst.fg} on ${worst.bg} = ${worst.ratio}:1 (min ${worst.min})`);
  } else console.log(`\nregion rows: ${reg.length}, none below their minimum`);
  process.exit(bad.length || regBad.length ? 1 : 0);
}
