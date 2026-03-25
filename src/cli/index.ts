#!/usr/bin/env bun
/**
 * MXF CLI — Unified Command Line Interface for Model Exchange Framework
 *
 * Manages infrastructure, configuration, server lifecycle, and AI task execution.
 * Config stored at ~/.mxf/config.json (not .env files).
 *
 * Commands:
 *   (none)     Launch interactive TUI session
 *   install    Set up infrastructure, generate credentials, create user
 *   init       Configure LLM provider, API keys, and models
 *   run        Execute a one-shot task with a Planner agent
 *   status     Show server and infrastructure health
 *   start      Start infrastructure containers
 *   stop       Stop infrastructure containers
 *   config     Get/set/list configuration values
 *   history    List past interactive sessions
 *   resume     Display a past session conversation (view-only)
 *   update     Check for and apply MXF updates
 *
 * Usage:
 *   bun run mxf                  # Launch interactive TUI
 *   bun run mxf install          # First-time setup
 *   bun run mxf init             # Configure LLM provider
 *   bun run mxf run "task"       # One-shot task execution
 *   bun run mxf status           # Check health
 *   bun run mxf start            # Start Docker containers
 *   bun run mxf stop             # Stop Docker containers
 *   bun run mxf config list      # View configuration
 *   bun run mxf history          # List past sessions
 *   bun run mxf resume <id>      # View past session
 *   bun run mxf update           # Check for updates
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { registerInstallCommand } from './commands/install';
import { registerInitCommand } from './commands/init';
import { registerStatusCommand } from './commands/status';
import { registerStartCommand } from './commands/start';
import { registerStopCommand } from './commands/stop';
import { registerConfigCommand } from './commands/config';
import { registerRunCommand } from './commands/run';
import { registerHistoryCommand } from './commands/history';
import { registerResumeCommand } from './commands/resume';
import { registerUpdateCommand } from './commands/update';

const program = new Command();

program
    .name('mxf')
    .description('Model Exchange Framework CLI — multi-agent AI orchestration')
    .version('1.5.2');

registerInstallCommand(program);
registerInitCommand(program);
registerRunCommand(program);
registerStatusCommand(program);
registerStartCommand(program);
registerStopCommand(program);
registerConfigCommand(program);
registerHistoryCommand(program);
registerResumeCommand(program);
registerUpdateCommand(program);

// Default action: launch interactive TUI when no subcommand is provided.
// The TUI uses Ink (React for CLIs) which requires different module resolution
// (bundler mode). TUI files are type-checked via tsconfig.cli.json separately.
program
    .option('--session <name>', 'Join or create a named shared session (enables multi-terminal collaboration)')
    .option('--agents <ids>', 'Comma-separated agent IDs to enable for this session (overrides config)')
    .option('--cwd <path>', 'Working directory for file operations (default: current directory)')
    .action(async (options: { session?: string; agents?: string; cwd?: string }) => {
        // Dynamic import to avoid loading React/Ink for subcommands.
        // Runtime path only — Bun resolves .tsx files directly.
        const tuiModule = await import('./tui/App' as string);
        const agentIds = options.agents
            ? options.agents.split(',').map(id => id.trim())
            : undefined;
        await (tuiModule as any).launchTUI(options.session, agentIds, options.cwd);
    });

program.parse(process.argv);
