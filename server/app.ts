import Fastify from "fastify";
import type { NoteInput, ProjectInput } from "../shared/types.js";
import * as queries from "./queries.js";
import { renderMarkdownExport } from "./markdown.js";

type UserParams = { userId: string };
type ProjectParams = UserParams & { projectId: string };
type NoteParams = ProjectParams & { noteId: string };
type ProjectListQuery = { archived?: "true" | "false" };
type ProjectUpdate = Partial<ProjectInput> & { archived?: boolean };
const uuid = { type: "string", format: "uuid" };
const userParams = {
  type: "object",
  required: ["userId"],
  properties: { userId: uuid },
};
const projectParams = {
  type: "object",
  required: ["userId", "projectId"],
  properties: { userId: uuid, projectId: uuid },
};
const noteParams = {
  type: "object",
  required: ["userId", "projectId", "noteId"],
  properties: { userId: uuid, projectId: uuid, noteId: uuid },
};
const projectProperties = {
  name: { type: "string", maxLength: 200, pattern: "\\S" },
  description: { type: "string", maxLength: 2000 },
};
const noteBody = {
  type: "object",
  required: ["body"],
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 200, default: "" },
    body: { type: "string", maxLength: 100000, pattern: "\\S" },
  },
};
const projectPath = "/api/users/:userId/projects/:projectId";

export function buildApp(db: queries.Database, logger = false) {
  const app = Fastify({
    logger,
    bodyLimit: 512 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Error && "validation" in error && error.validation)
      return reply
        .code(400)
        .send({ message: `Check your input: ${error.message}` });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    request.log.error(error);
    return reply
      .code(500)
      .send({ message: "Something went wrong. Please try again." });
  });

  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return { status: "ok" };
  });

  app.get("/api/users", async () => ({ users: await queries.listUsers(db) }));

  app.post<{ Body: { name: string } }>(
    "/api/users",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", maxLength: 100, pattern: "\\S" },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await queries.createUser(db, request.body.name.trim());
      return reply.code(201).send({ user });
    },
  );

  app.get<{ Params: UserParams; Querystring: ProjectListQuery }>(
    "/api/users/:userId/projects",
    {
      schema: {
        params: userParams,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { archived: { type: "string", enum: ["true", "false"] } },
        },
      },
    },
    async (request, reply) => {
      if (!(await queries.userExists(db, request.params.userId)))
        return reply.code(404).send({ message: "User not found." });
      return {
        projects: await queries.listProjects(
          db,
          request.params.userId,
          request.query.archived === "true",
        ),
      };
    },
  );

  app.get<{ Params: UserParams }>(
    "/api/users/:userId/export.md",
    { schema: { params: userParams } },
    async (request, reply) => {
      const data = await queries.getUserExport(db, request.params.userId);
      if (!data) return reply.code(404).send({ message: "User not found." });
      return reply
        .type("text/markdown; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="bartleby-export.md"')
        .send(renderMarkdownExport(data));
    },
  );

  app.get<{ Params: UserParams; Querystring: { q: string } }>(
    "/api/users/:userId/notes/search",
    {
      schema: {
        params: userParams,
        querystring: {
          type: "object",
          required: ["q"],
          additionalProperties: false,
          properties: { q: { type: "string", maxLength: 200, pattern: "\\S" } },
        },
      },
    },
    async (request, reply) => {
      if (!(await queries.userExists(db, request.params.userId)))
        return reply.code(404).send({ message: "User not found." });
      return queries.searchNotes(
        db,
        request.params.userId,
        request.query.q.trim(),
      );
    },
  );

  app.post<{ Params: UserParams; Body: ProjectInput }>(
    "/api/users/:userId/projects",
    {
      schema: {
        params: userParams,
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            ...projectProperties,
            description: { ...projectProperties.description, default: "" },
          },
        },
      },
    },
    async (request, reply) => {
      const project = await queries.createProject(
        db,
        request.params.userId,
        request.body.name.trim(),
        request.body.description.trim(),
      );
      if (!project) return reply.code(404).send({ message: "User not found." });
      return reply.code(201).send({ project });
    },
  );

  app.get<{ Params: ProjectParams }>(
    projectPath,
    { schema: { params: projectParams } },
    async (request, reply) => {
      const project = await queries.getProject(
        db,
        request.params.userId,
        request.params.projectId,
      );
      if (!project)
        return reply.code(404).send({ message: "Project not found." });
      return { project, notes: await queries.listNotes(db, project.id) };
    },
  );

  app.patch<{ Params: ProjectParams; Body: ProjectUpdate }>(
    projectPath,
    {
      schema: {
        params: projectParams,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: { ...projectProperties, archived: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const project = await queries.updateProject(
        db,
        request.params.userId,
        request.params.projectId,
        {
          name: request.body.name?.trim(),
          description: request.body.description?.trim(),
          archived: request.body.archived,
        },
      );
      if (!project)
        return reply.code(404).send({ message: "Project not found." });
      return { project };
    },
  );

  app.post<{ Params: ProjectParams; Body: NoteInput }>(
    `${projectPath}/notes`,
    {
      schema: { params: projectParams, body: noteBody },
    },
    async (request, reply) => {
      const note = await queries.createNote(
        db,
        request.params.userId,
        request.params.projectId,
        {
          title: request.body.title.trim(),
          body: request.body.body,
        },
      );
      if (!note) return reply.code(404).send({ message: "Project not found." });
      return reply.code(201).send({ note });
    },
  );

  app.patch<{ Params: NoteParams; Body: NoteInput }>(
    `${projectPath}/notes/:noteId`,
    {
      schema: { params: noteParams, body: noteBody },
    },
    async (request, reply) => {
      const note = await queries.updateNote(
        db,
        request.params.userId,
        request.params.projectId,
        request.params.noteId,
        {
          title: request.body.title.trim(),
          body: request.body.body,
        },
      );
      if (!note) return reply.code(404).send({ message: "Note not found." });
      return { note };
    },
  );

  app.post<{ Params: NoteParams; Body: { targetProjectId: string } }>(
    `${projectPath}/notes/:noteId/move`,
    {
      schema: {
        params: noteParams,
        body: {
          type: "object",
          required: ["targetProjectId"],
          additionalProperties: false,
          properties: { targetProjectId: uuid },
        },
      },
    },
    async (request, reply) => {
      const note = await queries.moveNote(
        db,
        request.params.userId,
        request.params.projectId,
        request.params.noteId,
        request.body.targetProjectId,
      );
      if (!note)
        return reply.code(404).send({ message: "Note or project not found." });
      return { note };
    },
  );

  app.delete<{ Params: NoteParams }>(
    `${projectPath}/notes/:noteId`,
    { schema: { params: noteParams } },
    async (request, reply) => {
      const deleted = await queries.deleteNote(
        db,
        request.params.userId,
        request.params.projectId,
        request.params.noteId,
      );
      if (!deleted) return reply.code(404).send({ message: "Note not found." });
      return reply.code(204).send();
    },
  );

  return app;
}
