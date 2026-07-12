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

/**
 * Channel Context Routes
 *
 * This module defines the API routes for channel context operations including
 * context creation, participant management, metadata, and message operations.
 *
 * Every route here names a channel, and every one of them ran without an
 * ownership or membership check: knowing a channelId was enough to read another
 * channel's messages, rewrite its context, or add and remove its agents.
 * requireChannelAccess now gates all of them — a user must own the channel, an
 * agent's key must be bound to it.
 */

import express from 'express';
import * as channelContextController from '../controllers/channelContextController';
import { requireChannelAccess } from '../middleware/channelAuth';

const router = express.Router();

// Channel context core operations
router.post('/channels/:channelId/context', requireChannelAccess, channelContextController.createContext);
router.get('/channels/:channelId/context', requireChannelAccess, channelContextController.getContext);
router.patch('/channels/:channelId/context', requireChannelAccess, channelContextController.updateContext);

// Channel participants management
router.post('/channels/:channelId/agents/:agentId', requireChannelAccess, channelContextController.addAgentToChannel);
router.delete('/channels/:channelId/agents/:agentId', requireChannelAccess, channelContextController.removeAgentFromChannel);

// Channel metadata operations
router.get('/channels/:channelId/metadata', requireChannelAccess, channelContextController.getChannelMetadata);
router.get('/channels/:channelId/metadata/:key', requireChannelAccess, channelContextController.getChannelMetadata);
router.post('/channels/:channelId/metadata/:key', requireChannelAccess, channelContextController.setChannelMetadata);

// Channel history and messages
router.get('/channels/:channelId/history', requireChannelAccess, channelContextController.getChannelHistory);
router.get('/channels/:channelId/messages', requireChannelAccess, channelContextController.getChannelMessages);
router.post('/channels/:channelId/messages', requireChannelAccess, channelContextController.addChannelMessage);

// LLM-powered features
router.post('/channels/:channelId/topics', requireChannelAccess, channelContextController.extractChannelTopics);
router.post('/channels/:channelId/summary', requireChannelAccess, channelContextController.generateChannelSummary);

export default router;
