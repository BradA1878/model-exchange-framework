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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Tool Execution Persistence Service
 *
 * Persists admitted executor operations for auditing, analytics, and dashboard
 * display. Attempt events are not execution admission and never create records.
 */

import { McpToolExecution, IMcpToolExecution, McpToolExecutionStatus, McpToolSource } from '@mxf-dev/core/models/mcpToolExecution';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { v4 as uuidv4 } from 'uuid';

// Create logger instance
const logger = new Logger('info', 'ToolExecutionPersistenceService', 'server');

/**
 * In-memory cache for pending executions to track timing
 */
interface PendingExecution {
    requestId: string;
    toolName: string;
    source: McpToolSource;
    serverId?: string;
    agentId?: string;
    channelId?: string;
    parameters: Record<string, any>;
    startedAt: Date;
    category?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Service for persisting tool executions to the database
 */
export class ToolExecutionPersistenceService {
    private static instance: ToolExecutionPersistenceService | null = null;
    private pendingExecutions: Map<string, PendingExecution> = new Map();
    private initialized: boolean = false;

    private constructor() {
        // Private constructor for singleton pattern
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): ToolExecutionPersistenceService {
        if (!ToolExecutionPersistenceService.instance) {
            ToolExecutionPersistenceService.instance = new ToolExecutionPersistenceService();
        }
        return ToolExecutionPersistenceService.instance;
    }

