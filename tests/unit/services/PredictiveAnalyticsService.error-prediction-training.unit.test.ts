/**
 * Unit tests for PredictiveAnalyticsService — error prediction training
 *
 * Covers the guards added after the hourly duplicate-training incident:
 * - trainErrorPredictionModel(): class-balance guard — one-class data must not
 *   train the classifier (it reports perfect accuracy while learning nothing)
 * - trainErrorPredictionModel(): metadata prefers validation accuracy and never
 *   fabricates a value
 * - initializeTensorFlowModels(): no per-model MxfMLService.scheduleRetrain()
 *   timers — the service's own interval is the single retraining owner
 * - startRetrainSchedule(): honors autoTrainEnabled when TF.js is enabled,
 *   always runs in heuristic mode (TF.js disabled)
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the service under test
// ---------------------------------------------------------------------------

const mockServerEmit = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: mockServerEmit,
            on: jest.fn(),
        },
    },
}));

const mockGetEnhancedPatterns = jest.fn().mockResolvedValue({
    successful: [],
    shared: [],
});

jest.mock('@mxf-dev/core/services/PatternLearningService', () => ({
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

jest.mock('@mxf-dev/core/services/MxfMLService', () => ({
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

// TensorFlow config mocks — enabled state and autoTrainEnabled mutable per test
let tensorFlowEnabled = false;
let autoTrainEnabled = true;

jest.mock('@mxf-dev/core/config/tensorflow.config', () => ({
    isTensorFlowEnabled: jest.fn(() => tensorFlowEnabled),
    getTensorFlowConfig: jest.fn(() => ({
        enabled: tensorFlowEnabled,
        autoTrainEnabled,
        globalRetrainIntervalMs: 3600000,
    })),
}));

// Mock Logger to suppress output during tests
jest.mock('@mxf-dev/core/utils/Logger', () => ({
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

import { PredictiveAnalyticsService } from '@mxf-dev/core/services/PredictiveAnalyticsService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function resetSingleton(): void {
    (PredictiveAnalyticsService as any).instance = undefined;
}

function getService(): PredictiveAnalyticsService {
    return PredictiveAnalyticsService.getInstance();
}

/** Mimics what extractFeatures() returns */
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

/** Seed collected training data with the given label distribution */
function seedTrainingData(service: any, positives: number, negatives: number): void {
    const data = service.trainingData as any[];
    for (let i = 0; i < positives; i++) {
        data.push({
            features: makeFeatureVector(),
            label: { type: 'error_occurred', value: true },
            timestamp: Date.now(),
        });
    }
    for (let i = 0; i < negatives; i++) {
        data.push({
            features: makeFeatureVector(),
            label: { type: 'error_occurred', value: false },
            timestamp: Date.now(),
        });
    }
}

