# 🔍 Meilisearch Integration - Complete Setup Guide

## Overview

This document provides a complete guide for the Meilisearch semantic search integration in MXF. This integration transforms MXF from an in-memory conversation system to a persistent, semantically-searchable knowledge graph.

## 🎯 What Was Added

### 1. **Infrastructure** (Docker)

```
✅ docker-compose.yml         - Full stack orchestration
✅ Dockerfile                  - MXF server containerization
✅ dashboard/Dockerfile        - Dashboard containerization
✅ dashboard/nginx.conf        - nginx config
✅ .dockerignore               - Optimized Docker builds
✅ .env.example                - Environment template
```

**Services deployed:**
- **MXF Server** (Node.js) - Port 3001
- **MongoDB** - Port 27017
- **Meilisearch** - Port 7700
- **Redis** (caching) - Port 6379
- **Dashboard** (Vue.js) - Port 5173

### 2. **Meilisearch Service** (Server-side)

```
✅ src/shared/services/MxfMeilisearchService.ts
```

**Capabilities:**
- 4 indexes: conversations, actions, patterns, observations
- Hybrid search (keyword + semantic)
- OpenAI embedding generation
- Automatic index configuration
- Batch indexing (100 docs/batch)
- Health monitoring and stats

**Key Features:**
- **Semantic search**: Vector embeddings via `text-embedding-3-small`
- **Hybrid mode**: Configurable semantic/keyword ratio (default: 0.7)
- **Filtering**: By agentId, channelId, timestamp, etc.
- **Fast Search**: Optimized for real-time agent queries

### 3. **Memory Search Tools** (MCP Tools)

```
✅ src/shared/protocols/mcp/tools/MemorySearchTools.ts
```

**Three new tools:**

#### `memory_search_conversations`
Search entire conversation history semantically:
```typescript
{
  query: "authentication implementation discussion",
  channelId: "dev-channel",  // optional
  limit: 5,
  hybridRatio: 0.7
}
```

#### `memory_search_actions`
Search tool usage history:
```typescript
{
  query: "send message to AgentB",
  toolName: "messaging_send",  // optional
  successOnly: true,
  limit: 10
}
```

#### `memory_search_patterns`
Discover cross-channel patterns:
```typescript
{
  intent: "multi-agent coordination workflow",
  minEffectiveness: 0.8,
  crossChannel: true,
  limit: 5
}
```

### 4. **Documentation**

```
✅ docs/deployment.md               - Complete deployment guide
✅ docs/meilisearch-integration.md  - This file
✅ scripts/quick-start.sh           - One-command deployment
```

### 5. **Package Updates**

```
✅ meilisearch npm package installed
✅ New Docker scripts in package.json:
   - bun run docker:up
   - bun run docker:down
   - bun run docker:logs
   - bun run docker:rebuild
   - bun run docker:health
```

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Generate secure keys
openssl rand -base64 32  # Use for MEILISEARCH_MASTER_KEY
openssl rand -base64 64  # Use for JWT_SECRET
openssl rand -base64 32  # Use for AGENT_API_KEY

# Edit .env and set:
# - MEILISEARCH_MASTER_KEY
# - JWT_SECRET
# - AGENT_API_KEY
# - MONGODB_PASSWORD
# - REDIS_PASSWORD
# - OPENAI_API_KEY (for embeddings)
```

### Step 2: Deploy Stack

```bash
# Option A: Use quick-start script
./scripts/quick-start.sh

# Option B: Manual deployment
bun run docker:up

# View logs
bun run docker:logs
```

### Step 3: Verify Installation

```bash
# Check all services are healthy
bun run docker:health

# Test MXF Server
curl http://localhost:3001/health

# Test Meilisearch
curl http://localhost:7700/health

# View Meilisearch stats
bun run docker:meilisearch:stats
```

### Step 4: Test Semantic Search

Create a test agent and index some data:

```typescript
import { MxfSDK } from '@mxf/sdk';

// Initialize SDK with Personal Access Token (recommended)
const sdk = new MxfSDK({
  serverUrl: 'http://localhost:3001',
  domainKey: process.env.MXF_DOMAIN_KEY!,
  accessToken: process.env.MXF_DEMO_ACCESS_TOKEN!
});
await sdk.connect();

// Create agent through SDK
const agent = await sdk.createAgent({
  agentId: 'TestAgent',
  channelId: 'dev-channel',
  keyId: process.env.AGENT_KEY_ID!,
  secretKey: process.env.AGENT_SECRET_KEY!,
  llmProvider: 'openrouter',
  defaultModel: 'anthropic/claude-3.5-sonnet',
  apiKey: process.env.OPENROUTER_API_KEY!
});
await agent.connect();

