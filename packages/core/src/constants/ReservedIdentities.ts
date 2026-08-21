/**
 * Identifiers used by MXF as internal routing sentinels.
 *
 * Agent and channel ids are also socket-routing coordinates. Letting an
 * external tenant claim one of these values would turn a framework-emitted
 * event into traffic for that tenant's socket. Comparisons are intentionally
 * case-insensitive so visually equivalent aliases cannot be persisted and
 * later confused with an internal principal.
 */

const RESERVED_AGENT_IDS = new Set([
    'system',
    'system_agent',
    'sdk_system_agent',
    'system-service',
    'mxf-server'
]);

const RESERVED_CHANNEL_IDS = new Set([
    'system',
    'no_channel',
    'global',
    'config_channel'
]);

const normalizeIdentity = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
};

/** Return true when an agent id is reserved for framework-originated work. */
export const isReservedAgentId = (value: unknown): boolean => {
    const normalized = normalizeIdentity(value);
    return normalized !== null && (
        RESERVED_AGENT_IDS.has(normalized) ||
        normalized.startsWith('system:')
    );
};

/** Return true when a channel id denotes a framework/global routing scope. */
export const isReservedChannelId = (value: unknown): boolean => {
    const normalized = normalizeIdentity(value);
    return normalized !== null && (
        RESERVED_CHANNEL_IDS.has(normalized) ||
        normalized.startsWith('system:')
    );
};
