/**
 * MXF CLI Config Command
 *
 * Provides subcommands to get, set, list, and locate MXF configuration values.
 * Secrets are automatically masked in output unless explicitly revealed.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { ConfigService } from '../services/ConfigService';
import { logSuccess, logError, logInfo, logKeyValue, logHeader, maskSecret } from '../utils/output';

/** Pattern to identify secret-like key names */
const SECRET_KEY_PATTERN = /key|secret|password|token/i;

/**
 * Check whether a key name likely holds a secret value.
 */
function isSecretKey(key: string): boolean {
    return SECRET_KEY_PATTERN.test(key);
}

/**
 * Recursively walk a config object, printing each key-value pair.
 * Secret values are masked. Nested objects are flattened with dot-path keys.
 *
 * @param obj - The object to walk
 * @param prefix - Dot-path prefix for nested keys
 */
function printConfigEntries(obj: Record<string, any>, prefix: string = ''): void {
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            printConfigEntries(value, fullKey);
        } else {
            const displayValue = isSecretKey(key) ? maskSecret(String(value)) : String(value);
            logKeyValue(fullKey, displayValue);
        }
    }
}

/**
 * Register the `mxf config` command and its subcommands on the provided Commander program.
 */
export function registerConfigCommand(program: Command): void {
    const configCmd = program
        .command('config')
        .description('Get, set, list, or locate MXF configuration values');

    // --- config list ---
    configCmd
        .command('list')
        .description('Display all configuration values (secrets masked)')
        .action(() => {
            logHeader('MXF Configuration');

            const configService = ConfigService.getInstance();
            const config = configService.load();

            if (!config) {
                logError('No config found. Run `mxf install` first.');
                process.exit(1);
            }

            printConfigEntries(config as unknown as Record<string, any>);
        });

    // --- config get <path> ---
    configCmd
        .command('get <path>')
        .description('Get a configuration value by dot path (e.g., server.port)')
        .option('--show', 'Show secret values unmasked')
        .action((dotPath: string, options: { show?: boolean }) => {
            const configService = ConfigService.getInstance();
            const config = configService.load();

            if (!config) {
                logError('No config found. Run `mxf install` first.');
                process.exit(1);
            }

            const value = configService.get(dotPath);

            if (value === undefined) {
                logError(`No value found at path: ${dotPath}`);
                process.exit(1);
            }

            // If the value is an object, print it as formatted JSON
            if (value !== null && typeof value === 'object') {
                console.log(JSON.stringify(value, null, 2));
                return;
            }

            // Determine if this key should be masked
            const lastSegment = dotPath.split('.').pop() || '';
            const shouldMask = isSecretKey(lastSegment) && !options.show;

            const displayValue = shouldMask ? maskSecret(String(value)) : String(value);
            logKeyValue(dotPath, displayValue);
        });

    // --- config set <path> <value> ---
    configCmd
        .command('set <path> <value>')
        .description('Set a configuration value by dot path')
        .action((dotPath: string, value: string) => {
            const configService = ConfigService.getInstance();
            const config = configService.load();

            if (!config) {
                logError('No config found. Run `mxf install` first.');
                process.exit(1);
            }

            // Attempt to parse the value as JSON for booleans and numbers
            let parsedValue: any = value;
            if (value === 'true') parsedValue = true;
            else if (value === 'false') parsedValue = false;
            else if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);
            else if (/^\d+\.\d+$/.test(value)) parsedValue = parseFloat(value);

            configService.set(dotPath, parsedValue);

            logSuccess(`Set ${dotPath} = ${String(parsedValue)}`);

            // Update the .env bridge file so the server picks up the change
            configService.writeEnvFile(process.cwd());
            logInfo('.env bridge file updated.');
        });

    // --- config path ---
    configCmd
        .command('path')
        .description('Print the config file path')
        .action(() => {
            const configService = ConfigService.getInstance();
            logInfo(configService.getConfigPath());
        });
}
