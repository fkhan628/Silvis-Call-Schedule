// Silvis Call Schedule - Style Constants + theme tokens
// Ported from the Davenport app. appBadge (APPs) and backupBanner (Fierce
// backup weeks) were removed in Prompt 6 Slice A with the features they styled.
//
// Theme (Prompt 12 items O + R, Faraz 9/22): University of Illinois navy and
// orange, softened. THEME.light / THEME.dark name every colour the app uses;
// index-source.html reads them as T = THEME[dk ? "dark" : "light"] and the
// css object below is the light set (the dark sheet in index-source.html
// re-paints the light literals). Navy #13294B is the structure (header bar,
// nav, primary buttons, card titles); orange #FF5F05 is an ACCENT only (count
// badges, the active tab underline, the today ring, the primary call to
// action), #C2410C wherever orange is text on white, #FFE8DB as its tint; OPEN
// stays red #B91C1C so it never competes with the accent. The opening screens
// (sign-in / sign-up / reset / set-password card, biometric "Welcome back",
// loading, crash) are the orange OPENING gradient with white text. The
// Davenport blue gradient the opening used before (hex 1a6fa8 -> 2488c8) and
// the green the manifest carried (hex 1f7a5c) are gone from the app; this
// comment is their only trace.
//
// Per-surgeon colours are DATA keyed by roster id (SURGEON_COLOR_BY_ID) and by
// roster type (OUTSIDE_SURGEON_COLOR for type "external", grey with a dashed
// border) - never by a surgeon's name in code. tx = text / pill foreground,
// bd = border, tg = pill tint (kept in both themes: a pill carries its own
// background), dk = the name written straight on the dark page. The grid,
// the roster pills rendered as buttons (css.badge(idx, entry)) and the exports
// (helpers.js exportColorsFor -> rosterColors(entry, idx)) all resolve through
// rosterColors; nothing in this file touches config.js's older code-keyed
// surgeonColors. Primary / backup stay text weight (P bold, B regular), never
// colour. The count badges (Alerts / Time off) write onAccent digits on the
// accent: navy in light mode, the page navy in dark, both >= 4.5:1.

const font = "'Outfit', sans-serif";
const mono = "'JetBrains Mono', monospace";

const THEME = {
  light: {
    bg: "#F6F8FB", surface: "#FFFFFF", raised: "#EEF2F7", text: "#1F2A3A", muted: "#5B6B82", border: "#DCE3EC",
    inputBg: "#FFFFFF", inputBorder: "#C9D3E0",
    navy: "#13294B", onNavy: "#FFFFFF", navyMuted: "#B8C6DC", navTab: "#DCE5F2", title: "#13294B", badge: "#13294B",
    primaryStart: "#13294B", primaryEnd: "#1F3A6B", onPrimary: "#FFFFFF",
    accent: "#FF5F05", onAccent: "#13294B", accentText: "#C2410C", accentTint: "#FFE8DB",
    open: "#B91C1C", weekend: "#EEF2F7", holiday: "#FDF6DC", skeleton: "#E4E8EE",
    // Fairness bars (TotalsCard): the fill gradient against its track, both stops >= 3:1.
    barTrack: "#EEF1F4", barStart: "#13294B", barEnd: "#1F3A6B",
  },
  dark: {
    bg: "#0B1A33", surface: "#13294B", raised: "#0F2140", text: "#E6ECF5", muted: "#9FB0C8", border: "#24406B",
    inputBg: "#0F2140", inputBorder: "#24406B",
    navy: "#13294B", onNavy: "#E6ECF5", navyMuted: "#9FB0C8", navTab: "#C9D6E8", title: "#C9D6E8", badge: "#2E5090",
    primaryStart: "#1F3A6B", primaryEnd: "#2E5090", onPrimary: "#FFFFFF",
    accent: "#FF8A4C", onAccent: "#0B1A33", accentText: "#FF8A4C", accentTint: "#3A2418",
    open: "#F06060", weekend: "#0F2140", holiday: "#3A3418", skeleton: "#243250",
    barTrack: "#0F2140", barStart: "#4A78D0", barEnd: "#5B8DEF",
  },
};
const LIGHT = THEME.light;

// Opening screens (item R.3): orange gradient, white text, in both themes.
const OPENING = { start: "#FF5F05", end: "#E8520A", text: "#FFFFFF", gradient: "linear-gradient(135deg,#FF5F05,#E8520A)" };

