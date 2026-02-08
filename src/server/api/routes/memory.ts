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
 * Memory Browser Routes
 *
 * REST API routes for browsing and searching memories across different scopes.
 * Provides access to agent, channel, and relationship memories, plus cognitive memory.
 */

import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { Logger } from '../../../shared/utils/Logger';
import mongoose from 'mongoose';

const logger = new Logger('error', 'MemoryBrowserRoutes', 'server');
const router = Router();

// Apply authentication to all memory routes
router.use(authenticateUser);

/**
 * @route GET /api/memory/overview
 * @desc Get memory system overview with counts and statistics
 * @access Private (JWT required)
 */
router.get('/overview', async (req: Request, res: Response) => {
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

        // Get counts from all memory collections
        const [agentMemoryCount, channelMemoryCount, relationshipMemoryCount] = await Promise.all([
            db.collection('agentmemories').countDocuments(),
            db.collection('channelmemories').countDocuments(),
            db.collection('relationshipmemories').countDocuments()
        ]);

        // Get Q-value statistics for agent memories
        const agentQValueStats = await db.collection('agentmemories').aggregate([
            {
                $group: {
                    _id: null,
                    avgQValue: { $avg: '$utility.qValue' },
                    maxQValue: { $max: '$utility.qValue' },
                    totalRetrievals: { $sum: '$utility.retrievalCount' }
                }
            }
        ]).toArray();

        // Get Q-value statistics for channel memories
        const channelQValueStats = await db.collection('channelmemories').aggregate([
            {
                $group: {
                    _id: null,
                    avgQValue: { $avg: '$utility.qValue' },
                    maxQValue: { $max: '$utility.qValue' },
                    totalRetrievals: { $sum: '$utility.retrievalCount' }
                }
            }
        ]).toArray();

        // Get recent activity
        const recentAgentMemories = await db.collection('agentmemories')
            .find({})
            .sort({ updatedAt: -1 })
            .limit(5)
            .project({ agentId: 1, updatedAt: 1 })
            .toArray();

        const recentChannelMemories = await db.collection('channelmemories')
            .find({})
            .sort({ updatedAt: -1 })
            .limit(5)
            .project({ channelId: 1, updatedAt: 1 })
            .toArray();

        res.json({
            success: true,
            overview: {
                counts: {
                    agentMemories: agentMemoryCount,
                    channelMemories: channelMemoryCount,
                    relationshipMemories: relationshipMemoryCount,
                    total: agentMemoryCount + channelMemoryCount + relationshipMemoryCount
                },
                qValueStats: {
                    agent: agentQValueStats[0] || { avgQValue: 0.5, maxQValue: 0.5, totalRetrievals: 0 },
                    channel: channelQValueStats[0] || { avgQValue: 0.5, maxQValue: 0.5, totalRetrievals: 0 }
                },
                recentActivity: {
                    agentMemories: recentAgentMemories,
                    channelMemories: recentChannelMemories
                }
            }
        });
    } catch (error: any) {
        logger.error('Error fetching memory overview:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch memory overview'
        });
    }
});

/**
 * @route GET /api/memory/agents
 * @desc List all agents with memory data
 * @query limit (optional) - Limit results (default 50)
 * @access Private (JWT required)
 */
