import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import type { MemoryService } from '@mxf-dev/core/services/MemoryService';

/** Initialize configuration before deciding whether this process needs utility storage. */
export function initializeMemoryUtilityPersistence(
    memoryService: Pick<MemoryService, 'updateMemoryUtility' | 'readMemoryUtilityQValue'>
): boolean {
    const qValueManager = QValueManager.getInstance();
    // A cold singleton starts disabled until initialize applies its configuration.
    qValueManager.initialize();
    if (!qValueManager.isEnabled()) return false;

    qValueManager.setPersistenceCallback(
        (memoryId, utility) => memoryService.updateMemoryUtility(memoryId, utility),
        memoryId => memoryService.readMemoryUtilityQValue(memoryId)
    );
    return true;
}
