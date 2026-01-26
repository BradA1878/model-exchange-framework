/**
 * LSP Code Intelligence Demo (Agentic Flow)
 *
 * Demonstrates an agent autonomously using MXF's code analysis and TypeScript
 * tools to analyze and understand a codebase. The agent receives a task and
 * autonomously decides which tools to use for code intelligence.
 *
 * KEY DIFFERENCE: This demo does NOT use direct executeTool() calls or simulations.
 * Instead, the agent receives a task and autonomously decides which tools to use.
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/lsp-code-intelligence-demo
 * cp .env.example .env
 * npx ts-node lsp-code-intelligence-demo.ts
 * ```
 *
 * Run with: npm run demo:lsp-code-intelligence
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `code-intelligence-demo-${timestamp}`
};

/**
 * Display demo banner explaining what the demo demonstrates
 */
const displayBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('CODE INTELLIGENCE DEMO (Agentic Flow)');
    console.log('═'.repeat(80));
    console.log('');
    console.log('This demo shows an agent with CODE ANALYSIS capabilities:');
    console.log('  - The agent receives a task to analyze the MXF dashboard codebase');
    console.log('  - It autonomously decides which code analysis tools to use');
    console.log('  - No hardcoded executeTool() calls - pure LLM reasoning');
    console.log('');
    console.log('Available Code Analysis Tools:');
    console.log('  - analyze_codebase     : Analyze structure, dependencies, architecture');
    console.log('  - find_functions       : Find function definitions and signatures');
    console.log('  - trace_dependencies   : Trace imports and exports for impact analysis');
    console.log('  - suggest_refactoring  : Identify refactoring opportunities');
    console.log('  - validate_architecture: Validate against architectural principles');
    console.log('  - typescript_check     : Type-check TypeScript files');
    console.log('  - typescript_lint      : Lint TypeScript files with ESLint');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Tool Call] analyze_codebase - understanding project structure');
    console.log('  - [Tool Call] find_functions - locating specific functions');
    console.log('  - [Tool Call] trace_dependencies - analyzing import relationships');
    console.log('  - [Tool Call] suggest_refactoring - identifying improvements');
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * Setup channel monitoring for observing agent behavior
 * Returns a promise that resolves when task is completed
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        // Track messages to prevent duplicates
        const processedIds = new Set<string>();
        let taskCompleted = false;

        // Listen for agent messages (thinking/responses)
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
                    // Truncate long messages for readability
                    const displayContent = content.length > 500
                        ? content.substring(0, 500) + '...'
                        : content;
                    console.log(`\n[Agent Response]\n${displayContent}\n`);
                }
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls - this is where we see the code intelligence decisions
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight code analysis tool calls
            const codeAnalysisTools = [
                'analyze_codebase', 'find_functions', 'trace_dependencies',
                'suggest_refactoring', 'validate_architecture',
                'typescript_check', 'typescript_lint', 'typescript_format',
                'lsp_goto_definition', 'lsp_find_references', 'lsp_document_symbols'
            ];

            if (codeAnalysisTools.includes(toolName)) {
                console.log(`\n${'─'.repeat(60)}`);
                console.log(`[Tool Call] ${toolName}`);
                if (args.workingDirectory) {
                    console.log(`   Directory: ${args.workingDirectory}`);
                }
                if (args.filePath) {
                    console.log(`   File: ${args.filePath}`);
                }
                if (args.functionName) {
                    console.log(`   Function: ${args.functionName}`);
                }
                if (args.analysisType) {
                    console.log(`   Analysis Type: ${args.analysisType}`);
                }
                if (args.filePaths) {
                    console.log(`   Files: ${args.filePaths.length} files`);
                }
                console.log(`${'─'.repeat(60)}\n`);
            } else {
                console.log(`[Tool Call] ${toolName}: ${JSON.stringify(args)}`);
            }
        });

        // Listen for tool results
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const toolName = payload.data?.toolName || 'unknown';
            const result = payload.data?.result;
            const data = result?.data;

            // Determine success based on tool result
            let isSuccess = data?.success === true || (data && !data?.error);

            // Log code analysis tool results with relevant details
            const codeAnalysisTools = [
                'analyze_codebase', 'find_functions', 'trace_dependencies',
                'suggest_refactoring', 'validate_architecture',
                'typescript_check', 'typescript_lint'
            ];

            if (codeAnalysisTools.includes(toolName)) {
                const statusIcon = isSuccess ? 'Success' : 'Failed';
                let details = '';

                if (toolName === 'analyze_codebase' && data?.analysis?.structure) {
                    details = ` - ${data.analysis.structure.totalFiles || 0} files found`;
                } else if (toolName === 'find_functions' && data?.totalFound !== undefined) {
                    details = ` - ${data.totalFound} functions found`;
                } else if (toolName === 'suggest_refactoring' && data?.totalSuggestions !== undefined) {
                    details = ` - ${data.totalSuggestions} suggestions`;
                } else if (toolName === 'validate_architecture' && data?.totalViolations !== undefined) {
                    details = ` - ${data.totalViolations} violations`;
                } else if (toolName === 'typescript_check' && data?.totalErrors !== undefined) {
                    details = ` - ${data.totalErrors} errors, ${data.totalWarnings} warnings`;
                }

                console.log(`[Tool Result] ${toolName}: ${statusIcon}${details}`);
            }
        });

        // Listen for task completion - resolve promise when task completes
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return; // Prevent duplicate handling
            taskCompleted = true;

            console.log(`\n${'═'.repeat(60)}`);
            console.log('[Task Completed]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log(`${'═'.repeat(60)}\n`);

            // Give a moment for any final logs, then resolve
            setTimeout(() => resolve(), 1000);
        });

        // Listen for LLM responses (optional - shows internal thinking)
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0 && response.length < 300) {
                console.log(`[Agent Thinking] ${response}`);
            }
        });
    });
};

