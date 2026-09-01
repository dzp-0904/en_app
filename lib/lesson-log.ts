import type { Database } from "./database.types";

/**
 * `public.skill` and `public.performance`, and what each value is called on
 * screen.
 *
 * Shared and pure for the same reason `lib/attendance.ts` and
 * `lib/course-type.ts` are: these are mirrors of database enums, not anyone's
 * logic. The page offers the options and the Server Action checks what came
 * back, and those two lists have to be the same list.
 *
 * The lengths below are the other half of that mirror. `topic` carries a real
 * CHECK constraint, so its limit is the schema's own number rather than a taste
 * decision — see `lesson_logs_topic_length` in
 * `20260828000400_tables_sessions_scores.sql`. `note` is unbounded `text`, so
 * its limit is an application decision and is marked as one.
 */

export type Skill = Database["public"]["Enums"]["skill"];
export type Performance = Database["public"]["Enums"]["performance"];

/** Every value `public.skill` carries, in the order the enum declares them. */
export const SKILLS = [
  "reading",
  "listening",
  "writing",
  "speaking",
  "general",
] as const satisfies readonly Skill[];

export const SKILL_LABELS: Record<Skill, string> = {
  reading: "Đọc",
  listening: "Nghe",
  writing: "Viết",
  speaking: "Nói",
  general: "Tổng quát",
};

export function isSkill(value: string): value is Skill {
  return (SKILLS as readonly string[]).includes(value);
}

/** Every value `public.performance` carries, strongest first. */
export const PERFORMANCE_LEVELS = [
  "excellent",
  "good",
  "developing",
  "needs_attention",
] as const satisfies readonly Performance[];

/**
 * What each `public.performance` value is called on screen.
 *
 * M28 reworded all four. The **stored values are unchanged** — `excellent`,
 * `good`, `developing` and `needs_attention` are still what the database holds
 * and still what the `<select>` submits — so every historical `lesson_logs` row
 * keeps its meaning and simply reads with the new word. This is a display map,
 * not a migration, which is exactly why one edit here reaches the note form,
 * both lesson pages, the class-detail note list, Nhật ký buổi học, the student
 * feedback panels and the monthly report preview.
 *
 * The order is still strongest first, so the tone tables that sit beside this
 * map — green / primary / orange / destructive, in `PERFORMANCE_LEVELS` order —
 * keep pairing the right colour with the right word.
 *
 * `developing` and `needs_attention` deliberately no longer read as
 * encouragement ("Đang tiến bộ", "Cần chú ý"): the teacher asked for a scale
 * that says plainly when a student is behind. "Đang tiến bộ" also collided with
 * `MEMBER_STATUS_LABELS.improving` in `lib/score.ts`, which is a different enum
 * on a different screen; the two no longer share a word.
 */
export const PERFORMANCE_LABELS: Record<Performance, string> = {
  excellent: "Học nhanh",
  good: "Có cố gắng",
  developing: "Cần cải thiện",
  needs_attention: "Cảnh báo",
};

export function isPerformance(value: string): value is Performance {
  return (PERFORMANCE_LEVELS as readonly string[]).includes(value);
}

/** `lesson_logs_topic_length`: `length(btrim(topic)) between 1 and 300`. */
export const TOPIC_MAX_LENGTH = 300;

/**
 * A cap on the note itself.
 *
 * `lesson_logs.note` is plain `text` with no constraint, so this number is the
 * application's and not the database's. It exists so that a runaway paste is
 * refused with a sentence a teacher can act on rather than stored, and it is
 * generous enough that no real post-lesson note reaches it. Nothing truncates:
 * over-long input is rejected with the text still in the teacher's hands.
 */
export const NOTE_MAX_LENGTH = 2000;
