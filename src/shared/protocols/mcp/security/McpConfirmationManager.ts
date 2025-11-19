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
 * McpConfirmationManager.ts
 * 
 * Manages confirmation requests for destructive or high-risk MCP operations.
 * Provides different confirmation strategies based on the execution context.
 */

import { Logger } from '../../../utils/Logger';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

const logger = new Logger('info', 'McpConfirmationManager', 'server');

export interface ConfirmationRequest {
    id: string;
    type: 'command' | 'file_operation' | 'system_change';
    operation: string;
    details: {
        command?: string;
        path?: string;
        action?: string;
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        reason: string;
    };
    context: {
        agentId: string;
        channelId: string;
        userId?: string;
    };
    timestamp: number;
    expiresAt: number;
    status: 'pending' | 'approved' | 'denied' | 'expired';
}

export interface ConfirmationStrategy {
    requestConfirmation(request: ConfirmationRequest): Promise<boolean>;
}

/**
 * Interactive confirmation strategy - prompts user via CLI/UI
 */
export class InteractiveConfirmationStrategy implements ConfirmationStrategy {
    private pendingRequests = new Map<string, ConfirmationRequest>();
    private eventEmitter = new EventEmitter();
    
    async requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
        this.pendingRequests.set(request.id, request);
        
        // Emit event for UI/CLI to handle
        this.eventEmitter.emit('confirmationRequired', request);
        
        // Wait for response with timeout
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                request.status = 'expired';
                this.pendingRequests.delete(request.id);
                resolve(false);
            }, request.expiresAt - Date.now());
            
            const handler = (requestId: string, approved: boolean) => {
                if (requestId === request.id) {
                    clearTimeout(timeout);
                    request.status = approved ? 'approved' : 'denied';
                    this.pendingRequests.delete(request.id);
                    this.eventEmitter.off('confirmationResponse', handler);
                    resolve(approved);
                }
            };
            
            this.eventEmitter.on('confirmationResponse', handler);
        });
    }
    
    respondToConfirmation(requestId: string, approved: boolean): void {
        if (this.pendingRequests.has(requestId)) {
            this.eventEmitter.emit('confirmationResponse', requestId, approved);
        }
    }
    
    onConfirmationRequired(callback: (request: ConfirmationRequest) => void): void {
        this.eventEmitter.on('confirmationRequired', callback);
    }
}

/**
 * Policy-based confirmation strategy - uses predefined rules
 */
export class PolicyConfirmationStrategy implements ConfirmationStrategy {
    private policies: Map<string, (request: ConfirmationRequest) => boolean> = new Map();
    
    constructor() {
        this.setupDefaultPolicies();
    }
    
    async requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
        // Check if there's a specific policy for this operation type
        const policy = this.policies.get(request.type);
        if (policy) {
            const result = policy(request);
            request.status = result ? 'approved' : 'denied';
            return result;
        }
        
        // Default policy based on risk level
        switch (request.details.riskLevel) {
            case 'medium':
                // Auto-approve medium risk in development environments
                const isDev = process.env.NODE_ENV === 'development';
                request.status = isDev ? 'approved' : 'denied';
                return isDev;
            case 'high':
            case 'critical':
                // Always deny high/critical without explicit approval
                request.status = 'denied';
                return false;
            default:
                request.status = 'denied';
                return false;
        }
    }
    
    addPolicy(type: string, policy: (request: ConfirmationRequest) => boolean): void {
        this.policies.set(type, policy);
    }
    
    private setupDefaultPolicies(): void {
        // Command execution policy
        this.policies.set('command', (request) => {
            // Allow git operations
            if (request.details.command?.startsWith('git ')) {
                return true;
            }
            // Allow package manager read operations
            if (request.details.command?.match(/^(npm|yarn|pnpm)\s+(list|info|view)/)) {
                return true;
            }
            return false;
        });
        
        // File operation policy
        this.policies.set('file_operation', (request) => {
            // Allow operations within project directory
            if (request.details.path?.startsWith(process.cwd())) {
                return request.details.action !== 'delete' || request.details.riskLevel === 'medium';
            }
            return false;
        });
    }
}

