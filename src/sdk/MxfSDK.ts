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
 * MxfSDK - Primary SDK entry point for Model Exchange Framework
 * 
 * This class handles:
 * 1. Domain key authentication (SDK → Server)
 * 2. User authentication (JWT or username/password)
 * 3. Agent creation and management
 * 
 * USAGE:
 * ```typescript
 * import { MxfSDK } from '@mxf/sdk';
 * 
 * // Initialize SDK with domain key and user credentials
 * const sdk = new MxfSDK({
 *     serverUrl: 'http://localhost:3001',
 *     domainKey: process.env.MXF_DOMAIN_KEY,
 *     userId: 'demo-user',
 *     userToken: 'jwt_token'  // OR use username/password
 * });
 * 
 * await sdk.connect();
 * 
 * // Create agents via SDK instance
 * const agent = await sdk.createAgent({
 *     agentId: 'my-agent',
 *     name: 'My Agent',
 *     channelId: 'my-channel',
 *     keyId: 'key-123',
 *     secretKey: 'secret-456',
 *     llmProvider: 'openrouter',
 *     defaultModel: 'anthropic/claude-3.5-sonnet'
 * 
 * await agent.connect();
 * ```
 */

import { v4 as uuidv4 } from 'uuid';
import { Events } from '../shared/events/EventNames';
import { MxfAgent } from './MxfAgent';
import { MxfChannelMonitor } from './MxfChannelMonitor';
import { Logger } from '../shared/utils/Logger';
import { createStrictValidator } from '../shared/utils/validation';
import { createBaseEventPayload } from '../shared/schemas/EventPayloadSchema';
import { LlmProviderType } from '../shared/protocols/mcp/LlmProviders';
import { AgentConfig, LlmReasoningConfig } from '../shared/interfaces/AgentInterfaces';
import { ChannelConfig } from '../shared/interfaces/ChannelConfig';
import { default as socketIO } from 'socket.io-client';

const moduleLogger = new Logger('debug', 'MxfSDK', 'client');

/**
 * MxfSDK configuration interface
 */
export interface MxfSDKConfig {
    // Server connection
    serverUrl: string;
    domainKey: string;
    
    // User authentication (one of these sets is required)
    userId?: string;
    userToken?: string;  // JWT token
    username?: string;
    password?: string;
    
    // Optional settings
    secure?: boolean;
    reconnection?: boolean;
    reconnectionAttempts?: number;
}

/**
 * Agent creation configuration
 * Simplified config - host/port/secure/apiUrl are derived from SDK's serverUrl
 */
export interface AgentCreationConfig {
    // Required fields
    agentId: string;
    name: string;
    channelId: string;
    keyId: string;
    secretKey: string;
    llmProvider: LlmProviderType;
    defaultModel: string;
    
    // Optional agent identity
    agentConfigPrompt?: string;  // Agent's identity/role (optional, will use default if not provided)
    description?: string;
    capabilities?: string[];
    metadata?: Record<string, any>;
    
    // Optional LLM settings
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
    reasoning?: LlmReasoningConfig;  // Claude extended thinking: { enabled: true, effort: 'medium', maxTokens: 10000 }
    allowedTools?: string[];
    circuitBreakerExemptTools?: string[];  // Tools exempt from circuit breaker detection (for game tools, etc.)
    useMessageAggregate?: boolean;
    maxIterations?: number;  // Max LLM iterations per task (default: 10, increase for game scenarios)
    
    // Optional behavioral settings
    disableTaskHandling?: boolean;  // Disable automatic task handling (for utility agents that only register MCP servers)
    
    // Optional MXP settings
    mxpEnabled?: boolean;
    mxpPreferredFormat?: 'auto' | 'mxp' | 'natural-language';
    mxpForceEncryption?: boolean;
}

/**
 * MxfSDK - Main SDK class
 */
