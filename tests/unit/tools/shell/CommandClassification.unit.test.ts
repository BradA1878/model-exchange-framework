/**
 * Unit tests for CommandClassification — classifies shell commands by their
 * nature (read, write, search, git, etc.) for downstream decision-making.
 */

import {
    classifyCommand,
    isReadOnlyCommand,
    CommandCategory,
    CommandClassification
} from '@mxf/shared/protocols/mcp/tools/shell/CommandClassification';

// ---------------------------------------------------------------------------
// READ commands
// ---------------------------------------------------------------------------

describe('classifyCommand — READ category', () => {
    const readCommands = ['cat file.txt', 'head -n 10 file', 'tail -f log', 'wc -l file', 'stat file'];

    it.each(readCommands)('classifies "%s" as READ and readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// SEARCH commands
// ---------------------------------------------------------------------------

describe('classifyCommand — SEARCH category', () => {
    const searchCommands = ['grep pattern file', 'rg pattern', 'find . -name "*.ts"', 'which node', 'locate file'];

    it.each(searchCommands)('classifies "%s" as SEARCH and readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.SEARCH);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// LIST commands
// ---------------------------------------------------------------------------

describe('classifyCommand — LIST category', () => {
    const listCommands = ['ls', 'ls -la', 'tree', 'du -sh', 'df -h'];

    it.each(listCommands)('classifies "%s" as LIST and readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.LIST);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// WRITE commands
// ---------------------------------------------------------------------------

describe('classifyCommand — WRITE category', () => {
    it('classifies rm as WRITE and not readOnly', () => {
        const result = classifyCommand('rm file.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
    });

    it('classifies mkdir as WRITE with isSilent true', () => {
        const result = classifyCommand('mkdir -p /tmp/newdir');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
        expect(result.isSilent).toBe(true);
    });

    it('classifies touch as WRITE with isSilent true', () => {
        const result = classifyCommand('touch newfile.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isSilent).toBe(true);
    });

    it('classifies cp as WRITE with isSilent true', () => {
        const result = classifyCommand('cp a.txt b.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isSilent).toBe(true);
    });

    it('classifies mv as WRITE with isSilent true', () => {
        const result = classifyCommand('mv a.txt b.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isSilent).toBe(true);
    });

    it('classifies chmod as WRITE', () => {
        const result = classifyCommand('chmod 644 file.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// GIT commands — read-only subcommands
// ---------------------------------------------------------------------------

describe('classifyCommand — GIT read-only', () => {
    const gitReadOnlyCommands = [
        'git status',
        'git log --oneline',
        'git diff HEAD',
        'git show HEAD',
        'git branch',
        'git remote -v',
        'git blame file.ts',
        'git ls-files',
    ];

    it.each(gitReadOnlyCommands)('classifies "%s" as GIT and readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// GIT commands — write subcommands
// ---------------------------------------------------------------------------

describe('classifyCommand — GIT write', () => {
    const gitWriteCommands = [
        'git push origin main',
        'git commit -m "msg"',
        'git add file.txt',
        'git merge feature',
        'git rebase main',
        'git checkout -b new-branch',
    ];

    it.each(gitWriteCommands)('classifies "%s" as GIT and NOT readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// GIT — special subcommand handling
// ---------------------------------------------------------------------------

describe('classifyCommand — GIT special cases', () => {
    it('git branch -D is write (force delete)', () => {
        const result = classifyCommand('git branch -D feature');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });

    it('git branch -d is write (delete)', () => {
        const result = classifyCommand('git branch -d feature');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });

    it('git branch (list) is readOnly', () => {
        const result = classifyCommand('git branch');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });

    it('git tag -d is write (delete tag)', () => {
        const result = classifyCommand('git tag -d v1.0');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });

    it('git tag (list) is readOnly', () => {
        const result = classifyCommand('git tag');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });

    it('git stash list is readOnly', () => {
        const result = classifyCommand('git stash list');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });

    it('git stash (without list) is write', () => {
        const result = classifyCommand('git stash');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });

    it('git config --get is readOnly', () => {
        const result = classifyCommand('git config --get user.name');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });

    it('git config (set) is write', () => {
        const result = classifyCommand('git config user.name "Brad"');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(false);
    });

    it('bare git (no subcommand) is readOnly', () => {
        const result = classifyCommand('git');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });

    it('git with global flags before subcommand', () => {
        const result = classifyCommand('git -C /path/to/repo status');
        expect(result.category).toBe(CommandCategory.GIT);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// EXECUTE commands
// ---------------------------------------------------------------------------

describe('classifyCommand — EXECUTE category', () => {
    const executeCommands = ['node script.js', 'python3 script.py', 'bun run test', 'npm install', 'cargo build'];

    it.each(executeCommands)('classifies "%s" as EXECUTE and NOT readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.EXECUTE);
        expect(result.isReadOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// NETWORK commands
// ---------------------------------------------------------------------------

describe('classifyCommand — NETWORK category', () => {
    const networkCommands = ['curl http://example.com', 'wget http://example.com', 'ping localhost', 'ssh user@host'];

    it.each(networkCommands)('classifies "%s" as NETWORK and NOT readOnly', (cmd) => {
        const result = classifyCommand(cmd);
        expect(result.category).toBe(CommandCategory.NETWORK);
        expect(result.isReadOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// SYSTEM commands
// ---------------------------------------------------------------------------

describe('classifyCommand — SYSTEM category', () => {
    it('classifies read-only system commands', () => {
        const readOnlySys = ['ps aux', 'free -m', 'uptime', 'uname -a', 'whoami', 'id', 'env', 'printenv'];
        for (const cmd of readOnlySys) {
            const result = classifyCommand(cmd);
            expect(result.category).toBe(CommandCategory.SYSTEM);
            expect(result.isReadOnly).toBe(true);
        }
    });

    it('classifies write system commands as NOT readOnly', () => {
        const writeSys = ['kill 1234', 'killall node', 'systemctl restart nginx'];
        for (const cmd of writeSys) {
            const result = classifyCommand(cmd);
            expect(result.category).toBe(CommandCategory.SYSTEM);
            expect(result.isReadOnly).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// Semantic neutral commands
// ---------------------------------------------------------------------------

describe('classifyCommand — semantic neutral', () => {
    it('classifies echo as UNKNOWN with isSemanticNeutral true', () => {
        const result = classifyCommand('echo hello');
        expect(result.category).toBe(CommandCategory.UNKNOWN);
        expect(result.isReadOnly).toBe(true);
        expect(result.isSemanticNeutral).toBe(true);
    });

    it('classifies printf as semantic neutral', () => {
        const result = classifyCommand('printf "%s" hello');
        expect(result.isSemanticNeutral).toBe(true);
    });

    it('classifies true as semantic neutral', () => {
        const result = classifyCommand('true');
        expect(result.isSemanticNeutral).toBe(true);
    });

    it('classifies false as semantic neutral', () => {
        const result = classifyCommand('false');
        expect(result.isSemanticNeutral).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Data processing commands
// ---------------------------------------------------------------------------

describe('classifyCommand — data processing', () => {
    it('classifies jq as READ and readOnly', () => {
        const result = classifyCommand('jq .name package.json');
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });

    it('classifies awk as READ and readOnly', () => {
        const result = classifyCommand("awk '{print $1}' file.txt");
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });

    it('classifies sort as READ and readOnly', () => {
        const result = classifyCommand('sort file.txt');
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// sed — special handling for -i flag
// ---------------------------------------------------------------------------

describe('classifyCommand — sed', () => {
    it('sed without -i is READ and readOnly', () => {
        const result = classifyCommand("sed 's/foo/bar/' file.txt");
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });

    it('sed with -i is WRITE and NOT readOnly', () => {
        const result = classifyCommand("sed -i 's/foo/bar/' file.txt");
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
        expect(result.isSilent).toBe(true);
    });

    it('sed with --in-place is WRITE', () => {
        const result = classifyCommand("sed --in-place 's/foo/bar/' file.txt");
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Compound commands
// ---------------------------------------------------------------------------

describe('classifyCommand — compound commands', () => {
    it('cat file && rm file -> WRITE (most dangerous wins)', () => {
        const result = classifyCommand('cat file.txt && rm file.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
    });

    it('ls && cat file -> READ (both are read-only, READ > LIST in priority)', () => {
        const result = classifyCommand('ls && cat file.txt');
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });

    it('echo hello; rm file -> WRITE (most dangerous)', () => {
        const result = classifyCommand('echo hello; rm file.txt');
        expect(result.category).toBe(CommandCategory.WRITE);
        expect(result.isReadOnly).toBe(false);
    });

    it('isReadOnly is true only when ALL subcommands are readOnly', () => {
        expect(classifyCommand('ls && cat file').isReadOnly).toBe(true);
        expect(classifyCommand('ls && rm file').isReadOnly).toBe(false);
    });

    it('isSilent is true only when ALL subcommands are silent', () => {
        const result = classifyCommand('mkdir dir && touch file');
        expect(result.isSilent).toBe(true);
    });

    it('isSemanticNeutral is true only when ALL subcommands are semantic neutral', () => {
        expect(classifyCommand('echo hello && echo world').isSemanticNeutral).toBe(true);
        expect(classifyCommand('echo hello && ls').isSemanticNeutral).toBe(false);
    });

    it('handles || (logical OR) compounds', () => {
        const result = classifyCommand('test -f file || echo "not found"');
        // Should not throw, and should classify
        expect(result.category).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Pipeline commands
// ---------------------------------------------------------------------------

describe('classifyCommand — pipelines', () => {
    it('classifies by the first command (data source) in a pipeline', () => {
        // cat file | grep pattern -> cat is the source, classified as READ
        const result = classifyCommand('cat file | grep pattern');
        expect(result.category).toBe(CommandCategory.READ);
        expect(result.isReadOnly).toBe(true);
    });

    it('ls | sort -> LIST (ls is the source)', () => {
        const result = classifyCommand('ls | sort');
        expect(result.category).toBe(CommandCategory.LIST);
        expect(result.isReadOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Env prefix handling
// ---------------------------------------------------------------------------

describe('classifyCommand — env prefixes', () => {
    it('strips env var prefix and classifies the actual command', () => {
        const result = classifyCommand('NODE_ENV=test node script.js');
        expect(result.category).toBe(CommandCategory.EXECUTE);
    });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('classifyCommand — edge cases', () => {
    it('empty string returns UNKNOWN, readOnly, silent', () => {
        const result = classifyCommand('');
        expect(result.category).toBe(CommandCategory.UNKNOWN);
        expect(result.isReadOnly).toBe(true);
        expect(result.isSilent).toBe(true);
    });

    it('whitespace-only string returns UNKNOWN, readOnly, silent', () => {
        const result = classifyCommand('   ');
        expect(result.category).toBe(CommandCategory.UNKNOWN);
        expect(result.isReadOnly).toBe(true);
    });

    it('unknown command returns UNKNOWN, NOT readOnly', () => {
        const result = classifyCommand('myCustomBinary --flag');
        expect(result.category).toBe(CommandCategory.UNKNOWN);
        expect(result.isReadOnly).toBe(false);
    });

    it('does not split on pipe inside quotes', () => {
        // 'echo "hello | world"' should be a single command, not a pipeline
        const result = classifyCommand('echo "hello | world"');
        expect(result.isSemanticNeutral).toBe(true);
    });

    it('does not split on && inside quotes', () => {
        const result = classifyCommand("echo 'cmd1 && cmd2'");
        expect(result.isSemanticNeutral).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// isReadOnlyCommand convenience function
// ---------------------------------------------------------------------------

describe('isReadOnlyCommand', () => {
    it('returns true for read-only commands', () => {
        expect(isReadOnlyCommand('cat file.txt')).toBe(true);
        expect(isReadOnlyCommand('ls -la')).toBe(true);
        expect(isReadOnlyCommand('git status')).toBe(true);
        expect(isReadOnlyCommand('grep pattern file')).toBe(true);
    });

    it('returns false for write commands', () => {
        expect(isReadOnlyCommand('rm file.txt')).toBe(false);
        expect(isReadOnlyCommand('git push')).toBe(false);
        expect(isReadOnlyCommand('node script.js')).toBe(false);
        expect(isReadOnlyCommand('curl url')).toBe(false);
    });
});
