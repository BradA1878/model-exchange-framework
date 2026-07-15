/**
 * Unit tests for MxfMLService — training concurrency and tensor lifecycle
 *
 * Covers the guards added after duplicate retrain schedules caused hourly
 * fit() collisions ("Cannot start training because another fit() call is ongoing"):
 * - train(): rejects a second call while the model is already training
 * - trainCustom(): same reentrancy contract as train()
 * - train(): disposes input tensors on both success and failure (no leak when fit() throws)
 * - scheduleRetrain(): no-ops when autoTrainEnabled=false, arms a timer otherwise
 */

import { MxfModelType, ModelStatus } from '@mxf-dev/core/types/TensorFlowTypes';

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

// TensorFlow config mock — autoTrainEnabled is mutable per test
let tensorFlowEnabled = true;
let autoTrainEnabled = true;

jest.mock('@mxf-dev/core/config/tensorflow.config', () => ({
    isTensorFlowEnabled: jest.fn(() => tensorFlowEnabled),
    getTensorFlowConfig: jest.fn(() => ({
        enabled: tensorFlowEnabled,
        autoTrainEnabled,
        globalRetrainIntervalMs: 3600000,
        memoryLoggingIntervalMs: 0,
    })),
    getStorageBackend: jest.fn(() => 'filesystem'),
    getModelStoragePath: jest.fn(() => '/tmp/tf-models-test'),
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

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { MxfMLService } from '@mxf-dev/core/services/MxfMLService';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MODEL_ID = 'test_model';
const FEATURES = 4;

/** Tensors created by the fake tf.tensor2d, in creation order */
let createdTensors: Array<{ dispose: jest.Mock }>;

/** The model's fit mock — resolves/rejects per test */
let mockFit: jest.Mock;

function makeFakeTf() {
    return {
        tensor2d: jest.fn(() => {
            const tensor = { dispose: jest.fn() };
            createdTensors.push(tensor);
            return tensor;
        }),
    };
}

function makeFitResult(overrides: Record<string, unknown> = {}) {
    return {
        history: {
            loss: [0.5, 0.1],
            acc: [0.8, 0.95],
            val_loss: [0.2],
            val_acc: [0.9],
        },
        epoch: [0, 1],
        ...overrides,
    };
}

/** A service with an injected fake tf runtime and one built model */
function makeService(): MxfMLService {
    (MxfMLService as any).instance = undefined;
    const service = MxfMLService.getInstance();
    (service as any).tf = makeFakeTf();
    (service as any).initialized = true;

    service.registerModel({
        modelId: MODEL_ID,
        type: MxfModelType.DENSE_CLASSIFIER,
        inputShape: [FEATURES],
        outputShape: [1],
        minTrainingSamples: 2,
        batchSize: 2,
        epochs: 2,
        validationSplit: 0.1,
        learningRate: 0.001,
        autoTrain: true,
        retrainIntervalMs: 1000,
    });

    const entry = service.getModel(MODEL_ID)!;
    entry.model = { fit: mockFit };

    return service;
}

function makeTrainingData(samples = 4): { xData: number[][]; yData: number[][] } {
    const xData = Array.from({ length: samples }, () => new Array(FEATURES).fill(0.5));
    const yData = Array.from({ length: samples }, () => [0]);
    return { xData, yData };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MxfMLService — training concurrency and tensor lifecycle', () => {
    let service: MxfMLService;

    beforeEach(() => {
        jest.clearAllMocks();
        tensorFlowEnabled = true;
        autoTrainEnabled = true;
        createdTensors = [];
        mockFit = jest.fn().mockResolvedValue(makeFitResult());
        service = makeService();
    });

    afterEach(() => {
        service.reset();
        (MxfMLService as any).instance = undefined;
    });

    // =========================================================================
    // train() — reentrancy guard
    // =========================================================================
    describe('train() reentrancy guard', () => {
        it('should reject a second train() call while the first is still fitting', async () => {
            const { xData, yData } = makeTrainingData();

            // First call's fit() stays pending until we resolve it
            let resolveFit!: (value: unknown) => void;
            mockFit.mockReturnValueOnce(new Promise((resolve) => { resolveFit = resolve; }));

            const first = service.train(MODEL_ID, xData, yData);
            expect(service.getModel(MODEL_ID)!.status).toBe(ModelStatus.TRAINING);

            await expect(service.train(MODEL_ID, xData, yData)).rejects.toThrow(
                /already training/
            );

            // The rejected call must not have reached fit() or created tensors
            expect(mockFit).toHaveBeenCalledTimes(1);
            expect(createdTensors).toHaveLength(2);

            // The original training completes unaffected
            resolveFit(makeFitResult());
            const metrics = await first;
            expect(metrics.loss).toBe(0.1);
            expect(service.getModel(MODEL_ID)!.status).toBe(ModelStatus.TRAINED);
        });

        it('should allow sequential train() calls', async () => {
            const { xData, yData } = makeTrainingData();

            await service.train(MODEL_ID, xData, yData);
            await service.train(MODEL_ID, xData, yData);

            expect(mockFit).toHaveBeenCalledTimes(2);
            expect(service.getModel(MODEL_ID)!.status).toBe(ModelStatus.TRAINED);
        });
    });

    // =========================================================================
    // trainCustom() — same reentrancy contract
    // =========================================================================
    describe('trainCustom() reentrancy guard', () => {
        it('should reject trainCustom() while train() is in flight', async () => {
            const { xData, yData } = makeTrainingData();

            let resolveFit!: (value: unknown) => void;
            mockFit.mockReturnValueOnce(new Promise((resolve) => { resolveFit = resolve; }));

            const first = service.train(MODEL_ID, xData, yData);

            const customTrainFn = jest.fn();
            await expect(service.trainCustom(MODEL_ID, customTrainFn)).rejects.toThrow(
                /already training/
            );
            expect(customTrainFn).not.toHaveBeenCalled();

            resolveFit(makeFitResult());
            await first;
        });
    });

    // =========================================================================
    // train() — tensor disposal
    // =========================================================================
    describe('train() tensor disposal', () => {
        it('should dispose input tensors when fit() succeeds', async () => {
            const { xData, yData } = makeTrainingData();

            await service.train(MODEL_ID, xData, yData);

            expect(createdTensors).toHaveLength(2);
            for (const tensor of createdTensors) {
                expect(tensor.dispose).toHaveBeenCalledTimes(1);
            }
        });

        it('should dispose input tensors when fit() throws (no leak on failure)', async () => {
            const { xData, yData } = makeTrainingData();
            mockFit.mockRejectedValueOnce(
                new Error('Cannot start training because another fit() call is ongoing.')
            );

            await expect(service.train(MODEL_ID, xData, yData)).rejects.toThrow(
                /another fit\(\) call is ongoing/
            );

            expect(createdTensors).toHaveLength(2);
            for (const tensor of createdTensors) {
                expect(tensor.dispose).toHaveBeenCalledTimes(1);
            }
            expect(service.getModel(MODEL_ID)!.status).toBe(ModelStatus.FAILED);
        });
    });

    // =========================================================================
    // scheduleRetrain() — autoTrainEnabled gate
    // =========================================================================
    describe('scheduleRetrain() autoTrainEnabled gate', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should not arm a timer when autoTrainEnabled is false', () => {
            autoTrainEnabled = false;

            const callback = jest.fn().mockResolvedValue(undefined);
            service.scheduleRetrain(MODEL_ID, callback);

            expect((service as any).retrainTimers.size).toBe(0);
            jest.advanceTimersByTime(10_000);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should arm a timer at the model retrainIntervalMs when enabled', () => {
            const callback = jest.fn().mockResolvedValue(undefined);
            service.scheduleRetrain(MODEL_ID, callback);

            expect((service as any).retrainTimers.size).toBe(1);
            jest.advanceTimersByTime(1000);
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });
});
