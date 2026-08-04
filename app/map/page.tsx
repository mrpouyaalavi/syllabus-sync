// app/map/page.tsx
import { Metadata } from 'next';
import { Suspense } from 'react';
import { BRAND_OG_IMAGE } from '@/lib/brand';
import { APP_CONFIG } from '@/lib/config';
import { getTranslations, type TranslationKey } from '@/lib/i18n/translations';
import MapClient from '@/features/map/components/MapClient';
import { MapPageSkeleton } from '@/features/map/components/MapPageSkeleton';

const translations = getTranslations('en');
const translate = (key: TranslationKey, vars?: Record<string, string | number>) => {
  let text =
    (translations as Record<string, string> | undefined)?.[key] ?? (key as unknown as string);

  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    });
  }

  return text;
};

const mapMetaTitle = translate('mapMetaTitle', { appName: APP_CONFIG.name });
const mapMetaDescription = translate('mapMetaDescription');

export const metadata: Metadata = {
  title: mapMetaTitle,
  description: mapMetaDescription,
  openGraph: {
    title: mapMetaTitle,
    description: mapMetaDescription,
    type: 'website',
    images: [
      {
        url: BRAND_OG_IMAGE,
        alt: translate('mqLogoAlt', { appName: APP_CONFIG.name }),
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    images: [BRAND_OG_IMAGE],
  },
};

export default function MapPage() {
  return (
    <Suspense fallback={<MapPageSkeleton />}>
      <MapClient />
    </Suspense>
  );
}