// Item O.3 - keyed by roster id (s1..s6 are the ids in docs/silvis-seed.json).
const SURGEON_COLOR_BY_ID = {
  s1: { tx: "#1F3A6B", bd: "#B7C6E2", tg: "#E8EEF8", dk: "#9DB8E8" }, // navy
  s2: { tx: "#D9561A", bd: "#F2BFA4", tg: "#FDEBE1", dk: "#FF9A66" }, // orange
  s3: { tx: "#0F766E", bd: "#9FD6CF", tg: "#E3F4F1", dk: "#5ED3C6" }, // teal
  s4: { tx: "#6B3FA0", bd: "#CDB8E8", tg: "#F1EAF9", dk: "#C2A3EC" }, // plum
  s5: { tx: "#6B7F1A", bd: "#CCD69A", tg: "#F1F4E0", dk: "#C5D66A" }, // olive
  s6: { tx: "#475569", bd: "#B9C2CF", tg: "#EDF0F4", dk: "#B6C2D3" }, // slate
};
// Roster type "external" (item M): grey, dashed border, in both themes.
const OUTSIDE_SURGEON_COLOR = { tx: "#737373", bd: "#737373", tg: "#F4F4F4", dk: "#A3A3A3", dashed: true };
// A roster id the table does not pin (a future hire) cycles these.
const FALLBACK_SURGEON_COLORS = [
  { tx: "#8A4B1F", bd: "#DDB48F", tg: "#F8ECE0", dk: "#E2A873" },
  { tx: "#3C4F9A", bd: "#B9C2EA", tg: "#EAEDFA", dk: "#AEB9F2" },
  { tx: "#4F6B2F", bd: "#BBD09F", tg: "#EEF5E5", dk: "#B9D690" },
];
// rosterColors(entry, idx) -> { tx, bd, tg, dk, dashed? } for a roster entry.
function rosterColors(entry, idx) {
  if (entry && entry.type === "external") return OUTSIDE_SURGEON_COLOR;
  if (entry && SURGEON_COLOR_BY_ID[entry.id]) return SURGEON_COLOR_BY_ID[entry.id];
  return FALLBACK_SURGEON_COLORS[(idx || 0) % FALLBACK_SURGEON_COLORS.length];
}
// A name written straight on the page: tx in light mode, dk in dark mode.
function rosterNameColor(c, dark) { const col = c || {}; return dark ? (col.dk || col.bd || THEME.dark.text) : (col.tx || THEME.light.text); }
// Pill border for a colour set (outside surgeons dashed).
function pillBorder(c) { const col = c || {}; return (col.dashed ? "1px dashed " : "1px solid ") + (col.bd || LIGHT.border); }

// iOS safe area (Prompt 16 A5). The viewport meta carries viewport-fit=cover and the status bar is black-translucent, so an
// installed PWA draws under the notch and the home indicator; these two env() readers (0px everywhere else) keep the UI out of
// them. Read them with a template literal AFTER the padding shorthand in the same style object (React applies keys in order).
const SAFE_AREA = { top: "env(safe-area-inset-top, 0px)", bottom: "env(safe-area-inset-bottom, 0px)" };

