// Unit tests for the vertical-neutral currency formatter the value models share.
// These pin the compact-figure rendering so every vertical's ValueResult reads
// consistently on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDollars } from "../../src/domain/format.ts";

test("formatDollars renders compact figures", () => {
  assert.equal(formatDollars(2_600_000), "$2.6M");
  assert.equal(formatDollars(480_000), "$480K");
  assert.equal(formatDollars(9_200), "$9K");
  assert.equal(formatDollars(900), "$900");
  assert.equal(formatDollars(-1_500_000), "-$1.5M");
});
