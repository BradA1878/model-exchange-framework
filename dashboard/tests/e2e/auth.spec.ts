/**
 * Authentication E2E Tests
 *
 * Tests for login, logout, and magic link authentication flows.
 */

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
    test.describe('Login Flow', () => {
        test.use({ storageState: { cookies: [], origins: [] } }); // Start fresh without auth

        test('should display login page', async ({ page }) => {
            await page.goto('/login');

            // Check for login form elements
            await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
            await expect(page.getByLabel(/password/i)).toBeVisible();
            await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible();
        });

        test('should show error for invalid credentials', async ({ page }) => {
            await page.goto('/login');

            await page.getByLabel(/email/i).fill('invalid@example.com');
            await page.getByLabel(/password/i).fill('wrongpassword');
            await page.getByRole('button', { name: /sign in|login/i }).click();

            // Expect an error message
            await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible();
        });

        test('should redirect to dashboard after successful login', async ({ page }) => {
            await page.goto('/login');

            const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
            const testPassword = process.env.TEST_USER_PASSWORD || 'testpassword123';

            await page.getByLabel(/email/i).fill(testEmail);
            await page.getByLabel(/password/i).fill(testPassword);
            await page.getByRole('button', { name: /sign in|login/i }).click();

            await expect(page).toHaveURL(/.*dashboard/);
        });
    });

    test.describe('Logout Flow', () => {
        test('should logout and redirect to login', async ({ page }) => {
            // Navigate to dashboard (authenticated state is loaded by default)
            await page.goto('/dashboard');

            // Find and click logout button
            await page.getByRole('button', { name: /sign out|logout/i }).click();

            // Should redirect to login page
            await expect(page).toHaveURL(/.*login/);
        });
    });

    test.describe('Magic Link', () => {
        test.use({ storageState: { cookies: [], origins: [] } }); // Start fresh without auth

        test('should display magic link option', async ({ page }) => {
            await page.goto('/login');

            // Check for magic link option
            await expect(page.getByText(/magic link|passwordless/i)).toBeVisible();
        });
    });

    test.describe('Protected Routes', () => {
        test.use({ storageState: { cookies: [], origins: [] } }); // Start fresh without auth

        test('should redirect to login when accessing protected route', async ({ page }) => {
            await page.goto('/dashboard');

            // Should redirect to login
            await expect(page).toHaveURL(/.*login/);
        });

        test('should redirect to login when accessing account page', async ({ page }) => {
            await page.goto('/dashboard/account');

            // Should redirect to login
            await expect(page).toHaveURL(/.*login/);
        });
    });
});
