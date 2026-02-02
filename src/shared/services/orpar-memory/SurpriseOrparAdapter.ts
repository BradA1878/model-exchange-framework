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
 * SurpriseOrparAdapter
 *
 * Converts Titans-style surprise signals to ORPAR control decisions.
 * This adapter implements the surprise-driven behavior modification for the
 * ORPAR control loop.
 *
 * Behavior:
 * - High surprise (>0.7): Trigger 1-3 additional observation cycles
 * - Moderate surprise (0.4-0.7): Inject surprise context into reasoning
 * - Plan surprise (>0.6): Flag plan for reconsideration
 * - Momentum accumulation: Extended reasoning phase
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED
 */

import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    SurpriseDetection,
    SurpriseType
} from '../../types/MemoryStrataTypes';
import {
    SurpriseOrparDecision,
    SurpriseDecisionType,
    SurpriseContext,
    PlanReconsiderationInfo,
    SurpriseThresholds,
    DEFAULT_SURPRISE_THRESHOLDS
} from '../../types/OrparMemoryIntegrationTypes';
import { OrparMemoryEvents } from '../../events/event-definitions/OrparMemoryEvents';
import {
    KnowledgeGraphEvents,
    HighSurpriseRelationshipEventData,
} from '../../events/event-definitions/KnowledgeGraphEvents';
import { isKnowledgeGraphEnabled, isSurpriseDetectionEnabled } from '../../config/knowledge-graph.config';
import {
    getOrparMemoryConfig,
    isOrparMemoryIntegrationEnabled,
    getSurpriseThresholds
} from '../../config/orpar-memory.config';
import { AgentId, ChannelId } from '../../types/ChannelContext';
import { OrparPhase } from '../../types/MemoryUtilityTypes';

/**
 * Context for surprise processing
 */
interface SurpriseProcessingContext {
    /** Agent ID */
    agentId: AgentId;
    /** Channel ID */
    channelId: ChannelId;
    /** Cycle ID */
    cycleId: string;
    /** Current ORPAR phase */
    currentPhase: OrparPhase;
    /** Recent surprise scores (for momentum) */
    recentSurpriseScores: number[];
}

/**
 * SurpriseOrparAdapter converts surprise signals to ORPAR control decisions
 */
export class SurpriseOrparAdapter {
    private static instance: SurpriseOrparAdapter;
    private logger: Logger;
    private enabled: boolean = false;
    private thresholds: SurpriseThresholds;

    // Track surprise momentum per agent/cycle
    private surpriseMomentum: Map<string, number[]> = new Map();
    private readonly MAX_MOMENTUM_HISTORY = 10;

    private constructor() {
        this.logger = new Logger('info', 'SurpriseOrparAdapter');
        this.thresholds = DEFAULT_SURPRISE_THRESHOLDS;
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): SurpriseOrparAdapter {
        if (!SurpriseOrparAdapter.instance) {
            SurpriseOrparAdapter.instance = new SurpriseOrparAdapter();
        }
        return SurpriseOrparAdapter.instance;
    }

    /**
     * Initialize the SurpriseOrparAdapter
     */
    public initialize(): void {
        this.enabled = isOrparMemoryIntegrationEnabled();
        this.thresholds = getSurpriseThresholds();

        if (this.enabled) {
            this.logger.info('[SurpriseOrparAdapter] Initialized with ORPAR-Memory integration');
            this.logger.info(
                `[SurpriseOrparAdapter] Thresholds: high=${this.thresholds.high}, ` +
                `moderate=${this.thresholds.moderate}, plan=${this.thresholds.plan}, ` +
                `maxExtraObs=${this.thresholds.maxExtraObservations}`
            );

            // Set up Knowledge Graph surprise event listener if KG is enabled
            this.setupGraphSurpriseListener();
        } else {
            this.logger.debug('[SurpriseOrparAdapter] ORPAR-Memory integration is disabled');
        }
    }

