/**
 * Unit tests for ClientExecutableManifest
 * Tests the allowlist gate functions for client-side tool and server execution.
 */

import {
    isClientExecutable,
    isClientExecutableServer,
    CLIENT_EXECUTABLE_INTERNAL_TOOLS,
    CLIENT_EXECUTABLE_EXTERNAL_SERVERS,
} from '@mxf/shared/protocols/mcp/ClientExecutableManifest';

describe('ClientExecutableManifest Unit Tests', () => {

    describe('isClientExecutable', () => {
        it('should return true for every tool in the allowlist', () => {
            for (const tool of CLIENT_EXECUTABLE_INTERNAL_TOOLS) {
                expect(isClientExecutable(tool)).toBe(true);
            }
        });

        it('should return true for datetime_now', () => {
            expect(isClientExecutable('datetime_now')).toBe(true);
        });

        it('should return true for datetime_convert', () => {
            expect(isClientExecutable('datetime_convert')).toBe(true);
        });

        it('should return true for datetime_arithmetic', () => {
            expect(isClientExecutable('datetime_arithmetic')).toBe(true);
        });

        it('should return true for datetime_format', () => {
            expect(isClientExecutable('datetime_format')).toBe(true);
        });

        it('should return false for non-allowlisted tool names', () => {
            expect(isClientExecutable('some_random_tool')).toBe(false);
            expect(isClientExecutable('agent_list')).toBe(false);
            expect(isClientExecutable('memory_store')).toBe(false);
            expect(isClientExecutable('plan_create')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isClientExecutable('')).toBe(false);
        });

        it('should return false for similar but not exact tool names', () => {
            expect(isClientExecutable('datetime_Now')).toBe(false);
            expect(isClientExecutable('DATETIME_NOW')).toBe(false);
            expect(isClientExecutable('datetime_now ')).toBe(false);
            expect(isClientExecutable(' datetime_now')).toBe(false);
        });
    });

    describe('isClientExecutableServer', () => {
        it('should return true for every server in the allowlist', () => {
            for (const server of CLIENT_EXECUTABLE_EXTERNAL_SERVERS) {
                expect(isClientExecutableServer(server)).toBe(true);
            }
        });

        it('should return true for calculator', () => {
            expect(isClientExecutableServer('calculator')).toBe(true);
        });

        it('should return true for sequential-thinking', () => {
            expect(isClientExecutableServer('sequential-thinking')).toBe(true);
        });

        it('should return true for filesystem', () => {
            expect(isClientExecutableServer('filesystem')).toBe(true);
        });

        it('should return false for non-allowlisted server IDs', () => {
            expect(isClientExecutableServer('some-random-server')).toBe(false);
            expect(isClientExecutableServer('redis')).toBe(false);
            expect(isClientExecutableServer('mongodb')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isClientExecutableServer('')).toBe(false);
        });

        it('should return false for similar but not exact server names', () => {
            expect(isClientExecutableServer('Calculator')).toBe(false);
            expect(isClientExecutableServer('CALCULATOR')).toBe(false);
            expect(isClientExecutableServer('filesystem ')).toBe(false);
        });
    });

    describe('Allowlist integrity', () => {
        it('should have exactly 4 internal tools in the allowlist', () => {
            expect(CLIENT_EXECUTABLE_INTERNAL_TOOLS).toHaveLength(4);
        });

        it('should have exactly 3 external servers in the allowlist', () => {
            expect(CLIENT_EXECUTABLE_EXTERNAL_SERVERS).toHaveLength(3);
        });

        it('should contain only the expected internal tool names', () => {
            const expected = ['datetime_now', 'datetime_convert', 'datetime_arithmetic', 'datetime_format'];
            expect([...CLIENT_EXECUTABLE_INTERNAL_TOOLS]).toEqual(expected);
        });

        it('should contain only the expected external server IDs', () => {
            const expected = ['calculator', 'sequential-thinking', 'filesystem'];
            expect([...CLIENT_EXECUTABLE_EXTERNAL_SERVERS]).toEqual(expected);
        });
    });
});
