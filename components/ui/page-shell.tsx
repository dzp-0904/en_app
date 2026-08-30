import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The frame a signed-in page sits in: cream ground, `p-8`, and one of the six
 * widths the Figma actually uses.
 *
 * Those widths are not a scale invented to look tidy — each is the cap a real
 * screen sets, and naming them is what stops the next page from picking a
 * seventh:
 *
 *   5xl  teacher dashboard, class detail, student profile
 *   4xl  lesson logs, reports, tuition, the student dashboard
 *   3xl  invite students
 *   2xl  create class, settings
 *   lg   the onboarding wizard
 *   sm   login, signup, join
 *
 * ALIGNMENT. The Figma's teacher screens are `p-8 max-w-5xl` with no centring —
 * the content hangs from the sidebar's edge — while its student, onboarding and
 * auth screens are centred in the viewport. Both are here because both are in
 * the design; `start` is the default because it is what every screen inside the
 * shell does. EduTrack's pages centre at `max-w-lg` today, which is the auth
 * flow's shape applied to application screens, and moving them is the business
 * of the milestones that rebuild them rather than of this one.
 *
 * `p-8` is the Figma's padding at every width, kept as-is: at 390px it leaves a
 * 326px column, which the primitives are built to live inside.
 */

const WIDTHS = {
  "5xl": "max-w-5xl",
  "4xl": "max-w-4xl",
  "3xl": "max-w-3xl",
  "2xl": "max-w-2xl",
  lg: "max-w-lg",
  sm: "max-w-sm",
} as const;

function PageShell({
  width = "5xl",
  align = "start",
  className,
  children,
  ...props
}: React.ComponentProps<"main"> & {
  width?: keyof typeof WIDTHS;
  align?: "start" | "center";
}) {
  return (
    <main
      data-slot="page-shell"
      className={cn("flex-1 bg-background p-8", className)}
      {...props}
    >
      <div
        className={cn(
          "w-full",
          WIDTHS[width],
          align === "center" && "mx-auto",
        )}
      >
        {children}
      </div>
    </main>
  );
}

export { PageShell };
