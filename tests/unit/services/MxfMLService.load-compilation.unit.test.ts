/**
 * Unit test for MxfMLService.loadModel() — compilation survives a reload.
 *
 * Regression guard for the production failure seen in the Railway logs:
 *
 *     [MxfMLService] Training failed for error_prediction:
 *       The model needs to be compiled before being used.
 *     [MxfMLService] Training failed for anomaly_autoencoder:
 *       The model needs to be compiled before being used.
 *
 * Root cause: a model is built and compiled, then saved. On the next server
 * boot the model is built+compiled again and loadModel() is called. The old
 * loadModel() REPLACED the freshly-built compiled model with the output of
 * tf.loadLayersModel(), which is uncompiled whenever the saved artifacts carry
 * no trainingConfig. The GridFS persistence path (GridFSIOHandler) never stores
 * trainingConfig, so every reloaded model came back uncompiled — and the next
 * scheduled retrain threw "The model needs to be compiled before being used."
 *
 * This drives the REAL MxfMLService and REAL @tensorflow/tfjs — no service or
 * tfjs mocks — so it exercises the actual TF.js compilation semantics the bug
 * depends on. Only the storage backend I/O is stubbed (loadModelFromBackend),
 * because the production backend is MongoDB GridFS and the filesystem backend's
 * file:// handler ships only with @tensorflow/tfjs-node. The "loaded" model is
 * produced by a genuine tf.loadLayersModel(fromMemory(...)) round-trip with
 * trainingConfig stripped — byte-for-byte what GridFS reloads return.
 */

import { MxfMLService } from '@mxf-dev/core/services/MxfMLService';
import { MxfModelType, ModelStatus } from '@mxf-dev/core/types/TensorFlowTypes';
import {
    updateTensorFlowConfig,
    resetTensorFlowConfig,
} from '@mxf-dev/core/config/tensorflow.config';

// Real TF.js import + two training rounds run well under this; the default 5s
// unit budget is too tight for the one-time tfjs/CPU-backend initialization.
const TF_TEST_TIMEOUT_MS = 60_000;

const MODEL_ID = 'load_compilation_test';

// Tiny supervised dataset (3-feature inputs, binary label = "all ones").
const X: number[][] = [
    [0, 0, 0],
    [1, 1, 1],
    [0, 1, 0],
    [1, 0, 1],
    [0, 0, 1],
    [1, 1, 0],
];
const Y: number[][] = [[0], [1], [0], [1], [0], [1]];

/**
 * Build a small compiled Dense(3->4->1) classifier. The buildFn is the single
 * source of truth for compilation — both the pre-save and post-reload builds
 * use it, so the saved weights always match the rebuilt architecture.
 */
function buildTinyClassifier(tf: typeof import('@tensorflow/tfjs')): unknown {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 4, activation: 'relu', inputShape: [3] }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
    model.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'binaryCrossentropy',
        metrics: ['accuracy'],
    });
    return model;
}

/**
 * Register + build the test model. Mirrors how PredictiveAnalyticsService sets
 * up its models: register the config, then build (and compile) the network.
 */
async function registerAndBuild(svc: MxfMLService): Promise<void> {
    svc.registerModel({
        modelId: MODEL_ID,
        type: MxfModelType.DENSE_CLASSIFIER,
        inputShape: [3],
        outputShape: [1],
        minTrainingSamples: 4,
        batchSize: 2,
        epochs: 1,
        validationSplit: 0,
        learningRate: 0.01,
        autoTrain: false,
        retrainIntervalMs: 3_600_000,
        hyperparameters: { loss: 'binaryCrossentropy', optimizer: 'adam' },
    });
    await svc.buildSequentialModel(MODEL_ID, buildTinyClassifier);
}

/**
 * Serialize a compiled model and reload it the way the GridFS backend does:
 * persist topology + weights but NOT trainingConfig, so the reloaded model
 * comes back uncompiled. Uses real tf.io in-memory handlers.
 */
async function reloadWithoutTrainingConfig(
    tf: typeof import('@tensorflow/tfjs'),
    model: any
): Promise<unknown> {
    let artifacts: any;
    await model.save(
        tf.io.withSaveHandler(async (a: any) => {
            artifacts = a;
            return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
        })
    );
    // GridFSIOHandler.save() persists only topology + weights — it drops this.
    delete artifacts.trainingConfig;
    return tf.loadLayersModel(tf.io.fromMemory(artifacts));
}

describe('MxfMLService.loadModel() — reloaded model stays trainable', () => {
    beforeAll(() => {
        resetTensorFlowConfig();
        updateTensorFlowConfig({
            enabled: true,
            autoTrainEnabled: false,
            memoryLoggingIntervalMs: 0,
        });
    });

    afterAll(async () => {
        await MxfMLService.getInstance().dispose();
        resetTensorFlowConfig();
    });

    it(
        'retrains a model reloaded from storage that has no persisted trainingConfig',
        async () => {
            const svc = MxfMLService.getInstance();
            await svc.initialize();
            const tf = svc.getTf();

            // 1) Build (compiled) -> train. This is the model that gets persisted.
            await registerAndBuild(svc);
            await svc.train(MODEL_ID, X, Y);

            // 2) Reload it the way GridFS does: no trainingConfig -> uncompiled.
            const trainedModel = svc.getModel(MODEL_ID)!.model;
            const uncompiledReload = await reloadWithoutTrainingConfig(tf, trainedModel);

            // 3) Mimic a server restart: clear in-memory state, then build the
            //    compiled model again before loading the saved weights on top.
            svc.reset();
            await registerAndBuild(svc);

            // Stub only the backend I/O — production uses MongoDB GridFS, and the
            // filesystem file:// handler is not in pure @tensorflow/tfjs.
            (svc as any).loadModelFromBackend = async () => ({
                loaded: uncompiledReload,
                source: `gridfs://${MODEL_ID}`,
            });

            const loaded = await svc.loadModel(MODEL_ID);
            expect(loaded).toBe(true);
            expect(svc.getModel(MODEL_ID)!.status).toBe(ModelStatus.TRAINED);

            // 4) The reloaded model must remain trainable. Before the fix this
            //    rejects with "The model needs to be compiled before being used."
            const metrics = await svc.train(MODEL_ID, X, Y);
            expect(metrics).toBeDefined();
            expect(svc.getModel(MODEL_ID)!.status).toBe(ModelStatus.TRAINED);

            // Inference still works after the reload + retrain.
            const result = svc.predict(MODEL_ID, [1, 1, 1]);
            expect(result.values).toHaveLength(1);
        },
        TF_TEST_TIMEOUT_MS
    );
});
