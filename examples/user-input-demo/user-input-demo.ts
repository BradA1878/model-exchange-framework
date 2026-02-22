/**
 * User Input Demo (Interactive Project Setup Wizard)
 *
 * Demonstrates the user_input MCP tool system end-to-end:
 * - Agent LLM → server → Socket.IO → SDK → terminal prompt → response back
 *
 * An LLM agent guides the user through configuring a new software project,
 * asking 7 questions that exercise all 4 input types (text, select, multi_select,
 * confirm), both blocking and async modes, multiple urgency/theme combinations,
 * and a timeout test.
 *
 * @prerequisites
 * - MXF server running (`bun run start:dev`)
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * cd examples/user-input-demo
 * cp .env.example .env
 * bun run demo:user-input
 * ```
 *
 * Run with: bun run demo:user-input
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import type {
    UserInputRequestData, UserInputResponseValue,
    TextInputConfig, SelectInputConfig, MultiSelectInputConfig, ConfirmInputConfig
} from '../../src/sdk/index';
import prompts from 'prompts';
import dotenv from 'dotenv';

dotenv.config();

// CJS import for chalk (matches StoryLogger.ts pattern)
const chalk = require('chalk');

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `user-input-demo-${timestamp}`
};

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Display styled demo banner explaining what the demo demonstrates
 */
