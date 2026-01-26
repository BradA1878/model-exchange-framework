/**
 * LSP Server Manager
 *
 * Manages language server lifecycle including spawning, health monitoring,
 * and connection pooling by project root.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { Logger } from '../../utils/Logger';
import { ILspServerManager } from './interfaces/ILspServerManager';
import { ILspConnection } from './interfaces/ILspConnection';
import { LspProtocolAdapter } from './LspProtocolAdapter';
import { LspDocumentManager } from './LspDocumentManager';
import {
  SupportedLanguage,
  LanguageServerConfig,
  LspHealthStatus,
  LspConfig,
  Disposable,
} from '../../types/LspTypes';
import { LSP_CONSTANTS } from '../../constants/EnhancementConstants';
import { FEATURE_FLAGS } from '../../config/FeatureFlags';

const logger = new Logger('info', 'LspServerManager', 'server');

/**
 * Server instance with connection and document manager
 */
interface ServerInstance {
  projectRoot: string;
  language: SupportedLanguage;
  process: ChildProcess;
  adapter: LspProtocolAdapter;
  connection: LspConnection;
  documentManager: LspDocumentManager;
  startedAt: number;
  healthCheckInterval?: NodeJS.Timeout;
}

/**
 * LSP Connection Implementation
 */
class LspConnection implements ILspConnection {
  private adapter: LspProtocolAdapter;
  private documentManager: LspDocumentManager;

  constructor(adapter: LspProtocolAdapter, documentManager: LspDocumentManager) {
    this.adapter = adapter;
    this.documentManager = documentManager;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    return this.adapter.request<T>(method, params);
  }

  notify(method: string, params: unknown): void {
    this.adapter.notify(method, params);
  }

  onNotification(method: string, handler: (params: unknown) => void): Disposable {
    return this.adapter.onNotification(method, handler);
  }

  isHealthy(): boolean {
    return this.adapter.isHealthy();
  }

  async close(): Promise<void> {
    await this.documentManager.closeAll();
    await this.adapter.close();
  }

  getPid(): number | undefined {
    return this.adapter.getPid();
  }

  getStats(): { requestCount: number; errorCount: number; uptime: number } {
    return this.adapter.getStats();
  }

  getDocumentManager(): LspDocumentManager {
    return this.documentManager;
  }
}

/**
 * LSP Server Manager Implementation
 *
 * Singleton service for managing language server instances.
 */
export class LspServerManager implements ILspServerManager {
  private static instance: LspServerManager | null = null;
  private servers = new Map<string, ServerInstance>();
  private config: LspConfig | null = null;
  private customServers = new Map<string, LanguageServerConfig>();
  private isShuttingDown = false;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  static getInstance(): LspServerManager {
    if (!LspServerManager.instance) {
      LspServerManager.instance = new LspServerManager();
    }
    return LspServerManager.instance;
  }

  /**
   * Initialize with configuration
   */
  async initialize(config: unknown): Promise<void> {
    this.config = config as LspConfig;
    logger.info('LSP Server Manager initialized');
  }

  /**
   * Get or create language server
   */
  async getServer(projectRoot: string, language: SupportedLanguage): Promise<ILspConnection> {
    // Check feature flag
    if (!FEATURE_FLAGS.lspEnabled) {
      throw new Error('LSP feature is not enabled. Set LSP_ENABLED=true to enable.');
    }

    const key = this.getServerKey(projectRoot, language);

    // Return existing server
    if (this.servers.has(key)) {
      const server = this.servers.get(key)!;
      if (server.connection.isHealthy()) {
        return server.connection;
      } else {
        // Server unhealthy, restart
        logger.warn(`Server unhealthy, restarting: ${key}`);
        await this.shutdownServer(projectRoot, language);
      }
    }

    // Check max instances
    if (this.servers.size >= (this.config?.lifecycle.maxInstances || LSP_CONSTANTS.LIFECYCLE.MAX_INSTANCES)) {
      throw new Error(
        `Maximum number of language server instances reached (${this.config?.lifecycle.maxInstances || LSP_CONSTANTS.LIFECYCLE.MAX_INSTANCES})`
      );
    }

    // Create new server
    return this.createServer(projectRoot, language);
  }

