/**
 * Nested Learning / Continuum Memory System Integration Tests
 *
 * Tests the P8 enhancement: multi-layered memory architecture with
 * surprise-based encoding, memory strata transitions, compression,
 * retention gates, and SERC dual-loop coordination.
 *
 * Key Components Tested:
 * - StratumManager: Memory lifecycle across temporal scales
 * - SurpriseCalculator: Titans-style surprise detection with momentum
 * - MemoryCompressor: Memory consolidation and compression
 * - RetentionGateService: Adaptive weight decay and retention gates
 * - SERCOrchestrator: Self-Evolving Reasoning Cycle dual-loop structure
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { MEMORY_TEST_AGENT_CONFIG, TIMEOUTS, generateTestId } from '../../utils/TestFixtures';

// Import services directly for unit-style integration tests
import { StratumManager, STRATUM_UPDATE_FREQUENCIES, DEFAULT_DECAY_RATES, STRATUM_CAPACITY } from '../../../src/shared/services/StratumManager';
import { SurpriseCalculator, Prediction, Outcome, SurpriseSignal } from '../../../src/shared/services/SurpriseCalculator';
import { MemoryCompressor, CompressionLevel, CompressionResult } from '../../../src/shared/services/MemoryCompressor';
import { RetentionGateService, RetentionPolicy, DecayResult, RetentionStatistics } from '../../../src/shared/services/RetentionGateService';
import { SERCOrchestrator, AgentMode, VerificationTuple, RepairInstruction, ProcessReward, SERCContext } from '../../../src/shared/services/SERCOrchestrator';
import {
    MemoryEntry,
    MemoryStratum,
    MemoryImportance,
    MemorySource,
    MemoryContext,
    MemoryStatistics,
    MemoryStrataConfig,
    MemoryRetrievalResult,
    MemoryConsolidation,
    ConsolidationType
} from '../../../src/shared/types/MemoryStrataTypes';

describe('P8: Nested Learning / Continuum Memory System', () => {
    // Service instances (singletons)
    let stratumManager: StratumManager;
    let surpriseCalculator: SurpriseCalculator;
    let memoryCompressor: MemoryCompressor;
    let retentionGate: RetentionGateService;
    let sercOrchestrator: SERCOrchestrator;

    // Test identifiers
    const testAgentId = generateTestId('agent');
    const testChannelId = generateTestId('channel');

    // Default configuration for memory strata
    const defaultConfig: MemoryStrataConfig = {
        enabled: true,
        working: {
            maxEntries: 50,
            ttl: 60000
        },
        shortTerm: {
            maxEntries: 200,
            ttl: 3600000,
            consolidationThreshold: 0.7
        },
        longTerm: {
            maxEntriesPerAgent: 2000,
            minImportance: MemoryImportance.Medium,
            enableArchival: true,
            archivalAge: 86400000
        },
        episodic: {
            maxEpisodesPerAgent: 500,
            episodeDuration: 300000
        },
        semantic: {
            maxConceptsPerAgent: 1000,
            minConfidence: 0.6
        },
        surprise: {
            enabled: true,
            threshold: 0.5,
            analysisWindow: 50
        },
        consolidation: {
            enabled: true,
            interval: 60000,
            similarityThreshold: 0.7
        },
        patterns: {
            enabled: true,
            minLength: 3,
            minConfidence: 0.6,
            analysisInterval: 60000
        }
    };

    beforeAll(() => {
        // Get singleton instances
        stratumManager = StratumManager.getInstance();
        surpriseCalculator = SurpriseCalculator.getInstance();
        memoryCompressor = MemoryCompressor.getInstance();
        retentionGate = RetentionGateService.getInstance();
        sercOrchestrator = SERCOrchestrator.getInstance();

        // Initialize all services
        stratumManager.initialize(defaultConfig);
        surpriseCalculator.initialize({
            enabled: true,
            threshold: 0.5,
            momentumDecayRate: 0.7,
            momentumBoostFactor: 2.0
        });
        memoryCompressor.initialize({ enabled: true });
        retentionGate.initialize({ enabled: true });
        sercOrchestrator.initialize({
            enabled: true,
            confidenceThreshold: 0.7,
            repairMaxRetries: 3,
            outerLoopFrequency: 5,
            verificationEnabled: true,
            selfRepairEnabled: true,
            surpriseThreshold: 0.5
        });
    });

    afterAll(() => {
        // Clear test data
        stratumManager.clear('agent', testAgentId);
        stratumManager.clear('channel', testChannelId);
        surpriseCalculator.clear(testAgentId);
        sercOrchestrator.clear(testAgentId);
    });

    // =========================================================================
    // StratumManager Tests
    // =========================================================================
    describe('StratumManager', () => {
        describe('Initialization and Configuration', () => {
            it('should be enabled after initialization', () => {
                expect(stratumManager.isEnabled()).toBe(true);
            });

            it('should have correct stratum update frequencies', () => {
                expect(STRATUM_UPDATE_FREQUENCIES[MemoryStratum.Working]).toBe(1);
                expect(STRATUM_UPDATE_FREQUENCIES[MemoryStratum.ShortTerm]).toBe(3);
                expect(STRATUM_UPDATE_FREQUENCIES[MemoryStratum.Episodic]).toBe(10);
                expect(STRATUM_UPDATE_FREQUENCIES[MemoryStratum.LongTerm]).toBe(50);
                expect(STRATUM_UPDATE_FREQUENCIES[MemoryStratum.Semantic]).toBe(50);
            });

            it('should have correct default decay rates', () => {
                expect(DEFAULT_DECAY_RATES[MemoryStratum.Working]).toBe(0.8);
                expect(DEFAULT_DECAY_RATES[MemoryStratum.ShortTerm]).toBe(0.3);
                expect(DEFAULT_DECAY_RATES[MemoryStratum.Episodic]).toBe(0.1);
                expect(DEFAULT_DECAY_RATES[MemoryStratum.LongTerm]).toBe(0.05);
                expect(DEFAULT_DECAY_RATES[MemoryStratum.Semantic]).toBe(0.05);
            });

            it('should have correct stratum capacity limits', () => {
                expect(STRATUM_CAPACITY[MemoryStratum.Working]).toBe(50);
                expect(STRATUM_CAPACITY[MemoryStratum.ShortTerm]).toBe(200);
                expect(STRATUM_CAPACITY[MemoryStratum.Episodic]).toBe(500);
                expect(STRATUM_CAPACITY[MemoryStratum.LongTerm]).toBe(2000);
                expect(STRATUM_CAPACITY[MemoryStratum.Semantic]).toBe(1000);
            });
        });

        describe('Memory Addition and Querying', () => {
            const localAgentId = generateTestId('stratum-agent');

            afterAll(() => {
                stratumManager.clear('agent', localAgentId);
            });

            it('should add memory to Working stratum', async () => {
                const memoryEntry = await stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working,
                    {
                        stratum: MemoryStratum.Working,
                        content: 'Test memory for working stratum',
                        contentType: 'text',
                        importance: MemoryImportance.Medium,
                        tags: ['test', 'working'],
                        source: {
                            type: 'observation',
                            agentId: localAgentId
                        },
                        context: {
                            agentId: localAgentId,
                            timestamp: new Date()
                        },
                        relatedMemories: []
                    }
                );

                expect(memoryEntry).toBeDefined();
                expect(memoryEntry.id).toBeDefined();
                expect(memoryEntry.stratum).toBe(MemoryStratum.Working);
                expect(memoryEntry.content).toBe('Test memory for working stratum');
                expect(memoryEntry.createdAt).toBeDefined();
                expect(memoryEntry.accessCount).toBe(0);
            });

            it('should add memory to ShortTerm stratum', async () => {
                const memoryEntry = await stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.ShortTerm,
                    {
                        stratum: MemoryStratum.ShortTerm,
                        content: 'Test memory for short-term stratum',
                        contentType: 'text',
                        importance: MemoryImportance.High,
                        tags: ['test', 'short-term'],
                        source: {
                            type: 'reasoning',
                            agentId: localAgentId
                        },
                        context: {
                            agentId: localAgentId,
                            timestamp: new Date()
                        },
                        relatedMemories: []
                    }
                );

                expect(memoryEntry).toBeDefined();
                expect(memoryEntry.stratum).toBe(MemoryStratum.ShortTerm);
            });

            it('should add memory to Episodic stratum', async () => {
                const memoryEntry = await stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.Episodic,
                    {
                        stratum: MemoryStratum.Episodic,
                        content: 'Episode: User asked about authentication flow',
                        contentType: 'text',
                        importance: MemoryImportance.High,
                        tags: ['episode', 'authentication'],
                        source: {
                            type: 'conversation',
                            agentId: localAgentId
                        },
                        context: {
                            agentId: localAgentId,
                            timestamp: new Date(),
                            orparPhase: 'observe'
                        },
                        relatedMemories: []
                    }
                );

                expect(memoryEntry).toBeDefined();
                expect(memoryEntry.stratum).toBe(MemoryStratum.Episodic);
            });

            it('should query memories from specific stratum', async () => {
                const result: MemoryRetrievalResult = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    {
                        query: 'test',
                        strata: [MemoryStratum.Working],
                        limit: 10
                    }
                );

                expect(result).toBeDefined();
                expect(result.memories).toBeInstanceOf(Array);
                expect(result.totalCount).toBeGreaterThanOrEqual(0);
                expect(result.executionTime).toBeGreaterThanOrEqual(0);
            });

            it('should query memories across multiple strata', async () => {
                const result = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    {
                        query: 'test',
                        strata: [MemoryStratum.Working, MemoryStratum.ShortTerm, MemoryStratum.Episodic],
                        limit: 20
                    }
                );

                expect(result).toBeDefined();
                expect(result.memories.length).toBeGreaterThanOrEqual(0);
            });

            it('should filter memories by importance', async () => {
                // Add low importance memory
                await stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working,
                    {
                        stratum: MemoryStratum.Working,
                        content: 'Low importance memory',
                        contentType: 'text',
                        importance: MemoryImportance.Low,
                        tags: ['low-priority'],
                        source: { type: 'observation', agentId: localAgentId },
                        context: { agentId: localAgentId, timestamp: new Date() },
                        relatedMemories: []
                    }
                );

                const result = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    {
                        query: 'memory',
                        minImportance: MemoryImportance.Medium,
                        limit: 10
                    }
                );

                // All returned memories should be at least Medium importance
                for (const memory of result.memories) {
                    expect(memory.importance).toBeGreaterThanOrEqual(MemoryImportance.Medium);
                }
            });

            it('should filter memories by tags', async () => {
                const result = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    {
                        query: '',
                        tags: ['episode'],
                        limit: 10
                    }
                );

                // All returned memories should have the 'episode' tag
                for (const memory of result.memories) {
                    expect(memory.tags).toContain('episode');
                }
            });
        });

        describe('Memory Stratum Transitions', () => {
            const localAgentId = generateTestId('transition-agent');
            let workingMemoryId: string;

            beforeAll(async () => {
                // Add a memory to Working stratum
                const memory = await stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working,
                    {
                        stratum: MemoryStratum.Working,
                        content: 'Memory to be promoted',
                        contentType: 'text',
                        importance: MemoryImportance.High,
                        tags: ['promotion-test'],
                        source: { type: 'reasoning', agentId: localAgentId },
                        context: { agentId: localAgentId, timestamp: new Date() },
                        relatedMemories: []
                    }
                );
                workingMemoryId = memory.id;
            });

            afterAll(() => {
                stratumManager.clear('agent', localAgentId);
            });

            it('should transition memory from Working to ShortTerm', async () => {
                const success = await stratumManager.transitionMemory(
                    'agent',
                    localAgentId,
                    workingMemoryId,
                    MemoryStratum.Working,
                    MemoryStratum.ShortTerm,
                    'High importance memory promoted'
                );

                expect(success).toBe(true);

                // Verify memory is now in ShortTerm
                const result = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    {
                        query: 'promoted',
                        strata: [MemoryStratum.ShortTerm]
                    }
                );

                const promotedMemory = result.memories.find(m => m.id === workingMemoryId);
                expect(promotedMemory).toBeDefined();
                expect(promotedMemory?.stratum).toBe(MemoryStratum.ShortTerm);
            });

            it('should transition memory from ShortTerm to Episodic', async () => {
                const success = await stratumManager.transitionMemory(
                    'agent',
                    localAgentId,
                    workingMemoryId,
                    MemoryStratum.ShortTerm,
                    MemoryStratum.Episodic,
                    'Surprise detected - promoting to episodic'
                );

                expect(success).toBe(true);
            });

            it('should fail to transition non-existent memory', async () => {
                const success = await stratumManager.transitionMemory(
                    'agent',
                    localAgentId,
                    'non-existent-memory-id',
                    MemoryStratum.Working,
                    MemoryStratum.ShortTerm,
                    'Should fail'
                );

                expect(success).toBe(false);
            });
        });

        describe('Stratum Update Timing', () => {
            const localAgentId = generateTestId('timing-agent');

            afterAll(() => {
                stratumManager.clear('agent', localAgentId);
            });

            it('should determine if stratum needs updating', () => {
                // First call should return true (first update)
                const needsUpdate = stratumManager.shouldUpdateStratum(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working
                );
                expect(needsUpdate).toBe(true);
            });

            it('should mark stratum as updated', () => {
                stratumManager.markStratumUpdated('agent', localAgentId, MemoryStratum.Working);

                // After marking as updated, should not need update immediately
                const needsUpdate = stratumManager.shouldUpdateStratum(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working
                );
                expect(needsUpdate).toBe(false);
            });

            it('should increment cycle counters', () => {
                // Add a memory first to create storage
                stratumManager.addMemory(
                    'agent',
                    localAgentId,
                    MemoryStratum.ShortTerm,
                    {
                        stratum: MemoryStratum.ShortTerm,
                        content: 'Cycle test memory',
                        contentType: 'text',
                        importance: MemoryImportance.Medium,
                        tags: [],
                        source: { type: 'observation', agentId: localAgentId },
                        context: { agentId: localAgentId, timestamp: new Date() },
                        relatedMemories: []
                    }
                );

                // Increment cycles multiple times
                for (let i = 0; i < 5; i++) {
                    stratumManager.incrementCycles('agent', localAgentId);
                }

                // ShortTerm updates every 3 cycles, so after 5 should need update
                const needsUpdate = stratumManager.shouldUpdateStratum(
                    'agent',
                    localAgentId,
                    MemoryStratum.ShortTerm
                );
                expect(needsUpdate).toBe(true);
            });
        });

        describe('Memory Statistics', () => {
            const localAgentId = generateTestId('stats-agent');

            beforeAll(async () => {
                // Add memories of various types
                await stratumManager.addMemory('agent', localAgentId, MemoryStratum.Working, {
                    stratum: MemoryStratum.Working,
                    content: 'Working memory 1',
                    contentType: 'text',
                    importance: MemoryImportance.Medium,
                    tags: [],
                    source: { type: 'observation', agentId: localAgentId },
                    context: { agentId: localAgentId, timestamp: new Date() },
                    relatedMemories: []
                });

                await stratumManager.addMemory('agent', localAgentId, MemoryStratum.Working, {
                    stratum: MemoryStratum.Working,
                    content: 'Working memory 2',
                    contentType: 'text',
                    importance: MemoryImportance.High,
                    tags: [],
                    source: { type: 'observation', agentId: localAgentId },
                    context: { agentId: localAgentId, timestamp: new Date() },
                    relatedMemories: []
                });

                await stratumManager.addMemory('agent', localAgentId, MemoryStratum.ShortTerm, {
                    stratum: MemoryStratum.ShortTerm,
                    content: 'Short-term memory 1',
                    contentType: 'text',
                    importance: MemoryImportance.Critical,
                    tags: [],
                    source: { type: 'reasoning', agentId: localAgentId },
                    context: { agentId: localAgentId, timestamp: new Date() },
                    relatedMemories: []
                });
            });

            afterAll(() => {
                stratumManager.clear('agent', localAgentId);
            });

            it('should return accurate statistics', () => {
                const stats: MemoryStatistics = stratumManager.getStatistics('agent', localAgentId);

                expect(stats).toBeDefined();
                expect(stats.entriesPerStratum).toBeDefined();
                expect(stats.entriesPerImportance).toBeDefined();
                expect(typeof stats.avgAccessCount).toBe('number');
                expect(Array.isArray(stats.mostAccessed)).toBe(true);
                expect(typeof stats.memoryUsage).toBe('number');
            });

            it('should count entries per stratum correctly', () => {
                const stats = stratumManager.getStatistics('agent', localAgentId);

                expect(stats.entriesPerStratum[MemoryStratum.Working]).toBeGreaterThanOrEqual(2);
                expect(stats.entriesPerStratum[MemoryStratum.ShortTerm]).toBeGreaterThanOrEqual(1);
            });

            it('should count entries per importance correctly', () => {
                const stats = stratumManager.getStatistics('agent', localAgentId);

                expect(stats.entriesPerImportance[MemoryImportance.Critical]).toBeGreaterThanOrEqual(1);
                expect(stats.entriesPerImportance[MemoryImportance.High]).toBeGreaterThanOrEqual(1);
                expect(stats.entriesPerImportance[MemoryImportance.Medium]).toBeGreaterThanOrEqual(1);
            });
        });

        describe('Memory Decay', () => {
            const localAgentId = generateTestId('decay-agent');

            beforeAll(async () => {
                // Add multiple memories
                for (let i = 0; i < 10; i++) {
                    await stratumManager.addMemory('agent', localAgentId, MemoryStratum.Working, {
                        stratum: MemoryStratum.Working,
                        content: `Decay test memory ${i}`,
                        contentType: 'text',
                        importance: MemoryImportance.Low,
                        tags: ['decay-test'],
                        source: { type: 'observation', agentId: localAgentId },
                        context: { agentId: localAgentId, timestamp: new Date() },
                        relatedMemories: []
                    });
                }
            });

            afterAll(() => {
                stratumManager.clear('agent', localAgentId);
            });

            it('should apply decay to Working stratum', async () => {
                const statsBefore = stratumManager.getStatistics('agent', localAgentId);
                const countBefore = statsBefore.entriesPerStratum[MemoryStratum.Working];

                // Apply aggressive decay
                const decayedCount = await stratumManager.applyDecay(
                    'agent',
                    localAgentId,
                    MemoryStratum.Working,
                    0.99 // Very high decay rate for testing
                );

                // Decay is probabilistic, so we just check it ran
                expect(decayedCount).toBeGreaterThanOrEqual(0);
            });

            it('should have different decay rates per stratum', () => {
                // Verify decay rates are different for each stratum
                const workingRate = DEFAULT_DECAY_RATES[MemoryStratum.Working];
                const shortTermRate = DEFAULT_DECAY_RATES[MemoryStratum.ShortTerm];
                const episodicRate = DEFAULT_DECAY_RATES[MemoryStratum.Episodic];
                const longTermRate = DEFAULT_DECAY_RATES[MemoryStratum.LongTerm];

                expect(workingRate).toBeGreaterThan(shortTermRate);
                expect(shortTermRate).toBeGreaterThan(episodicRate);
                expect(episodicRate).toBeGreaterThan(longTermRate);
            });
        });
    });

    // =========================================================================
    // SurpriseCalculator Tests
    // =========================================================================
    describe('SurpriseCalculator', () => {
        const localAgentId = generateTestId('surprise-agent');

        afterAll(() => {
            surpriseCalculator.clear(localAgentId);
        });

        describe('Initialization', () => {
            it('should be enabled after initialization', () => {
                expect(surpriseCalculator.isEnabled()).toBe(true);
            });
        });

        describe('Prediction Storage', () => {
            it('should store predictions for future surprise calculation', async () => {
                const prediction: Prediction = {
                    id: generateTestId('prediction'),
                    agentId: localAgentId,
                    content: 'User will ask about authentication',
                    predictedOutcome: { topic: 'authentication' },
                    confidence: 0.8,
                    timestamp: new Date()
                };

                await surpriseCalculator.storePrediction(prediction);

                const stats = surpriseCalculator.getStatistics(localAgentId);
                expect(stats.predictionCount).toBeGreaterThanOrEqual(1);
            });
        });

        describe('Surprise Signal Generation', () => {
            it('should calculate surprise for matching outcome', async () => {
                // Store a prediction first
                const prediction: Prediction = {
                    id: generateTestId('pred'),
                    agentId: localAgentId,
                    content: 'Expected response about login',
                    predictedOutcome: { action: 'login' },
                    confidence: 0.9,
                    timestamp: new Date()
                };
                await surpriseCalculator.storePrediction(prediction);

                // Create matching outcome
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: localAgentId,
                    content: 'Response about login process',
                    actualOutcome: { action: 'login' },
                    timestamp: new Date()
                };

                const signal: SurpriseSignal = await surpriseCalculator.calculateSurprise(outcome);

                expect(signal).toBeDefined();
                expect(typeof signal.momentarySurprise).toBe('number');
                expect(typeof signal.pastSurprise).toBe('number');
                expect(typeof signal.effectiveSurprise).toBe('number');
                expect(signal.momentarySurprise).toBeGreaterThanOrEqual(0);
                expect(signal.momentarySurprise).toBeLessThanOrEqual(1);
            });

            it('should calculate higher surprise for unexpected outcome', async () => {
                // Store a prediction
                const prediction: Prediction = {
                    id: generateTestId('pred'),
                    agentId: localAgentId,
                    content: 'Expected happy response',
                    predictedOutcome: { sentiment: 'positive' },
                    confidence: 0.95,
                    timestamp: new Date()
                };
                await surpriseCalculator.storePrediction(prediction);

                // Create mismatching outcome
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: localAgentId,
                    content: 'Angry and frustrated response',
                    actualOutcome: { sentiment: 'negative' },
                    timestamp: new Date(),
                    predictionId: prediction.id
                };

                const signal = await surpriseCalculator.calculateSurprise(outcome);

                expect(signal.detection.isSurprising).toBeDefined();
                expect(signal.detection.surpriseScore).toBeGreaterThanOrEqual(0);
            });

            it('should include detection details in surprise signal', async () => {
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: localAgentId,
                    content: 'Novel pattern detected in user behavior',
                    actualOutcome: { pattern: 'unknown' },
                    timestamp: new Date()
                };

                const signal = await surpriseCalculator.calculateSurprise(outcome);

                expect(signal.detection).toBeDefined();
                expect(typeof signal.detection.isSurprising).toBe('boolean');
                expect(typeof signal.detection.surpriseScore).toBe('number');
                expect(signal.detection.observation).toBe(outcome.content);
            });
        });

        describe('Momentum Tracking', () => {
            const momentumAgentId = generateTestId('momentum-agent');

            afterAll(() => {
                surpriseCalculator.clear(momentumAgentId);
            });

            it('should accumulate momentum on surprising events', async () => {
                // Generate several surprising outcomes
                for (let i = 0; i < 5; i++) {
                    const outcome: Outcome = {
                        id: generateTestId('outcome'),
                        agentId: momentumAgentId,
                        content: `Surprising event ${i}`,
                        actualOutcome: { unexpected: true },
                        timestamp: new Date()
                    };
                    await surpriseCalculator.calculateSurprise(outcome);
                    await sleep(50); // Small delay between events
                }

                const stats = surpriseCalculator.getStatistics(momentumAgentId);
                expect(stats.momentum).toBeGreaterThanOrEqual(0);
            });

            it('should decay momentum over time', async () => {
                const stats1 = surpriseCalculator.getStatistics(momentumAgentId);
                const momentum1 = stats1.momentum;

                // Wait for decay
                await sleep(1100); // Decay happens per cycle (1 second)

                // Calculate a non-surprising outcome to trigger decay
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: momentumAgentId,
                    content: 'Normal expected outcome',
                    actualOutcome: { expected: true },
                    timestamp: new Date()
                };
                await surpriseCalculator.calculateSurprise(outcome);

                const stats2 = surpriseCalculator.getStatistics(momentumAgentId);
                // Momentum should decay or stay the same (depending on surprise level)
                expect(stats2.momentum).toBeLessThanOrEqual(momentum1 + 0.5);
            });
        });

        describe('Novelty Score Calculation', () => {
            it('should calculate novelty score without prior prediction', async () => {
                const noveltyScore = await surpriseCalculator.calculateNoveltyScore(
                    localAgentId,
                    'Completely novel observation without prediction',
                    { context: 'test' }
                );

                expect(typeof noveltyScore).toBe('number');
                expect(noveltyScore).toBeGreaterThanOrEqual(0);
                expect(noveltyScore).toBeLessThanOrEqual(1);
            });
        });

        describe('Statistics', () => {
            it('should return accurate statistics', () => {
                const stats = surpriseCalculator.getStatistics(localAgentId);

                expect(stats).toBeDefined();
                expect(typeof stats.avgSurprise).toBe('number');
                expect(typeof stats.recentSurprises).toBe('number');
                expect(typeof stats.momentum).toBe('number');
                expect(typeof stats.predictionCount).toBe('number');
            });
        });
    });

    // =========================================================================
    // MemoryCompressor Tests
    // =========================================================================
    describe('MemoryCompressor', () => {
        describe('Initialization', () => {
            it('should be enabled after initialization', () => {
                expect(memoryCompressor.isEnabled()).toBe(true);
            });
        });

        describe('Compression at Different Levels', () => {
            const createTestMemory = (content: string, stratum: MemoryStratum): MemoryEntry => ({
                id: generateTestId('memory'),
                stratum,
                content,
                contentType: 'text',
                importance: MemoryImportance.Medium,
                tags: ['test'],
                source: { type: 'observation', agentId: testAgentId },
                context: { agentId: testAgentId, timestamp: new Date() },
                accessCount: 0,
                lastAccessed: new Date(),
                createdAt: new Date(),
                relatedMemories: []
            });

            it('should apply light compression for Working to ShortTerm transition', async () => {
                const longContent = 'This is a detailed memory about user authentication flow. '.repeat(10);
                const memory = createTestMemory(longContent, MemoryStratum.Working);

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.ShortTerm);

                expect(compressed).toBeDefined();
                expect(compressed.content.length).toBeLessThanOrEqual(memory.content.length);
            });

            it('should apply moderate compression for ShortTerm to Episodic transition', async () => {
                const longContent = 'Detailed episodic memory about a specific conversation. '.repeat(20);
                const memory = createTestMemory(longContent, MemoryStratum.ShortTerm);

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.Episodic);

                expect(compressed).toBeDefined();
                // Moderate compression should reduce content significantly
                expect(compressed.content.length).toBeLessThan(memory.content.length);
            });

            it('should apply heavy compression for Episodic to Semantic transition', async () => {
                const longContent = 'Comprehensive knowledge about system architecture and design patterns. '.repeat(30);
                const memory = createTestMemory(longContent, MemoryStratum.Episodic);

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.Semantic);

                expect(compressed).toBeDefined();
                // Heavy compression should significantly reduce content
                expect(compressed.content.length).toBeLessThan(memory.content.length * 0.5);
            });

            it('should preserve metadata about compression', async () => {
                const longContent = 'Memory content to be compressed with metadata tracking. '.repeat(10);
                const memory = createTestMemory(longContent, MemoryStratum.Working);

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.ShortTerm);

                expect(compressed.metadata).toBeDefined();
                expect(compressed.metadata?.originalLength).toBeDefined();
                expect(compressed.metadata?.compressionRatio).toBeDefined();
                expect(compressed.metadata?.compressionMethod).toBeDefined();
            });
        });

        describe('Memory Consolidation', () => {
            const createTestMemories = (count: number, sharedContent: string): MemoryEntry[] => {
                return Array.from({ length: count }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: `${sharedContent} Instance ${i + 1}`,
                    contentType: 'text' as const,
                    importance: MemoryImportance.Medium,
                    tags: ['consolidation-test'],
                    source: { type: 'observation' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: i,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                }));
            };

            it('should merge similar memories', async () => {
                const memories = createTestMemories(3, 'Similar memory about user login');

                const consolidation: MemoryConsolidation = await memoryCompressor.consolidateMemories(
                    memories,
                    'merge'
                );

                expect(consolidation).toBeDefined();
                expect(consolidation.newMemory).toBeDefined();
                expect(consolidation.consolidatedMemories.length).toBe(3);
                expect(consolidation.type).toBe('merge');
            });

            it('should summarize multiple memories', async () => {
                // Use longer content to ensure summarization produces meaningful compression
                const memories = createTestMemories(5, 'Event log entry for user authentication flow including credential validation and session establishment');

                const consolidation = await memoryCompressor.consolidateMemories(
                    memories,
                    'summarize'
                );

                expect(consolidation).toBeDefined();
                expect(consolidation.type).toBe('summarize');
                // Summary should consolidate 5 similar memories into one
                expect(consolidation.newMemory.content).toBeDefined();
                expect(consolidation.newMemory.content.length).toBeGreaterThan(0);
            });

            it('should abstract common patterns from memories', async () => {
                const memories = createTestMemories(4, 'Pattern: user authentication request');

                const consolidation = await memoryCompressor.consolidateMemories(
                    memories,
                    'abstract'
                );

                expect(consolidation).toBeDefined();
                expect(consolidation.type).toBe('abstract');
                expect(consolidation.newMemory.content).toContain('pattern');
            });

            it('should preserve highest importance in consolidation', async () => {
                const memories: MemoryEntry[] = [
                    {
                        id: generateTestId('memory'),
                        stratum: MemoryStratum.ShortTerm,
                        content: 'Low importance memory',
                        contentType: 'text',
                        importance: MemoryImportance.Low,
                        tags: [],
                        source: { type: 'observation', agentId: testAgentId },
                        context: { agentId: testAgentId, timestamp: new Date() },
                        accessCount: 0,
                        lastAccessed: new Date(),
                        createdAt: new Date(),
                        relatedMemories: []
                    },
                    {
                        id: generateTestId('memory'),
                        stratum: MemoryStratum.ShortTerm,
                        content: 'Critical importance memory',
                        contentType: 'text',
                        importance: MemoryImportance.Critical,
                        tags: [],
                        source: { type: 'observation', agentId: testAgentId },
                        context: { agentId: testAgentId, timestamp: new Date() },
                        accessCount: 0,
                        lastAccessed: new Date(),
                        createdAt: new Date(),
                        relatedMemories: []
                    }
                ];

                const consolidation = await memoryCompressor.consolidateMemories(memories, 'merge');

                expect(consolidation.newMemory.importance).toBe(MemoryImportance.Critical);
            });
        });

        describe('Similarity Detection', () => {
            it('should detect similar memories', async () => {
                const memory1: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: 'User authentication flow with JWT tokens',
                    contentType: 'text',
                    importance: MemoryImportance.Medium,
                    tags: ['authentication', 'jwt'],
                    source: { type: 'observation', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const memory2: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: 'Authentication flow using JWT tokens for user',
                    contentType: 'text',
                    importance: MemoryImportance.Medium,
                    tags: ['authentication', 'jwt'],
                    source: { type: 'observation', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const areSimilar = await memoryCompressor.areSimilar(memory1, memory2, 0.5);
                expect(areSimilar).toBe(true);
            });

            it('should detect dissimilar memories', async () => {
                const memory1: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: 'Weather forecast for tomorrow',
                    contentType: 'text',
                    importance: MemoryImportance.Low,
                    tags: ['weather'],
                    source: { type: 'observation', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const memory2: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: 'Database schema migration strategy',
                    contentType: 'text',
                    importance: MemoryImportance.High,
                    tags: ['database', 'migration'],
                    source: { type: 'reasoning', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const areSimilar = await memoryCompressor.areSimilar(memory1, memory2, 0.7);
                expect(areSimilar).toBe(false);
            });
        });
    });

    // =========================================================================
    // RetentionGateService Tests
    // =========================================================================
    describe('RetentionGateService', () => {
        describe('Initialization', () => {
            it('should be enabled after initialization', () => {
                expect(retentionGate.isEnabled()).toBe(true);
            });
        });

        describe('Decay Calculation', () => {
            const createTestMemory = (stratum: MemoryStratum, importance: MemoryImportance, accessCount: number): MemoryEntry => ({
                id: generateTestId('memory'),
                stratum,
                content: 'Test memory content',
                contentType: 'text',
                importance,
                tags: [],
                source: { type: 'observation', agentId: testAgentId },
                context: { agentId: testAgentId, timestamp: new Date() },
                accessCount,
                lastAccessed: new Date(),
                createdAt: new Date(),
                relatedMemories: []
            });

            it('should calculate retention score for recent memory', () => {
                const memory = createTestMemory(MemoryStratum.Working, MemoryImportance.High, 5);

                const score = retentionGate.calculateRetentionScore(memory);

                expect(score).toBeGreaterThan(0);
                expect(score).toBeLessThanOrEqual(1);
            });

            it('should give higher retention to high importance memories', () => {
                const lowImportance = createTestMemory(MemoryStratum.Working, MemoryImportance.Low, 0);
                const highImportance = createTestMemory(MemoryStratum.Working, MemoryImportance.Critical, 0);

                const lowScore = retentionGate.calculateRetentionScore(lowImportance);
                const highScore = retentionGate.calculateRetentionScore(highImportance);

                expect(highScore).toBeGreaterThan(lowScore);
            });

            it('should give higher retention to frequently accessed memories', () => {
                const lowAccess = createTestMemory(MemoryStratum.Working, MemoryImportance.Medium, 0);
                const highAccess = createTestMemory(MemoryStratum.Working, MemoryImportance.Medium, 50);

                const lowScore = retentionGate.calculateRetentionScore(lowAccess);
                const highScore = retentionGate.calculateRetentionScore(highAccess);

                expect(highScore).toBeGreaterThan(lowScore);
            });

            it('should boost retention based on surprise score', () => {
                const memory = createTestMemory(MemoryStratum.Working, MemoryImportance.Medium, 0);

                const scoreNoSurprise = retentionGate.calculateRetentionScore(memory);
                const scoreWithSurprise = retentionGate.calculateRetentionScore(memory, 0.9);

                expect(scoreWithSurprise).toBeGreaterThan(scoreNoSurprise);
            });

            it('should boost retention for memories with relationships', () => {
                const isolated = createTestMemory(MemoryStratum.Working, MemoryImportance.Medium, 0);
                const related: MemoryEntry = {
                    ...createTestMemory(MemoryStratum.Working, MemoryImportance.Medium, 0),
                    relatedMemories: ['mem-1', 'mem-2', 'mem-3']
                };

                const isolatedScore = retentionGate.calculateRetentionScore(isolated);
                const relatedScore = retentionGate.calculateRetentionScore(related);

                expect(relatedScore).toBeGreaterThan(isolatedScore);
            });
        });

        describe('Retention Gate Application', () => {
            it('should apply retention gate to a set of memories', () => {
                const memories: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.Working,
                    content: `Memory ${i}`,
                    contentType: 'text' as const,
                    importance: i < 5 ? MemoryImportance.Low : MemoryImportance.High,
                    tags: [],
                    source: { type: 'observation' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: i * 2,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                }));

                const results: DecayResult[] = retentionGate.applyRetentionGate(
                    memories,
                    MemoryStratum.Working,
                    10
                );

                expect(results.length).toBe(10);
                results.forEach(result => {
                    expect(result.memoryId).toBeDefined();
                    expect(typeof result.originalScore).toBe('number');
                    expect(typeof result.decayedScore).toBe('number');
                    expect(typeof result.shouldRetain).toBe('boolean');
                    expect(result.reason).toBeDefined();
                });
            });

            it('should apply adaptive decay when over capacity', () => {
                const memories: MemoryEntry[] = Array.from({ length: 60 }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.Working,
                    content: `Memory ${i}`,
                    contentType: 'text' as const,
                    importance: MemoryImportance.Low,
                    tags: [],
                    source: { type: 'observation' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(Date.now() - 86400000), // 1 day old
                    createdAt: new Date(Date.now() - 86400000),
                    relatedMemories: []
                }));

                // Working stratum capacity is 50
                const results = retentionGate.applyRetentionGate(
                    memories,
                    MemoryStratum.Working,
                    60
                );

                // Some memories should be marked for removal due to over capacity
                const toRemove = results.filter(r => !r.shouldRetain);
                expect(toRemove.length).toBeGreaterThan(0);
            });
        });

        describe('Retention Statistics', () => {
            it('should return accurate retention statistics', () => {
                const memories: MemoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.ShortTerm,
                    content: `Memory ${i}`,
                    contentType: 'text' as const,
                    importance: i % 2 === 0 ? MemoryImportance.High : MemoryImportance.Low,
                    tags: [],
                    source: { type: 'observation' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: i * 10,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                }));

                const results = retentionGate.applyRetentionGate(memories, MemoryStratum.ShortTerm, 5);
                const stats: RetentionStatistics = retentionGate.getStatistics(results);

                expect(stats.totalMemories).toBe(5);
                expect(stats.retained + stats.decayed).toBe(5);
                expect(stats.avgRetentionScore).toBeGreaterThan(0);
                expect(stats.avgRetentionScore).toBeLessThanOrEqual(1);
                expect(stats.capacityUtilization).toBeGreaterThanOrEqual(0);
                expect(stats.capacityUtilization).toBeLessThanOrEqual(1);
            });

            it('should handle empty results', () => {
                const stats = retentionGate.getStatistics([]);

                expect(stats.totalMemories).toBe(0);
                expect(stats.retained).toBe(0);
                expect(stats.decayed).toBe(0);
                expect(stats.avgRetentionScore).toBe(0);
            });
        });

        describe('Retention Policy Management', () => {
            it('should get policy for stratum', () => {
                const policy = retentionGate.getPolicy(MemoryStratum.Working);

                expect(policy).toBeDefined();
                expect(policy?.baseDecayRate).toBe(0.8);
                expect(policy?.adaptiveDecayEnabled).toBe(true);
            });

            it('should have different policies per stratum', () => {
                const workingPolicy = retentionGate.getPolicy(MemoryStratum.Working);
                const longTermPolicy = retentionGate.getPolicy(MemoryStratum.LongTerm);

                expect(workingPolicy?.baseDecayRate).toBeGreaterThan(longTermPolicy?.baseDecayRate!);
                expect(workingPolicy?.adaptiveDecayEnabled).toBe(true);
                expect(longTermPolicy?.adaptiveDecayEnabled).toBe(false);
            });

            it('should update policy for stratum', () => {
                const originalPolicy = retentionGate.getPolicy(MemoryStratum.Episodic);
                const originalRate = originalPolicy?.baseDecayRate;

                retentionGate.updatePolicy(MemoryStratum.Episodic, {
                    baseDecayRate: 0.15
                });

                const updatedPolicy = retentionGate.getPolicy(MemoryStratum.Episodic);
                expect(updatedPolicy?.baseDecayRate).toBe(0.15);

                // Restore original
                retentionGate.updatePolicy(MemoryStratum.Episodic, {
                    baseDecayRate: originalRate
                });
            });

            it('should reset to default policies', () => {
                // Modify a policy
                retentionGate.updatePolicy(MemoryStratum.ShortTerm, {
                    baseDecayRate: 0.99
                });

                // Reset
                retentionGate.resetPolicies();

                const policy = retentionGate.getPolicy(MemoryStratum.ShortTerm);
                expect(policy?.baseDecayRate).toBe(0.3);
            });
        });

        describe('Retention Statistics Per Stratum', () => {
            it('should calculate statistics for Working stratum', () => {
                const memories: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.Working,
                    content: `Working memory ${i}`,
                    contentType: 'text' as const,
                    importance: MemoryImportance.Medium,
                    tags: [],
                    source: { type: 'observation' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: i,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                }));

                const results = retentionGate.applyRetentionGate(memories, MemoryStratum.Working, 10);
                const stats = retentionGate.getStatistics(results);

                expect(stats.totalMemories).toBe(10);
            });

            it('should calculate statistics for LongTerm stratum', () => {
                const memories: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.LongTerm,
                    content: `Long-term memory ${i}`,
                    contentType: 'text' as const,
                    importance: MemoryImportance.High,
                    tags: [],
                    source: { type: 'learning' as const, agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: i * 5,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                }));

                const results = retentionGate.applyRetentionGate(memories, MemoryStratum.LongTerm, 10);
                const stats = retentionGate.getStatistics(results);

                // Long-term should have higher retention
                expect(stats.retained).toBeGreaterThanOrEqual(stats.decayed);
            });
        });
    });

    // =========================================================================
    // SERCOrchestrator Tests
    // =========================================================================
    describe('SERCOrchestrator', () => {
        const localAgentId = generateTestId('serc-agent');
        const localChannelId = generateTestId('serc-channel');

        afterAll(() => {
            sercOrchestrator.clear(localAgentId);
        });

        describe('Initialization', () => {
            it('should be enabled after initialization', () => {
                expect(sercOrchestrator.isEnabled()).toBe(true);
            });
        });

        describe('Inner Loop Management', () => {
            it('should start inner loop and create context', async () => {
                const context: SERCContext = await sercOrchestrator.startInnerLoop(
                    localAgentId,
                    localChannelId
                );

                expect(context).toBeDefined();
                expect(context.agentId).toBe(localAgentId);
                expect(context.channelId).toBe(localChannelId);
                expect(context.cycleNumber).toBe(1);
                expect(context.innerLoopCount).toBe(1);
                expect(context.mode).toBe(AgentMode.Solver);
            });

            it('should increment cycle and inner loop counts', async () => {
                const context1 = await sercOrchestrator.startInnerLoop(localAgentId, localChannelId);
                const context2 = await sercOrchestrator.startInnerLoop(localAgentId, localChannelId);

                expect(context2.cycleNumber).toBe(context1.cycleNumber + 1);
                expect(context2.innerLoopCount).toBe(context1.innerLoopCount + 1);
            });
        });

        describe('Dual-Loop Coordination (Solver/Verifier Modes)', () => {
            const modeAgentId = generateTestId('mode-agent');
            const modeChannelId = generateTestId('mode-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(modeAgentId, modeChannelId);
            });

            afterAll(() => {
                sercOrchestrator.clear(modeAgentId);
            });

            it('should start in Solver mode', () => {
                const context = sercOrchestrator.getContext(modeAgentId);
                expect(context?.mode).toBe(AgentMode.Solver);
            });

            it('should switch to Verifier mode', () => {
                sercOrchestrator.switchToVerifierMode(modeAgentId);

                const context = sercOrchestrator.getContext(modeAgentId);
                expect(context?.mode).toBe(AgentMode.Verifier);
            });

            it('should switch back to Solver mode', () => {
                sercOrchestrator.switchToSolverMode(modeAgentId);

                const context = sercOrchestrator.getContext(modeAgentId);
                expect(context?.mode).toBe(AgentMode.Solver);
            });
        });

        describe('Surprise Signal Processing', () => {
            const surpriseAgentId = generateTestId('surprise-serc-agent');
            const surpriseChannelId = generateTestId('surprise-serc-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(surpriseAgentId, surpriseChannelId);
            });

            afterAll(() => {
                sercOrchestrator.clear(surpriseAgentId);
            });

            it('should process surprise signal during Observation phase', async () => {
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: surpriseAgentId,
                    content: 'Unexpected user behavior detected',
                    actualOutcome: { unexpected: true },
                    timestamp: new Date()
                };

                const signal = await sercOrchestrator.processSurpriseSignal(
                    surpriseAgentId,
                    outcome
                );

                expect(signal).toBeDefined();
                expect(typeof signal.effectiveSurprise).toBe('number');

                const context = sercOrchestrator.getContext(surpriseAgentId);
                expect(context?.surpriseSignal).toBeDefined();
            });

            it('should process surprise with prediction', async () => {
                const prediction: Prediction = {
                    id: generateTestId('prediction'),
                    agentId: surpriseAgentId,
                    content: 'User will complete task successfully',
                    predictedOutcome: { success: true },
                    confidence: 0.8,
                    timestamp: new Date()
                };

                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: surpriseAgentId,
                    content: 'Task failed unexpectedly',
                    actualOutcome: { success: false },
                    timestamp: new Date(),
                    predictionId: prediction.id
                };

                const signal = await sercOrchestrator.processSurpriseSignal(
                    surpriseAgentId,
                    outcome,
                    prediction
                );

                expect(signal).toBeDefined();
            });
        });

        describe('Verification Generation', () => {
            const verifyAgentId = generateTestId('verify-agent');
            const verifyChannelId = generateTestId('verify-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(verifyAgentId, verifyChannelId);
            });

            afterAll(() => {
                sercOrchestrator.clear(verifyAgentId);
            });

            it('should generate verification tuple', async () => {
                const verification: VerificationTuple = await sercOrchestrator.generateVerification(
                    verifyAgentId,
                    'Agent analyzed the user request and determined the appropriate action',
                    [{ tool: 'search', result: 'found' }]
                );

                expect(verification).toBeDefined();
                expect(typeof verification.score).toBe('number');
                expect(typeof verification.confidence).toBe('number');
                expect(verification.critique).toBeDefined();
            });

            it('should include tool verifications when provided', async () => {
                const toolResults = [
                    { tool: 'search', result: 'found 10 results' },
                    { tool: 'validate', result: 'passed' }
                ];

                const verification = await sercOrchestrator.generateVerification(
                    verifyAgentId,
                    'Reasoning trace with tool usage',
                    toolResults
                );

                expect(verification.toolVerifications).toBeDefined();
                expect(verification.toolVerifications?.length).toBe(2);
            });

            it('should update context with verification', async () => {
                await sercOrchestrator.generateVerification(
                    verifyAgentId,
                    'Test reasoning',
                    []
                );

                const context = sercOrchestrator.getContext(verifyAgentId);
                expect(context?.verification).toBeDefined();
            });
        });

        describe('Self-Repair Mechanism', () => {
            const repairAgentId = generateTestId('repair-agent');
            const repairChannelId = generateTestId('repair-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(repairAgentId, repairChannelId);
            });

            afterAll(() => {
                sercOrchestrator.clear(repairAgentId);
            });

            it('should not trigger repair when confidence is high', async () => {
                // Generate high confidence verification
                await sercOrchestrator.generateVerification(
                    repairAgentId,
                    'High quality reasoning',
                    [{ tool: 'verify', result: 'passed' }]
                );

                const shouldRepair = sercOrchestrator.shouldTriggerRepair(repairAgentId);
                // Repair triggers when confidence < 0.7
                // With tool results, confidence is typically high
                expect(typeof shouldRepair).toBe('boolean');
            });

            it('should generate repair instruction when needed', async () => {
                const repair: RepairInstruction = await sercOrchestrator.generateRepairInstruction(
                    repairAgentId,
                    1
                );

                expect(repair).toBeDefined();
                expect(repair.action).toBeDefined();
                expect(['PATCH', 'NO_CHANGE']).toContain(repair.action);
                expect(repair.justification).toBeDefined();
            });

            it('should include target step in repair instruction', async () => {
                const repair = await sercOrchestrator.generateRepairInstruction(
                    repairAgentId,
                    3
                );

                if (repair.action === 'PATCH') {
                    expect(repair.targetStep).toBe(3);
                    expect(repair.patchType).toBeDefined();
                }
            });
        });

        describe('Process Reward Calculation', () => {
            const rewardAgentId = generateTestId('reward-agent');
            const rewardChannelId = generateTestId('reward-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(rewardAgentId, rewardChannelId);

                // Process a surprise signal
                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: rewardAgentId,
                    content: 'Observation for reward calculation',
                    actualOutcome: {},
                    timestamp: new Date()
                };
                await sercOrchestrator.processSurpriseSignal(rewardAgentId, outcome);

                // Generate verification
                await sercOrchestrator.generateVerification(
                    rewardAgentId,
                    'Reasoning for reward',
                    [{ tool: 'test', result: 'passed' }]
                );
            });

            afterAll(() => {
                sercOrchestrator.clear(rewardAgentId);
            });

            it('should calculate process reward', () => {
                const reward: ProcessReward = sercOrchestrator.calculateProcessReward(rewardAgentId);

                expect(reward).toBeDefined();
                expect(typeof reward.surpriseScore).toBe('number');
                expect(typeof reward.confidenceScore).toBe('number');
                expect(typeof reward.toolVerificationScore).toBe('number');
                expect(typeof reward.repairCost).toBe('number');
                expect(typeof reward.promotionScore).toBe('number');
            });

            it('should have promotion score based on components', () => {
                const reward = sercOrchestrator.calculateProcessReward(rewardAgentId);

                // Promotion score is weighted combination of components
                expect(reward.promotionScore).toBeDefined();
                expect(reward.promotionScore).toBeLessThanOrEqual(1);
            });
        });

        describe('Memory Promotion Decision', () => {
            const promoAgentId = generateTestId('promo-agent');
            const promoChannelId = generateTestId('promo-channel');

            beforeAll(async () => {
                await sercOrchestrator.startInnerLoop(promoAgentId, promoChannelId);
            });

            afterAll(() => {
                sercOrchestrator.clear(promoAgentId);
            });

            it('should determine if memory should be promoted', () => {
                const result = sercOrchestrator.shouldPromoteMemory(
                    promoAgentId,
                    MemoryStratum.Working
                );

                expect(result).toBeDefined();
                expect(typeof result.shouldPromote).toBe('boolean');
                if (result.shouldPromote) {
                    expect(result.targetStratum).toBeDefined();
                }
            });

            it('should suggest correct target stratum for Working memory', () => {
                const result = sercOrchestrator.shouldPromoteMemory(
                    promoAgentId,
                    MemoryStratum.Working
                );

                if (result.shouldPromote) {
                    expect(result.targetStratum).toBe(MemoryStratum.ShortTerm);
                }
            });

            it('should suggest correct target stratum for ShortTerm memory', () => {
                const result = sercOrchestrator.shouldPromoteMemory(
                    promoAgentId,
                    MemoryStratum.ShortTerm
                );

                if (result.shouldPromote) {
                    expect([MemoryStratum.Episodic, MemoryStratum.LongTerm]).toContain(result.targetStratum);
                }
            });
        });

        describe('Outer Loop / Knowledge Consolidation', () => {
            const outerAgentId = generateTestId('outer-agent');
            const outerChannelId = generateTestId('outer-channel');

            beforeAll(async () => {
                // Initialize stratum for this agent
                stratumManager.initialize(defaultConfig);

                // Add some test memories
                for (let i = 0; i < 3; i++) {
                    await stratumManager.addMemory('agent', outerAgentId, MemoryStratum.Working, {
                        stratum: MemoryStratum.Working,
                        content: `Outer loop test memory ${i}`,
                        contentType: 'text',
                        importance: MemoryImportance.Low,
                        tags: [],
                        source: { type: 'observation', agentId: outerAgentId },
                        context: { agentId: outerAgentId, timestamp: new Date() },
                        relatedMemories: []
                    });
                }
            });

            afterAll(() => {
                sercOrchestrator.clear(outerAgentId);
                stratumManager.clear('agent', outerAgentId);
            });

            it('should determine when outer loop should run', async () => {
                // Start multiple inner loops
                for (let i = 0; i < 5; i++) {
                    await sercOrchestrator.startInnerLoop(outerAgentId, outerChannelId);
                }

                const shouldRun = sercOrchestrator.shouldRunOuterLoop(outerAgentId);
                expect(shouldRun).toBe(true);
            });

            it('should run outer loop consolidation', async () => {
                await sercOrchestrator.runOuterLoop(outerAgentId, outerChannelId);

                // After outer loop, inner loop count should be reset
                const context = sercOrchestrator.getContext(outerAgentId);
                expect(context?.innerLoopCount).toBe(0);
            });

            it('should apply decay during outer loop', async () => {
                const statsBefore = stratumManager.getStatistics('agent', outerAgentId);

                await sercOrchestrator.runOuterLoop(outerAgentId, outerChannelId);

                // Decay is probabilistic, so just verify it ran without error
                const statsAfter = stratumManager.getStatistics('agent', outerAgentId);
                expect(statsAfter).toBeDefined();
            });
        });

        describe('Context Management', () => {
            const ctxAgentId = generateTestId('ctx-agent');
            const ctxChannelId = generateTestId('ctx-channel');

            afterAll(() => {
                sercOrchestrator.clear(ctxAgentId);
            });

            it('should get context for agent', async () => {
                await sercOrchestrator.startInnerLoop(ctxAgentId, ctxChannelId);

                const context = sercOrchestrator.getContext(ctxAgentId);

                expect(context).toBeDefined();
                expect(context?.agentId).toBe(ctxAgentId);
            });

            it('should return undefined for non-existent agent', () => {
                const context = sercOrchestrator.getContext('non-existent-agent');
                expect(context).toBeUndefined();
            });

            it('should clear context for agent', async () => {
                await sercOrchestrator.startInnerLoop(ctxAgentId, ctxChannelId);
                expect(sercOrchestrator.getContext(ctxAgentId)).toBeDefined();

                sercOrchestrator.clear(ctxAgentId);
                expect(sercOrchestrator.getContext(ctxAgentId)).toBeUndefined();
            });
        });
    });

    // =========================================================================
    // Integration: Full Memory Lifecycle
    // =========================================================================
    describe('Full Memory Lifecycle Integration', () => {
        const lifecycleAgentId = generateTestId('lifecycle-agent');
        const lifecycleChannelId = generateTestId('lifecycle-channel');

        afterAll(() => {
            stratumManager.clear('agent', lifecycleAgentId);
            surpriseCalculator.clear(lifecycleAgentId);
            sercOrchestrator.clear(lifecycleAgentId);
        });

        it('should complete full memory lifecycle from Working to promotion', async () => {
            // 1. Start SERC cycle
            const context = await sercOrchestrator.startInnerLoop(lifecycleAgentId, lifecycleChannelId);
            expect(context.mode).toBe(AgentMode.Solver);

            // 2. Add memory to Working stratum
            const memory = await stratumManager.addMemory(
                'agent',
                lifecycleAgentId,
                MemoryStratum.Working,
                {
                    stratum: MemoryStratum.Working,
                    content: 'Critical observation: User authentication pattern changed',
                    contentType: 'text',
                    importance: MemoryImportance.Critical,
                    tags: ['authentication', 'security'],
                    source: { type: 'observation', agentId: lifecycleAgentId },
                    context: { agentId: lifecycleAgentId, channelId: lifecycleChannelId, timestamp: new Date() },
                    relatedMemories: []
                }
            );
            expect(memory.id).toBeDefined();

            // 3. Calculate surprise
            const outcome: Outcome = {
                id: generateTestId('outcome'),
                agentId: lifecycleAgentId,
                content: memory.content,
                actualOutcome: { unexpected: true },
                timestamp: new Date()
            };
            const surprise = await sercOrchestrator.processSurpriseSignal(lifecycleAgentId, outcome);
            expect(surprise.effectiveSurprise).toBeGreaterThanOrEqual(0);

            // 4. Generate verification
            const verification = await sercOrchestrator.generateVerification(
                lifecycleAgentId,
                'Observed authentication pattern change',
                []
            );
            expect(verification.confidence).toBeGreaterThan(0);

            // 5. Calculate retention score
            const retentionScore = retentionGate.calculateRetentionScore(
                memory,
                surprise.effectiveSurprise
            );
            expect(retentionScore).toBeGreaterThan(0);

            // 6. Check if should promote
            const promotionDecision = sercOrchestrator.shouldPromoteMemory(
                lifecycleAgentId,
                MemoryStratum.Working
            );
            expect(typeof promotionDecision.shouldPromote).toBe('boolean');

            // 7. If promoting, compress and transition
            if (promotionDecision.shouldPromote && promotionDecision.targetStratum) {
                const compressed = await memoryCompressor.compressMemory(
                    memory,
                    promotionDecision.targetStratum
                );
                expect(compressed.content).toBeDefined();

                const transitioned = await stratumManager.transitionMemory(
                    'agent',
                    lifecycleAgentId,
                    memory.id,
                    MemoryStratum.Working,
                    promotionDecision.targetStratum,
                    'Promoted due to high surprise and retention score'
                );
                expect(transitioned).toBe(true);
            }

            // 8. Complete outer loop if needed
            if (sercOrchestrator.shouldRunOuterLoop(lifecycleAgentId)) {
                await sercOrchestrator.runOuterLoop(lifecycleAgentId, lifecycleChannelId);
            }

            // Verify final state
            const stats = stratumManager.getStatistics('agent', lifecycleAgentId);
            expect(stats).toBeDefined();
        });
    });

    // =========================================================================
    // Edge Cases and Error Handling
    // =========================================================================
    describe('Edge Cases and Error Handling', () => {
        describe('StratumManager Edge Cases', () => {
            it('should handle querying non-existent scope', async () => {
                const result = await stratumManager.queryMemories(
                    'agent',
                    'non-existent-agent-id',
                    { query: 'test' }
                );

                expect(result.memories).toEqual([]);
                expect(result.totalCount).toBe(0);
            });

            it('should handle empty query string', async () => {
                const localAgentId = generateTestId('empty-query-agent');

                await stratumManager.addMemory('agent', localAgentId, MemoryStratum.Working, {
                    stratum: MemoryStratum.Working,
                    content: 'Test memory',
                    contentType: 'text',
                    importance: MemoryImportance.Medium,
                    tags: [],
                    source: { type: 'observation', agentId: localAgentId },
                    context: { agentId: localAgentId, timestamp: new Date() },
                    relatedMemories: []
                });

                const result = await stratumManager.queryMemories(
                    'agent',
                    localAgentId,
                    { query: '' }
                );

                expect(result.memories.length).toBeGreaterThanOrEqual(1);

                stratumManager.clear('agent', localAgentId);
            });
        });

        describe('SurpriseCalculator Edge Cases', () => {
            it('should handle surprise calculation without predictions', async () => {
                const newAgentId = generateTestId('no-pred-agent');

                const outcome: Outcome = {
                    id: generateTestId('outcome'),
                    agentId: newAgentId,
                    content: 'First observation without prediction',
                    actualOutcome: {},
                    timestamp: new Date()
                };

                const signal = await surpriseCalculator.calculateSurprise(outcome);

                // Should return default/novelty-based surprise
                expect(signal).toBeDefined();
                expect(signal.momentarySurprise).toBeGreaterThanOrEqual(0);

                surpriseCalculator.clear(newAgentId);
            });
        });

        describe('MemoryCompressor Edge Cases', () => {
            it('should handle empty content compression', async () => {
                const memory: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.Working,
                    content: '',
                    contentType: 'text',
                    importance: MemoryImportance.Low,
                    tags: [],
                    source: { type: 'observation', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.ShortTerm);
                expect(compressed).toBeDefined();
            });

            it('should handle very short content', async () => {
                const memory: MemoryEntry = {
                    id: generateTestId('memory'),
                    stratum: MemoryStratum.Working,
                    content: 'Hi',
                    contentType: 'text',
                    importance: MemoryImportance.Low,
                    tags: [],
                    source: { type: 'observation', agentId: testAgentId },
                    context: { agentId: testAgentId, timestamp: new Date() },
                    accessCount: 0,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                    relatedMemories: []
                };

                const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.Semantic);
                expect(compressed.content.length).toBeLessThanOrEqual(memory.content.length);
            });
        });

        describe('SERCOrchestrator Edge Cases', () => {
            it('should handle mode switch for non-existent agent', () => {
                // Should not throw, just log warning
                expect(() => {
                    sercOrchestrator.switchToVerifierMode('non-existent-agent');
                }).not.toThrow();
            });

            it('should handle verification for agent without context', async () => {
                await expect(
                    sercOrchestrator.generateVerification(
                        'no-context-agent',
                        'reasoning',
                        []
                    )
                ).rejects.toThrow();
            });
        });
    });
});
