import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { checkMigrations } from "./check-migrations.js";
import type { Database } from "./queries.js";

test("Node version guard gives actionable errors before commands run", () => {
  for (const version of ["21.3.0", "24.16.0", "25.0.0"]) {
    const source = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} }); await import(${JSON.stringify(pathToFileURL(resolve("scripts/check-node.mjs")).href)});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8",
    });
    assert.equal(result.status, version.startsWith("24.") ? 0 : 1);
    if (version.startsWith("24.")) {
      assert.equal(result.stderr, "");
    } else {
      assert.match(result.stderr, /requires Node\.js 24/);
      assert.ok(result.stderr.includes(version));
      assert.match(result.stderr, /nvm use/);
    }
  }
});

test("startup migration check rejects pending schemas without changing them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bartleby-migration-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "100_initial.sql"), "-- fixture");
  await writeFile(join(directory, "200_archive.sql"), "-- fixture");
  await writeFile(join(directory, "README.md"), "Not a migration.");
  await writeFile(join(directory, ".scratch.sql"), "Ignored by node-pg-migrate.");

  const database = (exists: boolean, applied: string[]) => {
    const statements: string[] = [];
    const db = {
      async query(sql: string) {
        statements.push(sql);
        assert.match(sql, /^SELECT /, "Startup must only read database state.");
        return sql.includes("to_regclass")
          ? { rows: [{ exists }] }
          : { rows: applied.map((name) => ({ name })) };
      },
    } as unknown as Database;
    return { db, statements };
  };

  await t.test("fresh database points to the migration command", async () => {
    const { db, statements } = database(false, []);
    await assert.rejects(
      checkMigrations(db, directory),
      /pending migrations: 100_initial, 200_archive.*npm run db:migrate/,
    );
    assert.equal(statements.length, 1, "Missing ledger must not be queried or created.");
  });

  await t.test("partially migrated database reports only missing migrations", async () => {
    const { db } = database(true, ["100_initial"]);
    await assert.rejects(
      checkMigrations(db, directory),
      /pending migrations: 200_archive\. Run "npm run db:migrate"/,
    );
  });

  await t.test("fully migrated database passes", async () => {
    const { db } = database(true, ["100_initial", "200_archive"]);
    await checkMigrations(db, directory);
  });

  await t.test("missing migration files cannot silently mark startup ready", async () => {
    const empty = await mkdtemp(join(tmpdir(), "bartleby-empty-migrations-"));
    t.after(() => rm(empty, { recursive: true, force: true }));
    const { db, statements } = database(true, []);
    await assert.rejects(checkMigrations(db, empty), /No SQL migrations found/);
    assert.equal(statements.length, 0);
  });
});
