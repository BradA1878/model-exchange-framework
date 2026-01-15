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
 * Model Agent Class for the MXF - REFACTORED
 * 
 * Reduced from ~1500 lines to ~400 lines by extracting major subsystems into focused services.
 * Now serves as a clean orchestrator that composes specialized services.
 * 
 * Services extracted:
 * - MxfEventHandlerService: Event handling and responses (200 lines)
 * - MxfSystemPromptManager: Prompt generation and management (150 lines)  
 * - MemoryManager: Memory operations and conversation history (100 lines)
 * - TaskExecutor: Task execution workflows (80 lines)
 * - TelemetryService: Telemetry and analytics (100 lines)
 */

import { MxfClient } from "./MxfClient";
import { Logger } from '../shared/utils/Logger';
import { createStrictValidator } from '../shared/utils/validation';
import { ConversationMessage } from '../shared/interfaces/ConversationMessage';
import { AgentConfig } from '../shared/interfaces/AgentInterfaces';

// Import the extracted services
import { MxfEventHandlerService, EventHandlerCallbacks } from './services/MxfEventHandlerService';
import { MxfSystemPromptManager, PromptManagerCallbacks } from './managers/MxfSystemPromptManager';
import { MxfMemoryManager, MemoryManagerConfig } from './managers/MxfMemoryManager';
import { MxfTaskExecutionManager, TaskExecutionCallbacks } from './managers/MxfTaskExecutionManager';
import { MxfMcpClientManager } from './managers/MxfMcpClientManager';
import { MxfActionHistoryService } from './services/MxfActionHistoryService';
import { MxfContextBuilder } from './services/MxfContextBuilder';
import { MxfMessageAggregator } from '../shared/services/MxfMessageAggregator';
import { ReasoningToolParser } from '../shared/services/ReasoningToolParser';

// Import helpers (keeping these for utilities)
import { 
    ToolHelpers, 
    ToolExecutionHelpers, 
    ConversationHelpers, 
    AgentContext as LegacyAgentContext  // Renamed to avoid conflict with new AgentContext
} from './MxfAgentHelpers';

// Import new AgentContext interface
import { AgentContext } from '../shared/interfaces/AgentContext';
import { IntentFormulationHelper } from './helpers/IntentFormulationHelper';

// Import types
import { 
    IMcpClient, 
    McpMessage, 
    McpRole, 
    McpContentType,
    McpToolUseContent,
    McpToolResultContent,
    McpTextContent,
    McpTool, 
    McpApiResponse 
} from '../shared/protocols/mcp/IMcpClient';
import { McpToolDefinition } from '../shared/protocols/mcp/McpServerTypes';

import { 
    Observation, 
    Reasoning, 
    PlanAction,
    ActionStatus,
    Plan
} from '../shared/types/ControlLoopTypes';
import { EventBus } from '../shared/events/EventBus';
import { Events, ControlLoopEvents, AgentEvents } from '../shared/events/EventNames';
import { 
    BaseEventPayload, 
    ControlLoopEventPayload, 
    ControlLoopSpecificData, 
    createBaseEventPayload, 
    createControlLoopEventPayload, 
    createLlmReasoningEventPayload, 
    createLlmReasoningToolsSynthesizedEventPayload,
    LlmReasoningEventData,
    LlmReasoningToolsSynthesizedEventData
} from '../shared/schemas/EventPayloadSchema';
import { reflectionService } from '../shared/services/ReflectionService';

// Define a minimal ControlLoopStateEnum if needed
export enum ControlLoopStateEnum {
    IDLE = 'idle',
    INITIALIZING = 'initializing',
    READY = 'ready',
    RUNNING = 'running',
    STOPPED = 'stopped',
    ERROR = 'error'
}

/**
 * MxfAgent - Clean service-based architecture
 */
export class MxfAgent extends MxfClient {
    // Core components
    private modelLogger: Logger;
    private modelValidator = createStrictValidator('ModelAgent');
    private modelConfig: AgentConfig;
    
    // Service instances - each handles a specific responsibility
    private eventHandlerService!: MxfEventHandlerService;
    private systemPromptManager!: MxfSystemPromptManager;
    private memoryManager!: MxfMemoryManager;
    private taskExecutionManager!: MxfTaskExecutionManager;
    private mcpClientManager!: MxfMcpClientManager;
    private contextBuilder!: MxfContextBuilder;  // Context-based approach (production architecture)
    private messageAggregator?: MxfMessageAggregator;
    private reasoningToolParser?: ReasoningToolParser;
    
    // Current state tracking (minimal)
    private currentTask: any = null;
    private disableToolGatekeeping: boolean = false;
    private activeControlLoopId: string | null = null;
    private taskCompleted: boolean = false; // Prevent further LLM calls after task completion
    private taskAssignedHandler: ((data: any) => void) | null = null; // Store handler for cleanup
    
    // Circuit breaker pattern for detecting stuck behavior
    private recentToolCalls: Array<{toolName: string, timestamp: number, iteration: number, paramsHash: string}> = [];
    private stuckLoopDetections: number = 0;
    private readonly CIRCUIT_BREAKER_WINDOW_MS = 30000; // 30 seconds (increased from 10s to catch slower loops)
    private readonly MAX_SAME_TOOL_CALLS = 3; // Max calls to same tool in window
    private readonly MAX_CONSECUTIVE_SAME_TOOL = 3; // Max consecutive calls to same tool across iterations
    private readonly MAX_CONSECUTIVE_SAME_TOOL_WITH_DIFFERENT_PARAMS = 15; // Allow more if params are different (e.g., multiple API calls, creating multiple tasks)

    // Default MXF tools that legitimately need multiple consecutive calls (exempt from strict loop detection)
    private readonly DEFAULT_EXEMPT_TOOLS = [
        'web_navigate',      // Fetching from multiple URLs
        'web_search',        // Multiple search queries
        'task_create',       // Creating multiple tasks
        'messaging_send',    // Sending to multiple agents
        'read_file',         // Reading multiple files
        'filesystem_read',   // Reading multiple files
        // ORPAR control loop tools - legitimately called multiple times per cognitive cycle
        'orpar_status',      // Called to check phase status
        'orpar_observe',     // Called during observe phase
        'orpar_reason',      // Called during reason phase
        'orpar_plan',        // Called during plan phase
        'orpar_act',         // Called during act phase
        'orpar_reflect'      // Called during reflect phase
    ];
    // Combined list of exempt tools (default + injected via config)
    private circuitBreakerExemptTools: string[] = [];
    private lastToolName: string | null = null;
    private consecutiveSameToolCount: number = 0;
    private lastToolParamsHash: string | null = null;
    private consecutiveSameParamsCount: number = 0;
    
    // In-memory reasoning storage for conversation prompts
    private recentReasoning: Array<{
        content: string;
        timestamp: number;
        truncated?: boolean;
    }> = [];
    private readonly MAX_REASONING_ENTRIES = 5; // Keep last 5 reasoning entries
    
    // Fallback completion detection
    private completionDetectionState = {
        noToolCallIterations: 0,
        lastSignificantActivity: Date.now(),
        repeatingResponsePatterns: new Map<string, number>(),
        inactivityThreshold: 30000, // 30 seconds of inactivity
        maxNoToolIterations: 2, // Max iterations without tool calls before considering complete
        confidenceScores: [] as number[]
    };

    /**
     * Create a new MxfAgent instance with service-based architecture
     */
    constructor(config: AgentConfig) {
        // Initialize base client
        super(config);
        
        // Validate model-specific requirements
        this.modelValidator.assertIsNonEmptyString(config.llmProvider, 'llmProvider is required for MxfAgent');
        
        // Store configuration with defaults
        this.modelConfig = {
            ...config,
            temperature: config.temperature ?? 0.7,
            maxTokens: config.maxTokens ?? 8000,
            maxHistory: config.maxHistory ?? 500, // Increased from 50 to support tool-heavy workflows
            maxObservations: config.maxObservations ?? 10,
            cycleInterval: config.cycleInterval ?? 30000,
            enableTooling: config.enableTooling ?? true
        };
        
        // Initialize circuit breaker exempt tools (combine defaults with any injected from config)
        this.circuitBreakerExemptTools = [
            ...this.DEFAULT_EXEMPT_TOOLS,
            ...(config.circuitBreakerExemptTools || [])
        ];
        
        // Initialize logger
        this.modelLogger = new Logger('debug', `MxfAgent:${this.agentId}`, 'client');
        
        // Initialize all service managers
        this.initializeServices();
    }

    /**
     * Initialize all service managers with their callbacks
     */
    private initializeServices(): void {
        // Initialize MCP Client Manager
        this.mcpClientManager = new MxfMcpClientManager(this.agentId, this.modelConfig);
        
        // Initialize Memory Manager
        const memoryConfig: MemoryManagerConfig = {
            agentId: this.agentId,
            channelId: this.channelId!,
            maxHistory: this.modelConfig.maxHistory!,
            maxObservations: this.modelConfig.maxObservations!,
            enablePersistence: true,
            maxMessageSize: this.modelConfig.maxMessageSize
        };
        this.memoryManager = new MxfMemoryManager(memoryConfig);
        
        // Initialize System Prompt Manager
        const promptCallbacks: PromptManagerCallbacks = {
            getConversationHistory: () => this.memoryManager.getConversationHistory(),
            updateConversationMessage: (index, message) => this.memoryManager.updateConversationMessage(index, message),
            getCachedTools: () => this.toolService?.getCachedTools() || []
        };
        this.systemPromptManager = new MxfSystemPromptManager(this.agentId, this.modelConfig, promptCallbacks);
        
        // Initialize Context Builder (production architecture)
        this.contextBuilder = new MxfContextBuilder(this.agentId);

        // Initialize Message Aggregator if enabled in config
        if (this.modelConfig.useMessageAggregate === true) {
            this.messageAggregator = new MxfMessageAggregator(
                this.agentId,
                (fromAgents: string[], aggregatedContent: string) => this.handleAggregatedMessage(fromAgents, aggregatedContent),
                this.modelLogger
            );
        }
        
        // Initialize ReasoningToolParser if reasoning is enabled
        if (this.modelConfig.reasoning?.enabled === true) {
            this.reasoningToolParser = ReasoningToolParser.getInstance();
        }
        
        // Initialize Task Execution Manager
        const taskCallbacks: TaskExecutionCallbacks = {
            generateResponse: (prompt, tools, taskPrompt) => this.generateResponse(prompt || undefined, tools, taskPrompt),
            getCachedTools: () => this.toolService?.getCachedTools() || [],
            setCurrentTask: (task) => { 
                this.currentTask = task; 
                // Reset completion flag, circuit breaker, and action history when new task starts
                if (task) {
                    this.taskCompleted = false;
                    this.resetCircuitBreaker();
                    // Clear action history so agent doesn't see old actions from previous turns
                    this.contextBuilder?.actionHistoryService?.clearHistory(this.agentId);
                    this.modelLogger.debug('🔄 TASK FLAG: Reset completion flag for new task');
                }
            },
            getCurrentTask: () => this.currentTask,
            updateSystemPromptForTask: (task) => this.systemPromptManager.updatePromptForTask(task),
            isToolGatekeepingDisabled: () => this.disableToolGatekeeping,
            getAllowedTools: () => this.modelConfig.allowedTools
        };
        this.taskExecutionManager = new MxfTaskExecutionManager(this.agentId, taskCallbacks);

        // Initialize Event Handler Service
        const eventHandlerCallbacks: EventHandlerCallbacks = {
            addConversationMessage: (msg) => this.memoryManager.addConversationMessage(msg),
            provideImmediateToolFeedback: (fromAgent, tool, data, type) => this.provideImmediateToolFeedback(fromAgent, tool, data, type),
            generateResponse: (prompt, tools) => this.generateResponse(prompt, tools, undefined),
            getContextualTools: (history, tools) => this.getContextualTools(history, tools),
            getConversationHistory: () => this.memoryManager.getConversationHistory(),
            getAvailableTools: () => this.toolService?.getCachedTools() || [],
            getCurrentTask: () => this.currentTask,
            isToolGatekeepingDisabled: () => this.disableToolGatekeeping,
            hasActiveTask: () => this.taskExecutionManager.hasActiveTask(),
            getAgentCapabilities: () => this.config.capabilities || [],
            tryAggregateMessage: (fromAgent, content) => this.tryAggregateMessage(fromAgent, content)
        };
        this.eventHandlerService = new MxfEventHandlerService(this.agentId, eventHandlerCallbacks);
    }

