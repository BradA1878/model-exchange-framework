/**
 * MXF Desktop — SDK Sidecar Bridge
 *
 * Runs as a child process spawned by the Tauri app. Uses the real MXF SDK
 * (InteractiveSessionManager) to connect to the server, then bridges
 * commands and events between the webview and the SDK via JSON-RPC over
 * stdin/stdout.
 *
 * Protocol:
 *   Webview → Sidecar (stdin):  JSON-RPC requests  { id, method, params }
 *   Sidecar → Webview (stdout): JSON-RPC responses  { id, result/error }
 *                                Event notifications { event, data }
 *
 * The sidecar manages the full SDK lifecycle:
 *   1. Reads config from ~/.mxf/config.json
 *   2. Creates InteractiveSessionManager
 *   3. Connects to the MXF server (creates channel + agents)
 *   4. Forwards events from MxfChannelMonitor → stdout
 *   5. Routes commands from stdin → SDK methods
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { InteractiveSessionManager } from '../../cli/tui/services/InteractiveSessionManager';
import { getEnabledAgentDefinitions, getAgentMaps } from '../../cli/tui/agents/AgentDefinitions';
import { loadAll, loadBuiltIn } from '../../cli/tui/agents/AgentLoader';
import { Events } from '../../sdk/index';
import { disableClientLogging } from '../../shared/utils/Logger';
import { ConfigService } from '../../cli/services/ConfigService';
import type { TuiConfig } from '../../cli/tui/types';
import type { MxfChannelMonitor } from '../../sdk/index';
import readline from 'readline';

// Suppress SDK console logging — we communicate via structured JSON only
disableClientLogging();

/** Send a JSON message to the webview via stdout */
function send(message: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(message) + '\n');
}

/** Send an event notification to the webview */
function sendEvent(event: string, data: Record<string, unknown>): void {
    send({ event, data });
}

/** Send a JSON-RPC response */
function sendResponse(id: string | number, result: unknown): void {
    send({ id, result });
}

/** Send a JSON-RPC error response */
function sendError(id: string | number, code: number, message: string): void {
    send({ id, error: { code, message } });
}