router.get('/agents', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { limit = 50 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get all agent memories with basic info
        const agentMemories = await db.collection('agentmemories')
            .find({})
            .project({
                agentId: 1,
                persistenceLevel: 1,
                'utility.qValue': 1,
                'utility.retrievalCount': 1,
                'conversationHistory': { $slice: -1 },
                createdAt: 1,
                updatedAt: 1
            })
            .sort({ updatedAt: -1 })
            .limit(parseInt(limit as string) || 50)
            .toArray();

        // Get agent details for name lookup
        const agentIds = agentMemories.map(m => m.agentId).filter(Boolean);
        const agents = await db.collection('agents')
            .find({ agentId: { $in: agentIds } })
            .project({ agentId: 1, name: 1 })
            .toArray();

        const agentNameMap = new Map(agents.map(a => [a.agentId, a.name]));

        const result = agentMemories.map(mem => ({
            id: mem._id.toString(),
            agentId: mem.agentId,
            agentName: agentNameMap.get(mem.agentId) || mem.agentId,
            persistenceLevel: mem.persistenceLevel || 'persistent',
            qValue: mem.utility?.qValue || 0.5,
            retrievalCount: mem.utility?.retrievalCount || 0,
            lastMessage: mem.conversationHistory?.[0]?.content?.substring(0, 100),
            createdAt: mem.createdAt,
            updatedAt: mem.updatedAt
        }));

        res.json({
            success: true,
            agentMemories: result,
            total: result.length
        });
    } catch (error: any) {
        logger.error('Error fetching agent memories:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch agent memories'
        });
    }
});

/**
 * @route GET /api/memory/agents/:agentId
 * @desc Get detailed memory for a specific agent
 * @access Private (JWT required)
 */
router.get('/agents/:agentId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { agentId } = req.params;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get agent memory
        const agentMemory = await db.collection('agentmemories').findOne({ agentId });

        if (!agentMemory) {
            res.status(404).json({ success: false, message: 'Agent memory not found' });
            return;
        }

        // Get agent details
        const agent = await db.collection('agents').findOne({ agentId });

        res.json({
            success: true,
            memory: {
                id: agentMemory._id.toString(),
                agentId: agentMemory.agentId,
                agentName: agent?.name || agentId,
                persistenceLevel: agentMemory.persistenceLevel || 'persistent',
                notes: agentMemory.notes || {},
                customData: agentMemory.customData || {},
                conversationHistory: agentMemory.conversationHistory || [],
                cognitiveMemory: agentMemory.cognitiveMemory || {
                    observationIds: [],
                    reasoningIds: [],
                    planIds: [],
                    reflectionIds: []
                },
                utility: agentMemory.utility || {
                    qValue: 0.5,
                    retrievalCount: 0,
                    successCount: 0,
                    failureCount: 0
                },
                createdAt: agentMemory.createdAt,
                updatedAt: agentMemory.updatedAt
            }
        });
    } catch (error: any) {
        logger.error('Error fetching agent memory:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch agent memory'
        });
    }
});

/**
 * @route GET /api/memory/channels
 * @desc List all channels with memory data
 * @query limit (optional) - Limit results (default 50)
 * @access Private (JWT required)
 */
router.get('/channels', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { limit = 50 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get all channel memories with basic info
        const channelMemories = await db.collection('channelmemories')
            .find({})
            .project({
                channelId: 1,
                persistenceLevel: 1,
                'utility.qValue': 1,
                'utility.retrievalCount': 1,
                'sharedState': 1,
                createdAt: 1,
                updatedAt: 1
            })
            .sort({ updatedAt: -1 })
            .limit(parseInt(limit as string) || 50)
            .toArray();

        // Get channel details for name lookup
        const channelIds = channelMemories.map(m => m.channelId).filter(Boolean);
        const channels = await db.collection('channels')
            .find({ channelId: { $in: channelIds } })
            .project({ channelId: 1, name: 1 })
            .toArray();

        const channelNameMap = new Map(channels.map(c => [c.channelId, c.name]));

        const result = channelMemories.map(mem => ({
            id: mem._id.toString(),
            channelId: mem.channelId,
            channelName: channelNameMap.get(mem.channelId) || mem.channelId,
            persistenceLevel: mem.persistenceLevel || 'persistent',
            qValue: mem.utility?.qValue || 0.5,
            retrievalCount: mem.utility?.retrievalCount || 0,
            sharedStateKeys: Object.keys(mem.sharedState || {}),
            createdAt: mem.createdAt,
            updatedAt: mem.updatedAt
        }));

        res.json({
            success: true,
            channelMemories: result,
            total: result.length
        });
    } catch (error: any) {
        logger.error('Error fetching channel memories:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch channel memories'
        });
    }
});

