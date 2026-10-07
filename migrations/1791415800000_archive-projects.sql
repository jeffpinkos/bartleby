-- Up Migration
ALTER TABLE projects ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- Down Migration
ALTER TABLE projects DROP COLUMN archived;
