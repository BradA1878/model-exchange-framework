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
 * Tool Execution Persistence Service
 *
 * Listens to MCP tool execution events and persists them to the database
 * for auditing, analytics, and dashboard display.
 */

import { EventBus } from '../../shared/events/EventBus';
import { McpEvents } from '../../shared/events/event-definitions/McpEvents';
import { McpToolExecution, IMcpToolExecution, McpToolExecutionStatus, McpToolSource } from '../../shared/models/mcpToolExecution';
import { Logger } from '../../shared/utils/Logger';
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
     * Initialize the service and set up event listeners
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            logger.warn('ToolExecutionPersistenceService already initialized');
            return;
        }

        logger.info('Initializing ToolExecutionPersistenceService...');

        // Listen to tool call events
        EventBus.server.on(McpEvents.TOOL_CALL, (payload: any) => {
            this.handleToolCall(payload).catch(error => {
                logger.error('Error handling tool call event:', error);
            });
        });

        // Listen to tool result events
        EventBus.server.on(McpEvents.TOOL_RESULT, (payload: any) => {
            this.handleToolResult(payload).catch(error => {
                logger.error('Error handling tool result event:', error);
            });
        });

        // Listen to tool error events
        EventBus.server.on(McpEvents.TOOL_ERROR, (payload: any) => {
            this.handleToolError(payload).catch(error => {
                logger.error('Error handling tool error event:', error);
            });
        });

        this.initialized = true;
        logger.info('ToolExecutionPersistenceService initialized successfully');
    }

    /**
     * Record a tool call start (called directly from HybridMcpToolRegistry)
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
        } = {}
    ): Promise<void> {
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
            category: options.category
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
                category: options.category
            });

            logger.debug(`Recorded tool call start: ${toolName} (${requestId})`);
        } catch (error) {
            logger.error(`Failed to record tool call start: ${error}`);
        }
    }

    /**
     * Record a tool call completion (called directly from HybridMcpToolRegistry)
     */
    public async recordToolCallComplete(
        requestId: string,
        result: any,
        metadata?: Record<string, any>
    ): Promise<void> {
        const completedAt = new Date();
        const pending = this.pendingExecutions.get(requestId);

        const durationMs = pending
            ? completedAt.getTime() - pending.startedAt.getTime()
            : undefined;

        // Remove from pending cache
        this.pendingExecutions.delete(requestId);

        // Update database record
        try {
            await McpToolExecution.findOneAndUpdate(
                { requestId },
                {
                    status: 'completed' as McpToolExecutionStatus,
                    result,
                    completedAt,
                    durationMs,
                    metadata
                },
                { upsert: false }
            );

            logger.debug(`Recorded tool call complete: ${requestId} (${durationMs}ms)`);
        } catch (error) {
            logger.error(`Failed to record tool call complete: ${error}`);
        }
    }

    /**
     * Record a tool call failure (called directly from HybridMcpToolRegistry)
     */
    public async recordToolCallError(
        requestId: string,
        errorMessage: string,
        errorCode?: string,
        details?: Record<string, any>
    ): Promise<void> {
        const completedAt = new Date();
        const pending = this.pendingExecutions.get(requestId);

        const durationMs = pending
            ? completedAt.getTime() - pending.startedAt.getTime()
            : undefined;

        // Remove from pending cache
        this.pendingExecutions.delete(requestId);

        // Update database record
        try {
            await McpToolExecution.findOneAndUpdate(
                { requestId },
                {
                    status: 'failed' as McpToolExecutionStatus,
                    errorMessage,
                    errorCode,
                    completedAt,
                    durationMs,
                    metadata: details
                },
                { upsert: false }
            );

            logger.debug(`Recorded tool call error: ${requestId} - ${errorMessage}`);
        } catch (error) {
            logger.error(`Failed to record tool call error: ${error}`);
        }
    }

    /**
     * Handle tool call event from EventBus
     * Supports both flat format (from HybridMcpToolRegistry) and wrapped format (from EventPayloadSchema helpers)
     *
     * Flat format: { requestId, name, input, agentId, channelId, source }
     * Wrapped format: { agentId, channelId, source: 'SYSTEM', data: { callId, toolName, arguments } }
     *
     * Note: The event's top-level `source` field (e.g., 'SYSTEM') is different from the tool source type
     * which should be 'internal' or 'external'. We only use tool source from flat format payloads.
     */
    private async handleToolCall(payload: any): Promise<void> {
        // Extract fields supporting both formats
        // Flat format uses: requestId, name, input
        // Wrapped format uses: data.callId, data.toolName, data.arguments
        const requestId = payload.requestId || payload.data?.callId;
        const name = payload.name || payload.data?.toolName;
        const input = payload.input || payload.data?.arguments;
        const agentId = payload.agentId || payload.data?.agentId;
        const channelId = payload.channelId || payload.data?.channelId;

        // Tool source type: 'internal' or 'external'
        // Only use flat format's source field (which will be 'internal' or 'external')
        // Do NOT use payload.source which is the event source (e.g., 'SYSTEM')
        const isValidToolSource = (s: any) => s === 'internal' || s === 'external';
        const toolSource = isValidToolSource(payload.source) ? payload.source : 'internal';

        if (!requestId || !name) {
            logger.warn('Invalid tool call payload - missing requestId or name', {
                hasRequestId: !!requestId,
                hasName: !!name,
                payloadKeys: Object.keys(payload),
                dataKeys: payload.data ? Object.keys(payload.data) : []
            });
            return;
        }

        await this.recordToolCallStart(
            requestId,
            name,
            toolSource,
            input || {},
            { agentId, channelId }
        );
    }

    /**
     * Handle tool result event from EventBus
     * Supports both flat format and wrapped format
     *
     * Flat format: { requestId, result, metadata }
     * Wrapped format: { data: { callId, result } }
     */
    private async handleToolResult(payload: any): Promise<void> {
        // Extract fields supporting both formats
        const requestId = payload.requestId || payload.data?.callId || payload.data?.requestId;
        const result = payload.result !== undefined ? payload.result : payload.data?.result;
        const metadata = payload.metadata || payload.data?.metadata;

        if (!requestId) {
            logger.warn('Invalid tool result payload - missing requestId', {
                payloadKeys: Object.keys(payload),
                dataKeys: payload.data ? Object.keys(payload.data) : []
            });
            return;
        }

        await this.recordToolCallComplete(requestId, result, metadata);
    }

    /**
     * Handle tool error event from EventBus
     * Supports both flat format and wrapped format
     *
     * Flat format: { requestId, error, code, details }
     * Wrapped format: { data: { callId, error } }
     */
    private async handleToolError(payload: any): Promise<void> {
        // Extract fields supporting both formats
        const requestId = payload.requestId || payload.data?.callId || payload.data?.requestId;
        const error = payload.error || payload.data?.error;
        const code = payload.code || payload.data?.code;
        const details = payload.details || payload.data?.details;

        if (!requestId) {
            logger.warn('Invalid tool error payload - missing requestId', {
                payloadKeys: Object.keys(payload),
                dataKeys: payload.data ? Object.keys(payload.data) : []
            });
            return;
        }

        await this.recordToolCallError(requestId, error, code, details);
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
