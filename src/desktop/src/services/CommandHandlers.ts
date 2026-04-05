/**
 * MXF Desktop — Slash Command Handlers
 *
 * Implementations for all slash commands in the desktop app. Ported from
 * the TUI's handlers.ts, adapted to use SidecarBridge for server operations
 * and Zustand for state management.
 *
 * Commands that operate purely on local state (clear, theme, vim, mode, detail)
 * use the Zustand store directly. Commands that need server interaction
 * (agents, model, compact, stop) go through the sidecar bridge.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { registerCommand, getRegisteredCommands } from './CommandRegistry';
import type { CommandContext } from './CommandRegistry';
import { useAppState, generateMessageId } from '../state/appState';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// ── Helpers ─────────────────────────────────────────────────────

/** Add a system message to the conversation */
function addSystemMessage(content: string): void {
    useAppState.getState().addMessage({
        id: generateMessageId(),
        type: 'system',
        content,
        timestamp: Date.now(),
    });
}

/** Add an error message to the conversation */
function addErrorMessage(content: string): void {
    useAppState.getState().addMessage({
        id: generateMessageId(),
        type: 'error',
        content,
        timestamp: Date.now(),
    });
}

// ── Model choices matching the init command ─────────────────────

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

// ── Valid filter types ──────────────────────────────────────────

const VALID_FILTER_TYPES = new Set([
    'user', 'agent', 'system', 'error', 'activity', 'tool-result', 'reasoning',
]);

// ── Command Registrations ───────────────────────────────────────

/**
 * /help — Show available commands.
 */
registerCommand({
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: async () => {
        const commands = getRegisteredCommands();
        const lines = commands.map((cmd) => `  /${cmd.name.padEnd(14)} ${cmd.description}`);

        const state = useAppState.getState();
        const agentNames = state.agents.map(a => `@${a.name.toLowerCase()}`).join(', ');

        const helpText = [
            'Available commands:',
            '',
            ...lines,
            '',
            'Prefix with ! to run a shell command (e.g., !ls)',
            agentNames ? `Use @agent to direct a message: ${agentNames}` : '',
            '',
            'Keyboard shortcuts:',
            '  Enter          — Submit message',
            '  Shift+Enter    — Insert newline',
            '  Ctrl+A/E       — Start/end of line',
            '  Ctrl+K/U       — Kill to end/start of line',
            '  Ctrl+W         — Kill word backward',
            '  Ctrl+Y         — Yank (paste killed text)',
            '  Alt+B/F        — Word left/right',
            '  Cmd+L          — Clear conversation',
        ].filter(Boolean).join('\n');

        addSystemMessage(helpText);
    },
});

/**
 * /agents — Show active agents and their status.
 * With subcommands: list, enable <id>, disable <id>.
 */
registerCommand({
    name: 'agents',
    description: 'Show agents (list, enable <id>, disable <id>)',
    usage: '/agents [list|enable <id>|disable <id>]',
    handler: async (args: string, context: CommandContext) => {
        const state = useAppState.getState();
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || '';
        const targetId = parts[1] || '';

        if (subcommand === 'list') {
            // List all available agents via sidecar
            if (!context.bridge) {
                addErrorMessage('Not connected to MXF server.');
                return;
            }

            try {
                const agents = await context.bridge.call('getAgents') as Array<{
                    id: string; name: string; role: string; color?: string;
                }>;
                const agentLines = agents.map(a => `  ${a.name} [${a.id}] — ${a.role}`);
                addSystemMessage(['Available agents:', ...agentLines].join('\n'));
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addErrorMessage(`Failed to list agents: ${message}`);
            }
            return;
        }

        if (subcommand === 'enable') {
            if (!targetId) {
                addErrorMessage('Usage: /agents enable <agent-id>');
                return;
            }
            // Agent enable/disable would need sidecar methods — show info for now
            addSystemMessage(`Agent management via sidecar — use /agents list to see available agents.`);
            return;
        }

        if (subcommand === 'disable') {
            if (!targetId) {
                addErrorMessage('Usage: /agents disable <agent-id>');
                return;
            }
            addSystemMessage(`Agent management via sidecar — use /agents list to see available agents.`);
            return;
        }

        // Default: show active agents
        const statusDots: Record<string, string> = {
            active: '●', idle: '○', error: '×', offline: '◌',
        };
        const agentLines = state.agents.map(a => {
            const dot = statusDots[a.status] || '?';
            return `  ${dot} ${a.name} (${a.role}) — ${a.status}`;
        });

        const content = [
            'Active agents:',
            ...(agentLines.length > 0 ? agentLines : ['  (no agents connected)']),
            '',
            `Connection: ${state.connection}`,
            '',
            'Use /agents list to see all available agents.',
        ].join('\n');

        addSystemMessage(content);
    },
});

