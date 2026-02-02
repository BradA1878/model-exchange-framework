/**
 * TensorFlow.js Integration Demo
 *
 * This demo is FULLY AGENTIC - the agent autonomously:
 * 1. Connects to an MXF server with TensorFlow.js enabled
 * 2. Executes tool calls that generate ML training data
 * 3. Observes ML model training and inference events
 * 4. Reports prediction accuracy and model performance
 *
 * All ML operations happen through the MxfMLService — the agent interacts
 * with ML-enhanced tools (predict_errors, detect_anomalies) that use
 * TensorFlow.js models under the hood.
 *
 * @prerequisites
 * - MXF server running with TENSORFLOW_ENABLED=true
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * # Start server with TensorFlow.js enabled
 * TENSORFLOW_ENABLED=true bun run dev
 *
 * # In another terminal, run demo
 * bun run demo:tensorflow
 * ```
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import { TensorFlowEvents } from '../../src/shared/events/event-definitions/TensorFlowEvents';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `tensorflow-demo-${timestamp}`,
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '='.repeat(70));
    console.log('TENSORFLOW.JS INTEGRATION - AGENTIC DEMO');
    console.log('='.repeat(70));
    console.log('');
    console.log('This demo shows an agent using TensorFlow.js ML models:');
    console.log('');
    console.log('  1. Error Prediction: ML classifier predicts tool call failures');
    console.log('  2. Anomaly Detection: Autoencoder detects unusual patterns');
    console.log('  3. Model Lifecycle: Training, saving, loading, inference');
    console.log('');
    console.log('Watch for:');
    console.log('  - [TF Training] Model training events with loss/accuracy');
    console.log('  - [TF Inference] ML predictions vs heuristic fallbacks');
    console.log('  - [TF Memory] Tensor memory usage snapshots');
    console.log('  - [Agent Thinking] The LLM reasoning process');
    console.log('='.repeat(70));
    console.log('');
};

/**
 * Setup channel monitoring for tool calls, messages, and TF events
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        const processedToolCalls = new Set<string>();

        // Listen for LLM reasoning
        channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
            const reasoning = payload.data?.reasoning || payload.data?.content || payload.data || '';
            if (reasoning && typeof reasoning === 'string' && reasoning.length > 0) {
                console.log(`\n${'─'.repeat(70)}`);
                console.log('[Agent Thinking]');
                console.log('─'.repeat(70));
                console.log(reasoning);
                console.log('─'.repeat(70) + '\n');
            }
        });

        // Listen for LLM responses
        channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
            const response = payload.data?.response || payload.data?.content || payload.data || '';
            if (response && typeof response === 'string' && response.length > 0) {
                console.log(`\n${'═'.repeat(70)}`);
                console.log('[Agent Response]');
                console.log('═'.repeat(70));
                console.log(response);
                console.log('═'.repeat(70) + '\n');
            }
        });

        // Listen for agent messages
        channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
            try {
                const messageId = payload.data?.metadata?.messageId ||
                    `${payload.agentId}-${payload.timestamp || Date.now()}`;

                if (processedIds.has(messageId)) return;
                processedIds.add(messageId);
                setTimeout(() => processedIds.delete(messageId), 5000);

                let content = payload.data?.content || payload.data?.message || '';
                if (typeof content === 'object') {
                    content = content.data || content.content || JSON.stringify(content);
                }

                if (content && content.length > 0) {
                    console.log(`\n[Agent Broadcast Message]\n${content}\n`);
                }
            } catch {
                // Silent fail
            }
        });

        // Listen for tool calls
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolCalls.has(callId)) return;
            if (callId) {
                processedToolCalls.add(callId);
                setTimeout(() => processedToolCalls.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight ML-related tool calls
            const mlTools = [
                'predict_errors', 'detect_anomalies',
                'proactive_suggestions', 'calculate_risk', 'model_metadata',
                'memory_store', 'memory_retrieve',
                'tools_recommend', 'error_diagnose',
            ];

            if (mlTools.includes(toolName)) {
                console.log(`\n${'='.repeat(50)}`);
                console.log(`[ML Tool Call] ${toolName}`);
                console.log(`${'='.repeat(50)}`);
                console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
            }
        });

        // Listen for tool results
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const toolName = payload.data?.toolName || '';
            if (toolName.startsWith('predict_') || toolName.startsWith('detect_')) {
                const result = payload.data?.result;
                console.log(`\n[ML Tool Result] ${toolName}`);
                if (result) {
                    console.log(`  ${JSON.stringify(result, null, 2)}`);
                }
            }
        });

        // Listen for TensorFlow events
        channel.on(TensorFlowEvents.MODEL_TRAINING_STARTED, (payload: any) => {
            const data = payload.data || payload;
            console.log(`\n[TF Training Started] ${data.modelId} (${data.trainingSamples} samples, ${data.epochs} epochs)`);
        });

        channel.on(TensorFlowEvents.MODEL_TRAINING_COMPLETED, (payload: any) => {
            const data = payload.data || payload;
            console.log(`\n[TF Training Completed] ${data.modelId}`);
            console.log(`  Loss: ${data.loss?.toFixed(4) ?? 'N/A'}`);
            console.log(`  Val Loss: ${data.valLoss?.toFixed(4) ?? 'N/A'}`);
            console.log(`  Accuracy: ${data.accuracy?.toFixed(4) ?? 'N/A'}`);
            console.log(`  Duration: ${data.durationMs}ms`);
            console.log(`  Samples: ${data.samplesUsed}`);
        });

        channel.on(TensorFlowEvents.MODEL_TRAINING_FAILED, (payload: any) => {
            const data = payload.data || payload;
            console.log(`\n[TF Training FAILED] ${data.modelId}: ${data.error}`);
        });

        channel.on(TensorFlowEvents.INFERENCE_COMPLETED, (payload: any) => {
            const data = payload.data || payload;
            console.log(`[TF Inference] ${data.modelId} (${data.latencyMs?.toFixed(1)}ms, source=${data.source})`);
        });

        channel.on(TensorFlowEvents.INFERENCE_FALLBACK, (payload: any) => {
            const data = payload.data || payload;
            console.log(`[TF Fallback] ${data.modelId} (reason=${data.reason})`);
        });

        channel.on(TensorFlowEvents.MEMORY_WARNING, (payload: any) => {
            const data = payload.data || payload;
            console.log(`\n[TF Memory WARNING] ${data.utilizationPercent?.toFixed(0)}% ` +
                `(${(data.numBytes / 1024 / 1024).toFixed(1)}MB / ${(data.maxBytes / 1024 / 1024).toFixed(0)}MB, ` +
                `${data.numTensors} tensors)`);
        });

        channel.on(TensorFlowEvents.MEMORY_STATS, (payload: any) => {
            const data = payload.data || payload;
            if (data.numTensors > 0) {
                console.log(`[TF Memory] ${data.numTensors} tensors, ` +
                    `${(data.numBytes / 1024).toFixed(1)}KB`);
            }
        });

        // Listen for task completion
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            console.log('\n' + '='.repeat(70));
            console.log('[Demo Complete]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log('='.repeat(70) + '\n');

            setTimeout(() => resolve(), 1000);
        });

        // Timeout
        setTimeout(() => {
            console.log('\nMonitoring timeout reached');
            resolve();
        }, 300000); // 5 minute timeout
    });
};

/**
 * Create the TensorFlow demo agent
 */
const createTfAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'TfDemoAgent',
        name: 'TensorFlow.js Demo Agent',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'Agent demonstrating TensorFlow.js ML integration',

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: process.env.MXF_DEMO_MODEL || 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        maxTokens: 4000,
        maxHistory: 50, // Demo agents are ephemeral — 50 messages is sufficient context
        maxIterations: 30,

        capabilities: ['ml_prediction', 'anomaly_detection', 'memory_learning'],
        allowedTools: [
            'predict_errors', 'detect_anomalies',
            'proactive_suggestions', 'calculate_risk', 'model_metadata',
            'tools_recommend', 'tools_discover',
            'memory_store', 'memory_retrieve',
            'error_diagnose', 'tool_help',
            'orpar_observe', 'orpar_reason', 'orpar_plan',
            'orpar_act', 'orpar_reflect',
            'task_complete',
        ],
        agentConfigPrompt: `You are an ML-enhanced agent demonstrating TensorFlow.js integration.

Your ML tools:
- predict_errors: Predict error probability for a tool call (ML model or heuristic fallback)
- detect_anomalies: Detect parameter, behavioral, and performance anomalies
- proactive_suggestions: Get optimization suggestions based on context and history
- calculate_risk: Get composite risk score (0-100) with mitigation strategies
- model_metadata: Inspect ML model training status, accuracy, and health

IMPORTANT EXECUTION RULES:
- Complete your ENTIRE task in ONE ORPAR cycle.
- During ACT: call ALL ML tools (model_metadata, predict_errors, detect_anomalies, calculate_risk, proactive_suggestions, memory_store).
- After REFLECT: call task_complete IMMEDIATELY. Do NOT start another ORPAR cycle.
- You have a limited iteration budget — be efficient.`,
    });

    await agent.connect();
    return agent;
};

/**
 * Create the TensorFlow demonstration task
 */
const createTfTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating TensorFlow.js demonstration task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'TensorFlow.js ML Pipeline Demo',
        description: `Demonstrate the TensorFlow.js integration in a SINGLE ORPAR cycle:

OBSERVE: Check ML model status with model_metadata. Note whether TF.js models are trained.

REASON: Analyze the model status. If models are untrained, predictions will use heuristic fallback. This is expected and demonstrates graceful degradation.

PLAN: Plan to call ALL of these ML tools during the ACT phase:
  - predict_errors (for tools_recommend with intent "analyze data patterns")
  - detect_anomalies (for tools_recommend with the same parameters)
  - calculate_risk (for a memory_store operation)
  - proactive_suggestions (for current context)
  - memory_store (to save your observations)

ACT: Execute ALL planned ML tool calls. For each, note whether it used the ML model or heuristic fallback.

REFLECT: Summarize findings — how many used ML vs heuristic, what the predictions were, and what this demonstrates about graceful degradation.

After REFLECT, call task_complete to finish.`,
        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['TfDemoAgent'],
        completionAgentId: 'TfDemoAgent',
        priority: 'high',
        tags: ['tensorflow', 'ml', 'demo', 'agentic'],
        metadata: {
            demo: 'tensorflow',
            scenario: 'ml-pipeline-demonstration'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    return taskId;
};

