const mockManagerShutdown = jest.fn();
const mockManagerRegisterServer = jest.fn();
const mockHybridShutdown = jest.fn();
const mockRegisterExternalToolsProvider = jest.fn();
const mockClearExternalToolsProvider = jest.fn();
const mockSetHybridRegistry = jest.fn();
const mockClearHybridRegistry = jest.fn();

const mockManager = {
    registerServer: mockManagerRegisterServer,
    shutdown: mockManagerShutdown
};
const mockHybridRegistry = {
    getExternalTools: jest.fn().mockReturnValue([]),
    shutdown: mockHybridShutdown
};
const mockToolRegistry = {
    registerExternalToolsProvider: mockRegisterExternalToolsProvider,
    clearExternalToolsProvider: mockClearExternalToolsProvider
};

jest.mock('@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager', () => ({
    ExternalMcpServerManager: jest.fn().mockImplementation(() => mockManager)
}));

jest.mock('@mxf-dev/core/protocols/mcp/services/ExternalServerConfigs', () => ({
    EXTERNAL_SERVER_CONFIGS: [],
    getAutoStartConfigs: jest.fn().mockReturnValue([])
}));

jest.mock('../../../src/server/mcp/services/HybridMcpToolRegistry', () => ({
    HybridMcpToolRegistry: jest.fn().mockImplementation(() => mockHybridRegistry)
}));

jest.mock('../../../src/server/mcp/services/HybridMcpRegistryAccess', () => ({
    setHybridMcpToolRegistry: mockSetHybridRegistry,
    clearHybridMcpToolRegistry: mockClearHybridRegistry
}));

jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: {
        getInstance: (): typeof mockToolRegistry => mockToolRegistry
    }
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: (): { assertIsObject: jest.Mock } => ({ assertIsObject: jest.fn() })
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation((): {
        info: jest.Mock;
        warn: jest.Mock;
        error: jest.Mock;
        debug: jest.Mock;
    } => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { HybridMcpToolRegistry } from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import { ServerHybridMcpService } from '../../../src/server/api/services/ServerHybridMcpService';

describe('ServerHybridMcpService shutdown', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockManagerShutdown.mockResolvedValue(undefined);
        mockHybridShutdown.mockResolvedValue(undefined);
    });

    it('detaches the provider, subscriptions, and accessor, then permits clean reconstruction', async () => {
        const service = ServerHybridMcpService.getInstance({
            externalServerConfigs: [],
            autoStartPriorityServers: false
        });

        expect(mockRegisterExternalToolsProvider).toHaveBeenCalledTimes(1);
        expect(mockSetHybridRegistry).toHaveBeenCalledWith(mockHybridRegistry);

        await service.shutdown();

        expect(mockClearHybridRegistry).toHaveBeenCalledTimes(1);
        expect(mockClearExternalToolsProvider).toHaveBeenCalledTimes(1);
        expect(mockHybridShutdown).toHaveBeenCalledTimes(1);
        expect(mockManagerShutdown).toHaveBeenCalledTimes(1);

        const reconstructed = ServerHybridMcpService.getInstance({
            externalServerConfigs: [],
            autoStartPriorityServers: false
        });
        expect(reconstructed).not.toBe(service);
        expect(HybridMcpToolRegistry).toHaveBeenCalledTimes(2);

        await reconstructed.shutdown();
    });
});
