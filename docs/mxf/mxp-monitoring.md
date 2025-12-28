# MXP 2.0 Monitoring & Analytics Guide

This guide provides comprehensive instructions for monitoring MXP 2.0's modular optimization suite in production environments. MXP 2.0 transforms monitoring from simple protocol metrics to a comprehensive analytics platform that tracks optimization effectiveness, cost impact, and system health across all modules.

## Overview

MXP 2.0 monitoring encompasses four key dimensions:
- **Token Optimization Analytics**: AI-driven compression effectiveness, SystemLLM performance, pattern learning success
- **Bandwidth Optimization Metrics**: Binary encoding rates, enhanced aggregation performance, EventBus integration health
- **Progressive Security Monitoring**: Security level compliance, audit logging, key rotation tracking, HSM integration
- **Real-time Cost & ROI Analytics**: LLM API cost savings, infrastructure efficiency, executive-level reporting

## MXP 2.0 Analytics Architecture

### Core Analytics Interfaces

#### Token Optimization Metrics
```typescript
interface Mxp2TokenOptimizationMetrics {
  // Overall performance
  enabled: boolean;
  totalOptimizations: number;
  totalTokensSaved: number;
  averageCompressionRatio: number;        // 0-1 (target: 0.6-0.8)
  
  // Strategy effectiveness
  strategiesUsed: {
    contextCompression: number;
    promptOptimization: number;
    conversationSummarization: number;
    entityDeduplication: number;
    toolSchemaReduction: number;
    templateMatching: number;
  };
  
  // SystemLLM integration health
  systemLlmIntegration: {
    requestsProcessed: number;
    averageProcessingTime: number;        // ms
    successRate: number;                  // % (target: >95%)
    errorCount: number;
  };
  
  // Pattern learning effectiveness
  patternLearningStats: {
    patternsStored: number;
    patternsReused: number;
    learningAccuracy: number;             // %
  };
}
```

#### Bandwidth Optimization Metrics
```typescript
interface Mxp2BandwidthOptimizationMetrics {
  // Overall performance
  enabled: boolean;
  totalBytesReduced: number;
  binaryEncodingRate: number;             // % (target: >85%)
  compressionEffectiveness: number;       // 0-1 (target: 0.7-0.9)
  
  // Enhanced aggregation stats
  aggregationStats: {
    messagesAggregated: number;
    similarityThresholdMaintained: boolean; // 80% preserved
    failsafeTriggered: number;             // 3-min timeout events
    responseAwarePreserved: boolean;       // Existing functionality
  };
  
  // EventBus integration health
  eventBusIntegration: {
    eventsProcessed: number;
    eventLatency: number;                  // ms
    priorityHandling: {
      critical: number;
      high: number;
      normal: number;
      background: number;
    };
  };
  
  // Binary encoding performance
  encodingStats: {
    averageCompressionRatio: number;
    encodingLatency: number;              // ms
    decodingLatency: number;              // ms
  };
}
```

#### Progressive Security Metrics
```typescript
interface Mxp2SecurityMetrics {
  // Security level status
  level: 'standard' | 'enhanced' | 'regulated' | 'classified';
  levelCompliance: boolean;
  
  // Key management
  keyManagement: {
    rotationInterval: number;             // seconds
    lastRotation: Date;
    rotationSuccessRate: number;          // %
    channelKeyServiceIntegration: boolean;
  };
  
  // Audit logging
  auditLogging: {
    enabled: boolean;
    eventsLogged: number;
    logIntegrity: boolean;
    complianceReports: number;
  };
  
  // HSM integration (for regulated/classified)
  hsmIntegration?: {
    connected: boolean;
    operationsPerformed: number;
    averageLatency: number;               // ms
    errorRate: number;                    // %
  };
}
```

#### Real-time Analytics & Cost Tracking
```typescript
interface Mxp2AnalyticsMetrics {
  // Cost calculation
  costCalculation: {
    enabled: boolean;
    monthlySavings: number;               // USD
    tokenReductionPercentage: number;     // % (target: 60-80%)
    bandwidthReductionPercentage: number; // % (target: 70-90%)
    providerBreakdown: Record<string, {
      savings: number;
      tokensReduced: number;
    }>;
  };
  
  // Performance tracking
  performanceTracking: {
    tokenReduction: boolean;
    bandwidthSavings: boolean;
    latencyImpact: number;                // ms (target: <5% increase)
    errorRates: number;                   // % (target: <5%)
  };
  
  // Real-time metrics
  realTimeMetrics: {
    enabled: boolean;
    updateInterval: number;               // seconds
    dashboardConnections: number;
    alertsGenerated: number;
  };
}

## MXP 2.0 Monitoring Implementation

### Event-Driven Analytics Collection

MXP 2.0 leverages the existing EventBus for real-time monitoring:

```typescript
// mxp2-analytics-collector.ts
import { EventBus } from '@mxf/core';
import { MxpConfigManager } from '@mxf/mxp';

