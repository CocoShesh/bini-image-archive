import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

dotenv.config({ path: '.env.local' });

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function bodyToText(body) {
  if (!body) return '';
  if (typeof body.transformTo === 'function') return body.transformTo('string');
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const endpoint = required('R2_ENDPOINT');
const accessKeyId = required('R2_ACCESS_KEY_ID');
const secretAccessKey = required('R2_SECRET_ACCESS_KEY');
const bucket = required('R2_BUCKET');
const prefix = (process.env.R2_STATE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');
const key = `${prefix}/library.json`;

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
const text = await bodyToText(response.Body);
if (!text) throw new Error('R2 returned an empty library.json');

const library = JSON.parse(text);
if (!Array.isArray(library)) throw new Error('R2 library.json is not an array');

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.writeFile(LIBRARY_FILE, JSON.stringify(library, null, 2) + '\n', 'utf8');

console.log(`Synced ${library.length} images from R2 -> ${path.relative(ROOT, LIBRARY_FILE)}`);
