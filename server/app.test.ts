import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { buildApp } from "./app.js";
import type {
  Note,
  NoteSearchResponse,
  Project,
  User,
} from "../shared/types.js";

// Run against the migrated local database; every fixture is rolled back.
test("Bartleby API with real PostgreSQL", async (t) => {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL must point to a migrated development database.",
  );
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const db = await pool.connect();
  const app = buildApp(db);
  try {
    await db.query("BEGIN");
    const request = app.inject.bind(app);
    const createUser = async (name: string) => {
      const result = await request({
        method: "POST",
        url: "/api/users",
        payload: { name },
      });
      assert.equal(result.statusCode, 201, result.body);
      return result.json<{ user: User }>().user;
    };
    const owner = await createUser("  Bartleby test owner  ");
    const other = await createUser("Bartleby test other");
    const userPath = `/api/users/${owner.id}`;
    let project: Project;
    let note: Note;

    await t.test("archive and restore preserve notes, scope lists, and keep exports complete", async () => {
      const archiveOwner = await createUser("Archive regression owner");
      const base = `/api/users/${archiveOwner.id}`;
      const created = await request({
        method: "POST", url: `${base}/projects`,
        payload: { name: "Archive fixture", description: "Keep this context." },
      });
      assert.equal(created.statusCode, 201, created.body);
      const original = created.json<{ project: Project }>().project;
      assert.equal(original.archived, false);
      const path = `${base}/projects/${original.id}`;
      const added = await request({
        method: "POST", url: `${path}/notes`,
        payload: { title: "Archive needle", body: "Preserved archive content.\n  Indented." },
      });
      assert.equal(added.statusCode, 201, added.body);
      const saved = added.json<{ note: Note }>().note;
      const before = (await request({ url: path })).json<{ project: Project; notes: Note[] }>();
      const list = async (suffix = "") => {
        const response = await request({ url: `${base}/projects${suffix}` });
        assert.equal(response.statusCode, 200, response.body);
        return response.json<{ projects: Project[] }>().projects;
      };
      assert.deepEqual(await list(), [before.project]);
      assert.deepEqual(await list("?archived=true"), []);
      for (const archived of [true, false]) {
        const denied = await request({
          method: "PATCH", url: `/api/users/${other.id}/projects/${original.id}`,
          payload: { archived },
        });
        assert.equal(denied.statusCode, 404);
      }
      for (const archived of ["true", 1, null]) {
        assert.equal((await request({ method: "PATCH", url: path, payload: { archived } })).statusCode, 400);
      }
      assert.equal((await request({ url: `${base}/projects?archived=maybe` })).statusCode, 400);
      for (const archived of [true, true, false, false]) {
        const response = await request({ method: "PATCH", url: path, payload: { archived } });
        assert.equal(response.statusCode, 200, response.body);
        const expected = { ...before.project, archived };
        assert.deepEqual(response.json<{ project: Project }>().project, expected);
        assert.deepEqual(await list(), archived ? [] : [expected]);
        assert.deepEqual(await list("?archived=false"), archived ? [] : [expected]);
        assert.deepEqual(await list("?archived=true"), archived ? [expected] : []);
        assert.deepEqual((await request({ url: path })).json(), { project: expected, notes: [saved] });
        const search = await request({ url: `${base}/notes/search?q=Archive%20needle` });
        assert.equal(search.statusCode, 200);
        assert.equal(search.json<NoteSearchResponse>().notes.length, archived ? 0 : 1);
        const exported = await request({ url: `${base}/export.md` });
        assert.equal(exported.statusCode, 200);
        assert.ok(exported.body.includes("Preserved archive content."));
        const foreignList = await request({ url: `/api/users/${other.id}/projects?archived=true` });
        assert.deepEqual(foreignList.json(), { projects: [] });
      }
    });

    await t.test("creates users and lists them", async () => {
      assert.equal(owner.name, "Bartleby test owner");
      const response = await request({ url: "/api/users" });
      assert.equal(response.statusCode, 200);
      assert.ok(
        response
          .json<{ users: User[] }>()
          .users.some((user) => user.id === owner.id),
      );
    });

    await t.test(
      "rejects invalid names and malformed identifiers",
      async () => {
        for (const name of ["", " \n\t ", "x".repeat(101), 42]) {
          assert.equal(
            (
              await request({
                method: "POST",
                url: "/api/users",
                payload: { name },
              })
            ).statusCode,
            400,
          );
        }
        assert.equal(
          (await request({ url: "/api/users/not-a-uuid/projects" })).statusCode,
          400,
        );
        assert.equal(
          (await request({ url: `/api/users/${randomUUID()}/projects` }))
            .statusCode,
          404,
        );
        assert.equal(
          (
            await request({
              method: "POST",
              url: "/api/users",
              payload: { name: "valid", role: "admin" },
            })
          ).statusCode,
          400,
        );
      },
    );

    await t.test("creates and lists a project scoped to its user", async () => {
      const response = await request({
        method: "POST",
        url: `${userPath}/projects`,
        payload: { name: "  Field notes  ", description: "Some thoughts." },
      });
      assert.equal(response.statusCode, 201, response.body);
      project = response.json<{ project: Project }>().project;
      assert.equal(project.name, "Field notes");
      assert.equal(project.userId, owner.id);
      assert.equal(project.noteCount, 0);
      const own = (await request({ url: `${userPath}/projects` })).json<{
        projects: Project[];
      }>();
      assert.deepEqual(own.projects, [project]);
      const others = (
        await request({ url: `/api/users/${other.id}/projects` })
      ).json<{ projects: Project[] }>();
      assert.deepEqual(others.projects, []);
      assert.equal(
        (
          await request({
            method: "POST",
            url: `/api/users/${randomUUID()}/projects`,
            payload: { name: "Missing owner" },
          })
        ).statusCode,
        404,
      );
    });

    await t.test(
      "persists a note, preserves its text and permits an optional title",
      async () => {
        const body =
          'A thought with a quote: \'\n<script>alert("text only")</script>\n  Keep the indentation.  ';
        const response = await request({
          method: "POST",
          url: `${userPath}/projects/${project.id}/notes`,
          payload: { body },
        });
        assert.equal(response.statusCode, 201, response.body);
        note = response.json<{ note: Note }>().note;
        assert.equal(note.title, "");
        assert.equal(note.body, body);
        assert.equal(note.projectId, project.id);
        assert.ok(Number.isFinite(Date.parse(note.createdAt)));
        const fetched = (
          await request({ url: `${userPath}/projects/${project.id}` })
        ).json<{ project: Project; notes: Note[] }>();
        assert.deepEqual(fetched.notes, [note]);
        assert.equal(fetched.project.noteCount, 1);
      },
    );

    await t.test(
      "rejects blank notes, oversized content, and missing projects",
      async () => {
        const path = `${userPath}/projects/${project.id}/notes`;
        for (const body of ["", "\t\n ", "x".repeat(100001), 42]) {
          assert.equal(
            (await request({ method: "POST", url: path, payload: { body } }))
              .statusCode,
            400,
          );
        }
        assert.equal(
          (
            await request({
              method: "POST",
              url: path,
              payload: { title: "x".repeat(201), body: "valid" },
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await request({
              method: "POST",
              url: `${userPath}/projects/${randomUUID()}/notes`,
              payload: { body: "valid" },
            })
          ).statusCode,
          404,
        );
      },
    );

    await t.test(
      "renames a project and updates or clears its description without changing notes",
      async () => {
        const path = `${userPath}/projects/${project.id}`;
        const renamed = await request({
          method: "PATCH",
          url: path,
          payload: { name: "  Working notes  " },
        });
        assert.equal(renamed.statusCode, 200, renamed.body);
        let updated = renamed.json<{ project: Project }>().project;
        assert.deepEqual(updated, {
          ...project,
          name: "Working notes",
          noteCount: 1,
        });

        const described = await request({
          method: "PATCH",
          url: path,
          payload: { description: "  Ideas in progress.  " },
        });
        assert.equal(described.statusCode, 200, described.body);
        updated = described.json<{ project: Project }>().project;
        assert.equal(updated.name, "Working notes");
        assert.equal(updated.description, "Ideas in progress.");

        const cleared = await request({
          method: "PATCH",
          url: path,
          payload: { description: "" },
        });
        assert.equal(cleared.statusCode, 200, cleared.body);
        updated = cleared.json<{ project: Project }>().project;
        assert.equal(updated.description, "");
        assert.equal(updated.userId, owner.id);
        assert.equal(updated.noteCount, 1);
        const fetched = (await request({ url: path })).json<{
          project: Project;
          notes: Note[];
        }>();
        assert.deepEqual(fetched.project, updated);
        assert.deepEqual(fetched.notes, [note]);
        assert.deepEqual(
          (await request({ url: `${userPath}/projects` })).json<{
            projects: Project[];
          }>().projects,
          [updated],
        );
        project = updated;
      },
    );

    await t.test(
      "rejects invalid project edits and edits under the wrong user",
      async () => {
        const path = `${userPath}/projects/${project.id}`;
        for (const payload of [
          {},
          { name: "" },
          { name: " \n\t " },
          { name: "x".repeat(201) },
          { name: 42 },
          { description: "x".repeat(2001) },
          { description: null },
          { description: 42 },
          { name: "Valid", userId: other.id },
        ]) {
          assert.equal(
            (await request({ method: "PATCH", url: path, payload })).statusCode,
            400,
          );
        }
        const payload = { name: "Changed", description: "Changed" };
        assert.equal(
          (
            await request({
              method: "PATCH",
              url: `/api/users/${other.id}/projects/${project.id}`,
              payload,
            })
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await request({
              method: "PATCH",
              url: `${userPath}/projects/${randomUUID()}`,
              payload,
            })
          ).statusCode,
          404,
        );
        const fetched = (await request({ url: path })).json<{
          project: Project;
          notes: Note[];
        }>();
        assert.deepEqual(fetched.project, project);
        assert.deepEqual(fetched.notes, [note]);
      },
    );

    await t.test(
      "prevents mismatched user, project, and note IDs from reading or mutating notes",
      async () => {
        const wrongUser = `/api/users/${other.id}/projects/${project.id}`;
        assert.equal((await request({ url: wrongUser })).statusCode, 404);
        assert.equal(
          (
            await request({
              method: "POST",
              url: `${wrongUser}/notes`,
              payload: { body: "Nope" },
            })
          ).statusCode,
          404,
        );
        for (const method of ["PATCH", "DELETE"] as const) {
          const options =
            method === "PATCH" ? { payload: { body: "Nope" } } : {};
          assert.equal(
            (
              await request({
                method,
                url: `${wrongUser}/notes/${note.id}`,
                ...options,
              })
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await request({
                method,
                url: `${userPath}/projects/${randomUUID()}/notes/${note.id}`,
                ...options,
              })
            ).statusCode,
            404,
          );
        }
        const fetched = (
          await request({ url: `${userPath}/projects/${project.id}` })
        ).json<{ notes: Note[] }>();
        assert.equal(fetched.notes[0]?.body, note.body);
      },
    );

    await t.test(
      "edits a note and retains its creation timestamp",
      async () => {
        const response = await request({
          method: "PATCH",
          url: `${userPath}/projects/${project.id}/notes/${note.id}`,
          payload: { title: "  Revised  ", body: "An edited thought." },
        });
        assert.equal(response.statusCode, 200, response.body);
        const updated = response.json<{ note: Note }>().note;
        assert.equal(updated.title, "Revised");
        assert.equal(updated.body, "An edited thought.");
        assert.equal(updated.createdAt, note.createdAt);
        assert.ok(Date.parse(updated.updatedAt) >= Date.parse(note.updatedAt));
        const fetched = (
          await request({ url: `${userPath}/projects/${project.id}` })
        ).json<{ notes: Note[] }>();
        assert.deepEqual(fetched.notes, [updated]);
      },
    );

    await t.test("deletes a note and updates project counts", async () => {
      const path = `${userPath}/projects/${project.id}/notes/${note.id}`;
      assert.equal(
        (await request({ method: "DELETE", url: path })).statusCode,
        204,
      );
      assert.equal(
        (await request({ method: "DELETE", url: path })).statusCode,
        404,
      );
      const fetched = (
        await request({ url: `${userPath}/projects/${project.id}` })
      ).json<{ project: Project; notes: Note[] }>();
      assert.deepEqual(fetched.notes, []);
      assert.equal(fetched.project.noteCount, 0);
    });

    await t.test("moves notes between projects", async (t) => {
      const createProject = async (userId: string, name: string) => {
        const response = await request({
          method: "POST",
          url: `/api/users/${userId}/projects`,
          payload: { name },
        });
        assert.equal(response.statusCode, 201, response.body);
        return response.json<{ project: Project }>().project;
      };
      const source = await createProject(owner.id, "Move source");
      const target = await createProject(owner.id, "Move destination");
      const foreign = await createProject(other.id, "Another user's project");
      const createNote = async (
        project: Project,
        title: string,
        body: string,
      ) => {
        const response = await request({
          method: "POST",
          url: `/api/users/${project.userId}/projects/${project.id}/notes`,
          payload: { title, body },
        });
        assert.equal(response.statusCode, 201, response.body);
        return response.json<{ note: Note }>().note;
      };
      const original = await createNote(
        source,
        "A traveling thought",
        "First line\n  Keep spaces, a quote: ' and <tags>.\n",
      );
      // Distinct, fixed timestamps make preservation observable even in a fast test run.
      original.createdAt = "2020-01-02T03:04:05.000Z";
      original.updatedAt = "2021-02-03T04:05:06.000Z";
      await db.query(
        "UPDATE notes SET created_at = $2, updated_at = $3 WHERE id = $1",
        [original.id, original.createdAt, original.updatedAt],
      );
      const existing = await createNote(
        target,
        "Already here",
        "Leave this note alone.",
      );
      const foreignNote = await createNote(
        foreign,
        "Private to the other user",
        "Keep this project relationship.",
      );
      const getProject = async (project: Project) => {
        const response = await request({
          url: `/api/users/${project.userId}/projects/${project.id}`,
        });
        assert.equal(response.statusCode, 200, response.body);
        return response.json<{ project: Project; notes: Note[] }>();
      };
      const snapshot = async () => [
        await getProject(source),
        await getProject(target),
        await getProject(foreign),
      ];
      const movePath = (userId: string, projectId: string, noteId: string) =>
        `/api/users/${userId}/projects/${projectId}/notes/${noteId}/move`;
      const moved = { ...original, projectId: target.id };

      await t.test(
        "preserves the existing note and updates both project lists and counts",
        async () => {
          assert.deepEqual((await getProject(source)).notes, [original]);
          const response = await request({
            method: "POST",
            url: movePath(owner.id, source.id, original.id),
            payload: { targetProjectId: target.id },
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(response.json<{ note: Note }>(), { note: moved });
          assert.deepEqual(await getProject(source), {
            project: { ...source, noteCount: 0 },
            notes: [],
          });
          assert.deepEqual(await getProject(target), {
            project: { ...target, noteCount: 2 },
            notes: [existing, moved],
          });
          const projects = (
            await request({ url: `${userPath}/projects` })
          ).json<{ projects: Project[] }>().projects;
          assert.equal(
            projects.find((project) => project.id === source.id)?.noteCount,
            0,
          );
          assert.equal(
            projects.find((project) => project.id === target.id)?.noteCount,
            2,
          );
          assert.deepEqual((await getProject(foreign)).notes, [foreignNote]);
        },
      );

      await t.test(
        "treats moving to the current project as a successful no-op",
        async () => {
          const before = await snapshot();
          const response = await request({
            method: "POST",
            url: movePath(owner.id, target.id, moved.id),
            payload: { targetProjectId: target.id },
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.deepEqual(response.json<{ note: Note }>(), { note: moved });
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        "rejects missing or mismatched users, source projects, notes, and destinations without mutation",
        async () => {
          const before = await snapshot();
          const cases = [
            {
              userId: randomUUID(),
              projectId: target.id,
              noteId: moved.id,
              targetProjectId: source.id,
            },
            {
              userId: other.id,
              projectId: target.id,
              noteId: moved.id,
              targetProjectId: foreign.id,
            },
            {
              userId: owner.id,
              projectId: source.id,
              noteId: moved.id,
              targetProjectId: source.id,
            },
            {
              userId: owner.id,
              projectId: randomUUID(),
              noteId: moved.id,
              targetProjectId: source.id,
            },
            {
              userId: owner.id,
              projectId: foreign.id,
              noteId: foreignNote.id,
              targetProjectId: source.id,
            },
            {
              userId: owner.id,
              projectId: target.id,
              noteId: foreignNote.id,
              targetProjectId: source.id,
            },
            {
              userId: owner.id,
              projectId: target.id,
              noteId: randomUUID(),
              targetProjectId: source.id,
            },
            {
              userId: owner.id,
              projectId: target.id,
              noteId: moved.id,
              targetProjectId: randomUUID(),
            },
            {
              userId: owner.id,
              projectId: target.id,
              noteId: moved.id,
              targetProjectId: foreign.id,
            },
          ];
          for (const { userId, projectId, noteId, targetProjectId } of cases) {
            const response = await request({
              method: "POST",
              url: movePath(userId, projectId, noteId),
              payload: { targetProjectId },
            });
            assert.equal(response.statusCode, 404, response.body);
            assert.deepEqual(response.json(), {
              message: "Note or project not found.",
            });
            assert.deepEqual(await snapshot(), before);
          }
        },
      );

      await t.test(
        "rejects malformed identifiers and move bodies without mutation",
        async () => {
          const before = await snapshot();
          const url = movePath(owner.id, target.id, moved.id);
          for (const payload of [
            {},
            { targetProjectId: "" },
            { targetProjectId: "not-a-uuid" },
            { targetProjectId: 42 },
            { targetProjectId: null },
            { targetProjectId: [source.id] },
            { targetProjectId: source.id, title: "Unexpected edit" },
            { targetProjectId: source.id, body: "Unexpected edit" },
            [],
          ]) {
            const response = await request({ method: "POST", url, payload });
            assert.equal(response.statusCode, 400, response.body);
            assert.deepEqual(await snapshot(), before);
          }
          assert.equal(
            (await request({ method: "POST", url })).statusCode,
            400,
          );
          for (const payload of ["null", "{", "42", '"a string"']) {
            const response = await request({
              method: "POST",
              url,
              headers: { "content-type": "application/json" },
              payload,
            });
            assert.equal(response.statusCode, 400, response.body);
          }
          for (const path of [
            movePath("not-a-uuid", target.id, moved.id),
            movePath(owner.id, "not-a-uuid", moved.id),
            movePath(owner.id, target.id, "not-a-uuid"),
          ]) {
            assert.equal(
              (
                await request({
                  method: "POST",
                  url: path,
                  payload: { targetProjectId: source.id },
                })
              ).statusCode,
              400,
            );
          }
          assert.deepEqual(await snapshot(), before);
        },
      );
    });

    await t.test(
      "searches saved notes across the current user projects",
      async (t) => {
        const searchUser = await createUser("Search test owner");
        const searchPath = `/api/users/${searchUser.id}/notes/search`;
        const first = (
          await db.query<{ id: string }>(
            "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id",
            [searchUser.id, "Field notes"],
          )
        ).rows[0]!;
        const second = (
          await db.query<{ id: string }>(
            "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id",
            [searchUser.id, "Reading room"],
          )
        ).rows[0]!;
        const foreign = (
          await db.query<{ id: string }>(
            "INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id",
            [other.id, "Another user"],
          )
        ).rows[0]!;
        const insert = async (
          projectId: string,
          title: string,
          body: string,
          createdAt: string,
        ) =>
          (
            await db.query<{ id: string }>(
              "INSERT INTO notes (project_id, title, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
              [projectId, title, body, createdAt],
            )
          ).rows[0]!;
        const titleMatch = await insert(
          first.id,
          "Needle in a notebook",
          "A quiet thought.",
          "2020-01-01",
        );
        const bodyMatch = await insert(
          second.id,
          "",
          `${"An ordinary sentence. ".repeat(30)}The NEEDLE is here.`,
          "2020-01-02",
        );
        await insert(
          first.id,
          "Unrelated",
          "A thought about the sea.",
          "2020-01-03",
        );
        await insert(
          foreign.id,
          "Needle from someone else",
          "NEEDLE in another user project.",
          "2020-01-04",
        );
        const literal = await insert(
          second.id,
          "100% _done! \\ a quote: '",
          "Literal punctuation.",
          "2020-01-05",
        );
        const searchFor = async (query: string) => {
          const response = await request({
            url: `${searchPath}?q=${encodeURIComponent(query)}`,
          });
          assert.equal(response.statusCode, 200, response.body);
          return response.json<NoteSearchResponse>();
        };

        await t.test(
          "matches titles and full bodies case-insensitively with project names and useful excerpts",
          async () => {
            const response = await searchFor("  nEeDlE  ");
            assert.deepEqual(
              response.notes.map(({ id }) => id),
              [bodyMatch.id, titleMatch.id],
            );
            assert.deepEqual(
              response.notes.map(({ projectId, projectName, title }) => ({
                projectId,
                projectName,
                title,
              })),
              [
                {
                  projectId: second.id,
                  projectName: "Reading room",
                  title: "",
                },
                {
                  projectId: first.id,
                  projectName: "Field notes",
                  title: "Needle in a notebook",
                },
              ],
            );
            assert.match(
              response.notes[0]!.excerpt,
              /^….*The NEEDLE is here\.$/,
            );
            assert.ok(response.notes[0]!.excerpt.length <= 242);
            assert.equal(response.notes[1]!.excerpt, "A quiet thought.");
            assert.equal(response.hasMore, false);
            assert.deepEqual(await searchFor("nothing-matches-this-phrase"), {
              notes: [],
              hasMore: false,
            });
          },
        );

        await t.test(
          "treats punctuation and SQL wildcards literally",
          async () => {
            for (const query of ["%", "_", "!", "\\", "'"]) {
              assert.deepEqual(
                (await searchFor(query)).notes.map(({ id }) => id),
                [literal.id],
              );
            }
            assert.deepEqual(await searchFor("' OR 1=1 --"), {
              notes: [],
              hasMore: false,
            });
          },
        );

        await t.test(
          "validates searches and returns an empty result for a user without notes",
          async () => {
            const empty = await createUser("Empty search test user");
            assert.deepEqual(
              (
                await request({
                  url: `/api/users/${empty.id}/notes/search?q=needle`,
                })
              ).json(),
              { notes: [], hasMore: false },
            );
            for (const suffix of [
              "",
              "?q=",
              "?q=%20%09",
              `?q=${"x".repeat(201)}`,
              "?q=one&q=two",
              "?q=needle&userId=another-user",
            ]) {
              assert.equal(
                (await request({ url: `${searchPath}${suffix}` })).statusCode,
                400,
                suffix,
              );
            }
            assert.equal(
              (
                await request({
                  url: "/api/users/not-a-uuid/notes/search?q=needle",
                })
              ).statusCode,
              400,
            );
            assert.equal(
              (
                await request({
                  url: `/api/users/${randomUUID()}/notes/search?q=needle`,
                })
              ).statusCode,
              404,
            );
          },
        );

        await t.test(
          "bounds broad searches and keeps the newest matches first",
          async () => {
            await db.query(
              `INSERT INTO notes (project_id, title, body, created_at)
          SELECT $1, 'Search batch ' || value, 'A batch note.', '2022-01-01'::timestamptz + value * interval '1 second'
          FROM generate_series(1, 51) AS value`,
              [first.id],
            );
            const response = await searchFor("Search batch");
            assert.equal(response.hasMore, true);
            assert.equal(response.notes.length, 50);
            assert.equal(response.notes[0]!.title, "Search batch 51");
            assert.equal(response.notes[49]!.title, "Search batch 2");
          },
        );
      },
    );

    await t.test(
      "database constraints reject orphaned projects and whitespace-only notes",
      async () => {
        await db.query("SAVEPOINT constraint_test");
        await assert.rejects(
          db.query("INSERT INTO projects (user_id, name) VALUES ($1, $2)", [
            randomUUID(),
            "Orphan",
          ]),
          { code: "23503" },
        );
        await db.query("ROLLBACK TO SAVEPOINT constraint_test");
        await assert.rejects(
          db.query("INSERT INTO notes (project_id, body) VALUES ($1, $2)", [
            project.id,
            "\n\t ",
          ]),
          { code: "23514" },
        );
        await db.query("ROLLBACK TO SAVEPOINT constraint_test");
        await db.query("RELEASE SAVEPOINT constraint_test");
      },
    );
  } finally {
    await app.close();
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
});
