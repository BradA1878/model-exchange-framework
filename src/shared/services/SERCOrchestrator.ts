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
 * SERC Orchestrator (Self-Evolving Reasoning Cycle)
 *
 * Implements the dual-loop structure from Agent0-VL:
 * - Inner loop: Per-cycle ORPAR execution with verification and self-repair
 * - Outer loop: Cross-cycle memory consolidation and pattern learning
 *
 * Coordinates between Solver mode (standard reasoning) and Verifier mode
 * (tool-grounded verification).
 *
 * Feature flags: MEMORY_STRATA_ENABLED, SERC_ENABLED
 */

import { Logger } from '../utils/Logger';
import { AgentId, ChannelId } from '../types/ChannelContext';
import { StratumManager } from './StratumManager';
import { SurpriseCalculator, SurpriseSignal, Prediction, Outcome } from './SurpriseCalculator';
import { MemoryCompressor } from './MemoryCompressor';
import { RetentionGateService } from './RetentionGateService';
import { MemoryEntry, MemoryStratum, MemoryImportance, MemorySource, MemoryContext } from '../types/MemoryStrataTypes';

/**
 * Agent operational mode
 */
export enum AgentMode {
  Solver = 'solver',      // Standard ORPAR reasoning and action
  Verifier = 'verifier'   // Tool-grounded verification and critique
}

/**
 * Verification tuple from Verifier mode
 */
export interface VerificationTuple {
  score: number;              // Correctness score (-1 to 1)
  confidence: number;         // Epistemic certainty (0 to 1)
  critique: string;           // Natural language feedback
  toolVerifications?: {       // Optional tool-based evidence
    toolName: string;
    result: unknown;
    passed: boolean;
  }[];
}

/**
 * Self-repair instruction
 */
export interface RepairInstruction {
  action: 'PATCH' | 'NO_CHANGE';
  targetStep?: number;
  patchType?: 'reasoning' | 'tool_call' | 'parameter';
  newContent?: string;
  justification: string;
  reason?: string;
}

/**
 * Process-level reward components
 */
export interface ProcessReward {
  surpriseScore: number;
  confidenceScore: number;
  toolVerificationScore: number;
  repairCost: number;
  promotionScore: number;
}

/**
 * SERC cycle context
 */
export interface SERCContext {
  agentId: AgentId;
  channelId: ChannelId;
  cycleNumber: number;
  innerLoopCount: number;
  mode: AgentMode;
  surpriseSignal?: SurpriseSignal;
  verification?: VerificationTuple;
  repair?: RepairInstruction;
}

/**
 * SERC configuration
 */
export interface SERCConfig {
  enabled: boolean;
  confidenceThreshold: number;          // Threshold for triggering repair (default: 0.7)
  repairMaxRetries: number;             // Max repair attempts per cycle (default: 3)
  outerLoopFrequency: number;           // Inner loops before outer loop (default: 5)
  verificationEnabled: boolean;         // Enable tool-grounded verification
  selfRepairEnabled: boolean;           // Enable self-repair mechanism
  surpriseThreshold: number;            // Surprise threshold for memory promotion
}

/**
 * SERCOrchestrator coordinates the dual-loop reasoning cycle
 */
export class SERCOrchestrator {
  private static instance: SERCOrchestrator;
  private logger: Logger;

  // Service dependencies
  private stratumManager: StratumManager;
  private surpriseCalculator: SurpriseCalculator;
  private memoryCompressor: MemoryCompressor;
  private retentionGate: RetentionGateService;

  // SERC state per agent
  private agentContexts: Map<AgentId, SERCContext>;

  // Configuration
  private config: SERCConfig = {
    enabled: false,
    confidenceThreshold: 0.7,
    repairMaxRetries: 3,
    outerLoopFrequency: 5,
    verificationEnabled: true,
    selfRepairEnabled: true,
    surpriseThreshold: 0.5
  };

  private constructor() {
    this.logger = new Logger('info', 'SERCOrchestrator');
    this.stratumManager = StratumManager.getInstance();
    this.surpriseCalculator = SurpriseCalculator.getInstance();
    this.memoryCompressor = MemoryCompressor.getInstance();
    this.retentionGate = RetentionGateService.getInstance();
    this.agentContexts = new Map();
  }

  public static getInstance(): SERCOrchestrator {
    if (!SERCOrchestrator.instance) {
      SERCOrchestrator.instance = new SERCOrchestrator();
    }
    return SERCOrchestrator.instance;
  }

