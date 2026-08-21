/**
 * SystemLLM model configuration comes from the environment, with no built-in
 * model ids. When SystemLLM is on, SYSTEMLLM_DEFAULT_MODEL is required and the
 * server refuses to boot without it; per-operation SYSTEMLLM_MODEL_* variables
 * override the default for one ORPAR operation each.
 *
 * Before this, five literal model tables in SystemLlmService chose models
 * silently whenever the operator set nothing.
 */

const mockIsChannelSystemLlmEnabled = jest.fn(() => true);

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn(() => ({ unsubscribe: jest.fn() })),
            off: jest.fn(),
            emit: jest.fn(),
            emitOn: jest.fn()
        }
    }
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigEvents: { CHANNEL_SYSTEM_LLM_CHANGED: 'config:channel_system_llm_changed' },
    ConfigManager: {
        getInstance: (): { isChannelSystemLlmEnabled: typeof mockIsChannelSystemLlmEnabled } => ({
            isChannelSystemLlmEnabled: mockIsChannelSystemLlmEnabled
        })
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
        child(): this { return this; }
    }
}));

jest.mock('../../../src/server/socket/services/SystemLlmBudgetService', () => ({
    SystemLlmBudgetService: {
        getInstance: (): { isExhausted: () => boolean } => ({ isExhausted: (): boolean => false })
    }
}));

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: jest.fn() }
}));

import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';
import { SystemLlmService, MODEL_UPGRADES } from '../../../src/server/socket/services/SystemLlmService';
import {
    assertSystemLlmConfigured,
    loadSystemLlmEnvironmentConfig,
    SystemLlmServiceManager
} from '../../../src/server/socket/services/SystemLlmServiceManager';

const SYSTEMLLM_VARS = [
    'SYSTEMLLM_ENABLED',
    'SYSTEMLLM_PROVIDER',
    'SYSTEMLLM_DEFAULT_MODEL',
    'SYSTEMLLM_MODEL_OBSERVATION',
    'SYSTEMLLM_MODEL_REASONING',
    'SYSTEMLLM_MODEL_ACTION',
    'SYSTEMLLM_MODEL_PLANNING',
    'SYSTEMLLM_MODEL_REFLECTION',
    'SYSTEMLLM_DYNAMIC_MODEL_SELECTION',
    'OPENROUTER_API_KEY'
] as const;

