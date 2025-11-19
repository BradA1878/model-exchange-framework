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
 * Tool Types (Stub)
 * 
 * Provides type definitions for tool-related functionality.
 * This is a minimal implementation to allow the build process to succeed.
 * Created following DRY principles and fail-fast validation patterns.
 */

// Access level enum for tools
export enum ToolAccessLevel {
    PUBLIC = 'public',
    PRIVATE = 'private',
    PROTECTED = 'protected',
    RESTRICTED = 'restricted'
}

// Parameter type enum
export enum ToolParameterType {
    STRING = 'string',
    NUMBER = 'number',
    BOOLEAN = 'boolean',
    OBJECT = 'object',
    ARRAY = 'array',
    ANY = 'any'
}

// Server authentication type enum
export enum ToolServerAuthType {
    NONE = 'none',
    API_KEY = 'api_key',
    OAUTH = 'oauth',
    BASIC = 'basic'
}

// Server connection type enum
export enum ToolServerConnectionType {
    REST = 'rest',
    GRAPHQL = 'graphql',
    SOAP = 'soap',
    GRPC = 'grpc',
    CUSTOM = 'custom'
}

// Server status enum
export enum ToolServerStatus {
    ONLINE = 'online',
    OFFLINE = 'offline',
    DEGRADED = 'degraded',
    MAINTENANCE = 'maintenance',
    DISCONNECTED = 'disconnected'
}

// Tool call status enum
export enum ToolCallStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed',
    TIMEOUT = 'timeout'
}

// Basic tool interface
export interface Tool {
    name: string;
    description: string;
    parameters: ToolParameter[];
}

// Tool parameter interface
export interface ToolParameter {
    name: string;
    type: ToolParameterType;
    description: string;
    required: boolean;
}

// Tool result interface 
export interface ToolResult {
    status: ToolCallStatus;
    data?: any;
    error?: string;
}

// Tool execution context
export interface ToolContext {
    agentId: string;
    channelId?: string;
}

// Tool execution request
export interface ToolRequest {
    toolName: string;
    parameters: Record<string, any>;
    context: ToolContext;
}

// This maintains a clean separation between tool definition and execution,
// following the architecture's separation of concerns principle
