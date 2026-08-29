import Link from "next/link";

import { SubmitButton } from "@/components/auth/submit-button";
import { CopyField } from "@/components/onboarding/copy-field";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireClass, requireTeacher } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

import { inviteStudentByEmail } from "../actions";

/**
 * Step 4 — share the class.
 *
 * The invitation list is read back from `class_members` rather than accumulated
 * in component state, so it survives a reload and shows the truth: a row is
 * listed as sent only when `invite_email_sent_at` was actually stamped, which
 * happens after the SMTP send resolves and never before.
 *
 * The Figma ends with two controls, "Go to dashboard" and "Skip for now". There
 * is no dashboard, and with both leading to the same place they would be one
 * button wearing two labels, so only the primary one is rendered.
 */
export default async function InvitePage({ searchParams }: PageSearchParams) {
  const teacher = await requireTeacher();
  const currentClass = requireClass(teacher);

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  const supabase = await createClient();

  const [{ data: invite }, { data: members }] = await Promise.all([
    supabase
      .from("class_invite_codes")
      .select("code")
      .eq("class_id", currentClass.id)
      .eq("is_active", true)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("class_members")
      .select("id, invited_email, join_status, invite_email_sent_at")
      .eq("class_id", currentClass.id)
      .is("removed_at", null)
      .not("invited_email", "is", null)
      .order("invited_at", { ascending: true }),
  ]);

  const link = invite ? await joinUrl(invite.code) : null;

  return (
    <OnboardingShell
      step={3}
      title="Class created!"
      description="Share the link below or invite students by email."
      titleAdornment={
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full bg-green-light text-xs text-green"
        >
          ✓
        </span>
      }
    >
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      {link ? (
        <CopyField label="Class invitation link" value={link} />
      ) : (
        <Alert className="mb-5">
          This class has no active invitation link yet. Refresh the page in a
          moment, or invite students by email below.
        </Alert>
      )}

      <form action={inviteStudentByEmail} className="space-y-1.5">
        <Label htmlFor="email">Or invite by email</Label>
        <div className="flex items-start gap-2">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="student@email.com"
            className="flex-1"
            required
          />
          <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
        </div>
      </form>

      {members && members.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {members.map((member) => (
            <li key={member.id} className="text-sm">
              {member.join_status === "joined" ? (
                <span className="text-green">
                  ✓ {member.invited_email} joined the class
                </span>
              ) : member.invite_email_sent_at ? (
                <span className="text-green">
                  ✓ Invitation sent to {member.invited_email}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {member.invited_email} was added, but the email has not gone
                  out — share the link with them.
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <Button asChild className="mt-6 w-full">
        <Link href="/">Continue to EduTrack</Link>
      </Button>
    </OnboardingShell>
  );
}
