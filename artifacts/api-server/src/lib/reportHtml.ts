import {
  PLATFORM_CHECKLIST_INTRO,
  TRUST_SCORE_EXPLANATION,
  type BusinessReport,
  type AiSections,
  type ReportMetrics,
  type DataQuality,
} from "./reportContent";

/** HTML-escape a value for safe insertion into markup. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RISK_COLORS: Record<string, string> = {
  Low: "#16A34A",
  Medium: "#F97316",
  High: "#DC2626",
};

function qualityColor(q: DataQuality): string {
  if (q === "High") return "#16A34A";
  if (q === "Medium") return "#F97316";
  return "#DC2626";
}

function safeArr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

function kpiCards(m: ReportMetrics, s: AiSections): string {
  const cards = [
    {
      label: "Trust Score",
      value: m.trustScore !== null ? `${m.trustScore}` : "—",
      sub: m.trustScore !== null ? "/ 100" : "no data",
    },
    {
      label: "Average Rating",
      value: m.averageRating !== null ? `${m.averageRating}` : "—",
      sub: m.averageRating !== null ? "/ 5" : "no data",
    },
    {
      label: "Total Reviews Analysed",
      value: m.totalReviews.toLocaleString("en-AU"),
      sub: `${m.platformCount} platform${m.platformCount === 1 ? "" : "s"}`,
    },
    {
      label: "Customer Sentiment",
      value: esc(s.customerSentimentLabel || "—"),
      sub: `Data quality: ${m.dataQuality}`,
    },
  ];
  return `<div class="kpi-grid">${cards
    .map(
      (c) => `<div class="kpi">
        <div class="kpi-label">${esc(c.label)}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-sub">${esc(c.sub)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function platformTable(m: ReportMetrics, s: AiSections): string {
  const meanings = s.platformMeanings || { google: "", yelp: "", tripadvisor: "" };
  const rows = m.platforms
    .map((p) => {
      const meaning =
        (meanings as Record<string, string>)[p.key] ||
        (p.rating === "—" ? "No public listing found for this platform." : "");
      const summary =
        p.rating === "—"
          ? "Not available"
          : `${p.rating} across ${p.reviews} reviews`;
      return `<tr>
        <td class="strong">${esc(p.platform)}</td>
        <td>${esc(p.rating)}</td>
        <td>${esc(p.reviews)}</td>
        <td>${esc(summary)}</td>
        <td class="muted">${esc(meaning)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="tbl">
    <thead><tr>
      <th>Platform</th><th>Avg Rating</th><th>Reviews</th><th>Summary</th><th>Business Meaning</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const PRIORITY_COLORS: Record<string, string> = {
  High: "#7B3CFF",
  Medium: "#F97316",
  Low: "#5F6368",
  "Not relevant": "#9CA3AF",
};

function checklistSection(s: AiSections): string {
  const items = safeArr(s.platformChecklist);
  if (!items.length)
    return `<p class="muted">No platform checklist was generated for this report.</p>
      <p class="muted">${esc(TRUST_SCORE_EXPLANATION)}</p>`;
  const rows = items
    .map((c) => {
      const color = PRIORITY_COLORS[c.priority] || "#5F6368";
      return `<tr>
        <td class="strong">${esc(c.platform)}</td>
        <td>${esc(c.relevant || "—")}</td>
        <td>${esc(c.currentStatus || "Not checked yet")}</td>
        <td>${esc(c.recommendedAction || "—")}</td>
        <td><span class="prio-badge" style="background:${color}">${esc(c.priority || "—")}</span></td>
      </tr>`;
    })
    .join("");
  return `<p>${esc(PLATFORM_CHECKLIST_INTRO)}</p>
    <table class="tbl">
      <thead><tr>
        <th>Platform</th><th>Relevant for this business?</th><th>Current Status</th><th>Recommended Action</th><th>Priority</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted" style="margin-top:12px">${esc(TRUST_SCORE_EXPLANATION)}</p>`;
}

function sentimentSection(s: AiSections): string {
  const se = s.sentiment;
  const bar = (label: string, value: number, color: string) => `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, value))}%;background:${color}"></div></div>
      <div class="bar-val">${Math.round(value)}%</div>
    </div>`;
  const themes = (title: string, items: string[], color: string) =>
    items.length
      ? `<div class="theme-col">
          <div class="theme-title">${esc(title)}</div>
          <div class="chips">${items
            .map((t) => `<span class="chip" style="border-color:${color};color:${color}">${esc(t)}</span>`)
            .join("")}</div>
        </div>`
      : "";
  return `
    <div class="bars">
      ${bar("Positive", se.positive, "#16A34A")}
      ${bar("Neutral", se.neutral, "#F97316")}
      ${bar("Negative", se.negative, "#DC2626")}
    </div>
    ${se.estimated ? `<p class="est-note">Estimated from available review samples.</p>` : ""}
    <div class="theme-grid">
      ${themes("Positive themes", safeArr(se.positiveThemes), "#16A34A")}
      ${themes("Negative themes", safeArr(se.negativeThemes), "#DC2626")}
    </div>
    ${se.insight ? `<div class="insight"><strong>AI insight:</strong> ${esc(se.insight)}</div>` : ""}`;
}

function strengthsSection(s: AiSections): string {
  const items = safeArr(s.topStrengths);
  if (!items.length) return `<p class="muted">No distinct strengths could be derived from the available data.</p>`;
  return `<div class="card-grid">${items
    .map(
      (st) => `<div class="mini-card">
        <div class="mini-title">${esc(st.theme)}</div>
        <div class="mini-body">${esc(st.explanation)}</div>
        ${st.evidence ? `<div class="mini-evi">${esc(st.evidence)}</div>` : ""}
      </div>`,
    )
    .join("")}</div>`;
}

function complaintsSection(s: AiSections): string {
  const items = safeArr(s.mainComplaints);
  if (!items.length)
    return `<p class="muted">No notable complaint themes were evident from the available review data.</p>`;
  return `<div class="card-grid">${items
    .map((c) => {
      const color = RISK_COLORS[c.riskLevel] || "#F97316";
      return `<div class="mini-card">
        <div class="mini-title">${esc(c.theme)}</div>
        <span class="risk-badge" style="background:${color}">${esc(c.riskLevel)} risk</span>
        <div class="mini-body">${esc(c.explanation)}</div>
        ${c.fix ? `<div class="mini-fix"><strong>Recommended fix:</strong> ${esc(c.fix)}</div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
}

function listSection(items: string[], empty: string): string {
  const arr = safeArr(items);
  if (!arr.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="clean-list">${arr.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function languageSection(s: AiSections): string {
  const cl = s.customerLanguage;
  const group = (title: string, items: string[], color: string) => `
    <div class="lang-col">
      <div class="theme-title">${esc(title)}</div>
      <div class="chips">${
        safeArr(items).length
          ? safeArr(items)
              .map((w) => `<span class="chip" style="border-color:${color};color:${color}">${esc(w)}</span>`)
              .join("")
          : `<span class="muted">Not enough data</span>`
      }</div>
    </div>`;
  return `<div class="lang-grid">
    ${group("Words customers use", cl.words, "#7B3CFF")}
    ${group("Phrases to use in marketing", cl.marketingPhrases, "#16A34A")}
    ${group("Phrases / issues to avoid", cl.avoidPhrases, "#DC2626")}
  </div>`;
}

function competitorSection(m: ReportMetrics, s: AiSections): string {
  const comps = safeArr(m.competitors);
  const table = comps.length
    ? `<table class="tbl">
        <thead><tr><th>Competitor</th><th>Trust Score</th><th>Avg Rating</th><th>Reviews</th><th>Comparison</th></tr></thead>
        <tbody>${comps
          .map(
            (c) => `<tr>
              <td class="strong">${esc(c.name)}${c.demo ? ` <span class="demo-tag">illustrative</span>` : ""}</td>
              <td>${c.trustScore !== null ? esc(c.trustScore) : "—"}</td>
              <td>${esc(c.averageRating)}</td>
              <td>${esc(c.reviews)}</td>
              <td class="muted">${esc(c.comparison)}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : `<p class="muted">No nearby competitor data was available for comparison.</p>`;
  return `${table}${
    s.competitorConclusion ? `<div class="conclusion">${esc(s.competitorConclusion)}</div>` : ""
  }`;
}

function offerSection(s: AiSections): string {
  const o = s.recommendedOffer;
  if (!o.offer) return `<p class="muted">No specific offer recommendation available.</p>`;
  return `<div class="offer-card">
    <div class="offer-head">${esc(o.offer)}</div>
    ${o.why ? `<div class="offer-why"><strong>Why it works:</strong> ${esc(o.why)}</div>` : ""}
    ${o.exampleCopy ? `<div class="offer-copy">“${esc(o.exampleCopy)}”</div>` : ""}
  </div>`;
}

function improvementSection(s: AiSections): string {
  const r = s.reviewImprovement;
  const color = RISK_COLORS[r.priority] || "#7B3CFF";
  return `<div class="improve">
    <span class="risk-badge" style="background:${color}">Priority: ${esc(r.priority)}</span>
    ${r.why ? `<p><strong>Why it matters:</strong> ${esc(r.why)}</p>` : ""}
    ${r.action ? `<p><strong>Recommended action:</strong> ${esc(r.action)}</p>` : ""}
  </div>`;
}

function sevenDaySection(s: AiSections): string {
  const items = safeArr(s.sevenDayActionPlan);
  if (!items.length) return `<p class="muted">No 7-day plan was generated.</p>`;
  return `<div class="plan-grid">${items
    .map(
      (d) => `<div class="plan-card">
        <div class="plan-day">${esc(d.day)}</div>
        <div class="plan-action">${esc(d.action)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function thirtyDaySection(s: AiSections): string {
  const items = safeArr(s.thirtyDayPlan);
  if (!items.length) return `<p class="muted">No 30-day plan was generated.</p>`;
  return `<div class="week-grid">${items
    .map(
      (w) => `<div class="week-card">
        <div class="week-label">${esc(w.week)}</div>
        <div class="week-focus">${esc(w.focus)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function templatesSection(s: AiSections): string {
  const t = s.responseTemplates;
  const block = (title: string, body: string, color: string) =>
    body
      ? `<div class="tpl-card">
          <div class="tpl-title" style="color:${color}">${esc(title)}</div>
          <div class="tpl-body">${esc(body)}</div>
        </div>`
      : "";
  const positive = block("Positive review response", t.positive, "#16A34A");
  const negative = block("Critical review response", t.negative, "#DC2626");
  if (!positive && !negative) return `<p class="muted">No response templates were generated.</p>`;
  return `<div class="tpl-grid">${positive}${negative}</div>`;
}

function finalSection(s: AiSections): string {
  const f = s.finalRecommendation;
  const row = (label: string, val: string) =>
    val ? `<li><strong>${esc(label)}:</strong> ${esc(val)}</li>` : "";
  const body = row("Do first", f.first) + row("Fastest trust win", f.fastest) + row("Monitor next", f.monitor);
  if (!body) return `<p class="muted">Continue monitoring reviews and encourage satisfied customers to leave feedback.</p>`;
  return `<ul class="final-list">${body}</ul>`;
}

function section(num: number, title: string, body: string): string {
  return `<section class="sec">
    <h2><span class="sec-num">${num}</span>${esc(title)}</h2>
    ${body}
  </section>`;
}

/** Render the full styled HTML dashboard report from the persisted report JSON. */
export function buildReportHtml(report: BusinessReport): string {
  const m = report.metrics;
  const s = report.sections;
  const generated = new Date(report.generatedAt);
  const dateStr = isNaN(generated.getTime())
    ? ""
    : generated.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

  const meta = [
    dateStr ? `<span class="meta-chip">Generated ${esc(dateStr)}</span>` : "",
    `<span class="meta-chip" style="border-color:${qualityColor(m.dataQuality)};color:${qualityColor(m.dataQuality)}">Data quality: ${esc(m.dataQuality)}</span>`,
    `<span class="meta-chip">Platforms checked: Google, Yelp, TripAdvisor</span>`,
    `<span class="meta-badge">Paid Report — $10</span>`,
  ].join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI Business Reputation Report — ${esc(report.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#F7F7F4; color:#050505; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; line-height:1.5; }
  .wrap { max-width:900px; margin:0 auto; padding:0 20px 60px; }
  .report-header { background:#071A3D; color:#fff; padding:38px 20px; }
  .report-header .inner { max-width:900px; margin:0 auto; }
  .report-header h1 { margin:0 0 6px; font-size:26px; letter-spacing:-.02em; }
  .report-header .sub { color:#C9BEEF; font-size:15px; margin-bottom:4px; }
  .report-header .addr { color:#9A8FC7; font-size:13px; margin-bottom:16px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; }
  .meta-chip { border:1px solid rgba(255,255,255,.3); color:#E8E3FA; border-radius:999px; padding:5px 12px; font-size:12px; }
  .meta-badge { background:#7B3CFF; color:#fff; border-radius:999px; padding:5px 14px; font-size:12px; font-weight:700; }
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:26px 0 8px; }
  .kpi { background:#fff; border:1px solid #E5E5E5; border-radius:16px; padding:18px; text-align:center; box-shadow:0 1px 2px rgba(7,26,61,.04); }
  .kpi-label { font-size:12px; color:#5F6368; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em; }
  .kpi-value { font-size:30px; font-weight:800; color:#071A3D; line-height:1; }
  .kpi-sub { font-size:12px; color:#7B3CFF; margin-top:6px; font-weight:600; }
  .sec { background:#fff; border:1px solid #E5E5E5; border-radius:18px; padding:24px 26px; margin-top:20px; box-shadow:0 1px 2px rgba(7,26,61,.04); }
  .sec h2 { font-size:18px; color:#071A3D; margin:0 0 16px; display:flex; align-items:center; gap:12px; }
  .sec-num { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; background:#F1E8FF; color:#7B3CFF; border-radius:9px; font-size:14px; font-weight:800; }
  .sec p { margin:0 0 10px; }
  .muted { color:#5F6368; }
  .strong { font-weight:700; color:#071A3D; }
  .tbl { width:100%; border-collapse:collapse; font-size:14px; }
  .tbl th { text-align:left; background:#F1E8FF; color:#071A3D; padding:10px 12px; font-size:12px; text-transform:uppercase; letter-spacing:.03em; }
  .tbl th:first-child { border-radius:8px 0 0 8px; }
  .tbl th:last-child { border-radius:0 8px 8px 0; }
  .tbl td { padding:11px 12px; border-bottom:1px solid #EEE; vertical-align:top; }
  .bars { margin-bottom:10px; }
  .bar-row { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  .bar-label { width:70px; font-size:13px; color:#071A3D; font-weight:600; }
  .bar-track { flex:1; height:12px; background:#F1E8FF; border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:999px; }
  .bar-val { width:44px; text-align:right; font-size:13px; font-weight:700; color:#071A3D; }
  .est-note { font-size:12px; color:#5F6368; font-style:italic; margin:0 0 12px; }
  .theme-grid, .lang-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:8px; }
  .lang-grid { grid-template-columns:repeat(3,1fr); }
  .theme-title { font-size:13px; font-weight:700; color:#071A3D; margin-bottom:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { border:1px solid #7B3CFF; color:#7B3CFF; border-radius:999px; padding:4px 10px; font-size:12px; background:#fff; }
  .insight { background:#F1E8FF; border-radius:12px; padding:14px 16px; margin-top:14px; font-size:14px; color:#071A3D; }
  .card-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .mini-card { border:1px solid #E5E5E5; border-radius:14px; padding:16px; background:#fff; }
  .mini-title { font-weight:700; color:#071A3D; margin-bottom:8px; }
  .mini-body { font-size:14px; color:#050505; }
  .mini-evi { font-size:13px; color:#5F6368; margin-top:8px; font-style:italic; }
  .mini-fix { font-size:13px; color:#071A3D; margin-top:10px; }
  .risk-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:700; margin-bottom:8px; }
  .prio-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:700; white-space:nowrap; }
  .clean-list { margin:0; padding-left:20px; }
  .clean-list li { margin-bottom:8px; }
  .lang-col { }
  .conclusion { background:#071A3D; color:#fff; border-radius:12px; padding:14px 16px; margin-top:14px; font-weight:600; font-size:14px; }
  .demo-tag { font-size:10px; color:#5F6368; border:1px solid #E5E5E5; border-radius:6px; padding:1px 6px; font-weight:500; }
  .offer-card { border:1.5px solid #7B3CFF; border-radius:14px; padding:18px; background:#FBF8FF; }
  .offer-head { font-weight:800; color:#7B3CFF; font-size:16px; margin-bottom:8px; }
  .offer-why { font-size:14px; margin-bottom:10px; }
  .offer-copy { font-size:14px; color:#071A3D; background:#fff; border:1px solid #E5E5E5; border-radius:10px; padding:12px; }
  .improve p { font-size:14px; margin:8px 0 0; }
  .plan-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
  .plan-card { border:1px solid #E5E5E5; border-radius:12px; padding:14px; }
  .plan-day { font-weight:800; color:#7B3CFF; font-size:13px; margin-bottom:4px; }
  .plan-action { font-size:14px; }
  .week-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .week-card { border:1px solid #E5E5E5; border-left:4px solid #7B3CFF; border-radius:12px; padding:14px; }
  .week-label { font-weight:800; color:#071A3D; margin-bottom:4px; }
  .week-focus { font-size:14px; color:#050505; }
  .tpl-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .tpl-card { border:1px solid #E5E5E5; border-radius:12px; padding:16px; background:#FAFAF8; }
  .tpl-title { font-weight:700; margin-bottom:8px; }
  .tpl-body { font-size:13px; color:#050505; white-space:pre-wrap; }
  .final-list { margin:0; padding-left:20px; }
  .final-list li { margin-bottom:8px; font-size:15px; }
  .disclaimer { font-size:12px; color:#5F6368; margin-top:20px; padding:16px 18px; background:#fff; border:1px solid #E5E5E5; border-radius:12px; }
  @media (max-width:760px){
    .kpi-grid{grid-template-columns:repeat(2,1fr);}
    .card-grid,.lang-grid,.plan-grid,.week-grid,.tpl-grid,.theme-grid{grid-template-columns:1fr;}
    .tbl{font-size:13px;}
  }
</style>
</head>
<body>
  <header class="report-header"><div class="inner">
    <h1>AI Business Reputation Report</h1>
    <div class="sub">Prepared for ${esc(report.businessName)}</div>
    ${report.businessAddress ? `<div class="addr">${esc(report.businessAddress)}</div>` : ""}
    <div class="meta">${meta}</div>
  </div></header>
  <div class="wrap">
    ${kpiCards(m, s)}
    ${section(1, "Executive Summary", `<p>${esc(s.executiveSummary)}</p>`)}
    ${section(2, "Platform-by-Platform Comparison", platformTable(m, s))}
    ${section(3, "Platform Checklist", checklistSection(s))}
    ${section(4, "AI Customer Sentiment Analysis", sentimentSection(s))}
    ${section(5, "Top Strengths Customers Mention", strengthsSection(s))}
    ${section(6, "Main Complaints and Risk Level", complaintsSection(s))}
    ${section(7, "What May Be Costing You Customers", listSection(s.costingYouCustomers, "No material issues identified from the available data."))}
    ${section(8, "Customer Language Insights", languageSection(s))}
    ${section(9, "Competitor Snapshot", competitorSection(m, s))}
    ${section(10, "Recommended Offer to Win More Bookings", offerSection(s))}
    ${section(11, "Review Improvement Opportunity", improvementSection(s))}
    ${section(12, "7-Day Reputation Action Plan", sevenDaySection(s))}
    ${section(13, "30-Day Reputation Plan", thirtyDaySection(s))}
    ${section(14, "Suggested Response Templates", templatesSection(s))}
    ${section(15, "Final Recommendation", finalSection(s))}
    <div class="disclaimer">${esc(report.disclaimer)}</div>
  </div>
</body></html>`;
}