export class MXP2AnalyticsCollector {
    private mxpManager = MxpConfigManager.getInstance();
    private metricsStorage = new Map<string, Mxp2ChannelMetrics>();
    
    constructor() {
        this.setupEventListeners();
    }
    
    private setupEventListeners(): void {
        // Token optimization events
        EventBus.server.on('mxp2.token.optimized', (event) => {
            this.recordTokenOptimization(event);
        });
        
        EventBus.server.on('mxp2.token.optimization.failed', (event) => {
            this.recordTokenOptimizationFailure(event);
        });
        
        // Bandwidth optimization events  
        EventBus.server.on('mxp2.bandwidth.encoded', (event) => {
            this.recordBandwidthOptimization(event);
        });
        
        EventBus.server.on('mxp2.bandwidth.aggregated', (event) => {
            this.recordMessageAggregation(event);
        });
        
        // Security events
        EventBus.server.on('mxp2.security.keyRotated', (event) => {
            this.recordSecurityEvent(event);
        });
        
        EventBus.server.on('mxp2.security.auditEvent', (event) => {
            this.recordAuditEvent(event);
        });
        
        // Cost calculation events
        EventBus.server.on('mxp2.analytics.costCalculated', (event) => {
            this.recordCostCalculation(event);
        });
    }
    
    private recordTokenOptimization(event: any): void {
        const channelMetrics = this.getChannelMetrics(event.channelId);
        
        channelMetrics.tokenOptimization.totalOptimizations++;
        channelMetrics.tokenOptimization.totalTokensSaved += event.tokensSaved;
        channelMetrics.tokenOptimization.strategiesUsed[event.strategy]++;
        
        // Update compression ratio (rolling average)
        const currentRatio = channelMetrics.tokenOptimization.averageCompressionRatio;
        const newRatio = event.compressionRatio;
        channelMetrics.tokenOptimization.averageCompressionRatio = 
            (currentRatio * 0.9) + (newRatio * 0.1);
            
        // SystemLLM integration stats
        if (event.systemLlmUsed) {
            channelMetrics.tokenOptimization.systemLlmIntegration.requestsProcessed++;
            channelMetrics.tokenOptimization.systemLlmIntegration.averageProcessingTime = 
                this.updateMovingAverage(
                    channelMetrics.tokenOptimization.systemLlmIntegration.averageProcessingTime,
                    event.processingTime
                );
        }
    }
    
    public getChannelMetrics(channelId: string): Mxp2ChannelMetrics {
        if (!this.metricsStorage.has(channelId)) {
            this.metricsStorage.set(channelId, this.createEmptyMetrics(channelId));
        }
        return this.metricsStorage.get(channelId)!;
    }
    
    public getAllChannelMetrics(): Record<string, Mxp2ChannelMetrics> {
        const result: Record<string, Mxp2ChannelMetrics> = {};
        for (const [channelId, metrics] of this.metricsStorage.entries()) {
            result[channelId] = metrics;
        }
        return result;
    }
    
    private updateMovingAverage(currentAvg: number, newValue: number, weight: number = 0.1): number {
        return (currentAvg * (1 - weight)) + (newValue * weight);
    }
}
```

### MXP 2.0 Dashboards & Monitoring Setup

#### Executive Dashboard Configuration

```typescript
// executive-dashboard.ts
export class MXP2ExecutiveDashboard {
    private analyticsCollector: MXP2AnalyticsCollector;
    
    constructor(analyticsCollector: MXP2AnalyticsCollector) {
        this.analyticsCollector = analyticsCollector;
    }
    
    async generateExecutiveSummary(): Promise<ExecutiveDashboardData> {
        const allChannels = this.analyticsCollector.getAllChannelMetrics();
        const aggregated = this.aggregateMetrics(allChannels);
        
        return {
            // Key Performance Indicators
            kpis: {
                monthlyCostSavings: aggregated.totalMonthlySavings,
                tokenReductionPercentage: aggregated.avgTokenReduction,
                bandwidthReductionPercentage: aggregated.avgBandwidthReduction,
                channelsOptimized: Object.keys(allChannels).length,
                systemReliability: aggregated.avgReliability
            },
            
            // Module Performance
            modules: {
                tokenOptimization: {
                    enabled: aggregated.tokenOptEnabled,
                    effectiveness: aggregated.avgTokenReduction,
                    systemLlmHealth: aggregated.systemLlmSuccessRate,
                    patternLearningActive: aggregated.patternLearningActive
                },
                bandwidthOptimization: {
                    enabled: aggregated.bandwidthOptEnabled,
                    effectiveness: aggregated.avgBandwidthReduction,
                    encodingRate: aggregated.avgBinaryEncodingRate,
                    aggregationPreserved: aggregated.aggregationPreserved
                },
                security: {
                    averageLevel: aggregated.avgSecurityLevel,
                    auditingActive: aggregated.auditingActive,
                    keyRotationHealthy: aggregated.keyRotationHealthy,
                    complianceStatus: aggregated.complianceStatus
                }
            },
            
            // Trends and Recommendations
            trends: this.calculateTrends(allChannels),
            recommendations: this.generateRecommendations(aggregated)
        };
    }
    
