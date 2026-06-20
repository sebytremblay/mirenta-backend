// Brand tokens (D48). The page wears the prospect's own brand. The Research
// Agent extracts the prospect tokens into research.brand; the Website Builder
// resolves each token with the precedence prospect brand > seller brand > house
// default, then maps them onto a per-lead :root custom-property block.
//
// This module holds only the pure token logic so it stays unit-testable without
// loading runtime config (the builder imports the API client and env, which a
// hermetic test should not require).

import type { ProspectBrand } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
// Neutral house fallback when neither the prospect brand, the seller brand, nor
// the vertical supplies a primary color. Callers pass the active vertical's
// defaultAccentColor as fallbackColor, so the registry owns the per-vertical
// default and this constant only backstops a misconfigured vertical.
const HOUSE_NEUTRAL = "#1a1a2e";
const SYSTEM_FONT =
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

// Internal allow-list for Google Fonts. Each entry carries the proper-cased
// display name and the CSS2 family= query spec (spaces encoded as +, weight
// axis appended). Only fonts in this list produce a stylesheet href; raw user
// input never enters a URL.
interface FontEntry {
  displayName: string;
  spec: string;
}

const GOOGLE_FONT_ALLOW_LIST: Record<string, FontEntry> = {
  "oswald":            { displayName: "Oswald",          spec: "Oswald:wght@600;700" },
  "montserrat":        { displayName: "Montserrat",       spec: "Montserrat:wght@600;700" },
  "poppins":           { displayName: "Poppins",          spec: "Poppins:wght@600;700" },
  "roboto":            { displayName: "Roboto",           spec: "Roboto:wght@400;700" },
  "roboto condensed":  { displayName: "Roboto Condensed", spec: "Roboto+Condensed:wght@600;700" },
  "inter":             { displayName: "Inter",            spec: "Inter:wght@600;700" },
  "lato":              { displayName: "Lato",             spec: "Lato:wght@700" },
  "open sans":         { displayName: "Open Sans",        spec: "Open+Sans:wght@600;700" },
  "raleway":           { displayName: "Raleway",          spec: "Raleway:wght@600;700" },
  "playfair display":  { displayName: "Playfair Display", spec: "Playfair+Display:wght@600;700" },
  "bebas neue":        { displayName: "Bebas Neue",       spec: "Bebas+Neue" },
  "anton":             { displayName: "Anton",            spec: "Anton" },
  "teko":              { displayName: "Teko",             spec: "Teko:wght@600;700" },
  "rubik":             { displayName: "Rubik",            spec: "Rubik:wght@600;700" },
  "archivo":           { displayName: "Archivo",          spec: "Archivo:wght@600;700" },
  "barlow":            { displayName: "Barlow",           spec: "Barlow:wght@600;700" },
  "work sans":         { displayName: "Work Sans",        spec: "Work+Sans:wght@600;700" },
  "source sans 3":     { displayName: "Source Sans 3",    spec: "Source+Sans+3:wght@600;700" },
  "nunito":            { displayName: "Nunito",           spec: "Nunito:wght@700" },
  "merriweather":      { displayName: "Merriweather",     spec: "Merriweather:wght@700" },
};

