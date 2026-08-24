/**
 * @mxf-dev/core — Model Exchange Framework core.
 *
 * Curated public surface. The full module tree is also addressable through
 * subpath exports (e.g. `@mxf-dev/core/utils/Logger`, `@mxf-dev/core/events/EventBus`).
 */
export { Events } from './events/EventNames.js';
export type { EventName } from './events/EventNames.js';
export { EventBus } from './events/EventBus.js';
export { Logger } from './utils/Logger.js';
export { ConfigManager } from './config/ConfigManager.js';
export {
    CORE_MXF_TOOLS,
    isCoreToolName,
} from './constants/CoreTools.js';
export type { CoreMxfTool } from './constants/CoreTools.js';
export {
    MemoryPersistenceLevel,
    MemoryScope,
} from './types/MemoryTypes.js';
export type {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryData,
} from './types/MemoryTypes.js';
export {
    DEFAULT_SERVER_CONFIG,
    getServerConfig,
    buildServerUrl,
} from './config/ServerConfig.js';
export type { ServerConfig } from './config/ServerConfig.js';
export {
    MAX_MEILISEARCH_MESSAGE_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_WIRE_BYTES,
    meilisearchContentBytes,
} from './config/MeilisearchIngressLimits.js';
