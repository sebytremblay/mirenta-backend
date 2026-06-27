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
  "oswald":              { displayName: "Oswald",              spec: "Oswald:wght@600;700" },
  "montserrat":          { displayName: "Montserrat",          spec: "Montserrat:wght@600;700" },
  "poppins":             { displayName: "Poppins",             spec: "Poppins:wght@600;700" },
  "roboto":              { displayName: "Roboto",              spec: "Roboto:wght@400;700" },
  "roboto condensed":    { displayName: "Roboto Condensed",    spec: "Roboto+Condensed:wght@600;700" },
  "inter":               { displayName: "Inter",               spec: "Inter:wght@400;600;700" },
  "lato":                { displayName: "Lato",                spec: "Lato:wght@400;700" },
  "open sans":           { displayName: "Open Sans",           spec: "Open+Sans:wght@600;700" },
  "raleway":             { displayName: "Raleway",             spec: "Raleway:wght@600;700" },
  "playfair display":    { displayName: "Playfair Display",    spec: "Playfair+Display:wght@600;700" },
  "bebas neue":          { displayName: "Bebas Neue",          spec: "Bebas+Neue" },
  "anton":               { displayName: "Anton",               spec: "Anton" },
  "teko":                { displayName: "Teko",                spec: "Teko:wght@600;700" },
  "rubik":               { displayName: "Rubik",               spec: "Rubik:wght@600;700" },
  "archivo":             { displayName: "Archivo",             spec: "Archivo:wght@600;700" },
  "barlow":              { displayName: "Barlow",              spec: "Barlow:wght@600;700" },
  "work sans":           { displayName: "Work Sans",           spec: "Work+Sans:wght@400;600;700" },
  "source sans 3":       { displayName: "Source Sans 3",       spec: "Source+Sans+3:wght@600;700" },
  "nunito":              { displayName: "Nunito",              spec: "Nunito:wght@700" },
  "merriweather":        { displayName: "Merriweather",        spec: "Merriweather:wght@700" },
  // Characterful display and body faces. These give a page a bespoke voice the
  // safe-and-common faces above cannot. Every spec is a valid css2 family.
  "space grotesk":       { displayName: "Space Grotesk",       spec: "Space+Grotesk:wght@500;700" },
  "sora":                { displayName: "Sora",                spec: "Sora:wght@600;700" },
  "fraunces":            { displayName: "Fraunces",            spec: "Fraunces:opsz,wght@9..144,500;9..144,700" },
  "dm serif display":    { displayName: "DM Serif Display",    spec: "DM+Serif+Display" },
  "dm sans":             { displayName: "DM Sans",             spec: "DM+Sans:wght@400;500;700" },
  "spectral":            { displayName: "Spectral",            spec: "Spectral:wght@500;700" },
  "epilogue":            { displayName: "Epilogue",            spec: "Epilogue:wght@500;700" },
  "manrope":             { displayName: "Manrope",             spec: "Manrope:wght@400;600;700" },
  "syne":                { displayName: "Syne",                spec: "Syne:wght@600;800" },
  "bricolage grotesque": { displayName: "Bricolage Grotesque", spec: "Bricolage+Grotesque:wght@600;800" },
  "instrument serif":    { displayName: "Instrument Serif",    spec: "Instrument+Serif" },
  "crimson pro":         { displayName: "Crimson Pro",         spec: "Crimson+Pro:wght@500;700" },
  "ibm plex sans":       { displayName: "IBM Plex Sans",       spec: "IBM+Plex+Sans:wght@400;600;700" },
  "ibm plex mono":       { displayName: "IBM Plex Mono",       spec: "IBM+Plex+Mono:wght@500;700" },
  "space mono":          { displayName: "Space Mono",          spec: "Space+Mono:wght@400;700" },
  "lora":                { displayName: "Lora",                spec: "Lora:wght@500;700" },
  "outfit":              { displayName: "Outfit",              spec: "Outfit:wght@400;600;700" },
};

// A curated display-and-body pairing. When the prospect's own font is not in the
// allow list, a page would otherwise fall back to the bland system stack. A
// pairing keeps the page distinctive: a characterful display face for headings
// and a clean, readable body face. Both keys MUST exist in the allow list above.
interface FontPairing {
  display: string;
  body: string;
}

const FONT_PAIRINGS: readonly FontPairing[] = [
  { display: "fraunces", body: "inter" },
  { display: "space grotesk", body: "dm sans" },
  { display: "syne", body: "manrope" },
  { display: "anton", body: "work sans" },
  { display: "dm serif display", body: "lato" },
  { display: "bricolage grotesque", body: "ibm plex sans" },
];

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

// A stable, dependency-free hash of the seed so the same prospect always lands
// on the same pairing. No Math.random: the smoke chain and production must agree
// on the page a given prospect renders.
function seedIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % modulo;
}

export function resolvePairing(seed: string): FontPairing {
  return FONT_PAIRINGS[seedIndex(seed, FONT_PAIRINGS.length)]!;
}

// One combined css2 href carrying both faces of a pairing. The host stays
// fonts.googleapis.com, which the validator and CSP always allow.
function pairingHref(pairing: FontPairing): string {
  const display = GOOGLE_FONT_ALLOW_LIST[pairing.display]!;
  const body = GOOGLE_FONT_ALLOW_LIST[pairing.body]!;
  return `https://fonts.googleapis.com/css2?family=${display.spec}&family=${body.spec}&display=swap`;
}

export interface FontPlan {
  // The Google Fonts <link> href to place in the <head>, or undefined when the
  // page rides the system stack (only when no pairing is desired).
  href: string | undefined;
  // The resolved --font-display and --font-sans stacks.
  fontDisplay: string;
  fontSans: string;
}