    /**
     * Perform agent-specific initialization after connection
     */
    protected async performAgentInitialization(): Promise<void> {
        // Initialize MCP client
        await this.mcpClientManager.initializeMcpClient();
        
        // Initialize memory
        await this.memoryManager.initialize();
        
        // Set up system prompt with minimal content initially
        const minimalPrompt = this.systemPromptManager.generateMinimalPrompt();
        this.memoryManager.addConversationMessage({
            role: 'system',
            content: minimalPrompt
        });
        
        // Initialize event handlers
        this.eventHandlerService.initializeEventHandlers();
        
        // Listen for LLM_REASONING events to store reasoning in memory
        EventBus.client.on(AgentEvents.LLM_REASONING, (payload) => {
            if (payload.agentId === this.agentId) {
                this.storeReasoningInMemory(payload.data);
            }
        });
        
        // Listen for task assignments to update currentTask immediately
        this.taskAssignedHandler = async (payload: any) => {
            // Extract data from the event payload
            const data = payload.data || payload;
            if (data.agentId === this.agentId) {
                // Update currentTask immediately so hasActiveTask() returns true
                this.currentTask = data.taskRequest;

                // Update system prompt with task context
                try {
                    await this.systemPromptManager.updatePromptForTask(data.task);
                } catch (error) {
                    this.modelLogger.warn(`Failed to update system prompt for task: ${error}`);
                }
            }
        };
        EventBus.client.on(AgentEvents.TASK_ASSIGNED, this.taskAssignedHandler);
        
        // Set up task request handler with ORPAR integration
        this.setTaskRequestHandler(async (taskRequest: any) => {
            // Check if channel has systemLlmEnabled for ORPAR orchestration
            const channelConfig = this.mxfService.getChannelConfig();
            const systemLlmEnabled = channelConfig?.systemLlmEnabled ?? false;

            if (systemLlmEnabled && this.controlLoopHandlers) {
                try {
                    // Initialize ControlLoop if not already active
                    let loopId = this.controlLoopHandlers.getActiveControlLoopId();
                    if (!loopId) {
                        loopId = await this.controlLoopHandlers.initializeControlLoop({
                            agentId: this.agentId,
                            channelId: this.config.channelId
                        });
                        this.modelLogger.info(`[ORPAR] Initialized ControlLoop: ${loopId}`);

                        // Start the control loop so it processes observations through full ORPAR cycle
                        await this.controlLoopHandlers.startControlLoop(loopId);
                        this.modelLogger.info(`[ORPAR] Started ControlLoop: ${loopId}`);
                    }

                    // Submit task as observation to trigger ORPAR cycle
                    if (loopId) {
                        const observation = {
                            type: 'task_assigned',
                            content: `Task assigned: ${taskRequest.title || taskRequest.content}`,
                            taskId: taskRequest.taskId,
                            description: taskRequest.description || taskRequest.content,
                            timestamp: Date.now()
                        };
                        await this.controlLoopHandlers.submitObservation(loopId, observation);
                        this.modelLogger.info(`[ORPAR] Submitted task observation to ControlLoop`);
                    }
                } catch (error) {
                    this.modelLogger.warn(`[ORPAR] Failed to initialize/submit observation: ${error}`);
                    // Continue with task execution even if ORPAR setup fails
                }
            }

            return this.taskExecutionManager.executeTask(taskRequest);
        });
        
        // Ensure tools are loaded before generating system prompt
        if (this.toolService) {
            const tools = await this.toolService.loadTools();

            const hasTaskComplete = tools.some(tool => tool.name === 'task_complete');

            if (!hasTaskComplete) {
                // this.modelLogger.warn(`MISSING TOOL: task_complete not found in loaded tools. Available tools: ${tools.map(t => t.name).join(', ')}`);
            }

            // Set up persistent listener for tool updates (e.g., after Meilisearch backfill)
            this.toolService.setupPersistentToolListener();

            // Register callback to regenerate system prompt when tools are updated
            this.toolService.onToolsUpdated(async (updatedTools) => {
                // Regenerate system prompt with new tools
                try {
                    await this.systemPromptManager.loadCompleteSystemPrompt();
                } catch (error) {
                    this.modelLogger.error(`Failed to regenerate system prompt: ${error}`);
                }
            });
        } else {
            this.modelLogger.error('CRITICAL: toolService not available during initialization');
        }

        // Load complete system prompt with tools
        await this.systemPromptManager.loadCompleteSystemPrompt();
    }

