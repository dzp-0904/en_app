"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  isAttendanceStatus,
  type AttendanceStatus,
} from "@/lib/attendance";

/**
 * The four marks a teacher can give one student, showing the pressed one at
 * once rather than after the round trip.
 *
 * `useFormStatus` reports the submission of the nearest parent `<form>`, and in
 * React 19 it reports the `FormData` being sent with it. That is the whole
 * mechanism: while a submission is in flight the button matching the submitted
 * `status` is drawn as selected, and the moment the transition settles the
 * component re-renders from `recorded` — the value the server actually stored.
 *
 * Chosen over `useOptimistic` because it needs nothing from the form itself.
 * `useOptimistic` would require the `action` prop to become a client function
 * wrapping the Server Action, and Next.js can only render a form's no-JavaScript
 * fallback when `action` *is* the Server Action. Every form in this application
 * works without JavaScript; this one still does, and gains the fast feedback
 * anyway.
 *
 * Nothing here is a claim that the write succeeded. `pending` is true only while
 * the request is open; when it ends, what is drawn is `recorded` again. A failed
 * action redirects with `?error=`, the page re-renders with the old mark, and
 * the button visibly returns to where it was — so the optimism cannot outlive
 * the failure. `isAttendanceStatus` guards the submitted value because
 * `FormData.get` returns whatever is in the form, and a value outside the enum
 * must not light a button the server is about to reject.
 *
 * The "Chưa ghi nhận" line lives here rather than beside it so that the words and
 * the buttons cannot disagree during a submission.
 */
export function AttendanceButtons({
  recorded,
}: {
  recorded: AttendanceStatus | null;
}) {
  const { pending, data } = useFormStatus();

  const submitted = data?.get("status");
  const shown =
    pending && typeof submitted === "string" && isAttendanceStatus(submitted)
      ? submitted
      : recorded;

  return (
    <>
      {shown === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Chưa ghi nhận</p>
      ) : null}

      {/* `aria-busy` rather than `disabled`: a teacher marking a whole roster
          should be able to correct a misclick immediately, and disabling the
          row mid-flight would swallow that second press. Two presses are safe —
          the action upserts on `(session_id, class_member_id)`, so the second
          overwrites the first and the last one to reach the database wins. */}
      <div
        className="mt-3 flex flex-wrap gap-2"
        aria-busy={pending || undefined}
      >
        {ATTENDANCE_STATUSES.map((status) => (
          <Button
            key={status}
            type="submit"
            name="status"
            value={status}
            size="sm"
            variant={shown === status ? "default" : "outline"}
          >
            {ATTENDANCE_LABELS[status]}
          </Button>
        ))}
      </div>
    </>
  );
}
