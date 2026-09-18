import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const prefix = (process.env.R2_STATE_PREFIX || 'state').replace(/^\/+|\/+$/g, '');

const enabled = Boolean(
  process.env.R2_ENDPOINT &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET,
);

const client = enabled
  ? new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export const R2_STATE_PREFIX = prefix;
export const R2_ENABLED = enabled;

async function bodyToText(body: unknown) {
  if (!body) return '';
  const value = body as { transformTo?: (type: 'string') => Promise<string> };
  if (typeof value.transformTo === 'function') return value.transformTo('string');

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function key(name: string) {
  const clean = name.replace(/^\/+/, '');
  return `${R2_STATE_PREFIX}/${clean}`;
}

export async function readState<T>(name: string, fallback: T): Promise<T> {
  if (!client) return fallback;
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key(name),
    }));
    const text = await bodyToText(response.Body);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch (error: any) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NoSuchKey') return fallback;
    return fallback;
  }
}

export async function writeState<T>(name: string, value: T) {
  if (!client) return false;
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key(name),
    Body: JSON.stringify(value, null, 2) + '\n',
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache, no-store, must-revalidate',
  }));
  return true;
}
