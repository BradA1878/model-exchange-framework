/**
 * MXF CLI Init Command
 *
 * Interactive configuration of LLM provider, API keys, default models,
 * SystemLLM, and semantic search embeddings. Saves to ~/.mxf/config.json.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import prompts from 'prompts';
import axios from 'axios';
import { ConfigService } from '../services/ConfigService';
import { MxfLlmConfig } from '../types/config';
import { logSuccess, logError, logInfo, logWarning, logHeader } from '../utils/output';
import { loadAll } from '../tui/agents/AgentLoader';

/** Model choices organized by provider */
const MODEL_CHOICES: Record<string, Array<{ title: string; value: string }>> = {
    openrouter: [
        { title: 'anthropic/claude-sonnet-4.6', value: 'anthropic/claude-sonnet-4.6' },
        { title: 'anthropic/claude-sonnet-4.5', value: 'anthropic/claude-sonnet-4.5' },
        { title: 'anthropic/claude-haiku-4.5', value: 'anthropic/claude-haiku-4.5' },
        { title: 'openai/gpt-4.1', value: 'openai/gpt-4.1' },
        { title: 'openai/gpt-4.1-mini', value: 'openai/gpt-4.1-mini' },
        { title: 'google/gemini-3-pro-preview', value: 'google/gemini-3-pro-preview' },
        { title: 'google/gemini-3-flash-preview', value: 'google/gemini-3-flash-preview' },
        { title: 'google/gemini-2.5-pro', value: 'google/gemini-2.5-pro' },
        { title: 'google/gemini-2.5-flash', value: 'google/gemini-2.5-flash' },
    ],
    anthropic: [
        { title: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6' },
        { title: 'claude-sonnet-4-5', value: 'claude-sonnet-4-5' },
        { title: 'claude-haiku-4-5', value: 'claude-haiku-4-5' },
        { title: 'claude-opus-4-6', value: 'claude-opus-4-6' },
    ],
    openai: [
        { title: 'gpt-4.1', value: 'gpt-4.1' },
        { title: 'gpt-4.1-mini', value: 'gpt-4.1-mini' },
        { title: 'gpt-4o', value: 'gpt-4o' },
    ],
    gemini: [
        { title: 'gemini-3-pro-preview', value: 'gemini-3-pro-preview' },
        { title: 'gemini-3-flash-preview', value: 'gemini-3-flash-preview' },
        { title: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
        { title: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
    ],
    xai: [
        { title: 'grok-3', value: 'grok-3' },
        { title: 'grok-3-mini', value: 'grok-3-mini' },
    ],
};

/** LLM provider choices for the selection prompt */
const PROVIDER_CHOICES = [
    { title: 'OpenRouter (200+ models, recommended)', value: 'openrouter' },
    { title: 'Anthropic', value: 'anthropic' },
    { title: 'OpenAI', value: 'openai' },
    { title: 'Google (Gemini)', value: 'gemini' },
    { title: 'xAI (Grok)', value: 'xai' },
    { title: 'Ollama (local)', value: 'ollama' },
];

/**
 * Handle prompt cancellation (Ctrl+C). When the user cancels any prompt,
 * prompts returns an empty object — we detect this by checking for undefined values.
 */
function onCancel(): void {
    logInfo('Setup cancelled.');
    process.exit(0);
}

/**
 * Prompt the user to select an LLM provider.
 * Returns the provider identifier string.
 */
async function promptProvider(): Promise<string> {
    const response = await prompts({
        type: 'select',
        name: 'provider',
        message: 'Select LLM Provider',
        choices: PROVIDER_CHOICES,
    }, { onCancel });

    if (response.provider === undefined) {
        onCancel();
    }

    return response.provider;
}

/**
 * Prompt the user to enter their API key (masked input).
 * Skipped for ollama since it runs locally without authentication.
 */
async function promptApiKey(provider: string): Promise<string> {
    if (provider === 'ollama') {
        logInfo('Ollama runs locally — no API key needed.');
        return '';
    }

    const response = await prompts({
        type: 'password',
        name: 'apiKey',
        message: `Enter your ${provider} API key`,
    }, { onCancel });

    if (response.apiKey === undefined) {
        onCancel();
    }

    return response.apiKey;
}

/**
 * Prompt the user to select or enter a default model.
 * For ollama, uses a free-text input since models are user-installed.
 * For other providers, shows a curated list of available models.
 */
async function promptDefaultModel(provider: string): Promise<string> {
    if (provider === 'ollama') {
        const response = await prompts({
            type: 'text',
            name: 'model',
            message: 'Enter your Ollama model name',
            initial: 'llama3',
        }, { onCancel });

        if (response.model === undefined) {
            onCancel();
        }

        return response.model;
    }

    const choices = MODEL_CHOICES[provider];
    const response = await prompts({
        type: 'select',
        name: 'model',
        message: 'Select default model',
        choices,
    }, { onCancel });

    if (response.model === undefined) {
        onCancel();
    }

    return response.model;
}

/**
 * Prompt the user to optionally set different models for each agent.
 * Shows agent name, role, and description to help the user decide.
 *
 * @param provider - The selected LLM provider
 * @param defaultModel - The default model already selected
 * @param customAgentsDir - Optional custom agents directory
 * @returns Map of agentId → model ID (only agents with non-default models)
 */
async function promptPerAgentModels(
    provider: string,
    defaultModel: string,
    customAgentsDir?: string,
): Promise<Record<string, string>> {
    const response = await prompts({
        type: 'confirm',
        name: 'customize',
        message: 'Set different models for each agent? (otherwise all agents use the default)',
        initial: false,
    }, { onCancel });

    if (response.customize === undefined) {
        onCancel();
    }

    if (!response.customize) {
        return {};
    }

    // Load all available agent definitions
    const agents = loadAll(customAgentsDir);
    if (agents.length === 0) {
        logInfo('No agent definitions found. Skipping per-agent model selection.');
        return {};
    }

    const choices = MODEL_CHOICES[provider];
    const models: Record<string, string> = {};

    console.log('');
    logInfo('Select a model for each agent (Enter to keep default):');
    console.log('');

    for (const agent of agents) {
        // Show agent context — role and what it does
        const roleLabel = agent.role === 'orchestrator' ? 'orchestrator' : 'specialist';
        logInfo(`  ${agent.name} (${roleLabel}): ${agent.description}`);

        if (provider === 'ollama') {
            // Free-text for Ollama since models are user-installed
            const modelResponse = await prompts({
                type: 'text',
                name: 'model',
                message: `  Model for ${agent.name}`,
                initial: defaultModel,
            }, { onCancel });

            if (modelResponse.model === undefined) onCancel();
            if (modelResponse.model !== defaultModel) {
                models[agent.agentId] = modelResponse.model;
            }
        } else {
            // Selection list for managed providers — default option first
            const agentChoices = [
                { title: `${defaultModel} (default)`, value: '__default__' },
                ...choices.filter(c => c.value !== defaultModel),
            ];

            const modelResponse = await prompts({
                type: 'select',
                name: 'model',
                message: `  Model for ${agent.name}`,
                choices: agentChoices,
            }, { onCancel });

            if (modelResponse.model === undefined) onCancel();
            if (modelResponse.model !== '__default__') {
                models[agent.agentId] = modelResponse.model;
            }
        }
    }

    return models;
}

/**
 * Prompt the user whether to enable SystemLLM.
 * SystemLLM uses LLM credits for server-side ORPAR operations.
 */
async function promptSystemLlm(): Promise<boolean> {
    const response = await prompts({
        type: 'confirm',
        name: 'enabled',
        message: 'Enable SystemLLM? (uses LLM credits for server-side operations)',
        initial: false,
    }, { onCancel });

    if (response.enabled === undefined) {
        onCancel();
    }

    return response.enabled;
}

/**
 * Prompt for and configure semantic search embedding settings.
 * Returns the embedding configuration or a disabled default.
 */
async function promptEmbeddings(provider: string): Promise<{ provider: string; model: string; dimensions: number }> {
    const response = await prompts({
        type: 'confirm',
        name: 'configure',
        message: 'Configure semantic search embeddings?',
        initial: true,
    }, { onCancel });

    if (response.configure === undefined) {
        onCancel();
    }

    if (!response.configure) {
        return { provider: '', model: '', dimensions: 1536 };
    }

    // OpenRouter uses a known embedding model — no need to prompt
    if (provider === 'openrouter') {
        logInfo('Using embedding model: openai/text-embedding-3-small (1536 dimensions)');
        return {
            provider: 'openrouter',
            model: 'openai/text-embedding-3-small',
            dimensions: 1536,
        };
    }

    // For other providers, prompt for the embedding model name
    const embeddingResponse = await prompts({
        type: 'text',
        name: 'model',
        message: 'Enter embedding model name',
        initial: 'text-embedding-3-small',
    }, { onCancel });

    if (embeddingResponse.model === undefined) {
        onCancel();
    }

    return {
        provider,
        model: embeddingResponse.model,
        dimensions: 1536,
    };
}

/**
 * Verify the API key works by making a test request to the provider.
 * Currently only OpenRouter verification is implemented (GET /api/v1/models).
 * Other providers log a skip message since their auth endpoints vary.
 */
async function verifyApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey || provider === 'ollama') {
        return;
    }

    if (provider === 'openrouter') {
        try {
            await axios.get('https://openrouter.ai/api/v1/models', {
                headers: { Authorization: `Bearer ${apiKey}` },
                timeout: 10000,
            });
            logSuccess('Connection verified — API key is valid.');
        } catch {
            logWarning('Could not verify API key. Check your key and try again if needed.');
        }
        return;
    }

    logInfo(`API key verification skipped for ${provider} (not yet supported).`);
}

/**
 * Build the MxfLlmConfig object from the collected prompt responses.
 */
function buildLlmConfig(
    provider: string,
    apiKey: string,
    defaultModel: string,
    systemLlmEnabled: boolean,
    embedding: { provider: string; model: string; dimensions: number },
): MxfLlmConfig {
    return {
        provider,
        apiKey,
        defaultModel,
        systemLlm: {
            enabled: systemLlmEnabled,
            provider: systemLlmEnabled ? provider : '',
            model: systemLlmEnabled ? defaultModel : '',
        },
        embedding,
    };
}

/**
 * Print the final configuration summary and next steps.
 */
function printSummary(
    provider: string,
    defaultModel: string,
    systemLlmEnabled: boolean,
    agentModels: Record<string, string>,
): void {
    console.log('');
    logSuccess('LLM configuration saved to ~/.mxf/config.json');
    console.log('');
    logInfo(`Provider:  ${provider}`);
    logInfo(`Model:     ${defaultModel}`);
    logInfo(`SystemLLM: ${systemLlmEnabled ? 'enabled' : 'disabled'}`);

    if (Object.keys(agentModels).length > 0) {
        logInfo('Agent model overrides:');
        for (const [agentId, model] of Object.entries(agentModels)) {
            logInfo(`  ${agentId}: ${model}`);
        }
    }

    console.log('');
    logInfo('Next steps:');
    logInfo("  Run 'mxf' to start an interactive session");
    logInfo("  Run 'mxf run \"your task\"' for one-shot execution");
}

/**
 * Register the `mxf init` command on the commander program.
 * This command walks the user through interactive LLM configuration.
 */
export function registerInitCommand(program: Command): void {
    program
        .command('init')
        .description('Configure LLM provider, API keys, and default models')
        .action(async () => {
            logHeader('MXF CLI Setup');

            // Verify config exists (created by `mxf install`)
            const configService = ConfigService.getInstance();
            if (!configService.exists()) {
                logError('No config found. Run `mxf install` first.');
                process.exit(1);
            }

            // Step 1: Select LLM provider
            const provider = await promptProvider();

            // Step 2: Enter API key (skipped for ollama)
            const apiKey = await promptApiKey(provider);

            // Step 3: Select default model
            const defaultModel = await promptDefaultModel(provider);

            // Step 3b: Optional per-agent model overrides
            const existingConfig = configService.load();
            const agentModels = await promptPerAgentModels(
                provider, defaultModel, existingConfig?.agents?.customAgentsDir,
            );

            // Step 4: SystemLLM configuration
            const systemLlmEnabled = await promptSystemLlm();

            // Step 5: Embedding configuration
            const embedding = await promptEmbeddings(provider);

            // Step 6: Verify API key connectivity
            await verifyApiKey(provider, apiKey);

            // Step 7: Build and save LLM config
            const llmConfig = buildLlmConfig(provider, apiKey, defaultModel, systemLlmEnabled, embedding);
            configService.set('llm', llmConfig);

            // Step 7b: Save per-agent model overrides if any were set
            if (Object.keys(agentModels).length > 0) {
                const currentAgents = existingConfig?.agents || {};
                configService.set('agents', {
                    ...currentAgents,
                    models: agentModels,
                });
                logSuccess(`Per-agent model overrides saved (${Object.keys(agentModels).length} agents customized).`);
            }

            // Step 8: Write .env bridge file for bun run dev compatibility
            configService.writeEnvFile(process.cwd());
            logSuccess('.env bridge file updated.');

            // Step 9: Print summary and next steps
            printSummary(provider, defaultModel, systemLlmEnabled, agentModels);
        });
}
