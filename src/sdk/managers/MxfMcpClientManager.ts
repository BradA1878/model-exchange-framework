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
 * MCP Client Manager for MxfAgent
 * 
 * Manages MCP (Model Control Protocol) client initialization, configuration,
 * and interactions for LLM agents. Handles different LLM providers and
 * maintains client lifecycle.
 */

import { Logger } from '../../shared/utils/Logger';
import { IMcpClient, McpMessage, McpTool, McpApiResponse } from '../../shared/protocols/mcp/IMcpClient';
import { AgentContext } from '../../shared/interfaces/AgentContext';
import { LlmProviderType } from '../../shared/protocols/mcp/LlmProviders';
import { LlmProviderFactory } from '../../shared/protocols/mcp/LlmProviderFactory';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { firstValueFrom } from 'rxjs';

export interface McpClientConfig {
    provider: LlmProviderType;
    apiKey?: string;
    defaultModel?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    retryAttempts?: number;
}

export class MxfMcpClientManager {
    private logger: Logger;
    private agentId: string;
    private mcpClient: IMcpClient | null = null;
    private config: McpClientConfig;
    private isInitialized = false;
    private initializationPromise: Promise<void> | null = null;
    private registeredTools: McpTool[] = [];

    constructor(agentId: string, agentConfig: AgentConfig) {
        this.agentId = agentId;
        this.logger = new Logger('debug', `McpManager:${agentId}`, 'client');
        
        // Extract MCP configuration from agent config with determinism improvements
        this.config = {
            provider: agentConfig.llmProvider as LlmProviderType,
            apiKey: agentConfig.apiKey,
            defaultModel: agentConfig.defaultModel,
            // Determinism improvements: Lower temperature for more consistent behavior
            temperature: agentConfig.temperature ?? 0.1,
            maxTokens: agentConfig.maxTokens ?? 4000,
            timeout: agentConfig.requestTimeoutMs ?? 30000,
            retryAttempts: 3
        };
        
        this.validateConfig();
    }

    /**
     * Validate the MCP client configuration
     */
    private validateConfig(): void {
        if (!this.config.provider) {
            throw new Error('LLM provider is required for MCP client');
        }
        
        if (!this.config.apiKey) {
            this.logger.warn('No API key provided - some providers may require authentication');
        }
        
    }

    /**
     * Initialize the MCP client for the selected LLM provider
     */
    public async initializeMcpClient(): Promise<void> {
        // Return existing initialization promise if already in progress
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        
        // Return immediately if already initialized
        if (this.isInitialized && this.mcpClient) {
            return;
        }
        
        this.initializationPromise = this.performInitialization();
        return this.initializationPromise;
    }

