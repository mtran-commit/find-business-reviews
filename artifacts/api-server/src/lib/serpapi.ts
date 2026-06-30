import type { Logger } from "pino";

/**
 * SerpApi-backed reviews lookup.
 *
 * SerpApi exposes separate "engines" per source. We use:
 *   - google_maps  : real Google rating + review count (+ profile data)
 *   - yelp         : Yelp business search (to resolve a place_id by name)
 *   - yelp_reviews : Yelp reviews for that place_id
 *   - tripadvisor  : TripAdvisor place search (returns aggregate rating + count)
 *
 * The Yelp business-search engine no longer exposes an aggregate rating, so
 * we resolve the matching Yelp listing by name, then derive the rating from
 * the first page of yelp_reviews (average of returned review stars) and use
 * `search_information.total_results` as the total review count. This is an
 * approximation of the live Yelp aggregate, accurate for businesses with few
 * reviews and a close estimate for high-volume ones.
 *
 * The TripAdvisor search engine returns the aggregate rating + review count
 * directly on each place result, so a single call (matched by name) suffices.
 *
 * Facebook has no usable SerpApi rating source, so it is always returned as
 * null with a "Not available yet" note. Review Pay is an internal platform
 * with no public API yet, so it is returned as deterministic demo data
 * (flagged in `demo`) and excluded from real-data metrics/analysis.
 *
 * Docs: https://serpapi.com/google-maps-api , https://serpapi.com/yelp-api ,
 *       https://serpapi.com/yelp-reviews-api , https://serpapi.com/tripadvisor
 */

const SERPAPI_BASE = "https://serpapi.com/search.json";

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

