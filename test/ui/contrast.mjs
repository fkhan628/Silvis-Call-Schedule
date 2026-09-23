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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const require = createRequire(import.meta.url);

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = contrastTable();
  console.log(formatTable(rows));
  const bad = rows.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} pair(s) below their minimum` : `\nall ${rows.length} pairs meet their minimum`);
  process.exit(bad.length ? 1 : 0);
}
