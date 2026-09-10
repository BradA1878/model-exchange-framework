import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import type { MemoryUtilitySubdocument } from '@mxf-dev/core/types/MemoryUtilityTypes';
import { initializeMemoryUtilityPersistence } from '../../../src/server/services/MemoryUtilityLifecycle';

describe('memory utility persistence on cold server startup', () => {
    const environmentKeys = ['MEMORY_UTILITY_LEARNING_ENABLED', 'QVALUE_DEFAULT', 'QVALUE_LEARNING_RATE'] as const;
    let originalInstance: PropertyDescriptor | undefined;
    let originalEnvironment: Map<string, string | undefined>;

    beforeEach(() => {
        // Do not initialize an existing test singleton: the regression occurs only
        // before the first initialization of the process's real manager.
        originalInstance = Object.getOwnPropertyDescriptor(QValueManager, 'instance');
        Reflect.deleteProperty(QValueManager, 'instance');
        originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
        process.env.MEMORY_UTILITY_LEARNING_ENABLED = 'true';
        process.env.QVALUE_DEFAULT = '0.5';
        process.env.QVALUE_LEARNING_RATE = '0.1';
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalInstance) {
            Object.defineProperty(QValueManager, 'instance', originalInstance);
        } else {
            Reflect.deleteProperty(QValueManager, 'instance');
        }
        for (const [key, value] of originalEnvironment) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it('applies enabled configuration before attaching the store and continues a persisted reward', async () => {
        const stored = new Map([['learned-memory', 0.8]]);
        const memoryService = {
            readMemoryUtilityQValue: jest.fn(async (memoryId: string) => stored.get(memoryId)),
            updateMemoryUtility: jest.fn(async (memoryId: string, utility: Partial<MemoryUtilitySubdocument>) => {
                if (utility.qValue === undefined) throw new Error('utility write must include a Q-value');
                stored.set(memoryId, utility.qValue);
            })
        };
        const manager = QValueManager.getInstance();
        expect(manager.isEnabled()).toBe(false);
        expect(manager.getConfig().enabled).toBe(true);

        expect(initializeMemoryUtilityPersistence(memoryService)).toBe(true);
        expect(manager.isEnabled()).toBe(true);
        expect(manager.isCached('learned-memory')).toBe(false);
        expect(await manager.updateQValue('learned-memory', 1)).toBeCloseTo(0.82);
        expect(memoryService.readMemoryUtilityQValue).toHaveBeenCalledWith('learned-memory');
        expect(memoryService.updateMemoryUtility).toHaveBeenCalledWith('learned-memory', expect.objectContaining({
            qValue: expect.closeTo(0.82)
        }));
        expect(stored.get('learned-memory')).toBeCloseTo(0.82);
    });

    it('leaves persistence detached when utility learning is disabled in the environment', async () => {
        process.env.MEMORY_UTILITY_LEARNING_ENABLED = 'false';
        const memoryService = {
            readMemoryUtilityQValue: jest.fn(async () => 0.8),
            updateMemoryUtility: jest.fn(async () => undefined)
        };
        const manager = QValueManager.getInstance();
        const registerPersistence = jest.spyOn(manager, 'setPersistenceCallback');
        expect(manager.isEnabled()).toBe(false);

        expect(initializeMemoryUtilityPersistence(memoryService)).toBe(false);
        expect(manager.isEnabled()).toBe(false);
        expect(registerPersistence).not.toHaveBeenCalled();
        expect(await manager.updateQValue('learned-memory', 1)).toBe(0.5);
        expect(memoryService.readMemoryUtilityQValue).not.toHaveBeenCalled();
        expect(memoryService.updateMemoryUtility).not.toHaveBeenCalled();
    });
});
