/**
 * MXF CLI TUI — Slash Command Handlers
 *
 * Implementations for all slash commands available in the interactive TUI.
 * Each handler is registered with the command registry at module load time.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { registerCommand, getRegisteredCommands } from './registry';
import type { CommandContext } from './registry';
import { buildContextString } from '../../utils/context';
import { ConfigService } from '../../services/ConfigService';
import { loadAll } from '../agents/AgentLoader';
import { formatCostSummary, formatBudgetStatus, getModelContextWindow } from '../services/CostTracker';
import { getThemeNames } from '../theme/themes';
import { SessionHistoryService, formatSessionList } from '../services/SessionHistory';
import { ToolHookService } from '../services/ToolHookService';
import { VimModeService } from '../services/VimMode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * /help — Show available commands as a system message.
 */
registerCommand({
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: async (_args: string, context: CommandContext) => {
        const commands = getRegisteredCommands();
        const lines = commands.map((cmd) => `  /${cmd.name.padEnd(12)} ${cmd.description}`);

        // Build dynamic agent mention list from connected agents
        const definitions = context.session.getConnectedDefinitions();
        const mentions = definitions.map(d => `@${d.name.toLowerCase()}`).join(', ');
        const orchestrator = definitions.find(d => d.role === 'orchestrator');
        const orchestratorName = orchestrator ? orchestrator.name : 'orchestrator';

        const helpText = [
            'Available commands:',
            '',
            ...lines,
            '',
            'Prefix with ! to run a shell command (e.g., !ls)',
            'Use @agent to direct a message to a specific agent:',
            `  ${mentions}`,
            '  (e.g., @operator fix the import on line 23)',
            `Type anything else to send a task to the ${orchestratorName} agent.`,
        ].join('\n');

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: helpText },
        });
    },
});

/**
 * /agents — Manage agents. Subcommands: list, enable, disable.
 * No subcommand shows currently active agents and their status.
 */
registerCommand({
    name: 'agents',
    description: 'Manage agents (list, enable <id>, disable <id>)',
    usage: '/agents [list|enable <id>|disable <id>]',
    handler: async (args: string, context: CommandContext) => {
        const statusDots: Record<string, string> = {
            active: '●',
            idle: '○',
            error: '×',
        };

        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || '';
        const targetId = parts[1] || '';

        if (subcommand === 'list') {
            // List all available agents (built-in + custom), marking connected ones
            const configService = ConfigService.getInstance();
            const config = configService.load();
            const allAvailable = loadAll(config?.agents?.customAgentsDir);
            const connected = context.session.getConnectedDefinitions();
            const connectedIds = new Set(connected.map(d => d.agentId));

            const agentLines = allAvailable.map(def => {
                const isConnected = connectedIds.has(def.agentId);
                const dot = isConnected ? '●' : '○';
                const status = isConnected ? ' (active)' : '';
                return `  ${dot} ${def.name} [${def.agentId}] — ${def.description || def.role}${status}`;
            });

            const content = [
                'Available agents:',
                ...agentLines,
                '',
                'Use /agents enable <id> to connect an agent.',
                'Use /agents disable <id> to disconnect an agent.',
            ].join('\n');

            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content },
            });
            return;
        }

        if (subcommand === 'enable') {
            if (!targetId) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: 'Usage: /agents enable <agent-id>' },
                });
                return;
            }

            // Find the agent definition
            const configService = ConfigService.getInstance();
            const config = configService.load();
            const allAvailable = loadAll(config?.agents?.customAgentsDir);

            // Resolve by exact ID, name, or mxf-prefixed name
            const definition = allAvailable.find(d =>
                d.agentId === targetId ||
                d.name.toLowerCase() === targetId.toLowerCase() ||
                d.agentId === `mxf-${targetId}`,
            );

            if (!definition) {
                const available = allAvailable.map(d => d.agentId).join(', ');
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Unknown agent: ${targetId}. Available: ${available}` },
                });
                return;
            }

            try {
                await context.session.addAgent(definition);

                // Update agent status in UI
                context.dispatch({
                    type: 'SET_AGENT_STATUS',
                    agentId: definition.agentId,
                    status: 'idle',
                });

                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'system', content: `Agent enabled: ${definition.name} (${definition.agentId})` },
                });
            } catch (error: any) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Failed to enable agent: ${error.message}` },
                });
            }
            return;
        }

        if (subcommand === 'disable') {
            if (!targetId) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: 'Usage: /agents disable <agent-id>' },
                });
                return;
            }

            // Resolve target
            const connected = context.session.getConnectedDefinitions();
            const definition = connected.find(d =>
                d.agentId === targetId ||
                d.name.toLowerCase() === targetId.toLowerCase() ||
                d.agentId === `mxf-${targetId}`,
            );

            if (!definition) {
                const available = connected.map(d => d.agentId).join(', ');
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Agent not connected: ${targetId}. Connected: ${available}` },
                });
                return;
            }

            try {
                await context.session.removeAgent(definition.agentId);

                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'system', content: `Agent disabled: ${definition.name} (${definition.agentId})` },
                });
            } catch (error: any) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Failed to disable agent: ${error.message}` },
                });
            }
            return;
        }

        // Default: show active agents (no subcommand)
        const connected = context.session.isConnected();
        const model = context.session.getDefaultModel();
        const definitions = context.session.getConnectedDefinitions();

        const agentLines = definitions.map(def => {
            const dot = statusDots[connected ? 'idle' : 'error'] || '?';
            return `  ${dot} ${def.name} (${def.role})`;
        });

        const content = [
            'Active agents:',
            ...agentLines,
            '',
            `Model: ${model}`,
            `Connection: ${connected ? 'connected' : 'disconnected'}`,
            '',
            'Use /agents list to see all available agents.',
        ].join('\n');

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content },
        });
    },
});

