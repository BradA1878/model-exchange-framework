/**
 * Unit tests for ReactiveCompactionService.
 * Validates context overflow detection, escalating compaction strategies,
 * token reduction, max retry handling, and event emission safety.
 */

/* Mock EventBus before any imports to prevent socket errors */
jest.mock('../../../src/shared/events/EventBus', () => ({
    EventBus: {
        client: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
        server: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    },
}));

/* Mock EventPayloadSchema to avoid deep dependency chains */
jest.mock('../../../src/shared/schemas/EventPayloadSchema', () => ({
    createReactiveCompactionTriggeredPayload: jest.fn(() => ({})),
}));

import { ReactiveCompactionService } from '../../../src/sdk/services/ReactiveCompactionService';
import { ConversationMessage } from '../../../src/shared/interfaces/ConversationMessage';
import { EventBus } from '../../../src/shared/events/EventBus';

/** Helper to create a ConversationMessage with sensible defaults */
function msg(
    role: ConversationMessage['role'],
    content: string,
    overrides?: Partial<ConversationMessage>,
): ConversationMessage {
    return {
        id: overrides?.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content,
        timestamp: overrides?.timestamp ?? Date.now(),
        metadata: overrides?.metadata,
        tool_calls: overrides?.tool_calls,
    };
}

/** Build a conversation with tool results that have large bodies */
function buildConversation(messageCount: number = 10, contentSize: number = 500): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < messageCount; i++) {
        if (i % 3 === 0) {
            messages.push(msg('user', `User message ${i}`));
        } else if (i % 3 === 1) {
            messages.push(msg('assistant', `Assistant message ${i}`, {
                tool_calls: [{ id: `call_${i}`, type: 'function', function: { name: `tool_${i}` } }],
            }));
        } else {
            messages.push(msg('tool', 'x'.repeat(contentSize), {
                metadata: { toolName: `tool_${i}`, tool_call_id: `call_${i - 1}`, success: true },
            }));
        }
    }
    return messages;
}

