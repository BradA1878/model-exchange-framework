#!/usr/bin/env node
/**
 * Fog of War: Connect AI Commander Agents
 * 
 * This script:
 * 1. Starts the game server
 * 2. Registers the custom MCP server with game tools
 * 3. Creates and connects 8 AI commander agents
 * 4. Begins autonomous gameplay
 */

import dotenv from 'dotenv';
import { MxfSDK, LlmProviderType } from '../../src/sdk';
import { GameServer } from './server/server/GameServer';
import { Team, CommanderRole, TurnSummary, GameAction } from './server/types/game';
import { join } from 'path';
import mongoose from 'mongoose';
import { enableClientLogging } from '../../src/shared/utils/Logger';
import gameConfig from './game.config';

// Load environment variables
dotenv.config();

// Enable client-side logging to see SDK internals for debugging
//enableClientLogging('info');

/**
 * Commander configurations for both teams
 */
const COMMANDERS = [
    // Red Team
    {
        id: 'red-scout',
        name: 'Red Scout Alpha',
        team: Team.RED,
        role: CommanderRole.SCOUT,
        personality: `You are Red Scout Alpha, a reconnaissance specialist who excels at gathering intelligence.

**YOUR COMMANDER ID: red-scout** (use this for all tool calls requiring commanderId)

## Your Primary Objectives (Priority Order):
1. Scout aggressively to reduce fog of war - use game_scanPerimeter frequently
2. Identify enemy positions and report via messaging_send
3. Locate high-value resource nodes
4. Avoid direct combat unless necessary
5. Support teammates with intelligence

## Available Tools:
- game_scanPerimeter() - YOUR MOST IMPORTANT TOOL - use every turn
- game_viewTerritory([ids]) - Get details on specific territories
- game_moveUnits(from, to, type, count) - Move units to explore
- game_getTeamStatus() - Check team resources and positions
- game_collectResources(territory) - Gather resources from controlled areas
- messaging_send(targetAgentId, message) - CRITICAL for team coordination

## Strategy:
- Use mobility to explore quickly
- Share ALL intelligence immediately via messaging_send
- Target teammates: Red Warrior Titan, Red Defender Bastion
- Your intel wins battles

## Turn Flow:
This is a MULTI-TURN game. Each turn: scan, plan actions, execute 2-3 tool calls, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },
    {
        id: 'red-warrior',
        name: 'Red Warrior Titan',
        team: Team.RED,
        role: CommanderRole.WARRIOR,
        personality: `You are Red Warrior Titan, an aggressive combat commander who leads assaults.

**YOUR COMMANDER ID: red-warrior** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Capture and hold strategic territories
2. Eliminate enemy units in combat
3. Coordinate attacks with teammates - wait for scouts' intel
4. Prioritize high-value targets

## Available Tools:
- game_moveUnits(from, to, type, count) - YOUR PRIMARY TOOL for attacks
- game_viewTerritory([ids]) - Check targets before attacking
- game_getTeamStatus() - Coordinate with team
- game_collectResources(territory) - Gather from captured territories
- messaging_send(targetAgentId, message) - Request intel from scouts

## Strategy:
- Strike hard and fast
- Overwhelm enemy positions
- Capture strategic points early
- Units: Infantry beats archers, Cavalry beats infantry, Archers beat cavalry

## Turn Flow:
This is a MULTI-TURN game. Each turn: assess situation, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },
    {
        id: 'red-defender',
        name: 'Red Defender Bastion',
        team: Team.RED,
        role: CommanderRole.DEFENDER,
        personality: `You are Red Defender Bastion, a defensive specialist who protects team assets.

**YOUR COMMANDER ID: red-defender** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Fortify critical positions - use game_fortifyPosition
2. Defend resource nodes
3. Counter enemy advances
4. Maintain defensive perimeter

## Available Tools:
- game_fortifyPosition(territory) - YOUR PRIMARY TOOL - build strong defenses
- game_moveUnits(from, to, type, count) - Position defensive units
- game_viewTerritory([ids]) - Monitor controlled territories
- game_getTeamStatus() - Track team assets
- game_collectResources(territory) - Fund fortifications
- messaging_send(targetAgentId, message) - Request support when threatened

## Strategy:
- Build strong defensive lines early
- Don't overextend
- Support teammates who need backup
- Fortifications cost 20 resources, max level 5

## Turn Flow:
This is a MULTI-TURN game. Each turn: check defenses, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },

    // Blue Team
    {
        id: 'blue-scout',
        name: 'Blue Scout Phantom',
        team: Team.BLUE,
        role: CommanderRole.SCOUT,
        personality: `You are Blue Scout Phantom, a stealth reconnaissance expert.

**YOUR COMMANDER ID: blue-scout** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Discover enemy positions without being detected
2. Map out resource locations - use game_scanPerimeter constantly
3. Provide tactical intelligence
4. Find weak points in enemy defenses

## Available Tools:
- game_scanPerimeter() - YOUR MOST IMPORTANT TOOL
- game_viewTerritory([ids]) - Get territory details
- game_moveUnits(from, to, type, count) - Explore carefully
- game_getTeamStatus() - Check team status
- game_collectResources(territory) - Gather resources
- messaging_send(targetAgentId, message) - Share intel constantly

## Strategy:
- Use caution and cunning
- Information is power
- Share intel constantly with Blue Warrior Tempest, Blue Defender Aegis
- Your stealth is your strength

## Turn Flow:
This is a MULTI-TURN game. Each turn: scan, plan actions, execute 2-3 tool calls, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },
    {
        id: 'blue-warrior',
        name: 'Blue Warrior Tempest',
        team: Team.BLUE,
        role: CommanderRole.WARRIOR,
        personality: `You are Blue Warrior Tempest, a tactical combat specialist.

**YOUR COMMANDER ID: blue-warrior** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Execute coordinated strikes based on scout intel
2. Capture strategic positions
3. Eliminate priority threats
4. Maximize combat effectiveness

## Available Tools:
- game_moveUnits(from, to, type, count) - Execute tactical strikes
- game_viewTerritory([ids]) - Assess targets
- game_getTeamStatus() - Coordinate with team
- game_collectResources(territory) - Secure captured areas
- messaging_send(targetAgentId, message) - Request intel and coordinate attacks

## Strategy:
- Fight smart, not just hard
- Use terrain and unit advantages
- Coordinate all major actions with team
- Wait for scout intel before major strikes

## Turn Flow:
This is a MULTI-TURN game. Each turn: assess situation, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },
    {
        id: 'blue-defender',
        name: 'Blue Defender Aegis',
        team: Team.BLUE,
        role: CommanderRole.DEFENDER,
        personality: `You are Blue Defender Aegis, a fortress commander and defense expert.

**YOUR COMMANDER ID: blue-defender** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Create impenetrable defensive positions
2. Protect resource nodes with fortifications
3. Counter enemy attacks
4. Maintain territorial integrity

## Available Tools:
- game_fortifyPosition(territory) - BUILD STRONG DEFENSES
- game_moveUnits(from, to, type, count) - Position defenders
- game_viewTerritory([ids]) - Monitor positions
- game_getTeamStatus() - Track team assets
- game_collectResources(territory) - Fund defenses
- messaging_send(targetAgentId, message) - Call for reinforcements

## Strategy:
- Defense is the best offense
- Fortify key positions early
- Make every inch costly for enemies
- Defend resource nodes and strategic choke points

## Turn Flow:
This is a MULTI-TURN game. Each turn: check defenses, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },

    // Red Support (only active if playersPerTeam >= 4)
    {
        id: 'red-support',
        name: 'Red Support Nexus',
        team: Team.RED,
        role: CommanderRole.SUPPORT,
        personality: `You are Red Support Nexus, a logistics and resource management specialist.

**YOUR COMMANDER ID: red-support** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Maximize resource collection across controlled territories
2. Distribute resources to teammates who need them
3. Coordinate logistics and supply lines
4. Provide strategic intel from collected data

## Available Tools:
- game_collectResources(territory) - YOUR PRIMARY TOOL - gather resources constantly
- game_viewTerritory([ids]) - Monitor resource nodes
- game_getTeamStatus() - Track team resource needs
- game_moveUnits(from, to, type, count) - Secure resource territories
- messaging_send(targetAgentId, message) - Coordinate with team on resource distribution

## Strategy:
- Resources win wars - collect aggressively
- Keep team informed of resource status
- Support teammates with what they need
- Maintain supply lines

## Turn Flow:
This is a MULTI-TURN game. Each turn: collect resources, coordinate, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    },

    // Blue Support (only active if playersPerTeam >= 4)
    {
        id: 'blue-support',
        name: 'Blue Support Conduit',
        team: Team.BLUE,
        role: CommanderRole.SUPPORT,
        personality: `You are Blue Support Conduit, a logistics mastermind and resource coordinator.

**YOUR COMMANDER ID: blue-support** (use this for all tool calls requiring commanderId)

## Your Primary Objectives:
1. Optimize resource collection efficiency
2. Coordinate team logistics
3. Provide strategic resource distribution
4. Support teammates with supplies

## Available Tools:
- game_collectResources(territory) - YOUR PRIMARY TOOL - gather constantly
- game_viewTerritory([ids]) - Scout resource opportunities
- game_getTeamStatus() - Monitor team needs
- game_moveUnits(from, to, type, count) - Secure resource areas
- messaging_send(targetAgentId, message) - Coordinate distribution

## Strategy:
- Be the backbone of the team economy
- Collect early and often
- Keep warriors and defenders supplied
- Information sharing is key

## Turn Flow:
This is a MULTI-TURN game. Each turn: collect resources, support team, execute 2-3 actions, then call game_commitTurn to end YOUR turn. After committing, STOP and wait for the next turn.`
    }
];

/**
 * Generate a per-commander summary of the previous turn's actions
 * This helps agents understand what they did without full conversation history
 */
const generateCommanderTurnSummary = (
    commanderId: string, 
    turnSummary: TurnSummary,
    gameState: any
): string => {
    // Get this commander's actions from the turn
    const myActions = turnSummary.actions.filter(a => a.commanderId === commanderId);
    
    if (myActions.length === 0) {
        return `No actions recorded for Turn ${turnSummary.turn - 1}.`;
    }
    
    // Format actions into readable summary
    const actionSummaries = myActions.map(action => {
        switch (action.actionType) {
            case 'move':
                return `- Moved ${action.parameters.count} ${action.parameters.unitType} from ${action.parameters.from} to ${action.parameters.to}`;
            case 'fortify':
                return `- Fortified ${action.parameters.territoryId}`;
            case 'collect':
                return `- Collected resources from ${action.parameters.territoryId}`;
            default:
                return `- ${action.actionType}: ${JSON.stringify(action.parameters)}`;
        }
    });
    
    // Get commander's current state
    const commander = gameState.commanders.find((c: any) => c.id === commanderId);
    const territoriesOwned = commander?.controlledTerritories?.length || 0;
    const resources = commander?.resources || 0;
    
    return `## 📊 YOUR TURN ${turnSummary.turn - 1} SUMMARY
${actionSummaries.join('\n')}

## 🗺️ YOUR CURRENT STATE
- Territories controlled: ${territoriesOwned}
- Resources: ${resources}
- Team: ${commander?.team || 'unknown'}`;
};

/**
 * Main demo function
 */
async function connectAgents() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║         FOG OF WAR: PARALLEL MINDS                        ║');
    console.log('║         Multi-Agent Strategy Game Demo                    ║');
    console.log('║         Powered by Model Exchange Framework (MXF)         ║');
    console.log('║                                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Validate environment
    if (!process.env.MXF_DOMAIN_KEY || !process.env.OPENROUTER_API_KEY) {
        console.error('❌ Error: Required environment variables not set');
        console.log('Please ensure .env file contains:');
        console.log('  - MXF_DOMAIN_KEY');
        console.log('  - OPENROUTER_API_KEY');
        process.exit(1);
    }

    // MXF server URL - use 3001 like other demos (first-contact, interview-scheduling)
    const mxfServerUrl = process.env.MXF_SERVER_URL || 'http://localhost:3001';

    // Connect to MongoDB for memory cleanup operations
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf');
    console.log('✅ Connected to MongoDB for memory management\n');

    // =================================================================
    // STEP 1: Start Game Server
    // =================================================================
    
    console.log('🎮 Step 1: Starting game server...\n');

    const gameServerPort = parseInt(process.env.GAME_SERVER_PORT || '3002');
    const gameServer = new GameServer(gameServerPort, {
        maxTurns: parseInt(process.env.GAME_MAX_TURNS || '15'),
        turnDuration: parseInt(process.env.GAME_TURN_DURATION || '45000'),
        mapSize: parseInt(process.env.GAME_MAP_SIZE || '12')
    });

    await gameServer.start();

    // Add commanders to game state
    for (const commander of COMMANDERS) {
        gameServer.addCommander(
            commander.id,
            commander.name,
            commander.team,
            commander.role,
            `agent-${commander.id}`
        );
    }

    console.log('✅ Game server running\n');

    // =================================================================
    // STEP 2: Connect to MXF Server
    // =================================================================

    console.log('📡 Step 2: Connecting to MXF server...\n');

    const sdk = new MxfSDK({
        serverUrl: mxfServerUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_DEMO_USERNAME || 'demo-user',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
    });

    await sdk.connect();
    console.log('✅ Connected to MXF server\n');

    // =================================================================
    // STEP 3: Create Game Channel
    // =================================================================

    console.log('📺 Step 3: Creating game channel...\n');

    const channelId = 'fog-of-war-game';
    const channel = await sdk.createChannel(channelId, {
        name: 'Fog of War Battle',
        description: 'Autonomous AI strategy game with 8 commanders',
        maxAgents: 10
    });

    console.log(`✅ Channel created: ${channelId}\n`);

    // =================================================================
    // STEP 4: Register Fog of War MCP Server
    // =================================================================

    console.log('🔧 Step 4: Registering custom MCP server...\n');

    // Create admin agent for MCP registration
    const adminKey = await sdk.generateKey(channelId, 'game-admin');
    
    const adminAgent = await sdk.createAgent({
        agentId: 'game-admin',
        name: 'Game Admin Agent',
        channelId: channelId,
        keyId: adminKey.keyId,
        secretKey: adminKey.secretKey,
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-haiku',
        description: 'Admin agent for MCP server registration',
        allowedTools: [
            'game_viewTerritory',
            'game_moveUnits',
            'game_scanPerimeter',
            'game_fortifyPosition',
            'game_collectResources',
            'game_getTeamStatus',
            'game_calculateOptimalPath'
        ]
    });

    // Register the fog-of-war MCP server at channel level BEFORE connecting admin agent
    // This prevents "tools not found" warning when admin agent connects
    const mcpServerPath = join(__dirname, 'server', 'mcp', 'FogOfWarMcpServerHttp.ts');
    
    console.log('   Registering channel-scoped MCP server (all agents will share this)...\n');
    
    const mcpResult = await adminAgent.registerChannelMcpServer({
        id: 'fog-of-war-game-server',
        name: 'Fog of War Game Tools',
        command: 'ts-node',
        args: [mcpServerPath],
        autoStart: true,
        restartOnCrash: true,
        keepAliveMinutes: 10,  // Keep game server alive for 10 minutes after last agent
        environmentVariables: {
            GAME_SERVER_URL: `http://localhost:${gameServerPort}`
        }
    });

    if (mcpResult.success) {
        console.log('✅ Channel MCP server registered successfully!');
        console.log(`   Tools: ${mcpResult.toolsDiscovered?.join(', ')}`);
        console.log('   All channel agents can now use these tools!\n');
    } else {
        console.error('❌ MCP server registration failed');
        process.exit(1);
    }

    // Now connect admin agent after MCP server is registered
    await adminAgent.connect();

    // =================================================================
    // STEP 5: Clean Up Old Agent Memory (from previous runs)
    // =================================================================

    console.log('🗑️  Step 5: Cleaning up old agent memory from previous runs...\n');

    const { AgentMemory } = require('../../src/shared/models/memory');
    let totalDeleted = 0;

    for (const commander of COMMANDERS) {
        try {
            const result = await AgentMemory.deleteMany({ agentId: commander.id });
            if (result.deletedCount > 0) {
                console.log(`   ✅ Deleted ${result.deletedCount} old memory doc(s) for ${commander.id}`);
                totalDeleted += result.deletedCount;
            }
        } catch (error) {
            console.error(`   ❌ Failed to delete old memory for ${commander.id}:`, error instanceof Error ? error.message : String(error));
        }
    }

    if (totalDeleted > 0) {
        console.log(`\n✅ Cleaned up ${totalDeleted} old memory document(s) from MongoDB\n`);
    } else {
        console.log('   No old memory found (fresh start)\n');
    }

    // =================================================================
    // STEP 6: Create Commander Agents
    // =================================================================

    console.log('👥 Step 6: Creating commander agents...\n');
    console.log(`   Config: ${gameConfig.playersPerTeam} players per team\n`);

    // Available LLM models from config - randomly assigned to each agent
    const availableModels = gameConfig.availableModels;

    const agents: any[] = [];

    // Track model assignments for logging
    const agentModels: Record<string, string> = {};

    // Filter commanders based on playersPerTeam config
    // Roles are ordered: scout, warrior, defender, support (if 4 players)
    const roles = [CommanderRole.SCOUT, CommanderRole.WARRIOR, CommanderRole.DEFENDER, CommanderRole.SUPPORT];
    const activeRoles = roles.slice(0, gameConfig.playersPerTeam);
    const activeCommanders = COMMANDERS.filter(c => activeRoles.includes(c.role));

    console.log(`   Active roles: ${activeRoles.join(', ')}\n`);

    for (const commander of activeCommanders) {
        const key = await sdk.generateKey(channelId, commander.id);
        
        // Randomly select a model for this agent
        const selectedModel = availableModels[Math.floor(Math.random() * availableModels.length)];

        const agent = await sdk.createAgent({
            agentId: commander.id,
            name: commander.name,
            channelId: channelId,
            keyId: key.keyId,
            secretKey: key.secretKey,
            llmProvider: LlmProviderType.OPENROUTER,
            apiKey: process.env.OPENROUTER_API_KEY!,
            defaultModel: selectedModel,
            temperature: 0.7,
            maxTokens: 100000,
            reasoning: { enabled: false }, // Disabled for speed (enable for detailed thinking logs)
            allowedTools: [
                'game_viewTerritory',
                'game_moveUnits',
                'game_scanPerimeter',
                'game_fortifyPosition',
                'game_collectResources',
                'game_getTeamStatus',
                'game_calculateOptimalPath',
                'game_commitTurn',  // Required to end turn
                'messaging_send'   // For team communication
            ],
            agentConfigPrompt: commander.personality
        });

        await agent.connect();
        
        // Agent automatically has access to channel-scoped MCP server tools
        agents.push(agent);
        
        // Store model for logging
        const modelShortName = selectedModel.split('/')[1];
        agentModels[commander.id] = modelShortName;

        // Register model with game server for dashboard display
        const gameServerUrl = process.env.GAME_SERVER_URL || 'http://localhost:3002';
        await fetch(`${gameServerUrl}/api/commander/${commander.id}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel })
        }).catch(() => {}); // Silent fail

        console.log(`   ✅ ${commander.name} (${commander.team} ${commander.role}) → ${modelShortName}`);
    }

    console.log(`\n✅ All ${agents.length} commanders connected and MCP tools registered!\n`);

    // =================================================================
    // STEP 6.5: Setup Messaging Event Listeners for Comm Logs
    // =================================================================
    
    console.log('📡 Setting up messaging event listeners for dashboard...\n');
    
    const { Events } = await import('../../src/shared/events/EventNames');
    const gameServerUrl = process.env.GAME_SERVER_URL || 'http://localhost:3002';
    
    // Use channel-level listener for task assignments (avoids duplicates from per-agent listeners)
    channel.on(Events.Agent.TASK_ASSIGNED, (payload: any) => {
        const agentId = payload.agentId || payload.data?.agentId;
        console.log(`🎯 [${agentId}] Received task assignment`);
    });
    
    // Listen for agent-to-agent messages (direct messages) via channel
    channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
        // Forward to game server for dashboard display
        fetch(`${gameServerUrl}/api/events/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'agent_message',
                fromAgentId: payload.data?.fromAgentId || payload.fromAgentId,
                toAgentId: payload.data?.toAgentId || payload.toAgentId,
                message: payload.data?.content || payload.content,
                timestamp: payload.timestamp || Date.now()
            })
        }).catch(err => console.error('Failed to forward message:', err.message));
    });
    
    // Listen for channel messages (broadcasts) via channel
    channel.on(Events.Message.CHANNEL_MESSAGE, (payload: any) => {
        // Forward to game server for dashboard display
        fetch(`${gameServerUrl}/api/events/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'channel_message',
                fromAgentId: payload.data?.fromAgentId || payload.fromAgentId,
                channelId: payload.channelId,
                message: payload.data?.content || payload.content,
                timestamp: payload.timestamp || Date.now()
            })
        }).catch(err => console.error('Failed to forward message:', err.message));
    });
    
    console.log('✅ Messaging event listeners active - comm logs will appear in dashboard!\n');

    // =================================================================
    // STEP 6.6: Setup Agent Thought/Reasoning Logging
    // =================================================================
    
    console.log('🧠 Setting up agent thought logging...\n');
    
    // Listen for LLM reasoning (extended thinking from claude-sonnet-4.5)
    channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const modelName = agentModels[agentId] || 'unknown';
        const reasoning = payload.data?.reasoning || payload.reasoning;
        if (reasoning && reasoning.length > 0) {
            // Truncate for console, but log full reasoning
            const preview = reasoning.length > 200 ? reasoning.substring(0, 200) + '...' : reasoning;
            console.log(`\n💭 [${agentId}|${modelName}] THINKING:\n${preview}\n`);
            
            // Forward to game server for dashboard display
            fetch(`${gameServerUrl}/api/events/thinking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    reasoning,
                    timestamp: payload.timestamp || Date.now()
                })
            }).catch(() => {}); // Silent fail - dashboard endpoint may not exist
        }
    });
    
    // Listen for LLM responses (agent's actual response text)
    channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
        const agentId = payload.agentId;
        const modelName = agentModels[agentId] || 'unknown';
        // Response text is directly in payload.data (not payload.data.response)
        const response = typeof payload.data === 'string' ? payload.data : payload.data?.text || payload.data?.response || '';
        if (response && response.length > 0) {
            const preview = response.length > 200 ? response.substring(0, 200) + '...' : response;
            console.log(`💬 [${agentId}|${modelName}] SAYS: ${preview}`);
            
            // Forward to game server for dashboard display
            fetch(`${gameServerUrl}/api/events/response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    response,
                    timestamp: payload.timestamp || Date.now()
                })
            }).catch(() => {}); // Silent fail
        }
    });
    
    // Listen for MCP tool calls to display in dashboard
    channel.on(Events.Mcp.TOOL_CALL, (payload: any) => {
        const agentId = payload.agentId;
        const toolName = payload.data?.toolName || payload.toolName;
        if (agentId && toolName) {
            // Forward to game server for dashboard display
            fetch(`${gameServerUrl}/api/events/activity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId,
                    tool: toolName,
                    status: 'calling',
                    timestamp: payload.timestamp || Date.now()
                })
            }).catch(() => {}); // Silent fail
        }
    });
    
    console.log('✅ Agent thought logging active!\n');

    // =================================================================
    // CLEANUP HANDLER: Register immediately after agents are created
    // =================================================================
    
    let shuttingDown = false;
    const cleanup = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        
        console.log('\n\n🛑 Shutting down gracefully...');
        
        try {
            // 1. Stop game server first to prevent any new game actions
            console.log('🎮 Stopping game server...');
            await gameServer.stop();
            
            // 2. Unregister channel MCP server before disconnecting agents
            //    This prevents "Server not found" errors from delayed callbacks
            console.log('🔧 Unregistering channel MCP server...');
            try {
                await adminAgent.unregisterChannelMcpServer('fog-of-war-game-server');
                console.log('   ✅ Channel MCP server unregistered');
            } catch (error) {
                console.error(`   ❌ Failed to unregister MCP server:`, error instanceof Error ? error.message : String(error));
            }
            
            // 3. Clean up agent memory from MongoDB
            //    CRITICAL: Agent memory persists in MongoDB even after disconnect!
            //    Must manually delete to prevent memory accumulation across game runs
            console.log('🗑️  Cleaning up agent memory from MongoDB...');
            const axios = require('axios');
            const apiUrl = process.env.MXF_SERVER_URL || 'http://localhost:3001';

            // Get JWT token for API calls
            const authResponse = await axios.post(`${apiUrl}/api/users/login`, {
                username: process.env.MXF_DEMO_USERNAME || 'demo-user',
                password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
            });
            const jwtToken = authResponse.data.token;

            // Delete agent memory via MongoDB directly (since API doesn't expose this)
            const { AgentMemory } = require('../../src/shared/models/memory');
            for (const commander of COMMANDERS) {
                try {
                    const result = await AgentMemory.deleteMany({ agentId: commander.id });
                    console.log(`   ✅ Deleted ${result.deletedCount} memory doc(s) for ${commander.id}`);
                } catch (error) {
                    console.error(`   ❌ Failed to delete memory for ${commander.id}:`, error instanceof Error ? error.message : String(error));
                }
            }

            // 4. Disconnect all agents (socket cleanup)
            console.log('🔌 Disconnecting agents...');
            for (const agent of agents) {
                try {
                    await agent.disconnect();
                    console.log(`   ✅ Disconnected: ${agent.agentId}`);
                } catch (error) {
                    console.error(`   ❌ Failed to disconnect ${agent.agentId}:`, error instanceof Error ? error.message : String(error));
                }
            }
            
            // 5. Disconnect admin agent
            try {
                await adminAgent.disconnect();
                console.log('   ✅ Disconnected: game-admin');
            } catch (error) {
                console.error(`   ❌ Failed to disconnect admin agent:`, error instanceof Error ? error.message : String(error));
            }

            // 6. Disconnect SDK (closes socket connection)
            console.log('📡 Disconnecting SDK...');
            await sdk.disconnect();

            // 7. Disconnect MongoDB
            console.log('🔌 Disconnecting MongoDB...');
            await mongoose.disconnect();

            console.log('\n✅ Cleanup complete!\n');
            console.log('💡 Agent connections closed and memory released.');
            console.log('   Keys remain active for reconnection (deactivate manually if needed).\n');
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        } finally {
            await mongoose.disconnect().catch(() => {});
            process.exit(0);
        }
    };
    
    // Register cleanup handlers immediately
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // =================================================================
    // STEP 7: Wait for Manual Game Start
    // =================================================================

    console.log('⏸️  Step 7: Waiting for manual game start...\n');
    console.log('   👉 Click the "🎮 Start Game" button in the dashboard to begin!\n');

    // Wait for game start via callback
    await new Promise<void>((resolve) => {
        console.log('   🔌 Registering game start callback...');
        gameServer.onGameStart(() => {
            console.log('🎮 Game start signal received from dashboard!\n');
            resolve();
        });
        console.log('   ✅ Callback registered, waiting for Start Game button click...\n');
    });

    // =================================================================
    // STEP 8: Assign Battle Task to All Commanders
    // =================================================================

    console.log('📝 Step 8: Assigning battle task to commanders...\n');
    
    // Set up monitoring BEFORE task creation to capture all events
    console.log('🔍 Setting up agent activity monitoring...\n');
    
    // Import task events for monitoring
    const { TaskEvents } = await import('../../src/shared/events/event-definitions/TaskEvents');
    const { EventBus } = await import('../../src/shared/events/EventBus');
    
    // Monitor task assignments reaching agents - with detailed payload logging
    EventBus.client.on(TaskEvents.ASSIGNED, (payload: any) => {
        const agentId = payload.data?.toAgentId || payload.toAgentId;
        const taskIdFromPayload = payload.data?.taskId || payload.taskId;
        const hasTaskData = !!payload.data?.task;
        const hasAssignedAgentIds = !!(payload.data?.task?.assignedAgentIds);
        //console.log(`📬 Task assignment: agent=${agentId}, task=${taskIdFromPayload}, hasTask=${hasTaskData}, hasAgentIds=${hasAssignedAgentIds}`);
    });
    
    // Monitor when agents start processing (use channel to avoid duplicates)
    channel.on('agent:task_started', (payload: any) => {
        console.log(`🚀 Agent started task processing: ${payload.agentId || payload.data?.agentId}`);
    });
    
    // Monitor task creation confirmation (use channel to avoid duplicates)
    let taskCreatedLogged = false;
    channel.on(TaskEvents.CREATED, (payload: any) => {
        if (!taskCreatedLogged) {
            console.log(`✅ Task created event received: ${payload.data?.taskId || payload.taskId}`);
            taskCreatedLogged = true;
        }
    });

    // Create collaborative battle task for all commanders
    const taskId = await adminAgent.mxfService.createTask({
        title: 'Fog of War: Strategic Battle - Turn 0',
        description: `# 🎮 FOG OF WAR: PARALLEL MINDS - BATTLE BEGINS!

## 🎯 COMMANDERS - USE THESE EXACT IDs
**RED TEAM (3 commanders):**
- **Red Scout Alpha (id: red-scout)** - Reconnaissance Specialist
- **Red Warrior Titan (id: red-warrior)** - Offensive Commander  
- **Red Defender Bastion (id: red-defender)** - Defensive Commander

**BLUE TEAM (3 commanders):**
- **Blue Scout Phantom (id: blue-scout)** - Reconnaissance Specialist
- **Blue Warrior Tempest (id: blue-warrior)** - Offensive Commander
- **Blue Defender Aegis (id: blue-defender)** - Defensive Commander

## 🗺️ SITUATION
The battlefield is shrouded in fog of war! Each team starts with limited visibility and must use strategy, coordination, and tactical prowess to achieve victory.

## 🎯 MISSION OBJECTIVE
Work with your team to control the most territory, defeat enemy commanders, and achieve battlefield dominance by Turn 15.

## ⚔️ YOUR TOOLS - USE THESE FUNCTIONS
- **game_scanPerimeter()** - Reveal fog of war in adjacent territories
- **game_viewTerritory(territoryIds)** - Get detailed info about territories you can see
- **game_getTeamStatus()** - See your team's overall situation
- **game_moveUnits(from, to, unitType, count)** - Move troops between territories
- **game_fortifyPosition(territoryId)** - Build defenses
- **game_collectResources(territoryId)** - Gather resources from controlled territories
- **game_calculateOptimalPath(from, to, avoidEnemies)** - Find best route
- **messaging_send(recipientId, message)** - Communicate with teammates
- **game_commitTurn(summary)** - Submit your turn when ready
- **task_complete({ summary: "..." })** - ONLY call this AFTER game_commitTurn!

## 🎮 GAMEPLAY FLOW (COMPLETE WITHIN 3-5 TOOL CALLS!)
1. **SCOUT** - Use game_scanPerimeter() to reveal nearby territories
2. **ASSESS** - Use game_viewTerritory() to analyze what you can see (optional)
3. **ACT** - Use game_moveUnits(), game_fortifyPosition(), or game_collectResources()
4. **COMMIT** - Call game_commitTurn("your decision summary")
5. **🚨 FINISH** - Call task_complete({ summary: "Turn X complete" }) - ONLY after step 4!

## ⚡ CRITICAL RULES - READ CAREFULLY!
- **⛔ NEVER call task_complete BEFORE game_commitTurn!** You must commit first!
- **REQUIRED SEQUENCE**: Scout → Act → game_commitTurn() → task_complete()
- Complete within 3-5 tool calls - don't overthink!
- The turn will NOT execute until ALL commanders commit
- After 2-3 information gathering calls, COMMIT and FINISH!

## 🏆 VICTORY CONDITIONS
- Control the most territory by Turn 15
- Eliminate all enemy commanders
- Achieve resource dominance

## 🚨 START NOW!
This is Turn 0. Use game_scanPerimeter() IMMEDIATELY to begin revealing the battlefield!`,
        assignmentScope: 'multiple',
        assignmentStrategy: 'manual',
        assignedAgentIds: COMMANDERS.map(c => c.id),
        coordinationMode: 'collaborative',
        priority: 'high',
        tags: ['fog-of-war', 'strategy', 'multi-agent', 'turn-based'],
        metadata: {
            mission: 'Fog of War Battle',
            gameType: 'strategy',
            scenario: 'parallel-minds',
            // Each agent completes their own turn independently
            assignmentScope: 'multiple',
            assignedAgentIds: COMMANDERS.map(c => c.id)
        }
    });

    console.log(`✅ Battle task created: ${taskId}`);
    console.log('⚔️  All commanders have been assigned their mission!\n');

    // =================================================================
    // Register turn completion handler to create task for next turn
    // =================================================================
    gameServer.onTurnComplete(async (turn: number, turnSummary: TurnSummary) => {
        console.log(`\n🔄 Turn ${turn} starting - creating task for all agents...\n`);
        
        // STEP 1: Cancel all active tasks to stop in-flight operations
        // This is critical to prevent agents from continuing Turn N-1 processing
        console.log('   🛑 Canceling active tasks to stop Turn N-1 processing...');
        for (const agent of agents) {
            try {
                const taskManager = agent.getTaskExecutionManager?.();
                if (taskManager && typeof taskManager.cancelCurrentTask === 'function') {
                    taskManager.cancelCurrentTask(`Turn ${turn} starting - previous turn complete`);
                }
            } catch (error) {
                // Silently continue if task manager not available
            }
        }
        
        // Brief delay to let cancellation propagate
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // STEP 2: Clear conversation history for fresh context
        console.log('   🧹 Clearing agent conversation history for fresh context...');
        for (const agent of agents) {
            try {
                const memoryManager = agent.getMemoryManager?.();
                if (memoryManager && typeof memoryManager.clearConversationHistory === 'function') {
                    memoryManager.clearConversationHistory();
                }
            } catch (error) {
                // Silently continue if memory manager not available
            }
        }
        
        // Brief delay to let any remaining operations settle before creating new task
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Get current game state for generating summaries
        const gameState = gameServer.getGameState().getState();
        
        // Create a new task for this turn with per-commander summaries
        // Note: The task description is shared, but each agent can see their own ID
        // So we include a generic summary and let agents use memory_search if needed
        const turnTaskId = await adminAgent.mxfService.createTask({
            title: `Fog of War: Turn ${turn}`,
            description: `# 🚨 TURN ${turn} - ACT NOW!

This is Turn ${turn}. Your conversation history has been cleared for fresh context.

## 📊 TURN ${turn - 1} RESULTS (${turnSummary.actions.length} total actions executed)
${turnSummary.actions.slice(0, 10).map(a => `- ${a.commanderId}: ${a.actionType} ${a.actionType === 'move' ? `${a.parameters.from}→${a.parameters.to}` : a.parameters.territoryId || ''}`).join('\n')}
${turnSummary.actions.length > 10 ? `... and ${turnSummary.actions.length - 10} more actions` : ''}

## ⚔️ YOUR TOOLS
- **game_scanPerimeter()** - Reveal territory (ONCE per turn!)
- **game_getTeamStatus()** - Check team status
- **game_moveUnits(from, to, unitType, count)** - Move troops
- **game_fortifyPosition(territoryId)** - Build defenses
- **game_collectResources(territoryId)** - Gather resources
- **game_commitTurn(summary)** - Submit your turn
- **task_complete({ summary: "..." })** - ONLY call AFTER game_commitTurn!

## ⚡ REQUIRED SEQUENCE (3-5 tool calls max!):
1. Scout OR check status (1 call - NOT both!)
2. Take 1-2 tactical actions (move, fortify, collect)
3. Call game_commitTurn() to submit Turn ${turn}
4. Call task_complete({ summary: "Turn ${turn} complete" }) - ONLY after step 3!

⛔ NEVER call task_complete before game_commitTurn!
⚠️ Do NOT repeat tool calls - each tool only needs to be called ONCE!
🚨 ACT NOW - Complete your turn in 3-5 tool calls!`,
            assignmentScope: 'multiple',
            assignmentStrategy: 'manual',
            assignedAgentIds: COMMANDERS.map(c => c.id),
            coordinationMode: 'collaborative',
            priority: 'high',
            tags: ['fog-of-war', 'strategy', `turn-${turn}`],
            metadata: {
                turn,
                // Each agent completes their own turn independently
                assignmentScope: 'multiple',
                assignedAgentIds: COMMANDERS.map(c => c.id)
            }
        });
        
        console.log(`   ✅ Turn ${turn} task created: ${turnTaskId}`);
    });
    console.log('✅ Turn completion handler registered!\n');
    
    // Wait for task assignments to propagate through MXF
    console.log('⏳ Waiting 5 seconds for task assignments to propagate...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check agent task processing status
    console.log('🔄 Checking agent task processing status...\n');
    for (const agent of agents) {
        const hasTask = agent.hasActiveTask?.() || false;
        console.log(`   Agent ${agent.agentId}: hasActiveTask=${hasTask}`);
    }
    console.log('');

    // =================================================================
    // STEP 9: Game Ready and Running
    // =================================================================

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                  GAME RUNNING!                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log('📊 Game State:');
    console.log(`   Turn: ${gameServer.getGameState().getState().turn}`);
    console.log(`   Phase: ${gameServer.getGameState().getState().phase}`);
    console.log(`   Commanders: ${gameServer.getGameState().getState().commanders.length}`);

    console.log('\n🌐 Access Points:');
    console.log(`   Game Server: http://localhost:${gameServerPort}`);
    console.log(`   Dashboard: http://localhost:3003 (run: cd client && npm run dev)`);
    console.log(`   WebSocket: ws://localhost:${gameServerPort}`);

    console.log('\n💡 What Happens Next:');
    console.log('   - Agents will autonomously execute turns');
    console.log('   - Commanders will scout, attack, defend, and coordinate');
    console.log('   - Game ends at turn 15 or when victory conditions are met');
    console.log('   - Watch the dashboard for real-time visualization');

    console.log('\n⚠️  Press Ctrl+C to stop\n');

    // Keep process alive (cleanup handlers already registered above)
    await new Promise(() => {});
}

// Run the demo
if (require.main === module) {
    connectAgents().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

export { connectAgents };
