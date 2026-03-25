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

/**
 * WolframTools.ts
 *
 * Wolfram Alpha Full Results API integration for MXF agents.
 * Provides symbolic math, numerical computation, and curated economic,
 * financial, and geopolitical data as MXF MCP tools.
 *
 * Primary consumers: Flow Scanner, Briefer (Sentinel)
 * Invoke pattern: On-demand — not hot path. Use when a number matters.
 *
 * Requires env: WOLFRAM_APP_ID
 */

import { WOLFRAM_TOOLS } from '../../../constants/ToolNames';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WolframPod {
    title: string;
    content: string;
}

interface WolframQueryResult {
    success: boolean;
    query: string;
    primaryResult?: string;
    pods?: WolframPod[];
    error?: string;
}

// ---------------------------------------------------------------------------
// Core HTTP client — JSON output, no extra dependencies
// ---------------------------------------------------------------------------

const WOLFRAM_BASE = 'https://api.wolframalpha.com/v2/query';

// Assumption tokens that nudge Wolfram toward the right domain interpretation
const CONTEXT_ASSUMPTIONS: Record<string, string> = {
    econ: 'ClashPrefs_*FinancialData',
    math: 'ClashPrefs_*MathWorld',
    geo:  'ClashPrefs_*CountryData',
};

async function wolframQuery(
    query: string,
    mode: 'short' | 'full' = 'short',
    context?: string,
    timeoutMs = 5000
): Promise<WolframQueryResult> {
    const appId = process.env.WOLFRAM_APP_ID;
    if (!appId) {
        return { success: false, query, error: 'WOLFRAM_APP_ID environment variable not set' };
    }

    const params = new URLSearchParams({
        appid: appId,
        input: query,
        output: 'JSON',
        format: 'plaintext',
    });

    if (context && CONTEXT_ASSUMPTIONS[context]) {
        params.set('assumption', CONTEXT_ASSUMPTIONS[context]);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${WOLFRAM_BASE}?${params.toString()}`, {
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
            return { success: false, query, error: `HTTP ${res.status}` };
        }

        const json = await res.json() as any;
        const qr = json?.queryresult;

        if (!qr || qr.success !== true) {
            return {
                success: false,
                query,
                error: qr?.error === true ? 'Wolfram API error' : 'No results found',
            };
        }

        // Normalise pods — Wolfram returns a single object when there's only one pod
        const rawPods: any[] = Array.isArray(qr.pods) ? qr.pods : (qr.pods ? [qr.pods] : []);

        const pods: WolframPod[] = rawPods.map((p: any) => {
            const subpods: any[] = Array.isArray(p.subpods) ? p.subpods : (p.subpods ? [p.subpods] : []);
            const content = subpods
                .map((sp: any) => sp.plaintext ?? '')
                .filter(Boolean)
                .join('\n');
            return { title: p.title ?? '', content };
        });

        // First pod whose title contains "Result" or "Value" is the primary answer
        const resultPod = pods.find(p =>
            /result|value/i.test(p.title)
        ) ?? pods[0];

        const primaryResult = resultPod?.content;

        if (mode === 'short') {
            return { success: true, query, primaryResult, pods: resultPod ? [resultPod] : [] };
        }

        return { success: true, query, primaryResult, pods };

    } catch (err: any) {
        clearTimeout(timer);
        return {
            success: false,
            query,
            error: err.name === 'AbortError' ? 'Request timed out (5s)' : (err.message ?? 'Unknown error'),
        };
    }
}

// ---------------------------------------------------------------------------
// Tool: wolfram_compute
// Short-answer mode — primary result only. Fast path for agents.
// ---------------------------------------------------------------------------

export const wolframComputeTool = {
    name: WOLFRAM_TOOLS.WOLFRAM_COMPUTE,
    description: `Symbolic math, numerical computation, and curated economic/financial/geopolitical data via Wolfram Alpha.

Use for: yield curve math, spread calculations, statistical context, historical correlation lookups, macro data retrieval, GDP/trade figures, or any calculation that should not be approximated by an LLM.

NOT for: real-time price feeds, breaking news, or anything requiring sub-second latency.

Returns the primary result as a plaintext string.`,
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language or mathematical expression. Examples: "US 10Y Treasury yield 2024", "standard deviation of [2.1, 1.8, 3.4]", "GDP of Taiwan 2023 USD"',
            },
            context: {
                type: 'string',
                enum: ['econ', 'math', 'geo'],
                description: 'Optional domain hint. econ = financial/economic data, math = pure computation, geo = country/geopolitical data',
            },
        },
        required: ['query'],
    },
    handler: async (
        input: { query: string; context?: string },
        ctx: { requestId: string; agentId?: string; channelId?: string }
    ) => {
        const result = await wolframQuery(input.query, 'short', input.context);

        const text = result.success
            ? JSON.stringify({ query: result.query, result: result.primaryResult ?? 'No result' }, null, 2)
            : JSON.stringify({ query: result.query, error: result.error }, null, 2);

        return {
            content: { type: 'text', text },
            metadata: {
                toolName: WOLFRAM_TOOLS.WOLFRAM_COMPUTE,
                requestId: ctx.requestId,
                timestamp: new Date().toISOString(),
                error: !result.success,
            },
        };
    },
    enabled: true,
};

// ---------------------------------------------------------------------------
// Tool: wolfram_full
// Full pod mode — all result sections returned. For Briefer enrichment loops
// and any agent that needs to reason over multiple data facets.
// ---------------------------------------------------------------------------

export const wolframFullTool = {
    name: WOLFRAM_TOOLS.WOLFRAM_FULL,
    description: `Full Wolfram Alpha query — returns all result pods (e.g. Result, Plot, Historical Data, Comparisons).

Use when the agent needs more than just the primary answer: step-by-step solutions, historical charts, unit conversions, comparative data, or structured multi-part results.

Returns a JSON object with primaryResult and a pods array: [{ title, content }].`,
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language or mathematical expression',
            },
            context: {
                type: 'string',
                enum: ['econ', 'math', 'geo'],
                description: 'Optional domain hint',
            },
        },
        required: ['query'],
    },
    handler: async (
        input: { query: string; context?: string },
        ctx: { requestId: string; agentId?: string; channelId?: string }
    ) => {
        const result = await wolframQuery(input.query, 'full', input.context);

        const text = result.success
            ? JSON.stringify({
                query: result.query,
                primaryResult: result.primaryResult,
                pods: result.pods,
            }, null, 2)
            : JSON.stringify({ query: result.query, error: result.error }, null, 2);

        return {
            content: { type: 'text', text },
            metadata: {
                toolName: WOLFRAM_TOOLS.WOLFRAM_FULL,
                requestId: ctx.requestId,
                timestamp: new Date().toISOString(),
                error: !result.success,
            },
        };
    },
    enabled: true,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const wolframTools = [wolframComputeTool, wolframFullTool];