/**
 * Pre-clean residual TfDemoAgent state from a previous interrupted run.
 * The agent ID is fixed ('TfDemoAgent'), so leftover memory/registration
 * from a crashed demo causes "memory would exceed limit" warnings.
 */
async function preClean(credentials: { keyId: string; secretKey: string }): Promise<void> {
    const headers = {
        'Content-Type': 'application/json',
        'x-key-id': credentials.keyId,
        'x-secret-key': credentials.secretKey,
    };
    console.log('Pre-cleaning residual TfDemoAgent state...');
    const memResp = await fetch(`${config.serverUrl}/api/agents/TfDemoAgent/memory`, {
        method: 'DELETE', headers,
    }).catch(() => null);
    const agentResp = await fetch(`${config.serverUrl}/api/agents/TfDemoAgent`, {
        method: 'DELETE', headers,
    }).catch(() => null);
    console.log(`Pre-clean complete (memory: ${memResp?.ok ? 'cleaned' : 'none found'}, agent: ${agentResp?.ok ? 'cleaned' : 'none found'})\n`);
}

// Cleanup state
let cleanupState: {
    agent: MxfAgent | null;
    sdk: MxfSDK | null;
    credentials: { keyId: string; secretKey: string } | null;
    cleanupDone: boolean;
} = {
    agent: null,
    sdk: null,
    credentials: null,
    cleanupDone: false,
};

/**
 * Cleanup function
 */
async function cleanup(): Promise<void> {
    if (cleanupState.cleanupDone) return;
    cleanupState.cleanupDone = true;

    console.log('\nCleaning up...');

    if (cleanupState.agent) {
        await cleanupState.agent.disconnect().catch(() => {});
    }

    if (cleanupState.credentials) {
        // Delete agent registration and its AgentMemory documents
        await fetch(`${config.serverUrl}/api/agents/TfDemoAgent`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete agent memory from MemoryPersistenceService
        await fetch(`${config.serverUrl}/api/agents/TfDemoAgent/memory`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete channel
        await fetch(`${config.serverUrl}/api/channels/${config.channelId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});
    }

    if (cleanupState.sdk) {
        await cleanupState.sdk.disconnect().catch(() => {});
    }

    console.log('Cleanup complete');
}

// Handle signals
process.on('SIGINT', async () => {
    console.log('\nInterrupted (Ctrl+C)');
    await cleanup();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\nTerminated');
    await cleanup();
    process.exit(143);
});

/**
 * Main demo function
 */
async function demo() {
    displayBanner();

    // Initialize SDK
    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_DEMO_USERNAME || 'demo-user',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234',
    });

    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'TensorFlow.js Demo Channel',
            description: 'Demonstrating TensorFlow.js ML integration',
            systemLlmEnabled: false,
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'TF Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Clean up residual state from any previous interrupted run
        await preClean(cleanupState.credentials);

        // Create agent
        console.log('Creating TensorFlow.js demo agent...');
        const agent = await createTfAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create task
        await createTfTask(agent);

        console.log('Agent is now executing the TensorFlow.js demo...');
        console.log('Watch for [TF Training], [TF Inference], and [ML Tool Call] messages below.\n');
        console.log('-'.repeat(70) + '\n');

        // Wait for completion with timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (4 minutes) - the agent may still be working');
                resolve();
            }, 240000);
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

    } catch (error) {
        console.error('\nDemo failed:', error);
        console.log('\nTroubleshooting:');
        console.log('  1. Ensure MXF server is running: TENSORFLOW_ENABLED=true bun run dev');
        console.log('  2. Check OPENROUTER_API_KEY is set');
        console.log('  3. Check TENSORFLOW_ENABLED=true in server env');
    } finally {
        await cleanup();
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('TENSORFLOW.JS DEMO SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('What was demonstrated:');
    console.log('  - ML-enhanced error prediction via predict_errors tool');
    console.log('  - Graceful fallback to heuristics when models are untrained');
    console.log('  - Training data generation through tool call history');
    console.log('  - TensorFlow.js event lifecycle (training, inference, memory)');
    console.log('  - Model persistence via MongoDB GridFS');
    console.log('');
    console.log('Key TF.js Concepts:');
    console.log('  - Feature Flag: TENSORFLOW_ENABLED=true to opt in');
    console.log('  - Lazy Import: TF.js only loaded when enabled');
    console.log('  - Graceful Degradation: Heuristic fallback when model unavailable');
    console.log('  - Tensor Memory: tf.tidy() prevents memory leaks');
    console.log('  - GridFS Persistence: Models saved to MongoDB');
    console.log('');
}

// Run demo
demo()
    .then(() => {
        console.log('Demo completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Demo failed:', error);
        process.exit(1);
    });

export { demo };
