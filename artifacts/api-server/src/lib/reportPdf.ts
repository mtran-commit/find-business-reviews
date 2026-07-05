import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import {
  PLATFORM_CHECKLIST_INTRO,
  TRUST_SCORE_EXPLANATION,
  computeAnalytics,
  type BusinessReport,
  type AiSections,
  type ReportMetrics,
} from "./reportContent";

const PAGE_W = 595.28; // A4 width (pt)
const PAGE_H = 841.89; // A4 height (pt)
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 30;
const BOTTOM_LIMIT = FOOTER_H + 26; // content must stay above this

const NAVY = rgb(0x07 / 255, 0x1a / 255, 0x3d / 255);
const DEEP_NAVY = rgb(0x03 / 255, 0x12 / 255, 0x2e / 255);
const PURPLE = rgb(0x7b / 255, 0x3c / 255, 0xff / 255);
const PURPLE_LIGHT = rgb(0x9a / 255, 0x5c / 255, 0xff / 255);
const LIGHT_PURPLE = rgb(0xf1 / 255, 0xe8 / 255, 0xff / 255);
const LAVENDER = rgb(0.91, 0.89, 0.98);
const LAVENDER_DIM = rgb(0.66, 0.62, 0.83);
const BLACK = rgb(0.05, 0.05, 0.05);
const GREY = rgb(0.37, 0.39, 0.41);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0x16 / 255, 0xa3 / 255, 0x4a / 255);
const ORANGE = rgb(0xf9 / 255, 0x73 / 255, 0x16 / 255);
const RED = rgb(0xdc / 255, 0x26 / 255, 0x26 / 255);
const CARD_BORDER = rgb(0.9, 0.9, 0.9);
const CARD_FILL = rgb(0.985, 0.982, 0.975);
const ZEBRA = rgb(0.975, 0.97, 0.99);

function riskColor(level: string): RGB {
  if (level === "High") return RED;
  if (level === "Medium") return ORANGE;
  return GREEN;
}

const PRIORITY_COLORS: Record<string, RGB> = {
  High: PURPLE,
  Medium: ORANGE,
  Low: GREY,
  "Not relevant": rgb(0.61, 0.64, 0.69),
};

interface Layout {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  sectionNo: number;
}

/** Max height a single drawn block can occupy on one page. */
const MAX_BLOCK_H = PAGE_H - MARGIN - BOTTOM_LIMIT - 10;

function sanitize(text: string): string {
  return (text || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25CF]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

/** Filled rounded rectangle built from circles + rectangles (pdf-lib has no radius option). */
function fillRounded(
  page: PDFPage,
  x: number,
  y: number, // bottom
  w: number,
  h: number,
  r: number,
  color: RGB,
  opacity?: number,
): void {
  const rad = Math.max(0, Math.min(r, h / 2, w / 2));
  const opts = opacity !== undefined ? { opacity } : {};
  if (rad > 0) {
    page.drawCircle({ x: x + rad, y: y + rad, size: rad, color, ...opts });
    page.drawCircle({ x: x + w - rad, y: y + rad, size: rad, color, ...opts });
    page.drawCircle({ x: x + rad, y: y + h - rad, size: rad, color, ...opts });
    page.drawCircle({ x: x + w - rad, y: y + h - rad, size: rad, color, ...opts });
    page.drawRectangle({ x: x + rad, y, width: w - rad * 2, height: h, color, ...opts });
    page.drawRectangle({ x, y: y + rad, width: w, height: h - rad * 2, color, ...opts });
  } else {
    page.drawRectangle({ x, y, width: w, height: h, color, ...opts });
  }
}

/** Rounded card: border colour underneath, fill colour inset. */
function roundedCard(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: RGB,
  border?: RGB,
  bw = 1,
): void {
  if (border) {
    fillRounded(page, x, y, w, h, r, border);
    fillRounded(page, x + bw, y + bw, w - bw * 2, h - bw * 2, Math.max(0, r - bw), fill);
  } else {
    fillRounded(page, x, y, w, h, r, fill);
  }
}

/** Pill badge. Returns pill width. */
function pill(
  page: PDFPage,
  x: number,
  yBottom: number,
  text: string,
  font: PDFFont,
  size: number,
  bg: RGB,
  fg: RGB,
  opacity?: number,
): number {
  const t = sanitize(text);
  const padX = 7;
  const h = size + 7;
  const w = font.widthOfTextAtSize(t, size) + padX * 2;
  fillRounded(page, x, yBottom, w, h, h / 2, bg, opacity);
  page.drawText(t, { x: x + padX, y: yBottom + 3.4, size, font, color: fg });
  return w;
}

function newPage(l: Layout): void {
  l.page = l.doc.addPage([PAGE_W, PAGE_H]);
  l.y = PAGE_H - MARGIN;
}

function ensureSpace(l: Layout, needed: number): void {
  if (l.y - needed < BOTTOM_LIMIT) newPage(l);
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawParagraph(
  l: Layout,
  text: string,
  opts: { size?: number; color?: RGB; indent?: number; gap?: number; bold?: boolean } = {},
): void {
  const size = opts.size ?? 10.5;
  const color = opts.color ?? BLACK;
  const indent = opts.indent ?? 0;
  const font = opts.bold ? l.bold : l.font;
  const lineHeight = size * 1.45;
  const lines = wrapLines(text, font, size, CONTENT_W - indent);
  for (const line of lines) {
    ensureSpace(l, lineHeight);
    l.page.drawText(line, { x: MARGIN + indent, y: l.y - size, size, font, color });
    l.y -= lineHeight;
  }
  l.y -= opts.gap ?? 4;
}

function drawSectionHeading(l: Layout, title: string): void {
  l.sectionNo += 1;
  ensureSpace(l, 52);
  l.y -= 12;
  const chip = 21;
  fillRounded(l.page, MARGIN, l.y - chip + 3, chip, chip, 6, PURPLE);
  const numStr = String(l.sectionNo);
  const numW = l.bold.widthOfTextAtSize(numStr, 10.5);
  l.page.drawText(numStr, {
    x: MARGIN + (chip - numW) / 2,
    y: l.y - chip + 9.5,
    size: 10.5,
    font: l.bold,
    color: WHITE,
  });
  l.page.drawText(sanitize(title), {
    x: MARGIN + chip + 10,
    y: l.y - 14,
    size: 14,
    font: l.bold,
    color: NAVY,
  });
  l.y -= chip + 9;
  // Accent rule: short purple segment + thin grey remainder.
  l.page.drawRectangle({ x: MARGIN, y: l.y + 4, width: 42, height: 2, color: PURPLE });
  l.page.drawRectangle({ x: MARGIN + 46, y: l.y + 4.5, width: CONTENT_W - 46, height: 0.7, color: CARD_BORDER });
  l.y -= 10;
}

/** Deterministic trust-range label from the real trust score (matches the HTML view). */
function trustLabel(score: number | null): string {
  if (score === null) return "No data";
  if (score >= 85) return "Very Trusted";
  if (score >= 70) return "Trusted";
  if (score >= 55) return "Building trust";
  if (score >= 40) return "Mixed signals";
  return "Needs attention";
}

function drawKpiCards(l: Layout, m: ReportMetrics, s: AiSections): void {
  const cards = [
    {
      label: "TRUST SCORE",
      value: m.trustScore !== null ? String(m.trustScore) : "-",
      denom: m.trustScore !== null ? "/100" : "",
      sub: trustLabel(m.trustScore),
    },
    {
      label: "AVERAGE RATING",
      value: m.averageRating !== null ? String(m.averageRating) : "-",
      denom: m.averageRating !== null ? "/5" : "",
      sub: m.averageRating !== null ? "Available platforms" : "No rating data",
    },
    {
      label: "REVIEWS ANALYSED",
      value: m.totalReviews.toLocaleString("en-AU"),
      denom: "",
      sub: `${m.platformCount} platform${m.platformCount === 1 ? "" : "s"} with data`,
    },
    {
      label: "SENTIMENT",
      value: sanitize(s.customerSentimentLabel || "-"),
      denom: "",
      sub: `Data quality: ${m.dataQuality}`,
    },
  ];
  const gap = 10;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const cardH = 70;
  ensureSpace(l, cardH + 10);
  const top = l.y;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    roundedCard(l.page, x, top - cardH, cardW, cardH, 9, WHITE, CARD_BORDER);
    // Purple accent bar across the card top.
    fillRounded(l.page, x + 10, top - 7, 26, 3, 1.5, PURPLE);
    l.page.drawText(c.label, { x: x + 10, y: top - 21, size: 6.5, font: l.bold, color: GREY });
    let vSize = 20;
    if (l.bold.widthOfTextAtSize(c.value, vSize) > cardW - 20 - (c.denom ? 20 : 0)) vSize = 11;
    l.page.drawText(c.value, { x: x + 10, y: top - 44, size: vSize, font: l.bold, color: NAVY });
    if (c.denom) {
      const vw = l.bold.widthOfTextAtSize(c.value, vSize);
      l.page.drawText(c.denom, { x: x + 12 + vw, y: top - 44, size: 9, font: l.bold, color: GREY });
    }
    const subLines = wrapLines(c.sub, l.bold, 7.5, cardW - 20);
    l.page.drawText(subLines[0] ?? "", { x: x + 10, y: top - 59, size: 7.5, font: l.bold, color: PURPLE });
  });
  l.y = top - cardH - 14;
}

