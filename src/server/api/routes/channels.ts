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
 * Channel Routes
 * 
 * Defines API routes for channel registration, verification, and discovery.
 */

import express from 'express';
import {
    registerChannel,
    findByChannelId,
    listChannelsByDomain,
    searchChannels,
    initializeVerification,
    verifyChannel
} from '../controllers/channelController';
import {
    validateChannelInput,
    validateVerificationInput
} from '../middleware/validation';

const router = express.Router();

// Channel registration and discovery
router.route('/channels')
    .post(validateChannelInput, registerChannel);

// Finding agent by channel ID 
router.route('/channels/:channelId')
    .get(findByChannelId);

// List channels by domain
router.route('/channels/domain/:domain')
    .get(listChannelsByDomain);

// Search for channels
router.route('/channels/search')
    .get(searchChannels);

// Channel verification
router.route('/channels/:channelId/verification')
    .post(validateVerificationInput, initializeVerification)
    .put(validateVerificationInput, verifyChannel);

export default router;