/**
 * /clear — Clear the conversation area.
 */
registerCommand({
    name: 'clear',
    description: 'Clear conversation history',
    usage: '/clear',
    handler: async (_args: string, context: CommandContext) => {
        context.dispatch({ type: 'CLEAR_ENTRIES' });
    },
});

/**
 * /config — Show current configuration.
 */
registerCommand({
    name: 'config',
    description: 'Show current configuration',
    usage: '/config',
    handler: async (_args: string, context: CommandContext) => {
        const configService = ConfigService.getInstance();
        const config = configService.load();

        if (!config) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'error', content: 'No configuration found.' },
            });
            return;
        }

        const lines = [
            'Current configuration:',
            `  Provider:  ${config.llm?.provider || 'not set'}`,
            `  Model:     ${context.session.getDefaultModel()}`,
            `  Server:    http://${config.server.host}:${config.server.port}`,
            `  API Key:   ${config.llm?.apiKey ? config.llm.apiKey.substring(0, 8) + '...' : 'not set'}`,
        ];

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * /context <path> — Load file or directory contents for the next task.
 */
registerCommand({
    name: 'context',
    description: 'Load file/directory context for next task',
    usage: '/context <path>',
    handler: async (args: string, context: CommandContext) => {
        if (!args) {
            // Show current context status
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: 'Usage: /context <path>\nProvide a file or directory path to include as context in the next task.',
                },
            });
            return;
        }

        try {
            const contextString = buildContextString(args);
            context.dispatch({ type: 'SET_CONTEXT', contextString });

            const sizeKB = (Buffer.byteLength(contextString, 'utf-8') / 1024).toFixed(1);
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: `Context loaded: ${args} (${sizeKB} KB). Will be included in the next task.`,
                },
            });
        } catch (error: any) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Failed to load context: ${error.message}`,
                },
            });
        }
    },
});

/**
 * Model choices organized by provider, matching the init command's MODEL_CHOICES.
 * Used by /model to present a numbered list for in-session model switching.
 */
const MODEL_CHOICES: Record<string, Array<{ label: string; value: string }>> = {
    openrouter: [
        { label: 'anthropic/claude-sonnet-4.6', value: 'anthropic/claude-sonnet-4.6' },
        { label: 'anthropic/claude-sonnet-4.5', value: 'anthropic/claude-sonnet-4.5' },
        { label: 'anthropic/claude-haiku-4.5', value: 'anthropic/claude-haiku-4.5' },
        { label: 'anthropic/claude-opus-4.6', value: 'anthropic/claude-opus-4.6' },
        { label: 'openai/gpt-4.1', value: 'openai/gpt-4.1' },
        { label: 'openai/gpt-4.1-mini', value: 'openai/gpt-4.1-mini' },
        { label: 'google/gemini-3-pro-preview', value: 'google/gemini-3-pro-preview' },
        { label: 'google/gemini-3-flash-preview', value: 'google/gemini-3-flash-preview' },
        { label: 'google/gemini-2.5-pro', value: 'google/gemini-2.5-pro' },
        { label: 'google/gemini-2.5-flash', value: 'google/gemini-2.5-flash' },
    ],
    anthropic: [
        { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
        { label: 'claude-sonnet-4-5', value: 'claude-sonnet-4-5' },
        { label: 'claude-haiku-4-5', value: 'claude-haiku-4-5' },
        { label: 'claude-opus-4-6', value: 'claude-opus-4-6' },
    ],
    openai: [
        { label: 'gpt-4.1', value: 'gpt-4.1' },
        { label: 'gpt-4.1-mini', value: 'gpt-4.1-mini' },
        { label: 'gpt-4o', value: 'gpt-4o' },
    ],
    gemini: [
        { label: 'gemini-3-pro-preview', value: 'gemini-3-pro-preview' },
        { label: 'gemini-3-flash-preview', value: 'gemini-3-flash-preview' },
        { label: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
        { label: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
    ],
    xai: [
        { label: 'grok-3', value: 'grok-3' },
        { label: 'grok-3-mini', value: 'grok-3-mini' },
    ],
};

/**
 * /model — Change the default model for subsequent tasks.
 *
 * With no args: enters interactive selection mode with numbered list.
 * With a model ID: sets that model directly.
 */
registerCommand({
    name: 'model',
    description: 'Change the default model',
    usage: '/model [model-id]',
    handler: async (args: string, context: CommandContext) => {
        const current = context.session.getDefaultModel();

        // Direct model ID provided — set immediately
        if (args) {
            context.session.setDefaultModel(args.trim());
            context.dispatch({ type: 'SET_MODEL_OVERRIDE', model: args.trim() });
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `Model changed to: ${args.trim()}` },
            });
            return;
        }

        // Show per-agent model overrides if any are configured
        const agentModels = context.session.getAgentModels();
        if (Object.keys(agentModels).length > 0) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: 'Agent model overrides:\n' +
                        Object.entries(agentModels)
                            .map(([id, model]) => `  ${id}: ${model}`)
                            .join('\n'),
                },
            });
        }

        // No args — enter interactive selection mode with arrow-key picker
        const configService = ConfigService.getInstance();
        const config = configService.load();
        const provider = config?.llm?.provider || 'openrouter';
        const choices = MODEL_CHOICES[provider] || MODEL_CHOICES.openrouter;

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'system',
                content: `Select model (${provider}):`,
            },
        });

        // Enter selection mode — InputLine renders an arrow-key Select picker
        context.dispatch({
            type: 'SET_PENDING_SELECTION',
            selection: { kind: 'model', choices, defaultValue: current },
        });
    },
});

/**
 * /cost — Show iteration count and per-agent breakdown.
 */
registerCommand({
    name: 'cost',
    description: 'Show iteration and activity breakdown',
    usage: '/cost',
    handler: async (_args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Cost data not available.' },
            });
            return;
        }

        const summary = formatCostSummary(state.costData);
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: summary },
        });
    },
});

/**
 * /budget — View or set the session cost budget.
 * - /budget           — show current budget status
 * - /budget <amount>  — set budget limit in USD (e.g., /budget 5.00)
 * - /budget clear     — remove budget limit
 */
registerCommand({
    name: 'budget',
    description: 'View or set cost budget (e.g., /budget 5.00, /budget clear)',
    usage: '/budget [amount|clear]',
    handler: async (args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Cost data not available.' },
            });
            return;
        }

        const trimmed = args.trim().toLowerCase();

        // No args: show current budget status
        if (!trimmed) {
            const status = formatBudgetStatus(state.costData);
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `Budget status: ${status}` },
            });
            return;
        }

        // /budget clear — remove budget limit
        if (trimmed === 'clear') {
            context.dispatch({ type: 'SET_COST_BUDGET', budget: null });
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Budget limit cleared.' },
            });
            return;
        }

        // /budget <amount> — set budget limit
        const amount = parseFloat(trimmed);
        if (isNaN(amount) || amount <= 0) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Invalid budget amount. Use a positive number (e.g., /budget 5.00) or /budget clear.' },
            });
            return;
        }

        context.dispatch({ type: 'SET_COST_BUDGET', budget: amount });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Budget set to $${amount.toFixed(2)}. Warnings at 80%, alerts at 100%.` },
        });
    },
});

