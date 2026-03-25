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
 * ClientToolEventEmitter
 *
 * Implements IToolEventEmitter for the SDK client context.
 * Emits events on EventBus.client for local observability and logging,
 * rather than EventBus.server (which is server-only).
 */

import { Logger } from '../../shared/utils/Logger';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import type { IToolEventEmitter } from '../../shared/protocols/mcp/services/IToolEventEmitter';
import type { AgentId, ChannelId } from '../../shared/types/ChannelContext';

const logger = new Logger('info', 'ClientToolEventEmitter', 'client');

export class ClientToolEventEmitter implements IToolEventEmitter {
    emitServerEvent(
        eventType: string,
        serverId: string,
        serverName: string,
        scope: string,
        scopeId?: string,
        agentId?: AgentId,
        channelId?: ChannelId
    ): void {
        logger.debug(`[client] External MCP event: ${eventType} for ${serverName} (${serverId})`);
        EventBus.client.emit(eventType, {
            serverId,
            serverName,
            scope,
            scopeId,
            agentId,
            channelId,
            timestamp: Date.now(),
        });
    }

    emitServerError(
        serverId: string,
        error: string,
        agentId?: AgentId,
        channelId?: ChannelId
    ): void {
        logger.error(`[client] External MCP server error: ${serverId}: ${error}`);
        EventBus.client.emit(Events.Mcp.EXTERNAL_SERVER_ERROR, {
            serverId,
            error,
            agentId,
            channelId,
            timestamp: Date.now(),
        });
    }

    emitHealthStatus(
        serverId: string,
        serverName: string,
        serverVersion: string,
        status: string,
        description?: string
    ): void {
        logger.debug(`[client] External MCP health: ${serverName} = ${status}`);
        EventBus.client.emit(Events.Mcp.EXTERNAL_SERVER_HEALTH_STATUS, {
            serverId,
            serverName,
            serverVersion,
            status,
            description,
            timestamp: Date.now(),
        });
    }

    emitToolsDiscovered(
        serverId: string,
        serverName: string,
        serverVersion: string,
        tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>
    ): void {
        logger.info(`[client] External MCP tools discovered: ${serverName} has ${tools.length} tools`);
        EventBus.client.emit(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, {
            serverId,
            serverName,
            serverVersion,
            tools,
            timestamp: Date.now(),
        });
    }
}
