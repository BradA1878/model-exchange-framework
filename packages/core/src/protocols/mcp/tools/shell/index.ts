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
 * Shell tools barrel export
 *
 * Unified entry point for all shell command execution modules:
 * - CommandSemantics: exit code interpretation (grep 1 = no matches, not error)
 * - DestructiveCommandWarnings: informational warnings for dangerous commands
 * - CommandClassification: categorize commands (read, write, git, network, etc.)
 * - LargeOutputHandler: truncation + MongoDB persistence for large outputs
 * - ShellExecuteHandler: enhanced execution integrating all of the above
 * - ShellCommandParser: recursive descent parser for compound shell commands
 * - ShellSandbox: Docker-based sandboxed shell execution
 */

export { interpretExitCode, extractExitCodeCommand } from './CommandSemantics.js';
export type { CommandSemanticResult } from './CommandSemantics.js';

export { getDestructiveWarnings, hasDestructiveWarnings } from './DestructiveCommandWarnings.js';
export type { DestructiveWarning } from './DestructiveCommandWarnings.js';

export { classifyCommand, isReadOnlyCommand, CommandCategory } from './CommandClassification.js';
export type { CommandClassification } from './CommandClassification.js';

export { processOutput, retrievePersistedOutput, DEFAULT_LARGE_OUTPUT_CONFIG } from './LargeOutputHandler.js';
export type { LargeOutputConfig, ProcessedOutput } from './LargeOutputHandler.js';

export { execute } from './ShellExecuteHandler.js';
export type { ShellExecuteInput, ShellExecuteContext, ShellExecuteResult } from './ShellExecuteHandler.js';

export { parseCommand, extractEffectiveCommands } from './ShellCommandParser.js';
export type { ParsedCommand } from './ShellCommandParser.js';

export { executeInSandbox, isSandboxAvailable } from './ShellSandbox.js';
export type { ShellSandboxConfig, SandboxedShellResult } from './ShellSandbox.js';
