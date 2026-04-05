/**
 * MXF Desktop — Application State (Zustand)
 *
 * Central state store for the desktop app. Replaces the TUI's
 * useReducer pattern with Zustand for simpler component access
 * and built-in selectors.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { create } from 'zustand';
import type {
    AgentInfo,
    ConversationMessage,
    ConfirmationRequest,
    UserInputRequest,
    PendingSelection,
    ConnectionStatus,
    CostData,
    VimMode,
} from '../types';
import { estimateCost } from '../services/CostTracker';

interface AppState {
    // ── Connection ──────────────────────────────────────────────
    connection: ConnectionStatus;
    setConnection: (status: ConnectionStatus) => void;
    sessionId: string | null;
    setSessionId: (id: string | null) => void;

    // ── Messages ────────────────────────────────────────────────
    messages: ConversationMessage[];
    addMessage: (msg: ConversationMessage) => void;
    updateMessage: (id: string, updates: Partial<ConversationMessage>) => void;
    clearMessages: () => void;

    // ── Streaming ───────────────────────────────────────────────
    /** Preview text from the currently streaming LLM response */
    streamPreview: string | null;
    setStreamPreview: (preview: string | null) => void;

    // ── Input ───────────────────────────────────────────────────
    inputValue: string;
    setInputValue: (v: string) => void;

    // ── Mode ────────────────────────────────────────────────────
    currentMode: 'chat' | 'plan' | 'action';
    setMode: (m: 'chat' | 'plan' | 'action') => void;

    // ── Agents ──────────────────────────────────────────────────
    agents: AgentInfo[];
    setAgents: (agents: AgentInfo[]) => void;
    updateAgent: (id: string, updates: Partial<AgentInfo>) => void;
    isAgentWorking: boolean;
    setAgentWorking: (working: boolean) => void;

    // ── Confirmation ────────────────────────────────────────────
    confirmationQueue: ConfirmationRequest[];
    pushConfirmation: (req: ConfirmationRequest) => void;
    resolveConfirmation: (id: string) => void;

    // ── User Input (select, text, multi_select, confirm) ─────
    userInputQueue: UserInputRequest[];
    pushUserInput: (req: UserInputRequest) => void;
    resolveUserInput: (id: string) => void;

    // ── Progress ─────────────────────────────────────────────
    progressStatus: { agentName: string; status: string; detail?: string; percent?: number } | null;
    setProgressStatus: (update: { agentName: string; status: string; detail?: string; percent?: number } | null) => void;

    // ── Selection ───────────────────────────────────────────────
    pendingSelection: PendingSelection | null;
    setPendingSelection: (sel: PendingSelection | null) => void;

    // ── Cost ────────────────────────────────────────────────────
    costData: CostData;
    updateCost: (agentId: string, agentName: string, input: number, output: number, model: string) => void;
    incrementIterations: () => void;
    setCostBudget: (budget: number | null) => void;
    setBudgetWarningEmitted: (emitted: boolean) => void;

    // ── Context ──────────────────────────────────────────────────
    /** File/directory context string to include in the next task */
    contextString: string | null;
    setContextString: (ctx: string | null) => void;

    // ── Filter ──────────────────────────────────────────────────
    /** Filter conversation display to a specific message type */
    entryFilter: string | null;
    setEntryFilter: (filter: string | null) => void;

    // ── UI ──────────────────────────────────────────────────────
    vimEnabled: boolean;
    toggleVim: () => void;
    vimMode: VimMode;
    setVimMode: (mode: VimMode) => void;
    activeTaskStartTime: number | null;
    setActiveTaskStartTime: (time: number | null) => void;
    theme: 'dark' | 'light';
    toggleTheme: () => void;
    detailLevel: 'minimal' | 'normal' | 'detailed';
    cycleDetailLevel: () => void;
    showAgentActivity: boolean;
    toggleAgentActivity: () => void;
    currentTaskTitle: string | null;
    setCurrentTaskTitle: (title: string | null) => void;
    showTerminal: boolean;
    toggleTerminal: () => void;
    workingDirectory: string | null;
    setWorkingDirectory: (dir: string | null) => void;
}

/** Generate a unique message ID */
let messageCounter = 0;
export function generateMessageId(): string {
    return `msg-${Date.now()}-${++messageCounter}`;
}