/** Main sidecar process */
async function main(): Promise<void> {
    // ─── Load Config ─────────────────────────────────────────────
    const configService = ConfigService.getInstance();
    const config = configService.load();

    if (!config) {
        sendEvent('error', { message: 'No MXF configuration found. Run `mxf install` first.' });
        process.exit(1);
    }

    if (!config.user?.accessToken) {
        sendEvent('error', { message: 'No user access token. Run `mxf install --complete-setup`.' });
        process.exit(1);
    }

    if (!config.llm?.provider || !config.llm?.apiKey) {
        sendEvent('error', { message: 'LLM not configured. Run `mxf init`.' });
        process.exit(1);
    }

    // ─── Load Agent Definitions ──────────────────────────────────
    const customDir = config.agents?.customAgentsDir;
    const allAvailable = loadAll(customDir);

    let enabledIds: string[];
    if (config.agents?.enabled && config.agents.enabled.length > 0) {
        enabledIds = [...config.agents.enabled];
        // Auto-detect new built-in agents
        const builtInDefs = loadBuiltIn();
        const newBuiltIn = builtInDefs.filter(d => !enabledIds.includes(d.agentId));
        if (newBuiltIn.length > 0) {
            for (const def of newBuiltIn) {
                enabledIds.push(def.agentId);
            }
            configService.set('agents', {
                enabled: enabledIds,
                customAgentsDir: config.agents?.customAgentsDir,
            });
        }
    } else {
        // Enable all agents by default
        enabledIds = allAvailable.map(d => d.agentId);
    }

    const agentDefinitions = getEnabledAgentDefinitions(enabledIds, customDir);
    if (agentDefinitions.length === 0) {
        sendEvent('error', { message: 'No valid agent definitions found.' });
        process.exit(1);
    }

    const hasOrchestrator = agentDefinitions.some(d => d.role === 'orchestrator');
    if (!hasOrchestrator) {
        sendEvent('error', { message: 'No orchestrator agent enabled.' });
        process.exit(1);
    }

    // ─── Build TUI Config ────────────────────────────────────────
    const serverUrl = `http://${config.server.host}:${config.server.port}`;
    const tuiConfig: TuiConfig = {
        serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY || config.credentials.domainKey,
        accessToken: config.user.accessToken,
        llmProvider: config.llm.provider,
        apiKey: config.llm.apiKey,
        defaultModel: config.llm.defaultModel,
        preferences: config.preferences,
        agentDefinitions,
        agentModels: config.agents?.models,
        workingDirectory: process.cwd(),
    };

    // ─── Create Session Manager ──────────────────────────────────
    const session = new InteractiveSessionManager(tuiConfig);
    const agentMaps = getAgentMaps(agentDefinitions);

    // Register user input callback — forward full request data to webview
    // Supports all input types: confirm, text, select, multi_select
    session.setUserInputCallback((agentId, request) => {
        sendEvent('user_input:request', {
            requestId: request.requestId,
            agentId,
            agentName: agentMaps.names[agentId] || agentId,
            title: request.title || 'Input needed',
            description: request.description || '',
            inputType: request.inputType,
            inputConfig: request.inputConfig || {},
            urgency: request.urgency,
            theme: request.theme,
        });
    });

    // ─── Connect to Server ───────────────────────────────────────
    sendEvent('status', { state: 'connecting' });

    try {
        await session.connect();
    } catch (error: any) {
        sendEvent('error', { message: `Connection failed: ${error.message || error}` });
        process.exit(1);
    }

    // ─── Subscribe to Channel Events ─────────────────────────────
    const channel: MxfChannelMonitor | null = session.getChannel();
    if (channel) {
        subscribeToEvents(channel, agentMaps.names);
    }

    // Send connected state with agent info
    const definitions = session.getConnectedDefinitions();
    sendEvent('status', {
        state: 'connected',
        agents: definitions.map(d => ({
            id: d.agentId,
            name: d.name,
            role: d.role,
            color: d.color,
        })),
        defaultModel: session.getDefaultModel(),
        agentModels: session.getAgentModels(),
        channelId: session.getChannelId(),
    });

    // ─── Listen for Commands from Webview ────────────────────────
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', async (line: string) => {
        let request: { id: string | number; method: string; params?: Record<string, unknown> };
        try {
            request = JSON.parse(line);
        } catch {
            return; // Ignore malformed input
        }

        const { id, method, params } = request;

        try {
            switch (method) {
                case 'submitTask': {
                    const task = params?.task as string;
                    const context = (params?.context as string) || null;
                    const workingDir = (params?.workingDirectory as string) || null;
                    if (workingDir) {
                        session.setWorkingDirectory(workingDir);
                    }
                    await session.submitTask(task, context);
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'submitTaskToAgent': {
                    const task = params?.task as string;
                    const agentId = params?.agentId as string;
                    const context = (params?.context as string) || null;
                    const workingDir = (params?.workingDirectory as string) || null;
                    if (workingDir) {
                        session.setWorkingDirectory(workingDir);
                    }
                    await session.submitTaskToAgent(task, agentId, context);
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'confirmationResponse': {
                    const requestId = params?.requestId as string;
                    const approved = params?.approved as boolean;
                    session.resolveUserInput(requestId, approved);
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'userInputResponse': {
                    // Generic response handler for all input types (text, select, multi_select, confirm)
                    const requestId = params?.requestId as string;
                    const value = params?.value as string | string[] | boolean;
                    session.resolveUserInput(requestId, value);
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'setModel': {
                    const model = params?.model as string;
                    session.setDefaultModel(model);
                    sendResponse(id, { ok: true, model });
                    break;
                }

                case 'compactAgent': {
                    const agentId = params?.agentId as string;
                    if (agentId) {
                        session.compactAgent(agentId);
                    }
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'getAgents': {
                    const defs = session.getConnectedDefinitions();
                    sendResponse(id, defs.map(d => ({
                        id: d.agentId,
                        name: d.name,
                        role: d.role,
                        color: d.color,
                    })));
                    break;
                }

                case 'cancelTask': {
                    // Cancel in-flight work by disconnecting and reconnecting all agents.
                    // This kills any active LLM calls and resets agent state.
                    try {
                        await session.reconnectAgents();
                        sendEvent('task:failed', {
                            agentId: '',
                            error: 'Task cancelled by user.',
                        });
                    } catch (err: any) {
                        sendEvent('error', { message: `Cancel failed: ${err.message || err}` });
                    }
                    sendResponse(id, { ok: true });
                    break;
                }

                case 'disconnect': {
                    await session.disconnect();
                    sendResponse(id, { ok: true });
                    process.exit(0);
                    break;
                }

                default:
                    sendError(id, -32601, `Unknown method: ${method}`);
            }
        } catch (error: any) {
            sendError(id, -32603, error.message || 'Internal error');
        }
    });

    // Handle process signals for clean shutdown
    process.on('SIGINT', async () => {
        await session.disconnect();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await session.disconnect();
        process.exit(0);
    });
}

/**
 * Subscribe to all MxfChannelMonitor events and forward them to the webview.
 * Mirrors the TUI's useEventMonitor logic, but outputs structured JSON instead
 * of dispatching React state actions.
 */
function subscribeToEvents(channel: MxfChannelMonitor, agentNames: Record<string, string>): void {
    const processedIds = new Set<string>();

    // Agent messages
    channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
        const messageId = payload.data?.metadata?.messageId ||
            `${payload.agentId}-${Date.now()}`;
        if (processedIds.has(messageId)) return;
        processedIds.add(messageId);
        setTimeout(() => processedIds.delete(messageId), 5000);

        let content = payload.data?.content || payload.data?.message || '';
        if (typeof content === 'object') {
            content = content.data || content.content || JSON.stringify(content);
        }
        if (!content) return;

        const agentId = payload.agentId || '';
        sendEvent('agent:message', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            content,
        });
    });

    // Tool calls
    channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
        const toolName = payload.data?.toolName || 'unknown';
        const args = payload.data?.arguments || payload.data?.args || {};
        const agentId = payload.agentId || '';

        // Skip user_input and task_complete tool calls
        if (['user_input', 'request_user_input', 'get_user_input_response', 'task_complete', 'task_delegate'].includes(toolName)) return;

        sendEvent('tool:call', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            toolName,
            args,
        });
    });

    // Tool results
    channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
        const toolName = payload.data?.toolName || '';
        const result = payload.data?.result;
        const agentId = payload.agentId || '';

        if (['user_input', 'request_user_input', 'get_user_input_response', 'task_complete', 'task_delegate'].includes(toolName)) return;

        sendEvent('tool:result', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            toolName,
            result,
        });
    });

    // Task completed
    channel.on(Events.Task.COMPLETED, (payload: any) => {
        const task = payload.data?.task;
        const result = task?.result;
        sendEvent('task:completed', {
            agentId: task?.completedBy || payload.agentId || '',
            agentName: agentNames[task?.completedBy || ''] || '',
            summary: result?.summary || payload.data?.summary || '',
            title: task?.title || '',
            success: result?.success !== false,
        });
    });

    // Task failed
    channel.on(Events.Task.FAILED, (payload: any) => {
        sendEvent('task:failed', {
            agentId: payload.data?.agentId || payload.agentId || '',
            error: payload.data?.error || 'Task failed',
        });
    });

    // LLM usage
    channel.on(Events.Agent.LLM_USAGE, (payload: any) => {
        const agentId = payload.agentId || '';
        sendEvent('llm:usage', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            inputTokens: payload.data?.inputTokens || 0,
            outputTokens: payload.data?.outputTokens || 0,
            totalTokens: payload.data?.totalTokens || 0,
            model: payload.data?.model || '',
        });
    });

    // LLM stream chunks
    channel.on(Events.Agent.LLM_STREAM_CHUNK, (payload: any) => {
        const agentId = payload.agentId || '';
        sendEvent('llm:stream', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            chunk: payload.data?.chunk || '',
        });
    });

    // LLM reasoning (thinking/chain-of-thought)
    channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
        const agentId = payload.agentId || '';
        sendEvent('llm:reasoning', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            reasoning: payload.data?.reasoning || '',
        });
    });

    // Task lifecycle
    channel.on(Events.Task.CREATED, (payload: any) => {
        const task = payload.data?.task;
        if (!task) return;
        sendEvent('task:created', {
            taskId: task.id,
            title: task.title,
            assignedTo: task.assignedTo || '',
            agentName: agentNames[task.assignedTo || ''] || '',
        });
    });

    channel.on(Events.Task.ASSIGNED, (payload: any) => {
        const task = payload.data?.task;
        if (!task) return;
        sendEvent('task:assigned', {
            taskId: task.id,
            title: task.title,
            assignedTo: task.assignedTo || '',
            agentName: agentNames[task.assignedTo || ''] || '',
        });
    });

    // Progress updates from agents
    channel.on('progress:update', (payload: any) => {
        const agentId = payload.agentId || payload.data?.agentId || '';
        sendEvent('progress:update', {
            agentId,
            agentName: agentNames[agentId] || agentId,
            status: payload.data?.status || '',
            detail: payload.data?.detail || '',
            percent: payload.data?.percent,
        });
    });

    // Context compaction
    channel.on(Events.Agent.CONTEXT_COMPACTED, (payload: any) => {
        sendEvent('context:compacted', {
            agentId: payload.agentId || payload.data?.agentId || '',
            originalMessages: payload.data?.originalMessages || 0,
            compactedMessages: payload.data?.compactedMessages || 0,
            tokensBefore: payload.data?.tokensBefore || 0,
            tokensAfter: payload.data?.tokensAfter || 0,
        });
    });
}

// Run the sidecar
main().catch((error) => {
    sendEvent('error', { message: `Sidecar crashed: ${error.message || error}` });
    process.exit(1);
});
