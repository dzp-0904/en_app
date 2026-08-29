import "server-only";

import { headers } from "next/headers";

/**
 * The canonical absolute origin of this deployment.
 *
 * An invite link printed into an email leaves the request that created it, so it
 * cannot be relative and it cannot be derived from a header the recipient never
 * sent. `SITE_URL` is the authoritative answer and the only place the production
 * domain is written down.
 *
 * It is a plain server variable, not `NEXT_PUBLIC_`: nothing in the browser
 * needs it, and `NEXT_PUBLIC_` values are inlined at build time, which would bake
 * the domain into the image and make it unchangeable at deploy time.
 *
 * The header fallback exists so local development works with no configuration.
 * It is only safe as a fallback — `Host` is attacker-controlled, so a deployment
 * that emails links MUST set `SITE_URL` rather than rely on it.
 */
export async function siteUrl(): Promise<string> {
  const configured = process.env.SITE_URL?.trim();

  if (configured) {
    // Tolerate a trailing slash in configuration rather than producing `//join`.
    return configured.replace(/\/+$/, "");
  }

  const headerList = await headers();

  // x-forwarded-host wins: behind a proxy, `host` is the internal hostname.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) {
    throw new Error(
      "Cannot determine the site origin: SITE_URL is unset and the request " +
        "carries neither x-forwarded-host nor host.",
    );
  }

  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();

  const isLoopback =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");

  const proto = forwardedProto ?? (isLoopback ? "http" : "https");

  return `${proto}://${host}`;
}

/** The absolute URL a student opens to join a class. */
export async function joinUrl(code: string): Promise<string> {
  return `${await siteUrl()}/join/${encodeURIComponent(code)}`;
}
