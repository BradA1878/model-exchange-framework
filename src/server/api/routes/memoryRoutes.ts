/** Canonical tenant-scoped REST routes for all three MXF memory scopes. */

import { Router } from 'express';
import * as memoryController from '../controllers/memoryController';
import { requireChannelAccess } from '../middleware/channelAuth';
import { requireRelationshipMemoryAccess } from '../middleware/relationshipMemoryAuth';
import { requireResourceAccess } from '../middleware/resourceOwnership';

const router = Router();

router.get(
    '/agents/memory/:keyId',
    requireResourceAccess('agent-key', req => req.params.keyId),
    memoryController.getAgentMemory
);
router.patch(
    '/agents/memory/:keyId',
    requireResourceAccess('agent-key', req => req.params.keyId),
    memoryController.updateAgentMemory
);

router.get(
    '/channels/memory/:channelId',
    requireChannelAccess,
    memoryController.getChannelMemory
);
router.patch(
    '/channels/memory/:channelId',
    requireChannelAccess,
    memoryController.updateChannelMemory
);

router.get(
    '/relationships/memory/:channelId/:agentId1/:agentId2',
    requireChannelAccess,
    requireRelationshipMemoryAccess,
    memoryController.getRelationshipMemory
);
router.patch(
    '/relationships/memory/:channelId/:agentId1/:agentId2',
    requireChannelAccess,
    requireRelationshipMemoryAccess,
    memoryController.updateRelationshipMemory
);

export default router;