    private generateRecommendations(aggregated: AggregatedMetrics): string[] {
        const recommendations: string[] = [];
        
        if (aggregated.avgTokenReduction < 0.6) {
            recommendations.push("Enable additional token optimization strategies to improve reduction");
        }
        
        if (aggregated.avgBandwidthReduction < 0.7) {
            recommendations.push("Review bandwidth optimization settings to improve reduction");
        }
        
        if (aggregated.systemLlmSuccessRate < 0.95) {
            recommendations.push("Investigate SystemLLM service health for optimal token optimization");
        }
        
        if (!aggregated.patternLearningActive) {
            recommendations.push("Enable pattern learning to improve optimization effectiveness over time");
        }
        
        return recommendations;
    }
}
```

### MXP 2.0 Alert Configuration

#### Key Alert Rules for MXP 2.0

```typescript
// mxp2-alert-rules.ts
export const MXP2_ALERT_RULES = {
    // Token optimization alerts
    tokenOptimization: {
        lowPerformance: {
            condition: (metrics: Mxp2TokenOptimizationMetrics) => 
                metrics.averageCompressionRatio < 0.6,
            severity: 'warning',
            message: 'Token optimization below 60% target'
        },
        systemLlmFailure: {
            condition: (metrics: Mxp2TokenOptimizationMetrics) => 
                metrics.systemLlmIntegration.successRate < 0.95,
            severity: 'critical',
            message: 'SystemLLM integration health below 95%'
        }
    },
    
    // Bandwidth optimization alerts
    bandwidthOptimization: {
        lowPerformance: {
            condition: (metrics: Mxp2BandwidthOptimizationMetrics) => 
                metrics.compressionEffectiveness < 0.7,
            severity: 'warning',
            message: 'Bandwidth optimization below 70% target'
        },
        aggregationIssues: {
            condition: (metrics: Mxp2BandwidthOptimizationMetrics) => 
                !metrics.aggregationStats.similarityThresholdMaintained,
            severity: 'error',
            message: 'Message aggregation threshold not maintained'
        }
    },
    
    // Security alerts
    security: {
        keyRotationOverdue: {
            condition: (metrics: Mxp2SecurityMetrics) => {
                const timeSinceRotation = Date.now() - metrics.keyManagement.lastRotation.getTime();
                return timeSinceRotation > (metrics.keyManagement.rotationInterval * 1000 * 1.5);
            },
            severity: 'critical',
            message: 'Key rotation overdue - security risk'
        },
        auditFailure: {
            condition: (metrics: Mxp2SecurityMetrics) => 
                metrics.auditLogging.enabled && !metrics.auditLogging.logIntegrity,
            severity: 'critical',
            message: 'Audit log integrity compromised'
        }
    }
};
```

### Performance Benchmarks & Targets

#### MXP 2.0 Performance Targets

```typescript
export const MXP2_PERFORMANCE_TARGETS = {
    tokenOptimization: {
        compressionRatio: {
            excellent: 0.8,     // 80% reduction
            good: 0.7,          // 70% reduction  
            acceptable: 0.6,    // 60% reduction
            poor: 0.6           // Below 60%
        },
        systemLlmHealth: {
            excellent: 0.98,    // 98% success rate
            good: 0.95,         // 95% success rate
            acceptable: 0.90,   // 90% success rate
            poor: 0.90          // Below 90%
        }
    },
    
    bandwidthOptimization: {
        compressionEffectiveness: {
            excellent: 0.9,     // 90% reduction
            good: 0.8,          // 80% reduction
            acceptable: 0.7,    // 70% reduction
            poor: 0.7           // Below 70%
        },
        binaryEncodingRate: {
            excellent: 0.95,    // 95% encoding rate
            good: 0.90,         // 90% encoding rate
            acceptable: 0.85,   // 85% encoding rate
            poor: 0.85          // Below 85%
        }
    },
    
    security: {
        keyRotationCompliance: {
            excellent: 1.0,     // Always on time
            good: 0.95,         // 95% on time
            acceptable: 0.90,   // 90% on time
            poor: 0.90          // Below 90%
        },
        auditLogIntegrity: {
            excellent: 1.0,     // 100% integrity
            good: 0.999,        // 99.9% integrity
            acceptable: 0.995,  // 99.5% integrity
            poor: 0.995         // Below 99.5%
        }
    },
    
    analytics: {
        costSavingsAccuracy: {
            excellent: 0.95,    // 95% accuracy
            good: 0.90,         // 90% accuracy
            acceptable: 0.85,   // 85% accuracy
            poor: 0.85          // Below 85%
        },
        realTimeLatency: {
            excellent: 1000,    // <1s latency
            good: 5000,         // <5s latency
            acceptable: 10000,  // <10s latency
            poor: 10000         // >10s latency
        }
    }
};
```

## Best Practices for MXP 2.0 Monitoring

### 1. Event-Driven Monitoring Strategy
- **Leverage EventBus Integration**: Use existing EventBus events for real-time monitoring
- **Pattern-Based Alerting**: Set up alerts based on optimization patterns and anomalies
- **Service Health Monitoring**: Monitor integration health with SystemLLM and PatternLearning services
- **Cost-Aware Monitoring**: Track ROI and cost savings in real-time

### 2. Progressive Monitoring Implementation
- **Phase 1**: Start with analytics-only monitoring (zero impact)
- **Phase 2**: Add token optimization monitoring after enabling features
- **Phase 3**: Implement bandwidth optimization monitoring
- **Phase 4**: Add security and compliance monitoring

### 3. Integration with Existing MXF Monitoring
- **Preserve Existing Dashboards**: MXP 2.0 metrics complement existing MXF monitoring
- **EventBus Monitoring**: Ensure EventBus performance isn't impacted by MXP events
- **Service Dependencies**: Monitor SystemLLM and PatternLearning service dependencies
- **Message Aggregation**: Ensure existing 80% similarity and 3-min failsafe are preserved

### 4. Executive Reporting
- **Real-time Cost Dashboards**: Provide executive visibility into optimization ROI
- **Trend Analysis**: Track optimization effectiveness over time
- **Comparative Analysis**: Compare performance across channels and time periods
- **Actionable Recommendations**: Generate data-driven optimization recommendations

---

## Related Documentation

- **Technical Specification**: [MXP 2.0 Technical Specification](./mxp-technical-specification.md)
- **Implementation Guide**: [MXP 2.0 Implementation Guide](../tmp/mxp/mxp-2.0-implementation-guide.md)
- **Enterprise Deployment**: [MXP Enterprise Guide](./mxp-enterprise.md)
- **Protocol Architecture**: [MXP Protocol Documentation](./mxp-protocol.md)
- **Troubleshooting**: [MXP Troubleshooting Guide](./mxp-troubleshooting.md)

*Monitoring MXP 2.0 effectively? Share your dashboards and monitoring strategies to help the community optimize their multi-agent systems!*
        "type": "stat",
        "targets": [
          {
            "expr": "mxp_conversion_rate",
            "legendFormat": "Conversion Rate %"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "min": 0,
            "max": 100,
            "thresholds": {
              "steps": [
                {"color": "red", "value": 0},
                {"color": "yellow", "value": 60},
                {"color": "green", "value": 80}
              ]
            }
          }
        }
      },
      {
        "id": 2,
        "title": "Message Processing Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, mxp_processing_duration_ms_bucket)",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.50, mxp_processing_duration_ms_bucket)",
            "legendFormat": "50th percentile"
          }
        ]
      },
      {
        "id": 3,
        "title": "Bandwidth Savings",
        "type": "stat",
        "targets": [
          {
            "expr": "mxp_bandwidth_savings_bytes",
            "legendFormat": "Total Savings"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "bytes"
          }
        }
      },
      {
        "id": 4,
        "title": "Message Volume",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(mxp_messages_total[5m])",
            "legendFormat": "Messages/sec - {{type}}"
          }
        ]
      }
    ],
    "time": {
      "from": "now-1h",
      "to": "now"
    },
    "refresh": "5s"
  }
}
```

