import { validateMigrationManifest } from '../../../scripts/lib/MigrationManifest';

const guardedMigration = 'if (require.main === module) { main(); }';

describe('migration manifest validation', () => {
    it('accepts a one-to-one mapping of guarded migrations to Bun scripts', () => {
        expect(validateMigrationManifest([
            { file: 'src/migrations/2026.01.first.ts', source: guardedMigration },
            { file: 'src/migrations/2026.02.second.ts', source: guardedMigration }
        ], {
            'migrate:first': 'bun run src/migrations/2026.01.first.ts',
            'migrate:second': 'bun run src/migrations/2026.02.second.ts --dry-run',
            build: 'tsc -b'
        })).toEqual([]);
    });

    it('reports orphaned, stale, duplicate, unsafe, and non-Bun entries', () => {
        const errors = validateMigrationManifest([
            { file: 'src/migrations/2026.01.orphaned.ts', source: guardedMigration },
            { file: 'src/migrations/2026.02.duplicate.ts', source: guardedMigration },
            { file: 'src/migrations/2026.03.unsafe.ts', source: 'main();' }
        ], {
            'migrate:first-copy': 'bun run src/migrations/2026.02.duplicate.ts',
            'migrate:second-copy': 'bun run src/migrations/2026.02.duplicate.ts',
            'migrate:stale': 'bun run src/migrations/2025.12.missing.ts',
            'migrate:node': 'node src/migrations/2026.03.unsafe.ts'
        });

        expect(errors).toEqual(expect.arrayContaining([
            expect.stringContaining('orphaned.ts has no migrate:* package script'),
            expect.stringContaining('duplicate.ts is exposed by multiple scripts'),
            expect.stringContaining('missing migration'),
            expect.stringContaining('migrate:node must run'),
            expect.stringContaining('unsafe.ts has no migrate:* package script'),
            expect.stringContaining('unsafe.ts must guard CLI execution')
        ]));
    });
});
