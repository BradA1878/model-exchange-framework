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
 * Network Recovery Types
 * 
 * Type definitions for network error handling, retry logic,
 * circuit breaker patterns, and graceful degradation strategies.
 */

/**
 * Classification of network and API errors for proper handling strategies
 */
export enum NetworkErrorType {
    // Network connectivity issues
    NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
    NETWORK_CONNECTION_REFUSED = 'NETWORK_CONNECTION_REFUSED',
    NETWORK_DNS_RESOLUTION = 'NETWORK_DNS_RESOLUTION',
    NETWORK_SOCKET_ERROR = 'NETWORK_SOCKET_ERROR',
    
    // API service issues
    API_BAD_GATEWAY = 'API_BAD_GATEWAY',              // 502
    API_SERVICE_UNAVAILABLE = 'API_SERVICE_UNAVAILABLE', // 503
    API_GATEWAY_TIMEOUT = 'API_GATEWAY_TIMEOUT',      // 504
    API_INTERNAL_ERROR = 'API_INTERNAL_ERROR',        // 500
    
    // Authentication and authorization
    AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',          // 401
    AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',                // 403
    
    // Rate limiting
    RATE_LIMITED = 'RATE_LIMITED',                    // 429
    
    // Client errors
    CLIENT_BAD_REQUEST = 'CLIENT_BAD_REQUEST',        // 400
    CLIENT_UNPROCESSABLE = 'CLIENT_UNPROCESSABLE',    // 422
    CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',            // 404
    
    // Other errors
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Determines if an error is retryable based on its type
 */
export function isRetryableError(errorType: NetworkErrorType): boolean {
    const retryableTypes = [
        NetworkErrorType.NETWORK_TIMEOUT,
        NetworkErrorType.NETWORK_CONNECTION_REFUSED,
        NetworkErrorType.NETWORK_DNS_RESOLUTION,
        NetworkErrorType.NETWORK_SOCKET_ERROR,
        NetworkErrorType.API_BAD_GATEWAY,
        NetworkErrorType.API_SERVICE_UNAVAILABLE,
        NetworkErrorType.API_GATEWAY_TIMEOUT,
        NetworkErrorType.API_INTERNAL_ERROR,
        NetworkErrorType.RATE_LIMITED
    ];
    
    return retryableTypes.includes(errorType);
}

/**
 * Network recovery configuration options
 */
export interface NetworkRecoveryConfig {
    // Retry configuration
    maxRetries: number;                    // Maximum retry attempts (default: 3)
    baseDelayMs: number;                   // Initial retry delay (default: 1000ms)
    maxDelayMs: number;                    // Maximum retry delay (default: 30000ms)
    retryMultiplier: number;               // Exponential backoff multiplier (default: 2)
    
    // Circuit breaker configuration
    circuitBreakerThreshold: number;       // Consecutive failures to open circuit (default: 5)
    circuitBreakerCooldownMs: number;      // Time to wait before retrying (default: 60000ms)
    circuitBreakerHalfOpenRequests: number; // Requests to try in half-open state (default: 1)
    
    // Timeout configuration
    requestTimeoutMs: number;              // Individual request timeout (default: 30000ms)
    
    // Graceful degradation
    enableGracefulDegradation: boolean;    // Enable fallback responses (default: true)
    enableDetailedLogging: boolean;        // Log detailed error context (default: true)
}

/**
 * Default network recovery configuration
 */
export const DEFAULT_NETWORK_RECOVERY_CONFIG: NetworkRecoveryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryMultiplier: 2,
    circuitBreakerThreshold: 5,
    circuitBreakerCooldownMs: 60000,
    circuitBreakerHalfOpenRequests: 1,
    requestTimeoutMs: 30000,
    enableGracefulDegradation: true,
    enableDetailedLogging: true
};

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
    CLOSED = 'CLOSED',       // Normal operation
    OPEN = 'OPEN',           // Blocking requests
    HALF_OPEN = 'HALF_OPEN'  // Testing recovery
}

/**
 * Circuit breaker status information
 */
