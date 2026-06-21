// Unit tests for parseSiteUrl, the inverse of siteKey. The /site-debug skill
// turns a published site URL into the org and job ids that key every per-job
// record (D56), so the parse must hold against the real URL shape, a bare key,
// and the link noise a shared URL collects, and it must reject a path that only
// resembles the layout rather than read an empty database row.

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
  // siteKey builds the object key; parseSiteUrl reads it back. The two must agree.
  const key = siteKey(ORG, JOB);
  assert.deepEqual(parseSiteUrl(key), { orgId: ORG, jobId: JOB });
});

test("tolerates a trailing slash, query string, and fragment", () => {
  const base = `https://mirenta-mvp.s3-website-us-west-1.amazonaws.com/${ORG}/${JOB}/index.html`;
  assert.deepEqual(parseSiteUrl(`${base}?utm_source=email`), { orgId: ORG, jobId: JOB });
  assert.deepEqual(parseSiteUrl(`${base}#hero`), { orgId: ORG, jobId: JOB });
});

test("anchors on index.html so a longer host path cannot shift the ids", () => {
  // A CDN prefix ahead of the two ids must not move the parse off them.
  const url = `https://cdn.example.com/sites/${ORG}/${JOB}/index.html`;
  assert.deepEqual(parseSiteUrl(url), { orgId: ORG, jobId: JOB });
});

test("rejects a URL whose id segments are not uuids", () => {
  // A path that resembles the layout but carries non-uuid segments returns null
  // rather than producing keys that read an empty row.
  assert.equal(parseSiteUrl("https://example.com/not-an-org/not-a-job/index.html"), null);
});

test("rejects a URL with too few path segments", () => {
  assert.equal(parseSiteUrl("https://example.com/"), null);
  assert.equal(parseSiteUrl(`https://example.com/${ORG}`), null);
});
