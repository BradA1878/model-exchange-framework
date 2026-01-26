# MXP 2.0 Troubleshooting Guide

This guide helps you diagnose and resolve issues with MXP 2.0's modular optimization suite in the MXF framework. MXP 2.0's architecture requires different troubleshooting approaches compared to the legacy protocol-based system.

## Overview

MXP 2.0 troubleshooting involves four key modules:
- **Token Optimization Module**: SystemLLM integration, compression strategies, pattern learning
- **Bandwidth Optimization Module**: Binary encoding, enhanced message aggregation, EventBus integration  
- **Progressive Security Module**: Multi-level security, key management, audit logging
- **Real-time Analytics Module**: Cost calculation, performance tracking, event processing

## MXP 2.0 Module Troubleshooting

### Token Optimization Issues

#### Issue: Low Token Compression Rates (<60%)
**Symptoms:**
- Token optimization metrics showing compression ratio below 0.6
- SystemLLM integration health below 95%
- Pattern learning not improving over time

**Diagnostic Steps:**
1. **Check SystemLLM Service Health**:
   ```typescript
   // Verify SystemLLM integration
   const mxpManager = MxpConfigManager.getInstance();
   const channelConfig = mxpManager.getChannelConfig(channelId);
   
   // Check if SystemLLM is responding
   const systemLlmHealth = await this.checkSystemLlmHealth();
   console.log('SystemLLM Health:', systemLlmHealth);
   ```

2. **Verify Token Optimization Configuration**:
   ```typescript
   // Check if token optimization is enabled
   const config: Mxp2Config = {
     tokenOptimization: {
       enabled: true,  // Must be enabled
       strategies: [   // Ensure multiple strategies are active
         'context_compression',
         'prompt_optimization', 
         'conversation_summarization',
         'entity_deduplication',
         'tool_schema_reduction',
         'template_matching'
       ],
       aggressiveness: 'balanced'  // Try 'aggressive' for better compression
     }
   };
   ```

**Solutions:**
- **SystemLLM Issues**: Ensure SystemLLM service is running and accessible
- **Strategy Selection**: Enable more optimization strategies for better compression
- **Pattern Learning**: Allow time for pattern learning to build optimization database
- **Aggressive Mode**: Switch to aggressive optimization for higher compression ratios

#### Issue: SystemLLM Integration Failures
**Symptoms:**
- `systemLlmIntegration.errorCount` increasing
- Token optimization falling back to basic strategies
- EventBus errors related to SystemLLM requests

**Solutions:**
1. **Check Service Dependencies**:
   ```bash
   # Verify SystemLLM service is running
   curl -X GET http://localhost:3001/api/system-llm/health
   ```

2. **Review Pattern Learning Service**:
   ```typescript
   // Verify PatternLearningService integration
   EventBus.server.emit('pattern.learning.health.check', {
     channelId,
     timestamp: new Date()
   });
   ```

### Bandwidth Optimization Issues

#### Issue: Low Bandwidth Compression (<70%)
**Symptoms:**
- Bandwidth optimization metrics showing compression below 0.7
- Binary encoding rate under 85%
- Enhanced message aggregation not preserving similarity threshold

**Diagnostic Steps:**
1. **Check Message Aggregation Settings**:
   ```typescript
   // Verify MxfMessageAggregator is properly enhanced
   const aggregatorConfig = {
     similarityThreshold: 0.8,        // Preserved from original
     maxWaitTime: 180000,             // 3-min failsafe preserved
     enableBinaryEncoding: true,      // MXP 2.0 enhancement
     enableCompression: true,         // MXP 2.0 enhancement
     preserveResponseAware: true      // Existing functionality preserved
   };
   ```

2. **Verify EventBus Performance**:
   ```typescript
   // Check EventBus integration health
   const eventBusHealth = await this.checkEventBusHealth();
   console.log('EventBus metrics:', eventBusHealth.priorityHandling);
   ```

