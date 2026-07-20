import type { Logger } from "pino";
import {
  dataforseoLive,
  dataforseoReviews,
  dataforseoTripadvisorSearch,
  dataforseoTrustpilotSearch,
  dataforseoTrustpilotReviews,
  type DataforseoCreds,
} from "./dataforseo";
import {
  resolveWebsiteLogo,
  type LogoConfidence,
  type LogoSource,
  type ResolvedLogo,
} from "./logo";

/**
 * Business reviews lookup across a split of two providers.
 *
 * DataForSEO (primary) supplies:
 *   - Google business profile + rating (my_business_info/live)
 *   - nearby/similar competitors (serp/google/maps/live/advanced)
 *   - TripAdvisor aggregate rating (business_data/tripadvisor/search task_post + task_get, priority:2)
 *   - Google review snippets (business_data/google/reviews task_post + task_get)
 *
 * SerpApi (kept) supplies:
 *   - yelp         : Yelp business search (to resolve a place_id by name)
 *   - yelp_reviews : Yelp reviews for that place_id (rating + snippets)
 *
 * The Yelp business-search engine no longer exposes an aggregate rating, so
 * we resolve the matching Yelp listing by name, then derive the rating from
 * the first page of yelp_reviews (average of returned review stars) and use
 * `search_information.total_results` as the total review count. This is an
 * approximation of the live Yelp aggregate, accurate for businesses with few
 * reviews and a close estimate for high-volume ones.
 *
 * Docs: https://docs.dataforseo.com/v3/ , https://serpapi.com/yelp-api ,
 *       https://serpapi.com/yelp-reviews-api
 */

const SERPAPI_BASE = "https://serpapi.com/search.json";

/** DataForSEO location/language defaults (the app is Australia-focused). */
const DFS_LOCATION = "Australia";
const DFS_LANGUAGE = "en";

export interface PlatformRating {
  rating: number;
  reviews: number;
}

/**
 * A public discount/offer for a business. Until a real offer-search exists this
 * is deterministic demo data flagged with `demo: true`, so the UI can clearly
 * label it rather than presenting a fabricated offer as a real one.
 */
export interface Offer {
  available: boolean;
  title: string;
  description: string;
  source: string;
  url: string;
  demo: boolean;
}

/**
 * Structured brand-logo decision. `url` is null (confidence "none") whenever no
 * trustworthy logo was found — the UI shows initials in that case. Only show the
 * image when `confidence` is "high" or "medium". `reason` aids debugging.
 */
export interface BusinessLogo {
  url: string | null;
  source: LogoSource;
  confidence: LogoConfidence;
  reason: string;
}

/** A nearby business for the comparison rows. `demo` flags fallback data. */
export interface NearbyBusiness {
  name: string;
  category: string;
  location: string;
  /** Structured brand-logo decision (show only when high/medium confidence). */
  logo: BusinessLogo;
  /** Colour business photo when available (optional for rows). */
  imageUrl: string;
  google: PlatformRating | null;
  yelp: PlatformRating | null;
  tripadvisor: PlatformRating | null;
  demo: boolean;
}

/** Detected industry/category of a business, used to find true peers. */
export interface BusinessCategory {
  /** Stable group key, e.g. "real_estate", "restaurant", "plumber". */
  key: string;
  /** Plural lowercase label for the section title, e.g. "real estate agencies". */
  label: string;
  /** Singular Title Case label for a row, e.g. "Real Estate Agency". */
  rowLabel: string;
  /** Term used to build the SerpApi similar-business query. */
  searchTerm: string;
}

/** A suburb/state extracted from an Australian address (or the query). */
export interface Locality {
  suburb: string;
  state: string;
}

/** Detected country context derived from a user-supplied location string. */
export interface LocationContext {
  countryName: string;   // e.g. "United Kingdom"
  countryCode: string;   // ISO-2: "GB", "AU", "NZ", "US", "CA", etc.
  /** DataForSEO `location_name` value for this country. */
  locationName: string;
  confidence: "high" | "medium" | "low";
}

export interface BusinessReviews {
  name: string;
  address: string;
  logoText: string;
  /** Structured brand-logo decision (show only when high/medium confidence). */
  logo: BusinessLogo;
  /** Colour business photo when available (Google Maps thumbnail). */
  imageUrl: string;
  website: string;
  phone: string;
  directionsUrl: string;
  google: PlatformRating | null;
  tripadvisor: PlatformRating | null;
  yelp: PlatformRating | null;
  /** Trustpilot aggregate (DataForSEO async search); null when no match. */
  trustpilot: PlatformRating | null;
  /** ProductReview.com.au aggregate (Google rich snippet); null when no match. */
  productReview: PlatformRating | null;
  /** Facebook page rating (Google rich snippet); null when no match. */
  facebook: PlatformRating | null;
  /** Public offer (demo data for now; flagged via `offer.demo`). */
  offer: Offer;
  /** Detected industry/category of this business. */
  category: BusinessCategory;
  /** Suburb/state of this business (drives the "near <suburb>" title). */
  locality: Locality;
  /** Similar nearby businesses: same category + suburb. `demo` flags fallbacks. */
  nearby: NearbyBusiness[];
  unavailable: string[];
  /**
   * Platform keys not yet resolved (phase-1 core lookup only). The client
   * resolves each via `/search-business-platform`. Absent on full lookups.
   */
  pending?: string[];
  /** Platform keys whose data is demo/placeholder (excluded from metrics). */
  demo: string[];
  /** Per-platform status note shown when a platform has no rating. */
  notes: Record<string, string>;
  source: "serpapi" | "dataforseo";
}

