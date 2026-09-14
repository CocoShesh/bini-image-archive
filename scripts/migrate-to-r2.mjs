import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, "data", "library.json");
const CHECKPOINT_FILE = path.join(
  ROOT,
  "data",
  "r2-migration-checkpoint.json"
);

const BATCH_SIZE = Number(process.env.R2_BATCH_SIZE || 25);
const START_INDEX = Number(process.env.R2_START_INDEX || 0);
const MAX_ITEMS = Number(process.env.R2_MAX_ITEMS || 0);
const DELETE_LOCAL = /^(1|true|yes)$/i.test(
  process.env.DELETE_LOCAL || "false"
);
const QUALITY = Number(process.env.IMAGE_QUALITY || 90);
const RETRIES = Number(process.env.R2_RETRIES || 3);

function env(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

const client = new S3Client({
  region: "auto",
  endpoint: env("R2_ENDPOINT"),
  credentials: {
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  },
});

const bucket = env("R2_BUCKET");
const base = env("R2_PUBLIC_BASE_URL").replace(/\/$/, "");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const temp = `${file}.tmp`;

  await fs.writeFile(
    temp,
    JSON.stringify(value, null, 2) + "\n",
    "utf8"
  );

  await fs.rename(temp, file);
}

function errorInfo(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || error?.Code || null,
    stack: error?.stack || null,
  };
}

async function objectExists(key) {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    return true;
  } catch (error) {
    const code =
      error?.name ||
      error?.Code ||
      error?.$metadata?.httpStatusCode;

    if (
      code === "NotFound" ||
      code === "NoSuchKey" ||
      code === 404
    ) {
      return false;
    }

    return false;
  }
}

async function sendWithRetry(commandFactory) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await client.send(commandFactory());
    } catch (error) {
      lastError = error;

      console.log(
        `      upload attempt ${attempt}/${RETRIES} failed: ${
          error?.message || String(error)
        }`
      );

      if (attempt < RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * attempt)
        );
      }
    }
  }

  throw lastError;
}

async function uploadImage(item) {
  if (!item?.sha256) {
    return {
      status: "skipped",
      reason: "missing sha256",
    };
  }

  const input = item.localPath
    ? path.join(
        ROOT,
        "public",
        item.localPath.replace(/^\/+/, "")
      )
    : "";

  if (!input) {
    return {
      status: "skipped",
      reason: "missing localPath",
    };
  }

  const source = await fs.readFile(input);

  let outputBuffer = source;
  let outputType = "image/jpeg";
  let extension = "jpg";

  try {
    const converted = await sharp(source, {
      failOn: "none",
    })
      .rotate()
      .webp({
        quality: QUALITY,
        effort: 4,
      })
      .toBuffer();

    if (converted.length < source.length) {
      outputBuffer = converted;
      outputType = "image/webp";
      extension = "webp";
    }
  } catch (error) {
    console.log(
      `      sharp optimization skipped: ${
        error?.message || String(error)
      }`
    );
  }

  const key = `images/${item.sha256}.${extension}`;

  if (await objectExists(key)) {
    item.storageKey = key;
    item.storageUrl = `${base}/${key}`;
    item.src = item.storageUrl;
    item.originalBytes = item.originalBytes || source.length;
    item.bytes = outputBuffer.length;
    item.storageContentType = outputType;

    if (DELETE_LOCAL) {
      await fs.rm(input, { force: true });
      item.localPath = "";
    }

    return {
      status: "already-exists",
      key,
      contentType: outputType,
    };
  }

  await sendWithRetry(
    () =>
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: outputBuffer,
        ContentType: outputType,
        CacheControl:
          "public, max-age=31536000, immutable",
      })
  );

  item.storageKey = key;
  item.storageUrl = `${base}/${key}`;
  item.src = item.storageUrl;
  item.originalBytes = item.originalBytes || source.length;
  item.bytes = outputBuffer.length;
  item.storageContentType = outputType;

  if (DELETE_LOCAL) {
    await fs.rm(input, { force: true });
    item.localPath = "";
  }

  return {
    status: "uploaded",
    key,
    originalBytes: source.length,
    storedBytes: outputBuffer.length,
    contentType: outputType,
  };
}

