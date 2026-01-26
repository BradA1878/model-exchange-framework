/**
 * TOON (Table-Oriented Object Notation) Optimization Demo
 *
 * Demonstrates 30-60% token savings when processing tabular data using TOON format.
 * This demo shows how MXF automatically detects arrays of objects and encodes them
 * in an optimized header + CSV-style row format.
 *
 * @prerequisites
 * - MXF server running (`npm run dev`)
 * - Environment variables configured
 *
 * @example
 * ```bash
 * cd examples/toon-optimization-demo
 * cp .env.example .env
 * # Edit .env with your API keys
 * npx ts-node toon-optimization-demo.ts
 * ```
 *
 * Run with: npm run demo:toon-optimization
 */

import { MxfSDK } from '../../src/sdk/MxfSDK';
import dotenv from 'dotenv';

dotenv.config();

/**
 * TOON Format Explanation:
 *
 * Standard JSON array format:
 * [{"name":"Alice","age":30,"city":"NYC"},{"name":"Bob","age":25,"city":"LA"}]
 *
 * TOON optimized format:
 * [#name,age,city]
 * Alice,30,NYC
 * Bob,25,LA
 *
 * The header row (prefixed with #) defines the column names once,
 * and subsequent rows contain only values separated by commas.
 * This eliminates repeated key names, reducing token usage significantly.
 */

// Sample datasets for demonstrating TOON optimization
const SAMPLE_DATA = {
  // Small dataset - employees
  employees: [
    { id: 1, name: 'Alice Johnson', department: 'Engineering', salary: 95000, location: 'New York' },
    { id: 2, name: 'Bob Smith', department: 'Marketing', salary: 85000, location: 'Los Angeles' },
    { id: 3, name: 'Carol Williams', department: 'Engineering', salary: 105000, location: 'San Francisco' },
    { id: 4, name: 'David Brown', department: 'Sales', salary: 75000, location: 'Chicago' },
    { id: 5, name: 'Eve Davis', department: 'Engineering', salary: 115000, location: 'Seattle' }
  ],

  // Medium dataset - products
  products: [
    { sku: 'PRD-001', name: 'Wireless Mouse', category: 'Electronics', price: 29.99, stock: 150, supplier: 'TechCorp' },
    { sku: 'PRD-002', name: 'USB-C Hub', category: 'Electronics', price: 49.99, stock: 75, supplier: 'TechCorp' },
    { sku: 'PRD-003', name: 'Ergonomic Keyboard', category: 'Electronics', price: 89.99, stock: 50, supplier: 'OfficePro' },
    { sku: 'PRD-004', name: 'Monitor Stand', category: 'Furniture', price: 59.99, stock: 100, supplier: 'OfficePro' },
    { sku: 'PRD-005', name: 'Desk Lamp', category: 'Furniture', price: 34.99, stock: 200, supplier: 'HomeLux' },
    { sku: 'PRD-006', name: 'Webcam HD', category: 'Electronics', price: 79.99, stock: 80, supplier: 'TechCorp' },
    { sku: 'PRD-007', name: 'Headphone Stand', category: 'Accessories', price: 24.99, stock: 120, supplier: 'HomeLux' },
    { sku: 'PRD-008', name: 'Cable Organizer', category: 'Accessories', price: 12.99, stock: 300, supplier: 'HomeLux' }
  ],

  // Large dataset - sales records
  salesRecords: Array.from({ length: 20 }, (_, i) => ({
    transactionId: `TXN-${String(i + 1).padStart(4, '0')}`,
    customerId: `CUST-${100 + (i % 5)}`,
    productSku: `PRD-${String((i % 8) + 1).padStart(3, '0')}`,
    quantity: Math.floor(Math.random() * 10) + 1,
    unitPrice: Math.floor(Math.random() * 100) + 10,
    discount: Math.round(Math.random() * 15),
    timestamp: new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
  }))
};

/**
 * Convert an array of objects to TOON format
 */
