-- EduTrack M30 — curriculum materials (giáo trình) for a class or one session.
--
-- ---------------------------------------------------------------------------
-- NOT APPLIED. This file was written during M30 and deliberately NOT executed
-- against the hosted project. Every other migration in this directory is live;
-- this one is a proposal for review. Until a human runs it, `class_materials`
-- does not exist, the bucket does not exist, and the Giáo trình tab renders the
-- application's ordinary "we could not load this" alert — the same thing every
-- other failed read renders. Nothing in the application creates it on demand.
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AT ALL, WHEN STORAGE ALREADY HAS AN OBJECT LIST.
-- `storage.objects` knows a path, a size and a mime type. It does not know
-- which session a file was uploaded for, and it cannot: `session_id` is not a
-- path component we would want to make load-bearing, because moving a session
-- between days must not move its files. It also cannot express the composite
-- (session_id, class_id) foreign key that every other child table in this
-- schema uses to guarantee a row cannot point at another class's session. So
-- the object store holds bytes and this table holds the relationships, which is
-- the same split `monthly_reports` makes between a snapshot and its metadata.
--
-- WHY NO NEW ENUM, NO NEW RPC, NO SERVICE ROLE.
-- Uploads and downloads run as the signed-in teacher against the same
-- `authenticated` role every other write uses, so `storage.objects`' own RLS is
-- the enforcement and the application is not trusted to do the checking. There
-- is no server-side key anywhere in this feature.

-- ---------------------------------------------------------------------------
-- The bucket. Private, so an object URL is not a capability.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'class-materials',
  'class-materials',
  -- NOT public. A public bucket serves every object to anyone who can guess or
  -- is given the URL, which is precisely the leak the milestone names. Reads go
  -- through a short-lived signed URL minted per request for a teacher who has
  -- just been re-authorised.
  false,
  -- 25 MB. A lesson handout, not a video library.
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- class_materials : what was uploaded, for which class, and optionally for
-- which session of it.
-- ---------------------------------------------------------------------------
create table public.class_materials (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  session_id   uuid,

  -- The object's key inside the bucket. Unique, because two rows pointing at
  -- one object would let deleting either take the other's bytes away.
  storage_path text not null unique,

  -- The name the teacher's file had. Kept separately from the path because the
  -- path is a uuid: a download is served back under this name, and a filename
  -- is user-supplied text that must never be a path component.
  file_name    text not null,
  mime_type    text not null,
  byte_size    bigint not null,

  uploaded_by  uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now(),

  -- The column list is load-bearing, exactly as on lesson_logs and
  -- homework_assignments: a bare ON DELETE SET NULL nulls every referencing
  -- column including the NOT NULL class_id, so deleting a session that carried
  -- material would fail with 23502. This detaches the file and keeps its
  -- tenancy — a handout outlives the lesson it was made for.
  constraint class_materials_session_fk
    foreign key (session_id, class_id)
    references public.class_sessions (id, class_id) on delete set null (session_id),

  constraint class_materials_file_name_length
    check (length(btrim(file_name)) between 1 and 300),

  constraint class_materials_byte_size_positive check (byte_size > 0),

  -- The path this application writes is `<class_id>/<uuid>`, and the storage
  -- policies below authorise on that first segment. A row whose path does not
  -- start with its own class id would be authorised as one class and listed
  -- under another, so the two are tied together here rather than trusted to
  -- agree.
  constraint class_materials_path_scoped_to_class
    check (storage_path like class_id::text || '/%')
);

create index class_materials_class_session_idx
  on public.class_materials (class_id, session_id, created_at desc);

comment on table public.class_materials is
  'Curriculum/material metadata. The bytes live in the private class-materials bucket; this table holds the class and session relationships storage.objects cannot express. Teacher-only in this phase, like monthly_reports and tuition_records.';
comment on column public.class_materials.storage_path is
  'Object key inside the class-materials bucket, always `<class_id>/<uuid>`. The class prefix is what storage.objects'' policies authorise on, and class_materials_path_scoped_to_class keeps it honest.';
comment on column public.class_materials.file_name is
  'The uploader''s own filename, echoed back on download. Never used to build a path: it is untrusted text and may contain separators.';

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every other teacher-owned table in this schema.
-- ---------------------------------------------------------------------------
alter table public.class_materials enable row level security;
alter table public.class_materials force row level security;

create policy class_materials_teacher_all on public.class_materials
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

-- No student policy. Students do not see materials in this phase; adding one
-- later is a policy, not a redesign.

-- No UPDATE grant. A material is replaced by deleting it and uploading again,
-- which keeps the row and the object it names from ever drifting apart.
grant select, insert, delete on public.class_materials to authenticated;

-- ---------------------------------------------------------------------------
-- storage.objects policies, scoped by the first path segment.
--
-- `(storage.foldername(name))[1]` is the `<class_id>` prefix. Comparing it to
-- app.my_class_ids() means the object store itself refuses a teacher who does
-- not own the class, whatever the application asks for — which is the point:
-- the signed URL is minted by a client carrying the teacher's own JWT, so a
-- forged class id in a request produces no object rather than a leaked one.
-- ---------------------------------------------------------------------------
create policy class_materials_objects_teacher_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'class-materials'
    and (storage.foldername(name))[1] =
        any ((select app.my_class_ids())::uuid[]::text[])
  );

create policy class_materials_objects_teacher_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'class-materials'
    and (storage.foldername(name))[1] =
        any ((select app.my_class_ids())::uuid[]::text[])
  );

create policy class_materials_objects_teacher_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'class-materials'
    and (storage.foldername(name))[1] =
        any ((select app.my_class_ids())::uuid[]::text[])
  );

-- Deliberately no UPDATE policy: an object is never overwritten in place, for
-- the same reason class_materials has no UPDATE grant.