/**
 * /stop — Cancel current agent activity.
 */
registerCommand({
    name: 'stop',
    description: 'Stop current agent activity',
    usage: '/stop',
    handler: async (_args: string, context: CommandContext) => {
        context.dispatch({ type: 'SET_AGENT_WORKING', working: false });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'system',
                content: 'Agent activity stopped. You can submit a new task.',
            },
        });
    },
});

/**
 * /exit — Gracefully disconnect and exit the TUI.
 */
registerCommand({
    name: 'exit',
    description: 'Exit the interactive session',
    usage: '/exit',
    handler: async (_args: string, context: CommandContext) => {
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'system',
                content: 'Disconnecting...',
            },
        });

        await context.session.disconnect();
        context.requestExit();
    },
});

/**
 * /theme — Switch the TUI color theme.
 */
registerCommand({
    name: 'theme',
    description: 'Switch color theme',
    usage: '/theme [dark|light|minimal]',
    handler: async (args: string, context: CommandContext) => {
        const available = getThemeNames();

        if (!args) {
            const state = context.getState?.();
            const current = state?.currentTheme || 'dark';
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: `Current theme: ${current}\nAvailable: ${available.join(', ')}\nUsage: /theme <name>`,
                },
            });
            return;
        }

        const themeName = args.trim().toLowerCase();
        if (!available.includes(themeName)) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Unknown theme: ${themeName}. Available: ${available.join(', ')}`,
                },
            });
            return;
        }

        context.dispatch({ type: 'SET_THEME', theme: themeName });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'system',
                content: `Theme changed to: ${themeName}`,
            },
        });
    },
});

/**
 * /mode — Switch interaction mode (chat, plan, action).
 *
 * Modes control behavioral prefixes prepended to task descriptions:
 * - chat: Conversational replies, no delegation or file changes
 * - plan: Planning only, no execution
 * - action: Full delegation (default)
 */
registerCommand({
    name: 'mode',
    description: 'Switch mode (chat, plan, action)',
    usage: '/mode [chat|plan|action]',
    handler: async (args: string, context: CommandContext) => {
        const state = context.getState?.();
        const currentMode = state?.currentMode || 'action';

        if (!args) {
            // No args — show current mode and options
            const modes = [
                `  chat    — Conversational replies, no delegation${currentMode === 'chat' ? '  <- current' : ''}`,
                `  plan    — Planning only, no execution${currentMode === 'plan' ? '  <- current' : ''}`,
                `  action  — Full delegation (default)${currentMode === 'action' ? '  <- current' : ''}`,
            ];
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: ['Interaction modes:', '', ...modes, '', 'Usage: /mode <chat|plan|action>'].join('\n'),
                },
            });
            return;
        }

        const mode = args.trim().toLowerCase();
        if (mode !== 'chat' && mode !== 'plan' && mode !== 'action') {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Unknown mode: ${mode}. Available: chat, plan, action`,
                },
            });
            return;
        }

        context.dispatch({ type: 'SET_MODE', mode });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'system',
                content: `Mode changed to: ${mode}`,
            },
        });
    },
});

