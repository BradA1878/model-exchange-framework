export interface MigrationManifestEntry {
    file: string;
    source: string;
}

const migrationCommandPattern = /^bun run (src\/migrations\/[^\s]+\.ts)(?:\s|$)/;
const directExecutionGuardPattern = /if\s*\(\s*require\.main\s*===\s*module\s*\)/;

/**
 * Validate that every dated migration is discoverable and safe to import in CI.
 */
export const validateMigrationManifest = (
    migrations: MigrationManifestEntry[],
    scripts: Record<string, string>
): string[] => {
    const errors: string[] = [];
    const migrationFiles = new Set(migrations.map(migration => migration.file));
    const scriptTargets = new Map<string, string[]>();

    for (const [name, command] of Object.entries(scripts)) {
        if (!name.startsWith('migrate:')) {
            continue;
        }

        const match = migrationCommandPattern.exec(command);
        if (!match) {
            errors.push(`${name} must run a src/migrations/*.ts file with Bun`);
            continue;
        }

        const names = scriptTargets.get(match[1]) ?? [];
        names.push(name);
        scriptTargets.set(match[1], names);
        if (!migrationFiles.has(match[1])) {
            errors.push(`${name} points to missing migration ${match[1]}`);
        }
    }

    for (const migration of migrations) {
        const names = scriptTargets.get(migration.file) ?? [];
        if (names.length === 0) {
            errors.push(`${migration.file} has no migrate:* package script`);
        } else if (names.length > 1) {
            errors.push(`${migration.file} is exposed by multiple scripts: ${names.join(', ')}`);
        }

        if (!directExecutionGuardPattern.test(migration.source)) {
            errors.push(`${migration.file} must guard CLI execution with require.main === module`);
        }
    }

    return errors;
};
