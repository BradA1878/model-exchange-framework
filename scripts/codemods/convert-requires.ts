#!/usr/bin/env bun
/**
 * Converts in-function `const { a, b: c } = require('spec');` statements in
 * packages/core/src to hoisted static imports. @mxf-dev/core is ESM-only — CJS
 * require() crashes under Node ESM at runtime — and the project rule forbids
 * dynamic singleton loading anyway.
 *
 * Names already imported at the top of a file are not re-added (the redundant
 * require line is still removed). tsc -b is the verifier.
 *
 * Usage: bun run scripts/codemods/convert-requires.ts [--dry-run]
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..', '..');
const TARGET = 'packages/core/src';

const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (entry.name.endsWith('.ts')) out.push(rel);
    }
    return out;
};

const REQUIRE_LINE =
    /^[ \t]*const\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)(\s*as\s*typeof\s+import\([^)]*\))?\s*;[ \t]*\r?\n/gm;

const dryRun = process.argv.includes('--dry-run');
let filesChanged = 0;
let converted = 0;

for (const rel of walk(TARGET)) {
    const abs = join(ROOT, rel);
    const before = readFileSync(abs, 'utf8');
    const needed = new Map<string, Set<string>>();

    let after = before.replace(REQUIRE_LINE, (_line, names: string, spec: string) => {
        const set = needed.get(spec) ?? new Set<string>();
        for (const raw of names.split(',')) {
            const name = raw.trim();
            if (name) set.add(name.replace(/\s*:\s*/, ' as '));
        }
        needed.set(spec, set);
        converted++;
        return '';
    });

    if (needed.size === 0) continue;

    const existingImports = new Set(
        [...after.matchAll(/^import\s*(?:type\s*)?\{([^}]+)\}\s*from/gm)].flatMap((m) =>
            m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
        )
    );

    const importLines: string[] = [];
    for (const [spec, names] of needed) {
        const missing = [...names].filter(
            (n) => !existingImports.has(n.split(/\s+as\s+/).pop()!.trim())
        );
        if (missing.length > 0) importLines.push(`import { ${missing.join(', ')} } from '${spec}';`);
    }

    if (importLines.length > 0) {
        const lastImport = [...after.matchAll(/^import[^;]+;[ \t]*$/gm)].pop();
        if (!lastImport || lastImport.index === undefined) {
            throw new Error(`${rel}: no top-level import block found to anchor on`);
        }
        const insertAt = lastImport.index + lastImport[0].length;
        after = after.slice(0, insertAt) + '\n' + importLines.join('\n') + after.slice(insertAt);
    }

    filesChanged++;
    if (dryRun) {
        console.log(`${rel}:`);
        for (const [spec, names] of needed) console.log(`  ${[...names].join(', ')} <- ${spec}`);
    } else {
        writeFileSync(abs, after);
    }
}

console.log(`${dryRun ? 'Would convert' : 'Converted'} ${converted} require() lines in ${filesChanged} files.`);
