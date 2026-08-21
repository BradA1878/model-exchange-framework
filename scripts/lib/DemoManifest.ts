export type DemoEntrypointExists = (entrypoint: string) => boolean;
export type DemoEntrypointSource = (entrypoint: string) => string;

/** Root demos intentionally exposed through package.json and their reviewed entrypoints. */
export const EXPECTED_ROOT_DEMO_COMMANDS = {
    'demo:channel-mcp':
        'NODE_ENV=development bun run examples/channel-mcp-registration/channel-mcp-demo.ts',
    'demo:code-execution':
        'NODE_ENV=development bun run examples/code-execution-demo/code-execution-demo.ts',
    'demo:dag': 'NODE_ENV=development bun run examples/dag-demo/dag-demo.ts',
    'demo:external-mcp':
        'NODE_ENV=development bun run examples/external-mcp-registration/sdk-external-mcp-server-registration.ts',
    'demo:first-contact':
        'NODE_ENV=development bun run examples/first-contact-demo/first-contact-demo.ts',
    'demo:fog-of-war': 'bun run examples/fog-of-war-game/run-demo.ts',
    'demo:inference-params':
        'NODE_ENV=development bun run examples/inference-params-demo/inference-params-demo.ts',
    'demo:interview':
        'NODE_ENV=development bun run examples/interview-scheduling-demo/interview-scheduling-demo.ts',
    'demo:kg': 'NODE_ENV=development bun run examples/kg-demo/kg-demo.ts',
    'demo:lsp-code-intelligence':
        'NODE_ENV=development bun run examples/lsp-code-intelligence-demo/lsp-code-intelligence-demo.ts',
    'demo:mcp-prompts':
        'NODE_ENV=development bun run examples/mcp-prompts-demo/mcp-prompts-demo.ts',
    'demo:memory-strata':
        'NODE_ENV=development bun run examples/memory-strata-demo/memory-strata-demo.ts',
    'demo:muls': 'NODE_ENV=development bun run examples/muls-demo/muls-demo.ts',
    'demo:nested-learning':
        'NODE_ENV=development bun run examples/nested-learning-demo/nested-learning-demo.ts',
    'demo:orpar-memory':
        'NODE_ENV=development bun run examples/orpar-memory-demo/orpar-memory-demo.ts',
    'demo:p2p-task-negotiation':
        'NODE_ENV=development bun run examples/p2p-task-negotiation-demo/p2p-task-negotiation-demo.ts',
    'demo:prompt-compaction':
        'NODE_ENV=development bun run examples/prompt-compaction-demo/prompt-compaction-demo.ts',
    'demo:tensorflow':
        'NODE_ENV=development TENSORFLOW_ENABLED=true bun run examples/tensorflow-demo/tensorflow-demo.ts',
    'demo:toon-optimization':
        'NODE_ENV=development bun run examples/toon-optimization-demo/toon-optimization-demo.ts',
    'demo:twenty-questions': 'bun run examples/twenty-questions/run-demo.ts',
    'demo:user-input':
        'NODE_ENV=development bun run examples/user-input-demo/user-input-demo.ts',
    'demo:workflow-patterns':
        'NODE_ENV=development bun run examples/workflow-patterns-demo/workflow-patterns-demo.ts'
} as const satisfies Readonly<Record<string, string>>;

// The former book-editor script is intentionally absent: the repository has no
// examples/book-editor-demo directory or entrypoint to run.

/** Example packages whose game command must own both agents and the dashboard. */
export const EXPECTED_OWNED_GAME_PACKAGE_DIRECTORIES = [
    'fog-of-war-game',
    'go-fish',
    'tic-tac-toe',
    'twenty-questions'
] as const;

const demoCommandPattern =
    /^(?:NODE_ENV=development )?(?:TENSORFLOW_ENABLED=true )?bun run (examples\/[A-Za-z0-9._/-]+\.ts)$/;
const obsoleteLaunchInstructionPattern = /\b(?:npm\s+(?:run|start)|npx)\b/i;

