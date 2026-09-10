/** Provider boundaries are faked; all configuration and replacement logic is real. */
import { of, Subject } from 'rxjs';
import type { McpClientConfig as ProviderConfig } from '@mxf-dev/core/protocols/mcp/IMcpClient';

const mockGetImplementation = jest.fn();
jest.mock('@mxf-dev/core/protocols/mcp/LlmProviderFactory', () => ({
    LlmProviderFactory: { getImplementation: mockGetImplementation }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        debug = jest.fn(); info = jest.fn(); warn = jest.fn(); error = jest.fn();
    }
}));

import { MxfMcpClientManager } from '@mxf-dev/sdk/managers/MxfMcpClientManager';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';

class FakeProvider {
    static created: FakeProvider[] = [];
    public initialize = jest.fn((_config: ProviderConfig) => of(true));
    public sendMessage = jest.fn(() => of({ content: [], model: 'first-provider' }));
    constructor() { FakeProvider.created.push(this); }
}

class ReplacementProvider extends FakeProvider {
    public sendMessage = jest.fn(() => of({ content: [], model: 'replacement-provider' }));
}

const makeManager = (): MxfMcpClientManager => new MxfMcpClientManager('agent-a', {
    agentId: 'agent-a',
    channelId: 'channel-a',
    name: 'Agent A',
    host: 'mxf.example',
    port: 443,
    secure: true,
    keyId: 'key-a',
    secretKey: 'secret-a',
    apiUrl: 'https://mxf.example/api',
    agentConfigPrompt: 'Use the supplied task context.',
    llmProvider: LlmProviderType.AZURE_OPENAI,
    apiKey: 'test-key',
    defaultModel: 'deployment-a',
    temperature: 0.3,
    maxTokens: 1000,
    providerOptions: { endpoint: 'https://azure.example', deployment: 'deployment-a' }
});

