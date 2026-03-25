/**
 * MXF CLI TUI — Interactive Session Manager
 *
 * Manages a persistent SDK session for the interactive TUI with multi-agent support.
 * Creates a shared channel and agents (loaded from .md files) on connect().
 * Keeps all agents alive across multiple user tasks.
 *
 * Supports named sessions (`--session <name>`) for multi-terminal collaboration.
 * Named sessions use the session name as channel ID, so multiple terminals
 * with the same flag share a channel and see each other's agent activity.
 *
 * Lifecycle:
 *   connect() → [submitTask() / submitTaskToAgent()] → disconnect()
 *
 * Follows the multi-agent pattern from examples/fog-of-war-game/connect-agents.ts
 * and the user_input pattern from examples/user-input-demo/user-input-demo.ts.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { v4 as uuidv4 } from 'uuid';
import { MxfSDK, LlmProviderType, MxfChannelMonitor } from '../../../sdk/index';
import type { MxfAgent, UserInputRequestData, UserInputResponseValue } from '../../../sdk/index';
import type { TuiConfig } from '../types';
import type { AgentDefinition } from '../agents/AgentDefinitions';

/** A connected agent with its credentials and definition */
interface AgentConnection {
    /** The SDK agent instance */
    agent: MxfAgent;
    /** Per-agent credentials for REST API cleanup */
    credentials: { keyId: string; secretKey: string };
    /** The agent's role definition */
    definition: AgentDefinition;
}

/**
 * Callback signature for user input requests from agents.
 * The TUI registers this to render confirmation prompts inline.
 *
 * @param agentId - ID of the agent requesting input
 * @param request - The full user input request data
 */
export type UserInputCallback = (agentId: string, request: UserInputRequestData) => void;

/**
 * InteractiveSessionManager — manages a multi-agent SDK session for the TUI.
 *
 * Creates a channel and agents on connect(), keeps them alive for
 * multiple submitTask() calls, and tears everything down on disconnect().
 *
 * The orchestrator agent (role: 'orchestrator') receives user tasks by default.
 * Use submitTaskToAgent() to route tasks to specific agents (e.g., via @mention).
 *
 * Agents that call `user_input` with `inputType: 'confirm'` trigger the
 * registered user input callback, which the TUI renders as [y/n] prompts.
 *
 * Named sessions (`--session <name>`) use the session name as channel ID,
 * allowing multiple terminals to share a channel. On disconnect, named
 * sessions skip channel/memory deletion so other terminals remain functional.
 */
export class InteractiveSessionManager {
    private config: TuiConfig;
    private sdk: MxfSDK | null = null;
    private agents: Map<string, AgentConnection> = new Map();
    private channel: MxfChannelMonitor | null = null;
    private channelId: string;
    private cleanupDone: boolean = false;
    private connected: boolean = false;
    private defaultModel: string;
    /** Whether this is a named session (shared across terminals) */
    private isNamedSession: boolean;

    /** Callback invoked when any agent requests user input — set by the TUI */
    private userInputCallback: UserInputCallback | null = null;

    /** Pending Promise resolvers for user input requests — keyed by requestId */
    private pendingInputResolvers: Map<string, (value: UserInputResponseValue) => void> = new Map();

    constructor(config: TuiConfig) {
        this.config = config;
        this.defaultModel = config.defaultModel;
        this.isNamedSession = !!config.sessionName;
        // Named sessions use the session name as channel ID for cross-terminal sharing.
        // Ephemeral sessions generate a unique channel ID.
        this.channelId = config.sessionName
            ? `mxf-session-${config.sessionName}`
            : `mxf-tui-${Date.now()}-${uuidv4().substring(0, 8)}`;
    }

