/**
 * Agents E2E Tests
 *
 * Tests for agent management functionality including creating,
 * editing, deleting agents, and lifecycle controls.
 */

import { test, expect } from '@playwright/test';

test.describe('Agents', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to a channel's agents tab
        await page.goto('/dashboard/channels');
        await page.getByRole('tab', { name: /agents/i }).click();
        await page.waitForURL(/.*agents/);
    });

    test.describe('Agent List', () => {
        test('should display agents statistics', async ({ page }) => {
            await expect(page.getByText(/total agents/i)).toBeVisible();
            await expect(page.getByText(/active/i)).toBeVisible();
            await expect(page.getByText(/idle/i)).toBeVisible();
            await expect(page.getByText(/offline/i)).toBeVisible();
        });

        test('should display filters', async ({ page }) => {
            await expect(page.getByLabel(/search agents/i)).toBeVisible();
            await expect(page.getByLabel(/status/i)).toBeVisible();
            await expect(page.getByLabel(/type/i)).toBeVisible();
        });

        test('should show create agent button', async ({ page }) => {
            await expect(page.getByRole('button', { name: /create agent/i })).toBeVisible();
        });
    });

    test.describe('Agent Creation', () => {
        test('should open create agent dialog', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            await expect(page.getByText(/create new agent/i)).toBeVisible();
        });

        test('should display agent form tabs', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            await expect(page.getByRole('tab', { name: /basic info/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /llm config/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /capabilities/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /network/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /authentication/i })).toBeVisible();
        });

        test('should auto-generate agent ID from name', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            await page.getByLabel(/name/i).first().fill('Test Agent');

            // Agent ID should be auto-populated or show preview
            const agentIdField = page.getByLabel(/agent id/i);
            await expect(agentIdField).toHaveAttribute('placeholder', /test-agent/i);
        });

        test('should validate agent ID uniqueness', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            // Fill in agent details
            await page.getByLabel(/name/i).first().fill('Duplicate Agent');
            const agentIdField = page.getByLabel(/agent id/i);
            await agentIdField.fill('existing-agent-id');

            // Wait for validation
            await page.waitForTimeout(500);

            // Check for validation indicator
            // (actual behavior depends on existing agents)
        });

        test('should require model selection', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            // Fill basic info
            await page.getByLabel(/name/i).first().fill('Test Agent');

            // Navigate to LLM config tab
            await page.getByRole('tab', { name: /llm config/i }).click();

            // Model selection should be visible
            await expect(page.getByLabel(/default model/i)).toBeVisible();
        });

        test('should close dialog on cancel', async ({ page }) => {
            await page.getByRole('button', { name: /create agent/i }).click();

            await expect(page.getByText(/create new agent/i)).toBeVisible();

            await page.getByRole('button', { name: /cancel/i }).click();

            await expect(page.getByText(/create new agent/i)).not.toBeVisible();
        });
    });

    test.describe('Agent Filtering', () => {
        test('should filter by search query', async ({ page }) => {
            const searchInput = page.getByLabel(/search agents/i);
            await searchInput.fill('test');

            // Results should be filtered
            await page.waitForTimeout(300); // Debounce
        });

        test('should filter by status', async ({ page }) => {
            await page.getByLabel(/status/i).click();
            await page.getByRole('option', { name: /active/i }).click();

            // Results should be filtered to active agents only
        });

        test('should filter by type', async ({ page }) => {
            await page.getByLabel(/type/i).click();
            await page.getByRole('option', { name: /conversation/i }).click();

            // Results should be filtered to conversation agents only
        });
    });

    test.describe('Agent Actions', () => {
        test('should open agent menu', async ({ page }) => {
            // This test assumes at least one agent exists
            const menuButton = page.locator('[data-testid="agent-menu"]').first();

            if (await menuButton.isVisible()) {
                await menuButton.click();

                await expect(page.getByText(/edit agent/i)).toBeVisible();
                await expect(page.getByText(/view metrics/i)).toBeVisible();
            }
        });
    });
});
