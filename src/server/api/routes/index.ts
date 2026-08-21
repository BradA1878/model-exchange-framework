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
 * @documentation https://mxf-dev.github.io/mxf/
 */

import express from 'express';
import { createRequire } from 'module';
import * as agentController from '../controllers/agentController';
import * as channelController from '../controllers/channelController';
import { userController } from '../controllers/userController';
import {
    requireChannelAccess,
    requireChannelDeletionOwner,
    requireChannelOwner
} from '../middleware/channelAuth';
import { requireAdmin } from '../middleware/dualAuth';
import {
    requireResourceAccess,
    requireResourceOwner,
    requireUserPrincipal
} from '../middleware/resourceOwnership';
import { createAuthRateLimiter } from '../middleware/rateLimit';
import { isWebhookEnabled } from '../middleware/webhookAuth';
import { isDemoApiEnabled, requireUnsafeStdioMcpEnabled } from '../middleware/runtimeFeaturePolicy';
import { Logger } from '@mxf-dev/core/utils/Logger';
import mcpRoutes from './mcp';
import hybridMcpRoutes from './hybridMcp';
import channelContextRoutes from './channelContextRoutes';
import documentRoutes from './documents';
import taskRoutes from './tasks';
import agentLifecycleRoutes from './agentLifecycle';
import bulkRoutes from './bulk';
import channelKeyRoutes from './channelKeyRoutes';
import agentKeyRoutes from './agentKeyRoutes';
import dashboardRoutes from './dashboard';
import analyticsRoutes from './analytics';
import configRoutes from './config';
import taskEffectivenessRoutes from './taskEffectiveness';
import demoRoutes from './demoRoutes';
import knowledgeGraphRoutes from './knowledgeGraph';
import dagRoutes from './dag';
import memoryBrowserRoutes from './memory';
import memoryRoutes from './memoryRoutes';
import orparRoutes from './orpar';
import tokenRoutes from './tokenRoutes';
import { getDocumentsByChannel } from '../controllers/documentController';

const router = express.Router();
const logger = new Logger('info', 'ApiRoutes', 'server');
const loadRouteModule = createRequire(__filename);

// Protected routes (require authentication)
// Middleware will be added by the server when routes are registered

// Throttle the credential endpoints. They are the only routes an
// unauthenticated caller can reach, which makes them the brute-force surface.
const authRateLimiter = createAuthRateLimiter();

// User routes (authentication)
router.post('/users/register', authRateLimiter, userController.register);
router.post('/users/login', authRateLimiter, userController.login);
router.post('/users/magic-link', authRateLimiter, userController.requestMagicLink);
router.post('/users/magic-link/verify', authRateLimiter, userController.verifyMagicLink);
router.get('/users/profile', userController.getProfile);
router.patch('/users/profile', userController.updateProfile);
router.delete('/users/profile', userController.deleteProfile);
router.get('/users', userController.getAllUsers);
router.patch('/users/role', userController.updateUserRole);
router.patch('/users/status', userController.updateUserStatus);

// Agent routes
router.get('/agents', requireUserPrincipal, agentController.getAgents);
router.post('/agents', requireUserPrincipal, agentController.createAgent);
router.get('/agents/services/:serviceType', requireUserPrincipal, agentController.getAgentsByService);
router.get('/agents/:agentId', requireResourceOwner('agent', req => req.params.agentId), agentController.getAgentById);
router.put('/agents/:agentId', requireResourceOwner('agent', req => req.params.agentId), agentController.updateAgent);
router.delete('/agents/:agentId', requireResourceOwner('agent', req => req.params.agentId), agentController.deleteAgent);

// Agent context routes (using keyId as lookup)
router.get('/agents/context/:keyId', requireResourceAccess('agent-key', req => req.params.keyId), agentController.getAgentContext);
router.patch('/agents/context/:keyId', requireResourceOwner('agent-key', req => req.params.keyId), agentController.updateAgentContext);

// Agent, channel, and relationship memory share one canonical service boundary.
router.use('/', memoryRoutes);

// Channel routes - Core CRUD operations
//
// Every route below that names a channel runs through requireChannelAccess: a
// user must own the channel, an agent's key must be bound to it. Without that
// gate, knowing a channelId was enough to rename, delete, or read any channel
// in the system — getChannelById and getAllChannels already filtered by
// createdBy, so the write paths were the ones that never checked.
router.get('/channels', requireUserPrincipal, channelController.getAllChannels);
router.post('/channels', requireUserPrincipal, channelController.registerChannel);

// Static discovery routes must precede /channels/:channelId. In particular,
// Express otherwise treats the literal "search" as a channel id and never
// reaches the search controller.
router.get('/channels/search', channelController.searchChannels);
router.get('/channels/discover/:channelId', channelController.findByChannelId);
router.get('/channels/domain/:domain', channelController.listChannelsByDomain);

