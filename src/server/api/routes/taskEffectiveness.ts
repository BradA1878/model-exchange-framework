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
 * Task Effectiveness API Routes
 */

import { Router } from 'express';
import {
    getTaskEffectiveness,
    getChannelEffectivenessAnalytics,
    getAgentEffectiveness,
    compareTaskEffectiveness,
    getEffectivenessTrends
} from '../controllers/taskEffectivenessController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// Apply authentication to all effectiveness routes
router.use(authenticateUser);

// Task-specific effectiveness
router.get('/task/:taskId', getTaskEffectiveness);
router.get('/compare/:taskId', compareTaskEffectiveness);

// Channel analytics
router.get('/analytics/:channelId', getChannelEffectivenessAnalytics);

// Agent effectiveness
router.get('/agent/:agentId', getAgentEffectiveness);

// Trends
router.get('/trends', getEffectivenessTrends);

export default router;