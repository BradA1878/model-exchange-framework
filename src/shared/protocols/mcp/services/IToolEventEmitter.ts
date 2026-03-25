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
 * IToolEventEmitter
 *
 * Decouples ExternalMcpServerManager from direct EventBus.server dependency.
 * Server-side code passes a ServerToolEventEmitter (wrapping EventBus.server).
 * SDK client-side code passes a ClientToolEventEmitter (wrapping EventBus.client + socketEmit).
 */

import { AgentId, ChannelId } from '../../../types/ChannelContext';

export interface IToolEventEmitter {
    /**
     * Emit a server lifecycle event (start, stop, spawn, discovery, etc.)
     */
    emitServerEvent(
        eventType: string,
        serverId: string,
        serverName: string,
        scope: string,
        scopeId?: string,
        agentId?: AgentId,
        channelId?: ChannelId
    ): void;

    /**
     * Emit a server error event
     */
    emitServerError(
        serverId: string,
        error: string,
        agentId?: AgentId,
        channelId?: ChannelId
    ): void;

    /**
     * Emit a health status event
     */
    emitHealthStatus(
        serverId: string,
        serverName: string,
        serverVersion: string,
        status: string,
        description?: string
    ): void;

    /**
     * Emit a tools discovered event
     */
    emitToolsDiscovered(
        serverId: string,
        serverName: string,
        serverVersion: string,
        tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>
    ): void;
}
