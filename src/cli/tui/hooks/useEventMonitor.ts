/**
 * MXF CLI TUI — Event Monitor Hook
 *
 * Subscribes to channel events from the MxfChannelMonitor and dispatches
 * state actions for agent messages, tool calls, and task completion/failure.
 *
 * Multi-agent aware: attributes events to the correct agent using dynamic
 * agent name maps, creates activity cards for file/code operations, and
 * filters user_input tool calls from display (handled by the confirmation flow).
 *
 * Uses MxfChannelMonitor.on() which already handles deduplication via eventId.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useEffect, useRef, useCallback, type Dispatch } from 'react';
import { Events } from '../../../sdk/index';
import type { MxfChannelMonitor } from '../../../sdk/index';
import type { AppAction } from '../state';
import type { AppState } from '../state';
import { checkContextThresholds, checkBudget } from '../services/CostTracker';
import { ToolHookService } from '../services/ToolHookService';

/** Tool names that are filtered from display — handled by the confirmation flow */
const USER_INPUT_TOOLS = new Set(['user_input', 'request_user_input', 'get_user_input_response']);

/**
 * Resolve a file path to an absolute path for display.
 * If the path is already absolute or starts with ~, return as-is.
 * Otherwise, prepend the current working directory.
 *
 * @param filePath - The path from tool arguments
 * @returns Absolute path string for display
 */
function resolveDisplayPath(filePath: string): string {
    if (!filePath) return 'file';
    if (filePath.startsWith('/') || filePath.startsWith('~')) return filePath;
    return `${process.cwd()}/${filePath}`;
}

/**
 * Build a human-readable one-line description for a tool call.
 * Returns a concise summary instead of raw JSON args.
 *
 * @param toolName - The MCP tool name
 * @param args - Tool input arguments
 * @returns Human-readable description string
 */
function describeToolCall(toolName: string, args: Record<string, any>): string {
    switch (toolName) {
        // Planning tools
        case 'planning_create':
            return `Creating plan: ${args.title || 'untitled'}`;
        case 'planning_update_item':
            return `Updating plan item: ${args.itemId || '?'} → ${args.status || '?'}`;
        case 'planning_view':
            return `Viewing plan${args.planId ? `: ${args.planId.substring(0, 12)}` : ''}`;
        case 'planning_share':
            return `Sharing plan with agents`;

        // Communication tools
        case 'messaging_send':
            return `Sending message${args.targetAgentId ? ` to ${args.targetAgentId}` : ''}`;
        case 'messaging_discover':
            return 'Discovering available agents';

        // Context and memory tools
        case 'channel_context_read':
            return 'Reading channel context';
        case 'agent_context_read':
            return 'Reading agent context';
        case 'channel_memory_read':
            return 'Reading channel memory';
        case 'agent_memory_read':
            return 'Reading agent memory';

        // Meta tools
        case 'tools_recommend':
            return `Recommending tools${args.task ? ` for: ${args.task.substring(0, 60)}` : ''}`;
        case 'validate_next_action':
            return `Validating: ${args.action || args.description || 'next action'}`.substring(0, 80);
        case 'no_further_action':
            return 'No further action needed';

        // Filesystem tools — show absolute paths for clarity
        case 'read_file':
            return `Reading ${resolveDisplayPath(args.path || args.filePath || '')}`;
        case 'write_file':
            return `Writing ${resolveDisplayPath(args.path || args.filePath || '')}`;
        case 'list_directory':
            return `Listing ${resolveDisplayPath(args.path || args.directory || '')}`;

        // Code/shell tools
        case 'code_execute':
            return `Executing ${args.language || 'code'}`;
        case 'shell_execute':
            return `Running: ${(args.command || '').substring(0, 60)}`;

        // Search tools
        case 'memory_search_conversations':
        case 'memory_search_actions':
        case 'memory_search_patterns':
            return `Searching memory: ${args.query || args.term || ''}`.substring(0, 80);

        // Fallback: extract first meaningful string value from args
        default: {
            const firstValue = Object.values(args).find(v => typeof v === 'string' && v.length > 0);
            if (firstValue) {
                return `${toolName}: ${(firstValue as string).substring(0, 80)}`;
            }
            return toolName;
        }
    }
}

