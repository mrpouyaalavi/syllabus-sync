// app/home/page.tsx
import { Metadata } from 'next';
import { BRAND_OG_IMAGE } from '@/lib/brand';
import { APP_CONFIG, UNIVERSITY_CONFIG } from '@/lib/config';
import HomeClient from './HomeClient';
import { createServerClient } from '@/lib/supabase/server';
import type { AuthUser } from '@/features/home/types';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Your personalized academic dashboard for Macquarie University. Track classes, deadlines, events, and manage your university schedule in one place.',
  openGraph: {
    title: `Dashboard | ${APP_CONFIG.name} - ${UNIVERSITY_CONFIG.name}`,
    description:
      'Your personalized academic dashboard for Macquarie University. Track classes, deadlines, events, and manage your university schedule in one place.',
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

export default async function HomePage() {
  // Pre-fetch user on server to avoid empty-state flash on client
  let initialUser = null;
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      initialUser = {
        email: data.user.email,
        user_metadata: data.user.user_metadata as AuthUser['user_metadata'],
      };
    }
  } catch {
    // Fall back to client-side auth
  }
  return <HomeClient initialUser={initialUser} />;
}