export interface CircuitBreakerStatus {
    state: CircuitBreakerState;
    failureCount: number;
    lastFailureTime?: Date;
    nextRetryTime?: Date;
    successCount: number;
    totalRequests: number;
}

/**
 * Enhanced error information for better debugging
 */
export interface NetworkErrorInfo {
    type: NetworkErrorType;
    statusCode?: number;
    message: string;
    originalError?: Error;
    timestamp: Date;
    retryCount?: number;
    maxRetries?: number;
    context?: Record<string, any>;
}

/**
 * Retry attempt information
 */
export interface RetryAttempt {
    attemptNumber: number;
    delayMs: number;
    errorType: NetworkErrorType;
    timestamp: Date;
}

/**
 * Result of a network operation with recovery
 */
export interface NetworkOperationResult<T> {
    success: boolean;
    data?: T;
    error?: NetworkErrorInfo;
    retryAttempts?: RetryAttempt[];
    circuitBreakerTriggered?: boolean;
    fallbackUsed?: boolean;
}

/**
 * Classifies an error based on status code and error details
 */
export function classifyNetworkError(
    error: any, 
    statusCode?: number
): NetworkErrorType {
    // Check for specific status codes first
    if (statusCode) {
        switch (statusCode) {
            case 400:
                return NetworkErrorType.CLIENT_BAD_REQUEST;
            case 401:
                return NetworkErrorType.AUTH_UNAUTHORIZED;
            case 403:
                return NetworkErrorType.AUTH_FORBIDDEN;
            case 404:
                return NetworkErrorType.CLIENT_NOT_FOUND;
            case 422:
                return NetworkErrorType.CLIENT_UNPROCESSABLE;
            case 429:
                return NetworkErrorType.RATE_LIMITED;
            case 500:
                return NetworkErrorType.API_INTERNAL_ERROR;
            case 502:
                return NetworkErrorType.API_BAD_GATEWAY;
            case 503:
                return NetworkErrorType.API_SERVICE_UNAVAILABLE;
            case 504:
                return NetworkErrorType.API_GATEWAY_TIMEOUT;
        }
    }
    
    // Check error message for network issues
    const errorMessage = error?.message?.toLowerCase() || '';
    
    if (errorMessage.includes('timeout')) {
        return NetworkErrorType.NETWORK_TIMEOUT;
    }
    if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
        return NetworkErrorType.NETWORK_CONNECTION_REFUSED;
    }
    if (errorMessage.includes('enotfound') || errorMessage.includes('dns')) {
        return NetworkErrorType.NETWORK_DNS_RESOLUTION;
    }
    if (errorMessage.includes('socket') || errorMessage.includes('econnreset')) {
        return NetworkErrorType.NETWORK_SOCKET_ERROR;
    }
    if (errorMessage.includes('fetch failed')) {
        // Generic fetch failed could be various network issues
        return NetworkErrorType.NETWORK_CONNECTION_REFUSED;
    }
    
    return NetworkErrorType.UNKNOWN_ERROR;
}

/**
 * Calculates retry delay with exponential backoff and jitter
 */
export function calculateRetryDelay(
    attemptNumber: number,
    config: NetworkRecoveryConfig
): number {
    const exponentialDelay = config.baseDelayMs * Math.pow(config.retryMultiplier, attemptNumber - 1);
    const clampedDelay = Math.min(exponentialDelay, config.maxDelayMs);
    
    // Add jitter (±20%) to prevent thundering herd
    const jitter = clampedDelay * 0.2 * (Math.random() - 0.5);
    
    return Math.round(clampedDelay + jitter);
}

/**
 * Formats an error for logging with appropriate detail level
 */
export function formatNetworkError(
    error: NetworkErrorInfo,
    includeStack: boolean = false
): string {
    const parts = [
        `[${error.type}]`,
        error.statusCode ? `Status ${error.statusCode}` : '',
        error.message,
        error.retryCount ? `(Retry ${error.retryCount}/${error.maxRetries})` : ''
    ].filter(Boolean);
    
    let formatted = parts.join(' ');
    
    if (includeStack && error.originalError?.stack) {
        formatted += '\n' + error.originalError.stack;
    }
    
    return formatted;
}