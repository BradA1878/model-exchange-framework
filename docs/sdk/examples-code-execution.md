# Code Execution Examples

Complete examples showing how to use the `code_execute` tool for various use cases.

## Table of Contents

- [Data Transformation](#data-transformation)
- [Multi-Step Workflows](#multi-step-workflows)
- [Statistical Analysis](#statistical-analysis)
- [String Processing](#string-processing)
- [Decision Trees](#decision-trees)
- [Batch Operations](#batch-operations)
- [Error Handling](#error-handling)

---

## Data Transformation

### Example 1: Filter and Transform Array

```typescript
import { MxfClient } from 'mxf-sdk';

const agent = new MxfClient({
    agentId: 'DataProcessor',
    apiKey: process.env.AGENT_API_KEY
});

await agent.connect();

// Get data from search or other source
const searchResults = await agent.callTool('memory_search_conversations', {
    query: 'user feedback',
    limit: 100
});

// Process locally without model round-trips
const result = await agent.callTool('code_execute', {
    code: `
        // Filter by relevance score
        const relevant = context.results
            .filter(r => r.relevanceScore > 0.8);

        // Extract key information
        const processed = relevant.map(r => ({
            id: r.id,
            summary: r.content.substring(0, 100),
            score: r.relevanceScore,
            sentiment: r.content.toLowerCase().includes('good') ? 'positive' : 'neutral'
        }));

        // Sort by score
        const sorted = processed.sort((a, b) => b.score - a.score);

        return {
            total: context.results.length,
            relevant: relevant.length,
            top10: sorted.slice(0, 10)
        };
    `,
    context: {
        results: searchResults
    }
});

console.log('Processed', result.output.total, 'items');
console.log('Found', result.output.relevant, 'relevant items');
console.log('Top 10:', result.output.top10);
```

### Example 2: Data Aggregation

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        // Group by category
        const grouped = context.items.reduce((acc, item) => {
            const category = item.category;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(item);
            return acc;
        }, {});

        // Calculate statistics per category
        const stats = {};
        for (const [category, items] of Object.entries(grouped)) {
            const values = items.map(i => i.value);
            stats[category] = {
                count: items.length,
                sum: values.reduce((a, b) => a + b, 0),
                avg: values.reduce((a, b) => a + b, 0) / values.length,
                min: Math.min(...values),
                max: Math.max(...values)
            };
        }

        return stats;
    `,
    context: {
        items: [
            { category: 'A', value: 10 },
            { category: 'B', value: 20 },
            { category: 'A', value: 15 },
            { category: 'C', value: 30 },
            { category: 'B', value: 25 }
        ]
    }
});

console.log(result.output);
// {
//   A: { count: 2, sum: 25, avg: 12.5, min: 10, max: 15 },
//   B: { count: 2, sum: 45, avg: 22.5, min: 20, max: 25 },
//   C: { count: 1, sum: 30, avg: 30, min: 30, max: 30 }
// }
```

---

## Multi-Step Workflows

### Example 3: Comprehensive Data Pipeline

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        console.log('Step 1: Validation');
        // Validate input data
        const invalid = context.data.filter(d => !d.id || !d.value);
        if (invalid.length > 0) {
            throw new Error(\`Found \${invalid.length} invalid items\`);
        }

        console.log('Step 2: Normalization');
        // Normalize values to 0-100 scale
        const values = context.data.map(d => d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const normalized = context.data.map(d => ({
            ...d,
            normalizedValue: ((d.value - min) / (max - min)) * 100
        }));

        console.log('Step 3: Classification');
        // Classify into buckets
        const classified = normalized.map(d => ({
            ...d,
            bucket: d.normalizedValue > 75 ? 'high' :
                   d.normalizedValue > 50 ? 'medium' :
                   d.normalizedValue > 25 ? 'low' : 'critical'
        }));

        console.log('Step 4: Reporting');
        // Generate report
        const report = {
            total: classified.length,
            distribution: {
                high: classified.filter(d => d.bucket === 'high').length,
                medium: classified.filter(d => d.bucket === 'medium').length,
                low: classified.filter(d => d.bucket === 'low').length,
                critical: classified.filter(d => d.bucket === 'critical').length
            },
            recommendations: []
        };

        // Add recommendations
        if (report.distribution.critical > 0) {
            report.recommendations.push('Immediate attention needed for critical items');
        }
        if (report.distribution.low + report.distribution.critical > report.total * 0.5) {
            report.recommendations.push('More than 50% below median - review process');
        }

        console.log('Pipeline complete');

        return {
            report,
            items: classified.filter(d => d.bucket === 'high' || d.bucket === 'critical')
        };
    `,
    context: {
        data: [
            { id: 1, value: 45 },
            { id: 2, value: 87 },
            { id: 3, value: 23 },
            { id: 4, value: 92 },
            { id: 5, value: 67 }
        ]
    },
    timeout: 10000
});

console.log('Report:', result.output.report);
console.log('Action items:', result.output.items);
console.log('Logs:', result.logs);
```

---

## Statistical Analysis

### Example 4: Statistical Calculations

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const data = context.values;

        // Basic statistics
        const n = data.length;
        const sum = data.reduce((a, b) => a + b, 0);
        const mean = sum / n;

        // Variance and standard deviation
        const variance = data
            .map(x => Math.pow(x - mean, 2))
            .reduce((a, b) => a + b, 0) / n;
        const stdDev = Math.sqrt(variance);

        // Median
        const sorted = [...data].sort((a, b) => a - b);
        const median = n % 2 === 0
            ? (sorted[n/2 - 1] + sorted[n/2]) / 2
            : sorted[Math.floor(n/2)];

        // Mode
        const frequency = {};
        let maxFreq = 0;
        let mode = null;
        data.forEach(val => {
            frequency[val] = (frequency[val] || 0) + 1;
            if (frequency[val] > maxFreq) {
                maxFreq = frequency[val];
                mode = val;
            }
        });

        // Range
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min;

        // Quartiles
        const q1 = sorted[Math.floor(n * 0.25)];
        const q3 = sorted[Math.floor(n * 0.75)];
        const iqr = q3 - q1;

        return {
            count: n,
            sum,
            mean,
            median,
            mode,
            stdDev,
            variance,
            min,
            max,
            range,
            quartiles: { q1, median, q3, iqr }
        };
    `,
    context: {
        values: [23, 45, 67, 89, 34, 56, 78, 90, 12, 45, 67, 89, 45]
    }
});

console.log('Statistics:', result.output);
```

---

## String Processing

### Example 5: Text Analysis

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const text = context.text;

        // Word count
        const words = text.split(/\\s+/).filter(w => w.length > 0);
        const wordCount = words.length;

        // Character count
        const charCount = text.length;
        const charCountNoSpaces = text.replace(/\\s/g, '').length;

        // Sentence count
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const sentenceCount = sentences.length;

        // Average word length
        const avgWordLength = words.reduce((a, w) => a + w.length, 0) / wordCount;

        // Word frequency
        const frequency = {};
        words.forEach(word => {
            const lower = word.toLowerCase();
            frequency[lower] = (frequency[lower] || 0) + 1;
        });

        // Top 10 most common words
        const topWords = Object.entries(frequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        // Readability metrics
        const avgWordsPerSentence = wordCount / sentenceCount;
        const readabilityScore = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * (charCountNoSpaces / wordCount);

        return {
            wordCount,
            charCount,
            sentenceCount,
            avgWordLength: Math.round(avgWordLength * 100) / 100,
            avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
            readabilityScore: Math.round(readabilityScore),
            topWords
        };
    `,
    context: {
        text: "Your text content here..."
    }
});

console.log('Analysis:', result.output);
```

---

## Decision Trees

### Example 6: Complex Decision Logic

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const metrics = context.metrics;
        let priority = 0;
        let action = 'none';
        const alerts = [];

        // Decision tree
        if (metrics.errorRate > 0.1) {
            if (metrics.criticalErrors > 0) {
                priority = 10;
                action = 'immediate_shutdown';
                alerts.push({
                    level: 'critical',
                    message: 'Critical errors detected - immediate action required'
                });
            } else if (metrics.errorRate > 0.2) {
                priority = 8;
                action = 'escalate';
                alerts.push({
                    level: 'high',
                    message: 'High error rate - escalation needed'
                });
            } else {
                priority = 5;
                action = 'monitor';
                alerts.push({
                    level: 'medium',
                    message: 'Elevated error rate - monitoring required'
                });
            }
        } else if (metrics.responseTime > 5000) {
            priority = 4;
            action = 'optimize';
            alerts.push({
                level: 'medium',
                message: 'Slow response times detected'
            });
        } else if (metrics.throughput < 100) {
            priority = 3;
            action = 'investigate';
            alerts.push({
                level: 'low',
                message: 'Low throughput - investigate bottlenecks'
            });
        } else {
            priority = 1;
            action = 'normal';
            alerts.push({
                level: 'info',
                message: 'All systems operating normally'
            });
        }

        return {
            priority,
            action,
            alerts,
            metrics,
            timestamp: new Date().toISOString()
        };
    `,
    context: {
        metrics: {
            errorRate: 0.15,
            criticalErrors: 0,
            responseTime: 2500,
            throughput: 150
        }
    }
});

console.log('Decision:', result.output.action);
console.log('Priority:', result.output.priority);
console.log('Alerts:', result.output.alerts);
```

---

## Batch Operations

### Example 7: Batch Processing with Progress

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const items = context.items;
        const batchSize = 10;
        const results = [];
        let processed = 0;
        let failed = 0;

        console.log(\`Processing \${items.length} items in batches of \${batchSize}\`);

        // Process in batches
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            console.log(\`Batch \${Math.floor(i/batchSize) + 1}: Processing \${batch.length} items\`);

            for (const item of batch) {
                try {
                    // Validate item
                    if (!item.id || typeof item.value !== 'number') {
                        throw new Error('Invalid item structure');
                    }

                    // Process item
                    const processedItem = {
                        id: item.id,
                        originalValue: item.value,
                        processedValue: item.value * context.multiplier,
                        valid: true,
                        processedAt: Date.now()
                    };

                    results.push(processedItem);
                    processed++;

                } catch (error) {
                    console.error(\`Failed to process item \${item.id}: \${error.message}\`);
                    failed++;
                    results.push({
                        id: item.id,
                        valid: false,
                        error: error.message
                    });
                }
            }
        }

        console.log(\`Complete: \${processed} processed, \${failed} failed\`);

        return {
            processed,
            failed,
            successRate: processed / items.length,
            results
        };
    `,
    context: {
        items: Array.from({ length: 50 }, (_, i) => ({
            id: `item-${i}`,
            value: Math.floor(Math.random() * 100)
        })),
        multiplier: 2
    },
    timeout: 15000
});

