# MXP 2.0 Configuration Manager

The **MxpConfigManager** handles channel and agent-level MXP 2.0 configuration with granular feature control. It supports configuration inheritance, overrides, and selective feature activation for token optimization, bandwidth optimization, security, and analytics.

## Overview

MXP 2.0 is a modular optimization suite that provides:

- **Token Optimization**: AI-powered context compression and prompt optimization
- **Bandwidth Optimization**: Binary encoding and enhanced message aggregation
- **Progressive Security**: Four security levels from standard to classified
- **Real-Time Analytics**: Cost calculation and performance tracking
- **Configuration Inheritance**: Channel-level settings with agent-specific overrides

## Architecture

MxpConfigManager follows the singleton pattern and manages configurations at two levels:

1. **Channel-Level Configuration**: Applied to all agents in a channel
2. **Agent-Level Configuration**: Overrides channel settings for specific agents

### Configuration Scope

```typescript
{
    scope: {
        channelId?: string;           // Apply to specific channel
        agentId?: string;             // Apply to specific agent
        inheritFromChannel: boolean;  // Agent inherits channel config
        overrideSettings: boolean;    // Allow local overrides
    }
}
```

## Usage

### Getting the Singleton Instance

```typescript
import { MxpConfigManager } from './src/shared/mxp/MxpConfigManager';

const mxpManager = MxpConfigManager.getInstance();
```

### Channel Configuration

#### Create Channel Configuration

```typescript
import { SecurityLevel } from './src/shared/types/MxpTypes';

// Create configuration with selective features
const config = mxpManager.createChannelConfig('my-channel', {
    enableTokenOptimization: true,
    enableBandwidthOptimization: true,
    securityLevel: SecurityLevel.ENHANCED,
    tokenStrategies: {
        contextCompression: true,
        promptOptimization: true,
        templateMatching: true,
        entityDeduplication: false,
        toolSchemaReduction: false,
        conversationSummarization: true
    }
});
```

#### Set Channel Configuration

```typescript
// Set complete configuration
mxpManager.setChannelConfig('channel-1', {
    version: '2.0',
    scope: {
        channelId: 'channel-1',
        inheritFromChannel: false,
        overrideSettings: true
    },
    modules: {
        tokenOptimization: {
            enabled: true,
            strategies: {
                contextCompression: true,
                promptOptimization: true,
                templateMatching: true,
                entityDeduplication: false,
                toolSchemaReduction: false,
                conversationSummarization: true
            },
            settings: {
                compressionLevel: 'standard',
                systemLlmIntegration: true,
                patternLearningIntegration: true,
                contextWindow: {
                    fullContextMessages: 5,
                    compressionRatio: 0.2,
                    referenceMode: true
                },
                templateEngine: {
                    enabled: true,
                    maxTemplates: 100,
                    confidenceThreshold: 0.8
                }
            }
        },
        bandwidthOptimization: {
            enabled: true,
            encoding: 'json',
            compression: 'standard',
            enhancedBatching: true,
            priorityQueueIntegration: true,
            binaryProtocol: {
                enabled: true,
                thresholdBytes: 10240,
                compressionAlgorithm: 'brotli'
            },
            messageAggregation: {
                similarityThreshold: 0.8,
                maxBatchSize: 65536,
                timeoutMs: 180000
            }
        },
        security: {
            enabled: true,
            level: SecurityLevel.ENHANCED,
            features: {
                auditLogging: true,
                keyEscrow: true,
                complianceMode: 'GDPR'
            },
            keyManagement: {
                rotationPolicy: 'both',
                rotationInterval: 2592000000, // 30 days in ms
                keyLength: 256,
                algorithm: 'AES-GCM',
                enhanceExistingKeys: true
            }
        },
        analytics: {
            enabled: true,
            realTimeMetrics: true,
            costCalculation: {
                enabled: true,
                providers: {
                    'gpt-4o': { input: 0.03, output: 0.06 },
                    'claude-3.5-sonnet': { input: 0.025, output: 0.075 }
                },
                reportingInterval: 'daily'
            },
            performanceTracking: {
                tokenReduction: true,
                bandwidthSavings: true,
                latencyImpact: true,
                errorRates: true
            }
        }
    },
    integration: {
        useExistingAggregator: true,
        useExistingPatternLearning: true,
        useExistingEventBus: true,
        useExistingMemory: true,
        useSystemLlmService: true
    }
});
```

### Agent Configuration

#### Set Agent-Specific Configuration