export const useAppState = create<AppState>((set) => ({
    // ── Connection ──────────────────────────────────────────────
    connection: 'disconnected',
    setConnection: (status) => set({ connection: status }),
    sessionId: null,
    setSessionId: (id) => set({ sessionId: id }),

    // ── Messages ────────────────────────────────────────────────
    messages: [],
    addMessage: (msg) => set((state) => ({
        messages: [...state.messages, msg],
    })),
    updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m,
        ),
    })),
    clearMessages: () => set({ messages: [] }),

    // ── Streaming ───────────────────────────────────────────────
    streamPreview: null,
    setStreamPreview: (preview) => set({ streamPreview: preview }),

    // ── Input ───────────────────────────────────────────────────
    inputValue: '',
    setInputValue: (v) => set({ inputValue: v }),

    // ── Mode ────────────────────────────────────────────────────
    currentMode: 'chat',
    setMode: (m) => set({ currentMode: m }),

    // ── Agents ──────────────────────────────────────────────────
    agents: [],
    setAgents: (agents) => set({ agents }),
    updateAgent: (id, updates) => set((state) => ({
        agents: state.agents.map((a) =>
            a.id === id ? { ...a, ...updates } : a,
        ),
    })),
    isAgentWorking: false,
    setAgentWorking: (working) => set({ isAgentWorking: working }),

    // ── Confirmation ────────────────────────────────────────────
    confirmationQueue: [],
    pushConfirmation: (req) => set((state) => ({
        confirmationQueue: [...state.confirmationQueue, req],
    })),
    resolveConfirmation: (id) => set((state) => ({
        confirmationQueue: state.confirmationQueue.filter((c) => c.id !== id),
    })),

    // ── User Input ───────────────────────────────────────────
    userInputQueue: [],
    pushUserInput: (req) => set((state) => ({
        userInputQueue: [...state.userInputQueue, req],
    })),
    resolveUserInput: (id) => set((state) => ({
        userInputQueue: state.userInputQueue.filter((r) => r.id !== id),
    })),

    // ── Progress ─────────────────────────────────────────────
    progressStatus: null,
    setProgressStatus: (update) => set({ progressStatus: update }),

    // ── Selection ───────────────────────────────────────────────
    pendingSelection: null,
    setPendingSelection: (sel) => set({ pendingSelection: sel }),

    // ── Cost ────────────────────────────────────────────────────
    costData: {
        agents: {},
        totalIterations: 0,
        totalToolCalls: 0,
        totalMessages: 0,
        totalTasks: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        startTime: Date.now(),
        costBudget: null,
        estimatedCost: 0,
        budgetWarningEmitted: false,
        budgetExceeded: false,
    },
    updateCost: (agentId, agentName, input, output, model) => set((state) => {
        const existing = state.costData.agents[agentId] || {
            agentId,
            agentName,
            iterations: 0,
            toolCalls: 0,
            messages: 0,
            tasksCompleted: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            lastModel: null,
        };
        const updated = {
            ...existing,
            inputTokens: existing.inputTokens + input,
            outputTokens: existing.outputTokens + output,
            totalTokens: existing.totalTokens + input + output,
            lastModel: model || existing.lastModel,
        };

        // Estimate cost for this usage event
        const DEFAULT_INPUT_RATE = 3;   // $/1M tokens (Sonnet-tier fallback)
        const DEFAULT_OUTPUT_RATE = 15;
        const usageCost = model
            ? (estimateCost(input, output, model)
                ?? (input * DEFAULT_INPUT_RATE + output * DEFAULT_OUTPUT_RATE) / 1_000_000)
            : (input * DEFAULT_INPUT_RATE + output * DEFAULT_OUTPUT_RATE) / 1_000_000;

        const newEstimatedCost = state.costData.estimatedCost + usageCost;
        const budget = state.costData.costBudget;
        const budgetExceeded = budget !== null && budget > 0 && newEstimatedCost >= budget;

        return {
            costData: {
                ...state.costData,
                agents: { ...state.costData.agents, [agentId]: updated },
                totalInputTokens: state.costData.totalInputTokens + input,
                totalOutputTokens: state.costData.totalOutputTokens + output,
                totalTokens: state.costData.totalTokens + input + output,
                estimatedCost: newEstimatedCost,
                budgetExceeded,
            },
        };
    }),
    incrementIterations: () => set((state) => ({
        costData: {
            ...state.costData,
            totalIterations: state.costData.totalIterations + 1,
        },
    })),
    setCostBudget: (budget) => set((state) => ({
        costData: { ...state.costData, costBudget: budget },
    })),
    setBudgetWarningEmitted: (emitted) => set((state) => ({
        costData: { ...state.costData, budgetWarningEmitted: emitted },
    })),

    // ── Context ──────────────────────────────────────────────────
    contextString: null,
    setContextString: (ctx) => set({ contextString: ctx }),

    // ── Filter ──────────────────────────────────────────────────
    entryFilter: null,
    setEntryFilter: (filter) => set({ entryFilter: filter }),

    // ── UI ──────────────────────────────────────────────────────
    vimEnabled: false,
    toggleVim: () => set((state) => ({ vimEnabled: !state.vimEnabled })),
    vimMode: null,
    setVimMode: (mode) => set({ vimMode: mode }),
    activeTaskStartTime: null,
    setActiveTaskStartTime: (time) => set({ activeTaskStartTime: time }),
    theme: 'dark',
    toggleTheme: () => set((state) => ({
        theme: state.theme === 'dark' ? 'light' : 'dark',
    })),
    detailLevel: 'normal',
    cycleDetailLevel: () => set((state) => {
        const levels: Array<'minimal' | 'normal' | 'detailed'> = ['minimal', 'normal', 'detailed'];
        const idx = levels.indexOf(state.detailLevel);
        return { detailLevel: levels[(idx + 1) % levels.length] };
    }),
    showAgentActivity: true,
    toggleAgentActivity: () => set((state) => ({
        showAgentActivity: !state.showAgentActivity,
    })),
    currentTaskTitle: null,
    setCurrentTaskTitle: (title) => set({ currentTaskTitle: title }),
    showTerminal: false,
    toggleTerminal: () => set((state) => ({ showTerminal: !state.showTerminal })),
    workingDirectory: null,
    setWorkingDirectory: (dir) => set({ workingDirectory: dir }),
}));