describe('MxfMcpClientManager configuration', () => {
    beforeEach(() => {
        FakeProvider.created = [];
        mockGetImplementation.mockReset();
        mockGetImplementation.mockImplementation((provider: LlmProviderType) =>
            provider === LlmProviderType.OPENAI ? ReplacementProvider : FakeProvider);
    });

    it('passes explicit provider options to initialization', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        expect(FakeProvider.created[0].initialize).toHaveBeenCalledWith(expect.objectContaining({
            providerOptions: { endpoint: 'https://azure.example', deployment: 'deployment-a' },
            apiKey: 'test-key'
        }));
    });

    it('changes the actual provider used for the next request', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const original = manager.getMcpClient();
        await manager.updateConfig({ provider: LlmProviderType.OPENAI });
        expect(manager.getMcpClient()).not.toBe(original);
        await expect(manager.sendMessage([])).resolves.toMatchObject({ model: 'replacement-provider' });
        expect(manager.getConfig().provider).toBe(LlmProviderType.OPENAI);
    });

    it('reinitializes the same provider with changed options and request defaults', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        await manager.updateConfig({
            providerOptions: { endpoint: 'https://new.example', deployment: 'deployment-b' },
            temperature: 0.5
        });
        expect(FakeProvider.created).toHaveLength(2);
        expect(FakeProvider.created[1].initialize).toHaveBeenCalledWith(expect.objectContaining({
            providerOptions: { endpoint: 'https://new.example', deployment: 'deployment-b' },
            temperature: 0.5
        }));
    });

    it('keeps the working configuration when an update fails validation', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const original = manager.getMcpClient();
        const originalConfig = manager.getConfig();
        await expect(manager.updateConfig({ provider: '' as LlmProviderType })).rejects.toThrow(/provider is required/);
        expect(manager.getConfig()).toEqual(originalConfig);
        expect(manager.getMcpClient()).toBe(original);
        await manager.updateConfig({ provider: LlmProviderType.OPENAI });
        await expect(manager.sendMessage([])).resolves.toMatchObject({ model: 'replacement-provider' });
    });

    it('rejects malformed provider options without replacing a working client', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const original = manager.getMcpClient();
        const originalConfig = manager.getConfig();
        await expect(manager.updateConfig({ providerOptions: [] })).rejects.toThrow(/Provider options must be an object/);
        expect(manager.getConfig()).toEqual(originalConfig);
        expect(manager.getMcpClient()).toBe(original);
    });

    it('keeps an unchanged configuration on the existing provider', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const original = manager.getMcpClient();
        await manager.updateConfig({ temperature: 0.3, provider: LlmProviderType.AZURE_OPENAI });
        expect(manager.getMcpClient()).toBe(original);
        expect(FakeProvider.created).toHaveLength(1);
    });

    it('keeps the working provider and configuration when replacement initialization fails', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const original = manager.getMcpClient();
        const originalConfig = manager.getConfig();
        class RefusingProvider extends FakeProvider {
            public initialize = jest.fn((_config: ProviderConfig) => of(false));
        }
        mockGetImplementation.mockReturnValueOnce(RefusingProvider);
        await expect(manager.updateConfig({ provider: LlmProviderType.OPENAI })).rejects.toThrow(/Failed to initialize/);
        expect(manager.getConfig()).toEqual(originalConfig);
        expect(manager.getMcpClient()).toBe(original);
        await expect(manager.sendMessage([])).resolves.toMatchObject({ model: 'first-provider' });
    });

    it('does not expose a replacement until it is initialized', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const ready = new Subject<boolean>();
        class WaitingProvider extends FakeProvider {
            public initialize = jest.fn((_config: ProviderConfig) => ready);
        }
        mockGetImplementation.mockReturnValueOnce(WaitingProvider);
        const original = manager.getMcpClient();
        const update = manager.updateConfig({ provider: LlmProviderType.OPENAI });
        await Promise.resolve();
        await Promise.resolve();
        expect(manager.getMcpClient()).toBe(original);
        expect(manager.getConfig().provider).toBe(LlmProviderType.AZURE_OPENAI);
        ready.next(true);
        await update;
        expect(manager.getMcpClient()).not.toBe(original);
        expect(manager.getConfig().provider).toBe(LlmProviderType.OPENAI);
    });

    it('serializes overlapping updates so the later patch retains the new provider', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const ready = new Subject<boolean>();
        class WaitingProvider extends FakeProvider {
            public initialize = jest.fn((_config: ProviderConfig) => ready);
        }
        mockGetImplementation.mockReturnValueOnce(WaitingProvider);
        const providerUpdate = manager.updateConfig({ provider: LlmProviderType.OPENAI });
        const optionsUpdate = manager.updateConfig({ temperature: 0.8 });
        await Promise.resolve();
        await Promise.resolve();
        expect(FakeProvider.created).toHaveLength(2);
        ready.next(true);
        await Promise.all([providerUpdate, optionsUpdate]);
        expect(manager.getConfig()).toMatchObject({ provider: LlmProviderType.OPENAI, temperature: 0.8 });
        expect(FakeProvider.created).toHaveLength(3);
        expect(FakeProvider.created[2].initialize).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.8 }));
        await expect(manager.sendMessage([])).resolves.toMatchObject({ model: 'replacement-provider' });
    });

    it('does not revive a cleaned manager when initial provider setup finishes late', async () => {
        const ready = new Subject<boolean>();
        class WaitingProvider extends FakeProvider {
            public initialize = jest.fn((_config: ProviderConfig) => ready);
        }
        mockGetImplementation.mockReturnValueOnce(WaitingProvider);
        const manager = makeManager();
        const initialization = manager.initializeMcpClient();
        await manager.cleanup();
        ready.next(true);
        await expect(initialization).rejects.toThrow(/cancelled by a lifecycle change/);
        expect(manager.getMcpClient()).toBeNull();
        expect(manager.isReady()).toBe(false);

        await manager.initializeMcpClient();
        expect(manager.isReady()).toBe(true);
    });

    it('does not install a late configuration replacement after cleanup', async () => {
        const manager = makeManager();
        await manager.initializeMcpClient();
        const originalConfig = manager.getConfig();
        const ready = new Subject<boolean>();
        class WaitingProvider extends FakeProvider {
            public initialize = jest.fn((_config: ProviderConfig) => ready);
        }
        mockGetImplementation.mockReturnValueOnce(WaitingProvider);
        const update = manager.updateConfig({ provider: LlmProviderType.OPENAI });
        await Promise.resolve();
        await Promise.resolve();
        await manager.cleanup();
        ready.next(true);
        await expect(update).rejects.toThrow(/cancelled by a lifecycle change/);
        expect(manager.getConfig()).toEqual(originalConfig);
        expect(manager.getMcpClient()).toBeNull();
        expect(manager.isReady()).toBe(false);
    });
});
