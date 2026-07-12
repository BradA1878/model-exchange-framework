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
 * @documentation https://mxf-dev.github.io/mxf/
 */

import mongoose from 'mongoose';
import { IAgentRepository } from '../repositories/interfaces/IAgentRepository.js';
import { IChannelRepository } from '../repositories/interfaces/IChannelRepository.js';
import { ITaskRepository } from '../repositories/interfaces/ITaskRepository.js';
import { IMemoryRepository } from '../repositories/interfaces/IMemoryRepository.js';

// MongoDB implementations
import {
    MongoAgentRepository,
    MongoChannelRepository,
    MongoTaskRepository,
    MongoMemoryRepository
} from './adapters/mongodb/index.js';

/**
 * Supported database types
 */
export type DatabaseType = 'mongodb';

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
     * True only when connect() opened the connection itself, as opposed to
     * reusing one the host application (e.g. the server) had already opened.
     * disconnect() closes the connection only in the first case — otherwise the
     * factory would close the server's connection out from under it.
     */
    private static ownsConnection: boolean = false;

    /**
     * Initialize the factory with database configuration.
     * Must be called before create().
     */
    static initialize(config: DatabaseConfig): void {
        this.config = config;
        this.instance = null; // Reset instance on re-initialization
        this.connected = false;
        this.ownsConnection = false;
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
            // Reuse the existing connection. We did not open it, so we must not close it.
            this.ownsConnection = false;
            return;
        }

        // Not connected, establish new connection
        const options = {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            ...this.config?.options
        };

        await mongoose.connect(this.config!.connectionString, options);
        this.ownsConnection = true;
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
        this.ownsConnection = false;
    }

    /**
     * Disconnect from the database.
     *
     * Closes the connection only when connect() opened it. If mongoose was
     * already connected when connect() ran — the usual case inside the server —
     * the connection belongs to the host and is left alone.
     *
     * Previously `connected` was set true in both cases, so calling disconnect()
     * closed the server's own mongoose connection.
     */
    static async disconnect(): Promise<void> {
        if (this.connected && this.ownsConnection && this.config?.type === 'mongodb') {
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
            }
        }

        this.connected = false;
        this.ownsConnection = false;
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
