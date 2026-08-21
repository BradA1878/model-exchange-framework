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

/**
 * TaskInterfaces.ts
 * 
 * Defines interfaces and types for task requests and responses between agents
 * in the Model Exchange Framework.
 */

/**
 * Interface for task requests
 */
export interface SimpleTaskRequest {
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    content: string;
    title?: string; // Task title for display and context
    description?: string; // Full task description (same as content, for compatibility)
    /** Agent designated to report the task's terminal outcome; the server enforces it. */
    completionAgentId?: string;
    /** Every agent assigned to the task. */
    assignedAgentIds?: string[];
    /**
     * Task metadata. Role flags (isCompletionAgent, multiAgentTask, agentRole)
     * are present only on the late-assignment flows; the creator's own
     * metadata is passed through on direct assignment.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Interface for task responses
 */
export interface SimpleTaskResponse {
    taskId: string;
    toAgentId: string;
    content: string;
}

/**
 * Callback for handling task requests
 */
export type TaskRequestHandler = (task: SimpleTaskRequest) => Promise<SimpleTaskResponse>;

/** Terminal outcomes the server broadcasts for a task. */
export type TaskOutcome = 'completed' | 'failed' | 'cancelled';

/** Called once when the task this agent was assigned reaches a terminal outcome. */
export type TaskEndedHandler = (taskId: string, outcome: TaskOutcome) => void;
