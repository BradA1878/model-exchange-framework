/**
 * MXF CLI Terminal Output Utilities
 *
 * Provides consistent, colored terminal output for all CLI commands.
 * Uses chalk v5 (ESM) which is a project dependency.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import chalk from 'chalk';

/** Print a success message with green checkmark */
export const logSuccess = (message: string): void => {
    console.log(`${chalk.green('✓')} ${message}`);
};

/** Print an error message with red cross to stderr */
export const logError = (message: string): void => {
    console.error(`${chalk.red('✗')} ${message}`);
};

/** Print an info message with cyan indicator */
export const logInfo = (message: string): void => {
    console.log(`${chalk.cyan('ℹ')} ${message}`);
};

/** Print a warning message with yellow indicator */
export const logWarning = (message: string): void => {
    console.log(`${chalk.yellow('⚠')} ${message}`);
};

/** Print a section header with horizontal rules */
export const logHeader = (title: string): void => {
    const line = '═'.repeat(60);
    console.log('');
    console.log(line);
    console.log(title);
    console.log(line);
    console.log('');
};

/** Print a subsection header */
export const logSection = (title: string): void => {
    console.log('');
    console.log(chalk.bold(title));
    console.log('─'.repeat(40));
};

/** Print a key-value pair with aligned formatting */
export const logKeyValue = (key: string, value: string, indent: number = 2): void => {
    const pad = ' '.repeat(indent);
    const keyFormatted = chalk.dim(`${key}:`);
    console.log(`${pad}${keyFormatted.padEnd(30 + indent)} ${value}`);
};

/**
 * Mask a secret string for display, showing only the first 8 characters.
 * Returns 'not set' if the value is empty or undefined.
 */
export const maskSecret = (value: string | undefined): string => {
    if (!value) return chalk.dim('not set');
    if (value.length <= 8) return '••••••••';
    return value.substring(0, 8) + chalk.dim('••••••••');
};

/** Print a status indicator with colored dot */
export const logStatus = (label: string, status: 'running' | 'stopped' | 'error' | 'unknown', detail?: string): void => {
    const dots: Record<string, string> = {
        running: chalk.green('●'),
        stopped: chalk.dim('○'),
        error: chalk.red('×'),
        unknown: chalk.yellow('?'),
    };
    const dot = dots[status] || dots.unknown;
    const detailStr = detail ? chalk.dim(` (${detail})`) : '';
    console.log(`    ${dot} ${label}${detailStr}`);
};

/** Print a step indicator for multi-step operations */
export const logStep = (step: number, total: number, message: string): void => {
    const stepStr = chalk.dim(`[${step}/${total}]`);
    console.log(`${stepStr} ${message}`);
};
