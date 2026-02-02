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
 * MXF MCP Tools - Main Export Index
 * 
 * Centralized export for all MXF-specific MCP tools that enhance agent capabilities
 * through standardized MCP protocol interfaces. These tools leverage existing
 * MXF event infrastructure and maintain DRY principles.
 * 
 * Tool Categories:
 * - Agent Communication: Direct messaging, broadcasting, discovery, coordination
 * - Control Loop (ORPAR): Cognitive cycle management and control
 * - Infrastructure: Filesystem, memory, shell operations for system interaction
 * - Context & Memory: Channel context, agent memory, message history access
 * - Action Validation: Action validation and verification tools
 */

// Import all tool categories
import { agentCommunicationTools } from './AgentCommunicationTools';
import { coordinationTools } from './CoordinationTools';
import { controlLoopTools } from './ControlLoopTools';
import { infrastructureTools } from './InfrastructureTools';
import { contextMemoryTools } from './ContextMemoryTools';
import { metaTools } from './MetaTools';
import { actionValidationTools } from './ActionValidationTools';
import { webTools } from './WebTools';
import { gitTools } from './GitTools';
import { typescriptTools } from './TypeScriptTools';
import { taskBridgeTools } from './TaskBridgeTools';
import { testTools } from './TestTools';
import { codeAnalysisTools } from './CodeAnalysisTools';
import { safetyTools } from './SafetyTools';
import { toolHelpTools } from './ToolHelpTools';
import { PLANNING_TOOLS as planningTools } from './PlanningTools';
import { effectivenessTools } from './EffectivenessTools';
import { taskPlanningTools } from './TaskPlanningTools';
import { analyticsTools } from './AnalyticsTools';
import { dateTimeTools } from './DateTimeTools';
import { MemorySearchTools } from './MemorySearchTools';
import { JsonTools } from './JsonTools';
import { orparTools } from './OrparTools';
import { inferenceParameterTools } from './InferenceParameterTools';
import { MemoryUtilityTools } from './MemoryUtilityTools';
import { dagTools } from './DagTools';
import { knowledgeGraphTools } from './KnowledgeGraphTools';
import { predictiveTools } from './PredictiveTools';

/**
 * All available MXF MCP tools organized by category
 */
export const mxfMcpTools = {
    // Agent-to-agent communication tools
    communication: agentCommunicationTools,
    
    // Advanced coordination and collaboration tools
    coordination: coordinationTools,
    
    // ORPAR control loop management tools
    controlLoop: controlLoopTools,
    
    // Core infrastructure tools
    infrastructure: infrastructureTools,
    
    // Context and memory management tools
    contextMemory: [...contextMemoryTools, ...MemorySearchTools],
    
    // Action validation and verification tools
    actionValidation: actionValidationTools,
    
    // Meta-tools for intelligent tool management
    meta: [...metaTools, ...toolHelpTools],
    
    // Web search, navigation, and content extraction tools
    web: webTools,
    
    // Git version control tools
    git: gitTools,
    
    // TypeScript development tools
    typescript: typescriptTools,
    
    // Task management bridge tools
    taskBridge: taskBridgeTools,
    
    // Test runner tools
    test: testTools,
    
    // Code analysis and intelligence tools
    codeAnalysis: codeAnalysisTools,
    
    // Safety and rollback tools
    safety: safetyTools,
    
    // Planning and organization tools
    planning: planningTools,
    
    // Task effectiveness measurement tools
    effectiveness: effectivenessTools,
    
    // Task planning and intelligent completion tools
    taskPlanning: taskPlanningTools,
    
    // Analytics and performance monitoring tools
    analytics: analyticsTools,
    
    // Date and time manipulation tools
    dateTime: dateTimeTools,

    // JSON file manipulation tools
    json: [JsonTools.jsonAppend, JsonTools.jsonRead],

    // ORPAR cognitive cycle tools for explicit agent cognition
    orpar: orparTools,

    // Dynamic inference parameter control tools
    inferenceParameter: inferenceParameterTools,

    // Memory Utility Learning System (MULS) tools
    memoryUtility: MemoryUtilityTools,

    // Task DAG tools for dependency management
    dag: dagTools,

    // Knowledge Graph tools for entity/relationship management
    knowledgeGraph: knowledgeGraphTools,

    // Predictive analytics tools (ML error prediction, anomaly detection, risk scoring)
    predictive: predictiveTools
};

/**
 * Flattened array of all MXF MCP tools for easy registration
 */
export const allMxfMcpTools = [
    ...agentCommunicationTools,
    ...coordinationTools,
    ...controlLoopTools,
    ...infrastructureTools,
    ...contextMemoryTools,
    ...MemorySearchTools,
    ...actionValidationTools,
    ...metaTools,
    ...webTools,
    ...gitTools,
    ...typescriptTools,
    ...taskBridgeTools,
    ...testTools,
    ...codeAnalysisTools,
    ...safetyTools,
    ...toolHelpTools,
    ...planningTools,
    ...effectivenessTools,
    ...taskPlanningTools,
    ...analyticsTools,
    ...dateTimeTools,
    JsonTools.jsonAppend,
    JsonTools.jsonRead,
    ...orparTools,
    ...inferenceParameterTools,
    ...MemoryUtilityTools,
    ...dagTools,
    ...knowledgeGraphTools,
    ...predictiveTools
];