console.log('Batch results:', result.output);
console.log('Logs:', result.logs);
```

---

## Statistical Analysis

### Example 8: Time Series Analysis

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const timeSeries = context.data;

        // Calculate moving average (window = 3)
        const movingAvg = [];
        for (let i = 0; i < timeSeries.length - 2; i++) {
            const avg = (timeSeries[i] + timeSeries[i+1] + timeSeries[i+2]) / 3;
            movingAvg.push(avg);
        }

        // Detect trends
        let upTrend = 0;
        let downTrend = 0;
        for (let i = 1; i < movingAvg.length; i++) {
            if (movingAvg[i] > movingAvg[i-1]) upTrend++;
            else if (movingAvg[i] < movingAvg[i-1]) downTrend++;
        }

        const trend = upTrend > downTrend ? 'increasing' :
                     downTrend > upTrend ? 'decreasing' : 'stable';

        // Calculate volatility
        const mean = timeSeries.reduce((a, b) => a + b, 0) / timeSeries.length;
        const variance = timeSeries
            .map(x => Math.pow(x - mean, 2))
            .reduce((a, b) => a + b, 0) / timeSeries.length;
        const volatility = Math.sqrt(variance);

        // Find peaks and troughs
        const peaks = [];
        const troughs = [];
        for (let i = 1; i < timeSeries.length - 1; i++) {
            if (timeSeries[i] > timeSeries[i-1] && timeSeries[i] > timeSeries[i+1]) {
                peaks.push({ index: i, value: timeSeries[i] });
            }
            if (timeSeries[i] < timeSeries[i-1] && timeSeries[i] < timeSeries[i+1]) {
                troughs.push({ index: i, value: timeSeries[i] });
            }
        }

        return {
            trend,
            volatility: Math.round(volatility * 100) / 100,
            movingAverage: movingAvg,
            peaks: peaks.length,
            troughs: troughs.length,
            peakDetails: peaks.slice(0, 5),
            troughDetails: troughs.slice(0, 5)
        };
    `,
    context: {
        data: [45, 52, 48, 61, 55, 67, 72, 68, 75, 81, 78, 85, 90, 88, 95]
    }
});

