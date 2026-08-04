/**
 * Registry of the official Syllabus Sync brand assets.
 *
 * Files in `public/brand` are derived from the originals in
 * `assets/brand/source` by `tools/brand/build_brand_assets.py`. Intrinsic
 * dimensions are recorded here so every placement can reserve its box before
 * load, which keeps the logo free of layout shift and distortion.
 *
 * This mirrors the registry in the Syllabus Sync information site so both
 * projects expose the same variant names and brand rules.
 */

export type BrandLogoVariant =
  | 'primary'
  | 'wide'
  | 'wideAlt'
  | 'wordmark'
  | 'wordmarkWide'
  | 'icon'
  | 'iconCloseCrop';

export type BrandAsset = {
  src: string;
  width: number;
  height: number;
  kind: 'lockup' | 'wordmark' | 'logomark';
};

/**
 * `wide` and `wideAlt` intentionally resolve to the same file: the two supplied
 * banner artworks are byte-identical, so shipping both would duplicate an asset.
 * The variant name is kept so callers can still express intent.
 */
export const BRAND_ASSETS: Record<BrandLogoVariant, BrandAsset> = {
  primary: { src: '/brand/logo-primary-horizontal.png', width: 1447, height: 735, kind: 'lockup' },
  wide: { src: '/brand/logo-wide.png', width: 1670, height: 660, kind: 'lockup' },
  wideAlt: { src: '/brand/logo-wide.png', width: 1670, height: 660, kind: 'lockup' },
  wordmark: { src: '/brand/wordmark-standard.png', width: 1244, height: 266, kind: 'wordmark' },
  wordmarkWide: { src: '/brand/wordmark-wide.png', width: 1454, height: 322, kind: 'wordmark' },
  icon: { src: '/brand/logomark-square.png', width: 772, height: 972, kind: 'logomark' },
  iconCloseCrop: { src: '/brand/logomark-close-crop.png', width: 711, height: 936, kind: 'logomark' },
};

/** Opaque social card: the lockup centred on the brand backdrop. */
export const BRAND_OG_IMAGE = '/brand/og-image.png';

/** Warm off-white carried by the artwork; matches the app icon backdrop. */
export const BRAND_BACKDROP = '#f9f0eb';
