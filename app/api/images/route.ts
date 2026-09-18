import { NextRequest, NextResponse } from 'next/server';
import { readLibrary, type ImageRecord, publicImageUrl } from '../../../lib/archive';
import { readModeratedIds } from '../../../lib/moderation';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;
const MEMBERS = ['Aiah', 'Colet', 'Gwen', 'Jhoanna', 'Maloi', 'Mikha', 'Stacey', 'Sheena', 'OT8'];

function groupMatch(image: ImageRecord) {
  return image.member === 'OT8' || /\bot8\b|group photo|all members|bini group|complete group/i.test(`${image.title} ${image.category || ''} ${(image.tags || []).join(' ')}`);
}

function searchable(image: ImageRecord) {
  return [
    image.title, image.member, image.source, image.year, image.pinUrl, image.sourceUrl,
    image.storageKey, image.category, ...(Array.isArray(image.tags) ? image.tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function sortImages(images: ImageRecord[], sort: string) {
  return [...images].sort((a, b) => {
    const av = new Date(a.discoveredAt || 0).getTime();
    const bv = new Date(b.discoveredAt || 0).getTime();
    return sort === 'oldest' ? av - bv : bv - av;
  });
}

function portraitFriendly(image: ImageRecord) {
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  if (!width || !height) return 0;
  const ratio = width / height;
  if (ratio >= 0.55 && ratio <= 0.9) return 30;
  if (ratio >= 0.45 && ratio <= 1.05) return 20;
  if (ratio <= 1.3) return 8;
  return -20;
}

function coverQuality(image: ImageRecord, member: string) {
  const title = `${image.title || ''} ${(image.tags || []).join(' ')} ${image.category || ''}`.toLowerCase();
  const blocked = /(food|recipe|menu|product|poster|flyer|logo|watermark|screenshot|fanart|fan edit|collage|meme|template|text post|quote|album cover|photocard|photocard scan)/i.test(title);
  if (blocked) return -10000;

  const exact = String(image.member || '').toLowerCase() === member.toLowerCase();
  const url = publicImageUrl(image);
  if (!url) return -10000;

  let score = exact ? 1000 : 0;
  score += portraitFriendly(image);
  score += Number(image.bytes || 0) > 250_000 ? 18 : 0;
  score += Number(image.width || 0) >= 900 ? 12 : 0;
  score += Number(image.height || 0) >= 1200 ? 15 : 0;
  score += /(portrait|photoshoot|concept|editorial|magazine|candid|selfie|award|event)/i.test(title) ? 8 : 0;
  score -= /(group|ot8|bini members|all members)/i.test(title) ? 30 : 0;
  return score;
}

function stablePick<T extends ImageRecord>(items: T[], seed: string) {
  if (!items.length) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  const epoch = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  hash = Math.abs(hash + epoch);
  return items[hash % Math.min(items.length, 24)] || items[0];
}

function buildMemberPreviews(visible: ImageRecord[]) {
  const available = visible.filter((image) => publicImageUrl(image));
  const previews: Record<string, string> = {};

  for (const member of MEMBERS) {
    if (member === 'OT8') {
      const candidates = available
        .filter(groupMatch)
        .sort((a, b) => {
          const score = (item: ImageRecord) => {
            const title = `${item.title || ''} ${(item.tags || []).join(' ')} ${item.category || ''}`;
            return (item.width || 0) * (item.height || 0) / 1e6 + (/(group|complete|ot8)/i.test(title) ? 40 : 0);
          };
          return score(b) - score(a);
        });
      const pick = stablePick(candidates, member);
      previews[member] = pick ? publicImageUrl(pick) : '';
      continue;
    }

    const candidates = available
      .filter((image) => String(image.member || '').toLowerCase() === member.toLowerCase())
      .map((image) => ({ image, score: coverQuality(image, member) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.image);

    const pick = stablePick(candidates, member);
    previews[member] = pick ? publicImageUrl(pick) : '';
  }

  return previews;
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
  const moderated = await readModeratedIds();
  const visible = all.filter((image) => !moderated.has(String(image.id)));
  let filtered = visible;

  if (q) filtered = filtered.filter((image) => searchable(image).includes(q));
  if (member !== 'All') filtered = filtered.filter((image) => image.member === member || (member === 'OT8' && groupMatch(image)));
  if (year !== 'All') filtered = filtered.filter((image) => String(image.year || '') === year);

  filtered = sortImages(filtered, sort);

  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  const years = Array.from(new Set(visible.map((image) => image.year).filter((value) => value !== null && value !== undefined).map(Number))).sort((a, b) => b - a);
  const stats = {
    total: visible.length,
    members: 9,
    sources: new Set(visible.map((image) => image.source).filter(Boolean)).size,
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
    memberPreviews: buildMemberPreviews(visible),
  });
  response.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  return response;
}