/** Tokens too generic to use for matching a business name to a Yelp listing. */
const MATCH_STOPWORDS = new Set([
  "the", "and", "of", "a", "an", "coffee", "cafe", "caffe", "restaurant",
  "company", "co", "inc", "llc", "ltd", "bar", "grill", "kitchen", "shop",
  "store", "house", "food", "foods",
]);

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function distinctiveTokens(s: string): string[] {
  return normalizeName(s)
    .split(" ")
    .filter((t) => t.length > 1 && !MATCH_STOPWORDS.has(t));
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** A "no trustworthy logo" decision (UI shows initials). */
function makeFallbackLogo(reason: string): ResolvedLogo {
  return { url: null, source: "fallback", confidence: "none", reason };
}

/** True when the UI will fall back to initials for this logo decision. */
function usesInitialsFallback(logo: BusinessLogo): boolean {
  return (
    !logo.url || (logo.confidence !== "high" && logo.confidence !== "medium")
  );
}

/** Structured per-result logging of the logo decision, for debugging. */
function logLogoDecision(name: string, logo: BusinessLogo, log?: Logger): void {
  log?.info(
    {
      business: name,
      logoUrl: logo.url,
      logoSource: logo.source,
      logoConfidence: logo.confidence,
      logoReason: logo.reason,
      initialsFallback: usesInitialsFallback(logo),
    },
    "logo decision",
  );
}

/** Derive a Yelp `find_loc` (city/region) from a Google-style address. */
function deriveLocation(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  // Drop the street line; the remainder is usually "City State Zip".
  if (parts.length >= 2) return parts.slice(1).join(", ");
  return address;
}

export async function serpapiGet(
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(SERPAPI_BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const message =
      typeof json["error"] === "string"
        ? json["error"]
        : `SerpApi responded with status ${res.status}`;
    throw new Error(message);
  }
  if (typeof json["error"] === "string") {
    throw new Error(json["error"]);
  }
  return json;
}

/**
 * Look up a business by free-text query and return its ratings across the
 * supported platforms. Returns `null` when no business matches the query.
 */
/** Platform keys resolvable individually via `resolvePlatformRating`. */
export const SLOW_PLATFORM_KEYS = [
  "yelp",
  "tripadvisor",
  "trustpilot",
  "productReview",
  "facebook",
] as const;
export type SlowPlatformKey = (typeof SLOW_PLATFORM_KEYS)[number];

/**
 * Resolve ONE non-Google platform's rating for a business already identified
 * by the core lookup. Used by the phased search flow so each HTTP request
 * stays well under mobile WebView timeouts (~60s on iOS).
 */
export async function resolvePlatformRating(
  platform: SlowPlatformKey,
  name: string,
  address: string,
  query: string,
  creds: DataforseoCreds,
  serpApiKey: string | null,
  log?: Logger,
): Promise<PlatformLookup> {
  const loc = deriveLocation(address);
  const nameTokens = distinctiveTokens(name);
  const suburb = extractLocality(address, query).suburb;
  switch (platform) {
    case "yelp":
      return resolveYelp(name, loc, nameTokens, serpApiKey, log);
    case "tripadvisor":
      return resolveTripadvisor(name, address, nameTokens, creds, log);
    case "trustpilot":
      return resolveTrustpilot(name, address, nameTokens, creds, log);
    case "productReview":
      return resolveProductReview(name, suburb, nameTokens, creds, log);
    case "facebook":
      return resolveFacebook(name, suburb, nameTokens, creds, log);
  }
}

export async function fetchBusinessReviews(
  query: string,
  creds: DataforseoCreds,
  serpApiKey: string | null,
  log?: Logger,
  location?: string,
): Promise<BusinessReviews | null> {
  const core = await fetchBusinessCore(query, creds, log, location);
  if (!core) return null;
  const results = await Promise.all(
    SLOW_PLATFORM_KEYS.map((k) =>
      resolvePlatformRating(k, core.name, core.address, query, creds, serpApiKey, log),
    ),
  );
  SLOW_PLATFORM_KEYS.forEach((k, i) => {
    const r = results[i]!;
    core[k] = r.rating;
    if (r.note) core.notes[k] = r.note;
    if (!r.rating) core.unavailable.push(k);
  });
  delete core.pending;
  return core;
}

/**
 * Fast phase-1 lookup: Google business profile + rating, logo, category and
 * nearby businesses. The five slow platforms are left null and listed in
 * `pending` for the client to resolve via `resolvePlatformRating`.
 */
export async function fetchBusinessCore(
  query: string,
  creds: DataforseoCreds,
  log?: Logger,
  location?: string,
): Promise<BusinessReviews | null> {
  // Detect country from location for correct DataForSEO location scoping.
  // Falls back to DFS_LOCATION ("Australia") when no location is provided or
  // when confidence is too low to override.
  const locationCtx = location ? detectCountryFromLocation(location) : null;
  const dfsLocation = locationCtx?.locationName ?? DFS_LOCATION;

  log?.info(
    {
      searchQuery: query,
      locationQuery: location ?? "",
      dfsLocation,
      detectedCountry: locationCtx?.countryName ?? "(default)",
      detectedCountryCode: locationCtx?.countryCode ?? "",
      detectedConfidence: locationCtx?.confidence ?? "none",
    },
    "business search start",
  );

  // ---- Google business profile + rating (DataForSEO Google Maps search) ----
  // We use the Maps SERP endpoint (not `my_business_info/live`) as the primary
  // lookup: it accepts free-text/search-style queries (e.g. "Apple Melbourne"),
  // returns the top-ranked matching business, and is faster + more reliable.
  // `my_business_info/live` only resolves a single exact business — it returns
  // "No Search Results" for common multi-location queries and can take ~30s,
  // exceeding our request timeout. The Maps item is a superset of the fields we
  // read (rating.value/votes_count, address/address_info, url/domain, phone,
  // main_image, category/additional_categories, latitude/longitude).
  // When the caller provides an explicit location, append it to the keyword so
  // DataForSEO returns locally-scoped results (e.g. "cafe Mornington VIC"
  // instead of just "cafe" against all of Australia). extractBusinessName()
  // below strips the location back off when scoring candidates.
  const dfsKeyword = location ? `${query} ${location}` : query;

  const items = await dataforseoLive(
    "/serp/google/maps/live/advanced",
    {
      keyword: dfsKeyword,
      location_name: dfsLocation,
      language_code: DFS_LANGUAGE,
      depth: 10,
    },
    creds,
    log,
    30000,
  );

  let place: Record<string, unknown> | undefined;

  if (location && locationCtx) {
    // With explicit location: score all candidates and pick the best above the
    // acceptance threshold. Wrong-country candidates score -100, which always
    // drops them below the threshold regardless of name match quality.
    const businessName = extractBusinessName(query, location);

    log?.info(
      { businessName, location, dfsLocation, candidates: items.length },
      "scoring candidates",
    );

    let bestScore = -Infinity;
    let bestCandidate: Record<string, unknown> | undefined;

    for (const item of items) {
      const title = typeof item["title"] === "string" ? (item["title"] as string) : "";
      if (!title.trim()) continue;
      const sc = calculateBusinessMatchScore(item, businessName, location, locationCtx, log);
      if (sc > bestScore) { bestScore = sc; bestCandidate = item; }
    }

    if (bestCandidate && bestScore >= MATCH_THRESHOLD) {
      log?.info(
        { accepted: bestCandidate["title"] as string, score: bestScore, threshold: MATCH_THRESHOLD },
        "candidate accepted",
      );
      place = bestCandidate;
    } else {
      log?.info(
        { bestScore, threshold: MATCH_THRESHOLD, primaryQuery: query },
        "no candidate above threshold; trying fallbacks",
      );
      place = await tryLocationFallbacks(query, location, locationCtx, creds, log);
      if (!place) {
        log?.info({ query, location }, "no match found — returning null");
        return null;
      }
    }
  } else {
    // No location provided: keep original first-result behaviour (AU-focused default).
    place = items.find(
      (it) => typeof it["title"] === "string" && (it["title"] as string).trim(),
    );
  }

  if (!place) return null;

  const name = typeof place["title"] === "string" ? place["title"] : query;
  const address = dfsAddress(place);
  const phone = typeof place["phone"] === "string" ? place["phone"] : "";
  const website = dfsWebsite(place);
  // `main_image` is a colour business photo (always shown). We do NOT trust a
  // DataForSEO `logo` as the brand mark — it can be a platform/placeholder
  // icon. The one trustworthy source is the business's OWN website, scraped
  // below (`resolveWebsiteLogo`); anything uncertain falls back to initials.
  const imageUrl =
    typeof place["main_image"] === "string" ? place["main_image"] : "";

  const google = dfsRating(place);

  // Category hints from the profile: `category` (string) + `additional_categories`.
  const placeTypes: string[] = [];
  for (const field of ["category", "additional_categories", "category_ids"]) {
    const v = place[field];
    if (typeof v === "string") placeTypes.push(v);
    else if (Array.isArray(v)) {
      for (const t of v) if (typeof t === "string") placeTypes.push(t);
    }
  }

  const lat = place["latitude"];
  const lng = place["longitude"];
  let directionsUrl: string;
  if (typeof lat === "number" && typeof lng === "number") {
    directionsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  } else {
    directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${name} ${address}`.trim(),
    )}`;
  }

  const notes: Record<string, string> = {};

  // The five non-Google platforms are slow (some need async task queues). They
  // are resolved separately — either by `fetchBusinessReviews` (full lookup for
  // reports) or per-platform by the client via `/search-business-platform` —
  // so this core response returns in a few seconds.
  const yelp = null;
  const tripadvisor = null;
  const trustpilot = null;
  const productReview = null;
  const facebook = null;

  const unavailable: string[] = [];
  if (!google) unavailable.push("google");

  // ---- Similar businesses + brand logo (resolved concurrently) ----
  const category = detectBusinessCategory(name, query, placeTypes);
  const locality = extractLocality(address, query);
  const [nearby, logo] = await Promise.all([
    fetchSimilarBusinesses(category, locality, name, creds, log),
    resolveWebsiteLogo(website, log),
  ]);
  logLogoDecision(name, logo, log);

  return {
    name,
    address,
    logoText: initials(name),
    logo,
    imageUrl,
    website,
    phone,
    directionsUrl,
    google,
    tripadvisor,
    yelp,
    trustpilot,
    productReview,
    facebook,
    offer: buildDemoOffer(name, website),
    category,
    locality,
    nearby,
    unavailable,
    demo: [],
    notes,
    pending: [...SLOW_PLATFORM_KEYS],
    source: "dataforseo",
  };
}

/** Map a DataForSEO `rating` object ({value, votes_count}) to a PlatformRating. */
function dfsRating(obj: unknown): PlatformRating | null {
  if (!obj || typeof obj !== "object") return null;
  const r = (obj as Record<string, unknown>)["rating"];
  if (!r || typeof r !== "object") return null;
  const value = (r as Record<string, unknown>)["value"];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const votes = (r as Record<string, unknown>)["votes_count"];
  return {
    rating: value,
    reviews: typeof votes === "number" && votes > 0 ? Math.round(votes) : 0,
  };
}

/** Read a business address from a DataForSEO item (string or address_info). */
function dfsAddress(obj: Record<string, unknown>): string {
  if (typeof obj["address"] === "string" && obj["address"].trim())
    return obj["address"];
  const info = obj["address_info"];
  if (info && typeof info === "object") {
    const parts = ["address", "city", "region", "zip", "country_code"]
      .map((k) => (info as Record<string, unknown>)[k])
      .filter((v): v is string => typeof v === "string" && !!v.trim());
    if (parts.length > 0) return parts.join(", ");
  }
  return "";
}

/** Read the business website (`url`/`domain`), ignoring Google-owned links. */
function dfsWebsite(obj: Record<string, unknown>): string {
  const url = obj["url"];
  if (typeof url === "string" && url.trim() && !/(^|\.)google\./i.test(url))
    return url;
  const domain = obj["domain"];
  if (typeof domain === "string" && domain.trim() && !/google\./i.test(domain))
    return domain.startsWith("http") ? domain : `https://${domain}`;
  return "";
}

/** Small, stable string hash so demo data stays constant per business name. */
export function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const OFFER_TITLES = [
  "10% off your first booking",
  "Free delivery on your first order",
  "Special deal available this week",
  "Complimentary drink with any meal",
  "15% off for new customers",
];

/**
 * Deterministic demo offer per business. About half of businesses get an
 * "OFFER FOUND" placeholder; the rest report no offer. Flagged with `demo:true`
 * and `source: "Demo data"` so the UI never presents it as a verified real offer.
 * Replace with a real SerpApi/search-backed lookup later.
 */
export function buildDemoOffer(name: string, website: string): Offer {
  const hash = hashString("offer:" + name);
  const available = hash % 2 === 0;
  if (!available) {
    return {
      available: false,
      title: "",
      description: "No public discount or offer was found today.",
      source: "",
      url: "",
      demo: true,
    };
  }
  return {
    available: true,
    title: OFFER_TITLES[hash % OFFER_TITLES.length] as string,
    description: "Placeholder offer from demo data — not a verified public offer.",
    source: "Demo data",
    url: website || "",
    demo: true,
  };
}

/** Deterministic demo rating in the 3.8–4.9 range for an arbitrary seed. */
function demoRating(seed: string, minReviews: number, span: number): PlatformRating {
  const h = hashString(seed);
  const rating = Math.round((3.8 + (h % 12) / 10) * 10) / 10; // 3.8–4.9
  const reviews = minReviews + (h % span);
  return { rating, reviews };
}

/* ===========================================================================
 * Category detection + suburb extraction + similar-business lookup
 *
 * Similar businesses must match BOTH the searched business's industry/category
 * AND its suburb. We detect the category from the Google Maps profile types,
 * the business name and the user query, parse the suburb from the Australian
 * address, then run a real SerpApi `google_maps` search for that category near
 * that suburb. When no real peers are found we fall back to category-specific,
 * suburb-aware demo data (flagged `demo:true`) — never the wrong category.
 * ======================================================================== */

interface CategoryDef {
  key: string;
  label: string;
  rowLabel: string;
  searchTerm: string;
  /** Single-word keywords match on word tokens; multi-word match as substrings. */
  keywords: string[];
}

/**
 * Ordered most-specific-first so e.g. "cafe" wins over the broader "restaurant"
 * group, and a specific trade (plumber) is preferred over generic terms.
 */
const CATEGORY_GROUPS: CategoryDef[] = [
  {
    key: "real_estate",
    label: "real estate agencies",
    rowLabel: "Real Estate Agency",
    searchTerm: "real estate agency",
    keywords: [
      "real estate", "realtor", "realty", "estate agent", "property management",
      "property", "rentals", "ray white", "barry plant", "buxton", "hockingstuart",
      "harcourts", "remax", "re/max", "belle property", "obrien", "o'brien",
      "first national", "jellis craig", "nelson alexander", "mcgrath", "lj hooker",
      "raine & horne", "stockdale", "biggin",
    ],
  },
  {
    key: "cafe",
    label: "cafes",
    rowLabel: "Cafe",
    searchTerm: "cafes",
    keywords: ["cafe", "café", "caffe", "coffee", "espresso", "roastery", "brunch"],
  },
  {
    key: "restaurant",
    label: "restaurants",
    rowLabel: "Restaurant",
    searchTerm: "restaurants",
    keywords: [
      "restaurant", "pizza", "pizzeria", "pasta", "bistro", "grill", "bar",
      "takeaway", "dining", "eatery", "kitchen", "sushi", "ramen", "thai",
      "indian", "chinese", "italian", "trattoria", "osteria", "bakery", "food",
      "steakhouse", "tapas", "diner", "noodle", "burger",
    ],
  },
  {
    key: "hotel",
    label: "hotels",
    rowLabel: "Hotel",
    searchTerm: "hotels",
    keywords: [
      "hotel", "motel", "accommodation", "resort", "serviced apartment", "inn",
      "lodge", "hostel", "bed and breakfast",
    ],
  },
  { key: "plumber", label: "plumbers", rowLabel: "Plumber", searchTerm: "plumbers", keywords: ["plumber", "plumbing"] },
  { key: "electrician", label: "electricians", rowLabel: "Electrician", searchTerm: "electricians", keywords: ["electrician", "electrical"] },
  { key: "builder", label: "builders", rowLabel: "Builder", searchTerm: "builders", keywords: ["builder", "building", "construction"] },
  { key: "carpenter", label: "carpenters", rowLabel: "Carpenter", searchTerm: "carpenters", keywords: ["carpenter", "carpentry", "joinery", "cabinet maker"] },
  { key: "roofer", label: "roofers", rowLabel: "Roofer", searchTerm: "roofers", keywords: ["roofer", "roofing"] },
  { key: "painter", label: "painters", rowLabel: "Painter", searchTerm: "painters", keywords: ["painter", "painting", "decorator"] },
  { key: "mechanic", label: "mechanics", rowLabel: "Mechanic", searchTerm: "mechanics", keywords: ["mechanic", "automotive", "auto repair", "car service", "panel beater"] },
  { key: "handyman", label: "handyman services", rowLabel: "Handyman", searchTerm: "handyman", keywords: ["handyman"] },
  {
    key: "beauty",
    label: "beauty & wellness venues",
    rowLabel: "Beauty & Wellness",
    searchTerm: "beauty salon",
    keywords: [
      "beauty", "spa", "salon", "hairdresser", "hair", "barber", "nails", "nail",
      "massage", "skin", "cosmetic", "waxing", "brows", "lashes",
    ],
  },
  { key: "dentist", label: "dentists", rowLabel: "Dentist", searchTerm: "dentists", keywords: ["dentist", "dental", "orthodontist"] },
  {
    key: "medical",
    label: "clinics",
    rowLabel: "Clinic",
    searchTerm: "medical clinic",
    keywords: ["doctor", "medical", "physiotherapy", "physio", "chiropractor", "optometrist", "clinic", "podiatry", "psychology"],
  },
  {
    key: "retail",
    label: "shops",
    rowLabel: "Shop",
    searchTerm: "shops",
    keywords: ["shop", "store", "retailer", "boutique", "supermarket", "pharmacy", "chemist", "grocery", "grocer"],
  },
];

const GENERIC_CATEGORY: BusinessCategory = {
  key: "business",
  label: "businesses",
  rowLabel: "Business",
  searchTerm: "businesses",
};

function toCategory(def: CategoryDef): BusinessCategory {
  return { key: def.key, label: def.label, rowLabel: def.rowLabel, searchTerm: def.searchTerm };
}

/**
 * Detect a business's industry/category from its Google Maps profile types, its
 * name and the user query. Single-word keywords match on word tokens (so "bar"
 * never matches "barber"); multi-word keywords match as substrings. Falls back
 * to a generic "businesses" category when nothing matches.
 */
export function detectBusinessCategory(
  name: string,
  query: string,
  placeTypes: string[] = [],
): BusinessCategory {
  const haystack = [...placeTypes, name, query].join(" ").toLowerCase();
  const tokens = new Set(
    haystack.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean),
  );
  for (const def of CATEGORY_GROUPS) {
    for (const kw of def.keywords) {
      const multi = /[\s/'&]/.test(kw);
      if (multi ? haystack.includes(kw) : tokens.has(kw)) return toCategory(def);
    }
  }
  return { ...GENERIC_CATEGORY };
}

const AU_STATES = new Set(["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

/**
 * Extract the suburb (and state) from an Australian address such as
 * "463 Nepean Hwy, Chelsea VIC 3196, Australia" → { suburb: "Chelsea",
 * state: "VIC" }. The suburb is the text before the state abbreviation. Falls
 * back to the last token of the query when no address suburb is available.
 */
export function extractLocality(address: string, query = ""): Locality {
  let suburb = "";
  let state = "";

  if (address) {
    const parts = address
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => p.toLowerCase() !== "australia");

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      const toks = part.split(/\s+/);
      const stateIdx = toks.findIndex((t) =>
        AU_STATES.has(t.toUpperCase().replace(/\./g, "")),
      );
      if (stateIdx >= 0) {
        state = (toks[stateIdx] as string).toUpperCase().replace(/\./g, "");
        const before = toks.slice(0, stateIdx).join(" ").trim();
        if (before) suburb = before;
        else if (i > 0) suburb = parts[i - 1] as string;
        break;
      }
    }
    if (!suburb && parts.length >= 2) suburb = parts[parts.length - 2] as string;
  }

  if (!suburb && query) {
    const qt = query.trim().split(/\s+/);
    suburb = (qt[qt.length - 1] as string) ?? "";
  }

  return { suburb, state };
}

// ---------------------------------------------------------------------------
// Country detection + match scoring (fixes wrong-country search results)
// ---------------------------------------------------------------------------

// UK postcode: covers full formats e.g. N20 0UZ, SW1A 1AA, EC1A 1BB
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}\b/i;
// Canadian postal code: e.g. K1A 0A6, V6B 4N8
const CA_POSTCODE_RE = /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i;
// US ZIP: 5-digit (± hyphen+4). Only used as a medium-confidence fallback.
const US_ZIP_RE = /\b\d{5}(?:-\d{4})?\b/;

