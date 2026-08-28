/**
 * The two public Supabase values, validated once.
 *
 * Both are `NEXT_PUBLIC_`, so Next.js inlines them at build time — including
 * into the browser bundle. That is correct for these two: the URL is public by
 * definition and the publishable key is designed to be shipped to clients. It
 * also means a missing value is a *build* problem, not a runtime one, and with
 * `output: "standalone"` the Docker build needs both as build args rather than
 * runtime env.
 *
 * The check exists because the failure it prevents is otherwise silent and
 * confusing: `createBrowserClient(undefined!, undefined!)` constructs happily
 * and only fails later with an opaque network or "Invalid API key" error, from
 * a stack frame nowhere near the actual mistake.
 *
 * Never add the secret/service-role key here. This module is imported by
 * browser code.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and ` +
        `fill in both Supabase values. With output: "standalone" this must be ` +
        `available at build time, not just at runtime.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
