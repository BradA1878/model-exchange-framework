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
 * MCP Client Factory
 * 
 * This module provides a factory for creating MCP clients.
 * It's designed to be completely provider-agnostic.
 */

import { Observable, of, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { IMcpClient, McpClientConfig } from './IMcpClient';

/**
 * Factory for creating MCP clients
 */
export class McpClientFactory {
    /**
     * Create an MCP client using the provided implementation
     * 
     * @param clientImplementation - The concrete client implementation class
     * @param config - Configuration for the client
     * @returns An observable that emits the client after initialization
     */
    public static createClient<T extends IMcpClient>(
        clientImplementation: new () => T,
        config: McpClientConfig
    ): Observable<IMcpClient> {
        try {
            // Create the client using the provided implementation
            const client = new clientImplementation();
            
            // Initialize the client and return it
            return client.initialize(config).pipe(
                map(() => client)
            );
        } catch (error) {
            return throwError(() => new Error(`Failed to create MCP client: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
}
