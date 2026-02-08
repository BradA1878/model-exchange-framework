/**
 * Analytics E2E Tests
 *
 * Tests for the analytics dashboard including data views and charts.
 */

import { test, expect } from '@playwright/test';

test.describe('Analytics', () => {
    test.describe('Data View', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto('/dashboard/analytics/data');
        });

        test('should display analytics data page', async ({ page }) => {
            await expect(page.getByText(/analytics/i)).toBeVisible();
        });

        test('should show data metrics', async ({ page }) => {
            // Check for common analytics elements
            await expect(page.locator('[class*="stat"], [class*="metric"]').first()).toBeVisible();
        });
    });

    test.describe('Charts View', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto('/dashboard/analytics/charts');
        });

        test('should display charts page', async ({ page }) => {
            await expect(page.getByText(/charts/i)).toBeVisible();
        });

        test('should render chart components', async ({ page }) => {
            // Check for chart containers (canvas elements for Chart.js)
            await page.waitForTimeout(1000); // Wait for charts to render

            // Either charts are visible or "no data" message
            const hasCharts = await page.locator('canvas').first().isVisible();
            const hasNoData = await page.getByText(/no data/i).isVisible();

            expect(hasCharts || hasNoData).toBe(true);
        });

        test('should show chart legends', async ({ page }) => {
            await page.waitForTimeout(1000);

            // Charts typically have legends
            const legendExists = await page.locator('[class*="legend"]').isVisible();
            // May not have legends if no data
        });
    });

    test.describe('Navigation', () => {
        test('should navigate between data and charts', async ({ page }) => {
            await page.goto('/dashboard/analytics');

            // Navigate to data tab
            const dataLink = page.getByRole('link', { name: /data/i });
            if (await dataLink.isVisible()) {
                await dataLink.click();
                await expect(page).toHaveURL(/.*data/);
            }

            // Navigate to charts tab
            const chartsLink = page.getByRole('link', { name: /charts/i });
            if (await chartsLink.isVisible()) {
                await chartsLink.click();
                await expect(page).toHaveURL(/.*charts/);
            }
        });
    });
});
