import {
  PLATFORM_CHECKLIST_INTRO,
  TRUST_SCORE_EXPLANATION,
  computeAnalytics,
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

const PRIORITY_COLORS: Record<string, string> = {
  High: "#7B3CFF",
  Medium: "#F97316",
  Low: "#5F6368",
  "Not relevant": "#9CA3AF",
};

function qualityColor(q: DataQuality): string {
  if (q === "High") return "#16A34A";
  if (q === "Medium") return "#F97316";
  return "#DC2626";
}

function safeArr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

/** Deterministic trust-range label from the real trust score (no AI). */
function trustLabel(score: number | null): string {
  if (score === null) return "No data";
  if (score >= 85) return "Very Trusted";
  if (score >= 70) return "Trusted";
  if (score >= 55) return "Building trust";
  if (score >= 40) return "Mixed signals";
  return "Needs attention";
}

/* Small inline SVG icon set (stroke inherits currentColor). */
const ICONS: Record<string, string> = {
  doc: '<path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M13 2v6h6"/>',
  scale: '<path d="M3 6h18"/><path d="M12 3v18"/><path d="M5 6l-2 6a3.5 3.5 0 0 0 7 0L8 6"/><path d="M19 6l-2 6a3.5 3.5 0 0 0 7 0l-2-6" transform="translate(-3 0)"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  speech: '<path d="M8 12h8"/><path d="M8 8h8"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  gift: '<rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M12 8c-2 0-4-1-4-3a2 2 0 0 1 4 0"/><path d="M12 8c2 0 4-1 4-3a2 2 0 0 0-4 0"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  reply: '<path d="M9 17l-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  gauge: '<path d="M12 15l4-6"/><circle cx="12" cy="15" r="1.5"/><path d="M3.5 19a10 10 0 1 1 17 0"/>',
  reviews: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
};

function icon(name: string, size = 16): string {
  const body = ICONS[name] || ICONS["doc"];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* Platform brand tiles (real brand colours are allowed for platform marks). */
function platformTile(key: string, name: string): string {
  const marks: Record<string, [string, string]> = {
    google: ["#4285F4", "G"],
    yelp: ["#D32323", "Y"],
    tripadvisor: ["#34E0A1", "T"],
  };
  const m = marks[key] || ["#071A3D", (name[0] || "?").toUpperCase()];
  return `<span class="pf-cell"><span class="pf-tile" style="color:${m[0]};border-color:${m[0]}33">${esc(m[1])}</span><span class="strong">${esc(name)}</span></span>`;
}

function kpiCards(m: ReportMetrics, s: AiSections): string {
  const cards = [
    {
      icon: "gauge",
      label: "Trust Score",
      value: m.trustScore !== null ? `${m.trustScore}<span class="kpi-denom">/100</span>` : "—",
      sub: trustLabel(m.trustScore),
    },
    {
      icon: "star",
      label: "Average Rating",
      value: m.averageRating !== null ? `${m.averageRating}<span class="kpi-denom">/5</span>` : "—",
      sub: m.averageRating !== null ? "Across available platforms" : "No rating data",
    },
    {
      icon: "reviews",
      label: "Reviews Analysed",
      value: m.totalReviews.toLocaleString("en-AU"),
      sub: `${m.platformCount} platform${m.platformCount === 1 ? "" : "s"} with data`,
    },
    {
      icon: "users",
      label: "Customer Sentiment",
      value: `<span class="kpi-small">${esc(s.customerSentimentLabel || "—")}</span>`,
      sub: `Data quality: ${m.dataQuality}`,
    },
  ];
  return `<div class="kpi-grid">${cards
    .map(
      (c) => `<div class="kpi">
        <div class="kpi-icon">${icon(c.icon, 18)}</div>
        <div class="kpi-label">${esc(c.label)}</div>
        <div class="kpi-value">${c.value}</div>
        <div class="kpi-sub">${esc(c.sub)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function execSummary(report: BusinessReport): string {
  const m = report.metrics;
  const s = report.sections;
  const meaning =
    m.trustScore !== null
      ? `A Trust Score of ${m.trustScore}/100 places this business in the “${trustLabel(m.trustScore)}” range, based on ${m.totalReviews.toLocaleString("en-AU")} public reviews across ${m.platformCount} platform${m.platformCount === 1 ? "" : "s"}.`
      : `No public rating data was available to compute a Trust Score for this business yet.`;
  return `<p class="lede">${esc(s.executiveSummary)}</p>
    <div class="callout">
      <div class="callout-title">${icon("check", 14)} What this means</div>
      <div>${esc(meaning)}</div>
    </div>`;
}

function platformTable(m: ReportMetrics, s: AiSections): string {
  const meanings = s.platformMeanings || { google: "", yelp: "", tripadvisor: "" };
  const checklist = safeArr(s.platformChecklist);
  const actionFor = (platformName: string, hasData: boolean): string => {
    const match = checklist.find(
      (c) => (c.platform || "").toLowerCase().trim() === platformName.toLowerCase().trim(),
    );
    if (match && match.recommendedAction && match.recommendedAction !== "—")
      return match.recommendedAction;
    return hasData
      ? "Keep monitoring and responding to reviews"
      : "Not checked yet";
  };
  const rows = m.platforms
    .map((p) => {
      const meaning =
        (meanings as Record<string, string>)[p.key] ||
        (p.rating === "—" ? "No public listing found for this platform." : "");
      const hasData = p.rating !== "—";
      const status = hasData
        ? `<span class="pill pill-ok">Active</span>`
        : `<span class="pill pill-na">Not available</span>`;
      return `<tr>
        <td>${platformTile(p.key, p.platform)}</td>
        <td class="strong">${esc(p.rating)}</td>
        <td>${esc(p.reviews)}</td>
        <td>${status}</td>
        <td class="muted">${esc(meaning)}</td>
        <td class="muted">${esc(actionFor(p.platform, hasData))}</td>
      </tr>`;
    })
    .join("");
  return `<table class="tbl">
    <thead><tr>
      <th>Platform</th><th>Rating</th><th>Reviews</th><th>Status</th><th>Business Meaning</th><th>Recommended Action</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

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
    <div class="callout" style="margin-top:14px">
      <div class="callout-title">${icon("shield", 14)} How the Trust Score treats this</div>
      <div>${esc(TRUST_SCORE_EXPLANATION)}</div>
    </div>`;
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
            .map((t) => `<span class="chip" style="border-color:${color}55;color:${color}">${esc(t)}</span>`)
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
    ${se.insight ? `<div class="insight"><span class="insight-tag">${icon("chat", 13)} AI insight</span>${esc(se.insight)}</div>` : ""}`;
}

function strengthsSection(s: AiSections): string {
  const items = safeArr(s.topStrengths);
  if (!items.length)
    return `<p class="muted">No distinct strengths could be derived from the available data.</p>`;
  return `<div class="card-grid">${items
    .map(
      (st) => `<div class="mini-card strength-card">
        <div class="mini-icon ok">${icon("star", 15)}</div>
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
      return `<div class="mini-card" style="border-top:3px solid ${color}">
        <div class="mini-head">
          <div class="mini-title">${esc(c.theme)}</div>
          <span class="risk-badge" style="background:${color}">${esc(c.riskLevel)} risk</span>
        </div>
        <div class="mini-body">${esc(c.explanation)}</div>
        ${c.fix ? `<div class="mini-fix"><strong>Recommended fix:</strong> ${esc(c.fix)}</div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
}

function costingSection(items: string[]): string {
  const arr = safeArr(items);
  if (!arr.length)
    return `<p class="muted">No material issues identified from the available data.</p>`;
  return `<div class="risk-list">${arr
    .map(
      (i) => `<div class="risk-item">
        <span class="risk-ico">${icon("alert", 14)}</span>
        <span>${esc(i)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function languageSection(s: AiSections): string {
  const cl = s.customerLanguage;
  const group = (title: string, items: string[], color: string) => `
    <div class="lang-col">
      <div class="theme-title">${esc(title)}</div>
      <div class="chips">${
        safeArr(items).length
          ? safeArr(items)
              .map((w) => `<span class="chip" style="border-color:${color}55;color:${color}">${esc(w)}</span>`)
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
        <thead><tr><th>Competitor</th><th>Trust Score</th><th>Rating</th><th>Reviews</th><th>Comparison</th></tr></thead>
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
    s.competitorConclusion
      ? `<div class="conclusion">${icon("chart", 15)}<span>${esc(s.competitorConclusion)}</span></div>`
      : ""
  }`;
}

function offerSection(s: AiSections): string {
  const o = s.recommendedOffer;
  if (!o.offer) return `<p class="muted">No specific offer recommendation available.</p>`;
  return `<div class="offer-card">
    <div class="offer-kicker">${icon("gift", 15)} Recommended offer</div>
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
  return `<div class="timeline">${items
    .map(
      (d) => `<div class="tl-row">
        <div class="tl-day">${esc(d.day)}</div>
        <div class="tl-line"><span class="tl-dot"></span></div>
        <div class="tl-card">${esc(d.action)}</div>
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
        <div class="week-label">${icon("calendar", 13)} ${esc(w.week)}</div>
        <div class="week-focus">${esc(w.focus)}</div>
      </div>`,
    )
    .join("")}</div>`;
}

function templatesSection(s: AiSections): string {
  const t = s.responseTemplates;
  const block = (title: string, body: string, color: string) =>
    body
      ? `<div class="tpl-card" style="border-top:3px solid ${color}">
          <div class="tpl-title" style="color:${color}">${icon("reply", 14)} ${esc(title)}</div>
          <div class="tpl-body">${esc(body)}</div>
        </div>`
      : "";
  const positive = block("Positive review response", t.positive, "#16A34A");
  const negative = block("Critical review response", t.negative, "#DC2626");
  if (!positive && !negative)
    return `<p class="muted">No response templates were generated.</p>`;
  return `<div class="tpl-grid">${positive}${negative}</div>`;
}

function finalSection(s: AiSections): string {
  const f = s.finalRecommendation;
  const row = (label: string, val: string) =>
    val
      ? `<div class="final-row">
          <div class="final-label">${esc(label)}</div>
          <div class="final-val">${esc(val)}</div>
        </div>`
      : "";
  const body =
    row("Do first", f.first) +
    row("Fastest trust win", f.fastest) +
    row("Monitor next", f.monitor);
  if (!body)
    return `<p class="muted">Continue monitoring reviews and encourage satisfied customers to leave feedback.</p>`;
  return `<div class="final-card">${body}</div>`;
}

/* ===== Business Analytics (8 dashboard widgets) ===== */

const TREND_STYLES: Record<string, [string, string]> = {
  Improving: ["#16A34A", "&#8599;"],
  Stable: ["#7B3CFF", "&#8594;"],
  Declining: ["#DC2626", "&#8600;"],
};

function analyticsSection(report: BusinessReport): string {
  const m = report.metrics;
  const s = report.sections;
  const a = s.analytics;
  const calc = computeAnalytics(m);

  const widget = (title: string, iconName: string, body: string) =>
    `<div class="ana-card">
      <div class="ana-head"><span class="ana-ico">${icon(iconName, 15)}</span><span class="ana-title">${esc(title)}</span></div>
      ${body}
    </div>`;
  const na = (text: string) => `<p class="muted" style="margin:0">${esc(text)}</p>`;
  const note = (text: string) =>
    text ? `<div class="ana-note">${esc(text)}</div>` : "";

  /* 1. Trust Score Trend */
  const dir = a.trustScoreTrend.direction || "Unknown";
  const [trendColor, trendArrow] = TREND_STYLES[dir] || ["#5F6368", "&#8226;"];
  const trend = widget(
    "Trust Score Trend",
    "up",
    `<div class="ana-big" style="color:${trendColor}"><span class="ana-arrow">${trendArrow}</span>${esc(dir)}</div>
     ${note(a.trustScoreTrend.explanation || (dir === "Unknown" ? "Not enough review history to judge a trend yet." : ""))}
     <div class="ana-est">AI estimated from available review data</div>`,
  );

  /* 2. Review Volume Trend */
  const rv = calc.reviewVolume;
  let volBody: string;
  if (rv.competitorAverage !== null) {
    const maxN = Math.max(rv.own, rv.competitorAverage, 1);
    const volBar = (label: string, val: number, color: string) => `
      <div class="bar-row">
        <div class="bar-label" style="width:110px">${esc(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, Math.round((val / maxN) * 100))}%;background:${color}"></div></div>
        <div class="bar-val" style="width:64px">${val.toLocaleString("en-AU")}</div>
      </div>`;
    const volLabel =
      rv.comparison === "Above"
        ? "Above nearby competitor average"
        : rv.comparison === "Below"
          ? "Below nearby competitor average"
          : "In line with nearby competitors";
    volBody = `<div class="bars" style="margin-bottom:8px">
        ${volBar("This business", rv.own, "#7B3CFF")}
        ${volBar("Competitor avg", rv.competitorAverage, "#C9BEEF")}
      </div>
      <div class="ana-big ana-mid" style="color:${rv.comparison === "Below" ? "#DC2626" : rv.comparison === "Above" ? "#16A34A" : "#071A3D"}">${esc(volLabel)}</div>
      ${note(a.reviewVolumeInsight)}`;
  } else {
    volBody =
      `<div class="ana-big ana-mid">${rv.own.toLocaleString("en-AU")} reviews counted</div>` +
      note(
        a.reviewVolumeInsight ||
          "No competitor review counts were available to compare against.",
      );
  }
  const volume = widget("Review Volume Trend", "reviews", volBody);

  /* 3. Rating Gap Analysis */
  const rg = calc.ratingGap;
  const gapBars = rg.values
    .map((v) => {
      const has = v.rating !== null;
      return `<div class="bar-row">
        <div class="bar-label" style="width:86px">${esc(v.platform)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${has ? Math.round((v.rating! / 5) * 100) : 0}%;background:#7B3CFF"></div></div>
        <div class="bar-val" style="width:52px">${has ? v.rating!.toFixed(1) : "—"}</div>
      </div>`;
    })
    .join("");
  const gapLine =
    rg.gap !== null && rg.highest && rg.lowest
      ? `<div class="ana-big ana-mid" style="color:${rg.gap >= 0.5 ? "#F97316" : "#16A34A"}">${rg.gap.toFixed(1)}-star gap${rg.gap >= 0.5 ? ` (${esc(rg.highest.platform)} vs ${esc(rg.lowest.platform)})` : " — consistent across platforms"}</div>`
      : `<div class="ana-big ana-mid muted">Fewer than 2 platforms have ratings</div>`;
  const gapW = widget(
    "Rating Gap Analysis",
    "scale",
    `<div class="bars" style="margin-bottom:8px">${gapBars}</div>${gapLine}${note(a.ratingGapInsight)}`,
  );

  /* 4. Sentiment Breakdown */
  const se = s.sentiment;
  const hasSent = se.positive + se.neutral + se.negative > 0;
  const sentBar = (label: string, val: number, color: string) => `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, val))}%;background:${color}"></div></div>
      <div class="bar-val">${Math.round(val)}%</div>
    </div>`;
  const sentiment = widget(
    "Sentiment Breakdown",
    "chat",
    hasSent
      ? `<div class="bars" style="margin-bottom:4px">
          ${sentBar("Positive", se.positive, "#16A34A")}
          ${sentBar("Neutral", se.neutral, "#F97316")}
          ${sentBar("Negative", se.negative, "#DC2626")}
        </div>${se.estimated ? `<div class="ana-est">Estimated from available review text</div>` : ""}`
      : na("Not enough review text to estimate sentiment."),
  );

  /* 5. Complaint Frequency */
  const freq = safeArr(a.complaintFrequency);
  const complaint = widget(
    "Complaint Frequency",
    "alert",
    freq.length
      ? `<div class="ana-rows">${freq
          .map((c) => {
            const color = RISK_COLORS[c.frequency] || "#5F6368";
            return `<div class="ana-row">
              <span class="ana-row-text">${esc(c.issue)}${c.note ? `<span class="muted"> — ${esc(c.note)}</span>` : ""}</span>
              <span class="risk-badge" style="background:${color}">${esc(c.frequency || "—")}</span>
            </div>`;
          })
          .join("")}</div>`
      : na("No repeated complaint themes were identified in the available review samples."),
  );

  /* 6. Competitor Analytics */
  const comps = m.competitors;
  const competitor = widget(
    "Competitor Analytics",
    "chart",
    comps.length
      ? `<table class="tbl ana-tbl">
          <thead><tr><th>Competitor</th><th>Trust</th><th>Rating</th><th>Reviews</th><th>Position</th></tr></thead>
          <tbody>${comps
            .map(
              (c) => `<tr>
                <td class="strong">${esc(c.name)}${c.demo ? ` <span class="demo-tag">Illustrative</span>` : ""}</td>
                <td>${c.trustScore !== null ? `${esc(c.trustScore)}/100` : "—"}</td>
                <td>${esc(c.averageRating)}</td>
                <td>${esc(c.reviews)}</td>
                <td class="muted">${esc(c.comparison)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
        <div class="ana-est">Sentiment comparison is not available for competitors from public data.</div>`
      : na("No nearby competitor data was available for this report."),
  );

  /* 7. Lost Customer Risk */
  const lcr = a.lostCustomerRisk;
  const lcrColor = RISK_COLORS[lcr.level] || "#5F6368";
  const lost = widget(
    "Lost Customer Risk",
    "users",
    lcr.level || lcr.factors.length
      ? `${lcr.level ? `<div class="ana-big" style="color:${lcrColor}">${esc(lcr.level)} risk</div>` : ""}
        ${lcr.factors.length ? `<ul class="ana-list">${lcr.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        <div class="ana-est">AI estimated from available review data</div>`
      : na("Not enough data to estimate what may be stopping customers."),
  );

  /* 8. Growth Opportunity Score */
  const go = a.growthOpportunity;
  const growth = widget(
    "Growth Opportunity Score",
    "gauge",
    go.score !== null
      ? `<div class="ana-big" style="color:#7B3CFF">${Math.round(go.score)}<span class="ana-denom">/100</span></div>
        <div class="bar-track" style="margin:6px 0 10px"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, go.score))}%;background:linear-gradient(90deg,#7B3CFF,#9A5CFF)"></div></div>
        ${go.focusAreas.length ? `<div class="chips" style="margin-bottom:8px">${go.focusAreas.map((f) => `<span class="chip" style="border-color:#7B3CFF55;color:#7B3CFF">${esc(f)}</span>`).join("")}</div>` : ""}
        ${note(go.rationale)}
        <div class="ana-est">AI estimated — higher means more untapped opportunity</div>`
      : na("Not enough data to estimate a growth opportunity score yet."),
  );

  return `<p class="muted" style="margin-top:0">A dashboard view of the key reputation analytics behind this report. Estimated items are based only on the public review data available.</p>
    <div class="ana-grid">${trend}${volume}${gapW}${sentiment}${complaint}${competitor}${lost}${growth}</div>`;
}

const SECTION_ICONS: Record<number, string> = {
  1: "doc",
  2: "scale",
  3: "check",
  4: "chart",
  5: "chat",
  6: "star",
  7: "alert",
  8: "users",
  9: "speech",
  10: "chart",
  11: "gift",
  12: "up",
  13: "calendar",
  14: "flag",
  15: "reply",
  16: "shield",
};

function section(num: number, title: string, body: string): string {
  return `<section class="sec">
    <h2>
      <span class="sec-num">${num}</span>
      <span class="sec-title">${esc(title)}</span>
      <span class="sec-ico">${icon(SECTION_ICONS[num] || "doc", 17)}</span>
    </h2>
    ${body}
  </section>`;
}

/** Render the full premium styled HTML dashboard report from the persisted report JSON. */
export function buildReportHtml(report: BusinessReport): string {
  const m = report.metrics;
  const s = report.sections;
  const generated = new Date(report.generatedAt);
  const dateStr = isNaN(generated.getTime())
    ? ""
    : generated.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

  const meta = [
    dateStr ? `<span class="meta-chip">Generated ${esc(dateStr)}</span>` : "",
    `<span class="meta-chip" style="border-color:${qualityColor(m.dataQuality)}66;color:#fff"><span class="dot" style="background:${qualityColor(m.dataQuality)}"></span>Data quality: ${esc(m.dataQuality)}</span>`,
    `<span class="meta-chip">Platforms checked: Google, Yelp, TripAdvisor</span>`,
  ].join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI Business Reputation Report — ${esc(report.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 12mm; }
  body { margin:0; background:#F7F7F4; color:#050505; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; line-height:1.5; font-size:14px; }
  .wrap { max-width:940px; margin:0 auto; padding:0 22px 30px; }

  /* ===== Premium header ===== */
  .report-header { background:linear-gradient(135deg,#03122E 0%,#071A3D 60%,#12235C 100%); color:#fff; padding:44px 22px 40px; position:relative; overflow:hidden; }
  .report-header::before { content:""; position:absolute; top:-120px; right:-80px; width:420px; height:420px; border-radius:50%; background:radial-gradient(circle,rgba(123,60,255,.35) 0%,rgba(123,60,255,0) 70%); pointer-events:none; }
  .report-header::after { content:""; position:absolute; bottom:-160px; left:-100px; width:380px; height:380px; border-radius:50%; background:radial-gradient(circle,rgba(154,92,255,.18) 0%,rgba(154,92,255,0) 70%); pointer-events:none; }
  .report-header .inner { max-width:940px; margin:0 auto; position:relative; }
  .brand-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:22px; }
  .brand-name { font-size:14px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#E8E3FA; }
  .paid-badge { background:linear-gradient(135deg,#7B3CFF,#9A5CFF); color:#fff; border-radius:999px; padding:6px 16px; font-size:12px; font-weight:800; letter-spacing:.02em; box-shadow:0 4px 14px rgba(123,60,255,.4); }
  .report-header h1 { margin:0 0 10px; font-size:38px; font-weight:900; letter-spacing:-.02em; line-height:1.12; }
  .report-header .sub { color:#E8E3FA; font-size:17px; font-weight:700; margin-bottom:4px; }
  .report-header .addr { color:#9A8FC7; font-size:13.5px; margin-bottom:20px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; }
  .meta-chip { display:inline-flex; align-items:center; gap:7px; border:1px solid rgba(255,255,255,.28); color:#E8E3FA; border-radius:999px; padding:5px 13px; font-size:12px; font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }

  /* ===== KPI cards ===== */
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:26px 0 8px; }
  .kpi { background:#fff; border:1px solid #E5E5E5; border-radius:16px; padding:18px 16px; box-shadow:0 2px 8px rgba(7,26,61,.05); }
  .kpi-icon { width:34px; height:34px; border-radius:10px; background:#F1E8FF; color:#7B3CFF; display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
  .kpi-label { font-size:11px; color:#5F6368; margin-bottom:6px; text-transform:uppercase; letter-spacing:.06em; font-weight:700; }
  .kpi-value { font-size:30px; font-weight:900; color:#071A3D; line-height:1.05; letter-spacing:-.02em; }
  .kpi-denom { font-size:15px; font-weight:700; color:#5F6368; margin-left:2px; }
  .kpi-small { font-size:19px; }
  .kpi-sub { font-size:12px; color:#7B3CFF; margin-top:7px; font-weight:700; }

  /* ===== Section cards ===== */
  .sec { background:#fff; border:1px solid #E5E5E5; border-radius:18px; padding:26px 28px; margin-top:20px; box-shadow:0 2px 8px rgba(7,26,61,.05); page-break-inside:avoid; }
  .sec h2 { font-size:22px; font-weight:850; color:#071A3D; margin:0 0 18px; display:flex; align-items:center; gap:12px; letter-spacing:-.01em; }
  .sec-num { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; background:linear-gradient(135deg,#7B3CFF,#9A5CFF); color:#fff; border-radius:9px; font-size:15px; font-weight:800; flex:none; box-shadow:0 3px 8px rgba(123,60,255,.3); }
  .sec-title { flex:1; }
  .sec-ico { color:#C9BEEF; flex:none; display:inline-flex; }
  .sec p { margin:0 0 10px; }
  .lede { font-size:15px; }
  .muted { color:#5F6368; }
  .strong { font-weight:700; color:#071A3D; }
  .callout { background:#F1E8FF; border-radius:12px; padding:14px 16px; margin-top:14px; font-size:13.5px; color:#071A3D; }
  .callout-title { display:flex; align-items:center; gap:7px; font-weight:800; color:#7B3CFF; font-size:12px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }

  /* ===== Tables ===== */
  .tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
  .tbl th { text-align:left; background:#F1E8FF; color:#071A3D; padding:10px 12px; font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; font-weight:800; }
  .tbl th:first-child { border-radius:8px 0 0 8px; }
  .tbl th:last-child { border-radius:0 8px 8px 0; }
  .tbl td { padding:12px; border-bottom:1px solid #EEE; vertical-align:top; }
  .tbl tr:last-child td { border-bottom:none; }
  .pf-cell { display:flex; align-items:center; gap:9px; }
  .pf-tile { width:26px; height:26px; border-radius:8px; border:1.5px solid; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; background:#fff; flex:none; }
  .pill { display:inline-block; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; }
  .pill-ok { background:rgba(22,163,74,.12); color:#16A34A; }
  .pill-na { background:rgba(95,99,104,.1); color:#5F6368; }

  /* ===== Sentiment ===== */
  .bars { margin-bottom:10px; }
  .bar-row { display:flex; align-items:center; gap:12px; margin-bottom:9px; }
  .bar-label { width:72px; font-size:13px; color:#071A3D; font-weight:700; }
  .bar-track { flex:1; height:12px; background:#F1E8FF; border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:999px; }
  .bar-val { width:44px; text-align:right; font-size:13px; font-weight:800; color:#071A3D; }
  .est-note { font-size:12px; color:#5F6368; font-style:italic; margin:0 0 12px; }
  .theme-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:8px; }
  .theme-title { font-size:12.5px; font-weight:800; color:#071A3D; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { border:1px solid; border-radius:999px; padding:4px 11px; font-size:12px; background:#fff; font-weight:600; }
  .insight { background:#F1E8FF; border-radius:12px; padding:14px 16px; margin-top:14px; font-size:13.5px; color:#071A3D; }
  .insight-tag { display:inline-flex; align-items:center; gap:6px; font-weight:800; color:#7B3CFF; font-size:11px; text-transform:uppercase; letter-spacing:.05em; margin-right:8px; }

  /* ===== Cards ===== */
  .card-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .mini-card { border:1px solid #E5E5E5; border-radius:14px; padding:16px; background:#fff; box-shadow:0 1px 4px rgba(7,26,61,.04); }
  .mini-icon { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
  .mini-icon.ok { background:rgba(22,163,74,.1); color:#16A34A; }
  .mini-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:8px; }
  .mini-title { font-weight:800; color:#071A3D; margin-bottom:6px; font-size:14.5px; }
  .mini-head .mini-title { margin-bottom:0; }
  .mini-body { font-size:13.5px; color:#050505; }
  .mini-evi { font-size:12.5px; color:#5F6368; margin-top:8px; font-style:italic; }
  .mini-fix { font-size:13px; color:#071A3D; margin-top:10px; background:#F7F7F4; border-radius:9px; padding:9px 11px; }
  .risk-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; flex:none; }
  .prio-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; }

  .risk-list { display:flex; flex-direction:column; gap:10px; }
  .risk-item { display:flex; gap:11px; align-items:flex-start; background:#FAFAF8; border:1px solid #EEE; border-radius:11px; padding:12px 14px; font-size:13.5px; }
  .risk-ico { color:#F97316; flex:none; margin-top:2px; display:inline-flex; }

  /* ===== Business Analytics ===== */
  .ana-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .ana-card { border:1px solid #E5E5E5; border-radius:14px; padding:16px 18px; background:#fff; box-shadow:0 1px 4px rgba(7,26,61,.04); }
  .ana-head { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
  .ana-ico { width:28px; height:28px; border-radius:8px; background:#F1E8FF; color:#7B3CFF; display:inline-flex; align-items:center; justify-content:center; flex:none; }
  .ana-title { font-weight:800; color:#071A3D; font-size:14px; }
  .ana-big { font-size:22px; font-weight:900; color:#071A3D; letter-spacing:-.01em; margin-bottom:6px; }
  .ana-mid { font-size:15px; }
  .ana-arrow { margin-right:6px; }
  .ana-denom { font-size:14px; font-weight:700; color:#5F6368; }
  .ana-note { font-size:12.5px; color:#050505; background:#F7F7F4; border-radius:9px; padding:9px 11px; margin-top:8px; }
  .ana-est { font-size:11px; color:#5F6368; font-style:italic; margin-top:8px; }
  .ana-rows { display:flex; flex-direction:column; gap:8px; }
  .ana-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; background:#FAFAF8; border:1px solid #EEE; border-radius:10px; padding:9px 12px; font-size:13px; }
  .ana-row-text { flex:1; }
  .ana-list { margin:0; padding-left:18px; font-size:13px; }
  .ana-list li { margin-bottom:5px; }
  .ana-tbl th, .ana-tbl td { padding:8px 9px; font-size:12.5px; }

  .lang-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
  .conclusion { display:flex; gap:10px; align-items:flex-start; background:linear-gradient(135deg,#03122E,#071A3D); color:#fff; border-radius:12px; padding:15px 17px; margin-top:14px; font-weight:600; font-size:13.5px; }
  .conclusion svg { flex:none; margin-top:2px; color:#9A5CFF; }
  .demo-tag { font-size:10px; color:#5F6368; border:1px solid #E5E5E5; border-radius:6px; padding:1px 6px; font-weight:500; }

  /* ===== Offer ===== */
  .offer-card { background:linear-gradient(135deg,#7B3CFF,#9A5CFF); border-radius:16px; padding:22px 24px; color:#fff; box-shadow:0 8px 22px rgba(123,60,255,.3); }
  .offer-kicker { display:inline-flex; align-items:center; gap:7px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#F1E8FF; margin-bottom:10px; }
  .offer-head { font-weight:900; font-size:18px; margin-bottom:10px; letter-spacing:-.01em; }
  .offer-why { font-size:13.5px; margin-bottom:12px; color:#F1E8FF; }
  .offer-why strong { color:#fff; }
  .offer-copy { font-size:13.5px; color:#071A3D; background:#fff; border-radius:10px; padding:13px 15px; }

  .improve p { font-size:13.5px; margin:10px 0 0; }

  /* ===== 7-day timeline ===== */
  .timeline { display:flex; flex-direction:column; }
  .tl-row { display:grid; grid-template-columns:64px 26px 1fr; align-items:stretch; }
  .tl-day { font-weight:900; color:#7B3CFF; font-size:13px; padding:12px 0; white-space:nowrap; }
  .tl-line { position:relative; }
  .tl-line::before { content:""; position:absolute; left:50%; top:0; bottom:0; width:2px; background:#F1E8FF; transform:translateX(-50%); }
  .tl-row:first-child .tl-line::before { top:18px; }
  .tl-row:last-child .tl-line::before { bottom:calc(100% - 26px); }
  .tl-dot { position:absolute; left:50%; top:18px; width:10px; height:10px; border-radius:50%; background:linear-gradient(135deg,#7B3CFF,#9A5CFF); transform:translate(-50%,-50%); box-shadow:0 0 0 3px #F1E8FF; }
  .tl-card { background:#FAFAF8; border:1px solid #EEE; border-radius:11px; padding:11px 14px; margin:5px 0; font-size:13.5px; }

  /* ===== 30-day weeks ===== */
  .week-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .week-card { border:1px solid #E5E5E5; border-left:4px solid #7B3CFF; border-radius:12px; padding:15px 16px; background:#fff; box-shadow:0 1px 4px rgba(7,26,61,.04); }
  .week-label { display:flex; align-items:center; gap:7px; font-weight:900; color:#7B3CFF; margin-bottom:6px; font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; }
  .week-focus { font-size:13.5px; color:#050505; }

  /* ===== Templates ===== */
  .tpl-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .tpl-card { border:1px solid #E5E5E5; border-radius:12px; padding:16px; background:#FAFAF8; }
  .tpl-title { display:flex; align-items:center; gap:7px; font-weight:800; margin-bottom:10px; font-size:13.5px; }
  .tpl-body { font-size:13px; color:#050505; white-space:pre-wrap; }

  /* ===== Final recommendation ===== */
  .final-card { background:linear-gradient(135deg,#03122E,#071A3D); border-radius:14px; padding:6px 20px; color:#fff; }
  .final-row { display:grid; grid-template-columns:170px 1fr; gap:14px; padding:14px 0; border-bottom:1px solid rgba(255,255,255,.1); }
  .final-row:last-child { border-bottom:none; }
  .final-label { font-weight:900; color:#9A5CFF; font-size:12px; text-transform:uppercase; letter-spacing:.05em; padding-top:2px; }
  .final-val { font-size:14px; color:#F1E8FF; }

  .disclaimer { font-size:12px; color:#5F6368; margin-top:20px; padding:16px 18px; background:#fff; border:1px solid #E5E5E5; border-radius:12px; }

  /* ===== Footer ===== */
  .report-footer { background:#03122E; color:#9A8FC7; margin-top:34px; padding:22px; text-align:center; font-size:12px; }
  .report-footer .fb { color:#E8E3FA; font-weight:800; margin-bottom:4px; font-size:13px; }

  @media print {
    body { background:#fff; }
    .sec, .kpi, .mini-card, .week-card, .tpl-card { box-shadow:none; }
    .report-header, .offer-card, .final-card, .conclusion, .report-footer, .sec-num, .paid-badge, .tl-dot { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  @media (max-width:760px){
    .report-header h1 { font-size:28px; }
    .kpi-grid{grid-template-columns:repeat(2,1fr);}
    .card-grid,.lang-grid,.week-grid,.tpl-grid,.theme-grid,.ana-grid{grid-template-columns:1fr;}
    .final-row{grid-template-columns:1fr;gap:4px;}
    .tbl{font-size:12.5px;}
    .tl-row{grid-template-columns:52px 22px 1fr;}
  }
</style>
</head>
<body>
  <header class="report-header"><div class="inner">
    <div class="brand-row">
      <div class="brand-name">Find Business Reviews</div>
      <div class="paid-badge">Paid Report</div>
    </div>
    <h1>AI Business Reputation Report</h1>
    <div class="sub">Prepared for ${esc(report.businessName)}</div>
    ${report.businessAddress ? `<div class="addr">${esc(report.businessAddress)}</div>` : ""}
    <div class="meta">${meta}</div>
  </div></header>
  <div class="wrap">
    ${kpiCards(m, s)}
    ${section(1, "Executive Summary", execSummary(report))}
    ${section(2, "Platform-by-Platform Comparison", platformTable(m, s))}
    ${section(3, "Platform Checklist", checklistSection(s))}
    ${section(4, "Business Analytics", analyticsSection(report))}
    ${section(5, "AI Customer Sentiment Analysis", sentimentSection(s))}
    ${section(6, "Top Strengths Customers Mention", strengthsSection(s))}
    ${section(7, "Main Complaints and Risk Level", complaintsSection(s))}
    ${section(8, "What May Be Costing You Customers", costingSection(s.costingYouCustomers))}
    ${section(9, "Customer Language Insights", languageSection(s))}
    ${section(10, "Competitor Snapshot", competitorSection(m, s))}
    ${section(11, "Recommended Offer to Win More Bookings", offerSection(s))}
    ${section(12, "Review Improvement Opportunity", improvementSection(s))}
    ${section(13, "7-Day Reputation Action Plan", sevenDaySection(s))}
    ${section(14, "30-Day Reputation Plan", thirtyDaySection(s))}
    ${section(15, "Suggested Response Templates", templatesSection(s))}
    ${section(16, "Final Recommendation", finalSection(s))}
    <div class="disclaimer">${esc(report.disclaimer)}</div>
  </div>
  <footer class="report-footer">
    <div class="fb">Find Business Reviews — AI Business Reputation Report</div>
    <div>Prepared exclusively for ${esc(report.businessName)}. Independent. Unbiased. Built for smarter decisions.</div>
  </footer>
</body></html>`;
}
