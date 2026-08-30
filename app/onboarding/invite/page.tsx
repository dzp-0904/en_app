import Link from "next/link";

import { SubmitButton } from "@/components/auth/submit-button";
import { CopyField } from "@/components/onboarding/copy-field";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireFirstClass, requireTeacher } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { loadInviteCode } from "@/lib/teacher";

import { inviteStudentByEmail } from "../actions";

/**
 * Step 4 — share the first class.
 *
 * This is the tail of first-class onboarding and nothing else. `createClass`
 * redirects here when the teacher had no class before the insert, which is the
 * only path that reaches it: no navigation offers it, `/` sends a completed
 * teacher to `/teacher`, and `resumeHref` no longer names it either. What is
 * left is someone typing the URL, and `requireFirstClass` turns that into
 * `/teacher` as soon as there is more than one class to have meant.
 *
 * Everyday invitation lives at `/teacher/[classId]`, which offers the same link
 * and the same email form for a class the teacher picked rather than the one
 * that happens to be newest.
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
  const currentClass = requireFirstClass(teacher);

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  const supabase = await createClient();

  const [code, { data: members }] = await Promise.all([
    // Shared with `/teacher/[classId]`, and applying all four of the rules
    // `get_class_invite_preview` applies. The query this replaced checked only
    // `is_active` and `revoked_at`, so an expired or exhausted code was printed
    // here as a working link and refused at `/join/[code]`.
    loadInviteCode(supabase, currentClass.id),
    supabase
      .from("class_members")
      .select("id, invited_email, join_status, invite_email_sent_at")
      .eq("class_id", currentClass.id)
      .is("removed_at", null)
      .not("invited_email", "is", null)
      .order("invited_at", { ascending: true }),
  ]);

  const link = code ? await joinUrl(code) : null;

  return (
    <OnboardingShell
      step={3}
      title="Đã tạo lớp học!"
      description="Chia sẻ liên kết bên dưới hoặc mời học viên qua email."
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
        <CopyField label="Liên kết mời vào lớp" value={link} />
      ) : (
        <Alert className="mb-5">
          Lớp này chưa có liên kết mời nào đang hoạt động. Hãy tải lại trang sau
          giây lát, hoặc mời học viên qua email bên dưới.
        </Alert>
      )}

      <form
        action={inviteStudentByEmail.bind(null, currentClass.id, "onboarding")}
        className="space-y-1.5"
      >
        <Label htmlFor="email">Hoặc mời qua email</Label>
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
          <SubmitButton pendingLabel="Đang gửi…">Gửi</SubmitButton>
        </div>
      </form>

      {members && members.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {members.map((member) => (
            <li key={member.id} className="text-sm">
              {member.join_status === "joined" ? (
                <span className="text-green">
                  ✓ {member.invited_email} đã tham gia lớp
                </span>
              ) : member.invite_email_sent_at ? (
                <span className="text-green">
                  ✓ Đã gửi lời mời tới {member.invited_email}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Đã thêm {member.invited_email}, nhưng email chưa được gửi đi —
                  hãy chia sẻ liên kết cho họ.
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <Button asChild className="mt-6 w-full">
        <Link href="/">Tiếp tục vào EduTrack</Link>
      </Button>
    </OnboardingShell>
  );
}
