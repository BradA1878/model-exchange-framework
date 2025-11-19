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
 * Validation Performance Types
 * Phase 1: Validation metrics for agent performance tracking
 */

/**
 * Validation-specific metrics for tool usage
 */
export interface ValidationMetrics {
    /** Total validation errors encountered */
    totalValidationErrors: number;
    
    /** Validation errors by tool (toolName -> error count) */
    validationErrorsByTool: Record<string, number>;
    
    /** Validation error types encountered */
    errorTypes: {
        missingRequired: number;
        unknownProperties: number;
        typeMismatch: number;
        constraintViolation: number;
        other: number;
    };
    
    /** Help tool usage metrics */
    helpToolUsage: {
        tool_help: number;
        tool_validate: number;
        tool_quick_reference: number;
        tool_validation_tips: number;
    };
    
    /** Self-correction metrics */
    selfCorrection: {
        /** Number of times agent corrected after validation error */
        successfulCorrections: number;
        /** Number of times agent failed to correct */
        failedCorrections: number;
        /** Average attempts before successful correction */
        averageAttemptsToCorrect: number;
        /** Tools that were successfully corrected */
        correctedTools: string[];
    };
    
    /** Recovery time metrics */
    recoveryTime: {
        /** Average time from error to successful retry (ms) */
        averageRecoveryTime: number;
        /** Fastest recovery time (ms) */
        fastestRecovery: number;
        /** Slowest recovery time (ms) */
        slowestRecovery: number;
        /** Recovery times by tool */
        byTool: Record<string, number>;
    };
    
    /** Parameter pattern learning */
    parameterPatterns: {
        /** Successful parameter patterns by tool */
        successfulPatterns: Record<string, Array<{
            parameters: Record<string, any>;
            frequency: number;
            lastUsed: number;
        }>>;
        /** Failed parameter patterns by tool */
        failedPatterns: Record<string, Array<{
            parameters: Record<string, any>;
            errorType: string;
            frequency: number;
            lastSeen: number;
        }>>;
    };
    
    /** Validation efficiency metrics */
    efficiency: {
        /** Percentage of tool calls that pass validation first try */
        firstTrySuccessRate: number;
        /** Percentage of validation errors that lead to help tool usage */
        helpToolUsageRate: number;
        /** Percentage of errors that are self-corrected */
        selfCorrectionRate: number;
        /** Trend over time (improving/stable/declining) */
        trend: 'improving' | 'stable' | 'declining';
    };
    
    /** Last updated timestamp */
    lastUpdated: number;
}

/**
 * Enhanced tool usage metrics with validation tracking
 */
export interface EnhancedToolUsageMetrics {
    /** Tool validation success rate (toolName -> success rate 0.0-1.0) */
    toolValidationSuccessRates: Record<string, number>;
    
    /** Common validation errors by tool */
    commonValidationErrors: Record<string, string[]>;
    
    /** Tools that trigger help tool usage most often */
    helpTriggeringTools: string[];
    
    /** Parameter correction suggestions used */
    parameterCorrections: Array<{
        tool: string;
        originalParams: Record<string, any>;
        correctedParams: Record<string, any>;
        timestamp: number;
        successful: boolean;
    }>;
}

/**
 * Validation performance analysis results
 */
export interface ValidationPerformanceAnalysis {
    /** Overall validation health score (0.0-1.0) */
    validationHealthScore: number;
    
    /** Problem areas identified */
    problemAreas: Array<{
        tool: string;
        errorRate: number;
        commonErrors: string[];
        suggestedActions: string[];
    }>;
    
    /** Learning effectiveness */
    learningEffectiveness: {
        /** Rate at which agent learns from errors */
        learningRate: number;
        /** Tools mastered (low error rate) */
        masteredTools: string[];
        /** Tools still learning */
        learningTools: string[];
        /** Tools struggling with */
        strugglingTools: string[];
    };
    
    /** Recommendations for improvement */
    recommendations: Array<{
        priority: 'high' | 'medium' | 'low';
        action: string;
        expectedImprovement: string;
        tools: string[];
    }>;
}

/**
 * Validation event for tracking
 */
export interface ValidationEvent {
    timestamp: number;
    agentId: string;
    channelId: string;
    toolName: string;
    eventType: 'validation_error' | 'validation_success' | 'help_tool_used' | 'self_correction' | 'parameter_learned';
    details: {
        parameters?: Record<string, any>;
        error?: string;
        errorType?: string;
        helpToolUsed?: string;
        correctionAttempt?: number;
        recoveryTime?: number;
    };
}