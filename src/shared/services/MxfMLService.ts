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
 * MxfMLService — TensorFlow.js Integration Layer
 *
 * Singleton service managing TF.js model lifecycle:
 * - Lazy TF.js import (only when TENSORFLOW_ENABLED=true)
 * - Model registration, building, training, inference
 * - Tensor memory management (tf.tidy inside predict/predictBatch — consumers never touch tensors)
 * - Model persistence (MongoDB GridFS or filesystem)
 * - Graceful degradation to heuristics when models are unavailable
 *
 * Key design decisions:
 * - predict() and predictBatch() encapsulate tf.tidy() internally and return plain number[]
 * - trainCustom() supports non-standard training loops (contrastive loss, experience replay, ranking loss)
 * - predictWithReconstruction() supports autoencoder anomaly detection
 * - GridFSIOHandler implements tf.io.IOHandler for MongoDB model persistence
 * - Using pure JS backend (@tensorflow/tfjs) for Bun compatibility
 *
 * Feature flag: TENSORFLOW_ENABLED (default: false)
 */

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { TensorFlowEvents } from '../events/event-definitions/TensorFlowEvents';
import {
    SYSTEM_AGENT_ID,
    SYSTEM_CHANNEL_ID,
    createTfModelRegisteredPayload,
    createTfModelTrainingStartedPayload,
    createTfModelTrainingCompletedPayload,
    createTfModelTrainingFailedPayload,
    createTfModelLoadedPayload,
    createTfModelSavedPayload,
    createTfInferenceCompletedPayload,
    createTfMemoryStatsPayload,
    createTfMemoryWarningPayload,
} from '../schemas/EventPayloadSchema';
import {
    MxfModel,
    MxfModelConfig,
    ModelStatus,
    ModelStorageBackend,
    TrainingMetrics,
    InferenceResult,
    ReconstructionResult,
    TensorMemoryStats,
} from '../types/TensorFlowTypes';
import {
    isTensorFlowEnabled,
    getTensorFlowConfig,
    getStorageBackend,
    getModelStoragePath,
} from '../config/tensorflow.config';

import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GridFS IOHandler for TF.js model persistence to MongoDB
 *
 * Implements the tf.io.IOHandler interface to save/load model artifacts
 * (model.json topology + weights.bin binary data) via MongoDB GridFS.
 *
 * GridFS stores files as chunks across two collections:
 * - tf_models.files — metadata
 * - tf_models.chunks — binary data
 */
class GridFSIOHandler {
    private modelId: string;
    private logger: Logger;

    constructor(modelId: string) {
        this.modelId = modelId;
        this.logger = new Logger('info', 'GridFSIOHandler', 'server');
    }

