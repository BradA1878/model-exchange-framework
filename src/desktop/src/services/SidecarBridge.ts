/**
 * MXF Desktop — Sidecar Bridge Client
 *
 * Manages the Bun sidecar process that runs the MXF SDK. Spawns the
 * process on init, sends JSON-RPC commands via stdin, and receives
 * events via stdout. This is the primary communication layer between
 * the desktop UI and the MXF server.
 *
 * The sidecar runs `bun src/desktop/sidecar/bridge.ts` from the MXF
 * project root, using the real InteractiveSessionManager to connect
 * to the MXF server — identical to how the TUI connects.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from '@tauri-apps/plugin-shell';

/** Event listener callback type */
type EventListener = (data: Record<string, unknown>) => void;

/** JSON-RPC request */
interface RpcRequest {
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

/** Pending RPC call awaiting response */
interface PendingCall {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

/**
 * SidecarBridge — spawns and manages the Bun sidecar process.
 *
 * Usage:
 *   const bridge = new SidecarBridge(projectRoot);
 *   bridge.on('agent:message', (data) => { ... });
 *   await bridge.start();
 *   await bridge.call('submitTask', { task: 'hello' });
 *   await bridge.stop();
 */
export class SidecarBridge {
    private projectRoot: string;
    private process: Awaited<ReturnType<Command<string>['spawn']>> | null = null;
    private command: Command<string> | null = null;
    private listeners: Map<string, EventListener[]> = new Map();
    private pendingCalls: Map<number, PendingCall> = new Map();
    private nextId: number = 1;
    private lineBuffer: string = '';

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Start the sidecar process.
     * Spawns `bun run src/desktop/sidecar/bridge.ts` in the project root.
     */
    async start(): Promise<void> {
        // Use Tauri's shell Command to spawn the sidecar
        this.command = Command.create('bun', [
            'run', 'src/desktop/sidecar/bridge.ts',
        ], {
            cwd: this.projectRoot,
            encoding: 'utf-8',
        });

        // Handle stdout — parse JSON lines from the sidecar
        this.command.stdout.on('data', (data: string) => {
            this.handleStdout(data);
        });

        // Handle stderr — log errors but don't crash
        this.command.stderr.on('data', (data: string) => {
            console.error('[sidecar stderr]', data);
        });

        // Handle process close
        this.command.on('close', (data) => {
            console.log('[sidecar] process exited with code', data.code);
            this.process = null;
            this.emit('status', { state: 'disconnected' });
        });

        // Handle process error
        this.command.on('error', (error: string) => {
            console.error('[sidecar] process error:', error);
            this.emit('error', { message: `Sidecar error: ${error}` });
        });

        // Spawn the process
        this.process = await this.command.spawn();
    }

    /**
     * Send a JSON-RPC call to the sidecar and await the response.
     */
    async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
        if (!this.process) {
            throw new Error('Sidecar not running');
        }

        const id = this.nextId++;
        const request: RpcRequest = { id, method, params };

        return new Promise((resolve, reject) => {
            this.pendingCalls.set(id, { resolve, reject });

            // Write the JSON-RPC request to the sidecar's stdin
            const line = JSON.stringify(request) + '\n';
            this.process!.write(line).catch((err: Error) => {
                this.pendingCalls.delete(id);
                reject(new Error(`Failed to write to sidecar: ${err.message}`));
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error(`Sidecar call timed out: ${method}`));
                }
            }, 30000);
        });
    }

    /**
     * Register an event listener for sidecar events.
     */
    on(event: string, listener: EventListener): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(listener);
    }

    /**
     * Remove an event listener.
     */
    off(event: string, listener: EventListener): void {
        const listeners = this.listeners.get(event);
        if (listeners) {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
        }
    }

    /**
     * Stop the sidecar process gracefully.
     */
    async stop(): Promise<void> {
        if (this.process) {
            try {
                await this.call('disconnect');
            } catch {
                // If disconnect fails, force kill
            }
            await this.process.kill();
            this.process = null;
        }
    }

    /** Emit an event to all registered listeners */
    private emit(event: string, data: Record<string, unknown>): void {
        const listeners = this.listeners.get(event);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (err) {
                    console.error(`[sidecar] event listener error for ${event}:`, err);
                }
            }
        }
    }

    /**
     * Handle stdout data from the sidecar.
     * Parses JSON lines and routes to event listeners or pending RPC calls.
     */
    private handleStdout(data: string): void {
        // Buffer partial lines — stdout may deliver data in chunks
        this.lineBuffer += data;
        const lines = this.lineBuffer.split('\n');
        // Keep the last (potentially incomplete) line in the buffer
        this.lineBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            let message: Record<string, unknown>;
            try {
                message = JSON.parse(line);
            } catch {
                console.warn('[sidecar] unparseable stdout:', line);
                continue;
            }

            // JSON-RPC response — resolve pending call
            if ('id' in message) {
                const id = message.id as number;
                const pending = this.pendingCalls.get(id);
                if (pending) {
                    this.pendingCalls.delete(id);
                    if ('error' in message) {
                        const err = message.error as { message: string };
                        pending.reject(new Error(err.message));
                    } else {
                        pending.resolve(message.result);
                    }
                }
                continue;
            }

            // Event notification — emit to listeners
            if ('event' in message) {
                const event = message.event as string;
                const eventData = (message.data || {}) as Record<string, unknown>;
                this.emit(event, eventData);
            }
        }
    }
}
