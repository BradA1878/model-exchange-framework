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
import dotenv from 'dotenv';
import { Logger } from '../../../shared/utils/Logger';

dotenv.config();

// Initialize logger for database service
const logger = new Logger('info', 'DatabaseService', 'server');

/**
 * Connects to the MongoDB database using the connection string from environment variables
 * @returns A promise that resolves when the connection is established
 */
export const connectToDatabase = async (): Promise<typeof mongoose> => {
    const connectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf';
    
    try {
        mongoose.connection.on('connected', () => {
        });
        
        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
        });
        
        // Graceful shutdown
        process.on('SIGINT', async () => {
            try {
                await mongoose.connection.close(true);
                process.exit(0);
            } catch (error) {
                logger.error('Error closing MongoDB connection:', error);
                process.exit(1);
            }
        });
        
        // Connect with retry logic
        const options = {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10
        };
        
        return await mongoose.connect(connectionString, options);
    } catch (error) {
        logger.error(`Failed to connect to MongoDB: ${error}`);
        throw error;
    }
};

/**
 * Closes the database connection
 */
export const closeDatabase = async (): Promise<void> => {
    await mongoose.connection.close();
};
