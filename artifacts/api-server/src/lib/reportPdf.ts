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
  type BusinessReport,
  type AiSections,
  type ReportMetrics,
} from "./reportContent";

const PAGE_W = 595.28; // A4 width (pt)
const PAGE_H = 841.89; // A4 height (pt)
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY = rgb(0x07 / 255, 0x1a / 255, 0x3d / 255);
const PURPLE = rgb(0x7b / 255, 0x3c / 255, 0xff / 255);
const LIGHT_PURPLE = rgb(0xf1 / 255, 0xe8 / 255, 0xff / 255);
const BLACK = rgb(0.05, 0.05, 0.05);
const GREY = rgb(0.38, 0.38, 0.4);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0x16 / 255, 0xa3 / 255, 0x4a / 255);
const ORANGE = rgb(0xf9 / 255, 0x73 / 255, 0x16 / 255);
const RED = rgb(0xdc / 255, 0x26 / 255, 0x26 / 255);
const CARD_BORDER = rgb(0.9, 0.9, 0.9);

function riskColor(level: string): RGB {
  if (level === "High") return RED;
  if (level === "Medium") return ORANGE;
  return GREEN;
}

interface Layout {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
}

function sanitize(text: string): string {
  return (text || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u25CF]/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function newPage(l: Layout): void {
  l.page = l.doc.addPage([PAGE_W, PAGE_H]);
  l.y = PAGE_H - MARGIN;
}

function ensureSpace(l: Layout, needed: number): void {
  if (l.y - needed < MARGIN + 24) newPage(l);
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
  const lineHeight = size * 1.42;
  const lines = wrapLines(text, font, size, CONTENT_W - indent);
  for (const line of lines) {
    ensureSpace(l, lineHeight);
    l.page.drawText(line, { x: MARGIN + indent, y: l.y - size, size, font, color });
    l.y -= lineHeight;
  }
  l.y -= opts.gap ?? 4;
}

function drawBullets(l: Layout, items: string[]): void {
  const size = 10.5;
  const lineHeight = size * 1.42;
  for (const item of items) {
    const lines = wrapLines(item, l.font, size, CONTENT_W - 16);
    lines.forEach((line, i) => {
      ensureSpace(l, lineHeight);
      if (i === 0) {
        l.page.drawText("-", { x: MARGIN, y: l.y - size, size, font: l.bold, color: PURPLE });
      }
      l.page.drawText(line, { x: MARGIN + 16, y: l.y - size, size, font: l.font, color: BLACK });
      l.y -= lineHeight;
    });
    l.y -= 2;
  }
  l.y -= 4;
}

let sectionNo = 0;
function drawSectionHeading(l: Layout, title: string): void {
  sectionNo += 1;
  ensureSpace(l, 46);
  l.y -= 10;
  // Number chip.
  const chip = 18;
  l.page.drawRectangle({
    x: MARGIN,
    y: l.y - chip + 3,
    width: chip,
    height: chip,
    color: LIGHT_PURPLE,
  });
  l.page.drawText(String(sectionNo), {
    x: MARGIN + (sectionNo < 10 ? 6 : 3),
    y: l.y - chip + 8,
    size: 10,
    font: l.bold,
    color: PURPLE,
  });
  l.page.drawText(sanitize(title), {
    x: MARGIN + chip + 10,
    y: l.y - 13,
    size: 13,
    font: l.bold,
    color: NAVY,
  });
  l.y -= chip + 8;
  l.page.drawRectangle({ x: MARGIN, y: l.y + 4, width: CONTENT_W, height: 0.8, color: CARD_BORDER });
  l.y -= 8;
}

function drawKpiCards(l: Layout, m: ReportMetrics, s: AiSections): void {
  const cards = [
    { label: "TRUST SCORE", value: m.trustScore !== null ? String(m.trustScore) : "-", sub: m.trustScore !== null ? "/ 100" : "no data" },
    { label: "AVG RATING", value: m.averageRating !== null ? String(m.averageRating) : "-", sub: m.averageRating !== null ? "/ 5" : "no data" },
    { label: "REVIEWS", value: m.totalReviews.toLocaleString("en-AU"), sub: `${m.platformCount} platforms` },
    { label: "SENTIMENT", value: sanitize(s.customerSentimentLabel || "-"), sub: `Data: ${m.dataQuality}` },
  ];
  const gap = 10;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const cardH = 60;
  ensureSpace(l, cardH + 10);
  const top = l.y;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    l.page.drawRectangle({
      x,
      y: top - cardH,
      width: cardW,
      height: cardH,
      color: WHITE,
      borderColor: CARD_BORDER,
      borderWidth: 1,
    });
    l.page.drawText(c.label, { x: x + 8, y: top - 16, size: 7, font: l.bold, color: GREY });
    const vSize = c.value.length > 8 ? 12 : 20;
    l.page.drawText(c.value, { x: x + 8, y: top - 40, size: vSize, font: l.bold, color: NAVY });
    l.page.drawText(sanitize(c.sub), { x: x + 8, y: top - 52, size: 7.5, font: l.font, color: PURPLE });
  });
  l.y = top - cardH - 12;
}

