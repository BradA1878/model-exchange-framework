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

// Memory Service for the SDK

import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload,
    BaseMemoryOperationData,
    createMemoryDeleteEventPayload,
    createMemoryGetEventPayload,
    createMemoryUpdateEventPayload,
    MemoryDeleteResultEventData,
    MemoryGetResultEventData,
    MemoryUpdateResultEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';

import { 
    MemoryScope, 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory
} from '@mxf-dev/core/types/MemoryTypes';

/**
 * Memory Service for the SDK
 * Pure client proxy for the unified Memory System
 */
export class MxfMemoryService {
    // Validator
    private validator = createStrictValidator('MxfMemoryService');
    
    // Singleton instance
    private static instance: MxfMemoryService;

    /** Pending acknowledged operations, grouped by exact agent + channel identity. */
    private pendingAgentOperations = new Map<
        string,
        Map<string, Set<(reason: string) => void>>
    >();
    
    /**
     * Create a new Memory Service instance
     */
    private constructor() {
    }
    
    /**
     * Get the singleton instance
     * @returns The memory service instance
     */
    public static getInstance(): MxfMemoryService {
        if (!MxfMemoryService.instance) {
            MxfMemoryService.instance = new MxfMemoryService();
        }
        return MxfMemoryService.instance;
    }
    
    /**
     * Generate a unique operation ID
     * @returns Unique operation ID
     */
    private generateOperationId = (): string => {
        return uuidv4();
    };

    /**
     * Reject every in-flight operation owned by one agent.
     *
     * MxfService calls this for both socket.io disconnects and explicit
     * disconnect(). No timer is involved: loss of the transport is the exact
     * terminal condition for requests whose acknowledgement can no longer
     * arrive.
     */
    public cancelPendingOperations(
        callerAgentId: string,
        callerChannelId: string,
        reason: string
    ): void {
        this.validator.assertIsNonEmptyString(
            callerAgentId,
            'Caller Agent ID must be a non-empty string'
        );
        this.validator.assertIsNonEmptyString(
            callerChannelId,
            'Caller Channel ID must be a non-empty string'
        );
        this.validator.assertIsNonEmptyString(reason, 'Cancellation reason is required');

        const pending = this.pendingAgentOperations.get(callerAgentId)?.get(callerChannelId);
        if (!pending) {
            return;
        }
        for (const cancel of [...pending]) {
            cancel(reason);
        }
    }

    private registerPendingOperation(
        callerAgentId: string,
        callerChannelId: string,
        cancel: (reason: string) => void
    ): () => void {
        let agentChannels = this.pendingAgentOperations.get(callerAgentId);
        if (!agentChannels) {
            agentChannels = new Map();
            this.pendingAgentOperations.set(callerAgentId, agentChannels);
        }
        const existing = agentChannels.get(callerChannelId);
        if (existing) {
            existing.add(cancel);
        } else {
            agentChannels.set(callerChannelId, new Set([cancel]));
        }

        return (): void => {
            const channels = this.pendingAgentOperations.get(callerAgentId);
            const pending = channels?.get(callerChannelId);
            if (!pending) {
                return;
            }
            pending.delete(cancel);
            if (pending.size === 0) {
                channels?.delete(callerChannelId);
            }
            if (channels?.size === 0) {
                this.pendingAgentOperations.delete(callerAgentId);
            }
        };
    }

