// Exa search and content fetch behind a thin abstraction (D6). The agent loop
// calls these from inside its tools. The abstraction keeps the built-in web
// tools available as a later fallback without rewriting the loop.

import { config } from "../config/env.ts";

export interface ExaResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
  author?: string;
}

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    publishedDate?: string;
    author?: string;
  }>;
  costDollars?: { total?: number };
}

async function exaPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.exa.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": config.exa.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Exa ${path} ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function normalize(r: NonNullable<ExaSearchResponse["results"]>[number]): ExaResult {
  return {
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    text: r.text,
    publishedDate: r.publishedDate,
    author: r.author,
  };
}

// Search the web and return results with trimmed page text. maxCharacters bounds
// token cost per page; numResults bounds how many pages enter context.
export async function exaSearch(
  query: string,
  opts: { numResults?: number; maxCharacters?: number } = {},
): Promise<ExaResult[]> {
  const data = await exaPost<ExaSearchResponse>("/search", {
    query,
    numResults: opts.numResults ?? 5,
    contents: { text: { maxCharacters: opts.maxCharacters ?? 2000 } },
  });
  return (data.results ?? []).map(normalize);
}

// Fetch the content of specific URLs. The quote-verification pass (D37) re-fetches
// each source to confirm wording, so this returns the full available text.
export async function exaFetchContents(
  urls: string[],
  opts: { maxCharacters?: number } = {},
): Promise<ExaResult[]> {
  if (urls.length === 0) return [];
  const data = await exaPost<ExaSearchResponse>("/contents", {
    urls,
    text: { maxCharacters: opts.maxCharacters ?? 4000 },
  });
  return (data.results ?? []).map(normalize);
}
