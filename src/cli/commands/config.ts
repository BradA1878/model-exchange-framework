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

/**
 * Pattern to identify secret-like key names.
 *
 * `salt` is included: the MXP salt feeds PBKDF2 key derivation, and a known
 * salt is what makes that derivation precomputable.
 */
const SECRET_KEY_PATTERN = /key|secret|password|token|salt/i;

/**
 * Check whether a key name likely holds a secret value.
 */
export function isSecretKey(key: string): boolean {
    return SECRET_KEY_PATTERN.test(key);
}

/**
 * Recursively copy a value, replacing any secret-looking leaf with a masked
 * placeholder.
 *
 * Used by `config get` when the requested path resolves to an object: printing
 * it as raw JSON would dump every nested secret (e.g. `config get credentials`)
 * and bypass the masking that `config list` and scalar `get` apply.
 *
 * @param value - The value to mask
 * @param key - The key this value was found under (decides if it is a secret)
 * @returns A structural copy with secret leaves masked
 */
export function maskDeep(value: unknown, key: string = ''): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => maskDeep(item, key));
    }

    if (value !== null && typeof value === 'object') {
        const masked: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            masked[childKey] = maskDeep(childValue, childKey);
        }
        return masked;
    }

    // Leaf: mask it if its key looks secret. null/undefined stay as-is so the
    // output still shows "not configured" rather than a fake mask.
    if (isSecretKey(key) && value !== null && value !== undefined) {
        return maskSecret(String(value));
    }

    return value;
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

            const lastSegment = dotPath.split('.').pop() || '';

            // If the value is an object, print it as formatted JSON. Mask every
            // secret leaf inside it unless --show was passed — `config get
            // credentials` must not dump the whole credential block in clear text.
            if (value !== null && typeof value === 'object') {
                const output = options.show ? value : maskDeep(value, lastSegment);
                console.log(JSON.stringify(output, null, 2));
                return;
            }

            // Determine if this key should be masked
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
