/**
 * Unit tests for CodeExecutionSandboxService
 * Tests pattern detection, safe code validation, warnings, and configuration
 *
 * Note: These tests focus on the validateCode() method which runs BEFORE
 * container execution. Only prototype pollution patterns are hard-blocked
 * because they can corrupt the executor harness. All other patterns are
 * safe inside the sandboxed Docker container (no network, read-only FS,
 * all capabilities dropped, non-root user).
 */

import { CodeExecutionSandboxService } from '@mxf/shared/services/CodeExecutionSandboxService';

describe('CodeExecutionSandboxService Unit Tests', () => {
    let sandbox: CodeExecutionSandboxService;

    beforeAll(() => {
        sandbox = CodeExecutionSandboxService.getInstance();
    });

    describe('Blocked Pattern Detection (Executor Harness Protection)', () => {
        // __proto__ - prototype pollution can corrupt the executor before it returns output
        it('should detect __proto__ as dangerous', () => {
            const validation = sandbox.validateCode('obj.__proto__ = {}');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Prototype pollution'))).toBe(true);
        });

        // constructor[] - prototype access via bracket notation
        it('should detect constructor[] access as dangerous', () => {
            const validation = sandbox.validateCode('obj.constructor["prototype"]');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Constructor'))).toBe(true);
        });
    });

    describe('Warning Pattern Detection (Informational Only)', () => {
        // These pass validation (safe=true) but produce warnings

        it('should warn about child_process usage', () => {
            const validation = sandbox.validateCode('const cp = child_process.exec("ls")');
            expect(validation.safe).toBe(true);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('child_process')
            )).toBe(true);
        });

        it('should warn about Bun.spawn usage', () => {
            const validation = sandbox.validateCode('Bun.spawn(["ls"])');
            expect(validation.safe).toBe(true);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('Bun.spawn')
            )).toBe(true);
        });

        it('should warn about Bun.spawnSync usage', () => {
            const validation = sandbox.validateCode('Bun.spawnSync(["ls"])');
            expect(validation.safe).toBe(true);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('Bun.spawnSync')
            )).toBe(true);
        });
    });

    describe('Sandbox-Safe Patterns (No Longer Blocked)', () => {
        // These patterns are harmless inside the sandboxed Docker container.
        // The container enforces isolation: no network, read-only FS, all caps dropped,
        // non-root user, memory/CPU/PID limits.

        it('should allow eval() (safe in sandbox)', () => {
            const validation = sandbox.validateCode('eval("1 + 1")');
            expect(validation.safe).toBe(true);
        });

        it('should allow eval with different spacing', () => {
            const validation = sandbox.validateCode('eval   ("test")');
            expect(validation.safe).toBe(true);
        });

        it('should allow Function() constructor (executor itself uses AsyncFunction)', () => {
            const validation = sandbox.validateCode('new Function("return 1")');
            expect(validation.safe).toBe(true);
        });

        it('should allow require() (only built-in modules in container)', () => {
            const validation = sandbox.validateCode('const fs = require("fs")');
            expect(validation.safe).toBe(true);
        });

        it('should allow import statements (only built-in modules in container)', () => {
            const validation = sandbox.validateCode('import fs from "fs"');
            expect(validation.safe).toBe(true);
        });

        it('should allow process.exit (just exits the container)', () => {
            const validation = sandbox.validateCode('process.exit(1)');
            expect(validation.safe).toBe(true);
        });

        it('should allow process.kill (PID namespace is isolated)', () => {
            const validation = sandbox.validateCode('process.kill(process.pid)');
            expect(validation.safe).toBe(true);
        });

        it('should allow Bun.file (root FS is read-only)', () => {
            const validation = sandbox.validateCode('const file = Bun.file("/etc/passwd")');
            expect(validation.safe).toBe(true);
        });

        it('should allow Bun.write (root FS is read-only, /tmp is capped)', () => {
            const validation = sandbox.validateCode('await Bun.write("/tmp/test", "data")');
            expect(validation.safe).toBe(true);
        });
    });

    describe('Safe Code Validation', () => {
        it('should allow simple arithmetic', () => {
            const validation = sandbox.validateCode('return 1 + 1;');
            expect(validation.safe).toBe(true);
            expect(validation.issues.filter(i => i.type === 'error')).toHaveLength(0);
        });

        it('should allow array operations', () => {
            const code = `
                const numbers = [1, 2, 3, 4, 5];
                const sum = numbers.reduce((a, b) => a + b, 0);
                return sum;
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });

        it('should allow Math operations', () => {
            const code = 'return Math.sqrt(144) + Math.max(1, 2, 3);';
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });

        it('should allow JSON operations', () => {
            const code = `
                const obj = { name: 'test' };
                const str = JSON.stringify(obj);
                const parsed = JSON.parse(str);
                return parsed;
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });

        it('should allow Date operations', () => {
            const code = 'return new Date().toISOString();';
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });

        it('should allow console.log', () => {
            const code = `
                console.log('Hello');
                console.error('Error');
                console.warn('Warning');
                return 42;
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });
    });

    describe('Validation Warnings', () => {
        it('should warn about large code (>100KB)', () => {
            // Create a large code string (> 100KB)
            const largeCode = 'return ' + '"a"'.repeat(50001) + ';';
            const validation = sandbox.validateCode(largeCode);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('very large')
            )).toBe(true);
            // Should still be safe (warnings don't make code unsafe)
            expect(validation.safe).toBe(true);
        });

        it('should warn about many while loops (>10)', () => {
            // Create code with 11 while loops
            const manyLoops = Array(11).fill('while(false) {}').join('\n');
            const validation = sandbox.validateCode(manyLoops);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('Multiple loops')
            )).toBe(true);
        });

        it('should warn about many for loops (>10)', () => {
            // Create code with 11 for loops
            const manyLoops = Array(11).fill('for(let i=0;i<1;i++) {}').join('\n');
            const validation = sandbox.validateCode(manyLoops);
            expect(validation.issues.some(i =>
                i.type === 'warning' && i.message.includes('Multiple loops')
            )).toBe(true);
        });
    });

    describe('Configuration', () => {
        it('should return default configuration', () => {
            const config = sandbox.getConfig();
            expect(config).toBeDefined();
            expect(config.timeout).toBeDefined();
            expect(config.memoryLimit).toBeDefined();
            expect(config.captureConsole).toBeDefined();
        });

        it('should allow updating configuration', () => {
            const originalConfig = sandbox.getConfig();
            const newTimeout = 15000;

            sandbox.updateConfig({ timeout: newTimeout });
            const updatedConfig = sandbox.getConfig();

            expect(updatedConfig.timeout).toBe(newTimeout);

            // Restore original
            sandbox.updateConfig({ timeout: originalConfig.timeout });
        });
    });

    describe('Service State', () => {
        it('should follow singleton pattern', () => {
            const instance1 = CodeExecutionSandboxService.getInstance();
            const instance2 = CodeExecutionSandboxService.getInstance();
            expect(instance1).toBe(instance2);
        });

        it('should report isReady() status', () => {
            // isReady() depends on Docker availability and initialization
            // Just verify it returns a boolean without throwing
            const ready = sandbox.isReady();
            expect(typeof ready).toBe('boolean');
        });
    });

    describe('Multiple Patterns', () => {
        it('should detect multiple blocked patterns in same code', () => {
            const code = `
                obj.__proto__ = {};
                obj.constructor["prototype"].polluted = true;
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(false);
            const errors = validation.issues.filter(i => i.type === 'error');
            expect(errors.length).toBeGreaterThanOrEqual(2);
        });

        it('should report both errors and warnings when both types present', () => {
            const code = `
                obj.__proto__ = {};
                Bun.spawn(["ls"]);
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.type === 'error')).toBe(true);
            expect(validation.issues.some(i => i.type === 'warning')).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty code', () => {
            const validation = sandbox.validateCode('');
            expect(validation.safe).toBe(true);
        });

        it('should handle code with only whitespace', () => {
            const validation = sandbox.validateCode('   \n\t  ');
            expect(validation.safe).toBe(true);
        });

        it('should detect __proto__ even in comments (regex-based detection)', () => {
            const code = '// obj.__proto__ = {} - this is a comment\nreturn 1;';
            const validation = sandbox.validateCode(code);
            // Regex-based detection catches it in comments — conservative by design
            expect(validation.safe).toBe(false);
        });

        it('should not flag sandbox-safe patterns in comments or strings', () => {
            // eval in a comment is fine since eval is no longer blocked
            const code = '// eval("test")\nreturn 1;';
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(true);
        });
    });
});
