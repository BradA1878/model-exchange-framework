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
 * @repository https://github.com/mxf-dev/mxf
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * LLM Provider Factory for MCP
 * 
 * This module maps LLM provider types to their concrete MCP client implementations,
 * enabling provider-agnostic code while still supporting specific providers.
 */

import { LlmProviderType } from './LlmProviders.js';
import { IMcpClient } from './IMcpClient.js';
import { OpenAiMcpClient } from './providers/OpenAiMcpClient.js';
import { AnthropicMcpClient } from './providers/AnthropicMcpClient.js';
import { OpenRouterMcpClient } from './providers/OpenRouterMcpClient.js';
import { AzureOpenAiMcpClient } from './providers/AzureOpenAiMcpClient.js';
import { XaiMcpClient } from './providers/XaiMcpClient.js';
import { GeminiMcpClient } from './providers/GeminiMcpClient.js';
import { OllamaMcpClient } from './providers/OllamaMcpClient.js';
import { CustomMcpClient } from './providers/CustomMcpClient.js';

// Static provider mapping - no more dynamic imports needed
const getProviderImplementation = (providerType: LlmProviderType): new () => IMcpClient => {
    switch (providerType) {
        case LlmProviderType.OPENAI:
            return OpenAiMcpClient;
        case LlmProviderType.ANTHROPIC:
            return AnthropicMcpClient;
        case LlmProviderType.OPENROUTER:
            return OpenRouterMcpClient;
        case LlmProviderType.AZURE_OPENAI:
            return AzureOpenAiMcpClient;
        case LlmProviderType.XAI:
            return XaiMcpClient;
        case LlmProviderType.GEMINI:
            return GeminiMcpClient;
        case LlmProviderType.OLLAMA:
            return OllamaMcpClient;
        case LlmProviderType.CUSTOM:
            return CustomMcpClient;
        default:
            throw new Error(`Unsupported LLM provider type: ${providerType}`);
    }
};

/**
 * Factory for creating LLM provider implementations for MCP
 */
export class LlmProviderFactory {
    /**
     * Get a client implementation class for a given provider type
     * 
     * @param providerType - The type of LLM provider to use
     * @returns The client implementation class
     */
    public static getImplementation(providerType: LlmProviderType): new () => IMcpClient {
        try {
            // Get the provider implementation
            return getProviderImplementation(providerType);
        } catch (error) {
            throw new Error(`Error getting provider implementation for ${providerType}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
