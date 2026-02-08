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
 * ORPAR Control Loop Routes
 *
 * REST API routes for viewing ORPAR (Observation, Reasoning, Planning, Action, Reflection)
 * control loop state and history for agents.
 */

import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { Logger } from '../../../shared/utils/Logger';
import mongoose from 'mongoose';

const logger = new Logger('error', 'OrparRoutes', 'server');
const router = Router();

// Apply authentication to all ORPAR routes
router.use(authenticateUser);

// In-memory ORPAR state storage (mirrors OrparTools.ts)
// Note: In a future version, this would be moved to a shared service
interface AgentOrparState {
    currentPhase: string | null;
    loopId: string;
    cycleCount: number;
    phaseHistory: Array<{
        phase: string;
        timestamp: number;
        content: string;
    }>;
    lastUpdated: number;
    agentId: string;
    channelId: string;
}

// Global map to track ORPAR states (this is populated by the OrparTools)
// For now, we'll expose what we can find in MongoDB memory strata
const activeControlLoops = new Map<string, AgentOrparState>();

/**
 * @route GET /api/orpar/status
 * @desc Get ORPAR system status overview
 * @access Private (JWT required)
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Check for ORPAR-related data in memory strata
        let cognitiveMemoryCount = 0;
        let observationCount = 0;
        let reasoningCount = 0;
        let planCount = 0;
        let reflectionCount = 0;

        try {
            // Try to get counts from memoryentries collection (memory strata)
            const counts = await db.collection('memoryentries').aggregate([
                {
                    $group: {
                        _id: '$content.type',
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();

            counts.forEach(c => {
                if (c._id === 'observation') observationCount = c.count;
                else if (c._id === 'reasoning') reasoningCount = c.count;
                else if (c._id === 'plan') planCount = c.count;
                else if (c._id === 'reflection') reflectionCount = c.count;
            });

            cognitiveMemoryCount = observationCount + reasoningCount + planCount + reflectionCount;
        } catch {
            // Collection may not exist
        }

        // Get unique agents with control loop activity
        let activeAgentsCount = 0;
        try {
            const uniqueAgents = await db.collection('memoryentries').distinct('agentId', {
                'content.type': { $in: ['observation', 'reasoning', 'plan', 'reflection'] }
            });
            activeAgentsCount = uniqueAgents.length;
        } catch {
            // Collection may not exist
        }

        res.json({
            success: true,
            status: {
                enabled: true,
                activeLoops: activeControlLoops.size,
                activeAgents: activeAgentsCount,
                cognitiveMemoryCount,
                phaseCounts: {
                    observations: observationCount,
                    reasonings: reasoningCount,
                    plans: planCount,
                    reflections: reflectionCount
                }
            }
        });
    } catch (error: any) {
        logger.error('Error fetching ORPAR status:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ORPAR status'
        });
    }
});

/**
 * @route GET /api/orpar/active
 * @desc Get all active control loops
 * @access Private (JWT required)
 */
router.get('/active', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get recent cognitive activity by agent to infer active loops
        const recentActivity = await db.collection('memoryentries')
            .aggregate([
                {
                    $match: {
                        'content.type': { $in: ['observation', 'reasoning', 'plan', 'reflection'] },
                        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
                    }
                },
                {
                    $group: {
                        _id: { agentId: '$agentId', channelId: '$channelId' },
                        lastPhase: { $last: '$content.type' },
                        lastActivity: { $max: '$createdAt' },
                        phaseCount: { $sum: 1 }
                    }
                },
                { $sort: { lastActivity: -1 } },
                { $limit: 50 }
            ]).toArray();

        // Get agent details
        const agentIds = recentActivity.map(a => a._id.agentId).filter(Boolean);
        const agents = await db.collection('agents')
            .find({ agentId: { $in: agentIds } })
            .project({ agentId: 1, name: 1 })
            .toArray();

        const agentNameMap = new Map(agents.map(a => [a.agentId, a.name]));

        const activeLoops = recentActivity.map(activity => ({
            agentId: activity._id.agentId,
            agentName: agentNameMap.get(activity._id.agentId) || activity._id.agentId,
            channelId: activity._id.channelId,
            currentPhase: activity.lastPhase,
            lastActivity: activity.lastActivity,
            phaseCount: activity.phaseCount,
            status: 'active'
        }));

        res.json({
            success: true,
            activeLoops,
            total: activeLoops.length
        });
    } catch (error: any) {
        logger.error('Error fetching active loops:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch active loops'
        });
    }
});

