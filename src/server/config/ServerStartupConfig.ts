import { DEFAULT_SERVER_CONFIG } from '@mxf-dev/core/config/ServerConfig';

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;

/** Resolve MXF's HTTP port as a TCP port, never as an accidental pipe path. */
export const getServerPort = (environment: NodeJS.ProcessEnv = process.env): number => {
    const configured = environment.MXF_PORT;
    if (configured === undefined || configured.trim() === '') {
        return DEFAULT_SERVER_CONFIG.port;
    }

    const normalized = configured.trim();
    if (!/^\d+$/.test(normalized)) {
        throw new Error('MXF_PORT must be an integer TCP port');
    }

    const port = Number(normalized);
    if (!Number.isSafeInteger(port) || port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
        throw new Error(`MXF_PORT must be between ${MIN_TCP_PORT} and ${MAX_TCP_PORT}`);
    }

    return port;
};