/**
 * /clear — Clear the conversation area.
 */
registerCommand({
    name: 'clear',
    description: 'Clear conversation history',
    usage: '/clear',
    handler: async () => {
        useAppState.getState().clearMessages();
    },
});

/**
 * /config — Show current configuration.
 */
registerCommand({
    name: 'config',
    description: 'Show current configuration',
    usage: '/config [list|get <path>]',
    handler: async (args: string) => {
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || '';

        if (subcommand === 'get' && parts[1]) {
            // Get specific config value via Tauri IPC
            try {
                const value = await invoke<string | null>('get_config_value', { path: parts[1] });
                addSystemMessage(`${parts[1]} = ${value !== null ? JSON.stringify(value) : '(not set)'}`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addErrorMessage(`Config read failed: ${message}`);
            }
            return;
        }

        // Default: show summary
        try {
            const config = await invoke<Record<string, unknown>>('read_config');
            if (!config) {
                addErrorMessage('No configuration found.');
                return;
            }

            const llm = config.llm as Record<string, string> | undefined;
            const server = config.server as Record<string, unknown> | undefined;
            const apiKey = llm?.apiKey;

            const lines = [
                'Current configuration:',
                `  Provider:  ${llm?.provider || 'not set'}`,
                `  Model:     ${llm?.defaultModel || 'not set'}`,
                `  Server:    http://${server?.host || 'localhost'}:${server?.port || 3001}`,
                `  API Key:   ${apiKey ? apiKey.substring(0, 8) + '...' : 'not set'}`,
                '',
                'Use /config get <path> for specific values (e.g., /config get server.port)',
            ];

            addSystemMessage(lines.join('\n'));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addErrorMessage(`Config read failed: ${message}`);
        }
    },
});

/**
 * /context <path> — Load file or directory contents for the next task.
 */
registerCommand({
    name: 'context',
    description: 'Load file/directory context for next task',
    usage: '/context <path>',
    handler: async (args: string) => {
        if (!args) {
            const state = useAppState.getState();
            if (state.contextString) {
                addSystemMessage(`Context loaded: ${state.contextString.length} chars.\nUse /context clear to remove.`);
            } else {
                addSystemMessage('Usage: /context <path>\nProvide a file or directory path to include as context in the next task.');
            }
            return;
        }

        if (args.trim().toLowerCase() === 'clear') {
            useAppState.getState().setContextString(null);
            addSystemMessage('Context cleared.');
            return;
        }

        // Read file contents via Tauri shell (since we can't use Node fs in webview)
        try {
            const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_shell_command', {
                command: `cat "${args.trim()}"`,
            });

            if (result.exit_code !== 0) {
                addErrorMessage(`Failed to load context: ${result.stderr || 'File not found'}`);
                return;
            }

            const content = result.stdout;
            useAppState.getState().setContextString(content);
            const sizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
            addSystemMessage(`Context loaded: ${args.trim()} (${sizeKB} KB). Will be included in the next task.`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addErrorMessage(`Failed to load context: ${message}`);
        }
    },
});

/**
 * /model — Change the default model for subsequent tasks.
 */
