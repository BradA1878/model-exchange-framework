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
 * Prompt Template Replacer
 * 
 * Lightweight utility for replacing dynamic templates in system prompts.
 * Templates are replaced fresh on every LLM API request without modifying
 * the cached system prompt in conversation history.
 * 
 * Available Templates:
 * - {{DATE_TIME}}: Current date and time in human-readable format
 * - {{TIME_ZONE}}: Current timezone (IANA identifier)
 * - {{ISO_TIMESTAMP}}: Current ISO 8601 timestamp
 * - {{AGENT_ID}}: Agent ID (context-based)
 * - {{CHANNEL_ID}}: Channel ID (context-based)
 */

/**
 * Available prompt templates as constants
 * Export these for use in prompt builders
 */
export const PROMPT_TEMPLATES = {
    // Temporal templates
    DATE_TIME: '{{DATE_TIME}}',
    TIME_ZONE: '{{TIME_ZONE}}',
    ISO_TIMESTAMP: '{{ISO_TIMESTAMP}}',
    DAY_OF_WEEK: '{{DAY_OF_WEEK}}',
    CURRENT_YEAR: '{{CURRENT_YEAR}}',
    CURRENT_MONTH: '{{CURRENT_MONTH}}',
    CURRENT_DAY: '{{CURRENT_DAY}}',
    
    // Agent and channel context
    AGENT_ID: '{{AGENT_ID}}',
    CHANNEL_ID: '{{CHANNEL_ID}}',
    CHANNEL_NAME: '{{CHANNEL_NAME}}',
    
    // Collaboration context
    ACTIVE_AGENTS_COUNT: '{{ACTIVE_AGENTS_COUNT}}',
    ACTIVE_AGENTS_LIST: '{{ACTIVE_AGENTS_LIST}}',
    
    // LLM and system configuration
    LLM_PROVIDER: '{{LLM_PROVIDER}}',
    LLM_MODEL: '{{LLM_MODEL}}',
    SYSTEM_LLM_STATUS: '{{SYSTEM_LLM_STATUS}}',
    OS_PLATFORM: '{{OS_PLATFORM}}',
    
    // Control loop state
    CURRENT_ORPAR_PHASE: '{{CURRENT_ORPAR_PHASE}}',
    
    // Task status
    CURRENT_TASK_ID: '{{CURRENT_TASK_ID}}',
    CURRENT_TASK_TITLE: '{{CURRENT_TASK_TITLE}}',
    CURRENT_TASK_STATUS: '{{CURRENT_TASK_STATUS}}',
    CURRENT_TASK_PROGRESS: '{{CURRENT_TASK_PROGRESS}}'
} as const;

/**
 * Context values that can be provided for template replacement
 */
export interface TemplateContext {
    // Agent and channel identity
    agentId?: string;
    channelId?: string;
    channelName?: string;
    
    // Collaboration context
    activeAgentsCount?: number;
    activeAgentsList?: string[];
    
    // LLM configuration
    llmProvider?: string;
    llmModel?: string;
    
    // System status
    systemLlmEnabled?: boolean;
    
    // Control loop state
    currentOrparPhase?: 'Observe' | 'Reason' | 'Plan' | 'Act' | 'Reflect' | null;
    
    // Task status
    currentTaskId?: string;
    currentTaskTitle?: string;
    currentTaskStatus?: string;
    currentTaskProgress?: number;
    
    // Custom values
    customValues?: Record<string, string>;
}

/**
 * Lightweight utility for replacing dynamic templates in prompts
 */
export class PromptTemplateReplacer {
    /**
     * Replace all dynamic templates in prompt text
     * 
     * @param prompt - The prompt text containing templates
     * @param context - Optional context for replacing agent/channel templates
     * @returns Prompt with all templates replaced
     */
    public static replaceTemplates(prompt: string, context?: TemplateContext): string {
        if (!prompt) return prompt;
        
        let result = prompt;
        
        // Replace temporal templates (always fresh)
        result = this.replaceTemporalTemplates(result);
        
        // Replace context templates if provided
        if (context) {
            result = this.replaceContextTemplates(result, context);
        }
        
        return result;
    }
    
