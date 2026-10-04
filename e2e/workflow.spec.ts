import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { test as base, expect } from '@playwright/test';

// A unique user keeps the browser run separate from real projects. Teardown
// removes only this user's records, including after a failed assertion.
const test = base.extend<{ userName: string }>({
  userName: async ({ page }, use) => {
    const name = `Browser smoke ${randomUUID()}`;
    try {
      await use(name);
    } finally {
      await page.close();
      const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
      await db.connect();
      try {
        await db.query('BEGIN');
        const users = await db.query<{ id: string }>('SELECT id FROM users WHERE name = $1 FOR UPDATE', [name]);
        for (const { id } of users.rows) {
          await db.query('DELETE FROM notes n USING projects p WHERE n.project_id = p.id AND p.user_id = $1', [id]);
          await db.query('DELETE FROM projects WHERE user_id = $1', [id]);
          await db.query('DELETE FROM users WHERE id = $1', [id]);
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally { await db.end(); }
    }
  },
});

test('capture, refresh, edit a project and note, then delete the note', async ({ page, userName }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });

  await page.goto('/');
  await expect(page).toHaveTitle('Bartleby — projects & notes');
  await page.getByPlaceholder('Your name', { exact: true }).fill(userName);
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Field notes');
  await page.getByLabel('Description (optional)', { exact: true }).fill('Some thoughts.');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Field notes', exact: true })).toBeVisible();

  const composer = page.getByRole('form', { name: 'New note', exact: true });
  await expect(composer.getByRole('button', { name: 'Add note', exact: true })).toBeDisabled();
  await composer.getByLabel('Title (optional)', { exact: true }).fill('A thought');
  await composer.getByLabel('What’s on your mind?', { exact: true }).fill('An idea worth keeping.\n  With its indentation.');

  // Opening the project editor must not silently lose a note draft.
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(composer.getByLabel('What’s on your mind?', { exact: true })).toHaveValue('An idea worth keeping.\n  With its indentation.');
  await composer.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A thought', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article')).toContainText('An idea worth keeping.');

  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  const projectForm = page.getByRole('form', { name: 'Edit project', exact: true });
  await expect(projectForm.getByLabel('Project name', { exact: true })).toHaveValue('Field notes');
  await expect(projectForm.getByLabel('Description (optional)', { exact: true })).toHaveValue('Some thoughts.');
  await expect(projectForm.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await projectForm.getByLabel('Project name', { exact: true }).fill('  ');
  await expect(projectForm.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();

  // Cancelling an edit preserves the saved project and asks before discarding.
  await projectForm.getByLabel('Project name', { exact: true }).fill('Unfinished rename');
  await projectForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(projectForm.getByLabel('Project name', { exact: true })).toHaveValue('Unfinished rename');
  await projectForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Field notes', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await projectForm.getByLabel('Project name', { exact: true }).fill('Working notes');
  await projectForm.getByLabel('Description (optional)', { exact: true }).fill('Ideas in progress.');
  await projectForm.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Working notes', exact: true })).toBeVisible();
  await expect(page.getByText('Ideas in progress.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notes 1', exact: true })).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('combobox', { name: 'Project', exact: true }).locator('option:checked')).toHaveText('Working notes (1)');
  } else {
    await expect(page.getByRole('button', { name: 'Working notes 1', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Working notes', exact: true })).toBeVisible();
  await expect(page.getByText('Ideas in progress.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A thought', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const noteForm = page.getByRole('form', { name: 'Edit note', exact: true });
  await noteForm.getByLabel('Title (optional)', { exact: true }).fill('A revised thought');
  await noteForm.getByLabel('What’s on your mind?', { exact: true }).fill('Saved again.');
  await noteForm.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A revised thought', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article')).toContainText('Saved again.');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Keep note', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A revised thought', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notes 0', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('No notes yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});
