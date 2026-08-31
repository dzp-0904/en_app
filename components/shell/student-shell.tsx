import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/app/auth/actions";
import { LogoMark } from "@/components/brand/logo-mark";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * The frame every signed-in student page sits in — the Figma's own student
 * chrome, which is not the teacher's.
 *
 * `src/App.tsx` renders `student-dashboard` *outside* `<Layout>`, alone among
 * the twelve signed-in views, and `pages/student/Dashboard.tsx` draws its own
 * header instead: a white bar with a hairline under it, the brand at the left,
 * and the account at the right — name over a subtitle, a 32px initials disc,
 * and a text-weight way out. Everything below it is a `max-w-4xl` column
 * centred in the page.
 *
 * WHY NOT THE SIDEBAR. `components/shell/app-shell.tsx` gave students the
 * teacher's 240px column carrying a single navigation row, and said so in a
 * comment: the Figma "does not put it in this shell at all — it draws a top bar
 * over a centred column". That was recorded as a known deviation in M22 and is
 * what this milestone corrects. The design's reasoning holds on its own terms —
 * a rail whose whole purpose is to choose between sections is 240px spent on a
 * role that has one — and on a phone it is a wrapped bar of one link sitting
 * above every page.
 *
 * WHAT IS KEPT THAT THE FIGMA DOES NOT DRAW. The brand is a link to `/student`.
 * The Figma's student has exactly one screen and so needs no way back to
 * anything; this application's student can be in several classes, and taking
 * the sidebar away without leaving a route home would remove navigation rather
 * than restyle it. The breadcrumb on each page goes to the same place, so this
 * is a second way there and not the only one.
 *
 * The subtitle under the name is the account's email, which is what the sidebar
 * printed. The Figma prints a class name there — it can, because its student is
 * hard-coded into one class. Here the bar is above `/student`, every class page
 * and every lesson page, so a single class name would be wrong on most of them.
 *
 * Not a security boundary, for the reason `AppShell` gives at length: a layout
 * renders per segment and is reused across client-side transitions. Every page
 * underneath calls `loadUserState()` for itself and RLS sits under all of it.
 */
export function StudentShell({
  fullName,
  email,
  children,
}: {
  fullName: string;
  email: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card px-6 py-4">
        {/* The same `4xl` the pages below use, so the brand sits over the left
            edge of the content and the account over its right edge rather than
            over the viewport's. */}
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <Link
            href="/student"
            className="min-w-0 rounded-lg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <LogoMark size="sm" />
            <span className="sr-only">Trang chính</span>
          </Link>

          <div className="flex min-w-0 items-center gap-3">
            {/* Right-aligned, as the Figma sets it: the name and the address
                run back towards the disc that follows them. */}
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-medium text-foreground">
                {fullName}
              </p>

              {email ? (
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                </p>
              ) : null}
            </div>

            {/* `secondary` — the Figma's student disc is `#EDF0FF` on
                `#4466EE`, the inverse of the teacher sidebar's. `aria-hidden`
                by default because the name is printed beside it. */}
            <Avatar name={fullName} size="md" tone="secondary" />

            <form action={signOut} className="shrink-0">
              <Button type="submit" variant="ghost" size="sm">
                Đăng xuất
              </Button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
