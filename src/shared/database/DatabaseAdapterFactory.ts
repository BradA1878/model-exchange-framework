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

import mongoose from 'mongoose';
import { IAgentRepository } from '../repositories/interfaces/IAgentRepository';
import { IChannelRepository } from '../repositories/interfaces/IChannelRepository';
import { ITaskRepository } from '../repositories/interfaces/ITaskRepository';
import { IMemoryRepository } from '../repositories/interfaces/IMemoryRepository';

// MongoDB implementations
import {
    MongoAgentRepository,
    MongoChannelRepository,
    MongoTaskRepository,
    MongoMemoryRepository
} from './adapters/mongodb';

/**
 * Supported database types
 */
export type DatabaseType = 'mongodb' | 'postgresql' | 'sqlite' | 'mysql';

/**
 * Database configuration interface
 */
export interface DatabaseConfig {
    type: DatabaseType;
    connectionString: string;
    options?: Record<string, any>;
}

/**
 * Bundle of all repository implementations
 */
export interface RepositoryBundle {
    agents: IAgentRepository;
    channels: IChannelRepository;
    tasks: ITaskRepository;
    memory: IMemoryRepository;
}

/**
 * Factory for creating database-specific repository implementations.
 *
 * Usage:
 *   DatabaseAdapterFactory.initialize({ type: 'mongodb', connectionString: '...' });
 *   await DatabaseAdapterFactory.connect(); // Establishes connection if not already connected
 *   const repos = DatabaseAdapterFactory.create();
 *   const agent = await repos.agents.findByAgentId('agent-1');
 *
 * This factory enables plug-and-play database support by abstracting
 * database-specific implementations behind common repository interfaces.
 */
export class DatabaseAdapterFactory {
    private static instance: RepositoryBundle | null = null;
    private static config: DatabaseConfig | null = null;
    private static connected: boolean = false;

    /**
     * Initialize the factory with database configuration.
     * Must be called before create().
     */
    static initialize(config: DatabaseConfig): void {
        this.config = config;
        this.instance = null; // Reset instance on re-initialization
        this.connected = false;
    }

    /**
     * Connect to the database if not already connected.
     * For MongoDB, checks if mongoose is already connected (e.g., by server)
     * and only establishes a new connection if needed.
     */
    static async connect(): Promise<void> {
        if (!this.config) {
            throw new Error('DatabaseAdapterFactory not initialized. Call initialize() first.');
        }

        if (this.connected) {
            return;
        }

        switch (this.config.type) {
            case 'mongodb':
                await this.connectMongo();
                break;
            case 'postgresql':
            case 'sqlite':
            case 'mysql':
                throw new Error(`${this.config.type} adapter not yet implemented`);
            default:
                throw new Error(`Unknown database type: ${this.config.type}`);
        }

        this.connected = true;
    }

    /**
     * Connect to MongoDB using the configured connection string.
     * Checks if mongoose is already connected and reuses that connection.
     */
    private static async connectMongo(): Promise<void> {
        // Check if mongoose is already connected (e.g., server has established connection)
        if (mongoose.connection.readyState === 1) {
            // Already connected, reuse existing connection
            return;
        }

        // Not connected, establish new connection
        const options = {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            ...this.config?.options
        };

        await mongoose.connect(this.config!.connectionString, options);
    }

    /**
     * Create or return the repository bundle.
     * Uses singleton pattern to ensure single instance of repositories.
     * Note: For MongoDB, ensure connect() has been called first if mongoose
     * is not already connected by the server.
     */
    static create(): RepositoryBundle {
        if (!this.config) {
            throw new Error('DatabaseAdapterFactory not initialized. Call initialize() first.');
        }

        if (this.instance) {
            return this.instance;
        }

        switch (this.config.type) {
            case 'mongodb':
                this.instance = this.createMongoRepositories();
                break;
            case 'postgresql':
                throw new Error('PostgreSQL adapter not yet implemented');
            case 'sqlite':
                throw new Error('SQLite adapter not yet implemented');
            case 'mysql':
                throw new Error('MySQL adapter not yet implemented');
            default:
                throw new Error(`Unknown database type: ${this.config.type}`);
        }

        return this.instance;
    }

    /**
     * Get the current configuration.
     */
    static getConfig(): DatabaseConfig | null {
        return this.config;
    }

    /**
     * Check if the factory is connected to the database.
     */
    static isConnected(): boolean {
        if (this.config?.type === 'mongodb') {
            // For MongoDB, also check mongoose's connection state
            return this.connected || mongoose.connection.readyState === 1;
        }
        return this.connected;
    }

    /**
     * Reset the factory (useful for testing)
     */
    static reset(): void {
        this.instance = null;
        this.config = null;
        this.connected = false;
    }

    /**
     * Disconnect from the database.
     * Note: Only disconnects if the factory established the connection.
     * If mongoose was already connected (e.g., by server), this is a no-op.
     */
    static async disconnect(): Promise<void> {
        if (this.connected && this.config?.type === 'mongodb') {
            // Only disconnect if we established the connection
            // Check if mongoose connection was established by us
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
            }
        }
        this.connected = false;
    }

    /**
     * Create MongoDB repository implementations
     */
    private static createMongoRepositories(): RepositoryBundle {
        return {
            agents: new MongoAgentRepository(),
            channels: new MongoChannelRepository(),
            tasks: new MongoTaskRepository(),
            memory: new MongoMemoryRepository()
        };
    }
}
