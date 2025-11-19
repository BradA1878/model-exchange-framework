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
 * Base MCP Handler class
 * Provides common functionality for all MCP handlers
 */
import { Logger } from '../../shared/utils/Logger';
import { createStrictValidator } from '../../shared/utils/validation';

/**
 * Abstract base class for MCP protocol handlers
 */
export abstract class Handler {
    protected logger: Logger;
    protected validator = createStrictValidator('HandlerBase');
    
    /**
     * Create a new handler
     * @param loggerName Name to use for the logger
     */
    constructor(loggerName: string) {
        this.logger = new Logger('debug', loggerName, 'client');
    }
}