// The single source of truth for the builder's font decision. When the prospect
// runs an allow-listed font, that font drives the page (current behavior). When
// it does not, a curated pairing keyed on the seed keeps the page distinctive
// rather than collapsing to the system stack.
export function resolveFontPlan(
  brand: ProspectBrand | undefined,
  seed: string,
): FontPlan {
  const sans = sanitizeFontFamily(brand?.font_family);
  const prospectEntry = GOOGLE_FONT_ALLOW_LIST[normalizeFontKey(brand?.font_family) ?? ""];

  if (prospectEntry) {
    return {
      href: resolveGoogleFontHref(brand?.font_family),
      fontDisplay: `"${prospectEntry.displayName}", ${SYSTEM_FONT}`,
      fontSans: sans,
    };
  }

  const pairing = resolvePairing(seed);
  const display = GOOGLE_FONT_ALLOW_LIST[pairing.display]!;
  const body = GOOGLE_FONT_ALLOW_LIST[pairing.body]!;
  return {
    href: pairingHref(pairing),
    fontDisplay: `"${display.displayName}", ${SYSTEM_FONT}`,
    fontSans: `"${body.displayName}", ${SYSTEM_FONT}`,
  };
}

export interface PageTokens {
  brand: string;
  brandForeground: string;
  brandStrong: string;
  brandSoft: string;
  accent: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  surfaceDark: string;
  surfaceDarkForeground: string;
  text: string;
  muted: string;
  border: string;
  radius: string;
  brandTint: string;
  brandTintStrong: string;
  shadow: string;
  shadowLg: string;
  ring: string;
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

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number): string => clampByte(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Pull a color toward white by `amt` (0..1). Returns the input on a malformed
// hex so callers never have to guard.
export function lighten(hex: string, amt: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}

// Pull a color toward black by `amt` (0..1). Returns the input on a malformed hex.
export function darken(hex: string, amt: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

// Blend two colors by `t` (0 = all A, 1 = all B). Returns A on a malformed input.
export function mix(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return hexA;
  return toHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
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
  seed?: string,
): PageTokens {
  const sellerColor = (v: unknown): string | undefined =>
    typeof v === "string" && HEX_COLOR.test(v) ? v : undefined;

  const verticalColor = HEX_COLOR.test(fallbackColor) ? fallbackColor : HOUSE_NEUTRAL;
  const primary =
    brand?.primary_color || sellerColor(profile.brand?.primary_color) || verticalColor;

  // When the prospect supplies a primary but no accent, derive a real second
  // color so two-color directions have something to work with. Gate on a
  // prospect-supplied primary so a fallback color (vertical or seller) keeps the
  // single-color behavior the resolution-order tests pin.
  const accent =
    brand?.accent_color ||
    (brand?.primary_color ? lighten(primary, 0.22) : primary);

  const bg = brand?.background_color || "#f7f8fa";
  const text = brand?.text_color || "#1a1a1a";

  // A dark on-brand panel for direction "signature moves", carrying just enough
  // brand to read as on-theme rather than a generic black band.
  const surfaceDark = mix(primary, "#0b0b12", 0.82);

  // When a seed is supplied, font resolution flows through the single FontPlan
  // resolver, which keeps the page off the bland system stack via a curated
  // pairing when the prospect font is unknown. Without a seed, keep the legacy
  // single-font behavior the existing callers and tests rely on.
  let font: string;
  let fontDisplay: string;
  if (typeof seed === "string") {
    const plan = resolveFontPlan(brand, seed);
    font = plan.fontSans;
    fontDisplay = plan.fontDisplay;
  } else {
    font = sanitizeFontFamily(brand?.font_family);
    const fontEntry = GOOGLE_FONT_ALLOW_LIST[normalizeFontKey(brand?.font_family) ?? ""];
    fontDisplay = fontEntry ? `"${fontEntry.displayName}", ${SYSTEM_FONT}` : font;
  }

  return {
    brand: primary,
    brandForeground: readableOn(primary),
    brandStrong: darken(primary, 0.18),
    brandSoft: lighten(primary, 0.3),
    accent,
    bg,
    surface: "#ffffff",
    surfaceMuted: mix(bg, primary, 0.05),
    surfaceElevated: "#ffffff",
    surfaceDark,
    surfaceDarkForeground: readableOn(surfaceDark),
    text,
    muted: "#666666",
    border: tint(text, 0.14),
    radius: "12px",
    brandTint: tint(primary, 0.06),
    brandTintStrong: tint(primary, 0.12),
    shadow: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.10)",
    shadowLg: "0 12px 32px rgba(16, 24, 40, 0.14)",
    ring: accent,
    font,
    fontDisplay,
  };
}

export function renderTokenBlock(t: PageTokens): string {
  return `:root {
      --brand: ${t.brand};
      --brand-fg: ${t.brandForeground};
      --brand-strong: ${t.brandStrong};
      --brand-soft: ${t.brandSoft};
      --accent: ${t.accent};
      --bg: ${t.bg};
      --surface: ${t.surface};
      --surface-muted: ${t.surfaceMuted};
      --surface-elevated: ${t.surfaceElevated};
      --surface-dark: ${t.surfaceDark};
      --surface-dark-fg: ${t.surfaceDarkForeground};
      --text: ${t.text};
      --muted: ${t.muted};
      --border: ${t.border};
      --radius: ${t.radius};
      --brand-tint: ${t.brandTint};
      --brand-tint-strong: ${t.brandTintStrong};
      --shadow: ${t.shadow};
      --shadow-lg: ${t.shadowLg};
      --ring: ${t.ring};
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
