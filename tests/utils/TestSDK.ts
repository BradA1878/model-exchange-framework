/**
 * TestSDK - Test utility for MXF SDK
 *
 * Provides a pre-configured SDK wrapper with automatic resource cleanup.
 * Use this in integration tests to create channels and agents.
 */

import { MxfSDK, MxfAgent, MxfChannelMonitor, LlmProviderType, ConfigManager } from '../../src/sdk/index';
import type { AgentCreationConfig } from '../../src/sdk/index';

export interface TestSDKOptions {
    serverUrl?: string;
    domainKey?: string;
    username?: string;
    password?: string;
}

export interface TestAgentConfig {
    agentId?: string;
    name?: string;
    description?: string;
    capabilities?: string[];
    allowedTools?: string[];
    agentConfigPrompt?: string;
    llmProvider?: LlmProviderType;
    apiKey?: string;
    defaultModel?: string;
    temperature?: number;
    maxTokens?: number;
    metadata?: Record<string, any>;
    mxpEnabled?: boolean;
}

export interface TestChannelConfig {
    name?: string;
    description?: string;
    isPrivate?: boolean;
    requireApproval?: boolean;
    maxAgents?: number;
    metadata?: Record<string, any>;
    disableSystemLlm?: boolean;
}

/**
 * Test SDK wrapper with automatic cleanup
 */
export class TestSDK {
    private sdk: MxfSDK;
    private agents: MxfAgent[] = [];
    private channels: string[] = [];
    private connected: boolean = false;

    constructor(options: TestSDKOptions = {}) {
        const serverUrl = options.serverUrl || process.env.TEST_SERVER_URL || 'http://localhost:3001';

        this.sdk = new MxfSDK({
            serverUrl,
            domainKey: options.domainKey || process.env.MXF_DOMAIN_KEY!,
            username: options.username || process.env.MXF_DEMO_USERNAME || 'demo-user',
            password: options.password || process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
        });
    }

    /**
     * Connect to the MXF server
     */
    async connect(): Promise<void> {
        if (this.connected) return;
        await this.sdk.connect();
        this.connected = true;
    }

    /**
     * Check if SDK is connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Create a test channel with a unique ID
     */
    async createTestChannel(
        prefix: string = 'test',
        config: TestChannelConfig = {}
    ): Promise<{ channelId: string; monitor: MxfChannelMonitor }> {
        await this.connect();

        const channelId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const monitor = await this.sdk.createChannel(channelId, {
            name: config.name || `Test Channel ${channelId}`,
            description: config.description || 'Integration test channel',
            isPrivate: config.isPrivate ?? false,
            requireApproval: config.requireApproval ?? false,
            maxAgents: config.maxAgents ?? 10,
            metadata: {
                ...config.metadata,
                testChannel: true,
                createdAt: Date.now()
            }
        });

        // Optionally disable SystemLLM for test channel
        if (config.disableSystemLlm) {
            const configManager = ConfigManager.getInstance();
            configManager.setChannelSystemLlmEnabled(
                false,
                channelId,
                'Integration test - SystemLLM disabled'
            );
        }

        this.channels.push(channelId);
        return { channelId, monitor };
    }

    /**
     * Create a test agent with auto-generated credentials
     */
    async createTestAgent(
        channelId: string,
        config: TestAgentConfig = {}
    ): Promise<MxfAgent> {
        await this.connect();

        const agentId = config.agentId || `test-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Generate authentication keys
        const keys = await this.sdk.generateKey(channelId, agentId, `Key for ${agentId}`);

        // Build full agent configuration
        const agentConfig: AgentCreationConfig = {
            agentId,
            name: config.name || `Test Agent ${agentId}`,
            channelId,
            keyId: keys.keyId,
            secretKey: keys.secretKey,
            description: config.description || 'Integration test agent',
            capabilities: config.capabilities || ['testing'],
            allowedTools: config.allowedTools || [],
            agentConfigPrompt: config.agentConfigPrompt || 'You are a test agent for integration testing. Be concise and direct.',
            llmProvider: config.llmProvider || LlmProviderType.OPENROUTER,
            apiKey: config.apiKey || process.env.OPENROUTER_API_KEY || '',
            defaultModel: config.defaultModel || 'anthropic/claude-3.5-haiku',
            temperature: config.temperature ?? 0.3,
            maxTokens: config.maxTokens ?? 2000,
            metadata: {
                ...config.metadata,
                testAgent: true,
                createdAt: Date.now()
            },
            mxpEnabled: config.mxpEnabled ?? false
        };

        const agent = await this.sdk.createAgent(agentConfig);
        this.agents.push(agent);

        return agent;
    }

    /**
     * Create and connect a test agent in one call
     */
    async createAndConnectAgent(
        channelId: string,
        config: TestAgentConfig = {}
    ): Promise<MxfAgent> {
        const agent = await this.createTestAgent(channelId, config);
        await agent.connect();
        return agent;
    }

    /**
     * Get the raw SDK instance for advanced operations
     */
    getRawSdk(): MxfSDK {
        return this.sdk;
    }

    /**
     * Get all created agents
     */
    getAgents(): MxfAgent[] {
        return [...this.agents];
    }

    /**
     * Get all created channel IDs
     */
    getChannelIds(): string[] {
        return [...this.channels];
    }

    /**
     * Disconnect a specific agent
     */
    async disconnectAgent(agent: MxfAgent): Promise<void> {
        try {
            if (agent.isConnected()) {
                await agent.disconnect();
            }
        } catch (error) {
            // Ignore disconnect errors during cleanup
        }
    }

    /**
     * Clean up all resources
     */
    async cleanup(): Promise<void> {
        // Disconnect all agents
        for (const agent of this.agents) {
            await this.disconnectAgent(agent);
        }

        // Disconnect SDK
        try {
            if (this.connected) {
                await this.sdk.disconnect();
            }
        } catch (error) {
            // Ignore errors during cleanup
        }

        // Reset state
        this.agents = [];
        this.channels = [];
        this.connected = false;
    }
}

/**
 * Create a new TestSDK instance
 */
export function createTestSDK(options: TestSDKOptions = {}): TestSDK {
    return new TestSDK(options);
}
