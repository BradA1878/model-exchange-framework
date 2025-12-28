/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * SDK Configuration Module
 * 
 * Centralized configuration with environment variable support
 */

/**
 * Server configuration options
 */
export interface ServerConfig {
    host: string;
    port: number;
    secure: boolean;
}

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
    host: 'localhost',
    port: 3001,
    secure: false
};

/**
 * Get server configuration with environment variable support
 */
export function getServerConfig(): ServerConfig {
    return {
        host: process.env.MXF_HOST || DEFAULT_SERVER_CONFIG.host,
        port: process.env.MXF_PORT ?
            parseInt(process.env.MXF_PORT, 10) :
            DEFAULT_SERVER_CONFIG.port,
        secure: process.env.MXF_SECURE === 'true' || DEFAULT_SERVER_CONFIG.secure
    };
}

/**
 * Build server URL from configuration
 */
export function buildServerUrl(config?: Partial<ServerConfig>): string {
    const serverConfig = {
        ...getServerConfig(),
        ...config
    };
    
    const protocol = serverConfig.secure ? 'https' : 'http';
    return `${protocol}://${serverConfig.host}:${serverConfig.port}`;
}
