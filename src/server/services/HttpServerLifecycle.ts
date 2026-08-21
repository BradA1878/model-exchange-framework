import { Server } from 'http';

/**
 * Resolve only after the HTTP server is actually listening and surface bind
 * failures through normal startup error handling instead of a later process
 * exception.
 */
export const listenForHttpServer = (server: Server, port: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        const removeStartupListeners = (): void => {
            server.off('error', onError);
            server.off('listening', onListening);
        };
        const onError = (error: Error): void => {
            removeStartupListeners();
            reject(error);
        };
        const onListening = (): void => {
            removeStartupListeners();
            resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        try {
            server.listen(port);
        } catch (error) {
            removeStartupListeners();
            reject(error);
        }
    });