// Send some messages to index
await agent.sendMessage('Hello, testing authentication discussion', 'dev-channel');
await agent.sendMessage('We should use JWT tokens for auth', 'dev-channel');

// Wait for indexing (usually <1 second)
await new Promise(resolve => setTimeout(resolve, 2000));

// Search semantically
const results = await agent.executeTool('memory_search_conversations', {
  query: 'authentication approach',
  limit: 5
});

console.log('Search results:', results);
```

---

## 📊 Architecture Integration

### How It Works

```
┌─────────────────────────────────────────────────────────┐
│                   Agent Conversation                     │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  MxfMemoryManager    │
         │  (addConversation)   │
         └──────────┬───────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
        ▼                        ▼
┌───────────────┐       ┌──────────────────┐
│   MongoDB     │       │  Meilisearch     │
│  (Persist)    │       │  (Index+Search)  │
└───────────────┘       └──────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Semantic Search    │
                    │  - Embeddings       │
                    │  - Hybrid Search    │
                    │  - Filters          │
                    └─────────────────────┘
```

### Dual-Write Strategy

Every conversation message:
1. **Saved to MongoDB** for persistence
2. **Indexed in Meilisearch** for semantic search

This ensures:
- ✅ No data loss (MongoDB is source of truth)
- ✅ Fast semantic search (Meilisearch optimized for search)
- ✅ Graceful degradation (if Meilisearch fails, MongoDB continues)

---

## 🔧 Configuration Reference

### Environment Variables

**Required:**
```env
MEILISEARCH_MASTER_KEY=<32+ char key>
MEILISEARCH_HOST=http://localhost:7700
OPENAI_API_KEY=sk-<your-key>
```

**Optional (with defaults):**
```env
ENABLE_MEILISEARCH=true
ENABLE_SEMANTIC_SEARCH=true
MEILISEARCH_HYBRID_RATIO=0.7        # 0.0=keyword, 1.0=semantic
MEILISEARCH_EMBEDDING_MODEL=text-embedding-3-small
MEILISEARCH_EMBEDDING_DIMENSIONS=1536
MEILISEARCH_BATCH_SIZE=100
MEILI_MAX_INDEXING_MEMORY=2GB
MEILI_MAX_INDEXING_THREADS=4
```

### Hybrid Search Ratio Guide

| Ratio | Behavior | Use Case |
|-------|----------|----------|
| 0.0 | Keyword only | Exact term matching, IDs, names |
| 0.3 | Mostly keyword | Technical terms, code snippets |
| 0.7 | Balanced (default) | General conversations |
| 0.9 | Mostly semantic | Conceptual searches |
| 1.0 | Semantic only | "Find similar discussions" |

---

## 📈 Performance Characteristics

### Operations

| Operation | Type | Notes |
|-----------|------|-------|
| **Index write** | Async | Non-blocking indexing |
| **Keyword search** | Fast | Simple filter queries |
| **Semantic search** | Fast | With embeddings cached |
| **Hybrid search** | Fast | Combines both modes |
| **Embedding generation** | External API | Via OpenAI API |

### Resource Usage

Resource requirements will vary based on:
- Number of agents and messages
- Index sizes and retention policies
- Search query complexity and frequency

Meilisearch, MongoDB, and Redis each have their own memory requirements. Monitor your deployment to right-size resources.

---

## 🧪 Testing Guide

### Unit Tests (Recommended)

Create `tests/meilisearch-integration.test.ts`:

```typescript
import { MxfMeilisearchService } from '../src/shared/services/MxfMeilisearchService';

describe('Meilisearch Integration', () => {
  let service: MxfMeilisearchService;

  beforeAll(async () => {
    service = MxfMeilisearchService.getInstance();
    await service.initialize();
  });

  test('should index and search conversations', async () => {
    // Index test message
    await service.indexConversation({
      id: 'test-1',
      role: 'user',
      content: 'Testing authentication with JWT tokens',
      timestamp: Date.now(),
      metadata: { agentId: 'TestAgent', channelId: 'test-channel' }
    });

    // Wait for indexing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Search
    const results = await service.searchConversations({
      query: 'authentication',
      filter: 'channelId = "test-channel"',
      limit: 5
    });

    expect(results.hits.length).toBeGreaterThan(0);
    expect(results.hits[0].content).toContain('authentication');
  });
});
```

Run tests:
```bash
npm test tests/meilisearch-integration.test.ts
```

### Integration Tests

```bash
# 1. Start stack
bun run docker:up

