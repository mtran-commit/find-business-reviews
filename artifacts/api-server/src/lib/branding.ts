import type { Logger } from "pino";
import { distinctiveTokens, normalizeName, serpapiGet } from "./serpapi";
import { dataforseoLive, type DataforseoCreds } from "./dataforseo";

/**
 * Public business-branding lookup.
 *
 * Discovers a business's official Facebook / Instagram profiles via a Google
 * organic search ("<name> <suburb> Facebook") through DataForSEO, then fetches
 * the public profile with SerpApi's `facebook_profile` / `instagram_profile`
 * engines and keeps the data ONLY when the profile confidently matches the
 * business (name tokens + phone / website / suburb corroboration). Low-
 * confidence matches are discarded — never show the wrong business's branding.
 *
 * All failures are non-fatal: the caller always gets a BusinessBranding
 * object (possibly empty) and report generation must never depend on this.
 */

export interface FacebookPresence {
  profileUrl: string;
  profileImage: string;
  coverImage: string;
  followers: string; // display string as reported by Facebook, e.g. "1.2K"
  likes: string;
  rating: number | null;
  reviews: number | null;
  category: string;
  verified: boolean;
}

export interface InstagramPresence {
  profileUrl: string;
  profileImage: string;
  followers: number | null;
  posts: number | null;
  verified: boolean;
}

export interface BusinessBranding {
  businessLogo: string;
  businessLogoSource: string; // audit: profile URL the logo came from
  businessImage: string;
  businessImageSource: string;
  facebook: FacebookPresence | null;
  instagram: InstagramPresence | null;
  brandingSource: string; // "facebook" | "instagram" | "google" | "none"
  confidenceScore: number; // 0..1 (best accepted profile)
}

export function emptyBranding(): BusinessBranding {
  return {
    businessLogo: "",
    businessLogoSource: "",
    businessImage: "",
    businessImageSource: "",
    facebook: null,
    instagram: null,
    brandingSource: "none",
    confidenceScore: 0,
  };
}

export interface BrandingInput {
  businessName: string;
  businessAddress?: string;
  suburb?: string;
  website?: string;
  phone?: string;
  /** Google Maps thumbnail already fetched by the reviews lookup. */
  googleThumbnail?: string;
}

// ---------------------------------------------------------------------------
// Cache (24h TTL) so repeated report opens / generations don't re-hit SerpApi.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: BusinessBranding }>();

function cacheKey(input: BrandingInput): string {
  // Include every disambiguator we get so two different businesses that share
  // a name+suburb can never reuse each other's cached branding.
  return [
    normalizeName(input.businessName),
    normalizeName(input.suburb ?? ""),
    domainOf(input.website ?? ""),
    digitsOf(input.phone ?? "").slice(-8),
    normalizeName(input.businessAddress ?? ""),
  ].join("|");
}

function getCached(key: string): BusinessBranding | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

// ---------------------------------------------------------------------------
// Discovery: find the profile slug via Google search results.
// ---------------------------------------------------------------------------

const FB_RESERVED = new Set([
  "pages", "people", "groups", "watch", "events", "marketplace", "public",
  "sharer", "share", "reel", "photo", "story", "stories", "login", "help",
  "profile.php", "hashtag", "search", "policies", "business", "gaming",
]);

const IG_RESERVED = new Set([
  "p", "reel", "reels", "explore", "stories", "tv", "accounts", "about",
  "direct", "developer", "directory", "legal",
]);