/**
 * Logging confirmation strategy - logs all requests and auto-approves/denies based on config
 */
export class LoggingConfirmationStrategy implements ConfirmationStrategy {
    constructor(
        private autoApprove: boolean = false,
        private logPath?: string
    ) {}
    
    async requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
        const logEntry = {
            ...request,
            decision: this.autoApprove ? 'auto-approved' : 'auto-denied',
            timestamp: new Date().toISOString()
        };
        
        logger.warn(`Confirmation request: ${JSON.stringify(logEntry, null, 2)}`);
        
        // Log to file if path provided
        if (this.logPath) {
            // This would append to a log file
            // Implementation depends on file system integration
        }
        
        request.status = this.autoApprove ? 'approved' : 'denied';
        return this.autoApprove;
    }
}

/**
 * Main confirmation manager that coordinates different strategies
 */
export class McpConfirmationManager {
    private strategy: ConfirmationStrategy;
    private confirmationHistory: ConfirmationRequest[] = [];
    private maxHistorySize = 1000;
    
    constructor(strategy?: ConfirmationStrategy) {
        // Default to interactive strategy
        this.strategy = strategy || new InteractiveConfirmationStrategy();
    }
    
    /**
     * Request confirmation for an operation
     */
    async requestConfirmation(
        type: 'command' | 'file_operation' | 'system_change',
        operation: string,
        details: {
            command?: string;
            path?: string;
            action?: string;
            riskLevel: 'low' | 'medium' | 'high' | 'critical';
            reason: string;
        },
        context: {
            agentId: string;
            channelId: string;
            userId?: string;
        },
        timeoutMs: number = 30000
    ): Promise<boolean> {
        const request: ConfirmationRequest = {
            id: uuidv4(),
            type,
            operation,
            details,
            context,
            timestamp: Date.now(),
            expiresAt: Date.now() + timeoutMs,
            status: 'pending'
        };
        
        try {
            const result = await this.strategy.requestConfirmation(request);
            this.addToHistory(request);
            return result;
        } catch (error) {
            logger.error(`Error requesting confirmation: ${error}`);
            request.status = 'denied';
            this.addToHistory(request);
            return false;
        }
    }
    
    /**
     * Set the confirmation strategy
     */
    setStrategy(strategy: ConfirmationStrategy): void {
        this.strategy = strategy;
    }
    
    /**
     * Get confirmation history
     */
    getHistory(filter?: {
        agentId?: string;
        status?: ConfirmationRequest['status'];
        since?: number;
    }): ConfirmationRequest[] {
        return this.confirmationHistory.filter(request => {
            if (filter?.agentId && request.context.agentId !== filter.agentId) {
                return false;
            }
            if (filter?.status && request.status !== filter.status) {
                return false;
            }
            if (filter?.since && request.timestamp < filter.since) {
                return false;
            }
            return true;
        });
    }
    
    /**
     * Clear old history entries
     */
    pruneHistory(olderThanMs: number = 24 * 60 * 60 * 1000): void {
        const cutoff = Date.now() - olderThanMs;
        this.confirmationHistory = this.confirmationHistory.filter(
            request => request.timestamp > cutoff
        );
    }
    
    private addToHistory(request: ConfirmationRequest): void {
        this.confirmationHistory.push(request);
        
        // Maintain max history size
        if (this.confirmationHistory.length > this.maxHistorySize) {
            this.confirmationHistory = this.confirmationHistory.slice(-this.maxHistorySize);
        }
    }
}

/**
 * Singleton instance
 */
let confirmationManagerInstance: McpConfirmationManager | null = null;

export function getConfirmationManager(strategy?: ConfirmationStrategy): McpConfirmationManager {
    if (!confirmationManagerInstance) {
        confirmationManagerInstance = new McpConfirmationManager(strategy);
    }
    return confirmationManagerInstance;
}