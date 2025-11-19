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
 * System Prompt Manager for MxfAgent
 * 
 * Manages all system prompt generation, updates, and task-specific guidance
 * for LLM agents. Handles dynamic tool integration and contextual prompting.
 */

import { Logger } from '../../shared/utils/Logger';
import { MxfAgentSystemPrompt, MxfSystemPromptConfig } from '../../shared/prompts/MxfAgentSystemPrompt';
import { MxfAgentSystemPromptV2 } from '../../shared/prompts/MxfAgentSystemPromptV2';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { TaskHelpers } from '../MxfAgentHelpers';
import { v4 as uuidv4 } from 'uuid';
import { ChannelContextProvider, ChannelContext } from '../../shared/prompts/ChannelContextProvider';
import { MemoryPromptInjector, MemoryEntry, MemoryInjectionConfig } from '../../shared/prompts/MemoryPromptInjector';
import { AutoMemoryCreator, AutoMemoryConfig } from '../../shared/services/AutoMemoryCreator';
import { SystemLlmMemoryAnalyzer } from '../../shared/services/SystemLlmMemoryAnalyzer';
import { ChannelConfig } from '../../shared/interfaces/ChannelConfig';
import { MxpConfigManager } from '../../shared/mxp/MxpConfigManager';
import { ContextCompressionEngine } from '../../shared/mxp/ContextCompressionEngine';

export interface PromptManagerCallbacks {
    getConversationHistory: () => ConversationMessage[];
    updateConversationMessage: (index: number, message: ConversationMessage) => void;
    getCachedTools: () => any[];
    getChannelContext?: () => ChannelContext;
    getMemoryEntries?: () => MemoryEntry[];
    saveMemoryEntry?: (entry: MemoryEntry) => Promise<void>;
    getSystemLlmService?: () => any; // SystemLlmService instance for intelligent analysis
}

export class MxfSystemPromptManager {
    private logger: Logger;
    private agentId: string;
    private agentConfig: AgentConfig;
    private callbacks: PromptManagerCallbacks;
    private promptConfig?: MxfSystemPromptConfig;
    private balancedPromptMode = false;
    private channelContextProvider: ChannelContextProvider;
    private memoryPromptInjector: MemoryPromptInjector;
    private autoMemoryCreator?: AutoMemoryCreator;


    constructor(agentId: string, agentConfig: AgentConfig, callbacks: PromptManagerCallbacks) {
        this.agentId = agentId;
        this.agentConfig = agentConfig;
        this.callbacks = callbacks;
        this.logger = new Logger('debug', `PromptManager:${agentId}`, 'client');
        
        // Initialize channel context provider
        this.channelContextProvider = new ChannelContextProvider();
        
        // Initialize memory prompt injector
        this.memoryPromptInjector = new MemoryPromptInjector();
        
        // Initialize auto-memory creator if callbacks support it
        if (callbacks.saveMemoryEntry) {
            const autoMemoryConfig: Partial<AutoMemoryConfig> = {
                enabled: true,
                autoDetectImportance: true,
                autoTagging: true,
                memoryRetentionDays: 30,
                maxMemoriesPerType: 100,
                importanceThresholds: {
                    high: 0.8,
                    medium: 0.5,
                    low: 0.2
                }
            };
            
            // Initialize SystemLLM analyzer if available
            let systemLlmAnalyzer: SystemLlmMemoryAnalyzer | undefined;
            if (callbacks.getSystemLlmService) {
                try {
                    const systemLlmService = callbacks.getSystemLlmService();
                    systemLlmAnalyzer = new SystemLlmMemoryAnalyzer(systemLlmService);
                } catch (error) {
                    this.logger.warn(`Failed to initialize SystemLLM analyzer: ${error}`);
                }
            }
            
            // Use agentId as channelId for now (can be updated when channel context is available)
            this.autoMemoryCreator = new AutoMemoryCreator(
                agentId, 
                agentId, 
                autoMemoryConfig,
                systemLlmAnalyzer
            );
        }
    }

    /**
     * Generate minimal system prompt for initial agent setup
     */
    public generateMinimalPrompt(): string {
        return MxfAgentSystemPrompt.buildMinimalPrompt(this.agentConfig);
    }

