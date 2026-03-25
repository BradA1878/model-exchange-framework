/**
 * MXF CLI Run Command
 *
 * One-shot task execution: creates a single Planner agent, submits a task,
 * streams output, and exits on completion. This is Phase 1 of the MXF CLI.
 *
 * Usage:
 *   mxf run "What is 2 + 2?"
 *   mxf run "Summarize this file" --context src/index.ts
 *   mxf run "Find bugs" --context ./src --format json
 *   mxf run "Quick question" --model anthropic/claude-haiku-3.5-20241022
 *   mxf run "Long task" --timeout 600
 *
 * Supports pipe and redirect:
 *   mxf run "List colors" | head -5
 *   mxf run "Write a haiku" > haiku.txt
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { ConfigService } from '../services/ConfigService';
import { HealthChecker } from '../services/HealthChecker';
import { SessionRunner } from '../services/SessionRunner';
import { buildContextString } from '../utils/context';
import { logError, logInfo, logHeader, logSection, logSuccess } from '../utils/output';

/**
 * Register the `mxf run` command with the CLI program.
 *
 * Handles argument parsing, pre-flight validation (config, server health),
 * context loading, and delegates execution to SessionRunner.
 */
export function registerRunCommand(program: Command): void {
    program
        .command('run')
        .description('Execute a one-shot task with a Planner agent')
        .argument('<task>', 'Task description (use quotes for multi-word tasks)')
        .option('--context <path>', 'File or directory to include as context')
        .option('--format <format>', 'Output format: text, json, md', 'text')
        .option('--model <model>', 'Override the default LLM model')
        .option('--timeout <seconds>', 'Task timeout in seconds', '300')
        .action(async (task: string, options: {
            context?: string;
            format?: string;
            model?: string;
            timeout?: string;
        }) => {
            try {
                await executeRun(task, options);
            } catch (error: any) {
                logError(`Run failed: ${error.message || error}`);
                process.exit(1);
            }
        });
}

/**
 * Execute the mxf run command.
 *
 * Pre-flight checks:
 * 1. Config exists and is valid
 * 2. User has an access token (mxf install --complete-setup)
 * 3. LLM provider is configured (mxf init)
 * 4. MXF server is running
 * 5. Context path is valid (if provided)
 */
async function executeRun(task: string, options: {
    context?: string;
    format?: string;
    model?: string;
    timeout?: string;
}): Promise<void> {
    const isTTY = process.stdout.isTTY === true;
    const format = validateFormat(options.format || 'text');
    const timeoutSeconds = parseInt(options.timeout || '300', 10);

    if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
        logError('Invalid timeout value. Must be a positive number of seconds.');
        process.exit(1);
    }

    // Pre-flight 1: Load config
    const configService = ConfigService.getInstance();
    const config = configService.load();

    if (!config) {
        logError('No MXF configuration found.');
        logInfo('Run `mxf install` to set up MXF infrastructure first.');
        process.exit(1);
    }

    // Pre-flight 2: Check user access token
    if (!config.user?.accessToken) {
        logError('No user access token found.');
        logInfo('Run `mxf install --complete-setup` to create a user and generate an access token.');
        process.exit(1);
    }

    // Pre-flight 3: Check LLM configuration
    if (!config.llm?.provider || !config.llm?.apiKey) {
        logError('LLM provider not configured.');
        logInfo('Run `mxf init` to configure your LLM provider and API key.');
        process.exit(1);
    }

    // Pre-flight 4: Check server is running
    const serverUrl = `http://${config.server.host}:${config.server.port}`;
    const serverRunning = await HealthChecker.getInstance().isServerRunning(serverUrl);

    if (!serverRunning) {
        logError('MXF server is not running.');
        logInfo('Start the server with: bun run dev');
        process.exit(1);
    }

    // Pre-flight 5: Build context (if provided)
    let contextString: string | undefined;

    if (options.context) {
        try {
            contextString = buildContextString(options.context);
        } catch (error: any) {
            logError(`Failed to read context: ${error.message}`);
            process.exit(1);
        }
    }

    // Show header (TTY only, not in JSON mode)
    if (isTTY && format !== 'json') {
        logHeader('MXF Run');
        logInfo(`Task: ${task}`);
        if (options.context) {
            logInfo(`Context: ${options.context}`);
        }
        if (options.model) {
            logInfo(`Model: ${options.model}`);
        }
        console.log('');
    }

    // Create and execute session
    const runner = new SessionRunner({
        serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY || config.credentials.domainKey,
        accessToken: config.user.accessToken,
        llmProvider: config.llm.provider,
        apiKey: config.llm.apiKey,
        defaultModel: options.model || config.llm.defaultModel,
        task,
        contextString,
        format,
        timeoutMs: timeoutSeconds * 1000,
        isTTY,
    });

    const result = await runner.run();

    // Output final result based on format
    if (format === 'json') {
        // JSON mode: structured output to stdout
        const jsonOutput = {
            success: result.success,
            output: result.output,
            toolCalls: result.toolCalls,
            elapsedMs: result.elapsedMs,
            error: result.error || undefined,
        };
        process.stdout.write(JSON.stringify(jsonOutput, null, 2) + '\n');
    } else if (isTTY) {
        // TTY text/md mode: show summary
        console.log('');
        if (result.success) {
            logSection('Result');
            if (result.output) {
                console.log(result.output);
            }
            const elapsedStr = formatElapsed(result.elapsedMs);
            const toolCount = result.toolCalls.length;
            logSuccess(`Complete — ${toolCount} tool call${toolCount !== 1 ? 's' : ''}, ${elapsedStr}`);
        } else {
            logError(`Failed: ${result.error || 'Unknown error'}`);
        }
    }
    // Non-TTY text/md: output already printed via agent messages, nothing more to add

    if (!result.success) {
        process.exit(1);
    }
}

/**
 * Validate the --format option.
 */
function validateFormat(format: string): 'text' | 'json' | 'md' {
    const valid = ['text', 'json', 'md'];
    if (!valid.includes(format)) {
        logError(`Invalid format: "${format}". Must be one of: ${valid.join(', ')}`);
        process.exit(1);
    }
    return format as 'text' | 'json' | 'md';
}

/**
 * Format elapsed time as a human-readable string.
 */
function formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}
