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
 * MCP server configuration for channel registration
 */
export interface ChannelMcpServerConfig {
    id: string;
    name: string;
    command?: string;
    args?: string[];
    transport?: 'stdio' | 'http';
    url?: string;
    autoStart?: boolean;
    environmentVariables?: Record<string, string>;
    restartOnCrash?: boolean;
    keepAliveMinutes?: number;
}

/**
 * Channel configuration interface
 */
export interface ChannelConfig {
    name: string;
    description: string;
    isPrivate: boolean;
    requireApproval: boolean;
    maxAgents: number;
    allowAnonymous: boolean;
    metadata: Record<string, any>;
    
    // Channel-level tool access control
    // Empty array (default) = no restrictions, agents use their own allowedTools
    // Non-empty array = agents can only use tools in BOTH channel's and agent's allowedTools
    allowedTools?: string[];
    
    // Disable SystemLLM for this channel (for games, custom orchestration, etc.)
    systemLlmEnabled?: boolean;
    
    // MCP servers to register for this channel at creation time
    mcpServers?: ChannelMcpServerConfig[];
}