/**
 * /resume — Resume a past session by loading its conversation into the current TUI.
 *
 * With no args: shows the 5 most recent sessions to choose from.
 * With a session ID (or partial match): loads that session's entries and cost data.
 * The loaded entries provide visual context; a condensed summary is injected as
 * context into the next task submission so the agent has continuity.
 */
registerCommand({
    name: 'resume',
    description: 'Resume a past session',
    usage: '/resume [session-id]',
    handler: async (args: string, context: CommandContext) => {
        const historyService = new SessionHistoryService();

        if (!args) {
            // No args — show 5 most recent sessions as a pick list
            try {
                const summaries = await historyService.list();
                if (summaries.length === 0) {
                    context.dispatch({
                        type: 'ADD_ENTRY',
                        entry: { type: 'system', content: 'No saved sessions found.' },
                    });
                    return;
                }

                const lines = ['Recent sessions (use /resume <id> to load):', ''];
                for (const s of summaries.slice(0, 5)) {
                    const date = new Date(s.startTime).toLocaleDateString();
                    const time = new Date(s.startTime).toLocaleTimeString();
                    lines.push(`  ${s.sessionId}  ${date} ${time}  ${s.entryCount} entries  ${s.totalIterations} iters`);
                }

                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'system', content: lines.join('\n') },
                });
            } catch (error: any) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Failed to list sessions: ${error.message}` },
                });
            }
            return;
        }

        // Session ID provided — load it
        const sessionId = args.trim();
        try {
            // Try exact match first
            let record = await historyService.load(sessionId);

            // Try partial match if exact fails
            if (!record) {
                const summaries = await historyService.list();
                const match = summaries.find(s => s.sessionId.startsWith(sessionId));
                if (match) {
                    record = await historyService.load(match.sessionId);
                }
            }

            if (!record) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Session not found: ${sessionId}` },
                });
                return;
            }

            // Clear current entries and load the resumed session's entries
            context.dispatch({ type: 'CLEAR_ENTRIES' });

            // Add a system notice marking the resume point
            const date = new Date(record.startTime).toLocaleString();
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: `Resumed session ${record.sessionId} from ${date} (${record.entries.length} entries)`,
                },
            });

            // Replay conversation entries so the user can see the history
            for (const entry of record.entries) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: entry.type,
                        content: entry.content,
                        agentId: entry.agentId,
                        agentName: entry.agentName,
                        toolName: entry.toolName,
                        toolArgs: entry.toolArgs,
                    },
                });
            }

            // Build a condensed summary from the last result and recent agent messages
            // to inject as context for the next task submission
            const lastResult = [...record.entries].reverse().find(e => e.type === 'result');
            const recentAgent = [...record.entries].reverse().find(e => e.type === 'agent');
            const summaryParts: string[] = [];
            if (lastResult) summaryParts.push(`Last result: ${lastResult.content.substring(0, 500)}`);
            if (recentAgent && recentAgent !== lastResult) {
                summaryParts.push(`Last agent message: ${recentAgent.content.substring(0, 300)}`);
            }

            if (summaryParts.length > 0) {
                const resumeContext = `[Resumed from session ${record.sessionId}]\n${summaryParts.join('\n')}`;
                context.dispatch({ type: 'SET_CONTEXT', contextString: resumeContext });
            }

            // System notice to guide the user
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: 'Session loaded. Previous context will be included in your next task.',
                },
            });
        } catch (error: any) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'error', content: `Failed to resume session: ${error.message}` },
            });
        }
    },
});