// Normalize a raw font-family string to the allow-list lookup key: take the
// first family in the comma list, strip surrounding quotes and whitespace, and
// lowercase. Returns undefined when the input is not a string.
function normalizeFontKey(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  return raw.split(",")[0]!.replace(/^[\s'"]+|[\s'"]+$/g, "").toLowerCase();
}

// Resolve a Google Fonts CSS2 stylesheet href for the given font family. Only
// fonts in the internal allow-list produce a URL; unrecognized families return
// undefined. The URL always uses https://fonts.googleapis.com/css2 with
// display=swap, which the page validator permits (it allow-lists
// fonts.googleapis.com and fonts.gstatic.com).
export function resolveGoogleFontHref(fontFamily: string | undefined): string | undefined {
  const key = normalizeFontKey(fontFamily);
  if (key === undefined) return undefined;
  const entry = GOOGLE_FONT_ALLOW_LIST[key];
  if (!entry) return undefined;
  return `https://fonts.googleapis.com/css2?family=${entry.spec}&display=swap`;
}

export interface PageTokens {
  brand: string;
  brandForeground: string;
  accent: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  radius: string;
  brandTint: string;
  font: string;
  fontDisplay: string;
}

// Pick a readable foreground (near-black or white) for text laid over the given
// background color, so a light prospect brand color does not produce white text
// on a white header. Uses an sRGB luminance approximation.
export function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

// Build a low-alpha rgba from a hex color for soft, on-brand section fills.
export function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(1, 118, 211, ${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

// Sanitize a prospect-supplied font-family before it enters the stylesheet. The
// prospect site is untrusted input, so allow only characters that appear in a
// CSS font-family list (letters, digits, spaces, commas, quotes, hyphens) and
// strip anything that could break out of the declaration. Always keep a generic
// fallback so an exotic or unavailable face still renders.
export function sanitizeFontFamily(raw: string | undefined): string {
  if (typeof raw !== "string") return SYSTEM_FONT;
  const cleaned = raw.replace(/[^A-Za-z0-9 ,"'-]/g, "").trim();
  if (cleaned === "") return SYSTEM_FONT;
  return /sans-serif|serif|monospace/i.test(cleaned) ? cleaned : `${cleaned}, ${SYSTEM_FONT}`;
}

// Resolve the page tokens from the prospect brand, the seller brand, the active
// vertical's accent, and the house default, in that order. Each token falls back
// on its own, so a partial prospect brand still themes every value it carries.
// The builder passes the active vertical's defaultAccentColor as fallbackColor.
export function deriveTokens(
  profile: ProductProfile,
  brand: ProspectBrand | undefined,
  fallbackColor: string = HOUSE_NEUTRAL,
): PageTokens {
  const sellerColor = (v: unknown): string | undefined =>
    typeof v === "string" && HEX_COLOR.test(v) ? v : undefined;

  const verticalColor = HEX_COLOR.test(fallbackColor) ? fallbackColor : HOUSE_NEUTRAL;
  const primary =
    brand?.primary_color || sellerColor(profile.brand?.primary_color) || verticalColor;
  const accent = brand?.accent_color || primary;
  const bg = brand?.background_color || "#f7f8fa";
  const text = brand?.text_color || "#1a1a1a";

  const font = sanitizeFontFamily(brand?.font_family);
  const fontEntry = GOOGLE_FONT_ALLOW_LIST[normalizeFontKey(brand?.font_family) ?? ""];
  const fontDisplay = fontEntry ? `"${fontEntry.displayName}", ${SYSTEM_FONT}` : font;

  return {
    brand: primary,
    brandForeground: readableOn(primary),
    accent,
    bg,
    surface: "#ffffff",
    surfaceMuted: "#fafafa",
    text,
    muted: "#666666",
    border: "#e4e4e7",
    radius: "10px",
    brandTint: tint(primary, 0.06),
    font,
    fontDisplay,
  };
}

// Render the per-lead :root token block. Colors are validated hex (or rgba
// derived from validated hex) and the font is sanitized, so this is safe inside
// the stylesheet.
export function renderTokenBlock(t: PageTokens): string {
  return `:root {
      --brand: ${t.brand};
      --brand-fg: ${t.brandForeground};
      --accent: ${t.accent};
      --bg: ${t.bg};
      --surface: ${t.surface};
      --surface-muted: ${t.surfaceMuted};
      --text: ${t.text};
      --muted: ${t.muted};
      --border: ${t.border};
      --radius: ${t.radius};
      --brand-tint: ${t.brandTint};
      --font-sans: ${t.font};
      --font-display: ${t.fontDisplay};
    }`;
}

// Resolve the logo URL. Prefer the prospect's own logo (D48), then the
// seller-supplied logo, then none (a clean text wordmark renders instead).
export function resolveLogoUrl(
  profile: ProductProfile,
  brand: ProspectBrand | undefined,
): string | undefined {
  if (brand?.logo_url) return brand.logo_url;
  const sellerLogo = profile.brand?.logo_url;
  if (typeof sellerLogo === "string" && /^https?:\/\//.test(sellerLogo)) return sellerLogo;
  return undefined;
}

// Resolve the favicon href. Prefer the prospect favicon the agent captured (D48),
// then fall back to the prospect site's conventional /favicon.ico.
export function resolveFaviconHref(
  websiteUrl: string | null | undefined,
  brand: ProspectBrand | undefined,
): string | undefined {
  if (brand?.favicon_url) return brand.favicon_url;
  if (websiteUrl && /^https?:\/\//.test(websiteUrl)) {
    return `${websiteUrl.replace(/\/+$/, "")}/favicon.ico`;
  }
  return undefined;
}
