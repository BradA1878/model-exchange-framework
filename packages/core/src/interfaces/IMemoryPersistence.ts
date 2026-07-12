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
import { IAgentMemory, IChannelMemory } from '../types/MemoryTypes.js';
import { MemoryUtilitySubdocument } from '../types/MemoryUtilityTypes.js';

export interface IMemoryPersistence {
    /** Load an agent's memory document. */
    getAgentMemory(agentId: string): Observable<IAgentMemory>;

    /** Persist an agent's memory document. */
    saveAgentMemory(memory: IAgentMemory): Observable<IAgentMemory>;

    /** Persist a channel's memory document. */
    saveChannelMemory(memory: IChannelMemory): Observable<IChannelMemory>;

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