    /**
     * Get or create a GridFS bucket for TF model storage
     */
    private getBucket(): mongoose.mongo.GridFSBucket {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB connection not established — cannot access GridFS');
        }
        return new mongoose.mongo.GridFSBucket(db, { bucketName: 'tf_models' });
    }

    /**
     * Delete existing files with the given filename prefix from GridFS
     */
    private async deleteExisting(bucket: mongoose.mongo.GridFSBucket, prefix: string): Promise<void> {
        const cursor = bucket.find({ filename: { $regex: `^${prefix}` } });
        for await (const file of cursor) {
            await bucket.delete(file._id);
        }
    }

    /**
     * Save model artifacts to GridFS.
     *
     * Writes two files:
     * - tf_models/{modelId}/model.json — model topology + weight manifest
     * - tf_models/{modelId}/weights.bin — weight data as binary
     *
     * @param modelArtifacts - TF.js model artifacts from model.save()
     * @returns SaveResult with modelArtifactsInfo
     */
    async save(modelArtifacts: any): Promise<any> {
        const bucket = this.getBucket();
        const prefix = `${this.modelId}/`;

        // Delete any existing model files for this modelId
        await this.deleteExisting(bucket, prefix);

        // Prepare model topology JSON (without weight data)
        const modelTopology = {
            modelTopology: modelArtifacts.modelTopology,
            format: modelArtifacts.format,
            generatedBy: modelArtifacts.generatedBy,
            convertedBy: modelArtifacts.convertedBy,
            weightsManifest: [{
                paths: ['weights.bin'],
                weights: modelArtifacts.weightSpecs,
            }],
        };

        // Write model.json
        const modelJsonStr = JSON.stringify(modelTopology);
        await this.writeToGridFS(bucket, `${prefix}model.json`, Buffer.from(modelJsonStr, 'utf-8'));

        // Write weights.bin
        if (modelArtifacts.weightData) {
            const weightBuffer = Buffer.from(
                modelArtifacts.weightData instanceof ArrayBuffer
                    ? modelArtifacts.weightData
                    : modelArtifacts.weightData.buffer
            );
            await this.writeToGridFS(bucket, `${prefix}weights.bin`, weightBuffer);
        }

        this.logger.debug(`[GridFSIOHandler] Saved model ${this.modelId} to GridFS`);

        return {
            modelArtifactsInfo: {
                dateSaved: new Date(),
                modelTopologyType: 'JSON',
                modelTopologyBytes: modelJsonStr.length,
                weightDataBytes: modelArtifacts.weightData
                    ? (modelArtifacts.weightData instanceof ArrayBuffer
                        ? modelArtifacts.weightData.byteLength
                        : modelArtifacts.weightData.buffer.byteLength)
                    : 0,
                weightSpecsBytes: modelArtifacts.weightSpecs
                    ? JSON.stringify(modelArtifacts.weightSpecs).length
                    : 0,
            },
        };
    }

    /**
     * Load model artifacts from GridFS.
     *
     * Reads model.json and weights.bin, reconstructing the ModelArtifacts
     * object that tf.loadLayersModel() expects.
     *
     * @returns TF.js ModelArtifacts
     */
    async load(): Promise<any> {
        const bucket = this.getBucket();
        const prefix = `${this.modelId}/`;

        // Read model.json
        const modelJsonBuffer = await this.readFromGridFS(bucket, `${prefix}model.json`);
        if (!modelJsonBuffer) {
            throw new Error(`Model ${this.modelId} not found in GridFS`);
        }
        const modelJson = JSON.parse(modelJsonBuffer.toString('utf-8'));

        // Read weights.bin
        const weightsBuffer = await this.readFromGridFS(bucket, `${prefix}weights.bin`);

        // Reconstruct ModelArtifacts
        const artifacts: any = {
            modelTopology: modelJson.modelTopology,
            format: modelJson.format,
            generatedBy: modelJson.generatedBy,
            convertedBy: modelJson.convertedBy,
        };

        if (modelJson.weightsManifest && modelJson.weightsManifest.length > 0) {
            artifacts.weightSpecs = modelJson.weightsManifest[0].weights;
        }

        if (weightsBuffer) {
            // Convert Node Buffer to ArrayBuffer
            artifacts.weightData = weightsBuffer.buffer.slice(
                weightsBuffer.byteOffset,
                weightsBuffer.byteOffset + weightsBuffer.byteLength
            );
        }

        this.logger.debug(`[GridFSIOHandler] Loaded model ${this.modelId} from GridFS`);

        return artifacts;
    }

    /**
     * Write a buffer to GridFS as a named file
     */
    private async writeToGridFS(
        bucket: mongoose.mongo.GridFSBucket,
        filename: string,
        data: Buffer
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const uploadStream = bucket.openUploadStream(filename);
            uploadStream.on('finish', () => resolve());
            uploadStream.on('error', (err: Error) => reject(err));
            uploadStream.end(data);
        });
    }

    /**
     * Read a named file from GridFS as a buffer
     */
    private async readFromGridFS(
        bucket: mongoose.mongo.GridFSBucket,
        filename: string
    ): Promise<Buffer | null> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const cursor = bucket.find({ filename });

            cursor.toArray().then((files: any[]) => {
                if (files.length === 0) {
                    resolve(null);
                    return;
                }

                if (files.length > 1) {
                    this.logger.warn(
                        `[GridFSIOHandler] Found ${files.length} files for "${filename}" — using latest. ` +
                        `This may indicate incomplete cleanup of previous model versions.`
                    );
                }

                const downloadStream = bucket.openDownloadStreamByName(filename);

                // Set a 30-second timeout for GridFS stream reads
                const timeout = setTimeout(() => {
                    downloadStream.destroy();
                    reject(new Error(`[GridFSIOHandler] Timed out reading "${filename}" from GridFS (30s)`));
                }, 30_000);

                downloadStream.on('data', (chunk: Buffer) => chunks.push(chunk));
                downloadStream.on('end', () => {
                    clearTimeout(timeout);
                    resolve(Buffer.concat(chunks));
                });
                downloadStream.on('error', (err: Error) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }).catch(reject);
        });
    }
}

/**
 * MxfMLService is the core TensorFlow.js integration singleton
 */
export class MxfMLService {
    private static instance: MxfMLService;
    private logger: Logger;
    private tf: typeof import('@tensorflow/tfjs') | null = null;
    private models: Map<string, MxfModel> = new Map();
    private initialized: boolean = false;
    private memoryLoggingTimer: NodeJS.Timeout | null = null;
    private retrainTimers: Map<string, NodeJS.Timeout> = new Map();

    private constructor() {
        this.logger = new Logger('info', 'MxfMLService', 'server');
    }

