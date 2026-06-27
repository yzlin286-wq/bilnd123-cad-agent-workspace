-- v1.1 SaaS foundation schema draft.
-- This file is safe to commit: it contains no credentials or environment-specific IDs.

create table if not exists users (
  id text primary key,
  auth_provider text not null default 'clerk',
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists projects (
  id text primary key,
  owner_user_id text references users(id) on delete set null,
  organization_id text references organizations(id) on delete cascade,
  title text not null,
  latest_revision_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_user_id is not null or organization_id is not null)
);

create table if not exists messages (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id text references users(id) on delete set null,
  role text not null check (role in ('user', 'agent')),
  content text not null,
  route text,
  revision_id text,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists revisions (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  prompt text,
  engineering_spec jsonb not null,
  parameter_manifest jsonb not null default '[]'::jsonb,
  validation jsonb,
  created_at timestamptz not null default now()
);

create table if not exists artifacts (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  revision_id text not null references revisions(id) on delete cascade,
  kind text not null,
  label text not null,
  name text not null,
  url text not null,
  bytes bigint not null default 0,
  content_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id text primary key,
  revision_id text references revisions(id) on delete cascade,
  user_id text references users(id) on delete set null,
  organization_id text references organizations(id) on delete set null,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  route text,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id bigserial primary key,
  organization_id text references organizations(id) on delete set null,
  user_id text references users(id) on delete set null,
  project_id text references projects(id) on delete set null,
  route text not null,
  part_type text,
  status text not null,
  duration_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_user_id on projects(owner_user_id);
create index if not exists idx_projects_organization_id on projects(organization_id);
create index if not exists idx_messages_project_id on messages(project_id);
create index if not exists idx_revisions_project_id on revisions(project_id);
create index if not exists idx_artifacts_project_revision on artifacts(project_id, revision_id);
create index if not exists idx_feedback_revision_id on feedback(revision_id);
create index if not exists idx_usage_events_org_user_project on usage_events(organization_id, user_id, project_id);
