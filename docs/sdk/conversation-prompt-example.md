# Conversation Prompt Examples

Conversation prompts define how agents should communicate with users and other agents within the MXF framework. These prompts establish communication patterns, protocols, and behavioral guidelines for multi-agent interactions.

## Overview

Conversation prompts address:
- **Communication Protocols**: How agents should structure messages
- **Interaction Patterns**: Agent-to-agent and multi-agent communication
- **Context Awareness**: Using shared memory and channel context
- **Coordination Strategies**: How agents collaborate in conversations

## 🚨 Architecture Update v1.1.0: Conversation History Transformation

**Breaking Change**: Conversation history is no longer embedded as text blobs within message content. Instead, the system now uses proper OpenAI/OpenRouter message structure where:

- Each historical message becomes its own role-based message entry
- All messages include agent attribution: `[agent-id]: message content`
- LLMs receive proper conversational context instead of malformed text blobs
- Dramatically improved agent comprehension and response accuracy

This fixes the fundamental architectural flaw where LLMs couldn't understand multi-agent conversation context.

## Example: Agent-to-Agent Coordination

```typescript
// Example of agents coordinating on a shared task
const coordinationPattern = `
    # Agent Coordination Protocol

    ## Communication Guidelines
    When collaborating with other agents:

    1. **Direct Messaging**: Use messaging_send for one-on-one coordination
       - Target specific agent IDs (never message yourself)
       - Include clear context and actionable information
       - Example: messaging_send to "security-agent" requesting vulnerability assessment

    2. **Status Updates**: Keep collaborating agents informed of progress
       - Share intermediate results when relevant
       - Notify when dependencies are ready
       - Communicate any blockers or delays

    3. **Result Handoffs**: When passing work between agents
       - Summarize what was completed
       - Specify what the receiving agent needs to do
       - Include relevant data or context

    ## Example Coordination Flow
    [architect-agent → security-agent]: "I've completed the API design review. Please assess the authentication flow in the attached specification for security compliance."
    
    [security-agent → architect-agent]: "Security review complete. The authentication flow meets requirements with one recommendation: implement rate limiting on the /auth endpoint."
    
    [architect-agent → performance-agent]: "Security approved with rate limiting addition. Please review the updated design for performance implications."
`;
```

## Example: Multi-Agent Channel Conversation

**🚨 CRITICAL ARCHITECTURE UPDATE**: As of v1.1.0, conversation history is no longer embedded as text blobs. Instead, each message becomes its own properly attributed role-based message in the LLM API call.

### New Architecture: Proper Message Turns with Agent Attribution

```typescript
// Example of how conversation history now flows to the LLM
// Each historical message becomes its own message entry with agent attribution
const newConversationStructure = [
    {
        "role": "system", 
        "content": "System prompt..."
    },
    {
        "role": "user", 
        "content": "Agent identity and capabilities..."
    },
    {
        "role": "user", 
        "content": "## Your Recent Actions\n- [14:32:15] messaging_send → alice\n- [14:31:45] tools_recommend: task_planning, calendar_check\n- [14:31:20] channel_context_read: Retrieved channel history"
    },
    // 🎯 PROPER CONVERSATION HISTORY - Each message gets its own turn with attribution
    {
        "role": "user", 
        "content": "[alice]: Hi Bob, I need your help coordinating a team meeting for next week. Could you please let me know your availability?"
    },
    {
        "role": "assistant", 
        "content": "[bob]: Hi Alice, I am ready to coordinate the team meeting for next week. What days and times work best for you?"
    },
    // 🎯 CURRENT MESSAGE - Clean and attributed
    {
        "role": "user", 
        "content": "[alice]: Thanks Bob! I'm available Tuesday through Thursday, preferably in the afternoons. What works for you?"
    }
];
```

### Old Architecture (DEPRECATED - Before v1.1.0)

