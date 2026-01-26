/**
 * ContainerPoolManager.ts
 *
 * @deprecated Use ContainerExecutionManager instead.
 * This file is kept for backwards compatibility.
 */

export { ContainerExecutionManager as ContainerPoolManager } from './ContainerExecutionManager';
export type {
    ContainerExecutionConfig as ContainerPoolConfig,
    ContainerExecutionRequest,
    ContainerExecutionResult
} from './ContainerExecutionManager';
