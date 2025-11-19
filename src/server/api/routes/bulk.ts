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
 * Bulk Operations Routes
 * 
 * Routes for bulk operations on agents, channels, and tasks
 */

import { Router } from 'express';
import {
    bulkCreate,
    bulkUpdate,
    bulkDelete,
    getBulkOperationStatus
} from '../controllers/bulkController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// Apply authentication to all bulk operation routes
router.use(authenticateUser);

/**
 * @route POST /api/bulk/create
 * @desc Bulk create entities (agents, channels, tasks)
 * @body entityType - Type of entity to create (agent, channel, task)
 * @body items - Array of entity data to create
 * @body options - Optional configuration for bulk operation
 * @access Private (JWT required)
 */
router.post('/create', bulkCreate);

/**
 * @route POST /api/bulk/update
 * @desc Bulk update entities (agents, channels)
 * @body entityType - Type of entity to update (agent, channel)
 * @body items - Array of update data with id and updates
 * @body options - Optional configuration for bulk operation
 * @access Private (JWT required)
 */
router.post('/update', bulkUpdate);

/**
 * @route POST /api/bulk/delete
 * @desc Bulk delete entities (agents, channels, tasks)
 * @body entityType - Type of entity to delete (agent, channel, task)
 * @body ids - Array of entity IDs to delete
 * @body options - Optional configuration for bulk operation
 * @access Private (JWT required)
 */
router.post('/delete', bulkDelete);

/**
 * @route GET /api/bulk/operations/:operationId
 * @desc Get status of bulk operation
 * @access Private (JWT required)
 */
router.get('/operations/:operationId', getBulkOperationStatus);

export default router;
