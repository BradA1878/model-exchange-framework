#!/usr/bin/env bun
/**
 * Import-specifier codemod for the workspace migration (Steps 2-4).
 *
 * Rewrites module specifiers in all five contexts — `from`, `require()`,
 * dynamic `import()`, `jest.mock()`, and `export ... from` — according to
 * step-specific rule tables. Rules run in order; the first matching rule
 * wins for a given specifier. Purely textual on specifier positions; tsc
 * is the verifier (`bun run build` must pass after every run).
 *
 * Usage: bun run scripts/codemods/rewrite-imports.ts --step <name> [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface Rule {
    match: RegExp;
    replace: string;
}

interface Group {
    name: string;
    files: string[];
    rules: Rule[];
}

const ROOT = join(import.meta.dir, '..', '..');

// Matches from/require/import()/jest.mock/export-from specifier positions.
// \s* spans newlines, so multi-line dynamic imports are covered.
const SPEC_ANCHOR = /((?:from\s+|require\(\s*|import\(\s*|jest\.mock\(\s*)(['"]))([^'"]+)(\2)/g;

const tsFiles = (dir: string, filter?: (name: string) => boolean): string[] =>
    readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith('.ts') && (!filter || filter(f)))
        .map((f) => join(dir, f));

const walkTs = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkTs(rel));
        else if (/\.(ts|tsx|vue)$/.test(entry.name)) out.push(rel);
    }
    return out;
};

// Step 2: the 15 server-coupled files carved out of src/shared into src/server.
const CARVED_TOOLS =
    'ActionValidationTools|AgentCommunicationTools|ContextMemoryTools|ControlLoopPhases|ControlLoopTools|CoordinationTools|DagTools|InferenceParameterTools|MetaTools|TaskBridgeTools';

// Step 3: src/shared (316 files) + src/sdk/config moved into packages/core/src.
// Every consumer's relative path into the old shared tree becomes @mxf-dev/core.
const STEP3_RULES: Rule[] = [
    { match: /^(?:\.\.\/)+shared\/(.*)$/, replace: '@mxf-dev/core/$1' },
    { match: /^(?:\.\.\/)+src\/shared\/(.*)$/, replace: '@mxf-dev/core/$1' },
    { match: /^@mxf\/shared\/(.*)$/, replace: '@mxf-dev/core/$1' },
    // sdk/config moved into core: ConfigManager keeps its name, the old
    // sdk/config/index.ts (server-connection helpers) became ServerConfig.ts.
    { match: /^(?:\.\.\/)+sdk\/config\/ConfigManager$/, replace: '@mxf-dev/core/config/ConfigManager' },
    { match: /^(?:\.\.\/)+sdk\/config(?:\/index)?$/, replace: '@mxf-dev/core/config/ServerConfig' },
];

// './config' means src/sdk/config ONLY inside src/sdk — elsewhere it can be a
// local module (e.g. src/server/api/routes/config.ts), so these rules must not
// run against other groups.
const STEP3_SDK_RULES: Rule[] = [
    ...STEP3_RULES,
    { match: /^\.\/config\/ConfigManager$/, replace: '@mxf-dev/core/config/ConfigManager' },
    { match: /^\.\/config(?:\/index)?$/, replace: '@mxf-dev/core/config/ServerConfig' },
];

// Step 4: src/sdk (minus cli/) moved into packages/sdk/src.
const STEP4_RULES: Rule[] = [
    { match: /^(?:\.\.\/)+src\/sdk(?:\/index)?$/, replace: '@mxf-dev/sdk' },
    { match: /^(?:\.\.\/)+src\/sdk\/(.*)$/, replace: '@mxf-dev/sdk/$1' },
    { match: /^(?:\.\.\/)+sdk(?:\/index)?$/, replace: '@mxf-dev/sdk' },
    { match: /^(?:\.\.\/)+sdk\/(.*)$/, replace: '@mxf-dev/sdk/$1' },
];

const STEPS: Record<string, Group[]> = {
    'step4-sdk': [
        { name: 'cli consumers', files: walkTs('src/cli'), rules: STEP4_RULES },
        { name: 'desktop consumers', files: walkTs('src/desktop'), rules: STEP4_RULES },
        { name: 'examples', files: walkTs('examples'), rules: STEP4_RULES },
        { name: 'tests', files: walkTs('tests'), rules: STEP4_RULES },
    ],
    'step3-core': [
        { name: 'server consumers', files: walkTs('src/server'), rules: STEP3_RULES },
        { name: 'sdk consumers (in place)', files: walkTs('src/sdk'), rules: STEP3_SDK_RULES },
        { name: 'cli consumers', files: walkTs('src/cli'), rules: STEP3_RULES },
        { name: 'desktop consumers', files: walkTs('src/desktop'), rules: STEP3_RULES },
        { name: 'migrations', files: walkTs('src/migrations'), rules: STEP3_RULES },
        { name: 'tests', files: walkTs('tests'), rules: STEP3_RULES },
        { name: 'examples', files: walkTs('examples'), rules: STEP3_RULES },
        { name: 'scripts', files: walkTs('scripts'), rules: STEP3_RULES },
        { name: 'dashboard', files: walkTs('dashboard/src'), rules: STEP3_RULES },
    ],
    'step2-carve': [
        {
            name: 'carved tools (src/server/mcp/tools)',
            files: tsFiles('src/server/mcp/tools'),
            rules: [
                // Old escape hatch into the server now resolves within it.
                { match: /^\.\.\/\.\.\/\.\.\/\.\.\/server\/(.*)$/, replace: '../../$1' },
                // Fellow carved services keep a server-local path.
                {
                    match: /^\.\.\/\.\.\/\.\.\/services\/(ChannelContextService|PatternMemoryService)$/,
                    replace: '../../services/$1',
                },
                // Everything else three levels up was the shared root.
                { match: /^\.\.\/\.\.\/\.\.\/(.*)$/, replace: '../../../shared/$1' },
                // One level up was shared/protocols/mcp.
                { match: /^\.\.\/(?!\.\.)(.*)$/, replace: '../../../shared/protocols/mcp/$1' },
                // Same-dir siblings that did NOT move stay under shared.
                {
                    match: new RegExp(`^\\./(?!(?:${CARVED_TOOLS})$)(.*)$`),
                    replace: '../../../shared/protocols/mcp/tools/$1',
                },
            ],
        },
        {
            name: 'carved hybrid services (src/server/mcp/services)',
            files: tsFiles('src/server/mcp/services'),
            rules: [
                { match: /^\.\.\/\.\.\/\.\.\/\.\.\/server\/(.*)$/, replace: '../../$1' },
                { match: /^\.\.\/\.\.\/\.\.\/(.*)$/, replace: '../../../shared/$1' },
                {
                    match: /^\.\/(?!(?:HybridMcpService|HybridMcpToolRegistry)$)(.*)$/,
                    replace: '../../../shared/protocols/mcp/services/$1',
                },
            ],
        },
        {
            name: 'carved shared services (src/server/services)',
            files: tsFiles('src/server/services', (f) =>
                ['ChannelContextService.ts', 'PatternMemoryService.ts'].includes(f)
            ),
            rules: [
                { match: /^\.\.\/\.\.\/server\/(.*)$/, replace: '../$1' },
                { match: /^\.\.\/(?!\.\.)(.*)$/, replace: '../../shared/$1' },
                { match: /^\.\/(.*)$/, replace: '../../shared/services/$1' },
            ],
        },
    ],
};

const main = (): void => {
    const args = process.argv.slice(2);
    const stepIdx = args.indexOf('--step');
    const step = stepIdx >= 0 ? args[stepIdx + 1] : undefined;
    const dryRun = args.includes('--dry-run');

    if (!step || !STEPS[step]) {
        console.error(`Unknown or missing --step. Available: ${Object.keys(STEPS).join(', ')}`);
        process.exit(1);
    }

    let totalChanges = 0;
    for (const group of STEPS[step]) {
        for (const rel of group.files) {
            const abs = join(ROOT, rel);
            const before = readFileSync(abs, 'utf8');
            let changes = 0;
            const after = before.replace(SPEC_ANCHOR, (whole, prefix, _q, spec, suffix) => {
                for (const rule of group.rules) {
                    if (rule.match.test(spec)) {
                        const next = spec.replace(rule.match, rule.replace);
                        if (next !== spec) {
                            changes++;
                            if (dryRun) console.log(`  ${rel}: ${spec} -> ${next}`);
                            return `${prefix}${next}${suffix}`;
                        }
                        return whole;
                    }
                }
                return whole;
            });
            if (changes > 0 && !dryRun) writeFileSync(abs, after);
            totalChanges += changes;
        }
        console.log(`[${group.name}] processed ${group.files.length} files`);
    }
    console.log(`${dryRun ? 'Would rewrite' : 'Rewrote'} ${totalChanges} specifiers.`);
};

main();
