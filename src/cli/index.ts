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

import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

/**
 * Check if the Tauri desktop app binary exists and we have a display.
 * Returns false for SSH sessions, headless servers, or if the app isn't built.
 */
function isDesktopAvailable(): boolean {
    // No display available — headless/SSH environment
    if (process.platform === 'darwin') {
        // macOS: check if we can talk to WindowServer (not SSH)
        if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false;
    } else if (process.platform === 'linux') {
        if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
    }

    // Check if the Tauri app bundle exists
    const appPaths = [
        // macOS dev build
        join(__dirname, '../desktop/src-tauri/target/debug/MXF.app'),
        // macOS release build
        join(__dirname, '../desktop/src-tauri/target/release/bundle/macos/MXF.app'),
        // Installed to /Applications
        '/Applications/MXF.app',
    ];

    return appPaths.some(p => existsSync(p));
}

/**
 * Launch the Tauri desktop app. On macOS, uses `open` to launch the .app bundle.
 * Returns a promise that resolves when the app process exits.
 */
async function launchDesktopApp(): Promise<void> {
    const appPaths = [
        '/Applications/MXF.app',
        join(__dirname, '../desktop/src-tauri/target/release/bundle/macos/MXF.app'),
        join(__dirname, '../desktop/src-tauri/target/debug/MXF.app'),
    ];

    const appPath = appPaths.find(p => existsSync(p));
    if (!appPath) {
        throw new Error('Desktop app binary not found');
    }

    if (process.platform === 'darwin') {
        // macOS: use `open` to launch the .app bundle
        const child = spawn('open', ['-a', appPath, '--args', '--cwd', process.cwd()], {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    } else {
        throw new Error(`Desktop app not supported on ${process.platform} yet`);
    }
}

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

// Default action: launch interactive session.
// Tries to launch the Tauri desktop app if available, falls back to terminal TUI.
// Use --tui to force terminal mode (for SSH, headless, or preference).
program
    .option('--session <name>', 'Join or create a named shared session (enables multi-terminal collaboration)')
    .option('--agents <ids>', 'Comma-separated agent IDs to enable for this session (overrides config)')
    .option('--cwd <path>', 'Working directory for file operations (default: current directory)')
    .option('--tui', 'Force terminal TUI mode (skip desktop app)')
    .action(async (options: { session?: string; agents?: string; cwd?: string; tui?: boolean }) => {
        const agentIds = options.agents
            ? options.agents.split(',').map(id => id.trim())
            : undefined;

        // Check if we should try the desktop app
        if (!options.tui && isDesktopAvailable()) {
            try {
                await launchDesktopApp();
                return;
            } catch {
                // Desktop launch failed — fall through to TUI
                console.log('Desktop app not available, falling back to terminal TUI...');
            }
        }

        // Launch terminal TUI (Ink-based)
        const tuiModule = await import('./tui/App' as string);
        await (tuiModule as any).launchTUI(options.session, agentIds, options.cwd);
    });

program.parse(process.argv);