console.log('Time series analysis:', result.output);
```

---

## String Processing

### Example 9: Text Parsing and Extraction

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const text = context.text;

        // Extract email addresses
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g;
        const emails = text.match(emailRegex) || [];

        // Extract URLs
        const urlRegex = /https?:\\/\\/[^\\s]+/g;
        const urls = text.match(urlRegex) || [];

        // Extract phone numbers (US format)
        const phoneRegex = /\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b/g;
        const phones = text.match(phoneRegex) || [];

        // Extract hashtags
        const hashtagRegex = /#[a-zA-Z0-9_]+/g;
        const hashtags = text.match(hashtagRegex) || [];

        // Extract mentions
        const mentionRegex = /@[a-zA-Z0-9_]+/g;
        const mentions = text.match(mentionRegex) || [];

        // Extract quoted text
        const quoteRegex = /"([^"]+)"/g;
        const quotes = [];
        let match;
        while ((match = quoteRegex.exec(text)) !== null) {
            quotes.push(match[1]);
        }

        return {
            emails: [...new Set(emails)],           // Unique
            urls: [...new Set(urls)],
            phones: [...new Set(phones)],
            hashtags: [...new Set(hashtags)],
            mentions: [...new Set(mentions)],
            quotes,
            summary: {
                totalEmails: emails.length,
                totalUrls: urls.length,
                totalPhones: phones.length,
                totalHashtags: hashtags.length,
                totalMentions: mentions.length,
                totalQuotes: quotes.length
            }
        };
    `,
    context: {
        text: `
            Contact us at support@example.com or sales@example.com
            Visit https://example.com for more info
            Call 555-123-4567 or 555-987-6543
            #AI #MachineLearning #Automation
            Mentioned by @alice and @bob
            "This is a quote" and "another quote"
        `
    }
});

