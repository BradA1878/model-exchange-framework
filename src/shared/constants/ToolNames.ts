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
 * MXF Tool Names Constants
 * 
 * Centralized registry of all tool names used throughout the MXF framework.
 * This provides a single source of truth for tool naming to prevent mismatches
 * between tool registration, discovery, and execution.
 */

// =============================================================================
// INTERNAL MXF TOOLS
// =============================================================================

/**
 * Communication Tools - Agent-to-agent messaging and coordination
 */
export const COMMUNICATION_TOOLS = {
    SEND_MESSAGE: 'messaging_send',
    BROADCAST: 'messaging_broadcast', 
    DISCOVER_AGENTS: 'messaging_discover',
    COORDINATE: 'messaging_coordinate'
} as const;

/**
 * Coordination Tools - Advanced agent collaboration and workflow management
 */
export const COORDINATION_TOOLS = {
    REQUEST: 'coordination_request',
    ACCEPT: 'coordination_accept',
    REJECT: 'coordination_reject',
    STATUS: 'coordination_status',
    UPDATE: 'coordination_update',
    COMPLETE: 'coordination_complete',
    LIST: 'coordination_list'
} as const;

/**
 * Control Loop Tools - ORPAR cognitive cycle management
 */
export const CONTROL_LOOP_TOOLS = {
    INITIALIZE: 'controlLoop_initialize',
    START: 'controlLoop_start',
    STOP: 'controlLoop_stop',
    STATUS: 'controlLoop_status',
    OBSERVE: 'controlLoop_observe',
    REASON: 'controlLoop_reason',
    PLAN: 'controlLoop_plan',
    EXECUTE: 'controlLoop_execute',
    REFLECT: 'controlLoop_reflect'
} as const;

/**
 * Infrastructure Tools - System interaction and data management
 */
export const INFRASTRUCTURE_TOOLS = {
    FILESYSTEM_READ: 'filesystem_read',
    FILESYSTEM_WRITE: 'filesystem_write',
    FILESYSTEM_LIST: 'filesystem_list',
    DATABASE_QUERY: 'database_query',
    DATABASE_INSERT: 'database_insert',
    MEMORY_STORE: 'memory_store',
    MEMORY_RETRIEVE: 'memory_retrieve',
    SHELL_EXECUTE: 'shell_execute',
    CODE_EXECUTE: 'code_execute'
} as const;

/**
 * JSON Tools - JSON file manipulation and validation
 */
export const JSON_TOOLS = {
    JSON_APPEND: 'json_append',
    JSON_READ: 'json_read'
} as const;

/**
 * Context & Memory Tools - Agent context and memory management
 */
export const CONTEXT_MEMORY_TOOLS = {
    CHANNEL_MEMORY_READ: 'channel_memory_read',
    CHANNEL_MEMORY_WRITE: 'channel_memory_write',
    CHANNEL_CONTEXT_READ: 'channel_context_read',
    CHANNEL_MESSAGES_READ: 'channel_messages_read',
    AGENT_CONTEXT_READ: 'agent_context_read',
    AGENT_MEMORY_READ: 'agent_memory_read',
    AGENT_MEMORY_WRITE: 'agent_memory_write'
} as const;

/**
 * Meta Tools - Intelligent tool selection and workflow optimization
 */
export const META_TOOLS = {
    TOOLS_RECOMMEND: 'tools_recommend',
    TOOLS_RECOMMEND_ON_ERROR: 'tools_recommend_on_error',
    TOOLS_VALIDATE: 'tools_validate',
    TOOLS_DISCOVER: 'tools_discover',
    TOOLS_COMPARE: 'tools_compare',
    PROMPT_OPTIMIZE: 'prompt_optimize',
    AGENT_INTROSPECT: 'agent_introspect',
    WORKFLOW_PLAN: 'workflow_plan',
    ERROR_DIAGNOSE: 'error_diagnose',
    TASK_COMPLETE: 'task_complete'
} as const;

/**
 * Action Validation Tools - Post-execution decision validation
 */
export const ACTION_VALIDATION_TOOLS = {
    VALIDATE_NEXT_ACTION: 'validate_next_action',
    NO_FURTHER_ACTION: 'no_further_action'
} as const;

/**
 * Planning Tools - Structured planning and task breakdown
 */
