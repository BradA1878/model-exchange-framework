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

    describe('Dangerous Pattern Invariants', () => {
        // Define dangerous pattern generators
        const dangerousPatternArbs = {
            eval: fc.stringMatching(/eval\s*\(/),
            functionConstructor: fc.stringMatching(/Function\s*\(/),
            require: fc.stringMatching(/require\s*\(/),
            importFrom: fc.constant('import x from "module"'),
            processExit: fc.constant('process.exit(0)'),
            processKill: fc.constant('process.kill(1)'),
            proto: fc.constant('obj.__proto__ = {}'),
            childProcess: fc.constant('child_process.exec("ls")'),
            bunSpawn: fc.constant('Bun.spawn(["ls"])'),
            bunFile: fc.constant('Bun.file("/etc/passwd")'),
        };

        it('code containing eval() always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}eval("test")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing require() always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}require("fs")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing Bun.spawn always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}Bun.spawn(["ls"])${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing Bun.file always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}Bun.file("/path")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing Bun.write always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}Bun.write("/path", "data")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

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

        it('code containing process.exit always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}process.exit(0)${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing process.kill always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}process.kill(1)${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing child_process always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}child_process.exec("ls")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('code containing Function constructor always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const code = `${prefix}new Function("return 1")${suffix}`;
                        const validation = sandbox.validateCode(code);
                        return validation.safe === false;
                    }
                ),
                { numRuns: 50 }
            );
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
                        // Filter out strings that might accidentally contain dangerous patterns
                        !s.includes('eval') &&
                        !s.includes('require') &&
                        !s.includes('import') &&
                        !s.includes('Bun.') &&
                        !s.includes('process.') &&
                        !s.includes('__proto__') &&
                        !s.includes('child_process') &&
                        !s.includes('Function') &&
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
                        // Dangerous code
                        fc.constant('eval("test")'),
                        fc.constant('require("fs")'),
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
                        fc.constant('eval("test")'),
                        fc.constant('require("fs")'),
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
