const mockConnectionOn = jest.fn();
const mockConnectionClose = jest.fn();
const mockConnect = jest.fn();

jest.mock('mongoose', () => ({
    __esModule: true,
    default: {
        connection: {
            on: mockConnectionOn,
            close: mockConnectionClose
        },
        connect: mockConnect
    }
}));

jest.mock('@mxf-dev/core/utils/env', () => ({
    requireEnv: jest.fn(() => 'mongodb://example.test/mxf')
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        public error = jest.fn();
    }
}));

import {
    closeDatabase,
    connectToDatabase
} from '../../../src/server/socket/services/DatabaseService';

describe('DatabaseService lifecycle ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConnect.mockResolvedValue({});
        mockConnectionClose.mockResolvedValue(undefined);
    });

    it('does not install an independent process signal handler while connecting', async () => {
        const processOn = jest.spyOn(process, 'on');

        await connectToDatabase();

        expect(processOn).not.toHaveBeenCalled();
        processOn.mockRestore();
    });

    it('exposes explicit connection closure to the server shutdown owner', async () => {
        await closeDatabase();

        expect(mockConnectionClose).toHaveBeenCalledTimes(1);
    });
});