/**
 * /history — Show recent session history from ~/.mxf/sessions/.
 */
registerCommand({
    name: 'history',
    description: 'Show recent session history',
    usage: '/history',
    handler: async (_args: string, context: CommandContext) => {
        try {
            const historyService = new SessionHistoryService();
            const summaries = await historyService.list();
            const content = formatSessionList(summaries);

            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content },
            });
        } catch (error: any) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Failed to load session history: ${error.message}`,
                },
            });
        }
    },
});

/**
 * /permissions — View current tool permission rules.
 */
registerCommand({
    name: 'permissions',
    description: 'View tool permission rules',
    usage: '/permissions',
    handler: async (_args: string, context: CommandContext) => {
        if (!context.permissionService) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Permission service not available.' },
            });
            return;
        }

        const summary = context.permissionService.getRulesSummary();
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Tool Permissions:\n${summary}` },
        });
    },
});

/**
 * /approve-all — Toggle session-level auto-approve for all tool calls.
 *
 * When active, all agent confirmation prompts are auto-approved.
 * Run again to disable.
 */
registerCommand({
    name: 'approve-all',
    description: 'Toggle auto-approve all tool calls',
    usage: '/approve-all',
    handler: async (_args: string, context: CommandContext) => {
        if (!context.permissionService) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Permission service not available.' },
            });
            return;
        }

        const wasEnabled = context.permissionService.isApproveAll();
        context.permissionService.setApproveAll(!wasEnabled);

        const status = !wasEnabled ? 'ENABLED — all tool calls will be auto-approved' : 'DISABLED — tool calls will prompt for confirmation';
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Auto-approve all: ${status}` },
        });
    },
});

/**
 * /approve — Add a session-level auto-approve rule for a tool pattern.
 * Example: /approve read_file  or  /approve shell_execute(git *)
 */
registerCommand({
    name: 'approve',
    description: 'Auto-approve a tool pattern for this session',
    usage: '/approve <pattern>',
    handler: async (args: string, context: CommandContext) => {
        if (!context.permissionService) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Permission service not available.' },
            });
            return;
        }

        if (!args.trim()) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Usage: /approve <tool-pattern>\nExamples: /approve read_file  or  /approve shell_execute(git *)' },
            });
            return;
        }

        context.permissionService.addSessionRule({ pattern: args.trim(), decision: 'allow' });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Session rule added: auto-approve ${args.trim()}` },
        });
    },
});

/**
 * /compact — Manually trigger context compaction for all agents or a specific agent.
 */
registerCommand({
    name: 'compact',
    description: 'Compact agent context to free memory',
    usage: '/compact [agent-id]',
    handler: async (args: string, context: CommandContext) => {
        const targetId = args.trim() || null;

        if (targetId) {
            // Compact specific agent
            try {
                await context.session.compactAgent(targetId);
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'system', content: `Context compaction triggered for ${targetId}.` },
                });
            } catch (error: any) {
                context.dispatch({
                    type: 'ADD_ENTRY',
                    entry: { type: 'error', content: `Failed to compact: ${error.message}` },
                });
            }
        } else {
            // Compact all agents
            const definitions = context.session.getConnectedDefinitions();
            for (const def of definitions) {
                try {
                    await context.session.compactAgent(def.agentId);
                } catch {
                    // Errors logged inside compactAgent
                }
            }
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `Context compaction triggered for ${definitions.length} agents.` },
            });
        }
    },
});

/**
 * /debug — Show internal TUI state for debugging.
 */
registerCommand({
    name: 'debug',
    description: 'Show internal state (tokens, connection, agents)',
    usage: '/debug',
    handler: async (_args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'State not available.' },
            });
            return;
        }

        const agentLines = Object.values(state.costData.agents).map(agent => {
            const contextWindow = agent.lastModel ? getModelContextWindow(agent.lastModel) : null;
            const usage = contextWindow ? `${Math.round((agent.totalTokens / contextWindow) * 100)}%` : '?';
            const compacted = state.compactedAgents.has(agent.agentId) ? ' (compacted)' : '';
            return `    ${agent.agentName.padEnd(12)} ${agent.totalTokens.toLocaleString()} tokens  ctx: ${usage}${compacted}  model: ${agent.lastModel || 'unknown'}`;
        });

        const lines = [
            'TUI Debug State:',
            `  Connection:       ${state.connection}`,
            `  Session ID:       ${state.sessionId}`,
            `  Entries:          ${state.entries.length}`,
            `  Agent working:    ${state.isAgentWorking}`,
            `  Current task:     ${state.currentTaskId || 'none'}`,
            `  Mode:             ${state.currentMode}`,
            `  Confirmation:     ${state.confirmationPending ? 'pending' : 'none'}`,
            `  Model override:   ${state.modelOverride || 'none'}`,
            `  Context loaded:   ${state.contextString ? `${state.contextString.length} chars` : 'none'}`,
            `  Stream preview:   ${state.streamPreview ? `${state.streamPreview.text.length} chars from ${state.streamPreview.agentId}` : 'none'}`,
            '',
            '  Per-Agent Tokens:',
            ...(agentLines.length > 0 ? agentLines : ['    (no agent activity yet)']),
        ];

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * Valid entry types that can be used with /filter.
 * Matches the ConversationEntry.type union from types.ts.
 */
