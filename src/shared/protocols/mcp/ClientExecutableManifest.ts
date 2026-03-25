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
 * Client-Executable Tool Manifest
 *
 * Explicit allowlist of tools and external MCP servers that are safe to execute
 * client-side in the SDK process. This manifest acts as a safety gate — even if
 * a tool has executionSide: 'either', it must also appear in this manifest to
 * actually execute locally.
 *
 * Criteria for client-executable internal tools:
 * - No MongoDB, Redis, or other database dependencies
 * - No EventBus.server usage
 * - No server-side services (AgentService, PlanModel, etc.)
 * - Only depends on shared utilities (Logger, validation) and standard JS APIs
 *
 * Criteria for client-executable external servers:
 * - Can be spawned as a child process via stdio transport
 * - No server-specific configuration or state dependencies
 */

/**
 * Internal MXF tool names that are safe for client-side execution.
 * These tools are pure computation with no server dependencies.
 */
export const CLIENT_EXECUTABLE_INTERNAL_TOOLS: readonly string[] = [
    'datetime_now',
    'datetime_convert',
    'datetime_arithmetic',
    'datetime_format',
] as const;

/**
 * External MCP server IDs that can be spawned client-side.
 * These servers use stdio transport and have no server-specific dependencies.
 *
 * SECURITY NOTE: 'filesystem' exposes file read/write operations scoped to the
 * directories configured in its ExternalServerConfig (allowedDirectories).
 * The server runs as a child process of the SDK's Bun process and inherits its
 * filesystem permissions. Only include 'filesystem' when agents are trusted to
 * access the configured paths from the client machine.
 */
export const CLIENT_EXECUTABLE_EXTERNAL_SERVERS: readonly string[] = [
    'calculator',
    'sequential-thinking',
    'filesystem',
] as const;

/**
 * Check if an internal tool name is in the client-executable allowlist.
 *
 * @param toolName - The tool name to check
 * @returns true if the tool is allowlisted for client-side execution
 */
export function isClientExecutable(toolName: string): boolean {
    return CLIENT_EXECUTABLE_INTERNAL_TOOLS.includes(toolName);
}

/**
 * Check if an external MCP server ID is in the client-executable allowlist.
 *
 * @param serverId - The external server ID to check
 * @returns true if the server is allowlisted for client-side spawning
 */
export function isClientExecutableServer(serverId: string): boolean {
    return CLIENT_EXECUTABLE_EXTERNAL_SERVERS.includes(serverId);
}
