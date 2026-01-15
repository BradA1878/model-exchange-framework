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
 * MXF Agent System Prompt Builder
 * 
 * Provides standardized system prompts for MXF agents that include:
 * - Framework identity and operational context
 * - Core tool documentation with complete JSON schemas
 * - Usage patterns and examples
 * - Meta-tool guidance for discovery
 * - ORPAR integration guidelines
 * - Custom agent prompt integration
 */

import { AgentConfig } from '../interfaces/AgentInterfaces';
import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { 
    COMMUNICATION_TOOLS, 
    CONTROL_LOOP_TOOLS, 
    CONTEXT_MEMORY_TOOLS, 
    META_TOOLS 
} from '../constants/ToolNames';
import { CORE_MXF_TOOLS } from '../constants/CoreTools';
import { PROMPT_TEMPLATES } from '../utils/PromptTemplateReplacer';

const logger = new Logger('info', 'MxfAgentSystemPrompt', 'client');
const validator = createStrictValidator('MxfAgentSystemPrompt');

export interface MxfSystemPromptConfig {
    includeToolSchemas?: boolean;
    includeUsageExamples?: boolean;
    includeOrparGuidance?: boolean;
    includeErrorHandling?: boolean;
    coreToolsOnly?: boolean;
    customSections?: string[];
}

export class MxfAgentSystemPrompt {
    private static readonly DEFAULT_CONFIG: MxfSystemPromptConfig = {
        includeToolSchemas: true,
        includeUsageExamples: true,
        includeOrparGuidance: true,
        includeErrorHandling: true,
        coreToolsOnly: true,
        customSections: []
    };

    /**
     * Build framework-only system prompt (NO agent identity/custom content)
     * This is for the SYSTEM role message only
     * Respects agent's allowedTools for tool-aware prompts
     */
    public static async buildFrameworkSystemPrompt(
        agentConfig: AgentConfig,
        promptConfig: MxfSystemPromptConfig = {},
        availableTools?: any[]
    ): Promise<string> {
        const config = { ...this.DEFAULT_CONFIG, ...promptConfig };
        
        // Extract tool names - respecting allowedTools for tool-aware prompts
        // CRITICAL: Prioritize agentConfig.allowedTools over availableTools to ensure proper filtering
        let toolNames: string[];
        if (agentConfig.allowedTools && agentConfig.allowedTools.length > 0) {
            // Agent has specific allowed tools - use only those
            toolNames = agentConfig.allowedTools;
        } else if (availableTools && availableTools.length > 0) {
            // No allowedTools specified - use all available tool names
            toolNames = availableTools.map(tool => tool.name);
        } else {
            // No tools specified - fallback to core tools
            toolNames = [...CORE_MXF_TOOLS];
        }
        
        // Build framework sections ONLY (no agent identity or custom prompts)
        const sections = [
            this.buildSystemEnvironmentContext(), // CRITICAL: Must be first - NO HUMANS context
            this.buildMxfIdentity(agentConfig, toolNames), // Framework identity (not agent identity)
            this.buildMandatoryToolFormat(agentConfig.mxpEnabled), // MXP only if enabled
            this.buildResponsePerformanceGuide(),
            this.buildCoreCapabilities(toolNames), // Tool-aware based on allowedTools
            await this.buildToolSchemas(config, availableTools, toolNames, agentConfig),
            this.buildToolUsagePatterns(agentConfig, toolNames),
            this.buildMetaToolGuidance(toolNames, agentConfig.mxpEnabled),
            this.buildOrparGuidelines(config, toolNames),
            this.buildCollaborationPatterns(toolNames, agentConfig),
            this.buildErrorHandling(config, toolNames, agentConfig.mxpEnabled),
            this.buildContextAwarenessNotice(),
            this.buildSystemMessageGuidance()
            // EXPLICITLY EXCLUDING: buildAgentContext and buildCustomPrompt
        ].filter(Boolean);

        const completePrompt = sections.join('\n\n');
        return completePrompt;
    }


    /**
     * System Environment Context - CRITICAL: Must be first
     * Establishes NO HUMANS, autonomous environment context
     */
    private static buildSystemEnvironmentContext(): string {
        return `# MXF Agent Operating Environment

**CRITICAL CONTEXT**: You are an autonomous system agent operating within a closed framework.

- **NO HUMAN USERS**: You are NOT interacting with humans
- **SYSTEM-ONLY**: All interactions are with other AI agents or system components  
- **TOOL-BASED**: Communication happens ONLY through tool calls
- **AUTONOMOUS**: Execute decisions without seeking approval
- **WORKER MODE**: You are an employee executing tasks, not a chatbot serving customers

You operate within the Model Exchange Framework (MXF), a sophisticated multi-agent communication system.

## Autonomous Operation

Execute immediately when you have sufficient information. Take decisive action based on available data. If you need information, request it directly from the specific agent. When a task is complete, signal completion. Never wait for approval - there are no users in this system, only autonomous agents.`;
    }

    /**
     * Response Performance & Transparency Guide
     * Explains performance implications of different response formats
     */
    private static buildResponsePerformanceGuide(): string {
        return `## Response Processing & Performance

### 🚀 FASTEST (~10ms): Direct Tool Calls
\`\`\`json
{
  "name": "messaging_send",
  "arguments": {
    "targetAgentId": "target-agent",
    "message": "Message content"
  }
}
\`\`\`
Direct JSON tool calls execute immediately with minimal latency.

### 🐢 SLOWER (~200-500ms): Natural Language
"Tell the scheduler that Wednesday works"

Natural language responses require SystemLLM interpretation:
- SystemLLM must parse your intent
- Map common names to agent IDs
- Convert to appropriate tool calls
- This adds 200-500ms latency

### ⚠️ UNRELIABLE: Ambiguous Statements
"I think that might work" / "Let me check on that"
- May be discarded or misinterpreted
- Only use for internal reasoning if think tool is available

**ALWAYS PREFER DIRECT TOOL CALLS FOR SPEED AND RELIABILITY**`;
    }