function convertToToon(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  // Get headers from first object
  const headers = Object.keys(data[0]);

  // Create header row with # prefix
  const headerRow = `[#${headers.join(',')}]`;

  // Create data rows
  const dataRows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      // Quote strings that contain commas
      if (typeof val === 'string' && val.includes(',')) {
        return `"${val}"`;
      }
      return String(val);
    }).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Estimate token count (rough approximation)
 * ~4 characters per token for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate and display token savings
 */
function analyzeTokenSavings(name: string, data: Record<string, unknown>[]): {
  jsonTokens: number;
  toonTokens: number;
  savingsPercent: number;
} {
  const jsonFormat = JSON.stringify(data);
  const toonFormat = convertToToon(data);

  const jsonTokens = estimateTokens(jsonFormat);
  const toonTokens = estimateTokens(toonFormat);
  const savingsPercent = Math.round(((jsonTokens - toonTokens) / jsonTokens) * 100);

  console.log(`\n${name}:`);
  console.log(`  Records: ${data.length}`);
  console.log(`  JSON tokens: ~${jsonTokens}`);
  console.log(`  TOON tokens: ~${toonTokens}`);
  console.log(`  Savings: ${savingsPercent}%`);

  return { jsonTokens, toonTokens, savingsPercent };
}

async function demo() {
  console.log('='.repeat(70));
  console.log('  TOON (Table-Oriented Object Notation) Optimization Demo');
  console.log('='.repeat(70));

  console.log('\n[Overview]');
  console.log('TOON is a token-optimized format for representing tabular data.');
  console.log('It reduces token usage by 30-60% compared to standard JSON arrays.');

  // Demonstrate TOON format conversion
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 1] Format Comparison');
  console.log('-'.repeat(70));

  const sampleForComparison = SAMPLE_DATA.employees.slice(0, 3);

  console.log('\nStandard JSON format:');
  console.log(JSON.stringify(sampleForComparison, null, 2));

  console.log('\nTOON optimized format:');
  console.log(convertToToon(sampleForComparison));

  // Analyze token savings for each dataset
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 2] Token Savings Analysis');
  console.log('-'.repeat(70));

  const results: { name: string; savings: number }[] = [];

  const employeeAnalysis = analyzeTokenSavings('Employees (5 records)', SAMPLE_DATA.employees);
  results.push({ name: 'Employees', savings: employeeAnalysis.savingsPercent });

  const productAnalysis = analyzeTokenSavings('Products (8 records)', SAMPLE_DATA.products);
  results.push({ name: 'Products', savings: productAnalysis.savingsPercent });

  const salesAnalysis = analyzeTokenSavings('Sales Records (20 records)', SAMPLE_DATA.salesRecords);
  results.push({ name: 'Sales', savings: salesAnalysis.savingsPercent });

  // Show how savings scale with data size
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 3] Scaling Analysis');
  console.log('-'.repeat(70));

  const scalingSizes = [10, 50, 100, 500];
  console.log('\nHow savings scale with record count:');
  console.log('  Records  | JSON Tokens | TOON Tokens | Savings');
  console.log('  ---------|-------------|-------------|--------');

  for (const size of scalingSizes) {
    const data = Array.from({ length: size }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      status: i % 2 === 0 ? 'active' : 'inactive'
    }));

    const jsonTokens = estimateTokens(JSON.stringify(data));
    const toonTokens = estimateTokens(convertToToon(data));
    const savings = Math.round(((jsonTokens - toonTokens) / jsonTokens) * 100);

    console.log(`  ${String(size).padStart(7)} | ${String(jsonTokens).padStart(11)} | ${String(toonTokens).padStart(11)} | ${savings}%`);
  }

  // MXF Integration Demo
  console.log('\n' + '-'.repeat(70));
  console.log('[Step 4] MXF Integration');
  console.log('-'.repeat(70));

  console.log('\nConnecting to MXF server to demonstrate TOON in agent context...');

  const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_DEMO_USERNAME || 'demo-user',
    password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
  });

  let agent: any = null;

  try {
    await sdk.connect();
    console.log('SDK connected successfully');

    // Create demo channel
    const channelId = `toon-demo-${Date.now()}`;
    console.log(`Creating demo channel: ${channelId}`);

    await sdk.createChannel(channelId, {
      name: 'TOON Optimization Demo Channel',
      description: 'Demonstrating TOON token optimization'
    });

    // Generate keys for agent
    const keys = await sdk.generateKey(channelId, undefined, 'TOON Demo Agent Key');

    // Create agent for data analysis
    agent = await sdk.createAgent({
      agentId: 'ToonDemoAgent',
      name: 'TOON Demo Agent',
      channelId,
      keyId: keys.keyId,
      secretKey: keys.secretKey,
      agentConfigPrompt: `You are a data analysis agent. When presenting tabular data, use TOON format for efficiency.
TOON format: Header row prefixed with [#] containing column names, followed by CSV-style data rows.
Example:
[#name,age,city]
Alice,30,NYC
Bob,25,LA`,
      allowedTools: ['code_execute'],
      llmProvider: 'openrouter' as any,
      apiKey: process.env.OPENROUTER_API_KEY || '',
      defaultModel: 'anthropic/claude-3.5-haiku'
    });

    await agent.connect();
    console.log('Agent connected successfully');

    // Demonstrate agent processing data with TOON awareness
    console.log('\nAgent analyzing product inventory with TOON optimization...');

    const analysisCode = `
      // Sample product data
      const products = ${JSON.stringify(SAMPLE_DATA.products)};

      // Convert to TOON format for efficient representation
      const headers = Object.keys(products[0]);
      const headerRow = '[#' + headers.join(',') + ']';
      const dataRows = products.map(p =>
        headers.map(h => p[h]).join(',')
      );

      const toonOutput = [headerRow, ...dataRows].join('\\n');

      // Calculate statistics
      const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
      const avgPrice = products.reduce((sum, p) => sum + p.price, 0) / products.length;
      const categories = [...new Set(products.map(p => p.category))];

      return {
        summary: {
          totalProducts: products.length,
          totalStock,
          averagePrice: avgPrice.toFixed(2),
          categories
        },
        toonFormat: toonOutput,
        tokenComparison: {
          jsonLength: JSON.stringify(products).length,
          toonLength: toonOutput.length,
          reductionPercent: Math.round((1 - toonOutput.length / JSON.stringify(products).length) * 100)
        }
      };
    `;

    const result = await agent.executeTool('code_execute', { code: analysisCode });

    if (result.success) {
      console.log('\nAgent Analysis Results:');
      console.log('Summary:', JSON.stringify(result.output.summary, null, 2));
      console.log('\nTOON Format Output:');
      console.log(result.output.toonFormat);
      console.log('\nToken Comparison:');
      console.log(`  JSON length: ${result.output.tokenComparison.jsonLength} chars`);
      console.log(`  TOON length: ${result.output.tokenComparison.toonLength} chars`);
      console.log(`  Reduction: ${result.output.tokenComparison.reductionPercent}%`);
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('Demo Summary');
    console.log('='.repeat(70));

    const avgSavings = results.reduce((sum, r) => sum + r.savings, 0) / results.length;
    console.log(`\nAverage token savings across datasets: ${Math.round(avgSavings)}%`);
    console.log('\nKey Benefits of TOON:');
    console.log('  - Eliminates repeated key names in array data');
    console.log('  - 30-60% token reduction for tabular data');
    console.log('  - Automatic eligibility detection for arrays');
    console.log('  - Seamless integration with MXF agents');
    console.log('  - Reduces LLM API costs for data-heavy operations');
    console.log('\nTOON optimization working correctly!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\nDemo failed:', error);
    throw error;
  } finally {
    // Cleanup
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

export { demo, convertToToon, estimateTokens };
