// components/layout/Sidebar.tsx
// ============================================================================
// SIDEBAR COMPONENT - SOLID SURFACE EDITION
// ============================================================================
// Premium expandable sidebar with "Solid Surface" design featuring:
// - Clean, opaque backgrounds consistent with MQ design system
// - Sharp borders and consistent shadows
// - Performance-first animations
//
// FEATURES:
// - Desktop: Hover to expand with fluid slide animation
// - Mobile: Hamburger button toggles slide-out drawer with overlay
// - Solid Surface: Opaque backgrounds, high contrast borders
// - Accessibility: Focus trap, keyboard navigation, ARIA attributes
//
// CSS CLASSES:
// - .sidebar-shell           → Main container, detects :hover
// - .sidebar-trigger         → Always-visible 48px strip with hamburger
// - .sidebar-panel           → Sliding content panel
// ============================================================================
'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTypedTranslation } from '@/lib/hooks/useTypedTranslation';
import { APP_CONFIG } from '@/lib/config';
import {
  Home,
  MapPin,
  Calendar,
  MessageSquare,
  Menu,
  X,
  Sparkles,
  Settings,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SocialButtons from './SocialButtons';
import { useGamificationStore } from '@/lib/store/gamificationStore';
import { getLevelTitleKey } from '@/lib/utils/gamification';

import { TranslationKey } from '@/lib/i18n/translations';

// Navigation items configuration
// Each item maps to a route and displays with an icon
const navigation: {
  name: TranslationKey;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { name: 'home', href: '/home', icon: Home },
  { name: 'calendar', href: '/calendar', icon: Calendar },
  { name: 'navigation' as TranslationKey, href: '/map', icon: MapPin },
  { name: 'feed', href: '/feed', icon: MessageSquare },
  { name: 'settings', href: '/settings', icon: Settings },
];

export const GAMIFICATION_SETTINGS_ROUTE = '/settings/experience';

// Companion app (Sylla) entry point. Rendered only when a URL is configured so
// the link appears exclusively where the ecosystem is set up (e.g. production).
// Shared Supabase auth (NEXT_PUBLIC_AUTH_COOKIE_DOMAIN) lets a signed-in user
// land in Sylla already authenticated. Trimmed to avoid a stray-whitespace URL.
const SYLLA_URL = process.env.NEXT_PUBLIC_SYLLA_URL?.trim() || undefined;

/**
 * Sidebar Component
 *
 * A responsive sidebar navigation that:
 * - On desktop (md+): Shows a collapsed trigger strip that expands on hover
 * - On mobile: Shows a hamburger button that opens a full slide-out drawer
 *
 * The component is memoized to prevent unnecessary re-renders since it
 * only depends on pathname and translation state.
 */
const Sidebar = memo(() => {
  const { t } = useTypedTranslation();
  const pathname = usePathname();

  // Gamification profile for XP badge
  const profile = useGamificationStore((state) => state.profile);

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Keyboard navigation state for desktop sidebar
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);

  // Refs for focus management
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarShellRef = useRef<HTMLElement>(null);
  const firstFocusableRef = useRef<HTMLAnchorElement>(null);

  // ============================================================================
  // SCROLL LOCK FOR MOBILE MENU
  // ============================================================================
  // When mobile menu opens, prevent background scrolling for better UX.
  useEffect(() => {
    if (mobileMenuOpen) {
      // Save current scroll position and lock body
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';

      return () => {
        // Restore body styles and scroll position
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [mobileMenuOpen]);

  // ============================================================================
  // FOCUS TRAP FOR MOBILE MENU
  // ============================================================================
  // When mobile menu opens, trap focus within the sidebar for accessibility.
  // Pressing Escape closes the menu, Tab cycles through focusable elements.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    // Get all focusable elements within the sidebar
    const getFocusableElements = () => {
      return sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    };

    // Focus the first nav link when menu opens
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape key
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus(); // Return focus to trigger button
        return;
      }

      // Focus trap on Tab key
      if (e.key === 'Tab') {
        const focusable = getFocusableElements();
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        // Shift+Tab on first element → go to last
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
        // Tab on last element → go to first
        else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // ============================================================================
  // KEYBOARD NAVIGATION FOR DESKTOP SIDEBAR
  // ============================================================================
  // Opens sidebar when user tabs into it, closes when focus leaves.
  // Uses data-keyboard-open attribute instead of :focus-within CSS pseudo-class
  // to prevent the sidebar from staying open permanently after clicking links.
  useEffect(() => {
    const shell = sidebarShellRef.current;
    if (!shell) return;

    const handleFocusIn = () => {
      // Only open on keyboard navigation (desktop)
      if (window.innerWidth >= 768) {
        setKeyboardOpen(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      // Check if focus is moving outside the sidebar shell
      if (!shell.contains(e.relatedTarget as Node)) {
        setKeyboardOpen(false);
      }
    };

    shell.addEventListener('focusin', handleFocusIn);
    shell.addEventListener('focusout', handleFocusOut);

    return () => {
      shell.removeEventListener('focusin', handleFocusIn);
      shell.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Toggle mobile menu with both click and touch support
  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  // Close menu when clicking the overlay backdrop
  const handleOverlayClick = useCallback(() => {
    setMobileMenuOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  return (
    <>
      {/* ========================================================================
          MOBILE MENU BUTTON
          ========================================================================
          Fixed hamburger/X button in top-left corner on mobile devices.
          Toggles the slide-out drawer open/closed.
          ======================================================================== */}
      <button
        ref={menuButtonRef}
        type="button"
        className="sidebar-mobile-hamburger md:hidden fixed top-3 left-3 z-[60] p-3 bg-mq-background rounded-mq-lg shadow-mq-lg border border-mq-border hover:shadow-mq-xl hover:bg-mq-red active:scale-95 transition-all duration-200 touch-manipulation min-h-11 min-w-11 flex items-center justify-center"
        onClick={(e) => {
          e.stopPropagation();
          toggleMobileMenu();
        }}
        aria-label={mobileMenuOpen ? t('closeMenu') : t('openMenu')}
        aria-expanded={mobileMenuOpen}
        aria-controls="mobile-sidebar"
      >
        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* ========================================================================
          MOBILE OVERLAY BACKDROP
          ========================================================================
          Semi-transparent backdrop that appears behind the sidebar on mobile.
          Clicking it closes the menu.
          ======================================================================== */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 dark:bg-black/60 z-[55]"
          onClick={handleOverlayClick}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* ========================================================================
          MOBILE SIDEBAR PANEL
          ========================================================================
          On mobile, this panel slides in from the left when hamburger is clicked.
          It must be OUTSIDE the hidden md:block aside to render on mobile.
          ======================================================================== */}
      <div
        ref={sidebarRef}
        id="mobile-sidebar"
        role={mobileMenuOpen ? 'dialog' : 'navigation'}
        aria-modal={mobileMenuOpen ? 'true' : undefined}
        aria-label={t('mainNavigation')}
        className={cn(
          'md:hidden fixed left-0 top-0 w-64 h-dvh p-4 pt-20 flex flex-col bg-mq-background border-r border-mq-border transition-transform duration-300 ease-out overflow-y-auto overscroll-contain -webkit-overflow-scrolling-touch',
          mobileMenuOpen ? 'z-[58] translate-x-0' : 'z-40 -translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="mb-4">
          <Link
            href="/"
            className="flex items-center gap-2"
            ref={firstFocusableRef}
            onClick={() => setMobileMenuOpen(false)}
          >
            <Image
              src="/syllabus-sync-logo.png"
              alt={t('mqLogoAlt', { appName: APP_CONFIG.name })}
              width={80}
              height={80}
              priority
              className="h-12 w-auto"
              style={{
                objectFit: 'contain',
                borderRadius: '8px',
                width: 'auto',
              }}
            />
            <span className="text-sm font-semibold text-mq-content">{t('appName')}</span>
          </Link>
        </div>

        {/* XP/Level Badge */}
        {profile && (
          <Link
            href={GAMIFICATION_SETTINGS_ROUTE}
            onClick={() => setMobileMenuOpen(false)}
            className="mb-4 flex items-center gap-2 px-3 py-2 rounded-mq bg-gradient-to-r from-mq-primary/10 to-mq-secondary/10 border border-mq-primary/20 hover:border-mq-primary/40 transition-colors"
            title={`${t('level')} ${profile.level} - ${t(getLevelTitleKey(profile.level))} (${profile.xp.toLocaleString()} XP)`}
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-mq-primary text-white text-xs font-bold">
              {profile.level}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-mq-content truncate">
                {t(getLevelTitleKey(profile.level))}
              </p>
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-mq-primary" aria-hidden="true" />
                <span className="text-[10px] text-mq-content-secondary">
                  {profile.xp.toLocaleString()} XP
                </span>
              </div>
            </div>
          </Link>
        )}

        {/* Navigation Links */}
        <nav className="space-y-2 flex-1" role="navigation" aria-label={t('mainNavigation')}>
          {navigation.map((item) => {
            // Use startsWith for settings to match sub-routes like /settings/general
            const isActive =
              item.href === '/settings'
                ? pathname?.startsWith('/settings')
                : pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 rounded-mq text-sm font-medium touch-manipulation min-h-11',
                  isActive
                    ? 'bg-mq-primary text-white shadow-md'
                    : 'text-mq-content-secondary hover:text-mq-content hover:bg-mq-background-secondary',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {t(item.name)}
              </Link>
            );
          })}
        </nav>

        {/* Sylla companion app — external link, shown only when configured */}
        {SYLLA_URL && (
          <a
            href={SYLLA_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileMenuOpen(false)}
            className="mt-2 mb-2 flex items-start gap-3 px-3 py-3 rounded-mq border border-mq-primary/20 bg-gradient-to-r from-mq-primary/10 to-mq-secondary/10 hover:border-mq-primary/40 transition-colors touch-manipulation"
            aria-label={t('syllaOpenAria')}
          >
            <BookOpen className="h-5 w-5 mt-0.5 text-mq-primary shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1 text-sm font-medium text-mq-content">
                {t('syllaAssistant')}
                <ExternalLink className="h-3 w-3 text-mq-content-secondary" aria-hidden="true" />
              </span>
              <span className="block text-[11px] leading-snug text-mq-content-secondary">
                {t('syllaCardDescription')}
              </span>
            </span>
          </a>
        )}

        {/* Social Buttons */}
        <div className="pt-4 border-t border-mq-border">
          <SocialButtons />
        </div>
      </div>

      {/* ========================================================================
          DESKTOP SIDEBAR CONTAINER
          ========================================================================
          The main sidebar wrapper. On desktop, hovering this container triggers
          all child animations via CSS :hover selectors in sidebar.css.
          The sidebar uses CSS-only hover detection for smooth, lag-free animations.
          ======================================================================== */}
      <aside
        ref={sidebarShellRef}
        className="hidden md:block sidebar-shell"
        data-keyboard-open={keyboardOpen ? 'true' : undefined}
        data-pinned={pinnedOpen ? 'true' : undefined}
        onMouseLeave={() => {
          // Close keyboard-open state when mouse leaves (user switched to mouse navigation)
          if (!pinnedOpen) {
            setKeyboardOpen(false);
          }
        }}
      >
        {/* ----------------------------------------------------------------------
            DESKTOP TRIGGER STRIP
            ----------------------------------------------------------------------
            Always-visible 48px strip on the left edge with animated hamburger bars.
            Hovering this area triggers the sidebar to expand.
            Uses Alabaster background in light mode, charcoal in dark mode.
            ---------------------------------------------------------------------- */}
        <button
          type="button"
          className="hidden md:flex absolute left-0 top-0 h-full w-12 items-center justify-center border-r border-mq-border bg-mq-background text-mq-content-secondary dark:text-white/80 z-50 cursor-pointer select-none sidebar-trigger"
          aria-label={pinnedOpen ? t('closeMenu') : t('openMenu')}
          aria-pressed={pinnedOpen}
          aria-expanded={pinnedOpen}
          onClick={() => setPinnedOpen((prev) => !prev)}
          title={pinnedOpen ? t('closeMenu') : t('openMenu')}
        >
          {/* Hamburger bars - animate on hover (expand outward) */}
          <span className="flex flex-col items-center gap-2 sidebar-bars">
            <span className="h-5 w-0.5 rounded-full bg-mq-content sidebar-bar-top" />
            <span className="h-5 w-0.5 rounded-full bg-mq-content sidebar-bar-mid" />
            <span className="h-5 w-0.5 rounded-full bg-mq-content sidebar-bar-bottom" />
          </span>
        </button>

        {/* ----------------------------------------------------------------------
            DESKTOP SLIDING PANEL
            ----------------------------------------------------------------------
            The main sidebar content that slides in from the left on hover (desktop).
            Uses sidebar-panel CSS class for animations.
            ---------------------------------------------------------------------- */}
        <div
          id="desktop-sidebar"
          role="navigation"
          aria-label={t('mainNavigation')}
          className="fixed md:relative w-56 h-screen p-4 md:pl-12 flex flex-col sidebar-panel bg-mq-background border-r border-mq-border z-40 overflow-y-auto"
        >
          {/* Logo - bounces in with slight overshoot */}
          <div className="mb-4 sidebar-logo">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/syllabus-sync-logo.png"
                alt={t('mqLogoAlt', { appName: APP_CONFIG.name })}
                width={128}
                height={128}
                priority
                className="w-auto h-auto"
                style={{ objectFit: 'contain', borderRadius: '8px' }}
                onError={(e) => {
                  // Fallback for logo image
                  (e.target as HTMLImageElement).src =
                    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iI0E2MTkyRSIvPjwvc3ZnPg==';
                }}
              />
            </Link>
          </div>

          {/* XP/Level Badge */}
          {profile && (
            <Link
              href={GAMIFICATION_SETTINGS_ROUTE}
              className="mb-4 flex items-center gap-2 px-3 py-2 rounded-mq bg-gradient-to-r from-mq-primary/10 to-mq-secondary/10 border border-mq-primary/20 hover:border-mq-primary/40 transition-colors sidebar-menu-item"
              title={`${t('level')} ${profile.level} - ${t(getLevelTitleKey(profile.level))} (${profile.xp.toLocaleString()} XP)`}
              aria-label={t('gamificationProgress', {
                level: profile.level,
                title: t(getLevelTitleKey(profile.level)),
                xp: profile.xp.toLocaleString(),
              })}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-mq-primary text-white text-xs font-bold">
                {profile.level}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-mq-content truncate">
                  {t(getLevelTitleKey(profile.level))}
                </p>
                <div className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-mq-primary" aria-hidden="true" />
                  <span className="text-[10px] text-mq-content-secondary">
                    {profile.xp.toLocaleString()} XP
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Navigation Links - staggered slide-in animation */}
          <nav className="space-y-2" role="navigation" aria-label={t('mainNavigation')}>
            {navigation.map((item) => {
              // Use startsWith for settings to match sub-routes like /settings/general
              const isActive =
                item.href === '/settings'
                  ? pathname?.startsWith('/settings')
                  : pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 px-3 py-3 rounded-mq text-mq-sm font-medium touch-manipulation min-h-[44px] btn-premium sidebar-menu-item',
                    isActive
                      ? 'bg-mq-primary text-white shadow-mq-sm border border-white/10 border-l-4 border-white/80 pl-2 pr-3 font-semibold'
                      : 'text-mq-content-secondary hover:text-white hover:bg-mq-primary hover:shadow-mq active:scale-[0.98] transition-colors duration-200',
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 transition-transform duration-300 group-hover:scale-110 ease-mq-snap',
                      isActive && 'animate-pulse-subtle',
                    )}
                    aria-hidden="true"
                  />
                  {t(item.name)}
                </Link>
              );
            })}
          </nav>

          {/* Sylla companion app — external link, shown only when configured */}
          {SYLLA_URL && (
            <a
              href={SYLLA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-start gap-3 px-3 py-3 rounded-mq border border-mq-primary/20 bg-gradient-to-r from-mq-primary/10 to-mq-secondary/10 hover:border-mq-primary/40 transition-colors sidebar-menu-item"
              aria-label={t('syllaOpenAria')}
              title={t('syllaAssistant')}
            >
              <BookOpen className="h-4 w-4 mt-0.5 text-mq-primary shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1 text-mq-sm font-medium text-mq-content">
                  {t('syllaAssistant')}
                  <ExternalLink className="h-3 w-3 text-mq-content-secondary" aria-hidden="true" />
                </span>
                <span className="block text-[11px] leading-snug text-mq-content-secondary">
                  {t('syllaCardDescription')}
                </span>
              </span>
            </a>
          )}

          {/* Social Buttons - fades in last after menu items */}
          <div className="mt-auto pt-6 border-t border-mq-border sidebar-social">
            <SocialButtons />
          </div>
        </div>
      </aside>
    </>
  );
});

// Display name for React DevTools
Sidebar.displayName = 'Sidebar';

export default Sidebar;