    public static getInstance(): MxfMLService {
        if (!MxfMLService.instance) {
            MxfMLService.instance = new MxfMLService();
        }
        return MxfMLService.instance;
    }

    // ─── Initialization ────────────────────────────────────────────────────────

    /**
     * Initialize TF.js runtime.
     *
     * Called from server init (Step 2.8) when TENSORFLOW_ENABLED=true.
     * Lazy-imports @tensorflow/tfjs and starts memory monitoring.
     *
     * The server catches any thrown error and continues without TF.js
     * (graceful degradation).
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!isTensorFlowEnabled()) {
            this.logger.debug('[MxfMLService] TensorFlow.js disabled, skipping initialization');
            return;
        }

        try {
            this.tf = await import('@tensorflow/tfjs');
            this.logger.info(
                `[MxfMLService] TensorFlow.js loaded: backend=${this.tf.getBackend()}, ` +
                `version=${this.tf.version.tfjs}`
            );

            const config = getTensorFlowConfig();
            if (config.memoryLoggingIntervalMs > 0) {
                this.startMemoryLogging(config.memoryLoggingIntervalMs);
            }

            this.initialized = true;
            this.logger.info('[MxfMLService] Initialization complete');
        } catch (error) {
            this.logger.error(
                `[MxfMLService] Failed to initialize TensorFlow.js: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Check if TF.js is initialized and ready for use
     */
    public isEnabled(): boolean {
        return this.initialized && this.tf !== null;
    }

    /**
     * Get the TF.js module reference.
     *
     * Throws if not initialized — callers should check isEnabled() first or use
     * predict/train methods which handle the check internally.
     */
    public getTf(): typeof import('@tensorflow/tfjs') {
        if (!this.tf) {
            throw new Error('[MxfMLService] TensorFlow.js not initialized. Call initialize() first.');
        }
        return this.tf;
    }

    // ─── Model Registration ────────────────────────────────────────────────────

