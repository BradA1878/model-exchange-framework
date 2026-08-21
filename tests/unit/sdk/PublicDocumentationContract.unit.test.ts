import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { Events } from '@mxf-dev/core/events/EventNames';
import { PUBLIC_EVENTS } from '@mxf-dev/core/events/PublicEvents';

const repositoryRoot = resolve(process.cwd());
const ignoredDocumentationDirectories = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    'tmp',
]);

const collectMarkdownFiles = (directory: string): string[] => {
    const entries = readdirSync(directory, { withFileTypes: true });

    return entries.flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (ignoredDocumentationDirectories.has(entry.name)) {
                return [];
            }
            return collectMarkdownFiles(path);
        }

        return extname(entry.name) === '.md' ? [path] : [];
    });
};

const publicDocumentationFiles = [
    ...collectMarkdownFiles(resolve(repositoryRoot, 'docs')),
    ...collectMarkdownFiles(resolve(repositoryRoot, 'examples')),
    resolve(repositoryRoot, 'README.md'),
    resolve(repositoryRoot, 'packages/sdk/README.md'),
];

const publicExampleDocumentationFiles = [
    ...collectMarkdownFiles(resolve(repositoryRoot, 'docs/examples')),
    ...collectMarkdownFiles(resolve(repositoryRoot, 'examples')),
];

const publicSdkEventExampleFiles = [
    ...collectMarkdownFiles(resolve(repositoryRoot, 'docs/sdk')),
    ...collectMarkdownFiles(resolve(repositoryRoot, 'examples')),
    resolve(repositoryRoot, 'docs/examples/first-contact.md'),
    resolve(repositoryRoot, 'docs/examples/interview-scheduling.md'),
    resolve(repositoryRoot, 'docs/getting-started.md'),
    resolve(repositoryRoot, 'packages/sdk/README.md'),
    resolve(repositoryRoot, 'packages/sdk/src/MxfChannelMonitor.ts'),
    resolve(repositoryRoot, 'packages/sdk/src/MxfSDK.ts'),
    resolve(repositoryRoot, 'packages/sdk/src/index.ts'),
];

const publicSdkConfigurationDocumentationFiles = [
    ...collectMarkdownFiles(resolve(repositoryRoot, 'docs/sdk')),
    ...collectMarkdownFiles(resolve(repositoryRoot, 'docs/examples')),
    resolve(repositoryRoot, 'README.md'),
    resolve(repositoryRoot, 'packages/sdk/README.md'),
];

const bunRuntimeDocumentationFiles = [
    resolve(repositoryRoot, 'README.md'),
    resolve(repositoryRoot, 'docs/getting-started.md'),
    resolve(repositoryRoot, 'docs/meilisearch-integration.md'),
    resolve(repositoryRoot, 'docs/mxf/memory-utility-learning.md'),
    resolve(repositoryRoot, 'docs/mxf/server-cli.md'),
    resolve(repositoryRoot, 'docs/sdk/authentication.md'),
    resolve(repositoryRoot, 'docs/sdk/index.md'),
];

const findContractViolations = (
    pattern: RegExp,
    files: string[] = publicDocumentationFiles
): string[] =>
    files.flatMap((path) => {
        const content = readFileSync(path, 'utf8');
        return pattern.test(content) ? [relative(repositoryRoot, path)] : [];
    });

const resolveEventName = (path: string): unknown =>
    path.split('.').reduce<unknown>((value, key) => {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        return (value as Record<string, unknown>)[key];
    }, Events);

