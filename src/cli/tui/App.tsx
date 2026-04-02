/**
 * MXF CLI TUI — Root Application Component
 *
 * The main Ink application component for the interactive TUI mode.
 * Manages app state via useReducer, wires up hooks for session management,
 * event monitoring, input handling, and confirmation prompts, and renders the layout.
 *
 * Layout:
 *   [STATIC — permanent in terminal scrollback]
 *     HeaderBar        — MXF title + session ID (rendered once at startup)
 *     WelcomeMessage   — shown if no entries yet (rendered once)
 *     Entries          — each conversation entry rendered once via <Static>
 *
 *   [DYNAMIC — redrawn at bottom of terminal]
 *     ThinkingIndicator — active agent spinner
 *     StatusBar         — agent indicators, tokens, elapsed time, live connection dot
 *     InputLine         — multiline text input with `> ` prompt (or [y/n] in confirmation mode)
 *     InfoBar           — horizontal rule + mode, agent status, confirmation alert
 *
 * Exported `launchTUI()` function is the entry point called from
 * src/cli/index.ts when no subcommand is provided.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useReducer, useCallback, useRef, useMemo } from 'react';
import { render, Box, Static, useApp } from 'ink';
import prompts from 'prompts';
import { appReducer, createInitialState } from './state';
import type { TuiConfig, StaticItem } from './types';
import type { AgentDefinition } from './agents/AgentDefinitions';
import { getEnabledAgentDefinitions, getAgentMaps } from './agents/AgentDefinitions';
import { loadAll, loadBuiltIn } from './agents/AgentLoader';
import { InteractiveSessionManager } from './services/InteractiveSessionManager';
import { HeaderBar } from './components/HeaderBar';
import { ConversationEntry } from './components/ConversationEntry';
import { WelcomeMessage } from './components/WelcomeMessage';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { StatusBar } from './components/StatusBar';
import { InputLine } from './components/InputLine';
import { InfoBar } from './components/InfoBar';
import { useSession } from './hooks/useSession';
import { useEventMonitor } from './hooks/useEventMonitor';
import { useInputHandler } from './hooks/useInputHandler';
import { useConfirmation } from './hooks/useConfirmation';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useThrottledValue } from './hooks/useThrottledValue';
import { ThemeProvider } from './theme/ThemeContext';
import { ToolPermissionService } from './services/ToolPermissionService';

// Import slash command handlers to register them
import './commands/handlers';

import { estimateCost } from './services/CostTracker';
import { disableClientLogging } from '../../shared/utils/Logger';
import { ConfigService } from '../services/ConfigService';
import { HealthChecker } from '../services/HealthChecker';
import { logError, logInfo, logSuccess } from '../utils/output';
import path from 'path';
import fs from 'fs';

interface AppProps {
    /** TUI configuration derived from ~/.mxf/config.json */
    config: TuiConfig;
    /** InteractiveSessionManager instance (created before render) */
    session: InteractiveSessionManager;
}

/**
 * Root TUI application component.
 *
 * Renders the full-screen layout and wires up all hooks
 * for session management, event monitoring, input handling,
 * and confirmation prompts.
 */
