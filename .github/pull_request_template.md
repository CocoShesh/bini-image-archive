## Problem and resulting behavior

Explain the concrete trigger, what happened before, and what happens now.

## Verification

List the commands or manual steps actually run, browser/viewports if relevant, and pass/fail results. Do not check off tests that were not run.

Suggested project checks: Run `npx tsc --noEmit` and `npm run build` in a configured test environment. Run `python3 scripts/source-preflight.py` for dependency-free JavaScript/Python syntax checks once available. Verify public browsing separately from protected moderation routes. Do not run crawlers or forced analysis merely to validate a documentation change.

Relevant user journey: Load the public archive, filter by member/year, load another page, save a favorite and reload. With authorized test moderator access, verify a synthetic report is visible and moderation routes reject unauthenticated requests.

## Risks and recovery

Describe persisted-data effects, provider/API changes, and rollback steps if applicable.

## Privacy

Never attach R2 credentials, admin review keys, session secrets, private reports or exported moderation state. Redact private object URLs and reporter information.
