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
 * Unified Memory Service Implementation
 * 
 * This service provides the core functionality for the MXF Memory System.
 * It handles different memory scopes (agent, channel, relationship) and
 * persistence levels (temporary, persistent).
 * 
 * CONSOLIDATED: Includes cognitive operations from AgentMemoryService
 * for LLM workflows (observations, reasoning, plans, reflections).
 */

import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import {
    ChannelMemoryAtomicMutation,
    ChannelMemoryAtomicMutationResult,
    IMemoryPersistence
} from '../interfaces/IMemoryPersistence.js';
import { MxfMeilisearchService } from './MxfMeilisearchService.js';
import { v4 as uuidv4 } from 'uuid';

import { 
    IAgentMemory, 
    IChannelMemory, 
    IRelationshipMemory,
    MemoryScope, 
    MemoryPersistenceLevel,
    createMemoryValidator
} from '../types/MemoryTypes.js';

// Cognitive operation types from control loop
import {
    Observation,
    Reasoning,
    Plan,
    Reflection
} from '../models/controlLoop.js';

import { Logger } from '../utils/Logger.js';
import { EventBus } from '../events/EventBus.js';
import { Events } from '../events/EventNames.js';
import { createBaseEventPayload, createMemoryUpdateResultEventPayload,
    createMemoryDeleteResultEventPayload,
    MemoryUpdateResultEventData,
    MemoryGetEventPayload,
    MemoryUpdateEventPayload,
    MemoryDeleteEventPayload,
    createMemoryGetResultEventPayload,
    MemoryGetResultEventData
} from '../schemas/EventPayloadSchema.js';
import { AgentId, ChannelId } from '../types/ChannelContext.js';
import {
    UtilityRetrievalOptions,
    RetrievedMemoryWithUtility,
    UtilityRetrievalResult,
    MemoryCandidate,
    OrparPhase,
    MemoryUtilitySubdocument
} from '../types/MemoryUtilityTypes.js';
import { QValueManager } from './QValueManager.js';
import { UtilityScorerService } from './UtilityScorerService.js';
import { RewardSignalProcessor } from './RewardSignalProcessor.js';
import {
    isKnowledgeGraphEnabled,
    isExtractionEnabled,
} from '../config/knowledge-graph.config.js';
import { EntityExtractionService } from './kg/EntityExtractionService.js';

/**
 * Types of cognitive memory content
 */
export enum CognitiveMemoryType {
    SHORT_TERM = 'short_term',     // Temporary observations and immediate context
    WORKING = 'working',           // Active reasoning and planning
    LONG_TERM = 'long_term'        // Persistent reflections and learned patterns
}

/**
 * Cognitive memory entry with metadata
 */
export interface CognitiveMemoryEntry<T> {
    id: string;
    agentId: AgentId;
    channelId: ChannelId;
    memoryType: CognitiveMemoryType;
    content: T;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    labels: string[];
    relevance?: number;
}

/**
 * Query options for cognitive memory
 */
export interface CognitiveMemoryQueryOptions {
    memoryTypes?: CognitiveMemoryType[];
    limit?: number;
    offset?: number;
    sortBy?: 'createdAt' | 'updatedAt' | 'relevance';
    sortDirection?: 'asc' | 'desc';
    labels?: string[];
    fromTimestamp?: number;
    toTimestamp?: number;
    textQuery?: string;
}

interface GeneralDataRecord {
    expiresAt?: number;
    [key: string]: unknown;
}

/**
 * Enhanced Agent Memory with cognitive operations
 */
export interface IEnhancedAgentMemory extends IAgentMemory {
    // Cognitive Memory References
    cognitiveMemory: {
        observationIds: string[];
        reasoningIds: string[];
        planIds: string[];
        reflectionIds: string[];
    };
}

/**
 * Enhanced Channel Memory with shared cognitive insights
 */
export interface IEnhancedChannelMemory extends IChannelMemory {
    // Channel activity tracking
    lastActivity?: number;
    messageCount?: number;
    participants?: string[];
    topics?: string[];
    summary?: string;
    
    // Shared Cognitive Insights
    sharedCognitiveInsights: {
        systemSummaries: string[];
        topicExtractions: string[];
        collaborativeReflections: string[];
    };
}

/**
 * Configuration options for Memory Service
 */
interface MemoryServiceConfig {
    enablePersistence?: boolean;
    cacheSize?: number;
    persistenceService?: IMemoryPersistence; // Optional persistence service (server-only, injected at boot)
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MemoryServiceConfig = {
    enablePersistence: true,
    cacheSize: 100
};

/**
 * Memory Service
 * 
 * Core service for managing the Memory System and handling in-memory cache.
 */
export class MemoryService {
    // Singleton instance
    private static instance: MemoryService;
    
    // Memory cache
    private agentMemory: Map<string, IEnhancedAgentMemory> = new Map();
    private channelMemory: Map<string, IEnhancedChannelMemory> = new Map();
    private relationshipMemory: Map<string, IRelationshipMemory> = new Map();
    private generalData: Map<string, unknown> = new Map();
    private cognitiveMemory: Map<string, CognitiveMemoryEntry<unknown>> = new Map();
    private agentMutationTails: Map<string, Promise<void>> = new Map();
    private channelMutationTails: Map<string, Promise<void>> = new Map();
    private relationshipMutationTails: Map<string, Promise<void>> = new Map();
    
    // Configuration
    private config: MemoryServiceConfig;

    // Optional persistence service (server-only)
    private persistenceService?: IMemoryPersistence;

    // Validator
    private validator = createMemoryValidator('MemoryService');
    
    // Logger
    private logger = new Logger('debug', 'MemoryService', "server");
    
    /**
     * Private constructor for singleton pattern
     * @param config Configuration options
     */
    private constructor(config: MemoryServiceConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.persistenceService = config.persistenceService;

        // Set up event listeners
        this.setupEventListeners();
    }
    
    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        // Return each request promise so EventBus.drain() retains ownership of
        // acknowledged memory work until persistence and the response event
        // have both completed.
        EventBus.server.on(
            Events.Memory.GET,
            (event: MemoryGetEventPayload): Promise<void> => this.handleMemoryGetRequest(event)
        );
        EventBus.server.on(
            Events.Memory.UPDATE,
            (event: MemoryUpdateEventPayload): Promise<void> => this.handleMemoryUpdateRequest(event)
        );
        EventBus.server.on(
            Events.Memory.DELETE,
            (event: MemoryDeleteEventPayload): Promise<void> => this.handleMemoryDeleteRequest(event)
        );
    }

    private validateMemoryRequestIdentity(
        event: MemoryGetEventPayload | MemoryUpdateEventPayload | MemoryDeleteEventPayload
    ): void {
        this.validator.assertIsNonEmptyString(event.agentId, 'Memory request agentId is required');
        this.validator.assertIsNonEmptyString(event.channelId, 'Memory request channelId is required');
        this.validator.assertIsNonEmptyString(event.data.operationId, 'Memory operationId is required');
        this.validator.validateMemoryScope(event.data.scope);
    }

    private requireScalarMemoryId(id: string | string[], scope: MemoryScope): string {
        if (Array.isArray(id)) {
            throw new Error(`${scope} memory requires a scalar ID`);
        }
        this.validator.assertIsNonEmptyString(id, `${scope} memory ID is required`);
        return id;
    }

    /**
     * Agent-scoped requests address the requesting agent's own memory. The
     * socket gateway checks this too; the service checks it again so no other
     * caller of the event bridge can read or change another agent's memory by
     * naming it.
     */
    private requireOwnAgentMemoryId(id: string | string[], requestingAgentId: AgentId): string {
        const agentId = this.requireScalarMemoryId(id, MemoryScope.AGENT);
        if (agentId !== requestingAgentId) {
            throw new Error('Agent memory requests are limited to the requesting agent');
        }
        return agentId;
    }

    /**
     * Channel-scoped requests address the request's own channel: either the
     * whole channel document (id equal to the request channel) or one of its
     * keyed sub-resources (`channel:...:<channelId>`, validated where the key
     * is resolved).
     */
    private requireOwnChannelMemoryId(id: string | string[], requestChannelId: ChannelId): string {
        const channelMemoryId = this.requireScalarMemoryId(id, MemoryScope.CHANNEL);
        if (!channelMemoryId.startsWith('channel:') && channelMemoryId !== requestChannelId) {
            throw new Error('Channel memory requests are limited to the request channel');
        }
        return channelMemoryId;
    }

