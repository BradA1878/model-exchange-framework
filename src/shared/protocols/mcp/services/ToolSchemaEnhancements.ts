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
 * ToolSchemaEnhancements.ts
 * 
 * Provides enhanced schemas and examples for external MCP tools to improve
 * agent understanding of complex tool structures. This is particularly useful
 * for tools with nested objects or domain-specific knowledge (like n8n workflows).
 */

/**
 * Schema enhancement for a specific tool
 */
export interface ToolSchemaEnhancement {
    /** Tool name to enhance */
    toolName: string;
    /** Server ID that provides the tool */
    serverId: string;
    /** Examples to add to the schema */
    examples?: any[];
    /** Additional schema properties to merge */
    propertyEnhancements?: Record<string, any>;
}

/**
 * All tool schema enhancements
 * 
 * NOTE: Previously contained n8n workflow enhancements, but those are no longer
 * needed since the actual n8n-mcp server (czlonkowski/n8n-mcp) has built-in
 * validation, autofix, and example support.
 */
export const TOOL_SCHEMA_ENHANCEMENTS: ToolSchemaEnhancement[] = [];

/**
 * Find enhancement for a specific tool
 */
export const findToolEnhancement = (toolName: string, serverId: string): ToolSchemaEnhancement | undefined => {
    return TOOL_SCHEMA_ENHANCEMENTS.find(
        enhancement => enhancement.toolName === toolName && enhancement.serverId === serverId
    );
};

/**
 * Apply enhancements to a tool's input schema
 */
export const enhanceToolSchema = (
    toolName: string, 
    serverId: string, 
    originalSchema: Record<string, any>
): Record<string, any> => {
    const enhancement = findToolEnhancement(toolName, serverId);
    
    if (!enhancement) {
        return originalSchema;
    }

    // Create enhanced schema by merging
    const enhancedSchema = { ...originalSchema };

    // Add examples if provided
    if (enhancement.examples && enhancement.examples.length > 0) {
        enhancedSchema.examples = enhancement.examples;
    }

    // Enhance property definitions if provided
    if (enhancement.propertyEnhancements && enhancedSchema.properties) {
        enhancedSchema.properties = {
            ...enhancedSchema.properties,
            ...enhancement.propertyEnhancements
        };
    }

    return enhancedSchema;
};
