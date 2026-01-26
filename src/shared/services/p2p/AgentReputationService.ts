/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * 
 * Agent Reputation Service (P9 Foundation)
 * EXPERIMENTAL: Foundation for agent reputation tracking
 * Disabled by default via feature flags
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import {
    AgentReputationMetrics,
    AgentReputationUpdate,
    ReputationHistoryEntry,
    P2PFeatureFlags,
    DEFAULT_P2P_FEATURE_FLAGS
} from '../../types/DecentralizationTypes';
import { AgentId } from '../../types/Agent';

export class AgentReputationService {
    private static instance: AgentReputationService;
    private readonly logger: Logger;
    private featureFlags: P2PFeatureFlags;
    private reputationStore = new Map<AgentId, AgentReputationMetrics>();

    private constructor(featureFlags: P2PFeatureFlags = DEFAULT_P2P_FEATURE_FLAGS) {
        this.logger = new Logger('debug', 'AgentReputationService', 'server');
        this.featureFlags = featureFlags;

        if (this.isEnabled()) {
            this.logger.info('Agent Reputation System initialized (EXPERIMENTAL)');
            this.setupEventListeners();
        } else {
            this.logger.info('Agent Reputation System disabled by feature flags');
        }
    }

    public static getInstance(featureFlags?: P2PFeatureFlags): AgentReputationService {
        if (!AgentReputationService.instance) {
            AgentReputationService.instance = new AgentReputationService(featureFlags);
        }
        return AgentReputationService.instance;
    }

    /**
     * Reset the singleton instance (for testing only)
     */
    public static resetInstance(): void {
        AgentReputationService.instance = undefined as unknown as AgentReputationService;
    }

    private isEnabled(): boolean {
        return (
            this.featureFlags.P2P_ENABLED &&
            this.featureFlags.P2P_REPUTATION_SYSTEM_ENABLED
        );
    }

    private setupEventListeners(): void {
        EventBus.server.on('task:completed', (data: any) => {
            if (data.task && data.task.assignedAgentId) {
                this.handleTaskCompleted(data.task.assignedAgentId, data.task.id);
            }
        });

        EventBus.server.on('task:failed', (data: any) => {
            if (data.task && data.task.assignedAgentId) {
                this.handleTaskFailed(data.task.assignedAgentId, data.task.id);
            }
        });
    }

    public getOrCreateReputation(agentId: AgentId): AgentReputationMetrics {
        let reputation = this.reputationStore.get(agentId);
        
        if (!reputation) {
            reputation = {
                agentId,
                overallScore: 0.5,
                tasksCompleted: 0,
                tasksSucceeded: 0,
                tasksFailed: 0,
                successRate: 0,
                averageConfidence: 0,
                averageCompletionTime: 0,
                reliabilityScore: 0.5,
                collaborationScore: 0.5,
                helpfulnessScore: 0.5,
                firstSeen: Date.now(),
                lastUpdated: Date.now(),
                reputationHistory: []
            };
            this.reputationStore.set(agentId, reputation);
        }

        return reputation;
    }

    public async updateReputation(update: AgentReputationUpdate): Promise<void> {
        if (!this.isEnabled()) {
            throw new Error('Agent reputation system is disabled');
        }

        const reputation = this.getOrCreateReputation(update.agentId);
        const oldScore = reputation.overallScore;

        reputation.overallScore = Math.max(0, Math.min(1, reputation.overallScore + update.scoreDelta));
        reputation.lastUpdated = update.timestamp;

        const historyEntry: ReputationHistoryEntry = {
            timestamp: update.timestamp,
            score: reputation.overallScore,
            reason: update.reason,
            delta: update.scoreDelta,
            relatedTaskId: update.relatedTaskId,
            relatedAgentId: update.relatedAgentId
        };

        reputation.reputationHistory.push(historyEntry);

        if (reputation.reputationHistory.length > 100) {
            reputation.reputationHistory = reputation.reputationHistory.slice(-100);
        }

        EventBus.server.emit('p2p:reputation_updated', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: update.timestamp,
            eventId: uuidv4(),
            data: {
                targetAgentId: update.agentId,
                oldScore,
                newScore: reputation.overallScore,
                reason: update.reason
            }
        });

        this.logger.debug(`Reputation updated for agent: ${update.agentId}`, {
            oldScore,
            newScore: reputation.overallScore,
            delta: update.scoreDelta,
            reason: update.reason
        });
    }

    private async handleTaskCompleted(agentId: AgentId, taskId: string): Promise<void> {
        const reputation = this.getOrCreateReputation(agentId);
        
        reputation.tasksCompleted++;
        reputation.tasksSucceeded++;
        reputation.successRate = reputation.tasksSucceeded / reputation.tasksCompleted;

        await this.updateReputation({
            agentId,
            reason: 'task_completed',
            scoreDelta: 0.01,
            relatedTaskId: taskId,
            timestamp: Date.now()
        });
    }

    private async handleTaskFailed(agentId: AgentId, taskId: string): Promise<void> {
        const reputation = this.getOrCreateReputation(agentId);
        
        reputation.tasksCompleted++;
        reputation.tasksFailed++;
        reputation.successRate = reputation.tasksSucceeded / reputation.tasksCompleted;

        await this.updateReputation({
            agentId,
            reason: 'task_failed',
            scoreDelta: -0.02,
            relatedTaskId: taskId,
            timestamp: Date.now()
        });
    }

    public getReputation(agentId: AgentId): AgentReputationMetrics | undefined {
        return this.reputationStore.get(agentId);
    }

    public getAllReputations(): AgentReputationMetrics[] {
        return Array.from(this.reputationStore.values());
    }

    public getTopAgentsByReputation(limit: number = 10): AgentReputationMetrics[] {
        return this.getAllReputations()
            .sort((a, b) => b.overallScore - a.overallScore)
            .slice(0, limit);
    }
}