export const PLANNING_TOOLS = {
    PLANNING_CREATE: 'planning_create',
    PLANNING_UPDATE_ITEM: 'planning_update_item',
    PLANNING_VIEW: 'planning_view',
    PLANNING_SHARE: 'planning_share'
} as const;

/**
 * Task Planning Tools - Intelligent task creation with completion monitoring
 */
export const TASK_PLANNING_TOOLS = {
    TASK_CREATE_WITH_PLAN: 'task_create_with_plan',
    TASK_CREATE_CUSTOM_COMPLETION: 'task_create_custom_completion',
    TASK_LINK_TO_PLAN: 'task_link_to_plan',
    TASK_MONITORING_STATUS: 'task_monitoring_status',
    TASK_UPDATE: 'task_update' // Task status/progress update
} as const;

/**
 * Web Tools - Web search, navigation, and content extraction
 */
export const WEB_TOOLS = {
    WEB_SEARCH: 'web_search',
    WEB_NAVIGATE: 'web_navigate',
    WEB_BULK_EXTRACT: 'web_bulk_extract',
    WEB_SCREENSHOT: 'web_screenshot',
    API_FETCH: 'api_fetch'
} as const;

/**
 * Calculator Server Tools - Mathematical calculations and equation solving
 * tool names discovered from @wrtnlabs/calculator-mcp server
 */
export const CALCULATOR_TOOLS = {
    ADD: 'add',
    SUBTRACT: 'sub', 
    MULTIPLY: 'mul',
    DIVIDE: 'div',
    MODULO: 'mod',
    SQRT: 'sqrt'
} as const;

/**
 * Sequential Thinking Server Tools - Structured thought processes  
 * tool names discovered from @modelcontextprotocol/server-sequential-thinking
 */
export const SEQUENTIAL_THINKING_TOOLS = {
    SEQUENTIAL_THINKING: 'sequentialthinking'
} as const;

/**
 * Filesystem Server Tools - File and directory operations
 * tool names discovered from @modelcontextprotocol/server-filesystem
 */
export const FILESYSTEM_SERVER_TOOLS = {
    READ_FILE: 'read_file',
    WRITE_FILE: 'write_file', 
    EDIT_FILE: 'edit_file',
    CREATE_DIRECTORY: 'create_directory',
    LIST_DIRECTORY: 'list_directory',
    MOVE_FILE: 'move_file',
    SEARCH_FILES: 'search_files',
    GET_FILE_INFO: 'get_file_info',
    DELETE_FILE: 'delete_file',
    DELETE_DIRECTORY: 'delete_directory',
    COPY_FILE: 'copy_file'
} as const;

/**
 * Memory Server Tools - External memory storage and retrieval
 * tool names discovered from @modelcontextprotocol/server-memory
 */
export const MEMORY_SERVER_TOOLS = {
    CREATE_ENTITIES: 'create_entities',
    CREATE_RELATIONS: 'create_relations', 
    ADD_OBSERVATIONS: 'add_observations',
    DELETE_ENTITIES: 'delete_entities',
    DELETE_RELATIONS: 'delete_relations',
    DELETE_OBSERVATIONS: 'delete_observations',
    SEARCH_ENTITIES: 'search_entities',
    OPEN_NODES: 'open_nodes',
    QUERY_NODES: 'query_nodes'
} as const;


/**
 * Time Server Tools - Date/time operations and scheduling
 * Note: Disabled due to npm package availability issues
 */
export const TIME_SERVER_TOOLS = {
    GET_TIME: 'time_get_current',
    GET_TIMEZONE: 'time_get_timezone',
    FORMAT_TIME: 'time_format',
    PARSE_TIME: 'time_parse'
} as const;

/**
 * Git Server Tools - Version control operations
 * Note: Disabled due to npm package availability issues
 */
export const GIT_SERVER_TOOLS = {
    STATUS: 'git_status',
    ADD: 'git_add',
    COMMIT: 'git_commit',
    PUSH: 'git_push',
    PULL: 'git_pull',
    LOG: 'git_log'
} as const;

/**
 * Fetch Server Tools - HTTP requests and web data retrieval
 * Note: Disabled due to npm package availability issues
 */
export const FETCH_SERVER_TOOLS = {
    GET: 'fetch_get',
    POST: 'fetch_post',
    PUT: 'fetch_put',
    DELETE: 'fetch_delete'
} as const;