/**
 * @route GET /api/memory/channels/:channelId
 * @desc Get detailed memory for a specific channel
 * @access Private (JWT required)
 */
router.get('/channels/:channelId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.params;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get channel memory
        const channelMemory = await db.collection('channelmemories').findOne({ channelId });

        if (!channelMemory) {
            res.status(404).json({ success: false, message: 'Channel memory not found' });
            return;
        }

        // Get channel details
        const channel = await db.collection('channels').findOne({ channelId });

        res.json({
            success: true,
            memory: {
                id: channelMemory._id.toString(),
                channelId: channelMemory.channelId,
                channelName: channel?.name || channelId,
                persistenceLevel: channelMemory.persistenceLevel || 'persistent',
                notes: channelMemory.notes || {},
                sharedState: channelMemory.sharedState || {},
                customData: channelMemory.customData || {},
                conversationHistory: channelMemory.conversationHistory || [],
                sharedCognitiveInsights: channelMemory.sharedCognitiveInsights || {
                    systemSummaries: [],
                    topicExtractions: [],
                    collaborativeReflections: []
                },
                utility: channelMemory.utility || {
                    qValue: 0.5,
                    retrievalCount: 0,
                    successCount: 0,
                    failureCount: 0
                },
                createdAt: channelMemory.createdAt,
                updatedAt: channelMemory.updatedAt
            }
        });
    } catch (error: any) {
        logger.error('Error fetching channel memory:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch channel memory'
        });
    }
});

/**
 * @route GET /api/memory/relationships
 * @desc List all relationship memories
 * @query limit (optional) - Limit results (default 50)
 * @access Private (JWT required)
 */
router.get('/relationships', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { limit = 50 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get all relationship memories
        const relationshipMemories = await db.collection('relationshipmemories')
            .find({})
            .project({
                agentId1: 1,
                agentId2: 1,
                channelId: 1,
                'interactionHistory': { $slice: -3 },
                createdAt: 1,
                updatedAt: 1
            })
            .sort({ updatedAt: -1 })
            .limit(parseInt(limit as string) || 50)
            .toArray();

        // Get agent details for name lookup
        const allAgentIds = new Set<string>();
        relationshipMemories.forEach(m => {
            if (m.agentId1) allAgentIds.add(m.agentId1);
            if (m.agentId2) allAgentIds.add(m.agentId2);
        });

        const agents = await db.collection('agents')
            .find({ agentId: { $in: Array.from(allAgentIds) } })
            .project({ agentId: 1, name: 1 })
            .toArray();

        const agentNameMap = new Map(agents.map(a => [a.agentId, a.name]));

        const result = relationshipMemories.map(mem => ({
            id: mem._id.toString(),
            agentId1: mem.agentId1,
            agent1Name: agentNameMap.get(mem.agentId1) || mem.agentId1,
            agentId2: mem.agentId2,
            agent2Name: agentNameMap.get(mem.agentId2) || mem.agentId2,
            channelId: mem.channelId,
            interactionCount: mem.interactionHistory?.length || 0,
            lastInteraction: mem.interactionHistory?.[0],
            createdAt: mem.createdAt,
            updatedAt: mem.updatedAt
        }));

        res.json({
            success: true,
            relationshipMemories: result,
            total: result.length
        });
    } catch (error: any) {
        logger.error('Error fetching relationship memories:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch relationship memories'
        });
    }
});

/**
 * @route GET /api/memory/search
 * @desc Search across all memories
 * @query q (required) - Search query
 * @query scope (optional) - 'agent', 'channel', 'relationship', or 'all'
 * @query limit (optional) - Limit results (default 20)
 * @access Private (JWT required)
 */
