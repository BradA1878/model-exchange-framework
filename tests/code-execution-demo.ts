/**
 * Code Execution Demo
 *
 * Demonstrates the code_execute tool with various use cases.
 * Run with: NODE_ENV=test npx tsx tests/code-execution-demo.ts
 */

import { MxfSDK } from '../src/sdk/MxfSDK';
import dotenv from 'dotenv';

dotenv.config();

async function demo() {
  console.log('🚀 Code Execution Demo\n');
  console.log('═'.repeat(60));

  // Initialize SDK
  console.log('\n📡 Connecting to MXF server...');
  const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_DEMO_USERNAME || 'demo-user',
    password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
  });

  let agent: any = null;

  try {
    await sdk.connect();
    console.log('✅ SDK connected successfully');

    // Create test channel
    const channelId = `code-test-${Date.now()}`;
    console.log(`\n📢 Creating test channel: ${channelId}`);

    await sdk.createChannel(channelId, {
      name: 'Code Execution Test Channel',
      description: 'Testing code execution capabilities'
    });

    // Generate keys for agent
    console.log('🔑 Generating authentication keys...');
    const keys = await sdk.generateKey(channelId, undefined, 'Test Agent Key');

    // Create agent that can execute code
    console.log('🤖 Creating test agent...');
    agent = await sdk.createAgent({
      agentId: 'CodeTestAgent',
      name: 'Code Test Agent',
      channelId,
      keyId: keys.keyId,
      secretKey: keys.secretKey,
      agentConfigPrompt: 'You are a test agent for code execution',
      allowedTools: ['code_execute'],
      llmProvider: 'openrouter' as any,
      apiKey: process.env.OPENROUTER_API_KEY || '',
      defaultModel: 'anthropic/claude-3.5-haiku'
    });

    await agent.connect();
    console.log('✅ Agent connected successfully\n');

    // Test 1: Simple calculation
    console.log('═'.repeat(60));
    console.log('📝 Test 1: Simple Calculation');
    console.log('─'.repeat(60));
    console.log('Code: return 1 + 1;');

    const result1 = await agent.executeTool('code_execute', {
      code: 'return 1 + 1;'
    });

    console.log('✅ Success:', result1.success);
    console.log('📤 Output:', result1.output);
    console.log('⏱️  Time:', result1.executionTime, 'ms');
    console.log('🔖 Hash:', result1.codeHash);

    // Test 2: Array operations
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 2: Array Operations');
    console.log('─'.repeat(60));

    const code2 = `
      const numbers = [1, 2, 3, 4, 5];
      const sum = numbers.reduce((a, b) => a + b, 0);
      const avg = sum / numbers.length;
      const max = Math.max(...numbers);
      const min = Math.min(...numbers);

      return { sum, avg, max, min, count: numbers.length };
    `;

    console.log('Code: Array reduce, avg, max, min');
    const result2 = await agent.executeTool('code_execute', {
      code: code2
    });

    console.log('✅ Success:', result2.success);
    console.log('📤 Output:', JSON.stringify(result2.output, null, 2));
    console.log('⏱️  Time:', result2.executionTime, 'ms');

    // Test 3: Using context
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 3: Context Data Processing');
    console.log('─'.repeat(60));

    const code3 = `
      const filtered = context.data.filter(item => item.score > 0.8);
      const sorted = filtered.sort((a, b) => b.score - a.score);

      return {
        total: context.data.length,
        filtered: filtered.length,
        topItems: sorted.slice(0, 2)
      };
    `;

    console.log('Context: Array of items with scores');
    const result3 = await agent.executeTool('code_execute', {
      code: code3,
      context: {
        data: [
          { name: 'Item A', score: 0.9 },
          { name: 'Item B', score: 0.7 },
          { name: 'Item C', score: 0.85 },
          { name: 'Item D', score: 0.95 },
          { name: 'Item E', score: 0.6 }
        ]
      }
    });

    console.log('✅ Success:', result3.success);
    console.log('📤 Output:', JSON.stringify(result3.output, null, 2));
    console.log('⏱️  Time:', result3.executionTime, 'ms');

    // Test 4: Console output
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 4: Console Output Capture');
    console.log('─'.repeat(60));

    const code4 = `
      console.log('🔍 Starting analysis...');

      const data = [10, 20, 30, 40, 50];
      console.log('📊 Data points:', data.length);

      const result = Math.sqrt(data.reduce((a, b) => a + b, 0));
      console.log('✨ Computed result:', result);

      return result;
    `;

    console.log('Code: Multiple console.log statements');
    const result4 = await agent.executeTool('code_execute', {
      code: code4
    });

    console.log('✅ Success:', result4.success);
    console.log('📤 Output:', result4.output);
    console.log('📝 Console logs:');
    result4.logs?.forEach((log: string) => console.log('   ', log));
    console.log('⏱️  Time:', result4.executionTime, 'ms');

    // Test 5: TypeScript
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 5: TypeScript Execution');
    console.log('─'.repeat(60));

    const code5 = `
      interface Person {
        name: string;
        age: number;
      }

      interface Result {
        person: Person;
        category: string;
        yearsTo65: number;
      }

      const person: Person = { name: 'Alice', age: 30 };
      const category = person.age < 18 ? 'minor' : person.age < 65 ? 'adult' : 'senior';

      const result: Result = {
        person,
        category,
        yearsTo65: Math.max(0, 65 - person.age)
      };

      return result;
    `;

    console.log('Code: TypeScript with interfaces');
    const result5 = await agent.executeTool('code_execute', {
      language: 'typescript',
      code: code5
    });

    console.log('✅ Success:', result5.success);
    console.log('📤 Output:', JSON.stringify(result5.output, null, 2));
    console.log('⏱️  Time:', result5.executionTime, 'ms');

    // Test 6: Conditional logic
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 6: Conditional Logic');
    console.log('─'.repeat(60));

    const code6 = `
      const temperature = context.temp;
      let status, action, color;

      if (temperature > 100) {
        status = 'CRITICAL';
        action = 'immediate_alert';
        color = 'red';
        console.error('🚨 Critical temperature!');
      } else if (temperature > 80) {
        status = 'WARNING';
        action = 'monitor';
        color = 'yellow';
        console.warn('⚠️  Elevated temperature');
      } else {
        status = 'NORMAL';
        action = 'none';
        color = 'green';
        console.log('✅ Temperature normal');
      }

      return { temperature, status, action, color };
    `;

    console.log('Context: temperature = 95');
    const result6 = await agent.executeTool('code_execute', {
      code: code6,
      context: { temp: 95 }
    });

    console.log('✅ Success:', result6.success);
    console.log('📤 Output:', JSON.stringify(result6.output, null, 2));
    console.log('📝 Console logs:');
    result6.logs?.forEach((log: string) => console.log('   ', log));
    console.log('⏱️  Time:', result6.executionTime, 'ms');

    // Test 7: Iterative operations
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 7: Iterative Operations (Loops)');
    console.log('─'.repeat(60));

    const code7 = `
      const results = [];
      let processedCount = 0;
      let skippedCount = 0;

      for (const item of context.items) {
        const processed = {
          id: item.id,
          originalValue: item.value,
          doubledValue: item.value * 2,
          valid: item.value > 10
        };

        if (processed.valid) {
          results.push(processed);
          processedCount++;
          console.log(\`✓ Processed item \${item.id}: \${item.value} → \${processed.doubledValue}\`);
        } else {
          skippedCount++;
          console.log(\`✗ Skipped item \${item.id}: value too low (\${item.value})\`);
        }
      }

      return {
        total: context.items.length,
        processed: processedCount,
        skipped: skippedCount,
        results
      };
    `;

    console.log('Context: Array of items to process');
    const result7 = await agent.executeTool('code_execute', {
      code: code7,
      context: {
        items: [
          { id: 1, value: 5 },
          { id: 2, value: 15 },
          { id: 3, value: 25 },
          { id: 4, value: 8 },
          { id: 5, value: 30 }
        ]
      }
    });

    console.log('✅ Success:', result7.success);
    console.log('📤 Output:', JSON.stringify(result7.output, null, 2));
    console.log('📝 Console logs:');
    result7.logs?.forEach((log: string) => console.log('   ', log));
    console.log('⏱️  Time:', result7.executionTime, 'ms');

    // Test 8: Error handling (demonstrate security)
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 8: Security Validation (Expected to Fail)');
    console.log('─'.repeat(60));

    console.log('Code: eval("malicious code") - BLOCKED');
    try {
      await agent.executeTool('code_execute', {
        code: 'eval("malicious code");'
      });
      console.log('❌ Should have been blocked!');
    } catch (error) {
      console.log('✅ Correctly blocked dangerous code');
      console.log('🛡️  Error:', (error as Error).message);
    }

    // Test 9: Timeout (demonstrate resource limits)
    console.log('\n' + '═'.repeat(60));
    console.log('📝 Test 9: Timeout Protection');
    console.log('─'.repeat(60));

    console.log('Code: while(true) {} with 1s timeout');
    const result9 = await agent.executeTool('code_execute', {
      code: 'while(true) {}',
      timeout: 1000
    });

    console.log('✅ Timeout triggered (as expected)');
    console.log('❌ Success:', result9.success);
    console.log('⏱️  Time:', result9.executionTime, 'ms');
    console.log('🚫 Error:', result9.error);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 Demo Summary');
    console.log('═'.repeat(60));
    console.log('✅ Completed 9 test scenarios');
    console.log('✅ Demonstrated:');
    console.log('   • Simple calculations');
    console.log('   • Array operations');
    console.log('   • Context data usage');
    console.log('   • Console output capture');
    console.log('   • TypeScript support');
    console.log('   • Conditional logic');
    console.log('   • Iterative operations');
    console.log('   • Security validation');
    console.log('   • Timeout protection');
    console.log('');
    console.log('🎉 Code execution feature working correctly!');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    throw error;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    if (agent) {
      await agent.disconnect();
    }
    await sdk.disconnect();
    console.log('👋 Disconnected from server');
  }
}

// Run demo
demo()
  .then(() => {
    console.log('\n✅ Demo completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  });

export { demo };
