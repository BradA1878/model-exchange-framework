/**
 * Demos reference Claude through OpenRouter's latest-resolution aliases
 * (`~anthropic/claude-{opus,sonnet,haiku}-latest`) so a new release is picked
 * up without editing every example. A concrete Claude slug in an example is a
 * regression.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../..');
const examplesRoot = join(repositoryRoot, 'examples');
const skippedDirectories = new Set(['node_modules', 'dist', '.git']);
const sourcePattern = /\.(ts|js|json|md)$|\.env\.example$/;
/** A Claude slug that is not one of the three supported aliases. */
const concreteClaudeSlug = /(?<!~)anthropic\/claude-(?!(opus|sonnet|haiku)-latest\b)[\w.-]+/g;

const collectSourceFiles = (directory: string, files: string[] = []): string[] => {
    for (const entry of readdirSync(directory)) {
        if (skippedDirectories.has(entry)) {
            continue;
        }
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            collectSourceFiles(path, files);
        } else if (sourcePattern.test(entry)) {
            files.push(path);
        }
    }
    return files;
};

describe('demo Claude model references', () => {
    it('use the OpenRouter latest aliases rather than a pinned release', () => {
        const offenders: string[] = [];
        for (const file of collectSourceFiles(examplesRoot)) {
            const content = readFileSync(file, 'utf8');
            for (const match of content.matchAll(concreteClaudeSlug)) {
                offenders.push(`${relative(repositoryRoot, file)}: ${match[0]}`);
            }
        }

        expect(offenders).toEqual([]);
    });
});
