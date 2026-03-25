/**
 * MXF CLI Session Runner
 *
 * Encapsulates the full SDK lifecycle for a one-shot `mxf run` execution:
 * SDK connect → channel create → key generate → agent create → agent connect
 * → task create → monitor events → wait for completion → cleanup.
 *
 * Follows the same pattern as examples/user-input-demo/user-input-demo.ts
 * but tailored for CLI one-shot execution with TTY-aware output.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { v4 as uuidv4 } from 'uuid';
import { MxfSDK, Events, LlmProviderType } from '../../sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../sdk/index';
import { CORE_MXF_TOOLS } from '../../shared/constants/CoreTools';
import { logSuccess, logError, logInfo, logWarning, logHeader, logStep } from '../utils/output';
import chalk from 'chalk';

/** Planner agent system prompt for one-shot task execution */
const PLANNER_PROMPT = `You are a task execution agent. Complete the user's task thoroughly and report your results.

When you have completed the task, use the task_complete tool to signal completion with your final output.
Include a clear summary in the task_complete tool's summary field.

Be concise but thorough. Focus on delivering actionable results.`;

/** Configuration for a one-shot session run */
export interface SessionRunnerConfig {
    /** Server URL (e.g., http://localhost:3001) */
    serverUrl: string;
    /** Domain key from ~/.mxf/config.json */
    domainKey: string;
    /** User access token (PAT format: tokenId:secret) */
    accessToken: string;
    /** LLM provider name (maps to LlmProviderType) */
    llmProvider: string;
    /** LLM API key */
    apiKey: string;
    /** Default model identifier (e.g., anthropic/claude-sonnet-4-20250514) */
    defaultModel: string;
    /** The user's task description */
    task: string;
    /** Optional file/directory context from --context flag */
    contextString?: string;
    /** Output format: text (default), json, or md */
    format: 'text' | 'json' | 'md';
    /** Timeout in milliseconds */
    timeoutMs: number;
    /** Whether stdout is a TTY (controls colors/spinners) */
    isTTY: boolean;
}

/** Result from a completed session run */
export interface SessionResult {
    /** Whether the task completed successfully */
    success: boolean;
    /** Final agent output / task result summary */
    output: string;
    /** Tool calls made during execution */
    toolCalls: ToolCallRecord[];
    /** Total elapsed time in milliseconds */
    elapsedMs: number;
    /** Error message if task failed */
    error?: string;
}

/** Record of a single tool call during execution */
export interface ToolCallRecord {
    /** Tool name */
    name: string;
    /** Tool input arguments */
    input: Record<string, any>;
    /** Tool result (if captured) */
    result?: string;
    /** Timestamp of the tool call */
    timestamp: number;
}

/**
 * SessionRunner — manages a single one-shot task execution lifecycle.
 *
 * Creates an ephemeral channel and agent, submits a task, monitors events,
 * and performs cleanup on completion, timeout, or interruption.
 */
export class SessionRunner {
    private config: SessionRunnerConfig;
    private sdk: MxfSDK | null = null;
    private agent: MxfAgent | null = null;
    private channel: MxfChannelMonitor | null = null;
    private channelId: string;
    private agentId: string = 'mxf-planner';
    private credentials: { keyId: string; secretKey: string } | null = null;
    private cleanupDone: boolean = false;
    private toolCalls: ToolCallRecord[] = [];
    private agentMessages: string[] = [];

    constructor(config: SessionRunnerConfig) {
        this.config = config;
        // Generate a unique channel ID for this run
        this.channelId = `mxf-run-${Date.now()}-${uuidv4().substring(0, 8)}`;
    }

