import { randomUUID } from "node:crypto";
import pg from "pg";
import { test as base, expect } from "@playwright/test";

// A unique user keeps the browser run separate from real projects. Teardown
// removes only this user's records, including after a failed assertion.
const test = base.extend<{ userName: string }>({
  userName: async ({ page }, use) => {
    const name = `Browser smoke ${randomUUID()}`;
    try {
      await use(name);
    } finally {
      await page.close();
      const db = new pg.Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
      });
      await db.connect();
      try {
        await db.query("BEGIN");
        const users = await db.query<{ id: string }>(
          "SELECT id FROM users WHERE name = $1 FOR UPDATE",
          [name],
        );
        for (const { id } of users.rows) {
          await db.query(
            "DELETE FROM notes n USING projects p WHERE n.project_id = p.id AND p.user_id = $1",
            [id],
          );
          await db.query("DELETE FROM projects WHERE user_id = $1", [id]);
          await db.query("DELETE FROM users WHERE id = $1", [id]);
        }
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await db.end();
      }
    }
  },
});

test("search titles and bodies, open the matching note, and refresh results after editing", async ({
  page,
  userName,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Field notes");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();

  const composer = page.getByRole("form", { name: "New note", exact: true });
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill("A lighthouse idea");
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("A small building beside the sea.");
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Reading room");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const longBody = `${"An ordinary sentence. ".repeat(30)}The LIGHTHOUSE appears near the end.\n  Keep this indentation.`;
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill(longBody);
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill("An unrelated note");
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("The latest thought in this project.");
  await composer.getByRole("button", { name: "Add note", exact: true }).click();

  const search = page.getByRole("search", { name: "Notes", exact: true });
  await expect(
    search.getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("An unfinished draft.");
  await search
    .getByRole("searchbox", { name: "Search notes", exact: true })
    .fill("  lighthouse  ");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    composer.getByLabel("What’s on your mind?", { exact: true }),
  ).toHaveValue("An unfinished draft.");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();

  const results = page.getByRole("list", {
    name: "Search results",
    exact: true,
  });
  await expect(
    page.getByRole("heading", { name: "Search notes", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("2 notes found.");
  await expect(results.getByRole("button")).toHaveCount(2);
  await expect(
    results.getByRole("button").filter({ hasText: "Field notes" }),
  ).toContainText("A lighthouse idea");
  await expect(
    results.getByRole("button").filter({ hasText: "Reading room" }),
  ).toContainText("The LIGHTHOUSE appears near the end.");
  await results.getByRole("button").filter({ hasText: "Reading room" }).click();
  const opened = page.getByRole("article", {
    name: "Untitled note",
    exact: true,
  });
  await expect(opened).toBeFocused();
  await expect(opened).toBeInViewport();
  await expect(opened.locator(".note-body")).toHaveJSProperty(
    "textContent",
    longBody,
  );
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toHaveText("Reading room");

  await opened.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("form", { name: "Edit note", exact: true });
  await editor
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("An edited thought with a different subject.");
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "← Back to search results", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("1 note found.");
  await expect(results.getByRole("button")).toHaveCount(1);
  await results.getByRole("button").click();
  await expect(
    page.getByRole("article", { name: "A lighthouse idea", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toHaveText("Field notes");

  await search
    .getByRole("searchbox", { name: "Search notes", exact: true })
    .fill("a phrase with no matches");
  await search
    .getByRole("searchbox", { name: "Search notes", exact: true })
    .press("Enter");
  await expect(page.getByRole("status")).toHaveText(
    "No matching notes. Try another word or phrase.",
  );
  await expect(results.getByRole("button")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("search can retry a failed request and leave a pending search safely", async ({
  page,
  userName,
}) => {
  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Field notes");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const search = page.getByRole("search", { name: "Notes", exact: true });
  await page.route(
    "**/api/users/*/notes/search?*",
    (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Search is temporarily unavailable." },
      }),
    { times: 1 },
  );
  await search
    .getByRole("searchbox", { name: "Search notes", exact: true })
    .fill("needle");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Search is temporarily unavailable.",
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "No matching notes. Try another word or phrase.",
  );

  let releaseRequest: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    "**/api/users/*/notes/search?*",
    async (route) => {
      await waiting;
      await route.fulfill({ json: { notes: [], hasMore: false } });
    },
    { times: 1 },
  );
  try {
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Searching your notes…");
    await search
      .getByRole("searchbox", { name: "Search notes", exact: true })
      .fill("another phrase");
    await search.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "No matching notes. Try another word or phrase.",
    );
    releaseRequest();
    await expect(
      page.getByText("Results for “another phrase” across your projects.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(
      "No matching notes. Try another word or phrase.",
    );
  } finally {
    releaseRequest();
  }
});

test("capture, refresh, edit a project and note, then delete the note", async ({
  page,
  userName,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveTitle("Bartleby — projects & notes");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Field notes");
  await page
    .getByLabel("Description (optional)", { exact: true })
    .fill("Some thoughts.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toBeVisible();

  const composer = page.getByRole("form", { name: "New note", exact: true });
  await expect(
    composer.getByRole("button", { name: "Add note", exact: true }),
  ).toBeDisabled();
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill("A thought");
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("An idea worth keeping.\n  With its indentation.");

  // Opening the project editor must not silently lose a note draft.
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    composer.getByLabel("What’s on your mind?", { exact: true }),
  ).toHaveValue("An idea worth keeping.\n  With its indentation.");
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A thought", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toContainText(
    "An idea worth keeping.",
  );

  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  const projectForm = page.getByRole("form", {
    name: "Edit project",
    exact: true,
  });
  await expect(
    projectForm.getByLabel("Project name", { exact: true }),
  ).toHaveValue("Field notes");
  await expect(
    projectForm.getByLabel("Description (optional)", { exact: true }),
  ).toHaveValue("Some thoughts.");
  await expect(
    projectForm.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await projectForm.getByLabel("Project name", { exact: true }).fill("  ");
  await expect(
    projectForm.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();

  // Cancelling an edit preserves the saved project and asks before discarding.
  await projectForm
    .getByLabel("Project name", { exact: true })
    .fill("Unfinished rename");
  await projectForm
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    projectForm.getByLabel("Project name", { exact: true }),
  ).toHaveValue("Unfinished rename");
  await projectForm
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await projectForm
    .getByLabel("Project name", { exact: true })
    .fill("Working notes");
  await projectForm
    .getByLabel("Description (optional)", { exact: true })
    .fill("Ideas in progress.");
  await projectForm
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Working notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ideas in progress.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notes 1", exact: true }),
  ).toBeVisible();

  if (testInfo.project.name === "mobile") {
    await expect(
      page
        .getByRole("combobox", { name: "Project", exact: true })
        .locator("option:checked"),
    ).toHaveText("Working notes (1)");
  } else {
    await expect(
      page.getByRole("button", { name: "Working notes 1", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Working notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Ideas in progress.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A thought", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const noteForm = page.getByRole("form", { name: "Edit note", exact: true });
  await noteForm
    .getByLabel("Title (optional)", { exact: true })
    .fill("A revised thought");
  await noteForm
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("Saved again.");
  await noteForm
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A revised thought", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toContainText("Saved again.");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Keep note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A revised thought", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Notes 0", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("No notes yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("move a note between projects without losing its contents or an unfinished draft", async ({
  page,
  userName,
}, testInfo) => {
  const noteTitle = "A thought to revisit";
  const noteBody =
    "An idea worth keeping.\n  With its indentation.\nAnd another line.";
  const draftTitle = "Still thinking";
  const draftBody = "This draft stays in Field notes.";
  const pageErrors: string[] = [];
  let moveRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/move")
    )
      moveRequests += 1;
  });

  async function expectProjectCount(name: string, count: number) {
    if (testInfo.project.name === "mobile") {
      await expect(
        page
          .getByRole("combobox", { name: "Project", exact: true })
          .locator("option"),
      ).toContainText([`${name} (${count})`]);
    } else {
      await expect(
        page.getByRole("button", { name: `${name} ${count}`, exact: true }),
      ).toBeVisible();
    }
  }

  async function selectProject(name: string, count: number) {
    if (testInfo.project.name === "mobile") {
      await page
        .getByRole("combobox", { name: "Project", exact: true })
        .selectOption({ label: `${name} (${count})` });
    } else {
      await page
        .getByRole("button", { name: `${name} ${count}`, exact: true })
        .click();
    }
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }

  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Field notes");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const composer = page.getByRole("form", { name: "New note", exact: true });
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill(noteTitle);
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill(noteBody);
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  const note = page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: noteTitle, exact: true }),
    });
  await expect(note).toBeVisible();
  const createdAt = await note.locator("time").getAttribute("datetime");
  const lastSaved = await note.locator("time").getAttribute("title");

  await note
    .getByRole("button", { name: "Move to project…", exact: true })
    .click();
  const moveForm = page.getByRole("form", { name: "Move note", exact: true });
  await expect(
    moveForm.getByText("Create another project to move this note.", {
      exact: true,
    }),
  ).toBeVisible();
  await moveForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(moveForm).toHaveCount(0);
  await expect(note).toBeVisible();
  await expect(
    note.getByRole("button", { name: "Move to project…", exact: true }),
  ).toBeFocused();

  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Reading room");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toBeVisible();
  await selectProject("Field notes", 1);
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill(draftTitle);
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill(draftBody);

  await note
    .getByRole("button", { name: "Move to project…", exact: true })
    .click();
  const destination = moveForm.getByLabel("Destination project", {
    exact: true,
  });
  await expect(destination.locator("option")).toHaveText([
    "Choose a project",
    "Reading room",
  ]);
  await expect(
    moveForm.getByRole("button", { name: "Move note", exact: true }),
  ).toBeDisabled();
  await destination.selectOption({ label: "Reading room" });
  await expect(
    moveForm.getByRole("button", { name: "Move note", exact: true }),
  ).toBeEnabled();
  await expectProjectCount("Field notes", 1);
  await expectProjectCount("Reading room", 0);
  expect(moveRequests).toBe(0);
  await moveForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(moveForm).toHaveCount(0);
  await expect(note).toBeVisible();

  // A failed request keeps the saved note, destination, and unrelated draft available for retry.
  await page.route(
    "**/api/users/*/projects/*/notes/*/move",
    (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Move temporarily unavailable. Please try again." },
      }),
    { times: 1 },
  );
  await note
    .getByRole("button", { name: "Move to project…", exact: true })
    .click();
  await destination.selectOption({ label: "Reading room" });
  await moveForm
    .getByRole("button", { name: "Move note", exact: true })
    .click();
  await expect(moveForm.getByRole("alert")).toHaveText(
    "Move temporarily unavailable. Please try again.",
  );
  await expect(destination.locator("option:checked")).toHaveText(
    "Reading room",
  );
  await expect(note).toBeVisible();
  await expectProjectCount("Field notes", 1);
  await expectProjectCount("Reading room", 0);
  await expect(
    composer.getByLabel("Title (optional)", { exact: true }),
  ).toHaveValue(draftTitle);
  await expect(
    composer.getByLabel("What’s on your mind?", { exact: true }),
  ).toHaveValue(draftBody);

  await moveForm
    .getByRole("button", { name: "Move note", exact: true })
    .click();
  const moveNotice = page
    .getByRole("status")
    .filter({ hasText: "Moved to Reading room." });
  await expect(moveNotice).toHaveText("Moved to Reading room.");
  await expect(moveNotice).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notes 0", exact: true }),
  ).toBeVisible();
  await expect(note).toHaveCount(0);
  await expectProjectCount("Field notes", 0);
  await expectProjectCount("Reading room", 1);
  await expect(
    composer.getByLabel("Title (optional)", { exact: true }),
  ).toHaveValue(draftTitle);
  await expect(
    composer.getByLabel("What’s on your mind?", { exact: true }),
  ).toHaveValue(draftBody);
  expect(moveRequests).toBe(2);

  // Clear only the test's unsaved draft before checking persisted source and destination views.
  await composer.getByLabel("Title (optional)", { exact: true }).fill("");
  await composer.getByLabel("What’s on your mind?", { exact: true }).fill("");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Field notes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No notes yet.", { exact: true })).toBeVisible();
  await expectProjectCount("Field notes", 0);
  await expectProjectCount("Reading room", 1);
  await selectProject("Reading room", 1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reading room", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Notes 1", exact: true }),
  ).toBeVisible();
  await expect(note).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(note.locator(".note-body")).toHaveJSProperty(
    "textContent",
    noteBody,
  );
  await expect(note.locator("time")).toHaveAttribute("datetime", createdAt!);
  await expect(note.locator("time")).toHaveAttribute("title", lastSaved!);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("archive and restore a project without losing notes or silently discarding a draft", async ({
  page, userName,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page).toHaveTitle("Bartleby — projects & notes");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Completed ideas");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  const composer = page.getByRole("form", { name: "New note", exact: true });
  await composer.getByLabel("Title (optional)", { exact: true }).fill("Keep this thought");
  await composer.getByLabel("What’s on your mind?", { exact: true }).fill("Saved text.\n  Keep the indentation.");
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByRole("article", { name: "Keep this thought" })).toBeVisible();
  await composer.getByLabel("What’s on your mind?", { exact: true }).fill("Unfinished thought.");
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(composer.getByLabel("What’s on your mind?", { exact: true })).toHaveValue("Unfinished thought.");
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archived projects 1", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Archived projects 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archived projects", exact: true })).toBeVisible();
  await expect(page.locator(".archive-list")).toContainText("Completed ideas");
  await expect(page.locator(".project-navigation .project-list")).not.toContainText("Completed ideas");
  await page.screenshot({ path: testInfo.outputPath("archive.png") });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Completed ideas", exact: true })).toBeVisible();
  await expect(page.getByRole("article").locator(".note-body")).toHaveText("Saved text.\n  Keep the indentation.");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Completed ideas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archived projects 0", exact: true }).click();
  await expect(page.getByText("No archived projects.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("sort notes by recent edits, preserve drafts, and remember the choice after reload", async ({
  page, userName,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Working ideas");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  const composer = page.getByRole("form", { name: "New note", exact: true });
  for (const title of ["Older idea", "Newer idea"]) {
    await composer.getByLabel("Title (optional)", { exact: true }).fill(title);
    await composer.getByLabel("What’s on your mind?", { exact: true }).fill(`Text for ${title}.`);
    await composer.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(page.getByRole("article", { name: title, exact: true })).toBeVisible();
  }
  const titles = page.locator(".note-list h3");
  const sort = page.getByRole("combobox", { name: "Sort notes", exact: true });
  await expect(sort).toHaveValue("created");
  await expect(titles).toHaveText(["Newer idea", "Older idea"]);
  await composer.getByLabel("What’s on your mind?", { exact: true }).fill("A draft to keep.");
  await sort.selectOption("updated");
  await page.getByRole("article", { name: "Older idea", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("form", { name: "Edit note", exact: true });
  await editor.getByLabel("What’s on your mind?", { exact: true }).fill("Revisited the older idea.");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(titles).toHaveText(["Older idea", "Newer idea"]);
  await expect(composer.getByLabel("What’s on your mind?", { exact: true })).toHaveValue("A draft to keep.");
  await sort.selectOption("created");
  await expect(titles).toHaveText(["Newer idea", "Older idea"]);
  await sort.selectOption("updated");
  await expect(titles).toHaveText(["Older idea", "Newer idea"]);
  await composer.getByLabel("What’s on your mind?", { exact: true }).fill("");
  await page.reload();
  await expect(sort).toHaveValue("updated");
  await expect(titles).toHaveText(["Older idea", "Newer idea"]);
  await page.screenshot({ path: testInfo.outputPath("recently-edited.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a stalled note save times out without losing the draft or retrying the write", async ({
  page,
  userName,
}, testInfo) => {
  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Working ideas");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const composer = page.getByRole("form", { name: "New note", exact: true });
  const title = composer.getByLabel("Title (optional)", { exact: true });
  const body = composer.getByLabel("What’s on your mind?", { exact: true });
  await title.fill("Still worth keeping");
  await body.fill("A draft to keep.\n  Including its indentation.");

  let saveRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /^\/api\/users\/[^/]+\/projects\/[^/]+\/notes$/.test(
        new URL(request.url()).pathname,
      )
    )
      saveRequests += 1;
  });
  let releaseRequest: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let requestStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  await page.route(
    "**/api/users/*/projects/*/notes",
    async (route) => {
      requestStarted();
      await waiting;
      await route.fulfill({
        status: 503,
        json: { message: "This response arrived after the deadline." },
      });
    },
    { times: 1 },
  );
  await page.clock.install();
  try {
    await composer.getByRole("button", { name: "Add note", exact: true }).click();
    await started;
    await expect(
      composer.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "New project", exact: true }),
    ).toBeDisabled();
    await page.clock.fastForward(15_000);
    await expect(composer.getByRole("alert")).toHaveText(
      "Bartleby took too long to respond. Your changes may have been saved. Check the project before trying again.",
    );
    await expect(title).toHaveValue("Still worth keeping");
    await expect(body).toHaveValue(
      "A draft to keep.\n  Including its indentation.",
    );
    await expect(
      composer.getByRole("button", { name: "Add note", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(body).toHaveValue(
      "A draft to keep.\n  Including its indentation.",
    );
    await page.clock.fastForward(30_000);
    expect(saveRequests).toBe(1);
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("save-timeout.png") });
  } finally {
    releaseRequest();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("failed archive and restore keep the project available for manual retry", async ({
  page,
  userName,
}, testInfo) => {
  let projectUpdates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      /^\/api\/users\/[^/]+\/projects\/[^/]+$/.test(
        new URL(request.url()).pathname,
      )
    )
      projectUpdates += 1;
  });
  await page.goto("/");
  await page.getByPlaceholder("Your name", { exact: true }).fill(userName);
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("Completed ideas");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const composer = page.getByRole("form", { name: "New note", exact: true });
  await composer
    .getByLabel("Title (optional)", { exact: true })
    .fill("Keep this thought");
  await composer
    .getByLabel("What’s on your mind?", { exact: true })
    .fill("The saved note survives failed project actions.");
  await composer.getByRole("button", { name: "Add note", exact: true }).click();
  const note = page.getByRole("article", { name: "Keep this thought", exact: true });
  await expect(note).toBeVisible();

  await page.route(
    "**/api/users/*/projects/*",
    (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Archive temporarily unavailable." },
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Archive temporarily unavailable.",
  );
  await expect(
    page.getByRole("heading", { name: "Completed ideas", exact: true }),
  ).toBeVisible();
  await expect(note).toContainText("The saved note survives failed project actions.");
  await expect(
    page.getByRole("button", { name: "Archive project", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Archived projects 0", exact: true }),
  ).toBeEnabled();
  expect(projectUpdates).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("archive-error.png") });
  await page.getByRole("button", { name: "Archive project", exact: true }).click();
  await page
    .getByRole("button", { name: "Archived projects 1", exact: true })
    .click();
  const archive = page.locator(".archive-list");
  await expect(archive).toContainText("Completed ideas");
  await expect(archive).toContainText("1 notes");
  expect(projectUpdates).toBe(2);

  let projectListReads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      /^\/api\/users\/[^/]+\/projects$/.test(
        new URL(request.url()).pathname,
      )
    )
      projectListReads += 1;
  });
  await page.route(
    "**/api/users/*/projects/*",
    (route) =>
      route.fulfill({
        status: 503,
        json: { message: "Restore temporarily unavailable." },
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Restore temporarily unavailable.",
  );
  await expect(
    page.getByRole("heading", { name: "Archived projects", exact: true }),
  ).toBeVisible();
  await expect(archive).toContainText("Completed ideas");
  await expect(archive).toContainText("1 notes");
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Archived projects 1", exact: true }),
  ).toBeEnabled();
  expect(projectUpdates).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("restore-error.png") });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Completed ideas", exact: true }),
  ).toBeVisible();
  await expect(note).toContainText("The saved note survives failed project actions.");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Archived projects 0", exact: true }),
  ).toBeEnabled();
  expect(projectUpdates).toBe(4);
  expect(projectListReads).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Completed ideas", exact: true }),
  ).toBeVisible();
  await expect(note).toContainText("The saved note survives failed project actions.");
});
