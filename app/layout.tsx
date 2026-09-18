import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://bini-image-archive.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'BINI Image Archive', template: '%s · BINI Image Archive' },
  description: 'A searchable, progressively loaded public image archive for BINI.',
  applicationName: 'BINI Image Archive',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'BINI Image Archive',
    description: 'Browse BINI moments by member, year, source, and keyword.',
    type: 'website',
    url: '/',
  },
  twitter: { card: 'summary_large_image', title: 'BINI Image Archive', description: 'Browse BINI moments by member, year, source, and keyword.' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
