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
 * TensorFlow.js Integration Types
 *
 * Type definitions for MXF's TensorFlow.js integration layer.
 * Covers model management, training configuration, inference results,
 * and tensor memory monitoring.
 *
 * Feature flag: TENSORFLOW_ENABLED (default: false)
 *
 * Design notes:
 * - All model types supported: dense classifiers, autoencoders, LSTMs, DQNs,
 *   regression, embeddings, and TransE knowledge graph embeddings
 * - Models persist to MongoDB GridFS (default) or local filesystem
 * - Inference returns plain number[] via InferenceResult — consumers never touch tensors
 * - Training supports both standard supervised (train) and custom loops (trainCustom)
 *   for contrastive loss, experience replay, and margin-based ranking
 * - Using pure JS backend (@tensorflow/tfjs) for Bun compatibility.
 *   Native backend (@tensorflow/tfjs-node) can be added later for 10-50x speedup
 *   if Node.js is used.
 */

/**
 * Model architecture types supported by MxfMLService
 */
export enum MxfModelType {
    /** Standard feedforward classifier with Dense layers and sigmoid/softmax output */
    DENSE_CLASSIFIER = 'dense_classifier',

    /** Encoder-decoder architecture for anomaly detection via reconstruction error */
    AUTOENCODER = 'autoencoder',

    /** Long Short-Term Memory network for time series forecasting */
    LSTM = 'lstm',

    /** Deep Q-Network for reinforcement learning Q-value approximation */
    DQN = 'dqn',

    /** Standard regression with linear output */
    REGRESSION = 'regression',

    /** Embedding model for learned vector representations (e.g., surprise embedder) */
    EMBEDDING = 'embedding',

    /** TransE knowledge graph embedding model with margin-based ranking loss */
    TRANSE = 'transe',
}

/**
 * Model lifecycle status
 */
export enum ModelStatus {
    /** Model is registered but has no trained weights */
    UNTRAINED = 'untrained',

    /** Model is currently being trained */
    TRAINING = 'training',

    /** Model has trained weights and is ready for inference */
    TRAINED = 'trained',

    /** Training failed — model may have partial weights or none */
    FAILED = 'failed',
}

/**
 * Backend for model persistence
 */
export enum ModelStorageBackend {
    /** Local filesystem storage (for development) */
    FILESYSTEM = 'filesystem',

    /** MongoDB GridFS storage (production default) */
    MONGODB_GRIDFS = 'mongodb_gridfs',
}

/**
 * Configuration for a registered model
 *
 * Each model that MxfMLService manages has one of these configs.
 * The config is provided at registration time by the consuming service.
 */
export interface MxfModelConfig {
    /** Unique identifier for this model (e.g., 'error_prediction', 'anomaly_autoencoder') */
    modelId: string;

    /** Architecture type — determines how the model is built, trained, and used */
    type: MxfModelType;

    /** Expected input tensor shape (excluding batch dimension) */
    inputShape: number[];

    /** Expected output tensor shape (excluding batch dimension) */
    outputShape: number[];

    /** Minimum training samples required before first training */
    minTrainingSamples: number;

    /** Training batch size */
    batchSize: number;

    /** Training epochs per training run */
    epochs: number;

    /** Fraction of training data used for validation (0-1) */
    validationSplit: number;

    /** Optimizer learning rate */
    learningRate: number;

    /** Whether to auto-train when sufficient data is available */
    autoTrain: boolean;

    /** Interval between automatic retraining runs in milliseconds */
    retrainIntervalMs: number;

    /** Model-specific hyperparameters (e.g., DQN replay buffer size, TransE margin) */
    hyperparameters?: Record<string, number | string | boolean>;
}

/**
 * Runtime state for a managed model
 *
 * Tracks the TF.js model instance, training metrics, and usage statistics.
 * The `model` field holds the actual tf.LayersModel at runtime.
 */
export interface MxfModel {
    /** Registration configuration */
    config: MxfModelConfig;

    /** Current lifecycle status */
    status: ModelStatus;

    /**
     * The TF.js model instance.
     * Typed as `unknown` to avoid importing @tensorflow/tfjs at type level.
     * At runtime this is a tf.LayersModel (or tf.Sequential).
     */
    model: unknown;

    /** Metrics from the most recent training run */
    lastTrainingMetrics?: TrainingMetrics;

    /** Unix timestamp of last successful training */
    lastTrainedAt?: number;

    /** Number of predictions made since last training */
    predictionsSinceTraining: number;

    /** Total number of training samples used across all training runs */
    totalTrainingSamples: number;
}

/**
 * Training run metrics
 *
 * Returned by both train() and trainCustom() methods.
 */
export interface TrainingMetrics {
    /** Final training loss */
    loss: number;

