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
 * P2P Task Negotiation Service (P9 Foundation)
 *
 * EXPERIMENTAL: This is a foundation implementation for future P2P task negotiation.
 * Disabled by default via feature flags.
 *
 * Provides basic task negotiation protocol:
 * - Task announcement to peers
 * - Bid collection from agents
 * - Selection based on strategy
 * - Integration with existing TaskService
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../utils/Logger';
import { EventBus } from '../../events/EventBus';
import { Events } from '../../events/EventNames';
import {
    TaskBid,
    TaskAnnouncement,
    TaskSelectionStrategy,
    TaskSelectionResult,
    P2PFeatureFlags,
    DEFAULT_P2P_FEATURE_FLAGS
} from '../../types/DecentralizationTypes';
import { ChannelTask } from '../../types/TaskTypes';
import { AgentId } from '../../types/Agent';

/**
 * P2P Task Negotiation Service Configuration
 */
export interface P2PTaskNegotiationConfig {
    enabled: boolean;
    defaultBidWindowMs: number;
    minBidsRequired: number;
    maxBidsAccepted: number;
    defaultSelectionStrategy: TaskSelectionStrategy;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: P2PTaskNegotiationConfig = {
    enabled: false,
    defaultBidWindowMs: 30000,      // 30 seconds
    minBidsRequired: 1,
    maxBidsAccepted: 10,
    defaultSelectionStrategy: 'best_value'
};

/**
 * P2P Task Negotiation Service
 *
 * IMPORTANT: This is a foundation-only implementation.
 * All P2P features are disabled by default.
 */
export class P2PTaskNegotiationService {
    private static instance: P2PTaskNegotiationService;
    private readonly logger: Logger;
    private config: P2PTaskNegotiationConfig;
    private featureFlags: P2PFeatureFlags;

    // Active announcements and bids
    private activeAnnouncements = new Map<string, TaskAnnouncement>();
    private taskToAnnouncement = new Map<string, string>(); // taskId -> announcementId
    private announcementBids = new Map<string, TaskBid[]>();
    private bidTimeouts = new Map<string, NodeJS.Timeout>();

    private constructor(
        config: Partial<P2PTaskNegotiationConfig> = {},
        featureFlags: P2PFeatureFlags = DEFAULT_P2P_FEATURE_FLAGS
    ) {
        this.logger = new Logger('debug', 'P2PTaskNegotiationService', 'server');
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.featureFlags = featureFlags;

        if (this.isEnabled()) {
            this.logger.info('P2P Task Negotiation initialized (EXPERIMENTAL)');
            this.setupEventListeners();
        } else {
            this.logger.info('P2P Task Negotiation disabled by feature flags');
        }
    }

    public static getInstance(
        config?: Partial<P2PTaskNegotiationConfig>,
        featureFlags?: P2PFeatureFlags
    ): P2PTaskNegotiationService {
        if (!P2PTaskNegotiationService.instance) {
            P2PTaskNegotiationService.instance = new P2PTaskNegotiationService(config, featureFlags);
        }
        return P2PTaskNegotiationService.instance;
    }

    /**
     * Reset the singleton instance (for testing only)
     * Clears all timeouts to prevent test leaks
     */
    public static resetInstance(): void {
        if (P2PTaskNegotiationService.instance) {
            // Clear all pending timeouts to prevent Jest open handles
            for (const timeout of P2PTaskNegotiationService.instance.bidTimeouts.values()) {
                clearTimeout(timeout);
            }
            P2PTaskNegotiationService.instance.bidTimeouts.clear();
            P2PTaskNegotiationService.instance.activeAnnouncements.clear();
            P2PTaskNegotiationService.instance.taskToAnnouncement.clear();
            P2PTaskNegotiationService.instance.announcementBids.clear();
        }
        P2PTaskNegotiationService.instance = undefined as unknown as P2PTaskNegotiationService;
    }

    /**
     * Check if P2P negotiation is enabled
     */
    private isEnabled(): boolean {
        return (
            this.featureFlags.P2P_ENABLED &&
            this.featureFlags.P2P_NEGOTIATION_ENABLED &&
            this.config.enabled
        );
    }

    /**
     * Setup event listeners for P2P negotiation
     */
    private setupEventListeners(): void {
        // Listen for bid submissions
        EventBus.server.on('p2p:task_bid_submitted', (data: any) => {
            this.handleBidSubmitted(data.bid);
        });

        // Listen for announcement cancellations
        EventBus.server.on('p2p:task_announcement_cancelled', (data: any) => {
            this.cancelAnnouncement(data.announcementId);
        });
    }

