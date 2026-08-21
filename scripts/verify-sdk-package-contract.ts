import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'mxf-sdk-package-contract-'));
if (dirname(temporaryRoot) !== tmpdir()) {
    throw new Error(`Unexpected temporary path: ${temporaryRoot}`);
}

const run = async (command: string[], cwd: string): Promise<string> => {
    const process = Bun.spawn(command, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ]);

    if (exitCode !== 0) {
        throw new Error(
            `${command.join(' ')} failed with exit code ${exitCode}\n${stdout}${stderr}`
        );
    }
    return `${stdout}${stderr}`;
};

const linkInstalledDependencies = async (consumerNodeModules: string): Promise<void> => {
    const repositoryNodeModules = join(repositoryRoot, 'node_modules');
    await mkdir(consumerNodeModules, { recursive: true });

    for (const entry of await readdir(repositoryNodeModules, { withFileTypes: true })) {
        if (entry.name === '@mxf-dev') {
            continue;
        }
        await symlink(
            join(repositoryNodeModules, entry.name),
            join(consumerNodeModules, entry.name),
            entry.isDirectory() ? 'dir' : 'file'
        );
    }
};

const packAndExtract = async (
    packageName: 'core' | 'sdk',
    destination: string
): Promise<string> => {
    const packageRoot = join(repositoryRoot, 'packages', packageName);
    const archiveDirectory = join(temporaryRoot, `${packageName}-archive`);
    await mkdir(archiveDirectory, { recursive: true });
    await run([
        'bun',
        'pm',
        'pack',
        '--ignore-scripts',
        '--destination',
        archiveDirectory,
        '--quiet',
    ], packageRoot);
    const archives = (await readdir(archiveDirectory))
        .filter((entry) => entry.endsWith('.tgz'));
    if (archives.length !== 1) {
        throw new Error(
            `Expected exactly one ${packageName} archive, found ${archives.length}`
        );
    }
    const archivePath = join(archiveDirectory, archives[0]);
    await mkdir(destination, { recursive: true });
    await run(['tar', '-xzf', archivePath, '-C', destination, '--strip-components=1'], repositoryRoot);
    return destination;
};

try {
    const consumerRoot = join(temporaryRoot, 'consumer');
    const consumerNodeModules = join(consumerRoot, 'node_modules');
    const mxfScope = join(consumerNodeModules, '@mxf-dev');
    await linkInstalledDependencies(consumerNodeModules);
    await mkdir(mxfScope, { recursive: true });

    await packAndExtract('core', join(mxfScope, 'core'));
    const packedSdk = await packAndExtract('sdk', join(mxfScope, 'sdk'));

    const sdkManifest = JSON.parse(
        await readFile(join(packedSdk, 'package.json'), 'utf8')
    ) as { exports?: Record<string, unknown> };
    if (!sdkManifest.exports ||
        Object.keys(sdkManifest.exports).join(',') !== '.,./package.json') {
        throw new Error('Packed SDK export map is not the curated root-only contract');
    }

    await writeFile(join(consumerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(consumerRoot, 'consumer.mjs'), `
import {
    CORE_MXF_TOOLS,
    MemoryScope,
    MxfSDK
} from '@mxf-dev/sdk';

if (typeof MxfSDK !== 'function' || MemoryScope.AGENT !== 'agent' ||
    !CORE_MXF_TOOLS.includes('task_complete')) {
    throw new Error('Packed SDK root runtime contract is incomplete');
}

let internalSubpathExposed = false;
try {
    await import('@mxf-dev/sdk/services/MxfService');
    internalSubpathExposed = true;
} catch {
    // Bun intentionally rejects subpaths absent from the package export map.
}
if (internalSubpathExposed) {
    throw new Error('Packed SDK exposed an internal service subpath');
}
`);
    await run(['bun', 'consumer.mjs'], consumerRoot);

    await writeFile(join(consumerRoot, 'consumer.ts'), `
import {
    ContentFormat,
    MemoryScope,
    type ChannelMemoryUpdate,
    type McpServerRegistrationResult,
    type MxfMessageOptions,
    type TaskConfig
} from '@mxf-dev/sdk';

const task: TaskConfig = {
    title: 'Verify declarations',
    description: 'Compile an external consumer against the packed SDK',
    assignedAgentIds: ['package-reviewer']
};
const registration: McpServerRegistrationResult = { toolsDiscovered: [] };
const memory: ChannelMemoryUpdate = { sharedState: { verified: true } };
const message: MxfMessageOptions = { format: ContentFormat.JSON };

void [task, registration, memory, message, MemoryScope.CHANNEL];
`);
    await writeFile(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: ['node'],
        },
        include: ['consumer.ts'],
    }, null, 2));

    const tscPath = join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    await run(['bun', tscPath, '--project', 'tsconfig.json'], consumerRoot);

    process.stdout.write(
        'Packed SDK contract verified: root runtime, strict declarations, and internal subpath rejection.\n'
    );
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}