describe('public documentation contract', () => {
    it('imports the SDK only through its published package root', () => {
        const unsupportedImports = findContractViolations(
            /(?:from\s+|require\()['"](?:mxf-sdk|@model-exchange\/sdk|@mxf-dev\/sdk\/[^'"]+)/
        );

        expect(unsupportedImports).toEqual([]);
    });

    it('uses the current public SDK method names and channel signature', () => {
        const removedSdkCalls = findContractViolations(
            /\bagent\.(?:callTool|getAvailableTools)\s*\(|\bagent\.toolService\.getAvailableTools\s*\(|\b(?!(?:mxfService|taskService)\.)[A-Za-z_$][\w$]*\.(?:sendMessage|createTask|discoverTools|getToolMetadata)\s*\(|\bsdk\.createChannelMonitor\s*\(|\bsdk\.createChannel\s*\(\s*\{/
        );

        expect(removedSdkCalls).toEqual([]);
    });

    it('does not advertise protected or nonexistent agent service methods', () => {
        const unsupportedAgentCalls = findContractViolations(
            /\bagent\.toolService\b|\bagent\.(?:startControlLoop|onControlLoopEvent|getChannelMemory|setMemory|getConnectionStatus|getResources|getResource|getToolCategories|getToolsByCategory|canExecuteTool)\s*\(|\bagent\.mxfService\.(?:setLogLevel|readMemory)\s*\(/
        );

        expect(unsupportedAgentCalls).toEqual([]);
    });

    it('does not use removed createAgent configuration fields', () => {
        const removedConfigurationFields = publicSdkConfigurationDocumentationFiles.flatMap(
            (path) => {
                const content = readFileSync(path, 'utf8');
                const createAgentBlocks = [
                    ...content.matchAll(/\bsdk\.createAgent\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/g),
                ];
                const hasRemovedField = createAgentBlocks.some((match) =>
                    /^\s*(?:personality|provider|model|llmConfig)\s*:/m.test(match[1])
                );

                return hasRemovedField ? [relative(repositoryRoot, path)] : [];
            }
        );

        expect(removedConfigurationFields).toEqual([]);
    });

    it('does not advertise agent-authorized MCP process management', () => {
        const agentProcessManagement = findContractViolations(
            /\b(?:agent|adminAgent|testAgent)\.(?:un)?register(?:Channel|External)McpServer\s*\(/
        );

        expect(agentProcessManagement).toEqual([]);
    });

    it('does not advertise unimplemented HTTP MCP registration', () => {
        const httpTransportConfig = findContractViolations(
            /(?:transport\??\s*:\s*['"][^'"]*http|\burl\s*:\s*[^\n]*\/mcp)/i
        );

        expect(httpTransportConfig).toEqual([]);
    });

    it('documents the operator opt-in and administrator boundary for process registration', () => {
        const registrationDocs = publicDocumentationFiles.filter((path) =>
            /register(?:Channel|External)McpServer/.test(readFileSync(path, 'utf8'))
        );
        const missingBoundary = registrationDocs.flatMap((path) => {
            const content = readFileSync(path, 'utf8');
            return content.includes('MXF_UNSAFE_STDIO_MCP_ENABLED') &&
                /administrator/i.test(content)
                ? []
                : [relative(repositoryRoot, path)];
        });

        expect(missingBoundary).toEqual([]);
    });

    it('shows public event fields through the event data envelope', () => {
        const sdkOverview = readFileSync(resolve(repositoryRoot, 'docs/sdk/examples.md'), 'utf8');

        expect(sdkOverview).not.toMatch(/\bmessage\.content\b/);
        expect(sdkOverview).not.toMatch(/\btask\.taskId\b/);
        expect(sdkOverview).toContain('message.data.content.data');
        expect(sdkOverview).toContain('task.data.taskId');
    });

    it('unwraps message content and reads task descriptions from their public payload shapes', () => {
        const rawMessageContent = findContractViolations(
            /\b(?:payload|message)\.data\.content(?!\.(?:data|format)\b)/,
            publicSdkEventExampleFiles
        );
        const topLevelTaskDescription = findContractViolations(
            /\bpayload\.data\.description\b/,
            publicSdkEventExampleFiles
        );

        expect(rawMessageContent).toEqual([]);
        expect(topLevelTaskDescription).toEqual([]);
    });

    it('uses only whitelisted event names with public SDK on() methods', () => {
        const publicEventNames = new Set<string>(PUBLIC_EVENTS);
        const internalEventListeners = publicSdkEventExampleFiles.flatMap((path) => {
            const content = readFileSync(path, 'utf8');
            const eventPaths = [
                ...content.matchAll(
                    /\.on\s*\(\s*Events\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g
                ),
            ].map((match) => match[1]);
            const hasInternalEvent = eventPaths.some((eventPath) => {
                const eventName = resolveEventName(eventPath);
                return typeof eventName !== 'string' || !publicEventNames.has(eventName);
            });

            return hasInternalEvent ? [relative(repositoryRoot, path)] : [];
        });

        expect(internalEventListeners).toEqual([]);
    });

    it('uses Bun commands in public example instructions', () => {
        const otherRuntimeCommands = findContractViolations(
            /^\s*(?:>\s*)?(?:npm|npx|yarn|pnpm)\s+/m,
            publicExampleDocumentationFiles
        );

        expect(otherRuntimeCommands).toEqual([]);
    });

    it('uses Bun and MXF-root paths for documented TypeScript MCP processes', () => {
        const nonBunProcessCommands = findContractViolations(
            /\bcommand\s*:\s*['"](?:node|ts-node|tsx)['"]/
        );
        const demoDirectoryRelativeArguments = findContractViolations(
            /\bargs\s*:\s*\[\s*['"]\.\/server\//
        );

        expect(nonBunProcessCommands).toEqual([]);
        expect(demoDirectoryRelativeArguments).toEqual([]);
    });

    it('uses Bun for public MXF installation, operation, and migration commands', () => {
        const otherRuntimeCommands = findContractViolations(
            /^\s*(?:>\s*)?(?:npm|npx|yarn|pnpm)\s+/m,
            bunRuntimeDocumentationFiles
        );
        const inlineRuntimeCommands = findContractViolations(
            /`(?:npm\s+(?:install|run|start)|npx)\b|command:\s*['"](?:npm|npx|node)['"]/,
            bunRuntimeDocumentationFiles
        );

        expect(otherRuntimeCommands).toEqual([]);
        expect(inlineRuntimeCommands).toEqual([]);
    });

    it('documents the server port with the runtime variable the server reads', () => {
        const gettingStarted = readFileSync(
            resolve(repositoryRoot, 'docs/getting-started.md'),
            'utf8'
        );

        expect(gettingStarted).not.toMatch(/^PORT\b/m);
        expect(gettingStarted).toMatch(/^MXF_PORT\b/m);
    });

    it('uses the numeric MessageMetadata priority contract in messaging examples', () => {
        const sdkIndex = readFileSync(resolve(repositoryRoot, 'docs/sdk/index.md'), 'utf8');
        const messagingStart = sdkIndex.indexOf('### Messaging');
        const messagingEnd = sdkIndex.indexOf('### Task Handling', messagingStart);
        const messagingSection = sdkIndex.slice(messagingStart, messagingEnd);

        expect(messagingStart).toBeGreaterThanOrEqual(0);
        expect(messagingEnd).toBeGreaterThan(messagingStart);
        expect(messagingSection).not.toMatch(/metadata:\s*\{\s*priority:\s*['"]/);
        expect(messagingSection).toContain('metadata: { priority: 10 }');
    });
});
