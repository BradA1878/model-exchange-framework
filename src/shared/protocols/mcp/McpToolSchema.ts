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
 * MCP Tool Schema - Enhanced with AJV JSON Schema Validation
 * 
 * This module defines JSON schema validation for MCP tools using industry-standard
 * AJV validator. It follows the MCP specification while providing robust validation
 * with detailed error messages.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createStrictValidator } from '../../utils/validation';
import { McpToolDefinition } from './McpServerTypes';

// Create validator for MCP tools
const validate = createStrictValidator('McpToolSchema');

// Initialize AJV with comprehensive error reporting
const ajv = new Ajv({ 
    allErrors: true, 
    verbose: true,
    strict: false,
    validateFormats: true
});
addFormats(ajv);

/**
 * MCP Tool Parameter Type
 * Represents the possible data types for tool parameters
 */
export enum McpToolParameterType {
    STRING = 'string',
    NUMBER = 'number',
    INTEGER = 'integer',
    BOOLEAN = 'boolean',
    ARRAY = 'array',
    OBJECT = 'object',
    NULL = 'null'
}

/**
 * MCP Tool Parameter Format
 * Additional format specifiers for parameters
 */
export enum McpToolParameterFormat {
    DATE = 'date',
    DATE_TIME = 'date-time',
    TIME = 'time',
    EMAIL = 'email',
    URI = 'uri',
    UUID = 'uuid',
    REGEX = 'regex'
}

/**
 * Tool example for better documentation
 */
export interface McpToolExample {
    input: Record<string, any>;
    description: string;
    output?: any;
}

/**
 * Enhanced MCP Tool Definition with examples and metadata
 */
export interface EnhancedMcpToolDefinition extends McpToolDefinition {
    examples?: McpToolExample[];
    metadata?: {
        timeout?: number;
        requiresConfirmation?: boolean;
        streaming?: boolean;
        category?: string;
    };
}

/**
 * MCP Tool Parameter Definition
 * Represents a parameter for an MCP tool
 */
export interface McpToolParameterDefinition {
    /** Parameter name */
    name: string;
    /** Parameter description */
    description: string;
    /** Parameter type */
    type: McpToolParameterType | McpToolParameterType[];
    /** Is parameter required */
    required: boolean;
    /** Parameter format (optional) */
    format?: McpToolParameterFormat;
    /** Default value (optional) */
    default?: any;
    /** Minimum value for numbers (optional) */
    minimum?: number;
    /** Maximum value for numbers (optional) */
    maximum?: number;
    /** Minimum length for strings/arrays (optional) */
    minLength?: number;
    /** Maximum length for strings/arrays (optional) */
    maxLength?: number;
    /** Pattern for strings (optional) */
    pattern?: string;
    /** Enum values (optional) */
    enum?: any[];
    /** Items schema for arrays (optional) */
    items?: McpToolParameterDefinition;
    /** Properties for objects (optional) */
    properties?: Record<string, McpToolParameterDefinition>;
    /** Required properties for objects (optional) */
    requiredProperties?: string[];
    /** Additional properties allowed for objects (optional) */
    additionalProperties?: boolean;
}

/**
 * Validation result with detailed error information
 */
export interface ValidationResult {
    valid: boolean;
    errors?: string[];
    errorDetails?: Array<{
        path: string;
        message: string;
        expected?: any;
        actual?: any;
    }>;
    // Coerced input after LLM type corrections (string→boolean, string→number, etc.)
    coercedInput?: any;
}

/**
 * Create JSON schema from parameter definitions
 * @param parameters - List of parameter definitions
 * @returns JSON schema object
 */
export const createParameterSchema = (parameters: McpToolParameterDefinition[]): Record<string, any> => {
    const schema: Record<string, any> = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
    };

    for (const param of parameters) {
        // Create property schema
        schema.properties[param.name] = {
            type: param.type,
            description: param.description
        };

        // Add format if specified
        if (param.format) {
            schema.properties[param.name].format = param.format;
        }

        // Add validation constraints
        if (param.minimum !== undefined) {
            schema.properties[param.name].minimum = param.minimum;
        }
        if (param.maximum !== undefined) {
            schema.properties[param.name].maximum = param.maximum;
        }
        if (param.minLength !== undefined) {
            schema.properties[param.name].minLength = param.minLength;
        }
        if (param.maxLength !== undefined) {
            schema.properties[param.name].maxLength = param.maxLength;
        }
        if (param.pattern) {
            schema.properties[param.name].pattern = param.pattern;
        }
        if (param.enum) {
            schema.properties[param.name].enum = param.enum;
        }
        if (param.default !== undefined) {
            schema.properties[param.name].default = param.default;
        }

        // Handle array items
        if (param.type === McpToolParameterType.ARRAY && param.items) {
            schema.properties[param.name].items = createParameterSchema([param.items]).properties[param.items.name];
        }

        // Handle object properties
        if (param.type === McpToolParameterType.OBJECT && param.properties) {
            const objectSchema = createParameterSchema(
                Object.entries(param.properties).map(([name, def]) => ({
                    ...def,
                    name
                }))
            );
            schema.properties[param.name].properties = objectSchema.properties;
            
            if (param.requiredProperties && param.requiredProperties.length > 0) {
                schema.properties[param.name].required = param.requiredProperties;
            }
            
            if (param.additionalProperties !== undefined) {
                schema.properties[param.name].additionalProperties = param.additionalProperties;
            }
        }

        // Add to required list if necessary
        if (param.required) {
            schema.required.push(param.name);
        }
    }

    return schema;
};

