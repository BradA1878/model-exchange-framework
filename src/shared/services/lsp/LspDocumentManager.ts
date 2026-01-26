/**
 * LSP Document Manager
 *
 * Manages open documents and their lifecycle in language servers.
 * Handles document open/close/update operations and tracks document versions.
 */

import * as fs from 'fs/promises';
import { Logger } from '../../utils/Logger';
import { ILspDocumentManager } from './interfaces/ILspDocumentManager';
import { ILspConnection } from './interfaces/ILspConnection';
import { LspTextDocumentContentChangeEvent } from '../../types/LspTypes';
import { LspProtocolAdapter } from './LspProtocolAdapter';
import { LSP_CONSTANTS } from '../../constants/EnhancementConstants';

const logger = new Logger('info', 'LspDocumentManager', 'server');

/**
 * Document state tracking
 */
interface DocumentState {
  uri: string;
  languageId: string;
  version: number;
  content: string;
  lastAccessed: number;
}

/**
 * LSP Document Manager Implementation
 *
 * Tracks document lifecycle and manages synchronization with language servers.
 */
export class LspDocumentManager implements ILspDocumentManager {
  private connection: ILspConnection;
  private documents = new Map<string, DocumentState>();
  private syncMode: 'full' | 'incremental';
  private totalOpened = 0;
  private totalClosed = 0;

  constructor(connection: ILspConnection, syncMode: 'full' | 'incremental' = 'incremental') {
    this.connection = connection;
    this.syncMode = syncMode;
  }

  /**
   * Open a document in the language server
   */
  async openDocument(uri: string, languageId: string, content: string): Promise<void> {
    // Check if already open
    if (this.documents.has(uri)) {
      logger.debug(`Document already open: ${uri}`);
      const doc = this.documents.get(uri)!;
      doc.lastAccessed = Date.now();
      return;
    }

    // Send didOpen notification to language server
    this.connection.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });

    // Track document state
    this.documents.set(uri, {
      uri,
      languageId,
      version: 1,
      content,
      lastAccessed: Date.now(),
    });

    this.totalOpened++;
    logger.debug(`Opened document: ${uri}`);
  }

  /**
   * Update an open document
   */
  async updateDocument(uri: string, changes: LspTextDocumentContentChangeEvent[]): Promise<void> {
    const doc = this.documents.get(uri);
    if (!doc) {
      throw new Error(`Document not open: ${uri}`);
    }

    // Increment version
    doc.version++;
    doc.lastAccessed = Date.now();

    // Apply changes to local content
    for (const change of changes) {
      if (change.range) {
        // Incremental change
        doc.content = this.applyIncrementalChange(doc.content, change);
      } else {
        // Full document change
        doc.content = change.text;
      }
    }

    // Send didChange notification to language server
    this.connection.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: doc.version,
      },
      contentChanges: changes,
    });

    logger.debug(`Updated document: ${uri} (version ${doc.version})`);
  }

  /**
   * Close a document
   */
  async closeDocument(uri: string): Promise<void> {
    const doc = this.documents.get(uri);
    if (!doc) {
      logger.debug(`Document not open: ${uri}`);
      return;
    }

    // Send didClose notification to language server
    this.connection.notify('textDocument/didClose', {
      textDocument: {
        uri,
      },
    });

    // Remove from tracking
    this.documents.delete(uri);
    this.totalClosed++;
    logger.debug(`Closed document: ${uri}`);
  }

  /**
   * Check if document is open
   */
  isDocumentOpen(uri: string): boolean {
    return this.documents.has(uri);
  }

  /**
   * Get document version
   */
  getDocumentVersion(uri: string): number | undefined {
    return this.documents.get(uri)?.version;
  }

  /**
   * Ensure document is open, reading from disk if needed
   */
  async ensureDocumentOpen(filePath: string): Promise<void> {
    const uri = LspProtocolAdapter.filePathToUri(filePath);

    // Already open
    if (this.documents.has(uri)) {
      const doc = this.documents.get(uri)!;
      doc.lastAccessed = Date.now();
      return;
    }

    // Read file content
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const languageId = this.detectLanguageId(filePath);
      await this.openDocument(uri, languageId, content);
    } catch (error) {
      throw new Error(`Failed to read file: ${filePath} - ${error}`);
    }
  }

  /**
   * Get all open document URIs
   */
  getOpenDocuments(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Close idle documents
   */
  async closeIdleDocuments(idleTimeout: number): Promise<void> {
    const now = Date.now();
    const toClose: string[] = [];

    for (const [uri, doc] of this.documents) {
      if (now - doc.lastAccessed > idleTimeout) {
        toClose.push(uri);
      }
    }

    for (const uri of toClose) {
      await this.closeDocument(uri);
    }

    if (toClose.length > 0) {
      logger.info(`Closed ${toClose.length} idle documents`);
    }
  }

  /**
   * Get document statistics
   */
  getStats(): { openCount: number; totalOpened: number; totalClosed: number } {
    return {
      openCount: this.documents.size,
      totalOpened: this.totalOpened,
      totalClosed: this.totalClosed,
    };
  }

  /**
   * Apply incremental change to content
   */
  private applyIncrementalChange(
    content: string,
    change: LspTextDocumentContentChangeEvent
  ): string {
    if (!change.range) {
      return change.text;
    }

    const lines = content.split('\n');
    const startLine = change.range.start.line;
    const startChar = change.range.start.character;
    const endLine = change.range.end.line;
    const endChar = change.range.end.character;

    // Calculate offsets
    let startOffset = 0;
    for (let i = 0; i < startLine; i++) {
      startOffset += lines[i].length + 1; // +1 for newline
    }
    startOffset += startChar;

    let endOffset = 0;
    for (let i = 0; i < endLine; i++) {
      endOffset += lines[i].length + 1;
    }
    endOffset += endChar;

    // Apply change
    return content.substring(0, startOffset) + change.text + content.substring(endOffset);
  }

  /**
   * Detect language ID from file extension
   */
  private detectLanguageId(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();

    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescriptreact',
      js: 'javascript',
      jsx: 'javascriptreact',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'shellscript',
      bash: 'shellscript',
      zsh: 'shellscript',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      xml: 'xml',
      sql: 'sql',
    };

    return languageMap[ext || ''] || 'plaintext';
  }

  /**
   * Close all documents
   */
  async closeAll(): Promise<void> {
    const uris = Array.from(this.documents.keys());
    for (const uri of uris) {
      await this.closeDocument(uri);
    }
    logger.info(`Closed all ${uris.length} documents`);
  }
}
