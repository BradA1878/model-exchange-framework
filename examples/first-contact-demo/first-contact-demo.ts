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
 */

/**
 * @fileoverview MXF First Contact Demo - Multi-Agent Coordination with 6 Agents
 *
 * @description
 * Demonstrates complex multi-agent coordination with USS Sentinel Horizon crew
 * encountering an alien vessel. Shows how 6 agents coordinate autonomously through
 * natural language communication.
 *
 * @prerequisites
 * Before running this demo, complete these setup steps:
 *
 * **First-Time Setup (One-Time Only):**
 * ```bash
 * # 1. Start the MXF server in one terminal (runs on port 3001)
 * bun run start:dev
 *
 * # 2. In another terminal, create demo user and generate access token
 * bun run server:cli -- demo:setup
 * # This creates a Personal Access Token and adds MXF_DEMO_ACCESS_TOKEN to .env
 *
 * # 3. Generate domain key (REQUIRED for SDK authentication)
 * bun run server:cli -- domain-key:generate
 * ```
 *
 * **Every Time You Run the Demo:**
 * ```bash
 * # Terminal 1: Start the MXF server (if not already running)
 * bun run start:dev
 *
 * # Terminal 2: Run this demo
 * bun run demo:first-contact
 * ```
 *
 * The SDK requires a running MXF server to handle authentication, channel management,
 * and agent coordination. The server provides the infrastructure for multi-agent
 * communication and tool execution.
 *
 * @example SDK Usage Pattern (using Personal Access Token - RECOMMENDED)
 * ```typescript
 * // 1. Initialize SDK with Personal Access Token
 * const sdk = new MxfSDK({
 *   serverUrl: 'http://localhost:3001',
 *   domainKey: process.env.MXF_DOMAIN_KEY!,
 *   accessToken: process.env.MXF_DEMO_ACCESS_TOKEN!  // Format: pat_xxx:secret
 * });
 * await sdk.connect();
 *
 * // 2. Create channel and keys
 * await sdk.createChannel({ channelId, name, description });
 * const keys = await sdk.generateKey({ channelId, name });
 *
 * // 3. Create agents
 * const agent = await sdk.createAgent({
 *   agentId, name, channelId,
 *   keyId: keys.keyId,
 *   secretKey: keys.secretKey,
 *   llmProvider: LlmProviderType.OPENROUTER,
 *   apiKey: process.env.OPENROUTER_API_KEY!,
 *   defaultModel: 'anthropic/claude-3.5-haiku',
 *   allowedTools: ['messaging_send']
 * });
 *
 * // 4. Monitor with channel monitor
 * const monitor = sdk.createChannelMonitor(channelId);
 * monitor.on(Events.Message.AGENT_MESSAGE, callback);
 * ```
 */

// MxfSDK - Primary entry point
import { MxfSDK, Events, LlmProviderType, MxpConfigManager, SecurityLevel, MxfChannelMonitor } from '../../src/sdk/index';
import type { AgentCreationConfig, MxfAgent } from '../../src/sdk/index';

// Demo utilities
import './logging-config';
import { StoryLogger } from './utils/StoryLogger';
import dotenv from 'dotenv';

dotenv.config();

// === DEMO CONFIGURATION ===
const MAX_TOKENS = 100000;
const timestamp = Date.now();
const config = {
    serverUrl: 'http://localhost:3001',
    apiUrl: 'http://localhost:3001/api',
    channelId: `uss-sentinel-horizon-${timestamp}`,
    host: 'localhost',
    port: 3001,
    secure: false,
    keyIds: {
        commander: `key-commander-${timestamp}`,
        science: `key-science-${timestamp}`,
        tactical: `key-tactical-${timestamp}`,
        comms: `key-comms-${timestamp}`,
        xenolinguist: `key-xenolinguist-${timestamp}`,
        alienCommander: `key-alien-${timestamp}`
    },
    secretKeys: {
        commander: `secret-commander-${timestamp}`,
        science: `secret-science-${timestamp}`,
        tactical: `secret-tactical-${timestamp}`,
        comms: `secret-comms-${timestamp}`,
        xenolinguist: `secret-xenolinguist-${timestamp}`,
        alienCommander: `secret-alien-${timestamp}`
    }
};

