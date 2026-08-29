import "server-only";

import { cookies } from "next/headers";

/**
 * Carries an invite code across the sign-in detour.
 *
 * Someone who opens `/join/ABC…` while signed out has to authenticate before
 * they can be added to anything, and the sign-in flow ends at `/`. The code is
 * parked in a cookie so `/` can send them back to the class they were actually
 * invited to, instead of stranding them on a landing page with the link lost to
 * a browser history they may not think to search.
 *
 * A cookie rather than a `?next=` parameter because the OAuth round trip goes
 * through Google and back via `/auth/callback`, and nothing in the existing auth
 * flow forwards a query parameter across that. This adds no coupling to it: the
 * auth actions are untouched and never read this value.
 *
 * `httpOnly` keeps it out of reach of client script, and the short lifetime
 * keeps a forgotten cookie from redirecting `/` for the rest of the day.
 */

export const PENDING_JOIN_COOKIE = "edutrack_pending_join";

const MAX_AGE_SECONDS = 30 * 60;

/**
 * The shape `class_invite_codes_normalised` permits, narrowed to the alphabet
 * `generate_invite_code` actually draws from.
 *
 * Validated on the way in and on the way out. A cookie is client-supplied data,
 * and this value ends up in a redirect path — checking it here means the code
 * can never be a route traversal or a scheme, whatever the browser sent.
 */
const CODE_PATTERN = /^[A-Z0-9]{10,40}$/;

/** Uppercases and trims to match the database, or returns null if unusable. */
export function normaliseInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/** Remembers the class the visitor was heading for. Server Actions only. */
export async function rememberPendingJoin(code: string): Promise<void> {
  const normalised = normaliseInviteCode(code);
  if (!normalised) return;

  const store = await cookies();

  store.set(PENDING_JOIN_COOKIE, normalised, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The parked code, or null if there is none or it is malformed. */
export async function readPendingJoin(): Promise<string | null> {
  const store = await cookies();
  return normaliseInviteCode(store.get(PENDING_JOIN_COOKIE)?.value);
}

/**
 * Forgets the parked code.
 *
 * Called on a successful join and on "Not now" — the second matters as much as
 * the first, because without it a visitor who changed their mind would be sent
 * back to the invitation every time they opened the site.
 *
 * Server Actions only.
 */
export async function clearPendingJoin(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_JOIN_COOKIE);
}
