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
 */

/**
 * FrameworkAdapter
 *
 * Base class for integrating external AI framework tools into MXF.
 * Provides tool discovery, adaptation, and execution capabilities.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { Logger } from '../utils/Logger';
import { McpTool } from '../protocols/mcp/IMcpClient';

/**
 * External tool definition (framework-agnostic)
 */
export interface ExternalTool {
    /** Tool identifier in external framework */
    id: string;
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Tool category */
    category?: string;
    /** Input schema (framework-specific format) */
    inputSchema: any;
    /** Output schema (framework-specific format) */
    outputSchema?: any;
    /** Framework-specific metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
    /** Tool identifier */
    toolId: string;
    /** Input parameters */
    parameters: Record<string, unknown>;
    /** Agent ID */
    agentId?: string;
    /** Channel ID */
    channelId?: string;
    /** Execution timeout (ms) */
    timeout?: number;
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
    /** Success flag */
    success: boolean;
    /** Result data */
    data?: unknown;
    /** Error (if failed) */
    error?: {
        message: string;
        code?: string;
        details?: unknown;
    };
    /** Execution duration (ms) */
    duration: number;
}

/**
 * Framework adapter configuration
 */
export interface FrameworkAdapterConfig {
    /** Framework name */
    frameworkName: string;
    /** Framework version */
    frameworkVersion?: string;
    /** Adapter version */
    adapterVersion?: string;
    /** Configuration options */
    options?: Record<string, unknown>;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * FrameworkAdapter - Base class for external framework integration
 *
 * Abstract base class that defines the interface for adapting tools
 * from external AI frameworks (LangChain, CrewAI, etc.) to MXF's
 * internal MCP tool format.
 *
 * Subclasses must implement:
 * - discoverTools(): Find available tools in the framework
 * - adaptTool(): Convert external tool to MCP format
 * - executeExternalTool(): Execute tool in framework
 */
export abstract class FrameworkAdapter {
    protected logger: Logger;
    protected config: FrameworkAdapterConfig;

    /** Framework name (e.g., 'langchain', 'crewai') */
    abstract readonly frameworkName: string;

    /** Supported tool types */
    abstract readonly supportedToolTypes: string[];

    constructor(config: FrameworkAdapterConfig) {
        this.config = config;
        this.logger = new Logger('FrameworkAdapter');

        this.logger.info('Initialized framework adapter', {
            frameworkName: config.frameworkName,
            version: config.frameworkVersion,
            debug: config.debug
        });
    }

    /**
     * Discover available tools in the external framework
     *
     * @returns List of external tools available
     */
    public abstract discoverTools(): Promise<ExternalTool[]>;

    /**
     * Adapt an external tool to MCP format
     *
     * @param externalTool - Tool from external framework
     * @returns MCP-compatible tool definition
     */
    public abstract adaptTool(externalTool: ExternalTool): Promise<McpTool>;

    /**
     * Execute a tool in the external framework
     *
     * @param context - Execution context
     * @returns Execution result
     */
    public abstract executeExternalTool(context: ToolExecutionContext): Promise<ToolExecutionResult>;

    /**
     * Validate tool compatibility
     *
     * @param externalTool - Tool to validate
     * @returns True if tool can be adapted
     */
    public validateToolCompatibility(externalTool: ExternalTool): boolean {
        if (!externalTool.name || !externalTool.description) {
            this.logger.warn('Tool missing required fields', {
                toolId: externalTool.id
            });
            return false;
        }

        return true;
    }

    /**
     * Get adapter metadata
     */
    public getAdapterInfo(): {
        frameworkName: string;
        frameworkVersion?: string;
        adapterVersion?: string;
        supportedToolTypes: string[];
    } {
        return {
            frameworkName: this.frameworkName,
            frameworkVersion: this.config.frameworkVersion,
            adapterVersion: this.config.adapterVersion,
            supportedToolTypes: this.supportedToolTypes
        };
    }

    /**
     * Convert external schema to JSON Schema
     *
     * Helper method for subclasses to convert framework-specific
     * schemas to JSON Schema format used by MCP.
     *
     * @param externalSchema - Framework-specific schema
     * @returns JSON Schema
     */
    protected convertToJsonSchema(externalSchema: any): any {
        // Basic conversion - subclasses should override for framework-specific logic
        if (typeof externalSchema === 'object' && externalSchema !== null) {
            return externalSchema;
        }

        return {
            type: 'object',
            properties: {}
        };
    }

    /**
     * Handle execution error
     *
     * @param error - Error object
     * @returns Standardized error result
     */
    protected handleExecutionError(error: any, duration: number): ToolExecutionResult {
        this.logger.error('Tool execution failed', {
            error: error.message,
            stack: error.stack
        });

        return {
            success: false,
            error: {
                message: error.message || 'Unknown execution error',
                code: error.code,
                details: error
            },
            duration
        };
    }

    /**
     * Validate execution parameters
     *
     * @param parameters - Parameters to validate
     * @param schema - Expected schema
     * @returns True if valid
     */
    protected validateParameters(parameters: Record<string, unknown>, schema: any): boolean {
        // Basic validation - subclasses can override for stricter validation
        if (!schema || !schema.properties) {
            return true;
        }

        const required = schema.required || [];
        for (const requiredField of required) {
            if (!(requiredField in parameters)) {
                this.logger.warn('Missing required parameter', {
                    parameter: requiredField
                });
                return false;
            }
        }

        return true;
    }
}