router.get('/channels/:channelId', requireChannelOwner, channelController.getChannelById);
router.put('/channels/:channelId', requireChannelOwner, channelController.updateChannel);
router.delete('/channels/:channelId', requireChannelDeletionOwner, channelController.deleteChannel);
router.get('/channels/:channelId/documents', requireChannelAccess, getDocumentsByChannel);

// Channel additional operations
router.post('/channels/workspace', requireUserPrincipal, channelController.createChannelWorkspace);
router.get('/channels/verify/:token', channelController.verifyChannel);

// Channel MCP server management routes
router.post(
    '/channels/:channelId/mcp-servers',
    requireAdmin,
    requireUnsafeStdioMcpEnabled,
    requireChannelOwner,
    channelController.registerChannelMcpServer
);
// Channel MCP configs may contain process commands, environment variables, and
// credentials. Starting, inspecting, and stopping those server processes are
// one administrative capability; channel ownership alone is not sufficient.
router.get(
    '/channels/:channelId/mcp-servers',
    requireAdmin,
    requireChannelOwner,
    channelController.listChannelMcpServers
);
router.delete(
    '/channels/:channelId/mcp-servers/:serverId',
    requireAdmin,
    requireChannelOwner,
    channelController.unregisterChannelMcpServer
);

// Task management routes
router.use('/tasks', taskRoutes);

// Agent lifecycle management routes (separate path to avoid conflicts)
router.use('/agents', agentLifecycleRoutes);

// These routers expose cross-channel operational views or accept bulk/global
// mutations. Their controllers are not tenant-scoped, so allowing any valid
// user or channel key to reach them turns authentication into global access.
// Keep them administrator-only until each surface has an explicit resource
// policy comparable to channels, tasks, and documents.
router.use('/bulk', requireAdmin, bulkRoutes);

// Mount MCP routes at /mcp
router.use('/mcp', mcpRoutes);

// Mount Hybrid MCP routes
router.use('/hybrid-mcp', hybridMcpRoutes);

// Mount Channel Context routes
router.use('/', channelContextRoutes);

// Mount Document routes
router.use('/documents', documentRoutes);

// Mount Channel key management routes
router.use('/channel-keys', channelKeyRoutes);

// Agent key management routes  
router.use('/agent-keys', agentKeyRoutes);

// Dashboard routes aggregate all tenants.
router.use('/dashboard', requireAdmin, dashboardRoutes);

// Analytics routes aggregate agents, channels, executions, and audit data.
router.use('/analytics', requireAdmin, analyticsRoutes);

// Configuration templates and deployments are server-wide resources.
router.use('/config', requireAdmin, configRoutes);

// Effectiveness controllers currently query across channels.
router.use('/effectiveness', requireAdmin, taskEffectivenessRoutes);

// Demo routes can launch a process and spend LLM credits. Keep the entire route
// surface absent unless an operator explicitly opts in, and never mount it in
// production even if a stale environment value says otherwise.
if (isDemoApiEnabled()) {
    router.use('/demo', demoRoutes);
    logger.warn('Demo API mounted at /api/demo (non-production, administrator only, single-flight)');
}

// n8n Webhook routes.
//
// Off unless MXF_WEBHOOK_ENABLED=true. These routes create tasks and drive
// agents, which spends LLM budget, so the surface does not exist unless someone
// asked for it. When enabled, the router requires an HMAC signature on every
// request and refuses to load without MXF_WEBHOOK_SECRET — hence the deferred
// require(), which keeps that boot check off the path of servers that never
// turn webhooks on.
if (isWebhookEnabled()) {
    // Deliberately load this router only when enabled: importing it validates
    // MXF_WEBHOOK_SECRET and initializes the task service at module load.
    const { default: n8nWebhookRoutes } = loadRouteModule('./n8nWebhooks') as {
        default: ReturnType<typeof express.Router>;
    };
    router.use('/webhooks/n8n', n8nWebhookRoutes);
    logger.info('n8n webhook routes mounted at /api/webhooks/n8n (HMAC signature required)');
}

// Knowledge graph views currently span all persisted entities.
router.use('/kg', requireAdmin, knowledgeGraphRoutes);

// DAG (Directed Acyclic Graph) routes
router.use('/dag', requireAdmin, dagRoutes);

// Memory Browser routes
router.use('/memory-browser', requireAdmin, memoryBrowserRoutes);

// ORPAR Control Loop routes
router.use('/orpar', requireAdmin, orparRoutes);

// Personal Access Token routes (for SDK authentication)
router.use('/tokens', tokenRoutes);

export default router;
