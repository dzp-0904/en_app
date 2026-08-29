import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * SMTP transport.
 *
 * `server-only` at the top is the enforcement, not a comment: importing this
 * module from a Client Component is a build error, so the credentials below
 * cannot reach the browser by accident.
 *
 * None of these variables are `NEXT_PUBLIC_`. They are read at call time rather
 * than at module load so that `next build` — which runs in Docker with no
 * mailbox configured — does not fail, and so that a credential rotation takes
 * effect on container restart without a rebuild.
 */

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

export class MailNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Mail is not configured. Missing: ${missing.join(", ")}.`);
    this.name = "MailNotConfiguredError";
  }
}

/**
 * Reads and validates the SMTP environment.
 *
 * Throws `MailNotConfiguredError` naming the missing variables — never their
 * values, so a misconfiguration is diagnosable from logs without the password
 * appearing in them.
 */
function readConfig(): MailConfig {
  const host = process.env.SMTP_HOST?.trim();
  const port = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;

  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!password) missing.push("SMTP_PASSWORD");

  if (missing.length > 0) {
    throw new MailNotConfiguredError(missing);
  }

  const parsedPort = Number.parseInt(port!, 10);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new MailNotConfiguredError(["SMTP_PORT (not a valid port number)"]);
  }

  return { host: host!, port: parsedPort, user: user!, password: password! };
}

let cached: Transporter | null = null;

/**
 * One pooled transport per process.
 *
 * `secure: true` is implicit SMTPS, which is what port 465 speaks — the
 * connection is wrapped in TLS before the SMTP conversation starts, rather than
 * being upgraded mid-session by STARTTLS. Deriving it from the port keeps 587
 * working too, should the mailbox ever move.
 */
function transport(): Transporter {
  if (cached) return cached;

  const config = readConfig();

  cached = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    // Cap the wait so a hanging mail server cannot hold a Server Action open
    // until the platform's own request timeout kills it.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return cached;
}

/** The mailbox every EduTrack message is sent from. */
export function fromAddress(): string {
  return `EduTrack <${readConfig().user}>`;
}

export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Sends one message.
 *
 * Rejects on failure rather than returning a boolean, so a caller cannot report
 * success by forgetting to check a result. Callers are expected to catch and
 * translate — see `app/onboarding/actions.ts`, which keeps the invitation row
 * and tells the teacher the email did not go out.
 */
export async function sendMail(mail: Mail): Promise<void> {
  await transport().sendMail({
    from: fromAddress(),
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}
