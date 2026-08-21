/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Reviewed socket-to-EventBus request boundary for control-loop operations.
 *
 * Client commands use request-specific names. Canonical lifecycle/phase names
 * are server-owned and are never installed as socket listeners, which prevents
 * a client from forging results and prevents socket echo loops.
 */

import { Socket } from 'socket.io';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { ControlLoopEvents } from '@mxf-dev/core/events/event-definitions/ControlLoopEvents';
import { CoreSocketEvents } from '@mxf-dev/core/events/EventNames';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    ControlLoopSpecificData,
    createControlLoopEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';

const moduleLogger = new Logger('info', 'ControlLoopHandlers', 'server');

/** Reviewed client request events. Canonical lifecycle names are absent. */
const CLIENT_CONTROL_LOOP_REQUESTS = [
    [ControlLoopEvents.INITIALIZE, ControlLoopEvents.INITIALIZE],
    [ControlLoopEvents.START_REQUEST, ControlLoopEvents.START_REQUEST],
    [ControlLoopEvents.STOP_REQUEST, ControlLoopEvents.STOP_REQUEST],
    [ControlLoopEvents.OBSERVATION_SUBMIT, ControlLoopEvents.OBSERVATION_SUBMIT],
    [ControlLoopEvents.EXECUTION_REQUEST, ControlLoopEvents.EXECUTION_REQUEST],
    [ControlLoopEvents.PLAN_SUBMIT, ControlLoopEvents.PLAN_SUBMIT],
    [ControlLoopEvents.REFLECTION_SUBMIT, ControlLoopEvents.REFLECTION_SUBMIT]
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const hasRequiredRequestData = (
    requestEvent: string,
    data: Record<string, unknown>
): boolean => {
    if (typeof data.loopId !== 'string' || data.loopId.trim().length === 0) {
        return false;
    }

    switch (requestEvent) {
        case ControlLoopEvents.OBSERVATION_SUBMIT:
            return data.observation !== undefined && data.observation !== null;
        case ControlLoopEvents.EXECUTION_REQUEST:
            return data.action !== undefined && data.action !== null;
        case ControlLoopEvents.PLAN_SUBMIT:
            return data.plan !== undefined && data.plan !== null;
        case ControlLoopEvents.REFLECTION_SUBMIT:
            return (data.reflection !== undefined && data.reflection !== null) ||
                (isRecord(data.context) &&
                    data.context.reflection !== undefined &&
                    data.context.reflection !== null);
        default:
            return true;
    }
};

/**
 * Install only reviewed control-loop command listeners for an authenticated
 * agent socket.
 */
export const setupControlLoopHandlers = (
    socket: Socket,
    agentId: string,
    channelId: string
): void => {
    const validator = createStrictValidator('ControlLoopHandlers.setupControlLoopHandlers');
    validator.assertIsNonEmptyString(agentId);
    validator.assertIsNonEmptyString(channelId);

    const cleanupFunctions: Array<() => void> = [];

    CLIENT_CONTROL_LOOP_REQUESTS.forEach(([requestEvent, serverEvent]) => {
        const socketHandler = (payload: unknown): void => {
            if (!isRecord(payload)) {
                moduleLogger.warn(`Denied malformed ${requestEvent} from socket ${socket.id}`);
                return;
            }

            const data = payload.data;
            if (typeof payload.eventId !== 'string' ||
                payload.eventType !== requestEvent ||
                payload.agentId !== agentId ||
                payload.channelId !== channelId ||
                !isRecord(data) ||
                !hasRequiredRequestData(requestEvent, data)) {
                moduleLogger.warn(`Denied untrusted ${requestEvent} envelope from socket ${socket.id}`);
                return;
            }

            const trustedData: Record<string, unknown> = { ...data };
            if (requestEvent === ControlLoopEvents.OBSERVATION_SUBMIT) {
                const claimedContext = isRecord(data.context) ? data.context : {};
                trustedData.context = {
                    ...claimedContext,
                    // Cross-agent loop mutation is not part of the authenticated
                    // socket contract. Bind the owner to this key's agent.
                    loopOwnerId: agentId
                };
            }

            // Discard the caller's envelope. The domain service consumes the
            // request-specific name and exclusively owns canonical outcomes.
            EventBus.server.emit(
                serverEvent,
                createControlLoopEventPayload(
                    serverEvent,
                    agentId,
                    channelId,
                    trustedData as ControlLoopSpecificData
                )
            );
        };

        socket.on(requestEvent, socketHandler);
        cleanupFunctions.push(() => socket.off(requestEvent, socketHandler));
    });

    socket.on(CoreSocketEvents.DISCONNECT, () => {
        cleanupFunctions.forEach(cleanup => cleanup());
    });
};
