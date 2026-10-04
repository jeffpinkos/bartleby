import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from './app.js';
import type { Note, Project, User } from '../shared/types.js';

// Run against the migrated local database; every fixture is rolled back.
test('Bartleby API with real PostgreSQL', async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a migrated development database.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const db = await pool.connect();
  const app = buildApp(db);
  try {
    await db.query('BEGIN');
    const request = app.inject.bind(app);
    const createUser = async (name: string) => {
      const result = await request({ method: 'POST', url: '/api/users', payload: { name } });
      assert.equal(result.statusCode, 201, result.body);
      return result.json<{ user: User }>().user;
    };
    const owner = await createUser('  Bartleby test owner  ');
    const other = await createUser('Bartleby test other');
    const userPath = `/api/users/${owner.id}`;
    let project: Project;
    let note: Note;

    await t.test('creates users and lists them', async () => {
      assert.equal(owner.name, 'Bartleby test owner');
      const response = await request({ url: '/api/users' });
      assert.equal(response.statusCode, 200);
      assert.ok(response.json<{ users: User[] }>().users.some((user) => user.id === owner.id));
    });

    await t.test('rejects invalid names and malformed identifiers', async () => {
      for (const name of ['', ' \n\t ', 'x'.repeat(101), 42]) {
        assert.equal((await request({ method: 'POST', url: '/api/users', payload: { name } })).statusCode, 400);
      }
      assert.equal((await request({ url: '/api/users/not-a-uuid/projects' })).statusCode, 400);
      assert.equal((await request({ url: `/api/users/${randomUUID()}/projects` })).statusCode, 404);
      assert.equal((await request({ method: 'POST', url: '/api/users', payload: { name: 'valid', role: 'admin' } })).statusCode, 400);
    });

    await t.test('creates and lists a project scoped to its user', async () => {
      const response = await request({ method: 'POST', url: `${userPath}/projects`, payload: { name: '  Field notes  ', description: 'Some thoughts.' } });
      assert.equal(response.statusCode, 201, response.body);
      project = response.json<{ project: Project }>().project;
      assert.equal(project.name, 'Field notes');
      assert.equal(project.userId, owner.id);
      assert.equal(project.noteCount, 0);
      const own = (await request({ url: `${userPath}/projects` })).json<{ projects: Project[] }>();
      assert.deepEqual(own.projects, [project]);
      const others = (await request({ url: `/api/users/${other.id}/projects` })).json<{ projects: Project[] }>();
      assert.deepEqual(others.projects, []);
      assert.equal((await request({ method: 'POST', url: `/api/users/${randomUUID()}/projects`, payload: { name: 'Missing owner' } })).statusCode, 404);
    });

    await t.test('persists a note, preserves its text and permits an optional title', async () => {
      const body = 'A thought with a quote: \'\n<script>alert("text only")</script>\n  Keep the indentation.  ';
      const response = await request({ method: 'POST', url: `${userPath}/projects/${project.id}/notes`, payload: { body } });
      assert.equal(response.statusCode, 201, response.body);
      note = response.json<{ note: Note }>().note;
      assert.equal(note.title, '');
      assert.equal(note.body, body);
      assert.equal(note.projectId, project.id);
      assert.ok(Number.isFinite(Date.parse(note.createdAt)));
      const fetched = (await request({ url: `${userPath}/projects/${project.id}` })).json<{ project: Project; notes: Note[] }>();
      assert.deepEqual(fetched.notes, [note]);
      assert.equal(fetched.project.noteCount, 1);
    });

    await t.test('rejects blank notes, oversized content, and missing projects', async () => {
      const path = `${userPath}/projects/${project.id}/notes`;
      for (const body of ['', '\t\n ', 'x'.repeat(100001), 42]) {
        assert.equal((await request({ method: 'POST', url: path, payload: { body } })).statusCode, 400);
      }
      assert.equal((await request({ method: 'POST', url: path, payload: { title: 'x'.repeat(201), body: 'valid' } })).statusCode, 400);
      assert.equal((await request({ method: 'POST', url: `${userPath}/projects/${randomUUID()}/notes`, payload: { body: 'valid' } })).statusCode, 404);
    });

    await t.test('prevents mismatched user, project, and note IDs from reading or mutating notes', async () => {
      const wrongUser = `/api/users/${other.id}/projects/${project.id}`;
      assert.equal((await request({ url: wrongUser })).statusCode, 404);
      assert.equal((await request({ method: 'POST', url: `${wrongUser}/notes`, payload: { body: 'Nope' } })).statusCode, 404);
      for (const method of ['PATCH', 'DELETE'] as const) {
        const options = method === 'PATCH' ? { payload: { body: 'Nope' } } : {};
        assert.equal((await request({ method, url: `${wrongUser}/notes/${note.id}`, ...options })).statusCode, 404);
        assert.equal((await request({ method, url: `${userPath}/projects/${randomUUID()}/notes/${note.id}`, ...options })).statusCode, 404);
      }
      const fetched = (await request({ url: `${userPath}/projects/${project.id}` })).json<{ notes: Note[] }>();
      assert.equal(fetched.notes[0]?.body, note.body);
    });

    await t.test('edits a note and retains its creation timestamp', async () => {
      const response = await request({ method: 'PATCH', url: `${userPath}/projects/${project.id}/notes/${note.id}`, payload: { title: '  Revised  ', body: 'An edited thought.' } });
      assert.equal(response.statusCode, 200, response.body);
      const updated = response.json<{ note: Note }>().note;
      assert.equal(updated.title, 'Revised');
      assert.equal(updated.body, 'An edited thought.');
      assert.equal(updated.createdAt, note.createdAt);
      assert.ok(Date.parse(updated.updatedAt) >= Date.parse(note.updatedAt));
      const fetched = (await request({ url: `${userPath}/projects/${project.id}` })).json<{ notes: Note[] }>();
      assert.deepEqual(fetched.notes, [updated]);
    });

    await t.test('deletes a note and updates project counts', async () => {
      const path = `${userPath}/projects/${project.id}/notes/${note.id}`;
      assert.equal((await request({ method: 'DELETE', url: path })).statusCode, 204);
      assert.equal((await request({ method: 'DELETE', url: path })).statusCode, 404);
      const fetched = (await request({ url: `${userPath}/projects/${project.id}` })).json<{ project: Project; notes: Note[] }>();
      assert.deepEqual(fetched.notes, []);
      assert.equal(fetched.project.noteCount, 0);
    });

    await t.test('database constraints reject orphaned projects and whitespace-only notes', async () => {
      await db.query('SAVEPOINT constraint_test');
      await assert.rejects(db.query('INSERT INTO projects (user_id, name) VALUES ($1, $2)', [randomUUID(), 'Orphan']), { code: '23503' });
      await db.query('ROLLBACK TO SAVEPOINT constraint_test');
      await assert.rejects(db.query('INSERT INTO notes (project_id, body) VALUES ($1, $2)', [project.id, '\n\t ']), { code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT constraint_test');
      await db.query('RELEASE SAVEPOINT constraint_test');
    });
  } finally {
    await app.close();
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
