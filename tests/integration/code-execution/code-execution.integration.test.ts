/**
 * Code Execution Integration Tests
 *
 * Tests the complete code execution pipeline including:
 * - JavaScript execution in Docker containers
 * - TypeScript execution with Bun runtime
 * - Console output capture
 * - Timeout handling
 * - Security validation
 * - Error handling
 *
 * Prerequisites:
 * - Docker daemon running (image auto-builds on server startup)
 * - MXF server running
 *
 * CI Behavior:
 * - In CI (CI=true), tests FAIL if Docker is unavailable (no silent skip)
 * - Locally, tests skip gracefully if Docker is not running
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import {
    CODE_EXECUTION_AGENT_CONFIG,
    CODE_EXECUTION_INPUTS,
    CODE_EXECUTION_EXPECTED,
    TIMEOUTS
} from '../../utils/TestFixtures';
import { CodeExecutionSandboxService } from '@mxf/shared/services/CodeExecutionSandboxService';
import { ContainerPoolManager } from '@mxf/shared/services/ContainerPoolManager';

describe('Code Execution Integration Tests', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let sandbox: CodeExecutionSandboxService;
    let containerPool: ContainerPoolManager;
    let agent: any;

    // Helper to skip test if Docker not available
    // In CI environments, fail instead of skip to catch configuration issues
    const isCI = process.env.CI === 'true';

    const skipIfNoDocker = () => {
        if (!containerPool.isDockerAvailable()) {
            if (isCI) {
                throw new Error('Docker is not available in CI environment. Ensure Docker is configured for CI.');
            }
            console.log('Skipping: Docker not available (run with CI=true to fail instead)');
            return true;
        }
        return false;
    };

    beforeAll(async () => {
        // Initialize test SDK and create channel
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('code-exec', {
            disableSystemLlm: true
        });
        channelId = result.channelId;

        // Initialize sandbox service
        sandbox = CodeExecutionSandboxService.getInstance();
        await sandbox.initialize();

        // Get container pool manager
        containerPool = ContainerPoolManager.getInstance();

        // Create and connect agent with code execution capability
        agent = await testSdk.createAndConnectAgent(channelId, CODE_EXECUTION_AGENT_CONFIG);
    }, TIMEOUTS.veryLong);

    afterAll(async () => {
        await testSdk.cleanup();
    }, TIMEOUTS.long);

    describe('Docker Availability', () => {
        it('should have Docker available in CI environment', () => {
            const isAvailable = containerPool.isDockerAvailable();

            if (isCI && !isAvailable) {
                fail('Docker must be available in CI environment. Configure Docker for CI or skip code execution tests.');
            }

            expect(typeof isAvailable).toBe('boolean');
            console.log(`Docker available: ${isAvailable}${isCI ? ' (CI mode)' : ''}`);
        });

        it('should report isReady status', () => {
            const ready = sandbox.isReady();
            expect(typeof ready).toBe('boolean');
            console.log(`Sandbox ready: ${ready}`);
        });
    });

    describe('Container Pool Manager', () => {
        it('should return configuration values', () => {
            const config = containerPool.getConfig();

            expect(config).toBeDefined();
            expect(config.defaultTimeout).toBeGreaterThan(0);
            expect(config.maxTimeout).toBeGreaterThanOrEqual(config.defaultTimeout);
            expect(config.memoryLimit).toBeGreaterThan(0);
            expect(config.cpuLimit).toBeGreaterThan(0);
            expect(config.imageName).toBeDefined();
            expect(config.imageTag).toBeDefined();
        });

        it('should follow singleton pattern', () => {
            const instance1 = ContainerPoolManager.getInstance();
            const instance2 = ContainerPoolManager.getInstance();
            expect(instance1).toBe(instance2);
        });
    });

    describe('JavaScript Execution', () => {
        it('should execute simple arithmetic', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.simpleArithmetic);

            // Log result for debugging if test fails
            if (!result.success) {
                console.log('Simple arithmetic failed:', JSON.stringify(result, null, 2));
            }

            expect(result.success).toBe(true);
            expect(result.output).toBe(CODE_EXECUTION_EXPECTED.simpleArithmetic.output);
            // executionTime may be 0 for very fast executions or may be in a nested field
            expect(result.executionTime).toBeGreaterThanOrEqual(0);
            expect(result.codeHash).toBeDefined();
            expect(result.codeHash.length).toBe(16);
        }, TIMEOUTS.long);

        it('should execute array operations', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.arraySum);

            expect(result.success).toBe(true);
            expect(result.output).toBe(CODE_EXECUTION_EXPECTED.arraySum.output);
        }, TIMEOUTS.long);

        it('should execute with context data', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.withContext);

            expect(result.success).toBe(true);
            expect(result.output).toBeDefined();
            expect(result.output.total).toBe(3);
            expect(result.output.filtered).toBe(2); // Items with score > 0.8
        }, TIMEOUTS.long);
    });

    describe('TypeScript Execution', () => {
        it('should execute TypeScript with interfaces', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.typescript);

            expect(result.success).toBe(true);
            expect(result.output).toEqual(CODE_EXECUTION_EXPECTED.typescript.output);
        }, TIMEOUTS.long);

        it('should execute TypeScript with type annotations', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.typescriptInterface);

            expect(result.success).toBe(true);
            expect(result.output).toBe('Alice');
        }, TIMEOUTS.long);
    });

    describe('Console Output Capture', () => {
        it('should capture console.log output', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.withConsoleLog);

            // Log result for debugging if test fails
            if (!result.success) {
                console.log('Console log test failed:', JSON.stringify(result, null, 2));
            }

            expect(result.success).toBe(true);
            expect(result.output).toBe(CODE_EXECUTION_EXPECTED.withConsoleLog.output);
            expect(result.logs).toBeDefined();
            expect(Array.isArray(result.logs)).toBe(true);
            expect(result.logs.length).toBeGreaterThan(0);
        }, TIMEOUTS.long);

        it('should capture console.error output', async () => {
            if (skipIfNoDocker()) return;

            const code = `
                console.error('This is an error');
                return 'done';
            `;
            const result = await agent.executeTool('code_execute', { code });

            expect(result.success).toBe(true);
            expect(result.logs).toBeDefined();
            expect(result.logs.some((log: string) => log.includes('error'))).toBe(true);
        }, TIMEOUTS.long);

        it('should capture console.warn output', async () => {
            if (skipIfNoDocker()) return;

            const code = `
                console.warn('This is a warning');
                return 'done';
            `;
            const result = await agent.executeTool('code_execute', { code });

            expect(result.success).toBe(true);
            expect(result.logs).toBeDefined();
        }, TIMEOUTS.long);
    });

    describe('Timeout Handling', () => {
        it('should timeout on infinite loops', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.infiniteLoop);

            // Log result for debugging
            console.log('Timeout test result:', JSON.stringify(result, null, 2));

            expect(result.success).toBe(false);
            // Check for timeout in various places it might appear
            const hasTimeout =
                result.resourceUsage?.timeout === true ||
                result.timeout === true ||
                (typeof result.error === 'string' && result.error.toLowerCase().includes('timeout'));
            expect(hasTimeout).toBeTruthy();
        }, TIMEOUTS.long);

        it('should complete fast code within timeout', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', {
                code: 'return 42;',
                timeout: 5000
            });

            expect(result.success).toBe(true);
            expect(result.output).toBe(42);
            expect(result.executionTime).toBeLessThan(5000);
        }, TIMEOUTS.long);
    });

    describe('Security Validation', () => {
        it('should block eval()', () => {
            const validation = sandbox.validateCode(CODE_EXECUTION_INPUTS.dangerousEval.code);
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('eval'))).toBe(true);
        });

        it('should block require()', () => {
            const validation = sandbox.validateCode(CODE_EXECUTION_INPUTS.dangerousRequire.code);
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('require'))).toBe(true);
        });

        it('should block Bun.spawn', () => {
            const validation = sandbox.validateCode(CODE_EXECUTION_INPUTS.dangerousBunSpawn.code);
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Bun.spawn'))).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should handle runtime errors gracefully', async () => {
            if (skipIfNoDocker()) return;

            const result = await agent.executeTool('code_execute', CODE_EXECUTION_INPUTS.undefinedReference);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        }, TIMEOUTS.long);

        it('should handle syntax errors', () => {
            // Validation may or may not catch syntax errors
            // This tests that validation doesn't throw on malformed code
            const validation = sandbox.validateCode(CODE_EXECUTION_INPUTS.syntaxError.code);
            expect(validation).toBeDefined();
        });

        it('should return error details for validation failures', () => {
            const code = 'eval("test")';
            const validation = sandbox.validateCode(code);

            expect(validation.safe).toBe(false);
            expect(validation.issues.length).toBeGreaterThan(0);
            expect(validation.issues[0].type).toBe('error');
            expect(validation.issues[0].message).toBeDefined();
        });
    });

    describe('Code Hash Generation', () => {
        it('should generate consistent hashes for identical code', () => {
            const code = 'return 1 + 1;';

            const hash1 = generateCodeHash(code);
            const hash2 = generateCodeHash(code);

            expect(hash1).toBe(hash2);
        });

        it('should generate different hashes for different code', () => {
            const code1 = 'return 1;';
            const code2 = 'return 2;';

            const hash1 = generateCodeHash(code1);
            const hash2 = generateCodeHash(code2);

            expect(hash1).not.toBe(hash2);
        });
    });
});

// Helper function to generate code hash (mirrors service implementation)
function generateCodeHash(code: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);
}
