import { notFound } from 'next/navigation';
import AdminControlCenter from '../../../components/AdminControlCenter';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage({ params }: { params: Promise<{ gate: string }> }) {
  const { gate } = await params;
  const expected = process.env.ADMIN_REVIEW_PATH;
  if (!expected || gate !== expected) notFound();
  return <AdminControlCenter gate={gate} />;
}
