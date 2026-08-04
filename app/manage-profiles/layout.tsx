// app/manage-profiles/layout.tsx
import { Metadata } from 'next';
import { BRAND_OG_IMAGE } from '@/lib/brand';
import { APP_CONFIG } from '@/lib/config';

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} - Manage Profiles`,
  description: 'Create, edit, and manage your user profiles for Syllabus Sync.',
  openGraph: {
    title: `${APP_CONFIG.name} - Manage Profiles`,
    description: 'Create, edit, and manage your user profiles for Syllabus Sync.',
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
  robots: {
    index: false,
    follow: false,
  },
};

export default function ManageProfilesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
