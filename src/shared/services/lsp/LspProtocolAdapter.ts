/**
 * LSP Protocol Adapter
 *
 * Handles JSON-RPC encoding/decoding for LSP communication.
 * Converts between LSP wire protocol and typed TypeScript interfaces.
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Logger } from '../../utils/Logger';
import {
  LspPosition,
  LspRange,
  LspLocation,
  LspLocationResult,
  Disposable,
} from '../../types/LspTypes';
import { LSP_CONSTANTS } from '../../constants/EnhancementConstants';

const logger = new Logger('info', 'LspProtocolAdapter', 'server');

/**
 * JSON-RPC message types
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Pending request tracker
 */
interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * LSP Protocol Adapter
 *
 * Manages JSON-RPC communication with language server processes.
 */
export class LspProtocolAdapter extends EventEmitter {
  private process: ChildProcess;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  private isInitialized = false;
  private requestCount = 0;
  private errorCount = 0;
  private startTime: number;

  constructor(process: ChildProcess) {
    super();
    this.process = process;
    this.startTime = Date.now();
    this.setupProcessHandlers();
  }

  /**
   * Setup handlers for process stdout/stderr
   */
  private setupProcessHandlers(): void {
    if (!this.process.stdout || !this.process.stderr) {
      throw new Error('Language server process must have stdout and stderr');
    }

    // Handle stdout (JSON-RPC messages)
    this.process.stdout.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    // Handle stderr (log messages)
    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf-8').trim();
      if (message) {
        logger.debug(`LSP stderr: ${message}`);
      }
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      logger.info(`LSP process exited with code ${code}, signal ${signal}`);
      this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      logger.error(`LSP process error: ${error.message}`);
      this.emit('error', error);
    });
  }

  /**
   * Handle incoming data from language server
   */
  private handleData(data: string): void {
    this.buffer += data;

    // Process complete messages (Content-Length: ...\r\n\r\n{json})
    while (true) {
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const messageStart = headerMatch.index! + headerMatch[0].length;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) {
        // Incomplete message, wait for more data
        break;
      }

      // Extract and parse message
      const messageContent = this.buffer.substring(messageStart, messageEnd);
      this.buffer = this.buffer.substring(messageEnd);

      try {
        const message = JSON.parse(messageContent);
        this.handleMessage(message);
      } catch (error) {
        logger.error(`Failed to parse LSP message: ${error}`);
        this.errorCount++;
      }
    }
  }

  /**
   * Handle parsed JSON-RPC message
   */
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as Record<string, unknown>;

    // Handle response
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      this.handleResponse(msg as unknown as JsonRpcResponse);
      return;
    }

    // Handle notification
    if ('method' in msg && !('id' in msg)) {
      this.handleNotification(msg as unknown as JsonRpcNotification);
      return;
    }

    // Handle request (server -> client)
    if ('method' in msg && 'id' in msg) {
      this.handleRequest(msg as unknown as JsonRpcRequest);
      return;
    }
  }

  /**
   * Handle JSON-RPC response
   */
  private handleResponse(response: JsonRpcResponse): void {
    const id = typeof response.id === 'number' ? response.id : parseInt(response.id as string, 10);
    const pending = this.pendingRequests.get(id);

    if (!pending) {
      logger.warn(`Received response for unknown request ID: ${id}`);
      return;
    }

    this.pendingRequests.delete(id);

    if (response.error) {
      const error = new Error(
        `LSP error (${response.error.code}): ${response.error.message}`
      );
      (error as any).code = response.error.code;
      (error as any).data = response.error.data;
      pending.reject(error);
      this.errorCount++;
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle JSON-RPC notification from server
   */
  private handleNotification(notification: JsonRpcNotification): void {
    this.emit('notification', notification.method, notification.params);
  }

  /**
   * Handle JSON-RPC request from server (e.g., window/showMessage)
   */
  private handleRequest(request: JsonRpcRequest): void {
    // For now, just log server requests
    logger.debug(`Received server request: ${request.method}`);
    // Send empty response
    this.sendMessage({
      jsonrpc: '2.0',
      id: request.id,
      result: null,
    });
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(`Language server process exited (code: ${code}, signal: ${signal})`));
    }
    this.pendingRequests.clear();

    this.emit('exit', code, signal);
  }

  /**
   * Send JSON-RPC request to language server
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextRequestId++;
    this.requestCount++;

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
      });

      this.sendMessage(message);

      // Set timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
          this.errorCount++;
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Send JSON-RPC notification to language server
   */
  notify(method: string, params?: unknown): void {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(message);
  }

  /**
   * Send raw message to language server
   */
  private sendMessage(message: unknown): void {
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content, 'utf-8')}\r\n\r\n`;
    const fullMessage = header + content;

    if (!this.process.stdin) {
      throw new Error('Language server stdin is not available');
    }

    this.process.stdin.write(fullMessage, 'utf-8');
  }

  /**
   * Subscribe to server notifications
   */
  onNotification(method: string, handler: (params: unknown) => void): Disposable {
    const listener = (notificationMethod: string, params: unknown) => {
      if (notificationMethod === method) {
        handler(params);
      }
    };

    this.on('notification', listener);

    return {
      dispose: () => {
        this.off('notification', listener);
      },
    };
  }

  /**
   * Check if adapter is healthy
   */
  isHealthy(): boolean {
    return !this.process.killed && this.process.exitCode === null;
  }

  /**
   * Get adapter statistics
   */
  getStats(): { requestCount: number; errorCount: number; uptime: number } {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Close the adapter and kill the process
   */
  async close(): Promise<void> {
    // Send shutdown request if initialized
    if (this.isInitialized) {
      try {
        await this.request('shutdown');
        this.notify('exit');
      } catch (error) {
        logger.warn(`Error during LSP shutdown: ${error}`);
      }
    }

    // Kill the process
    if (!this.process.killed) {
      this.process.kill();
    }

    // Wait for process to exit
    return new Promise((resolve) => {
      if (this.process.killed || this.process.exitCode !== null) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        this.process.kill('SIGKILL');
        resolve();
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Mark adapter as initialized
   */
  setInitialized(initialized: boolean): void {
    this.isInitialized = initialized;
  }

  /**
   * Get process PID
   */
  getPid(): number | undefined {
    return this.process.pid;
  }

  // ========== Position Conversion Utilities ==========

  /**
   * Convert 1-indexed position (MXF tools) to 0-indexed (LSP)
   */
  static toLspPosition(line: number, character: number): LspPosition {
    return {
      line: line - LSP_CONSTANTS.POSITION.TOOL_INDEXED,
      character: character - LSP_CONSTANTS.POSITION.TOOL_INDEXED,
    };
  }

  /**
   * Convert 0-indexed position (LSP) to 1-indexed (MXF tools)
   */
  static fromLspPosition(position: LspPosition): { line: number; character: number } {
    return {
      line: position.line + LSP_CONSTANTS.POSITION.TOOL_INDEXED,
      character: position.character + LSP_CONSTANTS.POSITION.TOOL_INDEXED,
    };
  }

  /**
   * Convert LSP Location to LspLocationResult (1-indexed)
   */
  static fromLspLocation(location: LspLocation): LspLocationResult {
    const start = this.fromLspPosition(location.range.start);
    const end = this.fromLspPosition(location.range.end);

    return {
      file: this.uriToFilePath(location.uri),
      line: start.line,
      character: start.character,
      endLine: end.line,
      endCharacter: end.character,
    };
  }

  /**
   * Convert file path to URI
   */
  static filePathToUri(filePath: string): string {
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, '/');

    // Handle Windows paths (C:/...)
    if (/^[a-zA-Z]:/.test(normalized)) {
      return `file:///${normalized}`;
    }

    // Handle Unix paths (/...)
    return `file://${normalized}`;
  }

  /**
   * Convert URI to file path
   */
  static uriToFilePath(uri: string): string {
    if (!uri.startsWith('file://')) {
      return uri;
    }

    let path = uri.substring(7); // Remove 'file://'

    // Handle Windows paths (file:///C:/...)
    if (/^\/[a-zA-Z]:/.test(path)) {
      path = path.substring(1); // Remove leading slash
    }

    // Normalize path separators for current platform
    if (process.platform === 'win32') {
      path = path.replace(/\//g, '\\');
    }

    return path;
  }
}
