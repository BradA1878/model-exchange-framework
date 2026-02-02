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
 * CycleConsolidationTrigger
 *
 * Triggers memory consolidation based on ORPAR cycle outcomes.
 * This service implements the consolidation rules that promote, demote,
 * archive, or abstract memories based on their Q-values and usage patterns.
 *
 * Rules:
 * | Condition                            | Action                          |
 * |--------------------------------------|---------------------------------|
 * | Q-value >= 0.7 AND successCount >= 3 | PROMOTE (Working→Short→Long)    |
 * | Q-value <= 0.3 AND failureCount >= 5 | DEMOTE or ARCHIVE               |
 * | successCount >= 10 AND in Long-term  | ABSTRACT to Semantic            |
 * | daysSinceAccess >= 30 AND Q < 0.5    | ARCHIVE                         |
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { Events, ControlLoopEvents } from '../../events/EventNames';
import {
    MemoryStratum,
    MemoryEntry,
    MemoryTransition
} from '../../types/MemoryStrataTypes';
import { MemoryUtilitySubdocument } from '../../types/MemoryUtilityTypes';
import {
    ConsolidationRule,
    ConsolidationCondition,
    ConsolidationAction,
    ConsolidationTriggerResult,
    CycleMemoryUsage,
    DEFAULT_CONSOLIDATION_RULES
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    getConsolidationRules
} from '../../config/orpar-memory.config';
import { StratumManager } from '../StratumManager';
import { QValueManager } from '../QValueManager';
import { AgentId, ChannelId } from '../../types/ChannelContext';

/**
 * Memory state for consolidation evaluation
 */
interface MemoryConsolidationState {
    memoryId: string;
    currentStratum: MemoryStratum;
    qValue: number;
    successCount: number;
    failureCount: number;
    daysSinceAccess: number;
    accessCount: number;
    lastAccessed: Date;
}

/**
 * CycleConsolidationTrigger triggers memory consolidation based on ORPAR cycle outcomes
 */
export class CycleConsolidationTrigger {
    private static instance: CycleConsolidationTrigger;
    private logger: Logger;
    private stratumManager: StratumManager;
    private qValueManager: QValueManager;
    private enabled: boolean = false;
    private rules: ConsolidationRule[];

    // Track success/failure counts per memory
    private memorySuccessCounts: Map<string, number> = new Map();
    private memoryFailureCounts: Map<string, number> = new Map();

    private constructor() {
        this.logger = new Logger('info', 'CycleConsolidationTrigger');
        this.stratumManager = StratumManager.getInstance();
        this.qValueManager = QValueManager.getInstance();
        this.rules = DEFAULT_CONSOLIDATION_RULES;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): CycleConsolidationTrigger {
        if (!CycleConsolidationTrigger.instance) {
            CycleConsolidationTrigger.instance = new CycleConsolidationTrigger();
        }
        return CycleConsolidationTrigger.instance;
    }

    /**
     * Initialize the CycleConsolidationTrigger
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();
        this.rules = getConsolidationRules();

        if (this.enabled) {
            this.logger.info('[CycleConsolidationTrigger] Initialized with ORPAR-Memory integration');
            this.logger.info(`[CycleConsolidationTrigger] Loaded ${this.rules.length} consolidation rules`);

            // Listen to ORPAR reflection completion to trigger consolidation
            this.setupEventListeners();
        } else {
            this.logger.debug('[CycleConsolidationTrigger] ORPAR-Memory integration is disabled');
        }
    }

    /**
     * Setup event listeners for ORPAR cycle completion
     */
    private setupEventListeners(): void {
        // Listen to cycle completed events
        EventBus.server.on(OrparMemoryEvents.CYCLE_COMPLETED, async (payload: any) => {
            if (this.enabled) {
                await this.onCycleCompleted(payload);
            }
        });
    }

    /**
     * Handle cycle completed event
     */
    private async onCycleCompleted(payload: any): Promise<void> {
        // agentId/channelId are top-level in BaseEventPayload; cycleId/outcome/finalState are in data
        const { agentId, channelId } = payload;
        const { cycleId, outcome, finalState } = payload.data || {};

        if (!outcome) {
            this.logger.debug('[CycleConsolidationTrigger] No outcome in cycle completed event');
            return;
        }

        // Update success/failure counts for memories used in this cycle
        await this.updateMemoryCounts(finalState?.memoryUsage, outcome.success);

        // Evaluate consolidation rules for memories used in this cycle
        await this.evaluateConsolidationForCycle(agentId, channelId, finalState?.memoryUsage);
    }

