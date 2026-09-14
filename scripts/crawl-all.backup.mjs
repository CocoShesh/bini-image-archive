import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const LIBRARY_DIR = path.join(ROOT, 'public', 'library');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'library.json');

const MEMBERS = ['Aiah','Colet','Gwen','Jhoanna','Maloi','Mikha','Stacey','Sheena'];
const GROUPS = ['OT8'];
const YEARS = ['2024','2025','2026'];
const TERMS = ['photos','concert','event','photoshoot','concept photos','BINIverse','Talaarawan','Pantropiko'];
const MAX_SCROLLS = Number(process.env.MAX_SCROLLS || 120);
const SCROLL_DELAY = Number(process.env.SCROLL_DELAY || 1800);
const STABLE_ROUNDS = Number(process.env.STABLE_ROUNDS || 10);
const LIMIT_PER_QUERY = Number(process.env.LIMIT_PER_QUERY || 0); // 0 = no artificial limit
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);

await fs.mkdir(LIBRARY_DIR, { recursive: true });
await fs.mkdir(DATA_DIR, { recursive: true });

async function readLibrary() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { return []; }
}
async function writeLibrary(items) { await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2) + '\n', 'utf8'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function originalize(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'i.pinimg.com') {
      u.pathname = u.pathname.replace(/\/(?:60x60|75x|136x136|170x|236x|474x|564x|736x)\//, '/originals/');
    }
    return u.toString();
  } catch { return url; }
}
function buildQueries() {
  const list = [];
  for (const member of [...MEMBERS, ...GROUPS]) {
    list.push(`BINI ${member}`);
    for (const y of YEARS) list.push(`BINI ${member} ${y}`);
    for (const term of TERMS) list.push(`BINI ${member} ${term}`);
  }
  return [...new Set(list)];
}

async function collectQuery(browser, query) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();
  const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
  console.log(`\n[QUERY] ${query}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const discovered = new Map();
    let stable = 0;
    let last = 0;
    for (let round = 1; round <= MAX_SCROLLS; round++) {
      const items = await page.evaluate(() => {
        const result = [];
        const parseSrcset = (value) => {
          if (!value) return null;
          return value.split(',').map(x => {
            const p = x.trim().split(/\s+/); return { url: p[0], width: p[1]?.endsWith('w') ? Number(p[1].slice(0,-1)) : 0 };
          }).sort((a,b) => b.width-a.width)[0]?.url || null;
        };
        for (const img of document.images) {
          const rect = img.getBoundingClientRect();
          if (rect.width < 80 || rect.height < 80) continue;
          let pinUrl = '';
          let node = img;
          for (let i=0;i<7 && node;i++,node=node.parentElement) {
            const a = node.querySelector?.('a[href*="/pin/"]') || node.closest?.('a[href*="/pin/"]');
            if (a?.href) { pinUrl = a.href; break; }
          }
          const srcset = img.getAttribute('srcset');
          const imageUrl = parseSrcset(srcset) || img.currentSrc || img.getAttribute('src') || '';
          if (imageUrl) result.push({ pinUrl, imageUrl, width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        }
        return result;
      });
      for (const item of items) {
        const imageUrl = originalize(item.imageUrl);
        const key = item.pinUrl || imageUrl;
        if (key && !discovered.has(key)) discovered.set(key, { ...item, imageUrl });
      }
      const gained = discovered.size - last;
      console.log(`  scroll ${round}/${MAX_SCROLLS} · +${gained} · total ${discovered.size}`);
      stable = gained === 0 ? stable + 1 : 0;
      last = discovered.size;
      if (stable >= STABLE_ROUNDS) break;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(SCROLL_DELAY);
    }
    const result = [...discovered.values()];
    console.log(`  done: ${result.length} discovered`);
    return result;
  } catch (e) {
    console.error(`  query failed: ${e.message}`);
    return [];
  } finally {
    await context.close();
  }
}

const queries = buildQueries();
console.log(`Automatic crawl starting. Generated ${queries.length} queries.`);
console.log(`No manual query input is required.`);

const browser = await chromium.launch({ headless: true });
const library = await readLibrary();
const hashes = new Set(library.map(x => x.sha256));
let discoveredCount = 0, added = 0, duplicates = 0, failed = 0;

for (let i=0;i<queries.length;i+=CONCURRENCY) {
  const batch = queries.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(q => collectQuery(browser, q)));
  for (let b=0;b<results.length;b++) {
    const query = batch[b];
    let items = results[b];
    if (LIMIT_PER_QUERY > 0) items = items.slice(0, LIMIT_PER_QUERY);
    discoveredCount += items.length;
    for (const item of items) {
      try {
        const r = await fetch(item.imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) { failed++; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 5000) { failed++; continue; }
        const hash = sha256(buf);
        if (hashes.has(hash)) { duplicates++; continue; }
        const filename = `${hash}.jpg`;
        await fs.writeFile(path.join(LIBRARY_DIR, filename), buf);
        const member = MEMBERS.find(m => new RegExp(`\\b${m}\\b`, 'i').test(query)) || (query.includes('OT8') ? 'OT8' : '');
        const y = query.match(/\b20\d{2}\b/);
        library.push({ id: hash, title: query, member, year: y ? Number(y[0]) : null, source:'Pinterest', pinUrl:item.pinUrl || '', imageUrl:item.imageUrl, localPath:`/library/${filename}`, width:item.width || null, height:item.height || null, bytes:buf.length, sha256:hash, discoveredAt:new Date().toISOString() });
        hashes.add(hash); added++;
        console.log(`  + ${query} · ${filename}`);
      } catch (e) { failed++; }
    }
  }
  await writeLibrary(library);
  console.log(`\nPROGRESS ${Math.min(i+CONCURRENCY, queries.length)}/${queries.length} queries · ${library.length} total images`);
}
await browser.close();
await writeLibrary(library);
console.log('\n===== AUTOMATIC CRAWL COMPLETE =====');
console.log(`Queries processed : ${queries.length}`);
console.log(`Discovered        : ${discoveredCount}`);
console.log(`Added             : ${added}`);
console.log(`Duplicates        : ${duplicates}`);
console.log(`Failed            : ${failed}`);
console.log(`Library total     : ${library.length}`);
