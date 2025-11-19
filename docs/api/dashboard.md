# Dashboard API

API endpoints specifically designed for the MXF Dashboard interface, providing aggregated data, statistics, and dashboard-specific operations.

## Overview

The Dashboard API provides:
- Aggregated statistics and metrics
- Dashboard-specific data views
- User preferences and settings
- Quick actions and shortcuts
- Real-time dashboard updates
- Export and reporting features

## Base URL

```
http://localhost:3001/api/dashboard
```

## Authentication

All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

---

## Dashboard Overview

### Get Dashboard Summary

**GET** `/api/dashboard/summary`

Retrieve a comprehensive summary for the dashboard home page.

**Response:**
```json
{
    "success": true,
    "data": {
        "user": {
            "id": "user-123",
            "name": "John Doe",
            "email": "john@example.com",
            "role": "admin",
            "lastLogin": "2024-01-20T09:00:00Z"
        },
        "statistics": {
            "agents": {
                "total": 25,
                "online": 18,
                "offline": 5,
                "busy": 2,
                "created24h": 3
            },
            "channels": {
                "total": 12,
                "active": 10,
                "private": 8,
                "public": 4
            },
            "tasks": {
                "total": 145,
                "completed": 120,
                "inProgress": 20,
                "failed": 5,
                "completionRate": 0.83
            },
            "messages": {
                "total24h": 1523,
                "avgResponseTime": 2.5
            }
        },
        "recentActivity": [
            {
                "type": "agent_created",
                "timestamp": "2024-01-20T10:30:00Z",
                "details": {
                    "agentId": "agent-456",
                    "name": "New Research Bot"
                }
            }
        ],
        "alerts": [
            {
                "id": "alert-123",
                "severity": "warning",
                "message": "Agent 'bot-789' has been offline for 2 hours",
                "timestamp": "2024-01-20T10:00:00Z"
            }
        ]
    }
}
```

### Get Quick Stats

**GET** `/api/dashboard/stats`

Get real-time statistics for dashboard widgets.

**Query Parameters:**
- `metrics` - Comma-separated list of metrics to include
- `period` - Time period: `hour`, `day`, `week`, `month`

**Response:**
```json
{
    "success": true,
    "data": {
        "timestamp": "2024-01-20T10:45:00Z",
        "metrics": {
            "activeAgents": 18,
            "messagesPerMinute": 25.4,
            "avgTaskCompletionTime": 180,
            "systemHealth": 0.98,
            "errorRate": 0.02
        }
    }
}
```

---

## Agent Dashboard

### Get Agent Overview

**GET** `/api/dashboard/agents`

Retrieve agent data formatted for dashboard display.

**Query Parameters:**
- `view` - Display view: `grid`, `list`, `detailed`
- `sort` - Sort by: `name`, `status`, `activity`, `created`
- `filter` - JSON filter object

**Response:**
```json
{
    "success": true,
    "data": {
        "agents": [
            {
                "agentId": "agent-123",
                "name": "Research Assistant",
                "status": "online",
                "statusColor": "green",
                "avatar": "/avatars/agent-123.png",
                "role": "assistant",
                "channel": {
                    "id": "channel-456",
                    "name": "Research Team"
                },
                "metrics": {
                    "uptime": "99.5%",
                    "tasksCompleted": 45,
                    "avgResponseTime": "1.2s",
                    "satisfaction": 4.8
                },
                "lastActivity": {
                    "type": "message_sent",
                    "timestamp": "2024-01-20T10:30:00Z",
                    "description": "Responded to query"
                }
            }
        ],
        "summary": {
            "total": 25,
            "byStatus": {
                "online": 18,
                "offline": 5,
                "busy": 2
            },
            "byRole": {
                "assistant": 15,
                "moderator": 5,
                "specialist": 5
            }
        }
    }
}
```

### Get Agent Performance

