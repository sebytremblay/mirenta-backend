import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSiteUrl, siteKey } from "../../src/providers/storage.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const JOB = "66666666-7777-8888-9999-000000000000";

test("parses a published website-endpoint URL", () => {
  const url = `http://mirenta-mvp.s3-website-us-west-1.amazonaws.com/${ORG}/${JOB}/index.html`;
  assert.deepEqual(parseSiteUrl(url), { orgId: ORG, jobId: JOB });
});

test("round-trips with siteKey", () => {
  const key = siteKey(ORG, JOB);
  assert.deepEqual(parseSiteUrl(key), { orgId: ORG, jobId: JOB });
});

test("tolerates a trailing slash, query string, and fragment", () => {
  const base = `https://mirenta-mvp.s3-website-us-west-1.amazonaws.com/${ORG}/${JOB}/index.html`;
  assert.deepEqual(parseSiteUrl(`${base}?utm_source=email`), { orgId: ORG, jobId: JOB });
  assert.deepEqual(parseSiteUrl(`${base}#hero`), { orgId: ORG, jobId: JOB });
});

test("anchors on index.html so a longer host path cannot shift the ids", () => {
  const url = `https://cdn.example.com/sites/${ORG}/${JOB}/index.html`;
  assert.deepEqual(parseSiteUrl(url), { orgId: ORG, jobId: JOB });
});

test("rejects a URL whose id segments are not uuids", () => {
  assert.equal(parseSiteUrl("https://example.com/not-an-org/not-a-job/index.html"), null);
});

test("rejects a URL with too few path segments", () => {
  assert.equal(parseSiteUrl("https://example.com/"), null);
  assert.equal(parseSiteUrl(`https://example.com/${ORG}`), null);
});
