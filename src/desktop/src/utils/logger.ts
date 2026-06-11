/**
 * Minimal leveled logger for the desktop webview. The framework Logger lives
 * in @mxf-dev/core (Node-oriented); the UI needs a browser-safe equivalent so
 * components do not call console.* directly.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const emit = (level: Level, scope: string, message: string, detail?: unknown): void => {
    const line = `[${new Date().toISOString()}] [${scope}] ${message}`;
    // eslint-disable-next-line no-console -- single funnel point for UI logging
    console[level === 'debug' ? 'log' : level](line, detail ?? '');
};

export const createLogger = (scope: string): Record<Level, (message: string, detail?: unknown) => void> => ({
    debug: (message: string, detail?: unknown) => emit('debug', scope, message, detail),
    info: (message: string, detail?: unknown) => emit('info', scope, message, detail),
    warn: (message: string, detail?: unknown) => emit('warn', scope, message, detail),
    error: (message: string, detail?: unknown) => emit('error', scope, message, detail),
});
