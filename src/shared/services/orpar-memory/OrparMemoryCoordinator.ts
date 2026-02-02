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
 * OrparMemoryCoordinator
 *
 * Central orchestration service that connects ORPAR phases with memory operations.
 * This is the main entry point for the ORPAR-Memory integration layer.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                 OrparMemoryCoordinator                          │
 * │  Central orchestration service connecting ORPAR and memory      │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                  │
 * │  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
 * │  │ PhaseStrataRouter│  │SurpriseOrpar     │  │PhaseWeighted  │  │
 * │  │                  │  │Adapter           │  │Rewarder       │  │
 * │  │ Maps phases to   │  │                  │  │               │  │
 * │  │ preferred strata │  │ Surprise→ORPAR   │  │ Phase-based   │  │
 * │  │ for retrieval    │  │ decisions        │  │ Q-value       │  │
 * │  └──────────────────┘  └──────────────────┘  └───────────────┘  │
 * │                                                                  │
 * │  ┌──────────────────┐  ┌──────────────────┐                     │
 * │  │CycleConsolidation│  │PhaseMemory       │                     │
 * │  │Trigger           │  │Operations        │                     │
 * │  │                  │  │                  │                     │
 * │  │ ORPAR completion │  │ Unified store/   │                     │
 * │  │ → memory promote │  │ retrieve per     │                     │
 * │  └──────────────────┘  │ phase            │                     │
 * │                        └──────────────────┘                     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { Events, ControlLoopEvents } from '../../events/EventNames';
import { OrparEvents } from '../../events/event-definitions/OrparEvents';
import { SurpriseDetection } from '../../types/MemoryStrataTypes';
import { OrparPhase, MemoryUsageRecord } from '../../types/MemoryUtilityTypes';
import {
    OrparMemoryIntegrationConfig,
    OrparCycleState,
    CycleMemoryUsage,
    CycleOutcome,
    SurpriseOrparDecision,
    PhaseStrataRetrievalResult,
    PhaseRetrievalOptions,
    PhaseStorageOptions
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    resetOrparMemoryConfig,
    updateOrparMemoryConfig
} from '../../config/orpar-memory.config';
import {
    createOrparMemoryCycleStartedPayload,
    createOrparMemoryPhaseChangedPayload,
    createOrparMemoryCycleCompletedPayload
} from '../../schemas/EventPayloadSchema';
import { PhaseStrataRouter } from './PhaseStrataRouter';
import { SurpriseOrparAdapter } from './SurpriseOrparAdapter';
import { PhaseWeightedRewarder } from './PhaseWeightedRewarder';
import { CycleConsolidationTrigger } from './CycleConsolidationTrigger';
import { PhaseMemoryOperations, PhaseStorageResult } from './PhaseMemoryOperations';
import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * OrparMemoryCoordinator is the central orchestration service for ORPAR-Memory integration
 */
export class OrparMemoryCoordinator {
    private static instance: OrparMemoryCoordinator;
    private logger: Logger;
    private enabled: boolean = false;

    // Component services
    private phaseStrataRouter: PhaseStrataRouter;
    private surpriseAdapter: SurpriseOrparAdapter;
    private phaseRewarder: PhaseWeightedRewarder;
    private consolidationTrigger: CycleConsolidationTrigger;
    private memoryOperations: PhaseMemoryOperations;

    // Active cycle tracking
    private activeCycles: Map<string, OrparCycleState> = new Map();

    // Recently completed cycles for retroactive reward recalculation when
    // task_complete fires after ORPAR cycle ends. Auto-expires after TTL.
    private recentlyCompletedCycles: Map<string, {
        cycleMemoryUsage: CycleMemoryUsage;
        outcome: CycleOutcome;
        completedAt: number;
    }> = new Map();
    private static readonly RECENTLY_COMPLETED_TTL_MS = 60_000;

    // Fix #2: Per-cycle locking to prevent race conditions
    private cycleProcessingLocks: Set<string> = new Set();