/**
 * Tool registry for quick lookup by name
 */
export const mxfMcpToolRegistry = new Map(
    allMxfMcpTools.map(tool => [tool.name, tool])
);

/**
 * Get tool by name with type safety
 */
export const getMxfMcpTool = (toolName: string) => {
    // Type-safe lookup in the registry
    return mxfMcpToolRegistry.get(toolName as any);
};

/**
 * Get all tool names organized by category
 */
export const getMxfMcpToolNames = () => {
    return {
        communication: agentCommunicationTools.map(tool => tool.name),
        coordination: coordinationTools.map(tool => tool.name),
        controlLoop: controlLoopTools.map(tool => tool.name),
        infrastructure: infrastructureTools.map(tool => tool.name),
        contextMemory: contextMemoryTools.map(tool => tool.name),
        actionValidation: actionValidationTools.map(tool => tool.name),
        meta: metaTools.map(tool => tool.name),
        web: webTools.map(tool => tool.name),
        git: gitTools.map(tool => tool.name),
        typescript: typescriptTools.map(tool => tool.name),
        taskBridge: taskBridgeTools.map(tool => tool.name),
        test: testTools.map(tool => tool.name),
        codeAnalysis: codeAnalysisTools.map(tool => tool.name),
        safety: safetyTools.map(tool => tool.name),
        planning: planningTools.map(tool => tool.name),
        effectiveness: effectivenessTools.map(tool => tool.name),
        analytics: analyticsTools.map(tool => tool.name),
        dateTime: dateTimeTools.map(tool => tool.name),
        predictive: predictiveTools.map(tool => tool.name),
        all: allMxfMcpTools.map(tool => tool.name)
    };
};

/**
 * Tool metadata for registration and discovery
 */
export const mxfMcpToolMetadata = {
    version: '1.0.0',
    description: 'MXF-specific MCP tools for enhanced agent capabilities',
    categories: ['communication', 'coordination', 'controlLoop', 'infrastructure', 'contextMemory', 'actionValidation', 'meta', 'web', 'git', 'typescript', 'taskBridge', 'test', 'codeAnalysis', 'safety', 'planning', 'effectiveness', 'analytics', 'dateTime', 'memoryUtility', 'dag', 'knowledgeGraph', 'predictive'],
    totalTools: allMxfMcpTools.length,
    capabilities: [
        'agent-to-agent messaging',
        'channel broadcasting', 
        'agent discovery',
        'task coordination',
        'collaboration requests',
        'workflow management',
        'coordination tracking',
        'ORPAR cycle management',
        'observation handling',
        'reasoning control',
        'planning operations',
        'action execution',
        'reflection generation',
        'filesystem operations',
        'memory management',
        'shell command execution',
        'channel context access',
        'channel memory operations',
        'agent context introspection',
        'message history retrieval',
        'enhanced memory search',
        'action validation',
        'web search',
        'web navigation',
        'content extraction',
        'screenshot capture',
        'git version control',
        'typescript development',
        'task management bridge',
        'test execution and reporting',
        'codebase analysis',
        'function finding',
        'dependency tracing',
        'refactoring suggestions',
        'architecture validation',
        'feature branch creation',
        'test suite execution',
        'performance benchmarking',
        'change rollback',
        'backup creation',
        'AI code review',
        'structured planning',
        'task breakdown',
        'plan tracking',
        'plan sharing',
        'task effectiveness measurement',
        'universal metrics tracking',
        'baseline comparisons',
        'effectiveness analytics',
        'intelligent task completion monitoring',
        'plan-based task completion',
        'SystemLLM-based completion evaluation',
        'automatic task completion detection',
        'comprehensive analytics reporting',
        'performance metrics analysis',
        'system health monitoring',
        'validation analytics',
        'tool usage insights',
        'data export and visualization',
        'temporal awareness and date/time operations',
        'timezone conversion and management',
        'date arithmetic and calculations',
        'date/time formatting and parsing',
        'relative time comparisons',
        'Q-value analytics and memory utility tracking',
        'utility-based memory retrieval configuration',
        'manual reward injection for memory feedback',
        'task dependency management and DAG operations',
        'topological task execution ordering',
        'cycle detection and dependency validation',
        'parallel task group identification',
        'critical path analysis',
        'knowledge graph entity management',
        'entity extraction from text',
        'relationship discovery and management',
        'graph context retrieval for ORPAR phases',
        'entity Q-value tracking and learning',
        'semantic entity search and path finding',
        'ML error prediction',
        'parameter anomaly detection',
        'proactive optimization suggestions',
        'operation risk scoring',
        'ML model metadata inspection'
    ]
};

