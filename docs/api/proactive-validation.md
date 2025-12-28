# Proactive Validation API

The Proactive Validation API provides pre-execution validation capabilities, real-time parameter hints, and advanced error prediction. This system is designed for low-latency operation while providing comprehensive validation for all tool executions.

## Overview

The Proactive Validation System includes:
- Pre-execution validation with risk assessment
- Real-time parameter hints and auto-completion
- ML-based error prediction with pattern learning
- Multi-level caching for optimal performance
- Risk-based validation levels (ASYNC, BLOCKING, STRICT)

## Pre-execution Validation

### Validate Tool Call

**POST** `/api/validation/preview`

Preview validation results before executing a tool call.

**Request:**
```json
{
    "toolName": "file_write",
    "parameters": {
        "path": "/tmp/test.txt",
        "content": "Hello World"
    },
    "validationLevel": "STRICT",
    "includeHints": true,
    "includeRiskAssessment": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "valid": true,
        "validationLevel": "STRICT",
        "processingTime": 47,
        "cacheHit": false,
        "schemaValidation": {
            "passed": true,
            "errors": []
        },
        "businessLogicValidation": {
            "passed": true,
            "warnings": []
        },
        "riskAssessment": {
            "overallRisk": "LOW",
            "riskScore": 0.23,
            "factors": [
                {
                    "name": "file_operation",
                    "weight": 0.3,
                    "score": 0.1,
                    "reason": "Safe file path in temporary directory"
                }
            ],
            "mitigationStrategies": []
        },
        "predictions": {
            "errorProbability": 0.05,
            "predictedErrors": [],
            "confidence": 0.92
        },
        "suggestions": [
            "Consider adding file extension validation",
            "Path appears safe for write operations"
        ]
    }
}
```

### Get Parameter Hints

**POST** `/api/validation/hints`

Get real-time parameter hints and auto-completion suggestions.

**Request:**
```json
{
    "toolName": "web_search",
    "currentParameters": {
        "query": "TypeScript"
    },
    "cursorPosition": {
        "parameter": "query",
        "position": 10
    },
    "includeDocumentation": true,
    "includeExamples": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "toolName": "web_search",
        "parameterHints": [
            {
                "parameter": "maxResults",
                "type": "number",
                "description": "Maximum number of search results to return",
                "default": 10,
                "constraints": {
                    "min": 1,
                    "max": 100
                }
            },
            {
                "parameter": "language",
                "type": "string", 
                "description": "Language preference for search results",
                "enum": ["en", "es", "fr", "de"],
                "default": "en"
            }
        ],
        "completions": [
            "TypeScript tutorial",
            "TypeScript best practices",
            "TypeScript documentation"
        ],
        "documentation": {
            "query": {
                "description": "Search query string",
                "examples": [
                    "machine learning algorithms",
                    "react hooks tutorial",
                    "python data visualization"
                ],
                "tips": [
                    "Use specific keywords for better results",
                    "Include context for more relevant results"
                ]
            }
        },
        "patternSuggestions": [
            {
                "pattern": "TypeScript {topic}",
                "confidence": 0.87,
                "usageCount": 45,
                "description": "Common pattern for TypeScript topics"
            }
        ]
    }
}
```

## Validation Configuration

### Get Validation Configuration

**GET** `/api/validation/config`

Retrieve current validation system configuration.

**Response:**
```json
{
    "success": true,
    "data": {
        "configuration": {
            "enabled": true,
            "defaultValidationLevel": "ASYNC",
            "maxValidationLatency": 50,
            "cacheEnabled": true,
            "riskAssessmentEnabled": true,
            "predictionEnabled": true,
            "validationLevels": {
                "LOW_RISK": "ASYNC",
                "MEDIUM_RISK": "BLOCKING", 
                "HIGH_RISK": "STRICT"
            },
            "cacheSettings": {
                "memoryCache": {
                    "enabled": true,
                    "maxSize": "100MB",
                    "ttl": 300000
                },
                "redisCache": {
                    "enabled": false,
                    "ttl": 1800000
                },
                "mongoCache": {
                    "enabled": true,
                    "ttl": 604800000
                }
            },
            "predictionSettings": {
                "modelVersion": "1.2.0",
                "confidenceThreshold": 0.7,
                "enableRealTimePrediction": true,
                "retrainInterval": 3600000
            }
        },
        "lastUpdated": "2024-01-20T10:30:00Z"
    }
}
```

