/**
 * LSP (Language Server Protocol) Types for MXF
 *
 * Type definitions for LSP-MCP Bridge integration.
 * Feature flag: LSP_ENABLED
 */

/**
 * Supported programming languages
 */
export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | string; // Allow custom languages

/**
 * LSP Position (0-indexed)
 */
export interface LspPosition {
  /** Line number (0-indexed) */
  line: number;
  /** Character position (0-indexed, UTF-16 code units) */
  character: number;
}

/**
 * LSP Range
 */
export interface LspRange {
  /** Start position */
  start: LspPosition;
  /** End position */
  end: LspPosition;
}

/**
 * LSP Location
 */
export interface LspLocation {
  /** File URI (file:///absolute/path) */
  uri: string;
  /** Location range */
  range: LspRange;
}

/**
 * LSP Location result (for tools, 1-indexed)
 */
export interface LspLocationResult {
  /** Absolute file path */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Character position (1-indexed) */
  character: number;
  /** End line (1-indexed, optional) */
  endLine?: number;
  /** End character (1-indexed, optional) */
  endCharacter?: number;
}

/**
 * LSP Diagnostic severity
 */
export enum LspDiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/**
 * LSP Diagnostic
 */
export interface LspDiagnostic {
  /** Diagnostic range */
  range: LspRange;
  /** Severity level */
  severity?: LspDiagnosticSeverity;
  /** Diagnostic code */
  code?: string | number;
  /** Source (e.g., 'typescript', 'eslint') */
  source?: string;
  /** Diagnostic message */
  message: string;
  /** Related information */
  relatedInformation?: LspDiagnosticRelatedInformation[];
  /** Tags (e.g., 'unnecessary', 'deprecated') */
  tags?: number[];
}

/**
 * Related diagnostic information
 */
export interface LspDiagnosticRelatedInformation {
  /** Related location */
  location: LspLocation;
  /** Related message */
  message: string;
}

/**
 * Symbol kind
 */
export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/**
 * Document symbol
 */
export interface LspDocumentSymbol {
  /** Symbol name */
  name: string;
  /** Symbol detail */
  detail?: string;
  /** Symbol kind */
  kind: LspSymbolKind;
  /** Symbol range */
  range: LspRange;
  /** Selection range */
  selectionRange: LspRange;
  /** Child symbols */
  children?: LspDocumentSymbol[];
}

/**
 * Workspace symbol
 */
export interface LspWorkspaceSymbol {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: LspSymbolKind;
  /** Symbol location */
  location: LspLocation;
  /** Container name */
  containerName?: string;
}

/**
 * Completion item kind
 */
export enum LspCompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

/**
 * Completion item
 */
export interface LspCompletionItem {
  /** Completion label */
  label: string;
  /** Completion kind */
  kind?: LspCompletionItemKind;
  /** Detail information */
  detail?: string;
  /** Documentation */
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  /** Sort text */
  sortText?: string;
  /** Filter text */
  filterText?: string;
  /** Insert text */
  insertText?: string;
  /** Insert text format */
  insertTextFormat?: 1 | 2; // 1 = PlainText, 2 = Snippet
  /** Text edit */
  textEdit?: LspTextEdit;
  /** Additional text edits */
  additionalTextEdits?: LspTextEdit[];
}

/**
 * Text edit
 */
export interface LspTextEdit {
  /** Edit range */
  range: LspRange;
  /** New text */
  newText: string;
}

/**
 * Workspace edit
 */
export interface LspWorkspaceEdit {
  /** Document changes (URI -> TextEdit[]) */
  changes?: Record<string, LspTextEdit[]>;
  /** Document changes with versioning */
  documentChanges?: Array<LspTextDocumentEdit | LspCreateFile | LspRenameFile | LspDeleteFile>;
}

/**
 * Text document edit
 */
export interface LspTextDocumentEdit {
  /** Text document identifier */
  textDocument: {
    uri: string;
    version: number | null;
  };
  /** Text edits */
  edits: LspTextEdit[];
}

