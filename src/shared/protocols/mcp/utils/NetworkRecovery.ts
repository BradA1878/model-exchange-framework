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
 * Network Recovery Utility
 * 
 * Shared utilities for network recovery, retry logic, and circuit breaker patterns.
 * Extracted from OpenRouterMcpClient to be reusable across all providers.
 */

import {
    NetworkRecoveryConfig,
    NetworkErrorType,
    NetworkErrorInfo,
    CircuitBreakerState,
    CircuitBreakerStatus,
    RetryAttempt,
    NetworkOperationResult,
    classifyNetworkError,
    isRetryableError,
    calculateRetryDelay,
    formatNetworkError
} from '../../../types/NetworkRecoveryTypes';
import { Logger } from '../../../utils/Logger';

/**
 * Network Recovery Manager
 * Handles retry logic, circuit breaker, and error classification
 */
export class NetworkRecoveryManager {
    private circuitBreakerStatus: CircuitBreakerStatus;
    private logger: Logger;
    
    constructor(
        private config: NetworkRecoveryConfig,
        loggerContext: string
    ) {
        this.circuitBreakerStatus = {
            state: CircuitBreakerState.CLOSED,
            failureCount: 0,
            successCount: 0,
            totalRequests: 0
        };
        this.logger = new Logger('debug', loggerContext, 'client');
    }
    
    /**
     * Check if circuit breaker allows the request
     * 
     * @returns True if request is allowed
     */
    checkCircuitBreaker(): boolean {
        const now = new Date();
        
        switch (this.circuitBreakerStatus.state) {
            case CircuitBreakerState.OPEN:
                // Check if cooldown period has passed
                if (this.circuitBreakerStatus.nextRetryTime && now >= this.circuitBreakerStatus.nextRetryTime) {
                    this.circuitBreakerStatus.state = CircuitBreakerState.HALF_OPEN;
                    this.circuitBreakerStatus.failureCount = 0;
                    return true; // Allow request in half-open state
                }
                return false; // Block request
                
            case CircuitBreakerState.HALF_OPEN:
                return true; // Allow limited requests
                
            case CircuitBreakerState.CLOSED:
            default:
                return true; // Allow all requests
        }
    }
    
    /**
     * Record a successful request
     */
    recordSuccess(): void {
        this.circuitBreakerStatus.successCount++;
        this.circuitBreakerStatus.totalRequests++;
        
        if (this.circuitBreakerStatus.state === CircuitBreakerState.HALF_OPEN) {
            this.circuitBreakerStatus.state = CircuitBreakerState.CLOSED;
            this.circuitBreakerStatus.failureCount = 0;
        }
    }
    
    /**
     * Record a failed request
     */
    recordFailure(): void {
        this.circuitBreakerStatus.failureCount++;
        this.circuitBreakerStatus.totalRequests++;
        this.circuitBreakerStatus.lastFailureTime = new Date();
        
        if (this.circuitBreakerStatus.failureCount >= this.config.circuitBreakerThreshold) {
            if (this.circuitBreakerStatus.state !== CircuitBreakerState.OPEN) {
                this.logger.warn(`Circuit breaker opening after ${this.circuitBreakerStatus.failureCount} failures`);
                this.circuitBreakerStatus.state = CircuitBreakerState.OPEN;
                this.circuitBreakerStatus.nextRetryTime = new Date(
                    Date.now() + this.config.circuitBreakerCooldownMs
                );
            }
        }
    }
    
    /**
     * Execute an operation with retry logic and circuit breaker
     * 
     * @param operation - Async operation to execute
     * @param extractStatusCode - Function to extract HTTP status code from error
     * @returns Network operation result
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        extractStatusCode?: (error: any) => number | undefined
    ): Promise<NetworkOperationResult<T>> {
        const retryAttempts: RetryAttempt[] = [];
        let lastError: NetworkErrorInfo | undefined;
        
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            // Check circuit breaker
            if (!this.checkCircuitBreaker()) {
                const errorInfo: NetworkErrorInfo = {
                    type: NetworkErrorType.API_SERVICE_UNAVAILABLE,
                    message: `Circuit breaker is OPEN. Service temporarily unavailable. Next retry at ${this.circuitBreakerStatus.nextRetryTime?.toISOString()}`,
                    timestamp: new Date()
                };
                
                if (this.config.enableDetailedLogging) {
                    this.logger.error(formatNetworkError(errorInfo));
                }
                
                return {
                    success: false,
                    error: errorInfo,
                    circuitBreakerTriggered: true
                };
            }
            
            try {
                // Execute the operation
                const result = await operation();
                
                // Success! Record it and return
                this.recordSuccess();
                
                if (retryAttempts.length > 0) {
                }
                
                return {
                    success: true,
                    data: result,
                    retryAttempts
                };
                
            } catch (error) {
                // Classify the error
                const statusCode = extractStatusCode ? extractStatusCode(error) : undefined;
                const errorType = classifyNetworkError(error, statusCode);
                
                lastError = {
                    type: errorType,
                    statusCode,
                    message: error instanceof Error ? error.message : String(error),
                    originalError: error instanceof Error ? error : undefined,
                    timestamp: new Date(),
                    retryCount: attempt,
                    maxRetries: this.config.maxRetries
                };
                
                // Record failure for circuit breaker
                this.recordFailure();
                
                // Log the error with appropriate detail
                if (this.config.enableDetailedLogging) {
                    this.logger.error(formatNetworkError(lastError, attempt === 1));
                }
                
                // Check if error is retryable
                if (!isRetryableError(errorType) || attempt >= this.config.maxRetries) {
                    // Non-retryable error or max retries reached
                    return {
                        success: false,
                        error: lastError,
                        retryAttempts
                    };
                }
                
                // Calculate retry delay
                const delayMs = calculateRetryDelay(attempt, this.config);
                
                retryAttempts.push({
                    attemptNumber: attempt,
                    delayMs,
                    errorType,
                    timestamp: new Date()
                });
                
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        
        // Should not reach here, but return error if we do
        return {
            success: false,
            error: lastError || {
                type: NetworkErrorType.UNKNOWN_ERROR,
                message: 'Maximum retries exceeded',
                timestamp: new Date()
            },
            retryAttempts
        };
    }
    
    /**
     * Get current circuit breaker status
     * 
     * @returns Circuit breaker status
     */
    getStatus(): CircuitBreakerStatus {
        return { ...this.circuitBreakerStatus };
    }
    
    /**
     * Reset circuit breaker to closed state
     */
    reset(): void {
        this.circuitBreakerStatus = {
            state: CircuitBreakerState.CLOSED,
            failureCount: 0,
            successCount: 0,
            totalRequests: 0
        };
    }
}

/**
 * Default status code extractor for fetch responses
 * 
 * @param error - Error object
 * @returns HTTP status code or undefined
 */
export const extractStatusCodeFromError = (error: any): number | undefined => {
    // Try to extract status code from various error formats
    if (error?.status) return error.status;
    if (error?.statusCode) return error.statusCode;
    if (error?.response?.status) return error.response.status;
    
    // Try to parse from error message
    const match = error?.message?.match(/\[(\d{3})\]|status[:\s]+(\d{3})/i);
    if (match) {
        return parseInt(match[1] || match[2]);
    }
    
    return undefined;
};
