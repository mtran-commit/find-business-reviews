import {
  PLATFORM_CHECKLIST_INTRO,
  TRUST_SCORE_EXPLANATION,
  REPORT_IMPORTANT_NOTICE,
  REPORT_DATA_CUTOFF,
  HOW_TO_USE_REPORT,
  COMPETITOR_NOTE,
  computeAnalytics,
  type BusinessReport,
  type AiSections,
  type ReportMetrics,
  type DataQuality,
} from "./reportContent";
import { BRAND_LOGO_MONO_PNG_BASE64 } from "./brandLogoMono";
import { ICON_PATHS, SECTION_ICON_NAMES } from "./reportIcons";

/** HTML-escape a value for safe insertion into markup. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Monochrome accent colours for card border accents (High → darkest). */
const RISK_COLORS: Record<string, string> = {
  High: "#111111",
  Medium: "#6B7280",
  Low: "#D1D5DB",
};

/* Monochrome pill styles: High = black/white, Medium = dark grey/white,
   Low = light grey/black, Not relevant = lightest grey/muted. */
const MONO_PILLS: Record<string, string> = {
  High: "background:#111111;color:#FFFFFF",
  Medium: "background:#4B5563;color:#FFFFFF",
  Low: "background:#E5E7EB;color:#111111",
  Rare: "background:#E5E7EB;color:#111111",
  "Not relevant": "background:#F3F4F6;color:#6B7280",
};

function pillStyle(level: string): string {
  return MONO_PILLS[level] || "background:#6B7280;color:#FFFFFF";
}

/** Initials for the client tile fallback (max 2 letters). */
function businessInitials(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/i.test(w))
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "B"
  );
}

/**
 * Client business branding tile: shows the trusted business logo when one is
 * available (http(s) only), otherwise a clean initials tile. A broken logo
 * image degrades to the initials at view time via the inline onerror handler.
 */
function clientTile(report: BusinessReport): string {
  const initials = esc(businessInitials(report.businessName));
  const logo = report.businessLogo || "";
  if (/^https?:\/\//i.test(logo)) {
    return `<div class="client-tile" data-in="${initials}"><img src="${esc(logo)}" alt="${esc(report.businessName)} logo" onerror="this.parentNode.textContent=this.parentNode.getAttribute('data-in')" /></div>`;
  }
  return `<div class="client-tile">${initials}</div>`;
}

