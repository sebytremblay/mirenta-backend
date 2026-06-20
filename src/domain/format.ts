// Vertical-neutral formatting helpers shared by the value models. Currency
// formatting is presentation, not vertical logic, so it lives in the generic
// core and every vertical's value model reuses it.

// Format a dollar amount as a compact, page-ready string ($1.2M, $480K, $9,200).
export function formatDollars(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}
