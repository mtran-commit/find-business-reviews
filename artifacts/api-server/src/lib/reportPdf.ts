import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { BusinessReport } from "./reportContent";

const PAGE_W = 595.28; // A4 width (pt)
const PAGE_H = 841.89; // A4 height (pt)
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY = rgb(0x07 / 255, 0x1a / 255, 0x3d / 255);
const PURPLE = rgb(0x7b / 255, 0x3c / 255, 0xff / 255);
const BLACK = rgb(0.05, 0.05, 0.05);
const GREY = rgb(0.38, 0.38, 0.4);

/** Cursor state carried while laying out the flowing document. */
interface Layout {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  pageNo: number;
}

/** Replace characters WinAnsi (pdf-lib standard fonts) cannot encode. */
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
  l.pageNo += 1;
}

function ensureSpace(l: Layout, needed: number): void {
  if (l.y - needed < MARGIN + 24) newPage(l);
}

/** Wrap a string to fit CONTENT_W (optionally indented) at the given size. */
function wrapLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
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
  opts: { size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
): void {
  const size = opts.size ?? 10.5;
  const color = opts.color ?? BLACK;
  const indent = opts.indent ?? 0;
  const lineHeight = size * 1.42;
  const lines = wrapLines(text, l.font, size, CONTENT_W - indent);
  for (const line of lines) {
    ensureSpace(l, lineHeight);
    l.page.drawText(line, {
      x: MARGIN + indent,
      y: l.y - size,
      size,
      font: l.font,
      color,
    });
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
        l.page.drawText("-", {
          x: MARGIN,
          y: l.y - size,
          size,
          font: l.bold,
          color: PURPLE,
        });
      }
      l.page.drawText(line, {
        x: MARGIN + 16,
        y: l.y - size,
        size,
        font: l.font,
        color: BLACK,
      });
      l.y -= lineHeight;
    });
    l.y -= 2;
  }
  l.y -= 4;
}

function drawSectionHeading(l: Layout, index: number, title: string): void {
  ensureSpace(l, 40);
  l.y -= 8;
  const size = 13;
  l.page.drawText(sanitize(`${index}. ${title}`), {
    x: MARGIN,
    y: l.y - size,
    size,
    font: l.bold,
    color: NAVY,
  });
  l.y -= size + 6;
  l.page.drawRectangle({
    x: MARGIN,
    y: l.y + 2,
    width: 46,
    height: 2.5,
    color: PURPLE,
  });
  l.y -= 8;
}