/**
 * Create an enhanced MCP tool definition with examples
 * @param name - Tool name
 * @param description - Tool description
 * @param parameters - Tool parameters
 * @param handler - Tool handler function
 * @param options - Additional options like examples and metadata
 * @returns Enhanced MCP tool definition
 */
export const createToolDefinition = (
    name: string, 
    description: string, 
    parameters: McpToolParameterDefinition[], 
    handler: McpToolDefinition['handler'],
    options?: {
        examples?: McpToolExample[];
        metadata?: EnhancedMcpToolDefinition['metadata'];
    }
): EnhancedMcpToolDefinition => {
    // Validate inputs
    validate.assertIsNonEmptyString(name);
    validate.assertIsNonEmptyString(description);
    validate.assertIsArray(parameters);
    validate.assertIsFunction(handler);

    // Create tool definition
    return {
        name,
        description,
        inputSchema: createParameterSchema(parameters),
        handler,
        enabled: true,
        examples: options?.examples,
        metadata: options?.metadata
    };
};

/**
 * Coerce common LLM type errors before validation
 * LLMs often return "true"/"false" strings instead of booleans
 * @param schema - JSON schema with property types
 * @param input - Tool input to coerce
 * @returns Coerced input object
 */
const coerceLlmTypes = (schema: Record<string, any>, input: any): any => {
    if (!input || typeof input !== 'object' || !schema.properties) {
        return input;
    }
    
    const coerced = { ...input };
    
    for (const [key, propSchema] of Object.entries(schema.properties as Record<string, any>)) {
        if (!(key in coerced)) continue;
        
        const value = coerced[key];
        const expectedType = propSchema.type;
        
        // Coerce string "true"/"false" to boolean
        if (expectedType === 'boolean' && typeof value === 'string') {
            const lowerValue = value.toLowerCase().trim();
            if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
                coerced[key] = true;
            } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
                coerced[key] = false;
            }
        }
        
        // Coerce string numbers to numbers
        if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'string') {
            const num = Number(value);
            if (!isNaN(num)) {
                coerced[key] = expectedType === 'integer' ? Math.floor(num) : num;
            }
        }
        
        // Coerce JSON string to object/array
        if ((expectedType === 'object' || expectedType === 'array') && typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if ((expectedType === 'object' && typeof parsed === 'object' && !Array.isArray(parsed)) ||
                    (expectedType === 'array' && Array.isArray(parsed))) {
                    coerced[key] = parsed;
                }
            } catch {
                // Keep original value if parsing fails
            }
        }
    }
    
    return coerced;
};

/**
 * Validate tool input against schema with detailed error reporting
 * @param schema - JSON schema
 * @param input - Tool input to validate
 * @returns Detailed validation result
 */
