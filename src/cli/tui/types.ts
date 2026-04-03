/**
 * MXF CLI TUI — Shared Types
 *
 * Type definitions used across all TUI components, hooks, and services.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import type { AgentDefinition } from './agents/AgentDefinitions';

/** A single entry in the conversation area */
export interface ConversationEntry {
    /** Unique identifier for this entry */
    id: string;
    /** Type of entry determines rendering style */
    type: 'user' | 'agent' | 'tool-call' | 'tool-result' | 'system' | 'error' | 'result' | 'activity-card' | 'confirmation-prompt' | 'confirmation-response' | 'reasoning' | 'task-complete-banner';
    /** Agent ID that produced this entry (for agent/tool-call types) */
    agentId?: string;
    /** Display name of the agent */
    agentName?: string;
    /** Target agent ID (for inter-agent messages sent via messaging_send) */
    targetAgentId?: string;
    /** Target agent display name */
    targetAgentName?: string;
    /** Text content of the entry */
    content: string;
    /** When this entry was created */
    timestamp: number;
    /** Tool name (for tool-call entries) */
    toolName?: string;
    /** Tool input arguments (for tool-call entries) */
    toolArgs?: Record<string, any>;
    /** Whether a collapsible block is collapsed (for tool-call entries) */
    collapsed?: boolean;
    /** Activity card status — active shows bordered card, completed/failed show collapsed line */
    activityStatus?: 'active' | 'completed' | 'failed';
    /** Collapsed summary text for completed/failed activity cards */
    activitySummary?: string;
    /** Confirmation prompt data (for confirmation-prompt entries) */
    confirmationData?: ConfirmationData;
    /** Whether the confirmation was accepted (for confirmation-response entries) */
    confirmationAccepted?: boolean;
    /** File diffs attached to this entry (for DiffView rendering) */
    fileDiffs?: Array<{ filePath: string; original: string; modified: string }>;
}

/** Data for a confirmation prompt entry — shown when an agent needs user approval */
export interface ConfirmationData {
    /** Agent ID requesting confirmation */
    agentId: string;
    /** Agent display name */
    agentName: string;
    /** Type of action requiring confirmation */
    actionType: 'file-modify' | 'code-execute';
    /** Short title describing the action (e.g., "Write src/index.ts") */
    title: string;
    /** Longer description with details (e.g., file path, command) */
    description?: string;
    /** Unique request ID — links to the pending user_input Promise */
    requestId: string;
    /** File diffs for the confirmation action (rendered inline) */
    fileDiffs?: Array<{ filePath: string; original: string; modified: string }>;
}

/** Information about an active agent in the session */
export interface AgentInfo {
    /** Agent identifier */
    id: string;
    /** Display name (e.g., "Planner") */
    name: string;
    /** Current agent status */
    status: 'active' | 'idle' | 'error';
    /** TUI display color (chalk color name) */
    color: string;
    /** Description of what the agent is currently doing (shown in activity cards) */
    currentActivity?: string;
}

/** SDK connection status */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Items rendered via Ink's `<Static>` component — written once to stdout
 * and never re-rendered. Older entries live in terminal scrollback.
 */
export type StaticItem =
    | { kind: 'header'; id: string }
    | { kind: 'welcome'; id: string }
    | { kind: 'entry'; id: string; entry: ConversationEntry; detailMode: boolean };

/** Configuration passed to the TUI App component */
export interface TuiConfig {
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
    /** Default model identifier */
    defaultModel: string;
    /** Named session for multi-terminal sharing (uses name as channel ID) */
    sessionName?: string;
    /** User preferences for TUI behavior and appearance */
    preferences?: {
        theme?: string;
        showAgentActivity?: boolean;
        confirmBeforeExecute?: boolean;
        detailModeDefault?: boolean;
    };
    /** Agent definitions to create for this session (loaded from .md files) */
    agentDefinitions: AgentDefinition[];
    /** Per-agent model overrides from config (agentId → model ID) */
    agentModels?: Record<string, string>;
    /** Working directory for file operations (resolved absolute path) */
    workingDirectory: string;
}
