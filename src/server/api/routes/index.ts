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

import express from 'express';
import * as agentController from '../controllers/agentController';
import * as channelController from '../controllers/channelController';
import { userController } from '../controllers/userController';
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
import n8nWebhookRoutes from './n8nWebhooks';
import knowledgeGraphRoutes from './knowledgeGraph';
import dagRoutes from './dag';
import memoryBrowserRoutes from './memory';
import orparRoutes from './orpar';
import tokenRoutes from './tokenRoutes';

const router = express.Router();

// Protected routes (require authentication)
// Middleware will be added by the server when routes are registered

// User routes (authentication)
router.post('/users/register', userController.register);
router.post('/users/login', userController.login);
router.post('/users/magic-link', userController.requestMagicLink);
router.post('/users/magic-link/verify', userController.verifyMagicLink);
router.get('/users/profile', userController.getProfile);
router.patch('/users/profile', userController.updateProfile);
router.delete('/users/profile', userController.deleteProfile);
router.get('/users', userController.getAllUsers);
router.patch('/users/role', userController.updateUserRole);

// Agent routes
router.get('/agents', agentController.getAgents);
router.get('/agents/:agentId', agentController.getAgentById);
router.post('/agents', agentController.createAgent);
router.put('/agents/:agentId', agentController.updateAgent);
router.delete('/agents/:agentId', agentController.deleteAgent);
router.get('/agents/services/:serviceType', agentController.getAgentsByService);

// Agent context and memory routes (using keyId as lookup)
router.get('/agents/context/:keyId', agentController.getAgentContext);
router.get('/agents/memory/:keyId', agentController.getOrCreateAgentMemory);
router.patch('/agents/memory/:keyId', agentController.updateAgentMemory);
router.patch('/agents/context/:keyId', agentController.updateAgentContext);

// Channel routes - Core CRUD operations
router.get('/channels', channelController.getAllChannels);
router.post('/channels', channelController.registerChannel);
router.get('/channels/:channelId', channelController.getChannelById);
router.put('/channels/:channelId', channelController.updateChannel);
router.delete('/channels/:channelId', channelController.deleteChannel);
router.get('/channels/:channelId/documents', require('../controllers/documentController').getDocumentsByChannel);

// Channel additional operations
router.post('/channels/workspace', channelController.createChannelWorkspace);
router.get('/channels/verify/:token', channelController.verifyChannel);

// Channel discovery and search operations
router.get('/channels/search', channelController.searchChannels);
router.get('/channels/discover/:channelId', channelController.findByChannelId);
router.get('/channels/domain/:domain', channelController.listChannelsByDomain);

// Channel memory routes (using channelId as lookup)
// Context routes have been moved to channelContextRoutes
router.get('/channels/memory/:channelId', channelController.getOrCreateChannelMemory);
router.patch('/channels/memory/:channelId', channelController.updateChannelMemory);

// Channel MCP server management routes
router.post('/channels/:channelId/mcp-servers', channelController.registerChannelMcpServer);
router.get('/channels/:channelId/mcp-servers', channelController.listChannelMcpServers);
router.delete('/channels/:channelId/mcp-servers/:serverId', channelController.unregisterChannelMcpServer);

// Task management routes
router.use('/tasks', taskRoutes);

// Agent lifecycle management routes (separate path to avoid conflicts)
router.use('/agents', agentLifecycleRoutes);

// Bulk operations routes
router.use('/bulk', bulkRoutes);

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

// Dashboard routes
router.use('/dashboard', dashboardRoutes);

// Analytics routes
router.use('/analytics', analyticsRoutes);

// Configuration routes
router.use('/config', configRoutes);

// Task effectiveness routes
router.use('/effectiveness', taskEffectivenessRoutes);

// Demo routes (public access for presentation)
router.use('/demo', demoRoutes);

// n8n Webhook routes (minimal auth for external integration)
router.use('/webhooks/n8n', n8nWebhookRoutes);

// Knowledge Graph routes
router.use('/kg', knowledgeGraphRoutes);

// DAG (Directed Acyclic Graph) routes
router.use('/dag', dagRoutes);

// Memory Browser routes
router.use('/memory-browser', memoryBrowserRoutes);

// ORPAR Control Loop routes
router.use('/orpar', orparRoutes);

// Personal Access Token routes (for SDK authentication)
router.use('/tokens', tokenRoutes);

export default router;