    /**
     * Set up listener for Knowledge Graph surprise events
     *
     * Listens for HIGH_SURPRISE_RELATIONSHIP events from the Knowledge Graph
     * and converts them to ORPAR decisions, potentially triggering additional
     * observation cycles.
     */
    private setupGraphSurpriseListener(): void {
        // Only set up listener if Knowledge Graph surprise detection is enabled
        if (!isKnowledgeGraphEnabled() || !isSurpriseDetectionEnabled()) {
            this.logger.debug('[SurpriseOrparAdapter] Knowledge Graph surprise integration disabled');
            return;
        }

        EventBus.server.on(
            KnowledgeGraphEvents.HIGH_SURPRISE_RELATIONSHIP,
            (payload: { data: HighSurpriseRelationshipEventData; agentId?: AgentId; channelId?: ChannelId }) => {
                this.handleGraphSurpriseEvent(payload);
            }
        );

        this.logger.info('[SurpriseOrparAdapter] Knowledge Graph surprise listener registered');
    }

    /**
     * Handle a Knowledge Graph surprise event
     *
     * Converts high-surprise graph events to ORPAR decisions, potentially
     * triggering additional observation cycles or injecting context.
     *
     * @param payload - The graph surprise event payload
     */
    private handleGraphSurpriseEvent(payload: {
        data: HighSurpriseRelationshipEventData;
        agentId?: AgentId;
        channelId?: ChannelId;
    }): void {
        const { data, agentId, channelId } = payload;

        this.logger.info(
            `[SurpriseOrparAdapter] Received graph surprise event: ` +
            `score=${data.surpriseScore}, reason=${data.reason}`
        );

        // Emit surprise detected event for the graph event
        EventBus.server.emit(OrparMemoryEvents.SURPRISE_DETECTED, {
            agentId: agentId || 'system',
            channelId: channelId || data.channelId,
            cycleId: `graph-surprise-${Date.now()}`,
            surpriseScore: data.surpriseScore,
            surpriseType: 'novel_pattern',
            observation: `Graph surprise: ${data.reason}`,
            explanation: `A surprising relationship was detected: ${data.type} between entities ` +
                `${data.fromEntityId} and ${data.toEntityId}`
        });

        // If surprise is high enough, emit additional observation queued event
        if (data.surpriseScore >= this.thresholds.high) {
            const additionalObservations = Math.min(
                Math.ceil((data.surpriseScore - this.thresholds.high) / 0.1) + 1,
                this.thresholds.maxExtraObservations
            );

            EventBus.server.emit(OrparMemoryEvents.ADDITIONAL_OBSERVATION_QUEUED, {
                agentId: agentId || 'system',
                channelId: channelId || data.channelId,
                cycleId: `graph-surprise-${Date.now()}`,
                queuedCount: additionalObservations
            });

            this.logger.info(
                `[SurpriseOrparAdapter] Graph surprise triggered ${additionalObservations} ` +
                `additional observation cycles`
            );
        }
    }

    /**
     * Check if the adapter is enabled
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Process a surprise detection and return an ORPAR control decision
     *
     * @param surprise - The surprise detection result
     * @param context - Processing context
     * @returns The decision to make based on the surprise
     */
    public processSurprise(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): SurpriseOrparDecision {
        if (!this.enabled) {
            return this.createNoActionDecision(surprise);
        }

        // Track surprise momentum
        this.trackSurpriseMomentum(context.cycleId, surprise.surpriseScore);

        // Emit surprise detected event
        this.emitSurpriseDetectedEvent(surprise, context);

        // Determine decision based on surprise score and type
        let decision: SurpriseOrparDecision;

        if (surprise.surpriseScore >= this.thresholds.high) {
            decision = this.createReObserveDecision(surprise, context);
        } else if (surprise.surpriseScore >= this.thresholds.moderate) {
            // Check if we should extend reasoning based on momentum
            const momentum = this.calculateMomentum(context.cycleId);
            if (momentum > this.thresholds.moderate) {
                decision = this.createExtendReasoningDecision(surprise, context);
            } else {
                decision = this.createInjectContextDecision(surprise, context);
            }
        } else if (this.isPlanRelatedSurprise(surprise) && surprise.surpriseScore >= this.thresholds.plan) {
            decision = this.createPlanReconsiderationDecision(surprise, context);
        } else {
            decision = this.createNoActionDecision(surprise);
        }

        // Emit decision made event
        this.emitDecisionMadeEvent(decision, context);

        return decision;
    }

    /**
     * Create a NO_ACTION decision
     */
    private createNoActionDecision(surprise: SurpriseDetection): SurpriseOrparDecision {
        return {
            type: 'NO_ACTION',
            surpriseDetection: surprise,
            confidence: 1.0 - surprise.surpriseScore // High confidence when surprise is low
        };
    }