// =============================================================================
// AGGREGATED TOOL COLLECTIONS
// =============================================================================

/**
 * All Internal MXF Tools
 */
export const ALL_INTERNAL_TOOLS = {
    ...COMMUNICATION_TOOLS,
    ...COORDINATION_TOOLS,
    ...CONTROL_LOOP_TOOLS,
    ...INFRASTRUCTURE_TOOLS,
    ...CONTEXT_MEMORY_TOOLS,
    ...META_TOOLS,
    ...ACTION_VALIDATION_TOOLS,
    ...WEB_TOOLS,
    ...PLANNING_TOOLS,
    ...TASK_PLANNING_TOOLS
} as const;

/**
 * All External MCP Tools (Currently Active)
 */
export const ALL_ACTIVE_EXTERNAL_TOOLS = {
    ...CALCULATOR_TOOLS,
    ...SEQUENTIAL_THINKING_TOOLS,
    ...FILESYSTEM_SERVER_TOOLS,
    ...MEMORY_SERVER_TOOLS
} as const;

/**
 * All External MCP Tools (Including Disabled)
 */
export const ALL_EXTERNAL_TOOLS = {
    ...ALL_ACTIVE_EXTERNAL_TOOLS,
    ...TIME_SERVER_TOOLS,
    ...GIT_SERVER_TOOLS,
    ...FETCH_SERVER_TOOLS
} as const;

/**
 * All Tools (Internal + External)
 */
export const ALL_TOOLS = {
    ...ALL_INTERNAL_TOOLS,
    ...ALL_EXTERNAL_TOOLS
} as const;

// =============================================================================
// TOOL CATEGORIES
// =============================================================================

/**
 * Tool categories for filtering and recommendation
 */
export const TOOL_CATEGORIES = {
    COMMUNICATION: 'communication',
    COORDINATION: 'coordination',
    CONTROL_LOOP: 'control_loop',
    INFRASTRUCTURE: 'infrastructure',
    CONTEXT_MEMORY: 'context_memory',
    META: 'meta',
    ACTION_VALIDATION: 'action_validation',
    PLANNING: 'planning',
    TASK_PLANNING: 'task_planning',
    CALCULATION: 'calculation',
    THINKING: 'thinking',
    FILESYSTEM: 'filesystem',
    MEMORY: 'memory',
    TIME: 'time',
    VERSION_CONTROL: 'version_control',
    WEB_REQUEST: 'web_request',
    WEB: 'web',
    AUTOMATION: 'automation'
} as const;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Type definitions for tool names
 */
export type CommunicationToolName = typeof COMMUNICATION_TOOLS[keyof typeof COMMUNICATION_TOOLS];
export type CoordinationToolName = typeof COORDINATION_TOOLS[keyof typeof COORDINATION_TOOLS];
export type ControlLoopToolName = typeof CONTROL_LOOP_TOOLS[keyof typeof CONTROL_LOOP_TOOLS];
export type InfrastructureToolName = typeof INFRASTRUCTURE_TOOLS[keyof typeof INFRASTRUCTURE_TOOLS];
export type ContextMemoryToolName = typeof CONTEXT_MEMORY_TOOLS[keyof typeof CONTEXT_MEMORY_TOOLS];
export type MetaToolName = typeof META_TOOLS[keyof typeof META_TOOLS];
export type ActionValidationToolName = typeof ACTION_VALIDATION_TOOLS[keyof typeof ACTION_VALIDATION_TOOLS];
export type WebToolName = typeof WEB_TOOLS[keyof typeof WEB_TOOLS];
export type PlanningToolName = typeof PLANNING_TOOLS[keyof typeof PLANNING_TOOLS];
export type TaskPlanningToolName = typeof TASK_PLANNING_TOOLS[keyof typeof TASK_PLANNING_TOOLS];

export type CalculatorToolName = typeof CALCULATOR_TOOLS[keyof typeof CALCULATOR_TOOLS];
export type SequentialThinkingToolName = typeof SEQUENTIAL_THINKING_TOOLS[keyof typeof SEQUENTIAL_THINKING_TOOLS];
export type FilesystemServerToolName = typeof FILESYSTEM_SERVER_TOOLS[keyof typeof FILESYSTEM_SERVER_TOOLS];
export type MemoryServerToolName = typeof MEMORY_SERVER_TOOLS[keyof typeof MEMORY_SERVER_TOOLS];

