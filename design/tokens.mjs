export const DESIGN_VERSION = 1;

export const COLORS = Object.freeze({
  dark: Object.freeze({
    accent: "#57c7f2",
    background: "#0f1216",
    border: "#343b44",
    componentBorder: "#66727e",
    decide: "#f2a65a",
    muted: "#98a1ab",
    panel: "#14181d",
    resolve: "#ef6b73",
    scope: "#94a8bc",
    text: "#edf1f5",
    verify: "#65aaf2",
  }),
  light: Object.freeze({
    accent: "#087596",
    background: "#f9f9f8",
    border: "#dbdbd7",
    componentBorder: "#90908c",
    decide: "#9a5700",
    muted: "#706f6c",
    panel: "#fdfdfc",
    resolve: "#b4232c",
    scope: "#4f6578",
    text: "#1b1b18",
    verify: "#145da0",
  }),
});

export const CODE_THEME = Object.freeze({
  dark: Object.freeze({
    addedBackground: "#12261e",
    background: "#0d1117",
    foreground: "#e6edf3",
    hunkBackground: "#121d2f",
    removedBackground: "#2d1618",
  }),
  light: Object.freeze({
    addedBackground: "#dafbe1",
    background: "#ffffff",
    foreground: "#1f2328",
    hunkBackground: "#ddf4ff",
    removedBackground: "#ffebe9",
  }),
  name: "github",
});

export const SPACE = Object.freeze([4, 8, 12, 16, 24, 32]);

export const TYPE = Object.freeze({
  brand: Object.freeze({ fontSize: 15, lineHeight: 1 }),
  body: Object.freeze({
    narrow: Object.freeze({ fontSize: 16, lineHeight: 1.55 }),
    wide: Object.freeze({ fontSize: 14, lineHeight: 1.55 }),
  }),
  code: Object.freeze({
    narrow: Object.freeze({ fontSize: 14, lineHeight: 1.35 }),
    wide: Object.freeze({ fontSize: 13, lineHeight: 1.35 }),
  }),
  menu: Object.freeze({ fontSize: 13, lineHeight: 1.4 }),
  micro: Object.freeze({
    compactFontSize: 12,
    fontSize: 11,
    lineHeight: 1.4,
  }),
  pageTitle: Object.freeze({
    narrow: Object.freeze({ fontSize: 28, lineHeight: 1.25 }),
    wide: Object.freeze({ fontSize: 24, lineHeight: 1.25 }),
  }),
  sectionTitle: Object.freeze({
    narrow: Object.freeze({ fontSize: 20, lineHeight: 1.35 }),
    wide: Object.freeze({ fontSize: 18, lineHeight: 1.35 }),
  }),
  supporting: Object.freeze({
    narrow: Object.freeze({ fontSize: 14, lineHeight: 1.5 }),
    wide: Object.freeze({ fontSize: 12, lineHeight: 1.5 }),
  }),
  subsectionTitle: Object.freeze({
    narrow: Object.freeze({ fontSize: 17, lineHeight: 1.4 }),
    wide: Object.freeze({ fontSize: 15, lineHeight: 1.4 }),
  }),
});

export const LAYOUT = Object.freeze({
  compactBreakpoint: 520,
  contentWidth: 1020,
  documentWidth: 1440,
  narrowBreakpoint: 900,
  proseWidth: "80ch",
  tableOfContentsWidth: 230,
  tocBreakpoint: 1100,
});
