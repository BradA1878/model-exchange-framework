/**
 * Unit tests for Nested Learning / Continuum Memory System components
 * Tests StratumManager, SurpriseCalculator, MemoryCompressor, RetentionGateService, and SERCOrchestrator
 */

import { StratumManager } from '@mxf/shared/services/StratumManager';
import { SurpriseCalculator, Prediction, Outcome } from '@mxf/shared/services/SurpriseCalculator';
import { MemoryCompressor, CompressionLevel } from '@mxf/shared/services/MemoryCompressor';
import { RetentionGateService } from '@mxf/shared/services/RetentionGateService';
import { SERCOrchestrator, AgentMode } from '@mxf/shared/services/SERCOrchestrator';
import {
  MemoryStratum,
  MemoryImportance,
  MemoryEntry,
  MemoryStrataConfig
} from '@mxf/shared/types/MemoryStrataTypes';

describe('Nested Learning Components', () => {
  const testAgentId = 'test-agent-123';
  const testChannelId = 'test-channel-456';

  describe('StratumManager', () => {
    let stratumManager: StratumManager;

    beforeEach(() => {
      stratumManager = StratumManager.getInstance();
      const config: MemoryStrataConfig = {
        enabled: true,
        working: { maxEntries: 50, ttl: 3600000 },
        shortTerm: { maxEntries: 200, ttl: 86400000, consolidationThreshold: 0.7 },
        longTerm: { maxEntriesPerAgent: 2000, minImportance: MemoryImportance.Medium, enableArchival: true, archivalAge: 2592000000 },
        episodic: { maxEpisodesPerAgent: 500, episodeDuration: 3600000 },
        semantic: { maxConceptsPerAgent: 1000, minConfidence: 0.8 },
        surprise: { enabled: true, threshold: 0.5, analysisWindow: 50 },
        consolidation: { enabled: true, interval: 60000, similarityThreshold: 0.7 },
        patterns: { enabled: true, minLength: 2, minConfidence: 0.7, analysisInterval: 300000 }
      };
      stratumManager.initialize(config);
    });

    afterEach(() => {
      stratumManager.clear('agent', testAgentId);
      stratumManager.clear('channel', testChannelId);
    });

    it('should initialize and enable stratum system', () => {
      expect(stratumManager.isEnabled()).toBe(true);
    });

    it('should add memory to Working stratum', async () => {
      const memory = await stratumManager.addMemory('agent', testAgentId, MemoryStratum.Working, {
        stratum: MemoryStratum.Working,
        content: 'Test observation',
        contentType: 'text',
        importance: MemoryImportance.Medium,
        tags: ['test'],
        source: {
          type: 'observation',
          agentId: testAgentId
        },
        context: {
          agentId: testAgentId,
          timestamp: new Date(),
          orparPhase: 'observe'
        },
        relatedMemories: []
      });

      expect(memory.id).toBeDefined();
      expect(memory.stratum).toBe(MemoryStratum.Working);
      expect(memory.content).toBe('Test observation');
    });

    it('should query memories from multiple strata', async () => {
      await stratumManager.addMemory('agent', testAgentId, MemoryStratum.Working, {
        stratum: MemoryStratum.Working,
        content: 'Working memory',
        contentType: 'text',
        importance: MemoryImportance.High,
        tags: ['working'],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        relatedMemories: []
      });

      await stratumManager.addMemory('agent', testAgentId, MemoryStratum.ShortTerm, {
        stratum: MemoryStratum.ShortTerm,
        content: 'Short-term memory',
        contentType: 'text',
        importance: MemoryImportance.Medium,
        tags: ['shortterm'],
        source: { type: 'reasoning', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        relatedMemories: []
      });

      const result = await stratumManager.queryMemories('agent', testAgentId, {
        query: 'memory',
        strata: [MemoryStratum.Working, MemoryStratum.ShortTerm]
      });

      expect(result.memories.length).toBe(2);
      expect(result.totalCount).toBe(2);
    });

    it('should transition memory between strata', async () => {
      const memory = await stratumManager.addMemory('agent', testAgentId, MemoryStratum.Working, {
        stratum: MemoryStratum.Working,
        content: 'Important memory to promote',
        contentType: 'text',
        importance: MemoryImportance.High,
        tags: ['important'],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        relatedMemories: []
      });

      const transitioned = await stratumManager.transitionMemory(
        'agent',
        testAgentId,
        memory.id,
        MemoryStratum.Working,
        MemoryStratum.ShortTerm,
        'High importance'
      );

      expect(transitioned).toBe(true);

      const result = await stratumManager.queryMemories('agent', testAgentId, {
        query: 'memory',
        strata: [MemoryStratum.ShortTerm]
      });

      expect(result.memories.length).toBe(1);
      expect(result.memories[0].stratum).toBe(MemoryStratum.ShortTerm);
    });

    it('should apply decay to stratum memories', async () => {
      await stratumManager.addMemory('agent', testAgentId, MemoryStratum.Working, {
        stratum: MemoryStratum.Working,
        content: 'Memory to decay',
        contentType: 'text',
        importance: MemoryImportance.Low,
        tags: ['decay-test'],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        relatedMemories: []
      });

      const decayed = await stratumManager.applyDecay('agent', testAgentId, MemoryStratum.Working, 0.9);
      expect(typeof decayed).toBe('number');
    });
  });

  describe('SurpriseCalculator', () => {
    let surpriseCalculator: SurpriseCalculator;

    beforeEach(() => {
      surpriseCalculator = SurpriseCalculator.getInstance();
      surpriseCalculator.initialize({
        enabled: true,
        threshold: 0.5,
        momentumDecayRate: 0.7,
        momentumBoostFactor: 2.0
      });
    });

    afterEach(() => {
      surpriseCalculator.clear(testAgentId);
    });

    it('should initialize and enable surprise calculation', () => {
      expect(surpriseCalculator.isEnabled()).toBe(true);
    });

    it('should store and retrieve predictions', async () => {
      const prediction: Prediction = {
        id: 'pred-123',
        agentId: testAgentId,
        content: 'Expected outcome: success',
        predictedOutcome: 'success',
        confidence: 0.8,
        timestamp: new Date()
      };

      await surpriseCalculator.storePrediction(prediction);

      const stats = surpriseCalculator.getStatistics(testAgentId);
      expect(stats.predictionCount).toBe(1);
    });

    it('should calculate surprise with prediction match', async () => {
      const prediction: Prediction = {
        id: 'pred-456',
        agentId: testAgentId,
        content: 'Expected outcome: success',
        predictedOutcome: 'success',
        confidence: 0.9,
        timestamp: new Date()
      };

      await surpriseCalculator.storePrediction(prediction);

      const outcome: Outcome = {
        id: 'out-456',
        agentId: testAgentId,
        content: 'Actual outcome: success',
        actualOutcome: 'success',
        timestamp: new Date(Date.now() + 1000),
        predictionId: 'pred-456'
      };

      const surpriseSignal = await surpriseCalculator.calculateSurprise(outcome);

      expect(surpriseSignal.momentarySurprise).toBeLessThan(0.5);
      expect(surpriseSignal.effectiveSurprise).toBeDefined();
      expect(surpriseSignal.detection.isSurprising).toBe(false);
    });

    it('should calculate high surprise for prediction mismatch', async () => {
      const prediction: Prediction = {
        id: 'pred-789',
        agentId: testAgentId,
        content: 'Expected outcome: success',
        predictedOutcome: 'success',
        confidence: 0.9,
        timestamp: new Date()
      };

      await surpriseCalculator.storePrediction(prediction);

      const outcome: Outcome = {
        id: 'out-789',
        agentId: testAgentId,
        content: 'Actual outcome: failure',
        actualOutcome: 'failure',
        timestamp: new Date(Date.now() + 1000),
        predictionId: 'pred-789'
      };

      const surpriseSignal = await surpriseCalculator.calculateSurprise(outcome);

      expect(surpriseSignal.momentarySurprise).toBeGreaterThan(0.5);
      expect(surpriseSignal.detection.isSurprising).toBe(true);
      expect(surpriseSignal.detection.type).toBe('prediction_failure');
    });

    it('should track surprise momentum', async () => {
      const outcome1: Outcome = {
        id: 'out-1',
        agentId: testAgentId,
        content: 'Surprising event',
        actualOutcome: 'surprise',
        timestamp: new Date()
      };

      const signal1 = await surpriseCalculator.calculateSurprise(outcome1);
      expect(signal1.pastSurprise).toBe(0);

      if (signal1.momentarySurprise > 0.5) {
        const outcome2: Outcome = {
          id: 'out-2',
          agentId: testAgentId,
          content: 'Follow-up event',
          actualOutcome: 'related',
          timestamp: new Date(Date.now() + 2000)
        };

        const signal2 = await surpriseCalculator.calculateSurprise(outcome2);
        expect(signal2.pastSurprise).toBeGreaterThan(0);
      }
    });
  });

  describe('MemoryCompressor', () => {
    let memoryCompressor: MemoryCompressor;

    beforeEach(() => {
      memoryCompressor = MemoryCompressor.getInstance();
      memoryCompressor.initialize({ enabled: true });
    });

    it('should initialize and enable compression', () => {
      expect(memoryCompressor.isEnabled()).toBe(true);
    });

    it('should compress memory for stratum promotion', async () => {
      const memory: MemoryEntry = {
        id: 'mem-123',
        stratum: MemoryStratum.Working,
        content: 'This is a long memory that needs compression when promoting to a slower stratum. It contains multiple sentences with detailed information.',
        contentType: 'text',
        importance: MemoryImportance.High,
        tags: ['compression-test'],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        accessCount: 0,
        lastAccessed: new Date(),
        createdAt: new Date(),
        relatedMemories: []
      };

      const compressed = await memoryCompressor.compressMemory(memory, MemoryStratum.ShortTerm);

      expect(compressed.content.length).toBeLessThan(memory.content.length);
      expect(compressed.metadata?.compressionRatio).toBeDefined();
      expect(compressed.metadata?.compressionMethod).toBeDefined();
    });

    it('should not compress when targeting same stratum', async () => {
      const memory: MemoryEntry = {
        id: 'mem-456',
        stratum: MemoryStratum.Working,
        content: 'Short memory',
        contentType: 'text',
        importance: MemoryImportance.Medium,
        tags: [],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        accessCount: 0,
        lastAccessed: new Date(),
        createdAt: new Date(),
        relatedMemories: []
      };

      const result = await memoryCompressor.compressMemory(memory, MemoryStratum.Working);

      expect(result.content).toBe(memory.content);
    });
  });

  describe('RetentionGateService', () => {
    let retentionGate: RetentionGateService;

    beforeEach(() => {
      retentionGate = RetentionGateService.getInstance();
      retentionGate.initialize({ enabled: true });
    });

    it('should initialize and enable retention gates', () => {
      expect(retentionGate.isEnabled()).toBe(true);
    });

    it('should calculate retention score based on memory properties', () => {
      const memory: MemoryEntry = {
        id: 'mem-789',
        stratum: MemoryStratum.ShortTerm,
        content: 'Important memory',
        contentType: 'text',
        importance: MemoryImportance.High,
        tags: ['important'],
        source: { type: 'observation', agentId: testAgentId },
        context: { agentId: testAgentId, timestamp: new Date() },
        accessCount: 10,
        lastAccessed: new Date(),
        createdAt: new Date(),
        relatedMemories: ['rel-1', 'rel-2']
      };

      const score = retentionGate.calculateRetentionScore(memory, 0.8);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should apply retention gate to memory set', () => {
      const memories: MemoryEntry[] = [
        {
          id: 'mem-1',
          stratum: MemoryStratum.Working,
          content: 'Old unused memory',
          contentType: 'text',
          importance: MemoryImportance.Low,
          tags: [],
          source: { type: 'observation', agentId: testAgentId },
          context: { agentId: testAgentId, timestamp: new Date() },
          accessCount: 0,
          lastAccessed: new Date(Date.now() - 86400000 * 7), // 7 days ago
          createdAt: new Date(Date.now() - 86400000 * 7),
          relatedMemories: []
        },
        {
          id: 'mem-2',
          stratum: MemoryStratum.Working,
          content: 'Recent important memory',
          contentType: 'text',
          importance: MemoryImportance.High,
          tags: ['important'],
          source: { type: 'observation', agentId: testAgentId },
          context: { agentId: testAgentId, timestamp: new Date() },
          accessCount: 5,
          lastAccessed: new Date(),
          createdAt: new Date(),
          relatedMemories: []
        }
      ];

      const results = retentionGate.applyRetentionGate(
        memories,
        MemoryStratum.Working,
        2
      );

      expect(results.length).toBe(2);
      expect(results[0].shouldRetain).toBeDefined();
      expect(results[1].shouldRetain).toBeDefined();
    });
  });

  describe('SERCOrchestrator', () => {
    let sercOrchestrator: SERCOrchestrator;

    beforeEach(() => {
      sercOrchestrator = SERCOrchestrator.getInstance();
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

    afterEach(() => {
      sercOrchestrator.clear(testAgentId);
    });

    it('should initialize and enable SERC', () => {
      expect(sercOrchestrator.isEnabled()).toBe(true);
    });

    it('should start inner loop and create context', async () => {
      const context = await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);

      expect(context.agentId).toBe(testAgentId);
      expect(context.channelId).toBe(testChannelId);
      expect(context.mode).toBe(AgentMode.Solver);
      expect(context.cycleNumber).toBe(1);
    });

    it('should switch between Solver and Verifier modes', async () => {
      await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);

      let context = sercOrchestrator.getContext(testAgentId);
      expect(context?.mode).toBe(AgentMode.Solver);

      sercOrchestrator.switchToVerifierMode(testAgentId);
      context = sercOrchestrator.getContext(testAgentId);
      expect(context?.mode).toBe(AgentMode.Verifier);

      sercOrchestrator.switchToSolverMode(testAgentId);
      context = sercOrchestrator.getContext(testAgentId);
      expect(context?.mode).toBe(AgentMode.Solver);
    });

    it('should process surprise signal', async () => {
      await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);

      const outcome: Outcome = {
        id: 'out-123',
        agentId: testAgentId,
        content: 'Test outcome',
        actualOutcome: 'result',
        timestamp: new Date()
      };

      const surpriseSignal = await sercOrchestrator.processSurpriseSignal(testAgentId, outcome);

      expect(surpriseSignal.effectiveSurprise).toBeDefined();

      const context = sercOrchestrator.getContext(testAgentId);
      expect(context?.surpriseSignal).toBeDefined();
    });

    it('should generate verification tuple', async () => {
      await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);

      const verification = await sercOrchestrator.generateVerification(
        testAgentId,
        'Test reasoning',
        ['tool-result-1']
      );

      expect(verification.score).toBeDefined();
      expect(verification.confidence).toBeDefined();
      expect(verification.critique).toBeDefined();
    });

    it('should determine if outer loop should run', async () => {
      await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);

      for (let i = 0; i < 4; i++) {
        expect(sercOrchestrator.shouldRunOuterLoop(testAgentId)).toBe(false);
        await sercOrchestrator.startInnerLoop(testAgentId, testChannelId);
      }

      expect(sercOrchestrator.shouldRunOuterLoop(testAgentId)).toBe(true);
    });
  });
});
