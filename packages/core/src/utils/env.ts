/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */
/**
 * Fail-fast environment variable access.
 *
 * Project rule: no silent fallbacks. Configuration that the framework cannot
 * run safely without must throw immediately with an actionable message
 * instead of degrading to an insecure or surprising default.
 */

/**
 * Returns the value of a required environment variable, throwing with an
 * actionable message when it is missing or blank.
 */
export const requireEnv = (name: string, hint?: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        throw new Error(
            `Missing required environment variable ${name}.${hint ? ` ${hint}` : ''}`
        );
    }
    return value;
};