const ownedGameRuntimeScriptNames = [
    'dev',
    'dev:client',
    'connect-agents',
    'game',
    'start'
] as const;

const ownedGameRuntimeCommandPattern =
    /^(?:NODE_ENV=development )?(?:TENSORFLOW_ENABLED=true )?bun run (?:(?:--cwd [A-Za-z0-9._/-]+ )?[A-Za-z0-9._/-]+)$/;

/**
 * Enforce a deliberately small demo-launch grammar. Package scripts are shell
 * commands, so searching for a few dangerous fragments is insufficient: a
 * later `&&`, pipe, redirection, or command substitution can still start an
 * unowned process. Each demo must be exactly one Bun TypeScript entrypoint.
 */
export const validateDemoManifest = (
    scripts: Record<string, string>,
    entrypointExists: DemoEntrypointExists,
    expectedCommands: Readonly<Record<string, string>> = EXPECTED_ROOT_DEMO_COMMANDS,
    entrypointSource?: DemoEntrypointSource
): string[] => {
    const demos = Object.entries(scripts).filter(([name]) => name.startsWith('demo:'));
    if (demos.length === 0) {
        return ['package.json does not define any demo:* scripts'];
    }

    const errors: string[] = [];
    const actualNames = new Set(demos.map(([name]) => name));
    const expectedNames = Object.keys(expectedCommands);
    const expectedNameSet = new Set(expectedNames);

    for (const expectedName of expectedNames) {
        if (!actualNames.has(expectedName)) {
            errors.push(`package.json is missing required ${expectedName} script`);
        }
    }
    for (const [name] of demos) {
        if (!expectedNameSet.has(name)) {
            errors.push(`${name} is not listed in the reviewed root demo manifest`);
        }
    }

    for (const [name, command] of demos) {
        const expectedCommand = expectedCommands[name];
        if (expectedCommand && command !== expectedCommand) {
            errors.push(`${name} must match its reviewed launch command: ${expectedCommand}`);
        }

        const match = demoCommandPattern.exec(command);
        if (!match) {
            errors.push(
                `${name} must execute exactly one examples/**/*.ts entrypoint with Bun; ` +
                'optional environment prefixes are NODE_ENV=development and TENSORFLOW_ENABLED=true'
            );
            continue;
        }

        const entrypoint = match[1];
        const entrypointPresent = entrypointExists(entrypoint);
        if (!entrypointPresent) {
            errors.push(`${name} points to missing entrypoint ${entrypoint}`);
        } else if (
            entrypointSource &&
            obsoleteLaunchInstructionPattern.test(entrypointSource(entrypoint))
        ) {
            errors.push(
                `${name} entrypoint ${entrypoint} contains an npm/npx launch instruction`
            );
        }
    }

    return errors;
};

/** Validate nested game packages which launch both agents and a dashboard. */
export const validateOwnedGamePackage = (
    packageLabel: string,
    scripts: Record<string, string>,
    runnerExists: boolean
): string[] => {
    const errors: string[] = [];
    if (scripts.game !== 'bun run run-demo.ts') {
        errors.push(`${packageLabel} game script must delegate to bun run run-demo.ts`);
    }
    if (!runnerExists) {
        errors.push(`${packageLabel} is missing its owned run-demo.ts launcher`);
    }

    for (const name of ownedGameRuntimeScriptNames) {
        const command = scripts[name];
        if (!command) {
            errors.push(`${packageLabel} is missing required runtime script '${name}'`);
            continue;
        }
        if (!ownedGameRuntimeCommandPattern.test(command)) {
            errors.push(
                `${packageLabel} runtime script '${name}' must execute exactly one Bun command`
            );
        }
    }

    const forbiddenRuntime = /\b(?:npm|npx|node|ts-node|kill|lsof)\b|(?:^|\s)&(?:\s|$)/;
    for (const [name, command] of Object.entries(scripts)) {
        if (forbiddenRuntime.test(command)) {
            errors.push(`${packageLabel} script '${name}' contains a non-Bun or unowned process command`);
        }
    }

    return errors;
};
