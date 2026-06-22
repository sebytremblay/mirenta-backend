---
name: baseline-green
description: Pre-reposition baseline; no npm run build, use npm run typecheck; how to run tests
metadata:
  type: project
---

Pre-reposition baseline captured 2026-06-21 on `feat/founder-to-founder`:
- `npm test` -> 167 tests pass, 0 fail, 0 skipped (exit 0). Runs `node --test 'tests/unit/*.test.ts'`.
- `npm run typecheck` -> exit 0. Runs `tsc --noEmit`.

**There is no `npm run build`.** The repo equivalent the gate requires is
`npm run typecheck`. Capture exit codes with `; echo "EXIT=$?"` on the npm line directly,
NOT after a pipe (a pipe captures the pager's exit, not npm's). Or write to a file and read
`$?` immediately.

Integration tests (`npm run test:integration`) hit live services and are NOT part of the
unit gate; the G2/build gate uses `npm test` only.

Test conventions: `node:test` + `node:assert/strict`, files in `tests/unit/*.test.ts`,
shared profile fixture at `tests/fixtures/profile.ts` (`makeProfile(overrides)`). Each
vertical has a unit test that pins its worked-example figures and asserts the disclosure
contract via `assertValueModelContract`.