/** Tool names that modify files — tracked for parallel agent conflict detection */
const FILE_MODIFICATION_TOOLS = new Set([
    'write_file', 'edit_file', 'create_file', 'move_file', 'delete_file', 'replace_in_file',
]);

/**
 * Extract the target file path from tool arguments.
 * Checks common argument names in priority order: path, file_path, destination.
 *
 * @param args - Tool input arguments
 * @returns The file path string, or null if no path argument found
 */
function extractFilePath(args: Record<string, any>): string | null {
    const raw = args.path || args.file_path || args.destination;
    return typeof raw === 'string' ? raw : null;
}

/** Tool names that generate activity cards when called by specialist agents */
const ACTIVITY_CARD_TOOLS = new Set(['read_file', 'write_file', 'list_directory', 'code_execute', 'shell_execute']);

/**
 * Build a human-readable description for an activity card based on tool name and args.
 *
 * @param toolName - The MCP tool name
 * @param args - Tool input arguments
 * @returns Human-readable activity description
 */
function describeActivity(toolName: string, args: Record<string, any>): string {
    switch (toolName) {
        case 'read_file':
            return `Reading ${resolveDisplayPath(args.path || args.filePath || '')}`;
        case 'write_file':
            return `Writing ${resolveDisplayPath(args.path || args.filePath || '')}`;
        case 'list_directory':
            return `Listing ${resolveDisplayPath(args.path || args.directory || '')}`;
        case 'code_execute':
            return `Executing ${args.language || 'code'}`;
        case 'shell_execute':
            return `Running: ${(args.command || '').substring(0, 60)}`;
        default:
            return toolName;
    }
}

/**
 * Build a concise result summary from a tool execution result.
 * Formats output differently based on tool type — file reads show line count,
 * shell/code execution shows first ~200 chars of output, planning/messaging tools
 * return empty (their results are already visible via other UI elements).
 *
 * @param toolName - The MCP tool name
 * @param result - The tool result (typically an array of content blocks or a string)
 * @returns Formatted summary string, or empty string to suppress display
 */
function summarizeToolResult(toolName: string, result: any): string {
    if (!result) return '';

    // Result is typically an array of { type: 'text', text: '...' } content blocks
    const text = Array.isArray(result)
        ? result.map((r: any) => r.text || '').join('\n')
        : typeof result === 'string' ? result : JSON.stringify(result);
    if (!text) return '';

    switch (toolName) {
        case 'read_file': {
            const lineCount = text.split('\n').length;
            return `Read ${lineCount} lines`;
        }
        case 'write_file':
            return text.substring(0, 200);
        case 'list_directory':
            return text.substring(0, 200);
        case 'shell_execute':
        case 'code_execute':
            return text.length > 200 ? text.substring(0, 200) + '...' : text;
        // Planning and messaging results are already shown via other UI elements
        case 'planning_create':
        case 'planning_update_item':
        case 'planning_view':
        case 'planning_share':
        case 'messaging_send':
        case 'messaging_discover':
            return '';
        default:
            return text.length > 200 ? text.substring(0, 200) + '...' : text;
    }
}

/**
 * Callback invoked when an agent approaches its context window limit.
 * The TUI caller (App.tsx) provides this to trigger compaction via InteractiveSessionManager.
 */
export type OnContextCompactNeeded = (agentId: string, usedTokens: number, contextWindow: number) => void;

/**
 * Hook that subscribes to channel events and dispatches state updates.
 *
 * Events monitored:
 * - AGENT_MESSAGE → ADD_ENTRY (type: 'agent') with correct agent attribution
 * - TOOL_CALL → ADD_ENTRY (type: 'tool-call') or 'activity-card' for specialist agents
 * - TASK_COMPLETED → ADD_ENTRY (system success), agent status updates
 * - TASK_FAILED → ADD_ENTRY (error), agent status updates
 * - LLM_USAGE → TRACK_TOKEN_USAGE + context window threshold check
 * - CONTEXT_COMPACTED → system notice in conversation
 *
 * Filters: user_input tool calls are hidden (handled by confirmation flow),
 * task_complete tool calls are hidden (completion handler covers that).
 *
 * @param channel - The MxfChannelMonitor instance (null before connection)
 * @param dispatch - React dispatch function for state updates
 * @param agentNames - Dynamic map of agentId → display name
 * @param orchestratorId - The orchestrator agent's ID (for completion detection)
 * @param getState - Returns current AppState (for context threshold checks)
 * @param onContextCompactNeeded - Callback when an agent needs context compaction
 */
