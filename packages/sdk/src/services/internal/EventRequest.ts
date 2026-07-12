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
 * Event Request
 *
 * INTERNAL USE ONLY - NOT EXPORTED FROM SDK
 *
 * One request/response helper for every "emit an event, wait for the matching
 * reply event" flow in the SDK. Before this existed there were 13 hand-rolled
 * copies of the pattern, each with its own subscription bookkeeping, its own
 * leaked timeout, and its own idea of what failure meant (some rejected, some
 * resolved `false`, some resolved `{ success: false }`).
 *
 * The contract here is single and strict:
 *
 * - The request settles exactly once.
 * - Success resolves with the mapped result.
 * - Failure REJECTS. There is no success-shaped value that means failure.
 * - The timeout timer is always cleared and every subscription is always
 *   unsubscribed, on every exit path. A short-lived script does not hang
 *   waiting for a timer that already did its job.
 * - Responses are correlated explicitly by the caller. A reply that does not
 *   belong to this request is ignored, not mistaken for it.
 */

import { Subscription } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { AnyEventName } from '@mxf-dev/core/events/EventBusBase';
import { BaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { Logger } from '@mxf-dev/core/utils/Logger';

/**
 * How the request event reaches the server.
 *
 * - `agent`: routed through the named agent's socket (EventBus.client.emitOn).
 *   Agent-scoped operations use this — the server needs to know which agent
 *   connection the request came from.
 * - `primary`: routed through the SDK's primary authenticated socket
 *   (EventBus.client.emit). SDK-level admin operations use this, because
 *   they happen before/without any agent socket.
 */
export type EmitRoute =
    | { via: 'agent'; agentId: string }
    | { via: 'primary' };

/**
 * A response that arrived on the failure event, or on the success event but
 * carrying `success: false`.
 */
export class EventRequestError extends Error {
    constructor(
        message: string,
        /** The event the failure arrived on. */
        public readonly eventName: string,
        /** The raw payload that carried the failure, for callers that need detail. */
        public readonly payload: unknown
    ) {
        super(message);
        this.name = 'EventRequestError';
    }
}

/**
 * The request did not receive any correlated response within `timeoutMs`.
 */
export class EventRequestTimeoutError extends Error {
    constructor(
        message: string,
        /** The event that was emitted and never answered. */
        public readonly eventName: string,
        public readonly timeoutMs: number
    ) {
        super(message);
        this.name = 'EventRequestTimeoutError';
    }
}

export interface AwaitEventResponseOptions<TResult> {
    /** Event to emit to start the request. */
    emitEvent: AnyEventName;

    /** Fully-formed payload for the request event. Build it with a payload helper. */
    payload: BaseEventPayload<any>;

    /** How to route the request event to the server. */
    route: EmitRoute;

    /** Event that carries a successful response. */
    successEvent: AnyEventName;

    /**
     * Event that carries a failed response. Omit only when the server has no
     * distinct failure event for this operation.
     */
    failureEvent?: AnyEventName;

    /**
     * Decide whether an incoming response belongs to this request.
     * Return false and the response is ignored. This is what stops one
     * registration's reply from completing a different registration.
     */
    correlate: (payload: any) => boolean;

    /**
     * Turn a correlated success payload into the resolved value.
     * Throw from here (or return a rejected promise) to turn a
     * nominally-successful response into a rejection — for example when the
     * server answers on the success event but sets `success: false`.
     */
    mapResult: (payload: any) => TResult | Promise<TResult>;

    /**
     * Pull the human-readable reason out of a failure payload.
     * Defaults to `payload.data.error`.
     */
    mapError?: (payload: any) => string;

    /** How long to wait for a correlated response before rejecting. */
    timeoutMs: number;

    /** Used in the timeout message, e.g. "External MCP server registration". */
    description: string;

    logger: Logger;
}

/**
 * Emit a request event and wait for its correlated response.
 *
 * @throws {EventRequestError} when the server answers with a failure.
 * @throws {EventRequestTimeoutError} when no correlated response arrives in time.
 */
export function awaitEventResponse<TResult>(
    options: AwaitEventResponseOptions<TResult>
): Promise<TResult> {
    const {
        emitEvent,
        payload,
        route,
        successEvent,
        failureEvent,
        correlate,
        mapResult,
        mapError = (p: any) => p?.data?.error,
        timeoutMs,
        description,
        logger,
    } = options;

    return new Promise<TResult>((resolve, reject) => {
        // Claimed synchronously by whichever of {success, failure, timeout} correlates
        // FIRST. It has to be synchronous: mapResult may be async, and if we only marked
        // the request settled once mapResult resolved, a failure event arriving in the
        // same tick would slip past and reject a request that had already succeeded.
        let claimed = false;
        const subscriptions: Subscription[] = [];
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        // Single teardown path, run the instant the request is claimed, so no timer
        // outlives its request and no subscription is left behind.
        const teardown = (): void => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            subscriptions.forEach(sub => sub.unsubscribe());
            subscriptions.length = 0;
        };

        /** Take ownership of the outcome. Returns false if someone else already has it. */
        const claim = (): boolean => {
            if (claimed) return false;
            claimed = true;
            teardown();
            return true;
        };

        subscriptions.push(
            EventBus.client.on(successEvent, (responsePayload: any) => {
                if (!correlate(responsePayload) || !claim()) {
                    return;
                }
                // mapResult may be async (e.g. it refreshes the tool cache before the
                // caller is allowed to continue) and may throw to signal that a
                // nominally-successful response actually carried a failure.
                Promise.resolve()
                    .then(() => mapResult(responsePayload))
                    .then(resolve)
                    .catch((error: unknown) =>
                        reject(
                            error instanceof Error
                                ? error
                                : new EventRequestError(String(error), String(successEvent), responsePayload)
                        )
                    );
            })
        );

        if (failureEvent) {
            subscriptions.push(
                EventBus.client.on(failureEvent, (responsePayload: any) => {
                    if (!correlate(responsePayload) || !claim()) {
                        return;
                    }
                    const reason = mapError(responsePayload) || `${description} failed`;
                    logger.error(`${description} failed: ${reason}`);
                    reject(new EventRequestError(reason, String(failureEvent), responsePayload));
                })
            );
        }

        timeoutId = setTimeout(() => {
            if (!claim()) return;
            reject(
                new EventRequestTimeoutError(
                    `${description} timed out after ${timeoutMs}ms (no response to '${String(emitEvent)}')`,
                    String(emitEvent),
                    timeoutMs
                )
            );
        }, timeoutMs);

        // Emit last: the listeners above must be in place before the server can answer.
        try {
            if (route.via === 'agent') {
                EventBus.client.emitOn(route.agentId, emitEvent, payload);
            } else {
                EventBus.client.emit(emitEvent, payload);
            }
        } catch (error) {
            if (claim()) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        }
    });
}