console.log('Extracted data:', result.output);
```

---

## Decision Trees

### Example 10: Risk Assessment

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const profile = context.profile;
        let riskScore = 0;
        const riskFactors = [];

        // Assess age risk
        if (profile.age < 18) {
            riskScore += 30;
            riskFactors.push('Underage user');
        } else if (profile.age < 25) {
            riskScore += 15;
            riskFactors.push('Young user group');
        }

        // Assess credit score
        if (profile.creditScore < 600) {
            riskScore += 40;
            riskFactors.push('Low credit score');
        } else if (profile.creditScore < 700) {
            riskScore += 20;
            riskFactors.push('Fair credit score');
        }

        // Assess income
        if (profile.income < 30000) {
            riskScore += 25;
            riskFactors.push('Low income');
        } else if (profile.income < 50000) {
            riskScore += 10;
            riskFactors.push('Moderate income');
        }

        // Assess employment
        if (profile.employmentMonths < 12) {
            riskScore += 15;
            riskFactors.push('Limited employment history');
        }

        // Determine risk level
        let riskLevel;
        let decision;
        if (riskScore >= 70) {
            riskLevel = 'high';
            decision = 'reject';
        } else if (riskScore >= 40) {
            riskLevel = 'medium';
            decision = 'manual_review';
        } else {
            riskLevel = 'low';
            decision = 'approve';
        }

        return {
            riskScore,
            riskLevel,
            decision,
            riskFactors,
            profile: {
                age: profile.age,
                creditScore: profile.creditScore,
                income: profile.income,
                employmentMonths: profile.employmentMonths
            }
        };
    `,
    context: {
        profile: {
            age: 22,
            creditScore: 650,
            income: 45000,
            employmentMonths: 18
        }
    }
});