    // Fix #3: Stale cycle cleanup
    private cleanupIntervalId: NodeJS.Timeout | null = null;
    private static readonly STALE_CYCLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    private constructor() {
        this.logger = new Logger('info', 'OrparMemoryCoordinator');

        // Get singleton instances of all components
        this.phaseStrataRouter = PhaseStrataRouter.getInstance();
        this.surpriseAdapter = SurpriseOrparAdapter.getInstance();
        this.phaseRewarder = PhaseWeightedRewarder.getInstance();
        this.consolidationTrigger = CycleConsolidationTrigger.getInstance();
        this.memoryOperations = PhaseMemoryOperations.getInstance();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): OrparMemoryCoordinator {
        if (!OrparMemoryCoordinator.instance) {
            OrparMemoryCoordinator.instance = new OrparMemoryCoordinator();
        }
        return OrparMemoryCoordinator.instance;
    }

    /**
     * Initialize the coordinator and all component services
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();

        if (this.enabled) {
            // Initialize all component services
            this.phaseStrataRouter.initialize();
            this.surpriseAdapter.initialize();
            this.phaseRewarder.initialize();
            this.consolidationTrigger.initialize();
            this.memoryOperations.initialize();

            // Setup event listeners
            this.setupEventListeners();

            // Fix #3: Start stale cycle cleanup
            this.startStaleCycleCleanup();

            this.logger.info('[OrparMemoryCoordinator] Initialized with ORPAR-Memory integration ENABLED');
            this.logger.info('[OrparMemoryCoordinator] All component services initialized');
        } else {
            this.logger.info(
                '[OrparMemoryCoordinator] ORPAR-Memory integration is DISABLED. ' +
                'Enable with ORPAR_MEMORY_INTEGRATION_ENABLED=true'
            );
        }
    }

    // =========================================================================
    // Fix #2: Cycle Locking Methods
    // =========================================================================

    /**
     * Acquire a lock for a cycle to prevent race conditions
     * @returns true if lock acquired, false if already locked
     */
    private acquireCycleLock(cycleId: string): boolean {
        if (this.cycleProcessingLocks.has(cycleId)) {
            return false;
        }
        this.cycleProcessingLocks.add(cycleId);
        return true;
    }

    /**
     * Release a lock for a cycle
     */
    private releaseCycleLock(cycleId: string): void {
        this.cycleProcessingLocks.delete(cycleId);
    }

    // =========================================================================
    // Fix #3: Stale Cycle Cleanup Methods
    // =========================================================================

    /**
     * Start periodic cleanup of stale cycles
     */
    private startStaleCycleCleanup(): void {
        if (this.cleanupIntervalId) {
            return; // Already running
        }

        this.cleanupIntervalId = setInterval(() => {
            this.cleanupStaleCycles();
        }, OrparMemoryCoordinator.CLEANUP_INTERVAL_MS);

        this.logger.debug('[OrparMemoryCoordinator] Started stale cycle cleanup interval');
    }

