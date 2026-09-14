import fs from 'node:fs/promises';
import path from 'node:path';

export type ImageRecord = {
  id: string;
  title: string;
  member: string;
  year: number | null;
  source: string;
  pinUrl?: string;
  sourceUrl?: string;
  imageUrl: string;
  localPath?: string;
  src?: string;
  storageKey?: string;
  storageUrl?: string;
  category?: string;
  tags?: string[];
  width: number | null;
  height: number | null;
  bytes: number;
  originalBytes?: number;
  sha256: string;
  discoveredAt: string;
};

const file = path.join(process.cwd(), 'data', 'library.json');

export async function readLibrary(): Promise<ImageRecord[]> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as ImageRecord[];
  } catch {
    return [];
  }
}

export async function writeLibrary(items: ImageRecord[]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(items, null, 2) + '\n', 'utf8');
}

export function publicImageUrl(image: ImageRecord) {
  return image.storageUrl || image.localPath || image.src || image.imageUrl;
}
