import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BINI Image Archive',
  description: 'Automatic public-source image archive for BINI.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
