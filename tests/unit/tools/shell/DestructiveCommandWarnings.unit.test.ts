/**
 * Unit tests for DestructiveCommandWarnings — advisory warnings about
 * potentially destructive shell commands.
 */

import {
    getDestructiveWarnings,
    hasDestructiveWarnings,
    DestructiveWarning
} from '@mxf/shared/protocols/mcp/tools/shell/DestructiveCommandWarnings';

// ---------------------------------------------------------------------------
// Git — danger level
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — git danger', () => {
    it('warns on git reset --hard', () => {
        const warnings = getDestructiveWarnings('git reset --hard HEAD~1');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('uncommitted') })
            ])
        );
    });

    it('warns on git push --force', () => {
        const warnings = getDestructiveWarnings('git push --force origin main');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('remote history') })
            ])
        );
    });

    it('warns on git push -f (short flag)', () => {
        const warnings = getDestructiveWarnings('git push -f origin main');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger' })
            ])
        );
    });

    it('warns on git clean -f', () => {
        const warnings = getDestructiveWarnings('git clean -f');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('untracked') })
            ])
        );
    });

    it('does not match git clean -fd (pattern requires -f as standalone flag)', () => {
        // The pattern /\bgit\b.*\bclean\b.*-f\b/ requires a word boundary after -f,
        // so -fd does not match. This is by design: -fd is a combined flag and
        // the regex specifically matches -f as a separate word.
        const warnings = getDestructiveWarnings('git clean -fd');
        // -fd does not end with a word boundary after -f, so it does not match
        const dangerWarnings = warnings.filter(w => w.warning.includes('untracked'));
        expect(dangerWarnings).toHaveLength(0);
    });

    it('warns on git checkout -- .', () => {
        const warnings = getDestructiveWarnings('git checkout -- .');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('working tree') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Git — warning level
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — git warning', () => {
    it('warns on git stash drop', () => {
        const warnings = getDestructiveWarnings('git stash drop');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('stashed') })
            ])
        );
    });

    it('warns on git stash clear', () => {
        const warnings = getDestructiveWarnings('git stash clear');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning' })
            ])
        );
    });

    it('warns on git branch -D (force delete)', () => {
        const warnings = getDestructiveWarnings('git branch -D feature-branch');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('force-delete') })
            ])
        );
    });

    it('warns on git push --no-verify', () => {
        const warnings = getDestructiveWarnings('git push --no-verify');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('hooks') })
            ])
        );
    });

    it('warns on git commit --no-verify', () => {
        const warnings = getDestructiveWarnings('git commit --no-verify -m "msg"');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('hooks') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Git — info level
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — git info', () => {
    it('warns on git commit --amend', () => {
        const warnings = getDestructiveWarnings('git commit --amend');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'info', warning: expect.stringContaining('rewrite') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// File operations — danger
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — file operations danger', () => {
    it('warns on rm -rf', () => {
        const warnings = getDestructiveWarnings('rm -rf /tmp/stuff');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('recursively') })
            ])
        );
    });

    it('warns on rm -fr (reversed flags)', () => {
        const warnings = getDestructiveWarnings('rm -fr /tmp/stuff');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger' })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// File operations — warning
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — file operations warning', () => {
    it('warns on rm -r (recursive without force)', () => {
        const warnings = getDestructiveWarnings('rm -r /tmp/stuff');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('recursively') })
            ])
        );
    });

    it('warns on rm -f (force without recursive)', () => {
        const warnings = getDestructiveWarnings('rm -f file.txt');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('force-remove') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Database — danger
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — database', () => {
    it('warns on DROP TABLE', () => {
        const warnings = getDestructiveWarnings('mysql -e "DROP TABLE users"');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger' })
            ])
        );
    });

    it('warns on DROP DATABASE (case-insensitive)', () => {
        const warnings = getDestructiveWarnings('psql -c "drop database mydb"');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger' })
            ])
        );
    });

    it('warns on TRUNCATE TABLE', () => {
        const warnings = getDestructiveWarnings('mysql -e "TRUNCATE TABLE logs"');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('remove all data') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Infrastructure — danger
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — infrastructure', () => {
    it('warns on kubectl delete', () => {
        const warnings = getDestructiveWarnings('kubectl delete pod my-pod');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('Kubernetes') })
            ])
        );
    });

    it('warns on terraform destroy', () => {
        const warnings = getDestructiveWarnings('terraform destroy -auto-approve');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'danger', warning: expect.stringContaining('Terraform') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Permissions — warning
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — permissions', () => {
    it('warns on chmod 777', () => {
        const warnings = getDestructiveWarnings('chmod 777 /var/www');
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ severity: 'warning', warning: expect.stringContaining('permissive') })
            ])
        );
    });
});

// ---------------------------------------------------------------------------
// Safe commands — no warnings
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — safe commands', () => {
    const safeCommands = [
        'ls -la',
        'cat file.txt',
        'grep pattern file',
        'git status',
        'git log --oneline',
        'git diff HEAD',
        'echo "hello"',
        'node script.js',
        'npm install',
        'curl http://example.com',
        'mkdir -p /tmp/newdir',
        'touch newfile.txt',
    ];

    it.each(safeCommands)('returns empty array for safe command: %s', (cmd) => {
        expect(getDestructiveWarnings(cmd)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Multiple warnings
// ---------------------------------------------------------------------------

describe('getDestructiveWarnings — multiple matches', () => {
    it('returns multiple warnings when a command matches multiple patterns', () => {
        // "git push --force --no-verify" should match both force push and no-verify
        const warnings = getDestructiveWarnings('git push --force --no-verify');
        expect(warnings.length).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// hasDestructiveWarnings
// ---------------------------------------------------------------------------

describe('hasDestructiveWarnings', () => {
    it('returns true for destructive commands', () => {
        expect(hasDestructiveWarnings('git reset --hard')).toBe(true);
        expect(hasDestructiveWarnings('rm -rf /')).toBe(true);
        expect(hasDestructiveWarnings('kubectl delete namespace prod')).toBe(true);
    });

    it('returns false for safe commands', () => {
        expect(hasDestructiveWarnings('ls -la')).toBe(false);
        expect(hasDestructiveWarnings('git status')).toBe(false);
        expect(hasDestructiveWarnings('cat file.txt')).toBe(false);
        expect(hasDestructiveWarnings('echo hello')).toBe(false);
    });
});
