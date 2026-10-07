import type { Note } from "../shared/types.js";
import type { UserExport } from "./queries.js";

function escapeMarkdown(text: string) {
  return text.replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&");
}

function headingText(text: string) {
  return escapeMarkdown(text.replace(/[\r\n]+/g, " "));
}

function fencedBody(body: string) {
  const longestFence = Math.max(
    2,
    ...Array.from(body.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longestFence + 1);
  return `${fence}text\n${body}${body.endsWith("\n") ? "" : "\n"}${fence}`;
}

function renderNote(note: Note) {
  return [
    `### ${headingText(note.title || "Untitled note")}`,
    "",
    `Created: ${note.createdAt}`,
    `Last updated: ${note.updatedAt}`,
    "",
    fencedBody(note.body),
  ].join("\n");
}

export function renderMarkdownExport(data: UserExport) {
  const sections = data.projects.map((project) => {
    const lines = [`## ${headingText(project.name)}`, ""];
    if (project.description) {
      lines.push(
        ...project.description
          .split(/\r?\n/)
          .map((line) => `> ${escapeMarkdown(line)}`),
        "",
      );
    }
    if (project.notes.length) {
      lines.push(project.notes.map(renderNote).join("\n\n"));
    } else {
      lines.push("No notes yet.");
    }
    return lines.join("\n");
  });

  return [
    "# Bartleby export",
    "",
    `Exported for ${headingText(data.name)} on ${new Date().toISOString()}.`,
    "",
    ...(sections.length ? sections : ["No projects yet."]),
    "",
  ].join("\n");
}
