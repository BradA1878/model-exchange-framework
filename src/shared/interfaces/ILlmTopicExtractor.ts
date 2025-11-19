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
 * Interface for LLM services that can extract conversation topics and generate summaries
 * 
 * This interface defines the contract for LLM-based topic extraction and conversation
 * summarization. SystemLlmService implements this functionality directly.
 */

import { Observable } from 'rxjs';
import { ChannelMessage, ConversationTopic } from '../types/ChannelContext';

/**
 * Options for topic extraction
 */
export interface ITopicExtractionOptions {
    minRelevance?: number;
    temperature?: number;
    maxTokens?: number;
    model?: string;
}

/**
 * Options for conversation summarization
 */
export interface IConversationSummaryOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
    includeContext?: boolean;
}

/**
 * Interface for LLM services that can extract conversation topics and generate summaries
 */
export interface ILlmTopicExtractor {
    /**
     * Extract topics from channel messages
     * @param messages - Array of channel messages
     * @param options - Optional configuration
     * @returns Observable of conversation topics
     */
    extractTopics(
        messages: ChannelMessage[],
        options?: ITopicExtractionOptions
    ): Observable<ConversationTopic[]>;

    /**
     * Generate conversation summary from channel messages
     * @param messages - Array of channel messages
     * @param options - Optional configuration
     * @returns Observable of summary string
     */
    generateConversationSummary(
        messages: ChannelMessage[],
        options?: IConversationSummaryOptions
    ): Observable<string>;
}
