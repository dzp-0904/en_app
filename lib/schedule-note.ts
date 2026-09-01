/**
 * `classes.schedule_note`, read in Vietnamese.
 *
 * The column is free text the teacher typed, and the migration's own comment
 * marks it display-only — `class_sessions` is what actually says when a lesson
 * happens. Nothing is parsed out of it, nothing is derived from it, and nothing
 * here writes it back: this module translates the English weekday *words* a note
 * may contain so the class list reads in one language, and leaves every other
 * character exactly as it was typed.
 *
 * WHY A DISPLAY-TIME TRANSLATION AND NOT A MIGRATION. The stored value is the
 * teacher's own sentence. Rewriting rows would be editing user data (§3 — user
 * text is never translated), and it would still be wrong the next time somebody
 * typed "Tuesday & Thursday" into the class form. Translating on the way to the
 * screen leaves the record intact and keeps the edit form — which prefills from
 * this same column and posts it straight back — printing what will be saved.
 * **Do not call this from `components/class/class-form.tsx`.**
 *
 * WHY THE WORDS ARE NOT `WEEKDAY_SHORT`. `lib/calendar.ts` already names the
 * days, but as `T2`…`T7` / `CN`: two characters chosen to keep an 88px calendar
 * column narrow. A schedule sentence is read as prose, so it wants the spoken
 * form, and that module is `server-only` besides. Two vocabularies for two
 * jobs — one table each, neither guessing at the other's constraints.
 *
 * The time of day is left untouched, deliberately. "7:30 PM" is what the teacher
 * wrote; §7's 24-hour rule governs times this application *derives* from
 * `timestamptz` instants, and this is not one of those. Rewriting the hour would
 * also mean guessing at an AM/PM the note may not carry.
 */

/**
 * Every English spelling of a weekday that a teacher plausibly types, and the
 * Vietnamese it reads as. Long forms, plurals and the usual abbreviations, all
 * lowercase — the pattern below matches case-insensitively.
 *
 * Vietnamese numbers its weekdays from Sunday, so Monday is the *second* day:
 * Thứ 2 … Thứ 7, and Sunday is Chủ nhật rather than "Thứ 1". Getting that off by
 * one would move every class by a day, which is why it is a table and not
 * arithmetic.
 */
const WEEKDAY_LABELS: Readonly<Record<string, string>> = {
  monday: "Thứ 2",
  mondays: "Thứ 2",
  mon: "Thứ 2",
  tuesday: "Thứ 3",
  tuesdays: "Thứ 3",
  tues: "Thứ 3",
  tue: "Thứ 3",
  wednesday: "Thứ 4",
  wednesdays: "Thứ 4",
  weds: "Thứ 4",
  wed: "Thứ 4",
  thursday: "Thứ 5",
  thursdays: "Thứ 5",
  thurs: "Thứ 5",
  thur: "Thứ 5",
  thu: "Thứ 5",
  friday: "Thứ 6",
  fridays: "Thứ 6",
  fri: "Thứ 6",
  saturday: "Thứ 7",
  saturdays: "Thứ 7",
  sat: "Thứ 7",
  sunday: "Chủ nhật",
  sundays: "Chủ nhật",
  sun: "Chủ nhật",
};

/**
 * The alternation, longest spelling first.
 *
 * Order matters: a regular expression takes the first branch that matches, so
 * with `tue` ahead of `tuesday` the pattern would consume "Tue" and leave
 * "sday" behind. Sorting by length descending makes the longest spelling win
 * without anyone having to maintain the order by hand.
 *
 * `\b` on both sides so only whole words are touched — "Sunday" is a day,
 * "Sunshine" is not — and an optional trailing full stop so "Tue." loses the
 * abbreviation mark along with the word.
 */
const WEEKDAY_PATTERN = new RegExp(
  `\\b(${Object.keys(WEEKDAY_LABELS)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b\\.?`,
  "gi",
);

/**
 * "Thứ 3 and Thứ 5" → "Thứ 3 & Thứ 5".
 *
 * Run after the words are translated, and only *between* two of them, so the
 * separator the brief asks for appears where days are being listed and nowhere
 * else. A blanket "and" → "&" would rewrite the teacher's prose, and a blanket
 * comma rule would eat the one before the time.
 */
const WEEKDAY_CONJUNCTION = /(Thứ [2-7]|Chủ nhật) +and +(?=Thứ [2-7]|Chủ nhật)/gi;

/**
 * A schedule note as it should be read on screen, or `null` if there is none.
 *
 * `null` in, `null` out — and a note that is blank or only whitespace is `null`
 * too, because a cell containing three spaces is not a schedule and the caller
 * already knows how to say "Chưa đặt". A note with no English in it is returned
 * unchanged, which covers a teacher who typed Vietnamese in the first place.
 */
export function localiseScheduleNote(note: string | null): string | null {
  if (note === null) return null;

  const trimmed = note.trim();
  if (trimmed === "") return null;

  return trimmed
    .replace(WEEKDAY_PATTERN, (match) => {
      const key = match.replace(/\.$/, "").toLowerCase();
      // The table is built from the same keys the pattern is, so a match always
      // resolves; the fallback is there so a future edit to one and not the
      // other degrades to the teacher's own word rather than to "undefined".
      return WEEKDAY_LABELS[key] ?? match;
    })
    .replace(WEEKDAY_CONJUNCTION, "$1 & ");
}
