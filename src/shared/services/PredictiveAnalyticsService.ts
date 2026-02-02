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
 * PredictiveAnalyticsService - Phase 6 Advanced Analytics
 * 
 * ML-based prediction features including:
 * - Error prediction model
 * - Anomaly detection
 * - Proactive suggestions
 * - Pattern forecasting
 * - Risk scoring
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { TensorFlowEvents } from '../events/event-definitions/TensorFlowEvents';
import {
    SYSTEM_AGENT_ID,
    SYSTEM_CHANNEL_ID,
    createTfInferenceFallbackPayload,
} from '../schemas/EventPayloadSchema';
import { PatternLearningService } from './PatternLearningService';
import { MxfMLService } from './MxfMLService';
import { MxfModelType } from '../types/TensorFlowTypes';
import { isTensorFlowEnabled, getTensorFlowConfig } from '../config/tensorflow.config';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { v4 as uuidv4 } from 'uuid';

/**
 * Prediction types
 */
export enum PredictionType {
    ERROR_PROBABILITY = 'error_probability',
    PARAMETER_VALUE = 'parameter_value',
    EXECUTION_TIME = 'execution_time',
    SUCCESS_RATE = 'success_rate',
    ANOMALY_SCORE = 'anomaly_score'
}

/**
 * Model types
 */
export enum ModelType {
    RANDOM_FOREST = 'random_forest',
    GRADIENT_BOOSTING = 'gradient_boosting',
    NEURAL_NETWORK = 'neural_network',
    ISOLATION_FOREST = 'isolation_forest',
    LSTM = 'lstm'
}

/**
 * Feature vector for predictions
 */
export interface FeatureVector {
    // Tool features
    toolName: string;
    toolCategory: string;
    toolComplexity: number;
    
    // Parameter features
    parameterCount: number;
    parameterTypes: string[];
    parameterPatternMatch: number;
    
    // Agent features
    agentType: string;
    agentExperience: number; // Number of successful tool calls
    agentErrorRate: number;
    
    // Context features
    timeOfDay: number; // Hour 0-23
    dayOfWeek: number; // 0-6
    systemLoad: number;
    concurrentRequests: number;
    
    // Historical features
    recentErrors: number; // Last hour
    recentSuccesses: number;
    averageLatency: number;
}

/**
 * Prediction result
 */
export interface PredictionResult {
    predictionId: string;
    type: PredictionType;
    timestamp: number;
    prediction: {
        value: number | string | Record<string, any>;
        confidence: number;
        explanation?: string;
    };
    features: Partial<FeatureVector>;
    model: {
        type: ModelType;
        version: string;
        accuracy: number;
    };
}

/**
 * Anomaly detection result
 */
export interface AnomalyResult {
    anomalyId: string;
    timestamp: number;
    score: number; // 0-1, higher means more anomalous
    type: 'parameter' | 'behavior' | 'performance' | 'pattern';
    description: string;
    context: Record<string, any>;
    severity: 'low' | 'medium' | 'high' | 'critical';
    suggestedAction?: string;
}

/**
 * Proactive suggestion
 */
export interface ProactiveSuggestion {
    suggestionId: string;
    timestamp: number;
    type: 'parameter' | 'tool' | 'timing' | 'strategy';
    title: string;
    description: string;
    confidence: number;
    expectedBenefit: string;
    implementation?: string;
}

/**
 * Pattern forecast
 */
export interface PatternForecast {
    forecastId: string;
    pattern: string;
    timeframe: 'hour' | 'day' | 'week';
    predictions: Array<{
        timestamp: number;
        value: number;
        confidence: number;
        upperBound: number;
        lowerBound: number;
    }>;
    accuracy: number;
}

/**
 * Risk score result
 */
export interface RiskScore {
    scoreId: string;
    timestamp: number;
    overallRisk: number; // 0-100
    riskFactors: Array<{
        factor: string;
        weight: number;
        score: number;
        description: string;
    }>;
    mitigation: string[];
    trend: 'increasing' | 'stable' | 'decreasing';
}

/**
 * Model metadata
 */
export interface ModelMetadata {
    modelId: string;
    type: ModelType;
    version: string;
    trainedAt: number;
    accuracy: number;
    features: string[];
    hyperparameters: Record<string, any>;
    trainingDataSize: number;
    validationMetrics: Record<string, number>;
}

/** TF.js model ID for the error prediction Dense classifier */
const TF_ERROR_PREDICTION_MODEL_ID = 'error_prediction';

/** TF.js model ID for the anomaly detection autoencoder */
const TF_ANOMALY_AUTOENCODER_MODEL_ID = 'anomaly_autoencoder';

/** Number of features in the vectorized feature vector */
const ERROR_PREDICTION_FEATURE_COUNT = 12;

/**
 * Scale factor for normalizing autoencoder reconstruction error to 0-1 range.
 * Raw MSE is multiplied by this value and clamped to [0, 1].
 * Calibrated so that MSE ≈ 0.08 maps to the existing anomaly threshold of 0.8.
 */
const AUTOENCODER_ANOMALY_SCALE_FACTOR = 10;

/**
 * Predictive Analytics Service
 */
export class PredictiveAnalyticsService extends EventEmitter {
    private readonly logger: Logger;

    // Service dependencies
    private readonly patternLearningService: PatternLearningService;

    // TF.js error prediction model state
    // When TF.js is enabled and the model is trained, predict() uses MxfMLService.
    // Otherwise falls back to the heuristic runModel().
    private tfErrorPredictionReady: boolean = false;

    // TF.js anomaly detection autoencoder state
    // When TF.js is enabled and the autoencoder is trained, anomaly detection
    // uses reconstruction error from MxfMLService.predictWithReconstruction().
    // Otherwise falls back to the heuristic distance-based isolation score.
    private tfAnomalyAutoencoderReady: boolean = false;

    // Models (simplified in-memory implementation)
    private readonly models = new Map<string, any>();
    private readonly modelMetadata = new Map<string, ModelMetadata>();
    
    // Training data
    private readonly trainingData: Array<{
        features: FeatureVector;
        label: any;
        timestamp: number;
    }> = [];
    
    // Prediction cache
    private readonly predictionCache = new Map<string, PredictionResult>();
    
    // Anomaly detection
    private readonly anomalyThresholds = {
        parameter: 0.8,
        behavior: 0.85,
        performance: 0.9,
        pattern: 0.75
    };
    
    // Configuration
    private config = {
        enableRealTimePrediction: true,
        enableAnomalyDetection: true,
        enableProactiveSuggestions: true,
        minTrainingDataSize: 100,
        retrainInterval: 3600000, // 1 hour
        predictionCacheTTL: 300000, // 5 minutes
        maxTrainingDataSize: 10000
    };
    
    // Metrics
    private metrics = {
        predictionsMade: 0,
        anomaliesDetected: 0,
        suggestionsGenerated: 0,
        modelRetrains: 0,
        averagePredictionTime: 0,
        predictionAccuracy: 0
    };
    
    private retrainInterval?: NodeJS.Timeout;
    
    private static instance: PredictiveAnalyticsService;
    
    private constructor() {
        super();
        this.logger = new Logger('info', 'PredictiveAnalyticsService', 'server');

        // Initialize service dependencies
        this.patternLearningService = PatternLearningService.getInstance();

        this.initializeModels();
        this.setupEventListeners();
        this.startRetrainSchedule();

        // Initialize TF.js models if TensorFlow.js is enabled.
        // These are async but we fire-and-forget since the heuristic fallbacks
        // handle predictions while the models are being set up.
        if (isTensorFlowEnabled()) {
            this.initializeTfErrorPrediction().catch((error) => {
                this.logger.warn(
                    `[PredictiveAnalyticsService] TF.js error prediction init failed, ` +
                    `using heuristic fallback: ${error instanceof Error ? error.message : String(error)}`
                );
            });
            this.initializeTfAnomalyAutoencoder().catch((error) => {
                this.logger.warn(
                    `[PredictiveAnalyticsService] TF.js anomaly autoencoder init failed, ` +
                    `using heuristic fallback: ${error instanceof Error ? error.message : String(error)}`
                );
            });
        }
    }
    
