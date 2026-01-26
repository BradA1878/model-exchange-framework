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
 * InferenceParameterService.ts
 *
 * Service for managing dynamic inference parameters within MXF.
 * This service handles:
 * - Configuration hierarchy resolution (task -> agent -> channel -> defaults)
 * - Parameter override state management
 * - Request governance (budget limits, rate limits, permissions)
 * - Cost estimation and tracking
 *
 * @see TR-2: Configuration Hierarchy
 * @see TR-6: Request Evaluation Pipeline
 * @see TR-8: State Management
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../shared/types/ChannelContext';
import { LlmProviderType } from '../../../shared/protocols/mcp/LlmProviders';
import {
    PhaseParameterProfile,
    OrparPhaseProfiles,
    OrparPhase,
    ParameterOverrideScope,
    ResetParameterScope,
    InferenceParameterRequest,
    InferenceParameterResponse,
    InferenceParameterRequestStatus,
    ParameterGovernanceConfig,
    ParameterOverrideState,
    ParameterResolutionContext,
    ParameterUsageMetrics,
    ParameterCostEstimate
} from '../../../shared/types/InferenceParameterTypes';
import {
    DEFAULT_PHASE_PROFILES,
    PROVIDER_PHASE_PROFILES,
    DEFAULT_GOVERNANCE_CONFIG,
    MODEL_COST_ESTIMATES,
    getPhaseProfile,
    getProviderProfiles,
    estimateCost,
    validateProfileAgainstGovernance,
    mergeWithDefaults
} from '../../../shared/constants/DefaultPhaseProfiles';

const logger = new Logger('debug', 'InferenceParameterService', 'server');

/**
 * Request tracking for rate limiting
 */
interface RequestTracker {
    taskId: string;
    phaseRequests: Map<OrparPhase, number>;
    totalRequests: number;
    totalCost: number;
    lastRequestTime: number;
}

/**
 * InferenceParameterService
 *
 * Centralized service for managing inference parameters across the MXF framework.
 * Provides parameter resolution, override management, and governance enforcement.
 */
export class InferenceParameterService {
    private static instance: InferenceParameterService;
    private logger = logger;
    private eventBus = EventBus.server;

    // Provider configuration
    private providerType: LlmProviderType;

    // Override state management
    private activeOverrides = new Map<string, ParameterOverrideState>();

    // Request tracking for rate limiting
    private requestTrackers = new Map<string, RequestTracker>();

    // Agent and channel configurations (loaded from external sources)
    private agentConfigs = new Map<AgentId, Partial<OrparPhaseProfiles>>();
    private channelDefaults = new Map<ChannelId, Partial<OrparPhaseProfiles>>();

    // Governance configurations per agent/channel
    private governanceConfigs = new Map<string, ParameterGovernanceConfig>();

    // Usage metrics for analytics
    private usageMetrics: ParameterUsageMetrics[] = [];
    private maxMetricsHistory = 10000;

    // Cleanup configuration
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly OVERRIDE_TTL = 3600000; // 1 hour max override lifetime
    private readonly CLEANUP_INTERVAL = 60000; // 1 minute cleanup interval

    // Event subscriptions for cleanup
    private eventSubscriptions: Array<{ unsubscribe: () => void }> = [];

    private constructor(providerType: LlmProviderType = LlmProviderType.OPENROUTER) {
        this.providerType = providerType;
        this.initializeCleanup();
        this.setupEventListeners();
        this.logger.info('InferenceParameterService initialized');
    }

    /**
     * Get singleton instance
     */
    public static getInstance(providerType?: LlmProviderType): InferenceParameterService {
        if (!InferenceParameterService.instance) {
            InferenceParameterService.instance = new InferenceParameterService(providerType);
        }
        return InferenceParameterService.instance;
    }

