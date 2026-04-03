/**
 * Unit tests for SystemReminderService.
 * Validates reminder registration, trigger filtering, condition evaluation,
 * cooldown enforcement, priority ordering, token budget, and reset behavior.
 */

import { SystemReminderService, ReminderContext, ReminderTrigger, SystemReminder } from '../../../src/sdk/services/SystemReminderService';

/** Helper to build a minimal ReminderContext */
function makeContext(overrides: Partial<ReminderContext> = {}): ReminderContext {
    return {
        agentId: 'agent-test-1',
        channelId: 'channel-test-1',
        conversationLength: 5,
        ...overrides,
    };
}

/** Helper to build a custom reminder */
function makeReminder(overrides: Partial<SystemReminder> & { id: string }): SystemReminder {
    return {
        trigger: 'after_tool_execution',
        priority: 5,
        content: `Reminder: ${overrides.id}`,
        cooldownSeconds: 0,
        condition: () => true,
        ...overrides,
    };
}

describe('SystemReminderService', () => {
    let service: SystemReminderService;

    beforeEach(() => {
        service = SystemReminderService.getInstance();
        service.reset(); // Restore defaults for clean state each test
    });

    // -- singleton --
    it('returns the same instance from getInstance()', () => {
        expect(SystemReminderService.getInstance()).toBe(service);
    });

    // -- default reminders --
    describe('default reminders', () => {
        it('registers default reminders on init', () => {
            const ids = service.listReminders();
            expect(ids).toContain('orpar-observe-guidance');
            expect(ids).toContain('orpar-reflect-guidance');
            expect(ids).toContain('error-recovery');
            expect(ids).toContain('tool-no-retry');
            expect(ids).toContain('task-reanchor');
            expect(ids).toContain('context-pressure');
            expect(ids).toContain('task-assigned');
        });

        it('has at least 6 default reminders', () => {
            expect(service.listReminders().length).toBeGreaterThanOrEqual(6);
        });
    });

    // -- trigger filtering --
    describe('trigger filtering', () => {
        it('only returns reminders matching the trigger type', () => {
            service.clear();
            service.register(makeReminder({ id: 'tool-a', trigger: 'after_tool_execution' }));
            service.register(makeReminder({ id: 'error-a', trigger: 'after_error' }));

            const toolReminders = service.getApplicableReminders('after_tool_execution', makeContext());
            const ids = toolReminders.map(m => m.metadata?.reminderId);
            expect(ids).toContain('tool-a');
            expect(ids).not.toContain('error-a');
        });

        it('returns empty array when no reminders match the trigger', () => {
            service.clear();
            service.register(makeReminder({ id: 'x', trigger: 'after_error' }));
            const result = service.getApplicableReminders('task_assigned', makeContext());
            expect(result).toEqual([]);
        });
    });

    // -- condition evaluation --
    describe('condition evaluation', () => {
        it('only returns reminders whose condition returns true', () => {
            service.clear();
            service.register(makeReminder({
                id: 'true-cond',
                trigger: 'after_error',
                condition: () => true,
            }));
            service.register(makeReminder({
                id: 'false-cond',
                trigger: 'after_error',
                condition: () => false,
            }));

            const result = service.getApplicableReminders('after_error', makeContext());
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toContain('true-cond');
            expect(ids).not.toContain('false-cond');
        });

        it('passes context to the condition function', () => {
            service.clear();
            service.register(makeReminder({
                id: 'phase-check',
                trigger: 'phase_transition',
                condition: (ctx) => ctx.orparPhase === 'observe',
            }));

            const withObserve = service.getApplicableReminders(
                'phase_transition',
                makeContext({ orparPhase: 'observe' }),
            );
            expect(withObserve).toHaveLength(1);

            service.clearCooldowns(); // Reset cooldown from previous call
            const withPlan = service.getApplicableReminders(
                'phase_transition',
                makeContext({ orparPhase: 'plan' }),
            );
            expect(withPlan).toHaveLength(0);
        });

        it('handles condition evaluation errors gracefully (no throw)', () => {
            service.clear();
            service.register(makeReminder({
                id: 'throws',
                trigger: 'after_error',
                condition: () => { throw new Error('Condition exploded'); },
            }));
            service.register(makeReminder({
                id: 'safe',
                trigger: 'after_error',
                condition: () => true,
            }));

            // Should not throw, and should still return the safe reminder
            const result = service.getApplicableReminders('after_error', makeContext());
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).not.toContain('throws');
            expect(ids).toContain('safe');
        });
    });

    // -- message format --
    describe('returned message format', () => {
        it('returns system-role messages', () => {
            service.clear();
            service.register(makeReminder({ id: 'fmt-test', trigger: 'after_error' }));
            const result = service.getApplicableReminders('after_error', makeContext());
            expect(result[0].role).toBe('system');
        });

        it('wraps content in <system-reminder> tags', () => {
            service.clear();
            service.register(makeReminder({ id: 'wrap-test', trigger: 'after_error', content: 'Be careful' }));
            const result = service.getApplicableReminders('after_error', makeContext());
            expect(result[0].content).toBe('<system-reminder>Be careful</system-reminder>');
        });

        it('includes ephemeral metadata', () => {
            service.clear();
            service.register(makeReminder({ id: 'eph-test', trigger: 'after_error' }));
            const result = service.getApplicableReminders('after_error', makeContext());
            expect(result[0].metadata?.ephemeral).toBe(true);
        });

        it('includes reminderId and reminderTrigger in metadata', () => {
            service.clear();
            service.register(makeReminder({ id: 'meta-test', trigger: 'after_tool_execution' }));
            const result = service.getApplicableReminders('after_tool_execution', makeContext());
            expect(result[0].metadata?.reminderId).toBe('meta-test');
            expect(result[0].metadata?.reminderTrigger).toBe('after_tool_execution');
        });
    });

    // -- cooldowns --
    describe('cooldown enforcement', () => {
        it('prevents the same reminder from firing twice within cooldownSeconds', () => {
            service.clear();
            service.register(makeReminder({
                id: 'cool-test',
                trigger: 'after_error',
                cooldownSeconds: 60, // 60 seconds — won't expire during test
            }));

            const first = service.getApplicableReminders('after_error', makeContext());
            expect(first).toHaveLength(1);

            // Immediate second call should be blocked by cooldown
            const second = service.getApplicableReminders('after_error', makeContext());
            expect(second).toHaveLength(0);
        });

        it('allows firing after cooldown expires', () => {
            service.clear();
            service.register(makeReminder({
                id: 'short-cool',
                trigger: 'after_error',
                cooldownSeconds: 0, // No cooldown
            }));

            const first = service.getApplicableReminders('after_error', makeContext());
            expect(first).toHaveLength(1);

            // With 0 cooldown, should fire again immediately
            const second = service.getApplicableReminders('after_error', makeContext());
            expect(second).toHaveLength(1);
        });

        it('tracks cooldowns per agent', () => {
            service.clear();
            service.register(makeReminder({
                id: 'agent-cool',
                trigger: 'after_error',
                cooldownSeconds: 60,
            }));

            // Fire for agent-1
            const first = service.getApplicableReminders(
                'after_error',
                makeContext({ agentId: 'agent-1' }),
            );
            expect(first).toHaveLength(1);

            // Should still fire for agent-2 (different cooldown key)
            const second = service.getApplicableReminders(
                'after_error',
                makeContext({ agentId: 'agent-2' }),
            );
            expect(second).toHaveLength(1);

            // Should NOT fire again for agent-1
            const third = service.getApplicableReminders(
                'after_error',
                makeContext({ agentId: 'agent-1' }),
            );
            expect(third).toHaveLength(0);
        });
    });

    // -- clearCooldowns --
    describe('clearCooldowns', () => {
        it('resets all cooldowns so reminders can fire again', () => {
            service.clear();
            service.register(makeReminder({
                id: 'cooldown-clear',
                trigger: 'after_error',
                cooldownSeconds: 9999,
            }));

            service.getApplicableReminders('after_error', makeContext());
            // Now on cooldown
            expect(service.getApplicableReminders('after_error', makeContext())).toHaveLength(0);

            service.clearCooldowns();
            // Should fire again
            expect(service.getApplicableReminders('after_error', makeContext())).toHaveLength(1);
        });
    });

    // -- priority ordering --
    describe('priority ordering', () => {
        it('returns higher priority reminders first', () => {
            service.clear();
            service.register(makeReminder({ id: 'low', trigger: 'after_error', priority: 1, cooldownSeconds: 0 }));
            service.register(makeReminder({ id: 'high', trigger: 'after_error', priority: 10, cooldownSeconds: 0 }));
            service.register(makeReminder({ id: 'mid', trigger: 'after_error', priority: 5, cooldownSeconds: 0 }));

            const result = service.getApplicableReminders('after_error', makeContext(), 10000);
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toEqual(['high', 'mid', 'low']);
        });
    });

    // -- token budget --
    describe('token budget', () => {
        it('limits total reminder tokens to the budget', () => {
            service.clear();
            // Register reminders with large content
            for (let i = 0; i < 5; i++) {
                service.register(makeReminder({
                    id: `big-${i}`,
                    trigger: 'after_error',
                    priority: 5 - i,
                    content: 'W'.repeat(400), // ~100 tokens each
                    cooldownSeconds: 0,
                }));
            }

            // Use a tight budget that should only allow 1-2 reminders
            const result = service.getApplicableReminders('after_error', makeContext(), 120);
            expect(result.length).toBeLessThan(5);
            expect(result.length).toBeGreaterThanOrEqual(1);
        });

        it('returns no reminders when budget is 0', () => {
            service.clear();
            service.register(makeReminder({ id: 'tiny', trigger: 'after_error', content: 'x' }));
            // Even 1 token of content should exceed a budget of 0
            // The estimateTokens function returns at least 1 for non-empty content
            const result = service.getApplicableReminders('after_error', makeContext(), 0);
            expect(result).toHaveLength(0);
        });
    });

    // -- clear --
    describe('clear', () => {
        it('removes all reminders', () => {
            service.clear();
            expect(service.listReminders()).toEqual([]);
        });

        it('also clears cooldowns', () => {
            service.clear();
            service.register(makeReminder({ id: 'test', trigger: 'after_error', cooldownSeconds: 9999 }));
            service.getApplicableReminders('after_error', makeContext());
            service.clear();
            // Re-register and verify no cooldown remains
            service.register(makeReminder({ id: 'test', trigger: 'after_error', cooldownSeconds: 9999 }));
            const result = service.getApplicableReminders('after_error', makeContext());
            expect(result).toHaveLength(1);
        });
    });

    // -- reset --
    describe('reset', () => {
        it('restores default reminders after clear', () => {
            service.clear();
            expect(service.listReminders()).toEqual([]);

            service.reset();
            const ids = service.listReminders();
            expect(ids).toContain('orpar-observe-guidance');
            expect(ids).toContain('error-recovery');
        });
    });

    // -- custom reminders --
    describe('custom reminder registration', () => {
        it('allows registering custom reminders', () => {
            service.register(makeReminder({
                id: 'custom-test',
                trigger: 'before_llm_request',
                priority: 10,
                content: 'Custom guidance for the agent.',
                cooldownSeconds: 0,
                condition: () => true,
            }));

            expect(service.listReminders()).toContain('custom-test');

            const result = service.getApplicableReminders('before_llm_request', makeContext());
            const customMsg = result.find(m => m.metadata?.reminderId === 'custom-test');
            expect(customMsg).toBeDefined();
            expect(customMsg!.content).toContain('Custom guidance');
        });

        it('overwrites existing reminder with same ID', () => {
            service.clear();
            service.register(makeReminder({ id: 'dup', trigger: 'after_error', content: 'Version 1' }));
            service.register(makeReminder({ id: 'dup', trigger: 'after_error', content: 'Version 2' }));

            expect(service.listReminders().filter(id => id === 'dup')).toHaveLength(1);
            const result = service.getApplicableReminders('after_error', makeContext());
            expect(result[0].content).toContain('Version 2');
        });
    });

    // -- default reminder conditions (integration-style unit tests) --
    describe('default reminder conditions', () => {
        it('orpar-observe-guidance fires on phase_transition with observe phase', () => {
            const result = service.getApplicableReminders(
                'phase_transition',
                makeContext({ orparPhase: 'observe' }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toContain('orpar-observe-guidance');
        });

        it('orpar-observe-guidance does not fire for plan phase', () => {
            const result = service.getApplicableReminders(
                'phase_transition',
                makeContext({ orparPhase: 'plan' }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).not.toContain('orpar-observe-guidance');
        });

        it('error-recovery fires on after_error with hasRecentError', () => {
            const result = service.getApplicableReminders(
                'after_error',
                makeContext({ hasRecentError: true }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toContain('error-recovery');
        });

        it('error-recovery does not fire without hasRecentError', () => {
            const result = service.getApplicableReminders(
                'after_error',
                makeContext({ hasRecentError: false }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).not.toContain('error-recovery');
        });

        it('task-reanchor fires for long conversations with a current task', () => {
            const result = service.getApplicableReminders(
                'conversation_length',
                makeContext({ conversationLength: 25, currentTask: 'Build the feature' }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toContain('task-reanchor');
        });

        it('task-reanchor does not fire for short conversations', () => {
            const result = service.getApplicableReminders(
                'conversation_length',
                makeContext({ conversationLength: 5, currentTask: 'Build the feature' }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).not.toContain('task-reanchor');
        });

        it('context-pressure fires when token usage exceeds 70% of limit', () => {
            const result = service.getApplicableReminders(
                'before_llm_request',
                makeContext({ estimatedTokens: 80000, contextLimit: 100000 }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).toContain('context-pressure');
        });

        it('context-pressure does not fire when below 70%', () => {
            const result = service.getApplicableReminders(
                'before_llm_request',
                makeContext({ estimatedTokens: 50000, contextLimit: 100000 }),
            );
            const ids = result.map(m => m.metadata?.reminderId);
            expect(ids).not.toContain('context-pressure');
        });
    });
});