registerCommand({
    name: 'model',
    description: 'Change the default model',
    usage: '/model [model-id]',
    handler: async (args: string, context: CommandContext) => {
        // Direct model ID provided — set immediately
        if (args.trim()) {
            const model = args.trim();
            if (context.bridge) {
                try {
                    await context.bridge.call('setModel', { model });
                    addSystemMessage(`Model changed to: ${model}`);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    addErrorMessage(`Failed to set model: ${message}`);
                }
            } else {
                addErrorMessage('Not connected to MXF server.');
            }
            return;
        }

        // No args — show available models as a numbered list
        try {
            const config = await invoke<Record<string, unknown>>('read_config');
            const llm = config?.llm as Record<string, string> | undefined;
            const provider = llm?.provider || 'openrouter';
            const choices = MODEL_CHOICES[provider] || MODEL_CHOICES.openrouter;

            const lines = [
                `Available models (${provider}):`,
                '',
                ...choices.map((c, i) => `  ${(i + 1).toString().padStart(2)}. ${c.label}`),
                '',
                `Current: ${llm?.defaultModel || 'not set'}`,
                'Usage: /model <model-id> (e.g., /model anthropic/claude-sonnet-4.6)',
            ];

            // Also show selection picker
            useAppState.getState().setPendingSelection({
                kind: 'model',
                title: `Select model (${provider})`,
                options: choices.map(c => ({ label: c.label, value: c.value })),
            });

            addSystemMessage(lines.join('\n'));
        } catch {
            addSystemMessage('Usage: /model <model-id>');
        }
    },
});

/**
 * /cost — Show token usage and cost breakdown with pricing estimates.
 */
registerCommand({
    name: 'cost',
    description: 'Show token usage and cost breakdown',
    usage: '/cost',
    handler: async () => {
        const state = useAppState.getState();
        const { formatCostSummary } = await import('./CostTracker');
        addSystemMessage(formatCostSummary(state.costData));
    },
});

/**
 * /budget — Set a cost budget limit for the session.
 */
registerCommand({
    name: 'budget',
    description: 'Set cost budget limit (USD)',
    usage: '/budget <amount>',
    handler: async (args) => {
        if (!args) {
            const state = useAppState.getState();
            const budget = state.costData.costBudget;
            addSystemMessage(budget !== null ? `Current budget: $${budget.toFixed(2)}` : 'No budget set. Use /budget <amount> to set one.');
            return;
        }
        const amount = parseFloat(args);
        if (isNaN(amount) || amount <= 0) {
            addSystemMessage('Invalid budget amount. Use /budget <amount> (e.g., /budget 5.00)');
            return;
        }
        useAppState.getState().setCostBudget(amount);
        addSystemMessage(`Budget set to $${amount.toFixed(2)}`);
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
        const state = useAppState.getState();

        // Reset all local working state
        state.setAgentWorking(false);
        state.setActiveTaskStartTime(null);
        state.setStreamPreview(null);

        // Reset all agents to idle
        for (const agent of state.agents) {
            state.updateAgent(agent.id, { status: 'idle' });
        }

        // Tell the sidecar to disconnect and reconnect — this kills in-flight LLM calls
        if (context.bridge) {
            try {
                await context.bridge.call('cancelTask', {});
            } catch {
                // cancelTask may not exist yet — best-effort
            }
        }

        addSystemMessage('Agent activity stopped. You can submit a new task.');
    },
});

/**
 * /exit — Close the desktop app.
 */
registerCommand({
    name: 'exit',
    description: 'Exit the desktop app',
    usage: '/exit',
    handler: async (_args: string, context: CommandContext) => {
        addSystemMessage('Disconnecting...');

        if (context.bridge) {
            try {
                await context.bridge.stop();
            } catch {
                // Best-effort disconnect
            }
        }

        // Close the Tauri window
        try {
            await getCurrentWindow().close();
        } catch {
            context.requestExit();
        }
    },
});

/**
 * /theme — Toggle dark/light theme.
 */