interface Col {
  header: string;
  width: number;
}

interface TableOpts {
  badgeCol?: number;
  badgeColors?: Record<string, RGB>;
}

function drawTable(l: Layout, cols: Col[], rows: string[][], opts: TableOpts = {}): void {
  const size = 9;
  const padX = 7;
  const headerH = 20;
  ensureSpace(l, headerH + 22);
  // Rounded header band.
  let x = MARGIN;
  fillRounded(l.page, MARGIN, l.y - headerH, CONTENT_W, headerH, 6, LIGHT_PURPLE);
  cols.forEach((c) => {
    l.page.drawText(sanitize(c.header), { x: x + padX, y: l.y - headerH + 7, size: 8, font: l.bold, color: NAVY });
    x += c.width;
  });
  l.y -= headerH;
  // Rows with zebra striping.
  rows.forEach((row, ri) => {
    const cellLines = row.map((cell, i) =>
      wrapLines(cell, l.font, size, cols[i]!.width - padX * 2),
    );
    const maxLines = Math.max(1, ...cellLines.map((ls) => ls.length));
    const rowH = maxLines * (size * 1.35) + 9;
    ensureSpace(l, rowH);
    if (ri % 2 === 1) {
      l.page.drawRectangle({ x: MARGIN, y: l.y - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
    }
    x = MARGIN;
    cellLines.forEach((lines, i) => {
      if (opts.badgeCol === i) {
        const val = sanitize(row[i] ?? "");
        const bg = (opts.badgeColors && opts.badgeColors[val]) || GREY;
        pill(l.page, x + padX, l.y - 6 - 12, val || "-", l.bold, 7, bg, WHITE);
      } else {
        lines.forEach((line, li) => {
          l.page.drawText(line, {
            x: x + padX,
            y: l.y - 5 - size - li * (size * 1.35),
            size,
            font: i === 0 ? l.bold : l.font,
            color: i === 0 ? NAVY : BLACK,
          });
        });
      }
      x += cols[i]!.width;
    });
    l.y -= rowH;
    l.page.drawRectangle({ x: MARGIN, y: l.y, width: CONTENT_W, height: 0.6, color: CARD_BORDER });
  });
  l.y -= 10;
}

/** Light-purple callout box with a bold purple kicker line. */
function drawCallout(l: Layout, kicker: string, text: string): void {
  const size = 9.5;
  const inner = CONTENT_W - 28;
  const lines = wrapLines(text, l.font, size, inner);
  const h = 24 + lines.length * (size * 1.45) + 10;
  if (h > MAX_BLOCK_H) {
    // Too tall for a single boxed callout — fall back to flowing paragraphs.
    drawParagraph(l, kicker.toUpperCase(), { size: 7.5, color: PURPLE, bold: true, gap: 2 });
    drawParagraph(l, text, { size, color: NAVY, gap: 8 });
    return;
  }
  ensureSpace(l, h + 6);
  fillRounded(l.page, MARGIN, l.y - h, CONTENT_W, h, 9, LIGHT_PURPLE);
  l.page.drawText(sanitize(kicker).toUpperCase(), { x: MARGIN + 14, y: l.y - 16, size: 7.5, font: l.bold, color: PURPLE });
  lines.forEach((line, i) => {
    l.page.drawText(line, { x: MARGIN + 14, y: l.y - 30 - i * (size * 1.45), size, font: l.font, color: NAVY });
  });
  l.y -= h + 8;
}

/** Full-width card with optional coloured left accent bar. Body = list of text blocks. */
interface CardBlock {
  text: string;
  size?: number;
  color?: RGB;
  bold?: boolean;
  gapAfter?: number;
}

function drawContentCard(l: Layout, blocks: CardBlock[], accent?: RGB, badge?: { text: string; color: RGB }): void {
  const padX = 14;
  const padY = 12;
  const inner = CONTENT_W - padX * 2 - (accent ? 4 : 0);
  const measured = blocks
    .filter((b) => b.text)
    .map((b) => {
      const size = b.size ?? 10;
      const font = b.bold ? l.bold : l.font;
      const lines = wrapLines(b.text, font, size, inner);
      return { ...b, size, font, lines, height: lines.length * size * 1.45 + (b.gapAfter ?? 4) };
    });
  const badgeH = badge ? 18 : 0;
  const h = padY * 2 + badgeH + measured.reduce((a, b) => a + b.height, 0);
  if (h > MAX_BLOCK_H) {
    // Too tall for a single card — fall back to flowing paragraphs.
    if (badge) {
      ensureSpace(l, 20);
      pill(l.page, MARGIN, l.y - 13, badge.text, l.bold, 7.5, badge.color, WHITE);
      l.y -= 20;
    }
    for (const b of measured) {
      drawParagraph(l, b.text, { size: b.size, color: b.color ?? BLACK, bold: b.bold, gap: b.gapAfter ?? 4 });
    }
    l.y -= 4;
    return;
  }
  ensureSpace(l, h + 6);
  roundedCard(l.page, MARGIN, l.y - h, CONTENT_W, h, 9, WHITE, CARD_BORDER);
  if (accent) fillRounded(l.page, MARGIN + 1, l.y - h + 6, 3.5, h - 12, 1.75, accent);
  const tx = MARGIN + padX + (accent ? 4 : 0);
  let cy = l.y - padY;
  if (badge) {
    pill(l.page, tx, cy - 13, badge.text, l.bold, 7.5, badge.color, WHITE);
    cy -= badgeH;
  }
  for (const b of measured) {
    for (const line of b.lines) {
      l.page.drawText(line, { x: tx, y: cy - b.size, size: b.size, font: b.font, color: b.color ?? BLACK });
      cy -= b.size * 1.45;
    }
    cy -= b.gapAfter ?? 4;
  }
  l.y -= h + 8;
}

function drawSentimentBars(l: Layout, s: AiSections): void {
  const se = s.sentiment;
  const rows: Array<[string, number, RGB]> = [
    ["Positive", se.positive, GREEN],
    ["Neutral", se.neutral, ORANGE],
    ["Negative", se.negative, RED],
  ];
  const labelW = 58;
  const pctW = 34;
  const trackW = CONTENT_W - labelW - pctW - 14;
  for (const [label, valRaw, color] of rows) {
    const val = Math.max(0, Math.min(100, valRaw));
    ensureSpace(l, 16);
    l.page.drawText(label, { x: MARGIN, y: l.y - 9, size: 9.5, font: l.bold, color: NAVY });
    fillRounded(l.page, MARGIN + labelW, l.y - 11, trackW, 8, 4, LIGHT_PURPLE);
    if (val > 0) {
      fillRounded(l.page, MARGIN + labelW, l.y - 11, Math.max(8, trackW * (val / 100)), 8, 4, color);
    }
    const pct = `${Math.round(val)}%`;
    const pw = l.bold.widthOfTextAtSize(pct, 9.5);
    l.page.drawText(pct, { x: MARGIN + CONTENT_W - pw, y: l.y - 9, size: 9.5, font: l.bold, color: NAVY });
    l.y -= 16;
  }
  l.y -= 4;
}

function drawChipsRow(l: Layout, title: string, items: string[], color: RGB): void {
  if (!items?.length) return;
  ensureSpace(l, 30);
  l.page.drawText(sanitize(title).toUpperCase(), { x: MARGIN, y: l.y - 8, size: 7.5, font: l.bold, color: GREY });
  l.y -= 14;
  let x = MARGIN;
  for (const item of items) {
    const t = sanitize(item);
    const w = l.bold.widthOfTextAtSize(t, 8) + 14;
    if (x + w > MARGIN + CONTENT_W) {
      x = MARGIN;
      l.y -= 18;
      ensureSpace(l, 18);
    }
    // Soft chip: light fill + coloured text.
    fillRounded(l.page, x, l.y - 13, w, 15, 7.5, WHITE);
    fillRounded(l.page, x, l.y - 13, w, 15, 7.5, color, 0.12);
    l.page.drawText(t, { x: x + 7, y: l.y - 9, size: 8, font: l.bold, color });
    x += w + 6;
  }
  l.y -= 24;
}

/** Small bold sub-heading used inside the Business Analytics section. */
function drawSubHeading(l: Layout, title: string): void {
  ensureSpace(l, 30);
  l.y -= 6;
  fillRounded(l.page, MARGIN, l.y - 11, 3.5, 11, 1.75, PURPLE);
  l.page.drawText(sanitize(title), { x: MARGIN + 10, y: l.y - 10, size: 10.5, font: l.bold, color: NAVY });
  l.y -= 20;
}

/** Generic horizontal metric bar: label | track | value. */
function drawMetricBar(
  l: Layout,
  label: string,
  fraction: number, // 0..1
  valueText: string,
  color: RGB,
  labelW = 92,
): void {
  ensureSpace(l, 16);
  const valW = 54;
  const trackW = CONTENT_W - labelW - valW - 14;
  l.page.drawText(sanitize(label), { x: MARGIN, y: l.y - 9, size: 9, font: l.bold, color: NAVY });
  fillRounded(l.page, MARGIN + labelW, l.y - 11, trackW, 8, 4, LIGHT_PURPLE);
  const f = Math.max(0, Math.min(1, fraction));
  if (f > 0) fillRounded(l.page, MARGIN + labelW, l.y - 11, Math.max(8, trackW * f), 8, 4, color);
  const vt = sanitize(valueText);
  const vw = l.bold.widthOfTextAtSize(vt, 9);
  l.page.drawText(vt, { x: MARGIN + CONTENT_W - vw, y: l.y - 9, size: 9, font: l.bold, color: NAVY });
  l.y -= 16;
}

const TREND_COLORS: Record<string, RGB> = {
  Improving: GREEN,
  Stable: PURPLE,
  Declining: RED,
};

/** Section 1: Reputation Analytics — 8 dashboard widgets (deterministic + AI-estimated). */
function drawAnalytics(l: Layout, report: BusinessReport): void {
  const m = report.metrics;
  const s = report.sections;
  const a = s.analytics;
  const calc = computeAnalytics(m);
  const estNote = (text: string) =>
    drawParagraph(l, text, { size: 8, color: GREY, gap: 8 });

  drawParagraph(
    l,
    "A dashboard view of the key reputation analytics behind this report. Estimated items are based only on the public review data available.",
    { size: 9.5, color: GREY, gap: 8 },
  );

  // 1. Trust Score Trend
  drawSubHeading(l, "Trust Score Trend");
  const dirRaw = a.trustScoreTrend.direction || "Unknown";
  const noHistory = dirRaw === "Unknown" || dirRaw === "Not enough historical data";
  const dir = noHistory ? "Not enough historical data" : dirRaw;
  const trendColor = TREND_COLORS[dir] || GREY;
  ensureSpace(l, 22);
  pill(l.page, MARGIN, l.y - 15, dir, l.bold, 9, trendColor, WHITE);
  l.y -= 24;
  if (noHistory) {
    drawParagraph(l, "Trend tracking will begin from this report.", { size: 9.5, gap: 8 });
  } else {
    if (a.trustScoreTrend.explanation) drawParagraph(l, a.trustScoreTrend.explanation, { size: 9.5, gap: 4 });
    estNote("AI estimated from available review data.");
  }

  // 2. Review Volume Analytics
  drawSubHeading(l, "Review Volume Analytics");
  const rv = calc.reviewVolume;
  if (rv.topCompetitor !== null) {
    const maxN = Math.max(rv.own, rv.topCompetitor.reviews, 1);
    drawMetricBar(l, "This business", rv.own / maxN, rv.own.toLocaleString("en-AU"), PURPLE, 110);
    drawMetricBar(l, "Top competitor", rv.topCompetitor.reviews / maxN, rv.topCompetitor.reviews.toLocaleString("en-AU"), LAVENDER_DIM, 110);
    const volLabel =
      rv.comparison === "Above"
        ? "above nearby competitor average"
        : rv.comparison === "Below"
          ? "below nearby competitor average"
          : rv.comparison === "Similar"
            ? "in line with nearby competitors"
            : "comparison not available";
    const volColor = rv.comparison === "Below" ? RED : rv.comparison === "Above" ? GREEN : NAVY;
    drawParagraph(l, `${rv.own.toLocaleString("en-AU")} reviews analysed - ${volLabel}`, { size: 10, color: volColor, bold: true, gap: 4 });
    if (rv.reviewGap !== null && rv.reviewGap > 0) {
      drawParagraph(
        l,
        `~${rv.reviewGap.toLocaleString("en-AU")} more reviews estimated to match the top nearby competitor (${rv.topCompetitor.name}). Increasing recent review volume may improve trust and conversion.`,
        { size: 9.5, gap: 4 },
      );
    } else {
      drawParagraph(l, "This business has as many public reviews as the top nearby competitor.", { size: 9.5, gap: 4 });
    }
    if (a.reviewVolumeInsight) drawParagraph(l, a.reviewVolumeInsight, { size: 9.5, gap: 8 });
    else l.y -= 4;
  } else {
    drawParagraph(l, `${rv.own.toLocaleString("en-AU")} reviews analysed.`, { size: 10, bold: true, color: NAVY, gap: 4 });
    drawParagraph(
      l,
      a.reviewVolumeInsight || "No competitor review counts were available to compare against.",
      { size: 9.5, gap: 8 },
    );
  }

  // 3. Platform Rating Gap
  drawSubHeading(l, "Platform Rating Gap");
  const rg = calc.ratingGap;
  for (const v of rg.values) {
    drawMetricBar(l, v.platform, v.rating !== null ? v.rating / 5 : 0, v.rating !== null ? `${v.rating.toFixed(1)} / 5` : "-", PURPLE, 86);
  }
  if (rg.gap !== null && rg.highest && rg.lowest) {
    drawParagraph(
      l,
      `Highest: ${rg.highest.platform} ${rg.highest.rating.toFixed(1)}/5   Lowest: ${rg.lowest.platform} ${rg.lowest.rating.toFixed(1)}/5`,
      { size: 9.5, gap: 3 },
    );
    const gapText =
      rg.gap >= 0.5
        ? `Rating gap: ${rg.gap.toFixed(1)} points`
        : `Rating gap: ${rg.gap.toFixed(1)} points - consistent across platforms`;
    drawParagraph(l, gapText, { size: 10, bold: true, color: rg.gap >= 0.5 ? ORANGE : GREEN, gap: 4 });
    if (rg.gap >= 0.5) {
      drawParagraph(l, "A larger rating gap may cause customers to hesitate when comparing platforms.", { size: 9.5, gap: 4 });
    }
  } else {
    drawParagraph(l, "Fewer than 2 platforms have ratings.", { size: 9.5, color: GREY, gap: 4 });
  }
  if (a.ratingGapInsight) drawParagraph(l, a.ratingGapInsight, { size: 9.5, gap: 8 });
  else l.y -= 4;

  // 4. Sentiment Breakdown
  drawSubHeading(l, "Sentiment Breakdown");
  const se = s.sentiment;
  if (se.positive + se.neutral + se.negative > 0) {
    drawSentimentBars(l, s);
    const confColor =
      calc.sentimentConfidence === "High" ? GREEN : calc.sentimentConfidence === "Medium" ? ORANGE : RED;
    drawParagraph(l, `Confidence: ${calc.sentimentConfidence}`, { size: 9.5, bold: true, color: confColor, gap: 3 });
    if (se.estimated) estNote("Estimated from available public review samples.");
  } else {
    drawParagraph(l, "Not enough review text to estimate sentiment.", { size: 9.5, color: GREY, gap: 8 });
  }

  // 5. Complaint Frequency
  drawSubHeading(l, "Complaint Frequency");
  const freq = a.complaintFrequency;
  if (freq.length) {
    drawTable(
      l,
      [
        { header: "Issue", width: 150 },
        { header: "Frequency", width: 70 },
        { header: "Note", width: CONTENT_W - 150 - 70 },
      ],
      freq.map((c) => [c.issue, c.frequency || "-", c.note || "-"]),
      { badgeCol: 1, badgeColors: { High: RED, Medium: ORANGE, Low: GREEN } },
    );
  } else {
    drawParagraph(l, "No repeated complaint themes were identified in the available review samples.", { size: 9.5, color: GREY, gap: 8 });
  }

  // 6. Competitor Gap
  drawSubHeading(l, "Competitor Gap");
  const cg = calc.competitorGap;
  if (cg.ownTrustScore !== null && cg.topCompetitor && cg.gap !== null) {
    const maxScore = Math.max(cg.ownTrustScore, cg.topCompetitor.trustScore, 1);
    drawMetricBar(l, "Your Trust Score", cg.ownTrustScore / maxScore, `${cg.ownTrustScore}/100`, PURPLE, 110);
    drawMetricBar(l, "Top competitor", cg.topCompetitor.trustScore / maxScore, `${cg.topCompetitor.trustScore}/100`, LAVENDER_DIM, 110);
    const ahead = cg.gap <= 0;
    drawParagraph(
      l,
      ahead
        ? `You lead ${cg.topCompetitor.name} by ${Math.abs(cg.gap)} points.`
        : `Gap to ${cg.topCompetitor.name}: ${cg.gap} points.`,
      { size: 10, bold: true, color: ahead ? GREEN : ORANGE, gap: 4 },
    );
    estNote("Sentiment comparison is not available for competitors from public data.");
  } else {
    drawParagraph(l, "No competitor Trust Scores were available to compare against for this report.", { size: 9.5, color: GREY, gap: 8 });
  }

  // 7. Lost Customer Risk
  drawSubHeading(l, "Lost Customer Risk");
  const lcr = a.lostCustomerRisk;
  if (lcr.level || lcr.factors.length) {
    if (lcr.level) {
      ensureSpace(l, 22);
      pill(l.page, MARGIN, l.y - 15, `${lcr.level} risk`, l.bold, 9, riskColor(lcr.level), WHITE);
      l.y -= 24;
    }
    for (const f of lcr.factors) {
      drawParagraph(l, `- ${f}`, { size: 9.5, indent: 4, gap: 2 });
    }
    l.y -= 2;
    estNote("AI estimated from available review data.");
  } else {
    drawParagraph(l, "Not enough data to estimate what may be stopping customers.", { size: 9.5, color: GREY, gap: 8 });
  }

  // 8. Growth Opportunity Score
  drawSubHeading(l, "Growth Opportunity Score");
  const go = a.growthOpportunity;
  const goLevel =
    go.level ||
    (go.score !== null ? (go.score >= 70 ? "High" : go.score >= 40 ? "Medium" : "Low") : "");
  if (goLevel) {
    const goColor = goLevel === "High" ? GREEN : goLevel === "Medium" ? ORANGE : GREY;
    ensureSpace(l, 22);
    pill(l.page, MARGIN, l.y - 15, `${goLevel} opportunity`, l.bold, 9, goColor, WHITE);
    l.y -= 24;
    if (go.score !== null) drawMetricBar(l, "Opportunity", go.score / 100, `${Math.round(go.score)}%`, PURPLE);
    if (go.focusAreas.length) drawChipsRow(l, "Fastest improvement areas", go.focusAreas, PURPLE);
    if (go.rationale) drawParagraph(l, go.rationale, { size: 9.5, gap: 4 });
    estNote("AI estimated from available review data.");
  } else {
    drawParagraph(l, "Not enough data to estimate a growth opportunity level yet.", { size: 9.5, color: GREY, gap: 8 });
  }
}

/** Customer Voice Analysis — what customers actually say (tags, love, concerns, priorities, actions). */
function drawCustomerVoice(l: Layout, s: AiSections): void {
  const cv = s.customerVoiceAnalysis;
  const tags = cv.reviewTags || [];
  const love = cv.whatCustomersLove || [];
  const concerns = cv.customerConcerns || [];
  const expects = cv.clientExpectationMap || [];
  const prios = cv.improvementPriorities || [];
  const ar = cv.actionRecommendations;
  const li = cv.customerLanguageInsights;
  const hasActions =
    (ar.websiteChanges?.length || 0) +
      (ar.reviewProcess?.length || 0) +
      (ar.staffCommunication?.length || 0) +
      (ar.marketingActions?.length || 0) +
      (ar.competitorMonitoring?.length || 0) >
    0;
  const hasLang =
    (li.wordsCustomersUse?.length || 0) +
      (li.phrasesToUseInMarketing?.length || 0) +
      (li.phrasesToAvoid?.length || 0) >
    0;

  if (
    !tags.length &&
    !love.length &&
    !concerns.length &&
    !expects.length &&
    !prios.length &&
    !hasActions &&
    !hasLang
  ) {
    drawParagraph(
      l,
      "Customer voice analysis was not available for this report. It is generated from public review text and Google review topic tags when the report is created.",
      { size: 9.5, color: GREY, gap: 8 },
    );
    return;
  }

  drawParagraph(
    l,
    "What customers are actually saying - built from public review text, Google review topic tags and repeated customer language.",
    { size: 9.5, color: GREY, gap: 8 },
  );

  // 1. Review tag analysis table
  if (tags.length) {
    drawSubHeading(l, "Most Mentioned Customer Themes");
    drawParagraph(
      l,
      "Google review topic tags - themes customers repeat in their reviews, with how many reviews mention each one.",
      { size: 8.5, color: GREY, gap: 6 },
    );
    drawTable(
      l,
      [
        { header: "TAG / TOPIC", width: CONTENT_W * 0.2 },
        { header: "MENTIONS", width: CONTENT_W * 0.11 },
        { header: "CUSTOMER MEANING", width: CONTENT_W * 0.39 },
        { header: "BUSINESS ACTION", width: CONTENT_W * 0.3 },
      ],
      tags.map((t) => [
        t.tag,
        t.count > 0 ? String(t.count) : "-",
        t.customerMeaning || "-",
        t.businessAction || "-",
      ]),
    );
  }

  // 2. What customers love most
  if (love.length) {
    drawSubHeading(l, "What Customers Love Most");
    for (const lv of love) {
      drawContentCard(
        l,
        [
          { text: lv.theme, size: 11, color: NAVY, bold: true, gapAfter: 3 },
          { text: lv.explanation, size: 9.5 },
          { text: lv.evidence || "", size: 8.5, color: GREY },
          { text: lv.opportunity ? "Opportunity: " + lv.opportunity : "", size: 9, color: NAVY },
        ],
        GREEN,
      );
    }
  }

  // 3. Concerns (never invented)
  if (concerns.length || cv.concernsNote) {
    drawSubHeading(l, "What Customers May Be Concerned About");
    for (const c of concerns) {
      drawContentCard(
        l,
        [
          { text: c.theme, size: 11, color: NAVY, bold: true, gapAfter: 3 },
          { text: c.explanation, size: 9.5 },
          { text: c.recommendedFix ? "Recommended fix: " + c.recommendedFix : "", size: 9, color: NAVY },
        ],
        riskColor(c.riskLevel),
        c.riskLevel ? { text: `${c.riskLevel} risk`, color: riskColor(c.riskLevel) } : undefined,
      );
    }
    if (cv.concernsNote) drawParagraph(l, cv.concernsNote, { size: 8.5, color: GREY, gap: 8 });
  }

  // 4. Client expectation map
  if (expects.length) {
    drawSubHeading(l, "Client Expectation Map");
    drawChipsRow(l, "What customers appear to expect", expects, PURPLE);
  }

  // 5. Improvement priorities (ranked)
  if (prios.length) {
    drawSubHeading(l, "Improvement Priorities");
    prios.forEach((p, i) => {
      const pc =
        p.level === "High" ? RED : p.level === "Medium" ? ORANGE : p.level === "Low" ? GREEN : PURPLE;
      drawContentCard(
        l,
        [
          { text: `Priority ${i + 1}: ${p.priority}`, size: 10.5, color: NAVY, bold: true, gapAfter: 3 },
          { text: p.whyItMatters ? "Why: " + p.whyItMatters : "", size: 9.5 },
          { text: p.action ? "Action: " + p.action : "", size: 9.5 },
          { text: p.expectedImpact ? "Impact: " + p.expectedImpact : "", size: 9, color: GREY },
        ],
        pc,
        p.level ? { text: p.level, color: pc } : undefined,
      );
    });
  }

  // 6. Action recommendations
  if (hasActions) {
    drawSubHeading(l, "Action Recommendations");
    const group = (label: string, items: string[] | undefined) => {
      if (!items?.length) return;
      drawContentCard(l, [
        { text: label, size: 9.5, color: NAVY, bold: true, gapAfter: 3 },
        ...items.map((it) => ({ text: "- " + it, size: 9.5 })),
      ]);
    };
    group("Website changes", ar.websiteChanges);
    group("Review request process", ar.reviewProcess);
    group("Staff communication", ar.staffCommunication);
    group("Marketing actions", ar.marketingActions);
    group("Competitor monitoring", ar.competitorMonitoring);
  }

  // 7. Customer language insights
  if (hasLang) {
    drawSubHeading(l, "Customer Language Insights");
    drawChipsRow(l, "Words customers use", li.wordsCustomersUse || [], PURPLE);
    drawChipsRow(l, "Marketing phrases to use", li.phrasesToUseInMarketing || [], GREEN);
    drawChipsRow(l, "Phrases to avoid", li.phrasesToAvoid || [], RED);
  }
}

/** Dark navy card with label/value rows (Final Recommendation, competitor conclusion). */
function drawNavyCard(l: Layout, rows: Array<{ label?: string; text: string }>): void {
  const padX = 16;
  const size = 9.5;
  const inner = CONTENT_W - padX * 2;
  const measured = rows.map((r) => {
    const lines = wrapLines(r.text, l.font, size, r.label ? inner - 110 : inner);
    return { ...r, lines };
  });
  const rowHeights = measured.map((r) => Math.max(r.lines.length * size * 1.5, 14) + 8);
  const h = 20 + rowHeights.reduce((a, b) => a + b, 0);
  if (h > MAX_BLOCK_H) {
    // Too tall for a single navy card — fall back to flowing paragraphs.
    for (const r of rows) {
      if (r.label) drawParagraph(l, r.label.toUpperCase(), { size: 7.5, color: PURPLE, bold: true, gap: 2 });
      drawParagraph(l, r.text, { size, color: NAVY, gap: 6 });
    }
    return;
  }
  ensureSpace(l, h + 6);
  fillRounded(l.page, MARGIN, l.y - h, CONTENT_W, h, 10, NAVY);
  let cy = l.y - 14;
  measured.forEach((r, i) => {
    if (r.label) {
      l.page.drawText(sanitize(r.label).toUpperCase(), { x: MARGIN + padX, y: cy - size, size: 7.5, font: l.bold, color: PURPLE_LIGHT });
      r.lines.forEach((line, li) => {
        l.page.drawText(line, { x: MARGIN + padX + 110, y: cy - size - li * size * 1.5, size, font: l.font, color: LAVENDER });
      });
    } else {
      r.lines.forEach((line, li) => {
        l.page.drawText(line, { x: MARGIN + padX, y: cy - size - li * size * 1.5, size, font: l.font, color: LAVENDER });
      });
    }
    cy -= rowHeights[i]!;
    if (i < measured.length - 1) {
      l.page.drawRectangle({ x: MARGIN + padX, y: cy + 4, width: inner, height: 0.6, color: rgb(1, 1, 1), opacity: 0.15 });
    }
  });
  l.y -= h + 8;
}

/** Timeline row: purple day pill + boxed action text. */
function drawTimeline(l: Layout, items: Array<{ day: string; action: string }>): void {
  const pillW = 52;
  const boxX = MARGIN + pillW + 12;
  const boxW = CONTENT_W - pillW - 12;
  const size = 9.5;
  items.forEach((item, idx) => {
    const lines = wrapLines(item.action, l.font, size, boxW - 24);
    const boxH = lines.length * size * 1.45 + 14;
    ensureSpace(l, boxH + 6);
    // Connector dot + line.
    const cx = MARGIN + pillW + 6;
    if (idx > 0) {
      l.page.drawRectangle({ x: cx - 0.6, y: l.y - 2, width: 1.2, height: 8, color: LIGHT_PURPLE });
    }
    l.page.drawCircle({ x: cx, y: l.y - boxH / 2, size: 3, color: PURPLE });
    pill(l.page, MARGIN, l.y - boxH / 2 - 8, item.day, l.bold, 8, LIGHT_PURPLE, PURPLE);
    roundedCard(l.page, boxX, l.y - boxH, boxW, boxH, 8, CARD_FILL, CARD_BORDER);
    lines.forEach((line, li) => {
      l.page.drawText(line, { x: boxX + 12, y: l.y - 12 - size + 3 - li * size * 1.45, size, font: l.font, color: BLACK });
    });
    l.y -= boxH + 6;
  });
  l.y -= 4;
}

/** Two-column week cards with purple left bar. */
function drawWeekCards(l: Layout, items: Array<{ week: string; focus: string }>): void {
  const gap = 12;
  const cardW = (CONTENT_W - gap) / 2;
  const size = 9.5;
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    const measured = pair.map((w) => wrapLines(w.focus, l.font, size, cardW - 30));
    const h = Math.max(...measured.map((ls) => ls.length)) * size * 1.45 + 34;
    ensureSpace(l, h + 6);
    pair.forEach((w, j) => {
      const x = MARGIN + j * (cardW + gap);
      roundedCard(l.page, x, l.y - h, cardW, h, 8, WHITE, CARD_BORDER);
      fillRounded(l.page, x + 1, l.y - h + 6, 3.5, h - 12, 1.75, PURPLE);
      l.page.drawText(sanitize(w.week).toUpperCase(), { x: x + 14, y: l.y - 17, size: 8, font: l.bold, color: PURPLE });
      measured[j]!.forEach((line, li) => {
        l.page.drawText(line, { x: x + 14, y: l.y - 31 - li * size * 1.45, size, font: l.font, color: BLACK });
      });
    });
    l.y -= h + 8;
  }
  l.y -= 2;
}

/** Purple gradient-style offer card (solid purple with lighter inner panel). */
function drawOfferCard(l: Layout, offer: string, why: string, exampleCopy: string): void {
  const padX = 16;
  const inner = CONTENT_W - padX * 2;
  const offerLines = wrapLines(offer, l.bold, 12.5, inner);
  const whyLines = why ? wrapLines("Why it works: " + why, l.font, 9.5, inner) : [];
  const copyLines = exampleCopy ? wrapLines('"' + exampleCopy + '"', l.font, 9.5, inner - 24) : [];
  const copyBoxH = copyLines.length ? copyLines.length * 9.5 * 1.45 + 16 : 0;
  const h =
    16 + 12 + offerLines.length * 12.5 * 1.4 + 6 +
    whyLines.length * 9.5 * 1.45 + (copyBoxH ? copyBoxH + 10 : 0) + 14;
  if (h > MAX_BLOCK_H) {
    // Too tall for a single offer card — fall back to flowing paragraphs.
    drawParagraph(l, "RECOMMENDED OFFER", { size: 7.5, color: PURPLE, bold: true, gap: 2 });
    drawParagraph(l, offer, { size: 12, color: NAVY, bold: true, gap: 4 });
    if (why) drawParagraph(l, "Why it works: " + why, { size: 9.5, gap: 4 });
    if (exampleCopy) drawParagraph(l, '"' + exampleCopy + '"', { size: 9.5, color: GREY, gap: 8 });
    return;
  }
  ensureSpace(l, h + 6);
  fillRounded(l.page, MARGIN, l.y - h, CONTENT_W, h, 11, PURPLE);
  // Lighter sheen strip at the top for a gradient feel.
  fillRounded(l.page, MARGIN, l.y - h / 2, CONTENT_W, h / 2, 11, PURPLE_LIGHT, 0.35);
  let cy = l.y - 16;
  l.page.drawText("RECOMMENDED OFFER", { x: MARGIN + padX, y: cy - 7, size: 7, font: l.bold, color: LAVENDER });
  cy -= 19;
  for (const line of offerLines) {
    l.page.drawText(line, { x: MARGIN + padX, y: cy - 12.5, size: 12.5, font: l.bold, color: WHITE });
    cy -= 12.5 * 1.4;
  }
  cy -= 4;
  for (const line of whyLines) {
    l.page.drawText(line, { x: MARGIN + padX, y: cy - 9.5, size: 9.5, font: l.font, color: LAVENDER });
    cy -= 9.5 * 1.45;
  }
  if (copyBoxH) {
    cy -= 8;
    fillRounded(l.page, MARGIN + padX, cy - copyBoxH, inner, copyBoxH, 8, WHITE);
    copyLines.forEach((line, li) => {
      l.page.drawText(line, { x: MARGIN + padX + 12, y: cy - 12 - 9.5 + 3 - li * 9.5 * 1.45, size: 9.5, font: l.font, color: NAVY });
    });
  }
  l.y -= h + 8;
}

/** Build the paid AI Customer Review Sentiment Report as a premium dashboard-style PDF. */
export async function buildReportPdf(report: BusinessReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const l: Layout = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    font,
    bold,
    sectionNo: 0,
  };
  const m = report.metrics;
  const s = report.sections;

  // ---- Premium header band (vertical gradient deep navy -> lighter navy) ----
  const bandH = 158;
  const steps = 32;
  const c0 = { r: 0x03 / 255, g: 0x12 / 255, b: 0x2e / 255 };
  const c1 = { r: 0x12 / 255, g: 0x23 / 255, b: 0x5c / 255 };
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const stripW = PAGE_W / steps + 1;
    l.page.drawRectangle({
      x: i * (PAGE_W / steps),
      y: PAGE_H - bandH,
      width: stripW,
      height: bandH,
      color: rgb(c0.r + (c1.r - c0.r) * t, c0.g + (c1.g - c0.g) * t, c0.b + (c1.b - c0.b) * t),
    });
  }
  // Purple accent line at the base of the band.
  l.page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: 3, color: PURPLE });

  // Brand row.
  l.page.drawText("AI CUSTOMER REVIEW SENTIMENT REPORT", { x: MARGIN, y: PAGE_H - 34, size: 8.5, font: bold, color: LAVENDER });
  const paidText = "PAID REPORT";
  const paidW = bold.widthOfTextAtSize(paidText, 8) + 18;
  fillRounded(l.page, PAGE_W - MARGIN - paidW, PAGE_H - 40, paidW, 17, 8.5, PURPLE);
  l.page.drawText(paidText, { x: PAGE_W - MARGIN - paidW + 9, y: PAGE_H - 35, size: 8, font: bold, color: WHITE });

  // Title + business.
  l.page.drawText("AI Customer Review Sentiment Report", { x: MARGIN, y: PAGE_H - 66, size: 23, font: bold, color: WHITE });
  l.page.drawText(sanitize(`Prepared for ${report.businessName}`), { x: MARGIN, y: PAGE_H - 86, size: 12, font: bold, color: LAVENDER });
  if (report.businessAddress) {
    l.page.drawText(sanitize(report.businessAddress), { x: MARGIN, y: PAGE_H - 101, size: 9, font, color: LAVENDER_DIM });
  }

  // Meta chips row.
  const generated = new Date(report.generatedAt);
  const dateStr = isNaN(generated.getTime())
    ? ""
    : generated.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  let chipX = MARGIN;
  const chipY = PAGE_H - 138;
  const metaChip = (text: string, dotColor?: RGB) => {
    const t = sanitize(text);
    const dotSpace = dotColor ? 10 : 0;
    const w = font.widthOfTextAtSize(t, 8) + 16 + dotSpace;
    fillRounded(l.page, chipX, chipY, w, 16, 8, WHITE, 0.12);
    if (dotColor) l.page.drawCircle({ x: chipX + 10, y: chipY + 8, size: 2.6, color: dotColor });
    l.page.drawText(t, { x: chipX + 8 + dotSpace, y: chipY + 4.8, size: 8, font, color: LAVENDER });
    chipX += w + 7;
  };
  if (dateStr) metaChip(`Generated ${dateStr}`);
  metaChip(
    `Data quality: ${m.dataQuality}`,
    m.dataQuality === "High" ? GREEN : m.dataQuality === "Medium" ? ORANGE : RED,
  );
  metaChip("Platforms: Google, Yelp, TripAdvisor");

  l.y = PAGE_H - bandH - 20;

  // ---- KPI cards ----
  drawKpiCards(l, m, s);

  // 1. Reputation Analytics
  drawSectionHeading(l, "Reputation Analytics");
  drawAnalytics(l, report);

  // 2. Executive Summary
  drawSectionHeading(l, "Executive Summary");
  drawParagraph(l, s.executiveSummary);
  const meaning =
    m.trustScore !== null
      ? `A Trust Score of ${m.trustScore}/100 places this business in the "${trustLabel(m.trustScore)}" range, based on ${m.totalReviews.toLocaleString("en-AU")} public reviews across ${m.platformCount} platform${m.platformCount === 1 ? "" : "s"}.`
      : "No public rating data was available to compute a Trust Score for this business yet.";
  drawCallout(l, "What this means", meaning);

  // 2. Platform comparison
  drawSectionHeading(l, "Platform-by-Platform Comparison");
  const pm = s.platformMeanings || { google: "", yelp: "", tripadvisor: "" };
  const checklistArr = Array.isArray(s.platformChecklist) ? s.platformChecklist : [];
  const actionFor = (platformName: string, hasData: boolean): string => {
    const match = checklistArr.find(
      (c) => (c.platform || "").toLowerCase().trim() === platformName.toLowerCase().trim(),
    );
    if (match && match.recommendedAction && match.recommendedAction !== "-" && match.recommendedAction !== "—")
      return match.recommendedAction;
    return hasData ? "Keep monitoring and responding to reviews" : "Not checked yet";
  };
  drawTable(
    l,
    [
      { header: "Platform", width: 72 },
      { header: "Rating", width: 46 },
      { header: "Reviews", width: 50 },
      { header: "Status", width: 62 },
      { header: "Business Meaning", width: 150 },
      { header: "Recommended Action", width: CONTENT_W - 72 - 46 - 50 - 62 - 150 },
    ],
    m.platforms.map((p) => {
      const hasData = p.rating !== "-" && p.rating !== "—";
      return [
        p.platform,
        p.rating,
        p.reviews,
        hasData ? "Active" : "Not available",
        (pm as Record<string, string>)[p.key] || (hasData ? "" : "No public listing found."),
        actionFor(p.platform, hasData),
      ];
    }),
  );

  // 3. Platform checklist
  drawSectionHeading(l, "Platform Checklist");
  if (checklistArr.length) {
    drawParagraph(l, PLATFORM_CHECKLIST_INTRO, { size: 9.5, color: GREY });
    drawTable(
      l,
      [
        { header: "Platform", width: 78 },
        { header: "Relevant for this business?", width: 128 },
        { header: "Current Status", width: 84 },
        { header: "Recommended Action", width: CONTENT_W - 78 - 128 - 84 - 62 },
        { header: "Priority", width: 62 },
      ],
      checklistArr.map((c) => [
        c.platform,
        c.relevant || "-",
        c.currentStatus || "Not checked yet",
        c.recommendedAction || "-",
        c.priority || "-",
      ]),
      { badgeCol: 4, badgeColors: PRIORITY_COLORS },
    );
  } else {
    drawParagraph(l, "No platform checklist was generated for this report.", { color: GREY });
  }
  drawCallout(l, "How the Trust Score treats this", TRUST_SCORE_EXPLANATION);

  // 5. Sentiment
  drawSectionHeading(l, "AI Customer Sentiment Analysis");
  const se = s.sentiment;
  drawSentimentBars(l, s);
  if (se.estimated) drawParagraph(l, "Estimated from available review samples.", { size: 8.5, color: GREY, gap: 6 });
  drawChipsRow(l, "Positive themes", se.positiveThemes || [], GREEN);
  drawChipsRow(l, "Negative themes", se.negativeThemes || [], RED);
  if (se.insight) drawCallout(l, "AI insight", se.insight);

  // 6. Customer Voice Analysis
  drawSectionHeading(l, "Customer Voice Analysis");
  drawCustomerVoice(l, s);

  // 7. Strengths
  drawSectionHeading(l, "Top Strengths Customers Mention");
  if (s.topStrengths?.length) {
    for (const st of s.topStrengths) {
      drawContentCard(
        l,
        [
          { text: st.theme, size: 11, color: NAVY, bold: true, gapAfter: 3 },
          { text: st.explanation, size: 9.5 },
          { text: st.evidence || "", size: 8.5, color: GREY },
        ],
        GREEN,
      );
    }
  } else drawParagraph(l, "No distinct strengths could be derived from the available data.", { color: GREY });

  // 6. Complaints + risk
  drawSectionHeading(l, "Main Complaints and Risk Level");
  if (s.mainComplaints?.length) {
    for (const c of s.mainComplaints) {
      drawContentCard(
        l,
        [
          { text: c.theme, size: 11, color: NAVY, bold: true, gapAfter: 3 },
          { text: c.explanation, size: 9.5 },
          { text: c.fix ? "Recommended fix: " + c.fix : "", size: 9, color: NAVY },
        ],
        riskColor(c.riskLevel),
        { text: `${c.riskLevel} risk`, color: riskColor(c.riskLevel) },
      );
    }
  } else drawParagraph(l, "No notable complaint themes were evident from the available review data.", { color: GREY });

  // 7. Costing you customers
  drawSectionHeading(l, "What May Be Costing You Customers");
  if (s.costingYouCustomers?.length) {
    for (const item of s.costingYouCustomers) {
      drawContentCard(l, [{ text: item, size: 9.5 }], ORANGE);
    }
  } else drawParagraph(l, "No material issues identified from the available data.", { color: GREY });

  // 8. Customer language
  drawSectionHeading(l, "Customer Language Insights");
  const cl = s.customerLanguage;
  drawChipsRow(l, "Words customers use", cl.words || [], PURPLE);
  drawChipsRow(l, "Phrases to use in marketing", cl.marketingPhrases || [], GREEN);
  drawChipsRow(l, "Phrases / issues to avoid", cl.avoidPhrases || [], RED);
  if (!cl.words?.length && !cl.marketingPhrases?.length && !cl.avoidPhrases?.length)
    drawParagraph(l, "Not enough public review text to analyse language patterns.", { color: GREY });

  // 9. Competitor snapshot
  drawSectionHeading(l, "Competitor Snapshot");
  if (m.competitors?.length) {
    drawTable(
      l,
      [
        { header: "Competitor", width: CONTENT_W - 56 - 52 - 56 - 120 },
        { header: "Trust", width: 56 },
        { header: "Rating", width: 52 },
        { header: "Reviews", width: 56 },
        { header: "Comparison", width: 120 },
      ],
      m.competitors.map((c) => [
        c.name + (c.demo ? " (illustrative)" : ""),
        c.trustScore !== null ? String(c.trustScore) : "-",
        c.averageRating,
        c.reviews,
        c.comparison,
      ]),
    );
  } else drawParagraph(l, "No nearby competitor data was available for comparison.", { color: GREY });
  if (s.competitorConclusion) drawNavyCard(l, [{ text: s.competitorConclusion }]);

  // 10. Recommended offer
  drawSectionHeading(l, "Recommended Offer to Win More Bookings");
  const o = s.recommendedOffer;
  if (o.offer) {
    drawOfferCard(l, o.offer, o.why || "", o.exampleCopy || "");
  } else drawParagraph(l, "No specific offer recommendation available.", { color: GREY });

  // 11. Review improvement
  drawSectionHeading(l, "Review Improvement Opportunity");
  const ri = s.reviewImprovement;
  drawContentCard(
    l,
    [
      { text: ri.why ? "Why it matters: " + ri.why : "", size: 9.5, gapAfter: 5 },
      { text: ri.action ? "Recommended action: " + ri.action : "", size: 9.5, color: NAVY, bold: true },
    ],
    riskColor(ri.priority),
    { text: `Priority: ${ri.priority}`, color: riskColor(ri.priority) },
  );

  // 12. 7-day plan
  drawSectionHeading(l, "7-Day Reputation Action Plan");
  if (s.sevenDayActionPlan?.length) drawTimeline(l, s.sevenDayActionPlan);
  else drawParagraph(l, "No 7-day plan was generated.", { color: GREY });

  // 13. 30-day plan
  drawSectionHeading(l, "30-Day Reputation Plan");
  if (s.thirtyDayPlan?.length) drawWeekCards(l, s.thirtyDayPlan);
  else drawParagraph(l, "No 30-day plan was generated.", { color: GREY });

  // 14. Response templates
  drawSectionHeading(l, "Suggested Response Templates");
  const rt = s.responseTemplates;
  if (rt.positive || rt.negative) {
    if (rt.positive) {
      drawContentCard(
        l,
        [
          { text: "Positive review response", size: 9.5, color: GREEN, bold: true, gapAfter: 4 },
          { text: rt.positive, size: 9 },
        ],
        GREEN,
      );
    }
    if (rt.negative) {
      drawContentCard(
        l,
        [
          { text: "Critical review response", size: 9.5, color: RED, bold: true, gapAfter: 4 },
          { text: rt.negative, size: 9 },
        ],
        RED,
      );
    }
  } else drawParagraph(l, "No response templates were generated.", { color: GREY });

  // 15. Final recommendation
  drawSectionHeading(l, "Final Recommendation");
  const f = s.finalRecommendation;
  const finalRows: Array<{ label: string; text: string }> = [];
  if (f.first) finalRows.push({ label: "Do first", text: f.first });
  if (f.fastest) finalRows.push({ label: "Fastest trust win", text: f.fastest });
  if (f.monitor) finalRows.push({ label: "Monitor next", text: f.monitor });
  if (finalRows.length) drawNavyCard(l, finalRows);
  else drawParagraph(l, "Continue monitoring reviews and encourage satisfied customers to leave feedback.", { color: GREY });

  // Disclaimer (unnumbered muted box).
  l.y -= 4;
  {
    const size = 8.5;
    const lines = wrapLines(report.disclaimer, l.font, size, CONTENT_W - 28);
    const h = lines.length * size * 1.5 + 22;
    ensureSpace(l, h + 6);
    roundedCard(l.page, MARGIN, l.y - h, CONTENT_W, h, 9, CARD_FILL, CARD_BORDER);
    lines.forEach((line, i) => {
      l.page.drawText(line, { x: MARGIN + 14, y: l.y - 14 - size + 3 - i * size * 1.5, size, font: l.font, color: GREY });
    });
    l.y -= h + 8;
  }

  // ---- Navy footer band on every page ----
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: DEEP_NAVY });
    pg.drawRectangle({ x: 0, y: FOOTER_H, width: PAGE_W, height: 1.5, color: PURPLE });
    pg.drawText("Find Business Reviews - AI Customer Review Sentiment Report", {
      x: MARGIN,
      y: 11,
      size: 7.5,
      font: bold,
      color: LAVENDER,
    });
    const pageText = `Page ${i + 1} of ${pages.length}`;
    const ptw = font.widthOfTextAtSize(pageText, 8);
    pg.drawText(pageText, { x: PAGE_W - MARGIN - ptw, y: 11, size: 8, font, color: LAVENDER_DIM });
  });

  return doc.save();
}
