---
description: Full system health check
---

Comprehensive health check of the MXF development environment.

**Use this to verify everything is working.**

**Checks performed:**
1. Docker infrastructure status
2. Server health endpoint
3. MongoDB connection
4. Meilisearch status
5. Redis connection
6. Unit tests passing
7. Build succeeds

**Commands run:**
```bash
# Infrastructure
docker-compose ps
curl -s http://localhost:3001/health

# Quick tests
npm run test:unit

# Build check
npm run build
```

**If issues found:** Report what's broken and suggest fixes.
