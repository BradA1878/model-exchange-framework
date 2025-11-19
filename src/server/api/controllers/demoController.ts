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

import { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import { Logger } from '../../../shared/utils/Logger';

// Create logger instance for demo controller
const logger = new Logger('info', 'DemoController', 'server');

// Store active demo processes
const activeDemos = new Map<string, ChildProcess>();

/**
 * Start the real interview scheduling demo
 */
export const startInterviewDemo = async (req: Request, res: Response): Promise<void> => {
    try {
        const demoId = `demo-${Date.now()}`;
        
        // Path to the actual interview demo TypeScript file
        // From src/server/api/controllers/ go up 4 levels to project root
        const projectRoot = path.join(__dirname, '../../../..');
        const demoPath = path.join(projectRoot, 'examples/interview-scheduling-demo/interview-scheduling-demo.ts');
        
        // Check if the demo file exists
        if (!fs.existsSync(demoPath)) {
            throw new Error(`Demo file not found at: ${demoPath}`);
        }
        
        
        // Use ts-node to execute the TypeScript file directly
        const demoProcess = spawn('npx', ['ts-node', demoPath], {
            cwd: projectRoot, // Set working directory to project root
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Store the process for cleanup
        activeDemos.set(demoId, demoProcess);
        
        // Get Socket.IO instance from app locals
        const io: SocketIOServer = req.app.locals.io;
        
        // Stream stdout to presentation clients
        demoProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            io.emit('demo_output', {
                type: 'stdout',
                data: output,
                timestamp: Date.now()
            });
        });
        
        // Stream stderr to presentation clients
        demoProcess.stderr?.on('data', (data: Buffer) => {
            const output = data.toString();
            io.emit('demo_output', {
                type: 'stderr', 
                data: output,
                timestamp: Date.now()
            });
        });
        
        // Handle process completion
        demoProcess.on('close', (code: number) => {
            activeDemos.delete(demoId);
            io.emit('demo_output', {
                type: 'complete',
                data: `Demo completed with code ${code}`,
                timestamp: Date.now()
            });
        });
        
        // Handle process errors
        demoProcess.on('error', (error: Error) => {
            activeDemos.delete(demoId);
            io.emit('demo_output', {
                type: 'error',
                data: `Demo error: ${error.message}`,
                timestamp: Date.now()
            });
        });
        
        res.json({
            success: true,
            demoId,
            message: 'Interview demo started successfully'
        });
        
    } catch (error) {
        logger.error('Failed to start interview demo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start interview demo',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Stop a running demo
 */
export const stopDemo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { demoId } = req.params;
        
        const demoProcess = activeDemos.get(demoId);
        if (!demoProcess) {
            res.status(404).json({
                success: false,
                error: 'Demo not found'
            });
            return;
        }
        
        // Kill the process
        demoProcess.kill('SIGTERM');
        activeDemos.delete(demoId);
        
        // Notify clients
        const io: SocketIOServer = req.app.locals.io;
        io.emit('demo_output', {
            type: 'stopped',
            data: 'Demo stopped by user',
            timestamp: Date.now()
        });
        
        res.json({
            success: true,
            message: 'Demo stopped successfully'
        });
        
    } catch (error) {
        logger.error('Failed to stop demo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop demo',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get status of running demos
 */
export const getDemoStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const runningDemos = Array.from(activeDemos.keys());
        
        res.json({
            success: true,
            data: {
                runningDemos,
                count: runningDemos.length
            }
        });
        
    } catch (error) {
        logger.error('Failed to get demo status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get demo status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};