    /**
     * Announce a task for P2P negotiation
     *
     * @param task The task to announce
     * @param announcerAgentId The agent announcing the task
     * @param options Optional announcement options
     * @returns The task announcement
     */
    public async announceTask(
        task: ChannelTask,
        announcerAgentId: AgentId,
        options?: Partial<{
            bidWindowMs: number;
            selectionStrategy: TaskSelectionStrategy;
            minBids: number;
            maxBids: number;
        }>
    ): Promise<TaskAnnouncement> {
        if (!this.isEnabled()) {
            throw new Error('P2P task negotiation is disabled');
        }

        const announcementId = uuidv4();
        const now = Date.now();
        const bidWindowMs = options?.bidWindowMs || this.config.defaultBidWindowMs;

        const announcement: TaskAnnouncement = {
            announcementId,
            task,
            bidWindowStart: now,
            bidWindowEnd: now + bidWindowMs,
            selectionStrategy: options?.selectionStrategy || this.config.defaultSelectionStrategy,
            minBids: options?.minBids || this.config.minBidsRequired,
            maxBids: options?.maxBids || this.config.maxBidsAccepted,
            announcerAgentId,
            status: 'open',
            metadata: {}
        };

        // Store announcement
        this.activeAnnouncements.set(announcementId, announcement);
        this.taskToAnnouncement.set(task.id, announcementId);
        this.announcementBids.set(announcementId, []);

        // Set timeout for bid window closing
        const timeout = setTimeout(() => {
            this.closeBidWindow(announcementId);
        }, bidWindowMs);
        this.bidTimeouts.set(announcementId, timeout);

        // Emit announcement event
        EventBus.server.emit('p2p:task_announced', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: now,
            eventId: uuidv4(),
            data: {
                announcement
            }
        });

        this.logger.info(`Task announced for P2P negotiation: ${task.id}`, {
            announcementId,
            bidWindowMs,
            selectionStrategy: announcement.selectionStrategy
        });

        return announcement;
    }

    /**
     * Submit a bid for a task
     *
     * @param bid The task bid
     * @returns Success status
     */
    public async submitBid(bid: TaskBid): Promise<boolean> {
        if (!this.isEnabled()) {
            throw new Error('P2P task negotiation is disabled');
        }

        // Look up announcement by taskId
        const announcementId = this.taskToAnnouncement.get(bid.taskId);
        if (!announcementId) {
            this.logger.warn(`No active announcement found for task: ${bid.taskId}`);
            return false;
        }

        const announcement = this.activeAnnouncements.get(announcementId);
        if (!announcement) {
            this.logger.warn(`Announcement not found: ${announcementId}`);
            return false;
        }

        if (announcement.status !== 'open') {
            this.logger.warn(`Announcement is not open for bids: ${announcement.announcementId}`);
            return false;
        }

        const now = Date.now();
        if (now > announcement.bidWindowEnd) {
            this.logger.warn(`Bid window closed for announcement: ${announcement.announcementId}`);
            return false;
        }

        const bids = this.announcementBids.get(announcement.announcementId) || [];

        // Check if max bids reached
        if (announcement.maxBids && bids.length >= announcement.maxBids) {
            this.logger.warn(`Maximum bids reached for announcement: ${announcement.announcementId}`);
            return false;
        }

        // Check if agent already submitted a bid
        const existingBid = bids.find(b => b.agentId === bid.agentId);
        if (existingBid) {
            this.logger.warn(`Agent already submitted bid: ${bid.agentId}`);
            return false;
        }

        // Add bid
        bids.push(bid);
        this.announcementBids.set(announcement.announcementId, bids);

        // Emit bid received event
        EventBus.server.emit('p2p:task_bid_received', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: now,
            eventId: uuidv4(),
            data: {
                bid,
                announcementId: announcement.announcementId
            }
        });

        this.logger.info(`Bid submitted for task: ${bid.taskId}`, {
            bidId: bid.bidId,
            agentId: bid.agentId,
            confidence: bid.confidence
        });

