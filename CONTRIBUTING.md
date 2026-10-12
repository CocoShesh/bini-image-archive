# Contributing to bini-image-archive

## Start with the correct application

Run `npm ci`. Configure R2 credentials in `.env.local` before using `npm run dev` or `npm start`; these scripts run `sync:r2` first. The sync command downloads the configured state/library.json to data/library.json. Keep credentials local. `npm run build` is the production build command; it is not proof of working remote storage.

## Keep changes reviewable

Describe the observed problem and the behavior after your change. Keep one concern per pull request; avoid unrelated dependency updates and formatting churn. Read existing repository instructions before changing source.

## Verification

Run `npx tsc --noEmit` and `npm run build` in a configured test environment. Run `python3 scripts/source-preflight.py` for dependency-free JavaScript/Python syntax checks once available. Verify public browsing separately from protected moderation routes. Do not run crawlers or forced analysis merely to validate a documentation change.

For browser changes, check 390 × 844, 768 × 1024 and 1440 × 900 viewports. Look for horizontal overflow, clipped controls, readable text and keyboard focus. Record the actual browser and dimensions; a screenshot alone does not prove the whole journey.

Useful end-to-end check: Load the public archive, filter by member/year, load another page, save a favorite and reload. With authorized test moderator access, verify a synthetic report is visible and moderation routes reject unauthenticated requests.

## Handle sensitive data

Never attach R2 credentials, admin review keys, session secrets, private reports or exported moderation state. Redact private object URLs and reporter information.

## Before opening a pull request

- Explain what changed and why.
- List commands actually run and their results; state skipped checks explicitly.
- Include reproducible steps for bug fixes and relevant screenshots for UI changes.
- Describe migration or rollback needs when changing persisted data.
