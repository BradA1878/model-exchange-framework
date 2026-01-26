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
 * Unit tests for PromptArgumentInferenceService
 */

import { PromptArgumentInferenceService } from '../../../src/shared/services/PromptArgumentInferenceService';
import {
    PromptArgument,
    PromptResolutionContext,
    ArgumentResolutionSource
} from '../../../src/shared/types/McpPromptTypes';

describe('PromptArgumentInferenceService', () => {
    let service: PromptArgumentInferenceService;
    let mockSystemLlmService: any;

    beforeEach(() => {
        service = PromptArgumentInferenceService.getInstance();

        // Mock SystemLLM service
        mockSystemLlmService = {
            analyzeWithStructuredOutput: jest.fn()
        };

        service.setSystemLlmService(mockSystemLlmService);
    });

    describe('inferArgument', () => {
        const testArg: PromptArgument = {
            name: 'language',
            description: 'Programming language',
            required: false
        };

        const testContext: PromptResolutionContext = {
            agentContext: {
                currentFile: 'test.ts'
            },
            taskContext: {
                operation: 'code_review'
            }
        };

        it('should infer argument value with high confidence', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput.mockResolvedValue({
                value: 'typescript',
                confidence: 0.95,
                reasoning: 'Inferred from file extension .ts'
            });

            const result = await service.inferArgument(testArg, 'code_review', testContext);

            expect(result).toBeDefined();
            expect(result?.value).toBe('typescript');
            expect(result?.source).toBe(ArgumentResolutionSource.SYSTEM_LLM);
            expect(result?.confidence).toBe(0.95);
        });

        it('should reject inference with low confidence', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput.mockResolvedValue({
                value: 'python',
                confidence: 0.5,
                reasoning: 'Uncertain inference'
            });

            const result = await service.inferArgument(testArg, 'code_review', testContext);

            expect(result).toBeNull();
        });

        it('should return null when SystemLLM service is not available', async () => {
            const serviceWithoutLlm = PromptArgumentInferenceService.getInstance();
            serviceWithoutLlm.setSystemLlmService(null as any);

            const result = await serviceWithoutLlm.inferArgument(testArg, 'code_review', testContext);

            expect(result).toBeNull();

            // Restore SystemLLM service
            serviceWithoutLlm.setSystemLlmService(mockSystemLlmService);
        });

        it('should handle inference errors gracefully', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput.mockRejectedValue(
                new Error('SystemLLM error')
            );

            const result = await service.inferArgument(testArg, 'code_review', testContext);

            expect(result).toBeNull();
        });

        it('should build proper inference prompt', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput.mockResolvedValue({
                value: 'typescript',
                confidence: 0.9,
                reasoning: 'Test'
            });

            await service.inferArgument(testArg, 'code_review', testContext);

            expect(mockSystemLlmService.analyzeWithStructuredOutput).toHaveBeenCalled();

            const callArgs = mockSystemLlmService.analyzeWithStructuredOutput.mock.calls[0];
            const prompt = callArgs[0];

            expect(prompt).toContain('code_review');
            expect(prompt).toContain('language');
            expect(prompt).toContain('Programming language');
        });
    });

    describe('inferArguments', () => {
        const testArgs: PromptArgument[] = [
            {
                name: 'language',
                description: 'Programming language',
                required: true
            },
            {
                name: 'style',
                description: 'Code style',
                required: false
            }
        ];

        const testContext: PromptResolutionContext = {
            agentContext: {
                currentFile: 'test.ts'
            }
        };

        it('should infer multiple arguments', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput
                .mockResolvedValueOnce({
                    value: 'typescript',
                    confidence: 0.95,
                    reasoning: 'From file extension'
                })
                .mockResolvedValueOnce({
                    value: 'strict',
                    confidence: 0.8,
                    reasoning: 'From project config'
                });

            const results = await service.inferArguments(testArgs, 'code_review', testContext);

            expect(results.size).toBe(2);
            expect(results.get('language')?.value).toBe('typescript');
            expect(results.get('style')?.value).toBe('strict');
        });

        it('should skip low-confidence inferences', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput
                .mockResolvedValueOnce({
                    value: 'typescript',
                    confidence: 0.95,
                    reasoning: 'High confidence'
                })
                .mockResolvedValueOnce({
                    value: 'unknown',
                    confidence: 0.3,
                    reasoning: 'Low confidence'
                });

            const results = await service.inferArguments(testArgs, 'code_review', testContext);

            expect(results.size).toBe(1);
            expect(results.has('language')).toBe(true);
            expect(results.has('style')).toBe(false);
        });

        it('should handle partial inference failures', async () => {
            mockSystemLlmService.analyzeWithStructuredOutput
                .mockResolvedValueOnce({
                    value: 'typescript',
                    confidence: 0.95,
                    reasoning: 'Success'
                })
                .mockRejectedValueOnce(new Error('Inference failed'));

            const results = await service.inferArguments(testArgs, 'code_review', testContext);

            expect(results.size).toBe(1);
            expect(results.has('language')).toBe(true);
        });
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance', () => {
            const instance1 = PromptArgumentInferenceService.getInstance();
            const instance2 = PromptArgumentInferenceService.getInstance();

            expect(instance1).toBe(instance2);
        });
    });
});