/**
 * @route GET /api/orpar/state/:agentId
 * @desc Get current ORPAR phase state for an agent
 * @query channelId (optional) - Filter by channel
 * @access Private (JWT required)
 */
router.get('/state/:agentId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { agentId } = req.params;
        const { channelId } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get agent details
        const agent = await db.collection('agents').findOne({ agentId });

        // Build query
        const query: Record<string, any> = {
            agentId,
            'content.type': { $in: ['observation', 'reasoning', 'plan', 'reflection'] }
        };
        if (channelId) {
            query.channelId = channelId;
        }

        // Get latest phase
        const latestPhase = await db.collection('memoryentries')
            .findOne(query, { sort: { createdAt: -1 } });

        // Get phase counts
        const phaseCounts = await db.collection('memoryentries').aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$content.type',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const phaseCountMap: Record<string, number> = {};
        phaseCounts.forEach(c => {
            phaseCountMap[c._id] = c.count;
        });

        // Calculate cycle count (each complete cycle has all 4 phases)
        const minPhaseCount = Math.min(
            phaseCountMap['observation'] || 0,
            phaseCountMap['reasoning'] || 0,
            phaseCountMap['plan'] || 0,
            phaseCountMap['reflection'] || 0
        );

        res.json({
            success: true,
            state: {
                agentId,
                agentName: agent?.name || agentId,
                channelId: channelId || null,
                currentPhase: latestPhase?.content?.type || null,
                lastPhaseTime: latestPhase?.createdAt,
                phaseCounts: {
                    observation: phaseCountMap['observation'] || 0,
                    reasoning: phaseCountMap['reasoning'] || 0,
                    plan: phaseCountMap['plan'] || 0,
                    reflection: phaseCountMap['reflection'] || 0
                },
                estimatedCycles: minPhaseCount,
                status: latestPhase ? 'active' : 'inactive'
            }
        });
    } catch (error: any) {
        logger.error('Error fetching agent ORPAR state:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ORPAR state'
        });
    }
});

/**
 * @route GET /api/orpar/history/:agentId
 * @desc Get phase transition history for an agent
 * @query channelId (optional) - Filter by channel
 * @query limit (optional) - Limit results (default 50)
 * @access Private (JWT required)
 */
router.get('/history/:agentId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { agentId } = req.params;
        const { channelId, limit = 50 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = {
            agentId,
            'content.type': { $in: ['observation', 'reasoning', 'plan', 'reflection'] }
        };
        if (channelId) {
            query.channelId = channelId;
        }

        // Get phase history
        const history = await db.collection('memoryentries')
            .find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit as string) || 50)
            .project({
                'content.type': 1,
                'content.summary': 1,
                channelId: 1,
                createdAt: 1
            })
            .toArray();

        const transitions = history.map(h => ({
            id: h._id.toString(),
            phase: h.content?.type,
            summary: h.content?.summary || 'No summary',
            channelId: h.channelId,
            timestamp: h.createdAt
        }));

        res.json({
            success: true,
            agentId,
            history: transitions,
            total: transitions.length
        });
    } catch (error: any) {
        logger.error('Error fetching phase history:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch phase history'
        });
    }
});

/**
 * @route GET /api/orpar/observations/:agentId
 * @desc Get observations queue for an agent
 * @query channelId (optional) - Filter by channel
 * @query limit (optional) - Limit results (default 20)
 * @access Private (JWT required)
 */