    /**
     * Get singleton instance
     */
    public static getInstance(): PredictiveAnalyticsService {
        if (!PredictiveAnalyticsService.instance) {
            PredictiveAnalyticsService.instance = new PredictiveAnalyticsService();
        }
        return PredictiveAnalyticsService.instance;
    }
    
    // =============================================================================
    // TF.JS ERROR PREDICTION MODEL SETUP
    // =============================================================================

    /**
     * Initialize TF.js error prediction model.
     *
     * Registers, builds, and optionally loads a Dense(12→32→16→1) binary
     * classifier with MxfMLService. The model uses binary cross-entropy loss
     * and sigmoid output for error probability prediction.
     *
     * Architecture: input(12) → Dense(32, relu) → Dense(16, relu) → Dense(1, sigmoid)
     *
     * If a previously trained model exists in storage (GridFS), it is loaded
     * automatically. Otherwise the model starts untrained and waits for enough
     * training data (100 samples) before the first training run.
     */
    private async initializeTfErrorPrediction(): Promise<void> {
        const mlService = MxfMLService.getInstance();

        if (!mlService.isEnabled()) {
            this.logger.debug(
                '[PredictiveAnalyticsService] MxfMLService not enabled, skipping TF.js model setup'
            );
            return;
        }

        // Register the error prediction model configuration
        mlService.registerModel({
            modelId: TF_ERROR_PREDICTION_MODEL_ID,
            type: MxfModelType.DENSE_CLASSIFIER,
            inputShape: [ERROR_PREDICTION_FEATURE_COUNT],
            outputShape: [1],
            minTrainingSamples: 100,
            batchSize: 32,
            epochs: 10,
            validationSplit: 0.2,
            learningRate: 0.001,
            autoTrain: true,
            retrainIntervalMs: this.config.retrainInterval,
            hyperparameters: {
                architecture: 'dense(12)->dense(32,relu)->dense(16,relu)->dense(1,sigmoid)',
                loss: 'binaryCrossentropy',
                optimizer: 'adam',
            },
        });

        // Build the Dense(12→32→16→1) model
        await mlService.buildSequentialModel(TF_ERROR_PREDICTION_MODEL_ID, (tf) => {
            const model = tf.sequential();
            model.add(tf.layers.dense({
                units: 32,
                activation: 'relu',
                inputShape: [ERROR_PREDICTION_FEATURE_COUNT],
            }));
            model.add(tf.layers.dense({
                units: 16,
                activation: 'relu',
            }));
            model.add(tf.layers.dense({
                units: 1,
                activation: 'sigmoid',
            }));
            model.compile({
                optimizer: tf.train.adam(0.001),
                loss: 'binaryCrossentropy',
                metrics: ['accuracy'],
            });
            return model;
        });

        // Try to load a previously saved model from storage
        const loaded = await mlService.loadModel(TF_ERROR_PREDICTION_MODEL_ID);
        if (loaded) {
            this.tfErrorPredictionReady = true;
            this.logger.info(
                '[PredictiveAnalyticsService] Loaded pre-trained TF.js error prediction model'
            );
        } else {
            this.logger.info(
                '[PredictiveAnalyticsService] TF.js error prediction model built (untrained, ' +
                'will train when 100+ samples collected)'
            );
        }

        // Schedule automatic retraining with MxfMLService
        const config = getTensorFlowConfig();
        if (config.autoTrainEnabled) {
            mlService.scheduleRetrain(TF_ERROR_PREDICTION_MODEL_ID, async () => {
                await this.trainErrorPredictionModel();
            });
        }
    }

    // =============================================================================
    // TF.JS ANOMALY DETECTION AUTOENCODER SETUP
    // =============================================================================

    /**
     * Initialize TF.js anomaly detection autoencoder.
     *
     * Registers, builds, and optionally loads an autoencoder with MxfMLService.
     * The autoencoder learns to reconstruct the 12-element feature vector;
     * anomalies are inputs that reconstruct poorly (high MSE).
     *
     * Architecture: input(12) → Dense(8, relu) → Dense(4, relu) → Dense(8, relu) → Dense(12, linear)
     * - Encoder: 12 → 8 → 4 (bottleneck)
     * - Decoder: 4 → 8 → 12 (reconstruction)
     * - Loss: MSE (mean squared error)
     * - Optimizer: Adam(lr=0.001)
     *
     * Unsupervised training: trains on ALL feature vectors (input = output).
     * Normal patterns are learned; anomalies produce high reconstruction error.
     */
    private async initializeTfAnomalyAutoencoder(): Promise<void> {
        const mlService = MxfMLService.getInstance();

        if (!mlService.isEnabled()) {
            this.logger.debug(
                '[PredictiveAnalyticsService] MxfMLService not enabled, skipping anomaly autoencoder setup'
            );
            return;
        }

        // Register the anomaly autoencoder model configuration
        mlService.registerModel({
            modelId: TF_ANOMALY_AUTOENCODER_MODEL_ID,
            type: MxfModelType.AUTOENCODER,
            inputShape: [ERROR_PREDICTION_FEATURE_COUNT],
            outputShape: [ERROR_PREDICTION_FEATURE_COUNT],
            minTrainingSamples: 100,
            batchSize: 32,
            epochs: 20,
            validationSplit: 0.1,
            learningRate: 0.001,
            autoTrain: true,
            retrainIntervalMs: this.config.retrainInterval,
            hyperparameters: {
                architecture: 'dense(12)->dense(8,relu)->dense(4,relu)->dense(8,relu)->dense(12,linear)',
                loss: 'meanSquaredError',
                optimizer: 'adam',
                bottleneckSize: 4,
            },
        });

        // Build the autoencoder: encoder(12→8→4) + decoder(4→8→12)
        await mlService.buildSequentialModel(TF_ANOMALY_AUTOENCODER_MODEL_ID, (tf) => {
            const model = tf.sequential();
            // Encoder
            model.add(tf.layers.dense({
                units: 8,
                activation: 'relu',
                inputShape: [ERROR_PREDICTION_FEATURE_COUNT],
            }));
            model.add(tf.layers.dense({
                units: 4,
                activation: 'relu',
            }));
            // Decoder
            model.add(tf.layers.dense({
                units: 8,
                activation: 'relu',
            }));
            model.add(tf.layers.dense({
                units: ERROR_PREDICTION_FEATURE_COUNT,
                activation: 'linear',
            }));
            model.compile({
                optimizer: tf.train.adam(0.001),
                loss: 'meanSquaredError',
            });
            return model;
        });

        // Try to load a previously saved model from storage
        const loaded = await mlService.loadModel(TF_ANOMALY_AUTOENCODER_MODEL_ID);
        if (loaded) {
            this.tfAnomalyAutoencoderReady = true;
            this.logger.info(
                '[PredictiveAnalyticsService] Loaded pre-trained TF.js anomaly autoencoder model'
            );
        } else {
            this.logger.info(
                '[PredictiveAnalyticsService] TF.js anomaly autoencoder model built (untrained, ' +
                'will train when 100+ samples collected)'
            );
        }

        // Schedule automatic retraining with MxfMLService
        const config = getTensorFlowConfig();
        if (config.autoTrainEnabled) {
            mlService.scheduleRetrain(TF_ANOMALY_AUTOENCODER_MODEL_ID, async () => {
                await this.trainAnomalyDetectionModel();
            });
        }
    }

    // =============================================================================
    // ERROR PREDICTION
    // =============================================================================
    
