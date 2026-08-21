import {
    validateDemoManifest,
    validateOwnedGamePackage
} from '../../../scripts/lib/DemoManifest';

describe('demo package-script validation', () => {
    const existingEntrypoints = new Set([
        'examples/basic/demo.ts',
        'examples/tensor/demo.ts',
    ]);
    const exists = (entrypoint: string): boolean => existingEntrypoints.has(entrypoint);
    const expectedDemoCommands = {
        'demo:basic': 'NODE_ENV=development bun run examples/basic/demo.ts',
        'demo:tensor':
            'NODE_ENV=development TENSORFLOW_ENABLED=true bun run examples/tensor/demo.ts'
    };
    const validOwnedGameScripts = {
        dev: 'bun run server/index.ts',
        'dev:client': 'bun run --cwd client dev',
        'connect-agents': 'NODE_ENV=development bun run connect-agents.ts',
        game: 'bun run run-demo.ts',
        start: 'bun run dist/index.js'
    };

    it('accepts one owned Bun entrypoint with the reviewed environment prefixes', () => {
        expect(validateDemoManifest({
            'demo:basic': 'NODE_ENV=development bun run examples/basic/demo.ts',
            'demo:tensor': 'NODE_ENV=development TENSORFLOW_ENABLED=true bun run examples/tensor/demo.ts',
        }, exists, expectedDemoCommands)).toEqual([]);
    });

    it.each([
        'NODE_ENV=test bun run examples/basic/demo.ts',
        'bun run examples/basic/demo.ts & bun run examples/tensor/demo.ts',
        'bun run examples/basic/demo.ts && rm -rf output',
        'bun run examples/basic/demo.ts | tee output.log',
        'npx ts-node examples/basic/demo.ts',
    ])('rejects shell or test-environment launch command %s', (command) => {
        expect(validateDemoManifest(
            { 'demo:unsafe': command },
            exists,
            { 'demo:unsafe': command }
        )).toEqual([
            expect.stringContaining('must execute exactly one')
        ]);
    });

    it('rejects a removed or unreviewed root demo script', () => {
        expect(validateDemoManifest({
            'demo:basic': 'NODE_ENV=development bun run examples/basic/demo.ts'
        }, exists, expectedDemoCommands)).toEqual([
            'package.json is missing required demo:tensor script'
        ]);

        expect(validateDemoManifest({
            'demo:basic': 'NODE_ENV=development bun run examples/basic/demo.ts',
            'demo:extra': 'bun run examples/basic/demo.ts'
        }, exists, { 'demo:basic': expectedDemoCommands['demo:basic'] })).toEqual([
            'demo:extra is not listed in the reviewed root demo manifest'
        ]);
    });

    it('rejects rewiring reviewed names to other existing demo entrypoints', () => {
        expect(validateDemoManifest({
            'demo:basic': expectedDemoCommands['demo:tensor'],
            'demo:tensor': expectedDemoCommands['demo:basic']
        }, exists, expectedDemoCommands)).toEqual([
            `demo:basic must match its reviewed launch command: ${expectedDemoCommands['demo:basic']}`,
            `demo:tensor must match its reviewed launch command: ${expectedDemoCommands['demo:tensor']}`
        ]);
    });

    it.each([
        'Run with: npm run demo:basic',
        'Start with: npm start',
        'Execute with: npx tsx examples/basic/demo.ts'
    ])('rejects obsolete launch instructions in reviewed entrypoint source: %s', (source) => {
        expect(validateDemoManifest({
            'demo:basic': expectedDemoCommands['demo:basic']
        }, exists, {
            'demo:basic': expectedDemoCommands['demo:basic']
        }, () => source)).toEqual([
            expect.stringContaining('contains an npm/npx launch instruction')
        ]);
    });

    it('allows entrypoint prose that refers to an npm package without a launch command', () => {
        expect(validateDemoManifest({
            'demo:basic': expectedDemoCommands['demo:basic']
        }, exists, {
            'demo:basic': expectedDemoCommands['demo:basic']
        }, () => 'The SDK is also published as an npm package.')).toEqual([]);
    });

    it('rejects missing entrypoints and an empty demo manifest', () => {
        expect(validateDemoManifest({
            'demo:missing': 'bun run examples/missing/demo.ts'
        }, exists, { 'demo:missing': 'bun run examples/missing/demo.ts' })).toEqual([
            expect.stringContaining('points to missing entrypoint')
        ]);
        expect(validateDemoManifest({
            build: 'tsc -b'
        }, exists, { 'demo:basic': expectedDemoCommands['demo:basic'] })).toEqual([
            'package.json does not define any demo:* scripts'
        ]);
    });

    it('requires nested game packages to use an owned Bun launcher', () => {
        expect(validateOwnedGamePackage(
            'examples/game/package.json',
            validOwnedGameScripts,
            true
        )).toEqual([]);

        expect(validateOwnedGamePackage('examples/game/package.json', {
            ...validOwnedGameScripts,
            game: 'npm run agents & npm run dashboard',
            cleanup: 'lsof -ti:3000 | xargs kill -9'
        }, false)).toEqual(expect.arrayContaining([
            expect.stringContaining('must delegate'),
            expect.stringContaining('missing its owned'),
            expect.stringContaining("script 'game'"),
            expect.stringContaining("script 'cleanup'")
        ]));
    });

    it('rejects deletion or shell chaining in nested runtime scripts', () => {
        const withoutGame = Object.fromEntries(
            Object.entries(validOwnedGameScripts).filter(([name]) => name !== 'game')
        );
        expect(validateOwnedGamePackage(
            'examples/game/package.json',
            withoutGame,
            true
        )).toEqual(expect.arrayContaining([
            expect.stringContaining('game script must delegate'),
            expect.stringContaining("missing required runtime script 'game'")
        ]));

        for (const suffix of [
            '; bun run extra.ts',
            ' && bun run extra.ts',
            ' | tee output.log',
            ' & bun run extra.ts',
            ' > output.log',
            ' $(bun run extra.ts)'
        ]) {
            expect(validateOwnedGamePackage('examples/game/package.json', {
                ...validOwnedGameScripts,
                dev: `bun run server/index.ts${suffix}`
            }, true)).toEqual(expect.arrayContaining([
                expect.stringContaining("runtime script 'dev' must execute exactly one Bun command")
            ]));
        }
    });
});
