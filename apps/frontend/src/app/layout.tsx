import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import './global.css';

export const metadata: Metadata = {
  title: 'Multizoo Ledger',
  description: 'Multizoo Group Ledger Platform',
};

// Same loading pattern as EPCCRM's frontend (next/font/google, a single
// display face applied via a CSS variable on <body>) — Nunito, the same
// face, since typography is a technical-approach choice here, not a
// brand-identity one the way colour is.
const nunito = Nunito({
  style: ['normal'],
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-nunito',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${nunito.variable} min-h-dvh`}>{children}</body>
    </html>
  );
}
