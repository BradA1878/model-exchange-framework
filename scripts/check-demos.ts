import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    EXPECTED_OWNED_GAME_PACKAGE_DIRECTORIES,
    EXPECTED_ROOT_DEMO_COMMANDS,
    validateDemoManifest,
    validateOwnedGamePackage
} from './lib/DemoManifest';

interface PackageManifest {
    scripts?: Record<string, string>;
}

const repositoryRoot = process.cwd();
const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')
) as PackageManifest;
const demoScripts = Object.entries(manifest.scripts ?? {})
    .filter(([name]) => name.startsWith('demo:'));
const errors = validateDemoManifest(
    manifest.scripts ?? {},
    (entrypoint) => existsSync(resolve(repositoryRoot, entrypoint)),
    EXPECTED_ROOT_DEMO_COMMANDS,
    (entrypoint) => readFileSync(resolve(repositoryRoot, entrypoint), 'utf8')
);
const examplesDirectory = resolve(repositoryRoot, 'examples');
const expectedOwnedGamePackages = new Set<string>(EXPECTED_OWNED_GAME_PACKAGE_DIRECTORIES);
let ownedGamePackages = 0;
for (const packageDirectory of EXPECTED_OWNED_GAME_PACKAGE_DIRECTORIES) {
    const packagePath = join(examplesDirectory, packageDirectory, 'package.json');
    if (!existsSync(packagePath)) {
        errors.push(`Required owned game package is missing: examples/${packageDirectory}/package.json`);
        continue;
    }

    const nestedManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageManifest;
    ownedGamePackages++;
    errors.push(...validateOwnedGamePackage(
        `examples/${packageDirectory}/package.json`,
        nestedManifest.scripts ?? {},
        existsSync(join(examplesDirectory, packageDirectory, 'run-demo.ts'))
    ));
}

for (const entry of readdirSync(examplesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || expectedOwnedGamePackages.has(entry.name)) {
        continue;
    }

    const packagePath = join(examplesDirectory, entry.name, 'package.json');
    if (!existsSync(packagePath)) {
        continue;
    }
    const nestedManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageManifest;
    if (Object.prototype.hasOwnProperty.call(nestedManifest.scripts ?? {}, 'game')) {
        errors.push(
            `examples/${entry.name}/package.json has a game script but is not listed in the ` +
            'reviewed owned game package manifest'
        );
    }
}

if (errors.length > 0) {
    process.stderr.write(`Demo launch validation failed:\n- ${errors.join('\n- ')}\n`);
    process.exitCode = 1;
} else {
    process.stdout.write(
        `Demo launch validation passed for ${demoScripts.length} root demo(s) and ` +
        `${ownedGamePackages} owned game launcher(s).\n`
    );
}
