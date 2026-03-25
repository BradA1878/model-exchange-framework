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
 * ClientExternalMcpManager
 *
 * Manages external MCP server processes running client-side in the SDK process.
 * Creates an ExternalMcpServerManager instance with a ClientToolEventEmitter
 * (instead of the default EventBus.server), spawns configured external servers
 * locally, and registers their discovered tools into ClientToolExecutor.
 *
 * This eliminates the server round-trip for external MCP tool calls:
 * - Calculator, Sequential Thinking, Filesystem servers run as child processes
 *   in the SDK's Bun process
 * - Tool calls go directly to the local MCP server via stdio
 * - Completion notifications are sent to the MXF server fire-and-forget for DB recording
 */

import { Logger } from '../../shared/utils/Logger';
import { createStrictValidator } from '../../shared/utils/validation';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { ExternalMcpServerManager } from '../../shared/protocols/mcp/services/ExternalMcpServerManager';
import { isClientExecutableServer } from '../../shared/protocols/mcp/ClientExecutableManifest';
import { getServerConfigById } from '../../shared/protocols/mcp/services/ExternalServerConfigs';
import { ClientToolEventEmitter } from './ClientToolEventEmitter';
import { ClientToolExecutor } from './ClientToolExecutor';

const logger = new Logger('info', 'ClientExternalMcpManager', 'client');
const validator = createStrictValidator('ClientExternalMcpManager');

export class ClientExternalMcpManager {
    private externalServerManager: ExternalMcpServerManager;
    private clientToolExecutor: ClientToolExecutor;
    private agentId: string;
    private channelId: string;
    private requestedServerIds: string[];
    private started: boolean = false;
    /** Stored listener reference for cleanup to prevent listener leaks on reconnect */
    private toolDiscoveryListener: ((payload: any) => void) | null = null;

    constructor(
        agentId: string,
        channelId: string,
        clientToolExecutor: ClientToolExecutor,
        requestedServerIds: string[]
    ) {
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        validator.assertIsNonEmptyString(channelId, 'channelId is required');

        this.agentId = agentId;
        this.channelId = channelId;
        this.clientToolExecutor = clientToolExecutor;
        this.requestedServerIds = requestedServerIds;

        // Create ExternalMcpServerManager with client-side event emitter
        // and skip server EventBus handlers (no EventBus.server.on() listeners)
        this.externalServerManager = new ExternalMcpServerManager({
            toolEventEmitter: new ClientToolEventEmitter(),
            skipServerEventHandlers: true,
        });

        // Listen for tool discovery events on EventBus.client to register
        // discovered external tools into the ClientToolExecutor
        this.setupToolDiscoveryListener();
    }

    /**
     * Start the configured external MCP servers.
     * Should be called after socket connection is established.
     */
    public async start(): Promise<void> {
        if (this.started) return;
        this.started = true;

        // Filter requested servers through the manifest allowlist
        const allowedServers = this.requestedServerIds.filter(id => {
            if (!isClientExecutableServer(id)) {
                logger.warn(`Server '${id}' is not in the client-executable allowlist, skipping`);
                return false;
            }
            return true;
        });

        if (allowedServers.length === 0) {
            logger.info('No external MCP servers to start client-side');
            return;
        }

        logger.info(`Starting ${allowedServers.length} external MCP servers client-side: ${allowedServers.join(', ')}`);

        for (const serverId of allowedServers) {
            const config = getServerConfigById(serverId);
            if (!config) {
                logger.warn(`No configuration found for server '${serverId}', skipping`);
                continue;
            }

            try {
                await this.externalServerManager.registerServer(config);
                logger.info(`Client-side external MCP server '${serverId}' registered and starting`);
            } catch (error) {
                logger.error(`Failed to start client-side external MCP server '${serverId}': ${error}`);
            }
        }
    }

    /**
     * Listen for tools discovered events on EventBus.client.
     * When an external MCP server discovers its tools, register each one
     * into the ClientToolExecutor so they can be called locally.
     */
    private setupToolDiscoveryListener(): void {
        this.toolDiscoveryListener = (payload: any) => {
            const { serverId, tools } = payload;
            if (!tools || !Array.isArray(tools)) return;

            logger.info(`Registering ${tools.length} tools from external server '${serverId}' into client executor`);

            for (const tool of tools) {
                // Create a handler that delegates to ExternalMcpServerManager.executeToolOnServer
                const handler = async (input: any): Promise<any> => {
                    return this.externalServerManager.executeToolOnServer(
                        serverId,
                        tool.name,
                        input,
                        this.agentId,
                        this.channelId
                    );
                };

                this.clientToolExecutor.registerExternalTool(
                    tool.name,
                    handler,
                    tool.inputSchema || {},
                    tool.description || ''
                );
            }
        };

        EventBus.client.on(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, this.toolDiscoveryListener);
    }

    /**
     * Stop all client-side external MCP servers and clean up.
     */
    public async cleanup(): Promise<void> {
        logger.info('Shutting down client-side external MCP servers');

        // Remove EventBus listener to prevent leaks on reconnect
        if (this.toolDiscoveryListener) {
            EventBus.client.off(Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED, this.toolDiscoveryListener);
            this.toolDiscoveryListener = null;
        }

        await this.externalServerManager.shutdown();
        this.started = false;
    }
}