describe('SystemLLM configuration', () => {
    const saved = new Map<string, string | undefined>();

    beforeEach(() => {
        for (const name of SYSTEMLLM_VARS) {
            saved.set(name, process.env[name]);
            delete process.env[name];
        }
        process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
        (SystemLlmServiceManager as unknown as { instance?: SystemLlmServiceManager }).instance = undefined;
    });

    afterEach(() => {
        for (const name of SYSTEMLLM_VARS) {
            const value = saved.get(name);
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        (SystemLlmServiceManager as unknown as { instance?: SystemLlmServiceManager }).instance = undefined;
    });

    it('refuses to boot with SystemLLM on and no default model', () => {
        process.env.SYSTEMLLM_ENABLED = 'true';

        expect(() => assertSystemLlmConfigured()).toThrow(
            'Missing required environment variable SYSTEMLLM_DEFAULT_MODEL'
        );
    });

    it('treats an unset SYSTEMLLM_ENABLED as on, so the model is still required', () => {
        expect(() => assertSystemLlmConfigured()).toThrow('SYSTEMLLM_DEFAULT_MODEL');
    });

    it('needs nothing else when SystemLLM is off', () => {
        process.env.SYSTEMLLM_ENABLED = 'false';
        delete process.env.OPENROUTER_API_KEY;

        expect(() => assertSystemLlmConfigured()).not.toThrow();
        expect(loadSystemLlmEnvironmentConfig()).toBeNull();
    });

    it('uses the default model for every operation unless an operation names its own', () => {
        process.env.SYSTEMLLM_ENABLED = 'true';
        process.env.SYSTEMLLM_DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';
        process.env.SYSTEMLLM_MODEL_REASONING = '~anthropic/claude-opus-latest';
        process.env.SYSTEMLLM_MODEL_ACTION = '~anthropic/claude-haiku-latest';
        process.env.SYSTEMLLM_DYNAMIC_MODEL_SELECTION = 'false';

        const config = loadSystemLlmEnvironmentConfig();
        expect(config).toMatchObject({
            providerType: LlmProviderType.OPENROUTER,
            defaultModel: '~anthropic/claude-sonnet-latest',
            orparModels: {
                reasoning: '~anthropic/claude-opus-latest',
                action: '~anthropic/claude-haiku-latest'
            }
        });

        const service = SystemLlmServiceManager.getInstance().getServiceForChannel('channel-a');
        expect(service).not.toBeNull();
        expect(service!.getModelForOperation('observation')).toBe('~anthropic/claude-sonnet-latest');
        expect(service!.getModelForOperation('reasoning')).toBe('~anthropic/claude-opus-latest');
        expect(service!.getModelForOperation('action')).toBe('~anthropic/claude-haiku-latest');
        expect(service!.getModelForOperation('planning')).toBe('~anthropic/claude-sonnet-latest');
        expect(service!.getModelForOperation('reflection')).toBe('~anthropic/claude-sonnet-latest');
        expect(service!.defaultModel).toBe('~anthropic/claude-sonnet-latest');
        SystemLlmServiceManager.getInstance().shutdown();
    });

    it('rejects a blank per-operation model instead of silently using the default', () => {
        process.env.SYSTEMLLM_ENABLED = 'true';
        process.env.SYSTEMLLM_DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';
        process.env.SYSTEMLLM_MODEL_PLANNING = '   ';

        expect(() => loadSystemLlmEnvironmentConfig()).toThrow('SYSTEMLLM_MODEL_PLANNING');
    });

    it('a service built from explicit config still needs a model', () => {
        expect(() => new SystemLlmService('channel-a', { providerType: LlmProviderType.OPENROUTER } as never))
            .toThrow('defaultModel');
    });

    it('leaves complexity-based upgrades off unless SYSTEMLLM_DYNAMIC_MODEL_SELECTION is true', () => {
        process.env.SYSTEMLLM_ENABLED = 'true';
        process.env.SYSTEMLLM_DEFAULT_MODEL = 'google/gemini-2.5-flash'; // has an upgrade entry

        let service = SystemLlmServiceManager.getInstance().getServiceForChannel('channel-d')!;
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'complex')).toBe('google/gemini-2.5-flash');
        SystemLlmServiceManager.getInstance().shutdown();
        (SystemLlmServiceManager as unknown as { instance?: SystemLlmServiceManager }).instance = undefined;

        process.env.SYSTEMLLM_DYNAMIC_MODEL_SELECTION = 'true';
        service = SystemLlmServiceManager.getInstance().getServiceForChannel('channel-d')!;
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'moderate')).toBe('~anthropic/claude-haiku-latest');
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'complex')).toBe('~anthropic/claude-sonnet-latest');
        SystemLlmServiceManager.getInstance().shutdown();
    });

    it('upgrades only to the OpenRouter latest Claude aliases', () => {
        const aliases = new Set([
            '~anthropic/claude-haiku-latest',
            '~anthropic/claude-sonnet-latest',
            '~anthropic/claude-opus-latest'
        ]);
        const openRouter = MODEL_UPGRADES[LlmProviderType.OPENROUTER] ?? {};
        expect(Object.keys(openRouter).length).toBeGreaterThan(0);
        for (const [base, targets] of Object.entries(openRouter)) {
            expect({ base, moderate: aliases.has(targets.moderate) }).toEqual({ base, moderate: true });
            expect({ base, complex: aliases.has(targets.complex) }).toEqual({ base, complex: true });
        }
        // fable is never an upgrade target
        const json = JSON.stringify(MODEL_UPGRADES);
        expect(json).not.toContain('fable');
    });

    it('refuses to build a service when SystemLLM was off at boot and turned on later', () => {
        process.env.SYSTEMLLM_ENABLED = 'false';
        const manager = SystemLlmServiceManager.getInstance();

        process.env.SYSTEMLLM_ENABLED = 'true';
        expect(() => manager.getServiceForChannel('channel-c')).toThrow('SYSTEMLLM_ENABLED changed after boot');
    });

    it('keeps the env-derived model when a channel passes partial overrides', () => {
        process.env.SYSTEMLLM_ENABLED = 'true';
        process.env.SYSTEMLLM_DEFAULT_MODEL = 'google/gemini-2.5-flash';

        const manager = SystemLlmServiceManager.getInstance();
        const service = manager.getServiceForChannel('channel-b', { defaultTemperature: 0.1 });
        expect(service!.defaultModel).toBe('google/gemini-2.5-flash');
        expect(service!.defaultTemperature).toBe(0.1);
        manager.shutdown();
    });
});