    /**
     * Relationship-scoped requests must come from one of the two agents in
     * the relationship, and the channel component must match the request.
     */
    private requireRelationshipMemoryId(
        id: string | string[],
        channelId: ChannelId,
        requestingAgentId: AgentId
    ): [string, string, string] {
        if (!Array.isArray(id) || (id.length !== 2 && id.length !== 3)) {
            throw new Error('Relationship memory requires two agent IDs and an optional channel ID');
        }
        id.forEach((part, index) => {
            this.validator.assertIsNonEmptyString(part, `Relationship memory ID part ${index} is required`);
        });
        if (id.length === 3 && id[2] !== channelId) {
            throw new Error('Relationship memory channel must match the request channel');
        }
        if (id[0] !== requestingAgentId && id[1] !== requestingAgentId) {
            throw new Error('Relationship memory requests are limited to a participant of the relationship');
        }
        return [id[0], id[1], channelId];
    }

    private ownsPathOrDescendant(value: unknown, reservedPath: string): boolean {
        if (!value || typeof value !== 'object') {
            return false;
        }
        return Object.keys(value).some(key =>
            key === reservedPath || key.startsWith(`${reservedPath}.`)
        );
    }

    private getChannelMemoryKey(
        key: string,
        expectedChannelId?: ChannelId
    ): { channelId: string; kind: 'messages' | 'context' | 'history' } {
        const prefixes = [
            { prefix: 'channel:context:history:', kind: 'history' as const },
            { prefix: 'channel:messages:', kind: 'messages' as const },
            { prefix: 'channel:context:', kind: 'context' as const }
        ];
        const matched = prefixes.find(({ prefix }) => key.startsWith(prefix));
        if (!matched) {
            throw new Error(`Unsupported channel memory key: ${key}`);
        }
        const channelId = key.slice(matched.prefix.length);
        this.validator.assertIsNonEmptyString(channelId, 'Channel memory key channelId is required');
        if (expectedChannelId && channelId !== expectedChannelId) {
            throw new Error('Channel memory key must match the request channel');
        }
        return { channelId, kind: matched.kind };
    }

    private async getKeyedChannelMemory(
        key: string,
        requestChannelId: ChannelId
    ): Promise<MemoryGetResultEventData['memory']> {
        const { channelId, kind } = this.getChannelMemoryKey(key, requestChannelId);
        if (!this.persistenceService && this.generalData.has(key)) {
            return this.generalData.get(key) as MemoryGetResultEventData['memory'];
        }

        const channelMemory = this.persistenceService
            ? await firstValueFrom(this.persistenceService.getChannelMemory(channelId))
            : await firstValueFrom(this.getChannelMemory(channelId));
        const value = kind === 'messages'
            ? channelMemory.conversationHistory
            : kind === 'context'
                ? channelMemory.sharedState?.context
                : channelMemory.customData?.contextHistory;
        const cachedMemory = this.channelMemory.get(channelId);
        this.channelMemory.set(channelId, {
            ...channelMemory,
            sharedCognitiveInsights: cachedMemory?.sharedCognitiveInsights ?? {
                systemSummaries: [],
                topicExtractions: [],
                collaborativeReflections: []
            }
        });
        if (value !== undefined) {
            this.generalData.set(key, value);
        } else {
            this.generalData.delete(key);
        }
        return (value as MemoryGetResultEventData['memory']) ?? null;
    }

    private serializeChannelMutation<T>(
        channelId: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const previousTail = this.channelMutationTails.get(channelId) ?? Promise.resolve();
        const result = previousTail.then(operation);
        const nextTail = result.then(() => undefined, () => undefined);
        this.channelMutationTails.set(channelId, nextTail);

        return result.finally(() => {
            if (this.channelMutationTails.get(channelId) === nextTail) {
                this.channelMutationTails.delete(channelId);
            }
        });
    }

    private serializeAgentMutation<T>(
        agentId: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const previousTail = this.agentMutationTails.get(agentId) ?? Promise.resolve();
        const result = previousTail.then(operation);
        const nextTail = result.then(() => undefined, () => undefined);
        this.agentMutationTails.set(agentId, nextTail);

        return result.finally(() => {
            if (this.agentMutationTails.get(agentId) === nextTail) {
                this.agentMutationTails.delete(agentId);
            }
        });
    }

    private serializeRelationshipMutation<T>(
        agentId1: string,
        agentId2: string,
        channelId: string,
        operation: () => Promise<T>
    ): Promise<T> {
        const relationshipKey = this.getRelationshipKey(agentId1, agentId2, channelId);
        const previousTail = this.relationshipMutationTails.get(relationshipKey) ?? Promise.resolve();
        const result = previousTail.then(operation);
        const nextTail = result.then(() => undefined, () => undefined);
        this.relationshipMutationTails.set(relationshipKey, nextTail);

        return result.finally(() => {
            if (this.relationshipMutationTails.get(relationshipKey) === nextTail) {
                this.relationshipMutationTails.delete(relationshipKey);
            }
        });
    }

