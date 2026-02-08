/**
 * Memory Strata Demo
 *
 * Demonstrates multi-timescale memory architecture with 5 strata:
 * Working → Short-Term → Episodic → Long-Term → Semantic
 *
 * Shows memory consolidation, decay rates, and surprise detection (Titans-style).
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/memory-strata-demo
 * cp .env.example .env
 * npx ts-node memory-strata-demo.ts
 * ```
 *
 * Run with: npm run demo:memory-strata
 */

import { MxfSDK } from '../../src/sdk/MxfSDK';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Memory strata definitions
 */
enum MemoryStratum {
  Working = 'working',
  ShortTerm = 'short_term',
  Episodic = 'episodic',
  LongTerm = 'long_term',
  Semantic = 'semantic'
}

/**
 * Memory entry structure
 */
interface MemoryEntry {
  id: string;
  stratum: MemoryStratum;
  content: string;
  importance: number;  // 1-5
  accessCount: number;
  createdAt: Date;
  lastAccessed: Date;
  tags: string[];
  surpriseScore?: number;
}

/**
 * Stratum configuration
 */
const STRATUM_CONFIG = {
  [MemoryStratum.Working]: {
    name: 'Working Memory',
    description: 'Immediate context, very short-lived',
    maxEntries: 7,
    ttlMs: 30000,       // 30 seconds
    decayRate: 0.9,     // Fast decay
    minImportance: 1
  },
  [MemoryStratum.ShortTerm]: {
    name: 'Short-Term Memory',
    description: 'Recent history, moderate persistence',
    maxEntries: 50,
    ttlMs: 300000,      // 5 minutes
    decayRate: 0.7,
    minImportance: 2
  },
  [MemoryStratum.Episodic]: {
    name: 'Episodic Memory',
    description: 'Specific events and experiences',
    maxEntries: 200,
    ttlMs: 3600000,     // 1 hour
    decayRate: 0.5,
    minImportance: 3
  },
  [MemoryStratum.LongTerm]: {
    name: 'Long-Term Memory',
    description: 'Persistent knowledge and facts',
    maxEntries: 1000,
    ttlMs: 86400000,    // 24 hours
    decayRate: 0.2,
    minImportance: 4
  },
  [MemoryStratum.Semantic]: {
    name: 'Semantic Memory',
    description: 'Abstract concepts and patterns',
    maxEntries: 500,
    ttlMs: 604800000,   // 7 days
    decayRate: 0.1,     // Very slow decay
    minImportance: 5
  }
};

/**
 * Simple in-memory store for demo
 */
class MemoryStore {
  private memories: Map<string, MemoryEntry> = new Map();
  private idCounter = 0;

  add(stratum: MemoryStratum, content: string, importance: number, tags: string[] = []): MemoryEntry {
    const entry: MemoryEntry = {
      id: `mem_${++this.idCounter}`,
      stratum,
      content,
      importance,
      accessCount: 1,
      createdAt: new Date(),
      lastAccessed: new Date(),
      tags
    };
    this.memories.set(entry.id, entry);
    return entry;
  }

  get(id: string): MemoryEntry | undefined {
    const entry = this.memories.get(id);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessed = new Date();
    }
    return entry;
  }

  getByStratum(stratum: MemoryStratum): MemoryEntry[] {
    return Array.from(this.memories.values()).filter(m => m.stratum === stratum);
  }

  promote(id: string, toStratum: MemoryStratum): boolean {
    const entry = this.memories.get(id);
    if (!entry) return false;

    const stratumOrder = [MemoryStratum.Working, MemoryStratum.ShortTerm, MemoryStratum.Episodic, MemoryStratum.LongTerm, MemoryStratum.Semantic];
    const currentIndex = stratumOrder.indexOf(entry.stratum);
    const targetIndex = stratumOrder.indexOf(toStratum);

    if (targetIndex > currentIndex) {
      entry.stratum = toStratum;
      entry.importance = Math.min(5, entry.importance + 1);
      return true;
    }
    return false;
  }

  demote(id: string): boolean {
    const entry = this.memories.get(id);
    if (!entry) return false;

    const stratumOrder = [MemoryStratum.Working, MemoryStratum.ShortTerm, MemoryStratum.Episodic, MemoryStratum.LongTerm, MemoryStratum.Semantic];
    const currentIndex = stratumOrder.indexOf(entry.stratum);

    if (currentIndex > 0) {
      entry.stratum = stratumOrder[currentIndex - 1];
      entry.importance = Math.max(1, entry.importance - 1);
      return true;
    }
    return false;
  }

  getStats(): Record<MemoryStratum, number> {
    const stats: Record<MemoryStratum, number> = {
      [MemoryStratum.Working]: 0,
      [MemoryStratum.ShortTerm]: 0,
      [MemoryStratum.Episodic]: 0,
      [MemoryStratum.LongTerm]: 0,
      [MemoryStratum.Semantic]: 0
    };

    for (const entry of this.memories.values()) {
      stats[entry.stratum]++;
    }

    return stats;
  }
}

