# Validation Analytics API

The Validation Analytics API provides access to the Phase 3 validation enhancement system, including ValidationPerformanceService and PatternLearningService. These services enable intelligent tool recommendations based on historical performance data and successful usage patterns.

**📊 For comprehensive validation analytics documentation, see the [Validation & Error Prevention Analytics Guide](../analytics/validation-analytics.md) which covers ML-based error prediction, auto-correction analytics, and pattern learning.**

## Overview

The validation analytics system tracks:
- Tool validation success rates per agent and channel
- Common validation errors and recovery patterns
- Agent performance scores and risk assessments
- Successful parameter patterns for cross-agent learning
- Failed patterns to prevent repetition

## ValidationPerformanceService API

### Get Validation Metrics

**GET** `/api/validation/metrics/:agentId/:channelId`

Retrieve validation performance metrics for a specific agent in a channel.

**Parameters:**
- `agentId` (path) - Agent identifier
- `channelId` (path) - Channel identifier

**Response:**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "channelId": "data-processing",
        "totalValidationAttempts": 245,
        "totalValidationErrors": 18,
        "validationSuccessRate": 0.927,
        "selfCorrection": {
            "attemptedCorrections": 15,
            "successfulCorrections": 12,
            "correctionSuccessRate": 0.8
        },
        "timeRange": {
            "start": "2024-01-01T00:00:00Z",
            "end": "2024-01-20T15:30:00Z"
        },
        "lastUpdated": "2024-01-20T15:30:00Z"
    }
}
```

### Get Enhanced Tool Metrics

**GET** `/api/validation/tools/:agentId/:channelId`

Get detailed validation metrics for tools used by an agent in a specific channel.

**Response:**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "channelId": "data-processing",
        "toolValidationSuccessRates": {
            "read_file": 0.98,
            "write_file": 0.92,
            "data_analyzer": 0.87
        },
        "commonValidationErrors": {
            "read_file": ["File not found", "Permission denied"],
            "write_file": ["Invalid path", "Content type mismatch"],
            "data_analyzer": ["Missing required parameter: dataset"]
        },
        "helpTriggeringTools": ["data_analyzer", "complex_query"],
        "parameterCorrections": [
            {
                "tool": "write_file",
                "originalError": "Expected string but received number",
                "correctedParameters": {
                    "content": "converted to string"
                },
                "successRate": 0.94
            }
        ],
        "averageRecoveryTimes": {
            "read_file": 1500,
            "write_file": 2300,
            "data_analyzer": 4500
        }
    }
}
```

### Analyze Validation Performance

**POST** `/api/validation/analyze/:agentId/:channelId`

Get comprehensive validation performance analysis with recommendations.

**Response:**
```json
{
    "success": true,
    "data": {
        "agentId": "agent-123",
        "channelId": "data-processing",
        "validationHealthScore": 0.87,
        "performanceLevel": "good",
        "riskFactors": [
            {
                "factor": "High error rate with data_analyzer tool",
                "severity": "medium",
                "impact": "Delays in data processing workflows"
            }
        ],
        "recommendations": [
            {
                "priority": "high",
                "action": "Use tool_help before executing data_analyzer",
                "tools": ["tool_help", "tools_validate"],
                "expectedImprovement": 0.15
            },
            {
                "priority": "medium", 
                "action": "Study successful parameter patterns",
                "tools": ["tools_recommend"],
                "expectedImprovement": 0.08
            }
        ],
        "trendAnalysis": {
            "direction": "improving",
            "changeRate": 0.03,
            "period": "last_7_days"
        }
    }
}
```

### Track Validation Event

**POST** `/api/validation/track`

Track a validation event (success or failure) for learning purposes.

**Request:**
```json
{
    "agentId": "agent-123",
    "channelId": "data-processing",
    "toolName": "read_file",
    "eventType": "success",
    "parameters": {
        "path": "/data/sales_2024.csv"
    },
    "executionTime": 1234,
    "validationDetails": {
        "schemaValidation": "passed",
        "parameterValidation": "passed"
    }
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "eventId": "evt-456789",
        "stored": true,
        "impactOnMetrics": {
            "successRateChange": 0.001,
            "newTotalAttempts": 246
        }
    }
}
```