### Update Validation Configuration

**PUT** `/api/validation/config`

Update validation system configuration.

**Request:**
```json
{
    "settings": {
        "defaultValidationLevel": "BLOCKING",
        "maxValidationLatency": 75,
        "cacheEnabled": true,
        "predictionEnabled": true,
        "cacheSettings": {
            "memoryCache": {
                "maxSize": "150MB",
                "ttl": 600000
            }
        }
    },
    "reason": "Increased latency budget for more thorough validation"
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "configurationUpdated": true,
        "changes": [
            "Default validation level changed from ASYNC to BLOCKING",
            "Max validation latency increased from 50ms to 75ms",
            "Memory cache TTL increased from 5 minutes to 10 minutes"
        ],
        "effectiveImmediately": true,
        "timestamp": "2024-01-20T10:30:00Z"
    }
}
```

## ML-based Error Prediction

### Predict Errors

**POST** `/api/prediction/errors`

Use machine learning to predict potential errors before execution.

**Request:**
```json
{
    "toolName": "file_read",
    "parameters": {
        "path": "/nonexistent/file.txt"
    },
    "context": {
        "agentId": "agent-123",
        "channelId": "file-ops",
        "recentErrors": 2,
        "systemLoad": 0.45
    },
    "includeConfidence": true,
    "includePreventionSuggestions": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "predictions": {
            "errorProbability": 0.85,
            "confidence": 0.91,
            "predictedErrors": [
                {
                    "type": "file_not_found",
                    "probability": 0.82,
                    "message": "File likely does not exist at specified path",
                    "confidence": 0.89
                },
                {
                    "type": "permission_denied",
                    "probability": 0.12,
                    "message": "Possible permission issues with file access",
                    "confidence": 0.67
                }
            ],
            "riskFactors": [
                {
                    "factor": "path_pattern",
                    "weight": 0.4,
                    "score": 0.9,
                    "description": "Path pattern matches known problematic paths"
                },
                {
                    "factor": "recent_agent_errors",
                    "weight": 0.3,
                    "score": 0.6,
                    "description": "Agent has recent errors with file operations"
                }
            ]
        },
        "preventionSuggestions": [
            "Check file existence before attempting to read",
            "Use absolute paths when possible",
            "Validate file permissions for the executing agent",
            "Consider using a fallback file or error handling"
        ],
        "alternativeActions": [
            {
                "tool": "list_directory",
                "parameters": {
                    "path": "/nonexistent"
                },
                "reason": "Verify directory exists before accessing files"
            },
            {
                "tool": "create_file",
                "parameters": {
                    "path": "/nonexistent/file.txt",
                    "content": ""
                },
                "reason": "Create file if it should exist"
            }
        ],
        "modelInfo": {
            "version": "1.2.0",
            "accuracy": 0.74,
            "trainingDataSize": 15000,
            "lastRetrained": "2024-01-19T14:30:00Z"
        }
    }
}
```

### Detect Anomalies

**POST** `/api/prediction/anomalies`

Detect anomalous patterns in tool usage or parameters.

**Request:**
```json
{
    "toolName": "api_call",
    "parameters": {
        "url": "https://suspicious-domain.com/api",
        "method": "POST",
        "data": {"key": "unusual_large_payload_data..."}
    },
    "context": {
        "agentId": "agent-456",
        "usualBehaviorPattern": "internal_api_calls",
        "timeOfDay": "03:00"
    },
    "includeDetails": true
}
```

