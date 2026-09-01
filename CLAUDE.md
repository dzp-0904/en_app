# CLAUDE.md — EduTrack project memory

**This file is the persistent source of project context for Claude Code sessions.**
Read it in full before starting any milestone. Do not ask the user for anything
that is already answered here, in the repository, in git history, or in the
current milestone prompt.

Last updated: 2026-09-01, after M29 (M29 is UNCOMMITTED — in the working tree;
M27 was committed by the user as `0269c0a`, M28 as `631a415`).

---

## 0. How to start a milestone

1. Read this file.
2. `git status` and `git log --oneline -5`.
3. Inspect the implementation the milestone touches.
4. Continue from the documented project state.
5. Implement **only** the requested milestone.
6. Test (`tsc`, `lint`, `build`, then the production build).
7. Review the complete diff.
8. Update this file (§3 milestone history, §4 current state, §5 decisions).
9. Report results.
10. **Stop.** Do not begin the next milestone.

---

## 1. Project

| | |
|---|---|
| **Name** | EduTrack (`package.json` name: `edutrack`) |
| **Purpose** | Free progress-tracking and parent-reporting platform for freelance English / IELTS teachers and their students |
| **Framework** | Next.js **16.3.3**, App Router, Turbopack |
| **UI runtime** | React **19.2.8** / react-dom 19.2.8 |
| **Language** | TypeScript 5 (strict; `node node_modules/typescript/bin/tsc --noEmit`) |
| **Package manager** | **npm** (`package-lock.json`) |
| **Database** | Supabase-hosted **PostgreSQL** |
| **Auth** | Supabase Auth (email + password, Google OAuth) via `@supabase/ssr` |
| **Styling** | **Tailwind v4** (`@import "tailwindcss"` + `@theme inline`; there is **no** `tailwind.config`), shadcn-style primitives under `components/ui/` |
| **Deployment** | Docker multi-stage (`Dockerfile`, `compose.yaml`); `next.config.ts` sets `output: "standalone"` |
| **Architecture** | Monolith. No microservices. No unnecessary dependencies. |

### Scripts

Only four exist: `dev`, `build`, `start`, `lint`. There is **no** `typecheck`
and **no** `test` script, and **prettier is not installed**.

```
node node_modules/typescript/bin/tsc --noEmit
npm run lint
npm run build
```

`npm run start` prints `⚠ "next start" does not work with "output: standalone"`.
It still serves correctly and is what previous milestones used for production-build
verification. `node .next/standalone/server.js` is the alternative.

### Important dependencies

`@supabase/ssr`, `@supabase/supabase-js`, `nodemailer` (server-only SMTP),
`radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`,
`lucide-react`, `server-only`, `tw-animate-css`.

**There is no i18n library and none is wanted.** See §7.

### Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SITE_URL`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`.

**Never** add `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` to the
application. **Never** expose SMTP credentials through `NEXT_PUBLIC_*` or import
the mailer into a client component. Never commit `.env` / `.env.local` or bake
SMTP secrets into the Docker image.

### Key files

- `proxy.ts` — **not** `middleware.ts`. Next 16 renamed it; the exported function
  is `proxy`. It refreshes the Supabase session and **nothing else**. It is
  explicitly *not* the authorization boundary (Server Functions POST to their own
  route and proxy may run at a CDN edge). Authorization is RLS + per-action checks.
- `lib/supabase/{server,client,env}.ts` — Supabase client factories.
- `lib/onboarding.ts` — `loadUserState`, `requireTeacher`, `ONBOARDING_STEPS`.
- `lib/teacher.ts` — `loadEditableClass`, `loadTeacherClassDetail`, `loadClassSessions`,
  `loadClassBands`, `loadStudentOverview`, `loadInviteCode`, session/note loaders.
- `lib/student.ts` — `loadStudentClass`, `loadStudentLessons`, `loadStudentBands`,
  session loaders.
- `lib/attendance.ts`, `lib/lesson-log.ts`, `lib/score.ts`, `lib/course-type.ts`,
  `lib/standing.ts` — domain enums **and their Vietnamese display-label maps**.
- `lib/time.ts` — timezone-aware formatters. See §9.
- `lib/auth-messages.ts` — added in M20; maps Supabase/GoTrue English provider
  errors to Vietnamese. Server-only, presentation-only.
- `lib/mail/{mailer,invitation-email}.ts` — server-side SMTP only.
- `lib/monthly-report.ts` — added in M27. `loadMonthlyStudentReport` (the one
  canonical report loader, decision **AA**) and `loadMonthlyClassSummary`.
- `lib/report-period.ts` — `MonthKey`, `parseMonth`, `currentMonth`,
  `monthLabel`, `monthRange`, `shiftMonth`, all on the class's timezone.
- `lib/report-text.ts` — the report's shared presentation vocabulary, so the
  preview and the three export formats word the same fact the same way.
- `lib/export/{blocks,report-document,pdf,docx,xlsx,zip}.ts` — server-only
  document generation. `zip.ts` writes OOXML containers with Node's own `zlib`;
  only the PDF has dependencies (decision **AC**).
- `assets/fonts/` — two Public Sans TTFs + `OFL.txt`, read at request time by
  the PDF route and traced into the standalone build by `next.config.ts`.

### Client components — exactly six

Everything else is a Server Component. Do **not** add `"use client"` without a
concrete interaction reason. M22 replaced `components/shell/nav-item.tsx` with
`components/shell/nav.tsx` — one component marking the active row for seven nav
entries instead of one per row — so the count did not change. M23 added the
sixth, which is client for one reason: `useLinkStatus()` is a hook and must be
called by a descendant of `<Link>`. M24 renamed that file
`components/ui/pending-bar.tsx` → `components/ui/pending-tint.tsx` and changed
what it draws (see decision **U**); the count still did not change.

```
components/shell/nav.tsx
components/roster/tag-editor.tsx
components/auth/submit-button.tsx
components/onboarding/copy-field.tsx
components/attendance/status-buttons.tsx
components/ui/pending-tint.tsx
```

M25 added `components/calendar/week-grid.tsx` and it is a **Server**
Component too: the week comes from the URL and `now` is read once per request,
so nothing on it reacts to anything. The count is still six.

M26 added four more — `components/shell/student-shell.tsx`,
`components/student/score-trend.tsx`, `components/student/homework-list.tsx`,
`components/student/feedback-panels.tsx` — and **every one of them is a Server
Component**. The chart is an inline SVG computed from props; the lists are
markup over rows; the shell is a bar with one `signOut` form in it. The count is
**still six**.

M27 added four more — `components/report/report-preview.tsx`,
`report-hero.tsx`, `skill-radar.tsx` and `score-lines.tsx` — and **every one of
them is a Server Component** too. Both charts are inline SVG computed from
props, which is what lets them appear in the exported PDF and with JavaScript
off. The count is **still six**.

Note that `components/student/band-progress.tsx` is a **Server** Component — a
grep for `"use client"` false-positives on its JSDoc.

State is **URL-driven** (query params + `<Link>`), which is what makes the
application work with JavaScript disabled. Do not replace it with client state.

---

## 2. UI and Figma

**Figma is the visual source of truth.**

```
https://www.figma.com/make/pq6YXXMf03DDXImKFjkGCs/Teacher-Authentication-Flow?code-node-id=0-6&p=f&t=VkrJ2bADTXWXG9Al-0&fullscreen=1
```

The Figma file requires interacting with the login flow before all screens can be
inspected. **Do not ask the user for this URL again.** If the Figma tooling is
available in the session, inspect the file before making visual decisions.

Rules:

- Do **not** redesign the UI merely because the implementation differs slightly
  from the mock.
- Preserve the established design system: spacing, typography, card shapes,
  border radius, colours, buttons, badges, tabs, filter pills, tables, progress
  bars, avatars, page shells, page headers, responsive layout, navigation.
- Vietnamese localization must **not** change the visual hierarchy.
- Adapt layout only where Vietnamese text genuinely requires it: allow natural
  wrapping, adjust flex/grid minimally, use `min-w-0` on the flex item. Never
  introduce horizontal page scrolling, never truncate meaningful text to keep an
  English width, never shrink fonts to force English-sized labels.
- Page titles use Public Sans `text-2xl font-semibold` via
  `components/ui/page-header.tsx`. Lora is the marketing voice (login pull quote,
  signup headline), not the application voice.

### Shared UI primitives (M17)

`components/ui/`: alert, avatar, badge, breadcrumb, button, card, empty-state,
filter-pills, input, label, page-header, page-shell, progress-bar, section-heading,
select, stat-card, table, tabs, textarea. **Nineteen** — M22 added `empty-state`
and `section-heading`.

Conventions: `data-slot` attributes, `cn()` from `@/lib/utils`, `cva` for
variants, `React.ComponentProps<"x">` typing, named exports at the bottom, long
JSDoc comments naming the Figma source and any deliberate deviation. Double
quotes, semicolons, 2-space indent, ~80-column wrapping.

Flexbox note learned the hard way: `flex-1` is `flex: 1 1 0%` — a zero basis
means a block never asks for room and crushes itself. Use `grow basis-64` when a
row must wrap instead.

---

## 3. Localization (as of M20)

- **Vietnamese is the default and only UI language.**
- There is **no language switcher**. Do not add one unless explicitly requested.
- No i18n framework, no dependency, no translation database, no CMS, no external
  service, no client-side state for localization.
- Architecture: domain enum label maps live beside their module
  (`ATTENDANCE_LABELS`, `SKILL_LABELS`, `PERFORMANCE_LABELS`,
  `SCORE_ENTRY_TYPE_LABELS`, `MEMBER_STATUS_LABELS`, `BAND_FIELD_LABELS`,
  course-type `LABELS`); page-specific prose is inline in the JSX.
  `lib/auth-messages.ts` is the one shared module, because two server call sites
  need the same mapping.
- `<html lang="vi">` in `app/layout.tsx`. Both fonts declare the `vietnamese`
  subset.

### Never translate

Database column names, TypeScript identifiers, function names, route segments,
URL query parameter names, Server Action names, database enum values, CSS class
names, email addresses, **user-entered data** (student names, class names, lesson
topics, teacher notes), Figma source files, non-user-facing technical logs.
Localization applies to **display text**, not the data model.

### Established terminology — use these, do not introduce synonyms

| English | Vietnamese |
|---|---|
| Class / Classes | Lớp học |
| Student / Students | Học viên |
| Teacher | Giáo viên |
| Lesson / Session | Buổi học |
| Attendance | Điểm danh |
| Lesson notes | Ghi chú buổi học |
| Note | Ghi chú |
| Score / Scores | Điểm / Điểm số |
| Band / Target band / Current band / Starting band | Band / Band mục tiêu / Band hiện tại / Band ban đầu |
| Progress | Tiến bộ |
| Improving / Steady / Needs attention | Đang tiến bộ / Ổn định / Cần chú ý |
| Strengths | Điểm mạnh |
| Focus areas | Nội dung cần cải thiện |
| Performance | Kết quả |
| Lesson-note result scale (`public.performance`, M28) | Học nhanh / Có cố gắng / Cần cải thiện / Cảnh báo |
| Present / Late / Absent / Excused | Có mặt / Đi muộn / Vắng mặt / Có phép |
| Invite students / Add student / Remove student | Mời học viên / Thêm học viên / Xóa học viên khỏi lớp |
| Edit class / Class Info | Chỉnh sửa lớp / Thông tin lớp |
| Open lesson / Create lesson | Mở buổi học / Tạo buổi học |
| Save / Add / Close / Cancel / Send / View / Back | Lưu / Thêm / Đóng / Hủy / Gửi / Xem / Quay lại |
| Sign out / Sign in / Create account | Đăng xuất / Đăng nhập / Tạo tài khoản |
| Forgot password? / Email / Password | Quên mật khẩu? / Email / Mật khẩu |
| Not set / Not recorded / Joined / Status | Chưa đặt / Chưa ghi nhận / Tham gia / Trạng thái |
| Topic / Skill / Current / Target | Chủ đề / Kỹ năng / Hiện tại / Mục tiêu |
| Teacher note | Ghi chú của giáo viên |

IELTS terminology stays as-is: `IELTS`, `Band 5.5`, `Band 6.0`. Band values are
never spelled out in words. Skills: Reading → Đọc, Listening → Nghe,
Speaking → Nói, Writing → Viết, general → Tổng quát.

Course types: `ielts` → IELTS, `general_english` → Tiếng Anh tổng quát,
`academic_english` → Tiếng Anh học thuật.

### Vietnamese has no plural morphology

English singular/plural ternaries were deliberately collapsed, e.g.
`` `${n} học viên` ``, `` `${n} ghi chú` ``. Do not reintroduce them.

### `lib/course-type.ts` — do not remove `ENGLISH_ALIASES`

`normaliseTeachingType` must keep tolerating English `profiles.teaching_type`
rows, because `app.provision_teacher(uuid, 'General English')` writes them.
The alias table is read-only compatibility, not a language switcher.

---

## 4. Performance — M19, do not regress

M19 fixed slow class-detail tab transitions on `/teacher/[classId]`.

The three tabs (`TABS` in `app/teacher/[classId]/page.tsx`):

| key | English | Vietnamese label |
|---|---|---|
| `students` | Students | **Học viên** |
| `lessons` | Lessons | **Buổi học** |
| `info` | Class Info | **Thông tin lớp** |

Measured in the M20 production build: **11–12 ms per transition**, six
transitions, client-router navigation.

Preserve:

- `prefetch` on the tab links (`components/ui/tabs.tsx`, `prefetch` prop).
- The server-side authorization chain — `loadEditableClass` stays sequential and
  gates everything below it.
- The `Promise.all([sessions, bands, overview])` parallel load.
- `loadClassSessions` gated to `tab === "lessons"` only.
- `loadInviteCode` parallelised with the roster query inside
  `loadTeacherClassDetail` (`lib/teacher.ts`).
- `loadStudentOverview` only when `?student=` is present.
- **No client-side data fetching for protected data.**

Related M19 behaviour to preserve: `?student=` opens the overview panel
(anchor id `student-panel`; roster row anchors are `student-<membershipId>`),
and the `filter` query value survives Close. `filter` values are
`all` / `improving` / `stable` / `needs_attention` — note **`stable`**, whose
display label is "Ổn định".

---

## 5. Attendance

Database enum `public.attendance_status` — four values, unchanged:

```
present   late   absent   excused
```

