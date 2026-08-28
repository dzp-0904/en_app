import type { Database } from "./database.types";

/**
 * Nullability corrections for `public.get_class_invite_preview`.
 *
 * `supabase gen types typescript` derives an RPC's return shape from the
 * function's `RETURNS TABLE (...)` signature, and PostgreSQL records no
 * nullability on those output columns — so every field arrives typed as
 * non-nullable. For this RPC three of them are wrong: it selects
 * `classes.target_band`, `classes.end_date` and `classes.schedule_note`, all
 * of which are nullable columns, and all three are genuinely absent for real
 * classes (a General English class has no target band; an open-ended course
 * has no end date).
 *
 * The fix belongs here, not in the database. Adding NOT NULL or a sentinel
 * default to those columns to satisfy a code generator would corrupt the data
 * model — "no target band" and "target band 0.0" are different facts, and the
 * invite preview is the one place a wrong answer is shown to a stranger.
 *
 * Regenerating `database.types.ts` does not disturb this file: it derives from
 * the generated row type, so a column added to the RPC appears here
 * automatically, and a column removed becomes a compile error.
 */

type GeneratedInvitePreviewRow =
  Database["public"]["Functions"]["get_class_invite_preview"]["Returns"][number];

/** The output columns whose generated non-nullability is incorrect. */
type NullableInvitePreviewColumns = "target_band" | "end_date" | "schedule_note";

export type InvitePreview = Omit<
  GeneratedInvitePreviewRow,
  NullableInvitePreviewColumns
> & {
  /** Absent when the class has no band goal — every non-IELTS class. */
  target_band: number | null;
  /** Absent for an open-ended course. ISO date string. */
  end_date: string | null;
  /** Free text such as "Tue/Thu 19:00". Absent when the teacher left it blank. */
  schedule_note: string | null;
};

/**
 * The RPC returns zero rows for a code that is unknown, expired, revoked,
 * exhausted, or attached to an archived class — all five look identical on
 * purpose, so probing cannot tell "wrong code" from "real code, closed".
 * Callers therefore get `null`, never an error that distinguishes the cases.
 */
export type InvitePreviewResult = InvitePreview | null;

/**
 * Narrows one row of a `get_class_invite_preview` response.
 *
 * This is a type-level correction only — there is no runtime coercion, because
 * the values PostgREST sends are already correct. Pass the first element of the
 * RPC's array response, or `undefined`/`null` when it came back empty.
 */
export function toInvitePreview(
  row: GeneratedInvitePreviewRow | null | undefined,
): InvitePreviewResult {
  if (!row) return null;
  return row as InvitePreview;
}
