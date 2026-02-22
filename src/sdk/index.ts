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
 * Model Exchange Framework - SDK Exports
 * 
 * This is the primary entry point for the MXF SDK.
 * Only public APIs are exported - internal implementation details are hidden.
 * 
 * IMPORTANT: EventBus is NOT exported - it is internal only.
 * Use agent.on() for event listening and agent.channelService for operations.
 */

// ============================================================================
// CORE SDK CLASS
// ============================================================================

/**
 * MxfSDK - Primary and ONLY SDK entry point
 * 
 * This is the main SDK class that handles domain key authentication and user auth.
 * All agents MUST be created through this SDK instance.
 * 
 * @example
 * ```typescript
 * import { MxfSDK } from '@mxf/sdk';
 * 
 * // Initialize SDK with domain key and user credentials
 * const sdk = new MxfSDK({
 *     serverUrl: 'http://localhost:3001',
 *     domainKey: process.env.MXF_DOMAIN_KEY,  // REQUIRED
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
 *     keyId: 'key-123',
 *     secretKey: 'secret-456',
 *     llmProvider: 'openrouter',
 *     defaultModel: 'anthropic/claude-3.5-sonnet'
 * });
 * ```
 */

/**
 * Events namespace - Use with agent.on() for event listening
 * 
 * @example
 * ```typescript
 * import { MxfSDK, Events } from '@mxf/sdk';
 * 
 * const sdk = new MxfSDK({ ... });
 * await sdk.connect();
 * const agent = await sdk.createAgent({ ... });
 * 
 * agent.on(Events.Message.AGENT_MESSAGE, (message) => {
 *     console.log('Received:', message.content);
 * });
 * 
 * agent.on(Events.Task.ASSIGNED, (task) => {
 *     console.log('New task:', task.taskId);
 * });
 * ```
 */
export { Events } from '../shared/events/EventNames';

// ============================================================================
// TYPES - Public type definitions
// ============================================================================

/**
 * Task configuration for creating tasks
 */
export type { TaskConfig } from './services/MxfService';

/**
 * Task event callbacks for event handling
 */
export type { TaskEventCallbacks } from './services/MxfService';

/**
 * Admin operation types for channel and key management
 * 
 * Note: These types are exported for reference but the underlying MxfService
 * is internal. Use the MXF CLI tools or dashboard for channel/key management.
 * 
 * @example
 * ```typescript
 * // Use CLI for channel/key management:
 * // npm run sdk:cli -- channel:create --channelId my-channel --name "My Channel"
 * // npm run sdk:cli -- key:generate --channelId my-channel --agentId new-agent
 * 
 * // Or import types for reference:
 * import { ChannelCreateConfig, KeyGenerateConfig } from '@mxf/sdk';
 * ```
 */
export type { 
    ChannelCreateConfig, 
    ChannelCreateResult, 
    KeyGenerateResult, 
    KeyInfo 
} from './services/MxfService';

/**
 * MxfSDK - Primary SDK entry point (ONLY way to create agents)
 */
export { MxfSDK } from './MxfSDK';
export type { MxfSDKConfig, AgentCreationConfig } from './MxfSDK';

/**
 * Agent configuration interface
 */
export type { AgentConfig } from '../shared/interfaces/AgentInterfaces';

/**
 * Channel configuration interface
 * 
 * Used when creating channels via sdk.createChannel().
 * All fields except 'name' are optional with sensible defaults.
 * 
 * @example
 * ```typescript
 * import { MxfSDK, type ChannelConfig } from '@mxf/sdk';
 * 
 * const channelConfig: Partial<ChannelConfig> & { name: string } = {
 *     name: 'My Channel',
 *     description: 'A workspace for collaboration',
 *     isPrivate: false,
 *     maxAgents: 50
 * };
 * 
 * const channel = await sdk.createChannel('my-channel', channelConfig);
 * ```
 */
export type { ChannelConfig } from '../shared/interfaces/ChannelConfig';

/**
 * Task interfaces
 */
export type { SimpleTaskRequest, SimpleTaskResponse, TaskRequestHandler } from '../shared/interfaces/TaskInterfaces';

/**
 * LLM Provider types
 */
export { LlmProviderType } from '../shared/protocols/mcp/LlmProviders';

/**
 * Connection status enum
 */
export { ConnectionStatus } from '../shared/types/types';