    /**
     * Check if the trigger is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Update success/failure counts for memories
     */
    private async updateMemoryCounts(
        memoryUsage: CycleMemoryUsage | undefined,
        success: boolean
    ): Promise<void> {
        if (!memoryUsage) return;

        // Collect all memory IDs from the cycle
        const memoryIds = new Set<string>();
        const phases: Array<keyof CycleMemoryUsage['phaseUsage']> = [
            'observation', 'reasoning', 'planning', 'action', 'reflection'
        ];

        for (const phase of phases) {
            const records = memoryUsage.phaseUsage[phase];
            for (const record of records) {
                memoryIds.add(record.memoryId);
            }
        }

        // Update counts
        for (const memoryId of memoryIds) {
            if (success) {
                const current = this.memorySuccessCounts.get(memoryId) ?? 0;
                this.memorySuccessCounts.set(memoryId, current + 1);
            } else {
                const current = this.memoryFailureCounts.get(memoryId) ?? 0;
                this.memoryFailureCounts.set(memoryId, current + 1);
            }
        }
    }

    /**
     * Evaluate consolidation rules for memories in a cycle
     */
    public async evaluateConsolidationForCycle(
        agentId: AgentId,
        channelId: ChannelId,
        memoryUsage: CycleMemoryUsage | undefined
    ): Promise<ConsolidationTriggerResult[]> {
        if (!this.enabled || !memoryUsage) {
            return [];
        }

        // Collect all memory IDs
        const memoryIds = new Set<string>();
        const phases: Array<keyof CycleMemoryUsage['phaseUsage']> = [
            'observation', 'reasoning', 'planning', 'action', 'reflection'
        ];

        for (const phase of phases) {
            const records = memoryUsage.phaseUsage[phase];
            for (const record of records) {
                memoryIds.add(record.memoryId);
            }
        }

        const results: ConsolidationTriggerResult[] = [];

        for (const memoryId of memoryIds) {
            const state = await this.getMemoryState(agentId, channelId, memoryId);
            if (!state) continue;

            const triggerResult = this.evaluateRules(state);
            if (triggerResult) {
                results.push(triggerResult);

                // Execute the consolidation action
                await this.executeConsolidation(agentId, channelId, triggerResult);
            }
        }

        if (results.length > 0) {
            this.logger.info(
                `[CycleConsolidationTrigger] Triggered ${results.length} consolidation actions`
            );
        }

        return results;
    }

    /**
     * Evaluate a single memory against all rules
     */
    public evaluateMemory(
        memoryId: string,
        currentStratum: MemoryStratum,
        qValue: number,
        lastAccessed: Date,
        accessCount: number
    ): ConsolidationTriggerResult | null {
        if (!this.enabled) {
            return null;
        }

        const state: MemoryConsolidationState = {
            memoryId,
            currentStratum,
            qValue,
            successCount: this.memorySuccessCounts.get(memoryId) ?? 0,
            failureCount: this.memoryFailureCounts.get(memoryId) ?? 0,
            daysSinceAccess: this.calculateDaysSinceAccess(lastAccessed),
            accessCount,
            lastAccessed
        };

        return this.evaluateRules(state);
    }

    /**
     * Get memory state for evaluation
     */
    private async getMemoryState(
        agentId: AgentId,
        channelId: ChannelId,
        memoryId: string
    ): Promise<MemoryConsolidationState | null> {
        // Get Q-value
        const qValue = this.qValueManager.getQValue(memoryId);

        // Get memory from stratum manager (try agent scope first)
        let memory: MemoryEntry | undefined;
        let currentStratum: MemoryStratum | undefined;

        // Fix #6: Wrap strata queries in try-catch, log and continue on failure
        // Search through all strata to find the memory
        for (const stratum of Object.values(MemoryStratum)) {
            try {
                const result = await this.stratumManager.queryMemories('agent', agentId, {
                    query: '',
                    strata: [stratum],
                    limit: 1000 // Query all to find by ID
                });

                memory = result.memories.find(m => m.id === memoryId);
                if (memory) {
                    currentStratum = stratum;
                    break;
                }
            } catch (error) {
                this.logger.warn(
                    `[CycleConsolidationTrigger] Failed to query agent stratum ${stratum}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                // Continue checking other strata
            }
        }

        // Also check channel scope if not found
        if (!memory) {
            for (const stratum of Object.values(MemoryStratum)) {
                try {
                    const result = await this.stratumManager.queryMemories('channel', channelId, {
                        query: '',
                        strata: [stratum],
                        limit: 1000
                    });

                    memory = result.memories.find(m => m.id === memoryId);
                    if (memory) {
                        currentStratum = stratum;
                        break;
                    }
                } catch (error) {
                    this.logger.warn(
                        `[CycleConsolidationTrigger] Failed to query channel stratum ${stratum}: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                    // Continue checking other strata
                }
            }
        }

        if (!memory || !currentStratum) {
            return null;
        }

        return {
            memoryId,
            currentStratum,
            qValue,
            successCount: this.memorySuccessCounts.get(memoryId) ?? 0,
            failureCount: this.memoryFailureCounts.get(memoryId) ?? 0,
            daysSinceAccess: this.calculateDaysSinceAccess(memory.lastAccessed),
            accessCount: memory.accessCount,
            lastAccessed: memory.lastAccessed
        };
    }

