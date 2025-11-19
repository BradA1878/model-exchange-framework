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
 * Core MXF Tools - Essential tools that should be available when allowedTools is empty/missing
 * 
 * These tools provide a curated selection that demonstrates the MXF ecosystem
 * without overwhelming agents with all 180+ available tools.
 * 
 * IMPORTANT: allowedTools always takes priority - if specified, only those tools are allowed.
 * This core set is only used as a fallback when allowedTools is empty or missing.
 */

/**
 * Essential core MXF tools that should always be available as fallback
 * when allowedTools is empty or missing
 */
export const CORE_MXF_TOOLS = [
    // Meta-discovery tools (most important - gateway to other tools)
    'tools_recommend',        // Gateway to discovering other tools
    
    // Task management
    'task_complete',          // Essential for task completion
    'no_further_action',      // Graceful turn ending
    'validate_next_action',   // Validation checkpoints
    
    // Core communication
    'messaging_send',         // Core communication with other agents
    'messaging_discover',     // Agent discovery
    
    // Context and memory access
    'channel_context_read',   // Read channel context and shared information
    'agent_context_read',     // Read agent-specific context
    'channel_memory_read',    // Access shared channel memory
    'agent_memory_read',      // Access agent's personal memory
    
    // Planning tools (essential for structured work)
    'planning_create',        // Create structured plans
    'planning_update_item',   // Update plan progress
    'planning_view',          // View existing plans
    'planning_share'          // Share plans with other agents
] as const;

/**
 * Type-safe array of core tool names
 */
export type CoreMxfTool = typeof CORE_MXF_TOOLS[number];

/**
 * Check if a tool is part of the core MXF tool set
 */
export const isCoreToolName = (toolName: string): toolName is CoreMxfTool => {
    return (CORE_MXF_TOOLS as readonly string[]).includes(toolName);
};

/**
 * Meilisearch search tools (when enabled)
 */
const MEILISEARCH_TOOLS: string[] = [
    'memory_search_conversations',
    'memory_search_actions',
    'memory_search_patterns'
];

/**
 * Get core tools as a regular array for filtering operations
 * Conditionally includes Meilisearch tools when enabled
 */
export const getCoreToolsArray = (): string[] => {
    const coreTools: string[] = [...CORE_MXF_TOOLS];

    // Add Meilisearch tools if enabled
    if (process.env.ENABLE_MEILISEARCH === 'true') {
        coreTools.push(...MEILISEARCH_TOOLS);
    }

    return coreTools;
};