  /**
   * Create new language server instance
   */
  private async createServer(projectRoot: string, language: SupportedLanguage): Promise<ILspConnection> {
    logger.info(`Starting language server: ${language} for ${projectRoot}`);

    // Get server configuration
    const serverConfig = this.getServerConfig(language);
    if (!serverConfig) {
      throw new Error(`Language server not configured for: ${language}`);
    }

    // Spawn language server process
    const lspProcess = spawn(serverConfig.command, serverConfig.args, {
      cwd: projectRoot,
      env: { ...process.env, ...serverConfig.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Create adapter and connection
    const adapter = new LspProtocolAdapter(lspProcess);
    const syncMode = this.config?.document.syncMode || LSP_CONSTANTS.DOCUMENT.SYNC_MODE;
    const documentManager = new LspDocumentManager(adapter as any, syncMode);
    const connection = new LspConnection(adapter, documentManager);

    // Initialize language server
    await this.initializeServer(adapter, projectRoot, serverConfig);

    // Create server instance
    const instance: ServerInstance = {
      projectRoot,
      language,
      process: lspProcess,
      adapter,
      connection,
      documentManager,
      startedAt: Date.now(),
    };

    // Setup health check
    this.setupHealthCheck(instance);

    // Store instance
    const key = this.getServerKey(projectRoot, language);
    this.servers.set(key, instance);

    logger.info(`Language server started: ${language} (PID: ${lspProcess.pid})`);
    return connection;
  }

  /**
   * Initialize language server with LSP protocol
   */
  private async initializeServer(
    adapter: LspProtocolAdapter,
    projectRoot: string,
    config: LanguageServerConfig
  ): Promise<void> {
    try {
      // Send initialize request
      const initResult = await adapter.request('initialize', {
        processId: process.pid,
        rootPath: projectRoot,
        rootUri: LspProtocolAdapter.filePathToUri(projectRoot),
        capabilities: {
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
              didClose: true,
            },
            completion: {
              completionItem: {
                snippetSupport: true,
              },
            },
            definition: {
              linkSupport: true,
            },
            references: {},
            hover: {
              contentFormat: ['markdown', 'plaintext'],
            },
            rename: {},
            documentSymbol: {},
          },
          workspace: {
            symbol: {},
          },
        },
        initializationOptions: config.initializationOptions,
      });

      logger.debug(`Server initialized: ${JSON.stringify(initResult)}`);

      // Send initialized notification
      adapter.notify('initialized', {});
      adapter.setInitialized(true);
    } catch (error) {
      throw new Error(`Failed to initialize language server: ${error}`);
    }
  }

  /**
   * Setup health check for server instance
   */
  private setupHealthCheck(instance: ServerInstance): void {
    const interval =
      this.config?.lifecycle.healthCheckInterval || LSP_CONSTANTS.LIFECYCLE.HEALTH_CHECK_INTERVAL;

    instance.healthCheckInterval = setInterval(() => {
      if (!this.isShuttingDown && !instance.connection.isHealthy()) {
        logger.warn(`Server unhealthy, restarting: ${instance.language} (${instance.projectRoot})`);
        this.restartServer(instance).catch((error) => {
          logger.error(`Failed to restart server: ${error}`);
        });
      }
    }, interval);
  }

  /**
   * Restart server instance
   */
  private async restartServer(instance: ServerInstance): Promise<void> {
    const { projectRoot, language } = instance;
    await this.shutdownServer(projectRoot, language);
    await this.getServer(projectRoot, language);
  }

  /**
   * Shutdown specific server
   */
  async shutdownServer(projectRoot: string, language: SupportedLanguage): Promise<void> {
    const key = this.getServerKey(projectRoot, language);
    const instance = this.servers.get(key);

    if (!instance) {
      logger.debug(`Server not running: ${key}`);
      return;
    }

    logger.info(`Shutting down language server: ${key}`);

    // Clear health check
    if (instance.healthCheckInterval) {
      clearInterval(instance.healthCheckInterval);
    }

    // Close connection
    try {
      await instance.connection.close();
    } catch (error) {
      logger.warn(`Error closing server connection: ${error}`);
    }

    // Remove from tracking
    this.servers.delete(key);
    logger.info(`Language server shut down: ${key}`);
  }

  /**
   * Shutdown all servers
   */
  async shutdownAll(): Promise<void> {
    this.isShuttingDown = true;
    logger.info(`Shutting down all language servers (${this.servers.size} active)`);

    const shutdownPromises: Promise<void>[] = [];
    for (const [key, instance] of this.servers) {
      shutdownPromises.push(
        this.shutdownServer(instance.projectRoot, instance.language).catch((error) => {
          logger.error(`Error shutting down ${key}: ${error}`);
        })
      );
    }

    await Promise.all(shutdownPromises);
    this.servers.clear();
    logger.info('All language servers shut down');
  }

  /**
   * Get health status of all servers
   */
  getHealthStatus(): LspHealthStatus[] {
    const statuses: LspHealthStatus[] = [];

    for (const [key, instance] of this.servers) {
      const stats = instance.connection.getStats();
      const isHealthy = instance.connection.isHealthy();

      statuses.push({
        projectRoot: instance.projectRoot,
        language: instance.language,
        status: isHealthy ? 'healthy' : 'unhealthy',
        pid: instance.connection.getPid(),
        lastHealthCheck: new Date(),
        uptime: stats.uptime,
        requestCount: stats.requestCount,
        errorCount: stats.errorCount,
      });
    }

    return statuses;
  }

  /**
   * Register custom language server
   */
  registerLanguageServer(config: LanguageServerConfig): void {
    this.customServers.set(config.language, config);
    logger.info(`Registered custom language server: ${config.language}`);
  }

  /**
   * Check if language is supported
   */
  isLanguageSupported(language: string): boolean {
    return this.customServers.has(language) || this.hasBuiltInConfig(language);
  }

  /**
   * Get server count
   */
  getServerCount(): number {
    return this.servers.size;
  }

  /**
   * Get server key
   */
  private getServerKey(projectRoot: string, language: SupportedLanguage): string {
    return `${language}:${projectRoot}`;
  }

  /**
   * Get server configuration
   */
  private getServerConfig(language: SupportedLanguage): LanguageServerConfig | null {
    // Check custom servers first
    if (this.customServers.has(language)) {
      return this.customServers.get(language)!;
    }

    // Check built-in configurations
    if (language === 'typescript' || language === 'javascript') {
      if (this.config?.servers.typescript.enabled !== false && FEATURE_FLAGS.lsp.typescript) {
        return {
          language: 'typescript',
          command: this.config?.servers.typescript.command || LSP_CONSTANTS.SERVERS.TYPESCRIPT.COMMAND,
          args: this.config?.servers.typescript.args || [...LSP_CONSTANTS.SERVERS.TYPESCRIPT.ARGS],
          initializationOptions: {},
        };
      }
    }

    if (language === 'python') {
      if (this.config?.servers.python?.enabled && FEATURE_FLAGS.lsp.python) {
        return {
          language: 'python',
          command: this.config.servers.python.command || LSP_CONSTANTS.SERVERS.PYTHON.COMMAND,
          args: this.config.servers.python.args || [...LSP_CONSTANTS.SERVERS.PYTHON.ARGS],
          initializationOptions: {},
        };
      }
    }

    if (language === 'go') {
      if (this.config?.servers.go?.enabled && FEATURE_FLAGS.lsp.go) {
        return {
          language: 'go',
          command: this.config.servers.go.command || LSP_CONSTANTS.SERVERS.GO.COMMAND,
          args: this.config.servers.go.args || [...LSP_CONSTANTS.SERVERS.GO.ARGS],
          initializationOptions: {},
        };
      }
    }

    return null;
  }

  /**
   * Check if language has built-in configuration
   */
  private hasBuiltInConfig(language: string): boolean {
    return ['typescript', 'javascript', 'python', 'go'].includes(language);
  }
}