router.get('/observations/:agentId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { agentId } = req.params;
        const { channelId, limit = 20 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = {
            agentId,
            'content.type': 'observation'
        };
        if (channelId) {
            query.channelId = channelId;
        }

        // Get observations
        const observations = await db.collection('memoryentries')
            .find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit as string) || 20)
            .toArray();

        res.json({
            success: true,
            agentId,
            observations: observations.map(o => ({
                id: o._id.toString(),
                content: o.content,
                channelId: o.channelId,
                createdAt: o.createdAt
            })),
            total: observations.length
        });
    } catch (error: any) {
        logger.error('Error fetching observations:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch observations'
        });
    }
});

/**
 * @route GET /api/orpar/phases/:phase
 * @desc Get all entries of a specific ORPAR phase
 * @query agentId (optional) - Filter by agent
 * @query channelId (optional) - Filter by channel
 * @query limit (optional) - Limit results (default 50)
 * @access Private (JWT required)
 */
router.get('/phases/:phase', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { phase } = req.params;
        const { agentId, channelId, limit = 50 } = req.query;

        // Validate phase
        const validPhases = ['observation', 'reasoning', 'plan', 'reflection'];
        if (!validPhases.includes(phase)) {
            res.status(400).json({
                success: false,
                message: `Invalid phase. Must be one of: ${validPhases.join(', ')}`
            });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = {
            'content.type': phase
        };
        if (agentId) {
            query.agentId = agentId;
        }
        if (channelId) {
            query.channelId = channelId;
        }

        // Get phase entries
        const entries = await db.collection('memoryentries')
            .find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit as string) || 50)
            .toArray();

        // Get agent details for names
        const agentIds = [...new Set(entries.map(e => e.agentId))];
        const agents = await db.collection('agents')
            .find({ agentId: { $in: agentIds } })
            .project({ agentId: 1, name: 1 })
            .toArray();

        const agentNameMap = new Map(agents.map(a => [a.agentId, a.name]));

        res.json({
            success: true,
            phase,
            entries: entries.map(e => ({
                id: e._id.toString(),
                agentId: e.agentId,
                agentName: agentNameMap.get(e.agentId) || e.agentId,
                channelId: e.channelId,
                content: e.content,
                createdAt: e.createdAt
            })),
            total: entries.length
        });
    } catch (error: any) {
        logger.error('Error fetching phase entries:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch phase entries'
        });
    }
});

/**
 * @route GET /api/orpar/agents
 * @desc List agents with ORPAR activity
 * @access Private (JWT required)
 */
router.get('/agents', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get agents with cognitive memory entries
        const agentActivity = await db.collection('memoryentries').aggregate([
            {
                $match: {
                    'content.type': { $in: ['observation', 'reasoning', 'plan', 'reflection'] }
                }
            },
            {
                $group: {
                    _id: '$agentId',
                    lastActivity: { $max: '$createdAt' },
                    totalEntries: { $sum: 1 },
                    phases: { $addToSet: '$content.type' }
                }
            },
            { $sort: { lastActivity: -1 } }
        ]).toArray();

        // Get agent details
        const agentIds = agentActivity.map(a => a._id);
        const agents = await db.collection('agents')
            .find({ agentId: { $in: agentIds } })
            .project({ agentId: 1, name: 1, status: 1 })
            .toArray();

        const agentMap = new Map(agents.map(a => [a.agentId, a]));

        const result = agentActivity.map(activity => {
            const agent = agentMap.get(activity._id);
            return {
                agentId: activity._id,
                agentName: agent?.name || activity._id,
                status: agent?.status || 'unknown',
                lastActivity: activity.lastActivity,
                totalEntries: activity.totalEntries,
                phasesUsed: activity.phases
            };
        });

        res.json({
            success: true,
            agents: result,
            total: result.length
        });
    } catch (error: any) {
        logger.error('Error fetching ORPAR agents:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ORPAR agents'
        });
    }
});

export default router;
