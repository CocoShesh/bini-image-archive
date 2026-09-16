import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const R2_STATE_PREFIX = (process.env.R2_STATE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');
const R2_LIBRARY_KEY = `${R2_STATE_PREFIX}/library.json`;
const R2_WORKER_PREFIX = `${R2_STATE_PREFIX}/crawl-workers`;
const WORKER_COUNT = Number(process.env.CRAWL_WORKER_COUNT || 5);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const r2 = new S3Client({
  region: 'auto',
  endpoint: env('R2_ENDPOINT'),
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
});
async function bodyToText(body) {
  if (!body) return '';
  if (typeof body.transformTo === 'function') return await body.transformTo('string');
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
async function getJson(key, fallback) {
  try {
    const response = await r2.send(new GetObjectCommand({ Bucket: env('R2_BUCKET'), Key: key }));
    const text = await bodyToText(response.Body);
    return text ? JSON.parse(text) : fallback;
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return fallback;
    throw error;
  }
}
async function putJson(key, value) {
  await r2.send(new PutObjectCommand({
    Bucket: env('R2_BUCKET'), Key: key,
    Body: JSON.stringify(value, null, 2) + '\n',
    ContentType: 'application/json; charset=utf-8', CacheControl: 'no-cache',
  }));
}
async function deleteKey(key) {
  try { await r2.send(new DeleteObjectCommand({ Bucket: env('R2_BUCKET'), Key: key })); } catch {}
}

async function main() {
  const baseLibrary = await getJson(R2_LIBRARY_KEY, []);
  const merged = new Map();
  for (const item of baseLibrary) if (item?.sha256) merged.set(item.sha256, item);

  const workerStates = [];
  let totalShardItems = 0;
  let sharedSignature = null;
  let sharedTotalQueries = null;
  let sharedBaseIndex = null;

  for (let workerId = 0; workerId < WORKER_COUNT; workerId++) {
    const state = await getJson(`${R2_WORKER_PREFIX}/worker-${workerId}.json`, null);
    const shard = await getJson(`${R2_WORKER_PREFIX}/worker-${workerId}-library.json`, []);
    workerStates.push(state);
    totalShardItems += Array.isArray(shard) ? shard.length : 0;

    if (!state || state.status !== 'complete' || state.nextQueryIndex !== state.endIndex) {
      throw new Error(`Worker ${workerId + 1} is not complete: ${JSON.stringify(state)}`);
    }

    sharedSignature ??= state.signature;
    sharedTotalQueries ??= state.totalQueries;
    sharedBaseIndex ??= state.baseIndex;

    if (state.signature !== sharedSignature || state.totalQueries !== sharedTotalQueries || state.baseIndex !== sharedBaseIndex) {
      throw new Error(`Worker ${workerId + 1} has incompatible run metadata.`);
    }

    for (const item of shard) {
      if (item?.sha256 && !merged.has(item.sha256)) merged.set(item.sha256, item);
    }
  }

  const expectedNextIndex = workerStates.reduce((max, state) => Math.max(max, state.endIndex), 0);
  if (sharedTotalQueries !== null && expectedNextIndex !== sharedTotalQueries) {
    throw new Error(`Workers do not cover the full query list: end=${expectedNextIndex}, total=${sharedTotalQueries}`);
  }

  const sorted = [...merged.values()];
  await putJson(R2_LIBRARY_KEY, sorted);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'library.json'), JSON.stringify(sorted, null, 2) + '\n', 'utf8');

  const checkpoint = {
    version: 3,
    updatedAt: new Date().toISOString(),
    mode: 'parallel-5',
    totalQueries: sharedTotalQueries ?? expectedNextIndex,
    nextQueryIndex: expectedNextIndex,
    baseIndex: sharedBaseIndex ?? 0,
    workerCount: WORKER_COUNT,
    workers: workerStates,
    libraryTotal: sorted.length,
    workerShardItems: totalShardItems,
    complete: true,
  };
  await putJson(`${R2_STATE_PREFIX}/crawl-checkpoint.json`, checkpoint);
  await fs.writeFile(path.join(DATA_DIR, 'crawl-checkpoint.json'), JSON.stringify(checkpoint, null, 2) + '\n', 'utf8');

  for (let workerId = 0; workerId < WORKER_COUNT; workerId++) {
    await deleteKey(`${R2_WORKER_PREFIX}/worker-${workerId}.json`);
    await deleteKey(`${R2_WORKER_PREFIX}/worker-${workerId}-library.json`);
  }

  console.log('========================================');
  console.log(' PARALLEL CRAWL MERGE COMPLETE');
  console.log('========================================');
  console.log(`Workers           : ${WORKER_COUNT}`);
  console.log(`Base index        : ${sharedBaseIndex ?? 0}`);
  console.log(`End index         : ${expectedNextIndex}`);
  console.log(`Base library      : ${baseLibrary.length}`);
  console.log(`Shard items       : ${totalShardItems}`);
  console.log(`Merged library    : ${sorted.length}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