## PatternLearningService API

### Get Enhanced Patterns

**GET** `/api/patterns/:channelId/:toolName`

Retrieve successful and failed parameter patterns for a tool in a channel.

**Query Parameters:**
- `includeShared` (boolean) - Include patterns from other agents (default: false)
- `limit` (number) - Maximum patterns to return (default: 50)

**Response:**
```json
{
    "success": true,
    "data": {
        "toolName": "read_file",
        "channelId": "data-processing",
        "successful": [
            {
                "parameters": {
                    "path": "/data/sales_2024.csv"
                },
                "frequency": 15,
                "confidenceScore": 0.92,
                "lastUsed": "2024-01-20T10:30:00Z",
                "agentId": "agent-123",
                "context": "sales data analysis"
            },
            {
                "parameters": {
                    "path": "/reports/quarterly_summary.json"
                },
                "frequency": 8,
                "confidenceScore": 0.88,
                "lastUsed": "2024-01-19T14:15:00Z",
                "agentId": "agent-456",
                "context": "report generation"
            }
        ],
        "failed": [
            {
                "parameters": {
                    "path": "/nonexistent/file.txt"
                },
                "errorType": "file_not_found",
                "frequency": 3,
                "lastOccurrence": "2024-01-18T09:45:00Z",
                "commonError": "ENOENT: no such file or directory"
            }
        ],
        "totalPatterns": 23,
        "includeShared": false
    }
}
```

### Get Pattern Recommendations

**GET** `/api/patterns/recommendations/:agentId/:channelId/:toolName`

Get AI-generated parameter recommendations based on successful patterns.

**Response:**
```json
{
    "success": true,
    "data": {
        "toolName": "read_file",
        "agentId": "agent-123",
        "channelId": "data-processing",
        "recommendations": [
            {
                "confidence": 0.89,
                "reason": "Similar agents used this pattern successfully 15 times",
                "parameters": {
                    "path": "/data/*.csv"
                },
                "supportingEvidence": {
                    "usageCount": 15,
                    "successRate": 0.93,
                    "similarAgents": 3
                }
            },
            {
                "confidence": 0.76,
                "reason": "Pattern works well for quarterly reporting tasks",
                "parameters": {
                    "path": "/reports/quarterly_*.json"  
                },
                "supportingEvidence": {
                    "usageCount": 8,
                    "successRate": 0.88,
                    "similarAgents": 2
                }
            }
        ],
        "totalRecommendations": 2,
        "generatedAt": "2024-01-20T15:45:00Z"
    }
}
```

### Store Success Pattern

**POST** `/api/patterns/success`

Store a successful parameter pattern for future recommendations.

**Request:**
```json
{
    "agentId": "agent-123",
    "channelId": "data-processing",
    "toolName": "write_file",
    "parameters": {
        "path": "/output/processed_data.json",
        "content": "{\"results\": [...]}",
        "mode": "w"
    },
    "context": "data processing output",
    "executionTime": 892
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "patternId": "pat-789012",
        "stored": true,
        "confidenceScore": 0.75,
        "isNewPattern": true,
        "similarPatterns": 2
    }
}
```

### Store Failed Pattern

**POST** `/api/patterns/failure`

Store a failed parameter pattern to learn from mistakes.

**Request:**
```json
{
    "agentId": "agent-123", 
    "channelId": "data-processing",
    "toolName": "write_file",
    "parameters": {
        "path": "/output/report.txt",
        "content": 12345
    },
    "errorType": "type_mismatch",
    "errorMessage": "Expected string but received number for parameter: content"
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "failurePatternId": "fail-345678",
        "stored": true,
        "errorType": "type_mismatch",
        "preventionTips": [
            "Ensure content parameter is a string",
            "Use String() conversion for numbers",
            "Validate parameter types before execution"
        ]
    }
}
```