/**
 * Create file operation
 */
export interface LspCreateFile {
  /** Operation kind */
  kind: 'create';
  /** File URI */
  uri: string;
  /** Options */
  options?: {
    overwrite?: boolean;
    ignoreIfExists?: boolean;
  };
}

/**
 * Rename file operation
 */
export interface LspRenameFile {
  /** Operation kind */
  kind: 'rename';
  /** Old file URI */
  oldUri: string;
  /** New file URI */
  newUri: string;
  /** Options */
  options?: {
    overwrite?: boolean;
    ignoreIfExists?: boolean;
  };
}

/**
 * Delete file operation
 */
export interface LspDeleteFile {
  /** Operation kind */
  kind: 'delete';
  /** File URI */
  uri: string;
  /** Options */
  options?: {
    recursive?: boolean;
    ignoreIfNotExists?: boolean;
  };
}

/**
 * Hover information
 */
export interface LspHover {
  /** Hover contents */
  contents: string | { kind: 'markdown' | 'plaintext'; value: string };
  /** Hover range */
  range?: LspRange;
}

/**
 * Text document content change event
 */
export interface LspTextDocumentContentChangeEvent {
  /** Change range (undefined for full document) */
  range?: LspRange;
  /** Range length (for validation) */
  rangeLength?: number;
  /** New text */
  text: string;
}

/**
 * Language server configuration
 */
export interface LanguageServerConfig {
  /** Programming language */
  language: SupportedLanguage;
  /** Server command */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Initialization options */
  initializationOptions?: Record<string, unknown>;
  /** Server capabilities (subset) */
  capabilities?: Partial<{
    definitionProvider: boolean;
    referencesProvider: boolean;
    hoverProvider: boolean;
    completionProvider: { triggerCharacters?: string[] };
    renameProvider: boolean;
    documentSymbolProvider: boolean;
    workspaceSymbolProvider: boolean;
  }>;
}

/**
 * TypeScript server configuration
 */
export interface TypeScriptServerConfig {
  /** Enable TypeScript server */
  enabled: boolean;
  /** Server command */
  command: string;
  /** Command arguments */
  args: string[];
  /** Path to node_modules with tsserver */
  nodeModulesPath?: string;
  /** Path to tsconfig.json */
  tsconfig?: string;
  /** Maximum tsserver memory (MB) */
  maxTsServerMemory?: number;
}

/**
 * Python server configuration
 */
export interface PythonServerConfig {
  /** Enable Python server */
  enabled: boolean;
  /** Server type */
  type: 'pylsp' | 'pyright';
  /** Server command */
  command: string;
  /** Command arguments */
  args: string[];
  /** Python interpreter path */
  pythonPath?: string;
  /** Virtual environment path */
  venvPath?: string;
}

/**
 * Go server configuration
 */
export interface GoServerConfig {
  /** Enable Go server */
  enabled: boolean;
  /** Server command */
  command: string;
  /** Command arguments */
  args: string[];
  /** GOPATH */
  gopath?: string;
  /** GOROOT */
  goroot?: string;
}

/**
 * Custom server configuration
 */
export interface CustomServerConfig {
  /** Server name */
  name: string;
  /** File extensions this server handles */
  extensions: string[];
  /** Server command */
  command: string;
  /** Command arguments */
  args: string[];
  /** Initialization options */
  initializationOptions?: Record<string, unknown>;
}

/**
 * LSP health status
 */
export interface LspHealthStatus {
  /** Project root path */
  projectRoot: string;
  /** Programming language */
  language: SupportedLanguage;
  /** Server status */
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopped';
  /** Server process ID */
  pid?: number;
  /** Last health check timestamp */
  lastHealthCheck: Date;
  /** Server uptime (milliseconds) */
  uptime: number;
  /** Total requests handled */
  requestCount: number;
  /** Total errors */
  errorCount: number;
}

