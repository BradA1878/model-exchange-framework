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
 * Channel Context EventBus Handlers
 * Handles EventBus events for channel context LLM operations
 * 
 * Design: All events flow through EventBus, not direct socket connections
 */
import { lastValueFrom } from 'rxjs';
import { Logger } from '../../../shared/utils/Logger';
import { ChannelContextService } from '../../../shared/services/ChannelContextService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Events } from '../../../shared/events/EventNames';
import { EventBus } from '../../../shared/events/EventBus';
import { 
    BaseEventPayload,
    TopicsExtractEventData,
    TopicsExtractedEventData,
    TopicsExtractFailedEventData,
    SummaryGenerateEventData,
    SummaryGeneratedEventData,
    SummaryGenerateFailedEventData,
    createBaseEventPayload
} from '../../../shared/schemas/EventPayloadSchema';

const logger = new Logger('info', 'ChannelContextEventBusHandlers', 'server');
const validator = createStrictValidator('ChannelContextEventBusHandlers');

/**
 * Setup EventBus handlers for channel context operations
 * This replaces the socket-based handlers with proper EventBus architecture
 */
export const setupChannelContextEventBusHandlers = (): void => {

    // Handle topic extraction requests via EventBus
    EventBus.server.on(Events.Channel.CONTEXT.TOPICS_EXTRACT, async (payload: BaseEventPayload<TopicsExtractEventData>) => {
        try {
            const { channelId, operationId } = payload.data;
            
            // Validate input data
            validator.assertIsNonEmptyString(channelId, 'channelId');
            validator.assertIsNonEmptyString(operationId, 'operationId');
            
            // Get the channel context service instance
            const channelContextService = ChannelContextService.getInstance();
            
            // Extract topics from channel conversation
            const topicsObservable = channelContextService.extractConversationTopics(channelId);
            
            // Convert Observable to Promise using lastValueFrom
            const topics = await lastValueFrom(topicsObservable);
            
            // Create success event payload
            const successData: TopicsExtractedEventData = {
                channelId: channelId,
                operationId: operationId,
                topics: topics.map(topic => ({
                    id: topic.id,
                    topic: topic.topic,
                    keywords: topic.keywords,
                    relevance: topic.relevanceScore
                })),
                timestamp: Date.now()
            };
            
            const successPayload = createBaseEventPayload<TopicsExtractedEventData>(
                Events.Channel.CONTEXT.TOPICS_EXTRACTED,
                payload.agentId,
                channelId,
                successData,
                { source: 'channelContextEventBusHandlers' }
            );
            
            // Emit success event via EventBus
            EventBus.server.emit(Events.Channel.CONTEXT.TOPICS_EXTRACTED, successPayload);
            
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to extract topics: ${errorMessage}`);
            
            // Create failure event payload  
            const failureData: TopicsExtractFailedEventData = {
                channelId: payload.channelId,
                operationId: payload.data.operationId,
                error: errorMessage,
                timestamp: Date.now()
            };
            
            const failurePayload = createBaseEventPayload<TopicsExtractFailedEventData>(
                Events.Channel.CONTEXT.TOPICS_EXTRACT_FAILED,
                payload.agentId,
                payload.channelId,
                failureData,
                { source: 'channelContextEventBusHandlers' }
            );
            
            // Emit failure event via EventBus
            EventBus.server.emit(Events.Channel.CONTEXT.TOPICS_EXTRACT_FAILED, failurePayload);
        }
    });

    // Handle summary generation requests via EventBus
    EventBus.server.on(Events.Channel.CONTEXT.SUMMARY_GENERATE, async (payload: BaseEventPayload<SummaryGenerateEventData>) => {
        try {
            const { channelId, operationId, messageCount } = payload.data;
            
            // Validate input data
            validator.assertIsNonEmptyString(channelId, 'channelId');
            validator.assertIsNonEmptyString(operationId, 'operationId');
            
            // Get the channel context service instance
            const channelContextService = ChannelContextService.getInstance();
            
            // Generate summary from channel conversation
            const summaryObservable = channelContextService.generateConversationSummary(channelId, messageCount || 50);
            
            // Convert Observable to Promise using lastValueFrom
            const summary = await lastValueFrom(summaryObservable);
            
            // Create success event payload
            const successData: SummaryGeneratedEventData = {
                channelId: channelId,
                operationId: operationId,
                summary: summary,
                timestamp: Date.now()
            };
            
            const successPayload = createBaseEventPayload<SummaryGeneratedEventData>(
                Events.Channel.CONTEXT.SUMMARY_GENERATED,
                payload.agentId,
                channelId,
                successData,
                { source: 'channelContextEventBusHandlers' }
            );
            
            // Emit success event via EventBus
            EventBus.server.emit(Events.Channel.CONTEXT.SUMMARY_GENERATED, successPayload);
            
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to generate summary: ${errorMessage}`);
            
            // Create failure event payload
            const failureData: SummaryGenerateFailedEventData = {
                channelId: payload.channelId,
                operationId: payload.data.operationId,
                error: errorMessage,
                timestamp: Date.now()
            };
            
            const failurePayload = createBaseEventPayload<SummaryGenerateFailedEventData>(
                Events.Channel.CONTEXT.SUMMARY_GENERATE_FAILED,
                payload.agentId,
                payload.channelId,
                failureData,
                { source: 'channelContextEventBusHandlers' }
            );
            
            // Emit failure event via EventBus
            EventBus.server.emit(Events.Channel.CONTEXT.SUMMARY_GENERATE_FAILED, failurePayload);
        }
    });

};
