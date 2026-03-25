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
import { formatCostSummary } from '../services/CostTracker';
import { getThemeNames } from '../theme/themes';
import { SessionHistoryService, formatSessionList } from '../services/SessionHistory';

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
