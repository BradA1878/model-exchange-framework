# Tasks API

Detailed reference for all `/tasks` endpoints.

## Create Task
**POST** `/tasks`
- **Auth:** JWT
- **Body:** `CreateTaskRequest`

```json
{
  "channelId": "string",        // required
  "title": "string",            // required
  "description": "string",      // required
  "priority": "low|medium|high",// optional, default: medium
  "dueDate": "ISO timestamp",   // optional
  "tags": ["string"],           // optional
  "assignedAgentId": "string"   // optional
}
```

- **Response (201):**

```json
{
  "success": true,
  "data": { /* Task object */ }
}
```

## List Tasks
**GET** `/tasks`
- **Auth:** JWT
- **Description:** Retrieve tasks with optional filters.
- **Query Params:**
  - `channelId` (string)
  - `status` (string or string[])
  - `priority` (string or string[])
  - `assignedAgentId` (string)
  - `createdBy` (string)
  - `tags` (string[])
  - `dueBefore` (timestamp)
  - `dueAfter` (timestamp)

- **Response (200):**

```json
{
  "success": true,
  "data": [ /* array of Task objects */ ],
  "count": 10
}
```

## Get Task by ID
**GET** `/tasks/:taskId`
- **Auth:** JWT
- **Params:** `taskId` (string)

- **Response (200):**

```json
{
  "success": true,
  "data": { /* Task object */ }
}
```

## Update Task
**PATCH** `/tasks/:taskId`
- **Auth:** JWT
- **Body:** `UpdateTaskRequest`

```json
{
  "title": "string",
  "description": "string",
  "status": "TaskStatus",
  "priority": "TaskPriority",
  "dueDate": "ISO timestamp",
  "tags": ["string"],
  "assignedAgentId": "string"
}
```

- **Response (200):**

```json
{
  "success": true,
  "data": { /* updated Task object */ }
}
```

## Assign Task (Manual)
**POST** `/tasks/:taskId/assign`
- **Auth:** JWT
- **Params:** `taskId` (string)
- **Description:** Assigns a task manually to the specified agent.
- **Body:**

```json
{
  "agentId": "string"
}
```

- **Response (200):**

```json
{
  "success": true,
  "data": {
    "taskId": "string",
    "assignedAgentId": "string",
    "strategy": "manual",
    "assignedAt": "ISO timestamp"
  }
}
```

## Assign Task (Intelligent)
**POST** `/tasks/:taskId/assign-intelligent`
- **Auth:** JWT
- **Params:** `taskId` (string)

- **Response (200):**

```json
{
  "success": true,
  "data": {
    "taskId": "string",
    "assignedAgentId": "string",
    "strategy": "intelligent",
    "confidence": 0.87,
    "reasoning": "string",
    "assignedAt": "ISO timestamp"
  }
}
```

## Workload Analysis
**GET** `/tasks/analysis/workload/:channelId`
- **Auth:** JWT
- **Description:** Trigger and retrieve workload analysis for a channel.

- **Response (200):**

```json
{
  "success": true,
  "message": "Workload analysis triggered internally by TaskService orchestration"
}
```

## List Tasks by Channel
**GET** `/tasks/channel/:channelId`
- **Auth:** JWT
- **Params:** `channelId` (string)
- **Description:** Lists all tasks for a given channel.

- **Response (200):**

```json
{
  "success": true,
  "data": [ /* array of Task objects */ ],
  "count": 5
}
```

## List Tasks by Agent
**GET** `/tasks/agent/:agentId`
- **Auth:** JWT
- **Params:** `agentId` (string)
- **Description:** Lists all tasks assigned to the specified agent.

- **Response (200):**

```json
{
  "success": true,
  "data": [ /* array of Task objects */ ],
  "count": 3
}