    /**
     * Evaluate rules against memory state
     */
    private evaluateRules(state: MemoryConsolidationState): ConsolidationTriggerResult | null {
        // Rules are sorted by priority (descending)
        for (const rule of this.rules) {
            if (this.checkCondition(rule.condition, state)) {
                this.logger.debug(
                    `[CycleConsolidationTrigger] Rule "${rule.name}" triggered for memory ${state.memoryId}`
                );

                return {
                    memoryId: state.memoryId,
                    rule,
                    action: rule.action,
                    memoryState: {
                        currentStratum: state.currentStratum,
                        qValue: state.qValue,
                        successCount: state.successCount,
                        failureCount: state.failureCount,
                        daysSinceAccess: state.daysSinceAccess
                    },
                    triggeredAt: new Date()
                };
            }
        }

        return null;
    }

    /**
     * Check if a condition is satisfied
     */
    private checkCondition(
        condition: ConsolidationCondition,
        state: MemoryConsolidationState
    ): boolean {
        // Check stratum filter
        if (condition.currentStrata && !condition.currentStrata.includes(state.currentStratum)) {
            return false;
        }

        // Check Q-value thresholds
        if (condition.minQValue !== undefined && state.qValue < condition.minQValue) {
            return false;
        }
        if (condition.maxQValue !== undefined && state.qValue > condition.maxQValue) {
            return false;
        }

        // Check success/failure counts
        if (condition.minSuccessCount !== undefined && state.successCount < condition.minSuccessCount) {
            return false;
        }
        if (condition.minFailureCount !== undefined && state.failureCount < condition.minFailureCount) {
            return false;
        }

        // Check days since access
        if (condition.daysSinceAccess !== undefined && state.daysSinceAccess < condition.daysSinceAccess) {
            return false;
        }

        return true;
    }

    /**
     * Execute a consolidation action
     */
    private async executeConsolidation(
        agentId: AgentId,
        channelId: ChannelId,
        result: ConsolidationTriggerResult
    ): Promise<void> {
        const { memoryId, action, memoryState } = result;

        // Emit trigger event
        EventBus.server.emit(OrparMemoryEvents.CONSOLIDATION_TRIGGERED, {
            agentId,
            channelId,
            triggerResult: result
        });

        switch (action.type) {
            case 'PROMOTE':
                await this.executePromote(agentId, channelId, memoryId, memoryState.currentStratum, action.targetStratum);
                break;

            case 'DEMOTE':
                await this.executeDemote(agentId, channelId, memoryId, memoryState.currentStratum, action.targetStratum);
                break;

            case 'ARCHIVE':
                await this.executeArchive(agentId, channelId, memoryId, memoryState.currentStratum);
                break;

            case 'ABSTRACT':
                await this.executeAbstract(agentId, channelId, memoryId, memoryState.currentStratum, action.targetStratum);
                break;
        }
    }

