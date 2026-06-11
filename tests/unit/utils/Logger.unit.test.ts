/**
 * Unit tests for the framework Logger's enable/disable gating.
 *
 * Regression guard for the silent-crash bug found in the simulacria.ai 2.0
 * deploy: server logging is disabled by default, so a server app that does
 * not call enableServerLogging() before its fatal handlers run will exit
 * with no output when startup validation throws. These tests pin the
 * behavior the server boot sequence depends on.
 */

import {
    Logger,
    enableServerLogging,
    disableServerLogging,
    enableClientLogging,
    disableClientLogging
} from '@mxf-dev/core/utils/Logger';

describe('Logger output gating', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleInfoSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        // LOGGING_CONFIG is module-global state — return both targets to the
        // shipped default (disabled) so other suites see a clean slate.
        disableServerLogging();
        disableClientLogging();
        consoleErrorSpy.mockRestore();
        consoleInfoSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    it('suppresses ALL server output by default, including errors', () => {
        const logger = new Logger('debug', 'Test', 'server');
        logger.error('fatal boot error');

        // This default is WHY the server must opt in before registering
        // fatal handlers: an error logged here goes nowhere.
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('prints errors once enableServerLogging() has been called', () => {
        enableServerLogging('info');
        const logger = new Logger('debug', 'Test', 'server');
        logger.error('fatal boot error');

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [prefix, message] = consoleErrorSpy.mock.calls[0];
        expect(prefix).toContain('[SERVER][ERROR][Test]');
        expect(message).toContain('fatal boot error');
    });

    it('respects the level passed to enableServerLogging()', () => {
        enableServerLogging('error');
        const logger = new Logger('debug', 'Test', 'server');

        logger.info('startup banner');
        logger.error('fatal boot error');

        expect(consoleInfoSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('gates client and server pathways independently', () => {
        enableClientLogging('error');
        const serverLogger = new Logger('debug', 'Test', 'server');
        const clientLogger = new Logger('debug', 'Test', 'client');

        serverLogger.error('server-side error');
        clientLogger.error('client-side error');

        // Only the client pathway was enabled.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0][0]).toContain('[CLIENT]');
    });

    it('returns to silent after disableServerLogging()', () => {
        enableServerLogging('debug');
        disableServerLogging();
        const logger = new Logger('debug', 'Test', 'server');
        logger.error('should not appear');

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