const VALID_FILTER_TYPES = new Set([
    'user', 'agent', 'tool-call', 'tool-result', 'system', 'error',
    'result', 'activity-card', 'confirmation-prompt', 'confirmation-response', 'reasoning',
]);

/**
 * /filter [type] — Filter conversation display to show only specific entry types.
 *
 * With no args or 'all': clears the filter, showing all entries.
 * With a valid type: sets the filter so only entries of that type are displayed.
 * Filtering is display-only — the underlying entries array is not modified.
 */
registerCommand({
    name: 'filter',
    description: 'Filter conversation by entry type',
    usage: '/filter [user|agent|tool-call|tool-result|error|system|result|reasoning|all]',
    handler: async (args: string, context: CommandContext) => {
        const filterType = args.trim().toLowerCase();

        // No args or 'all' — clear the filter
        if (!filterType || filterType === 'all') {
            context.dispatch({ type: 'SET_ENTRY_FILTER', filter: null });
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Filter cleared: showing all entries' },
            });
            return;
        }

        // Validate the filter type against known entry types
        if (!VALID_FILTER_TYPES.has(filterType)) {
            const validTypes = Array.from(VALID_FILTER_TYPES).join(', ');
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Unknown filter type: ${filterType}\nValid types: ${validTypes}, all`,
                },
            });
            return;
        }

        // Set the filter and confirm to the user
        context.dispatch({ type: 'SET_ENTRY_FILTER', filter: filterType });
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Showing only: ${filterType} entries` },
        });
    },
});

/**
 * /search <term> — Search conversation entries for a text pattern.
 *
 * Case-insensitive substring match across all entry content. Shows matching
 * entries with timestamps and truncated content previews.
 */
registerCommand({
    name: 'search',
    description: 'Search conversation entries',
    usage: '/search <term>',
    handler: async (args: string, context: CommandContext) => {
        if (!args.trim()) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'Usage: /search <term>\nSearches conversation entries for matching text.' },
            });
            return;
        }

        const state = context.getState?.();
        if (!state) return;

        const query = args.trim().toLowerCase();
        const matches = state.entries.filter(e =>
            e.content.toLowerCase().includes(query) ||
            e.agentName?.toLowerCase().includes(query) ||
            e.toolName?.toLowerCase().includes(query),
        );

        if (matches.length === 0) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `No entries matching "${args.trim()}".` },
            });
            return;
        }

        // Show up to 20 matching entries with truncated previews
        const maxResults = 20;
        const shown = matches.slice(-maxResults);
        const lines = [
            `Found ${matches.length} matching entries${matches.length > maxResults ? ` (showing last ${maxResults})` : ''}:`,
            '',
        ];

        for (const entry of shown) {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const source = entry.agentName || entry.type;
            // Truncate content preview to 120 chars and collapse newlines
            const preview = entry.content.replace(/\n+/g, ' ').substring(0, 120);
            const suffix = entry.content.length > 120 ? '...' : '';
            lines.push(`  [${time}] ${source}: ${preview}${suffix}`);
        }

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * /export [md|json] — Export conversation entries to a file.
 *
 * Writes the current conversation to a timestamped file in the working directory.
 * Defaults to markdown format. JSON format includes full entry metadata.
 */