```typescript
// Agent inherits channel config but overrides specific settings
mxpManager.setAgentConfig('agent-1', {
    scope: {
        agentId: 'agent-1',
        inheritFromChannel: true,  // Inherit channel settings
        overrideSettings: true     // But allow overrides
    },
    modules: {
        tokenOptimization: {
            enabled: true,
            strategies: {
                contextCompression: true,
                promptOptimization: false,  // Disable for this agent
                templateMatching: true,
                entityDeduplication: false,
                toolSchemaReduction: false,
                conversationSummarization: true
            }
        }
        // Other modules inherited from channel
    }
});

// Agent completely overrides channel configuration
mxpManager.setAgentConfig('agent-2', {
    scope: {
        agentId: 'agent-2',
        inheritFromChannel: false,  // Don't inherit
        overrideSettings: true
    },
    modules: {
        tokenOptimization: {
            enabled: false  // Completely disable for this agent
        },
        bandwidthOptimization: {
            enabled: true   // But keep bandwidth optimization
        }
    }
});
```

### Get Effective Configuration

```typescript
// Get the effective configuration for an agent in a channel
const effectiveConfig = mxpManager.getEffectiveConfig('channel-1', 'agent-1');

console.log('Token Optimization Enabled:', effectiveConfig.modules.tokenOptimization?.enabled);
console.log('Security Level:', effectiveConfig.modules.security?.level);
```

### Check Feature Status

```typescript
// Check if a feature is enabled for a channel
const isTokenOptEnabled = mxpManager.isFeatureEnabled(
    'channel-1',
    'tokenOptimization'
);

// Check if a feature is enabled for a specific agent in channel
const isBandwidthOptEnabled = mxpManager.isFeatureEnabled(
    'channel-1',
    'bandwidthOptimization',
    'agent-1'
);

// Check if a specific token strategy is enabled
const isCompressionEnabled = mxpManager.isTokenStrategyEnabled(
    'channel-1',
    'contextCompression',
    'agent-1'
);
```

### Configuration Management

```typescript
// Get all channel configurations
const channelConfigs = mxpManager.getAllChannelConfigs();
channelConfigs.forEach(({ channelId, config }) => {
    console.log(`Channel ${channelId}:`, config.modules);
});

// Get all agent configurations
const agentConfigs = mxpManager.getAllAgentConfigs();
agentConfigs.forEach(({ agentId, config }) => {
    console.log(`Agent ${agentId}:`, config.scope.inheritFromChannel);
});

// Remove configurations
mxpManager.removeChannelConfig('old-channel');
mxpManager.removeAgentConfig('removed-agent');

// Get configuration statistics
const stats = mxpManager.getConfigStats();
console.log('Total Channel Configs:', stats.totalChannelConfigs);
console.log('Total Agent Configs:', stats.totalAgentConfigs);
console.log('Features Enabled:', stats.featuresEnabled);
```

## MXP 2.0 Features

### Token Optimization Module

Reduces LLM token usage through intelligent compression:

#### Strategies

| Strategy | Description | Default | Recommended For |
|----------|-------------|---------|-----------------|
| contextCompression | AI-powered context compression using SystemLLM | ✅ Enabled | All deployments |
| promptOptimization | System prompt optimization | ✅ Enabled | All deployments |
| templateMatching | Pattern-based message templating | ✅ Enabled | High-volume channels |
| entityDeduplication | Remove duplicate entities | ❌ Disabled | Experimental |
| toolSchemaReduction | Compress tool schemas | ❌ Disabled | Large tool sets |
| conversationSummarization | Summarize long conversations | ✅ Enabled | Long-running conversations |

#### Settings

```typescript
{
    settings: {
        compressionLevel: 'light' | 'standard' | 'aggressive',
        systemLlmIntegration: boolean,
        patternLearningIntegration: boolean,
        contextWindow: {
            fullContextMessages: number,      // Keep last N uncompressed
            compressionRatio: number,         // Target ratio (0.2 = 80% reduction)
            referenceMode: boolean            // Use context references
        },
        templateEngine: {
            enabled: boolean,
            maxTemplates: number,
            confidenceThreshold: number
        }
    }
}
```

### Bandwidth Optimization Module

Reduces network bandwidth through binary encoding and enhanced aggregation:

```typescript
{
    bandwidthOptimization: {
        enabled: boolean,
        encoding: 'json' | 'binary' | 'msgpack',
        compression: 'none' | 'light' | 'standard' | 'aggressive',
        enhancedBatching: boolean,          // Enhance MxfMessageAggregator
        priorityQueueIntegration: boolean,  // Use EventBus priority
        binaryProtocol: {
            enabled: boolean,
            thresholdBytes: number,         // Apply for messages > N bytes
            compressionAlgorithm: 'brotli' | 'gzip' | 'zstd'
        },
        messageAggregation: {
            similarityThreshold: number,    // 0.8 = 80% similarity
            maxBatchSize: number,           // bytes
            timeoutMs: number               // failsafe timeout
        }
    }
}
```

