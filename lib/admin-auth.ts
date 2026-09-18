import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE = 'bini_admin_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function adminKey() {
  return process.env.ADMIN_REVIEW_KEY || '';
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || adminKey();
}

export function clientIp(request: NextRequest) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  ).split(',')[0].trim();
}

export function constantTimeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function makeSession() {
  const payload = `${Date.now()}.${randomBytes(24).toString('hex')}`;
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

export function validSession(request: NextRequest) {
  const raw = request.cookies.get(SESSION_COOKIE)?.value || '';
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature || !sessionSecret()) return false;

  let payload = '';
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expected = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  if (!constantTimeEqual(signature, expected)) return false;

  const timestamp = Number(payload.split('.')[0]);
  return Number.isFinite(timestamp)
    && Date.now() >= timestamp
    && Date.now() - timestamp < SESSION_TTL_MS;
}