    /**
     * Generate response using the MCP client with tool execution
     */
    private async generateResponse(userMessage?: string, tools?: any[], taskPrompt?: string): Promise<string> {
        // CRITICAL: Check if agent has completed its task
        // Only allow new responses if:
        // 1. Agent has not completed a task (taskCompleted = false), OR
        // 2. This is a new task assignment (taskPrompt provided)
        if (this.taskCompleted && !taskPrompt) {
            return 'Task already completed - agent is idle';
        }
        
        const maxIterations = this.modelConfig.maxIterations ?? 10;
        
        // Notify aggregator that agent is starting to process
        if (this.messageAggregator) {
            this.modelLogger.debug('🎯 Agent starting generateResponse - aggregator notified');
        }
        
        // Initialize conversation with user message if provided (but NOT task prompts)
        if (userMessage && userMessage.trim() && !taskPrompt) {
            this.memoryManager.addConversationMessage({
                role: 'user',
                content: userMessage
            });
        }

        // Execute synchronous tool loop
        let iteration = 0;
        let taskComplete = false;

        while (iteration < maxIterations && !taskComplete) {
            iteration++;

            // Check if task was canceled externally
            if (!this.currentTask && !taskPrompt) {
                this.modelLogger.debug('🛑 Task canceled externally - stopping LLM loop');
                break;
            }

            // CRITICAL FIX: When phase-gated (allowedTools set), get FRESH tools from server each iteration
            // The passed `tools` parameter may be pre-filtered for a different phase (e.g., OBSERVE)
            // When phase transitions to ACT, we need game tools that weren't in the original filtered set
            // Also: getCachedTools() only has internal MXF tools - external MCP server tools require a refresh
            let availableTools: any[];

            if (this.modelConfig.allowedTools && this.modelConfig.allowedTools.length > 0) {
                // Phase-gated mode: Force refresh tools from server to include external MCP server tools
                // This is critical because external tools (game_setSecret) aren't in the initial cache
                try {
                    availableTools = await this.toolService?.loadTools(undefined, true) || [];
                } catch (error) {
                    this.modelLogger.warn(`Failed to refresh tools, using cached: ${error}`);
                    availableTools = this.toolService?.getCachedTools() || [];
                }
                const originalCount = availableTools.length;
                availableTools = availableTools.filter(tool =>
                    this.modelConfig.allowedTools!.includes(tool.name)
                );
                this.modelLogger.debug(`🔒 Phase-gated tools: ${originalCount} → ${availableTools.length} tools (allowed: ${this.modelConfig.allowedTools.join(', ')})`);
            } else {
                // Non-phase-gated mode: Use passed tools or get from service (backward compatible)
                availableTools = this.getAvailableToolsForGeneration(tools);
            }

            // Recalculate contextual tools each iteration with fresh availableTools
            const updatedConversation = this.memoryManager.getConversationHistory();

            // Check if last message was a tool execution feedback - if so, send minimal tools
            const lastMessage = updatedConversation[updatedConversation.length - 1];
            const isToolFeedback = lastMessage?.content?.includes('TOOL EXECUTION ACKNOWLEDGMENT') ||
                                   lastMessage?.content?.includes('TOOL EXECUTION ERROR');

            // Use minimal tool set for tool feedback responses, full contextual tools otherwise
            const toolsToSend = isToolFeedback ?
                this.getMinimalToolsForFeedback(availableTools) :
                this.getContextualTools(updatedConversation, availableTools);
            
            // Build AgentContext from current state
            const baseConversation = this.memoryManager.getConversationHistory();

            // Build task context from current task
            const buildTaskDesc = (task: any): string => {
                if (taskPrompt) return taskPrompt;
                const title = task.title || task.task?.title || task.taskRequest?.task?.title || 'Untitled Task';
                // SimpleTaskRequest now has both 'description' and 'content' (same value)
                const desc = task.description || task.content || task.task?.description || task.taskRequest?.task?.description || '';
                return desc ? `${title}\n\n${desc}` : title;
            };
            
            const taskContext = this.currentTask ? {
                description: buildTaskDesc(this.currentTask),
                taskId: this.currentTask.id || this.currentTask.taskId,
                title: this.currentTask.title || this.currentTask.task?.title || this.currentTask.taskRequest?.task?.title || 'Untitled Task',
                status: this.currentTask.status || this.currentTask.task?.status || 'in_progress',
                progress: this.currentTask.progress || this.currentTask.task?.progress || 0,
                assignedBy: this.currentTask.assignedBy
            } : null;
            
            // Get system prompt from conversation history (but don't include it in the history)
            // System prompts are dynamically generated and passed separately via context.systemPrompt
            // Including them in conversationHistory causes redundancy and Meilisearch indexing waste
            const systemMessage = baseConversation.find(msg => msg.role === 'system');
            const systemPrompt = systemMessage?.content || this.systemPromptManager.generateMinimalPrompt();

            // Filter out system messages - they're passed separately via systemPrompt
            const conversationWithoutSystem = baseConversation.filter(msg => msg.role !== 'system');

            // Build complete context with channel config, active agents, and ORPAR phase
            const currentOrparPhase = this.controlLoopHandlers?.getCurrentPhase() || null;
            const agentContext: AgentContext = await this.contextBuilder.buildContext(
                systemPrompt,
                this.modelConfig,
                conversationWithoutSystem,
                taskContext,
                toolsToSend,
                this.config.channelId,
                this.mxfService.getChannelConfig(),
                this.mxfService.getActiveAgents(),
                currentOrparPhase
            );

            // Send using context-based approach
            const mcpOptions: Record<string, any> = {};
            if (this.modelConfig.reasoning?.enabled) {
                mcpOptions.reasoning = this.modelConfig.reasoning;
            }
            
            // Send with context to MCP client
            const response = await this.mcpClientManager.sendWithContext(agentContext, mcpOptions);
            
            // Handle reasoning tokens if enabled and available  
            const responseWithReasoning = response as any; // Type assertion for reasoning property
            if (this.modelConfig.reasoning?.enabled && responseWithReasoning.reasoning) {
                const reasoningData: LlmReasoningEventData = {
                    reasoning: responseWithReasoning.reasoning,
                    modelName: this.modelConfig.defaultModel,
                    provider: this.modelConfig.llmProvider,
                    config: this.modelConfig.reasoning,
                    timestamp: Date.now()
                };
                
                const reasoningPayload = createLlmReasoningEventPayload(
                    AgentEvents.LLM_REASONING,
                    this.agentId,
                    this.config.channelId,
                    reasoningData
                );

                // Emit reasoning event for transparency
                EventBus.client.emit(AgentEvents.LLM_REASONING, reasoningPayload);

                // Parse reasoning for tool intentions ONLY if no standard tool_calls are present
                // This prevents duplicate tool calls when models provide both reasoning and standard tool_calls
                const hasStandardToolCalls = response.content.some((c: any) => c.type === McpContentType.TOOL_USE);
                
                if (this.reasoningToolParser && toolsToSend && toolsToSend.length > 0 && !hasStandardToolCalls) {
                    try {
                        const parseResult = await this.reasoningToolParser.parseReasoningForTools(
                            responseWithReasoning.reasoning,
                            toolsToSend,
                            this.agentId,
                            this.config.channelId
                        );
                        
                        if (parseResult.parseSuccessful && parseResult.synthesizedToolCalls.length > 0) {
                            // Add synthesized tool calls to response content
                            response.content.push(...parseResult.synthesizedToolCalls);
                            
                            // Emit synthesis event using helper method
                            const synthesizedData: LlmReasoningToolsSynthesizedEventData = {
                                toolCalls: parseResult.synthesizedToolCalls.map(tc => ({
                                    type: tc.type,
                                    id: tc.id,
                                    name: tc.name,
                                    input: tc.input
                                })),
                                toolIntentions: parseResult.toolIntentions,
                                parseMethod: parseResult.parseMethod,
                                synthesisSuccessful: true
                            };
                            
                            const synthesisPayload = createLlmReasoningToolsSynthesizedEventPayload(
                                AgentEvents.LLM_REASONING_TOOLS_SYNTHESIZED,
                                this.agentId,
                                this.config.channelId,
                                synthesizedData
                            );
                            
                            EventBus.client.emit(AgentEvents.LLM_REASONING_TOOLS_SYNTHESIZED, synthesisPayload);
                        } else {
                            this.modelLogger.debug(`🔍 No tool intentions found in reasoning text`);
                        }
                    } catch (error) {
                        this.modelLogger.error(`❌ Failed to parse reasoning for tools: ${error}`);
                    }
                }
            }
            
            // Extract text content
            const responseText = response.content
                .filter((content: any) => content.type === McpContentType.TEXT)
                .map((content: any) => 'text' in content ? content.text : '')
                .join('\n');

            const payload = createBaseEventPayload(
                AgentEvents.LLM_RESPONSE,
                this.agentId,
                this.config.channelId,
                responseText
            );

            // Emit LLM response event for external monitoring
            EventBus.client.emit(AgentEvents.LLM_RESPONSE, payload);

            // Handle tool calls first to include them in conversation message
            let toolCalls = response.content.filter((content: any) => content.type === McpContentType.TOOL_USE);
            
            // Create assistant message object (but DON'T store yet - wait for JSON parsing)
            const assistantMessage: any = {
                role: 'assistant',
                content: responseText,
                metadata: {
                    agentId: this.agentId
                }
            };
            
            // Enhance intents for structured tool calls
            toolCalls = toolCalls.map((toolCall: any) => {
                if (toolCall.name === 'tools_recommend' && toolCall.input?.intent) {
                    const originalIntent = toolCall.input.intent;
                    const enhancedIntent = IntentFormulationHelper.formulateToolDiscoveryIntent(originalIntent);

                    if (enhancedIntent !== originalIntent) {
                        return {
                            ...toolCall,
                            input: {
                                ...toolCall.input,
                                intent: enhancedIntent
                            }
                        };
                    }
                }
                return toolCall;
            });
            
            // Parse JSON tool calls if no structured calls found
            if (toolCalls.length === 0) {
                const textContent = response.content.filter((content: any) => content.type === McpContentType.TEXT);
                for (const content of textContent) {
                    const textStr = 'text' in content ? content.text : '';
                    const parsedToolCalls = ToolHelpers.parseJsonToolCalls(textStr, availableTools, this.modelLogger);
                    
                    // Convert parsed JSON tool calls to MCP format
                    for (const parsedCall of parsedToolCalls) {
                        // Skip system error messages
                        if (parsedCall.name === '__SYSTEM_ERROR__') {
                            // Add error message to conversation for context
                            this.memoryManager.addConversationMessage({
                                role: 'user',
                                content: `⚠️ Tool call format error: ${parsedCall.input.message}`
                            });
                            continue;
                        }
                        
                        // Enhance intent for tools_recommend
                        let enhancedInput = parsedCall.input;
                        if (parsedCall.name === 'tools_recommend' && parsedCall.input?.intent) {
                            const originalIntent = parsedCall.input.intent;
                            const enhancedIntent = IntentFormulationHelper.formulateToolDiscoveryIntent(originalIntent);

                            if (enhancedIntent !== originalIntent) {
                                enhancedInput = {
                                    ...parsedCall.input,
                                    intent: enhancedIntent
                                };
                            }
                        }
                        
                        // Convert to MCP tool call format
                        const mcpToolCall: McpToolUseContent = {
                            type: McpContentType.TOOL_USE,
                            name: parsedCall.name,
                            input: enhancedInput,
                            id: parsedCall.id
                        };
                        toolCalls.push(mcpToolCall);
                    }
                }
            }
            
            // NOW store the assistant message with ALL tool_calls (structured + JSON-parsed)
            // This ensures tool_calls and tool_results are properly paired for OpenRouter
            if (toolCalls.length > 0) {
                assistantMessage.tool_calls = toolCalls.map((toolCall: any) => ({
                    id: toolCall.id,
                    type: 'function',
                    function: {
                        name: toolCall.name,
                        arguments: JSON.stringify(toolCall.input)
                    }
                }));
            }
            this.memoryManager.addConversationMessage(assistantMessage);

            if (toolCalls.length > 0) {
                // Reset no-tool iterations counter
                this.completionDetectionState.noToolCallIterations = 0;
                this.completionDetectionState.lastSignificantActivity = Date.now();

                const toolExecutionResult = await this.handleToolExecutionWithHelpers(toolCalls, availableTools, iteration);

                if (toolExecutionResult.taskComplete) {
                    taskComplete = true;
                }
                
                // REAL FIX: Properly store tool results in conversation history with correct pairing
                if (toolExecutionResult.toolResults && toolExecutionResult.toolResults.length > 0) {
                    // Add tool results to conversation history immediately after tool calls with proper linking
                    for (const toolResult of toolExecutionResult.toolResults) {
                        // Extract content from tool result - handle all formats including legacy
                        let content: string;

                        // CRITICAL: Check if result has content wrapper (new format) or is legacy format
                        if (!toolResult.content) {
                            // Legacy format - plain object without content wrapper
                            // Examples: TaskBridgeTools, old InfrastructureTools
                            content = JSON.stringify(toolResult);
                            this.modelLogger.debug(`📋 Legacy tool result format detected (no content wrapper)`);
                        } else if (Array.isArray(toolResult.content)) {
                            // Array of content items (external MCP servers)
                            content = toolResult.content.map(c => {
                                if (c.type === McpContentType.TEXT) {
                                    return (c as McpTextContent).text;
                                } else if ((c as any).data !== undefined) {
                                    // Handle {type: "application/json", data: {...}}
                                    return typeof (c as any).data === 'string' ? (c as any).data : JSON.stringify((c as any).data);
                                } else if ((c as any).type === 'image' || (c as any).type === 'binary') {
                                    // Binary content from external servers
                                    return `[Binary content: ${(c as any).mimeType || 'unknown type'}]`;
                                } else {
                                    return 'Non-text content';
                                }
                            }).join('\n');
                        } else if (toolResult.content.type === McpContentType.TEXT) {
                            // Standard MCP text content
                            content = (toolResult.content as McpTextContent).text;
                        } else if ((toolResult.content as any).data !== undefined) {
                            // Custom format: {type: "application/json", data: {...}}
                            const data = (toolResult.content as any).data;
                            content = typeof data === 'string' ? data : JSON.stringify(data);
                        } else if ((toolResult.content as any).text !== undefined) {
                            // Alternative text field
                            content = (toolResult.content as any).text;
                        } else if ((toolResult.content as any).type === 'binary' || (toolResult.content as any).type === 'image') {
                            // Binary content
                            content = `[Binary content: ${(toolResult.content as any).mimeType || 'unknown type'}]`;
                        } else {
                            content = 'Non-text content';
                        }
                        
                        // Get tool name for this result
                        const toolName = (toolCalls.find(tc => tc.type === McpContentType.TOOL_USE && (tc as McpToolUseContent).id === toolResult.tool_use_id) as McpToolUseContent)?.name || 'unknown';
                        
                        // Special handling for read_file with empty content
                        if (toolName === 'read_file' && (!content || content.trim() === '')) {
                            content = '⚠️ FILE EXISTS BUT IS EMPTY: The file you requested exists but contains no content. This is not an error - the file is simply empty. You should proceed with your task assuming there is no existing data in this file.';
                            this.modelLogger.warn(`🔔 Empty file read detected for read_file - added helpful message to guide LLM`);
                        }
                        
                        const toolResultMessage: ConversationMessage = {
                            id: `tool-result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            role: 'tool', // Use proper TOOL role directly
                            content: content,
                            timestamp: Date.now(),
                            metadata: {
                                tool_call_id: toolResult.tool_use_id,
                                toolName: toolName,
                                fromAgentId: this.agentId,
                                isToolResult: true
                            }
                        };

                        const contentSize = content.length;
                        const contentPreview = content.substring(0, 200);
                        if (contentSize > 10000) {
                            this.modelLogger.warn(`LARGE TOOL RESULT: ${toolName} has ${contentSize} bytes - may impact context window`);
                        }

                        // Add to conversation history with proper sequencing
                        this.memoryManager.addConversationMessage(toolResultMessage);
                    }

                    // Continue to next iteration with tool results - don't break the loop
                    continue;
                } else {
                    this.modelLogger.warn(`⚠️ NO TOOL RESULTS: Tool execution returned no results for ${toolCalls.length} tool calls`);
                    
                    // Create synthetic error results for all tool calls that didn't get results
                    // This ensures every tool_call has a matching tool_result to satisfy OpenRouter/Bedrock requirements
                    for (const toolCall of toolCalls) {
                        // Cast to McpToolUseContent to access properties
                        const toolUseCall = toolCall as McpToolUseContent;
                        
                        // Add synthetic tool result directly to conversation history
                        const syntheticToolResult: ConversationMessage = {
                            id: `tool-result-synthetic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            role: 'tool',
                            content: `Tool execution failed: No result was returned for ${toolUseCall.name}. The tool may have encountered an internal error or timeout.`,
                            timestamp: Date.now(),
                            metadata: {
                                tool_call_id: toolUseCall.id || `unknown-${Date.now()}`,
                                toolName: toolUseCall.name,
                                fromAgentId: this.agentId,
                                isToolResult: true,
                                synthetic: true,
                                error: true
                            }
                        };
                        
                        this.memoryManager.addConversationMessage(syntheticToolResult);
                    }

                    // Continue to next iteration with synthetic results
                    continue;
                }
            } else {
                // No tool calls - check for fallback completion
                this.completionDetectionState.noToolCallIterations++;
                
                // Analyze response for completion indicators
                const completionAnalysis = await this.analyzeResponseForCompletion(responseText);

                if (completionAnalysis.shouldComplete) {
                    // Auto-complete the task if confidence is high enough
                    if (completionAnalysis.confidence >= 0.8) {
                        await this.autoCompleteTask(completionAnalysis.reason);
                        taskComplete = true;
                    }
                    break;
                }
                
                // Check if we've exceeded no-tool iterations
                if (this.completionDetectionState.noToolCallIterations >= this.completionDetectionState.maxNoToolIterations) {
                    // Check if this is a reactive agent before auto-completing
                    const isReactiveAgent = this.isReactiveAgent();

                    if (isReactiveAgent) {
                        // Reset the counter to prevent constant logging
                        this.completionDetectionState.noToolCallIterations = 0;
                        // Continue waiting instead of auto-completing
                        continue;
                    } else {
                        await this.autoCompleteTask('Multiple iterations without tool usage');
                        taskComplete = true;
                        break;
                    }
                }
            }
        }

        // Handle final response
        if (iteration >= maxIterations && !taskComplete) {
            this.modelLogger.error('Maximum iterations reached without task completion');
        }

        // Notify aggregator that agent has finished processing
        if (this.messageAggregator) {
            this.messageAggregator.onAgentResponse();
            this.modelLogger.debug('✅ Agent finished generateResponse - aggregator notified');
        }
        
        // Return final response
        const finalMessages = this.memoryManager.getConversationHistory();
        const lastAssistantMessage = [...finalMessages].reverse().find(msg => msg.role === 'assistant');
        return lastAssistantMessage?.content || 'Task completed successfully.';
    }