/**
 * MxfAgent type - For type annotations only
 * 
 * Note: Do NOT instantiate MxfAgent directly. Use sdk.createAgent() instead.
 * This type export allows for proper TypeScript typing when storing agent references.
 * 
 * @example
 * ```typescript
 * import { MxfSDK, type MxfAgent } from '@mxf/sdk';
 * 
 * const agents: { [key: string]: MxfAgent } = {};
 * const agent = await sdk.createAgent({ ... });
 * agents['my-agent'] = agent;
 * ```
 */
export type { MxfAgent } from './MxfAgent';

/**
 * MxfChannelMonitor - Channel event monitor
 * 
 * Lightweight event monitor returned by sdk.createChannel().
 * Enables channel-level event monitoring without requiring an agent instance.
 * 
 * @example
 * ```typescript
 * import { MxfSDK, Events, type MxfChannelMonitor } from '@mxf/sdk';
 * 
 * const sdk = new MxfSDK({ ... });
 * await sdk.connect();
 * 
 * // Create channel and get monitor
 * const channel: MxfChannelMonitor = await sdk.createChannel('my-channel', 'My Channel');
 * 
 * // Listen to channel events
 * channel.on(Events.Message.AGENT_MESSAGE, (payload) => {
 *     console.log('Message:', payload.data.content);
 * });
 * ```
 */
export { MxfChannelMonitor } from './MxfChannelMonitor';

/**
 * SDK Configuration Manager
 * 
 * Manages SDK-level configuration including SystemLLM settings.
 * Use this to enable/disable SystemLLM for channels and configure other SDK features.
 * 
 * @example
 * ```typescript
 * import { ConfigManager } from '@mxf/sdk';
 * 
 * const configManager = ConfigManager.getInstance();
 * 
 * // Disable SystemLLM for a channel
 * configManager.setChannelSystemLlmEnabled(false, 'Demo channel - agents handle coordination');
 * ```
 */
export { ConfigManager } from './config/ConfigManager';

/**
 * MXP 2.0 Configuration Manager
 * 
 * Manages MXP (Model Exchange Protocol) configuration for channels.
 * Use this to enable/disable token optimization, bandwidth optimization, and security levels.
 * 
 * @example
 * ```typescript
 * import { MxpConfigManager, SecurityLevel } from '@mxf/sdk';
 * 
 * const mxpManager = MxpConfigManager.getInstance();
 * const config = mxpManager.createChannelConfig('my-channel', {
 *     enableTokenOptimization: true,
 *     securityLevel: SecurityLevel.ENHANCED
 * });
 * ```
 */
export { MxpConfigManager } from '../shared/mxp/MxpConfigManager';

/**
 * MXP Security Levels
 * 
 * Defines security levels for MXP protocol:
 * - STANDARD: Basic security
 * - ENHANCED: Additional encryption
 * - REGULATED: Compliance-grade security
 * - CLASSIFIED: Maximum security
 */
export { SecurityLevel } from '../shared/types/MxpTypes';

/**
 * Public Event Name Type
 * 
 * Type representing all public events that can be listened to via agent.on().
 * Internal/sensitive events are NOT included for security.
 * 
 * @example
 * ```typescript
 * import { Events, type PublicEventName } from '@mxf/sdk';
 * 
 * const eventName: PublicEventName = Events.Message.CHANNEL_MESSAGE;
 * agent.on(eventName, (data) => console.log(data));
 * ```
 */
export type { PublicEventName } from '../shared/events/PublicEvents';

/**
 * User Input types for handling user input requests from agents.
 *
 * Use these types when implementing a handler for agent.onUserInput().
 *
 * @example
 * ```typescript
 * import type { UserInputHandler, UserInputRequestData, UserInputResponseValue } from '@mxf/sdk';
 *
 * const handler: UserInputHandler = async (request: UserInputRequestData): Promise<UserInputResponseValue> => {
 *     // Render prompt based on request.inputType and return the user's answer
 * };
 *
 * agent.onUserInput(handler);
 * ```
 */
export type { UserInputHandler } from './handlers/UserInputHandlers';
export type {
    UserInputRequestData,
    UserInputResponseValue,
    UserInputType,
    UserInputUrgency,
    UserInputTheme,
    InputConfig,
    TextInputConfig,
    SelectInputConfig,
    MultiSelectInputConfig,
    ConfirmInputConfig,
} from '../shared/events/event-definitions/UserInputEvents';