/**
 * LSP configuration
 */
export interface LspConfig {
  /** Enable LSP integration */
  enabled: boolean;

  /** Server configurations */
  servers: {
    typescript: TypeScriptServerConfig;
    python?: PythonServerConfig;
    go?: GoServerConfig;
    custom?: CustomServerConfig[];
  };

  /** Document management */
  document: {
    /** Sync mode: full or incremental */
    syncMode: 'full' | 'incremental';
    /** Idle close timeout (milliseconds) */
    idleCloseTimeout: number;
    /** Maximum open documents */
    maxOpenDocuments: number;
  };

  /** Lifecycle management */
  lifecycle: {
    /** Health check interval (milliseconds) */
    healthCheckInterval: number;
    /** Startup timeout (milliseconds) */
    startupTimeout: number;
    /** Shutdown timeout (milliseconds) */
    shutdownTimeout: number;
    /** Maximum server instances */
    maxInstances: number;
    /** Restart policy */
    restartPolicy: {
      /** Maximum retry attempts */
      maxRetries: number;
      /** Backoff multiplier */
      backoffMultiplier: number;
      /** Initial delay (milliseconds) */
      initialDelay: number;
      /** Maximum delay (milliseconds) */
      maxDelay: number;
    };
  };

  /** Caching */
  cache: {
    /** Enable caching */
    enabled: boolean;
    /** Diagnostics TTL (milliseconds) */
    diagnosticsTtl: number;
    /** Symbols TTL (milliseconds) */
    symbolsTtl: number;
    /** Completions TTL (milliseconds) */
    completionsTtl: number;
  };

  /** Security */
  security: {
    /** Allowed project root patterns (glob) */
    allowedRoots: string[];
    /** Blocked commands */
    blockedCommands: string[];
  };

  /** Analytics */
  analytics: {
    /** Track LSP operations */
    trackOperations: boolean;
    /** Track performance metrics */
    trackPerformance: boolean;
    /** Track errors */
    trackErrors: boolean;
  };
}

/**
 * LSP tool result types
 */

export interface LspDefinitionResult {
  success: boolean;
  locations: LspLocationResult[];
  message?: string;
}

export interface LspReferencesResult {
  success: boolean;
  references: LspLocationResult[];
  totalCount: number;
  message?: string;
}

export interface LspDiagnosticResult {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  code?: string | number;
  source?: string;
  relatedInformation?: Array<{
    location: LspLocationResult;
    message: string;
  }>;
}

export interface LspDiagnosticsResult {
  success: boolean;
  diagnostics: LspDiagnosticResult[];
  counts: {
    errors: number;
    warnings: number;
    information: number;
    hints: number;
  };
}

export interface LspCompletionItemResult {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  sortText?: string;
  insertText: string;
  insertTextFormat?: 'plaintext' | 'snippet';
}

export interface LspCompletionsResult {
  success: boolean;
  items: LspCompletionItemResult[];
  isIncomplete: boolean;
  message?: string;
}

export interface LspHoverResult {
  success: boolean;
  contents: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message?: string;
}

export interface LspRenameEdit {
  file: string;
  edits: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }>;
}

export interface LspRenameResult {
  success: boolean;
  edits: LspRenameEdit[];
  filesAffected: number;
  locationsAffected: number;
  preview: boolean;
  message?: string;
}

export interface LspSymbolResult {
  name: string;
  kind: string;
  location: LspLocationResult;
  containerName?: string;
  children?: LspSymbolResult[];
}

export interface LspDocumentSymbolsResult {
  success: boolean;
  symbols: LspSymbolResult[];
  message?: string;
}

export interface LspWorkspaceSymbolsResult {
  success: boolean;
  symbols: LspSymbolResult[];
  totalCount: number;
  message?: string;
}

/**
 * Disposable pattern for cleanup
 */
export interface Disposable {
  dispose(): void;
}