    /**
     * Load complete system prompt with dynamic tools
     * Called after agent initialization when tools are available
     */
    public async loadCompleteSystemPrompt(): Promise<void> {
        try {
            
            // Always use the sophisticated tool-aware system
            const availableTools = this.callbacks.getCachedTools();
            
            if (availableTools.length === 0) {
                this.logger.error('❌ No cached tools available - system prompt will have no tool schemas');
            } else {
            }
            
            // Use the new framework-only system prompt (no agent identity)
            let completePrompt = await MxfAgentSystemPrompt.buildFrameworkSystemPrompt(
                this.agentConfig, 
                { 
                    includeToolSchemas: true,
                    includeUsageExamples: false,
                    includeOraprGuidance: true,   
                    includeErrorHandling: false,
                    coreToolsOnly: true
                },
                availableTools
            );
            
            // Add channel context if available
            if (this.callbacks.getChannelContext) {
                const channelContext = this.callbacks.getChannelContext();
                const channelPrompt = ChannelContextProvider.buildChannelContext(null, channelContext);
                if (channelPrompt) {
                    completePrompt = `${completePrompt}\n\n${channelPrompt}`;
                }
            }
            
            // Add memory context if available
            if (this.callbacks.getMemoryEntries) {
                const memories = this.callbacks.getMemoryEntries();
                const memoryPrompt = MemoryPromptInjector.injectMemoryContext(memories, {
                    maxEntries: 10,
                    includeMetadata: true
                });
                if (memoryPrompt) {
                    completePrompt = `${completePrompt}\n\n${memoryPrompt}`;
                }
            }
            
            // Add MXP optimization context if enabled (ONLY when MXP features are active)
            const mxpContext = await this.buildMxpContextPrompt();
            if (mxpContext) {
                completePrompt = `${completePrompt}\n\n${mxpContext}`;
            }
            
            // CRITICAL FIX: Add agent-specific configuration prompt
            if (this.agentConfig.agentConfigPrompt) {
                const agentIdentityPrompt = MxfAgentSystemPrompt.buildAgentIdentityPrompt(this.agentConfig);
                const customPromptSection = this.buildCustomPromptSection(this.agentConfig.agentConfigPrompt);
                completePrompt = `${completePrompt}\n\n${agentIdentityPrompt}\n\n${customPromptSection}`;
            } else {
                // Still include agent identity even without custom config
                const agentIdentityPrompt = MxfAgentSystemPrompt.buildAgentIdentityPrompt(this.agentConfig);
                completePrompt = `${completePrompt}\n\n${agentIdentityPrompt}`;
            }
            
            this.updateSystemMessage(completePrompt);
            
        } catch (error) {
            this.logger.warn(`Could not load complete system prompt: ${error}`);
            // Continue with minimal prompt - not critical for operation
        }
    }

    /**
     * Update system prompt for task context
     */
    public async updatePromptForTask(task: any): Promise<void> {
        try {
            // Only add task guidance if we have a valid task
            if (!task || !task.id) {
                return;
            }
            
            
            // Use framework-only prompt (agent identity is handled separately)
            const basePrompt = await MxfAgentSystemPrompt.buildFrameworkSystemPrompt(
                this.agentConfig,
                { 
                    includeToolSchemas: true,
                    includeUsageExamples: false,
                    includeOraprGuidance: true,   
                    includeErrorHandling: false,
                    coreToolsOnly: true
                },
                this.callbacks.getCachedTools()
            );
            
            // Add agent identity and config prompt
            let enhancedPrompt = basePrompt;
            const agentIdentityPrompt = MxfAgentSystemPrompt.buildAgentIdentityPrompt(this.agentConfig);
            enhancedPrompt = `${enhancedPrompt}\n\n${agentIdentityPrompt}`;
            
            // Add agent-specific configuration prompt if available
            if (this.agentConfig.agentConfigPrompt) {
                const customPromptSection = this.buildCustomPromptSection(this.agentConfig.agentConfigPrompt);
                enhancedPrompt = `${enhancedPrompt}\n\n${customPromptSection}`;
            }
            
            // Only add task guidance if task has actual content
            if (task.title || task.description) {
                const taskGuidance = this.buildTaskSpecificGuidance(task);
                enhancedPrompt = `${enhancedPrompt}\n\n${taskGuidance}`;
            }
            
            this.updateSystemMessage(enhancedPrompt);
            
        } catch (error) {
            this.logger.warn(`Could not update system prompt for task: ${error}`);
        }
    }

    /**
     * Set a new agent config prompt, replacing any existing one
     */
    public setAgentConfigPrompt(agentConfigPrompt: string): void {
        
        // Remove existing system messages from conversation history
        const conversationHistory = this.callbacks.getConversationHistory();
        const filteredHistory = conversationHistory.filter(msg => msg.role !== 'system');
        
        // Add new system message
        const newSystemMessage: ConversationMessage = {
            id: uuidv4(),
            role: 'system',
            content: agentConfigPrompt,
            timestamp: Date.now()
        };
        
        // Update conversation history (this would need to be implemented by the callback)
        // For now, we update the first system message if it exists
        this.updateSystemMessage(agentConfigPrompt);
        
        // Update agent config
        this.agentConfig.agentConfigPrompt = agentConfigPrompt;
    }

