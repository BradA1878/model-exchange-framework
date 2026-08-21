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

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The root package.json sits two directories above this module in both
 * layouts the app runs from: src/shared (bun, source) and dist/shared (built).
 */
const PACKAGE_JSON_PATH = resolve(__dirname, '..', '..', 'package.json');

/**
 * Read the app version from the root package.json.
 *
 * This is the one source for the version the server reports from /health and
 * the CLI prints for --version. It deliberately does not consult
 * npm_package_version: that variable is only present when the process was
 * started through a package script, so a direct `bun src/server/index.ts`
 * used to report "unknown".
 *
 * @throws Error when package.json cannot be read or declares no version
 */
export function readAppVersion(): string {
    const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    const version = typeof parsed === 'object' && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined;

    if (typeof version !== 'string' || version.trim().length === 0) {
        throw new Error(`${PACKAGE_JSON_PATH} declares no version`);
    }

    return version;
}
