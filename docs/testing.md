# MXF Testing Architecture

MXF uses a comprehensive three-tier testing strategy to ensure code quality and reliability.

## Overview

| Tier | Purpose | Speed | Server Required | Tools |
|------|---------|-------|-----------------|-------|
| **Unit** | Fast, isolated function tests | ~2s | No | Jest |
| **Property** | Invariant-based random testing | ~2s | No | Jest + fast-check |
| **Integration (SDK)** | Socket.IO end-to-end tests | ~60s | Yes | Jest + TestSDK |
| **Integration (API)** | REST API endpoint tests | ~25s | Yes | Jest + TestAPI |
| **Mutation** | Test quality verification | ~5m | No | Stryker |

### Test Files

| Category | Files |
|----------|-------|
| Unit Tests | 21 |
| Property Tests | 7 |
| Integration Tests (Socket.IO) | 20 |
| Integration Tests (API) | 6 |
| **Total Files** | **54** |

### Test Coverage Categories

| Category | Description |
|----------|-------------|
| **Agent** | Agent lifecycle, connection, reconnection |
| **Channel** | Broadcast, messaging, discovery |
| **Tool** | Execute, validate, authorize, dynamic updates |
| **Prompt** | Config, tool-aware, dynamic, MCP prompts, compaction |
| **Task** | Create, monitor, complete |
| **ORPAR** | All phases + full cycle |
| **Memory** | Agent, channel, relationship, nested learning |
| **Meilisearch** | Conversations, actions, patterns |
| **External MCP** | Registry, discovery, validation |
| **Inference** | Dynamic parameters, model selection |
| **Code Execution** | Docker sandbox, Bun runtime |
| **Database** | Adapter factory, MongoDB operations |
| **LSP** | Language server protocol bridge |
| **P2P** | Task negotiation, federation |
| **TOON** | Token optimization encoding |
| **Workflow** | Sequential, parallel, loop patterns |

## Quick Start

```bash
# Run fast tests (no server needed)
bun run test:unit

# Run full integration tests (server must be running)
bun run test:integration:manual

# Check test quality with mutation testing
bun run test:mutation
```

## Test Structure

```
tests/
├── unit/                    # Fast, isolated unit tests
│   ├── schemas/
│   │   └── MessageSchemas.unit.test.ts
│   ├── controllers/         # Controller unit tests
│   │   └── agentController.unit.test.ts
│   └── utils/
│       └── validation.unit.test.ts
│
├── property/                # Property-based tests
│   ├── messages.property.test.ts
│   ├── validation.property.test.ts
│   └── api/                 # API property tests
│       └── agents.property.test.ts
│
├── integration/             # End-to-end tests
│   ├── agent/               # Socket.IO agent tests
│   ├── channel/             # Socket.IO channel tests
│   ├── tool/
│   ├── prompt/
│   ├── task/
│   ├── orpar/
│   ├── memory/
│   ├── meilisearch/
│   ├── external-mcp/
│   └── api/                 # REST API endpoint tests
│       ├── agents.api.test.ts
│       ├── channels.api.test.ts
│       ├── tasks.api.test.ts
│       ├── users.api.test.ts
│       ├── mcp.api.test.ts
│       └── dashboard.api.test.ts
│
├── setup/                   # Test infrastructure
├── utils/                   # Test helpers (TestSDK, TestAPI, etc.)
├── jest.config.ts           # Integration test config
├── jest.unit.config.ts      # Unit/property test config
└── stryker.config.json      # Mutation testing config
```

## Unit Tests

Unit tests are fast, deterministic tests for pure functions with no external dependencies.

### When to Write Unit Tests

- Pure functions (no side effects)
- Validators and parsers
- Data transformation utilities
- Schema creation functions

### Example