/** A nearby business for the comparison rows. `demo` flags fallback data. */
export interface NearbyBusiness {
  name: string;
  category: string;
  location: string;
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

export interface BusinessReviews {
  name: string;
  address: string;
  logoText: string;
  logoUrl: string;
  /** Colour business photo when available (Google Maps thumbnail). */
  imageUrl: string;
  website: string;
  phone: string;
  directionsUrl: string;
  google: PlatformRating | null;
  tripadvisor: PlatformRating | null;
  yelp: PlatformRating | null;
  facebook: PlatformRating | null;
  /** Internal platform; demo placeholder data until a real API exists. */
  reviewpay: PlatformRating | null;
  /** Public offer (demo data for now; flagged via `offer.demo`). */
  offer: Offer;
  /** Detected industry/category of this business. */
  category: BusinessCategory;
  /** Suburb/state of this business (drives the "near <suburb>" title). */
  locality: Locality;
  /** Similar nearby businesses: same category + suburb. `demo` flags fallbacks. */
  nearby: NearbyBusiness[];
  unavailable: string[];
  /** Platform keys whose data is demo/placeholder (excluded from metrics). */
  demo: string[];
  /** Per-platform status note shown when a platform has no rating. */
  notes: Record<string, string>;
  source: "serpapi";
}

/** Tokens too generic to use for matching a business name to a Yelp listing. */
const MATCH_STOPWORDS = new Set([
  "the", "and", "of", "a", "an", "coffee", "cafe", "caffe", "restaurant",
  "company", "co", "inc", "llc", "ltd", "bar", "grill", "kitchen", "shop",
  "store", "house", "food", "foods",
]);

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctiveTokens(s: string): string[] {
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

/** Derive a Yelp `find_loc` (city/region) from a Google-style address. */
function deriveLocation(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  // Drop the street line; the remainder is usually "City State Zip".
  if (parts.length >= 2) return parts.slice(1).join(", ");
  return address;
}

async function serpapiGet(
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

function toRating(raw: unknown): PlatformRating | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rating = obj["rating"];
  if (typeof rating !== "number") return null;
  const reviews = obj["reviews"];
  return {
    rating,
    reviews: typeof reviews === "number" ? reviews : 0,
  };
}

/**
 * Look up a business by free-text query and return its ratings across the
 * supported platforms. Returns `null` when no business matches the query.
 */
export async function fetchBusinessReviews(
  query: string,
  apiKey: string,
  log?: Logger,
): Promise<BusinessReviews | null> {
  // ---- Google Maps (primary source for profile + Google rating) ----
  const maps = await serpapiGet({
    engine: "google_maps",
    type: "search",
    q: query,
    api_key: apiKey,
  });

  const placeResults = maps["place_results"];
  const localResults = maps["local_results"];
  const place: Record<string, unknown> | undefined =
    placeResults && typeof placeResults === "object"
      ? (placeResults as Record<string, unknown>)
      : Array.isArray(localResults) && localResults.length > 0
        ? (localResults[0] as Record<string, unknown>)
        : undefined;

  if (!place) return null;

  const name = typeof place["title"] === "string" ? place["title"] : query;
  const address = typeof place["address"] === "string" ? place["address"] : "";
  const phone = typeof place["phone"] === "string" ? place["phone"] : "";
  const website = typeof place["website"] === "string" ? place["website"] : "";
  const logoUrl =
    typeof place["thumbnail"] === "string" ? place["thumbnail"] : "";
  const imageUrl = logoUrl;

  const google = toRating(place);

  // Category hints from the Google Maps profile. SerpApi may return `type` as
  // either a string or an array (e.g. ["Italian restaurant","Bar"]); `types`
  // / `category` may also be present, so gather whichever exist.
  const placeTypes: string[] = [];
  for (const field of ["type", "types", "category"]) {
    const v = place[field];
    if (typeof v === "string") placeTypes.push(v);
    else if (Array.isArray(v)) {
      for (const t of v) if (typeof t === "string") placeTypes.push(t);
    }
  }

  const coords = place["gps_coordinates"];
  let directionsUrl: string;
  if (
    coords &&
    typeof coords === "object" &&
    typeof (coords as Record<string, unknown>)["latitude"] === "number"
  ) {
    const c = coords as { latitude: number; longitude: number };
    directionsUrl = `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`;
  } else {
    directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${name} ${address}`.trim(),
    )}`;
  }

  const notes: Record<string, string> = {};

  // ---- Yelp: resolve the listing by name, then derive rating from reviews ----
  // Step 1 (yelp search) only resolves a place_id; step 2 (yelp_reviews) is
  // only called when a confident name match is found, so we never burn quota
  // on a non-matching business.
  let yelp: PlatformRating | null = null;
  const loc = deriveLocation(address);
  const nameTokens = distinctiveTokens(name);
  if (loc && nameTokens.length > 0) {
    try {
      const placeId = await findYelpPlaceId(name, loc, nameTokens, apiKey);
      if (!placeId) {
        notes["yelp"] = "No match found";
      } else {
        yelp = await fetchYelpRating(placeId, apiKey);
        if (!yelp) notes["yelp"] = "No match found";
      }
    } catch (err) {
      log?.warn({ err }, "Yelp lookup failed; continuing without Yelp data");
      notes["yelp"] = "Lookup unavailable";
    }
  } else {
    notes["yelp"] = "No match found";
  }

  // ---- TripAdvisor: search returns the aggregate rating directly ----
  let tripadvisor: PlatformRating | null = null;
  if (nameTokens.length > 0) {
    try {
      tripadvisor = await findTripadvisorRating(name, address, nameTokens, apiKey);
      if (!tripadvisor) notes["tripadvisor"] = "No match found";
    } catch (err) {
      log?.warn({ err }, "TripAdvisor lookup failed; continuing without it");
      notes["tripadvisor"] = "Lookup unavailable";
    }
  } else {
    notes["tripadvisor"] = "No match found";
  }

  // ---- Facebook: no usable public rating source ----
  notes["facebook"] = "Not available yet";

  // ---- Review Pay: internal platform, demo data until a real API exists ----
  const reviewpay = demoReviewPay(name);

  const unavailable: string[] = [];
  if (!google) unavailable.push("google");
  if (!yelp) unavailable.push("yelp");
  if (!tripadvisor) unavailable.push("tripadvisor");
  unavailable.push("facebook");

  // ---- Similar businesses: same category + suburb (real lookup, demo fallback) ----
  const category = detectBusinessCategory(name, query, placeTypes);
  const locality = extractLocality(address, query);
  const nearby = await fetchSimilarBusinesses(category, locality, name, apiKey, log);

  return {
    name,
    address,
    logoText: initials(name),
    logoUrl,
    imageUrl,
    website,
    phone,
    directionsUrl,
    google,
    tripadvisor,
    yelp,
    facebook: null,
    reviewpay,
    offer: buildDemoOffer(name, website),
    category,
    locality,
    nearby,
    unavailable,
    demo: ["reviewpay"],
    notes,
    source: "serpapi",
  };
}

/** Small, stable string hash so demo data stays constant per business name. */
export function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Deterministic demo rating for the internal "Review Pay" platform so the card
 * stays stable per business. Clearly flagged as demo via `demo` and excluded
 * from real-data metrics and AI analysis on the client.
 */
export function demoReviewPay(name: string): PlatformRating {
  const hash = hashString(name);
  const rating = Math.round((4.1 + (hash % 9) / 10) * 10) / 10; // 4.1–4.9
  const reviews = 80 + (hash % 420); // 80–499
  return { rating, reviews };
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
      google: demoRating(seed + "g", 60, 360),
      yelp: yelp ? demoRating(seed + "y", 20, 180) : null,
      tripadvisor: tripadvisor ? demoRating(seed + "t", 30, 320) : null,
      demo: true,
    };
  });
}

