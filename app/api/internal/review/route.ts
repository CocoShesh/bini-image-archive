import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { clientIp, SESSION_COOKIE, adminKey, constantTimeEqual, makeSession, validSession } from '../../../../lib/admin-auth';
import { readLibrary } from '../../../../lib/archive';
import { R2_ENABLED, readState } from '../../../../lib/r2-state';
import { readModeration, restoreModeration, setModerationStatus } from '../../../../lib/moderation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RESULT_FILES = [
  path.join(process.cwd(), 'data', 'analysis', 'cpu-results.json'),
  path.join(process.cwd(), 'data', 'cpu-results.json'),
];
const ANALYZER_CHECKPOINT = path.join(process.cwd(), 'data', 'analysis', 'cpu-checkpoint.json');
const LIBRARY_FILE = path.join(process.cwd(), 'data', 'library.json');
const MAX_PAGE = 100;
const loginAttempts = new Map<string, { failures: number; resetAt: number }>();

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function readAnalyzer() {
  for (const file of RESULT_FILES) {
    const value = await readJson<any>(file, null);
    if (value) {
      if (Array.isArray(value)) return value;
      if (Array.isArray(value.items)) return value.items;
      if (Array.isArray(value.results)) return value.results;
      if (Array.isArray(value.data)) return value.data;
    }
  }
  return [];
}

type AnyRecord = Record<string, any>;