#### Creating Grafana Dashboard
```bash
# Import dashboard via API
curl -X POST \
  http://admin:admin@localhost:3000/api/dashboards/db \
  -H 'Content-Type: application/json' \
  -d @mxp-dashboard.json

# Or create dashboard programmatically
node scripts/create-grafana-dashboard.js
```

### DataDog Integration

#### DataDog Custom Metrics
```typescript
// datadog-mxp-integration.ts
import StatsD from 'node-statsd';

class DataDogMxpReporter {
  private client: StatsD;
  
  constructor(host: string = 'localhost', port: number = 8125) {
    this.client = new StatsD({
      host,
      port,
      prefix: 'mxf.mxp.'
    });
  }
  
  public reportConversionMetrics(stats: MxpCoreMetrics) {
    this.client.gauge('conversion.rate', stats.conversionSuccessRate);
    this.client.increment('conversion.successes', stats.conversionSuccessCount);
    this.client.increment('conversion.failures', stats.conversionFailureCount);
    this.client.gauge('conversion.confidence', stats.averageConfidenceScore);
  }
  
  public reportPerformanceMetrics(stats: MxpCoreMetrics) {
    this.client.histogram('processing.time', stats.averageProcessingTime);
    this.client.gauge('queue.depth', stats.messageQueueDepth);
    this.client.gauge('throughput', stats.messagesPerSecond);
  }
  
  public reportEfficiencyMetrics(stats: MxpEfficiencyMetrics) {
    this.client.gauge('bandwidth.savings', stats.bandwidthReductionPercentage);
    this.client.gauge('message.size.mxp', stats.averageMxpMessageSize);
    this.client.gauge('message.size.natural', stats.averageNaturalLanguageSize);
  }
  
  public reportSecurityMetrics(stats: MxpSecurityMetrics) {
    this.client.gauge('encryption.success_rate', stats.encryptionSuccessRate);
    this.client.histogram('encryption.time', stats.averageEncryptionTime);
    this.client.increment('security.auth_failures', stats.authenticationFailures);
  }
}
```

