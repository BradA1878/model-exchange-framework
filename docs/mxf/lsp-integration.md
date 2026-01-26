# LSP-MCP Bridge Integration

The LSP-MCP Bridge integrates Language Server Protocol (LSP) capabilities into MXF as MCP tools, enabling agents to perform intelligent code analysis, navigation, and manipulation across multiple programming languages.

## Overview

The LSP-MCP Bridge provides agents with advanced code intelligence through 8 MCP tools that interface with language servers. This enables agents to understand codebases, navigate code structures, diagnose errors, and perform safe refactoring operations.

### Key Capabilities

- **Code Navigation**: Jump to definitions, find references, explore symbol hierarchies
- **Diagnostics**: Real-time error detection, warnings, and hints
- **Code Intelligence**: Hover information, documentation, type details
- **Completions**: Context-aware code completion suggestions
- **Refactoring**: Safe project-wide renaming (preview mode)
- **Multi-Language Support**: TypeScript, JavaScript, Python, Go, Rust, and extensible to other languages

## Architecture

### Core Components

#### 1. LspProtocolAdapter
Handles JSON-RPC communication with language servers:
- **Message Encoding/Decoding**: JSON-RPC 2.0 protocol implementation
- **Request Correlation**: Tracks requests with timeouts (30s default)
- **Notification Handling**: Processes diagnostics and server events
- **Position Conversion**: Bidirectional conversion between 0-indexed (LSP) and 1-indexed (tools)
- **URI Handling**: Cross-platform file path ↔ URI conversion

#### 2. LspDocumentManager
Manages document lifecycle and synchronization:
- **Document Tracking**: Open/close/update operations
- **Version Control**: Incremental synchronization with version tracking
- **Idle Cleanup**: Automatic cleanup of unused documents (5min timeout)
- **Language Detection**: Automatic language ID from file extensions
- **Sync Modes**: Full and incremental content synchronization

#### 3. LspServerManager
Manages language server lifecycle:
- **Server Spawning**: Process management with stdio communication
- **Connection Pooling**: Per-project-root server instances
- **Circuit Breaker**: Reliability pattern with health checks (30s interval)
- **Automatic Recovery**: Health monitoring with restart on failure
- **Configuration**: Language-specific server configurations
- **Graceful Shutdown**: Clean shutdown with pending request handling

### Data Flow

```
Agent Request
    ↓
MCP Tool (lsp_*)
    ↓
LspServerManager
    ↓
LspProtocolAdapter (JSON-RPC)
    ↓
Language Server Process
    ↓
LspProtocolAdapter (Response)
    ↓
Position Conversion (0-indexed → 1-indexed)
    ↓
MCP Tool Result
    ↓
Agent Response
```

## Available LSP Tools

### 1. lsp_goto_definition
Navigate to symbol definitions.

**Parameters:**
- `file` (string): Absolute file path
- `line` (number): Line number (1-indexed)
- `character` (number): Character position (1-indexed)
- `projectRoot` (string, optional): Project root directory

**Returns:**
Array of locations with file, line, character, optional endLine/endCharacter (all 1-indexed)

**Example:**
```typescript
{
  tool: 'lsp_goto_definition',
  parameters: {
    file: '/project/src/utils.ts',
    line: 10,
    character: 15,
    projectRoot: '/project'
  }
}
```

### 2. lsp_find_references
Find all references to a symbol.

**Parameters:**
- `file` (string): Absolute file path
- `line` (number): Line number (1-indexed)
- `character` (number): Character position (1-indexed)
- `includeDeclaration` (boolean, optional): Include symbol declaration (default: true)
- `projectRoot` (string, optional): Project root directory

**Returns:**
Array of reference locations (1-indexed)

### 3. lsp_diagnostics
Get real-time diagnostics (errors, warnings, hints).

**Parameters:**
- `file` (string): Absolute file path
- `projectRoot` (string, optional): Project root directory

**Returns:**
Array of diagnostics with severity, message, range, code, source

**Example Response:**
```json
{
  "diagnostics": [
    {
      "severity": 1,
      "message": "Cannot find name 'foo'",
      "range": {
        "start": { "line": 1, "character": 1 },
        "end": { "line": 1, "character": 4 }
      },
      "code": 2304,
      "source": "typescript"
    }
  ]
}
```

### 4. lsp_hover
Get hover information (types, documentation).

**Parameters:**
- `file` (string): Absolute file path
- `line` (number): Line number (1-indexed)
- `character` (number): Character position (1-indexed)
- `projectRoot` (string, optional): Project root directory

