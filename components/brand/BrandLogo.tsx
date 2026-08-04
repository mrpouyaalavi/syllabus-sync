import Image from 'next/image';

import { BRAND_ASSETS, BRAND_BACKDROP, type BrandLogoVariant } from '@/lib/brand';
import { APP_CONFIG } from '@/lib/config';

type BrandLogoProps = {
  /** Which official artwork to render. */
  variant?: BrandLogoVariant;
  /**
   * Rendered height in CSS pixels. The width is derived from the artwork's
   * intrinsic ratio so the logo can never be stretched. Utility classes may
   * override the height responsively via `className`; because the width/height
   * attributes stay in the artwork's own ratio, the box remains correct.
   */
  height?: number;
  /**
   * Decorative placements — for example a logo sitting beside the visible
   * product name, or inside a link that already has an accessible label —
   * render with an empty alt so the brand is not announced twice.
   */
  decorative?: boolean;
  /** Overrides the default "Syllabus Sync" alt text. */
  alt?: string;
  /** Set only on above-the-fold logos. */
  priority?: boolean;
  loading?: 'eager' | 'lazy';
  sizes?: string;
  className?: string;
  /**
   * Renders the artwork on the warm brand backdrop instead of transparently.
   *
   * Required on the app's dark surfaces. The white space threading between the
   * lion and the dragon is negative space in the supplied artwork — it is the
   * background showing through — so on a dark panel the two halves merge and
   * the mark loses its shape. The navy wordmark is likewise unreadable there.
   * Compositing over the backdrop restores the artwork exactly as supplied,
   * without altering a single pixel of it.
   */
  tile?: boolean;
  /** Corner radius utility for the tile; ignored when `tile` is false. */
  tileClassName?: string;
};

/**
 * Single entry point for rendering the Syllabus Sync identity in the app.
 *
 * Placements should go through this component rather than raw <Image> tags so
 * asset paths, intrinsic ratios and alt-text conventions stay in one place.
 * The API matches the information site's `BrandLogo` so both projects follow
 * the same brand rules.
 */
export function BrandLogo({
  variant = 'icon',
  height = 40,
  decorative = false,
  alt,
  priority = false,
  loading,
  sizes,
  className,
  tile = false,
  tileClassName = 'rounded-2xl p-1.5',
}: BrandLogoProps) {
  const asset = BRAND_ASSETS[variant];
  const width = Math.round((height * asset.width) / asset.height);

  const image = (
    <Image
      alt={decorative ? '' : (alt ?? APP_CONFIG.name)}
      className={className ? `object-contain ${className}` : 'object-contain'}
      height={height}
      // `priority` already implies eager loading; passing both is invalid.
      {...(priority ? { priority: true } : { loading: loading ?? 'lazy' })}
      sizes={sizes}
      src={asset.src}
      width={width}
    />
  );

  if (!tile) return image;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${tileClassName}`}
      style={{ backgroundColor: BRAND_BACKDROP }}
    >
      {image}
    </span>
  );
}

export default BrandLogo;
