"use client";

import { useLinkStatus } from "next/link";

/**
 * A soft wash over a `<Link>` while its navigation is in flight.
 *
 * Every destination in this application is a dynamic, per-teacher route: the
 * server has to establish who is asking and then read the rows the page is
 * about, and on a hosted Supabase project each of those is a real network round
 * trip. M23 and M24 cut the number of them, but they cannot be cut to zero —
 * and until the payload arrives, the App Router holds the old page on screen.
 * Measured before this component existed, a click on a sidebar row or a filter
 * pill produced *no* change of any kind for 500–1000 ms; the first thing that
 * moved was the finished page.
 *
 * `useLinkStatus` is Next's own answer to that, and this is the whole of the
 * treatment. It is not a spinner over the content, not a skeleton, and not a
 * `loading.tsx` boundary — those would blank a page that is still perfectly
 * readable, and on a filter change they would take the filter row down with it.
 *
 * WHY A WASH AND NOT A BAR. M23 drew this as a 2px hairline pinned to the
 * bottom of the row. It was reported as an "underline appearing when I click
 * the navigation", which is exactly what it looked like: a rule the width of
 * the label, sitting a few pixels under it, on a link. Nothing in the Figma
 * underlines anything, and a treatment that reads as text decoration on a
 * control that is not decorated is a defect however it was intended.
 *
 * So the same state is now shown as the row tinting in its own colour.
 * `bg-current/10` is the label's colour at a tenth strength, which over the
 * text is that same colour and therefore invisible, and over the row's ground
 * is a light tint — so the row shades without the label shifting, thickening or
 * gaining a rule. `rounded-[inherit]` takes the host's own radius, so it fits a
 * `rounded-lg` nav row, a `rounded-md` tab and a `rounded-full` pill without
 * any of them saying which they are. `animate-pulse` is what separates it from
 * a hover tint — the cursor is sitting on the row at the time — and
 * `motion-reduce:animate-none` leaves a steady tint for a reader who has asked
 * for less movement.
 *
 * Deliberately claims nothing. It does not move `aria-current`, does not
 * restyle the pill as chosen, and does not pre-empt the server: if the
 * navigation fails or is superseded, the tint simply goes away and the page
 * never lied about where it was. That is the one thing an optimistic highlight
 * could not promise.
 *
 * Positioned absolutely over the whole link, so it can never shift the layout
 * it sits in — every host gives its link `relative` — and `pointer-events-none`
 * so it is not in the way of the click that started it. `aria-hidden` because
 * it is an affordance, not information: giving it text would splice "loading"
 * into the link's own accessible name.
 *
 * With JavaScript disabled the hook never reports pending, nothing renders, and
 * the link navigates the way a link always has.
 */
export function PendingTint() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      data-slot="pending-tint"
      className="pointer-events-none absolute inset-0 animate-pulse rounded-[inherit] bg-current/10 motion-reduce:animate-none"
    />
  );
}