  /**
   * Initialize SERC orchestrator
   */
  public initialize(config: Partial<SERCConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.config.enabled) {
      this.logger.info('[SERCOrchestrator] Initialized Self-Evolving Reasoning Cycle');
    }
  }

  /**
   * Check if SERC is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Start a new SERC cycle (inner loop)
   */
  public async startInnerLoop(
    agentId: AgentId,
    channelId: ChannelId
  ): Promise<SERCContext> {
    if (!this.config.enabled) {
      throw new Error('SERC is not enabled');
    }

    const existingContext = this.agentContexts.get(agentId);
    const cycleNumber = existingContext ? existingContext.cycleNumber + 1 : 1;
    const innerLoopCount = existingContext ? existingContext.innerLoopCount + 1 : 1;

    const context: SERCContext = {
      agentId,
      channelId,
      cycleNumber,
      innerLoopCount,
      mode: AgentMode.Solver
    };

    this.agentContexts.set(agentId, context);

    this.logger.debug(
      `[SERCOrchestrator] Started inner loop ${innerLoopCount} for agent ${agentId} (cycle ${cycleNumber})`
    );

    return context;
  }

  /**
   * Switch agent to Verifier mode
   */
  public switchToVerifierMode(agentId: AgentId): void {
    const context = this.agentContexts.get(agentId);
    if (!context) {
      this.logger.warn(`[SERCOrchestrator] No context found for agent ${agentId}`);
      return;
    }

    context.mode = AgentMode.Verifier;
    this.logger.debug(`[SERCOrchestrator] Agent ${agentId} switched to Verifier mode`);
  }

  /**
   * Switch agent back to Solver mode
   */
  public switchToSolverMode(agentId: AgentId): void {
    const context = this.agentContexts.get(agentId);
    if (!context) {
      this.logger.warn(`[SERCOrchestrator] No context found for agent ${agentId}`);
      return;
    }

    context.mode = AgentMode.Solver;
    this.logger.debug(`[SERCOrchestrator] Agent ${agentId} switched to Solver mode`);
  }

  /**
   * Process surprise signal during Observation phase
   */
  public async processSurpriseSignal(
    agentId: AgentId,
    outcome: Outcome,
    prediction?: Prediction
  ): Promise<SurpriseSignal> {
    if (!this.config.enabled) {
      return {
        momentarySurprise: 0,
        pastSurprise: 0,
        effectiveSurprise: 0,
        detection: {
          isSurprising: false,
          surpriseScore: 0,
          observation: outcome.content
        }
      };
    }

    // Store prediction if provided
    if (prediction) {
      await this.surpriseCalculator.storePrediction(prediction);
    }

    // Calculate surprise
    const surpriseSignal = await this.surpriseCalculator.calculateSurprise(outcome);

    // Update context
    const context = this.agentContexts.get(agentId);
    if (context) {
      context.surpriseSignal = surpriseSignal;
    }

    this.logger.debug(
      `[SERCOrchestrator] Agent ${agentId} surprise: effective=${surpriseSignal.effectiveSurprise.toFixed(3)}`
    );

    return surpriseSignal;
  }

  /**
   * Generate verification tuple during Reflection phase
   */
  public async generateVerification(
    agentId: AgentId,
    reasoning: string,
    toolResults?: unknown[]
  ): Promise<VerificationTuple> {
    if (!this.config.enabled || !this.config.verificationEnabled) {
      return {
        score: 0,
        confidence: 1.0,
        critique: 'Verification disabled'
      };
    }

    const context = this.agentContexts.get(agentId);
    if (!context) {
      throw new Error(`No SERC context for agent ${agentId}`);
    }

    // Switch to Verifier mode
    this.switchToVerifierMode(agentId);

    // Simple verification logic (in production, this would call SystemLLM)
    const score = toolResults && toolResults.length > 0 ? 0.8 : 0.5;
    const confidence = context.surpriseSignal
      ? 1.0 - context.surpriseSignal.effectiveSurprise
      : 0.8;
    const critique = confidence < this.config.confidenceThreshold
      ? 'Low confidence - consider repair'
      : 'Verification passed';

    const verification: VerificationTuple = {
      score,
      confidence,
      critique,
      toolVerifications: toolResults?.map((result, i) => ({
        toolName: `tool_${i}`,
        result,
        passed: true
      }))
    };

    context.verification = verification;

    // Switch back to Solver mode
    this.switchToSolverMode(agentId);

    this.logger.debug(
      `[SERCOrchestrator] Agent ${agentId} verification: score=${score.toFixed(3)}, confidence=${confidence.toFixed(3)}`
    );

    return verification;
  }

  /**
   * Determine if self-repair should be triggered
   */
  public shouldTriggerRepair(agentId: AgentId): boolean {
    if (!this.config.enabled || !this.config.selfRepairEnabled) {
      return false;
    }

    const context = this.agentContexts.get(agentId);
    if (!context || !context.verification) {
      return false;
    }

    return context.verification.confidence < this.config.confidenceThreshold;
  }

  /**
   * Generate repair instruction
   */
  public async generateRepairInstruction(
    agentId: AgentId,
    targetStep: number
  ): Promise<RepairInstruction> {
    if (!this.config.enabled || !this.config.selfRepairEnabled) {
      return {
        action: 'NO_CHANGE',
        justification: 'Self-repair disabled'
      };
    }

    const context = this.agentContexts.get(agentId);
    if (!context || !context.verification) {
      return {
        action: 'NO_CHANGE',
        justification: 'No verification context available'
      };
    }

    // Simple repair logic (in production, this would use SystemLLM)
    const shouldRepair = context.verification.confidence < this.config.confidenceThreshold;

    if (!shouldRepair) {
      return {
        action: 'NO_CHANGE',
        reason: 'Confidence above threshold',
        justification: context.verification.critique
      };
    }

    const repair: RepairInstruction = {
      action: 'PATCH',
      targetStep,
      patchType: 'reasoning',
      newContent: 'Re-evaluate reasoning with additional context',
      justification: `Low confidence (${context.verification.confidence.toFixed(3)}): ${context.verification.critique}`
    };

    context.repair = repair;

    this.logger.info(`[SERCOrchestrator] Agent ${agentId} triggered repair at step ${targetStep}`);

    return repair;
  }

  /**
   * Calculate process-level reward for memory promotion
   */
  public calculateProcessReward(agentId: AgentId): ProcessReward {
    if (!this.config.enabled) {
      return {
        surpriseScore: 0,
        confidenceScore: 0,
        toolVerificationScore: 0,
        repairCost: 0,
        promotionScore: 0
      };
    }

    const context = this.agentContexts.get(agentId);
    if (!context) {
      throw new Error(`No SERC context for agent ${agentId}`);
    }

    const surpriseScore = context.surpriseSignal?.effectiveSurprise || 0;
    const confidenceScore = context.verification?.confidence || 0;
    const toolVerificationScore = context.verification?.toolVerifications?.length || 0;
    const repairCost = context.repair?.action === 'PATCH' ? 0.1 : 0;

    // Calculate promotion score
    const promotionScore =
      0.4 * surpriseScore +
      0.3 * confidenceScore +
      0.2 * (toolVerificationScore > 0 ? 1 : 0) -
      0.1 * repairCost;

    return {
      surpriseScore,
      confidenceScore,
      toolVerificationScore,
      repairCost,
      promotionScore
    };
  }

  /**
   * Determine if memory should be promoted to slower stratum
   */
  public shouldPromoteMemory(
    agentId: AgentId,
    currentStratum: MemoryStratum
  ): { shouldPromote: boolean; targetStratum?: MemoryStratum } {
    if (!this.config.enabled) {
      return { shouldPromote: false };
    }

    const reward = this.calculateProcessReward(agentId);

    // Check if promotion score exceeds threshold
    if (reward.promotionScore < this.config.surpriseThreshold) {
      return { shouldPromote: false };
    }

    // Determine target stratum based on current stratum
    let targetStratum: MemoryStratum | undefined;
    switch (currentStratum) {
      case MemoryStratum.Working:
        targetStratum = MemoryStratum.ShortTerm;
        break;
      case MemoryStratum.ShortTerm:
        targetStratum = reward.surpriseScore > 0.7
          ? MemoryStratum.LongTerm
          : MemoryStratum.Episodic;
        break;
      case MemoryStratum.Episodic:
        targetStratum = MemoryStratum.Semantic;
        break;
      default:
        return { shouldPromote: false };
    }

    return { shouldPromote: true, targetStratum };
  }

  /**
   * Check if outer loop consolidation should occur
   */
  public shouldRunOuterLoop(agentId: AgentId): boolean {
    if (!this.config.enabled) return false;

    const context = this.agentContexts.get(agentId);
    if (!context) return false;

    return context.innerLoopCount >= this.config.outerLoopFrequency;
  }

  /**
   * Execute outer loop consolidation
   */
  public async runOuterLoop(
    agentId: AgentId,
    channelId: ChannelId
  ): Promise<void> {
    if (!this.config.enabled) return;

    this.logger.info(`[SERCOrchestrator] Running outer loop consolidation for agent ${agentId}`);

    // Apply retention gates and decay
    for (const stratum of Object.values(MemoryStratum)) {
      const decayedCount = await this.stratumManager.applyDecay('agent', agentId, stratum);
      if (decayedCount > 0) {
        this.logger.debug(`[SERCOrchestrator] Decayed ${decayedCount} memories from ${stratum}`);
      }
    }

    // Increment cycle counters
    this.stratumManager.incrementCycles('agent', agentId);

    // Reset inner loop count
    const context = this.agentContexts.get(agentId);
    if (context) {
      context.innerLoopCount = 0;
    }

    this.logger.info(`[SERCOrchestrator] Outer loop consolidation complete for agent ${agentId}`);
  }

  /**
   * Get current SERC context for an agent
   */
  public getContext(agentId: AgentId): SERCContext | undefined {
    return this.agentContexts.get(agentId);
  }

  /**
   * Clear SERC context for an agent
   */
  public clear(agentId: AgentId): void {
    this.agentContexts.delete(agentId);
    this.logger.info(`[SERCOrchestrator] Cleared SERC context for agent ${agentId}`);
  }
}