**Solutions:**
- **Enable Binary Encoding**: Ensure binary encoding is active for all supported message types
- **Check Compression Settings**: Verify compression algorithms are properly configured
- **EventBus Optimization**: Ensure EventBus isn't bottlenecking message processing
- **Preserve Existing Features**: Verify 80% similarity and 3-min failsafe are maintained

#### Issue: Message Aggregation Failures
**Symptoms:**
- `aggregationStats.similarityThresholdMaintained` showing false
- `aggregationStats.responseAwarePreserved` showing false
- Frequent `aggregationStats.failsafeTriggered` events

**Solutions:**
1. **Check Enhanced Aggregation Logic**:
   ```typescript
   // Verify MXP 2.0 enhancements don't break existing logic
   const aggregationTest = await this.testAggregationLogic();
   if (!aggregationTest.preservesExistingBehavior) {
     console.error('MXP 2.0 broke existing aggregation!');
   }
   ```

### Security Module Issues

#### Issue: Progressive Security Level Errors
**Symptoms:**
- Security level not matching configuration
- Audit logging failures for regulated/classified levels
- HSM integration errors for high-security channels

**Diagnostic Steps:**
1. **Verify Security Level Configuration**:
   ```typescript
   // Check channel security level
   const securityLevel = mxpManager.getChannelConfig(channelId).securityLevel;
   console.log('Configured security level:', securityLevel);
   
   // Verify level-specific requirements are met
   switch (securityLevel) {
     case 'classified':
     case 'regulated':
       // Check HSM integration
       const hsmHealth = await this.checkHsmIntegration();
       if (!hsmHealth.connected) {
         throw new Error('HSM required for security level but not connected');
       }
       break;
   }
   ```

2. **Check ChannelKeyService Integration**:
   ```typescript
   // Verify existing ChannelKeyService integration is preserved
   const keyServiceHealth = await this.checkChannelKeyServiceIntegration();
   if (!keyServiceHealth.operational) {
     console.error('ChannelKeyService integration broken by MXP 2.0');
   }
   ```

**Solutions:**
- **HSM Configuration**: Ensure HSM is properly configured for regulated/classified levels
- **Audit Logging**: Enable and configure audit logging for compliance requirements
- **Key Rotation**: Verify key rotation schedules are appropriate for security level
- **Preserve Integration**: Ensure existing ChannelKeyService functionality is preserved

### Analytics Module Issues

#### Issue: Cost Calculation Inaccuracies
**Symptoms:**
- `costCalculation.enabled` showing false when it should be true
- Incorrect monthly savings calculations
- Provider breakdown showing empty results

**Diagnostic Steps:**
1. **Verify Analytics Configuration**:
   ```typescript
   // Check if analytics module is properly configured
   const analyticsConfig = mxpManager.getChannelConfig(channelId).analytics;
   if (!analyticsConfig.costCalculation.enabled) {
     console.error('Cost calculation disabled - no ROI visibility');
   }
   ```

2. **Check Provider Integration**:
   ```typescript
   // Verify provider cost calculation
   const providers = ['openai', 'anthropic', 'bedrock'];
   for (const provider of providers) {
     const providerStats = await this.getProviderStats(provider);
     console.log(`${provider} token reduction:`, providerStats.tokenReduction);
   }
   ```

## Debugging MXP 2.0 Integration Issues

### Verifying Service Integration Health