export function useEventMonitor(
    channel: MxfChannelMonitor | null,
    dispatch: Dispatch<AppAction>,
    agentNames?: Record<string, string>,
    orchestratorId?: string,
    getState?: () => AppState,
    onContextCompactNeeded?: OnContextCompactNeeded,
): void {
    const dispatchRef = useRef(dispatch);
    const agentNamesRef = useRef(agentNames || {});
    const orchestratorIdRef = useRef(orchestratorId || '');
    const getStateRef = useRef(getState);
    const onContextCompactNeededRef = useRef(onContextCompactNeeded);

    useEffect(() => {
        dispatchRef.current = dispatch;
    }, [dispatch]);

    useEffect(() => {
        agentNamesRef.current = agentNames || {};
    }, [agentNames]);

    useEffect(() => {
        orchestratorIdRef.current = orchestratorId || '';
    }, [orchestratorId]);

    useEffect(() => {
        getStateRef.current = getState;
    }, [getState]);

    useEffect(() => {
        onContextCompactNeededRef.current = onContextCompactNeeded;
    }, [onContextCompactNeeded]);

    /** Resolve an agent name from the dynamic map, falling back to the raw ID */
    function resolveName(agentId: string): string {
        return agentNamesRef.current[agentId] || agentId;
    }

    /** Check if an agent is the orchestrator */
    function isOrchestrator(agentId: string): boolean {
        return agentId === orchestratorIdRef.current;
    }

    useEffect(() => {
        if (!channel) return;

        // Track processed message IDs for additional deduplication
        const processedIds = new Set<string>();

        // Listen for agent messages — attribute to correct agent
        const agentMessageHandler = (payload: any) => {
            try {
                // Deduplicate messages using messageId
                const messageId = payload.data?.metadata?.messageId ||
                    `${payload.agentId}-${payload.timestamp || Date.now()}`;
                if (processedIds.has(messageId)) return;
                processedIds.add(messageId);
                setTimeout(() => processedIds.delete(messageId), 5000);

                // Extract message content (handle different payload shapes)
                let content = payload.data?.content || payload.data?.message || '';
                if (typeof content === 'object') {
                    content = content.data || content.content || JSON.stringify(content);
                }

                if (content && content.length > 0) {
                    const agentId = payload.agentId || orchestratorIdRef.current;
                    // Extract target agent for inter-agent messages (messaging_send)
                    const receiverId = payload.data?.receiverId || payload.data?.metadata?.receiverId || '';
                    // Clear stream preview — the full response has arrived
                    dispatchRef.current({ type: 'CLEAR_STREAM_PREVIEW' });
                    // Compound dispatch: add entry + set agent active + track iteration (1 render instead of 3)
                    dispatchRef.current({
                        type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                        entry: {
                            type: 'agent',
                            agentId,
                            agentName: resolveName(agentId),
                            content,
                            // Include target agent info for inter-agent message attribution
                            ...(receiverId ? { targetAgentId: receiverId, targetAgentName: resolveName(receiverId) } : {}),
                        },
                        agentId,
                        agentStatus: 'active',
                        iteration: { iterationType: 'message' },
                    });
                }
            } catch {
                // Don't crash on message processing errors
            }
        };

        // Listen for tool calls — create activity cards for specialist agent operations.
        // Runs pre-hooks from ~/.mxf/hooks/ before dispatching tool-call entries.
        const toolCallHandler = (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};
            const agentId = payload.agentId || orchestratorIdRef.current;

            // Don't show task_complete tool calls — the completion handler covers that
            if (toolName === 'task_complete') {
                // Still track iteration for cost tracking
                dispatchRef.current({ type: 'TRACK_ITERATION', agentId, iterationType: 'tool-call' });
                return;
            }

            // Don't show user_input tool calls — the confirmation flow handles these
            if (USER_INPUT_TOOLS.has(toolName)) return;

            // Parallel agent file conflict detection — warn when two agents target the same file
            if (FILE_MODIFICATION_TOOLS.has(toolName)) {
                const filePath = extractFilePath(args);
                if (filePath) {
                    const resolvedPath = resolveDisplayPath(filePath);
                    const currentAgentName = resolveName(agentId);

                    // Check for an existing operation on this path from a different agent
                    const existingOp = getStateRef.current?.()?.activeFileOps?.get(resolvedPath);
                    if (existingOp && existingOp.agentId !== agentId) {
                        dispatchRef.current({
                            type: 'ADD_ENTRY',
                            entry: {
                                type: 'system',
                                content: `⚠ File conflict: ${existingOp.agentName} and ${currentAgentName} are both modifying ${resolvedPath}`,
                            },
                        });
                    }

                    // Track this file operation so future overlapping ops are detected
                    dispatchRef.current({
                        type: 'TRACK_FILE_OP',
                        filePath: resolvedPath,
                        agentId,
                        agentName: currentAgentName,
                        toolName,
                    });
                }
            }

            // Run pre-hooks asynchronously, then dispatch the tool-call entry
            const hookService = ToolHookService.getInstance();
            hookService.runPreHooks(toolName, args).then((hookResult) => {
                // If a pre-hook blocked this tool call, show a system notice and skip display
                if (hookResult.blocked) {
                    dispatchRef.current({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'system',
                            content: `Hook blocked ${toolName}: ${hookResult.reason || 'blocked by pre-hook'}`,
                        },
                    });
                    return;
                }

                // For non-orchestrator agents calling file/code tools, show activity cards
                // Compound dispatch: add activity-card entry + track iteration (1 render instead of 2)
                if (!isOrchestrator(agentId) && ACTIVITY_CARD_TOOLS.has(toolName)) {
                    dispatchRef.current({
                        type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                        entry: {
                            type: 'activity-card',
                            agentId,
                            agentName: resolveName(agentId),
                            content: describeActivity(toolName, args),
                            toolName,
                            toolArgs: args,
                            activityStatus: 'active',
                        },
                        agentId,
                        agentStatus: 'active',
                        iteration: { iterationType: 'tool-call' },
                    });
                    return;
                }

                // For planning_create, expand the plan items inline so the user sees the content
                // Compound dispatch: add agent entry + track iteration (1 render instead of 2)
                if (toolName === 'planning_create' && args.items && Array.isArray(args.items)) {
                    const title = args.title || 'Plan';
                    const items = args.items
                        .map((item: any, i: number) => `  ${i + 1}. ${item.title || item.name || 'Item'}`)
                        .join('\n');
                    const content = `Created plan: ${title}\n${items}`;

                    dispatchRef.current({
                        type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                        entry: {
                            type: 'agent',
                            agentId,
                            agentName: resolveName(agentId),
                            content,
                        },
                        agentId,
                        agentStatus: 'active',
                        iteration: { iterationType: 'tool-call' },
                    });
                    return;
                }

                // For all other tool calls, show as regular tool-call entries
                // with human-readable descriptions instead of raw JSON
                // Compound dispatch: add tool-call entry + track iteration (1 render instead of 2)
                dispatchRef.current({
                    type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                    entry: {
                        type: 'tool-call',
                        agentId,
                        agentName: resolveName(agentId),
                        content: describeToolCall(toolName, args),
                        toolName,
                        toolArgs: args,
                        collapsed: true,
                    },
                    agentId,
                    agentStatus: 'active',
                    iteration: { iterationType: 'tool-call' },
                });
            }).catch(() => {
                // If hook execution itself fails, proceed with normal tool-call display
                dispatchRef.current({
                    type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                    entry: {
                        type: 'tool-call',
                        agentId,
                        agentName: resolveName(agentId),
                        content: describeToolCall(toolName, args),
                        toolName,
                        toolArgs: args,
                        collapsed: true,
                    },
                    agentId,
                    agentStatus: 'active',
                    iteration: { iterationType: 'tool-call' },
                });
            });
        };

        // Listen for task completion — handle per-agent and overall completion
        let taskResolved = false;
        const taskCompletedHandler = (payload: any) => {
            if (taskResolved) return;

            const result = payload.data?.task?.result;
            const summary = result?.summary || payload.data?.summary || '';
            const completingAgentId = payload.data?.task?.completedBy ||
                payload.data?.agentId || payload.agentId;

            // Determine if this is an orchestrator completion (overall task done)
            // or a specialist completion (subtask done, main task continues)
            const isOrchestratorCompletion = !completingAgentId ||
                isOrchestrator(completingAgentId);

            // Track task completion for cost tracking (standalone — no entry to combine with)
            if (completingAgentId) {
                dispatchRef.current({ type: 'TRACK_ITERATION', agentId: completingAgentId, iterationType: 'task-complete' });
            }

            if (isOrchestratorCompletion) {
                // Overall task complete — orchestrator finished
                taskResolved = true;

                // Extract original task title from the completion payload
                const taskTitle = payload.data?.task?.title || '';

                // Brief delay for any final messages to arrive, then single compound dispatch
                setTimeout(() => {
                    // Build result content with original prompt context
                    let resultContent = summary || '';
                    if (taskTitle) {
                        resultContent = `Prompt: ${taskTitle}\n\n${resultContent}`;
                    }

                    dispatchRef.current({
                        type: 'TASK_RESOLVED',
                        resultEntry: resultContent ? { type: 'result', content: resultContent } : undefined,
                        agentIds: Object.keys(agentNamesRef.current),
                        clearTaskId: true,
                    });

                    // Reset for next task
                    taskResolved = false;
                }, 500);
            } else {
                // Specialist agent finished a subtask — compound: add entry + set agent idle
                if (summary) {
                    dispatchRef.current({
                        type: 'ADD_ENTRY_WITH_AGENT_STATUS',
                        entry: {
                            type: 'system',
                            content: `${resolveName(completingAgentId)} completed: ${summary}`,
                        },
                        agentId: completingAgentId,
                        agentStatus: 'idle',
                    });
                } else {
                    dispatchRef.current({
                        type: 'SET_AGENT_STATUS',
                        agentId: completingAgentId,
                        status: 'idle',
                    });
                }
            }
        };

        // Listen for task failure — single compound dispatch instead of N+3 individual dispatches
        const taskFailedHandler = (payload: any) => {
            if (taskResolved) return;
            taskResolved = true;

            const error = payload.data?.error || 'Task failed';
            const failedAgentId = payload.data?.agentId || payload.agentId;
            const agentName = failedAgentId ? resolveName(failedAgentId) : 'Agent';

            setTimeout(() => {
                dispatchRef.current({
                    type: 'TASK_RESOLVED',
                    resultEntry: {
                        type: 'error',
                        content: `${agentName} failed: ${error}`,
                    },
                    agentIds: Object.keys(agentNamesRef.current),
                    clearTaskId: true,
                });

                // Reset for next task
                taskResolved = false;
            }, 500);
        };

        // Listen for LLM token usage — dispatches token tracking for cost estimates
        // and checks if any agent is approaching its context window limit
        const llmUsageHandler = (payload: any) => {
            const agentId = payload.agentId;
            const data = payload.data;
            if (!agentId || !data) return;

            dispatchRef.current({
                type: 'TRACK_TOKEN_USAGE',
                agentId,
                inputTokens: data.inputTokens || 0,
                outputTokens: data.outputTokens || 0,
                totalTokens: data.totalTokens || 0,
                model: data.model,
            });

            // Check context window thresholds and budget after token update.
            // Use setTimeout(0) so the reducer has processed the token update first.
            setTimeout(() => {
                const state = getStateRef.current?.();
                if (!state) return;

                // Context window compaction check
                const overThreshold = checkContextThresholds(state.costData);
                for (const agent of overThreshold) {
                    // Only fire once per agent per session
                    if (state.compactedAgents.has(agent.agentId)) continue;

                    dispatchRef.current({ type: 'MARK_AGENT_COMPACTED', agentId: agent.agentId });
                    dispatchRef.current({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'system',
                            content: `Context window ${Math.round(agent.usageRatio * 100)}% full for ${resolveName(agent.agentId)} — triggering compaction`,
                        },
                    });

                    // Notify the session manager to compact this agent's conversation history
                    onContextCompactNeededRef.current?.(agent.agentId, agent.usedTokens, agent.contextWindow);
                }

                // Budget threshold check — warn at 80%, alert at 100%
                const budgetResult = checkBudget(state.costData);
                if (budgetResult.warning) {
                    dispatchRef.current({ type: 'MARK_BUDGET_WARNING_EMITTED' });
                    dispatchRef.current({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'system',
                            content: `⚠ Budget warning: estimated cost ~$${budgetResult.estimatedCost.toFixed(4)} has reached 80% of $${budgetResult.budget!.toFixed(2)} budget`,
                        },
                    });
                }
                if (budgetResult.exceeded && !state.costData.budgetExceeded) {
                    dispatchRef.current({ type: 'MARK_BUDGET_EXCEEDED' });
                    dispatchRef.current({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'system',
                            content: `Budget exceeded: estimated cost ~$${budgetResult.estimatedCost.toFixed(4)} has reached the $${budgetResult.budget!.toFixed(2)} budget limit. Use /budget clear to remove the limit or /budget <amount> to increase it.`,
                        },
                    });
                }
            }, 0);
        };

        // Listen for context compaction completion — show system notice
        const contextCompactedHandler = (payload: any) => {
            const agentId = payload.agentId || payload.data?.agentId;
            const original = payload.data?.originalMessages || 0;
            const compacted = payload.data?.compactedMessages || 0;
            if (!agentId) return;

            dispatchRef.current({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: `Context compacted for ${resolveName(agentId)}: ${original} → ${compacted} messages`,
                },
            });
        };

        // Listen for LLM stream chunks — update live preview in ThinkingIndicator
        const llmStreamChunkHandler = (payload: any) => {
            const chunk = payload.data?.chunk || '';
            const agentId = payload.agentId || '';
            if (!chunk || !agentId) return;

            dispatchRef.current({
                type: 'UPDATE_STREAM_PREVIEW',
                agentId,
                chunk,
            });
        };

        // Listen for LLM reasoning — stream agent thinking to conversation
        const llmReasoningHandler = (payload: any) => {
            const reasoning = payload.data?.reasoning || '';
            const agentId = payload.agentId || '';
            if (!reasoning) return;

            dispatchRef.current({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'reasoning',
                    agentId,
                    agentName: resolveName(agentId),
                    content: reasoning,
                    collapsed: true,
                },
            });
        };

        // Listen for tool results — show output from tool executions.
        // Runs post-hooks from ~/.mxf/hooks/ after dispatching the result entry.
        const toolResultHandler = (payload: any) => {
            const toolName = payload.data?.toolName || '';
            const result = payload.data?.result;
            const agentId = payload.agentId || '';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Skip results from user_input tools (handled by confirmation flow)
            if (USER_INPUT_TOOLS.has(toolName)) return;
            // Skip task_complete results (handled by completion handler)
            if (toolName === 'task_complete') return;

            // Clear tracked file operation now that the tool execution is complete
            if (FILE_MODIFICATION_TOOLS.has(toolName)) {
                const filePath = extractFilePath(payload.data?.arguments || payload.data?.args || {});
                if (filePath) {
                    dispatchRef.current({
                        type: 'CLEAR_FILE_OP',
                        filePath: resolveDisplayPath(filePath),
                    });
                }
            }

            // Build a concise result summary based on tool type
            const summary = summarizeToolResult(toolName, result);

            // Complete matching activity card if one exists
            if (ACTIVITY_CARD_TOOLS.has(toolName)) {
                dispatchRef.current({
                    type: 'COMPLETE_ACTIVITY_CARD',
                    agentId,
                    toolName,
                    summary: summary || 'Done',
                });
            }

            // Only add a tool-result entry if there's a meaningful summary
            if (summary) {
                dispatchRef.current({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'tool-result',
                        agentId,
                        agentName: resolveName(agentId),
                        content: summary,
                        toolName,
                    },
                });
            }

            // Fire-and-forget: run post-hooks after dispatching the result
            const hookService = ToolHookService.getInstance();
            hookService.runPostHooks(toolName, args, summary).catch(() => {
                // Post-hooks are fire-and-forget — errors already logged by the service
            });
        };

        // Task lifecycle handlers — show task creation, assignment, and dependency events
        // as system notices so the user can track orchestration activity
        const taskCreatedHandler = (payload: any) => {
            try {
                const task = payload.data?.task;
                if (!task) return;
                const agentId = task.assignedTo || payload.agentId || '';
                const agentName = agentId ? resolveName(agentId) : '';
                const assignee = agentName ? ` → ${agentName}` : '';
                dispatchRef.current({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'system',
                        content: `Task created: ${task.title || task.id}${assignee}`,
                    },
                });
            } catch { /* ignore malformed payloads */ }
        };

        const taskAssignedHandler = (payload: any) => {
            try {
                const task = payload.data?.task;
                if (!task) return;
                const agentId = task.assignedTo || '';
                const agentName = agentId ? resolveName(agentId) : 'unknown';
                dispatchRef.current({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'system',
                        content: `Task assigned: ${task.title || task.id} → ${agentName}`,
                    },
                });
            } catch { /* ignore malformed payloads */ }
        };

        const taskDependencyResolvedHandler = (payload: any) => {
            try {
                const task = payload.data?.task;
                const resolved = payload.data?.resolvedDependency;
                if (!task) return;
                dispatchRef.current({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'system',
                        content: `Dependency resolved for ${task.title || task.id}: ${resolved || 'dependency cleared'}`,
                    },
                });
            } catch { /* ignore malformed payloads */ }
        };

        const taskBlockingClearedHandler = (payload: any) => {
            try {
                const task = payload.data?.task;
                const cleared = payload.data?.clearedBlocker;
                if (!task) return;
                dispatchRef.current({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'system',
                        content: `Blocker cleared for ${task.title || task.id}: ${cleared || 'unblocked'}`,
                    },
                });
            } catch { /* ignore malformed payloads */ }
        };

        // Subscribe to events
        channel.on(Events.Message.AGENT_MESSAGE, agentMessageHandler);
        channel.on(Events.Mcp.TOOL_CALL, toolCallHandler);
        channel.on(Events.Task.COMPLETED, taskCompletedHandler);
        channel.on(Events.Task.FAILED, taskFailedHandler);
        channel.on(Events.Agent.LLM_USAGE, llmUsageHandler);
        channel.on(Events.Agent.LLM_STREAM_CHUNK, llmStreamChunkHandler);
        channel.on(Events.Agent.LLM_REASONING, llmReasoningHandler);
        channel.on(Events.Mcp.TOOL_RESULT, toolResultHandler);
        channel.on(Events.Agent.CONTEXT_COMPACTED, contextCompactedHandler);
        channel.on(Events.Task.CREATED, taskCreatedHandler);
        channel.on(Events.Task.ASSIGNED, taskAssignedHandler);
        channel.on(Events.Task.DEPENDENCY_RESOLVED, taskDependencyResolvedHandler);
        channel.on(Events.Task.BLOCKING_CLEARED, taskBlockingClearedHandler);

        // Cleanup on unmount
        return () => {
            channel.off(Events.Message.AGENT_MESSAGE);
            channel.off(Events.Mcp.TOOL_CALL);
            channel.off(Events.Task.COMPLETED);
            channel.off(Events.Task.FAILED);
            channel.off(Events.Agent.LLM_USAGE);
            channel.off(Events.Agent.LLM_STREAM_CHUNK);
            channel.off(Events.Agent.LLM_REASONING);
            channel.off(Events.Mcp.TOOL_RESULT);
            channel.off(Events.Agent.CONTEXT_COMPACTED);
            channel.off(Events.Task.CREATED);
            channel.off(Events.Task.ASSIGNED);
            channel.off(Events.Task.DEPENDENCY_RESOLVED);
            channel.off(Events.Task.BLOCKING_CLEARED);
        };
    }, [channel]);
}