### ELK Stack Integration

#### Logstash Configuration
```ruby
# logstash-mxp.conf
input {
  file {
    path => "/var/log/mxf/mxp.log"
    type => "mxp"
    codec => "json"
  }
}

filter {
  if [type] == "mxp" {
    mutate {
      add_field => { "[@metadata][index]" => "mxp-logs-%{+YYYY.MM.dd}" }
    }
    
    # Parse MXP-specific fields
    if [message] =~ /MXP/ {
      grok {
        match => { 
          "message" => "\[%{LOGLEVEL:level}\] MXP: %{DATA:operation} \(time: %{NUMBER:duration:float}ms\)"
        }
      }
    }
    
    # Extract conversion metrics
    if [operation] =~ /conversion/ {
      grok {
        match => {
          "message" => "confidence: %{NUMBER:confidence:float}"
        }
      }
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "%{[@metadata][index]}"
  }
}
```

#### Kibana Dashboard
```json
{
  "version": "7.15.0",
  "objects": [
    {
      "attributes": {
        "title": "MXP Performance Dashboard",
        "type": "dashboard",
        "panelsJSON": "[{\"gridData\":{\"x\":0,\"y\":0,\"w\":24,\"h\":15},\"panelIndex\":\"1\",\"embeddableConfig\":{},\"panelRefName\":\"panel_1\"}]"
      },
      "references": [
        {
          "name": "panel_1",
          "type": "visualization",
          "id": "mxp-conversion-rate-viz"
        }
      ]
    }
  ]
}
```

## Setting Up Alerts for MXP Failures

### Prometheus AlertManager Rules

#### Alert Rule Configuration
```yaml
# mxp_alerts.yml
groups:
  - name: mxp_protocol
    rules:
      # Conversion rate alerts
      - alert: MXPConversionRateLow
        expr: mxp_conversion_rate < 60
        for: 5m
        labels:
          severity: warning
          component: mxp
        annotations:
          summary: "MXP conversion rate is below 60%"
          description: "Conversion rate has been {{ $value }}% for more than 5 minutes"
          
      - alert: MXPConversionRateCritical
        expr: mxp_conversion_rate < 30
        for: 2m
        labels:
          severity: critical
          component: mxp
        annotations:
          summary: "MXP conversion rate critically low"
          description: "Conversion rate has dropped to {{ $value }}%"
      
      # Performance alerts
      - alert: MXPHighLatency
        expr: histogram_quantile(0.95, mxp_processing_duration_ms_bucket) > 100
        for: 3m
        labels:
          severity: warning
          component: mxp
        annotations:
          summary: "MXP processing latency is high"
          description: "95th percentile latency is {{ $value }}ms"
          
      - alert: MXPQueueBacklog
        expr: mxp_queue_depth > 1000
        for: 1m
        labels:
          severity: critical
          component: mxp
        annotations:
          summary: "MXP message queue backlog detected"
          description: "Queue depth is {{ $value }} messages"
      
      # Security alerts
      - alert: MXPEncryptionFailures
        expr: rate(mxp_encryption_failures_total[5m]) > 0.01
        for: 1m
        labels:
          severity: critical
          component: mxp_security
        annotations:
          summary: "MXP encryption failures detected"
          description: "Encryption failure rate: {{ $value }} failures/sec"
          
      - alert: MXPAuthenticationFailures
        expr: rate(mxp_auth_failures_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
          component: mxp_security
        annotations:
          summary: "MXP authentication failures increasing"
          description: "Auth failure rate: {{ $value }} failures/sec"
```

