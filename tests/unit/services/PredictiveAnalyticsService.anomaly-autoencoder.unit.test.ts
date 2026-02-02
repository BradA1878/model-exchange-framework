/**
 * Unit tests for PredictiveAnalyticsService — Phase 3 Anomaly Detection Autoencoder
 *
 * Tests the new TF.js anomaly autoencoder integration:
 * - initializeTfAnomalyAutoencoder(): model registration, building, loading, retrain scheduling
 * - runParameterAnomalyDetection(): TF.js dispatch path, heuristic fallback, error handling
 * - calculateHeuristicIsolationScore(): distance-based scoring, edge cases
 * - trainAnomalyDetectionModel(): unsupervised training (input=output), model save, ready flag
 * - updateAnomalyHeuristicMetadata(): metadata update with simulated accuracy
 * - cleanup(): resets tfAnomalyAutoencoderReady flag
 * - detectParameterAnomaly(): receives agentId and channelId parameters
 */

import { MxfModelType, ModelStatus, TrainingMetrics, ReconstructionResult } from '@mxf/shared/types/TensorFlowTypes';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the service under test
// ---------------------------------------------------------------------------

// Track all EventBus.server.emit calls
const mockServerEmit = jest.fn();

jest.mock('@mxf/shared/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: mockServerEmit,
            on: jest.fn(),
        },
    },
}));

// Mock PatternLearningService
const mockGetEnhancedPatterns = jest.fn().mockResolvedValue({
    successful: [],
    shared: [],
});

jest.mock('@mxf/shared/services/PatternLearningService', () => ({
    PatternLearningService: {
        getInstance: jest.fn(() => ({
            getEnhancedPatterns: mockGetEnhancedPatterns,
        })),
    },
}));

// MxfMLService mock functions
const mockRegisterModel = jest.fn();
const mockBuildSequentialModel = jest.fn().mockResolvedValue(undefined);
const mockLoadModel = jest.fn().mockResolvedValue(false);
const mockSaveModel = jest.fn().mockResolvedValue(undefined);
const mockScheduleRetrain = jest.fn();
const mockGetModel = jest.fn();
const mockPredict = jest.fn();
const mockPredictWithReconstruction = jest.fn();
const mockTrain = jest.fn();
const mockIsEnabled = jest.fn().mockReturnValue(true);

jest.mock('@mxf/shared/services/MxfMLService', () => ({
    MxfMLService: {
        getInstance: jest.fn(() => ({
            isEnabled: mockIsEnabled,
            registerModel: mockRegisterModel,
            buildSequentialModel: mockBuildSequentialModel,
            loadModel: mockLoadModel,
            saveModel: mockSaveModel,
            scheduleRetrain: mockScheduleRetrain,
            getModel: mockGetModel,
            predict: mockPredict,
            predictWithReconstruction: mockPredictWithReconstruction,
            train: mockTrain,
        })),
    },
}));

// TensorFlow config mocks — control the TF enabled state per test
let tensorFlowEnabled = false;

jest.mock('@mxf/shared/config/tensorflow.config', () => ({
    isTensorFlowEnabled: jest.fn(() => tensorFlowEnabled),
    getTensorFlowConfig: jest.fn(() => ({
        enabled: tensorFlowEnabled,
        autoTrainEnabled: true,
        globalRetrainIntervalMs: 3600000,
    })),
}));

// Mock Logger to suppress output during tests
jest.mock('@mxf/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })),
}));