/** Build the AI Business Reputation Report as a PDF byte array. */
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
    pageNo: 1,
  };

  // Cover band.
  l.page.drawRectangle({ x: 0, y: PAGE_H - 150, width: PAGE_W, height: 150, color: NAVY });
  l.page.drawText("AI Business Reputation Report", {
    x: MARGIN,
    y: PAGE_H - 74,
    size: 22,
    font: bold,
    color: rgb(1, 1, 1),
  });
  l.page.drawText(sanitize(`Prepared for ${report.businessName}`), {
    x: MARGIN,
    y: PAGE_H - 100,
    size: 13,
    font,
    color: rgb(0.85, 0.82, 1),
  });
  if (report.businessAddress) {
    l.page.drawText(sanitize(report.businessAddress), {
      x: MARGIN,
      y: PAGE_H - 120,
      size: 10,
      font,
      color: rgb(0.78, 0.76, 0.95),
    });
  }
  l.y = PAGE_H - 150 - 28;

  const generated = new Date(report.generatedAt);
  drawParagraph(
    l,
    `Generated ${isNaN(generated.getTime()) ? "" : generated.toLocaleString("en-AU")}`,
    { size: 9.5, color: GREY, gap: 10 },
  );

  const m = report.metrics;
  const s = report.sections;

  drawSectionHeading(l, 1, "Executive Summary");
  drawParagraph(l, s.executiveSummary);

  drawSectionHeading(l, 2, "Trust Score and Rating Overview");
  drawParagraph(
    l,
    `Trust Score: ${m.trustScore ?? "n/a"} / 100    |    Average rating: ` +
      `${m.averageRating ?? "n/a"} / 5    |    Total reviews: ${m.totalReviews.toLocaleString("en-AU")}    |    Platforms with data: ${m.platformCount}`,
    { size: 11, color: NAVY, gap: 6 },
  );
  if (s.trustScoreOverview) drawParagraph(l, s.trustScoreOverview);

  drawSectionHeading(l, 3, "Platform-by-Platform Comparison");
  for (const p of m.platforms) {
    const line = `${p.platform}: ${p.rating}  (${p.reviews} reviews)` + (p.note ? ` - ${p.note}` : "");
    drawBullets(l, [line]);
  }

  drawSectionHeading(l, 4, "AI Customer Sentiment Analysis");
  drawParagraph(l, s.sentimentAnalysis || "No sentiment signal available from the current data.");

  drawSectionHeading(l, 5, "Top Strengths Customers Mention");
  if (s.topStrengths.length) drawBullets(l, s.topStrengths);
  else drawParagraph(l, "No distinct strengths could be derived from the available data.");

  drawSectionHeading(l, 6, "Main Complaints and Risk Level");
  if (s.riskLevel) drawParagraph(l, `Risk level: ${s.riskLevel}`, { color: NAVY, gap: 4 });
  if (s.mainComplaints.length) drawBullets(l, s.mainComplaints);
  else drawParagraph(l, "No notable complaints were evident from the current ratings.");

  drawSectionHeading(l, 7, "What May Be Costing You Customers");
  drawParagraph(l, s.costingYouCustomers || "No material issues identified from the available data.");

  drawSectionHeading(l, 8, "Customer Language Insights");
  drawParagraph(l, s.customerLanguageInsights || "Not enough public review text to analyse language patterns.");

  drawSectionHeading(l, 9, "Competitor Snapshot");
  drawParagraph(l, s.competitorSnapshot || "No competitor comparison available.");

  drawSectionHeading(l, 10, "Recommended Offer to Win More Bookings");
  drawParagraph(l, s.recommendedOffer || "No specific offer recommendation available.");

  drawSectionHeading(l, 11, "Review Improvement Opportunity");
  drawParagraph(l, s.reviewImprovementOpportunity || "No specific review improvement opportunity identified.");

  drawSectionHeading(l, 12, "7-Day Action Plan");
  if (s.sevenDayActionPlan.length) drawBullets(l, s.sevenDayActionPlan);
  else drawParagraph(l, "No 7-day actions were generated.");

  drawSectionHeading(l, 13, "30-Day Reputation Plan");
  if (s.thirtyDayPlan.length) drawBullets(l, s.thirtyDayPlan);
  else drawParagraph(l, "No 30-day actions were generated.");

  drawSectionHeading(l, 14, "Suggested Review Response Templates");
  if (s.reviewResponseTemplates.length) {
    for (const t of s.reviewResponseTemplates) {
      drawParagraph(l, t.scenario, { color: NAVY, size: 10.5, gap: 2 });
      drawParagraph(l, t.template, { indent: 12, color: GREY, gap: 6 });
    }
  } else {
    drawParagraph(l, "No response templates were generated.");
  }

  drawSectionHeading(l, 15, "Final Recommendation");
  drawParagraph(l, s.finalRecommendation || "Continue monitoring reviews and encourage satisfied customers to leave feedback.");

  drawSectionHeading(l, 16, "Disclaimer");
  drawParagraph(l, report.disclaimer, { size: 9, color: GREY });

  // Page numbers.
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN - 70,
      y: 28,
      size: 8,
      font,
      color: GREY,
    });
    pg.drawText("AI Business Reputation Report", {
      x: MARGIN,
      y: 28,
      size: 8,
      font,
      color: GREY,
    });
  });

  return doc.save();
}
