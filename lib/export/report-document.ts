import "server-only";

import type { Block } from "@/lib/export/blocks";
import type { Sheet } from "@/lib/export/xlsx";
import type {
  MonthlyClassSummary,
  MonthlyStudentReport,
} from "@/lib/monthly-report";
import {
  attendanceLabel,
  attendanceText,
  bandFieldLabel,
  bandText,
  courseLabel,
  dayText,
  EM_DASH,
  entryTypeLabel,
  homeworkScoreText,
  homeworkStatusLabel,
  lessonTimeText,
  lessonTitle,
  movementText,
  percentText,
  skillLabel,
  statusLabel,
} from "@/lib/report-text";
import { BAND_SKILLS, isBandScored, MEMBER_STATUS_LABELS } from "@/lib/score";

/**
 * What a monthly report says, and in what order — once, for every format.
 *
 * `reportBlocks` is the document: the PDF and the `.docx` are the same block
 * list drawn by two renderers, so neither can be missing a section the other
 * has. `reportSheets` is the workbook, which is a different medium with a
 * different job (sort and filter, not read top to bottom) but reads the same
 * `MonthlyStudentReport` through the same formatters in
 * `lib/report-text.ts` — so its numbers cannot drift from the document's.
 *
 * ## What is deliberately absent
 *
 * The Figma's report card carries four things this does not, and each omission
 * is the same decision: §3 says the report is assembled from real data and
 * §1 says nothing is generated.
 *
 *   - "Improvements This Month" is a hardcoded array of three English
 *     sentences in the mock. The one fact inside it — that a band moved — is
 *     kept, as `movements`, computed from the month's own entries.
 *   - The teacher's comment is a template literal built from the student's
 *     name. The real column is `monthly_reports.teacher_comment`; it is read
 *     when a row exists and reported as absent when one does not.
 *   - "Avg Homework Score 8.1/10" is a constant. `max_score` is per-assignment,
 *     so the honest figure is a percentage over graded submissions, with the
 *     count it was taken over.
 *   - "Next Month Focus" is `weaknesses.slice(0, 3)` — the same list the card
 *     has already printed under "Areas to Improve". It is printed once here.
 *
 * A section with nothing behind it says so in a sentence rather than being
 * dropped: a parent reading "Chưa ghi nhận bài tập nào trong tháng này" learns
 * something, and a report whose sections change shape month to month is harder
 * to compare than one that does not.
 */

export function reportBlocks(report: MonthlyStudentReport): Block[] {
  const banded = isBandScored(report.courseType);

  return [
    {
      kind: "title",
      text: report.studentName ?? "Học viên",
      subtitle: [
        report.className,
        courseLabel(report.courseType, report.courseTypeOther),
        report.monthLabel,
        `Giáo viên: ${report.teacherName}`,
      ].join("  ·  "),
    },

    ...overview(report, banded),
    ...bandSection(report, banded),
    ...movementSection(report),
    ...scoreSection(report, banded),
    ...lessonSection(report),
    ...homeworkSection(report),
    ...standingSection(report),
    ...commentSection(report),
  ];
}

function overview(report: MonthlyStudentReport, banded: boolean): Block[] {
  const bands = report.bands;

  return [
    { kind: "heading", level: 1, text: "Tổng quan tháng" },
    {
      kind: "stats",
      items: [
        ...(banded
          ? [
              { label: "Band ban đầu", value: bandText(bands.startOverall) },
              { label: "Band hiện tại", value: bandText(bands.currentOverall) },
              { label: "Band mục tiêu", value: bandText(bands.targetBand) },
            ]
          : []),
        { label: "Kết quả", value: statusLabel(report) },
      ],
    },
    {
      kind: "stats",
      items: [
        {
          label: "Chuyên cần",
          value: attendanceText(report.attendance),
        },
        {
          label: "Buổi học trong tháng",
          value: String(report.lessons.length),
        },
        {
          label: "Hoàn thành bài tập",
          value: percentText(report.homeworkSummary.completionPct),
        },
        {
          label: "Điểm bài tập trung bình",
          value:
            report.homeworkSummary.averagePct === null
              ? EM_DASH
              : `${report.homeworkSummary.averagePct}% (${report.homeworkSummary.averageOver} bài)`,
        },
      ],
    },
  ];
}

