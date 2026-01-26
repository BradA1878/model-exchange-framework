/**
 * Test Fixtures
 *
 * Reusable test data and configurations for integration tests.
 */

import { LlmProviderType } from '../../src/sdk/index';
import type { TestAgentConfig, TestChannelConfig } from './TestSDK';

// =============================================================================
// Agent Configurations
// =============================================================================

/**
 * Minimal agent configuration for basic tests
 */
export const MINIMAL_AGENT_CONFIG: TestAgentConfig = {
    capabilities: ['testing'],
    allowedTools: [],
    agentConfigPrompt: 'You are a test agent. Respond briefly.',
    temperature: 0.1,
    maxTokens: 500
};

/**
 * Agent with full tool access for tool execution tests
 */
export const TOOL_TEST_AGENT_CONFIG: TestAgentConfig = {
    name: 'Tool Test Agent',
    capabilities: ['testing', 'tool-execution'],
    allowedTools: [
        'tool_help',
        'tool_validate',
        'tool_quick_reference',
        'tools_recommend',
        'messaging_send',
        'messaging_broadcast',
        'memory_search_conversations'
    ],
    agentConfigPrompt: `You are a test agent for tool execution testing.
When asked to use a tool, execute it directly without explanation.
Report tool results concisely.`,
    temperature: 0.2,
    maxTokens: 2000
};

/**
 * Agent for communication tests
 */
export const COMMUNICATION_AGENT_CONFIG: TestAgentConfig = {
    name: 'Communication Test Agent',
    capabilities: ['messaging', 'testing'],
    allowedTools: [
        'messaging_send',
        'messaging_broadcast',
        'messaging_discover'
    ],
    agentConfigPrompt: `You are a test agent for communication testing.
When you receive messages, acknowledge them.
When asked to send messages, do so directly.`,
    temperature: 0.3,
    maxTokens: 1000
};

/**
 * Agent for ORPAR/control loop tests
 */
export const ORPAR_TEST_AGENT_CONFIG: TestAgentConfig = {
    name: 'ORPAR Test Agent',
    capabilities: ['reasoning', 'planning', 'testing'],
    allowedTools: [
        'controlLoop_start',
        'controlLoop_observe',
        'controlLoop_status'
    ],
    agentConfigPrompt: `You are a test agent for ORPAR control loop testing.
Follow the ORPAR cycle: Observe, Reason, Plan, Act, Reflect.
Report each phase's completion.`,
    temperature: 0.5,
    maxTokens: 3000
};

/**
 * Agent for task system tests
 */
export const TASK_TEST_AGENT_CONFIG: TestAgentConfig = {
    name: 'Task Test Agent',
    capabilities: ['task-handling', 'testing'],
    allowedTools: [
        'task_create_with_plan',
        'task_complete',
        'task_monitoring_status',
        'task_update'
    ],
    agentConfigPrompt: `You are a test agent for task system testing.
Accept tasks when offered.
Complete tasks by reporting "Task completed: [task description]".
Fail tasks only when explicitly asked to simulate failure.`,
    temperature: 0.3,
    maxTokens: 2000
};

/**
 * Agent for memory tests
 */
export const MEMORY_TEST_AGENT_CONFIG: TestAgentConfig = {
    name: 'Memory Test Agent',
    capabilities: ['memory', 'testing'],
    allowedTools: [
        'agent_memory_read',
        'agent_memory_write',
        'channel_memory_read',
        'channel_memory_write',
        'memory_search_conversations',
        'memory_search_actions'
    ],
    agentConfigPrompt: `You are a test agent for memory system testing.
Store and retrieve information as requested.
Report memory operations results.`,
    temperature: 0.2,
    maxTokens: 2000
};

// =============================================================================
// Channel Configurations
// =============================================================================

/**
 * Standard test channel configuration
 */
export const STANDARD_CHANNEL_CONFIG: TestChannelConfig = {
    description: 'Standard integration test channel',
    isPrivate: false,
    requireApproval: false,
    maxAgents: 10,
    disableSystemLlm: true
};

/**
 * Private channel for isolation tests
 */
export const PRIVATE_CHANNEL_CONFIG: TestChannelConfig = {
    description: 'Private integration test channel',
    isPrivate: true,
    requireApproval: true,
    maxAgents: 5,
    disableSystemLlm: true
};

/**
 * Channel with SystemLLM enabled
 */
export const SYSTEMLLM_CHANNEL_CONFIG: TestChannelConfig = {
    description: 'Channel with SystemLLM enabled',
    isPrivate: false,
    requireApproval: false,
    maxAgents: 10,
    disableSystemLlm: false
};

// =============================================================================
// Test Messages
// =============================================================================

export const TEST_MESSAGES = {
    simple: 'Hello, this is a test message.',
    withMetadata: {
        content: 'Test message with metadata',
        metadata: { testId: 'msg-001', priority: 'high' }
    },
    longContent: 'Lorem ipsum '.repeat(100).trim(),
    specialCharacters: 'Test with special chars: !@#$%^&*()_+-=[]{}|;:\'",.<>?/',
    unicode: 'Test with unicode: ',
    multiline: `Line 1
Line 2
Line 3`,
    json: JSON.stringify({ key: 'value', nested: { a: 1, b: 2 } })
};

// =============================================================================
// Tool Inputs
// =============================================================================

