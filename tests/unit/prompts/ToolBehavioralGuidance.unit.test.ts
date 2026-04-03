/**
 * Unit Tests for ToolBehavioralGuidance (Phase 1)
 *
 * Tests the singleton registry for tool behavioral hints,
 * including default registrations, custom guidance, and reset behavior.
 */

import { ToolBehavioralGuidance, ToolGuidance } from '../../../src/shared/prompts/ToolBehavioralGuidance';

describe('ToolBehavioralGuidance', () => {
    let guidance: ToolBehavioralGuidance;

    beforeEach(() => {
        guidance = ToolBehavioralGuidance.getInstance();
        guidance.reset();
    });

    describe('getInstance', () => {
        it('should return the same instance on repeated calls', () => {
            const a = ToolBehavioralGuidance.getInstance();
            const b = ToolBehavioralGuidance.getInstance();
            expect(a).toBe(b);
        });
    });

    describe('default registrations', () => {
        it('should have controlLoop_observe registered by default', () => {
            const entry = guidance.get('controlLoop_observe');
            expect(entry).toBeDefined();
            expect(entry!.toolName).toBe('controlLoop_observe');
            expect(entry!.guidance).toContain('gathering information');
        });

        it('should have messaging_send registered by default', () => {
            const entry = guidance.get('messaging_send');
            expect(entry).toBeDefined();
            expect(entry!.preferredAlternative).toBeDefined();
        });

        it('should have all ORPAR tools registered', () => {
            const orparTools = [
                'controlLoop_observe',
                'controlLoop_reason',
                'controlLoop_plan',
                'controlLoop_act',
                'controlLoop_reflect',
            ];
            for (const toolName of orparTools) {
                expect(guidance.get(toolName)).toBeDefined();
            }
        });

        it('should have task, file, code, and meta tools registered', () => {
            const tools = [
                'task_create', 'task_complete',
                'read_file', 'write_file',
                'code_execute', 'shell_execute',
                'tools_recommend',
            ];
            for (const toolName of tools) {
                expect(guidance.get(toolName)).toBeDefined();
            }
        });
    });

    describe('listTools', () => {
        it('should list all registered tool names', () => {
            const tools = guidance.listTools();
            expect(tools.length).toBeGreaterThan(0);
            expect(tools).toContain('controlLoop_observe');
            expect(tools).toContain('messaging_send');
            expect(tools).toContain('task_complete');
        });
    });

    describe('buildGuidanceString', () => {
        it('should return guidance text for a registered tool', () => {
            const text = guidance.buildGuidanceString('controlLoop_observe');
            expect(text).toContain('**Guidance:**');
            expect(text).toContain('gathering information');
        });

        it('should include preferred alternative when present', () => {
            const text = guidance.buildGuidanceString('messaging_send');
            expect(text).toContain('**Preferred alternative:**');
        });

        it('should include preconditions when present', () => {
            const text = guidance.buildGuidanceString('read_file');
            expect(text).toContain('**Preconditions:**');
        });

        it('should return empty string for unknown tools', () => {
            expect(guidance.buildGuidanceString('nonexistent_tool')).toBe('');
        });
    });

    describe('register', () => {
        it('should add custom guidance for a new tool', () => {
            const entry: ToolGuidance = {
                toolName: 'custom_test_tool',
                guidance: 'Custom guidance for testing.',
            };
            guidance.register(entry);

            const retrieved = guidance.get('custom_test_tool');
            expect(retrieved).toBeDefined();
            expect(retrieved!.guidance).toBe('Custom guidance for testing.');
        });

        it('should override existing guidance when re-registering', () => {
            guidance.register({
                toolName: 'controlLoop_observe',
                guidance: 'Overridden guidance.',
            });
            const entry = guidance.get('controlLoop_observe');
            expect(entry!.guidance).toBe('Overridden guidance.');
        });
    });

    describe('unregister', () => {
        it('should remove guidance for a tool', () => {
            expect(guidance.get('controlLoop_observe')).toBeDefined();
            const result = guidance.unregister('controlLoop_observe');
            expect(result).toBe(true);
            expect(guidance.get('controlLoop_observe')).toBeUndefined();
        });

        it('should return false for non-existent tools', () => {
            expect(guidance.unregister('nonexistent_tool')).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all guidance entries', () => {
            guidance.clear();
            expect(guidance.listTools().length).toBe(0);
            expect(guidance.get('controlLoop_observe')).toBeUndefined();
        });
    });

    describe('reset', () => {
        it('should restore default guidance after clear', () => {
            guidance.clear();
            expect(guidance.listTools().length).toBe(0);

            guidance.reset();
            expect(guidance.listTools().length).toBeGreaterThan(0);
            expect(guidance.get('controlLoop_observe')).toBeDefined();
        });

        it('should remove custom guidance and restore defaults', () => {
            guidance.register({
                toolName: 'custom_tool',
                guidance: 'Custom guidance.',
            });
            expect(guidance.get('custom_tool')).toBeDefined();

            guidance.reset();
            expect(guidance.get('custom_tool')).toBeUndefined();
            expect(guidance.get('controlLoop_observe')).toBeDefined();
        });
    });
});
