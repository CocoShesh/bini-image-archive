import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { analyzeImage } from './vision-provider.mjs';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const ANALYSIS_DIR = path.join(DATA_DIR, 'analysis');
const RESULTS_FILE = path.join(ANALYSIS_DIR, 'results.json');
const STATE_FILE = path.join(ANALYSIS_DIR, 'state.json');
const REPORT_FILE = path.join(ANALYSIS_DIR, 'report.json');
const LIMIT = Number(process.env.ANALYZE_LIMIT || 250);
const FORCE = /^(1|true|yes)$/i.test(process.env.ANALYZE_FORCE || 'false');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function hash(value) { return crypto.createHash('sha1').update(value).digest('hex'); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function relevanceScore(record, analysis) {
  let score = 35;
  const query = `${record?.title || ''} ${(record?.tags || []).join(' ')}`.toLowerCase();

  if (/\bbini\b/.test(query)) score += 20;
  if (/aiah|colet|gwen|jhoanna|maloi|mikha|stacey|sheena/.test(query)) score += 18;
  if (analysis.signals.hasPeopleHint) score += 12;
  if (analysis.signals.likelyPersonContext) score += 8;

  // Conservative penalty for object-only discovery is applied later by a real
  // vision provider. The starter stage intentionally does not reject images
  // simply because a microphone/camera/object might be present.
  if (!record?.imageUrl && !record?.storageUrl && !record?.localPath) score -= 35;

  return clamp(Math.round(score), 0, 100);
}

function statusForScore(score) {
  if (score >= 82) return 'accepted';
  if (score >= 55) return 'review';
  return 'rejected';
}

function descriptionFor(record, analysis) {
  const memberNames = analysis.members.map((m) => m.name).filter(Boolean);
  const parts = [];
  if (memberNames.length) parts.push(`Photo featuring ${memberNames.join(', ')}`);
  else if (analysis.peopleCount) parts.push(`Photo containing ${analysis.peopleCount} detected people`);
  else parts.push('Image discovered in the BINI archive');
  if (analysis.scene) parts.push(`context: ${analysis.scene.toLowerCase()}`);
  if (record?.year) parts.push(`year: ${record.year}`);
  if (record?.category) parts.push(`category: ${record.category}`);
  return parts.join('; ') + '.';
}

async function resolveImage(record) {
  if (record?.localPath) {
    const local = path.join(ROOT, 'public', record.localPath.replace(/^\//, ''));
    try { return await fs.readFile(local); } catch {}
  }
  if (record?.storageUrl) {
    const response = await fetch(record.storageUrl, { headers: { 'User-Agent': 'BINI-Archive-Analyzer/1.0' } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  }
  if (record?.imageUrl) {
    const response = await fetch(record.imageUrl, { headers: { 'User-Agent': 'BINI-Archive-Analyzer/1.0' } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('No readable image source');
}

async function main() {
  await fs.mkdir(ANALYSIS_DIR, { recursive: true });
  const library = await readJson(LIBRARY_FILE, []);
  const results = await readJson(RESULTS_FILE, {});
  const state = await readJson(STATE_FILE, { version: 1, processed: 0, failed: 0, cursor: 0 });

  let processedThisRun = 0;
  let failedThisRun = 0;
  let cursor = Number.isInteger(state.cursor) ? state.cursor : 0;

  for (; cursor < library.length && processedThisRun < LIMIT; cursor++) {
    const record = library[cursor];
    if (!record?.id) continue;
    if (results[record.id] && !FORCE) continue;

    try {
      const image = await resolveImage(record);
      const meta = await sharp(image, { failOn: 'none' }).metadata();
      const analysis = await analyzeImage({ imageBuffer: image, record });
      const relevance = relevanceScore(record, analysis);
      const status = statusForScore(relevance);

      results[record.id] = {
        version: 1,
        imageId: record.id,
        sha256: record.sha256 || null,
        analyzedAt: new Date().toISOString(),
        dimensions: { width: meta.width || null, height: meta.height || null },
        format: meta.format || null,
        megapixels: meta.width && meta.height ? Number(((meta.width * meta.height) / 1e6).toFixed(2)) : null,
        relevance: {
          score: relevance,
          status,
          reasons: [
            record?.member ? 'query-member hint' : null,
            record?.category ? `category=${record.category}` : null,
            analysis.signals.hasPeopleHint ? 'people/member keyword signal' : null,
          ].filter(Boolean),
        },
        people: {
          count: analysis.peopleCount,
          unknownCount: analysis.unknownPeopleCount,
          faces: analysis.faces,
          members: analysis.members,
        },
        visual: {
          scene: analysis.scene,
          activity: analysis.activity,
          shotType: analysis.shotType,
          expression: analysis.expression,
          pose: analysis.pose,
          clothing: analysis.clothing,
          objects: analysis.objects,
          colors: analysis.colors,
        },
        description: descriptionFor(record, analysis),
        provider: analysis.provider,
        review: { status, locked: false, notes: '' },
        fingerprint: hash(`${record.sha256 || record.id}|${meta.width || 0}|${meta.height || 0}`),
      };
      processedThisRun++;
      console.log(`[ANALYZE] ${processedThisRun}/${LIMIT} ${record.id} → ${status} (${relevance})`);
    } catch (error) {
      failedThisRun++;
      results[record.id] = {
        version: 1,
        imageId: record.id,
        analyzedAt: new Date().toISOString(),
        relevance: { score: 0, status: 'review', reasons: ['analysis failed'] },
        review: { status: 'review', locked: false, notes: error.message },
        error: error.message,
      };
      console.log(`[FAILED] ${record.id} → ${error.message}`);
    }
  }

  const nextCursor = cursor >= library.length ? 0 : cursor;
  const report = {
    updatedAt: new Date().toISOString(),
    librarySize: library.length,
    analyzed: Object.keys(results).length,
    pending: Math.max(0, library.length - Object.keys(results).length),
    accepted: Object.values(results).filter((x) => x?.review?.status === 'accepted').length,
    review: Object.values(results).filter((x) => x?.review?.status === 'review').length,
    rejected: Object.values(results).filter((x) => x?.review?.status === 'rejected').length,
    failedThisRun,
    processedThisRun,
  };

  await writeJson(RESULTS_FILE, results);
  await writeJson(STATE_FILE, { version: 1, cursor: nextCursor, lastRunAt: new Date().toISOString(), processed: report.analyzed, failed: failedThisRun });
  await writeJson(REPORT_FILE, report);

  console.log('--- BINI INTELLIGENCE BATCH COMPLETE ---');
  console.log(`Library : ${report.librarySize}`);
  console.log(`Analyzed: ${report.analyzed}`);
  console.log(`Pending : ${report.pending}`);
  console.log(`Accept  : ${report.accepted}`);
  console.log(`Review  : ${report.review}`);
  console.log(`Reject  : ${report.rejected}`);
  console.log(`Failed  : ${report.failedThisRun}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
