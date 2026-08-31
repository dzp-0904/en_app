import type {
  MonthlyStudentReport,
  ReportHomework,
  ReportLesson,
  ReportNote,
} from "@/lib/monthly-report";
import {
  attendanceLabel,
  attendanceText,
  bandFieldLabel,
  bandText,
  dayText,
  entryTypeLabel,
  homeworkScoreText,
  homeworkStatusLabel,
  lessonDateText,
  lessonTimeText,
  lessonTitle,
  percentText,
  skillLabel,
  EM_DASH,
} from "@/lib/report-text";
import { BAND_FIELDS, BAND_SKILLS } from "@/lib/score";
import { isBandScored } from "@/lib/score";
import { PERFORMANCE_LABELS } from "@/lib/lesson-log";
import type { AttendanceStatus } from "@/lib/attendance";
import type { HomeworkStatus } from "@/lib/student";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportHero } from "@/components/report/report-hero";
import { ScoreLines } from "@/components/report/score-lines";
import { SkillRadar } from "@/components/report/skill-radar";

/**
 * The monthly report as the teacher reviews it before sending it on.
 *
 * This is the Figma Reports screen, section for section: the navy identity
 * card, IELTS Progress, Skill Overview, Learning Habits, Score Progress, the
 * green improvements box and the orange areas-to-improve box, and the teacher's
 * comment. What the mock fills with fixtures, this fills from the rows
 * `loadMonthlyStudentReport` read — and nothing else. Where the mock has data
 * this application cannot know, the block is absent rather than invented:
 *
 *   - its two hand-written "Improvements This Month" bullets are the month's
 *     real band movements, computed from `score_entries`, or an honest sentence
 *     saying no band moved;
 *   - its `"8.1/10"` homework figure is a percentage over graded submissions,
 *     because `max_score` is per-assignment and a raw mean of 8/10 and 30/40
 *     means nothing;
 *   - its templated teacher's comment is `monthly_reports.teacher_comment`
 *     when a row exists, and otherwise says there is none — no prose is
 *     generated here, ever;
 *   - its "Next Month Focus" triple restates "Areas to Improve", so it is not
 *     drawn twice.
 *
 * The section order, the headings and every formatted value come from the same
 * `lib/report-text.ts` helpers the PDF, the `.docx` and the `.xlsx` use, and the
 * order matches `reportBlocks` in `lib/export/report-document.ts` — §10's rule
 * that the web report and the downloaded report may not disagree is kept by
 * having one place where each number turns into text, not by two careful
 * copies.
 *
 * Every block is a Server Component. Nothing here reacts to anything: the
 * report is a document, and it renders identically with JavaScript disabled.
 */

/**
 * `improving` green, `needs_attention` orange, `stable` the Figma's grey —
 * the same three tones `app/teacher/[classId]/page.tsx` documents, and the word
 * is always printed beside the tint.
 */
const ATTENDANCE_TONES: Record<
  AttendanceStatus,
  "green" | "orange" | "destructive" | "neutral"
> = {
  present: "green",
  late: "orange",
  absent: "destructive",
  excused: "neutral",
};

/** The homework palette `components/student/homework-list.tsx` established. */
const HOMEWORK_TONES: Record<HomeworkStatus, "green" | "orange" | "destructive"> =
  {
    assigned: "orange",
    submitted: "green",
    graded: "green",
    missed: "destructive",
  };

export function ReportPreview({ report }: { report: MonthlyStudentReport }) {
  const banded = isBandScored(report.courseType);

  return (
    <div className="space-y-6">
      <ReportHero report={report} bandScored={banded} />

      <Habits report={report} />

      {banded ? <Bands report={report} /> : null}

      <Movements report={report} />

      <Scores report={report} />

      <Lessons report={report} />

      <Homework report={report} />

      <Standing report={report} />

      <Comment report={report} />
    </div>
  );
}

/**
 * "Learning Habits" — the Figma's three rails, over the month's real counts.
 *
 * A rail is drawn only for a percentage that exists. `attendance.pct` is `null`
 * rather than 0 when the month counted no session, and `completionPct` is
 * `null` when nothing was assigned; an empty rail would say "0%", which is a
 * measurement, not an absence.
 */