#### AlertManager Configuration
```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'localhost:587'
  smtp_from: 'alerts@mxf.local'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'
  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
    - match:
        component: mxp_security
      receiver: 'security-team'

receivers:
  - name: 'web.hook'
    webhook_configs:
      - url: 'http://localhost:3001/api/alerts/webhook'
        
  - name: 'critical-alerts'
    email_configs:
      - to: 'oncall@company.com'
        subject: 'Critical MXP Alert: {{ .GroupLabels.alertname }}'
        body: |
          {{ range .Alerts }}
          Alert: {{ .Annotations.summary }}
          Description: {{ .Annotations.description }}
          {{ end }}
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#mxf-alerts'
        title: 'Critical MXP Alert'
        
  - name: 'security-team'
    email_configs:
      - to: 'security@company.com'
        subject: 'MXP Security Alert: {{ .GroupLabels.alertname }}'
```

### Custom Alert System

#### Node.js Alert Manager
```typescript
// mxp-alert-manager.ts
import { EventEmitter } from 'events';
import { MxpMiddleware } from '@mxf/shared';

interface AlertRule {
  name: string;
  condition: (stats: MxpCoreMetrics) => boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
  cooldown: number; // milliseconds
  message: string;
}

export class MxpAlertManager extends EventEmitter {
  private rules: AlertRule[] = [];
  private lastAlerts: Map<string, number> = new Map();
  private monitoringInterval: NodeJS.Timeout;
  
  constructor() {
    super();
    this.setupDefaultRules();
  }
  
  private setupDefaultRules() {
    this.rules = [
      {
        name: 'low_conversion_rate',
        condition: (stats) => stats.conversionSuccessRate < 0.6,
        severity: 'warning',
        cooldown: 300000, // 5 minutes
        message: 'MXP conversion rate below 60%: {{rate}}%'
      },
      {
        name: 'critical_conversion_rate',
        condition: (stats) => stats.conversionSuccessRate < 0.3,
        severity: 'critical',
        cooldown: 60000, // 1 minute
        message: 'MXP conversion rate critically low: {{rate}}%'
      },
      {
        name: 'high_latency',
        condition: (stats) => stats.p95ProcessingTime > 100,
        severity: 'warning',
        cooldown: 180000, // 3 minutes
        message: 'MXP processing latency high: {{latency}}ms (P95)'
      },
      {
        name: 'queue_backlog',
        condition: (stats) => stats.messageQueueDepth > 1000,
        severity: 'error',
        cooldown: 60000, // 1 minute
        message: 'MXP message queue backlog: {{depth}} messages'
      }
    ];
  }
  
  public startMonitoring(intervalMs: number = 30000) {
    this.monitoringInterval = setInterval(async () => {
      await this.checkAlerts();
    }, intervalMs);
  }
  
  public stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
  
  private async checkAlerts() {
    try {
      const stats = await MxpMiddleware.getDetailedStats();
      const now = Date.now();
      
      for (const rule of this.rules) {
        const lastAlert = this.lastAlerts.get(rule.name) || 0;
        
        if (rule.condition(stats) && (now - lastAlert) > rule.cooldown) {
          this.triggerAlert(rule, stats);
          this.lastAlerts.set(rule.name, now);
        }
      }
    } catch (error) {
      console.error('Failed to check MXP alerts:', error);
    }
  }
  
  private triggerAlert(rule: AlertRule, stats: MxpCoreMetrics) {
    const message = this.formatAlertMessage(rule.message, stats);
    
    const alert = {
      name: rule.name,
      severity: rule.severity,
      message,
      timestamp: new Date().toISOString(),
      metrics: stats
    };
    
    this.emit('alert', alert);
    
    // Send to various channels
    this.sendToSlack(alert);
    this.sendToEmail(alert);
    this.logAlert(alert);
  }
  
  private formatAlertMessage(template: string, stats: MxpCoreMetrics): string {
    return template
      .replace('{{rate}}', (stats.conversionSuccessRate * 100).toFixed(1))
      .replace('{{latency}}', stats.p95ProcessingTime.toFixed(1))
      .replace('{{depth}}', stats.messageQueueDepth.toString());
  }
  
  private async sendToSlack(alert: any) {
    // Implement Slack notification
    try {
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const response = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🚨 MXP Alert: ${alert.message}`,
            color: this.getSeverityColor(alert.severity)
          })
        });
      }
    } catch (error) {
      console.error('Failed to send Slack alert:', error);
    }
  }
  
  private getSeverityColor(severity: string): string {
    const colors = {
      'info': '#36a64f',
      'warning': '#ff9900',
      'error': '#ff6600',
      'critical': '#cc0000'
    };
    return colors[severity] || '#000000';
  }
}
```

## Performance Optimization Guidelines

### Baseline Performance Targets

#### Expected Performance Benchmarks
```typescript
const performanceTargets = {
  // Conversion metrics
  conversionRate: {
    excellent: 0.85,    // 85%+
    good: 0.70,         // 70-85%
    acceptable: 0.50,   // 50-70%
    poor: 0.50          // <50%
  },
  
  // Processing latency (milliseconds)
  processingLatency: {
    excellent: 5,       // <5ms
    good: 15,          // 5-15ms
    acceptable: 50,     // 15-50ms
    poor: 50           // >50ms
  },
  
  // Throughput (messages per second)
  throughput: {
    excellent: 1000,    // 1000+ msg/s
    good: 500,         // 500-1000 msg/s
    acceptable: 100,    // 100-500 msg/s
    poor: 100          // <100 msg/s
  },
  
  // Bandwidth efficiency
  bandwidthSavings: {
    excellent: 0.80,    // 80%+ savings
    good: 0.60,        // 60-80% savings
    acceptable: 0.40,   // 40-60% savings
    poor: 0.40         // <40% savings
  }
};
```

### Optimization Strategies

#### Message Processing Optimization
```typescript
// Optimize pattern detection
const optimizationConfig = {
  patternCache: {
    enabled: true,
    maxSize: 10000,
    ttl: 3600000 // 1 hour
  },
  
  batchProcessing: {
    enabled: true,
    batchSize: 50,
    maxWaitTime: 100 // ms
  },
  
  preprocessing: {
    enabled: true,
    normalizeWhitespace: true,
    extractNumbers: true,
    cacheTokenization: true
  }
};

