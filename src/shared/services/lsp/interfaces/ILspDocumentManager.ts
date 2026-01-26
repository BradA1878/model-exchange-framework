/**
 * LSP Document Manager Interface
 *
 * Interface for managing open documents in language servers.
 */

import { LspTextDocumentContentChangeEvent } from '../../../types/LspTypes';

/**
 * LSP document manager interface
 */
export interface ILspDocumentManager {
  /**
   * Open a document in the language server.
   * @param uri Document URI (file:///absolute/path)
   * @param languageId Language identifier (e.g., 'typescript')
   * @param content Full document content
   */
  openDocument(uri: string, languageId: string, content: string): Promise<void>;

  /**
   * Update an open document (incremental or full).
   * @param uri Document URI
   * @param changes Content change events
   */
  updateDocument(uri: string, changes: LspTextDocumentContentChangeEvent[]): Promise<void>;

  /**
   * Close a document.
   * @param uri Document URI
   */
  closeDocument(uri: string): Promise<void>;

  /**
   * Check if a document is open.
   * @param uri Document URI
   * @returns true if document is open
   */
  isDocumentOpen(uri: string): boolean;

  /**
   * Get the current version of an open document.
   * @param uri Document URI
   * @returns Document version number, or undefined if not open
   */
  getDocumentVersion(uri: string): number | undefined;

  /**
   * Ensure a document is open, reading from disk if needed.
   * @param filePath Absolute file path
   */
  ensureDocumentOpen(filePath: string): Promise<void>;

  /**
   * Get all open document URIs.
   * @returns Array of open document URIs
   */
  getOpenDocuments(): string[];

  /**
   * Close idle documents that haven't been accessed recently.
   * @param idleTimeout Timeout in milliseconds
   */
  closeIdleDocuments(idleTimeout: number): Promise<void>;

  /**
   * Get document statistics.
   */
  getStats(): {
    openCount: number;
    totalOpened: number;
    totalClosed: number;
  };
}
