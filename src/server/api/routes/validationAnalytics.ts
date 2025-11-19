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
 * Validation Analytics Routes
 * Phase 1: API routes for validation performance metrics
 */

import { Router } from 'express';
import { authenticateUser } from '../middleware/auth';
import {
    getValidationMetrics,
    getValidationEventStream,
    getChannelValidationMetrics,
    getValidationTrends,
    exportValidationReport
} from '../controllers/validationAnalyticsController';

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/analytics/validation/:agentId/:channelId
 * Get validation metrics for a specific agent in a channel
 */
router.get('/validation/:agentId/:channelId', getValidationMetrics);

/**
 * GET /api/analytics/validation/:agentId/:channelId/events
 * Get real-time validation event stream (SSE)
 */
router.get('/validation/:agentId/:channelId/events', getValidationEventStream);

/**
 * GET /api/analytics/validation/channel/:channelId
 * Get aggregated validation metrics for all agents in a channel
 */
router.get('/validation/channel/:channelId', getChannelValidationMetrics);

/**
 * GET /api/analytics/validation/:agentId/:channelId/trends
 * Get validation performance trends over time
 */
router.get('/validation/:agentId/:channelId/trends', getValidationTrends);

/**
 * GET /api/analytics/validation/:agentId/:channelId/export
 * Export validation report in various formats
 */
router.get('/validation/:agentId/:channelId/export', exportValidationReport);

export default router;