    /** Final validation loss (if validationSplit > 0) */
    valLoss?: number;

    /** Final training accuracy (for classifiers) */
    accuracy?: number;

    /** Final validation accuracy (for classifiers) */
    valAccuracy?: number;

    /** Number of epochs completed (may be less than config.epochs if early-stopped) */
    epochsCompleted: number;

    /** Wall-clock training duration in milliseconds */
    durationMs: number;

    /** Number of training samples used in this run */
    samplesUsed: number;
}

/**
 * Inference result returned by predict() and predictBatch()
 *
 * Contains plain number[] values — all tensor operations are encapsulated
 * inside MxfMLService. Consumer services never touch tensors.
 */
export interface InferenceResult {
    /** Output values as plain numbers */
    values: number[];

    /** Model that produced this result */
    modelId: string;

    /** Whether result came from the ML model or a heuristic fallback */
    source: 'model' | 'heuristic';

    /** Inference latency in milliseconds */
    latencyMs: number;
}

/**
 * Reconstruction result for autoencoder models
 *
 * Returned by predictWithReconstruction() for anomaly detection.
 * Includes the reconstructed output and the reconstruction error.
 */
export interface ReconstructionResult {
    /** Reconstructed output values */
    reconstruction: number[];

    /** Per-feature reconstruction error (input - reconstruction)^2 */
    featureErrors: number[];

    /** Mean squared reconstruction error (anomaly score) */
    reconstructionError: number;

    /** Model that produced this result */
    modelId: string;

    /** Whether result came from the ML model or a heuristic fallback */
    source: 'model' | 'heuristic';

    /** Inference latency in milliseconds */
    latencyMs: number;
}

/**
 * Tensor memory usage snapshot
 *
 * Wraps tf.memory() output with a timestamp for monitoring.
 */
export interface TensorMemoryStats {
    /** Number of tensors currently allocated */
    numTensors: number;

    /** Number of unique data buffers (shared tensors share buffers) */
    numDataBuffers: number;

    /** Total bytes used by tensors */
    numBytes: number;

    /** Unix timestamp when stats were collected */
    timestamp: number;
}

/**
 * TensorFlow.js configuration
 *
 * Controls feature flag, storage backend, memory monitoring,
 * and auto-training behavior.
 */
export interface TensorFlowConfig {
    /** Master enable flag (default: false, opt-in) */
    enabled: boolean;

    /** Where to persist trained models */
    storageBackend: ModelStorageBackend;

    /** Filesystem path for model storage (only used when backend is FILESYSTEM) */
    modelStoragePath: string;

    /** Interval for tf.memory() logging in milliseconds (0 to disable) */
    memoryLoggingIntervalMs: number;

    /** Memory warning threshold in bytes */
    maxTensorMemoryBytes: number;

    /** Enable verbose TF.js debug logging */
    debug: boolean;

    /** Whether auto-training is enabled globally */
    autoTrainEnabled: boolean;

    /** Default retrain interval in milliseconds (models can override) */
    globalRetrainIntervalMs: number;
}

/**
 * Environment variable names for TensorFlow.js configuration
 *
 * All variables are optional — defaults are used when not set.
 */
export const TENSORFLOW_ENV_VARS = {
    ENABLED: 'TENSORFLOW_ENABLED',
    STORAGE_BACKEND: 'TENSORFLOW_STORAGE_BACKEND',
    MODEL_STORAGE_PATH: 'TENSORFLOW_MODEL_STORAGE_PATH',
    MEMORY_LOGGING_INTERVAL_MS: 'TENSORFLOW_MEMORY_LOGGING_INTERVAL_MS',
    MAX_TENSOR_MEMORY_BYTES: 'TENSORFLOW_MAX_TENSOR_MEMORY_BYTES',
    DEBUG: 'TENSORFLOW_DEBUG',
    AUTO_TRAIN_ENABLED: 'TENSORFLOW_AUTO_TRAIN_ENABLED',
    GLOBAL_RETRAIN_INTERVAL_MS: 'TENSORFLOW_GLOBAL_RETRAIN_INTERVAL_MS',
} as const;

/**
 * Default configuration values
 *
 * Feature is disabled by default (opt-in via TENSORFLOW_ENABLED=true).
 * GridFS is the default storage backend for production use.
 */
export const DEFAULT_TENSORFLOW_CONFIG: TensorFlowConfig = {
    enabled: false,
    storageBackend: ModelStorageBackend.MONGODB_GRIDFS,
    modelStoragePath: 'data/tensorflow/models',
    memoryLoggingIntervalMs: 60_000,           // 1 minute
    maxTensorMemoryBytes: 536_870_912,         // 512 MB
    debug: false,
    autoTrainEnabled: true,
    globalRetrainIntervalMs: 3_600_000,        // 1 hour
};
