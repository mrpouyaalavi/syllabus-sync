// app/feed/page.tsx
import { Metadata } from 'next';
import { Suspense } from 'react';
import { BRAND_OG_IMAGE } from '@/lib/brand';
import { APP_CONFIG } from '@/lib/config';
import PublicFeedClient from '@/features/feed/components/PublicFeedClient';
import { FeedSkeletons } from '@/features/feed/components/FeedSkeletons';

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} - University Events & Announcements`,
  description:
    'Browse university-wide events, announcements, and activities. Add events to your personal calendar to stay organized and never miss what matters.',
  openGraph: {
    title: `${APP_CONFIG.name} - University Events & Announcements`,
    description:
      'Browse university-wide events, announcements, and activities. Add events to your personal calendar to stay organized.',
    type: 'website',
    images: [
      {
        url: BRAND_OG_IMAGE,
        alt: `${APP_CONFIG.name} logo`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [BRAND_OG_IMAGE],
  },
};

// Skeleton loader for feed page
function FeedSkeleton() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <FeedSkeletons />
    </div>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <PublicFeedClient />
    </Suspense>
  );
}
