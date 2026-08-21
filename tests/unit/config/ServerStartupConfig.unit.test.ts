import { getServerPort } from '../../../src/server/config/ServerStartupConfig';

describe('ServerStartupConfig', () => {
    it('returns a validated numeric TCP port', () => {
        expect(getServerPort({ MXF_PORT: ' 4321 ' })).toBe(4321);
    });

    it.each(['0', '65536', '-1', '3001abc', '3.5', 'socket.sock']) (
        'rejects invalid MXF_PORT=%s instead of treating it as a pipe or partial number',
        configured => {
            expect(() => getServerPort({ MXF_PORT: configured })).toThrow('MXF_PORT');
        }
    );
});
