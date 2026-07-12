/**
 * Unit tests for the framework Logger.
 *
 * Two bugs are pinned here.
 *
 * 1. Errors used to be suppressed along with everything else.
 *    Both logging targets ship `enabled: false`, and the enabled flag gated
 *    EVERY level — so a server app that had not called enableServerLogging()
 *    before its fatal handlers ran exited with no output at all when startup
 *    validation threw (this is the silent crash seen in the simulacria.ai 2.0
 *    deploy). Combined with the event buses, which catch handler failures and
 *    log them, failures vanished completely. Errors now ignore the enabled flag.
 *
 * 2. Per-instance levels were dead.
 *    log() read `targetConfig.level || this.level`, and targetConfig.level is
 *    ALWAYS a non-empty string, so `new Logger('warn', ...)` and setLevel() were
 *    silently discarded everywhere in the codebase. The instance level and the
 *    target level are now both honoured: the more restrictive one wins, so an
 *    operator's global ceiling still holds while a noisy component can turn
 *    itself down.
 */

import {
    Logger,
    enableServerLogging,
    disableServerLogging,
    enableClientLogging,
    disableClientLogging
} from '@mxf-dev/core/utils/Logger';

describe('Logger', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleInfoSpy: jest.SpyInstance;
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        // LOGGING_CONFIG is module-global state — return both targets to the
        // shipped default (disabled) so other suites see a clean slate.
        disableServerLogging();
        disableClientLogging();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleInfoSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('errors always surface', () => {
        it('writes errors even though logging is disabled by default', () => {
            const logger = new Logger('debug', 'Test', 'server');

            logger.error('fatal boot error');

            // A library that swallows its own errors leaves consumers no way to
            // find out something broke.
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const [prefix, message] = consoleErrorSpy.mock.calls[0];
            expect(prefix).toContain('[SERVER][ERROR][Test]');
            expect(message).toContain('fatal boot error');
        });

        it('writes errors after disableServerLogging()', () => {
            enableServerLogging('debug');
            disableServerLogging();

            new Logger('debug', 'Test', 'server').error('still an error');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        it('writes errors on the client pathway when disabled too', () => {
            disableClientLogging();

            new Logger('debug', 'Test', 'client').error('client-side error');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy.mock.calls[0][0]).toContain('[CLIENT]');
        });

        it('writes errors even when the instance level is the most restrictive', () => {
            enableServerLogging('error');

            new Logger('error', 'Test', 'server').error('boom');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('non-error output respects the enabled flag', () => {
        it('suppresses info/warn/debug while disabled', () => {
            const logger = new Logger('trace', 'Test', 'server');

            logger.warn('a warning');
            logger.info('a banner');
            logger.debug('a detail');
            logger.trace('a trace');

            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('emits info once enableServerLogging() has been called', () => {
            enableServerLogging('info');

            new Logger('info', 'Test', 'server').info('startup banner');

            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
        });

        it('gates client and server pathways independently', () => {
            enableClientLogging('info');

            new Logger('info', 'Test', 'server').info('server banner');
            new Logger('info', 'Test', 'client').info('client banner');

            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
            expect(consoleInfoSpy.mock.calls[0][0]).toContain('[CLIENT]');
        });
    });

    describe('level resolution', () => {
        it('honours the target level (the operator-set ceiling)', () => {
            enableServerLogging('error');
            const logger = new Logger('debug', 'Test', 'server');

            logger.info('startup banner');
            logger.error('fatal boot error');

            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        it('honours the instance level so a noisy component can turn itself down', () => {
            // Before the fix, targetConfig.level always won and this instance
            // level was discarded, so 'info' printed.
            enableServerLogging('debug');
            const quiet = new Logger('warn', 'Quiet', 'server');

            quiet.info('should be suppressed by the instance level');
            quiet.warn('should print');

            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        });

        it('lets the more restrictive of the two levels win', () => {
            enableServerLogging('warn');
            const chatty = new Logger('trace', 'Chatty', 'server');

            // The instance asks for trace, but the operator capped output at warn.
            chatty.info('suppressed by the target ceiling');
            chatty.warn('allowed by both');

            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        });

        it('applies setLevel() to subsequent calls', () => {
            enableServerLogging('debug');
            const logger = new Logger('debug', 'Test', 'server');

            logger.info('first');
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);

            logger.setLevel('error');
            logger.info('second');

            // setLevel() used to be ignored entirely.
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
            expect(logger.getLevel()).toBe('error');
        });
    });

    describe('invalid levels fail fast', () => {
        it('rejects an unknown level in the constructor', () => {
            // This is the FrameworkAdapter bug: new Logger('FrameworkAdapter')
            // passed a context string as the level.
            expect(() => new Logger('FrameworkAdapter')).toThrow(/unknown log level/i);
        });

        it('rejects an unknown level in setLevel()', () => {
            const logger = new Logger('info', 'Test', 'server');
            expect(() => logger.setLevel('verbose')).toThrow(/unknown log level/i);
        });
    });

    describe('child()', () => {
        it('carries the level, target and a combined context', () => {
            enableServerLogging('debug');
            const child = new Logger('warn', 'Parent', 'server').child('Child');

            child.info('suppressed by the inherited instance level');
            child.warn('printed');

            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleWarnSpy.mock.calls[0][0]).toContain('[Parent:Child]');
        });
    });
});
