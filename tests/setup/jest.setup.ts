/**
 * Jest Setup File
 *
 * Runs before each test file.
 * Sets up environment, custom matchers, and global helpers.
 */

import 'dotenv/config';

// Extend Jest timeout for integration tests
jest.setTimeout(60000);

// Ensure required environment variables
beforeAll(async () => {
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

// Custom matchers for MXF testing
expect.extend({
    /**
     * Check if an agent is connected
     */
    toBeConnected(received: any) {
        const pass = typeof received?.isConnected === 'function'
            ? received.isConnected()
            : false;

        return {
            pass,
            message: () => pass
                ? `Expected agent ${received?.agentId || 'unknown'} not to be connected`
                : `Expected agent ${received?.agentId || 'unknown'} to be connected`
        };
    },

    /**
     * Check if events array contains a specific event type
     */
    toHaveReceivedEvent(received: any[], eventType: string) {
        const events = Array.isArray(received) ? received : [];
        const found = events.some(e =>
            e.eventType === eventType ||
            e.type === eventType ||
            e.event === eventType
        );

        return {
            pass: found,
            message: () => found
                ? `Expected not to receive event "${eventType}"`
                : `Expected to receive event "${eventType}", got: [${events.map(e => e.eventType || e.type || e.event).join(', ')}]`
        };
    },

    /**
     * Check if a tool execution result is successful
     */
    toBeSuccessfulToolResult(received: any) {
        const isSuccess = received !== null &&
            received !== undefined &&
            !received?.error &&
            received?.success !== false;

        return {
            pass: isSuccess,
            message: () => isSuccess
                ? `Expected tool result to be unsuccessful`
                : `Expected tool result to be successful, got: ${JSON.stringify(received)}`
        };
    },

    /**
     * Check if response contains expected content
     */
    toContainContent(received: any, expected: string) {
        let content = '';
        if (typeof received === 'string') {
            content = received;
        } else if (received?.content) {
            content = typeof received.content === 'string'
                ? received.content
                : JSON.stringify(received.content);
        } else if (received?.data) {
            content = typeof received.data === 'string'
                ? received.data
                : JSON.stringify(received.data);
        } else {
            content = JSON.stringify(received);
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

// Type declarations for custom matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeConnected(): R;
            toHaveReceivedEvent(eventType: string): R;
            toBeSuccessfulToolResult(): R;
            toContainContent(expected: string): R;
        }
    }
}

// Silence noisy console output during tests (optional - comment out for debugging)
// const originalConsole = { ...console };
// beforeAll(() => {
//     console.log = jest.fn();
//     console.info = jest.fn();
// });
// afterAll(() => {
//     console.log = originalConsole.log;
//     console.info = originalConsole.info;
// });