/** The four skills, start against current. IELTS classes only. */
function bandSection(report: MonthlyStudentReport, banded: boolean): Block[] {
  if (!banded) return [];

  const bands = report.bands;

  const rows = BAND_SKILLS.map((skill) => {
    const start = bands[startKey(skill)];
    const current = bands[currentKey(skill)];
    const delta =
      start === null || current === null
        ? EM_DASH
        : signed(current - start);

    return [bandFieldLabel(skill), bandText(start), bandText(current), delta];
  });

  return [
    { kind: "heading", level: 1, text: "Band theo kỹ năng" },
    {
      kind: "table",
      header: ["Kỹ năng", "Ban đầu", "Hiện tại", "Thay đổi"],
      rows,
      widths: [0.4, 0.2, 0.2, 0.2],
    },
    ...(bands.currentRecordedOn === null
      ? []
      : ([
          {
            kind: "paragraph",
            muted: true,
            text: `Band hiện tại ghi nhận ngày ${dayText(bands.currentRecordedOn)}.`,
          },
        ] satisfies Block[])),
  ];
}

function movementSection(report: MonthlyStudentReport): Block[] {
  if (report.movements.length === 0) {
    return [
      { kind: "heading", level: 1, text: "Tiến bộ trong tháng" },
      {
        kind: "paragraph",
        muted: true,
        text: "Chưa ghi nhận thay đổi band nào trong tháng này.",
      },
    ];
  }

  return [
    { kind: "heading", level: 1, text: "Tiến bộ trong tháng" },
    ...report.movements.map(
      (movement): Block => ({ kind: "bullet", text: movementText(movement) }),
    ),
  ];
}

function scoreSection(report: MonthlyStudentReport, banded: boolean): Block[] {
  if (!banded) return [];

  const heading: Block = {
    kind: "heading",
    level: 1,
    text: "Điểm số trong tháng",
  };

  if (report.scores.length === 0) {
    return [
      heading,
      {
        kind: "paragraph",
        muted: true,
        text: "Chưa ghi nhận điểm nào trong tháng này.",
      },
    ];
  }

  return [
    heading,
    {
      kind: "table",
      header: [
        "Ngày",
        "Loại",
        bandFieldLabel("overall"),
        bandFieldLabel("reading"),
        bandFieldLabel("listening"),
        bandFieldLabel("writing"),
        bandFieldLabel("speaking"),
      ],
      rows: report.scores.map((entry) => [
        dayText(entry.recordedOn),
        entryTypeLabel(entry.entryType),
        bandText(entry.overall),
        bandText(entry.reading),
        bandText(entry.listening),
        bandText(entry.writing),
        bandText(entry.speaking),
      ]),
      widths: [0.17, 0.23, 0.12, 0.12, 0.12, 0.12, 0.12],
    },
  ];
}

function lessonSection(report: MonthlyStudentReport): Block[] {
  const heading: Block = {
    kind: "heading",
    level: 1,
    text: "Buổi học trong tháng",
  };

  if (report.lessons.length === 0) {
    return [
      heading,
      {
        kind: "paragraph",
        muted: true,
        text: "Chưa có buổi học nào trong tháng này.",
      },
    ];
  }

  return [
    heading,
    {
      kind: "table",
      header: ["Ngày", "Buổi học", "Điểm danh", "Ghi chú của giáo viên"],
      // Oldest last, as the loader returns them: a report reads forward through
      // the month, so it is reversed here rather than re-queried.
      rows: [...report.lessons].reverse().map((lesson) => [
        `${dayText(lesson.calendarDate)}\n${lessonTimeText(report.timezone, lesson)}`,
        lesson.sessionStatus === "cancelled"
          ? `${lessonTitle(lesson)} (đã hủy)`
          : lessonTitle(lesson),
        attendanceLabel(lesson.attendance),
        lesson.notes
          .map((note) =>
            [
              `${skillLabel(note.skill)} · ${note.topic}`,
              note.note ?? "",
            ]
              .filter((line) => line !== "")
              .join("\n"),
          )
          .join("\n\n"),
      ]),
      widths: [0.18, 0.24, 0.14, 0.44],
    },
    ...(report.unmatchedNotes.length === 0
      ? []
      : ([
          { kind: "heading", level: 2, text: "Ghi chú khác trong tháng" },
          ...report.unmatchedNotes.map(
            (note): Block => ({
              kind: "bullet",
              text: `${dayText(note.lessonDate)} · ${skillLabel(note.skill)} · ${note.topic}${note.note === null ? "" : ` — ${note.note}`}`,
            }),
          ),
        ] satisfies Block[])),
  ];
}

