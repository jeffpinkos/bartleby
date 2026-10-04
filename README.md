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

User selection is a local convenience, not authentication. Anyone who can reach the API can select any user. This version is intended for local development only.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and API with reload |
| `npm run db:migrate` | Apply pending migrations |
| `npm run typecheck` | Check frontend and backend TypeScript |
| `npm test` | Run integration tests against the migrated PostgreSQL database |
| `npm run test:e2e` | Build the app and run the browser workflow on desktop and mobile Chromium |
| `npm run build` | Type-check and build the frontend and server |
| `npm start` | Serve the built application at http://127.0.0.1:3001 |

Integration tests use a transaction and roll back their fixtures. Run migrations before testing. They verify CRUD, input validation, user/project scoping, and database constraints using real PostgreSQL.

Install the browser once with `npx playwright install chromium`, then run `npm run test:e2e`. The test starts its own compiled application on localhost port 3101, creates a uniquely named user, exercises note creation/refresh/edit/deletion and project editing, and cleans up only that user's records after each run, including assertion failures. It uses the same migrated database from `.env`; it does not reset the database. Keep port 3101 free. Playwright stops its server when the run ends, so your normal development servers can keep running. Failure screenshots and traces go to your OS temporary directory under `bartleby-playwright`, outside the repository.

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
- `projects`: UUID, required user, name, optional description, creation time.
- `notes`: UUID, required project, optional title, body, creation and modification times.

Foreign keys preserve these relationships. Indexes support listing projects per user and notes per project. Notes appear newest first by creation time. There is no separate note owner; ownership comes from the project.

## Schema changes

All schema changes go through `node-pg-migrate`. Create a migration with `npx node-pg-migrate create descriptive-name -j sql`, write its `Up Migration` and `Down Migration` sections, then run `npm run db:migrate`. Review the generated SQL file before applying it. Applied migrations are recorded in `pgmigrations`; repeat runs apply only pending files. Once a migration is applied, add a new migration to change the schema instead of editing the old one. No schema synchronization or schema changes occur at server startup.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check API/database connectivity |
| GET, POST | `/api/users` | List or create users |
| GET, POST | `/api/users/:userId/projects` | List or create projects |
| GET | `/api/users/:userId/projects/:projectId` | Get a project and its notes |
| PATCH | `/api/users/:userId/projects/:projectId` | Rename a project or update its description |
| POST | `/api/users/:userId/projects/:projectId/notes` | Create a note |
| PATCH, DELETE | `/api/users/:userId/projects/:projectId/notes/:noteId` | Edit or delete a note |

Create a user with `{ "name": "Jeff" }`, a project with `{ "name": "Field notes", "description": "" }`, and a note with `{ "title": "", "body": "An idea." }`. Editing sends the complete note body and optional title. API routes validate input and reject mismatched user/project/note IDs; this relationship check is not an authentication boundary.

Project edits accept either or both of `name` and `description`, for example `{ "name": "Working notes" }`. Omitted fields stay unchanged; an empty description clears it. A project name cannot be blank. Project editing preserves the project ID, owner, and notes.

## Scope

The application includes user creation, project creation/listing/editing, project detail, and note creation/editing/deletion. AI, collaboration, roles, tags, project hierarchies, real-time synchronization, and elaborate authentication are outside this version. Add infrastructure and abstractions only in response to a concrete need.

## License

MIT
