/**
 * Knowledge Graph (KG) System Demo
 *
 * This demo is FULLY AGENTIC - the agent autonomously:
 * 1. Extracts entities from sample text about a software project
 * 2. Creates additional entities (team members, technologies)
 * 3. Creates relationships between entities
 * 4. Traverses the graph to find paths and neighbors
 * 5. Gets ORPAR phase-specific context
 * 6. Checks for duplicate entities
 *
 * All KG operations happen through actual tool calls - no local simulation.
 *
 * @prerequisites
 * - MXF server running with KNOWLEDGE_GRAPH_ENABLED=true
 * - Environment variables configured (see .env.example)
 *
 * @example
 * ```bash
 * # Start server with Knowledge Graph enabled
 * KNOWLEDGE_GRAPH_ENABLED=true bun run dev
 *
 * # In another terminal, run demo
 * bun run demo:kg
 * ```
 */

import { MxfSDK, Events, LlmProviderType } from '../../src/sdk/index';
import type { MxfAgent, MxfChannelMonitor } from '../../src/sdk/index';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    channelId: `kg-demo-${timestamp}`
};

/**
 * Display demo banner
 */
const displayBanner = (): void => {
    console.log('\n' + '='.repeat(70));
    console.log('KNOWLEDGE GRAPH (KG) - AGENTIC DEMO');
    console.log('='.repeat(70));
    console.log('');
    console.log('This demo shows an agent AUTONOMOUSLY demonstrating the KG system:');
    console.log('');
    console.log('  1. Extract entities from text about a software project');
    console.log('  2. Create entities: people, technologies, organizations');
    console.log('  3. Create relationships: WORKS_ON, USES, DEPENDS_ON');
    console.log('  4. Find paths between entities');
    console.log('  5. Get neighbors of an entity');
    console.log('  6. Retrieve ORPAR phase-specific context');
    console.log('  7. Find potential duplicate entities');
    console.log('');
    console.log('Entity Types: person, technology, organization, project, concept');
    console.log('Relationship Types: WORKS_ON, USES, DEPENDS_ON, OWNS, RELATED_TO');
    console.log('');
    console.log('Watch for:');
    console.log('  - [Agent Thinking] The LLM\'s reasoning process');
    console.log('  - [KG Tool Call] Tool calls with arguments');
    console.log('  - [KG Result] Graph operation results');
    console.log('='.repeat(70));
    console.log('');
};

/**
 * Setup channel monitoring for tool calls, messages, and LLM thinking
 */
