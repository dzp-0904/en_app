import "server-only";

import type { Mail } from "./mailer";

/**
 * The class invitation email.
 *
 * Written as a table-based document with inline styles because that is what mail
 * clients render reliably — Outlook has no flexbox or grid, and `<style>` blocks
 * are stripped by several webmail clients. The palette is the product's own
 * (#1B2036 navy, #4466EE indigo, #F7F6F1 cream) so the message looks like
 * EduTrack, but none of the app's CSS is reachable here.
 *
 * What it deliberately does NOT contain: the recipient's name, any other
 * student's details, the class roster, or anything about the teacher beyond the
 * display name that the invite preview already shows to anyone holding the code.
 * The email reveals nothing the link does not.
 */

export type InvitationDetails = {
  className: string;
  teacherName: string;
  joinUrl: string;
};

/** Escapes text interpolated into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function invitationEmail(
  to: string,
  details: InvitationDetails,
): Mail {
  const className = escapeHtml(details.className);
  const teacherName = escapeHtml(details.teacherName);
  // The URL is generated from a code drawn from a fixed alphabet, but it is
  // escaped anyway: an href built by concatenation should never depend on the
  // caller having sanitised its input.
  const url = escapeHtml(details.joinUrl);

  const subject = "You've been invited to join a class on EduTrack";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#F7F6F1;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F6F1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#FFFFFF;border:1px solid #E8E6DE;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 24px 32px;font-family:'Public Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;">

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                  <tr>
                    <td style="width:36px;height:36px;background-color:#4466EE;border-radius:12px;color:#FFFFFF;font-size:14px;font-weight:700;text-align:center;vertical-align:middle;font-family:'Public Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;">E</td>
                    <td style="padding-left:10px;font-size:18px;font-weight:600;color:#1B2036;">EduTrack</td>
                  </tr>
                </table>

                <h1 style="margin:0 0 8px 0;font-size:20px;line-height:1.35;font-weight:600;color:#1B2036;">
                  You've been invited to join a class
                </h1>

                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#4A5170;">
                  ${teacherName} has invited you to join <strong style="color:#1B2036;">${className}</strong> on EduTrack, where you can follow your lesson history and track your progress.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="background-color:#4466EE;border-radius:8px;">
                      <a href="${url}" style="display:inline-block;padding:12px 24px;font-family:'Public Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">Join class</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 6px 0;font-size:12px;line-height:1.5;color:#4A5170;">
                  If the button does not work, copy this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.5;word-break:break-all;">
                  <a href="${url}" style="color:#4466EE;text-decoration:none;">${url}</a>
                </p>

                <p style="margin:0;padding-top:20px;border-top:1px solid #E8E6DE;font-size:12px;line-height:1.5;color:#4A5170;">
                  If you weren't expecting this invitation you can ignore this email — nothing will be shared with anyone unless you join.
                </p>

              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "You've been invited to join a class on EduTrack",
    "",
    `${details.teacherName} has invited you to join "${details.className}" on EduTrack,`,
    "where you can follow your lesson history and track your progress.",
    "",
    "Join the class:",
    details.joinUrl,
    "",
    "If you weren't expecting this invitation you can ignore this email —",
    "nothing will be shared with anyone unless you join.",
    "",
    "EduTrack",
  ].join("\n");

  return { to, subject, html, text };
}