export const validateToolInput = (schema: Record<string, any>, input: any): ValidationResult => {
    try {
        // Pre-validation type coercion to handle common LLM type errors
        const coercedInput = coerceLlmTypes(schema, input);
        
        const validate = ajv.compile(schema);
        const valid = validate(coercedInput);
        
        if (!valid && validate.errors) {
            const errors: string[] = [];
            const errorDetails: ValidationResult['errorDetails'] = [];
            
            for (const error of validate.errors) {
                let errorMessage = '';
                const path = error.instancePath || 'input';
                
                switch (error.keyword) {
                    case 'required':
                        errorMessage = `Missing required parameter: ${error.params.missingProperty}`;
                        errorDetails.push({
                            path: `${path}.${error.params.missingProperty}`,
                            message: errorMessage,
                            expected: 'defined',
                            actual: 'undefined'
                        });
                        break;
                    
                    case 'type':
                        errorMessage = `${path} ${error.message}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.type,
                            actual: typeof error.data
                        });
                        break;
                    
                    case 'enum':
                        errorMessage = `${path} must be one of: ${error.params.allowedValues.join(', ')}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.allowedValues,
                            actual: error.data
                        });
                        break;
                    
                    case 'format':
                        errorMessage = `${path} must be a valid ${error.params.format}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.format,
                            actual: error.data
                        });
                        break;
                    
                    case 'minimum':
                    case 'maximum':
                        errorMessage = `${path} ${error.message}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.limit,
                            actual: error.data
                        });
                        break;
                    
                    case 'minLength':
                    case 'maxLength':
                        errorMessage = `${path} ${error.message}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.limit,
                            actual: typeof error.data === 'string' || Array.isArray(error.data) 
                                ? error.data.length 
                                : undefined
                        });
                        break;
                    
                    case 'pattern':
                        errorMessage = `${path} must match pattern: ${error.params.pattern}`;
                        errorDetails.push({
                            path,
                            message: errorMessage,
                            expected: error.params.pattern,
                            actual: error.data
                        });
                        break;
                    
                    case 'additionalProperties':
                        errorMessage = `Unexpected property: ${error.params.additionalProperty}`;
                        errorDetails.push({
                            path: `${path}.${error.params.additionalProperty}`,
                            message: errorMessage
                        });
                        break;
                    
                    default:
                        errorMessage = `${path} ${error.message}`;
                        errorDetails.push({
                            path,
                            message: errorMessage
                        });
                }
                
                errors.push(errorMessage);
            }
            
            return { valid: false, errors, errorDetails, coercedInput };
        }
        
        return { valid: true, coercedInput };
    } catch (error) {
        return { 
            valid: false, 
            errors: [`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`] 
        };
    }
};

/**
 * Format validation errors for user-friendly display
 * @param result - Validation result
 * @param toolName - Name of the tool
 * @param schema - Tool schema
 * @param input - Input that was validated
 * @returns Formatted error message
 */
export const formatValidationError = (
    result: ValidationResult,
    toolName: string,
    schema: Record<string, any>,
    input: any
): string => {
    if (result.valid) {
        return '';
    }
    
    const lines: string[] = [
        `❌ Invalid input for tool "${toolName}":`,
        ''
    ];
    
    if (result.errors && result.errors.length > 0) {
        lines.push('Errors:');
        result.errors.forEach((error, index) => {
            lines.push(`  ${index + 1}. ${error}`);
        });
        lines.push('');
    }
    
    if (result.errorDetails && result.errorDetails.length > 0) {
        lines.push('Details:');
        result.errorDetails.forEach(detail => {
            lines.push(`  • ${detail.path}: ${detail.message}`);
            if (detail.expected !== undefined) {
                lines.push(`    Expected: ${JSON.stringify(detail.expected)}`);
            }
            if (detail.actual !== undefined) {
                lines.push(`    Actual: ${JSON.stringify(detail.actual)}`);
            }
        });
        lines.push('');
    }
    
    lines.push('Expected schema:');
    lines.push(JSON.stringify(schema, null, 2));
    lines.push('');
    lines.push('Received input:');
    lines.push(JSON.stringify(input, null, 2));
    
    return lines.join('\n');
};

/**
 * Generate tool usage documentation with examples
 * @param tool - Tool definition
 * @returns Formatted documentation string
 */
export const generateToolDocumentation = (tool: EnhancedMcpToolDefinition): string => {
    const lines: string[] = [
        `## ${tool.name}`,
        '',
        tool.description,
        '',
        '### Parameters:',
        ''
    ];
    
    if (tool.inputSchema.properties) {
        Object.entries(tool.inputSchema.properties).forEach(([name, schema]: [string, any]) => {
            const required = tool.inputSchema.required?.includes(name) ? ' (required)' : ' (optional)';
            lines.push(`- **${name}**${required}: ${schema.description || 'No description'}`);
            lines.push(`  - Type: ${Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type}`);
            
            if (schema.format) lines.push(`  - Format: ${schema.format}`);
            if (schema.enum) lines.push(`  - Values: ${schema.enum.join(', ')}`);
            if (schema.minimum !== undefined) lines.push(`  - Minimum: ${schema.minimum}`);
            if (schema.maximum !== undefined) lines.push(`  - Maximum: ${schema.maximum}`);
            if (schema.minLength !== undefined) lines.push(`  - Min length: ${schema.minLength}`);
            if (schema.maxLength !== undefined) lines.push(`  - Max length: ${schema.maxLength}`);
            if (schema.pattern) lines.push(`  - Pattern: ${schema.pattern}`);
            if (schema.default !== undefined) lines.push(`  - Default: ${JSON.stringify(schema.default)}`);
            
            lines.push('');
        });
    }
    
    if (tool.examples && tool.examples.length > 0) {
        lines.push('### Examples:');
        lines.push('');
        
        tool.examples.forEach((example, index) => {
            lines.push(`#### Example ${index + 1}: ${example.description}`);
            lines.push('```json');
            lines.push(JSON.stringify(example.input, null, 2));
            lines.push('```');
            
            if (example.output !== undefined) {
                lines.push('Output:');
                lines.push('```json');
                lines.push(JSON.stringify(example.output, null, 2));
                lines.push('```');
            }
            
            lines.push('');
        });
    }
    
    return lines.join('\n');
};