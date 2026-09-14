/** Controls prompt construction, turn admission, and optional execution observation. */
export type AgentPromptMode = 'framework' | 'bare';
export type AgentActivationMode = 'task' | 'message';

/** Shared subset accepted by public SDK creation and direct agent construction. */
export interface AgentExecutionConfig {
    promptMode?: AgentPromptMode;
    activation?: AgentActivationMode;
    circuitBreakerEnabled?: boolean;
    captureLlmRequests?: boolean;
    agentConfigPrompt?: string;
    mxpEnabled?: boolean;
    useMessageAggregate?: boolean;
    maxIterations?: number;
}

/** Validate opt-in execution controls without changing caller values or prompt bytes. */
export function validateAgentExecutionConfig(config: AgentExecutionConfig): void {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Agent execution configuration must be an object');
    }
    if (config.promptMode !== undefined && config.promptMode !== 'framework' && config.promptMode !== 'bare') {
        throw new Error('promptMode must be framework or bare');
    }
    if (config.activation !== undefined && config.activation !== 'task' && config.activation !== 'message') {
        throw new Error('activation must be task or message');
    }
    for (const field of ['circuitBreakerEnabled', 'captureLlmRequests', 'mxpEnabled', 'useMessageAggregate'] as const) {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
            throw new Error(`${field} must be a boolean`);
        }
    }
    if (config.promptMode === 'bare') {
        if (typeof config.agentConfigPrompt !== 'string' || !config.agentConfigPrompt.trim()) {
            throw new Error('Bare prompt mode requires a non-empty agentConfigPrompt');
        }
        if (config.mxpEnabled === true) {
            throw new Error('Bare prompt mode cannot enable MXP');
        }
        if (config.useMessageAggregate === true) {
            throw new Error('Bare prompt mode cannot enable message aggregation');
        }
    }
    if (config.activation === 'message') {
        if (config.useMessageAggregate === true) {
            throw new Error('Message activation cannot enable message aggregation');
        }
        if (config.maxIterations !== undefined && (!Number.isInteger(config.maxIterations) || config.maxIterations <= 0)) {
            throw new Error('Message activation maxIterations must be a positive integer');
        }
    }
}