#### SystemLLM Service Integration
```typescript
// comprehensive-integration-test.ts
export class MXP2IntegrationTester {
    async testSystemLlmIntegration(channelId: string): Promise<IntegrationHealthReport> {
        const results = {
            systemLlm: {
                reachable: false,
                responding: false,
                optimizationWorking: false,
                errorRate: 0
            }
        };
        
        try {
            // Test basic connectivity
            const healthCheck = await fetch('http://localhost:3001/api/system-llm/health');
            results.systemLlm.reachable = healthCheck.ok;
            
            // Test optimization functionality
            if (results.systemLlm.reachable) {
                const testOptimization = await this.testTokenOptimization(channelId);
                results.systemLlm.optimizationWorking = testOptimization.success;
                results.systemLlm.errorRate = testOptimization.errorRate;
            }
            
        } catch (error) {
            console.error('SystemLLM integration test failed:', error);
        }
        
        return results;
    }
    
    async testEventBusIntegration(): Promise<EventBusHealth> {
        return new Promise((resolve) => {
            const testEvent = 'mxp2.integration.test';
            const timeout = setTimeout(() => {
                resolve({ responsive: false, latency: -1 });
            }, 5000);
            
            const startTime = Date.now();
            EventBus.server.once(testEvent, () => {
                clearTimeout(timeout);
                resolve({
                    responsive: true,
                    latency: Date.now() - startTime
                });
            });
            
            EventBus.server.emit(testEvent, { test: true });
        });
    }
}
```

### Performance Troubleshooting

#### Token Optimization Performance Issues
```typescript
// performance-diagnostics.ts
export class MXP2PerformanceDiagnostics {
    async diagnoseTokenOptimizationPerformance(channelId: string): Promise<PerformanceDiagnosis> {
        const metrics = this.analyticsCollector.getChannelMetrics(channelId);
        const issues: string[] = [];
        const recommendations: string[] = [];
        
        // Check compression ratio
        if (metrics.tokenOptimization.averageCompressionRatio < 0.6) {
            issues.push('Token compression below 60% target');
            recommendations.push('Enable more optimization strategies');
            recommendations.push('Switch to aggressive optimization mode');
        }
        
        // Check SystemLLM performance
        if (metrics.tokenOptimization.systemLlmIntegration.successRate < 0.95) {
            issues.push('SystemLLM integration health below 95%');
            recommendations.push('Check SystemLLM service health');
            recommendations.push('Review EventBus performance for SystemLLM requests');
        }
        
        // Check pattern learning effectiveness
        if (metrics.tokenOptimization.patternLearningStats.learningAccuracy < 0.8) {
            issues.push('Pattern learning accuracy below 80%');
            recommendations.push('Allow more time for pattern learning to mature');
            recommendations.push('Provide more diverse training data');
        }
        
        return {
            channelId,
            overallHealth: issues.length === 0 ? 'healthy' : 'needs-attention',
            issues,
            recommendations,
            metrics: metrics.tokenOptimization
        };
    }
}
```

## Common MXP 2.0 Error Patterns

### Module-Specific Error Codes

#### Token Optimization Errors
- **MXP2-TOK-001**: `SystemLLM service unreachable` - Check service health
- **MXP2-TOK-002**: `Pattern learning service unavailable` - Verify PatternLearningService 
- **MXP2-TOK-003**: `Optimization strategy failed` - Review strategy configuration
- **MXP2-TOK-004**: `Compression ratio below threshold` - Enable more strategies

#### Bandwidth Optimization Errors  
- **MXP2-BWD-001**: `Binary encoding failed` - Check message format compatibility
- **MXP2-BWD-002**: `Aggregation similarity threshold violated` - Review aggregation logic
- **MXP2-BWD-003**: `EventBus integration failure` - Check EventBus health
- **MXP2-BWD-004**: `Response-aware aggregation broken` - Verify existing logic preserved

#### Security Errors
- **MXP2-SEC-001**: `Security level validation failed` - Check level configuration
- **MXP2-SEC-002**: `HSM integration required but unavailable` - Configure HSM for regulated levels
- **MXP2-SEC-003**: `Audit logging failure` - Check audit logging configuration
- **MXP2-SEC-004**: `Key rotation overdue` - Review key rotation schedule

#### Analytics Errors
- **MXP2-ANA-001**: `Cost calculation disabled` - Enable cost tracking in configuration
- **MXP2-ANA-002**: `Provider statistics unavailable` - Check provider integration
- **MXP2-ANA-003**: `Real-time metrics not updating` - Verify EventBus analytics events
- **MXP2-ANA-004**: `ROI calculation inaccurate` - Review cost calculation parameters