router.get('/search', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { q, scope = 'all', limit = 20 } = req.query;

        if (!q) {
            res.status(400).json({ success: false, message: 'Search query is required' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        const results: any = {
            agentMemories: [],
            channelMemories: [],
            relationshipMemories: []
        };

        const searchRegex = { $regex: q, $options: 'i' };
        const limitNum = parseInt(limit as string) || 20;

        // Search agent memories
        if (scope === 'all' || scope === 'agent') {
            const agentResults = await db.collection('agentmemories')
                .find({
                    $or: [
                        { agentId: searchRegex },
                        { 'notes': { $exists: true } },
                        { 'customData': { $exists: true } }
                    ]
                })
                .project({
                    agentId: 1,
                    'utility.qValue': 1,
                    updatedAt: 1
                })
                .limit(limitNum)
                .toArray();

            results.agentMemories = agentResults.map(m => ({
                id: m._id.toString(),
                agentId: m.agentId,
                qValue: m.utility?.qValue || 0.5,
                updatedAt: m.updatedAt,
                scope: 'agent'
            }));
        }

        // Search channel memories
        if (scope === 'all' || scope === 'channel') {
            const channelResults = await db.collection('channelmemories')
                .find({
                    $or: [
                        { channelId: searchRegex },
                        { 'notes': { $exists: true } },
                        { 'sharedState': { $exists: true } }
                    ]
                })
                .project({
                    channelId: 1,
                    'utility.qValue': 1,
                    updatedAt: 1
                })
                .limit(limitNum)
                .toArray();

            results.channelMemories = channelResults.map(m => ({
                id: m._id.toString(),
                channelId: m.channelId,
                qValue: m.utility?.qValue || 0.5,
                updatedAt: m.updatedAt,
                scope: 'channel'
            }));
        }

        // Search relationship memories
        if (scope === 'all' || scope === 'relationship') {
            const relationshipResults = await db.collection('relationshipmemories')
                .find({
                    $or: [
                        { agentId1: searchRegex },
                        { agentId2: searchRegex },
                        { channelId: searchRegex }
                    ]
                })
                .project({
                    agentId1: 1,
                    agentId2: 1,
                    channelId: 1,
                    updatedAt: 1
                })
                .limit(limitNum)
                .toArray();

            results.relationshipMemories = relationshipResults.map(m => ({
                id: m._id.toString(),
                agentId1: m.agentId1,
                agentId2: m.agentId2,
                channelId: m.channelId,
                updatedAt: m.updatedAt,
                scope: 'relationship'
            }));
        }

        res.json({
            success: true,
            query: q,
            results,
            total: results.agentMemories.length + results.channelMemories.length + results.relationshipMemories.length
        });
    } catch (error: any) {
        logger.error('Error searching memories:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to search memories'
        });
    }
});

/**
 * @route GET /api/memory/cognitive/:agentId
 * @desc Get ORPAR cognitive memory for an agent
 * @query channelId (optional) - Filter by channel
 * @access Private (JWT required)
 */
