# BINI Image Archive v2 — Automatic Crawler

This version does **not** require you to type individual member queries.

## Setup

```bash
npm install
npx playwright install chromium
npm run dev
```

## Run the automatic crawl

```bash
npm run crawl:all
```

The crawler automatically generates queries for all 8 members + OT8, multiple years, and event/album/photo keywords. Each query uses an infinite-scroll style browser session and keeps collecting while new public results are rendered.

### Optional controls

```bash
MAX_SCROLLS=200 npm run crawl:all
```

```bash
SCROLL_DELAY=2500 npm run crawl:all
```

```bash
CONCURRENCY=2 npm run crawl:all
```

`LIMIT_PER_QUERY` is optional and defaults to `0` (no artificial per-query cap).

## Storage

Images: `public/library/`

Metadata: `data/library.json`

The archive keeps the local image under a SHA-256 filename and skips exact duplicate files.

## Important

The crawler only collects images that are publicly rendered/accessibly served during its sessions. It does not bypass private boards, authentication, CAPTCHAs, or access controls, and the images may still be copyrighted. Keep source/pin URLs for attribution and use/redistribute images only where permitted.