## Best Practices for MXP 2.0 Troubleshooting

### 1. Module-by-Module Diagnosis
- **Isolate Issues**: Test each module independently before checking interactions
- **Preserve Existing Functionality**: Always verify existing MXF features still work
- **Event-Driven Debugging**: Use EventBus events to trace issues across services
- **Service Health Checks**: Regularly verify SystemLLM and PatternLearning service health

### 2. Integration Health Monitoring
- **Continuous Integration Testing**: Automated tests for service integrations
- **Performance Baseline Tracking**: Monitor deviations from expected performance
- **Real-time Health Dashboards**: Executive-level visibility into optimization health
- **Proactive Alerting**: Alert before issues impact optimization effectiveness

### 3. Rollback and Recovery
- **Module-Level Rollback**: Ability to disable specific modules without affecting others
- **Configuration Validation**: Validate all configurations before applying
- **Gradual Deployment**: Phase rollouts to identify issues early
- **Preserve Existing Behavior**: Always maintain existing MXF functionality

### 4. Documentation and Knowledge Sharing
- **Issue Pattern Documentation**: Document common issues and resolutions
- **Performance Tuning Guides**: Best practices for optimal configuration
- **Integration Troubleshooting**: Service-specific troubleshooting procedures
- **Community Knowledge Base**: Share troubleshooting experiences with the community

---

## Related Documentation

- **Technical Specification**: [MXP 2.0 Technical Specification](./mxp-technical-specification.md)
- **Implementation Guide**: [MXP 2.0 Implementation Guide](../tmp/mxp/mxp-2.0-implementation-guide.md) 
- **Monitoring & Analytics**: [MXP 2.0 Monitoring Guide](./mxp-monitoring.md)
- **Enterprise Deployment**: [MXP Enterprise Guide](./mxp-enterprise.md)
- **Protocol Architecture**: [MXP Protocol Documentation](./mxp-protocol.md)

