// S3 storage behind a thin abstraction (D16). The Publish stage uploads one
// self-contained HTML object per job under a deterministic key and returns the
// public website-endpoint URL. The abstraction lets a branded subdomain and CDN
// front this later without touching the Publish stage.

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/env.ts";

let s3: S3Client | null = null;

function client(): S3Client {
  if (!s3) s3 = new S3Client({ region: config.s3.region });
  return s3;
}

// Deterministic key: a repeated publish overwrites the same object with the same
// bytes, which keeps the stage idempotent (mvp-pipeline-architecture Idempotency).
export function siteKey(orgId: string, jobId: string): string {
  return `${orgId}/${jobId}/index.html`;
}

// The org and job a published URL points back to. `siteKey` embeds both ids in
// the object key (`${orgId}/${jobId}/index.html`), and the published URL is that
// key under the website endpoint, so a URL parses straight back to the two ids
// without a database round-trip. The /site-debug skill relies on this to turn a
// site.url into the keys for every per-job record (job, research, profile via
// the job's org, token usage, and the retained research session id, D56).
export interface SiteKeys {
  orgId: string;
  jobId: string;
}

// Parse the org and job ids out of a published site URL (or a bare key). Reads
// the two path segments that precede `index.html`, so it tolerates the scheme,
// host, a trailing slash, and query or fragment noise a shared link picks up. A
// uuid shape check guards against a path that merely resembles the layout, so a
// malformed link fails loud here rather than producing an empty database read.
// Returns null when the URL does not match the published-site layout.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSiteUrl(input: string): SiteKeys | null {
  // Strip a query string or fragment, then split on slashes and drop empties so
  // both a full URL and a bare `org/job/index.html` key parse the same way.
  const path = input.trim().split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((s) => s.length > 0);
  const idx = segments.lastIndexOf("index.html");
  // The two segments before index.html are the ids. Anchor on index.html so a
  // longer host path (a CDN prefix, say) cannot shift the positions.
  const end = idx === -1 ? segments.length : idx;
  if (end < 2) return null;
  const orgId = segments[end - 2];
  const jobId = segments[end - 1];
  if (orgId === undefined || jobId === undefined) return null;
  if (!UUID_RE.test(orgId) || !UUID_RE.test(jobId)) return null;
  return { orgId, jobId };
}

export interface PublishResult {
  key: string;
  url: string;
}

// Upload the page and return its public URL. Bucket policy already grants public
// read (D29); the object carries an HTML content type so the browser renders it.
export async function publishSite(
  orgId: string,
  jobId: string,
  html: string,
): Promise<PublishResult> {
  const key = siteKey(orgId, jobId);
  await client().send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "no-cache",
    }),
  );
  return { key, url: `${config.s3.websiteEndpoint}/${key}` };
}
