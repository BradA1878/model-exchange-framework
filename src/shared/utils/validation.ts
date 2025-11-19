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
 * Validation utility for type checking and assertions.
 * Provides configurable validation with different severity levels:
 * - hard: throws errors (fail-fast)
 * - soft: logs warnings
 * - silent: performs validation without output
 */

import { Logger } from './Logger';

// Create logger instance for validation utility
const logger = new Logger('warn', 'Validation', 'server');

/**
 * Available validation modes
 * @typedef {"hard" | "soft" | "silent"} ValidationMode
 * @property {string} hard - Throws an error immediately (fail-fast)
 * @property {string} soft - Logs warnings but doesn't interrupt execution
 * @property {string} silent - Performs checks with no logging or errors
 */
export type ValidationMode = "hard" | "soft" | "silent";

/**
 * Configuration options for the validator factory
 * @interface ValidatorConfig
 */
export interface ValidatorConfig {
    /**
     * Sets the validation behavior mode
     */
    mode: ValidationMode;
    
    /**
     * Optional context label for error messages
     */
    label?: string;
}

/**
 * Creates a validator with configurable behavior
 * @param {ValidatorConfig} config - Configuration for validation behavior
 * @returns Object containing type assertion functions
 */
export const createValidator = (config: ValidatorConfig) => {
    const { mode, label } = config;
    const context = label ? `[${label}]` : "";

    /**
     * Handles validation failures based on configured mode
     * @param {string} expected - Expected type or condition description
     * @param {unknown} actual - Actual value received
     * @param {string} [customMessage] - Optional custom error message
     */
    const handleFailure = (expected: string, actual: unknown, customMessage?: string): void => {
        const message = customMessage || `${context} Expected ${expected}, got: ${actual === null ? "null" : typeof actual}`;

        if (mode === "hard") {
            throw new Error(message);
        } else if (mode === "soft") {
            logger.warn(message);
        }
    };

    /**
     * Validates that a value is a string
     * @param {unknown} value - Value to check
     * @param {string} [customMessage] - Optional custom error message
     * @returns {boolean} True if validation passes
     */
    const assertIsString = (value: unknown, customMessage?: string): value is string => {
        const valid = typeof value === "string";
        if (!valid) handleFailure("string", value, customMessage);
        return valid;
    };

    /**
     * Validates that a value is a number (and not NaN)
     * @param {unknown} value - Value to check
     * @param {string} [customMessage] - Optional custom error message
     * @returns {boolean} True if validation passes
     */
    const assertIsNumber = (value: unknown, customMessage?: string): value is number => {
        const valid = typeof value === "number" && !Number.isNaN(value);
        if (!valid) handleFailure("number", value, customMessage);
        return valid;
    };

    /**
     * Validates that a value is a boolean
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsBoolean = (value: unknown): value is boolean => {
        const valid = typeof value === "boolean";
        if (!valid) handleFailure("boolean", value);
        return valid;
    };

    /**
     * Validates that a value is a bigint
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsBigInt = (value: unknown): value is bigint => {
        const valid = typeof value === "bigint";
        if (!valid) handleFailure("bigint", value);
        return valid;
    };

    /**
     * Validates that a value is a symbol
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsSymbol = (value: unknown): value is symbol => {
        const valid = typeof value === "symbol";
        if (!valid) handleFailure("symbol", value);
        return valid;
    };

    /**
     * Validates that a value is a function
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsFunction = (value: unknown): value is Function => {
        const valid = typeof value === "function";
        if (!valid) handleFailure("function", value);
        return valid;
    };

    /**
     * Validates that a value is a non-null object
     * @param {unknown} value - Value to check
     * @param {string} [customMessage] - Optional custom error message
     * @returns {boolean} True if validation passes
     */
    const assertIsObject = (value: unknown, customMessage?: string): value is object => {
        const valid = typeof value === "object" && value !== null;
        if (!valid) handleFailure("non-null object", value, customMessage);
        return valid;
    };

    /**
     * Validates that a value is null
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsNull = (value: unknown): value is null => {
        const valid = value === null;
        if (!valid) handleFailure("null", value);
        return valid;
    };

    /**
     * Validates that a value is undefined
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsUndefined = (value: unknown): value is undefined => {
        const valid = value === undefined;
        if (!valid) handleFailure("undefined", value);
        return valid;
    };

    /**
     * Validates that a value is an array
     * @param {unknown} value - Value to check
     * @param {string} [customMessage] - Optional custom error message
     * @returns {boolean} True if validation passes
     */
    const assertIsArray = (value: unknown, customMessage?: string): value is Array<unknown> => {
        const valid = Array.isArray(value);
        if (!valid) handleFailure(customMessage || "array", value);
        return valid;
    };

    /**
     * Validates that a value is a non-empty string
     * @param {unknown} value - Value to check
     * @param {string} [customMessage] - Optional custom error message
     * @returns {boolean} True if validation passes
     */
    const assertIsNonEmptyString = (value: unknown, customMessage?: string): value is string => {
        const isString = typeof value === "string";
        const isNonEmpty = isString && (value as string).trim().length > 0;
        
        if (!isString) {
            handleFailure("string", value, customMessage);
            return false;
        }
        
        if (!isNonEmpty) {
            handleFailure("non-empty string", value, customMessage);
            return false;
        }
        
        return true;
    };

    /**
     * Validates that a value is a valid UUID
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsUuid = (value: unknown): value is string => {
        const isString = assertIsString(value);
        if (!isString) return false;
        
        // UUID regex pattern
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const valid = uuidPattern.test(value);
        
        if (!valid) handleFailure("valid UUID", value);
        return valid;
    };

    /**
     * Validates that a value is a valid ISO date string
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsIsoDateString = (value: unknown): value is string => {
        const isString = assertIsString(value);
        if (!isString) return false;
        
        // Try parsing as date and check validity
        const date = new Date(value);
        const valid = !isNaN(date.getTime()) && value.includes('T');
        
        if (!valid) handleFailure("ISO date string", value);
        return valid;
    };

    /**
     * Validates that an object has the specified property
     * @param {unknown} obj - Object to check
     * @param {string} prop - Property name to verify
     * @returns {boolean} True if validation passes
     */
    const assertHasProperty = <T extends object>(
        obj: T, 
        prop: string,
        customMessage?: string
    ): obj is T & Record<string, unknown> => {
        const isObj = assertIsObject(obj);
        if (!isObj) return false;
        
        const valid = prop in obj;
        if (!valid) handleFailure(`object with '${prop}' property`, `object missing '${prop}'`, customMessage);
        return valid;
    };

    /**
     * Validates message ID format (specific to the framework)
     * @param {unknown} value - Value to check
     * @returns {boolean} True if validation passes
     */
    const assertIsValidMessageId = (value: unknown): value is string => {
        return assertIsUuid(value);
    };

    /**
     * Validates that a property exists on an object and is a function
     * @param {unknown} obj - Object to check
     * @param {string} propertyName - Name of the property to check
     * @returns {boolean} True if validation passes
     */
    const assertHasFunction = (obj: unknown, propertyName: string): boolean => {
        // First check if the object is valid
        if (!assertIsObject(obj)) {
            return false;
        }

        // Now check if the property exists and is a function
        const hasProperty = propertyName in (obj as object);
        if (!hasProperty) {
            handleFailure(`object to have property '${propertyName}'`, 
                `object without '${propertyName}'`);
            return false;
        }

        const property = (obj as any)[propertyName];
        const isFunction = typeof property === 'function';
        if (!isFunction) {
            handleFailure(`property '${propertyName}' to be a function`, 
                `property of type ${typeof property}`);
            return false;
        }

        return true;
    };

    /**
     * Validates that an object has the required event payload fields
     * @param {unknown} obj - Object to check
     * @returns {boolean} True if validation passes
     */
    const assertIsEventPayload = (obj: unknown): obj is Record<string, unknown> => {
        // First check if it's an object
        if (!assertIsObject(obj)) return false;
        
        // Check required top-level fields for refactored event payload schema
        const requiredFields = ['agentId', 'channelId', 'timestamp'];
        
        for (const field of requiredFields) {
            if (!(field in obj)) {
                handleFailure(`event payload with '${field}' at top level`, 
                    `object missing top-level '${field}'`);
                return false;
            }
        }
        
        return true;
    };

    /**
     * Validates that an object follows the control loop event payload structure
     * @param {unknown} obj - Object to check
     * @returns {boolean} True if validation passes
     */
    const assertIsControlLoopPayload = (obj: unknown): obj is Record<string, unknown> => {
        // First validate it's a BaseEventPayload structure
        if (!assertIsEventPayload(obj)) return false;
        
        const payload = obj as any;
        
        // Check that data field contains control loop specific data
        if (!payload.data || typeof payload.data !== 'object') {
            handleFailure(`control loop payload with 'data' as an object`, 
                `object with invalid 'data' field`);
            return false;
        }
        
        const dataObj = payload.data;
        
        // Check required fields in control loop data - loopId is required, status is optional
        if (!dataObj.loopId || typeof dataObj.loopId !== 'string') {
            handleFailure(`control loop payload with 'loopId'`, 
                typeof dataObj.loopId);
            return false;
        }
        
        // Status is optional, but if present must be a string
        if (dataObj.status !== undefined && typeof dataObj.status !== 'string') {
            handleFailure(`control loop payload with 'status' as string or undefined`, 
                typeof dataObj.status);
            return false;
        }
        
        return true;
    };

    /**
     * Assert that an object is a valid ChannelMessage
     * @param obj The object to validate
     * @param paramName Optional parameter name for error messages
     * @throws Error if validation fails
     */
    const assertIsChannelMessage = (obj: unknown, paramName: string = 'channelMessage'): void => {
        if (!assertIsObject(obj)) {
            handleFailure(`${paramName} as object`, `Expected object with 'channelId' property, got: ${typeof obj}`);
            return;
        }
        
        // Check required fields for ChannelMessage
        if (!('toolType' in obj) || obj.toolType !== 'channelMessage') {
            handleFailure(`${paramName} with toolType 'channelMessage'`, `Missing or invalid toolType, expected 'channelMessage', got: ${(obj as any).toolType}`);
            return;
        }
        
        if (!('context' in obj) || !assertIsObject(obj.context)) {
            handleFailure(`${paramName} with context object`, `Missing or invalid context object`);
            return;
        }
        
        if (!('channelId' in obj.context) || typeof obj.context.channelId !== 'string' || obj.context.channelId.trim() === '') {
            handleFailure(`${paramName} with context.channelId`, `Expected object with 'channelId' property in context`);
            return;
        }
    };

    /**
     * Assert that an object is a valid AgentMessage
     * @param obj The object to validate
     * @param paramName Optional parameter name for error messages
     * @throws Error if validation fails
     */
    const assertIsAgentMessage = (obj: unknown, paramName: string = 'agentMessage'): void => {
        if (!assertIsObject(obj)) {
            handleFailure(`${paramName} as object`, `Expected object with 'receiverId' property, got: ${typeof obj}`);
            return;
        }
        
        // Check required fields for AgentMessage
        if (!('toolType' in obj) || obj.toolType !== 'agentMessage') {
            handleFailure(`${paramName} with toolType 'agentMessage'`, `Missing or invalid toolType, expected 'agentMessage', got: ${(obj as any).toolType}`);
            return;
        }
        
        if (!('receiverId' in obj) || typeof obj.receiverId !== 'string' || obj.receiverId.trim() === '') {
            handleFailure(`${paramName} with receiverId`, `Expected object with 'receiverId' property`);
            return;
        }
    };

    /**
     * Generic assertion that evaluates a condition
     * @param {boolean} condition - Condition to check
     * @param {string} [customMessage] - Optional error message if condition fails
     * @returns {boolean} Result of the condition
     */
    const assert = (condition: boolean, customMessage?: string): boolean => {
        if (!condition) {
            handleFailure("condition to be true", false, customMessage);
        }
        return condition;
    };

    /**
     * Assert that two values are equal
     * @param {any} actual - Actual value
     * @param {any} expected - Expected value
     * @param {string} [customMessage] - Optional error message
     * @returns {boolean} True if values are equal
     */
    const assertEqual = <T>(actual: T, expected: T, customMessage?: string): boolean => {
        const areEqual = actual === expected;
        if (!areEqual) {
            handleFailure(`${expected}`, actual, customMessage || `Expected ${actual} to equal ${expected}`);
        }
        return areEqual;
    };

    /**
     * Assert that a number is greater than or equal to a minimum value
     * @param {number} value - Value to check
     * @param {number} min - Minimum value
     * @param {string} [customMessage] - Optional error message
     * @returns {boolean} True if value is greater than or equal to min
     */
    const assertIsGreaterThanOrEqual = (value: number, min: number, customMessage?: string): boolean => {
        const isValid = value >= min;
        if (!isValid) {
            handleFailure(`value >= ${min}`, value, customMessage || `Expected ${value} to be >= ${min}`);
        }
        return isValid;
    };

    /**
     * Assert that a number is within a range
     * @param {number} value - Value to check
     * @param {number} min - Minimum value (inclusive)
     * @param {number} max - Maximum value (inclusive)
     * @param {string} [customMessage] - Optional error message
     * @returns {boolean} True if value is within range
     */
    const assertIsInRange = (value: number, min: number, max: number, customMessage?: string): boolean => {
        const isValid = value >= min && value <= max;
        if (!isValid) {
            handleFailure(`value between ${min} and ${max}`, value, customMessage || `Expected ${value} to be between ${min} and ${max}`);
        }
        return isValid;
    };

    return {
        assertIsString,
        assertIsNumber,
        assertIsBoolean,
        assertIsBigInt,
        assertIsSymbol,
        assertIsFunction,
        assertIsObject,
        assertIsNull,
        assertIsUndefined,
        assertIsArray,
        assertIsNonEmptyString,
        assertIsUuid,
        assertIsIsoDateString,
        assertHasProperty,
        assertIsValidMessageId,
        assertHasFunction,
        assertIsEventPayload,
        assertIsControlLoopPayload,
        assertIsChannelMessage,
        assertIsAgentMessage,
        assert,
        assertEqual,
        assertIsGreaterThanOrEqual,
        assertIsInRange
    };
};

/**
 * Creates a pre-configured validator with hard mode for strict validation
 * @param {string} label - Optional context label for error identification
 * @returns Validator with strict (error throwing) validation
 */
export const createStrictValidator = (label?: string) => {
    return createValidator({ mode: "hard", label });
};

/**
 * Creates a pre-configured validator with soft mode for warning-only validation
 * @param {string} label - Optional context label for warning identification
 * @returns Validator with warning-only validation
 */
export const createWarningValidator = (label?: string) => {
    return createValidator({ mode: "soft", label });
};

/**
 * Creates a pre-configured validator with silent mode for logic-only validation
 * @param {string} label - Optional context label (not used in silent mode)
 * @returns Validator with silent validation (no errors or warnings)
 */
export const createSilentValidator = (label?: string) => {
    return createValidator({ mode: "silent", label });
};

// Export the assertIsChannelMessage function for use in other modules
export const { assertIsChannelMessage } = createStrictValidator();

// Export the assertIsEventPayload function for use in other modules  
export const { assertIsEventPayload } = createStrictValidator();

// Export the assertIsAgentMessage function for use in other modules  
export const { assertIsAgentMessage } = createStrictValidator();
