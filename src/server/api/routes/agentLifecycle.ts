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
 * Agent Lifecycle Routes
 * 
 * Routes for agent lifecycle operations
 */

import { Router } from 'express';
import {
    restartAgent,
    shutdownAgent,
    getAgentMetrics,
    pauseAgent,
    resumeAgent,
    deleteAgentMemory
} from '../controllers/agentLifecycleController';
import { authenticateUser } from '../middleware/auth';
import { authenticateDual } from '../middleware/dualAuth';

const router = Router();

/**
 * @route POST /api/agents/:agentId/restart
 * @desc Restart an agent
 * @body reason - Optional reason for restart
 * @access Private (JWT required)
 */
router.post('/:agentId/restart', authenticateUser, restartAgent);

/**
 * @route POST /api/agents/:agentId/shutdown
 * @desc Shutdown an agent
 * @body reason - Optional reason for shutdown
 * @access Private (JWT required)
 */
router.post('/:agentId/shutdown', authenticateUser, shutdownAgent);

/**
 * @route POST /api/agents/:agentId/pause
 * @desc Pause an agent
 * @body reason - Optional reason for pause
 * @access Private (JWT required)
 */
router.post('/:agentId/pause', authenticateUser, pauseAgent);

/**
 * @route POST /api/agents/:agentId/resume
 * @desc Resume an agent
 * @body reason - Optional reason for resume
 * @access Private (JWT required)
 */
router.post('/:agentId/resume', authenticateUser, resumeAgent);

/**
 * @route GET /api/agents/:agentId/metrics
 * @desc Get agent performance metrics
 * @access Private (JWT required)
 */
router.get('/:agentId/metrics', authenticateUser, getAgentMetrics);

/**
 * @route DELETE /api/agents/:agentId/memory
 * @desc Delete all persistent memory for an agent
 * @access Private (JWT or API key required)
 */
router.delete('/:agentId/memory', authenticateDual, deleteAgentMemory);

export default router;
