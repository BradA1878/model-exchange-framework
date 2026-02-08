/**
 * Account E2E Tests
 *
 * Tests for account settings page including profile updates
 * and Personal Access Token management.
 */

import { test, expect } from '@playwright/test';

test.describe('Account', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/dashboard/account');
    });

    test.describe('Profile Section', () => {
        test('should display account settings page', async ({ page }) => {
            await expect(page.getByText(/account settings/i)).toBeVisible();
        });

        test('should show profile information form', async ({ page }) => {
            await expect(page.getByText(/profile information/i)).toBeVisible();
            await expect(page.getByLabel(/first name/i)).toBeVisible();
            await expect(page.getByLabel(/last name/i)).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
        });

        test('should show account summary', async ({ page }) => {
            await expect(page.getByText(/account summary/i)).toBeVisible();
            await expect(page.getByText(/account status/i)).toBeVisible();
            await expect(page.getByText(/member since/i)).toBeVisible();
        });

        test('should update profile successfully', async ({ page }) => {
            // Fill in profile form
            await page.getByLabel(/first name/i).fill('Test');
            await page.getByLabel(/last name/i).fill('User');

            // Submit the form
            await page.getByRole('button', { name: /update profile/i }).click();

            // Wait for success message
            await expect(page.getByText(/updated successfully/i)).toBeVisible();
        });
    });

    test.describe('API Tokens Section', () => {
        test('should display API tokens section', async ({ page }) => {
            await expect(page.getByText(/api tokens/i)).toBeVisible();
        });

        test('should show create token button', async ({ page }) => {
            await expect(page.getByRole('button', { name: /create token/i })).toBeVisible();
        });

        test('should open create token dialog', async ({ page }) => {
            await page.getByRole('button', { name: /create token/i }).click();

            await expect(page.getByText(/create api token/i)).toBeVisible();
            await expect(page.getByLabel(/token name/i)).toBeVisible();
        });

        test('should show expiration options', async ({ page }) => {
            await page.getByRole('button', { name: /create token/i }).click();

            await page.getByLabel(/expiration/i).click();

            await expect(page.getByRole('option', { name: /never/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /30 days/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /90 days/i })).toBeVisible();
            await expect(page.getByRole('option', { name: /1 year/i })).toBeVisible();
        });

        test('should show rate limits panel', async ({ page }) => {
            await page.getByRole('button', { name: /create token/i }).click();

            // Expand rate limits panel
            await page.getByText(/rate limits/i).click();

            await expect(page.getByLabel(/max requests per day/i)).toBeVisible();
            await expect(page.getByLabel(/max requests per month/i)).toBeVisible();
        });

        test('should close create dialog on cancel', async ({ page }) => {
            await page.getByRole('button', { name: /create token/i }).click();

            await expect(page.getByText(/create api token/i)).toBeVisible();

            await page.getByRole('button', { name: /cancel/i }).click();

            await expect(page.getByText(/create api token/i)).not.toBeVisible();
        });

        test('should show token list or empty state', async ({ page }) => {
            // Either show tokens table or empty state
            const hasTokens = await page.locator('table').isVisible();
            const hasEmptyState = await page.getByText(/no api tokens/i).isVisible();

            expect(hasTokens || hasEmptyState).toBe(true);
        });
    });

    test.describe('Token Revocation', () => {
        test('should show revoke confirmation dialog', async ({ page }) => {
            // This test assumes at least one token exists
            const revokeButton = page.getByRole('button', { name: /revoke/i }).first();

            if (await revokeButton.isVisible()) {
                await revokeButton.click();

                await expect(page.getByText(/revoke token/i)).toBeVisible();
                await expect(page.getByText(/are you sure/i)).toBeVisible();
            }
        });
    });
});
