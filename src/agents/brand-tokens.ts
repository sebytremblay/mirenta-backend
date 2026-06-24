import type { ProspectBrand } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const HOUSE_NEUTRAL = "#1a1a2e";
const SYSTEM_FONT =
  `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

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

function normalizeFontKey(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  return raw.split(",")[0]!.replace(/^[\s'"]+|[\s'"]+$/g, "").toLowerCase();
}

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

export function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(1, 118, 211, ${alpha})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

// The font-family comes from the untrusted prospect site, so strip any character
// that could break out of the CSS declaration before it enters the stylesheet.
export function sanitizeFontFamily(raw: string | undefined): string {
  if (typeof raw !== "string") return SYSTEM_FONT;
  const cleaned = raw.replace(/[^A-Za-z0-9 ,"'-]/g, "").trim();
  if (cleaned === "") return SYSTEM_FONT;
  return /sans-serif|serif|monospace/i.test(cleaned) ? cleaned : `${cleaned}, ${SYSTEM_FONT}`;
}

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

export function resolveLogoUrl(
  profile: ProductProfile,
  brand: ProspectBrand | undefined,
): string | undefined {
  if (brand?.logo_url) return brand.logo_url;
  const sellerLogo = profile.brand?.logo_url;
  if (typeof sellerLogo === "string" && /^https?:\/\//.test(sellerLogo)) return sellerLogo;
  return undefined;
}

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
