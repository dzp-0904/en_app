/**
 * Wall-clock times in a class's own timezone.
 *
 * `class_sessions.starts_at` and `ends_at` are `timestamptz`, so what the
 * database stores is an instant — a fixed point on the world's timeline with no
 * opinion about where anyone was standing. What a teacher types is the opposite:
 * "7:30 PM" means half past seven *where the class meets*, and `classes.timezone`
 * (NOT NULL, default `'Asia/Ho_Chi_Minh'`) is the column that already records
 * where that is. These two functions are the join between them, and the only
 * place in the application where the conversion happens in either direction.
 *
 * Doing it here, rather than at each call site, is what keeps 1 Sept from
 * becoming 31 Aug. `new Date("2026-09-01T19:30")` reads the wall clock in
 * whichever zone the Node process happens to be running in, and
 * `Date.prototype.toLocaleDateString` without a `timeZone` reads it back in the
 * same one — so a server in UTC would store 19:30 UTC for a class in Vietnam
 * (02:30 the next morning locally) and a server in Los Angeles would store
 * something different again. Neither the machine's zone nor the reader's is ever
 * consulted below: every conversion names `classes.timezone` explicitly.
 *
 * This mirrors, rather than replaces, the date-only convention the rest of the
 * app uses. `classes.start_date` is a `date` — a calendar square, correctly read
 * as `T00:00:00Z` and formatted with `timeZone: "UTC"` — and it stays that way.
 * A session is an appointment, not a square, which is why it needs this instead.
 *
 * No dependency: `Intl` has known every IANA zone and its historical transitions
 * since Node 14, and a date library would be a second, disagreeing source of
 * truth for a rule the platform already implements.
 */

/**
 * `Intl.DateTimeFormat` is expensive to construct and immutable once built, and
 * a class page builds one per session row without this.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  zone: string,
  key: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${zone}\u0000${key}`;
  const cached = FORMATTERS.get(cacheKey);
  if (cached) return cached;

  let built: Intl.DateTimeFormat;

  try {
    built = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
  } catch {
    // `classes.timezone` is a text column with no check constraint, so a row
    // written outside this application could name a zone `Intl` rejects, and
    // the constructor throws a `RangeError` rather than returning anything.
    // A wrong-but-rendered time beats a 500 on the whole class page, so long as
    // the substitution is not silent.
    console.error("[time] unknown timezone, falling back to UTC", { zone });
    built = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  }

  FORMATTERS.set(cacheKey, built);
  return built;
}

/** The parts of an instant as they read on a clock in `zone`. */
const PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/** How far ahead of UTC `zone` was at one particular instant, in milliseconds. */
function offsetAt(zone: string, instant: number): number {
  const parts = formatterFor(zone, "parts", "en-GB", PARTS).formatToParts(
    new Date(instant),
  );

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  // The wall clock re-read as if it were UTC. Its distance from the instant it
  // was formatted from is the offset, by definition.
  const wall = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );

  return wall - instant;
}

/**
 * The instant at which the clocks in `zone` read `isoDate` at `isoTime`.
 *
 * `isoDate` is `YYYY-MM-DD` and `isoTime` is `HH:MM`, which is exactly what
 * `<input type="date">` and `<input type="time">` submit. Both are validated by
 * the caller before they arrive here.
 *
 * Two passes, because the offset depends on the answer: the first reads the
 * offset at the wall clock misread as UTC, which is at most a day out and
 * therefore lands in the right offset unless the guess straddles a transition;
 * the second reads it at an instant already within hours of the truth. Vietnam
 * has had no DST since 1975, so for this application's default zone the first
 * pass is already exact and the second confirms it.
 */
export function instantOf(zone: string, isoDate: string, isoTime: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hour, minute] = isoTime.split(":").map(Number);

  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const once = guess - offsetAt(zone, guess);

  return new Date(guess - offsetAt(zone, once));
}

/**
 * An instant as the calendar date it falls on in `zone` — "2026-09-01".
 *
 * The inverse of `instantOf`, and the reason it exists: `lesson_logs.lesson_date`
 * is a bare `date`, so writing one means deciding whose midnight bounds the day.
 * A lesson that starts at 00:30 in Ho Chi Minh City is still 17:30 the previous
 * day in UTC, and `new Date(...).toISOString().slice(0, 10)` would file it under
 * that previous day. The class's own clock is the only one that answers "which
 * day was this lesson".
 *
 * Assembled from parts rather than formatted, so the order never depends on what
 * a locale happens to do with a numeric date.
 */
export function zonedCalendarDate(zone: string, instant: string): string {
  const parts = formatterFor(zone, "calendar-date", "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * An instant as a date in `zone` — "Thứ Ba, 01/09/2026".
 *
 * `vi-VN` with a numeric day and month rather than the abbreviated month the
 * English build used: Vietnamese abbreviates September as "thg 9", which reads
 * as a fragment beside a weekday, while `dd/MM/yyyy` is the form every
 * Vietnamese reader already parses without thinking. The weekday is spelled out
 * because `vi-VN` renders the short form as "Th 3", which is not obviously a day.
 */
export function formatZonedDate(zone: string, instant: string): string {
  return formatterFor(zone, "date", "vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(instant));
}

/**
 * An instant as a time of day in `zone` — "19:30".
 *
 * The Figma writes "7:30 PM" because the Figma is in English. Vietnamese
 * schedules are written on the 24-hour clock, and `vi-VN` renders a 12-hour
 * time as "7:30 CH", which is both less familiar and no shorter. The 24-hour
 * form is narrower than the English one, so nothing in the layout has to give.
 */
export function formatZonedTime(zone: string, instant: string): string {
  return formatterFor(zone, "time", "vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
}

/**
 * A `HH:mm` wall clock as minutes past midnight.
 *
 * Lives here rather than beside the calendar geometry it serves because it is
 * the same wall clock `formatZonedTime` produces, and because `lib/calendar.ts`
 * is `server-only` while the calendar's current-time indicator has to do this
 * arithmetic in the browser. One definition, two callers, no copy.
 *
 * `% 24` because `Intl` renders midnight as "24:00" under an h24 locale and as
 * "00:00" under h23, and which one a runtime picks for `vi-VN` is not something
 * to bet a lesson's position on.
 */
export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour % 24) * 60 + minute;
}
