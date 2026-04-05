/**
 * MXF Desktop — Shared Types
 *
 * Type definitions for the desktop app. Mirrors the TUI types
 * where applicable for consistency across interfaces.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Agent information for roster display */
export interface AgentInfo {
    id: string;
    name: string;
    role: string;
    status: 'idle' | 'active' | 'error' | 'offline';
    currentTask?: string;
    color?: string;
}

/** Vim mode indicator for status bar */
export type VimMode = 'normal' | 'insert' | null;

/** Conversation message displayed in the chat area */
export interface ConversationMessage {
    id: string;
    type: 'user' | 'agent' | 'system' | 'error' | 'activity' | 'tool-result' | 'reasoning';
    content: string;
    agentName?: string;
    agentColor?: string;
    timestamp: number;
    /** For streaming responses — true while still receiving chunks */
    streaming?: boolean;
    /** Detail level at time of creation */
    detailMode?: 'minimal' | 'normal' | 'detailed';
    /** Tool call arguments (stored for detailed mode display) */
    toolArgs?: Record<string, unknown>;
    /** Activity card status — active while tool is running, completed/failed when done */
    activityStatus?: 'active' | 'completed' | 'failed';
}

/** Confirmation request from an agent */
export interface ConfirmationRequest {
    id: string;
    agentName: string;
    title: string;
    description: string;
    details?: string;
    timestamp: number;
    /** File diff data for confirmation dialogs showing file changes */
    diff?: { filePath: string; original: string; modified: string };
}

/** User input request from an agent (select, text, multi_select, confirm) */
export interface UserInputRequest {
    id: string;
    agentId: string;
    agentName: string;
    title: string;
    description?: string;
    inputType: 'text' | 'select' | 'multi_select' | 'confirm';
    inputConfig: {
        // text
        placeholder?: string;
        multiline?: boolean;
        minLength?: number;
        maxLength?: number;
        // select / multi_select
        options?: Array<{ value: string; label: string; description?: string }>;
        minSelections?: number;
        maxSelections?: number;
        // confirm
        confirmLabel?: string;
        denyLabel?: string;
    };
    urgency?: 'low' | 'normal' | 'high' | 'critical';
    theme?: 'default' | 'warning' | 'info' | 'success' | 'error';
    timestamp: number;
}

/** Selection prompt (e.g., model picker) */
export interface PendingSelection {
    kind: 'model' | 'agent' | 'custom';
    title: string;
    options: Array<{ label: string; value: string; description?: string }>;
}

/** MXF config as read from ~/.mxf/config.json */
export interface MxfConfig {
    server: {
        host: string;
        port: number;
    };
    credentials: {
        domainKey: string;
    };
    user: {
        accessToken: string;
        userId?: string;
        username?: string;
    };
    llm: {
        provider: string;
        apiKey: string;
        defaultModel?: string;
    };
    agents?: {
        enabled?: string[];
        customAgentsDir?: string;
        models?: Record<string, string>;
    };
    preferences?: {
        theme?: string;
        detailMode?: string;
    };
}

/** Connection state */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Cost data per agent */
export interface AgentCostData {
    agentId: string;
    agentName: string;
    iterations: number;
    toolCalls: number;
    messages: number;
    tasksCompleted: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastModel: string | null;
}

/** Aggregate cost tracking */
export interface CostData {
    agents: Record<string, AgentCostData>;
    totalIterations: number;
    totalToolCalls: number;
    totalMessages: number;
    totalTasks: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    startTime: number;
    /** Budget limit in USD (null = no limit) */
    costBudget: number | null;
    /** Running estimated cost in USD */
    estimatedCost: number;
    /** Whether the 80% budget warning has been emitted */
    budgetWarningEmitted: boolean;
    /** Whether the budget has been exceeded */
    budgetExceeded: boolean;
}