Display via `ATTENDANCE_LABELS` in `lib/attendance.ts`:
Có mặt / Đi muộn / Vắng mặt / Có phép.

`components/attendance/status-buttons.tsx` implements optimistic visual feedback
using **`useFormStatus().data`**. Do **not** replace it, do not make the buttons
slower, do not swap `aria-busy` for `disabled`. One form, four submit buttons,
each carrying its own `status` value — so it works with JavaScript disabled and
the server re-validates `status` against the enum.

Null attendance is a state of its own ("Chưa ghi nhận") — never `absent`, never a
row invented to make a line read better.

---

## 6. Scores

`public.score_entries` is **append-only**. `20260828001400_grants.sql` grants no
UPDATE and `enforce_score_entries_append_only` refuses one. **Do not invent an
UPDATE path.**

Correction model: **remove the existing entry → record a new entry.**

- Audit field is **`created_by`** (`not null references public.profiles(id) on delete restrict`).
- There is **no `session_id`** on `score_entries`. It hangs off
  `(class_member_id, class_id)` plus `recorded_on date`. "This lesson's entries"
  means entries dated to the day the lesson happened on, read on the **class's**
  timezone via `zonedCalendarDate`.
- `score_entries_not_empty`: at least one of overall/reading/listening/writing/speaking.
- Band domain `public.band` is every half point 0.0–9.0; `BAND_VALUES` in
  `lib/score.ts` is that CHECK written out.
- Only IELTS classes are band-scored (`scoringModelFor` / `isBandScored`;
  `classes_no_target_band_when_unscored` is the schema agreeing).
- Standing values come from the views `v_member_current_band` and
  `v_member_performance_status`. **Do not average, compare, or derive bands in
  page code** — two copies of those definitions would be two chances for the
  teacher's screen and the student's to disagree.

---

## 7. Timezone

Use `lib/time.ts`. **Never** use `toISOString().slice(0, 10)` for calendar-date
conversion.

- `formatZonedDate(zone, iso)` → `vi-VN`, weekday long + `dd/MM/yyyy`
  (e.g. `Thứ Bảy, 29/08/2026`). Vietnamese short months render "thg 9", which
  reads badly, hence numeric.
- `formatZonedTime(zone, iso)` → `vi-VN`, 24-hour `HH:mm` (`hour12: false`).
  24-hour is Vietnamese convention *and* narrower than "7:30 PM".
- `zonedCalendarDate(zone, iso)` assembles `YYYY-MM-DD` from parts and stays on
  `en-GB` on purpose — it is not user-facing.
- `app/join/[code]/page.tsx` hand-assembles `MM/YYYY` ranges (`monthOf`,
  `monthYearOf`) because `Intl` with `vi-VN` produces the phrase
  "tháng 09, 2026".

**The class's timezone is authoritative** for displaying lesson/session dates and
times. `classes.schedule_note` is display-only by the migration's own comment —
`class_sessions` is authoritative.

---

## 8. Authorization

Never weaken the existing chain.

**Teacher operations:**

```
authenticated → teacher → owned class → child resource → membership → operation
```

**Student operations:**

```
authenticated → student → own class membership → own resources
```

Never trust from the client: teacher ids, ownership flags, redirect
destinations, membership ownership claims, `recorded_by` / `created_by` values.
Identity comes from the session cookie, server-side.

Patterns already in the code, keep them:

- `authoriseClass` / `authoriseRoster` in `app/teacher/[classId]/actions.ts`.
  Ownership is settled **before** the membership id is looked at, so a request
  naming another teacher's class returns the same 404 whatever it puts in the
  second argument.
- Another teacher's class is reported exactly as one that does not exist
  (`notFound()`), so a 404 says nothing about who else is enrolled.
- Write filters put state checks in the WHERE clause (`join_status`,
  `removed_at`) rather than reading first and asserting, so concurrent clicks
  cannot both succeed.
- Removal is `removed_at`, never `join_status = 'departed'` — that value is the
  account-deletion tombstone written by `app.anonymise_departed_student`.
- A failed load renders an alert, never a 404: "no lessons recorded" is a claim
  the page may only make on an answer it actually got. `null` ≠ `[]`.
- Errors: do not display raw Postgres/internal errors. Log server-side
  diagnostics via `logDbError`, never logging passwords, SMTP credentials,
  access tokens, OAuth codes, or other secrets.

`lib/auth-messages.ts` maps provider errors to Vietnamese. It changes **no**
error condition, redirect, or HTTP behaviour, preserves Supabase's deliberate
non-enumerability of accounts, and `console.error`-logs unmapped messages rather
than rendering them.

---

## 9. RLS and the database

RLS is part of the security model. It is **enabled and FORCEd on all 13 tables**.

- Do not bypass RLS.
- Do not introduce service-role access for normal application functionality.
- Do not move protected database reads into the browser for UX.
- Do not add an API endpoint to work around a policy.

**The actual schema is the source of truth for data relationships.** If milestone
wording conflicts with the real schema, **follow the schema** and say so in the
report. Do not create migrations merely to satisfy wording the existing schema
already supports. Do not change the schema outside explicit milestone scope.

If a change appears to require a migration, an RLS change, an RPC change, a new
dependency, service-role access, or client-side protected data — **stop and
explain the architectural impact before proceeding.**

### Migrations (`supabase/migrations/`, 15 files, all dated 20260828)

```
000100_extensions_and_schemas   000200_enums_and_domains
000300_tables_core              000400_tables_sessions_scores
000500_tables_homework_reports_tuition
000600_indexes                  000700_trigger_functions
000800_triggers                 000900_app_helper_functions
001000_rls_enable               001100_rls_policies
001200_views                    001300_rpcs
001400_grants                   001500_seed_mistake_tags
```

**Do not execute migrations against the hosted Supabase project.** Do not modify
existing migrations or RLS policies.

### Enums (`public`)

`app_role(teacher,student)` · `course_type` · `scoring_model(ielts_band,none)` ·
`skill` · `performance` · `join_status(invited,joined,departed)` ·
`session_status(scheduled,completed,cancelled)` ·
`attendance_status(present,absent,late,excused)` ·
`score_entry_type(baseline,progress,mock_test)` · `homework_status` ·
`report_status` · `payment_status` ·
`member_status(improving,stable,needs_attention)`.

### Views

`v_member_session_attendance`, `v_member_attendance_summary`,
`v_member_performance_status`, `v_member_current_band`.

### RPCs

`generate_invite_code`, `get_class_invite_preview`, `join_class_with_code`,
`submit_homework`, `create_report_share_link`, `revoke_report_share_link`,
`get_shared_report`.

### `app` schema helpers

`is_teacher`, `is_class_teacher`, `my_class_ids`, `my_member_ids`,
`my_student_class_ids`, `my_teacher_ids`, `my_student_ids`, `provision_teacher`,
`set_account_active`.

---

## 10. Student / teacher separation

Teacher routes must not leak into student navigation; student routes must not
expose teacher functionality. Preserve the existing redirects:

- `/` places the account: teacher → `/teacher`, student → `/student`,
  anonymous → the marketing panel, unplaceable → an explanatory card.
- `app/teacher/layout.tsx` requires `kind === "teacher"` **and**
  `isOnboardingComplete`.
- `app/student/layout.tsx` requires `kind === "student"`.
- A student must only ever see their own memberships. Never query memberships by
  a client-supplied `student_id`.
- Do not allow arbitrary users to promote themselves to teacher.
- `/` is **not** a dashboard and must not be called one. The **teacher
  dashboard is `/teacher`**, added in M22; the full class list moved to
  `/teacher/classes`. Those are two destinations, not one label twice.

---

## 11. Responsive

Tested widths: **1280, 768, 390, 360, 320**.

- Zero page-level horizontal scrolling.
- Meaningful text must not be clipped.
- Internal table scrolling is acceptable where already designed
  (`components/ui/table.tsx` wraps tables in an `overflow-x: auto` scroller).
  M25 applied the same treatment to the calendar: `week-grid.tsx` keeps a
  `min-width` of 672px (56px gutter + 7×88px) inside a labelled, focusable
  `overflow-x-auto` region. It fits without scrolling at 768/1024/1280 and
  scrolls **inside the card** at 390/360/320. The page still never scrolls
  sideways at any width.

Testing note: `documentElement.scrollWidth` is **unreliable** when a `<table>`
sits inside an `overflow-x:auto` scroller. The authoritative test is
`window.scrollTo(9999, 0)` then read `window.scrollX` /
`document.scrollingElement.scrollLeft`.

Known, by-design clipping: the invite-link `<code>` in `copy-field.tsx` is
`truncate` and paired with a Copy button; `sr-only` labels are hidden by
definition.

---

## 12. No-JavaScript

Progressive enhancement is a requirement, not a nicety.

- Pages render, links navigate, forms submit, Server Actions work.
- Tabs and filter pills are plain `<Link>`s.
- The authentication flow works.
- Do not implement anything using client-only rendering.
- Do not introduce client-only behaviour unnecessarily.

Verified with CDP `Emulation.setScriptExecutionDisabled`.

---

## 13. Milestone history

Statuses: **Implemented** = in the codebase. **Verified** = actually exercised in
this project's testing (browser/CDP against a running build). **Limitations** =
known gaps.

### M12 — `74d733e` student-side attendance visibility
- **Implemented:** student lesson attendance view; optimistic attendance
  interaction in `components/attendance/status-buttons.tsx` using
  `useFormStatus().data`; server confirmation; rollback on failed Server Action;
  no-JS fallback (one form, four submit buttons).
- **Verified:** attendance interaction and no-JS fallback exercised in the
  milestone's own session. In M20 the component was re-checked by diff only —
  the optimistic mechanism is untouched — and the four buttons were confirmed to
  render under JS-disabled.
- **Limitations:** attendance at a cancelled lesson is deliberately not shown;
  `v_member_session_attendance` excludes cancelled sessions.

### M13 — `fc136f2` / `1d4c2a9` / `3465c6a` scores and lesson notes
- **Implemented:** score recording, band validation against `public.band`,
  append-only correction (remove → re-record), teacher and student score
  visibility, teacher lesson notes, student lesson history and notes.
- **Verified:** score entry, validation refusal, and the remove/re-record path
  exercised in the milestone's own session.
- **Limitations:** no UPDATE path exists by design; entries are associated to a
  lesson by `recorded_on` date on the class clock, not by a `session_id`.

### M14 — `fc136f2` target band
- **Implemented:** `class_members.target_band`, teacher-side set/change/clear,
  student-side display, `classes_no_target_band_when_unscored` respected.
- **Verified:** set/clear exercised in the milestone's own session.

### M15 — `b942849` strengths and focus areas
- **Implemented:** `class_members.strengths` / `focus_areas` (`text[] not null
  default '{}'`), `components/roster/tag-editor.tsx`, one Server Action writing
  both columns, `readTags` validation (blank / too-long / duplicate / too-many /
  shape), student read-only view.
- **Verified:** tag add/remove and each refusal message exercised in the
  milestone's own session.
- **Limitations:** neither column has a database constraint; `readTags` is the
  only place the rules exist.

### M16 — `9049470` teacher-side student overview
- **Implemented:** the student overview panel and roster interaction on
  `/teacher/[classId]`, `?student=` selection, remove-student flow.
- **Verified:** panel open/close and remove-student confirmation exercised in the
  milestone's own session.

### M17 — `ad85f33` Figma UI foundation
- **Implemented:** the 17 shared primitives in `components/ui/`, `data-slot` /
  `cn()` / `cva` conventions, `page-header`, `page-shell`, `tabs`,
  `filter-pills`, `table`, `progress-bar`, `stat-card`, `breadcrumb`.
- **Verified:** rendered on a temporary `/m17-preview` route and probed for
  overflow at 320–1280px; the preview route was removed before completion.
- **Limitations:** existing pages were not rewritten to use the primitives; they
  adopt them as each is rebuilt.

### M18 — `72766ab` teacher class-detail visual alignment
- **Implemented:** `/teacher/[classId]` restyled onto the M17 primitives — page
  header, stat cards, tab strip, filter pills, roster table, Class Info grid,
  invite panel.
- **Verified:** visual pass and responsive probe in the milestone's own session.

### M19 — `27611ca` student overview fidelity + tab performance
- **Implemented:** the student overview panel restyled to the Figma
  student-detail language (Journey milestones, skill cards, score history,
  attendance, lesson notes, target band, standing notes); tab performance fix —
  `prefetch` on the tab strip, `loadClassSessions` gated to the Lessons tab,
  `loadInviteCode` parallelised with the roster query, `loadStudentOverview`
  only when `?student=` is present.
- **Verified:** the six tab transitions measured in a production build;
  `?student=`, filter preservation across Close, responsive layout at
  1280/768/390/360/320, and no-JS navigation all exercised.
- **Limitations:** `filter=stable` is the query value whose label is "Ổn định" —
  a mismatch that has caused false bug reports; do not "fix" it.

### M20 — `6e5d9f8` Vietnamese UI localization
- **Implemented:** full Vietnamese UI across 41 modified files + 1 new
  (`lib/auth-messages.ts`), 758 insertions / 582 deletions.
  - Enum label maps translated in place; page prose translated inline.
  - `lib/auth-messages.ts` maps GoTrue provider errors; unmapped messages are
    logged server-side, never rendered.
  - `lib/time.ts` → `vi-VN`, 24-hour clock, `dd/MM/yyyy`.
  - `lib/course-type.ts` → `ENGLISH_ALIASES` added so English
    `profiles.teaching_type` rows still resolve.
  - `<html lang="vi">`; invitation email subject/body/plain-text translated.
  - Two English singular/plural ternaries collapsed.
  - **No** i18n dependency, **no** language switcher, **no** `"use client"`
    added, **no** schema / RLS / RPC / migration changes.
- **Verified** against the production build with CDP:
  login, signup, `/`, join landing (valid and invalid code), all four onboarding
  steps, teacher class list, class detail × 3 tabs, student overview panel,
  lesson detail, new lesson, new/edit class, both not-found pages, empty filter
  state, stale and malformed `?student=`, student dashboard, student class page,
  student lesson page. Real auth failures through the real Server Actions
  (wrong password → "Email hoặc mật khẩu không đúng.", blank submit →
  "Vui lòng nhập cả địa chỉ email và mật khẩu."). Tab transitions **11–12 ms**.
  Responsive 1280/768/390/360/320 — zero page-level horizontal scroll on 11
  pages; nothing clipped beyond the two by-design cases. No-JS pass: pages
  render, tabs navigate as links, forms and Server Actions intact.
  `tsc --noEmit`, `npm run lint`, `npm run build` all clean; **20 routes**.