/**
 * Calculate surprise score (Titans-style)
 */
function calculateSurprise(observation: string, expectations: string[]): {
  isSurprising: boolean;
  score: number;
  type: string;
  explanation: string;
} {
  // Simple keyword-based surprise detection for demo
  const unexpectedKeywords = ['error', 'failed', 'unexpected', 'strange', 'unusual', 'novel', 'first'];
  const hasUnexpected = unexpectedKeywords.some(k => observation.toLowerCase().includes(k));

  const matchesExpectation = expectations.some(exp =>
    observation.toLowerCase().includes(exp.toLowerCase())
  );

  let score = 0;
  let type = 'normal';
  let explanation = 'Observation matches expectations';

  if (hasUnexpected && !matchesExpectation) {
    score = 0.85;
    type = 'anomaly';
    explanation = 'Unexpected pattern detected, violates predictions';
  } else if (hasUnexpected) {
    score = 0.5;
    type = 'schema_violation';
    explanation = 'Contains unexpected elements but partially matches known patterns';
  } else if (!matchesExpectation) {
    score = 0.3;
    type = 'prediction_failure';
    explanation = 'Does not match expected patterns';
  }

  return {
    isSurprising: score > 0.4,
    score,
    type,
    explanation
  };
}

async function demo() {
  console.log('='.repeat(70));
  console.log('  Memory Strata Demo (Multi-Timescale Architecture)');
  console.log('='.repeat(70));

  console.log('\n[Overview]');
  console.log('This demo shows the 5-stratum memory architecture:');
  Object.entries(STRATUM_CONFIG).forEach(([stratum, config]) => {
    console.log(`  ${stratum.padEnd(12)} → ${config.name}: ${config.description}`);
  });

  // Initialize memory store
  const store = new MemoryStore();

  // Step 1: Working Memory
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 1] Working Memory (Immediate Context)');
  console.log('-'.repeat(70));

  console.log('\nAdding observations to working memory...');
  const obs1 = store.add(MemoryStratum.Working, 'User requested analysis of sales data', 2, ['request', 'sales']);
  const obs2 = store.add(MemoryStratum.Working, 'Sales data loaded: 1500 records', 1, ['data', 'sales']);
  const obs3 = store.add(MemoryStratum.Working, 'Analysis in progress: filtering by region', 1, ['progress']);

  console.log(`  Added ${store.getStats()[MemoryStratum.Working]} entries to working memory`);
  console.log(`  TTL: ${STRATUM_CONFIG[MemoryStratum.Working].ttlMs / 1000}s, Max: ${STRATUM_CONFIG[MemoryStratum.Working].maxEntries} entries`);

  // Step 2: Memory Consolidation
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 2] Memory Consolidation (Promotion)');
  console.log('-'.repeat(70));

  console.log('\nPromoting important memories to higher strata...');

  // Simulate repeated access increasing importance
  store.get(obs1.id);
  store.get(obs1.id);
  store.get(obs1.id);

  const promoted = store.promote(obs1.id, MemoryStratum.ShortTerm);
  console.log(`  Promoted "${obs1.content.substring(0, 40)}..." to short-term: ${promoted}`);

  // Add short-term memory
  const stm1 = store.add(MemoryStratum.ShortTerm, 'Previous analysis showed Q3 was best quarter', 3, ['analysis', 'history']);
  console.log(`  Added short-term memory: "${stm1.content.substring(0, 40)}..."`);

  // Promote to episodic
  const promoted2 = store.promote(stm1.id, MemoryStratum.Episodic);
  console.log(`  Promoted to episodic memory: ${promoted2}`);

  // Step 3: Long-Term and Semantic Memory
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 3] Long-Term and Semantic Memory');
  console.log('-'.repeat(70));

  const ltm1 = store.add(MemoryStratum.LongTerm, 'Sales typically peak in Q3 and Q4 due to holiday seasons', 4, ['pattern', 'sales']);
  const sem1 = store.add(MemoryStratum.Semantic, 'Seasonal patterns affect retail sales predictably', 5, ['concept', 'retail']);
  const sem2 = store.add(MemoryStratum.Semantic, 'Q4 typically has highest revenue due to holidays', 5, ['concept', 'revenue']);

  console.log('\nAdded persistent memories:');
  console.log(`  Long-Term: "${ltm1.content.substring(0, 50)}..."`);
  console.log(`  Semantic:  "${sem1.content.substring(0, 50)}..."`);
  console.log(`  Semantic:  "${sem2.content.substring(0, 50)}..."`);

  // Step 4: Surprise Detection (Titans-style)
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 4] Surprise Detection (Titans-Inspired)');
  console.log('-'.repeat(70));

  const expectations = ['Q3 peak', 'Q4 revenue', 'holiday sales', 'seasonal pattern'];

  const observations = [
    'Q4 shows expected holiday revenue increase',
    'Unexpected Q1 spike in summer products',
    'Normal seasonal pattern observed in retail',
    'Strange: Q2 outperformed Q4 this year',
    'First-ever decline in holiday shopping detected'
  ];

  console.log('\nAnalyzing observations for surprise:');
  for (const obs of observations) {
    const surprise = calculateSurprise(obs, expectations);
    const indicator = surprise.isSurprising ? '⚠️' : '✓';
    console.log(`  ${indicator} [${(surprise.score * 100).toFixed(0).padStart(3)}%] ${obs.substring(0, 45)}...`);
    if (surprise.isSurprising) {
      console.log(`         Type: ${surprise.type} - ${surprise.explanation}`);
    }
  }

  // Step 5: Memory Statistics
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 5] Memory Statistics');
  console.log('-'.repeat(70));

  const stats = store.getStats();
  console.log('\nMemory distribution across strata:');
  Object.entries(stats).forEach(([stratum, count]) => {
    const config = STRATUM_CONFIG[stratum as MemoryStratum];
    const bar = '█'.repeat(count) + '░'.repeat(Math.max(0, 10 - count));
    console.log(`  ${stratum.padEnd(12)} [${bar}] ${count}/${config.maxEntries}`);
  });

  // Step 6: MXF Integration
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 6] MXF Integration');
  console.log('-'.repeat(70));

  console.log('\nConnecting to MXF server...');

  // Create SDK with Personal Access Token authentication (REQUIRED)
  const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
    process.exit(1);
  }

  const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: accessToken
  });

  let agent: any = null;

  try {
    await sdk.connect();
    console.log('SDK connected successfully');

    const channelId = `memory-demo-${Date.now()}`;
    await sdk.createChannel(channelId, {
      name: 'Memory Strata Demo Channel',
      description: 'Demonstrating multi-timescale memory'
    });

    const keys = await sdk.generateKey(channelId, undefined, 'Memory Demo Agent Key');

    agent = await sdk.createAgent({
      agentId: 'MemoryDemoAgent',
      name: 'The Learning Agent',
      channelId,
      keyId: keys.keyId,
      secretKey: keys.secretKey,
      agentConfigPrompt: 'You are an agent demonstrating memory strata capabilities.',
      allowedTools: ['code_execute'],
      llmProvider: 'openrouter' as any,
      apiKey: process.env.OPENROUTER_API_KEY || '',
      defaultModel: 'anthropic/claude-3.5-haiku'
    });

    await agent.connect();
    console.log('Agent connected successfully');

    // Demonstrate memory analysis
    const analysisCode = `
      // Memory strata analysis
      const strata = ${JSON.stringify(stats)};
      const config = ${JSON.stringify(Object.fromEntries(
        Object.entries(STRATUM_CONFIG).map(([k, v]) => [k, { name: v.name, decayRate: v.decayRate, ttlMs: v.ttlMs }])
      ))};

      const totalMemories = Object.values(strata).reduce((a, b) => a + b, 0);
      const avgDecay = Object.entries(config).reduce((sum, [k, v]) => sum + v.decayRate * strata[k], 0) / totalMemories;

      return {
        totalMemories,
        distribution: strata,
        averageDecayRate: avgDecay.toFixed(3),
        recommendation: totalMemories < 10
          ? 'Memory system initialized, building context'
          : 'Healthy memory distribution across strata'
      };
    `;

    const result = await agent.executeTool('code_execute', { code: analysisCode });

    if (result.success) {
      console.log('\nAgent Memory Analysis:');
      console.log(`  Total memories: ${result.output.totalMemories}`);
      console.log(`  Avg decay rate: ${result.output.averageDecayRate}`);
      console.log(`  Status: ${result.output.recommendation}`);
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('Demo Summary');
    console.log('='.repeat(70));

    console.log('\n5 Memory Strata:');
    console.log('  Working     → Immediate context (seconds)');
    console.log('  Short-Term  → Recent history (minutes)');
    console.log('  Episodic    → Specific events (hours)');
    console.log('  Long-Term   → Persistent facts (days)');
    console.log('  Semantic    → Abstract concepts (weeks)');

    console.log('\nKey Features:');
    console.log('  - Automatic consolidation (promotion between strata)');
    console.log('  - Decay rates (memories fade over time)');
    console.log('  - Importance scoring (1-5 levels)');
    console.log('  - Surprise detection (Titans-style anomaly detection)');
    console.log('  - Pattern recognition and storage');

    console.log('\nMemory strata working correctly!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\nDemo failed:', error);
    throw error;
  } finally {
    console.log('\nCleaning up...');
    if (agent) {
      await agent.disconnect();
    }
    await sdk.disconnect();
    console.log('Disconnected from server');
  }
}

// Run demo
demo()
  .then(() => {
    console.log('\nDemo completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nDemo failed:', error);
    process.exit(1);
  });

export { demo, MemoryStratum, STRATUM_CONFIG, calculateSurprise };
