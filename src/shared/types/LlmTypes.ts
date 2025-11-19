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
 * LLM Types
 * 
 * Shared types and interfaces for LLM operations across the MXF framework.
 * These types are used by both client-side and server-side LLM services.
 */

/**
 * Generic structure for prompt inputs
 */
export interface PromptInput {
    prompt: string;
    systemPrompt?: string;
    options?: {
        temperature?: number;
        maxTokens?: number;
        model?: string;
        [key: string]: any;
    };
}

/**
 * Topics extraction request
 */
export interface TopicsExtractionInput {
    messages: Array<{
        content: string;
        messageId: string;
        timestamp: number;
    }>;
    minRelevance?: number;
    options?: {
        temperature?: number;
        maxTokens?: number;
        model?: string;
        [key: string]: any;
    };
}

/**
 * Topics extraction result
 */
export interface TopicExtractionResult {
    topics: Array<{
        topic: string;
        keywords: string[];
        relevanceScore: number;
        messageReferences: string[];
        firstMentioned: number;
        lastMentioned: number;
    }>;
}

/**
 * Conversation summary input
 */
export interface ConversationSummaryInput {
    messages: Array<{
        content: string;
        messageId: string;
        senderId: string;
        timestamp: number;
    }>;
    channelName?: string;
    channelDescription?: string;
    options?: {
        temperature?: number;
        maxTokens?: number;
        model?: string;
        [key: string]: any;
    };
}

/**
 * Conversation summary result
 */
export interface ConversationSummaryResult {
    summary: string;
    keyPoints: string[];
    sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
    participantCount: number;
    messageCount: number;
    topics?: string[];
}

/**
 * Reasoning analysis input
 */
export interface ReasoningAnalysisInput {
    context: string;
    observations: string[];
    previousActions: string[];
    options?: {
        temperature?: number;
        maxTokens?: number;
        model?: string;
        [key: string]: any;
    };
}

/**
 * Reasoning analysis result
 */
export interface ReasoningAnalysisResult {
    analysis: string;
    confidence: number;
    suggestedActions: string[];
    reasoning: string;
}

/**
 * LLM operation options
 */
export interface LlmOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    responseFormat?: 'text' | 'json';
    [key: string]: any;
}

/**
 * Structured LLM operation result with metadata
 */
export interface LlmOperationResult<T = any> {
    data: T;
    metadata: {
        model: string;
        tokensUsed?: number;
        processingTime: number;
        timestamp: number;
    };
}