// Unambiguous AU state abbreviations (WA excluded — overlaps with Washington state)
const AU_STATES_UNAMBIGUOUS = new Set(["VIC", "NSW", "QLD", "SA", "TAS", "NT", "ACT"]);

// Well-known UK city names for medium-confidence detection
const UK_CITIES_SET = new Set([
  "london", "manchester", "birmingham", "liverpool", "leeds", "sheffield",
  "edinburgh", "glasgow", "bristol", "nottingham", "leicester", "coventry",
  "bradford", "cardiff", "belfast", "newcastle", "brighton", "hull",
  "wolverhampton", "southampton", "portsmouth", "derby", "reading",
  "northampton", "york", "middlesbrough", "peterborough", "oxford",
  "cambridge", "exeter", "norwich", "sunderland", "barnet", "croydon",
  "islington", "lambeth", "lewisham", "southwark", "wandsworth",
]);

// Well-known NZ city names for medium-confidence detection
const NZ_CITIES_SET = new Set([
  "auckland", "wellington", "christchurch", "hamilton", "tauranga",
  "napier", "hastings", "palmerston north", "nelson", "rotorua",
  "dunedin", "new plymouth", "whangarei", "invercargill", "whanganui",
]);

// European + other key countries — matched by full country name in location string
const EU_COUNTRY_MAP: Record<string, { code: string; location: string }> = {
  italy: { code: "IT", location: "Italy" },
  france: { code: "FR", location: "France" },
  spain: { code: "ES", location: "Spain" },
  germany: { code: "DE", location: "Germany" },
  netherlands: { code: "NL", location: "Netherlands" },
  ireland: { code: "IE", location: "Ireland" },
  portugal: { code: "PT", location: "Portugal" },
  greece: { code: "GR", location: "Greece" },
  switzerland: { code: "CH", location: "Switzerland" },
  austria: { code: "AT", location: "Austria" },
  belgium: { code: "BE", location: "Belgium" },
  sweden: { code: "SE", location: "Sweden" },
  norway: { code: "NO", location: "Norway" },
  denmark: { code: "DK", location: "Denmark" },
  finland: { code: "FI", location: "Finland" },
  poland: { code: "PL", location: "Poland" },
  singapore: { code: "SG", location: "Singapore" },
  india: { code: "IN", location: "India" },
  japan: { code: "JP", location: "Japan" },
  "south africa": { code: "ZA", location: "South Africa" },
  "united arab emirates": { code: "AE", location: "United Arab Emirates" },
  dubai: { code: "AE", location: "United Arab Emirates" },
  uae: { code: "AE", location: "United Arab Emirates" },
};

