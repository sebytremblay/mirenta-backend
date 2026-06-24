import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config/env.ts";

let s3: S3Client | null = null;

function client(): S3Client {
  if (!s3) s3 = new S3Client({ region: config.s3.region });
  return s3;
}

export function siteKey(orgId: string, jobId: string): string {
  return `${orgId}/${jobId}/index.html`;
}

export interface SiteKeys {
  orgId: string;
  jobId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSiteUrl(input: string): SiteKeys | null {
  const path = input.trim().split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter((s) => s.length > 0);
  const idx = segments.lastIndexOf("index.html");
  // Anchor on index.html so a longer host path (a CDN prefix) cannot shift the
  // id positions.
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