export const TOOL_INPUTS = {
    toolHelp: {
        valid: { toolName: 'messaging_send' },
        invalid: { toolName: '' }
    },
    messagingSend: {
        valid: (channelId: string) => ({
            channelId,
            message: 'Test message from tool'
        }),
        missingChannel: { message: 'Test message' },
        missingMessage: (channelId: string) => ({ channelId })
    },
    memorySearch: {
        valid: (channelId: string) => ({
            query: 'test search query',
            channelId,
            limit: 5
        })
    }
};

// =============================================================================
// Expected Event Types
// =============================================================================

export const EXPECTED_EVENTS = {
    agentLifecycle: [
        'agent:register',
        'agent:registered',
        'agent:connected',
        'agent:disconnected'
    ],
    channelLifecycle: [
        'channel:created',
        'channel:joined',
        'channel:left',
        'channel:deleted'
    ],
    messaging: [
        'message:channel',
        'message:agent',
        'message:broadcast'
    ],
    toolExecution: [
        'mcp:tool_call_request',
        'mcp:tool_call_result'
    ],
    controlLoop: [
        'controlloop:initialized',
        'controlloop:observation',
        'controlloop:reasoning',
        'controlloop:planning',
        'controlloop:action',
        'controlloop:reflection',
        'controlloop:completed'
    ],
    task: [
        'task:created',
        'task:assigned',
        'task:accepted',
        'task:completed',
        'task:failed'
    ],
    memory: [
        'memory:get',
        'memory:set',
        'memory:updated'
    ]
};

// =============================================================================
// Timeout Constants
// =============================================================================

export const TIMEOUTS = {
    /** Short operations like simple queries */
    short: 5000,
    /** Standard operations like tool execution */
    standard: 10000,
    /** Long operations like LLM calls */
    long: 30000,
    /** Very long operations like ORPAR cycles */
    veryLong: 60000,
    /** Connection timeout */
    connection: 15000,
    /** Event wait timeout */
    event: 10000
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique test ID
 */
export function generateTestId(prefix: string = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a delayed promise for testing timeouts
 */
export function createDelayedPromise<T>(value: T, delay: number): Promise<T> {
    return new Promise(resolve => setTimeout(() => resolve(value), delay));
}

/**
 * Create a failing promise for testing error handling
 */
export function createFailingPromise(error: string, delay: number = 0): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(error)), delay)
    );
}

// =============================================================================
// Code Execution Test Configurations
// =============================================================================

/**
 * Agent configuration for code execution tests
 */
export const CODE_EXECUTION_AGENT_CONFIG: TestAgentConfig = {
    name: 'Code Execution Test Agent',
    capabilities: ['code-execution', 'testing'],
    allowedTools: ['code_execute'],
    agentConfigPrompt: 'Test agent for code execution',
    temperature: 0.1,
    maxTokens: 2000
};

/**
 * Sample code execution inputs for testing
 */
export const CODE_EXECUTION_INPUTS = {
    // Simple operations
    simpleArithmetic: { code: 'return 1 + 1;' },
    simpleMultiplication: { code: 'return 6 * 7;' },

    // Array operations
    arraySum: {
        code: `
            const numbers = [1, 2, 3, 4, 5];
            return numbers.reduce((a, b) => a + b, 0);
        `
    },
    arrayFilter: {
        code: `
            const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            return items.filter(x => x > 5);
        `
    },

    // TypeScript
    typescript: {
        language: 'typescript' as const,
        code: `
            interface Result { value: number; doubled: number; }
            const x: number = 42;
            const result: Result = { value: x, doubled: x * 2 };
            return result;
        `
    },
    typescriptInterface: {
        language: 'typescript' as const,
        code: `
            interface Person { name: string; age: number; }
            const person: Person = { name: 'Alice', age: 30 };
            return person.name;
        `
    },

    // Context usage
    withContext: {
        code: `
            const filtered = context.data.filter(item => item.score > 0.8);
            return { total: context.data.length, filtered: filtered.length };
        `,
        context: {
            data: [
                { name: 'A', score: 0.9 },
                { name: 'B', score: 0.7 },
                { name: 'C', score: 0.85 }
            ]
        }
    },

    // Console output
    withConsoleLog: {
        code: `
            console.log('Step 1: Starting');
            const result = Math.sqrt(144);
            console.log('Step 2: Result is', result);
            return result;
        `
    },

    // Dangerous code (should be blocked)
    dangerousEval: { code: 'eval("1 + 1")' },
    dangerousRequire: { code: 'const fs = require("fs")' },
    dangerousBunSpawn: { code: 'Bun.spawn(["ls"])' },
    dangerousBunFile: { code: 'Bun.file("/etc/passwd")' },
    dangerousBunWrite: { code: 'Bun.write("/tmp/test", "data")' },
    dangerousProcessExit: { code: 'process.exit(1)' },
    dangerousProto: { code: 'const obj = {}; obj.__proto__ = null;' },

    // Timeout test
    infiniteLoop: {
        code: 'while(true) {}',
        timeout: 1000
    },

    // Error scenarios
    undefinedReference: { code: 'return undefinedVariable;' },
    syntaxError: { code: 'return {' }
};

/**
 * Expected results for code execution tests
 */
export const CODE_EXECUTION_EXPECTED = {
    simpleArithmetic: { success: true, output: 2 },
    simpleMultiplication: { success: true, output: 42 },
    arraySum: { success: true, output: 15 },
    arrayFilter: { success: true, output: [6, 7, 8, 9, 10] },
    typescript: { success: true, output: { value: 42, doubled: 84 } },
    withConsoleLog: { success: true, output: 12 },
    dangerousEval: { success: false },
    infiniteLoop: { success: false, timeout: true }
};
