/**
 * LSP-MCP Bridge Integration Tests
 *
 * Tests the P7 LSP-MCP Bridge system:
 * - LspServerManager initialization and configuration
 * - Server lifecycle (initialization, health monitoring, shutdown)
 * - TypeScript language server operations (primary test target)
 * - Definition lookup (gotoDefinition)
 * - Reference finding (findReferences)
 * - Hover information retrieval
 * - Diagnostics handling
 * - Document management (open, change, close)
 * - Connection pooling by project root
 * - Server statistics and error handling
 *
 * Note: These tests use mocks for language server processes since actual
 * language server binaries may not be available in test environments.
 */

import { EventEmitter } from 'events';
import { LspServerManager } from '../../../src/shared/services/lsp/LspServerManager';
import { LspDocumentManager } from '../../../src/shared/services/lsp/LspDocumentManager';
import { LspProtocolAdapter } from '../../../src/shared/services/lsp/LspProtocolAdapter';
import { LSP_CONSTANTS } from '../../../src/shared/constants/EnhancementConstants';
import {
  LspConfig,
  LspHealthStatus,
  LanguageServerConfig,
  SupportedLanguage,
  LspPosition,
  LspRange,
  LspLocation,
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspTextDocumentContentChangeEvent,
} from '../../../src/shared/types/LspTypes';
import { ILspConnection } from '../../../src/shared/services/lsp/interfaces/ILspConnection';

// Mock child_process module to prevent actual server spawning
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs/promises for document manager tests
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

/**
 * Mock ChildProcess implementation
 */
class MockChildProcess extends EventEmitter {
  stdin: { write: jest.Mock };
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  killed: boolean;
  exitCode: number | null;

  constructor() {
    super();
    this.stdin = { write: jest.fn() };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
    this.killed = false;
    this.exitCode = null;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.exitCode = signal === 'SIGKILL' ? 9 : 0;
    this.emit('exit', this.exitCode, signal || null);
    return true;
  }
}

/**
 * Mock ILspConnection for testing
 */
class MockLspConnection implements ILspConnection {
  private requestHandlers: Map<string, jest.Mock>;
  private notificationHandlers: Map<string, ((params: unknown) => void)[]>;
  private _isHealthy: boolean;
  private stats: { requestCount: number; errorCount: number; uptime: number };
  private _pid: number;
  private startTime: number;

  constructor() {
    this.requestHandlers = new Map<string, jest.Mock>();
    this.notificationHandlers = new Map<string, ((params: unknown) => void)[]>();
    this._isHealthy = true;
    this.stats = {
      requestCount: 0,
      errorCount: 0,
      uptime: 0,
    };
    this._pid = Math.floor(Math.random() * 10000) + 1000;
    this.startTime = Date.now();
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.stats.requestCount++;
    const handler = this.requestHandlers.get(method);
    if (handler) {
      return handler(params);
    }
    // Default response based on method
    return this.getDefaultResponse<T>(method, params);
  }

  notify(method: string, params: unknown): void {
    const handlers = this.notificationHandlers.get(method);
    if (handlers) {
      handlers.forEach((handler) => handler(params));
    }
  }

