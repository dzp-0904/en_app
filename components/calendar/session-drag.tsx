"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { moveSessionToDate } from "@/app/teacher/[classId]/actions";
import { Alert } from "@/components/ui/alert";

/**
 * Dragging a lesson from one day to another.
 *
 * ## What it is, and what it is not
 *
 * It is a thin layer around the grid, not a replacement for it. The week, the
 * columns and every lesson block are still server-rendered by `WeekGrid`; this
 * component adds three listeners, one hidden form and one error line. That is
 * why it is the eighth client component and not the eighth *page* — no
 * protected data is fetched here, no row is rendered here, and with JavaScript
 * off it contributes nothing at all, which is the correct amount for an
 * enhancement.
 *
 * ## Event delegation, because the blocks belong to the server
 *
 * The blocks are children passed in from a Server Component, so this file
 * cannot hand them props. It listens on the container instead and finds the
 * block and the day column with `closest()` over two data attributes that
 * `WeekGrid` writes. Adding a tenth lesson to the week costs no listeners.
 *
 * ## No optimistic move, deliberately
 *
 * The milestone forbids "a client-only optimistic update that can leave the UI
 * inconsistent with the database", and this is where that would be tempting: a
 * dropped block could be repositioned instantly and reconciled later. It is
 * not. The drop fills a real `<form>` and submits it; `moveSessionToDate`
 * re-establishes the teacher, the class and the session on the server, writes
 * the row, and revalidates. The block moves when the server says it moved, and
 * never before. While that is in flight the grid is `aria-busy` and says so;
 * if it fails, the block is still exactly where the database thinks it is and
 * the reason is printed above the calendar.
 *
 * ## Drag is never the only way
 *
 * A pointer gesture is unavailable to a keyboard, to most assistive technology,
 * and to anyone with JavaScript disabled. So the same change is a plain form
 * on the session's own page — reached by the same link the block already is —
 * and the hint under the grid says so. Nothing here is the sole route to any
 * capability.
 */

/** Written by `WeekGrid` on each lesson block and on each day column. */
const BLOCK = "[data-session-block]";
const COLUMN = "[data-day]";

/** The wash a column takes while a block is held over it. */
const OVER = ["outline-2", "outline-primary", "-outline-offset-2", "outline"];

type Held = { sessionId: string; classId: string; fromDate: string };

export function SessionDrag({ children }: { children: React.ReactNode }) {
  const [state, formAction, isPending] = useActionState(moveSessionToDate, null);

  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const held = useRef<Held | null>(null);
  const over = useRef<HTMLElement | null>(null);

  // Filled at drop time and submitted immediately. Controlled React state would
  // need a render between the drop and the submit; a ref plus `requestSubmit`
  // does it in one turn, and the values are re-validated on the server anyway.
  const [fields, setFields] = useState<Held & { date: string }>({
    sessionId: "",
    classId: "",
    fromDate: "",
    date: "",
  });

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    function clearOver() {
      if (over.current) {
        over.current.classList.remove(...OVER);
        over.current = null;
      }
    }

    function onDragStart(event: DragEvent) {
      const target = event.target as HTMLElement | null;
      const block = target?.closest?.(BLOCK) as HTMLElement | null;
      if (!block) return;

      const { sessionId, classId, fromDate } = block.dataset;
      if (!sessionId || !classId || !fromDate) return;

      held.current = { sessionId, classId, fromDate };

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        // Some browsers refuse to start a drag with no payload at all. The
        // payload is never read back — `held` is what the drop uses, because
        // `dataTransfer` cannot be read during `dragover`.
        event.dataTransfer.setData("text/plain", sessionId);
      }
    }

    function onDragOver(event: DragEvent) {
      if (!held.current) return;

      const target = event.target as HTMLElement | null;
      const column = target?.closest?.(COLUMN) as HTMLElement | null;
      if (!column) return;

      // Without this the browser refuses the drop entirely.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      if (over.current !== column) {
        clearOver();
        column.classList.add(...OVER);
        over.current = column;
      }
    }

    function onDrop(event: DragEvent) {
      const carried = held.current;
      held.current = null;
      clearOver();
      if (!carried) return;

      const target = event.target as HTMLElement | null;
      const column = target?.closest?.(COLUMN) as HTMLElement | null;
      const date = column?.dataset.day;
      if (!date) return;

      event.preventDefault();

      // Dropped back where it started: nothing to say to the server.
      if (date === carried.fromDate) return;

      setFields({ ...carried, date });
      // After the state lands, so the hidden inputs carry the new values.
      queueMicrotask(() => formRef.current?.requestSubmit());
    }

    function onDragEnd() {
      held.current = null;
      clearOver();
    }

    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("drop", onDrop);
    root.addEventListener("dragend", onDragEnd);

    return () => {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("dragend", onDragEnd);
      clearOver();
    };
  }, []);

  return (
    <div>
      {state && "error" in state ? (
        <div className="mb-4">
          <Alert>{state.error}</Alert>
        </div>
      ) : null}

      <div ref={containerRef} aria-busy={isPending || undefined}>
        {children}
      </div>

      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="classId" value={fields.classId} readOnly />
        <input type="hidden" name="sessionId" value={fields.sessionId} readOnly />
        <input type="hidden" name="date" value={fields.date} readOnly />
      </form>

      {/* One `role="status"` covering both messages, so the pending line and
          the hint never both claim the live region. The hint is the accessible
          alternative's signpost, and it is visible to everyone rather than
          hidden for screen readers only — a keyboard user needs it just as
          much and cannot discover a drag target by looking. */}
      <p
        role="status"
        className="mt-3 text-xs text-muted-foreground"
      >
        {isPending
          ? "Đang chuyển buổi học…"
          : "Kéo một buổi học sang cột ngày khác để đổi ngày. Bạn cũng có thể mở buổi học và sửa ngày, giờ trong phần Lịch buổi học."}
      </p>
    </div>
  );
}