    /**
     * Execute memory promotion
     * Fix #6: Wrap transition in try-catch, re-throw on failure (fail-fast)
     */
    private async executePromote(
        agentId: AgentId,
        channelId: ChannelId,
        memoryId: string,
        fromStratum: MemoryStratum,
        toStratum: MemoryStratum
    ): Promise<void> {
        try {
            await this.stratumManager.transitionMemory(
                'agent',
                agentId,
                memoryId,
                fromStratum,
                toStratum,
                'High Q-value and success count - promoted via ORPAR cycle'
            );

            const qValue = this.qValueManager.getQValue(memoryId);

            EventBus.server.emit(OrparMemoryEvents.MEMORY_PROMOTED, {
                agentId,
                channelId,
                memoryId,
                fromStratum,
                toStratum,
                qValue
            });

            this.logger.info(
                `[CycleConsolidationTrigger] Promoted memory ${memoryId} from ${fromStratum} to ${toStratum}`
            );
        } catch (error) {
            this.logger.error(
                `[CycleConsolidationTrigger] Failed to promote memory ${memoryId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            throw error; // Fail-fast
        }
    }

    /**
     * Execute memory demotion
     * Fix #6: Wrap transition in try-catch, re-throw on failure (fail-fast)
     */
    private async executeDemote(
        agentId: AgentId,
        channelId: ChannelId,
        memoryId: string,
        fromStratum: MemoryStratum,
        toStratum: MemoryStratum
    ): Promise<void> {
        try {
            await this.stratumManager.transitionMemory(
                'agent',
                agentId,
                memoryId,
                fromStratum,
                toStratum,
                'Low Q-value and high failure count - demoted via ORPAR cycle'
            );

            const qValue = this.qValueManager.getQValue(memoryId);

            EventBus.server.emit(OrparMemoryEvents.MEMORY_DEMOTED, {
                agentId,
                channelId,
                memoryId,
                fromStratum,
                toStratum,
                qValue
            });

            this.logger.info(
                `[CycleConsolidationTrigger] Demoted memory ${memoryId} from ${fromStratum} to ${toStratum}`
            );
        } catch (error) {
            this.logger.error(
                `[CycleConsolidationTrigger] Failed to demote memory ${memoryId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            throw error; // Fail-fast
        }
    }

    /**
     * Execute memory archival
     * Fix #6: Wrap transition in try-catch, re-throw on failure (fail-fast)
     */
    private async executeArchive(
        agentId: AgentId,
        channelId: ChannelId,
        memoryId: string,
        fromStratum: MemoryStratum
    ): Promise<void> {
        try {
            // Archive by removing from active storage (in a real implementation,
            // this would move to cold storage rather than delete)
            await this.stratumManager.removeMemory('agent', agentId, memoryId);

            EventBus.server.emit(OrparMemoryEvents.MEMORY_ARCHIVED, {
                agentId,
                channelId,
                memoryId,
                previousStratum: fromStratum,
                reason: 'Low Q-value or stale - archived via ORPAR cycle'
            });

            // Clear tracking for this memory
            this.memorySuccessCounts.delete(memoryId);
            this.memoryFailureCounts.delete(memoryId);

            this.logger.info(
                `[CycleConsolidationTrigger] Archived memory ${memoryId} from ${fromStratum}`
            );
        } catch (error) {
            this.logger.error(
                `[CycleConsolidationTrigger] Failed to archive memory ${memoryId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            throw error; // Fail-fast
        }
    }

    /**
     * Execute memory abstraction to semantic layer
     * Fix #6: Wrap transition in try-catch, re-throw on failure (fail-fast)
     */
    private async executeAbstract(
        agentId: AgentId,
        channelId: ChannelId,
        memoryId: string,
        fromStratum: MemoryStratum,
        toStratum: MemoryStratum
    ): Promise<void> {
        try {
            // In a full implementation, this would use LLM to abstract the memory
            // into a more general pattern. For now, we just transition it.
            await this.stratumManager.transitionMemory(
                'agent',
                agentId,
                memoryId,
                fromStratum,
                toStratum,
                'High success count - abstracted to semantic via ORPAR cycle'
            );

            EventBus.server.emit(OrparMemoryEvents.MEMORY_ABSTRACTED, {
                agentId,
                channelId,
                memoryId,
                newMemoryId: memoryId, // Same ID, different stratum
                fromStratum
            });

            this.logger.info(
                `[CycleConsolidationTrigger] Abstracted memory ${memoryId} from ${fromStratum} to ${toStratum}`
            );
        } catch (error) {
            this.logger.error(
                `[CycleConsolidationTrigger] Failed to abstract memory ${memoryId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            throw error; // Fail-fast
        }
    }

    /**
     * Calculate days since last access
     */
    private calculateDaysSinceAccess(lastAccessed: Date): number {
        const now = new Date();
        const diffMs = now.getTime() - lastAccessed.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    /**
     * Get the current consolidation rules
     */
    public getRules(): ConsolidationRule[] {
        return [...this.rules];
    }

    /**
     * Add a custom consolidation rule
     */
    public addRule(rule: ConsolidationRule): void {
        this.rules.push(rule);
        // Re-sort by priority
        this.rules.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Remove a consolidation rule by ID
     */
    public removeRule(ruleId: string): boolean {
        const index = this.rules.findIndex(r => r.id === ruleId);
        if (index >= 0) {
            this.rules.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Get success count for a memory
     */
    public getSuccessCount(memoryId: string): number {
        return this.memorySuccessCounts.get(memoryId) ?? 0;
    }

    /**
     * Get failure count for a memory
     */
    public getFailureCount(memoryId: string): number {
        return this.memoryFailureCounts.get(memoryId) ?? 0;
    }

    /**
     * Reset the trigger (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
        this.rules = DEFAULT_CONSOLIDATION_RULES;
        this.memorySuccessCounts.clear();
        this.memoryFailureCounts.clear();
    }
}