    /**
     * Initialize the audit service; execution is recorded directly by the executor
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('ToolExecutionPersistenceService already initialized');
            return;
        }

        logger.info('Initializing ToolExecutionPersistenceService...');

        // The executor owns admission and awaits every write. Subscribing to
        // TOOL_CALL here would create records for unauthorized or invalid calls.
        this.initialized = true;
        logger.info('ToolExecutionPersistenceService initialized successfully');
    }

    /**
     * Record an admitted tool call before its handler starts
     */
    public async recordToolCallStart(
        requestId: string,
        toolName: string,
        source: McpToolSource,
        parameters: Record<string, any>,
        options: {
            serverId?: string;
            agentId?: string;
            channelId?: string;
            category?: string;
            metadata?: Record<string, unknown>;
        } = {}
    ): Promise<void> {
        if (this.pendingExecutions.has(requestId)) {
            throw new Error(`Tool execution ${requestId} is already being recorded`);
        }
        const startedAt = new Date();

        // Store in pending executions cache
        this.pendingExecutions.set(requestId, {
            requestId,
            toolName,
            source,
            serverId: options.serverId,
            agentId: options.agentId,
            channelId: options.channelId,
            parameters,
            startedAt,
            category: options.category,
            metadata: options.metadata
        });

        // Create initial database record with 'running' status
        try {
            await McpToolExecution.create({
                requestId,
                toolName,
                source,
                serverId: options.serverId,
                agentId: options.agentId,
                channelId: options.channelId,
                parameters,
                status: 'running' as McpToolExecutionStatus,
                startedAt,
                category: options.category,
                metadata: options.metadata
            });

            logger.debug(`Recorded tool call start: ${toolName} (${requestId})`);
        } catch (error) {
            this.pendingExecutions.delete(requestId);
            logger.error(`Failed to record tool call start: ${error}`);
            throw new Error(`Failed to record tool call start: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Record the first terminal outcome of an admitted tool call
     */
    public async recordToolCallComplete(
        requestId: string,
        result: any,
        metadata?: Record<string, any>
    ): Promise<void> {
        const completedAt = new Date();
        const pending = this.pendingExecutions.get(requestId);
        // Unknown and duplicate terminal calls never update an older record.
        if (!pending) return;

        const durationMs = completedAt.getTime() - pending.startedAt.getTime();

        // Remove from pending cache
        this.pendingExecutions.delete(requestId);

        // Update database record
        try {
            const record = await McpToolExecution.findOneAndUpdate(
                { requestId, status: 'running', agentId: pending.agentId, channelId: pending.channelId },
                {
                    status: 'completed' as McpToolExecutionStatus,
                    result,
                    completedAt,
                    durationMs,
                    metadata: { ...metadata, ...pending.metadata }
                },
                { upsert: false }
            );

            if (!record) throw new Error(`Running tool execution ${requestId} was not found`);
            logger.debug(`Recorded tool call complete: ${requestId} (${durationMs}ms)`);
        } catch (error) {
            logger.error(`Failed to record tool call complete: ${error}`);
            throw new Error(`Failed to record tool call complete: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Record the first failure of an admitted tool call
     */
    public async recordToolCallError(
        requestId: string,
        errorMessage: string,
        errorCode?: string,
        details?: Record<string, any>
    ): Promise<void> {
        const completedAt = new Date();
        const pending = this.pendingExecutions.get(requestId);
        // Unknown and duplicate terminal calls never update an older record.
        if (!pending) return;

        const durationMs = completedAt.getTime() - pending.startedAt.getTime();

        // Remove from pending cache
        this.pendingExecutions.delete(requestId);

        // Update database record
        try {
            const record = await McpToolExecution.findOneAndUpdate(
                { requestId, status: 'running', agentId: pending.agentId, channelId: pending.channelId },
                {
                    status: 'failed' as McpToolExecutionStatus,
                    errorMessage,
                    errorCode,
                    completedAt,
                    durationMs,
                    metadata: { ...details, ...pending.metadata }
                },
                { upsert: false }
            );

            if (!record) throw new Error(`Running tool execution ${requestId} was not found`);
            logger.debug(`Recorded tool call error: ${requestId} - ${errorMessage}`);
        } catch (error) {
            logger.error(`Failed to record tool call error: ${error}`);
            throw new Error(`Failed to record tool call error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate a unique request ID
     */
    public generateRequestId(): string {
        return uuidv4();
    }

    /**
     * Get recent tool executions
     */
    public async getRecentExecutions(
        options: {
            limit?: number;
            status?: McpToolExecutionStatus;
            toolName?: string;
            agentId?: string;
            channelId?: string;
        } = {}
    ): Promise<IMcpToolExecution[]> {
        const query: Record<string, any> = {};

        if (options.status) {
            query.status = options.status;
        }
        if (options.toolName) {
            query.toolName = options.toolName;
        }
        if (options.agentId) {
            query.agentId = options.agentId;
        }
        if (options.channelId) {
            query.channelId = options.channelId;
        }

        return McpToolExecution
            .find(query)
            .sort({ startedAt: -1 })
            .limit(options.limit || 100)
            .exec();
    }

    /**
     * Get execution statistics
     */
    public async getExecutionStats(): Promise<{
        total: number;
        completed: number;
        failed: number;
        running: number;
        avgDurationMs: number;
    }> {
        const [total, completed, failed, running, avgResult] = await Promise.all([
            McpToolExecution.countDocuments(),
            McpToolExecution.countDocuments({ status: 'completed' }),
            McpToolExecution.countDocuments({ status: 'failed' }),
            McpToolExecution.countDocuments({ status: 'running' }),
            McpToolExecution.aggregate([
                { $match: { status: 'completed', durationMs: { $exists: true } } },
                { $group: { _id: null, avgDuration: { $avg: '$durationMs' } } }
            ])
        ]);

        return {
            total,
            completed,
            failed,
            running,
            avgDurationMs: avgResult[0]?.avgDuration || 0
        };
    }

    /**
     * Cleanup stale running executions (mark as timeout)
     */
    public async cleanupStaleExecutions(maxAgeMs: number = 5 * 60 * 1000): Promise<number> {
        const cutoffTime = new Date(Date.now() - maxAgeMs);

        const result = await McpToolExecution.updateMany(
            {
                status: 'running',
                startedAt: { $lt: cutoffTime }
            },
            {
                status: 'timeout' as McpToolExecutionStatus,
                completedAt: new Date(),
                errorMessage: 'Execution timed out'
            }
        );

        if (result.modifiedCount > 0) {
            logger.info(`Marked ${result.modifiedCount} stale executions as timeout`);
        }

        return result.modifiedCount;
    }
}
