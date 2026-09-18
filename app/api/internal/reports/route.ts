import { NextRequest, NextResponse } from 'next/server';
import { validSession } from '../../../../lib/admin-auth';
import { R2_ENABLED, readState, writeState } from '../../../../lib/r2-state';
import { readLibrary } from '../../../../lib/archive';
import { hideImages, setModerationStatus } from '../../../../lib/moderation';
import type { ImageReport } from '../../../../lib/reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function readReports() {
  return readState<ImageReport[]>('image-reports.json', []);
}

async function writeReports(reports: ImageReport[]) {
  return writeState('image-reports.json', reports.slice(-5000));
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!validSession(request)) return unauthorized();
  const status = request.nextUrl.searchParams.get('status') || 'pending';
  const [reports, library] = await Promise.all([readReports(), readLibrary()]);
  const byId = new Map(library.map((image) => [String(image.id), image]));
  const filtered = reports
    .filter((report) => status === 'all' ? true : report.status === status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((report) => ({ ...report, image: byId.get(String(report.imageId)) || null }));
  return NextResponse.json({ reports: filtered });
}

export async function POST(request: NextRequest) {
  if (!validSession(request)) return unauthorized();
  if (!R2_ENABLED) return NextResponse.json({ error: 'Reports storage is not configured.' }, { status: 503 });

  let body: { action?: string; reportId?: string; ids?: string[]; imageId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const action = String(body.action || '');
  const reports = await readReports();

  if (action === 'resolve') {
    const reportId = String(body.reportId || '');
    const report = reports.find((item) => item.id === reportId);
    if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const resolution = String((body as any).resolution || 'dismiss');
    if (!['reject', 'dismiss'].includes(resolution)) return NextResponse.json({ error: 'Invalid resolution.' }, { status: 400 });

    if (resolution === 'reject') {
      await hideImages([report.imageId], 'report');
    }
    report.status = resolution === 'reject' ? 'rejected' : 'dismissed';
    await writeReports(reports);
    return NextResponse.json({ ok: true, status: report.status });
  }

  if (action === 'bulk-reject') {
    const ids = [...new Set([
      ...(Array.isArray(body.ids) ? body.ids : []),
      ...(body.imageId ? [body.imageId] : []),
    ].map(String).filter(Boolean))];

    const pendingReports = reports.filter((report) => report.status === 'pending' && (ids.length ? ids.includes(report.imageId) : true));
    const imageIds = [...new Set(pendingReports.map((report) => report.imageId))];
    if (!imageIds.length) return NextResponse.json({ ok: true, changed: 0 });

    const hidden = await hideImages(imageIds, 'report');
    for (const report of reports) {
      if (report.status === 'pending' && imageIds.includes(report.imageId)) report.status = 'rejected';
    }
    await writeReports(reports);
    return NextResponse.json({ ok: true, changed: hidden.changed, imageIds });
  }

  if (action === 'restore') {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : [body.imageId]).filter(Boolean).map(String))];
    if (!ids.length) return NextResponse.json({ error: 'No image ids supplied.' }, { status: 400 });
    const result = await setModerationStatus(ids, 'review', 'admin');
    return NextResponse.json({ ok: true, changed: result.changed });
  }

  return NextResponse.json({ error: `Unknown action: ${action || 'empty'}` }, { status: 400 });
}
