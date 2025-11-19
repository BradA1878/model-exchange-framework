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

import { Router } from 'express';
import { startInterviewDemo, stopDemo, getDemoStatus } from '../controllers/demoController';

const router = Router();

/**
 * @route POST /api/demo/interview/start
 * @desc Start the real interview scheduling demo
 * @access Public (for presentation)
 */
router.post('/interview/start', startInterviewDemo);

/**
 * @route POST /api/demo/:demoId/stop
 * @desc Stop a running demo
 * @access Public (for presentation)
 */
router.post('/:demoId/stop', stopDemo);

/**
 * @route GET /api/demo/status
 * @desc Get status of running demos
 * @access Public (for presentation)
 */
router.get('/status', getDemoStatus);

export default router;
