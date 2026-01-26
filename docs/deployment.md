# MXF Deployment Guide - Docker + Meilisearch

This guide covers deploying the complete MXF stack with Meilisearch semantic search integration.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     MXF Stack (Docker)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │              │  │              │  │              │      │
│  │  MXF Server  │  │   MongoDB    │  │ Meilisearch  │      │
│  │    (Bun)     │  │  (Database)  │  │   (Search)   │      │
│  │              │  │              │  │              │      │
│  │  Port: 3001  │  │  Port: 27017 │  │  Port: 7700  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │              │
│         └─────────────────┴─────────────────┘              │
│                           │                                 │
│                    ┌──────┴────────┐                        │
│                    │               │                        │
│                    │     Redis     │                        │
│                    │    (Cache)    │                        │
│                    │               │                        │
│                    │  Port: 6379   │                        │
│                    └───────────────┘                        │
│                                                               │
│  ┌──────────────────────────────────────────────────┐       │
│  │                                                    │       │
│  │              MXF Dashboard (Vue.js)                │       │
│  │                  Port: 5173                        │       │
│  │                                                    │       │
│  └────────────────────────────────────────────────────┘       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Docker** 24.0+ and **Docker Compose** 2.0+
- **Node.js** 20+ (for local development) or **Bun** 1.1+ (for fast package management)
- **OpenAI API Key** (for embeddings)
- **OpenRouter API Key** (optional, for SystemLLM)

> **Note:** MXF uses Bun for both package management and server execution. The Docker image uses Bun in both build and production stages.

## 🚀 Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone <your-repo>
cd model-exchange-framework

# Copy environment template
cp .env.example .env

# Edit .env with your keys
nano .env
```

### 2. Generate Secure Keys

```bash
# Generate Meilisearch master key (32+ chars)
openssl rand -base64 32

# Generate JWT secret
openssl rand -base64 64

# Generate agent API key
openssl rand -base64 32

# Generate Redis password
openssl rand -base64 32
```

### 3. Update .env File

**Required environment variables:**

```bash
# Security - CHANGE THESE!
MEILISEARCH_MASTER_KEY=<your-generated-key>
JWT_SECRET=<your-generated-secret>
AGENT_API_KEY=<your-generated-api-key>
MONGODB_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# LLM Integration
OPENAI_API_KEY=sk-<your-openai-key>
OPENROUTER_API_KEY=sk-or-v1-<your-openrouter-key>

# Meilisearch Features
ENABLE_MEILISEARCH=true
ENABLE_SEMANTIC_SEARCH=true
MEILISEARCH_HYBRID_RATIO=0.7
```

### 4. Launch the Stack

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check service health
docker-compose ps
```

### 5. Verify Installation

```bash
# Check MXF Server
curl http://localhost:3001/health

# Check Meilisearch
curl http://localhost:7700/health

# Check MongoDB
docker exec mxf-mongodb mongosh --eval "db.adminCommand('ping')"

# Check Redis
docker exec mxf-redis redis-cli ping
```

### 6. Initialize Meilisearch Indexes

```bash
# The MXF server will auto-initialize indexes on first start
# Check logs:
docker-compose logs mxf-server | grep Meilisearch

# Expected output:
# "Initializing Meilisearch indexes..."
# "Created index: mxf-conversations"
# "Created index: mxf-actions"
# "Created index: mxf-patterns"
# "Meilisearch indexes initialized successfully"
```

## 🔧 Configuration

### Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| **mxf-server** | 3001 | Main MXF application server |
| **mongodb** | 27017 | Database for persistence |
| **meilisearch** | 7700 | Semantic search engine |
| **redis** | 6379 | Caching layer |
| **mxf-dashboard** | 5173 | Vue.js frontend |

### Meilisearch Configuration

```env
# Memory allocation for indexing
MEILI_MAX_INDEXING_MEMORY=2GB

# CPU threads for indexing
MEILI_MAX_INDEXING_THREADS=4

# Embeddings configuration
MEILISEARCH_EMBEDDING_MODEL=text-embedding-3-small
MEILISEARCH_EMBEDDING_DIMENSIONS=1536
```

### Performance Tuning

**For production workloads:**

```env
# Increase memory for large conversation histories
MEILI_MAX_INDEXING_MEMORY=4GB

# Use more threads on multi-core systems
MEILI_MAX_INDEXING_THREADS=8

# Adjust hybrid search ratio
# 0.0 = keyword only (fast, exact matches)
# 1.0 = semantic only (slower, conceptual matches)
# 0.7 = balanced (recommended)
MEILISEARCH_HYBRID_RATIO=0.7

# Batch size for indexing
MEILISEARCH_BATCH_SIZE=200
```

## 📊 Monitoring & Maintenance

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f mxf-server
docker-compose logs -f meilisearch

