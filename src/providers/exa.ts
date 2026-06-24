// Nothing in the live path imports this module: the Research Agent reaches Exa
// through its hosted MCP server. Kept deliberately as the fallback seam for
// running quote verification host-side as a custom client-side tool.

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
