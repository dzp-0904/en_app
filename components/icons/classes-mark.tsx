import type { ComponentProps } from "react";

/**
 * A class: the card the rest of the product is built out of, with two lines of
 * writing on it.
 *
 * Drawn here rather than installed. There is no icon library in this project
 * and one navigation glyph is not a reason to add several hundred, so this
 * follows `GoogleMark`: hand-written, sized in the file, stroked in
 * `currentColor` so the link's own colour carries through to it.
 *
 * Decorative — the label beside it already says "Classes".
 */
export function ClassesMark(props: ComponentProps<"svg">) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="2.25" />
      <path d="M5.5 6.75h5M5.5 9.5h3" />
    </svg>
  );
}
