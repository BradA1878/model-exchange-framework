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
 * Channel Context Provider
 * 
 * Provides channel-specific context and configuration for agent prompts.
 * This includes channel metadata, participants, memory summaries, and
 * channel-specific rules or behaviors.
 */

import { ChannelConfig } from '../interfaces/ChannelConfig';
import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';

const logger = new Logger('info', 'ChannelContextProvider', 'client');
const validator = createStrictValidator('ChannelContextProvider');

export interface ChannelContext {
    channelId: string;
    channelName: string;
    channelDescription?: string;
    participants?: string[];
    sharedMemory?: any;
    channelMetadata?: Record<string, any>;
    channelRules?: string[];
}

export class ChannelContextProvider {
    /**
     * Build channel context prompt section
     */
    public static buildChannelContext(
        channelConfig: ChannelConfig | null,
        channelContext?: ChannelContext
    ): string {
        if (!channelConfig && !channelContext) {
            return '';
        }

        const sections = [];

        // Channel Identity
        if (channelContext?.channelName || channelConfig?.name) {
            sections.push(`## Channel Context

**Channel Name**: ${channelContext?.channelName || channelConfig?.name}
**Channel ID**: ${channelContext?.channelId || 'Unknown'}`);
        }

        // Channel Description
        if (channelContext?.channelDescription || channelConfig?.description) {
            sections.push(`**Channel Purpose**: ${channelContext?.channelDescription || channelConfig?.description}`);
        }

        // Channel Configuration
        if (channelConfig) {
            const configDetails = [];
            if (channelConfig.isPrivate !== undefined) {
                configDetails.push(`- **Access**: ${channelConfig.isPrivate ? 'Private' : 'Public'}`);
            }
            if (channelConfig.requireApproval !== undefined) {
                configDetails.push(`- **Approval Required**: ${channelConfig.requireApproval ? 'Yes' : 'No'}`);
            }
            if (channelConfig.maxAgents) {
                configDetails.push(`- **Max Agents**: ${channelConfig.maxAgents}`);
            }
            if (channelConfig.allowAnonymous !== undefined) {
                configDetails.push(`- **Anonymous Access**: ${channelConfig.allowAnonymous ? 'Allowed' : 'Not Allowed'}`);
            }

            if (configDetails.length > 0) {
                sections.push(`**Channel Settings**:
${configDetails.join('\n')}`);
            }
        }

        // Channel Participants
        if (channelContext?.participants && channelContext.participants.length > 0) {
            sections.push(`**Active Participants**:
${channelContext.participants.map(p => `- ${p}`).join('\n')}`);
        }

        // Channel Rules
        if (channelContext?.channelRules && channelContext.channelRules.length > 0) {
            sections.push(`**Channel Rules**:
${channelContext.channelRules.map(rule => `- ${rule}`).join('\n')}`);
        }

        // Channel Metadata
        if (channelContext?.channelMetadata && Object.keys(channelContext.channelMetadata).length > 0) {
            const metadataEntries = Object.entries(channelContext.channelMetadata)
                .filter(([key, value]) => value !== null && value !== undefined)
                .map(([key, value]) => `- **${key}**: ${String(value)}`);
            
            if (metadataEntries.length > 0) {
                sections.push(`**Channel Metadata**:
${metadataEntries.join('\n')}`);
            }
        }

        // Channel-specific memory summary
        if (channelContext?.sharedMemory) {
            const memorySummary = this.summarizeSharedMemory(channelContext.sharedMemory);
            if (memorySummary) {
                sections.push(`**Channel Memory Summary**:
${memorySummary}`);
            }
        }

        return sections.filter(Boolean).join('\n\n');
    }

    /**
     * Summarize shared memory for prompt inclusion
     */
    private static summarizeSharedMemory(sharedMemory: any): string {
        const summaryParts = [];

        // Count memory types
        if (sharedMemory.notes && sharedMemory.notes.length > 0) {
            summaryParts.push(`- ${sharedMemory.notes.length} notes`);
        }
        if (sharedMemory.sharedState && Object.keys(sharedMemory.sharedState).length > 0) {
            summaryParts.push(`- ${Object.keys(sharedMemory.sharedState).length} shared state items`);
        }
        if (sharedMemory.conversationHistory && sharedMemory.conversationHistory.length > 0) {
            summaryParts.push(`- ${sharedMemory.conversationHistory.length} conversation entries`);
        }
        if (sharedMemory.customData && Object.keys(sharedMemory.customData).length > 0) {
            summaryParts.push(`- ${Object.keys(sharedMemory.customData).length} custom data items`);
        }

        return summaryParts.length > 0 ? summaryParts.join('\n') : '';
    }

    /**
     * Extract important notes from shared memory
     */
    public static extractImportantNotes(sharedMemory: any, limit: number = 3): string[] {
        if (!sharedMemory?.notes || sharedMemory.notes.length === 0) {
            return [];
        }

        // Sort by timestamp (most recent first) and take top N
        const sortedNotes = [...sharedMemory.notes]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);

        return sortedNotes.map(note => note.content);
    }

    /**
     * Build collaborative context for multi-agent scenarios
     */
    public static buildCollaborativeContext(
        agentId: string,
        otherAgents: string[],
        channelContext?: ChannelContext
    ): string {
        if (!otherAgents || otherAgents.length === 0) {
            return '';
        }

        const sections = [];

        sections.push(`## Collaborative Context

You are working alongside ${otherAgents.length} other agent(s) in this channel:`);

        sections.push(otherAgents.map(agent => `- ${agent}`).join('\n'));

        // Add collaboration guidelines
        sections.push(`
**Collaboration Guidelines**:
- Share relevant information through the channel's shared memory
- Coordinate actions to avoid conflicts
- Update shared state when making significant changes
- Respect other agents' ongoing tasks`);

        // Add any channel-specific collaboration rules
        if (channelContext?.channelRules) {
            const collabRules = channelContext.channelRules
                .filter(rule => rule.toLowerCase().includes('collab') || rule.toLowerCase().includes('coordinate'))
                .map(rule => `- ${rule}`);
            
            if (collabRules.length > 0) {
                sections.push(`**Channel-Specific Collaboration Rules**:
${collabRules.join('\n')}`);
            }
        }

        return sections.join('\n\n');
    }
}
