import type { Logger } from "pino";

/**
 * SerpApi-backed reviews lookup.
 *
 * SerpApi exposes separate "engines" per source. We use:
 *   - google_maps  : real Google rating + review count (+ profile data)
 *   - yelp         : Yelp business search (to resolve a place_id by name)
 *   - yelp_reviews : Yelp reviews for that place_id
 *
 * The Yelp business-search engine no longer exposes an aggregate rating, so
 * we resolve the matching Yelp listing by name, then derive the rating from
 * the first page of yelp_reviews (average of returned review stars) and use
 * `search_information.total_results` as the total review count. This is an
 * approximation of the live Yelp aggregate, accurate for businesses with few
 * reviews and a close estimate for high-volume ones.
 *
 * SerpApi has no TripAdvisor or Facebook engine, and Facebook no longer
 * exposes public ratings, so those two are always returned as null and
 * listed in `unavailable` with a "Not available yet" note.
 *
 * Docs: https://serpapi.com/google-maps-api , https://serpapi.com/yelp-api ,
 *       https://serpapi.com/yelp-reviews-api
 */

const SERPAPI_BASE = "https://serpapi.com/search.json";

export interface PlatformRating {
  rating: number;
  reviews: number;
}

export interface BusinessReviews {
  name: string;
  address: string;
  logoText: string;
  logoUrl: string;
  website: string;
  phone: string;
  directionsUrl: string;
  google: PlatformRating | null;
  tripadvisor: PlatformRating | null;
  yelp: PlatformRating | null;
  facebook: PlatformRating | null;
  unavailable: string[];
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

  const google = toRating(place);

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

  const notes: Record<string, string> = {
    tripadvisor: "Not available yet",
    facebook: "Not available yet",
  };

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
        notes["yelp"] = "No Yelp match found";
      } else {
        yelp = await fetchYelpRating(placeId, apiKey);
        if (!yelp) notes["yelp"] = "No Yelp reviews yet";
      }
    } catch (err) {
      log?.warn({ err }, "Yelp lookup failed; continuing without Yelp data");
      notes["yelp"] = "Yelp lookup unavailable";
    }
  } else {
    notes["yelp"] = "No Yelp match found";
  }

  const unavailable: string[] = [];
  if (!google) unavailable.push("google");
  if (!yelp) unavailable.push("yelp");
  unavailable.push("tripadvisor", "facebook");

  return {
    name,
    address,
    logoText: initials(name),
    logoUrl,
    website,
    phone,
    directionsUrl,
    google,
    tripadvisor: null,
    yelp,
    facebook: null,
    unavailable,
    notes,
    source: "serpapi",
  };
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
