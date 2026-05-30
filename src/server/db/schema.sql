-- Web Games Builder — PostgreSQL Schema

-- ─── Projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT         PRIMARY KEY,
  name        TEXT         NOT NULL DEFAULT 'Untitled',
  data        JSONB        NOT NULL DEFAULT '{}',
  assets_json JSONB        NOT NULL DEFAULT '{"sprites":[],"tilesets":[],"sounds":[],"backgrounds":[],"videos":[]}',
  last_saved  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_last_saved ON projects(last_saved DESC);

-- ─── Settings (key-value) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings_kv (
  key        TEXT   PRIMARY KEY,
  value      JSONB  NOT NULL DEFAULT '{}'
);

-- ─── Assets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id          TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT         REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,
  name        TEXT         NOT NULL,
  storage_key TEXT,
  cdn_url     TEXT,
  frame_meta  JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         TEXT         UNIQUE NOT NULL,
  password_hash TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  x_id          TEXT         UNIQUE,
  x_handle      TEXT,
  google_id     TEXT         UNIQUE,
  role          TEXT         NOT NULL DEFAULT 'user',
  username      TEXT         UNIQUE,
  demos_seeded  BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id    TEXT REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_demo     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS demo_order  INT     NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cloned_from TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);

-- ─── Published pages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS published_pages (
  id           TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id     TEXT         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id    TEXT         NOT NULL,
  world_id     TEXT,
  slug         TEXT         NOT NULL,
  title        TEXT,
  description  TEXT,
  html_path    TEXT,
  html_content TEXT,
  published_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  is_public    BOOLEAN      NOT NULL DEFAULT true,
  visit_count  BIGINT       NOT NULL DEFAULT 0,
  publish_mode TEXT         NOT NULL DEFAULT 'game',
  UNIQUE (owner_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_published_owner ON published_pages(owner_id);
CREATE INDEX IF NOT EXISTS idx_published_slug  ON published_pages(owner_id, slug);

-- ─── Token blacklist ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti        TEXT         PRIMARY KEY,
  expires_at TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_exp ON token_blacklist(expires_at);