function homeworkSection(report: MonthlyStudentReport): Block[] {
  const heading: Block = { kind: "heading", level: 1, text: "Bài tập" };

  if (report.homework.length === 0) {
    return [
      heading,
      {
        kind: "paragraph",
        muted: true,
        text: "Chưa giao bài tập nào trong tháng này.",
      },
    ];
  }

  return [
    heading,
    {
      kind: "table",
      header: ["Bài tập", "Kỹ năng", "Hạn nộp", "Trạng thái", "Điểm"],
      rows: report.homework.map((row) => [
        row.title,
        skillLabel(row.skill),
        dayText(row.dueDate),
        homeworkStatusLabel(row),
        homeworkScoreText(row),
      ]),
      widths: [0.36, 0.16, 0.16, 0.18, 0.14],
    },
  ];
}

function standingSection(report: MonthlyStudentReport): Block[] {
  return [
    { kind: "heading", level: 1, text: "Điểm mạnh" },
    ...(report.strengths.length === 0
      ? ([
          {
            kind: "paragraph",
            muted: true,
            text: "Chưa ghi nhận điểm mạnh nào.",
          },
        ] satisfies Block[])
      : report.strengths.map(
          (tag): Block => ({ kind: "bullet", text: tag }),
        )),

    { kind: "heading", level: 1, text: "Nội dung cần cải thiện" },
    ...(report.focusAreas.length === 0
      ? ([
          {
            kind: "paragraph",
            muted: true,
            text: "Chưa ghi nhận nội dung cần cải thiện nào.",
          },
        ] satisfies Block[])
      : report.focusAreas.map(
          (tag): Block => ({ kind: "bullet", text: tag }),
        )),
  ];
}

function commentSection(report: MonthlyStudentReport): Block[] {
  return [
    { kind: "heading", level: 1, text: "Ghi chú của giáo viên" },
    report.teacherComment === null
      ? {
          kind: "paragraph",
          muted: true,
          text: "Chưa có nhận xét tổng kết cho tháng này.",
        }
      : { kind: "paragraph", text: report.teacherComment },
  ];
}

/**
 * The workbook: one student, four sheets.
 *
 * §6 suggests Summary / Lessons / Scores / Homework, and the schema agrees with
 * all four, so that is what is written — with the columns the real tables have
 * rather than the ones the milestone guessed at. Numbers are numbers, so a
 * teacher can sort a roster by band or filter a month by attendance.
 */