// Implement batch processing
class BatchProcessor {
  private batch: any[] = [];
  private timer: NodeJS.Timeout | null = null;
  
  public add(message: any) {
    this.batch.push(message);
    
    if (this.batch.length >= optimizationConfig.batchProcessing.batchSize) {
      this.processBatch();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.processBatch();
      }, optimizationConfig.batchProcessing.maxWaitTime);
    }
  }
  
  private processBatch() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    const messages = this.batch.splice(0);
    this.processBatchedMessages(messages);
  }
  
  private async processBatchedMessages(messages: any[]) {
    // Process messages in parallel
    const promises = messages.map(msg => this.processMessage(msg));
    await Promise.all(promises);
  }
}
```

#### Resource Optimization
```typescript
// Memory management
const memoryConfig = {
  maxHeapSize: '4gb',
  gcStrategy: 'incremental',
  memoryMonitoring: true
};

// CPU optimization
const cpuConfig = {
  workerThreads: {
    enabled: true,
    maxWorkers: require('os').cpus().length,
    taskTimeout: 5000
  },
  
  clustering: {
    enabled: true,
    instances: 'max' // or specific number
  }
};

// Network optimization
const networkConfig = {
  connectionPooling: {
    maxConnections: 100,
    keepAlive: true,
    timeout: 30000
  },
  
  compression: {
    enabled: true,
    algorithm: 'gzip',
    threshold: 1024 // bytes
  }
};
```

## Capacity Planning Based on MXP Usage

### Usage Pattern Analysis

#### Traffic Growth Modeling
```typescript
interface TrafficGrowthModel {
  currentLoad: {
    messagesPerDay: number;
    peakMessagesPerSecond: number;
    averageMessageSize: number;
    mxpAdoptionRate: number;
  };
  
  projectedGrowth: {
    monthlyGrowthRate: number;    // e.g., 0.15 for 15%
    seasonalMultiplier: number;   // e.g., 1.5 for peak seasons
    adoptionGrowthRate: number;   // MXP adoption increase
  };
  
  resourceRequirements: {
    cpuCoresNeeded: number;
    memoryGBNeeded: number;
    networkBandwidthMbps: number;
    storageGBPerMonth: number;
  };
}

class CapacityPlanner {
  public calculateResourceNeeds(
    currentMetrics: MxpCoreMetrics,
    growthModel: TrafficGrowthModel,
    timeHorizonMonths: number
  ): ResourceProjection {
    
    const projectedLoad = this.projectTrafficGrowth(
      growthModel.currentLoad,
      growthModel.projectedGrowth,
      timeHorizonMonths
    );
    
    const resourceNeeds = this.calculateResources(projectedLoad);
    
    return {
      projectedLoad,
      resourceNeeds,
      costProjection: this.estimateCosts(resourceNeeds),
      recommendations: this.generateRecommendations(resourceNeeds)
    };
  }
  
