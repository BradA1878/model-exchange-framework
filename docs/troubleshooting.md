# Troubleshooting Guide

This guide helps you diagnose and resolve common issues when working with the Model Exchange Framework (MXF).

---

## Quick Diagnosis

### Check System Health

```bash
# Check if MXF server is running
curl http://localhost:3001/health

# Check Docker containers (if using Docker deployment)
docker ps

# View server logs
npm run docker:logs mxf-server
```

---

## Connection Issues

### Agent Cannot Connect to Server

**Symptoms:**
- Agent hangs on `connect()`
- Socket.IO connection timeouts
- "ECONNREFUSED" errors

**Solutions:**

1. **Verify server is running:**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Check host and port configuration:**
   ```typescript
   const agent = await sdk.createAgent({
       // Ensure these match your server
       host: 'localhost',  // or your server IP
       port: 3001,         // default MXF port
       secure: false       // true for HTTPS
   });
   ```

3. **Check firewall rules:**
   - Port 3001 must be accessible
   - WebSocket connections must be allowed

4. **Verify MongoDB is running:**
   ```bash
   mongosh --eval "db.runCommand({ ping: 1 })"
   ```

### Authentication Failures

**Symptoms:**
- "Unauthorized" errors
- "Invalid API key" messages
- Agent registration fails

**Solutions:**

1. **Verify API key format:**
   ```typescript
   const agent = await sdk.createAgent({
       keyId: 'your-key-id',      // Must match server config
       secretKey: 'your-secret'   // Must match server config
   });
   ```

2. **Check environment variables:**
   ```bash
   echo $AGENT_API_KEY
   echo $JWT_SECRET
   ```

3. **Ensure domain key is valid:**
   ```typescript
   const sdk = new MxfSDK({
       domainKey: process.env.MXF_DOMAIN_KEY
   });
   ```

---

## Task Execution Issues

### Tasks Not Being Assigned

**Symptoms:**
- Tasks stay in "pending" state
- No agent picks up tasks
- TaskService not routing tasks

**Solutions:**

1. **Verify agent is in correct channel:**
   ```typescript
   // Agent must be in the channel where task was created
   const agent = await sdk.createAgent({
       channelId: 'target-channel'
   });
   ```

2. **Check task handling is enabled:**
   ```typescript
   const agent = await sdk.createAgent({
       disableTaskHandling: false  // Must be false (default)
   });
   ```

3. **Verify SystemLLM is enabled:**
   ```typescript
   const channel = await sdk.createChannel('channel-id', {
       systemLlmEnabled: true  // Required for task routing
   });
   ```

### Tool Execution Fails

**Symptoms:**
- "Tool not found" errors
- "Invalid parameters" messages
- Tool returns error instead of result

**Solutions:**

1. **Verify tool exists:**
   ```typescript
   const tools = await agent.getAvailableTools();
   console.log(tools.find(t => t.name === 'your_tool'));
   ```

2. **Check tool parameters against schema:**
   ```typescript
   // Use tool_validate before execution
   const validation = await agent.executeTool('tool_validate', {
       tool_name: 'messaging_send',
       parameters: { targetId: 'agent-1', content: 'Hello' }
   });
   ```

3. **Check allowedTools configuration:**
   ```typescript
   const agent = await sdk.createAgent({
       allowedTools: ['messaging_send', 'task_complete']
       // Agent can only use these tools
   });
   ```

---

## LLM Issues

### No Response from LLM

**Symptoms:**
- Agent doesn't respond to messages
- Control loop hangs
- "LLM timeout" errors

**Solutions:**

1. **Verify API key is set:**
   ```bash
   echo $OPENROUTER_API_KEY
   # Or for other providers:
   echo $OPENAI_API_KEY
   echo $ANTHROPIC_API_KEY
   ```

2. **Check provider configuration:**
   ```typescript
   const agent = await sdk.createAgent({
       llmProvider: 'openrouter',
       defaultModel: 'anthropic/claude-3.5-sonnet',
       apiKey: process.env.OPENROUTER_API_KEY
   });
   ```

3. **Increase timeout if needed:**
   ```typescript
   const agent = await sdk.createAgent({
       requestTimeoutMs: 120000  // 2 minutes
   });
   ```

### Circuit Breaker Triggered

**Symptoms:**
- "Circuit breaker open" errors
- Agent stops executing tools
- Repeated tool failures

**Solutions:**

1. **Check for tool execution loops:**
   - Agent may be calling the same tool repeatedly
   - Review agent's system prompt for clarity

2. **Exempt specific tools from circuit breaker:**
   ```typescript
   const agent = await sdk.createAgent({
       circuitBreakerExemptTools: ['game_move', 'dice_roll']
   });
   ```

3. **Increase max iterations for game scenarios:**
   ```typescript
   const agent = await sdk.createAgent({
       maxIterations: 50  // Default is 10
   });
   ```