    /**
     * Connect to the MXF server and set up the channel and agents.
     *
     * Lifecycle: SDK connect → channel create → for each agent definition:
     *   key generate → agent create → register onUserInput → agent connect.
     *
     * Agent definitions come from TuiConfig.agentDefinitions (loaded from .md files).
     * All agents are created eagerly. Idle agents consume no LLM credits.
     */
    async connect(): Promise<void> {
        if (this.connected) {
            throw new Error('Session is already connected');
        }

        // Step 1: Connect SDK
        this.sdk = new MxfSDK({
            serverUrl: this.config.serverUrl,
            domainKey: this.config.domainKey,
            accessToken: this.config.accessToken,
        });
        await this.sdk.connect();

        // Step 2: Create or join channel.
        // Named sessions attempt to create the channel. If it already exists
        // (another terminal created it), we create a MxfChannelMonitor directly
        // to listen for events on the existing channel.
        // Ephemeral sessions always create a new channel.
        if (this.isNamedSession) {
            try {
                this.channel = await this.sdk.createChannel(this.channelId, {
                    name: `MXF Session: ${this.config.sessionName}`,
                    description: `Named shared session: ${this.config.sessionName}`,
                    systemLlmEnabled: false,
                });
            } catch {
                // Channel already exists — create a monitor to observe events
                this.channel = new MxfChannelMonitor(this.channelId);
            }
        } else {
            this.channel = await this.sdk.createChannel(this.channelId, {
                name: 'MXF CLI Interactive',
                description: 'Multi-agent interactive TUI session',
                systemLlmEnabled: false,
            });
        }

        // Step 3: Create and connect agents from definitions
        const llmProvider = this.mapLlmProvider(this.config.llmProvider);
        const definitions = this.config.agentDefinitions;

        for (const definition of definitions) {
            await this.connectAgent(definition, llmProvider);
        }

        this.connected = true;
    }

    /**
     * Connect a single agent to the session.
     *
     * Generates per-agent keys, creates the agent via SDK, registers
     * user input handler if the agent has user_input in its tools, and
     * connects the agent to the channel.
     *
     * For orchestrator agents, appends a dynamic team roster to the system
     * prompt so the orchestrator only knows about actually-enabled agents.
     *
     * @param definition - The agent definition
     * @param llmProvider - LLM provider enum value
     */
    private async connectAgent(definition: AgentDefinition, llmProvider?: LlmProviderType): Promise<void> {
        if (!this.sdk) {
            throw new Error('SDK not connected');
        }

        const provider = llmProvider || this.mapLlmProvider(this.config.llmProvider);

        // Generate per-agent keys
        const keys = await this.sdk.generateKey(this.channelId);
        const credentials = { keyId: keys.keyId, secretKey: keys.secretKey };

        // For orchestrator agents, inject a dynamic team roster so it only
        // delegates to agents that are actually enabled in this session.
        let systemPrompt = definition.systemPrompt;
        if (definition.role === 'orchestrator') {
            systemPrompt = this.buildOrchestratorPrompt(definition);
        }

        // Inject the working directory so agents know where file operations resolve.
        // Agents MUST use absolute paths because the MCP filesystem server resolves
        // relative paths against the server's cwd, not the TUI's --cwd directory.
        systemPrompt += `\n\n## Working Directory\nYour working directory is: ${this.config.workingDirectory}\nIMPORTANT: Always use ABSOLUTE file paths for all file operations (read_file, write_file, list_directory, etc.).\nConstruct paths by joining this working directory with relative filenames.\nExample: ${this.config.workingDirectory}/output.md`;

        // Create agent with role-specific config
        const agent = await this.sdk.createAgent({
            agentId: definition.agentId,
            name: definition.name,
            channelId: this.channelId,
            keyId: keys.keyId,
            secretKey: keys.secretKey,
            llmProvider: provider,
            apiKey: this.config.apiKey,
            defaultModel: this.config.agentModels?.[definition.agentId] || this.defaultModel,
            agentConfigPrompt: systemPrompt,
            maxIterations: definition.maxIterations,
            temperature: definition.temperature,
            maxTokens: definition.maxTokens,
            reasoning: {
                enabled: definition.reasoningEnabled,
                effort: definition.reasoningEffort,
            },
            allowedTools: definition.allowedTools,
        });

        // Register user input handler on agents that have user_input in their tools.
        // This creates the Promise bridge for confirmation prompts.
        if (definition.allowedTools.includes('user_input')) {
            agent.onUserInput(this.createUserInputHandler(definition.agentId));
        }

        // Connect agent to channel
        await agent.connect();

        // Store connection
        this.agents.set(definition.agentId, { agent, credentials, definition });
    }

