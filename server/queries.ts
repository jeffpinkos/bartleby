import type { Pool, PoolClient } from 'pg';
import type { Note, NoteInput, NoteSearchResponse, NoteSearchResult, Project, ProjectInput, User } from '../shared/types.js';

// A connected client also lets integration tests roll back their own data.
export type Database = Pool | PoolClient;
type NoteRow = Omit<Note, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date };
const noteColumns = 'n.id, n.project_id AS "projectId", n.title, n.body, n.created_at AS "createdAt", n.updated_at AS "updatedAt"';
const projectColumns = 'p.id, p.user_id AS "userId", p.name, p.description, count(n.id)::int AS "noteCount"';
const toNote = (row: NoteRow): Note => ({
  ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

export async function listUsers(db: Database) {
  return (await db.query<User>('SELECT id, name FROM users ORDER BY created_at, id')).rows;
}

export async function createUser(db: Database, name: string) {
  return (await db.query<User>('INSERT INTO users (name) VALUES ($1) RETURNING id, name', [name])).rows[0]!;
}

export async function userExists(db: Database, id: string) {
  return (await db.query('SELECT id FROM users WHERE id = $1', [id])).rowCount === 1;
}

export async function listProjects(db: Database, userId: string) {
  return (await db.query<Project>(`
    SELECT ${projectColumns} FROM projects p LEFT JOIN notes n ON n.project_id = p.id
    WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.created_at, p.id`, [userId])).rows;
}

export async function getProject(db: Database, userId: string, projectId: string) {
  return (await db.query<Project>(`
    SELECT ${projectColumns} FROM projects p LEFT JOIN notes n ON n.project_id = p.id
    WHERE p.user_id = $1 AND p.id = $2 GROUP BY p.id`, [userId, projectId])).rows[0];
}

export async function createProject(db: Database, userId: string, name: string, description: string) {
  return (await db.query<Project>(`
    INSERT INTO projects (user_id, name, description)
    SELECT id, $2, $3 FROM users WHERE id = $1
    RETURNING id, user_id AS "userId", name, description, 0 AS "noteCount"`, [userId, name, description])).rows[0];
}

export async function updateProject(db: Database, userId: string, projectId: string, input: Partial<ProjectInput>) {
  return (await db.query<Project>(`
    UPDATE projects p SET name = coalesce($3, p.name), description = coalesce($4, p.description)
    WHERE p.user_id = $1 AND p.id = $2
    RETURNING p.id, p.user_id AS "userId", p.name, p.description,
      (SELECT count(*)::int FROM notes WHERE project_id = p.id) AS "noteCount"`,
  [userId, projectId, input.name, input.description])).rows[0];
}

export async function listNotes(db: Database, projectId: string) {
  return (await db.query<NoteRow>(`
    SELECT ${noteColumns} FROM notes n
    WHERE n.project_id = $1 ORDER BY n.created_at DESC, n.id DESC`, [projectId])).rows.map(toNote);
}

export async function searchNotes(db: Database, userId: string, query: string): Promise<NoteSearchResponse> {
  // Treat SQL wildcard characters as ordinary text in the user's search.
  const pattern = `%${query.replace(/[!%_]/g, '!$&')}%`;
  const rows = (await db.query<Omit<NoteSearchResult, 'excerpt'> & { body: string }>(`
    SELECT n.id, n.project_id AS "projectId", p.name AS "projectName", n.title, n.body
    FROM notes n JOIN projects p ON p.id = n.project_id
    WHERE p.user_id = $1 AND (n.title ILIKE $2 ESCAPE '!' OR n.body ILIKE $2 ESCAPE '!')
    ORDER BY n.created_at DESC, n.id DESC LIMIT 51`, [userId, pattern])).rows;
  const notes = rows.slice(0, 50).map(({ body, ...note }) => {
    const match = body.toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, match - 60);
    const end = start + 240;
    const excerpt = `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
    return { ...note, excerpt };
  });
  return { notes, hasMore: rows.length > 50 };
}

export async function createNote(db: Database, userId: string, projectId: string, input: NoteInput) {
  const row = (await db.query<NoteRow>(`
    INSERT INTO notes AS n (project_id, title, body)
    SELECT id, $3, $4 FROM projects WHERE user_id = $1 AND id = $2
    RETURNING ${noteColumns}`, [userId, projectId, input.title, input.body])).rows[0];
  return row ? toNote(row) : undefined;
}

export async function updateNote(db: Database, userId: string, projectId: string, noteId: string, input: NoteInput) {
  const row = (await db.query<NoteRow>(`
    UPDATE notes n SET title = $4, body = $5, updated_at = clock_timestamp()
    FROM projects p
    WHERE n.project_id = p.id AND p.user_id = $1 AND p.id = $2 AND n.id = $3
    RETURNING ${noteColumns}`, [userId, projectId, noteId, input.title, input.body])).rows[0];
  return row ? toNote(row) : undefined;
}

export async function moveNote(db: Database, userId: string, projectId: string, noteId: string, targetProjectId: string) {
  const row = (await db.query<NoteRow>(`
    UPDATE notes n SET project_id = target.id
    FROM projects source, projects target
    WHERE n.project_id = source.id AND source.user_id = $1 AND source.id = $2 AND n.id = $3
      AND target.user_id = $1 AND target.id = $4
    RETURNING ${noteColumns}`, [userId, projectId, noteId, targetProjectId])).rows[0];
  return row ? toNote(row) : undefined;
}

export async function deleteNote(db: Database, userId: string, projectId: string, noteId: string) {
  return (await db.query(`
    DELETE FROM notes n USING projects p
    WHERE n.project_id = p.id AND p.user_id = $1 AND p.id = $2 AND n.id = $3`,
  [userId, projectId, noteId])).rowCount === 1;
}