    /**
     * Perform the actual MCP client initialization
     */
    private async performInitialization(): Promise<void> {
        try {
            
            // Get the provider implementation class
            const ProviderClass = await LlmProviderFactory.getImplementation(this.config.provider);
            
            // Create an instance of the provider
            this.mcpClient = new ProviderClass();
            
            // Create MCP configuration
            if (!this.config.apiKey) {
                throw new Error('API key is required for MCP client initialization');
            }
            
            const mcpConfig = {
                apiKey: this.config.apiKey,
                defaultModel: this.config.defaultModel,
                temperature: this.config.temperature,
                maxTokens: this.config.maxTokens,
                timeout: this.config.timeout
            };
            
            // Initialize the client
            const initialized = await firstValueFrom(this.mcpClient.initialize(mcpConfig));
            
            if (!initialized) {
                throw new Error('Failed to initialize MCP client');
            }
            
            this.isInitialized = true;
        } catch (error) {
            this.isInitialized = false;
            this.initializationPromise = null;
            this.logger.error(`Error initializing MCP client: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Send a message to the LLM through the MCP client (LEGACY)
     */
    public async sendMessage(messages: McpMessage[], tools?: any[], options?: Record<string, any>): Promise<McpApiResponse> {
        await this.ensureInitialized();
        
        if (!this.mcpClient) {
            throw new Error('MCP client not available');
        }
        
        try {
            //;
            
            const response = await firstValueFrom(this.mcpClient.sendMessage(messages, tools, options));
            
            //;
            return response;
        } catch (error) {
            this.logger.error(`Error sending message to LLM: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Send message using full agent context (NEW APPROACH)
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional options
     * @returns Promise with API response
     */
    public async sendWithContext(context: AgentContext, options?: Record<string, any>): Promise<McpApiResponse> {
        await this.ensureInitialized();
        
        if (!this.mcpClient) {
            throw new Error('MCP client not available');
        }
        
        // Check if client supports context-based sending
        if (!this.mcpClient.sendWithContext) {
            throw new Error('MCP client does not support context-based sending');
        }
        
        try {
            
            const response = await firstValueFrom(this.mcpClient.sendWithContext(context, options));
            
            return response;
        } catch (error) {
            this.logger.error(`❌ Error sending context-based message: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Check if the current MCP client supports context-based flow
     */
    public supportsContextBasedFlow(): boolean {
        return this.mcpClient?.sendWithContext !== undefined;
    }

    /**
     * Register a tool with the MCP client
     */
    public async registerTool(tool: McpTool): Promise<boolean> {
        await this.ensureInitialized();
        
        try {
            // Check if tool already registered
            if (this.registeredTools.some(t => t.name === tool.name)) {
                this.logger.warn(`Tool ${tool.name} already registered`);
                return true;
            }
            
            // Add to local registry
            this.registeredTools.push(tool);
            
            return true;
        } catch (error) {
            this.logger.error(`Failed to register tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Unregister a tool from the MCP client
     */
    public async unregisterTool(toolName: string): Promise<boolean> {
        try {
            // Remove from local registry
            const initialLength = this.registeredTools.length;
            this.registeredTools = this.registeredTools.filter(tool => tool.name !== toolName);
            
            if (this.registeredTools.length < initialLength) {
                return true;
            } else {
                this.logger.warn(`Tool ${toolName} was not registered`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Failed to unregister tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Get all registered tools
     */
    public getRegisteredTools(): McpTool[] {
        return [...this.registeredTools];
    }

    /**
     * Check if MCP client is initialized and ready
     */
    public isReady(): boolean {
        return this.isInitialized && this.mcpClient !== null;
    }

    /**
     * Get current MCP client configuration
     */
    public getConfig(): McpClientConfig {
        return { ...this.config };
    }

    /**
     * Update MCP client configuration
     */
    public async updateConfig(newConfig: Partial<McpClientConfig>): Promise<void> {
        
        this.config = {
            ...this.config,
            ...newConfig
        };
        
        this.validateConfig();
        
        // If provider changed, reinitialize
        if (newConfig.provider && newConfig.provider !== this.config.provider) {
            await this.reinitialize();
        }
    }

    /**
     * Reinitialize the MCP client (useful after config changes)
     */
    public async reinitialize(): Promise<void> {
        
        // Reset state
        this.isInitialized = false;
        this.initializationPromise = null;
        this.mcpClient = null;
        
        // Initialize again
        await this.initializeMcpClient();
    }

    /**
     * Test the MCP client connection
     */
    public async testConnection(): Promise<boolean> {
        try {
            await this.ensureInitialized();
            
            if (!this.mcpClient) {
                return false;
            }
            
            // Send a simple test message
            const testMessages: McpMessage[] = [{
                role: 'user' as any,
                content: {
                    type: 'text' as any,
                    text: 'test'
                }
            }];
            
            await firstValueFrom(this.mcpClient.sendMessage(testMessages, []));
            
            return true;
        } catch (error) {
            this.logger.error(`MCP client connection test failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Get MCP client statistics
     */
    public getStatistics(): {
        isInitialized: boolean;
        isReady: boolean;
        provider: LlmProviderType;
        registeredToolsCount: number;
        config: McpClientConfig;
    } {
        return {
            isInitialized: this.isInitialized,
            isReady: this.isReady(),
            provider: this.config.provider,
            registeredToolsCount: this.registeredTools.length,
            config: this.getConfig()
        };
    }

    /**
     * Ensure MCP client is initialized
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initializeMcpClient();
        }
        
        if (!this.mcpClient) {
            throw new Error('MCP client initialization failed');
        }
    }

    /**
     * Cleanup the MCP client manager
     */
    public async cleanup(): Promise<void> {
        
        try {
            // Clear registered tools
            this.registeredTools = [];
            
            // Reset client state
            this.mcpClient = null;
            this.isInitialized = false;
            this.initializationPromise = null;
            
        } catch (error) {
            this.logger.error(`Error during MCP client cleanup: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get the underlying MCP client (for advanced usage)
     */
    public getMcpClient(): IMcpClient | null {
        return this.mcpClient;
    }

    /**
     * Set a custom MCP client (for testing or custom implementations)
     */
    public setMcpClient(client: IMcpClient): void {
        this.mcpClient = client;
        this.isInitialized = true;
    }
}