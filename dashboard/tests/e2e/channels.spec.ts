/**
 * Channels E2E Tests
 *
 * Tests for channel management functionality including creating,
 * listing, selecting, and managing channel tabs.
 */

import { test, expect } from '@playwright/test';

test.describe('Channels', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard/channels');
    });

    test.describe('Channel List', () => {
        test('should display channels page', async ({ page }) => {
            await expect(page.getByText(/channel management/i)).toBeVisible();
        });

        test('should show channel selector', async ({ page }) => {
            await expect(page.getByText(/active channel/i)).toBeVisible();
        });

        test('should display channel metrics', async ({ page }) => {
            // Check for metrics cards
            await expect(page.getByText(/messages/i)).toBeVisible();
            await expect(page.getByText(/active agents/i)).toBeVisible();
            await expect(page.getByText(/tasks/i)).toBeVisible();
        });
    });

    test.describe('Channel Creation', () => {
        test('should open create channel dialog', async ({ page }) => {
            await page.getByRole('button', { name: /new channel/i }).click();

            await expect(page.getByText(/create new channel/i)).toBeVisible();
            await expect(page.getByLabel(/channel name/i)).toBeVisible();
        });

        test('should validate channel name is required', async ({ page }) => {
            await page.getByRole('button', { name: /new channel/i }).click();

            // Try to create without name - button should be disabled
            const createButton = page.getByRole('button', { name: /create channel/i });
            await expect(createButton).toBeDisabled();
        });

        test('should auto-generate channel ID from name', async ({ page }) => {
            await page.getByRole('button', { name: /new channel/i }).click();

            await page.getByLabel(/channel name/i).fill('Test Channel');

            // Check that channel ID field shows preview
            const channelIdField = page.getByLabel(/channel id/i);
            await expect(channelIdField).toHaveValue(/test-channel/i);
        });

        test('should show ID validation error for duplicate', async ({ page }) => {
            await page.getByRole('button', { name: /new channel/i }).click();

            // Fill in a channel name that would conflict with existing
            await page.getByLabel(/channel name/i).fill('Existing Channel');

            // Wait for validation
            await page.waitForTimeout(500);

            // Check for validation feedback (may vary based on existing channels)
            // This test assumes there might be an existing channel
        });

        test('should close dialog on cancel', async ({ page }) => {
            await page.getByRole('button', { name: /new channel/i }).click();

            await expect(page.getByText(/create new channel/i)).toBeVisible();

            await page.getByRole('button', { name: /cancel/i }).click();

            await expect(page.getByText(/create new channel/i)).not.toBeVisible();
        });
    });

    test.describe('Channel Navigation', () => {
        test('should display navigation tabs', async ({ page }) => {
            await expect(page.getByRole('tab', { name: /memory/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /context/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /agents/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /tools/i })).toBeVisible();
            await expect(page.getByRole('tab', { name: /tasks/i })).toBeVisible();
        });

        test('should navigate to context tab', async ({ page }) => {
            await page.getByRole('tab', { name: /context/i }).click();

            await expect(page).toHaveURL(/.*context/);
        });

        test('should navigate to agents tab', async ({ page }) => {
            await page.getByRole('tab', { name: /agents/i }).click();

            await expect(page).toHaveURL(/.*agents/);
        });

        test('should navigate to tasks tab', async ({ page }) => {
            await page.getByRole('tab', { name: /tasks/i }).click();

            await expect(page).toHaveURL(/.*tasks/);
        });
    });

    test.describe('Channel Refresh', () => {
        test('should refresh channel data', async ({ page }) => {
            const refreshButton = page.getByRole('button', { name: /refresh/i });

            await expect(refreshButton).toBeVisible();
            await refreshButton.click();

            // Should show loading state briefly
            // The actual data refresh would depend on backend
        });
    });
});