    private requestMemoryOperation<TResult, TResultData extends BaseMemoryOperationData & { error?: string }>(
        callerAgentId: string,
        requestEvent: typeof Events.Memory.GET | typeof Events.Memory.UPDATE | typeof Events.Memory.DELETE,
        resultEvent: typeof Events.Memory.GET_RESULT | typeof Events.Memory.UPDATE_RESULT | typeof Events.Memory.DELETE_RESULT,
        errorEvent: typeof Events.Memory.GET_ERROR | typeof Events.Memory.UPDATE_ERROR | typeof Events.Memory.DELETE_ERROR,
        payload: BaseEventPayload<BaseMemoryOperationData>,
        mapResult: (data: TResultData) => TResult
    ): Observable<TResult> {
        return new Observable<TResult>((observer) => {
            let settled = false;
            let unregisterPendingOperation: (() => void) | undefined;

            const cleanup = (): void => {
                unregisterPendingOperation?.();
                unregisterPendingOperation = undefined;
                EventBus.client.off(resultEvent, resultHandler);
                EventBus.client.off(errorEvent, errorHandler);
                EventBus.client.off(Events.Agent.DISCONNECT, disconnectHandler);
            };
            const settleError = (error: unknown): void => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                observer.error(error instanceof Error ? error : new Error(String(error)));
            };
            const correlatedData = (rawEvent: unknown): Partial<TResultData> | null => {
                if (!rawEvent || typeof rawEvent !== 'object') {
                    return null;
                }
                const event = rawEvent as {
                    agentId?: string;
                    channelId?: string;
                    data?: Partial<TResultData>;
                };
                return event.agentId === callerAgentId &&
                    event.channelId === payload.channelId &&
                    event.data?.operationId === payload.data.operationId
                    ? event.data
                    : null;
            };
            const resultHandler = (rawEvent: unknown): void => {
                const data = correlatedData(rawEvent);
                if (!data || settled) {
                    return;
                }

                settled = true;
                cleanup();
                if (data.error) {
                    observer.error(new Error(data.error));
                    return;
                }

                try {
                    observer.next(mapResult(data as TResultData));
                    observer.complete();
                } catch (error) {
                    observer.error(error);
                }
            };
            const errorHandler = (rawEvent: unknown): void => {
                const data = correlatedData(rawEvent);
                if (!data) {
                    return;
                }
                settleError(data.error ?? `Memory operation ${payload.data.operationId} failed`);
            };
            const disconnectHandler = (rawEvent: unknown): void => {
                if (!rawEvent || typeof rawEvent !== 'object') {
                    return;
                }
                const event = rawEvent as {
                    agentId?: string;
                    channelId?: string;
                    data?: { agentId?: string; reason?: string };
                };
                const disconnectedAgentId = event.agentId ?? event.data?.agentId;
                if (
                    disconnectedAgentId !== callerAgentId ||
                    event.channelId !== payload.channelId
                ) {
                    return;
                }
                const reason = event.data?.reason ? `: ${event.data.reason}` : '';
                settleError(new Error(
                    `Memory operation ${payload.data.operationId} cancelled because agent ` +
                    `${callerAgentId} disconnected${reason}`
                ));
            };

            EventBus.client.on(resultEvent, resultHandler);
            EventBus.client.on(errorEvent, errorHandler);
            // Agent.DISCONNECT is what MxfService emits locally when this agent's
            // socket drops; Agent.DISCONNECTED is the server's announcement to the
            // other sockets and never reaches the agent that disconnected.
            EventBus.client.on(Events.Agent.DISCONNECT, disconnectHandler);
            unregisterPendingOperation = this.registerPendingOperation(
                callerAgentId,
                payload.channelId,
                reason => settleError(new Error(
                    `Memory operation ${payload.data.operationId} cancelled: ${reason}`
                ))
            );

            try {
                if (!EventBus.client.isRegisteredSocketConnected(callerAgentId)) {
                    throw new Error(
                        `Cannot start memory operation ${payload.data.operationId}: ` +
                        `agent socket '${callerAgentId}' is not connected`
                    );
                }
                EventBus.client.emitOn(callerAgentId, requestEvent, payload);
            } catch (error) {
                settleError(error);
            }

            return () => {
                settled = true;
                cleanup();
            };
        });
    }
    
    /**
     * Get agent memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @returns Observable of agent memory
     */
    public getAgentMemory = (callerAgentId: string, callerChannelId: string): Observable<IAgentMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        
        const operationId = this.generateOperationId();
        const payload = createMemoryGetEventPayload(
            Events.Memory.GET,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.AGENT, id: callerAgentId }
        );
        return this.requestMemoryOperation<IAgentMemory, MemoryGetResultEventData>(
            callerAgentId,
            Events.Memory.GET,
            Events.Memory.GET_RESULT,
            Events.Memory.GET_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Agent memory response did not contain memory');
                }
                return data.memory as IAgentMemory;
            }
        );
    };

    /**
     * Get channel memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetChannelId Target Channel ID
     * @returns Observable of channel memory
     */
    public getChannelMemory = (callerAgentId: string, callerChannelId: string, targetChannelId: string): Observable<IChannelMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetChannelId, 'Target Channel ID must be a non-empty string');
        
        const operationId = this.generateOperationId();
        const payload = createMemoryGetEventPayload(
            Events.Memory.GET,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.CHANNEL, id: targetChannelId }
        );
        return this.requestMemoryOperation<IChannelMemory, MemoryGetResultEventData>(
            callerAgentId,
            Events.Memory.GET,
            Events.Memory.GET_RESULT,
            Events.Memory.GET_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Channel memory response did not contain memory');
                }
                return data.memory as IChannelMemory;
            }
        );
    };

    /**
     * Get relationship memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Channel ID (optional for global relationships)
     * @returns Observable of relationship memory
     */
    public getRelationshipMemory = (callerAgentId: string, callerChannelId: string, agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId1, 'First Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId2, 'Second Agent ID must be a non-empty string');
        
        const operationId = this.generateOperationId();
        const relationshipId = [agentId1, agentId2].sort();
        relationshipId.push(channelId ?? callerChannelId);
        const payload = createMemoryGetEventPayload(
            Events.Memory.GET,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.RELATIONSHIP, id: relationshipId }
        );
        return this.requestMemoryOperation<IRelationshipMemory, MemoryGetResultEventData>(
            callerAgentId,
            Events.Memory.GET,
            Events.Memory.GET_RESULT,
            Events.Memory.GET_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Relationship memory response did not contain memory');
                }
                return data.memory as IRelationshipMemory;
            }
        );
    };

    /**
     * Update agent memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param memoryData Memory data to update
     * @returns Observable of updated agent memory
     */
    public updateAgentMemory = (
        callerAgentId: string,
        callerChannelId: string,
        memoryData: Partial<IAgentMemory>
    ): Observable<IAgentMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        const operationId = this.generateOperationId();
        const payload = createMemoryUpdateEventPayload(
            Events.Memory.UPDATE,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.AGENT, id: callerAgentId, data: memoryData }
        );
        return this.requestMemoryOperation<IAgentMemory, MemoryUpdateResultEventData>(
            callerAgentId,
            Events.Memory.UPDATE,
            Events.Memory.UPDATE_RESULT,
            Events.Memory.UPDATE_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Agent memory update response did not contain memory');
                }
                return data.memory as IAgentMemory;
            }
        );
    };

    /**
     * Update channel memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param targetChannelId Target Channel ID
     * @param memoryData Memory data to update
     * @returns Observable of updated channel memory
     */
    public updateChannelMemory = (
        callerAgentId: string,
        callerChannelId: string,
        targetChannelId: string,
        memoryData: Partial<IChannelMemory>
    ): Observable<IChannelMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(targetChannelId, 'Target Channel ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        const operationId = this.generateOperationId();
        const payload = createMemoryUpdateEventPayload(
            Events.Memory.UPDATE,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.CHANNEL, id: targetChannelId, data: memoryData }
        );
        return this.requestMemoryOperation<IChannelMemory, MemoryUpdateResultEventData>(
            callerAgentId,
            Events.Memory.UPDATE,
            Events.Memory.UPDATE_RESULT,
            Events.Memory.UPDATE_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Channel memory update response did not contain memory');
                }
                return data.memory as IChannelMemory;
            }
        );
    };

    /**
     * Atomically append a non-empty batch to the caller channel's message history.
     * The server returns the complete post-append history for this keyed operation.
     */
    public appendChannelMessages = (
        callerAgentId: string,
        callerChannelId: string,
        messages: unknown[]
    ): Observable<unknown[]> => {
        this.validator.assertIsNonEmptyString(
            callerAgentId,
            'Caller Agent ID must be a non-empty string'
        );
        this.validator.assertIsNonEmptyString(
            callerChannelId,
            'Caller Channel ID must be a non-empty string'
        );
        this.validator.assertIsArray(messages, 'Messages must be an array');
        if (messages.length === 0) {
            throw new Error('Messages must be a non-empty array');
        }

        const operationId = this.generateOperationId();
        const messagesMemoryKey = `channel:messages:${callerChannelId}`;
        const payload = createMemoryUpdateEventPayload(
            Events.Memory.UPDATE,
            callerAgentId,
            callerChannelId,
            {
                operationId,
                scope: MemoryScope.CHANNEL,
                id: messagesMemoryKey,
                data: { [messagesMemoryKey]: messages }
            }
        );

        return this.requestMemoryOperation<unknown[], MemoryUpdateResultEventData>(
            callerAgentId,
            Events.Memory.UPDATE,
            Events.Memory.UPDATE_RESULT,
            Events.Memory.UPDATE_ERROR,
            payload,
            data => {
                const memory = data.memory as unknown;
                if (!Array.isArray(memory)) {
                    throw new Error(
                        'Channel message append response did not contain the authoritative history'
                    );
                }
                return memory;
            }
        );
    };

    /**
     * Update relationship memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param r_agentId1 First agent ID
     * @param r_agentId2 Second agent ID
     * @param memoryData Memory data to update
     * @param r_channelId Channel ID (optional for global relationships)
     * @returns Observable of updated relationship memory
     */
    public updateRelationshipMemory = (
        callerAgentId: string,
        callerChannelId: string,
        r_agentId1: string,
        r_agentId2: string,
        memoryData: Partial<IRelationshipMemory>,
        r_channelId?: string
    ): Observable<IRelationshipMemory> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(r_agentId1, 'First Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(r_agentId2, 'Second Agent ID must be a non-empty string');
        this.validator.assertIsObject(memoryData, 'Memory data must be an object');

        const operationId = this.generateOperationId();
        const relationshipId = [r_agentId1, r_agentId2].sort();
        relationshipId.push(r_channelId ?? callerChannelId);
        const payload = createMemoryUpdateEventPayload(
            Events.Memory.UPDATE,
            callerAgentId,
            callerChannelId,
            { operationId, scope: MemoryScope.RELATIONSHIP, id: relationshipId, data: memoryData }
        );
        return this.requestMemoryOperation<IRelationshipMemory, MemoryUpdateResultEventData>(
            callerAgentId,
            Events.Memory.UPDATE,
            Events.Memory.UPDATE_RESULT,
            Events.Memory.UPDATE_ERROR,
            payload,
            data => {
                if (!data.memory) {
                    throw new Error('Relationship memory update response did not contain memory');
                }
                return data.memory as IRelationshipMemory;
            }
        );
    };
    
    /**
     * Delete memory
     * @param callerAgentId Caller Agent ID
     * @param callerChannelId Caller Channel ID
     * @param scope Memory scope
     * @param idToDelete ID or ID array to delete
     * @returns Observable of success status
     */
    public deleteMemory = (callerAgentId: string, callerChannelId: string, scope: MemoryScope, idToDelete: string | string[]): Observable<boolean> => {
        this.validator.assertIsNonEmptyString(callerAgentId, 'Caller Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(callerChannelId, 'Caller Channel ID must be a non-empty string');
        // Validate memory scope - we can't use validateMemoryScope directly
        this.validator.assertIsString(scope, `Memory scope must be a string`);
        if (!Object.values(MemoryScope).includes(scope as MemoryScope)) {
            throw new Error(`Invalid memory scope: ${scope}`);
        }
        // Validate idToDelete based on scope
        if (scope === MemoryScope.AGENT || scope === MemoryScope.CHANNEL) {
            this.validator.assertIsNonEmptyString(idToDelete as string, 'ID for agent/channel memory must be a non-empty string');
            if (scope === MemoryScope.AGENT && idToDelete !== callerAgentId) {
                throw new Error('Agent memory deletion is self-scoped; target ID must match caller');
            }
        } else if (scope === MemoryScope.RELATIONSHIP) {
            this.validator.assertIsArray(idToDelete, 'ID for relationship memory must be an array');
            // Further validation for array elements if needed
        }

        const operationId = this.generateOperationId();
        const payload = createMemoryDeleteEventPayload(
            Events.Memory.DELETE,
            callerAgentId,
            callerChannelId,
            { operationId, scope, id: idToDelete }
        );
        return this.requestMemoryOperation<boolean, MemoryDeleteResultEventData>(
            callerAgentId,
            Events.Memory.DELETE,
            Events.Memory.DELETE_RESULT,
            Events.Memory.DELETE_ERROR,
            payload,
            data => {
                if (data.success !== true) {
                    throw new Error('Memory deletion response did not confirm deletion');
                }
                return true;
            }
        );
    };
}
