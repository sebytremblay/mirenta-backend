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