registerCommand({
    name: 'theme',
    description: 'Toggle dark/light theme',
    usage: '/theme',
    handler: async () => {
        useAppState.getState().toggleTheme();
        const current = useAppState.getState().theme;
        addSystemMessage(`Theme switched to ${current}`);
    },
});

/**
 * /mode — Switch interaction mode (chat, plan, action).
 */
registerCommand({
    name: 'mode',
    description: 'Switch mode (chat, plan, action)',
    usage: '/mode [chat|plan|action]',
    handler: async (args: string) => {
        const state = useAppState.getState();
        const currentMode = state.currentMode;

        if (!args) {
            const modes = [
                `  chat    — Conversational replies, no delegation${currentMode === 'chat' ? '  <- current' : ''}`,
                `  plan    — Planning only, no execution${currentMode === 'plan' ? '  <- current' : ''}`,
                `  action  — Full delegation (default)${currentMode === 'action' ? '  <- current' : ''}`,
            ];
            addSystemMessage(['Interaction modes:', '', ...modes, '', 'Usage: /mode <chat|plan|action>'].join('\n'));
            return;
        }

        const mode = args.trim().toLowerCase();
        if (mode !== 'chat' && mode !== 'plan' && mode !== 'action') {
            addErrorMessage(`Unknown mode: ${mode}. Available: chat, plan, action`);
            return;
        }

        state.setMode(mode);
        addSystemMessage(`Mode changed to: ${mode}`);
    },
});

/**
 * /vim — Toggle vim keybindings.
 */
registerCommand({
    name: 'vim',
    description: 'Toggle vim keybindings',
    usage: '/vim',
    handler: async () => {
        const { VimModeService } = await import('./VimMode');
        const vim = VimModeService.getInstance();
        vim.toggle();
        useAppState.getState().toggleVim();
        const enabled = useAppState.getState().vimEnabled;
        useAppState.getState().setVimMode(enabled ? vim.getMode() : null);
        addSystemMessage(enabled ? 'Vim mode enabled (press Escape for normal mode)' : 'Vim mode disabled');
    },
});

/**
 * /detail — Cycle detail level (minimal, normal, detailed).
 */
registerCommand({
    name: 'detail',
    description: 'Cycle detail level',
    usage: '/detail',
    handler: async () => {
        useAppState.getState().cycleDetailLevel();
        const level = useAppState.getState().detailLevel;
        addSystemMessage(`Detail level: ${level}`);
    },
});

/**
 * /compact — Manually trigger context compaction for agents.
 */
