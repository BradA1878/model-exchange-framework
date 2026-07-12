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

import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server as socketIo } from 'socket.io';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { requireEnv } from '@mxf-dev/core/utils/env';
import { stopAllActiveDemos } from './api/controllers/demoController';
dotenv.config();
import { connectToDatabase } from './socket/services/DatabaseService';
import { SocketService } from './socket/services/SocketService';
import { ChannelService } from './socket/services/ChannelService';
import { AgentService } from './socket/services/AgentService';
import { ControlLoopService } from './socket/services/ControlLoopService';
import { ChannelContextService } from './services/ChannelContextService';
import { ServerReflectionService } from './socket/services/ServerReflectionService';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { MemoryPersistenceService } from './api/services/MemoryPersistenceService';
import { Logger, enableServerLogging } from '@mxf-dev/core/utils/Logger';
import apiRoutes from './api/routes';
import { DEFAULT_SERVER_CONFIG } from '@mxf-dev/core/config/ServerConfig';
import { authenticateDual } from './api/middleware/dualAuth';
import { captureRawBody } from './api/middleware/webhookAuth';
import { McpSocketExecutor } from './socket/services/McpSocketExecutor'; // Import McpSocketExecutor
import { ServerHybridMcpService } from './api/services/ServerHybridMcpService';
import { EphemeralEventPatternService } from './socket/services/EphemeralEventPatternService';
import { TaskService } from './socket/services/TaskService';
import { McpService } from './socket/services/McpService';
import { ModeDetectionService } from './socket/services/ModeDetectionService';
import { SystemLlmServiceManager } from './socket/services/SystemLlmServiceManager';
import { allMxfMcpTools } from './mcp/tools/index'; // Import MXF tools
import { McpToolRegistry } from './api/services/McpToolRegistry'; // Import McpToolRegistry
import { firstValueFrom } from 'rxjs';
import { MxfMeilisearchService, EmbeddingGenerator } from '@mxf-dev/core/services/MxfMeilisearchService';
import { CodeExecutionSandboxService } from '@mxf-dev/core/services/CodeExecutionSandboxService';
import { ToolExecutionPersistenceService } from './services/ToolExecutionPersistenceService';
import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import { RewardSignalProcessor } from '@mxf-dev/core/services/RewardSignalProcessor';
import { UtilityScorerService } from '@mxf-dev/core/services/UtilityScorerService';
import { OrparMemoryCoordinator } from '@mxf-dev/core/services/orpar-memory/OrparMemoryCoordinator';
import { StratumManager } from '@mxf-dev/core/services/StratumManager';
import { SurpriseCalculator } from '@mxf-dev/core/services/SurpriseCalculator';
import { MemoryCompressor } from '@mxf-dev/core/services/MemoryCompressor';
import { RetentionGateService } from '@mxf-dev/core/services/RetentionGateService';
import { getMemoryStrataConfig, isMemoryStrataEnabled } from '@mxf-dev/core/config/memory-strata.config';
import { MxfMLService } from '@mxf-dev/core/services/MxfMLService';
import { PredictiveAnalyticsService } from '@mxf-dev/core/services/PredictiveAnalyticsService';

/**
 * Initialize logger with appropriate context
 */
// The framework Logger ships with server output disabled (library default).
// The server app must opt in, and must do so before the fatal handlers and
// startup validation below — otherwise fail-fast errors exit with no output.
enableServerLogging(process.env.LOG_LEVEL || 'info');

const logger = new Logger('debug', 'Server', 'server');

// Fail fast on fatal process-level errors — never limp along with corrupted state.
process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception — shutting down', error);
    process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`Unhandled promise rejection — shutting down: ${reason instanceof Error ? reason.stack : String(reason)}`);
    process.exit(1);
});

// Demo child processes must never outlive the server.
process.on('SIGINT', () => {
    stopAllActiveDemos();
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopAllActiveDemos();
    process.exit(0);
});

// Startup configuration validation: fail before any service initializes.
requireEnv('JWT_SECRET', 'Set a strong secret in .env — it signs and verifies all user JWTs.');
requireEnv('MONGODB_URI', 'Set the MongoDB connection string in .env.');

/**
 * Public API endpoints that don't require authentication
 */
