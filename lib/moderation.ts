import { readLibrary } from './archive';
import { readState, writeState } from './r2-state';

export type ManualModeration = {
  status: 'review' | 'accept' | 'reject';
  previousStatus?: string;
  reviewedAt: string;
  source?: 'admin' | 'report';
};

type ModerationMap = Record<string, ManualModeration>;

export async function readModeration() {
  return readState<ModerationMap>('manual-moderation.json', {});
}

export async function writeModeration(value: ModerationMap) {
  return writeState('manual-moderation.json', value);
}

export async function readModeratedIds() {
  const map = await readModeration();
  return new Set(Object.entries(map).filter(([, value]) => value.status === 'reject').map(([id]) => id));
}

export async function hideImages(ids: string[], source: 'admin' | 'report' = 'report') {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return { changed: 0, moderation: await readModeration() };

  const library = await readLibrary();
  const validIds = new Set(library.map((item) => String(item.id)));
  const moderation = await readModeration();
  let changed = 0;

  for (const id of unique) {
    if (!validIds.has(id)) continue;
    if (moderation[id]?.status === 'reject') continue;
    moderation[id] = {
      ...(moderation[id] || {}),
      previousStatus: moderation[id]?.status || 'review',
      status: 'reject',
      reviewedAt: new Date().toISOString(),
      source,
    };
    changed += 1;
  }

  if (changed) await writeModeration(moderation);
  return { changed, moderation };
}

export async function setModerationStatus(ids: string[], status: 'review' | 'accept' | 'reject', source: 'admin' | 'report' = 'admin') {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  const library = await readLibrary();
  const validIds = new Set(library.map((item) => String(item.id)));
  const moderation = await readModeration();
  let changed = 0;

  for (const id of unique) {
    if (!validIds.has(id)) continue;
    const previous = moderation[id]?.status;
    if (previous === status) continue;
    moderation[id] = {
      ...(moderation[id] || {}),
      previousStatus: previous || 'review',
      status,
      reviewedAt: new Date().toISOString(),
      source,
    };
    changed += 1;
  }

  if (changed) await writeModeration(moderation);
  return { changed, moderation };
}

export async function restoreModeration(ids: string[]) {
  const moderation = await readModeration();
  let changed = 0;
  for (const id of new Set(ids.map(String))) {
    if (!moderation[id]) continue;
    delete moderation[id];
    changed += 1;
  }
  if (changed) await writeModeration(moderation);
  return { changed, moderation };
}