const setupMonitoring = (channel: MxfChannelMonitor): Promise<void> => {
    return new Promise((resolve) => {
        const processedIds = new Set<string>();
        const processedToolCalls = new Set<string>();
        const processedToolResults = new Set<string>();
        let taskCompleted = false;

        // Listen for LLM reasoning/thinking
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

        // Listen for agent messages (channel broadcast)
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
            } catch (error) {
                // Silent fail
            }
        });

        // Listen for tool calls (with deduplication)
        channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolCalls.has(callId)) {
                return;
            }
            if (callId) {
                processedToolCalls.add(callId);
                setTimeout(() => processedToolCalls.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || payload.toolName || 'unknown';
            const args = payload.data?.arguments || payload.data?.args || {};

            // Highlight KG-related tool calls
            const kgTools = [
                'kg_create_entity',
                'kg_get_entity',
                'kg_find_entity',
                'kg_create_relationship',
                'kg_get_neighbors',
                'kg_find_path',
                'kg_get_context',
                'kg_get_phase_context',
                'kg_get_high_utility_entities',
                'kg_extract_from_text',
                'kg_find_duplicates'
            ];

            if (kgTools.includes(toolName)) {
                console.log(`\n${'='.repeat(50)}`);
                console.log(`[KG Tool Call] ${toolName}`);
                console.log(`${'='.repeat(50)}`);

                // Pretty print relevant args
                if (toolName === 'kg_create_entity') {
                    console.log(`  Name: ${args.name}`);
                    console.log(`  Type: ${args.type}`);
                    if (args.description) console.log(`  Description: ${args.description}`);
                    if (args.aliases) console.log(`  Aliases: ${JSON.stringify(args.aliases)}`);
                } else if (toolName === 'kg_create_relationship') {
                    console.log(`  From: ${args.fromEntityId}`);
                    console.log(`  To: ${args.toEntityId}`);
                    console.log(`  Type: ${args.type}`);
                    if (args.label) console.log(`  Label: ${args.label}`);
                } else if (toolName === 'kg_find_path') {
                    console.log(`  From: ${args.fromEntityId}`);
                    console.log(`  To: ${args.toEntityId}`);
                    console.log(`  Max Hops: ${args.maxHops || 3}`);
                } else if (toolName === 'kg_get_neighbors') {
                    console.log(`  Entity: ${args.entityId}`);
                    console.log(`  Direction: ${args.direction || 'both'}`);
                } else if (toolName === 'kg_get_phase_context') {
                    console.log(`  Phase: ${args.phase}`);
                } else if (toolName === 'kg_extract_from_text') {
                    console.log(`  Text Length: ${args.text?.length || 0} chars`);
                    console.log(`  Text Preview: ${args.text?.substring(0, 100)}...`);
                } else if (toolName === 'kg_find_duplicates') {
                    console.log(`  Threshold: ${args.threshold || 0.7}`);
                } else {
                    console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
                }
            } else if (toolName === 'task_complete') {
                console.log(`\n[Task Complete] ${args.summary || 'Demo finished'}`);
            }
        });

        // Listen for tool results (with deduplication)
        channel.on(Events.Mcp.TOOL_RESULT, (payload: any) => {
            const callId = payload.data?.callId || payload.eventId || '';
            if (callId && processedToolResults.has(callId)) {
                return;
            }
            if (callId) {
                processedToolResults.add(callId);
                setTimeout(() => processedToolResults.delete(callId), 5000);
            }

            const toolName = payload.data?.toolName || 'unknown';
            // Try multiple paths to find the result data
            let result = payload.data?.result || payload.data?.content || payload.result || {};

            // If result has a nested content array (MCP format), extract it
            if (Array.isArray(result?.content)) {
                const textContent = result.content.find((c: any) => c.type === 'text');
                if (textContent?.text) {
                    try {
                        result = JSON.parse(textContent.text);
                    } catch {
                        result = { message: textContent.text };
                    }
                }
            }

            // Helper to unwrap McpToolResultContent
            // Handles MCP result format: { type: 'text'|'application/json', data: ... }
            const unwrapResult = (rawResult: any): any => {
                if (typeof rawResult === 'string') {
                    try {
                        return JSON.parse(rawResult);
                    } catch {
                        return rawResult;
                    }
                }
                if (rawResult && typeof rawResult === 'object' && rawResult.data !== undefined) {
                    if (typeof rawResult.data === 'string') {
                        try {
                            return JSON.parse(rawResult.data);
                        } catch {
                            return rawResult.data;
                        }
                    }
                    return rawResult.data;
                }
                return rawResult;
            };

            // Show KG tool results
            if (toolName === 'kg_create_entity') {
                console.log(`\n[KG Result - Entity Created]`);
                try {
                    const data = unwrapResult(result);
                    if (data.success === false || data.enabled === false) {
                        console.log(`  KG is DISABLED - enable with KNOWLEDGE_GRAPH_ENABLED=true`);
                    } else if (data.entity) {
                        console.log(`  ID: ${data.entity.id}`);
                        console.log(`  Name: ${data.entity.name}`);
                        console.log(`  Type: ${data.entity.type}`);
                    } else {
                        console.log(`  Message: ${data.message || JSON.stringify(data)}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_create_relationship') {
                console.log(`\n[KG Result - Relationship Created]`);
                try {
                    const data = unwrapResult(result);
                    if (data.relationship) {
                        console.log(`  ID: ${data.relationship.id}`);
                        console.log(`  Type: ${data.relationship.type}`);
                        console.log(`  From → To: ${data.relationship.fromEntityId} → ${data.relationship.toEntityId}`);
                    } else {
                        console.log(`  Message: ${data.message || JSON.stringify(data)}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_get_neighbors') {
                console.log(`\n[KG Result - Neighbors]`);
                try {
                    const data = unwrapResult(result);
                    if (data.entities && data.entities.length > 0) {
                        console.log(`  Found ${data.entities.length} neighbor(s):`);
                        data.entities.forEach((e: any) => {
                            console.log(`    - ${e.name} (${e.type})`);
                        });
                    } else {
                        console.log(`  Message: ${data.message || 'No neighbors found'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_find_path') {
                console.log(`\n[KG Result - Path Found]`);
                try {
                    const data = unwrapResult(result);
                    if (data.found && data.path) {
                        console.log(`  Path Length: ${data.path.entityIds?.length || 0} hops`);
                        console.log(`  Path: ${data.path.entityIds?.join(' → ')}`);
                    } else {
                        console.log(`  Message: ${data.message || 'No path found between entities'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_extract_from_text') {
                console.log(`\n[KG Result - Entities Extracted]`);
                try {
                    const data = unwrapResult(result);
                    if (data.result?.errors?.length > 0) {
                        console.log(`  Status: ${data.result.errors[0]}`);
                    } else if (data.result) {
                        console.log(`  Entities Extracted: ${data.result.entitiesExtracted}`);
                        console.log(`  Relationships Extracted: ${data.result.relationshipsExtracted}`);
                    } else if (data.errors?.length > 0) {
                        console.log(`  Status: ${data.errors[0]}`);
                    } else if (data.entitiesExtracted !== undefined) {
                        console.log(`  Entities Extracted: ${data.entitiesExtracted}`);
                        console.log(`  Relationships Extracted: ${data.relationshipsExtracted || 0}`);
                    } else {
                        console.log(`  Message: ${data.message || JSON.stringify(data)}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_get_phase_context') {
                console.log(`\n[KG Result - Phase Context]`);
                try {
                    const data = unwrapResult(result);
                    if (data.phaseContext) {
                        console.log(`  Phase: ${data.phaseContext.phase}`);
                        console.log(`  Entity Count: ${data.phaseContext.entities?.length || 0}`);
                        if (data.phaseContext.highUtilityEntities?.length > 0) {
                            console.log(`  High-Utility Entities: ${data.phaseContext.highUtilityEntities.length}`);
                        }
                    } else if (data.phase) {
                        console.log(`  Phase: ${data.phase}`);
                        console.log(`  Entity Count: ${data.entities?.length || 0}`);
                    } else {
                        console.log(`  Message: ${data.message || JSON.stringify(data)}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_get_high_utility_entities') {
                console.log(`\n[KG Result - High Utility Entities]`);
                try {
                    const data = unwrapResult(result);
                    if (data.entities && data.entities.length > 0) {
                        console.log(`  Found ${data.entities.length} high-utility entities:`);
                        data.entities.slice(0, 5).forEach((e: any) => {
                            console.log(`    - ${e.name}: Q=${e.utility?.qValue?.toFixed(3) || 'N/A'}`);
                        });
                    } else {
                        console.log(`  Message: ${data.message || 'No high-utility entities found'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            } else if (toolName === 'kg_find_duplicates') {
                console.log(`\n[KG Result - Duplicates]`);
                try {
                    const data = unwrapResult(result);
                    if (data.duplicates && data.duplicates.length > 0) {
                        console.log(`  Found ${data.duplicates.length} potential duplicate(s)`);
                        data.duplicates.forEach((d: any) => {
                            console.log(`    - ${d.entity1?.name} ≈ ${d.entity2?.name} (${(d.similarity * 100).toFixed(0)}%)`);
                        });
                    } else {
                        console.log(`  Message: ${data.message || 'No duplicates found'}`);
                    }
                } catch (e) {
                    console.log(`  Raw: ${JSON.stringify(result, null, 2)}`);
                }
            }
        });

        // Listen for task completion
        channel.on(Events.Task.COMPLETED, (payload: any) => {
            if (taskCompleted) return;
            taskCompleted = true;

            console.log('\n' + '='.repeat(70));
            console.log('[Demo Complete]');
            if (payload.data?.summary) {
                console.log(`Summary: ${payload.data.summary}`);
            }
            console.log('='.repeat(70) + '\n');

            setTimeout(() => resolve(), 1000);
        });
    });
};

/**
 * Create the Knowledge Graph demonstration agent
 */
const createKgAgent = async (
    sdk: MxfSDK,
    channelId: string,
    keys: { keyId: string; secretKey: string }
): Promise<MxfAgent> => {
    const agent = await sdk.createAgent({
        agentId: 'KgDemoAgent',
        name: 'Knowledge Graph Demonstration Agent',
        channelId,
        keyId: keys.keyId,
        secretKey: keys.secretKey,
        description: 'Agent demonstrating Knowledge Graph system through actual tool calls',

        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.3,
        maxTokens: 4000,
        maxIterations: 30, // Enough for creating entities and running analysis

        // Tools for the KG demonstration
        allowedTools: [
            // Entity operations
            'kg_create_entity',
            'kg_get_entity',
            'kg_find_entity',
            // Relationship operations
            'kg_create_relationship',
            'kg_get_neighbors',
            // Graph queries
            'kg_find_path',
            'kg_get_context',
            'kg_get_phase_context',
            'kg_get_high_utility_entities',
            // Extraction
            'kg_extract_from_text',
            // Entity management
            'kg_find_duplicates',
            // Task completion
            'task_complete'
        ],

        agentConfigPrompt: `You are demonstrating the Knowledge Graph (KG) system.

## YOUR MISSION

Execute a complete Knowledge Graph demonstration by performing these steps IN ORDER:

### STEP 1: Extract Entities from Text
Use kg_extract_from_text to automatically extract entities and relationships from this text:

"The MXF project is led by Alice Chen, a senior engineer at TechCorp. The backend uses Node.js and MongoDB, while the frontend is built with React and TypeScript. Bob Martinez handles DevOps using Docker and Kubernetes. The team follows agile methodology and deploys to AWS."

This should create multiple entities (people, technologies, organizations) and relationships.

### STEP 2: Create Additional Entities
Manually create these entities using kg_create_entity:

1. Person: "Carol Davis"
   - Type: person
   - Description: "QA Lead for MXF project"

2. Technology: "Jest"
   - Type: technology
   - Description: "JavaScript testing framework"
   - Aliases: ["jest", "Jest Framework"]

3. Concept: "Test-Driven Development"
   - Type: concept
   - Description: "Software development methodology"
   - Aliases: ["TDD"]

Store the entity IDs as you create them.

### STEP 3: Create Relationships
Use kg_create_relationship to connect entities:

1. Carol Davis WORKS_ON MXF (find MXF project entity first)
2. Carol Davis USES Jest
3. Jest RELATED_TO Test-Driven Development
4. MXF USES Jest

### STEP 4: Get Neighbors
Use kg_get_neighbors to see what entities are connected to MXF:
- Direction: both
This shows all technologies, people, and concepts related to the project.

### STEP 5: Find Path
Use kg_find_path to find the connection between:
- From: Carol Davis
- To: TypeScript (or another tech entity)
- Max hops: 3
This demonstrates graph traversal.

### STEP 6: Get ORPAR Phase Context
Use kg_get_phase_context with phase="planning" to see what context the KG provides for planning.
Then try phase="reasoning" to compare.

### STEP 7: Get High Utility Entities
Use kg_get_high_utility_entities to see which entities have the highest Q-values.
This shows which knowledge is most useful based on past interactions.

### STEP 8: Find Duplicates
Use kg_find_duplicates with threshold=0.7 to check for potential duplicate entities.
This helps maintain graph quality.

### STEP 9: Complete
Call task_complete with a summary including:
- Number of entities created (extracted + manual)
- Number of relationships created
- Path found between entities
- ORPAR phase context insights
- Any duplicates found

## IMPORTANT RULES
- Execute ALL steps in order
- Store entity IDs as you create them for use in relationships
- Use the EXACT entity names specified
- Show your work by explaining what each tool call does
- If KG is disabled, explain how to enable it (KNOWLEDGE_GRAPH_ENABLED=true)`
    });

    await agent.connect();
    return agent;
};

/**
 * Create the Knowledge Graph demonstration task
 */
const createKgTask = async (agent: MxfAgent): Promise<string> => {
    console.log('Creating Knowledge Graph demonstration task...\n');

    const taskId = await agent.mxfService.createTask({
        title: 'Knowledge Graph End-to-End Demonstration',
        description: `# Knowledge Graph System Demo

Demonstrate the Knowledge Graph system by building a project knowledge graph.

## Step 1: Extract from Text
Use kg_extract_from_text on this text about a software project:
"The MXF project is led by Alice Chen, a senior engineer at TechCorp. The backend uses Node.js and MongoDB, while the frontend is built with React and TypeScript. Bob Martinez handles DevOps using Docker and Kubernetes. The team follows agile methodology and deploys to AWS."

## Step 2: Create Additional Entities
- Carol Davis (person) - QA Lead
- Jest (technology) - Testing framework
- Test-Driven Development (concept) - Development methodology

## Step 3: Create Relationships
Connect entities: Carol → MXF, Carol → Jest, Jest → TDD, MXF → Jest

## Step 4: Graph Traversal
- Get neighbors of MXF project
- Find path between Carol Davis and TypeScript

## Step 5: ORPAR Context
- Get phase context for "planning"
- Get phase context for "reasoning"

## Step 6: Entity Management
- Get high utility entities
- Find potential duplicates

## Step 7: Complete
Call task_complete with comprehensive summary.`,

        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: ['KgDemoAgent'],
        completionAgentId: 'KgDemoAgent',
        priority: 'high',
        tags: ['knowledge-graph', 'kg', 'demo', 'agentic'],
        metadata: {
            demo: 'kg',
            scenario: 'end-to-end-demonstration'
        }
    });

    console.log(`Task created: ${taskId}\n`);
    return taskId;
};

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
    cleanupDone: false
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
        await fetch(`${config.serverUrl}/api/agents/KgDemoAgent`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-key-id': cleanupState.credentials.keyId,
                'x-secret-key': cleanupState.credentials.secretKey
            }
        }).catch(() => {});

        // Delete agent memory from MemoryPersistenceService
        await fetch(`${config.serverUrl}/api/agents/KgDemoAgent/memory`, {
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

    // Create SDK with Personal Access Token authentication (REQUIRED)
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
        process.exit(1);
    }

    const sdk = new MxfSDK({
        serverUrl: config.serverUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        accessToken: accessToken
    });

    cleanupState.sdk = sdk;

    try {
        await sdk.connect();
        console.log('SDK connected\n');

        // Create channel
        console.log('Creating demo channel...');
        const channel = await sdk.createChannel(config.channelId, {
            name: 'Knowledge Graph Demo Channel',
            description: 'Demonstrating Knowledge Graph system',
            systemLlmEnabled: false
        });
        console.log(`Channel created: ${config.channelId}\n`);

        // Setup monitoring
        const taskCompletionPromise = setupMonitoring(channel);

        // Generate keys
        console.log('Generating agent keys...');
        const keys = await sdk.generateKey(config.channelId, undefined, 'KG Agent Key');
        cleanupState.credentials = { keyId: keys.keyId, secretKey: keys.secretKey };
        console.log('Keys generated\n');

        // Create agent
        console.log('Creating Knowledge Graph demonstration agent...');
        const agent = await createKgAgent(sdk, config.channelId, keys);
        cleanupState.agent = agent;
        console.log('Agent ready\n');

        // Create task
        await createKgTask(agent);

        console.log('Agent is now executing the Knowledge Graph demonstration...');
        console.log('Watch for [KG Tool Call] messages below.\n');
        console.log('-'.repeat(70) + '\n');

        // Wait for completion with timeout
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log('\nTimeout reached (4 minutes) - the agent may still be working');
                resolve();
            }, 240000); // 4 minutes for full demo
        });

        await Promise.race([taskCompletionPromise, timeoutPromise]);

    } catch (error) {
        console.error('\nDemo failed:', error);
        console.log('\nTroubleshooting:');
        console.log('  1. Ensure MXF server is running: bun run dev');
        console.log('  2. Enable KG: KNOWLEDGE_GRAPH_ENABLED=true bun run dev');
        console.log('  3. Check OPENROUTER_API_KEY is set');
    } finally {
        await cleanup();
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('KNOWLEDGE GRAPH DEMO SUMMARY');
    console.log('='.repeat(70));
    console.log('');
    console.log('What was demonstrated:');
    console.log('  - Entity extraction via kg_extract_from_text');
    console.log('  - Entity creation via kg_create_entity');
    console.log('  - Relationship creation via kg_create_relationship');
    console.log('  - Graph traversal via kg_get_neighbors');
    console.log('  - Path finding via kg_find_path');
    console.log('  - ORPAR phase context via kg_get_phase_context');
    console.log('  - Utility ranking via kg_get_high_utility_entities');
    console.log('  - Duplicate detection via kg_find_duplicates');
    console.log('');
    console.log('Key KG Concepts:');
    console.log('  - Entities: Nodes representing people, technologies, concepts, etc.');
    console.log('  - Relationships: Edges connecting entities (WORKS_ON, USES, etc.)');
    console.log('  - Q-Values: Utility scores learned from task outcomes');
    console.log('  - Phase Context: ORPAR-specific entity retrieval');
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
