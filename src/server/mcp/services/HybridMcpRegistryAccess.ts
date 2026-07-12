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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * HybridMcpRegistryAccess.ts
 *
 * Typed access to the process-wide HybridMcpToolRegistry.
 *
 * The registry was previously published as `(global as any).hybridMcpToolRegistry`
 * and read back in eleven places, each one an untyped property lookup on `global`
 * that the compiler could not check and that returned `undefined` whenever the
 * hybrid service had not started yet. Two different classes wrote it.
 *
 * This module is the one place it is stored, with a type. Consumers that can work
 * without external tools call {@link getHybridMcpToolRegistry} and check for null;
 * consumers that genuinely need it call {@link requireHybridMcpToolRegistry} and
 * get a clear error instead of a `TypeError: Cannot read properties of undefined`.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import type { HybridMcpToolRegistry } from './HybridMcpToolRegistry';

const logger = new Logger('info', 'HybridMcpRegistryAccess', 'server');

/**
 * The active registry, or null before ServerHybridMcpService has constructed it.
 */
let registry: HybridMcpToolRegistry | null = null;

/**
 * Publish the registry. Called by ServerHybridMcpService as it starts up.
 */
export function setHybridMcpToolRegistry(next: HybridMcpToolRegistry): void {
    if (registry && registry !== next) {
        // Two registries in one process means half the callers would be talking to
        // a registry that is not the one the servers are attached to.
        logger.warn(
            'A HybridMcpToolRegistry was already registered and is being replaced. ' +
            'Only one should exist per process.'
        );
    }
    registry = next;
}

/**
 * Clear the registry. Called on shutdown.
 */
export function clearHybridMcpToolRegistry(): void {
    registry = null;
}

/**
 * The registry, or null when the hybrid MCP service is not running.
 *
 * Use this where external tools are an enhancement — listing tools, counting
 * them — and the caller has something sensible to do without them.
 */
export function getHybridMcpToolRegistry(): HybridMcpToolRegistry | null {
    return registry;
}

/**
 * The registry, or a thrown error explaining that it is not available.
 *
 * Use this where the caller cannot do its job without external tools, so that the
 * failure names the cause rather than surfacing as a null dereference later.
 */
export function requireHybridMcpToolRegistry(consumer: string): HybridMcpToolRegistry {
    if (!registry) {
        throw new Error(
            `${consumer} needs the hybrid MCP tool registry, but it is not available — ` +
            `ServerHybridMcpService has not been initialized.`
        );
    }
    return registry;
}