### Security Module

Progressive security with four levels:

#### Security Levels

| Level | Features | Use Case |
|-------|----------|----------|
| STANDARD | Current MXF security | Development, testing |
| ENHANCED | + Audit logging, key escrow | Production, enterprise |
| REGULATED | + GDPR/HIPAA, data residency | Regulated industries |
| CLASSIFIED | + E2E encryption, government-grade | Classified/military |

**Important**: Higher security levels may impact functionality:
- **CLASSIFIED** with E2E encryption disables:
  - Message aggregation
  - Pattern learning
  - Server analytics
  - Cross-agent insights

#### Configuration

```typescript
{
    security: {
        enabled: boolean,
        level: SecurityLevel,
        features: {
            auditLogging?: boolean,
            keyEscrow?: boolean,
            dataResidency?: string,
            endToEndEncryption?: boolean,  // CLASSIFIED only
            complianceMode?: 'GDPR' | 'HIPAA' | 'SOX' | 'FedRAMP'
        },
        keyManagement: {
            rotationPolicy: 'time' | 'usage' | 'both',
            rotationInterval: number,
            keyLength: 256 | 384 | 521,
            algorithm: 'AES-GCM' | 'ChaCha20-Poly1305',
            enhanceExistingKeys: boolean
        }
    }
}
```

### Analytics Module

Real-time performance tracking and cost calculation:

```typescript
{
    analytics: {
        enabled: boolean,
        realTimeMetrics: boolean,
        costCalculation: {
            enabled: boolean,
            providers: {
                [provider: string]: {
                    input: number,  // Cost per 1K tokens
                    output: number  // Cost per 1K tokens
                }
            },
            reportingInterval: 'hourly' | 'daily' | 'weekly' | 'monthly'
        },
        performanceTracking: {
            tokenReduction: boolean,
            bandwidthSavings: boolean,
            latencyImpact: boolean,
            errorRates: boolean
        }
    }
}
```

## Configuration Inheritance

MXP 2.0 supports sophisticated configuration inheritance:

### Inheritance Rules

1. **Default Config**: Base configuration from `DEFAULT_MXP_CONFIG`
2. **Channel Config**: Applied to all agents in channel
3. **Agent Config**: Overrides channel settings based on `inheritFromChannel` flag

### Inheritance Example

```typescript
// Channel configuration
mxpManager.setChannelConfig('channel-1', {
    modules: {
        tokenOptimization: {
            enabled: true,
            strategies: {
                contextCompression: true,
                promptOptimization: true,
                templateMatching: false
            }
        }
    }
});

// Agent 1: Inherits and extends
mxpManager.setAgentConfig('agent-1', {
    scope: {
        inheritFromChannel: true  // Inherit channel config
    },
    modules: {
        tokenOptimization: {
            strategies: {
                templateMatching: true  // Override: enable templateMatching
            }
        }
    }
});
// Result: agent-1 has all channel settings + templateMatching enabled

// Agent 2: Complete override
mxpManager.setAgentConfig('agent-2', {
    scope: {
        inheritFromChannel: false  // Don't inherit
    },
    modules: {
        tokenOptimization: {
            enabled: false  // Disable completely for this agent
        }
    }
});
// Result: agent-2 has tokenOptimization disabled, all other settings default
```

## Default Configuration

MXP 2.0 includes sensible defaults optimized for production use:

```typescript
const DEFAULT_MXP_CONFIG = {
    version: '2.0',
    scope: {
        inheritFromChannel: true,
        overrideSettings: true
    },
    modules: {
        tokenOptimization: {
            enabled: true,
            strategies: {
                contextCompression: true,        // ✅
                promptOptimization: true,        // ✅
                templateMatching: true,          // ✅
                entityDeduplication: false,      // ❌ experimental
                toolSchemaReduction: false,      // ❌ needs testing
                conversationSummarization: true  // ✅
            },
            settings: {
                compressionLevel: 'standard',
                systemLlmIntegration: true,
                patternLearningIntegration: true,
                contextWindow: {
                    fullContextMessages: 5,
                    compressionRatio: 0.2,
                    referenceMode: true
                },
                templateEngine: {
                    enabled: true,
                    maxTemplates: 100,
                    confidenceThreshold: 0.8
                }
            }
        },
        bandwidthOptimization: {
            enabled: true,
            encoding: 'json',
            compression: 'standard',
            enhancedBatching: true,
            priorityQueueIntegration: true,
            binaryProtocol: {
                enabled: true,
                thresholdBytes: 10240,
                compressionAlgorithm: 'brotli'
            },
            messageAggregation: {
                similarityThreshold: 0.8,
                maxBatchSize: 65536,
                timeoutMs: 180000
            }
        },
        security: {
            enabled: true,
            level: SecurityLevel.ENHANCED,
            features: {
                auditLogging: true,
                keyEscrow: true,
                complianceMode: 'GDPR'
            },
            keyManagement: {
                rotationPolicy: 'both',
                rotationInterval: 2592000000,
                keyLength: 256,
                algorithm: 'AES-GCM',
                enhanceExistingKeys: true
            }
        },
        analytics: {
            enabled: true,
            realTimeMetrics: true,
            costCalculation: {
                enabled: true,
                providers: {
                    'gpt-4o': { input: 0.03, output: 0.06 },
                    'claude-3.5-sonnet': { input: 0.025, output: 0.075 },
                    'gemini-pro': { input: 0.02, output: 0.04 }
                },
                reportingInterval: 'daily'
            },
            performanceTracking: {
                tokenReduction: true,
                bandwidthSavings: true,
                latencyImpact: true,
                errorRates: true
            }
        }
    },
    integration: {
        useExistingAggregator: true,
        useExistingPatternLearning: true,
        useExistingEventBus: true,
        useExistingMemory: true,
        useSystemLlmService: true
    }
};
```