```typescript
// tests/unit/schemas/MessageSchemas.unit.test.ts
import { createMessageMetadata, ContentFormat } from '@mxf/shared/schemas/MessageSchemas';

describe('createMessageMetadata', () => {
    it('generates unique message IDs', () => {
        const ids = Array.from({ length: 100 }, () => createMessageMetadata().messageId);
        expect(new Set(ids).size).toBe(100);
    });

    it('allows custom overrides', () => {
        const meta = createMessageMetadata({ priority: 10 });
        expect(meta.priority).toBe(10);
    });
});
```

### Running Unit Tests

```bash
bun run test:unit                    # Run all unit tests
bun run test:unit:watch              # Watch mode
bun run test:unit:coverage           # With coverage report
```

### Controller Unit Tests

Controller unit tests verify API controller logic in isolation by mocking dependencies.

```typescript
// tests/unit/controllers/agentController.unit.test.ts
import * as agentController from '@mxf/server/api/controllers/agentController';

jest.mock('@mxf/shared/models/agent');

describe('agentController.getAllAgents', () => {
    it('returns agents with success response', async () => {
        const mockAgents = [{ agentId: 'test-1' }];
        mockAgentModel.find.mockResolvedValue(mockAgents);

        await agentController.getAllAgents(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            success: true,
            data: mockAgents,
            count: 1
        });
    });
});
```

Controller tests cover:
- Success responses
- Error handling (400, 404, 500)
- Validation requirements
- Database interactions (mocked)
- Event bus emissions

## Property-Based Tests

