/**
 * Wiring test for agent-scope Memory.UPDATE result routing.
 *
 * The SDK's MxfMemoryService.updateAgentMemory sends Events.Memory.UPDATE with
 * an operationId and then waits for the UPDATE_RESULT carrying that same
 * operationId; event forwarding routes results to the socket of the agent named
 * in payload.agentId. Before this was fixed, the server's agent-scope handler
 * dropped the requester's operationId (it emitted a freshly generated UUID) and
 * addressed the result to SYSTEM_AGENT — so no SDK save round-trip could ever
 * observe its own result: awaited saves hung forever and fire-and-forget saves
 * leaked their result listeners. Channel-scope updates always echoed correctly;
 * this test pins the same contract for agent scope.
 *
 * Driven through the real EventBus entry point, not by calling the service
 * method directly, because the defect lived in the event bridge.
 */

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createMemoryUpdateEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';

const REQUESTER_AGENT_ID = 'echo-requester-agent';
const REQUESTER_CHANNEL_ID = 'echo-requester-channel';
const TARGET_AGENT_ID = 'echo-target-agent';
const OPERATION_ID = 'op-echo-regression-123';

describe('agent-scope Memory.UPDATE result routing', () => {
    const capturedResults: any[] = [];
    const captureHandler = (payload: any) => {
        capturedResults.push(payload);
    };

    beforeAll(() => {
        // Instantiating the service wires its EventBus bridges
        MemoryService.getInstance();
        EventBus.server.on(Events.Memory.UPDATE_RESULT, captureHandler);
    });

    afterAll(() => {
        EventBus.server.off(Events.Memory.UPDATE_RESULT, captureHandler);
    });

    it('echoes the requester operationId and addresses the result to the requesting agent', async () => {
        EventBus.server.emit(
            Events.Memory.UPDATE,
            createMemoryUpdateEventPayload(
                Events.Memory.UPDATE,
                REQUESTER_AGENT_ID,
                REQUESTER_CHANNEL_ID,
                {
                    operationId: OPERATION_ID,
                    scope: MemoryScope.AGENT,
                    id: TARGET_AGENT_ID,
                    data: { notes: { probe: 'echo-check' } }
                }
            )
        );

        // The update runs through an async Observable chain; poll briefly for the
        // echoed result rather than racing it.
        const deadline = Date.now() + 2000;
        let echoed: any;
        while (!echoed && Date.now() < deadline) {
            echoed = capturedResults.find(payload => payload?.data?.operationId === OPERATION_ID);
            if (!echoed) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Without the echo, the only emissions carry freshly generated UUIDs and
        // the SDK's pending save never resolves — that is the silent-stall class
        // of bug this guards against.
        expect(echoed).toBeDefined();
        expect(echoed.agentId).toBe(REQUESTER_AGENT_ID);
        expect(echoed.channelId).toBe(REQUESTER_CHANNEL_ID);
        expect(echoed.data.scope).toBe(MemoryScope.AGENT);
        expect(echoed.data.id).toBe(TARGET_AGENT_ID);
        expect(echoed.data.memory).toBeTruthy();
    });
});