### Update Pattern Configuration

**PUT** `/api/patterns/config`

Update pattern learning configuration settings.

**Request:**
```json
{
    "enablePatternSharing": true,
    "sharingConfidenceThreshold": 0.7,
    "maxPatternsPerTool": 50,
    "patternExpirationDays": 30,
    "crossAgentLearning": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "configUpdated": true,
        "activeSettings": {
            "enablePatternSharing": true,
            "sharingConfidenceThreshold": 0.7,
            "maxPatternsPerTool": 50,
            "patternExpirationDays": 30,
            "crossAgentLearning": true
        }
    }
}
```

## WebSocket Events

### Validation Events

```javascript
// Listen for validation performance updates
socket.on('validation:performance:update', (data) => {
    console.log('Validation metrics updated:', data);
    // data: { agentId, channelId, newMetrics, trend }
});

// Listen for pattern learning events  
socket.on('patterns:learned', (data) => {
    console.log('New pattern learned:', data);
    // data: { toolName, pattern, confidence, agentId }
});

// Listen for validation alerts
socket.on('validation:alert', (data) => {
    console.log('Validation alert:', data);
    // data: { alertType, severity, message, recommendations }
});
```

### Real-time Analytics

```javascript
// Get live validation metrics
socket.emit('validation:metrics:subscribe', {
    agentId: 'agent-123',
    channelId: 'data-processing'
});

socket.on('validation:metrics:live', (metrics) => {
    console.log('Live validation metrics:', metrics);
    // Update dashboard charts, alerts, etc.
});

// Unsubscribe from live updates
socket.emit('validation:metrics:unsubscribe', {
    agentId: 'agent-123',
    channelId: 'data-processing'  
});
```

## Error Handling

### Common Error Codes

- `VALIDATION_SERVICE_UNAVAILABLE` - ValidationPerformanceService is not available
- `PATTERN_SERVICE_UNAVAILABLE` - PatternLearningService is not available
- `INSUFFICIENT_DATA` - Not enough data to generate metrics or recommendations
- `INVALID_AGENT_CHANNEL` - Agent or channel does not exist
- `PATTERN_STORAGE_FAILED` - Failed to store pattern data

### Error Response Format

```json
{
    "success": false,
    "error": {
        "code": "VALIDATION_SERVICE_UNAVAILABLE",
        "message": "ValidationPerformanceService is currently unavailable",
        "details": {
            "service": "ValidationPerformanceService",
            "retryAfter": 30,
            "fallbackAvailable": true
        }
    }
}
```

## Integration with Meta-Tools

The validation analytics services are automatically integrated with the enhanced meta-tools:

- `tools_recommend` uses validation metrics and patterns for recommendations
- `tools_recommend_on_error` leverages failure patterns for recovery suggestions  
- All meta-tools gracefully degrade when these services are unavailable

### Configuration

Services can be configured via environment variables:

```bash
# ValidationPerformanceService
VALIDATION_PERFORMANCE_ENABLED=true
VALIDATION_METRICS_RETENTION_DAYS=30
VALIDATION_PERFORMANCE_CACHE_TTL=300

# PatternLearningService  
PATTERN_LEARNING_ENABLED=true
PATTERN_SHARING_ENABLED=true
PATTERN_CONFIDENCE_THRESHOLD=0.7
MAX_PATTERNS_PER_TOOL=50
```

## Best Practices

1. **Data Privacy**: Patterns are scoped to channels to maintain privacy
2. **Performance**: Services use caching to minimize database load
3. **Graceful Degradation**: Tools work without these services if unavailable
4. **Security**: No sensitive data is stored in parameter examples
5. **Monitoring**: Track service health and performance metrics

## Next Steps

- Review [MCP API](mcp.md) for enhanced meta-tool documentation
- See [Analytics API](analytics.md) for additional performance metrics
- Check [WebSocket Events](websocket.md) for real-time validation updates
- Explore [SDK Examples](../sdk/examples.md) for implementation guidance