    /**
     * Replace temporal templates with current date/time values
     * These are always fresh on every call
     */
    private static replaceTemporalTemplates(prompt: string): string {
        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        // Build human-readable date/time format
        const formatter = new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
        
        const formattedDateTime = formatter.format(now);
        const isoTimestamp = now.toISOString();
        
        // Extract individual date components
        const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
        const currentYear = now.getFullYear().toString();
        const currentMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
        const currentDay = now.getDate().toString();
        
        // Get OS platform
        const osPlatform = this.getOSPlatform();
        
        return prompt
            .replace(/\{\{DATE_TIME\}\}/g, formattedDateTime)
            .replace(/\{\{TIME_ZONE\}\}/g, timezone)
            .replace(/\{\{ISO_TIMESTAMP\}\}/g, isoTimestamp)
            .replace(/\{\{DAY_OF_WEEK\}\}/g, dayOfWeek)
            .replace(/\{\{CURRENT_YEAR\}\}/g, currentYear)
            .replace(/\{\{CURRENT_MONTH\}\}/g, currentMonth)
            .replace(/\{\{CURRENT_DAY\}\}/g, currentDay)
            .replace(/\{\{OS_PLATFORM\}\}/g, osPlatform);
    }
    
    /**
     * Replace context-specific templates (agent ID, channel ID, custom values)
     */
    private static replaceContextTemplates(prompt: string, context: TemplateContext): string {
        let result = prompt;
        
        // Replace agent ID if provided
        if (context.agentId) {
            result = result.replace(/\{\{AGENT_ID\}\}/g, context.agentId);
        }
        
        // Replace channel ID if provided
        if (context.channelId) {
            result = result.replace(/\{\{CHANNEL_ID\}\}/g, context.channelId);
        }
        
        // Replace channel name if provided
        if (context.channelName) {
            result = result.replace(/\{\{CHANNEL_NAME\}\}/g, context.channelName);
        }
        
        // Replace active agents count if provided
        if (context.activeAgentsCount !== undefined) {
            result = result.replace(/\{\{ACTIVE_AGENTS_COUNT\}\}/g, context.activeAgentsCount.toString());
        }
        
        // Replace active agents list if provided
        if (context.activeAgentsList && context.activeAgentsList.length > 0) {
            const agentListStr = context.activeAgentsList.join(', ');
            result = result.replace(/\{\{ACTIVE_AGENTS_LIST\}\}/g, agentListStr);
        }
        
        // Replace LLM provider if provided
        if (context.llmProvider) {
            result = result.replace(/\{\{LLM_PROVIDER\}\}/g, context.llmProvider);
        }
        
        // Replace LLM model if provided
        if (context.llmModel) {
            result = result.replace(/\{\{LLM_MODEL\}\}/g, context.llmModel);
        }
        
        // Replace SystemLLM status if provided
        if (context.systemLlmEnabled !== undefined) {
            const statusStr = context.systemLlmEnabled ? 'Enabled' : 'Disabled';
            result = result.replace(/\{\{SYSTEM_LLM_STATUS\}\}/g, statusStr);
        }
        
        // Replace ORPAR phase if provided
        if (context.currentOrparPhase) {
            result = result.replace(/\{\{CURRENT_ORPAR_PHASE\}\}/g, context.currentOrparPhase);
        }
        
        // Replace task status if provided
        if (context.currentTaskId) {
            result = result.replace(/\{\{CURRENT_TASK_ID\}\}/g, context.currentTaskId);
        }
        if (context.currentTaskTitle) {
            result = result.replace(/\{\{CURRENT_TASK_TITLE\}\}/g, context.currentTaskTitle);
        }
        if (context.currentTaskStatus) {
            result = result.replace(/\{\{CURRENT_TASK_STATUS\}\}/g, context.currentTaskStatus);
        }
        if (context.currentTaskProgress !== undefined) {
            result = result.replace(/\{\{CURRENT_TASK_PROGRESS\}\}/g, `${context.currentTaskProgress}%`);
        }
        
        // Replace any custom values
        if (context.customValues) {
            for (const [key, value] of Object.entries(context.customValues)) {
                const template = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                result = result.replace(template, value);
            }
        }
        
        return result;
    }
    
    /**
     * Get OS platform information
     */
    private static getOSPlatform(): string {
        if (typeof process !== 'undefined' && process.platform) {
            const platformMap: Record<string, string> = {
                'darwin': 'macOS',
                'win32': 'Windows',
                'linux': 'Linux',
                'freebsd': 'FreeBSD',
                'openbsd': 'OpenBSD',
                'sunos': 'SunOS',
                'aix': 'AIX'
            };
            return platformMap[process.platform] || process.platform;
        }
        return 'Unknown';
    }
    
    /**
     * Get current temporal values (useful for logging/debugging)
     */
    public static getCurrentTemporalValues(): {
        dateTime: string;
        timezone: string;
        isoTimestamp: string;
        dayOfWeek: string;
        currentYear: string;
        currentMonth: string;
        currentDay: string;
    } {
        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        const formatter = new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
        
        const dayOfWeek = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
        const currentMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
        
        return {
            dateTime: formatter.format(now),
            timezone,
            isoTimestamp: now.toISOString(),
            dayOfWeek,
            currentYear: now.getFullYear().toString(),
            currentMonth,
            currentDay: now.getDate().toString()
        };
    }
}