**Returns:**
Object with hover contents (markdown string or array) and optional range

### 5. lsp_document_symbols
Get document symbol outline.

**Parameters:**
- `file` (string): Absolute file path
- `projectRoot` (string, optional): Project root directory

**Returns:**
Hierarchical array of symbols with name, kind, range, children

**Symbol Kinds:**
- File, Module, Namespace, Package
- Class, Interface, Struct
- Method, Function, Constructor
- Property, Field, Variable, Constant
- Enum, EnumMember
- TypeParameter, Event, Operator

### 6. lsp_workspace_symbols
Search for symbols across the workspace.

**Parameters:**
- `query` (string): Symbol search query (supports fuzzy matching)
- `projectRoot` (string, optional): Project root directory

**Returns:**
Array of symbol locations across all files in workspace

### 7. lsp_completions
Get context-aware code completions.

**Parameters:**
- `file` (string): Absolute file path
- `line` (number): Line number (1-indexed)
- `character` (number): Character position (1-indexed)
- `projectRoot` (string, optional): Project root directory

**Returns:**
Array of completion items with label, kind, detail, documentation, insertText

### 8. lsp_rename
Preview safe project-wide symbol renaming.

**Parameters:**
- `file` (string): Absolute file path
- `line` (number): Line number (1-indexed)
- `character` (number): Character position (1-indexed)
- `newName` (string): New symbol name
- `projectRoot` (string, optional): Project root directory

**Returns:**
Object describing changes across files (preview mode, does not apply changes)

## Configuration

### Feature Flag

Enable LSP integration via environment variable:

```bash
# Enable LSP features
LSP_ENABLED=true

# Default language server configurations are included
# TypeScript server path auto-detection supported
```

### Language Server Configuration

Language servers are automatically configured for supported languages:

- **TypeScript/JavaScript**: Searches for `typescript-language-server` in PATH
- **Python**: Uses `pyright` or `pylsp`
- **Go**: Uses `gopls`
- **Rust**: Uses `rust-analyzer`

Custom language servers can be added by extending `LspServerManager`.

## Usage Examples

### Example 1: Navigate to Definition

```typescript
// Agent navigates to the definition of a function
const result = await agent.executeTool({
  tool: 'lsp_goto_definition',
  parameters: {
    file: '/project/src/api/routes.ts',
    line: 45,
    character: 20,
    projectRoot: '/project'
  }
});

// Result: [{ file: '/project/src/api/handlers.ts', line: 10, character: 15 }]
```

### Example 2: Get Diagnostics for a File

```typescript
// Agent checks for errors in a file
const result = await agent.executeTool({
  tool: 'lsp_diagnostics',
  parameters: {
    file: '/project/src/utils/helper.ts',
    projectRoot: '/project'
  }
});

// Result shows all errors, warnings, and hints
```

### Example 3: Find All References

```typescript
// Agent finds all usages of a variable
const result = await agent.executeTool({
  tool: 'lsp_find_references',
  parameters: {
    file: '/project/src/config.ts',
    line: 5,
    character: 10,
    includeDeclaration: true,
    projectRoot: '/project'
  }
});

// Result: Array of all locations where the symbol is used
```

### Example 4: Workspace Symbol Search

```typescript
// Agent searches for a function across the workspace
const result = await agent.executeTool({
  tool: 'lsp_workspace_symbols',
  parameters: {
    query: 'processData',
    projectRoot: '/project'
  }
});

// Result: All symbols matching 'processData' across the workspace
```

## Integration with MXF

### Server Initialization

LSP services are automatically initialized when the server starts if `LSP_ENABLED=true`:

```typescript
// In server initialization
if (FeatureFlags.LSP_ENABLED) {
  const lspServerManager = LspServerManager.getInstance();
  const lspDocumentManager = LspDocumentManager.getInstance(lspServerManager);

  // Register LSP tools with MCP registry
  await McpToolRegistry.getInstance().registerLspTools();
}
```

### Agent Access

Agents automatically have access to LSP tools if enabled:

```typescript
// Agents can discover LSP tools
const tools = await agent.discoverTools();
// Returns: [..., 'lsp_goto_definition', 'lsp_find_references', ...]

// Execute LSP tool
const result = await agent.executeTool({
  tool: 'lsp_goto_definition',
  parameters: { /* ... */ }
});
```

### ORPAR Integration

LSP tools can be used within ORPAR cycles:

**Observation Phase:**
- Use `lsp_diagnostics` to identify code issues