    /**
     * Predict error probability
     */
    public async predictErrors(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<PredictionResult> {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey('error', agentId, toolName, parameters);
        
        // Check cache
        const cached = this.predictionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.config.predictionCacheTTL) {
            return cached;
        }
        
        // Extract features
        const features = await this.extractFeatures(agentId, channelId, toolName, parameters);
        
        // Get prediction — use TF.js model if available, otherwise heuristic
        const prediction = this.runErrorPrediction(agentId, channelId, features);

        // Report model type based on which prediction path was used
        const usedTfModel = prediction.source === 'model';
        const modelMeta = this.modelMetadata.get('error_prediction');

        const result: PredictionResult = {
            predictionId: uuidv4(),
            type: PredictionType.ERROR_PROBABILITY,
            timestamp: Date.now(),
            prediction: {
                value: prediction.probability,
                confidence: prediction.confidence,
                explanation: this.generateExplanation(features)
            },
            features,
            model: {
                type: usedTfModel ? ModelType.NEURAL_NETWORK : ModelType.GRADIENT_BOOSTING,
                version: modelMeta?.version || '1.0',
                accuracy: modelMeta?.accuracy || 0.7
            }
        };
        
        // Cache result
        this.predictionCache.set(cacheKey, result);
        
        // Update metrics
        this.metrics.predictionsMade++;
        this.updatePredictionTime(Date.now() - startTime);
        
        // Emit prediction event
        this.emit('prediction_made', result);
        
        if (prediction.probability > 0.7) {
            EventBus.server.emit(Events.Analytics.HIGH_ERROR_RISK_PREDICTED, {
                agentId,
                toolName,
                probability: prediction.probability,
                predictionId: result.predictionId
            });
        }
        
        return result;
    }
    