*Encountered a unique MXP 2.0 issue? Share your troubleshooting experience to help the community optimize their multi-agent systems!*
       operation: 'report.generate',
       confidence: 0.8
     }
   ];
   ```

#### Issue: Conversion Loops or Infinite Retries
**Symptoms:**
- High CPU usage from MXP middleware
- Messages being converted back and forth
- Timeout errors in message processing

**Root Causes:**
1. **Bidirectional Conversion**: Messages converted repeatedly
2. **Pattern Conflicts**: Multiple patterns matching same message
3. **Configuration Mismatch**: Different agents using incompatible settings

**Solutions:**

1. **Enable Loop Prevention**:
   ```typescript
   const config = {
     enableLoopPrevention: true,
     maxConversionAttempts: 3,
     conversionTracking: true
   };
   ```

2. **Fix Pattern Conflicts**:
   ```typescript
   // Use priority-based pattern matching
   const patterns = [
     { pattern: /specific pattern/i, priority: 1 },
     { pattern: /general pattern/i, priority: 2 }
   ];
   ```

3. **Standardize Agent Configuration**:
   ```bash
   # Use environment variables for consistent configuration
   export MXP_PREFERRED_FORMAT=auto
   export MXP_CONFIDENCE_THRESHOLD=0.7
   export MXP_ENABLE_LEARNING=true
   ```

### Encryption and Decryption Failures

#### Issue: Encryption Failures
**Symptoms:**
- `encryptionFailures` metric is non-zero
- Error messages about encryption keys
- Messages being sent unencrypted when encryption is required

**Root Causes:**
1. **Missing Encryption Keys**: Keys not configured or accessible
2. **Invalid Key Format**: Keys not properly encoded
3. **Key Rotation Issues**: Keys expired or rotated incorrectly
4. **Memory Issues**: Insufficient memory for encryption operations

**Solutions:**

1. **Verify Key Configuration**:
   ```bash
   # Check environment variables
   echo $MXP_ENCRYPTION_KEY
   echo $MXP_ENCRYPTION_SALT
   echo $MXP_ENCRYPTION_ENABLED
   ```

2. **Generate New Keys**:
   ```bash
   # Generate secure encryption keys
   bun run mxp:generate-key
   
   # Or manually generate
   node -e "
     const crypto = require('crypto');
     const key = crypto.randomBytes(32).toString('base64');
     const salt = crypto.randomBytes(16).toString('base64');
     console.log('MXP_ENCRYPTION_KEY=' + key);
     console.log('MXP_ENCRYPTION_SALT=' + salt);
   "
   ```

3. **Test Encryption/Decryption**:
   ```typescript
   import { MxpEncryption } from '@mxf/shared';
   
   async function testEncryption() {
     const testMessage = { version: '1.0', type: 'test', payload: { op: 'ping' } };
     
     try {
       const encrypted = await MxpEncryption.encrypt(testMessage);
       console.log('Encryption successful:', encrypted);
       
       const decrypted = await MxpEncryption.decrypt(encrypted);
       console.log('Decryption successful:', decrypted);
       
     } catch (error) {
       console.error('Encryption test failed:', error.message);
     }
   }
   ```

4. **Check Memory Usage**:
   ```bash
   # Monitor memory usage during encryption
   ps aux | grep node
   top -p $(pgrep -f mxf)
   ```

#### Issue: Decryption Failures
**Symptoms:**
- `decryptionFailures` metric is high
- "Authentication tag mismatch" errors
- Messages appear corrupted or unreadable

**Root Causes:**
1. **Key Mismatch**: Different keys used for encryption and decryption
2. **Message Corruption**: Network transmission issues
3. **Version Incompatibility**: Different MXP versions
4. **Authentication Tag Issues**: Message tampering or corruption

**Solutions:**

1. **Verify Key Synchronization**:
   ```typescript
   // Ensure all agents use the same encryption keys
   const keyCheck = await MxpEncryption.validateKeys();
   if (!keyCheck.valid) {
     console.error('Key validation failed:', keyCheck.errors);
   }
   ```

2. **Check Message Integrity**:
   ```typescript
   // Validate message format before decryption
   function validateMxpMessage(message) {
     if (!message.version || !message.payload) {
       throw new Error('Invalid MXP message format');
     }
     if (message.encrypted && (!message.payload.data || !message.payload.iv)) {
       throw new Error('Invalid encrypted payload format');
     }
   }
   ```

3. **Test Network Transmission**:
   ```bash
   # Check for network issues affecting message integrity
   curl -X POST http://localhost:3001/api/test/mxp \
     -H "Content-Type: application/json" \
     -d '{"test": "message integrity"}'
   ```

### Network Connectivity Issues

#### Issue: MXP Messages Not Being Transmitted
**Symptoms:**
- Messages stuck in send queue
- WebSocket connection errors
- Timeout errors in message delivery

**Root Causes:**
1. **WebSocket Connection Issues**: Connection drops or failures
2. **Network Latency**: High latency affecting real-time communication
3. **Firewall/Proxy Issues**: Network infrastructure blocking MXP traffic
4. **Server Overload**: Server unable to handle message volume

**Solutions:**

1. **Test WebSocket Connection**:
   ```typescript
   import { MxfSDK } from '@mxf/sdk';
   
   // Test connection to MXF server
   const sdk = new MxfSDK({
       serverUrl: 'http://localhost:3001',
       domainKey: process.env.MXF_DOMAIN_KEY!,
       username: process.env.MXF_USERNAME!,
       password: process.env.MXF_PASSWORD!
   });
   
   try {
       await sdk.connect();
       console.log('WebSocket connected');
       
       // Create test agent
       const agent = sdk.createAgent({
           agentId: 'mxp-test-agent',
           name: 'MXP Test Agent',
           channelId: 'test-channel'
       });
       
       // Send test message
       agent.emit(Events.Message.CHANNEL_MESSAGE, {
           channelId: 'test-channel',
           content: 'MXP test message'
       });
   } catch (error) {
       console.error('Connection failed:', error.message);
   }
   ```

2. **Check Network Configuration**:
   ```bash
   # Test network connectivity
   ping localhost
   telnet localhost 3001
   
   # Check for proxy issues
   curl -v http://localhost:3001/health
   ```

3. **Monitor Server Performance**:
   ```bash
   # Check server resource usage
   htop
   netstat -an | grep 3001
   lsof -i :3001
   ```

4. **Configure Connection Retry**:
   ```typescript
   const connectionConfig = {
     reconnectionAttempts: 5,
     reconnectionDelay: 1000,
     timeout: 20000,
     forceNew: false
   };
   ```

#### Issue: High Message Latency
**Symptoms:**
- Messages taking >100ms to process
- Dashboard showing high response times
- Real-time features feeling sluggish

**Root Causes:**
1. **Message Queue Backlog**: Too many messages in processing queue
2. **Database Performance**: Slow analytics data writes
3. **Encryption Overhead**: Excessive encryption processing time
4. **Memory Pressure**: Insufficient memory for optimal performance

**Solutions:**

1. **Optimize Message Processing**:
   ```typescript
   // Implement message batching
   const batchConfig = {
     batchSize: 50,
     batchTimeout: 100,
     priorityHandling: true
   };
   ```

2. **Database Optimization**:
   ```bash
   # Check database performance
   mongod --profile=2 --slowms=10
   
   # Add indexes for analytics queries
   db.mxp_analytics.createIndex({ timestamp: -1, channel: 1 });
   ```

3. **Memory Management**:
   ```bash
   # Increase Node.js memory limit
   export NODE_OPTIONS="--max-old-space-size=4096"
   
   # Monitor memory usage
   node --inspect app.js
   ```

### Performance Debugging Procedures

#### Comprehensive Performance Analysis

1. **Enable Detailed Logging**:
   ```bash
   export LOG_LEVEL=debug
   export MXP_PERFORMANCE_LOGGING=true
   export MXP_TRACE_MESSAGES=true
   ```

2. **Collect Performance Metrics**:
   ```typescript
   // Get detailed performance statistics
   const stats = await MxpMiddleware.getDetailedStats();
   console.log('Performance Analysis:', {
     avgConversionTime: stats.averageConversionTime,
     avgEncryptionTime: stats.averageEncryptionTime,
     avgDecryptionTime: stats.averageDecryptionTime,
     messageQueueDepth: stats.queueDepth,
     memoryUsage: process.memoryUsage()
   });
   ```

3. **Profile CPU Usage**:
   ```bash
   # Use Node.js profiler
   node --prof app.js
   
   # Generate profile report
   node --prof-process isolate-*.log > profile.txt
   ```

4. **Memory Leak Detection**:
   ```bash
   # Use heapdump for memory analysis
   npm install heapdump
   
   # In application code
   const heapdump = require('heapdump');
   heapdump.writeSnapshot((err, filename) => {
     console.log('Heap dump written to', filename);
   });
   ```

#### Network Performance Testing

1. **Message Throughput Test**:
   ```typescript
   async function throughputTest() {
     const testMessages = 1000;
     const startTime = Date.now();
     
     for (let i = 0; i < testMessages; i++) {
       agent.emit(Events.Message.CHANNEL_MESSAGE, {
         channelId: agent.channelId,
         content: `Test message ${i}`
       });
     }
     
     const endTime = Date.now();
     const throughput = testMessages / ((endTime - startTime) / 1000);
     console.log(`Throughput: ${throughput.toFixed(2)} messages/second`);
   }
   ```

2. **Latency Measurement**:
   ```typescript
   async function latencyTest() {
     const testRuns = 100;
     const latencies = [];
     
     for (let i = 0; i < testRuns; i++) {
       const start = Date.now();
       agent.emit(Events.Message.CHANNEL_MESSAGE, {
         channelId: agent.channelId,
         content: 'ping'
       });
       const latency = Date.now() - start;
       latencies.push(latency);
     }
     
     const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
     const p95Latency = latencies.sort()[Math.floor(testRuns * 0.95)];
     
     console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
     console.log(`P95 latency: ${p95Latency}ms`);
   }
   ```

## Debug Mode Configuration

### Enabling Debug Mode

1. **Environment Variables**:
   ```bash
   export LOG_LEVEL=debug
   export MXP_DEBUG=true
   export MXP_TRACE_CONVERSION=true
   export MXP_TRACE_ENCRYPTION=true
   export MXP_PERFORMANCE_METRICS=true
   ```

2. **Runtime Configuration**:
   ```typescript
   import { Logger } from '@mxf/shared';
   
   Logger.setLevel('debug');
   Logger.enableCategory('mxp');
   Logger.enableCategory('encryption');
   Logger.enableCategory('performance');
   ```

3. **Component-Specific Debugging**:
   ```typescript
   const debugConfig = {
     middleware: {
       traceConversions: true,
       logPerformance: true,
       validateMessages: true
     },
     encryption: {
       traceOperations: true,
       validateKeys: true,
       logTiming: true
     },
     networking: {
       traceMessages: true,
       logConnections: true,
       monitorLatency: true
     }
   };
   ```

### Debug Output Analysis

#### Conversion Debug Output
```
[DEBUG] MXP Conversion Attempt:
  Original: "Calculate the sum of 10, 20, and 30"
  Pattern: /calculate.*sum.*(\d+(?:,\s*\d+)*)/i
  Confidence: 0.85
  Result: {"op": "calc.sum", "args": [10, 20, 30]}
  Status: SUCCESS
  Time: 2.3ms