    /**
     * Initialize cleanup timer for stale overrides
     */
    private initializeCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleOverrides();
            this.cleanupStaleTrackers();
        }, this.CLEANUP_INTERVAL);
    }

    /**
     * Setup event listeners for task completion, phase transitions, and session end
     */
    private setupEventListeners(): void {
        // Listen for task completion to clean up task-scoped overrides
        const taskSub = this.eventBus.on(Events.Task.COMPLETED, (payload: any) => {
            this.handleTaskCompletion(payload.data?.taskId);
        });
        if (taskSub) this.eventSubscriptions.push(taskSub);

        // Listen for reflection events to clean up phase-scoped overrides
        // Reflection marks the completion of an ORPAR cycle
        const reflectionSub = this.eventBus.on(Events.ControlLoop.REFLECTION, (payload: any) => {
            this.handlePhaseCompletion(
                payload.data?.agentId,
                payload.data?.channelId,
                payload.data?.phase || 'reflection'
            );
        });
        if (reflectionSub) this.eventSubscriptions.push(reflectionSub);

        // Listen for agent disconnect to clean up session-scoped overrides
        const disconnectSub = this.eventBus.on(Events.Agent.DISCONNECTED, (payload: any) => {
            this.handleSessionEnd(payload.data?.agentId);
        });
        if (disconnectSub) this.eventSubscriptions.push(disconnectSub);
    }

    /**
     * Handle session end (agent disconnect) - clean up session-scoped overrides
     */
    private handleSessionEnd(agentId: AgentId): void {
        if (!agentId) return;

        let cleaned = 0;
        for (const [id, override] of this.activeOverrides) {
            if (override.agentId === agentId && override.scope === 'session') {
                this.activeOverrides.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.debug(`Cleaned up ${cleaned} session override(s) for disconnected agent ${agentId}`);
        }
    }

    /**
     * Resolve the parameter profile for a given context
     *
     * Resolution order (highest to lowest priority):
     * 1. Active overrides (task-level, from request_inference_params)
     * 2. Task-level configuration
     * 3. Agent-level configuration
     * 4. Channel-level defaults
     * 5. System-wide defaults
     *
     * @see TR-2: Configuration Hierarchy
     */
    public resolveParameters(context: ParameterResolutionContext): PhaseParameterProfile {
        const { agentId, channelId, phase, taskId, taskOverrides, agentConfig, channelDefaults } = context;

        // Start with system defaults for the provider
        let resolvedProfile = getPhaseProfile(this.providerType, phase);

        // Apply channel-level defaults (lowest priority override)
        const channelConfig = channelDefaults || this.channelDefaults.get(channelId);
        if (channelConfig?.[phase]) {
            resolvedProfile = mergeWithDefaults(channelConfig[phase]!, resolvedProfile);
        }

        // Apply agent-level configuration
        const storedAgentConfig = agentConfig || this.agentConfigs.get(agentId);
        if (storedAgentConfig?.[phase]) {
            resolvedProfile = mergeWithDefaults(storedAgentConfig[phase]!, resolvedProfile);
        }

        // Apply task-level overrides
        if (taskOverrides) {
            resolvedProfile = mergeWithDefaults(taskOverrides, resolvedProfile);
        }

        // Apply active runtime overrides (highest priority)
        const activeOverride = this.getActiveOverride(agentId, channelId, phase, taskId);
        if (activeOverride) {
            resolvedProfile = mergeWithDefaults(activeOverride.params, resolvedProfile);
            this.logger.debug(
                `Applied active override ${activeOverride.id} for ${agentId}:${channelId}:${phase}`
            );

            // If this is a 'next_call' override, mark it as consumed
            if (activeOverride.scope === 'next_call') {
                activeOverride.consumed = true;
            }
        }

        this.logger.debug(
            `Resolved parameters for ${agentId}:${channelId}:${phase}: model=${resolvedProfile.model}, temp=${resolvedProfile.temperature}`
        );

        return resolvedProfile;
    }

    /**
     * Process an inference parameter request from an agent
     *
     * @see TR-6: Request Evaluation Pipeline
     */
    public async processParameterRequest(
        agentId: AgentId,
        channelId: ChannelId,
        taskId: string | undefined,
        phase: OrparPhase,
        request: InferenceParameterRequest
    ): Promise<InferenceParameterResponse> {
        this.logger.info(
            `Processing parameter request from ${agentId} for ${phase}: ${request.reason}`
        );

        // Step 1: Get governance configuration
        const governance = this.getGovernanceConfig(agentId, channelId);

        // Step 2: Get current profile as baseline
        const currentProfile = this.resolveParameters({
            agentId,
            channelId,
            phase,
            taskId
        });

        // Step 3: Build suggested profile
        const suggestedProfile = mergeWithDefaults(request.suggested, currentProfile);

        // Step 4: Validate against governance constraints
        const validation = validateProfileAgainstGovernance(suggestedProfile, governance);

        // Step 5: Check rate limits
        const rateLimitCheck = this.checkRateLimits(agentId, channelId, taskId, phase, governance);

        // Step 6: Estimate cost delta
        const currentCost = this.estimateProfileCost(currentProfile);
        const suggestedCost = this.estimateProfileCost(suggestedProfile);
        const costDelta = suggestedCost - currentCost;

        // Step 7: Check budget limits
        const budgetCheck = this.checkBudgetLimits(
            agentId,
            channelId,
            taskId,
            costDelta,
            governance
        );

        // Step 8: Determine response status
        let status: InferenceParameterRequestStatus;
        let activeParams: PhaseParameterProfile;
        let rationale: string | undefined;

        if (!rateLimitCheck.allowed) {
            status = 'denied';
            activeParams = currentProfile;
            rationale = rateLimitCheck.reason;
        } else if (!budgetCheck.allowed) {
            status = 'denied';
            activeParams = currentProfile;
            rationale = budgetCheck.reason;
        } else if (!validation.valid) {
            // Try to modify the request to meet constraints
            const modifiedProfile = this.modifyToMeetConstraints(suggestedProfile, governance);
            if (modifiedProfile) {
                status = 'modified';
                activeParams = modifiedProfile;
                rationale = `Original request modified to meet constraints: ${validation.violations.join(', ')}`;
            } else {
                status = 'denied';
                activeParams = currentProfile;
                rationale = `Cannot meet governance constraints: ${validation.violations.join(', ')}`;
            }
        } else {
            status = 'approved';
            activeParams = suggestedProfile;
        }

        // Step 9: Create and store override if approved or modified
        let overrideId: string | undefined;
        let expiresAt: number | undefined;

        if (status === 'approved' || status === 'modified') {
            const override = this.createOverride(
                agentId,
                channelId,
                taskId,
                phase,
                request.scope || 'next_call',
                activeParams,
                request.reason
            );
            overrideId = override.id;
            expiresAt = override.expiresAt;

            // Update request tracking
            this.updateRequestTracker(agentId, channelId, taskId, phase, costDelta);
        }

        // Step 10: Log the decision
        this.logParameterDecision(agentId, channelId, phase, request, status, rationale);

        // Step 11: Emit event for analytics
        this.emitParameterEvent(agentId, channelId, phase, status, costDelta);

        return {
            status,
            activeParams,
            previousParams: currentProfile,
            rationale,
            costDelta: status !== 'denied' ? costDelta : 0,
            overrideId,
            expiresAt
        };
    }

    /**
     * Get active override for a specific context
     */
    private getActiveOverride(
        agentId: AgentId,
        channelId: ChannelId,
        phase: OrparPhase,
        taskId?: string
    ): ParameterOverrideState | undefined {
        const now = Date.now();

        // Check for active overrides in priority order
        for (const [id, override] of this.activeOverrides) {
            // Skip if expired
            if (override.expiresAt && override.expiresAt < now) {
                continue;
            }

            // Skip if already consumed (for next_call scope)
            if (override.consumed) {
                continue;
            }

            // Check if override applies to this context
            if (override.agentId !== agentId || override.channelId !== channelId) {
                continue;
            }

            // Check scope-specific matching
            switch (override.scope) {
                case 'next_call':
                    // Applies to any phase, used once
                    return override;

                case 'session':
                    // Applies to any phase for the duration of the session
                    return override;

                case 'task':
                    // Must match the task ID
                    if (override.taskId === taskId) {
                        return override;
                    }
                    break;

                case 'current_phase':
                    // Must match the current phase (ORPAR-specific)
                    if (override.phase === phase) {
                        return override;
                    }
                    break;
            }
        }

        return undefined;
    }

    /**
     * Create a new parameter override
     */
    private createOverride(
        agentId: AgentId,
        channelId: ChannelId,
        taskId: string | undefined,
        phase: OrparPhase,
        scope: ParameterOverrideScope,
        params: Partial<PhaseParameterProfile>,
        reason: string
    ): ParameterOverrideState {
        const id = uuidv4();
        const now = Date.now();

        // Calculate expiration based on scope
        let expiresAt: number | undefined;
        switch (scope) {
            case 'next_call':
                expiresAt = now + 300000; // 5 minutes max
                break;
            case 'session':
                // 24h TTL as safety net - also cleared on socket disconnect or explicit reset
                expiresAt = now + 86400000; // 24 hours max
                break;
            case 'task':
                expiresAt = now + this.OVERRIDE_TTL; // 1 hour max
                break;
            case 'current_phase':
                expiresAt = now + 1800000; // 30 minutes max (ORPAR only)
                break;
        }

        const override: ParameterOverrideState = {
            id,
            agentId,
            channelId,
            taskId,
            phase,
            scope,
            params,
            createdAt: now,
            expiresAt,
            consumed: false,
            reason
        };

        this.activeOverrides.set(id, override);
        this.logger.debug(`Created override ${id} for ${agentId}:${channelId}:${phase} with scope ${scope}`);

        return override;
    }

    /**
     * Get governance configuration for agent/channel
     */
    private getGovernanceConfig(agentId: AgentId, channelId: ChannelId): ParameterGovernanceConfig {
        // Check for agent-specific governance
        const agentKey = `agent:${agentId}`;
        if (this.governanceConfigs.has(agentKey)) {
            return this.governanceConfigs.get(agentKey)!;
        }

        // Check for channel-specific governance
        const channelKey = `channel:${channelId}`;
        if (this.governanceConfigs.has(channelKey)) {
            return this.governanceConfigs.get(channelKey)!;
        }

        // Return default governance
        return DEFAULT_GOVERNANCE_CONFIG;
    }

    /**
     * Check rate limits for parameter requests
     */
    private checkRateLimits(
        agentId: AgentId,
        channelId: ChannelId,
        taskId: string | undefined,
        phase: OrparPhase,
        governance: ParameterGovernanceConfig
    ): { allowed: boolean; reason?: string } {
        const trackerKey = `${agentId}:${channelId}:${taskId || 'no-task'}`;
        const tracker = this.requestTrackers.get(trackerKey);

        if (!tracker) {
            return { allowed: true };
        }

        // Check per-phase limit
        const phaseRequests = tracker.phaseRequests.get(phase) || 0;
        if (governance.maxRequestsPerPhase && phaseRequests >= governance.maxRequestsPerPhase) {
            return {
                allowed: false,
                reason: `Rate limit exceeded: ${phaseRequests}/${governance.maxRequestsPerPhase} requests per phase`
            };
        }

        // Check per-task limit
        if (governance.maxRequestsPerTask && tracker.totalRequests >= governance.maxRequestsPerTask) {
            return {
                allowed: false,
                reason: `Rate limit exceeded: ${tracker.totalRequests}/${governance.maxRequestsPerTask} requests per task`
            };
        }

        return { allowed: true };
    }

    /**
     * Check budget limits for parameter requests
     */
    private checkBudgetLimits(
        agentId: AgentId,
        channelId: ChannelId,
        taskId: string | undefined,
        costDelta: number,
        governance: ParameterGovernanceConfig
    ): { allowed: boolean; reason?: string } {
        // Check per-call cost limit
        if (governance.maxCostPerCall && costDelta > governance.maxCostPerCall) {
            return {
                allowed: false,
                reason: `Cost exceeds per-call limit: $${costDelta.toFixed(4)} > $${governance.maxCostPerCall}`
            };
        }

        // Check per-task cost limit
        const trackerKey = `${agentId}:${channelId}:${taskId || 'no-task'}`;
        const tracker = this.requestTrackers.get(trackerKey);

        if (tracker && governance.maxCostPerTask) {
            const projectedCost = tracker.totalCost + costDelta;
            if (projectedCost > governance.maxCostPerTask) {
                return {
                    allowed: false,
                    reason: `Cost exceeds per-task limit: $${projectedCost.toFixed(4)} > $${governance.maxCostPerTask}`
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Estimate the cost of a parameter profile
     */
    private estimateProfileCost(profile: PhaseParameterProfile): number {
        // Estimate based on typical input/output for a single call
        const typicalInputTokens = 2000;
        const estimatedOutputTokens = profile.maxOutputTokens / 2; // Assume 50% utilization

        return estimateCost(
            profile.model,
            typicalInputTokens,
            estimatedOutputTokens,
            profile.reasoningTokens
        );
    }

    /**
     * Try to modify a profile to meet governance constraints
     */
    private modifyToMeetConstraints(
        profile: PhaseParameterProfile,
        governance: ParameterGovernanceConfig
    ): PhaseParameterProfile | null {
        const modified = { ...profile };

        // Try to fix temperature constraints
        if (governance.minTemperature !== undefined && modified.temperature < governance.minTemperature) {
            modified.temperature = governance.minTemperature;
        }
        if (governance.maxTemperature !== undefined && modified.temperature > governance.maxTemperature) {
            modified.temperature = governance.maxTemperature;
        }

        // Try to fix reasoning tokens
        if (governance.maxReasoningTokens !== undefined && modified.reasoningTokens > governance.maxReasoningTokens) {
            modified.reasoningTokens = governance.maxReasoningTokens;
        }

        // Try to fix output tokens
        if (governance.maxOutputTokens !== undefined && modified.maxOutputTokens > governance.maxOutputTokens) {
            modified.maxOutputTokens = governance.maxOutputTokens;
        }

        // Check if model is allowed - if not, we cannot modify to fix this
        if (governance.allowedModels && governance.allowedModels.length > 0) {
            if (!governance.allowedModels.includes(modified.model)) {
                // Try to find an allowed model that's similar
                const defaultProfile = getPhaseProfile(this.providerType, 'observation');
                if (governance.allowedModels.includes(defaultProfile.model)) {
                    modified.model = defaultProfile.model;
                } else {
                    // Use first allowed model as fallback
                    modified.model = governance.allowedModels[0];
                }
            }
        }

        // Validate the modified profile
        const validation = validateProfileAgainstGovernance(modified, governance);
        return validation.valid ? modified : null;
    }

    /**
     * Update request tracker for rate limiting
     */
    private updateRequestTracker(
        agentId: AgentId,
        channelId: ChannelId,
        taskId: string | undefined,
        phase: OrparPhase,
        costDelta: number
    ): void {
        const trackerKey = `${agentId}:${channelId}:${taskId || 'no-task'}`;
        let tracker = this.requestTrackers.get(trackerKey);

        if (!tracker) {
            tracker = {
                taskId: taskId || 'no-task',
                phaseRequests: new Map(),
                totalRequests: 0,
                totalCost: 0,
                lastRequestTime: Date.now()
            };
            this.requestTrackers.set(trackerKey, tracker);
        }

        tracker.phaseRequests.set(phase, (tracker.phaseRequests.get(phase) || 0) + 1);
        tracker.totalRequests++;
        tracker.totalCost += costDelta;
        tracker.lastRequestTime = Date.now();
    }

    /**
     * Log parameter decision for audit trail
     */
    private logParameterDecision(
        agentId: AgentId,
        channelId: ChannelId,
        phase: OrparPhase,
        request: InferenceParameterRequest,
        status: InferenceParameterRequestStatus,
        rationale?: string
    ): void {
        const logEntry = {
            timestamp: new Date().toISOString(),
            agentId,
            channelId,
            phase,
            reason: request.reason,
            suggested: request.suggested,
            scope: request.scope,
            status,
            rationale
        };

        this.logger.info(`Parameter decision: ${JSON.stringify(logEntry)}`);
    }

    /**
     * Emit parameter event for analytics
     */
    private emitParameterEvent(
        agentId: AgentId,
        channelId: ChannelId,
        phase: OrparPhase,
        status: InferenceParameterRequestStatus,
        costDelta: number
    ): void {
        this.eventBus.emit(
            Events.InferenceParameter.PARAMETER_REQUESTED,
            createBaseEventPayload(
                Events.InferenceParameter.PARAMETER_REQUESTED,
                agentId,
                channelId,
                {
                    phase,
                    status,
                    costDelta
                }
            )
        );
    }

    /**
     * Record usage metrics for analytics
     */
    public recordUsageMetrics(metrics: ParameterUsageMetrics): void {
        this.usageMetrics.push(metrics);

        // Trim to max history
        if (this.usageMetrics.length > this.maxMetricsHistory) {
            this.usageMetrics = this.usageMetrics.slice(-this.maxMetricsHistory);
        }

        // Emit for real-time analytics
        // Note: metrics contains agentId/channelId if available
        const agentId = (metrics as any).agentId || 'system:inference-service';
        const channelId = (metrics as any).channelId || 'system:inference';

        this.eventBus.emit(
            Events.InferenceParameter.PARAMETER_USAGE_RECORDED,
            createBaseEventPayload(
                Events.InferenceParameter.PARAMETER_USAGE_RECORDED,
                agentId,
                channelId,
                {
                    phase: metrics.phase,
                    model: metrics.profile.model,
                    inputTokens: metrics.tokensUsed.input,
                    outputTokens: metrics.tokensUsed.output,
                    reasoningTokens: metrics.tokensUsed.reasoning,
                    latencyMs: metrics.latencyMs,
                    actualCost: metrics.actualCost,
                    success: metrics.success
                }
            )
        );
    }

    /**
     * Get usage metrics for analytics
     */
    public getUsageMetrics(
        filter?: {
            agentId?: AgentId;
            phase?: OrparPhase;
            startTime?: number;
            endTime?: number;
        }
    ): ParameterUsageMetrics[] {
        let metrics = this.usageMetrics;

        if (filter) {
            if (filter.startTime) {
                metrics = metrics.filter(m => m.timestamp >= filter.startTime!);
            }
            if (filter.endTime) {
                metrics = metrics.filter(m => m.timestamp <= filter.endTime!);
            }
            if (filter.phase) {
                metrics = metrics.filter(m => m.phase === filter.phase);
            }
        }

        return metrics;
    }

    /**
     * Handle task completion - clean up task-scoped overrides
     */
    private handleTaskCompletion(taskId: string): void {
        if (!taskId) return;

        for (const [id, override] of this.activeOverrides) {
            if (override.taskId === taskId && override.scope === 'task') {
                this.activeOverrides.delete(id);
                this.logger.debug(`Cleaned up task override ${id} for completed task ${taskId}`);
            }
        }

        // Clean up tracker
        for (const [key, tracker] of this.requestTrackers) {
            if (tracker.taskId === taskId) {
                this.requestTrackers.delete(key);
            }
        }
    }

    /**
     * Handle phase completion - clean up phase-scoped overrides
     */
    private handlePhaseCompletion(agentId: AgentId, channelId: ChannelId, phase: OrparPhase): void {
        if (!agentId || !channelId || !phase) return;

        for (const [id, override] of this.activeOverrides) {
            if (
                override.agentId === agentId &&
                override.channelId === channelId &&
                override.phase === phase &&
                override.scope === 'current_phase'
            ) {
                this.activeOverrides.delete(id);
                this.logger.debug(`Cleaned up phase override ${id} for completed phase ${phase}`);
            }
        }
    }

    /**
     * Reset parameters for an agent - explicit tool for reverting to defaults
     *
     * @param agentId - The agent requesting the reset
     * @param channelId - The channel context
     * @param scope - Which overrides to reset: 'all', 'session', or 'task'
     * @param taskId - The task ID (required when scope is 'task')
     * @returns Number of overrides that were reset
     */
    public resetParameters(
        agentId: AgentId,
        channelId: ChannelId,
        scope: ResetParameterScope,
        taskId?: string
    ): { resetCount: number; message: string } {
        let resetCount = 0;
        const overridesToDelete: string[] = [];

        for (const [id, override] of this.activeOverrides) {
            // Only reset overrides for this agent/channel
            if (override.agentId !== agentId || override.channelId !== channelId) {
                continue;
            }

            let shouldDelete = false;

            switch (scope) {
                case 'all':
                    // Reset all overrides for this agent
                    shouldDelete = true;
                    break;

                case 'session':
                    // Only reset session-scoped overrides
                    if (override.scope === 'session') {
                        shouldDelete = true;
                    }
                    break;

                case 'task':
                    // Only reset task-scoped overrides for the specified task
                    if (override.scope === 'task' && override.taskId === taskId) {
                        shouldDelete = true;
                    }
                    break;
            }

            if (shouldDelete) {
                overridesToDelete.push(id);
            }
        }

        // Delete the marked overrides
        for (const id of overridesToDelete) {
            this.activeOverrides.delete(id);
            resetCount++;
        }

        const message = resetCount > 0
            ? `Reset ${resetCount} parameter override(s) with scope '${scope}'`
            : `No parameter overrides to reset with scope '${scope}'`;

        this.logger.info(`Parameter reset for ${agentId}:${channelId}: ${message}`);

        // Emit reset event for analytics
        this.eventBus.emit(
            Events.InferenceParameter.PARAMETER_RESET,
            createBaseEventPayload(
                Events.InferenceParameter.PARAMETER_RESET,
                agentId,
                channelId,
                {
                    scope,
                    resetCount,
                    taskId
                }
            )
        );

        return { resetCount, message };
    }

    /**
     * Clean up stale overrides
     */
    private cleanupStaleOverrides(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, override] of this.activeOverrides) {
            // Remove expired overrides
            if (override.expiresAt && override.expiresAt < now) {
                this.activeOverrides.delete(id);
                cleaned++;
                continue;
            }

            // Remove consumed next_call overrides
            if (override.scope === 'next_call' && override.consumed) {
                this.activeOverrides.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.debug(`Cleaned up ${cleaned} stale parameter overrides`);
        }
    }

    /**
     * Clean up stale request trackers
     */
    private cleanupStaleTrackers(): void {
        const now = Date.now();
        const staleThreshold = 3600000; // 1 hour
        let cleaned = 0;

        for (const [key, tracker] of this.requestTrackers) {
            if (now - tracker.lastRequestTime > staleThreshold) {
                this.requestTrackers.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.debug(`Cleaned up ${cleaned} stale request trackers`);
        }
    }

    /**
     * Set agent configuration
     */
    public setAgentConfig(agentId: AgentId, config: Partial<OrparPhaseProfiles>): void {
        this.agentConfigs.set(agentId, config);
        this.logger.debug(`Set agent config for ${agentId}`);
    }

    /**
     * Set channel defaults
     */
    public setChannelDefaults(channelId: ChannelId, defaults: Partial<OrparPhaseProfiles>): void {
        this.channelDefaults.set(channelId, defaults);
        this.logger.debug(`Set channel defaults for ${channelId}`);
    }

    /**
     * Set governance configuration
     */
    public setGovernanceConfig(
        scope: 'agent' | 'channel',
        id: string,
        config: ParameterGovernanceConfig
    ): void {
        const key = `${scope}:${id}`;
        this.governanceConfigs.set(key, config);
        this.logger.debug(`Set governance config for ${key}`);
    }

    /**
     * Get current service statistics
     */
    public getStats(): {
        activeOverrides: number;
        requestTrackers: number;
        agentConfigs: number;
        channelDefaults: number;
        usageMetrics: number;
    } {
        return {
            activeOverrides: this.activeOverrides.size,
            requestTrackers: this.requestTrackers.size,
            agentConfigs: this.agentConfigs.size,
            channelDefaults: this.channelDefaults.size,
            usageMetrics: this.usageMetrics.length
        };
    }

    /**
     * Shutdown the service
     */
    public shutdown(): void {
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Unsubscribe from all event listeners
        for (const subscription of this.eventSubscriptions) {
            try {
                subscription.unsubscribe();
            } catch {
                // Ignore errors during unsubscribe
            }
        }
        this.eventSubscriptions = [];

        // Clear state
        this.activeOverrides.clear();
        this.requestTrackers.clear();
        this.usageMetrics = [];
        this.logger.info('InferenceParameterService shutdown complete');
    }
}

// Export singleton instance getter
export const getInferenceParameterService = (
    providerType?: LlmProviderType
): InferenceParameterService => {
    return InferenceParameterService.getInstance(providerType);
};
