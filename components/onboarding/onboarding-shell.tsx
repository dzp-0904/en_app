import type { ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Stepper } from "./stepper";
import type { OnboardingStepIndex } from "@/lib/onboarding";

/**
 * The frame every onboarding step shares: centred lockup, progress indicator,
 * then a single white card carrying the question.
 *
 * Unlike the auth screens there is no navy brand panel — the Figma drops it here,
 * on the reasoning that someone already signed in does not need to be sold the
 * product again. That makes the layout a single centred column at every width,
 * which is why there are no responsive branches below.
 *
 * `title` renders as the page's `h1` (see `CardTitle`), so each step contributes
 * exactly one heading.
 */
export function OnboardingShell({
  step,
  title,
  description,
  titleAdornment,
  children,
}: {
  step: OnboardingStepIndex;
  title: ReactNode;
  description: ReactNode;
  /** Optional mark shown before the title — the success tick on the last step. */
  titleAdornment?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mb-8 flex justify-center">
        <LogoMark size="sm" />
      </div>

      <Stepper step={step} />

      <Card className="p-8">
        <CardHeader>
          {titleAdornment ? (
            <div className="mb-2">{titleAdornment}</div>
          ) : null}
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent>{children}</CardContent>
      </Card>
    </>
  );
}