```typescript
// ❌ OLD WAY - Text blob embedding (caused LLM comprehension issues)
const deprecatedChannelConversationPattern = `
    ## Your Recent Actions
    - [14:32:15] messaging_send → alice
    - [14:31:45] tools_recommend: task_planning, calendar_check, messaging_send
    - [14:31:20] channel_context_read: Retrieved channel history
    - [14:30:55] agent_discover: Found 3 agents in channel

    ## Conversation History
    [alice]: Hi Bob, I need your help coordinating a team meeting for next week. Could you please let me know your availability for next week so we can find a mutually agreeable time?
    [bob]: Hi Alice, I am ready to coordinate the team meeting for next week. What days and times work best for you?
    
    ## Current Message
    [alice]: Thanks Bob! I'm available Tuesday through Thursday, preferably in the afternoons. What works for you?
`;
```

## Action History Format

The action history section provides a concise view of recent agent actions:

### Format Examples

```
- [HH:MM:SS] tool_name: description/details
```

**Common Tool Formats:**
- `messaging_send → target_agent` - Shows message recipient without duplicating message content
- `tools_recommend: tool1, tool2, tool3` - Lists recommended tool names
- `task_complete: description` - Shows task completion details
- `channel_context_read: Retrieved X messages` - Shows context retrieval
- `agent_discover: Found N agents` - Shows discovery results

### Why This Format?

1. **Non-redundant**: Message content is not repeated since it appears in conversation history
2. **Tool visibility**: Always shows the actual tool name that was called
3. **Actionable details**: Includes relevant details like targets and results
4. **Timestamp precision**: Uses HH:MM:SS format for clear action sequencing

## Communication Patterns

### 1. **Direct Messaging**
- One-to-one agent communication
- Private coordination and handoffs
- Sensitive information exchange

### 2. **Channel Broadcasting**
- One-to-many communication
- Status announcements and updates
- Shared context updates

### 3. **Collaborative Discussion**
- Many-to-many interaction
- Group problem-solving
- Consensus building

### 4. **Agent Coordination**
- Multi-agent task orchestration
- Status synchronization and updates
- Result validation and consensus building

## Best Practices

### 1. **Clear Communication**
- Structured message formats
- Specific and actionable content
- Appropriate detail level for audience
- **Agent Attribution**: Always include `[agent-id]: content` format for multi-agent clarity

### 2. **Context Awareness**
- Reference shared memory and context
- Acknowledge previous interactions
- Maintain conversation continuity
- **Proper Turn Structure**: Leverage the new message turn architecture for better context

### 3. **Role Coordination**
- Respect agent specializations
- Appropriate delegation and handoffs
- Clear responsibility boundaries
- **Agent Directory Clarity**: Always provide clear agent ID listings in prompts

### 4. **Agent Experience**
- Clear, structured communication between agents
- Progress visibility and status updates
- Error explanation and recovery procedures
- **Conversation Flow**: Benefit from improved LLM comprehension with proper message attribution

## MXP Protocol Integration

When `mxpEnabled: true`, conversation prompts should include examples of the efficient MXP format:

```json
{
  "op": "comm.send",
  "args": [{
    "target": "agent-id",
    "message": "Coordination message content"
  }]
}
```

## Migration Guide from v1.0.x

If you're upgrading from v1.0.x, the conversation history architecture change is automatic:

- **No code changes required** - The `MxfStructuredPromptBuilder` handles the transformation
- **Improved agent performance** - Agents will have better conversation comprehension
- **Cleaner prompts** - No more confusing text blob formatting

**Key Changes:**
- Text blob conversation history → Proper message turns
- Agent attribution added to all messages
- LLMs receive proper conversational context
- Better multi-agent coordination

## Related Documentation

- **[System Prompt Examples](./system-prompt-example.md)** - Framework-level system prompts
- **[Agent Config Prompt Examples](./agent-config-prompt-example.md)** - Agent configuration patterns
- **[Task Prompt Examples](./task-prompt-example.md)** - Task-specific prompting patterns
- **[Event System](./events.md)** - Real-time communication events
- **[MXP Technical Specification](../mxf/mxp-technical-specification.md)** - MXP protocol details
- **[CHANGELOG.md](../../CHANGELOG.md)** - v1.1.0 architecture transformation details
