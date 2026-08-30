import "server-only";

/**
 * Supabase's own authentication errors, said in Vietnamese.
 *
 * Until this milestone the auth actions reflected `error.message` verbatim,
 * which was the right call in an English UI: GoTrue writes these strings
 * carefully — "Invalid login credentials" covers a wrong password and an
 * unknown address alike, precisely so that sign-in cannot be used to test
 * whether an account exists — and a specific sentence helps more than a generic
 * one. In a Vietnamese UI reflecting them verbatim means the only English left
 * on the screen is the sentence shown at the worst moment.
 *
 * So the mapping is a presentation layer and nothing more. Nothing here changes
 * which errors occur, which branch runs, or where the redirect goes; the same
 * failure still arrives from the same server-side call and still lands on the
 * same page with the same `?error=` parameter. The non-enumerability of the
 * originals is preserved in the translations: "Email hoặc mật khẩu không đúng"
 * is exactly as uninformative about whether the account exists as "Invalid
 * login credentials" is.
 *
 * Matching is on a normalised substring rather than equality because GoTrue
 * interpolates numbers into several of these ("Password should be at least 6
 * characters", "you can only request this after 41 seconds") and has reworded
 * others between releases. An unrecognised message is not shown: it could be
 * anything, including text that names an internal detail, so it becomes a
 * generic sentence and the original goes to the server log instead.
 */

type Rule = { match: string; message: string };

/**
 * Longest, most specific patterns first — the first match wins, and several of
 * these share words.
 */
const RULES: Rule[] = [
  {
    match: "invalid login credentials",
    message: "Email hoặc mật khẩu không đúng.",
  },
  {
    match: "email not confirmed",
    message:
      "Địa chỉ email này chưa được xác nhận. Hãy mở liên kết xác nhận trong hộp thư của bạn.",
  },
  {
    match: "user already registered",
    message: "Địa chỉ email này đã được đăng ký.",
  },
  {
    match: "new password should be different",
    message: "Mật khẩu mới phải khác mật khẩu cũ.",
  },
  {
    match: "password should be at least",
    message: "Mật khẩu quá ngắn. Vui lòng dùng ít nhất 8 ký tự.",
  },
  {
    match: "signup requires a valid password",
    message: "Vui lòng nhập mật khẩu.",
  },
  {
    match: "unable to validate email address",
    message: "Địa chỉ email này không hợp lệ.",
  },
  {
    match: "for security purposes",
    message: "Bạn vừa thực hiện thao tác này. Vui lòng đợi một lát rồi thử lại.",
  },
  {
    match: "rate limit exceeded",
    message: "Đã có quá nhiều lượt thử. Vui lòng đợi một lát rồi thử lại.",
  },
  {
    match: "over_email_send_rate_limit",
    message: "Đã có quá nhiều lượt thử. Vui lòng đợi một lát rồi thử lại.",
  },
  {
    match: "email link is invalid or has expired",
    message: "Liên kết này không hợp lệ hoặc đã hết hạn. Hãy yêu cầu một liên kết mới.",
  },
  {
    match: "token has expired or is invalid",
    message: "Liên kết này không hợp lệ hoặc đã hết hạn. Hãy yêu cầu một liên kết mới.",
  },
  {
    match: "signups not allowed",
    message: "Hiện chưa thể tạo tài khoản mới.",
  },
  {
    match: "user not found",
    message: "Không tìm thấy tài khoản nào cho địa chỉ email này.",
  },
  {
    match: "access_denied",
    message: "Bạn đã hủy đăng nhập bằng Google.",
  },
  {
    match: "provider is not enabled",
    message: "Hiện không thể đăng nhập bằng Google. Vui lòng thử lại.",
  },
];

/** Shown when the provider said something this file does not recognise. */
const FALLBACK = "Đăng nhập không thành công. Vui lòng thử lại.";

/**
 * The Vietnamese sentence for one provider error.
 *
 * `context` names the call site in the server log so an unrecognised message is
 * still diagnosable. The raw text is logged, never rendered — it is written by
 * the provider, not by this application, and nothing guarantees it is fit to
 * show a student.
 */
export function authErrorMessage(raw: string | null | undefined, context: string): string {
  const text = (raw ?? "").trim();
  if (!text) return FALLBACK;

  const folded = text.toLowerCase();
  const rule = RULES.find((candidate) => folded.includes(candidate.match));

  if (rule) return rule.message;

  console.error(`[auth] ${context}: unmapped provider message`, { message: text });
  return FALLBACK;
}
