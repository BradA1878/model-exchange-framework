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
 * Validation Analytics Controller
 * Phase 6: Advanced analytics API endpoints
 */

import { Request, Response } from 'express';
import { ValidationPerformanceService } from '../../../shared/services/ValidationPerformanceService';
import { ValidationAnalyticsService, TimeRange } from '../../../shared/services/ValidationAnalyticsService';
import { PerformanceOptimizationService } from '../../../shared/services/PerformanceOptimizationService';
import { PredictiveAnalyticsService } from '../../../shared/services/PredictiveAnalyticsService';
import { Logger } from '../../../shared/utils/Logger';
import { AgentId, ChannelId } from '../../../shared/types/ChannelContext';

const logger = new Logger('info', 'ValidationAnalyticsController', 'server');
const validationService = ValidationPerformanceService.getInstance();
const analyticsService = ValidationAnalyticsService.getInstance();
const optimizationService = PerformanceOptimizationService.getInstance();
const predictiveService = PredictiveAnalyticsService.getInstance();

/**
 * Get validation metrics for an agent
 */
export const getValidationMetrics = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId } = req.params;
        
        if (!agentId || !channelId) {
            return res.status(400).json({
                error: 'Agent ID and Channel ID are required'
            });
        }


        // Get base validation metrics
        const metrics = await validationService.getValidationMetrics(agentId, channelId);
        
        // Get performance analysis
        const analysis = await validationService.analyzeValidationPerformance(agentId, channelId);
        
        // Get enhanced tool metrics
        const enhancedMetrics = await validationService.getEnhancedToolMetrics(agentId, channelId);

        // Combine all data for dashboard
        const response = {
            // Core metrics
            validationHealth: analysis.validationHealthScore,
            totalErrors: metrics.totalValidationErrors,
            selfCorrectionRate: metrics.efficiency.selfCorrectionRate,
            
            // Detailed breakdowns
            errorTypes: metrics.errorTypes,
            helpToolUsage: metrics.helpToolUsage,
            
            // Recovery metrics
            recoveryTimes: metrics.recoveryTime,
            
            // Problem areas
            problemAreas: analysis.problemAreas,
            
            // Learning effectiveness
            learning: analysis.learningEffectiveness,
            
            // Recommendations
            recommendations: analysis.recommendations,
            
            // Enhanced tool data
            toolValidationRates: enhancedMetrics.toolValidationSuccessRates,
            commonErrors: enhancedMetrics.commonValidationErrors,
            
            // Efficiency metrics
            efficiency: metrics.efficiency,
            
            // Metadata
            lastUpdated: metrics.lastUpdated
        };

        res.json(response);
        
    } catch (error) {
        logger.error(`Error fetching validation metrics: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch validation metrics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get validation events stream for real-time updates
 */
export const getValidationEventStream = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId } = req.params;
        
        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        
        // Subscribe to validation events
        const subscription = validationService.validationEvents.subscribe(event => {
            // Filter events for this agent/channel
            if (event.agentId === agentId && event.channelId === channelId) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
        });
        
        // Clean up on disconnect
        req.on('close', () => {
            subscription.unsubscribe();
            res.end();
        });
        
    } catch (error) {
        logger.error(`Error setting up validation event stream: ${error}`);
        res.status(500).json({
            error: 'Failed to set up event stream',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get aggregated validation metrics for a channel
 */
export const getChannelValidationMetrics = async (req: Request, res: Response) => {
    try {
        const { channelId } = req.params;
        
        if (!channelId) {
            return res.status(400).json({
                error: 'Channel ID is required'
            });
        }


        // TODO: Implement channel-wide aggregation
        // For now, return placeholder data
        const response = {
            channelId,
            totalAgents: 0,
            aggregateMetrics: {
                totalErrors: 0,
                averageHealthScore: 0,
                topProblemTools: [],
                mostUsedHelpTools: [],
                overallTrend: 'stable'
            },
            message: 'Channel-wide metrics aggregation coming in Phase 2'
        };

        res.json(response);
        
    } catch (error) {
        logger.error(`Error fetching channel validation metrics: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch channel validation metrics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get validation performance trends over time
 */
export const getValidationTrends = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId } = req.params;
        const { period = '24h' } = req.query;
        

        // TODO: Implement time-series data storage and retrieval
        // For now, return current snapshot
        const metrics = await validationService.getValidationMetrics(agentId, channelId);
        
        const response = {
            agentId,
            channelId,
            period,
            trend: metrics.efficiency.trend,
            dataPoints: [
                {
                    timestamp: Date.now(),
                    errorRate: 1 - metrics.efficiency.firstTrySuccessRate,
                    helpToolUsage: metrics.efficiency.helpToolUsageRate,
                    selfCorrectionRate: metrics.efficiency.selfCorrectionRate
                }
            ],
            message: 'Historical trends coming in Phase 2'
        };

        res.json(response);
        
    } catch (error) {
        logger.error(`Error fetching validation trends: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch validation trends',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Export validation report
 */
export const exportValidationReport = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId } = req.params;
        const { format = 'json' } = req.query;
        

        // Get all metrics
        const metrics = await validationService.getValidationMetrics(agentId, channelId);
        const analysis = await validationService.analyzeValidationPerformance(agentId, channelId);
        const enhanced = await validationService.getEnhancedToolMetrics(agentId, channelId);

        const report = {
            generatedAt: new Date().toISOString(),
            agent: { id: agentId, channelId },
            metrics,
            analysis,
            enhanced,
            summary: {
                healthScore: analysis.validationHealthScore,
                totalErrors: metrics.totalValidationErrors,
                topIssues: analysis.problemAreas.slice(0, 3),
                keyRecommendations: analysis.recommendations
                    .filter(r => r.priority === 'high')
                    .slice(0, 3)
            }
        };

        if (format === 'json') {
            res.json(report);
        } else {
            // TODO: Implement CSV/PDF export in Phase 2
            res.status(501).json({
                error: `Export format ${format} not yet implemented`
            });
        }
        
    } catch (error) {
        logger.error(`Error exporting validation report: ${error}`);
        res.status(500).json({
            error: 'Failed to export validation report',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// =============================================================================
// PHASE 6 ENDPOINTS
// =============================================================================

/**
 * Get aggregated analytics
 */
export const getAggregatedAnalytics = async (req: Request, res: Response) => {
    try {
        const { timeRange = 'day' } = req.query;
        

        const aggregated = await analyticsService.aggregateValidationMetrics(
            timeRange as TimeRange
        );

        res.json(aggregated);
        
    } catch (error) {
        logger.error(`Error fetching aggregated analytics: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch aggregated analytics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get trend analysis
 */
export const getTrendAnalysis = async (req: Request, res: Response) => {
    try {
        const { metric, timeRange = 'day' } = req.query;
        
        if (!metric) {
            return res.status(400).json({
                error: 'Metric name is required'
            });
        }


        const trends = await analyticsService.analyzeTrends(
            metric as string,
            timeRange as TimeRange
        );

        res.json(trends);
        
    } catch (error) {
        logger.error(`Error analyzing trends: ${error}`);
        res.status(500).json({
            error: 'Failed to analyze trends',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get A/B test results
 */
export const getABTestResults = async (req: Request, res: Response) => {
    try {
        const { testId } = req.params;
        

        const results = analyticsService.getABTestResults(testId);
        
        if (!results) {
            return res.status(404).json({
                error: 'A/B test not found'
            });
        }

        res.json(results);
        
    } catch (error) {
        logger.error(`Error fetching A/B test results: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch A/B test results',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Calculate ROI
 */
export const calculateROI = async (req: Request, res: Response) => {
    try {
        const { metric = 'validation_improvements', timeRange = 'month' } = req.query;
        

        const roi = await analyticsService.calculateROI(
            metric as string,
            timeRange as TimeRange
        );

        res.json(roi);
        
    } catch (error) {
        logger.error(`Error calculating ROI: ${error}`);
        res.status(500).json({
            error: 'Failed to calculate ROI',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get performance bottlenecks
 */
export const getPerformanceBottlenecks = async (req: Request, res: Response) => {
    try {

        const bottlenecks = await optimizationService.detectBottlenecks();
        const recommendations = await optimizationService.generateRecommendations();

        res.json({
            bottlenecks,
            recommendations: recommendations.slice(0, 10), // Top 10 recommendations
            metrics: optimizationService.getMetrics()
        });
        
    } catch (error) {
        logger.error(`Error detecting bottlenecks: ${error}`);
        res.status(500).json({
            error: 'Failed to detect bottlenecks',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Start performance profiling
 */
export const startPerformanceProfile = async (req: Request, res: Response) => {
    try {
        const { name } = req.body;
        

        const profileId = optimizationService.startProfile(name);

        res.json({
            profileId,
            message: 'Performance profile started'
        });
        
    } catch (error) {
        logger.error(`Error starting performance profile: ${error}`);
        res.status(500).json({
            error: 'Failed to start performance profile',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * End performance profiling
 */
export const endPerformanceProfile = async (req: Request, res: Response) => {
    try {
        const { profileId } = req.params;
        

        const profile = await optimizationService.endProfile(profileId);

        res.json(profile);
        
    } catch (error) {
        logger.error(`Error ending performance profile: ${error}`);
        res.status(500).json({
            error: 'Failed to end performance profile',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Predict errors
 */
export const predictErrors = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId, toolName, parameters } = req.body;
        
        if (!agentId || !channelId || !toolName || !parameters) {
            return res.status(400).json({
                error: 'Agent ID, Channel ID, tool name, and parameters are required'
            });
        }


        const prediction = await predictiveService.predictErrors(
            agentId as AgentId,
            channelId as ChannelId,
            toolName,
            parameters
        );

        res.json(prediction);
        
    } catch (error) {
        logger.error(`Error predicting errors: ${error}`);
        res.status(500).json({
            error: 'Failed to predict errors',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Detect anomalies
 */
export const detectAnomalies = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId, toolName, parameters, executionMetrics } = req.body;
        

        const anomalies = await predictiveService.detectAnomalies(
            agentId as AgentId,
            channelId as ChannelId,
            toolName,
            parameters,
            executionMetrics
        );

        res.json({
            anomalies,
            detected: anomalies.length > 0
        });
        
    } catch (error) {
        logger.error(`Error detecting anomalies: ${error}`);
        res.status(500).json({
            error: 'Failed to detect anomalies',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get proactive suggestions
 */
export const getProactiveSuggestions = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId } = req.params;
        const context = req.body;
        

        const suggestions = await predictiveService.generateProactiveSuggestions(
            agentId as AgentId,
            channelId as ChannelId,
            context
        );

        res.json({
            suggestions: suggestions.slice(0, 5), // Top 5 suggestions
            count: suggestions.length
        });
        
    } catch (error) {
        logger.error(`Error generating suggestions: ${error}`);
        res.status(500).json({
            error: 'Failed to generate suggestions',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Calculate risk score
 */
export const calculateRiskScore = async (req: Request, res: Response) => {
    try {
        const { agentId, channelId, operation } = req.body;
        
        if (!agentId || !channelId || !operation) {
            return res.status(400).json({
                error: 'Agent ID, Channel ID, and operation details are required'
            });
        }


        const riskScore = await predictiveService.calculateRiskScore(
            agentId as AgentId,
            channelId as ChannelId,
            operation
        );

        res.json(riskScore);
        
    } catch (error) {
        logger.error(`Error calculating risk score: ${error}`);
        res.status(500).json({
            error: 'Failed to calculate risk score',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Generate custom report
 */
export const generateCustomReport = async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        

        const report = await analyticsService.generateCustomReport(reportId);

        res.json(report);
        
    } catch (error) {
        logger.error(`Error generating custom report: ${error}`);
        res.status(500).json({
            error: 'Failed to generate custom report',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get model metadata
 */
export const getModelMetadata = async (req: Request, res: Response) => {
    try {

        const models = predictiveService.getModelMetadata();

        res.json({
            models,
            count: models.length
        });
        
    } catch (error) {
        logger.error(`Error fetching model metadata: ${error}`);
        res.status(500).json({
            error: 'Failed to fetch model metadata',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};