function extractSlug(
  link: string,
  host: "facebook" | "instagram",
): string | null {
  try {
    const u = new URL(link);
    const h = u.hostname.replace(/^(www|m|web)\./, "");
    if (h !== `${host}.com`) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    let slug = parts[0];
    // Facebook "/p/Name-1234567890/" style page URLs.
    if (host === "facebook" && slug === "p" && parts.length > 1) slug = parts[1];
    const reserved = host === "facebook" ? FB_RESERVED : IG_RESERVED;
    if (!slug || reserved.has(slug.toLowerCase())) return null;
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

/** Collect up to `max` unique candidate slugs from Google organic results. */
async function discoverSlugs(
  creds: DataforseoCreds,
  businessName: string,
  suburb: string,
  host: "facebook" | "instagram",
  log?: Logger,
  max = 3,
): Promise<string[]> {
  try {
    const platform = host === "facebook" ? "Facebook" : "Instagram";
    const items = await dataforseoLive(
      "/serp/google/organic/live/advanced",
      {
        keyword: `${businessName} ${suburb} ${platform}`.trim(),
        location_name: "Australia",
        language_code: "en",
      },
      creds,
      log,
    );
    const slugs: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      // Organic result URLs live on `url`; skip non-organic SERP items.
      const link = item["url"];
      if (typeof link !== "string") continue;
      const slug = extractSlug(link, host);
      if (!slug) continue;
      const lower = slug.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      slugs.push(slug);
      if (slugs.length >= max) break;
    }
    return slugs;
  } catch (err) {
    log?.warn({ err, host, businessName }, "branding: profile discovery failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Confidence matching
// ---------------------------------------------------------------------------

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

function phoneMatches(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (da.length < 6 || db.length < 6) return false;
  return da.slice(-8) === db.slice(-8);
}

function domainOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function websiteMatches(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const da = domainOf(a);
  const db = domainOf(b);
  return !!da && !!db && da === db;
}

/**
 * Score how confidently a public profile matches the business.
 * Accept only when the final score is >= 0.6:
 * - FULL name-token match alone is enough (0.6).
 * - PARTIAL name match (>=50% of tokens) scores 0.5 and therefore REQUIRES a
 *   corroborator: matching phone (+0.2), website domain (+0.2) or suburb in
 *   the profile text (+0.1).
 * - A single long distinctive token scores 0.4 and requires phone or website.
 * - No name overlap at all is a hard reject regardless of corroborators.
 */
function scoreMatch(
  input: BrandingInput,
  profileName: string,
  profileText: string, // bio / about / category / address text, lowercased ok
  profilePhone?: string,
  profileWebsite?: string,
): number {
  const wanted = distinctiveTokens(input.businessName);
  if (wanted.length === 0) return 0;
  const inProfile = new Set(distinctiveTokens(profileName));
  const matched = wanted.filter((t) => inProfile.has(t)).length;
  const frac = matched / wanted.length;
  // Social handles concatenate the name ("hopetountearooms"), so also treat a
  // profile word that IS (or starts with) the full concatenated business name
  // as a full match. Prefix-only — "layalatcrownmelbourne" must NOT match
  // "Crown Melbourne".
  const concatWanted = wanted.join("");
  const concatMatch =
    concatWanted.length >= 6 &&
    normalizeName(profileName)
      .split(" ")
      .some((w) => w === concatWanted || w.startsWith(concatWanted));
  let score = 0;
  if (frac === 1 || concatMatch) score += 0.6; // full name match
  else if (frac >= 0.5) score += 0.5; // partial — needs corroboration
  else if (wanted.some((t) => t.length >= 5 && inProfile.has(t)))
    score += 0.4; // one long distinctive token — needs strong corroboration
  else return 0; // name does not match — hard reject
  if (phoneMatches(input.phone, profilePhone)) score += 0.2;
  if (websiteMatches(input.website, profileWebsite)) score += 0.2;
  const suburb = normalizeName(input.suburb ?? "");
  if (suburb && normalizeName(profileText).includes(suburb)) score += 0.1;
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Profile fetchers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Facebook reports counts as display strings ("39M") or numbers. */
function countStr(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return v.toLocaleString("en-AU");
  if (typeof v === "string") return v.trim();
  return "";
}

async function fetchFacebook(
  apiKey: string,
  slug: string,
  input: BrandingInput,
  log?: Logger,
): Promise<{ presence: FacebookPresence; score: number } | null> {
  try {
    const json = await serpapiGet({
      engine: "facebook_profile",
      profile_id: slug,
      api_key: apiKey,
    });
    const p = json["profile_results"];
    if (!p || typeof p !== "object") return null;
    const prof = p as Record<string, unknown>;
    const name = str(prof["name"]);
    if (!name) return null;
    const about = [
      str(prof["category"]),
      str(prof["about"]),
      str(prof["address"]),
      str(prof["intro"]),
    ].join(" ");
    const score = scoreMatch(
      input,
      name,
      about,
      str(prof["phone"]),
      str(prof["website"]) || str(prof["email"]),
    );
    if (score < 0.6) {
      log?.info({ slug, name, score }, "branding: facebook match rejected");
      return null;
    }
    const presence: FacebookPresence = {
      profileUrl: str(prof["url"]) || `https://www.facebook.com/${slug}`,
      profileImage: str(prof["profile_picture"]),
      coverImage: str(prof["cover_photo"]),
      followers: countStr(prof["followers"]),
      likes: countStr(prof["likes"]),
      rating: num(prof["rating"]),
      reviews: num(prof["reviews"]) ?? num(prof["reviews_count"]),
      category: str(prof["category"]),
      verified: prof["verified"] === true,
    };
    return { presence, score };
  } catch (err) {
    log?.warn({ err, slug }, "branding: facebook profile fetch failed");
    return null;
  }
}

async function fetchInstagram(
  apiKey: string,
  slug: string,
  input: BrandingInput,
  log?: Logger,
): Promise<{ presence: InstagramPresence; score: number } | null> {
  try {
    const json = await serpapiGet({
      engine: "instagram_profile",
      profile_id: slug,
      api_key: apiKey,
    });
    const p = json["profile_results"];
    if (!p || typeof p !== "object") return null;
    const prof = p as Record<string, unknown>;
    if (prof["is_private"] === true) return null; // public profiles only
    const fullName = str(prof["full_name"]);
    const username = str(prof["username"]) || slug;
    const name = fullName || username;
    const score = scoreMatch(
      input,
      `${fullName} ${username.replace(/[._]/g, " ")}`,
      str(prof["biography"]),
      undefined,
      str(prof["external_url"]),
    );
    if (score < 0.6) {
      log?.info({ slug, name, score }, "branding: instagram match rejected");
      return null;
    }
    const presence: InstagramPresence = {
      profileUrl: `https://www.instagram.com/${username}`,
      profileImage:
        str(prof["serpapi_profile_pic_url_hd"]) ||
        str(prof["serpapi_profile_pic_url"]) ||
        str(prof["profile_pic_url_hd"]) ||
        str(prof["profile_pic_url"]),
      followers: num(prof["followers"]),
      posts: num(prof["posts_count"]),
      verified: prof["is_verified"] === true,
    };
    return { presence, score };
  } catch (err) {
    log?.warn({ err, slug }, "branding: instagram profile fetch failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function fetchBusinessBranding(
  input: BrandingInput,
  serpApiKey: string | null,
  creds: DataforseoCreds,
  log?: Logger,
): Promise<BusinessBranding> {
  const key = cacheKey(input);
  const cached = getCached(key);
  if (cached) return cached;

  const result = emptyBranding();
  try {
    // Social branding needs BOTH providers: DataForSEO to discover the profile
    // slug and SerpApi to read the profile. Without a SerpApi key we can still
    // return the Google business photo below, so skip the social fetch cleanly.
    const suburb = input.suburb ?? "";
    const [fbSlugs, igSlugs] = serpApiKey
      ? await Promise.all([
          discoverSlugs(creds, input.businessName, suburb, "facebook", log),
          discoverSlugs(creds, input.businessName, suburb, "instagram", log),
        ])
      : [[], []];

    // Try candidates in order, stopping at the first confident match.
    // Capped at 2 profile fetches per platform to protect SerpApi quota.
    const tryCandidates = async <T>(
      slugs: string[],
      fetcher: (slug: string) => Promise<T | null>,
    ): Promise<T | null> => {
      for (const slug of slugs.slice(0, 2)) {
        const hit = await fetcher(slug);
        if (hit) return hit;
      }
      return null;
    };

    const [fb, ig] = serpApiKey
      ? await Promise.all([
          tryCandidates(fbSlugs, (slug) =>
            fetchFacebook(serpApiKey, slug, input, log),
          ),
          tryCandidates(igSlugs, (slug) =>
            fetchInstagram(serpApiKey, slug, input, log),
          ),
        ])
      : [null, null];

    if (fb) {
      result.facebook = fb.presence;
      result.confidenceScore = Math.max(result.confidenceScore, fb.score);
    }
    if (ig) {
      result.instagram = ig.presence;
      result.confidenceScore = Math.max(result.confidenceScore, ig.score);
    }

    // Brand-asset priority: Facebook profile image > Instagram profile image.
    if (result.facebook?.profileImage) {
      result.businessLogo = result.facebook.profileImage;
      result.businessLogoSource = result.facebook.profileUrl;
      result.brandingSource = "facebook";
    } else if (result.instagram?.profileImage) {
      result.businessLogo = result.instagram.profileImage;
      result.businessLogoSource = result.instagram.profileUrl;
      result.brandingSource = "instagram";
    }

    // Business photo: Google thumbnail first, then Facebook cover photo.
    if (input.googleThumbnail) {
      result.businessImage = input.googleThumbnail;
      result.businessImageSource = "google_maps";
      if (result.brandingSource === "none") result.brandingSource = "google";
    } else if (result.facebook?.coverImage) {
      result.businessImage = result.facebook.coverImage;
      result.businessImageSource = result.facebook.profileUrl;
    }

    if (!result.businessLogo && !result.facebook && !result.instagram) {
      log?.info(
        { businessName: input.businessName, fbSlugs, igSlugs },
        "branding: no confident social branding found",
      );
    }
  } catch (err) {
    log?.warn({ err, businessName: input.businessName }, "branding: fetch failed");
  }

  cache.set(key, { at: Date.now(), value: result });
  return result;
}