    /**
     * MXF Framework Identity Section
     */
    private static buildMxfIdentity(agentConfig: AgentConfig, availableTools?: string[]): string {
        // Determine available capabilities based on tools
        const toolSet = availableTools || [];
        const hasControlLoop = toolSet.some(tool => tool.startsWith('controlLoop_'));
        const hasCommunication = toolSet.some(tool => tool.startsWith('messaging_') || tool.startsWith('agent_'));
        const hasMemoryContext = toolSet.some(tool => tool.includes('context_') || tool.includes('memory_'));
        
        // Build dynamic system description
        let systemType = "sophisticated multi-agent";
        if (hasCommunication && hasMemoryContext) {
            systemType += " coordination and communication system";
        } else if (hasCommunication) {
            systemType += " communication system";
        } else {
            systemType += " coordination system";
        }
        
        // Build base identity content
        let content = `You are an intelligent agent operating within the Model Exchange Framework (MXF), a ${systemType}.

MXF enables you to collaborate with other AI agents`;
        
        // Only mention ORPAR if control loop tools are available
        if (hasControlLoop) {
            content += `, execute complex workflows through ORPAR cognitive cycles,`;
        }
        
` and intelligently coordinate tasks. You work alongside a SystemLLM service that provides intelligent coordination analysis, task assignment, and multi-agent orchestration capabilities.

## Response Performance

### ✅ FASTEST EXECUTION (~10ms)
**Direct JSON Tool Calls** - Use whenever possible:
\`\`\`json
{
  "name": "tool_name",
  "arguments": {
    "param": "value"
  }
}
\`\`\`

### ⚠️ SLOWER EXECUTION (~200-500ms)
**Natural Language Responses** - Require SystemLLM interpretation:
- "Tell the AI Scheduler that Wednesday works for me"
- "I need to update the task status"
- "Let me check the context memory"

### ❌ AVOID - POTENTIAL MISINTERPRETATION
**Ambiguous Statements** - May not be interpreted correctly:
- "I think that might work"
- "Let me check on that"
- "I'll get back to you"

**Decision Guide:**
- Have a specific target agent? → Use tool with agentId
- Have a specific action? → Use appropriate tool directly
- Need to respond? → Use respond/messaging tools
- Uncertain? → Be explicit with tools rather than natural language

## SystemLLM Partnership

The SystemLLM works alongside you to:
- Analyze agent capabilities and workload for intelligent task assignment
- Provide coordination insights and strategic analysis 
- Support task orchestration and multi-agent workflows
- Offer reasoning analysis when you need guidance on complex situations`;

        // Conditionally add MXP protocol section only if mxpEnabled is true
        if (agentConfig.mxpEnabled === true) {
            content += `

## MXP Protocol (Model Exchange Protocol)

MXF supports MXP, an efficient binary protocol that reduces message size by 80%+ and **LLM token usage by 60-70%** in collaborative workflows. When MXP is enabled:

- **Automatic Optimization**: Your messages are automatically optimized for token efficiency
- **Context Compression**: Previous conversations are compressed to reduce repeated context
- **Structured Communication**: Clear patterns are converted to efficient formats
- **Encrypted Security**: All optimized messages use AES-256-GCM encryption

**Token Optimization Patterns** (use these for maximum efficiency):
- **Collaboration**: "Let's work together on [task]" → Optimized collaboration format
- **Task Delegation**: "I need you to [specific task]" → Efficient task assignment
- **Context Reference**: "Based on our previous discussion about [topic]" → State reference
- **Tool Execution**: "Use the [tool] to [action]" → Structured tool format

**Communication Best Practices**:
- Start collaboration with clear proposals: "I propose we collaborate on..."
- Reference previous context: "Based on our discussion about..."
- Be specific in task delegation: "Please delegate this task..."
- Use structured language for tool requests

**Example MXP Protocol Usage**:

❌ **Natural Language** (high token usage):
"I need to use the file writing tool to create a new TypeScript file at src/auth/validation.ts with functions for email validation and password strength checking. This will help us complete the authentication module we discussed earlier."

✅ **MXP Protocol Format** (efficient structured format):
\`\`\`json
{
  "op": "tool.execute",
  "args": [{
    "tool": "file_writer", 
    "params": {
      "path": "src/auth/validation.ts",
      "content": "export const validateEmail = ...",
      "overwrite": false
    }
  }],
  "context": "auth_module_task",
  "metadata": {
    "priority": 7,
    "correlationId": "auth-task-001"
  }
}
\`\`\`

**Other Common MXP Operations**: \`collab.propose\`, \`task.delegate\`, \`state.reference\`, \`coord.sync\`

Use MXP protocol format when possible for **significant token efficiency** while maintaining precision.`;
        }

        return content;
    }

    /**
     * Mandatory tool usage instructions - NO JSON FORMAT (native tool calling)
     */
    private static buildMandatoryToolFormat(mxpEnabled?: boolean): string {
        return `## Tool Usage Reference

Use tools to take actions - the system will automatically execute your tool requests and you will receive results back. When you need to perform an action, use the appropriate tool directly.`;
    }

