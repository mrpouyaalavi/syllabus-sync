import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import ClientLayout from './client-layout';
import QueryProvider from '@/components/providers/QueryProvider';
import { BRAND_OG_IMAGE } from '@/lib/brand';
import { APP_CONFIG, UNIVERSITY_CONFIG } from '@/lib/config';
import { THEME_SCRIPT, RTL_SCRIPT } from '@/lib/security/csp';

export const metadata: Metadata = {
  title: {
    default: APP_CONFIG.name,
    template: `%s | ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.fullDescription,
  applicationName: APP_CONFIG.name,
  // Must be this app's own origin. It previously pointed at the university
  // website, which made every relative metadata URL (including the brand logo)
  // resolve to a domain we do not control and that does not host these assets.
  metadataBase: new URL(APP_CONFIG.url),
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: APP_CONFIG.name,
    statusBarStyle: 'default',
  },
  openGraph: {
    title: `${APP_CONFIG.name} - ${UNIVERSITY_CONFIG.name}`,
    description: APP_CONFIG.fullDescription,
    type: 'website',
    images: [
      {
        url: BRAND_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: APP_CONFIG.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [BRAND_OG_IMAGE],
  },
  icons: {
    // No `icon` entry here on purpose. `app/favicon.ico` is already picked up
    // by Next's file-convention icon handling, which emits its own
    // <link rel="icon"> with a content-hash query string
    // (e.g. /favicon.ico?3651fd3d2869c254) that changes whenever the file's
    // bytes change — the browser treats it as a new resource automatically.
    // Declaring `icon: '/favicon.ico'` here duplicated that with a second,
    // un-hashed <link rel="icon" href="/favicon.ico"> tag, and browsers don't
    // consistently prefer one over the other. That static URL is exactly the
    // one vulnerable to the stale-favicon caching bug fixed in public/sw.js —
    // removing the duplicate leaves Next's self-invalidating link as the only
    // favicon declaration.
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'var(--mq-background)' },
    { media: '(prefers-color-scheme: dark)', color: 'var(--mq-background)' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? '';

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: APP_CONFIG.name,
    // The organisation described here is Syllabus Sync, so both the URL and the
    // logo must resolve against this app's own origin rather than the
    // university's website.
    url: APP_CONFIG.url,
    logo: new URL('/icons/icon-512.png', APP_CONFIG.url).toString(),
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          key="theme-script"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        <script key="rtl-script" nonce={nonce} dangerouslySetInnerHTML={{ __html: RTL_SCRIPT }} />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema),
          }}
        />
        <QueryProvider>
          <ClientLayout>{children}</ClientLayout>
        </QueryProvider>
      </body>
    </html>
  );
}
