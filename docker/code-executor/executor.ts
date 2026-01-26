/**
 * MXF Code Executor - Bun-based execution harness
 *
 * This script runs inside a Docker container and executes user-provided code
 * in an isolated environment. It reads a JSON request from stdin, executes
 * the code, and writes a JSON result to stdout.
 *
 * Security: Code runs as non-root user with no network access, read-only
 * filesystem, and strict resource limits enforced by Docker.
 */

/**
 * Execution request from the host
 */
interface ExecutionRequest {
    code: string;
    language: 'javascript' | 'typescript';
    timeout: number;
    context: {
        agentId: string;
        channelId: string;
        requestId: string;
        [key: string]: any;
    };
}

/**
 * Execution result returned to the host
 */
interface ExecutionResult {
    success: boolean;
    output: any;
    logs: string[];
    executionTime: number;
    error?: string;
    timeout: boolean;
}

/**
 * Capture console output
 */
const logs: string[] = [];

// Override console to capture output
console.log = (...args: any[]) => {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.error = (...args: any[]) => {
    logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.warn = (...args: any[]) => {
    logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.info = (...args: any[]) => {
    logs.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};

/**
 * Transpile TypeScript to JavaScript using Bun's native transpiler
 */
function transpileTypeScript(code: string): string {
    // Use Bun's built-in transpiler
    const transpiler = new Bun.Transpiler({
        loader: 'ts',
        target: 'bun'
    });

    return transpiler.transformSync(code);
}

/**
 * Execute code with timeout
 */
async function executeCode(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
        let codeToRun = request.code;

        // Transpile TypeScript to JavaScript if needed
        if (request.language === 'typescript') {
            try {
                codeToRun = transpileTypeScript(request.code);
            } catch (transpileError: any) {
                return {
                    success: false,
                    output: null,
                    logs: logs,
                    executionTime: Date.now() - startTime,
                    error: `TypeScript transpilation failed: ${transpileError.message}`,
                    timeout: false
                };
            }
        }

        // Create sandbox context
        const context = request.context;

        // Execute with timeout using Promise.race
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Execution timeout'));
            }, request.timeout);
        });

        // Execute user code using AsyncFunction constructor.
        //
        // SECURITY NOTE: The Function constructor is used here intentionally.
        // This is safe because:
        // 1. Container isolation is the PRIMARY security barrier (not pattern matching)
        // 2. The container has no network access (NetworkMode: none)
        // 3. Root filesystem is read-only
        // 4. All capabilities are dropped (CapDrop: ALL)
        // 5. Running as non-root user (UID 1000)
        // 6. Strict resource limits (memory, CPU, PIDs)
        //
        // CodeExecutionSandboxService.validateCode() performs pre-validation on
        // the host to catch obvious dangerous patterns early, but container
        // isolation is what actually prevents escape or damage.
        const executionPromise = (async () => {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const fn = new AsyncFunction('context', codeToRun);
            return await fn(context);
        })();

        const result = await Promise.race([executionPromise, timeoutPromise]);

        return {
            success: true,
            output: result,
            logs: logs,
            executionTime: Date.now() - startTime,
            timeout: false
        };

    } catch (error: any) {
        const isTimeout = error.message === 'Execution timeout';

        return {
            success: false,
            output: null,
            logs: logs,
            executionTime: Date.now() - startTime,
            error: error.message || String(error),
            timeout: isTimeout
        };
    }
}

/**
 * Main entry point
 */
async function main() {
    try {
        // Read JSON request from stdin
        // Bun.stdin.text() reads until EOF which is signaled by stream.end() on the host
        const stdin = await Bun.stdin.text();

        if (!stdin.trim()) {
            const result: ExecutionResult = {
                success: false,
                output: null,
                logs: [],
                executionTime: 0,
                error: 'No input provided',
                timeout: false
            };
            process.stdout.write(JSON.stringify(result));
            process.exit(1);
        }

        let request: ExecutionRequest;
        try {
            request = JSON.parse(stdin);
        } catch (parseError: any) {
            const result: ExecutionResult = {
                success: false,
                output: null,
                logs: [],
                executionTime: 0,
                error: `Invalid JSON input: ${parseError.message}`,
                timeout: false
            };
            process.stdout.write(JSON.stringify(result));
            process.exit(1);
        }

        // Validate request
        if (!request.code || typeof request.code !== 'string') {
            const result: ExecutionResult = {
                success: false,
                output: null,
                logs: [],
                executionTime: 0,
                error: 'Missing or invalid code field',
                timeout: false
            };
            process.stdout.write(JSON.stringify(result));
            process.exit(1);
        }

        // Set default timeout if not provided
        request.timeout = request.timeout || 5000;
        request.context = request.context || { agentId: '', channelId: '', requestId: '' };

        // Execute code
        const result = await executeCode(request);

        // Write result to stdout
        process.stdout.write(JSON.stringify(result));

        // Exit with appropriate code
        process.exit(result.success ? 0 : 1);

    } catch (error: any) {
        // Fatal error
        const result: ExecutionResult = {
            success: false,
            output: null,
            logs: logs,
            executionTime: 0,
            error: `Fatal error: ${error.message || String(error)}`,
            timeout: false
        };
        process.stdout.write(JSON.stringify(result));
        process.exit(1);
    }
}

// Run main
main();
