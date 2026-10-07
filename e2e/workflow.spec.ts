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
