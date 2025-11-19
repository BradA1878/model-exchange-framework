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
 * MCP (Model Context Protocol) events
 */
export const McpEvents = {
    // Server events
    SERVER_START: 'mcp:server:start',
    SERVER_STOP: 'mcp:server:stop',
    SERVER_ERROR: 'mcp:server:error',
    SERVER_STATUS: 'mcp:server:status',
    
    // External server management events
    // External server registration (SDK → Server)
    EXTERNAL_SERVER_REGISTER: 'mcp:external:server:register',
    EXTERNAL_SERVER_REGISTERED: 'mcp:external:server:registered',
    EXTERNAL_SERVER_UNREGISTER: 'mcp:external:server:unregister',
    EXTERNAL_SERVER_UNREGISTERED: 'mcp:external:server:unregistered',
    EXTERNAL_SERVER_REGISTRATION_FAILED: 'mcp:external:server:registration:failed',

    // External server lifecycle
    EXTERNAL_SERVER_SPAWN: 'mcp:external:server:spawn',
    EXTERNAL_SERVER_STARTED: 'mcp:external:server:started',
    EXTERNAL_SERVER_STOP: 'mcp:external:server:stop',
    EXTERNAL_SERVER_STOPPED: 'mcp:external:server:stopped',
    EXTERNAL_SERVER_ERROR: 'mcp:external:server:error',
    EXTERNAL_SERVER_HEALTH_CHECK: 'mcp:external:server:health:check',
    EXTERNAL_SERVER_HEALTH_STATUS: 'mcp:external:server:health:status',
    EXTERNAL_SERVER_RESTART: 'mcp:external:server:restart',
    EXTERNAL_SERVER_DISCOVERY: 'mcp:external:server:discovery',
    EXTERNAL_SERVER_TOOLS_DISCOVERED: 'mcp:external:server:tools:discovered',
    
    // Tool events
    TOOL_REGISTER: 'mcp:tool:register',
    TOOL_REGISTERED: 'mcp:tool:registered',
    TOOL_UNREGISTER: 'mcp:tool:unregister',
    TOOL_UNREGISTERED: 'mcp:tool:unregistered',
    TOOL_REGISTRY_CHANGED: 'mcp:tool:registry:changed',
    TOOL_LIST: 'mcp:tool:list',
    TOOL_LIST_RESULT: 'mcp:tool:list:result',
    TOOL_LIST_ERROR: 'mcp:tool:list:error',
    TOOL_CALL: 'mcp:tool:call',
    TOOL_RESULT: 'mcp:tool:result',
    TOOL_ERROR: 'mcp:tool:error',
    TOOL_EXECUTION: 'mcp:tool:execution',
    
    // Tool validation events
    TOOL_VALIDATION_STARTED: 'mcp:tool:validation:started',
    TOOL_VALIDATION_COMPLETED: 'mcp:tool:validation:completed',
    TOOL_VALIDATION_ERROR: 'mcp:tool:validation:error',
    
    // MXF Tool Service events (for client-server communication)
    MXF_TOOL_LIST: 'mxf:tool:list',
    MXF_TOOL_LIST_RESULT: 'mxf:tool:list:result',
    MXF_TOOL_LIST_ERROR: 'mxf:tool:list:error',
    
    // Resource events
    RESOURCE_GET: 'mcp:resource:get',
    RESOURCE_RESULT: 'mcp:resource:result',
    RESOURCE_ERROR: 'mcp:resource:error',
    RESOURCE_LIST: 'mcp:resource:list',
    RESOURCE_LIST_RESULT: 'mcp:resource:list:result'
};

/**
 * Payload types for MCP events
 */
export interface McpPayloads {
    // Server events
    'mcp:server:start': { name: string, version: string, description?: string };
    'mcp:server:stop': { name: string, version: string, description?: string };
    'mcp:server:error': { error: string, code: string, details?: Record<string, any> };
    'mcp:server:status': { name: string, version: string, capabilities: Record<string, boolean> };
    
    // External server management events
    // Registration events (SDK → Server)
    'mcp:external:server:register': {
        id: string;
        name: string;
        version?: string;
        command?: string;
        args?: string[];
        transport?: 'stdio' | 'http';
        url?: string;
        autoStart?: boolean;
        restartOnCrash?: boolean;
        maxRestartAttempts?: number;
        healthCheckInterval?: number;
        startupTimeout?: number;
        environmentVariables?: Record<string, string>;
    };
    'mcp:external:server:registered': {
        serverId: string;
        success: boolean;
        message?: string;
        error?: string;
    };
    'mcp:external:server:unregister': { serverId: string };
    'mcp:external:server:unregistered': {
        serverId: string;
        success: boolean;
        message?: string;
        error?: string;
    };
    'mcp:external:server:registration:failed': {
        serverId?: string;
        success: false;
        error: string;
    };

    // Lifecycle events
    'mcp:external:server:spawn': { name: string, version: string, description?: string };
    'mcp:external:server:started': { name: string, version: string, description?: string };
    'mcp:external:server:stop': { name: string, version: string, description?: string };
    'mcp:external:server:stopped': { name: string, version: string, description?: string };
    'mcp:external:server:error': { error: string, code: string, details?: Record<string, any> };
    'mcp:external:server:health:check': { name: string, version: string, description?: string };
    'mcp:external:server:health:status': { name: string, version: string, status: string, description?: string };
    'mcp:external:server:restart': { name: string, version: string, description?: string };
    'mcp:external:server:discovery': { name: string, version: string, description?: string };
    'mcp:external:server:tools:discovered': { name: string, version: string, tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> };
    
    // Tool events
    'mcp:tool:register': { name: string, description: string, inputSchema: Record<string, any>, metadata?: Record<string, any> };
    'mcp:tool:registered': { name: string, success: boolean };
    'mcp:tool:unregister': { name: string };
    'mcp:tool:unregistered': { name: string, success: boolean };
    'mcp:tool:registry:changed': { tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> };
    'mcp:tool:list': { filter?: string };
    'mcp:tool:list:result': { tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> };
    'mcp:tool:list:error': { error: string };
    'mcp:tool:call': { requestId: string, name: string, input: Record<string, any>, agentId?: string, channelId?: string };
    'mcp:tool:result': { requestId: string, result: any, metadata?: Record<string, any> };
    'mcp:tool:error': { requestId: string, error: string, code?: string, details?: Record<string, any> };
    'mcp:tool:execution': { requestId: string, result: any, metadata?: Record<string, any> };
    
    // Tool validation events
    'mcp:tool:validation:started': { requestId: string, toolName: string, input: Record<string, any>, validationType: string };
    'mcp:tool:validation:completed': { requestId: string, toolName: string, isValid: boolean, validationResult: Record<string, any> };
    'mcp:tool:validation:error': { requestId: string, toolName: string, error: string, code?: string, details?: Record<string, any> };
    
    // MXF Tool Service events (for client-server communication)
    'mxf:tool:list': { filter?: string };
    'mxf:tool:list:result': { tools: Array<{ name: string, description: string, inputSchema: Record<string, any> }> };
    'mxf:tool:list:error': { error: string };
    
    // Resource events
    'mcp:resource:get': { requestId: string, uri: string, agentId?: string, channelId?: string };
    'mcp:resource:result': { requestId: string, content: Array<{ uri: string, text: string, mimeType?: string }>, metadata?: Record<string, any> };
    'mcp:resource:error': { requestId: string, error: string, code?: string, details?: Record<string, any> };
    'mcp:resource:list': { filter?: string };
    'mcp:resource:list:result': { resources: Array<{ name: string, description: string, uriTemplate: string }> };
}
