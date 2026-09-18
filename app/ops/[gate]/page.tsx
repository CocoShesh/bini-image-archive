import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminGate({ params }: { params: Promise<{ gate: string }> }) {
  const { gate } = await params;
  const expected = process.env.ADMIN_REVIEW_PATH;
  if (!expected || gate !== expected) notFound();
  redirect(`/ops/${gate}/dashboard`);
}
