import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's surface treatment, taken from its onboarding and join screens:
 * white fill, hairline border, 16px radius, and `shadow-sm` — the only
 * elevation anywhere in the design.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm",
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