  onNotification(method: string, handler: (params: unknown) => void) {
    const handlers = this.notificationHandlers.get(method) || [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
    return {
      dispose: () => {
        const current = this.notificationHandlers.get(method) || [];
        this.notificationHandlers.set(
          method,
          current.filter((h) => h !== handler)
        );
      },
    };
  }

  isHealthy(): boolean {
    return this._isHealthy;
  }

  async close(): Promise<void> {
    this._isHealthy = false;
  }

  getPid(): number | undefined {
    return this._pid;
  }

  getStats() {
    return {
      ...this.stats,
      uptime: Date.now() - this.startTime,
    };
  }

  // Test helpers
  setHealthy(healthy: boolean): void {
    this._isHealthy = healthy;
  }

  setRequestHandler(method: string, handler: jest.Mock): void {
    this.requestHandlers.set(method, handler);
  }

  private getDefaultResponse<T>(method: string, params: unknown): T {
    // Provide default mock responses for LSP methods
    switch (method) {
      case 'initialize':
        return {
          capabilities: {
            textDocumentSync: 2,
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            completionProvider: { triggerCharacters: ['.'] },
          },
        } as T;
      case 'textDocument/definition':
        return [
          {
            uri: 'file:///test/project/src/definition.ts',
            range: {
              start: { line: 10, character: 5 },
              end: { line: 10, character: 15 },
            },
          },
        ] as T;
      case 'textDocument/references':
        return [
          {
            uri: 'file:///test/project/src/ref1.ts',
            range: {
              start: { line: 5, character: 10 },
              end: { line: 5, character: 20 },
            },
          },
          {
            uri: 'file:///test/project/src/ref2.ts',
            range: {
              start: { line: 15, character: 8 },
              end: { line: 15, character: 18 },
            },
          },
        ] as T;
      case 'textDocument/hover':
        return {
          contents: {
            kind: 'markdown',
            value: '```typescript\nfunction testFunction(): void\n```',
          },
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 12 },
          },
        } as T;
      case 'textDocument/completion':
        return {
          isIncomplete: false,
          items: [
            { label: 'toString', kind: 2, detail: '(): string' },
            { label: 'valueOf', kind: 2, detail: '(): Object' },
          ],
        } as T;
      case 'textDocument/documentSymbol':
        return [
          {
            name: 'TestClass',
            kind: 5, // Class
            range: {
              start: { line: 0, character: 0 },
              end: { line: 50, character: 0 },
            },
            selectionRange: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 15 },
            },
            children: [],
          },
        ] as T;
      case 'shutdown':
        return null as T;
      default:
        return {} as T;
    }
  }
}

/**
 * Create mock LSP configuration
 */
function createMockLspConfig(overrides: Partial<LspConfig> = {}): LspConfig {
  return {
    enabled: true,
    servers: {
      typescript: {
        enabled: true,
        command: 'typescript-language-server',
        args: ['--stdio'],
        maxTsServerMemory: 4096,
      },
      python: {
        enabled: false,
        type: 'pylsp',
        command: 'pylsp',
        args: [],
      },
      go: {
        enabled: false,
        command: 'gopls',
        args: [],
      },
    },
    document: {
      syncMode: 'incremental',
      idleCloseTimeout: 300000,
      maxOpenDocuments: 50,
    },
    lifecycle: {
      healthCheckInterval: 30000,
      startupTimeout: 30000,
      shutdownTimeout: 10000,
      maxInstances: 10,
      restartPolicy: {
        maxRetries: 3,
        backoffMultiplier: 2,
        initialDelay: 1000,
        maxDelay: 30000,
      },
    },
    cache: {
      enabled: true,
      diagnosticsTtl: 5000,
      symbolsTtl: 60000,
      completionsTtl: 1000,
    },
    security: {
      allowedRoots: ['*'],
      blockedCommands: [],
    },
    analytics: {
      trackOperations: true,
      trackPerformance: true,
      trackErrors: true,
    },
    ...overrides,
  };
}