    /**
     * Handle tool execution with helpers support
     */
    private async handleToolExecutionWithHelpers(toolCalls: any[], availableTools: any[], iteration: number): Promise<{ taskComplete: boolean; toolResults?: McpToolResultContent[] }> {
        // Execute ALL tool calls to ensure every tool_call has a corresponding tool_result
        // This prevents OpenRouter/Bedrock errors about missing tool results
        const allToolResults: McpToolResultContent[] = [];
        let anyTaskComplete = false;
        
        // CRITICAL: Collect feedback messages to add AFTER all tool results
        // Adding user messages between tool_calls and tool results breaks conversation structure
        // Required order: assistant(tool_calls) → tool → tool → ... → user (feedback)
        const deferredFeedbackMessages: Array<{role: string; content: string; metadata?: Record<string, any>}> = [];
        
        for (const toolCall of toolCalls) {
            // Track tool call for circuit breaker pattern (include params for better stuck detection)
            this.trackToolCall(toolCall.name, iteration, toolCall.input);
            
            // Check for stuck behavior before executing
            if (this.checkForStuckBehavior()) {
                const stats = this.getCircuitBreakerStats();
                this.modelLogger.error(
                    `CIRCUIT BREAKER ACTIVATED: Preventing tool execution due to stuck behavior. ` +
                    `Recent calls: ${JSON.stringify(stats.toolCallFrequency)}`
                );
                
                // DEFERRED: Add system intervention AFTER tool results to maintain conversation structure
                deferredFeedbackMessages.push({
                    role: 'user',
                    content: `SYSTEM INTERVENTION: You are stuck in a loop calling the same tool repeatedly (${toolCall.name}). This tool call has been BLOCKED.

REQUIRED ACTIONS:
1. STOP calling ${toolCall.name} immediately 
2. Try a completely different approach or tool
3. If your task is complete, call task_complete
4. If you're waiting for a response, wait patiently instead of resending

This iteration has been skipped. Choose a different action or complete the task.`
                });
                
                // Create an error result for this tool call to maintain pairing
                const errorResult: McpToolResultContent = {
                    type: McpContentType.TOOL_RESULT,
                    tool_use_id: toolCall.id,
                    content: {
                        type: McpContentType.TEXT,
                        text: 'Tool execution blocked by circuit breaker due to stuck behavior'
                    } as McpTextContent
                };
                allToolResults.push(errorResult);
                continue; // Skip to next tool call
            }

            // SOLUTION 1: Identify messaging tools that should skip feedback
            const messagingTools = [
                'messaging_send',
                'messaging_broadcast',
                'agent_coordinate',
                'message_send',
                'send_message',
                'broadcast_message'
            ];
            
            const isMessagingTool = messagingTools.includes(toolCall.name);

            try {
                // Execute tool synchronously
                const toolResult = await this.executeTool(toolCall.name, toolCall.input || {});
            
                // SOLUTION 1: Smart feedback for messaging tools
                if (isMessagingTool) {
                    // Check if the tool execution was successful
                    const isSuccess = toolResult && !toolResult.error && toolResult.status !== 'error';
                    
                    // Validate message content for JSON/structured data (common error)
                    const messageContent = toolCall.input?.message || toolCall.input?.content || '';
                    const containsJSON = typeof messageContent === 'string' && 
                        (messageContent.includes('{') || messageContent.includes('[') || messageContent.includes('"'));
                    
                    // Validate agent ID exists (check for non-existent agents)
                    const targetAgentId = toolCall.input?.targetAgentId || toolCall.input?.agentId || toolCall.input?.recipient;
                    // Note: We can't dynamically check agent existence from SDK side without server call
                    // The proper validation happens server-side in AgentCommunicationTools
                    const isValidAgentId = !!targetAgentId;
                        
                    if (!isValidAgentId || !isSuccess) {
                        // Provide corrective feedback for failed messaging
                        let errorMessage = `🚫 MESSAGING ERROR:\n`;
                        
                        if (!isValidAgentId) {
                            errorMessage += `• Missing or invalid agent ID: "${targetAgentId}"\n`;
                            errorMessage += '• Please provide a valid target agent ID\n';
                        }
                        
                        if (!isSuccess) {
                            errorMessage += `• Tool execution failed: ${toolResult?.error || 'Unknown error'}\n`;
                        }
                        
                        errorMessage += '\n🔧 FIX: Send a natural language message to a valid agent ID.';
                        
                        // DEFERRED: Add error feedback AFTER tool results to maintain conversation structure
                        deferredFeedbackMessages.push({
                            role: 'user',
                            content: errorMessage
                        });
                        
                        // Create error result to maintain pairing
                        const errorResult: McpToolResultContent = {
                            type: McpContentType.TOOL_RESULT,
                            tool_use_id: toolCall.id,
                            content: {
                                type: McpContentType.TEXT,
                                text: errorMessage
                            } as McpTextContent
                        };
                        allToolResults.push(errorResult);
                        continue; // Skip to next tool call
                    }
                }

                // Create proper MCP tool result instead of conversation messages
                const isSuccess = ToolExecutionHelpers.isToolExecutionSuccessful(toolResult);
                
                if (!isSuccess) {
                    // DEFERRED: Add error feedback AFTER tool results to maintain conversation structure
                    deferredFeedbackMessages.push({
                        role: 'user',
                        content: `🚫 TOOL ERROR: ${toolCall.name} failed - ${toolResult?.error || 'Unknown error'}`
                    });
                    
                    // Create error result to maintain pairing
                    const errorResult: McpToolResultContent = {
                        type: McpContentType.TOOL_RESULT,
                        tool_use_id: toolCall.id,
                        content: {
                            type: McpContentType.TEXT,
                            text: `Tool error: ${toolResult?.error || 'Unknown error'}`
                        } as McpTextContent
                    };
                    allToolResults.push(errorResult);
                    continue; // Skip to next tool call
                }
            
                // For successful tool execution, create proper MCP tool result
                let toolResultContent: McpToolResultContent = {
                    type: McpContentType.TOOL_RESULT,
                    tool_use_id: toolCall.id,
                    content: {
                        type: McpContentType.TEXT,
                        text: ToolExecutionHelpers.getDetailedToolResultMessage(
                            toolResult, 
                            toolCall.name, 
                            toolCall.input,
                            availableTools
                        )
                    } as McpTextContent
                };

                // Check for task completion before returning tool result
                const taskComplete = toolCall.name === 'task_complete';
                if (taskComplete) {
                    // Handle duplicate task_complete calls
                    if (!this.taskExecutionManager.hasActiveTask()) {
                        this.modelLogger.warn('⚠️ DUPLICATE TASK_COMPLETE: Task already completed, treating as success');
                        // Still add the tool result for proper pairing, just mark as already complete
                        toolResultContent = {
                            ...toolResultContent,
                            content: {
                                type: McpContentType.TEXT,
                                text: 'Task was already completed. Duplicate task_complete acknowledged.'
                            } as McpTextContent
                        };
                        allToolResults.push(toolResultContent);
                        return { taskComplete: true, toolResults: allToolResults };
                    }

                    // Set completion flag to prevent further LLM calls
                    this.taskCompleted = true;
                    
                    // Clear task context to prevent further tool gatekeeping issues
                    this.taskExecutionManager.cancelCurrentTask('Task completed via task_complete');
                    
                    anyTaskComplete = true;
                    allToolResults.push(toolResultContent);
                    
                    // NOTE: Do NOT add user feedback message here - it would break conversation structure
                    // The tool result itself contains completion info, and no further LLM calls happen
                    // after task completion anyway
                    
                    return { taskComplete: true, toolResults: allToolResults };
                }
                
                // Add tool result to collection for non-task_complete tools
                allToolResults.push(toolResultContent);

            } catch (error) {
                this.modelLogger.error(`❌ Tool execution failed: ${error}`);

                // Create error result to maintain tool_call/tool_result pairing
                const errorResult: McpToolResultContent = {
                    type: McpContentType.TOOL_RESULT,
                    tool_use_id: toolCall.id,
                    content: {
                        type: McpContentType.TEXT,
                        text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
                    } as McpTextContent
                };
                allToolResults.push(errorResult);

                // DEFERRED: Add error context AFTER tool results to maintain conversation structure
                // Using 'user' role instead of 'assistant' to avoid consecutive assistant messages
                deferredFeedbackMessages.push({
                    role: 'user',
                    content: `⚠️ Tool execution error for ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
                    metadata: {
                        toolName: toolCall.name,
                        input: toolCall.input,
                        error: error instanceof Error ? error.message : String(error),
                        timestamp: Date.now()
                    }
                });
            }
        } // End of for loop
        
        // NOW add all deferred feedback messages AFTER tool results are complete
        // This maintains proper conversation structure: assistant(tool_calls) → tool → ... → user
        for (const feedbackMsg of deferredFeedbackMessages) {
            this.memoryManager.addConversationMessage(feedbackMsg);
        }
        
        // Return all collected results
        return { taskComplete: anyTaskComplete, toolResults: allToolResults };
    }

    /**
     * Get contextual tools using helper
     */
    private getContextualTools(conversationHistory: ConversationMessage[], allTools: any[]): any[] {
        const context: LegacyAgentContext = {
            agentId: this.agentId,
            currentTask: this.currentTask,
            disableToolGatekeeping: this.disableToolGatekeeping,
            allowedTools: this.modelConfig.allowedTools  // Pass allowedTools from agent config
        };

        return ToolHelpers.getContextualTools(conversationHistory, allTools, context, this.modelLogger);
    }

    /**
     * Get minimal tools for post-tool-execution feedback (just essential tools)
     */
    private getMinimalToolsForFeedback(allTools: any[]): any[] {
        // SOLUTION 2: Exclude ALL messaging tools from feedback to prevent spam
        const messagingTools = [
            'messaging_send',
            'messaging_broadcast', 
            'agent_coordinate',
            'message_send',
            'send_message',
            'broadcast_message',
            'agent_message',
            'channel_message'
        ];
        
        // Return only essential non-messaging tools
        // This prevents re-prompting with messaging tools after they've been used
        return allTools.filter(tool => {
            const toolName = tool.name || tool.function?.name || '';
            // Keep task_complete but exclude all messaging tools
            if (messagingTools.includes(toolName)) {
                return false;
            }
            // Include essential tools like task_complete and tool discovery
            return ['task_complete', 'tools_recommend', 'tools_discover'].includes(toolName);
        });
    }

    /**
     * Get available tools for generation
     */
    private getAvailableToolsForGeneration(tools?: any[]): any[] {
        if (tools && tools.length > 0) {
            return tools;
        }

        if (!this.toolService?.isLoaded()) {
            throw new Error('ToolService not loaded - tools required for operation');
        }

        const availableTools = this.toolService.getCachedTools() || [];
        if (availableTools.length === 0) {
            throw new Error('No cached tools available - critical failure');
        }

        return availableTools;
    }

    /**
     * Provide immediate tool feedback when targeted by other agents
     */
    private async provideImmediateToolFeedback(
        fromAgentId: string, 
        toolName: string, 
        toolData: any, 
        toolType: string
    ): Promise<string> {
        // Guard: Skip immediate feedback if no active task or task already completed
        if (!this.taskExecutionManager.hasActiveTask() || this.taskCompleted) {
            return 'Task already completed - no further feedback needed.';
        }
        
        try {
            const availableTools = this.getAvailableToolsForGeneration();
            const contextualTools = this.getContextualTools(
                this.memoryManager.getConversationHistory(),
                availableTools
            );

            // Get the last message which should be the incoming message
            const conversationHistory = this.memoryManager.getConversationHistory();
            const currentIncomingMessage = conversationHistory[conversationHistory.length - 1];
            
            // Generate structured prompt with explicit current message
            const structuredPrompt = await this.generateStructuredConversationPromptWithCurrentMessage(
                conversationHistory,
                currentIncomingMessage
            );
            
            // Generate response using the structured prompt
            // Convert structured prompt array to string for generateResponse
            const promptText = structuredPrompt[0]?.content || '';
            return await this.generateResponse(promptText, contextualTools, undefined);
        } catch (error) {
            this.modelLogger.error(`❌ Error providing immediate tool feedback: ${error}`);
            return `Error processing tool feedback: ${error}`;
        }
    }

    /**
     * Register a tool with the agent
     */
    public async registerTool(tool: McpTool): Promise<boolean> {
        try {
            await this.mcpClientManager.initializeMcpClient();
            
            // Convert McpTool to McpToolDefinition format expected by parent class
            const toolDefinition: McpToolDefinition = {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.input_schema,
                enabled: true,
                metadata: {},
                handler: async () => {
                    throw new Error('Tool execution must be handled via events');
                }
            };
            
            // Use parent class proxy method
            const success = await super.registerTool(toolDefinition);
            
            if (success) {
                // Also register with MCP client manager
                await this.mcpClientManager.registerTool(tool);
            }

            return success;
        } catch (error) {
            this.modelLogger.error(`Failed to register tool: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Execute an MCP tool with enhanced LLM agent context
     */
    public async executeTool(toolName: string, input: any, channelId?: string): Promise<any> {
        try {
            // Ensure MCP client is ready
            await this.mcpClientManager.initializeMcpClient();
            
            // Use parent class proxy method
            const result = await super.executeTool(toolName, input, channelId);
            
            // Track action locally for context building
            if (this.contextBuilder?.actionHistoryService) {
                // Build action description based on tool type
                let description = '';
                let metadata: any = {};
                
                if (toolName === 'messaging_send') {
                    const targetAgentId = input.agentId || input.targetAgentId || input.recipient;
                    const message = input.content || input.message || JSON.stringify(input);
                    description = message;
                    metadata = {
                        targetAgentId,
                        messageContent: message
                    };
                    
                    // Use structured message creation
                    const { MxfStructuredPromptBuilder } = await import('./services/MxfStructuredPromptBuilder');
                    const dialogueMessage = MxfStructuredPromptBuilder.createDialogueMessage(
                        'sent',
                        this.agentId,    // Who sent it (this agent)
                        targetAgentId,   // Who it was sent to
                        message
                    );
                    
                    // Ensure outgoing messages are NOT marked as current incoming
                    dialogueMessage.metadata = {
                        ...dialogueMessage.metadata,
                        isCurrentIncomingMessage: false,
                        sentAt: Date.now()
                    };
                    
                    // Add the clean dialogue message to conversation history
                    this.memoryManager.addConversationMessage(dialogueMessage);
                } else if (toolName === 'task_complete') {
                    description = input.message || input.result || 'Task completed';
                } else if (toolName === 'tools_recommend') {
                    // For tools_recommend, extract tool names from the result
                    if (result?.recommendedTools && Array.isArray(result.recommendedTools)) {
                        const toolNames = result.recommendedTools
                            .map((tool: any) => tool.name || tool.tool || tool)
                            .filter((name: any) => typeof name === 'string');
                        description = toolNames.join(', ');
                    } else {
                        // Fallback to input if result not available yet
                        const tools = input.tools || input.recommendations || [];
                        description = Array.isArray(tools) ? tools.join(', ') : String(tools);
                    }
                } else {
                    // Generic description for other tools
                    description = input.message || input.description || JSON.stringify(input).substring(0, 100);
                }
                
                this.contextBuilder.actionHistoryService.trackAction({
                    timestamp: Date.now(),
                    agentId: this.agentId,
                    toolName,
                    description,
                    input,
                    result,
                    metadata
                });
            }
            
            return result;
            
        } catch (error) {
            this.logger.error(`Tool execution failed for ${toolName}: ${error}`);
            
            // Add error to conversation history 
            this.memoryManager.addConversationMessage({
                role: 'assistant',
                content: `Tool execution failed: ${toolName}`,
                metadata: {
                    toolName,
                    input,
                    error: error instanceof Error ? error.message : String(error),
                    timestamp: Date.now()
                }
            });
            
            throw error;
        }
    }

    /**
     * List available MCP tools with LLM agent filtering
     */
    public async listTools(channelId?: string, filter?: any): Promise<any[]> {
        try {
            await this.mcpClientManager.initializeMcpClient();
            return await super.listTools(channelId, filter);
        } catch (error) {
            this.modelLogger.error(`Failed to list tools: ${error}`);
            throw error;
        }
    }

    /**
     * Unregister an MCP tool
     */
    public async unregisterTool(toolName: string, channelId?: string): Promise<boolean> {
        try {
            const success = await super.unregisterTool(toolName, channelId);
            
            if (success) {
                await this.mcpClientManager.unregisterTool(toolName);
            }

            return success;
        } catch (error) {
            this.modelLogger.error(`Failed to unregister tool ${toolName}: ${error}`);
            return false;
        }
    }

    /**
     * Generate a reflection from a completed plan and emit it as a control loop event
     * @param loopId - The control loop ID
     * @param plan - The completed plan to reflect on
     */
    async generateReflection(loopId: string, plan: Plan): Promise<void> {
        try {
            // Use the enhanced reflection service
            const reflection = reflectionService.generateReflection(plan);

            // Store reflection in agent memory if available
            if (this.apiService) {
                await this.addNote(`reflection:${reflection.id}`, reflection);
                this.modelLogger.debug(`Stored reflection in agent memory`);
            }
            
            // Emit reflection event
            const controlLoopReflectionData: ControlLoopSpecificData = {
                loopId: loopId,
                status: 'reflecting',
                reflection: reflection
            };
            
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.REFLECTION,
                this.agentId,
                this.config.channelId,
                controlLoopReflectionData
            );

            EventBus.client.emit(Events.ControlLoop.REFLECTION, payload);
        } catch (error) {
            this.modelLogger.error(`Error generating reflection: ${error}`);
        }
    }

    /**
     * Context injection types with distinct formatting
     */
    private getContextTypeFormatting(type: 'conversation' | 'prompt' | 'tool' | 'task' | 'system'): { icon: string; label: string; guidance: string } {
        switch (type) {
            case 'conversation':
                return {
                    icon: '📊',
                    label: 'RECENT CONVERSATION CONTEXT',
                    guidance: '[This context is provided to help you understand recent activities and make informed decisions.]'
                };
            case 'prompt':
                return {
                    icon: '🎯',
                    label: 'CURRENT PROMPT',
                    guidance: '[This is the current user request or prompt that requires your attention.]'
                };
            case 'tool':
                return {
                    icon: '🔧',
                    label: 'TOOL RESULT',
                    guidance: '[This is the result from a recently executed tool call.]'
                };
            case 'task':
                return {
                    icon: '📋',
                    label: 'TASK ASSIGNMENT',
                    guidance: '[This is a task assignment that requires your immediate attention and action.]'
                };
            case 'system':
                return {
                    icon: '💭',
                    label: 'SYSTEM MESSAGE',
                    guidance: '[This is a system-level message providing important context or instructions.]'
                };
            default:
                return {
                    icon: '📊',
                    label: 'CONTEXT',
                    guidance: '[This context is provided for your reference.]'
                };
        }
    }

    /**
     * Inject context into conversation with specific type formatting
     */
    private injectContextIntoConversation(
        conversation: ConversationMessage[],
        content: string,
        type: 'conversation' | 'prompt' | 'tool' | 'task' | 'system',
        role: 'user' | 'system' = 'user'
    ): ConversationMessage[] {
        const conversationCopy = [...conversation];
        const formatting = this.getContextTypeFormatting(type);
        
        // Determine injection point based on type
        let injectionIndex: number;
        
        if (type === 'task') {
            // Tasks should be appended at the END of conversation for chronological ordering
            // This ensures subsequent task assignments appear after existing conversation
            injectionIndex = conversationCopy.length;
        } else {
            // Other types (system, prompt, tool, conversation) inject after last system message
            injectionIndex = 0;
            for (let i = conversationCopy.length - 1; i >= 0; i--) {
                if (conversationCopy[i].role === 'system') {
                    injectionIndex = i + 1;
                    break;
                }
            }
        }
        
        // Create context message with proper formatting for agent conversations
        const contextMessage: ConversationMessage = {
            id: `${type}-context-${Date.now()}`,
            role,
            content: `${formatting.icon} ${formatting.label}:\n${content}\n\n${formatting.guidance}`,
            timestamp: Date.now()
        };
        
        // Insert the context message at the determined index
        conversationCopy.splice(injectionIndex, 0, contextMessage);
        
        this.modelLogger.debug(`✅ ${formatting.label} injected into conversation context for agent ${this.agentId}`);
        return conversationCopy;
    }

    /**
     * Inject action history into conversation context for LLM prompts
     */
    private async injectActionHistoryIntoConversation(conversation: ConversationMessage[]): Promise<ConversationMessage[]> {
        try {
            // Get recent action history - MxfActionHistoryService needs to be instantiated, not singleton
            const actionHistoryService = new MxfActionHistoryService();
            const actionHistory = await actionHistoryService.getFormattedHistory(this.agentId, 5);
            
            // If no action history, return original conversation
            if (!actionHistory || actionHistory === '(No recent actions)') {
                return conversation;
            }
            
            // Use the new context injection system
            return this.injectContextIntoConversation(conversation, actionHistory, 'conversation', 'user');
            
        } catch (error) {
            this.modelLogger.error(`Failed to inject action history: ${error}`);
            // Return original conversation on error
            return conversation;
        }
    }

    /**
     * Generate structured conversation prompt with clear sections matching user specification
     */
    private async generateStructuredConversationPrompt(conversationHistory: ConversationMessage[]): Promise<ConversationMessage[]> {
        // Build comprehensive structured prompt as ONE message
        const promptSections: string[] = [];

        // 1. Recent Actions Section
        const actionsSection = await this.formatRecentActionsSection();
        promptSections.push(actionsSection);

        // 2. Recent Reasoning Section (conditional - only appears if reasoning exists)
        const reasoningSection = this.formatReasoningSection();
        if (reasoningSection) {
            promptSections.push(reasoningSection);
        }

        // 3. Conversation History Section
        // COMMENTED OUT: Redundant with individual conversation messages sent via MCP client
        // The LLM receives full conversation as structured messages, no need for text summary
        // const conversationSection = this.formatConversationHistorySection(conversationHistory);
        // promptSections.push(conversationSection);

        // 4. Current SystemLLM Insight Section (if available)
        const systemInsightSection = this.formatSystemInsightSection(conversationHistory);
        if (systemInsightSection) {
            promptSections.push(systemInsightSection);
        }

        // 5. Current Message Section
        const currentMessageSection = this.formatCurrentMessageSection(conversationHistory);
        if (currentMessageSection) {
            promptSections.push(currentMessageSection);
        }

        // Combine all sections into one comprehensive prompt
        const structuredPrompt = promptSections.join('\n\n\n');

        // Return as single conversation message
        return [{
            id: `structured-prompt-${Date.now()}`,
            role: 'user',
            content: structuredPrompt,
            timestamp: Date.now()
        }];
    }

    /**
     * Generate structured conversation prompt with explicit current message
     */
    private async generateStructuredConversationPromptWithCurrentMessage(
        conversationHistory: ConversationMessage[],
        currentMessage: ConversationMessage | null
    ): Promise<ConversationMessage[]> {
        // Build comprehensive structured prompt as ONE message
        const promptSections: string[] = [];

        // 1. Recent Actions Section
        const actionsSection = await this.formatRecentActionsSection();
        promptSections.push(actionsSection);

        // 2. Recent Reasoning Section (conditional - only appears if reasoning exists)
        const reasoningSection = this.formatReasoningSection();
        if (reasoningSection) {
            promptSections.push(reasoningSection);
        }

        // 3. Conversation History Section (exclude the current message)
        // COMMENTED OUT: Redundant with individual conversation messages sent via MCP client
        // The LLM receives full conversation as structured messages, no need for text summary
        // const historyWithoutCurrent = currentMessage 
        //     ? conversationHistory.filter(msg => msg !== currentMessage && msg.id !== currentMessage.id)
        //     : conversationHistory;
        // const conversationSection = this.formatConversationHistorySection(historyWithoutCurrent);
        // promptSections.push(conversationSection);

        // 4. Current SystemLLM Insight Section (if available)
        const systemInsightSection = this.formatSystemInsightSection(conversationHistory);
        if (systemInsightSection) {
            promptSections.push(systemInsightSection);
        }

        // 5. Current Message Section (use the explicit current message)
        if (currentMessage) {
            const senderName = this.getMessageSenderName(currentMessage);
            const currentMessageSection = `## Current Message\n[${senderName}]: ${currentMessage.content}`;
            promptSections.push(currentMessageSection);
        }

        // Combine all sections into one comprehensive prompt
        const structuredPrompt = promptSections.join('\n\n\n');

        // Return as single conversation message
        return [{
            id: `structured-prompt-${Date.now()}`,
            role: 'user',
            content: structuredPrompt,
            timestamp: Date.now()
        }];
    }

    /**
     * Format recent actions section
     */
    private async formatRecentActionsSection(): Promise<string> {
        try {
            // Get recent action history from service
            const actionHistoryService = new MxfActionHistoryService();
            const actionHistory = await actionHistoryService.getFormattedHistory(this.agentId, 10);
            
            if (!actionHistory || actionHistory === '(No recent actions)') {
                return '## Your Recent Actions\nNone';
            }

            // Parse and reformat action history into the required format
            const actionLines = actionHistory.split('\n')
                .filter(line => line.trim() && !line.startsWith('#'))
                .slice(0, 10)
                .map(line => line.startsWith('-') ? line : `- ${line}`);

            if (actionLines.length === 0) {
                return '## Your Recent Actions\nNone';
            }

            return `## Your Recent Actions\n${actionLines.join('\n')}`;
            
        } catch (error) {
            this.modelLogger.error(`Failed to format recent actions: ${error}`);
            return '## Your Recent Actions\nNone';
        }
    }

    /**
     * Format recent reasoning section (conditional - only appears if reasoning exists)
     */
    private formatReasoningSection(): string | null {
        if (this.recentReasoning.length === 0) {
            return null; // Section won't appear if no reasoning
        }
        
        const formattedReasoning = this.recentReasoning
            .map(r => `- ${r.content.substring(0, 200)}${r.truncated ? '...' : ''}`)
            .join('\n');
            
        return `## Recent LLM Reasoning\n${formattedReasoning}`;
    }

    /**
     * Format conversation history section
     */
    private formatConversationHistorySection(conversationHistory: ConversationMessage[]): string {
        // Get actual conversation messages (not system/tool messages)
        // Filter out system messages, tool messages, and structured prompts
        const allConversationMessages = conversationHistory
            .filter(msg => 
                !msg.content.startsWith('[SYSTEM]') &&
                !msg.content.includes('TOOL EXECUTION') &&
                !msg.content.includes('Tool executed:') &&
                !msg.content.includes('📊') &&
                !msg.content.includes('🛠️') &&
                !msg.content.includes('⚡') &&
                !msg.content.includes('## Your Recent Actions') &&
                !msg.content.includes('## Conversation History') &&
                !msg.content.includes('## Current Message') &&
                msg.role !== 'system'
            );
            
        // For first message or no history, return None
        if (allConversationMessages.length === 0) {
            return '## Conversation History\nNone';
        }
        
        // Show up to 15 most recent messages (but not the current incoming message)
        const conversationMessages = allConversationMessages.slice(-15);

        if (conversationMessages.length === 0) {
            return '## Conversation History\nNone';
        }

        // CRITICAL: This section is TEXT embedded in a prompt, NOT individual messages
        // It does NOT go through MCP client's convertConversationToMcp()
        // Therefore, we MUST add attribution here for the agent to understand context
        const formattedMessages = conversationMessages.map(msg => {
            const agentName = this.getMessageSenderName(msg);
            
            // Skip attribution if content already has it (prevents double-prefixing)
            if (msg.content.match(/^\[[\w-]+\]:/)) {
                return msg.content;
            }
            
            return `[${agentName}]: ${msg.content}`;
        });

        return `## Conversation History\n${formattedMessages.join('\n')}`;
    }

    /**
     * Format SystemLLM insight section
     */
    private formatSystemInsightSection(conversationHistory: ConversationMessage[]): string | null {
        // Look for ONLY ephemeral SystemLLM messages, NOT the static system prompt
        const systemInsights = conversationHistory
            .filter(msg => 
                // Only capture short SystemLLM notices, not the full system prompt
                (msg.content.includes('SYSTEM NOTICE') && msg.content.length < 500) ||
                (msg.content.includes('Circuit breaker activated')) ||
                (msg.content.includes('SystemLLM') && msg.content.length < 200) ||
                // Exclude the static system prompt (usually very long)
                (msg.role === 'system' && 
                 msg.content.length < 300 && 
                 !msg.content.includes('MXF Agent Operating Environment') &&
                 !msg.content.includes('CRITICAL CONTEXT') &&
                 !msg.content.includes('MANDATORY TOOL USAGE FORMAT'))
            )
            .slice(-3); // Last 3 system insights

        if (systemInsights.length === 0) {
            return null;
        }

        const insights = systemInsights.map(msg => 
            `[SystemLLM]: ${msg.content}`
        ).join('\n');

        return `## Current SystemLLM Insight\n${insights}`;
    }

    /**
     * Format current message section
     */
    private formatCurrentMessageSection(conversationHistory: ConversationMessage[]): string | null {
        // Find the message marked as the current incoming message
        const currentIncomingMessage = conversationHistory
            .filter(msg => 
                msg.metadata?.isCurrentIncomingMessage === true &&
                !msg.content.includes('📊') &&
                !msg.content.includes('🛠️') &&
                !msg.content.includes('⚡') &&
                !msg.content.includes('🎯') &&
                !msg.content.startsWith('## Your Recent Actions')
            )
            .slice(-1)[0]; // Get the most recent one

        if (!currentIncomingMessage) {
            return null;
        }

        const senderName = this.getMessageSenderName(currentIncomingMessage);
        
        return `## Current Message\n[${senderName}]: ${currentIncomingMessage.content}`;
    }

    /**
     * Get proper sender name for message attribution
     */
    private getMessageSenderName(msg: ConversationMessage): string {
        // For received messages, check fromAgentId first (who sent it TO this agent)
        if (msg.metadata?.fromAgentId) {
            return msg.metadata.fromAgentId;
        }
        
        // Check for originalAgentId (from StructuredPromptBuilder)
        if (msg.metadata?.originalAgentId) {
            return msg.metadata.originalAgentId;
        }
        
        // Check for agentId in metadata (for sent messages, this is the sender)
        if (msg.metadata?.agentId) {
            return msg.metadata.agentId;
        }
        
        // Check for sender information in metadata
        if (msg.metadata?.senderId) {
            return msg.metadata.senderId;
        }
        
        // CRITICAL: Check if content already has [agentId]: prefix (from convertConversationToMcp)
        const prefixMatch = msg.content.match(/^\[([^\]]+)\]:/);
        if (prefixMatch) {
            return prefixMatch[1]; // Extract agent ID from existing prefix
        }
        
        // Fallback to generic labels based on role only
        if (msg.role === 'assistant') {
            return this.agentId; // Assistant messages are from this agent
        } else if (msg.role === 'user') {
            // For external input messages with no metadata, attribute to receiving agent
            return `External-to-${this.agentId}`;
        } else if (msg.role === 'system') {
            return 'System';
        }
        
        return 'Unknown';
    }

    /**
     * Inject current prompt context (public method for external use)
     */
    public injectCurrentPrompt(conversation: ConversationMessage[], promptContent: string): ConversationMessage[] {
        return this.injectContextIntoConversation(conversation, promptContent, 'prompt', 'user');
    }

    /**
     * Inject tool result context (public method for external use)
     */
    public injectToolResult(conversation: ConversationMessage[], toolResult: string): ConversationMessage[] {
        return this.injectContextIntoConversation(conversation, toolResult, 'tool', 'user');
    }

    /**
     * Inject task assignment context (public method for external use)
     */
    public injectTaskAssignment(conversation: ConversationMessage[], taskContent: string): ConversationMessage[] {
        return this.injectContextIntoConversation(conversation, taskContent, 'task', 'system');
    }

    /**
     * Inject system message context (public method for external use)
     */
    public injectSystemMessage(conversation: ConversationMessage[], systemContent: string): ConversationMessage[] {
        return this.injectContextIntoConversation(conversation, systemContent, 'system', 'system');
    }

    /**
     * Set a new system prompt, replacing any existing one
     */
    public setAgentConfigPrompt(agentConfigPrompt: string): void {
        this.systemPromptManager.setAgentConfigPrompt(agentConfigPrompt);
    }

    /**
     * Update LLM configuration parameters
     */
    public updateConfiguration(config: Partial<AgentConfig>): void {
        this.modelConfig = { ...this.modelConfig, ...config };
    }

    /**
     * Override updateAllowedTools to also update modelConfig and regenerate system prompt.
     * This ensures that when allowedTools changes dynamically (e.g., for phase-gated tools),
     * both the tools sent to LLM and the system prompt reflect the new allowed tools.
     */
    public async updateAllowedTools(tools: string[]): Promise<void> {
        // Call parent implementation (updates this.config and server)
        await super.updateAllowedTools(tools);

        // CRITICAL: Also update modelConfig which is used by task execution
        // Without this, getAllowedTools() callback returns stale allowedTools
        this.modelConfig.allowedTools = tools;

        // Regenerate system prompt with new allowed tools
        // The system prompt includes tool documentation, which should only show allowed tools
        try {
            await this.systemPromptManager.loadCompleteSystemPrompt();
            this.modelLogger.debug(`🔄 System prompt regenerated for ${tools.length} allowed tools`);
        } catch (error) {
            this.modelLogger.warn(`Failed to regenerate system prompt after tools update: ${error}`);
        }
    }

    /**
     * Enable or disable tool gatekeeping (for debugging purposes)
     */
    public setToolGatekeepingDisabled(disabled: boolean): void {
        this.disableToolGatekeeping = disabled;
    }

    /**
     * Check if tool gatekeeping is currently disabled
     */
    public isToolGatekeepingDisabled(): boolean {
        return this.disableToolGatekeeping;
    }

    /**
     * Create a simple hash of tool parameters to detect duplicate calls
     */
    private hashToolParams(params: any): string {
        try {
            // For simple comparison, just stringify and hash key fields
            const str = JSON.stringify(params);
            // Simple hash - not cryptographic, just for comparison
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash.toString();
        } catch {
            return 'unknown';
        }
    }

    /**
     * Track tool call for circuit breaker pattern
     */
    private trackToolCall(toolName: string, iteration: number, params?: any): void {
        const timestamp = Date.now();
        const paramsHash = params ? this.hashToolParams(params) : 'no-params';
        this.recentToolCalls.push({ toolName, timestamp, iteration, paramsHash });
        
        // Track consecutive calls to same tool
        if (this.lastToolName === toolName) {
            this.consecutiveSameToolCount++;
            // Also track if params are the same
            if (this.lastToolParamsHash === paramsHash) {
                this.consecutiveSameParamsCount++;
            } else {
                this.consecutiveSameParamsCount = 1;
            }
        } else {
            this.lastToolName = toolName;
            this.consecutiveSameToolCount = 1;
            this.consecutiveSameParamsCount = 1;
        }
        
        this.lastToolParamsHash = paramsHash;
        
        // Clean up old entries outside the window
        this.recentToolCalls = this.recentToolCalls.filter(
            call => timestamp - call.timestamp <= this.CIRCUIT_BREAKER_WINDOW_MS
        );
    }

    /**
     * Check for stuck behavior using circuit breaker pattern
     */
    private checkForStuckBehavior(): boolean {
        const now = Date.now();
        
        // Check if current tool is exempt (game tools, etc.)
        const isExemptTool = this.lastToolName && this.circuitBreakerExemptTools.includes(this.lastToolName);
        
        // Check #1a: Consecutive same tool calls with SAME parameters (true stuck loop)
        // For exempt tools, use a much higher threshold (10 instead of 3)
        const sameParamsThreshold = isExemptTool ? 10 : this.MAX_CONSECUTIVE_SAME_TOOL;
        if (this.consecutiveSameParamsCount >= sameParamsThreshold) {
            this.stuckLoopDetections++;
            this.modelLogger.warn(
                `CIRCUIT BREAKER: Agent stuck calling ${this.lastToolName} with SAME parameters ${this.consecutiveSameParamsCount} consecutive times (detection #${this.stuckLoopDetections})`
            );
            return true;
        }
        
        // Check #1b: Consecutive same tool calls with DIFFERENT parameters (might be legitimate, higher threshold)

        if (!isExemptTool && this.consecutiveSameToolCount >= this.MAX_CONSECUTIVE_SAME_TOOL_WITH_DIFFERENT_PARAMS) {
            this.stuckLoopDetections++;
            this.modelLogger.warn(
                `CIRCUIT BREAKER: Agent calling ${this.lastToolName} too many times (${this.consecutiveSameToolCount} consecutive calls, even with different params) (detection #${this.stuckLoopDetections})`
            );
            return true;
        }

        // For exempt tools, only block if it's REALLY excessive (e.g., 50+ calls)
        if (isExemptTool && this.consecutiveSameToolCount >= 50) {
            this.stuckLoopDetections++;
            this.modelLogger.warn(
                `CIRCUIT BREAKER: Even exempt tool ${this.lastToolName} called excessively (${this.consecutiveSameToolCount} times) (detection #${this.stuckLoopDetections})`
            );
            return true;
        }
        
        // Check #2: Same tool called too frequently within time window with same params
        // Skip exempt tools (game tools, etc.) which legitimately need repeated calls
        const recentCalls = this.recentToolCalls.filter(
            call => now - call.timestamp <= this.CIRCUIT_BREAKER_WINDOW_MS
        );
        
        // Count occurrences of each tool + params combination (excluding exempt tools)
        const toolParamsCounts = recentCalls.reduce((acc, call) => {
            // Skip exempt tools - they can be called frequently during valid gameplay
            if (this.circuitBreakerExemptTools.includes(call.toolName)) {
                return acc;
            }
            const key = `${call.toolName}:${call.paramsHash}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        // Check if any non-exempt tool+params combination is called too frequently
        for (const [key, count] of Object.entries(toolParamsCounts)) {
            if (count >= this.MAX_SAME_TOOL_CALLS) {
                const [toolName] = key.split(':');
                this.stuckLoopDetections++;
                this.modelLogger.warn(
                    `CIRCUIT BREAKER: Agent stuck calling ${toolName} with same params ${count} times in ${this.CIRCUIT_BREAKER_WINDOW_MS/1000}s window (detection #${this.stuckLoopDetections})`
                );
                return true;
            }
        }
        
        return false;
    }

    /**
     * Get circuit breaker statistics
     */
    public getCircuitBreakerStats(): {
        recentToolCallsCount: number;
        stuckLoopDetections: number;
        toolCallFrequency: Record<string, number>;
    } {
        const now = Date.now();
        const recentCalls = this.recentToolCalls.filter(
            call => now - call.timestamp <= this.CIRCUIT_BREAKER_WINDOW_MS
        );
        
        const frequency = recentCalls.reduce((acc, call) => {
            acc[call.toolName] = (acc[call.toolName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        return {
            recentToolCallsCount: recentCalls.length,
            stuckLoopDetections: this.stuckLoopDetections,
            toolCallFrequency: frequency
        };
    }

    /**
     * Reset circuit breaker state for new task
     * Called when a new task starts to give the agent a fresh context
     */
    private resetCircuitBreaker(): void {
        this.recentToolCalls = [];
        this.lastToolName = null;
        this.lastToolParamsHash = null;
        this.consecutiveSameToolCount = 0;
        this.consecutiveSameParamsCount = 0;
        // Note: Don't reset stuckLoopDetections - keep it for debugging/monitoring
    }

    // Service getters for advanced usage and testing
    
    public getEventHandlerService(): MxfEventHandlerService {
        return this.eventHandlerService;
    }

    public getSystemPromptManager(): MxfSystemPromptManager {
        return this.systemPromptManager;
    }

    public getMemoryManager(): MxfMemoryManager {
        return this.memoryManager;
    }

    public getTaskExecutionManager(): MxfTaskExecutionManager {
        return this.taskExecutionManager;
    }

    public getMcpClientManager(): MxfMcpClientManager {
        return this.mcpClientManager;
    }

    /**
     * Analyze response for completion indicators
     */
    private async analyzeResponseForCompletion(responseText: string): Promise<{
        shouldComplete: boolean;
        confidence: number;
        reason: string;
    }> {
        const lowerResponse = responseText.toLowerCase();
        let confidence = 0;
        const reasons: string[] = [];
        
        // Check for explicit completion phrases
        const completionPhrases = [
            'task is complete',
            'task has been completed',
            'completed the task',
            'finished the task',
            'done with the task',
            'successfully completed',
            'task accomplished',
            'mission accomplished',
            'all done',
            'everything is done',
            'nothing else to do',
            'no further action needed',
            'no more steps required'
        ];
        
        for (const phrase of completionPhrases) {
            if (lowerResponse.includes(phrase)) {
                confidence += 0.3;
                reasons.push(`Contains completion phrase: "${phrase}"`);
                break;
            }
        }
        
        // Check for waiting/idle phrases
        const waitingPhrases = [
            'waiting for',
            'awaiting',
            'let me know',
            'tell me',
            'what would you like',
            'what should i do',
            'need further instructions',
            'require more information',
            'standing by'
        ];
        
        for (const phrase of waitingPhrases) {
            if (lowerResponse.includes(phrase)) {
                confidence += 0.2;
                reasons.push(`Contains waiting phrase: "${phrase}"`);
            }
        }
        
        // Check for repetition patterns
        const responseHash = this.hashResponse(responseText);
        const repetitions = this.completionDetectionState.repeatingResponsePatterns.get(responseHash) || 0;
        this.completionDetectionState.repeatingResponsePatterns.set(responseHash, repetitions + 1);
        
        if (repetitions > 0) {
            confidence += 0.3;
            reasons.push(`Response pattern repeated ${repetitions + 1} times`);
        }
        
        // Check inactivity
        const inactivityTime = Date.now() - this.completionDetectionState.lastSignificantActivity;
        if (inactivityTime > this.completionDetectionState.inactivityThreshold) {
            confidence += 0.2;
            reasons.push(`Inactive for ${Math.round(inactivityTime / 1000)}s`);
        }
        
        // Check if response is very short (might indicate completion)
        if (responseText.length < 100 && this.completionDetectionState.noToolCallIterations > 0) {
            confidence += 0.1;
            reasons.push('Short response with no tool usage');
        }
        
        // Store confidence score for trend analysis
        this.completionDetectionState.confidenceScores.push(confidence);
        if (this.completionDetectionState.confidenceScores.length > 5) {
            this.completionDetectionState.confidenceScores.shift();
        }
        
        // Check if confidence is trending up
        if (this.completionDetectionState.confidenceScores.length >= 3) {
            const trend = this.calculateConfidenceTrend();
            if (trend > 0) {
                confidence += 0.1;
                reasons.push('Confidence trending upward');
            }
        }
        
        // Clean up old patterns (keep only last 10)
        if (this.completionDetectionState.repeatingResponsePatterns.size > 10) {
            const entries = Array.from(this.completionDetectionState.repeatingResponsePatterns.entries());
            entries.sort((a, b) => b[1] - a[1]); // Sort by count
            this.completionDetectionState.repeatingResponsePatterns = new Map(entries.slice(0, 10));
        }
        
        const shouldComplete = confidence >= 0.7;
        const reason = reasons.length > 0 ? reasons.join('; ') : 'No specific indicators';
        
        this.modelLogger.debug(`🔍 Completion analysis: confidence=${confidence.toFixed(2)}, shouldComplete=${shouldComplete}, reason="${reason}"`);
        
        return { shouldComplete, confidence, reason };
    }
    
    /**
     * Hash response for pattern detection
     */
    private hashResponse(text: string): string {
        // Simple hash that captures the essence of the response
        const normalized = text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        
        // Create a simple hash based on length and key phrases
        const keyPhrases = normalized.split(' ').filter(word => word.length > 4).slice(0, 10);
        return `${normalized.length}-${keyPhrases.join('-')}`;
    }
    
    /**
     * Calculate confidence trend
     */
    private calculateConfidenceTrend(): number {
        const scores = this.completionDetectionState.confidenceScores;
        if (scores.length < 2) return 0;
        
        let trend = 0;
        for (let i = 1; i < scores.length; i++) {
            trend += scores[i] - scores[i - 1];
        }
        return trend / (scores.length - 1);
    }
    
    /**
     * Store LLM reasoning data in memory for conversation prompts
     */
    private storeReasoningInMemory(reasoningData: any): void {
        try {
            const reasoning = {
                content: reasoningData.reasoning || reasoningData.content || 'No reasoning content',
                timestamp: Date.now(),
                truncated: (reasoningData.reasoning || reasoningData.content || '').length > 500
            };
            
            // Add to front of array (most recent first)
            this.recentReasoning.unshift(reasoning);
            
            // Keep only recent entries
            if (this.recentReasoning.length > this.MAX_REASONING_ENTRIES) {
                this.recentReasoning = this.recentReasoning.slice(0, this.MAX_REASONING_ENTRIES);
            }
            
            this.modelLogger.debug(`🧠 Stored reasoning in memory: ${reasoning.content.substring(0, 100)}${reasoning.truncated ? '...' : ''}`);
            
        } catch (error) {
            this.modelLogger.error(`Failed to store reasoning in memory: ${error}`);
        }
    }

    /**
     * Check if this agent is marked as reactive in the current task
     */
    private isReactiveAgent(): boolean {
        if (!this.currentTask || !this.currentTask.metadata) {
            return false;
        }
        
        const agentRoles = this.currentTask.metadata.agentRoles || {};
        const agentRole = agentRoles[this.agentId];
        
        return agentRole === 'reactive' || agentRole === 'passive';
    }

    /**
     * Auto-complete task when fallback detection triggers
     */
    private async autoCompleteTask(reason: string): Promise<void> {
        // Check if agent has task_completion capability
        if (!this.config.capabilities?.includes('task_completion')) {
            // Still mark task as complete locally to prevent further iterations
            this.taskCompleted = true;
            
            // Add notification to conversation that task appears complete
            this.memoryManager.addConversationMessage({
                role: 'user',
                content: `SYSTEM: Task appears to be complete. Reason: ${reason}. The system will handle task completion automatically.`
            });
            
            return;
        }
        
        try {
            // Execute task_complete tool
            const result = await this.executeTool('task_complete', {
                result: `Task automatically completed by fallback detection: ${reason}`,
                summary: `The agent completed the task objectives but did not explicitly call task_complete. Reason: ${reason}`
            });

            // Add notification to conversation
            this.memoryManager.addConversationMessage({
                role: 'user',
                content: `SYSTEM: Task was automatically completed. Reason: ${reason}. The task objectives appear to have been met.`
            });
            
        } catch (error) {
            this.modelLogger.error(`Failed to auto-complete task: ${error}`);
            
            // Still mark task as complete locally to prevent further iterations
            this.taskCompleted = true;
            this.taskExecutionManager.cancelCurrentTask('Auto-completion failed but preventing further iterations');
        }
    }

    /**
     * Handle an aggregated message batch from the message aggregator
     */
    private async handleAggregatedMessage(fromAgents: string[], aggregatedContent: string): Promise<void> {
        // CRITICAL: Check if agent has active task AND has not completed it
        const currentTask = this.currentTask;
        const hasActiveTask = this.taskExecutionManager.hasActiveTask();
        
        // Skip aggregated message processing if:
        // 1. No active task, OR
        // 2. Task has been completed
        if (!hasActiveTask || this.taskCompleted) {
            return;
        }
        
        // Add the aggregated message to conversation
        this.memoryManager.addConversationMessage({
            role: 'user',
            content: aggregatedContent,
            metadata: {
                type: 'aggregated_messages',
                fromAgents,
                aggregatedAt: Date.now()
            }
        });

        // Generate response to all aggregated messages with proper task context
        try {
            const availableTools = this.getAvailableToolsForGeneration();
            const contextualTools = this.getContextualTools(
                this.memoryManager.getConversationHistory(),
                availableTools
            );
            
            // If there's an active task, include task context in the response
            let taskPrompt = undefined;
            if (hasActiveTask && currentTask) {
                taskPrompt = `Continue working on your assigned task: ${currentTask.title}. Process the aggregated messages above and continue with your task execution.`;
            }

            await this.generateResponse(undefined, contextualTools, taskPrompt);
        } catch (error) {
            this.modelLogger.error(`Failed to process aggregated messages: ${error}`);
        }
    }

    /**
     * Check if an incoming message should be aggregated instead of processed immediately
     */
    public tryAggregateMessage(fromAgent: string, content: string): boolean {
        if (!this.messageAggregator) {
            return false; // No aggregation enabled
        }
        
        // Add message to aggregator buffer
        this.messageAggregator.addMessage(fromAgent, content);
        return true; // Message was aggregated
    }

    /**
     * Override disconnect to cleanup all services
     */
    public async disconnect(): Promise<void> {
        // Cleanup message aggregator
        if (this.messageAggregator) {
            this.messageAggregator.cleanup();
        }
        
        // Remove task assignment listener
        if (this.taskAssignedHandler) {
            EventBus.client.off(AgentEvents.TASK_ASSIGNED, this.taskAssignedHandler);
            this.taskAssignedHandler = null;
        }
        
        // Cleanup services
        this.eventHandlerService?.cleanup();
        this.taskExecutionManager?.cleanup();
        await this.mcpClientManager?.cleanup();

        // Call parent disconnect
        await super.disconnect();
    }
}
