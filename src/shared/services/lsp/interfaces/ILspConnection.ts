/**
 * LSP Connection Interface
 *
 * Interface for communicating with a language server instance.
 */

import { Disposable } from '../../../types/LspTypes';

/**
 * LSP connection interface for sending requests and notifications
 */
export interface ILspConnection {
  /**
   * Send a request to the language server and wait for response.
   * @param method LSP method name (e.g., 'textDocument/definition')
   * @param params Request parameters
   * @returns Promise that resolves with the response
   */
  request<T>(method: string, params: unknown): Promise<T>;

  /**
   * Send a notification to the language server (no response expected).
   * @param method LSP method name (e.g., 'textDocument/didOpen')
   * @param params Notification parameters
   */
  notify(method: string, params: unknown): void;

  /**
   * Subscribe to server notifications (e.g., diagnostics).
   * @param method Notification method to listen for
   * @param handler Handler function for the notification
   * @returns Disposable to unsubscribe
   */
  onNotification(method: string, handler: (params: unknown) => void): Disposable;

  /**
   * Check if the connection is healthy.
   * @returns true if connection is active and healthy
   */
  isHealthy(): boolean;

  /**
   * Close the connection gracefully.
   */
  close(): Promise<void>;

  /**
   * Get server process ID (if available)
   */
  getPid(): number | undefined;

  /**
   * Get connection statistics
   */
  getStats(): {
    requestCount: number;
    errorCount: number;
    uptime: number;
  };
}
