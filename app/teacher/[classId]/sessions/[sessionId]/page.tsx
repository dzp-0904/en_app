import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AttendanceButtons } from "@/components/attendance/status-buttons";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  NOTE_MAX_LENGTH,
  PERFORMANCE_LABELS,
  PERFORMANCE_LEVELS,
  SKILL_LABELS,
  SKILLS,
  TOPIC_MAX_LENGTH,
} from "@/lib/lesson-log";
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  BAND_FIELD_LABELS,
  BAND_FIELDS,
  BAND_SKILLS,
  BAND_VALUES,
  formatBand,
  isBandScored,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
  SCORE_ENTRY_TYPES,
  SCORE_NOTE_MAX_LENGTH,
} from "@/lib/score";
import { createClient } from "@/lib/supabase/server";
import {
  loadClassBands,
  loadClassSession,
  loadEditableClass,
  loadScoreEntriesOn,
  loadSessionAttendance,
  loadSessionLessonNotes,
  type LessonNote,
  type MemberBands,
  type ScoreEntry,
  type SessionAttendee,
} from "@/lib/teacher";
import {
  formatZonedDate,
  formatZonedTime,
  zonedCalendarDate,
} from "@/lib/time";

import {
  createLessonLog,
  recordAttendance,
  recordScoreEntry,
  removeScoreEntry,
} from "../../actions";

export const metadata: Metadata = {
  title: "Buổi học",
};

/**
 * One lesson, and who was there.
 *
 * The page authorises in two steps, and both are queries rather than
 * comparisons. `loadEditableClass` filters `classes` by the authenticated
 * teacher's id, and `loadClassSession` filters `class_sessions` by *both*
 * `id = sessionId` and `class_id = classId`. A session id from another class —
 * another teacher's, or one of this teacher's own — therefore matches no row and
 * is reported as a lesson that does not exist. Nothing about it leaks, because
 * nothing about it was read.
 *
 * `sessions` is a static segment, so `[sessionId]` can never swallow it, and
 * both loaders refuse anything that is not a uuid before making a round trip.
 *
 * Five reads: the class, the session, the active members, the marks for this
 * session, and this session's lesson notes. None of them is per student, and
 * the last two are one statement each however many rows they return.
 */
