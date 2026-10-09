# Bartleby

A small personal project and note application. Create a user, give an idea a project, and capture, browse, edit, or delete its notes.

## Run locally

Requirements: Node.js 24, npm, and the existing PostgreSQL 18 container `bartleby-db` with a database named `bartleby`.

```sh
nvm use
npm ci
cp .env.example .env
# Set DATABASE_URL in .env to match your existing container credentials.
npm run db:migrate
npm run dev
```

If `.env` already exists, keep it. It is ignored by Git. The initial local setup has already configured it from the existing container.

Open [Bartleby](http://127.0.0.1:5173). Vite serves the frontend and proxies `/api` to Fastify on port 3001. `PORT` in `.env` can change the API port. Both application servers bind to localhost. PostgreSQL stays in the existing Docker container.

Create a user, create a project, and add a note. Refresh to see it persist. The browser remembers the selected user and project; all users, projects, and saved notes live in PostgreSQL. Use **Edit project** next to the project heading to rename it or change its description. Note titles and project descriptions are optional. Note bodies are plain text, with line breaks and indentation preserved. Editing uses an explicit **Save changes** button. Deletion requires confirmation, and navigation warns before discarding a draft.

Use **Move to project…** on a saved note to choose another project belonging to the current user, then select **Move note**. Moving preserves the note's content and dates, updates both project counts, and leaves you in the source project with any unsaved composer draft intact.

Use **Search notes** in the sidebar to find text in saved note titles and bodies across your active projects. Searches ignore case and treat punctuation literally. Results show the project name and an excerpt; select one to open, scroll to, and focus that note. **Back to search results** refreshes the results after edits. Leaving an unsaved draft still requires confirmation. Broad searches show the newest 50 matches and suggest narrowing the query.

Use **Archive project** beside the project heading to hide a completed project from the active list and note search. Its saved notes remain intact. Open **Archived projects** in the sidebar and select **Restore** to return it to the workspace. Archiving asks before discarding an unfinished draft.

Use **Sort notes** above the note list to choose **Newest first** (the default) or **Recently edited**. Recently edited uses the last saved time, so saving an edit moves that note to the top. The choice is remembered per user in this browser and applies across projects. Changing the sort preserves unfinished drafts. Moving a note preserves its dates and does not count as an edit.

Use **Export Markdown** in the sidebar to download all of the selected user's active and archived projects, descriptions, notes, and timestamps in one `bartleby-export.md` file. Note bodies are placed in fenced text blocks to preserve line breaks and indentation.

For quick keyboard access, press **N** to focus the new-note composer or **/** to focus search. Shortcuts stay inactive while you are typing or using a control.

User selection is a local convenience, not authentication. Anyone who can reach the API can select any user. This version is intended for local development only.

## Commands

| Command              | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run dev`        | Start frontend and API with reload                                        |
| `npm run db:migrate` | Apply pending migrations                                                  |
| `npm run typecheck`  | Check frontend and backend TypeScript                                     |
| `npm test`           | Run integration tests against the migrated PostgreSQL database            |
| `npm run test:e2e`   | Build the app and run the browser workflow on desktop and mobile Chromium |
| `npm run build`      | Type-check and build the frontend and server                              |
| `npm start`          | Serve the built application at http://127.0.0.1:3001                      |

Integration tests use a transaction and roll back their fixtures. Run migrations before testing. They verify CRUD, input validation, user/project scoping, note moves with content and timestamp preservation, note search, archive/restore with note preservation, archive input validation and user scoping, archived-note export, and database constraints using real PostgreSQL.

Install the browser once with `npx playwright install chromium`, then run `npm run test:e2e`. The suite starts its own compiled application on localhost port 3101. Each test creates a uniquely named user and cleans up only that user's records after each run, including assertion failures. The workflows cover note creation/refresh/edit/deletion, project editing, note moves, and search with result navigation, draft protection, failed-request retry, and pending requests. They also cover archive/restore across reloads, archive draft protection, and note sorting after edits with draft and preference preservation. Tests use the same migrated database from `.env`; they do not reset the database. Keep port 3101 free. Playwright stops its server when the run ends, so your normal development servers can keep running. Failure screenshots and traces go to your OS temporary directory under `bartleby-playwright`, outside the repository.

## Structure

```text
client/      React UI, plain CSS, native fetch
server/      Fastify routes and parameterized PostgreSQL queries
shared/      API data types
migrations/  Versioned SQL schema changes
scripts/     Migration entry point
e2e/         Repeatable browser smoke test
```

One repository, one backend, one database. Ordinary functions keep HTTP handling separate from SQL. Extract business rules into separate functions when there are rules worth extracting.

## Data model

```text
User
└── Project
    └── Note
```

- `users`: UUID, name, creation time.
- `projects`: UUID, required user, name, optional description, creation time, and an `archived` flag (default `false`).
- `notes`: UUID, required project, optional title, body, creation and modification times.

Foreign keys preserve these relationships. Indexes support listing projects per user and notes per project. Notes appear newest first by creation time by default; the UI can also sort by last saved time using the existing `updated_at` field. Equal saved times fall back to creation time and then ID for stable ordering. There is no separate note owner; ownership comes from the project.

## Schema changes

All schema changes go through `node-pg-migrate`. Create a migration with `npx node-pg-migrate create descriptive-name -j sql`, write its `Up Migration` and `Down Migration` sections, then run `npm run db:migrate`. Review the generated SQL file before applying it. Applied migrations are recorded in `pgmigrations`; repeat runs apply only pending files. Once a migration is applied, add a new migration to change the schema instead of editing the old one. No schema synchronization or schema changes occur at server startup.

## HTTP API

| Method        | Path                                                        | Purpose                                                      |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| GET           | `/api/health`                                               | Check API/database connectivity                              |
| GET, POST     | `/api/users`                                                | List or create users                                         |
| GET           | `/api/users/:userId/export.md`                              | Download the user's projects and notes as Markdown          |
| GET, POST     | `/api/users/:userId/projects`                               | List active projects or create a project; `?archived=true` lists archived projects |
| GET           | `/api/users/:userId/notes/search?q=phrase`                  | Search saved note titles and bodies in active projects |
| GET           | `/api/users/:userId/projects/:projectId`                    | Get a project and its notes                                  |
| PATCH         | `/api/users/:userId/projects/:projectId`                    | Update name, description, or `archived` (boolean; `false` restores)                   |
| POST          | `/api/users/:userId/projects/:projectId/notes`              | Create a note                                                |
| PATCH, DELETE | `/api/users/:userId/projects/:projectId/notes/:noteId`      | Edit or delete a note                                        |
| POST          | `/api/users/:userId/projects/:projectId/notes/:noteId/move` | Move a note to another project belonging to the same user    |

Create a user with `{ "name": "Jeff" }`, a project with `{ "name": "Field notes", "description": "" }`, and a note with `{ "title": "", "body": "An idea." }`. Editing sends the complete note body and optional title. API routes validate input and reject mismatched user/project/note IDs; this relationship check is not an authentication boundary.

Project edits accept either or both of `name` and `description`, for example `{ "name": "Working notes" }`. Omitted fields stay unchanged; an empty description clears it. A project name cannot be blank. Project editing preserves the project ID, owner, and notes.

Note moves accept `{ "targetProjectId": "destination-project-uuid" }` and return `{ "note": ... }`. The path identifies the source project and note. Both projects must belong to the path's user; missing or mismatched records return 404. Moving changes only the project ID, preserving the note ID, title, body, creation time, and modification time. Moving to the current project succeeds without changing the note.

Search requires a nonblank `q` of at most 200 characters and trims surrounding whitespace. It uses a parameterized PostgreSQL `ILIKE` query with escaped wildcard characters. The response is `{ "notes": [...], "hasMore": false }`; each result contains `id`, `projectId`, `projectName`, `title`, and `excerpt`. Results are ordered by creation time newest first, then note ID, with a maximum of 50. No schema changes or additional search infrastructure are required.

## Scope

The application includes user creation, project creation/listing/editing, project detail, and note creation/editing/deletion/moving/search. AI, collaboration, roles, tags, project hierarchies, real-time synchronization, and elaborate authentication are outside this version. Add infrastructure and abstractions only in response to a concrete need.

## License

MIT