const PUBLIC_ENDPOINTS = [
    '/users/register',
    '/users/login',
    '/users/magic-link',
    '/users/magic-link/verify',
    '/health',
    '/demo/interview/start',
    '/demo/status',
    // Webhook routes are not "public" — they carry their own HMAC signature auth
    // (api/middleware/webhookAuth.ts) and are only mounted when MXF_WEBHOOK_ENABLED=true.
    // They skip dualAuth because they authenticate with a signature rather than a JWT or
    // agent key; removing this entry would make dualAuth reject every signed n8n request
    // with a 401 before the signature was ever checked.
    '/webhooks/n8n'
];

/**
 * Check if endpoint requires authentication
 */
const isPublicEndpoint = (path: string): boolean => {
    return PUBLIC_ENDPOINTS.some(endpoint => path.startsWith(endpoint)) || 
           !!path.match(/^\/demo\/[^\/]+\/stop$/); // Allow demo stop endpoints
};

// Create Express application
const app = express();
const server = http.createServer(app);

// Configure middleware
app.use(cors({
    origin: ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:8088', 'http://localhost:3002'],
    credentials: true
}));
// The verify hook keeps the raw request bytes so webhook HMAC signatures can be checked
// against the body exactly as it was sent. Without it, signature verification fails closed.
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: true }));