- **Limitations:**
  - The attendance and score **write** paths were **not** exercised in M20,
    deliberately — the only seeded class is real production data and the
    standing instruction forbids writing test data into it. M12/M13 coverage
    plus a diff review of `status-buttons.tsx` is what stands behind those.
  - No dedicated password-reset UI exists yet, so there was nothing to localize
    for that flow.

---

### M21 — `24ed32b` Figma UI fidelity and UX polish
- **Audited** (Phase A, before any edit): the Figma Make source for the shell
  (`Layout.tsx`), teacher Dashboard, ClassDetail, CreateClass and student
  Dashboard, against authentication, onboarding, all teacher screens, all
  student screens and every shared primitive. **No P0.** Five P1 findings, one
  P2, and a documented NO-CHANGE list.
- **Implemented** — 10 files, 0 new components, 0 new dependencies:
  - **Application titles moved off Lora.** Eight pages set their `h1` in
    `font-serif text-2xl leading-relaxed`; the Figma uses Lora exactly twice in
    thirteen screens (login pull quote, signup headline) and sets every
    application title in Public Sans `text-2xl font-semibold`, which
    `PageHeader` already renders. `app/page.tsx` and
    `components/auth/brand-panel.tsx` **keep** Lora — that is the marketing
    voice and is correct there.
  - **`PageShell` adopted on all eight remaining pages**, at the Figma's own
    widths: teacher screens start-aligned (`3xl` class list, `2xl` forms,
    `4xl` lesson detail) because the Figma's teacher screens hang from the
    sidebar's edge; student screens centred (`lg`) because its student screens
    centre. `/teacher` alone is conditional — un-onboarded it has no shell to
    hang from, so it keeps the wizard's centred `lg` column and its `LogoMark`.
  - **`← Quay lại …` ghost buttons replaced by `PageHeader breadcrumb`** on all
    eight. The Figma draws a trail above the title, and a `<nav
    aria-label="Đường dẫn">` + `<ol>` is also the better control.
  - **Both lesson-detail pages restructured to the Figma header**: the lesson
    titles the page (`session.title ?? "Buổi học"`), the class names the trail,
    and the date/time become two `meta` nodes instead of one `·`-joined string
    so a narrow screen wraps between them.
  - **Sidebar account block gained the Figma's 32px initials disc** —
    `Avatar size="md" tone="primary"`, `aria-hidden` because the name is
    printed beside it.
  - **Teacher class cards now show schedule and target band.** Both were
    already returned by `loadTeacherClasses` and discarded. Band is formatted
    `IELTS 6.5` via `toFixed(1)`, matching the class-detail and join pages.
  - **Nav item geometry** `px-3 py-2` → `px-3 py-2.5`, `font-medium` on both
    states (P2).
- **Defect found and fixed during verification:** `Breadcrumb` renders its
  **last** item as `aria-current="page"` *text*, never a link. Trails that ended
  on the class name therefore lost the link and mislabelled the current page.
  Every trail now terminates on the page it is on. **This is a standing rule:
  the last `Crumb` is the current page — never put an ancestor there.**
- **Verified** against the production build with CDP:
  - Tab transitions **11–13 ms** across three runs of all six hops — the M19
    baseline is 11–12 ms. **No regression.** `app/teacher/[classId]/page.tsx`,
    `lib/teacher.ts` and `components/ui/tabs.tsx` are untouched by M21.
  - Responsive 1280/768/390/360/320 across 15 pages: **zero page-level
    horizontal scroll everywhere.** Clipping is only the three known cases —
    the invite `<code>` (`truncate` + Copy, by design), `sr-only` labels
    (hidden by definition), and at 320px the `schedule_note` text input whose
    *value* is longer than the field, which is native `<input>` scrolling and
    not a layout defect.
  - No-JS on all 10 changed pages: render, headings, breadcrumb links, forms;
    the teacher lesson page still emits its **four** attendance submit buttons.
  - M16/M19 query behaviour: `?student=` opens the panel, Close preserves
    `filter=improving`, stale and malformed `?student=` still give the
    Vietnamese alert rather than a 404, filter pills unchanged.
  - Accessibility on all 9 signed-in pages: exactly one `h1`, exactly one
    `aria-current="page"` crumb, every avatar `aria-hidden`, zero nameless
    controls, zero unlabelled inputs.
  - English-string sweep of the rendered text on 15 pages: clean.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **20 routes**, no
    debug or preview route.
- **Limitations:**
  - The attendance and score **write** paths were again not exercised — the only
    seeded class is real production data and the standing instruction forbids
    writing test data into it. `status-buttons.tsx` and every action file are
    untouched by M21; M12/M13 coverage plus the no-JS render of the four
    buttons is what stands behind them.
  - The Figma's own teacher Dashboard also carries a "Students Needing
    Attention" list and a "Recent Progress" feed. Both are driven by hardcoded
    mock data in the Make source and neither has a query behind it here, so
    neither was built. This is why `/teacher` uses `3xl` — the width the
    Figma's class list actually occupies inside its 5xl dashboard — rather than
    stretching one column across `5xl`.
  - `get_metadata`, `get_screenshot` and `get_variable_defs` are unsupported for
    Figma **Make** files. `get_design_context` on node `0:1` plus
    `ReadMcpResourceTool` on the returned `file://figma/make/source/...` URIs is
    the working route, and the Make source *is* the design.

### M22 — Complete Figma UI reconstruction
- **Audited** (Phase 1, before any edit): the whole Figma Make source, not one
  node — `Layout.tsx`, the teacher Dashboard, Classes, ClassDetail, CreateClass,
  Calendar, LessonLogs, Reports, Tuition, Settings, StudentDetail, and the
  student Dashboard, plus authentication. The screen inventory was built first,
  then every screen classified A/B/C/D.
- **The brief's premise about a missing backend was wrong, and the schema won**
  (decision **B**). `lesson_logs`, `class_sessions`, `monthly_reports`,
  `tuition_records` and `profiles` have all existed since the foundation commit,
  with constraints, teacher-scoped RLS policies and grants to `authenticated`.
  So Calendar, Lesson Logs and Settings → **A**; Reports and Tuition → **A** for
  read, **B** for write (no compose/record UI was invented). **No category D,
  and therefore zero migrations, zero RLS/RPC/grant/schema changes.**
- **Implemented** — 12 files changed, 17 new, 0 new dependencies:
  - **Shared UI:** `components/ui/empty-state.tsx` and
    `components/ui/section-heading.tsx` (the primitives count is now 19);
    `stat-card.tsx` gained the Dashboard's optional tinted `tone` square;
    `components/shell/nav.tsx` replaced `nav-item.tsx` (still five client
    components); `components/icons/nav-marks.tsx` draws the six new nav marks.
  - **Shell:** `app-shell.tsx` now renders the Figma's seven teacher sections —
    Tổng quan, Lớp học, Lịch dạy, Nhật ký buổi học, Báo cáo, Học phí, Cài đặt.
    `fallback` is why `/teacher/new` and `/teacher/<id>` mark **Lớp học** active
    rather than the dashboard they sit under. The student's nav stays one row:
    the Figma has exactly one student screen, and inventing a second section
    would be inventing a feature.
  - **Teacher:** `/teacher` became the Figma Dashboard (greeting, four derived
    counts, class list, "Học viên cần chú ý"); the class list moved to
    `/teacher/classes`; new `/teacher/calendar` (week strip over
    `class_sessions`), `/teacher/lesson-logs` (real `lesson_logs` with class and
    skill filter pills), `/teacher/reports`, `/teacher/tuition`, and
    `/teacher/settings` + `actions.ts` (`updateProfile` over `profiles`).
  - **Student:** `components/student/band-progress.tsx` — the Figma's navy hero,
    a **server** component; `/student/[classId]` gained "Lịch sử điểm" and
    "Nhận xét của giáo viên"; `/student` gained an `EmptyState` and a count.
  - **`lib/`:** new `dashboard.ts`, `calendar.ts`, `lesson-logs.ts`,
    `reports.ts`, `tuition.ts`; `student.ts` gained the four baseline skill
    columns (`v_member_current_band` already carried them — only the select
    string was short), `loadStudentFeedback` and `loadStudentScoreHistory`.
  - **Breadcrumbs repointed:** seven `{ label: "Lớp học", href: "/teacher" }`
    crumbs across five files now point at `/teacher/classes`, because `/teacher`
    is the dashboard; the class-detail error frame's duplicated crumb was fixed.
- **Deliberate deviations from the Figma, all recorded in JSDoc:**
  - The Figma's student "Score Over Time" is a **recharts** LineChart. It is
    rendered here as an oldest-first list of real `score_entries` — a charting
    dependency is decision **E**, and §21 asks to keep the server-rendered
    architecture.
  - Settings' "Change password" and "Two-factor authentication" have no handler
    in the Figma and no backend here, so they are **non-interactive rows marked
    "Chưa khả dụng" / "Chưa bật"**, not dead buttons.
  - The Dashboard's "Recent Progress" feed and Tuition's "Send reminder" are
    Figma mock data with no query behind them; neither was fabricated.
  - `share_token_hash` is **never** selected by `lib/reports.ts`.