interface Col {
  header: string;
  width: number;
}

function drawTable(l: Layout, cols: Col[], rows: string[][]): void {
  const size = 9;
  const padX = 6;
  const headerH = 18;
  ensureSpace(l, headerH + 20);
  // Header.
  let x = MARGIN;
  l.page.drawRectangle({ x: MARGIN, y: l.y - headerH, width: CONTENT_W, height: headerH, color: LIGHT_PURPLE });
  cols.forEach((c) => {
    l.page.drawText(sanitize(c.header), { x: x + padX, y: l.y - headerH + 6, size: 8, font: l.bold, color: NAVY });
    x += c.width;
  });
  l.y -= headerH;
  // Rows.
  for (const row of rows) {
    // Measure row height by tallest cell.
    const cellLines = row.map((cell, i) =>
      wrapLines(cell, l.font, size, cols[i]!.width - padX * 2),
    );
    const maxLines = Math.max(1, ...cellLines.map((ls) => ls.length));
    const rowH = maxLines * (size * 1.3) + 8;
    ensureSpace(l, rowH);
    x = MARGIN;
    cellLines.forEach((lines, i) => {
      lines.forEach((line, li) => {
        l.page.drawText(line, {
          x: x + padX,
          y: l.y - 4 - size - li * (size * 1.3),
          size,
          font: i === 0 ? l.bold : l.font,
          color: i === 0 ? NAVY : BLACK,
        });
      });
      x += cols[i]!.width;
    });
    l.y -= rowH;
    l.page.drawRectangle({ x: MARGIN, y: l.y, width: CONTENT_W, height: 0.6, color: CARD_BORDER });
  }
  l.y -= 8;
}

function drawBadge(l: Layout, text: string, color: RGB): void {
  const size = 8;
  const w = l.bold.widthOfTextAtSize(sanitize(text), size) + 12;
  ensureSpace(l, 16);
  l.page.drawRectangle({ x: MARGIN, y: l.y - 12, width: w, height: 13, color });
  l.page.drawText(sanitize(text), { x: MARGIN + 6, y: l.y - 9, size, font: l.bold, color: WHITE });
  l.y -= 18;
}

