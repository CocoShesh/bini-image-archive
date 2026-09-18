import { notFound } from 'next/navigation';
import ReviewStudio from '../../../components/ReviewStudio';

export const dynamic = 'force-dynamic';

export default async function AdminReviewPage({ params }: { params: Promise<{ gate: string }> }) {
  const { gate } = await params;
  const expected = process.env.ADMIN_REVIEW_PATH;
  if (!expected || gate !== expected) notFound();
  return <ReviewStudio />;
}
