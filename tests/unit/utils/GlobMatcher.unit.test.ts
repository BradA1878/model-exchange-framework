import { createGlobMatcher, MAX_GLOB_WILDCARDS } from '@mxf-dev/core/utils/GlobMatcher';

describe('createGlobMatcher', () => {
    const matches = (pattern: string, candidate: string, caseSensitive = true): boolean =>
        createGlobMatcher(pattern, caseSensitive).test(candidate);

    it('matches literals exactly and treats regex metacharacters as literal text', () => {
        expect(matches('README.md', 'README.md')).toBe(true);
        expect(matches('README.md', 'READMEXmd')).toBe(false);
        expect(matches('a+b(c).ts', 'a+b(c).ts')).toBe(true);
        expect(matches('a+b(c).ts', 'ab(c).ts')).toBe(false);
    });

    it('keeps * inside one path segment and lets ? match exactly one character', () => {
        expect(matches('*.ts', 'inside.ts')).toBe(true);
        expect(matches('*.ts', 'src/inside.ts')).toBe(false);
        expect(matches('src/*.ts', 'src/inside.ts')).toBe(true);
        expect(matches('src/*.ts', 'src/nested/deep.ts')).toBe(false);
        expect(matches('in?ide.ts', 'inside.ts')).toBe(true);
        expect(matches('in?de.ts', 'inside.ts')).toBe(false);
        expect(matches('in?ide.ts', 'in/ide.ts')).toBe(false);
    });

    it('lets a whole ** segment span zero or more directories', () => {
        expect(matches('src/**/*.ts', 'src/inside.ts')).toBe(true);
        expect(matches('src/**/*.ts', 'src/nested/deep.ts')).toBe(true);
        expect(matches('src/**/*.ts', 'src/a/b/c/deep.ts')).toBe(true);
        expect(matches('**/deep.ts', 'src/nested/deep.ts')).toBe(true);
        expect(matches('**/deep.ts', 'deep.ts')).toBe(true);
        expect(matches('src/**', 'src/nested/deep.ts')).toBe(true);
        expect(matches('src/**', 'lib/deep.ts')).toBe(false);
        expect(matches('**/x/**/y.ts', 'a/x/b/x/c/y.ts')).toBe(true);
    });

    it('treats ** that is not a whole segment like *', () => {
        expect(matches('src/**.ts', 'src/inside.ts')).toBe(true);
        expect(matches('src/**.ts', 'src/nested/deep.ts')).toBe(false);
    });

    it('folds case only when asked', () => {
        expect(matches('SRC/INSIDE.TS', 'src/inside.ts', false)).toBe(true);
        expect(matches('SRC/INSIDE.TS', 'src/inside.ts', true)).toBe(false);
    });

    it('reports whether the pattern addresses a path or a bare file name', () => {
        expect(createGlobMatcher('*.ts', true).matchesPath).toBe(false);
        expect(createGlobMatcher('src/*.ts', true).matchesPath).toBe(true);
    });

    it('matches in bounded time for a pattern that makes a regex backtrack', () => {
        const matcher = createGlobMatcher(`${'*a'.repeat(14)}b`, true);
        const startedAt = performance.now();
        for (let index = 0; index < 1000; index += 1) {
            expect(matcher.test(`${'a'.repeat(250)}c`)).toBe(false);
        }
        expect(performance.now() - startedAt).toBeLessThan(1000);
    });

    it('rejects an empty pattern and a pattern with too many wildcards', () => {
        expect(() => createGlobMatcher('', true)).toThrow(/pattern/i);
        expect(() => createGlobMatcher('*a'.repeat(MAX_GLOB_WILDCARDS), true)).not.toThrow();
        expect(() => createGlobMatcher('*a'.repeat(MAX_GLOB_WILDCARDS + 1), true)).toThrow(/wildcard/i);
        // A run of stars counts once; ? counts each time.
        expect(() => createGlobMatcher(`${'**'.repeat(MAX_GLOB_WILDCARDS)}x`, true)).not.toThrow();
        expect(() => createGlobMatcher('?'.repeat(MAX_GLOB_WILDCARDS + 1), true)).toThrow(/wildcard/i);
    });
});
