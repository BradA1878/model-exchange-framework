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
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * UserInputRequestManager
 *
 * Singleton service managing pending user-input requests. Each request stores a
 * Promise resolver/rejector pair so that the blocking tool handler can await the
 * user's response. The async tool handler polls the same map by requestId.
 *
 * Responsibilities:
 * - Create and store pending requests
 * - Validate and resolve responses against the request's input type constraints
 * - Cancel requests with reason
 * - Handle timeouts via per-request timers
 * - Periodic cleanup of expired requests
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import {
    UserInputEvents,
    UserInputRequestData,
    UserInputResponseValue,
    UserInputRequestStatus,
    UserInputType,
    SelectInputConfig,
    MultiSelectInputConfig,
    TextInputConfig,
} from '../events/event-definitions/UserInputEvents';
import { EventBus } from '../events/EventBus';
import { createUserInputCancelledPayload, createUserInputTimeoutPayload } from '../schemas/EventPayloadSchema';

const logger = new Logger('info', 'UserInputRequestManager', 'server');

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal representation of a pending user input request,
 * including the Promise control handles and timeout timer.
 */
interface PendingUserInputRequest {
    /** Full request definition sent to clients */
    request: UserInputRequestData;
    /** Current status of the request */
    status: UserInputRequestStatus;
    /** Resolves the blocking tool handler's Promise */
    resolve: (value: UserInputResponseValue) => void;
    /** Rejects the blocking tool handler's Promise */
    reject: (reason: Error) => void;
    /** The response value once received */
    responseValue?: UserInputResponseValue;
    /** Timeout timer reference (if timeout configured) */
    timeoutTimer?: NodeJS.Timeout;
    /** When the request was created (for cleanup) */
    createdAt: number;
}

// ============================================================================
// Manager Class
// ============================================================================

/**
 * Singleton service for managing user input requests.
 * Stores pending requests in an in-memory Map keyed by requestId.
 */
export class UserInputRequestManager {
    private static instance: UserInputRequestManager | null = null;

    /** All pending and recently completed requests */
    private readonly pendingRequests: Map<string, PendingUserInputRequest> = new Map();

    /** Cleanup interval reference */
    private cleanupInterval: NodeJS.Timeout | null = null;

    /**
     * How long completed/cancelled/timed-out requests are kept before cleanup (5 minutes).
     * This is garbage collection for the in-memory Map, not a behavioral fallback.
     */
    private static readonly COMPLETED_REQUEST_TTL_MS = 5 * 60 * 1000;

    /** How often the cleanup runs (1 minute) */
    private static readonly CLEANUP_INTERVAL_MS = 60 * 1000;

