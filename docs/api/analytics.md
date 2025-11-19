# Analytics API

Detailed reference for all `/analytics` endpoints.

**Enhanced in Phase 3:** The analytics system now includes validation-aware metrics and pattern learning insights. See [Validation Analytics API](validation-analytics.md) for comprehensive validation and pattern learning endpoints.

**📊 For comprehensive analytics documentation, see the [Analytics & Metrics Guide](../analytics/index.md) which covers task effectiveness, validation analytics, performance optimization, and MCP tools.**

---

## System Stats
**GET** `/analytics/stats`
- **Auth:** JWT
- **Description:** Retrieve overall system statistics.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "userCount": 123,
    "channelCount": 45,
    "taskCount": 678,
    "agentCount": 9,
    "uptime": "123h45m"
  }
}
```

---

## Event Logs
**GET** `/analytics/events`
- **Auth:** JWT
- **Description:** Fetch logged events across the system.
- **Query Params:**
  - `startDate` (ISO timestamp) — optional
  - `endDate` (ISO timestamp) — optional
  - `limit` (number) — optional, default: 100

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "eventType": "CHANNEL_CREATED",
      "timestamp": "ISO timestamp",
      "payload": { /* event payload */ }
    },
    /* ... */
  ]
}
```

---

## Performance Metrics
**GET** `/analytics/performance`
- **Auth:** JWT
- **Description:** Retrieve performance metrics for the API server.
- **Query Params:**
  - `startDate` (ISO timestamp) — optional
  - `endDate` (ISO timestamp) — optional

**Response (200):**
```json
{
  "success": true,
  "data": {
    "averageLatencyMs": 120,
    "requestsPerMinute": 250,
    "memoryUsageMb": 512,
    "cpuUsagePercent": 35
  }
}
```

---

## Agents Analytics
**GET** `/analytics/agents`
- **Auth:** JWT
- **Description:** Returns analytics for agents, scoped by channel.
- **Query Params:**
  - `channelId` (string) — optional, filter by channel

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "agentId": "string",
      "tasksHandled": 20,
      "averageResponseTimeMs": 150,
      "statusDistribution": {
        "ACTIVE": 10,
        "IDLE": 5,
        "ERROR": 2
      }
    }
  ]
}
```

---

## Channels Analytics
**GET** `/analytics/channels`
- **Auth:** JWT
- **Description:** Returns analytics for channels.
- **Query Params:**
  - `channelId` (string) — optional

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "channelId": "string",
      "messageCount": 1500,
      "activeUsers": 25,
      "creationDate": "ISO timestamp"
    }
  ]
}
```

---

## Tasks Analytics
**GET** `/analytics/tasks`
- **Auth:** JWT
- **Description:** Returns analytics for tasks.
- **Query Params:**
  - `channelId` (string) — optional

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "taskId": "string",
      "createdAt": "ISO timestamp",
      "completedAt": "ISO timestamp",
      "timeToCompleteMs": 3600000
    }
  ]
}
```

---

## System Health
**GET** `/analytics/system-health`
- **Auth:** JWT
- **Description:** Health check of system components.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "database": "healthy",
    "messageQueue": "healthy",
    "uptime": "123h"
  }
}
```

---

## Reports
**GET** `/analytics/reports`
- **Auth:** JWT
- **Description:** Generate and retrieve system reports.
- **Query Params:**
  - `type` (string) — optional report type (e.g., "summary", "detailed")

**Response (200):**
```json
{
  "success": true,
  "data": {
    "reportType": "summary",
    "generatedAt": "ISO timestamp",
    "content": { /* report content */ }
  }
}
```


