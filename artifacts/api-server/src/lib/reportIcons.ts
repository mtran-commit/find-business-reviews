/**
 * Shared monochrome icon set for the paid report renderers.
 *
 * Each icon is a list of pure SVG path `d` strings on a 24x24 viewBox,
 * stroke-styled (2px, round caps). The HTML renderer wraps them in an
 * inline <svg>; the PDF renderer strokes the same paths via pdf-lib's
 * drawSvgPath. Keep paths ONLY (no <rect>/<circle>/transform) so both
 * renderers stay in sync.
 */
export const ICON_PATHS: Record<string, string[]> = {
  doc: [
    "M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z",
    "M13 2v6h6",
  ],
  scale: [
    "M3 6h18",
    "M12 3v18",
    "M5 6l-2 6a3.5 3.5 0 0 0 7 0L8 6",
    "M16 6l-2 6a3.5 3.5 0 0 0 7 0l-2-6",
  ],
  check: ["M20 6L9 17l-5-5"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  star: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"],
  alert: [
    "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    "M12 9v4",
    "M12 17h.01",
  ],
  users: [
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
    "M13 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0z",
    "M23 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ],
  speech: [
    "M8 12h8",
    "M8 8h8",
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  ],
  chart: ["M3 3v18h18", "M7 15l4-4 3 3 5-6"],
  gift: [
    "M3 8h18v4H3z",
    "M12 8v13",
    "M5 12v9h14v-9",
    "M12 8c-2 0-4-1-4-3a2 2 0 0 1 4 0",
    "M12 8c2 0 4-1 4-3a2 2 0 0 0-4 0",
  ],
  up: ["M12 19V5", "M5 12l7-7 7 7"],
  calendar: [
    "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    "M16 2v4",
    "M8 2v4",
    "M3 10h18",
  ],
  reply: ["M9 17l-5-5 5-5", "M20 18v-2a4 4 0 0 0-4-4H4"],
  flag: [
    "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z",
    "M4 22v-7",
  ],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  gauge: [
    "M12 15l4-6",
    "M13.5 15a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0z",
    "M3.5 19a10 10 0 1 1 17 0",
  ],
  reviews: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
    "M14 2v6h6",
    "M8 13h8",
    "M8 17h5",
  ],
  target: [
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
    "M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
    "M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  ],
};

/** Section number → icon name (17 report sections). */
export const SECTION_ICON_NAMES: Record<number, string> = {
  1: "chart",
  2: "doc",
  3: "scale",
  4: "check",
  5: "chat",
  6: "speech",
  7: "star",
  8: "alert",
  9: "users",
  10: "speech",
  11: "target",
  12: "gift",
  13: "up",
  14: "calendar",
  15: "flag",
  16: "reply",
  17: "shield",
};
