import type { Logger } from "pino";

/**
 * SerpApi-backed reviews lookup.
 *
 * SerpApi exposes separate "engines" per source. We use:
 *   - google_maps : real Google rating + review count (+ profile data)
 *   - yelp        : real Yelp rating + review count
 *
 * SerpApi has no TripAdvisor or Facebook engine, and Facebook no longer
 * exposes public ratings, so those two are always returned as null and
 * listed in `unavailable`.
 *
 * Docs: https://serpapi.com/google-maps-api , https://serpapi.com/yelp-api
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
  source: "serpapi";
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

  // ---- Yelp (best effort; depends on a usable location) ----
  let yelp: PlatformRating | null = null;
  const loc = deriveLocation(address);
  if (loc) {
    try {
      const yelpRes = await serpapiGet({
        engine: "yelp",
        find_desc: name,
        find_loc: loc,
        api_key: apiKey,
      });
      const organic = yelpRes["organic_results"];
      if (Array.isArray(organic)) {
        const match = organic.find(
          (r) => toRating(r as Record<string, unknown>) !== null,
        );
        if (match) yelp = toRating(match as Record<string, unknown>);
      }
    } catch (err) {
      log?.warn({ err }, "Yelp lookup failed; continuing without Yelp data");
    }
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
    source: "serpapi",
  };
}
