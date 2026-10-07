import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required. See .env.example.");
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
});
const app = buildApp(db, true);
db.on("error", (error) =>
  app.log.error(error, "Idle PostgreSQL connection error"),
);
app.addHook("onClose", async () => {
  await db.end();
});

const clientRoot = resolve("dist/client");
if (existsSync(clientRoot))
  await app.register(fastifyStatic, { root: clientRoot });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await db.query("SELECT 1");
  await app.listen({
    port: Number(process.env.PORT ?? 3001),
    host: "127.0.0.1",
  });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
