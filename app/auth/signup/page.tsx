import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { BrandPanel, type BrandPoint } from "@/components/auth/brand-panel";
import { GoogleButton } from "@/components/auth/google-button";
import { OrDivider } from "@/components/auth/or-divider";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PageSearchParams } from "@/lib/route-types";

import { signInWithGoogle, signUpWithPassword } from "../actions";

export const metadata: Metadata = {
  title: "Tạo tài khoản",
};

const TEXT_LINK =
  "rounded-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const POINTS: BrandPoint[] = [
  {
    label: "Ghi chú buổi học nhanh chóng",
    description: "Ghi lại đầy đủ ghi chú một buổi học trong chưa đến 60 giây.",
  },
  {
    label: "Báo cáo tự động",
    description:
      "Báo cáo hằng tháng chuyên nghiệp gửi phụ huynh — không cần soạn thảo.",
  },
  {
    label: "Trực quan hóa tiến bộ",
    description: "Biểu đồ rõ ràng thể hiện hành trình IELTS của từng học viên.",
  },
];

/**
 * The Figma opens this panel with "Join hundreds of independent English and
 * IELTS teachers who use EduTrack" — a claim the product cannot yet make. The
 * second half of the sentence is kept verbatim; the count is dropped.
 */
const BRAND = (
  <BrandPanel
    headline="Bắt đầu theo dõi tiến bộ của học viên chỉ trong vài phút."
    description="Dành cho giáo viên tiếng Anh và IELTS tự do muốn dành ít thời gian ghi chép hơn và nhiều thời gian giảng dạy hơn."
    points={POINTS}
  />
);

/**
 * Sign-up.
 *
 * Public sign-up is student-only by construction rather than by convention:
 * there is no role control on this form, and adding one would achieve nothing,
 * because `app.handle_new_user` hard-codes `role = 'student'` and reads only
 * `full_name` from the sign-up metadata. Teacher accounts are provisioned by
 * `app.provision_teacher`, which only `service_role` may execute — which is why
 * none of the copy here describes the account as a teacher account, though the
 * Figma's does.
 */
export default async function SignUpPage({ searchParams }: PageSearchParams) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const pending = typeof params.pending === "string" ? params.pending : undefined;

  // Reached when signUp returned no session, which is the expected outcome while
  // email confirmation is required. It is also what an already-registered
  // address produces — Supabase deliberately makes the two indistinguishable so
  // sign-up cannot be used to test whether an account exists, so this message
  // must not claim the account is new.
  if (pending) {
    return (
      <AuthShell brand={BRAND}>
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Kiểm tra hộp thư của bạn</CardTitle>
            <CardDescription>
              Nếu có thể tạo tài khoản cho{" "}
              <span className="font-medium text-foreground">{pending}</span>, một
              liên kết xác nhận đang được gửi tới. Hãy mở liên kết đó để hoàn tất
              đăng nhập.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/auth/login" className={TEXT_LINK}>
                Quay lại đăng nhập
              </Link>
            </p>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={BRAND}>
      <div className="mb-8 space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">
          Tạo tài khoản
        </h1>
        <p className="text-sm text-muted-foreground">
          Thiết lập tài khoản EduTrack miễn phí của bạn
        </p>
      </div>

      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <form action={signInWithGoogle} className="mb-5">
        <GoogleButton label="Đăng ký với Google" />
      </form>

      <OrDivider label="hoặc đăng ký bằng email" className="mb-5" />

      <form action={signUpWithPassword} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Họ và tên</Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Nguyễn Thị Linh"
            maxLength={120}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Địa chỉ email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Mật khẩu</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Tối thiểu 8 ký tự"
            minLength={8}
            required
          />
        </div>

        <SubmitButton pendingLabel="Đang tạo tài khoản…" className="mt-2 w-full">
          Tạo tài khoản
        </SubmitButton>
      </form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Đã có tài khoản?{" "}
        <Link href="/auth/login" className={TEXT_LINK}>
          Đăng nhập
        </Link>
      </p>
    </AuthShell>
  );
}