const App: React.FC<AppProps> = ({ config, session }) => {
    const { exit } = useApp();
    const [state, dispatch] = useReducer(appReducer, config.preferences, createInitialState);

    // Stable reference to current state for session history saving on unmount
    const stateRef = useRef(state);
    stateRef.current = state;
    const getState = useCallback(() => stateRef.current, []);

    // Build dynamic agent name/color maps from definitions
    const agentMaps = useMemo(() => {
        return getAgentMaps(config.agentDefinitions);
    }, [config.agentDefinitions]);

    // Find the orchestrator agent ID for event monitoring
    const orchestratorId = useMemo(() => {
        const orchestrator = config.agentDefinitions.find(d => d.role === 'orchestrator');
        return orchestrator?.agentId || '';
    }, [config.agentDefinitions]);

    // Build lowercase agent names for @mention autocomplete in InputLine
    const agentNamesForAutocomplete = useMemo(() => {
        return config.agentDefinitions.map(d => d.name.toLowerCase());
    }, [config.agentDefinitions]);

    // Derive active agents for thinking indicator (agents with status 'active')
    const activeAgents = useMemo(() => {
        return state.agents.filter(a => a.status === 'active');
    }, [state.agents]);

    // Throttle entry updates to reduce visual churn from Ink's full-screen redraws.
    // During rapid agent activity (10+ entries/sec), this batches updates to ~7/sec.
    const throttledEntries = useThrottledValue(state.entries, 150);

    // Throttle streamPreview separately at ~5/sec (200ms) so rapid LLM chunks
    // only re-render the 1-line ThinkingIndicator, not the entire ConversationArea
    const throttledStreamPreview = useThrottledValue(state.streamPreview, 200);

    // Compute thinking indicator visibility for conditional agent list
    const showThinking = state.isAgentWorking && activeAgents.length > 0;

    // Build static items array for Ink's <Static>. Each item is rendered once
    // to stdout and lives in terminal scrollback — older entries are never re-rendered.
    // HeaderBar renders once at the top. Connection status lives in StatusBar (dynamic).
    // When entryFilter is active, only entries matching the filter type are shown.
    // System entries from /filter itself always pass through so the user sees confirmation.
    const staticItems = useMemo((): StaticItem[] => {
        const items: StaticItem[] = [
            { kind: 'header', id: '__header__' },
        ];
        if (throttledEntries.length === 0) {
            items.push({ kind: 'welcome', id: '__welcome__' });
        }
        for (const entry of throttledEntries) {
            // Filter out activity cards when showAgentActivity is disabled
            if (!state.showAgentActivity && entry.type === 'activity-card') continue;

            // Apply entry type filter when active. System messages about filtering
            // always pass through so the user sees filter confirmations.
            if (state.entryFilter) {
                const isFilterSystemMessage = entry.type === 'system' && (
                    entry.content.startsWith('Showing only:') ||
                    entry.content.startsWith('Filter cleared:') ||
                    entry.content.startsWith('Unknown filter type:')
                );
                if (!isFilterSystemMessage && entry.type !== state.entryFilter) continue;
            }

            items.push({ kind: 'entry', id: entry.id, entry, detailMode: state.detailMode });
        }
        return items;
    }, [throttledEntries, state.detailMode, state.showAgentActivity, state.entryFilter]);

    // Session lifecycle — connect on mount (creates agents), disconnect on unmount
    // Saves session history to ~/.mxf/sessions/ on disconnect
    const { submitTask, submitTaskToAgent } = useSession(session, dispatch, getState);

    // Context compaction callback — triggered when an agent approaches its context window limit
    const handleContextCompactNeeded = useCallback((agentId: string) => {
        session.compactAgent(agentId);
    }, [session]);

    // Event monitoring — subscribe to channel events after connection
    // Includes context window threshold checking and compaction triggers
    useEventMonitor(session.getChannel(), dispatch, agentMaps.names, orchestratorId, getState, handleContextCompactNeeded);

    // Tool permission service — evaluates auto-approve/deny rules from config and session
    const permissionService = useMemo(() => new ToolPermissionService(), []);

    // Confirmation hook — bridges agent user_input requests to [y/n] prompts
    // Permission service is checked before showing prompts (auto-approve/deny if matched)
    const { handleConfirmationResponse } = useConfirmation(session, dispatch, agentMaps.names, permissionService);

    // Exit callback for /exit command and Ctrl+C
    const requestExit = useCallback(() => {
        exit();
    }, [exit]);

    // Global keyboard shortcuts — Ctrl+C, Esc, Ctrl+L, Ctrl+S, Ctrl+A
    useKeyboardShortcuts(dispatch, state, requestExit);

    // Compute estimated cost from per-agent token usage
    const estimatedCost = useMemo(() => {
        const agents = Object.values(state.costData.agents);
        let total: number | null = null;
        for (const agent of agents) {
            if (agent.lastModel && agent.totalTokens > 0) {
                const cost = estimateCost(agent.inputTokens, agent.outputTokens, agent.lastModel);
                if (cost !== null) total = (total ?? 0) + cost;
            }
        }
        return total;
    }, [state.costData]);

    // Input handler — routes /, !, @mentions, and natural language
    const handleInput = useInputHandler(
        session, dispatch, state, submitTask, submitTaskToAgent, requestExit, permissionService,
    );

    // Selection handler — resolves pending selections (e.g., model picker)
    const handleSelection = useCallback((value: string) => {
        const selection = state.pendingSelection;
        if (!selection) return;

        if (selection.kind === 'model') {
            session.setDefaultModel(value);
            dispatch({ type: 'SET_MODEL_OVERRIDE', model: value });
            dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'system', content: `Model changed to: ${value}` },
            });
        }

        // Clear selection mode
        dispatch({ type: 'SET_PENDING_SELECTION', selection: null });
    }, [state.pendingSelection, session, dispatch]);

    return (
        <ThemeProvider themeName={state.currentTheme}>
            {/* Static items: rendered once to stdout and live in terminal scrollback.
             * HeaderBar, WelcomeMessage, and conversation entries are permanent —
             * scrolling uses the terminal's native scrollback buffer. */}
            <Static items={staticItems}>
                {(item: StaticItem) => {
                    switch (item.kind) {
                        case 'header':
                            return (
                                <HeaderBar
                                    key={item.id}
                                    sessionId={state.sessionId}
                                    sessionName={config.sessionName}
                                />
                            );
                        case 'welcome':
                            return <WelcomeMessage key={item.id} />;
                        case 'entry':
                            return (
                                <ConversationEntry
                                    key={item.id}
                                    entry={item.entry}
                                    detailMode={item.detailMode}
                                />
                            );
                    }
                }}
            </Static>

            {/* Dynamic chrome — redrawn each frame at the bottom of the terminal */}
            <Box flexDirection="column">
                <ThinkingIndicator
                    activeAgents={showThinking ? activeAgents : []}
                    streamPreview={showThinking ? throttledStreamPreview : null}
                />

                <StatusBar
                    agents={state.agents}
                    iterationCount={state.costData.totalIterations}
                    isAgentWorking={state.isAgentWorking}
                    totalTokens={state.costData.totalTokens}
                    estimatedCost={estimatedCost}
                    connection={state.connection}
                />

                <InputLine
                    onSubmit={handleInput}
                    confirmationPending={state.confirmationPending}
                    confirmationTitle={state.confirmationTitle}
                    onConfirmation={handleConfirmationResponse}
                    dispatch={dispatch}
                    agentNames={agentNamesForAutocomplete}
                    pendingSelection={state.pendingSelection}
                    onSelection={handleSelection}
                    currentMode={state.currentMode}
                />

                <InfoBar
                    currentMode={state.currentMode}
                    activeAgents={activeAgents}
                    isAgentWorking={state.isAgentWorking}
                    confirmationPending={state.confirmationPending}
                    confirmationTitle={state.confirmationTitle}
                    confirmationQueueSize={state.confirmationQueueSize}
                    vimMode={state.vimMode}
                />
            </Box>
        </ThemeProvider>
    );
};

