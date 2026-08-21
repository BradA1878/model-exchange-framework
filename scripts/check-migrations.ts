import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMigrationManifest } from './lib/MigrationManifest';

interface PackageManifest {
    scripts?: Record<string, string>;
}

const repositoryRoot = process.cwd();
const migrationsDirectory = join(repositoryRoot, 'src', 'migrations');
const migrationFiles = readdirSync(migrationsDirectory)
    .filter(file => /^\d{4}\.\d{2}\..+\.ts$/.test(file))
    .sort();
const migrations = migrationFiles.map(file => ({
    file: `src/migrations/${file}`,
    source: readFileSync(join(migrationsDirectory, file), 'utf8')
}));
const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
) as PackageManifest;
const errors = validateMigrationManifest(migrations, manifest.scripts ?? {});

if (errors.length > 0) {
    process.stderr.write(`Migration manifest validation failed:\n- ${errors.join('\n- ')}\n`);
    process.exitCode = 1;
} else {
    process.stdout.write(
        `Migration manifest validation passed for ${migrations.length} migration(s).\n`
    );
}
