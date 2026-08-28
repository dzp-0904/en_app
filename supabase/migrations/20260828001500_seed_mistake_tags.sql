-- EduTrack Phase 1 — Step 13: global mistake_tags
--
-- teacher_id IS NULL marks a global seed. Every teacher can read these; nobody
-- can edit them (mistake_tags_teacher_update/delete both require
-- teacher_id = auth.uid(), which no global row satisfies). Teachers extend the
-- vocabulary by inserting their own rows alongside.
--
-- lesson_logs.mistakes stores labels BY VALUE, so editing or deleting a tag
-- here never rewrites a historical observation.
--
-- FORCE ROW LEVEL SECURITY applies to the table owner too, and this migration
-- runs with auth.uid() = NULL, so the insert policy would reject these rows.
-- FORCE is lifted for the length of the seed rather than relying on the
-- migration role happening to hold BYPASSRLS — which differs between the local
-- stack and a hosted project.
alter table public.mistake_tags no force row level security;

insert into public.mistake_tags (teacher_id, skill, label) values
  -- Cross-skill grammar and usage
  (null, 'general',   'Article use'),
  (null, 'general',   'Preposition choice'),
  (null, 'general',   'Verb tense consistency'),
  (null, 'general',   'Subject-verb agreement'),
  (null, 'general',   'Singular/plural form'),
  (null, 'general',   'Word form'),
  (null, 'general',   'Collocation'),
  (null, 'general',   'Sentence fragment'),
  (null, 'general',   'Run-on sentence'),
  (null, 'general',   'Word order'),

  -- Reading
  (null, 'reading',   'True/False/Not Given confusion'),
  (null, 'reading',   'Matching headings'),
  (null, 'reading',   'Paraphrase not recognised'),
  (null, 'reading',   'Skimming too slowly'),
  (null, 'reading',   'Scanning for keywords'),
  (null, 'reading',   'Time management (Reading)'),
  (null, 'reading',   'Multiple choice distractor'),
  (null, 'reading',   'Summary completion word limit'),

  -- Listening
  (null, 'listening', 'Answer spelling'),
  (null, 'listening', 'Number or date format'),
  (null, 'listening', 'Distractor missed'),
  (null, 'listening', 'Signposting missed'),
  (null, 'listening', 'Word limit exceeded'),
  (null, 'listening', 'Note completion (Part 4)'),
  (null, 'listening', 'Accent comprehension'),
  (null, 'listening', 'Lost place in recording'),

  -- Writing
  (null, 'writing',   'Task response incomplete'),
  (null, 'writing',   'No Task 1 overview'),
  (null, 'writing',   'Weak thesis statement'),
  (null, 'writing',   'Paragraphing'),
  (null, 'writing',   'Linking words overused'),
  (null, 'writing',   'Under word count'),
  (null, 'writing',   'Limited complex sentences'),
  (null, 'writing',   'Repetitive vocabulary'),
  (null, 'writing',   'Informal register'),
  (null, 'writing',   'Punctuation'),
  (null, 'writing',   'Spelling (Writing)'),
  (null, 'writing',   'Unsupported example'),

  -- Speaking
  (null, 'speaking',  'Hesitation'),
  (null, 'speaking',  'Filler words'),
  (null, 'speaking',  'Answers too short'),
  (null, 'speaking',  'Memorised answer'),
  (null, 'speaking',  'Pronunciation of individual sounds'),
  (null, 'speaking',  'Word stress'),
  (null, 'speaking',  'Sentence intonation'),
  (null, 'speaking',  'Limited vocabulary range'),
  (null, 'speaking',  'Part 2 timing'),
  (null, 'speaking',  'Self-correction overuse')
on conflict do nothing;

alter table public.mistake_tags force row level security;