const displayBanner = (): void => {
    console.log('\n' + chalk.cyan('═'.repeat(80)));
    console.log(chalk.cyan.bold('  USER INPUT DEMO — Interactive Project Setup Wizard'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log('');
    console.log('  This demo exercises the user_input MCP tool system end-to-end:');
    console.log('  Agent LLM → Server → Socket.IO → SDK → Terminal Prompt → Response');
    console.log('');
    console.log(chalk.yellow('  7 Steps covering all input types and modes:'));
    console.log('');
    console.log(`  ${chalk.green('Step 1')} [text]         Project name       ${chalk.dim('blocking, info, normal')}`);
    console.log(`  ${chalk.green('Step 2')} [select]       Framework choice   ${chalk.dim('blocking, default, high')}`);
    console.log(`  ${chalk.green('Step 3')} [multi_select] Feature selection   ${chalk.dim('blocking, success, normal')}`);
    console.log(`  ${chalk.green('Step 4')} [confirm]      Auto-deploy?       ${chalk.dim('blocking, warning, critical')}`);
    console.log(`  ${chalk.green('Step 5')} [text]         Description        ${chalk.dim('async mode (poll), info, low')}`);
    console.log(`  ${chalk.green('Step 6')} [select]       License choice     ${chalk.dim('blocking, default, low')}`);
    console.log(`  ${chalk.green('Step 7')} [text]         Favorite color     ${chalk.dim('blocking, error, high — 10s timeout')}`);
    console.log('');
    console.log(chalk.dim('  Watch for: User Input Requests, [Agent Message], [Task Completed]'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log('');
};

/**
 * Format urgency level with color coding
 */
const formatUrgency = (urgency?: string): string => {
    switch (urgency) {
        case 'critical': return chalk.red.bold(`[${urgency}]`);
        case 'high': return chalk.yellow.bold(`[${urgency}]`);
        case 'normal': return chalk.blue(`[${urgency}]`);
        case 'low': return chalk.dim(`[${urgency}]`);
        default: return chalk.dim('[normal]');
    }
};

/**
 * Format theme with color coding
 */
const formatTheme = (theme?: string): string => {
    switch (theme) {
        case 'error': return chalk.red(`(${theme})`);
        case 'warning': return chalk.yellow(`(${theme})`);
        case 'success': return chalk.green(`(${theme})`);
        case 'info': return chalk.cyan(`(${theme})`);
        default: return chalk.dim('(default)');
    }
};

// ============================================================================
// User Input Handler
// ============================================================================

/**
 * Collected user answers keyed by question title.
 * Populated by the user input handler for display in the final report.
 */
const collectedAnswers: Array<{ title: string; inputType: string; value: UserInputResponseValue }> = [];

/**
 * Build the user input handler that maps inputType to prompts library calls.
 * Returns a function matching (request: UserInputRequestData) => Promise<UserInputResponseValue>.
 *
 * Renders a styled header before each prompt showing input type, urgency, theme, and request ID.
 * Logs response timing after the user answers and records the answer for the final report.
 */
const buildUserInputHandler = (): (request: UserInputRequestData) => Promise<UserInputResponseValue> => {
    return async (request: UserInputRequestData): Promise<UserInputResponseValue> => {
        const startTime = Date.now();

        // Display styled prompt header
        console.log('');
        console.log(chalk.cyan('┌' + '─'.repeat(70)));
        console.log(chalk.cyan('│') + ` ${chalk.bold('User Input Request')}  ${formatUrgency(request.urgency)}  ${formatTheme(request.theme)}`);
        console.log(chalk.cyan('│') + ` Type: ${chalk.yellow(request.inputType)}  ID: ${chalk.dim(request.requestId)}`);
        if (request.description) {
            console.log(chalk.cyan('│') + ` ${chalk.dim(request.description)}`);
        }
        if (request.timeoutMs) {
            console.log(chalk.cyan('│') + ` ${chalk.red(`Timeout: ${request.timeoutMs / 1000}s`)}`);
        }
        console.log(chalk.cyan('└' + '─'.repeat(70)));

        let result: UserInputResponseValue;

        switch (request.inputType) {
            case 'text': {
                const textConfig = request.inputConfig as TextInputConfig;
                const response = await prompts({
                    type: 'text',
                    name: 'value',
                    message: request.title,
                    validate: (value: string) => {
                        if (textConfig.minLength && value.length < textConfig.minLength) {
                            return `Minimum ${textConfig.minLength} characters required`;
                        }
                        if (textConfig.maxLength && value.length > textConfig.maxLength) {
                            return `Maximum ${textConfig.maxLength} characters allowed`;
                        }
                        return true;
                    }
                });
                // prompts returns undefined on Ctrl+C
                if (response.value === undefined) {
                    throw new Error('User cancelled the prompt');
                }
                result = response.value;
                break;
            }

            case 'select': {
                const selectConfig = request.inputConfig as SelectInputConfig;
                const response = await prompts({
                    type: 'select',
                    name: 'value',
                    message: request.title,
                    choices: selectConfig.options.map(opt => ({
                        title: opt.label,
                        value: opt.value,
                        description: opt.description
                    }))
                });
                if (response.value === undefined) {
                    throw new Error('User cancelled the prompt');
                }
                result = response.value;
                break;
            }

            case 'multi_select': {
                const multiConfig = request.inputConfig as MultiSelectInputConfig;
                const response = await prompts({
                    type: 'multiselect',
                    name: 'value',
                    message: request.title,
                    choices: multiConfig.options.map(opt => ({
                        title: opt.label,
                        value: opt.value,
                        description: opt.description
                    })),
                    min: multiConfig.minSelections,
                    max: multiConfig.maxSelections
                });
                if (response.value === undefined) {
                    throw new Error('User cancelled the prompt');
                }
                result = response.value;
                break;
            }

            case 'confirm': {
                const confirmConfig = request.inputConfig as ConfirmInputConfig;
                const message = confirmConfig.confirmLabel && confirmConfig.denyLabel
                    ? `${request.title} (${confirmConfig.confirmLabel}/${confirmConfig.denyLabel})`
                    : request.title;
                const response = await prompts({
                    type: 'confirm',
                    name: 'value',
                    message
                });
                if (response.value === undefined) {
                    throw new Error('User cancelled the prompt');
                }
                result = response.value;
                break;
            }

            default:
                throw new Error(`Unknown input type: ${request.inputType}`);
        }

        const elapsed = Date.now() - startTime;
        console.log(chalk.green(`  ✓ Response: ${JSON.stringify(result)} (${elapsed}ms)`));

        // Record the answer for the final report
        collectedAnswers.push({ title: request.title, inputType: request.inputType, value: result });

        return result;
    };
};

// ============================================================================
// Event Monitoring
// ============================================================================

/**
 * Setup channel monitoring for observing tool calls, results, agent messages,
 * and task completion. Returns a promise that resolves when the task completes.
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        let taskCompleted = false;

        // Listen for agent messages
        channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
            try {
                const messageId = payload.data?.metadata?.messageId ||
                    `${payload.agentId}-${payload.timestamp || Date.now()}`;

                if (processedIds.has(messageId)) return;
                processedIds.add(messageId);
                setTimeout(() => processedIds.delete(messageId), 5000);

                let content = payload.data?.content || payload.data?.message || '';
                if (typeof content === 'object') {
                    content = content.data || content.content || JSON.stringify(content);
                }

                if (content && content.length > 0) {
                    const displayContent = content.length > 500
                        ? content.substring(0, 500) + '...'
                        : content;
                    console.log(`\n${chalk.magenta('[Agent Message]')} ${displayContent}\n`);
                }
            } catch (error) {
                console.error(chalk.red('[UserInputDemo] Message processing error:'), error);
            }
        });

        // Listen for tool calls — show task_complete and async polling calls,
        // but skip user_input/request_user_input since the User Input Request box
        // already displays that info. Printing here would interfere with the
        // interactive prompts library which controls the terminal cursor.
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Skip all user_input tools — the User Input Request box already shows
            // prompt info, and async polling (get_user_input_response) writes to stdout
            // while the prompts library controls the terminal cursor, causing visual corruption.
            if (toolName === 'user_input' || toolName === 'request_user_input' || toolName === 'get_user_input_response') {
                return;
            }

            if (toolName === 'task_complete') {
                console.log(`\n${chalk.yellow('─'.repeat(60))}`);
                console.log(`${chalk.yellow('[Tool Call]')} ${chalk.bold(toolName)}`);
                if (args.summary) {
                    console.log(`   Summary: ${args.summary.substring(0, 200)}...`);
                }
                console.log(`${chalk.yellow('─'.repeat(60))}\n`);
            } else {
                console.log(`${chalk.dim('[Tool Call]')} ${toolName}: ${JSON.stringify(args).substring(0, 100)}`);
            }
        });

        // Listen for task completion — resolve promise when task completes
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;

            // Extract summary from the completion result
            // The task_complete tool stores result at payload.data.task.result
            const result = payload.data?.task?.result;
            const summary = result?.summary || payload.data?.summary || '';

            console.log(`\n${chalk.green('═'.repeat(60))}`);
            console.log(chalk.green.bold('[Task Completed]'));
            if (summary) {
                console.log(`\n${summary}`);
            }
            console.log(`\n${chalk.green('═'.repeat(60))}\n`);

            // Brief delay for any final logs before resolving
            setTimeout(() => resolve(), 1000);
        });

        // Listen for task cancellation, failure, and errors so the demo exits
        // promptly instead of waiting for the 5-minute outer timeout.
        channel.on(Events.Task.CANCELLED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;
            console.log(`\n${chalk.yellow('[Task Cancelled]')} ${payload.data?.reason || ''}\n`);
            setTimeout(() => resolve(), 1000);
        });

        channel.on(Events.Task.FAILED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;
            console.log(`\n${chalk.red('[Task Failed]')} ${payload.data?.error || ''}\n`);
            setTimeout(() => resolve(), 1000);
        });

        channel.on(Events.Task.ERROR, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;
            console.log(`\n${chalk.red('[Task Error]')} ${payload.data?.error || ''}\n`);
            setTimeout(() => resolve(), 1000);
        });
    });
};

// ============================================================================
// Agent and Task Creation
// ============================================================================

/**
 * Create the project setup wizard agent with a prescriptive system prompt
 * that specifies exact tool calls in exact order to reliably exercise all
 * input types, modes, urgency levels, and themes.
 */
const createProjectSetupAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'ProjectSetupWizard',
        name: 'Project Setup Wizard',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An interactive agent that guides users through configuring a new software project',

        // LLM configuration — low temperature for predictable sequence following
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.2,
        maxTokens: 8000,
        maxIterations: 20,

        // Only allow user input tools and task completion
        allowedTools: [
            'user_input',
            'request_user_input',
            'get_user_input_response',
            'task_complete'
        ],

        // User input tools make repeated calls legitimately (polling, multiple prompts)
        circuitBreakerExemptTools: [
            'user_input',
            'request_user_input',
            'get_user_input_response'
        ],

        // Prescriptive agent prompt — specifies exact tool call sequence
        agentConfigPrompt: `You are a Project Setup Wizard. Your job is to guide the user through configuring a new software project by collecting their preferences.

## CRITICAL INSTRUCTIONS

You MUST call the tools in EXACTLY this order. Do NOT skip any step. Do NOT add extra steps. Follow the sequence precisely.

## STEP 1: Project Name (text, blocking)
Call user_input with:
- title: "What is your project name?"
- description: "Enter a name for your new software project"
- inputType: "text"
- inputConfig: { "minLength": 2, "maxLength": 50 }
- urgency: "normal"
- theme: "info"

## STEP 2: Framework Choice (select, blocking)
Call user_input with:
- title: "Which framework would you like to use?"
- description: "Select the frontend framework for your project"
- inputType: "select"
- inputConfig: { "options": [
    { "value": "react", "label": "React", "description": "A JavaScript library for building user interfaces" },
    { "value": "vue", "label": "Vue", "description": "The progressive JavaScript framework" },
    { "value": "angular", "label": "Angular", "description": "Platform for building mobile and desktop web apps" },
    { "value": "svelte", "label": "Svelte", "description": "Cybernetically enhanced web apps" },
    { "value": "nextjs", "label": "Next.js", "description": "The React framework for production" }
  ] }
- urgency: "high"
- theme: "default"

## STEP 3: Feature Selection (multi_select, blocking)
Call user_input with:
- title: "Which features would you like to enable?"
- description: "Select one or more features for your project (use space to toggle, enter to confirm)"
- inputType: "multi_select"
- inputConfig: { "options": [
    { "value": "typescript", "label": "TypeScript", "description": "Static type checking" },
    { "value": "eslint", "label": "ESLint", "description": "Code linting and formatting" },
    { "value": "prettier", "label": "Prettier", "description": "Opinionated code formatter" },
    { "value": "testing", "label": "Testing (Jest)", "description": "Unit and integration testing" },
    { "value": "ci", "label": "CI/CD Pipeline", "description": "GitHub Actions workflow" },
    { "value": "docker", "label": "Docker", "description": "Container configuration" }
  ], "minSelections": 1, "maxSelections": 5 }
- urgency: "normal"
- theme: "success"

## STEP 4: Auto-Deploy Confirmation (confirm, blocking)
Call user_input with:
- title: "Enable automatic deployment?"
- description: "This will set up auto-deploy to production on every push to main. This action requires careful consideration."
- inputType: "confirm"
- inputConfig: { "confirmLabel": "Enable Auto-Deploy", "denyLabel": "Skip for Now" }
- urgency: "critical"
- theme: "warning"

## STEP 5: Project Description (text, ASYNC mode)
This step uses async mode. First call request_user_input, then poll with get_user_input_response.

Call request_user_input with:
- title: "Describe your project"
- description: "Write a brief description of what your project does (take your time)"
- inputType: "text"
- inputConfig: { "multiline": true, "placeholder": "A web application that..." }
- urgency: "low"
- theme: "info"

After receiving the requestId, poll using get_user_input_response with that requestId.
Poll up to 5 times. If the status is "pending", wait briefly and try again.
If you get "responded", proceed with the value.
If after 5 polls it is still "pending", that is OK — move on to the next step.

## STEP 6: License Choice (select, blocking)
Call user_input with:
- title: "Choose a license for your project"
- inputType: "select"
- inputConfig: { "options": [
    { "value": "mit", "label": "MIT", "description": "Simple and permissive" },
    { "value": "apache2", "label": "Apache 2.0", "description": "Permissive with patent grant" },
    { "value": "gpl3", "label": "GPL 3.0", "description": "Strong copyleft" },
    { "value": "bsd3", "label": "BSD 3-Clause", "description": "Permissive with no-endorsement clause" }
  ] }
- urgency: "low"
- theme: "default"

## STEP 7: Favorite Color — Timeout Test (text, blocking, 10s timeout)
Call user_input with:
- title: "What is your favorite color?"
- description: "Quick! You have 10 seconds to answer. (This tests the timeout feature — try waiting it out!)"
- inputType: "text"
- inputConfig: {}
- timeoutMs: 10000
- urgency: "high"
- theme: "error"

## AFTER ALL STEPS

After completing all 7 steps (or handling timeouts/cancellations), call task_complete with:
- summary: A formatted summary of all the user's project configuration choices
- success: true

Include the project name, framework, features, auto-deploy choice, description, license, and color (or "timed out" if applicable).

## IMPORTANT RULES
- Call tools ONE AT A TIME in the exact order specified above
- Do NOT have a conversation with the user between tool calls — just call the next tool
- The user_input tool handles all interaction — you do not need to send messages
- If a tool returns an error or timeout, note it and move on to the next step`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the project setup task that triggers the wizard sequence
 */
const createProjectSetupTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating project setup task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Interactive Project Setup Wizard',
        description: `Guide the user through configuring a new software project by asking 7 questions.

Follow your system prompt EXACTLY. Call the user_input tools in the specified order with the
specified parameters. Do not skip steps or add extra conversation.

This is an interactive demo — the user will be prompted in their terminal for each question.

Begin immediately with Step 1 (project name).`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['ProjectSetupWizard'],
        completionAgentId: 'ProjectSetupWizard',
        priority: 'high',
        tags: ['user-input', 'interactive', 'demo'],
        metadata: {
            demo: 'user-input',
            scenario: 'project-setup-wizard'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    console.log('Agent will now guide you through project setup...\n');
    console.log(chalk.dim('Answer each prompt as it appears. For Step 7, try waiting 10s to test timeout.\n'));
    console.log('─'.repeat(60) + '\n');

    return taskId;
};

// ============================================================================
// Cleanup
// ============================================================================

// Module-level cleanup state for signal handler access
let cleanupState: {
    agent: MxfAgent | null;
    sdk: MxfSDK | null;
    credentials: { keyId: string; secretKey: string } | null;
    cleanupDone: boolean;
} = {
    agent: null,
    sdk: null,
    credentials: null,
    cleanupDone: false
};

/**
 * Cleanup function — disconnect agent, delete memory, delete channel, disconnect SDK.
 * Safe to call from finally block or signal handlers.
 */
async function cleanup(): Promise<void> {
    if (cleanupState.cleanupDone) return;
    cleanupState.cleanupDone = true;

    console.log('\nCleaning up...');

    // Disconnect agent first
    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    // Delete agent memory and channel via API (must be done before SDK disconnect)
    if (cleanupState.credentials) {
        console.log('Deleting agent memory...');
        await fetch(`${config.serverUrl}/api/agents/ProjectSetupWizard/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        console.log('Deleting channel...');
        await fetch(`${config.serverUrl}/api/channels/${config.channelId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});
    }

    if (cleanupState.sdk) {
        await cleanupState.sdk.disconnect().catch(() => {});
    }

    console.log('Cleanup complete');
}

// Handle Ctrl+C and termination signals
process.on('SIGINT', async () => {
    console.log('\n\nInterrupted (Ctrl+C)');
    await cleanup();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\nTerminated');
    await cleanup();
    process.exit(143);
});

// ============================================================================
// Main Demo
// ============================================================================

/**
 * Main demo orchestration function.
 *
 * Flow:
 * 1. Connect SDK with Personal Access Token authentication
 * 2. Create channel with SystemLLM disabled
 * 3. Register user input handler (prompts library → terminal prompts)
 * 4. Generate agent keys
 * 5. Create agent with prescriptive system prompt
 * 6. Create task → agent starts calling user_input tools
 * 7. Wait for task completion or 5-minute timeout
 * 8. Cleanup
 */
async function demo() {
    displayBanner();

    console.log('Initializing MxfSDK...\n');

    // Validate required environment variables
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error(chalk.red('MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup'));
        process.exit(1);
    }

    if (!process.env.OPENROUTER_API_KEY) {
        console.error(chalk.red('OPENROUTER_API_KEY is required for LLM agent.'));
        process.exit(1);
    }

    if (!process.env.MXF_DOMAIN_KEY) {
        console.error(chalk.red('MXF_DOMAIN_KEY is required. Run: bun run server:cli -- demo:setup'));
        process.exit(1);
    }

    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY,
        accessToken: accessToken
    });

    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel with SystemLLM disabled — agent handles all interaction
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'User Input Demo Channel',
            description: 'Interactive project setup wizard demonstrating user_input tools',
            systemLlmEnabled: false
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring — returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate agent keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'Project Setup Wizard Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Purge leftover agent memory from previous runs so the LLM context stays small.
        // The agent ID is fixed ("ProjectSetupWizard"), so memory accumulates if cleanup
        // failed or the process was killed. This ensures a fresh start every time.
        console.log('Clearing previous agent memory...');
        await fetch(`${config.serverUrl}/api/agents/ProjectSetupWizard/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': keys.keyId,
                'x-secret-key': keys.secretKey
            }
        }).catch(() => {}); // OK to fail — memory may not exist yet

        // Create agent
        console.log('Creating project setup wizard agent...');
        const agent = await createProjectSetupAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Register user input handler on the agent — this is the core of the demo.
        // When the agent calls user_input, the server emits a REQUEST event,
        // the SDK receives it via the agent's UserInputHandlers, and this handler
        // renders the terminal prompt using the prompts library.
        console.log('Registering user input handler...');
        agent.onUserInput(buildUserInputHandler());
        console.log('User input handler registered\n');

        // Create the task — agent will start calling user_input tools from here
        await createProjectSetupTask(agent);

        // Wait for task completion with 5-minute timeout (interactive demos need more time)
        console.log(chalk.dim('Waiting for agent to complete (max 5 minutes)...\n'));

        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log(chalk.red('\nTimeout reached (5 minutes) — exiting demo'));
                resolve();
            }, 300000);
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        // Demo complete summary
        console.log('\n' + chalk.cyan('═'.repeat(80)));
        console.log(chalk.cyan.bold('  Demo Complete'));
        console.log(chalk.cyan('═'.repeat(80)));

        // Display collected user answers as a full report
        if (collectedAnswers.length > 0) {
            console.log(chalk.yellow('\n  Your Project Configuration:'));
            console.log('  ' + '─'.repeat(60));
            for (const answer of collectedAnswers) {
                const formattedValue = Array.isArray(answer.value)
                    ? answer.value.join(', ')
                    : String(answer.value);
                console.log(`  ${chalk.bold(answer.title)}`);
                console.log(`    ${chalk.green(formattedValue)}  ${chalk.dim(`(${answer.inputType})`)}`);
            }
            console.log('  ' + '─'.repeat(60));
        }

        console.log(chalk.yellow('\n  Features Exercised:'));
        console.log('  - All 4 input types: text, select, multi_select, confirm');
        console.log('  - Both blocking and async (poll) modes');
        console.log('  - Urgency levels: low, normal, high, critical');
        console.log('  - Themes: default, info, success, warning, error');
        console.log('  - Timeout behavior (Step 7)');

        console.log(chalk.yellow('\n  Integration Pattern:'));
        console.log(`  ${chalk.dim('agent.onUserInput(async (request) => {')}`);
        console.log(`  ${chalk.dim('    // Render prompt based on request.inputType')}`);
        console.log(`  ${chalk.dim('    // Return user\'s answer as string | string[] | boolean')}`);
        console.log(`  ${chalk.dim('});')}`);

    } catch (error) {
        console.error(chalk.red('\nDemo failed:'), error);
        throw error;
    } finally {
        await cleanup();
    }
}

// Run demo
demo()
    .then(() => {
        console.log('\nDemo completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nDemo failed:', error);
        process.exit(1);
    });

export { demo };