```

#### Encryption Debug Output
```
[DEBUG] MXP Encryption:
  Algorithm: aes-256-gcm
  Key Length: 256 bits
  IV: 16 bytes (random)
  Payload Size: 156 bytes
  Encrypted Size: 172 bytes
  Auth Tag: 16 bytes
  Time: 1.2ms
  Status: SUCCESS
```

#### Network Debug Output
```
[DEBUG] MXP Message Transmission:
  Message ID: msg_1234567890
  Sender: agent-001
  Receiver: agent-002
  Channel: research-channel
  Size: 172 bytes (encrypted)
  Protocol: WebSocket
  Latency: 15ms
  Status: DELIVERED
```

## Log Analysis for MXP Issues

### Key Log Patterns

#### Successful Operations
```
[INFO] MXP: Message converted (confidence: 0.87, time: 2.1ms)
[INFO] MXP: Encryption successful (time: 1.3ms)
[INFO] MXP: Message delivered (latency: 18ms)
```

#### Warning Patterns
```
[WARN] MXP: Low conversion confidence (0.65) - using fallback
[WARN] MXP: High encryption latency (>5ms) detected
[WARN] MXP: Message queue depth exceeding threshold (>100)
```

#### Error Patterns
```
[ERROR] MXP: Conversion failed - pattern not recognized
[ERROR] MXP: Encryption failed - invalid key format
[ERROR] MXP: Message delivery timeout (>30s)
[ERROR] MXP: Authentication tag verification failed
```

### Log Analysis Tools

#### Automated Log Analysis
```bash
# Search for MXP-related errors
grep -E "\[ERROR\].*MXP" /var/log/mxf/*.log

# Count conversion failures by hour
awk '/MXP.*Conversion failed/ {print $1 " " $2}' /var/log/mxf/app.log | cut -d: -f1 | uniq -c

# Find high-latency operations
grep -E "MXP.*latency.*[0-9]{3,}ms" /var/log/mxf/performance.log
```

#### Log Monitoring Setup
```javascript
// Real-time log monitoring
const tail = require('tail').Tail;
const logFile = new tail('/var/log/mxf/app.log');

logFile.on('line', (line) => {
  if (line.includes('[ERROR]') && line.includes('MXP')) {
    console.log('MXP Error detected:', line);
    // Send alert or notification
  }
});
```

## Common Error Codes and Solutions

### MXP-001: Pattern Recognition Failed
**Error**: `Pattern recognition confidence below threshold`
**Solution**: Lower confidence threshold or add custom patterns

### MXP-002: Encryption Key Not Found
**Error**: `Encryption key not configured or accessible`
**Solution**: Set `MXP_ENCRYPTION_KEY` environment variable

### MXP-003: Message Format Invalid
**Error**: `Invalid MXP message structure`
**Solution**: Validate message format against schema

### MXP-004: Network Timeout
**Error**: `Message delivery timeout exceeded`
**Solution**: Check network connectivity and increase timeout

### MXP-005: Authentication Failed
**Error**: `Message authentication tag verification failed`
**Solution**: Check for key synchronization issues

### MXP-006: Memory Exhausted
**Error**: `Insufficient memory for MXP operations`
**Solution**: Increase Node.js memory limit or optimize usage

### MXP-007: Version Mismatch
**Error**: `Incompatible MXP protocol versions`
**Solution**: Update all agents to same MXP version

### MXP-008: Circular Conversion
**Error**: `Message conversion loop detected`
**Solution**: Enable loop prevention and fix pattern conflicts

## Performance Optimization Recommendations

### Message Processing Optimization

1. **Batch Processing**:
   ```typescript
   const batchProcessor = {
     batchSize: 50,
     processingInterval: 100,
     priorityQueue: true
   };
   ```

2. **Caching Strategy**:
   ```typescript
   const cacheConfig = {
     patternCache: true,
     encryptionKeyCache: true,
     messageCacheTTL: 300000 // 5 minutes
   };
   ```

3. **Connection Pooling**:
   ```typescript
   const poolConfig = {
     maxConnections: 100,
     idleTimeout: 30000,
     connectionReuse: true
   };
   ```

### Resource Management

1. **Memory Management**:
   ```bash
   # Optimize Node.js memory settings
   export NODE_OPTIONS="--max-old-space-size=4096 --optimize-for-size"
   ```

2. **CPU Optimization**:
   ```typescript
   // Use worker threads for CPU-intensive operations
   const { Worker, isMainThread, parentPort } = require('worker_threads');
   
   if (isMainThread) {
     const worker = new Worker(__filename);
     worker.postMessage({ operation: 'encrypt', data: message });
   }
   ```

3. **Database Optimization**:
   ```javascript
   // Optimize analytics data storage
   const dbConfig = {
     batchWrites: true,
     compression: true,
     indexOptimization: true
   };
   ```

## Best Practices for Issue Prevention

### Development Practices

1. **Configuration Management**:
   - Use environment-specific configuration files
   - Implement configuration validation
   - Document all MXP settings

2. **Testing Strategy**:
   - Unit tests for all MXP components
   - Integration tests for end-to-end scenarios
   - Performance tests for load validation
   - Security tests for encryption verification

3. **Monitoring Implementation**:
   - Implement comprehensive metrics collection
   - Set up alerting for critical failures
   - Use distributed tracing for complex workflows
   - Regular performance benchmarking

### Operational Practices

1. **Deployment Procedures**:
   - Gradual rollout of MXP features
   - Canary deployments for protocol changes
   - Rollback procedures for failed deployments
   - Blue-green deployment for zero downtime

2. **Maintenance Tasks**:
   - Regular key rotation
   - Performance monitoring and optimization
   - Log rotation and archival
   - Database maintenance and cleanup

3. **Security Practices**:
   - Regular security audits
   - Encryption key management
   - Access control and authentication
   - Incident response procedures

---

## Related Documentation

- [MXP Protocol Architecture](mxp-protocol.md)
- [MXP Dashboard Monitoring](../dashboard/mxp-monitoring.md)
- [MXP Performance Monitoring](mxp-monitoring.md)
- [Security Best Practices](security.md)
- [API Documentation](../api/websocket.md)