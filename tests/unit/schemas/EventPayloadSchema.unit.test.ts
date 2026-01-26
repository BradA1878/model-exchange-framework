/**
 * Unit tests for EventPayloadSchema
 * Tests event payload creation and validation
 */

import {
    createBaseEventPayload,
    createPlanStepCompletedEventPayload,
    createChannelMessageEventPayload,
    createAgentMessageEventPayload,
    BaseEventPayload
} from '@mxf/shared/schemas/EventPayloadSchema';
import { Events } from '@mxf/shared/events/EventNames';
import { createChannelMessage, createAgentMessage } from '@mxf/shared/schemas/MessageSchemas';

describe('EventPayloadSchema', () => {
    describe('createBaseEventPayload', () => {
        it('creates a payload with required fields', () => {
            const payload = createBaseEventPayload(
                Events.ControlLoop.INITIALIZE,
                'agent-123',
                'channel-456',
                { key: 'value' }
            );

            expect(payload.eventId).toBeDefined();
            expect(payload.eventType).toBe(Events.ControlLoop.INITIALIZE);
            expect(payload.agentId).toBe('agent-123');
            expect(payload.channelId).toBe('channel-456');
            expect(payload.data).toEqual({ key: 'value' });
            expect(payload.timestamp).toBeDefined();
            expect(typeof payload.timestamp).toBe('number');
        });

        it('generates unique event IDs', () => {
            const payloads = Array.from({ length: 100 }, () =>
                createBaseEventPayload(
                    Events.ControlLoop.INITIALIZE,
                    'agent-123',
                    'channel-456',
                    {}
                )
            );

            const ids = payloads.map(p => p.eventId);
            expect(new Set(ids).size).toBe(100);
        });

        it('allows custom eventId override', () => {
            const customId = 'custom-event-id';
            const payload = createBaseEventPayload(
                Events.ControlLoop.INITIALIZE,
                'agent-123',
                'channel-456',
                {},
                { eventId: customId }
            );

            expect(payload.eventId).toBe(customId);
        });

        it('allows custom timestamp override', () => {
            const customTimestamp = 1234567890;
            const payload = createBaseEventPayload(
                Events.ControlLoop.INITIALIZE,
                'agent-123',
                'channel-456',
                {},
                { timestamp: customTimestamp }
            );

            expect(payload.timestamp).toBe(customTimestamp);
        });

        it('includes optional source field when provided', () => {
            const payload = createBaseEventPayload(
                Events.ControlLoop.INITIALIZE,
                'agent-123',
                'channel-456',
                {},
                { source: 'test-module' }
            );

            expect(payload.source).toBe('test-module');
        });

        it('includes optional isRecursionProtection field when provided', () => {
            const payload = createBaseEventPayload(
                Events.ControlLoop.INITIALIZE,
                'agent-123',
                'channel-456',
                {},
                { isRecursionProtection: true }
            );

            expect(payload.isRecursionProtection).toBe(true);
        });
    });

    describe('createPlanStepCompletedEventPayload', () => {
        it('creates a valid plan step completed payload', () => {
            const payload = createPlanStepCompletedEventPayload(
                Events.Plan.PLAN_STEP_COMPLETED,
                'agent-123',
                'channel-456',
                {
                    planId: 'plan-789',
                    stepId: 'step-1',
                    completedBy: 'agent-123'
                }
            );

            expect(payload.eventType).toBe(Events.Plan.PLAN_STEP_COMPLETED);
            expect(payload.agentId).toBe('agent-123');
            expect(payload.channelId).toBe('channel-456');
            expect(payload.data.planId).toBe('plan-789');
            expect(payload.data.stepId).toBe('step-1');
            expect(payload.data.completedBy).toBe('agent-123');
        });

        it('throws for missing planId', () => {
            expect(() =>
                createPlanStepCompletedEventPayload(
                    Events.Plan.PLAN_STEP_COMPLETED,
                    'agent-123',
                    'channel-456',
                    {
                        planId: '',
                        stepId: 'step-1',
                        completedBy: 'agent-123'
                    }
                )
            ).toThrow();
        });

        it('throws for missing stepId', () => {
            expect(() =>
                createPlanStepCompletedEventPayload(
                    Events.Plan.PLAN_STEP_COMPLETED,
                    'agent-123',
                    'channel-456',
                    {
                        planId: 'plan-789',
                        stepId: '',
                        completedBy: 'agent-123'
                    }
                )
            ).toThrow();
        });

        it('throws for missing completedBy', () => {
            expect(() =>
                createPlanStepCompletedEventPayload(
                    Events.Plan.PLAN_STEP_COMPLETED,
                    'agent-123',
                    'channel-456',
                    {
                        planId: 'plan-789',
                        stepId: 'step-1',
                        completedBy: ''
                    }
                )
            ).toThrow();
        });

        it('allows optional fields in options', () => {
            const payload = createPlanStepCompletedEventPayload(
                Events.Plan.PLAN_STEP_COMPLETED,
                'agent-123',
                'channel-456',
                {
                    planId: 'plan-789',
                    stepId: 'step-1',
                    completedBy: 'agent-123'
                },
                { source: 'PlanningTools', isRecursionProtection: true }
            );

            expect(payload.source).toBe('PlanningTools');
            expect(payload.isRecursionProtection).toBe(true);
        });
    });

    describe('createChannelMessageEventPayload', () => {
        it('creates a valid channel message payload', () => {
            const message = createChannelMessage(
                'channel-456',
                'agent-123',
                'Hello, world!'
            );

            const payload = createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE,
                'agent-123',
                message
            );

            expect(payload.eventType).toBe(Events.Message.CHANNEL_MESSAGE);
            expect(payload.agentId).toBe('agent-123');
            expect(payload.channelId).toBe('channel-456');
            // payload.data IS the ChannelMessage
            expect(payload.data).toBe(message);
        });

        it('throws for missing message', () => {
            expect(() =>
                createChannelMessageEventPayload(
                    Events.Message.CHANNEL_MESSAGE,
                    'agent-123',
                    null as any
                )
            ).toThrow();
        });

        it('extracts channelId from message', () => {
            const message = createChannelMessage(
                'extracted-channel',
                'agent-123',
                'Test content'
            );

            const payload = createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE,
                'agent-123',
                message
            );

            expect(payload.channelId).toBe('extracted-channel');
        });
    });

    describe('createAgentMessageEventPayload', () => {
        it('creates a valid agent message payload', () => {
            const message = createAgentMessage(
                'sender-agent',
                'receiver-agent',
                'Hello!'
            );

            const payload = createAgentMessageEventPayload(
                Events.Message.AGENT_MESSAGE,
                'sender-agent',
                'channel-456',  // channelId is required
                message
            );

            expect(payload.eventType).toBe(Events.Message.AGENT_MESSAGE);
            expect(payload.agentId).toBe('sender-agent');
            expect(payload.channelId).toBe('channel-456');
            // payload.data IS the AgentMessage
            expect(payload.data).toBe(message);
        });

        it('throws for missing message', () => {
            expect(() =>
                createAgentMessageEventPayload(
                    Events.Message.AGENT_MESSAGE,
                    'sender-agent',
                    'channel-456',
                    null as any
                )
            ).toThrow();
        });

        it('includes channelId in the payload', () => {
            const message = createAgentMessage(
                'sender-agent',
                'receiver-agent',
                'Direct message'
            );

            const payload = createAgentMessageEventPayload(
                Events.Message.AGENT_MESSAGE,
                'sender-agent',
                'my-channel',
                message
            );

            expect(payload.channelId).toBe('my-channel');
        });
    });
});