# 2. Run demo with semantic search
NODE_ENV=test ENABLE_MEILISEARCH=true bun run demo:first-contact

# 3. Check logs for indexing activity
bun run docker:logs | grep Meilisearch

# Expected output:
# "Indexed conversation message: msg-123"
# "Meilisearch search completed in 45ms"
```

---

## 🐛 Troubleshooting

### Issue: "Connection refused" to Meilisearch

```bash
# Check if Meilisearch is running
docker ps | grep meilisearch

# Check logs
docker logs mxf-meilisearch

# Verify environment
echo $MEILISEARCH_HOST
echo $MEILISEARCH_MASTER_KEY
```

### Issue: Search returns no results

```bash
# Check index stats
curl -X GET http://localhost:7700/indexes/mxf-conversations/stats \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY"

# Should show:
# {
#   "numberOfDocuments": 42,
#   "isIndexing": false
# }

# If numberOfDocuments is 0, indexing isn't working
# Check MXF server logs:
docker logs mxf-server | grep -i meilisearch
```

### Issue: Embeddings not generating

```bash
# Check OpenAI API key
echo $OPENAI_API_KEY

# Test embedding generation
curl https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "test",
    "model": "text-embedding-3-small"
  }'
```

### Issue: High memory usage

```bash
# Check resource usage
docker stats

# Reduce indexing memory
# In .env:
MEILI_MAX_INDEXING_MEMORY=1GB
MEILI_MAX_INDEXING_THREADS=2

# Restart
bun run docker:restart
```

---

## 🔄 Migration Guide (Existing MXF Installations)

If you have an existing MXF deployment:

### Step 1: Backup Existing Data

```bash
# Backup MongoDB
mongodump --uri="$MONGODB_URI" --out=/backup/mxf-backup

# Backup .env
cp .env .env.backup
```

### Step 2: Update Configuration

```bash
# Merge new .env variables
cat .env.example >> .env
nano .env  # Edit and set new variables
```

### Step 3: Deploy Meilisearch

```bash
# Add only Meilisearch service initially
docker-compose up -d meilisearch redis

# Verify it's healthy
docker ps | grep meilisearch
```

### Step 4: Backfill Historical Data

```typescript
// scripts/backfill-meilisearch.ts
import { MxfMeilisearchService } from '../src/shared/services/MxfMeilisearchService';
import { AgentMemory } from '../src/shared/models/memory';

const service = MxfMeilisearchService.getInstance();
await service.initialize();

// Get all historical messages from MongoDB
const memories = await AgentMemory.find({});

for (const memory of memories) {
  for (const message of memory.conversationHistory) {
    await service.indexConversation(message);
  }
}

console.log(`Backfilled ${count} messages`);
```

### Step 5: Enable Integration

```bash
# In .env:
ENABLE_MEILISEARCH=true
ENABLE_SEMANTIC_SEARCH=true

# Restart MXF server
bun run docker:restart mxf-server
```

---

## 📚 Next Steps

1. **Read the architecture deep-dive** in the main README
2. **Review search tool examples** in `MemorySearchTools.ts:41`
3. **Configure hybrid search ratio** based on your use case
4. **Set up monitoring** for search performance
5. **Implement semantic prompt assembly** (Phase 2 from architecture doc)

---

## 💡 Pro Tips

### Optimize Search Quality

```typescript
// For technical discussions - prefer keyword matching
const techResults = await searchConversations({
  query: 'JWT token implementation',
  hybridRatio: 0.3  // 30% semantic, 70% keyword
});

// For conceptual searches - prefer semantic matching
const conceptResults = await searchConversations({
  query: 'How should we handle errors?',
  hybridRatio: 0.9  // 90% semantic, 10% keyword
});
```

### Batch Indexing for Performance

```typescript
// Instead of indexing one-by-one:
for (const msg of messages) {
  await service.indexConversation(msg);  // Slow!
}

// Batch index (handled internally by MxfMeilisearchService):
// The service batches up to 100 docs automatically
```

### Monitor Index Health

```bash
# Add to crontab for regular health checks
*/5 * * * * curl http://localhost:7700/health | mail -s "Meilisearch Health" admin@example.com
```

---

## 🆘 Support

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: See [deployment.md](./deployment.md) for deployment details
- **Examples**: Check `examples/` for usage patterns
- **Logs**: Always check logs first: `bun run docker:logs`

---

**Ready to transform your MXF deployment with semantic search!** 🚀

Start with: `./scripts/quick-start.sh`
