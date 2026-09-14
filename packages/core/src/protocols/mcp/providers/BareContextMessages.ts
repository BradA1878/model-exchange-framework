import type { AgentContext } from '../../../interfaces/AgentContext.js';
import type { McpTool } from '../IMcpClient.js';

/** Preserve registry descriptions and every schema constraint in native chat tools. */
export function buildBareChatTools(tools: McpTool[]): Array<{
    type: 'function'; function: { name: string; description: string; parameters: McpTool['input_schema'] }
}> {
    return tools.map(tool => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema }
    }));
}

/** Native chat fields retained when the operator supplies the entire prompt. */
export interface BareChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

/** Keep dialogue and tool pairing without synthesizing task, identity or action text. */
export function buildBareContextMessages(context: AgentContext): BareChatMessage[] {
    const messages: BareChatMessage[] = [{ role: 'system', content: context.systemPrompt }];
    for (const message of context.conversationHistory) {
        if (message.role === 'system') continue;
        const role = message.role === 'assistant' ? 'assistant' : message.role === 'tool' ? 'tool' : 'user';
        let content = message.content;
        if (role === 'user' && message.metadata?.fromAgentId) {
            const prefix = `[${message.metadata.fromAgentId}]: `;
            if (!content.startsWith(prefix)) content = prefix + content;
        }
        messages.push({
            role,
            content,
            ...(role === 'assistant' && message.tool_calls ? { tool_calls: message.tool_calls } : {}),
            ...(role === 'tool' && message.metadata?.tool_call_id ? { tool_call_id: message.metadata.tool_call_id } : {})
        });
    }
    // A message can arrive while tools run. Move only matching native results
    // beside their assistant call so providers accept the dialogue unchanged.
    const results = new Map<string, BareChatMessage>();
    for (const message of messages) {
        if (message.role !== 'tool') continue;
        if (!message.tool_call_id) throw new Error('Bare tool results require a tool call ID');
        if (results.has(message.tool_call_id)) throw new Error(`Duplicate tool result: ${message.tool_call_id}`);
        results.set(message.tool_call_id, message);
    }
    const paired: BareChatMessage[] = [];
    const callIds = new Set<string>();
    for (const message of messages) {
        if (message.role === 'tool') continue;
        paired.push(message);
        for (const call of message.tool_calls ?? []) {
            if (!call.id || callIds.has(call.id)) throw new Error(`Invalid or duplicate tool call ID: ${call.id}`);
            callIds.add(call.id);
            parseNativeToolArguments(call.function.arguments);
            const result = results.get(call.id);
            if (!result) throw new Error(`Missing tool result: ${call.id}`);
            paired.push(result);
            results.delete(call.id);
        }
    }
    if (results.size) throw new Error(`Tool result has no matching assistant call: ${results.keys().next().value}`);
    return paired;
}

/** Native function calls must contain an object, never a fabricated empty replacement. */
export function parseNativeToolArguments(value: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`Invalid tool call arguments ${JSON.stringify(value)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validateNativeToolInput(parsed);
}

/** Native object inputs must be supplied by the provider, including valid empty objects. */
export function validateNativeToolInput(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Tool call arguments must be a JSON object; received ${JSON.stringify(value)}`);
    }
    return value as Record<string, unknown>;
}
