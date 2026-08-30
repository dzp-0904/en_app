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

/** ⊙ — the settings dial. */
export function SettingsMark(props: ComponentProps<"svg">) {
  return (
    <Mark {...props}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58" />
    </Mark>
  );
}
