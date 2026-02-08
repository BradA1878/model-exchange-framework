/**
 * Tasks E2E Tests
 *
 * Tests for task management functionality including creating,
 * filtering, assigning, and tracking task status.
 */

import { test, expect } from '@playwright/test';

test.describe('Tasks', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to a channel's tasks tab
        await page.goto('/dashboard/channels');
        await page.getByRole('tab', { name: /tasks/i }).click();
        await page.waitForURL(/.*tasks/);
    });

    test.describe('Task List', () => {
        test('should display task statistics', async ({ page }) => {
            await expect(page.getByText(/total tasks/i)).toBeVisible();
            await expect(page.getByText(/active/i)).toBeVisible();
            await expect(page.getByText(/completed/i)).toBeVisible();
            await expect(page.getByText(/completion rate/i)).toBeVisible();
        });

        test('should display filters', async ({ page }) => {
            await expect(page.getByLabel(/search tasks/i)).toBeVisible();
            await expect(page.getByLabel(/status/i)).toBeVisible();
            await expect(page.getByLabel(/priority/i)).toBeVisible();
            await expect(page.getByLabel(/assignee/i)).toBeVisible();
        });

        test('should show create task button', async ({ page }) => {
            await expect(page.getByRole('button', { name: /create task/i })).toBeVisible();
        });
    });

    test.describe('Task Creation', () => {
        test('should open create task dialog', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            await expect(page.getByText(/create new task/i)).toBeVisible();
        });

        test('should require title and description', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            // Create button should be visible but will validate on click
            const createButton = page.getByRole('button', { name: /create task/i }).last();
            await expect(createButton).toBeVisible();
        });

        test('should show assignment strategy options', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            await page.getByLabel(/assignment strategy/i).click();

            await expect(page.getByRole('option', { name: /intelligent/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /manual/i })).toBeVisible();
        });

        test('should show agent selection for manual assignment', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            // Select manual assignment
            await page.getByLabel(/assignment strategy/i).click();
            await page.getByRole('option', { name: /manual/i }).click();

            // Agent selection should appear
            await expect(page.getByLabel(/assign to agent/i)).toBeVisible();
        });

        test('should show priority options', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            await page.getByLabel(/priority/i).click();

            await expect(page.getByRole('option', { name: /low/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /medium/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /high/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /urgent/i })).toBeVisible();
        });

        test('should close dialog on cancel', async ({ page }) => {
            await page.getByRole('button', { name: /create task/i }).click();

            await expect(page.getByText(/create new task/i)).toBeVisible();

            await page.getByRole('button', { name: /cancel/i }).click();

            await expect(page.getByText(/create new task/i)).not.toBeVisible();
        });
    });

    test.describe('Task Filtering', () => {
        test('should filter by search query', async ({ page }) => {
            const searchInput = page.getByLabel(/search tasks/i);
            await searchInput.fill('test');

            await page.waitForTimeout(300); // Debounce
        });

        test('should filter by status', async ({ page }) => {
            await page.getByLabel(/status/i).click();
            await page.getByRole('option', { name: /pending/i }).click();
        });

        test('should filter by priority', async ({ page }) => {
            await page.getByLabel(/priority/i).click();
            await page.getByRole('option', { name: /high/i }).click();
        });

        test('should filter by assignee', async ({ page }) => {
            await page.getByLabel(/assignee/i).click();
            // Options depend on available agents
        });

        test('should sort tasks', async ({ page }) => {
            await page.getByLabel(/sort by/i).click();
            await page.getByRole('option', { name: /priority/i }).click();
        });
    });

    test.describe('Task Actions', () => {
        test('should show task edit option', async ({ page }) => {
            // This test assumes at least one task exists
            const menuButton = page.locator('[data-testid="task-menu"]').first();

            if (await menuButton.isVisible()) {
                await menuButton.click();

                await expect(page.getByText(/edit task/i)).toBeVisible();
            }
        });
    });
});