/**
 * Find real similar businesses: same category, same suburb. Runs a single
 * `google_maps` search for "<category> near <suburb> <state> Australia",
 * excludes the searched business, and returns up to 3 peers with their real
 * Google rating. Yelp/TripAdvisor are left null here (per-peer lookups would
 * burn quota); the UI shows them as "not available" without penalty. Falls back
 * to category+suburb demo data when fewer than 3 real peers are found.
 */
export async function fetchSimilarBusinesses(
  category: BusinessCategory,
  locality: Locality,
  excludeName: string,
  apiKey: string,
  log?: Logger,
): Promise<NearbyBusiness[]> {
  const { suburb, state } = locality;
  if (!suburb) return [];

  const q = `${category.searchTerm} near ${suburb} ${state} Australia`
    .replace(/\s+/g, " ")
    .trim();

  const results: NearbyBusiness[] = [];
  try {
    const maps = await serpapiGet({
      engine: "google_maps",
      type: "search",
      q,
      api_key: apiKey,
    });

    const local = maps["local_results"];
    if (Array.isArray(local)) {
      const exclTokens = new Set(distinctiveTokens(excludeName));
      const exclNeeded = Math.max(1, Math.ceil(exclTokens.size / 2));
      const seen = new Set<string>();

      for (const raw of local) {
        if (results.length >= 3) break;
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const title = typeof r["title"] === "string" ? r["title"] : "";
        if (!title) continue;

        // Skip the searched business itself (strong distinctive-token overlap).
        const titleTokens = distinctiveTokens(title);
        const overlap = titleTokens.filter((t) => exclTokens.has(t)).length;
        if (exclTokens.size > 0 && overlap >= exclNeeded) continue;

        const key = normalizeName(title);
        if (seen.has(key)) continue;

        const addr = typeof r["address"] === "string" ? r["address"] : "";
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

        results.push({
          name: title,
          category: `${category.rowLabel} · ${rowSuburb}`,
          location: rowSuburb,
          google: toRating(r),
          yelp: null,
          tripadvisor: null,
          demo: false,
        });
      }
    }
  } catch (err) {
    log?.warn({ err }, "Similar-business lookup failed; using demo fallback");
  }

  if (results.length < 3) return buildCategoryDemoNearby(category, suburb);
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
 * Resolve a TripAdvisor rating by searching the `tripadvisor` engine and
 * matching the place whose title shares the most distinctive tokens with the
 * name. Unlike Yelp, the search result carries the aggregate `rating` and
 * `reviews` count directly, so a single call suffices. Ties are broken by the
 * highest review count. Returns null when no confident match has a rating.
 */
async function findTripadvisorRating(
  name: string,
  address: string,
  nameTokens: string[],
  apiKey: string,
): Promise<PlatformRating | null> {
  const loc = deriveLocation(address);
  const q = loc ? `${name} ${loc}` : name;
  const res = await serpapiGet({
    engine: "tripadvisor",
    q,
    api_key: apiKey,
  });

  const places = res["places"];
  if (!Array.isArray(places)) return null;

  const wanted = new Set(nameTokens);
  const needed = Math.max(1, Math.ceil(nameTokens.length / 2));
  let best: { rating: PlatformRating; score: number } | null = null;
  for (const raw of places) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = typeof r["title"] === "string" ? r["title"] : "";
    const rating = typeof r["rating"] === "number" ? r["rating"] : null;
    if (!title || rating === null) continue;

    let score = 0;
    for (const tok of distinctiveTokens(title)) {
      if (wanted.has(tok)) score++;
    }
    if (score < needed) continue;

    const reviews = typeof r["reviews"] === "number" ? r["reviews"] : 0;
    const candidate: PlatformRating = { rating, reviews };
    if (
      !best ||
      score > best.score ||
      (score === best.score && reviews > best.rating.reviews)
    ) {
      best = { rating: candidate, score };
    }
  }

  return best ? best.rating : null;
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
