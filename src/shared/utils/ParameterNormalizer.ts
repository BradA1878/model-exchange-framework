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
 * Shared Parameter Normalizer for ORPAR Tools
 *
 * This utility normalizes LLM parameter outputs to match expected schema formats.
 * LLMs (especially faster models like Haiku) often output parameters with:
 * - Wrong names (reasoning vs analysis)
 * - Wrong types (string vs array)
 * - Extra fields not in schema
 *
 * This normalizer handles all these cases to improve tool execution reliability.
 */

import { Logger } from './Logger';

const logger = new Logger('debug', 'ParameterNormalizer', 'server');

/**
 * Maximum number of items that can be collected into an array via _collectToArray
 * Prevents unbounded memory growth from malicious or malformed LLM output
 */
export const MAX_COLLECTED_ITEMS = 50;

/**
 * Maximum number of properties to process from input
 * Prevents DoS from extremely large objects
 */
export const MAX_INPUT_PROPERTIES = 100;

/**
 * Parameter name mappings for common LLM variations on ORPAR tools
 * Maps incorrect/alternative names to the correct schema property names
 *
 * Special directives:
 * - '_remove': Delete this property (not a valid schema field)
 * - '_extractFirst:fieldName': Extract first element from array to target field
 * - '_collectToArray:fieldName': Collect numbered properties into target array
 * - '_stringToArray:fieldName': Convert string value to single-element array
 */
export const ORPAR_PARAMETER_MAPPINGS: Record<string, Record<string, string>> = {
    orpar_observe: {
        'observation': 'observations',      // Singular vs plural
        'facts': 'keyFacts',
        'key_facts': 'keyFacts',
        // Handle numbered keyFact properties - LLMs output keyFact1, keyFact2 instead of array
        'keyFact1': '_collectToArray:keyFacts',
        'keyFact2': '_collectToArray:keyFacts',
        'keyFact3': '_collectToArray:keyFacts',
        'keyFact4': '_collectToArray:keyFacts',
        'keyFact5': '_collectToArray:keyFacts',
        'keyFact6': '_collectToArray:keyFacts',
        'keyFact7': '_collectToArray:keyFacts',
        'keyFact8': '_collectToArray:keyFacts',
        'keyFact9': '_collectToArray:keyFacts',
        'keyFact10': '_collectToArray:keyFacts',
        'confidence': '_remove',            // Not a valid field
    },
    orpar_reason: {
        'reasoning': 'analysis',           // Common LLM mistake
        'thinking': 'analysis',
        'thought': 'analysis',
        'patterns': 'conclusions',
        'hypothesis': 'conclusions',
        'keyFindings': '_stringToArray:conclusions',  // Map findings to conclusions
        'nextStep': 'alternatives',
        'nextAction': '_remove',           // Not a valid field - remove it
        'nextSteps': '_remove',            // Not valid in reason phase
        'strategy': '_remove',             // Not valid in reason phase
    },
    orpar_plan: {
        'strategy': 'plan',                 // Common synonym
        'approach': 'plan',
        'planning': 'plan',                 // Semantic confusion
        'nextSteps': 'actions',             // Common LLM mistake
        'steps': 'actions',
        'questionSequence': 'actions',
        'nextActions': 'actions',
        'planDescription': '_remove',       // Not valid - remove
        'immediateNextStep': '_remove',     // Not valid - remove
        'confidence': '_remove',            // Not a valid field
        'keyDecisions': '_remove',          // Not valid - remove
        'readinessCheck': '_remove',        // Not valid - remove
        'description': '_remove',           // Not valid - plan already has description
    },
    orpar_act: {
        'toolsUsed': 'toolUsed',            // Plural vs singular
        'tool': 'toolUsed',
        'executionDetails': 'outcome',
        'result': 'outcome',
        'expectedOutcome': 'outcome',
        'rationale': 'outcome',
        'actions': '_extractFirst:action',  // Array → first element string
        'confidence': '_remove',            // Not a valid field
    },
    orpar_reflect: {
        'reflections': 'reflection',        // Plural vs singular
        'insights': 'learnings',
        'lessons': 'learnings',
        'key_learnings': 'learnings',
        'lessonsLearned': 'learnings',      // Common LLM variation
        'whatLearned': '_stringToArray:learnings',  // String to array conversion
        'keyInsights': '_stringToArray:learnings',  // Map insights to learnings array
        'readinessForNextPhase': '_remove', // Not valid - remove
        'nextSteps': 'adjustments',         // Map to correct field
        'confidence': '_remove',            // Not a valid field
        'deductions': '_remove',            // Not valid - remove
        'readiness': '_remove',             // Not valid - remove
    }
};

/**
 * Allowed properties for each ORPAR tool (from schema definitions)
 * Unknown properties will be stripped to prevent additionalProperties errors
 */
export const ORPAR_ALLOWED_PROPERTIES: Record<string, string[]> = {
    orpar_observe: ['observations', 'keyFacts', 'context'],
    orpar_reason: ['analysis', 'conclusions', 'confidence', 'alternatives'],
    orpar_plan: ['plan', 'actions', 'rationale', 'contingency'],
    orpar_act: ['action', 'toolUsed', 'outcome', 'success'],
    orpar_reflect: ['reflection', 'learnings', 'expectationsMet', 'adjustments'],
};

