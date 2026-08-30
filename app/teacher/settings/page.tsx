import type { Metadata } from "next";

import { signOut } from "@/app/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Select } from "@/components/ui/select";
import { COURSE_TYPES, LABELS } from "@/lib/course-type";
import { requireTeacher } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { updateProfile } from "./actions";

export const metadata: Metadata = {
  title: "Cài đặt",
};

/**
 * Account settings — the Figma's `pages/teacher/Settings.tsx`.
 *
 * Its three cards are all here: Profile, Security, Account. The profile card is
 * a real form over a real Server Action writing `profiles.full_name` and
 * `profiles.teaching_type`, and the sign-out button is the one every other
 * screen uses.
 *
 * EMAIL IS READ-ONLY, AS IN THE FIGMA. It is `disabled` there and `readOnly`
 * here — `disabled` would drop it from the accessibility tree and from tab
 * order, and the address is worth reading. Either way it submits nothing, and
 * `updateProfile` never looks for it: an auth email change is a verification
 * flow, not a profile update.
 *
 * SECURITY IS NOT INTERACTIVE, AND SAYS SO. The Figma draws "Change password"
 * and "Two-factor authentication" as buttons; neither has a handler there, and
 * neither has a backend here — there is no password-reset UI in this product
 * yet and no MFA enrolment. A button that looks like the real thing and does
 * nothing is worse than no button, so the two rows are rendered as what they
 * are: statements of what is not available yet, marked "Chưa khả dụng". That is
 * the milestone's own instruction to distinguish unavailable functionality from
 * real functionality rather than fake it.
 *
 * The Figma's third card is headed "Account" and its own comment calls it the
 * danger zone. Signing out is not dangerous, so it keeps the heading and drops
 * the red border; the destructive framing is reserved for something that
 * destroys.
 */

export default async function TeacherSettingsPage({
  searchParams,
}: PageSearchParams) {
  // Every other `/teacher` page reads `loadUserState` and redirects; this one
  // uses the same helper the onboarding steps use, which does the same thing
  // and hands back the teacher context the form is filled from.
  const teacher = await requireTeacher();

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const saved = params.saved === "1";

  // `auth.users.email` is nullable in Supabase's own schema, so the context
  // carries `string | null`. Every account in this product signs in with one,
  // but the type is honest and so is the fallback.
  const email = teacher.email ?? "";

  return (
    <PageShell width="2xl" align="start">
      <PageHeader
        title="Cài đặt"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Cài đặt" },
        ]}
        meta={["Quản lý thông tin tài khoản của bạn"]}
      />

      {error ? <Alert className="mb-5">{error}</Alert> : null}

      {saved ? (
        <p
          role="status"
          className="mb-5 rounded-lg border border-green/25 bg-green-light px-3.5 py-2.5 text-sm text-green-dark"
        >
          Đã lưu thay đổi.
        </p>
      ) : null}

      <section aria-labelledby="profile-heading" className="mb-5">
        <Card className="p-6">
          <h2
            id="profile-heading"
            className="mb-4 font-semibold text-foreground"
          >
            Hồ sơ
          </h2>

          <div className="mb-5 flex items-center gap-4">
            {/* `aria-hidden` by default — the name is printed beside it. */}
            <Avatar name={teacher.fullName} size="lg" />

            <div className="min-w-0">
              <p className="font-medium break-words text-foreground">
                {teacher.fullName}
              </p>
              <p className="text-sm break-all text-muted-foreground">
                {email}
              </p>
            </div>
          </div>

          <form action={updateProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Họ và tên</Label>
              <Input
                id="full_name"
                name="full_name"
                type="text"
                autoComplete="name"
                defaultValue={teacher.fullName}
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                readOnly
                aria-describedby="email-hint"
                className="bg-background text-muted-foreground"
              />
              <p id="email-hint" className="text-xs text-muted-foreground">
                Email đăng nhập không thể thay đổi tại đây.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="teaching_type">Nội dung giảng dạy</Label>
              <Select
                id="teaching_type"
                name="teaching_type"
                defaultValue={teacher.teachingType ?? undefined}
                required
              >
                {COURSE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>

            <SubmitButton pendingLabel="Đang lưu…">Lưu thay đổi</SubmitButton>
          </form>
        </Card>
      </section>

      <section aria-labelledby="security-heading" className="mb-5">
        <Card className="p-6">
          <h2
            id="security-heading"
            className="mb-1 font-semibold text-foreground"
          >
            Bảo mật
          </h2>

          <p className="mb-4 text-sm text-muted-foreground">
            Các tùy chọn bảo mật dưới đây chưa khả dụng trong phiên bản này.
          </p>

          <ul className="space-y-3">
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-4 py-3">
              <span className="min-w-0 grow basis-48 text-sm text-muted-foreground">
                Đổi mật khẩu
              </span>
              <span className="shrink-0 rounded bg-background px-2 py-0.5 text-xs text-muted-foreground">
                Chưa khả dụng
              </span>
            </li>

            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-4 py-3">
              <span className="min-w-0 grow basis-48 text-sm text-muted-foreground">
                Xác thực hai lớp
              </span>
              <span className="shrink-0 rounded bg-background px-2 py-0.5 text-xs text-muted-foreground">
                Chưa bật
              </span>
            </li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="account-heading">
        <Card className="p-6">
          <h2
            id="account-heading"
            className="mb-4 font-semibold text-foreground"
          >
            Tài khoản
          </h2>

          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Đăng xuất
            </Button>
          </form>
        </Card>
      </section>
    </PageShell>
  );
}