    /**
     * Add a new agent to a running session.
     *
     * Used by the `/agents enable` slash command to connect an agent mid-session.
     *
     * @param definition - The agent definition to add
     */
    async addAgent(definition: AgentDefinition): Promise<void> {
        if (!this.connected) {
            throw new Error('Session is not connected. Call connect() first.');
        }

        if (this.agents.has(definition.agentId)) {
            throw new Error(`Agent already connected: ${definition.agentId}`);
        }

        await this.connectAgent(definition);
    }

    /**
     * Remove an agent from a running session.
     *
     * Used by the `/agents disable` slash command to disconnect an agent mid-session.
     * Cannot remove the orchestrator agent.
     *
     * @param agentId - ID of the agent to remove
     */
    async removeAgent(agentId: string): Promise<void> {
        const connection = this.agents.get(agentId);
        if (!connection) {
            throw new Error(`Agent not found: ${agentId}`);
        }

        if (connection.definition.role === 'orchestrator') {
            throw new Error('Cannot remove the orchestrator agent.');
        }

        // Disconnect agent
        await connection.agent.disconnect().catch(() => {});

        // Clean up memory for ephemeral sessions
        if (!this.isNamedSession) {
            await fetch(`${this.config.serverUrl}/api/agents/${agentId}/memory`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'x-key-id': connection.credentials.keyId,
                    'x-secret-key': connection.credentials.secretKey,
                },
            }).catch(() => {});
        }

        this.agents.delete(agentId);
    }

    /**
     * Get the definitions of all currently connected agents.
     *
     * @returns Array of AgentDefinition objects for connected agents
     */
    getConnectedDefinitions(): AgentDefinition[] {
        return [...this.agents.values()].map(c => c.definition);
    }

    /**
     * Submit a task to the orchestrator agent (default routing).
     *
     * Finds the agent with role: 'orchestrator' and assigns the task to it.
     * The orchestrator will decompose complex tasks and delegate subtasks
     * to specialist agents as needed.
     *
     * @param task - The user's task description
     * @param contextString - Optional file/directory context
     * @param recentResult - Optional summary of the most recent completed task result,
     *   appended to the description so follow-up tasks have continuity
     */
    async submitTask(task: string, contextString?: string | null, recentResult?: string | null): Promise<void> {
        if (!this.connected) {
            throw new Error('Session is not connected. Call connect() first.');
        }

        // Find the orchestrator agent (role-based, not hardcoded ID)
        const orchestrator = [...this.agents.values()]
            .find(c => c.definition.role === 'orchestrator');

        if (!orchestrator) {
            throw new Error('No orchestrator agent found. Enable an agent with role: orchestrator.');
        }

        let description = task;
        if (contextString) {
            description += '\n\nContext:\n' + contextString;
        }
        // Append recent task result so follow-up tasks have continuity
        // (e.g., "can you display it?" knows which file was created)
        if (recentResult) {
            description += '\n\nPrevious task result:\n' + recentResult;
        }

        await orchestrator.agent.mxfService.createTask({
            title: task,
            description,
            assignedAgentIds: [orchestrator.definition.agentId],
            assignmentScope: 'single',
            assignmentStrategy: 'manual',
            priority: 'high',
            metadata: {
                source: 'mxf-cli-tui',
                workingDirectory: this.config.workingDirectory,
            },
        });
    }

    /**
     * Submit a task directly to a specific agent (for @mention routing).
     *
     * Bypasses the orchestrator and assigns the task directly to the target agent.
     *
     * @param task - The task description
     * @param agentId - Target agent ID (e.g., 'mxf-operator')
     * @param contextString - Optional file/directory context
     */
    async submitTaskToAgent(task: string, agentId: string, contextString?: string | null): Promise<void> {
        if (!this.connected) {
            throw new Error('Session is not connected. Call connect() first.');
        }

        const connection = this.agents.get(agentId);
        if (!connection) {
            throw new Error(`Agent not found: ${agentId}`);
        }

        let description = task;
        if (contextString) {
            description += '\n\nContext:\n' + contextString;
        }

        await connection.agent.mxfService.createTask({
            title: task,
            description,
            assignedAgentIds: [agentId],
            assignmentScope: 'single',
            assignmentStrategy: 'manual',
            priority: 'high',
            metadata: {
                source: 'mxf-cli-tui',
                directMention: true,
                workingDirectory: this.config.workingDirectory,
            },
        });
    }

    /**
     * Register a callback for user input requests from agents.
     *
     * The TUI calls this to bridge agent user_input requests to React state.
     * When any agent calls `user_input` with `inputType: 'confirm'`, the callback
     * is invoked so the TUI can render a [y/n] prompt.
     *
     * @param callback - Function called with (agentId, request) when an agent needs input
     */
    setUserInputCallback(callback: UserInputCallback): void {
        this.userInputCallback = callback;
    }

    /**
     * Resolve a pending user input request with the user's response.
     *
     * Called by the TUI when the user responds to a confirmation prompt.
     * This resolves the Promise that the agent's user_input tool call is blocking on.
     *
     * @param requestId - The request ID from the ConfirmationData
     * @param value - The user's response (boolean for confirm, string for text, etc.)
     */
    resolveUserInput(requestId: string, value: UserInputResponseValue): void {
        const resolver = this.pendingInputResolvers.get(requestId);
        if (resolver) {
            resolver(value);
            this.pendingInputResolvers.delete(requestId);
        }
    }

    /**
     * Get the channel monitor for event subscription.
     *
     * Used by useEventMonitor hook to subscribe to AGENT_MESSAGE,
     * TOOL_CALL, TASK_COMPLETED, and TASK_FAILED events.
     */
    getChannel(): MxfChannelMonitor | null {
        return this.channel;
    }

    /** Whether the session is currently connected */
    isConnected(): boolean {
        return this.connected;
    }

    /** Get the current channel ID */
    getChannelId(): string {
        return this.channelId;
    }

    /**
     * Update the default model for subsequent tasks.
     * Used by the /model slash command.
     */
    setDefaultModel(model: string): void {
        this.defaultModel = model;
    }

    /** Get the current default model */
    getDefaultModel(): string {
        return this.defaultModel;
    }

    /** Get the per-agent model overrides from config */
    getAgentModels(): Record<string, string> {
        return this.config.agentModels || {};
    }

    /**
     * Create a user input handler for a specific agent.
     *
     * Returns a handler function that:
     * 1. Notifies the TUI via the registered callback
     * 2. Returns a Promise that resolves when the user responds
     *
     * The Promise is stored in pendingInputResolvers and resolved
     * when resolveUserInput() is called by the TUI.
     *
     * @param agentId - The agent ID this handler is for
     * @returns Handler function matching the UserInputHandler signature
     */
    private createUserInputHandler(agentId: string): (request: UserInputRequestData) => Promise<UserInputResponseValue> {
        return (request: UserInputRequestData): Promise<UserInputResponseValue> => {
            // UserInputHandlers already filters so only the requesting agent's handler
            // fires (agentId match). No dedup needed here — each requestId arrives once.

            // Notify the TUI about the user input request
            if (this.userInputCallback) {
                this.userInputCallback(agentId, request);
            }

            // Return a Promise that resolves when the TUI calls resolveUserInput()
            return new Promise<UserInputResponseValue>((resolve) => {
                this.pendingInputResolvers.set(request.requestId, resolve);
            });
        };
    }

    /**
     * Build the orchestrator's system prompt with a dynamic team roster.
     *
     * Appends an "Available Team" section listing all non-orchestrator agents
     * that are enabled for this session. This ensures the orchestrator only
     * delegates to agents that actually exist.
     *
     * @param orchestrator - The orchestrator agent definition
     * @returns The system prompt with the team roster appended
     */
    private buildOrchestratorPrompt(orchestrator: AgentDefinition): string {
        const teammates = this.config.agentDefinitions.filter(
            d => d.agentId !== orchestrator.agentId,
        );

        const teamLines = teammates.map(d => {
            return `- **${d.name}** (${d.agentId}): ${d.description}`;
        });

        const teamSection = [
            '',
            '## Available Team',
            '',
            ...teamLines,
            '',
            'Only delegate to the agents listed above. Do NOT message or assign tasks to any other agent IDs.',
        ].join('\n');

        return orchestrator.systemPrompt + teamSection;
    }

    /**
     * Map an LLM provider string from config to the LlmProviderType enum.
     * Same logic as SessionRunner.mapLlmProvider().
     */
    private mapLlmProvider(provider: string): LlmProviderType {
        const providerMap: Record<string, LlmProviderType> = {
            openrouter: LlmProviderType.OPENROUTER,
            anthropic: LlmProviderType.ANTHROPIC,
            openai: LlmProviderType.OPENAI,
            gemini: LlmProviderType.GEMINI,
            xai: LlmProviderType.XAI,
            ollama: LlmProviderType.OLLAMA,
            'azure-openai': LlmProviderType.AZURE_OPENAI,
        };

        const mapped = providerMap[provider.toLowerCase()];
        if (!mapped) {
            throw new Error(`Unknown LLM provider: ${provider}. Supported: ${Object.keys(providerMap).join(', ')}`);
        }
        return mapped;
    }

    /**
     * Disconnect and clean up all resources.
     *
     * For ephemeral sessions: disconnects agents, deletes agent memory and
     * channel via REST, destroys the channel monitor, and disconnects the SDK.
     *
     * For named sessions: disconnects agents but preserves the channel and
     * agent memory so other terminals sharing the session remain functional.
     *
     * Safe to call multiple times.
     */
    async disconnect(): Promise<void> {
        if (this.cleanupDone) return;
        this.cleanupDone = true;
        this.connected = false;

        // Clear pending input resolvers — resolve with false to unblock any waiting tools
        for (const [requestId, resolver] of this.pendingInputResolvers) {
            resolver(false);
        }
        this.pendingInputResolvers.clear();

        // Disconnect all agents.
        // For named sessions, skip memory/channel deletion — other terminals may
        // still be connected and agents may still be active.
        for (const [agentId, connection] of this.agents) {
            // Disconnect agent from channel
            await connection.agent.disconnect().catch(() => {});

            // Only delete agent memory for ephemeral sessions
            if (!this.isNamedSession) {
                await fetch(`${this.config.serverUrl}/api/agents/${agentId}/memory`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-key-id': connection.credentials.keyId,
                        'x-secret-key': connection.credentials.secretKey,
                    },
                }).catch(() => {});
            }
        }

        // Only delete the channel for ephemeral sessions
        if (!this.isNamedSession) {
            const firstConnection = this.agents.values().next().value;
            if (firstConnection) {
                await fetch(`${this.config.serverUrl}/api/channels/${this.channelId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-key-id': firstConnection.credentials.keyId,
                        'x-secret-key': firstConnection.credentials.secretKey,
                    },
                }).catch(() => {});
            }
        }

        this.agents.clear();

        // Destroy channel monitor
        if (this.channel) {
            this.channel.destroy();
        }

        // Disconnect SDK
        if (this.sdk) {
            await this.sdk.disconnect().catch(() => {});
        }
    }
}
