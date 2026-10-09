import { readdir } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Database } from "./queries.js";

// Startup only inspects the migration ledger; applying migrations is an explicit command.
export async function checkMigrations(db: Database, directory = "migrations") {
  const files = await readdir(directory, { withFileTypes: true });
  const names = files
    .filter(
      (file) =>
        (file.isFile() || file.isSymbolicLink()) &&
        !file.name.startsWith(".") &&
        file.name.endsWith(".sql"),
    )
    .map((file) => basename(file.name, extname(file.name)))
    .sort();
  if (names.length === 0) {
    throw new Error(
      "No SQL migrations found. Start Bartleby from the project directory with its migrations folder present.",
    );
  }

  const table = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('public.pgmigrations') IS NOT NULL AS exists",
  );
  const applied = table.rows[0]?.exists
    ? (await db.query<{ name: string }>("SELECT name FROM public.pgmigrations"))
        .rows.map((row) => row.name)
    : [];
  const pending = names.filter((name) => !applied.includes(name));
  if (pending.length > 0) {
    throw new Error(
      `Database has pending migrations: ${pending.join(", ")}. Run "npm run db:migrate", then restart Bartleby.`,
    );
  }
}
