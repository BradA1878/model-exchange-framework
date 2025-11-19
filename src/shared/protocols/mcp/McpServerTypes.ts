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
 * MCP Server Types
 * 
 * This module defines the types and interfaces for the MCP server implementation.
 * It follows the standard MCP specification while providing integration with the MXF.
 */

import { Observable } from 'rxjs';
import { McpContentType, McpToolInput } from './IMcpClient';
import { McpToolExample } from './McpToolSchema';

/**
 * MCP Server Configuration
 */
export interface McpServerConfig {
    /** Server name */
    name: string;
    /** Server version */
    version: string;
    /** Optional description */
    description?: string;
    /** Optional base URL */
    baseUrl?: string;
}

/**
 * MCP Tool Handler Context
 */
export interface McpToolHandlerContext {
    /** Request ID */
    requestId: string;
    /** Agent ID that initiated the request */
    agentId?: string;
    /** Channel ID where the request originated */
    channelId?: string;
    /** Additional context data */
    data?: Record<string, any>;
}

/**
 * MCP Tool Handler Result
 */
export interface McpToolHandlerResult {
    /** Result content */
    content: McpToolResultContent;
    /** Optional metadata */
    metadata?: Record<string, any>;
}

/**
 * MCP Tool Result Content
 */
export interface McpToolResultContent {
    /** Content type, can be text, structured data, or binary */
    type: string;
    /** Content payload */
    data: any;
    /** MIME type for binary content */
    mimeType?: string;
}

/**
 * MCP Tool Definition
 */
export interface McpToolDefinition {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** JSON schema for tool input */
    inputSchema: Record<string, any>;
    /** Handler function for tool execution */
    handler: (input: McpToolInput, context: McpToolHandlerContext) => Promise<McpToolHandlerResult> | Observable<McpToolHandlerResult>;
    /** Is the tool currently enabled */
    enabled: boolean;
    /** Optional tool metadata */
    metadata?: Record<string, any>;
    /** Optional validation function for tool input */
    validateInput?: (input: McpToolInput) => boolean | Promise<boolean>;
    /** Optional examples showing how to use the tool */
    examples?: McpToolExample[];
}

/**
 * MCP Resource Definition
 */
export interface McpResourceDefinition {
    /** Resource name */
    name: string;
    /** Resource description */
    description: string;
    /** Resource URI template */
    uriTemplate: string;
    /** Handler function for resource retrieval */
    handler: (uri: URL, params: Record<string, string>) => Promise<McpResourceResult> | Observable<McpResourceResult>;
    /** Is the resource currently enabled */
    enabled: boolean;
    /** Optional resource metadata */
    metadata?: Record<string, any>;
}

/**
 * MCP Resource Result
 */
export interface McpResourceResult {
    /** Array of content items */
    contents: McpResourceContent[];
    /** Optional metadata */
    metadata?: Record<string, any>;
}

/**
 * MCP Resource Content
 */
export interface McpResourceContent {
    /** Resource URI */
    uri: string;
    /** Resource text content */
    text: string;
    /** Optional MIME type */
    mimeType?: string;
    /** Optional metadata */
    metadata?: Record<string, any>;
}

/**
 * MCP Authorization Request
 */
export interface McpAuthorizationRequest {
    /** Request ID */
    requestId: string;
    /** Request type (tool or resource) */
    type: 'tool' | 'resource';
    /** Tool or resource name */
    name: string;
    /** Operation being requested */
    operation: 'execute' | 'read' | 'list';
    /** Agent ID that initiated the request */
    agentId?: string;
    /** Channel ID where the request originated */
    channelId?: string;
    /** Additional request data */
    data?: Record<string, any>;
}

/**
 * MCP Authorization Result
 */
export interface McpAuthorizationResult {
    /** Request ID */
    requestId: string;
    /** Is the request authorized */
    authorized: boolean;
    /** Optional reason for denial */
    reason?: string;
    /** Optional metadata */
    metadata?: Record<string, any>;
}

/**
 * MCP Server Capabilities
 */
export interface McpServerCapabilities {
    /** Does the server support tools */
    tools: boolean;
    /** Does the server support resources */
    resources: boolean;
    /** Does the server support authorization */
    authorization: boolean;
    /** Does the server support streaming responses */
    streaming: boolean;
    /** Additional capabilities */
    [key: string]: boolean;
}

/**
 * MCP Error Response
 */
export interface McpErrorResponse {
    /** Error message */
    message: string;
    /** Error code */
    code: string;
    /** Additional error details */
    details?: Record<string, any>;
}
