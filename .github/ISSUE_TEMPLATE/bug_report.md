---
name: Bug Report
about: Report a bug or issue in the Model Exchange Framework
title: '[BUG] '
labels: bug
assignees: ''

---

## Bug Description
<!-- Provide a clear and concise description of the bug -->

## Environment
**MXF Version:**
<!-- e.g., 1.1.0 - check package.json or npm list model-exchange-framework -->

**Node.js Version:**
<!-- Run: node --version -->

**Operating System:**
<!-- e.g., macOS 14.0, Ubuntu 22.04, Windows 11 -->

**Deployment Method:**
- [ ] Docker Compose (Production)
- [ ] Local Development
- [ ] Custom Docker Setup
- [ ] Other (please specify):

**Components Affected:**
<!-- Check all that apply -->
- [ ] MXF Server
- [ ] MXF SDK (Agent Client)
- [ ] Dashboard
- [ ] REST API
- [ ] Socket.IO Communication
- [ ] Tool Execution (Built-in tools)
- [ ] MCP Server Integration (External tools)
- [ ] Control Loop (ORPAR)
- [ ] Task Management
- [ ] Memory System
- [ ] Validation System
- [ ] Meilisearch Integration
- [ ] MongoDB Integration
- [ ] Redis Caching
- [ ] MXP Protocol
- [ ] Documentation

**LLM Provider (if applicable):**
<!-- e.g., OpenRouter, OpenAI, Anthropic, Ollama -->

## Steps to Reproduce
<!-- Provide detailed steps to reproduce the bug -->

1. 
2. 
3. 
4. 

## Expected Behavior
<!-- What should happen? -->

## Actual Behavior
<!-- What actually happens? -->

## Code Sample
<!-- If applicable, provide a minimal code sample that reproduces the issue -->

```typescript
// Your code here
```

## Logs and Error Messages
<!-- Include relevant error messages, stack traces, or logs -->
<!-- IMPORTANT: Redact any API keys, tokens, or sensitive information -->

```
Paste logs here
```

**Server Logs:**
```
<!-- If server-side issue, include logs from: npm run docker:logs or console output -->
```

**SDK/Agent Logs:**
```
<!-- If SDK-side issue, include agent connection logs and event traces -->
```

## Configuration
<!-- Share relevant parts of your .env or configuration (REDACT sensitive values) -->

```env
# Example
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/mxf
ENABLE_MEILISEARCH=true
SYSTEMLLM_ENABLED=true
SYSTEMLLM_PROVIDER=openrouter
MXP_ENCRYPTION_ENABLED=false
```

## Event/Tool Information
<!-- If the bug involves specific events or tools -->

**Event Names (if applicable):**
<!-- e.g., agent:register, message:send, task:created -->
- 

**Tool Names (if applicable):**
<!-- e.g., messaging_send, task_create, memory_search_conversations -->
- 

**Channel ID (if applicable):**
<!-- e.g., dev-channel-01 -->

## Validation/Error Prevention
<!-- If related to validation system -->
- [ ] This involves validation preview
- [ ] This involves auto-correction
- [ ] This involves error prediction
- [ ] Validation level used: <!-- ASYNC/BLOCKING/STRICT -->

## Additional Context
<!-- Any other context, screenshots, or information about the problem -->

## Possible Solution
<!-- Optional: If you have ideas on how to fix the issue -->

## Checklist
- [ ] I have searched existing issues to avoid duplicates
- [ ] I have included all relevant environment details
- [ ] I have provided steps to reproduce the issue
- [ ] I have redacted sensitive information (API keys, tokens, etc.)
- [ ] I have included relevant logs and error messages
- [ ] I have checked the [documentation](docs/index.md)
