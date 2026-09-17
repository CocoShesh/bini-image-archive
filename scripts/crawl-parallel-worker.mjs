import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const LOCAL_WORKER_DIR = path.join(DATA_DIR, 'crawl-workers');

const MAX_SCROLLS = Number(process.env.MAX_SCROLLS || 120);
const SCROLL_DELAY = Number(process.env.SCROLL_DELAY || 2200);
const STABLE_ROUNDS = Number(process.env.STABLE_ROUNDS || 8);
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY || 90);
const KEEP_LOCAL = /^(1|true|yes)$/i.test(process.env.KEEP_LOCAL || 'false');
const QUERY_DELAY = Number(process.env.QUERY_DELAY || 0);

// Default 5 hours.
// This leaves roughly 1 hour of headroom before GitHub Actions reaches 6 hours.
const MAX_RUN_MINUTES = Math.max(
  10,
  Number(process.env.MAX_RUN_MINUTES || 300),
);
const MAX_RUN_MS = MAX_RUN_MINUTES * 60 * 1000;

const WORKER_ID = Number(process.env.CRAWL_WORKER_ID || 0);
const WORKER_COUNT = Number(process.env.CRAWL_WORKER_COUNT || 5);
const PARALLEL_BASE_INDEX = Number(process.env.CRAWL_BASE_INDEX || 0);

const R2_STATE_PREFIX = (process.env.R2_STATE_PREFIX || 'state')
  .replace(/^\/+|\/+$/g, '');

const R2_LIBRARY_KEY = `${R2_STATE_PREFIX}/library.json`;
const R2_WORKER_PREFIX = `${R2_STATE_PREFIX}/crawl-workers`;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const R2_ENABLED = Boolean(
  process.env.R2_ENDPOINT &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET &&
  process.env.R2_PUBLIC_BASE_URL
);

let r2 = null;

if (R2_ENABLED) {
  r2 = new S3Client({
    region: 'auto',
    endpoint: env('R2_ENDPOINT'),
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });
}

const MEMBERS = [
  'Aiah',
  'Colet',
  'Gwen',
  'Jhoanna',
  'Maloi',
  'Mikha',
  'Stacey',
  'Sheena',
];

const GROUPS = ['BINI', 'BINI OT8', 'BINI members'];