    /**
     * Core Capabilities Overview
     */
    private static buildCoreCapabilities(availableTools?: string[]): string {
        const toolSet = availableTools || [];
        const sections: string[] = [];
        
        sections.push('## Your Core Capabilities\n\nYou have immediate access to these essential MXF tools:');
        
        // Communication & Discovery - only if communication tools are available
        const hasCommunication = toolSet.some(tool => tool.startsWith('messaging_') || tool.startsWith('agent_'));
        if (hasCommunication) {
            const commCapabilities: string[] = [];
            if (toolSet.includes('messaging_send')) commCapabilities.push(`- **${COMMUNICATION_TOOLS.SEND_MESSAGE}**: Send direct messages to specific agents`);
            if (toolSet.includes('messaging_broadcast')) commCapabilities.push(`- **${COMMUNICATION_TOOLS.BROADCAST}**: Send messages to multiple agents or channels`);
            if (toolSet.includes('agent_discover')) commCapabilities.push(`- **${COMMUNICATION_TOOLS.DISCOVER_AGENTS}**: Discover other agents in your channel and their capabilities`);
            if (toolSet.includes('agent_coordinate')) commCapabilities.push(`- **${COMMUNICATION_TOOLS.COORDINATE}**: Request coordination with other agents for collaborative tasks`);
            
            if (commCapabilities.length > 0) {
                sections.push(`**Communication & Discovery:**\n${commCapabilities.join('\n')}`);
            }
        }
        
        // Control Loop - only if control loop tools are available
        const hasControlLoop = toolSet.some(tool => tool.startsWith('controlLoop_'));
        if (hasControlLoop) {
            const controlCapabilities: string[] = [];
            if (toolSet.includes('controlLoop_start')) controlCapabilities.push(`- **${CONTROL_LOOP_TOOLS.START}**: Start new ORPAR cognitive cycles`);
            if (toolSet.includes('controlLoop_observe')) controlCapabilities.push(`- **${CONTROL_LOOP_TOOLS.OBSERVE}**: Submit observations to active control loops`);
            if (toolSet.includes('controlLoop_execute')) controlCapabilities.push(`- **${CONTROL_LOOP_TOOLS.EXECUTE}**: Execute planned actions within control loops`);
            
            if (controlCapabilities.length > 0) {
                sections.push(`**Control Loop (ORPAR Integration):**\n${controlCapabilities.join('\n')}`);
            }
        }
        
        // Memory & Context - only if memory/context tools are available
        const hasMemoryContext = toolSet.some(tool => tool.includes('context_') || tool.includes('memory_'));
        if (hasMemoryContext) {
            const memoryCapabilities: string[] = [];
            if (toolSet.includes('agent_memory_read')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.AGENT_MEMORY_READ}**: Access your agent-specific memory`);
            if (toolSet.includes('agent_memory_write')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.AGENT_MEMORY_WRITE}**: Store information in your agent-specific memory`);
            if (toolSet.includes('agent_context_read')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.AGENT_CONTEXT_READ}**: Access your agent-specific context and configuration`);
            if (toolSet.includes('channel_memory_read')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.CHANNEL_MEMORY_READ}**: Access channel-specific memory`);
            if (toolSet.includes('channel_memory_write')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.CHANNEL_MEMORY_WRITE}**: Store information in channel-specific memory`);
            if (toolSet.includes('channel_context_read')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.CHANNEL_CONTEXT_READ}**: Read channel context and information`);
            if (toolSet.includes('channel_messages_read')) memoryCapabilities.push(`- **${CONTEXT_MEMORY_TOOLS.CHANNEL_MESSAGES_READ}**: Read channel message history`);
            
            if (memoryCapabilities.length > 0) {
                sections.push(`**Memory & Context:**\n${memoryCapabilities.join('\n')}`);
            }
        }
        
        // Meta-Tools - always show tools_recommend and task_complete if available
        const metaCapabilities: string[] = [];
        if (toolSet.includes('tools_recommend')) metaCapabilities.push(`- **${META_TOOLS.TOOLS_RECOMMEND}**: **USE THIS to discover additional tools based on your intent**`);
        if (toolSet.includes('task_complete')) metaCapabilities.push(`- **${META_TOOLS.TASK_COMPLETE}**: **REQUIRED to signal when assigned tasks are completed**`);
        
        if (metaCapabilities.length > 0) {
            sections.push(`**Meta-Tools:**\n${metaCapabilities.join('\n')}`);
        }
        
        return sections.join('\n\n');
    }

    /**
     * Detailed Tool Schemas with JSON Examples
     * Now respects allowedTools to only show documentation for tools the agent can actually use
     */
    private static async buildToolSchemas(config: MxfSystemPromptConfig, availableTools?: any[], toolNames?: string[], agentConfig?: AgentConfig): Promise<string> {
        if (!config.includeToolSchemas) return '';

        // Use provided tools from the actual tool registry
        let tools: any[] = availableTools || [];
        if (tools.length === 0) {
            // Core tools fallback - create mock tool objects for allowed tools (or all core tools if no allowedTools)
            const toolsToMock = (toolNames && toolNames.length > 0) ? toolNames : CORE_MXF_TOOLS;
            tools = toolsToMock.map(toolName => ({
                name: toolName,
                description: `${toolName} - Core MXF ${toolName.includes('memory') ? 'Memory Management' : toolName.includes('messaging') ? 'Communication' : toolName.includes('controlLoop') ? 'ORPAR Control Loop' : toolName.includes('task') ? 'Task Management' : 'Meta'} tool`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        ...(toolName.includes('messaging') && {
                            targetAgentId: { type: 'string' },
                            message: { type: 'string' }
                        }),
                        ...(toolName.includes('memory') && {
                            key: { type: 'string' },
                            value: { type: 'string' }
                        }),
                        ...(toolName.includes('controlLoop') && {
                            observation: { type: 'string' },
                            confidence: { type: 'number' }
                        }),
                        ...(toolName === 'task_complete' && {
                            summary: { type: 'string', required: true },
                            success: { type: 'boolean', default: true },
                            details: { type: 'object', optional: true },
                            nextSteps: { type: 'string', optional: true }
                        })
                    }
                }
            }));
        }

        // Deduplicate tools by name (keep first occurrence)
        // This handles the case where same tool exists with different providerId/channelId
        const uniqueToolsMap = new Map<string, any>();
        for (const tool of tools) {
            if (!uniqueToolsMap.has(tool.name)) {
                uniqueToolsMap.set(tool.name, tool);
            }
        }
        const uniqueTools = Array.from(uniqueToolsMap.values());

        // Filter to only show allowed tools in system prompt
        // CRITICAL: If toolNames are specified (from allowedTools), ONLY include those exact tools
        const mxfCoreTools = uniqueTools.filter(tool => {
            // If we have specific toolNames from allowedTools, strictly filter to only those
            if (toolNames && toolNames.length > 0) {
                return toolNames.includes(tool.name);
            }
            
            // Otherwise include only core MXF tools - CORE_MXF_TOOLS is the source of truth
            return CORE_MXF_TOOLS.includes(tool.name);
        });
        
        // CRITICAL: Filter by allowedTools to only show documentation for tools the agent can actually use
        // No need for additional filtering - mxfCoreTools already filtered by toolNames above
        const finalToolsForDocumentation = mxfCoreTools;
        
        if (finalToolsForDocumentation.length === 0) {
            logger.error('❌ SYSTEM PROMPT: No allowed tools found for this agent - this indicates a configuration issue');
            return '## Tool Usage Reference\n\n❌ **ERROR: No allowed tools found**\n\nThis agent has no tools configured in its allowedTools list.';
        }

        // Build tool schemas dynamically from MXF core tools only
        const toolSections = [];
        
        // Group allowed tools by category (only show documentation for tools this agent can actually use)
        const communicationTools = finalToolsForDocumentation.filter(t => t.name.startsWith('messaging_'));
        const controlLoopTools = finalToolsForDocumentation.filter(t => t.name.startsWith('controlLoop_'));
        const infrastructureTools = finalToolsForDocumentation.filter(t => 
            t.name === 'filesystem_read' || t.name === 'filesystem_write' || 
            t.name === 'filesystem_list' || t.name === 'shell_execute' ||
            t.name === 'memory_store' || t.name === 'memory_retrieve'
        );
        const contextMemoryTools = finalToolsForDocumentation.filter(t => 
            t.name.startsWith('channel_') || t.name.startsWith('agent_') || t.name.startsWith('context_')
        );
        const planningTools = finalToolsForDocumentation.filter(t => t.name.startsWith('planning_'));
        const validationTools = finalToolsForDocumentation.filter(t => 
            t.name === 'no_further_action' || t.name === 'validate_next_action'
        );
        const metaTools = finalToolsForDocumentation.filter(t => ['task_complete', 'tools_recommend'].includes(t.name));
        
        // Communication Tools Section
        if (communicationTools.length > 0) {
            toolSections.push('### Communication Tools\n');
            for (const tool of communicationTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Control Loop Tools Section
        if (controlLoopTools.length > 0) {
            toolSections.push('### Control Loop Tools\n');
            for (const tool of controlLoopTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Infrastructure Tools Section
        if (infrastructureTools.length > 0) {
            toolSections.push('### Infrastructure Tools\n');
            for (const tool of infrastructureTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Context & Memory Tools Section
        if (contextMemoryTools.length > 0) {
            toolSections.push('### Context & Memory Tools\n');
            for (const tool of contextMemoryTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Planning Tools Section
        if (planningTools.length > 0) {
            toolSections.push('### Planning Tools\n');
            for (const tool of planningTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Validation Tools Section
        if (validationTools.length > 0) {
            toolSections.push('### Validation Tools\n');
            for (const tool of validationTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        // Meta Tools Section  
        if (metaTools.length > 0) {
            toolSections.push('### Meta Tools\n');
            for (const tool of metaTools) {
                toolSections.push(this.buildToolExample(tool, agentConfig?.mxpEnabled));
            }
        }

        return `## Tool Usage Reference

${toolSections.join('\n')}`;
    }

    private static buildToolExample(tool: any, mxpEnabled?: boolean): string {
        // Native tool calling format - describe the tool without JSON examples
        const params = tool.inputSchema?.properties || {};
        const required = tool.inputSchema?.required || [];
        
        const paramsList: string[] = [];
        for (const [key, value] of Object.entries(params)) {
            const param = value as any;
            const isRequired = required.includes(key);
            const requiredMarker = isRequired ? '(required)' : '(optional)';
            paramsList.push(`  - ${key} ${requiredMarker}: ${param.description || 'No description'}`);
        }
        
        const paramsSection = paramsList.length > 0 
            ? `\nParameters:\n${paramsList.join('\n')}`
            : '';
        
        return `**${tool.name}** - ${tool.description}${paramsSection}\n`;
    }

    /**
     * Map tool name to MXP operation for compact display
     */
    private static mapToolToMxpOperation(toolName: string): string {
        if (toolName.startsWith('messaging_')) return 'comm.send';
        if (toolName.startsWith('controlLoop_')) return 'ctrl.loop';
        if (toolName.includes('memory_')) return 'data.store';
        if (toolName.includes('context_')) return 'data.query';
        if (toolName === 'tools_recommend') return 'meta.discover';
        if (toolName === 'task_complete') return 'task.complete';
        return 'tool.execute';
    }

    /**
     * Get compact argument list for MXP display
     */
    private static getMxpArgumentsList(tool: any): string {
        if (!tool.inputSchema?.properties) return '{...}';
        
        const props = Object.keys(tool.inputSchema.properties);
        if (props.length === 0) return '{...}';
        if (props.length <= 2) return `{${props.join(', ')}}`;
        return `{${props.slice(0, 2).join(', ')}, ...}`;
    }

    private static generateExampleArguments(tool: any): string {
        if (!tool.inputSchema || !tool.inputSchema.properties) {
            return '// Add arguments as needed';
        }

        const props = tool.inputSchema.properties;
        const required = tool.inputSchema.required || [];
        const examples: string[] = [];

        Object.keys(props).forEach(key => {
            const prop = props[key];
            let exampleValue: any;

            // Generate example values based on property type
            if (prop.type === 'string') {
                if (key.includes('Id') || key === 'targetAgentId') {
                    exampleValue = '"target-agent-id"';
                } else if (key === 'message') {
                    exampleValue = '"Your message content here"';
                } else {
                    exampleValue = `"example_${key}"`;
                }
            } else if (prop.type === 'number' || prop.type === 'integer') {
                exampleValue = key === 'priority' ? '7' : '1';
            } else if (prop.type === 'boolean') {
                exampleValue = prop.default !== undefined ? prop.default : true;
            } else if (prop.type === 'object') {
                // Special handling for task_complete details
                if (tool.name === 'task_complete' && key === 'details') {
                    exampleValue = `{
      "problem": "description of what was solved",
      "solution": "how it was resolved"
    }`;
                } else {
                    exampleValue = '{}';
                }
            } else if (prop.type === 'array') {
                exampleValue = '[]';
            } else {
                exampleValue = '"example_value"';
            }

            let comment = required.includes(key) ? ' // Required' : ' // Optional';
            
            // Add explicit type annotations for task_complete to prevent confusion
            if (tool.name === 'task_complete') {
                if (key === 'success') {
                    comment += ' - BOOLEAN (true/false, NOT "true"/"false")';
                } else if (key === 'details') {
                    comment += ' - OBJECT (not JSON string)';
                }
            }
            
            examples.push(`    "${key}": ${exampleValue}${comment}`);
        });

        return examples.join(',\n');
    }

    /**
     * Tool Usage Patterns and Best Practices
     */
    private static buildToolUsagePatterns(agentConfig: AgentConfig | null, availableTools?: string[]): string {
        const toolSet = availableTools || [];
        const sections: string[] = [];
        
        // Pattern 1: Communication - only if communication tools are available
        const hasCommunication = toolSet.some(tool => tool.startsWith('messaging_') || tool.startsWith('agent_'));
        if (hasCommunication) {
            let commPattern = `**Pattern 1: Simple Communication**`;
            if (toolSet.includes('messaging_send')) commPattern += `\n- Use 'messaging_send' for direct 1:1 communication`;
            if (toolSet.includes('messaging_broadcast')) commPattern += `\n- Use 'messaging_broadcast' for channel-wide announcements`;
            commPattern += `\n- Always include meaningful metadata for context`;
            
            // Add MXP-specific content only if MXP is enabled
            if (agentConfig?.mxpEnabled === true) {
                commPattern += `\n- Use clear, structured language that can be efficiently converted to MXP format`;
            }
            
            commPattern += `\n- For calculations and operations, be explicit: "Calculate sum of X, Y, Z" rather than vague requests`;
            sections.push(commPattern);
        }
        
        // Pattern 2: ORPAR Integration - only if control loop tools are available
        const hasControlLoop = toolSet.some(tool => tool.startsWith('controlLoop_'));
        if (hasControlLoop) {
            const observeTool = toolSet.find(tool => tool === 'controlLoop_observe');
            if (observeTool) {
                sections.push(`**Pattern 2: ORPAR Integration**
- Submit observations using 'controlLoop_observe'
- Include confidence scores and data sources
- Provide rich metadata for better reasoning`);
            }
        }
        
        // Pattern 3: Information Persistence - only if memory tools are available
        const hasMemory = toolSet.some(tool => tool.includes('memory_'));
        if (hasMemory) {
            const memoryTool = toolSet.find(tool => tool.includes('memory_write') || tool.includes('agent_memory'));
            if (memoryTool) {
                sections.push(`**Pattern 3: Information Persistence**
- Store important findings using available memory tools
- Use descriptive keys and relevant tags
- Set appropriate importance levels (1-10)`);
            }
        }
        
        // Pattern 4: Capability Discovery - only if tools_recommend is available
        if (toolSet.includes('tools_recommend')) {
            sections.push(`**Pattern 4: Capability Discovery**
- Use 'tools_recommend' when you need new capabilities
- Provide specific, detailed intent descriptions
- Include relevant context for better recommendations`);
        }
        
        if (sections.length === 0) {
            return `## Tool Usage Patterns

Use your available tools effectively and follow the JSON format requirements for tool calls.`;
        }
        
        return `## Tool Usage Patterns

${sections.join('\n\n')}`;
    }

    /**
     * Meta-Tool Discovery Guidance
     */
    private static buildMetaToolGuidance(availableTools?: string[], mxpEnabled?: boolean): string {
        const toolSet = availableTools || [];
        const hasToolsRecommend = toolSet.includes('tools_recommend');
        const hasTaskComplete = toolSet.includes('task_complete');
        
        if (!hasToolsRecommend && !hasTaskComplete) return '';
        
        let content = `## Tool Discovery & Task Completion`;
        
        if (hasToolsRecommend) {
            content += `

When you need capabilities beyond your core tools:

1. **Use ${META_TOOLS.TOOLS_RECOMMEND}** with your specific intent
2. **The system will intelligently suggest** the best tools using SystemLLM analysis
3. **You can then use those tools directly** in subsequent interactions

**CRITICAL: Tool Execution Sequencing Protocol:**
- **WAIT for tool result confirmation** before calling additional tools
- **Only call ONE tool at a time** unless explicitly required
- **Check tool execution feedback** ( success or error) before proceeding
- **Avoid redundant tool calls** - if a tool succeeded, don't repeat it
- **If a tool fails**, analyze the error before retry or alternative approach

**Tool Execution Flow:**
1. Call a single tool with proper parameters
2. **WAIT** for system response: " tool_name completed successfully" or error
3. Analyze the result and determine next action
4. Only then call additional tools if needed`;

            if (hasTaskComplete) {
                content += `
5. **When done**: Call ${META_TOOLS.TASK_COMPLETE} with summary`;
            }

            content += `

**Example Discovery Flow:**
1. Intent: "I need to create a presentation with charts"
2. System recommends: presentation_create, chart_generate, file_save
3. You use: Each recommended tool with proper parameters`;

            if (hasTaskComplete) {
                content += `
4. **When done**: Call ${META_TOOLS.TASK_COMPLETE} with summary`;
            }

            content += `

**Good Intent Examples:**
- "I need to analyze CSV data and find patterns"
- "I want to create a summary report with visualizations"
- "I need to coordinate with multiple agents on a complex task"
- "I want to store and retrieve historical conversation data"`;
        }
        
        if (hasTaskComplete) {
            content += `

**Task Completion Protocol:**
- **ALWAYS use ${META_TOOLS.TASK_COMPLETE}** when you have finished an assigned task
- This signals the task management system that your work is complete
- Provide a clear summary of what you accomplished

**Task Completion Examples:**`;

            if (mxpEnabled) {
                content += `
\`\`\`json
{
  "op": "task.complete",
  "args": [{
    "summary": "Successfully collaborated with Professor Calculator to solve the mathematical problem. The final answer is 1200 trees total.",
    "success": true,
    "details": {
      "problem": "rectangular field geometry and tree planting", 
      "collaboration": "messaging and problem solving",
      "solution": "Field area calculation and tree placement optimization"
    }
  }]
}
\`\`\``;
            } else {
                content += `
\`\`\`json
{
  "name": "task_complete",
  "arguments": {
    "summary": "Successfully collaborated with Professor Calculator to solve the mathematical problem. The final answer is 1200 trees total.",
    "success": true,
    "details": {
      "problem": "rectangular field geometry and tree planting",
      "collaboration": "messaging and problem solving", 
      "solution": "Field area calculation and tree placement optimization"
    }
  }
}
\`\`\``;
            }
        }
        
        return content;
    }

    /**
     * ORPAR Operational Guidelines
     */
    private static buildOrparGuidelines(config: MxfSystemPromptConfig, availableTools?: string[]): string {
        if (!config.includeOrparGuidance) return '';
        
        // Only include ORPAR if control loop tools are available
        const toolSet = availableTools || [];
        const hasControlLoop = toolSet.some(tool => tool.startsWith('controlLoop_'));
        
        if (!hasControlLoop) return '';

        return `## MXF Operational Guidelines

**Current ORPAR Phase: {{CURRENT_ORPAR_PHASE}}**
{{CURRENT_ORPAR_PHASE_GUIDANCE}}

**Follow ORPAR Cognitive Cycles:**
- **Observe**: Gather information and document observations
- **Reason**: Analyze data, consider multiple perspectives (SystemLLM assists)
- **Act**: Execute specific actions using available tools
- **Plan**: Strategize next steps, coordinate with other agents
  - **ALWAYS create plans** for complex tasks using 'planning_create'
  - Break down work into clear, manageable steps
  - Update plan progress with 'planning_update_item'
  - Better to over-plan than under-plan (Cascade-inspired approach)
- **Reflect**: Learn from outcomes, store insights in memory

**Multi-Agent Coordination:**
- Use ${COMMUNICATION_TOOLS.DISCOVER_AGENTS} to find other agents and their capabilities
- Coordinate with other agents via ${COMMUNICATION_TOOLS.COORDINATE} for complex tasks
- Leverage SystemLLM for intelligent task assignment and workflow optimization
- Share findings through ${COMMUNICATION_TOOLS.BROADCAST} for team awareness
- Store important context using ${CONTEXT_MEMORY_TOOLS.AGENT_MEMORY_WRITE} for continuity

**Communication Best Practices:**

### ✅ OPTIMAL - Direct Tool Calls (No Interpretation Needed)
- **Execution time: ~10ms**
- **Highest reliability and precision**
- Use whenever you have a specific action to perform

### ⚠️ ACCEPTABLE - Natural Language (Requires Interpretation)
- **Execution time: ~200-500ms (SystemLLM must interpret)**
- Use only when tool calls are not feasible
- Be explicit and specific to improve interpretation accuracy

### ❌ AVOID - Ambiguous Statements (May Be Misinterpreted)
- "I think that might work" → SystemLLM cannot determine action
- "Let me check on that" → No clear tool or target specified
- "I'll get back to you" → No timeline or action defined
- "That sounds good" → No actionable information

**Decision Guide for Response Format:**
- Have a specific agent target? → Use tool with agentId directly
- Have a specific action to perform? → Use appropriate tool call
- Need to respond to a message? → Use messaging tools with clear target
- Uncertain about next steps? → Use context_read or agent_discover first
- Complex reasoning needed? → Be explicit with tools rather than ambiguous language

**Execution Best Practices:**
- **Plan before executing** - Create structured plans for multi-step tasks
- Update plans when new information changes your approach
- Track progress systematically through plan updates
- Always provide context in your tool calls
- Use descriptive metadata for better coordination
- Store important insights for future reference
- Discover agent capabilities before requesting collaboration
- Leverage SystemLLM coordination analysis for complex workflows

**Planning Excellence:**
- Use 'planning_create' at the start of complex tasks
- Mark steps as completed with 'planning_update_item'
- Share plans with other agents using 'planning_share'
- For auto-completing tasks, use 'task_create_with_plan'
- Plans are serialized - no parallel updates allowed

**Task Creation with Intelligent Completion:**
- **task_create_with_plan**: Creates tasks that complete automatically when plan steps finish
  - Perfect for structured workflows with clear steps
  - No need for manual task_complete calls
- **task_create_custom_completion**: Creates tasks with custom completion criteria
  - SystemLLM evaluation: AI monitors and decides when complete
  - Output-based: Complete when specific outputs exist
  - Time-based: Complete after duration with activity checks
  - Event-based: Complete on specific system events
- **task_link_to_plan**: Links existing tasks to plans for auto-completion
- **task_monitoring_status**: Check the monitoring status of any task`;
    }

    /**
     * Collaboration Patterns
     */
    private static buildCollaborationPatterns(availableTools?: string[], agentConfig?: AgentConfig): string {
        const toolSet = availableTools || [];
        const hasCommunication = toolSet.some(tool => tool.startsWith('messaging_') || tool.startsWith('agent_'));
        const hasPlanning = toolSet.some(tool => tool.startsWith('planning_'));
        const hasTaskCreateWithPlan = toolSet.includes('task_create_with_plan');
        const hasBroadcast = toolSet.includes('messaging_broadcast');
        
        if (!hasCommunication && !hasPlanning) return '';

        let content = `## Collaboration Patterns

**Effective Multi-Agent Workflows:**`;

        if (hasPlanning) {
            const planningShareTool = toolSet.includes('planning_share');
            if (planningShareTool) {
                content += `
- Create and share plans to coordinate efforts
- Use 'planning_share' to communicate your approach`;
            } else {
                content += `
- Create and share plans to coordinate efforts`;
            }
        }
        
        content += `
- Share observations and findings openly
- Coordinate task distribution to avoid duplication
- Build on other agents' work rather than duplicating effort`;

        if (hasTaskCreateWithPlan) {
            content += `

**Task Assignment Patterns:**
- When assigning tasks to others, consider using 'task_create_with_plan'
- This allows tasks to complete automatically without relying on agents calling task_complete
- Reduces cognitive load and improves reliability`;
        }

        content += `

**Information Sharing:**`;
        
        if (hasBroadcast) {
            content += `
- Use 'messaging_broadcast' for important updates`;
        } else if (hasCommunication) {
            content += `
- Share updates through direct messaging`;
        }
        
        // Only include memory-related guidance if memory tools are available
        const hasMemory = toolSet.some(tool => tool.includes('memory_'));
        if (hasMemory) {
            content += `
- Store shared findings in memory with clear keys
- Tag information appropriately for discoverability`;
        }
        
        content += `
- Maintain context across agent interactions`;

        // Only include MXP guidance if MXP is enabled
        if (agentConfig?.mxpEnabled === true) {
            content += `
- Structure messages for optimal MXP conversion (e.g., "Status: complete, Progress: 100%, Result: success")

**MXP-Optimized Communication:**
- Be explicit with operations: "Calculate average of [1,2,3,4,5]" 
- Use structured status updates: "Task 123: Status=in_progress, Progress=50%"
- Prefer clear commands over conversational language when appropriate
- The system will automatically convert structured messages to efficient MXP format`;
        }
        
        return content;
    }

    /**
     * Error Handling and Troubleshooting
     */
    private static buildErrorHandling(config: MxfSystemPromptConfig, availableTools?: string[], mxpEnabled?: boolean): string {
        if (!config.includeErrorHandling) return '';

        const toolSet = availableTools || [];
        
        let content = `## Tool Usage Best Practices

**CRITICAL: Tool Call Format**`;

        if (mxpEnabled) {
            content += `
When you need to use a tool, you MUST respond with MXP protocol format:

\`\`\`json
{
  "op": "tool.execute",
  "args": [{
    "tool": "tool_name_here",
    "params": {
      "parameter1": "value1",
      "parameter2": "value2"
    }
  }]
}
\`\`\`

**Examples of Correct Tool Calls:**`;

            // Only include examples for tools that are actually available
            if (toolSet.includes('messaging_send')) {
                content += `

To send a message to another agent:
\`\`\`json
{
  "op": "comm.send", 
  "args": [{
    "target": "mathematician-agent",
    "message": "Hello Professor Calculator! I have a math problem for you to solve.",
    "messageType": "collaboration_request"
  }]
}
\`\`\``;
            }

            if (toolSet.includes('task_complete')) {
                content += `

To complete a task:
\`\`\`json
{
  "op": "task.complete",
  "args": [{
    "summary": "Successfully created and sent math problem to mathematician",
    "success": true
  }]
}
\`\`\``;
            }
        } else {
            content += `
When you need to use a tool, you MUST respond with JSON in this EXACT format:

\`\`\`json
{
  "name": "tool_name_here",
  "arguments": {
    "parameter1": "value1",
    "parameter2": "value2"
  }
}
\`\`\`

**Examples of Correct Tool Calls:**`;

            // Only include examples for tools that are actually available
            if (toolSet.includes('messaging_send')) {
                content += `

To send a message to another agent:
\`\`\`json
{
  "name": "messaging_send",
  "arguments": {
    "targetAgentId": "mathematician-agent",
    "message": "Hello Professor Calculator! I have a math problem for you to solve.",
    "messageType": "collaboration_request"
  }
}
\`\`\``;
            }

            if (toolSet.includes('task_complete')) {
                content += `

To complete a task:
\`\`\`json
{
  "name": "task_complete",
  "arguments": {
    "summary": "Successfully created and sent math problem to mathematician",
    "success": true
  }
}
\`\`\``;
            }
        }

        content += `

**IMPORTANT RULES:**
- Never mix text and tool calls in the same response
- When using tools, respond ONLY with the JSON tool call
- Use tools immediately when you need to perform actions
- Don't describe what you're going to do - just do it with the tool call

**JSON Structure Requirements:**
- Always include required fields (check tool documentation)
- Use appropriate data types (string, number, object, array)
- Provide meaningful descriptions and context
- Include relevant metadata for better processing

**Error Prevention:**
- Validate your JSON structure before calling tools
- Use descriptive error messages when tools fail`;
    
        // Only mention tools_recommend if it's actually available
        if (toolSet.includes('tools_recommend')) {
            content += `
- Try 'tools_recommend' if you're unsure about capabilities`;
        }
        
        // Only mention memory if memory tools are available
        const hasMemory = toolSet.some(tool => tool.includes('memory_'));
        if (hasMemory) {
            content += `
- Store successful patterns in memory for reuse`;
        }
        
        content += `

**Troubleshooting:**
- If a tool fails, check the JSON structure first
- Ensure all required fields are present
- Verify data types match the schema
- Use simpler parameters if complex calls fail`;
        
        return content;
    }

    /**
     * Context Awareness Notice
     * Explains that agents will receive context with each message
     */
    private static buildContextAwarenessNotice(): string {
        return `## Context and History Management

**IMPORTANT**: Each message you receive will include:
- Your recent action history (to prevent duplicates)
- Current channel context (agents and state)
- Any new information or tasks

**Before taking action**:
- Review the provided action history
- Don't repeat actions already taken
- Build upon previous work
- Respond to new information only

The system tracks all your actions automatically.`;
    }

    /**
     * SystemLLM Message Guidance - Enhanced with interpretation details
     */
    private static buildSystemMessageGuidance(): string {
        return `## SystemLLM Services

### Interpretation Service
When you respond with natural language instead of tool calls:
1. SystemLLM interprets your intent
2. Maps references like "the scheduler" to actual agent IDs
3. Converts to appropriate tool calls
4. Executes on your behalf
5. Records the action as "SystemLLM-interpreted"

This adds latency but ensures your intent is executed.

### Coordination Messages
You may occasionally receive messages with special prefixes or metadata:

**Messages starting with "SYSTEM:" prefix:**
- These are coordination insights from SystemLLM
- They provide guidance and context for multi-agent collaboration
- **DO NOT respond to them directly or acknowledge them**
- Use them as context for your ongoing work
- They are ephemeral metadata, not requests requiring action

**Messages marked as "system" or from "SystemLLM":**
- These are coordination insights, not requests
- **Do NOT respond** to them directly
- Use them as context for your work
- Continue your task execution

**Important:** SystemLLM messages and SYSTEM: prefixed messages are ephemeral coordination metadata that should not interrupt your autonomous task execution. Treat them as background context only.`;
    }

    /**
     * Build agent identity prompt (separate from framework prompt)
     * This should be used as a USER role message, not in system prompt
     * Note: Does NOT include agentConfigPrompt to avoid duplication with buildCustomPrompt
     */
    public static buildAgentIdentityPrompt(agentConfig: AgentConfig): string {
        const sections = [];
        
        // Agent identity - clear about role but not confusing for targeting
        sections.push(`## Your Agent Identity

**You are**: ${agentConfig.name || PROMPT_TEMPLATES.AGENT_ID}
**Your Agent ID**: ${PROMPT_TEMPLATES.AGENT_ID}
**Operating in Channel ID**: ${PROMPT_TEMPLATES.CHANNEL_ID}

**Current Date/Time**: ${PROMPT_TEMPLATES.DATE_TIME}
**Day**: ${PROMPT_TEMPLATES.DAY_OF_WEEK}, ${PROMPT_TEMPLATES.CURRENT_MONTH} ${PROMPT_TEMPLATES.CURRENT_DAY}, ${PROMPT_TEMPLATES.CURRENT_YEAR}
**Your Timezone**: ${PROMPT_TEMPLATES.TIME_ZONE}
**OS Platform**: ${PROMPT_TEMPLATES.OS_PLATFORM}
**Your LLM Configuration**: ${PROMPT_TEMPLATES.LLM_PROVIDER} (${PROMPT_TEMPLATES.LLM_MODEL})
**SystemLLM Status**: ${PROMPT_TEMPLATES.SYSTEM_LLM_STATUS}
**Active Agents in Channel**: ${PROMPT_TEMPLATES.ACTIVE_AGENTS_COUNT} - ${PROMPT_TEMPLATES.ACTIVE_AGENTS_LIST}

**Current Task**: ${PROMPT_TEMPLATES.CURRENT_TASK_TITLE}
**Task ID**: ${PROMPT_TEMPLATES.CURRENT_TASK_ID}
**Task Status**: ${PROMPT_TEMPLATES.CURRENT_TASK_STATUS}
**Task Progress**: ${PROMPT_TEMPLATES.CURRENT_TASK_PROGRESS}

You are operating in real-time. The information above is updated automatically with each request. Always consider the current context when responding to time-sensitive or collaborative requests.`);
        
        // Agent description/purpose
        if (agentConfig.description) {
            sections.push(`**Your Purpose**: ${agentConfig.description}`);
        }
        
        // Agent capabilities (domain expertise, not tools)
        if (agentConfig.capabilities && agentConfig.capabilities.length > 0) {
            sections.push(`**Your Domain Capabilities**:
${agentConfig.capabilities.map(cap => `- ${cap}`).join('\n')}`);
        }
        
        // LLM Configuration (if reasoning is enabled)
        if (agentConfig.reasoning?.enabled) {
            const reasoningConfig = [
                `**Reasoning**: Enabled`,
                agentConfig.reasoning.effort ? `**Effort Level**: ${agentConfig.reasoning.effort}` : null,
                agentConfig.reasoning.maxTokens ? `**Max Reasoning Tokens**: ${agentConfig.reasoning.maxTokens}` : null
            ].filter(Boolean);
            sections.push(`**Your Reasoning Configuration**:
${reasoningConfig.map(item => `- ${item}`).join('\n')}`);
        }
        
        // Operational Settings
        const operationalSettings = [];
        if (agentConfig.useMessageAggregate !== undefined) {
            operationalSettings.push(`**Message Aggregation**: ${agentConfig.useMessageAggregate ? 'Enabled' : 'Disabled'}`);
        }
        if (agentConfig.mxpEnabled !== undefined) {
            operationalSettings.push(`**MXP Protocol**: ${agentConfig.mxpEnabled ? 'Enabled' : 'Disabled'}`);
        }
        if (agentConfig.preferredResponseMode) {
            operationalSettings.push(`**Response Mode**: ${agentConfig.preferredResponseMode}`);
        }
        if (operationalSettings.length > 0) {
            sections.push(`**Your Operational Settings**:
${operationalSettings.map(item => `- ${item}`).join('\n')}`);
        }
        
        // Agent metadata
        if (agentConfig.metadata && Object.keys(agentConfig.metadata).length > 0) {
            const metadataEntries = Object.entries(agentConfig.metadata)
                .filter(([key, value]) => value !== null && value !== undefined)
                .map(([key, value]) => `- **${key}**: ${String(value)}`);
            
            if (metadataEntries.length > 0) {
                sections.push(`**Additional Context**:
${metadataEntries.join('\n')}`);
            }
        }
        
        return sections.join('\n\n');
    }

    /**
     * Custom Agent Prompt Integration
     */
    private static buildCustomPrompt(customPrompt?: string, toolNames?: string[]): string {
        if (!customPrompt) return '';

        // Only mention tools_recommend if it's actually available
        const hasToolsRecommend = toolNames?.includes('tools_recommend') || false;
        const toolDiscoveryNote = hasToolsRecommend 
            ? `*Remember: Use your core MXF tools and the ${META_TOOLS.TOOLS_RECOMMEND} capability to discover additional tools as needed for your specific role and tasks.*`
            : `*Remember: Use your core MXF tools for your specific role and tasks.*`;

        return `## Your Specific Role and Capabilities

${customPrompt}

---

${toolDiscoveryNote}`;
    }

    /**
     * Build minimal prompt for testing/debugging
     */
    public static buildMinimalPrompt(agentConfig: AgentConfig): string {
        return [
            this.buildMxfIdentity(agentConfig),
            this.buildMandatoryToolFormat(),
            this.buildCoreCapabilities(),
            this.buildToolUsagePatterns(agentConfig),
            this.buildMetaToolGuidance(),
            this.buildAgentIdentityPrompt(agentConfig),
            this.buildCustomPrompt(agentConfig.agentConfigPrompt, undefined)
        ].filter(Boolean).join('\n\n');
    }
}
