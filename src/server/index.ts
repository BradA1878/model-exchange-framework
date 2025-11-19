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

import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server as socketIo } from 'socket.io';
import dotenv from 'dotenv';
dotenv.config();
import { connectToDatabase } from './socket/services/DatabaseService';
import { SocketService } from './socket/services/SocketService';
import { ChannelService } from './socket/services/ChannelService';
import { AgentService } from './socket/services/AgentService';
import { ControlLoopService } from './socket/services/ControlLoopService';
import { ChannelContextService } from '../shared/services/ChannelContextService';
import { ServerReflectionService } from './socket/services/ServerReflectionService';
import { MemoryService } from '../shared/services/MemoryService';
import { MemoryPersistenceService } from './api/services/MemoryPersistenceService';
import { Logger } from '../shared/utils/Logger';
import apiRoutes from './api/routes';
import { DEFAULT_SERVER_CONFIG } from '../sdk/config';
import { authenticateDual } from './api/middleware/dualAuth';
import { McpSocketExecutor } from './socket/services/McpSocketExecutor'; // Import McpSocketExecutor
import { ServerHybridMcpService } from './api/services/ServerHybridMcpService';
import { EphemeralEventPatternService } from './socket/services/EphemeralEventPatternService';
import { TaskService } from './socket/services/TaskService';
import { McpService } from './socket/services/McpService';
import { ModeDetectionService } from './socket/services/ModeDetectionService';
import { SystemLlmServiceManager } from './socket/services/SystemLlmServiceManager';
import { allMxfMcpTools } from '../shared/protocols/mcp/tools/index'; // Import MXF tools
import { McpToolRegistry } from './api/services/McpToolRegistry'; // Import McpToolRegistry
import { firstValueFrom } from 'rxjs';
import { MxfMeilisearchService, EmbeddingGenerator } from '../shared/services/MxfMeilisearchService';

/**
 * Initialize logger with appropriate context
 */
const logger = new Logger('debug', 'Server', 'server');

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
    '/webhooks/n8n'  // n8n webhook endpoints (external integration)
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
app.use(express.json());
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
        MemoryService.getInstance({
            persistenceService: MemoryPersistenceService.getInstance()
        });

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

                        const OpenAI = require('openai').default;
                        const client = new OpenAI({
                            apiKey: process.env.OPENROUTER_API_KEY,
                            baseURL: 'https://openrouter.ai/api/v1'
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

                        const OpenAI = require('openai').default;
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
        
        // Step 3: Initialize Hybrid MCP Service
        try {
            await ServerHybridMcpService.getInstance().initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize Hybrid MCP Service: ${error instanceof Error ? error.message : String(error)}`);
            // Don't exit - let the server continue without hybrid MCP if it fails
        }
        
        // Step 4: Initialize McpService for socket-based tool communication
        try {
            await McpService.getInstance().initialize();
        } catch (error) {
            logger.error(`❌ Failed to initialize McpService: ${error}`);
        }

        // Step 5: Load existing MCP tools from database and register new ones
        try {
            
            // Force load tools from database before attempting registration
            // This ensures we don't try to re-register tools that already exist
            const existingTools = await firstValueFrom(mcpToolRegistry.listTools());
            
            // Now register any new tools that aren't in the database yet
            const existingToolNames = new Set(existingTools.map(t => t.name));
            const newTools = allMxfMcpTools.filter(tool => !existingToolNames.has(tool.name));
            
            if (newTools.length === 0) {
            } else {
                let successCount = 0;
                
                for (const tool of newTools) {
                    try {
                        const success = await firstValueFrom(mcpToolRegistry.registerTool(
                            tool as any,
                            'mxf-server',
                            'system'
                        ));
                        if (success) {
                            successCount++;
                        }
                    } catch (error) {
                        logger.warn(`Failed to register tool ${tool.name}: ${error}`);
                    }
                }
                
            }
            
            // Final count
            const finalTools = await firstValueFrom(mcpToolRegistry.listTools());
            
        } catch (error) {
            logger.error(`❌ Failed to initialize MXF MCP tools: ${error}`);
        }
        
        // Step 6: Verify all services are ready
        if (serverReflectionService) {
        }
        
        // Step 7: Mount API routes AFTER all services are initialized
        setupApiRoutes();
        
        // Step 8: Start the server
        const PORT = process.env.AGENT_FRAMEWORK_PORT || DEFAULT_SERVER_CONFIG.port;
        server.listen(PORT, () => {
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
                    port: process.env.AGENT_FRAMEWORK_PORT || DEFAULT_SERVER_CONFIG.port
                },
                socket: {
                    status: socketServerRunning ? 'running' : 'not_running',
                    port: process.env.AGENT_FRAMEWORK_PORT || DEFAULT_SERVER_CONFIG.port
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
