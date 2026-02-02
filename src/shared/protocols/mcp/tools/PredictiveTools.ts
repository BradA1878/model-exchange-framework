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
 * MCP Predictive Analytics Tools
 *
 * MCP tool wrappers for PredictiveAnalyticsService, providing agents with
 * ML-based error prediction, anomaly detection, proactive suggestions,
 * risk scoring, and model metadata inspection.
 *
 * When TensorFlow.js is enabled (TENSORFLOW_ENABLED=true), these tools
 * use trained ML models for inference. Otherwise they fall back to
 * heuristic-based predictions transparently.
 */

import { McpToolDefinition, McpToolHandlerResult } from '../McpServerTypes';
import { Logger } from '../../../utils/Logger';
import { PredictiveAnalyticsService } from '../../../services/PredictiveAnalyticsService';

const logger = new Logger('info', 'PredictiveTools', 'server');

/**
 * Create consistent tool result payloads
 */
function createToolResult(success: boolean, data: any): McpToolHandlerResult {
    return {
        content: {
            type: 'application/json',
            data: { success, ...data }
        }
    };
}

/**
 * 1. Predict Errors — ML-based error probability prediction for tool calls
 *
 * Uses PredictiveAnalyticsService.predictErrors() which dispatches to a
 * TF.js Dense classifier when trained, or falls back to heuristic scoring.
 */
export const predict_errors: McpToolDefinition = {
    name: 'predict_errors',
    description: 'Predict the probability of errors for a tool call using ML models. Returns error probability, confidence, model type (neural network vs heuristic), and an explanation of risk factors. Use before executing high-risk tool calls.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of the tool to predict errors for'
            },
            parameters: {
                type: 'object',
                description: 'Parameters that will be passed to the tool (optional)',
                additionalProperties: true
            }
        },
        required: ['toolName'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ toolName, parameters = {} }: any, { agentId, channelId }: any) => {
        try {
            const service = PredictiveAnalyticsService.getInstance();
            const result = await service.predictErrors(agentId, channelId, toolName, parameters);

            return createToolResult(true, {
                probability: result.prediction.value,
                confidence: result.prediction.confidence,
                explanation: result.prediction.explanation,
                model: {
                    type: result.model.type,
                    version: result.model.version,
                    accuracy: result.model.accuracy
                },
                features: {
                    toolComplexity: result.features.toolComplexity,
                    parameterCount: result.features.parameterCount,
                    parameterPatternMatch: result.features.parameterPatternMatch,
                    agentExperience: result.features.agentExperience,
                    agentErrorRate: result.features.agentErrorRate
                },
                predictionId: result.predictionId
            });
        } catch (error: any) {
            logger.error('Error in predict_errors:', error);
            return createToolResult(false, { error: `Failed to predict errors: ${error.message}` });
        }
    }
};

/**
 * 2. Detect Anomalies — ML-based anomaly detection for tool parameters and behavior
 *
 * Uses PredictiveAnalyticsService.detectAnomalies() which checks parameter anomalies
 * (TF.js autoencoder or heuristic isolation scoring), behavioral anomalies,
 * performance anomalies, and pattern anomalies.
 */
export const detect_anomalies: McpToolDefinition = {
    name: 'detect_anomalies',
    description: 'Detect anomalies in tool parameters, agent behavior, performance, and usage patterns. Returns scored anomalies with severity levels and suggested actions. Use to identify unusual patterns before or after tool execution.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of the tool to check for anomalies'
            },
            parameters: {
                type: 'object',
                description: 'Parameters to analyze for anomalies (optional)',
                additionalProperties: true
            },
            executionMetrics: {
                type: 'object',
                description: 'Execution metrics for performance anomaly detection (optional)',
                properties: {
                    latency: {
                        type: 'number',
                        description: 'Execution latency in milliseconds'
                    },
                    memoryUsage: {
                        type: 'number',
                        description: 'Memory usage in bytes'
                    },
                    errorType: {
                        type: 'string',
                        description: 'Error type if the call failed'
                    }
                },
                additionalProperties: false
            }
        },
        required: ['toolName'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ toolName, parameters = {}, executionMetrics }: any, { agentId, channelId }: any) => {
        try {
            const service = PredictiveAnalyticsService.getInstance();
            const anomalies = await service.detectAnomalies(
                agentId,
                channelId,
                toolName,
                parameters,
                executionMetrics
            );

            return createToolResult(true, {
                detected: anomalies.length > 0,
                anomalies: anomalies.map(a => ({
                    score: a.score,
                    type: a.type,
                    severity: a.severity,
                    description: a.description,
                    suggestedAction: a.suggestedAction
                })),
                count: anomalies.length
            });
        } catch (error: any) {
            logger.error('Error in detect_anomalies:', error);
            return createToolResult(false, { error: `Failed to detect anomalies: ${error.message}` });
        }
    }
};

