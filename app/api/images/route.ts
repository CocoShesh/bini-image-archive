import { NextRequest, NextResponse } from 'next/server';
import { readLibrary, type ImageRecord } from '../../../lib/archive';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;

function groupMatch(image: ImageRecord) {
  return image.member === 'OT8' || /\bot8\b|group photo|all members|bini group/i.test(`${image.title} ${(image as any).category || ''}`);
}

function searchable(image: ImageRecord) {
  return [
    image.title,
    image.member,
    image.source,
    image.year,
    image.pinUrl,
    image.sourceUrl,
    image.storageKey,
    (image as any).category,
    ...(Array.isArray((image as any).tags) ? (image as any).tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function sortImages(images: ImageRecord[], sort: string) {
  return [...images].sort((a, b) => {
    if (sort === 'oldest') {
      return new Date(a.discoveredAt || 0).getTime() - new Date(b.discoveredAt || 0).getTime();
    }
    return new Date(b.discoveredAt || 0).getTime() - new Date(a.discoveredAt || 0).getTime();
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get('page') || 1));
  const limit = Math.min(MAX_LIMIT, Math.max(12, Number(params.get('limit') || DEFAULT_LIMIT)));
  const q = (params.get('q') || '').trim().toLowerCase();
  const member = params.get('member') || 'All';
  const year = params.get('year') || 'All';
  const sort = params.get('sort') || 'newest';

  const all = await readLibrary();
  let filtered = all;

  if (q) filtered = filtered.filter((image) => searchable(image).includes(q));
  if (member !== 'All') filtered = filtered.filter((image) => image.member === member || (member === 'OT8' && groupMatch(image)));
  if (year !== 'All') filtered = filtered.filter((image) => String(image.year || '') === year);

  filtered = sortImages(filtered, sort);

  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  const years = Array.from(new Set(all.map((image) => image.year).filter((value): value is number => Boolean(value)))).sort((a, b) => b - a);
  const stats = {
    total: all.length,
    members: 9,
    sources: new Set(all.map((image) => image.source).filter(Boolean)).size,
    years: years.length,
  };

  const response = NextResponse.json({
    items,
    page,
    limit,
    total: filtered.length,
    hasMore: start + items.length < filtered.length,
    stats,
    years,
  });
  response.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  return response;
}
