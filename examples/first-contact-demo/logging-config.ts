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
 */

/**
 * Test-specific logging configuration to reduce noise and highlight conversations
 */

export const testLoggingConfig = {
    // Reduce debug noise from these categories (temporarily showing OpenRouter debug for troubleshooting)
    quietCategories: [
        'ensureConnected',
        'memory:update',
        'EventForwardingHandlers',
        'Socket connection',
        'Tool registration',
        'Saving memory for agent',
        'Received event type.*evaluating for response'
    ],
    
    // Highlight these important conversation messages
    highlightCategories: [
        'Received direct agent message',
        'Received message from',
        'SYNC EXEC: messaging_send',
        'SYNC EXEC: task_complete',
        'Task execution completed',
        'test completed successfully'
    ],
    
    // Show tool execution but reduce verbosity
    toolExecution: {
        showToolCalls: true,
        showToolResults: false,
        showToolErrors: true
    }
};

/**
 * Filter log output to reduce noise for test environments
 */
export const filterTestLogs = (logLine: string): boolean => {
    // Skip debug lines that contain noise patterns
    const noisePatterns = [
        /\[DEBUG\].*ensureConnected/,
        /\[DEBUG\].*evaluating for response/,
        /\[DEBUG\].*EventForwardingHandlers/,
        /\[INFO\].*MCP client initialized/,
        /\[INFO\].*Saving memory for agent/,
        /\[DEBUG\].*Received event type memory:update/,
        /\[DEBUG\].*memory:update:result/,
        /\[INFO\].*Tool registration/,
        /\[DEBUG\].*Socket connection/,
        /\[DEBUG\].*ensureConnected/
    ];
    
    return !noisePatterns.some(pattern => pattern.test(logLine));
};

/**
 * Highlight important conversation messages
 */
export const highlightConversationLogs = (logLine: string): string => {
    // Highlight agent messages
    if (logLine.includes('🔗 Received direct agent message')) {
        return `🎯 ${logLine}`;
    }
    
    // Highlight channel messages
    if (logLine.includes('📨 Received message from')) {
        return `💬 ${logLine}`;
    }
    
    // Highlight tool calls
    if (logLine.includes('🔧 SYNC EXEC: messaging_send')) {
        return `📤 ${logLine}`;
    }
    
    // Highlight task completion
    if (logLine.includes('🔧 SYNC EXEC: task_complete')) {
        return `✅ ${logLine}`;
    }
    
    // Highlight test completion
    if (logLine.includes('test completed successfully')) {
        return `🎉 ${logLine}`;
    }
    
    return logLine;
};