const library = await readJson(DATA_FILE, []);

if (!Array.isArray(library)) {
  throw new Error("library.json must contain an array");
}

const checkpoint = await readJson(CHECKPOINT_FILE, {
  nextIndex: 0,
  completed: [],
  failed: [],
  updatedAt: null,
});

let nextIndex = Math.max(
  Number(checkpoint.nextIndex || 0),
  START_INDEX
);

const endIndex =
  MAX_ITEMS > 0
    ? Math.min(nextIndex + MAX_ITEMS, library.length)
    : library.length;

let uploaded = 0;
let existing = 0;
let skipped = 0;
let failed = 0;

console.log("========================================");
console.log(" BINI R2 MIGRATION");
console.log("========================================");
console.log(`Library total : ${library.length}`);
console.log(`Start index   : ${nextIndex}`);
console.log(`End index     : ${endIndex}`);
console.log(`Batch size    : ${BATCH_SIZE}`);
console.log(`Retries       : ${RETRIES}`);
console.log(`Delete local  : ${DELETE_LOCAL}`);
console.log(`Quality       : ${QUALITY}`);
console.log("");

outer:
for (
  let batchStart = nextIndex;
  batchStart < endIndex;
  batchStart += BATCH_SIZE
) {
  const batchEnd = Math.min(
    batchStart + BATCH_SIZE,
    endIndex
  );

  console.log(
    `\n[BATCH] ${batchStart + 1}-${batchEnd} / ${library.length}`
  );

  for (let i = batchStart; i < batchEnd; i++) {
    const item = library[i];

    try {
      const result = await uploadImage(item);

      if (result.status === "uploaded") {
        uploaded++;

        console.log(
          `[${i + 1}/${library.length}] uploaded ${item.sha256} → ${result.key}`
        );
      } else if (result.status === "already-exists") {
        existing++;

        console.log(
          `[${i + 1}/${library.length}] exists ${item.sha256} → ${result.key}`
        );
      } else {
        skipped++;

        console.log(
          `[${i + 1}/${library.length}] skipped ${item.sha256} (${result.reason})`
        );
      }

      checkpoint.nextIndex = i + 1;
      checkpoint.updatedAt = new Date().toISOString();

      if (
        item.sha256 &&
        !checkpoint.completed.includes(item.sha256)
      ) {
        checkpoint.completed.push(item.sha256);
      }
    } catch (error) {
      failed++;

      const info = errorInfo(error);

      console.error(
        `[${i + 1}/${library.length}] FAILED ${item.sha256}`
      );
      console.error(`      ${info.name}: ${info.message}`);

      const record = {
        index: i,
        sha256: item.sha256,
        localPath: item.localPath || null,
        error: info,
        at: new Date().toISOString(),
      };

      const existingFailureIndex =
        checkpoint.failed.findIndex(
          (entry) =>
            entry.index === i ||
            entry.sha256 === item.sha256
        );

      if (existingFailureIndex >= 0) {
        checkpoint.failed[existingFailureIndex] = record;
      } else {
        checkpoint.failed.push(record);
      }

      // Mark this item as consumed so the migration can continue.
      checkpoint.nextIndex = i + 1;
      checkpoint.updatedAt = new Date().toISOString();
    }

    // Persist after EVERY item.
    await writeJson(DATA_FILE, library);
    await writeJson(CHECKPOINT_FILE, checkpoint);

    console.log(
      `[CHECKPOINT] nextIndex=${checkpoint.nextIndex}`
    );
  }

  if (checkpoint.nextIndex < batchEnd) {
    break outer;
  }
}

if (checkpoint.nextIndex >= library.length) {
  checkpoint.completedAt = new Date().toISOString();

  await writeJson(
    CHECKPOINT_FILE,
    checkpoint
  );
}

console.log("\n========================================");
console.log(" MIGRATION STATUS");
console.log("========================================");
console.log(`Uploaded : ${uploaded}`);
console.log(`Existing : ${existing}`);
console.log(`Skipped  : ${skipped}`);
console.log(`Failed   : ${failed}`);
console.log(
  `Next     : ${checkpoint.nextIndex}/${library.length}`
);
console.log(
  `Failures recorded: ${checkpoint.failed.length}`
);
console.log("========================================");