const YEARS = [
  '2021',
  '2022',
  '2023',
  '2024',
  '2025',
  '2026',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const BIRTHDAYS = {
  Jhoanna: 'January 26',
  Aiah: 'January 27',
  Sheena: 'May 9',
  Maloi: 'May 27',
  Gwen: 'June 19',
  Stacey: 'July 13',
  Colet: 'September 14',
  Mikha: 'November 8',
};

const TERMS = [
  'photos',
  'photo',
  'pics',
  'pictures',
  'HD photos',
  'HQ photos',
  'high resolution',
  'photo dump',
  'photo set',

  'event',
  'events',
  'appearance',
  'public appearance',
  'special appearance',
  'concert',
  'concert photos',
  'festival',
  'festival photos',
  'mall show',
  'mall event',
  'fan meeting',
  'fan meet',
  'meet and greet',
  'fan event',
  'gathering',

  'birthday',
  'birthday photos',
  'birthday celebration',
  'birthday event',
  'birthday live',
  'birthday shoot',

  'interview',
  'TV appearance',
  'television',
  'TV guesting',
  'radio',
  'radio guesting',
  'podcast',
  'press conference',
  'press event',
  'media event',
  'press photos',
  'photo call',

  'awards',
  'award show',
  'award night',
  'red carpet',
  'red carpet photos',
  'ceremony',

  'photoshoot',
  'photoshoot photos',
  'concept photos',
  'concept',
  'editorial',
  'magazine',
  'magazine shoot',
  'magazine cover',
  'cover shoot',
  'fashion shoot',
  'portrait',
  'studio shoot',

  'backstage',
  'behind the scenes',
  'behind',
  'BTS',
  'rehearsal',
  'practice',
  'dance practice',
  'recording',
  'recording studio',
  'studio',
  'soundcheck',

  'candid',
  'selfie',
  'selca',
  'airport',
  'airport photos',
  'arrival',
  'departure',
  'street',
  'public',

  'release',
  'comeback',
  'album',
  'single',
  'music video',
  'MV',
  'teaser',
  'track',
  'promo',
  'promotion',

  'brand',
  'brand event',
  'endorsement',
  'campaign',
  'commercial',
  'advertisement',
  'launch',
  'product launch',

  'Pantropiko',
  'Talaarawan',
  'BINIverse',
  'BINIverse World Tour',
  'Signals',
  'Step Back',
  "Dahil Sa'Yo",
  'Cherry on Top',
  'Salamin Salamin',
  'Karera',
  'Lagi',
  'Na Na Na',
  'Strings',
  'Feel Good',
  '8',
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function unique(values) {
  return [...new Set(values)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workerStateKey() {
  return `${R2_WORKER_PREFIX}/worker-${WORKER_ID}.json`;
}

function workerShardKey() {
  return `${R2_WORKER_PREFIX}/worker-${WORKER_ID}-library.json`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );
}

async function bodyToText(body) {
  if (!body) return '';

  if (typeof body.transformTo === 'function') {
    return await body.transformTo('string');
  }

  const chunks = [];

  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function readR2Json(key, fallback) {
  if (!R2_ENABLED || !r2) return fallback;

  try {
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: env('R2_BUCKET'),
        Key: key,
      }),
    );

    const text = await bodyToText(response.Body);

    return text ? JSON.parse(text) : fallback;
  } catch (error) {
    if (
      error?.name === 'NoSuchKey' ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      return fallback;
    }

    throw error;
  }
}

async function writeR2Json(key, value) {
  if (!R2_ENABLED || !r2) return;

  await r2.send(
    new PutObjectCommand({
      Bucket: env('R2_BUCKET'),
      Key: key,
      Body: JSON.stringify(value, null, 2) + '\n',
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-cache',
    }),
  );
}

function inferMember(query) {
  return (
    MEMBERS.find((member) =>
      new RegExp(`\\b${member}\\b`, 'i').test(query),
    ) ||
    (/\\bOT8\\b|BINI members|^BINI$/.test(query) ? 'OT8' : '')
  );
}

function inferCategory(query) {
  const q = query.toLowerCase();

  if (q.includes('birthday')) return 'Birthday';
  if (/concert|festival|tour|mall show|mall event|fan meet|gathering/.test(q)) {
    return 'Events';
  }
  if (/photoshoot|concept|editorial|magazine|portrait|cover shoot/.test(q)) {
    return 'Photoshoot';
  }
  if (/backstage|behind|bts|rehearsal|practice|soundcheck|recording|studio/.test(q)) {
    return 'BTS';
  }
  if (/candid|selfie|selca|airport|arrival|departure|street/.test(q)) {
    return 'Candid';
  }
  if (/award|red carpet|ceremony/.test(q)) {
    return 'Awards';
  }
  if (/brand|endorsement|campaign|commercial|advertisement|product launch/.test(q)) {
    return 'Brand';
  }
  if (/interview|press|radio|podcast|tv guesting|television/.test(q)) {
    return 'Media';
  }
  if (/release|comeback|album|single|music video|mv|teaser|track|promo|promotion/.test(q)) {
    return 'Music';
  }

  return 'Archive';
}

function tagsFor(query) {
  const lower = query.toLowerCase();

  return unique([
    inferCategory(query),
    ...TERMS
      .filter((term) => lower.includes(term.toLowerCase()))
      .slice(0, 8),
  ]);
}

function buildQueries() {
  const queries = [];

  for (const group of GROUPS) {
    queries.push(group);

    for (const year of YEARS) {
      queries.push(`${group} ${year}`);

      for (const term of TERMS) {
        queries.push(`${group} ${term} ${year}`);
      }

      for (const month of MONTHS) {
        queries.push(`${group} ${month} ${year}`);
      }
    }

    for (const month of MONTHS) {
      queries.push(`${group} ${month}`);
    }

    for (const term of TERMS) {
      queries.push(`${group} ${term}`);
    }
  }

  for (const member of MEMBERS) {
    queries.push(`BINI ${member}`, member, `${member} BINI`);

    for (const year of YEARS) {
      queries.push(
        `BINI ${member} ${year}`,
        `${member} BINI ${year}`,
      );

      for (const term of TERMS) {
        queries.push(
          `BINI ${member} ${term} ${year}`,
        );

        queries.push(
          `${member} BINI ${term} ${year}`,
        );
      }

      for (const month of MONTHS) {
        queries.push(
          `BINI ${member} ${month} ${year}`,
        );

        queries.push(
          `${member} ${month} ${year}`,
        );
      }
    }

    for (const month of MONTHS) {
      queries.push(
        `BINI ${member} ${month}`,
        `${member} BINI ${month}`,
      );
    }

    const birthday = BIRTHDAYS[member];

    queries.push(
      `BINI ${member} birthday`,
      `BINI ${member} birthday photos`,
      `BINI ${member} birthday celebration`,
      `BINI ${member} birthday event`,
      `BINI ${member} birthday live`,
    );

    if (birthday) {
      queries.push(
        `BINI ${member} ${birthday}`,
        `BINI ${member} ${birthday.split(' ')[0]}`,
      );
    }

    for (const term of [
      'HD',
      'HQ',
      'high resolution',
      'photo dump',
      'selca',
      'selfie',
      'candid',
      'backstage',
      'airport',
      'photoshoot',
      'concept photos',
    ]) {
      queries.push(`BINI ${member} ${term}`);
    }
  }

  return unique(queries.filter(Boolean));
}

function normalizeImageUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes('pinimg.com')) {
      parsed.pathname = parsed.pathname
        .replace(/\/\d+x\d+\//, '/originals/')
        .replace(/\/\d+x\//, '/originals/')
        .replace(/\/\d+x\d+_rs\//, '/originals/');
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function pickLargestSrcset(srcset) {
  if (!srcset) return null;

  return srcset
    .split(',')
    .map((part) => {
      const pieces = part.trim().split(/\s+/);

      if (!pieces[0]) return null;

      return {
        url: pieces[0],
        width: pieces[1]?.endsWith('w')
          ? Number.parseInt(pieces[1], 10) || 0
          : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.width - a.width)[0]?.url || null;
}

async function discoverImages(page) {
  return page.evaluate(() => {
    const pick = (srcset) => {
      if (!srcset) return null;

      return srcset
        .split(',')
        .map((part) => {
          const p = part.trim().split(/\s+/);

          if (!p[0]) return null;

          return {
            url: p[0],
            width: p[1]?.endsWith('w')
              ? Number.parseInt(p[1], 10) || 0
              : 0,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.width - a.width)[0]?.url || null;
    };

    const results = [];

    for (const img of document.images) {
      const rect = img.getBoundingClientRect();

      if (rect.width < 80 || rect.height < 80) {
        continue;
      }

      const srcset = img.getAttribute('srcset');

      const best =
        pick(srcset) ||
        img.currentSrc ||
        img.getAttribute('src') ||
        '';

      if (!best) continue;

      let pinUrl = '';
      let node = img;

      for (let i = 0; i < 8 && node; i++) {
        if (node instanceof Element) {
          const anchor =
            node.closest("a[href*='/pin/']") ||
            node.querySelector("a[href*='/pin/']");

          if (anchor?.href) {
            pinUrl = anchor.href;
            break;
          }
        }

        node = node.parentElement;
      }

      results.push({
        imageUrl: best,
        srcset: srcset || '',
        pinUrl,
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
      });
    }

    return results;
  });
}

async function crawlQuery(page, query) {
  const url =
    `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;

  console.log(`\n[QUERY] ${query}`);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    const discovered = new Map();

    let stableRounds = 0;
    let previousCount = 0;

    for (let scroll = 1; scroll <= MAX_SCROLLS; scroll++) {
      const before = discovered.size;

      let items = [];

      try {
        items = await discoverImages(page);
      } catch {}

      for (const item of items) {
        const originalCandidate =
          pickLargestSrcset(item.srcset) ||
          item.imageUrl;

        const imageUrl = normalizeImageUrl(originalCandidate);

        if (!imageUrl) continue;

        const key = item.pinUrl || imageUrl;

        if (!discovered.has(key)) {
          discovered.set(key, {
            ...item,
            imageUrl,
          });
        }
      }

      const gained = discovered.size - before;

      console.log(
        `  scroll ${scroll}/${MAX_SCROLLS} · +${gained} · total ${discovered.size}`,
      );

      if (
        discovered.size === previousCount &&
        gained === 0
      ) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }

      previousCount = discovered.size;

      if (stableRounds >= STABLE_ROUNDS) {
        break;
      }

      try {
        await page.evaluate(() =>
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'instant',
          }),
        );
      } catch {
        break;
      }

      await sleep(SCROLL_DELAY);
    }

    return [...discovered.values()];
  } catch (error) {
    console.log(`  failed: ${error.message}`);
    return [];
  }
}

function publicUrlFor(key) {
  return `${R2_PUBLIC_BASE_URL}/${key}`;
}

async function uploadToR2(key, buffer) {
  if (!R2_ENABLED || !r2) {
    throw new Error('R2 is not configured');
  }

  await r2.send(
    new PutObjectCommand({
      Bucket: env('R2_BUCKET'),
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
      CacheControl:
        'public, max-age=31536000, immutable',
    }),
  );
}

async function encodeForStorage(input) {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .webp({
      quality: IMAGE_QUALITY,
      effort: 4,
    })
    .toBuffer();
}

async function loadBaseLibrary() {
  const library = await readR2Json(
    R2_LIBRARY_KEY,
    [],
  );

  await fs.mkdir(DATA_DIR, { recursive: true });

  await writeJson(
    path.join(DATA_DIR, 'library-base.json'),
    library,
  );

  return library;
}

async function loadWorkerShard() {
  const r2Shard = await readR2Json(
    workerShardKey(),
    [],
  );

  const local = await readJson(
    path.join(
      LOCAL_WORKER_DIR,
      `worker-${WORKER_ID}-library.json`,
    ),
    [],
  );

  const source =
    Array.isArray(r2Shard) && r2Shard.length
      ? r2Shard
      : local;

  await fs.mkdir(LOCAL_WORKER_DIR, {
    recursive: true,
  });

  await writeJson(
    path.join(
      LOCAL_WORKER_DIR,
      `worker-${WORKER_ID}-library.json`,
    ),
    source,
  );

  return source;
}

async function persistWorkerState(state, shard) {
  await fs.mkdir(LOCAL_WORKER_DIR, {
    recursive: true,
  });

  await writeJson(
    path.join(
      LOCAL_WORKER_DIR,
      `worker-${WORKER_ID}.json`,
    ),
    state,
  );

  await writeJson(
    path.join(
      LOCAL_WORKER_DIR,
      `worker-${WORKER_ID}-library.json`,
    ),
    shard,
  );

  await writeR2Json(
    workerStateKey(),
    state,
  );

  await writeR2Json(
    workerShardKey(),
    shard,
  );
}

async function loadWorkerState() {
  const r2State = await readR2Json(
    workerStateKey(),
    null,
  );

  if (r2State) {
    return r2State;
  }

  return readJson(
    path.join(
      LOCAL_WORKER_DIR,
      `worker-${WORKER_ID}.json`,
    ),
    null,
  );
}

async function processImage(
  item,
  query,
  library,
  knownHashes,
) {
  try {
    const response = await fetch(
      item.imageUrl,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept:
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      },
    );

    if (!response.ok) {
      return 'failed';
    }

    const original = Buffer.from(
      await response.arrayBuffer(),
    );

    if (original.length < 5000) {
      return 'failed';
    }

    const hash = sha256(original);

    if (knownHashes.has(hash)) {
      return 'duplicate';
    }

    const optimized =
      await encodeForStorage(original);

    const filename = `${hash}.webp`;
    const storageKey = `images/${filename}`;

    await uploadToR2(
      storageKey,
      optimized,
    );

    let localPath = '';

    if (KEEP_LOCAL) {
      const dir = path.join(
        ROOT,
        'public',
        'library',
      );

      await fs.mkdir(dir, {
        recursive: true,
      });

      await fs.writeFile(
        path.join(dir, filename),
        optimized,
      );

      localPath = `/library/${filename}`;
    }

    const yearMatch =
      query.match(/\b20\d{2}\b/);

    const record = {
      id: hash,
      title: query,
      member: inferMember(query),
      year: yearMatch
        ? Number(yearMatch[0])
        : null,
      source: 'Pinterest',
      pinUrl: item.pinUrl || '',
      sourceUrl: item.pinUrl || '',
      imageUrl: item.imageUrl,
      localPath,
      storageKey,
      storageUrl:
        publicUrlFor(storageKey),
      src:
        publicUrlFor(storageKey),
      category:
        inferCategory(query),
      tags:
        tagsFor(query),
      width:
        item.width || null,
      height:
        item.height || null,
      bytes:
        optimized.length,
      originalBytes:
        original.length,
      sha256: hash,
      discoveredAt:
        new Date().toISOString(),
    };

    library.push(record);
    knownHashes.add(hash);

    return 'added';
  } catch (error) {
    console.log(
      `  image failed: ${error.message}`,
    );

    return 'failed';
  }
}

let interrupted = false;

process.on('SIGINT', () => {
  interrupted = true;
  console.log(
    '\nInterrupt requested. Saving checkpoint after the current safe operation…',
  );
});

process.on('SIGTERM', () => {
  interrupted = true;
  console.log(
    '\nTermination requested. Saving checkpoint after the current safe operation…',
  );
});

async function main() {
  if (!R2_ENABLED) {
    throw new Error(
      'Parallel mode requires Cloudflare R2 configuration.',
    );
  }

  if (
    !Number.isInteger(WORKER_ID) ||
    WORKER_ID < 0 ||
    WORKER_ID >= WORKER_COUNT
  ) {
    throw new Error(
      'Invalid CRAWL_WORKER_ID',
    );
  }

  const queries = buildQueries();

  const signature = sha256(
    Buffer.from(queries.join('\n')),
  );

  const totalQueries = queries.length;

  const baseIndex = Math.max(
    0,
    Math.min(
      PARALLEL_BASE_INDEX,
      totalQueries,
    ),
  );

  const remaining = Math.max(
    0,
    totalQueries - baseIndex,
  );

  const workerStart =
    baseIndex +
    Math.floor(
      (remaining * WORKER_ID) /
        WORKER_COUNT,
    );

  const workerEnd =
    baseIndex +
    Math.floor(
      (remaining * (WORKER_ID + 1)) /
        WORKER_COUNT,
    );

  const previous =
    await loadWorkerState();

  let startIndex = workerStart;

  if (
    previous?.signature === signature &&
    previous?.startIndex === workerStart &&
    previous?.endIndex === workerEnd &&
    Number.isInteger(
      previous.nextQueryIndex,
    )
  ) {
    startIndex = Math.max(
      workerStart,
      Math.min(
        previous.nextQueryIndex,
        workerEnd,
      ),
    );
  }

  const baseLibrary =
    await loadBaseLibrary();

  const workerLibrary =
    await loadWorkerShard();

  const knownHashes = new Set(
    [
      ...baseLibrary,
      ...workerLibrary,
    ]
      .map(
        (item) => item?.sha256,
      )
      .filter(Boolean),
  );

  console.log(
    '========================================',
  );
  console.log(
    ' BINI ARCHIVE V2 · 5-WAY PARALLEL CRAWLER',
  );
  console.log(
    '========================================',
  );

  console.log(
    `Worker            : ${WORKER_ID + 1}/${WORKER_COUNT}`,
  );

  console.log(
    `Total queries     : ${totalQueries}`,
  );

  console.log(
    `Global base       : ${baseIndex}`,
  );

  console.log(
    `Assigned range    : ${workerStart}..${Math.max(
      workerStart,
      workerEnd - 1,
    )}`,
  );

  console.log(
    `Resume            : ${startIndex}`,
  );

  console.log(
    `Base library      : ${baseLibrary.length}`,
  );

  console.log(
    `Worker additions  : ${workerLibrary.length}`,
  );

  console.log(
    `Time budget       : ${MAX_RUN_MINUTES} minutes`,
  );

  const stateBase = {
    version: 3,
    workerId: WORKER_ID,
    workerCount: WORKER_COUNT,
    signature,
    totalQueries,
    startIndex: workerStart,
    endIndex: workerEnd,
    baseIndex,
    nextQueryIndex: startIndex,
    status:
      startIndex >= workerEnd
        ? 'complete'
        : 'running',
    libraryTotal:
      workerLibrary.length,
    updatedAt:
      new Date().toISOString(),
  };

  await persistWorkerState(
    stateBase,
    workerLibrary,
  );

  if (startIndex >= workerEnd) {
    console.log(
      'WORKER ALREADY COMPLETE',
    );
    return;
  }

  const browser =
    await chromium.launch({
      headless: true,
    });

  const context =
    await browser.newContext({
      viewport: {
        width: 1600,
        height: 1000,
      },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    });

  const page =
    await context.newPage();

  let addedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;
  let discoveredCount = 0;

  const runStartedAt =
    Date.now();

  const runDeadline =
    runStartedAt + MAX_RUN_MS;

  try {
    for (
      let i = startIndex;
      i < workerEnd;
      i++
    ) {
      if (interrupted) {
        break;
      }

      if (Date.now() >= runDeadline) {
        console.log(
          `TIME BUDGET REACHED · stopping cleanly before query index ${i}`,
        );
        break;
      }

      const query = queries[i];

      const results =
        await crawlQuery(
          page,
          query,
        );

      discoveredCount +=
        results.length;

      for (const item of results) {
        const result =
          await processImage(
            item,
            query,
            workerLibrary,
            knownHashes,
          );

        if (result === 'added') {
          addedCount++;
        } else if (
          result === 'duplicate'
        ) {
          duplicateCount++;
        } else {
          failedCount++;
        }
      }

      const state = {
        ...stateBase,

        nextQueryIndex:
          i + 1,

        lastQuery:
          query,

        status:
          i + 1 >= workerEnd
            ? 'complete'
            : 'running',

        libraryTotal:
          workerLibrary.length,

        addedCount,

        duplicateCount,

        failedCount,

        discoveredCount,

        updatedAt:
          new Date().toISOString(),
      };

      // Critical: checkpoint after EVERY completed query.
      await persistWorkerState(
        state,
        workerLibrary,
      );

      const elapsedMinutes =
        Math.round(
          (Date.now() -
            runStartedAt) /
            60000,
        );

      console.log(
        `WORKER ${WORKER_ID + 1}/${WORKER_COUNT} · PROGRESS ${i + 1}/${workerEnd} · added ${addedCount} · dupes ${duplicateCount} · failed ${failedCount} · elapsed ${elapsedMinutes}m`,
      );

      if (interrupted) {
        break;
      }

      if (Date.now() >= runDeadline) {
        console.log(
          `TIME BUDGET REACHED · checkpoint saved at nextQueryIndex ${i + 1}`,
        );
        break;
      }

      if (QUERY_DELAY > 0) {
        await sleep(
          QUERY_DELAY,
        );
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const finalState =
    await loadWorkerState();

  console.log(
    `WORKER ${WORKER_ID + 1} DONE · next=${
      finalState?.nextQueryIndex ??
      workerStart
    } · shard=${
      workerLibrary.length
    }`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
