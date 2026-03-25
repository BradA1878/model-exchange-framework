#!/usr/bin/env node
/**
 * Patch Bun hoisting issues for ANSI-related packages.
 *
 * Bun 1.3.x hoists certain packages to the root node_modules, but sibling
 * packages expect their nested versions (with different major versions / module
 * formats). This causes runtime crashes:
 *
 * 1. ansi-styles: v4 (CJS) hoisted, but slice-ansi/wrap-ansi etc. need v6 (ESM).
 *    v4 API is incompatible with v6 (ansiStyles.color.ansi is Object vs Function).
 *
 * 2. ansi-regex: v6 (ESM) hoisted, but strip-ansi@6 (CJS) needs v5 (CJS).
 *    require('ansi-regex') returns a Module namespace object instead of the function.
 *
 * This script patches bare import/require statements to use relative paths,
 * forcing resolution to the correct nested versions.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';

const nodeModules = join(import.meta.dirname, '..', 'node_modules');
let patchCount = 0;

// ── Part 1: Patch bare `import ... from 'ansi-styles'` ──────────────────
// Each entry: [file path relative to node_modules, nested ansi-styles relative to node_modules]
const ansiStylesTargets = [
    // slice-ansi (direct dependency of ink)
    ['slice-ansi/index.js', 'slice-ansi/node_modules/ansi-styles/index.js'],
    // @alcalzone/ansi-tokenize (dependency of ink)
    ['@alcalzone/ansi-tokenize/build/ansiCodes.js', '@alcalzone/ansi-tokenize/node_modules/ansi-styles/index.js'],
    ['@alcalzone/ansi-tokenize/build/reduce.js', '@alcalzone/ansi-tokenize/node_modules/ansi-styles/index.js'],
    // cli-truncate's slice-ansi (dependency of ink)
    ['cli-truncate/node_modules/slice-ansi/index.js', 'cli-truncate/node_modules/slice-ansi/node_modules/ansi-styles/index.js'],
    // wrap-ansi (ESM version, uses v6)
    ['wrap-ansi/index.js', 'wrap-ansi/node_modules/ansi-styles/index.js'],
    // @isaacs/cliui's wrap-ansi
    ['@isaacs/cliui/node_modules/wrap-ansi/index.js', '@isaacs/cliui/node_modules/wrap-ansi/node_modules/ansi-styles/index.js'],
    // @inquirer/core's wrap-ansi
    ['@inquirer/core/node_modules/wrap-ansi/index.js', '@inquirer/core/node_modules/wrap-ansi/node_modules/ansi-styles/index.js'],
];

for (const [fileRel, nestedRel] of ansiStylesTargets) {
    const filePath = join(nodeModules, fileRel);
    const nestedPath = join(nodeModules, nestedRel);

    if (!existsSync(filePath) || !existsSync(nestedPath)) continue;

    const content = readFileSync(filePath, 'utf-8');
    const hasBareImport = content.includes("from 'ansi-styles'") || content.includes('from "ansi-styles"');
    const alreadyPatched = content.includes('./node_modules/ansi-styles');

    if (hasBareImport && !alreadyPatched) {
        const fileDir = dirname(filePath);
        let relativePath = relative(fileDir, nestedPath);
        if (!relativePath.startsWith('.')) relativePath = './' + relativePath;

        const patched = content
            .replace(/from 'ansi-styles'/g, `from '${relativePath}'`)
            .replace(/from "ansi-styles"/g, `from '${relativePath}'`);

        writeFileSync(filePath, patched, 'utf-8');
        patchCount++;
        console.log(`  patched (ansi-styles): ${fileRel}`);
    }
}

// ── Part 2: Patch CJS `require('ansi-regex')` in strip-ansi@6 ───────────
// strip-ansi@6 (CJS) does require('ansi-regex'), but Bun resolves to the
// hoisted ansi-regex@6 (ESM-only). The nested ansi-regex@5 (CJS) is correct.
const ansiRegexTargets = [
    // Root strip-ansi@6 (CJS) needs its nested ansi-regex@5 (CJS)
    ['strip-ansi/index.js', 'strip-ansi/node_modules/ansi-regex/index.js'],
    // strip-ansi-cjs also needs its nested ansi-regex@5
    ['strip-ansi-cjs/index.js', 'strip-ansi-cjs/node_modules/ansi-regex/index.js'],
];

for (const [fileRel, nestedRel] of ansiRegexTargets) {
    const filePath = join(nodeModules, fileRel);
    const nestedPath = join(nodeModules, nestedRel);

    if (!existsSync(filePath) || !existsSync(nestedPath)) continue;

    const content = readFileSync(filePath, 'utf-8');
    const hasBareRequire = content.includes("require('ansi-regex')") || content.includes('require("ansi-regex")');
    const alreadyPatched = content.includes('./node_modules/ansi-regex');

    if (hasBareRequire && !alreadyPatched) {
        const fileDir = dirname(filePath);
        let relativePath = relative(fileDir, nestedPath);
        if (!relativePath.startsWith('.')) relativePath = './' + relativePath;

        const patched = content
            .replace(/require\('ansi-regex'\)/g, `require('${relativePath}')`)
            .replace(/require\("ansi-regex"\)/g, `require('${relativePath}')`);

        writeFileSync(filePath, patched, 'utf-8');
        patchCount++;
        console.log(`  patched (ansi-regex): ${fileRel}`);
    }
}

if (patchCount > 0) {
    console.log(`patch-ansi-styles: Patched ${patchCount} file(s)`);
} else {
    console.log('patch-ansi-styles: No patches needed');
}