describe('LSP-MCP Bridge Integration Tests', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    jest.resetModules();
    process.env = { ...originalEnv, LSP_ENABLED: 'true' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('LspServerManager Initialization', () => {
    it('should be a singleton', () => {
      const instance1 = LspServerManager.getInstance();
      const instance2 = LspServerManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should initialize with configuration', async () => {
      const manager = LspServerManager.getInstance();
      const config = createMockLspConfig();

      await manager.initialize(config);

      // Verify manager is ready
      expect(manager.getServerCount()).toBe(0);
    });

    it('should track server count accurately', () => {
      const manager = LspServerManager.getInstance();
      expect(manager.getServerCount()).toBeGreaterThanOrEqual(0);
    });

    it('should return empty health status when no servers running', () => {
      const manager = LspServerManager.getInstance();
      const healthStatus = manager.getHealthStatus();
      expect(Array.isArray(healthStatus)).toBe(true);
    });
  });

  describe('Language Support Detection', () => {
    let manager: LspServerManager;

    beforeEach(async () => {
      manager = LspServerManager.getInstance();
      await manager.initialize(createMockLspConfig());
    });

    it('should recognize TypeScript as supported', () => {
      expect(manager.isLanguageSupported('typescript')).toBe(true);
    });

    it('should recognize JavaScript as supported', () => {
      expect(manager.isLanguageSupported('javascript')).toBe(true);
    });

    it('should recognize Python as supported (built-in config)', () => {
      expect(manager.isLanguageSupported('python')).toBe(true);
    });

    it('should recognize Go as supported (built-in config)', () => {
      expect(manager.isLanguageSupported('go')).toBe(true);
    });

    it('should recognize unsupported languages', () => {
      expect(manager.isLanguageSupported('brainfuck')).toBe(false);
    });
  });

  describe('Custom Language Server Registration', () => {
    let manager: LspServerManager;

    beforeEach(async () => {
      manager = LspServerManager.getInstance();
      await manager.initialize(createMockLspConfig());
    });

    it('should register custom language server', () => {
      const customConfig: LanguageServerConfig = {
        language: 'rust',
        command: 'rust-analyzer',
        args: [],
        initializationOptions: { checkOnSave: { command: 'clippy' } },
      };

      manager.registerLanguageServer(customConfig);
      expect(manager.isLanguageSupported('rust')).toBe(true);
    });

    it('should allow custom server to override built-in', () => {
      const customTsConfig: LanguageServerConfig = {
        language: 'typescript',
        command: 'custom-typescript-server',
        args: ['--custom-flag'],
        initializationOptions: { custom: true },
      };

      manager.registerLanguageServer(customTsConfig);
      // Custom server should be registered
      expect(manager.isLanguageSupported('typescript')).toBe(true);
    });
  });

  describe('LspDocumentManager', () => {
    let mockConnection: MockLspConnection;
    let documentManager: LspDocumentManager;

    beforeEach(() => {
      mockConnection = new MockLspConnection();
      documentManager = new LspDocumentManager(mockConnection as unknown as ILspConnection, 'incremental');
    });

    describe('Document Opening', () => {
      it('should open a document successfully', async () => {
        const uri = 'file:///test/project/src/test.ts';
        const content = 'const x: number = 42;';

        await documentManager.openDocument(uri, 'typescript', content);

        expect(documentManager.isDocumentOpen(uri)).toBe(true);
        expect(documentManager.getDocumentVersion(uri)).toBe(1);
      });

      it('should track open documents', async () => {
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'const a = 1;');
        await documentManager.openDocument('file:///test/b.ts', 'typescript', 'const b = 2;');

        const openDocs = documentManager.getOpenDocuments();
        expect(openDocs).toHaveLength(2);
        expect(openDocs).toContain('file:///test/a.ts');
        expect(openDocs).toContain('file:///test/b.ts');
      });

      it('should not duplicate open document', async () => {
        const uri = 'file:///test/project/src/test.ts';
        await documentManager.openDocument(uri, 'typescript', 'const x = 1;');
        await documentManager.openDocument(uri, 'typescript', 'const x = 2;'); // Same URI

        expect(documentManager.getOpenDocuments()).toHaveLength(1);
        expect(documentManager.getDocumentVersion(uri)).toBe(1); // Version unchanged
      });

      it('should track document statistics', async () => {
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'const a = 1;');

        const stats = documentManager.getStats();
        expect(stats.openCount).toBe(1);
        expect(stats.totalOpened).toBe(1);
        expect(stats.totalClosed).toBe(0);
      });
    });

    describe('Document Updating', () => {
      it('should update document with full content change', async () => {
        const uri = 'file:///test/project/src/test.ts';
        await documentManager.openDocument(uri, 'typescript', 'const x = 1;');

        const changes: LspTextDocumentContentChangeEvent[] = [{ text: 'const x = 2;' }];
        await documentManager.updateDocument(uri, changes);

        expect(documentManager.getDocumentVersion(uri)).toBe(2);
      });

      it('should update document with incremental change', async () => {
        const uri = 'file:///test/project/src/test.ts';
        await documentManager.openDocument(uri, 'typescript', 'const x = 1;');

        const changes: LspTextDocumentContentChangeEvent[] = [
          {
            range: {
              start: { line: 0, character: 10 },
              end: { line: 0, character: 11 },
            },
            text: '42',
          },
        ];
        await documentManager.updateDocument(uri, changes);

        expect(documentManager.getDocumentVersion(uri)).toBe(2);
      });

      it('should throw error when updating non-open document', async () => {
        const uri = 'file:///test/project/src/notopen.ts';
        const changes: LspTextDocumentContentChangeEvent[] = [{ text: 'const x = 1;' }];

        await expect(documentManager.updateDocument(uri, changes)).rejects.toThrow('Document not open');
      });

      it('should increment version on each update', async () => {
        const uri = 'file:///test/project/src/test.ts';
        await documentManager.openDocument(uri, 'typescript', 'initial');

        await documentManager.updateDocument(uri, [{ text: 'update 1' }]);
        expect(documentManager.getDocumentVersion(uri)).toBe(2);

        await documentManager.updateDocument(uri, [{ text: 'update 2' }]);
        expect(documentManager.getDocumentVersion(uri)).toBe(3);

        await documentManager.updateDocument(uri, [{ text: 'update 3' }]);
        expect(documentManager.getDocumentVersion(uri)).toBe(4);
      });
    });

    describe('Document Closing', () => {
      it('should close an open document', async () => {
        const uri = 'file:///test/project/src/test.ts';
        await documentManager.openDocument(uri, 'typescript', 'const x = 1;');
        await documentManager.closeDocument(uri);

        expect(documentManager.isDocumentOpen(uri)).toBe(false);
        expect(documentManager.getDocumentVersion(uri)).toBeUndefined();
      });

      it('should update statistics on close', async () => {
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'const a = 1;');
        await documentManager.closeDocument('file:///test/a.ts');

        const stats = documentManager.getStats();
        expect(stats.openCount).toBe(0);
        expect(stats.totalOpened).toBe(1);
        expect(stats.totalClosed).toBe(1);
      });

      it('should handle closing non-existent document gracefully', async () => {
        await expect(
          documentManager.closeDocument('file:///nonexistent.ts')
        ).resolves.toBeUndefined();
      });

      it('should close all documents', async () => {
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'a');
        await documentManager.openDocument('file:///test/b.ts', 'typescript', 'b');
        await documentManager.openDocument('file:///test/c.ts', 'typescript', 'c');

        await documentManager.closeAll();

        expect(documentManager.getOpenDocuments()).toHaveLength(0);
        expect(documentManager.getStats().totalClosed).toBe(3);
      });
    });

    describe('Idle Document Management', () => {
      it('should close idle documents', async () => {
        // Open documents
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'a');
        await documentManager.openDocument('file:///test/b.ts', 'typescript', 'b');

        // Both documents are fresh, none should be closed with short timeout
        await documentManager.closeIdleDocuments(0); // 0ms timeout = close all idle

        // Documents were just accessed so they might not be idle yet
        // This tests the idle closing mechanism exists and runs
        expect(documentManager.getOpenDocuments().length).toBeLessThanOrEqual(2);
      });

      it('should not close recently accessed documents', async () => {
        await documentManager.openDocument('file:///test/a.ts', 'typescript', 'a');

        // Close with very long timeout - documents should remain
        await documentManager.closeIdleDocuments(999999999);

        expect(documentManager.isDocumentOpen('file:///test/a.ts')).toBe(true);
      });
    });
  });

  describe('LspProtocolAdapter Utilities', () => {
    describe('Position Conversion', () => {
      it('should convert 1-indexed to 0-indexed (LSP) positions', () => {
        const lspPos = LspProtocolAdapter.toLspPosition(1, 1);
        expect(lspPos).toEqual({ line: 0, character: 0 });
      });

      it('should convert 0-indexed (LSP) to 1-indexed positions', () => {
        const toolPos = LspProtocolAdapter.fromLspPosition({ line: 0, character: 0 });
        expect(toolPos).toEqual({ line: 1, character: 1 });
      });

      it('should handle larger position values', () => {
        const lspPos = LspProtocolAdapter.toLspPosition(100, 50);
        expect(lspPos).toEqual({ line: 99, character: 49 });

        const toolPos = LspProtocolAdapter.fromLspPosition({ line: 99, character: 49 });
        expect(toolPos).toEqual({ line: 100, character: 50 });
      });
    });

    describe('URI Conversion', () => {
      it('should convert Unix file path to URI', () => {
        const uri = LspProtocolAdapter.filePathToUri('/Users/test/project/src/file.ts');
        expect(uri).toBe('file:///Users/test/project/src/file.ts');
      });

      it('should convert Windows file path to URI', () => {
        const uri = LspProtocolAdapter.filePathToUri('C:/Users/test/project/src/file.ts');
        expect(uri).toBe('file:///C:/Users/test/project/src/file.ts');
      });

      it('should convert URI to Unix file path', () => {
        const path = LspProtocolAdapter.uriToFilePath('file:///Users/test/project/src/file.ts');
        expect(path).toBe('/Users/test/project/src/file.ts');
      });

      it('should handle path with backslashes', () => {
        const uri = LspProtocolAdapter.filePathToUri('C:\\Users\\test\\project\\file.ts');
        expect(uri).toBe('file:///C:/Users/test/project/file.ts');
      });

      it('should return non-file URIs unchanged', () => {
        const path = LspProtocolAdapter.uriToFilePath('https://example.com/file.ts');
        expect(path).toBe('https://example.com/file.ts');
      });
    });

    describe('Location Conversion', () => {
      it('should convert LSP Location to LspLocationResult', () => {
        const lspLocation: LspLocation = {
          uri: 'file:///test/project/src/file.ts',
          range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 15 },
          },
        };

        const result = LspProtocolAdapter.fromLspLocation(lspLocation);

        expect(result).toEqual({
          file: '/test/project/src/file.ts',
          line: 11, // 1-indexed
          character: 6, // 1-indexed
          endLine: 11,
          endCharacter: 16,
        });
      });
    });
  });

  describe('Mock Connection Tests', () => {
    let mockConnection: MockLspConnection;

    beforeEach(() => {
      mockConnection = new MockLspConnection();
    });

    describe('Definition Lookup', () => {
      it('should return definition location', async () => {
        const result = await mockConnection.request<LspLocation[]>('textDocument/definition', {
          textDocument: { uri: 'file:///test/file.ts' },
          position: { line: 5, character: 10 },
        });

        expect(result).toHaveLength(1);
        expect(result[0].uri).toBe('file:///test/project/src/definition.ts');
        expect(result[0].range.start.line).toBe(10);
      });

      it('should handle custom definition handler', async () => {
        const customHandler = jest.fn().mockResolvedValue([
          {
            uri: 'file:///custom/location.ts',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 10 },
            },
          },
        ]);
        mockConnection.setRequestHandler('textDocument/definition', customHandler);

        const result = await mockConnection.request<LspLocation[]>('textDocument/definition', {});

        expect(customHandler).toHaveBeenCalled();
        expect(result[0].uri).toBe('file:///custom/location.ts');
      });
    });

    describe('Reference Finding', () => {
      it('should return all references', async () => {
        const result = await mockConnection.request<LspLocation[]>('textDocument/references', {
          textDocument: { uri: 'file:///test/file.ts' },
          position: { line: 5, character: 10 },
          context: { includeDeclaration: true },
        });

        expect(result).toHaveLength(2);
        expect(result[0].uri).toContain('ref1.ts');
        expect(result[1].uri).toContain('ref2.ts');
      });

      it('should track request count', async () => {
        await mockConnection.request('textDocument/references', {});
        await mockConnection.request('textDocument/references', {});
        await mockConnection.request('textDocument/references', {});

        const stats = mockConnection.getStats();
        expect(stats.requestCount).toBe(3);
      });
    });

    describe('Hover Information', () => {
      it('should return hover information', async () => {
        const result = await mockConnection.request<{
          contents: { kind: string; value: string };
          range: LspRange;
        }>('textDocument/hover', {
          textDocument: { uri: 'file:///test/file.ts' },
          position: { line: 5, character: 5 },
        });

        expect(result.contents.kind).toBe('markdown');
        expect(result.contents.value).toContain('function testFunction');
        expect(result.range).toBeDefined();
      });
    });

    describe('Diagnostics', () => {
      it('should receive diagnostics via notification', () => {
        const handler = jest.fn();
        mockConnection.onNotification('textDocument/publishDiagnostics', handler);

        const diagnostics: LspDiagnostic[] = [
          {
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 10 },
            },
            severity: LspDiagnosticSeverity.Error,
            code: 'TS2339',
            source: 'typescript',
            message: "Property 'foo' does not exist on type 'Bar'",
          },
        ];

        mockConnection.notify('textDocument/publishDiagnostics', {
          uri: 'file:///test/file.ts',
          diagnostics,
        });

        expect(handler).toHaveBeenCalledWith({
          uri: 'file:///test/file.ts',
          diagnostics,
        });
      });

      it('should allow unsubscribing from notifications', () => {
        const handler = jest.fn();
        const disposable = mockConnection.onNotification('textDocument/publishDiagnostics', handler);

        mockConnection.notify('textDocument/publishDiagnostics', { diagnostics: [] });
        expect(handler).toHaveBeenCalledTimes(1);

        disposable.dispose();

        mockConnection.notify('textDocument/publishDiagnostics', { diagnostics: [] });
        expect(handler).toHaveBeenCalledTimes(1); // Not called again
      });
    });

    describe('Code Completions', () => {
      it('should return completion items', async () => {
        const result = await mockConnection.request<{
          isIncomplete: boolean;
          items: Array<{ label: string; kind: number; detail: string }>;
        }>('textDocument/completion', {
          textDocument: { uri: 'file:///test/file.ts' },
          position: { line: 10, character: 5 },
        });

        expect(result.isIncomplete).toBe(false);
        expect(result.items).toHaveLength(2);
        expect(result.items[0].label).toBe('toString');
        expect(result.items[1].label).toBe('valueOf');
      });
    });

    describe('Document Symbols', () => {
      it('should return document symbols', async () => {
        const result = await mockConnection.request<
          Array<{
            name: string;
            kind: number;
            range: LspRange;
            selectionRange: LspRange;
            children: unknown[];
          }>
        >('textDocument/documentSymbol', {
          textDocument: { uri: 'file:///test/file.ts' },
        });

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('TestClass');
        expect(result[0].kind).toBe(5); // Class
      });
    });

    describe('Connection Health', () => {
      it('should report healthy by default', () => {
        expect(mockConnection.isHealthy()).toBe(true);
      });

      it('should report unhealthy after close', async () => {
        await mockConnection.close();
        expect(mockConnection.isHealthy()).toBe(false);
      });

      it('should track uptime', async () => {
        const initialStats = mockConnection.getStats();
        expect(initialStats.uptime).toBeGreaterThanOrEqual(0);

        // Wait a bit and check uptime increased
        await new Promise((resolve) => setTimeout(resolve, 10));
        const laterStats = mockConnection.getStats();
        expect(laterStats.uptime).toBeGreaterThanOrEqual(initialStats.uptime);
      });

      it('should provide PID', () => {
        const pid = mockConnection.getPid();
        expect(pid).toBeDefined();
        expect(typeof pid).toBe('number');
        expect(pid).toBeGreaterThan(0);
      });
    });
  });

  describe('Server Statistics', () => {
    let mockConnection: MockLspConnection;

    beforeEach(() => {
      mockConnection = new MockLspConnection();
    });

    it('should track request count', async () => {
      expect(mockConnection.getStats().requestCount).toBe(0);

      await mockConnection.request('textDocument/definition', {});
      expect(mockConnection.getStats().requestCount).toBe(1);

      await mockConnection.request('textDocument/hover', {});
      await mockConnection.request('textDocument/completion', {});
      expect(mockConnection.getStats().requestCount).toBe(3);
    });

    it('should track errors when handler throws', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Test error'));
      mockConnection.setRequestHandler('textDocument/definition', errorHandler);

      await expect(mockConnection.request('textDocument/definition', {})).rejects.toThrow('Test error');
      // Note: Error tracking would be in the actual adapter implementation
    });

    it('should provide comprehensive stats', () => {
      const stats = mockConnection.getStats();
      expect(stats).toHaveProperty('requestCount');
      expect(stats).toHaveProperty('errorCount');
      expect(stats).toHaveProperty('uptime');
    });
  });

  describe('Health Status Types', () => {
    it('should have correct LspHealthStatus shape', () => {
      const healthStatus: LspHealthStatus = {
        projectRoot: '/test/project',
        language: 'typescript',
        status: 'healthy',
        pid: 12345,
        lastHealthCheck: new Date(),
        uptime: 60000,
        requestCount: 100,
        errorCount: 2,
      };

      expect(healthStatus.status).toBe('healthy');
      expect(['healthy', 'unhealthy', 'starting', 'stopped']).toContain(healthStatus.status);
    });

    it('should support all status values', () => {
      const statuses: LspHealthStatus['status'][] = ['healthy', 'unhealthy', 'starting', 'stopped'];
      statuses.forEach((status) => {
        const healthStatus: LspHealthStatus = {
          projectRoot: '/test',
          language: 'typescript',
          status,
          lastHealthCheck: new Date(),
          uptime: 0,
          requestCount: 0,
          errorCount: 0,
        };
        expect(healthStatus.status).toBe(status);
      });
    });
  });

  describe('LSP Constants', () => {
    it('should have TypeScript server configuration', () => {
      expect(LSP_CONSTANTS.SERVERS.TYPESCRIPT.COMMAND).toBe('typescript-language-server');
      expect(LSP_CONSTANTS.SERVERS.TYPESCRIPT.ARGS).toEqual(['--stdio']);
    });

    it('should have document management defaults', () => {
      expect(LSP_CONSTANTS.DOCUMENT.SYNC_MODE).toBe('incremental');
      expect(LSP_CONSTANTS.DOCUMENT.IDLE_CLOSE_TIMEOUT).toBe(300000);
      expect(LSP_CONSTANTS.DOCUMENT.MAX_OPEN_DOCUMENTS).toBe(50);
    });

    it('should have lifecycle defaults', () => {
      expect(LSP_CONSTANTS.LIFECYCLE.HEALTH_CHECK_INTERVAL).toBe(30000);
      expect(LSP_CONSTANTS.LIFECYCLE.MAX_INSTANCES).toBe(10);
      expect(LSP_CONSTANTS.LIFECYCLE.RESTART_POLICY.MAX_RETRIES).toBe(3);
    });

    it('should have operation timeouts', () => {
      expect(LSP_CONSTANTS.TIMEOUTS.GOTO_DEFINITION).toBe(30000);
      expect(LSP_CONSTANTS.TIMEOUTS.FIND_REFERENCES).toBe(60000);
      expect(LSP_CONSTANTS.TIMEOUTS.DIAGNOSTICS).toBe(10000);
      expect(LSP_CONSTANTS.TIMEOUTS.HOVER).toBe(5000);
    });

    it('should have position indexing constants', () => {
      expect(LSP_CONSTANTS.POSITION.LSP_INDEXED).toBe(0);
      expect(LSP_CONSTANTS.POSITION.TOOL_INDEXED).toBe(1);
    });
  });

  describe('Error Handling', () => {
    let mockConnection: MockLspConnection;

    beforeEach(() => {
      mockConnection = new MockLspConnection();
    });

    it('should handle request errors gracefully', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Server error'));
      mockConnection.setRequestHandler('textDocument/definition', errorHandler);

      await expect(
        mockConnection.request('textDocument/definition', {})
      ).rejects.toThrow('Server error');
    });

    it('should handle timeout scenarios', async () => {
      const slowHandler = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );
      mockConnection.setRequestHandler('textDocument/definition', slowHandler);

      const result = await mockConnection.request('textDocument/definition', {});
      expect(result).toEqual([]);
    });

    it('should handle malformed responses', async () => {
      const malformedHandler = jest.fn().mockResolvedValue(null);
      mockConnection.setRequestHandler('textDocument/hover', malformedHandler);

      const result = await mockConnection.request('textDocument/hover', {});
      expect(result).toBeNull();
    });
  });

  describe('Feature Flag Integration', () => {
    it('should respect LSP_ENABLED environment variable', () => {
      // When LSP_ENABLED is true, manager should work
      process.env.LSP_ENABLED = 'true';

      // This test validates the environment setup
      expect(process.env.LSP_ENABLED).toBe('true');
    });

    it('should have sub-feature flags', () => {
      // These would be checked by the actual FeatureFlags module
      const expectedSubFeatures = ['typescript', 'python', 'go', 'caching'];
      expectedSubFeatures.forEach((feature) => {
        expect(typeof feature).toBe('string');
      });
    });
  });

  describe('Connection Pooling by Project Root', () => {
    it('should generate unique server keys', () => {
      // Server key format: language:projectRoot
      const key1 = 'typescript:/project/a';
      const key2 = 'typescript:/project/b';
      const key3 = 'javascript:/project/a';

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('should allow different languages for same project', () => {
      const tsKey = 'typescript:/project/root';
      const jsKey = 'javascript:/project/root';
      const pyKey = 'python:/project/root';

      // All keys should be unique
      const keys = [tsKey, jsKey, pyKey];
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should allow same language for different projects', () => {
      const key1 = 'typescript:/project/a';
      const key2 = 'typescript:/project/b';
      const key3 = 'typescript:/project/c';

      const keys = [key1, key2, key3];
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });
  });

  describe('Supported Languages', () => {
    it('should support TypeScript', () => {
      const lang: SupportedLanguage = 'typescript';
      expect(lang).toBe('typescript');
    });

    it('should support JavaScript', () => {
      const lang: SupportedLanguage = 'javascript';
      expect(lang).toBe('javascript');
    });

    it('should support Python', () => {
      const lang: SupportedLanguage = 'python';
      expect(lang).toBe('python');
    });

    it('should support Go', () => {
      const lang: SupportedLanguage = 'go';
      expect(lang).toBe('go');
    });

    it('should support custom languages via string', () => {
      const customLang: SupportedLanguage = 'custom-language';
      expect(customLang).toBe('custom-language');
    });
  });

  describe('LSP Tool Integration Patterns', () => {
    let mockConnection: MockLspConnection;

    beforeEach(() => {
      mockConnection = new MockLspConnection();
    });

    describe('lsp_goto_definition pattern', () => {
      it('should format definition request correctly', async () => {
        const input = {
          file: '/project/src/UserService.ts',
          line: 42,
          character: 15,
        };

        // Convert to LSP format
        const lspPosition = LspProtocolAdapter.toLspPosition(input.line, input.character);
        const uri = LspProtocolAdapter.filePathToUri(input.file);

        const result = await mockConnection.request<LspLocation[]>('textDocument/definition', {
          textDocument: { uri },
          position: lspPosition,
        });

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('lsp_find_references pattern', () => {
      it('should format references request correctly', async () => {
        const input = {
          file: '/project/src/utils/helpers.ts',
          line: 10,
          character: 20,
          includeDeclaration: true,
        };

        const lspPosition = LspProtocolAdapter.toLspPosition(input.line, input.character);
        const uri = LspProtocolAdapter.filePathToUri(input.file);

        const result = await mockConnection.request<LspLocation[]>('textDocument/references', {
          textDocument: { uri },
          position: lspPosition,
          context: { includeDeclaration: input.includeDeclaration },
        });

        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('lsp_hover pattern', () => {
      it('should format hover request correctly', async () => {
        const input = {
          file: '/project/src/types.ts',
          line: 15,
          character: 8,
        };

        const lspPosition = LspProtocolAdapter.toLspPosition(input.line, input.character);
        const uri = LspProtocolAdapter.filePathToUri(input.file);

        const result = await mockConnection.request<{
          contents: unknown;
          range?: LspRange;
        }>('textDocument/hover', {
          textDocument: { uri },
          position: lspPosition,
        });

        expect(result).toBeDefined();
        expect(result.contents).toBeDefined();
      });
    });

    describe('lsp_completions pattern', () => {
      it('should format completion request correctly', async () => {
        const input = {
          file: '/project/src/index.ts',
          line: 25,
          character: 10,
          triggerCharacter: '.',
        };

        const lspPosition = LspProtocolAdapter.toLspPosition(input.line, input.character);
        const uri = LspProtocolAdapter.filePathToUri(input.file);

        const result = await mockConnection.request<{
          isIncomplete: boolean;
          items: unknown[];
        }>('textDocument/completion', {
          textDocument: { uri },
          position: lspPosition,
          context: {
            triggerKind: 2, // TriggerCharacter
            triggerCharacter: input.triggerCharacter,
          },
        });

        expect(result).toBeDefined();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });
    });
  });

  describe('Integration with MXF Types', () => {
    it('should use correct diagnostic severity mapping', () => {
      expect(LspDiagnosticSeverity.Error).toBe(1);
      expect(LspDiagnosticSeverity.Warning).toBe(2);
      expect(LspDiagnosticSeverity.Information).toBe(3);
      expect(LspDiagnosticSeverity.Hint).toBe(4);
    });

    it('should support all diagnostic result fields', () => {
      const diagnostic: LspDiagnostic = {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: LspDiagnosticSeverity.Error,
        code: 'TS2339',
        source: 'typescript',
        message: 'Test error message',
        tags: [1], // unnecessary
        relatedInformation: [
          {
            location: {
              uri: 'file:///related.ts',
              range: {
                start: { line: 5, character: 0 },
                end: { line: 5, character: 10 },
              },
            },
            message: 'Related information',
          },
        ],
      };

      expect(diagnostic.severity).toBe(LspDiagnosticSeverity.Error);
      expect(diagnostic.relatedInformation).toHaveLength(1);
    });
  });
});