**Response:**
```json
{
    "success": true,
    "data": {
        "anomaliesDetected": [
            {
                "type": "behavioral_anomaly",
                "severity": "HIGH",
                "confidence": 0.87,
                "description": "External API call unusual for this agent",
                "details": {
                    "factor": "domain_pattern",
                    "expected": "internal domains",
                    "actual": "external suspicious domain",
                    "deviationScore": 0.91
                }
            },
            {
                "type": "temporal_anomaly",
                "severity": "MEDIUM",
                "confidence": 0.72,
                "description": "API call at unusual time (3 AM)",
                "details": {
                    "factor": "time_pattern",
                    "expected": "business hours",
                    "actual": "early morning",
                    "deviationScore": 0.68
                }
            }
        ],
        "overallRiskScore": 0.84,
        "recommendedActions": [
            "Review API call destination for security",
            "Verify agent authorization for external calls",
            "Log activity for security audit",
            "Consider rate limiting for this agent"
        ],
        "comparisonData": {
            "similarAgents": 12,
            "normalBehaviorPatterns": [
                "api_call to internal domains during business hours",
                "small payload sizes typically < 1KB"
            ],
            "deviationMetrics": {
                "domainType": 0.95,
                "timeOfDay": 0.68,
                "payloadSize": 0.43
            }
        }
    }
}
```

## Performance Analytics

### Get Validation Performance Metrics

**GET** `/api/validation/performance`

Retrieve validation system performance metrics.

**Query Parameters:**
- `timeRange` (string) - Time range (1h, 24h, 7d, 30d) (default: 24h)
- `includeBreakdown` (boolean) - Include per-tool breakdown (default: true)
- `includeTrends` (boolean) - Include trend analysis (default: false)

**Response:**
```json
{
    "success": true,
    "data": {
        "timeRange": {
            "start": "2024-01-19T10:30:00Z",
            "end": "2024-01-20T10:30:00Z",
            "duration": "24 hours"
        },
        "overallMetrics": {
            "totalValidations": 15847,
            "averageLatency": 42,
            "p95Latency": 78,
            "p99Latency": 145,
            "cacheHitRate": 0.73,
            "errorPreventionCount": 234,
            "falsePositiveRate": 0.018,
            "validationSuccessRate": 0.97
        },
        "latencyBreakdown": {
            "schemaValidation": 15,
            "businessLogicValidation": 18,
            "riskAssessment": 9,
            "cacheAccess": 3,
            "total": 45
        },
        "cachePerformance": {
            "memoryCache": {
                "hitRate": 0.89,
                "avgAccessTime": 1.2,
                "size": "87MB",
                "evictionRate": 0.05
            },
            "mongoCache": {
                "hitRate": 0.45,
                "avgAccessTime": 18.7,
                "size": "2.3GB"
            }
        },
        "validationLevelMetrics": {
            "ASYNC": {
                "count": 12456,
                "avgLatency": 32,
                "successRate": 0.98
            },
            "BLOCKING": {
                "count": 2891,
                "avgLatency": 67,
                "successRate": 0.95
            },
            "STRICT": {
                "count": 500,
                "avgLatency": 134,
                "successRate": 0.92
            }
        },
        "toolBreakdown": [
            {
                "toolName": "file_read",
                "validationCount": 2456,
                "avgLatency": 38,
                "successRate": 0.97,
                "cacheHitRate": 0.82
            },
            {
                "toolName": "api_call",
                "validationCount": 1987,
                "avgLatency": 54,
                "successRate": 0.94,
                "cacheHitRate": 0.68
            }
        ]
    }
}
```

### Get System Bottlenecks

**GET** `/api/optimization/bottlenecks`

Detect performance bottlenecks in the validation system.