console.log('Risk assessment:', result.output);
```

---

## Error Handling

### Example 11: Graceful Error Recovery

```typescript
async function safeCodeExecution(agent: MxfClient, code: string, context: any) {
    try {
        // Try execution
        const result = await agent.callTool('code_execute', {
            code,
            context,
            timeout: 5000
        });

        if (result.success) {
            console.log('✅ Execution successful');
            console.log('Output:', result.output);
            console.log('Time:', result.executionTime, 'ms');
            return result.output;

        } else {
            console.error('❌ Execution failed:', result.error);

            // Handle different failure types
            if (result.resourceUsage.timeout) {
                console.log('⏱️  Timeout - code took too long');
                console.log('Consider: Increase timeout or optimize code');

                // Retry with longer timeout
                console.log('Retrying with 15s timeout...');
                const retry = await agent.callTool('code_execute', {
                    code,
                    context,
                    timeout: 15000
                });

                return retry.success ? retry.output : null;

            } else {
                console.log('Runtime error - check code for bugs');
                return null;
            }
        }

    } catch (error) {
        // Pre-execution error (validation or security)
        console.error('❌ Pre-execution error:', error.message);

        if (error.message.includes('validation')) {
            console.log('🛡️  Security validation failed');
            console.log('Code contains dangerous patterns');
        }

        return null;
    }
}

// Use the function
const result = await safeCodeExecution(
    agent,
    'return context.data.filter(d => d.score > 0.8);',
    { data: myData }
);
```

### Example 12: Validation Before Execution

```typescript
import { CodeExecutionSandboxService } from 'mxf';

async function validateAndExecute(agent: MxfClient, code: string) {
    // Pre-validate code safety
    const sandbox = CodeExecutionSandboxService.getInstance();
    const validation = sandbox.validateCode(code);

    if (!validation.safe) {
        console.error('❌ Code validation failed:');
        validation.issues
            .filter(i => i.type === 'error')
            .forEach(issue => {
                console.error(`  • ${issue.message}`);
            });

        // Show warnings
        validation.issues
            .filter(i => i.type === 'warning')
            .forEach(issue => {
                console.warn(`  ⚠️  ${issue.message}`);
            });

        return null;
    }

    console.log('✅ Code passed local validation');

    // Execute
    const result = await agent.callTool('code_execute', { code });

    return result.success ? result.output : null;
}

// Use it
const safeResult = await validateAndExecute(agent, myCode);
```

---

## Complete Application Example

### Example 13: Data Processing Pipeline

```typescript
import { MxfClient } from 'mxf-sdk';

