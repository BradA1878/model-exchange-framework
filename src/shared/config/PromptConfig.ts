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
 * Prompt Configuration
 * 
 * Controls how system prompts are generated for agents
 */

export interface PromptConfig {
    /**
     * Use discovery-oriented minimal prompts instead of verbose tool listings
     * @default true
     */
    useDiscoveryPrompts?: boolean;

    /**
     * Include tool schemas in traditional prompts
     * @default true
     */
    includeToolSchemas?: boolean;

    /**
     * Include usage examples in traditional prompts
     * @default false
     */
    includeUsageExamples?: boolean;

    /**
     * Include ORPAR guidance
     * @default true
     */
    includeOrparGuidance?: boolean;

    /**
     * Focus on core MXF tools only (not external tools)
     * @default true
     */
    coreToolsOnly?: boolean;
}

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
    useDiscoveryPrompts: true,  // New default: use discovery approach
    includeToolSchemas: true,
    includeUsageExamples: false,
    includeOrparGuidance: true,
    coreToolsOnly: true
};

/**
 * Get prompt configuration from environment or defaults
 */
export function getPromptConfig(): PromptConfig {
    const config: PromptConfig = { ...DEFAULT_PROMPT_CONFIG };

    // Override from environment if set
    if (process.env.MXF_USE_DISCOVERY_PROMPTS !== undefined) {
        config.useDiscoveryPrompts = process.env.MXF_USE_DISCOVERY_PROMPTS === 'true';
    }

    if (process.env.MXF_VERBOSE_PROMPTS === 'true') {
        // Enable verbose mode
        config.useDiscoveryPrompts = false;
        config.includeUsageExamples = true;
    }

    return config;
}