/**
 * App Router page prop types, declared explicitly rather than taken from the
 * generated globals.
 *
 * Next.js 16 emits a global `PageProps<Route>` into `.next/types/routes.d.ts`,
 * keyed by a union of the routes it found:
 *
 *   type AppRoutes = "/" | "/auth/login" | "/auth/signup"
 *
 * That union is a *build artifact*. On a fresh clone `.next/` does not exist, so
 * the union is whatever a previous build left behind — or nothing at all — and
 * `PageProps<"/auth/login">` fails with
 *
 *   error TS2344: Type '"/auth/login"' does not satisfy the constraint '"/"'
 *
 * which is exactly what happened here when the routes were added. The effect is
 * that `tsc --noEmit` silently depends on `next build` (or `next typegen`)
 * having run first. That is a poor property for a type check: in CI the type
 * check is normally the cheap gate that runs *before* the build, and a clone
 * that has never been built reports errors that have nothing to do with the
 * code.
 *
 * The types below reproduce the same runtime contract with no generated
 * dependency. `searchParams` is copied verbatim from Next's own declaration:
 *
 *   searchParams: Promise<Record<string, string | string[] | undefined>>
 *
 * The `string[]` arm matters — a repeated query parameter (`?error=a&error=b`)
 * genuinely arrives as an array, which is why every reader has to narrow before
 * using the value.
 *
 * `next build` still type-checks pages against the generated types, and it
 * accepts this. Its validator requires the default export to satisfy
 *
 *   React.ComponentType<{ params: Promise<ParamMap[Route]> } & any>
 *
 * where `& any` collapses the whole props type to `any`, so an explicitly-typed
 * page passes. Confirmed by running the build.
 *
 * When to prefer the generated `PageProps<Route>` instead: a dynamic route whose
 * `params` carry real route-specific keys, where the generated type earns its
 * keep by typing them from the filesystem. For static routes it contributes
 * nothing except the ordering constraint above.
 */

import type { ReactNode } from "react";

/**
 * A page's query string as Next.js delivers it. Repeated keys arrive as arrays,
 * so narrow before use.
 */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Props for a static App Router page that reads the query string.
 *
 * `params` is deliberately omitted: these routes have no dynamic segments, and a
 * page may declare fewer props than Next passes.
 */
export type PageSearchParams = {
  searchParams: Promise<SearchParams>;
};

/**
 * Props for a layout with no dynamic segments and no parallel-route slots.
 *
 * The generated `LayoutProps<Route>` also supplies `params` and any named slots;
 * neither applies to the root layout, which only renders `children`.
 *
 * Note that the build's layout validator is stricter than its page validator —
 * `React.ComponentType<LayoutProps<Route>>`, with no `& any` escape hatch. This
 * type still satisfies it: a component that requires only `children` accepts a
 * props object carrying `children` *and* `params`, so it remains assignable.
 */
export type LayoutChildren = {
  children: ReactNode;
};
