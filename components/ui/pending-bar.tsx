"use client";

import { useLinkStatus } from "next/link";

/**
 * A hairline that appears under a `<Link>` while its navigation is in flight.
 *
 * Every destination in this application is a dynamic, per-teacher route: the
 * server has to verify the session with the Auth server and then read the rows
 * the page is about, and on a hosted Supabase project each of those is a real
 * network round trip. M23 cut the number of them, but it cannot cut them to
 * zero — and until the payload arrives, the App Router holds the old page on
 * screen. Measured before this component existed, a click on a sidebar row or a
 * filter pill produced *no* change of any kind for 500–1000 ms; the first thing
 * that moved was the finished page.
 *
 * `useLinkStatus` is Next's own answer to that, and this is the whole of the
 * treatment: while `pending`, a 2px bar under the label. It is not a spinner
 * over the content, not a skeleton, and not a `loading.tsx` boundary — those
 * would blank a page that is still perfectly readable, and on a filter change
 * they would take the filter row down with it.
 *
 * Deliberately claims nothing. It does not move the selection, does not restyle
 * the pill as chosen, and does not pre-empt the server: if the navigation fails
 * or is superseded, the bar simply goes away and the page never lied about
 * where it was. That is the one thing an optimistic highlight could not
 * promise.
 *
 * Positioned absolutely, so it can never shift the layout it sits in — every
 * host gives its link `relative`. `aria-hidden` because it is an affordance,
 * not information: giving it text would splice "loading" into the link's own
 * accessible name. `motion-reduce:animate-none` leaves a static bar for a
 * reader who has asked for less movement.
 *
 * With JavaScript disabled the hook never reports pending, nothing renders, and
 * the link navigates the way a link always has.
 */
export function PendingBar() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      data-slot="pending-bar"
      className="pointer-events-none absolute inset-x-3 bottom-1 h-0.5 animate-pulse rounded-full bg-current opacity-45 motion-reduce:animate-none"
    />
  );
}