// Re-export individual tool arrays for selective imports
export { agentCommunicationTools, coordinationTools, controlLoopTools, infrastructureTools, contextMemoryTools, MemorySearchTools, actionValidationTools, metaTools, webTools, gitTools, typescriptTools, taskBridgeTools, testTools, codeAnalysisTools, safetyTools, planningTools, effectivenessTools, taskPlanningTools, analyticsTools, dateTimeTools, inferenceParameterTools, MemoryUtilityTools, dagTools, knowledgeGraphTools, predictiveTools };

// Re-export individual tools for direct imports
export {
    // Agent Communication Tools
    agentMessageTool,
    agentBroadcastTool,
    agentDiscoverTool,
    agentCoordinateTool
} from './AgentCommunicationTools';

export {
    // Control Loop Tools
    controlLoopStartTool,
    controlLoopObserveTool,
    controlLoopReasonTool,
    controlLoopPlanTool,
    controlLoopExecuteTool,
    controlLoopReflectTool,
    controlLoopStatusTool,
    controlLoopStopTool
} from './ControlLoopTools';

export {
    // Infrastructure Tools
    // NOTE: Filesystem tools provided by external @modelcontextprotocol/server-filesystem MCP server
    memoryStoreTool,
    memoryRetrieveTool,
    shellExecTool,
    codeExecuteTool
} from './InfrastructureTools';

export {
    // Context & Memory Tools
    channelMemoryReadTool,
    channelMemoryWriteTool,
    channelContextReadTool,
    channelMessagesReadTool,
    agentContextReadTool,
    agentMemoryReadTool,
    agentMemoryWriteTool
} from './ContextMemoryTools';

export {
    // Memory Search Tools (Semantic Search)
    memory_search_conversations,
    memory_search_actions,
    memory_search_patterns
} from './MemorySearchTools';

export {
    // Action Validation Tools
    validateNextActionTool,
    noFurtherActionTool
} from './ActionValidationTools';

export {
    // Meta Tools
    tools_recommend
} from './MetaTools';

export {
    // Coordination Tools
    coordinationRequestTool,
    coordinationAcceptTool,
    coordinationRejectTool,
    coordinationStatusTool,
    coordinationUpdateTool,
    coordinationCompleteTool,
    coordinationListTool
} from './CoordinationTools';

export {
    // Web Tools
    webSearchTool,
    webNavigationTool,
    webContentExtractionTool,
    webScreenshotTool,
    apiFetchTool
} from './WebTools';

export {
    // Planning Tools
    planning_create,
    planning_update_item,
    planning_view,
    planning_share
} from './PlanningTools';

export {
    // Task Effectiveness Tools
    task_effectiveness_start,
    task_effectiveness_event,
    task_effectiveness_quality,
    task_effectiveness_complete,
    task_effectiveness_analytics,
    task_effectiveness_compare
} from './EffectivenessTools';

export {
    // Task Planning Tools
    task_create_with_plan,
    task_create_custom_completion,
    task_link_to_plan,
    task_monitoring_status
} from './TaskPlanningTools';

export {
    // Analytics Tools
    analytics_agent_performance,
    analytics_channel_activity,
    analytics_system_health,
    analytics_generate_report,
    analytics_task_completion,
    analytics_validation_metrics,
    analytics_tool_usage,
    analytics_compare_performance,
    analytics_dashboard_data,
    analytics_export_data
} from './AnalyticsTools';

export {
    // Date/Time Tools
    dateTimeNowTool,
    dateTimeConvertTool,
    dateTimeArithmeticTool,
    dateTimeFormatTool
} from './DateTimeTools';

export {
    // Inference Parameter Tools (P1)
    request_inference_params,
    reset_inference_params,
    get_current_params,
    get_parameter_status,
    get_available_models,
    getParameterCostAnalyticsTool as get_parameter_cost_analytics
} from './InferenceParameterTools';

export {
    // Memory Utility Learning System (MULS) Tools
    memory_qvalue_analytics,
    memory_utility_config,
    memory_inject_reward
} from './MemoryUtilityTools';

export {
    // Task DAG Tools
    dag_get_ready_tasks,
    dag_validate_dependency,
    dag_get_execution_order,
    dag_get_blocking_tasks,
    dag_get_parallel_groups,
    dag_get_critical_path,
    dag_get_stats
} from './DagTools';

export {
    // Knowledge Graph Tools
    kg_get_entity,
    kg_find_entity,
    kg_get_neighbors,
    kg_find_path,
    kg_get_context,
    kg_get_high_utility_entities,
    kg_create_entity,
    kg_create_relationship,
    kg_extract_from_text,
    kg_extract_from_memory,
    kg_get_phase_context,
    kg_find_duplicates,
    kg_merge_entities
} from './KnowledgeGraphTools';

export {
    // Predictive Analytics Tools
    predict_errors,
    detect_anomalies,
    proactive_suggestions,
    calculate_risk,
    model_metadata
} from './PredictiveTools';