/** Build the AI Business Reputation Report as a styled dashboard PDF. */
export async function buildReportPdf(report: BusinessReport): Promise<Uint8Array> {
  sectionNo = 0;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const l: Layout = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - MARGIN, font, bold };
  const m = report.metrics;
  const s = report.sections;

  // ---- Header band ----
  const bandH = 130;
  l.page.drawRectangle({ x: 0, y: PAGE_H - bandH, width: PAGE_W, height: bandH, color: NAVY });
  l.page.drawText("AI Business Reputation Report", { x: MARGIN, y: PAGE_H - 46, size: 20, font: bold, color: WHITE });
  l.page.drawText(sanitize(`Prepared for ${report.businessName}`), { x: MARGIN, y: PAGE_H - 68, size: 12, font, color: rgb(0.79, 0.75, 0.94) });
  if (report.businessAddress) {
    l.page.drawText(sanitize(report.businessAddress), { x: MARGIN, y: PAGE_H - 84, size: 9, font, color: rgb(0.6, 0.56, 0.78) });
  }
  const generated = new Date(report.generatedAt);
  const dateStr = isNaN(generated.getTime()) ? "" : generated.toLocaleString("en-AU");
  l.page.drawText(sanitize(`Generated ${dateStr}  |  Data quality: ${m.dataQuality}  |  Platforms: Google, Yelp, TripAdvisor`), {
    x: MARGIN,
    y: PAGE_H - 104,
    size: 8.5,
    font,
    color: rgb(0.7, 0.66, 0.86),
  });
  // Paid badge.
  const badgeText = "Paid Report - $10";
  const bw = bold.widthOfTextAtSize(badgeText, 9) + 16;
  l.page.drawRectangle({ x: PAGE_W - MARGIN - bw, y: PAGE_H - 50, width: bw, height: 16, color: PURPLE });
  l.page.drawText(badgeText, { x: PAGE_W - MARGIN - bw + 8, y: PAGE_H - 46, size: 9, font: bold, color: WHITE });

  l.y = PAGE_H - bandH - 18;

  // ---- KPI cards ----
  drawKpiCards(l, m, s);

  // 1. Executive Summary
  drawSectionHeading(l, "Executive Summary");
  drawParagraph(l, s.executiveSummary);

  // 2. Platform comparison
  drawSectionHeading(l, "Platform-by-Platform Comparison");
  const pm = s.platformMeanings || { google: "", yelp: "", tripadvisor: "" };
  drawTable(
    l,
    [
      { header: "Platform", width: 78 },
      { header: "Rating", width: 60 },
      { header: "Reviews", width: 60 },
      { header: "Business Meaning", width: CONTENT_W - 78 - 60 - 60 },
    ],
    m.platforms.map((p) => [
      p.platform,
      p.rating,
      p.reviews,
      (pm as Record<string, string>)[p.key] || (p.rating === "-" || p.rating === "—" ? "No public listing found." : ""),
    ]),
  );

  // 3. Platform checklist
  drawSectionHeading(l, "Platform Checklist");
  if (s.platformChecklist?.length) {
    drawParagraph(l, PLATFORM_CHECKLIST_INTRO, { size: 9.5, color: GREY });
    drawTable(
      l,
      [
        { header: "Platform", width: 78 },
        { header: "Relevant for this business?", width: 130 },
        { header: "Current Status", width: 82 },
        { header: "Recommended Action", width: CONTENT_W - 78 - 130 - 82 - 52 },
        { header: "Priority", width: 52 },
      ],
      s.platformChecklist.map((c) => [
        c.platform,
        c.relevant || "-",
        c.currentStatus || "Not checked yet",
        c.recommendedAction || "-",
        c.priority || "-",
      ]),
    );
  } else {
    drawParagraph(l, "No platform checklist was generated for this report.", { color: GREY });
  }
  drawParagraph(l, TRUST_SCORE_EXPLANATION, { size: 8.5, color: GREY });

  // 4. Sentiment
  drawSectionHeading(l, "AI Customer Sentiment Analysis");
  const se = s.sentiment;
  drawParagraph(l, `Positive ${Math.round(se.positive)}%   |   Neutral ${Math.round(se.neutral)}%   |   Negative ${Math.round(se.negative)}%`, { color: NAVY, bold: true, gap: 4 });
  if (se.estimated) drawParagraph(l, "Estimated from available review samples.", { size: 8.5, color: GREY, gap: 4 });
  if (se.positiveThemes?.length) drawParagraph(l, "Positive themes: " + se.positiveThemes.join(", "), { color: GREEN, size: 10 });
  if (se.negativeThemes?.length) drawParagraph(l, "Negative themes: " + se.negativeThemes.join(", "), { color: RED, size: 10 });
  if (se.insight) drawParagraph(l, "AI insight: " + se.insight);

  // 4. Strengths
  drawSectionHeading(l, "Top Strengths Customers Mention");
  if (s.topStrengths?.length) {
    for (const st of s.topStrengths) {
      drawParagraph(l, st.theme, { color: NAVY, bold: true, gap: 2 });
      if (st.explanation) drawParagraph(l, st.explanation, { indent: 12, gap: 2 });
      if (st.evidence) drawParagraph(l, st.evidence, { indent: 12, color: GREY, size: 9.5, gap: 6 });
    }
  } else drawParagraph(l, "No distinct strengths could be derived from the available data.", { color: GREY });

  // 5. Complaints + risk
  drawSectionHeading(l, "Main Complaints and Risk Level");
  if (s.mainComplaints?.length) {
    for (const c of s.mainComplaints) {
      drawParagraph(l, c.theme, { color: NAVY, bold: true, gap: 2 });
      drawBadge(l, `${c.riskLevel} risk`, riskColor(c.riskLevel));
      if (c.explanation) drawParagraph(l, c.explanation, { indent: 12, gap: 2 });
      if (c.fix) drawParagraph(l, "Recommended fix: " + c.fix, { indent: 12, color: GREY, size: 9.5, gap: 6 });
    }
  } else drawParagraph(l, "No notable complaint themes were evident from the available review data.", { color: GREY });

  // 6. Costing you customers
  drawSectionHeading(l, "What May Be Costing You Customers");
  if (s.costingYouCustomers?.length) drawBullets(l, s.costingYouCustomers);
  else drawParagraph(l, "No material issues identified from the available data.", { color: GREY });

  // 7. Customer language
  drawSectionHeading(l, "Customer Language Insights");
  const cl = s.customerLanguage;
  if (cl.words?.length) drawParagraph(l, "Words customers use: " + cl.words.join(", "));
  if (cl.marketingPhrases?.length) drawParagraph(l, "Phrases to use in marketing: " + cl.marketingPhrases.join(", "), { color: GREEN });
  if (cl.avoidPhrases?.length) drawParagraph(l, "Phrases / issues to avoid: " + cl.avoidPhrases.join(", "), { color: RED });
  if (!cl.words?.length && !cl.marketingPhrases?.length && !cl.avoidPhrases?.length)
    drawParagraph(l, "Not enough public review text to analyse language patterns.", { color: GREY });

  // 8. Competitor snapshot
  drawSectionHeading(l, "Competitor Snapshot");
  if (m.competitors?.length) {
    drawTable(
      l,
      [
        { header: "Competitor", width: CONTENT_W - 70 - 70 - 70 - 90 },
        { header: "Trust", width: 70 },
        { header: "Rating", width: 70 },
        { header: "Reviews", width: 70 },
        { header: "Comparison", width: 90 },
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
  if (s.competitorConclusion) drawParagraph(l, s.competitorConclusion, { color: NAVY, bold: true });

  // 9. Recommended offer
  drawSectionHeading(l, "Recommended Offer to Win More Bookings");
  const o = s.recommendedOffer;
  if (o.offer) {
    drawParagraph(l, o.offer, { color: PURPLE, bold: true, gap: 2 });
    if (o.why) drawParagraph(l, "Why it works: " + o.why, { gap: 2 });
    if (o.exampleCopy) drawParagraph(l, "Example copy: \"" + o.exampleCopy + "\"", { color: GREY, size: 9.5 });
  } else drawParagraph(l, "No specific offer recommendation available.", { color: GREY });

  // 10. Review improvement
  drawSectionHeading(l, "Review Improvement Opportunity");
  const ri = s.reviewImprovement;
  drawBadge(l, `Priority: ${ri.priority}`, riskColor(ri.priority));
  if (ri.why) drawParagraph(l, "Why it matters: " + ri.why, { gap: 2 });
  if (ri.action) drawParagraph(l, "Recommended action: " + ri.action);

  // 11. 7-day plan
  drawSectionHeading(l, "7-Day Reputation Action Plan");
  if (s.sevenDayActionPlan?.length) drawBullets(l, s.sevenDayActionPlan.map((d) => `${d.day}: ${d.action}`));
  else drawParagraph(l, "No 7-day plan was generated.", { color: GREY });

  // 12. 30-day plan
  drawSectionHeading(l, "30-Day Reputation Plan");
  if (s.thirtyDayPlan?.length) drawBullets(l, s.thirtyDayPlan.map((w) => `${w.week}: ${w.focus}`));
  else drawParagraph(l, "No 30-day plan was generated.", { color: GREY });

  // 13. Response templates
  drawSectionHeading(l, "Suggested Response Templates");
  const rt = s.responseTemplates;
  if (rt.positive || rt.negative) {
    if (rt.positive) {
      drawParagraph(l, "Positive review response", { color: GREEN, bold: true, gap: 2 });
      drawParagraph(l, rt.positive, { indent: 12, color: GREY, gap: 6 });
    }
    if (rt.negative) {
      drawParagraph(l, "Critical review response", { color: RED, bold: true, gap: 2 });
      drawParagraph(l, rt.negative, { indent: 12, color: GREY, gap: 6 });
    }
  } else drawParagraph(l, "No response templates were generated.", { color: GREY });

  // 14. Final recommendation
  drawSectionHeading(l, "Final Recommendation");
  const f = s.finalRecommendation;
  const finalItems: string[] = [];
  if (f.first) finalItems.push("Do first: " + f.first);
  if (f.fastest) finalItems.push("Fastest trust win: " + f.fastest);
  if (f.monitor) finalItems.push("Monitor next: " + f.monitor);
  if (finalItems.length) drawBullets(l, finalItems);
  else drawParagraph(l, "Continue monitoring reviews and encourage satisfied customers to leave feedback.", { color: GREY });

  // Disclaimer
  drawSectionHeading(l, "Disclaimer");
  drawParagraph(l, report.disclaimer, { size: 8.5, color: GREY });

  // Footer page numbers.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE_W - MARGIN - 62, y: 26, size: 8, font, color: GREY });
    pg.drawText("AI Business Reputation Report", { x: MARGIN, y: 26, size: 8, font, color: GREY });
  });

  return doc.save();
}
