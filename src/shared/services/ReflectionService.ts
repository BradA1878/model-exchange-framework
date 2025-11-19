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
 * ReflectionService.ts
 * 
 * Provides enhanced reflection capabilities for control loops.
 * This shared service can be used on both client and server side.
 */

import { v4 as uuidv4 } from 'uuid';
import { Plan, PlanAction } from '../types/ControlLoopTypes';
import { createStrictValidator } from '../utils/validation';
import { 
    ReflectionMetrics, 
    ReflectionInsight, 
    LearningSignals,
    EnhancedReflection
} from '../types/ReflectionTypes';
import { Reflection } from '../models/controlLoop';
import { AgentId } from '../types/types';

/**
 * Service for generating structured reflections from plan executions
 */
export class ReflectionService {
    // Validator for input validation
    private validator = createStrictValidator('ReflectionService');

    /**
     * Generate a comprehensive reflection from a completed plan
     * 
     * @param plan The executed plan to reflect on
     * @returns A structured reflection with metrics and insights
     */
    public generateReflection = (plan: Plan): Reflection & EnhancedReflection => {
        // Validate inputs
        this.validator.assertIsObject(plan, 'Invalid plan object');
        this.validator.assertIsNonEmptyString(plan.agentId, 'Plan must have an agent ID');
        this.validator.assertIsArray(plan.actions, 'Plan must have actions array');
        
        // Calculate metrics from plan execution
        const metrics = this.calculateMetrics(plan);
        
        // Generate structured insights
        const structuredInsights = this.generateStructuredInsights(plan);
        
        // Calculate learning signals for reinforcement learning
        const learningSignals = this.calculateLearningSignals(plan, metrics);
        
        // Create insights and improvements arrays from structuredInsights
        // We still need these for compatibility with the Reflection interface
        const insights = structuredInsights
            .filter(insight => insight.type === 'success' || insight.type === 'pattern')
            .map(insight => insight.description);
            
        const improvements = structuredInsights
            .filter(insight => insight.type === 'improvement')
            .map(insight => insight.description);
        
        // Generate the reflection object with full enhanced properties
        return {
            id: uuidv4(),
            agentId: plan.agentId,
            planId: plan.id,
            timestamp: Date.now(),
            success: metrics.successRate > 0.5, // Consider success if more than half actions succeeded
            // Include both old-style arrays and enhanced properties
            insights,
            improvements,
            metrics,
            structuredInsights,
            learningSignals
        };
    };

    /**
     * Calculate metrics from plan execution
     * 
     * @param plan The executed plan
     * @returns Metrics about the plan execution
     */
    private calculateMetrics = (plan: Plan): ReflectionMetrics => {
        const totalActions = plan.actions.length;
        if (totalActions === 0) {
            return {
                successRate: 0,
                completionRate: 0,
                executionTime: 0,
                complexity: 0,
                errorRate: 0
            };
        }

        const completedActions = plan.actions.filter(a => a.status === 'completed').length;
        const failedActions = plan.actions.filter(a => a.status === 'failed').length;
        const pendingActions = plan.actions.filter(a => 
            a.status === 'pending' || a.status === 'executing'
        ).length;
        
        // Calculate time from plan timestamp to now
        // We don't have completedAt in PlanAction, so we'll use the plan timestamp
        const executionTime = Date.now() - plan.timestamp;
        
        return {
            successRate: totalActions ? completedActions / totalActions : 0,
            completionRate: totalActions ? (completedActions + failedActions) / totalActions : 0,
            executionTime,
            complexity: totalActions,
            errorRate: totalActions ? failedActions / totalActions : 0
        };
    };

