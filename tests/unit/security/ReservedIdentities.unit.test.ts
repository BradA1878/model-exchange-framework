import {
    isReservedAgentId,
    isReservedChannelId
} from '@mxf-dev/core/constants/ReservedIdentities';

describe('reserved MXF routing identities', () => {
    it.each([
        'system',
        'SYSTEM',
        'SYSTEM_AGENT',
        'sdk_system_agent',
        'system-service',
        'system:workflow-engine',
        'system:inference-service',
        'mxf-server'
    ])('reserves internal agent id %s case-insensitively', (agentId) => {
        expect(isReservedAgentId(agentId)).toBe(true);
    });

    it.each([
        'system',
        'SYSTEM',
        'NO_CHANNEL',
        'global',
        'config_channel',
        'system:workflows',
        'system:inference'
    ])('reserves internal channel id %s case-insensitively', (channelId) => {
        expect(isReservedChannelId(channelId)).toBe(true);
    });

    it('does not reject ordinary identities merely containing the word system', () => {
        expect(isReservedAgentId('ecosystem-analyst')).toBe(false);
        expect(isReservedAgentId('mxf-planner')).toBe(false);
        expect(isReservedChannelId('design-system-review')).toBe(false);
    });
});
