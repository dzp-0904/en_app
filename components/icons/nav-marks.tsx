import type { ComponentProps } from "react";

/**
 * The six navigation glyphs the Figma's sidebar carries beside "Classes".
 *
 * `Layout.tsx` draws its nav icons as single Unicode characters — ⊞ ▦ ▤ ◳ ◈ ⊙
 * — which is a prototype shortcut rather than a design: the glyphs render at
 * whatever weight the system font happens to have, several are missing from
 * common Vietnamese font stacks, and a screen reader announces some of them by
 * name. They are redrawn here as SVG at the shape the Figma character implies,
 * following `ClassesMark`: hand-written, 16px, stroked in `currentColor` so the
 * link's own colour carries through, and `aria-hidden` because the label beside
 * each one already says what it is.
 *
 * Still no icon library. Six glyphs is not a reason to install several hundred,
 * and these are the only ones the product needs.
 */

function Mark(props: ComponentProps<"svg">) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

/** ⊞ — the dashboard's four panes. */
export function DashboardMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <rect x="2.25" y="2.25" width="5" height="5" rx="1.25" />
      <rect x="8.75" y="2.25" width="5" height="5" rx="1.25" />
      <rect x="2.25" y="8.75" width="5" height="5" rx="1.25" />
      <rect x="8.75" y="8.75" width="5" height="5" rx="1.25" />
    </Mark>
  );
}

/** ▦ — a month grid with its header rule. */
export function CalendarMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2.25" />
      <path d="M2.25 6.5h11.5M5.5 2v2.5M10.5 2v2.5" />
    </Mark>
  );
}

/** ▤ — a page of written lines. */
export function LessonLogsMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <path d="M4 2.25h5.5L13 5.75v8a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 2.5 13.75V3.75A1.5 1.5 0 0 1 4 2.25Z" />
      <path d="M9.25 2.5v3.25h3.25M5.5 9h5M5.5 11.5h3.5" />
    </Mark>
  );
}

/** ◳ — a report's bar chart. */
export function ReportsMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" />
      <path d="M5.5 10.75V7.5M8 10.75V5.25M10.5 10.75V9" />
    </Mark>
  );
}

/** ◈ — a banknote. */
export function TuitionMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <rect x="1.75" y="4.25" width="12.5" height="7.5" rx="1.75" />
      <circle cx="8" cy="8" r="1.75" />
      <path d="M4.25 8h.01M11.75 8h.01" />
    </Mark>
  );
}

/**
 * A gear — settings.
 *
 * The Figma writes this row's icon as `⊙` (CIRCLED DOT OPERATOR), which M22
 * redrew literally: a disc with eight radial rays. That reads as a sun, not as
 * settings — every other row's glyph names its destination and this one named
 * the wrong thing. Redrawn as the conventional cog, a toothed ring around a
 * hub, inside the same `Mark` wrapper so it keeps the 16px box, the 1.5 stroke,
 * `currentColor` and `aria-hidden` the other six carry.
 */
export function SettingsMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <circle cx="8" cy="8" r="2.15" />
      <path d="M8 1.4a1.05 1.05 0 0 1 1.05 1.05v.42c0 .43.26.81.65.98.4.16.85.08 1.16-.22l.3-.3a1.05 1.05 0 1 1 1.48 1.49l-.3.3c-.3.3-.39.75-.22 1.15.16.4.54.65.97.65h.46a1.05 1.05 0 0 1 0 2.1h-.42c-.43 0-.81.26-.98.65-.16.4-.08.85.22 1.16l.3.3a1.05 1.05 0 1 1-1.49 1.48l-.3-.3c-.3-.3-.75-.39-1.15-.22-.4.16-.65.54-.65.97v.46a1.05 1.05 0 0 1-2.1 0v-.42c0-.43-.26-.81-.65-.98-.4-.16-.85-.08-1.16.22l-.3.3a1.05 1.05 0 1 1-1.48-1.49l.3-.3c.3-.3.39-.75.22-1.15-.16-.4-.54-.65-.97-.65h-.46a1.05 1.05 0 0 1 0-2.1h.42c.43 0 .81-.26.98-.65.16-.4.08-.85-.22-1.16l-.3-.3a1.05 1.05 0 1 1 1.49-1.48l.3.3c.3.3.75.39 1.15.22h.08c.4-.16.65-.54.65-.97V2.45A1.05 1.05 0 0 1 8 1.4Z" />
    </Mark>
  );
}
