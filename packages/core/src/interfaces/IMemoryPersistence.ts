/**
 * Memory persistence contract.
 *
 * MemoryService lives in @mxf-dev/core but the concrete persistence implementation
 * lives in the server (it owns the Mongoose connection). Core must not import from
 * src/**, so the server injects its implementation into MemoryService at boot.
 *
 * This interface is that injection point. It exists so the dependency is typed:
 * MemoryService previously held the persistence service as `any`, which allowed a
 * call to `updateAgentMemoryUtility?.()` — a method that was never implemented — to
 * compile and then silently no-op forever, discarding every learned Q-value. Typing
 * the contract turns that class of mistake into a compile error.
 */

import { Observable } from 'rxjs';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope
} from '../types/MemoryTypes.js';
import { MemoryUtilitySubdocument } from '../types/MemoryUtilityTypes.js';

/**
 * A mutation against one reserved field in a channel-memory document.
 *
 * Append mutations are deliberately expressed as database operations instead of
 * read/modify/write replacements. That lets the persistence adapter retain every
 * concurrently submitted batch with one atomic document update.
 */
export type ChannelMemoryAtomicMutation =
    | { kind: 'append_messages'; messages: unknown[] }
    | { kind: 'replace_context'; context: unknown; expectedUpdatedAt?: number }
    | { kind: 'append_context_history'; entries: unknown[]; retainLast: number }
    | { kind: 'delete_messages' }
    | { kind: 'delete_context' }
    | { kind: 'delete_context_history' };

export interface ChannelMemoryAtomicMutationResult {
    /** Whether the targeted channel/key existed for this operation. */
    found: boolean;
    /** The authoritative document after the mutation, or null for a missing delete target. */
    memory: IChannelMemory | null;
    /** The authoritative value of the reserved field after the mutation. */
    value: unknown;
}

export interface IMemoryPersistence {
    /** Load an agent's memory document. */
    getAgentMemory(agentId: string): Observable<IAgentMemory>;

    /** Persist an agent's memory document. */
    saveAgentMemory(memory: IAgentMemory): Observable<IAgentMemory>;

    /** Persist a channel's memory document. */
    saveChannelMemory(memory: IChannelMemory): Observable<IChannelMemory>;

    /** Load a channel's memory document. */
    getChannelMemory(channelId: string): Observable<IChannelMemory>;

    /**
     * Atomically mutate one reserved channel-memory field and return the
     * authoritative post-update document/value.
     */
    mutateChannelMemory(
        channelId: string,
        mutation: ChannelMemoryAtomicMutation
    ): Observable<ChannelMemoryAtomicMutationResult>;

    /** Load relationship memory using its full tenant identity. */
    getRelationshipMemory?(
        agentId1: string,
        agentId2: string,
        channelId: string
    ): Observable<IRelationshipMemory>;

    /** Persist relationship memory using its full tenant identity. */
    saveRelationshipMemory?(memory: IRelationshipMemory): Observable<IRelationshipMemory>;

    /** Delete one exact memory scope identity from persistent storage. */
    deleteMemory?(scope: MemoryScope, id: string | string[]): Observable<boolean>;

    /**
     * Persist the MULS utility subdocument for a single memory.
     *
     * Called by QValueManager's persistence callback whenever a Q-value changes, and
     * again when a dirty cache entry is evicted. Must throw on failure — a silent
     * failure here means the system reports learning it did not retain.
     */
    updateAgentMemoryUtility(
        memoryId: string,
        utility: Partial<MemoryUtilitySubdocument>
    ): Promise<void>;

    /**
     * Load utility subdocuments for a batch of memories.
     *
     * Used to hydrate the Q-value cache on retrieval so learning survives a restart.
     * Memories with no stored utility are simply absent from the returned map; the
     * caller falls back to the configured default Q-value for those.
     */
    getAgentMemoryUtilities(
        memoryIds: string[]
    ): Promise<Map<string, MemoryUtilitySubdocument>>;
}