const css = {
  root: { fontFamily:font, background:LIGHT.bg, color:LIGHT.text, minHeight:"100vh" },
  hdr: { background:LIGHT.navy, borderBottom:`1px solid ${LIGHT.navy}`, padding:"14px 20px", paddingTop:`calc(${SAFE_AREA.top} + 14px)`, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 },
  h1: { fontSize:21, fontWeight:700, color:LIGHT.onNavy, margin:0, letterSpacing:-0.5 },
  // A fixed bottom banner (update-available, minimum-version, session-expired): they stack 44 px apart, `stacked` = how many
  // show below this one. The lowest pads its bottom by the home-indicator inset; the ones above are lifted by it. Spread it
  // after the banner's padding shorthand.
  bottomBanner: (stacked) => stacked ? { bottom: `calc(${stacked * 44}px + ${SAFE_AREA.bottom})` } : { bottom: 0, paddingBottom: `calc(${SAFE_AREA.bottom} + 9px)` },
  sub: { fontSize:11, color:LIGHT.navyMuted, margin:"2px 0 0", letterSpacing:0.8, textTransform:"uppercase" },
  nav: { display:"flex", gap:3, flexWrap:"wrap" },
  // Nav tabs sit on the navy bar: the active tab is lifted a touch and underlined in the accent (the caller passes T.accent so dark mode gets its own).
  tab: (a, accent) => ({ background:a?"rgba(255,255,255,0.14)":"transparent", border:`1px solid ${a?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.22)"}`, borderBottom:`2px solid ${a?(accent||LIGHT.accent):"transparent"}`, color:a?LIGHT.onNavy:LIGHT.navTab, borderRadius:7, padding:"5px 13px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:font }),
  card: { background:LIGHT.surface, border:`1px solid ${LIGHT.border}`, borderRadius:10, padding:18, marginBottom:14, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  cardT: { fontSize:13, fontWeight:700, color:LIGHT.title, margin:"0 0 12px", textTransform:"uppercase", letterSpacing:1.2 },
  inp: { background:LIGHT.inputBg, border:`1px solid ${LIGHT.inputBorder}`, borderRadius:5, padding:"6px 10px", color:LIGHT.text, fontSize:13, fontFamily:font, outline:"none" },
  btn: a => ({ background:a?`linear-gradient(135deg,${LIGHT.primaryStart},${LIGHT.primaryEnd})`:LIGHT.raised, border:`1px solid ${a?LIGHT.navy:LIGHT.inputBorder}`, color:a?LIGHT.onPrimary:LIGHT.muted, borderRadius:7, padding:"7px 16px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:font }),
  // The primary call to action (sign in / create account / reset / unlock; Accept & Publish): the orange gradient.
  cta: { background:OPENING.gradient, border:`1px solid ${OPENING.end}`, color:OPENING.text, borderRadius:7, padding:"7px 16px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:font },
  // Calendar tools card (Prompt 9 exports): one block per export family.
  toolBlock: { paddingBottom:12, marginBottom:12, borderBottom:`1px solid ${LIGHT.border}` },
  toolTitle: { fontSize:12, fontWeight:700, color:LIGHT.text, margin:"0 0 6px" },
  // Setup view (Prompt 6 Slice E): sub-section titles, compact controls, notice boxes.
  subT: { fontSize:12, fontWeight:700, color:LIGHT.text, margin:"12px 0 6px" },
  mini: (a) => ({ background:a?LIGHT.navy:"transparent", border:`1px solid ${a?LIGHT.navy:LIGHT.inputBorder}`, color:a?LIGHT.onNavy:LIGHT.muted, borderRadius:6, padding:"3px 9px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:font }),
  danger: { background:"none", border:"1px solid #e8c0c0", color:"#904040", borderRadius:6, padding:"3px 9px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:font },
  warnBox: { fontSize:12, color:"#7a5a20", background:"#fbf1d8", border:"1px solid #e8d090", borderRadius:6, padding:"8px 10px", lineHeight:1.5 },
  errBox: { fontSize:12, color:"#8a3030", background:"#fdeaea", border:"1px solid #e0a8a8", borderRadius:6, padding:"8px 10px", lineHeight:1.5 },
  okBox: { fontSize:12, color:"#1a6030", background:"#e8f8e8", border:"1px solid #a0d8a0", borderRadius:6, padding:"8px 10px", lineHeight:1.5 },
  tableWrap: { overflowX:"auto", border:`1px solid ${LIGHT.border}`, borderRadius:6 },
  // badge(idx, entry): a roster pill - colours by roster id / type (rosterColors), never by name.
  badge: (i, entry) => { const c = rosterColors(entry, i); return { display:"inline-flex", alignItems:"center", background:c.tg, color:c.tx, border:pillBorder(c), borderRadius:5, padding:"2px 9px", fontSize:12, fontWeight:600, whiteSpace:"nowrap", letterSpacing:0.3 }; },
  // brush(on, key): an offer-painter brush chip (Prompt 14 part 3a). Armed = its GRADIENT with white text (the dark
  // sheet recolours flat buttons but exempts linear-gradient ones); idle = transparent with the brush's own text colour.
  brush: (on, key) => { const b = OFFER_BRUSH[key] || OFFER_BRUSH.clear; return { minHeight:44, padding:"8px 14px", borderRadius:9, fontSize:13, fontWeight:800, fontFamily:font, cursor:"pointer", background:on ? b.gradient : "transparent", color:on ? "#FFFFFF" : b.text, border:`2px solid ${on ? b.border : b.border}` }; },
};

// Offer painter brushes (Prompt 14 part 3a): primary = the navy, backup = an amber (the My-schedule backup gradient's
// family), either = a teal, clear = grey. tint / text carry the drafted pill in both themes (a pill keeps its own
// background); gradient is the armed chip. Primary / backup stay distinguishable by word as well (P / B / P+B).
const OFFER_BRUSH = {
  primary: { gradient: "linear-gradient(135deg,#13294B,#1F3A6B)", border: "#13294B", text: "#13294B", tint: "#E8EEF8", label: "Primary", short: "P" },
  backup:  { gradient: "linear-gradient(135deg,#8A6A20,#B08A30)", border: "#8A6A20", text: "#7A5A20", tint: "#FBF1D8", label: "Backup", short: "B" },
  either:  { gradient: "linear-gradient(135deg,#0F766E,#149C90)", border: "#0F766E", text: "#0F766E", tint: "#E3F4F1", label: "Either", short: "P+B" },
  clear:   { gradient: "linear-gradient(135deg,#5B6B82,#7A8A98)", border: "#7A8A98", text: "#5B6B82", tint: "#EEF2F7", label: "Clear", short: "-" },
};

// East-vacation marker (Prompt 15 part 3, 9/23): the person's Davenport vacation
// ranges under his review decision. A small DIAMOND (a rotated square), so it
// never passes for the round Silvis vacation dot beside it; keyed by the review
// STATE, never by a name: unreviewed = dashed amber outline (decide it - it is a
// Silvis vacation until then), away = solid outline in the person's own colour
// (a Silvis vacation), home = filled green (available at Silvis; no East call).
// The outlines clear 3:1 on the cell surface in both themes (data-layer pin);
// index-source.html passes textColorOf(id) for the person's colour.
const EASTVAC_COLORS = {
  light: { unreviewed: "#B45309", home: "#15803D", homeFill: "#86EFAC" },
  dark:  { unreviewed: "#FBBF24", home: "#4ADE80", homeFill: "#166534" },
};
function eastVacMarkStyle(state, dark, personColor) {
  const C = EASTVAC_COLORS[dark ? "dark" : "light"];
  const base = { display: "inline-block", width: 7, height: 7, borderRadius: 1, transform: "rotate(45deg)", flexShrink: 0, borderWidth: 1.5, boxSizing: "border-box" };
  if (state === "home") return Object.assign(base, { borderStyle: "solid", borderColor: C.home, background: C.homeFill });
  if (state === "away") return Object.assign(base, { borderStyle: "solid", borderColor: personColor || (dark ? THEME.dark.text : THEME.light.text), background: "transparent" });
  return Object.assign(base, { borderStyle: "dashed", borderColor: C.unreviewed, background: "transparent" });
}
// The three-way review control (unreviewed / away / home) as tappable segments;
// the active segment is filled in the state's tone with white text (every tone
// clears 4.5:1 under white), the others stay quiet. The fill is written as a
// flat linear-gradient on purpose: the dark sheet in index-source.html paints
// every plain button's text #C9D6E8 and a gradient button's text white, so the
// active segment keeps white-on-tone in both themes without a data-pill
// exception. 32px tall at least (phone tap target).
const EASTVAC_SEG_TONES = {
  light: { unreviewed: "#B45309", away: "#13294B", home: "#15803D" },
  dark:  { unreviewed: "#92400E", away: "#2E5090", home: "#166534" },
};
function eastVacSegStyle(active, state, dark) {
  const T = THEME[dark ? "dark" : "light"];
  const tone = EASTVAC_SEG_TONES[dark ? "dark" : "light"][state] || EASTVAC_SEG_TONES.light.unreviewed;
  return {
    background: active ? "linear-gradient(135deg," + tone + "," + tone + ")" : "transparent", color: active ? "#FFFFFF" : T.muted, border: "1px solid " + (active ? tone : T.inputBorder),
    borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font, minHeight: 32, lineHeight: "22px", whiteSpace: "nowrap",
  };
}

// Node (tests: test/data-layer.test.js pins, test/ui/contrast.mjs).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { THEME, OPENING, SURGEON_COLOR_BY_ID, OUTSIDE_SURGEON_COLOR, FALLBACK_SURGEON_COLORS, rosterColors, rosterNameColor, pillBorder, css, SAFE_AREA, EASTVAC_COLORS, EASTVAC_SEG_TONES, eastVacMarkStyle, eastVacSegStyle, OFFER_BRUSH };
}

/* ═══════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════ */