    /**
     * Generate structured insights from plan execution
     * 
     * @param plan The executed plan
     * @returns Array of structured insights
     */
    private generateStructuredInsights = (plan: Plan): ReflectionInsight[] => {
        const insights: ReflectionInsight[] = [];
        
        // Group actions by status for analysis
        const completedActions = plan.actions.filter(a => a.status === 'completed');
        const failedActions = plan.actions.filter(a => a.status === 'failed');
        const skippedActions = plan.actions.filter(a => a.status === 'skipped');
        const pendingActions = plan.actions.filter(a => 
            a.status === 'pending' || a.status === 'executing'
        );
        
        // Add success insights
        if (completedActions.length > 0) {
            insights.push({
                type: 'success',
                description: `Successfully completed ${completedActions.length} of ${plan.actions.length} actions`,
                confidence: 1.0,
                relatedActionIds: completedActions.map(a => a.id)
            });
            
            // Add individual success insights for important actions
            completedActions.forEach(action => {
                if (action.result) {
                    insights.push({
                        type: 'success',
                        description: `Action "${action.description}" completed successfully with result`,
                        confidence: 0.9,
                        relatedActionIds: [action.id],
                        metadata: { result: action.result }
                    });
                }
            });
        }
        
        // Add error insights
        if (failedActions.length > 0) {
            insights.push({
                type: 'error',
                description: `Failed to complete ${failedActions.length} of ${plan.actions.length} actions`,
                confidence: 1.0,
                relatedActionIds: failedActions.map(a => a.id)
            });
            
            // Add specific error insights with improvement suggestions
            failedActions.forEach(action => {
                if (action.error) {
                    const errorInsight: ReflectionInsight = {
                        type: 'error',
                        description: `Action "${action.description}" failed: ${action.error}`,
                        confidence: 0.9,
                        relatedActionIds: [action.id]
                    };
                    
                    insights.push(errorInsight);
                    
                    // Add improvement suggestion for each error
                    insights.push({
                        type: 'improvement',
                        description: this.generateImprovementForError(action),
                        confidence: 0.7,
                        relatedActionIds: [action.id]
                    });
                }
            });
        }
        
        // Add general improvement insights
        if (pendingActions.length > 0) {
            insights.push({
                type: 'improvement',
                description: `Ensure all actions complete execution: ${pendingActions.length} actions remain unfinished`,
                confidence: 0.8,
                relatedActionIds: pendingActions.map(a => a.id)
            });
        }
        
        // Add pattern insights if we detect sequences
        if (plan.actions.length > 3) {
            insights.push({
                type: 'pattern',
                description: 'Plan execution shows a sequential dependency pattern between actions',
                confidence: 0.6
            });
        }
        
        // Add more generic improvements if needed
        if (insights.filter(i => i.type === 'improvement').length === 0) {
            insights.push({
                type: 'improvement',
                description: 'Consider adding more detailed success criteria to each action',
                confidence: 0.5
            });
        }
        
        return insights;
    };

    /**
     * Generate improvement suggestion based on an action's error
     * 
     * @param action Failed action
     * @returns Improvement suggestion
     */
    private generateImprovementForError = (action: PlanAction): string => {
        const error = action.error || '';
        
        // Generate different improvement suggestions based on error patterns
        if (error.includes('timeout')) {
            return `Add timeout handling for action "${action.description}"`;
        } else if (error.includes('permission') || error.includes('access')) {
            return `Verify permissions before executing action "${action.description}"`;
        } else if (error.includes('not found') || error.includes('404')) {
            return `Add existence checks before action "${action.description}"`;
        } else {
            return `Implement error handling for "${action.description}" failure scenarios`;
        }
    };

    /**
     * Calculate learning signals for reinforcement learning
     * 
     * @param plan The executed plan
     * @param metrics Plan execution metrics
     * @returns Learning signals for RL
     */
    private calculateLearningSignals = (plan: Plan, metrics: ReflectionMetrics): LearningSignals => {
        // Base reward on success rate, scaled to -1 to 1 range
        // Formula: 2 * successRate - 1
        const reward = (metrics.successRate * 2) - 1;
        
        // Calculate per-action rewards
        const actionRewards: Record<string, number> = {};
        
        plan.actions.forEach(action => {
            let actionReward = -0.5; // Default penalty for incomplete actions
            
            if (action.status === 'completed') {
                actionReward = 1.0; // Success reward
            } else if (action.status === 'failed') {
                actionReward = -1.0; // Failure penalty
            } else if (action.status === 'skipped') {
                actionReward = 0.0; // Neutral for skipped
            } else if (action.status === 'executing') {
                actionReward = -0.2; // Slight penalty for non-completion
            }
            
            // Adjust based on action priority (higher priority actions have larger impact)
            const priorityMultiplier = 1 + (action.priority || 0) * 0.1;
            actionReward *= priorityMultiplier;
            
            actionRewards[action.id] = actionReward;
        });
        
        return {
            reward,
            actionRewards,
            confidenceScore: metrics.completionRate // Confidence based on how much of the plan completed
        };
    };
}

// Export a singleton instance for convenience
export const reflectionService = new ReflectionService();