  private projectTrafficGrowth(
    current: any,
    growth: any,
    months: number
  ): ProjectedLoad {
    const compoundGrowth = Math.pow(1 + growth.monthlyGrowthRate, months);
    
    return {
      messagesPerDay: current.messagesPerDay * compoundGrowth,
      peakMessagesPerSecond: current.peakMessagesPerSecond * compoundGrowth * growth.seasonalMultiplier,
      mxpAdoptionRate: Math.min(0.95, current.mxpAdoptionRate + (growth.adoptionGrowthRate * months)),
      bandwidthSavings: this.calculateBandwidthSavings(current.mxpAdoptionRate + (growth.adoptionGrowthRate * months))
    };
  }
}
```

#### Scaling Thresholds
```typescript
const scalingThresholds = {
  cpu: {
    scaleUp: 70,      // Scale up at 70% CPU usage
    scaleDown: 30,    // Scale down at 30% CPU usage
    cooldown: 300000  // 5 minutes between scaling events
  },
  
  memory: {
    scaleUp: 80,      // Scale up at 80% memory usage
    warning: 90,      // Alert at 90% memory usage
    critical: 95      // Critical alert at 95% memory usage
  },
  
  throughput: {
    maxSafeLoad: 0.8, // 80% of theoretical maximum
    emergencyScale: 0.9, // Emergency scaling at 90%
    queueDepthLimit: 1000 // Maximum queue depth
  }
};
```

### Infrastructure Scaling Recommendations

#### Horizontal Scaling Strategy
```yaml
# kubernetes-scaling.yml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mxf-mxp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mxf-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: mxp_queue_depth
      target:
        type: AverageValue
        averageValue: "500"
```

#### Vertical Scaling Guidelines
```typescript
const verticalScalingGuidelines = {
  memoryOptimization: {
    baseline: '2GB',
    highVolume: '8GB',
    enterprise: '16GB',
    factors: {
      messageCacheSize: 0.5,  // 50% of memory for message cache
      patternCacheSize: 0.2,  // 20% for pattern cache
      encryptionBuffers: 0.1, // 10% for encryption operations
      systemOverhead: 0.2     // 20% system overhead
    }
  },
  
  cpuOptimization: {
    baseline: 2,     // cores
    highVolume: 8,   // cores
    enterprise: 16,  // cores
    considerations: {
      encryptionOverhead: 1.5,    // 50% more CPU for encryption
      patternMatching: 1.2,       // 20% more CPU for pattern matching
      jsonProcessing: 1.1         // 10% more CPU for JSON processing
    }
  }
};
```

## Best Practices

### Monitoring Best Practices

1. **Establish Baselines**:
   - Collect performance data for at least 30 days
   - Identify daily and weekly patterns
   - Document seasonal variations
   - Set realistic performance targets

2. **Implement Layered Monitoring**:
   - **Application Layer**: MXP-specific metrics
   - **Infrastructure Layer**: CPU, memory, network
   - **Business Layer**: Cost savings, user experience
   - **Security Layer**: Encryption performance, threat detection

3. **Use Statistical Analysis**:
   - Track percentiles (P50, P95, P99) not just averages
   - Implement anomaly detection for unusual patterns
   - Use time-series analysis for trend identification
   - Correlate metrics across different layers

### Alert Configuration Best Practices

1. **Avoid Alert Fatigue**:
   - Set appropriate cooldown periods
   - Use severity-based routing
   - Implement escalation policies
   - Regular review and tuning of thresholds

2. **Context-Aware Alerting**:
   - Include relevant metric values in alerts
   - Provide troubleshooting guidance
   - Link to relevant dashboards and documentation
   - Include historical context when possible

3. **Testing and Validation**:
   - Test alert rules with simulated failures
   - Validate notification delivery mechanisms
   - Document alert response procedures
   - Regular review of alert effectiveness

### Performance Optimization Best Practices

1. **Continuous Optimization**:
   - Regular performance reviews and optimization cycles
   - A/B testing for configuration changes
   - Benchmark testing before and after changes
   - Documentation of optimization results

2. **Proactive Scaling**:
   - Monitor leading indicators of load increases
   - Implement predictive scaling based on usage patterns
   - Plan for seasonal and event-driven traffic spikes
   - Test scaling procedures regularly

3. **Cost Optimization**:
   - Track cost per message processed
   - Optimize resource allocation based on usage patterns
   - Implement cost-aware scaling policies
   - Regular review of infrastructure costs vs. performance benefits

---

## Related Documentation

- [MXP Protocol Architecture](mxp-protocol.md)
- [MXP Dashboard Monitoring](../dashboard/mxp-monitoring.md)
- [MXP Troubleshooting Guide](mxp-troubleshooting.md)
- [Security Best Practices](security.md)
- [API Documentation](../api/analytics.md)