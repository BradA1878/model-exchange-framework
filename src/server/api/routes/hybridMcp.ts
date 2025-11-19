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
 * Hybrid MCP Routes
 * 
 * Routes for managing the hybrid MCP architecture including external servers
 * and unified tool discovery.
 */

import express from 'express';
import * as hybridMcpController from '../controllers/hybridMcpController';
import { authenticateUser } from '../middleware/auth';

const router = express.Router();

// Get hybrid service status
router.get('/status', hybridMcpController.getHybridStatus);

// Get hybrid service statistics
router.get('/stats', hybridMcpController.getHybridStats);

// Get all tools (internal + external)
router.get('/tools', hybridMcpController.getAllTools);

// Get external server statuses
router.get('/servers', hybridMcpController.getExternalServers);

// Start an external server
router.post('/servers/:serverId/start', hybridMcpController.startExternalServer);

// Stop an external server
router.post('/servers/:serverId/stop', hybridMcpController.stopExternalServer);

// Register a new external server (for dashboard/HTTP access)
// NOTE: SDK uses EventBus events (EXTERNAL_SERVER_REGISTER) - this is for dashboard UI
router.post('/servers/register', authenticateUser, hybridMcpController.registerExternalServer);

// Unregister an external server (for dashboard/HTTP access)
router.delete('/servers/:serverId', authenticateUser, hybridMcpController.unregisterExternalServer);

// Get server status
router.get('/servers/:serverId/status', hybridMcpController.getServerStatus);

export default router;
