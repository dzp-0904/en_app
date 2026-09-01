"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { moveSessionToSlot } from "@/app/teacher/[classId]/actions";
import { Alert } from "@/components/ui/alert";

/**
 * Dragging a lesson to another day, another time, or both.
 *
 * ## What it is, and what it is not
 *
 * It is a thin layer around the grid, not a replacement for it. The week, the
 * columns and every lesson block are still server-rendered by `WeekGrid`; this
 * component adds four listeners, one hidden form, one preview and one error
 * line. That is why it is a client component and not a client *page* — no
 * protected data is fetched here, no row is rendered here, and with JavaScript
 * off it contributes nothing at all, which is the correct amount for an
 * enhancement.
 *
 * ## Two axes, because the grid has two
 *
 * The horizontal axis is the day and the vertical axis is the time, so a drag
 * that only read the column was ignoring half of what the calendar draws. A
 * drop now yields both, and the arithmetic is the inverse of the one
 * `WeekGrid` renders with:
 *
 *   block top  = ((startMinutes − startHour × 60) / 60) × slotHeight + 2
 *   startMinutes = ((top − 2) / slotHeight) × 60 + startHour × 60
 *
 * `top` is measured against the day column's own box, which is exactly the
 * drawn window — the column starts at `startHour` and is
 * `(endHour − startHour) × slotHeight` tall — so no page offset, scroll
 * position or card padding enters the sum. The grab offset is carried from
 * `dragstart`, which is what makes the block land where it looks like it will
 * rather than snapping its top to the pointer.
 *
 * The result is a **wall clock on the class's own timezone**: the grid's
 * vertical axis is that clock, and the minutes are turned into `HH:MM` and sent
 * as text. `instantOf` on the server does the single conversion to an instant.
 * No UTC arithmetic happens here, and no `Date` is constructed from a lesson at
 * all.
 *
 * ## Snapping
 *
 * Fifteen minutes — one quarter of the 64px hour band, so a snap step is 16px
 * and every half hour the grid already rules is reachable. It is applied here
 * and *not* enforced on the server, deliberately: the accessible date-and-times
 * form can set 19:07 and must keep being able to, so the server's rule stays
 * "a valid `HH:MM`" and the snap stays what it is — a pointer aid.
 *
 * ## No optimistic move, deliberately
 *
 * The drop fills a real `<form>` and submits it; `moveSessionToSlot`
 * re-establishes the teacher, the class and the session on the server, writes
 * the row, and revalidates. The block moves when the server says it moved, and
 * never before. While that is in flight the grid is `aria-busy` and says so; if
 * it fails, the block is still exactly where the database thinks it is and the
 * reason is printed above the calendar.
 *
 * The preview drawn under the pointer is not an exception to that. It is a
 * dashed outline in a fixed-position overlay that no part of the grid depends
 * on, it says which slot the drop would ask for, and it is gone before the
 * request is sent. Nothing about the lesson's rendered position changes until
 * the server answers.
 *
 * ## Drag is never the only way
 *
 * A pointer gesture is unavailable to a keyboard, to most assistive technology,
 * and to anyone with JavaScript disabled. So the same change is a plain form on
 * the session's own page — reached by the same link the block already is — and
 * the hint under the grid says so. Nothing here is the sole route to any
 * capability.
 */

/** Written by `WeekGrid` on each lesson block and on each day column. */
const BLOCK = "[data-session-block]";
const COLUMN = "[data-day]";

/** The wash a column takes while a block is held over it. */
const OVER = ["outline-2", "outline-primary", "-outline-offset-2", "outline"];

/** `WeekGrid`'s `inset-x-0.5` and its 2px vertical inset, in pixels. */
const INSET = 2;

/** The snap step. See the note above. */
const SNAP = 15;

