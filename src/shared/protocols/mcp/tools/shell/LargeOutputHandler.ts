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
 * LargeOutputHandler — processes shell command outputs, persisting large
 * outputs to MongoDB and returning truncated previews for tool responses.
 * Small outputs are returned inline without persistence.
 */

import crypto from 'crypto';

import { ShellOutput } from '../../../../models/shellOutput';
import { AgentId, ChannelId } from '../../../../types/ChannelContext';
import { Logger } from '../../../../utils/Logger';

const logger = new Logger('info', 'LargeOutputHandler', 'server');

/**
 * Configuration for large output handling thresholds and behavior.
 */
export interface LargeOutputConfig {
    /** Number of lines to include in preview when truncating. Default: 200 */
    previewLines: number;
    /** Maximum output size in bytes to return inline. Default: 512KB */
    maxInlineSize: number;
    /** Maximum output size to persist to database. Default: 64MB */
    maxPersistSize: number;
}

/**
 * Default configuration values for the large output handler.
 */
export const DEFAULT_LARGE_OUTPUT_CONFIG: LargeOutputConfig = {
    previewLines: 200,
    maxInlineSize: 512 * 1024,        // 512KB
    maxPersistSize: 64 * 1024 * 1024  // 64MB
};

/**
 * Result of processing command output through the large output handler.
 */
export interface ProcessedOutput {
    /** Content to return in the tool response (may be truncated preview) */
    inline: string;
    /** Whether the output was truncated */
    isTruncated: boolean;
    /** Total size of the original output in bytes */
    totalBytes: number;
    /** Total number of lines in the original output */
    totalLines: number;
    /** MongoDB document ID if the full output was persisted (set when truncated) */
    persistedOutputId?: string;
}

/**
 * Process command output, persisting large outputs to MongoDB and returning
 * a truncated preview for the tool response.
 *
 * If output <= maxInlineSize: returns full output inline, no persistence.
 * If output > maxInlineSize: persists to MongoDB, returns first previewLines as preview
 *   with a note about where to find the full output.
 * If output > maxPersistSize: truncates to maxPersistSize before persisting.
 */
export async function processOutput(
    output: string,
    context: { agentId: AgentId; channelId: ChannelId; commandHash: string },
    config?: Partial<LargeOutputConfig>
): Promise<ProcessedOutput> {
    const mergedConfig: LargeOutputConfig = {
        ...DEFAULT_LARGE_OUTPUT_CONFIG,
        ...config
    };

    const totalBytes = Buffer.byteLength(output, 'utf-8');
    const lines = output.split('\n');
    const totalLines = lines.length;

    // Small output: return inline without persistence
    if (totalBytes <= mergedConfig.maxInlineSize) {
        return {
            inline: output,
            isTruncated: false,
            totalBytes,
            totalLines
        };
    }

    // Large output: persist to MongoDB and return a truncated preview
    const outputId = crypto.randomUUID();

    // Truncate content to maxPersistSize if it exceeds the limit
    let contentToPersist = output;
    if (totalBytes > mergedConfig.maxPersistSize) {
        logger.warn(`Output exceeds max persist size (${totalBytes} bytes > ${mergedConfig.maxPersistSize} bytes), truncating before persistence`);
        // Truncate by slicing the string to approximate maxPersistSize in bytes.
        // We slice conservatively and then verify byte length.
        let sliceEnd = mergedConfig.maxPersistSize;
        if (sliceEnd < output.length) {
            contentToPersist = output.slice(0, sliceEnd);
            // Adjust down if we overshot due to multi-byte characters
            while (Buffer.byteLength(contentToPersist, 'utf-8') > mergedConfig.maxPersistSize && sliceEnd > 0) {
                sliceEnd -= 1024;
                contentToPersist = output.slice(0, sliceEnd);
            }
        }
    }

    try {
        await ShellOutput.create({
            outputId,
            content: contentToPersist,
            commandHash: context.commandHash,
            agentId: context.agentId,
            channelId: context.channelId,
            totalBytes,
            totalLines
        });

        logger.info(`Persisted large output (${totalBytes} bytes, ${totalLines} lines) with ID: ${outputId}`);
    } catch (error) {
        // Degraded mode: return output truncated to maxInlineSize
        logger.error(`Failed to persist large output to MongoDB: ${error instanceof Error ? error.message : String(error)}`);
        const fallbackContent = output.slice(0, mergedConfig.maxInlineSize);
        return {
            inline: fallbackContent,
            isTruncated: true,
            totalBytes,
            totalLines
        };
    }

    // Build preview from the first N lines
    const previewLines = lines.slice(0, mergedConfig.previewLines).join('\n');
    const preview = `${previewLines}\n\n--- Output truncated (${totalBytes} bytes, ${totalLines} lines) ---\n--- Full output persisted with ID: ${outputId} ---\n--- Use shell_output_retrieve to get the full output ---`;

    return {
        inline: preview,
        isTruncated: true,
        totalBytes,
        totalLines,
        persistedOutputId: outputId
    };
}

/**
 * Retrieve persisted output by its ID.
 * Returns null if the output has expired (24h TTL) or was not found.
 */
export async function retrievePersistedOutput(outputId: string): Promise<string | null> {
    const doc = await ShellOutput.findOne({ outputId });
    return doc?.content ?? null;
}
