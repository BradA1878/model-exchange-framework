/**
 * LSP Server Manager Interface
 *
 * Interface for managing language server lifecycle.
 */

import { SupportedLanguage, LanguageServerConfig, LspHealthStatus } from '../../../types/LspTypes';
import { ILspConnection } from './ILspConnection';

/**
 * LSP server manager interface
 */
export interface ILspServerManager {
  /**
   * Initialize the server manager with configuration.
   * @param config LSP configuration
   */
  initialize(config: unknown): Promise<void>;

  /**
   * Get or create a language server for the given project and language.
   * @param projectRoot Absolute path to project root
   * @param language Programming language
   * @returns LSP connection instance
   */
  getServer(projectRoot: string, language: SupportedLanguage): Promise<ILspConnection>;

  /**
   * Shutdown a specific language server.
   * @param projectRoot Project root path
   * @param language Programming language
   */
  shutdownServer(projectRoot: string, language: SupportedLanguage): Promise<void>;

  /**
   * Shutdown all language servers.
   */
  shutdownAll(): Promise<void>;

  /**
   * Get health status of all active servers.
   * @returns Array of health status objects
   */
  getHealthStatus(): LspHealthStatus[];

  /**
   * Register a custom language server configuration.
   * @param config Language server configuration
   */
  registerLanguageServer(config: LanguageServerConfig): void;

  /**
   * Check if a language is supported.
   * @param language Programming language
   * @returns true if language is supported
   */
  isLanguageSupported(language: string): boolean;

  /**
   * Get server instance count.
   * @returns Number of active server instances
   */
  getServerCount(): number;
}