/**
 * Coerce string arrays to actual arrays
 * Handles cases where LLMs pass arrays as strings
 */
export function coerceToArray(value: any): string[] | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        // Try to parse as JSON array
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {
                // Not valid JSON, try other formats
            }
        }
        // Handle XML-style items: <item>text</item>
        const xmlMatches = trimmed.match(/<item>(.*?)<\/item>/g);
        if (xmlMatches) {
            return xmlMatches.map(m => m.replace(/<\/?item>/g, '').trim());
        }
        // Handle newline-separated items
        if (trimmed.includes('\n') || trimmed.includes('<item>')) {
            const lines = trimmed
                .split(/\n|<item>|<\/item>/)
                .map(l => l.trim())
                .filter(l => l.length > 0 && !l.startsWith('<'));
            if (lines.length > 0) {
                return lines;
            }
        }
        // Single string - return as single-element array
        if (trimmed.length > 0) {
            return [trimmed];
        }
    }
    return undefined;
}

/**
 * Coerce input fields that should be arrays
 */
export function coerceArrayFields<T extends Record<string, any>>(input: T, arrayFields: string[]): T {
    const coerced = { ...input };
    for (const field of arrayFields) {
        if (field in coerced) {
            const coercedValue = coerceToArray(coerced[field]);
            if (coercedValue !== undefined) {
                (coerced as any)[field] = coercedValue;
            } else {
                delete (coerced as any)[field];
            }
        }
    }
    return coerced;
}

/**
 * Normalize parameter names for a specific tool
 * Maps common LLM parameter variations to the correct schema names
 *
 * Handles special directives:
 * - '_remove': Delete this property (not a valid schema field)
 * - '_extractFirst:fieldName': Extract first element from array to target field
 * - '_collectToArray:fieldName': Collect numbered properties into target array
 * - '_stringToArray:fieldName': Convert string value to single-element array
 *
 * @param toolName - The name of the tool being processed
 * @param input - The input parameters from LLM (may be null, undefined, or malformed)
 * @returns Normalized parameters object, or empty object if input is invalid
 */
