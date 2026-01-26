/**
 * Unit tests for CodeExecutionSandboxService
 * Tests dangerous pattern detection, safe code validation, warnings, and configuration
 *
 * Note: These tests focus on the validateCode() method which runs BEFORE
 * container execution for defense in depth. Actual execution tests are in integration tests.
 */

import { CodeExecutionSandboxService } from '@mxf/shared/services/CodeExecutionSandboxService';

describe('CodeExecutionSandboxService Unit Tests', () => {
    let sandbox: CodeExecutionSandboxService;

    beforeAll(() => {
        sandbox = CodeExecutionSandboxService.getInstance();
    });

    describe('Dangerous Pattern Detection', () => {
        // eval() - dynamic code execution
        it('should detect eval() as dangerous', () => {
            const validation = sandbox.validateCode('eval("malicious code")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('eval'))).toBe(true);
        });

        it('should detect eval with different spacing', () => {
            const validation = sandbox.validateCode('eval   ("test")');
            expect(validation.safe).toBe(false);
        });

        // Function() - dynamic code execution
        it('should detect Function() constructor as dangerous', () => {
            const validation = sandbox.validateCode('new Function("return 1")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Function constructor'))).toBe(true);
        });

        it('should detect Function with different casing', () => {
            const validation = sandbox.validateCode('Function ("code")');
            expect(validation.safe).toBe(false);
        });

        // require() - module loading
        it('should detect require() as dangerous', () => {
            const validation = sandbox.validateCode('const fs = require("fs")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('require'))).toBe(true);
        });

        // import statements
        it('should detect import statements as dangerous', () => {
            const validation = sandbox.validateCode('import fs from "fs"');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('import'))).toBe(true);
        });

        // process.exit
        it('should detect process.exit as dangerous', () => {
            const validation = sandbox.validateCode('process.exit(1)');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('process.exit'))).toBe(true);
        });

        // process.kill
        it('should detect process.kill as dangerous', () => {
            const validation = sandbox.validateCode('process.kill(process.pid)');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('process.kill'))).toBe(true);
        });

        // __proto__ - prototype pollution
        it('should detect __proto__ as dangerous', () => {
            const validation = sandbox.validateCode('obj.__proto__ = {}');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Prototype pollution'))).toBe(true);
        });

        // constructor[] - prototype access
        it('should detect constructor[] access as dangerous', () => {
            const validation = sandbox.validateCode('obj.constructor["prototype"]');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Constructor'))).toBe(true);
        });

        // child_process
        it('should detect child_process module reference as dangerous', () => {
            const validation = sandbox.validateCode('const cp = child_process.exec("ls")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('child_process'))).toBe(true);
        });

        // Bun.spawn
        it('should detect Bun.spawn as dangerous', () => {
            const validation = sandbox.validateCode('Bun.spawn(["ls"])');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Bun.spawn'))).toBe(true);
        });

        // Bun.spawnSync
        it('should detect Bun.spawnSync as dangerous', () => {
            const validation = sandbox.validateCode('Bun.spawnSync(["ls"])');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Bun.spawnSync'))).toBe(true);
        });

        // Bun.file
        it('should detect Bun.file as dangerous', () => {
            const validation = sandbox.validateCode('const file = Bun.file("/etc/passwd")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Bun.file'))).toBe(true);
        });

        // Bun.write
        it('should detect Bun.write as dangerous', () => {
            const validation = sandbox.validateCode('await Bun.write("/tmp/test", "data")');
            expect(validation.safe).toBe(false);
            expect(validation.issues.some(i => i.message.includes('Bun.write'))).toBe(true);
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

    describe('Multiple Dangerous Patterns', () => {
        it('should detect all dangerous patterns in code with multiple issues', () => {
            const code = `
                eval("test");
                require("fs");
                Bun.spawn(["ls"]);
            `;
            const validation = sandbox.validateCode(code);
            expect(validation.safe).toBe(false);
            // Should have at least 3 errors
            const errors = validation.issues.filter(i => i.type === 'error');
            expect(errors.length).toBeGreaterThanOrEqual(3);
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

        it('should handle code with comments containing dangerous patterns', () => {
            // Comments with dangerous patterns should NOT trigger detection
            // since they're strings - but regex-based detection will catch them
            const code = '// eval("test") - this is a comment\nreturn 1;';
            const validation = sandbox.validateCode(code);
            // Note: regex-based detection will still catch it in comments
            // This is by design for defense in depth
            expect(validation.safe).toBe(false);
        });

        it('should handle code with dangerous patterns in strings', () => {
            // Patterns in strings should be caught for defense in depth
            const code = 'return "eval()";';
            const validation = sandbox.validateCode(code);
            // Will be caught by regex (defense in depth)
            expect(validation.safe).toBe(false);
        });
    });
});
