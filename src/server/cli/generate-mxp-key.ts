#!/usr/bin/env ts-node
/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */
/**
 * CLI utility to generate secure MXP encryption keys
 * 
 * Usage: npx ts-node src/server/cli/generate-mxp-key.ts
 */

import { MxpEncryption } from '../../shared/utils/MxpEncryption';
import * as crypto from 'crypto';

// Generate a secure key
const key = MxpEncryption.generateSecureKey();
const salt = crypto.randomBytes(16).toString('base64');
