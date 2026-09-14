/**
 * Server controls for experiments that supply their own messaging and assignment policy.
 * Read at startup for validation and by each consumer before enabling the feature.
 */

const readEnabledFlag = (name: string): boolean => {
    const value = process.env[name];
    if (value === undefined || value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    throw new Error(`${name} must be exactly "true" or "false"`);
};

/** Whether the server may detect, encode, or encrypt messages with MXP. */
export const isServerMxpEnabled = (): boolean => readEnabledFlag('MXP_ENABLED');

/** The server-wide ceiling for automatic and explicitly requested intelligent assignment. */
export const isTaskIntelligentAssignmentEnabled = (): boolean =>
    readEnabledFlag('TASK_INTELLIGENT_ASSIGNMENT_ENABLED');
