/**
 * Unit tests for CommandSemantics — exit code interpretation for shell commands.
 * Tests that agents correctly distinguish between genuine errors and
 * semantically meaningful non-zero exit codes.
 */

import {
    interpretExitCode,
    extractExitCodeCommand,
    CommandSemanticResult
} from '@mxf/shared/protocols/mcp/tools/shell/CommandSemantics';

// ---------------------------------------------------------------------------
// extractExitCodeCommand
// ---------------------------------------------------------------------------

describe('extractExitCodeCommand', () => {
    it('extracts a simple command name', () => {
        expect(extractExitCodeCommand('grep pattern file.txt')).toBe('grep');
    });

    it('extracts command from a pipeline (last command wins)', () => {
        expect(extractExitCodeCommand('cat file | grep foo')).toBe('grep');
        expect(extractExitCodeCommand('ls | sort | head')).toBe('head');
    });

    it('extracts command from a sequential chain (last command wins)', () => {
        expect(extractExitCodeCommand('cd /tmp && ls')).toBe('ls');
        expect(extractExitCodeCommand('echo hello; grep foo bar')).toBe('grep');
    });

    it('strips env-var prefixes', () => {
        expect(extractExitCodeCommand('FOO=bar grep pattern')).toBe('grep');
        expect(extractExitCodeCommand('A=1 B=2 node script.js')).toBe('node');
    });

    it('strips env-var prefixes with quoted values', () => {
        expect(extractExitCodeCommand("FOO='hello world' grep pattern")).toBe('grep');
        expect(extractExitCodeCommand('FOO="hello world" grep pattern')).toBe('grep');
    });

    it('handles combined pipeline and env prefix', () => {
        expect(extractExitCodeCommand('cat file | FOO=bar grep pattern')).toBe('grep');
    });

    it('handles combined sequential and pipeline', () => {
        // "cd /tmp && cat file | grep foo" -> last segment is "cat file | grep foo"
        // -> pipeline last is "grep foo" -> base command is "grep"
        expect(extractExitCodeCommand('cd /tmp && cat file | grep foo')).toBe('grep');
    });

    it('strips path prefix from command', () => {
        expect(extractExitCodeCommand('/usr/bin/grep pattern')).toBe('grep');
        expect(extractExitCodeCommand('/usr/local/bin/curl http://example.com')).toBe('curl');
    });

    it('returns empty string for empty input', () => {
        expect(extractExitCodeCommand('')).toBe('');
        expect(extractExitCodeCommand('   ')).toBe('');
    });

    it('handles command with no arguments', () => {
        expect(extractExitCodeCommand('ls')).toBe('ls');
    });

    it('does not split on || (logical OR)', () => {
        // "true || grep foo" is sequential, not a pipe
        // Sequential split on || should still work: last segment is "grep foo"
        // Actually the code splits on && and ; for sequential, but || might not be split.
        // Let's test: the regex splits on /&&|;/ for sequential, so || is NOT split.
        // But the pipe regex splits on standalone |, not ||.
        // So "true || grep foo" -> pipe split: the regex (?<!\|)\|(?!\|) won't match ||
        // -> sequential split on && or ; won't match either
        // -> lastSegment = "true || grep foo"
        // -> env strip -> "true" (first token)
        // Actually wait, it goes through pipe split first. Let me re-read the code.
        // pipeSegments splits on (?<!\|)\|(?!\|) which excludes ||, so "true || grep foo" stays as one segment.
        // Then sequential splits on /&&|;/, which doesn't match ||.
        // So lastSegment = "true || grep foo", first token = "true".
        expect(extractExitCodeCommand('true || grep foo')).toBe('true');
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — exit code 0 (universal success)
// ---------------------------------------------------------------------------

describe('interpretExitCode — exit code 0', () => {
    it('returns success for any command with exit code 0', () => {
        const commands = ['grep foo', 'diff a b', 'test -f x', 'curl url', 'find .', 'unknown_cmd'];
        for (const cmd of commands) {
            const result = interpretExitCode(cmd, 0);
            expect(result.isError).toBe(false);
            expect(result.isSemanticNonZero).toBe(false);
            expect(result.meaning).toContain('successfully');
        }
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — grep semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — grep', () => {
    it('exit 1 means "No matches found" and is NOT an error', () => {
        const result = interpretExitCode('grep pattern file.txt', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('No matches found');
    });

    it('exit 2 is a real error', () => {
        const result = interpretExitCode('grep "[bad-regex" file.txt', 2);
        expect(result.isError).toBe(true);
        expect(result.isSemanticNonZero).toBe(false);
    });

    it('exit 3 is a real error', () => {
        const result = interpretExitCode('grep pattern file.txt', 3);
        expect(result.isError).toBe(true);
    });

    it('applies grep semantics to rg (ripgrep)', () => {
        const result = interpretExitCode('rg pattern file.txt', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('No matches found');
    });

    it('applies grep semantics in a pipeline (last command is grep)', () => {
        const result = interpretExitCode('cat file.txt | grep pattern', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — diff semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — diff', () => {
    it('exit 1 means "Files differ" and is NOT an error', () => {
        const result = interpretExitCode('diff file1 file2', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('Files differ');
    });

    it('exit 2 is a real error (missing file, etc.)', () => {
        const result = interpretExitCode('diff missing1 missing2', 2);
        expect(result.isError).toBe(true);
        expect(result.isSemanticNonZero).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — cmp semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — cmp', () => {
    it('exit 1 means "Files differ" and is NOT an error', () => {
        const result = interpretExitCode('cmp file1 file2', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('Files differ');
    });

    it('exit 2 is a real error', () => {
        const result = interpretExitCode('cmp file1 file2', 2);
        expect(result.isError).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — test / [ semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — test / [', () => {
    it('test exit 1 means "Condition is false" and is NOT an error', () => {
        const result = interpretExitCode('test -f /nonexistent', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('Condition is false');
    });

    it('[ exit 1 means "Condition is false" and is NOT an error', () => {
        const result = interpretExitCode('[ -d /nonexistent ]', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toBe('Condition is false');
    });

    it('test exit 2 is a usage/syntax error', () => {
        const result = interpretExitCode('test', 2);
        expect(result.isError).toBe(true);
        expect(result.isSemanticNonZero).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — find semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — find', () => {
    it('exit 1 means "Some directories inaccessible" and is NOT an error', () => {
        const result = interpretExitCode('find / -name "*.log"', 1);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
        expect(result.meaning).toContain('inaccessible');
    });

    it('exit 2 is a real error', () => {
        const result = interpretExitCode('find / -badoption', 2);
        expect(result.isError).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — curl semantics
// ---------------------------------------------------------------------------

describe('interpretExitCode — curl', () => {
    it('all non-zero curl exit codes are errors', () => {
        for (const code of [1, 2, 3, 6, 7, 28, 35, 60]) {
            const result = interpretExitCode('curl http://example.com', code);
            expect(result.isError).toBe(true);
            expect(result.isSemanticNonZero).toBe(false);
        }
    });

    it('exit 6 has specific meaning: could not resolve host', () => {
        const result = interpretExitCode('curl http://example.com', 6);
        expect(result.meaning).toContain('Could not resolve host');
    });

    it('exit 7 has specific meaning: failed to connect', () => {
        const result = interpretExitCode('curl http://example.com', 7);
        expect(result.meaning).toContain('Failed to connect');
    });

    it('exit 28 has specific meaning: timeout', () => {
        const result = interpretExitCode('curl http://example.com', 28);
        expect(result.meaning).toContain('timed out');
    });

    it('exit 60 has specific meaning: SSL certificate problem', () => {
        const result = interpretExitCode('curl https://self-signed.example.com', 60);
        expect(result.meaning).toContain('SSL certificate problem');
    });

    it('exit 67 has specific meaning: login denied', () => {
        const result = interpretExitCode('curl ftp://example.com', 67);
        expect(result.meaning).toContain('Login denied');
    });

    it('unknown curl exit code gets generic message', () => {
        const result = interpretExitCode('curl http://example.com', 99);
        expect(result.meaning).toContain('curl error');
        expect(result.meaning).toContain('99');
        expect(result.isError).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — default semantics (unknown commands)
// ---------------------------------------------------------------------------

describe('interpretExitCode — unknown commands', () => {
    it('exit 0 is success', () => {
        const result = interpretExitCode('myCustomTool --flag', 0);
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(false);
    });

    it('any non-zero exit code is an error', () => {
        const result = interpretExitCode('myCustomTool --flag', 1);
        expect(result.isError).toBe(true);
        expect(result.isSemanticNonZero).toBe(false);
        expect(result.meaning).toContain('failed');
    });

    it('includes exit code in failure message', () => {
        const result = interpretExitCode('unknown_cmd', 127);
        expect(result.meaning).toContain('127');
    });
});

// ---------------------------------------------------------------------------
// interpretExitCode — optional stdout/stderr parameters
// ---------------------------------------------------------------------------

describe('interpretExitCode — stdout/stderr parameters', () => {
    it('accepts optional stdout and stderr without changing basic behavior', () => {
        const result = interpretExitCode('grep pattern', 1, '', 'some stderr');
        expect(result.isError).toBe(false);
        expect(result.isSemanticNonZero).toBe(true);
    });

    it('works correctly when stdout and stderr are undefined', () => {
        const result = interpretExitCode('grep pattern', 1);
        expect(result.isError).toBe(false);
    });
});