- **Verified** against the production build with CDP:
  - **Responsive:** 15 teacher pages × 6 widths (1280/1024/768/390/360/320),
    3 student pages × 6 and 6 anonymous pages × 6 — **144 page-width
    combinations, zero page-level horizontal scroll.** Clipping only in the
    known by-design cases (`sr-only`, the invite `<code>`).
  - **Accessibility:** every page exactly one `h1`; zero nameless controls; zero
    unlabelled inputs; zero duplicate ids; zero exposed avatars. Every
    `aria-current="page"` sits in its own labelled `nav` — main navigation,
    breadcrumb, tabs, filter groups — one per landmark.
  - **No-JS** (`Emulation.setScriptExecutionDisabled`) on all 14 teacher and 3
    student pages: render, headings, breadcrumb links, forms. The teacher lesson
    page still emits its **four** attendance submit buttons.
  - **M16/M19 behaviour:** `?student=` opens the panel under all four filter
    values, Close preserves each one plus the roster anchor, stale and malformed
    `?student=` still give the Vietnamese alert rather than a 404.
  - **Security:** the student account is redirected to `/student` from all eight
    teacher routes including the five new ones; a class the account is not in is
    `notFound()` for both roles; foreign-class 404 parity intact.
  - **Settings Server Action exercised end-to-end** by submitting the teacher's
    **identical** existing values — success notice rendered, and both stored
    values re-read unchanged — plus the server-side refusal path (blank name,
    `required` removed client-side → "Vui lòng nhập tên mà học viên sẽ nhìn
    thấy.", nothing written).
  - **English-string sweep** of rendered text on 18 pages: the only English is
    the teacher's own note text, which is user data and must not be translated.
  - **Typography:** Lora appears in exactly three places — the landing headline,
    the login pull quote, the signup headline. Decision **N** intact.
  - **Tab transitions** re-measured with a `MutationObserver` on the first
    router DOM commit: **3–7 ms** across 3 runs × 6 hops. That is a *different
    instrument* from M19/M21's rAF-based 11–13 ms and is **not** comparable
    like-for-like; the rAF instrument on this build returned 13–32 ms, which is
    frame-quantised at 16.7 ms rather than a regression.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **25 routes**
    (24 `page.tsx` + `app/auth/callback/route.ts`), no debug or preview route.
- **Limitations:**
  - The attendance and score **write** paths were again not exercised — the only
    seeded class is real production data and the standing instruction forbids
    writing test data into it. `status-buttons.tsx` and every
    `app/teacher/[classId]/actions.ts` path are untouched by M22.
  - "A student cannot see a classmate's data" could not be exercised
    **empirically**: the one class has one member, and creating a second is a
    production write. It rests on `class_members_student_select` and on the
    student loaders taking `membershipId` from the session, never from the URL.
  - `monthly_reports` and `tuition_records` are empty in production, so both
    pages were seen only in their empty state. Their populated branches are
    code-reviewed, not screenshotted.
  - Report **compose** and tuition **record** flows were not built: the brief
    asked to reproduce UI structure first and not to auto-implement backend.
  - A temporary `app/m22-preview` route was used to see the band hero without
    writing `score_entries` into `IELTS Evening Group B`. It was deleted, its
    absence confirmed, and the tree rebuilt before the route count was read.

### M23 — Final Figma fidelity, navigation performance and UX polish
- **Audited** (Phase 1, before any edit): the complete Figma Make source again,
  enumerated from `get_design_context` on node `0:1` rather than guessed —
  `Layout.tsx`, `LoginPage`, `SignupPage`, `OnboardingPage`, `JoinPage`, the ten
  teacher screens and the one student screen. **The file has no `Classes.tsx`**
  (decision **T**): `/teacher/classes` has no design to be faithful to, which
  retired the standing worry that its card was "richer than the Figma".
- **The Settings icon (§2, mandatory).** `SettingsMark` was a disc with eight
  radial rays — a **sun**. Redrawn as a **gear**: a toothed ring around a hub,
  inside the same `Mark` wrapper, so it keeps the 16px box, `strokeWidth 1.5`,
  `currentColor`, `aria-hidden` and `focusable="false"` the other six carry.
  `lucide-react` is installed but imported **nowhere** in `app/`, `components/`
  or `lib/` — the hand-drawn `Mark` set is the real icon system, so "prefer the
  existing library" meant drawing it there.
- **Six further visual defects found and fixed, all genuine M22 mismatches:**
  1. `StatCard` carried an invented `navy` tone — a near-black dot the Figma
     never draws. Removed (decision **S**).
  2. Tuition's three summary cards were rendered as the Dashboard's dotted tile.
     The Figma gives them no square, the label *above* the number, and the
     colour on the number itself. Now `layout="label-first"` + `valueTone`.
  3. `Card` carried `shadow-sm` unconditionally. The Figma uses a shadow
     **once** in fifteen screens. Split into three variants (decision **R**).
  4. List rows used the 16px radius; the Figma's list card is 12px — `list`.
  5. The dashboard's per-student strip painted "stable" **indigo**; the Figma
     paints `#E8E6DE`, the border grey, i.e. an *unfilled* segment. A student
     with nothing to report was the most emphasised thing on the card.
  6. The sidebar rendered `heading` as an uppercase line above the nav. The
     Figma sets it as a 10px subtitle under the wordmark, with a rule closing
     the logo block — now `LogoMark subtitle=`.
- **The navigation delay: root cause, measured not guessed.** One warm Supabase
  round trip on this hosted project was measured here at **~62-67 ms**. (M24
  re-measured this from Node, outside the browser's CORS preflight, and found
  the hops are **not** all the same size: PostgREST is **76-91 ms** and
  `auth.getUser()` is **146-150 ms**. The M23 conclusion — six sequential trips
  is the problem — is unaffected; the per-hop figure it quotes is low and
  averages two different costs.) Every teacher list page
  ran **six strictly sequential** trips — `auth.getUser()` → `profiles` →
  `classes` probe → `classes` → `class_members` tally → the feature loader —
  ≈400 ms, matching a measured 280-745 ms server render and 496-1024 ms from
  click to content. And **nothing acknowledged the click** until the whole RSC
  payload landed. Two fixes, both structural:
  - **Fewer round trips.** `loadTeacherClasses` split into
    `loadTeacherClassList` / `tallyClassMembers` / `withMemberCounts`: Lịch dạy,
    Nhật ký buổi học, Báo cáo and Học phí were each paying for a
    `class_members` read they discarded. `lib/dashboard.ts` folds the tally into
    its existing `Promise.all` instead of running it ahead. `readUserState`
    issues `profiles` and the teacher `classes` probe concurrently.
    `loadStudentLessons` went from 3 sequential trips to 1 `Promise.all`.
    `auth.getUser()` is **untouched** — it is the real Auth round trip that
    gates writes.
  - **`components/ui/pending-bar.tsx`** (the sixth client component) on `Nav`,
    `Tabs` and `FilterPills`. `useLinkStatus()`, a 2px bar under the label while
    the navigation is in flight (decision **U**).
- **Deliberate non-changes, each argued:** no blanket `prefetch` on the sidebar
  (7 dynamic per-teacher routes) or the filter pills (8+ variants) — it would
  multiply Supabase reads for navigations that may never happen (§33); no
  `loading.tsx` (on a same-route search-param change it blanks the filter row
  too); no charting library; Calendar stays a seven-column agenda rather than
  the Figma's absolutely-positioned 16h × 7d pixel canvas, which cannot meet
  the zero-horizontal-scroll requirement at 320px; Reports keeps its honest
  empty state rather than the Figma's mock-driven report card.
- **Verified** against the production standalone build on `localhost:3000`:
  - **Interaction:** 17 interactions measured. Click-to-feedback **1-2 ms on
    every one** — before, there was no feedback of any kind until the content
    landed. `url`/`selected` 334-595 ms. **Exactly one request per navigation
    destination; no duplicate destination fetches.** The extra requests seen are
    prefetches: M19's deliberate class-detail tab prefetch multiplies with the
    filter in the href, and `/sessions/<id>` / `/sessions/new` were each
    prefetched twice under different `_rsc` hashes. Left in place — §4 of this
    file requires preserving that prefetch — and reported as a measured cost.
  - **Responsive:** 8 teacher list pages, 7 class-detail routes, 5 anonymous
    pages and 3 student routes × 6 widths (1280/1024/768/390/360/320) = **138
    page-width combinations, zero page-level horizontal scroll.** Clipping only
    in the two by-design cases (`sr-only`, the invite `<code>`).
  - **Accessibility:** 20 pages, **0 problems.** One `h1` each; one
    `aria-current="page"` per labelled landmark; zero nameless controls, zero
    unlabelled inputs, zero duplicate ids, zero exposed avatars, zero exposed
    pending bars. The gear stays accessible — the SVG is `aria-hidden` and
    "Cài đặt" names the link.
  - **No-JS:** 15 teacher + 3 student pages render with h1, seven nav links,
    breadcrumb links and forms. **`pendingBars=0` on every page** — the bar
    renders nothing without JS and cannot break the no-JS path. The teacher
    lesson page still emits its **four** attendance submit buttons (M12 intact).
  - **History:** deep links work, refresh preserves the filter, Back ×2 and
    Forward restore the correct selected pill. `?student=` opens the panel;
    Close preserves `filter=stable` **and** the roster anchor. Stale and
    malformed `?student=` still give the Vietnamese alert, not a 404.
  - **Security:** `git diff --stat` on `components/attendance/`,
    `app/teacher/[classId]/actions.ts`, `app/auth/actions.ts`, `supabase/`,
    `proxy.ts` and `lib/supabase/` is **empty**. `useFormStatus` still at
    `components/attendance/status-buttons.tsx:46`. The student account is
    redirected to `/student` from **all 11** teacher routes.
  - **Console:** 19 pages, **0 errors and 0 warnings** — no hydration errors,
    no React errors, no duplicate keys.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **25 routes**.
- **Limitations:**
  - `tuition_records` is empty in production, so the new `label-first` card
    shape is verified by type-check and code review, **not screenshotted** —
    seeing it populated would require writing production data.
  - The attendance and score **write** paths were again not exercised, for the
    same reason. Every action file and `status-buttons.tsx` are untouched by
    M23; M12/M13 coverage plus the no-JS render of the four buttons is what
    stands behind them.
  - The prefetch duplication above is a real, measured cost that M23 chose not
    to remove because §4 forbids touching that prefetch.
  - Millisecond figures are from in-page instrumentation on this machine
    against a hosted Supabase project. They are reproducible in kind — six
    sequential round trips versus fewer — but the absolute numbers move with
    network latency and are not a benchmark.

### M24 — Navigation responsiveness and interaction polish
- **Diagnosed before any edit, as the brief required.** The upstream hops were
  timed from **Node** rather than the browser: a `fetch` carrying an `apikey`
  header triggers a CORS preflight that roughly doubles what the page sees, and
  an RSC probe (`-H "RSC: 1"`) returns a flat ~220 ms without doing a full
  render — both instruments were tried and discarded. The real split:
  **`auth.getUser()` 146-150 ms**, **PostgREST 76-91 ms**. The Auth hop is
  ~2× a database hop and was the single most expensive, strictly-blocking one.
- **Two structural defects, both real, both fixed:**
  1. **`getUser()` was awaited alone at the head of `readUserState`**, delaying
     reads that do not depend on its answer. The subject id now comes from
     **`getClaims()`** — local WebCrypto verification against a cached JWKS, no
     round trip — and `getUser()`, the `profiles` read and the class read are
     issued **concurrently**. `getUser()` still runs on every request and still
     decides: no claims → anonymous with **no query issued at all**; claims but
     `getUser()` says no → anonymous with **every row discarded unread**. The
     reads carry the very token being checked, so RLS scopes them to that
     subject whatever `sub` says. Same decision, same evidence, one trip
     earlier.
  2. **`classes` was read twice on every teacher page** — `readUserState`'s
     `select id, name … limit(2)` probe, then `loadTeacherClassList`'s identical
     query (same table, same `eq`/`is`/`order`, wider projection) one round trip
     later. The probe is now `loadTeacherClassList` itself and the rows ride on
     `TeacherContext.classes`; `/teacher`, `/teacher/classes`, `/teacher/calendar`,
     `/teacher/lesson-logs`, `/teacher/reports` and `/teacher/tuition` take the
     list from there. `loadTeacherClasses` and `loadTeacherDashboard` now accept
     rows instead of a teacher id. The `classes === null` alert branches on the
     four pages went with it — an unreadable class list is reported one layer up
     as an unplaceable account, so those branches were unreachable.
- **Deliberately declined:** dropping `.in("class_id", scope)` from the feature
  loaders to parallelise them (trades defence-in-depth scoping for ~82 ms);
  starting feature loaders before `getUser()` answers (data queries ahead of the
  authorization answer); speculatively parallelising the student
  `loadStudentClasses` read (a wasted statement on every teacher request, for a
  route nobody reported as slow).
- **The reported underline was M23's own `PendingBar`** — confirmed by
  screenshotting a navigation mid-flight. A 2px rule the width of the label, a
  few pixels under it, on a link, is text decoration however it was intended,
  and nothing in the Figma underlines anything. Replaced by
  **`components/ui/pending-tint.tsx`**: the same `useLinkStatus()` state drawn
  as `absolute inset-0 bg-current/10 rounded-[inherit] animate-pulse` — the
  label's own colour at a tenth strength, invisible over the text and a light
  wash over the row, taking the host's radius so a `rounded-lg` nav row, a
  `rounded-md` tab and a `rounded-full` pill all fit. Measured live: the element
  is exactly the link's box (40×199), `border-radius: 8px`, and `pending-bar`
  count is 0.
- **A second defect found during verification: the focus ring never rendered
  anywhere.** In Tailwind v4 `outline-none` emits `--tw-outline-style: none`,
  and the width utility `outline-2` emits `outline-style: var(--tw-outline-style)`
  — so `outline-none focus-visible:outline-2` resolves to `outline-style: none`
  and paints nothing. Measured `outlineStyle: "none"` on every focused nav link,
  confirmed against the compiled CSS, screenshotted before and after. Fixed by
  adding `focus-visible:outline-solid` at **11 occurrences across 10 files**.
  `components/onboarding/radio-card.tsx` was deliberately left alone: its
  `peer-focus-visible:outline-2` sits on a `<span>` with no `outline-none`, so
  `--tw-outline-style` is already `solid` there and it always worked.
- **Verified** against the production standalone build on `localhost:3000`,
  with the network conditions re-measured either side (getUser 150→146 ms,
  PostgREST 76-85→82-91 ms) so the wins are the code and not the weather:
  - **Full document render, before → after (ms):** `/teacher` 783→676 ·
    `/teacher/classes` 757→425 · `/teacher/calendar` 630→468 ·
    `/teacher/lesson-logs` 675→490 · `/teacher/reports` →487 ·
    `/teacher/tuition` 724→472 · `/teacher/settings` 475→386.
  - **Click to content, before → after (ms):** Lớp học 356→227 · Lịch dạy
    419→221 · Nhật ký buổi học 471→365 · Báo cáo 460→273 · Học phí 344→277 ·
    Cài đặt 195→181 · Tổng quan 556→434.
  - **Click to feedback stayed 1-2 ms on all 17 controls.** Class-detail tabs
    with the M19 prefetch warm: **9 ms, 0 requests**; clicked cold before the
    prefetch lands, 390-500 ms.
  - **Responsive:** 16 teacher paths, 3 student paths and 5 anonymous paths ×
    6 widths (1280/1024/768/390/360/320) — **0 problems**, no page-level
    horizontal scroll, no clipping beyond the two by-design cases.
  - **Accessibility: 0 problems** on every page — one `h1`, one
    `aria-current="page"` per labelled landmark, no nameless controls, no
    unlabelled inputs.
  - **No-JS:** 16/16 teacher and 3/3 student pages render with h1, seven nav
    links, breadcrumbs and forms; **`pendingTints=0` everywhere**; the teacher
    lesson page still emits its **four** attendance submit buttons (M12 intact).
  - **Console: 0 errors, 0 warnings** across 16 teacher, 3 student and 5
    anonymous pages.
  - **Filters and history:** all eight skill/class controls, both tab groups,
    the roster filter and the seven sidebar sections; deep links, refresh,
    Back ×2 and Forward; `?student=` opens the panel and Close preserves
    `filter=stable` **and** the roster anchor; stale and malformed `?student=`
    still alert rather than 404.
  - **Security:** the student account is redirected to `/student` from **all 11**
    teacher routes; a foreign class id is `notFound()` on `/teacher/<id>`,
    `/edit` and `/sessions/new`; anonymous hits on `/teacher`, `/student` and
    `/onboarding` all redirect to `/auth/login`. `git diff --stat` is **empty**
    for `components/attendance/`, `app/teacher/[classId]/actions.ts`,
    `app/auth/actions.ts`, `app/onboarding/actions.ts`,
    `app/join/[code]/actions.ts`, `app/teacher/settings/actions.ts`,
    `supabase/`, `proxy.ts` and `lib/supabase/`. `useFormStatus` still at
    `components/attendance/status-buttons.tsx:46`.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **25 routes**.
  - Diff: **19 files changed, 174 insertions(+), 167 deletions(-)**, plus the
    new `components/ui/pending-tint.tsx` replacing the deleted
    `components/ui/pending-bar.tsx`.
- **Limitations:**
  - `getUser()` is still one full Auth round trip on every authenticated
    request and it still gates the answer. M24 moved it off the critical path's
    head; it did not remove it, and removing it would remove the revocation
    check.
  - The **cold** class-detail tab (clicked before M19's prefetch has landed) is
    still 390-500 ms. That is the same server render every other route pays for.
  - The attendance and score **write** paths were again not exercised — the only
    seeded class is real production data. M12/M13 coverage plus the no-JS render
    of the four buttons is what stands behind them.
  - `tuition_records` and `monthly_reports` are still empty in production, so
    those pages were seen only in their empty state.
  - Millisecond figures are in-page and Node instrumentation on this machine
    against a hosted Supabase project. Reproducible in kind, not a benchmark.

### M25 — `31451df` teacher Calendar rebuilt as the Figma time grid
- **Audited first.** The Figma Make source was re-enumerated from
  `get_design_context` on node `0:1` and `src/pages/teacher/Calendar.tsx` read
  verbatim rather than inferred. Its geometry is now copied exactly:
  `HOUR_START = 6`, `HOUR_END = 22`, `SLOT_HEIGHT = 64`,
  `grid-cols-[56px_repeat(7,1fr)]`, solid hour rules and dashed half-hour rules
  on `#F0EFE9`, separators on `#E8E6DE`, today's column washed `#EDF0FF`, the
  day number in a 28px disc that fills `#4466EE` with white 14px/600 text, and
  a 1px `#4466EE` current-time line with an 8px dot on its left end.
- **The M22/M23 "no pixel canvas" argument was reversed, and the reversal is
  the milestone** (decision **W**). The old page drew seven day cards because
  absolute positions cannot reflow at 320px. True — but the grid does not have
  to reflow, it has to *scroll*, and this repository already ships that
  treatment in `components/ui/table.tsx`. The page overflows at no width; the
  grid does, inside its own labelled region.
- **Implemented** — 2 files changed, 1 new, 0 new dependencies, 0 new client
  components:
  - `components/calendar/week-grid.tsx` (new, **Server** Component): the day
    heading row, the 56px time gutter, one rules overlay drawn once across all
    seven columns rather than seven times down each, the today tint, the
    current-time indicator, and each lesson as an absolutely positioned block
    **inside its own day cell** — `inset-x-0.5` plus `top`/`height`, so no
    `calc((100% - 56px)/7)` percentage arithmetic can round a block into the
    wrong column. Block content is the Figma's: class name (11px semibold,
    truncated), `HH:mm–HH:mm` (10px), and — only above the Figma's own 56px
    threshold — `"{n} học viên · IELTS 6.5"`, or `"Đã hủy"` when cancelled.
  - `lib/calendar.ts`: `HOUR_START`/`HOUR_END`/`SLOT_HEIGHT`, `WEEKDAY_SHORT`
    (`T2`…`T7`/`CN` — Vietnamese numbers its weekdays, and two characters is
    what keeps a column narrow), `minutesOfDay`, `nowIn`, `gridRange`,
    `dayNumber`, and `startMinutes`/`endMinutes` on `CalendarSession`.
  - `app/teacher/calendar/page.tsx`: the Figma header — month under the title,
    class legend, `Hôm nay`, and the joined ← / → pair sharing one rounded
    outline — plus the grid. Its JSDoc, which used to argue *against* the pixel
    canvas, was rewritten to record why that argument was wrong.
- **Data and architecture, unchanged.** `TeacherContext.classes` still supplies
  the class list (M24's read is not undone and no second `classes` query was
  added); the week and the roster tally are issued in **one `Promise.all`**, so
  the student count costs no extra wall-clock; `auth.getUser()` is untouched.
  **Zero** migrations, RLS, RPC, schema, grant or auth changes. `git diff` is
  empty for `components/attendance/`, every `actions.ts`, `supabase/`,
  `proxy.ts` and `lib/supabase/`; `useFormStatus` is still at
  `components/attendance/status-buttons.tsx:46`.
- **Class colours reuse `CLASS_TONES`** (`primary`/`green`/`orange`/`navy`,
  indexed by the class's position in the teacher's own list) — deterministic
  across weeks, refreshes and return visits, and already the convention. The
  fourth tone stays `navy` rather than the Figma's `#8B5CF6`: there is no
  purple token and adding one is a palette change outside M25's scope.
- **Verified** against the production standalone build on `localhost:3000`:
  - **Geometry measured live, not eyeballed:** body 1024px = 16 × 64, gutter
    56px, row pitch 64px, 16 solid + 16 dashed rules, card `rounded-2xl` on
    `#E8E6DE`, rules `#F0EFE9`, today header `#EDF0FF`, disc 28×28 `#4466EE`
    white 14px/600, column tint `#EDF0FF`/30%, now-dot 8×8 and now-line 1px
    `#4466EE`.
  - **Block placement, on the one real session** (`IELTS Evening Group B`,
    2026-08-29, 12:01–16:07, Asia/Ho_Chi_Minh): column T7 at `left 982`,
    `top 601`, `height 258` — the arithmetic predicts 601 and 258 exactly.
    Background `#EDF0FF`, 3px `#4466EE` left border, 8px radius, tab-reachable,
    click navigates to the session with feedback at 2 ms.
  - **Timezone**, exercised against the real `lib/time.ts` from Node: seven
    instants including 17:00Z (→ 00:00 the *next* local day, minute 0), 16:59Z
    (→ 23:59, minute 1439), 2026-12-31T17:30Z (→ **2027**-01-01 00:30) and a
    `America/Los_Angeles` case that lands on the previous day. Four of the
    seven differ from `toISOString().slice(0, 10)`, which is the bug this
    avoids.
  - **Week navigation and labels:** current / prev / next / Hôm nay; month
    boundary "Tháng 08–09/2026"; year boundary "Tháng 12/2026 – 01/2027";
    `?week=not-a-date` and `?week=2026-13-99` both fall back to the current
    week. Deep link, refresh, Back ×2 and Forward all restore the right week in
    a clean tab. (A tab reused for hundreds of probe navigations saturates
    Chrome's 50-entry history and produces misleading jumps — instrument
    artefact, not a defect.)
  - **Responsive:** 10 teacher paths (including three calendar weeks), 2
    student paths × 6 widths (1280/1024/768/390/360/320) — **0 page-level
    horizontal scroll**. The grid's own region measures `scrollWidth ===
    clientWidth` at 768/1024/1280 and 672 vs 324/294/254 at 390/360/320.
  - **Accessibility: 0 problems** on 9 teacher pages — one `h1`, zero nameless
    controls, zero unlabelled inputs, zero duplicate ids, zero exposed avatars,
    and one `aria-current` per labelled landmark. The today column is
    `aria-current="date"` inside the grid region, a different token from the
    `page` markers, so it cannot collide with them. Tabbing the calendar gives
    `outline-style: solid`, 2px, on **every** control (decision **V** honoured
    on the new ones; the joined arrows and the grid region use `-2px` offset so
    `overflow-hidden` cannot clip the ring).
  - **No-JS:** 8 pages render with h1, seven nav links, breadcrumbs, week
    links and the lesson block as a real `<a href>`; `animate-pulse` count is
    **0** everywhere. The teacher lesson page still emits its **four**
    attendance submit buttons (M12 intact).
  - **Console: 0 errors, 0 warnings** across 10 pages.
  - **Security:** the student account is redirected to `/student` from **all 10**
    teacher routes probed including both calendar URLs; anonymous hits on
    `/teacher/calendar`, `/teacher` and `/student` all redirect to
    `/auth/login`.
  - **M24 click feedback intact:** Tuần sau 3 ms → 217 ms, Tuần trước 2 ms →
    260 ms, Hôm nay 2 ms, lesson block 2 ms → 695 ms.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **25 routes**, no
    debug or preview route.
- **Intentional deviations from the Figma, each argued in JSDoc:**
  - **No internal vertical scroller.** The Figma's grid is `flex-1` inside an
    `h-full overflow-hidden` shell, so its own scrollbar is a consequence of
    that shell. Reproducing it would nest a scroller inside a scrolling
    document *and* — since the first visible hour is 06:00 and this product's
    classes meet in the evening — start every real lesson hidden, with no way
    to auto-scroll from a server component. The whole day is drawn and the page
    scrolls as every other page does.
  - **Horizontal scroll below 768px** instead of the Figma's fixed canvas.
  - **`navy` instead of `#8B5CF6`** as the fourth class colour.
  - **`#4A5170` instead of `#8A8FA8`** for the hour, weekday and legend text —
    the repository's documented AA substitution; 10px `#8A8FA8` fails contrast.
  - **24-hour `HH:mm`** instead of "7:30 PM", per §7.
  - **An empty week still renders the grid**, with "Tuần này chưa có buổi học
    nào" as a second `meta` line in the header rather than an `EmptyState`
    replacing the calendar. A calendar that vanishes when nothing is booked is
    not a calendar. The no-classes-at-all `EmptyState` is unchanged.
  - The Figma builds its week by regex-parsing each class's free-text
    `schedule` string into synthetic 90-minute slots. This product reads real
    `class_sessions` rows — decision **B**, and it predates M25.
- **Limitations:**
  - Production has exactly **one** session in range, so multi-class colouring,
    overlapping blocks, the sub-56px block (no third line) and `gridRange`'s
    widening past 06:00–22:00 are **code-reviewed and type-checked, not
    screenshotted**. Creating a second session is a production write.
  - A session close to midnight UTC could not be *rendered* for the same
    reason; the conversion beneath it was exercised directly against
    `lib/time.ts` from Node, which is where the risk actually lives.
  - The grid region is a tab stop at every width, including those where it does
    not scroll. That is the `components/ui/table.tsx` precedent, kept for
    consistency.
  - The attendance and score **write** paths were again not exercised. Every
    action file is untouched by M25; M12/M13 coverage plus the no-JS render of
    the four buttons is what stands behind them.
  - `tuition_records` and `monthly_reports` are still empty in production.

### M26 — `ab02598` student UI rebuilt from the Figma source
- **Audited first, the whole student experience and not one node.** The Make
  source was re-enumerated from `get_design_context` on node `0:1`. The finding
  that shaped everything: **the Figma has exactly one student screen**,
  `src/pages/student/Dashboard.tsx`, and `src/App.tsx` renders
  `{view === "student-dashboard" && <StudentDashboard />}` **outside**
  `<Layout>`. The student's chrome in the design is a **top bar**, not the
  teacher sidebar. M22 shipped the sidebar for both roles and recorded it as a
  known deviation; M26 corrects it.
- **Screen inventory and mapping** — the design's one screen is *class-scoped*
  (greeting, band hero, tabs, all of it about `mockClasses[0]`), so it maps onto
  `/student/[classId]`. `/student` and the student lesson page have **no Figma
  design at all**; neither was deleted and neither was invented — both are built
  from the design's own vocabulary, exactly as decision **T** already answered
  for `/teacher/classes`.
- **Implemented** — 6 files changed, 4 new, 0 new dependencies, **0 new client
  components**, 0 shared primitives touched:
  - `components/shell/student-shell.tsx` (new, Server): the Figma's top bar —
    `LogoMark size="sm"` linking home, name and email right-aligned, the 32px
    initials `Avatar`, and the `signOut` form as a ghost button — over the same
    centred column. `AppShell` now branches on `role` at its head and its `NAV`
    table is typed `Record<"teacher", …>`: there is no student row left to
    accidentally render.
  - `/student/[classId]` **is** the Figma's student Dashboard: breadcrumb,
    `Chào <tên> 👋`, the class·course and teacher meta line, the navy
    `BandProgress` hero, then `Tabs variant="primary"` — a primitive M22 built
    for this screen and never used — over four panels.
  - `components/student/score-trend.tsx` (new): the Figma's recharts
    "Score Over Time" as a hand-authored inline SVG polyline over real
    `score_entries`, with a `?skill=` chip row. Decision **Q** kept, the page
    kept on the server, and it renders with JavaScript off.
  - `components/student/homework-list.tsx` (new) + `loadStudentHomework` in
    `lib/student.ts`: the Homework tab over real `homework_assignments`
    embedding this member's `homework_submissions`. **Read-only** — submitting
    is `public.submit_homework()`'s job.
  - `components/student/feedback-panels.tsx` (new): `RecentFeedback` (the
    Progress tab's two most recent) and `LearningHistory` (the History tab's
    full list), both over real `lesson_logs`.
  - `/student`, the student lesson page and the segment's `not-found.tsx` moved
    to the `4xl` centred column and the `list` card; the lesson page's three
    uppercase `text-xs` eyebrows became real `h2`s via `SectionHeading`.
- **Four tabs, not three** (decision **Y**). Tiến bộ / Bài tập / Lịch sử are the
  Figma's, in its order; **Buổi học** is appended because M12's attendance view
  and the lesson list have no equivalent in the mock and deleting a working
  feature to match a screenshot is not fidelity. They are `<Link>`s over
  `?tab=`, and **deliberately not prefetched**: every tab's loader is gated on
  the tab being rendered, so prefetching would issue all four queries on every
  visit. `PendingTint` acknowledges the click instead — measured **1-2 ms**.
- **Data and security, unchanged.** The membership is read first and alone;
  everything after it is one `Promise.all` whose members are chosen by the tab.
  Every loader takes `membershipId` from that answer, never from the URL. **Zero
  migrations, RLS, RPC, grant, schema or auth changes.** `git diff` is empty for
  `components/attendance/`, every `actions.ts`, `supabase/`, `proxy.ts`,
  `lib/supabase/`, all of `app/teacher/`, `components/calendar/`,
  `components/ui/`, `components/icons/` and `components/shell/nav.tsx`;
  `useFormStatus` is still at `components/attendance/status-buttons.tsx:46`.
- **Verified** against the production standalone build on `localhost:3000`:
  - **Responsive:** 8 student paths × 6 widths (1280/1024/768/390/360/320) =
    **48 combinations, zero page-level horizontal scroll and zero clipping.**
    The chart's own region measures `scrollWidth === clientWidth` at 1280/1024
    and scrolls inside its card at 768 (297 client / 360 content) and below.
  - **Accessibility: 0 problems** on all 8 student screens — exactly one `h1`,
    zero duplicate ids, zero nameless controls, zero unlabelled inputs, zero
    exposed avatars, and one `aria-current` per labelled landmark
    (`Đường dẫn:page`, `Các mục của lớp học:page`, `Kỹ năng:page`). Every
    breadcrumb terminates on the current page (decision **M**). Focus rings
    measured `solid 2px` on the tabs, the skill chips, the brand link and the
    sign-out button (decision **V**).
  - **Console: 0 errors, 0 warnings** across all 8 screens and 6 widths.
  - **No-JS** (`Emulation.setScriptExecutionDisabled`): 7 pages render with
    `h1`, four tab links, five skill links, the breadcrumb links and the
    sign-out form; **`animate-pulse` count is 0 everywhere**.
  - **History and params:** deep links to all four tabs and to `?skill=`;
    refresh; Back ×2 and Forward restore the right tab *and* the right skill in
    a clean tab. `?tab=bogus` and `?skill=bogus` both fall back to Tiến bộ /
    Tổng thể rather than erroring.
  - **Security:** the student account is redirected to `/student` from **all 12**
    teacher routes; a foreign class id, a foreign session id and a non-uuid all
    give the styled Vietnamese 404, never a different answer from each other;
    the teacher account is redirected to `/teacher` from all three student
    routes; anonymous hits on `/student`, `/student/<id>`, `/teacher` and
    `/onboarding` all 307 to `/auth/login`.
  - **Teacher regression:** all 14 teacher paths render with their `h1` and the
    seven nav links, and the teacher lesson page still emits its **four**
    attendance submit buttons (M12 intact).
  - **English-string sweep** of the rendered text on all 8 student screens: the
    only English is user data — the class name, the teacher's name, the lesson
    title, the teacher's note, `schedule_note` — plus `EduTrack` and `IELTS`,
    which §3 keeps as-is.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **25 routes**, no
    debug or preview route.
  - Diff: **6 files changed, 649 insertions(+), 461 deletions(-)** plus 4 new
    files totalling 745 lines.
- **Intentional deviations from the Figma, each argued in JSDoc:**
  - **No charting library.** The Figma's recharts `LineChart` is a hand-authored
    inline SVG. Decision **Q**, and it keeps the page a Server Component.
  - **A fourth tab**, as above.
  - **Four homework states, not two.** The mock colours everything from one
    `submitted` boolean; `public.homework_status` is
    `assigned | submitted | graded | missed` and only `graded` carries a score.
  - **No `lucide-react` icons.** The design's `TrendingUp`/`Award`/`BookOpen`
    have no counterpart in this repository's hand-drawn `Mark` set and the
    student screens need none; `lucide-react` is still imported nowhere.
  - **The chart scrolls inside its card below 360px** rather than scaling its
    10px axis labels to ~5px — the `components/ui/table.tsx` / M25 treatment.
  - `#4A5170` rather than the design's lighter grey for small type, the
    repository's documented AA substitution.
- **Limitations:**
  - This student has **zero `score_entries`** and **zero homework rows** in
    production, so the chart's populated state, the four homework tones and the
    graded score line were verified on a **temporary `app/m26-preview` route**
    with synthetic props rather than production writes. The route was deleted,
    its absence confirmed, and the tree rebuilt before the route count was read
    (decision **J**).
  - The band hero therefore also renders only its empty state — `—` with no
    rail, which is `band-progress.tsx`'s deliberate M22 behaviour: drawing an
    empty rail would assert 0% progress, which is false. That file is untouched.
  - "A student cannot see a classmate's data" still cannot be exercised
    **empirically** — the one class has one member and creating a second is a
    production write. It rests on the student SELECT policies and on every
    loader taking `membershipId` from the session.
  - The attendance and score **write** paths were again not exercised. Every
    action file is untouched by M26; M12/M13 coverage plus the no-JS render of
    the four buttons is what stands behind them.

### M27 — monthly progress reports and export (**uncommitted**, in the working tree)
- **Audited first, as §1 of the brief required, before any edit.** The Figma
  Make source's `src/pages/teacher/Reports.tsx` is a **single-student,
  parent-facing report card**: a student `<select>`, "Download PDF" / "Share
  with Parent", a navy identity header, an "IELTS Progress" rail with four skill
  deltas, a recharts `RadarChart` of the four skills, three "Learning Habits"
  rails, a recharts `LineChart` of scores, a green "Improvements This Month", an
  orange "Areas to Improve", a "Teacher's Comment", and a "Next Month Focus"
  triple that merely repeats Areas to Improve.
- **The brief's premise about missing data was wrong again, and the schema won**
  (decision **B**). Every table the report needs already exists with the teacher
  policy `class_id = any(app.my_class_ids())`, and
  `v_member_session_attendance`'s own migration comment names monthly reports as
  an intended consumer. **Zero migrations, zero RLS/RPC/grant/schema changes.**
  `monthly_reports` is **read** (for `teacher_comment` and the published list),
  never written — no fake rows were created to make the UI work.
- **Five Figma items are not populatable and were not faked** (decision **P**):
  the two invented "improvement" bullets, the templated teacher comment, the
  hardcoded `"8.1/10"` homework average, the duplicated "Next Month Focus"
  triple, and "Share with Parent" — which has no share flow behind it here
  (`create_report_share_link` exists but M27 does not expose it), so nothing is
  rendered for it rather than a button that does nothing.
- **Implemented — 2 files changed, 12 new, 2 dependencies, 1 new route, 0 new
  client components:**
  - **One route, two views.** `/teacher/reports` takes `?class=&month=&student=`.
    Without `student` it is the class index — month header, class `FilterPills`
    (only when the teacher has more than one class), a roster list of
    `StudentRow`s carrying current band / target band / attendance / lessons in
    the month, the class-wide "Tải Excel cả lớp" button, and the M22 published
    `monthly_reports` list. With `student` it is the report preview. **No new
    page route was added** — the only new route is the export Route Handler.
  - **`lib/monthly-report.ts`** — the single canonical loader
    `loadMonthlyStudentReport(...)` (§10) plus `loadMonthlyClassSummary(...)`.
    The Web preview, PDF, DOCX and XLSX all read the same `MonthlyStudentReport`
    value, so the four cannot disagree. Membership is resolved first and alone;
    everything after it is one `Promise.all`. Every query is scoped in the
    database (`eq`/`in` on ids the session owns), never fetched wide and
    filtered in application code.
  - **`lib/report-period.ts`** — `MonthKey`, `parseMonth`, `currentMonth`,
    `monthLabel`, `monthRange`, `shiftMonth`. Month boundaries are computed on
    the **class's** timezone through `lib/time.ts` (§7); there is no
    `toISOString().slice(0, 10)` anywhere in M27, which is exactly the bug that
    would move an evening lesson on the 1st or the 31st into the wrong month.
  - **`lib/report-text.ts`** — the shared presentation vocabulary (`bandText`,
    `dayText`, `courseLabel`, `statusLabel`, `homeworkScoreText`, …) so the four
    outputs word the same fact the same way.
  - **`components/report/`** — `report-preview.tsx` (the composition, nine
    sections in the document's order), `report-hero.tsx` (the navy identity
    card and the IELTS Progress rail), `skill-radar.tsx` (the `RadarChart` as
    inline SVG), `score-lines.tsx` (the `LineChart` as inline SVG). **All four
    are Server Components** — the six client components are untouched.
  - **`lib/export/`** — `blocks.ts` (the `Block` document model),
    `report-document.ts` (one `MonthlyStudentReport` → one `Block[]`), `pdf.ts`,
    `docx.ts`, `xlsx.ts`, `zip.ts`. PDF and DOCX render the **same** `Block[]`,
    so a section cannot be present in one and missing from the other.
  - **`app/teacher/reports/export/route.ts`** — a Route Handler, deliberately
    not a Server Action, so every export control is a plain `<a href>` that
    works with JavaScript disabled. `?format=pdf|docx|xlsx`, with `student`
    omitted meaning the class workbook. A non-teacher, a foreign class, a stale
    membership, a missing `student` for a per-student format and an unknown
    format are all **404**, identical to each other.
  - **`next.config.ts`** — `outputFileTracingIncludes` for
    `/teacher/reports/export`, because the PDF route's font path is assembled at
    runtime and is therefore invisible to Next's tracer. Without it the route
    builds and works in `dev` and then throws ENOENT in `standalone`.
- **Two dependencies, both argued before installing** (§7, decision **E**):
  **`pdf-lib`** and **`@pdf-lib/fontkit`**, plus two bundled Public Sans TTFs
  under `assets/fonts/`. The reason is Vietnamese: the PDF standard-14 fonts are
  WinAnsi and physically cannot draw `ố`, `ệ` or `ữ`, so a dependency-free PDF
  would have produced a report with the student's own language missing.
  fontkit subsets the face into a `Type0` / `Identity-H` / `CIDFontType2` font
  with a `ToUnicode` CMap, which is also what makes the output selectable and
  searchable rather than a picture of text. **DOCX and XLSX needed no
  dependency at all** — Node 24 ships `zlib.crc32` and `deflateRawSync`, so
  `lib/export/zip.ts` writes the OOXML containers directly. **No charting
  library, no AI SDK, no icon library** was added, and `lucide-react` is still
  imported nowhere.
- **Deliberate deviations from the Figma, each argued in JSDoc:**
  - **No recharts.** Both graphs are hand-authored inline SVG — decisions **Q**
    and **Z** — which keeps the preview a Server Component and, more to the
    point, makes the charts appear in the PDF and with JavaScript off. A report
    is a document; a blank rectangle where the skills should be is not a
    degraded experience, it is a wrong document.
  - **The radar draws no polygon unless all four skills are measured**, and
    nothing at all when none are: `public.band` starts at 0.0, which is a real
    and very bad mark, so a missing skill cannot be plotted as zero and half a
    shape would read as a profile.
  - **The student `<select>` is a roster list of links**, not a dropdown — the
    URL is the state (§1) and it must work without JavaScript.
  - **Four homework states**, not the mock's one `submitted` boolean.
  - `#4A5170` for small grey type, the repository's documented AA substitution.
- **Verified against the production standalone build on `localhost:3000`:**
  - **Exports are real files, inspected programmatically, not trusted on a 200.**
    PDF: `%PDF-1.7`, ends `%%EOF`, 2 pages, 8/8 streams inflated, two `ToUnicode`
    CMaps (71 and 54 entries), **1687 characters decoded back out of the content
    streams**, and all ten probed Vietnamese strings present. DOCX: five parts,
    every section heading, `w:tblHeader` on the table headers, 4 tables / 61
    paragraphs, `w:outlineLvl` twice in `styles.xml` so Word's navigation pane
    works, `pStyle` Title/Subtitle/Heading1. Student XLSX: four sheets
    **Tổng quan | Buổi học | Điểm số | Bài tập**, `inlineStr`, `autoFilter`,
    frozen header row. Class XLSX: **Học viên | Thông tin**, filterable and
    sortable. All four re-downloaded from the final build and confirmed
    **byte-identical** to the inspected copies.
  - **Responsive:** 5 paths × 6 widths (1280/1024/768/390/360/320) — **zero
    page-level horizontal scroll, zero clipping.** The `Band theo kỹ năng` table
    measures 409/409 at 1280 and scrolls **inside its own labelled region**
    (255/204) at 320. The calendar's region is unchanged (968/968 → 672/254).
  - **Accessibility: 0 problems.** Exactly one `h1` on every view, zero
    duplicate ids, zero nameless controls, zero unlabelled inputs, and one
    `aria-current` per labelled landmark. Focus rings measured **`solid 2px` on
    all 15 controls** across both views — the month arrows, "Tháng này", the
    roster rows, the class-wide Excel button and all three export anchors
    (decision **V**).
  - **No-JS** (`Emulation.setScriptExecutionDisabled`): both views render with
    their `h1`, seven nav links, breadcrumbs, the month links and **all three
    export anchors as real `href`s**; `animate-pulse` count is **0**.
  - **Malformed input:** `class=not-a-uuid`, a foreign class uuid,
    `month=2026-13`, `month=hello` and `student=nope` all fall back silently to
    the teacher's own class and the class's current month; a **stale or foreign
    `student=` renders the Vietnamese alert, not a 404** (the M19 precedent).
  - **Security:** the student account is redirected to `/student` from
    `/teacher/reports` and gets **404** from `/teacher/reports/export` for both
    the per-student and the class format; anonymous requests **redirect to
    `/auth/login`** on the page and on the export route; a foreign class, a
    non-uuid class, a stale membership, a missing `student` and
    `format=exe` are each **404** and indistinguishable from one another.
  - **Regression:** 16 teacher paths render with one `h1` and seven nav links;
    the teacher lesson page still emits its **four** attendance submit buttons
    (M12 intact); `useFormStatus` is still at
    `components/attendance/status-buttons.tsx:46`; `git diff` is **empty** for
    `components/attendance/`, every `actions.ts`, `supabase/`, `proxy.ts` and
    `lib/supabase/`; `/student` still redirects a teacher to `/teacher`.
  - **Console: 0 errors, 0 warnings** across 16 teacher paths and 6 widths.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **26 routes**
    (24 `page.tsx` + 2 `route.ts`), no debug or preview route.
- **Limitations:**
  - **The one production student has zero `score_entries`, zero bands and zero
    homework rows**, so the report was verified in its honest empty states: the
    radar prints its "chưa ghi nhận band" sentence, `ScoreLines` returns `null`
    (a single point is not a trend, and two are needed for a line), and the
    homework section says so. The **populated** branches — the radar polygon,
    the five score series, the four homework tones, the band-movement box — are
    type-checked and code-reviewed, **not screenshotted**. Creating that data is
    a production write, which §18 forbids. **No preview route was created this
    time** and none exists in the tree.
  - **`Chuyên cần` is "—" for August 2026** even though the class has one
    session that month with attendance "Có mặt" recorded. That is
    `v_member_session_attendance`'s own definition, not a bug in M27, and §6's
    rule stands: do not re-derive standing in page code. It is reported rather
    than worked around.
  - `monthly_reports` is still empty in production, so the published-report list
    and the `teacher_comment` block were seen only in their empty states.
  - The attendance and score **write** paths were again not exercised. Every
    action file is untouched by M27; M12/M13 coverage plus the no-JS render of
    the four buttons is what stands behind them.
  - Class-wide **PDF/DOCX** was not built: the Figma's class-level artefact is a
    table, so the class export is the XLSX the brief asked to be filterable and
    sortable. Per-student PDF/DOCX covers the parent-facing case.
  - **NO COMMIT WAS CREATED.** M27 lives entirely in the working tree.

### M28 — lesson-note result labels reworded (**uncommitted**, in the working tree)
- **Scope: four strings.** The teacher's "Kết quả" field on a lesson note now
  reads **Học nhanh / Có cố gắng / Cần cải thiện / Cảnh báo** instead of
  Xuất sắc / Tốt / Đang tiến bộ / Cần chú ý.
- **Nothing below the label moved.** `public.performance` still carries
  `excellent | good | developing | needs_attention`; the `<option value>`s the
  form submits are unchanged, `isPerformance` still validates against the same
  four, and every historical `lesson_logs` row keeps its stored value and simply
  renders with the new word. **No migration, no RLS/RPC/grant/schema change, no
  new dependency, no AI.**
- **One file changed: `lib/lesson-log.ts`.** `PERFORMANCE_LABELS` is the single
  display map, so that one edit reaches all six surfaces that show the value —
  the note form on `/teacher/[classId]/sessions/[sessionId]`, that page's note
  list, the class-detail note list, `/teacher/lesson-logs`, the student lesson
  page and `components/student/feedback-panels.tsx` (both the Progress and
  History tabs), plus `components/report/report-preview.tsx`. This is the §3
  architecture working as intended: the label map lives beside its enum, and
  nothing hardcodes the words in JSX.
- **The order is still strongest first**, so the three `Performance` → tone
  tables (green / primary / orange / destructive, keyed by the enum and unmoved)
  still pair the right colour with the right word — and now pair better:
  `needs_attention` reads "Cảnh báo" against the destructive tint it already had.
- **A collision was removed, not created.** "Đang tiến bộ" was the label for
  *both* `performance.developing` (a lesson note) and `member_status.improving`
  (a student's standing, `MEMBER_STATUS_LABELS` in `lib/score.ts`), and likewise
  "Cần chú ý" for `performance.needs_attention` and
  `member_status.needs_attention`. Those are different enums on different
  screens. `lib/score.ts` is **untouched** — the roster filter is still
  Đang tiến bộ / Ổn định / Cần chú ý, `filter=stable` still labels "Ổn định"
  (M19), and the `/teacher` dashboard's two counts still read Đang tiến bộ /
  Cần chú ý because those are member statuses.
- **Exports were not touched and did not need to be.** `lib/export/` never
  printed the per-note performance; its "Kết quả" row is `statusLabel(report)`,
  the member standing. The monthly report data logic, attendance, scores, bands,
  homework and teacher comments are all unchanged (`git diff` names one file).
- **Verified against the production standalone build on `localhost:3000`:**
  - The form's `<select>` renders
    `excellent=Học nhanh · good=Có cố gắng · developing=Cần cải thiện ·
    needs_attention=Cảnh báo` — new words, **original values**.
  - The one **real historical note** (stored `needs_attention`) renders
    "Cảnh báo" on `/teacher/lesson-logs`, in the class-detail note list, in the
    report preview, on the student's Tiến bộ and Lịch sử tabs and on the student
    lesson page. Requirement 3 shown on production data, with **no write**.
  - "Xuất sắc", "Đang tiến bộ" and "Cần chú ý" appear on **none** of those
    pages; "Ổn định" still does, so the two enums are visibly distinct.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **26 routes**.
- **Note for a future session:** `app/teacher/page.tsx` shortens the focus-areas
  line to `Cần cải thiện: …` (§3 spells the field "Nội dung cần cải thiện"), so
  that phrase now also names a performance level on a different screen. It was
  left alone deliberately — changing it is outside M28 and the two never appear
  together.
- **NO COMMIT WAS CREATED.**

### M29 — teacher class list rebuilt as a six-column table (**uncommitted**, in the working tree)
- **Inspected before editing, as the brief required, and one field was missing.**
  Five of the six columns were already carried by `TeacherClassFields` /
  `TeacherClass`; **"Loại lớp = Online / Offline" had nothing behind it.**
  `public.classes` has no delivery-mode column, `public.course_type` is the
  *subject* (`ielts | general_english | academic_english | other`),
  `components/class/class-form.tsx` never asks, and a grep across all fifteen
  migrations plus `app/`, `lib/` and `components/` for online / offline / mode /
  venue / location / platform returned exactly one hit —
  `class_sessions.location text`, nullable undocumented free text on an
  *individual session*. Reported and **asked** rather than inferred; the teacher
  answered that the value has one possibility: every class here is online. It is
  therefore a `DELIVERY_MODE` constant in the page with a JSDoc saying so —
  decision **AF**.
- **Implemented — 1 file changed, 0 new files, 0 new dependencies, 0 new client
  components, 0 shared primitives touched, and no `lib/` change at all.**
  `app/teacher/classes/page.tsx` went from a card list to
  `components/ui/table.tsx`: **Tên lớp · Loại lớp · Khai giảng - Kết thúc ·
  Tiến độ học · Sĩ số · Lịch học**.
  - **Tên lớp** is the row's navigation target — a `<Link>` named after the
    class (not a clickable row, which a keyboard and a screen reader cannot
    find), hosting `PendingTint`, over a small second line carrying the course
    label and `Band mục tiêu 6.5` when set. `IELTS · IELTS 6.5` was caught in
    verification and reworded; the two are different facts and were reading as
    a stutter.
  - **Tiến độ học** is `progressOf(today, start, end)` — three states,
    **Sắp tới / Đang diễn ra / Kết thúc**, both edges inclusive, derived from
    the two date columns and **no new database column**. `today` is
    `zonedCalendarDate(entry.timezone, now)`, so the comparison happens on the
    **class's** clock; all three values are `YYYY-MM-DD` and compare as strings,
    with no `Date` constructed and no `toISOString().slice(0, 10)` anywhere. An
    open-ended class (`end_date is null`, which
    `classes_end_after_start` allows) is never "Kết thúc".
  - **Sĩ số** is `studentCount` from the existing `tallyClassMembers`, with
    `N đang chờ` underneath only when there are unclaimed invitations — the same
    class's own roster, which the card already showed.
  - **Lịch học** prints `schedule_note` as typed, or **Chưa đặt**. Nothing is
    parsed out of it and no schedule is invented.
- **No second `classes` query, and no shared loader changed.** Every value comes
  from M24's `TeacherContext.classes` plus the one roster tally the page already
  ran. `lib/teacher.ts` is **untouched**.
- **Sorting is `start_date` DESC, done in the page, and that is deliberate**
  (decision **AG**). `loadTeacherClassList` *is* M24's single `classes` read and
  its rows are shared with `/teacher`, `/teacher/calendar` (which indexes
  `CLASS_TONES` **positionally**, so a reorder recolours the calendar),
  `/teacher/lesson-logs`, `/teacher/reports` and `/teacher/tuition`, whose class
  filter pills are drawn in list order. Moving its `ORDER BY` would have
  reordered and recoloured five pages the brief said not to modify; sorting in
  the database without that would have needed a second `classes` query, which it
  also said not to add. The tie-break is free: `Array.prototype.sort` is stable
  and the rows arrive in `created_at` DESC, so same-day starts keep
  newest-created first.
- **A real defect was found during verification and fixed.** At **exactly
  1024px the page itself scrolled 135px**. `PageShell` renders `flex-1` on its
  `<main>`, and from `lg` up `AppShell` lays the sidebar and that main out as a
  flex **row** — where `min-width` defaults to `auto`, so the main never shrank
  below the table's `min-width` and the scroller never got the chance to scroll.
  Fixed with `className="min-w-0"` on this page's `PageShell` rather than in the
  primitive: no other page has content with an intrinsic minimum, so this is the
  only one that needs it. (This is §2's documented flexbox note, in a second
  form: `flex-1` is `flex: 1 1 0%`, but `min-width: auto` still holds the floor.)
- **Verified against the production standalone build on `localhost:3000`:**
  - **The derivation functions were exercised directly**, their source
    **extracted verbatim from the shipped `page.tsx`** and imported through
    Node's type stripping — not a retyped copy. All **9** boundary cases pass:
    day before start, first day, middle, last day, day after end, open-ended
    started, open-ended not started, single-day class, year boundary. The
    class timezone is shown to *decide*: `2026-08-31T18:00Z` is `2026-09-01` in
    `Asia/Ho_Chi_Minh` (→ **Đang diễn ra**) and `2026-08-31` in
    `America/Los_Angeles` and UTC (→ **Sắp tới**), so the naive UTC slice would
    have given the wrong answer. The stable sort was proven on four synthetic
    classes: `start_date` DESC with `created_at` DESC preserved across a tie.
  - **Production data, read not written:** `IELTS Evening Group B` renders
    `Online`, `01/09/2026 - 30/11/2026`, **Đang diễn ra** (today is its first
    day — the inclusive start edge, on the real row), `1`, and its real
    `schedule_note`. The class link is `/teacher/<uuid>` and navigating it lands
    on the class detail page with its own `h1`.
  - **Responsive:** 6 widths — 1280 `scrollX=0`, region 974/974 (fits); 1024,
    768, 390, 360, 320 all `scrollX=0` with the region scrolling **inside the
    card** (718, 702, 324, 294, 254 client over 847 content). **Zero page-level
    horizontal scroll, zero clipping** at every width.
  - **Accessibility: 0 problems.** One `h1`; **6 `<th scope="col">`**; the
    scroller is `role="region"` `aria-label="Danh sách lớp học"` and a tab stop;
    zero duplicate ids, zero nameless controls, zero unlabelled inputs; one
    `aria-current="page"` per labelled landmark (Điều hướng chính, Đường dẫn).
    The status badge carries its state **as text**, so it survives greyscale and
    a screen reader. Focus rings measured by **real Tab traversal**
    (`Input.dispatchKeyEvent`, because a programmatic `.focus()` does not set
    `:focus-visible` and reports `none` on controls that are in fact fine):
    **all 12 controls `solid 2px`**, including the new scroller region and the
    class-name link.
  - **No-JS** (`Emulation.setScriptExecutionDisabled`): the table renders with
    its row, the class link as a real `href`, the labelled region intact, and
    `pending-tint` / `animate-pulse` counts **0**.
  - **Click feedback:** `PendingTint` appears **7 ms** after the click, exactly
    the link's box (150×20) at the link's own 4px radius.
  - **Security and regression:** anonymous `/teacher/classes`, `/teacher` and
    `/student` all **307 → `/auth/login`**; the student account is redirected to
    `/student` from `/teacher/classes`, `/teacher` and `/teacher/calendar`; all
    **8** teacher pages still render one `h1` and seven nav links.
    `git diff --stat` is **empty** for `components/attendance/`, every
    `actions.ts`, `supabase/`, `proxy.ts` and `lib/supabase/`; `useFormStatus`
    is still at `components/attendance/status-buttons.tsx:46`.
  - **Console: 0 errors, 0 warnings** across 7 teacher pages and 6 widths.
  - `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ · **26 routes**,
    unchanged.
  - Diff: **1 file changed, 220 insertions(+), 77 deletions(-)**.
- **Limitations:**
  - Production has exactly **one** class, so the **sort order**, the
    **Sắp tới** and **Kết thúc** badges, the open-ended `Chưa đặt` end date and
    the `N đang chờ` line were exercised against the shipped functions from Node
    rather than screenshotted. Creating a second class is a production write.
    **No preview route was created and none exists in the tree.**
  - `Loại lớp` is a constant. It is correct for every class that exists today
    and is correct only for as long as the product stays online-only; see
    decision **AF** for what has to change first.
  - The brief referred to an uploaded reference screenshot, but **no image was
    attached to the message**. The layout follows the brief's own ASCII sketch
    and the existing design system.
- **NO COMMIT WAS CREATED.**

## 14. Current project state (verified 2026-09-01, after M29)

| | |
|---|---|
| Branch | `main` |
| HEAD | `631a415` — ":art: modify performance labels" (M28, committed by the user) |
| M27 / M28 | both committed by the user — M27 as `0269c0a`, M28 as `631a415`.
  Earlier revisions of this file described each as uncommitted; that is stale. |
| `origin/main` | everything through M28 is pushed. |
| Remote | `https://github.com/dzp-0904/en_app.git` |
| Working tree | **NOT clean — M29 is uncommitted, by instruction.** One modified
  source file (`app/teacher/classes/page.tsx`) plus this file. |
| Routes | **26** (24 `page.tsx` + 2 `route.ts`: `app/auth/callback/route.ts` and
  `app/teacher/reports/export/route.ts`) — M29 added none |
| Migrations | 15, unchanged since the database foundation commit |
| RLS | enabled + FORCEd on 13 tables |
| Client components | still **six** |
| Shared primitives | still **19** — M29 added none and changed none |
| Dependencies | unchanged since M27 (`pdf-lib`, `@pdf-lib/fontkit`). Still no
  i18n library, no charting library, no AI SDK; `lucide-react` is installed and
  imported nowhere. |
| Gates | `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ |

**Measured hop costs against this hosted Supabase project** (from Node, outside
the browser's CORS preflight): `auth.getUser()` **146-150 ms**, PostgREST
**76-91 ms**. Any future latency argument should start from those two numbers,
not from a single averaged "one round trip" figure.

### Route map

```
/                                              app/page.tsx
/auth/login                                    app/auth/login/page.tsx
/auth/signup                                   app/auth/signup/page.tsx
/auth/callback                                 app/auth/callback/route.ts
/join/[code]                                   app/join/[code]/page.tsx
/onboarding                                    app/onboarding/page.tsx
/onboarding/name                               .../name/page.tsx
/onboarding/teaching-type                      .../teaching-type/page.tsx
/onboarding/class                              .../class/page.tsx
/onboarding/invite                             .../invite/page.tsx
/teacher                                       app/teacher/page.tsx                  (dashboard)
/teacher/classes                               app/teacher/classes/page.tsx
/teacher/calendar                              app/teacher/calendar/page.tsx         (?week=YYYY-MM-DD)
/teacher/lesson-logs                           app/teacher/lesson-logs/page.tsx      (?class= &skill=)
/teacher/reports                               app/teacher/reports/page.tsx
/teacher/reports/export                        app/teacher/reports/export/route.ts   (?class= &month= &student= &format=pdf|docx|xlsx)
/teacher/tuition                               app/teacher/tuition/page.tsx
/teacher/settings                              app/teacher/settings/page.tsx
/teacher/new                                   app/teacher/new/page.tsx
/teacher/[classId]                             app/teacher/[classId]/page.tsx        (tabs: ?tab=lessons|info)
/teacher/[classId]/edit                        .../edit/page.tsx
/teacher/[classId]/sessions/new                .../sessions/new/page.tsx
/teacher/[classId]/sessions/[sessionId]        .../sessions/[sessionId]/page.tsx
/student                                       app/student/page.tsx                  (class chooser)
/student/[classId]                             app/student/[classId]/page.tsx        (the Figma student dashboard;
                                                                                      tabs: ?tab=homework|history|lessons, ?skill=)
/student/[classId]/sessions/[sessionId]        .../sessions/[sessionId]/page.tsx
```

Server Actions live in `app/auth/actions.ts`, `app/onboarding/actions.ts`,
`app/join/[code]/actions.ts`, `app/teacher/[classId]/actions.ts`,
`app/teacher/settings/actions.ts`.

---

## 15. Durable product decisions

- **A.** Figma is the UI source of truth.
- **B.** The actual database schema takes precedence over milestone wording.
- **C.** Security is server-side and RLS-backed.
- **D.** Do not add client-side authorization.
- **E.** Do not introduce unnecessary dependencies.
- **F.** Do not redesign completed UI while implementing unrelated features.
- **G.** Do not modify completed milestone behaviour without explicit scope.
- **H.** Do not create permanent test accounts unless explicitly authorized.
- **I.** Production testing must avoid modifying real user data unless explicitly
  necessary.
- **J.** Temporary production fixtures must be clearly named and fully cleaned
  up, and the cleanup verified.
- **K.** Do not start the next milestone automatically. Stop after the requested
  one.
- **L.** `PageShell` + `PageHeader` (+ `Breadcrumb`) are the frame for every
  application page. A new page uses them; it does not hand-roll
  `<main className="flex flex-1 justify-center …">` or a `← Quay lại` ghost
  button. Teacher screens are start-aligned, student screens centred — that is
  the Figma, not a preference.
- **M.** The **last** `Crumb` in a `Breadcrumb` is the current page: it renders
  as `aria-current="page"` text and is never a link. Never end a trail on an
  ancestor — the link is lost and the marker lies.
- **N.** Application titles are Public Sans `text-2xl font-semibold` via
  `PageHeader`. Lora is the marketing voice and belongs only to `app/page.tsx`
  and `components/auth/brand-panel.tsx`.

- **O.** `/teacher` is the **dashboard** and `/teacher/classes` is the class
  list. Any crumb or link meaning "the classes" points at `/teacher/classes`.
- **P.** A navigation row exists only when its route reads a real table. A
  feature with no query behind it is not listed, and a control with no
  backend is rendered as a statement of what is unavailable — never as a
  button that does nothing.
- **Q.** No charting library. The Figma's recharts graphs are rendered as
  lists and rails over the same real rows (decision **E**).
- **R.** `Card` has three variants and they are not decoration: `default`
  (`rounded-2xl p-6`, flat) is the in-app surface, `elevated` adds the
  `shadow-sm` the Figma uses **exactly once** in fifteen screens — the
  standalone card floating on a bare field: onboarding, login, signup, join —
  and `list` (`rounded-xl p-5`, flat) is a row in a list. Do not restore a
  blanket `shadow-sm`; every in-app card in the design is flat.
- **S.** `StatCard` has three shapes: bare (class detail), `tone` (the
  Dashboard's tinted square + dot), and `layout="label-first"` + `valueTone`
  (Tuition). There is deliberately **no `navy` tone** — the Figma's tinted
  marks are only `#4466EE`, `#3BA876`, `#E8834A`. `valueTone` uses
  `green-dark`/`orange-dark` because `--green` is 2.98:1 on white.
- **T.** The Figma has **no `Classes.tsx`**. `/teacher/classes` has no design to
  be faithful to; it is `Dashboard.tsx`'s class card, elaborated. Do not
  "restore fidelity" to a screen that does not exist.
- **U.** Click feedback is `PendingTint` (`useLinkStatus`), never an optimistic
  selection. It claims nothing: it does not move `aria-current`, does not
  restyle the pill as chosen, and renders nothing without JavaScript. Do not
  replace it with `loading.tsx` on a search-param route — that blanks the filter
  row along with the content. It is a **wash over the whole control**
  (`inset-0`, `bg-current/10`, `rounded-[inherit]`), not M23's hairline: a 2px
  rule under a link reads as an underline, the user reported it as one, and the
  Figma underlines nothing. Do not put the feedback back on one edge.
- **V.** In Tailwind v4, `outline-none` sets `--tw-outline-style: none` and the
  width utility `outline-2` renders `outline-style: var(--tw-outline-style)` —
  so `outline-none focus-visible:outline-2` paints **no ring at all**. Wherever
  both sit on the same element, `focus-visible:outline-solid` must sit there
  too. This is why every focusable control in the app carries the trio
  `focus-visible:outline-solid focus-visible:outline-2
  focus-visible:outline-offset-2`.

- **W.** The teacher Calendar **is** the Figma's weekly time grid — a
  `grid-cols-[56px_repeat(7,1fr)]` canvas, 64px an hour from 06:00 to 22:00,
  with each lesson absolutely positioned by its start minute and as tall as it
  lasts. M22/M23's "a pixel canvas cannot meet zero horizontal scroll at 320px"
  is **superseded**: it does not reflow, it scrolls, inside its own labelled
  `overflow-x-auto` region with a 672px `min-width` — the `table.tsx`
  treatment. Do not put the seven day cards back. The window widens via
  `gridRange` when a real lesson falls outside 06:00–22:00 and is **never**
  narrowed, because a block positioned off the grid is a lesson silently lost.
  There is deliberately **no internal vertical scroller**: the Figma's is an
  artefact of its `h-full overflow-hidden` shell, and starting at 06:00 in a
  product whose classes meet in the evening would hide every real lesson on
  load, in a screenshot, and without JavaScript.

- **X.** The student's chrome is the Figma's **top bar**
  (`components/shell/student-shell.tsx`), not the teacher sidebar. The design
  renders its student screen outside `<Layout>`, and M22's shared sidebar was a
  recorded deviation, not a decision. `AppShell` branches on `role` and its
  `NAV` table is typed `Record<"teacher", …>` so no student row can creep back
  in. Do not give the student a sidebar, and do not invent student nav sections
  — the design has exactly one student screen.
- **Y.** `/student/[classId]` **is** the Figma's student Dashboard, and it has
  **four** tabs: the design's Tiến bộ / Bài tập / Lịch sử in its order, plus
  **Buổi học**. The fourth exists because M12's attendance view and the lesson
  list have no equivalent in a mock whose student is hard-coded into one class;
  removing a working feature to match a screenshot is not fidelity (§1 of the
  brief: "Do not remove existing functionality merely because it is not visible
  in one screenshot"). The tabs are `<Link>`s over `?tab=` and are **not
  prefetched** — each tab's loader is gated on that tab being rendered, so a
  prefetch would issue all four queries on every visit. `/student` is the class
  chooser the design has no screen for; decision **T** governs it.
- **Z.** The student score chart is a **hand-authored inline SVG**
  (`components/student/score-trend.tsx`), never a charting dependency —
  decision **Q**, applied to the one place the Figma actually draws a graph. It
  stays a Server Component, renders with JavaScript off, and below 360px it
  **scrolls inside its own labelled `overflow-x-auto` region** rather than
  scaling 10px axis labels into illegibility: the `components/ui/table.tsx` /
  M25 treatment, and the reason the page still never scrolls sideways.

- **AA.** The monthly report has **one canonical loader**,
  `loadMonthlyStudentReport` in `lib/monthly-report.ts`, and the Web preview,
  the PDF, the DOCX and the XLSX all render that one `MonthlyStudentReport`
  value. PDF and DOCX go further and share a single `Block[]` document
  (`lib/export/blocks.ts` + `report-document.ts`), so a section cannot exist in
  one file and be missing from the other. Never add a second query path for an
  export format: a parent holding a PDF that disagrees with the teacher's screen
  is the one failure this whole feature cannot survive.
- **AB.** Exports are a **Route Handler** (`app/teacher/reports/export/route.ts`),
  not a Server Action, because that makes every export control a plain
  `<a href download>` that works with JavaScript disabled — §12's requirement
  applied to a document, not just a page. The handler re-derives identity from
  the session and answers **404** to every refusal it can make: not a teacher,
  a class the teacher does not own, a membership not in that class, a
  per-student format with no `student`, and an unknown `format`. They are
  deliberately indistinguishable, so a 404 says nothing about who exists.
- **AC.** `pdf-lib` + `@pdf-lib/fontkit` + two bundled Public Sans TTFs are the
  **only** dependencies M27 added, and the reason is Vietnamese, not
  convenience: the PDF standard-14 fonts are WinAnsi and cannot draw `ố`, `ệ` or
  `ữ`, so the dependency-free PDF would have shipped a report with the language
  removed. fontkit subsets the face to `Type0` / `Identity-H` / `CIDFontType2`
  with a `ToUnicode` CMap, which is also what makes the text selectable and
  searchable rather than a picture. **DOCX and XLSX add nothing** — Node's
  `zlib.crc32` + `deflateRawSync` write the OOXML containers in
  `lib/export/zip.ts`. Do not add a document or spreadsheet library on top of
  that, and do not add a charting library for the two report graphs
  (decisions **Q**/**Z** — they are inline SVG, which is also why they appear
  in the PDF and with JavaScript off).
- **AD.** The report month is a **calendar month on the class's timezone**,
  resolved through `lib/report-period.ts` over `lib/time.ts`. `?month=` is
  `YYYY-MM`; anything unparseable falls back to the class's own current month
  rather than erroring, and "Tháng này" **drops** the parameter so the fallback
  recomputes it. A UTC slice would move an evening lesson on the 1st or the
  31st into the wrong month, which in a parent-facing document is a lie about
  when a child was taught.
- **AE.** Nothing in the report is generated, averaged or inferred. Standing
  comes from `v_member_performance_status`, current band from
  `v_member_current_band`, attendance from `v_member_session_attendance`, and
  the teacher's comment from `monthly_reports.teacher_comment` — read, never
  written. The Figma's invented improvement bullets, its templated comment, its
  hardcoded `"8.1/10"`, its duplicated "Next Month Focus" and its "Share with
  Parent" button have no data behind them and are therefore **absent**, not
  approximated (decision **P**). There is no LLM, no AI API and no summarizer
  anywhere in this feature.

- **AF.** **"Loại lớp" is a stated product fact, not a column.** Nothing in the
  schema records whether a class is taught online or in a room: `public.classes`
  has no delivery-mode column, `public.course_type` is the *subject*, the class
  form never asks, and the only adjacent column in fifteen migrations is
  `class_sessions.location` — nullable free text on an *individual session*.
  Asked rather than inferred, the teacher answered that every class here is
  **Online**, so `/teacher/classes` renders one `DELIVERY_MODE` constant with a
  JSDoc saying exactly that. Do not "improve" this by deriving it from
  `class_sessions.location`, from `course_type`, or from the schedule text — all
  three would be inventing a convention. The day a class meets in a room, the
  constant is not the thing to edit: `classes` needs a real column,
  `components/class/class-form.tsx` needs to ask for it, and the existing rows
  need a backfill decision.
- **AG.** **`/teacher/classes` sorts `start_date` DESC in the page, not in the
  query, and that is not laziness.** `loadTeacherClassList` is M24's single
  `classes` read, and its rows are `TeacherContext.classes` — shared with
  `/teacher`, `/teacher/lesson-logs`, `/teacher/reports` and `/teacher/tuition`
  (whose class filter pills are drawn in list order) and with
  `/teacher/calendar`, which indexes `CLASS_TONES` **positionally**, so
  reordering that query recolours the calendar. Sorting in the database without
  that side effect would require a second `classes` query, which M24 exists to
  avoid. The tie-break is free and must stay free: `Array.prototype.sort` is
  stable and the rows arrive in `created_at` DESC, so two classes starting the
  same day keep newest-created first — do not replace the comparator with one
  that returns a non-zero value for equal start dates.
- **AH.** **`flex-1` is not enough to let a flex item shrink.** §2 already
  records that `flex-1` is `flex: 1 1 0%`; the other half is that a flex item's
  `min-width` still defaults to `auto`, so an item containing something with an
  intrinsic minimum — a table with a `min-width`, a `<pre>`, a long unbroken
  string — will refuse to narrow and push the **document** sideways instead.
  `AppShell` lays the sidebar and `PageShell`'s `flex-1` `<main>` out as a flex
  row from `lg` up, which is why `/teacher/classes` scrolled 135px at exactly
  1024px until its `PageShell` was given `min-w-0`. Any future page that puts a
  `min-width` inside `PageShell` needs the same, and the fix belongs on the page
  rather than in the primitive until more than one page needs it.

Additional standing constraints from the user, still in force:

- Do not commit, push, deploy, or modify production data unless explicitly asked.
- Do not claim a test passed unless it was actually run.
- Do not claim an email was sent unless the SMTP send actually succeeded.
- Do not make unrelated improvements. Be conservative.
- Do not ask the user to paste files that can be read from the repository.
- `IELTS Evening Group B` is real data — do not write test data into it.
- Do not replace `useFormStatus().data` in
  `components/attendance/status-buttons.tsx`.
- Do not use `toISOString().slice(0, 10)`.
- Do not hardcode the Figma example invite code.

---

## 16. Git workflow

**Before a milestone**

```
git status
git log --oneline -5
```

**After implementation**

```
git status
git diff --stat
git diff
```

then

```
node node_modules/typescript/bin/tsc --noEmit
npm run lint
npm run build
```

Review the complete diff. Commit only milestone-specific files. **Push only when
explicitly requested or when the milestone prompt explicitly requires it.**

**Never:** amend old commits · rewrite history · force push · reset unrelated
work · delete unrelated files.

Note: the repository is LF-only. `git` warns "LF will be replaced by CRLF" on
every touched file. This is expected and harmless.

---

## 17. Claude behaviour rules

**Rule 1 — Read memory first.** Read this file before beginning milestone work.

**Rule 2 — Do not repeatedly ask.** If the answer exists in this file, the
repository, git history, or the current milestone prompt, do not ask again.

**Rule 3 — Verify instead of asking.** Inspect `package.json` for the framework,
`app/` for routes, `supabase/migrations/` for the schema, git history and this
file for milestone outcomes. This file already answers "should we preserve RLS?"
— yes.

**Rule 4 — Ask only genuine blockers.** A required product decision is genuinely
undefined; two documented decisions conflict; required external access is
unavailable; a destructive action needs explicit authorization; a business
requirement cannot be inferred safely. Not routine implementation details.

**Rule 5 — Preserve context after implementation.** At the end of every
milestone, update this file without being asked: milestone result, architectural
decisions, known limitations, test status, commit hash if committed.

**Rule 6 — Never erase historical context.** Append to and refine §13; never
replace the history with only the latest milestone.

**Rule 7 — Current code beats stale documentation.** This file is memory; the
repository is authoritative for current implementation. On a conflict: inspect
git history, determine what changed, update this file — do not blindly follow
stale documentation.

**Rule 8 — Do not silently change architecture.** A new dependency, a migration,
an RLS change, a new API, service-role access, or client-side protected data —
stop and explain the impact first, unless the milestone explicitly requires it.

---

## 18. Environment notes (Windows dev machine)

- Shell: PowerShell primary, Bash (Git Bash) available.
- **`npx` is broken in this shell.** Call binaries directly, e.g.
  `node node_modules/typescript/bin/tsc --noEmit`.
- **Prettier is not installed.** Match surrounding formatting by hand.
- Python defaults to cp1252 stdout — set `PYTHONIOENCODING=utf-8` before printing
  Vietnamese, or it raises `UnicodeEncodeError`.
- In Bash heredocs, use the **quoted** form (`<<'PY'`) when the body contains
  backticks or `${...}`, otherwise bash expands them inside the string literals.
- Killing the dev/prod server:
  `PID=$(netstat -ano | grep LISTENING | grep ":3000 " | head -1 | awk '{print $NF}'); taskkill //F //PID "$PID"`
- Browser verification is done with headless Chrome over CDP:
  `chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> --no-first-run --disable-gpu about:blank`,
  then `Emulation.setDeviceMetricsOverride`, `Runtime.evaluate` with
  `returnByValue`, `Emulation.setScriptExecutionDisabled` for the no-JS pass, and
  `Page.captureScreenshot` with `captureBeyondViewport`.

---

## 19. Open questions for the user

- `support+stu-1787989399@blooperry.com` — the instruction "remove … and use
  dungst6@gmail.com" was read as "disregard that account, use this one instead".
  Nothing has been deleted. Whether an actual production deletion was intended
  remains unanswered.
