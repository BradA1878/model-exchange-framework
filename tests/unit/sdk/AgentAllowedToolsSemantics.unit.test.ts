import { MxfToolService } from '../../../packages/sdk/src/services/MxfToolService';
import { ToolHelpers } from '../../../packages/sdk/src/MxfAgentHelpers';
import {
    MxfTaskExecutionManager,
    TaskExecutionCallbacks
} from '../../../packages/sdk/src/managers/MxfTaskExecutionManager';

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
        child(): MockLogger { return this; }
    }
}));

const tools = [
    {
        name: 'tool-a',
        description: 'A',
        inputSchema: {},
        enabled: true,
        providerId: 'core',
        channelId: 'channel-1'
    },
    {
        name: 'tool-b',
        description: 'B',
        inputSchema: {},
        enabled: true,
        providerId: 'core',
        channelId: 'channel-1'
    }
];

describe('agent allowedTools semantics in the SDK', () => {
    it('preserves the server-filtered default only when allowedTools is omitted', () => {
        const service = new MxfToolService('agent-1', 'channel-1');

        expect(service.filterToolsByAllowed(tools, undefined)).toEqual(tools);
        expect(service.filterToolsByAllowed(tools, [])).toEqual([]);
        expect(service.filterToolsByAllowed(tools, ['tool-b'])).toEqual([tools[1]]);
    });

    it('does not let contextual gatekeeping turn an explicit empty list into unrestricted tools', () => {
        const logger = {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn()
        } as never;

        expect(ToolHelpers.getContextualTools(
            [],
            tools,
            { agentId: 'agent-1', allowedTools: [], disableToolGatekeeping: true },
            logger
        )).toEqual([]);
    });

    it('passes no tools into task generation for an explicit empty list', async () => {
        const generateResponse = jest.fn().mockResolvedValue('done');
        const callbacks: TaskExecutionCallbacks = {
            generateResponse,
            getCachedTools: () => tools,
            setCurrentTask: jest.fn(),
            getCurrentTask: jest.fn(),
            updateSystemPromptForTask: jest.fn().mockResolvedValue(undefined),
            isToolGatekeepingDisabled: () => true,
            getAllowedTools: () => []
        };
        const manager = new MxfTaskExecutionManager('agent-1', callbacks);

        await manager.executeTask({ taskId: 'task-1', content: 'Do work' });

        expect(generateResponse).toHaveBeenCalledWith(
            null,
            [],
            expect.not.stringContaining('Call task_complete when finished')
        );
    });
});
