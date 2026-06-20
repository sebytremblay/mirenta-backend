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
const HOUSE_BLUE = "#0176d3";
const SYSTEM_FONT =
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

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

// Resolve the page tokens from the prospect brand, the seller brand, and the
// house defaults, in that order. Each token falls back on its own, so a partial
// prospect brand still themes every value it carries.
export function deriveTokens(
  profile: ProductProfile,
  brand: ProspectBrand | undefined,
): PageTokens {
  const sellerColor = (v: unknown): string | undefined =>
    typeof v === "string" && HEX_COLOR.test(v) ? v : undefined;

  const primary = brand?.primary_color || sellerColor(profile.brand?.primary_color) || HOUSE_BLUE;
  const accent = brand?.accent_color || primary;
  const bg = brand?.background_color || "#f7f8fa";
  const text = brand?.text_color || "#1a1a1a";

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
    font: sanitizeFontFamily(brand?.font_family),
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
