import {
    isServerMxpEnabled,
    isTaskIntelligentAssignmentEnabled
} from '@mxf-dev/core/config/AgentExperimentConfig';

const settings = [
    { name: 'MXP_ENABLED', read: isServerMxpEnabled },
    { name: 'TASK_INTELLIGENT_ASSIGNMENT_ENABLED', read: isTaskIntelligentAssignmentEnabled }
];

describe.each(settings)('$name', ({ name, read }) => {
    let original: string | undefined;

    beforeEach(() => {
        original = process.env[name];
        delete process.env[name];
    });

    afterEach(() => {
        if (original === undefined) delete process.env[name];
        else process.env[name] = original;
    });

    it('preserves enabled behavior when unset', () => {
        expect(read()).toBe(true);
    });

    it.each(['true', 'false'])('accepts exact %s', value => {
        process.env[name] = value;
        expect(read()).toBe(value === 'true');
    });

    it.each(['', ' ', 'TRUE', 'False', ' true', 'false ', '1', '0', 'yes', 'no'])('rejects invalid %j', value => {
        process.env[name] = value;
        expect(read).toThrow(`${name} must be exactly "true" or "false"`);
    });
});