Property-based tests use [fast-check](https://fast-check.dev/) to verify that invariants hold for randomly generated inputs.

### When to Write Property Tests

- Functions that should be idempotent
- Encode/decode round-trips
- Type validation (exactly one type should match)
- Uniqueness guarantees
- Mathematical properties (commutativity, associativity)

### Example

```typescript
// tests/property/messages.property.test.ts
import fc from 'fast-check';
import { determineContentFormat, ContentFormat } from '@mxf/shared/schemas/MessageSchemas';

describe('determineContentFormat', () => {
    it('is idempotent', () => {
        fc.assert(
            fc.property(fc.anything(), (content) => {
                const first = determineContentFormat(content);
                const second = determineContentFormat(content);
                return first === second;
            })
        );
    });

    it('objects always return JSON', () => {
        fc.assert(
            fc.property(fc.object(), (content) => {
                return determineContentFormat(content) === ContentFormat.JSON;
            })
        );
    });
});
```

### Common fast-check Patterns

```typescript
// Generate any string
fc.string()

// Non-empty strings
fc.string({ minLength: 1 })

// Bounded numbers
fc.integer({ min: 0, max: 100 })

// One of multiple types
fc.oneof(fc.string(), fc.integer(), fc.constant(null))

// Random objects
fc.object({ maxDepth: 3 })

// Binary data
fc.uint8Array({ maxLength: 1000 })
```

### Running Property Tests

```bash
bun run test:property                # Property tests only
bun run test:unit                    # Includes property tests
```

## Integration Tests

Integration tests verify end-to-end behavior with live services (MongoDB, MXF server, etc.).

### Prerequisites

The MXF server must be running:

```bash
bun run dev                          # Start server with infrastructure
# or
bun run test:integration             # Auto-starts server (slower)
```

### Example

```typescript
// tests/integration/agent/agent-connection.test.ts
import { TestSDK } from '@tests/utils/TestSDK';

describe('Agent Connection', () => {
    let sdk: TestSDK;

    beforeAll(async () => {
        sdk = new TestSDK();
        await sdk.connect();
    });

    afterAll(async () => {
        await sdk.disconnect();
    });

    it('connects and receives agent ID', async () => {
        expect(sdk.agentId).toBeDefined();
        expect(typeof sdk.agentId).toBe('string');
    });
});
```

### Running Integration Tests

```bash
bun run test:integration:manual      # Requires running server
bun run test:integration             # Auto-starts server
bun run test:ci                      # CI mode with auto-start
```

### Test Suites (Socket.IO Based)

| Suite | File | Coverage |
|-------|------|----------|
| Agent Connection | `agent-connection.integration.test.ts` | Connect, disconnect, reconnect |
| Channel Communication | `channel-communication.integration.test.ts` | Broadcast, messaging, discovery |
| Tool Execution | `tool-execution.integration.test.ts` | Execute, validate, authorize |
| Dynamic Tool Updates | `dynamic-tool-updates.integration.test.ts` | Runtime tool registration |
| Prompt System | `prompt-system.integration.test.ts` | Config, tool-aware, dynamic |
| MCP Prompts | `mcp-prompts.integration.test.ts` | Template discovery, argument resolution |
| Prompt Compaction | `prompt-compaction.integration.test.ts` | Token optimization, residuals |
| Task System | `task-system.integration.test.ts` | Create, monitor, complete |
| ORPAR Lifecycle | `orpar-lifecycle.integration.test.ts` | All phases + full cycle |
| Memory Operations | `memory-operations.integration.test.ts` | Agent, channel, relationship |
| Nested Learning | `nested-learning.integration.test.ts` | SERC, verification, repair |
| Meilisearch Search | `meilisearch-search.integration.test.ts` | Conversations, actions, patterns |
| External MCP Server | `external-mcp-server.integration.test.ts` | Registry, discovery, validation |
| Inference Parameters | `inference-parameters.integration.test.ts` | Dynamic model selection |
| Code Execution | `code-execution.integration.test.ts` | Docker sandbox, Bun runtime |
| Database Abstraction | `database-abstraction.integration.test.ts` | MongoDB adapter, repositories |
| LSP Bridge | `lsp-bridge.integration.test.ts` | Language server protocol |
| P2P Foundation | `p2p-foundation.integration.test.ts` | Task negotiation, federation |
| TOON Optimization | `toon-optimization.integration.test.ts` | Token encoding |
| Workflow System | `workflow-system.integration.test.ts` | Sequential, parallel, loop |

## API Integration Tests

API integration tests verify REST API endpoint behavior using HTTP requests. These tests use the `TestAPI` utility class.

### Test Utilities

MXF provides two test utilities:

| Utility | Purpose | Location |
|---------|---------|----------|
| `TestSDK` | Socket.IO based integration tests | `tests/utils/TestSDK.ts` |
| `TestAPI` | HTTP/REST API endpoint tests | `tests/utils/TestAPI.ts` |

### TestAPI Usage

```typescript
import { createTestAPI, TestAPI, API_FIXTURES } from '@tests/utils/TestAPI';

describe('API Tests', () => {
    let api: TestAPI;

    beforeAll(async () => {
        api = createTestAPI();

        // Authenticate as user
        await api.authenticateAsUser(
            API_FIXTURES.testUser.email,
            API_FIXTURES.testUser.password
        );
    });

    it('should fetch agents', async () => {
        const response = await api.get('/api/agents');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('data');
    });

    it('should create agent', async () => {
        const response = await api.post('/api/agents', {
            agentId: 'test-agent',
            name: 'Test Agent'
        });

        expect(response.status).toBe(201);
    });
});
```

### API Test Suites

| Suite | Tests | Endpoints Covered |
|-------|-------|-------------------|
| agents.api.test.ts | 28 | Agent CRUD, memory, context, service filtering |
| channels.api.test.ts | 22 | Channel CRUD, context, metadata, messages |
| tasks.api.test.ts | 18 | Task CRUD, assignment, workload analysis |
| users.api.test.ts | 22 | Registration, login, profile, magic links |
| mcp.api.test.ts | 20 | Tool discovery, execution, registration |
| dashboard.api.test.ts | 13 | Stats, activity, overview |

**Total: 123 API endpoint tests**

### Running API Tests

```bash
# All API tests (requires server running)
bun run test:integration:manual -- --testPathPattern=".api.test"

# Specific API test suite
bun run test:integration:manual -- --testPathPattern=agents.api
bun run test:integration:manual -- --testPathPattern=channels.api
bun run test:integration:manual -- --testPathPattern=tasks.api
```

### Authentication Patterns

The TestAPI supports both JWT and API key authentication:

```typescript
// User authentication (JWT)
await api.authenticateAsUser('email@example.com', 'password');

// Agent authentication (API keys)
api.authenticateAsAgent('keyId', 'secretKey');

// Clear authentication
api.clearAuth();

// Check authentication status
api.isAuthenticated();
```

### Response Format

Most MXF API endpoints return responses in this format:

```typescript
// Success response
{
    success: true,
    data: { ... },       // or 'agents', 'channels', etc.
    count?: number,
    message?: string
}

// Error response
{
    success: false,
    error: "Error message",
    message?: "Details"
}
```

Note: Some endpoints (like dashboard) return data directly without wrapping.

## Mutation Testing

Mutation testing verifies the quality of your tests by introducing small changes (mutations) to the code and checking if tests catch them.

### How It Works

1. Stryker modifies your source code (e.g., `===` becomes `!==`)
2. Runs your tests against the mutated code
3. Reports which mutations survived (weren't caught by tests)

### Configuration

See `stryker.config.json` for configuration. Key settings:

```json
{
  "mutate": [
    "src/shared/schemas/**/*.ts",
    "src/shared/utils/validation.ts"
  ],
  "testRunner": "jest",
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  }
}
```

### Running Mutation Tests

```bash
bun run test:mutation                # Full run (~5 minutes)
bun run test:mutation:incremental    # Faster after first run
```

### Interpreting Results

- **Killed**: Test caught the mutation (good)
- **Survived**: Test didn't catch the mutation (weakness)
- **No Coverage**: No test covers this code
- **Timeout**: Mutation caused infinite loop

A mutation score of 80%+ indicates strong tests.

## Best Practices

### 1. Test Naming

Use descriptive names that explain the behavior:

```typescript
// Good
it('throws when channelId is empty')
it('accepts valid v1-v5 UUIDs')
it('preserves round-trip integrity for base64')

// Bad
it('test1')
it('works')
it('should work correctly')
```

### 2. Test Independence

Each test should be independent and not rely on other tests:

```typescript
// Good - each test sets up its own state
it('handles empty array', () => {
    const result = process([]);
    expect(result).toEqual([]);
});

// Bad - relies on previous test's state
it('handles more items', () => {
    items.push('another');  // Where did 'items' come from?
    expect(process(items)).toHaveLength(2);
});
```

### 3. Edge Cases

Always test edge cases:

- Empty inputs (`''`, `[]`, `{}`)
- Null and undefined
- Boundary values (0, -1, MAX_INT)
- Unicode and special characters
- Very long inputs

### 4. Error Conditions

Test that errors are thrown/handled correctly:

```typescript
it('throws for invalid input', () => {
    expect(() => validate(null)).toThrow();
    expect(() => validate('')).toThrow(/non-empty/);
});
```

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: bun run test:unit          # Fast tests first
      - run: bun run test:ci             # Integration with auto-start
```

### Pre-commit Hook

Add to `.husky/pre-commit`:

```bash
bun run test:unit
```

## Troubleshooting

### Tests Timeout

Increase Jest timeout:

```typescript
jest.setTimeout(30000);  // 30 seconds
```

### Integration Tests Fail to Connect

1. Ensure server is running: `curl http://localhost:3001/health`
2. Check MongoDB is running: `docker ps | grep mongo`
3. Check environment variables in `.env`

### Property Tests Fail Randomly

fast-check uses random seeds. To reproduce a failure:

```typescript
fc.assert(
    fc.property(...),
    { seed: 12345, path: "0:1:2" }  // From failure output
);
```