    /**
     * Generate task completion guidance text
     */
    private generateTaskCompletionGuidance(): string {
        return `

## IMPORTANT: Task Completion & Tool Execution

**CRITICAL: Tool Execution Sequencing Protocol:**
- **WAIT for tool result confirmation** before calling additional tools
- **Only call ONE tool at a time** unless explicitly required
- **Check tool execution feedback** (✅ success or ❌ error) before proceeding
- **Avoid redundant tool calls** - if a tool succeeded, don't repeat it

**Tool Execution Flow:**
1. Call a single tool with proper parameters
2. **WAIT** for system response: "✅ tool_name completed successfully" or error
3. Analyze the result and determine next action
4. Only then call additional tools if needed

**CONSISTENCY REQUIREMENTS:**
- **Be consistent in decision-making** - don't hesitate or change approach mid-task
- **Look for clear completion criteria** before calling task_complete
- **Make decisive action choices** - avoid redundant discovery calls after finding agents
- **Don't loop on the same actions** - if messaging_discover found agents, proceed to messaging_send
- **Complete tasks promptly** when criteria are met - don't delay or second-guess

**Task Completion Decision Logic:**
When you have finished your assigned task:
1. **Check completion criteria**: Has the main objective been achieved?
   - For messaging tasks: Has the greeting been sent AND reply received?
   - For discovery tasks: Have the required agents been found?
   - For coordination tasks: Has the coordination been established?

2. **If criteria are met, call task_complete IMMEDIATELY**:
   - Don't call additional discovery tools after successful completion
   - Don't hesitate or seek more information unnecessarily
   - Call task_complete with a clear, concise summary

3. **Be decisive**: When your role in the task is finished, signal completion promptly

Example task completion:
\`\`\`json
{
  "name": "task_complete", 
  "arguments": {
    "summary": "Successfully completed collaborative messaging task. Greeting sent and reply received.",
    "success": true
  }
}
\`\`\`

**AVOID THESE COMMON MISTAKES:**
- ❌ Calling messaging_discover repeatedly after finding agents
- ❌ Hesitating to call task_complete when objectives are clearly met
- ❌ Getting stuck in analysis loops instead of taking decisive action`;
    }

    /**
     * Build task-specific guidance if a task is active
     */
    private buildTaskSpecificGuidance(task: any): string {
        // Task-specific guidance is now handled in the task prompt
        // Return empty to avoid duplication in system prompt
        return '';
    }

    /**
     * Update the system message in conversation history
     */
    private updateSystemMessage(content: string): void {
        const conversationHistory = this.callbacks.getConversationHistory();
        const systemMessageIndex = conversationHistory.findIndex(msg => msg.role === 'system');
        
        if (systemMessageIndex >= 0) {
            // Update existing system message
            const updatedMessage: ConversationMessage = {
                id: uuidv4(),
                role: 'system',
                content: content,
                timestamp: Date.now()
            };
            
            this.callbacks.updateConversationMessage(systemMessageIndex, updatedMessage);
        } else {
            this.logger.warn('No system message found in conversation history to update');
        }
    }

    /**
     * Enable or disable balanced prompt mode
     */
    public setBalancedPromptMode(enabled: boolean): void {
        this.balancedPromptMode = enabled;
    }

    /**
     * Check if balanced prompt mode is enabled
     */
    public isBalancedPromptMode(): boolean {
        return this.balancedPromptMode;
    }

    /**
     * Update the prompt configuration
     */
    public updatePromptConfig(config: Partial<MxfSystemPromptConfig>): void {
        this.promptConfig = {
            ...this.promptConfig,
            ...config
        };
        
    }

    /**
     * Get current prompt configuration
     */
    public getPromptConfig(): MxfSystemPromptConfig | undefined {
        return this.promptConfig;
    }

