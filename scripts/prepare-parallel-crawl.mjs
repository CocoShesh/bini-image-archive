import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const R2_STATE_PREFIX = (process.env.R2_STATE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');
const CHECKPOINT_KEY = `${R2_STATE_PREFIX}/crawl-checkpoint.json`;
const FALLBACK_BASE_INDEX = Number(process.env.CRAWL_FALLBACK_BASE_INDEX || 0);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: env('R2_ENDPOINT'),
  credentials: {
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  },
});

async function bodyToText(body) {
  if (!body) return '';
  if (typeof body.transformTo === 'function') return await body.transformTo('string');
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function readCheckpoint() {
  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: env('R2_BUCKET'),
      Key: CHECKPOINT_KEY,
    }));
    const text = await bodyToText(response.Body);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

const checkpoint = await readCheckpoint();
const baseIndex = Number.isInteger(checkpoint?.nextQueryIndex)
  ? Math.max(0, checkpoint.nextQueryIndex)
  : FALLBACK_BASE_INDEX;

const totalQueries = Number.isInteger(checkpoint?.totalQueries) ? checkpoint.totalQueries : 0;

console.log(`R2 checkpoint: ${checkpoint ? 'found' : 'missing'}`);
console.log(`nextQueryIndex: ${baseIndex}`);
console.log(`totalQueries:   ${totalQueries || 'unknown'}`);

const outputFile = process.env.GITHUB_OUTPUT;
if (!outputFile) throw new Error('GITHUB_OUTPUT is not available');

import { appendFile } from 'node:fs/promises';
await appendFile(outputFile, `base_index=${baseIndex}\n`);
await appendFile(outputFile, `checkpoint_total_queries=${totalQueries}\n`);