export type InternalToolName = typeof ALL_INTERNAL_TOOLS[keyof typeof ALL_INTERNAL_TOOLS];
export type ExternalToolName = typeof ALL_EXTERNAL_TOOLS[keyof typeof ALL_EXTERNAL_TOOLS];
export type AnyToolName = typeof ALL_TOOLS[keyof typeof ALL_TOOLS];

export type ToolCategory = typeof TOOL_CATEGORIES[keyof typeof TOOL_CATEGORIES];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a tool name is internal to MXF
 */
export const isInternalTool = (toolName: string): toolName is InternalToolName => {
    return Object.values(ALL_INTERNAL_TOOLS).includes(toolName as InternalToolName);
};

/**
 * Check if a tool name is from an external MCP server
 */
export const isExternalTool = (toolName: string): toolName is ExternalToolName => {
    return Object.values(ALL_EXTERNAL_TOOLS).includes(toolName as ExternalToolName);
};

/**
 * Get the category of a tool based on its name
 */
export const getToolCategory = (toolName: string): ToolCategory | null => {
    if (Object.values(COMMUNICATION_TOOLS).includes(toolName as CommunicationToolName)) {
        return TOOL_CATEGORIES.COMMUNICATION;
    }
    if (Object.values(COORDINATION_TOOLS).includes(toolName as CoordinationToolName)) {
        return TOOL_CATEGORIES.COORDINATION;
    }
    if (Object.values(CONTROL_LOOP_TOOLS).includes(toolName as ControlLoopToolName)) {
        return TOOL_CATEGORIES.CONTROL_LOOP;
    }
    if (Object.values(INFRASTRUCTURE_TOOLS).includes(toolName as InfrastructureToolName)) {
        return TOOL_CATEGORIES.INFRASTRUCTURE;
    }
    if (Object.values(CONTEXT_MEMORY_TOOLS).includes(toolName as ContextMemoryToolName)) {
        return TOOL_CATEGORIES.CONTEXT_MEMORY;
    }
    if (Object.values(META_TOOLS).includes(toolName as MetaToolName)) {
        return TOOL_CATEGORIES.META;
    }
    if (Object.values(ACTION_VALIDATION_TOOLS).includes(toolName as ActionValidationToolName)) {
        return TOOL_CATEGORIES.ACTION_VALIDATION;
    }
    if (Object.values(WEB_TOOLS).includes(toolName as WebToolName)) {
        return TOOL_CATEGORIES.WEB;
    }
    if (Object.values(PLANNING_TOOLS).includes(toolName as PlanningToolName)) {
        return TOOL_CATEGORIES.PLANNING;
    }
    if (Object.values(TASK_PLANNING_TOOLS).includes(toolName as TaskPlanningToolName)) {
        return TOOL_CATEGORIES.TASK_PLANNING;
    }
    if (Object.values(CALCULATOR_TOOLS).includes(toolName as CalculatorToolName)) {
        return TOOL_CATEGORIES.CALCULATION;
    }
    if (Object.values(SEQUENTIAL_THINKING_TOOLS).includes(toolName as SequentialThinkingToolName)) {
        return TOOL_CATEGORIES.THINKING;
    }
    if (Object.values(FILESYSTEM_SERVER_TOOLS).includes(toolName as FilesystemServerToolName)) {
        return TOOL_CATEGORIES.FILESYSTEM;
    }
    if (Object.values(MEMORY_SERVER_TOOLS).includes(toolName as MemoryServerToolName)) {
        return TOOL_CATEGORIES.MEMORY;
    }
    return null;
};

/**
 * Get all tool names as an array
 */
export const getAllToolNames = (): string[] => {
    return Object.values(ALL_TOOLS);
};

/**
 * Get internal tool names as an array
 */
export const getInternalToolNames = (): string[] => {
    return Object.values(ALL_INTERNAL_TOOLS);
};

/**
 * Get external tool names as an array  
 */
export const getExternalToolNames = (): string[] => {
    return Object.values(ALL_EXTERNAL_TOOLS);
};

/**
 * Get active external tool names as an array
 */
export const getActiveExternalToolNames = (): string[] => {
    return Object.values(ALL_ACTIVE_EXTERNAL_TOOLS);
};