    /**
     * Generate contextual prompt based on conversation state
     */
    public generateContextualPrompt(conversationHistory: ConversationMessage[], context?: any): string {
        try {
            // Analyze conversation for context clues
            const conversationText = conversationHistory
                .map(msg => msg.content || '')
                .join(' ')
                .toLowerCase();
            
            let contextualGuidance = '';
            
            // Add context-specific guidance based on conversation content
            if (conversationText.includes('error') || conversationText.includes('failed')) {
                contextualGuidance += '\n\n**Error Recovery Mode**: Focus on error handling and alternative approaches.';
            }
            
            if (conversationText.includes('complete') || conversationText.includes('finished')) {
                contextualGuidance += '\n\n**Completion Mode**: Verify task completion and provide final summaries.';
            }
            
            if (conversationText.includes('collaborate') || conversationText.includes('team')) {
                contextualGuidance += '\n\n**Collaboration Mode**: Focus on team coordination and communication tools.';
            }
            
            // Process messages for auto-memory creation if enabled
            if (this.autoMemoryCreator && context?.processForMemory) {
                const lastMessage = conversationHistory[conversationHistory.length - 1];
                if (lastMessage && lastMessage.content) {
                    this.autoMemoryCreator.processMessage(lastMessage.content, {
                        role: lastMessage.role,
                        timestamp: lastMessage.timestamp,
                        ...context
                    });
                }
            }
            
            // Extract task-relevant memories if available
            if (this.callbacks.getMemoryEntries && context?.taskContext) {
                const memories = this.callbacks.getMemoryEntries();
                const relevantMemories = MemoryPromptInjector.extractTaskRelevantMemories(
                    memories,
                    context.taskContext,
                    5
                );
                
                if (relevantMemories.length > 0) {
                    const memoryPrompt = MemoryPromptInjector.injectMemoryContext(relevantMemories, {
                        maxEntries: 5,
                        includeMetadata: false,
                        summarize: true
                    });
                    contextualGuidance += `\n\n${memoryPrompt}`;
                }
            }
            
            return contextualGuidance;
        } catch (error) {
            this.logger.warn(`Error generating contextual prompt: ${error}`);
            return '';
        }
    }

