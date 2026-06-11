#!/usr/bin/env bun
/**
 * Appends explicit .js extensions to relative import specifiers inside the
 * workspace packages, as required by NodeNext ESM emit. Each specifier is
 * resolved against the filesystem: `./x` -> `./x.js` when x.ts exists,
 * `./x` -> `./x/index.js` when x/index.ts exists. tsc -b is the verifier.
 *
 * Usage: bun run scripts/codemods/add-esm-extensions.ts <package-src-dir> [--dry-run]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ROOT = join(import.meta.dir, '..', '..');
const target = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!target) {
    console.error('Usage: add-esm-extensions.ts <package-src-dir> [--dry-run]');
    process.exit(1);
}

const SPEC_ANCHOR = /((?:from\s+|require\(\s*|import\(\s*|jest\.mock\(\s*)(['"]))([^'"]+)(\2)/g;

const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(abs));
        else if (entry.name.endsWith('.ts')) out.push(abs);
    }
    return out;
};

let changes = 0;
let files = 0;

for (const abs of walk(resolve(ROOT, target))) {
    const before = readFileSync(abs, 'utf8');
    const fileDir = dirname(abs);
    const after = before.replace(SPEC_ANCHOR, (whole, prefix, _q, spec, suffix) => {
        if (!spec.startsWith('./') && !spec.startsWith('../')) return whole;
        if (/\.(js|json|css|node)$/.test(spec)) return whole;
        const base = resolve(fileDir, spec);
        let next: string | null = null;
        if (existsSync(`${base}.ts`) || existsSync(`${base}.tsx`)) next = `${spec}.js`;
        else if (existsSync(join(base, 'index.ts'))) next = `${spec}/index.js`;
        if (!next) return whole;
        changes++;
        if (dryRun) console.log(`  ${abs.slice(ROOT.length + 1)}: ${spec} -> ${next}`);
        return `${prefix}${next}${suffix}`;
    });
    if (after !== before && !dryRun) writeFileSync(abs, after);
    if (after !== before) files++;
}

console.log(`${dryRun ? 'Would add' : 'Added'} ${changes} extensions across ${files} files.`);
