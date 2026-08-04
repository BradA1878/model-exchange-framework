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
 * Normalize a task-completion summary value to a string.
 *
 * task_complete and task_complete_bridge accept summary/result as
 * string | object: cheap-tier models routinely summarize their work as
 * structured data instead of prose, and the tools' contract is to accept
 * any reasonable input. Objects are stored as their JSON string so
 * everything downstream of TaskService.handleTaskCompletion (task
 * metadata, task events, effectiveness analytics) keeps receiving a
 * plain string.
 *
 * Returns undefined for absent values so callers can chain fallbacks
 * with || exactly as before — an empty string also falls through to the
 * next fallback, preserving the pre-widening behavior.
 */
export const normalizeSummaryInput = (
    value: string | Record<string, any> | undefined | null
): string | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value);
};