    /**
     * Validate prompt length and complexity
     */
    public validatePrompt(prompt: string): { valid: boolean; warnings: string[] } {
        const warnings: string[] = [];
        
        // Check prompt length
        if (prompt.length > 50000) {
            warnings.push('Prompt is very long (>50k chars) - may impact performance');
        }
        
        // Check for excessive repetition
        const words = prompt.split(/\s+/);
        const wordCount = words.length;
        const uniqueWords = new Set(words).size;
        const repetitionRatio = uniqueWords / wordCount;
        
        if (repetitionRatio < 0.3) {
            warnings.push('High repetition detected in prompt - may confuse LLM');
        }
        
        // Check for balanced structure
        const toolSchemaMatches = prompt.match(/\"name\":\s*\"/g);
        const toolCount = toolSchemaMatches ? toolSchemaMatches.length : 0;
        
        if (toolCount > 100) {
            warnings.push(`Very high tool count (${toolCount}) - consider tool filtering`);
        }
        
        return {
            valid: warnings.length === 0,
            warnings
        };
    }
    
    /**
     * Update channel context dynamically
     */
    public updateChannelContext(channelContext: ChannelContext): void {
        if (!channelContext) return;
        
        // If auto-memory creator exists, update its channel ID
        if (this.autoMemoryCreator && channelContext.channelId) {
            // Re-initialize with correct channel ID
            const config: Partial<AutoMemoryConfig> = {
                enabled: true,
                autoDetectImportance: true,
                autoTagging: true,
                memoryRetentionDays: 30,
                maxMemoriesPerType: 100,
                importanceThresholds: {
                    high: 0.8,
                    medium: 0.5,
                    low: 0.2
                }
            };
            this.autoMemoryCreator = new AutoMemoryCreator(
                channelContext.channelId,
                this.agentId,
                config
            );
        }
        
    }
    
    /**
     * Create a manual memory entry
     */
    public async createMemory(
        content: string,
        type: MemoryEntry['type'] = 'note',
        importance: 'high' | 'medium' | 'low' = 'medium',
        tags?: string[]
    ): Promise<void> {
        if (!this.autoMemoryCreator) {
            this.logger.warn('Auto-memory creator not initialized');
            return;
        }
        
        const memory = this.autoMemoryCreator.createManualMemory(
            content,
            type,
            importance,
            tags
        );
        
        // Save memory if callback is available
        if (this.callbacks.saveMemoryEntry) {
            await this.callbacks.saveMemoryEntry(memory);
        }
    }
    
    /**
     * Build collaborative context for multi-agent scenarios
     */
    public buildCollaborativeContext(otherAgents: string[]): string {
        if (!this.callbacks.getChannelContext) {
            return '';
        }
        
        const channelContext = this.callbacks.getChannelContext();
        return ChannelContextProvider.buildCollaborativeContext(
            this.agentId,
            otherAgents,
            channelContext
        );
    }
    
    /**
     * Process message for auto-memory creation
     */
    public async processMessageForMemory(
        message: ConversationMessage,
        context?: Record<string, any>
    ): Promise<void> {
        if (!this.autoMemoryCreator) {
            return;
        }
        
        const memory = await this.autoMemoryCreator.processMessage(
            message.content || '',
            {
                role: message.role,
                timestamp: message.timestamp,
                messageId: message.id,
                ...context
            }
        );
        
        // Save memory if created and callback is available
        if (memory && this.callbacks.saveMemoryEntry) {
            await this.callbacks.saveMemoryEntry(memory);
        }
    }
    
    /**
     * Clean up old memories based on retention policy
     */
    public async cleanupMemories(): Promise<void> {
        if (!this.autoMemoryCreator || !this.callbacks.getMemoryEntries) {
            return;
        }
        
        const memories = this.callbacks.getMemoryEntries();
        const cleanedMemories = await this.autoMemoryCreator.cleanupOldMemories(memories);
        
    }
    
    /**
     * Build custom prompt section for agent-specific configuration
     */
    private buildCustomPromptSection(customPrompt: string): string {
        // Check if we have any allowed tools to mention tool discovery
        const cachedTools = this.callbacks.getCachedTools();
        const hasToolsRecommend = cachedTools.some(tool => tool.name === 'tools_recommend');
        const toolDiscoveryNote = hasToolsRecommend 
            ? `*Remember: Use your core MXF tools and the tools_recommend capability to discover additional tools as needed for your specific role and tasks.*`
            : `*Remember: Use your core MXF tools for your specific role and tasks.*`;

        return `## Your Specific Role and Capabilities

${customPrompt}

---

${toolDiscoveryNote}`;
    }

    /**
     * Build MXP optimization context prompt - ONLY when MXP features are enabled
     * This keeps the prompt system clean when MXP is disabled
     */
    private async buildMxpContextPrompt(): Promise<string | null> {
        try {
            // Get channel context to determine scope
            const channelContext = this.callbacks.getChannelContext?.();
            const channelId = channelContext?.channelId || 'default';
            
            // Check if ANY MXP features are enabled for this agent/channel
            const tokenOptEnabled = MxpConfigManager.getInstance().isFeatureEnabled(channelId, 'tokenOptimization', this.agentId);
            const bandwidthOptEnabled = MxpConfigManager.getInstance().isFeatureEnabled(channelId, 'bandwidthOptimization', this.agentId);
            
            // If no MXP features are enabled, return null (no prompt bloat)
            if (!tokenOptEnabled && !bandwidthOptEnabled) {
                return null;
            }


            let mxpPromptSections: string[] = [];

            // Add token optimization guidance if enabled
            if (tokenOptEnabled) {
                const tokenStrategies = this.getEnabledTokenStrategies(channelId);
                if (tokenStrategies.length > 0) {
                    mxpPromptSections.push(`## Token Optimization Active

The MXF system is using intelligent token optimization to reduce costs and improve performance. Active strategies:
${tokenStrategies.map(s => `- ${s}`).join('\n')}

*Note: Your responses may be processed through context compression and prompt optimization. This is transparent to you - continue operating normally.*`);
                }
            }

            // Add bandwidth optimization guidance if enabled
            if (bandwidthOptEnabled) {
                mxpPromptSections.push(`## Bandwidth Optimization Active

Message compression and batching are enabled to optimize network performance. This may slightly delay message delivery but improves overall system efficiency.`);
            }

            // Only return prompt if we have actual content
            if (mxpPromptSections.length === 0) {
                return null;
            }

            return `# Model Exchange Protocol (MXP) - System Optimization

${mxpPromptSections.join('\n\n')}

---
*MXP optimizations are designed to be transparent to your operation. Continue working normally - the system will handle optimization automatically.*`;

        } catch (error) {
            this.logger.warn('Failed to build MXP context prompt', { error: error instanceof Error ? error.message : String(error) });
            return null; // Fail gracefully - don't break prompt generation
        }
    }

    /**
     * Get enabled token optimization strategies for display in prompt
     */
    private getEnabledTokenStrategies(channelId: string): string[] {
        const strategies: string[] = [];
        
        const strategyMap = {
            contextCompression: 'Context Compression (sliding window)',
            promptOptimization: 'System Prompt Optimization', 
            templateMatching: 'Message Template Matching',
            entityDeduplication: 'Semantic Deduplication',
            toolSchemaReduction: 'Tool Schema Optimization',
            conversationSummarization: 'Conversation Summarization'
        };

        for (const [key, label] of Object.entries(strategyMap)) {
            if (MxpConfigManager.getInstance().isTokenStrategyEnabled(channelId, key as any, this.agentId)) {
                strategies.push(label);
            }
        }

        return strategies;
    }
}