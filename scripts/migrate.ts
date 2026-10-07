import { runner } from "node-pg-migrate";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required. See .env.example.");

await runner({
  databaseUrl: process.env.DATABASE_URL,
  dir: "migrations",
  direction: "up",
  migrationsTable: "pgmigrations",
  singleTransaction: true,
  checkOrder: true,
});
