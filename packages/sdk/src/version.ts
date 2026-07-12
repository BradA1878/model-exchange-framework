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
 * SDK version.
 *
 * This must equal the `version` field in packages/sdk/package.json. Nothing here
 * enforces that at runtime — `tests/unit/sdk/MxfClientPublicApi.unit.test.ts` does,
 * and it fails the build the moment the two drift. Bump both together.
 *
 * It is a literal rather than a package.json read because this module has to compile
 * under all three of the SDK's consumption paths: NodeNext ESM (`dist/`), Bun reading
 * `src/` directly via the `bun` export condition, and CommonJS under ts-jest. There is
 * no single filesystem-resolution trick that works in all three (`import.meta.url` is
 * illegal in CommonJS, `__dirname` is illegal in ESM), and `rootDir: "src"` rules out
 * importing `../package.json` outright.
 *
 * It was previously `"DEV-BUILD-" + new Date().toISOString()`, which shipped a build
 * timestamp to npm and told consumers nothing about what they had installed.
 */
export const SDK_VERSION = '2.0.0';