## Integration with MXF Services

MXP 2.0 integrates seamlessly with existing MXF services:

### SystemLlmService Integration

```typescript
{
    integration: {
        useSystemLlmService: true  // Enable SystemLLM for optimization
    },
    modules: {
        tokenOptimization: {
            settings: {
                systemLlmIntegration: true  // Use SystemLLM for compression
            }
        }
    }
}
```

### PatternLearningService Integration

```typescript
{
    integration: {
        useExistingPatternLearning: true  // Enable pattern learning
    },
    modules: {
        tokenOptimization: {
            settings: {
                patternLearningIntegration: true  // Learn from patterns
            }
        }
    }
}
```

### MxfMessageAggregator Integration

```typescript
{
    integration: {
        useExistingAggregator: true  // Enhance existing aggregator
    },
    modules: {
        bandwidthOptimization: {
            enhancedBatching: true,  // Enhance aggregation
            messageAggregation: {
                similarityThreshold: 0.8,  // Use existing threshold
                timeoutMs: 180000          // Use existing 3-min failsafe
            }
        }
    }
}
```

### EventBus Integration

```typescript
{
    integration: {
        useExistingEventBus: true  // Use EventBus priority queuing
    },
    modules: {
        bandwidthOptimization: {
            priorityQueueIntegration: true  // Enable priority queue
        }
    }
}
```

## Best Practices

### Configuration Strategy

1. **Start with Defaults**: Default configuration provides a solid starting point
2. **Enable Incrementally**: Start with analytics, then token optimization, then bandwidth
3. **Test Strategies**: Test experimental strategies (entityDeduplication, toolSchemaReduction) in development first
4. **Monitor Impact**: Use analytics to measure optimization effectiveness

### Channel vs Agent Configuration

1. **Channel-Level**: Set common policies for all agents
2. **Agent-Level**: Override for agents with specific requirements
3. **Inheritance**: Use inheritance to minimize configuration duplication
4. **Documentation**: Document why agent overrides are needed

### Security Considerations

1. **Match Requirements**: Choose security level that matches regulatory requirements
2. **Understand Trade-offs**: Higher security levels may disable some features
3. **Key Rotation**: Configure appropriate key rotation policies
4. **Compliance**: Enable compliance mode for regulated industries

### Performance Optimization

1. **Compression Levels**: Start with 'standard', adjust based on performance
2. **Context Window**: Balance between context quality and token reduction
3. **Batch Sizing**: Tune maxBatchSize based on message patterns
4. **Monitoring**: Enable analytics to track optimization effectiveness

## Type Safety

All types are fully typed for TypeScript safety:

```typescript
import {
    MxpConfig,
    SecurityLevel,
    TokenOptimizationStrategy,
    MxpOptimizationResult,
    ContextCompressionResult,
    MessageTemplate
} from './src/shared/types/MxpTypes';

// Type-safe configuration
const config: MxpConfig = mxpManager.getEffectiveConfig('channel-1');

// Type-safe security level
const securityLevel: SecurityLevel = SecurityLevel.ENHANCED;

// Type-safe strategy
const strategy: TokenOptimizationStrategy = 'context_compression';
```

## Related Documentation

- [MXP 2.0 Protocol](../mxf/mxp-protocol.md) - Understanding MXP 2.0 features
- [MXP Technical Specification](../mxf/mxp-technical-specification.md) - Detailed technical spec
- [SDK Configuration Manager](./config-manager.md) - SDK-level configuration
- [Context Compression](./mxp-context-compression.md) - Context compression engine

---

For questions or issues with MxpConfigManager, refer to the source code at `/src/shared/mxp/MxpConfigManager.ts`.
