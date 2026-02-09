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
 * Knowledge Graph Routes
 *
 * REST API routes for browsing and querying the Knowledge Graph.
 * Exposes entities, relationships, graph queries, and high-utility data.
 */

import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { Logger } from '../../../shared/utils/Logger';
import { KnowledgeGraphService } from '../../../shared/services/kg/KnowledgeGraphService';
import { EntityType, RelationshipType } from '../../../shared/types/KnowledgeGraphTypes';
import mongoose from 'mongoose';

const logger = new Logger('error', 'KnowledgeGraphRoutes', 'server');
const router = Router();

// Apply authentication to all KG routes
router.use(authenticateUser);

/**
 * @route GET /api/kg/entities
 * @desc List entities with optional filtering
 * @query channelId (optional) - Filter by channel
 * @query type (optional) - Filter by entity type
 * @query search (optional) - Search by name/alias
 * @query minQValue (optional) - Minimum Q-value filter
 * @query limit (optional) - Limit results (default 100)
 * @query offset (optional) - Offset for pagination
 * @access Private (JWT required)
 */
router.get('/entities', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId, type, search, minQValue, limit = 100, offset = 0 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = { merged: { $ne: true } };

        if (channelId) {
            query.channelId = channelId;
        }
        if (type) {
            query.type = type;
        }
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { aliases: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }
        if (minQValue) {
            query['utility.qValue'] = { $gte: parseFloat(minQValue as string) };
        }

        // Fetch entities
        const entities = await db.collection('entities')
            .find(query)
            .sort({ 'utility.qValue': -1, updatedAt: -1 })
            .skip(parseInt(offset as string) || 0)
            .limit(parseInt(limit as string) || 100)
            .toArray();

        // Get total count
        const total = await db.collection('entities').countDocuments(query);

        // Get type distribution
        const typeDistribution = await db.collection('entities').aggregate([
            { $match: { merged: { $ne: true } } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({
            success: true,
            entities: entities.map(e => ({
                ...e,
                id: e._id.toString()
            })),
            total,
            typeDistribution,
            pagination: {
                offset: parseInt(offset as string) || 0,
                limit: parseInt(limit as string) || 100,
                hasMore: (parseInt(offset as string) || 0) + entities.length < total
            }
        });
    } catch (error: any) {
        logger.error('Error fetching entities:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch entities'
        });
    }
});

/**
 * @route GET /api/kg/entities/:entityId
 * @desc Get entity by ID with its relationships
 * @access Private (JWT required)
 */
router.get('/entities/:entityId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { entityId } = req.params;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch entity
        let entity;
        try {
            entity = await db.collection('entities').findOne({
                _id: new mongoose.Types.ObjectId(entityId)
            });
        } catch {
            // Try finding by custom id field
            entity = await db.collection('entities').findOne({ id: entityId });
        }

        if (!entity) {
            res.status(404).json({ success: false, message: 'Entity not found' });
            return;
        }

        // Fetch relationships involving this entity
        const relationships = await db.collection('relationships')
            .find({
                $or: [
                    { fromEntityId: entityId },
                    { toEntityId: entityId }
                ]
            })
            .toArray();

        // Fetch related entity IDs
        const relatedEntityIds = new Set<string>();
        relationships.forEach(r => {
            if (r.fromEntityId !== entityId) relatedEntityIds.add(r.fromEntityId);
            if (r.toEntityId !== entityId) relatedEntityIds.add(r.toEntityId);
        });

        // Fetch related entities
        const relatedEntities = await db.collection('entities')
            .find({
                $or: [
                    { _id: { $in: Array.from(relatedEntityIds).map(id => {
                        try { return new mongoose.Types.ObjectId(id); } catch { return null; }
                    }).filter((id): id is mongoose.Types.ObjectId => id !== null) } },
                    { id: { $in: Array.from(relatedEntityIds) } }
                ]
            })
            .toArray();

        res.json({
            success: true,
            entity: { ...entity, id: entity._id.toString() },
            relationships: relationships.map(r => ({ ...r, id: r._id.toString() })),
            relatedEntities: relatedEntities.map(e => ({ ...e, id: e._id.toString() }))
        });
    } catch (error: any) {
        logger.error('Error fetching entity:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch entity'
        });
    }
});

