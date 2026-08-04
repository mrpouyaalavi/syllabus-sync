import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

const isProduction = process.env.NODE_ENV === 'production';
// SECURITY: Gate Sentry on DSN (runtime error capture), not AUTH_TOKEN (source map upload only)
const sentryEnabled = isProduction && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

const nextConfig: NextConfig = {
  /* config options here */

  // Output standalone build for Docker deployment
  output: 'standalone',

  // SECURITY: Disable X-Powered-By header to reduce information disclosure
  poweredByHeader: false,

  // Enable experimental features for better performance
  experimental: {
    optimizePackageImports: [
      '@radix-ui/react-dialog',
      '@radix-ui/react-toast',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      'date-fns',
      'lucide-react',
      'framer-motion',
    ],
  },
  modularizeImports: {
    'date-fns': {
      transform: 'date-fns/{{member}}',
    },
  },

  // Turbopack config - acknowledged but webpack is used by default due to Sentry compatibility
  turbopack: {},

  // Webpack config for chunk splitting (default bundler since Turbopack has symlink issues with Sentry)
  webpack: (config, { isServer }) => {
    if (!sentryEnabled) {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        '@sentry/nextjs': false,
      };
    }

    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization?.splitChunks,
          cacheGroups: {
            // Keep Next.js default splitting intact — only add framework chunk
            framework: {
              chunks: 'all',
              name: 'framework',
              test: /(?<!node_modules.*)[\/]node_modules[\/](react|react-dom|scheduler|prop-types|use-subscription)[\/]/,
              priority: 40,
              enforce: true,
            },
          },
        },
      };
    }
    return config;
  },

  // Optimize images
  images: {
    formats: ['image/webp', 'image/avif'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Enable compression
  compress: true,

  // NOTE: security headers are intentionally NOT declared here.
  //
  // A `headers()` rule needs a `source` pattern, and a catch-all is impossible
  // to express compatibly: Next accepts '/(.*)' and '/:path*' but rejects
  // '/*path', while the OpenNext router's path-to-regexp v8 rejects exactly the
  // first two. Any catch-all therefore threw on every matching request and
  // produced a site-wide 500 under Cloudflare.
  //
  // Security headers now live in lib/proxy.ts (applied to every rendered
  // response) and in public/_headers (applied to static assets by Cloudflare).
};

const sentryOptions = {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only upload source maps in CI or production builds
  silent: !process.env.CI,
  // Upload source maps to Sentry for better debugging
  widenClientFileUpload: true,
  // Automatically annotate React components to show their names in Sentry
  reactComponentAnnotation: {
    enabled: sentryEnabled,
  },
  // Route handlers and server components are automatically instrumented
  automaticVercelMonitors: true,
  // Source map configuration
  sourcemaps: {
    // Disable source map upload if no auth token — separate from error capture
    disable: !Boolean(process.env.SENTRY_AUTH_TOKEN),
  },
};

const configWithPlugins = bundleAnalyzer(nextConfig);

export default sentryEnabled
  ? withSentryConfig(configWithPlugins, sentryOptions)
  : configWithPlugins;