**Reasoning Phase:**
- Use `lsp_find_references` to understand symbol usage
- Use `lsp_hover` to get type information

**Planning Phase:**
- Use `lsp_document_symbols` to understand code structure
- Use `lsp_workspace_symbols` to plan refactoring

**Action Phase:**
- Use `lsp_rename` to preview rename operations
- Use `lsp_completions` to assist code generation

**Reflection Phase:**
- Use `lsp_diagnostics` to verify changes didn't introduce errors

## Performance Considerations

### Caching
- Document content is cached to avoid redundant synchronization
- Language server connections are pooled per project root
- Idle documents are automatically cleaned up after 5 minutes

### Timeouts
- Request timeout: 30 seconds (configurable)
- Health check interval: 30 seconds
- Idle document timeout: 5 minutes

### Resource Usage
- Language servers run as separate processes
- Memory usage depends on project size and language server
- Typical TypeScript server: 50-200 MB per project
- Graceful degradation if language server unavailable

## Error Handling

### Circuit Breaker
The LSP server manager includes a circuit breaker pattern:
- **Closed**: Normal operation
- **Open**: Server failures exceed threshold, requests fail fast
- **Half-Open**: Gradual recovery testing

### Error Recovery
- Automatic server restart on crashes
- Health monitoring with periodic checks
- Failed requests return descriptive error messages
- Document state preserved across server restarts

## Limitations

### Current Limitations
- Renaming is preview-only (does not apply changes)
- Single language server per project root
- Limited to stdio-based language servers
- No support for LSP workspace/workspaceFolders (single root)

### Future Enhancements (Planned)
- Multi-root workspace support
- Code actions and quick fixes
- Formatting and code style operations
- Language server plugin system
- WebSocket-based language servers
- Distributed language server clusters

## Troubleshooting

### Language Server Not Found

**Problem:** Tool returns "Language server not found" error

**Solutions:**
1. Install language server globally:
   ```bash
   npm install -g typescript-language-server
   ```
2. Ensure language server is in PATH
3. Check `LspServerManager` configuration for correct server command

### Document Not Synchronized

**Problem:** Diagnostics or completions are stale

**Solution:** LSP automatically opens and synchronizes documents. If issues persist:
- Check document manager logs
- Verify file path is absolute
- Ensure project root is correct

### Server Crashes

**Problem:** Language server process crashes

**Solution:**
- Check language server logs (if available)
- Verify project has valid configuration (tsconfig.json, etc.)
- Circuit breaker will attempt automatic recovery
- Check server health via `LspServerManager.getHealth()`

## API Reference

### LspProtocolAdapter

```typescript
class LspProtocolAdapter {
  // Send JSON-RPC request
  async sendRequest(method: string, params: unknown): Promise<unknown>

  // Send JSON-RPC notification
  sendNotification(method: string, params: unknown): void

  // Handle incoming message
  handleMessage(message: string): void

  // Position conversion utilities
  static toLspPosition(line: number, character: number): LspPosition
  static fromLspPosition(pos: LspPosition): { line: number; character: number }
  static toLspUri(filePath: string): string
  static fromLspUri(uri: string): string
}
```

### LspDocumentManager

```typescript
class LspDocumentManager {
  // Document lifecycle
  async openDocument(filePath: string): Promise<void>
  async updateDocument(filePath: string, content: string): Promise<void>
  async closeDocument(filePath: string): Promise<void>

  // Document state
  getDocumentVersion(filePath: string): number
  isDocumentOpen(filePath: string): boolean

  // Cleanup
  cleanupIdleDocuments(): void
}
```

### LspServerManager

```typescript
class LspServerManager {
  // Server lifecycle
  async getOrCreateConnection(projectRoot: string, languageId: string): Promise<ILspConnection>
  async stopServer(projectRoot: string): Promise<void>
  async stopAllServers(): Promise<void>

  // Health monitoring
  getHealth(projectRoot: string): ServerHealth
  async checkHealth(): Promise<void>
}
```

## Related Documentation

- **[MCP Integration](../api/mcp.md)** - MCP tool system
- **[Tool Reference](tool-reference.md)** - Complete tool catalog
- **[ORPAR Loop](orpar.md)** - Control loop integration
- **[Code Execution](code-execution.md)** - Safe code execution

## References

- [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/)
- [TypeScript Language Server](https://github.com/typescript-language-server/typescript-language-server)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)

---

For questions or contributions related to LSP integration, please refer to the [GitHub repository](https://github.com/BradA1878/model-exchange-framework).
