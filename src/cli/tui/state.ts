/**
 * MXF CLI TUI — State Management
 *
 * Central application state managed via React's useReducer pattern.
 * All TUI state mutations go through the reducer via typed actions.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { v4 as uuidv4 } from 'uuid';
import type { ConversationEntry, AgentInfo, ConnectionStatus } from './types';
import type { SessionCostData } from './services/CostTracker';
import { createInitialCostData, trackIteration, trackTokenUsage } from './services/CostTracker';
/** Resolve an agent name from the agents array in state, falling back to the raw ID */
function resolveAgentName(agents: AgentInfo[], agentId: string): string {
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || agentId;
}

/** Full application state for the TUI */
export interface AppState {
    /** SDK connection status */
    connection: ConnectionStatus;
    /** Current session ID (truncated UUID for display) */
    sessionId: string;
    /** All conversation entries (messages, tool calls, system notices) */
    entries: ConversationEntry[];
    /** Active agents in the session */
    agents: AgentInfo[];
    /** Running token count for the session */
    tokenCount: number;
    /** ID of the currently active task (null when idle) */
    currentTaskId: string | null;
    /** Whether an agent is actively processing */
    isAgentWorking: boolean;
    /** Accumulated context string from /context commands */
    contextString: string | null;
    /** Current model override (null = use default from config) */
    modelOverride: string | null;
    /** Error message (displayed as system notice) */
    error: string | null;
    /** Whether a confirmation prompt is pending (locks input to [y/n] mode) */
    confirmationPending: boolean;
    /** Entry ID of the pending confirmation prompt (for resolving) */
    pendingConfirmationEntryId: string | null;
    /** Title of the pending confirmation prompt (shown inline in [y/n] input) */
    confirmationTitle: string | null;
    /** Whether to show full tool args and timestamps (toggled by Ctrl+A) */
    detailMode: boolean;
    /** Per-agent iteration and cost tracking data */
    costData: SessionCostData;
    /** Current theme name (dark, light, minimal) */
    currentTheme: string;
    /** Whether to show agent activity cards in conversation */
    showAgentActivity: boolean;
    /** Pending selection choices (e.g., model picker). Locks input to selection mode. */
    pendingSelection: PendingSelection | null;
    /** Current interaction mode: chat (conversational), plan (planning only), action (full delegation, default) */
    currentMode: 'chat' | 'plan' | 'action';
    /** Live streaming preview from the active LLM response (null when not streaming) */
    streamPreview: { agentId: string; text: string } | null;
}

/** A pending selection prompt shown in the InputLine */
export interface PendingSelection {
    /** What kind of selection (for the resolve callback) */
    kind: 'model';
    /** Choices the user can pick from via arrow-key navigation */
    choices: Array<{ label: string; value: string }>;
    /** Pre-select the current value in the list */
    defaultValue?: string;
}

/** All possible actions that can modify the TUI state */
export type AppAction =
    | { type: 'ADD_ENTRY'; entry: Omit<ConversationEntry, 'id' | 'timestamp'> }
    | { type: 'SET_CONNECTION'; status: ConnectionStatus }
    | { type: 'SET_AGENTS'; agents: AgentInfo[] }
    | { type: 'SET_AGENT_STATUS'; agentId: string; status: AgentInfo['status'] }
    | { type: 'SET_TASK'; taskId: string | null }
    | { type: 'CLEAR_ENTRIES' }
    | { type: 'SET_ERROR'; error: string | null }
    | { type: 'ADD_TOKENS'; count: number }
    | { type: 'SET_AGENT_WORKING'; working: boolean }
    | { type: 'SET_CONTEXT'; contextString: string | null }
    | { type: 'SET_MODEL_OVERRIDE'; model: string | null }
    | { type: 'UPDATE_ENTRY'; entryId: string; updates: Partial<ConversationEntry> }
    | { type: 'SET_CONFIRMATION_PENDING'; pending: boolean; entryId?: string | null; title?: string }
    | { type: 'TOGGLE_DETAIL_MODE' }
    | { type: 'TRACK_ITERATION'; agentId: string; iterationType: 'message' | 'tool-call' | 'task-complete' }
    | { type: 'TRACK_TOKEN_USAGE'; agentId: string; inputTokens: number; outputTokens: number; totalTokens: number; model?: string }
    | { type: 'SET_THEME'; theme: string }
    | { type: 'SET_PENDING_SELECTION'; selection: PendingSelection | null }
    | { type: 'SET_MODE'; mode: 'chat' | 'plan' | 'action' }
    | { type: 'UPDATE_STREAM_PREVIEW'; agentId: string; chunk: string }
    | { type: 'CLEAR_STREAM_PREVIEW' }
    // Compound actions — consolidate multiple state changes into a single dispatch
    // to reduce re-render count (socket callbacks bypass React 18 auto-batching)
    | {
        type: 'ADD_ENTRY_WITH_AGENT_STATUS';
        entry: Omit<ConversationEntry, 'id' | 'timestamp'>;
        agentId: string;
        agentStatus: AgentInfo['status'];
        iteration?: { iterationType: 'message' | 'tool-call' | 'task-complete' };
    }
    | {
        type: 'TASK_RESOLVED';
        resultEntry?: Omit<ConversationEntry, 'id' | 'timestamp'>;
        agentIds: string[];
        clearTaskId: boolean;
    }
    | {
        type: 'COMPLETE_ACTIVITY_CARD';
        agentId: string;
        toolName: string;
        summary: string;
    }
    | {
        /** Compound: add confirmation entry + set pending state in one render.
         * Socket callbacks bypass React 18 auto-batching, so two separate
         * dispatches (ADD_ENTRY + SET_CONFIRMATION_PENDING) cause two renders
         * with a visible gap. This action does both atomically. */
        type: 'SET_CONFIRMATION';
        entry: Omit<ConversationEntry, 'id' | 'timestamp'>;
        title: string | null;
    }
    | {
        /** Compound: add confirmation response entry + clear pending state in one render.
         * Mirrors SET_CONFIRMATION for the response side — prevents the two-dispatch
         * race between ADD_ENTRY and SET_CONFIRMATION_PENDING(false) that causes
         * InputLine to freeze when switching from TextInput back to MultilineInput. */
        type: 'CONFIRMATION_RESPONSE';
        entry: Omit<ConversationEntry, 'id' | 'timestamp'>;
    };