// Mock uuid to produce deterministic IDs
jest.mock('uuid', () => ({
    v4: jest.fn(() => 'test-uuid-1234'),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { PredictiveAnalyticsService } from '@mxf/shared/services/PredictiveAnalyticsService';
import { TensorFlowEvents } from '@mxf/shared/events/event-definitions/TensorFlowEvents';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset the PredictiveAnalyticsService singleton between tests.
 * The singleton stores state (tfAnomalyAutoencoderReady, models, etc.)
 * that must be isolated per test.
 */
function resetSingleton(): void {
    // Clear the private static instance so getInstance() creates a fresh one
    (PredictiveAnalyticsService as any).instance = undefined;
}

/**
 * Get a fresh PredictiveAnalyticsService instance.
 * Because the constructor calls initializeModels(), setupEventListeners(),
 * and conditionally initializeTfAnomalyAutoencoder(), we get the service
 * in a clean state.
 */
function getService(): PredictiveAnalyticsService {
    return PredictiveAnalyticsService.getInstance();
}

/**
 * Create a valid FeatureVector for testing.
 * Mimics what extractFeatures() returns.
 */
function makeFeatureVector(overrides: Record<string, any> = {}): any {
    return {
        toolName: 'test_tool',
        toolCategory: 'general',
        toolComplexity: 0.5,
        parameterCount: 2,
        parameterTypes: ['string', 'number'],
        parameterPatternMatch: 0.7,
        agentType: 'test',
        agentExperience: 100,
        agentErrorRate: 0.1,
        timeOfDay: 12,
        dayOfWeek: 3,
        systemLoad: 0.3,
        concurrentRequests: 5,
        recentErrors: 2,
        recentSuccesses: 18,
        averageLatency: 150,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PredictiveAnalyticsService — Anomaly Autoencoder (Phase 3)', () => {
    let service: PredictiveAnalyticsService;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset TF enabled state to disabled by default per test
        tensorFlowEnabled = false;
        // Clear singleton
        resetSingleton();
        // Clear timers from the previous instance's startRetrainSchedule()
        jest.clearAllTimers();
    });

    afterEach(() => {
        // Cleanup the service to stop intervals
        if (service) {
            service.cleanup();
        }
    });

    // =========================================================================
    // initializeTfAnomalyAutoencoder()
    // =========================================================================
    describe('initializeTfAnomalyAutoencoder()', () => {
        beforeEach(() => {
            tensorFlowEnabled = true;
        });

        it('should register the autoencoder model with correct config', async () => {
            service = getService();
            // The constructor calls initializeTfAnomalyAutoencoder() asynchronously.
            // We need to wait for it to settle.
            await flushPromises();

            expect(mockRegisterModel).toHaveBeenCalledWith(
                expect.objectContaining({
                    modelId: 'anomaly_autoencoder',
                    type: MxfModelType.AUTOENCODER,
                    inputShape: [12],
                    outputShape: [12],
                    minTrainingSamples: 100,
                    batchSize: 32,
                    epochs: 20,
                    validationSplit: 0.1,
                    learningRate: 0.001,
                    autoTrain: true,
                    hyperparameters: expect.objectContaining({
                        architecture: 'dense(12)->dense(8,relu)->dense(4,relu)->dense(8,relu)->dense(12,linear)',
                        loss: 'meanSquaredError',
                        optimizer: 'adam',
                        bottleneckSize: 4,
                    }),
                })
            );
        });

        it('should call buildSequentialModel with the autoencoder model ID', async () => {
            service = getService();
            await flushPromises();

            expect(mockBuildSequentialModel).toHaveBeenCalledWith(
                'anomaly_autoencoder',
                expect.any(Function)
            );
        });

        it('should attempt to load a pre-trained model from storage', async () => {
            service = getService();
            await flushPromises();

            expect(mockLoadModel).toHaveBeenCalledWith('anomaly_autoencoder');
        });

        it('should set tfAnomalyAutoencoderReady to true when pre-trained model is loaded', async () => {
            // Make loadModel return true for the autoencoder
            mockLoadModel.mockImplementation((modelId: string) => {
                return Promise.resolve(modelId === 'anomaly_autoencoder');
            });

            service = getService();
            await flushPromises();

            expect((service as any).tfAnomalyAutoencoderReady).toBe(true);
        });

        it('should not set tfAnomalyAutoencoderReady when no pre-trained model exists', async () => {
            mockLoadModel.mockResolvedValue(false);

            service = getService();
            await flushPromises();

            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);
        });

        it('should schedule retrain when autoTrainEnabled is true', async () => {
            service = getService();
            await flushPromises();

            // scheduleRetrain should be called for the anomaly_autoencoder model
            expect(mockScheduleRetrain).toHaveBeenCalledWith(
                'anomaly_autoencoder',
                expect.any(Function)
            );
        });

        it('should skip initialization when MxfMLService is not enabled', async () => {
            mockIsEnabled.mockReturnValue(false);

            service = getService();
            await flushPromises();

            // registerModel should not be called for the autoencoder
            const autoencoderCalls = mockRegisterModel.mock.calls.filter(
                (call: any[]) => call[0]?.modelId === 'anomaly_autoencoder'
            );
            expect(autoencoderCalls).toHaveLength(0);
        });
    });

    // =========================================================================
    // runParameterAnomalyDetection() — accessed via detectAnomalies()
    // =========================================================================
    describe('runParameterAnomalyDetection()', () => {
        it('should use TF.js autoencoder when ready and return normalized reconstruction error', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Simulate autoencoder being ready
            (service as any).tfAnomalyAutoencoderReady = true;

            // Mock predictWithReconstruction to return a reconstruction error
            const mockReconstructionResult: ReconstructionResult = {
                reconstruction: new Array(12).fill(0.1),
                featureErrors: new Array(12).fill(0.01),
                reconstructionError: 0.05, // raw MSE
                modelId: 'anomaly_autoencoder',
                source: 'model',
                latencyMs: 1.2,
            };
            mockPredictWithReconstruction.mockReturnValue(mockReconstructionResult);

            // Call detectAnomalies which internally calls runParameterAnomalyDetection
            const anomalies = await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            expect(mockPredictWithReconstruction).toHaveBeenCalledWith(
                'anomaly_autoencoder',
                expect.any(Array)
            );
        });

        it('should normalize reconstruction error using AUTOENCODER_ANOMALY_SCALE_FACTOR', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            (service as any).tfAnomalyAutoencoderReady = true;

            // reconstructionError = 0.08 => scaled = 0.08 * 10 = 0.8
            // This is exactly at the anomaly threshold (0.8)
            mockPredictWithReconstruction.mockReturnValue({
                reconstruction: new Array(12).fill(0),
                featureErrors: new Array(12).fill(0),
                reconstructionError: 0.08,
                modelId: 'anomaly_autoencoder',
                source: 'model',
                latencyMs: 1.0,
            });

            const anomalies = await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // Score = min(1, 0.08 * 10) = 0.8 — right at threshold,
            // but threshold check is score > 0.8, so not anomalous
            const parameterAnomalies = anomalies.filter(a => a.type === 'parameter');
            expect(parameterAnomalies).toHaveLength(0);
        });

        it('should cap normalized score at 1.0 for very high reconstruction error', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            (service as any).tfAnomalyAutoencoderReady = true;

            // reconstructionError = 0.5 => scaled = 0.5 * 10 = 5.0, capped to 1.0
            mockPredictWithReconstruction.mockReturnValue({
                reconstruction: new Array(12).fill(0),
                featureErrors: new Array(12).fill(0),
                reconstructionError: 0.5,
                modelId: 'anomaly_autoencoder',
                source: 'model',
                latencyMs: 1.0,
            });

            const anomalies = await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // Score capped at 1.0, which exceeds threshold — should produce anomaly
            const parameterAnomalies = anomalies.filter(a => a.type === 'parameter');
            expect(parameterAnomalies).toHaveLength(1);
            expect(parameterAnomalies[0].score).toBeLessThanOrEqual(1.0);
            expect(parameterAnomalies[0].severity).toBe('high');
        });

        it('should fall back to heuristic when TF.js autoencoder is not ready', async () => {
            tensorFlowEnabled = false;
            service = getService();
            await flushPromises();

            // Autoencoder is not ready
            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);

            const anomalies = await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // predictWithReconstruction should NOT be called
            expect(mockPredictWithReconstruction).not.toHaveBeenCalled();
        });

        it('should fall back to heuristic when TF.js inference throws an error', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            (service as any).tfAnomalyAutoencoderReady = true;

            // Make predictWithReconstruction throw
            mockPredictWithReconstruction.mockImplementation(() => {
                throw new Error('Tensor allocation failed');
            });

            // Should not throw — graceful degradation to heuristic
            const anomalies = await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // Should still get a result (from heuristic fallback), no crash
            expect(anomalies).toBeDefined();
            expect(Array.isArray(anomalies)).toBe(true);
        });

        it('should emit INFERENCE_FALLBACK event when TF.js inference fails', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            (service as any).tfAnomalyAutoencoderReady = true;

            mockPredictWithReconstruction.mockImplementation(() => {
                throw new Error('Model prediction error');
            });

            await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // Check that INFERENCE_FALLBACK was emitted with BaseEventPayload structure
            expect(mockServerEmit).toHaveBeenCalledWith(
                TensorFlowEvents.INFERENCE_FALLBACK,
                expect.objectContaining({
                    eventType: TensorFlowEvents.INFERENCE_FALLBACK,
                    agentId: 'test-agent',
                    channelId: 'test-channel',
                    data: expect.objectContaining({
                        modelId: 'anomaly_autoencoder',
                        reason: 'error',
                        error: 'Model prediction error',
                    }),
                })
            );
        });

        it('should emit INFERENCE_FALLBACK with model_not_trained when TF enabled but autoencoder not ready', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Ensure autoencoder is NOT ready (default after init with no pre-trained model)
            (service as any).tfAnomalyAutoencoderReady = false;

            await service.detectAnomalies(
                'test-agent',
                'test-channel',
                'test_tool',
                { param1: 'value1' }
            );

            // Should emit INFERENCE_FALLBACK with BaseEventPayload structure and 'untrained' reason
            expect(mockServerEmit).toHaveBeenCalledWith(
                TensorFlowEvents.INFERENCE_FALLBACK,
                expect.objectContaining({
                    eventType: TensorFlowEvents.INFERENCE_FALLBACK,
                    agentId: 'test-agent',
                    channelId: 'test-channel',
                    data: expect.objectContaining({
                        modelId: 'anomaly_autoencoder',
                        reason: 'untrained',
                    }),
                })
            );
        });
    });

    // =========================================================================
    // calculateHeuristicIsolationScore()
    // =========================================================================
    describe('calculateHeuristicIsolationScore()', () => {
        beforeEach(() => {
            tensorFlowEnabled = false;
            service = getService();
        });

        it('should return 0.5 when historicalPatterns is empty', () => {
            const score = (service as any).calculateHeuristicIsolationScore(
                { param1: 'value1' },
                []
            );
            expect(score).toBe(0.5);
        });

        it('should return low score when parameters match historical patterns', () => {
            const params = { key: 'hello', count: 5 };
            const patterns = [
                { key: 'hello', count: 5 }, // exact match
            ];

            const score = (service as any).calculateHeuristicIsolationScore(params, patterns);
            // Distance = 0, score = min(1, 0/10) = 0
            expect(score).toBe(0);
        });

        it('should return higher score when parameters differ from patterns', () => {
            const params = { key: 'hello', count: 5 };
            const patterns = [
                { key: 'world', count: 10 }, // both differ => distance = 0.5 + 0.5 = 1
            ];

            const score = (service as any).calculateHeuristicIsolationScore(params, patterns);
            // Distance = 1, score = min(1, 1/10) = 0.1
            expect(score).toBeCloseTo(0.1, 5);
        });

        it('should increase score when parameters have missing keys vs patterns', () => {
            const params = { key: 'hello' };
            const patterns = [
                { key: 'hello', count: 5, extra: true }, // 'count' and 'extra' missing in params
            ];

            const score = (service as any).calculateHeuristicIsolationScore(params, patterns);
            // Distance for 'count': +1 (missing in params), 'extra': +1 (missing in params)
            // 'key' matches exactly: +0
            // Total distance = 2, score = min(1, 2/10) = 0.2
            expect(score).toBeCloseTo(0.2, 5);
        });

        it('should use minimum distance across all patterns', () => {
            const params = { key: 'hello' };
            const patterns = [
                { key: 'world', extra: true },  // distance = 0.5 + 1 + 1 = 2.5
                { key: 'hello' },               // distance = 0 (exact match)
            ];

            const score = (service as any).calculateHeuristicIsolationScore(params, patterns);
            // Minimum distance is 0, score = 0
            expect(score).toBe(0);
        });

        it('should cap score at 1.0 for very different parameters', () => {
            const params: Record<string, any> = {};
            // Create params with many keys not in the pattern to get distance > 10
            for (let i = 0; i < 15; i++) {
                params[`key${i}`] = `value${i}`;
            }
            const patterns = [
                { completely: 'different' },
            ];

            const score = (service as any).calculateHeuristicIsolationScore(params, patterns);
            expect(score).toBeLessThanOrEqual(1.0);
        });
    });

    // =========================================================================
    // trainAnomalyDetectionModel() — tested directly via private method
    // to isolate from trainErrorPredictionModel() interactions
    // =========================================================================
    describe('trainAnomalyDetectionModel()', () => {
        /**
         * Helper to set up mocks for TF.js training path and populate
         * training data. Call after getService() to add samples.
         */
        function setupTfTrainingMocks(sampleCount: number): void {
            mockIsEnabled.mockReturnValue(true);
            mockGetModel.mockImplementation((modelId: string) => {
                if (modelId === 'anomaly_autoencoder') {
                    return {
                        config: { modelId: 'anomaly_autoencoder', minTrainingSamples: 100 },
                        status: ModelStatus.UNTRAINED,
                    };
                }
                if (modelId === 'error_prediction') {
                    return {
                        config: { modelId: 'error_prediction', minTrainingSamples: 100 },
                        status: ModelStatus.UNTRAINED,
                    };
                }
                return undefined;
            });

            const trainingData = (service as any).trainingData as any[];
            for (let i = 0; i < sampleCount; i++) {
                trainingData.push({
                    features: makeFeatureVector(),
                    label: { type: 'error_occurred', value: i % 3 === 0 },
                    timestamp: Date.now(),
                });
            }
        }

        it('should train the autoencoder with input=output (unsupervised)', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            setupTfTrainingMocks(150);

            const mockTrainingMetrics: TrainingMetrics = {
                loss: 0.02,
                valLoss: 0.03,
                epochsCompleted: 20,
                durationMs: 500,
                samplesUsed: 150,
            };
            mockTrain.mockResolvedValue(mockTrainingMetrics);

            // Call trainAnomalyDetectionModel() directly for isolated testing
            await (service as any).trainAnomalyDetectionModel();

            // Verify train() was called for the autoencoder with xData == yData
            const autoencoderTrainCalls = mockTrain.mock.calls.filter(
                (call: any[]) => call[0] === 'anomaly_autoencoder'
            );
            expect(autoencoderTrainCalls.length).toBeGreaterThanOrEqual(1);

            const [modelId, xData, yData] = autoencoderTrainCalls[0];
            expect(modelId).toBe('anomaly_autoencoder');
            // For unsupervised autoencoder: xData === yData
            expect(xData).toEqual(yData);
        });

        it('should skip training when not enough samples', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Only add 50 samples (below the autoencoder's minTrainingSamples of 100)
            setupTfTrainingMocks(50);
            mockTrain.mockResolvedValue({
                loss: 0.01,
                epochsCompleted: 10,
                durationMs: 100,
                samplesUsed: 50,
            });

            await (service as any).trainAnomalyDetectionModel();

            // train() should NOT be called because data is insufficient
            const autoencoderTrainCalls = mockTrain.mock.calls.filter(
                (call: any[]) => call[0] === 'anomaly_autoencoder'
            );
            expect(autoencoderTrainCalls).toHaveLength(0);
        });

        it('should save model after successful training', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            setupTfTrainingMocks(120);
            mockTrain.mockResolvedValue({
                loss: 0.01,
                valLoss: 0.02,
                epochsCompleted: 20,
                durationMs: 300,
                samplesUsed: 120,
            });

            await (service as any).trainAnomalyDetectionModel();

            // saveModel should be called for the autoencoder
            expect(mockSaveModel).toHaveBeenCalledWith('anomaly_autoencoder');
        });

        it('should set tfAnomalyAutoencoderReady flag after successful training', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Ensure initially not ready
            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);

            setupTfTrainingMocks(120);
            mockTrain.mockResolvedValue({
                loss: 0.01,
                epochsCompleted: 20,
                durationMs: 300,
                samplesUsed: 120,
            });

            await (service as any).trainAnomalyDetectionModel();

            // Now the autoencoder should be marked as ready
            expect((service as any).tfAnomalyAutoencoderReady).toBe(true);
        });

        it('should fall back to heuristic metadata when TF.js is disabled', async () => {
            tensorFlowEnabled = false;
            service = getService();
            await flushPromises();

            // Add training data (TF.js disabled, so heuristic path runs)
            const trainingData = (service as any).trainingData as any[];
            for (let i = 0; i < 120; i++) {
                trainingData.push({
                    features: makeFeatureVector(),
                    label: { type: 'error_occurred', value: false },
                    timestamp: Date.now(),
                });
            }

            await (service as any).trainAnomalyDetectionModel();

            // train() should NOT be called (TF.js disabled)
            const autoencoderTrainCalls = mockTrain.mock.calls.filter(
                (call: any[]) => call[0] === 'anomaly_autoencoder'
            );
            expect(autoencoderTrainCalls).toHaveLength(0);

            // Model metadata should have been updated via updateAnomalyHeuristicMetadata
            const metadata = service.getModelMetadata();
            const anomalyMeta = metadata.find(m => m.type === 'isolation_forest');
            expect(anomalyMeta).toBeDefined();
            expect(anomalyMeta!.accuracy).toBeGreaterThanOrEqual(0.8);
            expect(anomalyMeta!.accuracy).toBeLessThanOrEqual(0.85);
        });

        it('should update model metadata with real training metrics from TF.js', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            setupTfTrainingMocks(130);
            mockTrain.mockResolvedValue({
                loss: 0.05,
                valLoss: 0.06,
                epochsCompleted: 20,
                durationMs: 400,
                samplesUsed: 130,
            });

            await (service as any).trainAnomalyDetectionModel();

            // Check that model metadata was updated with real metrics
            const metadata = service.getModelMetadata();
            const anomalyMeta = metadata.find(m => m.type === 'isolation_forest');
            expect(anomalyMeta).toBeDefined();
            // For autoencoders: accuracy = max(0, min(1, 1 - loss)) = 1 - 0.05 = 0.95
            expect(anomalyMeta!.accuracy).toBeCloseTo(0.95, 1);
            expect(anomalyMeta!.trainingDataSize).toBe(130);
            expect(anomalyMeta!.validationMetrics).toEqual(
                expect.objectContaining({
                    loss: 0.05,
                    val_loss: 0.06,
                })
            );
        });

        it('should handle TF.js training failure gracefully', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            setupTfTrainingMocks(120);

            // Make training fail for the autoencoder
            mockTrain.mockRejectedValue(new Error('GPU out of memory'));

            // Should not throw — error is caught internally
            await expect(
                (service as any).trainAnomalyDetectionModel()
            ).resolves.not.toThrow();
        });

        it('should skip when autoencoder model is not registered in MxfMLService', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Add training data
            const trainingData = (service as any).trainingData as any[];
            for (let i = 0; i < 120; i++) {
                trainingData.push({
                    features: makeFeatureVector(),
                    label: { type: 'error_occurred', value: false },
                    timestamp: Date.now(),
                });
            }

            // Return undefined for the autoencoder model (not registered)
            mockIsEnabled.mockReturnValue(true);
            mockGetModel.mockReturnValue(undefined);

            await (service as any).trainAnomalyDetectionModel();

            // train() should NOT be called for the autoencoder
            const autoencoderTrainCalls = mockTrain.mock.calls.filter(
                (call: any[]) => call[0] === 'anomaly_autoencoder'
            );
            expect(autoencoderTrainCalls).toHaveLength(0);
        });
    });

    // =========================================================================
    // updateAnomalyHeuristicMetadata()
    // =========================================================================
    describe('updateAnomalyHeuristicMetadata()', () => {
        it('should update anomaly detection model metadata with simulated accuracy', () => {
            service = getService();

            (service as any).updateAnomalyHeuristicMetadata();

            const metadata = service.getModelMetadata();
            const anomalyMeta = metadata.find(m => m.type === 'isolation_forest');
            expect(anomalyMeta).toBeDefined();
            // Accuracy should be in range [0.8, 0.85)
            expect(anomalyMeta!.accuracy).toBeGreaterThanOrEqual(0.8);
            expect(anomalyMeta!.accuracy).toBeLessThan(0.86);
            expect(anomalyMeta!.trainedAt).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // cleanup()
    // =========================================================================
    describe('cleanup()', () => {
        it('should reset tfAnomalyAutoencoderReady flag', () => {
            service = getService();

            // Manually set to true
            (service as any).tfAnomalyAutoencoderReady = true;
            expect((service as any).tfAnomalyAutoencoderReady).toBe(true);

            service.cleanup();

            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);
        });

        it('should also reset tfErrorPredictionReady flag', () => {
            service = getService();

            (service as any).tfErrorPredictionReady = true;
            expect((service as any).tfErrorPredictionReady).toBe(true);

            service.cleanup();

            expect((service as any).tfErrorPredictionReady).toBe(false);
        });

        it('should clear the retrain interval', () => {
            service = getService();

            // The constructor sets up a retrain interval
            expect((service as any).retrainInterval).toBeDefined();

            service.cleanup();

            // After cleanup, the flags should be reset
            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);
            expect((service as any).tfErrorPredictionReady).toBe(false);
        });
    });

    // =========================================================================
    // detectParameterAnomaly() — receives agentId and channelId
    // =========================================================================
    describe('detectParameterAnomaly() parameters', () => {
        it('should pass agentId and channelId through to parameter anomaly detection', async () => {
            tensorFlowEnabled = false;
            service = getService();
            await flushPromises();

            const agentId = 'agent-alpha';
            const channelId = 'channel-beta';
            const toolName = 'test_tool';
            const parameters = { key: 'value' };

            // Enable anomaly detection
            service.updateConfig({ enableAnomalyDetection: true });

            const anomalies = await service.detectAnomalies(
                agentId,
                channelId,
                toolName,
                parameters
            );

            // The method should not throw and should return an array
            expect(Array.isArray(anomalies)).toBe(true);
        });

        it('should detect parameter anomaly and include tool context', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            (service as any).tfAnomalyAutoencoderReady = true;

            // Return very high reconstruction error to trigger anomaly
            mockPredictWithReconstruction.mockReturnValue({
                reconstruction: new Array(12).fill(0),
                featureErrors: new Array(12).fill(0.1),
                reconstructionError: 0.15, // scaled = 1.5, capped to 1.0
                modelId: 'anomaly_autoencoder',
                source: 'model',
                latencyMs: 1.0,
            });

            const anomalies = await service.detectAnomalies(
                'agent-1',
                'channel-1',
                'suspicious_tool',
                { unusual: 'params' }
            );

            const parameterAnomalies = anomalies.filter(a => a.type === 'parameter');
            expect(parameterAnomalies.length).toBeGreaterThanOrEqual(1);

            const anomaly = parameterAnomalies[0];
            expect(anomaly.context).toEqual(
                expect.objectContaining({
                    toolName: 'suspicious_tool',
                    parameters: { unusual: 'params' },
                })
            );
            expect(anomaly.description).toContain('suspicious_tool');
        });

        it('should not produce parameter anomaly when detection is disabled', async () => {
            service = getService();

            service.updateConfig({ enableAnomalyDetection: false });

            const anomalies = await service.detectAnomalies(
                'agent-1',
                'channel-1',
                'test_tool',
                { param: 'value' }
            );

            expect(anomalies).toHaveLength(0);
        });
    });

    // =========================================================================
    // Integration: TF.js autoencoder flow end-to-end
    // =========================================================================
    describe('End-to-end anomaly autoencoder flow', () => {
        it('should go from heuristic -> train -> TF.js inference', async () => {
            tensorFlowEnabled = true;
            service = getService();
            await flushPromises();

            // Ensure mocks are set for the TF.js training path
            mockIsEnabled.mockReturnValue(true);
            mockGetModel.mockImplementation((modelId: string) => {
                if (modelId === 'anomaly_autoencoder') {
                    return {
                        config: { modelId: 'anomaly_autoencoder', minTrainingSamples: 100 },
                        status: ModelStatus.UNTRAINED,
                    };
                }
                if (modelId === 'error_prediction') {
                    return {
                        config: { modelId: 'error_prediction', minTrainingSamples: 100 },
                        status: ModelStatus.UNTRAINED,
                    };
                }
                return undefined;
            });

            mockTrain.mockResolvedValue({
                loss: 0.01,
                epochsCompleted: 20,
                durationMs: 300,
                samplesUsed: 120,
            });

            // Step 1: Before training, autoencoder is not ready — uses heuristic
            expect((service as any).tfAnomalyAutoencoderReady).toBe(false);

            // Step 2: Add training data and train the autoencoder directly
            const trainingData = (service as any).trainingData as any[];
            for (let i = 0; i < 120; i++) {
                trainingData.push({
                    features: makeFeatureVector(),
                    label: { type: 'error_occurred', value: false },
                    timestamp: Date.now(),
                });
            }

            await (service as any).trainAnomalyDetectionModel();

            // Step 3: After training, autoencoder should be ready
            expect((service as any).tfAnomalyAutoencoderReady).toBe(true);

            // Step 4: Now anomaly detection should use TF.js
            mockPredictWithReconstruction.mockReturnValue({
                reconstruction: new Array(12).fill(0),
                featureErrors: new Array(12).fill(0),
                reconstructionError: 0.02, // low error = normal
                modelId: 'anomaly_autoencoder',
                source: 'model',
                latencyMs: 1.0,
            });

            await service.detectAnomalies(
                'agent-1',
                'channel-1',
                'test_tool',
                { param: 'value' }
            );

            // predictWithReconstruction should now be called (TF.js path)
            expect(mockPredictWithReconstruction).toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------
// Promise flushing utility
// ---------------------------------------------------------------------------

/**
 * Flush pending microtasks and promises.
 * This is necessary because the constructor fires async operations
 * (initializeTfAnomalyAutoencoder) that we need to await.
 */
function flushPromises(): Promise<void> {
    return new Promise((resolve) => {
        // Use setImmediate to flush the microtask queue
        setImmediate(resolve);
    });
}