/**
 * 3. Proactive Suggestions — AI-generated suggestions for improving tool usage
 *
 * Uses PredictiveAnalyticsService.generateProactiveSuggestions() to analyze
 * current context and generate parameter, tool, timing, and strategy suggestions.
 */
export const proactive_suggestions: McpToolDefinition = {
    name: 'proactive_suggestions',
    description: 'Get proactive suggestions for improving tool usage, parameter choices, timing, and strategy. Analyzes current context, recent tool history, and error patterns to provide actionable recommendations.',
    inputSchema: {
        type: 'object',
        properties: {
            currentTool: {
                type: 'string',
                description: 'Tool currently being used or about to be used (optional)'
            },
            recentTools: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of recently used tool names (optional)'
            },
            currentTask: {
                type: 'string',
                description: 'Description of the current task (optional)'
            },
            errorHistory: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
                description: 'Recent error history for strategy analysis (optional)'
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ currentTool, recentTools, currentTask, errorHistory }: any, { agentId, channelId }: any) => {
        try {
            const service = PredictiveAnalyticsService.getInstance();
            const suggestions = await service.generateProactiveSuggestions(
                agentId,
                channelId,
                { currentTool, recentTools, currentTask, errorHistory }
            );

            return createToolResult(true, {
                suggestions: suggestions.map(s => ({
                    type: s.type,
                    title: s.title,
                    description: s.description,
                    confidence: s.confidence,
                    expectedBenefit: s.expectedBenefit
                })),
                count: suggestions.length
            });
        } catch (error: any) {
            logger.error('Error in proactive_suggestions:', error);
            return createToolResult(false, { error: `Failed to generate suggestions: ${error.message}` });
        }
    }
};

/**
 * 4. Calculate Risk — Composite risk scoring for tool operations
 *
 * Uses PredictiveAnalyticsService.calculateRiskScore() to combine error probability,
 * tool complexity, agent experience, system load, and parameter pattern match into
 * an overall risk score with mitigation strategies.
 */
export const calculate_risk: McpToolDefinition = {
    name: 'calculate_risk',
    description: 'Calculate a composite risk score (0-100) for a tool operation. Combines error probability, tool complexity, agent experience, system load, and parameter patterns. Returns risk factors with weights, mitigation strategies, and trend analysis.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of the tool to assess risk for'
            },
            parameters: {
                type: 'object',
                description: 'Parameters for the operation (optional)',
                additionalProperties: true
            },
            context: {
                type: 'object',
                description: 'Additional context for risk assessment (optional)',
                additionalProperties: true
            }
        },
        required: ['toolName'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ toolName, parameters = {}, context }: any, { agentId, channelId }: any) => {
        try {
            const service = PredictiveAnalyticsService.getInstance();
            const riskScore = await service.calculateRiskScore(
                agentId,
                channelId,
                { toolName, parameters, context }
            );

            return createToolResult(true, {
                overallRisk: riskScore.overallRisk,
                riskFactors: riskScore.riskFactors.map(f => ({
                    factor: f.factor,
                    weight: f.weight,
                    score: f.score,
                    description: f.description
                })),
                mitigation: riskScore.mitigation,
                trend: riskScore.trend,
                scoreId: riskScore.scoreId
            });
        } catch (error: any) {
            logger.error('Error in calculate_risk:', error);
            return createToolResult(false, { error: `Failed to calculate risk: ${error.message}` });
        }
    }
};

/**
 * 5. Model Metadata — Inspect ML model status, accuracy, and training info
 *
 * Uses PredictiveAnalyticsService.getModelMetadata() to return metadata for
 * all registered ML models including type, training status, accuracy, and
 * sample counts.
 */
export const model_metadata: McpToolDefinition = {
    name: 'model_metadata',
    description: 'Get metadata for all registered ML models including model type, training status, accuracy, last training time, and training data size. Use to inspect ML model health and training progress.',
    inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
    },
    enabled: true,
    handler: async (_params: any, _context: any) => {
        try {
            const service = PredictiveAnalyticsService.getInstance();
            const models = service.getModelMetadata();

            return createToolResult(true, {
                models: models.map(m => ({
                    id: m.modelId,
                    type: m.type,
                    version: m.version,
                    accuracy: m.accuracy,
                    lastTrained: m.trainedAt,
                    trainingSamples: m.trainingDataSize,
                    validationMetrics: m.validationMetrics
                })),
                count: models.length
            });
        } catch (error: any) {
            logger.error('Error in model_metadata:', error);
            return createToolResult(false, { error: `Failed to get model metadata: ${error.message}` });
        }
    }
};

/**
 * All predictive analytics tools for registration
 */
export const predictiveTools: McpToolDefinition[] = [
    predict_errors,
    detect_anomalies,
    proactive_suggestions,
    calculate_risk,
    model_metadata
];
