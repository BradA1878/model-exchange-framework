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

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DatabaseAdapterFactory } from '../../../src/shared/database/DatabaseAdapterFactory';

/**
 * Unit tests for DatabaseAdapterFactory.
 * These tests verify factory behavior without requiring database connection.
 */
describe('DatabaseAdapterFactory Unit Tests', () => {

    beforeEach(() => {
        // Reset factory before each test
        DatabaseAdapterFactory.reset();
    });

    describe('Factory Initialization', () => {
        it('should throw error if create() called before initialize()', () => {
            expect(() => DatabaseAdapterFactory.create()).toThrow(
                'DatabaseAdapterFactory not initialized. Call initialize() first.'
            );
        });

        it('should accept MongoDB configuration', () => {
            expect(() => {
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: 'mongodb://localhost:27017/test'
                });
            }).not.toThrow();
        });

        it('should return same configuration after initialization', () => {
            const config = {
                type: 'mongodb' as const,
                connectionString: 'mongodb://localhost:27017/test'
            };

            DatabaseAdapterFactory.initialize(config);
            const retrieved = DatabaseAdapterFactory.getConfig();

            expect(retrieved).toEqual(config);
        });

        it('should reset configuration when reset() is called', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            DatabaseAdapterFactory.reset();
            const config = DatabaseAdapterFactory.getConfig();

            expect(config).toBeNull();
        });
    });

    describe('Repository Bundle Creation', () => {
        it('should return repository bundle for MongoDB', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            const repos = DatabaseAdapterFactory.create();

            expect(repos).toBeDefined();
            expect(repos.agents).toBeDefined();
            expect(repos.channels).toBeDefined();
            expect(repos.tasks).toBeDefined();
            expect(repos.memory).toBeDefined();
        });

        it('should return same instance on multiple create() calls (singleton)', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            const repos1 = DatabaseAdapterFactory.create();
            const repos2 = DatabaseAdapterFactory.create();

            expect(repos1).toBe(repos2);
        });

        it('should create new instance after reset()', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            const repos1 = DatabaseAdapterFactory.create();

            DatabaseAdapterFactory.reset();
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            const repos2 = DatabaseAdapterFactory.create();

            expect(repos1).not.toBe(repos2);
        });

        it('should have correct repository types', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test'
            });

            const repos = DatabaseAdapterFactory.create();

            // Verify repository methods exist
            expect(typeof repos.agents.findByAgentId).toBe('function');
            expect(typeof repos.channels.findByChannelId).toBe('function');
            expect(typeof repos.tasks.findByChannel).toBe('function');
            expect(typeof repos.memory.getAgentMemory).toBe('function');
        });
    });

    describe('Unsupported Database Types', () => {
        it('should throw error for PostgreSQL (not implemented)', () => {
            DatabaseAdapterFactory.initialize({
                type: 'postgresql' as any,
                connectionString: 'postgresql://localhost/test'
            });

            expect(() => DatabaseAdapterFactory.create()).toThrow(
                'PostgreSQL adapter not yet implemented'
            );
        });

        it('should throw error for SQLite (not implemented)', () => {
            DatabaseAdapterFactory.initialize({
                type: 'sqlite' as any,
                connectionString: 'sqlite://test.db'
            });

            expect(() => DatabaseAdapterFactory.create()).toThrow(
                'SQLite adapter not yet implemented'
            );
        });

        it('should throw error for MySQL (not implemented)', () => {
            DatabaseAdapterFactory.initialize({
                type: 'mysql' as any,
                connectionString: 'mysql://localhost/test'
            });

            expect(() => DatabaseAdapterFactory.create()).toThrow(
                'MySQL adapter not yet implemented'
            );
        });

        it('should throw error for unknown database type', () => {
            DatabaseAdapterFactory.initialize({
                type: 'unknown' as any,
                connectionString: 'unknown://localhost'
            });

            expect(() => DatabaseAdapterFactory.create()).toThrow(
                'Unknown database type: unknown'
            );
        });
    });

    describe('Configuration Options', () => {
        it('should accept optional configuration options', () => {
            expect(() => {
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: 'mongodb://localhost:27017/test',
                    options: {
                        poolSize: 10,
                        useNewUrlParser: true
                    }
                });
            }).not.toThrow();
        });

        it('should preserve options in configuration', () => {
            const options = {
                poolSize: 10,
                useNewUrlParser: true
            };

            DatabaseAdapterFactory.initialize({
                type: 'mongodb',
                connectionString: 'mongodb://localhost:27017/test',
                options
            });

            const config = DatabaseAdapterFactory.getConfig();
            expect(config?.options).toEqual(options);
        });
    });
});