    /**
     * Execute the one-shot session.
     *
     * Lifecycle: connect → channel → key → agent → task → wait → cleanup.
     * Returns the session result with output and metadata.
     */
    async run(): Promise<SessionResult> {
        const startTime = Date.now();

        // Register signal handlers for clean shutdown
        const sigintHandler = async () => {
            this.log('\n\nInterrupted (Ctrl+C)');
            await this.cleanup();
            process.exit(130);
        };
        const sigtermHandler = async () => {
            this.log('\nTerminated');
            await this.cleanup();
            process.exit(143);
        };
        process.on('SIGINT', sigintHandler);
        process.on('SIGTERM', sigtermHandler);

        try {
            // Step 1: Connect SDK
            this.logProgress('Connecting to MXF server...');
            this.sdk = new MxfSDK({
                serverUrl: this.config.serverUrl,
                domainKey: this.config.domainKey,
                accessToken: this.config.accessToken,
            });
            await this.sdk.connect();
            this.logProgress('Connected');

            // Step 2: Create ephemeral channel
            this.logProgress('Creating session...');
            this.channel = await this.sdk.createChannel(this.channelId, {
                name: 'MXF CLI Run',
                description: `One-shot task: ${this.config.task.substring(0, 100)}`,
                systemLlmEnabled: false,
            });

            // Step 3: Generate agent keys
            const keys = await this.sdk.generateKey(this.channelId);
            this.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };

            // Step 4: Setup event monitoring (before agent connects)
            const { completionPromise, resolveCompletion } = this.setupMonitoring();

            // Step 5: Create and connect agent
            this.logProgress('Starting agent...');
            const llmProvider = this.mapLlmProvider(this.config.llmProvider);
            this.agent = await this.sdk.createAgent({
                agentId: this.agentId,
                name: 'Planner',
                channelId: this.channelId,
                keyId: keys.keyId,
                secretKey: keys.secretKey,
                llmProvider,
                apiKey: this.config.apiKey,
                defaultModel: this.config.defaultModel,
                agentConfigPrompt: PLANNER_PROMPT,
                allowedTools: [...CORE_MXF_TOOLS],
                maxIterations: 20,
                temperature: 0.3,
                maxTokens: 8000,
            });
            const connected = await this.agent.connect();
            if (!connected) {
                throw new Error('Agent failed to connect to MXF server. Check server logs for details.');
            }

            // Step 5b: Ensure tools are loaded before creating a task.
            // connect() loads tools as part of performFullConnection(); refreshTools()
            // forces a fresh fetch so the cache is guaranteed to be populated.
            const tools = await this.agent.refreshTools();
            if (!tools || tools.length === 0) {
                throw new Error('No tools available from server. Ensure the MXF server started correctly.');
            }
            this.logProgress(`Agent ready (${tools.length} tools)`);

            // Step 6: Build task description and create task
            const taskDescription = this.buildTaskDescription();
            this.logProgress('Running task...\n');

            await this.agent.mxfService.createTask({
                title: this.config.task,
                description: taskDescription,
                assignedAgentIds: [this.agentId],
                assignmentScope: 'single',
                assignmentStrategy: 'manual',
                priority: 'high',
                metadata: {
                    source: 'mxf-cli-run',
                    format: this.config.format,
                },
            });

            // Step 7: Wait for completion or timeout
            const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
                setTimeout(() => resolve({ timedOut: true }), this.config.timeoutMs);
            });

            const result = await Promise.race([completionPromise, timeoutPromise]);

            const elapsedMs = Date.now() - startTime;

            if ('timedOut' in result) {
                this.logProgress(`\nTask timed out after ${Math.round(this.config.timeoutMs / 1000)}s`);
                return {
                    success: false,
                    output: this.agentMessages.join('\n'),
                    toolCalls: this.toolCalls,
                    elapsedMs,
                    error: `Task timed out after ${Math.round(this.config.timeoutMs / 1000)} seconds`,
                };
            }

            // Completed or failed
            return {
                success: result.success,
                output: result.output || this.agentMessages.join('\n'),
                toolCalls: this.toolCalls,
                elapsedMs,
                error: result.error,
            };
        } catch (error: any) {
            const elapsedMs = Date.now() - startTime;
            return {
                success: false,
                output: this.agentMessages.join('\n'),
                toolCalls: this.toolCalls,
                elapsedMs,
                error: error.message || String(error),
            };
        } finally {
            // Remove signal handlers to avoid leaking
            process.removeListener('SIGINT', sigintHandler);
            process.removeListener('SIGTERM', sigtermHandler);

            await this.cleanup();
        }
    }

    /**
     * Setup channel event monitoring.
     *
     * Subscribes to AGENT_MESSAGE, TOOL_CALL, TASK_COMPLETED, and TASK_FAILED events.
     * Returns a promise that resolves when the task completes or fails.
     */
    private setupMonitoring(): {
        completionPromise: Promise<{ success: boolean; output: string; error?: string }>;
        resolveCompletion: (value: { success: boolean; output: string; error?: string }) => void;
    } {
        let resolveCompletion: (value: { success: boolean; output: string; error?: string }) => void;
        const completionPromise = new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
            resolveCompletion = resolve;
        });

        if (!this.channel) {
            throw new Error('Channel must be created before setting up monitoring');
        }

        const processedIds = new Set<string>();
        let taskCompleted = false;

        // Listen for agent messages — print to stdout as they arrive
        this.channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
            try {
                // Deduplicate messages
                const messageId = payload.data?.metadata?.messageId ||
                    `${payload.agentId}-${payload.timestamp || Date.now()}`;
                if (processedIds.has(messageId)) return;
                processedIds.add(messageId);
                setTimeout(() => processedIds.delete(messageId), 5000);

                // Extract message content (handle different payload shapes)
                let content = payload.data?.content || payload.data?.message || '';
                if (typeof content === 'object') {
                    content = content.data || content.content || JSON.stringify(content);
                }

                if (content && content.length > 0) {
                    this.agentMessages.push(content);
                    this.printAgentMessage(content);
                }
            } catch (error) {
                // Don't crash on message processing errors
            }
        });

        // Listen for tool calls — show one-line summaries
        this.channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            this.toolCalls.push({
                name: toolName,
                input: args,
                timestamp: Date.now(),
            });

            // Don't print task_complete tool calls — the completion handler does that
            if (toolName === 'task_complete') return;

            this.printToolCall(toolName, args);
        });

        // Listen for task completion
        this.channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;

            // Extract result from completion payload
            const result = payload.data?.task?.result;
            const summary = result?.summary || payload.data?.summary || '';

            // Brief delay for any final messages to arrive
            setTimeout(() => {
                resolveCompletion!({ success: true, output: summary });
            }, 500);
        });

        // Listen for task failure
        this.channel.on(Events.Task.FAILED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;

            const error = payload.data?.error || 'Task failed';
            setTimeout(() => {
                resolveCompletion!({ success: false, output: '', error });
            }, 500);
        });

        return { completionPromise, resolveCompletion: resolveCompletion! };
    }

    /**
     * Build the full task description including optional context.
     */
    private buildTaskDescription(): string {
        let description = this.config.task;

        if (this.config.contextString) {
            description += '\n\nContext:\n' + this.config.contextString;
        }

        return description;
    }

    /**
     * Print an agent message to the appropriate output stream.
     * Respects format and TTY settings.
     */
    private printAgentMessage(content: string): void {
        if (this.config.format === 'json') {
            // In JSON mode, agent messages go to stderr so stdout stays clean for final JSON
            process.stderr.write(`${content}\n`);
            return;
        }

        if (this.config.isTTY) {
            // TTY: colored output
            process.stdout.write(`${content}\n`);
        } else {
            // Piped: plain text
            process.stdout.write(`${content}\n`);
        }
    }

    /**
     * Print a tool call summary as a dim one-liner.
     */
    private printToolCall(toolName: string, args: Record<string, any>): void {
        if (this.config.format === 'json') {
            // JSON mode: tool calls go to stderr
            process.stderr.write(`[tool] ${toolName}: ${JSON.stringify(args).substring(0, 100)}\n`);
            return;
        }

        const argsPreview = JSON.stringify(args).substring(0, 80);

        if (this.config.isTTY) {
            process.stdout.write(chalk.dim(`  [tool] ${toolName}: ${argsPreview}\n`));
        } else {
            process.stdout.write(`  [tool] ${toolName}: ${argsPreview}\n`);
        }
    }

    /**
     * Print progress messages (only in TTY mode, always to stderr in JSON mode).
     */
    private logProgress(message: string): void {
        if (this.config.format === 'json') {
            process.stderr.write(`${message}\n`);
            return;
        }

        if (this.config.isTTY) {
            logInfo(message);
        }
        // Non-TTY text/md mode: suppress progress messages to keep output clean
    }

    /**
     * Print a message regardless of mode (for errors, interruptions).
     */
    private log(message: string): void {
        process.stderr.write(`${message}\n`);
    }

    /**
     * Map an LLM provider string from config to the LlmProviderType enum.
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
     * Cleanup all resources: disconnect agent, delete channel, disconnect SDK.
     * Safe to call multiple times.
     */
    private async cleanup(): Promise<void> {
        if (this.cleanupDone) return;
        this.cleanupDone = true;

        // Disconnect agent
        if (this.agent) {
            await this.agent.disconnect().catch(() => {});
        }

        // Delete agent memory (clean up ephemeral agent data)
        if (this.credentials) {
            await fetch(`${this.config.serverUrl}/api/agents/${this.agentId}/memory`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'x-key-id': this.credentials.keyId,
                    'x-secret-key': this.credentials.secretKey,
                },
            }).catch(() => {});

            // Delete ephemeral channel
            await fetch(`${this.config.serverUrl}/api/channels/${this.channelId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'x-key-id': this.credentials.keyId,
                    'x-secret-key': this.credentials.secretKey,
                },
            }).catch(() => {});
        }

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
