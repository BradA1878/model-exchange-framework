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

// Load environment configuration before any imported route module evaluates
// its mount-time feature gates.
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server as socketIo } from 'socket.io';
import OpenAI from 'openai';
import { requireEnv } from '@mxf-dev/core/utils/env';
import { stopAllActiveDemos } from './api/controllers/demoController';
import {
    closeDatabase,
    connectToDatabase,
    isDatabaseConnected
} from './socket/services/DatabaseService';
import { SocketService } from './socket/services/SocketService';
import { ChannelService } from './socket/services/ChannelService';
import { AgentService } from './socket/services/AgentService';
import { ChannelContextService } from './services/ChannelContextService';
import { ServerReflectionService } from './socket/services/ServerReflectionService';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { MemoryPersistenceService } from './api/services/MemoryPersistenceService';
import { Logger, enableServerLogging } from '@mxf-dev/core/utils/Logger';
import apiRoutes from './api/routes';
import { authenticateDual } from './api/middleware/dualAuth';
import { captureRawBody } from './api/middleware/webhookAuth';
import { McpSocketExecutor } from './socket/services/McpSocketExecutor'; // Import McpSocketExecutor
import { ServerHybridMcpService } from './api/services/ServerHybridMcpService';
import { EphemeralEventPatternService } from './socket/services/EphemeralEventPatternService';
import { TaskService } from './socket/services/TaskService';
import { initializeTaskHandlers, shutdownTaskHandlers } from './socket/handlers/taskHandlers';
import { McpService } from './socket/services/McpService';
import { ModeDetectionService } from './socket/services/ModeDetectionService';
import { InferenceParameterService } from './socket/services/InferenceParameterService';
import { SystemLlmServiceManager, assertSystemLlmConfigured } from './socket/services/SystemLlmServiceManager';
import { SystemLlmChallengeService } from './socket/services/SystemLlmChallengeService';
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
import { ValidationPerformanceService } from '@mxf-dev/core/services/ValidationPerformanceService';
import { AgentPerformanceService } from '@mxf-dev/core/services/AgentPerformanceService';
import { PatternLearningService } from '@mxf-dev/core/services/PatternLearningService';
import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';
import { ToolExecutionInterceptor } from '@mxf-dev/core/services/ToolExecutionInterceptor';
import { ProactiveValidationService } from '@mxf-dev/core/services/ProactiveValidationService';
import { ValidationCacheService } from '@mxf-dev/core/services/ValidationCacheService';
import { ValidationMiddleware } from '@mxf-dev/core/services/ValidationMiddleware';
import { ValidationAnalyticsService } from '@mxf-dev/core/services/ValidationAnalyticsService';
import { PerformanceOptimizationService } from '@mxf-dev/core/services/PerformanceOptimizationService';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { BackgroundTaskManager } from '@mxf-dev/core/services/BackgroundTaskManager';
import { ServerShutdownCoordinator } from './services/ServerShutdownCoordinator';
import { readAppVersion } from '../shared/appVersion';
import { UserInputRequestManager } from '@mxf-dev/core/services/UserInputRequestManager';
import { assertJwtSecretConfigured } from './api/security/jwtTokenPolicy';
import {
    registerServerHealthRoutes,
    ServerRuntimeState
} from './services/ServerRuntimeState';
import { listenForHttpServer } from './services/HttpServerLifecycle';
import { assertExternalLlmCallAllowed } from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';
import {
    getAllowedCorsOrigins,
    getSocketMaxHttpBufferSize
} from './config/TransportSecurityConfig';
import { getServerPort } from './config/ServerStartupConfig';

/**
 * Initialize logger with appropriate context
 */
// The framework Logger ships with server output disabled (library default).
// The server app must opt in, and must do so before the fatal handlers and
// startup validation below — otherwise fail-fast errors exit with no output.
enableServerLogging(process.env.LOG_LEVEL || 'info');

const logger = new Logger('debug', 'Server', 'server');

// Startup configuration validation: fail before any service initializes.
assertJwtSecretConfigured();
requireEnv('MONGODB_URI', 'Set the MongoDB connection string in .env.');
// SystemLLM has no built-in model: when it is on, its provider credentials and
// SYSTEMLLM_DEFAULT_MODEL must be set, or the server does not start.
assertSystemLlmConfigured();
const allowedCorsOrigins = getAllowedCorsOrigins();
const socketMaxHttpBufferSize = getSocketMaxHttpBufferSize();
const serverPort = getServerPort();