    /**
     * Extract features for prediction
     */
    private async extractFeatures(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<FeatureVector> {
        // Get agent metrics
        const agentMetrics = await this.getAgentMetrics(agentId);
        
        // Get tool complexity
        const toolComplexity = this.calculateToolComplexity(toolName);
        
        // Get system context
        const systemContext = this.getSystemContext();
        
        // Get pattern match score
        const patternMatch = await this.calculatePatternMatch(toolName, parameters);
        
        const features: FeatureVector = {
            // Tool features
            toolName,
            toolCategory: this.categorizeTool(toolName),
            toolComplexity,
            
            // Parameter features
            parameterCount: Object.keys(parameters).length,
            parameterTypes: Object.values(parameters).map(v => typeof v),
            parameterPatternMatch: patternMatch,
            
            // Agent features
            agentType: agentId.split('-')[0],
            agentExperience: agentMetrics.successfulCalls,
            agentErrorRate: agentMetrics.errorRate,
            
            // Context features
            timeOfDay: new Date().getHours(),
            dayOfWeek: new Date().getDay(),
            systemLoad: systemContext.load,
            concurrentRequests: systemContext.concurrentRequests,
            
            // Historical features
            recentErrors: agentMetrics.recentErrors,
            recentSuccesses: agentMetrics.recentSuccesses,
            averageLatency: agentMetrics.averageLatency
        };
        
        return features;
    }
    
    /**
     * Run error prediction, dispatching to TF.js model or heuristic fallback.
     *
     * When TF.js is enabled and the model is trained, runs inference via MxfMLService.predict().
     * The model outputs a single sigmoid value [0, 1] representing error probability.
     * Confidence is derived from model training metrics (validation accuracy).
     *
     * When TF.js is unavailable or the model is untrained, falls back to the
     * rule-based heuristic that uses feature thresholds.
     *
     * @returns Prediction with probability, confidence, source, and important features
     */
    private runErrorPrediction(
        agentId: AgentId,
        channelId: ChannelId,
        features: FeatureVector
    ): {
        probability: number;
        confidence: number;
        source: 'model' | 'heuristic';
        importantFeatures: string[];
    } {
        // Try TF.js model first
        if (this.tfErrorPredictionReady) {
            try {
                const mlService = MxfMLService.getInstance();
                const featureArray = this.vectorizeFeatures(features);
                const result = mlService.predict(TF_ERROR_PREDICTION_MODEL_ID, featureArray);

                // The model outputs a single sigmoid value (error probability)
                const probability = Math.max(0, Math.min(1, result.values[0]));

                // Confidence from model training metrics (validation accuracy, or default 0.8)
                const modelEntry = mlService.getModel(TF_ERROR_PREDICTION_MODEL_ID);
                const confidence = modelEntry?.lastTrainingMetrics?.valAccuracy
                    ?? modelEntry?.lastTrainingMetrics?.accuracy
                    ?? 0.8;

                return {
                    probability,
                    confidence,
                    source: 'model',
                    importantFeatures: ['toolComplexity', 'agentExperience', 'parameterPatternMatch'],
                };
            } catch (error) {
                // TF.js prediction failed — emit fallback event and use heuristic
                this.logger.warn(
                    `[PredictiveAnalyticsService] TF.js prediction failed, using heuristic: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                try {
                    EventBus.server.emit(
                        TensorFlowEvents.INFERENCE_FALLBACK,
                        createTfInferenceFallbackPayload(
                            channelId,
                            agentId,
                            TF_ERROR_PREDICTION_MODEL_ID,
                            'error',
                            error instanceof Error ? error.message : 'prediction_error'
                        )
                    );
                } catch {
                    // Swallow event emission errors
                }
            }
        }

        // Fall back to heuristic prediction
        return this.runHeuristicPrediction(agentId, channelId, features);
    }

    /**
     * Heuristic error prediction using rule-based feature thresholds.
     *
     * This is the original prediction logic that serves as the graceful
     * degradation fallback when TF.js is disabled, the model is untrained,
     * or inference fails. Uses hand-tuned thresholds on the 12-feature vector.
     */
    private runHeuristicPrediction(
        agentId: AgentId,
        channelId: ChannelId,
        features: FeatureVector
    ): {
        probability: number;
        confidence: number;
        source: 'model' | 'heuristic';
        importantFeatures: string[];
    } {
        // Base error rate: 10%
        let probability = 0.1;

        // High complexity tools have higher error rates
        if (features.toolComplexity > 0.7) probability += 0.2;

        // New agents have higher error rates
        if (features.agentExperience < 10) probability += 0.15;

        // High system load increases errors
        if (features.systemLoad > 0.8) probability += 0.1;

        // Many parameters increase complexity
        if (features.parameterCount > 5) probability += 0.1;

        // Pattern mismatch increases errors
        if (features.parameterPatternMatch < 0.5) probability += 0.2;

        // Recent errors indicate ongoing issues
        if (features.recentErrors > 5) probability += 0.15;

        // Cap probability
        probability = Math.min(0.95, probability);

        // Calculate confidence based on data availability
        const confidence = features.agentExperience > 50 ? 0.85 : 0.6;

        // Emit fallback event when TF.js is enabled but model isn't ready
        if (isTensorFlowEnabled() && !this.tfErrorPredictionReady) {
            try {
                EventBus.server.emit(
                    TensorFlowEvents.INFERENCE_FALLBACK,
                    createTfInferenceFallbackPayload(
                        channelId,
                        agentId,
                        TF_ERROR_PREDICTION_MODEL_ID,
                        'untrained'
                    )
                );
            } catch {
                // Swallow event emission errors
            }
        }

        return {
            probability,
            confidence,
            source: 'heuristic',
            importantFeatures: ['toolComplexity', 'agentExperience', 'parameterPatternMatch'],
        };
    }

    /**
     * Generate explanation for prediction
     */
    private generateExplanation(features: FeatureVector): string {
        const factors: string[] = [];
        
        if (features.toolComplexity > 0.7) {
            factors.push('high tool complexity');
        }
        
        if (features.agentExperience < 10) {
            factors.push('limited agent experience');
        }
        
        if (features.parameterPatternMatch < 0.5) {
            factors.push('unusual parameter pattern');
        }
        
        if (features.recentErrors > 5) {
            factors.push('recent error history');
        }
        
        if (factors.length === 0) {
            return 'Low error risk based on normal patterns';
        }
        
        return `Elevated error risk due to: ${factors.join(', ')}`;
    }
    
    // =============================================================================
    // ANOMALY DETECTION
    // =============================================================================
    
    /**
     * Detect anomalies
     */
    public async detectAnomalies(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        executionMetrics?: {
            latency?: number;
            memoryUsage?: number;
            errorType?: string;
        }
    ): Promise<AnomalyResult[]> {
        const anomalies: AnomalyResult[] = [];
        
        if (!this.config.enableAnomalyDetection) return anomalies;
        
        // Parameter anomalies
        const parameterAnomaly = await this.detectParameterAnomaly(
            agentId,
            channelId,
            toolName,
            parameters
        );
        if (parameterAnomaly) anomalies.push(parameterAnomaly);
        
        // Behavioral anomalies
        const behaviorAnomaly = await this.detectBehaviorAnomaly(
            agentId,
            toolName
        );
        if (behaviorAnomaly) anomalies.push(behaviorAnomaly);
        
        // Performance anomalies
        if (executionMetrics?.latency) {
            const performanceAnomaly = await this.detectPerformanceAnomaly(
                toolName,
                executionMetrics.latency
            );
            if (performanceAnomaly) anomalies.push(performanceAnomaly);
        }
        
        // Pattern anomalies
        const patternAnomaly = await this.detectPatternAnomaly(
            agentId,
            channelId,
            toolName,
            parameters
        );
        if (patternAnomaly) anomalies.push(patternAnomaly);
        
        // Update metrics
        this.metrics.anomaliesDetected += anomalies.length;
        
        // Emit anomaly events
        for (const anomaly of anomalies) {
            this.emit('anomaly_detected', anomaly);
            
            if (anomaly.severity === 'critical' || anomaly.severity === 'high') {
                EventBus.server.emit(Events.Analytics.ANOMALY_DETECTED, {
                    agentId,
                    toolName,
                    anomaly
                });
            }
        }
        
        return anomalies;
    }
    
    /**
     * Detect parameter anomalies.
     *
     * When TF.js autoencoder is trained, uses reconstruction error as the
     * anomaly score. Otherwise falls back to heuristic distance-based
     * isolation scoring against historical parameter patterns.
     */
    private async detectParameterAnomaly(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<AnomalyResult | null> {
        // Get historical parameter patterns (used by heuristic fallback)
        const patterns = await this.getParameterPatterns(toolName);

        // Calculate anomaly score — dispatches to TF.js autoencoder or heuristic
        const score = await this.runParameterAnomalyDetection(
            agentId, channelId, toolName, parameters, patterns
        );
        
        if (score > this.anomalyThresholds.parameter) {
            return {
                anomalyId: uuidv4(),
                timestamp: Date.now(),
                score,
                type: 'parameter',
                description: `Unusual parameter combination for ${toolName}`,
                context: { toolName, parameters },
                severity: score > 0.9 ? 'high' : 'medium',
                suggestedAction: 'Review parameter values and validate against expected patterns'
            };
        }
        
        return null;
    }
    
    /**
     * Detect behavioral anomalies
     */
    private async detectBehaviorAnomaly(
        agentId: AgentId,
        toolName: string
    ): Promise<AnomalyResult | null> {
        // Get agent's typical behavior
        const typicalBehavior = await this.getAgentBehavior(agentId);
        
        // Check for unusual tool usage
        if (!typicalBehavior.commonTools.includes(toolName)) {
            const score = 0.85; // Fixed score for new tool usage
            
            return {
                anomalyId: uuidv4(),
                timestamp: Date.now(),
                score,
                type: 'behavior',
                description: `Agent ${agentId} using unfamiliar tool ${toolName}`,
                context: { agentId, toolName, typicalTools: typicalBehavior.commonTools },
                severity: 'low',
                suggestedAction: 'Monitor for potential errors with unfamiliar tool'
            };
        }
        
        return null;
    }
    
    /**
     * Detect performance anomalies
     */
    private async detectPerformanceAnomaly(
        toolName: string,
        latency: number
    ): Promise<AnomalyResult | null> {
        // Get historical performance data
        const perfData = await this.getPerformanceHistory(toolName);
        
        // Calculate z-score
        const mean = perfData.avgLatency;
        const stdDev = perfData.stdDevLatency;
        const zScore = Math.abs((latency - mean) / stdDev);
        
        // Convert to anomaly score (0-1)
        const score = Math.min(1, zScore / 4); // 4 sigma = score of 1
        
        if (score > this.anomalyThresholds.performance) {
            return {
                anomalyId: uuidv4(),
                timestamp: Date.now(),
                score,
                type: 'performance',
                description: `Abnormal latency for ${toolName}: ${latency}ms (expected: ${mean.toFixed(0)}ms)`,
                context: { toolName, latency, expectedLatency: mean, zScore },
                severity: latency > mean * 3 ? 'high' : 'medium',
                suggestedAction: 'Investigate performance bottleneck or system resource constraints'
            };
        }
        
        return null;
    }
    
    /**
     * Detect pattern anomalies
     */
    private async detectPatternAnomaly(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<AnomalyResult | null> {
        // Get learned patterns
        const patterns = await this.patternLearningService.getEnhancedPatterns(
            channelId,
            'tool_sequence'
        );
        
        // Check if current usage fits patterns
        const allPatterns = [...patterns.successful, ...patterns.shared];
        const patternMatch = this.matchesPatterns(toolName, parameters, allPatterns);
        const score = 1 - patternMatch; // Invert match to get anomaly score
        
        if (score > this.anomalyThresholds.pattern) {
            return {
                anomalyId: uuidv4(),
                timestamp: Date.now(),
                score,
                type: 'pattern',
                description: 'Tool usage deviates from established patterns',
                context: { agentId, toolName, expectedPatterns: allPatterns.slice(0, 3) },
                severity: 'medium',
                suggestedAction: 'Verify if new usage pattern is intentional'
            };
        }
        
        return null;
    }
    
    /**
     * Run parameter anomaly detection, dispatching to TF.js autoencoder or heuristic.
     *
     * When TF.js autoencoder is trained:
     * - Extracts the 12-element normalized feature vector
     * - Runs predictWithReconstruction() to get reconstruction error
     * - Normalizes error to 0-1 range using AUTOENCODER_ANOMALY_SCALE_FACTOR
     *
     * When TF.js is unavailable or untrained:
     * - Falls back to heuristic distance-based isolation scoring
     * - Emits INFERENCE_FALLBACK event for observability
     */
    private async runParameterAnomalyDetection(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        historicalPatterns: any[]
    ): Promise<number> {
        // Try TF.js autoencoder first
        if (this.tfAnomalyAutoencoderReady) {
            try {
                const mlService = MxfMLService.getInstance();
                const features = await this.extractFeatures(agentId, channelId, toolName, parameters);
                const featureArray = this.vectorizeFeatures(features);
                const result = mlService.predictWithReconstruction(
                    TF_ANOMALY_AUTOENCODER_MODEL_ID,
                    featureArray
                );

                // Normalize reconstruction error to 0-1 range
                // Higher reconstruction error = more anomalous
                return Math.min(1, result.reconstructionError * AUTOENCODER_ANOMALY_SCALE_FACTOR);
            } catch (error) {
                // TF.js inference failed — emit fallback event and use heuristic
                this.logger.warn(
                    `[PredictiveAnalyticsService] TF.js anomaly autoencoder inference failed, ` +
                    `using heuristic: ${error instanceof Error ? error.message : String(error)}`
                );
                try {
                    EventBus.server.emit(
                        TensorFlowEvents.INFERENCE_FALLBACK,
                        createTfInferenceFallbackPayload(
                            channelId,
                            agentId,
                            TF_ANOMALY_AUTOENCODER_MODEL_ID,
                            'error',
                            error instanceof Error ? error.message : 'prediction_error'
                        )
                    );
                } catch {
                    // Swallow event emission errors
                }
            }
        }

        // Emit fallback event when TF.js is enabled but autoencoder isn't ready
        if (isTensorFlowEnabled() && !this.tfAnomalyAutoencoderReady) {
            try {
                EventBus.server.emit(
                    TensorFlowEvents.INFERENCE_FALLBACK,
                    createTfInferenceFallbackPayload(
                        channelId,
                        agentId,
                        TF_ANOMALY_AUTOENCODER_MODEL_ID,
                        'untrained'
                    )
                );
            } catch {
                // Swallow event emission errors
            }
        }

        // Fall back to heuristic isolation scoring
        return this.calculateHeuristicIsolationScore(parameters, historicalPatterns);
    }

    /**
     * Heuristic isolation score using distance-based parameter comparison.
     *
     * This is the original isolation forest scoring logic that serves as the
     * graceful degradation fallback when TF.js is disabled, the autoencoder
     * is untrained, or inference fails.
     */
    private calculateHeuristicIsolationScore(
        parameters: Record<string, any>,
        historicalPatterns: any[]
    ): number {
        // Simplified isolation forest scoring
        if (historicalPatterns.length === 0) return 0.5;

        // Calculate distance to nearest patterns
        let minDistance = Infinity;

        for (const pattern of historicalPatterns) {
            const distance = this.calculateParameterDistance(parameters, pattern);
            minDistance = Math.min(minDistance, distance);
        }

        // Convert distance to anomaly score
        return Math.min(1, minDistance / 10);
    }
    
    /**
     * Calculate parameter distance
     */
    private calculateParameterDistance(
        params1: Record<string, any>,
        params2: Record<string, any>
    ): number {
        let distance = 0;
        const allKeys = new Set([...Object.keys(params1), ...Object.keys(params2)]);
        
        for (const key of allKeys) {
            if (!(key in params1) || !(key in params2)) {
                distance += 1;
            } else if (params1[key] !== params2[key]) {
                distance += 0.5;
            }
        }
        
        return distance;
    }
    
    // =============================================================================
    // PROACTIVE SUGGESTIONS
    // =============================================================================
    
    /**
     * Generate proactive suggestions
     */
    public async generateProactiveSuggestions(
        agentId: AgentId,
        channelId: ChannelId,
        context: {
            currentTool?: string;
            recentTools?: string[];
            currentTask?: string;
            errorHistory?: any[];
        }
    ): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];
        
        if (!this.config.enableProactiveSuggestions) return suggestions;
        
        // Parameter suggestions
        if (context.currentTool) {
            const paramSuggestions = await this.generateParameterSuggestions(
                context.currentTool,
                context.errorHistory
            );
            suggestions.push(...paramSuggestions);
        }
        
        // Tool suggestions
        if (context.currentTask) {
            const toolSuggestions = await this.generateToolSuggestions(
                context.currentTask,
                context.recentTools || []
            );
            suggestions.push(...toolSuggestions);
        }
        
        // Timing suggestions
        const timingSuggestions = await this.generateTimingSuggestions(agentId);
        suggestions.push(...timingSuggestions);
        
        // Strategy suggestions
        if (context.errorHistory && context.errorHistory.length > 3) {
            const strategySuggestions = await this.generateStrategySuggestions(
                context.errorHistory
            );
            suggestions.push(...strategySuggestions);
        }
        
        // Sort by confidence
        suggestions.sort((a, b) => b.confidence - a.confidence);
        
        // Update metrics
        this.metrics.suggestionsGenerated += suggestions.length;
        
        return suggestions;
    }
    
    /**
     * Generate parameter suggestions
     */
    private async generateParameterSuggestions(
        toolName: string,
        errorHistory?: any[]
    ): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];
        
        // Analyze error patterns
        const commonErrors = this.analyzeErrorPatterns(errorHistory || []);
        
        if (commonErrors.includes('missing_required_parameter')) {
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'parameter',
                title: 'Include all required parameters',
                description: `Tool ${toolName} requires specific parameters that are often missing`,
                confidence: 0.9,
                expectedBenefit: 'Reduce validation errors by 80%',
                implementation: 'Use tool_help to see required parameters'
            });
        }
        
        if (commonErrors.includes('invalid_parameter_type')) {
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'parameter',
                title: 'Check parameter types',
                description: 'Parameter type mismatches are causing validation failures',
                confidence: 0.85,
                expectedBenefit: 'Eliminate type-related errors',
                implementation: 'Use validation_preview before execution'
            });
        }
        
        return suggestions;
    }
    
    /**
     * Generate tool suggestions
     */
    private async generateToolSuggestions(
        task: string,
        recentTools: string[]
    ): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];
        
        // Suggest tools based on task patterns
        if (task.includes('search') && !recentTools.includes('web_search')) {
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'tool',
                title: 'Consider using web_search tool',
                description: 'The web_search tool might be helpful for this task',
                confidence: 0.75,
                expectedBenefit: 'Find relevant information quickly'
            });
        }
        
        if (task.includes('calculate') && !recentTools.includes('calculator')) {
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'tool',
                title: 'Use calculator for computations',
                description: 'The calculator tool can handle mathematical operations',
                confidence: 0.8,
                expectedBenefit: 'Accurate calculations without errors'
            });
        }
        
        return suggestions;
    }
    
    /**
     * Generate timing suggestions
     */
    private async generateTimingSuggestions(
        agentId: AgentId
    ): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];
        const currentHour = new Date().getHours();
        
        // Analyze agent's success patterns by time
        const successByHour = await this.getSuccessRateByHour(agentId);
        
        if (successByHour[currentHour] < 0.7) {
            const bestHour = this.findBestHour(successByHour);
            
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'timing',
                title: 'Consider scheduling complex tasks differently',
                description: `Your success rate is higher around ${bestHour}:00`,
                confidence: 0.7,
                expectedBenefit: `Improve success rate by ${((successByHour[bestHour] - successByHour[currentHour]) * 100).toFixed(0)}%`
            });
        }
        
        return suggestions;
    }
    
    /**
     * Generate strategy suggestions
     */
    private async generateStrategySuggestions(
        errorHistory: any[]
    ): Promise<ProactiveSuggestion[]> {
        const suggestions: ProactiveSuggestion[] = [];
        
        // Detect repeated errors
        const errorCounts = new Map<string, number>();
        for (const error of errorHistory) {
            const key = error.type || error.message;
            errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
        }
        
        // Find most common error
        let maxCount = 0;
        let commonError = '';
        for (const [error, count] of errorCounts) {
            if (count > maxCount) {
                maxCount = count;
                commonError = error;
            }
        }
        
        if (maxCount > 3) {
            suggestions.push({
                suggestionId: uuidv4(),
                timestamp: Date.now(),
                type: 'strategy',
                title: 'Address recurring error pattern',
                description: `Error "${commonError}" has occurred ${maxCount} times`,
                confidence: 0.9,
                expectedBenefit: 'Eliminate most common error source',
                implementation: 'Use error_diagnose tool for root cause analysis'
            });
        }
        
        return suggestions;
    }
    
    // =============================================================================
    // PATTERN FORECASTING
    // =============================================================================
    
    /**
     * Forecast patterns
     */
    public async forecastPatterns(
        pattern: string,
        timeframe: 'hour' | 'day' | 'week'
    ): Promise<PatternForecast> {
        // Get historical data
        const historicalData = await this.getPatternHistory(pattern, timeframe);
        
        // Simple time series forecasting
        const predictions = this.performTimeSeriesForecast(
            historicalData,
            timeframe
        );
        
        const forecast: PatternForecast = {
            forecastId: uuidv4(),
            pattern,
            timeframe,
            predictions,
            accuracy: this.calculateForecastAccuracy(historicalData)
        };
        
        return forecast;
    }
    
    /**
     * Perform time series forecasting
     */
    private performTimeSeriesForecast(
        data: number[],
        timeframe: string
    ): Array<{
        timestamp: number;
        value: number;
        confidence: number;
        upperBound: number;
        lowerBound: number;
    }> {
        const predictions = [];
        const periods = timeframe === 'hour' ? 6 : timeframe === 'day' ? 7 : 4;
        
        // Simple moving average forecast
        const windowSize = Math.min(data.length, 10);
        const recentData = data.slice(-windowSize);
        const avg = recentData.reduce((a, b) => a + b, 0) / recentData.length;
        const stdDev = Math.sqrt(
            recentData.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recentData.length
        );
        
        const now = Date.now();
        const interval = timeframe === 'hour' ? 3600000 : timeframe === 'day' ? 86400000 : 604800000;
        
        for (let i = 1; i <= periods; i++) {
            // Add trend component
            const trend = (data[data.length - 1] - data[0]) / data.length * i;
            const value = avg + trend;
            
            predictions.push({
                timestamp: now + i * interval,
                value: Math.max(0, value),
                confidence: Math.max(0.5, 1 - (i * 0.1)), // Confidence decreases with distance
                upperBound: value + 2 * stdDev,
                lowerBound: Math.max(0, value - 2 * stdDev)
            });
        }
        
        return predictions;
    }
    
    /**
     * Calculate forecast accuracy
     */
    private calculateForecastAccuracy(data: number[]): number {
        // Use last 20% of data for validation
        const splitIndex = Math.floor(data.length * 0.8);
        const training = data.slice(0, splitIndex);
        const validation = data.slice(splitIndex);
        
        if (validation.length === 0) return 0.7; // Default accuracy
        
        // Make predictions on training data
        const predictions = this.performTimeSeriesForecast(training, 'hour');
        
        // Calculate MAPE (Mean Absolute Percentage Error)
        let totalError = 0;
        for (let i = 0; i < Math.min(predictions.length, validation.length); i++) {
            const actual = validation[i];
            const predicted = predictions[i].value;
            if (actual !== 0) {
                totalError += Math.abs((actual - predicted) / actual);
            }
        }
        
        const mape = totalError / Math.min(predictions.length, validation.length);
        return Math.max(0, 1 - mape); // Convert to accuracy
    }
    
    // =============================================================================
    // RISK SCORING
    // =============================================================================
    
    /**
     * Calculate risk score
     */
    public async calculateRiskScore(
        agentId: AgentId,
        channelId: ChannelId,
        operation: {
            toolName: string;
            parameters: Record<string, any>;
            context?: Record<string, any>;
        }
    ): Promise<RiskScore> {
        const riskFactors: Array<{
            factor: string;
            weight: number;
            score: number;
            description: string;
        }> = [];
        
        // Error probability risk
        const errorPrediction = await this.predictErrors(
            agentId,
            channelId,
            operation.toolName,
            operation.parameters
        );
        
        riskFactors.push({
            factor: 'error_probability',
            weight: 0.3,
            score: errorPrediction.prediction.value as number * 100,
            description: `${((errorPrediction.prediction.value as number) * 100).toFixed(0)}% chance of error`
        });
        
        // Tool complexity risk
        const complexity = this.calculateToolComplexity(operation.toolName);
        riskFactors.push({
            factor: 'tool_complexity',
            weight: 0.2,
            score: complexity * 100,
            description: `Tool complexity: ${complexity > 0.7 ? 'High' : complexity > 0.4 ? 'Medium' : 'Low'}`
        });
        
        // Agent experience risk
        const agentMetrics = await this.getAgentMetrics(agentId);
        const experienceRisk = Math.max(0, 1 - (agentMetrics.successfulCalls / 100));
        riskFactors.push({
            factor: 'agent_experience',
            weight: 0.2,
            score: experienceRisk * 100,
            description: `Agent has ${agentMetrics.successfulCalls} successful operations`
        });
        
        // System load risk
        const systemContext = this.getSystemContext();
        riskFactors.push({
            factor: 'system_load',
            weight: 0.15,
            score: systemContext.load * 100,
            description: `System load: ${(systemContext.load * 100).toFixed(0)}%`
        });
        
        // Parameter pattern risk
        const patternMatch = await this.calculatePatternMatch(
            operation.toolName,
            operation.parameters
        );
        const patternRisk = 1 - patternMatch;
        riskFactors.push({
            factor: 'parameter_pattern',
            weight: 0.15,
            score: patternRisk * 100,
            description: `Parameter pattern match: ${(patternMatch * 100).toFixed(0)}%`
        });
        
        // Calculate overall risk
        const overallRisk = riskFactors.reduce(
            (total, factor) => total + factor.score * factor.weight,
            0
        );
        
        // Determine trend
        const historicalRisk = await this.getHistoricalRisk(agentId);
        const trend = overallRisk > historicalRisk + 5 ? 'increasing' :
                     overallRisk < historicalRisk - 5 ? 'decreasing' : 'stable';
        
        // Generate mitigation strategies
        const mitigation = this.generateMitigationStrategies(riskFactors);
        
        const riskScore: RiskScore = {
            scoreId: uuidv4(),
            timestamp: Date.now(),
            overallRisk,
            riskFactors,
            mitigation,
            trend
        };
        
        return riskScore;
    }
    
    /**
     * Generate mitigation strategies
     */
    private generateMitigationStrategies(
        riskFactors: Array<{ factor: string; score: number }>
    ): string[] {
        const strategies: string[] = [];
        
        for (const factor of riskFactors) {
            if (factor.score > 70) {
                switch (factor.factor) {
                    case 'error_probability':
                        strategies.push('Use validation_preview before execution');
                        strategies.push('Review parameters with tool_help');
                        break;
                    case 'tool_complexity':
                        strategies.push('Break operation into smaller steps');
                        strategies.push('Use simpler alternative tools if available');
                        break;
                    case 'agent_experience':
                        strategies.push('Start with simpler operations');
                        strategies.push('Use help tools for guidance');
                        break;
                    case 'system_load':
                        strategies.push('Defer non-critical operations');
                        strategies.push('Enable async validation mode');
                        break;
                    case 'parameter_pattern':
                        strategies.push('Review successful parameter examples');
                        strategies.push('Use validation_hints for suggestions');
                        break;
                }
            }
        }
        
        return [...new Set(strategies)]; // Remove duplicates
    }
    
    // =============================================================================
    // MODEL MANAGEMENT
    // =============================================================================
    
    /**
     * Initialize models
     */
    private initializeModels(): void {
        // Initialize simplified models
        // In production, would load actual trained models
        
        this.models.set('error_prediction', {
            type: ModelType.GRADIENT_BOOSTING,
            predict: (features: number[]) => ({ score: 0.5, confidence: 0.7 })
        });
        
        this.models.set('anomaly_detection', {
            type: ModelType.ISOLATION_FOREST,
            predict: (features: number[]) => ({ score: 0.5 })
        });
        
        this.models.set('pattern_forecast', {
            type: ModelType.LSTM,
            predict: (sequence: number[]) => sequence[sequence.length - 1] * 1.1
        });
        
        // Set metadata
        for (const [name, model] of this.models) {
            this.modelMetadata.set(name, {
                modelId: uuidv4(),
                type: model.type,
                version: '1.0.0',
                trainedAt: Date.now(),
                accuracy: 0.75,
                features: [],
                hyperparameters: {},
                trainingDataSize: 1000,
                validationMetrics: { accuracy: 0.75, precision: 0.8, recall: 0.7 }
            });
        }
    }
    
    /**
     * Train models
     */
    public async trainModels(): Promise<void> {
        if (this.trainingData.length < this.config.minTrainingDataSize) {
            return;
        }

        try {
            // Train error prediction model
            await this.trainErrorPredictionModel();

            // Train anomaly detection model
            await this.trainAnomalyDetectionModel();

            // Update metrics
            this.metrics.modelRetrains++;
        } catch (error) {
            this.logger.error('Model training failed:', error);
        }
    }
    
    /**
     * Train error prediction model.
     *
     * When TF.js is enabled and sufficient training samples exist:
     * - Vectorizes features and binary labels from collected training data
     * - Calls MxfMLService.train() to run supervised training on the Dense classifier
     * - Updates internal model metadata with real training metrics
     * - Saves the trained model to persistent storage (GridFS)
     * - Marks the TF.js model as ready for inference
     *
     * When TF.js is disabled, updates metadata with simulated accuracy
     * (preserving the original behavior for non-TF.js deployments).
     */
    private async trainErrorPredictionModel(): Promise<void> {
        // Extract features and labels from collected training data
        const features: number[][] = [];
        const labels: number[] = [];

        for (const sample of this.trainingData) {
            if (sample.label.type === 'error_occurred') {
                features.push(this.vectorizeFeatures(sample.features));
                labels.push(sample.label.value ? 1 : 0);
            }
        }

        if (features.length < 50) return;

        // Try TF.js training if enabled
        if (isTensorFlowEnabled()) {
            try {
                const mlService = MxfMLService.getInstance();

                if (!mlService.isEnabled()) {
                    this.logger.debug(
                        '[PredictiveAnalyticsService] MxfMLService not enabled, using simulated training'
                    );
                    this.updateHeuristicMetadata(features.length);
                    return;
                }

                // Ensure model is registered (idempotent check — may already be registered)
                const existingModel = mlService.getModel(TF_ERROR_PREDICTION_MODEL_ID);
                if (!existingModel) {
                    this.logger.warn(
                        '[PredictiveAnalyticsService] TF.js error prediction model not registered, ' +
                        'falling back to simulated training'
                    );
                    this.updateHeuristicMetadata(features.length);
                    return;
                }

                // Check minimum training samples for TF.js model
                if (features.length < existingModel.config.minTrainingSamples) {
                    this.logger.debug(
                        `[PredictiveAnalyticsService] Not enough training samples for TF.js: ` +
                        `${features.length}/${existingModel.config.minTrainingSamples}`
                    );
                    return;
                }

                // Format labels as 2D array for MxfMLService.train()
                const yData = labels.map(l => [l]);

                // Train the TF.js model
                const metrics = await mlService.train(
                    TF_ERROR_PREDICTION_MODEL_ID,
                    features,
                    yData
                );

                // Update internal metadata with real training metrics
                const modelMeta = this.modelMetadata.get('error_prediction');
                if (modelMeta) {
                    modelMeta.trainedAt = Date.now();
                    modelMeta.trainingDataSize = features.length;
                    modelMeta.accuracy = metrics.accuracy ?? metrics.valAccuracy ?? 0.75;
                    modelMeta.validationMetrics = {
                        accuracy: metrics.accuracy ?? 0,
                        val_accuracy: metrics.valAccuracy ?? 0,
                        loss: metrics.loss,
                        val_loss: metrics.valLoss ?? 0,
                    };
                }

                // Mark TF.js model as ready for inference
                this.tfErrorPredictionReady = true;

                // Save trained model to persistent storage
                try {
                    await mlService.saveModel(TF_ERROR_PREDICTION_MODEL_ID);
                } catch (saveError) {
                    this.logger.warn(
                        `[PredictiveAnalyticsService] Failed to save trained model: ` +
                        `${saveError instanceof Error ? saveError.message : String(saveError)}`
                    );
                }

                this.logger.info(
                    `[PredictiveAnalyticsService] TF.js error prediction model trained ` +
                    `(samples=${features.length}, loss=${metrics.loss.toFixed(4)}, ` +
                    `accuracy=${(metrics.accuracy ?? 0).toFixed(4)})`
                );

                return;
            } catch (error) {
                this.logger.error(
                    `[PredictiveAnalyticsService] TF.js training failed, updating heuristic metadata: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
                // Fall through to heuristic metadata update
            }
        }

        // Non-TF.js path: update metadata with simulated accuracy
        this.updateHeuristicMetadata(features.length);
    }

    /**
     * Update model metadata with simulated accuracy for heuristic-only mode.
     *
     * Preserves the original behavior when TF.js is disabled.
     */
    private updateHeuristicMetadata(sampleCount: number): void {
        const modelMeta = this.modelMetadata.get('error_prediction');
        if (modelMeta) {
            modelMeta.trainedAt = Date.now();
            modelMeta.trainingDataSize = sampleCount;
            modelMeta.accuracy = 0.75 + Math.random() * 0.1;
        }
    }
    
    /**
     * Train anomaly detection model.
     *
     * When TF.js is enabled and sufficient training samples exist:
     * - Vectorizes ALL feature vectors from collected training data (unsupervised —
     *   the autoencoder trains to reconstruct its input, so xData = yData)
     * - Calls MxfMLService.train() to run training on the autoencoder
     * - Updates internal model metadata with real training metrics
     * - Saves the trained model to persistent storage (GridFS)
     * - Marks the TF.js autoencoder as ready for inference
     *
     * When TF.js is disabled, updates metadata with simulated accuracy
     * (preserving the original behavior for non-TF.js deployments).
     */
    private async trainAnomalyDetectionModel(): Promise<void> {
        // Extract ALL feature vectors — autoencoder is unsupervised,
        // it learns "normal" patterns regardless of error labels
        const features: number[][] = [];

        for (const sample of this.trainingData) {
            features.push(this.vectorizeFeatures(sample.features));
        }

        // Try TF.js training if enabled
        if (isTensorFlowEnabled() && features.length > 0) {
            try {
                const mlService = MxfMLService.getInstance();

                if (!mlService.isEnabled()) {
                    this.logger.debug(
                        '[PredictiveAnalyticsService] MxfMLService not enabled, using simulated anomaly training'
                    );
                    this.updateAnomalyHeuristicMetadata();
                    return;
                }

                // Ensure model is registered
                const existingModel = mlService.getModel(TF_ANOMALY_AUTOENCODER_MODEL_ID);
                if (!existingModel) {
                    this.logger.warn(
                        '[PredictiveAnalyticsService] TF.js anomaly autoencoder model not registered, ' +
                        'falling back to simulated training'
                    );
                    this.updateAnomalyHeuristicMetadata();
                    return;
                }

                // Check minimum training samples
                if (features.length < existingModel.config.minTrainingSamples) {
                    this.logger.debug(
                        `[PredictiveAnalyticsService] Not enough training samples for anomaly autoencoder: ` +
                        `${features.length}/${existingModel.config.minTrainingSamples}`
                    );
                    return;
                }

                // Autoencoder: input = output (learns to reconstruct normal patterns)
                const metrics = await mlService.train(
                    TF_ANOMALY_AUTOENCODER_MODEL_ID,
                    features,
                    features
                );

                // Update internal metadata with real training metrics
                const modelMeta = this.modelMetadata.get('anomaly_detection');
                if (modelMeta) {
                    modelMeta.trainedAt = Date.now();
                    modelMeta.trainingDataSize = features.length;
                    // For autoencoders, accuracy is not directly applicable —
                    // use inverse of loss as a quality indicator (lower loss = better reconstruction)
                    modelMeta.accuracy = Math.max(0, Math.min(1, 1 - metrics.loss));
                    modelMeta.validationMetrics = {
                        loss: metrics.loss,
                        val_loss: metrics.valLoss ?? 0,
                    };
                }

                // Mark TF.js autoencoder as ready for inference
                this.tfAnomalyAutoencoderReady = true;

                // Save trained model to persistent storage
                try {
                    await mlService.saveModel(TF_ANOMALY_AUTOENCODER_MODEL_ID);
                } catch (saveError) {
                    this.logger.warn(
                        `[PredictiveAnalyticsService] Failed to save anomaly autoencoder model: ` +
                        `${saveError instanceof Error ? saveError.message : String(saveError)}`
                    );
                }

                this.logger.info(
                    `[PredictiveAnalyticsService] TF.js anomaly autoencoder trained ` +
                    `(samples=${features.length}, loss=${metrics.loss.toFixed(4)})`
                );

                return;
            } catch (error) {
                this.logger.error(
                    `[PredictiveAnalyticsService] TF.js anomaly autoencoder training failed, ` +
                    `updating heuristic metadata: ${error instanceof Error ? error.message : String(error)}`
                );
                // Fall through to heuristic metadata update
            }
        }

        // Non-TF.js path: update metadata with simulated accuracy
        this.updateAnomalyHeuristicMetadata();
    }

    /**
     * Update anomaly detection model metadata with simulated accuracy for heuristic-only mode.
     *
     * Preserves the original behavior when TF.js is disabled.
     */
    private updateAnomalyHeuristicMetadata(): void {
        const modelMeta = this.modelMetadata.get('anomaly_detection');
        if (modelMeta) {
            modelMeta.trainedAt = Date.now();
            modelMeta.accuracy = 0.8 + Math.random() * 0.05;
        }
    }
    
    /**
     * Vectorize features
     */
    private vectorizeFeatures(features: FeatureVector): number[] {
        return [
            features.toolComplexity,
            features.parameterCount,
            features.parameterPatternMatch,
            features.agentExperience,
            features.agentErrorRate,
            features.timeOfDay / 24,
            features.dayOfWeek / 7,
            features.systemLoad,
            features.concurrentRequests / 100,
            features.recentErrors / 10,
            features.recentSuccesses / 100,
            features.averageLatency / 1000
        ];
    }
    
    // =============================================================================
    // HELPER METHODS
    // =============================================================================
    
    /**
     * Get agent metrics
     */
    private async getAgentMetrics(agentId: AgentId): Promise<any> {
        // Would query actual metrics
        return {
            successfulCalls: 100,
            errorRate: 0.1,
            recentErrors: 2,
            recentSuccesses: 18,
            averageLatency: 150
        };
    }
    
    /**
     * Calculate tool complexity
     */
    private calculateToolComplexity(toolName: string): number {
        const complexTools = ['file_write', 'execute_command', 'database_query'];
        const simpleTools = ['calculator', 'echo', 'get_time'];
        
        if (complexTools.includes(toolName)) return 0.8;
        if (simpleTools.includes(toolName)) return 0.2;
        return 0.5;
    }
    
    /**
     * Categorize tool
     */
    private categorizeTool(toolName: string): string {
        if (!toolName) return 'general';
        if (toolName.includes('file')) return 'filesystem';
        if (toolName.includes('web') || toolName.includes('http')) return 'network';
        if (toolName.includes('calc') || toolName.includes('math')) return 'computation';
        if (toolName.includes('data') || toolName.includes('query')) return 'database';
        return 'general';
    }
    
    /**
     * Get system context
     */
    private getSystemContext(): { load: number; concurrentRequests: number } {
        return {
            load: 0.3 + Math.random() * 0.4, // Simulated
            concurrentRequests: Math.floor(Math.random() * 20)
        };
    }
    
    /**
     * Calculate pattern match
     */
    private async calculatePatternMatch(
        toolName: string,
        parameters: Record<string, any>
    ): Promise<number> {
        // Simplified pattern matching
        return 0.5 + Math.random() * 0.5;
    }
    
    /**
     * Analyze error patterns
     */
    private analyzeErrorPatterns(errors: any[]): string[] {
        const patterns: string[] = [];
        
        const errorTypes = errors.map(e => e.type || 'unknown');
        const typeCounts = new Map<string, number>();
        
        for (const type of errorTypes) {
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
        
        for (const [type, count] of typeCounts) {
            if (count > 2) patterns.push(type);
        }
        
        return patterns;
    }
    
    /**
     * Get parameter patterns
     */
    private async getParameterPatterns(toolName: string): Promise<any[]> {
        // Would retrieve from pattern learning service
        return [];
    }
    
    /**
     * Get agent behavior
     */
    private async getAgentBehavior(agentId: AgentId): Promise<any> {
        return {
            commonTools: ['calculator', 'web_search', 'file_read'],
            averageToolsPerSession: 5,
            preferredPatterns: []
        };
    }
    
    /**
     * Get performance history
     */
    private async getPerformanceHistory(toolName: string): Promise<any> {
        return {
            avgLatency: 100,
            stdDevLatency: 20,
            p95Latency: 150,
            p99Latency: 200
        };
    }
    
    /**
     * Matches patterns
     */
    private matchesPatterns(
        toolName: string,
        parameters: Record<string, any>,
        patterns: any[]
    ): number {
        // Simplified pattern matching
        return 0.7;
    }
    
    /**
     * Get success rate by hour
     */
    private async getSuccessRateByHour(agentId: AgentId): Promise<number[]> {
        // Generate sample data
        const rates = new Array(24);
        for (let i = 0; i < 24; i++) {
            rates[i] = 0.7 + Math.random() * 0.2;
        }
        return rates;
    }
    
    /**
     * Find best hour
     */
    private findBestHour(successByHour: number[]): number {
        let bestHour = 0;
        let bestRate = 0;
        
        for (let i = 0; i < successByHour.length; i++) {
            if (successByHour[i] > bestRate) {
                bestRate = successByHour[i];
                bestHour = i;
            }
        }
        
        return bestHour;
    }
    
    /**
     * Get pattern history
     */
    private async getPatternHistory(
        pattern: string,
        timeframe: string
    ): Promise<number[]> {
        // Generate sample historical data
        const dataPoints = timeframe === 'hour' ? 24 : timeframe === 'day' ? 30 : 12;
        const data: number[] = [];
        
        for (let i = 0; i < dataPoints; i++) {
            data.push(50 + Math.random() * 50 + i * 2);
        }
        
        return data;
    }
    
    /**
     * Get historical risk
     */
    private async getHistoricalRisk(agentId: AgentId): Promise<number> {
        return 45; // Baseline risk
    }
    
    /**
     * Generate cache key
     */
    private generateCacheKey(
        type: string,
        agentId: AgentId,
        toolName: string,
        parameters: Record<string, any>
    ): string {
        return `${type}:${agentId}:${toolName}:${JSON.stringify(parameters)}`;
    }
    
    /**
     * Update prediction time
     */
    private updatePredictionTime(time: number): void {
        const alpha = 0.1; // Exponential smoothing factor
        this.metrics.averagePredictionTime = 
            alpha * time + (1 - alpha) * this.metrics.averagePredictionTime;
    }
    
    // =============================================================================
    // EVENT LISTENERS
    // =============================================================================
    
    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Collect training data from events
        EventBus.server.on(Events.Mcp.TOOL_RESULT, async (event) => {
            try {
                const features = await this.extractFeatures(
                    event.agentId,
                    event.channelId,
                    event.toolName,
                    event.parameters || {}
                );
                
                this.trainingData.push({
                    features,
                    label: {
                        type: 'error_occurred',
                        value: !event.success
                    },
                    timestamp: Date.now()
                });
                
                // Trim training data
                if (this.trainingData.length > this.config.maxTrainingDataSize) {
                    this.trainingData.shift();
                }
                
            } catch (error) {
                this.logger.warn('Failed to collect training data:', error);
            }
        });
    }
    
    /**
     * Start retrain schedule.
     *
     * When TF.js is enabled, both error prediction and anomaly detection
     * retraining are managed by MxfMLService.scheduleRetrain() (configured
     * in initializeTfErrorPrediction() and initializeTfAnomalyAutoencoder()).
     * This interval serves as the retraining path when TF.js is disabled
     * and as a fallback when MxfMLService scheduling is not active.
     */
    private startRetrainSchedule(): void {
        this.retrainInterval = setInterval(() => {
            this.trainModels();
        }, this.config.retrainInterval);
    }
    
    // =============================================================================
    // PUBLIC API
    // =============================================================================
    
    /**
     * Get model metadata
     */
    public getModelMetadata(): ModelMetadata[] {
        return Array.from(this.modelMetadata.values());
    }
    
    /**
     * Get metrics
     */
    public getMetrics(): any {
        return { ...this.metrics };
    }
    
    /**
     * Get configuration
     */
    public getConfig(): any {
        return { ...this.config };
    }
    
    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<typeof this.config>): void {
        this.config = { ...this.config, ...newConfig };
    }
    
    /**
     * Clear training data (for testing)
     */
    public clearTrainingData(): void {
        this.trainingData.length = 0;
        this.predictionCache.clear();
    }
    
    /**
     * Cleanup.
     *
     * Stops the retrain schedule. TF.js model disposal is handled by
     * MxfMLService.dispose() during server shutdown.
     */
    public cleanup(): void {
        if (this.retrainInterval) {
            clearInterval(this.retrainInterval);
        }
        this.tfErrorPredictionReady = false;
        this.tfAnomalyAutoencoderReady = false;
    }
}