**GET** `/api/dashboard/agents/:agentId/performance`

Get detailed performance metrics for an agent.

**Query Parameters:**
- `period` - Time period for metrics
- `compare` - Compare with previous period

**Response:**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "period": "week",
        "metrics": {
            "availability": {
                "value": 0.98,
                "change": 0.02,
                "trend": "up"
            },
            "responseTime": {
                "avg": 1.5,
                "p50": 1.2,
                "p95": 3.5,
                "p99": 5.2
            },
            "taskMetrics": {
                "completed": 234,
                "failed": 2,
                "avgDuration": 180,
                "successRate": 0.99
            },
            "interactions": {
                "total": 567,
                "byType": {
                    "query": 400,
                    "task": 100,
                    "conversation": 67
                }
            }
        },
        "comparison": {
            "previousPeriod": {
                "availability": 0.96,
                "tasksCompleted": 210
            }
        }
    }
}
```

---

## Channel Dashboard

### Get Channel Overview

**GET** `/api/dashboard/channels`

Retrieve channel data for dashboard display.

**Response:**
```json
{
    "success": true,
    "data": {
        "channels": [
            {
                "channelId": "channel-456",
                "name": "Research Team",
                "type": "private",
                "icon": "research",
                "color": "#4A90E2",
                "participants": {
                    "count": 12,
                    "online": 8,
                    "avatars": ["/avatar1.png", "/avatar2.png"]
                },
                "activity": {
                    "level": "high",
                    "messagesLast24h": 234,
                    "tasksActive": 5
                },
                "health": {
                    "status": "healthy",
                    "score": 0.95,
                    "issues": []
                }
            }
        ],
        "insights": {
            "mostActive": "channel-456",
            "fastestGrowing": "channel-789",
            "needsAttention": ["channel-012"]
        }
    }
}
```

### Get Channel Activity Feed

**GET** `/api/dashboard/channels/:channelId/activity`

Get real-time activity feed for a channel.

**Query Parameters:**
- `limit` - Number of activities
- `since` - Activities since timestamp

**Response:**
```json
{
    "success": true,
    "data": {
        "activities": [
            {
                "id": "act-123",
                "type": "task_completed",
                "timestamp": "2024-01-20T10:30:00Z",
                "actor": {
                    "type": "agent",
                    "id": "agent-123",
                    "name": "Research Bot"
                },
                "details": {
                    "taskId": "task-456",
                    "taskName": "Analyze market data",
                    "duration": 120
                },
                "impact": "positive"
            }
        ]
    }
}
```

---

## Task Dashboard

### Get Task Overview

**GET** `/api/dashboard/tasks`

Get task statistics and active tasks for dashboard.

**Response:**
```json
{
    "success": true,
    "data": {
        "summary": {
            "total": 145,
            "byStatus": {
                "pending": 25,
                "assigned": 15,
                "inProgress": 20,
                "completed": 80,
                "failed": 5
            },
            "byPriority": {
                "urgent": 5,
                "high": 20,
                "normal": 100,
                "low": 20
            }
        },
        "trends": {
            "completionRate": {
                "current": 0.85,
                "previous": 0.82,
                "change": 0.03
            },
            "avgCompletionTime": {
                "current": 180,
                "previous": 200,
                "change": -20
            }
        },
        "activeTasks": [
            {
                "taskId": "task-789",
                "name": "Generate weekly report",
                "priority": "high",
                "assignee": {
                    "agentId": "agent-123",
                    "name": "Report Bot"
                },
                "progress": 65,
                "estimatedCompletion": "2024-01-20T12:00:00Z",
                "status": {
                    "state": "in_progress",
                    "color": "blue",
                    "message": "Processing data..."
                }
            }
        ]
    }
}
```

### Get Task Timeline

**GET** `/api/dashboard/tasks/timeline`

Get task execution timeline for visualization.

**Query Parameters:**
- `channelId` - Filter by channel
- `agentId` - Filter by agent
- `from` - Start date
- `to` - End date

**Response:**
```json
{
    "success": true,
    "data": {
        "timeline": [
            {
                "taskId": "task-123",
                "name": "Data Analysis",
                "start": "2024-01-20T09:00:00Z",
                "end": "2024-01-20T09:30:00Z",
                "duration": 1800,
                "agent": "agent-123",
                "status": "completed",
                "color": "#4CAF50"
            }
        ],
        "statistics": {
            "totalDuration": 7200,
            "parallelExecution": 0.75,
            "bottlenecks": ["task-456"]
        }
    }
}
```

---

## Analytics Dashboard

### Get Analytics Overview

**GET** `/api/dashboard/analytics`

Comprehensive analytics for dashboard visualization.

**Query Parameters:**
- `period` - Analysis period
- `granularity` - Data granularity: `hour`, `day`, `week`

**Response:**
```json
{
    "success": true,
    "data": {
        "period": {
            "start": "2024-01-13T00:00:00Z",
            "end": "2024-01-20T00:00:00Z"
        },
        "kpis": {
            "systemUptime": {
                "value": 0.995,
                "target": 0.99,
                "status": "above_target"
            },
            "avgResponseTime": {
                "value": 1.8,
                "target": 2.0,
                "status": "on_target"
            },
            "taskSuccessRate": {
                "value": 0.92,
                "target": 0.90,
                "status": "above_target"
            }
        },
        "charts": {
            "messageVolume": {
                "labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                "datasets": [{
                    "label": "Messages",
                    "data": [1200, 1350, 1100, 1500, 1600, 800, 600]
                }]
            },
            "agentUtilization": {
                "labels": ["00:00", "06:00", "12:00", "18:00"],
                "datasets": [{
                    "label": "Utilization %",
                    "data": [20, 45, 80, 60]
                }]
            }
        }
    }
}
```

### Get Performance Heatmap

**GET** `/api/dashboard/analytics/heatmap`

Get performance heatmap data for visualization.

**Query Parameters:**
- `metric` - Metric to visualize
- `resolution` - Grid resolution

**Response:**
```json
{
    "success": true,
    "data": {
        "metric": "response_time",
        "grid": [
            {
                "hour": 0,
                "day": 0,
                "value": 1.2,
                "intensity": 0.3
            }
        ],
        "scale": {
            "min": 0.5,
            "max": 5.0,
            "unit": "seconds"
        }
    }
}
```

---

## User Preferences

### Get Dashboard Preferences

**GET** `/api/dashboard/preferences`

Get user's dashboard preferences.

**Response:**
```json
{
    "success": true,
    "data": {
        "theme": "dark",
        "language": "en",
        "timezone": "America/New_York",
        "layout": {
            "defaultView": "grid",
            "sidebarCollapsed": false,
            "widgetOrder": ["stats", "agents", "tasks", "activity"]
        },
        "notifications": {
            "desktop": true,
            "email": true,
            "frequency": "realtime"
        },
        "widgets": {
            "stats": {
                "visible": true,
                "metrics": ["activeAgents", "taskCompletion", "errorRate"]
            }
        }
    }
}
```

### Update Dashboard Preferences

**PUT** `/api/dashboard/preferences`

Update user's dashboard preferences.

**Request Body:**
```json
{
    "theme": "light",
    "layout": {
        "defaultView": "list"
    },
    "notifications": {
        "desktop": false
    }
}
```

---

## Quick Actions

### Get Available Actions

**GET** `/api/dashboard/actions`

Get quick actions available to the user.

**Response:**
```json
{
    "success": true,
    "data": {
        "actions": [
            {
                "id": "create_agent",
                "label": "Create New Agent",
                "icon": "plus",
                "color": "primary",
                "endpoint": "/api/agents",
                "method": "POST",
                "requiredFields": ["name", "channelId"]
            },
            {
                "id": "restart_all_agents",
                "label": "Restart All Agents",
                "icon": "refresh",
                "color": "warning",
                "confirmation": "Are you sure you want to restart all agents?",
                "endpoint": "/api/dashboard/actions/restart-all",
                "method": "POST"
            }
        ]
    }
}
```

### Execute Quick Action

**POST** `/api/dashboard/actions/:actionId`

Execute a quick action.

**Request Body:**
```json
{
    "parameters": {
        "channelId": "channel-456"
    },
    "confirm": true
}
```

---

## Alerts and Notifications

### Get Dashboard Alerts

**GET** `/api/dashboard/alerts`

Get active alerts for dashboard display.

**Query Parameters:**
- `severity` - Filter by severity: `info`, `warning`, `error`, `critical`
- `acknowledged` - Include acknowledged alerts

**Response:**
```json
{
    "success": true,
    "data": {
        "alerts": [
            {
                "id": "alert-123",
                "type": "agent_offline",
                "severity": "warning",
                "title": "Agent Offline",
                "message": "Agent 'bot-789' has been offline for 2 hours",
                "timestamp": "2024-01-20T10:00:00Z",
                "acknowledged": false,
                "actions": [
                    {
                        "label": "Restart Agent",
                        "action": "restart_agent",
                        "params": { "agentId": "bot-789" }
                    }
                ]
            }
        ],
        "summary": {
            "total": 5,
            "bySeverity": {
                "critical": 0,
                "error": 1,
                "warning": 3,
                "info": 1
            }
        }
    }
}
```

### Acknowledge Alert

**POST** `/api/dashboard/alerts/:alertId/acknowledge`

Acknowledge an alert.

**Request Body:**
```json
{
    "note": "Investigating the issue"
}
```

---

## Export and Reports

### Generate Report

**POST** `/api/dashboard/reports/generate`

Generate a dashboard report.

**Request Body:**
```json
{
    "type": "weekly_summary",
    "format": "pdf",
    "sections": ["agents", "tasks", "analytics"],
    "period": {
        "from": "2024-01-13",
        "to": "2024-01-20"
    },
    "recipients": ["admin@example.com"]
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "reportId": "report-123",
        "status": "generating",
        "estimatedTime": 30,
        "downloadUrl": "/api/dashboard/reports/report-123/download"
    }
}
```

### Get Report Status

**GET** `/api/dashboard/reports/:reportId/status`

Check report generation status.

### Download Report

**GET** `/api/dashboard/reports/:reportId/download`

Download generated report.

---

## Real-time Updates

### Subscribe to Dashboard Updates

**WebSocket** `/dashboard/subscribe`

Subscribe to real-time dashboard updates.

```javascript
// Subscribe to updates
socket.emit('dashboard:subscribe', {
    widgets: ['stats', 'agents', 'alerts'],
    updateInterval: 5000
});

// Receive updates
socket.on('dashboard:update', (update) => {
    console.log('Widget update:', update.widget, update.data);
});
```

---

## Error Responses

Standard error responses apply. See [Error Handling](../README.md#error-handling).

## Rate Limiting

- **Read Operations**: 200 per minute
- **Write Operations**: 50 per minute
- **Report Generation**: 10 per hour

## Best Practices

1. **Widget Updates**: Use WebSocket subscriptions for real-time updates
2. **Data Aggregation**: Request only needed metrics to reduce payload
3. **Caching**: Dashboard data is cached for 30 seconds
4. **Preferences**: Store user preferences to personalize experience
5. **Alerts**: Acknowledge alerts promptly to maintain dashboard clarity

## Next Steps

- See [WebSocket Events](websocket.md) for real-time subscriptions
- Review [Analytics API](analytics.md) for detailed metrics
- Check [Agents API](agents.md) for agent management
- Explore [Dashboard Guide](../dashboard/index.md) for UI documentation