/**
 * Fog of War: Parallel Minds - Main Entry Point
 * Demonstrates MXF multi-agent coordination in a strategy game
 */

import dotenv from 'dotenv';
import { GameServer } from './server/GameServer';
import { Team, CommanderRole } from './types/game';
import path from 'path';

// Load environment variables
dotenv.config();

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
Your primary objectives:
- Scout enemy positions and report to teammates
- Identify valuable resource locations
- Provide early warning of enemy movements
- Use mobility to your advantage

Strategy: Be aggressive in exploration, but avoid direct combat. Share all intelligence immediately.`
  },
  {
    id: 'red-warrior',
    name: 'Red Warrior Titan',
    team: Team.RED,
    role: CommanderRole.WARRIOR,
    personality: `You are Red Warrior Titan, an aggressive combat commander who leads assaults.
Your primary objectives:
- Capture and hold strategic territories
- Eliminate enemy units in combat
- Coordinate attacks with teammates
- Prioritize high-value targets

Strategy: Strike hard and fast. Use unit type advantages. Coordinate with teammates for combined assaults.`
  },
  {
    id: 'red-defender',
    name: 'Red Defender Bastion',
    team: Team.RED,
    role: CommanderRole.DEFENDER,
    personality: `You are Red Defender Bastion, a defensive specialist who protects team assets.
Your primary objectives:
- Fortify critical positions
- Defend resource nodes
- Counter enemy advances
- Maintain defensive perimeter

Strategy: Build strong defensive lines. Don't overextend. Support teammates who need backup.`
  },
  {
    id: 'red-support',
    name: 'Red Support Catalyst',
    team: Team.RED,
    role: CommanderRole.SUPPORT,
    personality: `You are Red Support Catalyst, a logistics and support commander.
Your primary objectives:
- Collect and distribute resources
- Transfer resources to teammates in need
- Coordinate team strategy
- Fill gaps in team coverage

Strategy: Stay flexible. Support the overall team strategy. Adapt to changing battlefield conditions.`
  },

  // Blue Team
  {
    id: 'blue-scout',
    name: 'Blue Scout Phantom',
    team: Team.BLUE,
    role: CommanderRole.SCOUT,
    personality: `You are Blue Scout Phantom, a stealth reconnaissance expert.
Your primary objectives:
- Discover enemy positions without being detected
- Map out resource locations
- Provide tactical intelligence
- Find weak points in enemy defenses

Strategy: Use caution and cunning. Information is power. Share intel constantly.`
  },
  {
    id: 'blue-warrior',
    name: 'Blue Warrior Tempest',
    team: Team.BLUE,
    role: CommanderRole.WARRIOR,
    personality: `You are Blue Warrior Tempest, a tactical combat specialist.
Your primary objectives:
- Execute coordinated strikes
- Capture strategic positions
- Eliminate priority threats
- Maximize combat effectiveness

Strategy: Fight smart, not just hard. Use terrain and unit advantages. Coordinate all major actions.`
  },
  {
    id: 'blue-defender',
    name: 'Blue Defender Aegis',
    team: Team.BLUE,
    role: CommanderRole.DEFENDER,
    personality: `You are Blue Defender Aegis, a fortress commander and defense expert.
Your primary objectives:
- Create impenetrable defensive positions
- Protect resource nodes
- Counter enemy attacks
- Maintain territorial integrity

Strategy: Defense is the best offense. Fortify key positions. Make every inch costly for enemies.`
  },
  {
    id: 'blue-support',
    name: 'Blue Support Nexus',
    team: Team.BLUE,
    role: CommanderRole.SUPPORT,
    personality: `You are Blue Support Nexus, a strategic coordinator and resource manager.
Your primary objectives:
- Optimize resource allocation
- Support team operations
- Coordinate combined strategies
- Ensure team cohesion

Strategy: Think globally. Ensure no teammate lacks resources. Facilitate team coordination.`
  }
];

/**
 * Main demo function
 */
async function runDemo() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║         FOG OF WAR: PARALLEL MINDS                        ║');
  console.log('║         Multi-Agent Strategy Game Demo                    ║');
  console.log('║         Powered by Model Exchange Framework (MXF)         ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Note: This starts only the game server without AI agents
  // For full demo with AI agents, use: npm run demo:fog-of-war (from root)

  // Create game server
  const gameServerPort = parseInt(process.env.GAME_SERVER_PORT || '3002');
  const gameServer = new GameServer(gameServerPort, {
    maxTurns: parseInt(process.env.GAME_MAX_TURNS || '15'),
    turnDuration: parseInt(process.env.GAME_TURN_DURATION || '45000'),
    mapSize: parseInt(process.env.GAME_MAP_SIZE || '12')
  });

  try {
    // Start game server
    await gameServer.start();

    // Add commanders to game
    console.log('\n📋 Initializing commanders...\n');

    for (const commander of COMMANDERS) {
      gameServer.addCommander(
        commander.id,
        commander.name,
        commander.team,
        commander.role,
        `agent-${commander.id}` // Agent ID for MXF integration
      );

      // Small delay to make output readable
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n✅ All commanders initialized!');
    console.log('\n📊 Game State:');
    console.log(`   Turn: ${gameServer.getGameState().getState().turn}`);
    console.log(`   Phase: ${gameServer.getGameState().getState().phase}`);
    console.log(`   Commanders: ${gameServer.getGameState().getState().commanders.length}`);

    console.log('\n🎮 Game ready!');
    console.log('\n📌 Next Steps:');
    console.log('   1. Connect AI agents using MXF SDK (see examples/fog-of-war-game/docs/)');
    console.log('   2. Open dashboard at http://localhost:3002');
    console.log('   3. Watch autonomous multi-agent coordination in action!');

    console.log('\n💡 Demo Features:');
    console.log('   • 8 AI commanders (4 per team) with distinct roles');
    console.log('   • Parallel decision-making with fog of war');
    console.log('   • Real-time strategy coordination via MXF');
    console.log('   • Turn-based gameplay with conflict resolution');
    console.log('   • WebSocket updates for live visualization');

    console.log('\n🔍 Available Endpoints:');
    console.log(`   Health: http://localhost:${gameServerPort}/health`);
    console.log(`   Game State: http://localhost:${gameServerPort}/api/game/state`);
    console.log(`   Commander View: http://localhost:${gameServerPort}/api/game/commander/:id`);
    console.log(`   WebSocket: ws://localhost:${gameServerPort}`);

    console.log('\n⚠️  Press Ctrl+C to stop the server\n');

    // Keep server running
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down gracefully...');
      await gameServer.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error starting demo:', error);
    await gameServer.stop();
    process.exit(1);
  }
}

// Run the demo
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runDemo };
