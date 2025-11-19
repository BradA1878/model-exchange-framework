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
 * Trial Period Enforcement
 * 
 * This module enforces trial period limitations on the MXF server.
 * The trial period is embedded at build time and cannot be bypassed
 * without recompiling the server.
 * 
 * IMPORTANT: This file is modified during the trial build process.
 * The BUILD_TIMESTAMP constant is replaced with the actual build time.
 */

import { Logger } from '../shared/utils/Logger';

const logger = new Logger('info', 'TrialEnforcement', 'server');

/**
 * Build timestamp - injected during trial build process
 * Format: Unix timestamp (milliseconds since epoch)
 * 
 * TRIAL_BUILD_TIMESTAMP will be replaced by build script
 */
const BUILD_TIMESTAMP = process.env.TRIAL_BUILD_TIMESTAMP || 'TRIAL_BUILD_TIMESTAMP';

/**
 * Trial period duration in days
 */
const TRIAL_PERIOD_DAYS = 30;

/**
 * Trial period duration in milliseconds
 */
const TRIAL_PERIOD_MS = TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Check if this is a trial build
 */
const isTrialBuild = (): boolean => {
    return BUILD_TIMESTAMP !== '1760206965901';
};

/**
 * Get the build date
 */
const getBuildDate = (): Date | null => {
    if (!isTrialBuild()) {
        return null;
    }
    
    const timestamp = parseInt(BUILD_TIMESTAMP, 10);
    if (isNaN(timestamp)) {
        logger.error('Invalid build timestamp');
        return null;
    }
    
    return new Date(timestamp);
};

/**
 * Get the trial expiration date
 */
const getExpirationDate = (): Date | null => {
    const buildDate = getBuildDate();
    if (!buildDate) {
        return null;
    }
    
    return new Date(buildDate.getTime() + TRIAL_PERIOD_MS);
};

/**
 * Get days remaining in trial
 */
const getDaysRemaining = (): number | null => {
    const expirationDate = getExpirationDate();
    if (!expirationDate) {
        return null;
    }
    
    const now = Date.now();
    const msRemaining = expirationDate.getTime() - now;
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
    
    return daysRemaining;
};

/**
 * Check if trial has expired
 */
const isTrialExpired = (): boolean => {
    if (!isTrialBuild()) {
        return false; // Not a trial build, no expiration
    }
    
    const expirationDate = getExpirationDate();
    if (!expirationDate) {
        logger.error('Could not determine expiration date');
        return true; // Fail closed - assume expired if we can\'t determine
    }
    
    const now = Date.now();
    return now > expirationDate.getTime();
};

/**
 * Display trial information banner
 */
const displayTrialInfo = (): void => {
    if (!isTrialBuild()) {
        return;
    }
    
    const buildDate = getBuildDate();
    const expirationDate = getExpirationDate();
    const daysRemaining = getDaysRemaining();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MXF SERVER - TRIAL VERSION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  Trial Period:        ${TRIAL_PERIOD_DAYS} days`);
    console.log(`  Build Date:          ${buildDate?.toISOString().split('T')[0]}`);
    console.log(`  Expiration Date:     ${expirationDate?.toISOString().split('T')[0]}`);
    console.log(`  Days Remaining:      ${daysRemaining}`);
    console.log('');
    console.log('  This is a trial version for evaluation purposes only.');
    console.log('  For production use, please contact sales.');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
};

/**
 * Display trial expiration message
 */
const displayExpirationMessage = (): void => {
    const buildDate = getBuildDate();
    const expirationDate = getExpirationDate();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  MXF SERVER - TRIAL EXPIRED');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('  Your trial period has expired.');
    console.log('');
    console.log(`  Build Date:          ${buildDate?.toISOString().split('T')[0]}`);
    console.log(`  Expiration Date:     ${expirationDate?.toISOString().split('T')[0]}`);
    console.log(`  Trial Period:        ${TRIAL_PERIOD_DAYS} days`);
    console.log('');
    console.log('  To continue using MXF Server, please:');
    console.log('  1. Contact sales for a production license');
    console.log('  2. Email: sales@your-company.com');
    console.log('  3. Visit: https://your-company.com/pricing');
    console.log('');
    console.log('  Thank you for evaluating MXF!');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
};

/**
 * Enforce trial period - call this at server startup
 * 
 * @throws Error if trial has expired
 */
export const enforceTrialPeriod = (): void => {
    if (!isTrialBuild()) {
        return;
    }
    
    
    // Display trial info
    displayTrialInfo();
    
    // Check if expired
    if (isTrialExpired()) {
        displayExpirationMessage();
        logger.error('Trial period has expired. Server will not start.');
        process.exit(1);
    }
    
    // Warning if less than 7 days remaining
    const daysRemaining = getDaysRemaining();
    if (daysRemaining !== null && daysRemaining <= 7) {
        logger.warn(`Trial expires in ${daysRemaining} days. Please contact sales for a production license.`);
    }
    
};

/**
 * Get trial status information
 */
export const getTrialStatus = (): {
    isTrial: boolean;
    buildDate: Date | null;
    expirationDate: Date | null;
    daysRemaining: number | null;
    isExpired: boolean;
} => {
    return {
        isTrial: isTrialBuild(),
        buildDate: getBuildDate(),
        expirationDate: getExpirationDate(),
        daysRemaining: getDaysRemaining(),
        isExpired: isTrialExpired()
    };
};
