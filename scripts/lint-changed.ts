import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    lintMessageTouchesRanges,
    mergeLineRanges,
    parseAddedLineRanges,
    type LineRange
} from './lib/ChangedLineLint';

interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
}

interface EslintMessage {
    ruleId: string | null;
    severity: number;
    message: string;
    line?: number;
    column?: number;
    endLine?: number;
    fatal?: boolean;
}

interface EslintResult {
    filePath: string;
    messages: EslintMessage[];
}

const repositoryRoot = process.cwd();
const supportedSource = /\.(?:cts|mts|ts|tsx)$/;

const run = (command: string, args: string[]): CommandResult => {
    const result = spawnSync(command, args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });

    if (result.error) {
        throw result.error;
    }

    return {
        status: result.status ?? 1,
        stdout: result.stdout,
        stderr: result.stderr
    };
};

const runGit = (args: string[]): string => {
    const result = run('git', args);
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
    }
    return result.stdout;
};

const splitLines = (value: string): string[] =>
    value.split('\n').map(line => line.trim()).filter(Boolean);

const isCommit = (candidate: string): boolean => {
    if (!candidate || /^0+$/.test(candidate)) {
        return false;
    }
    return run('git', ['cat-file', '-e', `${candidate}^{commit}`]).status === 0;
};

const requestedBase = (): string | undefined => {
    const baseArgument = process.argv.find(argument => argument.startsWith('--base='));
    return baseArgument?.slice('--base='.length) || process.env.MXF_LINT_BASE;
};

const resolveBase = (): string | undefined => {
    const candidates = [requestedBase(), 'origin/main', 'main', 'HEAD^'];
    return candidates.find((candidate): candidate is string =>
        candidate !== undefined && isCommit(candidate)
    );
};

const collectChangedFiles = (base: string | undefined): {
    files: string[];
    untracked: Set<string>;
} => {
    const committed = base
        ? splitLines(runGit([
            'diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...HEAD`, '--'
        ]))
        : [];
    const working = splitLines(runGit([
        'diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--'
    ]));
    const untracked = new Set(splitLines(runGit([
        'ls-files', '--others', '--exclude-standard'
    ])));
    const files = [...new Set([...committed, ...working, ...untracked])]
        .filter(file => supportedSource.test(file))
        .filter(file => existsSync(resolve(repositoryRoot, file)));

    return { files, untracked };
};

const rangesForFile = (
    file: string,
    base: string | undefined,
    untracked: Set<string>
): LineRange[] => {
    if (untracked.has(file)) {
        const lineCount = readFileSync(resolve(repositoryRoot, file), 'utf8').split('\n').length;
        return [[1, lineCount]];
    }

    const diffs = [
        base
            ? runGit(['diff', '--unified=0', '--no-color', `${base}...HEAD`, '--', file])
            : '',
        runGit(['diff', '--unified=0', '--no-color', 'HEAD', '--', file])
    ];
    return mergeLineRanges(diffs.flatMap(parseAddedLineRanges));
};

const relativePath = (filePath: string): string => {
    const localPath = relative(repositoryRoot, filePath);
    return localPath.startsWith('..') ? filePath : localPath;
};

const main = (): void => {
    const base = resolveBase();
    const { files, untracked } = collectChangedFiles(base);
    if (files.length === 0) {
        process.stdout.write('Changed-line lint: no changed TypeScript files.\n');
        return;
    }

    const ranges = new Map(files.map(file => [
        file,
        rangesForFile(file, base, untracked)
    ]));
    const lint = run('bun', [
        'x', 'eslint', ...files, '--format', 'json', '--no-error-on-unmatched-pattern'
    ]);

    let results: EslintResult[];
    try {
        results = JSON.parse(lint.stdout) as EslintResult[];
    } catch {
        throw new Error(lint.stderr.trim() || 'ESLint did not return JSON output');
    }

    let errors = 0;
    let warnings = 0;
    for (const result of results) {
        const file = relativePath(result.filePath);
        const fileRanges = ranges.get(file) ?? [];

        for (const message of result.messages) {
            const appliesToChange = message.fatal === true ||
                lintMessageTouchesRanges(message, fileRanges);
            if (!appliesToChange || message.severity === 0) {
                continue;
            }

            if (message.severity === 2) {
                errors++;
            } else {
                warnings++;
            }
            const location = message.line === undefined
                ? file
                : `${file}:${message.line}:${message.column ?? 1}`;
            const severity = message.severity === 2 ? 'error' : 'warning';
            process.stdout.write(
                `${location} ${severity} ${message.ruleId ?? 'fatal'} ${message.message}\n`
            );
        }
    }

    process.stdout.write(
        `Changed-line lint: ${errors} error(s), ${warnings} warning(s) across ` +
        `${files.length} changed TypeScript file(s)` +
        `${base ? ` since ${base}` : ''}.\n`
    );
    if (errors > 0 || warnings > 0) {
        process.exitCode = 1;
    }
};

try {
    main();
} catch (error) {
    process.stderr.write(
        `Changed-line lint failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
}