function timestamp(item: AnyRecord) {
  for (const key of ['discoveredAt', 'addedAt', 'crawledAt', 'createdAt', 'indexedAt', 'foundAt', 'analyzedAt']) {
    const value = item[key];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function buildLibraryIndex(library: AnyRecord[]) {
  const index = new Map<string, AnyRecord>();
  for (const record of library) {
    for (const key of [record.id, record.sha256, record.storageKey, record.src, record.imageUrl, record.storageUrl]) {
      if (key) index.set(String(key), record);
    }
  }
  return index;
}

function enrich(item: AnyRecord, libraryIndex: Map<string, AnyRecord>) {
  const merged = { ...item };
  const candidates = [item.id, item.sha256, item.storageKey, item.imageUrl, item.src, item.filePath].filter(Boolean).map(String);
  const library = candidates.map((key) => libraryIndex.get(key)).find(Boolean);
  if (library) {
    for (const key of ['id', 'title', 'member', 'category', 'tags', 'pinUrl', 'sourceUrl', 'storageKey', 'storageUrl', 'imageUrl', 'src', 'localPath', 'discoveredAt', 'source', 'query', 'width', 'height', 'bytes', 'year']) {
      if (merged[key] == null && library[key] != null) merged[key] = library[key];
    }
  }
  merged._timestamp = timestamp(merged);
  return merged;
}

async function loadItems(): Promise<AnyRecord[]> {
  const [raw, library, moderation] = await Promise.all([readAnalyzer(), readLibrary(), readModeration()]);
  const index = buildLibraryIndex(library);
  return raw.map((item: AnyRecord) => {
    const merged = enrich(item, index);
    const id = String(merged.id || merged.sha256 || merged.storageKey || merged.src || merged.imageUrl || '');
    const override = moderation[id];
    const analyzerStatus = ['accept', 'review', 'reject'].includes(String(merged.status)) ? String(merged.status) : 'review';
    const status = override?.status || analyzerStatus;
    return {
      ...merged,
      id: id || merged.id,
      status,
      manualReview: override || merged.manualReview,
      _isNew: !override && !merged.manualReview,
    };
  }).filter((item: AnyRecord) => item.id);
}

function applyFilters(items: AnyRecord[], params: URLSearchParams) {
  const mode = params.get('mode') || 'queue';
  const q = (params.get('q') || '').trim().toLowerCase();
  const member = (params.get('member') || 'All').trim().toLowerCase();
  const priority = params.get('priority') || 'newest';
  const newOnly = params.get('newOnly') === '1';
  const noMember = params.get('noMember') === '1';

  let result = items.filter((item) => {
    const status = String(item.status);
    if (mode === 'queue' && status !== 'review') return false;
    if (mode === 'accept' && status !== 'accept') return false;
    if (mode === 'reject' && status !== 'reject') return false;
    if (mode === 'all' && !['accept', 'review', 'reject'].includes(status)) return false;
    if (newOnly && item.manualReview) return false;

    const itemMember = String(item.member || item.member_hint || '').toLowerCase();
    if (member !== 'all' && !itemMember.includes(member)) return false;
    if (noMember && itemMember) return false;

    if (q) {
      const haystack = [
        item.id, item.query, item.title, item.member, item.member_hint, item.category,
        item.source, item.pinUrl, item.sourceUrl,
        ...(Array.isArray(item.reasons) ? item.reasons : []),
        ...(Array.isArray(item.context?.memberHits) ? item.context.memberHits : []),
        ...(Array.isArray(item.context?.groupHits) ? item.context.groupHits : []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  result.sort((a, b) => {
    if (priority === 'score-asc') return Number(a.score || 0) - Number(b.score || 0);
    if (priority === 'score-desc') return Number(b.score || 0) - Number(a.score || 0);
    return Number(b._timestamp || 0) - Number(a._timestamp || 0);
  });
  return result;
}

export async function GET(request: NextRequest) {
  if (!validSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawItems = await loadItems();
  const filtered = applyFilters(rawItems, request.nextUrl.searchParams);
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || 1));
  const pageSize = Math.min(MAX_PAGE, Math.max(12, Number(request.nextUrl.searchParams.get('limit') || 60)));
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  const counts = {
    total: rawItems.length,
    accept: rawItems.filter((item) => item.status === 'accept').length,
    review: rawItems.filter((item) => item.status === 'review').length,
    reject: rawItems.filter((item) => item.status === 'reject').length,
    new: rawItems.filter((item) => item.status === 'review' && !item.manualReview).length,
    noMember: rawItems.filter((item) => item.status === 'review' && !String(item.member || item.member_hint || '').trim()).length,
    discoveredToday: rawItems.filter((item) => {
      const d = new Date(item._timestamp || 0);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length,
  };

  const [library, analyzer, crawler, recentActivity, libraryStat] = await Promise.all([
    readLibrary(),
    readJson<any>(ANALYZER_CHECKPOINT, null),
    readState<any>('crawl-checkpoint.json', null),
    readState<any[]>('admin-activity.json', []),
    fs.stat(LIBRARY_FILE).catch(() => null),
  ]);

  const stats = {
    libraryCount: Array.isArray(library) ? library.length : 0,
    libraryUpdatedAt: libraryStat?.mtime?.toISOString() || null,
    libraryBytes: libraryStat?.size || null,
    crawler: crawler || null,
    analyzer: analyzer || null,
    storageObjects: null,
    missingImages: null,
    duplicateGroups: null,
    duplicatePairs: null,
    recentActivity: Array.isArray(recentActivity) ? recentActivity.slice(0, 50) : [],
  };

  return NextResponse.json({
    items,
    page,
    limit: pageSize,
    total: filtered.length,
    hasMore: start + items.length < filtered.length,
    counts,
    stats,
    session: true,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const ip = clientIp(request);

  if (action === 'login') {
    const key = String(body.key || '');
    const now = Date.now();
    const attempt = loginAttempts.get(ip);
    if (attempt && now < attempt.resetAt && attempt.failures >= 8) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }
    if (!adminKey() || key.length === 0 || !constantTimeEqual(key, adminKey())) {
      const next = !attempt || now >= attempt.resetAt ? { failures: 1, resetAt: now + 10 * 60 * 1000 } : { failures: attempt.failures + 1, resetAt: attempt.resetAt };
      loginAttempts.set(ip, next);
      return NextResponse.json({ error: 'Invalid admin key.' }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE,
      value: makeSession(),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60,
    });
    return response;
  }

  if (action === 'logout') {
    const response = NextResponse.json({ ok: true });
    response.cookies.set({ name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return response;
  }

  if (!validSession(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!R2_ENABLED) return NextResponse.json({ error: 'R2 moderation storage is not configured.' }, { status: 503 });

  const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).map((value: unknown) => String(value)).filter(Boolean))) as string[];
  if (action === 'label') {
    const status = String(body.status || '') as 'accept' | 'review' | 'reject';
    if (!['accept', 'review', 'reject'].includes(status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    if (!ids.length) return NextResponse.json({ error: 'No ids supplied.' }, { status: 400 });
    const result = await setModerationStatus(ids, status, 'admin');
    return NextResponse.json({ ok: true, changed: result.changed, status });
  }

  if (action === 'undo') {
    if (!ids.length) return NextResponse.json({ error: 'No ids supplied.' }, { status: 400 });
    const result = await restoreModeration(ids);
    return NextResponse.json({ ok: true, changed: result.changed });
  }

  return NextResponse.json({ error: `Unknown action: ${action || 'empty'}` }, { status: 400 });
}
