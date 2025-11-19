# Agents Tab

The Agents tab lets you view, create, configure, and manage AI agents for your channels.

Key features:
- List all agents for the selected channel, filter by status and service type.
- Create new agents with comprehensive configuration (LLM provider, system prompt, capabilities, network settings).
- Generate, rotate, and revoke agent authentication keys.
- Manage agent lifecycle actions (pause, resume, restart, shutdown) and view metrics.

```mermaid
sequenceDiagram
    participant User
    participant Dashboard
    participant API
    User->>Dashboard: Click "Agents" tab
    Dashboard->>API: GET /api/agents?channelId={channelId}
    API-->>Dashboard: Returns agent list
    User->>Dashboard: Click "Create Agent"
    Dashboard->>API: GET /api/config/agent-options
    API-->>Dashboard: Returns provider/model options
    User->>Dashboard: Submit creation form
    Dashboard->>API: POST /api/agents
    API-->>Dashboard: Agent created
```

For detailed API reference, see: [Agents API](../api/agents.md)
