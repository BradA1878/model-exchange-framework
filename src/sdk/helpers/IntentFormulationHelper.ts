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
 * IntentFormulationHelper.ts
 * 
 * Helps agents formulate better intents for tool discovery based on the task at hand
 */

import { Logger } from '../../shared/utils/Logger';

export class IntentFormulationHelper {
    private static logger = new Logger('info', 'IntentFormulationHelper', 'client');

    /**
     * Analyze user input and suggest a specific tool discovery intent
     */
    public static formulateToolDiscoveryIntent(userInput: string): string {
        // Convert to lowercase for pattern matching
        const input = userInput.toLowerCase();
        
        // Check for mathematical operations
        if (input.includes('sum') || input.includes('add')) {
            // Extract numbers if present
            const numbers = input.match(/\d+/g);
            if (numbers && numbers.length > 0) {
                return `add ${numbers.join(' and ')} together`;
            }
            return 'add numbers together';
        }
        
        if (input.includes('subtract') || input.includes('minus')) {
            const numbers = input.match(/\d+/g);
            if (numbers && numbers.length >= 2) {
                return `subtract ${numbers[1]} from ${numbers[0]}`;
            }
            return 'subtract one number from another';
        }
        
        if (input.includes('multiply') || input.includes('times')) {
            const numbers = input.match(/\d+/g);
            if (numbers && numbers.length >= 2) {
                return `multiply ${numbers[0]} by ${numbers[1]}`;
            }
            return 'multiply two numbers';
        }
        
        if (input.includes('divide')) {
            const numbers = input.match(/\d+/g);
            if (numbers && numbers.length >= 2) {
                return `divide ${numbers[0]} by ${numbers[1]}`;
            }
            return 'divide one number by another';
        }
        
        if (input.includes('square root') || input.includes('sqrt')) {
            const numbers = input.match(/\d+/g);
            if (numbers && numbers.length > 0) {
                return `find the square root of ${numbers[0]}`;
            }
            return 'calculate square root';
        }
        
        if (input.includes('average')) {
            return 'calculate the average of numbers';
        }
        
        // Communication patterns
        if (input.includes('send') && input.includes('message')) {
            return 'send a message to another agent';
        }
        
        if (input.includes('coordinate') && !input.includes('calculation')) {
            return 'coordinate with other agents';
        }
        
        // File operations
        if (input.includes('read') && input.includes('file')) {
            return 'read file contents';
        }
        
        if (input.includes('write') && input.includes('file')) {
            return 'write content to a file';
        }
        
        // Default: use the input as-is but clean it up
        return input.replace(/please|can you|i need to|help me/gi, '').trim();
    }

    /**
     * Extract the core action from a task description
     */
    public static extractCoreAction(taskDescription: string): string {
        // Remove common task prefixes
        let coreAction = taskDescription
            .replace(/^(process|handle|coordinate|manage|execute|perform|do)\s+/i, '')
            .replace(/\s+(task|request|operation|action)$/i, '');
        
        // If it's about calculations, focus on the math operation
        if (/calculation|mathematical|arithmetic/i.test(taskDescription)) {
            if (/sum|add/i.test(taskDescription)) return 'add numbers';
            if (/subtract|minus/i.test(taskDescription)) return 'subtract numbers';
            if (/multiply|times/i.test(taskDescription)) return 'multiply numbers';
            if (/divide/i.test(taskDescription)) return 'divide numbers';
        }
        
        return coreAction;
    }

    /**
     * Suggest multiple possible intents for a given input
     */
    public static suggestIntents(userInput: string): string[] {
        const suggestions: string[] = [];
        const input = userInput.toLowerCase();
        
        // Primary intent
        suggestions.push(this.formulateToolDiscoveryIntent(userInput));
        
        // Alternative formulations
        if (input.includes('sum')) {
            suggestions.push('perform addition');
            suggestions.push('calculate total');
        }
        
        if (input.includes('calculate')) {
            // Extract what needs to be calculated
            const match = input.match(/calculate\s+(?:the\s+)?(\w+)/);
            if (match) {
                suggestions.push(`perform ${match[1]}`);
            }
        }
        
        // Remove duplicates
        return [...new Set(suggestions)];
    }
}