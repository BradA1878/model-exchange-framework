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
 * Configuration Routes
 * 
 * Routes for configuration management including templates and deployment settings
 */

import { Router } from 'express';
import {
    getTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getDeploymentConfigs,
    createDeploymentConfig,
    getEnvironmentConfigs,
    updateEnvironmentConfig,
    syncConfiguration,
    getAgentConfigOptions
} from '../controllers/configController';
import { authenticateUser } from '../middleware/auth';

const router = Router();

// Apply authentication to all configuration routes
router.use(authenticateUser);

// Agent Configuration Routes

/**
 * @route GET /api/config/agent-options
 * @desc Get agent configuration options for frontend forms
 * @access Private (JWT required)
 */
router.get('/agent-options', getAgentConfigOptions);

// Configuration Template Routes

/**
 * @route GET /api/config/templates
 * @desc Get all configuration templates
 * @query type (optional) - Filter by template type
 * @access Private (JWT required)
 */
router.get('/templates', getTemplates);

/**
 * @route GET /api/config/templates/:templateId
 * @desc Get specific configuration template
 * @access Private (JWT required)
 */
router.get('/templates/:templateId', getTemplate);

/**
 * @route POST /api/config/templates
 * @desc Create new configuration template
 * @body name - Template name
 * @body description - Template description
 * @body type - Template type (agent, channel, task)
 * @body content - Template configuration content
 * @body variables - Template variables
 * @access Private (JWT required)
 */
router.post('/templates', createTemplate);

/**
 * @route PUT /api/config/templates/:templateId
 * @desc Update configuration template
 * @access Private (JWT required)
 */
router.put('/templates/:templateId', updateTemplate);

/**
 * @route DELETE /api/config/templates/:templateId
 * @desc Delete configuration template
 * @access Private (JWT required)
 */
router.delete('/templates/:templateId', deleteTemplate);

// Deployment Configuration Routes

/**
 * @route GET /api/config/deployments
 * @desc Get all deployment configurations
 * @access Private (JWT required)
 */
router.get('/deployments', getDeploymentConfigs);

/**
 * @route POST /api/config/deployments
 * @desc Create new deployment configuration
 * @body name - Configuration name
 * @body description - Configuration description
 * @body environment - Target environment
 * @body templateId - Base template ID
 * @body configuration - Deployment configuration object
 * @body deploymentTarget - Deployment target details
 * @access Private (JWT required)
 */
router.post('/deployments', createDeploymentConfig);

// Environment Configuration Routes

/**
 * @route GET /api/config/environments
 * @desc Get all environment configurations
 * @access Private (JWT required)
 */
router.get('/environments', getEnvironmentConfigs);

/**
 * @route PUT /api/config/environments/:envId
 * @desc Update environment configuration
 * @access Private (JWT required)
 */
router.put('/environments/:envId', updateEnvironmentConfig);

// Configuration Sync Routes

/**
 * @route POST /api/config/sync
 * @desc Sync configuration from external source
 * @body source - Configuration source (git, s3, etc.)
 * @body options - Sync options
 * @access Private (JWT required)
 */
router.post('/sync', syncConfiguration);

export default router;