// Initialize Socket.IO server first
const io = new socketIo(server, {
    cors: {
        origin: '*', // Allow all origins for development
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Use both WebSocket and HTTP long-polling
    // Configure timeouts for long-running LLM operations
    pingTimeout: 120000, // 2 minutes - wait for ping response (increased from 5s default)
    pingInterval: 60000,  // 1 minute - send ping interval (increased from 25s default)
    // Additional connection settings for stability during LLM processing
    connectTimeout: 60000, // 1 minute - connection timeout
    maxHttpBufferSize: 1e8 // 100MB - for large LLM responses
});

// Make Socket.IO instance available to controllers
app.locals.io = io;

// Declare service variables (will be initialized in proper order)
let socketService: SocketService;
let memoryService: MemoryService;
let channelContextService: ChannelContextService;
let controlLoopService: ControlLoopService;
let serverReflectionService: ServerReflectionService;
let mcpSocketExecutor: McpSocketExecutor;
let mcpToolRegistry: McpToolRegistry;
let ephemeralEventPatternService: EphemeralEventPatternService;
let taskService: TaskService;
let modeDetectionService: ModeDetectionService;
let agentService: AgentService;
let channelService: ChannelService;

/**
 * Initialize all services and then mount API routes
 */
const initializeServer = async () => {
    try {
        // Step 0: Initialize MemoryService with persistence FIRST (before anything else uses it)
        memoryService = MemoryService.getInstance({
            persistenceService: MemoryPersistenceService.getInstance()
        });

        // Step 0.1: Give MULS a persistence sink.
        //
        // QValueManager already calls its persistence callback on every Q-value change and
        // on dirty-cache eviction — but no callback was ever registered, so every learned
        // Q-value lived only in the process cache and was lost on restart. This is the
        // registration that makes memory-utility learning durable.
        const qValueManager = QValueManager.getInstance();
        if (qValueManager.isEnabled()) {
            qValueManager.setPersistenceCallback(
                (memoryId, utility) => memoryService.updateMemoryUtility(memoryId, utility)
            );
            logger.info('[Boot] MULS enabled — Q-value persistence callback registered');
        } else {
            logger.info('[Boot] MULS disabled (MEMORY_UTILITY_LEARNING_ENABLED not set)');
        }

        // Step 1: Connect to database
        await connectToDatabase();

        // Step 1.5: Initialize Meilisearch if enabled
        if (process.env.ENABLE_MEILISEARCH === 'true') {
            try {

                // Create embedding generator function (OpenRouter/OpenAI/Anthropic)
                const embeddingGenerator: EmbeddingGenerator = async (text, options) => {
                    const providerStr = (process.env.MEILISEARCH_EMBEDDING_PROVIDER || 'openai').toLowerCase();
                    const model = options?.model || process.env.MEILISEARCH_EMBEDDING_MODEL || 'text-embedding-3-small';

                    // OpenRouter - proxies OpenAI embedding models
                    if (providerStr === 'openrouter') {
                        if (!process.env.OPENROUTER_API_KEY) {
                            throw new Error('OPENROUTER_API_KEY not set');
                        }

                        // App attribution shows in OpenRouter Logs dashboard.
                        // Override via OPENROUTER_APP_TITLE / OPENROUTER_APP_URL env vars
                        // when embedding MXF in another application. The "(Meilisearch)"
                        // suffix differentiates embedding traffic from chat completions.
                        const baseTitle = process.env.OPENROUTER_APP_TITLE || 'MXF';
                        const headers: Record<string, string> = {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                            'HTTP-Referer': process.env.OPENROUTER_APP_URL || 'https://mxf.dev',
                            'X-Title': `${baseTitle} (Meilisearch)`
                        };

                        const client = new OpenAI({
                            apiKey: process.env.OPENROUTER_API_KEY,
                            baseURL: 'https://openrouter.ai/api/v1',
                            defaultHeaders: headers
                        });

                        const response = await client.embeddings.create({
                            model: model, // Use full model name like 'openai/text-embedding-3-small'
                            input: text,
                            dimensions: options?.dimensions
                        });

                        if (!response?.data?.[0]?.embedding) {
                            throw new Error('Invalid embedding response from OpenRouter');
                        }

                        return response.data[0].embedding;
                    }

                    // OpenAI direct
                    if (providerStr === 'openai') {
                        if (!process.env.OPENAI_API_KEY) {
                            throw new Error('OPENAI_API_KEY not set');
                        }

                        const client = new OpenAI({
                            apiKey: process.env.OPENAI_API_KEY
                        });

                        const response = await client.embeddings.create({
                            model: model.replace('openai/', ''),
                            input: text
                        });

                        if (!response?.data?.[0]?.embedding) {
                            throw new Error('Invalid embedding response from OpenAI');
                        }

                        return response.data[0].embedding;
                    }

                    // Voyage AI (via Anthropic partnership)
                    if (providerStr === 'anthropic' || providerStr === 'voyage') {
                        if (!process.env.ANTHROPIC_API_KEY) {
                            throw new Error('ANTHROPIC_API_KEY not set for Voyage embeddings');
                        }

                        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`
                            },
                            body: JSON.stringify({
                                model: model,
                                input: [text],
                                input_type: 'document'
                            })
                        });

                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`Voyage API error [${response.status}]: ${errorText.substring(0, 200)}`);
                        }

                        const result = await response.json();
                        if (!result?.data?.[0]?.embedding) {
                            throw new Error('Invalid embedding response from Voyage');
                        }

                        return result.data[0].embedding;
                    }

                    throw new Error(`Unsupported embedding provider: ${providerStr}`);
                };

                const meilisearch = MxfMeilisearchService.getInstance({
                    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
                    apiKey: process.env.MEILISEARCH_MASTER_KEY || '',
                    enableEmbeddings: process.env.ENABLE_SEMANTIC_SEARCH !== 'false',
                    embeddingModel: process.env.MEILISEARCH_EMBEDDING_MODEL,
                    embeddingDimensions: parseInt(process.env.MEILISEARCH_EMBEDDING_DIMENSIONS || '1536'),
                    embeddingGenerator
                });
                await meilisearch.initialize();
            } catch (error) {
                logger.error(`❌ Failed to initialize Meilisearch: ${error instanceof Error ? error.message : String(error)}`);
                logger.warn('⚠️  Continuing without Meilisearch - search features will be unavailable');
            }
        } else {
        }

        // Step 1.6: Initialize Code Execution Sandbox (Docker-based)
        try {
            const codeExecService = CodeExecutionSandboxService.getInstance();
            const dockerAvailable = await codeExecService.initialize();
            if (dockerAvailable) {
                logger.info('Code execution sandbox initialized with Docker');
            } else {
                logger.warn('Code execution sandbox: Docker not available - code execution disabled');
            }
        } catch (error) {
            logger.error(`Failed to initialize code execution sandbox: ${error instanceof Error ? error.message : String(error)}`);
            logger.warn('Continuing without code execution capability');
        }

        // Step 2: Initialize core services in proper order

        // Initialize service instances
        socketService = new SocketService(io);
        memoryService = MemoryService.getInstance(); // Already initialized with persistence at Step 0
        channelContextService = ChannelContextService.getInstance();
        mcpSocketExecutor = McpSocketExecutor.getInstance();
        mcpToolRegistry = McpToolRegistry.getInstance();
        ephemeralEventPatternService = EphemeralEventPatternService.getInstance();
        taskService = TaskService.getInstance();
        modeDetectionService = ModeDetectionService.getInstance();
        serverReflectionService = new ServerReflectionService();
        channelService = ChannelService.getInstance(io);
        agentService = AgentService.getInstance(); // Initialize last to ensure all dependencies are ready
        
        // Initialize SystemLlmServiceManager to load env vars and show configuration at startup
        SystemLlmServiceManager.getInstance();

        // Initialize EphemeralEventPatternService
        await ephemeralEventPatternService.initialize();

        // Step 2.5: Initialize MULS services if enabled
        if (process.env.MEMORY_UTILITY_LEARNING_ENABLED === 'true') {
            try {
                // Initialize all MULS services - this sets enabled=true based on env config
                QValueManager.getInstance().initialize();
                RewardSignalProcessor.getInstance().initialize();
                UtilityScorerService.getInstance().initialize();

                logger.info('MULS services initialized (Memory Utility Learning System)');
            } catch (error) {
                logger.error(`Failed to initialize MULS services: ${error instanceof Error ? error.message : String(error)}`);
                logger.warn('Continuing without MULS - memory utility learning disabled');
            }
        }

        // Step 2.55: Initialize the memory strata (Nested Learning) services.
        //
        // These must come up before the ORPAR-Memory coordinator, because
        // PhaseMemoryOperations and PhaseStrataRouter store and retrieve through
        // StratumManager. Nothing initialized StratumManager outside of test files, so it
        // stayed disabled no matter what MEMORY_STRATA_ENABLED was set to — which meant
        // phase retrievals returned nothing and the whole strata layer was inert.
        if (isMemoryStrataEnabled()) {
            const strataConfig = getMemoryStrataConfig();
            StratumManager.getInstance().initialize(strataConfig);
            SurpriseCalculator.getInstance().initialize({
                enabled: strataConfig.surprise.enabled,
                threshold: strataConfig.surprise.threshold,
                momentumDecayRate: 0.7,
                momentumBoostFactor: 1.2
            });
            MemoryCompressor.getInstance().initialize({ enabled: true });
            RetentionGateService.getInstance().initialize({ enabled: true });
            logger.info('Memory strata (Nested Learning) initialized');
        } else {
            logger.info('Memory strata disabled (MEMORY_STRATA_ENABLED not set)');
        }

        // Step 2.6: Initialize ORPAR-Memory integration if enabled.
        //
        // Failing to initialize this must be fatal rather than logged-and-ignored: the
        // operator asked for the integration, and continuing without it means the server
        // silently runs with learning switched off while reporting that it started.
        if (process.env.ORPAR_MEMORY_INTEGRATION_ENABLED === 'true') {
            OrparMemoryCoordinator.getInstance().initialize();
            logger.info('ORPAR-Memory integration initialized');
        }

        // Step 2.8: Initialize TensorFlow.js integration if enabled
        if (process.env.TENSORFLOW_ENABLED === 'true') {
            try {
                await MxfMLService.getInstance().initialize();
                logger.info('TensorFlow.js integration initialized');

                // Step 2.9: Initialize TF.js models in PredictiveAnalyticsService.
                // PredictiveAnalyticsService is instantiated at module load time
                // (before Step 2.8), so TF model registration is deferred to here.
                await PredictiveAnalyticsService.getInstance().initializeTensorFlowModels();
                logger.info('PredictiveAnalyticsService TF.js models initialized');
            } catch (error) {
                logger.error(`Failed to initialize TensorFlow.js: ${error instanceof Error ? error.message : String(error)}`);
                logger.warn('Continuing without TensorFlow.js - ML models disabled');
            }
        }

        // Step 3: Initialize Hybrid MCP Service
        try {
            await ServerHybridMcpService.getInstance().initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize Hybrid MCP Service: ${error instanceof Error ? error.message : String(error)}`);
            // Don't exit - let the server continue without hybrid MCP if it fails
        }

        // Step 3.5: Initialize Tool Execution Persistence Service
        // This listens to tool execution events and persists them to the database
        try {
            await ToolExecutionPersistenceService.getInstance().initialize();
            logger.info('Tool execution persistence service initialized');
        } catch (error) {
            logger.error(`❌ Failed to initialize Tool Execution Persistence Service: ${error instanceof Error ? error.message : String(error)}`);
            // Non-fatal: continue without persistence if it fails
        }

        // Step 4: Load existing MCP tools from database and register new ones
        // NOTE: This must happen BEFORE McpService initializes so it can load the newly registered tools
        try {

            // Reconcile every tool against the code, which is the source of truth.
            //
            // Registration used to skip any tool whose *name* already existed in the
            // database, while serving the description from the database and the schema from
            // the code. So editing a tool's description changed nothing until the database
            // was wiped, and description and schema could drift apart within a single tool.
            // Tool descriptions are the prompt text an agent reads to decide how to call a
            // tool, so that drift was silent prompt rot. This upserts description, schema
            // and metadata for every tool, and prunes rows whose handler no longer exists.
            await mcpToolRegistry.reconcileTools(allMxfMcpTools as any, 'mxf-server', 'system');

            // Final count
            const finalTools = await firstValueFrom(mcpToolRegistry.listTools());
            const toolCount = finalTools.length;

            // Store tool count for server startup message
            (server as any)._mxfToolCount = toolCount;

            // Refresh the hybrid registry so it sees newly registered tools
            // (Step 3 took an initial snapshot before these tools were registered)
            try {
                ServerHybridMcpService.getInstance().getHybridRegistry().refreshInternalTools();
            } catch (error) {
                // Non-fatal: hybrid registry will still work with its initial snapshot
            }

        } catch (error) {
            logger.error(`❌ Failed to initialize MXF MCP tools: ${error}`);
            // Store 0 if tool loading failed
            (server as any)._mxfToolCount = 0;
        }

        // Step 5: Initialize McpService for socket-based tool communication
        // NOTE: Must happen AFTER tool registration so McpService loads the new tools
        try {
            await McpService.getInstance().initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize McpService: ${error}`);
        }

        // Step 6: Verify all services are ready
        if (serverReflectionService) {
        }

        // Step 7: Mount API routes AFTER all services are initialized (including tool registration)
        setupApiRoutes();

        // Step 8: Start the server
        const PORT = process.env.MXF_PORT || DEFAULT_SERVER_CONFIG.port;
        const toolCount = (server as any)._mxfToolCount || 0;

        server.listen(PORT, () => {
            logger.info('╔════════════════════════════════════════════════════════════════╗');
            logger.info('║              MXF Server Ready                                  ║');
            logger.info('╠════════════════════════════════════════════════════════════════╣');
            logger.info(`║  Port:           ${PORT}`.padEnd(66) + '║');
            logger.info(`║  Tools Loaded:   ${toolCount}`.padEnd(66) + '║');
            logger.info(`║  Environment:    ${process.env.NODE_ENV || 'development'}`.padEnd(66) + '║');
            logger.info('╚════════════════════════════════════════════════════════════════╝');
        });
        
    } catch (error) {
        logger.error('❌ Server initialization failed:', error);
        process.exit(1);
    }
};

/**
 * Setup API routes after all services are initialized
 */
const setupApiRoutes = () => {
    // Health check endpoint (available before full initialization)
    app.get('/health', (req, res) => {
        // Log health check request
        
        // Check Socket.IO server status
        const socketServerRunning = socketService.isRunning();
        
        // Respond with 200 OK and comprehensive server information
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            version: process.env.npm_package_version || '0.1.0',
            servers: {
                api: {
                    status: 'running',
                    port: process.env.MXF_PORT || DEFAULT_SERVER_CONFIG.port
                },
                socket: {
                    status: socketServerRunning ? 'running' : 'not_running',
                    port: process.env.MXF_PORT || DEFAULT_SERVER_CONFIG.port
                }
            }
        });
    });

    // API routes with dual authentication (JWT for users, key-based for agents)
    app.use('/api', (req, res, next) => {
        // Check if endpoint is public (doesn't require authentication)
        const isPublic = isPublicEndpoint(req.path) ||
            req.path.startsWith('/mcp/capabilities') ||
            (req.path.startsWith('/mcp/tools') && req.method === 'GET');
            
        if (isPublic) {
            return next();
        }
        
        // Protected routes require either JWT (users) or key-based (agents) authentication
        return authenticateDual(req, res, next);
    }, apiRoutes);
    
};

// Start the initialization process
initializeServer();

// This entry module must not export anything. When the compiled file is run
// with `bun run dist/server/index.js`, Bun inspects the entry's exports and
// calls Bun.serve() on anything that looks like a server config — exporting
// app/server/io here made that misfire and kill the process with a
// Bun.serve() TypeError after startup. Nothing imports these exports.
