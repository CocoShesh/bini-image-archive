import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'data', 'library.json');
const DELETE_LOCAL = /^(1|true|yes)$/i.test(process.env.DELETE_LOCAL || 'false');
const QUALITY = Number(process.env.IMAGE_QUALITY || 90);

function env(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
const client = new S3Client({ region: 'auto', endpoint: env('R2_ENDPOINT'), credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') } });
const bucket = env('R2_BUCKET');
const base = env('R2_PUBLIC_BASE_URL').replace(/\/$/, '');

const library = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
let moved = 0, skipped = 0, failed = 0;

for (let i = 0; i < library.length; i++) {
  const item = library[i];
  if (item.storageUrl) { skipped++; continue; }
  if (!item.localPath) { skipped++; continue; }
  const input = path.join(ROOT, 'public', item.localPath.replace(/^\//, ''));
  try {
    const source = await fs.readFile(input);
    const webp = await sharp(source, { failOn: 'none' }).rotate().webp({ quality: QUALITY, effort: 4 }).toBuffer();
    const key = `images/${item.sha256}.webp`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: webp, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }));
    item.storageKey = key;
    item.storageUrl = `${base}/${key}`;
    item.src = item.storageUrl;
    item.bytes = webp.length;
    item.originalBytes = item.originalBytes || source.length;
    if (DELETE_LOCAL) {
      await fs.rm(input, { force: true });
      item.localPath = '';
    }
    moved++;
    console.log(`[${i + 1}/${library.length}] uploaded ${item.sha256}`);
    if (i % 25 === 0) await fs.writeFile(DATA_FILE, JSON.stringify(library, null, 2) + '\n');
  } catch (error) {
    failed++;
    console.error(`[${i + 1}/${library.length}] failed ${item.sha256}: ${error.message}`);
  }
}
await fs.writeFile(DATA_FILE, JSON.stringify(library, null, 2) + '\n');
console.log(`Migration complete · uploaded ${moved} · skipped ${skipped} · failed ${failed}`);