export default async function SessionPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string; sessionId: string }>) {
  const { classId, sessionId } = await params;

  // Anonymous goes to the login page, a student and an unplaceable account go
  // to `/` — the same guard every other teacher page uses, and the same one
  // `recordAttendance` repeats for itself.
  const teacher = await requireTeacher();

  const supabase = await createClient();
  const owned = await loadEditableClass(supabase, teacher.userId, classId);

  // Another teacher's class is reported exactly as one that does not exist.
  if (owned.kind === "not-found") {
    notFound();
  }

  if (owned.kind === "error") {
    return (
      <Frame>
        {/* Not a 404: the query failed. See the class page. */}
        <Alert>
          Chúng tôi chưa tải được buổi học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const found = await loadClassSession(supabase, classId, sessionId);

  if (found.kind === "not-found") {
    notFound();
  }

  if (found.kind === "error") {
    return (
      <Frame>
        <Alert>
          Chúng tôi chưa tải được buổi học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const { fields } = owned;
  const { session } = found;

  // Separately from the lesson itself, so that a failure here costs the
  // attendance list and nothing else — the lesson's own facts still render.
  // `null` is that failure and is deliberately not `[]`: "no students are
  // enrolled" is a claim this page may only make on an answer it actually got.
  // The notes answer to nothing the roster says, so the two go out together
  // rather than one waiting on the other.
  // `score_entries` has no `session_id` — it hangs off a membership and a
  // `recorded_on date` — so "this lesson's entries" means the entries dated to
  // the day this lesson happened on, read on the class's own clock by the same
  // function `createLessonLog` derives `lesson_date` with.
  const banded = isBandScored(fields.courseType);
  const recordedOn = zonedCalendarDate(fields.timezone, session.startsAt);

  // Two more reads, and only for a class that keeps bands at all. Both are one
  // statement however many students the class has, and both are skipped
  // entirely for a General English class, which has no band scale by design.
  const [attendees, notes, standings, entries] = await Promise.all([
    loadSessionAttendance(supabase, classId, sessionId),
    loadSessionLessonNotes(supabase, classId, sessionId),
    banded ? loadClassBands(supabase, classId) : Promise.resolve(null),
    banded
      ? loadScoreEntriesOn(supabase, classId, recordedOn)
      : Promise.resolve(null),
  ]);

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <Frame className={fields.className}>
      {/* The lesson names the page and the class names the trail above it,
          which is the Figma's header everywhere: the heading is the thing you
          opened, not the thing it belongs to. An untitled lesson — `title` is
          nullable — falls back to the word for what it is rather than
          borrowing the class name and repeating the crumb.

          The date and the times are read on the class's own clock, by the same
          two functions the lesson list uses. See `lib/time.ts`. They are two
          metadata nodes rather than one `·`-joined string so a narrow screen
          wraps between the date and the times instead of inside either. */}
      <PageHeader
        breadcrumb={[
          { label: "Lớp học", href: "/teacher" },
          { label: fields.className, href: `/teacher/${classId}` },
          { label: "Buổi học" },
        ]}
        title={session.title ?? "Buổi học"}
        meta={[
          formatZonedDate(fields.timezone, session.startsAt),
          `${formatZonedTime(fields.timezone, session.startsAt)} – ${formatZonedTime(fields.timezone, session.endsAt)}`,
        ]}
      />

      {/* Only when it is not the default this application creates. Nothing here
          can change it; showing it stops the page misreporting the lesson. */}
      {session.status === "scheduled" ? null : (
        <p className="-mt-2 mb-6 text-sm text-muted-foreground">
          {session.status === "cancelled"
            ? "Buổi học này đã bị hủy."
            : "Buổi học này đã được đánh dấu hoàn thành."}
        </p>
      )}

      {error ? <Alert className="mb-6">{error}</Alert> : null}

      <h2 className="mt-4 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Điểm danh
      </h2>

      {attendees === null ? (
        <Alert>
          Chúng tôi chưa tải được danh sách học viên của lớp này. Vui lòng
          tải lại trang.
        </Alert>
      ) : attendees.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Lớp này hiện chưa có học viên nào.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {attendees.map((attendee) => (
            <li key={attendee.membershipId}>
              <Card>
                <Attendee
                  attendee={attendee}
                  classId={classId}
                  sessionId={sessionId}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Ghi chú buổi học
      </h2>

      {notes === null ? (
        <Alert>
          Chúng tôi chưa tải được ghi chú của buổi học này. Vui lòng tải lại
          trang.
        </Alert>
      ) : notes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Chưa có ghi chú nào được thêm.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.noteId}>
              <Card>
                <Note note={note} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* A note names a student, so there is nothing to write until the class
          has one. The attendance block above has already said why. */}
      {attendees && attendees.length > 0 ? (
        <Card className="mt-3">
          <NoteForm
            attendees={attendees}
            classId={classId}
            sessionId={sessionId}
          />
        </Card>
      ) : null}

      {/* Only IELTS classes are scored on the band scale — `scoringModelFor` is
          the rule, and `classes_no_target_band_when_unscored` is the schema
          agreeing. A General English class gets no section, and
          `recordScoreEntry` refuses one anyway. */}
      {banded ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Band điểm
          </h2>

          {standings === null || entries === null ? (
            <Alert>
              Chúng tôi chưa tải được band điểm của lớp này. Vui lòng tải
              lại trang.
            </Alert>
          ) : attendees === null ? null : (
            <>
              {attendees.length === 0 && entries.length === 0 ? (
                <Card>
                  <p className="text-sm text-muted-foreground">
                    Lớp này hiện chưa có học viên nào.
                  </p>
                </Card>
              ) : (
                <ul className="space-y-3">
                  {bandRows(attendees, standings, entries).map((row) => (
                    <li key={row.membershipId}>
                      <Card>
                        <BandRow
                          row={row}
                          classId={classId}
                          sessionId={sessionId}
                        />
                      </Card>
                    </li>
                  ))}
                </ul>
              )}

              {/* An entry names a student, like a note does. */}
              {attendees.length > 0 ? (
                <Card className="mt-3">
                  <ScoreForm
                    attendees={attendees}
                    classId={classId}
                    sessionId={sessionId}
                  />
                </Card>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Frame>
  );
}

/**
 * One note as it was written.
 *
 * The topic leads because it is what the note is about; the student, the skill
 * and how they did are the three enum-shaped facts beside it; the note itself is
 * the body. The lesson's date is not repeated — every note on this page carries
 * the same one, and it is already in the header.
 *
 * `whitespace-pre-line` keeps the teacher's paragraph breaks. React escapes the
 * text, so nothing typed into the field can become markup.
 */
function Note({ note }: { note: LessonNote }) {
  return (
    <>
      {/* `break-words` because both of these are free text: a 300-character
          topic with no spaces in it would otherwise widen the whole page. */}
      <h3 className="font-semibold break-words text-foreground">{note.topic}</h3>

      <p className="mt-1 text-sm text-muted-foreground">
        {note.studentName ?? "Học viên chưa có tên"} · {SKILL_LABELS[note.skill]} ·{" "}
        {PERFORMANCE_LABELS[note.performance]}
      </p>

      {note.note ? (
        <p className="mt-3 text-sm break-words whitespace-pre-line text-foreground">
          {note.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * The form that writes one.
 *
 * Four fields rather than one, because `lesson_logs` is a per-student
 * observation and its NOT NULL columns say so: a row cannot exist without a
 * `class_member_id`, a `skill`, a `topic` and a `performance`. The milestone's
 * wording describes a single memo; the schema is what this follows.
 *
 * `lesson_date` and `created_by` are not here at all. Both are derived on the
 * server — the lesson's own start read on the class's clock, and the teacher in
 * the session cookie — because a field the browser could set is a field the
 * browser could lie about.
 *
 * The student and the performance start unselected. A `<select>` always has a
 * selection, so defaulting either would file a note against whoever happened to
 * be first on the roster, or record a judgement the teacher never made; an empty
 * `required` option makes the browser ask instead. The skill defaults to
 * `general`, which is the enum's own value for "not one skill in particular".
 *
 * Two ids are bound on the server and neither is trusted there; `maxLength` here
 * is a courtesy that stops the field over-filling, and the action checks both
 * lengths again against the schema's constraint and the application's cap.
 */
function NoteForm({
  attendees,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[];
  classId: string;
  sessionId: string;
}) {
  return (
    <form
      action={createLessonLog.bind(null, classId, sessionId)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="class_member_id">Học viên</Label>
        <Select
          id="class_member_id"
          name="class_member_id"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Chọn học viên
          </option>
          {attendees.map((attendee) => (
            <option key={attendee.membershipId} value={attendee.membershipId}>
              {attendee.name ?? attendee.email ?? "Học viên chưa có tên"}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="topic">Chủ đề</Label>
        <Input
          id="topic"
          name="topic"
          type="text"
          maxLength={TOPIC_MAX_LENGTH}
          placeholder="Nội dung buổi học"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="skill">Kỹ năng</Label>
          <Select id="skill" name="skill" defaultValue="general" required>
            {SKILLS.map((skill) => (
              <option key={skill} value={skill}>
                {SKILL_LABELS[skill]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="performance">Kết quả</Label>
          <Select id="performance" name="performance" defaultValue="" required>
            <option value="" disabled>
              Chọn
            </option>
            {PERFORMANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {PERFORMANCE_LABELS[level]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">Ghi chú buổi học</Label>
        <Textarea
          id="note"
          name="note"
          rows={4}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="Tình hình học tập của học viên trong buổi này"
          required
        />
      </div>

      <SubmitButton pendingLabel="Đang thêm ghi chú…" className="mt-6 w-full">
        Thêm ghi chú
      </SubmitButton>
    </form>
  );
}

/**
 * One student, and the four marks a teacher can give them.
 *
 * One form, four submit buttons, each carrying its own `status` value — so the
 * mark is made by the button that was pressed and the whole thing works without
 * JavaScript, like every other form in this application. The three ids are bound
 * on the server; `status` is the only value the browser supplies, and the action
 * checks it against `public.attendance_status` before using it.
 *
 * The current mark is the filled button rather than a badge, so the state and
 * the control are the same object and there is nothing to keep in agreement. An
 * unmarked student says so in words, because a row of four outline buttons on
 * its own would look identical to one whose mark simply failed to render.
 *
 * The buttons themselves are a client component so that the press registers
 * before the server answers — see `components/attendance/status-buttons.tsx`.
 * The form around them is unchanged: same bound Server Action, same
 * authorization, same no-JavaScript fallback.
 */
function Attendee({
  attendee,
  classId,
  sessionId,
}: {
  attendee: SessionAttendee;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      {attendee.name ? (
        <>
          <h3 className="mb-1 font-semibold text-foreground">
            {attendee.name}
          </h3>
          {attendee.email ? (
            <p className="text-sm text-muted-foreground">{attendee.email}</p>
          ) : null}
        </>
      ) : (
        <h3 className="font-semibold text-foreground">
          {attendee.email ?? "Học viên chưa có tên"}
        </h3>
      )}

      <form
        action={recordAttendance.bind(
          null,
          classId,
          sessionId,
          attendee.membershipId,
        )}
      >
        <AttendanceButtons recorded={attendee.attendance} />
      </form>
    </>
  );
}

/**
 * One student's band standing, and whatever was recorded for them today.
 *
 * `entries` is the entries dated to this lesson, which is as close to "this
 * lesson's scores" as the schema gets — `score_entries` has no `session_id`.
 */
type BandRowData = {
  membershipId: string;
  name: string | null;
  bands: MemberBands | null;
  entries: ScoreEntry[];
};

/**
 * The active roster, each student carrying their standing and today's entries,
 * followed by anyone else today's entries mention.
 *
 * The second part is the reason this is a function rather than a `.map`. A
 * student can be removed from a class after being assessed in it, and
 * `score_entries` survives that on purpose — the composite foreign key cascades
 * on the membership, not on `removed_at`. Those entries would otherwise be
 * invisible on the only page that can delete them, so they are listed after the
 * roster under the name the entry itself carries.
 */
function bandRows(
  attendees: SessionAttendee[],
  standings: Map<string, MemberBands>,
  entries: ScoreEntry[],
): BandRowData[] {
  const byMember = new Map<string, ScoreEntry[]>();
  for (const entry of entries) {
    const existing = byMember.get(entry.membershipId);
    if (existing) existing.push(entry);
    else byMember.set(entry.membershipId, [entry]);
  }

  const rows: BandRowData[] = attendees.map((attendee) => ({
    membershipId: attendee.membershipId,
    name: attendee.name ?? attendee.email,
    bands: standings.get(attendee.membershipId) ?? null,
    entries: byMember.get(attendee.membershipId) ?? [],
  }));

  const listed = new Set(attendees.map((attendee) => attendee.membershipId));
  for (const [membershipId, group] of byMember) {
    if (listed.has(membershipId)) continue;
    rows.push({
      membershipId,
      name: group[0].studentName,
      bands: standings.get(membershipId) ?? null,
      entries: group,
    });
  }

  return rows;
}

function BandRow({
  row,
  classId,
  sessionId,
}: {
  row: BandRowData;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      <h3 className="font-semibold break-words text-foreground">
        {row.name ?? "Học viên chưa có tên"}
      </h3>

      <Standing bands={row.bands} />

      {row.entries.length > 0 ? (
        <ul className="mt-4 space-y-4 border-t border-border pt-4">
          {row.entries.map((entry) => (
            <li key={entry.entryId}>
              <Entry entry={entry} classId={classId} sessionId={sessionId} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Where this student stands, as the database already computes it.
 *
 * Every number here comes from `v_member_current_band` and every word from
 * `v_member_performance_status`. Nothing is averaged, compared or derived on
 * this page: "starting band" is the baseline row, "current" is the latest one,
 * and the status is the view's own comparison of the last two entries. Two
 * copies of those definitions would be two chances for the teacher's screen and
 * the student's to disagree.
 *
 * A skill with no band is left out rather than shown as a dash, because a run of
 * four dashes reads like a result. `flex-wrap` is unnecessary on a wrapping
 * paragraph, but `break-words` is not: a long name above it and a long line here
 * both have to stay inside 390px.
 */
function Standing({ bands }: { bands: MemberBands | null }) {
  const current = bands ? formatBand(bands.currentOverall) : null;
  const start = bands ? formatBand(bands.startOverall) : null;
  const target = bands ? formatBand(bands.targetBand) : null;

  if (!bands || (current === null && start === null)) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        Chưa ghi nhận band nào.
      </p>
    );
  }

  const overall = [
    start === null ? null : `Ban đầu ${start}`,
    current === null ? null : `Hiện tại ${current}`,
    target === null ? null : `Mục tiêu ${target}`,
    MEMBER_STATUS_LABELS[bands.status],
  ].filter((part): part is string => part !== null);

  const skills = (
    [
      ["reading", bands.currentReading],
      ["listening", bands.currentListening],
      ["writing", bands.currentWriting],
      ["speaking", bands.currentSpeaking],
    ] as const
  )
    .map(([skill, band]) => {
      const shown = formatBand(band);
      return shown === null ? null : `${BAND_FIELD_LABELS[skill]} ${shown}`;
    })
    .filter((part): part is string => part !== null);

  return (
    <>
      <p className="mt-1 text-sm break-words text-muted-foreground">
        {overall.join(" · ")}
      </p>
      {skills.length > 0 ? (
        <p className="mt-1 text-sm break-words text-muted-foreground">
          {skills.join(" · ")}
        </p>
      ) : null}
    </>
  );
}

/**
 * One entry recorded today, and the only way to take it back.
 *
 * Removal rather than editing because that is the whole of what the schema
 * offers: `20260828001400_grants.sql` grants no UPDATE, and
 * `enforce_score_entries_append_only` refuses one. The table's own comment says
 * why — a wrong entry is deleted and re-entered, which leaves the history honest
 * instead of silently rewritten.
 *
 * The button is a plain destructive submit rather than the roster's `<details>`
 * confirmation. Removing a student ends an enrolment and takes their whole
 * history off the page with it; removing one band entry undoes a typo, and the
 * form directly below re-records it. It still posts to a bound Server Action and
 * still works with JavaScript off.
 */
function Entry({
  entry,
  classId,
  sessionId,
}: {
  entry: ScoreEntry;
  classId: string;
  sessionId: string;
}) {
  const bands = BAND_FIELDS.map((field) => {
    const band = formatBand(entry[field]);
    return band === null ? null : `${BAND_FIELD_LABELS[field]} ${band}`;
  }).filter((part): part is string => part !== null);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {SCORE_ENTRY_TYPE_LABELS[entry.entryType]}
        </p>

        <form
          action={removeScoreEntry.bind(
            null,
            classId,
            sessionId,
            entry.entryId,
          )}
        >
          <SubmitButton
            pendingLabel="Đang xóa…"
            className="border border-destructive/30 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-background"
          >
            Xóa
          </SubmitButton>
        </form>
      </div>

      <p className="mt-1 text-sm break-words text-muted-foreground">
        {bands.join(" · ")}
      </p>

      {entry.note ? (
        <p className="mt-2 text-sm break-words whitespace-pre-line text-foreground">
          {entry.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * The form that records one.
 *
 * Five bands and a note, all of them optional, because `score_entries` has
 * exactly one rule about what an entry must contain: `score_entries_not_empty`,
 * at least one of the five. A student assessed on speaking alone is a real
 * entry, so every band starts unselected and blank means "not measured" rather
 * than zero.
 *
 * The options are `BAND_VALUES`, which is `public.band`'s CHECK written out —
 * every half point from 0.0 to 9.0 — so what is offered and what the domain
 * accepts are the same set by construction. The action reads each field the same
 * way regardless, because a `<select>` is a suggestion and a POST is not.
 *
 * `recorded_on` and `created_by` are not here at all, exactly as in `NoteForm`:
 * the lesson's own date on the class's clock, and the teacher in the session
 * cookie. A field the browser could set is a field the browser could lie about.
 */
function ScoreForm({
  attendees,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[];
  classId: string;
  sessionId: string;
}) {
  return (
    <form
      action={recordScoreEntry.bind(null, classId, sessionId)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="band-student">Học viên</Label>
        <Select
          id="band-student"
          name="membershipId"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Chọn học viên
          </option>
          {attendees.map((attendee) => (
            <option key={attendee.membershipId} value={attendee.membershipId}>
              {attendee.name ?? attendee.email ?? "Học viên chưa có tên"}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="band-entry">Loại đánh giá</Label>
          <Select
            id="band-entry"
            name="entryType"
            defaultValue="progress"
            required
          >
            {SCORE_ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {SCORE_ENTRY_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>

        <BandField field="overall" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {BAND_SKILLS.map((skill) => (
          <BandField key={skill} field={skill} />
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="band-note">Ghi chú</Label>
        <Textarea
          id="band-note"
          name="note"
          rows={3}
          maxLength={SCORE_NOTE_MAX_LENGTH}
          placeholder="Không bắt buộc — kết quả này phản ánh điều gì"
        />
      </div>

      <SubmitButton pendingLabel="Đang ghi nhận…" className="mt-6 w-full">
        Ghi nhận band
      </SubmitButton>
    </form>
  );
}

/**
 * One band picker. Empty is the default, and it means "not measured".
 *
 * Every control in this form carries a `band-` prefixed `id` while keeping the
 * column's own `name`. The lesson-note form above it already owns `note`, and
 * two elements with one id is two labels pointing at the same control.
 */
function BandField({ field }: { field: (typeof BAND_FIELDS)[number] }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`band-${field}`}>{BAND_FIELD_LABELS[field]}</Label>
      <Select id={`band-${field}`} name={field} defaultValue="">
        <option value="">—</option>
        {BAND_VALUES.map((band) => (
          <option key={band} value={band}>
            {band}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The shell every state shares. The error states head themselves, because they
 * have neither a lesson nor a class name to head the page with; the trail goes
 * to the list rather than to the class, since the load that just failed is the
 * class's own and sending them back into it would fail again.
 */
function Frame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageShell width="4xl">
      {className ? null : (
        <PageHeader
          breadcrumb={[
            { label: "Lớp học", href: "/teacher" },
            { label: "Buổi học" },
          ]}
          title="Buổi học"
        />
      )}

      {children}
    </PageShell>
  );
}