/**
 * @route GET /api/kg/relationships
 * @desc List relationships with optional filtering
 * @query channelId (optional) - Filter by channel
 * @query type (optional) - Filter by relationship type
 * @query entityId (optional) - Filter relationships involving this entity
 * @query minConfidence (optional) - Minimum confidence filter
 * @query limit (optional) - Limit results (default 100)
 * @access Private (JWT required)
 */
router.get('/relationships', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId, type, entityId, minConfidence, limit = 100 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = {};

        if (channelId) {
            query.channelId = channelId;
        }
        if (type) {
            query.type = type;
        }
        if (entityId) {
            query.$or = [
                { fromEntityId: entityId },
                { toEntityId: entityId }
            ];
        }
        if (minConfidence) {
            query.confidence = { $gte: parseFloat(minConfidence as string) };
        }

        // Fetch relationships
        const relationships = await db.collection('relationships')
            .find(query)
            .sort({ confidence: -1, updatedAt: -1 })
            .limit(parseInt(limit as string) || 100)
            .toArray();

        // Get total count
        const total = await db.collection('relationships').countDocuments(query);

        // Get type distribution
        const typeDistribution = await db.collection('relationships').aggregate([
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        res.json({
            success: true,
            relationships: relationships.map(r => ({ ...r, id: r._id.toString() })),
            total,
            typeDistribution
        });
    } catch (error: any) {
        logger.error('Error fetching relationships:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch relationships'
        });
    }
});

/**
 * @route GET /api/kg/graph
 * @desc Get subgraph for visualization
 * @query channelId (required) - Channel to get graph for
 * @query entityIds (optional) - Comma-separated entity IDs to center graph on
 * @query depth (optional) - How many hops from center entities (default 2)
 * @query limit (optional) - Max entities to return (default 50)
 * @access Private (JWT required)
 */
router.get('/graph', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId, entityIds, depth = 2, limit = 50 } = req.query;

        if (!channelId) {
            res.status(400).json({ success: false, message: 'channelId is required' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        let entities: any[];
        let relationships: any[];

        if (entityIds) {
            // Center on specific entities
            const centerIds = (entityIds as string).split(',');

            // Get center entities
            const centerEntities = await db.collection('entities')
                .find({
                    channelId,
                    $or: [
                        { _id: { $in: centerIds.map(id => {
                            try { return new mongoose.Types.ObjectId(id); } catch { return null; }
                        }).filter((id): id is mongoose.Types.ObjectId => id !== null) } },
                        { id: { $in: centerIds } }
                    ]
                })
                .toArray();

            // Get relationships from center
            relationships = await db.collection('relationships')
                .find({
                    channelId,
                    $or: [
                        { fromEntityId: { $in: centerIds } },
                        { toEntityId: { $in: centerIds } }
                    ]
                })
                .limit(parseInt(limit as string) * 2)
                .toArray();

            // Get connected entities
            const connectedIds = new Set<string>();
            relationships.forEach(r => {
                connectedIds.add(r.fromEntityId);
                connectedIds.add(r.toEntityId);
            });

            entities = await db.collection('entities')
                .find({
                    channelId,
                    merged: { $ne: true },
                    $or: [
                        { _id: { $in: Array.from(connectedIds).map(id => {
                            try { return new mongoose.Types.ObjectId(id); } catch { return null; }
                        }).filter((id): id is mongoose.Types.ObjectId => id !== null) } },
                        { id: { $in: Array.from(connectedIds) } }
                    ]
                })
                .limit(parseInt(limit as string))
                .toArray();
        } else {
            // Get top entities by Q-value for the channel
            entities = await db.collection('entities')
                .find({ channelId, merged: { $ne: true } })
                .sort({ 'utility.qValue': -1 })
                .limit(parseInt(limit as string))
                .toArray();

            const entityIds = entities.map(e => e._id.toString());

            // Get relationships between these entities
            relationships = await db.collection('relationships')
                .find({
                    channelId,
                    fromEntityId: { $in: entityIds },
                    toEntityId: { $in: entityIds }
                })
                .toArray();
        }

        // Format for visualization (nodes and edges)
        const nodes = entities.map(e => ({
            id: e._id.toString(),
            label: e.name,
            type: e.type,
            qValue: e.utility?.qValue || 0.5,
            confidence: e.confidence || 1,
            properties: e.properties || {}
        }));

        const edges = relationships.map(r => ({
            id: r._id.toString(),
            source: r.fromEntityId,
            target: r.toEntityId,
            type: r.type,
            label: r.label || r.type,
            weight: r.weight || 1,
            confidence: r.confidence || 1
        }));

        res.json({
            success: true,
            nodes,
            edges,
            stats: {
                nodeCount: nodes.length,
                edgeCount: edges.length
            }
        });
    } catch (error: any) {
        logger.error('Error fetching graph:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch graph'
        });
    }
});

