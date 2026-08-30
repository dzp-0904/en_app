import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's surface: white fill, hairline border, no fill beyond that.
 *
 * THREE VARIANTS, because the design draws a card three ways and the
 * difference is not decoration.
 *
 *   `default`  — `rounded-2xl p-6`, flat. The in-app surface: Settings' three
 *                cards, the student screens, and any framed container.
 *   `elevated` — the same plus `shadow-sm`. The standalone card on a page with
 *                no shell around it: onboarding, login, signup, join. This is
 *                the *only* place the Figma uses a shadow across fifteen
 *                screens, `OnboardingPage.tsx`'s `rounded-2xl border shadow-sm
 *                p-8`, and it earns it by floating on a bare `#F7F6F1` field.
 *   `list`     — `rounded-xl p-5`, flat. The row in a list: the Dashboard's
 *                class and needs-attention cards, the lesson log, the report
 *                row. Twelve pixels of radius, not sixteen.
 *
 * Until M23 there was one variant carrying `shadow-sm` unconditionally, on the
 * reading that elevation was the design's single surface treatment. That is
 * true of the onboarding card and of nothing else — every in-app card in the
 * Figma is flat, and the app was lifting all of them off the page.
 */

const CARD_VARIANTS = {
  default: "rounded-2xl p-6",
  elevated: "rounded-2xl p-6 shadow-sm",
  list: "rounded-xl p-5",
} as const;

function Card({
  variant = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: keyof typeof CARD_VARIANTS;
}) {
  return (
    <div
      data-slot="card"
      className={cn(
        "border border-border bg-card text-card-foreground",
        CARD_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("space-y-1.5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="card-title"
      className={cn("text-xl font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("mt-6", className)} {...props} />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
