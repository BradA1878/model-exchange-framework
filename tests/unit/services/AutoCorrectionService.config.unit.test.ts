const patternSingleton = jest.fn();
jest.mock('@mxf-dev/core/services/PatternLearningService', (): object => ({
    PatternLearningService: { getInstance: patternSingleton }
}));
jest.mock('@mxf-dev/core/services/ValidationPerformanceService', (): object => ({
    ValidationPerformanceService: { getInstance: (): object => ({}) }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';

describe('AUTO_CORRECTION_ENABLED operator policy', () => {
    const previous = process.env.AUTO_CORRECTION_ENABLED;
    let service: AutoCorrectionService | undefined;
    beforeEach(() => { EventBus.reset(); jest.clearAllMocks(); });
    afterEach(() => {
        service?.shutdown();
        service = undefined;
        EventBus.reset();
        if (previous === undefined) delete process.env.AUTO_CORRECTION_ENABLED;
        else process.env.AUTO_CORRECTION_ENABLED = previous;
    });

    it.each([undefined, 'true', 'false'])('exposes the effective config for %s', (value) => {
        if (value === undefined) delete process.env.AUTO_CORRECTION_ENABLED;
        else process.env.AUTO_CORRECTION_ENABLED = value;
        service = AutoCorrectionService.getInstance();
        expect(service.getConfig().enabled).toBe(value !== 'false');
        expect(patternSingleton).not.toHaveBeenCalled();
    });

    it.each(['', '0', '1', 'TRUE', 'False', ' true ', 'no'])('fails before pattern startup for %j', (value) => {
        process.env.AUTO_CORRECTION_ENABLED = value;
        expect(() => AutoCorrectionService.getInstance()).toThrow('AUTO_CORRECTION_ENABLED must be true or false');
        expect(patternSingleton).not.toHaveBeenCalled();
    });

    it('prevents runtime re-enabling and returns without consulting pattern learning', async () => {
        process.env.AUTO_CORRECTION_ENABLED = 'false';
        service = AutoCorrectionService.getInstance();
        expect(() => service!.updateConfig({ enabled: true })).toThrow('prevents enabling');
        expect(service.getConfig().enabled).toBe(false);
        await expect(service.attemptCorrection('agent', 'channel', 'tool', {}, 'missing required field'))
            .resolves.toEqual({ corrected: false, shouldRetry: false });
        expect(patternSingleton).not.toHaveBeenCalled();
        expect(service.getCorrectionStats().totalAttempts).toBe(0);
    });

    it('retains runtime switching when the environment permits it and rejects non-booleans', () => {
        process.env.AUTO_CORRECTION_ENABLED = 'true';
        service = AutoCorrectionService.getInstance();
        service.updateConfig({ enabled: false });
        expect(service.getConfig().enabled).toBe(false);
        service.updateConfig({ enabled: true });
        expect(service.getConfig().enabled).toBe(true);
        expect(() => service!.updateConfig({ enabled: 'false' as unknown as boolean })).toThrow('must be a boolean');
    });
});