async function processUserFeedback(agent: MxfClient) {
    console.log('Starting feedback processing pipeline...\n');

    // Step 1: Search for feedback
    console.log('Step 1: Searching for feedback...');
    const feedback = await agent.callTool('memory_search_conversations', {
        query: 'user feedback product review',
        limit: 100
    });
    console.log(`Found ${feedback.length} feedback items`);

    // Step 2: Process all feedback in one code execution
    console.log('\nStep 2: Processing feedback locally...');
    const analysis = await agent.callTool('code_execute', {
        code: `
            console.log('Analyzing', context.feedback.length, 'feedback items');

            // Sentiment analysis (simple keyword-based)
            const analyzed = context.feedback.map(item => {
                const content = item.content.toLowerCase();

                // Calculate sentiment score
                const positiveWords = ['good', 'great', 'excellent', 'love', 'amazing', 'perfect'];
                const negativeWords = ['bad', 'terrible', 'hate', 'awful', 'poor', 'broken'];

                let sentiment = 0;
                positiveWords.forEach(word => {
                    if (content.includes(word)) sentiment += 1;
                });
                negativeWords.forEach(word => {
                    if (content.includes(word)) sentiment -= 1;
                });

                return {
                    id: item.id,
                    sentiment: sentiment > 0 ? 'positive' :
                              sentiment < 0 ? 'negative' : 'neutral',
                    score: sentiment,
                    content: item.content,
                    timestamp: item.timestamp
                };
            });

            // Aggregate results
            const sentimentCounts = {
                positive: analyzed.filter(a => a.sentiment === 'positive').length,
                neutral: analyzed.filter(a => a.sentiment === 'neutral').length,
                negative: analyzed.filter(a => a.sentiment === 'negative').length
            };

            // Find most positive and negative
            const sorted = analyzed.sort((a, b) => b.score - a.score);
            const mostPositive = sorted.slice(0, 5);
            const mostNegative = sorted.slice(-5).reverse();

            // Calculate overall sentiment
            const overallScore = analyzed.reduce((sum, a) => sum + a.score, 0) / analyzed.length;
            const overallSentiment = overallScore > 0.5 ? 'positive' :
                                    overallScore < -0.5 ? 'negative' : 'neutral';

            console.log('Analysis complete');
            console.log(\`Overall: \${overallSentiment} (score: \${overallScore.toFixed(2)})\`);

            return {
                total: analyzed.length,
                sentimentCounts,
                overallSentiment,
                overallScore,
                mostPositive: mostPositive.map(m => ({ id: m.id, score: m.score })),
                mostNegative: mostNegative.map(m => ({ id: m.id, score: m.score }))
            };
        `,
        context: {
            feedback
        },
        timeout: 10000
    });

    console.log('\nAnalysis Results:');
    console.log('─'.repeat(50));
    console.log('Total feedback:', analysis.output.total);
    console.log('Sentiment breakdown:', analysis.output.sentimentCounts);
    console.log('Overall sentiment:', analysis.output.overallSentiment);
    console.log('Overall score:', analysis.output.overallScore.toFixed(2));
    console.log('\nMost positive:', analysis.output.mostPositive);
    console.log('Most negative:', analysis.output.mostNegative);
    console.log('\nExecution time:', analysis.executionTime, 'ms');
    console.log('Logs:', analysis.logs);

    // Step 3: Act on results
    if (analysis.output.overallSentiment === 'negative') {
        await agent.sendMessage(
            'dev-channel',
            `⚠️ Negative feedback detected: ${analysis.output.sentimentCounts.negative} negative items`
        );
    }

    return analysis.output;
}

// Run the pipeline
const agent = new MxfClient({ agentId: 'FeedbackAnalyzer', apiKey: '...' });
await agent.connect();
const results = await processUserFeedback(agent);
```

---

## Performance Comparison

### Traditional Approach (Multiple Tool Calls)

```typescript
// Step 1: Search
const data = await agent.callTool('memory_search', { query: 'feedback' });
// Wait for model response... ~5-10s

// Step 2: Filter
const filtered = await agent.callTool('filter_data', { data, threshold: 0.8 });
// Wait for model response... ~5-10s

// Step 3: Sort
const sorted = await agent.callTool('sort_data', { data: filtered });
// Wait for model response... ~5-10s

// Total: 15-30 seconds, 3 API calls
```

### Code Execution Approach

```typescript
// All in one execution
const result = await agent.callTool('code_execute', {
    code: `
        const filtered = context.data.filter(d => d.score > 0.8);
        const sorted = filtered.sort((a, b) => b.score - a.score);
        return sorted;
    `,
    context: { data }
});

// Total: ~7-12 seconds, 1 API call
// Savings: 60-75% latency, 67% API calls
```

---

## See Also

- [Code Execution Service](../mxf/code-execution.md) - Architecture and internals
- [SDK Overview](./index.md) - Main SDK documentation
- [MCP Tools](../api/mcp.md) - All available tools
- [Analytics](../analytics/code-execution.md) - Execution metrics