registerCommand({
    name: 'export',
    description: 'Export conversation to file (md or json)',
    usage: '/export [md|json]',
    handler: async (args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state || state.entries.length === 0) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'No conversation entries to export.' },
            });
            return;
        }

        const format = (args.trim().toLowerCase() || 'md') as 'md' | 'json';
        if (format !== 'md' && format !== 'json') {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'error', content: `Unknown format: ${format}. Use "md" or "json".` },
            });
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `mxf-conversation-${state.sessionId}-${timestamp}.${format}`;
        const filepath = path.resolve(process.cwd(), filename);

        let content: string;
        if (format === 'json') {
            // Full metadata export
            content = JSON.stringify(
                {
                    sessionId: state.sessionId,
                    exportedAt: new Date().toISOString(),
                    entryCount: state.entries.length,
                    entries: state.entries.map(e => ({
                        type: e.type,
                        timestamp: e.timestamp,
                        agentName: e.agentName || null,
                        toolName: e.toolName || null,
                        content: e.content,
                    })),
                },
                null,
                2,
            );
        } else {
            // Markdown export — readable conversation format
            const lines = [
                `# MXF Conversation — Session ${state.sessionId}`,
                `*Exported: ${new Date().toLocaleString()}*`,
                '',
            ];
            for (const entry of state.entries) {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                switch (entry.type) {
                    case 'user':
                        lines.push(`## User [${time}]`, '', entry.content, '');
                        break;
                    case 'agent':
                        lines.push(`### ${entry.agentName || 'Agent'} [${time}]`, '', entry.content, '');
                        break;
                    case 'tool-call':
                        lines.push(`> **Tool Call**: \`${entry.toolName}\` [${time}]`, '');
                        break;
                    case 'tool-result':
                        lines.push(`> **Tool Result** [${time}]`, '>', `> ${entry.content.substring(0, 500)}`, '');
                        break;
                    case 'result':
                        lines.push(`### Result [${time}]`, '', entry.content, '');
                        break;
                    case 'system':
                        lines.push(`*System: ${entry.content}*`, '');
                        break;
                    case 'error':
                        lines.push(`**Error**: ${entry.content}`, '');
                        break;
                    default:
                        lines.push(`*${entry.type}: ${entry.content.substring(0, 200)}*`, '');
                        break;
                }
            }
            content = lines.join('\n');
        }

        try {
            fs.writeFileSync(filepath, content, 'utf-8');
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `Conversation exported to: ${filepath}` },
            });
        } catch (error: any) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'error', content: `Failed to export: ${error.message}` },
            });
        }
    },
});

/**
 * /retry — Resubmit the last user task to the orchestrator agent.
 *
 * Finds the most recent 'user' entry that isn't a shell command or slash command,
 * and resubmits it as a new task.
 */
registerCommand({
    name: 'retry',
    description: 'Resubmit the last task',
    usage: '/retry',
    handler: async (_args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) return;

        if (!context.submitTask) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'error', content: 'Task submission not available.' },
            });
            return;
        }

        // Find the most recent user entry that is a task (not a shell command or slash command)
        let lastTask: string | null = null;
        for (let i = state.entries.length - 1; i >= 0; i--) {
            const entry = state.entries[i];
            if (entry.type === 'user' && !entry.content.startsWith('!') && !entry.content.startsWith('/')) {
                lastTask = entry.content;
                break;
            }
        }

        if (!lastTask) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'No previous task to retry.' },
            });
            return;
        }

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: `Retrying: ${lastTask.substring(0, 100)}${lastTask.length > 100 ? '...' : ''}` },
        });

        await context.submitTask(lastTask, state.contextString);
    },
});

/**
 * /diff — Show recent file changes recorded in conversation entries.
 *
 * Scans entries for tool-call entries that modified files (write_file, edit_file,
 * create_file) and entries with attached fileDiffs. Shows a summary of all file
 * modifications in the current session.
 */
registerCommand({
    name: 'diff',
    description: 'Show recent file changes by agents',
    usage: '/diff',
    handler: async (_args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) return;

        // Collect file modifications from tool-call entries and fileDiffs
        const fileChanges: Array<{
            time: string;
            agent: string;
            tool: string;
            file: string;
        }> = [];

        // Tool names that indicate file modifications
        const fileTools = new Set([
            'write_file', 'edit_file', 'create_file', 'create_directory',
            'move_file', 'delete_file', 'replace_in_file',
        ]);

        for (const entry of state.entries) {
            // Check tool-call entries for file modification tools
            if (entry.type === 'tool-call' && entry.toolName && fileTools.has(entry.toolName)) {
                const filePath = entry.toolArgs?.path || entry.toolArgs?.file_path || entry.toolArgs?.destination || '';
                fileChanges.push({
                    time: new Date(entry.timestamp).toLocaleTimeString(),
                    agent: entry.agentName || entry.agentId || 'unknown',
                    tool: entry.toolName,
                    file: filePath,
                });
            }

            // Check entries with attached fileDiffs
            if (entry.fileDiffs && entry.fileDiffs.length > 0) {
                for (const diff of entry.fileDiffs) {
                    fileChanges.push({
                        time: new Date(entry.timestamp).toLocaleTimeString(),
                        agent: entry.agentName || entry.agentId || 'unknown',
                        tool: 'diff',
                        file: diff.filePath,
                    });
                }
            }
        }

        if (fileChanges.length === 0) {
            context.dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: 'No file changes recorded in this session.' },
            });
            return;
        }

        // Build summary grouped by file
        const byFile = new Map<string, typeof fileChanges>();
        for (const change of fileChanges) {
            const existing = byFile.get(change.file) || [];
            existing.push(change);
            byFile.set(change.file, existing);
        }

        const lines = [
            `File changes this session (${fileChanges.length} operations, ${byFile.size} files):`,
            '',
        ];

        for (const [file, changes] of byFile) {
            const ops = changes.map(c => `${c.tool} by ${c.agent} at ${c.time}`);
            lines.push(`  ${file || '(unknown path)'}`);
            for (const op of ops) {
                lines.push(`    ${op}`);
            }
        }

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * /tasks — Show task activity from the current session.
 *
 * Scans conversation entries for task lifecycle events (created, assigned,
 * completed, failed) to give the user visibility into orchestration activity.
 * Also shows the currently active task ID from state.
 */