/** Preferences passed from TuiConfig to initial state */
export interface InitialPreferences {
    theme?: string;
    detailModeDefault?: boolean;
    showAgentActivity?: boolean;
}

/** Create the initial application state, optionally applying user preferences */
export function createInitialState(preferences?: InitialPreferences): AppState {
    return {
        connection: 'disconnected',
        sessionId: uuidv4().substring(0, 8),
        entries: [],
        agents: [],
        tokenCount: 0,
        currentTaskId: null,
        isAgentWorking: false,
        contextString: null,
        modelOverride: null,
        error: null,
        confirmationPending: false,
        pendingConfirmationEntryId: null,
        confirmationTitle: null,
        detailMode: preferences?.detailModeDefault ?? false,
        costData: createInitialCostData(),
        currentTheme: preferences?.theme ?? 'dark',
        showAgentActivity: preferences?.showAgentActivity ?? true,
        pendingSelection: null,
        currentMode: 'action',
        streamPreview: null,
    };
}

/** Reducer function for TUI state management */
export function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'ADD_ENTRY':
            return {
                ...state,
                entries: [
                    ...state.entries,
                    {
                        ...action.entry,
                        id: uuidv4(),
                        timestamp: Date.now(),
                    },
                ],
            };

        case 'SET_CONNECTION':
            return {
                ...state,
                connection: action.status,
            };

        case 'SET_AGENTS':
            return {
                ...state,
                agents: action.agents,
            };

        case 'SET_AGENT_STATUS': {
            const agents = state.agents.map((agent) =>
                agent.id === action.agentId
                    ? { ...agent, status: action.status }
                    : agent
            );
            return { ...state, agents };
        }

        case 'SET_TASK':
            return {
                ...state,
                currentTaskId: action.taskId,
            };

        case 'CLEAR_ENTRIES':
            return {
                ...state,
                entries: [],
            };

        case 'SET_ERROR':
            return {
                ...state,
                error: action.error,
            };

        case 'ADD_TOKENS':
            return {
                ...state,
                tokenCount: state.tokenCount + action.count,
            };

        case 'SET_AGENT_WORKING':
            return {
                ...state,
                isAgentWorking: action.working,
            };

        case 'SET_CONTEXT':
            return {
                ...state,
                contextString: action.contextString,
            };

        case 'SET_MODEL_OVERRIDE':
            return {
                ...state,
                modelOverride: action.model,
            };

        case 'UPDATE_ENTRY': {
            const entries = state.entries.map((entry) =>
                entry.id === action.entryId
                    ? { ...entry, ...action.updates }
                    : entry
            );
            return { ...state, entries };
        }

        case 'SET_CONFIRMATION_PENDING':
            return {
                ...state,
                confirmationPending: action.pending,
                pendingConfirmationEntryId: action.entryId ?? null,
                confirmationTitle: action.pending ? (action.title || null) : null,
            };

        case 'TOGGLE_DETAIL_MODE':
            return {
                ...state,
                detailMode: !state.detailMode,
            };

        case 'TRACK_ITERATION': {
            const agentName = resolveAgentName(state.agents, action.agentId);
            return {
                ...state,
                costData: trackIteration(state.costData, action.agentId, agentName, action.iterationType),
            };
        }

        case 'TRACK_TOKEN_USAGE': {
            const tokenAgentName = resolveAgentName(state.agents, action.agentId);
            return {
                ...state,
                costData: trackTokenUsage(
                    state.costData, action.agentId, tokenAgentName,
                    action.inputTokens, action.outputTokens, action.totalTokens, action.model,
                ),
            };
        }

        case 'SET_THEME':
            return {
                ...state,
                currentTheme: action.theme,
            };

        case 'SET_PENDING_SELECTION':
            return {
                ...state,
                pendingSelection: action.selection,
            };

        case 'SET_MODE':
            return {
                ...state,
                currentMode: action.mode,
            };

        case 'UPDATE_STREAM_PREVIEW': {
            // Append chunk to the existing preview text for this agent (or start new)
            const existing = state.streamPreview;
            const newText = existing && existing.agentId === action.agentId
                ? existing.text + action.chunk
                : action.chunk;
            return {
                ...state,
                streamPreview: { agentId: action.agentId, text: newText },
            };
        }

        case 'CLEAR_STREAM_PREVIEW':
            return {
                ...state,
                streamPreview: null,
            };

        // Compound: add entry + update agent status + optionally track iteration in one render
        case 'ADD_ENTRY_WITH_AGENT_STATUS': {
            const newEntry = {
                ...action.entry,
                id: uuidv4(),
                timestamp: Date.now(),
            };
            const updatedAgents = state.agents.map((agent) =>
                agent.id === action.agentId
                    ? { ...agent, status: action.agentStatus }
                    : agent
            );
            let costData = state.costData;
            if (action.iteration) {
                const agentName = resolveAgentName(state.agents, action.agentId);
                costData = trackIteration(costData, action.agentId, agentName, action.iteration.iterationType);
            }
            return {
                ...state,
                entries: [...state.entries, newEntry],
                agents: updatedAgents,
                costData,
            };
        }

        // Complete matching activity card — find the most recent active card for this agent+tool
        case 'COMPLETE_ACTIVITY_CARD': {
            let found = false;
            // Walk backward to find the most recent matching active activity card
            const updatedEntries = [...state.entries];
            for (let i = updatedEntries.length - 1; i >= 0; i--) {
                const entry = updatedEntries[i];
                if (
                    entry.type === 'activity-card' &&
                    entry.agentId === action.agentId &&
                    entry.toolName === action.toolName &&
                    entry.activityStatus === 'active'
                ) {
                    updatedEntries[i] = {
                        ...entry,
                        activityStatus: 'completed',
                        activitySummary: action.summary,
                    };
                    found = true;
                    break;
                }
            }
            if (!found) return state;
            return { ...state, entries: updatedEntries };
        }

        // Compound: add confirmation entry + set pending state in a single render
        case 'SET_CONFIRMATION': {
            const confirmEntry = {
                ...action.entry,
                id: uuidv4(),
                timestamp: Date.now(),
            };
            return {
                ...state,
                entries: [...state.entries, confirmEntry],
                confirmationPending: true,
                pendingConfirmationEntryId: confirmEntry.id,
                confirmationTitle: action.title,
            };
        }

        // Compound: add confirmation response entry + exit confirmation mode atomically
        case 'CONFIRMATION_RESPONSE': {
            const responseEntry = {
                ...action.entry,
                id: uuidv4(),
                timestamp: Date.now(),
            };
            return {
                ...state,
                entries: [...state.entries, responseEntry],
                confirmationPending: false,
                pendingConfirmationEntryId: null,
                confirmationTitle: null,
            };
        }

        // Compound: resolve task completion — add result entry, idle all agents, clear working state
        case 'TASK_RESOLVED': {
            let entries = state.entries;
            if (action.resultEntry) {
                entries = [
                    ...entries,
                    {
                        ...action.resultEntry,
                        id: uuidv4(),
                        timestamp: Date.now(),
                    },
                ];
            }
            const idledAgents = state.agents.map((agent) =>
                action.agentIds.includes(agent.id)
                    ? { ...agent, status: 'idle' as const }
                    : agent
            );
            return {
                ...state,
                entries,
                agents: idledAgents,
                isAgentWorking: false,
                currentTaskId: action.clearTaskId ? null : state.currentTaskId,
                streamPreview: null,
            };
        }

        default:
            return state;
    }
}