/**
 * Prompt the user to select which agents to enable.
 *
 * Shows a multiselect list of all available agents (built-in + custom)
 * with descriptions. At least one agent must be selected.
 *
 * @param available - All available agent definitions
 * @returns Array of selected agent IDs
 */
async function promptAgentSelection(available: AgentDefinition[]): Promise<string[]> {
    logInfo('\nAgent Selection');
    logInfo('Choose which agents to enable for your sessions.\n');

    const response = await prompts({
        type: 'multiselect',
        name: 'agents',
        message: 'Select agents to enable',
        choices: available.map(def => ({
            title: `${def.name} (${def.role})`,
            description: def.description,
            value: def.agentId,
            selected: true, // All enabled by default
        })),
        min: 1,
        hint: 'Space to toggle, Enter to confirm',
    }, {
        onCancel: () => {
            logInfo('Using all agents (default).');
        },
    });

    // If cancelled, return all agent IDs
    if (!response.agents || response.agents.length === 0) {
        return available.map(d => d.agentId);
    }

    return response.agents;
}

/**
 * Launch the interactive TUI.
 *
 * Performs pre-flight checks, resolves agent selection (config, CLI flag,
 * or interactive prompt), creates the InteractiveSessionManager, and
 * renders the Ink app.
 *
 * Called from src/cli/index.ts when no subcommand is provided.
 *
 * @param sessionName - Optional named session for multi-terminal sharing.
 *   When provided, the channel ID is derived from the session name so
 *   multiple terminals with the same `--session` flag share a channel.
 * @param agentIds - Optional CLI override for which agents to enable.
 *   When provided, overrides the config setting for this session only.
 * @param workingDirectory - Optional working directory for file operations.
 *   When provided, process.chdir() is called so all file tools resolve
 *   paths relative to this directory. Also injected into agent system prompts.
 */
