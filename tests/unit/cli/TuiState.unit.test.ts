/**
 * Unit tests for TUI State Reducer
 *
 * Tests reducer actions including:
 * - SET_TASK / TASK_RESOLVED — task lifecycle with title and timing
 * - TRACK_FILE_OP / CLEAR_FILE_OP — parallel agent file conflict detection

 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { appReducer, createInitialState, type AppState, type AppAction } from '../../../src/cli/tui/state';

describe('TUI State Reducer — Task Lifecycle (SET_TASK / TASK_RESOLVED)', () => {
    let state: AppState;

    beforeEach(() => {
        state = createInitialState();
    });

    describe('initial state', () => {
        it('should initialize task fields as null', () => {
            expect(state.currentTaskId).toBeNull();
            expect(state.currentTaskTitle).toBeNull();
            expect(state.taskStartTime).toBeNull();
        });
    });

    describe('SET_TASK — new task', () => {
        it('should set taskId, title, and start time when assigning a new task', () => {
            const next = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Refactor auth service',
            });

            expect(next.currentTaskId).toBe('task-1');
            expect(next.currentTaskTitle).toBe('Refactor auth service');
            expect(next.taskStartTime).toBeGreaterThan(0);
        });

        it('should set start time even when title is omitted', () => {
            const next = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
            });

            expect(next.currentTaskId).toBe('task-1');
            expect(next.currentTaskTitle).toBeNull();
            expect(next.taskStartTime).toBeGreaterThan(0);
        });
    });

    describe('SET_TASK — second dispatch for same task preserves start time', () => {
        it('should preserve taskStartTime when re-dispatching with the same taskId', () => {
            const first = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Original title',
            });
            const originalStartTime = first.taskStartTime;

            // Simulate a second SET_TASK with the same taskId (e.g., task reassignment)
            const second = appReducer(first, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Updated title',
            });

            expect(second.currentTaskId).toBe('task-1');
            expect(second.currentTaskTitle).toBe('Updated title');
            // Start time preserved — not reset on re-dispatch
            expect(second.taskStartTime).toBe(originalStartTime);
        });

        it('should preserve existing title when title is not provided in re-dispatch', () => {
            const first = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Original title',
            });

            const second = appReducer(first, {
                type: 'SET_TASK',
                taskId: 'task-1',
            });

            // title falls back to existing currentTaskTitle when taskId is truthy and title is undefined
            expect(second.currentTaskTitle).toBe('Original title');
        });
    });

    describe('SET_TASK — clearing task (taskId: null)', () => {
        it('should reset all three task fields when taskId is null', () => {
            // Set up an active task first
            const active = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Some task',
            });

            const cleared = appReducer(active, {
                type: 'SET_TASK',
                taskId: null,
            });

            expect(cleared.currentTaskId).toBeNull();
            expect(cleared.currentTaskTitle).toBeNull();
            expect(cleared.taskStartTime).toBeNull();
        });
    });

    describe('TASK_RESOLVED — clearTaskId resets all task fields', () => {
        it('should clear taskId, title, and start time when clearTaskId is true', () => {
            // Set up an active task
            const active = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Refactor auth',
            });
            expect(active.taskStartTime).not.toBeNull();

            const resolved = appReducer(active, {
                type: 'TASK_RESOLVED',
                agentIds: ['agent-1'],
                clearTaskId: true,
            });

            expect(resolved.currentTaskId).toBeNull();
            expect(resolved.currentTaskTitle).toBeNull();
            expect(resolved.taskStartTime).toBeNull();
            expect(resolved.isAgentWorking).toBe(false);
            expect(resolved.streamPreview).toBeNull();
        });

        it('should preserve task fields when clearTaskId is false', () => {
            const active = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Multi-step task',
            });

            const resolved = appReducer(active, {
                type: 'TASK_RESOLVED',
                agentIds: ['agent-1'],
                clearTaskId: false,
            });

            expect(resolved.currentTaskId).toBe('task-1');
            expect(resolved.currentTaskTitle).toBe('Multi-step task');
            expect(resolved.taskStartTime).toBe(active.taskStartTime);
        });

        it('should add result entry when provided', () => {
            const active = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Test task',
            });

            const resolved = appReducer(active, {
                type: 'TASK_RESOLVED',
                resultEntry: {
                    type: 'result',
                    content: 'Task completed successfully',
                    agentId: 'agent-1',
                    agentName: 'Planner',
                },
                agentIds: ['agent-1'],
                clearTaskId: true,
            });

            expect(resolved.entries).toHaveLength(1);
            expect(resolved.entries[0].type).toBe('result');
            expect(resolved.entries[0].content).toBe('Task completed successfully');
        });

        it('should idle the specified agents', () => {
            // Set up state with agents
            let withAgents = appReducer(state, {
                type: 'SET_AGENTS',
                agents: [
                    { id: 'agent-1', name: 'Planner', status: 'working' } as any,
                    { id: 'agent-2', name: 'Operator', status: 'working' } as any,
                    { id: 'agent-3', name: 'Reviewer', status: 'working' } as any,
                ],
            });

            const resolved = appReducer(withAgents, {
                type: 'TASK_RESOLVED',
                agentIds: ['agent-1', 'agent-2'],
                clearTaskId: true,
            });

            expect(resolved.agents[0].status).toBe('idle');
            expect(resolved.agents[1].status).toBe('idle');
            // agent-3 was not in agentIds, should remain working
            expect(resolved.agents[2].status).toBe('working');
        });
    });

    describe('immutability', () => {
        it('SET_TASK should not mutate previous state', () => {
            const next = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'New task',
            });

            expect(state.currentTaskId).toBeNull();
            expect(state.currentTaskTitle).toBeNull();
            expect(state.taskStartTime).toBeNull();
            expect(next).not.toBe(state);
        });

        it('TASK_RESOLVED should not mutate previous state', () => {
            const active = appReducer(state, {
                type: 'SET_TASK',
                taskId: 'task-1',
                title: 'Test',
            });

            const resolved = appReducer(active, {
                type: 'TASK_RESOLVED',
                agentIds: [],
                clearTaskId: true,
            });

            expect(active.currentTaskId).toBe('task-1');
            expect(resolved.currentTaskId).toBeNull();
            expect(resolved).not.toBe(active);
        });
    });
});

describe('TUI State Reducer — File Conflict Detection', () => {
    let state: AppState;

    beforeEach(() => {
        state = createInitialState();
    });

    describe('initial state', () => {
        it('should initialize activeFileOps as an empty Map', () => {
            expect(state.activeFileOps).toBeInstanceOf(Map);
            expect(state.activeFileOps.size).toBe(0);
        });
    });

    describe('TRACK_FILE_OP', () => {
        it('should add a file operation entry for a new file path', () => {
            const action: AppAction = {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'CodeWriter',
                toolName: 'write_file',
            };

            const next = appReducer(state, action);

            expect(next.activeFileOps.size).toBe(1);
            const op = next.activeFileOps.get('/src/index.ts');
            expect(op).toBeDefined();
            expect(op!.agentId).toBe('agent-1');
            expect(op!.agentName).toBe('CodeWriter');
            expect(op!.toolName).toBe('write_file');
            expect(typeof op!.timestamp).toBe('number');
        });

        it('should track multiple file paths from different agents', () => {
            let next = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/a.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            });
            next = appReducer(next, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/b.ts',
                agentId: 'agent-2',
                agentName: 'Agent2',
                toolName: 'edit_file',
            });

            expect(next.activeFileOps.size).toBe(2);
            expect(next.activeFileOps.get('/src/a.ts')!.agentId).toBe('agent-1');
            expect(next.activeFileOps.get('/src/b.ts')!.agentId).toBe('agent-2');
        });

        it('should overwrite the entry when the same agent re-targets the same file', () => {
            let next = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'CodeWriter',
                toolName: 'write_file',
            });
            next = appReducer(next, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'CodeWriter',
                toolName: 'edit_file',
            });

            // Map.set overwrites — only one entry for this path
            expect(next.activeFileOps.size).toBe(1);
            expect(next.activeFileOps.get('/src/index.ts')!.toolName).toBe('edit_file');
        });

        it('should overwrite the entry when a different agent targets the same file (conflict detected at dispatch time)', () => {
            // The reducer stores the latest op per path; conflict warning is emitted
            // by useEventMonitor *before* dispatching TRACK_FILE_OP
            let next = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            });
            next = appReducer(next, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-2',
                agentName: 'Agent2',
                toolName: 'edit_file',
            });

            expect(next.activeFileOps.size).toBe(1);
            expect(next.activeFileOps.get('/src/index.ts')!.agentId).toBe('agent-2');
        });

        it('should not mutate the previous state', () => {
            const action: AppAction = {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            };

            const next = appReducer(state, action);

            expect(state.activeFileOps.size).toBe(0);
            expect(next.activeFileOps.size).toBe(1);
            expect(next).not.toBe(state);
        });
    });

    describe('CLEAR_FILE_OP', () => {
        it('should remove the entry for the specified file path', () => {
            let next = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            });
            next = appReducer(next, {
                type: 'CLEAR_FILE_OP',
                filePath: '/src/index.ts',
            });

            expect(next.activeFileOps.size).toBe(0);
        });

        it('should not affect other tracked file paths', () => {
            let next = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/a.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            });
            next = appReducer(next, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/b.ts',
                agentId: 'agent-2',
                agentName: 'Agent2',
                toolName: 'edit_file',
            });
            next = appReducer(next, {
                type: 'CLEAR_FILE_OP',
                filePath: '/src/a.ts',
            });

            expect(next.activeFileOps.size).toBe(1);
            expect(next.activeFileOps.has('/src/a.ts')).toBe(false);
            expect(next.activeFileOps.get('/src/b.ts')!.agentId).toBe('agent-2');
        });

        it('should be a no-op when clearing a path that is not tracked', () => {
            const next = appReducer(state, {
                type: 'CLEAR_FILE_OP',
                filePath: '/nonexistent.ts',
            });

            expect(next.activeFileOps.size).toBe(0);
        });

        it('should not mutate the previous state', () => {
            let tracked = appReducer(state, {
                type: 'TRACK_FILE_OP',
                filePath: '/src/index.ts',
                agentId: 'agent-1',
                agentName: 'Agent1',
                toolName: 'write_file',
            });
            const next = appReducer(tracked, {
                type: 'CLEAR_FILE_OP',
                filePath: '/src/index.ts',
            });

            expect(tracked.activeFileOps.size).toBe(1);
            expect(next.activeFileOps.size).toBe(0);
            expect(next).not.toBe(tracked);
        });
    });
});
