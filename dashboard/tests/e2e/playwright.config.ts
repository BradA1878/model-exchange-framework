/**
 * Playwright Configuration for MXF Dashboard E2E Tests
 *
 * This configuration sets up Playwright for running end-to-end tests
 * against the MXF Dashboard application.
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

export default defineConfig({
    // Directory containing the test files
    testDir: '.',

    // Maximum time one test can run (5 minutes)
    timeout: 5 * 60 * 1000,

    // Time to wait for expect() conditions
    expect: {
        timeout: 10000,
    },

    // Run tests in files in parallel
    fullyParallel: true,

    // Fail the build on CI if you accidentally left test.only in the source code
    forbidOnly: !!process.env.CI,

    // Retry on CI only
    retries: process.env.CI ? 2 : 0,

    // Number of parallel workers - limit on CI to avoid resource issues
    workers: process.env.CI ? 1 : undefined,

    // Reporter to use
    reporter: [
        ['list'],
        ['html', { outputFolder: '../test-results/playwright-report' }],
    ],

    // Shared settings for all projects
    use: {
        // Base URL for the dashboard
        baseURL: process.env.DASHBOARD_URL || 'http://localhost:5173',

        // Collect trace when retrying the failed test
        trace: 'on-first-retry',

        // Screenshot on failure
        screenshot: 'only-on-failure',

        // Video recording on failure
        video: 'on-first-retry',

        // Viewport size
        viewport: { width: 1280, height: 720 },
    },

    // Configure projects for major browsers
    projects: [
        // Setup project for authentication
        {
            name: 'setup',
            testMatch: /global\.setup\.ts/,
        },

        // Chrome tests
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Use authenticated state
                storageState: 'tests/e2e/.auth/user.json',
            },
            dependencies: ['setup'],
        },

        // Firefox tests
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                storageState: 'tests/e2e/.auth/user.json',
            },
            dependencies: ['setup'],
        },

        // Safari tests
        {
            name: 'webkit',
            use: {
                ...devices['Desktop Safari'],
                storageState: 'tests/e2e/.auth/user.json',
            },
            dependencies: ['setup'],
        },

        // Mobile Chrome tests
        {
            name: 'mobile-chrome',
            use: {
                ...devices['Pixel 5'],
                storageState: 'tests/e2e/.auth/user.json',
            },
            dependencies: ['setup'],
        },
    ],

    // Web server configuration - starts the dashboard dev server
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        cwd: '..',
        timeout: 120000,
    },
});
