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
 * Date & Time Tools
 * 
 * MCP tools for date/time operations, timezone conversions, and temporal calculations.
 * Provides agents with temporal awareness and date manipulation capabilities.
 */

import { Logger } from '../../../utils/Logger';

const logger = new Logger('info', 'DateTimeTools', 'server');

/**
 * Get current date and time with timezone support
 */
export const dateTimeNowTool = {
    name: 'datetime_now',
    description: 'Get the current date and time. Returns timestamp, ISO string, and human-readable formats with timezone information.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'IANA timezone identifier (e.g., "America/New_York", "Europe/London", "UTC"). Defaults to UTC.',
                default: 'UTC'
            },
            includeOffset: {
                type: 'boolean',
                description: 'Include UTC offset in the response',
                default: true
            }
        },
        additionalProperties: false
    },
    examples: [
        {
            input: {},
            description: 'Get current UTC time'
        },
        {
            input: { timezone: 'America/New_York' },
            description: 'Get current time in New York timezone'
        }
    ],
    metadata: {
        category: 'datetime',
        timeout: 2000
    },
    
    async handler(input: { timezone?: string; includeOffset?: boolean }, context: any): Promise<any> {
        try {
            const timezone = input.timezone || 'UTC';
            const now = new Date();
            
            // Get timezone offset
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZoneName: 'short'
            });
            
            const parts = formatter.formatToParts(now);
            const timeZoneName = parts.find(p => p.type === 'timeZoneName')?.value || timezone;
            
            // Get day of week
            const dayFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                weekday: 'long'
            });
            const dayOfWeek = dayFormatter.format(now);
            
            // Format as readable string
            const readableFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZoneName: 'short'
            });
            
            const result: any = {
                timestamp: now.getTime(),
                iso: now.toISOString(),
                timezone: timezone,
                timeZoneName: timeZoneName,
                dayOfWeek: dayOfWeek,
                readable: readableFormatter.format(now),
                components: {
                    year: parseInt(parts.find(p => p.type === 'year')?.value || '0'),
                    month: parseInt(parts.find(p => p.type === 'month')?.value || '0'),
                    day: parseInt(parts.find(p => p.type === 'day')?.value || '0'),
                    hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0'),
                    minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0'),
                    second: parseInt(parts.find(p => p.type === 'second')?.value || '0')
                }
            };
            
            if (input.includeOffset !== false) {
                // Calculate UTC offset
                const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
                const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
                const offsetMs = tzDate.getTime() - utcDate.getTime();
                const offsetHours = Math.floor(offsetMs / (1000 * 60 * 60));
                const offsetMinutes = Math.abs(Math.floor((offsetMs % (1000 * 60 * 60)) / (1000 * 60)));
                
                result.utcOffset = {
                    hours: offsetHours,
                    minutes: offsetMinutes,
                    formatted: `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}:${offsetMinutes.toString().padStart(2, '0')}`
                };
            }
            
            return result;
        } catch (error) {
            logger.error(`Failed to get current date/time: ${error}`);
            throw new Error(`Failed to get current date/time: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * Convert date between timezones
 */
export const dateTimeConvertTool = {
    name: 'datetime_convert',
    description: 'Convert a date/time from one timezone to another. Accepts ISO strings, timestamps, or date strings.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            dateTime: {
                type: ['string', 'number'],
                description: 'Date/time to convert. Can be ISO string, timestamp (ms), or parseable date string'
            },
            fromTimezone: {
                type: 'string',
                description: 'Source timezone (IANA identifier). If not specified, assumes UTC for ISO strings.',
                default: 'UTC'
            },
            toTimezone: {
                type: 'string',
                description: 'Target timezone (IANA identifier)',
                minLength: 1
            }
        },
        required: ['dateTime', 'toTimezone'],
        additionalProperties: false
    },
    examples: [
        {
            input: { dateTime: '2025-01-15T14:30:00Z', toTimezone: 'America/New_York' },
            description: 'Convert UTC time to New York time'
        },
        {
            input: { dateTime: 1705329000000, toTimezone: 'Asia/Tokyo' },
            description: 'Convert timestamp to Tokyo time'
        }
    ],
    metadata: {
        category: 'datetime',
        timeout: 2000
    },
    
    async handler(input: { dateTime: string | number; fromTimezone?: string; toTimezone: string }, context: any): Promise<any> {
        try {
            // Parse input date
            let date: Date;
            if (typeof input.dateTime === 'number') {
                date = new Date(input.dateTime);
            } else {
                date = new Date(input.dateTime);
            }
            
            if (isNaN(date.getTime())) {
                throw new Error(`Invalid date/time: ${input.dateTime}`);
            }
            
            const fromTz = input.fromTimezone || 'UTC';
            const toTz = input.toTimezone;
            
            // Format in source timezone
            const sourceFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: fromTz,
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZoneName: 'short'
            });
            
            // Format in target timezone
            const targetFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: toTz,
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZoneName: 'short'
            });
            
            // Get target components
            const targetParts = new Intl.DateTimeFormat('en-US', {
                timeZone: toTz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).formatToParts(date);
            
            return {
                source: {
                    timezone: fromTz,
                    formatted: sourceFormatter.format(date)
                },
                target: {
                    timezone: toTz,
                    formatted: targetFormatter.format(date),
                    iso: date.toISOString(),
                    timestamp: date.getTime(),
                    components: {
                        year: parseInt(targetParts.find(p => p.type === 'year')?.value || '0'),
                        month: parseInt(targetParts.find(p => p.type === 'month')?.value || '0'),
                        day: parseInt(targetParts.find(p => p.type === 'day')?.value || '0'),
                        hour: parseInt(targetParts.find(p => p.type === 'hour')?.value || '0'),
                        minute: parseInt(targetParts.find(p => p.type === 'minute')?.value || '0'),
                        second: parseInt(targetParts.find(p => p.type === 'second')?.value || '0')
                    }
                }
            };
        } catch (error) {
            logger.error(`Failed to convert date/time: ${error}`);
            throw new Error(`Failed to convert date/time: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * Perform date arithmetic (add/subtract time)
 */
export const dateTimeArithmeticTool = {
    name: 'datetime_arithmetic',
    description: 'Add or subtract time from a date. Supports years, months, weeks, days, hours, minutes, and seconds.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            dateTime: {
                type: ['string', 'number'],
                description: 'Starting date/time (ISO string, timestamp, or parseable string). Defaults to now.'
            },
            operation: {
                type: 'string',
                description: 'Operation to perform',
                enum: ['add', 'subtract']
            },
            value: {
                type: 'number',
                description: 'Amount to add/subtract',
                minimum: 0
            },
            unit: {
                type: 'string',
                description: 'Time unit',
                enum: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds']
            },
            timezone: {
                type: 'string',
                description: 'Timezone for result display',
                default: 'UTC'
            }
        },
        required: ['operation', 'value', 'unit'],
        additionalProperties: false
    },
    examples: [
        {
            input: { operation: 'add', value: 7, unit: 'days' },
            description: 'Get date 7 days from now'
        },
        {
            input: { operation: 'subtract', value: 3, unit: 'hours' },
            description: 'Get date 3 hours ago'
        }
    ],
    metadata: {
        category: 'datetime',
        timeout: 2000
    },
    
    async handler(input: { dateTime?: string | number; operation: string; value: number; unit: string; timezone?: string }, context: any): Promise<any> {
        try {
            // Parse starting date
            let date: Date;
            if (input.dateTime) {
                date = typeof input.dateTime === 'number' 
                    ? new Date(input.dateTime) 
                    : new Date(input.dateTime);
            } else {
                date = new Date();
            }
            
            if (isNaN(date.getTime())) {
                throw new Error(`Invalid date/time: ${input.dateTime}`);
            }
            
            const multiplier = input.operation === 'add' ? 1 : -1;
            const value = input.value * multiplier;
            
            // Perform arithmetic
            const result = new Date(date);
            switch (input.unit) {
                case 'years':
                    result.setFullYear(result.getFullYear() + value);
                    break;
                case 'months':
                    result.setMonth(result.getMonth() + value);
                    break;
                case 'weeks':
                    result.setDate(result.getDate() + (value * 7));
                    break;
                case 'days':
                    result.setDate(result.getDate() + value);
                    break;
                case 'hours':
                    result.setHours(result.getHours() + value);
                    break;
                case 'minutes':
                    result.setMinutes(result.getMinutes() + value);
                    break;
                case 'seconds':
                    result.setSeconds(result.getSeconds() + value);
                    break;
                default:
                    throw new Error(`Unsupported unit: ${input.unit}`);
            }
            
            const timezone = input.timezone || 'UTC';
            
            // Format result
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZoneName: 'short'
            });
            
            return {
                original: {
                    iso: date.toISOString(),
                    timestamp: date.getTime()
                },
                result: {
                    iso: result.toISOString(),
                    timestamp: result.getTime(),
                    formatted: formatter.format(result),
                    timezone: timezone
                },
                operation: `${input.operation} ${input.value} ${input.unit}`
            };
        } catch (error) {
            logger.error(`Failed to perform date arithmetic: ${error}`);
            throw new Error(`Failed to perform date arithmetic: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * Format a date/time in various formats
 */
export const dateTimeFormatTool = {
    name: 'datetime_format',
    description: 'Format a date/time in various readable formats. Supports different locales and styles.',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            dateTime: {
                type: ['string', 'number'],
                description: 'Date/time to format (ISO string, timestamp, or parseable string). Defaults to now.'
            },
            format: {
                type: 'string',
                description: 'Format style',
                enum: ['full', 'long', 'medium', 'short', 'date-only', 'time-only', 'iso'],
                default: 'medium'
            },
            timezone: {
                type: 'string',
                description: 'Timezone for formatting',
                default: 'UTC'
            },
            locale: {
                type: 'string',
                description: 'Locale for formatting (e.g., "en-US", "es-ES", "ja-JP")',
                default: 'en-US'
            }
        },
        additionalProperties: false
    },
    examples: [
        {
            input: { format: 'full' },
            description: 'Format current time in full style'
        },
        {
            input: { format: 'date-only', locale: 'es-ES' },
            description: 'Format date in Spanish'
        }
    ],
    metadata: {
        category: 'datetime',
        timeout: 2000
    },
    
    async handler(input: { dateTime?: string | number; format?: string; timezone?: string; locale?: string }, context: any): Promise<any> {
        try {
            // Parse date
            let date: Date;
            if (input.dateTime) {
                date = typeof input.dateTime === 'number' 
                    ? new Date(input.dateTime) 
                    : new Date(input.dateTime);
            } else {
                date = new Date();
            }
            
            if (isNaN(date.getTime())) {
                throw new Error(`Invalid date/time: ${input.dateTime}`);
            }
            
            const format = input.format || 'medium';
            const timezone = input.timezone || 'UTC';
            const locale = input.locale || 'en-US';
            
            let formatted = '';
            
            switch (format) {
                case 'full':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: 'full',
                        timeStyle: 'full'
                    }).format(date);
                    break;
                case 'long':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: 'long',
                        timeStyle: 'long'
                    }).format(date);
                    break;
                case 'medium':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: 'medium',
                        timeStyle: 'medium'
                    }).format(date);
                    break;
                case 'short':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: 'short',
                        timeStyle: 'short'
                    }).format(date);
                    break;
                case 'date-only':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        dateStyle: 'full'
                    }).format(date);
                    break;
                case 'time-only':
                    formatted = new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        timeStyle: 'full'
                    }).format(date);
                    break;
                case 'iso':
                    formatted = date.toISOString();
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }
            
            return {
                formatted: formatted,
                iso: date.toISOString(),
                timestamp: date.getTime(),
                format: format,
                timezone: timezone,
                locale: locale
            };
        } catch (error) {
            logger.error(`Failed to format date/time: ${error}`);
            throw new Error(`Failed to format date/time: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

// Export all datetime tools
export const dateTimeTools = [
    dateTimeNowTool,
    dateTimeConvertTool,
    dateTimeArithmeticTool,
    dateTimeFormatTool
];
