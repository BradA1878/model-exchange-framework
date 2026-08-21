import { EventEmitter } from 'events';
import { Server } from 'http';
import { listenForHttpServer } from '../../../src/server/services/HttpServerLifecycle';

class FakeHttpServer extends EventEmitter {
    public readonly listen = jest.fn((_port: number): this => {
        this.emit('listening');
        return this;
    });

    public readonly off = jest.fn((event: string, listener: (...args: unknown[]) => void): this => {
        super.off(event, listener);
        return this;
    });
}

describe('listenForHttpServer', () => {
    it('resolves only from the listening callback and removes the startup error listener', async () => {
        const server = new FakeHttpServer();

        await expect(listenForHttpServer(server as unknown as Server, 3001)).resolves.toBeUndefined();
        expect(server.listen).toHaveBeenCalledWith(3001);
        expect(server.listenerCount('error')).toBe(0);
        expect(server.listenerCount('listening')).toBe(0);
    });

    it('rejects a bind error through startup control flow', async () => {
        const server = new FakeHttpServer();
        server.listen.mockImplementationOnce(function (this: FakeHttpServer): FakeHttpServer {
            this.emit('error', new Error('address already in use'));
            return this;
        });

        await expect(listenForHttpServer(server as unknown as Server, 3001))
            .rejects.toThrow('address already in use');
        expect(server.listenerCount('error')).toBe(0);
        expect(server.listenerCount('listening')).toBe(0);
    });
});