router.get('/cognitive/:agentId', async (req: Request, res: Response) => {
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

        // Get agent memory with cognitive data
        const agentMemory = await db.collection('agentmemories').findOne({ agentId });

        const cognitiveMemory = agentMemory?.cognitiveMemory || {
            observationIds: [],
            reasoningIds: [],
            planIds: [],
            reflectionIds: []
        };

        // Get memory entries from memory strata if available
        const memoryQuery: Record<string, any> = { agentId };
        if (channelId) {
            memoryQuery.channelId = channelId;
        }

        // Try to get from memoryentries collection (memory strata)
        let observations: any[] = [];
        let reasonings: any[] = [];
        let plans: any[] = [];
        let reflections: any[] = [];

        try {
            observations = await db.collection('memoryentries')
                .find({ ...memoryQuery, 'content.type': 'observation' })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

            reasonings = await db.collection('memoryentries')
                .find({ ...memoryQuery, 'content.type': 'reasoning' })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

            plans = await db.collection('memoryentries')
                .find({ ...memoryQuery, 'content.type': 'plan' })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();

            reflections = await db.collection('memoryentries')
                .find({ ...memoryQuery, 'content.type': 'reflection' })
                .sort({ createdAt: -1 })
                .limit(10)
                .toArray();
        } catch {
            // Collection may not exist, return empty arrays
        }

        res.json({
            success: true,
            agentId,
            channelId: channelId || null,
            cognitiveMemory: {
                summary: {
                    observationCount: cognitiveMemory.observationIds?.length || observations.length,
                    reasoningCount: cognitiveMemory.reasoningIds?.length || reasonings.length,
                    planCount: cognitiveMemory.planIds?.length || plans.length,
                    reflectionCount: cognitiveMemory.reflectionIds?.length || reflections.length
                },
                observations: observations.map(o => ({
                    id: o._id.toString(),
                    content: o.content,
                    createdAt: o.createdAt
                })),
                reasonings: reasonings.map(r => ({
                    id: r._id.toString(),
                    content: r.content,
                    createdAt: r.createdAt
                })),
                plans: plans.map(p => ({
                    id: p._id.toString(),
                    content: p.content,
                    createdAt: p.createdAt
                })),
                reflections: reflections.map(r => ({
                    id: r._id.toString(),
                    content: r.content,
                    createdAt: r.createdAt
                }))
            }
        });
    } catch (error: any) {
        logger.error('Error fetching cognitive memory:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch cognitive memory'
        });
    }
});

/**
 * @route GET /api/memory/high-utility
 * @desc Get memories ranked by Q-value (utility)
 * @query scope (optional) - 'agent', 'channel', or 'all'
 * @query limit (optional) - Limit results (default 20)
 * @access Private (JWT required)
 */
router.get('/high-utility', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { scope = 'all', limit = 20 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        const limitNum = parseInt(limit as string) || 20;
        const results: any[] = [];

        // Get high utility agent memories
        if (scope === 'all' || scope === 'agent') {
            const agentMemories = await db.collection('agentmemories')
                .find({})
                .sort({ 'utility.qValue': -1 })
                .limit(limitNum)
                .project({
                    agentId: 1,
                    'utility.qValue': 1,
                    'utility.retrievalCount': 1,
                    'utility.successCount': 1,
                    updatedAt: 1
                })
                .toArray();

            agentMemories.forEach(m => {
                results.push({
                    id: m._id.toString(),
                    scope: 'agent',
                    identifier: m.agentId,
                    qValue: m.utility?.qValue || 0.5,
                    retrievalCount: m.utility?.retrievalCount || 0,
                    successCount: m.utility?.successCount || 0,
                    updatedAt: m.updatedAt
                });
            });
        }

        // Get high utility channel memories
        if (scope === 'all' || scope === 'channel') {
            const channelMemories = await db.collection('channelmemories')
                .find({})
                .sort({ 'utility.qValue': -1 })
                .limit(limitNum)
                .project({
                    channelId: 1,
                    'utility.qValue': 1,
                    'utility.retrievalCount': 1,
                    'utility.successCount': 1,
                    updatedAt: 1
                })
                .toArray();

            channelMemories.forEach(m => {
                results.push({
                    id: m._id.toString(),
                    scope: 'channel',
                    identifier: m.channelId,
                    qValue: m.utility?.qValue || 0.5,
                    retrievalCount: m.utility?.retrievalCount || 0,
                    successCount: m.utility?.successCount || 0,
                    updatedAt: m.updatedAt
                });
            });
        }

        // Sort combined results by Q-value
        results.sort((a, b) => b.qValue - a.qValue);

        res.json({
            success: true,
            memories: results.slice(0, limitNum)
        });
    } catch (error: any) {
        logger.error('Error fetching high-utility memories:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch high-utility memories'
        });
    }
});

export default router;