/**
 * Detect the country from a user-supplied location string. Returns null when
 * no confident signal is found (searches then fall back to the default AU bias).
 * Used to set the correct DataForSEO `location_name` and to score / reject
 * wrong-country candidates in `calculateBusinessMatchScore`.
 */
export function detectCountryFromLocation(location: string): LocationContext | null {
  if (!location) return null;
  const loc = location.trim();
  const lower = loc.toLowerCase();

  // 1. High-confidence explicit country keywords
  if (/\b(united kingdom|england|scotland|wales|northern ireland)\b/i.test(loc)) {
    return mk("United Kingdom", "GB", "high");
  }
  // "\buk\b" — must be a standalone word
  if (/(?:^|[\s,/])uk(?:[\s,/]|$)/i.test(loc)) {
    return mk("United Kingdom", "GB", "high");
  }
  if (/\b(united states of america|united states|usa)\b/i.test(loc)) {
    return mk("United States", "US", "high");
  }
  if (/\bnew zealand\b/i.test(loc)) {
    return mk("New Zealand", "NZ", "high");
  }
  // "\bnz\b" as a standalone token
  if (/(?:^|[\s,/])nz(?:[\s,/]|$)/i.test(loc)) {
    return mk("New Zealand", "NZ", "high");
  }
  if (/\bcanada\b/i.test(loc)) {
    return mk("Canada", "CA", "high");
  }
  if (/\baustralia\b/i.test(loc)) {
    return mk("Australia", "AU", "high");
  }

  // 2. European + other countries by full name
  for (const [name, meta] of Object.entries(EU_COUNTRY_MAP)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(loc)) {
      return { countryName: meta.location, countryCode: meta.code, locationName: meta.location, confidence: "high" };
    }
  }

  // 3. UK postcode pattern (unambiguous, high confidence)
  if (UK_POSTCODE_RE.test(loc)) {
    return mk("United Kingdom", "GB", "high");
  }

  // 4. Canadian postal code (unambiguous, high confidence)
  if (CA_POSTCODE_RE.test(loc)) {
    return mk("Canada", "CA", "high");
  }

  // 5. Unambiguous Australian state abbreviations
  const tokens = loc.toUpperCase().split(/[\s,./()[\]-]+/).filter(Boolean);
  for (const tok of tokens) {
    if (AU_STATES_UNAMBIGUOUS.has(tok)) {
      return mk("Australia", "AU", "high");
    }
  }
  // WA is ambiguous — only use it if another AU token is also present
  if (
    tokens.includes("WA") &&
    (loc.toUpperCase().includes("AUSTRALIA") || tokens.some((t) => AU_STATES_UNAMBIGUOUS.has(t)))
  ) {
    return mk("Australia", "AU", "high");
  }

  // 6. UK city names (medium confidence)
  const words = lower.split(/[\s,./()[\]-]+/);
  for (const city of UK_CITIES_SET) {
    if (city.includes(" ") ? lower.includes(city) : words.includes(city)) {
      return mk("United Kingdom", "GB", "medium");
    }
  }

  // 7. NZ city names (medium confidence)
  for (const city of NZ_CITIES_SET) {
    if (city.includes(" ") ? lower.includes(city) : words.includes(city)) {
      return mk("New Zealand", "NZ", "medium");
    }
  }

  // 8. US ZIP code (medium confidence — 5-digit numbers appear elsewhere too)
  if (US_ZIP_RE.test(loc)) {
    return mk("United States", "US", "medium");
  }

  return null;
}

function mk(countryName: string, countryCode: string, confidence: LocationContext["confidence"]): LocationContext {
  return { countryName, countryCode, locationName: countryName, confidence };
}

/** Minimum score for a candidate to be accepted as the search result. */
const MATCH_THRESHOLD = 55;

/** Extract postcode-like strings from a location query (all formats). */
function extractPostcodes(location: string): string[] {
  const seen = new Set<string>();
  const add = (s: string) => seen.add(s.toUpperCase().replace(/\s+/, " "));
  let m: RegExpExecArray | null;
  const re1 = /[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/gi;
  while ((m = re1.exec(location)) !== null) add(m[0]);
  const re2 = /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/gi;
  while ((m = re2.exec(location)) !== null) add(m[0]);
  const re3 = /\b\d{5}(?:-\d{4})?\b/g;
  while ((m = re3.exec(location)) !== null) add(m[0]);
  const re4 = /\b\d{4}\b/g;
  while ((m = re4.exec(location)) !== null) add(m[0]);
  return [...seen];
}

/** Extract the street name from the first comma segment (minus leading number).
 * Returns "" when the segment doesn't start with a house/unit number, so that
 * bare suburb inputs like "Mornington VIC" don't produce a spurious street match.
 */
function extractStreetName(location: string): string {
  const firstSeg = location.split(",")[0]?.trim() ?? "";
  // Require a leading digit — if there's no house number, it's not a street address.
  if (!/^\d/.test(firstSeg)) return "";
  return firstSeg.replace(/^\d+(?:[/\-]\d+)?\w*\s+/, "").trim();
}

/** Extract city/suburb tokens from the middle comma-segments of a location. */
function extractCityTokens(location: string): string[] {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return parts
      .slice(1, -1)
      .map((p) =>
        p.replace(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/gi, "")
          .replace(/\b\d{4,5}\b/g, "")
          .trim(),
      )
      .filter(Boolean);
  }
  if (parts.length === 2) {
    return [
      (parts[0] ?? "")
        .replace(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/gi, "")
        .replace(/\b\d{4,5}\b/g, "")
        .trim(),
    ].filter(Boolean);
  }
  // No commas: try to extract suburb/city by space-splitting and removing
  // state abbreviations, postcodes, country keywords, and road suffixes.
  // e.g. "Mornington VIC" → ["Mornington"], "London N20 0UZ" → ["London"]
  const COUNTRY_WORDS = new Set([
    "australia", "uk", "usa", "england", "scotland", "wales",
    "new", "zealand", "united", "kingdom", "states", "america",
  ]);
  const ROAD_SUFFIXES = new Set([
    "st", "rd", "dr", "ave", "blvd", "ct", "pl", "ln", "hwy",
    "pkwy", "sq", "cr", "cres", "tce", "terrace", "way", "close",
  ]);
  return (parts[0] ?? "")
    .split(/\s+/)
    .filter((w) => {
      if (w.length < 2) return false;
      if (AU_STATES_UNAMBIGUOUS.has(w.toUpperCase())) return false;
      if (COUNTRY_WORDS.has(w.toLowerCase())) return false;
      if (ROAD_SUFFIXES.has(w.toLowerCase())) return false;
      // Skip postcodes: 4-5 digits, UK district (e.g. N20), UK sector (e.g. 0UZ)
      if (/^\d{4,5}$/.test(w)) return false;
      if (/^[A-Z]{1,2}\d[\dA-Z]?$/i.test(w)) return false;
      if (/^\d[A-Z]{2}$/i.test(w)) return false;
      // Skip bare house numbers
      if (/^\d+[a-z]?$/i.test(w)) return false;
      return true;
    });
}

