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
 * Channel Context Routes
 * 
 * This module defines the API routes for channel context operations including
 * context creation, participant management, metadata, and message operations.
 */

import express from 'express';
import * as channelContextController from '../controllers/channelContextController';

const router = express.Router();

// Channel context core operations
router.post('/channels/:channelId/context', channelContextController.createContext);
router.get('/channels/:channelId/context', channelContextController.getContext);
router.patch('/channels/:channelId/context', channelContextController.updateContext);

// Channel participants management
router.post('/channels/:channelId/agents/:agentId', channelContextController.addAgentToChannel);
router.delete('/channels/:channelId/agents/:agentId', channelContextController.removeAgentFromChannel);

// Channel metadata operations
router.get('/channels/:channelId/metadata', channelContextController.getChannelMetadata);
router.get('/channels/:channelId/metadata/:key', channelContextController.getChannelMetadata);
router.post('/channels/:channelId/metadata/:key', channelContextController.setChannelMetadata);

// Channel history and messages
router.get('/channels/:channelId/history', channelContextController.getChannelHistory);
router.get('/channels/:channelId/messages', channelContextController.getChannelMessages);
router.post('/channels/:channelId/messages', channelContextController.addChannelMessage);

// LLM-powered features
router.post('/channels/:channelId/topics', channelContextController.extractChannelTopics);
router.post('/channels/:channelId/summary', channelContextController.generateChannelSummary);

export default router;
