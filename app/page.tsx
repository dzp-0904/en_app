import Link from "next/link";

import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";

/**
 * The Figma has no landing screen, so this is deliberately the smallest page
 * that can exist: it says what EduTrack is and offers the two doors into it.
 *
 * Its composition is the brand panel's, moved onto cream — logo, one Lora line,
 * a sentence, then the capability list — so that arriving at `/auth/login` feels
 * like the same product rather than a different one. Every string here already
 * appears in the Figma.
 */
const POINTS = [
  "Track every student's IELTS progress",
  "Log a full lesson in under a minute",
  "Send parents a monthly report automatically",
];

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <LogoMark className="mb-16" />

        <h1 className="mb-4 font-serif text-2xl leading-relaxed text-foreground">
          Teachers who track progress clearly teach more effectively.
        </h1>

        <p className="text-sm text-muted-foreground">
          Designed for freelance English and IELTS teachers who care deeply about
          student outcomes.
        </p>

        <ul className="mt-8 space-y-3">
          {POINTS.map((point) => (
            <li
              key={point}
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild className="sm:flex-1">
            <Link href="/auth/signup">Create account</Link>
          </Button>
          <Button asChild variant="outline" className="sm:flex-1">
            <Link href="/auth/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