describe('ReactiveCompactionService', () => {
    let service: ReactiveCompactionService;

    beforeEach(() => {
        service = ReactiveCompactionService.getInstance();
        jest.clearAllMocks();
    });

    // -- singleton --
    it('returns the same instance from getInstance()', () => {
        const a = ReactiveCompactionService.getInstance();
        const b = ReactiveCompactionService.getInstance();
        expect(a).toBe(b);
    });

    // -- isContextOverflowError --
    describe('isContextOverflowError', () => {
        it('detects HTTP 413 via status property', () => {
            expect(service.isContextOverflowError({ status: 413 })).toBe(true);
        });

        it('detects HTTP 413 via statusCode property', () => {
            expect(service.isContextOverflowError({ statusCode: 413 })).toBe(true);
        });

        it('detects "context length exceeded" in error message', () => {
            expect(service.isContextOverflowError({ message: 'context length exceeded' })).toBe(true);
        });

        it('detects "maximum context length" in error message', () => {
            expect(service.isContextOverflowError({ message: 'maximum context length' })).toBe(true);
        });

        it('detects "too many tokens" in error message', () => {
            expect(service.isContextOverflowError({ message: 'too many tokens' })).toBe(true);
        });

        it('detects "request too large" in error message', () => {
            expect(service.isContextOverflowError({ message: 'request too large' })).toBe(true);
        });

        it('detects "context_length_exceeded" in error message', () => {
            expect(service.isContextOverflowError({ message: 'context_length_exceeded' })).toBe(true);
        });

        it('is case-insensitive for message matching', () => {
            expect(service.isContextOverflowError({ message: 'CONTEXT LENGTH EXCEEDED' })).toBe(true);
            expect(service.isContextOverflowError({ message: 'Too Many Tokens' })).toBe(true);
        });

        it('checks the error property as well as message', () => {
            expect(service.isContextOverflowError({ error: 'context length exceeded' })).toBe(true);
        });

        it('returns false for null', () => {
            expect(service.isContextOverflowError(null)).toBe(false);
        });

        it('returns false for undefined', () => {
            expect(service.isContextOverflowError(undefined)).toBe(false);
        });

        it('returns false for unrelated errors', () => {
            expect(service.isContextOverflowError({ status: 500, message: 'server error' })).toBe(false);
            expect(service.isContextOverflowError({ message: 'network timeout' })).toBe(false);
            expect(service.isContextOverflowError(new Error('something broke'))).toBe(false);
        });

        it('returns false for empty error objects', () => {
            expect(service.isContextOverflowError({})).toBe(false);
        });
    });

    // -- getStrategy --
    describe('getStrategy', () => {
        it('returns microcompact_all for attempt 1', () => {
            expect(service.getStrategy(1)).toBe('microcompact_all');
        });

        it('returns structured_summary for attempt 2', () => {
            expect(service.getStrategy(2)).toBe('structured_summary');
        });

        it('returns aggressive_drop for attempt 3', () => {
            expect(service.getStrategy(3)).toBe('aggressive_drop');
        });

        it('returns aggressive_drop for any attempt beyond 3', () => {
            expect(service.getStrategy(4)).toBe('aggressive_drop');
            expect(service.getStrategy(10)).toBe('aggressive_drop');
        });
    });

    // -- compact --
    describe('compact', () => {
        const agentId = 'agent-1';
        const channelId = 'channel-1';

        it('applies microcompact_all for attempt 1 (strips tool result bodies)', async () => {
            const messages = buildConversation(9, 800);
            const result = await service.compact(messages, agentId, channelId, 1);

            expect(result.strategy).toBe('microcompact_all');
            // Messages should still exist but tool results should be compacted
            expect(result.messages.length).toBeGreaterThan(0);
            expect(result.tokensBefore).toBeGreaterThan(0);
        });

        it('applies structured_summary for attempt 2 (keeps 3 recent + summary)', async () => {
            const messages = buildConversation(12, 500);
            const result = await service.compact(messages, agentId, channelId, 2);

            expect(result.strategy).toBe('structured_summary');
            // Should have summary message + up to 3 recent messages
            // (could be fewer if original had fewer than 3 after cutoff)
            expect(result.messages.length).toBeLessThanOrEqual(4);
        });

        it('returns original messages unchanged when attempt exceeds MAX_RETRIES', async () => {
            // MAX_RETRIES is 2, so attempt 3 bails out immediately
            const messages = buildConversation(12, 500);
            const result = await service.compact(messages, agentId, channelId, 3);

            // Strategy reported is aggressive_drop but messages are unchanged
            expect(result.strategy).toBe('aggressive_drop');
            expect(result.messages).toBe(messages);
            expect(result.success).toBe(false);
        });

        it('returns success=true when tokens were reduced', async () => {
            const messages = buildConversation(12, 1000);
            const result = await service.compact(messages, agentId, channelId, 2);

            expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
            expect(result.success).toBe(true);
        });

        it('returns success=false when max retries exceeded (attempt > 2)', async () => {
            const messages = buildConversation(6, 200);
            const result = await service.compact(messages, agentId, channelId, 3);

            // Attempt 3 exceeds MAX_RETRIES (2), so should return success=false
            // with messages unchanged
            expect(result.success).toBe(false);
            expect(result.messages).toBe(messages);
            expect(result.tokensBefore).toBe(result.tokensAfter);
        });

        it('emits a REACTIVE_COMPACTION_TRIGGERED event on success', async () => {
            const messages = buildConversation(9, 500);
            await service.compact(messages, agentId, channelId, 1);

            expect(EventBus.client.emit).toHaveBeenCalled();
        });

        it('does NOT throw when EventBus.client.emit fails', async () => {
            // Make emit throw
            (EventBus.client.emit as jest.Mock).mockImplementationOnce(() => {
                throw new Error('Socket not connected');
            });

            const messages = buildConversation(9, 500);
            // Should not throw — compaction continues despite event emission failure
            await expect(
                service.compact(messages, agentId, channelId, 1),
            ).resolves.toBeDefined();
        });

        it('tracks tokensBefore and tokensAfter in result', async () => {
            const messages = buildConversation(9, 500);
            const result = await service.compact(messages, agentId, channelId, 1);

            expect(result.tokensBefore).toBeGreaterThan(0);
            expect(result.tokensAfter).toBeGreaterThan(0);
            expect(typeof result.tokensBefore).toBe('number');
            expect(typeof result.tokensAfter).toBe('number');
        });
    });
});
