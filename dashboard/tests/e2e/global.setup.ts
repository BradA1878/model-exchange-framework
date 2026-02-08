/**
 * Global Setup for Playwright Tests
 *
 * Handles authentication setup before running tests.
 * This creates an authenticated session that can be reused across tests.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

// Path to store authenticated state
const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // Wait for the login form to be visible
    await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible();

    // Fill in login credentials
    // Note: These should be test credentials, not real user credentials
    const testEmail = process.env.TEST_USER_EMAIL || 'test@example.com';
    const testPassword = process.env.TEST_USER_PASSWORD || 'testpassword123';

    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);

    // Click the login button
    await page.getByRole('button', { name: /sign in|login/i }).click();

    // Wait for navigation to dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // Verify we're logged in by checking for user-specific elements
    await expect(page.getByText(/dashboard|channels|account/i).first()).toBeVisible();

    // Save authentication state
    await page.context().storageState({ path: authFile });
});
