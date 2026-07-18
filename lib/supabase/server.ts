import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSharedCookieOptions, withSharedCookieDomain } from './cookie-options';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// One-time warning flag to prevent console spam
let serverWarningShown = false;

// Check if Supabase is properly configured (not placeholder values)
function isSupabaseConfigured(): boolean {
  // Check URL is valid
  const hasValidUrl = !!(
    supabaseUrl &&
    supabaseUrl.includes('supabase.co') &&
    !supabaseUrl.includes('your-project-id')
  );

  // Check key is valid - Supabase anon keys are JWT tokens starting with "eyJ" or publishable keys starting with "sb_"
  const hasValidKey = !!(
    supabaseAnonKey &&
    (supabaseAnonKey.startsWith('eyJ') || supabaseAnonKey.startsWith('sb_')) &&
    supabaseAnonKey !== 'your-anon-key-here' &&
    !supabaseAnonKey.includes('PASTE')
  );

  return hasValidUrl && hasValidKey;
}

export async function createServerClient() {
  if (!isSupabaseConfigured()) {
    if (!serverWarningShown) {
      console.warn(
        '⚠️ Supabase not configured for server. Auth features disabled.\n' +
          'To enable auth, update .env.local with your Supabase credentials.',
      );
      serverWarningShown = true;
    }
    // Return a mock client for demo mode
    return {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
      },
      from: () => {
        const mockError = { message: 'Supabase not configured.', code: 'MOCK_CLIENT' };
        // Create a chainable query builder mock that propagates errors through the chain
        const errorChainable: Record<string, unknown> = {
          select: () => errorChainable,
          eq: () => errorChainable,
          neq: () => errorChainable,
          is: () => errorChainable,
          order: () => errorChainable,
          limit: () => errorChainable,
          single: () => ({ data: null, error: mockError }),
          maybeSingle: () => ({ data: null, error: mockError }),
          then: (resolve: (value: { data: null; error: typeof mockError }) => void) => {
            resolve({ data: null, error: mockError });
          },
          data: null,
          error: mockError,
        };
        // Create a chainable query builder mock for reads (returns empty data, no error)
        const chainable: Record<string, unknown> = {
          select: () => chainable,
          insert: () => errorChainable,
          update: () => errorChainable,
          delete: () => errorChainable,
          upsert: () => errorChainable,
          is: () => chainable,
          eq: () => chainable,
          neq: () => chainable,
          gt: () => chainable,
          gte: () => chainable,
          lt: () => chainable,
          lte: () => chainable,
          like: () => chainable,
          ilike: () => chainable,
          in: () => chainable,
          contains: () => chainable,
          containedBy: () => chainable,
          range: () => chainable,
          overlaps: () => chainable,
          match: () => chainable,
          not: () => chainable,
          or: () => chainable,
          filter: () => chainable,
          order: () => chainable,
          limit: () => chainable,
          offset: () => chainable,
          single: () => ({ data: null, error: null }),
          maybeSingle: () => ({ data: null, error: null }),
          // Terminal methods that return the result
          then: (resolve: (value: { data: []; error: null }) => void) => {
            resolve({ data: [], error: null });
          },
          // Make it awaitable
          data: [],
          error: null,
        };
        return chainable;
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
  }

  const cookieStore = await cookies();
  const cookieOptions = getSharedCookieOptions();

  return createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
    ...(cookieOptions ? { cookieOptions } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // Belt-and-braces: `cookieOptions` above already merges the shared
          // domain into every cookie @supabase/ssr sets or removes (sign-in,
          // refresh, sign-out). We re-apply it here too so this keeps working
          // even if a future Supabase cookie bypasses that merge.
          cookieStore.set(name, value, withSharedCookieDomain(options));
        });
      },
    },
  });
}