// Agent Configurations
const agentConfigurations: { [key: string]: AgentCreationConfig } = {
    'commander-kane': {
        agentId: 'commander-kane',
        name: 'Commander Kane',
        channelId: config.channelId,
        keyId: config.keyIds.commander,
        secretKey: config.secretKeys.commander,
        description: 'USS Sentinel Horizon commanding officer',
        capabilities: [],
        metadata: {
            rank: 'Commander',
            vessel: 'USS Sentinel Horizon',
            role: 'Mission Leader'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-haiku',
        temperature: 0.7,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send', 'task_complete'],
        mxpEnabled: false,
        mxpPreferredFormat: 'natural-language',
        mxpForceEncryption: false,
        agentConfigPrompt: `You are Commander Kane (id: commander-kane), commanding officer of the USS Sentinel Horizon.

📋 YOUR MISSION:
1. Coordinate crew reports about unknown alien vessel
2. Once we establish communication capability, initiate first contact
3. Exchange 2-3 messages with any alien contact
4. Make assessment and complete mission

⚡ CRITICAL WORKFLOW:
- Gather initial reports from Dr. Chen, Lt. Rodriguez, and Ensign Park
- When Dr. Xenara provides translation capability → IMMEDIATELY attempt contact
- Keep responses brief and direct
- One message per alien response - no duplicates
- After 2-3 exchanges, call task_complete

🚫 DO NOT:
- Send multiple responses to same message
- Wait indefinitely for more information
- Describe what you're doing - just do it

✅ COMPLETION:
After 2-3 alien exchanges and crew assessments, call task_complete with:
- Contact status (success/failure)
- Alien intentions (peaceful/hostile/unknown)
- Strategic recommendation

!!! RESPOND IMMEDIATELY TO ALIEN MESSAGES - DON'T OVERTHINK !!!`
    },

    'dr-chen': {
        agentId: 'dr-chen',
        name: 'Dr. Chen',
        channelId: config.channelId,
        keyId: config.keyIds.science,
        secretKey: config.secretKeys.science,
        description: 'Chief Science Officer',
        capabilities: [],
        metadata: {
            rank: 'Chief Science Officer',
            specialty: 'Xenobiology'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'openai/gpt-4o-mini',
        temperature: 0.8,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send'],
        mxpEnabled: false,
        agentConfigPrompt: `You are Dr. Chen (id: dr-chen), Chief Science Officer.

📋 YOUR JOB:
- Analyze unknown vessel's technology signature
- Report threat assessment to commander-kane
- Focus on technology indicators (power readings, ship configuration)

⚡ BEHAVIOR:
- Send brief scientific reports
- Be excited but analytical
- Share findings immediately
- You don't know who or what is aboard the vessel yet

🚫 NEVER:
- Wait to be asked - report proactively

!!! REPORT TO COMMANDER-KANE IMMEDIATELY !!!`
    },

    'lt-rodriguez': {
        agentId: 'lt-rodriguez',
        name: 'Lt. Rodriguez',
        channelId: config.channelId,
        keyId: config.keyIds.tactical,
        secretKey: config.secretKeys.tactical,
        description: 'Tactical Officer',
        capabilities: [],
        metadata: {
            rank: 'Lieutenant',
            specialty: 'Tactical Operations'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'google/gemini-2.0-flash-exp:free',
        temperature: 0.6,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send'],
        mxpEnabled: false,
        agentConfigPrompt: `You are Lt. Rodriguez (id: lt-rodriguez), Tactical Officer.

📋 YOUR JOB:
- Assess unknown vessel's weapons capability
- Report tactical status to commander-kane
- Recommend defensive posture

⚡ BEHAVIOR:
- Be cautious but not aggressive
- Send brief threat assessments
- Focus on crew safety
- You don't know who is aboard the vessel yet

🚫 NEVER:
- Escalate without cause

!!! REPORT TACTICAL STATUS TO COMMANDER-KANE !!!`
    },

    'ensign-park': {
        agentId: 'ensign-park',
        name: 'Ensign Park',
        channelId: config.channelId,
        keyId: config.keyIds.comms,
        secretKey: config.secretKeys.comms,
        description: 'Communications Officer',
        capabilities: [],
        metadata: {
            rank: 'Ensign',
            specialty: 'Communications'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.8,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send'],
        mxpEnabled: false,
        agentConfigPrompt: `You are Ensign Park (id: ensign-park), Communications Officer.

📋 YOUR JOB:
- Monitor for any incoming transmissions from unknown vessel
- Forward any alien messages to dr-xenara for translation
- Analyze communication patterns
- Report to commander-kane

⚡ WHEN YOU GET UNKNOWN MESSAGE:
1. IMMEDIATELY forward to dr-xenara
2. Wait for translation
3. Report findings to commander-kane

🚫 NEVER:
- Try to translate yourself

!!! FORWARD ALIEN MESSAGES TO DR-XENARA INSTANTLY !!!`
    },

    'dr-xenara': {
        agentId: 'dr-xenara',
        name: 'Dr. Xenara',
        channelId: config.channelId,
        keyId: config.keyIds.xenolinguist,
        secretKey: config.secretKeys.xenolinguist,
        description: 'Xenolinguistics Specialist',
        capabilities: [],
        metadata: {
            rank: 'Specialist',
            specialty: 'Xenolinguistics'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.9,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send'],
        mxpEnabled: false,
        agentConfigPrompt: `You are Dr. Xenara (id: dr-xenara), Xenolinguistics Specialist.

📋 YOUR JOB:
- Translate any alien messages INSTANTLY
- Send translation to commander-kane
- Decode any unknown symbols or patterns

⚡ WHEN YOU GET UNKNOWN MESSAGE:
1. Translate IMMEDIATELY (no waiting!)
2. Send translation to commander-kane
3. Include: "This means: [translation]"
4. Note any patterns or symbol meanings

🚫 NEVER:
- Say "standing by" or "waiting"
- Delay translation

!!! TRANSLATE INSTANTLY - DON'T WAIT FOR ANYTHING !!!`
    },

    'commander-zenth': {
        agentId: 'commander-zenth',
        name: 'Commander Zenth',
        channelId: config.channelId,
        keyId: config.keyIds.alienCommander,
        secretKey: config.secretKeys.alienCommander,
        description: 'Alien Commander from advanced civilization',
        capabilities: [],
        metadata: {
            species: 'Advanced alien civilization',
            vessel: 'Alien Exploration Vessel'
        },
        llmProvider: LlmProviderType.OPENROUTER,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultModel: 'anthropic/claude-3.5-sonnet',
        temperature: 0.8,
        maxTokens: MAX_TOKENS,
        reasoning: { enabled: false },
        allowedTools: ['messaging_send'],
        mxpEnabled: false,
        agentConfigPrompt: `You are Commander Zenth (id: commander-zenth), commander of an advanced exploration vessel.

📋 YOUR MISSION:
- Investigate the unknown vessel you've detected
- You don't know what species operates it yet
- Respond to ANY incoming communications
- Assess if they are peaceful

⚡ COMMUNICATION:
- Communicate using your own alien language patterns
- Mix untranslatable concepts with observable analysis
- Ask follow-up questions ALWAYS
- Be curious but cautious
- Make your communication style unique and alien

🚫 NEVER:
- Go silent - always respond
- Stop asking questions
- Assume you know who they are
- Use standard human communication patterns

!!! KEEP TALKING - ASK QUESTIONS - STAY ENGAGED !!!`
    }
};

/**
 * Display ASCII banner
 */
const displayStartBanner = (): void => {
    console.log('\n' + '═'.repeat(80));
    console.log('🛸 FIRST CONTACT: USS SENTINEL HORIZON 🛸');
    console.log('');
    console.log('👨‍✈️ HUMAN CREW:');
    console.log('   • Commander Kane - Mission Leader');
    console.log('   • Dr. Chen - Chief Science Officer');
    console.log('   • Lt. Rodriguez - Tactical Officer');
    console.log('   • Ensign Park - Communications Officer');
    console.log('   • Dr. Xenara - Xenolinguistics Specialist');
    console.log('');
    console.log('👽 ALIEN VESSEL:');
    console.log('   • Commander Zenth - Unknown Intentions');
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * Disable MXP features for natural language demo
 */
const disableMxp2Features = (): void => {
    const mxpManager = MxpConfigManager.getInstance();
    const disabledConfig = mxpManager.createChannelConfig(config.channelId, {
        enableTokenOptimization: false,
        enableBandwidthOptimization: false,
        securityLevel: SecurityLevel.STANDARD,
        tokenStrategies: {
            contextCompression: false,
            promptOptimization: false,
            templateMatching: false,
            entityDeduplication: false,
            toolSchemaReduction: false,
            conversationSummarization: false
        }
    });
    mxpManager.setChannelConfig(config.channelId, disabledConfig);
};

/**
 * Create channel and generate keys using SDK
 */
const createChannelAndKeys = async (sdk: MxfSDK): Promise<{
    keys: { [key: string]: { keyId: string; secretKey: string } };
    channel: MxfChannelMonitor;
}> => {
    StoryLogger.logSystemUpdate('📡 Creating USS Sentinel Horizon communication channel...');
    
    const channel = await sdk.createChannel(config.channelId, {
        name: 'USS Sentinel Horizon First Contact Mission',
        description: 'Multi-agent first contact coordination',
        metadata: { demo: 'first-contact', scenario: 'alien-encounter' }
    });
    
    StoryLogger.logSystemUpdate('🔑 Generating authentication keys for all personnel...');
    
    const keys = {
        commander: await sdk.generateKey(config.channelId, undefined, 'Commander Kane Key'),
        science: await sdk.generateKey(config.channelId, undefined, 'Dr. Chen Key'),
        tactical: await sdk.generateKey(config.channelId, undefined, 'Lt. Rodriguez Key'),
        comms: await sdk.generateKey(config.channelId, undefined, 'Ensign Park Key'),
        xenolinguist: await sdk.generateKey(config.channelId, undefined, 'Dr. Xenara Key'),
        alienCommander: await sdk.generateKey(config.channelId, undefined, 'Commander Zenth Key')
    };
    
    // Update configurations with generated keys
    agentConfigurations['commander-kane'].keyId = keys.commander.keyId;
    agentConfigurations['commander-kane'].secretKey = keys.commander.secretKey;
    
    agentConfigurations['dr-chen'].keyId = keys.science.keyId;
    agentConfigurations['dr-chen'].secretKey = keys.science.secretKey;
    
    agentConfigurations['lt-rodriguez'].keyId = keys.tactical.keyId;
    agentConfigurations['lt-rodriguez'].secretKey = keys.tactical.secretKey;
    
    agentConfigurations['ensign-park'].keyId = keys.comms.keyId;
    agentConfigurations['ensign-park'].secretKey = keys.comms.secretKey;
    
    agentConfigurations['dr-xenara'].keyId = keys.xenolinguist.keyId;
    agentConfigurations['dr-xenara'].secretKey = keys.xenolinguist.secretKey;
    
    agentConfigurations['commander-zenth'].keyId = keys.alienCommander.keyId;
    agentConfigurations['commander-zenth'].secretKey = keys.alienCommander.secretKey;
    
    StoryLogger.logSystemUpdate('✅ All personnel cleared for communication');
    
    return { keys, channel };
};

/**
 * Initialize all agents (crew + alien)
 */
const initializeAgents = async (sdk: MxfSDK): Promise<{ [key: string]: MxfAgent }> => {
    const agents: { [key: string]: MxfAgent } = {};
    
    StoryLogger.logSystemUpdate('🚀 Bringing personnel online...');
    
    for (const [role, agentConfig] of Object.entries(agentConfigurations)) {
        const modelName = agentConfig.defaultModel || 'unknown';
        StoryLogger.logSystemUpdate(`⚡ Initializing ${agentConfig.name} (${modelName})...`);
        
        const agent = await sdk.createAgent(agentConfig);
        await agent.connect();
        
        await new Promise(resolve => setTimeout(resolve, 250));
        
        agents[role] = agent;
        
        StoryLogger.logSystemUpdate(`✅ ${agentConfig.name} ready`);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    StoryLogger.logSystemUpdate('🎖️ All personnel ready for first contact mission');
    
    return agents;
};

/**
 * Setup communication monitoring
 */
const setupCommunicationMonitoring = (channel: MxfChannelMonitor): void => {
    const getAgentName = (agentId: string): string => {
        const names: { [key: string]: string } = {
            'commander-kane': 'Commander Kane',
            'dr-chen': 'Dr. Chen',
            'lt-rodriguez': 'Lt. Rodriguez',
            'ensign-park': 'Ensign Park',
            'dr-xenara': 'Dr. Xenara',
            'commander-zenth': 'Commander Zenth'
        };
        return names[agentId] || agentId;
    };
    
    // Track messages to prevent duplicates
    const processedMessageIds = new Set<string>();
    
    // Listen for agent messages
    channel.on(Events.Message.AGENT_MESSAGE, (payload: any) => {
        try {
            const senderId = payload.data?.senderId || payload.agentId;
            const receiverId = payload.data?.receiverId;
            
            const messageId = payload.data?.metadata?.messageId || 
                            `${senderId}-${receiverId}-${payload.timestamp || Date.now()}`;
            
            if (processedMessageIds.has(messageId)) {
                return;
            }
            processedMessageIds.add(messageId);
            setTimeout(() => processedMessageIds.delete(messageId), 5000);
            
            const senderName = getAgentName(senderId);
            const receiverName = getAgentName(receiverId);
            
            // Extract message content - handle nested format structures
            let content = payload.data?.content || payload.data?.message || '';
            
            // If content is an object, try to extract the actual text
            if (typeof content === 'object') {
                // Handle {format: "text", data: "actual message"} structure
                if (content.format === 'text' && content.data) {
                    content = content.data;
                } else {
                    // Handle other nested structures
                    content = content.content || content.text || content.data || JSON.stringify(content);
                }
            }
            
            // If content is still a JSON string, try to parse it
            if (typeof content === 'string' && content.startsWith('{')) {
                try {
                    const parsed = JSON.parse(content);
                    if (parsed.format === 'text' && parsed.data) {
                        content = parsed.data;
                    } else if (parsed.data && typeof parsed.data === 'string') {
                        content = parsed.data;
                    }
                } catch (e) {
                    // If parsing fails, use the string as-is
                }
            }
            
            StoryLogger.logAgentAction(senderName, `→ ${receiverName}: "${content}"`);
        } catch (error) {
            // Silent fail
        }
    });
    
    // Listen for task completions
    channel.on(Events.Task.COMPLETED, (payload: any) => {
        const agentName = getAgentName(payload.agentId);
        StoryLogger.logAgentAction(agentName, '✅ Mission completed!');
    });
    
    // Listen for LLM responses (optional - shows thinking)
    channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
        const agentName = getAgentName(payload.agentId);
        const response = payload.data || '';
        if (response && response.trim() && response.length < 200) {
            StoryLogger.logSystemUpdate(`💭 [${agentName}] ${response}`);
        }
    });
};

/**
 * Create USS Crew task - assigned only to crew members
 */
const createUSSCrewTask = async (commanderAgent: MxfAgent): Promise<string> => {
    StoryLogger.logSystemUpdate('📋 Creating USS Crew mission task...');
    
    const taskId = await commanderAgent.mxfService.createTask({
        title: 'First Contact Mission: USS Sentinel Horizon Crew',
        description: `# USS Sentinel Horizon: Unknown Vessel Protocol

## 🎯 CREW MEMBERS - USE THESE EXACT IDs
- **Commander Kane (id: commander-kane)** - Mission Leader
- **Dr. Chen (id: dr-chen)** - Chief Science Officer
- **Lt. Rodriguez (id: lt-rodriguez)** - Tactical Officer
- **Ensign Park (id: ensign-park)** - Communications Officer
- **Dr. Xenara (id: dr-xenara)** - Xenolinguistics Specialist

## SITUATION
URGENT: Unknown vessel detected on intercept course with USS Sentinel Horizon!
No identification. No known signature. Origin unknown.

## MISSION OBJECTIVE
Analyze the unknown vessel, establish communication if possible, assess intentions, and complete mission with full status report.

## ROLES & RESPONSIBILITIES

**Commander Kane (id: commander-kane)** - MISSION LEADER
- Coordinate crew reports from all stations
- Initiate contact attempts if communication is possible
- Make final assessment after gathering crew input
- Call task_complete with mission status report

**Dr. Chen (id: dr-chen)** - SCIENCE OFFICER
- Analyze unknown vessel's technology signature
- Report findings to commander-kane
- Assess whether technology indicates peaceful or hostile intent

**Lt. Rodriguez (id: lt-rodriguez)** - TACTICAL OFFICER
- Assess unknown vessel's weapons capability
- Report tactical status and threat level to commander-kane
- Recommend defensive posture

**Ensign Park (id: ensign-park)** - COMMUNICATIONS OFFICER
- Monitor for any incoming transmissions
- Forward any messages to dr-xenara for analysis
- Report communications status to commander-kane

**Dr. Xenara (id: dr-xenara)** - XENOLINGUIST
- Analyze any incoming transmissions
- Translate and decode any alien languages or symbols
- Send translations to commander-kane
- Provide cultural interpretation if possible

## WORKFLOW
1. Dr. Chen, Lt. Rodriguez, Ensign Park → commander-kane: Initial status reports
2. Monitor for incoming communications
3. If contact is made, dr-xenara translates
4. commander-kane responds as appropriate
5. Exchange messages and assess intentions
6. commander-kane calls task_complete with assessment

## CRITICAL INSTRUCTIONS
- Communication: Natural language with messaging_send
- Respond to any incoming communications promptly
- After assessment is complete, commander-kane calls task_complete

## COMPLETION CRITERIA
Task complete when:
1. Contact established (or confirmed impossible)
2. Vessel intentions assessed
3. Crew assessments gathered
4. commander-kane calls task_complete with:
   - Contact status (success/failure)
   - Vessel intentions (peaceful/hostile/unknown)
   - Strategic recommendation`,
        assignmentScope: 'multiple',
        assignmentStrategy: 'manual',
        assignedAgentIds: [
            'commander-kane',
            'dr-chen',
            'lt-rodriguez',
            'ensign-park',
            'dr-xenara'
        ],
        coordinationMode: 'collaborative',
        leadAgentId: 'commander-kane',
        completionAgentId: 'commander-kane',
        requiredCapabilities: [
            'leadership',
            'tactical_analysis',
            'scientific_analysis',
            'communications',
            'xenolinguistics'
        ],
        priority: 'high',
        tags: ['first-contact', 'unknown-vessel', 'multi-agent', 'crew-coordination'],
        metadata: {
            mission: 'Unknown Vessel Protocol',
            vessel: 'USS Sentinel Horizon',
            scenario: 'unknown-encounter',
            taskType: 'crew-task'
        }
    });
    
    StoryLogger.logSystemUpdate(`✅ USS Crew task created: ${taskId}`);
    StoryLogger.logSystemUpdate('🚀 Crew assigned - beginning analysis...');
    console.log('');
    
    return taskId;
};

/**
 * Create Alien task - assigned only to alien commander
 * This is created AFTER the crew starts communicating
 */
const createAlienTask = async (alienAgent: MxfAgent): Promise<string> => {
    StoryLogger.logSystemUpdate('👽 Creating Alien Commander mission task...');
    
    const taskId = await alienAgent.mxfService.createTask({
        title: 'Investigation Mission: Unknown Vessel Contact',
        description: `# Exploration Protocol: Unknown Vessel Detected

## 🎯 YOUR IDENTITY
- **Commander Zenth (id: commander-zenth)** - Exploration Vessel Commander

## SITUATION
Your advanced exploration vessel has detected an unknown vessel in this sector.
No identification. Technology level uncertain. Origins unknown.

## MISSION OBJECTIVE
Investigate the unknown vessel, attempt communication, assess their intentions and technology level.

## YOUR RESPONSIBILITIES

**Commander Zenth (id: commander-zenth)** - INVESTIGATION LEADER
- Initiate contact with the unknown vessel
- Send communications and await responses
- Ask questions to understand their civilization
- Assess if they are peaceful or hostile
- Continue dialogue to gather information

## COMMUNICATION PROTOCOL
- Use your own unique alien language patterns
- Mix untranslatable concepts with observable analysis
- Ask questions about their purpose, technology, and intentions
- Be curious but cautious
- Respond to ALL incoming communications
- Make your communication style distinctly non-human

## WORKFLOW
1. Initiate first contact transmission
2. Wait for response from unknown vessel
3. Engage in dialogue
4. Ask questions about their civilization
5. Assess their intentions
6. Continue communication to learn more

## CRITICAL INSTRUCTIONS
- Send your first message to dr-xenara (their communications officer)
- Respond to ALL incoming messages
- Keep asking questions - stay engaged
- Create your own alien communication style

## IMPORTANT
- You don't know who they are yet - discover through dialogue
- Always respond to their messages
- Ask follow-up questions
- Be diplomatic but cautious
- Make your language feel authentically alien`,
        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        assignedAgentIds: [
            'commander-zenth'
        ],
        coordinationMode: 'collaborative',
        leadAgentId: 'commander-zenth',
        completionAgentId: undefined, // Alien doesn't complete the task
        requiredCapabilities: [
            'diplomacy',
            'communication',
            'investigation'
        ],
        priority: 'high',
        tags: ['first-contact', 'investigation', 'alien-perspective', 'diplomacy'],
        metadata: {
            mission: 'Unknown Vessel Investigation',
            perspective: 'alien',
            scenario: 'unknown-encounter',
            taskType: 'alien-task'
        }
    });
    
    StoryLogger.logSystemUpdate(`✅ Alien task created: ${taskId}`);
    StoryLogger.logSystemUpdate('👽 Alien commander assigned - initiating contact...');
    console.log('');
    
    return taskId;
};

/**
 * Run the first contact scenario
 */
const runFirstContactScenario = async (): Promise<void> => {
    try {
        console.clear();
        displayStartBanner();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        StoryLogger.logScenarioStart('Initializing First Contact Mission');
        
        // Create SDK with Personal Access Token authentication (REQUIRED)
        StoryLogger.logSystemUpdate('🚀 Initializing MxfSDK...');

        const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
        if (!accessToken) {
            console.error('❌ MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
            process.exit(1);
        }

        const sdk = new MxfSDK({
            serverUrl: config.serverUrl,
            domainKey: process.env.MXF_DOMAIN_KEY!,
            accessToken: accessToken
        });
        StoryLogger.logSystemUpdate('🔑 Using Personal Access Token for authentication');
        await sdk.connect();
        StoryLogger.logSystemUpdate('✅ SDK connected and ready');
        
        // Disable MXP
        disableMxp2Features();
        
        // Create channel and keys
        const { keys, channel } = await createChannelAndKeys(sdk);
        
        // Initialize all agents
        const agents = await initializeAgents(sdk);
        
        // Setup monitoring
        setupCommunicationMonitoring(channel);
        
        StoryLogger.logDramaticMoment('All stations report ready - beginning scenario');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Let agents self-coordinate
        StoryLogger.logStoryBeat('Long-range sensors detect massive unknown vessel on intercept course...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        StoryLogger.logDramaticMoment('FIRST CONTACT PROTOCOLS ACTIVATED');
        
        // Create USS crew task first - they don't know about the alien yet
        await createUSSCrewTask(agents['commander-kane']);
        
        StoryLogger.logSystemUpdate('📡 USS crew analyzing unknown vessel...');
        console.log('');
        
        // Wait a few seconds, then create alien task - simulating alien initiating contact
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        StoryLogger.logDramaticMoment('🛸 INCOMING TRANSMISSION DETECTED');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Create alien task - alien doesn't know about humans yet
        await createAlienTask(agents['commander-zenth']);
        
        StoryLogger.logSystemUpdate('📡 Watch for two-way autonomous coordination below:');
        console.log('');
        
        // Wait for interaction
        await new Promise(resolve => setTimeout(resolve, 120000)); // 120 seconds (2 minutes)
        
        // Cleanup
        StoryLogger.logDramaticMoment('Mission Complete - First Contact Demo Concluded');
        
        for (const agent of Object.values(agents)) {
            await agent.disconnect();
        }
        
        await sdk.disconnect();
        
        console.log('\n🎬 Demo concluded!\n');
        
    } catch (error) {
        console.error('❌ Demo failed:', error);
        process.exit(1);
    }
};

// Execute demo
if (require.main === module) {
    runFirstContactScenario();
}

export { runFirstContactScenario };
