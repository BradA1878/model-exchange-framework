/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * MXP 2.0 Event Definitions
 * 
 * Defines all events for the Model Exchange Protocol 2.0 optimization system.
 * Integrates with existing EventBus architecture and follows MXF event patterns.
 */

import { z } from 'zod';

/**
 * MXP 2.0 Event Names
 */
export const MxpEvents = {
    // Token optimization events
    TOKEN_OPTIMIZATION_START: 'mxp:token:optimization:start',
    TOKEN_OPTIMIZATION_COMPLETE: 'mxp:token:optimization:complete',
    CONTEXT_COMPRESSED: 'mxp:token:context:compressed',
    PROMPT_OPTIMIZED: 'mxp:token:prompt:optimized',
    TEMPLATE_GENERATED: 'mxp:token:template:generated',
    TEMPLATE_APPLIED: 'mxp:token:template:applied',
    
    // Bandwidth optimization events
    BANDWIDTH_OPTIMIZATION_START: 'mxp:bandwidth:optimization:start',
    BANDWIDTH_OPTIMIZATION_COMPLETE: 'mxp:bandwidth:optimization:complete',
    MESSAGE_COMPRESSED: 'mxp:bandwidth:message:compressed',
    BATCH_CREATED: 'mxp:bandwidth:batch:created',
    BINARY_ENCODED: 'mxp:bandwidth:binary:encoded',
    
    // Security events
    SECURITY_LEVEL_CHANGED: 'mxp:security:level:changed',
    KEY_ROTATED: 'mxp:security:key:rotated',
    ENCRYPTION_ENHANCED: 'mxp:security:encryption:enhanced',
    
    // Analytics events
    OPTIMIZATION_METRICS: 'mxp:analytics:metrics',
    PERFORMANCE_REPORT: 'mxp:analytics:performance',
    COST_SAVINGS_CALCULATED: 'mxp:analytics:cost:savings'
} as const;

/**
 * MXP Token Optimization Event Data
 */
export interface MxpTokenOptimizationEventData {
    originalTokens: number;
    optimizedTokens: number;
    compressionRatio: number;
    strategy: 'context_compression' | 'prompt_optimization' | 'template_matching' | 'entity_deduplication';
    operationId: string;
    timestamp: number;
    toolsOptimized?: string[];
    contextWindowReduction?: number;
}

/**
 * MXP Bandwidth Optimization Event Data
 */
export interface MxpBandwidthOptimizationEventData {
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    encoding: 'json' | 'msgpack' | 'msgpack-compressed' | 'binary';
    operationId: string;
    timestamp: number;
    messagesAggregated?: number;
    batchingApplied?: boolean;
}

/**
 * MXP Security Event Data
 */
export interface MxpSecurityEventData {
    previousLevel?: 'standard' | 'enhanced' | 'regulated' | 'classified';
    newLevel: 'standard' | 'enhanced' | 'regulated' | 'classified';
    keyId?: string;
    rotationReason?: 'scheduled' | 'security' | 'upgrade' | 'manual';
    timestamp: number;
}

/**
 * MXP Analytics Event Data
 */
export interface MxpAnalyticsEventData {
    metricType: 'token_savings' | 'bandwidth_savings' | 'cost_reduction' | 'performance_improvement';
    value: number;
    unit: 'tokens' | 'bytes' | 'percentage' | 'milliseconds' | 'dollars';
    period: 'real_time' | 'hourly' | 'daily' | 'weekly' | 'monthly';
    timestamp: number;
    agentCount?: number;
    channelCount?: number;
}

/**
 * MXP Event Payloads Type Map
 */
export interface MxpPayloads {
    [MxpEvents.TOKEN_OPTIMIZATION_START]: MxpTokenOptimizationEventData;
    [MxpEvents.TOKEN_OPTIMIZATION_COMPLETE]: MxpTokenOptimizationEventData;
    [MxpEvents.CONTEXT_COMPRESSED]: MxpTokenOptimizationEventData;
    [MxpEvents.PROMPT_OPTIMIZED]: MxpTokenOptimizationEventData;
    [MxpEvents.TEMPLATE_GENERATED]: MxpTokenOptimizationEventData;
    [MxpEvents.TEMPLATE_APPLIED]: MxpTokenOptimizationEventData;
    
    [MxpEvents.BANDWIDTH_OPTIMIZATION_START]: MxpBandwidthOptimizationEventData;
    [MxpEvents.BANDWIDTH_OPTIMIZATION_COMPLETE]: MxpBandwidthOptimizationEventData;
    [MxpEvents.MESSAGE_COMPRESSED]: MxpBandwidthOptimizationEventData;
    [MxpEvents.BATCH_CREATED]: MxpBandwidthOptimizationEventData;
    [MxpEvents.BINARY_ENCODED]: MxpBandwidthOptimizationEventData;
    
    [MxpEvents.SECURITY_LEVEL_CHANGED]: MxpSecurityEventData;
    [MxpEvents.KEY_ROTATED]: MxpSecurityEventData;
    [MxpEvents.ENCRYPTION_ENHANCED]: MxpSecurityEventData;
    
    [MxpEvents.OPTIMIZATION_METRICS]: MxpAnalyticsEventData;
    [MxpEvents.PERFORMANCE_REPORT]: MxpAnalyticsEventData;
    [MxpEvents.COST_SAVINGS_CALCULATED]: MxpAnalyticsEventData;
}

export type MxpEventName = keyof MxpPayloads;
