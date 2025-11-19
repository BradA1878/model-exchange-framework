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
 * JSON Recovery Utility
 * 
 * Advanced JSON parsing with recovery strategies for truncated or malformed responses.
 * Extracted from OpenRouterMcpClient for reuse across providers.
 */

import { Logger } from '../../../utils/Logger';

/**
 * Result of JSON parsing attempt
 */
export interface JsonParseResult<T> {
    success: boolean;
    data?: T;
    error?: Error;
    recoveryUsed?: string;
}

/**
 * JSON Recovery Manager
 * Handles parsing with sophisticated recovery strategies
 */
export class JsonRecoveryManager {
    private logger: Logger;
    
    constructor(loggerContext: string) {
        this.logger = new Logger('debug', loggerContext, 'client');
    }
    
    /**
     * Parse JSON with recovery strategies for truncated responses
     * 
     * @param jsonText - JSON text to parse
     * @returns Parse result with data or error
     */
    parseWithRecovery<T = any>(jsonText: string): JsonParseResult<T> {
        // Try standard parse first
        try {
            const data = JSON.parse(jsonText);
            return { success: true, data };
        } catch (parseError) {
            this.logger.error(`JSON parse error: ${parseError}`);
            this.logger.error(`Response length: ${jsonText.length}`);
            this.logger.error(`First 200 chars: ${JSON.stringify(jsonText.substring(0, 200))}`);
            this.logger.error(`Last 200 chars: ${JSON.stringify(jsonText.substring(Math.max(0, jsonText.length - 200)))}`);
            
            // Analyze the JSON structure
            const analysis = this.analyzeJson(jsonText);
            
            this.logger.error(`Bracket analysis - { ${analysis.openBraces} } { ${analysis.closeBraces} } [ ${analysis.openBrackets} ] [ ${analysis.closeBrackets} ]`);
            this.logger.error(`Last valid JSON ends at index: ${analysis.lastValidIndex}`);
            
            // Check if truncated
            if (analysis.isTruncated) {
                this.logger.error('Response appears to be truncated, attempting recovery...');
                
                // Try recovery strategies
                const recoveryResult = this.attemptRecovery<T>(jsonText, analysis);
                if (recoveryResult.success) {
                    this.logger.warn(`Successfully recovered using strategy: ${recoveryResult.recoveryUsed}`);
                    return recoveryResult;
                }
                
                return {
                    success: false,
                    error: new Error(`Response is truncated and cannot be recovered: ${parseError}`)
                };
            }
            
            // Not truncated, just invalid
            return {
                success: false,
                error: new Error(`Failed to parse JSON: ${parseError}`)
            };
        }
    }
    
    /**
     * Analyze JSON structure for truncation and errors
     * 
     * @param jsonText - JSON text to analyze
     * @returns Analysis result
     */
    private analyzeJson(jsonText: string): {
        openBraces: number;
        closeBraces: number;
        openBrackets: number;
        closeBrackets: number;
        lastValidIndex: number;
        isTruncated: boolean;
        hasUnclosedString: boolean;
    } {
        let openBraces = 0;
        let closeBraces = 0;
        let openBrackets = 0;
        let closeBrackets = 0;
        let inString = false;
        let escapeNext = false;
        let lastValidIndex = -1;
        
        // Analyze character by character
        for (let i = 0; i < jsonText.length; i++) {
            const char = jsonText[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') {
                    openBraces++;
                } else if (char === '}') {
                    closeBraces++;
                    // Check if we have a balanced JSON object
                    if (openBraces === closeBraces && openBrackets === closeBrackets) {
                        lastValidIndex = i;
                    }
                } else if (char === '[') {
                    openBrackets++;
                } else if (char === ']') {
                    closeBrackets++;
                }
            }
        }
        
        // Detect truncation
        const isUnbalanced = openBraces !== closeBraces || openBrackets !== closeBrackets;
        const endsIncomplete = /[,:]\s*$/.test(jsonText.trim());
        const hasIncompleteField = /"\w+":\s*$/.test(jsonText.trim());
        const hasPartialToolsArray = jsonText.includes('"tools"') && 
            jsonText.includes('"function"') && 
            isUnbalanced;
        
        const isTruncated = isUnbalanced || endsIncomplete || hasIncompleteField || 
            inString || hasPartialToolsArray;
        
        return {
            openBraces,
            closeBraces,
            openBrackets,
            closeBrackets,
            lastValidIndex,
            isTruncated,
            hasUnclosedString: inString
        };
    }
    
    /**
     * Attempt recovery using various strategies
     * 
     * @param jsonText - Truncated JSON text
     * @param analysis - JSON analysis result
     * @returns Recovery result
     */
    private attemptRecovery<T>(
        jsonText: string,
        analysis: ReturnType<typeof this.analyzeJson>
    ): JsonParseResult<T> {
        const strategies: Array<{ name: string; json: string }> = [];
        
        // Strategy 1: Use last valid JSON index
        if (analysis.lastValidIndex > 0 && analysis.lastValidIndex < jsonText.length - 5) {
            strategies.push({
                name: 'last_valid_index',
                json: jsonText.substring(0, analysis.lastValidIndex + 1)
            });
        }
        
        // Strategy 2: Find last complete object before truncation
        const lastCompleteMatch = jsonText.match(/^.*}(?=\s*[,\]}])/s);
        if (lastCompleteMatch) {
            strategies.push({
                name: 'last_complete_object',
                json: lastCompleteMatch[0]
            });
        }
        
        // Strategy 3: Remove trailing incomplete content
        const withoutTrailing = jsonText.replace(/,?\s*"\w*"?:?\s*["\[{]?[^}\]"]*$/s, '');
        if (withoutTrailing !== jsonText && withoutTrailing.length > 100) {
            strategies.push({
                name: 'remove_trailing',
                json: withoutTrailing
            });
        }
        
        // Strategy 4: Close unclosed brackets/braces
        if (analysis.openBraces > analysis.closeBraces || analysis.openBrackets > analysis.closeBrackets) {
            let closingChars = '';
            const bracesToClose = analysis.openBraces - analysis.closeBraces;
            const bracketsToClose = analysis.openBrackets - analysis.closeBrackets;
            
            for (let i = 0; i < bracketsToClose; i++) {
                closingChars += ']';
            }
            for (let i = 0; i < bracesToClose; i++) {
                closingChars += '}';
            }
            
            strategies.push({
                name: 'close_brackets',
                json: jsonText + closingChars
            });
        }
        
        // Try each strategy
        for (const strategy of strategies) {
            this.logger.error(`Attempting recovery strategy: ${strategy.name} (${strategy.json.length} chars)`);
            try {
                const data = JSON.parse(strategy.json);
                return {
                    success: true,
                    data,
                    recoveryUsed: strategy.name
                };
            } catch (recoveryError) {
                this.logger.error(`Recovery strategy ${strategy.name} failed: ${recoveryError}`);
            }
        }
        
        // All strategies failed
        return {
            success: false,
            error: new Error(`All ${strategies.length} recovery strategies failed`)
        };
    }
}

/**
 * Convenience function to parse JSON with recovery
 * 
 * @param jsonText - JSON text to parse
 * @param loggerContext - Logger context name
 * @returns Parsed data or throws error
 */
export const parseJsonWithRecovery = <T = any>(
    jsonText: string,
    loggerContext: string = 'JsonRecovery'
): T => {
    const manager = new JsonRecoveryManager(loggerContext);
    const result = manager.parseWithRecovery<T>(jsonText);
    
    if (!result.success) {
        throw result.error || new Error('JSON parsing failed');
    }
    
    return result.data!;
};