export function normalizeOrparParameters(toolName: string, input: Record<string, any>): Record<string, any> {
    // CRITICAL: Validate input before processing untrusted LLM output
    // Input could be null, undefined, or not an object
    if (input === null || input === undefined) {
        logger.debug(`[ParameterNormalizer] Input is ${input} for ${toolName}, returning empty object`);
        return {};
    }

    if (typeof input !== 'object' || Array.isArray(input)) {
        logger.debug(`[ParameterNormalizer] Input is not an object for ${toolName} (type: ${typeof input}), returning empty object`);
        return {};
    }

    // Limit number of properties to prevent DoS
    const inputKeys = Object.keys(input);
    if (inputKeys.length > MAX_INPUT_PROPERTIES) {
        logger.warn(`[ParameterNormalizer] Input has ${inputKeys.length} properties (max: ${MAX_INPUT_PROPERTIES}), truncating`);
    }

    const mappings = ORPAR_PARAMETER_MAPPINGS[toolName];
    if (!mappings) return input;

    const normalized = { ...input };
    const collectArrays: Record<string, any[]> = {};  // For _collectToArray

    for (const [wrongName, directive] of Object.entries(mappings)) {
        if (!(wrongName in normalized)) continue;

        if (directive === '_remove') {
            // Remove invalid property that doesn't map to any schema field
            delete normalized[wrongName];
            logger.debug(`[ParameterNormalizer] Removed invalid param from ${toolName}: ${wrongName}`);
        } else if (directive.startsWith('_collectToArray:')) {
            // Collect numbered properties into target array (e.g., keyFact1, keyFact2 -> keyFacts[])
            const targetField = directive.split(':')[1];
            if (!collectArrays[targetField]) {
                collectArrays[targetField] = [];
            }

            // Enforce MAX_COLLECTED_ITEMS limit to prevent unbounded memory growth
            if (collectArrays[targetField].length >= MAX_COLLECTED_ITEMS) {
                logger.warn(`[ParameterNormalizer] Skipping ${wrongName} - ${targetField} array reached max size (${MAX_COLLECTED_ITEMS})`);
                delete normalized[wrongName];
                continue;
            }

            const value = normalized[wrongName];
            // Clean up any XML-like syntax that may have bled through
            const cleanValue = typeof value === 'string'
                ? value.replace(/<[^>]*>/g, '').trim()
                : value;
            if (cleanValue) {
                collectArrays[targetField].push(cleanValue);
            }
            delete normalized[wrongName];
        } else if (directive.startsWith('_stringToArray:')) {
            // Convert string to single-element array (e.g., whatLearned: "X" -> learnings: ["X"])
            const targetField = directive.split(':')[1];
            const value = normalized[wrongName];
            if (typeof value === 'string' && value.trim()) {
                if (!normalized[targetField]) {
                    normalized[targetField] = [value];
                } else if (Array.isArray(normalized[targetField])) {
                    normalized[targetField].push(value);
                }
            }
            delete normalized[wrongName];
        } else if (directive.startsWith('_extractFirst:')) {
            // Extract first element from array to target field
            const targetField = directive.split(':')[1];
            const value = normalized[wrongName];

            if (Array.isArray(value) && value.length > 0) {
                // If first element is object with target key, use that value
                const first = value[0];
                normalized[targetField] = typeof first === 'object' && first[targetField]
                    ? first[targetField]
                    : typeof first === 'object' && first.action
                        ? first.action
                        : String(first);
            } else if (typeof value === 'string') {
                // Try to parse JSON string array
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const first = parsed[0];
                        normalized[targetField] = typeof first === 'object' && first[targetField]
                            ? first[targetField]
                            : typeof first === 'object' && first.action
                                ? first.action
                                : String(first);
                    }
                } catch {
                    // Not valid JSON - use as-is if target doesn't exist
                    if (!(targetField in normalized)) {
                        normalized[targetField] = value;
                    }
                }
            }
            delete normalized[wrongName];
        } else if (!(directive in normalized)) {
            // Standard mapping - move value to correct name
            normalized[directive] = normalized[wrongName];
            delete normalized[wrongName];
            logger.debug(`[ParameterNormalizer] Mapped ${wrongName} → ${directive} for ${toolName}`);
        } else {
            // Both exist - just remove the wrong one to avoid additionalProperties error
            delete normalized[wrongName];
        }
    }

    // Merge collected arrays into normalized object with size limits
    for (const [field, values] of Object.entries(collectArrays)) {
        if (values.length > 0) {
            if (normalized[field] && Array.isArray(normalized[field])) {
                // Append to existing array, respecting MAX_COLLECTED_ITEMS
                const combined = [...normalized[field], ...values];
                normalized[field] = combined.slice(0, MAX_COLLECTED_ITEMS);
                if (combined.length > MAX_COLLECTED_ITEMS) {
                    logger.warn(`[ParameterNormalizer] Truncated ${field} array to ${MAX_COLLECTED_ITEMS} items`);
                }
            } else {
                // Create new array, respecting MAX_COLLECTED_ITEMS
                normalized[field] = values.slice(0, MAX_COLLECTED_ITEMS);
            }
        }
    }

    // Handle confidence field coercion (LLMs often send strings like "100%" or "high")
    if ('confidence' in normalized && typeof normalized['confidence'] === 'string') {
        const confStr = normalized['confidence'];
        // Try to extract a number from the string
        const percentMatch = confStr.match(/(\d+(?:\.\d+)?)\s*%/);
        const decimalMatch = confStr.match(/^(\d+(?:\.\d+)?)/);

        if (percentMatch) {
            // Convert percentage to 0-1 scale
            normalized['confidence'] = Math.min(1, parseFloat(percentMatch[1]) / 100);
        } else if (decimalMatch) {
            const val = parseFloat(decimalMatch[1]);
            // If value > 1, assume it's a percentage
            normalized['confidence'] = val > 1 ? Math.min(1, val / 100) : val;
        } else {
            // Can't parse - remove the invalid confidence value
            delete normalized['confidence'];
        }
    }

    return normalized;
}

/**
 * Strip unknown parameters that are not in the tool's schema
 * Prevents additionalProperties validation errors from LLM hallucinations
 *
 * @param toolName - The name of the tool being processed
 * @param input - The input parameters (may be null, undefined, or malformed)
 * @param allowedProperties - Optional list of allowed property names
 * @returns Filtered object with only allowed properties, or empty object if input invalid
 */
export function stripUnknownParameters<T extends Record<string, any>>(
    toolName: string,
    input: T,
    allowedProperties?: string[]
): T {
    // Validate input before processing
    if (input === null || input === undefined) {
        return {} as T;
    }

    if (typeof input !== 'object' || Array.isArray(input)) {
        return {} as T;
    }

    const properties = allowedProperties || ORPAR_ALLOWED_PROPERTIES[toolName];
    if (!properties) return input;

    const stripped = {} as T;

    for (const key of Object.keys(input)) {
        if (properties.includes(key)) {
            (stripped as any)[key] = input[key];
        } else {
            logger.debug(`[ParameterNormalizer] Stripped unknown param from ${toolName}: ${key}`);
        }
    }

    return stripped;
}

/**
 * Full normalization pipeline for ORPAR tool parameters
 * Combines all normalization steps in the correct order
 */
export function normalizeOrparToolInput<T extends Record<string, any>>(
    toolName: string,
    input: T,
    arrayFields?: string[]
): T {
    // Step 1: Normalize parameter names
    let result = normalizeOrparParameters(toolName, input) as T;

    // Step 2: Coerce array fields if specified
    if (arrayFields && arrayFields.length > 0) {
        result = coerceArrayFields(result, arrayFields);
    }

    // Step 3: Strip unknown parameters
    result = stripUnknownParameters(toolName, result);

    return result;
}
