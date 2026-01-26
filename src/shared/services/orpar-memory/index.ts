/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * ORPAR-Memory Integration Module
 *
 * This module provides the unified cognitive-memory architecture that tightly
 * couples ORPAR phases with memory operations.
 *
 * ## Components
 *
 * - **OrparMemoryCoordinator**: Central orchestration service
 * - **PhaseStrataRouter**: Routes memory queries based on ORPAR phase
 * - **SurpriseOrparAdapter**: Converts surprise signals to ORPAR decisions
 * - **PhaseWeightedRewarder**: Attributes Q-value rewards by phase contribution
 * - **CycleConsolidationTrigger**: Triggers memory consolidation on cycle completion
 * - **PhaseMemoryOperations**: Unified phase-specific store/retrieve interface
 *
 * ## Feature Flag
 *
 * Enable with: `ORPAR_MEMORY_INTEGRATION_ENABLED=true`
 *
 * ## Usage
 *
 * ```typescript
 * import { OrparMemoryCoordinator } from './services/orpar-memory';
 *
 * // Get the coordinator instance
 * const coordinator = OrparMemoryCoordinator.getInstance();
 *
 * // Initialize (call once at startup)
 * coordinator.initialize();
 *
 * // Start a cycle
 * const cycleId = coordinator.startCycle(agentId, channelId, taskId);
 *
 * // Retrieve memories for current phase
 * const memories = await coordinator.retrieveMemories({
 *     query: 'relevant context',
 *     phase: 'reasoning',
 *     agentId,
 *     channelId
 * });
 *
 * // Process surprise detection
 * const decision = coordinator.processSurprise(cycleId, surpriseDetection);
 *
 * // Complete the cycle
 * await coordinator.completeCycle(cycleId, { success: true, ... });
 * ```
 */

// Main coordinator
export { OrparMemoryCoordinator } from './OrparMemoryCoordinator';

// Component services
export { PhaseStrataRouter } from './PhaseStrataRouter';
export { SurpriseOrparAdapter } from './SurpriseOrparAdapter';
export { PhaseWeightedRewarder } from './PhaseWeightedRewarder';
export { CycleConsolidationTrigger } from './CycleConsolidationTrigger';
export { PhaseMemoryOperations, PhaseStorageResult } from './PhaseMemoryOperations';
