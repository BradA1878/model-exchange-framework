/**
 * Property-based tests for CodeExecutionSandboxService
 * Uses fast-check to verify invariants across random inputs
 */

import fc from 'fast-check';
import { CodeExecutionSandboxService } from '@mxf/shared/services/CodeExecutionSandboxService';
import crypto from 'crypto';

describe('Code Execution Property Tests', () => {
    let sandbox: CodeExecutionSandboxService;

    beforeAll(() => {
        sandbox = CodeExecutionSandboxService.getInstance();
    });

    describe('Blocked Pattern Invariants', () => {
        // Patterns that corrupt the executor harness (hard blocked)
        it('code containing __proto__ always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}obj.__proto__ = {}${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing constructor[] bracket access always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}constructor["prototype"]${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Sandbox-Safe Patterns (No Longer Blocked)', () => {
        // These patterns are harmless inside the sandboxed Docker container
        // and should pass validation (they were previously blocked)
        it.each([
            ['eval("test")', 'eval()'],
            ['new Function("return 1")', 'Function constructor'],
            ['require("fs")', 'require()'],
            ['process.exit(0)', 'process.exit'],
            ['process.kill(1)', 'process.kill'],
            ['Bun.file("/path")', 'Bun.file'],
            ['Bun.write("/path", "data")', 'Bun.write'],
        ])('code containing %s passes validation (safe in sandbox)', (code) => {
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });

        // Warning patterns: pass validation (safe=true) but produce warnings
        it.each([
            ['child_process.exec("ls")', 'child_process'],
            ['Bun.spawn(["ls"])', 'Bun.spawn'],
            ['Bun.spawnSync(["ls"])', 'Bun.spawnSync'],
        ])('code containing %s passes validation with warning', (code) => {
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
            expect(validation.issues.some(i => i.type === 'warning')).toBe(true);
        });
    });

    describe('Safe Code Invariants', () => {
        it('pure arithmetic expressions always pass validation', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: -1000, max: 1000 }),
                    fc.integer({ min: -1000, max: 1000 }),
                    fc.constantFrom('+', '-', '*', '/'),
                    (a, b, op) => {
                        const code = `return ${a} ${op} ${b};`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('simple string operations pass validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).filter(s =>
                        // Filter out strings that might accidentally contain blocked patterns
                        !s.includes('__proto__') &&
                        !s.includes('constructor[')
                    ),
                    (str) => {
                        // Escape special chars for string literal
                        const escaped = str.replace(/[\\'"]/g, '\\$&').replace(/\n/g, '\\n');
                        const code = `return "${escaped}".length;`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === true;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('array literals pass validation', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 0, maxLength: 10 }),
                    (arr) => {
                        const code = `return [${arr.join(', ')}];`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Validation Result Structure Invariants', () => {
        it('validation always returns object with safe boolean and issues array', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 500 }),
                    (code) => {
                        const validation = sandbox.validateCode(code);
                        return (
                            typeof validation === 'object' &&
                            typeof validation.safe === 'boolean' &&
                            Array.isArray(validation.issues)
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('safe=false if and only if issues contains errors', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        // Safe code
                        fc.constant('return 1 + 1;'),
                        fc.constant('const x = 42; return x;'),
                        // Blocked code (prototype pollution)
                        fc.constant('obj.__proto__ = {}'),
                        fc.constant('constructor["prototype"]'),
                        // Warning-only code (safe in sandbox)
                        fc.constant('Bun.spawn(["ls"])')
                    ),
                    (code) => {
                        const validation = sandbox.validateCode(code);
                        const hasErrors = validation.issues.some(i => i.type === 'error');
                        return validation.safe === !hasErrors;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('all issues have valid type and message', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.constant('return 1;'),
                        fc.constant('obj.__proto__ = {}'),
                        fc.constant('Bun.spawn(["ls"])'),
                        fc.constant('a'.repeat(100001)) // Will trigger warning
                    ),
                    (code) => {
                        const validation = sandbox.validateCode(code);
                        return validation.issues.every(issue =>
                            (issue.type === 'error' || issue.type === 'warning') &&
                            typeof issue.message === 'string' &&
                            issue.message.length > 0
                        );
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    describe('Code Hash Invariants', () => {
        // Helper to generate code hash (same logic as in service)
        const generateHash = (code: string): string => {
            return crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);
        };

        it('identical code always produces identical hashes', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 200 }),
                    (code) => {
                        const hash1 = generateHash(code);
                        const hash2 = generateHash(code);
                        return hash1 === hash2;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('different code produces different hashes (with high probability)', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (code1, code2) => {
                        if (code1 === code2) return true; // Skip if identical
                        const hash1 = generateHash(code1);
                        const hash2 = generateHash(code2);
                        return hash1 !== hash2;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('hash is always a 16-character hex string', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 500 }),
                    (code) => {
                        const hash = generateHash(code);
                        return (
                            typeof hash === 'string' &&
                            hash.length === 16 &&
                            /^[0-9a-f]+$/.test(hash)
                        );
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Configuration Invariants', () => {
        it('getConfig always returns valid configuration object', () => {
            fc.assert(
                fc.property(
                    fc.constant(undefined),
                    () => {
                        const config = sandbox.getConfig();
                        return (
                            typeof config === 'object' &&
                            typeof config.timeout === 'number' &&
                            config.timeout > 0 &&
                            typeof config.memoryLimit === 'number' &&
                            typeof config.captureConsole === 'boolean'
                        );
                    }
                ),
                { numRuns: 10 }
            );
        });

        it('updateConfig preserves unmodified fields', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1000, max: 30000 }),
                    (newTimeout) => {
                        const before = sandbox.getConfig();
                        const originalCaptureConsole = before.captureConsole;

                        sandbox.updateConfig({ timeout: newTimeout });
                        const after = sandbox.getConfig();

                        // Restore
                        sandbox.updateConfig({ timeout: before.timeout });

                        // captureConsole should be unchanged
                        return after.captureConsole === originalCaptureConsole;
                    }
                ),
                { numRuns: 10 }
            );
        });
    });
});