export class MxfSDK {
    private config: MxfSDKConfig;
    private socket: ReturnType<typeof socketIO> | null = null;
    private authenticated: boolean = false;
    private userToken: string | null = null;
    private agents: Map<string, MxfAgent> = new Map();
    private userId: string = 'sdk-user';  // Default user ID for socket events

    constructor(config: MxfSDKConfig) {
        // Validate required config
        if (!config.serverUrl) {
            throw new Error('serverUrl is required');
        }
        if (!config.domainKey) {
            throw new Error('domainKey is required');
        }

        // Validate user authentication
        const hasJWT = config.userId && config.userToken;
        const hasCredentials = config.username && config.password;
        
        if (!hasJWT && !hasCredentials) {
            throw new Error('User authentication required: provide either (userId + userToken) or (username + password)');
        }

        this.config = config;
    }

    /**
     * Connect SDK to MXF server
     * Establishes socket connection for admin operations (channel/key creation)
     */
    async connect(): Promise<void> {
        // Validate we have authentication credentials
        if (!this.config.userToken && !(this.config.username && this.config.password)) {
            throw new Error('Must provide either userToken or username/password for authentication');
        }
        
        // Validate domain key
        if (!this.config.domainKey) {
            throw new Error('Domain key is required for SDK connection');
        }
        
        // Set userId for socket events
        this.userId = this.config.userId || this.config.username || 'sdk-user';
        
        // Connect socket for admin operations
        await this.connectSocket();
        
        this.authenticated = true;
    }

    /**
     * Connect socket with domain key and user authentication
     */
    private async connectSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            const socketOptions: any = {
                reconnection: this.config.reconnection ?? true,
                reconnectionAttempts: this.config.reconnectionAttempts ?? 5,
                auth: {
                    domainKey: this.config.domainKey
                }
            };

            // Add user authentication
            if (this.config.userToken) {
                socketOptions.auth.token = this.config.userToken;
                socketOptions.auth.userId = this.userId;
            } else if (this.config.username && this.config.password) {
                socketOptions.auth.username = this.config.username;
                socketOptions.auth.password = this.config.password;
            }

            this.socket = socketIO(this.config.serverUrl, socketOptions);

            this.socket.on('connect', () => {
            });

            this.socket.on('connect_error', (error: Error) => {
                moduleLogger.error(`SDK socket connection error: ${error.message}`);
                reject(new Error(`Socket connection failed: ${error.message}`));
            });

            this.socket.on('disconnect', (reason: string) => {
                moduleLogger.warn(`SDK socket disconnected: ${reason}`);
            });

            // Wait for authentication to complete before resolving
            this.socket.on('auth:success', (data: any) => {
                
                // Update userId from server response (it's the MongoDB ObjectId, not username)
                if (data.userId) {
                    this.userId = data.userId;
                }
                
                resolve();
            });