function Habits({ report }: { report: MonthlyStudentReport }) {
  const summary = report.homeworkSummary;

  const rails: { label: string; value: number | null; caption: string }[] = [
    {
      label: "Chuyên cần",
      value: report.attendance.pct,
      caption:
        report.attendance.counted === 0
          ? "Chưa có buổi học nào được tính trong tháng"
          : attendanceText(report.attendance),
    },
    {
      label: "Hoàn thành bài tập",
      value: summary.completionPct,
      caption:
        summary.assigned === 0
          ? "Chưa giao bài tập nào trong tháng"
          : `${summary.submitted + summary.graded}/${summary.assigned} bài`,
    },
    {
      label: "Điểm bài tập trung bình",
      value: summary.averagePct,
      caption:
        summary.averagePct === null
          ? "Chưa có bài nào được chấm"
          : `Trên ${summary.averageOver} bài đã chấm`,
    },
  ];

  return (
    <Card>
      <SectionHeading
        title="Tổng quan tháng"
        description={`${report.lessons.length} buổi học được ghi nhận trong tháng`}
      />

      <ul className="space-y-5">
        {rails.map((rail) => (
          <li key={rail.label}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm font-medium">{rail.label}</span>
              <span className="text-sm text-muted-foreground">
                {percentText(rail.value)}
              </span>
            </div>

            {rail.value === null ? null : (
              <ProgressBar
                value={rail.value}
                max={100}
                size="md"
                tone={rail.value >= 80 ? "green" : "primary"}
                label={`${rail.label}: ${rail.value}%`}
              />
            )}

            <p className="mt-1.5 text-xs text-muted-foreground">
              {rail.caption}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Skill Overview" and the start-against-current table beside it. */
function Bands({ report }: { report: MonthlyStudentReport }) {
  const bands = report.bands;

  const rows = BAND_SKILLS.map((skill) => {
    const start = bands[startKey(skill)];
    const current = bands[currentKey(skill)];
    const delta =
      start === null || current === null ? null : current - start;

    return { skill, start, current, delta };
  });

  return (
    <Card>
      <SectionHeading
        title="Band theo kỹ năng"
        description={
          bands.currentRecordedOn === null
            ? "Chưa ghi nhận band nào"
            : `Band hiện tại ghi nhận ngày ${dayText(bands.currentRecordedOn)}`
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <SkillRadar bands={rows.map((row) => row.current)} />

        <Table label="Band theo kỹ năng">
          <TableHeader>
            <TableRow>
              <TableHead>Kỹ năng</TableHead>
              <TableHead>Ban đầu</TableHead>
              <TableHead>Hiện tại</TableHead>
              <TableHead>Thay đổi</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.skill}>
                <TableCell>{bandFieldLabel(row.skill)}</TableCell>
                <TableCell>{bandText(row.start)}</TableCell>
                <TableCell className="font-medium">
                  {bandText(row.current)}
                </TableCell>
                <TableCell>
                  {row.delta === null ? (
                    EM_DASH
                  ) : (
                    <span
                      className={
                        row.delta > 0
                          ? "font-medium text-green-dark"
                          : row.delta < 0
                            ? "font-medium text-orange-dark"
                            : "text-muted-foreground"
                      }
                    >
                      {row.delta > 0
                        ? `+${row.delta.toFixed(1)}`
                        : row.delta.toFixed(1)}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/**
 * The Figma's green "Improvements This Month" box.
 *
 * Its bullets there are hardcoded prose. Here they are `BandMovement`s: the
 * first and last band recorded for a skill inside the month, with the
 * arithmetic between them spelled out. When nothing moved, the box says so —
 * a month with no measured change is a real answer, and the alternative is
 * writing a compliment nobody earned.
 */
function Movements({ report }: { report: MonthlyStudentReport }) {
  return (
    <Card>
      <SectionHeading title="Tiến bộ trong tháng" />

      {report.movements.length === 0 ? (
        <p className="rounded-xl bg-track p-4 text-sm text-muted-foreground">
          Chưa ghi nhận thay đổi band nào trong tháng này.
        </p>
      ) : (
        <ul className="space-y-2 rounded-xl bg-green-light p-4">
          {report.movements.map((movement) => (
            <li key={movement.field} className="text-sm text-green-dark">
              <span className="font-medium">
                {bandFieldLabel(movement.field)}
              </span>
              {`: ${bandText(movement.from)} → ${bandText(movement.to)} (${
                movement.to - movement.from > 0 ? "+" : ""
              }${(movement.to - movement.from).toFixed(1)})`}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "Score Progress": the chart, then every entry the month recorded. */
function Scores({ report }: { report: MonthlyStudentReport }) {
  return (
    <Card>
      <SectionHeading
        title="Điểm số trong tháng"
        description={
          report.scores.length === 0
            ? undefined
            : `${report.scores.length} lần ghi nhận`
        }
      />

      {report.scores.length === 0 ? (
        <p className="rounded-xl bg-track p-4 text-sm text-muted-foreground">
          Chưa ghi nhận điểm nào trong tháng này.
        </p>
      ) : (
        <div className="space-y-5">
          <ScoreLines scores={report.scores} />

          <Table label="Điểm số trong tháng">
            <TableHeader>
              <TableRow>
                <TableHead>Ngày</TableHead>
                <TableHead>Loại</TableHead>
                {BAND_FIELDS.map((field) => (
                  <TableHead key={field}>{bandFieldLabel(field)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {report.scores.map((score) => (
                <TableRow key={score.entryId}>
                  <TableCell>{dayText(score.recordedOn)}</TableCell>
                  <TableCell>{entryTypeLabel(score.entryType)}</TableCell>
                  {BAND_FIELDS.map((field) => (
                    <TableCell key={field}>{bandText(score[field])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/**
 * Every session in the month, with the attendance mark and the teacher's own
 * notes under it.
 *
 * Oldest first, which is how a month reads even though the loader returns the
 * newest session first for every other consumer. A cancelled session is shown
 * and marked: it explains a gap in the attendance count rather than leaving
 * one. Attendance of `null` is "Chưa ghi nhận" and never `absent` (§5).
 */
function Lessons({ report }: { report: MonthlyStudentReport }) {
  const lessons = [...report.lessons].reverse();

  return (
    <Card>
      <SectionHeading
        title="Buổi học trong tháng"
        description={
          report.attendance.counted === 0
            ? undefined
            : attendanceText(report.attendance)
        }
      />

      {lessons.length === 0 ? (
        <p className="rounded-xl bg-track p-4 text-sm text-muted-foreground">
          Tháng này chưa có buổi học nào.
        </p>
      ) : (
        <ul className="divide-y divide-track">
          {lessons.map((lesson) => (
            <li key={lesson.sessionId} className="py-4 first:pt-0 last:pb-0">
              <LessonRow report={report} lesson={lesson} />
            </li>
          ))}
        </ul>
      )}

      {report.unmatchedNotes.length === 0 ? null : (
        <div className="mt-6 border-t border-track pt-5">
          <h3 className="mb-3 text-sm font-semibold">
            Ghi chú khác trong tháng
          </h3>

          <ul className="space-y-3">
            {report.unmatchedNotes.map((note) => (
              <li key={note.noteId}>
                <p className="text-xs text-muted-foreground">
                  {dayText(note.lessonDate)}
                </p>
                <NoteBody note={note} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function LessonRow({
  report,
  lesson,
}: {
  report: MonthlyStudentReport;
  lesson: ReportLesson;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 grow basis-56">
          <p className="font-medium break-words">
            {lessonTitle(lesson)}
            {lesson.sessionStatus === "cancelled" ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (đã hủy)
              </span>
            ) : null}
          </p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {`${lessonDateText(report.timezone, lesson)} · ${lessonTimeText(
              report.timezone,
              lesson,
            )}`}
          </p>
        </div>

        <Badge
          tone={
            lesson.attendance === null
              ? "neutral"
              : ATTENDANCE_TONES[lesson.attendance]
          }
        >
          {attendanceLabel(lesson.attendance)}
        </Badge>
      </div>

      {lesson.notes.length === 0 ? null : (
        <ul className="mt-3 space-y-3">
          {lesson.notes.map((note) => (
            <li key={note.noteId}>
              <NoteBody note={note} />
            </li>
          ))}
        </ul>
      )}

      {lesson.scores.length === 0 ? null : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {lesson.scores.map((score) => (
            <li key={score.entryId}>
              <Badge tone="primary">
                {`${entryTypeLabel(score.entryType)}: ${BAND_FIELDS.filter(
                  (field) => score[field] !== null,
                )
                  .map(
                    (field) =>
                      `${bandFieldLabel(field)} ${bandText(score[field])}`,
                  )
                  .join(", ")}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One `lesson_logs` row: the skill, how it went, the topic, the note. */
function NoteBody({ note }: { note: ReportNote }) {
  return (
    <div className="rounded-xl bg-track p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{skillLabel(note.skill)}</Badge>
        <span className="text-xs text-muted-foreground">
          {PERFORMANCE_LABELS[note.performance]}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium break-words">{note.topic}</p>

      {note.note === null ? null : (
        <p className="mt-1 text-sm break-words whitespace-pre-line text-muted-foreground">
          {note.note}
        </p>
      )}

      {note.mistakes.length === 0 ? null : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {note.mistakes.map((mistake) => (
            <li key={mistake}>
              <Badge tone="orange">{mistake}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The month's homework.
 *
 * Four states, not the mock's two: `public.homework_status` is
 * `assigned | submitted | graded | missed`, and only `graded` carries a score.
 * An empty month says so — inventing an assignment to fill the block would put
 * a fact in a parent's hands that never happened.
 */
function Homework({ report }: { report: MonthlyStudentReport }) {
  return (
    <Card>
      <SectionHeading
        title="Bài tập"
        description={
          report.homeworkSummary.assigned === 0
            ? undefined
            : `${report.homeworkSummary.assigned} bài được giao trong tháng`
        }
      />

      {report.homework.length === 0 ? (
        <p className="rounded-xl bg-track p-4 text-sm text-muted-foreground">
          Tháng này chưa giao bài tập nào.
        </p>
      ) : (
        <ul className="divide-y divide-track">
          {report.homework.map((row) => (
            <li key={row.assignmentId} className="py-4 first:pt-0 last:pb-0">
              <HomeworkRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HomeworkRow({ row }: { row: ReportHomework }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 grow basis-56">
          <p className="font-medium break-words">{row.title}</p>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {`${skillLabel(row.skill)} · Hạn nộp ${dayText(row.dueDate)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge
            tone={row.status === null ? "neutral" : HOMEWORK_TONES[row.status]}
          >
            {homeworkStatusLabel(row)}
          </Badge>

          <span className="text-sm font-medium">{homeworkScoreText(row)}</span>
        </div>
      </div>

      {row.teacherFeedback === null ? null : (
        <p className="mt-2 rounded-xl bg-track p-3 text-sm break-words whitespace-pre-line text-muted-foreground">
          {row.teacherFeedback}
        </p>
      )}
    </div>
  );
}

/**
 * `class_members.strengths` and `focus_areas` — the Figma's green and orange
 * boxes, carrying the teacher's own tags rather than generated prose.
 */
function Standing({ report }: { report: MonthlyStudentReport }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <SectionHeading title="Điểm mạnh" />

        {report.strengths.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Giáo viên chưa ghi nhận điểm mạnh nào.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2 rounded-xl bg-green-light p-4">
            {report.strengths.map((tag) => (
              <li key={tag} className="text-sm text-green-dark">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeading title="Nội dung cần cải thiện" />

        {report.focusAreas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Giáo viên chưa ghi nhận nội dung cần cải thiện.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2 rounded-xl bg-orange-light p-4">
            {report.focusAreas.map((tag) => (
              <li key={tag} className="text-sm text-orange-dark">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * `monthly_reports.teacher_comment`, when a published row exists for this
 * member and month.
 *
 * Nothing in the application writes that table yet, so in practice this states
 * that there is no summary comment. It does not generate one: §3 of the
 * milestone forbids new prose, and a monthly report is the last place to put a
 * sentence no teacher wrote.
 */
function Comment({ report }: { report: MonthlyStudentReport }) {
  return (
    <Card>
      <SectionHeading title="Ghi chú của giáo viên" />

      {report.teacherComment === null ? (
        <p className="text-sm text-muted-foreground">
          Chưa có nhận xét tổng kết cho tháng này. Các ghi chú theo từng buổi
          học ở trên là nhận xét giáo viên đã ghi trong tháng.
        </p>
      ) : (
        <p className="rounded-xl bg-secondary p-4 text-sm break-words whitespace-pre-line text-foreground">
          {report.teacherComment}
        </p>
      )}
    </Card>
  );
}

/**
 * `reading` → `startReading` / `currentReading`, as a union rather than a
 * template type, because a `` `start${string}` `` cannot index `ReportBands`.
 * The same two helpers `lib/export/report-document.ts` uses, for the same
 * reason — and both files read the same five columns as a result.
 */
function startKey(skill: (typeof BAND_SKILLS)[number]) {
  return `start${capitalise(skill)}` as
    | "startReading"
    | "startListening"
    | "startWriting"
    | "startSpeaking";
}

function currentKey(skill: (typeof BAND_SKILLS)[number]) {
  return `current${capitalise(skill)}` as
    | "currentReading"
    | "currentListening"
    | "currentWriting"
    | "currentSpeaking";
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