function makeTrainingMetrics(overrides: Record<string, unknown> = {}) {
    return {
        loss: 0.05,
        valLoss: 0.08,
        accuracy: 0.97,
        valAccuracy: 0.9,
        epochsCompleted: 10,
        durationMs: 500,
        samplesUsed: 342,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PredictiveAnalyticsService — Error Prediction Training', () => {
    let service: PredictiveAnalyticsService;

    beforeEach(() => {
        jest.clearAllMocks();
        tensorFlowEnabled = false;
        autoTrainEnabled = true;
        resetSingleton();
        jest.clearAllTimers();
    });

    afterEach(() => {
        if (service) {
            service.cleanup();
        }
    });

    // =========================================================================
    // trainErrorPredictionModel() — class-balance guard
    // =========================================================================
    describe('trainErrorPredictionModel() class-balance guard', () => {
        beforeEach(() => {
            tensorFlowEnabled = true;
            mockGetModel.mockReturnValue({ config: { minTrainingSamples: 100 } });
            mockTrain.mockResolvedValue(makeTrainingMetrics());
        });

        it('should not train on one-class data (all negatives)', async () => {
            service = getService();
            seedTrainingData(service, 0, 342);

            await (service as any).trainErrorPredictionModel();

            expect(mockTrain).not.toHaveBeenCalled();
            expect(mockSaveModel).not.toHaveBeenCalled();
            expect((service as any).tfErrorPredictionReady).toBe(false);

            // Heuristic bookkeeping stays current — accuracy is honestly unmeasured
            const meta = (service as any).modelMetadata.get('error_prediction');
            expect(meta.accuracy).toBeNull();
            expect(meta.trainingDataSize).toBe(342);
        });

        it('should not train on one-class data (all positives)', async () => {
            service = getService();
            seedTrainingData(service, 342, 0);

            await (service as any).trainErrorPredictionModel();

            expect(mockTrain).not.toHaveBeenCalled();
        });

        it('should not train when the minority class is below the adaptive floor', async () => {
            service = getService();
            // floor = max(3, ceil(342 * 0.02)) = 7 — 4 positives is below it
            seedTrainingData(service, 4, 338);

            await (service as any).trainErrorPredictionModel();

            expect(mockTrain).not.toHaveBeenCalled();
        });

        it('should train when both classes meet the minority floor', async () => {
            service = getService();
            // floor = max(3, ceil(342 * 0.02)) = 7 — 42 positives clears it
            seedTrainingData(service, 42, 300);

            await (service as any).trainErrorPredictionModel();

            expect(mockTrain).toHaveBeenCalledWith(
                'error_prediction',
                expect.any(Array),
                expect.any(Array)
            );
            expect(mockSaveModel).toHaveBeenCalledWith('error_prediction');
            expect((service as any).tfErrorPredictionReady).toBe(true);
        });

        it('should not clobber metadata of a previously trained model when skipping', async () => {
            service = getService();
            seedTrainingData(service, 0, 342);

            // Simulate a model trained earlier (this session or loaded from storage)
            (service as any).tfErrorPredictionReady = true;
            const meta = (service as any).modelMetadata.get('error_prediction');
            meta.accuracy = 0.9;
            meta.trainingDataSize = 1234;

            await (service as any).trainErrorPredictionModel();

            expect(mockTrain).not.toHaveBeenCalled();
            expect(meta.accuracy).toBe(0.9);
            expect(meta.trainingDataSize).toBe(1234);
        });
    });

    // =========================================================================
    // trainErrorPredictionModel() — metadata honesty
    // =========================================================================
    describe('trainErrorPredictionModel() metadata', () => {
        beforeEach(() => {
            tensorFlowEnabled = true;
            mockGetModel.mockReturnValue({ config: { minTrainingSamples: 100 } });
        });

        it('should prefer validation accuracy over training accuracy', async () => {
            mockTrain.mockResolvedValue(makeTrainingMetrics({ accuracy: 0.97, valAccuracy: 0.9 }));
            service = getService();
            seedTrainingData(service, 42, 300);

            await (service as any).trainErrorPredictionModel();

            const meta = (service as any).modelMetadata.get('error_prediction');
            expect(meta.accuracy).toBe(0.9);
        });

        it('should fall back to training accuracy when validation accuracy is missing', async () => {
            mockTrain.mockResolvedValue(
                makeTrainingMetrics({ accuracy: 0.8, valAccuracy: undefined })
            );
            service = getService();
            seedTrainingData(service, 42, 300);

            await (service as any).trainErrorPredictionModel();

            const meta = (service as any).modelMetadata.get('error_prediction');
            expect(meta.accuracy).toBe(0.8);
        });

        it('should record null rather than fabricate accuracy when metrics lack both', async () => {
            mockTrain.mockResolvedValue(
                makeTrainingMetrics({ accuracy: undefined, valAccuracy: undefined })
            );
            service = getService();
            seedTrainingData(service, 42, 300);

            await (service as any).trainErrorPredictionModel();

            const meta = (service as any).modelMetadata.get('error_prediction');
            expect(meta.accuracy).toBeNull();
        });
    });

    // =========================================================================
    // Retraining ownership — single interval, no per-model timers
    // =========================================================================
    describe('retraining ownership', () => {
        it('should not register MxfMLService.scheduleRetrain timers during TF init', async () => {
            tensorFlowEnabled = true;
            service = getService();

            await service.initializeTensorFlowModels();

            expect(mockScheduleRetrain).not.toHaveBeenCalled();
        });

        it('should arm the retrain interval when TF.js is enabled and autoTrain is on', () => {
            tensorFlowEnabled = true;
            autoTrainEnabled = true;

            service = getService();

            expect((service as any).retrainInterval).toBeDefined();
        });

        it('should not arm the retrain interval when TF.js is enabled and autoTrain is off', () => {
            tensorFlowEnabled = true;
            autoTrainEnabled = false;

            service = getService();

            expect((service as any).retrainInterval).toBeUndefined();
        });

        it('should arm the retrain interval in heuristic mode regardless of autoTrain', () => {
            tensorFlowEnabled = false;
            autoTrainEnabled = false;

            service = getService();

            expect((service as any).retrainInterval).toBeDefined();
        });
    });
});