    /**
     * Stop periodic cleanup of stale cycles
     */
    private stopStaleCycleCleanup(): void {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
            this.logger.debug('[OrparMemoryCoordinator] Stopped stale cycle cleanup interval');
        }
    }

    /**
     * Clean up cycles that have been active too long (stale/orphaned)
     */
    private cleanupStaleCycles(): void {
        const now = Date.now();
        const staleCycleIds: string[] = [];

        for (const [cycleId, cycleState] of this.activeCycles) {
            const cycleAge = now - cycleState.startedAt.getTime();
            if (cycleAge > OrparMemoryCoordinator.STALE_CYCLE_TTL_MS && !cycleState.isComplete) {
                staleCycleIds.push(cycleId);
            }
        }

        for (const cycleId of staleCycleIds) {
            this.cleanupStaleCycle(cycleId);
        }

        if (staleCycleIds.length > 0) {
            this.logger.warn(
                `[OrparMemoryCoordinator] Cleaned up ${staleCycleIds.length} stale cycles: ` +
                `${staleCycleIds.join(', ')}`
            );
        }
    }

    /**
     * Clean up a single stale cycle (Fix #1 and #3 helper)
     */
    private cleanupStaleCycle(cycleId: string): void {
        // Clean up the cycle state
        this.activeCycles.delete(cycleId);
        // Clean up any held locks
        this.releaseCycleLock(cycleId);
        // Clean up surprise momentum if applicable
        this.surpriseAdapter.clearMomentum(cycleId);

        this.logger.debug(`[OrparMemoryCoordinator] Cleaned up stale cycle ${cycleId}`);
    }

    /**
     * Check if the coordinator is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Setup event listeners for ORPAR cycle events
     *
     * Listens to two event streams:
     * 1. ControlLoopEvents - emitted by server-side ControlLoop (automatic ORPAR)
     * 2. OrparEvents - emitted by agent-driven ORPAR tools (orpar_observe, etc.)
     */
    private setupEventListeners(): void {
        // Listen to control loop events to track cycle phases (server-side ControlLoop)
        EventBus.server.on(ControlLoopEvents.OBSERVATION, (payload: any) => {
            this.onPhaseEvent('observation', payload, 'controlLoop');
        });

        EventBus.server.on(ControlLoopEvents.REASONING, (payload: any) => {
            this.onPhaseEvent('reasoning', payload, 'controlLoop');
        });

        EventBus.server.on(ControlLoopEvents.PLAN, (payload: any) => {
            this.onPhaseEvent('planning', payload, 'controlLoop');
        });

        EventBus.server.on(ControlLoopEvents.EXECUTION, (payload: any) => {
            this.onPhaseEvent('action', payload, 'controlLoop');
        });

        EventBus.server.on(ControlLoopEvents.REFLECTION, (payload: any) => {
            this.onPhaseEvent('reflection', payload, 'controlLoop');
        });

        // Listen to ORPAR tool events (agent-driven ORPAR tools)
        EventBus.server.on(OrparEvents.OBSERVE, (payload: any) => {
            this.onOrparToolEvent('observation', payload);
        });

        EventBus.server.on(OrparEvents.REASON, (payload: any) => {
            this.onOrparToolEvent('reasoning', payload);
        });

        EventBus.server.on(OrparEvents.PLAN, (payload: any) => {
            this.onOrparToolEvent('planning', payload);
        });

        EventBus.server.on(OrparEvents.ACT, (payload: any) => {
            this.onOrparToolEvent('action', payload);
        });

        EventBus.server.on(OrparEvents.REFLECT, (payload: any) => {
            this.onOrparToolEvent('reflection', payload);
        });

        // Listen for task completion to retroactively update rewards when
        // the ORPAR cycle completed before task_complete was called
        EventBus.server.on(Events.Task.COMPLETED, (payload: any) => {
            if (this.enabled) {
                this.onTaskCompleted(payload);
            }
        });

        this.logger.debug('[OrparMemoryCoordinator] Event listeners registered for ControlLoop, OrparTools, and TaskEvents');
    }

    /**
     * Handle phase events from the server-side control loop
     * Fix #2: Uses cycle locking to prevent race conditions
     */
    private onPhaseEvent(phase: OrparPhase, payload: any, source: string = 'controlLoop'): void {
        if (!this.enabled) return;

        const { agentId, channelId } = payload.data || payload;
        if (!agentId) return;

        // Get or create cycle state
        const cycleId = payload.loopId || `${agentId}-${Date.now()}`;

        // Fix #2: Acquire lock before modifying cycle state
        if (!this.acquireCycleLock(cycleId)) {
            this.logger.debug(`[OrparMemoryCoordinator] Cycle ${cycleId} is locked, skipping phase event`);
            return;
        }

        try {
            let cycleState = this.activeCycles.get(cycleId);

            if (!cycleState) {
                cycleState = this.createCycleState(cycleId, agentId, channelId || 'default', phase);
                this.activeCycles.set(cycleId, cycleState);
            }

            // Update phase
            const previousPhase = cycleState.currentPhase;
            cycleState.currentPhase = phase;
            cycleState.phaseStartTimes[phase] = new Date();

            // Emit phase changed event
            if (previousPhase !== phase) {
                const previousDuration = this.calculatePhaseDuration(cycleState, previousPhase);
                const phaseChangedPayload = createOrparMemoryPhaseChangedPayload(
                    agentId,
                    cycleState.channelId,
                    {
                        agentId,
                        channelId: cycleState.channelId,
                        cycleId,
                        previousPhase: previousPhase || 'observation',
                        newPhase: phase,
                        previousPhaseDurationMs: previousDuration
                    },
                    { source }
                );
                EventBus.server.emit(OrparMemoryEvents.PHASE_CHANGED, phaseChangedPayload);
            }
        } finally {
            // Fix #2: Always release lock
            this.releaseCycleLock(cycleId);
        }
    }

    /**
     * Handle phase events from agent-driven ORPAR tools (orpar_observe, orpar_reason, etc.)
     *
     * OrparTools emit events with a different payload structure:
     * - agentId and channelId are at the top level
     * - loopId is the cycle identifier
     * - cycleNumber tracks the agent's internal cycle count
     *
     * Fix #2: Uses cycle locking to prevent race conditions
     */
    private onOrparToolEvent(phase: OrparPhase, payload: any): void {
        if (!this.enabled) return;

        const agentId = payload.agentId;
        const channelId = payload.channelId || 'default';
        const loopId = payload.loopId;

        if (!agentId) {
            this.logger.warn('[OrparMemoryCoordinator] OrparTool event missing agentId');
            return;
        }

        // Use loopId from OrparTools as cycle identifier
        // This ensures all events from the same ORPAR cycle are grouped together
        const cycleKey = loopId || `orpar-${agentId}-${channelId}`;

        // Fix #2: Acquire lock before modifying cycle state
        if (!this.acquireCycleLock(cycleKey)) {
            this.logger.debug(`[OrparMemoryCoordinator] Cycle ${cycleKey} is locked, skipping OrparTool event`);
            return;
        }

        let shouldCompleteReflection = false;

        try {
            // Get or create cycle state for this loopId
            let cycleState = this.activeCycles.get(cycleKey);

            if (!cycleState) {
                // Start a new cycle when first event is received
                cycleState = this.createCycleState(cycleKey, agentId, channelId, phase);
                this.activeCycles.set(cycleKey, cycleState);

                // Emit cycle started event
                const cycleStartedPayload = createOrparMemoryCycleStartedPayload(
                    agentId,
                    channelId,
                    {
                        agentId,
                        channelId,
                        cycleId: cycleKey,
                        initialPhase: phase
                    },
                    { source: 'orparTools' }
                );
                EventBus.server.emit(OrparMemoryEvents.CYCLE_STARTED, cycleStartedPayload);

                this.logger.info(`[OrparMemoryCoordinator] Started cycle ${cycleKey} for agent ${agentId} (via OrparTools)`);
            }

            // Update phase
            const previousPhase = cycleState.currentPhase;
            cycleState.currentPhase = phase;
            cycleState.phaseStartTimes[phase] = new Date();

            // Emit phase changed event
            if (previousPhase !== phase) {
                const previousDuration = this.calculatePhaseDuration(cycleState, previousPhase);
                const phaseChangedPayload = createOrparMemoryPhaseChangedPayload(
                    agentId,
                    cycleState.channelId,
                    {
                        agentId,
                        channelId: cycleState.channelId,
                        cycleId: cycleKey,
                        previousPhase: previousPhase || 'observation',
                        newPhase: phase,
                        previousPhaseDurationMs: previousDuration
                    },
                    { source: 'orparTools' }
                );
                EventBus.server.emit(OrparMemoryEvents.PHASE_CHANGED, phaseChangedPayload);

                this.logger.debug(`[OrparMemoryCoordinator] Phase changed: ${previousPhase || 'none'} → ${phase} (agent: ${agentId})`);
            }

            // If reflection phase is complete, mark for completion (after releasing lock)
            if (phase === 'reflection') {
                shouldCompleteReflection = true;
            }
        } finally {
            // Fix #2: Always release lock
            this.releaseCycleLock(cycleKey);
        }

        // Complete reflection cycle outside the lock to avoid deadlock
        if (shouldCompleteReflection) {
            // Fix #1: Schedule cycle completion with proper error handling
            // Using non-async callback with .catch() to ensure cleanup on failure
            setImmediate(() => {
                this.completeOrparToolCycle(cycleKey, payload)
                    .catch((error) => {
                        this.logger.error(
                            `[OrparMemoryCoordinator] Failed to complete ORPAR tool cycle ${cycleKey}: ` +
                            `${error instanceof Error ? error.message : String(error)}`
                        );
                        // Ensure cleanup happens even on failure
                        this.cleanupStaleCycle(cycleKey);
                    });
            });
        }
    }

    /**
     * Complete an ORPAR cycle triggered by OrparTools
     */
    private async completeOrparToolCycle(cycleKey: string, reflectionPayload: any): Promise<void> {
        const cycleState = this.activeCycles.get(cycleKey);
        if (!cycleState || cycleState.isComplete) return;

        // Build outcome from reflection data
        const reflectionData = reflectionPayload.data || {};
        const outcome: CycleOutcome = {
            success: reflectionData.expectationsMet !== false,
            qualityScore: reflectionData.expectationsMet !== false ? 0.8 : 0.4,
            errorCount: 0,
            toolCallCount: 5, // ORPAR tools count as one call per phase
            taskCompleted: true,
            metadata: {
                source: 'orparTools',
                learnings: reflectionData.learnings,
                adjustments: reflectionData.adjustments
            }
        };

        await this.completeCycle(cycleKey, outcome);
    }

    // =========================================================================
    // Cycle Management
    // =========================================================================

    /**
     * Start a new ORPAR cycle with memory integration
     *
     * @param agentId - Agent ID
     * @param channelId - Channel ID
     * @param taskId - Optional task ID
     * @returns The cycle ID
     */
    public startCycle(
        agentId: AgentId,
        channelId: ChannelId,
        taskId?: string
    ): string {
        if (!this.enabled) {
            return uuidv4(); // Return a cycle ID even if disabled
        }

        const cycleId = uuidv4();
        const cycleState = this.createCycleState(cycleId, agentId, channelId, 'observation');
        cycleState.memoryUsage.taskId = taskId;

        this.activeCycles.set(cycleId, cycleState);

        // Emit cycle started event
        const cycleStartedPayload = createOrparMemoryCycleStartedPayload(
            agentId,
            channelId,
            {
                agentId,
                channelId,
                cycleId,
                taskId,
                initialPhase: 'observation'
            },
            { source: 'controlLoop' }
        );
        EventBus.server.emit(OrparMemoryEvents.CYCLE_STARTED, cycleStartedPayload);

        this.logger.debug(`[OrparMemoryCoordinator] Started cycle ${cycleId} for agent ${agentId}`);

        return cycleId;
    }

    /**
     * Complete an ORPAR cycle and trigger rewards/consolidation
     *
     * @param cycleId - The cycle ID
     * @param outcome - The cycle outcome
     */
    public async completeCycle(cycleId: string, outcome: CycleOutcome): Promise<void> {
        if (!this.enabled) return;

        const cycleState = this.activeCycles.get(cycleId);
        if (!cycleState) {
            this.logger.warn(`[OrparMemoryCoordinator] No active cycle found with ID ${cycleId}`);
            return;
        }

        cycleState.isComplete = true;
        cycleState.memoryUsage.completedAt = new Date();
        cycleState.memoryUsage.outcome = outcome;

        // Calculate phase durations
        const phaseDurations: Partial<Record<OrparPhase, number>> = {};
        const phases: OrparPhase[] = ['observation', 'reasoning', 'planning', 'action', 'reflection'];
        for (const phase of phases) {
            phaseDurations[phase] = this.calculatePhaseDuration(cycleState, phase);
        }

        // Process rewards for memories used
        const { rewards, updated } = await this.phaseRewarder.processOutcome(
            cycleState.memoryUsage,
            outcome
        );

        // Calculate total duration
        const totalDurationMs = Date.now() - cycleState.startedAt.getTime();

        // Count memories used
        const memoriesUsedCount = this.countMemoriesUsed(cycleState.memoryUsage);

        // Emit cycle completed event (this triggers consolidation in CycleConsolidationTrigger)
        const cycleCompletedPayload = createOrparMemoryCycleCompletedPayload(
            cycleState.agentId,
            cycleState.channelId,
            {
                agentId: cycleState.agentId,
                channelId: cycleState.channelId,
                cycleId,
                taskId: cycleState.memoryUsage.taskId,
                outcome,
                totalDurationMs,
                phaseDurations,
                memoriesUsedCount,
                surpriseCount: cycleState.surpriseDetections.length,
                finalState: cycleState
            },
            { source: 'orparMemoryCoordinator' }
        );
        EventBus.server.emit(OrparMemoryEvents.CYCLE_COMPLETED, cycleCompletedPayload);

        // Clean up surprise momentum
        this.surpriseAdapter.clearMomentum(cycleId);

        // Retain cycle data for retroactive reward recalculation if task_complete
        // fires after ORPAR cycle ends
        const taskId = cycleState.memoryUsage.taskId;
        if (taskId) {
            const cacheKey = `${cycleState.agentId}:${taskId}`;
            this.recentlyCompletedCycles.set(cacheKey, {
                cycleMemoryUsage: cycleState.memoryUsage,
                outcome,
                completedAt: Date.now(),
            });
            setTimeout(() => {
                this.recentlyCompletedCycles.delete(cacheKey);
            }, OrparMemoryCoordinator.RECENTLY_COMPLETED_TTL_MS);
        }

        // Remove from active cycles
        this.activeCycles.delete(cycleId);

        this.logger.info(
            `[OrparMemoryCoordinator] Completed cycle ${cycleId} ` +
            `(duration: ${totalDurationMs}ms, memories: ${memoriesUsedCount}, rewards: ${updated})`
        );
    }

    /**
     * Handle task completion for retroactive reward recalculation.
     * When task_complete fires after an ORPAR cycle already finalized with
     * a non-success outcome, recalculate rewards with success=true.
     */
    private async onTaskCompleted(payload: any): Promise<void> {
        const agentId = payload.agentId;
        const taskId = payload.data?.taskId;
        if (!agentId || !taskId) return;

        const cacheKey = `${agentId}:${taskId}`;
        const cached = this.recentlyCompletedCycles.get(cacheKey);
        if (!cached) return;

        // Already successful — no recalculation needed
        if (cached.outcome.success) {
            this.recentlyCompletedCycles.delete(cacheKey);
            return;
        }

        this.logger.info(
            `[OrparMemoryCoordinator] Task ${taskId} completed after ORPAR cycle reported failure. ` +
            `Retroactively recalculating rewards with success=true for agent ${agentId}`
        );

        const correctedOutcome: CycleOutcome = {
            ...cached.outcome,
            success: true,
            qualityScore: Math.max(cached.outcome.qualityScore ?? 0.8, 0.8),
            taskCompleted: true,
        };

        try {
            const { updated } = await this.phaseRewarder.processOutcome(
                cached.cycleMemoryUsage,
                correctedOutcome
            );
            this.logger.info(
                `[OrparMemoryCoordinator] Retroactive reward recalculation: ${updated} memories updated`
            );
        } catch (error) {
            this.logger.error(
                `[OrparMemoryCoordinator] Retroactive reward failed for task ${taskId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
        }

        this.recentlyCompletedCycles.delete(cacheKey);
    }

    // =========================================================================
    // Memory Operations (Delegated to PhaseMemoryOperations)
    // =========================================================================

    /**
     * Retrieve memories for the current phase
     */
    public async retrieveMemories(
        options: PhaseRetrievalOptions
    ): Promise<PhaseStrataRetrievalResult> {
        return this.memoryOperations.retrieve(options);
    }

    /**
     * Store a memory for the current phase
     */
    public async storeMemory(
        options: PhaseStorageOptions
    ): Promise<PhaseStorageResult> {
        return this.memoryOperations.store(options);
    }

    /**
     * Record memory usage in a cycle
     */
    public recordMemoryUsage(
        cycleId: string,
        phase: OrparPhase,
        memoryId: string,
        usageType: MemoryUsageRecord['usageType'] = 'context'
    ): void {
        if (!this.enabled) return;

        const cycleState = this.activeCycles.get(cycleId);
        if (!cycleState) return;

        const record: MemoryUsageRecord = {
            memoryId,
            phase,
            retrievedAt: new Date(),
            usageType
        };

        cycleState.memoryUsage.phaseUsage[phase].push(record);

        // Also emit to PhaseMemoryOperations
        this.memoryOperations.recordUsage(
            cycleState.agentId,
            cycleState.channelId,
            cycleId,
            phase,
            memoryId,
            usageType ?? 'context'
        );
    }

    // =========================================================================
    // Surprise Processing (Delegated to SurpriseOrparAdapter)
    // =========================================================================

    /**
     * Process a surprise detection and get ORPAR decision
     */
    public processSurprise(
        cycleId: string,
        surprise: SurpriseDetection
    ): SurpriseOrparDecision | null {
        if (!this.enabled) return null;

        const cycleState = this.activeCycles.get(cycleId);
        if (!cycleState) {
            this.logger.warn(`[OrparMemoryCoordinator] No active cycle found for surprise processing`);
            return null;
        }

        // Track the surprise detection
        cycleState.surpriseDetections.push(surprise);

        // Process through adapter
        const decision = this.surpriseAdapter.processSurprise(surprise, {
            agentId: cycleState.agentId,
            channelId: cycleState.channelId,
            cycleId,
            currentPhase: cycleState.currentPhase,
            recentSurpriseScores: cycleState.surpriseDetections.map(s => s.surpriseScore)
        });

        // Track additional observations queued
        if (decision.type === 'RE_OBSERVE' && decision.additionalObservations) {
            cycleState.additionalObservationsQueued += decision.additionalObservations;
        }

        return decision;
    }

    // =========================================================================
    // Component Access
    // =========================================================================

    /**
     * Get the PhaseStrataRouter instance
     */
    public getPhaseStrataRouter(): PhaseStrataRouter {
        return this.phaseStrataRouter;
    }

    /**
     * Get the SurpriseOrparAdapter instance
     */
    public getSurpriseAdapter(): SurpriseOrparAdapter {
        return this.surpriseAdapter;
    }

    /**
     * Get the PhaseWeightedRewarder instance
     */
    public getPhaseRewarder(): PhaseWeightedRewarder {
        return this.phaseRewarder;
    }

    /**
     * Get the CycleConsolidationTrigger instance
     */
    public getConsolidationTrigger(): CycleConsolidationTrigger {
        return this.consolidationTrigger;
    }

    /**
     * Get the PhaseMemoryOperations instance
     */
    public getMemoryOperations(): PhaseMemoryOperations {
        return this.memoryOperations;
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Create a new cycle state
     */
    private createCycleState(
        cycleId: string,
        agentId: AgentId,
        channelId: ChannelId,
        initialPhase: OrparPhase
    ): OrparCycleState {
        const now = new Date();

        return {
            cycleId,
            agentId,
            channelId,
            currentPhase: initialPhase,
            phaseStartTimes: {
                [initialPhase]: now
            },
            memoryUsage: {
                cycleId,
                agentId,
                channelId,
                phaseUsage: {
                    observation: [],
                    reasoning: [],
                    planning: [],
                    action: [],
                    reflection: []
                },
                startedAt: now
            },
            surpriseDetections: [],
            additionalObservationsQueued: 0,
            isComplete: false,
            startedAt: now
        };
    }

    /**
     * Calculate duration of a phase
     */
    private calculatePhaseDuration(
        cycleState: OrparCycleState,
        phase: OrparPhase
    ): number {
        const startTime = cycleState.phaseStartTimes[phase];
        if (!startTime) return 0;

        const phases: OrparPhase[] = ['observation', 'reasoning', 'planning', 'action', 'reflection'];
        const phaseIndex = phases.indexOf(phase);
        const nextPhase = phases[phaseIndex + 1];

        let endTime: Date;
        if (nextPhase && cycleState.phaseStartTimes[nextPhase]) {
            endTime = cycleState.phaseStartTimes[nextPhase];
        } else if (cycleState.memoryUsage.completedAt) {
            endTime = cycleState.memoryUsage.completedAt;
        } else {
            endTime = new Date();
        }

        return endTime.getTime() - startTime.getTime();
    }

    /**
     * Count total memories used in a cycle
     */
    private countMemoriesUsed(memoryUsage: CycleMemoryUsage): number {
        const memoryIds = new Set<string>();
        const phases: Array<keyof CycleMemoryUsage['phaseUsage']> = [
            'observation', 'reasoning', 'planning', 'action', 'reflection'
        ];

        for (const phase of phases) {
            for (const record of memoryUsage.phaseUsage[phase]) {
                memoryIds.add(record.memoryId);
            }
        }

        return memoryIds.size;
    }

    /**
     * Get active cycle state
     */
    public getActiveCycle(cycleId: string): OrparCycleState | undefined {
        return this.activeCycles.get(cycleId);
    }

    /**
     * Get all active cycles
     */
    public getActiveCycles(): OrparCycleState[] {
        return Array.from(this.activeCycles.values());
    }

    /**
     * Get configuration summary
     */
    public getConfigSummary(): string {
        const config = getOrparMemoryConfig();
        return [
            'ORPAR-Memory Integration Configuration:',
            `  Enabled: ${config.enabled}`,
            `  Debug: ${config.debug}`,
            '',
            this.phaseStrataRouter.getMappingSummary(),
            '',
            `Surprise Thresholds:`,
            `  High: ${config.surpriseThresholds.high}`,
            `  Moderate: ${config.surpriseThresholds.moderate}`,
            `  Plan: ${config.surpriseThresholds.plan}`,
            `  Max Extra Observations: ${config.surpriseThresholds.maxExtraObservations}`,
            '',
            `Phase Weights:`,
            `  Observation: ${config.phaseWeights.observation}`,
            `  Reasoning: ${config.phaseWeights.reasoning}`,
            `  Planning: ${config.phaseWeights.planning}`,
            `  Action: ${config.phaseWeights.action}`,
            `  Reflection: ${config.phaseWeights.reflection}`,
            '',
            `Consolidation Rules: ${config.consolidationRules.length}`
        ].join('\n');
    }

    /**
     * Reset the coordinator (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
        this.activeCycles.clear();
        this.recentlyCompletedCycles.clear();

        // Fix #3: Stop stale cycle cleanup
        this.stopStaleCycleCleanup();

        // Fix #2: Clear all cycle locks
        this.cycleProcessingLocks.clear();

        // Reset all components
        this.phaseStrataRouter.reset();
        this.surpriseAdapter.reset();
        this.phaseRewarder.reset();
        this.consolidationTrigger.reset();
        this.memoryOperations.reset();

        // Reset config
        resetOrparMemoryConfig();
    }
}
