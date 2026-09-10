import { readFile } from 'node:fs/promises';
import { MxfSDK, LlmProviderType } from '@mxf-dev/sdk';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createAndWait } from './task-outcome.js';

const logger = new Logger('info', 'RecurringReview', 'client');
const required = (name: string): string => {
    const value = process.env[name];
    if (!value?.trim()) throw new Error(`${name} is required`);
    return value;
};

async function main(): Promise<void> {
    const inputPath = process.argv[2];
    if (!inputPath) throw new Error('Usage: bun run examples/recurring-review/run.ts <evidence.txt>');
    const evidence = await readFile(inputPath, 'utf8');
    if (!evidence.trim()) throw new Error('The evidence file is empty');
    const agentId = required('MXF_AGENT_ID');
    const sdk = new MxfSDK({
        serverUrl: required('MXF_SERVER_URL'),
        domainKey: required('MXF_DOMAIN_KEY'),
        accessToken: required('MXF_ACCESS_TOKEN')
    });
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        await sdk.connect();
        const agent = await sdk.createAgent({
            agentId, name: 'Evidence reviewer', channelId: required('MXF_CHANNEL_ID'),
            keyId: required('MXF_AGENT_KEY_ID'), secretKey: required('MXF_AGENT_SECRET_KEY'),
            llmProvider: LlmProviderType.OPENROUTER,
            defaultModel: required('MXF_MODEL'), apiKey: required('OPENROUTER_API_KEY'),
            memoryMode: 'session', maxHistory: 30, maxIterations: 5,
            allowedTools: ['task_complete'],
            agentConfigPrompt: 'Review only the supplied evidence. Distinguish observations from inferences. Report missing information. Finish through task_complete.'
        });
        await agent.connect();
        const outcome = await createAndWait(agent, () => agent.mxfService.createTask({
            title: 'Review supplied evidence',
            description: `Summarize the evidence and list unresolved questions.\n\n${evidence}`,
            assignedAgentIds: [agentId], assignmentScope: 'single', assignmentStrategy: 'manual'
        }), controller.signal);
        // stdout is the application result; diagnostics use the framework logger.
        process.stdout.write(`${JSON.stringify(outcome)}\n`);
        if (outcome.status !== 'completed') process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        await sdk.disconnect();
    }
}

void main().catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