    private constructor() {
        // Start periodic cleanup of expired requests
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpired();
        }, UserInputRequestManager.CLEANUP_INTERVAL_MS);
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): UserInputRequestManager {
        if (!UserInputRequestManager.instance) {
            UserInputRequestManager.instance = new UserInputRequestManager();
        }
        return UserInputRequestManager.instance;
    }

    /**
     * Create a new user input request and return a Promise that resolves when the user responds.
     *
     * @param request - The request definition (without requestId, which is generated here)
     * @returns Object with the full requestData and a promise that resolves to the user's response value
     */
    public createRequest(
        request: Omit<UserInputRequestData, 'requestId' | 'timestamp'>
    ): { requestData: UserInputRequestData; promise: Promise<UserInputResponseValue> } {
        const validator = createStrictValidator('UserInputRequestManager.createRequest');
        validator.assertIsNonEmptyString(request.title, 'title is required');
        validator.assertIsNonEmptyString(request.inputType, 'inputType is required');
        validator.assertIsObject(request.inputConfig, 'inputConfig is required');

        // Validate inputConfig matches inputType
        this.validateInputConfig(request.inputType, request.inputConfig);

        const requestId = uuidv4();
        const timestamp = Date.now();

        const fullRequest: UserInputRequestData = {
            ...request,
            requestId,
            timestamp,
        };

        let resolveRef!: (value: UserInputResponseValue) => void;
        let rejectRef!: (reason: Error) => void;

        const promise = new Promise<UserInputResponseValue>((resolve, reject) => {
            resolveRef = resolve;
            rejectRef = reject;
        });

        // Safety net: prevent unhandled rejection when a request is cancelled during
        // cleanup (e.g., agent disconnect while a user_input tool is still blocking).
        // The tool handler's try/catch still receives the rejection via its own await;
        // this fork just ensures there's always at least one handler attached.
        promise.catch(() => {});

        const pending: PendingUserInputRequest = {
            request: fullRequest,
            status: 'pending',
            resolve: resolveRef,
            reject: rejectRef,
            createdAt: timestamp,
        };

        // Set up timeout if the agent explicitly opted in via the timeoutMs parameter.
        // This is a user-facing feature (agents choose their timeout), not a behavioral fallback.
        if (request.timeoutMs && request.timeoutMs > 0) {
            pending.timeoutTimer = setTimeout(() => {
                this.handleTimeout(requestId);
            }, request.timeoutMs);
        }

        this.pendingRequests.set(requestId, pending);
        logger.debug(`Created user input request ${requestId}: "${request.title}" (${request.inputType})`);

        return { requestData: fullRequest, promise };
    }

    /**
     * Submit a user's response for a pending request.
     * Validates the response against the input type constraints before resolving.
     *
     * @param requestId - The request ID to respond to
     * @param value - The user's response value
     * @throws Error if requestId not found, request not pending, or value is invalid
     */
    public submitResponse(requestId: string, value: UserInputResponseValue): void {
        const validator = createStrictValidator('UserInputRequestManager.submitResponse');
        validator.assertIsNonEmptyString(requestId, 'requestId is required');

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            throw new Error(`User input request ${requestId} not found`);
        }

        if (pending.status !== 'pending') {
            throw new Error(`User input request ${requestId} is already ${pending.status}`);
        }

        // Validate response against input type constraints
        this.validateResponse(pending.request, value);

        // Clear timeout if set
        if (pending.timeoutTimer) {
            clearTimeout(pending.timeoutTimer);
            pending.timeoutTimer = undefined;
        }

        // Mark as responded and store value
        pending.status = 'responded';
        pending.responseValue = value;

        // Resolve the blocking Promise
        pending.resolve(value);

        logger.debug(`User input request ${requestId} responded with: ${JSON.stringify(value)}`);
    }

    /**
     * Cancel a pending request with a reason.
     *
     * @param requestId - The request ID to cancel
     * @param reason - Reason for cancellation
     */
    public cancelRequest(requestId: string, reason: string): void {
        const validator = createStrictValidator('UserInputRequestManager.cancelRequest');
        validator.assertIsNonEmptyString(requestId, 'requestId is required');
        validator.assertIsNonEmptyString(reason, 'reason is required');

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            logger.warn(`Cannot cancel request ${requestId}: not found`);
            return;
        }

        if (pending.status !== 'pending') {
            logger.warn(`Cannot cancel request ${requestId}: already ${pending.status}`);
            return;
        }

        // Clear timeout if set
        if (pending.timeoutTimer) {
            clearTimeout(pending.timeoutTimer);
            pending.timeoutTimer = undefined;
        }

        pending.status = 'cancelled';

        // Notify clients so they can dismiss the prompt UI
        EventBus.server.emit(
            UserInputEvents.CANCELLED,
            createUserInputCancelledPayload(
                pending.request.agentId,
                pending.request.channelId,
                { requestId, reason, timestamp: Date.now() }
            )
        );

        pending.reject(new Error(`User input request cancelled: ${reason}`));

        logger.debug(`User input request ${requestId} cancelled: ${reason}`);
    }

    /**
     * Get the current status and response (if available) for a request.
     * Used by the async get_user_input_response tool.
     *
     * @param requestId - The request ID to check
     * @returns Status info, or null if not found
     */
    public getRequest(requestId: string): {
        status: UserInputRequestStatus;
        value?: UserInputResponseValue;
        request: UserInputRequestData;
    } | null {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            return null;
        }

        return {
            status: pending.status,
            value: pending.responseValue,
            request: pending.request,
        };
    }

    /**
     * Cancel all pending requests for a specific agent.
     * Called when an agent disconnects to avoid blocking promises hanging indefinitely.
     *
     * @param agentId - The agent whose pending requests should be cancelled
     * @returns Number of requests cancelled
     */
    public cancelRequestsForAgent(agentId: string): number {
        let cancelled = 0;
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            if (pending.status === 'pending' && pending.request.agentId === agentId) {
                this.cancelRequest(requestId, `Agent ${agentId} disconnected`);
                cancelled++;
            }
        }
        if (cancelled > 0) {
            logger.debug(`Cancelled ${cancelled} pending user input request(s) for disconnected agent ${agentId}`);
        }
        return cancelled;
    }

    // ========================================================================
    // Validation
    // ========================================================================

    /**
     * Validate that inputConfig matches the declared inputType.
     */
    private validateInputConfig(inputType: UserInputType, inputConfig: any): void {
        const validator = createStrictValidator('UserInputRequestManager.validateInputConfig');

        switch (inputType) {
            case 'text':
                // TextInputConfig — all fields optional, no strict validation needed
                break;

            case 'select':
                validator.assertIsObject(inputConfig, 'inputConfig must be an object for select type');
                validator.assert(
                    Array.isArray(inputConfig.options) && inputConfig.options.length > 0,
                    'select inputConfig.options must be a non-empty array'
                );
                for (const opt of inputConfig.options) {
                    validator.assertIsNonEmptyString(opt.value, 'Each select option must have a non-empty value');
                    validator.assertIsNonEmptyString(opt.label, 'Each select option must have a non-empty label');
                }
                break;

            case 'multi_select':
                validator.assertIsObject(inputConfig, 'inputConfig must be an object for multi_select type');
                validator.assert(
                    Array.isArray(inputConfig.options) && inputConfig.options.length > 0,
                    'multi_select inputConfig.options must be a non-empty array'
                );
                for (const opt of inputConfig.options) {
                    validator.assertIsNonEmptyString(opt.value, 'Each multi_select option must have a non-empty value');
                    validator.assertIsNonEmptyString(opt.label, 'Each multi_select option must have a non-empty label');
                }
                if (inputConfig.minSelections !== undefined) {
                    validator.assert(
                        typeof inputConfig.minSelections === 'number' && inputConfig.minSelections >= 0,
                        'minSelections must be a non-negative number'
                    );
                }
                if (inputConfig.maxSelections !== undefined) {
                    validator.assert(
                        typeof inputConfig.maxSelections === 'number' && inputConfig.maxSelections > 0,
                        'maxSelections must be a positive number'
                    );
                }
                break;

            case 'confirm':
                // ConfirmInputConfig — all fields optional
                break;

            default:
                throw new Error(`Unknown input type: ${inputType}`);
        }
    }

    /**
     * Validate a user's response value against the request's input type constraints.
     * Throws descriptive errors for invalid responses.
     */
    private validateResponse(request: UserInputRequestData, value: UserInputResponseValue): void {
        const validator = createStrictValidator('UserInputRequestManager.validateResponse');

        switch (request.inputType) {
            case 'text': {
                validator.assert(typeof value === 'string', 'Text input response must be a string');
                const textValue = value as string;
                const config = request.inputConfig as TextInputConfig;
                if (config.minLength !== undefined && textValue.length < config.minLength) {
                    throw new Error(`Text response too short: minimum ${config.minLength} characters, got ${textValue.length}`);
                }
                if (config.maxLength !== undefined && textValue.length > config.maxLength) {
                    throw new Error(`Text response too long: maximum ${config.maxLength} characters, got ${textValue.length}`);
                }
                break;
            }

            case 'select': {
                validator.assert(typeof value === 'string', 'Select input response must be a string');
                const config = request.inputConfig as SelectInputConfig;
                const validValues = config.options.map(o => o.value);
                if (!validValues.includes(value as string)) {
                    throw new Error(
                        `Invalid select value "${value}". Valid options: ${validValues.join(', ')}`
                    );
                }
                break;
            }

            case 'multi_select': {
                validator.assert(Array.isArray(value), 'Multi-select input response must be an array of strings');
                const values = value as string[];
                const config = request.inputConfig as MultiSelectInputConfig;
                const validValues = config.options.map(o => o.value);

                // Reject duplicate selections
                const uniqueValues = new Set(values);
                if (uniqueValues.size !== values.length) {
                    throw new Error('multi_select response contains duplicate values');
                }

                for (const v of values) {
                    if (!validValues.includes(v)) {
                        throw new Error(
                            `Invalid multi_select value "${v}". Valid options: ${validValues.join(', ')}`
                        );
                    }
                }

                if (config.minSelections !== undefined && values.length < config.minSelections) {
                    throw new Error(
                        `Too few selections: minimum ${config.minSelections}, got ${values.length}`
                    );
                }
                if (config.maxSelections !== undefined && values.length > config.maxSelections) {
                    throw new Error(
                        `Too many selections: maximum ${config.maxSelections}, got ${values.length}`
                    );
                }
                break;
            }

            case 'confirm': {
                validator.assert(typeof value === 'boolean', 'Confirm input response must be a boolean');
                break;
            }

            default:
                throw new Error(`Cannot validate response for unknown input type: ${request.inputType}`);
        }
    }

    // ========================================================================
    // Timeout Handling
    // ========================================================================

    /**
     * Handle timeout for a specific request
     */
    private handleTimeout(requestId: string): void {
        const pending = this.pendingRequests.get(requestId);
        if (!pending || pending.status !== 'pending') {
            return;
        }

        pending.status = 'timeout';

        // Notify clients so they can dismiss the prompt UI
        EventBus.server.emit(
            UserInputEvents.TIMEOUT,
            createUserInputTimeoutPayload(
                pending.request.agentId,
                pending.request.channelId,
                { requestId, timeoutMs: pending.request.timeoutMs!, timestamp: Date.now() }
            )
        );

        pending.reject(new Error(`User input request ${requestId} timed out`));

        logger.debug(`User input request ${requestId} timed out`);
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Remove completed/cancelled/timed-out requests that are older than the TTL.
     * Called periodically by the cleanup interval.
     */
    private cleanupExpired(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [requestId, pending] of this.pendingRequests.entries()) {
            if (pending.status !== 'pending') {
                const age = now - pending.createdAt;
                if (age > UserInputRequestManager.COMPLETED_REQUEST_TTL_MS) {
                    this.pendingRequests.delete(requestId);
                    cleaned++;
                }
            }
        }

        if (cleaned > 0) {
            logger.debug(`Cleaned up ${cleaned} expired user input requests`);
        }
    }

    /**
     * Shut down the manager — clears the cleanup interval and rejects all pending requests.
     * Used for graceful shutdown.
     */
    public shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Reject all pending requests
        for (const [requestId, pending] of this.pendingRequests.entries()) {
            if (pending.status === 'pending') {
                if (pending.timeoutTimer) {
                    clearTimeout(pending.timeoutTimer);
                }
                pending.status = 'cancelled';
                pending.reject(new Error('UserInputRequestManager shutting down'));
            }
        }

        this.pendingRequests.clear();
        UserInputRequestManager.instance = null;

        logger.debug('UserInputRequestManager shut down');
    }
}