export function reportSheets(report: MonthlyStudentReport): Sheet[] {
  const banded = isBandScored(report.courseType);
  const bands = report.bands;

  const summary: Sheet = {
    name: "Tổng quan",
    header: ["Mục", "Giá trị"],
    widths: [32, 46],
    rows: [
      ["Học viên", report.studentName ?? EM_DASH],
      ["Email", report.studentEmail ?? EM_DASH],
      ["Lớp học", report.className],
      [
        "Chương trình",
        courseLabel(report.courseType, report.courseTypeOther),
      ],
      ["Giáo viên", report.teacherName],
      ["Tháng", report.monthLabel],
      ...(banded
        ? ([
            ["Band ban đầu", bands.startOverall],
            ["Band hiện tại", bands.currentOverall],
            ["Band mục tiêu", bands.targetBand],
          ] as [string, number | null][])
        : []),
      ["Kết quả", statusLabel(report)],
      ["Buổi học được tính", report.attendance.counted],
      ["Buổi có mặt", report.attendance.attended],
      ["Tỷ lệ chuyên cần (%)", report.attendance.pct],
      ["Bài tập đã giao", report.homeworkSummary.assigned],
      ["Bài tập đã nộp", report.homeworkSummary.submitted],
      ["Bài tập đã chấm", report.homeworkSummary.graded],
      ["Bài tập quá hạn", report.homeworkSummary.missed],
      ["Tỷ lệ hoàn thành bài tập (%)", report.homeworkSummary.completionPct],
      ["Điểm bài tập trung bình (%)", report.homeworkSummary.averagePct],
      ["Điểm mạnh", report.strengths.join("; ")],
      ["Nội dung cần cải thiện", report.focusAreas.join("; ")],
      ["Ghi chú của giáo viên", report.teacherComment],
    ],
  };

  const lessons: Sheet = {
    name: "Buổi học",
    header: [
      "Ngày",
      "Giờ",
      "Buổi học",
      "Trạng thái buổi",
      "Điểm danh",
      "Kỹ năng",
      "Chủ đề",
      "Ghi chú",
    ],
    widths: [14, 16, 26, 16, 14, 12, 26, 44],
    rows: [...report.lessons].reverse().flatMap((lesson) => {
      const head = [
        dayText(lesson.calendarDate),
        lessonTimeText(report.timezone, lesson),
        lessonTitle(lesson),
        lesson.sessionStatus === "cancelled" ? "Đã hủy" : "",
        attendanceLabel(lesson.attendance),
      ];

      // One row per note, so the sheet stays filterable by skill; a lesson with
      // no note is still a row, because it still happened.
      if (lesson.notes.length === 0) {
        return [[...head, null, null, null]];
      }

      return lesson.notes.map((note) => [
        ...head,
        skillLabel(note.skill),
        note.topic,
        note.note,
      ]);
    }),
  };

  const scores: Sheet = {
    name: "Điểm số",
    header: [
      "Ngày",
      "Loại",
      bandFieldLabel("overall"),
      bandFieldLabel("reading"),
      bandFieldLabel("listening"),
      bandFieldLabel("writing"),
      bandFieldLabel("speaking"),
      "Ghi chú",
    ],
    widths: [14, 18, 12, 12, 12, 12, 12, 40],
    rows: report.scores.map((entry) => [
      dayText(entry.recordedOn),
      entryTypeLabel(entry.entryType),
      entry.overall,
      entry.reading,
      entry.listening,
      entry.writing,
      entry.speaking,
      entry.note,
    ]),
  };

  const homework: Sheet = {
    name: "Bài tập",
    header: [
      "Bài tập",
      "Kỹ năng",
      "Ngày giao",
      "Hạn nộp",
      "Trạng thái",
      "Điểm",
      "Điểm tối đa",
      "Nhận xét",
    ],
    widths: [30, 12, 14, 14, 14, 10, 12, 40],
    rows: report.homework.map((row) => [
      row.title,
      skillLabel(row.skill),
      dayText(row.assignedOn),
      dayText(row.dueDate),
      homeworkStatusLabel(row),
      row.status === "graded" ? row.score : null,
      row.maxScore,
      row.teacherFeedback,
    ]),
  };

  return [summary, lessons, scores, homework];
}

/**
 * The class-wide workbook: one row per student.
 *
 * The whole-class export §2 asks for. It is a spreadsheet rather than a folder
 * of PDFs because that is what the request is actually for — a teacher
 * comparing a roster, sorting by attendance, seeing who has nothing recorded —
 * and because every column here is a figure the individual report already
 * carries, so the two cannot disagree.
 */
export function classSheets(summary: MonthlyClassSummary): Sheet[] {
  return [
    {
      name: "Học viên",
      header: [
        "Học viên",
        "Email",
        "Kết quả",
        "Band hiện tại",
        "Band mục tiêu",
        "Buổi được tính",
        "Buổi có mặt",
        "Chuyên cần (%)",
        "Ghi chú buổi học",
        "Lần ghi điểm",
      ],
      widths: [26, 30, 16, 14, 14, 14, 14, 14, 16, 14],
      rows: summary.rows.map((row) => [
        row.name ?? EM_DASH,
        row.email,
        MEMBER_STATUS_LABELS[row.status],
        row.currentOverall,
        row.targetBand,
        row.attendance.counted,
        row.attendance.attended,
        row.attendance.pct,
        row.lessonCount,
        row.scoreCount,
      ]),
    },
    {
      name: "Thông tin",
      header: ["Mục", "Giá trị"],
      widths: [32, 46],
      rows: [
        ["Lớp học", summary.className],
        ["Tháng", summary.monthLabel],
        ["Số học viên", summary.rows.length],
      ],
    },
  ];
}

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

/** "+0.5" / "-0.5" / "0.0" — the arithmetic, with its sign shown. */
function signed(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}