/**
 * @route GET /api/kg/high-utility
 * @desc Get highest Q-value entities
 * @query channelId (optional) - Filter by channel
 * @query limit (optional) - Number of entities (default 20)
 * @access Private (JWT required)
 */
router.get('/high-utility', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId, limit = 20 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query
        const query: Record<string, any> = { merged: { $ne: true } };
        if (channelId) {
            query.channelId = channelId;
        }

        // Fetch high utility entities
        const entities = await db.collection('entities')
            .find(query)
            .sort({ 'utility.qValue': -1 })
            .limit(parseInt(limit as string) || 20)
            .toArray();

        // Calculate statistics
        const stats = await db.collection('entities').aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    avgQValue: { $avg: '$utility.qValue' },
                    maxQValue: { $max: '$utility.qValue' },
                    minQValue: { $min: '$utility.qValue' },
                    totalRetrievals: { $sum: '$utility.retrievalCount' },
                    totalSuccesses: { $sum: '$utility.successCount' }
                }
            }
        ]).toArray();

        res.json({
            success: true,
            entities: entities.map(e => ({
                ...e,
                id: e._id.toString()
            })),
            stats: stats[0] || {
                avgQValue: 0.5,
                maxQValue: 0.5,
                minQValue: 0.5,
                totalRetrievals: 0,
                totalSuccesses: 0
            }
        });
    } catch (error: any) {
        logger.error('Error fetching high-utility entities:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch high-utility entities'
        });
    }
});

/**
 * @route GET /api/kg/stats
 * @desc Get Knowledge Graph statistics
 * @query channelId (optional) - Filter by channel
 * @access Private (JWT required)
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        const entityQuery: Record<string, any> = { merged: { $ne: true } };
        const relationshipQuery: Record<string, any> = {};

        if (channelId) {
            entityQuery.channelId = channelId;
            relationshipQuery.channelId = channelId;
        }

        // Get counts
        const [entityCount, relationshipCount] = await Promise.all([
            db.collection('entities').countDocuments(entityQuery),
            db.collection('relationships').countDocuments(relationshipQuery)
        ]);

        // Get type distributions
        const [entityTypes, relationshipTypes] = await Promise.all([
            db.collection('entities').aggregate([
                { $match: entityQuery },
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]).toArray(),
            db.collection('relationships').aggregate([
                { $match: relationshipQuery },
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]).toArray()
        ]);

        // Get Q-value statistics
        const qValueStats = await db.collection('entities').aggregate([
            { $match: entityQuery },
            {
                $group: {
                    _id: null,
                    avgQValue: { $avg: '$utility.qValue' },
                    maxQValue: { $max: '$utility.qValue' },
                    minQValue: { $min: '$utility.qValue' },
                    avgConfidence: { $avg: '$confidence' }
                }
            }
        ]).toArray();

        // Get recent activity
        const recentEntities = await db.collection('entities')
            .find(entityQuery)
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

        res.json({
            success: true,
            stats: {
                entityCount,
                relationshipCount,
                entityTypes,
                relationshipTypes,
                qValueStats: qValueStats[0] || {
                    avgQValue: 0.5,
                    maxQValue: 0.5,
                    minQValue: 0.5,
                    avgConfidence: 1
                },
                recentEntities: recentEntities.map(e => ({
                    id: e._id.toString(),
                    name: e.name,
                    type: e.type,
                    createdAt: e.createdAt
                }))
            }
        });
    } catch (error: any) {
        logger.error('Error fetching KG stats:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch KG stats'
        });
    }
});

/**
 * @route GET /api/kg/types
 * @desc Get available entity and relationship types
 * @access Private (JWT required)
 */
router.get('/types', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        res.json({
            success: true,
            entityTypes: Object.values(EntityType),
            relationshipTypes: Object.values(RelationshipType)
        });
    } catch (error: any) {
        logger.error('Error fetching KG types:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch KG types'
        });
    }
});

export default router;
