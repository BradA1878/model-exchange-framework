/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * AgentInterfaces.ts
 * 
 * Defines interfaces and types for agent configuration and management
 * in the Model Exchange Framework.
 */

/**
 * LLM Reasoning configuration interface
 * Supports both OpenAI/ChatGPT style (effort) and Anthropic/Claude style (max_tokens)
 */
export interface LlmReasoningConfig {
    enabled?: boolean;                    // Enable reasoning with default "medium" effort
    effort?: 'low' | 'medium' | 'high';  // OpenAI/ChatGPT style: effort level (20%, 50%, 80% of max_tokens)
    maxTokens?: number;                   // Anthropic/Claude style: direct token allocation for reasoning
    exclude?: boolean;                    // If true, reasoning used internally but not returned in response
}

/**
 * Base Agent configuration interface
 */
export interface AgentConfig {
    // Basic agent properties
    agentId: string;
    channelId: string;
    name: string;
    description?: string;
    capabilities?: string[];
    metadata?: Record<string, any>;
    
    // Connection details
    host: string;
    port: number;
    secure: boolean;
    
    // API access
    keyId: string;
    secretKey: string;
    apiUrl: string;
    apiKey: string;
    
    // SDK domain key (internal - set by MxfSDK)
    sdkDomainKey?: string;
    
    // Behavioral properties
    autoRegister?: boolean;
    autoReconnect?: boolean;
    reconnectAttempts?: number;
    reconnectDelay?: number;
    requestTimeoutMs?: number; // Added missing property
    useMessageAggregate?: boolean; // Enable message aggregation for high-volume agents
    disableTaskHandling?: boolean; // Disable automatic task handling (for admin/utility agents that only register MCP servers)
    
    // Control loop properties
    maxObservations?: number;
    cycleInterval?: number;
    maxIterations?: number;                  // Max LLM iterations per task (default: 10, increase for game scenarios)

    // LLM properties
    agentConfigPrompt: string;              // Agent's identity and role configuration prompt (renamed from systemPrompt)
    temperature?: number;
    maxTokens?: number;
    maxHistory?: number;
    maxMessageSize?: number;                // Max size in bytes for a single message (default: 100KB) - prevents MongoDB 16MB limit errors
    defaultModel?: string;
    llmProvider?: string;                   // e.g., 'openrouter', 'azure-openai', 'openai', 'anthropic'
    enableTooling?: boolean;
    reasoning?: LlmReasoningConfig;        // Optional reasoning configuration for advanced models
    
    // Provider-specific configuration
    // For Azure OpenAI, use:
    //   providerOptions: {
    //     endpoint: 'https://your-resource.openai.azure.com/',
    //     deployment: 'gpt-4-1-mini',
    //     apiVersion: '2024-04-01-preview'
    //   }
    providerOptions?: Record<string, any>;
    
    // Tool access control
    allowedTools?: string[];
    circuitBreakerExemptTools?: string[];    // Tools exempt from circuit breaker detection (for game tools, etc.)
    
    // Name resolution and interpretation settings
    commonNames?: string[];                                        // Alternative names/aliases for this agent
    preferredResponseMode?: 'tools' | 'natural' | 'mixed';       // How agent prefers to respond
    interpretationEnabled?: boolean;                               // Enable SystemLLM interpretation (default: true)
    actionHistoryWindow?: number;                                  // Number of recent actions to include (default: 20)
    
    // Utilities
    logger?: any;
    
    // MXP Protocol Configuration
    mxpEnabled?: boolean;
    mxpPreferredFormat?: 'auto' | 'mxp' | 'natural-language';
    mxpForceEncryption?: boolean;
}

/**
 * Extended Agent configuration interface with additional properties used internally
 */
export interface InternalAgentConfig extends AgentConfig {
    channelService?: any;
}

// For backward compatibility
export type MxfAgentConfig = AgentConfig;
