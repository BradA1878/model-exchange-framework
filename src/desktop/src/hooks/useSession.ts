/**
 * MXF Desktop — Session Lifecycle Hook
 *
 * Manages the MXF session via the Bun sidecar process. The sidecar
 * runs InteractiveSessionManager (the same code as the TUI) and
 * communicates with the webview via JSON-RPC over stdin/stdout.
 *
 * On mount:
 *   1. Reads config to find the MXF project root
 *   2. Spawns the Bun sidecar process
 *   3. Sidecar connects to the MXF server (creates channel + agents)
 *   4. Events from the sidecar update Zustand state
 *
 * On unmount:
 *   - Sends disconnect command and stops the sidecar process
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SidecarBridge } from '../services/SidecarBridge';
import { useAppState, generateMessageId } from '../state/appState';
import { saveSession } from '../services/SessionHistory';
import { describeToolCall } from '../services/toolDescriptions';
import type { SessionRecord } from '../services/SessionHistory';

/**
 * Hook that manages the full session lifecycle via the sidecar bridge.
 *
 * @returns submitTask and submitTaskToAgent callbacks
 */
export function useSession() {
    const bridgeRef = useRef<SidecarBridge | null>(null);

    const setConnection = useAppState((s) => s.setConnection);
    const setSessionId = useAppState((s) => s.setSessionId);
    const addMessage = useAppState((s) => s.addMessage);
    const setAgents = useAppState((s) => s.setAgents);
    const setAgentWorking = useAppState((s) => s.setAgentWorking);
    const updateAgent = useAppState((s) => s.updateAgent);
    const updateCost = useAppState((s) => s.updateCost);
    const incrementIterations = useAppState((s) => s.incrementIterations);
    const setStreamPreview = useAppState((s) => s.setStreamPreview);
    const updateMessage = useAppState((s) => s.updateMessage);
    const pushConfirmation = useAppState((s) => s.pushConfirmation);
    const setActiveTaskStartTime = useAppState((s) => s.setActiveTaskStartTime);

    // Build a SessionRecord from current Zustand state for persistence
    const buildSessionRecord = useCallback((): SessionRecord | null => {
        const state = useAppState.getState();
        if (!state.sessionId || state.messages.length === 0) return null;

        const userAndAgentMessages = state.messages.filter(
            m => m.type === 'user' || m.type === 'agent',
        );
        if (userAndAgentMessages.length === 0) return null;

        return {
            sessionId: state.sessionId,
            startTime: state.costData.startTime,
            endTime: Date.now(),
            model: Object.values(state.costData.agents)[0]?.lastModel || 'unknown',
            messages: state.messages,
            costData: state.costData,
            messageCount: state.messages.length,
        };
    }, []);

    // Initialize sidecar on mount
    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            setConnection('connecting');

            try {
                // Get the MXF project root — the sidecar runs from there
                const projectRoot = await invoke<string>('get_project_root');

                if (cancelled) return;

                // Create the sidecar bridge
                const bridge = new SidecarBridge(projectRoot);
                bridgeRef.current = bridge;

                // ── Wire up event listeners ──────────────────────

                // Stream accumulation state — tracks in-progress LLM streaming
                let streamBuffer = '';
                let streamMessageId: string | null = null;

                // Track the most recent tool:call message for activity card updates
                let lastToolCallMessageId: string | null = null;

                // Status changes (connecting, connected, disconnected)
                bridge.on('status', (data) => {
                    const state = data.state as string;
                    if (state === 'connected') {
                        setConnection('connected');
                        setSessionId(crypto.randomUUID().slice(0, 8));

                        // Initialize agent roster
                        const agents = (data.agents || []) as Array<{
                            id: string; name: string; role: string; color?: string;
                        }>;
                        setAgents(agents.map(a => ({
                            id: a.id,
                            name: a.name,
                            role: a.role,
                            status: 'idle' as const,
                            color: a.color,
                        })));

                        const model = (data.defaultModel || 'unknown') as string;
                        const agentNames = agents.map(a => a.name).join(', ');
                        addMessage({
                            id: generateMessageId(),
                            type: 'system',
                            content: `Connected. ${agentNames} agents ready.\nModel: ${model}`,
                            timestamp: Date.now(),
                        });
                    } else if (state === 'connecting') {
                        setConnection('connecting');
                    } else if (state === 'disconnected') {
                        setConnection('disconnected');
                    }
                });

                // Error messages
                bridge.on('error', (data) => {
                    addMessage({
                        id: generateMessageId(),
                        type: 'error',
                        content: (data.message || 'Unknown error') as string,
                        timestamp: Date.now(),
                    });
                });

                // Agent messages (markdown content)
                bridge.on('agent:message', (data) => {
                    const content = (data.content || '') as string;
                    const agentName = (data.agentName || '') as string;

                    if (streamMessageId) {
                        // Finalize the streaming message with the final content
                        updateMessage(streamMessageId, {
                            content,
                            streaming: false,
                        });
                        streamBuffer = '';
                        streamMessageId = null;
                    } else {
                        // No streaming in progress — add as a new message
                        addMessage({
                            id: generateMessageId(),
                            type: 'agent',
                            content,
                            agentName,
                            timestamp: Date.now(),
                        });
                    }

                    setStreamPreview(null);
                    if (data.agentId) {
                        updateAgent(data.agentId as string, { status: 'active' });
                    }
                    incrementIterations();
                });

                // Tool calls (activity display)
                bridge.on('tool:call', (data) => {
                    const toolName = (data.toolName || '') as string;
                    const args = (data.args || {}) as Record<string, unknown>;
                    const desc = describeToolCall(toolName, args);

                    // Track the message ID so tool:result can update it
                    const activityId = generateMessageId();
                    lastToolCallMessageId = activityId;

                    addMessage({
                        id: activityId,
                        type: 'activity',
                        content: desc,
                        agentName: (data.agentName || '') as string,
                        timestamp: Date.now(),
                        activityStatus: 'active',
                        toolArgs: args,
                    });
                    if (data.agentId) {
                        updateAgent(data.agentId as string, { status: 'active' });
                    }
                    incrementIterations();
                });

                // Tool results — update the activity card status.
                // Don't show raw JSON tool results as conversation messages;
                // the activity card already indicates what happened.
                // Only show results that contain meaningful text output
                // (e.g., file contents, search results, shell output).
                bridge.on('tool:result', (data) => {
                    // Mark the corresponding activity card as completed
                    if (lastToolCallMessageId) {
                        updateMessage(lastToolCallMessageId, { activityStatus: 'completed' });
                        lastToolCallMessageId = null;
                    }

                    // Skip rendering tool results as messages — the activity card
                    // already shows what happened. Agent messages convey the actual
                    // content the user needs to see.
                });

                // LLM reasoning (thinking/chain-of-thought)
                bridge.on('llm:reasoning', (data) => {
                    const reasoning = (data.reasoning || '') as string;
                    if (reasoning) {
                        addMessage({
                            id: generateMessageId(),
                            type: 'reasoning',
                            content: reasoning,
                            agentName: (data.agentName || '') as string,
                            timestamp: Date.now(),
                        });
                    }
                });

                // Task completed
                bridge.on('task:completed', (data) => {
                    // Finalize any in-progress streaming message
                    if (streamMessageId) {
                        updateMessage(streamMessageId, { streaming: false });
                        streamBuffer = '';
                        streamMessageId = null;
                    }

                    const summary = (data.summary || '') as string;

                    setTimeout(() => {
                        if (summary) {
                            addMessage({
                                id: generateMessageId(),
                                type: 'agent',
                                content: summary,
                                agentName: 'Result',
                                timestamp: Date.now(),
                            });
                        }
                        addMessage({
                            id: generateMessageId(),
                            type: 'system',
                            content: 'Task Complete',
                            timestamp: Date.now(),
                        });
                        setAgentWorking(false);
                        setActiveTaskStartTime(null);
                        useAppState.getState().setProgressStatus(null);
                    }, 500);
                });

                // Task failed
                bridge.on('task:failed', (data) => {
                    // Finalize any in-progress streaming message
                    if (streamMessageId) {
                        updateMessage(streamMessageId, { streaming: false });
                        streamBuffer = '';
                        streamMessageId = null;
                    }

                    // Mark any active activity cards as failed
                    if (lastToolCallMessageId) {
                        updateMessage(lastToolCallMessageId, { activityStatus: 'failed' });
                        lastToolCallMessageId = null;
                    }

                    addMessage({
                        id: generateMessageId(),
                        type: 'error',
                        content: (data.error || 'Task failed') as string,
                        timestamp: Date.now(),
                    });
                    setAgentWorking(false);
                    setActiveTaskStartTime(null);
                    useAppState.getState().setProgressStatus(null);
                });

                // LLM usage (cost tracking)
                bridge.on('llm:usage', (data) => {
                    updateCost(
                        (data.agentId || '') as string,
                        (data.agentName || data.agentId || '') as string,
                        (data.inputTokens || 0) as number,
                        (data.outputTokens || 0) as number,
                        (data.model || '') as string,
                    );
                });

                // LLM stream chunks — accumulate into a live-updating preview
                bridge.on('llm:stream', (data) => {
                    const chunk = (data.chunk || '') as string;
                    if (!chunk) return;

                    streamBuffer += chunk;

                    if (!streamMessageId) {
                        // Create a new streaming message
                        streamMessageId = generateMessageId();
                        addMessage({
                            id: streamMessageId,
                            type: 'agent',
                            content: streamBuffer,
                            agentName: (data.agentName || '') as string,
                            timestamp: Date.now(),
                            streaming: true,
                        });
                    } else {
                        // Update the existing streaming message
                        updateMessage(streamMessageId, { content: streamBuffer });
                    }
                });

                // Confirmation requests (legacy — kept for backward compat)
                bridge.on('confirmation:request', (data) => {
                    pushConfirmation({
                        id: (data.requestId || generateMessageId()) as string,
                        agentName: (data.agentName || '') as string,
                        title: (data.title || 'Approval needed') as string,
                        description: (data.description || '') as string,
                        timestamp: Date.now(),
                    });
                });

                // User input requests (all types: confirm, text, select, multi_select)
                bridge.on('user_input:request', (data) => {
                    const { pushUserInput } = useAppState.getState();
                    pushUserInput({
                        id: (data.requestId || generateMessageId()) as string,
                        agentId: (data.agentId || '') as string,
                        agentName: (data.agentName || '') as string,
                        title: (data.title || 'Input needed') as string,
                        description: (data.description || '') as string,
                        inputType: (data.inputType || 'confirm') as 'text' | 'select' | 'multi_select' | 'confirm',
                        inputConfig: (data.inputConfig || {}) as any,
                        urgency: data.urgency as any,
                        theme: data.theme as any,
                        timestamp: Date.now(),
                    });
                });

                // Progress updates from agents
                bridge.on('progress:update', (data) => {
                    const { setProgressStatus } = useAppState.getState();
                    setProgressStatus({
                        agentName: (data.agentName || '') as string,
                        status: (data.status || '') as string,
                        detail: data.detail as string | undefined,
                        percent: data.percent as number | undefined,
                    });
                });

                // Task lifecycle — show one message per task, not separate
                // created + assigned messages (they fire together and repeat the title).
                let lastCreatedTaskId: string | null = null;

                bridge.on('task:created', (data) => {
                    lastCreatedTaskId = (data.taskId || null) as string | null;
                    const assignee = (data.agentName || '') as string;
                    addMessage({
                        id: generateMessageId(),
                        type: 'system',
                        content: `Task: ${data.title}${assignee ? ` → ${assignee}` : ''}`,
                        timestamp: Date.now(),
                    });
                });

                bridge.on('task:assigned', (data) => {
                    // If this assignment is for the task we just showed, skip the
                    // duplicate message — just update the agent status silently.
                    if (data.taskId && data.taskId === lastCreatedTaskId) {
                        lastCreatedTaskId = null;
                    } else {
                        const assignee = (data.agentName || '') as string;
                        addMessage({
                            id: generateMessageId(),
                            type: 'system',
                            content: `Task assigned: ${data.title} → ${assignee}`,
                            timestamp: Date.now(),
                        });
                    }
                    if (data.assignedTo) {
                        updateAgent(data.assignedTo as string, { status: 'active' });
                    }
                });

                // Context compaction
                bridge.on('context:compacted', (data) => {
                    const agentId = (data.agentId || '') as string;
                    addMessage({
                        id: generateMessageId(),
                        type: 'system',
                        content: `Context compacted for ${agentId}: ${data.originalMessages} → ${data.compactedMessages} messages`,
                        timestamp: Date.now(),
                    });
                });

                // ── Start the sidecar ────────────────────────────
                await bridge.start();

            } catch (err: unknown) {
                if (cancelled) return;
                setConnection('error');
                const message = err instanceof Error ? err.message : String(err);
                addMessage({
                    id: generateMessageId(),
                    type: 'error',
                    content: `Failed to start sidecar: ${message}`,
                    timestamp: Date.now(),
                });
            }
        };

        init();

        // Save session on window close/reload
        const handleBeforeUnload = () => {
            const record = buildSessionRecord();
            if (record) {
                // Fire-and-forget — browser is closing, can't await
                saveSession(record).catch(() => {});
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            cancelled = true;
            window.removeEventListener('beforeunload', handleBeforeUnload);

            // Save session on unmount/disconnect
            const record = buildSessionRecord();
            if (record) {
                saveSession(record).catch(() => {});
            }

            bridgeRef.current?.stop().catch(() => {});
        };
    }, [setConnection, setSessionId, addMessage, setAgents, setAgentWorking, updateAgent, updateCost, incrementIterations, setStreamPreview, updateMessage, pushConfirmation, setActiveTaskStartTime, buildSessionRecord]);

    // Submit a task to the orchestrator agent
    const submitTask = useCallback(async (task: string) => {
        const bridge = bridgeRef.current;
        if (!bridge) {
            addMessage({
                id: generateMessageId(),
                type: 'error',
                content: 'Not connected to MXF server.',
                timestamp: Date.now(),
            });
            return;
        }

        addMessage({
            id: generateMessageId(),
            type: 'user',
            content: task,
            timestamp: Date.now(),
        });

        setAgentWorking(true);
        setActiveTaskStartTime(Date.now());

        try {
            // Pass working directory and any loaded context to the sidecar
            const state = useAppState.getState();
            await bridge.call('submitTask', {
                task,
                context: state.contextString || null,
                workingDirectory: state.workingDirectory || null,
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addMessage({
                id: generateMessageId(),
                type: 'error',
                content: `Task submission failed: ${message}`,
                timestamp: Date.now(),
            });
            setAgentWorking(false);
            setActiveTaskStartTime(null);
        }
    }, [addMessage, setAgentWorking, setActiveTaskStartTime]);

    // Submit a task to a specific agent
    const submitTaskToAgent = useCallback(async (task: string, agentId: string) => {
        const bridge = bridgeRef.current;
        if (!bridge) return;

        addMessage({
            id: generateMessageId(),
            type: 'user',
            content: `@${agentId} ${task}`,
            timestamp: Date.now(),
        });

        setAgentWorking(true);
        setActiveTaskStartTime(Date.now());

        try {
            const state = useAppState.getState();
            await bridge.call('submitTaskToAgent', {
                task,
                agentId,
                context: state.contextString || null,
                workingDirectory: state.workingDirectory || null,
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            addMessage({
                id: generateMessageId(),
                type: 'error',
                content: `Task submission failed: ${message}`,
                timestamp: Date.now(),
            });
            setAgentWorking(false);
            setActiveTaskStartTime(null);
        }
    }, [addMessage, setAgentWorking, setActiveTaskStartTime]);

    // Respond to a confirmation request (legacy confirm-only dialog)
    const respondToConfirmation = useCallback(async (requestId: string, approved: boolean) => {
        const bridge = bridgeRef.current;
        if (!bridge) return;

        try {
            await bridge.call('confirmationResponse', { requestId, approved });
        } catch (err: unknown) {
            console.error('Confirmation response failed:', err);
        }
    }, []);

    // Respond to a user input request (all types: text, select, multi_select, confirm)
    const respondToUserInput = useCallback(async (requestId: string, value: string | string[] | boolean) => {
        const bridge = bridgeRef.current;
        if (!bridge) return;

        try {
            await bridge.call('userInputResponse', { requestId, value });
        } catch (err: unknown) {
            console.error('User input response failed:', err);
        }
    }, []);

    return { submitTask, submitTaskToAgent, respondToConfirmation, respondToUserInput, bridgeRef };
}
