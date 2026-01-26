/**
 * Bun Test Setup File
 *
 * Preloaded before each test file via bunfig.toml.
 * Sets up environment, custom matchers, and global helpers.
 *
 * This file mirrors jest.setup.ts for compatibility -
 * both runners can execute the same test files.
 */

/// <reference types="bun-types" />

import 'dotenv/config';
import { expect, beforeAll, afterAll } from 'bun:test';

// Custom matchers for MXF testing
expect.extend({
    /**
     * Check if an agent is connected
     */
    toBeConnected(received: unknown) {
        const agent = received as { isConnected?: () => boolean; agentId?: string } | null;
        const pass = typeof agent?.isConnected === 'function'
            ? agent.isConnected()
            : false;

        return {
            pass,
            message: () => pass
                ? `Expected agent ${agent?.agentId || 'unknown'} not to be connected`
                : `Expected agent ${agent?.agentId || 'unknown'} to be connected`
        };
    },

    /**
     * Check if events array contains a specific event type
     */
    toHaveReceivedEvent(received: unknown, eventType: string) {
        const events = Array.isArray(received) ? received : [];
        const found = events.some((e: { eventType?: string; type?: string; event?: string }) =>
            e.eventType === eventType ||
            e.type === eventType ||
            e.event === eventType
        );

        return {
            pass: found,
            message: () => found
                ? `Expected not to receive event "${eventType}"`
                : `Expected to receive event "${eventType}", got: [${events.map((e: { eventType?: string; type?: string; event?: string }) => e.eventType || e.type || e.event).join(', ')}]`
        };
    },

    /**
     * Check if a tool execution result is successful
     */
    toBeSuccessfulToolResult(received: unknown) {
        const result = received as { error?: unknown; success?: boolean } | null | undefined;
        const isSuccess = result !== null &&
            result !== undefined &&
            !result?.error &&
            result?.success !== false;

        return {
            pass: isSuccess,
            message: () => isSuccess
                ? `Expected tool result to be unsuccessful`
                : `Expected tool result to be successful, got: ${JSON.stringify(result)}`
        };
    },

    /**
     * Check if response contains expected content
     */
    toContainContent(received: unknown, expected: string) {
        let content = '';
        const value = received as { content?: unknown; data?: unknown } | string | null;

        if (typeof value === 'string') {
            content = value;
        } else if (value?.content) {
            content = typeof value.content === 'string'
                ? value.content
                : JSON.stringify(value.content);
        } else if (value?.data) {
            content = typeof value.data === 'string'
                ? value.data
                : JSON.stringify(value.data);
        } else {
            content = JSON.stringify(value);
        }

        const pass = content.toLowerCase().includes(expected.toLowerCase());

        return {
            pass,
            message: () => pass
                ? `Expected content not to contain "${expected}"`
                : `Expected content to contain "${expected}", got: "${content.substring(0, 200)}..."`
        };
    }
});

// Ensure required environment variables
beforeAll(() => {
    // Set default test credentials if not provided
    if (!process.env.MXF_DEMO_USERNAME) {
        process.env.MXF_DEMO_USERNAME = 'demo-user';
    }
    if (!process.env.MXF_DEMO_PASSWORD) {
        process.env.MXF_DEMO_PASSWORD = 'demo-password-1234';
    }
    if (!process.env.TEST_SERVER_URL) {
        process.env.TEST_SERVER_URL = 'http://localhost:3001';
    }
});

// Global cleanup after all tests
afterAll(async () => {
    // Allow connections to close gracefully
    await new Promise(resolve => setTimeout(resolve, 500));
});

// Type declarations for custom matchers (Bun compatible)
declare module 'bun:test' {
    interface Matchers<T> {
        toBeConnected(): void;
        toHaveReceivedEvent(eventType: string): void;
        toBeSuccessfulToolResult(): void;
        toContainContent(expected: string): void;
    }
}
