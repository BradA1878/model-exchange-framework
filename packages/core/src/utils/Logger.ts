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
 * @documentation https://mxf-dev.github.io/mxf/
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
 *
 * ## Level resolution
 *
 * Two levels are in play and BOTH are honoured — the more restrictive one wins:
 *
 * - The **target level** (`enableServerLogging('info')`, `enableClientLogging(...)`)
 *   is the application-wide ceiling. An operator who asks for `error` gets `error`.
 * - The **instance level** (`new Logger('warn', 'Foo')`, `logger.setLevel('warn')`)
 *   turns an individual component down below that ceiling.
 *
 * Effective level = min(instanceLevel, targetLevel). Before this, the target
 * level was read unconditionally and every instance level in the codebase was
 * silently discarded.
 *
 * ## Errors always surface
 *
 * `error()` output ignores the `enabled` flag. A library that swallows its own
 * errors gives consumers no way to find out something broke: the buses catch
 * handler failures and log them, so a disabled logger made those failures
 * disappear entirely. Everything below `error` still respects `enabled`.
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

// Default logging configuration.
// `enabled: false` gates info/warn/debug/trace only — errors are always written.
const LOGGING_CONFIG: LoggingConfig = {
    server: {
        enabled: false,  // Server non-error logging off by default
        level: 'debug'
    },
    client: {
        enabled: false,  // Client non-error logging off by default (TUI suppresses via disableClientLogging())
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
     *
     * @param level Log level (error, warn, info, debug, trace). Caps this
     *              component's verbosity; the target level still applies, and
     *              the more restrictive of the two wins.
     * @param context Context string to prefix log messages
     * @param target Target pathway ('server' or 'client') - defaults to 'server'
     */
    constructor(level: string, context: string = '', target: 'server' | 'client' = 'server') {
        if (Logger.LOG_LEVELS[level] === undefined) {
            throw new Error(
                `Logger: unknown log level '${level}'. Valid levels: ${Object.keys(Logger.LOG_LEVELS).join(', ')}`
            );
        }
        this.level = level;
        this.context = context;
        this.target = target;
    }

    /**
     * Resolve the level this logger actually writes at.
     *
     * The instance level and the target level are both honoured; whichever is
     * more restrictive wins. Levels are ordered error(0) → trace(4), so "more
     * restrictive" is the lower number.
     *
     * An unknown level string is a programming error and is rejected rather
     * than silently treated as "log everything".
     */
    private resolveEffectiveLevel(): number {
        const instanceRank = Logger.LOG_LEVELS[this.level];
        if (instanceRank === undefined) {
            throw new Error(
                `Logger: unknown log level '${this.level}'. Valid levels: ${Object.keys(Logger.LOG_LEVELS).join(', ')}`
            );
        }

        const targetLevel = LOGGING_CONFIG[this.target].level;
        const targetRank = Logger.LOG_LEVELS[targetLevel];
        if (targetRank === undefined) {
            throw new Error(
                `Logger: unknown log level '${targetLevel}' configured for target '${this.target}'. ` +
                `Valid levels: ${Object.keys(Logger.LOG_LEVELS).join(', ')}`
            );
        }

        return Math.min(instanceRank, targetRank);
    }

    /**
     * Internal log method
     * @param level Log level
     * @param message Message to log
     * @param args Additional arguments
     */
    private log(level: string, message: string, ...args: any[]): void {
        const isError = level === 'error';

        // Errors are always written. Everything else respects the target's
        // enabled flag, so a host app can keep its output clean without also
        // hiding failures from itself.
        if (!isError && !LOGGING_CONFIG[this.target].enabled) {
            return;
        }

        const messageRank = Logger.LOG_LEVELS[level];
        if (messageRank === undefined) {
            throw new Error(
                `Logger: unknown log level '${level}'. Valid levels: ${Object.keys(Logger.LOG_LEVELS).join(', ')}`
            );
        }

        // Errors bypass the level check too — error is rank 0, so this is only
        // belt-and-braces against a misconfigured level.
        if (!isError && messageRank > this.resolveEffectiveLevel()) {
            return;
        }

        const timestamp = new Date().toISOString();
        const targetPrefix = this.target === 'client' ? 'CLIENT' : 'SERVER';
        const prefix = this.context
            ? `[${timestamp}][${targetPrefix}][${level.toUpperCase()}][${this.context}]`
            : `[${timestamp}][${targetPrefix}][${level.toUpperCase()}]`;

        // Output to console based on level
        if (isError) {
            console.error(prefix, message, ...args);
        } else if (level === 'warn') {
            console.warn(prefix, message, ...args);
        } else if (level === 'info') {
            console.info(prefix, message, ...args);
        } else {
            console.log(prefix, message, ...args);
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
     * Set the log level for this instance.
     * Caps this component's verbosity; the target level still applies.
     *
     * @param level New log level (error, warn, info, debug, trace)
     */
    public setLevel(level: string): void {
        if (Logger.LOG_LEVELS[level] === undefined) {
            throw new Error(
                `Logger: unknown log level '${level}'. Valid levels: ${Object.keys(Logger.LOG_LEVELS).join(', ')}`
            );
        }
        this.level = level;
    }

    /**
     * Get the log level configured for this instance.
     */
    public getLevel(): string {
        return this.level;
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
