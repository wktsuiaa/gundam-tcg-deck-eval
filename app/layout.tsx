import type { Metadata } from 'next';
import { Barlow_Condensed, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Gundam Card Atlas — Official English Card Catalog & Deck Analyzer',
  description:
    'Complete Asia-English Gundam Card Game database, per-print collection tracker, strategy-driven deck builder, 6-axis hexagon analyzer, and matchup playbook.',
  openGraph: {
    title: 'Gundam Card Atlas — Official English Card Catalog & Deck Analyzer',
    description:
      'Complete Asia-English Gundam Card Game database, collection tracker, strategy-driven deck builder, and 6-axis tactical analyzer.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Gundam Card Atlas — Official English Card Catalog & Deck Analyzer',
    description:
      'Complete Asia-English Gundam Card Game database, collection tracker, strategy-driven deck builder, and 6-axis tactical analyzer.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlowCondensed.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        className="min-h-screen bg-[#0B0E14] text-slate-100 font-sans antialiased selection:bg-blue-500/30 selection:text-white"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
