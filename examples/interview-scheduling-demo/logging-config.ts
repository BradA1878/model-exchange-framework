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
 */

// Set minimal logging for demo
process.env.LOG_LEVEL = 'error';

// Disable most modules
const modulesToDisable = [
    'McpServer',
    'HybridMcpService', 
    'ToolRegistry',
    'ServerManager',
    'TransportManager',
    'AgentManager',
    'AgentTaskService',
    'NotificationService',
    'EventBus',
    'SocketService',
    'Authentication',
    'ControlLoop',
    'TaskExecutionManager',
    'McpClient',
    'UnifiedMcpClient',
    'ReasoningEngine'
];

// Disable each module
modulesToDisable.forEach(module => {
    process.env[`LOG_${module.toUpperCase()}_ENABLED`] = 'false';
});

// Only show critical errors
process.env.LOG_FORMAT = 'simple';

export const loggingConfig = {
    level: 'error',
    disabledModules: modulesToDisable
};