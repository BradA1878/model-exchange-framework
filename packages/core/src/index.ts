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
    DEFAULT_SERVER_CONFIG,
    getServerConfig,
    buildServerUrl,
} from './config/ServerConfig.js';
export type { ServerConfig } from './config/ServerConfig.js';