registerCommand({
    name: 'compact',
    description: 'Compact agent context to free memory',
    usage: '/compact [agent-id]',
    handler: async (args: string, context: CommandContext) => {
        if (!context.bridge) {
            addErrorMessage('Not connected to MXF server.');
            return;
        }

        const targetId = args.trim() || null;

        if (targetId) {
            addSystemMessage(`Compacting context for ${targetId}...`);
            try {
                await context.bridge.call('compactAgent', { agentId: targetId });
                addSystemMessage(`Context compacted for ${targetId}`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addErrorMessage(`Failed to compact: ${message}`);
            }
        } else {
            // Compact all agents
            const state = useAppState.getState();
            addSystemMessage(`Compacting context for ${state.agents.length} agents...`);

            let compactedCount = 0;
            for (const agent of state.agents) {
                try {
                    await context.bridge.call('compactAgent', { agentId: agent.id });
                    compactedCount++;
                } catch {
                    // Continue with other agents
                }
            }

            addSystemMessage(`Context compacted for ${compactedCount}/${state.agents.length} agents`);
        }
    },
});

/**
 * /filter — Filter conversation display by message type.
 */
registerCommand({
    name: 'filter',
    description: 'Filter conversation by message type',
    usage: '/filter [user|agent|system|error|activity|all]',
    handler: async (args: string) => {
        const filterType = args.trim().toLowerCase();

        if (!filterType || filterType === 'all') {
            useAppState.getState().setEntryFilter(null);
            addSystemMessage('Filter cleared: showing all messages');
            return;
        }

        if (!VALID_FILTER_TYPES.has(filterType)) {
            const validTypes = Array.from(VALID_FILTER_TYPES).join(', ');
            addErrorMessage(`Unknown filter type: ${filterType}\nValid types: ${validTypes}, all`);
            return;
        }

        useAppState.getState().setEntryFilter(filterType);
        addSystemMessage(`Showing only: ${filterType} messages`);
    },
});

/**
 * /search <term> — Search conversation messages.
 */
registerCommand({
    name: 'search',
    description: 'Search conversation messages',
    usage: '/search <term>',
    handler: async (args: string) => {
        if (!args.trim()) {
            addSystemMessage('Usage: /search <term>\nSearches conversation messages for matching text.');
            return;
        }

        const state = useAppState.getState();
        const query = args.trim().toLowerCase();
        const matches = state.messages.filter(m =>
            m.content.toLowerCase().includes(query) ||
            m.agentName?.toLowerCase().includes(query),
        );

        if (matches.length === 0) {
            addSystemMessage(`No messages matching "${args.trim()}".`);
            return;
        }

        const maxResults = 20;
        const shown = matches.slice(-maxResults);
        const lines = [
            `Found ${matches.length} matching messages${matches.length > maxResults ? ` (showing last ${maxResults})` : ''}:`,
            '',
        ];

        for (const msg of shown) {
            const time = new Date(msg.timestamp).toLocaleTimeString();
            const source = msg.agentName || msg.type;
            const preview = msg.content.replace(/\n+/g, ' ').substring(0, 120);
            const suffix = msg.content.length > 120 ? '...' : '';
            lines.push(`  [${time}] ${source}: ${preview}${suffix}`);
        }

        addSystemMessage(lines.join('\n'));
    },
});

/**
 * /export — Export conversation to a file.
 */
registerCommand({
    name: 'export',
    description: 'Export conversation to file (md or json)',
    usage: '/export [md|json]',
    handler: async (args: string) => {
        const state = useAppState.getState();
        if (state.messages.length === 0) {
            addSystemMessage('No conversation messages to export.');
            return;
        }

        const format = (args.trim().toLowerCase() || 'md') as 'md' | 'json';
        if (format !== 'md' && format !== 'json') {
            addErrorMessage(`Unknown format: ${format}. Use "md" or "json".`);
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `mxf-conversation-${state.sessionId || 'unknown'}-${timestamp}.${format}`;

        let content: string;
        if (format === 'json') {
            content = JSON.stringify({
                sessionId: state.sessionId,
                exportedAt: new Date().toISOString(),
                messageCount: state.messages.length,
                messages: state.messages.map(m => ({
                    type: m.type,
                    timestamp: m.timestamp,
                    agentName: m.agentName || null,
                    content: m.content,
                })),
            }, null, 2);
        } else {
            const lines = [
                `# MXF Conversation — Session ${state.sessionId}`,
                `*Exported: ${new Date().toLocaleString()}*`,
                '',
            ];
            for (const msg of state.messages) {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                switch (msg.type) {
                    case 'user':
                        lines.push(`## User [${time}]`, '', msg.content, '');
                        break;
                    case 'agent':
                        lines.push(`### ${msg.agentName || 'Agent'} [${time}]`, '', msg.content, '');
                        break;
                    case 'system':
                        lines.push(`*System: ${msg.content}*`, '');
                        break;
                    case 'error':
                        lines.push(`**Error**: ${msg.content}`, '');
                        break;
                    case 'activity':
                        lines.push(`> ${msg.agentName || 'Agent'}: ${msg.content}`, '');
                        break;
                }
            }
            content = lines.join('\n');
        }

        // Write via Tauri shell command (since we can't use Node fs)
        try {
            await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_shell_command', {
                command: `cat > "${filename}" << 'MXFEOF'\n${content}\nMXFEOF`,
            });
            addSystemMessage(`Conversation exported to: ${filename}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addErrorMessage(`Failed to export: ${message}`);
        }
    },
});

/**
 * /retry — Resubmit the last user task.
 */
registerCommand({
    name: 'retry',
    description: 'Resubmit the last task',
    usage: '/retry',
    handler: async (_args: string, context: CommandContext) => {
        const state = useAppState.getState();

        // Find the most recent user message that is a task (not shell or slash command)
        let lastTask: string | null = null;
        for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i];
            if (msg.type === 'user' && !msg.content.startsWith('!') && !msg.content.startsWith('/')) {
                lastTask = msg.content;
                break;
            }
        }

        if (!lastTask) {
            addSystemMessage('No previous task to retry.');
            return;
        }

        addSystemMessage(`Retrying: ${lastTask.substring(0, 100)}${lastTask.length > 100 ? '...' : ''}`);
        await context.submitTask(lastTask);
    },
});

/**
 * /tasks — Show task activity from the current session.
 */
registerCommand({
    name: 'tasks',
    description: 'Show task activity and status',
    usage: '/tasks',
    handler: async () => {
        const state = useAppState.getState();

        const lines: string[] = ['Task Activity:'];

        if (state.currentTaskTitle) {
            lines.push(`  Current task: ${state.currentTaskTitle}`);
        } else {
            lines.push('  Current task: none (idle)');
        }
        lines.push('');

        // Extract task-related system messages
        const taskMessages = state.messages.filter(m =>
            m.type === 'system' && (
                m.content.startsWith('Task created:') ||
                m.content.startsWith('Task assigned:') ||
                m.content === 'Task Complete'
            ),
        );

        const completedCount = state.messages.filter(m =>
            m.type === 'system' && m.content === 'Task Complete',
        ).length;

        const failedCount = state.messages.filter(m =>
            m.type === 'error' && m.content.toLowerCase().includes('task'),
        ).length;

        lines.push(`  Completed: ${completedCount}  Failed: ${failedCount}`);

        if (taskMessages.length > 0) {
            lines.push('', '  Recent task events:');
            for (const msg of taskMessages.slice(-15)) {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                lines.push(`    [${time}] ${msg.content}`);
            }
        }

        // Per-agent activity summary
        const agentData = Object.entries(state.costData.agents);
        if (agentData.length > 0) {
            lines.push('', '  Agent token usage:');
            for (const [agentId, data] of agentData) {
                const agent = state.agents.find(a => a.id === agentId);
                const name = agent?.name || agentId;
                lines.push(`    ${name.padEnd(14)} ${data.totalTokens.toLocaleString()} tokens`);
            }
        }

        addSystemMessage(lines.join('\n'));
    },
});

/**
 * /debug — Show internal state for debugging.
 */
registerCommand({
    name: 'debug',
    description: 'Show internal state (tokens, connection, agents)',
    usage: '/debug',
    handler: async () => {
        const state = useAppState.getState();

        const agentLines = Object.entries(state.costData.agents).map(([agentId, data]) => {
            const agent = state.agents.find(a => a.id === agentId);
            const name = agent?.name || agentId;
            return `    ${name.padEnd(14)} ${data.totalTokens.toLocaleString()} tokens  model: ${data.lastModel || 'unknown'}`;
        });

        const lines = [
            'Desktop Debug State:',
            `  Connection:       ${state.connection}`,
            `  Session ID:       ${state.sessionId}`,
            `  Messages:         ${state.messages.length}`,
            `  Agent working:    ${state.isAgentWorking}`,
            `  Current task:     ${state.currentTaskTitle || 'none'}`,
            `  Mode:             ${state.currentMode}`,
            `  Theme:            ${state.theme}`,
            `  Vim:              ${state.vimEnabled}`,
            `  Detail:           ${state.detailLevel}`,
            `  Confirmations:    ${state.confirmationQueue.length}`,
            `  Context loaded:   ${state.contextString ? `${state.contextString.length} chars` : 'none'}`,
            `  Filter:           ${state.entryFilter || 'none'}`,
            `  Stream preview:   ${state.streamPreview ? `${state.streamPreview.length} chars` : 'none'}`,
            '',
            '  Per-Agent Tokens:',
            ...(agentLines.length > 0 ? agentLines : ['    (no agent activity yet)']),
        ];

        addSystemMessage(lines.join('\n'));
    },
});

/**
 * /history — Show recent session history or load a past session.
 */
registerCommand({
    name: 'history',
    description: 'Show session history or load a session',
    usage: '/history [load <id>]',
    handler: async (args: string) => {
        const { listSessions, loadSession, formatSessionList } = await import('./SessionHistory');
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || '';

        // /history load <id> — restore a saved session into the conversation
        if (subcommand === 'load') {
            const targetId = parts[1];
            if (!targetId) {
                addErrorMessage('Usage: /history load <session-id>');
                return;
            }

            try {
                const record = await loadSession(targetId);
                if (!record) {
                    addErrorMessage(`Session not found: ${targetId}`);
                    return;
                }

                const state = useAppState.getState();
                // Load messages from the saved session
                state.clearMessages();
                for (const msg of record.messages) {
                    state.addMessage(msg);
                }
                state.setSessionId(record.sessionId);
                addSystemMessage(`Loaded session ${targetId} (${record.messageCount} messages, ${new Date(record.startTime).toLocaleString()})`);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addErrorMessage(`Failed to load session: ${message}`);
            }
            return;
        }

        // Default: list sessions
        try {
            const summaries = await listSessions();
            addSystemMessage(formatSessionList(summaries));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addErrorMessage(`Failed to load session history: ${message}`);
        }
    },
});

/**
 * /activity — Toggle agent activity panel visibility.
 */
registerCommand({
    name: 'activity',
    description: 'Toggle agent activity display',
    usage: '/activity',
    handler: async () => {
        useAppState.getState().toggleAgentActivity();
        const visible = useAppState.getState().showAgentActivity;
        addSystemMessage(`Agent activity display ${visible ? 'enabled' : 'disabled'}`);
    },
});

/**
 * /font — Adjust font size (desktop-only).
 */
registerCommand({
    name: 'font',
    description: 'Adjust font size (e.g., /font 14, /font +2, /font -1)',
    usage: '/font [size|+N|-N]',
    handler: async (args: string) => {
        const root = document.documentElement;
        const current = parseFloat(getComputedStyle(root).getPropertyValue('--font-size-base') || '13');

        if (!args.trim()) {
            addSystemMessage(`Current font size: ${current}px\nUsage: /font 14, /font +2, /font -1`);
            return;
        }

        const arg = args.trim();
        let newSize: number;

        if (arg.startsWith('+') || arg.startsWith('-')) {
            newSize = current + parseFloat(arg);
        } else {
            newSize = parseFloat(arg);
        }

        if (isNaN(newSize) || newSize < 8 || newSize > 32) {
            addErrorMessage('Font size must be between 8 and 32.');
            return;
        }

        root.style.setProperty('--font-size-base', `${newSize}px`);
        addSystemMessage(`Font size changed to ${newSize}px`);
    },
});

/**
 * /terminal — Toggle the embedded terminal panel.
 */
registerCommand({
    name: 'terminal',
    description: 'Toggle embedded terminal panel',
    usage: '/terminal',
    handler: async () => {
        useAppState.getState().toggleTerminal();
        const visible = useAppState.getState().showTerminal;
        addSystemMessage(`Terminal panel ${visible ? 'opened' : 'closed'}`);
    },
});

/**
 * /notify — Toggle desktop notifications (desktop-only).
 */
registerCommand({
    name: 'notify',
    description: 'Toggle desktop notifications for confirmations',
    usage: '/notify',
    handler: async () => {
        // Request notification permission if not granted
        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        const granted = 'Notification' in window && Notification.permission === 'granted';
        addSystemMessage(
            granted
                ? 'Desktop notifications enabled. You will be notified when agents need confirmation.'
                : 'Desktop notifications denied. Enable in system preferences.',
        );
    },
});