/**
 * Strip the location suffix from a combined "businessName + location" query
 * to recover just the business name portion. The frontend always concatenates
 * as `businessQuery + ' ' + locationQuery`, so the location is a suffix.
 */
function extractBusinessName(combinedQuery: string, location: string): string {
  if (!location) return combinedQuery.trim();
  const q = combinedQuery.trim();
  const loc = location.trim();
  if (q.endsWith(loc)) return q.slice(0, q.length - loc.length).trim();
  if (q.toLowerCase().endsWith(loc.toLowerCase())) return q.slice(0, q.length - loc.length).trim();
  return q;
}

/**
 * Score a DataForSEO Maps candidate against the searched business + location.
 * Higher is better. Key rule: wrong-country candidates receive -100, which
 * drops them below `MATCH_THRESHOLD` regardless of name quality.
 */
function calculateBusinessMatchScore(
  item: Record<string, unknown>,
  businessQuery: string,
  locationQuery: string,
  ctx: LocationContext,
  log?: Logger,
): number {
  let score = 0;
  const reasons: string[] = [];

  const title = typeof item["title"] === "string" ? (item["title"] as string) : "";
  const address = dfsAddress(item);
  const upperAddr = address.toUpperCase();

  // ---- Name scoring ----
  const normTitle = normalizeName(title);
  const normQuery = normalizeName(businessQuery);
  const titleTokens = new Set(distinctiveTokens(title));
  const queryTokens = distinctiveTokens(businessQuery);

  if (queryTokens.length > 0) {
    const matchCount = queryTokens.filter((t) => titleTokens.has(t)).length;
    const matchRatio = matchCount / queryTokens.length;
    if (normTitle === normQuery || normTitle.startsWith(normQuery + " ")) {
      score += 50; reasons.push("exact name +50");
    } else if (normQuery.length > 2 && normTitle.includes(normQuery)) {
      score += 40; reasons.push("title contains query +40");
    } else if (normTitle.length > 3 && normQuery.includes(normTitle)) {
      score += 30; reasons.push("query contains title +30");
    } else if (matchRatio >= 0.6) {
      score += 25; reasons.push(`name tokens ${Math.round(matchRatio * 100)}% +25`);
    } else if (matchRatio > 0) {
      score += 15; reasons.push(`partial name +15`);
    } else {
      score -= 30; reasons.push("no name match -30");
    }
  }

  // ---- Country scoring ----
  const addrInfo = item["address_info"];
  let resultCC = "";
  if (addrInfo && typeof addrInfo === "object") {
    const cc = (addrInfo as Record<string, unknown>)["country_code"];
    if (typeof cc === "string") resultCC = cc.toUpperCase();
  }

  const expectedCC = ctx.countryCode;
  const countryInAddr =
    upperAddr.includes(ctx.countryName.toUpperCase()) ||
    (expectedCC === "GB" && /UNITED KINGDOM|ENGLAND|SCOTLAND|WALES/i.test(address)) ||
    (expectedCC === "AU" && upperAddr.includes("AUSTRALIA")) ||
    (expectedCC === "NZ" && upperAddr.includes("NEW ZEALAND")) ||
    (expectedCC === "US" && /UNITED STATES|USA/i.test(address));

  if (resultCC === expectedCC || countryInAddr) {
    score += 40; reasons.push(`country match ${expectedCC} +40`);
  } else if (resultCC !== "" && resultCC !== expectedCC) {
    score -= 100; reasons.push(`wrong country: got ${resultCC}, want ${expectedCC} -100`);
  } else if (!resultCC && !address) {
    reasons.push("no address info (neutral)");
  } else {
    score -= 30; reasons.push("country not confirmed -30");
  }

  // ---- Postcode scoring ----
  const postcodes = extractPostcodes(locationQuery);
  for (const pc of postcodes) {
    if (upperAddr.includes(pc)) {
      score += 50; reasons.push(`postcode exact "${pc}" +50`); break;
    }
    const prefix = pc.split(/\s/)[0] ?? "";
    if (prefix.length >= 2 && upperAddr.includes(prefix)) {
      score += 20; reasons.push(`postcode prefix "${prefix}" +20`); break;
    }
  }

  // ---- Street scoring ----
  const street = extractStreetName(locationQuery);
  if (street.length > 2 && upperAddr.includes(street.toUpperCase())) {
    score += 30; reasons.push(`street match "${street}" +30`);
  }

  // ---- City/suburb scoring ----
  const cities = extractCityTokens(locationQuery);
  let cityHit = false;
  for (const city of cities) {
    if (city.length > 1 && upperAddr.includes(city.toUpperCase())) {
      score += 25; reasons.push(`city match "${city}" +25`); cityHit = true; break;
    }
  }
  if (cities.length > 0 && !cityHit && postcodes.length === 0) {
    score -= 20; reasons.push("location city not in address -20");
  }

  log?.debug(
    { candidate: title, candidateAddress: address, countryCode: resultCC || "(none)", score, reasons },
    "candidate scored",
  );
  return score;
}

/**
 * Try progressively simpler fallback queries when the primary search returns
 * no candidate above the match threshold. Tries: postcode-only, street+city,
 * city+country, then businessName+country.
 */
async function tryLocationFallbacks(
  originalQuery: string,
  location: string,
  ctx: LocationContext,
  creds: DataforseoCreds,
  log?: Logger,
): Promise<Record<string, unknown> | undefined> {
  const businessName = extractBusinessName(originalQuery, location);
  const postcodes = extractPostcodes(location);
  const cities = extractCityTokens(location);
  const street = extractStreetName(location);

  const candidates = [
    postcodes[0] ? `${businessName} ${postcodes[0]}` : null,
    street && cities[0] ? `${businessName} ${street} ${cities[0]}` : null,
    cities[0] ? `${businessName} ${cities[0]} ${ctx.countryName}` : null,
    `${businessName} ${ctx.countryName}`,
  ].filter((q): q is string => !!q && q.trim() !== originalQuery.trim());

  for (const fb of [...new Set(candidates)]) {
    if (!fb.trim()) continue;
    log?.info({ fallbackQuery: fb, locationName: ctx.locationName }, "trying location fallback");
    try {
      const items = await dataforseoLive(
        "/serp/google/maps/live/advanced",
        { keyword: fb, location_name: ctx.locationName, language_code: DFS_LANGUAGE, depth: 10 },
        creds,
        log,
        20000,
      );
      for (const item of items) {
        const title = typeof item["title"] === "string" ? (item["title"] as string) : "";
        if (!title.trim()) continue;
        const sc = calculateBusinessMatchScore(item, businessName, location, ctx, log);
        if (sc >= MATCH_THRESHOLD) {
          log?.info({ fallbackQuery: fb, accepted: title, score: sc }, "fallback match accepted");
          return item;
        }
      }
    } catch (err) {
      log?.warn({ err, fallbackQuery: fb }, "fallback query failed");
    }
  }
  return undefined;
}

/** Which platforms carry demo ratings for a category's fallback rows. */
function demoPlatformsFor(key: string): { yelp: boolean; tripadvisor: boolean } {
  if (key === "restaurant" || key === "cafe") return { yelp: true, tripadvisor: true };
  if (key === "hotel") return { yelp: false, tripadvisor: true };
  return { yelp: false, tripadvisor: false };
}

