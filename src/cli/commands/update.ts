/**
 * MXF CLI Update Command
 *
 * Checks for updates by comparing the local HEAD with the remote main branch.
 * Optionally pulls the latest changes and reinstalls dependencies.
 *
 * Usage:
 *   mxf update           # Check for updates (default: --check)
 *   mxf update --check   # Show update status without pulling
 *   mxf update --pull    # Pull latest changes and reinstall
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { logError, logInfo, logSuccess, logWarning } from '../utils/output';

/**
 * Register the `mxf update` command with the CLI program.
 *
 * Uses git to check for and apply updates. Requires the project
 * to be a git repository with a remote named 'origin'.
 */
export function registerUpdateCommand(program: Command): void {
    program
        .command('update')
        .description('Check for and apply MXF updates')
        .option('--check', 'Show update status without pulling (default)')
        .option('--pull', 'Pull latest changes and reinstall dependencies')
        .action(async (options: { check?: boolean; pull?: boolean }) => {
            try {
                // Verify we're in a git repository
                try {
                    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
                } catch {
                    logError('Not a git repository. Cannot check for updates.');
                    logInfo('MXF CLI must be installed from a git clone to use `mxf update`.');
                    process.exit(1);
                }

                // Get current version from package.json
                const packageJson = require('../../../package.json');
                const currentVersion = packageJson.version || 'unknown';
                logInfo(`Current version: ${currentVersion}`);

                // Fetch latest from remote
                logInfo('Fetching latest from remote...');
                try {
                    execSync('git fetch origin main', { stdio: 'pipe' });
                } catch {
                    logError('Failed to fetch from remote. Check your network connection.');
                    process.exit(1);
                }

                // Compare local HEAD with remote
                const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
                let behindCount = 0;

                try {
                    const behindOutput = execSync(
                        `git rev-list --count HEAD..origin/main`,
                        { encoding: 'utf-8' },
                    ).trim();
                    behindCount = parseInt(behindOutput, 10) || 0;
                } catch {
                    logWarning('Could not compare with origin/main. You may be on a feature branch.');
                }

                if (behindCount === 0) {
                    logSuccess('Already up to date.');
                    return;
                }

                logWarning(`${behindCount} commit(s) behind origin/main.`);

                if (options.pull) {
                    // Pull and reinstall
                    if (currentBranch !== 'main') {
                        logWarning(`Currently on branch '${currentBranch}', not main.`);
                        logInfo('Switch to main first: git checkout main');
                        process.exit(1);
                    }

                    logInfo('Pulling latest changes...');
                    execSync('git pull origin main', { stdio: 'inherit' });

                    logInfo('Reinstalling dependencies...');
                    execSync('bun install', { stdio: 'inherit' });

                    logSuccess('Update complete.');
                } else {
                    // Check-only mode (default)
                    logInfo(`Run 'mxf update --pull' to update (on main branch).`);
                    logInfo(`Or manually: git pull origin main && bun install`);
                }
            } catch (error: any) {
                logError(`Update failed: ${error.message}`);
                process.exit(1);
            }
        });
}