    /**
     * Register a model configuration.
     *
     * This does NOT build the model — call buildSequentialModel() after registration
     * to construct the actual TF.js model. Registration defines the model's identity,
     * architecture type, training parameters, and auto-train schedule.
     *
     * @param config - Model configuration
     * @throws Error if modelId is already registered
     */
    public registerModel(config: MxfModelConfig): void {
        if (!config.modelId || config.modelId.trim() === '') {
            throw new Error('[MxfMLService] modelId is required');
        }
        if (this.models.has(config.modelId)) {
            throw new Error(`[MxfMLService] Model "${config.modelId}" is already registered`);
        }

        const model: MxfModel = {
            config,
            status: ModelStatus.UNTRAINED,
            model: null,
            predictionsSinceTraining: 0,
            totalTrainingSamples: 0,
        };

        this.models.set(config.modelId, model);

        this.logger.info(
            `[MxfMLService] Model registered: ${config.modelId} (type=${config.type}, ` +
            `input=${JSON.stringify(config.inputShape)}, output=${JSON.stringify(config.outputShape)})`
        );

        // Emit registration event using standardized payload helper
        try {
            EventBus.server.emit(
                TensorFlowEvents.MODEL_REGISTERED,
                createTfModelRegisteredPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    config.modelId,
                    config.type,
                    config.inputShape,
                    config.outputShape
                )
            );
        } catch (error: any) {
            this.logger.warn(`[MxfMLService] Failed to emit MODEL_REGISTERED: ${error.message}`);
        }
    }

    // ─── Model Building ────────────────────────────────────────────────────────

    /**
     * Build a TF.js model using a user-provided build function.
     *
     * The buildFn receives the TF.js module and must return a compiled tf.LayersModel.
     * The model is stored in the MxfModel entry and its status set to UNTRAINED.
     *
     * @param modelId - ID of a previously registered model
     * @param buildFn - Function that creates and compiles a TF.js model
     * @throws Error if modelId is not registered or TF.js is not initialized
     */
    public async buildSequentialModel(
        modelId: string,
        buildFn: (tf: typeof import('@tensorflow/tfjs')) => unknown
    ): Promise<void> {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        const builtModel = buildFn(tfRef);
        entry.model = builtModel;
        entry.status = ModelStatus.UNTRAINED;

        this.logger.info(`[MxfMLService] Model built: ${modelId}`);
    }

    // ─── Training: Standard Supervised ──────────────────────────────────────────

    /**
     * Train a model with labeled data (standard supervised learning).
     *
     * Suitable for Phases 2, 3, 4, 7, 9 which use standard (x, y) training pairs.
     * Handles status transitions, event emission, and metrics collection.
     *
     * @param modelId - ID of a previously built model
     * @param xData - Training inputs (2D: samples × features)
     * @param yData - Training labels (2D: samples × outputs)
     * @param options - Optional training parameters (override config defaults)
     * @returns Training metrics
     * @throws Error if model not found, not built, or TF.js not initialized
     */
    public async train(
        modelId: string,
        xData: number[][],
        yData: number[][],
        options?: { epochs?: number; batchSize?: number; validationSplit?: number }
    ): Promise<TrainingMetrics> {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        if (!entry.model) {
            throw new Error(`[MxfMLService] Model "${modelId}" has not been built yet`);
        }

        if (xData.length < entry.config.minTrainingSamples) {
            throw new Error(
                `[MxfMLService] Insufficient training data for "${modelId}": ` +
                `got ${xData.length}, need ${entry.config.minTrainingSamples}`
            );
        }

        const epochs = options?.epochs ?? entry.config.epochs;
        const batchSize = options?.batchSize ?? entry.config.batchSize;
        const validationSplit = options?.validationSplit ?? entry.config.validationSplit;

        // Emit training started event
        this.emitTrainingStarted(modelId, xData.length, epochs);

        entry.status = ModelStatus.TRAINING;
        const startTime = Date.now();

        try {
            // Create tensors inside tidy to prevent leaks during training setup
            const xs = tfRef.tensor2d(xData);
            const ys = tfRef.tensor2d(yData);

            const layersModel = entry.model as any;
            const result = await layersModel.fit(xs, ys, {
                epochs,
                batchSize,
                validationSplit,
                verbose: 0,
            });

            // Extract metrics from training history
            const history = result.history;
            const lastEpoch = (history.loss?.length ?? 1) - 1;

            const metrics: TrainingMetrics = {
                loss: history.loss?.[lastEpoch] ?? 0,
                valLoss: history.val_loss?.[lastEpoch],
                accuracy: history.acc?.[lastEpoch] ?? history.accuracy?.[lastEpoch],
                valAccuracy: history.val_acc?.[lastEpoch] ?? history.val_accuracy?.[lastEpoch],
                epochsCompleted: result.epoch?.length ?? epochs,
                durationMs: Date.now() - startTime,
                samplesUsed: xData.length,
            };

            // Clean up tensors
            xs.dispose();
            ys.dispose();

            // Update model state
            entry.status = ModelStatus.TRAINED;
            entry.lastTrainingMetrics = metrics;
            entry.lastTrainedAt = Date.now();
            entry.predictionsSinceTraining = 0;
            entry.totalTrainingSamples += xData.length;

            // Emit training completed event
            this.emitTrainingCompleted(modelId, metrics);

            this.logger.info(
                `[MxfMLService] Training complete: ${modelId} ` +
                `(loss=${metrics.loss.toFixed(4)}, samples=${metrics.samplesUsed}, ` +
                `duration=${metrics.durationMs}ms)`
            );

            return metrics;
        } catch (error) {
            entry.status = ModelStatus.FAILED;
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Emit training failed event
            this.emitTrainingFailed(modelId, errorMsg, xData.length);

            this.logger.error(`[MxfMLService] Training failed for ${modelId}: ${errorMsg}`);
            throw error;
        }
    }

    // ─── Training: Custom Loop ──────────────────────────────────────────────────

    /**
     * Train a model with a custom training loop.
     *
     * Suitable for Phases 5, 6, 8 which need non-standard training:
     * - Phase 5 (Surprise Embedder): Contrastive loss with positive/negative pairs
     * - Phase 6 (DQN): Experience replay buffer + target network soft updates
     * - Phase 8 (TransE): Margin-based ranking loss with negative sampling
     *
     * MxfMLService handles lifecycle (status transitions, event emission, metrics, timing).
     * The consumer provides the training logic via trainFn.
     *
     * @param modelId - ID of a previously built model
     * @param trainFn - Custom training function receiving (tf, model), returns TrainingMetrics
     * @returns Training metrics from the custom training function
     * @throws Error if model not found, not built, or TF.js not initialized
     */
    public async trainCustom(
        modelId: string,
        trainFn: (tf: typeof import('@tensorflow/tfjs'), model: unknown) => Promise<TrainingMetrics>
    ): Promise<TrainingMetrics> {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        if (!entry.model) {
            throw new Error(`[MxfMLService] Model "${modelId}" has not been built yet`);
        }

        // Emit training started (we don't know sample count upfront for custom training)
        this.emitTrainingStarted(modelId, 0, entry.config.epochs);

        entry.status = ModelStatus.TRAINING;
        const startTime = Date.now();

        try {
            const metrics = await trainFn(tfRef, entry.model);

            // Override duration with wall-clock time
            metrics.durationMs = Date.now() - startTime;

            // Update model state
            entry.status = ModelStatus.TRAINED;
            entry.lastTrainingMetrics = metrics;
            entry.lastTrainedAt = Date.now();
            entry.predictionsSinceTraining = 0;
            entry.totalTrainingSamples += metrics.samplesUsed;

            // Emit training completed event
            this.emitTrainingCompleted(modelId, metrics);

            this.logger.info(
                `[MxfMLService] Custom training complete: ${modelId} ` +
                `(loss=${metrics.loss.toFixed(4)}, samples=${metrics.samplesUsed}, ` +
                `duration=${metrics.durationMs}ms)`
            );

            return metrics;
        } catch (error) {
            entry.status = ModelStatus.FAILED;
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Emit training failed event
            this.emitTrainingFailed(modelId, errorMsg, 0);

            this.logger.error(`[MxfMLService] Custom training failed for ${modelId}: ${errorMsg}`);
            throw error;
        }
    }

    // ─── Inference ──────────────────────────────────────────────────────────────

    /**
     * Run inference on a single input.
     *
     * All tensor operations are encapsulated inside tf.tidy() — the returned
     * InferenceResult contains plain number[] values. Consumer services should
     * never need to import or interact with TF.js directly.
     *
     * @param modelId - ID of a trained model
     * @param input - Feature vector (1D array of numbers)
     * @returns InferenceResult with plain number[] values
     * @throws Error if model not found, not trained, or TF.js not initialized
     */
    public predict(modelId: string, input: number[]): InferenceResult {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        if (entry.status !== ModelStatus.TRAINED) {
            throw new Error(
                `[MxfMLService] Model "${modelId}" is not trained (status=${entry.status})`
            );
        }

        const startTime = performance.now();

        // Run inference inside tf.tidy() to prevent tensor leaks
        const outputValues = tfRef.tidy(() => {
            const inputTensor = tfRef.tensor2d([input]);
            const layersModel = entry.model as any;
            const outputTensor = layersModel.predict(inputTensor) as any;
            return Array.from(outputTensor.dataSync()) as number[];
        });

        const latencyMs = performance.now() - startTime;
        entry.predictionsSinceTraining++;

        // Emit inference completed event using standardized payload helper
        try {
            EventBus.server.emit(
                TensorFlowEvents.INFERENCE_COMPLETED,
                createTfInferenceCompletedPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    modelId,
                    latencyMs,
                    'model'
                )
            );
        } catch (error: any) {
            this.logger.warn(`[MxfMLService] Failed to emit INFERENCE_COMPLETED: ${error.message}`);
        }

        return {
            values: outputValues,
            modelId,
            source: 'model',
            latencyMs,
        };
    }

    /**
     * Run inference on a batch of inputs.
     *
     * More efficient than calling predict() in a loop because all inputs
     * are processed in a single TF.js forward pass.
     *
     * @param modelId - ID of a trained model
     * @param inputs - Array of feature vectors (2D: samples × features)
     * @returns Array of InferenceResult with plain number[] values
     */
    public predictBatch(modelId: string, inputs: number[][]): InferenceResult[] {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        if (entry.status !== ModelStatus.TRAINED) {
            throw new Error(
                `[MxfMLService] Model "${modelId}" is not trained (status=${entry.status})`
            );
        }

        const startTime = performance.now();

        // Run batch inference inside tf.tidy()
        const allOutputs = tfRef.tidy(() => {
            const inputTensor = tfRef.tensor2d(inputs);
            const layersModel = entry.model as any;
            const outputTensor = layersModel.predict(inputTensor) as any;

            // Get raw output data and reshape into per-sample arrays
            const rawData = Array.from(outputTensor.dataSync()) as number[];
            const outputSize = entry.config.outputShape.reduce((a, b) => a * b, 1);
            const results: number[][] = [];
            for (let i = 0; i < inputs.length; i++) {
                results.push(rawData.slice(i * outputSize, (i + 1) * outputSize));
            }
            return results;
        });

        const totalLatencyMs = performance.now() - startTime;
        const perSampleLatency = totalLatencyMs / inputs.length;
        entry.predictionsSinceTraining += inputs.length;

        return allOutputs.map((values) => ({
            values,
            modelId,
            source: 'model' as const,
            latencyMs: perSampleLatency,
        }));
    }

    /**
     * Run inference and compute reconstruction error for autoencoder models.
     *
     * The autoencoder's output is a reconstruction of the input. The reconstruction
     * error (MSE between input and output) serves as the anomaly score — higher
     * error means the input is more anomalous.
     *
     * This method is specifically for Phase 3 (anomaly detection autoencoder) since
     * it needs reconstruction error computed differently from classification.
     *
     * @param modelId - ID of a trained autoencoder model
     * @param input - Feature vector (1D array of numbers)
     * @returns ReconstructionResult with reconstruction, per-feature errors, and MSE
     */
    public predictWithReconstruction(modelId: string, input: number[]): ReconstructionResult {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        if (entry.status !== ModelStatus.TRAINED) {
            throw new Error(
                `[MxfMLService] Model "${modelId}" is not trained (status=${entry.status})`
            );
        }

        const startTime = performance.now();

        // Run autoencoder inference inside tf.tidy()
        const reconstruction = tfRef.tidy(() => {
            const inputTensor = tfRef.tensor2d([input]);
            const layersModel = entry.model as any;
            const outputTensor = layersModel.predict(inputTensor) as any;
            return Array.from(outputTensor.dataSync()) as number[];
        });

        // Compute per-feature squared errors
        const featureErrors: number[] = [];
        let sumSquaredError = 0;
        for (let i = 0; i < input.length; i++) {
            const error = (input[i] - (reconstruction[i] ?? 0)) ** 2;
            featureErrors.push(error);
            sumSquaredError += error;
        }
        const reconstructionError = sumSquaredError / input.length;

        const latencyMs = performance.now() - startTime;
        entry.predictionsSinceTraining++;

        return {
            reconstruction,
            featureErrors,
            reconstructionError,
            modelId,
            source: 'model',
            latencyMs,
        };
    }

    // ─── Model Persistence ──────────────────────────────────────────────────────

    /**
     * Save a trained model to the configured storage backend.
     *
     * Supports two backends:
     * - MongoDB GridFS (default) — uses GridFSIOHandler
     * - Filesystem — uses tf.io.fileSystem() for local development
     *
     * @param modelId - ID of a trained model
     * @throws Error if model not found, not trained, or save fails
     */
    public async saveModel(modelId: string): Promise<void> {
        // Validate TF.js is initialized before saving (fail-fast guard)
        this.getTf();
        const entry = this.getModelEntry(modelId);

        if (entry.status !== ModelStatus.TRAINED) {
            throw new Error(
                `[MxfMLService] Cannot save model "${modelId}" — not trained (status=${entry.status})`
            );
        }

        const layersModel = entry.model as any;
        const backend = getStorageBackend();
        let destination: string;

        if (backend === ModelStorageBackend.MONGODB_GRIDFS) {
            // Save via GridFS IOHandler
            const handler = new GridFSIOHandler(modelId);
            await layersModel.save(handler);
            destination = `gridfs://${modelId}`;
        } else {
            // Save to filesystem
            const modelDir = path.join(getModelStoragePath(), modelId);
            if (!fs.existsSync(modelDir)) {
                fs.mkdirSync(modelDir, { recursive: true });
            }
            await layersModel.save(`file://${modelDir}`);
            destination = `file://${modelDir}`;
        }

        this.logger.info(`[MxfMLService] Model saved: ${modelId} → ${destination}`);

        // Emit model saved event using standardized payload helper
        try {
            EventBus.server.emit(
                TensorFlowEvents.MODEL_SAVED,
                createTfModelSavedPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    modelId,
                    destination
                )
            );
        } catch (error: any) {
            this.logger.warn(`[MxfMLService] Failed to emit MODEL_SAVED: ${error.message}`);
        }
    }

    /**
     * Load a previously saved model from the configured storage backend.
     *
     * @param modelId - ID of the model to load
     * @returns true if model was loaded successfully, false if not found
     */
    public async loadModel(modelId: string): Promise<boolean> {
        const tfRef = this.getTf();
        const entry = this.getModelEntry(modelId);

        const backend = getStorageBackend();
        let source: string;

        try {
            if (backend === ModelStorageBackend.MONGODB_GRIDFS) {
                const handler = new GridFSIOHandler(modelId);
                entry.model = await tfRef.loadLayersModel(handler);
                source = `gridfs://${modelId}`;
            } else {
                const modelDir = path.join(getModelStoragePath(), modelId);
                const modelJsonPath = path.join(modelDir, 'model.json');
                if (!fs.existsSync(modelJsonPath)) {
                    this.logger.debug(`[MxfMLService] Model file not found: ${modelJsonPath}`);
                    return false;
                }
                entry.model = await tfRef.loadLayersModel(`file://${modelDir}/model.json`);
                source = `file://${modelDir}`;
            }

            entry.status = ModelStatus.TRAINED;

            this.logger.info(`[MxfMLService] Model loaded: ${modelId} ← ${source}`);

            // Emit model loaded event using standardized payload helper
            try {
                EventBus.server.emit(
                    TensorFlowEvents.MODEL_LOADED,
                    createTfModelLoadedPayload(
                        SYSTEM_CHANNEL_ID,
                        SYSTEM_AGENT_ID,
                        modelId,
                        source
                    )
                );
            } catch (error: any) {
                this.logger.warn(`[MxfMLService] Failed to emit MODEL_LOADED: ${error.message}`);
            }

            return true;
        } catch (error) {
            this.logger.error(
                `[MxfMLService] Failed to load model ${modelId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
            return false;
        }
    }

    // ─── Memory Management ──────────────────────────────────────────────────────

    /**
     * Get current tensor memory statistics.
     *
     * Wraps tf.memory() with a timestamp. Returns zeros if TF.js is not initialized.
     */
    public getMemoryStats(): TensorMemoryStats {
        if (!this.tf) {
            return { numTensors: 0, numDataBuffers: 0, numBytes: 0, timestamp: Date.now() };
        }

        const mem = this.tf.memory();
        return {
            numTensors: mem.numTensors,
            numDataBuffers: mem.numDataBuffers,
            numBytes: mem.numBytes,
            timestamp: Date.now(),
        };
    }

    /**
     * Start periodic memory usage logging and warning emission.
     *
     * Logs tf.memory() at the configured interval and emits MEMORY_WARNING
     * if tensor memory exceeds the configured threshold.
     */
    private startMemoryLogging(intervalMs: number): void {
        if (this.memoryLoggingTimer) {
            clearInterval(this.memoryLoggingTimer);
        }

        this.memoryLoggingTimer = setInterval(() => {
            if (!this.tf) return;

            const stats = this.getMemoryStats();
            const config = getTensorFlowConfig();

            // Emit periodic stats event using standardized payload helper
            try {
                EventBus.server.emit(
                    TensorFlowEvents.MEMORY_STATS,
                    createTfMemoryStatsPayload(
                        SYSTEM_CHANNEL_ID,
                        SYSTEM_AGENT_ID,
                        stats.numTensors,
                        stats.numDataBuffers,
                        stats.numBytes,
                        stats.timestamp
                    )
                );
            } catch {
                // Swallow emit errors for periodic stats
            }

            // Check memory threshold
            if (stats.numBytes > config.maxTensorMemoryBytes) {
                const utilization = (stats.numBytes / config.maxTensorMemoryBytes) * 100;
                this.logger.warn(
                    `[MxfMLService] Tensor memory WARNING: ${(stats.numBytes / 1024 / 1024).toFixed(1)}MB ` +
                    `(${utilization.toFixed(0)}% of ${(config.maxTensorMemoryBytes / 1024 / 1024).toFixed(0)}MB limit, ` +
                    `${stats.numTensors} tensors)`
                );

                try {
                    EventBus.server.emit(
                        TensorFlowEvents.MEMORY_WARNING,
                        createTfMemoryWarningPayload(
                            SYSTEM_CHANNEL_ID,
                            SYSTEM_AGENT_ID,
                            stats.numTensors,
                            stats.numBytes,
                            config.maxTensorMemoryBytes,
                            utilization
                        )
                    );
                } catch {
                    // Swallow emit errors for warnings
                }
            } else if (config.debug) {
                this.logger.debug(
                    `[MxfMLService] Memory: ${(stats.numBytes / 1024 / 1024).toFixed(1)}MB, ` +
                    `${stats.numTensors} tensors, ${stats.numDataBuffers} buffers`
                );
            }
        }, intervalMs);

        // Ensure timer doesn't prevent process exit
        if (this.memoryLoggingTimer.unref) {
            this.memoryLoggingTimer.unref();
        }
    }

    // ─── Auto-Train Scheduling ──────────────────────────────────────────────────

    /**
     * Schedule automatic retraining for a model.
     *
     * Calls the provided trainCallback at the model's retrainIntervalMs.
     * The callback is responsible for collecting training data and calling train().
     *
     * @param modelId - ID of a registered model
     * @param trainCallback - Function to call when retraining is due
     */
    public scheduleRetrain(
        modelId: string,
        trainCallback: () => Promise<void>
    ): void {
        const entry = this.getModelEntry(modelId);

        // Clear any existing timer for this model
        const existingTimer = this.retrainTimers.get(modelId);
        if (existingTimer) {
            clearInterval(existingTimer);
        }

        const intervalMs = entry.config.retrainIntervalMs || getTensorFlowConfig().globalRetrainIntervalMs;

        const timer = setInterval(async () => {
            try {
                this.logger.debug(`[MxfMLService] Auto-retrain triggered for ${modelId}`);
                await trainCallback();
            } catch (error) {
                this.logger.error(
                    `[MxfMLService] Auto-retrain failed for ${modelId}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }, intervalMs);

        // Ensure timer doesn't prevent process exit
        if (timer.unref) {
            timer.unref();
        }

        this.retrainTimers.set(modelId, timer);
        this.logger.info(`[MxfMLService] Auto-retrain scheduled for ${modelId} every ${intervalMs}ms`);
    }

    // ─── Cleanup ────────────────────────────────────────────────────────────────

    /**
     * Dispose all models, stop timers, and release TF.js resources.
     *
     * Called during server shutdown.
     */
    public async dispose(): Promise<void> {
        // Stop memory logging
        if (this.memoryLoggingTimer) {
            clearInterval(this.memoryLoggingTimer);
            this.memoryLoggingTimer = null;
        }

        // Stop all retrain timers
        for (const [modelId, timer] of this.retrainTimers) {
            clearInterval(timer);
            this.logger.debug(`[MxfMLService] Stopped retrain timer for ${modelId}`);
        }
        this.retrainTimers.clear();

        // Dispose all TF.js models
        for (const [modelId, entry] of this.models) {
            if (entry.model) {
                try {
                    const disposable = entry.model as { dispose?: () => void };
                    if (typeof disposable.dispose === 'function') {
                        disposable.dispose();
                    }
                    this.logger.debug(`[MxfMLService] Disposed model: ${modelId}`);
                } catch (error) {
                    this.logger.warn(
                        `[MxfMLService] Failed to dispose model ${modelId}: ` +
                        `${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }

        this.models.clear();
        this.initialized = false;
        this.tf = null;

        this.logger.info('[MxfMLService] All models disposed, service shut down');
    }

    /**
     * Get a registered model's runtime state.
     *
     * @param modelId - Model ID to look up
     * @returns MxfModel or undefined if not found
     */
    public getModel(modelId: string): MxfModel | undefined {
        return this.models.get(modelId);
    }

    /**
     * List all registered model IDs.
     */
    public getRegisteredModelIds(): string[] {
        return Array.from(this.models.keys());
    }

    /**
     * Reset the service (useful for testing).
     *
     * Clears all models without disposing TF.js. Does not stop memory logging.
     */
    public reset(): void {
        // Stop retrain timers
        for (const timer of this.retrainTimers.values()) {
            clearInterval(timer);
        }
        this.retrainTimers.clear();

        // Clear models (but don't dispose TF.js module)
        this.models.clear();
        this.logger.debug('[MxfMLService] Service reset — all models cleared');
    }

    /**
     * Reset the singleton instance (for testing only).
     */
    public static resetInstance(): void {
        if (MxfMLService.instance) {
            MxfMLService.instance.dispose();
        }
        MxfMLService.instance = null as any;
    }

    // ─── Private Helpers ────────────────────────────────────────────────────────

    /**
     * Get a model entry by ID, throwing if not found.
     */
    private getModelEntry(modelId: string): MxfModel {
        const entry = this.models.get(modelId);
        if (!entry) {
            throw new Error(`[MxfMLService] Model "${modelId}" is not registered`);
        }
        return entry;
    }

    /**
     * Emit training started event (swallows errors)
     */
    private emitTrainingStarted(modelId: string, trainingSamples: number, epochs: number): void {
        try {
            EventBus.server.emit(
                TensorFlowEvents.MODEL_TRAINING_STARTED,
                createTfModelTrainingStartedPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    modelId,
                    trainingSamples,
                    epochs
                )
            );
        } catch (error: any) {
            this.logger.warn(`[MxfMLService] Failed to emit MODEL_TRAINING_STARTED: ${error.message}`);
        }
    }

    /**
     * Emit training completed event (swallows errors)
     */
    private emitTrainingCompleted(modelId: string, metrics: TrainingMetrics): void {
        try {
            EventBus.server.emit(
                TensorFlowEvents.MODEL_TRAINING_COMPLETED,
                createTfModelTrainingCompletedPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    modelId,
                    metrics.loss,
                    metrics.durationMs,
                    metrics.samplesUsed,
                    { valLoss: metrics.valLoss, accuracy: metrics.accuracy }
                )
            );
        } catch (error: any) {
            this.logger.warn(`[MxfMLService] Failed to emit MODEL_TRAINING_COMPLETED: ${error.message}`);
        }
    }

    /**
     * Emit training failed event (swallows errors)
     */
    private emitTrainingFailed(modelId: string, error: string, trainingSamples: number): void {
        try {
            EventBus.server.emit(
                TensorFlowEvents.MODEL_TRAINING_FAILED,
                createTfModelTrainingFailedPayload(
                    SYSTEM_CHANNEL_ID,
                    SYSTEM_AGENT_ID,
                    modelId,
                    error,
                    trainingSamples
                )
            );
        } catch (err: any) {
            this.logger.warn(`[MxfMLService] Failed to emit MODEL_TRAINING_FAILED: ${err.message}`);
        }
    }
}