/** Suburb-aware demo business name templates per category ({s} → suburb). */
const DEMO_TEMPLATES: Record<string, string[]> = {
  real_estate: ["Ray White {s}", "Buxton {s}", "Harcourts {s}", "Barry Plant {s}"],
  cafe: ["{s} Coffee House", "Little {s} Espresso", "The {s} Roastery"],
  restaurant: ["{s} Pizza & Pasta", "{s} Thai Restaurant", "The {s} Hotel Bistro"],
  hotel: ["The {s} Grand Hotel", "{s} Boutique Inn", "{s} Serviced Apartments"],
  plumber: ["{s} Plumbing Co", "Rapid {s} Plumbing", "{s} Pipe & Drain"],
  electrician: ["{s} Electrical", "Bright Spark {s}", "{s} Power & Light"],
  builder: ["{s} Building Group", "{s} Constructions", "Premier {s} Builders"],
  beauty: ["{s} Beauty Bar", "The {s} Spa", "{s} Hair & Co"],
  dentist: ["{s} Dental Care", "Smile {s} Dental", "{s} Family Dentist"],
  medical: ["{s} Medical Centre", "{s} Family Clinic", "{s} Health Hub"],
  retail: ["{s} Marketplace", "The {s} Store", "{s} Trading Co"],
};

/**
 * Category-specific, suburb-aware demo peers used only when a real SerpApi
 * lookup returns too few results. Flagged `demo:true` so the UI labels them and
 * they are never presented as verified data. Always matches the searched
 * category — never the wrong industry.
 */
export function buildCategoryDemoNearby(
  category: BusinessCategory,
  suburb: string,
): NearbyBusiness[] {
  const place = suburb || "your area";
  const templates =
    DEMO_TEMPLATES[category.key] ??
    [`{s} ${category.rowLabel}`, `${category.rowLabel}s of {s}`, `Premier {s} ${category.rowLabel}`];
  const { yelp, tripadvisor } = demoPlatformsFor(category.key);

  return templates.slice(0, 3).map((tpl) => {
    const nm = tpl.replace(/\{s\}/g, place);
    const seed = category.key + "|" + nm;
    return {
      name: nm,
      category: `${category.rowLabel} · ${place}`,
      location: place,
      logo: makeFallbackLogo("demo row (no real business)"),
      imageUrl: "",
      google: demoRating(seed + "g", 60, 360),
      yelp: yelp ? demoRating(seed + "y", 20, 180) : null,
      tripadvisor: tripadvisor ? demoRating(seed + "t", 30, 320) : null,
      demo: true,
    };
  });
}

/**
 * Find real similar businesses: same category, same suburb. Runs a single
 * DataForSEO Google Maps search for "<category> near <suburb> <state>
 * Australia", excludes the searched business, and returns up to 3 peers with
 * their real Google rating. Yelp/TripAdvisor are left null here (per-peer
 * lookups would burn quota); the UI shows them as "not available" without
 * penalty. Falls back to category+suburb demo data when fewer than 3 real peers
 * are found.
 */
export async function fetchSimilarBusinesses(
  category: BusinessCategory,
  locality: Locality,
  excludeName: string,
  creds: DataforseoCreds,
  log?: Logger,
): Promise<NearbyBusiness[]> {
  const { suburb, state } = locality;
  if (!suburb) return [];

  const q = `${category.searchTerm} near ${suburb} ${state} Australia`
    .replace(/\s+/g, " ")
    .trim();

  const results: NearbyBusiness[] = [];
  const sites: string[] = [];
  try {
    const local = await dataforseoLive(
      "/serp/google/maps/live/advanced",
      { keyword: q, location_name: DFS_LOCATION, language_code: DFS_LANGUAGE },
      creds,
      log,
    );

    const exclTokens = new Set(distinctiveTokens(excludeName));
    const exclNeeded = Math.max(1, Math.ceil(exclTokens.size / 2));
    const seen = new Set<string>();

    for (const r of local) {
      if (results.length >= 3) break;
      const title = typeof r["title"] === "string" ? r["title"] : "";
      if (!title) continue;

      // Skip the searched business itself (strong distinctive-token overlap).
      const titleTokens = distinctiveTokens(title);
      const overlap = titleTokens.filter((t) => exclTokens.has(t)).length;
      if (exclTokens.size > 0 && overlap >= exclNeeded) continue;

      const key = normalizeName(title);
      if (seen.has(key)) continue;

      const addr = dfsAddress(r);
      // Australia sanity-check: when an address is present it must look
      // Australian (an AU state token or "Australia"); guards against a noisy
      // result leaking a non-AU listing. Missing address → keep (the query
      // already constrains to Australia).
      if (addr) {
        const upper = addr.toUpperCase();
        const isAU =
          upper.includes("AUSTRALIA") ||
          addr.split(/[\s,]+/).some((t) => AU_STATES.has(t.toUpperCase().replace(/\./g, "")));
        if (!isAU) continue;
      }
      seen.add(key);

      const rowSuburb = extractLocality(addr).suburb || suburb;
      const rowThumb =
        typeof r["main_image"] === "string" ? r["main_image"] : "";

      results.push({
        name: title,
        category: `${category.rowLabel} · ${rowSuburb}`,
        location: rowSuburb,
        logo: makeFallbackLogo("logo not yet resolved"),
        imageUrl: rowThumb,
        google: dfsRating(r),
        yelp: null,
        tripadvisor: null,
        demo: false,
      });
      sites.push(dfsWebsite(r));
    }
  } catch (err) {
    log?.warn({ err }, "Similar-business lookup failed; using demo fallback");
  }

  if (results.length < 3) return buildCategoryDemoNearby(category, suburb);

  // Best-effort brand logos for real peers, resolved concurrently from each
  // peer's own website (cached; misses simply leave the initials fallback).
  const logos = await Promise.all(
    sites.map((site) =>
      resolveWebsiteLogo(site, log).catch(
        (): ResolvedLogo => makeFallbackLogo("logo lookup failed"),
      ),
    ),
  );
  results.forEach((row, i) => {
    row.logo = logos[i] ?? row.logo;
    logLogoDecision(row.name, row.logo, log);
  });
  return results;
}

/**
 * Resolve a Yelp `place_id` for a business by searching Yelp and matching the
 * result whose title shares the most distinctive tokens with the name.
 * Returns null when no organic result shares at least one distinctive token.
 */
async function findYelpPlaceId(
  name: string,
  loc: string,
  nameTokens: string[],
  apiKey: string,
): Promise<string | null> {
  const yelpRes = await serpapiGet({
    engine: "yelp",
    find_desc: name,
    find_loc: loc,
    api_key: apiKey,
  });

  const organic = yelpRes["organic_results"];
  if (!Array.isArray(organic)) return null;

  // Require a confident match: at least half of the name's distinctive tokens
  // (rounded up, minimum 1) must appear in the candidate title. This keeps a
  // single shared generic token from attaching the wrong Yelp profile and
  // burning a yelp_reviews call.
  const wanted = new Set(nameTokens);
  const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
  let best: { placeId: string; score: number } | null = null;
  for (const raw of organic) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const ids = r["place_ids"];
    const placeId =
      Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : "";
    if (!title || !placeId) continue;

    let score = 0;
    for (const tok of distinctiveTokens(title)) {
      if (wanted.has(tok)) score++;
    }
    if (score >= needed && (!best || score > best.score)) {
      best = { placeId, score };
    }
  }

  return best ? best.placeId : null;
}

/**
 * Resolve a TripAdvisor rating via the DataForSEO TripAdvisor search endpoint,
 * matching the place whose title shares the most distinctive tokens with the
 * name. The search result carries the aggregate `rating` object (value +
 * votes_count) directly, so a single call suffices. Ties are broken by the
 * highest review count. Returns null when no confident match has a rating.
 */