registerCommand({
    name: 'tasks',
    description: 'Show task activity and status',
    usage: '/tasks',
    handler: async (_args: string, context: CommandContext) => {
        const state = context.getState?.();
        if (!state) return;

        const lines: string[] = ['Task Activity:'];

        // Current task status
        if (state.currentTaskId) {
            lines.push(`  Current task: ${state.currentTaskId}`);
        } else {
            lines.push('  Current task: none (idle)');
        }
        lines.push('');

        // Extract task-related entries from conversation
        const taskEntries = state.entries.filter(e =>
            e.type === 'system' && (
                e.content.startsWith('Task created:') ||
                e.content.startsWith('Task assigned:') ||
                e.content.startsWith('Dependency resolved') ||
                e.content.startsWith('Blocker cleared')
            ),
        );

        // Count completed/failed results
        const completedCount = state.entries.filter(e => e.type === 'result').length;
        const failedCount = state.entries.filter(e =>
            e.type === 'error' && e.content.toLowerCase().includes('task'),
        ).length;

        lines.push(`  Completed: ${completedCount}  Failed: ${failedCount}`);

        if (taskEntries.length > 0) {
            lines.push('');
            lines.push('  Recent task events:');
            // Show the last 15 task events
            for (const entry of taskEntries.slice(-15)) {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                lines.push(`    [${time}] ${entry.content}`);
            }
        }

        // Show per-agent activity summary
        const agentData = Object.values(state.costData.agents);
        if (agentData.length > 0) {
            lines.push('');
            lines.push('  Agent activity:');
            for (const agent of agentData) {
                const msgs = agent.messageCount;
                const tools = agent.toolCallCount;
                lines.push(`    ${agent.agentName.padEnd(14)} ${msgs} msgs, ${tools} tool calls`);
            }
        }

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * /hooks — Show loaded tool lifecycle hooks from ~/.mxf/hooks/.
 * Displays pre and post hooks with their file paths.
 */
registerCommand({
    name: 'hooks',
    description: 'Show loaded tool lifecycle hooks',
    usage: '/hooks',
    handler: async (_args: string, context: CommandContext) => {
        const hookService = ToolHookService.getInstance();
        const { pre, post } = hookService.getLoadedHooks();

        const lines: string[] = ['Tool Lifecycle Hooks (~/.mxf/hooks/):'];
        lines.push('');

        if (pre.length === 0 && post.length === 0) {
            lines.push('  No hooks loaded.');
            lines.push('');
            lines.push('  Place hook scripts in ~/.mxf/hooks/ using the naming convention:');
            lines.push('    pre-<toolname>.sh   — runs before a tool call');
            lines.push('    post-<toolname>.sh  — runs after a tool call');
            lines.push('    pre-all.sh          — runs before every tool call');
            lines.push('    post-all.sh         — runs after every tool call');
            lines.push('  JS hooks (.js) are also supported.');
        } else {
            if (pre.length > 0) {
                lines.push(`  Pre-hooks (${pre.length}):`);
                for (const hookPath of pre) {
                    lines.push(`    ${hookPath}`);
                }
            }

            if (post.length > 0) {
                if (pre.length > 0) lines.push('');
                lines.push(`  Post-hooks (${post.length}):`);
                for (const hookPath of post) {
                    lines.push(`    ${hookPath}`);
                }
            }
        }

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: lines.join('\n') },
        });
    },
});

/**
 * /vim — Toggle vim keybindings on/off.
 * When enabled, the input area supports normal/insert mode switching
 * and basic vim movement commands (h, l, 0, $, dd, x).
 */
registerCommand({
    name: 'vim',
    description: 'Toggle vim keybindings for the input area',
    usage: '/vim',
    handler: async (_args: string, context: CommandContext) => {
        const vim = VimModeService.getInstance();
        vim.toggle();

        const enabled = vim.isEnabled();
        // Update TUI state so the InfoBar can display the current vim mode
        context.dispatch({
            type: 'SET_VIM_MODE',
            mode: enabled ? vim.getMode() : null,
        });

        const message = enabled
            ? 'Vim mode enabled (press Escape for normal mode)'
            : 'Vim mode disabled';

        context.dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'system', content: message },
        });
    },
});
