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
 * Unified Logger for the Model Exchange Framework
 * 
 * Provides a consistent logging interface for both server and SDK components.
 * Features:
 * - Configurable log levels
 * - Context tagging
 * - Timestamp formatting
 * - Separate client/server logging pathways
 * 
 * This follows DRY principles by providing a single logging implementation
 * for the entire framework.
 */

// Global logging configuration
interface LoggingConfig {
    server: {
        enabled: boolean;
        level: string;
    };
    client: {
        enabled: boolean;
        level: string;
    };
}

// Default logging configuration
const LOGGING_CONFIG: LoggingConfig = {
    server: {
        enabled: false,  // Server logging disabled by default
        level: 'debug'
    },
    client: {
        enabled: false, // Client logging disabled by default to keep demos clean
        level: 'debug'
    }
};

// Allow runtime configuration
export const configureLogging = (config: Partial<LoggingConfig>): void => {
    if (config.server) {
        Object.assign(LOGGING_CONFIG.server, config.server);
    }
    if (config.client) {
        Object.assign(LOGGING_CONFIG.client, config.client);
    }
};

// Convenience functions for common configurations
export const enableClientLogging = (level: string = 'debug'): void => {
    LOGGING_CONFIG.client.enabled = true;
    LOGGING_CONFIG.client.level = level;
};

export const disableClientLogging = (): void => {
    LOGGING_CONFIG.client.enabled = false;
};

export const enableServerLogging = (level: string = 'debug'): void => {
    LOGGING_CONFIG.server.enabled = true;
    LOGGING_CONFIG.server.level = level;
};

export const disableServerLogging = (): void => {
    LOGGING_CONFIG.server.enabled = false;
};

/**
 * Enhanced Logger class that ensures logs are consistently output
 * with context, timestamps, and proper visibility levels
 */
export class Logger {
    private level: string;
    private context: string;
    private target: 'server' | 'client';
    private static LOG_LEVELS: Record<string, number> = {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        trace: 4
    };

    /**
     * Create a new Logger
     * @param level Log level (error, warn, info, debug, trace)
     * @param context Context string to prefix log messages
     * @param target Target pathway ('server' or 'client') - defaults to 'server'
     */
    constructor(level: string, context: string = '', target: 'server' | 'client' = 'server') {
        this.level = level;
        this.context = context;
        this.target = target;
    }

    /**
     * Internal log method
     * @param level Log level
     * @param message Message to log
     * @param args Additional arguments
     */
    private log(level: string, message: string, ...args: any[]): void {
        // Get target-specific configuration
        const targetConfig = LOGGING_CONFIG[this.target];
        
        // Check if logging is enabled for this target
        if (!targetConfig.enabled) {
            return;
        }
        
        // Use target-specific level if different from instance level
        const effectiveLevel = targetConfig.level || this.level;
        
        // Only log if the level is sufficient
        if (Logger.LOG_LEVELS[level] <= Logger.LOG_LEVELS[effectiveLevel]) {
            const timestamp = new Date().toISOString();
            const targetPrefix = this.target === 'client' ? 'CLIENT' : 'SERVER';
            const prefix = this.context 
                ? `[${timestamp}][${targetPrefix}][${level.toUpperCase()}][${this.context}]` 
                : `[${timestamp}][${targetPrefix}][${level.toUpperCase()}]`;
            
            // Output to console based on level
            if (level === 'error') {
                console.error(prefix, message, ...args);
            } else if (level === 'warn') {
                console.warn(prefix, message, ...args);
            } else if (level === 'info') {
                console.info(prefix, message, ...args);
            } else {
                console.log(prefix, message, ...args);
            }
            
            // Force flush stdout if in Node.js environment to ensure logs appear immediately
            if (typeof process !== 'undefined' && process.stdout && process.stdout.write) {
                process.stdout.write('');
            }
        }
    }

    /**
     * Log an error message
     * @param message Message to log
     * @param args Additional arguments
     */
    public error(message: string, ...args: any[]): void {
        this.log('error', `\x1b[31m${message}\x1b[0m`, ...args);
    }

    /**
     * Log a warning message
     * @param message Message to log
     * @param args Additional arguments
     */
    public warn(message: string, ...args: any[]): void {
        this.log('warn', `\x1b[33m${message}\x1b[0m`, ...args);
    }

    /**
     * Log an info message
     * @param message Message to log
     * @param args Additional arguments
     */
    public info(message: string, ...args: any[]): void {
        this.log('info', message, ...args);
    }

    /**
     * Log a debug message
     * @param message Message to log
     * @param args Additional arguments
     */
    public debug(message: string, ...args: any[]): void {
        this.log('debug', `\x1b[34m${message}\x1b[0m`, ...args);
    }

    /**
     * Log a trace message
     * @param message Message to log
     * @param args Additional arguments
     */
    public trace(message: string, ...args: any[]): void {
        this.log('trace', message, ...args);
    }

    /**
     * Set the log level
     * @param level New log level
     */
    public setLevel(level: string): void {
        this.level = level;
    }

    /**
     * Get a child logger with a sub-context
     * @param subContext Sub-context to add
     * @returns New logger with combined context
     */
    public child(subContext: string): Logger {
        const combinedContext = this.context ? `${this.context}:${subContext}` : subContext;
        return new Logger(this.level, combinedContext, this.target);
    }
}

/**
 * Create a singleton default logger instance
 */
export const logger = new Logger('info', '', 'server');

/**
 * Create a logger with tags (convenience function for backward compatibility)
 * 
 * @param tags Tags to include
 * @returns Logger with tags
 */
export const loggerWithTags = (...tags: string[]): Logger => {
    return logger.child(tags.join(','));
};

// Default export for convenient importing
export default logger;
