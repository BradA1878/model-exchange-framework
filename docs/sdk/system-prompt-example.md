# System Prompt Examples

The MXF framework generates different system prompts based on agent configuration, particularly the `mxpEnabled` setting. This setting significantly impacts the format of tool examples and communication patterns shown to agents.

## Available Examples

### 📋 [Standard System Prompt](./system-prompt-example-standard.md)
**Configuration**: `mxpEnabled: false`

Shows the traditional JSON format used for tool calls and examples:
```json
{
  "name": "messaging_send",
  "arguments": {
    "targetAgentId": "agent-id",
    "message": "Hello!"
  }
}
```

**Use when**: Working with legacy systems, mixed environments, or when MXP optimization is not needed.

### 🚀 [MXP-Optimized System Prompt](./system-prompt-example-mxp.md)
**Configuration**: `mxpEnabled: true`

Shows the MXP protocol format used throughout all tool examples and communication patterns:
```json
{
  "op": "comm.send",
  "args": [{
    "target": "agent-id",
    "message": "Hello!"
  }]
}
```

**Use when**: Maximizing token efficiency, working in pure MXF environments, or leveraging advanced MXP features.

## Key Differences

| Aspect | Standard Format | MXP Format |
|--------|----------------|------------|
| **Tool Examples** | Verbose JSON with `name`/`arguments` | Compact protocol with `op`/`args` |
| **Token Usage** | Higher token consumption | 60-70% reduction in collaborative workflows |
| **Format Consistency** | Mixed formats throughout prompt | Unified MXP format throughout |
| **Learning Curve** | Traditional JSON (familiar) | Protocol-oriented (efficient) |
| **Compatibility** | Works with all agents | Requires MXP-enabled agents |

## Dynamic Template System

**Both standard and MXP prompts support dynamic template replacement**. Templates are replaced on **every API request** without modifying the cached system prompt:

### Available Templates (17 total)

**Temporal Templates** - Always fresh:
- `{{DATE_TIME}}` - "Friday, October 10, 2025 at 5:17 PM MDT"
- `{{DAY_OF_WEEK}}`, `{{CURRENT_YEAR}}`, `{{CURRENT_MONTH}}`, `{{CURRENT_DAY}}`
- `{{TIME_ZONE}}`, `{{ISO_TIMESTAMP}}`, `{{OS_PLATFORM}}`

**Context Templates** - Updated per request:
- `{{AGENT_ID}}`, `{{CHANNEL_ID}}`, `{{CHANNEL_NAME}}`
- `{{ACTIVE_AGENTS_COUNT}}`, `{{ACTIVE_AGENTS_LIST}}`

**Configuration Templates**:
- `{{LLM_PROVIDER}}`, `{{LLM_MODEL}}`, `{{SYSTEM_LLM_STATUS}}`
- `{{CURRENT_ORPAR_PHASE}}`

### Example

**Template in system prompt**:
```markdown
**Current Date/Time**: {{DATE_TIME}}
**Active Agents**: {{ACTIVE_AGENTS_COUNT}}
```

**Replaced on API request**:
```markdown
**Current Date/Time**: Friday, October 10, 2025 at 5:17:32 PM MDT
**Active Agents**: 3
```

This enables agents to:
- Make time-based decisions ("Is it Monday?")
- Schedule tasks ("What's tomorrow's date?")
- Collaborate effectively ("Who else is in this channel?")
- Understand their environment ("What LLM am I using?")

**See [SDK Managers Documentation](./managers.md#dynamic-template-replacement) for complete details.**

## Integration

When implementing agents, choose the appropriate example based on your `mxpEnabled` configuration:

```typescript
// For standard JSON format
const agentConfig: AgentConfig = {
  // ... other config
  mxpEnabled: false
};
// Use: system-prompt-example-standard.md

// For MXP protocol format  
const agentConfig: AgentConfig = {
  // ... other config
  mxpEnabled: true
};
// Use: system-prompt-example-mxp.md
```

## Related Documentation

- **[MXP Technical Specification](../mxf/mxp-technical-specification.md)** - Complete technical details of the MXP protocol
- **[MXP Protocol Overview](../mxf/mxp-protocol.md)** - Understanding MXP 2.0 features
- **[SDK Interfaces](./interfaces.md)** - Complete SDK interface documentation