import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readLibrary } from '../../../lib/archive';
import { R2_ENABLED, readState, writeState } from '../../../lib/r2-state';
import type { ImageReport, ReportReason } from '../../../lib/reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_REPORTS = 5000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();
const reasons = new Set<ReportReason>(['unrelated', 'wrong-member', 'duplicate', 'low-quality', 'wrong-content', 'other']);

function clientIp(request: NextRequest) {
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

function hashIp(value: string) {
  return createHash('sha256').update(`${process.env.REPORTS_IP_SALT || 'bini-report-salt'}:${value}`).digest('hex').slice(0, 24);
}

async function readReports() {
  return readState<ImageReport[]>('image-reports.json', []);
}

async function writeReports(reports: ImageReport[]) {
  const trimmed = reports.slice(-MAX_REPORTS);
  return writeState('image-reports.json', trimmed);
}

export async function POST(request: NextRequest) {
  if (!R2_ENABLED) return NextResponse.json({ error: 'Reports storage is not configured.' }, { status: 503 });
  const ip = clientIp(request);
  const now = Date.now();
  const attempt = attempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    if (attempt.count >= MAX_PER_WINDOW) {
      return NextResponse.json({ error: 'Too many reports. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((attempt.resetAt - now) / 1000)) } });
    }
    attempt.count += 1;
  }

  let body: Partial<ImageReport>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const imageId = String(body.imageId || '').trim();
  const reason = String(body.reason || '') as ReportReason;
  const note = String(body.note || '').trim().slice(0, 500);
  if (!imageId) return NextResponse.json({ error: 'Image id is required.' }, { status: 400 });
  if (!reasons.has(reason)) return NextResponse.json({ error: 'Invalid report reason.' }, { status: 400 });

  const library = await readLibrary();
  if (!library.some((image) => String(image.id) === imageId)) {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }

  const reports = await readReports();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const duplicate = reports.find((report) => report.imageId === imageId && report.reason === reason && report.status === 'pending' && Date.parse(report.createdAt) >= cutoff);
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true, reportId: duplicate.id });

  const report: ImageReport = {
    id: randomUUID(),
    imageId,
    reason,
    note,
    createdAt: new Date(now).toISOString(),
    status: 'pending',
    ipHash: hashIp(ip),
  };

  await writeReports([...reports, report]);
  return NextResponse.json({ ok: true, reportId: report.id }, { status: 201 });
}
