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
 * PromptArgumentInferenceService
 *
 * Uses SystemLLM to intelligently infer missing prompt arguments from context.
 * This service bridges MCP Prompts with MXF's SystemLLM capabilities for
 * autonomous argument resolution.
 */

import { Logger } from '../utils/Logger';
import {
    PromptArgument,
    PromptResolutionContext,
    ArgumentResolutionResult,
    ArgumentResolutionSource
} from '../types/McpPromptTypes';

/**
 * Service for inferring prompt arguments using SystemLLM
 */
export class PromptArgumentInferenceService {
    private static instance: PromptArgumentInferenceService;
    private logger: Logger;
    private systemLlmService: any; // Will be injected at runtime

    private constructor() {
        this.logger = new Logger('info', 'PromptArgumentInferenceService', 'server');
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): PromptArgumentInferenceService {
        if (!PromptArgumentInferenceService.instance) {
            PromptArgumentInferenceService.instance = new PromptArgumentInferenceService();
        }
        return PromptArgumentInferenceService.instance;
    }

    /**
     * Set the SystemLLM service for inference
     * This is called by the server during initialization
     */
    public setSystemLlmService(service: any): void {
        this.systemLlmService = service;
        this.logger.info('SystemLLM service registered for prompt argument inference');
    }

    /**
     * Infer a missing argument value using SystemLLM
     */
    public async inferArgument(
        argument: PromptArgument,
        promptName: string,
        context: PromptResolutionContext
    ): Promise<ArgumentResolutionResult | null> {
        if (!this.systemLlmService) {
            this.logger.warn('SystemLLM service not available, cannot infer argument');
            return null;
        }

        try {
            // Build inference prompt
            const inferencePrompt = this.buildInferencePrompt(argument, promptName, context);

            // Call SystemLLM for inference
            const result = await this.systemLlmService.analyzeWithStructuredOutput(
                inferencePrompt,
                {
                    type: 'object',
                    properties: {
                        value: {
                            type: ['string', 'number', 'boolean', 'object', 'array'],
                            description: 'Inferred value for the argument'
                        },
                        confidence: {
                            type: 'number',
                            description: 'Confidence score between 0.0 and 1.0',
                            minimum: 0,
                            maximum: 1
                        },
                        reasoning: {
                            type: 'string',
                            description: 'Explanation of how the value was inferred'
                        }
                    },
                    required: ['value', 'confidence']
                }
            );

            // Validate confidence threshold (require at least 0.7)
            if (result.confidence < 0.7) {
                this.logger.warn(
                    `Low confidence (${result.confidence}) for inferred argument: ${argument.name}`
                );
                return null;
            }

            this.logger.info(`Inferred argument: ${argument.name}`, {
                value: result.value,
                confidence: result.confidence,
                reasoning: result.reasoning
            });

            return {
                value: result.value,
                source: ArgumentResolutionSource.SYSTEM_LLM,
                confidence: result.confidence
            };
        } catch (error) {
            this.logger.error(`Error inferring argument ${argument.name}:`, error);
            return null;
        }
    }

    /**
     * Build the inference prompt for SystemLLM
     */
    private buildInferencePrompt(
        argument: PromptArgument,
        promptName: string,
        context: PromptResolutionContext
    ): string {
        const parts: string[] = [];

        parts.push(`You are inferring a missing argument for an MCP prompt.`);
        parts.push(`\nPrompt Name: ${promptName}`);
        parts.push(`Argument Name: ${argument.name}`);

        if (argument.description) {
            parts.push(`Argument Description: ${argument.description}`);
        }

        parts.push(`\nAvailable Context:`);

        if (context.agentContext && Object.keys(context.agentContext).length > 0) {
            parts.push(`\nAgent Context: ${JSON.stringify(context.agentContext, null, 2)}`);
        }

        if (context.channelContext && Object.keys(context.channelContext).length > 0) {
            parts.push(`\nChannel Context: ${JSON.stringify(context.channelContext, null, 2)}`);
        }

        if (context.taskContext && Object.keys(context.taskContext).length > 0) {
            parts.push(`\nTask Context: ${JSON.stringify(context.taskContext, null, 2)}`);
        }

        parts.push(`\nBased on the available context, infer the most appropriate value for the "${argument.name}" argument.`);
        parts.push(`Provide the inferred value, a confidence score (0.0 to 1.0), and reasoning for your inference.`);

        return parts.join('\n');
    }

    /**
     * Infer multiple arguments in batch
     */
    public async inferArguments(
        promptArguments: PromptArgument[],
        promptName: string,
        context: PromptResolutionContext
    ): Promise<Map<string, ArgumentResolutionResult>> {
        const results = new Map<string, ArgumentResolutionResult>();

        for (const arg of promptArguments) {
            const result = await this.inferArgument(arg, promptName, context);
            if (result) {
                results.set(arg.name, result);
            }
        }

        return results;
    }
}