# Last 100 lines
docker-compose logs --tail=100 mxf-server
```

### Meilisearch Stats

```bash
# Access Meilisearch UI
open http://localhost:7700

# Get stats via API
curl -X GET http://localhost:7700/stats \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY"
```

### Database Backups

```bash
# MongoDB backup
docker exec mxf-mongodb mongodump --out /data/backup

# Meilisearch snapshot
curl -X POST http://localhost:7700/snapshots \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY"
```

### Restart Services

```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart mxf-server

# Rebuild after code changes
docker-compose up -d --build
```

## 🔍 Using Semantic Search

### From SDK/Agents

```typescript
// Search conversations
const results = await mxfClient.executeTool('memory_search_conversations', {
  query: 'authentication implementation discussion',
  limit: 5,
  hybridRatio: 0.8
});

// Search actions
const actions = await mxfClient.executeTool('memory_search_actions', {
  query: 'send message to AgentB',
  successOnly: true
});

// Discover patterns
const patterns = await mxfClient.executeTool('memory_search_patterns', {
  intent: 'multi-agent coordination workflow',
  minEffectiveness: 0.8,
  crossChannel: true
});
```

### From Dashboard

Navigate to: `http://localhost:5173/memory-search`

## 🔒 Security Considerations

### Production Checklist

- [ ] Change all default passwords in `.env`
- [ ] Generate unique API keys for each environment
- [ ] Enable HTTPS (use nginx reverse proxy)
- [ ] Configure firewall rules (only expose ports 80, 443)
- [ ] Set `NODE_ENV=production`
- [ ] Enable MongoDB authentication
- [ ] Use Docker secrets for sensitive data
- [ ] Regular security updates: `docker-compose pull`

### Docker Secrets (Recommended)

```yaml
# docker-compose.yml
services:
  mxf-server:
    secrets:
      - meilisearch_key
      - openai_key
    environment:
      MEILISEARCH_MASTER_KEY_FILE: /run/secrets/meilisearch_key
      OPENAI_API_KEY_FILE: /run/secrets/openai_key

secrets:
  meilisearch_key:
    file: ./secrets/meilisearch_key.txt
  openai_key:
    file: ./secrets/openai_key.txt
```

## 📈 Scaling

### Horizontal Scaling

```yaml
# docker-compose.yml
services:
  mxf-server:
    deploy:
      replicas: 3
      restart_policy:
        condition: on-failure
```

### Load Balancing

Use nginx or HAProxy:

```nginx
upstream mxf_backend {
    least_conn;
    server mxf-server-1:3001;
    server mxf-server-2:3001;
    server mxf-server-3:3001;
}

server {
    listen 80;
    location / {
        proxy_pass http://mxf_backend;
    }
}
```

## 🐛 Troubleshooting

### Meilisearch Connection Issues

```bash
# Check if Meilisearch is running
docker-compose ps meilisearch

# Check logs
docker-compose logs meilisearch

# Test connection
curl http://localhost:7700/health

# Verify API key
curl -X GET http://localhost:7700/indexes \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY"
```

### MongoDB Connection Issues

```bash
# Check MongoDB status
docker exec mxf-mongodb mongosh --eval "db.adminCommand('ping')"

# Verify authentication
docker exec mxf-mongodb mongosh -u mxf_admin -p <password> --authenticationDatabase admin
```

### High Memory Usage

```bash
# Check resource usage
docker stats

# Limit container memory
docker-compose up -d --scale mxf-server=1 --memory 2g
```

### Index Rebuild

```bash
# Clear Meilisearch indexes
curl -X DELETE http://localhost:7700/indexes/mxf-conversations \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY"

# Restart MXF server to recreate
docker-compose restart mxf-server
```

## 🔄 Updates & Upgrades

### Update MXF

```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker-compose build --no-cache

# Restart with new images
docker-compose up -d
```

### Update Dependencies

```bash
# Update npm packages
npm update

# Rebuild Docker images
docker-compose build
```

### Update Meilisearch

```bash
# Update docker-compose.yml with new version
# image: getmeili/meilisearch:v1.12

# Pull new image
docker-compose pull meilisearch

# Restart
docker-compose up -d meilisearch
```

## 📚 Additional Resources

- **Meilisearch Docs**: https://docs.meilisearch.com
- **Docker Docs**: https://docs.docker.com
- **MXF Documentation**: ./docs/
- **API Reference**: http://localhost:3001/api/docs

## 🆘 Support

- GitHub Issues: <your-repo>/issues
- Documentation: ./docs/
- Community: <your-discord/slack>

---

**Next Steps:**
1. Read [meilisearch-integration.md](./meilisearch-integration.md) for semantic search usage guide
2. Explore [examples/](./examples/) for implementation patterns
3. Review [mxf/index.md](./mxf/index.md) for system architecture
