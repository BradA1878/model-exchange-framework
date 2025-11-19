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
 * Generic LLM Provider Types
 * 
 * This enum provides a basic type-safe way to reference different kinds of LLM providers,
 * but without any hardcoded implementation details to maintain provider-agnosticism.
 */

/**
 * LLM provider type identifiers
 */
export enum LlmProviderType {
    // Actual provider identifiers used by client implementations
    OPENAI = 'openai',
    ANTHROPIC = 'anthropic',
    OPENROUTER = 'openrouter',
    AZURE_OPENAI = 'azure-openai',
    XAI = 'xai',
    GEMINI = 'gemini',
    OLLAMA = 'ollama',
    // Generic provider types that can be used for future implementations
    PROVIDER_TYPE_1 = 'provider_type_1',
    PROVIDER_TYPE_2 = 'provider_type_2',
    PROVIDER_TYPE_3 = 'provider_type_3',
    CUSTOM = 'custom'
}