    private getAtomicMutation(
        kind: 'messages' | 'context' | 'history',
        value: unknown,
        expectedContextUpdatedAt?: number
    ): ChannelMemoryAtomicMutation {
        switch (kind) {
            case 'messages':
                if (!Array.isArray(value) || value.length === 0) {
                    throw new Error('Keyed channel message updates require a non-empty array');
                }
                return { kind: 'append_messages', messages: value };
            case 'context':
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error('Keyed channel context updates require an object');
                }
                return {
                    kind: 'replace_context',
                    context: value,
                    expectedUpdatedAt: expectedContextUpdatedAt
                };
            case 'history':
                if (!Array.isArray(value) || value.length === 0) {
                    throw new Error('Keyed channel history updates require a non-empty array');
                }
                return { kind: 'append_context_history', entries: value, retainLast: 100 };
        }
    }

    private getDeleteMutation(
        kind: 'messages' | 'context' | 'history'
    ): ChannelMemoryAtomicMutation {
        switch (kind) {
            case 'messages':
                return { kind: 'delete_messages' };
            case 'context':
                return { kind: 'delete_context' };
            case 'history':
                return { kind: 'delete_context_history' };
        }
    }

    private async mutateLocalChannelMemory(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Promise<ChannelMemoryAtomicMutationResult> {
        const deleting = mutation.kind.startsWith('delete_');
        const existingMemory = this.channelMemory.get(channelId);
        if (deleting && !existingMemory) {
            return { found: false, memory: null, value: null };
        }
        const originalMemory = existingMemory ?? await firstValueFrom(this.getChannelMemory(channelId));
        if (mutation.kind === 'replace_context') {
            const existingContext = originalMemory.sharedState?.context as
                | { updatedAt?: unknown }
                | undefined;
            const actualUpdatedAt = existingContext?.updatedAt;
            const versionMatches = mutation.expectedUpdatedAt === undefined
                ? existingContext === undefined
                : actualUpdatedAt === mutation.expectedUpdatedAt;
            if (!versionMatches) {
                return { found: false, memory: originalMemory, value: existingContext ?? null };
            }
        }
        const targetExists = mutation.kind === 'delete_messages'
            ? originalMemory.conversationHistory !== undefined
            : mutation.kind === 'delete_context'
                ? Object.prototype.hasOwnProperty.call(originalMemory.sharedState ?? {}, 'context')
                : mutation.kind === 'delete_context_history'
                    ? Object.prototype.hasOwnProperty.call(
                        originalMemory.customData ?? {},
                        'contextHistory'
                    )
                    : true;
        if (!targetExists) {
            return { found: false, memory: originalMemory, value: null };
        }
        let updatedMemory: IEnhancedChannelMemory;
        let value: unknown;

        switch (mutation.kind) {
            case 'append_messages':
                value = [...(originalMemory.conversationHistory ?? []), ...mutation.messages];
                updatedMemory = { ...originalMemory, conversationHistory: value as unknown[] };
                break;
            case 'replace_context':
                value = mutation.context;
                updatedMemory = {
                    ...originalMemory,
                    sharedState: { ...originalMemory.sharedState, context: value }
                };
                break;
            case 'append_context_history':
                value = [
                    ...((originalMemory.customData?.contextHistory as unknown[] | undefined) ?? []),
                    ...mutation.entries
                ].slice(-mutation.retainLast);
                updatedMemory = {
                    ...originalMemory,
                    customData: { ...originalMemory.customData, contextHistory: value }
                };
                break;
            case 'delete_messages':
                value = [];
                updatedMemory = { ...originalMemory, conversationHistory: [] };
                break;
            case 'delete_context': {
                const sharedState = { ...originalMemory.sharedState };
                delete sharedState.context;
                value = null;
                updatedMemory = { ...originalMemory, sharedState };
                break;
            }
            case 'delete_context_history': {
                const customData = { ...originalMemory.customData };
                delete customData.contextHistory;
                value = null;
                updatedMemory = { ...originalMemory, customData };
                break;
            }
        }

        updatedMemory.updatedAt = new Date();
        this.channelMemory.set(channelId, updatedMemory);
        return { found: true, memory: updatedMemory, value };
    }

    private async executeKeyedChannelMutation(
        key: string,
        requestChannelId: ChannelId | undefined,
        mutation: ChannelMemoryAtomicMutation
    ): Promise<ChannelMemoryAtomicMutationResult> {
        const { channelId } = this.getChannelMemoryKey(key, requestChannelId);
        return this.serializeChannelMutation(channelId, async () => {
            const result = this.persistenceService
                ? await firstValueFrom(
                    this.persistenceService.mutateChannelMemory(channelId, mutation)
                )
                : await this.mutateLocalChannelMemory(channelId, mutation);

            if (result.memory) {
                const cachedMemory = this.channelMemory.get(channelId);
                this.channelMemory.set(channelId, {
                    ...result.memory,
                    sharedCognitiveInsights: cachedMemory?.sharedCognitiveInsights ?? {
                        systemSummaries: [],
                        topicExtractions: [],
                        collaborativeReflections: []
                    }
                });
            }
            if (result.found) {
                this.generalData.set(key, result.value);
            } else {
                this.generalData.delete(key);
            }
            return result;
        });
    }

    private async updateKeyedChannelMemory(
        key: string,
        value: unknown,
        requestChannelId: ChannelId,
        expectedContextUpdatedAt?: number
    ): Promise<MemoryUpdateResultEventData['memory']> {
        const { kind } = this.getChannelMemoryKey(key, requestChannelId);
        const result = await this.executeKeyedChannelMutation(
            key,
            requestChannelId,
            this.getAtomicMutation(kind, value, expectedContextUpdatedAt)
        );
        if (!result.found) {
            throw new Error(`Channel context changed concurrently while updating ${key}`);
        }
        return result.value as MemoryUpdateResultEventData['memory'];
    }

    private async deleteKeyedChannelMemory(key: string): Promise<boolean> {
        const { kind } = this.getChannelMemoryKey(key);
        const result = await this.executeKeyedChannelMutation(
            key,
            undefined,
            this.getDeleteMutation(kind)
        );
        if (result.found) {
            this.generalData.delete(key);
        }
        return result.found;
    }

    private async handleMemoryGetRequest(event: MemoryGetEventPayload): Promise<void> {
        let responseId: string | string[] = event.data.id;
        try {
            this.validateMemoryRequestIdentity(event);
            let memory: MemoryGetResultEventData['memory'];

            switch (event.data.scope) {
                case MemoryScope.AGENT: {
                    const agentId = this.requireOwnAgentMemoryId(event.data.id, event.agentId);
                    responseId = agentId;
                    memory = await firstValueFrom(this.getAgentMemory(agentId));
                    break;
                }
                case MemoryScope.CHANNEL: {
                    const channelMemoryId = this.requireOwnChannelMemoryId(
                        event.data.key ?? event.data.id,
                        event.channelId
                    );
                    responseId = channelMemoryId;
                    memory = channelMemoryId.startsWith('channel:')
                        ? await this.getKeyedChannelMemory(channelMemoryId, event.channelId)
                        : await firstValueFrom(this.getChannelMemory(channelMemoryId));
                    break;
                }
                case MemoryScope.RELATIONSHIP: {
                    const [agentId1, agentId2, channelId] = this.requireRelationshipMemoryId(
                        event.data.id,
                        event.channelId,
                        event.agentId
                    );
                    responseId = [agentId1, agentId2, channelId];
                    memory = await firstValueFrom(
                        this.getRelationshipMemory(agentId1, agentId2, channelId)
                    );
                    break;
                }
            }

            EventBus.server.emit(
                Events.Memory.GET_RESULT,
                createMemoryGetResultEventPayload(
                    Events.Memory.GET_RESULT,
                    event.agentId,
                    event.channelId,
                    {
                        operationId: event.data.operationId,
                        scope: event.data.scope,
                        id: responseId,
                        memory
                    }
                )
            );
        } catch (error) {
            this.emitMemoryGetError(event, responseId, error);
        }
    }

    private async handleMemoryUpdateRequest(event: MemoryUpdateEventPayload): Promise<void> {
        let responseId: string | string[] = event.data.id;
        try {
            this.validateMemoryRequestIdentity(event);
            this.validator.assertIsObject(event.data.data, 'Memory update data is required');
            let memory: MemoryUpdateResultEventData['memory'];

            switch (event.data.scope) {
                case MemoryScope.AGENT: {
                    const agentId = this.requireOwnAgentMemoryId(event.data.id, event.agentId);
                    responseId = agentId;
                    memory = await firstValueFrom(this.updateAgentMemory(agentId, event.data.data));
                    break;
                }
                case MemoryScope.CHANNEL: {
                    const channelMemoryId = this.requireOwnChannelMemoryId(
                        event.data.id,
                        event.channelId
                    );
                    responseId = channelMemoryId;
                    const embeddedMemoryKeys = Object.keys(event.data.data)
                        .filter(key => key.startsWith('channel:'));
                    const keyedMemoryId = channelMemoryId.startsWith('channel:')
                        ? channelMemoryId
                        : embeddedMemoryKeys.length === 1
                            ? embeddedMemoryKeys[0]
                            : undefined;
                    if (keyedMemoryId) {
                        responseId = keyedMemoryId;
                        const nestedValue = event.data.data[keyedMemoryId];
                        const value = nestedValue === undefined ? event.data.data : nestedValue;
                        const expectedContextUpdatedAt =
                            event.data.metadata?.expectedContextUpdatedAt;
                        if (
                            expectedContextUpdatedAt !== undefined &&
                            (
                                typeof expectedContextUpdatedAt !== 'number' ||
                                !Number.isFinite(expectedContextUpdatedAt) ||
                                expectedContextUpdatedAt < 0
                            )
                        ) {
                            throw new Error(
                                'Memory update expectedContextUpdatedAt must be a non-negative number'
                            );
                        }
                        memory = await this.updateKeyedChannelMemory(
                            keyedMemoryId,
                            value,
                            event.channelId,
                            expectedContextUpdatedAt
                        );
                    } else {
                        memory = await firstValueFrom(
                            this.updateChannelMemory(channelMemoryId, event.data.data)
                        );
                    }
                    break;
                }
                case MemoryScope.RELATIONSHIP: {
                    const [agentId1, agentId2, channelId] = this.requireRelationshipMemoryId(
                        event.data.id,
                        event.channelId,
                        event.agentId
                    );
                    responseId = [agentId1, agentId2, channelId];
                    memory = await firstValueFrom(
                        this.updateRelationshipMemory(agentId1, agentId2, channelId, event.data.data)
                    );
                    break;
                }
            }

            EventBus.server.emit(
                Events.Memory.UPDATE_RESULT,
                createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    event.agentId,
                    event.channelId,
                    {
                        operationId: event.data.operationId,
                        scope: event.data.scope,
                        id: responseId,
                        memory
                    }
                )
            );
        } catch (error) {
            this.emitMemoryUpdateError(event, responseId, error);
        }
    }

    private async handleMemoryDeleteRequest(event: MemoryDeleteEventPayload): Promise<void> {
        let responseId: string | string[] = event.data.id;
        try {
            this.validateMemoryRequestIdentity(event);
            if (event.data.scope === MemoryScope.RELATIONSHIP) {
                responseId = this.requireRelationshipMemoryId(
                    event.data.id,
                    event.channelId,
                    event.agentId
                );
            } else if (event.data.scope === MemoryScope.AGENT) {
                responseId = this.requireOwnAgentMemoryId(event.data.id, event.agentId);
            } else {
                responseId = this.requireOwnChannelMemoryId(event.data.id, event.channelId);
                if (responseId.startsWith('channel:')) {
                    this.getChannelMemoryKey(responseId, event.channelId);
                }
            }

            const success = await firstValueFrom(
                this.deleteMemory(event.data.scope, responseId)
            );
            EventBus.server.emit(
                Events.Memory.DELETE_RESULT,
                createMemoryDeleteResultEventPayload(
                    Events.Memory.DELETE_RESULT,
                    event.agentId,
                    event.channelId,
                    {
                        operationId: event.data.operationId,
                        scope: event.data.scope,
                        id: responseId,
                        success
                    }
                )
            );
        } catch (error) {
            this.emitMemoryDeleteError(event, responseId, error);
        }
    }

    private emitMemoryGetError(
        event: MemoryGetEventPayload,
        id: string | string[],
        error: unknown
    ): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Memory GET failed: ${message}`);
        EventBus.server.emit(
            Events.Memory.GET_RESULT,
            createMemoryGetResultEventPayload(
                Events.Memory.GET_RESULT,
                event.agentId,
                event.channelId,
                {
                    operationId: event.data.operationId,
                    scope: event.data.scope,
                    id,
                    memory: null,
                    error: message
                }
            )
        );
    }

    private emitMemoryUpdateError(
        event: MemoryUpdateEventPayload,
        id: string | string[],
        error: unknown
    ): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Memory UPDATE failed: ${message}`);
        EventBus.server.emit(
            Events.Memory.UPDATE_RESULT,
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                event.agentId,
                event.channelId,
                {
                    operationId: event.data.operationId,
                    scope: event.data.scope,
                    id,
                    memory: null,
                    error: message
                }
            )
        );
    }

    private emitMemoryDeleteError(
        event: MemoryDeleteEventPayload,
        id: string | string[],
        error: unknown
    ): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Memory DELETE failed: ${message}`);
        EventBus.server.emit(
            Events.Memory.DELETE_RESULT,
            createMemoryDeleteResultEventPayload(
                Events.Memory.DELETE_RESULT,
                event.agentId,
                event.channelId,
                {
                    operationId: event.data.operationId,
                    scope: event.data.scope,
                    id,
                    success: false,
                    error: message
                }
            )
        );
    }
    
    /**
     * Get the singleton instance
     * @param config Configuration options
     * @returns The memory service instance
     */
    public static getInstance(config?: MemoryServiceConfig): MemoryService {
        if (!MemoryService.instance) {
            MemoryService.instance = new MemoryService(config);
        } else if (config?.persistenceService && !MemoryService.instance.persistenceService) {
            // Upgrade existing instance with persistence service (for server initialization)
            MemoryService.instance.persistenceService = config.persistenceService;
            MemoryService.instance.logger.info('Memory Service upgraded with MongoDB persistence');
        }
        return MemoryService.instance;
    }
    
    /**
     * Get agent memory
     * @param agentId Agent ID
     * @returns Observable of agent memory
     */
    public getAgentMemory(agentId: string): Observable<IEnhancedAgentMemory> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');

        // Return existing memory from cache if available (fast path)
        const existingMemory = this.agentMemory.get(agentId);
        if (existingMemory) {
            return of(existingMemory);
        }

        // If persistence service is available, try loading from MongoDB
        const persistence = this.persistenceService;
        if (persistence) {
            return new Observable<IEnhancedAgentMemory>(observer => {
                persistence.getAgentMemory(agentId).subscribe({
                    next: (loadedMemory: IAgentMemory) => {
                        // Enhance the loaded memory with cognitive memory structure
                        const loadedCognitiveMemory = (
                            loadedMemory as Partial<IEnhancedAgentMemory>
                        ).cognitiveMemory;
                        const enhancedMemory: IEnhancedAgentMemory = {
                            ...loadedMemory,
                            cognitiveMemory: loadedCognitiveMemory ?? {
                                observationIds: [],
                                reasoningIds: [],
                                planIds: [],
                                reflectionIds: []
                            }
                        };

                        // Cache the loaded memory
                        this.agentMemory.set(agentId, enhancedMemory);


                        observer.next(enhancedMemory);
                        observer.complete();
                    },
                    error: (error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        this.logger.error(`Failed to load agent memory from MongoDB for ${agentId}: ${message}`);
                        observer.error(error);
                    }
                });
            });
        }

        // No persistence service - create new memory
        const newMemory = this.createNewAgentMemory(agentId);
        return of(newMemory);
    }

    /**
     * Create new agent memory
     * @param agentId Agent ID
     * @returns New agent memory
     */
    private createNewAgentMemory(agentId: string): IEnhancedAgentMemory {
        const newMemory: IEnhancedAgentMemory = {
            id: uuidv4(),
            agentId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            conversationHistory: [],
            customData: {},
            cognitiveMemory: {
                observationIds: [],
                reasoningIds: [],
                planIds: [],
                reflectionIds: []
            }
        };

        this.agentMemory.set(agentId, newMemory);

        return newMemory;
    }
    
    /**
     * Update agent memory
     *
     * @param pAgentId Agent ID
     * @param updates Memory updates
     * @returns Observable of updated agent memory
     */
    public updateAgentMemory(
        pAgentId: string,
        updates: Partial<IEnhancedAgentMemory>
    ): Observable<IEnhancedAgentMemory> {
        this.validator.assertIsNonEmptyString(pAgentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsObject(updates, 'Updates must be an object');

        return new Observable<IEnhancedAgentMemory>(observer => {
            let cancelled = false;
            void (async (): Promise<void> => {
                try {
                    const enhancedStoredMemory = await this.serializeAgentMutation(
                        pAgentId,
                        async (): Promise<IEnhancedAgentMemory> => {
                            const originalAgentMemory = await firstValueFrom(
                                this.getAgentMemory(pAgentId)
                            );
                            const updatedMemory: IEnhancedAgentMemory = {
                                ...originalAgentMemory,
                                ...updates,
                                updatedAt: new Date(),
                                id: originalAgentMemory.id,
                                agentId: originalAgentMemory.agentId,
                                createdAt: originalAgentMemory.createdAt,
                                notes: updates.notes
                                    ? { ...originalAgentMemory.notes, ...updates.notes }
                                    : originalAgentMemory.notes,
                                customData: updates.customData
                                    ? { ...originalAgentMemory.customData, ...updates.customData }
                                    : originalAgentMemory.customData,
                                cognitiveMemory: updates.cognitiveMemory
                                    ? {
                                        ...originalAgentMemory.cognitiveMemory,
                                        ...updates.cognitiveMemory
                                    }
                                    : originalAgentMemory.cognitiveMemory
                            };

                            const storedMemory = this.persistenceService
                                ? await firstValueFrom(
                                    this.persistenceService.saveAgentMemory(updatedMemory)
                                )
                                : updatedMemory;
                            const enhancedMemory: IEnhancedAgentMemory = {
                                ...storedMemory,
                                cognitiveMemory: updatedMemory.cognitiveMemory
                            };
                            this.agentMemory.set(pAgentId, enhancedMemory);
                            return enhancedMemory;
                        }
                    );

                    if (updates.conversationHistory && updates.conversationHistory.length > 0) {
                        const contentToExtract = updates.conversationHistory
                            .slice(-3)
                            .filter((message): message is typeof message & { content: string } =>
                                typeof message.content === 'string' && message.content.length > 0)
                            .map(message => message.content)
                            .join('\n\n');
                        if (contentToExtract.length > 0) {
                            const channelContext = `agent-memory-${pAgentId}`;
                            const memoryId = `agent-${pAgentId}-${Date.now()}`;
                            this.triggerEntityExtraction(channelContext, memoryId, contentToExtract)
                                .catch(error => this.logger.warn(
                                    `Entity extraction failed: ${error instanceof Error ? error.message : String(error)}`
                                ));
                        }
                    }

                    if (!cancelled) {
                        observer.next(enhancedStoredMemory);
                        observer.complete();
                    }
                } catch (error) {
                    if (!cancelled) {
                        observer.error(error);
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }
    
    /**
     * Channel-scoped validation for cognitive operations
     * @param agentId Agent ID
     * @param channelId Channel ID
     */
    private validateCognitiveAccess(agentId: AgentId, channelId: ChannelId): void {
        const agentMemory = this.agentMemory.get(agentId);
        if (!agentMemory) {
            throw new Error(`Agent ${agentId} not found in memory`);
        }
        // Note: Agent memory doesn't currently store channelId, but in the unified architecture it should
        // For now, we'll validate that the agent exists and the channel is provided
        if (!channelId) {
            throw new Error(`Channel ID required for cognitive operations`);
        }
    }
    
    /**
     * Store an observation in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param observation The observation to store
     * @returns Observable of observation ID
     */
    public storeObservation(agentId: AgentId, channelId: ChannelId, observation: Observation): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(observation, 'Observation must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const observationId = `obs-${uuidv4()}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Observation> = {
            id: observationId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.SHORT_TERM,
            content: {
                ...observation,
                id: observationId,
                agentId,
                timestamp: observation.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['observation'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(observationId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || []), observationId],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(observationId);
    }
    
    /**
     * Get recent observations for an agent
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param limit Maximum number of observations to retrieve
     * @returns Observable of observations
     */
    public getRecentObservations(agentId: AgentId, channelId: ChannelId, limit: number = 10): Observable<Observation[]> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const agentMemory = this.agentMemory.get(agentId);
        if (!agentMemory) {
            return of([]);
        }
        
        // Get observations from cognitive memory
        const observations: Observation[] = agentMemory.cognitiveMemory.observationIds
            .map(id => this.cognitiveMemory.get(id))
            .filter(entry => entry && entry.channelId === channelId)
            .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0))
            .slice(0, limit)
            .map(entry => entry!.content)
            .filter(obs => obs) as Observation[];
        
        return of(observations);
    }
    
    /**
     * Store reasoning in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param reasoning The reasoning to store
     * @returns Observable of reasoning ID
     */
    public storeReasoning(agentId: AgentId, channelId: ChannelId, reasoning: Reasoning): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(reasoning, 'Reasoning must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const reasoningId = `reason-${uuidv4()}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Reasoning> = {
            id: reasoningId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.WORKING,
            content: {
                ...reasoning,
                id: reasoningId,
                agentId,
                timestamp: reasoning.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['reasoning'],
            relevance: reasoning.confidence || 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(reasoningId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || []), reasoningId],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(reasoningId);
    }
    
    /**
     * Store a plan in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param plan The plan to store
     * @returns Observable of plan ID
     */
    public storePlan(agentId: AgentId, channelId: ChannelId, plan: Plan): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(plan, 'Plan must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const planId = `plan-${uuidv4()}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Plan> = {
            id: planId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.WORKING,
            content: {
                ...plan,
                id: planId,
                agentId,
                timestamp: plan.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['plan'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(planId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.planIds || []), planId],
                reflectionIds: this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []
            }
        }).subscribe();
        
        // ;
        
        return of(planId);
    }
    
    /**
     * Update a plan in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param plan The updated plan
     * @returns Observable of success status
     */
    public updatePlan(agentId: AgentId, channelId: ChannelId, plan: Plan): Observable<boolean> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(plan, 'Plan must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const existingEntry = this.cognitiveMemory.get(plan.id);
        if (!existingEntry || existingEntry.agentId !== agentId || existingEntry.channelId !== channelId) {
            return of(false);
        }
        
        // Update cognitive memory entry
        const updatedEntry: CognitiveMemoryEntry<Plan> = {
            ...existingEntry,
            content: {
                ...plan,
                timestamp: plan.timestamp || Date.now()
            },
            updatedAt: Date.now()
        };
        
        this.cognitiveMemory.set(plan.id, updatedEntry);
        
        // ;
        
        return of(true);
    }
    
    /**
     * Store a reflection in cognitive memory
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param reflection The reflection to store
     * @returns Observable of reflection ID
     */
    public storeReflection(agentId: AgentId, channelId: ChannelId, reflection: Reflection): Observable<string> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(reflection, 'Reflection must be an object');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        const reflectionId = `reflect-${uuidv4()}`;
        
        // Create cognitive memory entry
        const cognitiveEntry: CognitiveMemoryEntry<Reflection> = {
            id: reflectionId,
            agentId,
            channelId,
            memoryType: CognitiveMemoryType.LONG_TERM,
            content: {
                ...reflection,
                id: reflectionId,
                agentId,
                timestamp: reflection.timestamp || Date.now()
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            labels: ['reflection'],
            relevance: 1.0
        };
        
        // Store in cognitive memory
        this.cognitiveMemory.set(reflectionId, cognitiveEntry);
        
        // Update agent memory references
        this.updateAgentMemory(agentId, {
            cognitiveMemory: {
                observationIds: this.agentMemory.get(agentId)?.cognitiveMemory.observationIds || [],
                reasoningIds: this.agentMemory.get(agentId)?.cognitiveMemory.reasoningIds || [],
                planIds: this.agentMemory.get(agentId)?.cognitiveMemory.planIds || [],
                reflectionIds: [...(this.agentMemory.get(agentId)?.cognitiveMemory.reflectionIds || []), reflectionId]
            }
        }).subscribe();
        
        // ;
        
        return of(reflectionId);
    }
    
    /**
     * Query cognitive memory with filtering options
     * @param agentId Agent ID
     * @param channelId Channel ID for privacy enforcement
     * @param options Query options
     * @returns Observable of cognitive memory entries
     */
    public queryCognitiveMemory(agentId: AgentId, channelId: ChannelId, options: CognitiveMemoryQueryOptions = {}): Observable<CognitiveMemoryEntry<unknown>[]> {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        
        this.validateCognitiveAccess(agentId, channelId);
        
        // Get all cognitive memory entries for this agent and channel
        const entries = Array.from(this.cognitiveMemory.values())
            .filter(entry => entry.agentId === agentId && entry.channelId === channelId);
        
        // Apply filters
        let filteredEntries = entries;
        
        if (options.memoryTypes && options.memoryTypes.length > 0) {
            filteredEntries = filteredEntries.filter(entry => options.memoryTypes!.includes(entry.memoryType));
        }
        
        if (options.labels && options.labels.length > 0) {
            filteredEntries = filteredEntries.filter(entry => 
                options.labels!.some(label => entry.labels.includes(label))
            );
        }
        
        if (options.fromTimestamp) {
            filteredEntries = filteredEntries.filter(entry => entry.createdAt >= options.fromTimestamp!);
        }
        
        if (options.toTimestamp) {
            filteredEntries = filteredEntries.filter(entry => entry.createdAt <= options.toTimestamp!);
        }
        
        // Sort results
        const sortBy = options.sortBy || 'createdAt';
        const sortDirection = options.sortDirection || 'desc';
        filteredEntries.sort((a, b) => {
            const aVal = a[sortBy] || 0;
            const bVal = b[sortBy] || 0;
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
        
        // Apply pagination
        const offset = options.offset || 0;
        const limit = options.limit || 50;
        filteredEntries = filteredEntries.slice(offset, offset + limit);
        
        return of(filteredEntries);
    }
    
    /**
     * Get channel memory
     * @param channelId Channel ID
     * @returns Observable of channel memory
     */
    public getChannelMemory(channelId: string): Observable<IEnhancedChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');

        const existingMemory = this.channelMemory.get(channelId);
        if (existingMemory) {
            return of(existingMemory);
        }

        const getPersistedChannelMemory = this.persistenceService?.getChannelMemory;
        if (this.persistenceService && !getPersistedChannelMemory) {
            return throwError(() => new Error('Channel memory persistence is not available'));
        }
        if (getPersistedChannelMemory) {
            return new Observable<IEnhancedChannelMemory>(observer => {
                getPersistedChannelMemory.call(this.persistenceService, channelId).subscribe({
                    next: (loadedMemory: IChannelMemory) => {
                        const enhancedMemory: IEnhancedChannelMemory = {
                            ...loadedMemory,
                            sharedCognitiveInsights: {
                                systemSummaries: [],
                                topicExtractions: [],
                                collaborativeReflections: []
                            }
                        };
                        this.channelMemory.set(channelId, enhancedMemory);
                        observer.next(enhancedMemory);
                        observer.complete();
                    },
                    error: (error: unknown) => observer.error(error)
                });
            });
        }

        const newMemory: IEnhancedChannelMemory = {
            id: uuidv4(),
            channelId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            sharedState: {},
            conversationHistory: [],
            customData: {},
            lastActivity: undefined,
            messageCount: undefined,
            participants: undefined,
            topics: undefined,
            summary: undefined,
            sharedCognitiveInsights: {
                systemSummaries: [],
                topicExtractions: [],
                collaborativeReflections: []
            }
        };
        this.channelMemory.set(channelId, newMemory);
        return of(newMemory);
    }
    
    /**
     * Update channel memory
     * @param channelId Channel ID
     * @param updates Channel memory updates
     * @returns Observable of updated channel memory
     */
    public updateChannelMemory(channelId: ChannelId, updates: Partial<IEnhancedChannelMemory>): Observable<IEnhancedChannelMemory> {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(updates, 'Channel memory updates must be an object');
        if (
            this.ownsPathOrDescendant(updates, 'conversationHistory') ||
            this.ownsPathOrDescendant(updates, 'sharedState.context') ||
            this.ownsPathOrDescendant(updates, 'customData.contextHistory') ||
            this.ownsPathOrDescendant(updates.sharedState, 'context') ||
            this.ownsPathOrDescendant(updates.customData, 'contextHistory')
        ) {
            throw new Error(
                'Reserved channel memory fields must use the atomic keyed-memory operations'
            );
        }

        return new Observable<IEnhancedChannelMemory>(observer => {
            let cancelled = false;
            void (async (): Promise<void> => {
                try {
                    const enhancedStoredMemory = await this.serializeChannelMutation(
                        channelId,
                        async (): Promise<IEnhancedChannelMemory> => {
                            const originalMemory = await firstValueFrom(this.getChannelMemory(channelId));
                            const updatedMemory: IEnhancedChannelMemory = {
                                ...originalMemory,
                                ...updates,
                                id: originalMemory.id,
                                channelId,
                                createdAt: originalMemory.createdAt,
                                updatedAt: new Date(),
                                notes: updates.notes
                                    ? { ...originalMemory.notes, ...updates.notes }
                                    : originalMemory.notes,
                                sharedState: updates.sharedState
                                    ? { ...originalMemory.sharedState, ...updates.sharedState }
                                    : originalMemory.sharedState,
                                customData: updates.customData
                                    ? { ...originalMemory.customData, ...updates.customData }
                                    : originalMemory.customData,
                                participants: updates.participants
                                    ? [...new Set([...(originalMemory.participants ?? []), ...updates.participants])]
                                    : originalMemory.participants,
                                topics: updates.topics
                                    ? [...new Set([...(originalMemory.topics ?? []), ...updates.topics])]
                                    : originalMemory.topics,
                                conversationHistory: updates.conversationHistory
                                    ? [
                                        ...(originalMemory.conversationHistory ?? []),
                                        ...updates.conversationHistory
                                    ]
                                    : originalMemory.conversationHistory,
                                sharedCognitiveInsights: {
                                    ...originalMemory.sharedCognitiveInsights,
                                    ...updates.sharedCognitiveInsights
                                }
                            };

                            const storedMemory = this.persistenceService
                                ? await firstValueFrom(this.persistenceService.saveChannelMemory(updatedMemory))
                                : updatedMemory;
                            const enhancedMemory: IEnhancedChannelMemory = {
                                ...storedMemory,
                                sharedCognitiveInsights: updatedMemory.sharedCognitiveInsights
                            };
                            this.channelMemory.set(channelId, enhancedMemory);
                            return enhancedMemory;
                        }
                    );
                    if (!cancelled) {
                        observer.next(enhancedStoredMemory);
                        observer.complete();
                    }
                } catch (error) {
                    if (!cancelled) {
                        observer.error(error);
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }
    
    /**
     * Get relationship memory
     * @param agentId1 First agent ID
     * @param agentId2 Second agent ID
     * @param channelId Optional channel ID
     * @returns Observable of relationship memory
     */
    public getRelationshipMemory(agentId1: string, agentId2: string, channelId?: string): Observable<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(agentId1, 'First agent ID must be a non-empty string');
        this.validator.assertIsNonEmptyString(agentId2, 'Second agent ID must be a non-empty string');
        
        // Sort agent IDs for consistent key generation
        const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
        
        // Create a composite key
        const relationshipKey = channelId 
            ? `${sortedId1}:${sortedId2}:${channelId}`
            : `${sortedId1}:${sortedId2}`;
        
        // Return existing memory if available
        const existingMemory = this.relationshipMemory.get(relationshipKey);
        if (existingMemory) {
            return of(existingMemory);
        }
        
        const getPersistedRelationshipMemory = this.persistenceService?.getRelationshipMemory;
        if (this.persistenceService && !getPersistedRelationshipMemory) {
            return throwError(() => new Error('Relationship memory persistence is not available'));
        }
        if (channelId && getPersistedRelationshipMemory) {
            return new Observable<IRelationshipMemory>(observer => {
                getPersistedRelationshipMemory.call(
                    this.persistenceService,
                    sortedId1,
                    sortedId2,
                    channelId
                ).subscribe({
                    next: (loadedMemory: IRelationshipMemory) => {
                        this.relationshipMemory.set(relationshipKey, loadedMemory);
                        observer.next(loadedMemory);
                        observer.complete();
                    },
                    error: (error: unknown) => observer.error(error)
                });
            });
        }

        const newMemory: IRelationshipMemory = {
            id: uuidv4(),
            agentId1: sortedId1,
            agentId2: sortedId2,
            channelId,
            createdAt: new Date(),
            updatedAt: new Date(),
            persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
            notes: {},
            interactionHistory: [],
            customData: {}
        };
        this.relationshipMemory.set(relationshipKey, newMemory);
        return of(newMemory);
    }
    
    /**
     * Update relationship memory
     * @param pAgentId1 Agent ID 1
     * @param pAgentId2 Agent ID 2
     * @param pChannelId Channel ID (optional, for context)
     * @param updates Memory updates
     * @returns Observable of updated relationship memory
     */
    public updateRelationshipMemory(pAgentId1: string, pAgentId2: string, pChannelId: string, updates: Partial<IRelationshipMemory>): Observable<IRelationshipMemory> {
        this.validator.assertIsNonEmptyString(pAgentId1, 'Agent ID 1 must be a non-empty string');
        this.validator.assertIsNonEmptyString(pAgentId2, 'Agent ID 2 must be a non-empty string');
        this.validator.assertIsNonEmptyString(pChannelId, 'Channel ID must be a non-empty string');
        this.validator.assertIsObject(updates, 'Updates must be an object');
        
        const relationshipKey = this.getRelationshipKey(pAgentId1, pAgentId2, pChannelId);
        
        return new Observable<IRelationshipMemory>(observer => {
            let cancelled = false;
            void (async (): Promise<void> => {
                try {
                    const storedMemory = await this.serializeRelationshipMutation(
                        pAgentId1,
                        pAgentId2,
                        pChannelId,
                        async (): Promise<IRelationshipMemory> => {
                            const originalMemory = await firstValueFrom(
                                this.getRelationshipMemory(pAgentId1, pAgentId2, pChannelId)
                            );
                            const updatedMemory: IRelationshipMemory = {
                                ...originalMemory,
                                ...updates,
                                id: originalMemory.id,
                                agentId1: originalMemory.agentId1,
                                agentId2: originalMemory.agentId2,
                                channelId: originalMemory.channelId,
                                createdAt: originalMemory.createdAt,
                                updatedAt: new Date(),
                                notes: updates.notes
                                    ? { ...originalMemory.notes, ...updates.notes }
                                    : originalMemory.notes,
                                customData: updates.customData
                                    ? { ...originalMemory.customData, ...updates.customData }
                                    : originalMemory.customData
                            };
                            const saveRelationshipMemory = this.persistenceService?.saveRelationshipMemory;
                            if (this.persistenceService && !saveRelationshipMemory) {
                                throw new Error('Relationship memory persistence is not available');
                            }
                            const persistedMemory = saveRelationshipMemory
                                ? await firstValueFrom(saveRelationshipMemory.call(
                                    this.persistenceService,
                                    updatedMemory
                                ))
                                : updatedMemory;
                            this.relationshipMemory.set(relationshipKey, persistedMemory);
                            return persistedMemory;
                        }
                    );
                    if (!cancelled) {
                        observer.next(storedMemory);
                        observer.complete();
                    }
                } catch (error) {
                    if (!cancelled) {
                        observer.error(error);
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }
    
    /**
     * Delete memory by scope and ID
     * @param scope Memory scope
     * @param id Entity ID or relationship composite ID
     * @returns Observable of success status
     */
    public deleteMemory(scope: MemoryScope, id: string | string[]): Observable<boolean> {
        this.validator.validateMemoryScope(scope);
        if (scope === MemoryScope.RELATIONSHIP) {
            if (!Array.isArray(id) || id.length !== 3) {
                throw new Error('Relationship memory deletion requires agentId1, agentId2, and channelId');
            }
            id.forEach((part, index) => {
                this.validator.assertIsNonEmptyString(part, `Relationship delete ID part ${index}`);
            });
        } else {
            this.validator.assertIsNonEmptyString(id, 'Memory ID must be a non-empty string');
        }

        return new Observable<boolean>(observer => {
            let cancelled = false;
            void (async (): Promise<void> => {
                try {
                    if (
                        scope === MemoryScope.CHANNEL &&
                        typeof id === 'string' &&
                        id.startsWith('channel:')
                    ) {
                        const success = await this.deleteKeyedChannelMemory(id);
                        if (!cancelled) {
                            observer.next(success);
                            observer.complete();
                        }
                        return;
                    }
                    const deleteAuthoritatively = async (): Promise<boolean> => {
                        const deletePersistentMemory = this.persistenceService?.deleteMemory;
                        if (this.persistenceService && !deletePersistentMemory) {
                            throw new Error('Memory deletion persistence is not available');
                        }
                        const persisted = deletePersistentMemory
                            ? await firstValueFrom(deletePersistentMemory.call(
                                this.persistenceService,
                                scope,
                                id
                            ))
                            : false;
                        if (this.persistenceService && !persisted) {
                            return false;
                        }
                        let cached = false;

                        switch (scope) {
                            case MemoryScope.AGENT: {
                                const agentId = id as string;
                                cached = this.agentMemory.delete(agentId);
                                for (const [key, memory] of this.relationshipMemory.entries()) {
                                    if (memory.agentId1 === agentId || memory.agentId2 === agentId) {
                                        cached = this.relationshipMemory.delete(key) || cached;
                                    }
                                }
                                for (const [key, memory] of this.cognitiveMemory.entries()) {
                                    if (memory.agentId === agentId) {
                                        cached = this.cognitiveMemory.delete(key) || cached;
                                    }
                                }
                                break;
                            }
                            case MemoryScope.CHANNEL: {
                                const channelId = id as string;
                                cached = this.channelMemory.has(channelId);
                                cached = this.channelMemory.delete(channelId) || cached;
                                for (const key of this.generalData.keys()) {
                                    if (key.endsWith(`:${channelId}`)) {
                                        cached = this.generalData.delete(key) || cached;
                                    }
                                }
                                break;
                            }
                            case MemoryScope.RELATIONSHIP: {
                                const [agentId1, agentId2, channelId] = id as string[];
                                cached = this.relationshipMemory.delete(
                                    this.getRelationshipKey(agentId1, agentId2, channelId)
                                );
                                break;
                            }
                        }

                        return this.persistenceService ? persisted : cached;
                    };

                    let deleted: boolean;
                    switch (scope) {
                        case MemoryScope.AGENT:
                            deleted = await this.serializeAgentMutation(
                                id as string,
                                deleteAuthoritatively
                            );
                            break;
                        case MemoryScope.CHANNEL:
                            deleted = await this.serializeChannelMutation(
                                id as string,
                                deleteAuthoritatively
                            );
                            break;
                        case MemoryScope.RELATIONSHIP: {
                            const [agentId1, agentId2, channelId] = id as string[];
                            deleted = await this.serializeRelationshipMutation(
                                agentId1,
                                agentId2,
                                channelId,
                                deleteAuthoritatively
                            );
                            break;
                        }
                    }

                    if (!cancelled) {
                        observer.next(deleted);
                        observer.complete();
                    }
                } catch (error) {
                    if (!cancelled) {
                        observer.error(error);
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }
    
    /**
     * Clear all memory of a specific scope
     * @param scope Memory scope
     * @returns Observable of success status
     */
    public clearMemory(scope: MemoryScope): Observable<boolean> {
        this.validator.validateMemoryScope(scope);
        
        switch (scope) {
            case MemoryScope.AGENT:
                this.agentMemory.clear();
                break;
            case MemoryScope.CHANNEL:
                this.channelMemory.clear();
                break;
            case MemoryScope.RELATIONSHIP:
                this.relationshipMemory.clear();
                break;
        }
        
        // Emit clear event through EventBus
        EventBus.server.emit(Events.Memory.CLEAR_RESULT, {
            scope,
            timestamp: Date.now()
        });
        
        return of(true);
    }
    
    /**
     * Clear all memory
     * @returns Observable of success status
     */
    public clearAllMemory(): Observable<boolean> {
        this.agentMemory.clear();
        this.channelMemory.clear();
        this.relationshipMemory.clear();
        this.generalData.clear();
        this.cognitiveMemory.clear();

        // Emit clear all event through EventBus
        EventBus.server.emit(Events.Memory.CLEAR_ALL_RESULT, {
            timestamp: Date.now()
        });

        return of(true);
    }

    /**
     * Get general key-value data
     * Used for tool-level key-value storage
     */
    public getGeneralData<T = GeneralDataRecord>(key: string): T | undefined {
        return this.generalData.get(key) as T | undefined;
    }

    /**
     * Set general key-value data
     * Used for tool-level key-value storage
     */
    public setGeneralData(key: string, value: unknown): void {
        this.generalData.set(key, value);
    }

    /**
     * Delete general key-value data
     */
    public deleteGeneralData(key: string): boolean {
        return this.generalData.delete(key);
    }

    // =========================================================================
    // Memory Utility Learning System (MULS) Methods
    // =========================================================================

    /**
     * Retrieve memories with utility-based scoring (MULS)
     *
     * Two-Phase Retrieval:
     * Phase A: Query semantic search → filter by similarity threshold → take top k1
     * Phase B: Fetch Q-values → z-score normalize → composite score → return top k2
     *
     * @param options Retrieval options including query, phase, and filters
     * @returns Retrieved memories with utility scoring information
     */
    public async retrieveWithUtility(options: UtilityRetrievalOptions): Promise<UtilityRetrievalResult> {
        const startTime = Date.now();
        const qValueManager = QValueManager.getInstance();
        const utilityScorer = UtilityScorerService.getInstance();

        // If MULS is disabled, return empty result
        if (!qValueManager.isEnabled()) {
            return {
                memories: [],
                metadata: {
                    query: options.query,
                    phase: options.phase,
                    lambda: 0,
                    totalCandidates: 0,
                    semanticSearchTimeMs: 0,
                    utilityScoringTimeMs: 0,
                    totalTimeMs: Date.now() - startTime
                }
            };
        }

        const semanticSearchStart = Date.now();

        // Phase A: semantic search over the real memory index.
        //
        // Meilisearch is the only retrieval path agents actually use, so utility scoring
        // has to sit on top of it to influence anything. (This previously searched an
        // in-process cognitiveMemory Map with keyword counting, which nothing populated
        // in production — so the whole two-phase retrieval could never return a result.)
        const meilisearch = MxfMeilisearchService.getInstance();
        const maxCandidates = options.maxCandidates ?? 20;
        const similarityThreshold = options.similarityThreshold ?? 0.3;

        const filters: string[] = [];
        if (options.agentId) {
            filters.push(`agentId = "${options.agentId}"`);
        }
        if (options.channelId) {
            filters.push(`channelId = "${options.channelId}"`);
        }

        const searchResult = await meilisearch.searchConversations({
            query: options.query,
            filter: filters.length > 0 ? filters.join(' AND ') : undefined,
            limit: maxCandidates,
            hybridRatio: options.hybridRatio ?? 0.7
        });

        const semanticSearchTimeMs = Date.now() - semanticSearchStart;

        const candidates: MemoryCandidate[] = [];

        for (const hit of searchResult.hits) {
            // Meilisearch ranking scores are already normalised to 0..1.
            const similarity = hit._rankingScore;
            if (similarity < similarityThreshold) {
                continue;
            }

            candidates.push({
                memoryId: hit.id,
                similarity,
                qValue: qValueManager.getQValue(hit.id),
                content: hit.content,
                metadata: {
                    memoryType: hit.role,
                    createdAt: new Date(hit.timestamp)
                }
            });
        }

        // Load Q-values learned in previous runs before scoring, otherwise every memory
        // this process has not seen yet would score at the default and ranking would
        // silently ignore everything the system has learned.
        await this.hydrateQValues(candidates.map(c => c.memoryId));
        for (const candidate of candidates) {
            candidate.qValue = qValueManager.getQValue(candidate.memoryId);
        }

        const topCandidates = candidates;

        // Phase B: Utility scoring
        const utilityScoringStart = Date.now();

        const scoringResult = options.phase
            ? utilityScorer.scoreForPhase(options.query, topCandidates, options.phase)
            : utilityScorer.scoreMemories(options.query, topCandidates, {
                lambda: options.lambda,
                maxResults: options.maxResults,
                includeBreakdown: options.includeBreakdown
            });

        const utilityScoringTimeMs = Date.now() - utilityScoringStart;

        // Build result
        const memories: RetrievedMemoryWithUtility[] = scoringResult.memories.map(scored => ({
            memoryId: scored.memoryId,
            content: scored.content,
            score: scored.finalScore,
            breakdown: scored.breakdown,
            metadata: scored.metadata
        }));

        // Emit retrieval event
        this.emitUtilityRetrievalEvent(options, memories, scoringResult.stats.lambdaUsed, {
            semanticSearchTimeMs,
            utilityScoringTimeMs,
            totalCandidates: candidates.length
        });

        return {
            memories,
            metadata: {
                query: options.query,
                phase: options.phase,
                lambda: scoringResult.stats.lambdaUsed,
                totalCandidates: candidates.length,
                semanticSearchTimeMs,
                utilityScoringTimeMs,
                totalTimeMs: Date.now() - startTime
            }
        };
    }

    /**
     * Track memory usage for reward attribution
     *
     * @param taskId The task ID to track usage for
     * @param memoryIds The memory IDs that were retrieved
     * @param phase The ORPAR phase when retrieval occurred
     */
    public trackMemoryUsage(taskId: string, memoryIds: string[], phase: OrparPhase): void {
        const rewardProcessor = RewardSignalProcessor.getInstance();

        if (!rewardProcessor.isEnabled()) {
            return;
        }

        rewardProcessor.trackMemoriesUsage(taskId, memoryIds, phase);
        this.logger.debug(`[MemoryService] Tracked ${memoryIds.length} memories for task ${taskId} (phase=${phase})`);
    }

    /**
     * Persist the utility subdocument for a memory.
     *
     * Registered as QValueManager's persistence callback at server boot, so this runs
     * on every Q-value change and on dirty-cache eviction. It must throw on failure:
     * swallowing the error here is what previously made the whole learning system look
     * like it worked while retaining nothing across a restart.
     */
    public async updateMemoryUtility(memoryId: string, utilityUpdate: Partial<MemoryUtilitySubdocument>): Promise<void> {
        if (!this.persistenceService) {
            throw new Error(
                `[MemoryService] Cannot persist utility for memory ${memoryId}: no persistence service is configured. ` +
                `MULS requires the server to inject a persistence service at boot.`
            );
        }

        await this.persistenceService.updateAgentMemoryUtility(memoryId, utilityUpdate);
    }

    /**
     * Load stored Q-values for a batch of memories into the QValueManager cache.
     *
     * Called before utility scoring so that ranking uses values learned in previous
     * runs rather than the default for every memory the current process has not seen.
     * Memories with no stored utility keep the configured default.
     */
    public async hydrateQValues(memoryIds: string[]): Promise<void> {
        if (!this.persistenceService || memoryIds.length === 0) {
            return;
        }

        const qValueManager = QValueManager.getInstance();
        const uncached = memoryIds.filter(id => !qValueManager.isCached(id));
        if (uncached.length === 0) {
            return;
        }

        const utilities = await this.persistenceService.getAgentMemoryUtilities(uncached);
        for (const [memoryId, utility] of utilities) {
            qValueManager.setQValueInCache(memoryId, utility.qValue);
        }

        this.logger.debug(
            `[MemoryService] Hydrated ${utilities.size}/${uncached.length} Q-values from persistence`
        );
    }

    /**
     * Trigger entity extraction from memory content
     *
     * Called when memory is stored or promoted to extract entities and relationships
     * for the Knowledge Graph. Only processes if Knowledge Graph is enabled and
     * entity extraction is enabled.
     *
     * @param channelId - The channel context for the extracted entities
     * @param memoryId - The memory ID being processed
     * @param content - The text content to extract entities from
     */
    public async triggerEntityExtraction(
        channelId: ChannelId,
        memoryId: string,
        content: string
    ): Promise<void> {
        // Check if Knowledge Graph and extraction are enabled
        if (!isKnowledgeGraphEnabled() || !isExtractionEnabled()) {
            return;
        }

        // Skip if content is too short or empty
        if (!content || content.trim().length < 20) {
            return;
        }

        try {
            const extractionService = EntityExtractionService.getInstance();
            const result = await extractionService.processMemory(channelId, memoryId, content);

            if (result.entitiesExtracted > 0 || result.relationshipsExtracted > 0) {
                this.logger.debug(
                    `[MemoryService] Extracted ${result.entitiesExtracted} entities and ` +
                    `${result.relationshipsExtracted} relationships from memory ${memoryId}`
                );
            }
        } catch (error: unknown) {
            this.logger.warn(
                `[MemoryService] Entity extraction failed for memory ${memoryId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Emit utility retrieval completed event
     */
    private emitUtilityRetrievalEvent(
        options: UtilityRetrievalOptions,
        memories: RetrievedMemoryWithUtility[],
        lambda: number,
        timing: { semanticSearchTimeMs: number; utilityScoringTimeMs: number; totalCandidates: number }
    ): void {
        try {
            EventBus.server.emit(Events.MemoryUtility.UTILITY_RETRIEVAL_COMPLETED, createBaseEventPayload(
                Events.MemoryUtility.UTILITY_RETRIEVAL_COMPLETED,
                options.agentId ?? 'system',
                options.channelId ?? 'global',
                {
                    query: options.query,
                    phase: options.phase,
                    lambda,
                    totalCandidates: timing.totalCandidates,
                    resultsReturned: memories.length,
                    semanticSearchTimeMs: timing.semanticSearchTimeMs,
                    utilityScoringTimeMs: timing.utilityScoringTimeMs,
                    totalTimeMs: timing.semanticSearchTimeMs + timing.utilityScoringTimeMs,
                    memoryIds: memories.map(m => m.memoryId),
                    agentId: options.agentId,
                    channelId: options.channelId
                }
            ));
        } catch (error) {
            // EventBus may not be available in all contexts
            this.logger.debug(`[MemoryService] Could not emit utility retrieval event: ${error}`);
        }
    }

    private getRelationshipKey(agentId1: string, agentId2: string, channelId?: string): string {
        const [sortedId1, sortedId2] = [agentId1, agentId2].sort();
        return channelId ? `${sortedId1}:${sortedId2}:${channelId}` : `${sortedId1}:${sortedId2}`;
    }

    /**
     * Compare two data objects to determine if they are equal
     * Uses deep comparison for objects and arrays
     */
    private isDataEqual(data1: unknown, data2: unknown): boolean {
        // Handle null/undefined cases
        if (data1 === data2) return true;
        if (data1 == null || data2 == null) return false;
        
        // Handle primitive types
        if (typeof data1 !== 'object' || typeof data2 !== 'object') {
            return data1 === data2;
        }
        
        // Handle arrays
        if (Array.isArray(data1) && Array.isArray(data2)) {
            if (data1.length !== data2.length) return false;
            return data1.every((item, index) => this.isDataEqual(item, data2[index]));
        }
        
        // Handle objects
        if (Array.isArray(data1) || Array.isArray(data2)) return false;
        
        const record1 = data1 as Record<string, unknown>;
        const record2 = data2 as Record<string, unknown>;
        const keys1 = Object.keys(record1);
        const keys2 = Object.keys(record2);
        
        if (keys1.length !== keys2.length) return false;
        
        return keys1.every(key => 
            keys2.includes(key) && this.isDataEqual(record1[key], record2[key])
        );
    }
}
