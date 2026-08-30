# CLAUDE.md — EduTrack project memory

**This file is the persistent source of project context for Claude Code sessions.**
Read it in full before starting any milestone. Do not ask the user for anything
that is already answered here, in the repository, in git history, or in the
current milestone prompt.

Last updated: 2026-08-30, after M22.

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

### Client components — exactly five

Everything else is a Server Component. Do **not** add `"use client"` without a
concrete interaction reason. M22 replaced `components/shell/nav-item.tsx` with
`components/shell/nav.tsx` — one component marking the active row for seven nav
entries instead of one per row — so the count did not change.

```
components/shell/nav.tsx
components/roster/tag-editor.tsx
components/auth/submit-button.tsx
components/onboarding/copy-field.tsx
components/attendance/status-buttons.tsx
```

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

## 14. Current project state (verified 2026-08-30)

| | |
|---|---|
| Branch | `main` |
| HEAD | `16bad2c` — "feat: reconstruct the full Figma UI" |
| `origin/main` | `24ed32b` — **M22 is committed locally and NOT pushed** |
| Remote | `https://github.com/dzp-0904/en_app.git` |
| Working tree | **clean** |
| Routes | **25** (24 `page.tsx` + `app/auth/callback/route.ts`) |
| Migrations | 15, unchanged since the database foundation commit |
| RLS | enabled + FORCEd on 13 tables |
| Gates | `tsc --noEmit` ✓ · `npm run lint` ✓ · `npm run build` ✓ |

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
/teacher/tuition                               app/teacher/tuition/page.tsx
/teacher/settings                              app/teacher/settings/page.tsx
/teacher/new                                   app/teacher/new/page.tsx
/teacher/[classId]                             app/teacher/[classId]/page.tsx        (tabs: ?tab=lessons|info)
/teacher/[classId]/edit                        .../edit/page.tsx
/teacher/[classId]/sessions/new                .../sessions/new/page.tsx
/teacher/[classId]/sessions/[sessionId]        .../sessions/[sessionId]/page.tsx
/student                                       app/student/page.tsx
/student/[classId]                             app/student/[classId]/page.tsx
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
