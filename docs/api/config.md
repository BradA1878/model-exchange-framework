# Config API

## Agent execution and server controls

Agent execution options belong to `sdk.createAgent()`: `promptMode` defaults to
`framework`, `activation` to `task`, `circuitBreakerEnabled` to `true`, and
`captureLlmRequests` to `false`. `providerOptions` forwards native routing options.
See [bare agents](../sdk/bare-agents.md) and [event contracts](../sdk/events.md).

The server reads these operator settings at startup:

| Setting | Default | Accepted values |
| --- | --- | --- |
| `AUTO_CORRECTION_ENABLED` | `true` | Exactly `true` / `false`; false also disables correction-pattern learning. |
| `MXP_ENABLED` | `true` | Exactly `true` / `false`; false disables server messaging MXP. |
| `TASK_INTELLIGENT_ASSIGNMENT_ENABLED` | `true` | Exactly `true` / `false`; false prevents intelligent assignment. |
| `MXF_CHANNEL_HISTORY_DM_VISIBILITY` | `all` | `all` / `parties`. |
| `MXF_AGENT_FILESYSTEM_ROOTS` | Unset, disabled | Nonempty comma-separated absolute templates using `{agentId}`; roots must exist. |
| `MXF_EXTERNAL_MCP_AUTOSTART` | Predefined selection | Comma-separated predefined IDs; empty means no predefined boot launches. |

These environment settings are separate from the configuration-template CRUD
endpoints below. See [server deployment and migration](../server-agent-controls.md)
for exact behavior, conflicts, dependencies, and required history migration.

Detailed reference for all `/config` endpoints.

---

## Agent Configuration Options
**GET** `/config/agent-options`
- **Auth:** JWT (user)
- **Description:** Retrieve configuration options for agents, including supported LLM providers, default models, agent types, capabilities, and default settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "llmProviders": [
      { "value": "openai", "label": "OpenAI", "requiresApiKey": true },
      /* ... */
    ],
    "defaultModels": {
      "openai": ["gpt-4o", "gpt-3.5-turbo"],
      /* ... */
    },
    "agentTypes": [
      { "value": "conversation", "label": "Conversation Agent" },
      /* ... */
    ],
    "commonCapabilities": ["reasoning", "analysis", "conversation"],
    "commonServiceTypes": ["chat", "completion", "analysis"],
    "defaultSettings": {
      "temperature": 0.7,
      "maxTokens": 2048,
      "host": "localhost",
      "port": 3001,
      "secure": false
    }
  }
}
```

---

## Configuration Templates

### List Templates
**GET** `/config/templates`
- **Auth:** JWT (user)
- **Query Params:**
  - `type` (string, optional) — filter by template type (`agent`, `channel`, etc.)
- **Description:** Retrieve all configuration templates.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "templateId": "string",
      "name": "string",
      "description": "string",
      "type": "agent",
      "configuration": { /* template content */ },
      "createdAt": "ISO timestamp",
      "updatedAt": "ISO timestamp"
    }
  ]
}
```

### Get Template by ID
**GET** `/config/templates/:templateId`
- **Auth:** JWT (user)
- **Params:**
  - `templateId` (string)
- **Description:** Retrieve a specific configuration template.

**Response:**
```json
{
  "success": true,
  "data": { /* same schema as in List Templates */ }
}
```

### Create Template
**POST** `/config/templates`
- **Auth:** JWT (user)
- **Body:**
```json
{
  "name": "string",
  "description": "string",
  "type": "agent",        // e.g. agent, channel
  "configuration": { /* template details */ },
  "variables": { /* optional variables map */ }
}
```
- **Description:** Create a new configuration template.

**Response:**
```json
{
  "success": true,
  "data": { /* created template object */ }
}
```

### Update Template
**PUT** `/config/templates/:templateId`
- **Auth:** JWT (user)
- **Params:**
  - `templateId` (string)
- **Body:** Partial template fields to update

```json
{
  "name": "string",
  "configuration": { /* updated content */ }
}
```
- **Description:** Update an existing configuration template.

**Response:**
```json
{
  "success": true,
  "data": { /* updated template object */ }
}
```

### Delete Template
**DELETE** `/config/templates/:templateId`
- **Auth:** JWT (user)
- **Params:**
  - `templateId` (string)
- **Description:** Delete a configuration template permanently.

**Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully"
}
```

---

## Deployment Configurations

### List Deployments
**GET** `/config/deployments`
- **Auth:** JWT (user)
- **Description:** Retrieve all deployment configurations.

**Response:**
```json
{
  "success": true,
  "data": [ /* array of deployment config objects */ ]
}
```

### Create Deployment Configuration
**POST** `/config/deployments`
- **Auth:** JWT (user)
- **Body:**
```json
{
  "name": "string",
  "description": "string",
  "environment": "development",  // target environment
  "templateId": "string",
  "configuration": { /* config object */ },
  "deploymentTarget": { /* target details */ }
}
```
- **Description:** Create a new deployment configuration.

**Response:**
```json
{
  "success": true,
  "data": { /* created deployment config */ }
}
```

---

## Environment Configurations

### List Environments
**GET** `/config/environments`
- **Auth:** JWT (user)
- **Description:** Retrieve all environment configurations.

**Response:**
```json
{
  "success": true,
  "data": [ /* array of environment config objects */ ]
}
```

### Update Environment Configuration
**PUT** `/config/environments/:envId`
- **Auth:** JWT (user)
- **Params:**
  - `envId` (string)
- **Body:** Partial environment fields

```json
{
  "variables": { /* key-value map */ },
  "endpoints": { /* URLs */ }
}
```
- **Description:** Update settings for a specific environment.

**Response:**
```json
{
  "success": true,
  "data": { /* updated environment config */ }
}
```

---

## Sync Configuration
**POST** `/config/sync`
- **Auth:** JWT (user)
- **Body:**
```json
{
  "source": "template",   // template, deployment, environment
  "target": "development",// target identifier
  "parameters": { /* sync params */ }
}
```
- **Description:** Initiate configuration synchronization from an external source.

**Response:**
```json
{
  "success": true,
  "data": {
    "syncId": "string",
    "status": "started",
    "message": "Configuration sync initiated"
  }
}
```

## Get Agent Options
**GET** `/config/agent-options`
- **Auth:** JWT
- **Description:** Returns configuration options for agents, including supported LLM providers, models, agent types, capabilities, and default settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "providers": [
      {
        "name": "OpenAI",
        "label": "OpenAI",
        "requiresApiKey": true,
        "defaultModels": ["gpt-4", "gpt-3.5-turbo"]
      }
      // ...other providers
    ],
    "agentTypes": ["assistant", "moderator", "custom"],
    "serviceTypes": ["qa", "summarization", "translation"],
    "defaultSettings": {
      "temperature": 0.7,
      "maxTokens": 512
    }
  }
}
```
