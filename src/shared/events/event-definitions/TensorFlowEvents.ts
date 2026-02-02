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
 * TensorFlow Events
 *
 * Event definitions for the TensorFlow.js integration layer.
 * Covers model lifecycle (registration, training, persistence),
 * inference (prediction, fallback), and tensor memory monitoring.
 */

/**
 * TensorFlow event names
 */
export const TensorFlowEvents = {
    // Model lifecycle events
    MODEL_REGISTERED: 'tf:model_registered',
    MODEL_TRAINING_STARTED: 'tf:model_training_started',
    MODEL_TRAINING_COMPLETED: 'tf:model_training_completed',
    MODEL_TRAINING_FAILED: 'tf:model_training_failed',
    MODEL_LOADED: 'tf:model_loaded',
    MODEL_SAVED: 'tf:model_saved',

    // Inference events
    INFERENCE_COMPLETED: 'tf:inference_completed',
    INFERENCE_FALLBACK: 'tf:inference_fallback',

    // Memory events
    MEMORY_WARNING: 'tf:memory_warning',
    MEMORY_STATS: 'tf:memory_stats',
} as const;

export type TensorFlowEventName = typeof TensorFlowEvents[keyof typeof TensorFlowEvents];

/**
 * Model registered event data
 */
export interface ModelRegisteredEventData {
    modelId: string;
    type: string;
    inputShape: number[];
    outputShape: number[];
}

/**
 * Model training started event data
 */
export interface ModelTrainingStartedEventData {
    modelId: string;
    trainingSamples: number;
    epochs: number;
}

/**
 * Model training completed event data
 */
export interface ModelTrainingCompletedEventData {
    modelId: string;
    loss: number;
    valLoss?: number;
    accuracy?: number;
    durationMs: number;
    samplesUsed: number;
}

/**
 * Model training failed event data
 */
export interface ModelTrainingFailedEventData {
    modelId: string;
    error: string;
    trainingSamples: number;
}

/**
 * Model loaded from storage event data
 */
export interface ModelLoadedEventData {
    modelId: string;
    source: string;
}

/**
 * Model saved to storage event data
 */
export interface ModelSavedEventData {
    modelId: string;
    destination: string;
    sizeBytes?: number;
}

/**
 * Inference completed event data
 */
export interface InferenceCompletedEventData {
    modelId: string;
    latencyMs: number;
    source: 'model' | 'heuristic';
}

/**
 * Inference fallback event data — emitted when ML model is unavailable
 * and the heuristic fallback is used instead
 */
export interface InferenceFallbackEventData {
    modelId: string;
    reason: 'disabled' | 'untrained' | 'error';
    error?: string;
}

/**
 * Tensor memory warning event data — emitted when tensor memory exceeds threshold
 */
export interface MemoryWarningEventData {
    numTensors: number;
    numBytes: number;
    maxBytes: number;
    utilizationPercent: number;
}

/**
 * Tensor memory stats event data — periodic snapshot of tf.memory()
 */
export interface MemoryStatsEventData {
    numTensors: number;
    numDataBuffers: number;
    numBytes: number;
    timestamp: number;
}

/**
 * TensorFlow event payloads mapping
 */
export interface TensorFlowPayloads {
    'tf:model_registered': ModelRegisteredEventData;
    'tf:model_training_started': ModelTrainingStartedEventData;
    'tf:model_training_completed': ModelTrainingCompletedEventData;
    'tf:model_training_failed': ModelTrainingFailedEventData;
    'tf:model_loaded': ModelLoadedEventData;
    'tf:model_saved': ModelSavedEventData;
    'tf:inference_completed': InferenceCompletedEventData;
    'tf:inference_fallback': InferenceFallbackEventData;
    'tf:memory_warning': MemoryWarningEventData;
    'tf:memory_stats': MemoryStatsEventData;
}