    /**
     * Create a RE_OBSERVE decision for high surprise
     */
    private createReObserveDecision(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): SurpriseOrparDecision {
        // Calculate number of additional observations based on surprise score
        const scoreAboveThreshold = surprise.surpriseScore - this.thresholds.high;
        const maxRange = 1.0 - this.thresholds.high;
        const proportion = maxRange > 0 ? scoreAboveThreshold / maxRange : 0;
        const additionalObservations = Math.min(
            Math.ceil(proportion * this.thresholds.maxExtraObservations) + 1,
            this.thresholds.maxExtraObservations
        );

        this.logger.info(
            `[SurpriseOrparAdapter] High surprise (${surprise.surpriseScore.toFixed(2)}) - ` +
            `triggering ${additionalObservations} additional observation cycle(s)`
        );

        // Emit observation queued event
        EventBus.server.emit(OrparMemoryEvents.ADDITIONAL_OBSERVATION_QUEUED, {
            agentId: context.agentId,
            channelId: context.channelId,
            cycleId: context.cycleId,
            queuedCount: additionalObservations
        });

        return {
            type: 'RE_OBSERVE',
            additionalObservations,
            surpriseDetection: surprise,
            confidence: surprise.surpriseScore // Higher surprise = higher confidence in decision
        };
    }

    /**
     * Create an INJECT_CONTEXT decision for moderate surprise
     */
    private createInjectContextDecision(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): SurpriseOrparDecision {
        const surpriseContext: SurpriseContext = {
            observation: surprise.observation,
            explanation: surprise.explanation ?? 'Unexpected observation detected',
            violatedExpectation: surprise.expectation
                ? String(surprise.expectation.expected)
                : undefined,
            focusAreas: this.determineFocusAreas(surprise),
            surpriseScore: surprise.surpriseScore
        };

        this.logger.info(
            `[SurpriseOrparAdapter] Moderate surprise (${surprise.surpriseScore.toFixed(2)}) - ` +
            `injecting context into reasoning`
        );

        // Emit context injected event
        EventBus.server.emit(OrparMemoryEvents.SURPRISE_CONTEXT_INJECTED, {
            agentId: context.agentId,
            channelId: context.channelId,
            cycleId: context.cycleId,
            surpriseScore: surprise.surpriseScore,
            focusAreas: surpriseContext.focusAreas
        });

        return {
            type: 'INJECT_CONTEXT',
            surpriseContext,
            surpriseDetection: surprise,
            confidence: 0.7 // Moderate confidence for moderate surprise
        };
    }

    /**
     * Create an EXTEND_REASONING decision based on momentum
     */
    private createExtendReasoningDecision(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): SurpriseOrparDecision {
        this.logger.info(
            `[SurpriseOrparAdapter] Surprise momentum detected - extending reasoning phase`
        );

        // Also inject context
        const surpriseContext: SurpriseContext = {
            observation: surprise.observation,
            explanation: surprise.explanation ?? 'Accumulated surprise detected',
            focusAreas: this.determineFocusAreas(surprise),
            surpriseScore: surprise.surpriseScore
        };

        return {
            type: 'EXTEND_REASONING',
            extendReasoning: true,
            surpriseContext,
            surpriseDetection: surprise,
            confidence: 0.6
        };
    }

    /**
     * Create a RECONSIDER_PLAN decision
     */
    private createPlanReconsiderationDecision(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): SurpriseOrparDecision {
        const planInfo: PlanReconsiderationInfo = {
            reason: surprise.explanation ?? 'Plan-related surprise detected',
            aspectsToReview: this.determineAspectsToReview(surprise),
            alternativesToConsider: surprise.suggestedActions ?? [],
            severity: this.determineSeverity(surprise.surpriseScore)
        };

        this.logger.info(
            `[SurpriseOrparAdapter] Plan surprise (${surprise.surpriseScore.toFixed(2)}) - ` +
            `flagging plan for reconsideration (severity: ${planInfo.severity})`
        );

        // Emit plan reconsideration event
        EventBus.server.emit(OrparMemoryEvents.PLAN_RECONSIDERATION_TRIGGERED, {
            agentId: context.agentId,
            channelId: context.channelId,
            cycleId: context.cycleId,
            reason: planInfo.reason,
            severity: planInfo.severity
        });

        return {
            type: 'RECONSIDER_PLAN',
            planReconsideration: planInfo,
            surpriseDetection: surprise,
            confidence: surprise.surpriseScore * 0.9 // Slightly less confident for plan changes
        };
    }