type Held = {
  sessionId: string;
  classId: string;
  fromDate: string;
  fromTime: string;
  /** `fromTime` as a minute of the day, for the unchanged-slot comparison. */
  fromMinutes: number;
  /** How long the lesson runs, in minutes on the class's clock. */
  duration: number;
  /** Where inside the block the pointer took hold of it, in pixels. */
  grab: number;
};

type Ghost = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
};

/** The `HH:MM` the grid prints, as a minute of the day. */
function minutesOf(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

/** Minutes past midnight as the `HH:MM` the server and the grid both speak. */
function clockOf(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  return (
    String(hour).padStart(2, "0") + ":" + String(wrapped % 60).padStart(2, "0")
  );
}

export function SessionDrag({
  children,
  startHour,
  endHour,
  slotHeight,
}: {
  children: React.ReactNode;
  /** The window `WeekGrid` drew, so the inverse arithmetic uses the same one. */
  startHour: number;
  endHour: number;
  slotHeight: number;
}) {
  const [state, formAction, isPending] = useActionState(moveSessionToSlot, null);

  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const held = useRef<Held | null>(null);
  const over = useRef<HTMLElement | null>(null);

  const [ghost, setGhost] = useState<Ghost | null>(null);

  // Filled at drop time and submitted immediately. Controlled React state would
  // need a render between the drop and the submit; a ref plus `requestSubmit`
  // does it in one turn, and the values are re-validated on the server anyway.
  const [fields, setFields] = useState({
    sessionId: "",
    classId: "",
    date: "",
    startTime: "",
  });

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const windowStart = startHour * 60;
    const windowEnd = endHour * 60;

    function clearOver() {
      if (over.current) {
        over.current.classList.remove(...OVER);
        over.current = null;
      }
    }

    /**
     * A minute of the day rounded onto the grid: snapped to the step, kept
     * inside the drawn window, and kept far enough from its foot that the
     * lesson still fits underneath. The floor on `latest` is what makes *every*
     * value this can return a quarter hour, the clamped one included — a lesson
     * pushed to the bottom lands on 21:45 rather than on whatever odd minute
     * `endHour − duration` happens to be. A lesson longer than the window
     * itself pins to the top instead of being pushed above it.
     */
    function snapInto(raw: number, duration: number) {
      const snapped = Math.round(raw / SNAP) * SNAP;
      const latest = Math.max(
        windowStart,
        Math.floor((windowEnd - Math.max(duration, SNAP)) / SNAP) * SNAP,
      );

      return Math.min(Math.max(snapped, windowStart), latest);
    }

    /** Where the drop would put the lesson, given the pointer and a column. */
    function slotAt(clientY: number, column: HTMLElement, carried: Held) {
      const rect = column.getBoundingClientRect();
      const top = clientY - carried.grab - rect.top - INSET;

      return {
        minutes: snapInto(windowStart + (top / slotHeight) * 60, carried.duration),
        rect,
      };
    }

    function onDragStart(event: DragEvent) {
      const target = event.target as HTMLElement | null;
      const block = target?.closest?.(BLOCK) as HTMLElement | null;
      if (!block) return;

      const { sessionId, classId, fromDate, fromTime, duration } = block.dataset;
      if (!sessionId || !classId || !fromDate || !fromTime) return;

      held.current = {
        sessionId,
        classId,
        fromDate,
        fromTime,
        fromMinutes: minutesOf(fromTime),
        duration: Number(duration) || SNAP,
        grab: event.clientY - block.getBoundingClientRect().top,
      };

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        // Some browsers refuse to start a drag with no payload at all. The
        // payload is never read back — `held` is what the drop uses, because
        // `dataTransfer` cannot be read during `dragover`.
        event.dataTransfer.setData("text/plain", sessionId);
      }
    }

    function onDragOver(event: DragEvent) {
      const carried = held.current;
      if (!carried) return;

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

      const { minutes, rect } = slotAt(event.clientY, column, carried);

      setGhost((current) => {
        const next: Ghost = {
          left: rect.left + INSET,
          top: rect.top + ((minutes - windowStart) / 60) * slotHeight + INSET,
          width: Math.max(rect.width - INSET * 2, 0),
          height: Math.max((carried.duration / 60) * slotHeight - INSET * 2, 18),
          label:
            clockOf(minutes) + "–" + clockOf(minutes + carried.duration),
        };

        // `dragover` fires continuously. Re-rendering only when the preview
        // would actually look different keeps this to one render per snap step
        // rather than one per pointer sample.
        if (
          current &&
          current.top === next.top &&
          current.left === next.left &&
          current.width === next.width &&
          current.height === next.height
        ) {
          return current;
        }

        return next;
      });
    }

    function onDrop(event: DragEvent) {
      const carried = held.current;
      held.current = null;
      clearOver();
      setGhost(null);
      if (!carried) return;

      const target = event.target as HTMLElement | null;
      const column = target?.closest?.(COLUMN) as HTMLElement | null;
      const date = column?.dataset.day;
      if (!column || !date) return;

      event.preventDefault();

      const { minutes } = slotAt(event.clientY, column, carried);
      const startTime = clockOf(minutes);

      // Dropped back on the slot it already occupies: nothing to say to the
      // server. Both halves have to match, because either one alone can be the
      // thing the drag changed.
      //
      // "The slot it occupies" is the lesson's start rounded the same way the
      // drop was, not its stored minute. A lesson at 12:01 draws in the 12:00
      // slot, so picking it up and putting it back down must be a no-op —
      // comparing against the raw 12:01 would have made every such gesture a
      // silent one-minute nudge, and a drag the teacher cancelled by returning
      // it would still have written. Minute-level precision belongs to the form
      // on the session's page, which is exactly where it stays.
      if (
        date === carried.fromDate &&
        minutes === snapInto(carried.fromMinutes, carried.duration)
      ) {
        return;
      }

      setFields({
        sessionId: carried.sessionId,
        classId: carried.classId,
        date,
        startTime,
      });
      // After the state lands, so the hidden inputs carry the new values.
      queueMicrotask(() => formRef.current?.requestSubmit());
    }

    function onDragEnd() {
      held.current = null;
      clearOver();
      setGhost(null);
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
  }, [startHour, endHour, slotHeight]);

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

      {/* The preview. Fixed to the viewport rather than inserted into a column,
          so the server-rendered grid keeps every one of its own children and
          React never has to reconcile around a node it did not create. It is
          `aria-hidden` and `pointer-events-none`: it carries no information a
          screen reader could not get from the block itself, and it must never
          become the thing a drop lands on. */}
      {ghost ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 flex items-start overflow-hidden rounded-lg border-2 border-dashed border-primary bg-secondary/70 px-2 py-1 text-[10px] leading-tight font-semibold text-primary-hover"
          style={{
            left: ghost.left,
            top: ghost.top,
            width: ghost.width,
            height: ghost.height,
          }}
        >
          <span className="truncate">{ghost.label}</span>
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="classId" value={fields.classId} readOnly />
        <input type="hidden" name="sessionId" value={fields.sessionId} readOnly />
        <input type="hidden" name="date" value={fields.date} readOnly />
        <input
          type="hidden"
          name="startTime"
          value={fields.startTime}
          readOnly
        />
      </form>

      {/* One `role="status"` covering both messages, so the pending line and
          the hint never both claim the live region. The hint is the accessible
          alternative's signpost, and it is visible to everyone rather than
          hidden for screen readers only — a keyboard user needs it just as
          much and cannot discover a drag target by looking. */}
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        {isPending
          ? "Đang chuyển buổi học…"
          : "Kéo một buổi học sang cột khác để đổi ngày, lên xuống để đổi giờ. Bạn cũng có thể mở buổi học và sửa ngày, giờ trong phần Lịch buổi học."}
      </p>
    </div>
  );
}