export async function launchTUI(sessionName?: string, agentIds?: string[], workingDirectory?: string): Promise<void> {
    // Pre-flight 1: Load config
    const configService = ConfigService.getInstance();
    const config = configService.load();

    if (!config) {
        logError('No MXF configuration found.');
        logInfo('Run `mxf install` to set up MXF infrastructure first.');
        process.exit(1);
    }

    // Pre-flight 2: Check user access token
    if (!config.user?.accessToken) {
        logError('No user access token found.');
        logInfo('Run `mxf install --complete-setup` to create a user and generate an access token.');
        process.exit(1);
    }

    // Pre-flight 3: Check LLM configuration
    if (!config.llm?.provider || !config.llm?.apiKey) {
        logError('LLM provider not configured.');
        logInfo('Run `mxf init` to configure your LLM provider and API key.');
        process.exit(1);
    }

    // Pre-flight 4: Check server is running
    const serverUrl = `http://${config.server.host}:${config.server.port}`;
    const serverRunning = await HealthChecker.getInstance().isServerRunning(serverUrl);

    if (!serverRunning) {
        logError('MXF server is not running.');
        logInfo('Start the server with: bun run dev');
        process.exit(1);
    }

    // ─── Working Directory ────────────────────────────────────────
    // Resolve and validate the working directory. When --cwd is provided,
    // chdir so all file tools (read_file, write_file, etc.) resolve from there.
    const resolvedCwd = workingDirectory ? path.resolve(workingDirectory) : process.cwd();
    if (workingDirectory) {
        if (!fs.existsSync(resolvedCwd)) {
            logError(`Working directory does not exist: ${resolvedCwd}`);
            process.exit(1);
        }
        if (!fs.statSync(resolvedCwd).isDirectory()) {
            logError(`Working directory is not a directory: ${resolvedCwd}`);
            process.exit(1);
        }
        process.chdir(resolvedCwd);
        logInfo(`Working directory: ${resolvedCwd}`);
    }

    // Suppress SDK client logging during TUI rendering.
    // SDK loggers (ClientEventBus, MxfAgent, etc.) use target='client' and
    // LOGGING_CONFIG.client defaults to level='debug'. Console output from
    // these loggers corrupts Ink's virtual terminal rendering.
    disableClientLogging();

    // ─── Agent Selection ───────────────────────────────────────────
    // Priority: CLI flag > config > prompt (first run)
    const customDir = config.agents?.customAgentsDir;
    const allAvailable = loadAll(customDir);

    let enabledIds: string[] | undefined;

    if (agentIds && agentIds.length > 0) {
        // CLI flag: --agents planner,coder
        // Resolve short names (e.g., "planner") to full IDs (e.g., "mxf-planner")
        enabledIds = agentIds.map(id => {
            // If already a full ID, use as-is
            const exact = allAvailable.find(d => d.agentId === id);
            if (exact) return id;
            // Try matching by name (case-insensitive)
            const byName = allAvailable.find(d => d.name.toLowerCase() === id.toLowerCase());
            if (byName) return byName.agentId;
            // Try matching by ID with mxf- prefix
            const withPrefix = allAvailable.find(d => d.agentId === `mxf-${id}`);
            if (withPrefix) return withPrefix.agentId;
            // Unknown — return as-is, will be filtered out by getEnabledAgentDefinitions
            return id;
        });
    } else if (config.agents?.enabled && config.agents.enabled.length > 0) {
        // Config has saved agent selection — also auto-detect new built-in agents
        // that were added after the initial selection and include them
        enabledIds = [...config.agents.enabled];
        const builtInDefs = loadBuiltIn();
        const newBuiltIn = builtInDefs.filter(d => !enabledIds!.includes(d.agentId));
        if (newBuiltIn.length > 0) {
            for (const def of newBuiltIn) {
                enabledIds.push(def.agentId);
            }
            // Persist the updated list so we don't re-detect next time
            configService.set('agents', {
                enabled: enabledIds,
                customAgentsDir: config.agents?.customAgentsDir,
            });
            logInfo(`New built-in agents detected and enabled: ${newBuiltIn.map(d => d.name).join(', ')}`);
        }
    } else {
        // First run — prompt user to select agents
        enabledIds = await promptAgentSelection(allAvailable);

        // Save selection to config so we don't ask again
        configService.set('agents', {
            enabled: enabledIds,
            customAgentsDir: config.agents?.customAgentsDir,
        });
        logSuccess(`Agent selection saved to config (${enabledIds.length} agents enabled).`);
    }

    // Load the selected agent definitions
    const agentDefinitions = getEnabledAgentDefinitions(enabledIds, customDir);

    if (agentDefinitions.length === 0) {
        logError('No valid agent definitions found.');
        logInfo('Check your agent .md files or reset with: mxf config set agents.enabled []');
        process.exit(1);
    }

    // Verify at least one orchestrator is present
    const hasOrchestrator = agentDefinitions.some(d => d.role === 'orchestrator');
    if (!hasOrchestrator) {
        logError('No orchestrator agent enabled. You need at least one agent with role: orchestrator.');
        logInfo('Enable the Planner agent or create a custom agent with role: orchestrator.');
        process.exit(1);
    }

    // Build TUI config from loaded config
    const tuiConfig: TuiConfig = {
        serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY || config.credentials.domainKey,
        accessToken: config.user.accessToken,
        llmProvider: config.llm.provider,
        apiKey: config.llm.apiKey,
        defaultModel: config.llm.defaultModel,
        sessionName,
        preferences: config.preferences,
        agentDefinitions,
        agentModels: config.agents?.models,
        workingDirectory: resolvedCwd,
    };

    // Create session manager
    const session = new InteractiveSessionManager(tuiConfig);

    // Render the TUI (preserves terminal scrollback history)
    const instance = render(
        <App config={tuiConfig} session={session} />,
        { exitOnCtrlC: false },
    );

    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
        await session.disconnect();
        instance.unmount();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await session.disconnect();
        instance.unmount();
        process.exit(0);
    });

    // Wait for the Ink instance to exit
    await instance.waitUntilExit();
}