**Response:**
```json
{
    "success": true,
    "data": {
        "bottlenecksDetected": [
            {
                "type": "CACHE_MISS_RATE",
                "severity": "MEDIUM",
                "impact": 0.67,
                "description": "Memory cache miss rate above threshold",
                "metrics": {
                    "current": 0.31,
                    "threshold": 0.25,
                    "trend": "increasing"
                },
                "recommendations": [
                    "Increase memory cache size from 100MB to 150MB",
                    "Adjust cache TTL for frequently used patterns",
                    "Consider cache warming strategies"
                ]
            },
            {
                "type": "VALIDATION_LATENCY",
                "severity": "LOW",
                "impact": 0.23,
                "description": "Average validation latency approaching target",
                "metrics": {
                    "current": 47,
                    "target": 50,
                    "trend": "stable"
                },
                "recommendations": [
                    "Monitor closely as approaching limit",
                    "Consider optimizing business logic validation"
                ]
            }
        ],
        "systemHealth": {
            "overall": "GOOD",
            "components": {
                "validationEngine": "EXCELLENT",
                "cacheSystem": "GOOD",
                "predictionService": "EXCELLENT",
                "riskAssessment": "GOOD"
            }
        },
        "optimizationOpportunities": [
            {
                "area": "cache_configuration",
                "potentialImprovement": "15% latency reduction",
                "effort": "LOW",
                "description": "Tune cache sizes and TTL values"
            },
            {
                "area": "parallel_validation",
                "potentialImprovement": "25% throughput increase",
                "effort": "MEDIUM",
                "description": "Enable parallel validation for independent checks"
            }
        ]
    }
}
```

## Real-time Monitoring

### Polling for Validation Metrics

For real-time validation monitoring, poll the metrics endpoints:

```typescript
// Poll validation metrics
const pollValidationMetrics = async (): Promise<void> => {
    const response = await fetch('http://localhost:3001/api/proactive-validation/metrics', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json'
        }
    });
    
    const metrics = await response.json();
    console.log('Validation metrics:', {
        successRate: metrics.successRate,
        averageLatency: metrics.averageLatency,
        cacheHitRate: metrics.cacheHitRate,
        validationsToday: metrics.validationsToday
    });
};

// Poll every 5 seconds
setInterval(pollValidationMetrics, 5000);
```

### Performance Alerts

Monitor for performance threshold violations:

```typescript
const checkPerformanceAlerts = async (): Promise<void> => {
    const response = await fetch('http://localhost:3001/api/proactive-validation/alerts', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json'
        }
    });
    
    const alerts = await response.json();
    alerts.data.forEach(alert => {
        if (alert.severity === 'high' || alert.severity === 'critical') {
            console.warn('Performance alert:', {
                type: alert.type,
                severity: alert.severity,
                message: alert.message,
                metrics: alert.metrics
            });
        }
    });
};
```

## Error Handling

### Common Error Codes

- `VALIDATION_SERVICE_UNAVAILABLE` - Validation service is not available
- `INVALID_VALIDATION_LEVEL` - Invalid validation level specified
- `PREDICTION_SERVICE_UNAVAILABLE` - ML prediction service is not available
- `CACHE_SERVICE_ERROR` - Cache service error
- `VALIDATION_TIMEOUT` - Validation exceeded time limit
- `INVALID_TOOL_SCHEMA` - Tool schema not found or invalid
- `CONFIGURATION_ERROR` - Invalid configuration provided

### Error Response Format

```json
{
    "success": false,
    "error": {
        "code": "VALIDATION_TIMEOUT",
        "message": "Validation exceeded maximum allowed time of 50ms",
        "details": {
            "toolName": "complex_analysis",
            "actualLatency": 87,
            "maxAllowed": 50,
            "validationLevel": "STRICT"
        },
        "suggestions": [
            "Consider using ASYNC validation level for this tool",
            "Check if tool schema is overly complex",
            "Review system load and cache performance"
        ]
    }
}
```

## Integration with Auto-Correction

The Proactive Validation API works seamlessly with the Auto-Correction system:

- Failed validations trigger auto-correction attempts
- Correction patterns improve validation accuracy
- Prediction models learn from correction outcomes
- Risk assessments inform correction strategies

## Best Practices

1. **Validation Level Selection**: Choose appropriate levels based on operation risk
2. **Cache Optimization**: Monitor cache hit rates and adjust TTL values
3. **Performance Monitoring**: Track latency metrics and set appropriate alerts
4. **Prediction Accuracy**: Regularly evaluate ML model performance
5. **Configuration Tuning**: Adjust settings based on system behavior and requirements

## See Also

- [Auto-Correction API](auto-correction.md) - Error correction and recovery
- [Validation Analytics API](validation-analytics.md) - Pattern learning and metrics
- [MCP API](mcp.md) - Tool execution and validation integration
- [WebSocket Events](websocket.md) - Real-time validation events