    /**
     * Check if surprise is related to planning
     */
    private isPlanRelatedSurprise(surprise: SurpriseDetection): boolean {
        const planRelatedTypes: SurpriseType[] = [
            'prediction_failure',
            'performance_deviation',
            'unexpected_error'
        ];
        return surprise.type !== undefined && planRelatedTypes.includes(surprise.type);
    }

    /**
     * Determine focus areas based on surprise type
     */
    private determineFocusAreas(surprise: SurpriseDetection): string[] {
        const focusAreas: string[] = [];

        switch (surprise.type) {
            case 'schema_violation':
                focusAreas.push('data structure validation', 'schema compatibility');
                break;
            case 'prediction_failure':
                focusAreas.push('model assumptions', 'prediction accuracy');
                break;
            case 'anomaly':
                focusAreas.push('statistical patterns', 'outlier analysis');
                break;
            case 'novel_pattern':
                focusAreas.push('pattern recognition', 'new information integration');
                break;
            case 'context_mismatch':
                focusAreas.push('context understanding', 'state consistency');
                break;
            case 'performance_deviation':
                focusAreas.push('performance metrics', 'resource utilization');
                break;
            case 'unexpected_error':
                focusAreas.push('error handling', 'failure recovery');
                break;
            case 'unexpected_success':
                focusAreas.push('success factors', 'approach validation');
                break;
            default:
                focusAreas.push('general observation', 'context analysis');
        }

        return focusAreas;
    }

    /**
     * Determine aspects of plan to review based on surprise
     */
    private determineAspectsToReview(surprise: SurpriseDetection): string[] {
        const aspects: string[] = [];

        if (surprise.type === 'prediction_failure') {
            aspects.push('action sequence', 'expected outcomes');
        }
        if (surprise.type === 'performance_deviation') {
            aspects.push('resource allocation', 'timing estimates');
        }
        if (surprise.type === 'unexpected_error') {
            aspects.push('error handling steps', 'fallback strategies');
        }

        // Always include these
        aspects.push('assumptions', 'dependencies');

        return aspects;
    }

    /**
     * Determine severity based on surprise score
     */
    private determineSeverity(score: number): 'low' | 'medium' | 'high' {
        if (score >= 0.8) return 'high';
        if (score >= 0.6) return 'medium';
        return 'low';
    }

    /**
     * Track surprise momentum for a cycle
     */
    private trackSurpriseMomentum(cycleId: string, score: number): void {
        let history = this.surpriseMomentum.get(cycleId);
        if (!history) {
            history = [];
            this.surpriseMomentum.set(cycleId, history);
        }

        history.push(score);

        // Limit history size
        if (history.length > this.MAX_MOMENTUM_HISTORY) {
            history.shift();
        }
    }

    /**
     * Calculate surprise momentum (average of recent surprises)
     */
    private calculateMomentum(cycleId: string): number {
        const history = this.surpriseMomentum.get(cycleId);
        if (!history || history.length === 0) {
            return 0;
        }

        const sum = history.reduce((a, b) => a + b, 0);
        return sum / history.length;
    }

    /**
     * Clear momentum tracking for a cycle
     */
    public clearMomentum(cycleId: string): void {
        this.surpriseMomentum.delete(cycleId);
    }

    /**
     * Emit surprise detected event
     */
    private emitSurpriseDetectedEvent(
        surprise: SurpriseDetection,
        context: SurpriseProcessingContext
    ): void {
        EventBus.server.emit(OrparMemoryEvents.SURPRISE_DETECTED, {
            agentId: context.agentId,
            channelId: context.channelId,
            cycleId: context.cycleId,
            surpriseScore: surprise.surpriseScore,
            surpriseType: surprise.type ?? 'unknown',
            observation: surprise.observation,
            explanation: surprise.explanation
        });
    }

    /**
     * Emit decision made event
     */
    private emitDecisionMadeEvent(
        decision: SurpriseOrparDecision,
        context: SurpriseProcessingContext
    ): void {
        EventBus.server.emit(OrparMemoryEvents.SURPRISE_DECISION_MADE, {
            agentId: context.agentId,
            channelId: context.channelId,
            cycleId: context.cycleId,
            decision
        });
    }

    /**
     * Reset the adapter (useful for testing)
     */
    public reset(): void {
        this.enabled = false;
        this.surpriseMomentum.clear();
    }
}
