import type { Metadata } from "next";
import { Lora, Public_Sans } from "next/font/google";

import type { LayoutChildren } from "@/lib/route-types";

import "./globals.css";

/**
 * The Figma specifies Instrument Sans for the interface, but Google serves it
 * with `latin` and `latin-ext` only — there is no `vietnamese` subset. Those two
 * subsets carry ă, đ, ơ and ư, and stop short of the tone-stacked vowels in
 * U+1EA0–U+1EF9. So "Nguyễn Thị Linh" lost ễ and ị to the fallback face and set
 * itself in two typefaces inside a single word. EduTrack's students are
 * Vietnamese and their names are user data, so this was on every screen that
 * shows a name, not just a placeholder.
 *
 * Public Sans replaces it. Both are grotesques of the same Franklin lineage, and
 * measured against Instrument Sans at 100px it is the closest of the
 * Vietnamese-capable families on Google Fonts: x-height within 2%, cap-height
 * within 1.4%, and set width within 0.8% — close enough that the Figma's
 * spacing and line breaks hold without adjustment.
 *
 * Lora stays. It ships a real `vietnamese` subset, so the display line is safe
 * for Vietnamese text as well as the English quote it currently holds.
 */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
  fallback: ["Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "latin-ext", "vietnamese"],
  fallback: ["Georgia", "Times New Roman", "serif"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EduTrack",
    template: "%s · EduTrack",
  },
  description:
    "Progress tracking and parent reporting for independent English and IELTS teachers.",
};

export default function RootLayout({ children }: LayoutChildren) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