---

## Memory Issues

### Memory Not Persisting

**Symptoms:**
- Agent forgets context between sessions
- Channel memory not shared
- Relationship memory empty

**Solutions:**

1. **Verify MongoDB connection:**
   ```bash
   mongosh $MONGODB_URI --eval "db.memories.countDocuments()"
   ```

2. **Check memory scope:**
   ```typescript
   // Agent memory (private)
   await agent.setMemory('key', 'value', 'agent');

   // Channel memory (shared)
   await agent.setMemory('key', 'value', 'channel');
   ```

3. **Ensure memory service is initialized:**
   - Check server logs for memory service errors

### Meilisearch Search Not Working

**Symptoms:**
- `memory_search_*` tools return empty results
- "Meilisearch not available" warnings

**Solutions:**

1. **Verify Meilisearch is running:**
   ```bash
   curl http://localhost:7700/health
   ```

2. **Check environment variables:**
   ```bash
   echo $MEILISEARCH_HOST
   echo $MEILISEARCH_MASTER_KEY
   echo $ENABLE_MEILISEARCH
   ```

3. **Force reindex if needed:**
   ```bash
   npm run docker:meilisearch:reindex
   ```

---

## WebSocket Issues

### Connection Drops

**Symptoms:**
- Agents disconnect unexpectedly
- "Heartbeat timeout" messages
- Reconnection loops

**Solutions:**

1. **Check network stability:**
   - WebSockets require stable connections
   - Proxy/firewall may drop idle connections

2. **Verify heartbeat settings:**
   - Default: 30-second intervals, 5-minute timeout
   - Server logs show heartbeat status

3. **Enable auto-reconnect:**
   ```typescript
   const agent = await sdk.createAgent({
       autoReconnect: true,
       reconnectAttempts: 5,
       reconnectDelay: 2000
   });
   ```

---

## Docker Deployment Issues

### Container Won't Start

**Symptoms:**
- Docker container exits immediately
- "Port already in use" errors
- Service health checks fail

**Solutions:**

1. **Check port conflicts:**
   ```bash
   lsof -i :3001
   lsof -i :27017
   lsof -i :7700
   ```

2. **View container logs:**
   ```bash
   docker logs mxf-server
   docker logs mongodb
   docker logs meilisearch
   ```

3. **Rebuild containers:**
   ```bash
   npm run docker:rebuild
   ```

### MongoDB Connection Failed

**Symptoms:**
- "MongoNetworkError" in logs
- Database operations timeout
- "Authentication failed" errors

**Solutions:**

1. **Verify MongoDB is accessible:**
   ```bash
   docker exec -it mongodb mongosh --eval "db.runCommand({ ping: 1 })"
   ```

2. **Check connection string:**
   ```bash
   echo $MONGODB_URI
   # Should be: mongodb://localhost:27017/mxf
   ```

3. **Reset MongoDB if needed:**
   ```bash
   npm run docker:down
   npm run docker:clean
   npm run docker:up
   ```

---

## Performance Issues

### Slow Response Times

**Symptoms:**
- Agent responses take > 10 seconds
- High latency on tool execution
- Dashboard shows slow metrics

**Solutions:**

1. **Check LLM model selection:**
   - Use faster models for observation phase
   - Consider haiku/3.5-sonnet for quick responses

2. **Enable caching:**
   ```bash
   VALIDATION_CACHE_ENABLED=true
   ```

3. **Optimize context window:**
   ```typescript
   const agent = await sdk.createAgent({
       maxHistory: 20,        // Limit conversation history
       maxMessageSize: 50000  // Limit message size
   });
   ```

### High Memory Usage

**Symptoms:**
- Server crashes with OOM errors
- Docker containers restart frequently
- MongoDB uses excessive memory

**Solutions:**

1. **Limit Meilisearch memory:**
   ```bash
   MEILI_MAX_INDEXING_MEMORY=1GB
   ```

2. **Configure Redis limits:**
   ```bash
   # In docker-compose.yml
   redis:
       command: redis-server --maxmemory 256mb
   ```

3. **Clean up old data:**
   ```bash
   npm run cleanup:db
   ```

---

## Debug Mode

Enable verbose logging for detailed diagnostics:

```typescript
const agent = await sdk.createAgent({
    logger: {
        level: 'debug',
        pretty: true
    }
});
```

Or set environment variable:
```bash
DEBUG=mxf:* npm run start:dev
```

---

## Getting Help

If you're still experiencing issues:

1. **Check existing issues:** [GitHub Issues](https://github.com/BradA1878/model-exchange-framework/issues)
2. **Ask the community:** [GitHub Discussions](https://github.com/BradA1878/model-exchange-framework/discussions)
3. **Review documentation:** [Full Documentation](./index.md)

When reporting issues, include:
- MXF version
- Node.js version
- Operating system
- Relevant error messages
- Steps to reproduce
