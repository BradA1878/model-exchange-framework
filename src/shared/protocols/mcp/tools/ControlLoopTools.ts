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
 * ControlLoopTools.ts
 * 
 * MCP tools for ORPAR control loop management and cognitive cycle operations.
 * This file imports and re-exports all control loop tools from their specialized modules.
 */

// Import lifecycle tools (start, status, stop)
import { 
    controlLoopStartTool, 
    controlLoopStatusTool, 
    controlLoopStopTool,
    controlLoopLifecycleTools 
} from './ControlLoopLifecycle';

// Import ORPAR phase tools (observe, reason, plan, execute, reflect)
import { 
    controlLoopObserveTool,
    controlLoopReasonTool,
    controlLoopPlanTool,
    controlLoopExecuteTool,
    controlLoopReflectTool,
    controlLoopPhaseTools 
} from './ControlLoopPhases';

// Re-export individual tools for direct access
export {
    controlLoopStartTool,
    controlLoopObserveTool,
    controlLoopReasonTool,
    controlLoopPlanTool,
    controlLoopExecuteTool,
    controlLoopReflectTool,
    controlLoopStatusTool,
    controlLoopStopTool
};

// Re-export categorized tool arrays
export {
    controlLoopLifecycleTools,
    controlLoopPhaseTools
};

/**
 * Export all control loop MCP tools as a single array
 * Maintains backward compatibility with existing imports
 */
export const controlLoopTools = [
    controlLoopStartTool,
    controlLoopObserveTool,
    controlLoopReasonTool,
    controlLoopPlanTool,
    controlLoopExecuteTool,
    controlLoopReflectTool,
    controlLoopStatusTool,
    controlLoopStopTool
];