        return true;
    }

    /**
     * Close bid window and select winner
     */
    private async closeBidWindow(announcementId: string): Promise<void> {
        const announcement = this.activeAnnouncements.get(announcementId);
        if (!announcement || announcement.status !== 'open') {
            return;
        }

        // Update status
        announcement.status = 'closed';

        const bids = this.announcementBids.get(announcementId) || [];

        this.logger.info(`Closing bid window for announcement: ${announcementId}`, {
            bidsReceived: bids.length,
            minBidsRequired: announcement.minBids
        });

        // Check if minimum bids met
        if (announcement.minBids && bids.length < announcement.minBids) {
            this.logger.warn(`Minimum bids not met for announcement: ${announcementId}`);
            announcement.status = 'cancelled';

            EventBus.server.emit('p2p:task_announcement_cancelled', {
                agentId: 'system',
                channelId: 'p2p',
                timestamp: Date.now(),
                eventId: uuidv4(),
                data: {
                    announcementId,
                    reason: 'min_bids_not_met'
                }
            });

            return;
        }

        // Select winner
        try {
            const selectionResult = await this.selectWinningBid(announcement, bids);

            announcement.status = 'awarded';

            EventBus.server.emit('p2p:task_awarded', {
                agentId: 'system',
                channelId: 'p2p',
                timestamp: Date.now(),
                eventId: uuidv4(),
                data: {
                    announcementId,
                    selectionResult
                }
            });

            this.logger.info(`Task awarded to agent: ${selectionResult.winningBid.agentId}`, {
                announcementId,
                taskId: announcement.task.id
            });
        } catch (error) {
            this.logger.error('Failed to select winning bid', { announcementId, error });
            announcement.status = 'cancelled';
        }

        // Cleanup timeout
        const timeout = this.bidTimeouts.get(announcementId);
        if (timeout) {
            clearTimeout(timeout);
            this.bidTimeouts.delete(announcementId);
        }
    }

    /**
     * Select winning bid based on strategy
     */
    private async selectWinningBid(
        announcement: TaskAnnouncement,
        bids: TaskBid[]
    ): Promise<TaskSelectionResult> {
        if (bids.length === 0) {
            throw new Error('No bids to select from');
        }

        let winningBid: TaskBid;
        let reasoning: string;

        switch (announcement.selectionStrategy) {
            case 'highest_reputation':
                winningBid = bids.reduce((best, current) =>
                    current.reputationScore > best.reputationScore ? current : best
                );
                reasoning = `Selected agent with highest reputation: ${winningBid.reputationScore}`;
                break;

            case 'highest_confidence':
                winningBid = bids.reduce((best, current) =>
                    current.confidence > best.confidence ? current : best
                );
                reasoning = `Selected agent with highest confidence: ${winningBid.confidence}`;
                break;

            case 'fastest_completion':
                winningBid = bids.reduce((best, current) =>
                    current.estimatedDuration < best.estimatedDuration ? current : best
                );
                reasoning = `Selected agent with fastest estimated completion: ${winningBid.estimatedDuration}min`;
                break;

            case 'lowest_price':
                winningBid = bids.reduce((best, current) =>
                    (current.price || 0) < (best.price || 0) ? current : best
                );
                reasoning = `Selected agent with lowest price: ${winningBid.price || 0}`;
                break;

            case 'best_value':
                // Weighted scoring: reputation (30%), confidence (30%), speed (20%), price (20%)
                winningBid = bids.reduce((best, current) => {
                    const currentScore = (
                        current.reputationScore * 0.3 +
                        current.confidence * 0.3 +
                        (1 - Math.min(current.estimatedDuration / 1000, 1)) * 0.2 +
                        (1 - Math.min((current.price || 0) / 1000, 1)) * 0.2
                    );
                    const bestScore = (
                        best.reputationScore * 0.3 +
                        best.confidence * 0.3 +
                        (1 - Math.min(best.estimatedDuration / 1000, 1)) * 0.2 +
                        (1 - Math.min((best.price || 0) / 1000, 1)) * 0.2
                    );
                    return currentScore > bestScore ? current : best;
                });
                reasoning = 'Selected agent with best overall value score';
                break;

            case 'weighted_score':
                // Custom weighted scoring (same as best_value for now)
                winningBid = bids.reduce((best, current) => {
                    const currentScore = (
                        current.reputationScore * 0.4 +
                        current.confidence * 0.3 +
                        (1 - Math.min(current.estimatedDuration / 1000, 1)) * 0.3
                    );
                    const bestScore = (
                        best.reputationScore * 0.4 +
                        best.confidence * 0.3 +
                        (1 - Math.min(best.estimatedDuration / 1000, 1)) * 0.3
                    );
                    return currentScore > bestScore ? current : best;
                });
                reasoning = 'Selected agent with best weighted score';
                break;

            default:
                winningBid = bids[0];
                reasoning = 'Selected first bid';
        }

        // Get alternative bids (runner-ups)
        const alternativeBids = bids
            .filter(b => b.bidId !== winningBid.bidId)
            .slice(0, 3);

        return {
            taskId: announcement.task.id,
            winningBid,
            alternativeBids,
            selectionReasoning: reasoning,
            selectedAt: Date.now()
        };
    }

    /**
     * Cancel an announcement
     */
    public cancelAnnouncement(announcementId: string): void {
        const announcement = this.activeAnnouncements.get(announcementId);
        if (!announcement) {
            return;
        }

        announcement.status = 'cancelled';

        // Clear timeout
        const timeout = this.bidTimeouts.get(announcementId);
        if (timeout) {
            clearTimeout(timeout);
            this.bidTimeouts.delete(announcementId);
        }

        EventBus.server.emit('p2p:task_announcement_cancelled', {
            agentId: 'system',
            channelId: 'p2p',
            timestamp: Date.now(),
            eventId: uuidv4(),
            data: {
                announcementId,
                reason: 'manual_cancellation'
            }
        });

        this.logger.info(`Announcement cancelled: ${announcementId}`);
    }

    /**
     * Handle bid submission event
     */
    private handleBidSubmitted(bid: TaskBid): void {
        this.submitBid(bid).catch(error => {
            this.logger.error('Failed to handle bid submission', { bid, error });
        });
    }

    /**
     * Get active announcement by ID
     */
    public getAnnouncement(announcementId: string): TaskAnnouncement | undefined {
        return this.activeAnnouncements.get(announcementId);
    }

    /**
     * Get bids for an announcement
     */
    public getBids(announcementId: string): TaskBid[] {
        return this.announcementBids.get(announcementId) || [];
    }

    /**
     * Get all active announcements
     */
    public getActiveAnnouncements(): TaskAnnouncement[] {
        return Array.from(this.activeAnnouncements.values())
            .filter(a => a.status === 'open');
    }
}