/**
 * Public API endpoints that don't require authentication
 */
const PUBLIC_ENDPOINTS = [
    '/users/register',
    '/users/login',
    '/users/magic-link',
    '/users/magic-link/verify',
    '/health',
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
    return PUBLIC_ENDPOINTS.some(endpoint => path.startsWith(endpoint));
};

// Create Express application
const app = express();
const server = http.createServer(app);
const runtimeState = new ServerRuntimeState();

// Configure middleware
app.use(cors({
    origin: allowedCorsOrigins,
    credentials: true
}));
// The verify hook keeps the raw request bytes so webhook HMAC signatures can be checked
// against the body exactly as it was sent. Without it, signature verification fails closed.
app.use(express.json({ verify: captureRawBody }));
app.use(express.urlencoded({ extended: true }));

// Initialize Socket.IO server first
const io = new socketIo(server, {
    cors: {
        origin: allowedCorsOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Use both WebSocket and HTTP long-polling
    // Configure timeouts for long-running LLM operations
    pingTimeout: 120000, // 2 minutes - wait for ping response (increased from 5s default)
    pingInterval: 60000,  // 1 minute - send ping interval (increased from 25s default)
    // Additional connection settings for stability during LLM processing
    connectTimeout: 60000, // 1 minute - connection timeout
    maxHttpBufferSize: socketMaxHttpBufferSize
});

// Make Socket.IO instance available to controllers
app.locals.io = io;

// Declare service variables (will be initialized in proper order)
let socketService: SocketService | undefined;
let memoryService: MemoryService;
let mcpToolRegistry: McpToolRegistry;
let ephemeralEventPatternService: EphemeralEventPatternService | undefined;
let systemLlmChallengeService: SystemLlmChallengeService | undefined;
let modeDetectionService: ModeDetectionService | undefined;
let taskService: TaskService | undefined;
let codeExecutionSandboxService: CodeExecutionSandboxService | undefined;
let systemLlmServiceManager: SystemLlmServiceManager | undefined;
let hybridMcpService: ServerHybridMcpService | undefined;
let rewardSignalProcessor: RewardSignalProcessor | undefined;
let machineLearningService: MxfMLService | undefined;
let predictiveAnalyticsService: PredictiveAnalyticsService | undefined;
let patternLearningService: PatternLearningService | undefined;
let autoCorrectionService: AutoCorrectionService | undefined;
let toolExecutionInterceptor: ToolExecutionInterceptor | undefined;
let proactiveValidationService: ProactiveValidationService | undefined;
let validationCacheService: ValidationCacheService | undefined;
let validationMiddleware: ValidationMiddleware | undefined;
let validationAnalyticsService: ValidationAnalyticsService | undefined;
let performanceOptimizationService: PerformanceOptimizationService | undefined;
let validationPerformanceService: ValidationPerformanceService | undefined;
let agentPerformanceService: AgentPerformanceService | undefined;
let orparMemoryCoordinator: OrparMemoryCoordinator | undefined;
let loadedToolCount = 0;

registerServerHealthRoutes(
    app,
    runtimeState,
    () => ({
        api: server.listening,
        socket: socketService?.isRunning() ?? false,
        database: isDatabaseConnected()
    }),
    {
        environment: process.env.NODE_ENV || 'development',
        version: readAppVersion(),
        port: serverPort
    }
);

const closeHttpServer = async (): Promise<void> => {
    if (!server.listening) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
};

const shutdownCoordinator = new ServerShutdownCoordinator([
    {
        name: 'socket-ingress',
        run: async (): Promise<void> => { await socketService?.shutdown(); }
    },
    { name: 'http-ingress', run: closeHttpServer },
    { name: 'demo-processes', run: (): Promise<void> => stopAllActiveDemos() },
    {
        name: 'background-processes',
        run: async (): Promise<void> => { await BackgroundTaskManager.shutdownExisting(); }
    },
    // Timer-driven producers stop before the drain, so the drain only waits for
    // work that was already in flight instead of work a tick starts during it
    // (the coordination sweep and completion monitoring both go through SystemLLM).
    { name: 'periodic-producers', run: (): void => { taskService?.stopPeriodicWork(); } },
    { name: 'accepted-event-work', run: (): Promise<void> => EventBus.drain() },
    { name: 'task-handlers', run: shutdownTaskHandlers },
    { name: 'user-input-requests', run: (): void => { UserInputRequestManager.shutdownExisting(); } },
    { name: 'task-orchestration', run: (): void => { taskService?.shutdown(); } },
    { name: 'orpar-memory', run: (): void => { orparMemoryCoordinator?.shutdown(); } },
    { name: 'ephemeral-patterns', run: (): void => { ephemeralEventPatternService?.shutdown(); } },
    { name: 'mode-detection', run: (): void => { modeDetectionService?.shutdown(); } },
    {
        name: 'inference-parameters',
        run: (): void => { InferenceParameterService.shutdownExisting(); }
    },
    { name: 'system-llm-challenges', run: (): void => { systemLlmChallengeService?.shutdown(); } },
    { name: 'system-llm', run: (): void => { systemLlmServiceManager?.shutdown(); } },
    {
        name: 'hybrid-mcp',
        run: async (): Promise<void> => { await hybridMcpService?.shutdown(); }
    },
    {
        name: 'code-execution',
        run: async (): Promise<void> => { await codeExecutionSandboxService?.shutdown(); }
    },
    { name: 'reward-signals', run: (): void => { rewardSignalProcessor?.shutdown(); } },
    {
        name: 'validation-performance-optimization',
        run: (): void => { performanceOptimizationService?.shutdown(); }
    },
    {
        name: 'validation-performance',
        run: (): void => { validationPerformanceService?.shutdown(); }
    },
    {
        name: 'agent-performance',
        run: (): void => { agentPerformanceService?.shutdown(); }
    },
    {
        name: 'predictive-analytics',
        run: (): void => { predictiveAnalyticsService?.cleanup(); }
    },
    {
        name: 'validation-analytics',
        run: (): void => { validationAnalyticsService?.shutdown(); }
    },
    {
        name: 'validation-middleware',
        run: (): void => { validationMiddleware?.shutdown(); }
    },
    {
        name: 'tool-execution-interceptor',
        run: (): void => { toolExecutionInterceptor?.shutdown(); }
    },
    {
        name: 'auto-correction',
        run: (): void => { autoCorrectionService?.shutdown(); }
    },
    {
        name: 'validation-cache',
        run: (): void => { validationCacheService?.shutdown(); }
    },
    {
        name: 'proactive-validation',
        run: (): void => { proactiveValidationService?.shutdown(); }
    },
    {
        name: 'pattern-learning',
        run: (): void => { patternLearningService?.shutdown(); }
    },
    {
        name: 'machine-learning',
        run: async (): Promise<void> => { await machineLearningService?.dispose(); }
    },
    { name: 'shutdown-event-work', run: (): Promise<void> => EventBus.drain() },
    { name: 'event-bus', run: (): void => { EventBus.server.cleanup(); } },
    { name: 'database', run: closeDatabase }
], [
    { before: 'socket-ingress', after: 'accepted-event-work' },
    { before: 'http-ingress', after: 'accepted-event-work' },
    { before: 'http-ingress', after: 'demo-processes' },
    { before: 'demo-processes', after: 'accepted-event-work' },
    { before: 'background-processes', after: 'accepted-event-work' },
    { before: 'socket-ingress', after: 'periodic-producers' },
    { before: 'periodic-producers', after: 'accepted-event-work' },
    { before: 'accepted-event-work', after: 'task-handlers' },
    { before: 'accepted-event-work', after: 'user-input-requests' },
    { before: 'accepted-event-work', after: 'task-orchestration' },
    { before: 'accepted-event-work', after: 'orpar-memory' },
    { before: 'accepted-event-work', after: 'system-llm' },
    { before: 'accepted-event-work', after: 'hybrid-mcp' },
    { before: 'accepted-event-work', after: 'code-execution' },
    { before: 'accepted-event-work', after: 'validation-performance-optimization' },
    { before: 'accepted-event-work', after: 'validation-performance' },
    { before: 'validation-performance', after: 'agent-performance' },
    { before: 'accepted-event-work', after: 'machine-learning' },
    { before: 'machine-learning', after: 'shutdown-event-work' },
    { before: 'shutdown-event-work', after: 'event-bus' },
    { before: 'event-bus', after: 'database' }
]);

const handleShutdownSignal = (signal: NodeJS.Signals): void => {
    runtimeState.markStopping();
    void shutdownCoordinator.shutdown(signal)
        .then((): void => {
            runtimeState.markStopped();
            // Not a literal 0: if this signal arrived while an initialization
            // failure was already shutting down, that failure owns the exit code.
            process.exitCode = runtimeState.getExitCode();
        })
        .catch((error: unknown): void => {
            runtimeState.markFailed();
            logger.error('Graceful server shutdown failed', error);
            process.exitCode = runtimeState.getExitCode();
        });
};

process.once('SIGINT', handleShutdownSignal);
process.once('SIGTERM', handleShutdownSignal);

const handleFatalProcessError = (reason: unknown): void => {
    runtimeState.markFailed();
    logger.error(
        `Fatal process error — shutting down: ${reason instanceof Error ? reason.stack : String(reason)}`
    );
    process.exitCode = 1;
    void shutdownCoordinator.shutdown('fatal process error').catch((error: unknown): void => {
        logger.error('Cleanup after fatal process error did not complete', error);
    });
};

process.once('uncaughtException', handleFatalProcessError);
process.once('unhandledRejection', handleFatalProcessError);

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
                    assertExternalLlmCallAllowed(`${providerStr} Meilisearch embeddings`);
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
                throw error;
            }
        } else {
            logger.info('Meilisearch disabled (ENABLE_MEILISEARCH not set)');
        }

        // Step 1.6: Initialize Code Execution Sandbox (Docker-based)
        try {
            codeExecutionSandboxService = CodeExecutionSandboxService.getInstance();
            const dockerAvailable = await codeExecutionSandboxService.initialize();
            if (dockerAvailable) {
                logger.info('Code execution sandbox initialized with Docker');
            } else {
                logger.warn('Code execution sandbox: Docker not available - code execution disabled');
            }
        } catch (error) {
            logger.error(`Failed to initialize code execution sandbox: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }

        // Step 2: Initialize core services in proper order

        // Initialize service instances
        socketService = new SocketService(io);
        memoryService = MemoryService.getInstance(); // Already initialized with persistence at Step 0
        ChannelContextService.getInstance();

        // Validation/analytics services own background workers and must be explicitly
        // bootstrapped so the shutdown coordinator always has their exact instances.
        validationPerformanceService = ValidationPerformanceService.getInstance();
        agentPerformanceService = AgentPerformanceService.getInstance();
        patternLearningService = PatternLearningService.getInstance();
        autoCorrectionService = AutoCorrectionService.getInstance();
        toolExecutionInterceptor = ToolExecutionInterceptor.getInstance();
        proactiveValidationService = ProactiveValidationService.getInstance();
        validationCacheService = ValidationCacheService.getInstance();
        validationMiddleware = ValidationMiddleware.getInstance();
        validationAnalyticsService = ValidationAnalyticsService.getInstance();
        performanceOptimizationService = PerformanceOptimizationService.getInstance();
        predictiveAnalyticsService = PredictiveAnalyticsService.getInstance();

        McpSocketExecutor.getInstance();
        mcpToolRegistry = McpToolRegistry.getInstance();
        ephemeralEventPatternService = EphemeralEventPatternService.getInstance();
        taskService = TaskService.getInstance();
        initializeTaskHandlers();
        modeDetectionService = ModeDetectionService.getInstance();
        new ServerReflectionService();
        ChannelService.getInstance(io);
        AgentService.getInstance(); // Initialize last to ensure all dependencies are ready
        
        // Initialize SystemLlmServiceManager to load env vars and show configuration at startup
        systemLlmServiceManager = SystemLlmServiceManager.getInstance();

        // Stance challenges (critical / hostile) listen for agent claims and tool
        // results; in supportive stance the service only keeps evidence buffers.
        systemLlmChallengeService = SystemLlmChallengeService.getInstance();
        systemLlmChallengeService.start();

        // Initialize EphemeralEventPatternService
        await ephemeralEventPatternService.initialize();

        // Step 2.5: Initialize MULS services if enabled
        if (process.env.MEMORY_UTILITY_LEARNING_ENABLED === 'true') {
            try {
                // Initialize all MULS services - this sets enabled=true based on env config
                QValueManager.getInstance().initialize();
                rewardSignalProcessor = RewardSignalProcessor.getInstance();
                rewardSignalProcessor.initialize();
                UtilityScorerService.getInstance().initialize();

                logger.info('MULS services initialized (Memory Utility Learning System)');
            } catch (error) {
                logger.error(`Failed to initialize MULS services: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
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
            orparMemoryCoordinator = OrparMemoryCoordinator.getInstance();
            orparMemoryCoordinator.initialize();
            logger.info('ORPAR-Memory integration initialized');
        }

        // Step 2.8: Initialize TensorFlow.js integration if enabled
        if (process.env.TENSORFLOW_ENABLED === 'true') {
            try {
                machineLearningService = MxfMLService.getInstance();
                await machineLearningService.initialize();
                logger.info('TensorFlow.js integration initialized');

                // Step 2.9: Initialize TF.js models in the already-owned analytics service.
                await predictiveAnalyticsService.initializeTensorFlowModels();
                logger.info('PredictiveAnalyticsService TF.js models initialized');
            } catch (error) {
                logger.error(`Failed to initialize TensorFlow.js: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }

        // Step 3: Initialize Hybrid MCP Service
        try {
            hybridMcpService = ServerHybridMcpService.getInstance();
            await hybridMcpService.initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize Hybrid MCP Service: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }

        // Step 3.5: Initialize Tool Execution Persistence Service
        // This listens to tool execution events and persists them to the database
        try {
            await ToolExecutionPersistenceService.getInstance().initialize();
            logger.info('Tool execution persistence service initialized');
        } catch (error) {
            logger.error(`❌ Failed to initialize Tool Execution Persistence Service: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
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
            await mcpToolRegistry.reconcileTools(
                allMxfMcpTools as unknown as Parameters<McpToolRegistry['reconcileTools']>[0],
                'mxf-server',
                'system'
            );

            // Final count
            const finalTools = await firstValueFrom(mcpToolRegistry.listTools());
            loadedToolCount = finalTools.length;

            // Refresh the hybrid registry so it sees newly registered tools
            // (Step 3 took an initial snapshot before these tools were registered)
            if (!hybridMcpService) {
                throw new Error('Hybrid MCP service was not initialized');
            }
            hybridMcpService.getHybridRegistry().refreshInternalTools();

        } catch (error) {
            logger.error(`❌ Failed to initialize MXF MCP tools: ${error}`);
            throw error;
        }

        // Step 5: Initialize McpService for socket-based tool communication
        // NOTE: Must happen AFTER tool registration so McpService loads the new tools
        try {
            await McpService.getInstance().initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize McpService: ${error}`);
            throw error;
        }

        // Step 6: Mount API routes AFTER all services are initialized (including tool registration)
        setupApiRoutes();

        // Step 8: Start the server
        const PORT = serverPort;
        const toolCount = loadedToolCount;

        await listenForHttpServer(server, PORT);
        runtimeState.markReady();
        logger.info('╔════════════════════════════════════════════════════════════════╗');
        logger.info('║              MXF Server Ready                                  ║');
        logger.info('╠════════════════════════════════════════════════════════════════╣');
        logger.info(`║  Port:           ${PORT}`.padEnd(66) + '║');
        logger.info(`║  Tools Loaded:   ${toolCount}`.padEnd(66) + '║');
        logger.info(`║  Environment:    ${process.env.NODE_ENV || 'development'}`.padEnd(66) + '║');
        logger.info('╚════════════════════════════════════════════════════════════════╝');
        
    } catch (error) {
        runtimeState.markFailed();
        logger.error('❌ Server initialization failed:', error);
        try {
            await shutdownCoordinator.shutdown('initialization failure');
        } catch (shutdownError) {
            logger.error('Cleanup after server initialization failure did not complete', shutdownError);
        }
        process.exitCode = 1;
    }
};

/**
 * Setup API routes after all services are initialized
 */
const setupApiRoutes = (): void => {
    if (!socketService) {
        throw new Error('Socket service must be initialized before API routes are mounted');
    }

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
