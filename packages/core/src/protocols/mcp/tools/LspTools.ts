/**
 * LSP MCP Tools
 *
 * MCP tools for Language Server Protocol operations.
 * Provides code intelligence capabilities to agents.
 *
 * Feature flag: LSP_ENABLED
 */

/**
 * LSP tool definitions
 *
 * These tools expose language server capabilities as MCP tools.
 * All tools are disabled by default and require LSP_ENABLED=true.
 */
export const lspTools = [
  {
    name: 'lsp_goto_definition',
    description: 'Navigate to the definition of a symbol at a specific location in a source file. Returns precise file path and position.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        line: {
          type: 'number',
          description: 'Line number (1-indexed)',
        },
        character: {
          type: 'number',
          description: 'Character position in the line (1-indexed)',
        },
      },
      required: ['file', 'line', 'character'],
    },
    examples: [
      {
        input: {
          file: '/project/src/services/UserService.ts',
          line: 42,
          character: 15,
        },
        output: {
          success: true,
          locations: [
            {
              file: '/project/src/models/User.ts',
              line: 10,
              character: 14,
              endLine: 10,
              endCharacter: 25,
            },
          ],
        },
        description: 'Find the definition of the symbol at line 42, character 15',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 30000,
      tags: ['code-navigation', 'semantic-analysis', 'definition'],
    },
  },

  {
    name: 'lsp_find_references',
    description: 'Find all references to a symbol across the entire project. Useful for impact analysis and refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        line: {
          type: 'number',
          description: 'Line number (1-indexed)',
        },
        character: {
          type: 'number',
          description: 'Character position in the line (1-indexed)',
        },
        includeDeclaration: {
          type: 'boolean',
          description: 'Include the declaration in results (default: true)',
          default: true,
        },
      },
      required: ['file', 'line', 'character'],
    },
    examples: [
      {
        input: {
          file: '/project/src/utils/helpers.ts',
          line: 10,
          character: 20,
          includeDeclaration: true,
        },
        output: {
          success: true,
          references: [
            {
              file: '/project/src/utils/helpers.ts',
              line: 10,
              character: 20,
            },
            {
              file: '/project/src/services/UserService.ts',
              line: 5,
              character: 30,
            },
          ],
          totalCount: 2,
        },
        description: 'Find all usages of the function defined at line 10',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 60000,
      tags: ['code-navigation', 'refactoring', 'impact-analysis', 'references'],
    },
  },

  {
    name: 'lsp_diagnostics',
    description: 'Get real-time errors, warnings, and hints for a file. Provides type checking and linting results without running a build.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        severity: {
          type: 'string',
          enum: ['error', 'warning', 'information', 'hint', 'all'],
          description: 'Filter by severity level (default: all)',
          default: 'all',
        },
      },
      required: ['file'],
    },
    examples: [
      {
        input: {
          file: '/project/src/components/Button.tsx',
          severity: 'error',
        },
        output: {
          success: true,
          diagnostics: [
            {
              file: '/project/src/components/Button.tsx',
              line: 15,
              character: 10,
              endLine: 15,
              endCharacter: 20,
              severity: 'error',
              message: 'Property "onClick" is missing in type',
              code: 2339,
              source: 'typescript',
            },
          ],
          counts: {
            errors: 1,
            warnings: 0,
            information: 0,
            hints: 0,
          },
        },
        description: 'Get only errors for the Button component',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 10000,
      tags: ['validation', 'type-checking', 'linting', 'diagnostics'],
    },
  },

  {
    name: 'lsp_hover',
    description: 'Get type information and documentation for a symbol. Shows the same information as hovering in an IDE.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        line: {
          type: 'number',
          description: 'Line number (1-indexed)',
        },
        character: {
          type: 'number',
          description: 'Character position in the line (1-indexed)',
        },
      },
      required: ['file', 'line', 'character'],
    },
    examples: [
      {
        input: {
          file: '/project/src/types.ts',
          line: 15,
          character: 8,
        },
        output: {
          success: true,
          contents: '```typescript\ninterface User {\n  id: string;\n  name: string;\n}\n```\nUser interface representing a system user',
          range: {
            start: { line: 15, character: 8 },
            end: { line: 15, character: 12 },
          },
        },
        description: 'Get type information for the symbol at line 15',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 5000,
      tags: ['documentation', 'type-information', 'hover'],
    },
  },

  {
    name: 'lsp_document_symbols',
    description: 'Get the symbol outline for a file (functions, classes, variables). Provides a structural overview of the file.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
      },
      required: ['file'],
    },
    examples: [
      {
        input: {
          file: '/project/src/controllers/AuthController.ts',
        },
        output: {
          success: true,
          symbols: [
            {
              name: 'AuthController',
              kind: 'class',
              location: {
                file: '/project/src/controllers/AuthController.ts',
                line: 10,
                character: 14,
              },
              children: [
                {
                  name: 'login',
                  kind: 'method',
                  location: {
                    file: '/project/src/controllers/AuthController.ts',
                    line: 15,
                    character: 10,
                  },
                },
              ],
            },
          ],
        },
        description: 'Get all symbols defined in AuthController',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 10000,
      tags: ['code-navigation', 'documentation', 'symbols', 'outline'],
    },
  },

  {
    name: 'lsp_workspace_symbols',
    description: 'Search for symbols across the entire workspace. Supports fuzzy matching for quick symbol lookup.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name query (supports fuzzy matching)',
        },
        projectRoot: {
          type: 'string',
          description: 'Project root directory (defaults to current workspace)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 100)',
          default: 100,
        },
      },
      required: ['query'],
    },
    examples: [
      {
        input: {
          query: 'UserService',
          limit: 50,
        },
        output: {
          success: true,
          symbols: [
            {
              name: 'UserService',
              kind: 'class',
              location: {
                file: '/project/src/services/UserService.ts',
                line: 10,
                character: 14,
              },
              containerName: undefined,
            },
          ],
          totalCount: 1,
        },
        description: 'Find all symbols matching "UserService"',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 30000,
      tags: ['code-navigation', 'search', 'symbols', 'workspace'],
    },
  },

  {
    name: 'lsp_completions',
    description: 'Get context-aware code completions at a specific position. Returns available symbols, methods, and properties.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        line: {
          type: 'number',
          description: 'Line number (1-indexed)',
        },
        character: {
          type: 'number',
          description: 'Character position in the line (1-indexed)',
        },
        triggerCharacter: {
          type: 'string',
          description: 'Character that triggered completion (e.g., ".", ":")',
          maxLength: 1,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of completions to return (default: 50)',
          default: 50,
        },
      },
      required: ['file', 'line', 'character'],
    },
    examples: [
      {
        input: {
          file: '/project/src/index.ts',
          line: 25,
          character: 10,
          triggerCharacter: '.',
          limit: 20,
        },
        output: {
          success: true,
          items: [
            {
              label: 'toString',
              kind: 'method',
              detail: '(): string',
              insertText: 'toString()',
              insertTextFormat: 'plaintext',
            },
          ],
          isIncomplete: false,
        },
        description: 'Get completions after typing a dot',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 5000,
      tags: ['code-generation', 'autocomplete', 'completions'],
    },
  },

  {
    name: 'lsp_rename',
    description: 'Compute all edits required to rename a symbol across the project. Returns preview by default, does not apply changes.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Absolute path to the source file',
        },
        line: {
          type: 'number',
          description: 'Line number (1-indexed)',
        },
        character: {
          type: 'number',
          description: 'Character position in the line (1-indexed)',
        },
        newName: {
          type: 'string',
          description: 'New name for the symbol',
        },
        preview: {
          type: 'boolean',
          description: 'Only preview changes, do not apply (default: true)',
          default: true,
        },
      },
      required: ['file', 'line', 'character', 'newName'],
    },
    examples: [
      {
        input: {
          file: '/project/src/services/api.ts',
          line: 5,
          character: 15,
          newName: 'fetchUserData',
          preview: true,
        },
        output: {
          success: true,
          edits: [
            {
              file: '/project/src/services/api.ts',
              edits: [
                {
                  range: {
                    start: { line: 5, character: 15 },
                    end: { line: 5, character: 23 },
                  },
                  newText: 'fetchUserData',
                },
              ],
            },
          ],
          filesAffected: 3,
          locationsAffected: 12,
          preview: true,
        },
        description: 'Preview renaming a function to fetchUserData',
      },
    ],
    metadata: {
      category: 'lsp',
      requiresFeature: 'lsp',
      timeout: 60000,
      tags: ['refactoring', 'code-modification', 'rename'],
    },
  },
];