/**
 * Create the code intelligence agent with code analysis tools
 */
const createCodeIntelligenceAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'CodeIntelligenceAgent',
        name: 'Code Intelligence Analyst',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'An agent that analyzes codebases using code intelligence tools',

        // LLM configuration
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 8000,

        // Code analysis tools available to the agent
        allowedTools: [
            // Code Analysis Tools
            'analyze_codebase',       // Analyze structure, dependencies, architecture
            'find_functions',         // Find function definitions
            'trace_dependencies',     // Trace imports/exports
            'suggest_refactoring',    // Identify refactoring opportunities
            'validate_architecture',  // Validate architectural principles

            // TypeScript Tools
            'typescript_check',       // Type-check TypeScript files
            'typescript_lint',        // Lint TypeScript files

            // Task completion
            'task_complete'           // Mark task complete
        ],

        // Agent behavior prompt - instructs the agent on code analysis workflow
        agentConfigPrompt: `You are a code intelligence agent that analyzes codebases to provide insights about structure, patterns, and quality.

## AVAILABLE TOOLS

### Code Analysis Tools
- **analyze_codebase**: Analyze codebase structure, dependencies, and architecture patterns
  - Parameters: workingDirectory (path to analyze), includePatterns (file patterns), excludePatterns (exclusions)
  - Returns: File counts, directory structure, dependencies from package.json, TypeScript config info

- **find_functions**: Find function definitions and their signatures across the codebase
  - Parameters: functionName (supports regex), filePatterns, includeSignatures
  - Returns: List of functions with file paths, line numbers, and types

- **trace_dependencies**: Trace dependencies and imports for impact analysis
  - Parameters: filePath (file to analyze), direction (imports/exports/both), maxDepth
  - Returns: Import list, export list, files that depend on this file

- **suggest_refactoring**: Analyze code and suggest refactoring opportunities
  - Parameters: filePath, analysisType (complexity/duplication/patterns/performance/all)
  - Returns: List of suggestions with severity, message, line, and recommendation

- **validate_architecture**: Validate code against architectural principles
  - Parameters: filePaths (array of files), rules (layering/dependencies/naming/patterns)
  - Returns: List of violations with severity and suggestions

### TypeScript Tools
- **typescript_check**: Type-check TypeScript files and report diagnostics
  - Parameters: workingDirectory, files (optional specific files)
  - Returns: Errors, warnings, and diagnostic messages

- **typescript_lint**: Lint TypeScript files using ESLint
  - Parameters: files, fix (auto-fix), workingDirectory
  - Returns: Lint results with rule violations

### Task Tools
- **task_complete**: Mark the task as completed with a summary

## CODE ANALYSIS WORKFLOW

When analyzing a codebase, follow this systematic approach:

1. **UNDERSTAND STRUCTURE** - Start with analyze_codebase to get an overview:
   - Total file count and types
   - Directory organization
   - Dependencies (production vs dev)
   - TypeScript configuration

2. **EXPLORE KEY FUNCTIONS** - Use find_functions to locate important code:
   - Search for main entry points
   - Find key business logic functions
   - Identify utility functions

3. **TRACE RELATIONSHIPS** - Use trace_dependencies on important files:
   - Understand import chains
   - Identify heavily-depended-upon modules
   - Find potential circular dependencies

4. **ASSESS QUALITY** - Use suggest_refactoring on complex files:
   - Identify overly complex functions
   - Find code duplication
   - Spot anti-patterns

5. **VALIDATE ARCHITECTURE** - Check for architectural issues:
   - Layer violations
   - Dependency problems
   - Naming inconsistencies

6. **SUMMARIZE FINDINGS** - Call task_complete with:
   - Key insights about the codebase
   - Notable patterns found
   - Recommendations for improvement

## IMPORTANT NOTES

- Always analyze the ACTUAL codebase at the paths provided
- Do NOT make assumptions - use tools to gather real data
- Provide specific file paths and line numbers in findings
- Focus on actionable insights, not just statistics
- Call task_complete when analysis is finished`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the code analysis task for the agent
 */
const createCodeAnalysisTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating code analysis task...\n');

    // Get the absolute path to the dashboard directory
    const dashboardPath = process.cwd() + '/dashboard/src';

    const taskId = await agent.mxfService.createTask({
        title: 'Analyze MXF Dashboard Codebase',
        description: `# Code Intelligence Analysis Task

You will perform a comprehensive code analysis of the MXF Dashboard codebase.

## Target Directory
Analyze the Vue.js dashboard at: ${dashboardPath}

The dashboard is a Vue 3 application with:
- **src/stores/** - Pinia stores (analytics, agents, tasks, channels, auth)
- **src/views/** - Vue views (Dashboard, Login, Channels, admin views)
- **src/components/** - Vue components (CoordinationPanel, analytics components)
- **src/plugins/** - Configuration plugins (axios, theme, vuetify)
- **src/layouts/** - Layout components

## Analysis Steps

### Step 1: Understand Structure
Use \`analyze_codebase\` with workingDirectory="${dashboardPath}" to:
- Get total file counts by type (.ts, .vue, etc.)
- Understand directory organization
- Review dependencies

### Step 2: Find Key Functions
Use \`find_functions\` to locate important code:
- Search for "fetch" (data fetching patterns)
- Search for "use" (Vue composables)
- Search for "define" (store definitions)

### Step 3: Trace Dependencies
Pick 2-3 important files and use \`trace_dependencies\` to understand:
- What each file imports
- What depends on it
- Import/export patterns

### Step 4: Suggest Improvements
Use \`suggest_refactoring\` on 2-3 files to identify:
- Complex functions that could be simplified
- Code duplication
- Pattern issues

### Step 5: Summarize
Call \`task_complete\` with a summary containing:
- Key insights about the dashboard architecture
- Notable patterns (good and bad)
- Top 3 recommendations for improvement
- Any interesting findings

## Requirements

- Use REAL tools to analyze ACTUAL files
- Do NOT simulate or make up results
- Provide specific file paths and line numbers
- Be systematic in your analysis
- Call task_complete when done`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['CodeIntelligenceAgent'],
        completionAgentId: 'CodeIntelligenceAgent',
        priority: 'high',
        tags: ['code-intelligence', 'analysis', 'demo'],
        metadata: {
            demo: 'lsp-code-intelligence',
            scenario: 'dashboard-analysis',
            targetPath: dashboardPath
        }
    });

    console.log(`Task created: ${taskId}\n`);
    console.log('Agent is now working autonomously...\n');
    console.log('Watch for tool calls showing code analysis decisions:\n');

    return taskId;
};

// Cleanup state - module level for signal handler access
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
 * Cleanup function - can be called from finally block or signal handlers
 */
async function cleanup(): Promise<void> {
    if (cleanupState.cleanupDone) return;
    cleanupState.cleanupDone = true;

    console.log('\nCleaning up...');

    // Disconnect agent first
    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    // Delete agent memory via API (must be done before channel deletion)
    if (cleanupState.credentials) {
        console.log('Deleting agent memory...');
        await fetch(`${config.serverUrl}/api/agents/CodeIntelligenceAgent/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete channel via API (also deletes channel memory)
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
    console.log('\nInterrupted (Ctrl+C)');
    await cleanup();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\nTerminated');
    await cleanup();
    process.exit(143);
});

/**
 * Main demo function
 */
async function demo() {
    displayBanner();

    console.log('Initializing MxfSDK...\n');

    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_DEMO_USERNAME || 'demo-user',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
    });

    // Store SDK reference for signal handler cleanup
    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'Code Intelligence Demo Channel',
            description: 'Demonstrating agentic code intelligence analysis',
            systemLlmEnabled: false  // Disable SystemLLM - agent makes its own decisions
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring - returns promise that resolves on task completion
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'Code Intelligence Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating code intelligence agent...');
        const agent = await createCodeIntelligenceAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create the task - agent will work autonomously from here
        await createCodeAnalysisTask(agent);

        // Wait for agent to work (with timeout)
        // The agent will autonomously:
        // 1. Analyze codebase structure
        // 2. Find important functions
        // 3. Trace dependencies
        // 4. Suggest refactoring
        // 5. Call task_complete when done
        console.log('Waiting for agent to complete (exits on task_complete, max 4 minutes)...\n');
        console.log('─'.repeat(60) + '\n');

        // Race between task completion and timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (4 minutes) - exiting demo');
                resolve();
            }, 240000); // 4 minutes for code analysis
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

        console.log('\n' + '═'.repeat(80));
        console.log('Demo Complete');
        console.log('═'.repeat(80));

        console.log('\nKey Takeaways:');
        console.log('  - The agent autonomously decided which code analysis tools to use');
        console.log('  - No hardcoded tool calls - pure LLM reasoning');
        console.log('  - Real code analysis on actual files');
        console.log('  - Systematic approach: structure -> functions -> dependencies -> quality');

    } catch (error) {
        console.error('\nDemo failed:', error);
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
