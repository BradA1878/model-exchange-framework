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
 * MCP Tool Documentation Service
 * 
 * Provides comprehensive documentation, examples, and validation helpers
 * for MCP tools to improve agent tool calling accuracy.
 */

import { Logger } from '../utils/Logger';
import { McpToolDefinition } from '../protocols/mcp/McpServerTypes';
import { generateToolDocumentation } from '../protocols/mcp/McpToolSchema';
import { generateToolCallExamples } from '../protocols/mcp/McpToolCallParser';

const logger = new Logger('info', 'McpToolDocumentationService', 'server');

export class McpToolDocumentationService {
    private static instance: McpToolDocumentationService;
    private toolCache: Map<string, McpToolDefinition> = new Map();
    
    private constructor() {}
    
    /**
     * Get singleton instance
     */
    public static getInstance(): McpToolDocumentationService {
        if (!McpToolDocumentationService.instance) {
            McpToolDocumentationService.instance = new McpToolDocumentationService();
        }
        return McpToolDocumentationService.instance;
    }
    
    /**
     * Register a tool for documentation
     */
    public registerTool(tool: McpToolDefinition): void {
        this.toolCache.set(tool.name, tool);
    }
    
    /**
     * Get comprehensive help for a specific tool
     */
    public getToolHelp(toolName: string): string {
        const tool = this.toolCache.get(toolName);
        if (!tool) {
            return `Tool "${toolName}" not found. Use listTools() to see available tools.`;
        }
        
        const lines: string[] = [];
        
        // Basic documentation
        lines.push(generateToolDocumentation(tool));
        lines.push('');
        
        // Call format examples
        lines.push('### How to Call This Tool:');
        lines.push('');
        const examples = generateToolCallExamples(tool.name, tool.inputSchema);
        examples.forEach((example, index) => {
            lines.push(`#### Format ${index + 1}:`);
            lines.push('```');
            lines.push(example);
            lines.push('```');
            lines.push('');
        });
        
        // Common mistakes
        lines.push('### Common Mistakes to Avoid:');
        lines.push('');
        lines.push(this.getCommonMistakes(tool));
        
        return lines.join('\n');
    }
    
    /**
     * Get quick reference for all tools
     */
    public getQuickReference(): string {
        const lines: string[] = [
            '# MCP Tools Quick Reference',
            '',
            'Format your tool calls using one of these patterns:',
            '- XML: `<tool>tool_name</tool><parameters>{...}</parameters>`',
            '- Function: `tool_name({...})`',
            '- Structured: `TOOL: tool_name PARAMETERS: {...}`',
            '',
            '## Available Tools:',
            ''
        ];
        
        // Group tools by category
        const categories = new Map<string, McpToolDefinition[]>();
        
        for (const tool of this.toolCache.values()) {
            const category = tool.metadata?.category || 'general';
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category)!.push(tool);
        }
        
        // Display by category
        for (const [category, tools] of categories) {
            lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
            lines.push('');
            
            for (const tool of tools) {
                const required = tool.inputSchema.required || [];
                lines.push(`- **${tool.name}**: ${tool.description}`);
                lines.push(`  - Required: ${required.length > 0 ? required.join(', ') : 'none'}`);
            }
            lines.push('');
        }
        
        return lines.join('\n');
    }
    
    /**
     * Get validation tips for better tool calling
     */
    public getValidationTips(): string[] {
        return [
            'Always provide all required parameters',
            'Check parameter types match the schema (string, number, boolean, etc.)',
            'Use proper JSON formatting for parameters',
            'Don\'t include extra properties not defined in the schema',
            'For file paths, use absolute paths starting with /',
            'For enum parameters, use exact values from the allowed list',
            'Check minimum/maximum constraints for numbers',
            'Verify string patterns match required formats'
        ];
    }
    
    /**
     * Generate common mistakes for a specific tool
     */
    private getCommonMistakes(tool: McpToolDefinition): string {
        const mistakes: string[] = [];
        const schema = tool.inputSchema;
        
        if (schema.required && schema.required.length > 0) {
            mistakes.push(`- Forgetting required parameters: ${schema.required.join(', ')}`);
        }
        
        if (schema.properties) {
            for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
                if (prop.type === 'string' && prop.minLength) {
                    mistakes.push(`- Providing empty string for "${key}" (minimum length: ${prop.minLength})`);
                }
                if (prop.enum) {
                    mistakes.push(`- Using invalid value for "${key}" (must be one of: ${prop.enum.join(', ')})`);
                }
                if (prop.pattern) {
                    mistakes.push(`- "${key}" must match pattern: ${prop.pattern}`);
                }
            }
        }
        
        if (schema.additionalProperties === false) {
            mistakes.push('- Including properties not defined in the schema');
        }
        
        mistakes.push('- Using wrong parameter types (e.g., string instead of number)');
        mistakes.push('- Malformed JSON in parameters');
        
        return mistakes.join('\n');
    }
    
    /**
     * Get suggested fix for a validation error
     */
    public getSuggestedFix(
        toolName: string,
        error: string,
        providedInput: any
    ): string {
        const tool = this.toolCache.get(toolName);
        if (!tool) {
            return 'Tool not found';
        }
        
        const suggestions: string[] = [];
        
        // Analyze error and provide specific suggestions
        if (error.includes('Missing required parameter')) {
            const match = error.match(/Missing required parameter: (\w+)/);
            if (match) {
                const param = match[1];
                const prop = tool.inputSchema.properties?.[param];
                if (prop) {
                    suggestions.push(`Add "${param}" parameter of type ${prop.type}`);
                    if (prop.description) {
                        suggestions.push(`Description: ${prop.description}`);
                    }
                    if (prop.example) {
                        suggestions.push(`Example: "${param}": ${JSON.stringify(prop.example)}`);
                    }
                }
            }
        }
        
        if (error.includes('must be one of')) {
            const match = error.match(/(\w+) must be one of: (.+)/);
            if (match) {
                suggestions.push(`Change "${match[1]}" to one of the allowed values: ${match[2]}`);
            }
        }
        
        if (error.includes('type')) {
            suggestions.push('Check that all parameter types match the schema:');
            if (tool.inputSchema.properties) {
                for (const [key, prop] of Object.entries(tool.inputSchema.properties as Record<string, any>)) {
                    suggestions.push(`- ${key}: ${prop.type}`);
                }
            }
        }
        
        return suggestions.join('\n');
    }
}