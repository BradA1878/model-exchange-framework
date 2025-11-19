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
 * Enhanced Reflection Types for the Model Exchange Framework
 * 
 * This file contains extended types for the reflection component of the control loop,
 * providing more structured metrics and insights for reinforcement learning.
 */

import { AgentId } from './Agent';

/**
 * Structured metrics about a plan execution
 */
export interface ReflectionMetrics {
    successRate: number;        // Percentage of successful actions (0-1)
    completionRate: number;     // Percentage of actions completed vs planned (0-1)
    executionTime: number;      // Time taken to execute plan (ms)
    complexity: number;         // Number of actions in the plan
    errorRate: number;          // Percentage of actions that failed (0-1)
}

/**
 * Types of reflection insights
 */
export type InsightType = 'success' | 'error' | 'improvement' | 'pattern';

/**
 * Structured insight from reflection
 */
export interface ReflectionInsight {
    type: InsightType;          // Type of this insight
    description: string;        // Human-readable description
    confidence: number;         // Confidence level (0-1)
    relatedActionIds?: string[]; // IDs of actions this insight relates to
    metadata?: Record<string, any>; // Additional data about this insight
}

/**
 * Learning signals for reinforcement learning integration
 */
export interface LearningSignals {
    reward: number;              // Overall reward signal (-1 to 1)
    actionRewards: Record<string, number>; // Per-action rewards
    confidenceScore: number;     // Confidence in these signals (0-1)
}

/**
 * Extended Reflection interface with structured data
 * Enhances the base Reflection interface from ControlLoopTypes
 */
export interface EnhancedReflection {
    metrics: ReflectionMetrics;  // Quantitative metrics about execution
    structuredInsights: ReflectionInsight[]; // Structured insights
    learningSignals?: LearningSignals; // Optional RL integration
}