            this.socket.on('auth:error', (data: any) => {
                moduleLogger.error(`Authentication failed: ${JSON.stringify(data)}`);
                reject(new Error(`Authentication failed: ${data.error || 'Unknown error'}`));
            });
        });
    }


    /**
     * Create an agent instance
     * 
     * @param config Agent creation configuration
     * @returns Configured MxfAgent instance (not yet connected)
     */
    async createAgent(config: AgentCreationConfig): Promise<MxfAgent> {
        if (!this.authenticated) {
            throw new Error('SDK must be connected before creating agents. Call sdk.connect() first.');
        }

        // Parse server URL to get host and port
        const url = new URL(this.config.serverUrl);
        const host = url.hostname;
        const port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);

        // Build agent configuration with all optional fields
        const agentConfig: AgentConfig = {
            agentId: config.agentId,
            name: config.name,
            channelId: config.channelId,
            host: host,
            port: port,
            secure: this.config.secure ?? (url.protocol === 'https:'),
            apiUrl: `${this.config.serverUrl}/api`,
            keyId: config.keyId,
            secretKey: config.secretKey,
            description: config.description || '',
            capabilities: config.capabilities || [],
            metadata: config.metadata || {},
            llmProvider: config.llmProvider,
            apiKey: config.apiKey || '',
            defaultModel: config.defaultModel,
            agentConfigPrompt: config.agentConfigPrompt || `You are ${config.name}, an AI agent in the ${config.channelId} channel.`,
            // Pass through all optional LLM settings
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            reasoning: config.reasoning,
            allowedTools: config.allowedTools,
            circuitBreakerExemptTools: config.circuitBreakerExemptTools,
            useMessageAggregate: config.useMessageAggregate,
            maxIterations: config.maxIterations,
            // Pass through behavioral settings
            disableTaskHandling: config.disableTaskHandling,
            // Pass through MXP settings
            mxpEnabled: config.mxpEnabled,
            mxpPreferredFormat: config.mxpPreferredFormat,
            mxpForceEncryption: config.mxpForceEncryption,
            // Add domain key to agent auth
            sdkDomainKey: this.config.domainKey
        };

        const agent = new MxfAgent(agentConfig);
        this.agents.set(config.agentId, agent);

        return agent;
    }

    /**
     * Create a channel via socket event
     * 
     * Returns a channel monitor that can be used to listen to events in the channel.
     * 
     * @param channelId Channel identifier
     * @param config Channel configuration
     * @returns Promise resolving to MxfChannelMonitor for event monitoring
     * 
     * @example
     * ```typescript
     * const channel = await sdk.createChannel('my-channel', {
     *     name: 'My Channel',
     *     description: 'A collaborative workspace',
     *     isPrivate: false,
     *     requireApproval: false,
     *     maxAgents: 50,
     *     allowAnonymous: false,
     *     metadata: { project: 'demo' }
     * });
     * 
     * // Listen to channel events
     * channel.on(Events.Message.AGENT_MESSAGE, (payload) => {
     *     console.log('Message:', payload.data.content);
     * });
     * ```
     */
    async createChannel(channelId: string, config: Partial<ChannelConfig> & { name: string }): Promise<MxfChannelMonitor> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        // Destructure config with defaults
        const {
            name,
            description = '',
            isPrivate = false,
            requireApproval = false,
            maxAgents = 100,
            allowAnonymous = false,
            metadata = {},
            allowedTools = [],
            systemLlmEnabled = true,
            mcpServers = []
        } = config;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Channel creation timeout'));
            }, 10000);

            // Listen for success
            const onCreated = async (payload: any) => {
                if (payload.channelId === channelId) {
                    clearTimeout(timeout);
                    this.socket?.off(Events.Channel.CREATED, onCreated);
                    this.socket?.off(Events.Channel.CREATION_FAILED, onFailed);
                    
                    // Register MCP servers if provided
                    if (mcpServers.length > 0) {
                        for (const serverConfig of mcpServers) {
                            try {
                                await this.registerChannelMcpServer(channelId, serverConfig);
                            } catch (error) {
                                moduleLogger.error(`Failed to register MCP server ${serverConfig.id}: ${error}`);
                            }
                        }
                    }
                    
                    // Create and return channel monitor
                    const channelMonitor = new MxfChannelMonitor(channelId);
                    resolve(channelMonitor);
                }
            };

            // Listen for failure
            const onFailed = (payload: any) => {
                if (payload.channelId === channelId) {
                    clearTimeout(timeout);
                    this.socket?.off(Events.Channel.CREATED, onCreated);
                    this.socket?.off(Events.Channel.CREATION_FAILED, onFailed);
                    reject(new Error(payload.data?.error || 'Channel creation failed'));
                }
            };

            this.socket!.on(Events.Channel.CREATED, onCreated);
            this.socket!.on(Events.Channel.CREATION_FAILED, onFailed);

            // Emit channel creation event with full config including new fields
            const payloadData = {
                name,
                description,
                isPrivate,
                requireApproval,
                maxAgents,
                allowAnonymous,
                metadata,
                allowedTools,
                systemLlmEnabled
            };

            const payload = createBaseEventPayload(
                Events.Channel.CREATE,
                this.userId,
                channelId,
                payloadData
            );

            this.socket!.emit(Events.Channel.CREATE, payload);
        });
    }

    /**
     * Register an MCP server for a channel via EventBus
     * 
     * This allows registering MCP servers at the SDK level without requiring an agent.
     * 
     * @param channelId Channel identifier
     * @param serverConfig MCP server configuration
     * @returns Promise resolving to registration result
     */
    async registerChannelMcpServer(channelId: string, serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio' | 'http';
        url?: string;
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        keepAliveMinutes?: number;
    }): Promise<{ success: boolean; toolsDiscovered?: string[] }> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        const { McpEvents } = require('../shared/events/event-definitions/McpEvents');
        const socket = this.socket;

        return new Promise((resolve, reject) => {
            let registrationCompleted = false;

            // Handler for successful registration
            const registrationHandler = (payload: any) => {
                if (payload.data?.serverId === serverConfig.id &&
                    payload.data?.scopeId === channelId &&
                    !registrationCompleted) {
                    registrationCompleted = true;
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTERED, registrationHandler);
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED, errorHandler);

                    const discoveredTools = payload.data?.tools?.map((t: any) => t.name) || [];
                    resolve({ success: true, toolsDiscovered: discoveredTools });
                }
            };

            // Handler for registration failure
            const errorHandler = (payload: any) => {
                if (payload.data?.serverId === serverConfig.id && !registrationCompleted) {
                    registrationCompleted = true;
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTERED, registrationHandler);
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED, errorHandler);

                    reject(new Error(payload.data?.error || 'Channel server registration failed'));
                }
            };

            socket.on(McpEvents.CHANNEL_SERVER_REGISTERED, registrationHandler);
            socket.on(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED, errorHandler);

            // Emit registration request via socket (EventBus pattern)
            const registrationPayload = {
                eventId: uuidv4(),
                eventType: McpEvents.CHANNEL_SERVER_REGISTER,
                timestamp: Date.now(),
                agentId: this.userId,
                channelId: channelId,
                data: {
                    ...serverConfig,
                    channelId: channelId
                }
            };

            socket.emit(McpEvents.CHANNEL_SERVER_REGISTER, registrationPayload);

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!registrationCompleted) {
                    registrationCompleted = true;
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTERED, registrationHandler);
                    socket.off(McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED, errorHandler);
                    reject(new Error('Channel server registration timeout after 30 seconds'));
                }
            }, 30000);
        });
    }

    /**
     * Unregister an MCP server from a channel
     * 
     * @param channelId Channel identifier
     * @param serverId Server identifier
     * @returns Promise resolving to true if successful
     */
    async unregisterChannelMcpServer(channelId: string, serverId: string): Promise<boolean> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        const { McpEvents } = require('../shared/events/event-definitions/McpEvents');
        const socket = this.socket;

        return new Promise((resolve, reject) => {
            const responseHandler = (payload: any) => {
                if (payload.data?.serverId === serverId) {
                    socket.off(McpEvents.CHANNEL_SERVER_UNREGISTERED, responseHandler);
                    resolve(payload.data?.success ?? true);
                }
            };

            socket.on(McpEvents.CHANNEL_SERVER_UNREGISTERED, responseHandler);

            socket.emit(McpEvents.CHANNEL_SERVER_UNREGISTER, {
                eventId: uuidv4(),
                eventType: McpEvents.CHANNEL_SERVER_UNREGISTER,
                timestamp: Date.now(),
                agentId: this.userId,
                channelId: channelId,
                data: { serverId, channelId }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                socket.off(McpEvents.CHANNEL_SERVER_UNREGISTERED, responseHandler);
                reject(new Error('Channel server unregistration timeout'));
            }, 30000);
        });
    }

    /**
     * Generate a channel key via socket event
     * 
     * @param channelId Channel identifier
     * @param agentId Agent identifier (optional)
     * @param name Key name (optional)
     * @param expiresAt Expiration date (optional)
     * @returns Promise resolving to key generation result
     */
    async generateKey(channelId: string, agentId?: string, name?: string, expiresAt?: Date): Promise<{ keyId: string; secretKey: string; channelId: string }> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Key generation timeout'));
            }, 10000);

            // Listen for success
            const onGenerated = (payload: any) => {
                if (payload.data.channelId === channelId) {
                    clearTimeout(timeout);
                    this.socket?.off(Events.Key.GENERATED, onGenerated);
                    this.socket?.off(Events.Key.GENERATION_FAILED, onFailed);
                    resolve({
                        keyId: payload.data.keyId,
                        secretKey: payload.data.secretKey,
                        channelId: payload.data.channelId
                    });
                }
            };

            // Listen for failure
            const onFailed = (payload: any) => {
                if (payload.data?.channelId === channelId) {
                    clearTimeout(timeout);
                    this.socket?.off(Events.Key.GENERATED, onGenerated);
                    this.socket?.off(Events.Key.GENERATION_FAILED, onFailed);
                    reject(new Error(payload.data?.error || 'Key generation failed'));
                }
            };

            this.socket!.on(Events.Key.GENERATED, onGenerated);
            this.socket!.on(Events.Key.GENERATION_FAILED, onFailed);

            // Emit key generation event
            const payload = createBaseEventPayload(
                Events.Key.GENERATE,
                this.userId,
                channelId,
                { 
                    channelId,
                    agentId,
                    name,
                    expiresAt: expiresAt?.toISOString()
                }
            );

            this.socket!.emit(Events.Key.GENERATE, payload);
        });
    }

    /**
     * Get an agent by ID
     */
    getAgent(agentId: string): MxfAgent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Get all agents created by this SDK instance
     */
    getAllAgents(): MxfAgent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Register an external MCP server
     *
     * This allows developers to add their own MCP servers to MXF dynamically.
     * The server will be started and its tools will become available to agents.
     *
     * @param serverConfig External server configuration
     * @returns Promise resolving to true if registration was successful
     *
     * @example
     * ```typescript
     * await sdk.registerExternalMcpServer({
     *   id: 'my-custom-server',
     *   name: 'My Custom Server',
     *   command: 'npx',
     *   args: ['-y', 'my-mcp-package']
     * });
     * ```
     */
    async registerExternalMcpServer(serverConfig: {
        id: string;
        name: string;
        command?: string;
        args?: string[];
        transport?: 'stdio' | 'http';
        url?: string;
        autoStart?: boolean;
        environmentVariables?: Record<string, string>;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
    }): Promise<{ success: boolean; toolsDiscovered?: string[] }> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        const socket = this.socket; // Capture reference for closure

        return new Promise((resolve, reject) => {
            try {

                let registrationCompleted = false;

                // Set up handler for registration response
                const responseHandler = (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id && !registrationCompleted) {
                        if (!payload.data?.success) {
                            registrationCompleted = true;
                            socket.off('mcp:external:server:registered', responseHandler);
                            socket.off('mcp:external:server:registration:failed', errorHandler);
                            socket.off('mcp:external:server:tools:discovered', toolsHandler);
                            moduleLogger.error(`Failed to register server ${serverConfig.name}`);
                            resolve({ success: false });
                        }
                        // Don't resolve yet - wait for tools to be discovered
                    }
                };

                // Set up handler for tool discovery (this is when tools are actually available)
                const toolsHandler = (payload: any) => {
                    if (!registrationCompleted) {
                        const discoveredTools = payload.data?.tools?.map((t: any) => t.name) || [];

                        registrationCompleted = true;
                        socket.off('mcp:external:server:registered', responseHandler);
                        socket.off('mcp:external:server:registration:failed', errorHandler);
                        socket.off('mcp:external:server:tools:discovered', toolsHandler);

                        resolve({ success: true, toolsDiscovered: discoveredTools });
                    }
                };

                const errorHandler = (payload: any) => {
                    if (payload.data?.serverId === serverConfig.id && !registrationCompleted) {
                        registrationCompleted = true;
                        socket.off('mcp:external:server:registered', responseHandler);
                        socket.off('mcp:external:server:registration:failed', errorHandler);
                        socket.off('mcp:external:server:tools:discovered', toolsHandler);

                        reject(new Error(payload.data?.error || 'Server registration failed'));
                    }
                };

                socket.on('mcp:external:server:registered', responseHandler);
                socket.on('mcp:external:server:registration:failed', errorHandler);
                socket.on('mcp:external:server:tools:discovered', toolsHandler);

                // Emit registration request
                socket.emit('mcp:external:server:register', {
                    eventId: uuidv4(),
                    eventType: 'mcp:external:server:register',
                    timestamp: Date.now(),
                    agentId: this.userId,
                    channelId: 'system',
                    data: serverConfig
                });

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (!registrationCompleted) {
                        registrationCompleted = true;
                        socket.off('mcp:external:server:registered', responseHandler);
                        socket.off('mcp:external:server:registration:failed', errorHandler);
                        socket.off('mcp:external:server:tools:discovered', toolsHandler);
                        reject(new Error('External server registration timeout after 30 seconds (tools not discovered)'));
                    }
                }, 30000);

            } catch (error) {
                moduleLogger.error(`Error registering external server: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Unregister an external MCP server
     *
     * Stops and removes an external MCP server from MXF.
     *
     * @param serverId ID of the server to unregister
     * @returns Promise resolving to true if unregistration was successful
     */
    async unregisterExternalMcpServer(serverId: string): Promise<boolean> {
        if (!this.socket || !this.socket.connected) {
            throw new Error('SDK socket not connected. Call sdk.connect() first.');
        }

        const socket = this.socket; // Capture reference for closure

        return new Promise((resolve, reject) => {
            try {

                // Set up one-time handler for response
                const responseHandler = (payload: any) => {
                    if (payload.data?.serverId === serverId) {
                        socket.off('mcp:external:server:unregistered', responseHandler);

                        if (payload.data?.success) {
                            resolve(true);
                        } else {
                            moduleLogger.error(`Failed to unregister server ${serverId}`);
                            resolve(false);
                        }
                    }
                };

                socket.on('mcp:external:server:unregistered', responseHandler);

                // Emit unregistration request
                socket.emit('mcp:external:server:unregister', {
                    eventId: uuidv4(),
                    eventType: 'mcp:external:server:unregister',
                    timestamp: Date.now(),
                    agentId: this.userId,
                    channelId: 'system',
                    data: { serverId }
                });

                // Timeout after 30 seconds
                setTimeout(() => {
                    socket.off('mcp:external:server:unregistered', responseHandler);
                    reject(new Error('External server unregistration timeout after 30 seconds'));
                }, 30000);

            } catch (error) {
                moduleLogger.error(`Error unregistering external server: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * Disconnect SDK and all agents
     */
    async disconnect(): Promise<void> {

        // Disconnect all agents
        for (const agent of this.agents.values()) {
            try {
                await agent.disconnect();
            } catch (error) {
                moduleLogger.error(`Error disconnecting agent: ${error}`);
            }
        }

        // Disconnect SDK socket
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.authenticated = false;
        this.agents.clear();

    }

    /**
     * Check if SDK is connected and authenticated
     */
    isConnected(): boolean {
        return this.authenticated && this.socket?.connected === true;
    }

    /**
     * Get the authenticated user ID
     */
    getUserId(): string | undefined {
        return this.config.userId;
    }

    /**
     * Get server URL
     */
    getServerUrl(): string {
        return this.config.serverUrl;
    }
}
