-- Up Migration
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name ~ '[^[:space:]]' AND char_length(name) <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (name ~ '[^[:space:]]' AND char_length(name) <= 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_created_idx ON projects (user_id, created_at, id);

CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  body text NOT NULL CHECK (body ~ '[^[:space:]]' AND char_length(body) <= 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_project_created_idx ON notes (project_id, created_at DESC, id DESC);

-- Down Migration
DROP TABLE notes;
DROP TABLE projects;
DROP TABLE users;
