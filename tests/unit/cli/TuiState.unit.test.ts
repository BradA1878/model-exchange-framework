/**
 * Unit tests for TUI State Reducer — File Conflict Detection
 *
 * Tests the TRACK_FILE_OP and CLEAR_FILE_OP actions that power
 * parallel agent file conflict detection (Tier 3.2).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { appReducer, createInitialState, type AppState, type AppAction } from '../../../src/cli/tui/state';

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