/* Dot colour on the dark header band — light shades so it stays visible. */
function qualityColor(q: DataQuality): string {
  if (q === "High") return "#FFFFFF";
  if (q === "Medium") return "#9CA3AF";
  return "#6B7280";
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

function icon(name: string, size = 16): string {
  const paths = ICON_PATHS[name] || ICON_PATHS["doc"];
  const body = paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* Platform tiles — monochrome letter marks (report UI stays black/white/grey). */
function platformTile(key: string, name: string): string {
  const marks: Record<string, string> = { google: "G", yelp: "Y", tripadvisor: "T" };
  const mark = marks[key] || (name[0] || "?").toUpperCase();
  return `<span class="pf-cell"><span class="pf-tile">${esc(mark)}</span><span class="strong">${esc(name)}</span></span>`;
}

/** Small "Confidence: High · basis" line for individual insights. */
function confLine(confidence: string, basis: string): string {
  if (!confidence) return "";
  return `<div class="conf-line"><span class="conf-badge" style="${pillStyle(confidence)}">Confidence: ${esc(confidence)}</span>${basis ? `<span class="conf-basis">${esc(basis)}</span>` : ""}</div>`;
}

/** Fixed Important Notice + Data Cut-Off cards shown under the KPI cards. */
function noticeCards(): string {
  return `<div class="notice-card">
      <div class="notice-title">Important Notice</div>
      <div class="notice-body">${esc(REPORT_IMPORTANT_NOTICE)}</div>
    </div>
    <div class="notice-card">
      <div class="notice-title">Data Cut-Off</div>
      <div class="notice-body">${esc(REPORT_DATA_CUTOFF)}</div>
    </div>`;
}

/** Compact Executive Snapshot card (page 1, after the KPI cards). */
function executiveSnapshotCard(report: BusinessReport): string {
  const snap = report.sections.executiveSnapshot;
  const love = safeArr(snap.customersLove);
  const risks = safeArr(snap.mainRisks);
  if (!love.length && !risks.length && !snap.doFirst && !snap.monitorNext)
    return "";
  const row = (label: string, val: string) =>
    val
      ? `<div class="snap-row"><div class="snap-label">${esc(label)}</div><div class="snap-val">${esc(val)}</div></div>`
      : "";
  return `<div class="snap-card">
    <div class="snap-head">${icon("gauge", 15)} Executive Snapshot</div>
    ${row("Overall position", trustLabel(report.metrics.trustScore))}
    ${row("Customers love", love.join(" · "))}
    ${row("Main risks", risks.join(" · "))}
    ${row("Do first", snap.doFirst)}
    ${row("Monitor next", snap.monitorNext)}
  </div>`;
}

/** Highlighted "Top 3 Actions This Week" box (page 1). */
function topActionsCard(s: AiSections): string {
  const actions = safeArr(s.topActionsThisWeek);
  if (!actions.length) return "";
  return `<div class="top-actions">
    <div class="ta-head">${icon("check", 15)} Top 3 Actions This Week</div>
    <ol class="ta-list">${actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>
  </div>`;
}

/** Customer Voice Summary bullets (page 1). */
function voiceSummaryCard(s: AiSections): string {
  const items = safeArr(s.customerVoiceSummary).filter((i) => i.text);
  if (!items.length) return "";
  return `<div class="voice-summary">
    <div class="vs-head">${icon("chat", 15)} Customer Voice Summary</div>
    <ul class="vs-list">${items
      .map((i) => `<li><strong>${esc(i.label)}:</strong> ${esc(i.text)}</li>`)
      .join("")}</ul>
  </div>`;
}

/** Fixed "How to Use This Report" card (near the beginning). */
function howToUseCard(): string {
  return `<div class="howto-card">
    <div class="howto-title">How to Use This Report</div>
    <div class="howto-body">${esc(HOW_TO_USE_REPORT)}</div>
  </div>`;
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

/**
 * Compact "Social Presence Snapshot" card (between the KPI cards and section 1).
 * Shows only confidently matched public profiles; hides entirely when there is
 * no Google/Facebook/Instagram data. Deliberately short — it supports the
 * report, it does not dominate it.
 */
function socialSnapshot(report: BusinessReport): string {
  const sp = report.socialPresence;
  const rows: string[] = [];

  const g = report.metrics.platforms.find(
    (p) => p.key === "google" && p.rating !== "—",
  );
  if (g) {
    rows.push(
      socialRow("G", "Google",
        `${esc(g.rating)} from ${esc(g.reviews)} reviews`, ""),
    );
  }

  const fb = sp.facebook;
  if (fb) {
    const parts: string[] = [];
    if (fb.followers) parts.push(`${fb.followers} followers`);
    if (fb.likes) parts.push(`${fb.likes} likes`);
    if (fb.rating !== null) parts.push(`${fb.rating}/5`);
    if (fb.reviews !== null) parts.push(`${fb.reviews.toLocaleString("en-AU")} reviews`);
    if (parts.length > 0 || fb.profileUrl) {
      rows.push(
        socialRow("f", "Facebook",
          esc(parts.join(" · ") || "Public business page"), fb.profileUrl),
      );
    }
  }

  const ig = sp.instagram;
  if (ig) {
    const parts: string[] = [];
    if (ig.followers !== null) parts.push(`${ig.followers.toLocaleString("en-AU")} followers`);
    if (ig.posts !== null) parts.push(`${ig.posts.toLocaleString("en-AU")} posts`);
    if (ig.verified) parts.push("Verified");
    if (parts.length > 0 || ig.profileUrl) {
      rows.push(
        socialRow("I", "Instagram",
          esc(parts.join(" · ") || "Public business profile"), ig.profileUrl),
      );
    }
  }

  if (rows.length === 0) return "";
  return `<div class="social-snap">
    <div class="social-snap-title">Social Presence Snapshot</div>
    <div class="social-snap-rows">${rows.join("")}</div>
  </div>`;
}

function socialRow(
  mark: string,
  label: string,
  detailHtml: string,
  url: string,
): string {
  const safe = /^https?:\/\//i.test(url) ? url : "";
  const link = safe
    ? `<a class="social-link" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">View profile</a>`
    : "";
  return `<div class="social-row">
    <span class="pf-tile">${esc(mark)}</span>
    <span class="social-name">${esc(label)}</span>
    <span class="social-detail">${detailHtml}</span>
    ${link}
  </div>`;
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
      return `<tr>
        <td class="strong">${esc(c.platform)}</td>
        <td>${esc(c.relevant || "—")}</td>
        <td>${esc(c.currentStatus || "Not checked yet")}</td>
        <td>${esc(c.recommendedAction || "—")}</td>
        <td><span class="prio-badge" style="${pillStyle(c.priority)}">${esc(c.priority || "—")}</span></td>
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
      ${bar("Positive", se.positive, "#111827")}
      ${bar("Neutral", se.neutral, "#9CA3AF")}
      ${bar("Negative", se.negative, "#4B5563")}
    </div>
    ${se.estimated ? `<p class="est-note">Estimated from available review samples.</p>` : ""}
    <div class="theme-grid">
      ${themes("Positive themes", safeArr(se.positiveThemes), "#1F2937")}
      ${themes("Negative themes", safeArr(se.negativeThemes), "#4B5563")}
    </div>
    ${se.insight ? `<div class="insight"><span class="insight-tag">${icon("chat", 13)} AI insight</span>${esc(se.insight)}</div>` : ""}`;
}

function customerVoiceSection(s: AiSections): string {
  const cv = s.customerVoiceAnalysis;
  const tags = safeArr(cv.reviewTags);
  const love = safeArr(cv.whatCustomersLove);
  const concerns = safeArr(cv.customerConcerns);
  const expects = safeArr(cv.clientExpectationMap);
  const prios = safeArr(cv.improvementPriorities);
  const ar = cv.actionRecommendations;
  const li = cv.customerLanguageInsights;
  const hasActions =
    safeArr(ar.websiteChanges).length +
      safeArr(ar.reviewProcess).length +
      safeArr(ar.staffCommunication).length +
      safeArr(ar.marketingActions).length +
      safeArr(ar.competitorMonitoring).length >
    0;
  const hasLang =
    safeArr(li.wordsCustomersUse).length +
      safeArr(li.phrasesToUseInMarketing).length +
      safeArr(li.phrasesToAvoid).length >
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
    return `<p class="muted">Customer voice analysis was not available for this report. It is generated from public review text and Google review topic tags when the report is created.</p>`;
  }

  const block = (title: string, body: string) =>
    body ? `<div class="cv-block"><div class="cv-sub">${esc(title)}</div>${body}</div>` : "";

  // 1. Review tag analysis table (Google topic chips)
  const tagTable = tags.length
    ? `<p class="muted" style="font-size:13px;margin-bottom:10px">These are Google review topic tags — themes customers repeat in their reviews, with how many reviews mention each one.</p>
      <table class="tbl">
        <thead><tr><th>Tag / Topic</th><th>Mentions</th><th>Customer Meaning</th><th>Business Action</th></tr></thead>
        <tbody>${tags
          .map(
            (t) => `<tr>
              <td class="strong">${esc(t.tag)}</td>
              <td>${t.count > 0 ? esc(t.count) : "—"}</td>
              <td>${esc(t.customerMeaning)}</td>
              <td class="muted">${esc(t.businessAction)}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : "";

  // 2. What customers love most
  const loveCards = love.length
    ? `<div class="card-grid">${love
        .map(
          (l) => `<div class="mini-card strength-card">
            <div class="mini-icon ok">${icon("star", 15)}</div>
            <div class="mini-title">${esc(l.theme)}</div>
            <div class="mini-body">${esc(l.explanation)}</div>
            ${l.evidence ? `<div class="mini-evi">${esc(l.evidence)}</div>` : ""}
            ${l.opportunity ? `<div class="mini-fix"><strong>Opportunity:</strong> ${esc(l.opportunity)}</div>` : ""}
            ${confLine(l.confidence, l.confidenceBasis)}
          </div>`,
        )
        .join("")}</div>`
    : "";

  // 3. Concerns (never invented; honest note when limited)
  const concernCards = concerns.length
    ? `<div class="card-grid">${concerns
        .map((c) => {
          const color = RISK_COLORS[c.riskLevel as keyof typeof RISK_COLORS] || "#6B7280";
          return `<div class="mini-card" style="border-top:3px solid ${color}">
            <div class="mini-head">
              <div class="mini-title">${esc(c.theme)}</div>
              ${c.riskLevel ? `<span class="risk-badge" style="${pillStyle(c.riskLevel)}">${esc(c.riskLevel)} risk</span>` : ""}
            </div>
            <div class="mini-body">${esc(c.explanation)}</div>
            ${c.businessImpact ? `<div class="mini-impact"><strong>Business impact:</strong> ${esc(c.businessImpact)}</div>` : ""}
            ${c.recommendedFix ? `<div class="mini-fix"><strong>Recommended fix:</strong> ${esc(c.recommendedFix)}</div>` : ""}
            ${confLine(c.confidence, c.confidenceBasis)}
          </div>`;
        })
        .join("")}</div>`
    : "";
  const concernsBody =
    concernCards + (cv.concernsNote ? `<p class="est-note" style="margin-top:10px">${esc(cv.concernsNote)}</p>` : "");

  // 4. Client expectation map
  const expectChips = expects.length
    ? `<div class="chips">${expects
        .map((e) => `<span class="chip" style="border-color:#11111155;color:#111111">${esc(e)}</span>`)
        .join("")}</div>`
    : "";

  // 5. Improvement priorities (ranked)
  const prioRows = prios.length
    ? `<div class="risk-list">${prios
        .map((p, i) => {
          const color = RISK_COLORS[p.level as keyof typeof RISK_COLORS] || "#111111";
          return `<div class="cv-prio">
            <div class="cv-prio-head">
              <span class="sec-num" style="width:26px;height:26px;font-size:13px;border-radius:8px">${i + 1}</span>
              <span class="mini-title" style="flex:1">${esc(p.priority)}</span>
              ${p.level ? `<span class="prio-badge" style="${pillStyle(p.level)}">${esc(p.level)}</span>` : ""}
            </div>
            ${p.whyItMatters ? `<div class="cv-prio-line"><strong>Why:</strong> ${esc(p.whyItMatters)}</div>` : ""}
            ${p.action ? `<div class="cv-prio-line"><strong>Action:</strong> ${esc(p.action)}</div>` : ""}
            ${p.expectedImpact ? `<div class="cv-prio-line"><strong>Impact:</strong> ${esc(p.expectedImpact)}</div>` : ""}
          </div>`;
        })
        .join("")}</div>`
    : "";

  // 6. Action recommendations
  const arGroup = (title: string, items: string[]) =>
    safeArr(items).length
      ? `<div class="mini-card">
          <div class="mini-title" style="font-size:13px">${esc(title)}</div>
          <ul class="ana-list">${safeArr(items).map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        </div>`
      : "";
  const actionCards = hasActions
    ? `<div class="cv-action-grid">
        ${arGroup("Website changes", ar.websiteChanges)}
        ${arGroup("Review request process", ar.reviewProcess)}
        ${arGroup("Staff communication", ar.staffCommunication)}
        ${arGroup("Marketing actions", ar.marketingActions)}
        ${arGroup("Competitor monitoring", ar.competitorMonitoring)}
      </div>`
    : "";

  // 7. Customer language insights
  const langGroup = (title: string, items: string[], color: string) =>
    safeArr(items).length
      ? `<div class="lang-col">
          <div class="theme-title">${esc(title)}</div>
          <div class="chips">${safeArr(items)
            .map((w) => `<span class="chip" style="border-color:${color}55;color:${color}">${esc(w)}</span>`)
            .join("")}</div>
        </div>`
      : "";
  const langBody = hasLang
    ? `<div class="lang-grid">
        ${langGroup("Words customers use", li.wordsCustomersUse, "#111111")}
        ${langGroup("Marketing phrases to use", li.phrasesToUseInMarketing, "#1F2937")}
        ${langGroup("Phrases to avoid", li.phrasesToAvoid, "#4B5563")}
      </div>`
    : "";

  return `
    <p class="lede">What customers are actually saying — built from public review text, Google review topic tags and repeated customer language.</p>
    ${block("Most Mentioned Customer Themes", tagTable)}
    ${block("What Customers Love Most", loveCards)}
    ${block("What Customers May Be Concerned About", concernsBody)}
    ${block("Client Expectation Map", expectChips)}
    ${block("Improvement Priorities", prioRows)}
    ${block("Action Recommendations", actionCards)}
    ${block("Customer Language Insights", langBody)}`;
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
      const color = RISK_COLORS[c.riskLevel] || "#6B7280";
      return `<div class="mini-card" style="border-top:3px solid ${color}">
        <div class="mini-head">
          <div class="mini-title">${esc(c.theme)}</div>
          <span class="risk-badge" style="${pillStyle(c.riskLevel)}">${esc(c.riskLevel)} risk</span>
        </div>
        <div class="mini-body">${esc(c.explanation)}</div>
        ${c.businessImpact ? `<div class="mini-impact"><strong>Business impact:</strong> ${esc(c.businessImpact)}</div>` : ""}
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

function commercialSection(s: AiSections): string {
  const arr = safeArr(s.commercialImpact);
  if (!arr.length)
    return `<p class="muted">No commercial impact analysis was available for this report.</p>`;
  return `<p class="lede">How the review themes above may affect sales, bookings, foot traffic, enquiries and customer confidence.</p>
    <div class="risk-list">${arr
      .map(
        (i) => `<div class="risk-item">
          <span class="risk-ico">${icon("chart", 14)}</span>
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
    ${group("Words customers use", cl.words, "#111111")}
    ${group("Phrases to use in marketing", cl.marketingPhrases, "#1F2937")}
    ${group("Phrases / issues to avoid", cl.avoidPhrases, "#4B5563")}
  </div>`;
}

function competitorSection(m: ReportMetrics, s: AiSections): string {
  const comps = safeArr(m.competitors);
  const note = comps.length
    ? `<div class="notice-card" style="margin:0 0 12px"><div class="notice-title">Competitor Note</div><div class="notice-body">${esc(COMPETITOR_NOTE)}</div></div>`
    : "";
  const table = comps.length
    ? `${note}<table class="tbl">
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
  return `<div class="improve">
    <span class="risk-badge" style="${pillStyle(r.priority)}">Priority: ${esc(r.priority)}</span>
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
  const positive = block("Positive review response", t.positive, "#1F2937");
  const negative = block("Critical review response", t.negative, "#4B5563");
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
    row("Biggest customer risk", f.biggestRisk) +
    row("Best marketing opportunity", f.marketingOpportunity) +
    row("Monitor next", f.monitor);
  if (!body)
    return `<p class="muted">Continue monitoring reviews and encourage satisfied customers to leave feedback.</p>`;
  return `<div class="final-card">${body}</div>`;
}

/* ===== Business Analytics (8 dashboard widgets) ===== */

const TREND_STYLES: Record<string, [string, string]> = {
  Improving: ["#1F2937", "&#8599;"],
  Stable: ["#111111", "&#8594;"],
  Declining: ["#4B5563", "&#8600;"],
};

const CONFIDENCE_COLORS: Record<string, string> = {
  High: "#1F2937",
  Medium: "#6B7280",
  Low: "#4B5563",
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
  const dirRaw = a.trustScoreTrend.direction || "Unknown";
  const noHistory = dirRaw === "Unknown" || dirRaw === "Not enough historical data";
  const dir = noHistory ? "Not enough historical data" : dirRaw;
  const [trendColor, trendArrow] = TREND_STYLES[dir] || ["#5F6368", "&#8226;"];
  const trend = widget(
    "Trust Score Trend",
    "up",
    `<div class="ana-big${noHistory ? " ana-mid" : ""}" style="color:${trendColor}"><span class="ana-arrow">${trendArrow}</span>${esc(dir)}</div>
     ${note(noHistory ? "Trend tracking will begin from this report." : a.trustScoreTrend.explanation)}
     ${noHistory ? "" : `<div class="ana-est">AI estimated from available review data</div>`}`,
  );

  /* 2. Review Volume Analytics */
  const rv = calc.reviewVolume;
  let volBody: string;
  if (rv.topCompetitor !== null) {
    const maxN = Math.max(rv.own, rv.topCompetitor.reviews, 1);
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
          : rv.comparison === "Similar"
            ? "In line with nearby competitors"
            : "Comparison not available";
    const gapLine =
      rv.reviewGap !== null && rv.reviewGap > 0
        ? `<div class="ana-note"><strong>~${rv.reviewGap.toLocaleString("en-AU")} more reviews</strong> estimated to match the top nearby competitor (${esc(rv.topCompetitor.name)}). Increasing recent review volume may improve trust and conversion.</div>`
        : `<div class="ana-note">This business has as many public reviews as the top nearby competitor.</div>`;
    volBody = `<div class="bars" style="margin-bottom:8px">
        ${volBar("This business", rv.own, "#111111")}
        ${volBar("Top competitor", rv.topCompetitor.reviews, "#D1D5DB")}
      </div>
      <div class="ana-big ana-mid" style="color:${rv.comparison === "Below" ? "#4B5563" : rv.comparison === "Above" ? "#1F2937" : "#111111"}">${rv.own.toLocaleString("en-AU")} reviews analysed — ${esc(volLabel.toLowerCase())}</div>
      ${gapLine}
      ${note(a.reviewVolumeInsight)}`;
  } else {
    volBody =
      `<div class="ana-big ana-mid">${rv.own.toLocaleString("en-AU")} reviews analysed</div>` +
      note(
        a.reviewVolumeInsight ||
          "No competitor review counts were available to compare against.",
      );
  }
  const volume = widget("Review Volume Analytics", "reviews", volBody);

  /* 3. Rating Gap Analysis */
  const rg = calc.ratingGap;
  const gapBars = rg.values
    .map((v) => {
      const has = v.rating !== null;
      return `<div class="bar-row">
        <div class="bar-label" style="width:86px">${esc(v.platform)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${has ? Math.round((v.rating! / 5) * 100) : 0}%;background:#111111"></div></div>
        <div class="bar-val" style="width:52px">${has ? v.rating!.toFixed(1) : "—"}</div>
      </div>`;
    })
    .join("");
  const gapLine =
    rg.gap !== null && rg.highest && rg.lowest
      ? `<div class="ana-hilo">
          <span>Highest: <strong>${esc(rg.highest.platform)} ${rg.highest.rating.toFixed(1)}/5</strong></span>
          <span>Lowest: <strong>${esc(rg.lowest.platform)} ${rg.lowest.rating.toFixed(1)}/5</strong></span>
        </div>
        <div class="ana-big ana-mid" style="color:${rg.gap >= 0.5 ? "#6B7280" : "#1F2937"}">Rating gap: ${rg.gap.toFixed(1)} points${rg.gap < 0.5 ? " — consistent across platforms" : ""}</div>
        ${rg.gap >= 0.5 ? `<div class="ana-note">A larger rating gap may cause customers to hesitate when comparing platforms.</div>` : ""}`
      : `<div class="ana-big ana-mid muted">Fewer than 2 platforms have ratings</div>`;
  const gapW = widget(
    "Platform Rating Gap",
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
          ${sentBar("Positive", se.positive, "#111827")}
          ${sentBar("Neutral", se.neutral, "#9CA3AF")}
          ${sentBar("Negative", se.negative, "#4B5563")}
        </div>
        <div class="ana-hilo" style="margin-top:6px"><span>Confidence: <strong style="color:${CONFIDENCE_COLORS[calc.sentimentConfidence]}">${esc(calc.sentimentConfidence)}</strong></span></div>
        ${se.estimated ? `<div class="ana-est">Estimated from available public review samples.</div>` : ""}`
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
            return `<div class="ana-row">
              <span class="ana-row-text">${esc(c.issue)}${c.note ? `<span class="muted"> — ${esc(c.note)}</span>` : ""}</span>
              <span class="risk-badge" style="${pillStyle(c.frequency)}">${esc(c.frequency || "—")}</span>
            </div>`;
          })
          .join("")}</div>`
      : na("No repeated complaint themes were identified in the available review samples."),
  );

  /* 6. Competitor Gap */
  const cg = calc.competitorGap;
  let cgBody: string;
  if (cg.ownTrustScore !== null && cg.topCompetitor && cg.gap !== null) {
    const maxScore = Math.max(cg.ownTrustScore, cg.topCompetitor.trustScore, 1);
    const cgBar = (label: string, val: number, color: string) => `
      <div class="bar-row">
        <div class="bar-label" style="width:110px">${esc(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, Math.round((val / maxScore) * 100))}%;background:${color}"></div></div>
        <div class="bar-val" style="width:52px">${val}</div>
      </div>`;
    const ahead = cg.gap <= 0;
    cgBody = `<div class="bars" style="margin-bottom:8px">
        ${cgBar("Your Trust Score", cg.ownTrustScore, "#111111")}
        ${cgBar("Top competitor", cg.topCompetitor.trustScore, "#D1D5DB")}
      </div>
      <div class="ana-big ana-mid" style="color:${ahead ? "#1F2937" : "#6B7280"}">${ahead ? `You lead ${esc(cg.topCompetitor.name)} by ${Math.abs(cg.gap)} points` : `Gap to ${esc(cg.topCompetitor.name)}: ${cg.gap} points`}</div>
      <div class="ana-est">Sentiment comparison is not available for competitors from public data.</div>`;
  } else {
    cgBody = na(
      "No competitor Trust Scores were available to compare against for this report.",
    );
  }
  const competitor = widget("Competitor Gap", "chart", cgBody);

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
  const goLevel =
    go.level ||
    (go.score !== null ? (go.score >= 70 ? "High" : go.score >= 40 ? "Medium" : "Low") : "");
  const goColor =
    goLevel === "High" ? "#1F2937" : goLevel === "Medium" ? "#6B7280" : "#5F6368";
  const growth = widget(
    "Growth Opportunity Score",
    "gauge",
    goLevel
      ? `<div class="ana-big" style="color:${goColor}">${esc(goLevel)} opportunity</div>
        ${go.score !== null ? `<div class="bar-track" style="margin:6px 0 10px"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, go.score))}%;background:linear-gradient(90deg,#111111,#333333)"></div></div>` : ""}
        ${go.focusAreas.length ? `<div class="chips" style="margin-bottom:8px">${go.focusAreas.map((f) => `<span class="chip" style="border-color:#11111155;color:#111111">${esc(f)}</span>`).join("")}</div>` : ""}
        ${note(go.rationale)}
        <div class="ana-est">AI estimated from available review data</div>`
      : na("Not enough data to estimate a growth opportunity level yet."),
  );

  return `<p class="muted" style="margin-top:0">A dashboard view of the key reputation analytics behind this report. Estimated items are based only on the public review data available.</p>
    <div class="ana-grid">${trend}${volume}${gapW}${sentiment}${complaint}${competitor}${lost}${growth}</div>`;
}

function section(num: number, title: string, body: string): string {
  return `<section class="sec">
    <h2>
      <span class="sec-num">${num}</span>
      <span class="sec-title">${esc(title)}</span>
      <span class="sec-ico">${icon(SECTION_ICON_NAMES[num] || "doc", 17)}</span>
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
<title>AI Customer Review Sentiment Report — ${esc(report.businessName)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 12mm; }
  body { margin:0; background:#F7F7F4; color:#050505; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; line-height:1.5; font-size:14px; }
  .wrap { max-width:940px; margin:0 auto; padding:0 22px 30px; }

  /* ===== Premium header ===== */
  .report-header { background:linear-gradient(135deg,#0A0A0A 0%,#111111 60%,#1F1F1F 100%); color:#fff; padding:44px 22px 40px; position:relative; overflow:hidden; }
  .report-header::before { content:""; position:absolute; top:-120px; right:-80px; width:420px; height:420px; border-radius:50%; background:radial-gradient(circle,rgba(255,255,255,.07) 0%,rgba(255,255,255,0) 70%); pointer-events:none; }
  .report-header::after { content:""; position:absolute; bottom:-160px; left:-100px; width:380px; height:380px; border-radius:50%; background:radial-gradient(circle,rgba(255,255,255,.05) 0%,rgba(255,255,255,0) 70%); pointer-events:none; }
  .report-header .inner { max-width:940px; margin:0 auto; position:relative; }
  .brand-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:22px; }
  .brand-name { font-size:14px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#E5E7EB; }
  .brand-logo { height:36px; width:auto; display:block; }
  .client-row { display:flex; align-items:center; gap:13px; margin-bottom:20px; }
  .client-tile { width:48px; height:48px; border-radius:12px; background:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:19px; color:#111111; flex:0 0 auto; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,.28); }
  .client-tile img { width:100%; height:100%; object-fit:contain; padding:5px; box-sizing:border-box; background:#fff; display:block; }
  .client-meta .sub { margin-bottom:2px; }
  .client-meta .addr { margin-bottom:0; }
  .paid-badge { background:#FFFFFF; color:#111111; border-radius:999px; padding:6px 16px; font-size:12px; font-weight:800; letter-spacing:.02em; box-shadow:0 4px 14px rgba(0,0,0,.35); }
  .report-header h1 { margin:0 0 10px; font-size:38px; font-weight:900; letter-spacing:-.02em; line-height:1.12; }
  .report-header .sub { color:#E5E7EB; font-size:17px; font-weight:700; margin-bottom:4px; }
  .report-header .addr { color:#9CA3AF; font-size:13.5px; margin-bottom:20px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; }
  .meta-chip { display:inline-flex; align-items:center; gap:7px; border:1px solid rgba(255,255,255,.28); color:#E5E7EB; border-radius:999px; padding:5px 13px; font-size:12px; font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }

  /* ===== KPI cards ===== */
  .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:26px 0 8px; }
  .kpi { background:#fff; border:1px solid #E5E5E5; border-radius:16px; padding:18px 16px; box-shadow:0 2px 8px rgba(0,0,0,.05); }
  .kpi-icon { width:34px; height:34px; border-radius:10px; background:#F3F4F6; color:#111111; display:flex; align-items:center; justify-content:center; margin-bottom:12px; }
  .kpi-label { font-size:11px; color:#5F6368; margin-bottom:6px; text-transform:uppercase; letter-spacing:.06em; font-weight:700; }
  .kpi-value { font-size:30px; font-weight:900; color:#111111; line-height:1.05; letter-spacing:-.02em; }
  .kpi-denom { font-size:15px; font-weight:700; color:#5F6368; margin-left:2px; }
  .kpi-small { font-size:19px; }
  .kpi-sub { font-size:12px; color:#111111; margin-top:7px; font-weight:700; }
  .social-snap { background:#fff; border:1px solid #E5E5E5; border-radius:16px; padding:16px 18px; margin:16px 0 8px; box-shadow:0 2px 8px rgba(0,0,0,.05); }
  .social-snap-title { font-size:11px; color:#5F6368; text-transform:uppercase; letter-spacing:.08em; font-weight:800; margin-bottom:10px; }
  .social-snap-rows { display:flex; flex-direction:column; gap:8px; }
  .social-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:13.5px; }
  .social-name { font-weight:800; color:#111111; min-width:82px; }
  .social-detail { color:#333; }
  .social-link { margin-left:auto; font-size:12px; font-weight:700; color:#111111; text-decoration:none; border:1px solid #E5E7EB; border-radius:999px; padding:3px 10px; }

  /* ===== Section cards ===== */
  .sec { background:#fff; border:1px solid #E5E5E5; border-radius:18px; padding:26px 28px; margin-top:20px; box-shadow:0 2px 8px rgba(0,0,0,.05); page-break-inside:avoid; }
  .sec h2 { font-size:22px; font-weight:850; color:#111111; margin:0 0 18px; display:flex; align-items:center; gap:12px; letter-spacing:-.01em; }
  .sec-num { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; background:linear-gradient(135deg,#111111,#333333); color:#fff; border-radius:9px; font-size:15px; font-weight:800; flex:none; box-shadow:0 3px 8px rgba(0,0,0,.3); }
  .sec-title { flex:1; }
  .sec-ico { color:#D1D5DB; flex:none; display:inline-flex; }
  .sec p { margin:0 0 10px; }
  .lede { font-size:15px; }
  .muted { color:#5F6368; }
  .strong { font-weight:700; color:#111111; }
  .callout { background:#F3F4F6; border-radius:12px; padding:14px 16px; margin-top:14px; font-size:13.5px; color:#111111; }
  .callout-title { display:flex; align-items:center; gap:7px; font-weight:800; color:#111111; font-size:12px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }

  /* ===== Tables ===== */
  .tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
  .tbl th { text-align:left; background:#F3F4F6; color:#111111; padding:10px 12px; font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; font-weight:800; }
  .tbl th:first-child { border-radius:8px 0 0 8px; }
  .tbl th:last-child { border-radius:0 8px 8px 0; }
  .tbl td { padding:12px; border-bottom:1px solid #EEE; vertical-align:top; }
  .tbl tr:last-child td { border-bottom:none; }
  .pf-cell { display:flex; align-items:center; gap:9px; }
  .pf-tile { width:26px; height:26px; border-radius:8px; border:1.5px solid #D1D5DB; color:#111111; display:inline-flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; background:#fff; flex:none; }
  .pill { display:inline-block; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; }
  .pill-ok { background:rgba(31,41,55,.12); color:#1F2937; }
  .pill-na { background:rgba(95,99,104,.1); color:#5F6368; }

  /* ===== Sentiment ===== */
  .bars { margin-bottom:10px; }
  .bar-row { display:flex; align-items:center; gap:12px; margin-bottom:9px; }
  .bar-label { width:72px; font-size:13px; color:#111111; font-weight:700; }
  .bar-track { flex:1; height:12px; background:#F3F4F6; border-radius:999px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:999px; }
  .bar-val { width:44px; text-align:right; font-size:13px; font-weight:800; color:#111111; }
  .est-note { font-size:12px; color:#5F6368; font-style:italic; margin:0 0 12px; }
  .theme-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:8px; }
  .theme-title { font-size:12.5px; font-weight:800; color:#111111; margin-bottom:8px; text-transform:uppercase; letter-spacing:.04em; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { border:1px solid; border-radius:999px; padding:4px 11px; font-size:12px; background:#fff; font-weight:600; }
  .insight { background:#F3F4F6; border-radius:12px; padding:14px 16px; margin-top:14px; font-size:13.5px; color:#111111; }
  .insight-tag { display:inline-flex; align-items:center; gap:6px; font-weight:800; color:#111111; font-size:11px; text-transform:uppercase; letter-spacing:.05em; margin-right:8px; }

  /* ===== Cards ===== */
  .card-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
  .mini-card { border:1px solid #E5E5E5; border-radius:14px; padding:16px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .mini-icon { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
  .mini-icon.ok { background:rgba(31,41,55,.1); color:#1F2937; }
  .mini-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:8px; }
  .mini-title { font-weight:800; color:#111111; margin-bottom:6px; font-size:14.5px; }
  .mini-head .mini-title { margin-bottom:0; }
  .mini-body { font-size:13.5px; color:#050505; }
  .mini-evi { font-size:12.5px; color:#5F6368; margin-top:8px; font-style:italic; }
  .mini-fix { font-size:13px; color:#111111; margin-top:10px; background:#F7F7F4; border-radius:9px; padding:9px 11px; }
  .risk-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; flex:none; }
  .prio-badge { display:inline-block; color:#fff; border-radius:999px; padding:3px 11px; font-size:11px; font-weight:800; white-space:nowrap; }

  .risk-list { display:flex; flex-direction:column; gap:10px; }
  .risk-item { display:flex; gap:11px; align-items:flex-start; background:#FAFAF8; border:1px solid #EEE; border-radius:11px; padding:12px 14px; font-size:13.5px; }
  .risk-ico { color:#6B7280; flex:none; margin-top:2px; display:inline-flex; }

  /* ===== Business Analytics ===== */
  .ana-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .ana-card { border:1px solid #E5E5E5; border-radius:14px; padding:16px 18px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .ana-head { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
  .ana-ico { width:28px; height:28px; border-radius:8px; background:#F3F4F6; color:#111111; display:inline-flex; align-items:center; justify-content:center; flex:none; }
  .ana-title { font-weight:800; color:#111111; font-size:14px; }
  .ana-big { font-size:22px; font-weight:900; color:#111111; letter-spacing:-.01em; margin-bottom:6px; }
  .ana-mid { font-size:15px; }
  .ana-arrow { margin-right:6px; }
  .ana-denom { font-size:14px; font-weight:700; color:#5F6368; }
  .ana-note { font-size:12.5px; color:#050505; background:#F7F7F4; border-radius:9px; padding:9px 11px; margin-top:8px; }
  .ana-hilo { display:flex; gap:16px; flex-wrap:wrap; font-size:12.5px; color:#050505; margin-bottom:6px; }
  .ana-est { font-size:11px; color:#5F6368; font-style:italic; margin-top:8px; }
  .ana-rows { display:flex; flex-direction:column; gap:8px; }
  .ana-row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; background:#FAFAF8; border:1px solid #EEE; border-radius:10px; padding:9px 12px; font-size:13px; }
  .ana-row-text { flex:1; }
  .ana-list { margin:0; padding-left:18px; font-size:13px; }
  .ana-list li { margin-bottom:5px; }
  .ana-tbl th, .ana-tbl td { padding:8px 9px; font-size:12.5px; }

  .lang-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }

  /* ===== Customer Voice Analysis ===== */
  .cv-block { margin-top:20px; }
  .cv-sub { font-size:14px; font-weight:850; color:#111111; margin-bottom:10px; padding-left:10px; border-left:3px solid #111111; }
  .cv-prio { background:#FAFAF8; border:1px solid #EEE; border-radius:11px; padding:12px 14px; }
  .cv-prio-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .cv-prio-line { font-size:13px; margin-bottom:4px; }
  .cv-action-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .conclusion { display:flex; gap:10px; align-items:flex-start; background:linear-gradient(135deg,#0A0A0A,#111111); color:#fff; border-radius:12px; padding:15px 17px; margin-top:14px; font-weight:600; font-size:13.5px; }
  .conclusion svg { flex:none; margin-top:2px; color:#9CA3AF; }
  .demo-tag { font-size:10px; color:#5F6368; border:1px solid #E5E5E5; border-radius:6px; padding:1px 6px; font-weight:500; }

  /* ===== Offer ===== */
  .offer-card { background:linear-gradient(135deg,#111111,#333333); border-radius:16px; padding:22px 24px; color:#fff; box-shadow:0 8px 22px rgba(0,0,0,.3); }
  .offer-kicker { display:inline-flex; align-items:center; gap:7px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#F3F4F6; margin-bottom:10px; }
  .offer-head { font-weight:900; font-size:18px; margin-bottom:10px; letter-spacing:-.01em; }
  .offer-why { font-size:13.5px; margin-bottom:12px; color:#F3F4F6; }
  .offer-why strong { color:#fff; }
  .offer-copy { font-size:13.5px; color:#111111; background:#fff; border-radius:10px; padding:13px 15px; }

  .improve p { font-size:13.5px; margin:10px 0 0; }

  /* ===== 7-day timeline ===== */
  .timeline { display:flex; flex-direction:column; }
  .tl-row { display:grid; grid-template-columns:64px 26px 1fr; align-items:stretch; }
  .tl-day { font-weight:900; color:#111111; font-size:13px; padding:12px 0; white-space:nowrap; }
  .tl-line { position:relative; }
  .tl-line::before { content:""; position:absolute; left:50%; top:0; bottom:0; width:2px; background:#F3F4F6; transform:translateX(-50%); }
  .tl-row:first-child .tl-line::before { top:18px; }
  .tl-row:last-child .tl-line::before { bottom:calc(100% - 26px); }
  .tl-dot { position:absolute; left:50%; top:18px; width:10px; height:10px; border-radius:50%; background:linear-gradient(135deg,#111111,#333333); transform:translate(-50%,-50%); box-shadow:0 0 0 3px #F3F4F6; }
  .tl-card { background:#FAFAF8; border:1px solid #EEE; border-radius:11px; padding:11px 14px; margin:5px 0; font-size:13.5px; }

  /* ===== 30-day weeks ===== */
  .week-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .week-card { border:1px solid #E5E5E5; border-left:4px solid #111111; border-radius:12px; padding:15px 16px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .week-label { display:flex; align-items:center; gap:7px; font-weight:900; color:#111111; margin-bottom:6px; font-size:12.5px; text-transform:uppercase; letter-spacing:.04em; }
  .week-focus { font-size:13.5px; color:#050505; }

  /* ===== Templates ===== */
  .tpl-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .tpl-card { border:1px solid #E5E5E5; border-radius:12px; padding:16px; background:#FAFAF8; }
  .tpl-title { display:flex; align-items:center; gap:7px; font-weight:800; margin-bottom:10px; font-size:13.5px; }
  .tpl-body { font-size:13px; color:#050505; white-space:pre-wrap; }

  /* ===== Final recommendation ===== */
  .final-card { background:linear-gradient(135deg,#0A0A0A,#111111); border-radius:14px; padding:6px 20px; color:#fff; }
  .final-row { display:grid; grid-template-columns:170px 1fr; gap:14px; padding:14px 0; border-bottom:1px solid rgba(255,255,255,.1); }
  .final-row:last-child { border-bottom:none; }
  .final-label { font-weight:900; color:#9CA3AF; font-size:12px; text-transform:uppercase; letter-spacing:.05em; padding-top:2px; }
  .final-val { font-size:14px; color:#F3F4F6; }

  .disclaimer { font-size:12px; color:#5F6368; margin-top:20px; padding:16px 18px; background:#fff; border:1px solid #E5E5E5; border-radius:12px; }

  /* ===== Page-1 executive cards & notices ===== */
  .notice-card { background:#F3F4F6; border:1px solid #E5E7EB; border-radius:12px; padding:12px 16px; margin:14px 0 0; }
  .notice-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#4B5563; margin-bottom:4px; }
  .notice-body { font-size:12px; color:#5F6368; line-height:1.55; }
  .snap-card { background:#fff; border:1.5px solid #111111; border-radius:16px; padding:18px 20px; margin:18px 0 0; box-shadow:0 2px 8px rgba(0,0,0,.05); }
  .snap-head { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; color:#111111; margin-bottom:10px; }
  .snap-row { display:grid; grid-template-columns:170px 1fr; gap:12px; padding:9px 0; border-bottom:1px solid #F3F4F6; }
  .snap-row:last-child { border-bottom:none; }
  .snap-label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#6B7280; padding-top:2px; }
  .snap-val { font-size:13.5px; color:#111111; font-weight:600; }
  .top-actions { background:linear-gradient(135deg,#0A0A0A,#1F2937); border-radius:16px; padding:18px 20px; margin:18px 0 0; color:#fff; }
  .ta-head { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px; }
  .ta-list { margin:0; padding-left:22px; }
  .ta-list li { font-size:13.5px; color:#F3F4F6; padding:4px 0; }
  .voice-summary { background:#fff; border:1px solid #E5E5E5; border-radius:16px; padding:18px 20px; margin:18px 0 0; box-shadow:0 2px 8px rgba(0,0,0,.05); }
  .vs-head { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; color:#111111; margin-bottom:10px; }
  .vs-list { margin:0; padding-left:20px; }
  .vs-list li { font-size:13.5px; color:#111111; padding:4px 0; line-height:1.55; }
  .vs-list li strong { color:#111111; }
  .howto-card { background:#F9FAFB; border:1px solid #E5E7EB; border-radius:12px; padding:14px 18px; margin:14px 0 0; }
  .howto-title { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; color:#111111; margin-bottom:5px; }
  .howto-body { font-size:13px; color:#374151; line-height:1.6; }
  .conf-line { display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
  .conf-badge { display:inline-block; border-radius:999px; padding:2px 10px; font-size:10.5px; font-weight:800; letter-spacing:.03em; }
  .conf-basis { font-size:11.5px; color:#6B7280; }
  .mini-impact { font-size:12.5px; color:#374151; margin-top:8px; padding-top:8px; border-top:1px dashed #E5E7EB; }

  /* ===== Footer ===== */
  .report-footer { background:#0A0A0A; color:#9CA3AF; margin-top:34px; padding:22px; text-align:center; font-size:12px; }
  .report-footer .fb { color:#E5E7EB; font-weight:800; margin-bottom:4px; font-size:13px; }

  @media print {
    body { background:#fff; }
    .sec, .kpi, .mini-card, .week-card, .tpl-card { box-shadow:none; }
    .report-header, .offer-card, .final-card, .conclusion, .report-footer, .sec-num, .paid-badge, .tl-dot, .top-actions, .notice-card, .snap-card { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
  @media (max-width:760px){
    .report-header h1 { font-size:28px; }
    .kpi-grid{grid-template-columns:repeat(2,1fr);}
    .card-grid,.lang-grid,.week-grid,.tpl-grid,.theme-grid,.ana-grid{grid-template-columns:1fr;}
    .final-row{grid-template-columns:1fr;gap:4px;}
    .snap-row{grid-template-columns:1fr;gap:3px;}
    .tbl{font-size:12.5px;}
    .tl-row{grid-template-columns:52px 22px 1fr;}
  }
</style>
</head>
<body>
  <header class="report-header"><div class="inner">
    <div class="brand-row">
      <img class="brand-logo" src="data:image/png;base64,${BRAND_LOGO_MONO_PNG_BASE64}" alt="Find Business Reviews" />
      <div class="paid-badge">Premium AI Reputation Report</div>
    </div>
    <h1>AI Customer Review Sentiment Report</h1>
    <div class="client-row">
      ${clientTile(report)}
      <div class="client-meta">
        <div class="sub">Prepared for ${esc(report.businessName)}</div>
        ${report.businessAddress ? `<div class="addr">${esc(report.businessAddress)}</div>` : ""}
      </div>
    </div>
    <div class="meta">${meta}</div>
  </div></header>
  <div class="wrap">
    ${kpiCards(m, s)}
    ${noticeCards()}
    ${executiveSnapshotCard(report)}
    ${topActionsCard(s)}
    ${voiceSummaryCard(s)}
    ${howToUseCard()}
    ${socialSnapshot(report)}
    ${section(1, "Reputation Analytics", analyticsSection(report))}
    ${section(2, "Executive Summary", execSummary(report))}
    ${section(3, "Platform-by-Platform Comparison", platformTable(m, s))}
    ${section(4, "Platform Checklist", checklistSection(s))}
    ${section(5, "AI Customer Sentiment Analysis", sentimentSection(s))}
    ${section(6, "Customer Voice Analysis", customerVoiceSection(s))}
    ${section(7, "Top Strengths Customers Mention", strengthsSection(s))}
    ${section(8, "Main Complaints and Risk Level", complaintsSection(s))}
    ${section(9, "What May Be Costing You Customers", costingSection(s.costingYouCustomers))}
    ${section(10, "What This Means Commercially", commercialSection(s))}
    ${section(11, "Customer Language Insights", languageSection(s))}
    ${section(12, "Competitor Snapshot", competitorSection(m, s))}
    ${section(13, "Recommended Offer to Win More Bookings", offerSection(s))}
    ${section(14, "Review Improvement Opportunity", improvementSection(s))}
    ${section(15, "7-Day Reputation Action Plan", sevenDaySection(s))}
    ${section(16, "30-Day Reputation Plan", thirtyDaySection(s))}
    ${section(17, "Suggested Response Templates", templatesSection(s))}
    ${section(18, "Final Recommendation", finalSection(s))}
    <div class="disclaimer"><strong>Data Cut-Off:</strong> ${esc(REPORT_DATA_CUTOFF)}</div>
    <div class="disclaimer">${esc(report.disclaimer)}</div>
  </div>
  <footer class="report-footer">
    <div class="fb">Find Business Reviews — AI Customer Review Sentiment Report</div>
    <div>Prepared exclusively for ${esc(report.businessName)}. Independent. Unbiased. Built for smarter decisions.</div>
  </footer>
</body></html>`;
}