async function findTripadvisorRating(
  name: string,
  address: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformRating | null> {
  const loc = deriveLocation(address);
  const q = loc ? `${name} ${loc}` : name;
  // TripAdvisor has NO live endpoint — only the async task flow. priority:2 uses
  // DataForSEO's fast queue so the aggregate rating returns in seconds.
  const places = await dataforseoTripadvisorSearch(
    {
      keyword: q,
      location_name: DFS_LOCATION,
      language_code: DFS_LANGUAGE,
      priority: 2,
    },
    creds,
    log,
  );

  const wanted = new Set(nameTokens);
  const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
  let best: { rating: PlatformRating; score: number } | null = null;
  for (const r of places) {
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const rating = dfsRating(r);
    if (!title || !rating) continue;

    let score = 0;
    for (const tok of distinctiveTokens(title)) {
      if (wanted.has(tok)) score++;
    }
    if (score < needed) continue;

    if (
      !best ||
      score > best.score ||
      (score === best.score && rating.reviews > best.rating.reviews)
    ) {
      best = { rating, score };
    }
  }

  return best ? best.rating : null;
}

/** Result of a single platform lookup: a rating (or null) + optional status note. */
interface PlatformLookup {
  rating: PlatformRating | null;
  note?: string;
}

const NO_MATCH = "No match found";
const LOOKUP_UNAVAILABLE = "Lookup unavailable";

/** Yelp (SerpApi): resolve the listing by confident name match, then rating. */
async function resolveYelp(
  name: string,
  loc: string,
  nameTokens: string[],
  serpApiKey: string | null,
  log?: Logger,
): Promise<PlatformLookup> {
  if (!serpApiKey) return { rating: null, note: LOOKUP_UNAVAILABLE };
  if (!loc || nameTokens.length === 0) return { rating: null, note: NO_MATCH };
  try {
    const placeId = await findYelpPlaceId(name, loc, nameTokens, serpApiKey);
    if (!placeId) return { rating: null, note: NO_MATCH };
    const yelp = await fetchYelpRating(placeId, serpApiKey);
    return yelp ? { rating: yelp } : { rating: null, note: NO_MATCH };
  } catch (err) {
    log?.warn({ err }, "Yelp lookup failed; continuing without Yelp data");
    return { rating: null, note: LOOKUP_UNAVAILABLE };
  }
}

/** TripAdvisor (DataForSEO async search returns the aggregate rating directly). */
async function resolveTripadvisor(
  name: string,
  address: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformLookup> {
  if (nameTokens.length === 0) return { rating: null, note: NO_MATCH };
  try {
    const r = await findTripadvisorRating(name, address, nameTokens, creds, log);
    return r ? { rating: r } : { rating: null, note: NO_MATCH };
  } catch (err) {
    log?.warn({ err }, "TripAdvisor lookup failed; continuing without it");
    return { rating: null, note: LOOKUP_UNAVAILABLE };
  }
}

/** Trustpilot (DataForSEO async search returns the aggregate rating directly). */
async function resolveTrustpilot(
  name: string,
  address: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformLookup> {
  if (nameTokens.length === 0) return { rating: null, note: NO_MATCH };
  try {
    const r = await findTrustpilotRating(name, address, nameTokens, creds, log);
    return r ? { rating: r } : { rating: null, note: NO_MATCH };
  } catch (err) {
    log?.warn({ err }, "Trustpilot lookup failed; continuing without it");
    return { rating: null, note: LOOKUP_UNAVAILABLE };
  }
}

/** Product Review (best-effort: Google rich-snippet rating for productreview.com.au). */
async function resolveProductReview(
  name: string,
  suburb: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformLookup> {
  if (nameTokens.length === 0) return { rating: null, note: NO_MATCH };
  try {
    const r = await findProductReviewRating(name, suburb, nameTokens, creds, log);
    return r ? { rating: r } : { rating: null, note: NO_MATCH };
  } catch (err) {
    log?.warn({ err }, "Product Review lookup failed; continuing without it");
    return { rating: null, note: LOOKUP_UNAVAILABLE };
  }
}

/** Facebook (best-effort: Google rich-snippet page rating for facebook.com). */
async function resolveFacebook(
  name: string,
  suburb: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformLookup> {
  if (nameTokens.length === 0) return { rating: null, note: NO_MATCH };
  try {
    const r = await findFacebookRating(name, suburb, nameTokens, creds, log);
    return r ? { rating: r } : { rating: null, note: NO_MATCH };
  } catch (err) {
    log?.warn({ err }, "Facebook lookup failed; continuing without it");
    return { rating: null, note: LOOKUP_UNAVAILABLE };
  }
}

/**
 * Resolve a Trustpilot rating via the DataForSEO Trustpilot search endpoint,
 * mirroring TripAdvisor: match the item whose title shares the most distinctive
 * tokens with the name, ties broken by review count. Returns null when no
 * confident match has a rating.
 */
async function findTrustpilotRating(
  name: string,
  address: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformRating | null> {
  const loc = deriveLocation(address);
  const q = loc ? `${name} ${loc}` : name;
  const items = await dataforseoTrustpilotSearch(
    {
      keyword: q,
      location_name: DFS_LOCATION,
      language_code: DFS_LANGUAGE,
      priority: 2,
    },
    creds,
    log,
  );

  const wanted = new Set(nameTokens);
  const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
  let best: { rating: PlatformRating; score: number } | null = null;
  for (const r of items) {
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const rating = dfsRating(r);
    if (!title || !rating) continue;

    let score = 0;
    for (const tok of distinctiveTokens(title)) {
      if (wanted.has(tok)) score++;
    }
    if (score < needed) continue;

    if (
      !best ||
      score > best.score ||
      (score === best.score && rating.reviews > best.rating.reviews)
    ) {
      best = { rating, score };
    }
  }

  return best ? best.rating : null;
}

/** Hostname of a URL string, lowercased; "" when not a valid URL. */
function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Map a DataForSEO organic-SERP item's rich-snippet `rating` to a PlatformRating,
 * normalising to a 5-point scale when `rating_max` is present and not already 5
 * (e.g. some snippets report out of 10). Returns null when there is no numeric
 * rating value.
 */
function organicRating(item: Record<string, unknown>): PlatformRating | null {
  const r = item["rating"];
  if (!r || typeof r !== "object") return null;
  const ro = r as Record<string, unknown>;
  const value = ro["value"];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const max = ro["rating_max"];
  const scaled =
    typeof max === "number" && max > 0 && max !== 5 ? (value / max) * 5 : value;
  const rating = Math.round(scaled * 10) / 10;
  const votes = ro["votes_count"];
  return {
    rating,
    reviews: typeof votes === "number" && votes > 0 ? Math.round(votes) : 0,
  };
}

/**
 * From a Google organic SERP, pick the rich-snippet rating on the first result
 * whose URL is on `hostNeedle` (e.g. "facebook.com") AND whose title shares
 * enough distinctive tokens with the business name. Ties broken by review count.
 * Returns null when no confident, rated match exists.
 */
function matchOrganicRating(
  items: Record<string, unknown>[],
  hostNeedle: string,
  nameTokens: string[],
): PlatformRating | null {
  const wanted = new Set(nameTokens);
  const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
  let best: { rating: PlatformRating; score: number } | null = null;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const host = hostOf(item["url"]);
    // Exact domain or a subdomain of it — never a substring (so "notfacebook.com"
    // can't masquerade as "facebook.com").
    if (host !== hostNeedle && !host.endsWith("." + hostNeedle)) continue;
    const rating = organicRating(item);
    if (!rating) continue;
    const title = typeof item["title"] === "string" ? item["title"] : "";

    let score = 0;
    for (const tok of distinctiveTokens(title)) {
      if (wanted.has(tok)) score++;
    }
    if (score < needed) continue;

    if (
      !best ||
      score > best.score ||
      (score === best.score && rating.reviews > best.rating.reviews)
    ) {
      best = { rating, score };
    }
  }
  return best ? best.rating : null;
}

/**
 * Best-effort Product Review (productreview.com.au) rating: Product Review has no
 * public API, so we read the Google rich-snippet star rating from an organic SERP
 * scoped to their domain. Returns null when no confident match carries a rating.
 */
async function findProductReviewRating(
  name: string,
  suburb: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformRating | null> {
  const keyword = `${name} ${suburb} productreview.com.au`
    .replace(/\s+/g, " ")
    .trim();
  const items = await dataforseoLive(
    "/serp/google/organic/live/advanced",
    { keyword, location_name: DFS_LOCATION, language_code: DFS_LANGUAGE },
    creds,
    log,
  );
  return matchOrganicRating(items, "productreview.com.au", nameTokens);
}

/**
 * Best-effort Facebook page rating: Facebook has no public review API, so we read
 * the Google rich-snippet rating from an organic SERP scoped to facebook.com.
 * Returns null when no confident match carries a rating.
 */
async function findFacebookRating(
  name: string,
  suburb: string,
  nameTokens: string[],
  creds: DataforseoCreds,
  log?: Logger,
): Promise<PlatformRating | null> {
  const keyword = `${name} ${suburb} Facebook reviews`
    .replace(/\s+/g, " ")
    .trim();
  const items = await dataforseoLive(
    "/serp/google/organic/live/advanced",
    { keyword, location_name: DFS_LOCATION, language_code: DFS_LANGUAGE },
    creds,
    log,
  );
  return matchOrganicRating(items, "facebook.com", nameTokens);
}

/**
 * Derive a Yelp rating for a place_id from the first page of reviews:
 * average of the returned review stars, with the total review count taken
 * from `search_information.total_results`. Returns null when no rated reviews.
 */
async function fetchYelpRating(
  placeId: string,
  apiKey: string,
): Promise<PlatformRating | null> {
  const res = await serpapiGet({
    engine: "yelp_reviews",
    place_id: placeId,
    num: "49",
    api_key: apiKey,
  });

  const reviews = res["reviews"];
  if (!Array.isArray(reviews)) return null;

  const stars = reviews
    .map((r) =>
      r && typeof r === "object"
        ? (r as Record<string, unknown>)["rating"]
        : undefined,
    )
    .filter((v): v is number => typeof v === "number");

  if (stars.length === 0) return null;

  const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
  const rating = Math.round(avg * 10) / 10;

  const info = res["search_information"];
  let totalReviews = stars.length;
  if (info && typeof info === "object") {
    const total = (info as Record<string, unknown>)["total_results"];
    if (typeof total === "number" && total > 0) totalReviews = total;
  }

  return { rating, reviews: totalReviews };
}

/** A Google review topic chip: a customer theme + how many reviews mention it. */
export interface ReviewTag {
  tag: string;
  count: number;
}

/** Short review snippets per platform, for AI theme analysis (paraphrase only). */
export interface ReviewSnippets {
  google: string[];
  yelp: string[];
  tripadvisor: string[];
  trustpilot: string[];
  /** Google review topic chips (e.g. "auction — 34 mentions"); [] when none. */
  googleTopics: ReviewTag[];
}

/**
 * Words too generic to be a useful review "topic". Combines common English
 * stopwords with filler words that appear in nearly every review, so the chips
 * surface real themes ("auction", "coffee", "parking") rather than noise.
 */
const TOPIC_STOPWORDS = new Set([
  // articles / pronouns / conjunctions / prepositions
  "the", "and", "for", "was", "were", "with", "you", "your", "our", "their",
  "they", "them", "this", "that", "these", "those", "from", "have", "has",
  "had", "are", "but", "not", "all", "any", "can", "will", "would", "could",
  "should", "there", "here", "then", "than", "into", "out", "off", "over",
  "just", "very", "too", "also", "about", "after", "before", "when", "what",
  "which", "who", "why", "how", "been", "being", "did", "does", "done", "get",
  "got", "had", "her", "his", "him", "she", "its", "one", "two", "some", "such",
  "only", "more", "most", "much", "many", "other", "each", "own", "same", "few",
  // generic review filler that carries no theme
  "great", "good", "nice", "best", "amazing", "awesome", "excellent", "lovely",
  "friendly", "helpful", "happy", "highly", "recommend", "recommended",
  "definitely", "always", "again", "really", "well", "back", "went", "come",
  "came", "time", "times", "place", "service", "staff", "experience", "team",
  "everything", "thank", "thanks", "would", "made", "make", "need", "want",
  "took", "take", "give", "gave", "day", "days", "people", "everyone", "us",
]);

/**
 * Derive Google review topic chips from the raw review texts ourselves:
 * frequency-based (count = number of reviews that mention the word), stopword-
 * filtered, top 15 by mentions. Grounded in real text — returns [] when there
 * is not enough review text to be meaningful, and never invents a theme.
 */
function deriveReviewTopics(texts: string[]): ReviewTag[] {
  // Not enough signal to surface honest themes.
  if (texts.length < 3) return [];

  const docFreq = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set<string>();
    const words = text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !TOPIC_STOPWORDS.has(w));
    for (const w of words) {
      if (seen.has(w)) continue; // count each review once per word
      seen.add(w);
      docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
    }
  }

  const out: ReviewTag[] = [];
  for (const [tag, count] of docFreq) {
    // Require a theme to appear in at least 2 reviews to filter one-off noise.
    if (count >= 2) out.push({ tag: tag.slice(0, 60), count });
  }
  // Most-mentioned first so the report leads with the strongest themes.
  return out
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 15);
}

/** Read a DataForSEO review's free text across the fields the API may use. */
function dfsReviewText(raw: Record<string, unknown>): string {
  for (const key of ["review_text", "original_review_text", "snippet", "text"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Read a DataForSEO review's relative date ("2 months ago") when present. */
function dfsReviewDate(raw: Record<string, unknown>): string {
  const t = raw["time_ago"];
  if (typeof t === "string" && t.trim() && t.trim().length <= 40)
    return t.trim();
  return "";
}

/** Format DataForSEO review items into short, date-prefixed snippet strings. */
function collectDfsSnippets(
  items: Record<string, unknown>[],
  max: number,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    let text = dfsReviewText(item);
    if (!text) continue;
    if (text.length > 240) text = text.slice(0, 237) + "...";
    const date = dfsReviewDate(item);
    if (date) text = `[${date}] ${text}`;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Pull a review's free-text from the various shapes SerpApi engines return. */
function extractReviewText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  const candidates: unknown[] = [r["snippet"], r["text"], r["comment"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const t = (c as Record<string, unknown>)["text"];
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  return "";
}

function collectSnippets(reviews: unknown, max: number): string[] {
  if (!Array.isArray(reviews)) return [];
  const out: string[] = [];
  for (const rv of reviews) {
    let text = extractReviewText(rv);
    if (text) {
      if (text.length > 240) text = text.slice(0, 237) + "...";
      // Prefix the relative review date (e.g. "2 months ago") when present so
      // the AI can weigh recency without us inventing timestamps.
      if (rv && typeof rv === "object") {
        const d = (rv as Record<string, unknown>)["date"];
        if (typeof d === "string" && d.trim() && d.trim().length <= 40) {
          text = `[${d.trim()}] ${text}`;
        }
      }
      out.push(text);
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Best-effort collection of short public review snippets for the paid report's
 * AI theme analysis. Isolated from the public rating pipeline: every platform
 * lookup is wrapped so a failure just yields fewer snippets (never throws), and
 * the caller downgrades the report's data-quality score accordingly. Only run at
 * paid-report generation time (admin, rare), so the extra SerpApi calls are fine.
 */
export async function fetchReviewSnippets(
  data: BusinessReviews,
  creds: DataforseoCreds,
  serpApiKey: string | null,
  log?: Logger,
): Promise<ReviewSnippets> {
  const result: ReviewSnippets = {
    google: [],
    yelp: [],
    tripadvisor: [],
    trustpilot: [],
    googleTopics: [],
  };
  const name = data.name;
  const address = data.address;
  const nameTokens = distinctiveTokens(name);

  // ---- Google reviews (DataForSEO async task; topics derived from text) ----
  try {
    const items = await dataforseoReviews(
      {
        keyword: `${name} ${address}`.trim(),
        location_name: DFS_LOCATION,
        language_code: DFS_LANGUAGE,
        depth: 20,
        sort_by: "newest",
      },
      creds,
      log,
    );
    result.google = collectDfsSnippets(items, 12);
    const texts = items
      .map((it) => dfsReviewText(it))
      .filter((t): t is string => t.length > 0);
    result.googleTopics = deriveReviewTopics(texts);
  } catch (err) {
    log?.warn({ err }, "Google review snippet fetch failed");
  }

  // ---- Yelp reviews (SerpApi; resolve place_id by confident name match) ----
  if (serpApiKey) {
    try {
      const loc = deriveLocation(address);
      if (loc && nameTokens.length > 0) {
        const placeId = await findYelpPlaceId(name, loc, nameTokens, serpApiKey);
        if (placeId) {
          const rev = await serpapiGet({
            engine: "yelp_reviews",
            place_id: placeId,
            num: "49",
            api_key: serpApiKey,
          });
          result.yelp = collectSnippets(rev["reviews"], 12);
        }
      }
    } catch (err) {
      log?.warn({ err }, "Yelp review snippet fetch failed");
    }
  }

  // ---- Trustpilot reviews (DataForSEO async search -> domain -> reviews) ----
  if (nameTokens.length > 0) {
    try {
      const loc = deriveLocation(address);
      const q = loc ? `${name} ${loc}` : name;
      const found = await dataforseoTrustpilotSearch(
        {
          keyword: q,
          location_name: DFS_LOCATION,
          language_code: DFS_LANGUAGE,
          priority: 2,
        },
        creds,
        log,
      );
      const wanted = new Set(nameTokens);
      const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
      let domain = "";
      let bestScore = -1;
      for (const it of found) {
        const title = typeof it["title"] === "string" ? it["title"] : "";
        const d = typeof it["domain"] === "string" ? it["domain"] : "";
        if (!d) continue;
        let score = 0;
        for (const tok of distinctiveTokens(title)) {
          if (wanted.has(tok)) score++;
        }
        if (score >= needed && score > bestScore) {
          bestScore = score;
          domain = d;
        }
      }
      if (domain) {
        const items = await dataforseoTrustpilotReviews(
          {
            domain,
            location_name: DFS_LOCATION,
            language_code: DFS_LANGUAGE,
            depth: 20,
            priority: 2,
          },
          creds,
          log,
        );
        result.trustpilot = collectDfsSnippets(items, 12);
      }
    } catch (err) {
      log?.warn({ err }, "Trustpilot review snippet fetch failed");
    }
  }

  return result;
}
